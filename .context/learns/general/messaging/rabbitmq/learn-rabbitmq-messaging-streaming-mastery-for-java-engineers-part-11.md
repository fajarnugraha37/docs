# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-11.md

# Part 11 — Spring Boot Integration Patterns

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memakai RabbitMQ secara production-grade dengan Spring Boot  
> Fokus bagian ini: bagaimana merancang integrasi Spring Boot + RabbitMQ yang aman, eksplisit, testable, observable, dan tidak terjebak pada “cukup kasih `@RabbitListener` lalu selesai”.

---

## 0. Posisi Part Ini Dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

- RabbitMQ sebagai broker routing dan delivery system.
- AMQP entity: connection, channel, exchange, queue, binding, routing key.
- Queue type: classic, quorum, stream.
- Publisher reliability: confirm, return, mandatory, idempotent publish.
- Consumer reliability: manual ack, redelivery, prefetch, idempotent consumer.
- Retry, DLQ, poison message, parking lot.
- Spring AMQP abstraction layer.

Part ini masuk ke pertanyaan praktis:

> “Bagaimana semua konsep itu diterapkan dalam Spring Boot application yang rapi, bisa di-test, bisa dioperasikan, dan aman ketika production failure terjadi?”

Spring Boot sering membuat RabbitMQ tampak terlalu mudah. Itu bagus untuk bootstrapping, tetapi berbahaya jika engineer tidak sadar bahwa default configuration bisa menyembunyikan keputusan penting:

- Apakah topology dibuat otomatis oleh aplikasi?
- Apakah publish menunggu confirm?
- Apakah unroutable message terdeteksi?
- Apakah consumer manual ack atau auto ack?
- Apakah retry dilakukan oleh listener container, broker DLX, atau application code?
- Apakah error akan requeue terus-menerus?
- Apakah message converter aman?
- Apakah listener concurrency sesuai kapasitas downstream?
- Apakah test benar-benar memvalidasi topology dan failure path?

Part ini tidak mengulang detail Spring AMQP di part 10. Di sini kita membangun **integration blueprint**.

---

## 1. Mental Model: Spring Boot RabbitMQ Integration Bukan Cuma Library

Spring Boot integration harus dipandang sebagai gabungan dari lima boundary:

```text
Application Code
  ├── Publisher boundary
  ├── Consumer boundary
  ├── Topology boundary
  ├── Reliability boundary
  └── Operational boundary
RabbitMQ Broker
```

Jika boundary ini dicampur sembarangan, sistem akan sulit di-debug.

Contoh desain buruk:

```java
@RabbitListener(queues = "case.review")
public void handle(CaseReviewRequested event) {
    service.process(event);
}
```

Sepintas bersih. Tetapi banyak pertanyaan tersembunyi:

- Queue `case.review` dibuat oleh siapa?
- Exchange dan binding-nya apa?
- Kalau processing gagal, apakah message di-requeue?
- Kalau poison message, apakah masuk DLQ?
- Kalau listener crash setelah DB commit tapi sebelum ack, apa yang terjadi?
- Kalau JSON tidak kompatibel, apakah message hilang, requeue, atau DLQ?
- Kalau service downstream lambat, concurrency dan prefetch menahan beban atau menghancurkan database?

Production-grade integration memaksa keputusan itu terlihat.

---

## 2. Recommended Spring Boot Project Structure

Untuk service serius, pisahkan RabbitMQ integration dari business logic.

Contoh struktur:

```text
src/main/java/com/acme/caseapp
  ├── CaseApplication.java
  ├── config
  │   ├── RabbitConnectionConfig.java
  │   ├── RabbitTopologyConfig.java
  │   ├── RabbitPublisherConfig.java
  │   ├── RabbitListenerConfig.java
  │   └── RabbitMessageConverterConfig.java
  ├── messaging
  │   ├── contract
  │   │   ├── MessageEnvelope.java
  │   │   ├── CaseReviewRequestedMessage.java
  │   │   └── EvidenceSubmittedMessage.java
  │   ├── publisher
  │   │   ├── CaseEventPublisher.java
  │   │   └── RabbitCaseEventPublisher.java
  │   ├── consumer
  │   │   ├── CaseReviewRequestedListener.java
  │   │   └── EvidenceSubmittedListener.java
  │   ├── error
  │   │   ├── MessagingErrorClassifier.java
  │   │   └── RabbitListenerErrorHandler.java
  │   └── topology
  │       ├── RabbitNames.java
  │       └── RabbitTopologyProperties.java
  ├── application
  │   ├── ReviewCaseUseCase.java
  │   └── SubmitEvidenceUseCase.java
  ├── domain
  │   └── ...
  └── persistence
      └── ...
```

Prinsipnya:

1. **Business use case tidak tahu RabbitMQ.**
2. **Publisher interface tidak mengekspos `RabbitTemplate`.**
3. **Listener adalah adapter inbound, bukan tempat business logic kompleks.**
4. **Message contract dipisahkan dari JPA entity/domain aggregate.**
5. **Topology name dikelola terpusat.**
6. **Reliability decision eksplisit dalam config.**

---

## 3. Dependency Baseline

Contoh Maven dependency:

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-amqp</artifactId>
    </dependency>

    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>

    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>

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
</dependencies>
```

Gradle Kotlin DSL:

```kotlin
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-amqp")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-validation")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.testcontainers:rabbitmq")
}
```

---

## 4. Configuration Philosophy

Ada dua ekstrim yang sama-sama buruk.

Ekstrim pertama: semua hardcoded di annotation.

```java
@RabbitListener(queues = "case.review.requested.q")
public void consume(...) { ... }
```

Masalah:

- sulit mengganti per environment;
- sulit audit topology;
- sulit memastikan naming convention;
- sulit test secara eksplisit;
- mudah terjadi typo yang baru ketahuan runtime.

Ekstrim kedua: semua dynamic tanpa struktur.

```yaml
rabbit:
  anything:
    random-names: true
```

Masalah:

- topology menjadi tidak bisa di-review;
- ownership kabur;
- perubahan production terlalu mudah;
- tidak ada architectural contract.

Desain yang lebih baik:

- nama exchange/queue/binding dikelola di config property typed;
- topology tetap dideklarasikan lewat bean;
- property environment hanya mengganti prefix, durability, concurrency, host, credentials, dan feature toggles;
- critical topology tetap versioned dalam code atau infrastructure definitions.

---

## 5. Application Properties Baseline

Contoh `application.yml`:

```yaml
spring:
  application:
    name: case-management-service

  rabbitmq:
    host: localhost
    port: 5672
    username: app_case
    password: app_case_password
    virtual-host: case-platform

    publisher-confirm-type: correlated
    publisher-returns: true

    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 20
        concurrency: 2
        max-concurrency: 8
        default-requeue-rejected: false
        retry:
          enabled: false

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      show-details: when_authorized

app:
  rabbit:
    topology:
      prefix: case
      declare-topology: true
      exchange:
        case-events: case.events.x
        case-commands: case.commands.x
        case-audit: case.audit.x
      queue:
        review-requested: case.review.requested.q
        review-requested-dlq: case.review.requested.dlq
        evidence-submitted: case.evidence.submitted.q
        evidence-submitted-dlq: case.evidence.submitted.dlq
      routing:
        review-requested: case.review.requested
        evidence-submitted: case.evidence.submitted
        all-events: case.#
```

Hal penting:

```yaml
publisher-confirm-type: correlated
publisher-returns: true
```

Artinya publisher dapat menerima feedback:

- apakah message diterima broker;
- apakah message tidak dapat diroute.

Untuk consumer:

```yaml
acknowledge-mode: manual
default-requeue-rejected: false
retry.enabled: false
```

Artinya kita tidak menyerahkan failure policy pada default requeue otomatis yang bisa membuat infinite loop.

---

## 6. Typed Topology Properties

Gunakan typed properties agar config tervalidasi.

```java
package com.acme.caseapp.messaging.topology;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "app.rabbit.topology")
public class RabbitTopologyProperties {

    private boolean declareTopology = true;

    @Valid
    private final Exchange exchange = new Exchange();

    @Valid
    private final Queue queue = new Queue();

    @Valid
    private final Routing routing = new Routing();

    public boolean isDeclareTopology() {
        return declareTopology;
    }

    public void setDeclareTopology(boolean declareTopology) {
        this.declareTopology = declareTopology;
    }

    public Exchange getExchange() {
        return exchange;
    }

    public Queue getQueue() {
        return queue;
    }

    public Routing getRouting() {
        return routing;
    }

    public static class Exchange {
        @NotBlank
        private String caseEvents;

        @NotBlank
        private String caseCommands;

        @NotBlank
        private String caseAudit;

        public String getCaseEvents() { return caseEvents; }
        public void setCaseEvents(String caseEvents) { this.caseEvents = caseEvents; }

        public String getCaseCommands() { return caseCommands; }
        public void setCaseCommands(String caseCommands) { this.caseCommands = caseCommands; }

        public String getCaseAudit() { return caseAudit; }
        public void setCaseAudit(String caseAudit) { this.caseAudit = caseAudit; }
    }

    public static class Queue {
        @NotBlank
        private String reviewRequested;

        @NotBlank
        private String reviewRequestedDlq;

        @NotBlank
        private String evidenceSubmitted;

        @NotBlank
        private String evidenceSubmittedDlq;

        public String getReviewRequested() { return reviewRequested; }
        public void setReviewRequested(String reviewRequested) { this.reviewRequested = reviewRequested; }

        public String getReviewRequestedDlq() { return reviewRequestedDlq; }
        public void setReviewRequestedDlq(String reviewRequestedDlq) { this.reviewRequestedDlq = reviewRequestedDlq; }

        public String getEvidenceSubmitted() { return evidenceSubmitted; }
        public void setEvidenceSubmitted(String evidenceSubmitted) { this.evidenceSubmitted = evidenceSubmitted; }

        public String getEvidenceSubmittedDlq() { return evidenceSubmittedDlq; }
        public void setEvidenceSubmittedDlq(String evidenceSubmittedDlq) { this.evidenceSubmittedDlq = evidenceSubmittedDlq; }
    }

    public static class Routing {
        @NotBlank
        private String reviewRequested;

        @NotBlank
        private String evidenceSubmitted;

        @NotBlank
        private String allEvents;

        public String getReviewRequested() { return reviewRequested; }
        public void setReviewRequested(String reviewRequested) { this.reviewRequested = reviewRequested; }

        public String getEvidenceSubmitted() { return evidenceSubmitted; }
        public void setEvidenceSubmitted(String evidenceSubmitted) { this.evidenceSubmitted = evidenceSubmitted; }

        public String getAllEvents() { return allEvents; }
        public void setAllEvents(String allEvents) { this.allEvents = allEvents; }
    }
}
```

Enable property binding:

```java
@Configuration
@EnableConfigurationProperties(RabbitTopologyProperties.class)
class RabbitPropertiesConfig {
}
```

Benefit:

- typo config gagal saat startup;
- topology lebih mudah diaudit;
- test bisa inject property berbeda;
- environment-specific config tetap terkendali.

---

## 7. Naming Convention Yang Layak Dipakai

Gunakan nama yang menjawab empat hal:

1. domain apa;
2. message jenis apa;
3. role entity-nya apa;
4. apakah normal, retry, dead-letter, atau parking.

Contoh:

```text
case.events.x
case.commands.x
case.audit.x

case.review.requested.q
case.review.requested.retry.10s.q
case.review.requested.retry.1m.q
case.review.requested.dlq
case.review.requested.parking.q
```

Routing key:

```text
case.review.requested
case.evidence.submitted
case.enforcement.action.proposed
case.notification.email.requested
```

Jangan gunakan nama seperti:

```text
queue1
rabbitQueue
mainQueue
service-a-queue
processQueue
```

Nama seperti itu tidak membawa operational meaning.

---

## 8. Declarative Topology dengan Spring Boot

Contoh topology config:

```java
package com.acme.caseapp.config;

import com.acme.caseapp.messaging.topology.RabbitTopologyProperties;
import org.springframework.amqp.core.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(
    prefix = "app.rabbit.topology",
    name = "declare-topology",
    havingValue = "true",
    matchIfMissing = true
)
public class RabbitTopologyConfig {

    @Bean
    TopicExchange caseEventsExchange(RabbitTopologyProperties props) {
        return ExchangeBuilder
            .topicExchange(props.getExchange().getCaseEvents())
            .durable(true)
            .build();
    }

    @Bean
    DirectExchange caseCommandsExchange(RabbitTopologyProperties props) {
        return ExchangeBuilder
            .directExchange(props.getExchange().getCaseCommands())
            .durable(true)
            .build();
    }

    @Bean
    TopicExchange caseAuditExchange(RabbitTopologyProperties props) {
        return ExchangeBuilder
            .topicExchange(props.getExchange().getCaseAudit())
            .durable(true)
            .build();
    }

    @Bean
    Queue reviewRequestedQueue(RabbitTopologyProperties props) {
        return QueueBuilder
            .durable(props.getQueue().getReviewRequested())
            .quorum()
            .deadLetterExchange(props.getExchange().getCaseEvents())
            .deadLetterRoutingKey(props.getRouting().getReviewRequested() + ".dead")
            .build();
    }

    @Bean
    Queue reviewRequestedDlq(RabbitTopologyProperties props) {
        return QueueBuilder
            .durable(props.getQueue().getReviewRequestedDlq())
            .quorum()
            .build();
    }

    @Bean
    Binding reviewRequestedBinding(
        Queue reviewRequestedQueue,
        TopicExchange caseEventsExchange,
        RabbitTopologyProperties props
    ) {
        return BindingBuilder
            .bind(reviewRequestedQueue)
            .to(caseEventsExchange)
            .with(props.getRouting().getReviewRequested());
    }

    @Bean
    Binding reviewRequestedDlqBinding(
        Queue reviewRequestedDlq,
        TopicExchange caseEventsExchange,
        RabbitTopologyProperties props
    ) {
        return BindingBuilder
            .bind(reviewRequestedDlq)
            .to(caseEventsExchange)
            .with(props.getRouting().getReviewRequested() + ".dead");
    }
}
```

Catatan penting: contoh di atas mengarahkan dead-letter kembali ke exchange yang sama dengan routing key berbeda. Itu valid, tetapi dalam banyak sistem lebih jelas memakai DLX khusus:

```text
case.events.x
case.events.dlx
```

Untuk production besar, gunakan DLX terpisah agar operational control lebih eksplisit.

---

## 9. Topology Declaration: Aplikasi atau Infrastructure?

Ada dua pola valid.

### Pola A — Application-declared topology

Aplikasi mendeklarasikan exchange, queue, binding saat startup.

Cocok untuk:

- tim kecil;
- service ownership jelas;
- environment cepat berubah;
- local dev/test parity;
- topology sederhana-menengah.

Risiko:

- aplikasi butuh permission `configure`;
- perubahan topology otomatis saat deploy bisa berbahaya;
- sulit mengontrol change management di regulated environment.

### Pola B — Infrastructure-declared topology

Topology dibuat lewat Terraform, Helm, Ansible, RabbitMQ definitions, atau platform pipeline.

Cocok untuk:

- production regulated;
- strict change control;
- banyak service;
- central platform team;
- permission aplikasi dibatasi hanya `write/read`.

Risiko:

- dev/test parity lebih sulit;
- perubahan butuh koordinasi;
- topology drift jika tidak ada validation.

### Rekomendasi praktis

Gunakan hybrid:

```text
local/test        -> application declares topology
staging/prod      -> infrastructure declares topology
application start -> validates required topology exists
```

Di production, aplikasi idealnya tidak butuh permission `configure`.

---

## 10. RabbitAdmin Behavior

`RabbitAdmin` membuat declarable beans saat connection terbentuk.

Contoh:

```java
@Bean
RabbitAdmin rabbitAdmin(ConnectionFactory connectionFactory) {
    RabbitAdmin admin = new RabbitAdmin(connectionFactory);
    admin.setAutoStartup(true);
    return admin;
}
```

Untuk production infrastructure-declared topology:

```java
@Bean
RabbitAdmin rabbitAdmin(ConnectionFactory connectionFactory) {
    RabbitAdmin admin = new RabbitAdmin(connectionFactory);
    admin.setAutoStartup(false);
    return admin;
}
```

Tetapi jangan hanya mematikan declaration tanpa validasi. Tambahkan startup checker.

---

## 11. Startup Topology Validation

Di regulated atau production-critical system, service harus bisa menjawab:

> “Apakah queue/exchange yang saya butuhkan benar-benar ada dengan argumen yang benar?”

Minimal validation bisa memakai `RabbitAdmin#getQueueProperties`.

```java
package com.acme.caseapp.messaging.topology;

import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class RabbitTopologyValidator implements ApplicationRunner {

    private final RabbitAdmin rabbitAdmin;
    private final RabbitTopologyProperties props;

    public RabbitTopologyValidator(RabbitAdmin rabbitAdmin, RabbitTopologyProperties props) {
        this.rabbitAdmin = rabbitAdmin;
        this.props = props;
    }

    @Override
    public void run(ApplicationArguments args) {
        assertQueueExists(props.getQueue().getReviewRequested());
        assertQueueExists(props.getQueue().getReviewRequestedDlq());
        assertQueueExists(props.getQueue().getEvidenceSubmitted());
        assertQueueExists(props.getQueue().getEvidenceSubmittedDlq());
    }

    private void assertQueueExists(String queueName) {
        var properties = rabbitAdmin.getQueueProperties(queueName);
        if (properties == null) {
            throw new IllegalStateException("Required RabbitMQ queue does not exist: " + queueName);
        }
    }
}
```

Untuk validation yang lebih dalam, gunakan HTTP Management API untuk mengecek:

- exchange type;
- bindings;
- queue type;
- DLX args;
- quorum args;
- policies.

---

## 12. Publisher Configuration

Publisher production-grade butuh tiga hal:

1. confirm;
2. return callback;
3. bounded in-flight atau timeout discipline.

Spring Boot property:

```yaml
spring:
  rabbitmq:
    publisher-confirm-type: correlated
    publisher-returns: true
    template:
      mandatory: true
```

Atau Java config:

```java
@Configuration
public class RabbitPublisherConfig {

    @Bean
    RabbitTemplate rabbitTemplate(
        ConnectionFactory connectionFactory,
        MessageConverter messageConverter
    ) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);
        template.setMandatory(true);
        return template;
    }
}
```

`mandatory=true` penting agar unroutable message dikembalikan ke publisher, bukan diam-diam hilang.

---

## 13. Publisher Adapter Pattern

Jangan biarkan business service memakai `RabbitTemplate` langsung.

Buat interface:

```java
package com.acme.caseapp.messaging.publisher;

import com.acme.caseapp.messaging.contract.EvidenceSubmittedMessage;

public interface CaseEventPublisher {
    void publishEvidenceSubmitted(EvidenceSubmittedMessage message);
}
```

Implementation:

```java
package com.acme.caseapp.messaging.publisher;

import com.acme.caseapp.messaging.contract.EvidenceSubmittedMessage;
import com.acme.caseapp.messaging.topology.RabbitTopologyProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class RabbitCaseEventPublisher implements CaseEventPublisher {

    private final RabbitTemplate rabbitTemplate;
    private final RabbitTopologyProperties props;

    public RabbitCaseEventPublisher(
        RabbitTemplate rabbitTemplate,
        RabbitTopologyProperties props
    ) {
        this.rabbitTemplate = rabbitTemplate;
        this.props = props;
    }

    @Override
    public void publishEvidenceSubmitted(EvidenceSubmittedMessage message) {
        String messageId = message.messageId() != null
            ? message.messageId()
            : UUID.randomUUID().toString();

        CorrelationData correlationData = new CorrelationData(messageId);

        rabbitTemplate.convertAndSend(
            props.getExchange().getCaseEvents(),
            props.getRouting().getEvidenceSubmitted(),
            message,
            msg -> {
                msg.getMessageProperties().setMessageId(messageId);
                msg.getMessageProperties().setCorrelationId(message.correlationId());
                msg.getMessageProperties().setContentType("application/json");
                msg.getMessageProperties().setHeader("schema_version", message.schemaVersion());
                msg.getMessageProperties().setHeader("producer", "case-management-service");
                return msg;
            },
            correlationData
        );
    }
}
```

Masalah implementation di atas: `convertAndSend` kembali sebelum confirm selesai. Untuk event critical, publisher adapter harus terhubung dengan outbox atau confirm handling.

---

## 14. Confirm Callback Pattern

Spring `RabbitTemplate` bisa diberi confirm callback.

```java
@Configuration
public class RabbitConfirmConfig {

    @Bean
    RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory, MessageConverter converter) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(converter);
        template.setMandatory(true);

        template.setConfirmCallback((correlationData, ack, cause) -> {
            if (correlationData == null) {
                return;
            }

            String messageId = correlationData.getId();

            if (ack) {
                // mark outbox row as PUBLISHED, or record metric
                return;
            }

            // mark outbox row as FAILED/RETRYABLE, include cause
            // do not assume the message was definitely not persisted;
            // timeout/unknown states need careful handling.
        });

        template.setReturnsCallback(returned -> {
            // returned message means exchange existed but routing failed
            // if mandatory=true and publisher-returns=true.
            String exchange = returned.getExchange();
            String routingKey = returned.getRoutingKey();
            String replyText = returned.getReplyText();

            // mark as unroutable, alert, or route to recovery process
        });

        return template;
    }
}
```

Production note:

- Confirm callback bersifat async.
- Jangan lakukan blocking heavy work langsung di callback.
- Gunakan outbox table/state machine untuk publish critical.
- Return callback harus dianggap sebagai topology/routing defect kecuali memang expected.

---

## 15. Outbox-Friendly Publisher

Untuk business event yang tidak boleh hilang, desain ideal:

```text
HTTP/API command
  -> DB transaction
      -> update aggregate
      -> insert outbox row
  -> commit

Outbox relay
  -> read pending outbox
  -> publish to RabbitMQ
  -> wait/track confirm
  -> mark published
```

Spring Boot implementation biasanya punya scheduled relay:

```java
@Component
public class OutboxRelay {

    private final OutboxRepository outboxRepository;
    private final RabbitTemplate rabbitTemplate;
    private final RabbitTopologyProperties props;

    public OutboxRelay(
        OutboxRepository outboxRepository,
        RabbitTemplate rabbitTemplate,
        RabbitTopologyProperties props
    ) {
        this.outboxRepository = outboxRepository;
        this.rabbitTemplate = rabbitTemplate;
        this.props = props;
    }

    @Scheduled(fixedDelayString = "${app.outbox.relay-delay-ms:1000}")
    public void relay() {
        var batch = outboxRepository.findPublishableBatch(100);

        for (OutboxRecord record : batch) {
            CorrelationData correlationData = new CorrelationData(record.messageId());

            rabbitTemplate.convertAndSend(
                props.getExchange().getCaseEvents(),
                record.routingKey(),
                record.payload(),
                message -> {
                    message.getMessageProperties().setMessageId(record.messageId());
                    message.getMessageProperties().setCorrelationId(record.correlationId());
                    message.getMessageProperties().setContentType("application/json");
                    message.getMessageProperties().setHeader("schema_version", record.schemaVersion());
                    return message;
                },
                correlationData
            );

            outboxRepository.markPublishAttempted(record.id());
        }
    }
}
```

Tetapi contoh ini belum sempurna karena `markPublishAttempted` bukan berarti confirmed. Untuk desain robust:

- `PENDING`;
- `IN_FLIGHT`;
- `PUBLISHED`;
- `FAILED_RETRYABLE`;
- `FAILED_UNROUTABLE`;
- `UNKNOWN_CONFIRM_TIMEOUT`.

Confirm callback atau confirm future harus mengubah state.

---

## 16. Synchronous Confirm Dengan CorrelationData Future

Untuk low-throughput critical publisher, bisa menunggu confirm secara bounded.

```java
public void publishCritical(EvidenceSubmittedMessage message) {
    CorrelationData correlationData = new CorrelationData(message.messageId());

    rabbitTemplate.convertAndSend(
        props.getExchange().getCaseEvents(),
        props.getRouting().getEvidenceSubmitted(),
        message,
        correlationData
    );

    try {
        CorrelationData.Confirm confirm = correlationData
            .getFuture()
            .get(5, TimeUnit.SECONDS);

        if (!confirm.isAck()) {
            throw new IllegalStateException("RabbitMQ publish was nacked: " + confirm.getReason());
        }
    } catch (TimeoutException e) {
        throw new IllegalStateException("RabbitMQ publish confirm timed out; publish state is unknown", e);
    } catch (Exception e) {
        throw new IllegalStateException("RabbitMQ publish confirm failed", e);
    }
}
```

Gunakan ini dengan hati-hati:

- throughput lebih rendah;
- caller latency meningkat;
- timeout berarti unknown, bukan pasti gagal;
- duplicate publish tetap mungkin jika retry.

---

## 17. Message Converter Configuration

Default converter bisa tidak sesuai untuk long-term contract.

Gunakan JSON converter eksplisit.

```java
@Configuration
public class RabbitMessageConverterConfig {

    @Bean
    Jackson2JsonMessageConverter jackson2JsonMessageConverter(ObjectMapper objectMapper) {
        return new Jackson2JsonMessageConverter(objectMapper);
    }
}
```

Namun hati-hati dengan type metadata otomatis. Jangan membuat consumer bergantung pada Java class name producer.

Buruk:

```text
__TypeId__ = com.acme.internal.domain.CaseEntity
```

Lebih baik:

```text
content_type = application/json
schema_version = 1
message_type = case.evidence.submitted
```

Untuk long-lived integration, message type harus semantic, bukan nama class Java.

---

## 18. Message Contract Record

Contoh contract:

```java
package com.acme.caseapp.messaging.contract;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.Map;

public record EvidenceSubmittedMessage(
    @NotBlank String messageId,
    @NotBlank String correlationId,
    @NotBlank String causationId,
    @NotBlank String caseId,
    @NotBlank String evidenceId,
    @NotBlank String submittedBy,
    @NotNull Instant occurredAt,
    int schemaVersion,
    Map<String, Object> attributes
) {
}
```

Rules:

- `messageId` stable untuk deduplication.
- `correlationId` untuk trace lintas service.
- `causationId` untuk causal chain.
- `occurredAt` adalah waktu event terjadi, bukan waktu message diterima.
- `schemaVersion` wajib untuk evolution.
- Jangan masukkan object graph domain/JPA.

---

## 19. Listener Factory Configuration

Spring Boot default listener factory sering perlu dioverride.

```java
@Configuration
public class RabbitListenerConfig {

    @Bean
    SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
        ConnectionFactory connectionFactory,
        MessageConverter messageConverter,
        FatalExceptionStrategy fatalExceptionStrategy
    ) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setMessageConverter(messageConverter);

        factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        factory.setPrefetchCount(20);
        factory.setConcurrentConsumers(2);
        factory.setMaxConcurrentConsumers(8);
        factory.setDefaultRequeueRejected(false);

        ConditionalRejectingErrorHandler errorHandler =
            new ConditionalRejectingErrorHandler(fatalExceptionStrategy);
        factory.setErrorHandler(errorHandler);

        return factory;
    }
}
```

Manual ack membuat listener bertanggung jawab eksplisit:

```text
success         -> ack
retryable fail  -> reject/nack to retry/DLQ strategy
permanent fail  -> reject without requeue / DLQ / parking
unknown fail    -> usually reject without immediate requeue, let DLX policy handle
```

---

## 20. `@RabbitListener` Dengan Property Placeholder

Jangan hardcode queue name.

```java
@Component
public class EvidenceSubmittedListener {

    private final EvidenceSubmittedHandler handler;

    public EvidenceSubmittedListener(EvidenceSubmittedHandler handler) {
        this.handler = handler;
    }

    @RabbitListener(
        queues = "${app.rabbit.topology.queue.evidence-submitted}",
        containerFactory = "rabbitListenerContainerFactory"
    )
    public void onMessage(
        EvidenceSubmittedMessage message,
        Message rawMessage,
        Channel channel
    ) throws IOException {
        long deliveryTag = rawMessage.getMessageProperties().getDeliveryTag();

        try {
            handler.handle(message, rawMessage.getMessageProperties());
            channel.basicAck(deliveryTag, false);
        } catch (PermanentMessageException e) {
            channel.basicReject(deliveryTag, false);
        } catch (RetryableMessageException e) {
            channel.basicReject(deliveryTag, false);
        } catch (Exception e) {
            channel.basicReject(deliveryTag, false);
        }
    }
}
```

Kenapa `basicReject(..., false)` untuk retryable?

Karena retry sebaiknya dikendalikan oleh DLX/retry topology, bukan immediate requeue. Immediate requeue dapat membuat hot loop.

---

## 21. Handler Boundary

Listener tidak boleh menjadi tempat business process besar.

Buruk:

```java
@RabbitListener(...)
public void consume(Event event) {
    // validate
    // load DB
    // call service A
    // call service B
    // update DB
    // send email
    // publish another event
    // ack
}
```

Lebih baik:

```java
@Component
public class EvidenceSubmittedHandler {

    private final EvidenceApplicationService applicationService;
    private final ProcessedMessageRepository processedMessageRepository;

    @Transactional
    public void handle(EvidenceSubmittedMessage message, MessageProperties properties) {
        if (processedMessageRepository.existsByMessageId(message.messageId())) {
            return;
        }

        applicationService.recordEvidenceSubmission(
            message.caseId(),
            message.evidenceId(),
            message.submittedBy(),
            message.occurredAt()
        );

        processedMessageRepository.save(new ProcessedMessage(message.messageId()));
    }
}
```

Listener bertugas:

- menerima transport message;
- extract metadata;
- delegate;
- ack/nack/reject.

Handler bertugas:

- validate semantic;
- enforce idempotency;
- execute transaction;
- throw categorized exception.

---

## 22. Exception Taxonomy

Jangan semua exception diperlakukan sama.

Buat taxonomy:

```java
public abstract class MessageHandlingException extends RuntimeException {
    protected MessageHandlingException(String message, Throwable cause) {
        super(message, cause);
    }

    protected MessageHandlingException(String message) {
        super(message);
    }
}

public class PermanentMessageException extends MessageHandlingException {
    public PermanentMessageException(String message) { super(message); }
}

public class RetryableMessageException extends MessageHandlingException {
    public RetryableMessageException(String message, Throwable cause) { super(message, cause); }
}

public class UnknownMessageHandlingException extends MessageHandlingException {
    public UnknownMessageHandlingException(String message, Throwable cause) { super(message, cause); }
}
```

Mapping:

```text
Invalid schema              -> permanent
Missing required field       -> permanent
Unknown enum critical        -> permanent or compatibility issue
DB deadlock                  -> retryable
HTTP 503 downstream          -> retryable
Timeout downstream           -> retryable/unknown
Optimistic lock conflict     -> retryable if safe
Duplicate message            -> success/ack
Business invariant violation -> depends; often permanent
```

---

## 23. Error Handler vs Manual Try-Catch

Ada dua layer error:

1. error di listener method sebelum manual ack;
2. error di conversion/invocation layer sebelum method dipanggil.

Manual try-catch hanya menangani error setelah method masuk.

Conversion error bisa terjadi sebelum method body:

```text
raw AMQP message -> converter -> Java object -> listener method
```

Jika JSON invalid, listener method mungkin tidak pernah dipanggil. Maka perlu error handler.

```java
@Bean
FatalExceptionStrategy fatalExceptionStrategy() {
    return throwable -> {
        Throwable cause = throwable.getCause();

        if (cause instanceof MessageConversionException) {
            return true;
        }

        if (cause instanceof MethodArgumentNotValidException) {
            return true;
        }

        return false;
    };
}
```

Fatal berarti jangan requeue tanpa batas.

---

## 24. Validation Boundary

Gunakan Bean Validation pada contract, tetapi pahami efeknya.

```java
@RabbitListener(queues = "${app.rabbit.topology.queue.evidence-submitted}")
public void onMessage(@Valid EvidenceSubmittedMessage message, Message raw, Channel channel) {
    ...
}
```

Jika validation gagal sebelum body diproses, pastikan error handler mengarahkan ke DLQ/parking, bukan requeue infinite.

Alternatif: terima raw payload lalu validate manual agar bisa menghasilkan forensic record lebih kaya.

```java
@RabbitListener(...)
public void onRawMessage(Message rawMessage, Channel channel) {
    long tag = rawMessage.getMessageProperties().getDeliveryTag();
    try {
        EvidenceSubmittedMessage message = objectMapper.readValue(
            rawMessage.getBody(),
            EvidenceSubmittedMessage.class
        );
        validator.validate(message);
        handler.handle(message, rawMessage.getMessageProperties());
        channel.basicAck(tag, false);
    } catch (InvalidMessageContractException e) {
        channel.basicReject(tag, false);
    }
}
```

Raw mode memberi kontrol lebih, tetapi kode lebih banyak.

---

## 25. Consumer Concurrency Tuning di Boot

Konfigurasi:

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        prefetch: 20
        concurrency: 2
        max-concurrency: 8
```

Interpretasi:

```text
max unacked messages ≈ active_consumers × prefetch
```

Jika active consumers 8 dan prefetch 20:

```text
max in-flight = 160 messages
```

Pertanyaan desain:

- Apakah database sanggup 160 concurrent-ish units?
- Apakah downstream API punya rate limit?
- Apakah processing per message cepat atau lambat?
- Apakah ordering penting?
- Apakah message besar?
- Apakah retry storm bisa menggandakan load?

Untuk workflow/state transition penting, mulai konservatif:

```yaml
prefetch: 5
concurrency: 1
max-concurrency: 4
```

Untuk stateless high-throughput job:

```yaml
prefetch: 50
concurrency: 4
max-concurrency: 16
```

Tetapi angka final harus berdasarkan load test.

---

## 26. Listener Container Per Use Case

Jangan pakai satu factory untuk semua queue jika karakter workload berbeda.

Contoh:

```java
@Bean
SimpleRabbitListenerContainerFactory criticalWorkflowListenerFactory(
    ConnectionFactory connectionFactory,
    MessageConverter messageConverter
) {
    var factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setMessageConverter(messageConverter);
    factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
    factory.setPrefetchCount(5);
    factory.setConcurrentConsumers(1);
    factory.setMaxConcurrentConsumers(4);
    factory.setDefaultRequeueRejected(false);
    return factory;
}

@Bean
SimpleRabbitListenerContainerFactory bulkNotificationListenerFactory(
    ConnectionFactory connectionFactory,
    MessageConverter messageConverter
) {
    var factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setMessageConverter(messageConverter);
    factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
    factory.setPrefetchCount(100);
    factory.setConcurrentConsumers(4);
    factory.setMaxConcurrentConsumers(20);
    factory.setDefaultRequeueRejected(false);
    return factory;
}
```

Usage:

```java
@RabbitListener(
    queues = "${app.rabbit.topology.queue.review-requested}",
    containerFactory = "criticalWorkflowListenerFactory"
)
public void onReviewRequested(...) { ... }

@RabbitListener(
    queues = "${app.rabbit.topology.queue.notification-email}",
    containerFactory = "bulkNotificationListenerFactory"
)
public void onEmailNotification(...) { ... }
```

---

## 27. Retry Strategy: Spring Retry vs Broker Retry

Spring AMQP mendukung retry interceptor. Tetapi gunakan dengan disiplin.

### Spring retry cocok untuk

- retry sangat pendek;
- error transient lokal;
- tidak ingin message keluar dari consumer;
- processing idempotent;
- jumlah attempt kecil.

Contoh:

```java
@Bean
SimpleRabbitListenerContainerFactory shortRetryListenerFactory(
    ConnectionFactory connectionFactory,
    MessageConverter messageConverter
) {
    var factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setMessageConverter(messageConverter);
    factory.setAcknowledgeMode(AcknowledgeMode.AUTO);
    factory.setAdviceChain(
        RetryInterceptorBuilder
            .stateless()
            .maxAttempts(3)
            .backOffOptions(100, 2.0, 1000)
            .recoverer(new RejectAndDontRequeueRecoverer())
            .build()
    );
    return factory;
}
```

### Broker DLX retry cocok untuk

- delayed retry;
- retry visibility operasional;
- retry yang bertahan walau app restart;
- parking lot;
- multi-level backoff;
- controlled replay.

Untuk critical systems, broker-level retry biasanya lebih observable.

---

## 28. DLQ Configuration in Boot Topology

Contoh queue normal + DLQ:

```java
@Bean
DirectExchange reviewDlx() {
    return ExchangeBuilder
        .directExchange("case.review.dlx")
        .durable(true)
        .build();
}

@Bean
Queue reviewRequestedQueue() {
    return QueueBuilder
        .durable("case.review.requested.q")
        .quorum()
        .deadLetterExchange("case.review.dlx")
        .deadLetterRoutingKey("case.review.requested.dead")
        .build();
}

@Bean
Queue reviewRequestedDlq() {
    return QueueBuilder
        .durable("case.review.requested.dlq")
        .quorum()
        .build();
}

@Bean
Binding reviewRequestedDlqBinding(Queue reviewRequestedDlq, DirectExchange reviewDlx) {
    return BindingBuilder
        .bind(reviewRequestedDlq)
        .to(reviewDlx)
        .with("case.review.requested.dead");
}
```

Untuk delayed retry TTL:

```java
@Bean
Queue reviewRequestedRetry10sQueue() {
    return QueueBuilder
        .durable("case.review.requested.retry.10s.q")
        .quorum()
        .ttl(10_000)
        .deadLetterExchange("case.events.x")
        .deadLetterRoutingKey("case.review.requested")
        .build();
}
```

Tetapi hati-hati: retry queue juga perlu binding dari DLX/retry exchange.

---

## 29. Environment Profiles

Contoh profile local:

```yaml
# application-local.yml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: app_case
    password: app_case_password
    virtual-host: case-platform

app:
  rabbit:
    topology:
      declare-topology: true
```

Staging:

```yaml
# application-staging.yml
spring:
  rabbitmq:
    addresses: rabbitmq-staging-1:5672,rabbitmq-staging-2:5672,rabbitmq-staging-3:5672
    username: ${RABBITMQ_USERNAME}
    password: ${RABBITMQ_PASSWORD}
    virtual-host: case-platform-staging

app:
  rabbit:
    topology:
      declare-topology: false
```

Production:

```yaml
# application-prod.yml
spring:
  rabbitmq:
    addresses: rabbitmq-prod-1:5671,rabbitmq-prod-2:5671,rabbitmq-prod-3:5671
    username: ${RABBITMQ_USERNAME}
    password: ${RABBITMQ_PASSWORD}
    virtual-host: case-platform-prod
    ssl:
      enabled: true

app:
  rabbit:
    topology:
      declare-topology: false
```

---

## 30. Secrets and Credentials

Jangan simpan credentials di Git.

Gunakan:

- environment variables;
- Kubernetes Secret;
- Vault;
- cloud secret manager;
- externalized config.

Production principle:

```text
Application identity should have minimal RabbitMQ permissions.
```

Untuk publisher service:

```text
configure: none or limited
write: exchanges it publishes to
read: none unless it consumes
```

Untuk consumer service:

```text
configure: none or limited
write: maybe DLX/retry exchange if republishing
read: queues it consumes
```

Di local, permission bisa luas. Di production, jangan.

---

## 31. TLS Configuration

Spring Boot:

```yaml
spring:
  rabbitmq:
    host: rabbitmq-prod
    port: 5671
    ssl:
      enabled: true
      validate-server-certificate: true
      verify-hostname: true
```

Jika memakai truststore:

```yaml
spring:
  rabbitmq:
    ssl:
      enabled: true
      trust-store: classpath:certs/rabbitmq-truststore.p12
      trust-store-password: ${RABBITMQ_TRUSTSTORE_PASSWORD}
      trust-store-type: PKCS12
```

Security checklist:

- TLS aktif untuk production;
- hostname verification aktif;
- password tidak di-log;
- management UI tidak publik;
- vhost per bounded context/tenant jika diperlukan;
- credentials rotate-able.

---

## 32. Health Check

Spring Boot Actuator dapat mengecek RabbitMQ connection.

Namun health check harus hati-hati.

`UP` artinya aplikasi bisa connect. Itu tidak berarti:

- exchange ada;
- queue ada;
- binding benar;
- DLQ ada;
- publish confirm bekerja;
- consumer tidak stuck;
- queue depth sehat.

Tambahkan readiness check untuk topology critical.

```java
@Component
public class RabbitReadinessIndicator implements HealthIndicator {

    private final RabbitAdmin rabbitAdmin;
    private final RabbitTopologyProperties props;

    public RabbitReadinessIndicator(RabbitAdmin rabbitAdmin, RabbitTopologyProperties props) {
        this.rabbitAdmin = rabbitAdmin;
        this.props = props;
    }

    @Override
    public Health health() {
        try {
            var queueProps = rabbitAdmin.getQueueProperties(props.getQueue().getReviewRequested());
            if (queueProps == null) {
                return Health.down()
                    .withDetail("missingQueue", props.getQueue().getReviewRequested())
                    .build();
            }
            return Health.up().build();
        } catch (Exception e) {
            return Health.down(e).build();
        }
    }
}
```

Kubernetes note:

- liveness jangan terlalu agresif;
- readiness boleh turun saat RabbitMQ unavailable;
- jangan restart app terus-menerus untuk masalah broker sementara.

---

## 33. Metrics and Observation

Minimal metrics yang perlu tersedia dari aplikasi:

Publisher:

```text
messages_published_total
messages_publish_confirmed_total
messages_publish_nacked_total
messages_returned_total
publish_confirm_latency
outbox_pending_count
outbox_oldest_pending_age
```

Consumer:

```text
messages_consumed_total
messages_ack_total
messages_rejected_total
messages_failed_total
message_processing_duration
message_duplicate_total
message_conversion_failed_total
```

Operational:

```text
rabbitmq_connection_status
listener_container_active
listener_consumer_count
```

Gunakan Micrometer:

```java
@Component
public class MessagingMetrics {

    private final Counter consumed;
    private final Counter failed;

    public MessagingMetrics(MeterRegistry registry) {
        this.consumed = Counter.builder("app.rabbit.messages.consumed")
            .description("Messages consumed from RabbitMQ")
            .register(registry);
        this.failed = Counter.builder("app.rabbit.messages.failed")
            .description("RabbitMQ message handling failures")
            .register(registry);
    }

    public void markConsumed() {
        consumed.increment();
    }

    public void markFailed() {
        failed.increment();
    }
}
```

---

## 34. Logging Discipline

Jangan log seluruh payload secara default.

Log metadata:

```text
message_id
correlation_id
causation_id
routing_key
exchange
queue
consumer
redelivered
x-death count
schema_version
case_id if not sensitive
```

Contoh:

```java
log.info(
    "Consumed RabbitMQ message messageId={} correlationId={} routingKey={} redelivered={}",
    props.getMessageId(),
    props.getCorrelationId(),
    props.getReceivedRoutingKey(),
    props.isRedelivered()
);
```

Untuk regulatory system, payload mungkin mengandung data sensitif. Gunakan:

- structured logging;
- masking;
- sampling;
- secure forensic storage jika perlu;
- log retention policy.

---

## 35. Trace Propagation

RabbitMQ message harus membawa trace context.

Headers umum:

```text
traceparent
tracestate
correlation_id
causation_id
```

Publisher harus inject trace header. Consumer harus extract dan melanjutkan span.

Jika memakai observability framework modern, sebagian bisa otomatis. Tetapi tetap pastikan semantic ID ada:

- `correlation_id` untuk business/process tracing;
- `traceparent` untuk distributed tracing;
- `message_id` untuk deduplication/forensics.

---

## 36. Idempotency Repository Pattern

Consumer production-grade harus tahan duplicate.

Schema sederhana:

```sql
create table processed_message (
    message_id varchar(100) primary key,
    consumer_name varchar(200) not null,
    processed_at timestamp not null,
    correlation_id varchar(100),
    message_type varchar(200)
);
```

Repository:

```java
public interface ProcessedMessageRepository {
    boolean existsByMessageIdAndConsumerName(String messageId, String consumerName);
    void save(ProcessedMessage record);
}
```

Handler:

```java
@Transactional
public void handle(EvidenceSubmittedMessage message, MessageProperties properties) {
    String consumerName = "case-management:evidence-submitted";

    if (processedMessageRepository.existsByMessageIdAndConsumerName(
        message.messageId(), consumerName
    )) {
        return;
    }

    applicationService.applyEvidenceSubmitted(message);

    processedMessageRepository.save(new ProcessedMessage(
        message.messageId(),
        consumerName,
        Instant.now(),
        message.correlationId(),
        "case.evidence.submitted"
    ));
}
```

Penting: save idempotency marker sebaiknya berada dalam transaction yang sama dengan state mutation.

---

## 37. Transaction Boundary: DB Commit dan Ack

Pattern yang benar:

```text
receive message
  -> start DB transaction
  -> check idempotency
  -> mutate state
  -> write idempotency marker
  -> commit DB transaction
  -> ack message
```

Jika crash setelah DB commit sebelum ack:

```text
message redelivered
  -> idempotency marker exists
  -> no duplicate mutation
  -> ack
```

Jika ack sebelum DB commit:

```text
ack message
  -> crash before commit
  -> message lost from queue
  -> state not updated
```

Jadi untuk at-least-once safe processing:

```text
commit first, ack second
```

Dengan konsekuensi duplicate harus diterima dan ditangani.

---

## 38. Manual Ack Listener Full Example

```java
@Component
public class ReviewRequestedListener {

    private static final Logger log = LoggerFactory.getLogger(ReviewRequestedListener.class);

    private final ReviewRequestedHandler handler;

    public ReviewRequestedListener(ReviewRequestedHandler handler) {
        this.handler = handler;
    }

    @RabbitListener(
        queues = "${app.rabbit.topology.queue.review-requested}",
        containerFactory = "criticalWorkflowListenerFactory"
    )
    public void onMessage(
        ReviewRequestedMessage message,
        Message raw,
        Channel channel
    ) throws IOException {
        MessageProperties properties = raw.getMessageProperties();
        long deliveryTag = properties.getDeliveryTag();

        try {
            log.info(
                "Received review request messageId={} correlationId={} redelivered={}",
                properties.getMessageId(),
                properties.getCorrelationId(),
                properties.isRedelivered()
            );

            handler.handle(message, properties);

            channel.basicAck(deliveryTag, false);
        } catch (PermanentMessageException e) {
            log.warn(
                "Permanent message failure messageId={} reason={}",
                properties.getMessageId(),
                e.getMessage()
            );
            channel.basicReject(deliveryTag, false);
        } catch (RetryableMessageException e) {
            log.warn(
                "Retryable message failure messageId={} reason={}",
                properties.getMessageId(),
                e.getMessage()
            );
            channel.basicReject(deliveryTag, false);
        } catch (Exception e) {
            log.error(
                "Unknown message failure messageId={}",
                properties.getMessageId(),
                e
            );
            channel.basicReject(deliveryTag, false);
        }
    }
}
```

Potential improvement:

- classify exception centrally;
- emit metric;
- enrich MDC;
- handle `IOException` from ack carefully;
- avoid blocking network calls inside DB transaction.

---

## 39. MDC Enrichment

MDC membantu semua log dalam satu processing message punya correlation.

```java
public final class MessagingMdc {

    private MessagingMdc() {}

    public static void put(MessageProperties properties) {
        MDC.put("message_id", properties.getMessageId());
        MDC.put("correlation_id", properties.getCorrelationId());
        MDC.put("routing_key", properties.getReceivedRoutingKey());
    }

    public static void clear() {
        MDC.remove("message_id");
        MDC.remove("correlation_id");
        MDC.remove("routing_key");
    }
}
```

Usage:

```java
try {
    MessagingMdc.put(properties);
    handler.handle(message, properties);
    channel.basicAck(deliveryTag, false);
} finally {
    MessagingMdc.clear();
}
```

---

## 40. Testing With Testcontainers

Testcontainers memungkinkan integration test dengan RabbitMQ nyata.

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
        registry.add("spring.rabbitmq.virtual-host", () -> "/");
        registry.add("app.rabbit.topology.declare-topology", () -> "true");
    }

    @Autowired
    RabbitTemplate rabbitTemplate;

    @Test
    void shouldRouteEvidenceSubmittedMessage() {
        // publish test message
        // wait until consumer processes
        // assert DB state
    }
}
```

Use Awaitility for async assertion:

```java
await()
    .atMost(Duration.ofSeconds(10))
    .untilAsserted(() -> {
        assertThat(repository.findByEvidenceId("ev-123")).isPresent();
    });
```

---

## 41. Topology Assertion Test

Test bahwa queue ada.

```java
@SpringBootTest
class RabbitTopologyTest {

    @Autowired
    RabbitAdmin rabbitAdmin;

    @Autowired
    RabbitTopologyProperties props;

    @Test
    void shouldDeclareReviewRequestedQueue() {
        var queueProps = rabbitAdmin.getQueueProperties(props.getQueue().getReviewRequested());
        assertThat(queueProps).isNotNull();
    }
}
```

Untuk binding/exchange type, gunakan HTTP API atau management client. Minimal queue existence test sudah lebih baik daripada tidak ada validasi sama sekali.

---

## 42. DLQ Test

Test bahwa permanent failure masuk DLQ.

Pseudo-flow:

```text
publish invalid message to normal exchange
consumer rejects without requeue
broker dead-letters to DLQ
assert DLQ contains message
```

Example skeleton:

```java
@Test
void invalidMessageShouldGoToDlq() {
    rabbitTemplate.convertAndSend(
        "case.events.x",
        "case.review.requested",
        invalidPayload
    );

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        Object dlqMessage = rabbitTemplate.receiveAndConvert("case.review.requested.dlq");
        assertThat(dlqMessage).isNotNull();
    });
}
```

Caveat: consuming from DLQ in test removes message. Itu tidak masalah jika test isolated.

---

## 43. Publisher Return Test

Test unroutable publish.

```java
@Test
void unroutableMessageShouldTriggerReturn() {
    AtomicReference<ReturnedMessage> returnedRef = new AtomicReference<>();

    rabbitTemplate.setReturnsCallback(returnedRef::set);
    rabbitTemplate.setMandatory(true);

    rabbitTemplate.convertAndSend(
        "case.events.x",
        "no.such.routing.key",
        new EvidenceSubmittedMessage(...)
    );

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertThat(returnedRef.get()).isNotNull();
    });
}
```

Test ini memastikan `mandatory` dan returns aktif.

---

## 44. Publish Confirm Test

```java
@Test
void publishShouldBeConfirmed() throws Exception {
    CorrelationData correlationData = new CorrelationData(UUID.randomUUID().toString());

    rabbitTemplate.convertAndSend(
        "case.events.x",
        "case.evidence.submitted",
        new EvidenceSubmittedMessage(...),
        correlationData
    );

    CorrelationData.Confirm confirm = correlationData
        .getFuture()
        .get(5, TimeUnit.SECONDS);

    assertThat(confirm.isAck()).isTrue();
}
```

Ini bukan pengganti outbox test, tetapi memvalidasi publisher confirm plumbing.

---

## 45. Consumer Crash Simulation

Salah satu test paling penting:

```text
consumer processes DB commit
consumer crashes before ack
message redelivered
idempotency prevents duplicate mutation
message acked
```

Sulit dilakukan full otomatis, tetapi bisa disimulasikan di handler:

```java
if (testFaultInjector.crashAfterCommitBeforeAck(message.messageId())) {
    throw new SimulatedCrashException();
}
```

Lalu assert:

- DB mutation hanya sekali;
- message akhirnya acked setelah retry/redelivery;
- idempotency marker ada;
- no duplicate side effect.

---

## 46. Feature Toggle untuk Listener Startup

Kadang migration butuh service publish aktif tetapi consume belum aktif.

Spring property:

```yaml
app:
  rabbit:
    listeners:
      review-requested-enabled: true
```

Annotation:

```java
@RabbitListener(
    queues = "${app.rabbit.topology.queue.review-requested}",
    autoStartup = "${app.rabbit.listeners.review-requested-enabled:true}"
)
public void onMessage(...) { ... }
```

Use case:

- blue-green deployment;
- consumer warm-up;
- controlled replay;
- temporary pause without deleting queue.

---

## 47. Multiple RabbitMQ Clusters

Kadang satu aplikasi perlu connect ke lebih dari satu RabbitMQ cluster/vhost. Jangan pakai auto-config default saja.

Buat named connection factory:

```java
@Bean
@ConfigurationProperties("app.rabbit.primary")
RabbitProperties primaryRabbitProperties() {
    return new RabbitProperties();
}

@Bean
@ConfigurationProperties("app.rabbit.audit")
RabbitProperties auditRabbitProperties() {
    return new RabbitProperties();
}
```

Lalu buat `ConnectionFactory`, `RabbitTemplate`, dan listener factory terpisah.

Prinsip:

```text
One broker boundary = one named configuration set.
```

Jangan campurkan audit stream dan command queue tanpa penamaan jelas.

---

## 48. Message Size Policy

Spring Boot membuat publish object mudah. Itu bisa memancing engineer mengirim payload besar.

Rule praktis:

- RabbitMQ message sebaiknya kecil-menengah;
- jangan kirim file besar;
- jangan kirim binary evidence;
- simpan object besar di storage, kirim reference;
- sertakan checksum/version jika perlu.

Buruk:

```json
{
  "caseId": "case-123",
  "pdfBase64": "...very huge..."
}
```

Lebih baik:

```json
{
  "messageId": "msg-123",
  "caseId": "case-123",
  "evidenceId": "ev-456",
  "documentUri": "s3://bucket/evidence/ev-456.pdf",
  "sha256": "...",
  "occurredAt": "2026-06-19T10:00:00Z"
}
```

---

## 49. Boot Auto-Configuration: Useful But Know Its Edges

Spring Boot AMQP auto-config akan membuat banyak bean jika dependency ada:

- `ConnectionFactory`;
- `RabbitTemplate`;
- `AmqpAdmin`;
- listener container factory;
- message converter jika tersedia.

Itu bagus untuk default, tetapi untuk production:

- review semua `spring.rabbitmq.*` properties;
- override `RabbitTemplate` untuk mandatory/confirm callbacks;
- override listener factory untuk ack, prefetch, concurrency;
- define topology declarables intentionally;
- add health/readiness validation;
- add integration tests.

---

## 50. Common Spring Boot RabbitMQ Anti-Patterns

### Anti-pattern 1 — `@RabbitListener` langsung panggil domain complex logic

Masalah:

- sulit test;
- ack boundary kabur;
- retry classification kabur.

Fix:

- listener as adapter;
- handler/use case as business boundary.

### Anti-pattern 2 — Auto ack untuk critical workflow

Masalah:

- message bisa hilang saat processing gagal.

Fix:

- manual ack;
- commit DB sebelum ack;
- idempotency.

### Anti-pattern 3 — `defaultRequeueRejected=true`

Masalah:

- poison message loop;
- CPU spike;
- broker churn.

Fix:

- `defaultRequeueRejected=false`;
- DLQ/retry topology.

### Anti-pattern 4 — Hardcoded topology names

Masalah:

- typo;
- sulit profile;
- sulit audit.

Fix:

- typed properties;
- central names.

### Anti-pattern 5 — Publish tanpa confirm/return

Masalah:

- false sense of delivery.

Fix:

- correlated confirms;
- returns;
- outbox untuk critical event.

### Anti-pattern 6 — Java class as external contract

Masalah:

- producer/consumer tightly coupled;
- refactor class merusak integration.

Fix:

- semantic message type;
- schema version;
- stable JSON/Avro/Protobuf contract.

### Anti-pattern 7 — Satu listener factory untuk semua workload

Masalah:

- bulk task bisa mengganggu critical workflow.

Fix:

- per workload listener factory.

### Anti-pattern 8 — Test hanya unit test handler

Masalah:

- routing, converter, DLQ, confirm tidak pernah diuji.

Fix:

- Testcontainers integration tests.

---

## 51. Production Deployment Checklist

Sebelum deploy Spring Boot + RabbitMQ service ke production, jawab ini:

### Connection

- Apakah host/addresses production benar?
- Apakah TLS aktif?
- Apakah credentials dari secret manager?
- Apakah vhost benar?
- Apakah permission minimal?

### Topology

- Apakah exchange/queue/binding sudah ada?
- Apakah queue type benar?
- Apakah DLQ dan retry queue ada?
- Apakah application declare topology atau hanya validate?
- Apakah topology change versioned?

### Publisher

- Apakah publisher confirms aktif?
- Apakah returns aktif?
- Apakah mandatory publish aktif?
- Apakah critical events memakai outbox?
- Apakah confirm timeout ditangani?
- Apakah unroutable message alerting ada?

### Consumer

- Apakah manual ack untuk workflow penting?
- Apakah prefetch bounded?
- Apakah concurrency sesuai downstream?
- Apakah idempotency ada?
- Apakah duplicate safe?
- Apakah poison message masuk DLQ/parking?

### Contract

- Apakah message schema stable?
- Apakah schema version ada?
- Apakah correlation id ada?
- Apakah message id stable?
- Apakah payload tidak membawa JPA/domain object?

### Observability

- Apakah metrics publish/consume/fail ada?
- Apakah queue depth monitored dari RabbitMQ?
- Apakah DLQ spike alert ada?
- Apakah correlation id muncul di log?
- Apakah tracing propagated?

### Testing

- Apakah route test ada?
- Apakah DLQ test ada?
- Apakah confirm test ada?
- Apakah redelivery/idempotency test ada?
- Apakah contract compatibility test ada?

---

## 52. Case Study: Review Requested Workflow

### Requirement

Ketika case membutuhkan review:

1. service A publish event `case.review.requested`;
2. service B consume event;
3. service B membuat review task;
4. duplicate event tidak boleh membuat task ganda;
5. invalid event masuk DLQ;
6. temporary DB error retry;
7. audit harus bisa melihat message id dan correlation id.

### Topology

```text
Exchange:
  case.events.x              topic
  case.review.dlx            direct

Queue:
  case.review.requested.q     quorum
  case.review.requested.dlq   quorum

Binding:
  case.events.x -- case.review.requested --> case.review.requested.q
  case.review.dlx -- case.review.requested.dead --> case.review.requested.dlq
```

### Consumer strategy

```text
manual ack
prefetch=5
concurrency=1..4
commit DB before ack
idempotency by message_id + consumer_name
reject without requeue on error
DLX handles failure path
```

### Handler transaction

```text
begin transaction
  if processed_message exists: return
  if case not found: permanent failure or compensation path
  create review task if not exists
  insert processed_message
commit
ack
```

### Failure scenarios

#### DB deadlock

```text
handler throws RetryableMessageException
listener rejects without requeue
message goes DLQ/retry path
later redelivered
idempotency protects duplicate
```

#### Invalid schema

```text
conversion/validation fails
error handler rejects
message goes DLQ
operator inspects
fix producer or replay transformed message
```

#### Crash after commit before ack

```text
RabbitMQ redelivers
handler sees processed_message
no duplicate task
ack
```

#### Routing typo

```text
publisher gets returned message
outbox marks FAILED_UNROUTABLE
alert triggers topology/producer fix
```

---

## 53. Local Lab Exercise

Gunakan local lab dari part 05.

### Exercise 1 — Boot app declares topology

- Jalankan RabbitMQ Docker.
- Jalankan Spring Boot dengan `declare-topology=true`.
- Cek Management UI.
- Pastikan exchange, queue, binding ada.

### Exercise 2 — Publish with confirm

- Publish event dari REST endpoint.
- Tunggu confirm.
- Simpan outbox state.
- Matikan RabbitMQ dan lihat timeout behavior.

### Exercise 3 — Consumer manual ack

- Publish valid message.
- Pastikan DB berubah.
- Pastikan queue kosong.

### Exercise 4 — Invalid message to DLQ

- Publish JSON invalid.
- Pastikan masuk DLQ.
- Inspect `x-death`.

### Exercise 5 — Duplicate delivery

- Publish message dengan same `messageId` dua kali.
- Pastikan business mutation hanya sekali.

### Exercise 6 — Prefetch observation

- Set prefetch 1, concurrency 1.
- Publish 100 messages.
- Tambahkan sleep 1 detik di handler.
- Amati unacked.
- Naikkan prefetch dan concurrency.
- Amati efeknya.

---

## 54. Review Questions

1. Kenapa `@RabbitListener` saja belum cukup untuk production reliability?
2. Apa bedanya publisher confirm dan consumer ack?
3. Kenapa `defaultRequeueRejected=true` berbahaya?
4. Kapan topology boleh dideklarasikan oleh aplikasi?
5. Kenapa production sering lebih baik memakai infrastructure-declared topology?
6. Apa konsekuensi timeout saat menunggu publisher confirm?
7. Kenapa idempotency marker harus satu transaction dengan business mutation?
8. Kenapa listener factory sebaiknya dipisah per workload?
9. Apa perbedaan Spring Retry dan broker DLX retry?
10. Apa yang harus diuji dengan Testcontainers?
11. Kenapa Java class name tidak boleh menjadi message contract eksternal?
12. Bagaimana memastikan unroutable message tidak hilang diam-diam?
13. Apa hubungan prefetch, concurrency, dan downstream overload?
14. Kenapa health check RabbitMQ tidak cukup untuk menyatakan topology sehat?
15. Bagaimana desain consumer agar aman terhadap crash after commit before ack?

---

## 55. Ringkasan Mental Model

Spring Boot memudahkan RabbitMQ integration, tetapi production reliability tetap bergantung pada keputusan eksplisit.

Model yang harus dipegang:

```text
Spring Boot convenience != messaging correctness
```

Production-grade integration membutuhkan:

```text
Typed configuration
  + explicit topology
  + publisher confirm/return
  + manual consumer ack
  + idempotent handler
  + DLQ/retry strategy
  + bounded prefetch/concurrency
  + observability
  + integration tests
```

Jika satu bagian hilang, sistem mungkin tetap “jalan”, tetapi tidak defensible saat terjadi incident.

---

## 56. Apa Yang Sudah Dikuasai Setelah Part Ini

Setelah part ini, kamu harus bisa:

- menstrukturkan Spring Boot project dengan RabbitMQ secara bersih;
- mengatur connection, publisher, listener, converter, topology;
- membedakan local/test/prod topology strategy;
- membuat publisher yang sadar confirm dan return;
- membuat consumer manual ack yang idempotent;
- mendesain listener factory per workload;
- memilih retry strategy Spring vs broker;
- menambahkan health/readiness/metrics/logging/tracing;
- menguji RabbitMQ integration dengan Testcontainers;
- melakukan review desain Spring Boot RabbitMQ sebelum production.

---

## 57. Status Seri

Part selesai:

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
- Part 11 — Spring Boot Integration Patterns

Seri belum selesai.

Part berikutnya:

- Part 12 — Message Contract Design untuk Java Systems


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-10.md">⬅️ Part 10 — Spring AMQP Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-12.md">Part 12 — Message Contract Design untuk Java Systems ➡️</a>
</div>

# Part 22 — Spring Messaging: JMS, AMQP/RabbitMQ, Kafka, and Integration Boundary

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `22-spring-messaging-jms-amqp-kafka-boundary.md`  
> Status seri: Part 22 dari 35 — belum selesai  
> Target pembaca: engineer Java/Spring senior yang ingin memahami messaging boundary secara production-grade, bukan hanya cara menulis `@KafkaListener`, `@RabbitListener`, atau `@JmsListener`.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- Spring runtime;
- IoC container;
- dependency resolution;
- lifecycle;
- configuration;
- auto-configuration;
- startup diagnostics;
- AOP/proxy;
- transaction;
- Spring Data;
- Web MVC;
- REST API;
- WebFlux;
- HTTP clients;
- validation;
- error handling;
- Spring Security;
- caching;
- async/scheduling/events;
- virtual threads dan concurrency.

Sekarang kita masuk ke **Spring Messaging**.

Namun part ini **tidak akan mengulang teori messaging umum** seperti:

- apa itu queue;
- apa itu topic;
- apa itu pub/sub;
- apa itu Kafka partition;
- apa itu RabbitMQ exchange;
- apa itu JMS secara dasar;
- apa itu at-least-once delivery;
- apa itu exactly-once secara konseptual.

Itu semua diasumsikan sudah cukup dipahami dari seri messaging/microservices sebelumnya.

Part ini akan fokus pada pertanyaan yang lebih penting untuk engineer Spring enterprise:

> Ketika sebuah message masuk ke aplikasi Spring, siapa yang mengambil message, thread mana yang menjalankan listener, kapan ack/commit terjadi, kapan retry terjadi, kapan message dianggap gagal, kapan transaction ikut bekerja, dan bagaimana kita memastikan consumer tetap idempotent, observable, serta aman saat failure?

Tujuan akhirnya:

1. Anda memahami **Spring sebagai adapter layer** di atas broker/protokol messaging.
2. Anda memahami perbedaan boundary antara:
   - JMS;
   - AMQP/RabbitMQ;
   - Kafka;
   - Spring Messaging abstraction;
   - Spring Integration;
   - Spring Cloud Stream.
3. Anda mampu mendesain listener yang:
   - idempotent;
   - transactional secara benar;
   - punya retry/DLQ strategy;
   - observable;
   - tidak menyebabkan retry storm;
   - tidak menahan consumer thread terlalu lama;
   - tidak membuat duplicate side effect.
4. Anda mampu melakukan debugging production ketika message:
   - hilang;
   - dobel diproses;
   - stuck;
   - terus retry;
   - masuk DLQ;
   - out-of-order;
   - menyebabkan database inconsistency.

---

## 2. Mental Model Utama: Messaging Adalah Delivery Boundary, Bukan Function Call

Kesalahan paling umum dalam aplikasi Spring berbasis messaging adalah memperlakukan listener seperti method biasa.

Contoh keliru:

```java
@KafkaListener(topics = "payment-approved")
public void onPaymentApproved(PaymentApproved event) {
    invoiceService.createInvoice(event);
    emailClient.sendInvoiceEmail(event.customerEmail());
}
```

Secara bentuk, ini tampak seperti callback sederhana.

Namun secara sistem, method itu bukan sekadar method. Ia adalah **delivery boundary**.

Di balik method tersebut ada:

```text
Broker
  ↓
Consumer connection/session
  ↓
Listener container
  ↓
Thread/executor
  ↓
Message conversion
  ↓
Listener method invocation
  ↓
Transaction / ack / offset commit
  ↓
Retry / DLQ / requeue / rollback
```

Artinya, listener method adalah titik pertemuan antara:

1. sistem eksternal broker;
2. thread runtime aplikasi;
3. serializer/deserializer;
4. transaction manager;
5. error handler;
6. retry policy;
7. idempotency store;
8. downstream side effect;
9. observability;
10. shutdown lifecycle.

Di REST API, boundary-nya adalah HTTP request.

Di messaging, boundary-nya adalah **message delivery attempt**.

Itu berbeda.

HTTP request biasanya punya caller yang menunggu response.

Message biasanya tidak punya caller yang menunggu response secara langsung. Broker akan mengatur redelivery, offset, ack, requeue, atau DLQ berdasarkan kontrak consumer.

Karena itu listener tidak boleh didesain seperti ini:

```text
message masuk → panggil service → selesai
```

Tetapi harus didesain seperti ini:

```text
message delivery attempt
  → validate envelope
  → check duplicate/idempotency
  → start transactional boundary if needed
  → apply business state transition
  → record side effect intent
  → commit database state
  → ack/commit message position
  → emit metrics/audit/trace
  → if failure: classify retryable vs non-retryable
```

---

## 3. Spring Messaging Abstractions: Apa yang Sama, Apa yang Berbeda

Spring menyediakan beberapa lapisan messaging:

| Layer | Contoh | Fungsi |
|---|---|---|
| Spring Messaging | `Message<T>`, `MessageHeaders`, `MessageChannel` | Abstraksi message umum |
| Spring JMS | `JmsTemplate`, `@JmsListener` | Integrasi JMS provider seperti ActiveMQ/Artemis/IBM MQ |
| Spring AMQP | `RabbitTemplate`, `@RabbitListener` | Integrasi AMQP/RabbitMQ |
| Spring Kafka | `KafkaTemplate`, `@KafkaListener` | Integrasi Apache Kafka |
| Spring Integration | flow/channel/router/transformer | Enterprise Integration Patterns |
| Spring Cloud Stream | binder abstraction | Abstraksi event streaming untuk binder seperti Kafka/Rabbit |

Mental model yang perlu dijaga:

```text
Spring Messaging abstraction ≠ broker semantics
```

Spring bisa membuat API terasa seragam, tetapi tidak bisa menghapus perbedaan fundamental antar broker.

Contoh:

| Aspek | JMS | RabbitMQ/AMQP | Kafka |
|---|---|---|---|
| Unit posisi konsumsi | message ack dalam session | delivery tag ack/nack | offset commit |
| Model utama | queue/topic API standar | exchange → queue → consumer | topic → partition → consumer group |
| Ordering | bergantung destination/provider | queue-level, tetapi concurrency bisa mengubah | partition-level |
| Redelivery | provider-specific | requeue/DLQ via broker policy | offset belum commit atau seek retry |
| Retention | queue menyimpan sampai consumed/expired | queue menyimpan sampai ack/expired/dead-letter | log retention independent dari consumer |
| Consumer scaling | listener concurrency/provider | competing consumers | partition assignment |
| Transaction | JMS session/JTA/local | channel transaction atau publisher confirm; DB transaction terpisah | Kafka transaction/offset transaction; DB transaction tetap isu tersendiri |

Spring membantu mengintegrasikan semua ini, tetapi correctness tetap tanggung jawab desain aplikasi.

---

## 4. Canonical Consumer Pipeline

Sebelum membahas JMS/Rabbit/Kafka, kita definisikan pipeline umum listener Spring.

```text
[1] Broker has a message
    ↓
[2] Listener container fetches/receives message
    ↓
[3] Container assigns delivery to thread
    ↓
[4] Message is converted/deserialized
    ↓
[5] Listener method is invoked
    ↓
[6] Application logic executes
    ↓
[7] Result/failure is interpreted
    ↓
[8] Ack / commit / rollback / nack / requeue / DLQ happens
    ↓
[9] Metrics/logs/traces are emitted
```

Setiap step punya failure mode.

| Step | Failure | Efek |
|---|---|---|
| receive | broker unavailable | consumer reconnect/backoff |
| deserialize | invalid schema/payload | poison message risk |
| validate | missing required field | reject/DLQ/non-retryable |
| business logic | DB conflict/deadlock | retryable tergantung kasus |
| external call | timeout/5xx | retryable tapi harus dikontrol |
| commit DB | failure | message biasanya tidak boleh di-ack |
| ack/offset commit | failure | duplicate processing risk |
| shutdown | in-flight interrupted | redelivery risk |

Top 1% engineer tidak bertanya “bagaimana membuat listener?”, tetapi:

> Untuk setiap failure point, apakah message akan diproses ulang, dibuang, diparkir, atau menghasilkan side effect dobel?

---

## 5. Listener Container: Komponen yang Sering Dilupakan

Annotation seperti `@KafkaListener`, `@RabbitListener`, dan `@JmsListener` tidak bekerja sendirian.

Mereka digerakkan oleh **listener container**.

Listener container bertanggung jawab atas:

1. membuka connection/session/channel/consumer;
2. mengambil message;
3. mengatur thread/concurrency;
4. memanggil listener method;
5. mengatur ack/commit/rollback;
6. menjalankan error handler;
7. melakukan recovery ketika broker bermasalah;
8. berhenti dengan graceful saat application shutdown.

Secara mental:

```text
@Listener annotation = deklarasi endpoint
Listener container   = runtime engine
Broker client        = protocol implementation
```

Maka ketika terjadi problem, jangan hanya melihat listener method. Lihat juga:

- container factory;
- concurrency;
- ack mode;
- transaction manager;
- error handler;
- message converter;
- backoff/retry;
- shutdown timeout;
- prefetch/poll/batch setting.

---

## 6. JMS with Spring

### 6.1 Kapan JMS Masih Relevan?

JMS tetap banyak dipakai di enterprise karena:

- standar Java API;
- integrasi kuat dengan app server/legacy enterprise;
- provider mature seperti IBM MQ, ActiveMQ Artemis, Oracle AQ, WebLogic JMS;
- dukungan queue/topic;
- dukungan transaksi JMS/JTA;
- penggunaan luas dalam sektor finansial, pemerintahan, telco, insurance.

Dalam aplikasi Spring modern, JMS biasanya muncul saat:

1. sistem lama expose queue JMS;
2. organisasi menggunakan IBM MQ/Artemis sebagai enterprise broker;
3. aplikasi perlu interop dengan platform Java EE/Jakarta EE lama;
4. transaksi XA/JTA masih diwajibkan;
5. message pattern cenderung command/work queue, bukan event stream retention.

### 6.2 Komponen Spring JMS

Komponen utama:

| Komponen | Fungsi |
|---|---|
| `JmsTemplate` | mengirim/menerima message secara programmatic |
| `@JmsListener` | deklarasi listener method |
| `DefaultMessageListenerContainer` | listener container umum dan powerful |
| `SimpleMessageListenerContainer` | container lebih sederhana |
| `MessageConverter` | konversi object ↔ JMS message |
| `JmsTransactionManager` | transaksi lokal JMS session |
| `JtaTransactionManager` | transaksi XA/JTA |

Contoh producer sederhana:

```java
@Service
public class InvoiceCommandPublisher {

    private final JmsTemplate jmsTemplate;

    public InvoiceCommandPublisher(JmsTemplate jmsTemplate) {
        this.jmsTemplate = jmsTemplate;
    }

    public void requestInvoiceGeneration(GenerateInvoiceCommand command) {
        jmsTemplate.convertAndSend("invoice.generate.queue", command, message -> {
            message.setStringProperty("eventType", "GenerateInvoiceCommand");
            message.setStringProperty("schemaVersion", "1");
            message.setStringProperty("correlationId", command.correlationId());
            return message;
        });
    }
}
```

Contoh consumer:

```java
@Component
public class InvoiceCommandListener {

    private final InvoiceApplicationService invoiceApplicationService;

    public InvoiceCommandListener(InvoiceApplicationService invoiceApplicationService) {
        this.invoiceApplicationService = invoiceApplicationService;
    }

    @JmsListener(destination = "invoice.generate.queue", containerFactory = "invoiceJmsListenerContainerFactory")
    public void onGenerateInvoice(GenerateInvoiceCommand command) {
        invoiceApplicationService.generateInvoice(command);
    }
}
```

### 6.3 JMS Listener Container Mental Model

JMS listener container bekerja dengan konsep:

```text
ConnectionFactory
  → Connection
    → Session
      → MessageConsumer
        → MessageListener
```

`DefaultMessageListenerContainer` biasanya dipakai karena lebih fleksibel untuk:

- dynamic scaling;
- transaction participation;
- recovery;
- cache level;
- concurrency control.

Spring docs menjelaskan bahwa message listener container bertanggung jawab untuk menerima message, menjalankan listener, threading, transaction participation, resource acquisition/release, dan exception conversion.

### 6.4 JMS Ack and Transaction

Pada JMS, ack berkaitan dengan `Session`.

Mode umum:

| Mode | Makna |
|---|---|
| `AUTO_ACKNOWLEDGE` | provider mengakui message otomatis setelah listener berhasil |
| `CLIENT_ACKNOWLEDGE` | aplikasi melakukan acknowledge |
| `DUPS_OK_ACKNOWLEDGE` | lazy ack, duplicate mungkin terjadi |
| transacted session | commit/rollback session menentukan ack |

Dalam Spring, Anda biasanya tidak ingin manual ack kecuali benar-benar butuh. Lebih umum:

1. listener berjalan dalam transacted session;
2. jika listener sukses, session commit;
3. jika listener throw exception, session rollback;
4. broker dapat redeliver sesuai policy.

Contoh container factory:

```java
@Configuration
class JmsListenerConfig {

    @Bean
    DefaultJmsListenerContainerFactory invoiceJmsListenerContainerFactory(
            ConnectionFactory connectionFactory,
            PlatformTransactionManager transactionManager) {

        DefaultJmsListenerContainerFactory factory = new DefaultJmsListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setTransactionManager(transactionManager);
        factory.setConcurrency("3-10");
        factory.setSessionTransacted(true);
        factory.setErrorHandler(t -> {
            // log classification, but avoid swallowing blindly
        });
        return factory;
    }
}
```

### 6.5 JMS + Database Transaction

Ada tiga model:

#### Model A — DB transaction only, JMS ack after listener success

```text
receive JMS message
  → start DB transaction
  → update DB
  → commit DB
  → listener returns
  → JMS ack/commit
```

Risk:

```text
DB committed, JMS ack fails → message redelivered → duplicate processing
```

Maka harus idempotent.

#### Model B — JMS local transaction only

```text
receive JMS message in transacted JMS session
  → update non-transactional side effect
  → commit JMS session
```

Risk:

```text
side effect succeeded, JMS rollback → duplicate side effect
```

#### Model C — XA/JTA transaction

```text
JTA transaction
  → DB resource
  → JMS resource
  → 2-phase commit
```

Kelebihan:

- atomicity lebih kuat antar DB dan JMS.

Kekurangan:

- kompleks;
- operationally heavy;
- provider-specific;
- performance overhead;
- failure recovery lebih sulit;
- tidak menyelesaikan external HTTP side effect.

Untuk banyak sistem modern, pendekatan yang lebih sering dipakai adalah:

```text
DB transaction + idempotency + outbox/inbox pattern
```

bukan XA everywhere.

### 6.6 JMS Failure Model

| Failure | Retry? | Catatan |
|---|---|---|
| transient DB deadlock | ya | bounded retry, metric |
| validation error payload | tidak | DLQ/reject |
| unknown schema version | tidak langsung | parkir/compat handling |
| downstream timeout | mungkin | jangan infinite retry |
| duplicate command | tidak | idempotency should short-circuit |
| poison message | tidak | DLQ cepat |
| broker disconnect | container recovery | jangan crash loop tanpa backoff |

---

## 7. RabbitMQ / AMQP with Spring AMQP

### 7.1 RabbitMQ Mental Model

RabbitMQ bukan hanya queue.

Model dasarnya:

```text
Producer
  → Exchange
    → Binding
      → Queue
        → Consumer
```

Spring AMQP membantu melalui:

| Komponen | Fungsi |
|---|---|
| `RabbitTemplate` | publish/request-reply |
| `@RabbitListener` | listener method |
| `SimpleRabbitListenerContainerFactory` | listener container factory |
| `SimpleMessageListenerContainer` | classic threaded container |
| `DirectMessageListenerContainer` | direct container model |
| `MessageConverter` | konversi payload |
| `RabbitAdmin` | declare exchange/queue/binding |
| `Declarables` | group declarations |
| `RetryInterceptor` | retry advice |
| `RepublishMessageRecoverer` | republish failed message |
| `DeadLetterPublishingRecoverer` | route failed message to DLX/DLQ |

### 7.2 Declaration as Infrastructure Contract

Spring AMQP dapat mendeklarasikan exchange, queue, binding:

```java
@Configuration
class RabbitTopologyConfig {

    static final String EXCHANGE = "case.events.exchange";
    static final String QUEUE = "case.assessment.queue";
    static final String DLX = "case.events.dlx";
    static final String DLQ = "case.assessment.dlq";

    @Bean
    DirectExchange caseEventsExchange() {
        return new DirectExchange(EXCHANGE, true, false);
    }

    @Bean
    Queue caseAssessmentQueue() {
        return QueueBuilder.durable(QUEUE)
                .withArgument("x-dead-letter-exchange", DLX)
                .withArgument("x-dead-letter-routing-key", "case.assessment.dead")
                .build();
    }

    @Bean
    Binding caseAssessmentBinding() {
        return BindingBuilder
                .bind(caseAssessmentQueue())
                .to(caseEventsExchange())
                .with("case.assessment.requested");
    }

    @Bean
    DirectExchange deadLetterExchange() {
        return new DirectExchange(DLX, true, false);
    }

    @Bean
    Queue caseAssessmentDlq() {
        return QueueBuilder.durable(DLQ).build();
    }

    @Bean
    Binding caseAssessmentDlqBinding() {
        return BindingBuilder
                .bind(caseAssessmentDlq())
                .to(deadLetterExchange())
                .with("case.assessment.dead");
    }
}
```

Top-tier guideline:

> Queue topology adalah infrastructure contract. Jangan biarkan topology production bergantung pada implicit declaration yang tidak direview.

Dalam enterprise, topology sebaiknya:

- terdokumentasi;
- versioned;
- ada owner;
- punya DLQ strategy;
- punya retention/TTL policy;
- punya monitoring;
- tidak berubah diam-diam saat deployment.

### 7.3 Rabbit Listener

```java
@Component
public class CaseAssessmentListener {

    private final CaseAssessmentService service;

    public CaseAssessmentListener(CaseAssessmentService service) {
        this.service = service;
    }

    @RabbitListener(
            queues = "case.assessment.queue",
            containerFactory = "caseRabbitListenerContainerFactory")
    public void onMessage(CaseAssessmentRequested event) {
        service.assess(event);
    }
}
```

Sekali lagi, annotation hanyalah endpoint declaration.

Runtime-nya berada di container.

### 7.4 RabbitMQ Ack Mode

Ack mode umum:

| Ack Mode | Makna |
|---|---|
| `AUTO` | container ack jika listener sukses; reject/nack jika exception sesuai config |
| `MANUAL` | listener memanggil ack/nack sendiri |
| `NONE` | auto-ack broker; message dianggap delivered segera |

`AUTO` sering cukup untuk kebanyakan aplikasi.

`MANUAL` cocok jika:

- Anda perlu ack setelah proses asynchronous eksternal;
- Anda perlu kontrol nack/requeue detail;
- Anda memproses batch dengan semantics khusus.

Namun manual ack memperbesar risiko:

- lupa ack;
- double ack;
- ack setelah channel closed;
- nack dengan requeue salah;
- message stuck/unacked;
- backpressure tidak terlihat.

### 7.5 Prefetch and Concurrency

RabbitMQ memiliki konsep prefetch.

```text
prefetch = jumlah message unacked yang boleh dikirim broker ke consumer
```

Jika prefetch terlalu tinggi:

- satu consumer bisa menahan banyak message;
- load distribution buruk;
- redelivery saat crash besar;
- memory meningkat;
- latency message lain naik.

Jika prefetch terlalu rendah:

- throughput turun;
- network roundtrip lebih banyak;
- consumer idle lebih sering.

Design rule:

```text
effective in-flight ≈ concurrency × prefetch
```

Contoh:

```text
concurrency = 10
prefetch    = 50
in-flight   = 500 messages
```

Jika setiap message melakukan DB update 200 ms, maka DB bisa menerima ledakan concurrency yang jauh lebih besar dari yang Anda kira.

### 7.6 Rabbit Retry and DLQ

Ada dua level retry:

#### 1. In-memory/container retry

Message dicoba ulang dalam consumer process sebelum broker melihatnya gagal.

Kelebihan:

- cepat;
- tidak menambah broker churn.

Kekurangan:

- consumer thread tertahan;
- kalau retry delay panjang, throughput turun;
- crash menghilangkan retry state.

#### 2. Broker-based retry via DLX/TTL/requeue

Message dipindah ke retry queue dengan TTL, lalu kembali ke queue utama.

Kelebihan:

- tidak menahan thread;
- lebih cocok untuk delay retry;
- visible di broker.

Kekurangan:

- topology lebih kompleks;
- ordering bisa berubah;
- perlu poison message cutoff.

Pattern umum:

```text
main queue
  → failure
  → retry-5s queue
  → retry-30s queue
  → retry-5m queue
  → parking lot / DLQ
```

### 7.7 Jangan Infinite Requeue

Anti-pattern berbahaya:

```text
listener throw exception
  → broker requeue immediately
  → listener consume again
  → fail again
  → requeue immediately
  → CPU spike, log flood, broker churn
```

Ini sering disebut retry storm.

Solusi:

1. batasi attempt;
2. bedakan retryable vs non-retryable;
3. gunakan backoff;
4. kirim poison message ke DLQ/parking lot;
5. tambahkan metric per failure classification.

### 7.8 Rabbit Publisher Reliability

Consumer reliability saja tidak cukup. Producer juga perlu reliability.

Pertanyaan producer:

1. Apakah message benar-benar sampai ke broker?
2. Apakah exchange ada?
3. Apakah routing key mengarah ke queue?
4. Apa yang terjadi jika broker menerima tetapi tidak ada route?
5. Apakah publish dilakukan setelah DB commit?

RabbitMQ punya konsep:

- publisher confirms;
- returns for unroutable messages;
- mandatory flag;
- transactional channel, meski jarang dipakai untuk throughput tinggi.

Untuk sistem enterprise, event publication dari DB state sebaiknya memakai outbox:

```text
DB transaction:
  update aggregate
  insert outbox_event
commit

outbox publisher:
  read unpublished event
  publish to RabbitMQ with confirm
  mark as published
```

---

## 8. Kafka with Spring Kafka

### 8.1 Kafka Is Not a Queue with Different API

Kafka adalah log terpartisi.

Mental model:

```text
Topic
  → Partition 0: offset 0,1,2,3...
  → Partition 1: offset 0,1,2,3...
  → Partition 2: offset 0,1,2,3...

Consumer Group
  → consumer instances assigned partitions
```

Message tidak “hilang” saat dikonsumsi. Consumer hanya menyimpan posisi offset.

Ini mengubah failure model.

Pada queue tradisional:

```text
message ack → message keluar dari queue
```

Pada Kafka:

```text
offset commit → consumer group menyatakan posisi sudah diproses
```

Data tetap ada sampai retention policy menghapusnya.

### 8.2 Spring Kafka Components

| Komponen | Fungsi |
|---|---|
| `KafkaTemplate` | producer |
| `@KafkaListener` | listener method |
| `ConcurrentKafkaListenerContainerFactory` | listener container factory |
| `KafkaMessageListenerContainer` | container per consumer |
| `ConcurrentMessageListenerContainer` | container dengan concurrency |
| `RecordMessageConverter` | konversi record |
| `CommonErrorHandler` | error handling listener |
| `DefaultErrorHandler` | retry/recover umum |
| `DeadLetterPublishingRecoverer` | publish failed record ke DLT |
| `KafkaTransactionManager` | transaksi Kafka |
| `ChainedKafkaTransactionManager` | legacy/problematic model; gunakan hati-hati |

### 8.3 Basic Listener

```java
@Component
public class PaymentApprovedListener {

    private final PaymentProjectionService projectionService;

    public PaymentApprovedListener(PaymentProjectionService projectionService) {
        this.projectionService = projectionService;
    }

    @KafkaListener(
            topics = "payment.approved.v1",
            groupId = "invoice-service",
            containerFactory = "paymentKafkaListenerContainerFactory")
    public void onPaymentApproved(PaymentApprovedEvent event) {
        projectionService.apply(event);
    }
}
```

### 8.4 Kafka Offset Commit Semantics

Ack mode Spring Kafka menentukan kapan offset dianggap selesai.

Contoh mode umum:

| Ack Mode | Makna sederhana |
|---|---|
| `RECORD` | commit setelah setiap record diproses |
| `BATCH` | commit setelah batch poll diproses |
| `TIME` | commit setelah interval waktu |
| `COUNT` | commit setelah jumlah record |
| `MANUAL` | listener acknowledge, commit mengikuti semantics container |
| `MANUAL_IMMEDIATE` | commit segera saat acknowledge dipanggil |

Trade-off:

| Strategy | Throughput | Duplicate risk | Overhead |
|---|---:|---:|---:|
| commit tiap record | lebih rendah | lebih rendah | lebih tinggi |
| batch commit | lebih tinggi | lebih tinggi saat crash | lebih rendah |
| manual | fleksibel | bergantung implementasi | lebih kompleks |

Poin penting:

> Offset commit bukan bukti bahwa side effect benar-benar aman. Ia hanya menyatakan consumer group tidak perlu membaca ulang offset itu.

Jika DB commit sukses tapi offset commit gagal, record bisa diproses ulang.

Maka idempotency tetap wajib.

### 8.5 Kafka Ordering

Kafka hanya menjamin ordering dalam partition.

```text
same key → same partition → ordered for that key
```

Jika event untuk aggregate yang sama harus berurutan, producer harus mengirim dengan key yang stabil:

```java
kafkaTemplate.send("case.events.v1", caseId, event);
```

Jika tidak ada key atau key berubah, event bisa tersebar ke partition berbeda dan ordering hilang.

Concurrency juga harus dipahami:

```text
concurrency <= partition count untuk consumer group yang sama
```

Jika topic punya 3 partition dan listener concurrency 10, hanya 3 consumer aktif menerima assignment; sisanya idle.

### 8.6 Kafka Error Handling

Spring Kafka modern menggunakan `CommonErrorHandler`, terutama `DefaultErrorHandler`.

Pattern umum:

```java
@Configuration
class KafkaListenerConfig {

    @Bean
    ConcurrentKafkaListenerContainerFactory<String, PaymentApprovedEvent> paymentKafkaListenerContainerFactory(
            ConsumerFactory<String, PaymentApprovedEvent> consumerFactory,
            KafkaTemplate<Object, Object> kafkaTemplate) {

        var factory = new ConcurrentKafkaListenerContainerFactory<String, PaymentApprovedEvent>();
        factory.setConsumerFactory(consumerFactory);
        factory.setConcurrency(3);

        var recoverer = new DeadLetterPublishingRecoverer(kafkaTemplate);

        var errorHandler = new DefaultErrorHandler(
                recoverer,
                new FixedBackOff(1_000L, 3L)
        );

        errorHandler.addNotRetryableExceptions(
                InvalidEventSchemaException.class,
                BusinessInvariantViolationException.class
        );

        factory.setCommonErrorHandler(errorHandler);
        return factory;
    }
}
```

Mental model:

```text
record delivered
  → listener fails
  → error handler decides retry/backoff
  → if exhausted, recoverer publishes to DLT
  → offset handling proceeds based on configuration
```

### 8.7 Kafka DLT Design

Dead-letter topic bukan tempat sampah tanpa owner.

DLT harus punya:

1. naming convention;
2. original topic/partition/offset metadata;
3. error class;
4. error message sanitized;
5. stack trace policy;
6. correlation ID;
7. event schema version;
8. replay strategy;
9. retention policy;
10. alerting threshold.

Contoh DLT naming:

```text
payment.approved.v1.DLT
case.status-changed.v2.DLT
notification.requested.v1.DLT
```

Namun untuk enterprise besar, kadang lebih baik:

```text
<domain>.<event>.dlt.<environment>
```

atau menggunakan centralized error topic dengan metadata lengkap.

### 8.8 Kafka Transactions

Kafka transactions bisa membuat:

```text
consume from topic A
produce to topic B
commit consumed offset
```

menjadi atomic dalam Kafka transaction.

Namun Kafka transaction **tidak otomatis membuat DB transaction atomic bersama Kafka**.

Jika listener melakukan:

```text
consume Kafka
update database
produce Kafka
commit offset
```

maka Anda memiliki cross-resource consistency problem.

Pilihan desain:

#### Option A — Kafka transaction only

Bagus untuk stream processing Kafka-to-Kafka.

Tidak cukup jika DB adalah source of truth.

#### Option B — DB transaction + outbox

Bagus jika database adalah source of truth.

```text
consume event
  → DB transaction
      → update state
      → insert outbox event
      → insert processed_message id
  → commit DB
  → ack/commit offset

outbox publisher publishes later
```

#### Option C — attempt chained transaction

Berisiko operasional, kompleks, dan sering memberi ilusi atomicity.

Untuk sistem enterprise CRUD/workflow/case management, **DB transaction + idempotency + outbox** biasanya lebih defensible.

### 8.9 Kafka Rebalance Risk

Consumer group rebalance terjadi ketika:

- consumer baru join;
- consumer mati;
- heartbeat timeout;
- partition count berubah;
- deployment rolling restart;
- processing terlalu lama sampai poll timeout.

Failure mode:

```text
consumer memproses record lama
  → tidak poll cukup cepat
  → dianggap mati
  → partition dipindah
  → consumer lain proses record sama
  → duplicate side effect
```

Mitigasi:

1. set `max.poll.interval.ms` realistis;
2. batasi waktu processing;
3. jangan panggil external API lambat di listener tanpa timeout;
4. gunakan idempotency;
5. gunakan batch dengan hati-hati;
6. observability untuk rebalance count;
7. graceful shutdown.

---

## 9. Message Envelope Design

Payload bisnis saja tidak cukup.

Untuk sistem enterprise, gunakan envelope.

Contoh:

```json
{
  "messageId": "01J9Y8EQ2G9V6N9GZ8X8R7A123",
  "messageType": "CaseStatusChanged",
  "schemaVersion": 1,
  "occurredAt": "2026-06-21T10:15:30Z",
  "correlationId": "corr-123",
  "causationId": "cmd-456",
  "tenantId": "cea",
  "producer": "case-service",
  "payload": {
    "caseId": "CASE-2026-0001",
    "fromStatus": "DRAFT",
    "toStatus": "SUBMITTED"
  }
}
```

Envelope fields:

| Field | Fungsi |
|---|---|
| `messageId` | idempotency/dedup |
| `messageType` | routing/deserialization |
| `schemaVersion` | compatibility |
| `occurredAt` | business event time |
| `publishedAt` | infrastructure publication time |
| `correlationId` | trace request/workflow |
| `causationId` | causal chain |
| `tenantId` | isolation |
| `producer` | ownership/debugging |
| `payload` | business data |

Spring bisa menaruh sebagian metadata di headers, tetapi jangan bergantung pada header broker saja jika event disimpan/replayed lintas sistem. Untuk event penting, metadata utama sebaiknya tetap ada dalam envelope atau punya mapping yang stabil.

---

## 10. Idempotent Consumer Pattern

Karena at-least-once delivery adalah realitas umum, consumer harus idempotent.

### 10.1 Processed Message Table

Contoh table:

```sql
CREATE TABLE processed_message (
    consumer_name      VARCHAR(100) NOT NULL,
    message_id         VARCHAR(100) NOT NULL,
    processed_at       TIMESTAMP NOT NULL,
    source_topic       VARCHAR(200),
    source_partition   INTEGER,
    source_offset      BIGINT,
    PRIMARY KEY (consumer_name, message_id)
);
```

Consumer:

```java
@Service
public class CaseEventConsumerService {

    private final ProcessedMessageRepository processedMessages;
    private final CaseProjectionRepository projections;

    @Transactional
    public void consume(MessageEnvelope<CaseStatusChanged> envelope) {
        boolean firstTime = processedMessages.tryInsert(
                "case-projection-consumer",
                envelope.messageId()
        );

        if (!firstTime) {
            return;
        }

        projections.applyStatusChange(envelope.payload());
    }
}
```

Kunci:

```text
insert dedup marker and business update in the same DB transaction
```

Jika tidak satu transaksi, idempotency marker bisa dusta.

### 10.2 Natural Idempotency

Kadang operasi sudah natural idempotent.

Contoh:

```sql
UPDATE case_projection
SET status = 'SUBMITTED'
WHERE case_id = 'CASE-1'
  AND version < 12;
```

Atau:

```sql
INSERT INTO invoice(invoice_id, ...)
VALUES (?, ...)
ON CONFLICT DO NOTHING;
```

Namun jangan mengklaim idempotent hanya karena method “sepertinya aman”. Buktikan dengan invariant.

### 10.3 Idempotency Key Harus Stabil

Jangan gunakan random ID baru saat retry.

Salah:

```java
String idempotencyKey = UUID.randomUUID().toString();
```

Benar:

```java
String idempotencyKey = envelope.messageId();
```

atau untuk command:

```java
String idempotencyKey = command.commandId();
```

---

## 11. Transaction Boundary in Message Consumers

Listener method tidak otomatis menjamin business transaction benar.

Contoh bahaya:

```java
@KafkaListener(topics = "case.submitted")
public void onCaseSubmitted(CaseSubmitted event) {
    caseService.updateProjection(event);      // DB commit
    notificationClient.sendEmail(event);      // external side effect
}
```

Jika email sukses lalu offset commit gagal, message diproses ulang dan email dobel.

Jika DB commit sukses lalu email gagal, message retry bisa update DB lagi.

Better:

```text
listener
  → DB transaction
      → update state/projection
      → insert notification_outbox
      → insert processed_message
  → commit
  → ack/commit message

notification worker
  → send email with idempotency key
  → mark sent
```

Prinsip:

> Message listener sebaiknya melakukan durable state transition, bukan langsung semua side effect eksternal.

Side effect eksternal perlu idempotency sendiri atau outbox.

---

## 12. Retry Classification

Tidak semua error boleh retry.

Klasifikasi:

| Error | Retry? | Alasan |
|---|---|---|
| DB deadlock | ya | transient |
| DB connection timeout | ya | transient |
| HTTP 503 downstream | ya dengan backoff | transient |
| HTTP 400 downstream | biasanya tidak | request invalid |
| invalid schema | tidak | poison message |
| unknown enum | tidak/parkir | compatibility issue |
| authorization denied | tidak | policy failure |
| duplicate message | tidak | success no-op |
| optimistic conflict | tergantung | mungkin reorder/stale |
| missing referenced aggregate | tergantung | eventual consistency; bisa delayed retry |

Implementasikan sebagai code, bukan tribal knowledge.

```java
public final class MessageFailureClassifier {

    public FailureDecision classify(Throwable error) {
        Throwable root = rootCause(error);

        if (root instanceof InvalidMessageSchemaException) {
            return FailureDecision.nonRetryable("INVALID_SCHEMA");
        }

        if (root instanceof DuplicateMessageException) {
            return FailureDecision.successNoop("DUPLICATE");
        }

        if (root instanceof CannotAcquireLockException) {
            return FailureDecision.retryable("DB_LOCK", Duration.ofSeconds(2));
        }

        if (root instanceof DownstreamUnavailableException) {
            return FailureDecision.retryable("DOWNSTREAM_UNAVAILABLE", Duration.ofSeconds(10));
        }

        return FailureDecision.retryable("UNKNOWN", Duration.ofSeconds(5));
    }
}
```

---

## 13. Poison Message Handling

Poison message adalah message yang akan gagal terus karena isinya tidak bisa diproses.

Contoh:

- invalid JSON;
- schema version tidak dikenal;
- required field kosong;
- enum tidak dikenal;
- tenant tidak valid;
- aggregate id format salah;
- business invariant impossible.

Jika poison message terus diretry, sistem akan:

- membuang CPU;
- memenuhi log;
- menahan partition/queue;
- menyebabkan lag;
- menyembunyikan error lain.

Policy yang benar:

```text
poison message
  → classify non-retryable
  → publish to DLQ/DLT/parking lot
  → include reason metadata
  → alert if threshold exceeded
  → provide replay/manual remediation tool
```

---

## 14. Ordering, Concurrency, and State Machines

Untuk sistem case management/regulatory workflow, ordering sering penting.

Contoh event:

```text
CaseSubmitted
CaseAssigned
CaseApproved
CaseClosed
```

Jika diproses out of order:

```text
CaseClosed sebelum CaseApproved
```

projection bisa rusak.

### 14.1 Kafka

Gunakan key per aggregate:

```text
key = caseId
```

Maka semua event case yang sama masuk partition yang sama dan diproses berurutan oleh satu consumer dalam group.

Namun ordering masih bisa rusak jika:

- producer salah key;
- retry async publish mengubah order;
- event dibuat dari beberapa service tanpa single ownership;
- consumer melakukan parallel processing per record tanpa menjaga key order;
- DLT replay dilakukan sembarang.

### 14.2 RabbitMQ/JMS

Queue bisa menjaga ordering dalam kondisi sederhana, tetapi concurrency > 1 bisa membuat completion order berbeda.

Jika ordering per aggregate wajib, opsi:

1. partition queue by key;
2. use consistent-hash exchange di RabbitMQ;
3. serialize processing per aggregate;
4. gunakan state transition guard di DB;
5. gunakan version/sequence number di event;
6. reject/stash out-of-order event sampai predecessor tersedia.

### 14.3 State Transition Guard

Jangan mengandalkan ordering broker saja. Tambahkan guard:

```java
@Transactional
public void apply(CaseStatusChanged event) {
    CaseProjection projection = repository.getForUpdate(event.caseId());

    if (projection.version() >= event.version()) {
        return; // duplicate or stale
    }

    if (projection.version() + 1 != event.version()) {
        throw new OutOfOrderEventException(event.caseId(), event.version());
    }

    projection.apply(event);
}
```

---

## 15. Backpressure and Flow Control

Messaging membuat sistem terlihat decoupled, tetapi tidak otomatis aman.

Jika producer mengirim 10.000 msg/s dan consumer hanya mampu 1.000 msg/s, backlog akan tumbuh.

Pertanyaan desain:

1. Apakah backlog boleh tumbuh?
2. Berapa retention queue/topic?
3. Kapan alert lag/backlog?
4. Apakah consumer autoscale?
5. Bottleneck di CPU, DB, external API, atau broker?
6. Apa yang terjadi saat downstream mati 1 jam?
7. Apakah retry message bersaing dengan fresh message?

### 15.1 Consumer Concurrency Is Not Free

Menambah concurrency bisa memperburuk bottleneck.

```text
consumer concurrency ↑
  → DB connections ↑
  → lock contention ↑
  → retry ↑
  → lag ↑
```

Tuning harus berbasis bottleneck.

### 15.2 Queue/Partition Lag as SLO Signal

Metric penting:

- consumer lag;
- queue depth;
- unacked message count;
- retry count;
- DLQ rate;
- processing latency;
- end-to-end event age;
- oldest message age;
- consumer rebalance count;
- listener error rate;
- downstream timeout rate.

End-to-end event age sering lebih penting daripada throughput.

```text
now - event.occurredAt
```

Jika age naik, sistem makin tertinggal secara bisnis.

---

## 16. Observability for Spring Messaging

Minimal observability:

### 16.1 Logs

Setiap listener failure log harus punya:

- message id;
- topic/queue;
- partition/offset atau delivery tag jika ada;
- message type;
- schema version;
- tenant id jika relevan;
- correlation id;
- consumer name;
- failure classification;
- retry attempt;
- decision: retry/DLQ/ignore/success-noop.

Contoh structured log fields:

```text
event=message_consume_failed
consumer=invoice-service.payment-approved
messageId=01J...
topic=payment.approved.v1
partition=2
offset=912338
failureCode=DOWNSTREAM_TIMEOUT
retryable=true
attempt=3
correlationId=corr-123
```

### 16.2 Metrics

Metric penting:

```text
messaging.consume.count{consumer,type,result}
messaging.consume.duration{consumer,type}
messaging.consume.failure.count{consumer,failure_code,retryable}
messaging.dlq.publish.count{consumer,reason}
messaging.idempotency.duplicate.count{consumer}
messaging.retry.count{consumer,reason}
messaging.event.age{consumer,type}
```

Hati-hati cardinality. Jangan masukkan `messageId` sebagai tag metric.

### 16.3 Tracing

Trace propagation:

```text
HTTP request
  → command handler
  → outbox event
  → broker
  → consumer
  → DB update
  → outbound HTTP
```

Header trace harus dipropagate.

Namun trace context tidak boleh menjadi satu-satunya correlation. Simpan juga business correlation id.

### 16.4 Audit

Untuk sistem regulatory, audit harus menjawab:

1. message apa diterima;
2. kapan diterima;
3. dari producer mana;
4. diproses oleh consumer versi apa;
5. menghasilkan state transition apa;
6. gagal karena apa;
7. apakah diretry;
8. apakah masuk DLQ;
9. siapa/apa yang replay;
10. apakah replay mengubah hasil.

---

## 17. Spring Boot Auto-Configuration for Messaging

Spring Boot menyediakan auto-config untuk banyak integration:

- JMS jika dependency dan `ConnectionFactory` tersedia;
- RabbitMQ via Spring AMQP jika dependency `spring-boot-starter-amqp` tersedia;
- Kafka via `spring-kafka` dan Boot Kafka properties.

Tetapi production-grade app biasanya tetap mendefinisikan container factory sendiri untuk:

- concurrency;
- ack mode;
- error handler;
- retry;
- message converter;
- transaction manager;
- observation;
- customizer;
- validation;
- tenant/correlation propagation.

Auto-config bagus sebagai baseline, tetapi jangan biarkan critical delivery semantics menjadi default yang tidak pernah direview.

Checklist:

```text
[ ] Apakah ack/commit mode eksplisit?
[ ] Apakah concurrency eksplisit?
[ ] Apakah retry policy eksplisit?
[ ] Apakah DLQ/DLT eksplisit?
[ ] Apakah message converter eksplisit?
[ ] Apakah transaction boundary eksplisit?
[ ] Apakah shutdown behavior eksplisit?
[ ] Apakah metrics/tracing aktif?
```

---

## 18. Message Converter and Schema Compatibility

Message converter sering jadi sumber production issue.

Masalah umum:

1. payload class berubah;
2. field rename;
3. enum value baru;
4. producer dan consumer deploy tidak bersamaan;
5. trusted package config salah;
6. type header bocor dari class Java internal;
7. consumer lama tidak bisa membaca event baru.

### 18.1 Jangan Jadikan Java Class Name sebagai Public Contract

Berbahaya:

```text
__TypeId__ = com.company.payment.internal.PaymentApprovedEvent
```

Jika package berubah, consumer rusak.

Lebih baik:

```text
messageType = PaymentApproved
schemaVersion = 1
```

Lalu mapping dilakukan eksplisit.

### 18.2 Compatibility Rules

Untuk event evolution:

| Change | Compatibility |
|---|---|
| tambah optional field | biasanya aman |
| rename field | breaking |
| hapus field required | breaking |
| ubah tipe field | breaking |
| tambah enum value | bisa breaking untuk consumer lama |
| ubah semantic field | breaking walau schema sama |

Top-tier rule:

> Schema compatibility bukan hanya bentuk JSON. Semantic compatibility juga harus dijaga.

---

## 19. Request-Reply Messaging

Spring mendukung request-reply pattern, misalnya dengan RabbitMQ atau JMS.

Namun request-reply di messaging sering disalahgunakan untuk mengganti HTTP.

Gunakan request-reply jika:

- caller tidak butuh synchronous HTTP semantics;
- broker adalah integration backbone;
- reply timeout jelas;
- correlation id kuat;
- reply queue lifecycle jelas;
- idempotency jelas.

Hindari jika:

- hanya butuh simple synchronous query;
- timeout tidak jelas;
- caller menahan thread lama;
- failure handling lebih rumit daripada HTTP;
- reply queue menjadi bottleneck.

Pattern:

```text
send command with replyTo and correlationId
  → consumer processes
  → send reply with same correlationId
  → caller waits bounded timeout
```

Dalam banyak sistem modern, lebih baik:

```text
POST /operation
  → 202 Accepted
  → operation resource
  → event notification when done
```

atau pure async command/event.

---

## 20. Security Boundary in Messaging

Messaging security bukan hanya broker credential.

Pertanyaan:

1. Siapa boleh publish ke topic/queue?
2. Siapa boleh consume?
3. Apakah message mengandung PII?
4. Apakah field perlu encryption/masking?
5. Apakah tenant id trusted?
6. Apakah consumer memvalidasi authorization context?
7. Apakah event bisa dipalsukan internal service lain?
8. Apakah DLQ menyimpan data sensitif?
9. Apakah replay tool punya audit?

Jika message membawa user context, hati-hati.

Jangan percaya begitu saja:

```json
{
  "userId": "admin",
  "role": "SUPER_ADMIN"
}
```

Untuk command yang berdampak security, consumer harus bisa membedakan:

```text
authenticated actor context
versus
system-to-system trusted command
versus
business event fact
```

Event fact biasanya bukan instruksi untuk bypass authorization.

---

## 21. Multi-Tenancy Boundary

Untuk multi-tenant app, message harus jelas tenant-nya.

Pilihan:

1. tenant per topic/queue;
2. tenant header;
3. tenant field in envelope;
4. tenant from key;
5. hybrid.

Risiko:

- message tenant A diproses dalam context tenant B;
- cache key tidak menyertakan tenant;
- idempotency key tidak scoped per tenant;
- DLQ replay tidak set tenant context;
- scheduled replay job memakai default tenant;
- metrics/logs tidak bisa dipisah tenant.

Pattern listener:

```java
public void consume(MessageEnvelope<CaseStatusChanged> envelope) {
    tenantContext.runWithTenant(envelope.tenantId(), () -> {
        consumerService.consume(envelope);
    });
}
```

Tapi jangan hanya set ThreadLocal tanpa cleanup.

Gunakan pattern:

```java
try {
    TenantContext.set(tenantId);
    service.consume(envelope);
} finally {
    TenantContext.clear();
}
```

---

## 22. Graceful Shutdown

Messaging app harus shutdown dengan aman.

Failure saat shutdown:

```text
SIGTERM received
  → listener still processing
  → container stops abruptly
  → DB transaction unknown
  → ack not sent
  → duplicate after restart
```

Design:

1. stop accepting new messages;
2. let in-flight messages finish within timeout;
3. commit/rollback cleanly;
4. close producer/consumer;
5. expose readiness false before shutdown;
6. ensure Kubernetes termination grace period cukup.

Spring listener containers biasanya memiliki lifecycle integration, tetapi Anda tetap harus mengatur:

- shutdown timeout;
- listener concurrency;
- max processing time;
- external call timeout;
- transaction timeout.

Jika external call timeout 5 menit tetapi Kubernetes grace period 30 detik, graceful shutdown tidak realistis.

---

## 23. Testing Spring Messaging

Testing harus mencakup beberapa level.

### 23.1 Unit Test Business Consumer

Test service tanpa broker:

```java
@Test
void duplicateMessageShouldBeNoop() {
    var envelope = fixture.caseSubmitted("msg-1");

    consumer.consume(envelope);
    consumer.consume(envelope);

    assertThat(repository.countByCaseId(envelope.payload().caseId())).isEqualTo(1);
}
```

### 23.2 Slice/Integration Test Listener Mapping

Test converter, listener method binding, error handler.

### 23.3 Broker Integration Test

Gunakan Testcontainers untuk Kafka/Rabbit bila memungkinkan.

Test:

- publish message;
- listener consumes;
- DB state berubah;
- duplicate tidak merusak;
- invalid message masuk DLQ/DLT;
- retryable failure dicoba ulang;
- non-retryable failure tidak infinite retry.

### 23.4 Contract Test

Producer dan consumer harus sepakat:

- event name;
- schema version;
- required fields;
- semantics;
- compatibility.

### 23.5 Replay Test

Wajib untuk sistem event-driven serius:

```text
given historical event stream
when replayed into fresh projection
then projection equals expected state
```

---

## 24. Anti-Patterns

### 24.1 Listener Melakukan Terlalu Banyak Hal

```java
@RabbitListener(queues = "case.queue")
public void listen(Event event) {
    updateDb(event);
    callExternalApi(event);
    sendEmail(event);
    publishAnotherMessage(event);
    uploadFile(event);
}
```

Masalah:

- sulit retry;
- side effect dobel;
- transaction boundary kabur;
- failure classification sulit;
- processing time panjang;
- shutdown sulit.

Better:

```text
listener receives command/event
  → validate/dedup
  → durable state transition
  → record outbox/next action
```

### 24.2 Infinite Retry Without Classification

```text
catch all exception → retry forever
```

Ini akan menghancurkan operability.

### 24.3 Manual Ack Tanpa Alasan Kuat

Manual ack terlihat powerful tetapi memperbesar surface bug.

Default ke automatic/container-managed ack jika semantics cukup.

### 24.4 External Call Tanpa Timeout

Listener thread bisa stuck.

Akibat:

- queue backlog;
- Kafka rebalance;
- shutdown stuck;
- connection pool exhausted.

### 24.5 Tidak Ada Idempotency

At-least-once delivery tanpa idempotency adalah bug yang menunggu incident.

### 24.6 Menganggap DLQ sebagai Solusi Final

DLQ hanya memindahkan failure. Ia bukan recovery strategy.

Harus ada:

- owner;
- alert;
- inspection;
- remediation;
- replay;
- audit.

### 24.7 Satu Topic untuk Semua Event

```text
system.events
```

Dengan semua event bercampur tanpa contract jelas.

Masalah:

- schema chaos;
- consumer sulit filter;
- retention tidak spesifik;
- ownership kabur;
- DLT tidak jelas.

### 24.8 Shared DTO Between Producer and Consumer Internal Code

Jika producer dan consumer share Java class internal, deployment coupling meningkat.

Lebih baik share contract/schema, bukan internal domain class.

---

## 25. Design Heuristics for Spring Messaging

Gunakan heuristics berikut.

### 25.1 Listener Should Be Thin

Listener sebaiknya:

1. menerima message;
2. extract metadata;
3. set context;
4. delegate ke application service;
5. membiarkan exception naik ke container/error handler jika perlu.

```java
@KafkaListener(topics = "case.status-changed.v1")
public void onMessage(MessageEnvelope<CaseStatusChanged> envelope) {
    tenantContext.runWithTenant(envelope.tenantId(), () -> {
        caseStatusConsumer.consume(envelope);
    });
}
```

### 25.2 Application Service Owns Transaction and Idempotency

```java
@Transactional
public void consume(MessageEnvelope<CaseStatusChanged> envelope) {
    if (!processedMessages.markIfNew(CONSUMER_NAME, envelope.messageId())) {
        return;
    }

    projection.apply(envelope.payload());
    outbox.record(...);
}
```

### 25.3 Error Handler Owns Delivery Decision

Listener jangan menangkap semua exception lalu log saja.

Salah:

```java
try {
    service.consume(event);
} catch (Exception e) {
    log.error("failed", e);
}
```

Ini membuat container mengira message sukses dan message bisa hilang secara semantic.

Benar:

```java
service.consume(event); // throw if failed
```

Biarkan error handler menentukan retry/DLQ.

### 25.4 Broker Offset/Ack Is Not Business Success

Business success adalah:

```text
state transition committed and idempotency recorded
```

Ack/offset commit hanya delivery bookkeeping.

### 25.5 Every Consumer Needs a Runbook

Minimal runbook:

```text
Consumer name:
Source topic/queue:
Message type:
Owner team:
Retry policy:
DLQ/DLT:
Idempotency key:
Transaction boundary:
Replay procedure:
Lag alert threshold:
Failure classification:
Dashboard:
```

---

## 26. Example: Production-Grade Kafka Consumer Skeleton

```java
@Component
public class CaseStatusChangedKafkaListener {

    private final CaseStatusChangedConsumer consumer;
    private final TenantContextRunner tenantContextRunner;

    public CaseStatusChangedKafkaListener(
            CaseStatusChangedConsumer consumer,
            TenantContextRunner tenantContextRunner) {
        this.consumer = consumer;
        this.tenantContextRunner = tenantContextRunner;
    }

    @KafkaListener(
            topics = "case.status-changed.v1",
            groupId = "case-projection-service",
            containerFactory = "caseStatusKafkaListenerContainerFactory")
    public void onMessage(MessageEnvelope<CaseStatusChangedPayload> envelope) {
        tenantContextRunner.run(envelope.tenantId(), () -> consumer.consume(envelope));
    }
}
```

```java
@Service
public class CaseStatusChangedConsumer {

    private static final String CONSUMER_NAME = "case-projection-service.case-status-changed";

    private final ProcessedMessageRepository processedMessages;
    private final CaseProjectionRepository projections;
    private final DomainOutbox outbox;

    public CaseStatusChangedConsumer(
            ProcessedMessageRepository processedMessages,
            CaseProjectionRepository projections,
            DomainOutbox outbox) {
        this.processedMessages = processedMessages;
        this.projections = projections;
        this.outbox = outbox;
    }

    @Transactional
    public void consume(MessageEnvelope<CaseStatusChangedPayload> envelope) {
        boolean firstProcessing = processedMessages.tryMarkProcessed(
                CONSUMER_NAME,
                envelope.messageId(),
                envelope.sourceMetadata()
        );

        if (!firstProcessing) {
            return;
        }

        CaseStatusChangedPayload payload = envelope.payload();

        CaseProjection projection = projections.findByCaseIdForUpdate(payload.caseId())
                .orElseGet(() -> CaseProjection.newProjection(payload.caseId()));

        projection.applyStatusChange(
                payload.fromStatus(),
                payload.toStatus(),
                payload.version(),
                envelope.occurredAt()
        );

        projections.save(projection);

        if (projection.requiresNotification()) {
            outbox.record(NotificationRequested.from(projection));
        }
    }
}
```

Key properties:

1. listener thin;
2. tenant context explicit;
3. transaction in service;
4. idempotency marker in same transaction;
5. state transition guarded;
6. side effect through outbox;
7. exception not swallowed.

---

## 27. Example: Rabbit Listener Container Configuration

```java
@Configuration
class CaseRabbitConsumerConfig {

    @Bean
    SimpleRabbitListenerContainerFactory caseRabbitListenerContainerFactory(
            ConnectionFactory connectionFactory,
            MessageConverter messageConverter,
            Advice caseRabbitRetryAdvice) {

        var factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setMessageConverter(messageConverter);
        factory.setConcurrentConsumers(3);
        factory.setMaxConcurrentConsumers(10);
        factory.setPrefetchCount(20);
        factory.setAdviceChain(caseRabbitRetryAdvice);
        factory.setDefaultRequeueRejected(false);
        return factory;
    }

    @Bean
    Advice caseRabbitRetryAdvice(RabbitTemplate rabbitTemplate) {
        return RetryInterceptorBuilder.stateless()
                .maxAttempts(4)
                .backOffOptions(1_000, 2.0, 10_000)
                .recoverer(new RepublishMessageRecoverer(
                        rabbitTemplate,
                        "case.events.dlx",
                        "case.assessment.dead"))
                .build();
    }
}
```

Catatan:

- `defaultRequeueRejected(false)` mencegah immediate infinite requeue untuk exception yang tidak ditangani;
- retry harus dikombinasikan dengan failure classification jika failure beragam;
- DLX/routing key harus sesuai topology;
- pastikan message yang non-retryable tidak menghabiskan attempt sia-sia jika bisa diklasifikasi lebih awal.

---

## 28. Example: JMS Consumer with Idempotency

```java
@Component
public class InvoiceGenerationJmsListener {

    private final InvoiceCommandConsumer consumer;

    public InvoiceGenerationJmsListener(InvoiceCommandConsumer consumer) {
        this.consumer = consumer;
    }

    @JmsListener(
            destination = "invoice.generate.queue",
            containerFactory = "invoiceJmsListenerContainerFactory")
    public void onMessage(GenerateInvoiceCommand command) {
        consumer.consume(command);
    }
}
```

```java
@Service
public class InvoiceCommandConsumer {

    private final ProcessedMessageRepository processedMessages;
    private final InvoiceService invoiceService;

    public InvoiceCommandConsumer(
            ProcessedMessageRepository processedMessages,
            InvoiceService invoiceService) {
        this.processedMessages = processedMessages;
        this.invoiceService = invoiceService;
    }

    @Transactional
    public void consume(GenerateInvoiceCommand command) {
        if (!processedMessages.tryMarkProcessed("invoice-generator", command.commandId())) {
            return;
        }

        invoiceService.generate(command.invoiceId(), command.caseId());
    }
}
```

---

## 29. Decision Matrix: JMS vs RabbitMQ vs Kafka in Spring

| Need | Better Fit | Reason |
|---|---|---|
| enterprise legacy integration | JMS | standard API/provider ecosystem |
| command queue/work dispatch | RabbitMQ/JMS | queue semantics natural |
| event stream replay | Kafka | retained log |
| partitioned ordering per aggregate | Kafka | key-based partition order |
| complex routing | RabbitMQ | exchange/routing/binding model |
| request/reply enterprise broker | JMS/RabbitMQ | natural queue reply pattern |
| long retention analytics stream | Kafka | log retention and replay |
| strict XA with legacy infra | JMS | JTA provider support |
| lightweight app event handoff | RabbitMQ | operationally simpler than Kafka for some queues |
| high fan-out stream processing | Kafka | consumer groups and replay model |

But the best choice is not just technology. Ask:

```text
Who owns the broker?
Who monitors lag?
Who replays DLQ?
What is retention?
What is ordering requirement?
What is message contract governance?
What is failure recovery procedure?
What is the team's operational maturity?
```

---

## 30. Production Review Checklist

Before approving a Spring messaging consumer, check:

### Contract

```text
[ ] Message type is explicit.
[ ] Schema version is explicit.
[ ] Message ID exists.
[ ] Correlation ID exists.
[ ] Tenant ID exists if multi-tenant.
[ ] Producer ownership is known.
[ ] Compatibility rules are documented.
```

### Listener Runtime

```text
[ ] Listener container factory is explicit.
[ ] Concurrency is explicit.
[ ] Ack/commit mode is explicit.
[ ] Timeout assumptions are explicit.
[ ] Shutdown behavior is acceptable.
[ ] Message converter is controlled.
```

### Correctness

```text
[ ] Consumer is idempotent.
[ ] Idempotency marker is transactional with state change.
[ ] Ordering requirement is known.
[ ] Out-of-order behavior is defined.
[ ] External side effects are outboxed or idempotent.
[ ] Listener does not swallow exceptions incorrectly.
```

### Failure Handling

```text
[ ] Retryable/non-retryable classification exists.
[ ] Retry has max attempts.
[ ] Backoff is configured.
[ ] DLQ/DLT exists.
[ ] DLQ/DLT has owner.
[ ] Replay procedure exists.
[ ] Poison message does not block fresh messages indefinitely.
```

### Operations

```text
[ ] Lag/queue depth is monitored.
[ ] DLQ rate is monitored.
[ ] Processing latency is monitored.
[ ] Oldest message age is monitored.
[ ] Error logs include message metadata.
[ ] Tracing/correlation propagates.
[ ] Runbook exists.
```

### Security

```text
[ ] Broker credential is scoped.
[ ] Producer/consumer authorization is limited.
[ ] PII in message is reviewed.
[ ] DLQ data sensitivity is reviewed.
[ ] Replay tool is audited.
[ ] Tenant context is validated.
```

---

## 31. How This Connects to Previous Parts

Part ini mengikat banyak materi sebelumnya:

| Previous Part | Connection |
|---|---|
| IoC container | listener container factory, bean lifecycle |
| DI resolution | injecting templates, converters, handlers |
| Lifecycle | startup/shutdown listener containers |
| Configuration | broker config, listener factory, topology declaration |
| Auto-configuration | Boot messaging auto-config |
| AOP/proxy | `@Transactional` in consumer service, self-invocation risk |
| Transaction | DB transaction, JMS/Kafka transaction, outbox |
| Error handling | failure classification, DLQ metadata |
| Security | message trust boundary, tenant/security context |
| Async/events | listener execution, transactional event/outbox |
| Virtual threads | listener thread model and blocking calls |
| Observability | metrics/tracing/logging for message flows |

Messaging tidak berdiri sendiri. Ia adalah titik integrasi dari hampir semua concern Spring production.

---

## 32. Mental Model Final

Jika hanya mengingat satu model, ingat ini:

```text
Message listener is not business logic.
Message listener is a delivery adapter.

Delivery adapter responsibilities:
  - receive
  - decode
  - validate envelope
  - establish context
  - delegate to transactional application service
  - let runtime decide ack/retry/DLQ based on explicit policy

Application service responsibilities:
  - idempotency
  - business state transition
  - durable side effect intent
  - invariant enforcement

Runtime responsibilities:
  - concurrency
  - ack/commit
  - retry
  - recovery
  - shutdown
  - observability hooks
```

Aplikasi messaging yang matang tidak diukur dari seberapa mudah mengirim message, tetapi dari seberapa aman ia menghadapi:

- duplicate;
- delay;
- out-of-order;
- poison message;
- downstream outage;
- partial commit;
- redelivery;
- replay;
- shutdown;
- schema evolution;
- tenant/security boundary.

---

## 33. Ringkasan

Pada part ini kita membahas:

1. Spring Messaging sebagai delivery boundary.
2. Perbedaan Spring Messaging, JMS, AMQP/RabbitMQ, Kafka, Spring Integration, dan Spring Cloud Stream.
3. Listener container sebagai runtime engine.
4. JMS listener, ack, transaction, dan failure model.
5. RabbitMQ topology, ack, prefetch, retry, DLQ, publisher reliability.
6. Kafka offset, partition ordering, error handler, DLT, transaction, rebalance.
7. Message envelope design.
8. Idempotent consumer pattern.
9. Transaction boundary dan outbox/inbox.
10. Retry classification.
11. Poison message handling.
12. Ordering dan state transition guard.
13. Backpressure dan lag monitoring.
14. Observability messaging.
15. Security dan multi-tenancy boundary.
16. Graceful shutdown.
17. Testing strategy.
18. Anti-patterns.
19. Production review checklist.

---

## 34. Referensi Resmi yang Relevan

Beberapa dokumentasi resmi yang relevan untuk mendalami bagian ini:

1. Spring Framework Reference — JMS integration and message listener containers.
2. Spring AMQP Reference — listener containers, error handling, retry, dead-letter patterns.
3. Spring for Apache Kafka Reference — listener containers, ack modes, error handling, transactions, DLT.
4. Spring Boot Reference — messaging auto-configuration for JMS, RabbitMQ, Kafka.
5. Spring Framework Reference — task execution, scheduling, transaction, observability integration.

---

## 35. Status Seri

```text
Part saat ini : 22 dari 35
Status        : belum selesai
Berikutnya    : 23-spring-integration-enterprise-integration-patterns.md
```

Part berikutnya akan membahas **Spring Integration and Enterprise Integration Patterns**: channel, endpoint, transformer, filter, router, splitter, aggregator, gateway, poller, error channel, flow DSL, transactional flow, dan kapan Spring Integration tepat dipakai dibanding BPM engine, message listener biasa, atau orchestration service.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./21-virtual-threads-concurrency-spring-java-21-25.md">⬅️ Part 21 — Virtual Threads, Concurrency, and Spring on Java 21–25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./23-spring-integration-enterprise-integration-patterns.md">Part 23 — Spring Integration and Enterprise Integration Patterns ➡️</a>
</div>

# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-021

# Part 21 — JMS in Spring Framework / Spring Boot: `JmsTemplate`, Listener Container, Transaction, Error Handler

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Level: Advanced / top 1% engineering  
> Target Java: Java 8 sampai Java 25  
> Fokus: Spring sebagai adapter engineering layer di atas JMS/Jakarta Messaging, bukan pengganti pemahaman JMS.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas JMS/Jakarta Messaging dari sisi:

- mental model asynchronous coordination,
- queue/topic semantics,
- message anatomy,
- producer/consumer engineering,
- acknowledgement,
- transaction,
- reliability,
- ordering,
- retry/DLQ,
- request/reply,
- selector/routing,
- security,
- broker architecture,
- provider differences,
- Jakarta EE runtime.

Part ini masuk ke dunia **Spring Framework / Spring Boot integration**.

Yang penting: **Spring tidak mengubah hukum dasar JMS**.

Spring hanya menyediakan:

1. abstraction helper,
2. lifecycle management,
3. template API,
4. listener container,
5. dependency injection integration,
6. transaction integration,
7. conversion layer,
8. Boot auto-configuration,
9. operational convenience.

Tetapi guarantee tetap berasal dari kombinasi:

- JMS/Jakarta Messaging specification,
- broker behavior,
- connection factory implementation,
- listener container configuration,
- transaction configuration,
- application handler correctness,
- database side-effect correctness,
- idempotency design,
- operational runbook.

Jika engineer hanya tahu `@JmsListener` dan `JmsTemplate`, biasanya sistemnya terlihat bekerja di local/dev, tetapi rapuh saat:

- broker restart,
- duplicate delivery,
- poison message,
- listener exception,
- database commit berhasil tetapi ack gagal,
- consumer terlalu cepat mengambil message tetapi lambat memproses,
- shutdown saat message sedang diproses,
- concurrency naik tanpa memperhatikan ordering,
- retry storm,
- DLQ tidak termonitor,
- transaction manager salah,
- `ConnectionFactory` salah dibungkus,
- Boot auto-config memilih default yang tidak sesuai kebutuhan production.

Part ini akan membahas Spring JMS secara serius sebagai **runtime coordination adapter**.

---

## 1. Mental Model Utama

### 1.1 Spring JMS bukan messaging system

Spring JMS bukan broker.

Spring JMS bukan queue.

Spring JMS bukan transaction guarantee end-to-end.

Spring JMS adalah library yang membantu aplikasi Spring memakai JMS provider dengan lebih ergonomis.

Secara mental model:

```text
Application code
    |
    | uses
    v
Spring JMS abstraction
    |
    | delegates to
    v
JMS / Jakarta Messaging API
    |
    | implemented by
    v
Provider client library
    |
    | speaks protocol to
    v
Message broker
    |
    | persists / dispatches / redelivers
    v
Other producers / consumers
```

Spring berada di layer aplikasi, bukan di layer broker.

Konsekuensinya:

- `JmsTemplate` tidak membuat send menjadi magically exactly-once.
- `@JmsListener` tidak otomatis membuat handler idempotent.
- `DefaultMessageListenerContainer` tidak menghapus kebutuhan memahami session, ack, transaction, dan concurrency.
- Boot auto-configuration tidak otomatis benar untuk production workload.

Top 1% engineer memperlakukan Spring JMS sebagai **controlled adapter**, bukan magic.

---

### 1.2 Spring menyederhanakan resource ceremony, bukan semantic risk

Tanpa Spring, kode JMS klasik banyak boilerplate:

```java
Connection connection = null;
Session session = null;
MessageProducer producer = null;

try {
    connection = connectionFactory.createConnection();
    session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
    Queue queue = session.createQueue("order.commands");
    producer = session.createProducer(queue);

    TextMessage message = session.createTextMessage(payload);
    producer.send(message);
} finally {
    if (producer != null) producer.close();
    if (session != null) session.close();
    if (connection != null) connection.close();
}
```

Dengan Spring:

```java
jmsTemplate.convertAndSend("order.commands", command);
```

Itu terlihat sederhana.

Tetapi di balik itu tetap ada:

- connection acquisition,
- session creation/reuse,
- destination resolution,
- message conversion,
- producer creation/reuse depending on implementation/cache,
- send call,
- exception translation,
- transaction participation if configured.

Spring mengurangi ceremony.

Spring tidak menghapus kebutuhan memahami:

- message durability,
- delivery mode,
- timeout,
- transaction boundary,
- duplicate delivery,
- resource exhaustion,
- failure window.

---

### 1.3 Spring JMS terdiri dari dua sisi besar

Ada dua sisi utama:

```text
Outbound side:
    Application -> Broker
    Usually via JmsTemplate / JmsMessagingTemplate

Inbound side:
    Broker -> Application
    Usually via MessageListenerContainer / @JmsListener
```

Keduanya harus dirancang berbeda.

Producer/send path perlu memikirkan:

- kapan send dianggap sukses,
- persistent vs non-persistent,
- TTL,
- priority,
- transaction,
- correlation id,
- message converter,
- retry saat send gagal,
- outbox bila send harus konsisten dengan DB.

Consumer/receive path perlu memikirkan:

- concurrency,
- session count,
- ack mode,
- transaction rollback,
- exception handling,
- redelivery,
- idempotency,
- shutdown,
- backpressure,
- poison message.

Kesalahan umum adalah menganggap `JmsTemplate` dan `@JmsListener` simetris.

Mereka tidak simetris.

Send path adalah **publishing side effect**.

Receive path adalah **side-effect handler under uncertain delivery**.

---

## 2. Version and Namespace Map: Java 8 sampai Java 25

### 2.1 Dua dunia: `javax.jms` dan `jakarta.jms`

Secara praktis ada dua keluarga API:

| Era | Namespace | Umum dipakai di | Catatan |
|---|---|---|---|
| Java EE / JMS 1.1 / JMS 2.0 | `javax.jms` | legacy Spring 4/5, Boot 1/2, Java 8/11 enterprise app lama | Banyak sistem production masih di sini |
| Jakarta EE / Jakarta Messaging 3.x | `jakarta.jms` | Spring Framework 6/7, Boot 3/4, modern Jakarta runtime | Namespace berubah, binary incompatible dengan `javax.jms` |

Perubahan dari `javax.jms` ke `jakarta.jms` bukan rename kosmetik.

Ini berdampak ke:

- import source code,
- dependency artifact,
- provider client library,
- Spring version,
- application server version,
- embedded broker compatibility,
- test utilities,
- transitive dependencies,
- deployment runtime.

Contoh:

```java
// Legacy
import javax.jms.Message;
import javax.jms.Session;

// Modern
import jakarta.jms.Message;
import jakarta.jms.Session;
```

Source migration terlihat mudah.

Runtime migration bisa sulit karena seluruh dependency graph harus konsisten.

---

### 2.2 Spring generation matrix

Secara besar:

| Stack | JMS namespace | Java baseline umum | Catatan |
|---|---:|---:|---|
| Spring Framework 5.x / Spring Boot 2.x | `javax.jms` | Java 8/11/17 tergantung versi | Cocok untuk legacy Java EE JMS clients |
| Spring Framework 6.x / Spring Boot 3.x | `jakarta.jms` | Java 17+ | Modern Jakarta namespace |
| Spring Framework 7.x / Spring Boot 4.x | `jakarta.jms` | Java modern | Generasi lebih baru, perlu cek compatibility provider |

Prinsip engineering:

> Jangan mencampur `javax.jms` dan `jakarta.jms` dalam satu application boundary kecuali benar-benar tahu classloader dan adapter layer-nya.

Masalah yang sering muncul:

```text
ClassCastException
NoClassDefFoundError
NoSuchMethodError
BeanCreationException
Provider client incompatible
Auto-configuration tidak aktif
Listener container gagal start
```

Contoh jebakan:

- aplikasi Boot 3 menggunakan `jakarta.jms`, tetapi broker client dependency masih hanya menyediakan `javax.jms`.
- library internal masih expose `javax.jms.Message` di public API.
- test embedded broker menggunakan artifact lama.
- app server menyediakan Jakarta Messaging, tetapi aplikasi membawa JMS API jar lama.

---

### 2.3 Java 8 sampai Java 25: apa yang berubah untuk JMS?

JMS sendiri bukan fitur JDK.

JMS/Jakarta Messaging adalah API/library eksternal, bukan bagian dari Java SE.

Dampak Java version lebih banyak pada:

- Spring version yang bisa dipakai,
- broker client compatibility,
- TLS defaults,
- GC behavior,
- virtual threads consideration,
- module path/classpath,
- container image baseline,
- runtime observability,
- performance profile.

Ringkasnya:

| Java version | Implikasi JMS/Spring |
|---:|---|
| Java 8 | Umumnya legacy `javax.jms`, Spring 5/Boot 2 atau lebih lama; hati-hati TLS/cipher dan old provider clients |
| Java 11 | Bridge era; banyak sistem enterprise masih `javax.jms`; module system sudah ada tapi biasanya tetap classpath |
| Java 17 | Baseline Spring 6/Boot 3; masuk dunia `jakarta.jms` |
| Java 21 | Virtual threads tersedia; JMS listener container tetap perlu diuji karena provider/session model tidak otomatis cocok dengan virtual thread semantics |
| Java 25 | Runtime modern; tetap perlukan provider support, benchmark, dan compatibility test |

Mental model:

```text
Java version affects runtime envelope.
JMS semantics remain governed by JMS provider + Spring configuration + application design.
```

---

## 3. Spring JMS Building Blocks

### 3.1 Komponen utama

Spring JMS biasanya melibatkan:

| Komponen | Fungsi |
|---|---|
| `ConnectionFactory` | Factory dari provider untuk membuat koneksi JMS |
| `JmsTemplate` | Helper/template untuk send/receive synchronous |
| `JmsMessagingTemplate` | Integrasi dengan Spring Messaging abstraction |
| `MessageConverter` | Convert Java object ke JMS Message dan sebaliknya |
| `DestinationResolver` | Resolve nama destination menjadi Queue/Topic object |
| `MessageListenerContainer` | Runtime container untuk consume message asynchronous |
| `DefaultMessageListenerContainer` | Listener container paling umum dan production-oriented |
| `SimpleMessageListenerContainer` | Container lebih sederhana, lebih sedikit fitur |
| `@JmsListener` | Annotation-driven listener endpoint |
| `JmsListenerContainerFactory` | Factory konfigurasi listener container |
| `JmsTransactionManager` | Local JMS transaction manager |
| `JtaTransactionManager` | XA/JTA transaction manager untuk distributed transaction |
| `CachingConnectionFactory` | Spring wrapper untuk cache JMS resources |

Diagram:

```text
Outbound
========
Service
  |
  v
JmsTemplate
  |
  | uses converter + destination resolver
  v
ConnectionFactory
  |
  v
Provider client -> Broker

Inbound
=======
Broker -> Provider client
  |
  v
MessageListenerContainer
  |
  | invokes
  v
@JmsListener / MessageListener / adapter
  |
  v
Application handler
```

---

### 3.2 `ConnectionFactory`: abstraction paling penting

Semua dimulai dari `ConnectionFactory`.

Spring tidak bisa mengirim atau menerima JMS message tanpa `ConnectionFactory`.

Ada beberapa jenis:

1. provider native connection factory,
2. pooled connection factory dari provider/library,
3. Spring `CachingConnectionFactory`,
4. JNDI-provided connection factory di app server,
5. XA-capable connection factory,
6. custom wrapped connection factory untuk observability/security.

Contoh mental model:

```text
ConnectionFactory is not just config.
It represents how your app enters broker runtime.
```

Pertanyaan production:

- Apakah connection factory mendukung reconnect?
- Apakah connection factory XA-capable?
- Apakah username/password/TLS config benar?
- Apakah connection pooling dilakukan di provider, Spring, atau app server?
- Apakah wrapper caching bertabrakan dengan provider pooling?
- Apakah listener dan template memakai factory yang sama?
- Apakah connection factory cocok untuk queue dan topic?
- Apakah credentials punya permission minimum?

---

### 3.3 `JmsTemplate`: template pattern untuk send/receive

`JmsTemplate` adalah facade utama Spring untuk operasi JMS imperative.

Ia membantu:

- membuat/mengambil connection,
- membuat session,
- membuat producer/consumer sementara,
- mengirim message,
- menerima message synchronous,
- melakukan conversion,
- translate checked `JMSException` menjadi runtime exception Spring,
- ikut transaction synchronization bila tersedia.

Contoh producer sederhana:

```java
@Service
public class OrderCommandPublisher {

    private final JmsTemplate jmsTemplate;

    public OrderCommandPublisher(JmsTemplate jmsTemplate) {
        this.jmsTemplate = jmsTemplate;
    }

    public void publishCreateOrder(CreateOrderCommand command) {
        jmsTemplate.convertAndSend("order.command.create", command);
    }
}
```

Tetapi kode ini belum cukup production-ready karena belum menjawab:

- format payload apa?
- message type apa?
- correlation id dari mana?
- idempotency key dikirim di property/header atau body?
- TTL berapa?
- delivery mode persistent atau non-persistent?
- bagaimana jika send gagal?
- apakah command sudah tersimpan di DB?
- apakah butuh outbox?
- apakah broker destination sudah dikelola secara IaC/config?

Template membuat kode ringkas.

Bukan berarti desain selesai.

---

### 3.4 `MessageListenerContainer`: runtime engine untuk consumer

Consumer Spring biasanya berjalan melalui listener container.

Tanpa Spring, kita mungkin membuat manual:

```java
connection.start();
consumer.setMessageListener(message -> {
    // process
});
```

Dengan Spring:

```java
@JmsListener(destination = "order.command.create")
public void onMessage(CreateOrderCommand command) {
    orderService.handle(command);
}
```

Di balik annotation itu ada listener container.

Listener container bertanggung jawab atas:

- membuat connection/session/consumer,
- subscribe ke destination,
- menjalankan receive loop,
- memanggil handler,
- mengelola concurrency,
- menangani exception,
- melakukan ack/commit/rollback sesuai config,
- recovery setelah connection failure,
- shutdown lifecycle.

Top 1% engineer tidak melihat `@JmsListener` sebagai magic method.

Mereka melihatnya sebagai endpoint yang dijalankan oleh runtime loop dengan transaction/ack/concurrency semantics.

---

## 4. Outbound: `JmsTemplate` Deep Dive

### 4.1 Operasi utama `JmsTemplate`

Operasi umum:

```java
jmsTemplate.send(destinationName, session -> {
    TextMessage message = session.createTextMessage(payload);
    message.setStringProperty("eventType", "OrderCreated");
    return message;
});
```

```java
jmsTemplate.convertAndSend("order.events", event);
```

```java
Object reply = jmsTemplate.convertSendAndReceive("order.rpc", request);
```

```java
Message message = jmsTemplate.receive("some.queue");
```

Untuk production, operasi yang paling sering direkomendasikan:

- `send` bila butuh kontrol penuh terhadap JMS message,
- `convertAndSend` bila converter/envelope sudah standar,
- hindari `receive` blocking di request thread kecuali memang desainnya polling/synchronous integration,
- berhati-hati dengan `convertSendAndReceive` karena mudah menjadi RPC-over-JMS anti-pattern.

---

### 4.2 `send` vs `convertAndSend`

`send` memberi kontrol penuh:

```java
jmsTemplate.send("case.command.escalate", session -> {
    TextMessage message = session.createTextMessage(jsonPayload);
    message.setStringProperty("messageType", "CaseEscalationRequested");
    message.setStringProperty("schemaVersion", "1");
    message.setStringProperty("correlationId", correlationId);
    message.setStringProperty("idempotencyKey", idempotencyKey);
    message.setStringProperty("tenantId", tenantId);
    return message;
});
```

`convertAndSend` lebih singkat:

```java
jmsTemplate.convertAndSend("case.command.escalate", command);
```

`convertAndSend` cocok jika:

- converter sudah distandarkan,
- semua message memakai envelope yang sama,
- metadata ditambahkan via `MessagePostProcessor`,
- tidak butuh custom JMS body manual.

Contoh dengan `MessagePostProcessor`:

```java
jmsTemplate.convertAndSend(
        "case.command.escalate",
        command,
        message -> {
            message.setStringProperty("messageType", "CaseEscalationRequested");
            message.setStringProperty("schemaVersion", "1");
            message.setStringProperty("correlationId", correlationId);
            message.setStringProperty("idempotencyKey", idempotencyKey);
            return message;
        }
);
```

Rule of thumb:

```text
Use convertAndSend for standardized payload pipelines.
Use send when message-level control is part of the correctness requirement.
```

---

### 4.3 Default destination vs explicit destination

`JmsTemplate` bisa punya default destination.

```java
jmsTemplate.setDefaultDestinationName("order.commands");
```

Lalu:

```java
jmsTemplate.convertAndSend(command);
```

Ini ringkas tetapi berbahaya untuk aplikasi besar.

Masalah:

- tujuan tidak terlihat di call site,
- refactor sulit,
- multi-destination publisher rawan salah kirim,
- testing bisa ambigu,
- observability kurang jelas.

Untuk sistem enterprise, sering lebih baik explicit:

```java
jmsTemplate.convertAndSend(Destinations.ORDER_COMMANDS, command);
```

Atau gunakan publisher class per destination:

```java
@Component
public class OrderCommandPublisher {
    private static final String DESTINATION = "order.commands";

    public void send(CreateOrderCommand command) {
        jmsTemplate.convertAndSend(DESTINATION, command, enrich(command));
    }
}
```

Dengan begitu destination adalah bagian dari contract.

---

### 4.4 Delivery options di `JmsTemplate`

Beberapa opsi penting:

- delivery persistent/non-persistent,
- priority,
- time-to-live,
- delivery delay,
- receive timeout,
- explicit QoS enabled.

Contoh:

```java
@Bean
JmsTemplate commandJmsTemplate(ConnectionFactory connectionFactory) {
    JmsTemplate template = new JmsTemplate(connectionFactory);
    template.setExplicitQosEnabled(true);
    template.setDeliveryPersistent(true);
    template.setTimeToLive(5 * 60 * 1000L); // 5 minutes
    template.setPriority(4);
    template.setReceiveTimeout(2_000L);
    return template;
}
```

Penting: beberapa setting hanya berlaku jika explicit QoS diaktifkan.

Production reasoning:

| Setting | Pertanyaan desain |
|---|---|
| persistent | Apakah message boleh hilang saat broker crash? |
| TTL | Apakah message basi lebih berbahaya daripada hilang? |
| priority | Apakah broker/provider benar-benar menghormati priority? Apakah priority dapat merusak ordering? |
| delivery delay | Apakah delay dipakai untuk retry? Apakah lebih baik broker redelivery policy? |
| receive timeout | Apakah thread boleh blocking? |

---

### 4.5 Exception handling pada producer

Spring mengubah `JMSException` checked menjadi runtime exception, biasanya turunan `JmsException`.

Contoh:

```java
try {
    jmsTemplate.convertAndSend("case.events", event);
} catch (JmsException ex) {
    // send failed or uncertain
    throw new MessagePublishException("Failed to publish case event", ex);
}
```

Namun top 1% reasoning:

> Producer exception tidak selalu berarti message pasti tidak terkirim.

Failure window:

```text
App sends message
Broker receives and persists message
Network fails before client receives success response
Client sees exception/timeout
```

Dalam kasus ini message bisa sudah ada di broker.

Jika aplikasi retry blindly, duplicate bisa terjadi.

Karena itu producer harus dirancang dengan:

- idempotency key,
- event id,
- outbox table,
- broker duplicate detection jika provider mendukung,
- dedup di consumer,
- publish status yang tidak mengasumsikan certainty berlebihan.

---

## 5. Message Conversion and Contract

### 5.1 `MessageConverter`

Spring `MessageConverter` mengubah object Java menjadi JMS `Message` dan sebaliknya.

Common converter:

- `SimpleMessageConverter`,
- `MappingJackson2MessageConverter`,
- custom converter.

`SimpleMessageConverter` biasanya nyaman untuk tipe sederhana:

- `String` -> `TextMessage`,
- `byte[]` -> `BytesMessage`,
- `Map` -> `MapMessage`,
- `Serializable` -> `ObjectMessage`.

Tetapi untuk production enterprise, hati-hati dengan `ObjectMessage`.

Alasan:

- Java serialization security risk,
- tight coupling antar class Java,
- versioning buruk,
- sulit dipakai cross-language,
- migration Java/package/class sulit,
- tidak cocok untuk long-lived event contract.

Lebih aman:

```text
Java object
  -> JSON/Avro/Protobuf bytes/string
  -> TextMessage/BytesMessage
  -> explicit messageType/schemaVersion properties
```

---

### 5.2 JSON converter dengan type id

Contoh konfigurasi modern:

```java
@Bean
MessageConverter jacksonJmsMessageConverter(ObjectMapper objectMapper) {
    MappingJackson2MessageConverter converter = new MappingJackson2MessageConverter();
    converter.setObjectMapper(objectMapper);
    converter.setTargetType(MessageType.TEXT);
    converter.setTypeIdPropertyName("messageType");
    return converter;
}
```

Producer:

```java
jmsTemplate.convertAndSend("case.events", event, message -> {
    message.setStringProperty("messageType", "CaseEscalated.v1");
    message.setStringProperty("schemaVersion", "1");
    message.setStringProperty("correlationId", correlationId);
    message.setStringProperty("eventId", event.eventId().toString());
    return message;
});
```

Consumer:

```java
@JmsListener(destination = "case.events")
public void onCaseEscalated(CaseEscalated event) {
    handler.handle(event);
}
```

Namun ada jebakan:

- type id mapping tidak boleh expose arbitrary class name dari untrusted message,
- converter harus dikunci ke mapping yang eksplisit,
- unknown message type harus masuk DLQ/quarantine atau ignored sesuai contract,
- schema evolution harus diuji.

Top 1% design:

```text
Message type is business contract, not Java class leakage.
```

Jangan jadikan message property berisi class internal seperti:

```text
com.company.module.caseapp.internal.dto.CaseEscalatedEvent
```

Lebih baik:

```text
CaseEscalated.v1
case.escalated
case-escalated/1
```

---

### 5.3 Custom envelope converter

Untuk sistem besar, biasanya lebih stabil memakai envelope.

Contoh payload JSON:

```json
{
  "metadata": {
    "messageId": "01J...",
    "messageType": "CaseEscalated",
    "schemaVersion": 1,
    "correlationId": "corr-123",
    "causationId": "cmd-456",
    "tenantId": "cea",
    "occurredAt": "2026-06-18T10:15:30Z"
  },
  "data": {
    "caseId": "CASE-2026-0001",
    "fromStage": "ASSESSMENT",
    "toStage": "ENFORCEMENT_REVIEW",
    "reason": "SLA_BREACHED"
  }
}
```

JMS properties bisa tetap berisi metadata indexing/routing:

```text
messageType=CaseEscalated
schemaVersion=1
correlationId=corr-123
tenantId=cea
aggregateType=Case
aggregateId=CASE-2026-0001
```

Kenapa metadata ada di body dan property?

- body untuk durable contract,
- property untuk broker selector/routing/observability,
- header untuk JMS runtime metadata.

Rule:

```text
JMS property is an index/control hint.
Payload envelope is the source of semantic truth.
```

---

## 6. Inbound: `@JmsListener` and Listener Container

### 6.1 Annotation is endpoint declaration

Contoh:

```java
@Component
public class CaseCommandListener {

    private final CaseCommandHandler handler;

    public CaseCommandListener(CaseCommandHandler handler) {
        this.handler = handler;
    }

    @JmsListener(destination = "case.command.escalate", containerFactory = "commandListenerFactory")
    public void onCommand(CaseEscalationRequested command) {
        handler.handle(command);
    }
}
```

`@JmsListener` bukan thread.

`@JmsListener` bukan consumer object langsung.

`@JmsListener` adalah endpoint metadata yang didaftarkan ke listener infrastructure.

Listener container yang melakukan kerja runtime.

---

### 6.2 Listener method signature

Spring mendukung beberapa bentuk parameter.

Contoh hanya payload:

```java
@JmsListener(destination = "case.events")
public void onEvent(CaseEscalated event) {
    ...
}
```

Payload + headers:

```java
@JmsListener(destination = "case.events")
public void onEvent(
        CaseEscalated event,
        @Header("correlationId") String correlationId,
        @Header("eventId") String eventId) {
    ...
}
```

Raw JMS message:

```java
@JmsListener(destination = "case.events")
public void onMessage(jakarta.jms.Message message) throws JMSException {
    String correlationId = message.getStringProperty("correlationId");
    ...
}
```

Session-aware:

```java
@JmsListener(destination = "case.requests")
public void onRequest(Message request, Session session) {
    ...
}
```

Recommendation:

| Style | Use when |
|---|---|
| payload-only | simple internal contract, converter trusted |
| payload + selected headers | common production default |
| raw JMS `Message` | need exact JMS metadata/control |
| `Session` parameter | advanced reply/transaction integration |

Top 1% rule:

> Do not hide metadata if metadata is part of correctness.

If handler needs idempotency/correlation/tenant/schema, pass them explicitly through a command envelope or header object.

---

### 6.3 `DefaultMessageListenerContainer`

`DefaultMessageListenerContainer` atau DMLC adalah listener container yang paling sering dipakai untuk production Spring JMS.

Ia melakukan:

- connection/session/consumer management,
- async receive loop,
- invoker threads,
- dynamic scaling within configured bounds,
- recovery after failure,
- transaction integration,
- lifecycle management.

Konfigurasi umum:

```java
@Bean
DefaultJmsListenerContainerFactory commandListenerFactory(
        ConnectionFactory connectionFactory,
        MessageConverter messageConverter,
        ErrorHandler jmsErrorHandler) {

    DefaultJmsListenerContainerFactory factory = new DefaultJmsListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setMessageConverter(messageConverter);
    factory.setErrorHandler(jmsErrorHandler);
    factory.setSessionTransacted(true);
    factory.setConcurrency("3-10");
    factory.setReceiveTimeout(2_000L);
    return factory;
}
```

Mental model `concurrency="3-10"`:

```text
minimum concurrent consumers: 3
maximum concurrent consumers: 10
actual behavior: container/provider dependent dynamic scaling based on workload
```

Jangan menaikkan concurrency tanpa memahami:

- ordering,
- database connection pool,
- downstream capacity,
- CPU budget,
- prefetch,
- transaction duration,
- lock contention,
- idempotency store contention.

---

### 6.4 Simple vs Default listener container

Ringkas:

| Container | Karakter |
|---|---|
| `SimpleMessageListenerContainer` | sederhana, fixed consumers, minimal dynamic behavior |
| `DefaultMessageListenerContainer` | lebih kaya fitur, recovery, scaling, transaction support lebih production-oriented |

Untuk enterprise systems, DMLC biasanya default choice.

Namun “lebih powerful” bukan berarti selalu lebih benar.

Jika workload strict, predictable, dan ingin fixed concurrency, konfigurasi harus eksplisit.

---

## 7. Ack and Transaction Semantics in Spring Listener

### 7.1 Spring listener default bisa menipu

Jangan mengasumsikan:

```text
@JmsListener + exception = message automatically redelivered correctly
```

Behavior tergantung:

- session transacted atau tidak,
- acknowledge mode,
- transaction manager,
- listener container type,
- error handler,
- broker redelivery policy,
- exception propagation,
- provider behavior.

---

### 7.2 `sessionTransacted=true`

Konfigurasi penting:

```java
factory.setSessionTransacted(true);
```

Dengan local JMS transaction, pola dasarnya:

```text
receive message
invoke listener
if listener returns normally:
    commit JMS session
if listener throws exception:
    rollback JMS session
    broker may redeliver based on policy
```

Ini bagus untuk menyelaraskan:

- receive,
- send reply/output JMS message dalam session yang sama,
- ack/rollback message.

Tetapi local JMS transaction **tidak otomatis mencakup database transaction**.

Jika handler melakukan DB update dengan transaction sendiri:

```text
JMS local transaction
    receive input message
    listener starts DB transaction
        update case status
    DB commit success
    listener then fails before JMS commit
JMS rollback
message redelivered
DB side effect already committed
```

Maka duplicate handling tetap wajib.

---

### 7.3 `JmsTransactionManager`

`JmsTransactionManager` mengelola local JMS transaction dalam Spring transaction infrastructure.

Cocok untuk:

- hanya operasi JMS dalam transaction,
- receive message lalu send message lain dalam JMS resource yang sama,
- tidak perlu atomic DB+JMS.

Tidak cukup untuk:

- atomic commit DB + JMS broker,
- distributed transaction multi-resource,
- exactly-once business processing.

Contoh:

```java
@Bean
JmsTransactionManager jmsTransactionManager(ConnectionFactory connectionFactory) {
    return new JmsTransactionManager(connectionFactory);
}
```

Listener factory:

```java
factory.setTransactionManager(jmsTransactionManager);
factory.setSessionTransacted(true);
```

Tetapi hati-hati: konfigurasi transaction manager dan `sessionTransacted` harus dipahami dari dokumentasi Spring version yang dipakai.

---

### 7.4 `JtaTransactionManager` and XA

Untuk atomic DB + JMS, opsi klasik adalah JTA/XA.

```text
JTA transaction
    DB update
    JMS ack/send
2PC commit
```

Namun trade-off XA:

- latency lebih tinggi,
- kompleksitas operasional,
- recovery log,
- heuristic outcome,
- transaction timeout,
- konfigurasi provider sulit,
- tidak semua environment cloud-native nyaman,
- debugging lebih berat.

Karena itu di microservice modern, banyak sistem lebih memilih:

- transactional outbox,
- transactional inbox,
- idempotent consumer,
- retry/replay governance,
- eventual consistency.

Rule:

```text
Use XA only when the operational organization can support XA recovery.
Do not choose XA only because it sounds more correct.
```

---

### 7.5 Listener exception must propagate for rollback

Anti-pattern:

```java
@JmsListener(destination = "case.commands")
public void onMessage(CaseCommand command) {
    try {
        handler.handle(command);
    } catch (Exception ex) {
        log.error("Failed", ex);
        // swallowed
    }
}
```

Jika exception ditelan, container melihat listener sukses.

Akibat:

```text
message may be acknowledged/committed
business operation failed silently
no redelivery
no DLQ
```

Correct pattern:

```java
@JmsListener(destination = "case.commands")
public void onMessage(CaseCommand command) {
    handler.handle(command); // let exception propagate if failure must rollback
}
```

Atau classify exception:

```java
@JmsListener(destination = "case.commands")
public void onMessage(CaseCommand command) {
    try {
        handler.handle(command);
    } catch (NonRetryableBusinessException ex) {
        deadLetterPublisher.publish(command, ex);
        // return normally only if you intentionally consume and route elsewhere
    } catch (Exception ex) {
        throw ex; // retryable / unknown failure
    }
}
```

Tetapi explicit consume-and-route harus punya audit trail.

---

## 8. Error Handler vs Business Failure Handling

### 8.1 `ErrorHandler` bukan business retry engine

Spring listener factory dapat diberi `ErrorHandler`:

```java
@Bean
ErrorHandler jmsErrorHandler() {
    return throwable -> {
        log.error("JMS listener failed", throwable);
    };
}
```

`ErrorHandler` berguna untuk:

- logging unhandled listener exception,
- metrics,
- alerting,
- capturing container-level failure,
- preventing silent swallowed errors.

Tetapi jangan salah:

```text
ErrorHandler is not your main redelivery policy.
```

Redelivery biasanya dikontrol oleh:

- JMS transaction rollback,
- acknowledge behavior,
- broker redelivery policy,
- DLQ config,
- application exception propagation.

Jika `ErrorHandler` hanya log tetapi listener exception tetap menyebabkan rollback, redelivery berjalan sesuai config.

Jika handler menelan exception sebelum sampai container, `ErrorHandler` tidak membantu.

---

### 8.2 Error classification

Error pada listener sebaiknya diklasifikasikan:

| Error type | Contoh | Strategy |
|---|---|---|
| transient infrastructure | DB timeout, broker temporary issue, downstream 503 | rollback/retry with backoff |
| permanent business invalid | unknown case id, invalid transition, schema unsupported | DLQ/quarantine/manual review |
| poison message | payload corrupt, violates contract | DLQ immediately or after limited redelivery |
| duplicate | idempotency key already processed | ack/commit safely |
| stale message | TTL expired semantically, state already advanced | ack with audit or route to stale bucket |
| programming bug | NullPointerException, unexpected invariant break | retry limited, DLQ, alert team |

Do not treat all exceptions the same.

---

### 8.3 Avoid infinite redelivery storm

Failure scenario:

```text
Consumer receives poison message
Listener throws exception
JMS session rolls back
Broker redelivers immediately
Listener fails again
Cycle repeats thousands of times
CPU/logs/DB overwhelmed
Queue blocked
```

Mitigation:

- broker redelivery delay,
- max delivery attempts,
- DLQ,
- app-level classification,
- idempotency,
- poison message alert,
- parking lot queue,
- replay tooling.

Spring side alone is not enough.

Broker policy must be configured.

---

## 9. Connection Caching, Pooling, and Resource Management

### 9.1 Why caching matters

Creating JMS connection/session/producer repeatedly can be expensive.

Spring provides `CachingConnectionFactory`.

Example:

```java
@Bean
CachingConnectionFactory cachingConnectionFactory(ConnectionFactory targetConnectionFactory) {
    CachingConnectionFactory factory = new CachingConnectionFactory(targetConnectionFactory);
    factory.setSessionCacheSize(10);
    factory.setCacheConsumers(false);
    factory.setCacheProducers(true);
    return factory;
}
```

But caching is subtle.

Questions:

- Is provider already pooling?
- Is app server already pooling via resource adapter?
- Are you using XA?
- Are cached consumers compatible with dynamic destination/security changes?
- Is session cache size aligned with listener concurrency?
- Are producers cached safely for your provider?
- Are stale connections recovered correctly?

---

### 9.2 Caching vs pooling

Caching and pooling are different.

```text
Caching:
    keep recently used resource for reuse by same abstraction layer

Pooling:
    manage bounded shared resource pool with checkout/checkin semantics
```

In Spring Boot application outside app server:

```text
Provider ConnectionFactory
    maybe wrapped by provider pool
        maybe wrapped by Spring CachingConnectionFactory
            used by JmsTemplate/listener container
```

Too many wrappers can cause unexpected behavior.

Top 1% rule:

> Have exactly one intentional resource reuse strategy. Do not accidentally stack three pooling/caching layers.

---

### 9.3 Listener container and caching

DMLC itself manages consumers/sessions for listener execution.

If you also wrap connection factory with caching, understand interaction.

Potential issues:

- session cache too small causing churn,
- session cache too large holding resources unnecessarily,
- cached consumers not reflecting broker-side config changes,
- stale connection after failover,
- XA/session lifecycle mismatch.

Practical default:

- use provider/app-server recommended connection factory setup,
- use Spring caching for `JmsTemplate` outbound path if appropriate,
- configure listener container intentionally,
- test broker restart and failover.

---

## 10. Spring Boot Auto-Configuration

### 10.1 What Boot gives you

Spring Boot can auto-configure JMS infrastructure when relevant dependencies are present.

Usually Boot may configure:

- `ConnectionFactory`,
- `JmsTemplate`,
- `JmsMessagingTemplate`,
- listener container factory,
- destination resolver/converter if beans exist,
- ActiveMQ/Artemis integration depending on classpath and properties.

Example dependency idea for modern Boot/Artemis:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-artemis</artifactId>
</dependency>
```

Configuration example:

```yaml
spring:
  artemis:
    mode: native
    broker-url: tcp://broker:61616
    user: ${JMS_USERNAME}
    password: ${JMS_PASSWORD}
  jms:
    listener:
      acknowledge-mode: auto
      concurrency: 3
      max-concurrency: 10
    template:
      default-destination: case.events
      delivery-mode: persistent
      receive-timeout: 2s
```

Exact properties depend on Spring Boot version.

Do not blindly copy config across Boot 2, 3, and 4.

---

### 10.2 Boot auto-config is a starting point, not architecture

Boot default is useful for:

- local development,
- simple service,
- conventional setup,
- reducing boilerplate.

For production, explicitly review:

- broker URL,
- credentials source,
- TLS,
- connection factory bean,
- converter,
- destination names,
- listener concurrency,
- transaction manager,
- error handler,
- redelivery/DLQ policy,
- observability hooks,
- graceful shutdown.

Production config should be intentional, not accidental.

---

### 10.3 Multiple templates and factories

Large systems often need different behavior per message class.

Example:

| Use case | Template/factory behavior |
|---|---|
| command | persistent, short TTL optional, strict transaction/idempotency |
| event | persistent, no request reply, schema envelope |
| notification | maybe lower priority, longer retry, different DLQ |
| audit | durable, high reliability, append-only semantics |
| temporary integration | explicit timeout, limited concurrency |

Define separate beans:

```java
@Bean
JmsTemplate commandJmsTemplate(ConnectionFactory cf, MessageConverter converter) {
    JmsTemplate template = new JmsTemplate(cf);
    template.setMessageConverter(converter);
    template.setExplicitQosEnabled(true);
    template.setDeliveryPersistent(true);
    template.setTimeToLive(300_000L);
    return template;
}

@Bean
JmsTemplate auditJmsTemplate(ConnectionFactory cf, MessageConverter converter) {
    JmsTemplate template = new JmsTemplate(cf);
    template.setMessageConverter(converter);
    template.setExplicitQosEnabled(true);
    template.setDeliveryPersistent(true);
    template.setTimeToLive(0L); // never expire at JMS TTL layer
    return template;
}
```

Listener factories:

```java
@Bean
DefaultJmsListenerContainerFactory commandListenerFactory(...) {
    DefaultJmsListenerContainerFactory factory = new DefaultJmsListenerContainerFactory();
    factory.setConcurrency("4-16");
    factory.setSessionTransacted(true);
    ...
    return factory;
}

@Bean
DefaultJmsListenerContainerFactory auditListenerFactory(...) {
    DefaultJmsListenerContainerFactory factory = new DefaultJmsListenerContainerFactory();
    factory.setConcurrency("1-4");
    factory.setSessionTransacted(true);
    ...
    return factory;
}
```

Usage:

```java
@JmsListener(destination = "case.commands", containerFactory = "commandListenerFactory")
public void onCommand(CaseCommand command) { ... }

@JmsListener(destination = "case.audit", containerFactory = "auditListenerFactory")
public void onAudit(AuditEvent event) { ... }
```

---

## 11. Concurrency and Throughput Engineering

### 11.1 Listener concurrency is not free

Increasing concurrency means:

```text
more sessions
more consumers
more prefetched messages
more DB transactions
more locks
more CPU context switching
more downstream calls
more duplicate/idempotency pressure
less ordering guarantee
```

Example:

```java
factory.setConcurrency("10-50");
```

This is not a performance fix by itself.

It may:

- overwhelm DB pool,
- break per-entity ordering,
- increase deadlock,
- increase redelivery burst after failure,
- make incident harder to debug.

---

### 11.2 Capacity equation

Use simple queueing model:

```text
arrival_rate = messages per second entering queue
service_time = average processing time per message
service_rate_per_consumer = 1 / service_time
required_consumers = arrival_rate / service_rate_per_consumer
```

Example:

```text
arrival_rate = 100 msg/s
average handler time = 200 ms = 0.2 s
service_rate_per_consumer = 5 msg/s
required consumers = 100 / 5 = 20
```

Then add headroom:

```text
target consumers = 25-30
```

But check:

- DB can handle 25 concurrent transactions?
- downstream API can handle 25 concurrent calls?
- broker prefetch will buffer how many messages?
- ordering constraints allow this?
- host CPU/memory can handle it?

---

### 11.3 Concurrency and ordering

If destination contains messages for many aggregate ids:

```text
caseId=A message 1
caseId=B message 1
caseId=A message 2
caseId=C message 1
```

With concurrency > 1, `A message 2` may process before `A message 1` completes unless broker-level grouping/partitioning is used.

Options:

1. single consumer for strict global ordering,
2. message group per aggregate,
3. partitioned queue by aggregate hash,
4. idempotent state transition with version check,
5. tolerate reorder and repair.

Spring concurrency is only consumer count.

It is not ordering design.

---

### 11.4 Prefetch interaction

Broker/client may prefetch messages to consumer.

If concurrency = 10 and prefetch = 100:

```text
up to 1000 messages may be sitting client-side/in-flight-ish
```

Consequences:

- queue depth appears lower than actual unprocessed work,
- shutdown/rebalance slower,
- one consumer instance can hoard messages,
- redelivery after crash comes in burst,
- fairness can degrade.

Spring config may not expose all provider-specific prefetch options directly.

Often configured in broker URL/provider connection factory.

---

## 12. Request/Reply with Spring JMS

### 12.1 `convertSendAndReceive`

Spring supports request/reply:

```java
OrderValidationResponse response = (OrderValidationResponse)
        jmsTemplate.convertSendAndReceive("order.validate", request);
```

This is convenient.

But dangerous if overused.

It creates synchronous waiting over async infrastructure.

Risks:

- request thread blocked,
- timeout complexity,
- late reply,
- duplicate reply,
- temporary destination leak if misconfigured,
- broker dependency on API latency path,
- harder tracing,
- cascade failure under load.

Use for:

- legacy integration,
- controlled back-office flow,
- low QPS command validation,
- bridge to existing JMS system.

Avoid for:

- high-QPS service-to-service RPC,
- user-facing request latency path,
- systems where HTTP/gRPC would be clearer,
- long-running workflow.

---

### 12.2 Explicit timeout

Always set timeout.

```java
jmsTemplate.setReceiveTimeout(3_000L);
```

Then handle null/timeout explicitly:

```java
Object response = jmsTemplate.convertSendAndReceive("case.check", request);
if (response == null) {
    throw new CaseCheckTimeoutException("No JMS reply within timeout");
}
```

Do not wait forever.

---

## 13. Observability in Spring JMS

### 13.1 What to log

For each message processing attempt:

- destination,
- message type,
- message id,
- correlation id,
- causation id,
- idempotency key,
- aggregate id,
- redelivery flag,
- delivery count if provider exposes it,
- handler duration,
- outcome,
- exception classification.

Example log fields:

```json
{
  "event": "jms_message_processed",
  "destination": "case.command.escalate",
  "messageType": "CaseEscalationRequested",
  "correlationId": "corr-123",
  "idempotencyKey": "cmd-456",
  "aggregateId": "CASE-2026-001",
  "redelivered": false,
  "durationMs": 148,
  "outcome": "SUCCESS"
}
```

Do not log sensitive payload by default.

---

### 13.2 Metrics

Application-level metrics:

- consumed count,
- successful count,
- failed count,
- retryable failure count,
- non-retryable failure count,
- duplicate count,
- processing duration histogram,
- handler DB duration,
- external call duration,
- in-flight message count,
- listener active consumers,
- listener idle consumers.

Broker-level metrics:

- queue depth,
- enqueue rate,
- dequeue rate,
- consumer count,
- delivering count,
- scheduled count,
- expired count,
- DLQ depth,
- redelivery count,
- paging status,
- journal sync latency,
- connection count.

Top 1% insight:

> App metrics tell you handler behavior. Broker metrics tell you messaging substrate behavior. You need both.

---

### 13.3 Tracing

JMS tracing requires propagation.

Common strategy:

- put trace id/correlation id in JMS properties,
- extract in listener,
- put into MDC/log context,
- start consumer span,
- link producer span if trace context exists.

Pseudo-code:

```java
@JmsListener(destination = "case.events")
public void onMessage(MessageEnvelope<CaseEscalated> envelope) {
    try (MdcScope ignored = MdcScope.put("correlationId", envelope.metadata().correlationId())) {
        handler.handle(envelope);
    }
}
```

Trace context must survive asynchronous boundary.

Do not rely on thread-local continuity from producer to consumer.

---

## 14. Graceful Shutdown

### 14.1 Why shutdown matters

If application shuts down while processing message:

```text
message received
handler running
SIGTERM received
container stops
DB transaction maybe mid-flight
JMS session maybe rollback/commit uncertain
pod killed after grace period
message may redeliver
side effect may be partial
```

Spring lifecycle helps, but configuration matters.

Production checklist:

- Kubernetes termination grace period > max handler time,
- listener container stops accepting new messages before app exits,
- in-flight processing allowed to finish or rollback cleanly,
- DB transaction timeout < shutdown grace period,
- idempotency handles duplicate after forced kill,
- readiness probe turns false before termination,
- broker consumer disconnect behavior tested.

---

### 14.2 Stop semantics

During shutdown you want:

```text
1. mark app not ready
2. stop new inbound HTTP traffic
3. stop listener containers from receiving new messages
4. let in-flight handlers complete within budget
5. commit/rollback cleanly
6. close connections
7. exit
```

Do not assume default shutdown is enough for regulated workload.

Test it.

---

## 15. Testing Spring JMS

### 15.1 Unit test handler without JMS

Business handler should be testable without broker.

```java
class CaseCommandHandlerTest {

    @Test
    void escalatesCaseWhenCommandIsValid() {
        // given
        // when
        handler.handle(command);
        // then
    }
}
```

Listener should be thin:

```java
@JmsListener(destination = "case.commands")
public void onCommand(CaseCommand command, @Header("idempotencyKey") String key) {
    handler.handle(command, key);
}
```

This keeps JMS test surface small.

---

### 15.2 Integration test with real broker

Use real provider when semantics matter:

- ack/rollback,
- redelivery,
- DLQ,
- selector,
- transaction,
- message conversion,
- priority,
- TTL,
- failover.

Embedded broker may be okay for simple tests but can hide production differences.

For provider-specific behavior, test with same broker family/version as production.

---

### 15.3 Deterministic async test

Avoid arbitrary sleep:

```java
Thread.sleep(5000); // bad
```

Better:

```java
await()
    .atMost(Duration.ofSeconds(10))
    .untilAsserted(() -> {
        assertThat(repository.findById(caseId)).hasValueSatisfying(...);
    });
```

Even without Awaitility, write polling helper with timeout.

Do not create flaky CI by guessing timing.

---

### 15.4 Failure tests

Must-have tests:

1. listener success commits message,
2. listener exception causes redelivery or DLQ,
3. duplicate message is idempotently ignored,
4. invalid payload goes to DLQ/quarantine,
5. DB commit then JMS rollback duplicate is safe,
6. broker restart recovery,
7. app shutdown during processing,
8. selector routes correctly,
9. schema version unknown handled correctly,
10. message converter rejects unsafe type.

---

## 16. Design Patterns with Spring JMS

### 16.1 Thin listener, thick handler

Bad:

```java
@JmsListener(destination = "case.commands")
public void onMessage(CaseCommand command) {
    // parse
    // validate
    // check idempotency
    // update DB
    // publish event
    // catch exceptions
    // metrics
    // everything here
}
```

Better:

```java
@JmsListener(destination = "case.commands", containerFactory = "commandListenerFactory")
public void onMessage(CaseCommandEnvelope envelope) {
    commandProcessor.process(envelope);
}
```

Handler owns business invariant.

Listener owns adapter concerns.

---

### 16.2 Outbox publisher

Do not publish directly inside DB transaction if atomicity matters but XA is not used.

Preferred:

```text
HTTP request / internal command
    DB transaction:
        update aggregate
        insert outbox row
    commit

Outbox relay:
    read unpublished rows
    publish JMS message
    mark published
```

Spring JMS role:

```java
@Component
public class JmsOutboxRelay {

    private final JmsTemplate jmsTemplate;
    private final OutboxRepository outboxRepository;

    public void publishBatch() {
        List<OutboxRecord> records = outboxRepository.lockNextBatch(100);
        for (OutboxRecord record : records) {
            publish(record);
            outboxRepository.markPublished(record.id());
        }
    }

    private void publish(OutboxRecord record) {
        jmsTemplate.convertAndSend(record.destination(), record.payload(), message -> {
            message.setStringProperty("eventId", record.eventId());
            message.setStringProperty("messageType", record.messageType());
            message.setStringProperty("correlationId", record.correlationId());
            return message;
        });
    }
}
```

Still need duplicate-safe consumer because relay may publish then fail before mark-published.

---

### 16.3 Inbox consumer

Consumer side:

```text
receive message
start DB transaction
insert message id/idempotency key into inbox table
if duplicate:
    commit and return
process business change
commit DB
commit JMS session
```

Pseudo-code:

```java
@Transactional
public void process(CaseCommandEnvelope envelope) {
    boolean firstTime = inboxRepository.tryInsert(envelope.messageId());
    if (!firstTime) {
        return;
    }

    caseService.apply(envelope.command());
}
```

Important: DB transaction and JMS session transaction may still be separate unless XA/JTA is used.

But idempotency makes redelivery safe.

---

### 16.4 Consumer side publishing

If listener consumes one message and publishes another:

Option A: local JMS transaction only.

```text
receive JMS
send JMS output
commit JMS
DB separate
```

Option B: DB transaction + outbox.

```text
receive JMS
DB transaction:
    update state
    insert outbox
commit DB
commit/ack JMS
outbox relay publishes output
```

Option C: XA/JTA.

```text
JTA transaction includes DB + JMS receive/send
```

Most enterprise microservices choose B unless XA is organizationally supported.

---

## 17. Anti-Patterns

### 17.1 `@JmsListener` doing everything

Problem:

- untestable,
- hard to reason transaction,
- hard to reuse,
- hard to classify failure,
- adapter and domain mixed.

Fix:

```text
listener -> envelope extraction -> application service -> domain/state machine
```

---

### 17.2 Swallowing exception

Already covered, but critical.

If failure must cause redelivery, exception must reach container.

---

### 17.3 Blind concurrency increase

Increasing `concurrency` without capacity model is not scaling.

It is moving bottleneck.

---

### 17.4 Using `ObjectMessage` for long-lived contracts

Avoid for cross-service contracts.

Use explicit schema.

---

### 17.5 Treating Spring retry as replacement for broker redelivery

Spring Retry can be useful inside handler for short transient calls.

But broker-level redelivery/DLQ still needed for message lifecycle.

Be careful stacking:

```text
Spring retry 3x
broker redelivery 10x
outbox relay retry 5x
```

Total side-effect attempts may explode.

---

### 17.6 Request/reply for everything

If every service call becomes `convertSendAndReceive`, you recreated synchronous RPC with worse visibility and timeout semantics.

---

### 17.7 Relying on Boot defaults for production

Boot defaults are not production architecture.

Always review explicit configuration.

---

## 18. Reference Configuration Blueprint

### 18.1 Java config

```java
@Configuration
@EnableJms
public class JmsConfig {

    @Bean
    public MessageConverter jmsMessageConverter(ObjectMapper objectMapper) {
        MappingJackson2MessageConverter converter = new MappingJackson2MessageConverter();
        converter.setObjectMapper(objectMapper);
        converter.setTargetType(MessageType.TEXT);
        converter.setTypeIdPropertyName("messageType");
        return converter;
    }

    @Bean
    public JmsTemplate commandJmsTemplate(
            ConnectionFactory connectionFactory,
            MessageConverter messageConverter) {

        JmsTemplate template = new JmsTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);
        template.setExplicitQosEnabled(true);
        template.setDeliveryPersistent(true);
        template.setTimeToLive(300_000L);
        template.setReceiveTimeout(3_000L);
        return template;
    }

    @Bean
    public DefaultJmsListenerContainerFactory commandListenerFactory(
            ConnectionFactory connectionFactory,
            MessageConverter messageConverter,
            ErrorHandler jmsErrorHandler) {

        DefaultJmsListenerContainerFactory factory = new DefaultJmsListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setMessageConverter(messageConverter);
        factory.setSessionTransacted(true);
        factory.setConcurrency("4-12");
        factory.setErrorHandler(jmsErrorHandler);
        factory.setReceiveTimeout(2_000L);
        return factory;
    }

    @Bean
    public ErrorHandler jmsErrorHandler() {
        return throwable -> {
            // log structured, increment metrics, alert if needed
            LoggerFactory.getLogger("JMS_ERROR")
                    .error("Unhandled JMS listener error", throwable);
        };
    }
}
```

### 18.2 Publisher

```java
@Component
public class CaseCommandPublisher {

    private static final String DESTINATION = "case.command.escalate";

    private final JmsTemplate commandJmsTemplate;

    public CaseCommandPublisher(JmsTemplate commandJmsTemplate) {
        this.commandJmsTemplate = commandJmsTemplate;
    }

    public void publish(CaseEscalationRequested command, MessageMetadata metadata) {
        commandJmsTemplate.convertAndSend(DESTINATION, command, message -> {
            message.setStringProperty("messageType", "CaseEscalationRequested.v1");
            message.setStringProperty("schemaVersion", "1");
            message.setStringProperty("correlationId", metadata.correlationId());
            message.setStringProperty("causationId", metadata.causationId());
            message.setStringProperty("idempotencyKey", metadata.idempotencyKey());
            message.setStringProperty("aggregateType", "Case");
            message.setStringProperty("aggregateId", command.caseId());
            return message;
        });
    }
}
```

### 18.3 Listener

```java
@Component
public class CaseCommandListener {

    private final CaseCommandProcessor processor;

    public CaseCommandListener(CaseCommandProcessor processor) {
        this.processor = processor;
    }

    @JmsListener(
            destination = "case.command.escalate",
            containerFactory = "commandListenerFactory")
    public void onCommand(
            CaseEscalationRequested command,
            @Header("correlationId") String correlationId,
            @Header("idempotencyKey") String idempotencyKey,
            @Header("aggregateId") String aggregateId) {

        MessageMetadata metadata = new MessageMetadata(
                correlationId,
                idempotencyKey,
                aggregateId
        );

        processor.process(command, metadata);
    }
}
```

### 18.4 Processor

```java
@Service
public class CaseCommandProcessor {

    private final InboxRepository inboxRepository;
    private final CaseApplicationService caseApplicationService;

    @Transactional
    public void process(CaseEscalationRequested command, MessageMetadata metadata) {
        boolean firstProcessing = inboxRepository.tryRecord(metadata.idempotencyKey());
        if (!firstProcessing) {
            return;
        }

        caseApplicationService.requestEscalation(command.caseId(), command.reason());
    }
}
```

This design separates:

- JMS adapter,
- metadata extraction,
- idempotency,
- business processing,
- DB transaction.

---

## 19. Production Review Checklist

### 19.1 Producer checklist

- [ ] Destination explicit and versioned by contract.
- [ ] Payload format is stable, not Java serialization.
- [ ] Message type and schema version included.
- [ ] Correlation id propagated.
- [ ] Idempotency/event id included.
- [ ] Delivery mode explicitly reviewed.
- [ ] TTL explicitly reviewed.
- [ ] Producer exception uncertainty handled.
- [ ] Outbox used if DB + publish consistency matters.
- [ ] Send latency monitored.

### 19.2 Consumer checklist

- [ ] Listener is thin.
- [ ] Handler is idempotent.
- [ ] Exception propagation intentional.
- [ ] Transaction mode explicit.
- [ ] DB transaction boundary explicit.
- [ ] Redelivery policy configured at broker/provider.
- [ ] DLQ exists and monitored.
- [ ] Poison message strategy exists.
- [ ] Concurrency calculated, not guessed.
- [ ] Ordering implications reviewed.
- [ ] Shutdown tested.

### 19.3 Spring configuration checklist

- [ ] Spring version matches JMS namespace.
- [ ] Provider client matches `javax.jms` or `jakarta.jms` namespace.
- [ ] `ConnectionFactory` explicitly understood.
- [ ] Caching/pooling not accidentally stacked.
- [ ] Listener container factory explicit.
- [ ] Message converter explicit and safe.
- [ ] ErrorHandler installed.
- [ ] Transaction manager explicit where needed.
- [ ] Boot auto-config verified.
- [ ] Integration test uses production-like broker.

### 19.4 Observability checklist

- [ ] Logs include destination/messageType/correlationId/idempotencyKey/outcome.
- [ ] Payload logging restricted.
- [ ] Metrics include success/failure/duplicate/duration.
- [ ] Broker metrics monitored.
- [ ] DLQ alert configured.
- [ ] Trace context propagated.
- [ ] Redelivery count visible if provider supports it.

---

## 20. Failure Modeling Scenarios

### Scenario 1 — Listener commits DB then JMS rollback happens

```text
1. Message received.
2. Handler updates DB and commits.
3. JVM crashes before JMS session commit.
4. Broker redelivers message.
```

Expected design:

- idempotency key prevents duplicate state change,
- handler detects already processed,
- message is safely acknowledged on retry.

---

### Scenario 2 — Producer timeout after broker persisted message

```text
1. App sends message.
2. Broker persists message.
3. Network breaks before response.
4. App sees exception and retries.
```

Expected design:

- message has stable event id/idempotency key,
- consumer deduplicates,
- outbox relay can retry safely.

---

### Scenario 3 — Poison message with immediate retry

```text
1. Invalid payload received.
2. Converter/handler fails.
3. Transaction rolls back.
4. Broker immediately redelivers.
5. Loop repeats.
```

Expected design:

- max redelivery attempts,
- backoff,
- DLQ/quarantine,
- alert,
- repair/replay workflow.

---

### Scenario 4 — Concurrency breaks ordering

```text
caseId=123 transition A->B
caseId=123 transition B->C
Two consumers process concurrently.
B->C reaches DB first.
```

Expected design:

- message group by caseId, or
- optimistic version check, or
- per-aggregate sequencing, or
- deterministic retry until prior transition exists.

---

### Scenario 5 — Boot auto-config connects to wrong broker

```text
1. Classpath contains embedded broker support.
2. Local profile starts embedded broker.
3. Test passes.
4. Production config missing native broker URL.
5. App starts with unintended config or fails late.
```

Expected design:

- profile-specific config validation,
- required broker URL in prod,
- startup health check,
- integration test with prod-like config.

---

## 21. What Top 1% Engineers Internalize

They do not ask only:

```text
How do I use @JmsListener?
```

They ask:

```text
What happens if listener fails after side effect?
What happens if broker redelivers duplicate?
What happens if shutdown occurs mid-transaction?
What happens if concurrency breaks ordering?
What happens if message conversion fails?
What happens if producer cannot know whether send succeeded?
What happens if DLQ grows silently?
What happens if Boot config changes after dependency upgrade?
```

They see Spring JMS as a set of moving parts:

```text
JmsTemplate
MessageConverter
ConnectionFactory
Caching/pooling
ListenerContainer
TransactionManager
ErrorHandler
Broker redelivery policy
DLQ
Idempotency store
Observability
Shutdown lifecycle
```

And they design invariants:

1. every message has stable identity,
2. every handler is duplicate-safe,
3. every failure is classified,
4. every retry has a limit or backoff,
5. every DLQ has an owner,
6. every destination has a contract,
7. every concurrency increase has a capacity model,
8. every transaction boundary is explicit,
9. every async boundary propagates correlation,
10. every shutdown path is tested.

---

## 22. Latihan Engineering

### Latihan 1

Desain `@JmsListener` untuk queue `case.command.assign-officer`.

Requirement:

- command harus idempotent,
- jika officer tidak valid, jangan retry infinite,
- jika DB timeout, retry,
- jika duplicate, ack aman,
- harus log correlation id,
- concurrency 5 tetapi ordering per case harus aman.

Jawab dengan:

- listener signature,
- handler transaction boundary,
- idempotency table design,
- exception classification,
- broker DLQ policy,
- observability fields.

---

### Latihan 2

Anda punya producer yang menerima HTTP request, update DB, lalu publish JMS event `CaseCreated`.

Bandingkan tiga desain:

1. DB commit lalu `jmsTemplate.convertAndSend`,
2. JTA/XA DB+JMS,
3. transactional outbox.

Nilai berdasarkan:

- consistency,
- operational complexity,
- latency,
- failure recovery,
- cloud-native fit,
- auditability.

---

### Latihan 3

Queue depth naik dari 100 ke 100.000 dalam 30 menit.

Spring listener config:

```yaml
concurrency: 5-20
```

Handler rata-rata 300 ms, DB pool 30, downstream API rate limit 50 rps.

Tentukan:

- apakah concurrency perlu dinaikkan,
- bottleneck sebenarnya,
- metrik yang harus dicek,
- risiko retry storm,
- mitigasi jangka pendek,
- perbaikan jangka panjang.

---

## 23. Ringkasan

Spring JMS membuat JMS lebih mudah dipakai di aplikasi Spring, tetapi tidak menghapus kompleksitas distributed messaging.

Poin utama:

- `JmsTemplate` menyederhanakan producer/send path.
- `@JmsListener` adalah endpoint declaration, bukan magic.
- Listener container adalah runtime engine consumer.
- Transaction dan ack harus eksplisit.
- Exception handling menentukan redelivery behavior.
- ErrorHandler bukan pengganti broker redelivery policy.
- Message converter adalah contract boundary, bukan detail kecil.
- Concurrency harus dihitung berdasarkan capacity dan ordering.
- Boot auto-configuration adalah starting point, bukan final production architecture.
- Idempotency, DLQ, observability, dan graceful shutdown tetap wajib.

Jika hanya ingin aplikasi “bisa kirim dan terima message”, Spring JMS cukup mudah.

Jika ingin sistem enterprise yang defensible, recoverable, observable, dan aman saat gagal, Spring JMS harus diperlakukan sebagai bagian dari desain runtime yang lebih besar.

---

## 24. Referensi Resmi untuk Pendalaman

- Spring Framework Reference — JMS integration
- Spring Framework Reference — Using Spring JMS
- Spring Framework Reference — Receiving a Message / Listener Containers
- Spring Framework Javadoc — `DefaultMessageListenerContainer`
- Spring Boot Reference — JMS
- Jakarta Messaging Specification
- Broker/provider documentation sesuai runtime yang dipakai: ActiveMQ Artemis, IBM MQ, Solace, RabbitMQ JMS Client, WebLogic, Open Liberty, WildFly

---

## 25. Status Seri

Selesai: Part 21 dari 35.

Belum selesai.

Berikutnya:

**Part 22 — JMS in Microservices: Command Queue, Domain Event, Integration Event, Saga, dan Choreography**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-020.md">⬅️ Part 20 — JMS in Jakarta EE Runtime: MDB, Resource Adapter, JCA, ActivationSpec, dan Container-Managed Messaging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-022.md">Part 22 — JMS in Microservices: Command Queue, Domain Event, Integration Event, Saga, dan Choreography ➡️</a>
</div>

# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-018

# Part 18 — ActiveMQ Artemis Deep Dive sebagai Reference Broker Modern

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: `018 / 035`  
> Target Java: 8 sampai 25  
> Fokus: memahami Apache ActiveMQ Artemis sebagai broker referensi untuk menjalankan, men-tune, mengoperasikan, dan menalar JMS/Jakarta Messaging secara production-grade.

---

## 1. Tujuan Part Ini

Part sebelumnya membahas broker architecture secara konseptual. Part ini mengambil satu broker modern sebagai **reference implementation mental model**, yaitu **Apache ActiveMQ Artemis**.

Tujuannya bukan menjadikan kita hanya “bisa pakai Artemis”, tetapi membuat kita mampu:

1. Memetakan konsep JMS ke model broker internal Artemis.
2. Memahami kenapa queue/topic JMS tidak selalu sama dengan address/queue/routing type di Artemis.
3. Mendesain destination, DLQ, retry, paging, flow control, persistence, HA, dan observability dengan benar.
4. Membaca konfigurasi broker dengan sudut pandang software engineer, bukan hanya operator.
5. Mengetahui batas portabilitas JMS: mana perilaku standard API, mana perilaku provider-specific.
6. Membuat keputusan production: kapan memakai Artemis, bagaimana men-deploy, bagaimana men-tune, dan bagaimana menghindari failure mode.

Apache ActiveMQ Artemis dokumentasi resmi menjelaskan bahwa model address Artemis memiliki tiga resource inti: **address**, **queue**, dan **routing type**. JMS memakai queue dan topic, tetapi broker harus memetakan konsep tersebut ke model internal yang lebih generik agar dapat mendukung banyak protocol/API seperti JMS, STOMP, MQTT, dan AMQP. Lihat rujukan resmi: <https://artemis.apache.org/components/artemis/documentation/latest/address-model.html>

---

## 2. Big Picture: Kenapa Artemis Cocok sebagai Broker Referensi JMS Modern

JMS adalah API. Artemis adalah broker runtime.

```text
Java Application
  |
  | JMS / Jakarta Messaging API
  v
Artemis JMS Client
  |
  | Artemis Core Protocol / AMQP / OpenWire / etc.
  v
Apache ActiveMQ Artemis Broker
  |
  +-- address model
  +-- queue store
  +-- routing
  +-- journal
  +-- paging
  +-- dispatch
  +-- flow control
  +-- security
  +-- HA / cluster / bridge / federation
```

JMS memberi abstraction:

```text
Queue
Topic
ConnectionFactory
Connection
Session / JMSContext
Producer
Consumer
Message
```

Artemis menjalankan abstraction tersebut lewat mekanisme internal:

```text
address
queue
routing type: anycast / multicast
consumer credit
journal
paging store
large message store
bindings store
DLQ / expiry address
cluster connection
bridge
acceptor / connector
security setting
address setting
```

Mental model penting:

> JMS menjawab “bagaimana aplikasi Java berbicara dengan broker”.  
> Artemis menjawab “bagaimana message benar-benar dirutekan, disimpan, dikirim, dibatasi, diamankan, dan dipulihkan”.

Top 1% engineer tidak berhenti di API. Ia tahu bahwa production behavior datang dari kombinasi:

```text
Application code
+ JMS mode
+ client library
+ broker address model
+ broker persistence
+ ack/transaction policy
+ redelivery policy
+ consumer concurrency
+ network failure behavior
+ storage latency
+ operational runbook
```

---

## 3. Artemis Terminology: Jangan Samakan Semua dengan JMS

### 3.1 JMS Terms

Dalam JMS/Jakarta Messaging, biasanya kita berpikir:

| JMS Concept | Meaning |
|---|---|
| Queue | Point-to-point destination. Satu message dikonsumsi oleh satu consumer. |
| Topic | Publish-subscribe destination. Satu message dapat diterima banyak subscriber. |
| Producer | Pengirim message ke destination. |
| Consumer | Penerima message dari destination. |
| Durable subscription | Topic subscription yang tetap menyimpan message saat subscriber offline. |
| Shared subscription | Topic subscription yang boleh diproses oleh lebih dari satu consumer. |

### 3.2 Artemis Core Terms

Dalam Artemis, resource utama adalah:

| Artemis Concept | Meaning |
|---|---|
| Address | Endpoint tempat message dikirim. |
| Queue | Resource tempat message disimpan dan dikonsumsi. Queue selalu bound ke address. |
| Routing Type | Cara message dari address masuk ke queue: `anycast` atau `multicast`. |
| Anycast | Message diarahkan ke satu queue. Cocok untuk point-to-point / work queue. |
| Multicast | Message dikopi ke setiap queue bound. Cocok untuk pub/sub. |
| FQQN | Fully Qualified Queue Name: `address::queue`, untuk mengakses queue spesifik pada address tertentu. |
| Address Setting | Policy per address pattern: DLQ, expiry, paging, redelivery, size limit, auto-create, metrics, dll. |
| Security Setting | Permission per address pattern: create, delete, send, consume, manage, browse, dll. |

Dokumentasi Artemis menyatakan: message dikirim ke **address**, message dikonsumsi dari **queue**, dan routing type menentukan apakah message masuk ke satu queue atau semua queue pada address tersebut. Lihat: <https://artemis.apache.org/components/artemis/documentation/latest/address-model.html>

---

## 4. Core Mental Model: Address Bukan Queue

Kesalahan umum:

> “Saya mengirim ke queue `orders`, berarti di broker pasti cuma ada queue `orders`.”

Di Artemis, lebih tepat:

```text
Producer sends to address: orders
Broker routes message from address orders to queue(s)
Consumer consumes from queue: orders
```

Untuk JMS queue normal, Artemis biasanya memetakan:

```text
JMS Queue: orders
  -> Artemis address: orders
  -> Artemis anycast queue: orders
```

Untuk JMS topic normal:

```text
JMS Topic: customer.events
  -> Artemis address: customer.events
  -> each subscription becomes multicast queue bound to that address
```

Dokumentasi Artemis JMS-to-core mapping menyatakan bahwa JMS topic diimplementasikan sebagai address dengan nama sama, dan subscription pada topic direpresentasikan sebagai multicast queue pada address tersebut. JMS queue diimplementasikan sebagai address dengan satu anycast queue bernama sama. Lihat: <https://artemis.apache.org/components/artemis/documentation/latest/jms-core-mapping.html>

### 4.1 Visual: JMS Queue Mapping

```text
JMS Producer
  send(queue: orders)
      |
      v
Artemis Address: orders
  routing type: anycast
      |
      v
Artemis Queue: orders
      |
      +--> Consumer A
      +--> Consumer B
      +--> Consumer C

Each message goes to one consumer only.
```

### 4.2 Visual: JMS Topic Mapping

```text
JMS Producer
  publish(topic: order.events)
      |
      v
Artemis Address: order.events
  routing type: multicast
      |
      +--> Subscription Queue: billing-service.subscription
      |       +--> Billing Consumer(s)
      |
      +--> Subscription Queue: audit-service.subscription
      |       +--> Audit Consumer(s)
      |
      +--> Subscription Queue: notification-service.subscription
              +--> Notification Consumer(s)

Each subscription queue receives its own copy.
```

### 4.3 Consequence

Kalau Anda ingin memahami message loss, duplicate, backlog, atau starvation di Artemis, jangan hanya tanya:

> “Destination JMS-nya apa?”

Tanya:

```text
Address apa?
Queue apa saja yang bound ke address itu?
Routing type apa?
Apakah auto-created?
Apakah durable?
Apakah ada filter?
Apakah ada DLQ/expiry/paging policy?
Consumer mana yang attached ke queue mana?
```

---

## 5. Anycast vs Multicast: Model Routing Paling Penting di Artemis

### 5.1 Anycast

Anycast berarti message dari address diarahkan ke **satu queue** pada address.

Use case:

```text
Work queue
Command queue
Task queue
Case-processing queue
Email-send queue
Report-generation queue
```

Contoh konfigurasi:

```xml
<addresses>
  <address name="orders.commands">
    <anycast>
      <queue name="orders.commands" />
    </anycast>
  </address>
</addresses>
```

Semantics:

```text
1 message -> 1 queue -> 1 consumer instance
```

Dalam competing consumer pattern:

```text
Queue: orders.commands
Consumers: C1, C2, C3

Message M1 -> C1
Message M2 -> C2
Message M3 -> C3
Message M4 -> C1
...
```

Tetapi jangan menganggap selalu strict round-robin. Dispatch dipengaruhi oleh:

1. consumer credit/window;
2. prefetch;
3. transaction/ack timing;
4. consumer speed;
5. selector/filter;
6. priority;
7. group affinity;
8. broker load balancing;
9. redelivery.

### 5.2 Multicast

Multicast berarti message dari address dikopi ke **setiap queue** pada address.

Use case:

```text
Domain event publication
Audit event distribution
Notification fan-out
Integration event broadcast
Cache invalidation event
Read model update event
```

Contoh konfigurasi:

```xml
<addresses>
  <address name="orders.events">
    <multicast />
  </address>
</addresses>
```

Untuk topic/pub-sub, biasanya queue subscription dibuat otomatis ketika consumer subscribe.

Semantics:

```text
1 message -> N subscription queues -> each queue has its own consumer group
```

### 5.3 Mixed Anycast + Multicast: Bisa, Tapi Sering Anti-Pattern

Artemis dapat memiliki address dengan queue anycast dan multicast, tetapi dokumentasi resmi memperingatkan bahwa konfigurasi queue dengan routing type berbeda pada address yang sama biasanya menghasilkan anti-pattern dan tidak direkomendasikan. Lihat: <https://artemis.apache.org/components/artemis/documentation/latest/address-model.html>

Contoh problematik:

```xml
<address name="orders">
  <anycast>
    <queue name="orders.commands" />
  </anycast>
  <multicast>
    <queue name="orders.events.audit" />
  </multicast>
</address>
```

Secara teoretis bisa, tetapi secara operasional membingungkan:

1. Apakah `orders` command address atau event address?
2. Apakah producer tahu routing type yang diharapkan?
3. Apakah message tanpa routing hint akan masuk ke anycast dan multicast?
4. Apakah observability dashboard bisa menjelaskan semantics-nya?
5. Apakah security policy bisa dibedakan?

Rekomendasi production:

```text
Pisahkan address command dan event.

orders.commands.approve
orders.commands.cancel
orders.events.approved
orders.events.cancelled
```

Jangan menaruh dua semantic berbeda pada nama address yang sama.

---

## 6. Destination Naming: Naming Adalah Arsitektur, Bukan Kosmetik

Nama destination harus menjelaskan semantic.

### 6.1 Buruk

```text
ORDER
orderQueue
orderTopic
backendQueue
serviceQueue
notification
integration
```

Masalah:

1. Tidak jelas command atau event.
2. Tidak jelas owner.
3. Tidak jelas lifecycle.
4. Tidak jelas tenant/environment.
5. Sulit membuat ACL.
6. Sulit membuat DLQ policy.
7. Sulit observability.

### 6.2 Lebih Baik

```text
case.commands.assign
case.commands.escalate
case.commands.close
case.events.assigned.v1
case.events.escalated.v1
case.events.closed.v1
notification.commands.send-email
integration.events.payment-received.v1
audit.events.activity-recorded.v1
```

### 6.3 Naming Heuristics

Gunakan pola:

```text
<domain>.<message-kind>.<business-action-or-fact>[.<version>]
```

Contoh:

```text
case.commands.create
case.commands.assign
case.events.created.v1
case.events.assigned.v1
appeal.commands.submit
appeal.events.submitted.v1
email.commands.send
email.events.sent.v1
```

Rule:

1. `commands` biasanya anycast.
2. `events` biasanya multicast.
3. `commands` memakai kata kerja imperative: `assign`, `approve`, `send`.
4. `events` memakai fakta lampau: `assigned`, `approved`, `sent`.
5. Versioning lebih natural pada event contract daripada command internal.

---

## 7. Auto-Create vs Manual Configuration

Artemis dapat auto-create address/queue. Ini nyaman untuk development, tetapi berisiko untuk production.

### 7.1 Kelebihan Auto-Create

```text
+ Developer cepat mencoba fitur.
+ Tidak perlu pre-provision destination.
+ Cocok untuk local dev/test.
+ Cocok untuk dynamic temporary subscription.
```

### 7.2 Risiko Auto-Create

```text
- Typo destination menciptakan queue baru.
- Salah routing type dapat menciptakan semantics yang salah.
- Security policy mungkin terlalu broad.
- DLQ/expiry/paging policy mungkin fallback ke default.
- Observability penuh dengan resource tak disengaja.
- Production bug bisa silent: message terkirim ke destination salah, tetapi tidak error.
```

Contoh typo:

```java
producer.send(session.createQueue("case.commands.assgin"), message); // typo: assgin
```

Kalau auto-create aktif, broker bisa membuat destination baru. Producer sukses. Consumer yang benar mendengar `case.commands.assign`, bukan `case.commands.assgin`. Message menumpuk di tempat salah.

### 7.3 Rekomendasi

Untuk production:

```text
1. Disable auto-create untuk address penting.
2. Provision destination via IaC/configuration.
3. Gunakan naming convention ketat.
4. Buat security setting spesifik.
5. Buat address setting spesifik.
6. Monitor address/queue unknown.
7. Treat unknown destination as deployment defect.
```

Contoh address setting konseptual:

```xml
<address-settings>
  <address-setting match="case.commands.#">
    <dead-letter-address>DLQ.case.commands</dead-letter-address>
    <expiry-address>EXP.case.commands</expiry-address>
    <max-delivery-attempts>5</max-delivery-attempts>
    <redelivery-delay>5000</redelivery-delay>
    <auto-create-addresses>false</auto-create-addresses>
    <auto-create-queues>false</auto-create-queues>
  </address-setting>
</address-settings>
```

Catatan: syntax persis dapat berubah antar versi/config style; prinsipnya lebih penting: **production destination harus eksplisit**.

---

## 8. Basic Broker Configuration: Membaca `broker.xml` dengan Mental Model

File utama broker Artemis biasanya ada di instance broker:

```text
<broker-instance>/etc/broker.xml
```

Struktur konseptual:

```xml
<configuration>

  <core>

    <acceptors>
      <!-- Endpoint network tempat client connect -->
    </acceptors>

    <connectors>
      <!-- Endpoint outbound untuk broker/client topology -->
    </connectors>

    <security-settings>
      <!-- ACL per address pattern -->
    </security-settings>

    <address-settings>
      <!-- Runtime policy per address pattern -->
    </address-settings>

    <addresses>
      <!-- Address/queue manual -->
    </addresses>

  </core>

</configuration>
```

### 8.1 Acceptor

Acceptor adalah tempat broker menerima connection.

Contoh konseptual:

```xml
<acceptors>
  <acceptor name="artemis">
    tcp://0.0.0.0:61616?protocols=CORE,AMQP,OPENWIRE
  </acceptor>
</acceptors>
```

Pertanyaan engineering:

```text
1. Protocol apa yang diaktifkan?
2. Apakah semua protocol diperlukan?
3. Apakah TLS aktif?
4. Apakah port exposed ke network yang benar?
5. Apakah ada client lama OpenWire dan client modern Core/AMQP?
6. Apakah protocol berbeda punya routing default berbeda?
```

### 8.2 Address Setting

Address setting adalah policy runtime.

Contoh:

```xml
<address-settings>
  <address-setting match="case.commands.#">
    <dead-letter-address>DLQ.case.commands</dead-letter-address>
    <expiry-address>EXP.case.commands</expiry-address>
    <max-delivery-attempts>5</max-delivery-attempts>
    <redelivery-delay>3000</redelivery-delay>
    <max-size-bytes>104857600</max-size-bytes>
    <address-full-policy>PAGE</address-full-policy>
    <auto-create-addresses>false</auto-create-addresses>
    <auto-create-queues>false</auto-create-queues>
  </address-setting>
</address-settings>
```

Mental model:

```text
address-setting = operational contract for address family
```

Ia menentukan:

1. apa yang terjadi saat processing gagal;
2. apa yang terjadi saat message expired;
3. apa yang terjadi saat backlog besar;
4. apakah broker boleh auto-create resource;
5. apakah message dipage ke disk;
6. apakah metrics aktif;
7. bagaimana delivery attempt dihitung.

### 8.3 Address Definitions

Contoh command queue:

```xml
<addresses>
  <address name="case.commands.assign">
    <anycast>
      <queue name="case.commands.assign" />
    </anycast>
  </address>
</addresses>
```

Contoh event topic:

```xml
<addresses>
  <address name="case.events.assigned.v1">
    <multicast />
  </address>
</addresses>
```

Contoh DLQ:

```xml
<addresses>
  <address name="DLQ.case.commands">
    <anycast>
      <queue name="DLQ.case.commands" />
    </anycast>
  </address>
</addresses>
```

---

## 9. Java Client: Legacy `javax.jms` vs Modern `jakarta.jms`

### 9.1 Java 8 Era

Pada Java 8 dan Java EE/JMS lama, aplikasi biasanya memakai:

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.Destination;
import javax.jms.MessageProducer;
import javax.jms.Session;
import javax.jms.TextMessage;
```

Gaya JMS 1.1:

```java
Connection connection = null;
Session session = null;

try {
    connection = connectionFactory.createConnection("app-user", "secret");
    session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);

    Destination destination = session.createQueue("case.commands.assign");
    MessageProducer producer = session.createProducer(destination);

    TextMessage message = session.createTextMessage("{\"caseId\":\"C-1001\"}");
    message.setStringProperty("messageType", "CaseAssignCommand");
    message.setStringProperty("schemaVersion", "1");
    message.setStringProperty("correlationId", "corr-123");

    producer.send(message);
} finally {
    if (session != null) {
        session.close();
    }
    if (connection != null) {
        connection.close();
    }
}
```

### 9.2 JMS 2.0 / Jakarta Messaging Style

Modern API menyediakan `JMSContext`, `JMSProducer`, `JMSConsumer`.

```java
import jakarta.jms.ConnectionFactory;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;
import jakarta.jms.TextMessage;

try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
    Queue queue = context.createQueue("case.commands.assign");

    TextMessage message = context.createTextMessage("{\"caseId\":\"C-1001\"}");
    message.setStringProperty("messageType", "CaseAssignCommand");
    message.setStringProperty("schemaVersion", "1");
    message.setStringProperty("correlationId", "corr-123");

    context.createProducer()
           .setProperty("producer", "case-service")
           .send(queue, message);
}
```

### 9.3 Provider Dependency Trap

JMS/Jakarta Messaging API dependency saja tidak cukup. Anda butuh client provider Artemis.

Konseptual Maven dependency modern:

```xml
<dependency>
  <groupId>org.apache.activemq</groupId>
  <artifactId>artemis-jakarta-client</artifactId>
  <version><!-- align with broker/client version --></version>
</dependency>
```

Atau legacy:

```xml
<dependency>
  <groupId>org.apache.activemq</groupId>
  <artifactId>artemis-jms-client</artifactId>
  <version><!-- align with broker/client version --></version>
</dependency>
```

Rekomendasi:

```text
Java 8 + javax.jms ecosystem       -> legacy JMS client style
Java 17/21/25 + Jakarta ecosystem  -> jakarta.jms client style
Jakarta EE 10/11                   -> jakarta.jms namespace
Spring Boot modern                 -> cek apakah stack masih javax atau sudah jakarta
```

Jangan campur sembarangan:

```text
javax.jms.Message != jakarta.jms.Message
javax.jms.ConnectionFactory != jakarta.jms.ConnectionFactory
```

Itu bukan sekadar import berbeda; namespace berbeda dapat membuat runtime injection, classloading, dan provider integration gagal.

---

## 10. Creating ConnectionFactory untuk Artemis

Di application server, `ConnectionFactory` biasanya di-inject via JNDI/resource adapter.

Di standalone Java, Anda bisa membuat provider-specific connection factory.

Contoh konseptual modern:

```java
import jakarta.jms.ConnectionFactory;
import org.apache.activemq.artemis.jms.client.ActiveMQConnectionFactory;

public final class MessagingFactories {

    public static ConnectionFactory artemisConnectionFactory() {
        return new ActiveMQConnectionFactory("tcp://localhost:61616");
    }
}
```

Dengan credential:

```java
try (JMSContext context = connectionFactory.createContext("app-user", "secret", JMSContext.AUTO_ACKNOWLEDGE)) {
    // use context
}
```

Production notes:

1. Jangan hard-code username/password.
2. Gunakan TLS jika melintasi network tak terpercaya.
3. Batasi protocol yang tidak diperlukan.
4. Hindari membuat connection/context per message untuk high-throughput path.
5. Pahami apakah framework Anda melakukan pooling/caching connection.
6. Test reconnect/failover secara eksplisit.

---

## 11. Producer Example: Artemis sebagai JMS Provider

Contoh minimal modern:

```java
package example.jms.artemis;

import jakarta.jms.ConnectionFactory;
import jakarta.jms.DeliveryMode;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;
import jakarta.jms.TextMessage;
import org.apache.activemq.artemis.jms.client.ActiveMQConnectionFactory;

import java.time.Instant;
import java.util.UUID;

public final class CaseAssignProducer {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ActiveMQConnectionFactory("tcp://localhost:61616");

        try (JMSContext context = factory.createContext("app", "secret", JMSContext.AUTO_ACKNOWLEDGE)) {
            Queue queue = context.createQueue("case.commands.assign");

            String commandId = UUID.randomUUID().toString();
            String correlationId = UUID.randomUUID().toString();

            String payload = """
                    {
                      "commandId": "%s",
                      "caseId": "CASE-2026-0001",
                      "assigneeId": "U-1001",
                      "requestedAt": "%s"
                    }
                    """.formatted(commandId, Instant.now());

            TextMessage message = context.createTextMessage(payload);
            message.setStringProperty("messageType", "CaseAssignCommand");
            message.setStringProperty("schemaVersion", "1");
            message.setStringProperty("commandId", commandId);
            message.setStringProperty("correlationId", correlationId);
            message.setStringProperty("producerService", "case-service");

            context.createProducer()
                    .setDeliveryMode(DeliveryMode.PERSISTENT)
                    .setTimeToLive(5 * 60 * 1000L)
                    .send(queue, message);
        }
    }
}
```

### 11.1 Hal yang Sengaja Ditunjukkan

1. Payload tetap domain-specific.
2. Metadata penting ada di properties.
3. `commandId` bisa dipakai untuk idempotency.
4. `correlationId` bisa dipakai untuk tracing.
5. Delivery mode persistent jika command tidak boleh hilang.
6. TTL dipakai jika command punya batas relevansi.

### 11.2 Hal yang Belum Cukup untuk Production

Kode di atas belum menangani:

1. connection pooling;
2. structured logging;
3. OpenTelemetry propagation;
4. retry send;
5. error classification;
6. outbox integration;
7. credential rotation;
8. TLS;
9. failover URI;
10. metrics.

---

## 12. Consumer Example: CLIENT_ACK dengan Idempotency Skeleton

Contoh modern:

```java
package example.jms.artemis;

import jakarta.jms.ConnectionFactory;
import jakarta.jms.JMSContext;
import jakarta.jms.JMSConsumer;
import jakarta.jms.Message;
import jakarta.jms.Queue;
import jakarta.jms.TextMessage;
import org.apache.activemq.artemis.jms.client.ActiveMQConnectionFactory;

public final class CaseAssignConsumer {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ActiveMQConnectionFactory("tcp://localhost:61616");

        try (JMSContext context = factory.createContext("app", "secret", JMSContext.CLIENT_ACKNOWLEDGE)) {
            Queue queue = context.createQueue("case.commands.assign");
            JMSConsumer consumer = context.createConsumer(queue);

            while (true) {
                Message message = consumer.receive(1000);
                if (message == null) {
                    continue;
                }

                try {
                    handle(message);
                    message.acknowledge();
                } catch (RecoverableException recoverable) {
                    // In CLIENT_ACK mode, unacked message can be redelivered after session recovery/close.
                    // In real systems, prefer transacted session or container-managed transaction.
                    context.recover();
                } catch (NonRecoverableException permanent) {
                    // Be careful: acknowledging here means broker will not redeliver.
                    // Usually you want either:
                    // 1. throw/rollback until broker moves to DLQ by max delivery attempts, or
                    // 2. manually publish to parking lot + ack original.
                    throw permanent;
                }
            }
        }
    }

    private static void handle(Message message) throws Exception {
        String messageType = message.getStringProperty("messageType");
        String commandId = message.getStringProperty("commandId");

        if (!"CaseAssignCommand".equals(messageType)) {
            throw new NonRecoverableException("Unexpected messageType: " + messageType);
        }

        if (alreadyProcessed(commandId)) {
            return;
        }

        TextMessage text = (TextMessage) message;
        String payload = text.getText();

        // 1. parse payload
        // 2. validate command
        // 3. update DB with idempotency constraint
        // 4. write audit record
        // 5. mark commandId processed atomically
    }

    private static boolean alreadyProcessed(String commandId) {
        return false;
    }

    static final class RecoverableException extends RuntimeException {
        RecoverableException(String message) { super(message); }
    }

    static final class NonRecoverableException extends RuntimeException {
        NonRecoverableException(String message) { super(message); }
    }
}
```

### 12.1 Important Warning

Untuk production, `CLIENT_ACKNOWLEDGE` perlu dipakai hati-hati. Pada beberapa kasus, transacted session lebih jelas:

```text
process OK -> commit
process failed -> rollback
```

Namun kalau DB dan JMS harus sinkron, Anda harus memilih:

1. local JMS transaction saja;
2. JTA/XA;
3. outbox/inbox;
4. idempotency + retry;
5. manual compensation.

Bagian transaction sudah dibahas di Part 10; Artemis hanya broker yang menjalankan keputusan itu.

---

## 13. Redelivery dan DLQ di Artemis

Dalam production, redelivery policy bukan detail kecil. Ini bagian dari correctness.

### 13.1 Redelivery Flow

```text
Consumer receives message
  |
  +-- success -> ack/commit -> message removed
  |
  +-- failure -> rollback/recover/connection loss
        |
        v
     broker redelivers
        |
        +-- delivery attempt <= max -> send again
        |
        +-- delivery attempt > max -> move to DLQ
```

### 13.2 Address Setting untuk Redelivery

Contoh konseptual:

```xml
<address-settings>
  <address-setting match="case.commands.#">
    <dead-letter-address>DLQ.case.commands</dead-letter-address>
    <max-delivery-attempts>5</max-delivery-attempts>
    <redelivery-delay>5000</redelivery-delay>
    <redelivery-multiplier>2.0</redelivery-multiplier>
    <max-redelivery-delay>60000</max-redelivery-delay>
  </address-setting>
</address-settings>
```

Interpretasi:

```text
1st failure  -> wait 5s
2nd failure  -> wait 10s
3rd failure  -> wait 20s
4th failure  -> wait 40s
5th failure  -> wait max 60s or DLQ depending count
```

### 13.3 DLQ Address

```xml
<addresses>
  <address name="DLQ.case.commands">
    <anycast>
      <queue name="DLQ.case.commands" />
    </anycast>
  </address>
</addresses>
```

### 13.4 DLQ Is Not a Trash Can

DLQ harus dianggap sebagai operational workflow.

Harus ada:

```text
1. alert jika DLQ > 0 untuk critical queue;
2. dashboard DLQ per domain;
3. metadata original destination;
4. original message id;
5. redelivery count;
6. exception summary jika dipublish oleh app;
7. owner team;
8. SOP triage;
9. replay tool;
10. audit trail replay.
```

Tanpa ini, DLQ hanya “kuburan message”.

---

## 14. Expiry Address: TTL Bukan Delete Sembarangan

Jika producer mengirim message dengan TTL, message bisa expired sebelum dikonsumsi.

Flow:

```text
Message sent with TTL
  |
  +-- consumed before expiry -> normal
  |
  +-- not consumed before expiry
        |
        v
     broker expires message
        |
        +-- if expiry-address configured -> move to expiry queue
        +-- otherwise -> message removed
```

Contoh:

```xml
<address-settings>
  <address-setting match="notification.commands.#">
    <expiry-address>EXP.notification.commands</expiry-address>
  </address-setting>
</address-settings>
```

```xml
<addresses>
  <address name="EXP.notification.commands">
    <anycast>
      <queue name="EXP.notification.commands" />
    </anycast>
  </address>
</addresses>
```

### 14.1 Kapan TTL Masuk Akal

TTL cocok untuk:

```text
- notification yang tidak relevan setelah periode tertentu;
- cache refresh command;
- UI-triggered async task dengan timeout bisnis;
- temporary request/reply;
- polling replacement yang punya freshness boundary.
```

TTL berbahaya untuk:

```text
- legal case state transition;
- payment command;
- audit event;
- compliance event;
- data synchronization wajib.
```

Untuk regulated system, expired message tetap perlu forensic visibility. Jangan biarkan expired silently.

---

## 15. Paging: Saat Backlog Lebih Besar dari Memori

Broker tidak boleh menyimpan semua backlog di heap. Artemis punya paging untuk menulis message ke disk saat address mencapai batas ukuran.

Mental model:

```text
Normal flow:
producer -> broker memory/journal -> consumer

When backlog grows:
producer -> broker -> page store on disk -> consumer drains later
```

### 15.1 Address Full Policy

Policy umum:

```text
PAGE   -> page messages to disk
BLOCK  -> block producers
DROP   -> drop messages
FAIL   -> fail send
```

Untuk command penting:

```text
PAGE or BLOCK
```

Untuk telemetry non-critical:

```text
DROP may be acceptable if explicitly designed
```

Untuk regulated workflow:

```text
DROP is almost never acceptable unless message is truly disposable
```

### 15.2 Example

```xml
<address-settings>
  <address-setting match="case.commands.#">
    <max-size-bytes>1073741824</max-size-bytes>
    <address-full-policy>PAGE</address-full-policy>
  </address-setting>
</address-settings>
```

### 15.3 Paging Is a Symptom

Paging bukan solusi performa utama. Paging adalah survival mode.

Jika address sering paging, tanyakan:

```text
1. Arrival rate > processing rate?
2. Consumer down?
3. Downstream DB lambat?
4. Redelivery loop?
5. Poison message blocking group/order?
6. Consumer prefetch terlalu besar?
7. Broker storage lambat?
8. DLQ policy tidak jalan?
9. Producer flood tanpa backpressure?
```

### 15.4 Production Invariant

```text
Queue depth growth rate must be explainable.
```

Kalau backlog tumbuh dan tim tidak tahu kenapa, sistem belum observable.

---

## 16. Journal and Persistence

Persistent message harus disimpan durable. Artemis memakai journal untuk menyimpan message/binding state.

Konseptual directories:

```text
bindings/        -> metadata binding address/queue
journal/         -> persistent message records and transaction data
paging/          -> paged messages when address is full
large-messages/  -> large payload storage
```

Dokumentasi clustering Artemis memperingatkan agar tidak menyalin data directories seperti `bindings`, `journal`, `paging`, dan `large-messages` antar node karena setiap node memiliki identifier unik di journal; menyalin data dapat membuat cluster tidak terbentuk dengan benar. Lihat: <https://artemis.apache.org/components/artemis/documentation/latest/clusters.html>

### 16.1 Persistent vs Non-Persistent

Persistent:

```text
+ survive broker restart/crash according to durability guarantee
- slower
- storage-bound
- fsync/IO matters
```

Non-persistent:

```text
+ faster
+ less disk pressure
- can be lost on broker failure
```

### 16.2 Tuning Persistence

Dokumentasi Artemis performance tuning merekomendasikan file store untuk persistent message, menaruh journal di volume fisik sendiri, memisahkan paging/large messages jika bisa, memakai `ASYNCIO` di Linux untuk performa lebih baik, dan memahami trade-off `journal-buffer-timeout`, `journal-data-sync`, dan sync transactional setting. Lihat: <https://artemis.apache.org/components/artemis/documentation/latest/perf-tuning.html>

Prinsip engineering:

```text
If message matters, storage matters.
```

Kalau broker menjalankan persistent command queue tetapi disk-nya lambat/noisy/shared, maka bottleneck bukan Java code, melainkan storage latency.

---

## 17. Large Messages: Jangan Perlakukan Broker sebagai Object Store

Payload besar bisa membuat broker menderita:

```text
- memory pressure;
- journal pressure;
- paging pressure;
- network fragmentation;
- slow redelivery;
- DLQ browsing berat;
- backup/replication lambat;
- observability sulit.
```

Artemis punya support large messages, tetapi desain yang lebih sehat sering memakai **claim check pattern**:

```text
1. Simpan payload besar di object storage / database / document store.
2. Kirim message kecil berisi reference/id/checksum/metadata.
3. Consumer mengambil payload saat perlu.
```

Contoh message:

```json
{
  "documentId": "DOC-2026-0001",
  "storageRef": "s3://bucket/path/file.pdf",
  "sha256": "...",
  "contentType": "application/pdf",
  "sizeBytes": 10485760
}
```

Rule praktis:

```text
Message broker is for coordination, not bulk storage.
```

---

## 18. Flow Control and Consumer Credit

Flow control mencegah broker/client saling membanjiri.

### 18.1 Producer Flow Control

Jika address penuh, broker bisa:

```text
PAGE
BLOCK
DROP
FAIL
```

Ini memengaruhi producer:

```text
send() lambat
send() block
send() fail
message dropped
```

### 18.2 Consumer Flow Control

Consumer tidak selalu menerima satu message per request. Client bisa diberi credit/window. Broker dapat mengirim beberapa message ke client buffer.

Dampak:

```text
+ throughput meningkat
- memory client naik
- message terlihat “tidak ada di broker” padahal buffered di client
- fairness antar consumer dapat berubah
- shutdown harus hati-hati
- redelivery tertunda sampai session/connection state berubah
```

### 18.3 Operational Symptom

Jika broker queue depth terlihat rendah tetapi consumer stuck, mungkin message sudah diprefetch ke consumer client tetapi belum diproses/ack.

Pertanyaan debug:

```text
1. Berapa consumer-window-size/prefetch?
2. Apakah consumer single-threaded lambat?
3. Apakah listener blocked pada DB/API?
4. Apakah unacked message tinggi?
5. Apakah app shutdown tanpa close bersih?
```

---

## 19. Message Grouping di Artemis

Message grouping menjaga affinity: message dengan group id yang sama dikirim ke consumer yang sama selama group aktif.

Use case:

```text
caseId = CASE-1001
All commands for CASE-1001 should be processed in order by same consumer.
```

Conceptual send:

```java
message.setStringProperty("JMSXGroupID", caseId);
```

Mental model:

```text
Queue has multiple consumers.
Broker assigns group CASE-1001 to Consumer A.
All messages with group CASE-1001 go to Consumer A until group closes or consumer gone.
```

### 19.1 Benefits

```text
+ preserves per-entity ordering;
+ reduces concurrent conflict on same aggregate;
+ useful for state machine transitions;
+ avoids global single consumer bottleneck.
```

### 19.2 Risks

```text
- hot key: one case/customer/account gets too many messages;
- stuck consumer can hold group;
- poison message can block group progress;
- group rebalance during failure can create duplicate/reorder edge cases;
- not replacement for idempotency/version checks.
```

### 19.3 Rule

```text
Use message group for ordering optimization, not as sole correctness mechanism.
```

Correctness still requires:

```text
- aggregate version;
- idempotency key;
- transaction boundary;
- valid state transition check;
- replay-safe handler.
```

---

## 20. Security in Artemis: Broker ACL Matters

JMS API security is incomplete without broker-level security.

### 20.1 Authentication

Client harus authenticate:

```text
username/password
certificate
JAAS integration
external identity provider integration depending deployment
```

### 20.2 Authorization

Permission harus destination-specific.

Contoh konseptual:

```xml
<security-settings>
  <security-setting match="case.commands.#">
    <permission type="send" roles="case-producer" />
    <permission type="consume" roles="case-consumer" />
    <permission type="browse" roles="case-operator" />
    <permission type="manage" roles="broker-admin" />
  </security-setting>
</security-settings>
```

### 20.3 Anti-Pattern

```xml
<security-setting match="#">
  <permission type="send" roles="everyone" />
  <permission type="consume" roles="everyone" />
</security-setting>
```

Ini berarti semua service dapat mengirim dan membaca semua message. Untuk enterprise regulated system, ini buruk karena:

1. data leakage;
2. accidental consumer;
3. accidental producer;
4. impossible audit boundary;
5. weak tenant isolation;
6. blast radius besar.

### 20.4 Minimum Security Invariant

```text
A service should only send to destinations it owns/needs.
A service should only consume from destinations assigned to it.
DLQ browse/retry should be operator-controlled.
Admin/manage permission must never be given to application runtime user.
```

---

## 21. TLS/mTLS and Network Boundary

Jika broker diakses lintas node, cluster, namespace, VPC, atau network zone, plaintext TCP sering tidak cukup.

### 21.1 TLS Questions

```text
1. Apakah client memverifikasi server certificate?
2. Apakah hostname verification aktif?
3. Apakah truststore dikelola?
4. Apakah keystore secret dirotasi?
5. Apakah TLS version/cipher policy memenuhi security baseline?
6. Apakah broker exposed internal-only?
7. Apakah mTLS diperlukan untuk service identity?
```

### 21.2 Secret Handling

Jangan:

```text
- hard-code password di source code;
- commit broker.xml berisi secret plaintext;
- expose password di command line;
- log connection URI dengan credential;
- memakai admin user untuk aplikasi.
```

Lakukan:

```text
- secret manager / vault / Kubernetes Secret dengan akses terbatas;
- separate user per service;
- rotate credential;
- least privilege;
- audit login/admin events;
- split app user vs operator user vs cluster user.
```

---

## 22. Clustering: Horizontal Scaling Bukan Obat Semua

Dokumentasi Artemis menyatakan cluster memungkinkan grup broker berbagi pemrosesan message; setiap active node mengelola message dan connection-nya sendiri. Cluster dapat membantu horizontal scaling, tetapi bukan silver bullet. Dokumentasi performance considerations menekankan untuk memulai dari satu broker dan berpindah ke cluster hanya jika single broker tidak memenuhi target; cluster dapat menurunkan throughput jika producer/consumer tidak tersebar dengan benar. Lihat: <https://artemis.apache.org/components/artemis/documentation/latest/clusters.html>

### 22.1 Cluster Mental Model

```text
Broker A <---- cluster connection ----> Broker B
   |                                      |
clients                               clients
```

Cluster bukan berarti semua node otomatis punya satu global queue sempurna tanpa trade-off.

Pertanyaan penting:

```text
1. Producer connect ke node mana?
2. Consumer connect ke node mana?
3. Queue ada di node mana?
4. Apakah messages perlu dipindahkan antar node?
5. Apakah redistribution aktif?
6. Apakah selector membuat forwarding rumit?
7. Apakah ordering berubah karena cluster?
8. Apakah failover duplicate mungkin?
```

### 22.2 When Cluster Helps

```text
- Banyak producer dan consumer tersebar.
- Workload bisa dipartisi.
- Single broker CPU/network/storage sudah bottleneck.
- Operational team mampu mengelola complexity.
- Observability per node matang.
```

### 22.3 When Cluster Hurts

```text
- Consumer hanya connect ke satu node.
- Producer mostly connect ke node lain.
- Message sering harus redistribusi.
- Ordering per entity tidak dipahami.
- Storage/network antar node lambat.
- Failover belum diuji.
- Team belum punya runbook.
```

### 22.4 Top 1% Rule

```text
Do not scale the broker topology before you understand the bottleneck.
```

Kadang solusi bukan cluster, tetapi:

```text
- consumer concurrency;
- DB optimization;
- payload size reduction;
- batching;
- prefetch tuning;
- separate hot queues;
- outbox relay tuning;
- storage isolation;
- DLQ fix;
- poison message handling.
```

---

## 23. HA: Availability vs Consistency vs Operational Complexity

High availability bertujuan agar broker failure tidak menghentikan messaging terlalu lama.

Tetapi HA selalu punya trade-off:

```text
availability
consistency/durability
latency
operational complexity
cost
recovery time
split-brain risk
```

### 23.1 HA Questions

```text
1. Apakah message persistent harus survive node loss?
2. Apakah shared storage dipakai?
3. Apakah replication dipakai?
4. Apakah failover otomatis?
5. Apakah client reconnect/failover URI benar?
6. Apakah duplicate after failover diterima dan ditangani?
7. Apakah in-flight transaction outcome jelas?
8. Apakah DR berbeda dari HA?
```

### 23.2 Client Perspective

Aplikasi Java harus siap terhadap:

```text
- connection lost;
- session invalid;
- producer send uncertain;
- consumer redelivery;
- duplicate message;
- partial processing;
- late reply;
- transaction rollback;
- stale temporary destination.
```

HA broker tidak menghapus kebutuhan idempotency.

```text
HA reduces downtime.
It does not magically provide end-to-end exactly-once business processing.
```

---

## 24. Bridge and Federation: Integrasi Antar Broker

Artemis dapat memindahkan message antar broker melalui bridge/federation/topology tertentu.

Use case:

```text
- data center integration;
- DMZ/intranet segmentation;
- migration between brokers;
- regional routing;
- multi-tenant isolation;
- decoupling producer network from consumer network;
- gradual modernization.
```

### 24.1 Bridge Mental Model

```text
Broker A queue/address
   |
   | bridge
   v
Broker B address/queue
```

### 24.2 Failure Questions

```text
1. Apakah bridge duplicate detection aktif?
2. Apakah bridge durable?
3. Apa retry policy bridge?
4. Apa yang terjadi saat target broker down?
5. Apakah ordering tetap?
6. Apakah TTL berjalan selama transit?
7. Apakah security credential bridge least privilege?
8. Apakah DLQ di source atau target?
9. Bagaimana replay jika bridge stuck?
```

### 24.3 Anti-Pattern

Jangan memakai bridge/federation untuk menyembunyikan domain boundary yang tidak jelas.

Kalau semua broker saling bridge semua address:

```text
broker mesh becomes distributed mystery machine
```

Lebih baik eksplisit:

```text
source domain -> integration event -> target domain subscription
```

---

## 25. Management and Observability

Artemis menyediakan console/management API/metrics. Tetapi engineering maturity datang dari metrics yang benar, bukan hanya console tersedia.

### 25.1 Metrics Penting

Per broker:

```text
- broker up/down;
- connection count;
- session count;
- producer count;
- consumer count;
- CPU/memory;
- heap/non-heap;
- GC pause;
- disk usage;
- journal write latency;
- paging usage;
- network IO;
- thread pool saturation.
```

Per address/queue:

```text
- message count / queue depth;
- messages added;
- messages acknowledged;
- delivering count;
- scheduled count;
- consumer count;
- messages killed / DLQ count;
- expired count;
- redelivered count;
- enqueue rate;
- dequeue rate;
- oldest message age;
- average processing latency if app emits it;
- page store usage.
```

Per application:

```text
- receive count;
- success count;
- failure count;
- processing duration;
- ack/commit duration;
- DB/API dependency latency;
- duplicate skipped;
- idempotency conflict;
- invalid message;
- retry classification;
- DLQ publish count;
- correlation id trace.
```

### 25.2 Golden Signals for JMS Queue

```text
Queue health = depth + age + consumer count + processing rate + redelivery + DLQ
```

Queue depth alone is insufficient.

Example:

```text
Depth = 10,000 but age = 2 minutes and drain rate high -> maybe OK.
Depth = 100 but oldest age = 2 days -> serious stuck messages.
Depth = 0 but redelivery high -> poison messages repeatedly failing and returning.
Depth = low but delivering count high -> messages buffered/in-flight.
```

### 25.3 Alerting Heuristics

Alert on:

```text
- oldest message age > SLA;
- DLQ count > 0 for critical command;
- consumer count = 0 for active queue;
- redelivery rate spike;
- queue depth grows for sustained window;
- paging active for critical address;
- disk usage > threshold;
- journal latency high;
- connection churn high;
- broker failover occurred;
- expired messages for non-disposable queue.
```

---

## 26. Performance Engineering with Artemis

Performance is not one knob. It is pipeline reasoning.

```text
Producer serialization
  -> network send
  -> broker protocol handling
  -> routing
  -> journal/persistence
  -> paging if needed
  -> dispatch
  -> client buffer
  -> consumer processing
  -> DB/API side effect
  -> ack/commit
  -> broker cleanup
```

### 26.1 Producer-Side Levers

```text
- persistent vs non-persistent;
- message size;
- sync vs async send;
- batching via transaction;
- disable message id/timestamp if safe;
- compression only if CPU/network trade-off favorable;
- avoid per-message connection creation;
- use connection/session pooling carefully;
- avoid ObjectMessage;
- tune TTL only when semantically valid.
```

Dokumentasi Artemis performance tuning menyebut beberapa JMS tuning seperti disabling message ID/timestamp bila tidak dibutuhkan, menghindari `ObjectMessage`, menghindari `AUTO_ACKNOWLEDGE` untuk throughput tertentu, memakai non-durable message jika benar-benar tidak butuh durability, dan batching send/ack dalam transaksi. Lihat: <https://artemis.apache.org/components/artemis/documentation/latest/perf-tuning.html>

### 26.2 Consumer-Side Levers

```text
- concurrency;
- session count;
- listener thread pool;
- prefetch/window;
- ack batching;
- transaction batching;
- DB connection pool;
- handler CPU cost;
- idempotency lookup cost;
- poison message handling;
- message grouping hot key.
```

### 26.3 Broker-Side Levers

```text
- journal type;
- journal volume isolation;
- journal buffer timeout;
- paging volume isolation;
- max-size-bytes;
- address-full-policy;
- acceptor protocol;
- TCP settings;
- thread pools;
- security overhead;
- metrics overhead;
- large message handling;
- cluster topology.
```

### 26.4 JVM Levers

```text
Java 8:
- GC tuning often more manual;
- CMS/G1 era depending runtime;
- old TLS/JCE defaults may matter.

Java 11/17:
- stronger baseline GC/TLS/JIT;
- better container awareness than Java 8.

Java 21/25:
- modern G1/ZGC improvements;
- virtual threads available for application code, but JMS Session thread-safety still matters;
- do not assume virtual threads make JMS provider internals magically concurrent-safe.
```

Important:

```text
Virtual threads do not remove JMS Session rules.
```

If a `Session`/`JMSContext` is not safe for concurrent use, putting calls on many virtual threads can create correctness bugs.

---

## 27. Artemis and Java 8–25: Practical Compatibility Strategy

### 27.1 Java 8

Use case:

```text
legacy enterprise app
Java EE stack
javax.jms
older application server
older Spring Boot
```

Strategy:

```text
- use compatible Artemis client version;
- stay in javax.jms namespace;
- avoid modern language features;
- test TLS/cipher compatibility;
- be careful with old app server classloading;
- watch transitive dependencies.
```

### 27.2 Java 11/17

Use case:

```text
modernized JVM baseline
Spring Boot 2/3 transition
Jakarta migration planning
container deployment
```

Strategy:

```text
- decide javax vs jakarta based on framework;
- avoid mixing namespaces;
- test module/classpath issues;
- container memory config;
- stable LTS operations.
```

### 27.3 Java 21/25

Use case:

```text
modern runtime
high-throughput services
new greenfield Jakarta/Spring apps
cloud-native deployment
```

Strategy:

```text
- prefer jakarta.jms stack if ecosystem supports it;
- use structured concurrency/virtual threads only around JMS boundaries carefully;
- keep JMS resources scoped and not concurrently misused;
- benchmark with real broker and real payload;
- observe GC and allocation pressure.
```

---

## 28. Local Development Setup Mental Model

A local broker should help reproduce semantics, not hide them.

### 28.1 Minimal Docker Compose Concept

```yaml
services:
  artemis:
    image: apache/activemq-artemis:latest
    ports:
      - "61616:61616"
      - "8161:8161"
    environment:
      ARTEMIS_USER: app
      ARTEMIS_PASSWORD: secret
    volumes:
      - artemis-data:/var/lib/artemis-instance

volumes:
  artemis-data:
```

Catatan:

1. Tag `latest` tidak ideal untuk production.
2. Untuk repeatable learning, pin version.
3. Untuk CI, gunakan ephemeral broker.
4. Untuk integration test, prefer Testcontainers jika stack mengizinkan.
5. Untuk production, jangan copy-paste local config.

### 28.2 Local Dev Checklist

```text
- create command queue explicitly;
- create event topic explicitly;
- configure DLQ;
- configure expiry;
- disable auto-create for selected tests;
- test redelivery;
- test consumer crash;
- test broker restart;
- test duplicate handling;
- test schema mismatch;
- test queue depth monitoring.
```

---

## 29. Production Destination Blueprint di Artemis

Contoh domain: case management.

### 29.1 Commands

```text
case.commands.create
case.commands.assign
case.commands.escalate
case.commands.close
```

Config style:

```xml
<addresses>
  <address name="case.commands.assign">
    <anycast>
      <queue name="case.commands.assign" />
    </anycast>
  </address>
</addresses>
```

### 29.2 Events

```text
case.events.created.v1
case.events.assigned.v1
case.events.escalated.v1
case.events.closed.v1
```

Config style:

```xml
<addresses>
  <address name="case.events.assigned.v1">
    <multicast />
  </address>
</addresses>
```

### 29.3 DLQ

```text
DLQ.case.commands
DLQ.case.events.audit-consumer
DLQ.case.events.notification-consumer
```

Prefer DLQ yang bisa menunjukkan owner:

```text
DLQ.<domain>.<message-family>.<consumer-owner>
```

### 29.4 Expiry

```text
EXP.notification.commands
EXP.ui.async-requests
```

Jangan expiry silent untuk critical state transition.

### 29.5 Security Roles

```text
case-command-producer
case-command-consumer
case-event-publisher
case-event-subscriber-audit
case-operator
broker-admin
```

### 29.6 Address Settings

```xml
<address-settings>
  <address-setting match="case.commands.#">
    <dead-letter-address>DLQ.case.commands</dead-letter-address>
    <expiry-address>EXP.case.commands</expiry-address>
    <max-delivery-attempts>5</max-delivery-attempts>
    <redelivery-delay>5000</redelivery-delay>
    <redelivery-multiplier>2.0</redelivery-multiplier>
    <max-size-bytes>1073741824</max-size-bytes>
    <address-full-policy>PAGE</address-full-policy>
    <auto-create-addresses>false</auto-create-addresses>
    <auto-create-queues>false</auto-create-queues>
  </address-setting>
</address-settings>
```

---

## 30. Failure Scenario: Consumer Crash Setelah DB Commit Sebelum Ack

Scenario:

```text
1. Consumer receives message M1 from case.commands.assign.
2. Consumer updates DB: case assigned to user U1.
3. DB commit succeeds.
4. Consumer crashes before JMS ack/commit.
5. Broker redelivers M1.
```

Outcome:

```text
Without idempotency:
- duplicate assignment side effect;
- duplicate audit;
- duplicate notification;
- invalid state transition;
- operator confusion.
```

With idempotency:

```text
1. Consumer checks commandId.
2. DB sees commandId already processed.
3. Consumer skips side effect.
4. Consumer ack/commit message.
5. System converges.
```

Artemis did the correct broker behavior: redelivery after uncertain ack. The application must handle duplicate safely.

Top 1% interpretation:

```text
This is not broker bug.
This is distributed transaction boundary reality.
```

---

## 31. Failure Scenario: Broker Paging Karena Downstream DB Lambat

Scenario:

```text
Producer rate: 500 msg/s
Consumer DB processing: 100 msg/s
Difference: +400 msg/s backlog
```

Result:

```text
queue depth grows
oldest message age grows
address reaches max-size-bytes
broker starts paging
latency increases
storage IO increases
consumer remains bottleneck
```

Wrong response:

```text
Increase broker memory.
```

Better response:

```text
1. Confirm arrival/dequeue rates.
2. Identify consumer bottleneck.
3. Check DB latency and pool saturation.
4. Scale consumers if DB can handle.
5. Add backpressure if downstream cannot handle.
6. Split hot workload if one queue too broad.
7. Tune prefetch/concurrency.
8. Keep paging as safety net, not normal state.
```

---

## 32. Failure Scenario: Topic Event Dropped Because No Subscription Queue

Scenario:

```text
Producer publishes to JMS topic: case.events.assigned.v1
No durable subscriber exists yet.
No queue bound to the multicast address.
Message sent successfully.
No consumer receives it later.
```

Artemis JMS-to-core mapping documentation states that for a JMS topic, if there are no queues on the address, the message is dropped. Lihat: <https://artemis.apache.org/components/artemis/documentation/latest/jms-core-mapping.html>

Interpretation:

```text
Non-durable pub/sub does not imply broker retention for future subscribers.
```

Solution:

```text
- create durable subscription for services that must not miss events;
- provision subscription queues explicitly if needed;
- use queue-based integration event delivery if each consumer has durable processing requirement;
- verify subscriber exists before production rollout;
- monitor event subscription queues.
```

---

## 33. Failure Scenario: Auto-Create Typo Creates Silent Black Hole

Scenario:

```text
Expected queue: payment.commands.capture
Actual producer typo: payment.command.capture
Auto-create enabled.
```

Result:

```text
Producer send succeeds.
Broker creates payment.command.capture.
No consumer listens there.
Message accumulates silently.
Business process stuck.
```

Mitigation:

```text
- disable auto-create in production;
- manage destinations as config/IaC;
- alert unknown address creation;
- restrict create-address/create-queue permission;
- integration test destination names;
- centralize destination constants carefully;
- validate startup against broker expected destinations.
```

---

## 34. Failure Scenario: Shared Admin User Across All Apps

Scenario:

```text
All services connect as admin/admin.
```

Failure:

```text
- any service can consume others' queues;
- any service can delete/create destination;
- audit cannot identify producer/consumer;
- compromised service compromises broker;
- accidental bug becomes platform incident.
```

Mitigation:

```text
- per-service principal;
- least privilege ACL;
- separate producer/consumer roles;
- separate operator/admin roles;
- credential rotation;
- audit connection identity;
- no admin credential in app runtime.
```

---

## 35. Artemis vs ActiveMQ Classic: Jangan Asumsikan Sama

ActiveMQ Classic dan Artemis berbeda secara architecture dan behavior.

Jangan migrate hanya dengan mengganti URI.

Checklist migration:

```text
1. JMS namespace: javax or jakarta?
2. Client dependency compatible?
3. Destination mapping understood?
4. Queue/topic semantics tested?
5. Durable subscription names mapped?
6. DLQ policy equivalent?
7. Redelivery policy equivalent?
8. Selector behavior tested?
9. Prefetch/window equivalent?
10. Transaction behavior tested?
11. Failover URI equivalent?
12. Security roles mapped?
13. Management/metrics changed?
14. Message properties/vendor headers changed?
15. OpenWire compatibility needed?
16. Performance benchmark repeated?
```

Top 1% rule:

```text
A broker migration is a semantics migration, not a library upgrade.
```

---

## 36. Artemis vs Kafka/RabbitMQ: Apa yang Perlu Diingat

Artemis cocok ketika Anda membutuhkan:

```text
- JMS/Jakarta Messaging compatibility;
- enterprise queue semantics;
- request/reply support;
- transaction support;
- per-message routing/selector;
- durable command processing;
- broker-managed DLQ/redelivery;
- Jakarta EE integration;
- legacy enterprise modernization path.
```

Kafka lebih natural untuk:

```text
- append-only log;
- long retention;
- replay by offset;
- stream processing;
- high-throughput event log;
- consumer group over partitions;
- event sourcing style workloads.
```

RabbitMQ lebih natural untuk:

```text
- AMQP exchange routing;
- flexible routing topology;
- lightweight queue workloads;
- language-agnostic messaging;
- exchange/binding mental model.
```

Tetapi perbandingan detail ada di Part 31. Di Part ini cukup ingat:

```text
Use Artemis when JMS semantics are first-class and enterprise broker features matter.
Do not force Artemis to behave like Kafka log retention.
Do not force Kafka to behave like JMS request/reply queue.
```

---

## 37. Common Anti-Patterns di Artemis/JMS Production

### 37.1 Broker sebagai Database

```text
Symptom:
- message ditahan berminggu-minggu;
- payload besar;
- query/browse menjadi workflow utama;
- consumer tidak jelas.

Fix:
- gunakan DB/object store untuk state;
- broker untuk koordinasi;
- DLQ/parking lot untuk exception workflow, bukan main storage.
```

### 37.2 Topic untuk Command

```text
Symptom:
- satu command diterima banyak service;
- duplicate side effects;
- ownership tidak jelas.

Fix:
- command pakai queue/anycast;
- event pakai topic/multicast.
```

### 37.3 Auto-Create di Production

```text
Symptom:
- typo destination silent;
- resource liar;
- policy default salah.

Fix:
- disable auto-create;
- pre-provision destination;
- restrict create permissions.
```

### 37.4 Semua Service Pakai Satu Queue Besar

```text
Symptom:
- mixed message types;
- selector kompleks;
- poison message mengganggu domain lain;
- scaling tidak presisi.

Fix:
- split by domain/message type/owner;
- gunakan route eksplisit;
- hindari broker jadi query engine.
```

### 37.5 DLQ Tanpa Owner

```text
Symptom:
- DLQ naik tapi tidak ada yang triage;
- replay manual sembarangan;
- audit hilang.

Fix:
- DLQ per domain/owner;
- alert;
- runbook;
- replay tool;
- audit replay.
```

### 37.6 ObjectMessage untuk Contract Antar Service

```text
Symptom:
- class compatibility issue;
- Java serialization risk;
- tight coupling;
- non-Java consumer sulit.

Fix:
- JSON/Avro/Protobuf/XML depending context;
- schema version;
- explicit envelope.
```

### 37.7 Cluster untuk Menutupi Consumer Bottleneck

```text
Symptom:
- tambah broker tapi queue tetap lambat;
- message redistribution tinggi;
- operational complexity naik.

Fix:
- ukur bottleneck;
- scale consumer/downstream;
- tune storage;
- partition workload;
- cluster hanya jika benar-benar broker bottleneck.
```

---

## 38. Reference Architecture: Artemis untuk Case Management Regulated System

### 38.1 Components

```text
Case API
  -> DB transaction
  -> Outbox table
  -> Outbox Relay
  -> Artemis command/event destination
  -> Consumers
  -> Inbox/Dedup
  -> Domain DB update
  -> Audit trail
```

### 38.2 Flow: Command

```text
User assigns case
  |
  v
Case API validates request
  |
  v
DB transaction:
  - write case state transition request
  - write outbox command/event
  |
  v
Outbox relay sends to Artemis case.commands.assign
  |
  v
Assignment worker consumes
  |
  v
Idempotency check by commandId
  |
  v
Apply state transition if valid
  |
  v
Ack/commit
```

### 38.3 Flow: Event

```text
Case assigned
  |
  v
case.events.assigned.v1 topic/address multicast
  |
  +--> audit subscription queue
  +--> notification subscription queue
  +--> reporting projection subscription queue
```

### 38.4 Reliability Controls

```text
- persistent delivery for critical command/event;
- idempotency key;
- durable subscription for required event consumers;
- DLQ per owner;
- expiry only for disposable messages;
- outbox for DB->broker consistency;
- inbox/dedup for consumer consistency;
- correlation id;
- audit replay;
- queue age alerts.
```

### 38.5 Security Controls

```text
- per-service broker user;
- producer-only role for relay;
- consume-only role for worker;
- browse/retry role for operator;
- admin only for platform team;
- TLS/mTLS where required;
- no secret in code;
- audit management actions.
```

---

## 39. Artemis Design Review Checklist

Gunakan checklist ini saat review desain.

### 39.1 Destination Design

```text
[ ] Apakah command dan event dipisah?
[ ] Apakah command menggunakan anycast queue?
[ ] Apakah event menggunakan multicast/topic dengan subscription jelas?
[ ] Apakah nama destination menunjukkan domain dan semantic?
[ ] Apakah versioning event contract jelas?
[ ] Apakah mixed anycast/multicast pada satu address dihindari?
```

### 39.2 Broker Configuration

```text
[ ] Apakah address/queue critical dibuat eksplisit?
[ ] Apakah auto-create disabled untuk production critical path?
[ ] Apakah DLQ configured?
[ ] Apakah expiry configured bila TTL dipakai?
[ ] Apakah address-full-policy sesuai?
[ ] Apakah max-size-bytes realistis?
[ ] Apakah paging volume cukup?
[ ] Apakah journal volume cukup dan isolated?
```

### 39.3 Client Code

```text
[ ] Apakah JMS namespace sesuai stack: javax vs jakarta?
[ ] Apakah dependency provider sesuai broker/client version?
[ ] Apakah connection/session/context lifecycle benar?
[ ] Apakah session tidak dipakai concurrent secara salah?
[ ] Apakah delivery mode sesuai criticality?
[ ] Apakah ack/commit setelah side effect aman?
[ ] Apakah idempotency diterapkan?
[ ] Apakah duplicate redelivery aman?
```

### 39.4 Failure Handling

```text
[ ] Apakah retry transient/permanent dibedakan?
[ ] Apakah poison message tidak membuat infinite loop?
[ ] Apakah DLQ punya owner/runbook?
[ ] Apakah replay tool aman dan audited?
[ ] Apakah expired message terlihat?
[ ] Apakah broker restart tested?
[ ] Apakah consumer crash tested?
[ ] Apakah DB-down scenario tested?
```

### 39.5 Security

```text
[ ] Apakah per-service credential dipakai?
[ ] Apakah least privilege diterapkan?
[ ] Apakah app tidak memakai admin user?
[ ] Apakah TLS/mTLS sesuai boundary?
[ ] Apakah secret rotation ada?
[ ] Apakah operator action audited?
```

### 39.6 Observability

```text
[ ] Apakah queue depth dimonitor?
[ ] Apakah oldest message age dimonitor?
[ ] Apakah DLQ alert aktif?
[ ] Apakah redelivery spike terlihat?
[ ] Apakah consumer count = 0 alert?
[ ] Apakah paging alert?
[ ] Apakah correlation id end-to-end?
[ ] Apakah broker metrics dan app metrics dikorelasikan?
```

---

## 40. Latihan Engineering

### Latihan 1 — Mapping JMS ke Artemis

Diberikan:

```text
JMS topic: compliance.events.case-closed.v1
Durable subscriber: audit-service / audit-subscription
Shared durable subscriber: reporting-service / reporting-subscription with 3 consumers
```

Tentukan:

```text
1. Address Artemis apa?
2. Queue subscription apa saja?
3. Routing type apa?
4. Apa yang terjadi jika producer publish sebelum durable subscription dibuat?
5. Apa metric yang harus dimonitor?
```

### Latihan 2 — Production Policy

Untuk destination:

```text
payment.commands.capture
```

Desain:

```text
1. routing type;
2. DLQ;
3. redelivery policy;
4. expiry policy;
5. security roles;
6. idempotency key;
7. alerting.
```

### Latihan 3 — Debug Scenario

Gejala:

```text
Queue depth rendah.
Delivering count tinggi.
Consumer CPU rendah.
DB connection pool penuh.
Oldest message age naik.
```

Jawab:

```text
1. Apa kemungkinan akar masalah?
2. Mengapa queue depth rendah bisa menipu?
3. Apa tindakan aman pertama?
4. Apa metric tambahan yang perlu dicek?
```

### Latihan 4 — Auto-Create Incident

Gejala:

```text
Business process stuck.
Consumer queue kosong.
Broker punya address baru dengan nama mirip expected queue.
```

Jawab:

```text
1. Apa penyebab paling mungkin?
2. Apa mitigasi immediate?
3. Apa preventive control production?
```

### Latihan 5 — Cluster Decision

Workload:

```text
Single broker CPU 25%.
Disk IO 30%.
Queue depth naik.
Consumer DB latency 2s per message.
Team ingin tambah broker cluster.
```

Jawab:

```text
1. Apakah cluster kemungkinan membantu?
2. Bottleneck paling mungkin di mana?
3. Apa eksperimen yang harus dilakukan sebelum cluster?
```

---

## 41. Ringkasan Mental Model

1. Artemis adalah broker runtime; JMS/Jakarta Messaging adalah API contract.
2. JMS queue/topic dipetakan ke Artemis address/queue/routing type.
3. JMS queue biasanya address + anycast queue bernama sama.
4. JMS topic adalah address multicast; subscription adalah queue.
5. Address bukan queue; producer send ke address, consumer consume dari queue.
6. Anycast cocok untuk command/work distribution.
7. Multicast cocok untuk event/pub-sub/fan-out.
8. Auto-create nyaman untuk dev, berbahaya untuk production critical path.
9. DLQ, expiry, redelivery, paging, dan security adalah bagian dari desain, bukan setting ops belakangan.
10. Persistent message menjadikan storage latency sebagai bagian dari application latency.
11. Paging adalah survival mechanism, bukan normal operating target.
12. Cluster bukan silver bullet; ukur bottleneck dulu.
13. HA tidak menghapus duplicate, uncertain send, atau kebutuhan idempotency.
14. Broker security harus least privilege per service.
15. Observability queue harus mencakup depth, age, redelivery, DLQ, consumer count, delivering count, dan paging.
16. Migration broker adalah migration semantics, bukan sekadar ganti dependency.
17. Top 1% engineer membaca broker config sebagai distributed system contract.

---

## 42. Production Heuristics

```text
Heuristic 1:
If message loss is unacceptable, do not rely on non-durable topic subscription.

Heuristic 2:
If duplicate side effect is unacceptable, design idempotency before production.

Heuristic 3:
If destination typo can silently succeed, production is under-controlled.

Heuristic 4:
If DLQ has no owner, DLQ is not a recovery mechanism.

Heuristic 5:
If queue depth grows, compare arrival rate and service rate before tuning broker.

Heuristic 6:
If storage is slow, persistent messaging is slow.

Heuristic 7:
If cluster is proposed, ask what measured bottleneck it solves.

Heuristic 8:
If topic consumer must not miss event, create durable subscription before publishing.

Heuristic 9:
If all apps use admin broker credential, security boundary does not exist.

Heuristic 10:
If broker config cannot be explained by application invariant, it is accidental infrastructure.
```

---

## 43. Sumber Resmi dan Bacaan Lanjutan

1. Apache ActiveMQ Artemis — Address Model  
   <https://artemis.apache.org/components/artemis/documentation/latest/address-model.html>

2. Apache ActiveMQ Artemis — Mapping JMS Concepts to the Core API  
   <https://artemis.apache.org/components/artemis/documentation/latest/jms-core-mapping.html>

3. Apache ActiveMQ Artemis — Clusters  
   <https://artemis.apache.org/components/artemis/documentation/latest/clusters.html>

4. Apache ActiveMQ Artemis — Performance Tuning  
   <https://artemis.apache.org/components/artemis/documentation/latest/perf-tuning.html>

5. Jakarta Messaging Specification 3.1  
   <https://jakarta.ee/specifications/messaging/3.1/>

---

## 44. Penutup Part 18

Part ini menempatkan Artemis sebagai broker referensi untuk memahami JMS/Jakarta Messaging secara nyata. Setelah memahami part ini, Anda seharusnya tidak lagi melihat JMS hanya sebagai:

```java
producer.send(message);
consumer.receive();
```

Tetapi sebagai sistem dengan banyak contract:

```text
message contract
routing contract
durability contract
ack contract
redelivery contract
DLQ contract
security contract
observability contract
capacity contract
failure recovery contract
```

Part berikutnya akan membahas **provider differences**: ActiveMQ Classic, IBM MQ, RabbitMQ JMS Client, Solace, WebLogic/JBoss/Open Liberty, dan bagaimana membaca batas portabilitas JMS saat provider berbeda.

Status seri: belum selesai.  
Selesai: Part 0 sampai Part 18 dari 35.  
Berikutnya: Part 19 — ActiveMQ Classic, IBM MQ, RabbitMQ JMS Client, Solace, WebLogic/JBoss/Open Liberty: Provider Differences.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-017.md">⬅️ Learn Java JMS / Jakarta Messaging Enterprise Message-Oriented Middleware Engineering — Part 17</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-019.md">Part 19 — Provider Differences: ActiveMQ Classic, IBM MQ, RabbitMQ JMS Client, Solace, WebLogic, WildFly, Open Liberty ➡️</a>
</div>

# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering

## Part 1 — Evolution: JMS 1.1, JMS 2.0, Jakarta Messaging 3.x, dan Dampaknya ke Java 8–25

> **Status seri:** Part 1 dari 35.  
> **Fokus:** memahami evolusi standard JMS/Jakarta Messaging, bukan sekadar perubahan nama package.  
> **Target pembaca:** engineer Java yang sudah paham backend, transaksi, persistence, observability, dan sekarang ingin memahami messaging secara arsitektural dan production-grade.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu harus bisa menjawab pertanyaan berikut dengan jelas:

1. Apa bedanya **JMS**, **Java Message Service**, dan **Jakarta Messaging**?
2. Kenapa ada `javax.jms` dan `jakarta.jms`?
3. Apa perbedaan besar antara JMS 1.1, JMS 2.0, Jakarta Messaging 2.0, 3.0, dan 3.1?
4. Kenapa migrasi JMS sering gagal bukan karena API-nya sulit, tapi karena **runtime compatibility**?
5. Bagaimana memilih stack JMS untuk Java 8, 11, 17, 21, dan 25?
6. Apa yang harus dijaga agar aplikasi enterprise tidak terkunci pada vendor secara tidak sadar?
7. Bagaimana membaca dokumentasi broker JMS tanpa terjebak ilusi bahwa semua provider akan behave sama?

Part ini adalah peta evolusi. Kita belum masuk detail `Session`, `MessageProducer`, `MessageConsumer`, acknowledgement, transaksi, DLQ, dan lain-lain. Itu akan dibahas di part berikutnya. Di sini kita membangun **historical and compatibility mental model**.

---

## 2. Core Mental Model: JMS adalah Kontrak API, Bukan Broker

Kesalahan paling umum:

> “Saya pakai JMS, berarti saya pakai broker X.”

Tidak tepat.

Yang benar:

> JMS/Jakarta Messaging adalah **standard programming model** untuk aplikasi Java agar dapat membuat, mengirim, menerima, dan membaca message dari enterprise messaging system.

Artinya:

```text
Application Code
   |
   | uses standard API
   v
JMS / Jakarta Messaging API
   |
   | implemented by provider library
   v
JMS Provider / Broker Client
   |
   | speaks provider protocol
   v
Broker Runtime
   |
   | stores, routes, dispatches messages
   v
Queue / Topic / Durable Subscription / DLQ / Journal / Cluster
```

JMS bukan broker. JMS juga bukan protocol wire-level seperti AMQP, MQTT, atau Kafka protocol. JMS adalah **Java API abstraction**.

Contoh provider/broker yang bisa menyediakan JMS/Jakarta Messaging interface:

- Apache ActiveMQ Classic
- Apache ActiveMQ Artemis
- IBM MQ
- Oracle WebLogic JMS
- Open Liberty / WebSphere JMS integration
- WildFly/EAP dengan messaging subsystem
- Solace JMS
- RabbitMQ JMS client dalam konteks tertentu

Yang standard adalah API dan behavior minimal yang diwajibkan specification. Yang tidak selalu sama:

- failover URI
- reconnect semantics
- prefetch/consumer window
- redelivery delay
- DLQ policy
- message grouping implementation
- clustering
- storage journal
- management API
- broker address model
- XA behavior detail
- transaction timeout handling
- priority fairness
- selector optimization

Inilah sebabnya top engineer tidak hanya bertanya:

> “Apakah broker ini support JMS?”

Tapi bertanya:

> “Bagian mana dari semantics aplikasi saya yang dijamin oleh spec, dan bagian mana yang bergantung pada provider?”

---

## 3. Timeline Besar JMS / Jakarta Messaging

Secara praktis, timeline yang perlu kamu ingat:

```text
JMS 1.0.x       -> era awal, model Queue dan Topic masih lebih terpisah
JMS 1.1         -> unified domain model: Queue dan Topic bisa dipakai lewat API yang lebih umum
JMS 2.0         -> simplified API: JMSContext, JMSProducer, JMSConsumer; async send; shared subscriptions
Jakarta 2.0     -> re-release JMS 2.0 di bawah Eclipse/Jakarta, masih package javax.jms
Jakarta 3.0     -> namespace berubah dari javax.jms ke jakarta.jms
Jakarta 3.1     -> refinements untuk Jakarta EE 10, API tetap jakarta.jms
Jakarta EE 11   -> platform modern; messaging 3.1 tetap relevan dalam ecosystem
```

Sumber resmi Jakarta Messaging menyebut specification ini sebagai cara bagi aplikasi Java untuk membuat, mengirim, dan menerima message melalui layanan komunikasi asynchronous yang reliable dan loosely coupled. Jakarta Messaging 3.1 dirilis untuk Jakarta EE 10, sedangkan Jakarta Messaging 2.0 adalah re-release dari JSR 343/JMS 2.0 di bawah Eclipse Foundation Specification License. Jakarta Messaging 3.0 adalah rilis Jakarta EE 9 yang membawa perubahan namespace ke `jakarta.jms`.  

Referensi:

- Jakarta Messaging project/specification page: https://jakarta.ee/specifications/messaging/
- Jakarta Messaging 3.1: https://jakarta.ee/specifications/messaging/3.1/
- Jakarta Messaging 3.0: https://jakarta.ee/specifications/messaging/3.0/
- Jakarta Messaging 2.0: https://jakarta.ee/specifications/messaging/2.0/
- JMS 2.0 / JSR 343: https://jcp.org/en/jsr/detail?id=343

---

## 4. Terminologi yang Harus Dibedakan

### 4.1 Java Message Service / JMS

Biasanya merujuk ke standard lama di dunia Java EE, terutama namespace:

```java
javax.jms.*
```

Contoh:

```java
import javax.jms.Connection;
import javax.jms.Session;
import javax.jms.MessageProducer;
import javax.jms.MessageConsumer;
```

JMS 1.1 dan JMS 2.0 berada di era ini.

---

### 4.2 Jakarta Messaging

Nama modern setelah Java EE berpindah ke Eclipse Foundation menjadi Jakarta EE.

Namespace modern:

```java
jakarta.jms.*
```

Contoh:

```java
import jakarta.jms.JMSContext;
import jakarta.jms.JMSProducer;
import jakarta.jms.JMSConsumer;
import jakarta.jms.Queue;
```

Jakarta Messaging 3.x menggunakan namespace ini.

---

### 4.3 JMS Provider

Provider adalah implementasi dari API JMS/Jakarta Messaging.

Contoh:

```text
API:      jakarta.jms.JMSContext
Provider: ActiveMQ Artemis client library
Broker:   ActiveMQ Artemis server runtime
```

Atau:

```text
API:      javax.jms.Session
Provider: IBM MQ JMS client
Broker:   IBM MQ queue manager
```

---

### 4.4 Broker

Broker adalah runtime server yang menerima, menyimpan, merutekan, dan mengirim message.

Broker punya responsibility seperti:

- menerima connection dari client
- menerima message dari producer
- menyimpan persistent message
- men-dispatch message ke consumer
- mengatur queue/topic/subscription
- melakukan redelivery
- memindahkan poison message ke DLQ
- melakukan paging ketika memory tidak cukup
- menjalankan cluster/failover
- menyediakan management API

JMS API tidak otomatis menjamin semua capability broker sama.

---

### 4.5 Client Library

Client library adalah library yang berjalan di aplikasi Java.

Contoh dependency:

```xml
<dependency>
  <groupId>jakarta.jms</groupId>
  <artifactId>jakarta.jms-api</artifactId>
  <version>3.1.0</version>
</dependency>
```

Dependency di atas hanya API. Agar aplikasi benar-benar bisa connect ke broker, biasanya perlu provider client library, misalnya ActiveMQ Artemis client.

Mental model:

```text
jakarta.jms-api = interface / contract
provider client = implementation / transport integration
broker = server runtime
```

---

## 5. JMS 1.1: Unified Domain Model

JMS 1.1 penting karena menyederhanakan model lama yang memisahkan queue dan topic terlalu keras.

Sebelum unified model, ada API khusus untuk queue dan topic:

```text
QueueConnectionFactory
QueueConnection
QueueSession
QueueSender
QueueReceiver

TopicConnectionFactory
TopicConnection
TopicSession
TopicPublisher
TopicSubscriber
```

JMS 1.1 memperkenalkan model umum:

```text
ConnectionFactory
Connection
Session
MessageProducer
MessageConsumer
Destination
```

Dengan ini, queue dan topic bisa diperlakukan sebagai `Destination`.

### 5.1 Kenapa Ini Penting?

Karena dari sisi aplikasi, banyak logic producer/consumer tidak peduli apakah destination itu queue atau topic.

Contoh konsep:

```java
Destination destination = ...;
MessageProducer producer = session.createProducer(destination);
producer.send(message);
```

Kode ini bisa mengirim ke queue atau topic, selama destination disediakan oleh provider/container.

### 5.2 Mental Model JMS 1.1

```text
ConnectionFactory
   creates
Connection
   creates
Session
   creates
MessageProducer / MessageConsumer
   sends/receives
Message
   through
Destination
```

### 5.3 Dampak Arsitektural

JMS 1.1 membuat aplikasi lebih mudah dibuat portable, tetapi tidak menghilangkan kebutuhan memahami semantics queue vs topic.

Kesalahan umum:

> Karena sama-sama `Destination`, queue dan topic dianggap interchangeable.

Tidak.

Queue dan topic berbeda secara semantic:

```text
Queue:
  satu message biasanya diproses oleh satu consumer
  cocok untuk command/work distribution

Topic:
  satu message bisa diterima banyak subscriber
  cocok untuk broadcast event/fan-out
```

API-nya unified, semantics-nya tetap berbeda.

---

## 6. JMS 2.0: Simplified API dan Modernization

JMS 2.0 adalah perubahan besar dari sisi developer ergonomics.

JMS 2.0 memperkenalkan:

- `JMSContext`
- `JMSProducer`
- `JMSConsumer`
- simplified send/receive API
- try-with-resources friendliness
- delivery delay
- asynchronous send
- shared durable subscriptions
- shared non-durable subscriptions
- injection-friendly programming model di Java EE

### 6.1 Sebelum JMS 2.0: Verbose API

Gaya JMS 1.1 umum:

```java
Connection connection = null;
Session session = null;
try {
    connection = connectionFactory.createConnection();
    session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);

    Queue queue = session.createQueue("orders.incoming");
    MessageProducer producer = session.createProducer(queue);

    TextMessage message = session.createTextMessage("{\"orderId\":\"O-1001\"}");
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

Masalah:

- lifecycle panjang
- banyak boilerplate
- raw exception handling
- resource close manual
- mudah salah reuse object
- tidak ergonomis untuk kasus sederhana

---

### 6.2 Setelah JMS 2.0: Simplified API

Gaya JMS 2.0:

```java
try (JMSContext context = connectionFactory.createContext()) {
    Queue queue = context.createQueue("orders.incoming");

    context.createProducer()
           .send(queue, "{\"orderId\":\"O-1001\"}");
}
```

Lebih pendek, tetapi jangan salah paham: API yang lebih pendek tidak berarti semantics lebih sederhana.

`JMSContext` secara konseptual menggabungkan peran:

```text
Connection + Session
```

Tetapi kamu tetap harus memahami:

- session mode
- acknowledgement
- transaction
- thread-safety
- resource lifecycle
- provider implementation

### 6.3 JMS 2.0 Bukan Sekadar Syntactic Sugar

JMS 2.0 juga memperkenalkan feature penting:

#### 6.3.1 Delivery Delay

Producer bisa meminta broker menunda delivery message.

Konsep:

```text
send now
store now
make visible later
```

Contoh:

```java
context.createProducer()
       .setDeliveryDelay(30_000)
       .send(queue, "retry after 30 seconds");
```

Ini berguna untuk:

- delayed retry
- scheduled workflow trigger
- cooldown event
- deferred processing

Tapi hati-hati:

- ordering bisa berubah
- broker storage bisa penuh jika banyak delayed message
- bukan pengganti scheduler kompleks
- visibility semantics bergantung provider

---

#### 6.3.2 Asynchronous Send

Producer dapat mengirim secara async dengan completion listener.

Mental model:

```text
application thread submits send
provider handles actual send/confirmation later
callback invoked on completion/failure
```

Ini berguna untuk throughput, tetapi memperumit:

- error handling
- retry
- shutdown
- backpressure
- transaction boundary
- ordering expectation

---

#### 6.3.3 Shared Subscription

Sebelum shared subscription, durable topic subscription cenderung satu consumer per subscription identity. JMS 2.0 memungkinkan beberapa consumer berbagi subscription.

Mental model:

```text
Topic event stream
   -> durable subscription name
      -> multiple consumers competing over same subscription backlog
```

Ini berguna untuk scaling topic subscriber tanpa setiap instance menerima copy yang sama.

---

## 7. Jakarta Messaging 2.0: Re-Release JMS 2.0

Jakarta Messaging 2.0 adalah transisi penting tapi sering membingungkan.

Karakteristik praktis:

```text
Jakarta Messaging 2.0
  package: javax.jms
  essence: re-release JMS 2.0 under Eclipse/Jakarta governance
  ecosystem: Jakarta EE 8
```

Artinya, meskipun namanya Jakarta Messaging, package-nya masih:

```java
javax.jms.*
```

Ini sering membuat engineer bingung:

> “Saya sudah pakai Jakarta Messaging, kenapa masih import `javax.jms`?”

Jawaban:

> Karena Jakarta Messaging 2.0 adalah fase transisi. Namespace belum berpindah ke `jakarta.jms`.

---

## 8. Jakarta Messaging 3.0: Namespace Break

Jakarta Messaging 3.0 adalah titik migrasi paling penting.

Perubahan besar:

```text
javax.jms.*  ->  jakarta.jms.*
```

Contoh:

```java
// old
import javax.jms.JMSContext;
import javax.jms.Queue;

// new
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;
```

Secara API programming model, banyak konsep tetap sama. Tetapi secara binary compatibility, ini breaking.

### 8.1 Kenapa Namespace Change Itu Besar?

Karena Java melihat ini sebagai package berbeda total.

```text
javax.jms.Message != jakarta.jms.Message
javax.jms.ConnectionFactory != jakarta.jms.ConnectionFactory
```

Walaupun nama class/interface mirip, secara type system Java itu beda.

### 8.2 Contoh Masalah

Misal aplikasi Spring Boot 3 menggunakan Jakarta:

```java
import jakarta.jms.ConnectionFactory;
```

Tetapi provider client library lama hanya expose:

```java
javax.jms.ConnectionFactory
```

Maka error bisa muncul di compile-time atau runtime:

```text
required: jakarta.jms.ConnectionFactory
found:    javax.jms.ConnectionFactory
```

Atau lebih buruk:

```text
ClassCastException: class com.vendor.XConnectionFactory cannot be cast to jakarta.jms.ConnectionFactory
```

### 8.3 Migration Rule

Rule penting:

```text
Dalam satu runtime boundary, jangan campur javax.jms dan jakarta.jms kecuali ada adapter/bridge yang jelas.
```

Yang dimaksud runtime boundary:

- satu aplikasi deployable
- satu classloader module
- satu Spring Boot application
- satu Jakarta EE application
- satu library API surface

---

## 9. Jakarta Messaging 3.1: Refinement untuk Jakarta EE 10

Jakarta Messaging 3.1 berada di namespace:

```java
jakarta.jms.*
```

Dari sisi developer, 3.1 bukan lompatan sebesar 2.0 atau 3.0. Tetapi penting karena menjadi versi umum pada Jakarta EE 10.

Perubahan yang sering terlihat di release note antara lain refinement annotation seperti repeatable annotation untuk connection factory dan destination definition.

Yang lebih penting secara praktis:

- ecosystem Jakarta EE 10 menggunakan `jakarta.*`
- Spring Framework 6 / Spring Boot 3 juga bergerak ke Jakarta namespace
- Java 17+ menjadi baseline umum untuk banyak framework modern
- provider harus menyediakan client yang sesuai namespace

---

## 10. Jakarta EE 11 dan Java Modern

Jakarta EE 11 adalah platform modern yang membawa perubahan broader ecosystem seperti dukungan Java Records dan awareness terhadap Virtual Threads di level platform. Messaging 3.1 tetap menjadi bagian penting dari ecosystem enterprise messaging, walaupun Java modern membawa model concurrency baru.

Poin penting:

> Virtual threads tidak menghapus kebutuhan messaging.

Virtual threads membantu blocking I/O scalability. Messaging menyelesaikan problem berbeda:

- decoupling antar service
- retryable work
- durability
- asynchronous orchestration
- temporal buffering
- workload smoothing
- failure isolation
- eventual consistency

Jangan bingung antara:

```text
Virtual threads = cara menjalankan banyak blocking tasks lebih murah
JMS = cara mengoordinasikan pekerjaan lintas waktu/proses/service
```

Virtual threads bisa membuat consumer code lebih sederhana dalam beberapa kasus, tetapi tidak menggantikan broker semantics.

---

## 11. Java Version Matrix: Java 8 sampai Java 25

Berikut peta praktis untuk Java 8–25.

### 11.1 Java 8

Biasanya terkait dengan:

- Java EE legacy
- JMS 1.1 / JMS 2.0
- `javax.jms`
- application server lama
- Spring Framework 5 / Spring Boot 2.x
- ActiveMQ Classic legacy
- IBM MQ client legacy
- WebLogic/WebSphere legacy

Pilihan umum:

```text
API namespace: javax.jms
Likely API version: JMS 1.1 or JMS 2.0
Runtime: legacy Java EE app server or standalone app
```

Risiko:

- library modern tidak lagi support Java 8
- TLS/security baseline tertinggal
- older broker client bug
- migration ke Spring Boot 3/Jakarta tidak langsung
- javax/jakarta split

Rekomendasi:

- gunakan JMS 2.0 simplified API jika provider mendukung
- jangan desain library internal baru dengan hard dependency ke Java 8 jika target jangka panjang modernisasi
- isolasi messaging adapter agar migrasi namespace lebih mudah

---

### 11.2 Java 11

Java 11 banyak dipakai sebagai LTS transisi.

Biasanya:

```text
javax.jms masih umum
jakarta.jms mulai masuk di project baru tertentu
Spring Boot 2.x masih umum
Jakarta EE 8/9 transisi
```

Risiko:

- project bisa setengah modern, setengah legacy
- dependency tree mudah mencampur `javax` dan `jakarta`
- app server support matrix harus dicek

Rekomendasi:

- tentukan sejak awal apakah aplikasi berada di dunia `javax` atau `jakarta`
- jangan campur dependency API hanya karena nama artifact terlihat mirip
- gunakan dependency management/BOM

---

### 11.3 Java 17

Java 17 menjadi baseline penting untuk banyak framework modern.

Biasanya:

```text
Spring Boot 3.x -> jakarta.*
Jakarta EE 10 -> jakarta.*
modern provider client -> mulai support jakarta.jms
```

Rekomendasi:

- untuk project baru, gunakan `jakarta.jms`
- gunakan provider client yang secara eksplisit support Jakarta Messaging 3.x
- hindari library internal yang expose `javax.jms` di public API
- jika perlu integrasi legacy broker, letakkan adapter di boundary

---

### 11.4 Java 21

Java 21 adalah LTS dengan virtual threads.

Messaging implication:

- consumer bisa memproses blocking I/O dengan model thread lebih murah
- listener container/framework belum tentu otomatis optimal dengan virtual threads
- broker client library belum tentu dirancang untuk virtual-thread-per-message
- transaction boundary tetap perlu hati-hati

Poin penting:

```text
Virtual threads improve execution model,
but do not change message delivery semantics.
```

Untuk JMS consumer:

- jangan menaikkan concurrency tanpa capacity model
- jangan membuat DB/downstream overload
- tetap ukur queue depth, processing latency, redelivery, DLQ
- tetap batasi inflight message

---

### 11.5 Java 25

Java 25 adalah LTS modern. Untuk JMS/Jakarta Messaging, pertanyaan utamanya bukan “apakah JMS berubah karena Java 25?”, tetapi:

- apakah provider client support Java 25?
- apakah application server support Java 25?
- apakah framework support Java 25?
- apakah broker client kompatibel dengan module/classloader/security behavior modern?
- apakah observability agent support Java 25?

Untuk project baru di Java 25:

```text
Prefer: jakarta.jms
Prefer: modern broker client
Prefer: explicit compatibility matrix
Prefer: integration tests with real broker
Avoid: relying on old javax.jms libraries
```

---

## 12. Namespace Compatibility Matrix

| Era | API Name | Package | Common Platform | Practical Meaning |
|---|---|---|---|---|
| JMS 1.1 | Java Message Service | `javax.jms` | Java EE legacy | Unified queue/topic domain model |
| JMS 2.0 | Java Message Service | `javax.jms` | Java EE 7/8 | Simplified API, `JMSContext`, shared subscription |
| Jakarta Messaging 2.0 | Jakarta Messaging | `javax.jms` | Jakarta EE 8 | Re-release of JMS 2.0, still old namespace |
| Jakarta Messaging 3.0 | Jakarta Messaging | `jakarta.jms` | Jakarta EE 9 | Namespace migration, binary break |
| Jakarta Messaging 3.1 | Jakarta Messaging | `jakarta.jms` | Jakarta EE 10/modern | Refinement, modern Jakarta baseline |

Rule:

```text
JMS 2.0 conceptually modernized the API.
Jakarta 3.0 operationally broke namespace compatibility.
```

---

## 13. Dependency Coordinates and What They Mean

### 13.1 API Dependency Only

Jakarta API example:

```xml
<dependency>
  <groupId>jakarta.jms</groupId>
  <artifactId>jakarta.jms-api</artifactId>
  <version>3.1.0</version>
</dependency>
```

This gives you interfaces/classes under:

```java
jakarta.jms.*
```

But it does not give you a broker implementation.

In a standalone app, if you only add API dependency, you may compile successfully but fail at runtime because there is no actual provider.

### 13.2 Provider Dependency

Provider dependency supplies implementation.

Example conceptual dependency:

```xml
<dependency>
  <groupId>org.apache.activemq</groupId>
  <artifactId>artemis-jakarta-client</artifactId>
  <version>...</version>
</dependency>
```

The exact artifact depends on provider/version.

### 13.3 Container-Provided API

In Jakarta EE server, you often do not package the JMS API/provider yourself.

The server provides:

- API classes
- connection factory
- resource adapter
- transaction manager integration
- JNDI binding
- MDB activation

In that model, packaging your own incompatible `jakarta.jms-api` or provider jar can cause classloader conflict.

Rule:

```text
Standalone app:
  you usually provide API + provider client.

Jakarta EE app server:
  server often provides API + provider integration.
```

---

## 14. Public API Design: Jangan Bocorkan Namespace Jika Tidak Perlu

Misal kamu membuat internal library:

```java
public interface MessagePublisher {
    void publish(jakarta.jms.Message message);
}
```

Ini mengunci semua consumer library kamu ke `jakarta.jms`.

Kadang tepat, tapi sering tidak perlu.

Lebih portable:

```java
public interface DomainEventPublisher {
    void publish(OrderApprovedEvent event);
}
```

Lalu JMS adapter berada di infrastructure layer:

```text
application/domain layer
   depends on
DomainEventPublisher
   implemented by
JmsDomainEventPublisher
   depends on
jakarta.jms
```

Benefit:

- migration `javax` ke `jakarta` lebih mudah
- test lebih mudah
- domain tidak tahu transport
- bisa ganti JMS ke Kafka/HTTP/outbox relay jika diperlukan

Top 1% heuristic:

> Jangan expose transport-specific type ke domain/application API kecuali memang library itu transport library.

---

## 15. Migration Trap: Search-and-Replace Tidak Cukup

Migrasi:

```text
javax.jms -> jakarta.jms
```

sering terlihat mudah.

Tetapi realita:

### 15.1 Source Compatibility

Kode bisa diubah import-nya.

```java
import javax.jms.Message;
```

menjadi:

```java
import jakarta.jms.Message;
```

Ini source-level change.

### 15.2 Binary Compatibility

Library lama yang compile terhadap `javax.jms.Message` tidak otomatis kompatibel dengan `jakarta.jms.Message`.

Jika sebuah jar expose method:

```java
void handle(javax.jms.Message message)
```

Maka method itu tidak sama dengan:

```java
void handle(jakarta.jms.Message message)
```

### 15.3 Runtime Compatibility

Application server atau provider client bisa membawa class yang berbeda.

Masalah umum:

```text
NoClassDefFoundError: javax/jms/Message
NoClassDefFoundError: jakarta/jms/Message
ClassCastException
NoSuchMethodError
LinkageError
```

### 15.4 Configuration Compatibility

Nama JNDI, resource adapter config, destination naming, dan connection factory property bisa berubah.

Contoh boundary:

```text
code migrated to jakarta.jms
but server still exposes javax-based resource adapter
```

### 15.5 Operational Compatibility

Setelah compile sukses, behavior bisa berubah karena upgrade provider:

- reconnect behavior berubah
- default prefetch berubah
- redelivery policy berubah
- TLS defaults berubah
- serialization restriction berubah
- management metrics berubah

Migration yang benar harus mencakup:

```text
source code
+ dependency tree
+ server runtime
+ provider client
+ broker version
+ config
+ transaction manager
+ observability
+ integration tests
+ failure tests
```

---

## 16. Recommended Architecture for Namespace Migration

Gunakan boundary layer.

```text
[Domain/Application]
  - OrderService
  - CaseWorkflowService
  - EnforcementStateMachine
  - DomainEventPublisher interface

[Messaging Adapter]
  - JmsCommandPublisher
  - JmsEventConsumer
  - JmsMessageMapper
  - JmsHeaderMapper

[Provider Runtime]
  - ConnectionFactory
  - Queue/Topic
  - Broker client library
```

Dengan ini, migrasi dari `javax.jms` ke `jakarta.jms` sebagian besar terjadi di adapter.

Contoh abstraction:

```java
public interface CommandBus {
    void send(String commandName, String aggregateId, byte[] payload, Map<String, String> metadata);
}
```

JMS implementation:

```java
public final class JmsCommandBus implements CommandBus {
    private final JMSContext context;
    private final Queue queue;

    public JmsCommandBus(JMSContext context, Queue queue) {
        this.context = context;
        this.queue = queue;
    }

    @Override
    public void send(String commandName,
                     String aggregateId,
                     byte[] payload,
                     Map<String, String> metadata) {
        BytesMessage message = context.createBytesMessage();
        try {
            message.writeBytes(payload);
            message.setStringProperty("commandName", commandName);
            message.setStringProperty("aggregateId", aggregateId);
            for (Map.Entry<String, String> entry : metadata.entrySet()) {
                message.setStringProperty(entry.getKey(), entry.getValue());
            }
            context.createProducer().send(queue, message);
        } catch (JMSException e) {
            throw new MessagingPublishException("Failed to publish command " + commandName, e);
        }
    }
}
```

Aplikasi di atas tidak perlu expose `jakarta.jms` keluar dari adapter.

---

## 17. JMS API vs Provider Feature: Garis Batas yang Harus Kamu Tahu

### 17.1 Biasanya Dijamin API/Spec

Secara umum JMS/Jakarta Messaging mendefinisikan:

- message model
- queue/topic concepts
- producer/consumer API
- session
- acknowledgement modes
- transacted session
- durable subscription
- message selectors
- headers/properties/body
- delivery mode
- priority
- expiration
- basic exception model

### 17.2 Sering Provider-Specific

Hal-hal berikut sering bergantung provider:

- redelivery delay policy
- DLQ naming/default
- maximum delivery attempts config
- broker clustering
- high availability
- paging
- journal tuning
- prefetch/window size
- failover URI syntax
- reconnect retry policy
- message grouping exact behavior
- scheduled message implementation detail
- management metrics/API
- advisory messages
- bridge/federation
- address model
- security realm integration

### 17.3 Practical Consequence

Jika kamu menulis desain:

```text
After 3 failures, message moves to DLQ with exponential backoff.
```

Jangan tulis seolah itu guaranteed by JMS secara universal.

Lebih tepat:

```text
Application depends on provider redelivery policy configured as:
- max delivery attempts = 3
- redelivery delay = 10s, 30s, 60s
- DLQ = DLQ.orders.incoming
This behavior must be verified against the selected provider.
```

Top engineer selalu membedakan:

```text
portable JMS semantics
vs
provider operational semantics
```

---

## 18. Classpath, Module Path, dan Split Package Reality

### 18.1 Java 8 Classpath World

Di Java 8, mayoritas aplikasi berjalan dengan flat classpath.

Masalah umum:

- dependency conflict tersembunyi
- dua versi API jar
- provider jar membawa transitive API lama
- app server classloader override

### 18.2 Java 9+ Module World

Dengan JPMS/module path, problem bisa lebih eksplisit.

Tapi banyak enterprise app masih berjalan di classpath walaupun menggunakan Java 17/21/25.

Rule praktis:

```text
Jangan menganggap Java version modern berarti dependency graph otomatis bersih.
```

### 18.3 Split Namespace Problem

`javax.jms` dan `jakarta.jms` bukan split package karena nama package berbeda, tetapi problemnya adalah semantic duplication.

Satu aplikasi bisa tidak sengaja membawa keduanya:

```text
javax.jms-api.jar
jakarta.jms-api.jar
```

Compile bisa sukses, tetapi framework/provider injection bisa gagal karena type mismatch.

Gunakan:

```bash
mvn dependency:tree
```

atau Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jms
./gradlew dependencyInsight --dependency jakarta.jms
```

Cari:

```text
javax.jms
jakarta.jms
geronimo-jms
jakarta.jms-api
jms-api
activemq-client
artemis-jms-client
artemis-jakarta-client
```

---

## 19. Spring Boot and Jakarta Boundary

Secara praktis:

```text
Spring Boot 2.x  -> mostly javax.*
Spring Boot 3.x  -> jakarta.*
```

Implikasi untuk JMS:

- Boot 2.x biasanya cocok dengan JMS `javax.jms`
- Boot 3.x membutuhkan Jakarta namespace untuk banyak integration layer
- provider client harus sesuai
- custom library lama bisa break

Kesalahan umum:

```text
Upgrade Spring Boot 2 -> 3
Code import changed to jakarta.jms
But ActiveMQ/IBM MQ dependency remains old javax variant
```

Akibat:

- bean `ConnectionFactory` tidak terdeteksi
- listener container gagal start
- class cast error
- no suitable converter/config

Rule:

```text
Framework major upgrade harus disertai provider client compatibility review.
```

---

## 20. Jakarta EE Server Boundary

Dalam Jakarta EE application server, kamu harus tahu server tersebut menyediakan versi apa.

Pertanyaan wajib:

1. Server support Jakarta EE versi berapa?
2. Messaging version berapa?
3. Namespace `javax.jms` atau `jakarta.jms`?
4. Broker embedded atau external?
5. Resource adapter apa yang dipakai?
6. JTA transaction manager compatible?
7. MDB activation support bagaimana?
8. Connection factory didefinisikan via JNDI, annotation, atau config server?
9. Apakah API jar boleh dipackage di WAR/EAR?
10. Apakah provider jar harus server-level atau application-level?

Anti-pattern:

```text
Memasukkan sembarang jms-api.jar ke WEB-INF/lib tanpa memahami classloader server.
```

Di app server, ini bisa menyebabkan type identity problem:

```text
Application classloader has jakarta.jms.Message
Server classloader has jakarta.jms.Message
They look same but can be loaded by different classloaders
```

Dalam Java, class identity adalah:

```text
fully qualified class name + defining classloader
```

Jadi class dengan nama sama bisa tetap tidak kompatibel jika classloader berbeda.

---

## 21. Provider Differences: Kenapa “Portable” Tidak Berarti “Identical”

JMS ingin membuat aplikasi portable di level API. Tetapi provider tetap punya behavior berbeda.

### 21.1 ActiveMQ Artemis

Cenderung modern, punya address model anycast/multicast, mendukung JMS/Jakarta Messaging mapping, clustering, paging, journal, high throughput.

Konsep internal Artemis tidak selalu identik dengan istilah JMS.

Mapping kasar:

```text
JMS Queue  -> anycast address/queue model
JMS Topic  -> multicast address/subscription model
```

### 21.2 IBM MQ

Sangat enterprise, banyak dipakai di banking/government/large enterprises.

Kekuatan:

- mature queue manager
- strong operational tooling
- enterprise security
- reliable delivery
- legacy integration

Perlu hati-hati:

- proprietary configuration
- administered objects
- transaction/XA setup
- channel/security policy

### 21.3 ActiveMQ Classic

Banyak legacy deployment.

Perlu hati-hati:

- maintenance posture dibanding Artemis
- broker stability under certain patterns
- advisory/topic internals
- KahaDB tuning
- migration path ke Artemis

### 21.4 RabbitMQ JMS Client

RabbitMQ native model adalah AMQP, bukan JMS. JMS client layer adalah mapping.

Perlu hati-hati:

- semantic mismatch
- queue/topic mapping
- transaction/durable subscription behavior
- selector support
- provider-specific limitations

### 21.5 Solace/WebLogic/Open Liberty/WildFly

Biasanya kuat di enterprise integration, tetapi masing-masing punya admin model sendiri.

Rule:

```text
JMS standardizes application programming model,
not the entire broker operational model.
```

---

## 22. The Top 1% Compatibility Checklist

Sebelum memilih atau upgrade JMS stack, cek ini:

### 22.1 API Layer

- Apakah aplikasi menggunakan `javax.jms` atau `jakarta.jms`?
- Apakah semua imports konsisten?
- Apakah internal library expose JMS type?
- Apakah framework integration layer cocok dengan namespace?

### 22.2 Dependency Layer

- Apakah ada dua API jar sekaligus?
- Apakah provider client membawa transitive API lama?
- Apakah BOM/dependency management sudah mengunci versi?
- Apakah dependency tree bersih dari duplicate JMS API?

### 22.3 Runtime Layer

- Apakah runtime Java didukung provider?
- Apakah app server mendukung versi API tersebut?
- Apakah broker version compatible dengan client version?
- Apakah transaction manager compatible?

### 22.4 Operational Layer

- Bagaimana failover behavior?
- Bagaimana redelivery policy?
- Bagaimana DLQ policy?
- Bagaimana reconnect config?
- Bagaimana TLS/credential config?
- Bagaimana metrics diekspos?

### 22.5 Test Layer

- Ada integration test dengan broker asli?
- Ada test duplicate delivery?
- Ada test redelivery?
- Ada test broker restart?
- Ada test consumer crash?
- Ada test DB commit success lalu ack failure?
- Ada test schema mismatch?

---

## 23. Efficient Learning Boundary: Apa yang Tidak Kita Ulang di Seri Ini

Karena kamu sudah menyelesaikan banyak seri Java, bagian ini tidak akan mengulang:

- dasar Java syntax
- dasar OOP
- dasar collection/concurrency
- dasar JDBC/JPA
- dasar Spring Boot
- dasar Jakarta EE
- dasar XML/JSON serialization
- dasar observability
- dasar deployment
- dasar testing

Yang akan kita lakukan adalah memakai semua itu sebagai fondasi untuk membahas JMS secara jauh lebih spesifik.

Contoh:

Kita tidak akan mengulang “apa itu transaction”.  
Tetapi kita akan membahas:

```text
Apa yang terjadi jika DB transaction commit sukses,
tapi JMS acknowledgement gagal karena consumer crash?
```

Kita tidak akan mengulang “apa itu thread pool”.  
Tetapi kita akan membahas:

```text
Bagaimana listener concurrency + prefetch + DB pool size
menciptakan inflight message explosion?
```

Kita tidak akan mengulang “apa itu logging”.  
Tetapi kita akan membahas:

```text
Correlation ID mana yang harus disimpan agar message replay
bisa direkonstruksi secara forensic?
```

---

## 24. Decision Framework: Kapan Memilih `javax.jms` vs `jakarta.jms`

### 24.1 Gunakan `javax.jms` Jika

- aplikasi masih Java 8/11 legacy
- app server masih Java EE/Jakarta EE 8
- Spring Boot masih 2.x
- provider client belum punya Jakarta variant
- migration cost terlalu besar untuk saat ini
- aplikasi berada di maintenance mode

Tetapi tetap desain boundary agar migrasi bisa dilakukan nanti.

### 24.2 Gunakan `jakarta.jms` Jika

- project baru
- Java 17/21/25
- Spring Boot 3+
- Jakarta EE 10/11
- provider mendukung Jakarta Messaging 3.x
- kamu ingin lifecycle modern
- security/runtime baseline modern diperlukan

### 24.3 Jangan Campur Kecuali Ada Alasan Kuat

Campur `javax.jms` dan `jakarta.jms` biasanya hanya masuk akal jika:

- ada legacy integration adapter
- ada bridge process terpisah
- ada migration phase yang dikontrol
- boundary-nya process-level, bukan class-level

Lebih aman:

```text
legacy service javax.jms  <-> broker <-> modern service jakarta.jms
```

Daripada:

```text
same JVM contains uncontrolled javax.jms + jakarta.jms mix
```

---

## 25. Migration Strategy: Dari Legacy JMS ke Jakarta Messaging

### Step 1 — Inventory

Cari semua penggunaan:

```bash
grep -R "javax.jms" src/
grep -R "jakarta.jms" src/
```

Cari dependency:

```bash
mvn dependency:tree | grep -i jms
```

atau:

```bash
./gradlew dependencyInsight --dependency jms
./gradlew dependencyInsight --dependency jakarta.jms
```

Inventory:

- source imports
- framework annotations
- XML config
- JNDI names
- app server resources
- provider client jars
- test dependencies
- embedded broker usage
- custom wrapper library

---

### Step 2 — Determine Runtime Target

Tentukan target:

```text
Option A: stay javax.jms for now
Option B: migrate fully to jakarta.jms
Option C: split services/process boundary
```

Jangan mulai dengan search-and-replace sebelum target runtime jelas.

---

### Step 3 — Upgrade Provider Client

Pastikan provider client memang support namespace target.

Checklist:

- artifact name benar?
- version compatible dengan broker?
- Java version supported?
- transaction manager supported?
- TLS config compatible?
- failover URI syntax sama atau berubah?

---

### Step 4 — Update Framework Integration

Untuk Spring:

- update `JmsTemplate`
- update listener container
- update connection factory bean
- update message converter
- update transaction manager

Untuk Jakarta EE:

- update server version
- update resource adapter
- update MDB imports
- update deployment descriptors
- update JNDI resources

---

### Step 5 — Run Semantics Test, Bukan Hanya Compile Test

Test wajib:

1. send message
2. receive message
3. persistent message survives broker restart
4. consumer crash triggers redelivery
5. poison message masuk DLQ
6. duplicate handling aman
7. transaction rollback behavior benar
8. selector masih bekerja
9. durable subscription masih menerima backlog
10. failover/reconnect behavior sesuai harapan

---

## 26. Common Failure Cases Saat Upgrade

### Case 1 — Compile Sukses, Runtime `NoClassDefFoundError`

Penyebab:

- API ada saat compile, tidak ada saat runtime
- app server classloader tidak menyediakan API yang sama
- shaded jar menghilangkan class

Solusi:

- review packaging
- gunakan provided scope jika server menyediakan API
- gunakan runtime dependency jika standalone

---

### Case 2 — `ClassCastException` antara `javax` dan `jakarta`

Penyebab:

- framework expecting `jakarta.jms.ConnectionFactory`
- provider returns `javax.jms.ConnectionFactory`

Solusi:

- ganti provider client ke Jakarta-compatible version
- jangan cast manual
- isolate adapter/process

---

### Case 3 — Listener Tidak Start Setelah Upgrade

Penyebab:

- connection factory bean type mismatch
- destination resolver salah
- transaction manager mismatch
- broker credentials berubah
- JNDI name berubah

Solusi:

- start from minimal send/receive test
- verify bean type
- verify provider logs
- verify broker connection logs

---

### Case 4 — Message Terkirim Tapi Tidak Dikonsumsi

Penyebab:

- queue/topic name mapping berubah
- durable subscription identity berubah
- selector property type berubah
- wrong virtual host/address space
- consumer connected to different broker/cluster

Solusi:

- inspect broker management console
- verify destination exists
- verify consumer count
- verify selector
- verify message depth

---

### Case 5 — Redelivery/DLQ Behavior Berubah

Penyebab:

- provider upgrade changed defaults
- redelivery policy not migrated
- DLQ address not configured
- transaction boundary changed

Solusi:

- explicitly configure redelivery
- explicitly configure DLQ
- integration test rollback path
- verify delivery count property/header

---

## 27. API Evolution by Code Style

### 27.1 JMS 1.1 Style

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.MessageProducer;
import javax.jms.Queue;
import javax.jms.Session;
import javax.jms.TextMessage;

public final class LegacyJmsSender {
    private final ConnectionFactory connectionFactory;

    public LegacyJmsSender(ConnectionFactory connectionFactory) {
        this.connectionFactory = connectionFactory;
    }

    public void send(String payload) throws Exception {
        Connection connection = null;
        Session session = null;
        try {
            connection = connectionFactory.createConnection();
            session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);

            Queue queue = session.createQueue("orders.incoming");
            MessageProducer producer = session.createProducer(queue);

            TextMessage message = session.createTextMessage(payload);
            producer.send(message);
        } finally {
            if (session != null) {
                session.close();
            }
            if (connection != null) {
                connection.close();
            }
        }
    }
}
```

### 27.2 JMS 2.0 / Jakarta Messaging Style

`javax.jms` variant untuk JMS 2.0:

```java
import javax.jms.ConnectionFactory;
import javax.jms.JMSContext;
import javax.jms.Queue;

public final class ModernJavaxJmsSender {
    private final ConnectionFactory connectionFactory;

    public ModernJavaxJmsSender(ConnectionFactory connectionFactory) {
        this.connectionFactory = connectionFactory;
    }

    public void send(String payload) {
        try (JMSContext context = connectionFactory.createContext()) {
            Queue queue = context.createQueue("orders.incoming");
            context.createProducer().send(queue, payload);
        }
    }
}
```

`jakarta.jms` variant untuk Jakarta Messaging 3.x:

```java
import jakarta.jms.ConnectionFactory;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;

public final class JakartaJmsSender {
    private final ConnectionFactory connectionFactory;

    public JakartaJmsSender(ConnectionFactory connectionFactory) {
        this.connectionFactory = connectionFactory;
    }

    public void send(String payload) {
        try (JMSContext context = connectionFactory.createContext()) {
            Queue queue = context.createQueue("orders.incoming");
            context.createProducer().send(queue, payload);
        }
    }
}
```

Perhatikan: kode hampir sama, tetapi import berbeda. Bagi Java type system, itu dunia berbeda.

---

## 28. Enterprise Architecture Implication

Dalam sistem enterprise, JMS biasanya bukan komponen isolated. Ia berhubungan dengan:

```text
API request
  -> database transaction
  -> outbox record
  -> JMS publish
  -> consumer
  -> workflow state transition
  -> audit trail
  -> notification
  -> reporting projection
```

Migrasi JMS/Jakarta bukan hanya ubah import. Ia bisa memengaruhi:

- transaction manager
- retry behavior
- message format
- operational runbook
- monitoring dashboard
- incident response
- replay procedure
- schema compatibility
- DLQ tooling
- security policy

Untuk sistem regulated/case management, setiap perubahan messaging harus dilihat sebagai perubahan pada **enforcement lifecycle reliability**.

Pertanyaan desain:

```text
Jika message hilang, business impact apa?
Jika message duplicate, state transition aman tidak?
Jika message terlambat, SLA impact apa?
Jika DLQ penuh, siapa triage?
Jika replay dilakukan, audit trail menunjukkan apa?
```

---

## 29. Practical Versioning Strategy for Long-Lived Systems

Untuk sistem enterprise yang hidup 5–15 tahun, jangan hanya memilih versi yang jalan hari ini.

Gunakan strategi:

### 29.1 Stabilize Current Runtime

Jika masih Java 8/`javax.jms`, jangan migrasi sembarangan tanpa test.

Pastikan:

- redelivery jelas
- DLQ jelas
- monitoring jelas
- dependency terkunci

### 29.2 Isolate Messaging Boundary

Buat adapter layer agar domain tidak tahu JMS type.

### 29.3 Introduce Contract Tests

Sebelum upgrade, punya baseline behavior.

### 29.4 Upgrade by Runtime Slice

Lebih aman migrasi service per service daripada big bang seluruh enterprise.

### 29.5 Avoid Dual Namespace in Same Module

Kalau harus bridge, gunakan process boundary atau module boundary yang sangat eksplisit.

---

## 30. Red Flags dalam Desain JMS Legacy

Waspadai tanda-tanda berikut:

1. Domain service menerima `javax.jms.Message` langsung.
2. Business logic membaca property JMS di banyak tempat.
3. Tidak ada abstraction untuk publish/consume.
4. Tidak ada DLQ policy tertulis.
5. Tidak ada redelivery test.
6. Tidak ada idempotency key.
7. Durable subscription name dibuat random per deployment.
8. Queue name hardcoded tersebar di banyak module.
9. Tidak ada correlation id standard.
10. Aplikasi bergantung pada provider extension tapi dokumentasi menyebut “standard JMS”.
11. Dependency tree membawa `javax.jms-api` dan `jakarta.jms-api` bersamaan.
12. App server menyediakan JMS API tapi aplikasi juga membawa API jar sendiri.
13. Upgrade broker dilakukan tanpa consumer failure test.
14. Monitoring hanya melihat “app up”, bukan queue depth/redelivery/DLQ.
15. Tidak ada replay governance.

---

## 31. Better Mental Model for Top Engineers

Engineer biasa melihat JMS sebagai:

```text
send message -> receive message
```

Engineer kuat melihat JMS sebagai:

```text
A distributed, failure-prone, state-transition delivery mechanism
where API, provider, broker, transaction boundary, and business idempotency
must align to preserve system correctness.
```

Top engineer bertanya:

1. Apa semantic message ini? Command, event, document, reply, signal?
2. Siapa owner destination?
3. Apa idempotency boundary?
4. Apa ordering requirement?
5. Apa transaction boundary?
6. Apa yang terjadi jika consumer crash di setiap line kode?
7. Apa yang terjadi jika broker restart?
8. Apa yang terjadi jika DB commit sukses tapi ack gagal?
9. Apa yang terjadi jika message dikirim dua kali?
10. Apa yang terjadi jika message baru diproses 3 hari kemudian?
11. Apakah DLQ bisa direplay aman?
12. Apakah observability cukup untuk forensic investigation?
13. Apakah behavior ini dijamin JMS spec atau provider-specific?
14. Apakah migration ke Jakarta namespace akan merusak binary compatibility?

---

## 32. Summary Mental Model

Ringkasnya:

```text
JMS 1.1:
  unified classic API for queue/topic usage

JMS 2.0:
  simplified API + modern features

Jakarta Messaging 2.0:
  JMS 2.0 re-released under Jakarta, still javax.jms

Jakarta Messaging 3.0:
  namespace break to jakarta.jms

Jakarta Messaging 3.1:
  modern Jakarta EE 10 baseline, still jakarta.jms
```

Dan prinsip utama:

```text
API compatibility is not runtime compatibility.
Namespace compatibility is not provider compatibility.
Provider compatibility is not operational equivalence.
Operational equivalence is not business correctness.
```

---

## 33. Checklist untuk Part Ini

Kamu sudah memahami Part 1 jika bisa menjelaskan:

- [ ] JMS adalah API, bukan broker.
- [ ] Provider adalah implementasi API dan client runtime.
- [ ] Broker adalah runtime penyimpanan/routing message.
- [ ] JMS 1.1 menyatukan queue/topic API model.
- [ ] JMS 2.0 memperkenalkan simplified API.
- [ ] Jakarta Messaging 2.0 masih `javax.jms`.
- [ ] Jakarta Messaging 3.x memakai `jakarta.jms`.
- [ ] `javax.jms.Message` dan `jakarta.jms.Message` adalah type berbeda.
- [ ] Search-and-replace bukan migration strategy cukup.
- [ ] Spring Boot 2 dan 3 berada di boundary namespace berbeda.
- [ ] App server classloader bisa menyebabkan type conflict.
- [ ] JMS portable API tidak berarti provider behavior identical.
- [ ] Version choice harus mempertimbangkan Java runtime, framework, app server, broker, provider client, transaction manager, dan operational runbook.

---

## 34. Latihan Pemahaman

### Latihan 1 — Dependency Diagnosis

Kamu menemukan dependency tree:

```text
jakarta.jms:jakarta.jms-api:3.1.0
javax.jms:javax.jms-api:2.0.1
org.apache.activemq:activemq-client:5.x
```

Pertanyaan:

1. Apa risiko utamanya?
2. Framework modern kemungkinan expect namespace apa?
3. Provider client ini kemungkinan expose namespace apa?
4. Apa test minimal untuk membuktikan runtime compatible?

Jawaban yang diharapkan:

- risiko type mismatch `javax` vs `jakarta`
- Spring Boot 3/Jakarta EE 10 expect `jakarta.jms`
- ActiveMQ Classic 5.x biasanya legacy `javax.jms`
- test minimal: create connection factory, send, receive, listener start, transaction rollback, redelivery

---

### Latihan 2 — Migration Design

Aplikasi Java 8 menggunakan `javax.jms` langsung di service layer:

```java
public void process(javax.jms.Message message) { ... }
```

Target 12 bulan lagi Java 21 + Spring Boot 3.

Tentukan migration strategy.

Expected direction:

```text
1. isolate JMS type into adapter layer
2. introduce domain command/event DTO
3. add contract tests for current behavior
4. clean dependency tree
5. upgrade provider client with Jakarta support
6. migrate framework
7. verify runtime semantics with real broker
```

---

### Latihan 3 — Spec vs Provider

Requirement:

```text
If payment message fails 5 times, retry with exponential backoff,
then move to DLQ named DLQ.payment.capture.
```

Pertanyaan:

- Bagian mana JMS standard?
- Bagian mana provider-specific?

Expected direction:

```text
JMS standard:
  message, queue, consumer, transaction/ack/redelivery concept

Provider-specific:
  exact max delivery attempts config,
  exponential backoff config,
  DLQ routing/naming,
  delivery count property name/detail,
  management/replay tooling
```

---

## 35. Part Berikutnya

Part berikutnya:

# Part 2 — Messaging Domain Model: Message, Destination, Producer, Consumer, Session, Connection, Context

Kita akan membedah object model JMS/Jakarta Messaging secara rinci:

- `ConnectionFactory`
- `Connection`
- `Session`
- `JMSContext`
- `Destination`
- `Queue`
- `Topic`
- `MessageProducer`
- `MessageConsumer`
- `JMSProducer`
- `JMSConsumer`

Fokusnya bukan hafalan API, tetapi:

```text
ownership
lifecycle
thread-safety
resource cost
transaction boundary
failure boundary
```

---

## 36. Status Seri

```text
Total rencana: 35 part
Selesai: Part 0, Part 1
Berikutnya: Part 2
Status: belum selesai
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-000.md">⬅️ Part 0 — Orientation: JMS sebagai Sistem Koordinasi Asinkron, Bukan Sekadar Queue API</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-002.md">Part 2 — Messaging Domain Model: Message, Destination, Producer, Consumer, Session, Connection, Context ➡️</a>
</div>

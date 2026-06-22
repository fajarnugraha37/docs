# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering

## Part 2 — Messaging Domain Model: Message, Destination, Producer, Consumer, Session, Connection, Context

> Seri: Java JMS / Jakarta Messaging Advanced  
> Target: Java 8 sampai Java 25  
> Fokus: memahami model domain JMS/Jakarta Messaging sebagai **runtime coordination model**, bukan sekadar kumpulan class API.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 0 kita membangun mental model bahwa JMS/Jakarta Messaging bukan sekadar queue API, melainkan kontrak koordinasi asinkron antara aplikasi Java dan message-oriented middleware.

Pada Part 1 kita membahas evolusi JMS 1.1, JMS 2.0, dan Jakarta Messaging 3.x, termasuk pergeseran namespace dari `javax.jms` ke `jakarta.jms`.

Part 2 ini mulai masuk ke **domain model inti**.

Tujuan utama bagian ini:

1. memahami objek-objek inti JMS;
2. memahami hubungan antar objek;
3. memahami resource ownership;
4. memahami lifecycle;
5. memahami batas thread-safety;
6. memahami di mana reliability, transaction, acknowledgement, dan delivery behavior mulai terbentuk;
7. membangun fondasi sebelum masuk queue, topic, acknowledgement, transaction, redelivery, dan production tuning.

Kesalahan umum engineer ketika belajar JMS adalah langsung menulis kode:

```java
Connection connection = factory.createConnection();
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
MessageProducer producer = session.createProducer(queue);
producer.send(session.createTextMessage("hello"));
```

Kode ini terlihat sederhana, tetapi di baliknya ada banyak keputusan runtime:

- connection fisik ke broker dibuat atau dipinjam;
- session membuat boundary single-threaded;
- producer terikat ke session;
- message dibuat di dalam session;
- destination dipetakan ke objek broker;
- send masuk ke protocol client;
- broker menerima frame;
- broker menyimpan atau mendispatch message;
- acknowledgement behavior ditentukan oleh mode session;
- failure boundary ditentukan oleh kapan send/receive/ack/commit terjadi.

Part ini akan membedah hal tersebut satu per satu.

---

## 1. Sumber Resmi dan Terminologi

Jakarta Messaging mendefinisikan cara umum bagi program Java untuk membuat, mengirim, menerima, dan membaca message dari enterprise messaging system. Dalam dokumentasi resmi Jakarta Messaging 3.1, API ini dirancang untuk loosely coupled, reliable, asynchronous communication services.

Istilah modernnya adalah **Jakarta Messaging**, tetapi dalam praktik industri istilah **JMS** masih sangat dominan.

Di seri ini:

- **JMS** dipakai sebagai istilah historis dan praktis.
- **Jakarta Messaging** dipakai ketika membahas namespace `jakarta.jms` dan spesifikasi modern.
- **Provider** berarti implementasi JMS/Jakarta Messaging, misalnya ActiveMQ Artemis, IBM MQ, WebLogic JMS, Open Liberty resource adapter, dan lain-lain.
- **Broker** berarti runtime message server yang menyimpan, merutekan, dan mendispatch message.
- **Client** berarti aplikasi Java yang memakai API JMS/Jakarta Messaging.

Satu hal penting: JMS adalah **standard API**, bukan broker.

Artinya:

```text
JMS / Jakarta Messaging = contract/API
Broker/provider          = implementation/runtime behavior
```

Ini mirip JDBC:

```text
JDBC API       = java.sql.* contract
Database       = PostgreSQL / Oracle / MySQL / SQL Server
JDBC Driver    = provider implementation
```

Untuk messaging:

```text
JMS API        = javax.jms atau jakarta.jms
Broker         = ActiveMQ Artemis / IBM MQ / etc.
JMS Client     = provider-specific client library
```

Implikasinya:

- API terlihat sama;
- behavior detail bisa berbeda;
- konfigurasi broker sangat menentukan;
- tuning client sangat provider-specific;
- portability hanya aman pada area standard;
- production reliability tidak otomatis dijamin hanya karena memakai JMS.

---

## 2. Peta Besar Domain Model JMS

Secara sederhana, model JMS terdiri dari beberapa peran:

```text
Application Code
    |
    | uses
    v
ConnectionFactory
    |
    | creates
    v
Connection / JMSContext
    |
    | creates
    v
Session
    |
    | creates
    +-------------------+
    |                   |
    v                   v
MessageProducer     MessageConsumer
    |                   |
    | sends             | receives
    v                   v
Destination <------ Message ------> Destination
    |
    v
Broker Runtime
```

Dalam API klasik JMS 1.1:

```text
ConnectionFactory
Connection
Session
Destination
Queue / Topic
MessageProducer
MessageConsumer
Message
```

Dalam simplified API JMS 2.0 / Jakarta Messaging:

```text
ConnectionFactory
JMSContext
Destination
JMSProducer
JMSConsumer
Message
```

`JMSContext` secara konseptual menggabungkan `Connection` dan `Session`.

Namun, walaupun simplified API menyembunyikan banyak boilerplate, konsep connection dan session tetap penting. Dokumentasi API Jakarta Messaging menjelaskan bahwa `JMSContext` dapat dipahami sebagai representasi dari connection dan session: connection adalah physical link ke messaging server, sedangkan session adalah single-threaded context untuk mengirim dan menerima message.

Mental model:

```text
Connection = pipa besar ke broker
Session    = jalur kerja single-threaded di atas connection
Producer   = alat kirim di dalam session
Consumer   = alat terima di dalam session
Message    = unit data + metadata
Destination= alamat logis
Broker     = runtime yang menyimpan/merutekan/mendispatch
```

---

## 3. Domain Object Utama

### 3.1 `ConnectionFactory`

`ConnectionFactory` adalah factory untuk membuat koneksi ke provider JMS.

Secara konseptual:

```text
ConnectionFactory = configured entry point ke broker/provider
```

Biasanya berisi konfigurasi:

- broker URL;
- protocol;
- username/password;
- TLS setting;
- reconnect policy;
- client id;
- connection pooling behavior;
- provider-specific tuning;
- JNDI binding;
- resource adapter configuration;
- managed connection factory dalam application server.

Contoh klasik:

```java
ConnectionFactory factory = ...;
Connection connection = factory.createConnection();
```

Contoh simplified API:

```java
ConnectionFactory factory = ...;
try (JMSContext context = factory.createContext()) {
    // use context
}
```

Dalam enterprise runtime, `ConnectionFactory` sering tidak dibuat manual, tetapi diinjeksi:

```java
@Resource(lookup = "jms/MyConnectionFactory")
private ConnectionFactory connectionFactory;
```

Atau di Jakarta CDI style tergantung runtime.

#### Mental Model

`ConnectionFactory` bukan koneksi aktif. Ia adalah **template konfigurasi** untuk membuat koneksi/context.

Analogi JDBC:

```text
DataSource          ~ ConnectionFactory
Database Connection ~ JMS Connection
```

Tapi hati-hati: JMS `Connection` dan JDBC `Connection` tidak sama lifecycle-nya.

#### Production Concern

`ConnectionFactory` adalah tempat banyak policy tersembunyi:

- apakah connection auto-reconnect?
- apakah session/producers pooled?
- apakah credential rotate otomatis?
- apakah connection dibuat per request?
- apakah client id unik?
- apakah failover URI benar?
- apakah TLS truststore/keystore valid?
- apakah broker discovery aman?

Banyak masalah JMS bukan berasal dari kode listener, tetapi dari konfigurasi `ConnectionFactory`.

---

### 3.2 `Connection`

`Connection` adalah koneksi aktif dari aplikasi Java ke provider/broker.

Secara konseptual:

```text
Connection = physical or logical link ke broker
```

Dalam implementasi broker, satu JMS connection mungkin memetakan ke:

- satu TCP connection;
- satu AMQP/OpenWire/Core protocol connection;
- satu multiplexed channel;
- satu pooled physical connection;
- satu managed connection dalam application server.

Contoh klasik:

```java
Connection connection = factory.createConnection();
connection.start();
```

Poin penting: dalam classic API, consumer tidak akan menerima message sampai connection di-`start()`.

Producer bisa mengirim sebelum `start()`, tetapi receiving asynchronous membutuhkan connection started.

#### Tanggung Jawab `Connection`

`Connection` biasanya bertanggung jawab atas:

- link ke provider;
- authentication;
- client identity;
- exception listener;
- connection-level lifecycle;
- membuat session;
- start/stop message delivery;
- close resource.

```java
connection.setExceptionListener(exception -> {
    // handle connection failure
});
```

#### `connection.start()` vs `connection.stop()`

`start()` mengaktifkan delivery message ke consumer.

`stop()` menghentikan delivery sementara tanpa menutup connection.

Mental model:

```text
createConnection() = buka link
createSession()    = buat unit kerja
createConsumer()   = subscribe/attach consumer
start()            = izinkan broker deliver message ke consumer
stop()             = pause delivery
close()            = release resource
```

#### Kesalahan Umum

Kesalahan 1: lupa `connection.start()`.

Gejala:

- producer berhasil send;
- queue depth bertambah;
- consumer tidak pernah receive;
- tidak ada exception jelas.

Kesalahan 2: membuat connection per message.

```java
public void send(Order order) {
    Connection c = factory.createConnection();
    Session s = c.createSession(false, Session.AUTO_ACKNOWLEDGE);
    MessageProducer p = s.createProducer(queue);
    p.send(...);
    c.close();
}
```

Ini sangat mahal karena connection sering melibatkan handshake, authentication, socket, broker-side resource, dan allocation.

Lebih baik:

- pakai pooling;
- pakai long-lived connection;
- pakai framework container;
- gunakan `JMSContext` dengan managed lifecycle bila runtime mendukung.

---

### 3.3 `Session`

`Session` adalah salah satu objek paling penting dalam JMS.

Dokumentasi Jakarta Messaging menyebut `Session` sebagai **single-threaded context** untuk memproduksi dan mengonsumsi message. Ini bukan detail kecil. Ini adalah invariant utama.

```text
Session = single-threaded unit of work
```

Session digunakan untuk:

- membuat producer;
- membuat consumer;
- membuat message;
- membuat queue/topic object;
- mengelola acknowledgement;
- mengelola local transaction;
- menyerialisasi callback listener;
- menjadi boundary commit/rollback bila transacted.

Contoh:

```java
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
MessageProducer producer = session.createProducer(queue);
MessageConsumer consumer = session.createConsumer(queue);
TextMessage message = session.createTextMessage("hello");
```

#### Mengapa Session Penting?

Karena banyak semantics JMS melekat pada session, bukan pada producer/consumer secara terpisah.

Contoh:

- acknowledgement mode ada di session;
- transaction mode ada di session;
- message listener delivery serial terjadi per session;
- commit/rollback berlaku untuk work dalam session;
- producer dan consumer yang dibuat dari session mengikuti boundary session.

#### Session Bukan Thread-Safe

Ini salah satu aturan paling penting:

```text
Jangan share satu Session secara concurrent ke banyak thread.
```

Buruk:

```java
class BadPublisher {
    private final Session session;
    private final MessageProducer producer;

    public void publish(String payload) {
        // dipanggil banyak thread secara paralel
        TextMessage msg = session.createTextMessage(payload);
        producer.send(msg);
    }
}
```

Masalah:

- `Session` single-threaded;
- `MessageProducer` juga terkait ke session;
- concurrent send bisa menyebabkan race, protocol confusion, exception, atau behavior provider-specific;
- terlihat aman di DEV, gagal di PROD saat load tinggi.

Lebih aman:

```text
1 thread -> 1 session
atau
use pooled session per operation
atau
use container/framework yang mengelola session concurrency
```

#### Session sebagai Transaction Boundary

Kalau session transacted:

```java
Session session = connection.createSession(true, Session.SESSION_TRANSACTED);
```

Maka:

- send belum final sampai `commit()`;
- receive belum acknowledged sampai `commit()`;
- rollback menyebabkan received message redelivered;
- rollback menyebabkan sent message tidak dikirim final.

```java
try {
    Message msg = consumer.receive();
    process(msg);
    session.commit();
} catch (Exception e) {
    session.rollback();
}
```

Kita akan bahas transaksi mendalam di Part 10. Untuk sekarang cukup pahami:

```text
Session = boundary acknowledgement + transaction + serial execution
```

#### Session dan Listener Serialization

Jika satu session punya asynchronous consumer dengan `MessageListener`, listener invocation diserialisasi oleh session.

Artinya, satu session tidak menjalankan dua `onMessage()` secara paralel.

Kalau ingin parallelism:

```text
buat beberapa session + consumer
atau gunakan listener container concurrency
atau gunakan MDB pool/container-managed concurrency
```

Jangan berharap satu `MessageConsumer` pada satu session memproses banyak message paralel.

---

### 3.4 `JMSContext`

`JMSContext` diperkenalkan dalam JMS 2.0 sebagai simplified API.

Ia menggabungkan konsep:

```text
JMSContext ≈ Connection + Session
```

Contoh modern:

```java
try (JMSContext context = connectionFactory.createContext()) {
    Queue queue = context.createQueue("orders");
    context.createProducer().send(queue, "hello");
}
```

Dibanding classic API:

```java
Connection connection = null;
Session session = null;
try {
    connection = factory.createConnection();
    session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
    Queue queue = session.createQueue("orders");
    MessageProducer producer = session.createProducer(queue);
    producer.send(session.createTextMessage("hello"));
} finally {
    if (session != null) session.close();
    if (connection != null) connection.close();
}
```

`JMSContext` membuat kode lebih ringkas, tetapi tidak menghapus konsep session.

#### Context Modes

Contoh:

```java
try (JMSContext context = factory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
    // ...
}
```

Mode umum:

- `JMSContext.AUTO_ACKNOWLEDGE`
- `JMSContext.CLIENT_ACKNOWLEDGE`
- `JMSContext.DUPS_OK_ACKNOWLEDGE`
- `JMSContext.SESSION_TRANSACTED`

Dalam managed environment, ada aturan tambahan terkait injected context dan transaction context. Detailnya akan dibahas di part Jakarta EE integration.

#### Kapan Pakai `JMSContext`?

Untuk aplikasi modern:

- gunakan `JMSContext` bila memakai JMS 2.0+ atau Jakarta Messaging;
- gunakan classic API jika harus support JMS 1.1 legacy;
- gunakan framework abstraction jika Spring/Jakarta EE container mengelola lifecycle;
- jangan campur classic API dan simplified API tanpa alasan jelas.

#### Trap

`JMSContext` terlihat seperti objek kecil yang bisa dishare bebas.

Jangan salah.

Karena ia merepresentasikan session, perlakukan sebagai:

```text
not freely shared across concurrent threads
```

Bila aplikasi multi-threaded:

- buat context per thread/unit kerja;
- gunakan pool;
- gunakan container listener;
- gunakan framework yang memang thread-safe di facade level.

---

### 3.5 `Destination`

`Destination` adalah alamat logis message.

Ada dua subtipe utama:

```text
Queue
Topic
```

```java
Queue queue = session.createQueue("orders.queue");
Topic topic = session.createTopic("orders.events");
```

Atau simplified API:

```java
Queue queue = context.createQueue("orders.queue");
Topic topic = context.createTopic("orders.events");
```

#### Destination Bukan Message Store Itu Sendiri

`Destination` di kode Java adalah representasi alamat.

Broker-side object bisa berupa:

- queue fisik;
- topic/address;
- routing binding;
- virtual destination;
- durable subscription queue;
- provider-specific address.

Mental model:

```text
Destination object di Java = handle/alamat
Broker destination        = runtime storage/routing entity
```

#### Queue vs Topic Singkat

Queue:

```text
message dikirim ke queue
satu message diproses oleh satu consumer
cocok untuk command/work item
```

Topic:

```text
message dipublish ke topic
banyak subscriber bisa menerima copy
cocok untuk event/broadcast
```

Detail queue dan topic akan dibahas di Part 3 dan Part 4.

#### Static vs Dynamic Destination

Ada dua pendekatan:

1. destination didefinisikan admin/JNDI;
2. destination dibuat secara dynamic dari aplikasi.

Admin-defined:

```java
@Resource(lookup = "jms/OrderQueue")
private Queue orderQueue;
```

Dynamic:

```java
Queue queue = context.createQueue("OrderQueue");
```

Untuk production enterprise, admin-defined sering lebih aman karena:

- destination bisa dikonfigurasi security-nya;
- DLQ policy bisa ditentukan;
- max size bisa diatur;
- routing bisa dikontrol;
- monitoring lebih jelas;
- tidak ada typo yang diam-diam membuat destination baru.

Dynamic destination berguna untuk:

- test;
- temporary reply queue;
- tenant-specific routing bila memang didesain;
- lightweight standalone app.

#### Naming Contract

Nama destination adalah contract.

Contoh buruk:

```text
queue1
processQueue
newOrder
```

Contoh lebih baik:

```text
aceas.case.command.assign.v1
aceas.case.event.status-changed.v1
aceas.notification.email.command.send.v1
aceas.integration.cpds.event.profile-updated.v1
```

Namun hati-hati: tidak semua broker/provider menyukai nama panjang dengan karakter bebas. Periksa aturan provider.

---

### 3.6 `MessageProducer` dan `JMSProducer`

Producer adalah objek untuk mengirim message ke destination.

Classic API:

```java
MessageProducer producer = session.createProducer(queue);
producer.send(message);
```

Simplified API:

```java
JMSProducer producer = context.createProducer();
producer.send(queue, "hello");
```

#### Producer Terikat ke Session/Context

`MessageProducer` dibuat dari `Session`.

```text
Producer lifecycle <= Session lifecycle
```

Jika session ditutup, producer tidak valid.

#### Destination-bound vs Anonymous Producer

Classic producer bisa dibuat dengan destination tetap:

```java
MessageProducer producer = session.createProducer(orderQueue);
producer.send(message);
```

Atau anonymous producer:

```java
MessageProducer producer = session.createProducer(null);
producer.send(orderQueue, message);
producer.send(auditQueue, auditMessage);
```

Anonymous producer berguna bila destination dinamis, tetapi jangan membuat routing logic menjadi liar tanpa governance.

#### Producer Configuration

Producer bisa mengatur:

- delivery mode;
- priority;
- time-to-live;
- disable message id;
- disable timestamp;
- delivery delay pada JMS 2.0+;
- async completion listener pada JMS 2.0+.

Contoh:

```java
producer.setDeliveryMode(DeliveryMode.PERSISTENT);
producer.setPriority(4);
producer.setTimeToLive(60_000L);
```

Simplified:

```java
context.createProducer()
       .setDeliveryMode(DeliveryMode.PERSISTENT)
       .setPriority(4)
       .setTimeToLive(60_000L)
       .send(queue, payload);
```

#### Producer bukan Business Boundary

Kesalahan desain:

```text
"Kalau producer.send() sukses, berarti business transaction sukses."
```

Belum tentu.

Pertanyaan yang harus dijawab:

- Apakah send persistent?
- Apakah broker sudah fsync?
- Apakah send terjadi dalam transaction?
- Apakah commit sudah sukses?
- Apakah DB transaction sudah commit?
- Apakah message bisa duplicate setelah failover?
- Apakah downstream idempotent?

Producer hanya salah satu tahap dari end-to-end flow.

---

### 3.7 `MessageConsumer` dan `JMSConsumer`

Consumer adalah objek untuk menerima message dari destination.

Classic synchronous receive:

```java
MessageConsumer consumer = session.createConsumer(queue);
connection.start();
Message message = consumer.receive(5000);
```

Classic asynchronous listener:

```java
MessageConsumer consumer = session.createConsumer(queue);
consumer.setMessageListener(message -> {
    // process message
});
connection.start();
```

Simplified API:

```java
try (JMSContext context = factory.createContext()) {
    Queue queue = context.createQueue("orders");
    JMSConsumer consumer = context.createConsumer(queue);
    String body = consumer.receiveBody(String.class, 5000);
}
```

#### Consumer Terikat ke Session/Context

```text
Consumer lifecycle <= Session lifecycle
```

Jangan share satu consumer lintas thread.

#### Receive Model

Ada dua model:

1. pull/synchronous receive;
2. push/asynchronous listener.

Synchronous:

```java
Message message = consumer.receive(1000);
```

Cocok untuk:

- batch worker;
- controlled polling;
- test;
- command-line tools;
- repair/replay utility.

Asynchronous:

```java
consumer.setMessageListener(this::onMessage);
```

Cocok untuk:

- long-running service;
- event-driven application;
- container-managed listener;
- production consumer.

#### Listener Tidak Boleh Blocking Sembarangan

Bila `onMessage()` melakukan hal lambat:

- downstream HTTP call lama;
- DB lock wait;
- file IO besar;
- external API timeout;
- synchronized bottleneck;
- sleep/backoff manual;

maka session tersebut tertahan.

Kalau concurrency tidak dikonfigurasi dengan benar, queue depth naik dan dianggap broker bermasalah, padahal bottleneck ada di consumer.

#### Consumer dan Acknowledgement

Consumer receive tidak otomatis berarti message selesai secara business.

Selesai atau tidak ditentukan oleh:

- session acknowledgement mode;
- transacted session commit;
- container transaction;
- listener return behavior;
- exception behavior;
- provider redelivery policy.

---

### 3.8 `Message`

`Message` adalah unit transfer dalam JMS.

Message terdiri dari:

```text
Header
Properties
Body
```

```text
+---------------------+
| JMS Headers         |
| - JMSMessageID      |
| - JMSCorrelationID  |
| - JMSReplyTo        |
| - JMSDestination    |
| - JMSDeliveryMode   |
| - JMSExpiration     |
| - JMSPriority       |
| - JMSTimestamp      |
| - JMSRedelivered    |
+---------------------+
| Properties          |
| - businessType      |
| - tenantId          |
| - schemaVersion     |
| - correlationId     |
+---------------------+
| Body                |
| - text/json/xml     |
| - bytes/protobuf    |
| - map/object/etc.   |
+---------------------+
```

Contoh:

```java
TextMessage message = session.createTextMessage(json);
message.setStringProperty("eventType", "CASE_STATUS_CHANGED");
message.setStringProperty("schemaVersion", "1");
message.setJMSCorrelationID(correlationId);
producer.send(message);
```

#### Message Bukan Hanya Payload

Banyak engineer memperlakukan message seperti string:

```text
message = JSON body
```

Padahal dalam production, message adalah envelope:

```text
message = payload + routing metadata + reliability metadata + tracing metadata + semantic contract
```

Payload hanya satu bagian.

#### Message Lifecycle

```text
created by producer session/context
    -> populated with body/properties
    -> sent to destination
    -> broker assigns/store/routes
    -> delivered to consumer
    -> consumer reads headers/properties/body
    -> ack/commit determines completion
```

#### Jangan Simpan Message Object Terlalu Lama

Message object adalah provider-managed object. Jangan jadikan entity domain jangka panjang.

Buruk:

```java
List<Message> backlog = new ArrayList<>();
backlog.add(message);
```

Lebih baik extract immutable data:

```java
record IncomingCommand(
    String messageId,
    String correlationId,
    String payload,
    Map<String, Object> properties
) {}
```

---

## 4. Relasi dan Ownership Antar Objek

Relasi domain model:

```text
ConnectionFactory
    creates Connection / JMSContext

Connection
    creates Session
    controls start/stop delivery
    owns physical provider link

Session
    creates Producer
    creates Consumer
    creates Message
    creates Queue/Topic handles
    owns ack/transaction boundary
    is single-threaded

Producer
    sends Message to Destination
    inherits session lifecycle

Consumer
    receives Message from Destination
    inherits session lifecycle

Destination
    identifies Queue/Topic/address

Message
    carries headers/properties/body
```

Lifecycle classic API:

```text
ConnectionFactory
    -> Connection
        -> Session
            -> MessageProducer
            -> MessageConsumer
            -> Message
```

Close order:

```text
close consumer/producer if needed
close session
close connection
```

Usually closing connection closes its sessions/producers/consumers, but explicit lifecycle clarity helps.

Simplified API lifecycle:

```java
try (JMSContext context = factory.createContext()) {
    Queue queue = context.createQueue("orders");
    context.createProducer().send(queue, "payload");
}
```

`JMSContext.close()` releases underlying resources.

---

## 5. Thread-Safety Mental Model

Salah satu area paling penting.

### 5.1 Rule of Thumb

```text
ConnectionFactory: generally safe to share
Connection: often intended to be shared, but provider-specific details matter
Session: not safe for concurrent use
Producer: tied to session; do not concurrently use through same session
Consumer: tied to session; do not concurrently use through same session
Message: do not mutate concurrently; treat as per-message object
JMSContext: treat like session/context; do not freely share concurrently
```

### 5.2 Safe Architecture Patterns

Pattern 1: one worker thread, one session.

```text
Worker-1 -> Session-1 -> Consumer-1
Worker-2 -> Session-2 -> Consumer-2
Worker-3 -> Session-3 -> Consumer-3
```

Pattern 2: listener container creates multiple sessions.

```text
ListenerContainer(concurrency=5)
    -> Session-1 + Consumer-1
    -> Session-2 + Consumer-2
    -> Session-3 + Consumer-3
    -> Session-4 + Consumer-4
    -> Session-5 + Consumer-5
```

Pattern 3: producer pool.

```text
ProducerFacade
    borrows Session/Producer from pool
    sends
    returns resource
```

Pattern 4: one `JMSContext` per operation in managed/pooling environment.

```java
try (JMSContext context = factory.createContext()) {
    context.createProducer().send(queue, payload);
}
```

This is acceptable if provider/container pooling makes creation cheap. Without pooling, per-message creation can be expensive.

### 5.3 Unsafe Patterns

Unsafe: static session.

```java
static Session session;
```

Unsafe: singleton service with shared producer/session used by many request threads.

```java
@Service
class Publisher {
    private final Session session;
    private final MessageProducer producer;

    public void publish(String body) {
        producer.send(session.createTextMessage(body));
    }
}
```

Unsafe: listener delegates same message object to async thread then returns and ack happens before processing.

```java
consumer.setMessageListener(message -> {
    executor.submit(() -> process(message));
    // onMessage returns before process done
});
```

Depending on acknowledgement mode, message may be acknowledged before actual processing. This creates data loss risk.

Better:

- process inside listener;
- or use transacted/session-aware handoff carefully;
- or use internal queue with explicit ack model;
- or use container concurrency rather than manual async handoff.

---

## 6. Classic API vs Simplified API Side-by-Side

### 6.1 Classic Producer

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.DeliveryMode;
import javax.jms.Queue;
import javax.jms.Session;
import javax.jms.TextMessage;
import javax.jms.MessageProducer;

public final class ClassicOrderPublisher {
    private final ConnectionFactory connectionFactory;
    private final Queue orderQueue;

    public ClassicOrderPublisher(ConnectionFactory connectionFactory, Queue orderQueue) {
        this.connectionFactory = connectionFactory;
        this.orderQueue = orderQueue;
    }

    public void publish(String orderJson) throws Exception {
        try (Connection connection = connectionFactory.createConnection();
             Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE)) {

            MessageProducer producer = session.createProducer(orderQueue);
            producer.setDeliveryMode(DeliveryMode.PERSISTENT);

            TextMessage message = session.createTextMessage(orderJson);
            message.setStringProperty("messageType", "ORDER_CREATED");
            producer.send(message);
        }
    }
}
```

Catatan Java 8:

- JMS 1.1 classic API masih umum;
- `Connection` dan `Session` implement `AutoCloseable` pada JMS 2.0, tetapi legacy provider bisa berbeda;
- bila tidak tersedia try-with-resources, gunakan finally manual.

### 6.2 Simplified Producer

```java
import jakarta.jms.ConnectionFactory;
import jakarta.jms.DeliveryMode;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;

public final class ModernOrderPublisher {
    private final ConnectionFactory connectionFactory;
    private final Queue orderQueue;

    public ModernOrderPublisher(ConnectionFactory connectionFactory, Queue orderQueue) {
        this.connectionFactory = connectionFactory;
        this.orderQueue = orderQueue;
    }

    public void publish(String orderJson) {
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            context.createProducer()
                   .setDeliveryMode(DeliveryMode.PERSISTENT)
                   .setProperty("messageType", "ORDER_CREATED")
                   .send(orderQueue, orderJson);
        }
    }
}
```

### 6.3 Classic Consumer Polling

```java
try (Connection connection = connectionFactory.createConnection();
     Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE)) {

    MessageConsumer consumer = session.createConsumer(orderQueue);
    connection.start();

    Message message = consumer.receive(5000);
    if (message instanceof TextMessage) {
        String body = ((TextMessage) message).getText();
        process(body);
    }
}
```

### 6.4 Simplified Consumer Polling

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
    JMSConsumer consumer = context.createConsumer(orderQueue);
    String body = consumer.receiveBody(String.class, 5000);
    if (body != null) {
        process(body);
    }
}
```

### 6.5 Listener Style

```java
Connection connection = connectionFactory.createConnection();
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(orderQueue);

consumer.setMessageListener(message -> {
    try {
        TextMessage text = (TextMessage) message;
        process(text.getText());
    } catch (Exception e) {
        // behavior depends on ack mode/container/provider
        throw new RuntimeException(e);
    }
});

connection.start();
```

Dalam production, listener lifecycle harus jelas:

- kapan connection start;
- kapan stop;
- kapan close;
- bagaimana shutdown graceful;
- bagaimana exception ditangani;
- bagaimana redelivery dipicu;
- bagaimana transaksi diatur.

---

## 7. Resource Lifecycle: Apa yang Mahal dan Apa yang Murah?

Tidak semua objek JMS memiliki biaya yang sama.

Secara umum:

```text
ConnectionFactory: reusable, configured object
Connection: expensive relative to session/producer
Session: lightweight compared to connection, but not free
Producer: lightweight, tied to session
Consumer: tied to broker dispatch/subscription, not always trivial
Message: per-message object
Destination handle: usually lightweight
```

Namun provider bisa berbeda.

### 7.1 Mengapa Connection Mahal?

Connection bisa melibatkan:

- socket;
- authentication;
- TLS handshake;
- protocol negotiation;
- broker-side session allocation;
- heartbeat;
- failover state;
- buffer allocation;
- thread/resource registration.

Karena itu, membuat connection per message biasanya buruk.

### 7.2 Mengapa Consumer Tidak Selalu Murah?

Consumer bisa menyebabkan broker membuat atau mengubah:

- subscription;
- cursor;
- credit window;
- prefetch state;
- selector evaluation path;
- durable subscription binding;
- queue dispatch list.

Membuat consumer berulang-ulang dalam hot path bisa mahal.

### 7.3 Destination Handle Biasanya Murah, Tetapi Nama Destination Tidak Murah Secara Governance

`context.createQueue("x")` mungkin hanya membuat object handle lokal.

Tapi dari sisi governance:

- apakah queue benar-benar ada?
- apakah auto-create aktif?
- apakah permission benar?
- apakah DLQ policy ada?
- apakah typo membuat queue baru?

Production maturity bukan hanya performance, tetapi juga control.

---

## 8. Runtime Flow: Send Message End-to-End

Mari kita lihat send path.

```text
Application
    |
    | create message
    v
Session/JMSContext
    |
    | producer.send()
    v
Provider Client Library
    |
    | encode protocol frame
    v
Connection
    |
    | network/protocol
    v
Broker
    |
    | validate destination/security
    | persist or route
    | ack send to client
    v
Producer returns
```

Producer `send()` returning successfully may mean different things depending on:

- delivery mode;
- transaction;
- async send;
- broker config;
- persistence policy;
- replication policy;
- provider semantics.

Pertanyaan production:

```text
Ketika send() return, apa yang sudah benar-benar terjadi?
```

Kemungkinan:

- message sudah diterima client library;
- message sudah sampai broker;
- message sudah masuk memory broker;
- message sudah masuk journal;
- message sudah replicated;
- transaction belum commit;
- send async belum selesai.

Top engineer tidak berhenti di “API success”. Ia bertanya: “success pada boundary apa?”

---

## 9. Runtime Flow: Receive Message End-to-End

Receive path:

```text
Broker queue/topic subscription
    |
    | dispatch based on consumer credit/prefetch
    v
Provider Client Library
    |
    | buffer/prefetch
    v
Session/JMSContext
    |
    | deliver to receive() or MessageListener
    v
Application handler
    |
    | process side effect
    v
Ack/commit/rollback
    |
    v
Broker marks done or redelivers
```

Important distinction:

```text
delivered != processed
processed != acknowledged
acknowledged != downstream globally consistent
```

Example failure:

```text
1. consumer receives message
2. consumer writes DB successfully
3. process crashes before ack
4. broker redelivers message
5. consumer writes DB again
```

Without idempotency, duplicate side effect happens.

Inilah mengapa session, ack, transaction, and idempotency are inseparable.

---

## 10. Domain Model dalam Distributed System Terms

JMS object mapping ke distributed system concept:

| JMS Object | Distributed System Meaning |
|---|---|
| `ConnectionFactory` | configured gateway to messaging infrastructure |
| `Connection` | communication link / failure boundary |
| `Session` | single-threaded unit of work / ack and transaction boundary |
| `Destination` | logical address / routing target |
| `Queue` | work distribution buffer |
| `Topic` | event fan-out address |
| `Producer` | command/event publisher endpoint |
| `Consumer` | worker/subscriber endpoint |
| `Message` | durable/volatile data envelope |
| `JMSContext` | simplified connection+session facade |
| Broker | coordination substrate |

Mental model yang lebih kuat:

```text
JMS is not about passing objects.
JMS is about moving durable intent across unreliable time.
```

Ketika producer mengirim message, producer sedang menyatakan:

```text
"Ada intent/event yang harus diketahui/dikerjakan oleh pihak lain, meskipun pihak lain belum siap saat ini."
```

Destination adalah alamat intent tersebut.
Session adalah boundary kerja.
Broker adalah penjaga waktu antara producer dan consumer.
Ack adalah tanda bahwa tanggung jawab berpindah.

---

## 11. Lifecycle Anti-Patterns

### 11.1 Connection per Message

Buruk:

```java
for (Order order : orders) {
    try (Connection c = factory.createConnection();
         Session s = c.createSession(false, Session.AUTO_ACKNOWLEDGE)) {
        MessageProducer p = s.createProducer(queue);
        p.send(s.createTextMessage(toJson(order)));
    }
}
```

Masalah:

- connection churn;
- broker resource churn;
- latency tinggi;
- TLS/auth overhead;
- lebih rentan connection exhaustion.

Lebih baik:

```java
try (Connection c = factory.createConnection();
     Session s = c.createSession(false, Session.AUTO_ACKNOWLEDGE)) {
    MessageProducer p = s.createProducer(queue);
    for (Order order : orders) {
        p.send(s.createTextMessage(toJson(order)));
    }
}
```

Atau pakai pool/framework.

### 11.2 Shared Session Across Threads

Buruk:

```java
ExecutorService executor = Executors.newFixedThreadPool(8);
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
MessageProducer producer = session.createProducer(queue);

for (String payload : payloads) {
    executor.submit(() -> producer.send(session.createTextMessage(payload)));
}
```

Lebih baik:

```text
each worker owns its own session/producer
```

### 11.3 Listener Offloads Work then Returns

Buruk:

```java
consumer.setMessageListener(message -> {
    executor.submit(() -> process(message));
});
```

Masalah:

- ack bisa terjadi saat `onMessage()` selesai;
- actual processing belum selesai;
- jika async task gagal, broker mengira sukses;
- message object bisa tidak valid untuk long-lived async use.

Lebih baik:

```java
consumer.setMessageListener(message -> {
    process(message); // finish before listener returns
});
```

Atau gunakan concurrency yang benar: multiple sessions/consumers, listener container, MDB pool.

### 11.4 Treating Destination Name as Implementation Detail

Buruk:

```java
context.createQueue("tmp2");
```

Nama destination adalah integration contract. Harus di-review seperti API endpoint atau database schema.

### 11.5 Ignoring Close/Shutdown

Buruk:

```java
Connection connection = factory.createConnection();
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
// no close
```

Akibat:

- connection leak;
- consumer masih aktif;
- broker melihat stale consumer;
- deployment shutdown lambat;
- duplicate connection after redeploy.

---

## 12. Object Model dan Failure Boundary

Setiap objek membawa failure boundary berbeda.

### 12.1 Connection Failure

Jika connection gagal:

- semua session di atasnya terdampak;
- consumer disconnect;
- unacknowledged message bisa redeliver;
- producer send bisa fail;
- transaction bisa rollback/unknown;
- reconnect policy menentukan recovery.

### 12.2 Session Failure

Jika session error:

- producer/consumer dari session tersebut invalid;
- ack/transaction boundary terganggu;
- message in-flight bisa redeliver;
- session harus recreated.

### 12.3 Producer Failure

Producer send failure bisa berarti:

- message belum sampai broker;
- message sudah sampai broker tapi response hilang;
- transaction state unknown;
- retry bisa duplicate.

### 12.4 Consumer Failure

Consumer failure bisa berarti:

- message belum diproses;
- message diproses tapi belum ack;
- message ack tapi side effect gagal;
- duplicate atau loss tergantung urutan side effect/ack.

### 12.5 Message Handler Failure

Handler failure harus diklasifikasi:

```text
Transient     -> retry/redelivery
Permanent     -> DLQ/quarantine
Poison        -> DLQ immediately after threshold
Non-idempotent-> require compensating logic
Schema error  -> contract/version issue
Security error-> reject/quarantine
```

---

## 13. Java 8 sampai Java 25 Considerations

### 13.1 Java 8

Masih banyak enterprise JMS berjalan di Java 8.

Pertimbangan:

- sering memakai `javax.jms`;
- JMS 1.1 atau JMS 2.0 tergantung provider;
- no records, no virtual threads;
- try-with-resources tersedia, tetapi API object AutoCloseable tergantung versi JMS;
- framework lama mungkin memakai JNDI dan app server.

Style:

```java
public final class OrderMessage {
    private final String messageId;
    private final String payload;

    public OrderMessage(String messageId, String payload) {
        this.messageId = messageId;
        this.payload = payload;
    }

    public String getMessageId() { return messageId; }
    public String getPayload() { return payload; }
}
```

### 13.2 Java 11/17

Pertimbangan:

- Java EE modules removed from JDK after Java 8 era, dependency explicit;
- many systems migrate from `javax` to `jakarta` around this generation;
- better runtime observability;
- records available starting Java 16;
- Java 17 LTS commonly used with Spring Boot 3 / Jakarta EE 10 stacks.

### 13.3 Java 21

Pertimbangan:

- virtual threads available;
- but JMS session remains single-threaded concept;
- virtual threads do not make provider objects magically thread-safe;
- useful for synchronous orchestration around JMS, but listener/container semantics still must be respected.

Bad assumption:

```text
"With virtual threads, I can share one Session across thousands of virtual threads."
```

Wrong. The session contract does not change.

Better:

```text
virtual threads can simplify blocking waits,
but JMS resource ownership still follows session/thread boundaries.
```

### 13.4 Java 25

Pertimbangan:

- modern LTS runtime;
- better JVM ergonomics;
- but JMS provider compatibility must be verified;
- native images, modules, reflection, and app server support may vary;
- `javax.jms` legacy libraries may not be validated on latest JDK.

Principle:

```text
JDK can be modern, but broker/client/provider compatibility is the real constraint.
```

---

## 14. Designing a Clean JMS Abstraction in Application Code

Jangan sebarkan JMS API ke seluruh domain layer.

Buruk:

```java
class CaseService {
    private final Session session;
    private final Queue queue;

    public void assignCase(...) {
        // business logic mixed with JMS mechanics
    }
}
```

Lebih baik:

```text
Domain Service
    -> Application Port
        -> Messaging Adapter
            -> JMS API
```

Contoh port:

```java
public interface CaseCommandPublisher {
    void publishAssignCase(AssignCaseCommand command);
}
```

Adapter JMS:

```java
public final class JmsCaseCommandPublisher implements CaseCommandPublisher {
    private final ConnectionFactory connectionFactory;
    private final Queue destination;
    private final JsonCodec jsonCodec;

    public JmsCaseCommandPublisher(
            ConnectionFactory connectionFactory,
            Queue destination,
            JsonCodec jsonCodec
    ) {
        this.connectionFactory = connectionFactory;
        this.destination = destination;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public void publishAssignCase(AssignCaseCommand command) {
        String payload = jsonCodec.encode(command);
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            context.createProducer()
                   .setProperty("messageType", "ASSIGN_CASE")
                   .setProperty("schemaVersion", "1")
                   .setProperty("aggregateId", command.caseId())
                   .send(destination, payload);
        }
    }
}
```

Domain tidak perlu tahu:

- `JMSContext`;
- `Queue`;
- delivery mode;
- properties;
- broker;
- retry transport.

Tetapi application adapter harus sangat paham semua itu.

---

## 15. Minimal Reference Architecture untuk Part Ini

```text
+--------------------------+
| Application Service      |
| - validates command      |
| - changes local state    |
+------------+-------------+
             |
             | publish command/event via port
             v
+--------------------------+
| Messaging Adapter        |
| - maps domain -> message |
| - sets headers/properties|
| - chooses destination    |
+------------+-------------+
             |
             | JMS API
             v
+--------------------------+
| JMS Provider Client      |
| - connection/session     |
| - producer/consumer      |
| - protocol frames        |
+------------+-------------+
             |
             | network
             v
+--------------------------+
| Broker                   |
| - queue/topic            |
| - persistence            |
| - dispatch               |
| - redelivery/DLQ         |
+------------+-------------+
             |
             | delivery
             v
+--------------------------+
| Consumer Adapter         |
| - reads message          |
| - validates contract     |
| - invokes handler        |
| - ack/commit behavior    |
+------------+-------------+
             |
             v
+--------------------------+
| Application Handler      |
| - idempotency            |
| - business side effects  |
| - state transition       |
+--------------------------+
```

Part ini fokus pada layer tengah:

```text
Messaging Adapter <-> JMS Provider Client <-> Broker
```

---

## 16. Production Checklist untuk Domain Model

Sebelum menulis consumer/producer production, jawab pertanyaan berikut.

### 16.1 ConnectionFactory

- Dari mana `ConnectionFactory` dibuat?
- Apakah dikelola container atau dibuat manual?
- Apakah credential aman?
- Apakah TLS aktif?
- Apakah reconnect policy jelas?
- Apakah pooling aktif?
- Apakah provider client compatible dengan JDK target?
- Apakah namespace `javax.jms` atau `jakarta.jms` sudah konsisten?

### 16.2 Connection

- Apakah connection dibuat per app, per worker, atau per operation?
- Apakah ada connection leak?
- Apakah `connection.start()` dipanggil untuk consumer classic API?
- Apakah shutdown menutup connection?
- Apakah exception listener dipasang bila standalone?
- Apakah failover tested?

### 16.3 Session / JMSContext

- Apakah session dishare antar thread? Jika iya, itu red flag.
- Apa acknowledgement mode?
- Apakah transacted?
- Siapa yang commit/rollback?
- Apakah listener concurrency memakai multiple session?
- Apakah context lifecycle jelas?

### 16.4 Destination

- Apakah destination admin-defined?
- Apakah nama destination bagian dari contract?
- Apakah queue/topic dipilih sesuai semantic?
- Apakah DLQ policy ada?
- Apakah auto-create destination dimatikan di production?
- Apakah permission per destination benar?

### 16.5 Producer

- Apakah producer dibuat per message atau reused/pooled?
- Apakah delivery mode eksplisit?
- Apakah TTL perlu?
- Apakah priority dipakai? Jika iya, apakah ordering impact diterima?
- Apakah send dalam transaction?
- Apakah retry producer bisa menyebabkan duplicate?

### 16.6 Consumer

- Apakah consumer synchronous atau asynchronous?
- Apakah listener blocking terlalu lama?
- Apakah concurrency berasal dari multiple sessions?
- Apakah handler idempotent?
- Apakah exception behavior diuji?
- Apakah redelivery dan DLQ diuji?

### 16.7 Message

- Apakah message punya `correlationId`?
- Apakah punya schema version?
- Apakah punya business idempotency key?
- Apakah properties dipakai untuk routing/filtering secara wajar?
- Apakah payload kompatibel lintas versi?
- Apakah message size dibatasi?

---

## 17. Mini Exercise: Membaca Kode dan Menemukan Risiko

### Kode

```java
public class SharedPublisher {
    private final Session session;
    private final MessageProducer producer;

    public SharedPublisher(Connection connection, Queue queue) throws JMSException {
        this.session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
        this.producer = session.createProducer(queue);
    }

    public void publish(String payload) throws JMSException {
        TextMessage message = session.createTextMessage(payload);
        producer.send(message);
    }
}
```

### Pertanyaan

Apa risikonya?

### Analisis

Risiko utama:

1. `Session` disimpan sebagai field long-lived;
2. `MessageProducer` juga field long-lived dan terikat ke session;
3. jika `publish()` dipanggil concurrent, session digunakan oleh banyak thread;
4. tidak ada close lifecycle;
5. delivery mode tidak eksplisit;
6. tidak ada correlation id/message properties;
7. tidak ada handling connection failure;
8. tidak jelas apakah connection sudah started, meski untuk producer tidak selalu perlu;
9. tidak ada pooling/ownership policy.

Better design:

```java
public final class SafePublisher {
    private final ConnectionFactory factory;
    private final Queue queue;

    public SafePublisher(ConnectionFactory factory, Queue queue) {
        this.factory = factory;
        this.queue = queue;
    }

    public void publish(String payload, String correlationId) {
        try (JMSContext context = factory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            context.createProducer()
                   .setProperty("schemaVersion", "1")
                   .setProperty("messageType", "SOME_COMMAND")
                   .setJMSCorrelationID(correlationId)
                   .send(queue, payload);
        }
    }
}
```

Namun versi ini bergantung pada provider/container pooling. Jika tidak ada pooling dan throughput tinggi, gunakan explicit pooled session/producer atau framework container.

---

## 18. Mini Exercise: Consumer Listener yang Salah

### Kode

```java
consumer.setMessageListener(message -> {
    executor.submit(() -> {
        try {
            process(message);
        } catch (Exception e) {
            log.error("failed", e);
        }
    });
});
```

### Risiko

- `onMessage()` selesai sebelum `process()` selesai;
- pada `AUTO_ACKNOWLEDGE`, message bisa dianggap sukses terlalu awal;
- exception di async task tidak terlihat oleh JMS provider;
- redelivery tidak terjadi;
- message object dipakai di thread lain;
- ordering bisa rusak;
- shutdown bisa kehilangan task in-flight.

Better:

```java
consumer.setMessageListener(message -> {
    process(message);
});
```

Untuk parallelism:

```text
increase consumer/session count, not async offload from same listener blindly
```

---

## 19. Key Invariants dari Part Ini

Ingat invariant berikut:

```text
1. JMS is an API contract; broker behavior is implementation/runtime.
2. ConnectionFactory is a configured entry point, not an active connection.
3. Connection is a provider link and failure boundary.
4. Session is a single-threaded unit of work.
5. Session owns acknowledgement and transaction semantics.
6. Producer and consumer are tied to session/context lifecycle.
7. Destination is a logical address and integration contract.
8. Message is envelope + metadata + body, not just payload.
9. JMSContext simplifies API but does not remove connection/session concepts.
10. Parallelism in JMS usually means multiple sessions/consumers, not shared session concurrency.
11. Delivered does not mean processed.
12. Processed does not mean acknowledged.
13. Acknowledged does not mean globally consistent.
14. Resource lifecycle is part of correctness, not just cleanup.
15. Top-level design should hide JMS mechanics behind application ports, but infrastructure code must deeply understand JMS semantics.
```

---

## 20. What Top 1% Engineers See Here

Beginner sees:

```text
Connection, Session, Producer, Consumer, Message
```

Intermediate engineer sees:

```text
API objects and boilerplate
```

Senior engineer sees:

```text
resource lifecycle, thread-safety, transaction, ack, failure behavior
```

Top 1% engineer sees:

```text
ownership + temporal responsibility transfer + failure boundaries + semantic contract + operational consequences
```

When a message moves from producer to broker to consumer, responsibility changes hands.

```text
Producer responsibility:
    create valid intent/event
    choose correct destination
    send with correct durability/metadata

Broker responsibility:
    store/route/dispatch according to config
    preserve configured semantics
    expose operational state

Consumer responsibility:
    process safely
    handle duplicate/redelivery
    ack only when responsibility is truly complete
```

The JMS domain model is the map of that responsibility transfer.

---

## 21. Ringkasan

Part ini membahas model domain inti JMS/Jakarta Messaging:

- `ConnectionFactory` sebagai configured gateway;
- `Connection` sebagai link ke broker;
- `Session` sebagai single-threaded unit of work;
- `JMSContext` sebagai simplified connection+session facade;
- `Destination` sebagai alamat logis;
- `Queue` dan `Topic` sebagai domain messaging berbeda;
- `MessageProducer`/`JMSProducer` sebagai sender;
- `MessageConsumer`/`JMSConsumer` sebagai receiver;
- `Message` sebagai envelope metadata + body;
- lifecycle dan ownership;
- thread-safety;
- send/receive runtime flow;
- failure boundary;
- anti-pattern utama.

Part berikutnya akan masuk ke **Queue Semantics**: point-to-point, competing consumers, work distribution, load leveling, redelivery, poison message, dan bagaimana queue dipakai untuk command/work orchestration dalam sistem enterprise.

---

## 22. Status Seri

Seri belum selesai.

Progress:

- Part 0 — selesai
- Part 1 — selesai
- Part 2 — selesai
- Berikutnya: Part 3 — Queue Semantics: Point-to-Point, Competing Consumers, Work Distribution, dan Load Leveling

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-001.md">⬅️ Part 1 — Evolution: JMS 1.1, JMS 2.0, Jakarta Messaging 3.x, dan Dampaknya ke Java 8–25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-003.md">Part 3 — Queue Semantics: Point-to-Point, Competing Consumers, Work Distribution, dan Load Leveling ➡️</a>
</div>

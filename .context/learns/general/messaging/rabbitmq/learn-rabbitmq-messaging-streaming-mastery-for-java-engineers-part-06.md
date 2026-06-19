# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-06.md

# Part 06 — Java Client Fundamentals tanpa Spring

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami RabbitMQ dari layer protokol, client runtime, concurrency, reliability, dan production design.  
> Fokus part ini: memakai RabbitMQ Java Client langsung, tanpa Spring, agar mental model kamu tidak bergantung pada abstraksi framework.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya kita sudah membangun fondasi:

1. RabbitMQ bukan Kafka kecil.
2. RabbitMQ adalah broker, router, queue engine, dan stream-capable system.
3. AMQP 0-9-1 punya entity inti: connection, channel, exchange, queue, binding, routing key, consumer, delivery tag.
4. Exchange menentukan routing; queue menentukan holding dan delivery semantics.
5. Queue type berbeda: classic, quorum, stream.
6. Local lab sudah dibuat sebagai tempat eksperimen.

Part ini masuk ke layer Java client.

Tujuan part ini bukan sekadar bisa menulis:

```java
channel.basicPublish(...);
```

Tujuan sebenarnya adalah memahami:

- object Java mana yang merepresentasikan resource broker;
- object mana yang thread-safe dan mana yang tidak;
- kapan message benar-benar dianggap terkirim;
- kapan message benar-benar dianggap selesai diproses;
- apa yang terjadi saat broker restart;
- apa yang terjadi saat TCP connection putus;
- apa yang terjadi saat consumer crash setelah side effect berhasil tapi sebelum ack;
- bagaimana menulis kode Java yang tidak menipu diri sendiri soal reliability.

RabbitMQ Java Client terlihat sederhana, tetapi kesalahan kecil pada connection/channel/ack/threading bisa menghasilkan bug produksi yang sangat mahal: duplicate processing, message loss, stuck unacked messages, retry storm, atau publisher yang merasa berhasil padahal message tidak pernah masuk queue.

---

## 1. Baseline Penting dari Dokumentasi Resmi

Beberapa prinsip resmi RabbitMQ Java Client yang harus menjadi invariant desain:

1. `Connection` adalah koneksi TCP/AMQP ke broker.
2. `Channel` adalah virtual connection di atas connection.
3. Channel tidak sebaiknya dibagikan antar thread.
4. Consumer acknowledgement dan publisher confirm adalah dua mekanisme berbeda.
5. Automatic recovery bisa memulihkan connection, channel, topology, dan consumer dalam banyak kasus, tetapi bukan pengganti idempotency.
6. Delivery tag bersifat scoped ke channel.
7. Consumer manual acknowledgement adalah default yang aman untuk workload penting.
8. Publisher confirm diperlukan bila publisher perlu tahu broker sudah menerima message.

Dokumentasi RabbitMQ Java Client menekankan bahwa sharing `Channel` antar thread harus dihindari; aplikasi sebaiknya memakai channel per thread karena operasi concurrent tertentu dapat menyebabkan frame interleaving, double acknowledgement, dan masalah publisher confirms.  
Sumber: RabbitMQ Java Client API Guide — <https://www.rabbitmq.com/client-libraries/java-api-guide>

Dokumentasi RabbitMQ juga memisahkan dua konsep reliability: consumer acknowledgements untuk sisi consuming, dan publisher confirms untuk sisi publishing.  
Sumber: RabbitMQ Consumer Acknowledgements and Publisher Confirms — <https://www.rabbitmq.com/docs/confirms>

Automatic recovery pada Java client dapat melakukan recovery connection yang putus bukan karena aplikasi menutupnya, serta dapat melakukan recovery topology seperti exchanges, queues, bindings, dan consumers.  
Sumber: RabbitMQ Java Client current API — `AutorecoveringConnection` — <https://rabbitmq.github.io/rabbitmq-java-client/api/current/com/rabbitmq/client/impl/recovery/AutorecoveringConnection.html>

---

## 2. Mental Model Java Client

RabbitMQ Java Client sebaiknya kamu pikirkan sebagai empat layer:

```text
+--------------------------------------------------+
| Application Logic                                |
| - domain handler                                 |
| - idempotency                                    |
| - transaction boundary                           |
| - retry decision                                 |
+--------------------------------------------------+
| RabbitMQ Java Client API                         |
| - ConnectionFactory                              |
| - Connection                                     |
| - Channel                                        |
| - DeliverCallback                                |
| - ConfirmListener                                |
+--------------------------------------------------+
| AMQP 0-9-1 Protocol                              |
| - basic.publish                                  |
| - basic.consume                                  |
| - basic.ack                                      |
| - basic.nack                                     |
| - exchange.declare                               |
| - queue.declare                                  |
| - queue.bind                                     |
+--------------------------------------------------+
| TCP/TLS Network                                  |
| - socket                                         |
| - heartbeat                                      |
| - network failure                                |
| - broker failover                                |
+--------------------------------------------------+
```

Framework seperti Spring AMQP akan membungkus banyak hal di atas. Tetapi jika mental model Java Client kamu lemah, Spring hanya akan membuat bug terlihat lebih rapi.

---

## 3. Dependency Java Client

Untuk Maven:

```xml
<dependency>
    <groupId>com.rabbitmq</groupId>
    <artifactId>amqp-client</artifactId>
    <version>5.28.0</version>
</dependency>
```

Versi di atas adalah contoh yang sesuai dengan dokumentasi API current saat materi ini disusun. Untuk project nyata, selalu cek versi terbaru di Maven Central dan sesuaikan dengan policy dependency organisasi.

Untuk Gradle:

```gradle
dependencies {
    implementation 'com.rabbitmq:amqp-client:5.28.0'
}
```

Kamu juga butuh logging. RabbitMQ Java Client memakai SLF4J. Untuk local learning bisa gunakan Logback:

```xml
<dependency>
    <groupId>ch.qos.logback</groupId>
    <artifactId>logback-classic</artifactId>
    <version>1.5.18</version>
</dependency>
```

Versi logging tidak penting untuk mental model. Yang penting: jangan menjalankan messaging client tanpa log yang bisa menjelaskan connection shutdown, recovery, consumer exception, dan publisher failure.

---

## 4. Minimal Project Structure

Untuk belajar tanpa Spring, struktur sederhana:

```text
rabbitmq-java-client-lab/
  pom.xml
  src/main/java/
    dev/example/rabbit/lab/
      RabbitConnectionConfig.java
      RabbitTopology.java
      SimplePublisher.java
      ReliablePublisher.java
      SimpleConsumer.java
      ManualAckConsumer.java
      WorkerPoolConsumer.java
      JsonMessageCodec.java
      MessageEnvelope.java
```

Pisahkan minimal tiga concern:

1. connection configuration;
2. topology declaration;
3. publisher/consumer logic.

Jangan campur semua ke `main()` kecuali untuk demo paling awal.

---

## 5. ConnectionFactory: Pintu Masuk ke Broker

`ConnectionFactory` adalah konfigurasi untuk membuat connection.

Contoh dasar:

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.ConnectionFactory;

public final class RabbitConnectionConfig {

    private RabbitConnectionConfig() {}

    public static ConnectionFactory createFactory() {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost(env("RABBITMQ_HOST", "localhost"));
        factory.setPort(Integer.parseInt(env("RABBITMQ_PORT", "5672")));
        factory.setUsername(env("RABBITMQ_USERNAME", "app"));
        factory.setPassword(env("RABBITMQ_PASSWORD", "app"));
        factory.setVirtualHost(env("RABBITMQ_VHOST", "app"));

        factory.setConnectionTimeout(10_000);
        factory.setRequestedHeartbeat(30);
        factory.setNetworkRecoveryInterval(5_000);
        factory.setAutomaticRecoveryEnabled(true);
        factory.setTopologyRecoveryEnabled(true);

        return factory;
    }

    private static String env(String key, String defaultValue) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? defaultValue : value;
    }
}
```

### 5.1 Apa Arti Setting Ini?

| Setting | Makna | Failure yang Dibantu |
|---|---|---|
| `host` | broker host | target connection |
| `port` | AMQP port, default 5672 | target connection |
| `username/password` | authentication | akses broker |
| `virtualHost` | namespace logical | isolation antar app/env |
| `connectionTimeout` | batas waktu membuka socket | broker unreachable |
| `requestedHeartbeat` | heartbeat AMQP | half-open connection detection |
| `networkRecoveryInterval` | interval retry recovery | transient network failure |
| `automaticRecoveryEnabled` | auto reconnect | TCP/broker interruption |
| `topologyRecoveryEnabled` | redeclare topology/consumer | recovery setelah reconnect |

### 5.2 Invariant Penting

Automatic recovery bukan garansi exactly-once.

Ia membantu client tersambung kembali, tetapi tidak menyelesaikan:

- message yang sudah diproses tapi ack gagal;
- publish yang hasilnya ambiguous saat connection putus;
- duplicate delivery setelah recovery;
- side effect application yang tidak idempotent;
- ordering yang berubah akibat reconnect dan competing consumers.

Recovery adalah transport resilience. Idempotency adalah application correctness.

---

## 6. Connection vs Channel

RabbitMQ Java Client punya dua object penting:

```text
Connection = koneksi TCP/AMQP fisik-ish ke broker
Channel    = virtual AMQP session di atas connection
```

Satu connection bisa punya banyak channel.

```text
Application JVM
  |
  | TCP connection
  v
RabbitMQ node
  |
  +-- channel 1: publisher
  +-- channel 2: consumer A
  +-- channel 3: consumer B
  +-- channel 4: topology declaration
```

### 6.1 Kenapa Channel Ada?

Membuka TCP connection mahal. AMQP memakai channel agar banyak logical operation bisa multiplexed di satu connection.

Tetapi channel bukan thread-safe abstraction untuk semua operasi. Secara praktis:

- satu thread publisher sebaiknya punya channel sendiri;
- satu consumer callback berjalan pada dispatch thread client;
- jangan share channel publisher antar banyak thread tanpa discipline ketat;
- delivery tag hanya valid pada channel tempat delivery diterima;
- ack harus dikirim pada channel yang sama dengan delivery.

### 6.2 Rule of Thumb

Gunakan:

```text
1 long-lived Connection per application process per broker/vhost role
N Channels sesuai kebutuhan publisher/consumer/thread
```

Hindari:

```text
1 Connection per message
1 Channel per message
1 shared Channel untuk semua thread
```

### 6.3 Kenapa Bukan Connection per Publish?

Karena connection membuat handshake TCP/AMQP, authentication, tuning, dan resource broker. Membuka/menutup connection per message adalah anti-pattern.

### 6.4 Kenapa Bukan Channel Shared Semua Thread?

Karena AMQP frame dari operasi concurrent bisa saling interleave. Efeknya bisa subtle:

- publish confirm correlation rusak;
- double ack;
- protocol exception;
- channel closed;
- message redelivery tidak terduga.

Untuk Java engineer, analoginya:

```text
Connection seperti datasource/pool boundary.
Channel seperti session/transactional cursor yang punya state.
```

Bukan analogi sempurna, tapi cukup untuk menghindari shared mutable state lintas thread.

---

## 7. Membuka Connection dan Channel

Contoh minimal:

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

public class ConnectionSmokeTest {
    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = RabbitConnectionConfig.createFactory();

        try (Connection connection = factory.newConnection("rabbitmq-java-client-lab")) {
            try (Channel channel = connection.createChannel()) {
                System.out.println("Connected: " + connection.isOpen());
                System.out.println("Channel open: " + channel.isOpen());
            }
        }
    }
}
```

Client-provided connection name sangat berguna di Management UI. Jangan biarkan semua connection bernama anonim.

Gunakan nama yang membantu operasi:

```text
case-service:publisher:prod:pod-7f5c9
case-service:consumer:evidence-review:prod:pod-7f5c9
```

---

## 8. Declaring Topology dari Java

Untuk demo, Java app boleh declare topology. Untuk produksi, topology ownership harus jelas. Bisa oleh aplikasi, IaC, bootstrap job, atau platform team.

Contoh topology direct exchange + quorum queue:

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;

import java.io.IOException;
import java.util.Map;

public final class RabbitTopology {

    public static final String EXCHANGE_CASE_COMMANDS = "case.commands.x";
    public static final String QUEUE_CASE_ASSIGN_REVIEW = "case.assign-review.q";
    public static final String ROUTING_ASSIGN_REVIEW = "case.assign-review";

    private RabbitTopology() {}

    public static void declare(Channel channel) throws IOException {
        channel.exchangeDeclare(
                EXCHANGE_CASE_COMMANDS,
                "direct",
                true,   // durable
                false,  // autoDelete
                Map.of()
        );

        Map<String, Object> queueArgs = Map.of(
                "x-queue-type", "quorum"
        );

        channel.queueDeclare(
                QUEUE_CASE_ASSIGN_REVIEW,
                true,   // durable
                false,  // exclusive
                false,  // autoDelete
                queueArgs
        );

        channel.queueBind(
                QUEUE_CASE_ASSIGN_REVIEW,
                EXCHANGE_CASE_COMMANDS,
                ROUTING_ASSIGN_REVIEW
        );
    }
}
```

### 8.1 Declare Bersifat Idempotent, Tapi Bukan Bebas Risiko

`exchangeDeclare` dan `queueDeclare` aman dipanggil ulang jika definisinya sama.

Namun jika definisi berbeda, broker akan menolak dengan precondition failure dan channel akan ditutup.

Contoh konflik:

- queue sudah ada sebagai classic, kamu declare sebagai quorum;
- exchange sudah ada sebagai topic, kamu declare direct;
- durable flag beda;
- queue argument beda.

Jadi declare topology di aplikasi harus dianggap sebagai contract. Jangan asal ubah argumen queue di deploy baru dan berharap RabbitMQ akan “migrate” otomatis.

---

## 9. Publishing Message Paling Dasar

Contoh publisher sederhana:

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

public class SimplePublisher {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = RabbitConnectionConfig.createFactory();

        try (Connection connection = factory.newConnection("case-service:publisher:local")) {
            try (Channel channel = connection.createChannel()) {
                RabbitTopology.declare(channel);

                String messageId = UUID.randomUUID().toString();
                String body = "{\"caseId\":\"CASE-123\",\"reviewerId\":\"USR-7\"}";

                AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
                        .contentType("application/json")
                        .contentEncoding("utf-8")
                        .deliveryMode(2) // persistent
                        .messageId(messageId)
                        .correlationId(UUID.randomUUID().toString())
                        .timestamp(java.util.Date.from(Instant.now()))
                        .type("case.assign-review.command.v1")
                        .appId("case-service")
                        .build();

                channel.basicPublish(
                        RabbitTopology.EXCHANGE_CASE_COMMANDS,
                        RabbitTopology.ROUTING_ASSIGN_REVIEW,
                        true, // mandatory
                        properties,
                        body.getBytes(StandardCharsets.UTF_8)
                );

                System.out.println("Published messageId=" + messageId);
            }
        }
    }
}
```

### 9.1 Apa yang Belum Aman dari Publisher Ini?

Kode di atas belum production-safe karena:

1. belum memakai publisher confirms;
2. belum handle returned message dari `mandatory=true`;
3. belum punya retry policy;
4. belum punya outbox;
5. belum tahu apakah message benar-benar diterima broker sebelum connection ditutup;
6. belum handle ambiguous outcome saat network failure.

Tetapi kode ini cukup untuk memahami API dasar.

### 9.2 `deliveryMode(2)` Bukan Magic

`deliveryMode(2)` artinya message persistent.

Agar message bertahan broker restart, kombinasi minimal:

```text
durable exchange
+ durable queue
+ persistent message
```

Tetapi persistent message tetap tidak berarti publisher aman tanpa confirms. Publisher perlu confirm untuk tahu broker sudah menerima dan menangani publish.

---

## 10. BasicProperties: Metadata adalah Bagian dari Contract

RabbitMQ message bukan hanya byte array. Ia punya properties.

Minimal production metadata:

| Property | Tujuan |
|---|---|
| `messageId` | idempotency, deduplication, forensic tracing |
| `correlationId` | menghubungkan workflow/request/log |
| `contentType` | decoder selection |
| `contentEncoding` | decoding bytes |
| `type` | semantic message type |
| `timestamp` | approximate publish time |
| `appId` | producer identity |
| headers | schema version, trace id, tenant id, causation id |

Contoh properties yang lebih lengkap:

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
        .contentType("application/json")
        .contentEncoding("utf-8")
        .deliveryMode(2)
        .messageId(messageId)
        .correlationId(correlationId)
        .type("case.assign-review.command.v1")
        .appId("case-service")
        .headers(Map.of(
                "schema_version", "1",
                "trace_id", traceId,
                "causation_id", causationId,
                "tenant_id", tenantId
        ))
        .timestamp(java.util.Date.from(Instant.now()))
        .build();
```

### 10.1 Jangan Publish JPA Entity

Anti-pattern:

```java
byte[] body = objectMapper.writeValueAsBytes(caseEntity);
```

Masalah:

- entity mengikuti database model, bukan message contract;
- lazy field bisa bocor;
- internal field bisa bocor;
- perubahan schema database mematahkan consumer;
- consumer menjadi coupled ke persistence model producer.

Gunakan explicit message DTO:

```java
public record AssignReviewCommand(
        String caseId,
        String reviewerId,
        String reason,
        String requestedBy,
        Instant requestedAt
) {}
```

---

## 11. JSON Codec Sederhana

Contoh codec dengan Jackson:

```java
package dev.example.rabbit.lab;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

public final class JsonMessageCodec {

    private final ObjectMapper objectMapper;

    public JsonMessageCodec() {
        this.objectMapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }

    public byte[] encode(Object value) {
        try {
            return objectMapper.writeValueAsBytes(value);
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to encode message", e);
        }
    }

    public <T> T decode(byte[] body, Class<T> type) {
        try {
            return objectMapper.readValue(body, type);
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to decode message as " + type.getName(), e);
        }
    }
}
```

`FAIL_ON_UNKNOWN_PROPERTIES` sering dimatikan untuk forward compatibility, tetapi ini bukan izin untuk message contract kacau. Unknown field harus tetap dipantau lewat contract test atau schema policy.

---

## 12. Consumer Paling Dasar

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.nio.charset.StandardCharsets;

public class SimpleConsumer {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = RabbitConnectionConfig.createFactory();
        Connection connection = factory.newConnection("case-service:consumer:simple:local");
        Channel channel = connection.createChannel();

        RabbitTopology.declare(channel);

        boolean autoAck = true;

        DeliverCallback deliverCallback = (consumerTag, delivery) -> {
            String body = new String(delivery.getBody(), StandardCharsets.UTF_8);
            System.out.println("Received: " + body);
        };

        channel.basicConsume(
                RabbitTopology.QUEUE_CASE_ASSIGN_REVIEW,
                autoAck,
                deliverCallback,
                consumerTag -> System.out.println("Consumer cancelled: " + consumerTag)
        );
    }
}
```

### 12.1 Kenapa `autoAck=true` Berbahaya?

Dengan `autoAck=true`, broker menganggap message selesai begitu dikirim ke consumer.

Jika consumer menerima message lalu crash sebelum proses selesai, message hilang dari perspektif broker.

Untuk workload penting, gunakan manual ack.

---

## 13. Manual Ack Consumer

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.nio.charset.StandardCharsets;

public class ManualAckConsumer {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = RabbitConnectionConfig.createFactory();
        Connection connection = factory.newConnection("case-service:consumer:manual-ack:local");
        Channel channel = connection.createChannel();

        RabbitTopology.declare(channel);

        int prefetchCount = 10;
        channel.basicQos(prefetchCount);

        boolean autoAck = false;

        DeliverCallback deliverCallback = (consumerTag, delivery) -> {
            long deliveryTag = delivery.getEnvelope().getDeliveryTag();
            String messageId = delivery.getProperties().getMessageId();
            String body = new String(delivery.getBody(), StandardCharsets.UTF_8);

            try {
                System.out.println("Processing messageId=" + messageId + " body=" + body);

                processBusinessLogic(body);

                channel.basicAck(deliveryTag, false);
                System.out.println("Acked messageId=" + messageId);
            } catch (IllegalArgumentException permanentFailure) {
                System.err.println("Permanent failure messageId=" + messageId + ": " + permanentFailure.getMessage());
                channel.basicNack(deliveryTag, false, false); // dead-letter if DLX configured
            } catch (Exception transientFailure) {
                System.err.println("Transient failure messageId=" + messageId + ": " + transientFailure.getMessage());
                channel.basicNack(deliveryTag, false, true); // requeue; dangerous without policy
            }
        };

        channel.basicConsume(
                RabbitTopology.QUEUE_CASE_ASSIGN_REVIEW,
                autoAck,
                deliverCallback,
                consumerTag -> System.out.println("Consumer cancelled: " + consumerTag)
        );
    }

    private static void processBusinessLogic(String body) {
        if (body == null || body.isBlank()) {
            throw new IllegalArgumentException("Empty body");
        }
        // Simulate business work.
    }
}
```

### 13.1 Ack Decision Table

| Situation | Action | Reason |
|---|---|---|
| Processing succeeded | `basicAck(tag, false)` | remove message from queue |
| Invalid message, cannot ever succeed | `basicNack(tag, false, false)` | send to DLQ or drop if no DLX |
| Temporary downstream failure | usually delayed retry topology, not immediate requeue | avoid hot loop |
| Consumer shutting down before processing | no ack | broker will redeliver |
| Duplicate message already processed | ack | idempotency says work already done |

### 13.2 Immediate Requeue Is Usually Wrong

This line is dangerous:

```java
channel.basicNack(deliveryTag, false, true);
```

It puts message back immediately. If all consumers hit the same error, you create a requeue loop:

```text
broker -> consumer -> fail -> requeue -> broker -> consumer -> fail -> requeue -> ...
```

This burns CPU, network, logs, and downstream dependencies.

Better pattern:

```text
main queue -> consumer fails -> nack requeue=false -> DLX -> retry queue with TTL -> DLX back to main queue
```

Retry topology will be covered deeply in part 09.

---

## 14. Delivery Tag Scope

Delivery tag is not a global message id.

It is scoped to channel.

Wrong mental model:

```text
deliveryTag = unique message id across RabbitMQ
```

Correct mental model:

```text
deliveryTag = monotonically increasing delivery handle on one channel
```

Implication:

- ack on wrong channel fails;
- storing delivery tag in database for later ack is wrong;
- passing delivery tag across unrelated worker threads is dangerous unless ack is coordinated on the same channel;
- message id should come from properties, not delivery tag.

---

## 15. Prefetch as Concurrency Budget

`basicQos(prefetchCount)` limits how many unacked messages broker can send to a consumer/channel.

Example:

```java
channel.basicQos(10);
```

Meaning:

```text
At most 10 unacked deliveries in flight for this consumer/channel context.
```

### 15.1 Why Prefetch Matters

Without a bounded prefetch:

- consumer can receive too many messages;
- slow processing creates large unacked pile;
- broker thinks messages are in progress;
- other consumers may starve;
- shutdown/restart causes large redelivery burst.

### 15.2 Prefetch Tuning Heuristic

For CPU-bound handler:

```text
prefetch ~= worker threads
```

For IO-bound handler:

```text
prefetch ~= worker threads * small multiplier
```

For strict ordering:

```text
prefetch = 1
single consumer or single active consumer
```

For heavy side effects:

```text
start small: 1, 5, 10
measure processing latency, unacked count, downstream saturation
```

### 15.3 Prefetch Is Not Rate Limit

Prefetch controls in-flight unacked messages. It does not directly limit publish rate or end-to-end rate. If processing is fast, consumer can still consume high throughput.

---

## 16. Worker Pool Consumer: The Threading Trap

A common Java instinct:

```text
RabbitMQ callback receives message -> submit to ExecutorService -> ack later from worker thread
```

This can work, but you must respect channel constraints.

### 16.1 Risky Version

```java
DeliverCallback callback = (consumerTag, delivery) -> {
    executor.submit(() -> {
        // process
        channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
    });
};
```

Problems:

- multiple worker threads call `basicAck` on same channel;
- channel operations become concurrent;
- delivery tags may be acked out of order if using multiple=true incorrectly;
- shutdown coordination becomes hard.

### 16.2 Safer Simple Pattern: One Consumer Channel per Worker

Instead of one consumer dispatching to many workers, create multiple consumer instances, each with its own channel.

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

public class MultiChannelWorkerConsumers {

    public static void main(String[] args) throws Exception {
        int workerCount = 4;
        ConnectionFactory factory = RabbitConnectionConfig.createFactory();
        Connection connection = factory.newConnection("case-service:consumer:workers:local");

        for (int i = 0; i < workerCount; i++) {
            Channel channel = connection.createChannel();
            RabbitTopology.declare(channel);
            channel.basicQos(1);

            int workerId = i;
            DeliverCallback callback = (consumerTag, delivery) -> {
                long tag = delivery.getEnvelope().getDeliveryTag();
                try {
                    System.out.println("worker=" + workerId + " processing tag=" + tag);
                    // process message here on the consumer dispatch thread
                    channel.basicAck(tag, false);
                } catch (Exception e) {
                    channel.basicNack(tag, false, false);
                }
            };

            channel.basicConsume(
                    RabbitTopology.QUEUE_CASE_ASSIGN_REVIEW,
                    false,
                    "case-worker-" + workerId,
                    callback,
                    consumerTag -> System.out.println("cancelled " + consumerTag)
            );
        }
    }
}
```

This is not the only valid pattern, but it is easier to reason about.

### 16.3 If You Need ExecutorService

Use a design where channel operations are serialized. For example:

```text
consumer thread receives delivery
  -> worker pool processes payload
  -> completion event goes to ack coordinator
  -> ack coordinator performs ack/nack on channel serially
```

But this is more complex. Prefer framework support or one-channel-per-worker unless you have strong reason.

---

## 17. Publisher Confirms: First Reliable Publisher

`basicPublish` returning normally does not mean message is safely persisted/routed.

Publisher confirms let broker acknowledge published messages to publisher.

Simple synchronous confirm:

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

public class ReliablePublisherSyncConfirm {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = RabbitConnectionConfig.createFactory();

        try (Connection connection = factory.newConnection("case-service:publisher:sync-confirm:local")) {
            try (Channel channel = connection.createChannel()) {
                RabbitTopology.declare(channel);

                channel.confirmSelect();

                String messageId = UUID.randomUUID().toString();
                byte[] body = "{\"caseId\":\"CASE-123\"}".getBytes(StandardCharsets.UTF_8);

                AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
                        .contentType("application/json")
                        .deliveryMode(2)
                        .messageId(messageId)
                        .timestamp(java.util.Date.from(Instant.now()))
                        .build();

                channel.basicPublish(
                        RabbitTopology.EXCHANGE_CASE_COMMANDS,
                        RabbitTopology.ROUTING_ASSIGN_REVIEW,
                        true,
                        props,
                        body
                );

                boolean confirmed = channel.waitForConfirms(5_000);
                if (!confirmed) {
                    throw new IllegalStateException("Message was not confirmed by broker: " + messageId);
                }

                System.out.println("Confirmed messageId=" + messageId);
            }
        }
    }
}
```

### 17.1 What Confirm Means

Confirm means broker accepted responsibility for the publish according to queue/exchange semantics.

But it does not mean:

- consumer processed the message;
- downstream business effect happened;
- message will not be duplicated;
- your DB transaction and publish are atomic.

Confirm is publisher-to-broker reliability. Consumer ack is consumer-to-broker reliability. Business idempotency is application reliability.

### 17.2 Sync Confirm Is Simple but Slow

Waiting after every message is easy but low-throughput.

Better production pattern:

- batch confirms;
- async confirm listener;
- outbox relay;
- retry ambiguous publishes carefully.

Publisher reliability is covered deeper in part 07.

---

## 18. Mandatory Publish and Return Listener

If you publish to an exchange but no queue is bound for the routing key, message can be unroutable.

`mandatory=true` asks broker to return unroutable messages.

Add return listener:

```java
channel.addReturnListener(returned -> {
    System.err.println("Returned message: "
            + "replyCode=" + returned.getReplyCode()
            + ", replyText=" + returned.getReplyText()
            + ", exchange=" + returned.getExchange()
            + ", routingKey=" + returned.getRoutingKey()
            + ", messageId=" + returned.getProperties().getMessageId());
});
```

Important distinction:

```text
publisher confirm says broker handled publish
return listener says message was unroutable
```

You can receive both for the same publish in some cases. Do not treat confirm alone as “business-routed successfully” unless your topology and mandatory/alternate-exchange strategy support that interpretation.

---

## 19. Basic Get vs Basic Consume

RabbitMQ Java Client supports:

```java
GetResponse response = channel.basicGet(queueName, false);
```

This pulls one message.

Use cases:

- debugging;
- admin tools;
- tests;
- very low-frequency polling.

Do not build high-throughput workers with `basicGet` loops.

Prefer `basicConsume`, where broker pushes messages according to consumer availability and prefetch.

---

## 20. Connection Recovery

Automatic recovery helps after connection failures.

Typical setup:

```java
factory.setAutomaticRecoveryEnabled(true);
factory.setTopologyRecoveryEnabled(true);
factory.setNetworkRecoveryInterval(5_000);
```

What can be recovered:

- connection;
- channels;
- exchanges;
- queues;
- bindings;
- consumers.

But recovery has limits.

### 20.1 Recovery Does Not Remove Ambiguity

Scenario:

```text
publisher sends message
broker receives message
network breaks before confirm reaches publisher
publisher reconnects
```

Publisher does not know whether message was accepted. If it republishes, duplicate may occur.

Solution:

- message id;
- outbox state machine;
- idempotent consumer;
- dedupe table if needed.

### 20.2 Recovery Does Not Make Handler Idempotent

Scenario:

```text
consumer receives message
consumer writes DB successfully
connection breaks before ack reaches broker
broker redelivers after recovery
```

Message is processed twice unless consumer is idempotent.

Correct response:

- use business idempotency key;
- commit side effect with processed message id;
- ack duplicate if already processed.

---

## 21. Shutdown Handling

Messaging apps need graceful shutdown.

Bad shutdown:

```text
kill JVM while messages are in progress
```

Result:

- unacked messages redelivered;
- partially completed side effects;
- duplicate processing;
- noisy logs.

Basic graceful pattern:

1. stop accepting new deliveries;
2. cancel consumer;
3. wait for in-flight processing bounded by timeout;
4. ack/nack completed work;
5. close channel;
6. close connection.

Example cancel:

```java
String consumerTag = channel.basicConsume(queue, false, callback, cancelCallback);

Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    try {
        channel.basicCancel(consumerTag);
        channel.close();
        connection.close();
    } catch (Exception e) {
        e.printStackTrace();
    }
}));
```

For serious production service, use lifecycle manager, not ad-hoc shutdown hooks only.

---

## 22. Message Handler Boundary

A good consumer has structure like this:

```text
Rabbit delivery boundary
  -> decode bytes
  -> validate contract
  -> extract metadata
  -> check idempotency
  -> execute business transition
  -> persist result
  -> ack/nack decision
```

Example skeleton:

```java
public final class AssignReviewHandler {

    private final JsonMessageCodec codec = new JsonMessageCodec();
    private final ProcessedMessageRepository processedMessages;
    private final CaseReviewService caseReviewService;

    public AssignReviewHandler(
            ProcessedMessageRepository processedMessages,
            CaseReviewService caseReviewService
    ) {
        this.processedMessages = processedMessages;
        this.caseReviewService = caseReviewService;
    }

    public HandlerResult handle(byte[] body, String messageId) {
        if (messageId == null || messageId.isBlank()) {
            return HandlerResult.permanentFailure("Missing messageId");
        }

        if (processedMessages.alreadyProcessed(messageId)) {
            return HandlerResult.successDuplicate();
        }

        AssignReviewCommand command;
        try {
            command = codec.decode(body, AssignReviewCommand.class);
        } catch (IllegalArgumentException e) {
            return HandlerResult.permanentFailure("Invalid JSON/contract: " + e.getMessage());
        }

        try {
            caseReviewService.assignReview(command, messageId);
            processedMessages.markProcessed(messageId);
            return HandlerResult.success();
        } catch (TemporaryDependencyException e) {
            return HandlerResult.transientFailure(e.getMessage());
        } catch (BusinessRuleViolationException e) {
            return HandlerResult.permanentFailure(e.getMessage());
        }
    }
}
```

Result type:

```java
public sealed interface HandlerResult {

    record Success(boolean duplicate) implements HandlerResult {}
    record TransientFailure(String reason) implements HandlerResult {}
    record PermanentFailure(String reason) implements HandlerResult {}

    static HandlerResult success() {
        return new Success(false);
    }

    static HandlerResult successDuplicate() {
        return new Success(true);
    }

    static HandlerResult transientFailure(String reason) {
        return new TransientFailure(reason);
    }

    static HandlerResult permanentFailure(String reason) {
        return new PermanentFailure(reason);
    }
}
```

Ack decision:

```java
HandlerResult result = handler.handle(delivery.getBody(), messageId);

switch (result) {
    case HandlerResult.Success ignored ->
            channel.basicAck(deliveryTag, false);

    case HandlerResult.PermanentFailure failure ->
            channel.basicNack(deliveryTag, false, false);

    case HandlerResult.TransientFailure failure ->
            channel.basicNack(deliveryTag, false, false); // send to retry/DLQ topology, not immediate requeue
}
```

This keeps business classification separate from RabbitMQ API.

---

## 23. Idempotency at Consumer Side

At-least-once delivery means duplicate delivery is normal.

Duplicate causes:

- consumer crash before ack;
- ack lost due to network failure;
- publisher retry after ambiguous confirm;
- manual replay;
- operator requeue;
- DLQ remediation;
- recovery after failover.

### 23.1 Minimal Idempotency Table

```sql
CREATE TABLE processed_message (
    message_id      VARCHAR(128) PRIMARY KEY,
    consumer_name   VARCHAR(128) NOT NULL,
    processed_at    TIMESTAMP NOT NULL,
    status          VARCHAR(32) NOT NULL
);
```

Better key:

```text
consumer_name + message_id
```

Because one message may be legitimately consumed by multiple logical consumers.

### 23.2 Transaction Boundary

Correct pattern:

```text
begin DB transaction
  if message already processed:
      commit
      ack
      return
  perform business change
  insert processed_message
commit DB transaction
ack RabbitMQ message
```

Failure windows:

| Failure Point | Result | Required Handling |
|---|---|---|
| crash before DB commit | message redelivered | process again |
| crash after DB commit before ack | message redelivered | detect duplicate, ack |
| ack succeeds but DB did not commit | data loss if possible | never ack before durable business commit |

Golden rule:

```text
Do not ack before the side effect you care about is durably committed.
```

---

## 24. Publishing from Database Transaction: The Outbox Problem

Suppose Java service handles HTTP request:

```text
POST /cases/{id}/assign
  -> update database
  -> publish RabbitMQ message
```

Naive code:

```java
caseRepository.assign(caseId, reviewerId);
channel.basicPublish(...);
```

Failure windows:

| Step | Failure | Result |
|---|---|---|
| DB commit succeeds, publish fails | case updated, no message | downstream inconsistent |
| publish succeeds, DB commit fails | message says something happened, DB disagrees | false event |
| publish ambiguous | maybe duplicate | consumer must dedupe |

Solution: transactional outbox.

```text
same DB transaction:
  update case
  insert outbox row

separate relay:
  read unpublished outbox row
  publish to RabbitMQ with confirm
  mark outbox row as published
```

Part 07 will go deep into reliable publishing, but part ini perlu menanam mental model: Java Client cannot make your database transaction and RabbitMQ publish atomic by itself.

---

## 25. Exception Handling Taxonomy

Do not catch `Exception` and blindly requeue.

Classify errors:

### 25.1 Decode/Contract Error

Examples:

- invalid JSON;
- missing required field;
- unsupported schema version;
- invalid enum.

Likely action:

```text
nack requeue=false -> DLQ/parking lot
```

### 25.2 Business Permanent Error

Examples:

- case does not exist and should exist;
- transition forbidden;
- reviewer inactive;
- tenant mismatch.

Likely action depends on domain:

```text
nack requeue=false -> business DLQ
or ack + publish rejection event
```

Do not retry permanent business failures forever.

### 25.3 Temporary Technical Error

Examples:

- database timeout;
- HTTP downstream 503;
- lock timeout;
- broker transient issue.

Likely action:

```text
delayed retry with bounded attempts
```

### 25.4 Unknown Error

Unknown should be treated conservatively:

```text
bounded retry -> DLQ -> investigation
```

Unknown infinite retry is operational negligence.

---

## 26. Logging Discipline

Every consumer log should include:

- message id;
- correlation id;
- routing key;
- exchange;
- queue/consumer name;
- redelivered flag;
- delivery tag for local debugging;
- business key, e.g. case id;
- attempt/retry count if available.

Example:

```java
String messageId = delivery.getProperties().getMessageId();
String correlationId = delivery.getProperties().getCorrelationId();
String routingKey = delivery.getEnvelope().getRoutingKey();
boolean redelivered = delivery.getEnvelope().isRedeliver();

System.out.printf(
        "event=message_received messageId=%s correlationId=%s routingKey=%s redelivered=%s%n",
        messageId,
        correlationId,
        routingKey,
        redelivered
);
```

Do not log full payload blindly. Payload can contain sensitive data, large data, or regulated data.

---

## 27. Connection and Channel Monitoring from Java Perspective

From the application side, track:

- connection open/closed;
- channel shutdown reason;
- consumer cancellation;
- publish confirm latency;
- returned messages;
- handler latency;
- ack/nack count;
- redelivery count;
- decode failure count;
- permanent failure count;
- transient failure count.

Add shutdown listener:

```java
connection.addShutdownListener(cause -> {
    System.err.println("Connection shutdown: " + cause.getMessage());
});

channel.addShutdownListener(cause -> {
    System.err.println("Channel shutdown: " + cause.getMessage());
});
```

In production, these should go into structured logs and metrics, not `System.err`.

---

## 28. TLS Briefly

For production, AMQP should usually use TLS unless network is already strongly isolated and policy permits plaintext.

Typical port:

```text
5671 = AMQPS/TLS
5672 = AMQP plaintext
```

Example shape:

```java
ConnectionFactory factory = new ConnectionFactory();
factory.setHost("rabbitmq.internal");
factory.setPort(5671);
factory.useSslProtocol();
```

Real production TLS usually needs:

- truststore;
- certificate validation;
- hostname verification;
- credential rotation;
- secret management;
- broker cert lifecycle.

Security gets a full part later. Untuk sekarang cukup pahami: connection config adalah security boundary, bukan hanya host/port.

---

## 29. Java Client Design Patterns

### 29.1 Simple CLI Publisher

Use for:

- local test;
- smoke test;
- debugging.

Do not use as production publishing architecture.

### 29.2 Long-Lived Publisher Service

Shape:

```text
application startup
  -> create connection
  -> create publisher channel(s)
  -> enable confirms
  -> publish messages from controlled thread(s)
  -> handle confirms/returns
  -> close gracefully
```

### 29.3 Long-Lived Consumer Worker

Shape:

```text
application startup
  -> create connection
  -> create consumer channel(s)
  -> declare/verify topology
  -> set prefetch
  -> basicConsume manual ack
  -> process idempotently
  -> ack/nack
  -> graceful shutdown
```

### 29.4 Outbox Relay

Shape:

```text
poll unpublished outbox rows
  -> publish with messageId = outbox id
  -> wait for confirm
  -> mark published
```

### 29.5 Inbox Consumer

Shape:

```text
consume message
  -> insert processed_message with unique key
  -> if duplicate: ack
  -> else process and commit
  -> ack
```

---

## 30. Common Mistakes in Java RabbitMQ Client Code

### Mistake 1: Creating Connection per Message

Bad:

```java
for (Message m : messages) {
    Connection c = factory.newConnection();
    Channel ch = c.createChannel();
    ch.basicPublish(...);
    ch.close();
    c.close();
}
```

Impact:

- terrible latency;
- broker resource churn;
- connection storms;
- production instability.

### Mistake 2: Sharing One Channel Across Many Publisher Threads

Bad:

```java
static Channel sharedChannel;
```

Impact:

- protocol errors;
- confirm confusion;
- frame interleaving;
- channel closure.

### Mistake 3: Auto Ack for Important Work

Bad:

```java
channel.basicConsume(queue, true, callback, cancelCallback);
```

Impact:

- message loss on consumer crash.

### Mistake 4: Ack Before Business Commit

Bad:

```java
channel.basicAck(tag, false);
caseRepository.update(...);
```

Impact:

- message removed but business update may fail.

### Mistake 5: Infinite Requeue

Bad:

```java
catch (Exception e) {
    channel.basicNack(tag, false, true);
}
```

Impact:

- hot retry loop;
- broker/consumer/downstream overload.

### Mistake 6: Missing Message ID

Bad:

```java
new AMQP.BasicProperties.Builder().build();
```

Impact:

- hard idempotency;
- poor audit;
- poor tracing.

### Mistake 7: Treating Publisher Confirm as Consumer Success

Wrong:

```text
confirmed publish = business process completed
```

Correct:

```text
confirmed publish = broker accepted publish
```

### Mistake 8: Ignoring Returned Messages

If `mandatory=true` but no return listener, you may miss unroutable messages.

### Mistake 9: Relying on Auto Recovery as Correctness

Auto recovery reconnects. It does not solve duplicate side effects.

### Mistake 10: No Graceful Shutdown

Impact:

- redelivery spikes;
- duplicate processing;
- messy deployments.

---

## 31. A More Complete No-Spring Consumer Example

This example intentionally remains framework-free but separates concerns.

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.*;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

public final class ProductionShapedConsumer {

    private final ConnectionFactory factory;
    private final AtomicBoolean running = new AtomicBoolean(true);

    public ProductionShapedConsumer(ConnectionFactory factory) {
        this.factory = factory;
    }

    public void start() throws Exception {
        Connection connection = factory.newConnection("case-service:consumer:assign-review:local");
        Channel channel = connection.createChannel();

        connection.addShutdownListener(cause ->
                System.err.println("connection_shutdown reason=" + cause.getMessage())
        );
        channel.addShutdownListener(cause ->
                System.err.println("channel_shutdown reason=" + cause.getMessage())
        );

        RabbitTopology.declare(channel);
        channel.basicQos(10);

        DeliverCallback callback = (consumerTag, delivery) -> {
            long tag = delivery.getEnvelope().getDeliveryTag();
            AMQP.BasicProperties props = delivery.getProperties();
            String messageId = props.getMessageId();
            String correlationId = props.getCorrelationId();
            boolean redelivered = delivery.getEnvelope().isRedeliver();

            if (!running.get()) {
                channel.basicNack(tag, false, true);
                return;
            }

            try {
                validateMetadata(messageId);

                String payload = new String(delivery.getBody(), StandardCharsets.UTF_8);

                System.out.printf(
                        "event=processing messageId=%s correlationId=%s redelivered=%s payload=%s%n",
                        messageId,
                        correlationId,
                        redelivered,
                        payload
                );

                // Replace with idempotent transactional business logic.
                process(payload, messageId);

                channel.basicAck(tag, false);

                System.out.printf("event=acked messageId=%s%n", messageId);
            } catch (PermanentMessageException e) {
                System.err.printf("event=permanent_failure messageId=%s reason=%s%n", messageId, e.getMessage());
                channel.basicNack(tag, false, false);
            } catch (Exception e) {
                System.err.printf("event=transient_or_unknown_failure messageId=%s reason=%s%n", messageId, e.getMessage());
                channel.basicNack(tag, false, false); // assume DLX/retry topology exists
            }
        };

        CancelCallback cancelCallback = consumerTag ->
                System.err.println("consumer_cancelled consumerTag=" + consumerTag);

        String consumerTag = channel.basicConsume(
                RabbitTopology.QUEUE_CASE_ASSIGN_REVIEW,
                false,
                "case-service.assign-review.local",
                callback,
                cancelCallback
        );

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            running.set(false);
            try {
                channel.basicCancel(consumerTag);
                channel.close();
                connection.close();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }));
    }

    private void validateMetadata(String messageId) {
        if (messageId == null || messageId.isBlank()) {
            throw new PermanentMessageException("Missing messageId");
        }
    }

    private void process(String payload, String messageId) {
        if (payload == null || payload.isBlank()) {
            throw new PermanentMessageException("Empty payload");
        }
        // Idempotent business transaction goes here.
    }

    public static void main(String[] args) throws Exception {
        new ProductionShapedConsumer(RabbitConnectionConfig.createFactory()).start();
        Thread.currentThread().join();
    }

    static final class PermanentMessageException extends RuntimeException {
        PermanentMessageException(String message) {
            super(message);
        }
    }
}
```

This is still not a full production framework, but it has the correct shape:

- long-lived connection;
- channel per consumer;
- manual ack;
- prefetch;
- metadata validation;
- failure classification;
- no immediate infinite requeue;
- shutdown hook;
- consumer tag;
- connection/channel shutdown logging.

---

## 32. A More Complete No-Spring Publisher Example

```java
package dev.example.rabbit.lab;

import com.rabbitmq.client.*;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public final class ProductionShapedPublisher {

    private final ConnectionFactory factory;

    public ProductionShapedPublisher(ConnectionFactory factory) {
        this.factory = factory;
    }

    public void publishAssignReview(String caseId, String reviewerId) throws Exception {
        try (Connection connection = factory.newConnection("case-service:publisher:assign-review:local")) {
            try (Channel channel = connection.createChannel()) {
                RabbitTopology.declare(channel);
                channel.confirmSelect();

                channel.addReturnListener(returned -> {
                    String messageId = returned.getProperties().getMessageId();
                    System.err.printf(
                            "event=message_returned messageId=%s replyCode=%s replyText=%s exchange=%s routingKey=%s%n",
                            messageId,
                            returned.getReplyCode(),
                            returned.getReplyText(),
                            returned.getExchange(),
                            returned.getRoutingKey()
                    );
                });

                String messageId = UUID.randomUUID().toString();
                String correlationId = UUID.randomUUID().toString();
                String payload = "{\"caseId\":\"" + caseId + "\",\"reviewerId\":\"" + reviewerId + "\"}";

                AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
                        .contentType("application/json")
                        .contentEncoding("utf-8")
                        .deliveryMode(2)
                        .messageId(messageId)
                        .correlationId(correlationId)
                        .type("case.assign-review.command.v1")
                        .appId("case-service")
                        .headers(Map.of(
                                "schema_version", "1",
                                "published_by", "ProductionShapedPublisher"
                        ))
                        .timestamp(java.util.Date.from(Instant.now()))
                        .build();

                channel.basicPublish(
                        RabbitTopology.EXCHANGE_CASE_COMMANDS,
                        RabbitTopology.ROUTING_ASSIGN_REVIEW,
                        true,
                        props,
                        payload.getBytes(StandardCharsets.UTF_8)
                );

                channel.waitForConfirmsOrDie(5_000);

                System.out.printf("event=message_confirmed messageId=%s correlationId=%s%n", messageId, correlationId);
            }
        }
    }

    public static void main(String[] args) throws Exception {
        new ProductionShapedPublisher(RabbitConnectionConfig.createFactory())
                .publishAssignReview("CASE-123", "USR-7");
    }
}
```

Caveat: this opens connection per call for simplicity. In a real service, keep connection/channel lifecycle outside each publish operation. The example is shaped for readability, not throughput.

Better production publisher service:

```text
start once
  -> open connection
  -> create publisher channel
  -> enable confirms
  -> publish many messages
  -> close on shutdown
```

---

## 33. Production Invariants for Java Client

Keep these invariants visible in code review.

### 33.1 Connection/Channel Invariants

```text
Connection is long-lived.
Channel is not shared recklessly across threads.
Ack happens on the same channel as delivery.
Channel lifecycle is explicit.
Connection has identifiable name.
Shutdown is graceful.
```

### 33.2 Publisher Invariants

```text
Important publishes use confirms.
Unroutable messages are handled.
Message has id/correlation/type/content metadata.
Publish is not assumed atomic with DB commit.
Ambiguous publish outcome is expected and handled.
```

### 33.3 Consumer Invariants

```text
Important consumers use manual ack.
Ack after durable side effect.
Duplicate delivery is normal.
Handler is idempotent.
Failures are classified.
Immediate requeue is avoided for repeated failures.
Prefetch is bounded.
```

### 33.4 Contract Invariants

```text
Message body is explicit contract.
Producer does not publish internal entity.
Consumer tolerates compatible evolution.
Message type/version is visible.
Sensitive data is controlled.
```

---

## 34. RabbitMQ Java Client vs Spring AMQP

Why learn raw Java Client if Spring exists?

Because Spring AMQP hides details that still matter:

| Raw Concept | Spring Abstraction |
|---|---|
| `ConnectionFactory` | `CachingConnectionFactory` |
| `Channel` | hidden/channel cache |
| `basicPublish` | `RabbitTemplate` |
| `basicConsume` | listener container |
| manual ack | `AcknowledgeMode.MANUAL` |
| return listener | returns callback |
| publisher confirms | confirm callback |
| topology declare | `Declarables`, `RabbitAdmin` |
| consumer exception | error handler/retry interceptor |

If you do not understand raw concepts, Spring behavior feels magical. If you do understand them, Spring becomes an accelerant.

---

## 35. Design Review Questions

When reviewing Java RabbitMQ code, ask:

1. How many connections does the service open?
2. How many channels?
3. Are channels shared across threads?
4. Does publisher use confirms?
5. What happens if publish succeeds but DB commit fails?
6. What happens if DB commit succeeds but publish fails?
7. What happens if confirm is lost?
8. Does consumer use manual ack?
9. Is ack after durable side effect?
10. What happens if consumer crashes after DB commit before ack?
11. Is handler idempotent?
12. What is the idempotency key?
13. What is prefetch?
14. What happens on permanent message failure?
15. What happens on transient downstream failure?
16. Is immediate requeue possible?
17. Is DLQ configured?
18. Are returned messages handled?
19. Are message metadata fields sufficient?
20. Is shutdown graceful?
21. Are connection/channel shutdowns logged?
22. Can operations identify connection names in Management UI?
23. Is topology declared in app, IaC, or separately?
24. What happens if topology declaration conflicts with existing broker state?
25. Is payload contract decoupled from persistence model?

---

## 36. Mini Lab Exercises

### Exercise 1: Connection Name Visibility

Run a Java app with named connection. Open Management UI and verify connection name appears.

Expected learning:

```text
Connection names are operational metadata.
```

### Exercise 2: Auto Ack Crash

1. Consume with `autoAck=true`.
2. In callback, print message then crash JVM before processing.
3. Observe message is gone.

Expected learning:

```text
Auto ack can lose important work.
```

### Exercise 3: Manual Ack Crash

1. Consume with `autoAck=false`.
2. Receive message.
3. Crash before ack.
4. Restart consumer.

Expected learning:

```text
Unacked message is redelivered.
```

### Exercise 4: Prefetch

1. Set prefetch 1.
2. Run two consumers.
3. Make handler sleep 10 seconds.
4. Publish 10 messages.

Expected learning:

```text
Prefetch controls in-flight distribution.
```

### Exercise 5: Unroutable Mandatory Publish

1. Publish to direct exchange using wrong routing key.
2. Use `mandatory=true`.
3. Add return listener.

Expected learning:

```text
Publisher must handle unroutable messages explicitly.
```

### Exercise 6: Channel Conflict

1. Declare queue as classic.
2. Redeclare same queue as quorum.
3. Observe channel exception.

Expected learning:

```text
Topology declaration is a contract, not migration.
```

---

## 37. Part 06 Summary

The RabbitMQ Java Client is small but semantically dense.

Core lessons:

1. Use long-lived connections.
2. Use channels carefully; avoid sharing channel across threads.
3. Manual ack is required for important consumers.
4. Ack after durable business side effect.
5. Publisher confirms are required for important publishers.
6. Mandatory publish/return handling matters for routing correctness.
7. Prefetch is your in-flight work budget.
8. Delivery tag is channel-scoped, not a message id.
9. Automatic recovery helps transport resilience but not application correctness.
10. Duplicate delivery is normal under at-least-once messaging.
11. Idempotency is not optional in serious systems.
12. Message metadata is part of the contract.
13. Java code should separate transport handling from business handling.
14. No-Spring understanding makes Spring AMQP much easier later.

---

## 38. What Comes Next

Next part:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-07.md
```

Topic:

```text
Publisher Reliability: Confirms, Returns, Mandatory, Idempotent Publish
```

We will go deeper into:

- synchronous confirms;
- batch confirms;
- asynchronous confirms;
- confirm sequence numbers;
- handling nack;
- handling returned messages;
- retrying ambiguous publishes;
- outbox relay;
- idempotent publish design;
- publisher failure state machine.

---

## 39. Status Seri

Seri belum selesai.

Progress saat ini:

```text
part-00 selesai
part-01 selesai
part-02 selesai
part-03 selesai
part-04 selesai
part-05 selesai
part-06 selesai
```

Sisa berikutnya:

```text
part-07 sampai part-34
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-05.md">⬅️ Part 05 — Hands-on Local Lab: Docker, Management UI, CLI, Definitions</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-07.md">Part 07 — Publisher Reliability: Confirms, Returns, Mandatory, Idempotent Publish ➡️</a>
</div>

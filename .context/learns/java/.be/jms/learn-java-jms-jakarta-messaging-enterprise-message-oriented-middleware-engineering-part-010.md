# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-010
# Part 10 — Transaction Model: Local JMS Transaction, JTA/XA, 2PC, Outbox, dan Trade-off Konsistensi

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Target pembaca: engineer Java backend / enterprise engineer yang ingin memahami JMS/Jakarta Messaging sampai level arsitektur, runtime, failure modelling, dan production defensibility.  
> Target Java: Java 8 sampai Java 25.  
> Fokus part ini: transaksi, atomicity, acknowledgement boundary, DB + JMS consistency, XA/2PC, outbox/inbox, dan trade-off engineering.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 9, kita sudah memahami:

1. JMS/Jakarta Messaging sebagai kontrak koordinasi asinkron.
2. Evolusi `javax.jms` ke `jakarta.jms`.
3. Domain object: `Connection`, `Session`, `JMSContext`, producer, consumer, destination.
4. Queue semantics.
5. Topic semantics.
6. Anatomy message: header, property, body.
7. Message types.
8. Producer engineering.
9. Consumer engineering.
10. Acknowledgement semantics.

Part 10 ini masuk ke inti yang lebih berbahaya:

> Bagaimana memastikan operasi messaging dan side effect bisnis memiliki batas konsistensi yang jelas?

Dalam sistem sederhana, pertanyaan ini terlihat mudah:

> "Consumer menerima message, update database, lalu ack message."

Namun di production, ada banyak failure window:

- message sudah diterima tetapi database gagal;
- database sudah commit tetapi ack gagal;
- ack berhasil tetapi side effect belum selesai;
- producer berhasil insert database tetapi gagal publish message;
- producer berhasil publish message tetapi database rollback;
- transaction manager crash;
- broker failover;
- redelivery terjadi setelah commit;
- duplicate message memukul operasi non-idempotent;
- retry menyebabkan side effect ganda;
- XA coordinator timeout;
- prepared transaction tertahan;
- DLQ berisi message yang sebenarnya sudah sebagian diproses.

Bagian ini tidak hanya membahas API `commit()` dan `rollback()`, tetapi membangun cara berpikir:

> Messaging transaction bukan sekadar mekanisme teknis. Ia adalah kontrak konsistensi antara message broker, aplikasi, database, dan efek bisnis.

---

## 1. Premis Utama: Message Processing Selalu Punya Dua Dunia

Setiap sistem JMS production biasanya melibatkan minimal dua dunia:

```text
World A: Messaging world
- message delivery
- receive
- ack
- redelivery
- send
- commit/rollback JMS session
- broker persistence

World B: Business side-effect world
- database insert/update
- HTTP call
- file write
- email send
- cache update
- audit log
- state transition
- external API call
```

Masalahnya:

> JMS bisa mengatur transaksi di dunia messaging, tetapi tidak otomatis membuat semua side effect eksternal menjadi atomic.

Contoh:

```text
Consumer:
1. Receive message PaymentApproved
2. Insert settlement record ke database
3. Send email ke customer
4. Acknowledge message
```

Apa yang terjadi jika aplikasi crash setelah step 2 tetapi sebelum step 4?

```text
Database:
- settlement record sudah commit

Broker:
- message belum ack

Result:
- message akan dikirim ulang
```

Jika handler tidak idempotent, settlement bisa dibuat dua kali.

Maka transaction model harus menjawab:

1. Apa unit atomic yang benar?
2. Side effect mana yang bisa diulang?
3. Side effect mana yang tidak boleh diulang?
4. Kapan message boleh dianggap selesai?
5. Bagaimana sistem recover setelah crash?
6. Bagaimana operator tahu status final?
7. Bagaimana replay dilakukan tanpa merusak data?

---

## 2. Tiga Level Transaction Thinking

Untuk memahami JMS transaction, gunakan tiga level berikut.

### Level 1 — Local Messaging Transaction

Hanya broker/JMS session yang masuk transaksi.

```text
JMS session transaction:
- receive message A
- send message B
- commit

Effect:
- A acknowledged
- B becomes visible/sent
```

Ini menjaga atomicity di dalam messaging provider.

Tidak otomatis meng-commit database.

---

### Level 2 — Local Application Transaction

Aplikasi menggunakan database transaction dan JMS transaction secara terpisah.

```text
DB transaction:
- update order
- insert audit row
- commit

JMS transaction:
- acknowledge input message
- send next message
- commit
```

Masalahnya: ada dua commit yang tidak atomic bersama.

```text
DB commit succeeds
JMS commit fails

or

JMS commit succeeds
DB commit fails
```

Ini menciptakan split-brain state antara database dan broker.

---

### Level 3 — Distributed Transaction

Database dan broker dikoordinasikan oleh transaction manager melalui XA/2PC.

```text
Global transaction:
- DB branch
- JMS branch
- prepare DB
- prepare JMS
- commit DB
- commit JMS
```

Secara teori, ini memberi atomicity lintas resource manager.

Namun secara operasional, ini membawa biaya:

- latency lebih tinggi;
- locking lebih lama;
- coordinator menjadi komponen kritikal;
- prepared transaction bisa tertahan;
- recovery lebih kompleks;
- vendor compatibility penting;
- observability lebih sulit;
- timeout harus benar;
- failure mode lebih rumit.

---

## 3. Local JMS Transaction

Dalam JMS/Jakarta Messaging, sebuah session dapat dibuat sebagai transacted session.

Secara mental:

```text
Transacted Session = satu stream operasi messaging yang harus di-commit atau rollback sebagai unit.
```

Transacted session bisa mencakup:

- menerima message;
- acknowledge message yang diterima;
- mengirim message baru;
- rollback receive/send operation;
- commit receive/send operation.

Representasi konseptual:

```text
Session transaction T1:
  receive M1
  receive M2
  send M3
  send M4
commit T1

Effect after commit:
  M1 and M2 acknowledged
  M3 and M4 become committed/sent
```

Jika rollback:

```text
Session transaction T1:
  receive M1
  send M2
rollback T1

Effect:
  M1 not acknowledged, eligible for redelivery
  M2 not committed/sent
```

Jakarta Messaging API mendokumentasikan bahwa transacted session mengelompokkan message sends dan receives menjadi atomic unit; ketika commit, input yang diterima diacknowledge dan output yang dikirim menjadi committed. Sumber resmi Jakarta juga menekankan konsep `Session` sebagai single-threaded context untuk sending/receiving, sedangkan `JMSContext` adalah simplified API yang tetap membawa konsep connection + session.

---

## 4. API Model: Classic JMS 1.1 Style

Pada Java 8 legacy enterprise application, Anda masih sering menemukan `javax.jms`.

Contoh conceptual classic API:

```java
Connection connection = null;
Session session = null;

try {
    connection = connectionFactory.createConnection();
    session = connection.createSession(true, Session.SESSION_TRANSACTED);

    Queue inputQueue = session.createQueue("ORDER.IN");
    Queue outputQueue = session.createQueue("ORDER.OUT");

    MessageConsumer consumer = session.createConsumer(inputQueue);
    MessageProducer producer = session.createProducer(outputQueue);

    connection.start();

    Message input = consumer.receive(5_000L);
    if (input == null) {
        session.rollback();
        return;
    }

    String orderId = input.getStringProperty("orderId");

    TextMessage output = session.createTextMessage(
        "{\"eventType\":\"OrderProcessed\",\"orderId\":\"" + orderId + "\"}"
    );

    producer.send(output);

    session.commit();
} catch (Exception ex) {
    if (session != null) {
        try {
            session.rollback();
        } catch (JMSException rollbackError) {
            ex.addSuppressed(rollbackError);
        }
    }
    throw ex;
} finally {
    if (session != null) {
        try {
            session.close();
        } catch (JMSException ignored) {
            // log in real system
        }
    }
    if (connection != null) {
        try {
            connection.close();
        } catch (JMSException ignored) {
            // log in real system
        }
    }
}
```

### Hal penting

`Session.SESSION_TRANSACTED` pada transacted session membuat acknowledgement mode biasa tidak relevan.

Yang mengendalikan finalitas adalah:

```java
session.commit();
session.rollback();
```

Bukan:

```java
message.acknowledge();
```

---

## 5. API Model: JMS 2.0 / Jakarta Messaging Style

Dengan JMS 2.0 dan Jakarta Messaging, kita punya simplified API `JMSContext`.

Contoh Jakarta style:

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED)) {
    Queue inputQueue = context.createQueue("ORDER.IN");
    Queue outputQueue = context.createQueue("ORDER.OUT");

    JMSConsumer consumer = context.createConsumer(inputQueue);

    Message input = consumer.receive(5_000L);
    if (input == null) {
        context.rollback();
        return;
    }

    String orderId = input.getStringProperty("orderId");

    String payload = """
        {"eventType":"OrderProcessed","orderId":"%s"}
        """.formatted(orderId);

    TextMessage output = context.createTextMessage(payload);

    context.createProducer().send(outputQueue, output);

    context.commit();
} catch (JMSRuntimeException ex) {
    throw ex;
}
```

Untuk Java 8, jangan gunakan text block dan `formatted()`:

```java
String payload =
    "{\"eventType\":\"OrderProcessed\",\"orderId\":\"" + orderId + "\"}";
```

### Mental model

```text
JMSContext = simplified connection/session facade
SESSION_TRANSACTED = local JMS transaction
commit() = acknowledge consumed input + commit produced output
rollback() = redeliver input + discard produced output
```

---

## 6. Apa yang Dijamin Local JMS Transaction?

Local JMS transaction menjamin atomicity hanya dalam broker/JMS provider.

Contoh aman:

```text
Receive from Q1
Send to Q2
Commit JMS session
```

Jika commit berhasil:

```text
M1 dari Q1 tidak dikirim ulang
M2 ke Q2 tersedia
```

Jika rollback:

```text
M1 akan redelivery
M2 tidak tersedia
```

Ini berguna untuk pipeline internal messaging:

```text
RAW.ORDER.IN
   -> validate
VALID.ORDER.IN
   -> enrich
ENRICHED.ORDER.IN
   -> persist
```

Jika satu tahap gagal, message bisa tetap berada di tahap sebelumnya.

---

## 7. Apa yang Tidak Dijamin Local JMS Transaction?

Local JMS transaction tidak otomatis membuat operasi ini atomic:

- database commit;
- REST API call;
- gRPC call;
- file write;
- email delivery;
- cache write;
- Elasticsearch indexing;
- S3 upload;
- payment gateway call;
- audit trail di database lain;
- third-party system mutation.

Contoh bahaya:

```java
try (JMSContext context = cf.createContext(JMSContext.SESSION_TRANSACTED)) {
    Message msg = context.createConsumer(queue).receive();

    orderRepository.markPaid(orderId); // DB commit happens here

    context.commit(); // JMS commit happens later
}
```

Failure window:

```text
DB commit succeeded
Application crashed before JMS commit

Result:
- business state changed
- message redelivered
```

Ini bukan bug broker. Ini desain boundary yang belum lengkap.

---

## 8. Failure Window Paling Penting: DB Commit Before JMS Commit

Skenario:

```text
1. Consumer receives message M1
2. Consumer updates DB
3. DB commit succeeds
4. App crashes before JMS commit
5. Broker redelivers M1
```

Result:

```text
DB side effect may happen twice
```

Jika operation:

```sql
UPDATE account SET balance = balance - 100 WHERE id = ?
```

maka duplicate sangat berbahaya.

Jika operation:

```sql
UPDATE order
SET status = 'PAID'
WHERE id = ?
  AND status = 'PENDING'
```

maka lebih aman karena state transition idempotent.

### Invariant

> Jika DB commit dilakukan sebelum JMS ack/commit, handler harus aman terhadap redelivery.

---

## 9. Failure Window Sebaliknya: JMS Commit Before DB Commit

Skenario:

```text
1. Consumer receives M1
2. Consumer performs business logic
3. JMS commit succeeds
4. App crashes before DB commit
```

Result:

```text
Message considered done
DB state not updated
No redelivery
Work lost
```

Ini sering lebih buruk daripada duplicate.

### Invariant

> Jangan acknowledge/commit message sebelum durable side effect utama aman.

Maka pola umum consumer:

```text
receive message
validate
start DB transaction
perform idempotent state transition
commit DB
commit/ack JMS
```

Tetapi seperti kita lihat, ini masih menyisakan duplicate window.

Karena itu, idempotency tetap wajib.

---

## 10. Dual-Write Problem

Producer side juga punya problem yang sama.

Contoh use case:

```text
HTTP request:
- create order in DB
- publish OrderCreated message
- return success
```

Naive implementation:

```java
@Transactional
public void createOrder(CreateOrderRequest request) {
    orderRepository.insert(order);
    jmsTemplate.convertAndSend("ORDER.CREATED", event);
}
```

Terlihat rapi, tetapi pertanyaannya:

> Apakah database transaction dan JMS send benar-benar atomic bersama?

Jika tidak memakai XA/JTA yang benar, maka ini adalah dual-write problem.

Failure matrix:

| Step | DB Insert | JMS Publish | Result |
|---|---:|---:|---|
| DB fail before publish | no | no | safe |
| DB commit success, publish fail | yes | no | order exists, no event |
| Publish success, DB rollback | no | yes | event references missing order |
| App crash between DB and JMS | maybe | maybe | inconsistent |
| Retry HTTP request | maybe duplicate DB | maybe duplicate event | depends on idempotency |

### Mental model

> Dual-write terjadi ketika satu business action harus mengubah dua durable systems tanpa atomic coordinator atau reconciliation pattern.

---

## 11. Solusi 1: XA / JTA / Two-Phase Commit

Distributed transaction mencoba membuat beberapa resource commit/rollback bersama.

Komponen:

```text
Application
  -> Transaction Manager
      -> Resource Manager 1: Database
      -> Resource Manager 2: JMS Broker
```

Resource manager harus mendukung XA.

Flow 2PC:

```text
Phase 1: Prepare
- transaction manager asks DB: can you commit?
- transaction manager asks JMS: can you commit?
- each resource writes enough recovery state and answers yes/no

Phase 2: Commit/Rollback
- if all yes: commit all
- if any no: rollback all
```

Representasi:

```text
BEGIN GLOBAL TX
  DB: insert order
  JMS: send OrderCreated
PREPARE DB
PREPARE JMS
COMMIT DB
COMMIT JMS
END GLOBAL TX
```

### Kapan XA masuk akal?

XA masuk akal ketika:

- atomicity lintas resource benar-benar wajib;
- resource count sedikit;
- latency masih acceptable;
- runtime/container mendukung dengan baik;
- team paham recovery;
- transaction manager reliable;
- observability cukup;
- operator tahu cara menangani in-doubt transaction;
- vendor matrix sudah diuji;
- traffic pattern tidak ekstrem;
- failure mode lebih baik daripada eventual consistency.

Contoh domain:

```text
Regulated financial posting where DB state and guaranteed queue update must not diverge.
```

Namun bahkan di financial system modern, banyak sistem tetap memilih outbox/inbox karena operational simplicity dan replayability.

---

## 12. XA Bukan Silver Bullet

XA sering gagal bukan karena konsepnya salah, tetapi karena biaya operasionalnya tinggi.

### Masalah umum XA

1. **Latency lebih tinggi**  
   Ada prepare + commit roundtrip.

2. **Lock lebih lama**  
   Resource mungkin menahan lock sampai global transaction selesai.

3. **Coordinator dependency**  
   Transaction manager menjadi komponen penting untuk recovery.

4. **In-doubt transaction**  
   Resource sudah prepare tetapi belum tahu apakah harus commit atau rollback.

5. **Heuristic outcome**  
   Dalam kasus ekstrem, resource bisa mengambil keputusan unilateral.

6. **Timeout mismatch**  
   DB timeout, JMS timeout, transaction manager timeout, dan application timeout bisa tidak sinkron.

7. **Cloud/container complexity**  
   Stateless pod + transaction recovery log + restart + storage harus dirancang serius.

8. **Vendor behavior differences**  
   XA support tidak selalu identik antar provider.

9. **Debugging susah**  
   Engineer harus membaca log aplikasi, TM, DB, broker, dan recovery state.

10. **Throughput turun**  
    Terutama untuk high-volume messaging.

### Heuristik

> XA membeli atomicity dengan membayar complexity, latency, dan recovery burden.

---

## 13. Solusi 2: Transactional Outbox

Transactional outbox adalah pattern yang paling sering dipakai untuk menyelesaikan dual-write producer side tanpa XA.

Alih-alih:

```text
DB commit
JMS publish
```

Kita lakukan:

```text
DB transaction:
- insert/update business table
- insert event into outbox table
commit DB transaction

Background relay:
- read outbox
- publish to JMS
- mark outbox as published
```

Diagram:

```text
HTTP Request
   |
   v
Application Service
   |
   |-- DB transaction ----------------------------|
   |   insert ORDER                              |
   |   insert OUTBOX_EVENT(OrderCreated)         |
   |---------------------------------------------|
   |
   v
Return success

Outbox Relay
   |
   v
Read OUTBOX_EVENT where status = NEW
   |
   v
Publish to JMS
   |
   v
Mark OUTBOX_EVENT as PUBLISHED
```

### Kenapa ini kuat?

Karena database state dan outbox event berada dalam satu DB transaction.

```text
Jika order commit, event intent juga commit.
Jika order rollback, event intent juga rollback.
```

JMS publish boleh gagal, tetapi event tidak hilang karena masih ada di outbox.

---

## 14. Outbox Table Design

Contoh schema minimal:

```sql
CREATE TABLE outbox_event (
    id                VARCHAR2(64) PRIMARY KEY,
    aggregate_type    VARCHAR2(100) NOT NULL,
    aggregate_id      VARCHAR2(100) NOT NULL,
    event_type        VARCHAR2(150) NOT NULL,
    event_version     NUMBER(10) NOT NULL,
    destination_name  VARCHAR2(200) NOT NULL,
    destination_type  VARCHAR2(20) NOT NULL,
    payload           CLOB NOT NULL,
    headers_json      CLOB,
    status            VARCHAR2(30) NOT NULL,
    attempt_count     NUMBER(10) DEFAULT 0 NOT NULL,
    next_attempt_at   TIMESTAMP,
    published_at      TIMESTAMP,
    created_at        TIMESTAMP NOT NULL,
    updated_at        TIMESTAMP NOT NULL
);
```

Index:

```sql
CREATE INDEX idx_outbox_event_polling
ON outbox_event (status, next_attempt_at, created_at);

CREATE INDEX idx_outbox_event_aggregate
ON outbox_event (aggregate_type, aggregate_id, created_at);
```

### Field penting

| Field | Fungsi |
|---|---|
| `id` | stable event id / idempotency key |
| `aggregate_type` | misalnya `Order`, `Case`, `Appeal` |
| `aggregate_id` | entity id |
| `event_type` | semantic event name |
| `event_version` | contract version |
| `destination_name` | JMS queue/topic target |
| `destination_type` | queue/topic |
| `payload` | serialized event |
| `headers_json` | correlation/trace metadata |
| `status` | NEW/PUBLISHING/PUBLISHED/FAILED |
| `attempt_count` | retry tracking |
| `next_attempt_at` | backoff |
| `published_at` | audit |
| `created_at` | ordering/replay |
| `updated_at` | operational state |

---

## 15. Outbox Write Example

```java
@Transactional
public String submitOrder(SubmitOrderCommand command) {
    Order order = Order.create(command);
    orderRepository.insert(order);

    OutboxEvent event = OutboxEvent.newEvent(
        UUID.randomUUID().toString(),
        "Order",
        order.id(),
        "OrderSubmitted",
        1,
        "ORDER.EVENTS",
        "TOPIC",
        json.serialize(new OrderSubmittedEvent(order.id(), order.customerId())),
        headers(command.correlationId())
    );

    outboxRepository.insert(event);

    return order.id();
}
```

### Invariant

> Jangan publish JMS langsung di dalam business transaction kecuali benar-benar berada di managed XA transaction yang sudah dibuktikan.

Dengan outbox:

```text
Business mutation + event intent = atomic
Actual publishing = asynchronous, retryable, observable
```

---

## 16. Outbox Relay Example

```java
public final class OutboxRelay implements Runnable {

    private final OutboxRepository outboxRepository;
    private final ConnectionFactory connectionFactory;

    public OutboxRelay(
        OutboxRepository outboxRepository,
        ConnectionFactory connectionFactory
    ) {
        this.outboxRepository = outboxRepository;
        this.connectionFactory = connectionFactory;
    }

    @Override
    public void run() {
        List<OutboxEvent> events = outboxRepository.lockNextBatch(100);

        try (JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED)) {
            for (OutboxEvent event : events) {
                try {
                    Destination destination = resolveDestination(context, event);

                    TextMessage message = context.createTextMessage(event.payload());
                    message.setJMSCorrelationID(event.correlationId());
                    message.setStringProperty("eventId", event.id());
                    message.setStringProperty("eventType", event.eventType());
                    message.setStringProperty("aggregateType", event.aggregateType());
                    message.setStringProperty("aggregateId", event.aggregateId());
                    message.setIntProperty("eventVersion", event.eventVersion());

                    context.createProducer().send(destination, message);

                    outboxRepository.markPublished(event.id());
                } catch (Exception ex) {
                    outboxRepository.markFailedAttempt(event.id(), ex);
                }
            }

            context.commit();
        } catch (Exception ex) {
            // If JMS commit failed, some DB markPublished decisions may be wrong
            // unless DB updates are coordinated carefully.
            // See next section.
            throw ex;
        }
    }

    private Destination resolveDestination(JMSContext context, OutboxEvent event) {
        if ("QUEUE".equals(event.destinationType())) {
            return context.createQueue(event.destinationName());
        }
        if ("TOPIC".equals(event.destinationType())) {
            return context.createTopic(event.destinationName());
        }
        throw new IllegalArgumentException("Unsupported destination type: " + event.destinationType());
    }
}
```

Kode di atas terlihat sederhana, tetapi masih punya bug desain penting.

Problem:

```text
markPublished(event.id()) bisa commit ke DB sebelum JMS transaction commit.
```

Jika DB update `PUBLISHED` commit tetapi JMS commit gagal, event hilang dari relay.

Maka relay harus didesain dengan hati-hati.

---

## 17. Correct Outbox Relay State Machine

State machine lebih aman:

```text
NEW
  -> PUBLISHING
  -> PUBLISHED

NEW
  -> PUBLISHING
  -> FAILED_RETRYABLE
  -> NEW

NEW
  -> PUBLISHING
  -> FAILED_FINAL
```

Tapi status `PUBLISHED` sebaiknya hanya final setelah send benar-benar dianggap berhasil.

Ada beberapa strategi:

---

### Strategy A — Publish One Event per Local JMS Transaction

```text
For each event:
  DB: lock event as PUBLISHING
  JMS: publish event
  JMS: commit
  DB: mark PUBLISHED
```

Failure window:

```text
JMS commit success
DB mark PUBLISHED fails
```

Result:

```text
Event will be retried and may be published duplicate.
```

Ini acceptable jika consumer idempotent.

Kelebihan:

- simple;
- no event loss;
- duplicate possible;
- high safety.

Kekurangan:

- throughput lebih rendah;
- butuh idempotent consumer.

---

### Strategy B — Batch Publish with Idempotent Consumer

```text
DB: lock batch as PUBLISHING
JMS: publish all
JMS: commit
DB: mark batch PUBLISHED
```

Failure window:

```text
JMS commit success
DB mark batch PUBLISHED fails
```

Result:

```text
Batch may be republished duplicate.
```

Again acceptable if consumer idempotent.

---

### Strategy C — Use XA for Relay Only

```text
Global TX:
- publish JMS
- mark outbox PUBLISHED
commit both
```

Ini mengurangi duplicate di relay tetapi membawa XA complexity.

Biasanya hanya dipilih jika duplicate downstream sangat mahal dan platform XA mature.

---

### Strategy D — Broker Message ID / De-dup Support

Beberapa broker punya duplicate detection feature.

Namun jangan menjadikannya satu-satunya jaminan business correctness.

Gunakan tetap:

```text
eventId as business dedup key
```

Broker-level dedup bisa membantu, tetapi consumer idempotency tetap diperlukan untuk end-to-end safety.

---

## 18. Outbox Relay Pseudocode yang Lebih Aman

```java
public void publishOne() {
    OutboxEvent event = outboxRepository.claimOne();

    if (event == null) {
        return;
    }

    boolean publishedToBroker = false;

    try (JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED)) {
        Destination destination = resolveDestination(context, event);

        TextMessage message = context.createTextMessage(event.payload());
        message.setStringProperty("eventId", event.id());
        message.setJMSCorrelationID(event.correlationId());

        context.createProducer().send(destination, message);
        context.commit();

        publishedToBroker = true;
    } catch (Exception ex) {
        outboxRepository.releaseForRetry(event.id(), classify(ex));
        return;
    }

    if (publishedToBroker) {
        try {
            outboxRepository.markPublished(event.id());
        } catch (Exception ex) {
            // Do not panic-delete.
            // Event may be republished later.
            // Consumer must deduplicate by eventId.
            outboxRepository.markPublishStatusUnknown(event.id(), ex);
        }
    }
}
```

State tambahan:

```text
PUBLISH_STATUS_UNKNOWN
```

Bisa digunakan untuk kasus:

```text
broker commit likely succeeded
DB mark published failed
```

Operator/reconciler bisa memutuskan:

- republish;
- mark published manually;
- check broker/dedup logs;
- rely on consumer idempotency.

---

## 19. Solusi 3: Transactional Inbox

Outbox menyelesaikan producer side. Inbox menyelesaikan consumer side.

Problem consumer:

```text
Message redelivered after DB commit
```

Solusi:

```text
DB transaction:
- insert message id into inbox table
- perform business state transition
commit DB

Then ack/commit JMS
```

Jika message dikirim ulang, insert inbox akan mendeteksi duplicate.

Schema:

```sql
CREATE TABLE inbox_message (
    message_id        VARCHAR2(128) PRIMARY KEY,
    source_name       VARCHAR2(200) NOT NULL,
    message_type      VARCHAR2(150) NOT NULL,
    correlation_id    VARCHAR2(128),
    received_at       TIMESTAMP NOT NULL,
    processed_at      TIMESTAMP,
    status            VARCHAR2(30) NOT NULL
);
```

Contoh consumer:

```java
public void handle(Message message) throws Exception {
    String eventId = message.getStringProperty("eventId");

    try {
        transactionTemplate.executeWithoutResult(status -> {
            boolean firstTime = inboxRepository.tryInsert(
                eventId,
                "ORDER.EVENTS",
                "OrderSubmitted",
                message.getJMSCorrelationID()
            );

            if (!firstTime) {
                return;
            }

            OrderSubmittedEvent event = parse(message);

            orderProjectionRepository.apply(event);
            inboxRepository.markProcessed(eventId);
        });

        message.acknowledge();
    } catch (Exception ex) {
        throw ex;
    }
}
```

Dengan transacted JMS session:

```java
try (JMSContext context = cf.createContext(JMSContext.SESSION_TRANSACTED)) {
    Message message = consumer.receive(5_000);

    if (message == null) {
        context.rollback();
        return;
    }

    String eventId = message.getStringProperty("eventId");

    dbTransaction.executeWithoutResult(tx -> {
        if (!inboxRepository.tryInsert(eventId)) {
            return;
        }

        applyBusinessChange(message);
        inboxRepository.markProcessed(eventId);
    });

    context.commit();
} catch (Exception ex) {
    // context close may rollback uncommitted session depending provider behavior,
    // but explicit rollback is clearer where possible
    throw ex;
}
```

### Failure matrix dengan inbox

| Failure | DB state | JMS state | Result |
|---|---|---|---|
| crash before DB commit | no change | no ack | redelivery, process again |
| crash after DB commit before JMS commit | processed + inbox row | no ack | redelivery, duplicate skipped |
| JMS commit success | processed | acked | done |
| duplicate message later | inbox row exists | ack after skip | safe |

### Invariant

> Consumer side correctness tidak boleh bergantung pada “broker tidak akan duplicate”.

---

## 20. Inbox + Outbox untuk Chained Processing

Banyak sistem melakukan:

```text
Consume command
Update DB
Publish event
Ack command
```

Safe pattern:

```text
DB transaction:
- insert inbox entry for consumed command
- apply business state transition
- insert outbox event
commit DB

Then:
- commit/ack input JMS message

Relay:
- publish outbox event later
```

Diagram:

```text
Input Queue: CASE.SUBMIT.COMMAND
   |
   v
Consumer
   |
   |-- DB transaction -----------------------------|
   |   insert inbox(commandId)                     |
   |   update case status                          |
   |   insert outbox(CaseSubmittedEvent)           |
   |----------------------------------------------|
   |
   v
JMS commit input message

Outbox Relay
   |
   v
Publish CaseSubmittedEvent to topic
```

Ini sangat kuat untuk sistem case management/regulatory workflow karena:

- command processing idempotent;
- event production durable;
- input ack dilakukan setelah DB commit;
- duplicate command tidak membuat state transition ganda;
- downstream event bisa dipublish ulang secara aman;
- audit trail lengkap.

---

## 21. State Transition sebagai Idempotency Boundary

Dalam sistem workflow, idempotency paling natural bukan sekadar `messageId`, tetapi state transition.

Contoh buruk:

```sql
UPDATE case_table
SET penalty_amount = penalty_amount + 100
WHERE case_id = :caseId;
```

Jika duplicate:

```text
penalty +100 dua kali
```

Contoh lebih aman:

```sql
UPDATE case_table
SET status = 'SUBMITTED',
    submitted_at = :submittedAt
WHERE case_id = :caseId
  AND status = 'DRAFT';
```

Result:

```text
first delivery: row updated
duplicate delivery: 0 row updated
```

Lalu handler bisa mengecek:

```text
if rowsUpdated == 0:
  read current state
  if already SUBMITTED:
    treat as idempotent success
  else:
    raise invalid transition
```

### Invariant

> Idempotency terbaik biasanya berada di business state machine, bukan hanya di messaging layer.

---

## 22. Consumer Transaction Boundary Patterns

### Pattern A — Ack After DB Commit

```text
receive
DB transaction commit
JMS ack/commit
```

Semantics:

```text
at-least-once with possible duplicate
```

Kebutuhan:

- idempotent handler;
- inbox/dedup;
- safe state transition.

Ini default paling sehat untuk banyak sistem.

---

### Pattern B — Ack Before DB Commit

```text
receive
JMS ack/commit
DB transaction commit
```

Semantics:

```text
possible message loss
```

Hanya acceptable jika:

- message tidak penting;
- best-effort telemetry;
- side effect optional;
- data bisa direkonstruksi dari sumber lain.

Untuk command bisnis, hindari.

---

### Pattern C — DB and JMS in XA

```text
receive
DB update
JMS send
global commit
```

Semantics:

```text
atomic across enlisted resources
```

Kebutuhan:

- XA-capable DB;
- XA-capable JMS provider;
- transaction manager;
- recovery log;
- operational expertise.

---

### Pattern D — Inbox/Outbox

```text
receive
DB transaction:
  inbox
  business update
  outbox
commit DB
ack JMS
relay outbox
```

Semantics:

```text
eventual consistency
duplicate-safe
replayable
operationally observable
```

Trade-off:

- more tables;
- relay worker;
- duplicate possible downstream;
- eventual publish delay;
- requires governance.

---

## 23. Producer Transaction Boundary Patterns

### Pattern A — Publish After DB Commit

```text
DB commit
JMS publish
```

Risk:

```text
DB commit success, publish fail => missing event
```

Needs:

- retry from application;
- compensating scanner;
- reconciliation job.

Usually weaker than outbox.

---

### Pattern B — Publish Before DB Commit

```text
JMS publish
DB commit
```

Risk:

```text
event visible but DB rollback => ghost event
```

Usually dangerous.

---

### Pattern C — XA

```text
global transaction:
  DB insert
  JMS publish
commit both
```

Good atomicity, high complexity.

---

### Pattern D — Outbox

```text
DB transaction:
  business mutation
  outbox event
commit DB

relay publishes later
```

Most generally practical for enterprise systems.

---

## 24. JTA/XA Conceptual Code in Jakarta EE

In Jakarta EE container, transaction boundary may be managed by container.

Example conceptual MDB:

```java
@MessageDriven(
    activationConfig = {
        @ActivationConfigProperty(
            propertyName = "destinationLookup",
            propertyValue = "jms/OrderCommandQueue"
        ),
        @ActivationConfigProperty(
            propertyName = "destinationType",
            propertyValue = "jakarta.jms.Queue"
        )
    }
)
public class OrderCommandConsumer implements MessageListener {

    @Inject
    private OrderService orderService;

    @Override
    public void onMessage(Message message) {
        orderService.process(message);
    }
}
```

Service:

```java
@ApplicationScoped
public class OrderService {

    @Inject
    private EntityManager entityManager;

    @Inject
    private JMSContext jmsContext;

    @Resource(lookup = "jms/OrderEventTopic")
    private Topic orderEventTopic;

    @Transactional
    public void process(Message message) {
        // Depending on container/resource configuration,
        // DB and JMS may be enlisted in the same JTA transaction.

        OrderCommand command = parse(message);

        Order order = entityManager.find(Order.class, command.orderId());
        order.submit();

        jmsContext
            .createProducer()
            .setProperty("eventId", UUID.randomUUID().toString())
            .send(orderEventTopic, toJson(order.toEvent()));
    }
}
```

### Warning

Kode dengan `@Transactional` tidak otomatis berarti XA benar.

Harus jelas:

- apakah `JMSContext` container-managed?
- apakah connection factory XA-capable?
- apakah database datasource XA?
- apakah transaction manager meng-enlist keduanya?
- apakah broker resource adapter mendukung recovery?
- apakah transaction log persistent?
- apakah timeout disetel benar?

Tanpa itu, annotation bisa memberi rasa aman palsu.

---

## 25. Spring Transaction Warning

Di Spring, hal ini sering membingungkan:

```java
@Transactional
public void createOrder() {
    orderRepository.save(order);
    jmsTemplate.convertAndSend("ORDER.CREATED", event);
}
```

Pertanyaan yang harus dijawab:

1. Transaction manager apa yang aktif?
2. `DataSourceTransactionManager`?
3. `JmsTransactionManager`?
4. `JtaTransactionManager`?
5. Apakah `JmsTemplate` ikut transaksi?
6. Apakah send dilakukan setelah commit?
7. Apakah send transactional atau immediate?
8. Apa yang terjadi jika DB rollback setelah send?
9. Apa yang terjadi jika broker down setelah DB commit?

### Heuristik

> Jangan percaya nama annotation. Buktikan resource enlistment dan failure behavior.

Untuk sistem serius, tulis test failure:

```text
DB commit success, JMS down
JMS publish success, DB rollback
crash before commit
crash after commit
duplicate delivery
relay retry
```

---

## 26. Transaction Timeout

Transaction timeout sering diremehkan.

Skenario:

```text
Consumer receives message
Starts DB transaction
Calls slow external API
Transaction timeout occurs
DB rolls back
JMS session maybe rolls back
Message redelivered
External API side effect may have happened
```

Ini buruk karena external call berada di dalam transaction boundary.

### Rule

> Jangan melakukan slow/unreliable external call di dalam DB/JMS transaction jika side effect-nya tidak bisa dirollback.

Lebih aman:

```text
DB transaction:
- record intent
- transition state to PENDING_EXTERNAL_CALL
commit

External worker:
- perform external call with idempotency key
- update result
- publish event via outbox
```

---

## 27. Side Effect Classification

Sebelum memilih transaction model, klasifikasikan side effect.

| Side effect | Bisa rollback? | Bisa retry? | Bisa duplicate-safe? | Strategy |
|---|---:|---:|---:|---|
| DB state transition | yes | yes | yes with constraint/state | DB tx + inbox |
| JMS send | yes if transacted before commit | yes | yes with eventId | outbox |
| Email | no | maybe | hard | send after durable intent |
| HTTP mutation | no | maybe | depends API idempotency | idempotency key + saga |
| File write | maybe | yes | with stable name/checksum | intent + reconciliation |
| Cache update | no need | yes | yes | after commit / rebuildable |
| Search indexing | no need | yes | yes | async projection |
| Audit log | should be durable | yes | with event id | same DB tx or outbox |

### Principle

> Jangan memasukkan irreversible side effect ke dalam transaction dan berpura-pura bisa rollback.

---

## 28. Saga dan Compensation

Jika proses bisnis terdiri dari beberapa service dan tidak bisa memakai single transaction, gunakan saga.

Contoh:

```text
Submit Case
  -> reserve reference number
  -> create case
  -> notify officer
  -> request external screening
  -> wait result
  -> update case status
```

Tidak realistis membuat semua step satu XA transaction.

Gunakan:

```text
state machine + message commands + events + compensation
```

Contoh compensation:

```text
If screening request fails after case created:
  mark case SCREENING_FAILED
  notify operations
  allow retry
```

Bukan:

```text
rollback seluruh dunia
```

### JMS role dalam saga

JMS cocok untuk:

- command queue;
- event topic;
- retry;
- delayed redelivery;
- DLQ;
- decoupling;
- workload distribution.

Tetapi saga correctness datang dari:

- state model;
- idempotency;
- compensation;
- observability;
- operator recovery.

Bukan dari JMS send/receive semata.

---

## 29. Transactional Consumer Handler Template

Template robust:

```java
public final class TransactionalCommandHandler {

    private final InboxRepository inboxRepository;
    private final CaseRepository caseRepository;
    private final OutboxRepository outboxRepository;
    private final TransactionTemplate tx;

    public void handle(CaseSubmitCommand command, MessageMetadata meta) {
        tx.executeWithoutResult(status -> {
            boolean firstTime = inboxRepository.tryInsert(
                meta.messageId(),
                meta.source(),
                meta.correlationId(),
                "CaseSubmitCommand"
            );

            if (!firstTime) {
                return;
            }

            CaseRecord record = caseRepository.findForUpdate(command.caseId());

            if (record.isSubmitted()) {
                inboxRepository.markProcessed(meta.messageId());
                return;
            }

            if (!record.isDraft()) {
                throw new InvalidStateTransitionException(
                    "Cannot submit case from state " + record.status()
                );
            }

            record.submit(command.submittedBy(), command.submittedAt());
            caseRepository.update(record);

            outboxRepository.insert(OutboxEvent.of(
                "Case",
                record.caseId(),
                "CaseSubmitted",
                1,
                meta.correlationId(),
                toJson(new CaseSubmittedEvent(record.caseId()))
            ));

            inboxRepository.markProcessed(meta.messageId());
        });
    }
}
```

Semantics:

```text
Input command duplicate-safe
Business transition guarded
Output event durable via outbox
JMS ack can happen after DB commit
```

---

## 30. Transactional JMS Listener Template

```java
public final class JmsCaseSubmitConsumer {

    private final ConnectionFactory connectionFactory;
    private final TransactionalCommandHandler handler;

    public void pollLoop() {
        try (JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED)) {
            Queue queue = context.createQueue("CASE.SUBMIT.COMMAND");
            JMSConsumer consumer = context.createConsumer(queue);

            while (!Thread.currentThread().isInterrupted()) {
                Message message = consumer.receive(1_000L);

                if (message == null) {
                    continue;
                }

                try {
                    CaseSubmitCommand command = parse(message);

                    MessageMetadata metadata = new MessageMetadata(
                        message.getJMSMessageID(),
                        message.getJMSCorrelationID(),
                        "CASE.SUBMIT.COMMAND"
                    );

                    handler.handle(command, metadata);

                    context.commit();
                } catch (RecoverableException ex) {
                    context.rollback();
                } catch (InvalidStateTransitionException ex) {
                    // Depending on policy:
                    // - send to invalid-command queue
                    // - record audit
                    // - commit so message does not retry forever
                    // - or rollback to DLQ after max redelivery
                    context.rollback();
                } catch (Exception ex) {
                    context.rollback();
                }
            }
        }
    }
}
```

### Production improvement

Real production code harus punya:

- stop flag;
- connection retry;
- poison message strategy;
- redelivery count inspection;
- DLQ policy;
- metrics;
- structured logs;
- correlation id;
- backoff;
- no infinite tight loop;
- graceful shutdown;
- observability around commit/rollback.

---

## 31. Transaction Boundary dan Redelivery Count

Ketika rollback, broker biasanya akan redeliver.

Maka handler harus melihat redelivery metadata/provider property.

Generic JMS menyediakan:

```java
message.getJMSRedelivered()
```

Provider bisa menyediakan delivery count property, misalnya:

```java
message.getIntProperty("JMSXDeliveryCount")
```

Namun property ini bisa provider-dependent dalam detail behavior.

Policy:

```text
if deliveryCount <= 3:
  rollback for retry
else:
  send to DLQ / parking lot / mark failed
```

Tetapi pada transacted receive, biasanya DLQ policy lebih baik dikonfigurasi di broker.

Aplikasi tetap perlu:

- log delivery count;
- expose metrics;
- classify error;
- avoid retrying permanent error forever.

---

## 32. Poison Message dan Transaction

Poison message adalah message yang selalu gagal diproses.

Contoh:

- schema invalid;
- required field missing;
- invalid state transition;
- reference data missing permanently;
- payload corrupted;
- unsupported event version;
- business rule impossible.

Jika setiap failure memanggil rollback:

```text
message redelivered forever
consumer stuck
queue throughput drops
logs explode
```

Transaction model harus terhubung dengan poison policy.

Possible strategy:

```text
Transient error:
  rollback -> broker redelivery

Permanent error:
  record failure/audit -> commit message -> optionally publish invalid-message event

Unknown error:
  rollback up to N -> DLQ
```

### Important distinction

Tidak semua exception harus rollback.

Jika message secara permanen invalid, rollback tanpa batas hanya memindahkan bug menjadi incident operasional.

---

## 33. External API Call dalam Consumer

Contoh buruk:

```text
receive JMS
start DB tx
call external API
update DB
commit DB
commit JMS
```

Problem:

- DB transaction terbuka selama network call;
- external API bisa sukses tapi DB rollback;
- retry bisa memanggil external API lagi;
- timeout ambiguity;
- ordering sulit;
- rollback tidak membatalkan external call.

Lebih aman:

```text
Consumer:
  DB tx:
    insert inbox
    set state = PENDING_EXTERNAL_REQUEST
    insert outbox command ExternalRequestNeeded
  commit DB
  ack JMS

External worker:
  send HTTP request with idempotency key
  update DB with result
  insert outbox event
```

### Mental model

> External API call adalah saga step, bukan bagian natural dari local transaction.

---

## 34. Transaction dan Message Ordering

Transaksi dapat mempengaruhi ordering.

Contoh:

```text
Consumer A receives M1
Consumer B receives M2
Consumer B commits first
Consumer A rolls back
M1 redelivered after M2
```

Queue FIFO tidak berarti business processing FIFO jika ada:

- multiple consumers;
- rollback;
- redelivery;
- priority;
- scheduled delivery;
- failover;
- prefetch.

Jika ordering penting, gunakan:

- single consumer per key;
- message group;
- aggregate partitioning;
- state version check;
- monotonic sequence;
- reorder buffer;
- business-level conflict detection.

Transaction tidak menyelesaikan ordering lintas concurrent consumers.

---

## 35. Transaction dan Prefetch

Prefetch berarti message bisa sudah dikirim dari broker ke client buffer sebelum diproses.

Dalam transacted session:

```text
Broker may consider messages dispatched but not committed/acknowledged.
```

Jika consumer crash:

```text
prefetched uncommitted messages return to broker/redeliver
```

Implication:

- large prefetch can hurt fairness;
- slow consumer can hold many messages;
- rollback can redeliver multiple messages depending transaction batch;
- memory pressure can increase;
- failover duplicate window expands.

Untuk workload command yang berat:

```text
smaller prefetch
bounded concurrency
one transaction per message or small batch
```

Untuk high-throughput event projection:

```text
larger prefetch
batch DB writes
idempotent projection
careful latency budget
```

---

## 36. Batch Transaction

Batching bisa meningkatkan throughput:

```text
receive 100 messages
apply DB batch
commit DB
commit JMS
```

Kelebihan:

- fewer commits;
- better throughput;
- efficient DB batch;
- less broker roundtrip.

Risiko:

- one bad message rolls back whole batch;
- duplicate redelivery for entire batch;
- latency per message naik;
- memory lebih besar;
- ordering/failure attribution lebih sulit.

Alternative:

```text
micro-batch by key or small fixed size
```

Example:

```text
batch size 10-50 for projection
batch size 1 for critical command
```

### Heuristik

| Workload | Batch size |
|---|---:|
| payment command | 1 |
| case state transition command | 1 |
| audit projection | 50-500 |
| search indexing | 100-1000 |
| email send | 1 or small |
| reporting event | larger batch |

---

## 37. Transaction Isolation di Database

Messaging transaction tidak menggantikan DB isolation.

Consumer harus tetap memikirkan:

- row lock;
- optimistic version;
- unique constraint;
- serialization anomaly;
- lost update;
- concurrent duplicate;
- concurrent commands for same aggregate.

Contoh guard:

```sql
UPDATE case_table
SET status = 'APPROVED',
    version = version + 1
WHERE case_id = :caseId
  AND status = 'PENDING_REVIEW'
  AND version = :expectedVersion;
```

Jika `rowsUpdated == 0`, handler harus memutuskan:

```text
duplicate?
stale command?
invalid transition?
concurrent update?
```

JMS transaction tidak bisa menjawab itu.

---

## 38. Transaction dan Idempotency Key

Message id bisa digunakan, tapi biasanya lebih baik punya application-level idempotency key.

Perbandingan:

| Key | Kelebihan | Kekurangan |
|---|---|---|
| `JMSMessageID` | otomatis dari broker | berubah jika republish |
| `JMSCorrelationID` | trace-friendly | bukan selalu unique |
| `eventId` | stable across retry/republish | harus dikelola aplikasi |
| business command id | natural idempotency | harus ada di contract |
| aggregate id + version | kuat untuk state transition | tidak cocok semua event |

Rekomendasi:

```text
Use stable application eventId/commandId as dedup key.
Use JMSMessageID as transport metadata.
Use JMSCorrelationID as trace/conversation id.
```

---

## 39. Transaction dan Auditability

Dalam regulated enterprise system, transaction design harus bisa dijelaskan.

Audit questions:

1. Message apa yang diterima?
2. Kapan diterima?
3. Siapa producer-nya?
4. Correlation id apa?
5. Handler mana yang memproses?
6. DB state berubah dari apa ke apa?
7. Event apa yang dihasilkan?
8. Apakah message diack?
9. Apakah pernah redelivery?
10. Apakah masuk DLQ?
11. Apakah di-replay manual?
12. Siapa operator yang melakukan replay?
13. Apakah replay duplicate-safe?
14. Apakah final state defensible?

Outbox/inbox membantu karena meninggalkan durable trace.

XA bisa atomic, tetapi audit trail tetap harus dirancang.

---

## 40. Decision Framework: XA vs Outbox/Inbox vs Local Transaction

Gunakan pertanyaan ini.

### Pertanyaan 1 — Apakah ada lebih dari satu durable resource?

Jika hanya JMS:

```text
local JMS transaction cukup
```

Jika DB + JMS:

```text
dual-resource consistency problem
```

---

### Pertanyaan 2 — Apakah event boleh terlambat?

Jika boleh:

```text
outbox
```

Jika tidak boleh:

```text
consider XA or synchronous alternative
```

---

### Pertanyaan 3 — Apakah duplicate bisa ditoleransi dengan idempotency?

Jika ya:

```text
outbox/inbox usually best
```

Jika tidak:

```text
re-evaluate business operation
consider stronger transaction or redesign
```

---

### Pertanyaan 4 — Apakah operation irreversible?

Jika ya:

```text
do not rely on rollback
use durable intent + idempotency + compensation
```

---

### Pertanyaan 5 — Apakah team mampu mengoperasikan XA?

Jika tidak:

```text
avoid XA for core path
```

---

### Pertanyaan 6 — Apakah latency budget ketat?

Jika throughput tinggi dan low latency:

```text
avoid broad XA
use local tx + outbox/inbox
```

---

### Ringkasan pilihan

| Requirement | Recommended approach |
|---|---|
| JMS receive + JMS send only | Local JMS transaction |
| DB mutation + event publish | Outbox |
| Consume command + DB mutation | Inbox + ack after DB commit |
| Consume command + DB mutation + publish event | Inbox + business tx + outbox |
| Strict atomic DB+JMS and mature infra | XA/JTA |
| Irreversible external side effect | Saga + durable intent + idempotency key |
| Analytics/projection | At-least-once + idempotent projection |
| Critical state machine | State transition guard + inbox |

---

## 41. Failure Modelling Table

| Scenario | Naive result | Better design |
|---|---|---|
| DB commit succeeds, JMS ack fails | duplicate processing | inbox/idempotent state transition |
| JMS ack succeeds, DB commit fails | message loss | ack only after durable DB commit |
| DB commit succeeds, JMS publish fails | missing event | outbox |
| JMS publish succeeds, DB rollback | ghost event | outbox or XA |
| Consumer crash after external API success | duplicate external call | external idempotency key + saga |
| Relay publishes event but fails mark published | duplicate event | consumer dedup by eventId |
| Poison message rollback forever | queue stuck | DLQ/parking lot/permanent error policy |
| XA prepare succeeds, coordinator crashes | in-doubt tx | TM recovery log + ops runbook |
| Large batch one message fails | whole batch redelivery | small batch / isolate poison |
| Concurrent duplicate commands | double side effect | unique constraint / state version |

---

## 42. Production Checklist

### JMS local transaction

- [ ] Is the session transacted?
- [ ] Is one session used by one thread?
- [ ] Is `commit()` called only after processing success?
- [ ] Is `rollback()` called for transient retry?
- [ ] Are permanent failures not retried forever?
- [ ] Is redelivery count logged?
- [ ] Is DLQ configured?
- [ ] Is prefetch tuned?
- [ ] Is transaction batch size intentional?

### DB + JMS consumer

- [ ] Is DB commit before JMS ack?
- [ ] Is duplicate redelivery safe?
- [ ] Is there inbox/dedup?
- [ ] Is business transition guarded?
- [ ] Is message idempotency key stable?
- [ ] Are invalid transitions handled explicitly?
- [ ] Is audit trace durable?

### Producer

- [ ] Is there dual-write?
- [ ] If yes, is outbox used?
- [ ] If direct JMS publish is used, is XA truly active?
- [ ] Is event id stable?
- [ ] Is relay retryable?
- [ ] Is duplicate publish safe?
- [ ] Is outbox observable?

### XA/JTA

- [ ] Are all resources XA-capable?
- [ ] Is transaction manager configured?
- [ ] Is recovery log persistent?
- [ ] Are timeouts aligned?
- [ ] Is failover tested?
- [ ] Are in-doubt transactions operationally handled?
- [ ] Are performance costs measured?
- [ ] Is there a reason outbox/inbox is insufficient?

### External side effects

- [ ] Are external calls outside DB/JMS transaction where possible?
- [ ] Is there a durable intent?
- [ ] Is idempotency key passed?
- [ ] Is response recorded?
- [ ] Is retry bounded?
- [ ] Is compensation defined?
- [ ] Is operator recovery possible?

---

## 43. Anti-Patterns

### Anti-Pattern 1 — `@Transactional` Blind Faith

```java
@Transactional
public void doWork() {
    repository.save(entity);
    jmsTemplate.convertAndSend(queue, event);
}
```

Tanpa membuktikan transaction manager dan resource enlistment, ini berbahaya.

---

### Anti-Pattern 2 — Ack Before Durable State

```text
ack message
then update DB
```

Jika crash, work hilang.

---

### Anti-Pattern 3 — Rollback Permanent Business Error Forever

```text
invalid message -> rollback -> invalid message -> rollback -> ...
```

Ini membuat queue macet.

---

### Anti-Pattern 4 — External API Call Inside Long Transaction

```text
DB transaction open
call remote API
wait 30 seconds
commit
```

Ini menciptakan lock, timeout, dan side effect ambiguity.

---

### Anti-Pattern 5 — Outbox Without Consumer Idempotency

Outbox bisa mengirim duplicate ketika relay tidak yakin status publish.

Consumer tetap harus dedup.

---

### Anti-Pattern 6 — XA Without Recovery Runbook

XA tanpa recovery operation adalah incident yang menunggu terjadi.

---

### Anti-Pattern 7 — Treating JMS Transaction as Business Transaction

JMS transaction hanya tahu message.

Ia tidak memahami:

- order status;
- case state;
- payment uniqueness;
- legal auditability;
- external side effect.

Business correctness harus didesain di domain layer.

---

## 44. Advanced Mental Model: Commit Is a Claim, Not a Moral Truth

Ketika aplikasi memanggil:

```java
context.commit();
```

Maksud teknisnya:

```text
"Provider, please finalize this session transaction."
```

Namun dari sisi bisnis, pertanyaannya:

```text
Apakah seluruh business effect sudah aman?
Apakah duplicate aman?
Apakah replay aman?
Apakah audit cukup?
Apakah operator bisa recover?
```

Commit bukan akhir dari reasoning.

Commit hanya satu edge dalam distributed state machine.

---

## 45. Practical Architecture untuk Enterprise Case Management

Misalnya sistem case management memiliki command:

```text
CaseSubmitCommand
```

Kita bisa desain:

```text
Queue:
  CASE.COMMAND.SUBMIT

Consumer:
  CaseSubmitCommandConsumer

DB transaction:
  insert inbox(commandId)
  lock case row
  validate DRAFT -> SUBMITTED
  update case
  insert audit trail
  insert outbox(CaseSubmittedEvent)
  commit

JMS:
  commit input message

Outbox relay:
  publish CaseSubmittedEvent to CASE.EVENTS topic

Downstream:
  notification service consumes event
  SLA service consumes event
  reporting projection consumes event
  audit projection consumes event
```

Properties:

```text
commandId       = stable idempotency key
correlationId   = user request / journey id
causationId     = previous message id
caseId          = aggregate id
eventId         = stable outbox event id
eventType       = CaseSubmitted
eventVersion    = 1
```

Failure behavior:

```text
Duplicate command:
  inbox detects duplicate or state already submitted

Crash after DB commit before JMS commit:
  message redelivered, inbox skips

Crash before DB commit:
  message redelivered, process again

Outbox relay down:
  case submitted, event pending, relay resumes later

Outbox duplicate publish:
  downstream dedup by eventId

Notification failure:
  notification message retries/DLQ without rolling back case submission
```

Ini jauh lebih defensible daripada mencoba membuat seluruh enterprise workflow satu distributed transaction.

---

## 46. Java 8 hingga Java 25 Considerations

### Java 8

Biasanya:

- `javax.jms`;
- application server lama;
- ActiveMQ Classic/IBM MQ/WebLogic/JBoss legacy;
- manual try/finally;
- no records/text blocks;
- older Spring JMS;
- XA via app server/Narayana/Atomikos/Bitronix legacy.

Praktik:

```text
Prefer explicit resource lifecycle.
Be careful with classpath.
Avoid assuming JMS 2.0 simplified API exists unless provider supports it.
```

---

### Java 11/17

Biasanya:

- migration phase;
- Spring Boot modern;
- Jakarta namespace migration starting to matter;
- stronger container/cloud deployment;
- modularity/classpath issue;
- better testing tooling.

Praktik:

```text
Separate javax and jakarta artifacts.
Do not mix APIs.
Use Testcontainers for broker integration test.
Use outbox/inbox for service architecture.
```

---

### Java 21

Tambahan:

- virtual threads available;
- better structured concurrency concepts;
- modern GC choices;
- cloud-native baseline.

Namun:

```text
Virtual threads do not remove JMS provider thread-safety rules.
Session remains single-threaded.
Broker throughput still bounded by IO, prefetch, dispatch, ack, DB.
```

Virtual threads bisa membantu polling/blocking receive pattern, tetapi tidak membuat satu `Session` aman dipakai banyak virtual thread.

---

### Java 25

Sebagai runtime modern, Java 25 dapat memberi improvement runtime/JVM, tetapi JMS correctness tetap sama.

Yang berubah:

- runtime baseline lebih modern;
- library compatibility harus dicek;
- Jakarta stack cenderung lebih relevan;
- observability/JFR/tooling lebih matang.

Yang tidak berubah:

- dual-write problem;
- duplicate delivery;
- idempotency requirement;
- transaction boundary;
- outbox/inbox logic;
- XA operational complexity.

---

## 47. Latihan Engineering

### Latihan 1 — Failure Window

Anda punya flow:

```text
receive PaymentCaptured
insert invoice
ack message
publish InvoiceCreated
```

Tentukan:

1. Di mana dual-write terjadi?
2. Di mana message loss mungkin terjadi?
3. Di mana duplicate mungkin terjadi?
4. Bagaimana desain ulang dengan inbox/outbox?
5. Apa idempotency key yang tepat?

---

### Latihan 2 — XA Decision

Sistem Anda harus:

```text
update Oracle DB
send guaranteed JMS message
return response under 150 ms p95
process 500 TPS
run on Kubernetes
team belum pernah mengoperasikan XA recovery
```

Apakah XA masuk akal?

Jawaban yang diharapkan:

```text
Probably not as default.
Use outbox unless strict atomic low-latency publish is mandatory and ops maturity exists.
```

---

### Latihan 3 — Consumer Duplicate

Message:

```json
{
  "eventId": "evt-123",
  "eventType": "CaseApproved",
  "caseId": "CASE-9",
  "approvedAt": "2026-06-18T10:15:00Z"
}
```

Handler:

```sql
UPDATE case_table
SET approval_count = approval_count + 1
WHERE case_id = 'CASE-9';
```

Apa bug-nya?

Jawaban:

```text
Not idempotent. Duplicate event increments twice.
```

Perbaiki:

```sql
INSERT INTO inbox_message(message_id, status)
VALUES (:eventId, 'PROCESSING');

UPDATE case_table
SET status = 'APPROVED',
    approved_at = :approvedAt
WHERE case_id = :caseId
  AND status = 'PENDING_APPROVAL';
```

---

## 48. Ringkasan Part 10

Poin utama:

1. JMS local transaction hanya menjamin atomicity di dalam messaging provider.
2. Transacted session mengelompokkan receive/send dalam satu unit commit/rollback.
3. DB + JMS tanpa XA/outbox adalah dual-write problem.
4. Ack sebelum durable side effect bisa menyebabkan message loss.
5. DB commit sebelum JMS ack bisa menyebabkan duplicate.
6. Duplicate lebih aman daripada loss jika handler idempotent.
7. XA/JTA memberi atomicity lintas resource, tetapi mahal secara latency, complexity, recovery, dan operasi.
8. Outbox menyelesaikan producer-side dual-write secara practical.
9. Inbox menyelesaikan consumer-side duplicate/redelivery secara practical.
10. Inbox + business state transition + outbox adalah pola kuat untuk enterprise workflow.
11. External side effect harus diperlakukan sebagai saga step, bukan local transaction biasa.
12. Transaction correctness harus dibuktikan lewat failure testing, bukan dipercaya dari annotation.
13. Business idempotency dan state machine guard adalah fondasi utama.
14. Commit bukan akhir reasoning; commit hanya satu transisi dalam distributed state machine.

---

## 49. Referensi Resmi dan Bacaan Lanjutan

- Jakarta Messaging 3.1 API documentation — `Session`, `JMSContext`, transaction-related methods.
- Jakarta Messaging specification 3.1.
- Jakarta Transactions / JTA specification.
- Apache ActiveMQ Artemis documentation — messaging concepts and transaction support.
- IBM MQ documentation — JMS/Jakarta Messaging model and provider-specific considerations.
- Enterprise Integration Patterns — transaction, idempotent receiver, message store, dead letter channel.
- Microservices.io — Transactional Outbox, Idempotent Consumer, Saga pattern.
- Narayana transaction manager documentation for JTA/XA recovery.
- Spring Framework JMS reference — `JmsTemplate`, listener containers, transaction integration.

---

## 50. Apa yang Akan Dibahas di Part 11

Part berikutnya:

# Part 11 — Reliability Semantics: At-Most-Once, At-Least-Once, Effectively-Once, dan Exactly-Once Myth

Kita akan membahas:

- at-most-once;
- at-least-once;
- effectively-once;
- why exactly-once end-to-end is usually a myth;
- duplicate vs loss;
- replay semantics;
- idempotency key;
- dedup store;
- monotonic state transition;
- producer retry;
- consumer retry;
- broker guarantee vs business guarantee;
- bagaimana mendesain reliability contract yang realistis.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-009.md">⬅️ Part 9 — Acknowledgement Semantics: AUTO, CLIENT, DUPS\_OK, SESSION\_TRANSACTED, dan Jakarta Context Modes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-011.md">Part 11 — Reliability Semantics: At-Most-Once, At-Least-Once, Effectively-Once, dan Exactly-Once Myth ➡️</a>
</div>

# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-028

# Part 28 — Testing JMS Systems: Unit, Integration, Contract, Failure Injection, dan Deterministic Async Test

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Bagian: 28 dari 35  
> Target: Java 8 hingga Java 25  
> Fokus: strategi testing sistem JMS/Jakarta Messaging yang reliable, deterministic, dan production-representative.

---

## 0. Tujuan Bagian Ini

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. membedakan apa yang layak diuji sebagai **unit test**, **integration test**, **contract test**, **component test**, dan **end-to-end test** dalam sistem JMS;
2. memahami kenapa testing JMS tidak boleh hanya membuktikan “message terkirim”, tetapi harus membuktikan **semantic correctness**;
3. menulis test untuk producer, consumer, listener, transaction, acknowledgement, redelivery, DLQ, duplicate handling, dan ordering;
4. menghindari test asinkron yang flaky karena sleep, timing assumption, race condition, atau hidden broker state;
5. membangun test harness yang bisa dipakai untuk Java 8 legacy, Java 17/21/25 modern, Spring Boot, Jakarta EE, atau plain JMS client;
6. membuat failure injection test yang mendekati real production failure: crash after side effect, rollback, broker restart, poison message, schema mismatch, duplicate delivery, dan replay;
7. menentukan test apa yang harus masuk CI cepat, CI berat, nightly test, performance test, dan pre-production verification.

Bagian ini tidak mengulang materi testing Java umum, JUnit, Mockito, Spring Test, atau Testcontainers dasar. Fokusnya adalah **bagaimana menguji sistem berbasis JMS secara benar**.

---

## 1. Mental Model: Testing JMS Berarti Menguji Sistem Asinkron Berstate

JMS bukan sekadar function call.

Pada HTTP synchronous call, test sering berbentuk:

```text
request -> handler -> response
```

Pada JMS, alurnya lebih dekat ke:

```text
producer transaction
  -> broker accept/store/route
  -> consumer dispatch/prefetch
  -> handler side effect
  -> acknowledgement/commit
  -> redelivery/DLQ/retry jika gagal
```

Artinya, test JMS harus memikirkan minimal empat state:

1. **application state**: database, cache, file, external side effect;
2. **broker state**: queue depth, delivery count, DLQ, in-flight delivery;
3. **message state**: header, property, body, correlation id, redelivery flag;
4. **test state**: assertions, timeout, cleanup, isolation.

Kesalahan umum engineer biasa adalah menulis test seperti ini:

```java
sendMessage();
Thread.sleep(1000);
assertDatabaseUpdated();
```

Test seperti ini tidak membuktikan correctness. Ia hanya membuktikan bahwa pada mesin tertentu, pada waktu tertentu, dalam beban tertentu, delay 1 detik kebetulan cukup.

Engineer top-tier akan bertanya:

- Apa invariant yang ingin dibuktikan?
- Apakah test menunggu kondisi, bukan menunggu waktu?
- Apakah broker state dibersihkan antar test?
- Apakah test tetap benar kalau consumer sedikit lambat?
- Apakah test bisa membedakan message hilang, duplicate, belum diproses, atau masuk DLQ?
- Apakah failure path diuji, bukan hanya happy path?
- Apakah test membuktikan ack/commit terjadi setelah side effect aman?

Jakarta Messaging/JMS sendiri adalah API untuk membuat, mengirim, menerima, dan membaca message dari enterprise messaging system; API ini tidak menghilangkan fakta bahwa runtime behavior ditentukan oleh provider/broker dan konfigurasi deployment. Referensi resmi Jakarta Messaging menjelaskan API ini sebagai cara umum bagi Java program untuk berinteraksi dengan enterprise messaging system. [Jakarta Messaging API](https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/package-summary)

---

## 2. Prinsip Dasar Testing JMS

### 2.1 Jangan Menguji “API JMS”, Uji Kontrak Aplikasi

JMS provider sudah memiliki test suite sendiri. Aplikasi kita tidak perlu membuktikan bahwa `MessageProducer.send()` bisa mengirim message.

Yang perlu diuji adalah:

```text
Ketika event/command X dikirim,
sistem menghasilkan side effect Y,
dengan idempotency Z,
dengan failure behavior W,
dengan observability V.
```

Contoh buruk:

```text
Given message sent to queue
Then listener receives message
```

Contoh lebih baik:

```text
Given PaymentAuthorized command with commandId C
When the consumer processes it
Then invoice status becomes PAID exactly once
And processed_message contains C
And duplicate delivery of C does not create a second payment ledger entry
```

### 2.2 Test Harus Menunggu Kondisi, Bukan Menunggu Durasi

Anti-pattern:

```java
Thread.sleep(2000);
assertEquals("APPROVED", application.getStatus());
```

Pattern yang lebih benar:

```java
await().atMost(Duration.ofSeconds(5))
       .untilAsserted(() -> assertEquals("APPROVED", repository.findStatus(appId)));
```

Awaitility memang dibuat untuk testing sistem asynchronous dengan DSL yang mengekspresikan expectation tanpa manual sleep dan timeout boilerplate. Dokumentasi resminya menyatakan bahwa asynchronous systems testing sulit karena harus menangani thread, timeout, dan concurrency issue, lalu Awaitility menyediakan DSL untuk expectation asynchronous. [Awaitility](https://www.awaitility.org/)

### 2.3 Test Harus Punya Batas Waktu yang Eksplisit

Async test tanpa timeout bisa menggantung CI.

Setiap test JMS perlu:

- maximum wait time;
- poll interval;
- fail-fast condition bila ada error fatal;
- diagnostic dump ketika gagal.

Contoh diagnostic yang berguna saat fail:

```text
Expected application status APPROVED within 5s.
Actual status: PENDING
Queue depth: 0
DLQ depth: 1
Last consumer error: ValidationException: missing applicantId
CorrelationId: app-123
```

Test yang hanya berkata `expected APPROVED but was PENDING` buruk untuk sistem asinkron karena tidak memberi tahu apakah message belum dikonsumsi, gagal diproses, masuk DLQ, atau hilang.

### 2.4 Test Harus Mengontrol Broker State

JMS test rentan bocor antar test karena broker menyimpan message. Setiap test harus punya salah satu strategi ini:

1. destination unik per test;
2. broker container baru per test class;
3. cleanup queue sebelum/sesudah test;
4. purge broker via management API;
5. namespace test dengan prefix unik.

Untuk CI, strategi yang biasanya paling seimbang:

```text
one broker container per test class
+ destination name unique per test
+ cleanup/purge after each test
```

### 2.5 Test Harus Membedakan “Delivered” dan “Processed”

Message bisa sudah delivered ke consumer tetapi belum committed. Message bisa sudah diproses database tetapi ack gagal. Message bisa ada di prefetch buffer sehingga queue depth terlihat nol padahal handler belum selesai.

Karena itu, jangan menilai success hanya dari queue kosong.

Lebih baik gunakan kombinasi:

- business state assertion;
- processed-message/inbox table;
- DLQ assertion;
- consumer error capture;
- broker metric atau management check;
- correlation id log assertion bila memungkinkan.

---

## 3. Test Pyramid untuk JMS

Testing JMS yang sehat tidak berarti semua hal harus memakai broker nyata. Kita butuh beberapa lapisan.

```text
                +-----------------------------+
                | E2E / pre-prod verification |
                +-----------------------------+
                         ^
                         |
                +-----------------------------+
                | Component + broker tests    |
                +-----------------------------+
                         ^
                         |
                +-----------------------------+
                | Contract tests              |
                +-----------------------------+
                         ^
                         |
                +-----------------------------+
                | Unit tests                  |
                +-----------------------------+
```

### 3.1 Unit Test

Unit test cocok untuk:

- message mapper;
- payload validation;
- idempotency decision;
- retry classification;
- domain handler logic;
- state transition guard;
- correlation id generation;
- envelope builder;
- poison message classification;
- error-to-action mapping.

Unit test tidak cocok untuk:

- membuktikan broker dispatch;
- membuktikan redelivery count provider;
- membuktikan transaction rollback JMS;
- membuktikan listener container concurrency;
- membuktikan DLQ routing broker.

Unit test harus secepat mungkin dan tidak tergantung broker.

### 3.2 Contract Test

Contract test cocok untuk membuktikan bahwa producer dan consumer sepakat atas:

- message type;
- schema version;
- required fields;
- optional fields;
- header/property names;
- idempotency key;
- correlation id;
- semantic meaning status/event type;
- compatibility ketika field baru ditambahkan.

Contract test bisa berjalan tanpa broker dengan melakukan serialize/deserialize message envelope.

### 3.3 Component Test dengan Broker Nyata

Component test memakai broker nyata, tetapi scope masih satu service atau beberapa komponen terbatas.

Cocok untuk:

- producer benar mengirim ke destination yang benar;
- listener benar consume dan commit;
- rollback menghasilkan redelivery;
- poison message masuk DLQ;
- selector berfungsi;
- transaction boundary benar;
- duplicate message ditangani idempotently;
- consumer concurrency tidak merusak ordering per aggregate.

Testcontainers menyediakan module ActiveMQ/Artemis yang bisa menjalankan broker container untuk test Java; dokumentasinya menunjukkan contoh `ActiveMQContainer` dan `ArtemisContainer`. [Testcontainers ActiveMQ/Artemis](https://java.testcontainers.org/modules/activemq/)

### 3.4 End-to-End Test

E2E test cocok untuk membuktikan flow lintas service:

```text
API service -> outbox -> relay -> JMS -> consumer service -> DB -> notification/event
```

Namun E2E test mahal, lambat, dan rawan flaky. Gunakan sedikit, untuk flow kritikal saja.

### 3.5 Failure Injection Test

Failure injection test adalah bagian yang sering membedakan sistem enterprise matang dari demo.

Contoh yang wajib diuji:

- consumer throw exception sebelum side effect;
- consumer throw exception setelah DB commit tetapi sebelum ack;
- DB down saat message diterima;
- schema invalid;
- duplicate message;
- redelivery melebihi threshold;
- broker restart;
- DLQ replay;
- consumer shutdown saat message in-flight;
- selector typo;
- transaction timeout;
- destination tidak ada;
- unauthorized producer/consumer.

---

## 4. Testing Producer

Producer test harus menjawab:

1. apakah message dikirim saat business transaction valid?
2. apakah message tidak dikirim saat transaction rollback?
3. apakah destination benar?
4. apakah header/property benar?
5. apakah payload compatible?
6. apakah correlation/idempotency key benar?
7. apakah delivery mode/TTL/priority/delay sesuai kontrak?
8. apakah error saat send ditangani benar?

### 4.1 Producer Unit Test

Misalnya kita punya builder:

```java
public final class ApplicationSubmittedMessageFactory {

    public OutboundMessage create(Application application) {
        return new OutboundMessage(
            "application.submitted.v1",
            application.getId().toString(),
            application.getIdempotencyKey(),
            JsonPayload.of(Map.of(
                "applicationId", application.getId().toString(),
                "submittedAt", application.getSubmittedAt().toString(),
                "applicantId", application.getApplicantId().toString()
            ))
        );
    }
}
```

Unit test:

```java
@Test
void shouldCreateStableMessageContract() {
    Application app = fixtureApplication("APP-1001");

    OutboundMessage message = factory.create(app);

    assertEquals("application.submitted.v1", message.type());
    assertEquals("APP-1001", message.aggregateId());
    assertNotNull(message.idempotencyKey());
    assertTrue(message.payload().contains("applicationId"));
}
```

Ini tidak menguji JMS. Ini menguji message contract milik aplikasi.

### 4.2 Producer Integration Test dengan Broker

Plain JMS/Jakarta Messaging style:

```java
@Test
void shouldPublishApplicationSubmittedMessage() throws Exception {
    String queueName = uniqueQueue("application-submitted");

    producer.publishApplicationSubmitted(appId, queueName);

    try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
        Queue queue = context.createQueue(queueName);
        JMSConsumer consumer = context.createConsumer(queue);
        Message message = consumer.receive(2_000);

        assertNotNull(message);
        assertEquals("application.submitted.v1", message.getStringProperty("messageType"));
        assertEquals(appId, message.getStringProperty("aggregateId"));
        assertNotNull(message.getJMSCorrelationID());
    }
}
```

Untuk Java 8 dengan `javax.jms` dan style lama:

```java
@Test
public void shouldPublishApplicationSubmittedMessage_java8Style() throws Exception {
    Connection connection = connectionFactory.createConnection();
    try {
        connection.start();
        Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
        Queue queue = session.createQueue(queueName);

        producer.publishApplicationSubmitted(appId, queueName);

        MessageConsumer consumer = session.createConsumer(queue);
        Message message = consumer.receive(2000L);

        assertNotNull(message);
        assertEquals("application.submitted.v1", message.getStringProperty("messageType"));
    } finally {
        connection.close();
    }
}
```

### 4.3 Testing Outbox Producer

Jika service memakai outbox, producer test tidak boleh hanya memeriksa message broker.

Alurnya:

```text
business command
  -> DB transaction writes business row + outbox row
  -> relay publishes JMS message
  -> outbox row marked SENT
```

Test penting:

```text
Given valid command
When transaction commits
Then business row exists
And outbox row exists with PENDING status

Given relay runs
When broker accepts message
Then message appears on queue
And outbox row becomes SENT

Given broker unavailable
When relay runs
Then outbox row remains PENDING/FAILED_RETRYABLE
And no business rollback occurs
```

Pseudo-code:

```java
@Test
void shouldNotLoseEventWhenBrokerIsTemporarilyDown() {
    service.submitApplication(command);

    broker.stop();
    outboxRelay.runOnce();

    assertEquals("PENDING", outboxRepository.findByAggregateId(appId).status());

    broker.start();
    outboxRelay.runOnce();

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertQueueContains(queueName, "application.submitted.v1", appId);
        assertEquals("SENT", outboxRepository.findByAggregateId(appId).status());
    });
}
```

---

## 5. Testing Consumer

Consumer test harus menjawab:

1. apakah message valid diproses menjadi side effect benar?
2. apakah invalid message tidak merusak sistem?
3. apakah duplicate message aman?
4. apakah exception menyebabkan rollback/redelivery?
5. apakah permanent error masuk DLQ/parking lot?
6. apakah ack/commit terjadi setelah side effect?
7. apakah concurrency tidak merusak invariant?
8. apakah graceful shutdown tidak kehilangan message?

### 5.1 Consumer Unit Test: Handler sebagai Pure-ish Component

Idealnya listener JMS tipis:

```java
public final class ApplicationSubmittedListener implements MessageListener {

    private final ApplicationSubmittedMessageReader reader;
    private final ApplicationSubmittedHandler handler;

    @Override
    public void onMessage(Message message) {
        ApplicationSubmittedCommand command = reader.read(message);
        handler.handle(command);
    }
}
```

Handler bisa diuji tanpa broker:

```java
@Test
void shouldMoveApplicationToSubmittedState() {
    repository.save(new Application("APP-1001", "DRAFT"));

    handler.handle(new ApplicationSubmittedCommand("MSG-1", "APP-1001"));

    assertEquals("SUBMITTED", repository.find("APP-1001").status());
}
```

### 5.2 Consumer Integration Test: Send Message, Assert Side Effect

```java
@Test
void shouldProcessSubmittedApplicationMessage() {
    sendApplicationSubmittedMessage("MSG-1", "APP-1001");

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertEquals("SUBMITTED", repository.find("APP-1001").status());
        assertTrue(inboxRepository.exists("MSG-1"));
    });
}
```

Perhatikan assertion tidak menggunakan `sleep`. Test menunggu state yang benar.

### 5.3 Consumer Test Harus Capture Error

Salah satu masalah besar JMS test adalah listener error sering terjadi di thread berbeda, sehingga test tetap terlihat “pass” jika hanya menunggu queue kosong.

Buat test probe:

```java
public final class ListenerErrorProbe {
    private final Queue<Throwable> errors = new ConcurrentLinkedQueue<>();

    public void record(Throwable error) {
        errors.add(error);
    }

    public void assertNoErrors() {
        if (!errors.isEmpty()) {
            AssertionError assertion = new AssertionError("Listener errors occurred");
            errors.forEach(assertion::addSuppressed);
            throw assertion;
        }
    }
}
```

Gunakan dalam test:

```java
await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
    assertEquals("SUBMITTED", repository.find("APP-1001").status());
    errorProbe.assertNoErrors();
});
```

---

## 6. Testing Acknowledgement dan Transaction Boundary

Jakarta Messaging `Session` menyediakan mode acknowledgement dan transaction; dokumentasi API menyatakan `commit()` dan `rollback()` berlaku pada transacted session, dan acknowledgement mode berbeda untuk non-transacted session. [Jakarta Messaging Session API](https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/session)

Yang perlu diuji bukan hanya API, tetapi invariant:

```text
Message boleh di-ack/commit hanya setelah side effect yang diperlukan aman.
```

### 6.1 Test Rollback Menghasilkan Redelivery

```java
@Test
void shouldRedeliverWhenConsumerRollsBack() {
    sendMessage("MSG-ROLLBACK-1");

    failingHandler.failFirstAttemptOnly("MSG-ROLLBACK-1");

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        assertEquals(2, handlerProbe.attemptCount("MSG-ROLLBACK-1"));
        assertTrue(repository.wasProcessed("MSG-ROLLBACK-1"));
    });
}
```

Yang diuji:

- attempt pertama gagal;
- session rollback;
- broker redeliver;
- attempt kedua sukses;
- side effect final benar.

### 6.2 Test Crash After DB Commit Before Ack

Ini failure window paling penting.

```text
receive message
  -> insert business side effect
  -> insert inbox/processed_message
  -> crash before ack/commit JMS
  -> broker redelivers
  -> consumer sees processed_message
  -> skip duplicate safely
  -> ack message
```

Pseudo-test:

```java
@Test
void shouldBeSafeWhenCrashHappensAfterDbCommitBeforeAck() {
    sendMessage("MSG-CRASH-1", "APP-1001");

    handlerFailureMode.crashAfterDatabaseCommit("MSG-CRASH-1");

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        assertEquals(1, ledgerRepository.countEntriesFor("APP-1001"));
        assertTrue(inboxRepository.exists("MSG-CRASH-1"));
        assertTrue(handlerProbe.attemptCount("MSG-CRASH-1") >= 2);
    });
}
```

Kalau test ini gagal dengan dua ledger entries, artinya idempotency design lemah.

### 6.3 Test AUTO_ACK Hazard

Dalam `AUTO_ACKNOWLEDGE`, message listener acknowledgement biasanya terjadi ketika listener kembali dengan sukses. Dokumentasi `Session.AUTO_ACKNOWLEDGE` menyatakan acknowledgement otomatis dilakukan ketika `receive` berhasil return atau listener berhasil return. [Jakarta Messaging Session AUTO_ACKNOWLEDGE](https://jakarta.ee/specifications/messaging/3.0/apidocs/jakarta/jms/session)

Test hazard:

```java
@Test
void shouldNotAcknowledgeBeforeAsyncSideEffectCompletes() {
    sendMessage("MSG-ASYNC-BAD");

    listenerReturnsBeforeBackgroundTaskFails();

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertFalse(repository.wasProcessed("MSG-ASYNC-BAD"));
        assertDiagnosticShowsMessageWasAckedOrLost();
    });
}
```

Pelajaran:

```text
Jangan memulai background task lalu return dari listener sebelum side effect selesai,
kecuali ack/commit dan recovery logic didesain secara eksplisit.
```

---

## 7. Testing Redelivery, DLQ, dan Poison Message

Test DLQ harus membuktikan:

1. message gagal diproses;
2. message dicoba ulang sesuai policy;
3. setelah threshold, message tidak terus memblokir queue utama;
4. message masuk DLQ/parking lot;
5. metadata diagnostic cukup untuk repair;
6. replay dari DLQ aman.

### 7.1 Poison Message Test

```java
@Test
void shouldMoveInvalidMessageToDlqAfterMaxRedelivery() {
    sendInvalidMessage("MSG-INVALID-1");

    await().atMost(Duration.ofSeconds(15)).untilAsserted(() -> {
        assertEquals(0, queueDepth(mainQueue));
        assertEquals(1, queueDepth(dlq));

        Message dlqMessage = browseSingleMessage(dlq);
        assertEquals("MSG-INVALID-1", dlqMessage.getStringProperty("messageId"));
        assertTrue(dlqMessage.getIntProperty("JMSXDeliveryCount") >= configuredMaxDeliveryCount);
    });
}
```

`JMSXDeliveryCount` adalah property yang relevan untuk redelivery count di Jakarta Messaging 3.1. [Jakarta Messaging 3.1 Specification](https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html)

### 7.2 Retry Storm Test

Retry storm terjadi ketika banyak message gagal cepat lalu segera di-redeliver tanpa backoff.

Test:

```text
Given 100 messages fail due to DB unavailable
When consumer processes them
Then system must not spin CPU endlessly
And DLQ should not grow immediately if error is transient
And retry/backoff policy should delay redelivery or stop consumer safely
```

Pseudo-assertion:

```java
@Test
void shouldAvoidRetryStormWhenDatabaseIsDown() {
    database.disable();
    sendMessages(100);

    await().during(Duration.ofSeconds(3)).atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertTrue(handlerProbe.attemptRatePerSecond() < 50);
        assertTrue(queueDepth(mainQueue) > 0 || retryQueueDepth() > 0);
    });
}
```

### 7.3 DLQ Replay Test

DLQ bukan kuburan. DLQ adalah repair queue.

```java
@Test
void shouldReplayRepairedDlqMessageSafely() {
    sendInvalidMessage("MSG-DLQ-1");
    awaitUntilInDlq("MSG-DLQ-1");

    Message repaired = repairPayloadFromDlq("MSG-DLQ-1");
    replayToMainQueue(repaired);

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertTrue(repository.wasProcessed("MSG-DLQ-1"));
        assertEquals(0, countActiveDlqMessages("MSG-DLQ-1"));
    });
}
```

Replay test harus juga membuktikan idempotency. Jika message sebagian sudah memicu side effect sebelum masuk DLQ, replay tidak boleh menggandakan effect.

---

## 8. Testing Idempotency dan Duplicate Delivery

JMS applications biasanya harus tahan duplicate delivery. Test duplicate harus eksplisit.

### 8.1 Duplicate Same Message ID

```java
@Test
void shouldProcessDuplicateMessageOnlyOnce() {
    sendBusinessMessage("MSG-DUP-1", "APP-1001");
    sendBusinessMessage("MSG-DUP-1", "APP-1001");

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertEquals(1, ledgerRepository.countFor("APP-1001"));
        assertEquals(1, inboxRepository.countByMessageId("MSG-DUP-1"));
    });
}
```

### 8.2 Duplicate Different JMSMessageID, Same Business Idempotency Key

Provider-generated `JMSMessageID` bisa berbeda saat replay/manual resend. Karena itu dedup tidak boleh bergantung hanya pada `JMSMessageID`.

```java
@Test
void shouldDeduplicateByBusinessIdempotencyKeyNotProviderMessageId() {
    sendBusinessMessage("JMS-A", "PAYMENT-1001", "IDEMP-9001");
    sendBusinessMessage("JMS-B", "PAYMENT-1001", "IDEMP-9001");

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertEquals(1, paymentLedger.countByPaymentId("PAYMENT-1001"));
        assertEquals(1, processedMessage.countByIdempotencyKey("IDEMP-9001"));
    });
}
```

### 8.3 Duplicate After Partial Failure

```java
@Test
void shouldNotDuplicateSideEffectWhenRedeliveredAfterPartialFailure() {
    handlerFailureMode.failAfterExternalCallBeforeAck("MSG-PARTIAL-1");

    sendMessage("MSG-PARTIAL-1");

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        assertEquals(1, externalSystemProbe.callCount("MSG-PARTIAL-1"));
        assertTrue(processedMessageRepository.exists("MSG-PARTIAL-1"));
    });
}
```

Kalau external system tidak idempotent, test harus membuktikan ada guard sebelum external call, atau external call memakai idempotency key.

---

## 9. Testing Ordering dan Concurrency

Ordering test tidak boleh sekadar mengirim A lalu B dan berharap A diproses dulu. Dengan concurrent consumers, prefetch, rollback, priority, dan redelivery, ordering bisa berubah.

### 9.1 Per-Aggregate Ordering Test

```java
@Test
void shouldApplyCommandsInVersionOrderPerAggregate() {
    sendCommand("APP-1", 1, "SUBMIT");
    sendCommand("APP-1", 2, "APPROVE");
    sendCommand("APP-1", 3, "ISSUE_LICENSE");

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        Application app = repository.find("APP-1");
        assertEquals("LICENSE_ISSUED", app.status());
        assertEquals(3, app.version());
    });
}
```

### 9.2 Out-of-Order Defense Test

```java
@Test
void shouldRejectOrParkOutOfOrderCommand() {
    sendCommand("APP-1", 2, "APPROVE");
    sendCommand("APP-1", 1, "SUBMIT");

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertEquals("SUBMITTED", repository.find("APP-1").status());
        assertEquals(1, parkingLot.countForAggregate("APP-1"));
    });
}
```

Ini penting untuk regulated workflow karena salah urutan bisa menghasilkan state yang tidak defensible.

### 9.3 Concurrent Consumers Race Test

```java
@Test
void shouldNotCreateInvalidStateUnderConcurrentMessageProcessing() {
    configureConsumerConcurrency(8);

    for (int i = 1; i <= 100; i++) {
        sendCommand("CASE-1", i, "ADD_NOTE");
    }

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        assertEquals(100, noteRepository.countByCase("CASE-1"));
        assertNoOptimisticLockFailuresUnrecovered();
        assertNoDlqMessages();
    });
}
```

Kalau operasi harus strictly ordered, test ini bisa membuktikan bahwa concurrency > 1 tidak boleh digunakan untuk destination tersebut, atau harus memakai message group/partitioning.

---

## 10. Testing Selectors dan Routing

Selector test harus membuktikan property name, type, dan expression benar.

```java
@Test
void shouldRouteOnlyHighPriorityComplianceMessagesToSpecialConsumer() {
    sendMessageWithProperties("MSG-1", Map.of(
        "module", "COMPLIANCE",
        "severity", "HIGH"
    ));
    sendMessageWithProperties("MSG-2", Map.of(
        "module", "SURVEY",
        "severity", "LOW"
    ));

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertTrue(specialConsumerProbe.received("MSG-1"));
        assertFalse(specialConsumerProbe.received("MSG-2"));
    });
}
```

Jakarta EE tutorial menjelaskan bahwa message selector memfilter berdasarkan message headers/properties, bukan body. Ini berarti selector test harus memvalidasi properties, bukan JSON payload di body. [Jakarta EE Tutorial - Message Selectors](https://jakarta.ee/learn/docs/jakartaee-tutorial/current/messaging/jms-concepts/jms-concepts.html)

Anti-pattern:

```text
Body JSON berisi severity=HIGH,
tetapi selector memakai severity property.
Test hanya memeriksa body,
sehingga routing gagal di production.
```

---

## 11. Testing Spring JMS

Spring Framework menyediakan `JmsTemplate` untuk production/synchronous receive dan listener container untuk asynchronous receive; dokumentasi Spring menjelaskan JMS support sebagai dua area utama: production/consumption melalui `JmsTemplate` dan asynchronous receipt via message-listener containers. [Spring Framework JMS Reference](https://docs.spring.io/spring-framework/reference/integration/jms.html)

### 11.1 Spring Producer Test

```java
@SpringBootTest
@Testcontainers
class ApplicationEventPublisherTest {

    @Autowired ApplicationEventPublisher publisher;
    @Autowired JmsTemplate jmsTemplate;

    @Test
    void shouldPublishMessageWithExpectedHeaders() {
        publisher.publishSubmitted("APP-1001");

        Message message = jmsTemplate.receive("application.submitted.test");

        assertThat(message).isNotNull();
        assertThat(message.getStringProperty("messageType"))
            .isEqualTo("application.submitted.v1");
    }
}
```

### 11.2 Spring Listener Test

```java
@SpringBootTest
@Testcontainers
class ApplicationSubmittedListenerTest {

    @Autowired JmsTemplate jmsTemplate;
    @Autowired ApplicationRepository repository;

    @Test
    void shouldConsumeMessageAndUpdateApplication() {
        jmsTemplate.convertAndSend("application.submitted.test", payload, message -> {
            message.setStringProperty("messageId", "MSG-1");
            message.setStringProperty("messageType", "application.submitted.v1");
            return message;
        });

        await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
            assertThat(repository.findStatus("APP-1001")).isEqualTo("SUBMITTED");
        });
    }
}
```

### 11.3 Testing Error Handler

Spring listener error sering masuk ke error handler, bukan test thread. Pastikan test menangkapnya.

```java
@Component
class TestJmsErrorCollector implements ErrorHandler {
    private final Queue<Throwable> errors = new ConcurrentLinkedQueue<>();

    @Override
    public void handleError(Throwable t) {
        errors.add(t);
    }

    void assertNoErrors() {
        if (!errors.isEmpty()) {
            AssertionError e = new AssertionError("JMS listener errors");
            errors.forEach(e::addSuppressed);
            throw e;
        }
    }
}
```

Spring Boot JMS auto-configuration membutuhkan `ConnectionFactory` dan menyediakan integrasi JMS/Artemis configuration; dokumentasi Spring Boot menyatakan `ConnectionFactory` adalah interface standard untuk membuat connection ke JMS broker. [Spring Boot JMS Reference](https://docs.spring.io/spring-boot/reference/messaging/jms.html)

---

## 12. Testcontainers dan Broker Nyata

### 12.1 Kenapa Broker Nyata Penting

Embedded/mock JMS sering gagal menangkap behavior penting:

- redelivery count;
- DLQ policy;
- prefetch;
- paging;
- transaction boundary;
- security/authorization;
- broker restart;
- failover;
- provider-specific selector behavior;
- durable subscription behavior.

Testcontainers membuat test lebih production-representative karena broker berjalan sebagai proses/container nyata.

### 12.2 Contoh Artemis Container

```java
@Testcontainers
class JmsIntegrationTest {

    @Container
    static ArtemisContainer artemis = new ArtemisContainer("apache/activemq-artemis:2.32.0-alpine")
        .withUser("test")
        .withPassword("test");

    static ConnectionFactory connectionFactory;

    @BeforeAll
    static void setupConnectionFactory() {
        connectionFactory = new ActiveMQConnectionFactory(
            artemis.getBrokerUrl(),
            "test",
            "test"
        );
    }
}
```

Sesuaikan versi image dan client library dengan project. Jangan hardcode versi di banyak tempat; simpan di dependency management.

### 12.3 Destination Naming untuk Test Isolation

```java
static String uniqueQueue(String base) {
    return base + "." + UUID.randomUUID();
}
```

Namun hati-hati: destination unik yang tidak dibersihkan bisa membuat broker state penuh dalam test suite panjang. Kombinasikan dengan cleanup.

---

## 13. Deterministic Async Testing Pattern

### 13.1 Await Business State

```java
await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
    assertEquals("APPROVED", repository.findStatus(appId));
});
```

### 13.2 Await Broker State

```java
await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
    assertEquals(0, queueDepth(mainQueue));
    assertEquals(0, queueDepth(dlqQueue));
});
```

### 13.3 Await Both Business and Broker State

```java
await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
    assertEquals("APPROVED", repository.findStatus(appId));
    assertEquals(0, queueDepth(mainQueue));
    assertEquals(0, queueDepth(dlqQueue));
    errorProbe.assertNoErrors();
});
```

### 13.4 Avoid Sleep-Based Test

Buruk:

```java
Thread.sleep(5000);
assertEquals("DONE", status());
```

Lebih baik:

```java
await().pollInterval(Duration.ofMillis(100))
       .atMost(Duration.ofSeconds(5))
       .untilAsserted(() -> assertEquals("DONE", status()));
```

### 13.5 Fail Fast on Fatal Listener Error

```java
await().atMost(Duration.ofSeconds(5))
       .failFast(() -> errorProbe.hasFatalError())
       .untilAsserted(() -> assertEquals("DONE", status()));
```

Jika memakai Awaitility versi lama yang belum mendukung API tertentu, buat wrapper fail-fast sendiri di assertion.

---

## 14. Testing Durable Subscription dan Topic Semantics

Topic test harus membedakan:

- non-durable subscriber;
- durable subscriber;
- shared durable subscriber;
- subscriber offline;
- late subscriber;
- duplicate fan-out;
- consumer-specific state.

### 14.1 Non-Durable Subscriber Tidak Menerima Message Saat Offline

```java
@Test
void nonDurableSubscriberShouldNotReceiveMessagePublishedWhileOffline() {
    createNonDurableSubscriberAndClose();

    publishTopicMessage("MSG-OFFLINE-1");

    Message received = createNonDurableSubscriber().receive(500);
    assertNull(received);
}
```

### 14.2 Durable Subscriber Menerima Message Saat Online Lagi

```java
@Test
void durableSubscriberShouldReceiveMessagePublishedWhileOffline() {
    createDurableSubscriber("sub-a").close();

    publishTopicMessage("MSG-DURABLE-1");

    Message received = createDurableSubscriber("sub-a").receive(2_000);
    assertNotNull(received);
    assertEquals("MSG-DURABLE-1", received.getStringProperty("messageId"));
}
```

Durable subscription test sangat bergantung pada provider dan harus membersihkan subscription setelah selesai agar tidak mengganggu test berikutnya.

---

## 15. Testing Security

Security test untuk JMS sering dilupakan karena dianggap konfigurasi infra. Padahal salah ACL bisa fatal.

### 15.1 Unauthorized Producer

```java
@Test
void unauthorizedProducerShouldNotSendToRestrictedQueue() {
    ConnectionFactory unauthorizedFactory = connectionFactoryFor("guest", "guest");

    assertThrows(JMSException.class, () -> {
        try (JMSContext context = unauthorizedFactory.createContext()) {
            context.createProducer().send(context.createQueue("restricted.queue"), "payload");
        }
    });
}
```

### 15.2 Unauthorized Consumer

```java
@Test
void unauthorizedConsumerShouldNotConsumeRestrictedQueue() {
    ConnectionFactory unauthorizedFactory = connectionFactoryFor("guest", "guest");

    assertThrows(JMSRuntimeException.class, () -> {
        try (JMSContext context = unauthorizedFactory.createContext()) {
            context.createConsumer(context.createQueue("restricted.queue"));
        }
    });
}
```

### 15.3 Secret Rotation Smoke Test

Untuk environment non-prod:

```text
Given old credential active
When credential rotated
Then new connection succeeds
And old credential fails after grace period
And running consumers reconnect safely
```

---

## 16. Testing Observability

Observability test tidak harus berat. Minimal, untuk flow kritikal, pastikan correlation id muncul.

### 16.1 Correlation Propagation Test

```java
@Test
void shouldPropagateCorrelationIdFromInboundMessageToLogsAndOutboundMessage() {
    sendInboundMessage("MSG-1", "CORR-123");

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        assertTrue(logProbe.containsCorrelationId("CORR-123"));
        Message outbound = browseSingleMessage(outboundQueue);
        assertEquals("CORR-123", outbound.getJMSCorrelationID());
    });
}
```

### 16.2 DLQ Diagnostic Metadata Test

```java
@Test
void dlqMessageShouldContainDiagnosticMetadata() {
    sendInvalidMessage("MSG-BAD-1");

    awaitUntilInDlq("MSG-BAD-1");

    Message dlqMessage = browseSingleMessage(dlqQueue);
    assertNotNull(dlqMessage.getStringProperty("originalDestination"));
    assertNotNull(dlqMessage.getStringProperty("failureCategory"));
    assertNotNull(dlqMessage.getStringProperty("correlationId"));
}
```

---

## 17. Test Data Management

### 17.1 Message Fixtures Harus Versioned

Simpan fixture message seperti:

```text
src/test/resources/messages/application-submitted/v1/valid-minimal.json
src/test/resources/messages/application-submitted/v1/valid-full.json
src/test/resources/messages/application-submitted/v1/missing-required-field.json
src/test/resources/messages/application-submitted/v2/valid-with-new-field.json
```

### 17.2 Jangan Membuat Fixture Terlalu Cantik

Fixture harus mencakup data buruk:

- missing optional field;
- unknown field;
- enum unknown;
- null field;
- empty string;
- huge payload;
- invalid timestamp;
- old schema;
- future schema;
- duplicate id;
- invalid correlation id.

### 17.3 Golden Message Test

Golden message test memastikan producer tidak mengubah contract tanpa sadar.

```java
@Test
void shouldMatchGoldenApplicationSubmittedMessage() {
    OutboundMessage actual = factory.create(fixtureApplication());

    assertJsonEquals(
        resource("messages/application-submitted/v1/golden.json"),
        actual.payloadJson()
    );
}
```

Golden test jangan terlalu rigid untuk field yang memang dinamis seperti timestamp dan UUID. Normalisasi field dinamis sebelum assert.

---

## 18. Anti-Patterns dalam Testing JMS

### 18.1 `Thread.sleep()` Sebagai Sinkronisasi Utama

Ini membuat test lambat dan flaky.

### 18.2 Mock Semua JMS API

Mocking `Session`, `MessageProducer`, `Message`, `TextMessage`, `Queue`, dan `Connection` terlalu dalam biasanya menghasilkan test yang rapuh dan tidak representative.

Lebih baik:

- unit test mapper/handler tanpa JMS;
- integration test dengan broker nyata untuk JMS behavior.

### 18.3 Menganggap Queue Kosong Berarti Berhasil

Queue kosong bisa berarti:

- message sukses diproses;
- message di-prefetch tetapi belum diproses;
- message hilang karena auto-ack terlalu awal;
- message pindah DLQ;
- message dikonsumsi consumer lain;
- destination salah.

### 18.4 Tidak Membersihkan Broker State

Test bisa pass/fail tergantung urutan eksekusi.

### 18.5 Tidak Menguji Duplicate

Jika sistem tidak diuji dengan duplicate, sistem belum siap production.

### 18.6 Tidak Menguji Poison Message

Satu poison message bisa memblokir queue atau menyebabkan retry storm.

### 18.7 E2E untuk Semua Hal

E2E test lambat dan mahal. Gunakan unit/contract/component test sebagai mayoritas.

### 18.8 Test Terlalu Bergantung pada Provider-Specific Detail

Provider-specific behavior boleh diuji, tapi harus diberi label:

```text
Provider behavior test: Artemis redelivery/DLQ config
Portable contract test: consumer idempotency behavior
```

---

## 19. CI Strategy untuk JMS Test

### 19.1 Fast CI

Dijalankan setiap commit/PR:

- unit test handler;
- mapper test;
- schema compatibility test;
- contract test;
- small component test dengan broker container;
- duplicate/idempotency critical test.

Target: cepat dan deterministic.

### 19.2 Heavy CI / Nightly

Dijalankan scheduled:

- broker restart test;
- failure injection besar;
- concurrency stress;
- DLQ replay test besar;
- durable subscription offline/online;
- transaction timeout;
- performance smoke;
- long-running redelivery behavior.

### 19.3 Pre-Production Verification

Dijalankan sebelum release besar:

- real broker topology;
- real security config;
- real destination names;
- real TLS credential;
- HA/failover smoke;
- monitoring dashboard validation;
- DLQ alert validation;
- runbook replay drill.

---

## 20. Reference Test Matrix

| Area | Test | Layer | Must-have? |
|---|---:|---:|---:|
| Producer contract | Header/property/body stable | Unit/contract | Ya |
| Producer send | Message reaches destination | Component | Ya |
| Outbox | DB commit creates outbox | Integration | Ya jika outbox |
| Outbox relay | Broker down does not lose event | Failure | Ya jika outbox |
| Consumer happy path | Message creates side effect | Component | Ya |
| Ack/transaction | Exception causes redelivery | Component | Ya |
| Idempotency | Duplicate does not duplicate side effect | Component | Ya |
| Poison message | Invalid message enters DLQ | Component | Ya |
| DLQ replay | Repaired message can be replayed | Operational | Ya untuk critical system |
| Ordering | Per-aggregate order safe | Component/stress | Jika ordering matters |
| Selector | Property routing works | Component | Jika selector used |
| Security | Unauthorized access denied | Integration | Ya untuk enterprise |
| Observability | Correlation propagated | Component | Ya |
| Shutdown | In-flight message not lost | Failure | Ya |
| Broker restart | Client reconnect/recovery works | Heavy CI | Ya untuk HA system |

---

## 21. Production-Grade JMS Test Harness Design

Untuk sistem serius, buat internal test support module:

```text
jms-test-support/
  BrokerTestContainer
  DestinationNames
  JmsMessageBuilder
  JmsMessageBrowser
  QueueDepthProbe
  DlqProbe
  ListenerErrorProbe
  AwaitAssertions
  MessageFixtureLoader
  ContractAssertions
  FailureInjectionHandler
  ReplayToolTestClient
```

### 21.1 Message Builder

```java
public final class TestJmsMessageBuilder {
    private String messageId = UUID.randomUUID().toString();
    private String type;
    private String correlationId = UUID.randomUUID().toString();
    private final Map<String, String> properties = new LinkedHashMap<>();
    private String body = "{}";

    public TestJmsMessageBuilder type(String type) {
        this.type = type;
        return this;
    }

    public TestJmsMessageBuilder property(String name, String value) {
        properties.put(name, value);
        return this;
    }

    public TestJmsMessageBuilder body(String body) {
        this.body = body;
        return this;
    }

    public void send(JMSContext context, Destination destination) {
        TextMessage message = context.createTextMessage(body);
        try {
            message.setStringProperty("messageId", messageId);
            message.setStringProperty("messageType", type);
            message.setJMSCorrelationID(correlationId);
            for (Map.Entry<String, String> entry : properties.entrySet()) {
                message.setStringProperty(entry.getKey(), entry.getValue());
            }
        } catch (JMSException e) {
            throw new IllegalStateException(e);
        }
        context.createProducer().send(destination, message);
    }
}
```

### 21.2 Queue Probe

```java
public interface QueueProbe {
    int depth(String queueName);
    List<MessageSummary> browse(String queueName, int maxMessages);
    void purge(String queueName);
}
```

Implementasinya bisa provider-specific. Jangan campur provider-specific management API ke test business langsung.

---

## 22. Java 8 hingga Java 25 Considerations

### Java 8

- Umumnya masih memakai `javax.jms`.
- Tidak ada `var`, records, text blocks, virtual threads.
- Test async tetap bisa memakai Awaitility dengan lambda Java 8.
- Hati-hati library modern sudah meninggalkan Java 8.

### Java 11/17

- Banyak enterprise baseline berada di Java 11/17.
- Cocok untuk Spring Boot 2.x/3.x tergantung namespace.
- Java 17 sering menjadi baseline Jakarta/Spring modern.

### Java 21

- Virtual threads tersedia sebagai fitur final di Java 21.
- Jangan otomatis mengganti listener model JMS dengan virtual threads tanpa memahami session/thread-safety.
- Bisa berguna untuk test harness blocking receive atau orchestration test, tetapi listener container/broker client tetap punya constraint sendiri.

### Java 25

- JDK 25 adalah LTS terbaru dari jalur OpenJDK/Oracle pada 2025, sehingga seri ini mempertimbangkan runtime modern. [OpenJDK JDK 25](https://openjdk.org/projects/jdk/25/)
- Untuk JMS testing, manfaat utama Java modern biasanya ada pada observability, structured concurrency style di test harness, performance tooling, dan library baseline—not magically changing JMS semantics.

---

## 23. Checklist Review Test JMS

Gunakan checklist ini saat review PR yang menyentuh JMS.

### Producer

- [ ] Destination benar.
- [ ] Message type benar.
- [ ] Correlation id ada.
- [ ] Business idempotency key ada.
- [ ] Required properties ada.
- [ ] Payload schema compatible.
- [ ] Error send ditangani.
- [ ] Outbox behavior diuji jika digunakan.

### Consumer

- [ ] Happy path diuji.
- [ ] Invalid payload diuji.
- [ ] Duplicate message diuji.
- [ ] Redelivery diuji.
- [ ] DLQ diuji.
- [ ] Side effect idempotent.
- [ ] Ack/commit setelah side effect aman.
- [ ] Listener error tidak tersembunyi dari test.

### Async Test Quality

- [ ] Tidak memakai `Thread.sleep()` sebagai sinkronisasi utama.
- [ ] Ada timeout eksplisit.
- [ ] Ada diagnostic saat fail.
- [ ] Broker state isolated.
- [ ] Queue/DLQ dibersihkan.
- [ ] Test tidak tergantung urutan eksekusi.

### Contract

- [ ] Backward compatibility diuji.
- [ ] Unknown field diuji.
- [ ] Missing optional field diuji.
- [ ] Missing required field diuji.
- [ ] Version baru tidak merusak consumer lama.

### Operations

- [ ] DLQ replay diuji.
- [ ] Correlation id bisa ditelusuri.
- [ ] Security/ACL diuji minimal smoke.
- [ ] Broker restart/failover diuji untuk critical flow.

---

## 24. Latihan Engineering

### Latihan 1 — Duplicate Delivery

Buat consumer `PaymentCapturedConsumer`. Kirim dua message dengan idempotency key sama. Buktikan hanya satu ledger entry dibuat.

### Latihan 2 — Crash After DB Commit Before Ack

Inject failure setelah insert DB tetapi sebelum listener return/commit. Buktikan redelivery tidak menggandakan side effect.

### Latihan 3 — Poison Message to DLQ

Kirim message tanpa required field. Konfigurasikan max redelivery kecil di test. Buktikan message masuk DLQ dengan metadata diagnostic.

### Latihan 4 — Selector Contract

Buat consumer dengan selector `module = 'COMPLIANCE' AND severity = 'HIGH'`. Kirim 5 message dengan kombinasi properties berbeda. Buktikan hanya message relevan dikonsumsi.

### Latihan 5 — Outbox Broker Down

Matikan broker saat outbox relay berjalan. Buktikan outbox row tidak hilang dan akan terkirim setelah broker kembali.

### Latihan 6 — Durable Topic Subscriber

Buat durable subscriber, disconnect, publish message, reconnect, dan buktikan message diterima.

### Latihan 7 — Graceful Shutdown

Simulasikan consumer sedang memproses message lama. Trigger shutdown. Buktikan message tidak hilang dan side effect tidak setengah jadi.

---

## 25. Ringkasan Mental Model

Testing JMS yang matang bukan tentang “apakah queue menerima message”. Testing JMS yang matang membuktikan bahwa sistem tetap benar saat dunia tidak ideal.

Invariant utama:

```text
JMS test harus membuktikan semantic correctness,
bukan hanya transport success.
```

Untuk sistem enterprise, test minimal harus mencakup:

- producer contract;
- consumer side effect;
- idempotency;
- transaction/ack boundary;
- redelivery;
- DLQ;
- replay;
- ordering jika relevan;
- observability;
- security smoke;
- failure injection untuk flow kritikal.

Jangan membangun confidence dari sleep-based happy path test. Confidence yang benar muncul dari test yang deterministic, isolated, diagnostic-rich, dan sengaja menyerang failure window yang paling berbahaya.

---

## 26. Koneksi ke Part Berikutnya

Part berikutnya adalah:

**Part 29 — Deployment and Operations: Broker Topology, HA, Clustering, Failover, Backup, Upgrade**

Setelah memahami cara menguji JMS, kita akan masuk ke sisi operasi: bagaimana broker dijalankan, dibuat highly available, di-upgrade, dipulihkan, dimonitor, dan dipakai tanpa menciptakan single point of failure atau data loss.

---

## Status Seri

Seri belum selesai.

Progress saat ini:

```text
Selesai: Part 0 sampai Part 28
Total rencana: 35 part
Berikutnya: Part 29
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-027.md">⬅️ Part 27 — Observability: Metrics, Logs, Tracing, Correlation, Auditability, dan Forensic Debugging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-029.md">Part 29 — Deployment and Operations: Broker Topology, HA, Clustering, Failover, Backup, Upgrade ➡️</a>
</div>

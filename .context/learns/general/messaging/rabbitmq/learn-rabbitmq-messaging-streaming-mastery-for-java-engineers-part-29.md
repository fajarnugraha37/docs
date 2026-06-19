# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-29.md

# Part 29 — Testing Strategy for RabbitMQ-Based Java Systems

> Seri: RabbitMQ, RabbitMQ Streams, and Messaging Mastery for Java Engineers  
> Part: 29 / 34  
> Fokus: bagaimana menguji sistem Java berbasis RabbitMQ secara serius: unit, contract, integration, failure, redelivery, DLQ, retry, outbox, idempotency, stream replay, dan operability.

---

## 0. Posisi Part Ini Dalam Seri

Sampai part sebelumnya, kita sudah membangun banyak primitive:

- exchange, queue, binding, routing key
- publisher confirms
- mandatory publish dan returned messages
- consumer ack/nack/reject
- retry, DLQ, parking lot
- Spring AMQP
- message contract
- ordering dan partitioning
- RPC/request-reply
- workflow/saga
- RabbitMQ Streams
- quorum queues
- flow control
- clustering
- federation/shovel
- security
- observability
- performance
- topology patterns
- anti-patterns dan failure case studies

Part ini menjawab pertanyaan yang biasanya paling menentukan kualitas engineering:

> Bagaimana kita tahu desain RabbitMQ kita benar sebelum production membuktikan sebaliknya?

Masalahnya, messaging system punya sifat yang membuat testing lebih sulit daripada HTTP endpoint biasa:

- async
- at-least-once
- duplicate-prone
- order-sensitive
- retryable
- failure outcome kadang unknown
- topology-dependent
- state tersebar antara broker, database, outbox, inbox, DLQ, dan consumer
- observability harus diuji, bukan diasumsikan

Karena itu testing RabbitMQ tidak cukup dengan:

```text
send message -> sleep 3 seconds -> assert something happened
```

Itu fragile, lambat, dan sering menyembunyikan race condition.

Target part ini adalah membuat testing strategy yang:

1. cepat untuk logic murni,
2. realistis untuk broker behavior,
3. eksplisit untuk failure semantics,
4. bisa dipakai di CI,
5. bisa mendeteksi regression topology,
6. tidak bergantung pada timing kebetulan,
7. membuktikan idempotency dan recovery.

---

## 1. Mental Model: Apa yang Sebenarnya Harus Dites?

Sistem RabbitMQ tidak hanya terdiri dari kode handler.

Minimal ada lima layer yang berbeda:

```text
[1] Contract Layer
    message schema, metadata, versioning, compatibility

[2] Application Logic Layer
    business validation, state transition, side effect decision

[3] Messaging Adapter Layer
    publish, consume, ack, nack, retry, DLQ, confirms, returns

[4] Broker Topology Layer
    exchange, binding, queue type, DLX, TTL, policies, stream retention

[5] Operational Behavior Layer
    backlog, redelivery, duplicate, crash, restart, blocked publisher, observability
```

Testing yang matang tidak mencoba menguji semua layer dengan satu jenis test.

Kita pakai test pyramid yang disesuaikan untuk messaging:

```text
                 [Chaos / Failure Drill]
              [Load / Performance Test]
           [End-to-End Workflow Test]
        [Integration Test with RabbitMQ]
     [Contract / Compatibility Test]
  [Unit Test: Handler + Policy + Mapper]
```

Tujuannya bukan “punya banyak test”, tetapi setiap test punya tanggung jawab jelas.

---

## 2. Prinsip Testing Messaging yang Baik

### 2.1 Jangan Tes Asynchronous dengan Sleep Buta

Anti-pattern:

```java
publisher.publish(event);
Thread.sleep(3000);
assertEquals(APPROVED, repository.findById(caseId).status());
```

Masalah:

- lambat kalau semua test sleep
- flaky kalau CI lambat
- tidak tahu apakah handler gagal atau hanya telat
- tidak memberi observability failure yang baik

Lebih baik:

```java
await()
    .atMost(Duration.ofSeconds(10))
    .untilAsserted(() -> {
        var entity = repository.findById(caseId).orElseThrow();
        assertEquals(APPROVED, entity.status());
    });
```

Dengan Awaitility atau polling assertion yang bounded.

Prinsipnya:

> Async test harus menunggu kondisi, bukan menunggu waktu.

---

### 2.2 Pisahkan Business Handler dari RabbitMQ Adapter

Consumer yang buruk untuk dites:

```java
@RabbitListener(queues = "case.review.requested.q")
void onMessage(Message message, Channel channel) throws IOException {
    var dto = objectMapper.readValue(message.getBody(), ReviewRequested.class);

    var caseEntity = repository.findById(dto.caseId()).orElseThrow();
    caseEntity.assignReviewer(dto.reviewerId());
    repository.save(caseEntity);

    channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
}
```

Masalah:

- parsing, validation, business logic, DB transaction, dan ack bercampur
- unit test sulit
- ack behavior sulit disimulasikan
- exception taxonomy tidak eksplisit

Lebih baik pisahkan:

```text
Rabbit Listener Adapter
    -> parse envelope
    -> validate transport metadata
    -> call application handler
    -> map result/exception to ack/nack/retry/DLQ decision

Application Handler
    -> pure business operation
    -> transaction boundary
    -> idempotency
    -> domain transition
```

Contoh desain:

```java
public interface MessageHandler<T> {
    HandlerResult handle(MessageEnvelope<T> envelope);
}

public sealed interface HandlerResult {
    record Success() implements HandlerResult {}
    record DuplicateIgnored() implements HandlerResult {}
    record PermanentFailure(String reason) implements HandlerResult {}
    record TransientFailure(String reason) implements HandlerResult {}
}
```

Rabbit adapter bisa dites terpisah dari business handler.

---

### 2.3 Test Invariant, Bukan Implementasi Internal

Messaging tests harus menjawab hal seperti:

- apakah message valid menghasilkan state transition yang benar?
- apakah duplicate message tidak membuat side effect dobel?
- apakah invalid message masuk DLQ/parking lot?
- apakah transient failure diretry dengan batas?
- apakah message unroutable terdeteksi publisher?
- apakah topology yang dideklarasikan sesuai kontrak?
- apakah consumer tidak ack sebelum commit?
- apakah replay stream tidak mengirim notifikasi eksternal ulang?

Bukan sekadar:

- method X dipanggil 1 kali
- class Y membuat object Z
- listener dipanggil dalam 2 detik

---

## 3. Unit Testing Message Handler

Unit test harus cepat, deterministic, dan tidak butuh RabbitMQ.

Cocok untuk:

- business rule
- state transition
- idempotency decision
- validation
- mapper
- retry classification
- contract envelope creation
- routing key builder
- message type registry

### 3.1 Contoh Domain

Kita pakai contoh regulatory case-management:

```java
public record EvidenceSubmittedEvent(
    UUID caseId,
    UUID evidenceId,
    String evidenceType,
    Instant submittedAt,
    String submittedBy
) {}
```

Envelope:

```java
public record MessageEnvelope<T>(
    UUID messageId,
    String messageType,
    int schemaVersion,
    UUID correlationId,
    UUID causationId,
    String tenantId,
    Instant occurredAt,
    T payload
) {}
```

Handler:

```java
public final class EvidenceSubmittedHandler {
    private final CaseRepository caseRepository;
    private final InboxRepository inboxRepository;
    private final RiskEvaluationRequestPublisher publisher;

    @Transactional
    public HandlerResult handle(MessageEnvelope<EvidenceSubmittedEvent> envelope) {
        if (inboxRepository.exists(envelope.messageId())) {
            return new HandlerResult.DuplicateIgnored();
        }

        var event = envelope.payload();
        var caseEntity = caseRepository.findById(event.caseId())
            .orElseThrow(() -> new PermanentBusinessException("case_not_found"));

        caseEntity.recordEvidence(event.evidenceId(), event.evidenceType(), event.submittedAt());

        inboxRepository.saveProcessed(envelope.messageId(), envelope.correlationId());
        caseRepository.save(caseEntity);

        publisher.requestRiskEvaluation(event.caseId(), envelope.correlationId(), envelope.messageId());

        return new HandlerResult.Success();
    }
}
```

### 3.2 Unit Test: Valid Event

```java
@Test
void should_record_evidence_and_request_risk_evaluation() {
    var caseId = UUID.randomUUID();
    var messageId = UUID.randomUUID();
    var correlationId = UUID.randomUUID();

    var caseEntity = CaseEntity.open(caseId);
    when(caseRepository.findById(caseId)).thenReturn(Optional.of(caseEntity));
    when(inboxRepository.exists(messageId)).thenReturn(false);

    var envelope = new MessageEnvelope<>(
        messageId,
        "case.evidence.submitted",
        1,
        correlationId,
        UUID.randomUUID(),
        "tenant-a",
        Instant.now(),
        new EvidenceSubmittedEvent(caseId, UUID.randomUUID(), "PDF", Instant.now(), "officer-1")
    );

    var result = handler.handle(envelope);

    assertInstanceOf(HandlerResult.Success.class, result);
    verify(caseRepository).save(argThat(c -> c.hasEvidence(envelope.payload().evidenceId())));
    verify(inboxRepository).saveProcessed(messageId, correlationId);
    verify(publisher).requestRiskEvaluation(caseId, correlationId, messageId);
}
```

### 3.3 Unit Test: Duplicate Event

```java
@Test
void should_ignore_duplicate_message() {
    var messageId = UUID.randomUUID();
    var envelope = TestMessages.evidenceSubmitted(messageId);

    when(inboxRepository.exists(messageId)).thenReturn(true);

    var result = handler.handle(envelope);

    assertInstanceOf(HandlerResult.DuplicateIgnored.class, result);
    verifyNoInteractions(caseRepository);
    verifyNoInteractions(publisher);
}
```

Key invariant:

> Duplicate message must not produce duplicate business effect.

Ini jauh lebih penting daripada “consumer menerima message sekali”. RabbitMQ tidak menjamin once-only delivery.

---

## 4. Unit Testing Retry Classification

Retry decision jangan tersebar di banyak catch block.

Buat classifier eksplisit:

```java
public enum FailureDecision {
    ACK_SUCCESS,
    ACK_DUPLICATE,
    REJECT_TO_DLX,
    NACK_REQUEUE,
    REPUBLISH_DELAYED_RETRY,
    PARKING_LOT
}
```

Classifier:

```java
public final class ConsumerFailureClassifier {
    public FailureDecision classify(Throwable error, MessageContext context) {
        if (error instanceof ValidationException) {
            return FailureDecision.REJECT_TO_DLX;
        }
        if (error instanceof PermanentBusinessException) {
            return FailureDecision.REJECT_TO_DLX;
        }
        if (error instanceof DatabaseDeadlockException && context.retryCount() < 5) {
            return FailureDecision.REPUBLISH_DELAYED_RETRY;
        }
        if (error instanceof ExternalServiceTimeoutException && context.retryCount() < 10) {
            return FailureDecision.REPUBLISH_DELAYED_RETRY;
        }
        return FailureDecision.PARKING_LOT;
    }
}
```

Tests:

```java
@Test
void validation_error_should_not_be_requeued() {
    var decision = classifier.classify(
        new ValidationException("missing caseId"),
        new MessageContext(0, false)
    );

    assertEquals(FailureDecision.REJECT_TO_DLX, decision);
}

@Test
void transient_timeout_should_retry_until_limit() {
    var decision = classifier.classify(
        new ExternalServiceTimeoutException("risk service timeout"),
        new MessageContext(3, true)
    );

    assertEquals(FailureDecision.REPUBLISH_DELAYED_RETRY, decision);
}

@Test
void transient_timeout_after_limit_should_go_to_parking_lot() {
    var decision = classifier.classify(
        new ExternalServiceTimeoutException("risk service timeout"),
        new MessageContext(10, true)
    );

    assertEquals(FailureDecision.PARKING_LOT, decision);
}
```

Invariant:

> No poison message should be infinitely requeued.

---

## 5. Contract Testing

RabbitMQ tidak memberi schema registry bawaan seperti ekosistem Kafka tertentu. Karena itu contract discipline harus dibuat di level aplikasi.

Contract test menjawab:

- apakah producer masih menghasilkan payload yang consumer bisa baca?
- apakah field wajib masih ada?
- apakah schema version benar?
- apakah enum value baru tidak mematahkan consumer lama?
- apakah metadata envelope konsisten?
- apakah routing key sesuai taxonomy?

### 5.1 Golden Sample Contract

Simpan sample message sebagai file:

```text
src/test/resources/contracts/case.evidence.submitted.v1.json
```

Contoh:

```json
{
  "messageId": "018f4a0a-9af8-7f20-a301-1690e77ef54e",
  "messageType": "case.evidence.submitted",
  "schemaVersion": 1,
  "correlationId": "018f4a0a-9af8-7f20-a301-1690e77ef54f",
  "causationId": "018f4a0a-9af8-7f20-a301-1690e77ef550",
  "tenantId": "tenant-a",
  "occurredAt": "2026-06-19T09:15:30Z",
  "payload": {
    "caseId": "018f4a0a-9af8-7f20-a301-1690e77ef551",
    "evidenceId": "018f4a0a-9af8-7f20-a301-1690e77ef552",
    "evidenceType": "PDF",
    "submittedAt": "2026-06-19T09:15:00Z",
    "submittedBy": "officer-1"
  }
}
```

Consumer contract test:

```java
@Test
void should_deserialize_evidence_submitted_v1_contract() throws Exception {
    var json = Files.readString(Path.of(
        "src/test/resources/contracts/case.evidence.submitted.v1.json"
    ));

    var envelope = objectMapper.readValue(
        json,
        new TypeReference<MessageEnvelope<EvidenceSubmittedEvent>>() {}
    );

    assertEquals("case.evidence.submitted", envelope.messageType());
    assertEquals(1, envelope.schemaVersion());
    assertNotNull(envelope.payload().caseId());
    assertEquals("PDF", envelope.payload().evidenceType());
}
```

### 5.2 Producer Golden Sample Test

```java
@Test
void producer_should_generate_contract_compatible_message() throws Exception {
    var event = new EvidenceSubmittedEvent(
        UUID.fromString("018f4a0a-9af8-7f20-a301-1690e77ef551"),
        UUID.fromString("018f4a0a-9af8-7f20-a301-1690e77ef552"),
        "PDF",
        Instant.parse("2026-06-19T09:15:00Z"),
        "officer-1"
    );

    var envelope = envelopeFactory.create(
        "case.evidence.submitted",
        1,
        "tenant-a",
        event
    );

    var json = objectMapper.writeValueAsString(envelope);

    assertThatJson(json)
        .node("messageType").isEqualTo("case.evidence.submitted");
    assertThatJson(json)
        .node("schemaVersion").isEqualTo(1);
    assertThatJson(json)
        .node("payload.evidenceType").isEqualTo("PDF");
}
```

Untuk field dinamis seperti UUID dan timestamp, gunakan matcher atau normalize sebelum compare.

---

## 6. Topology Testing

Topology adalah contract operasional.

Kalau exchange, queue, binding, DLX, TTL, queue type, atau policy berubah tanpa review, behavior bisa berubah drastis.

Topology test harus memverifikasi:

- exchange exists
- exchange type benar
- queue exists
- queue type benar: quorum/classic/stream
- binding benar
- DLX benar
- DLQ ada
- TTL/retry queue benar
- alternate exchange benar
- durable true
- auto-delete false untuk production queue
- exclusive false untuk shared production queue

### 6.1 Test Topology Bean di Spring

```java
@SpringBootTest
class RabbitTopologyBeanTest {

    @Autowired
    List<Declarable> declarables;

    @Test
    void should_define_case_event_exchange() {
        assertThat(declarables)
            .filteredOn(d -> d instanceof TopicExchange)
            .map(d -> ((TopicExchange) d).getName())
            .contains("case.events.x");
    }

    @Test
    void should_define_review_command_quorum_queue() {
        var queues = declarables.stream()
            .filter(Queue.class::isInstance)
            .map(Queue.class::cast)
            .toList();

        var queue = queues.stream()
            .filter(q -> q.getName().equals("case.review.requested.q"))
            .findFirst()
            .orElseThrow();

        assertEquals("quorum", queue.getArguments().get("x-queue-type"));
        assertEquals("case.dlx", queue.getArguments().get("x-dead-letter-exchange"));
    }
}
```

### 6.2 Test Actual Broker Topology via Management API

Bean test hanya memastikan aplikasi mendeklarasikan sesuatu. Actual broker test memastikan broker benar-benar punya topology.

Dengan Testcontainers RabbitMQ + Management API:

```java
@Test
void broker_should_have_expected_queue_arguments() {
    var queueInfo = rabbitHttpClient.getQueue("/", "case.review.requested.q");

    assertEquals(true, queueInfo.durable());
    assertEquals("quorum", queueInfo.arguments().get("x-queue-type"));
    assertEquals("case.dlx", queueInfo.arguments().get("x-dead-letter-exchange"));
}
```

Invariant:

> Topology drift should fail CI before it fails production.

---

## 7. Integration Testing with Testcontainers

Untuk behavior broker nyata, gunakan RabbitMQ asli melalui Testcontainers.

### 7.1 Dependency

Maven contoh:

```xml
<dependencies>
    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>rabbitmq</artifactId>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>org.awaitility</groupId>
        <artifactId>awaitility</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

### 7.2 Container Setup

```java
@Testcontainers
@SpringBootTest
class RabbitIntegrationTest {

    @Container
    static RabbitMQContainer rabbit = new RabbitMQContainer("rabbitmq:4-management")
        .withExposedPorts(5672, 15672)
        .withPluginsEnabled("rabbitmq_management");

    @DynamicPropertySource
    static void rabbitProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.rabbitmq.host", rabbit::getHost);
        registry.add("spring.rabbitmq.port", rabbit::getAmqpPort);
        registry.add("spring.rabbitmq.username", rabbit::getAdminUsername);
        registry.add("spring.rabbitmq.password", rabbit::getAdminPassword);
    }
}
```

Kalau butuh stream plugin:

```java
static RabbitMQContainer rabbit = new RabbitMQContainer("rabbitmq:4-management")
    .withPluginsEnabled("rabbitmq_management", "rabbitmq_stream", "rabbitmq_stream_management")
    .withExposedPorts(5672, 5552, 15672);
```

### 7.3 Integration Test: Publish Event, Consumer Updates DB

```java
@Test
void evidence_submitted_event_should_trigger_case_update() {
    var caseId = UUID.randomUUID();
    caseRepository.save(CaseEntity.open(caseId));

    var event = TestMessages.evidenceSubmitted(caseId);

    rabbitTemplate.convertAndSend(
        "case.events.x",
        "case.evidence.submitted",
        event
    );

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        var entity = caseRepository.findById(caseId).orElseThrow();
        assertTrue(entity.hasEvidence(event.payload().evidenceId()));
    });
}
```

### 7.4 Integration Test: Invalid Message Goes to DLQ

```java
@Test
void invalid_message_should_go_to_dlq() {
    var invalidPayload = "{\"messageType\":\"case.evidence.submitted\",\"payload\":{}}";

    rabbitTemplate.convertAndSend(
        "case.events.x",
        "case.evidence.submitted",
        invalidPayload
    );

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        var dlqMessage = rabbitTemplate.receive("case.evidence.submitted.dlq");
        assertNotNull(dlqMessage);
    });
}
```

Caveat:

- Kalau test mengambil message dari DLQ, test itu juga menghapus message dari DLQ.
- Untuk verifikasi non-destructive, gunakan Management API count atau dedicated test queue.

---

## 8. Testing Publisher Confirms and Returns

Publisher reliability harus dites secara eksplisit.

### 8.1 Test Unroutable Message with Mandatory Publish

Scenario:

- exchange ada
- routing key tidak punya binding
- mandatory true
- publisher harus menerima returned message
- aplikasi tidak boleh menganggap publish sukses bisnis

Contoh adapter result:

```java
public sealed interface PublishResult {
    record Confirmed(UUID messageId) implements PublishResult {}
    record Returned(UUID messageId, String replyText) implements PublishResult {}
    record Nacked(UUID messageId, String reason) implements PublishResult {}
    record TimedOut(UUID messageId) implements PublishResult {}
}
```

Test:

```java
@Test
void publisher_should_report_returned_when_message_is_unroutable() {
    var result = publisher.publish(
        "case.events.x",
        "case.unknown.event",
        TestMessages.evidenceSubmitted()
    );

    assertInstanceOf(PublishResult.Returned.class, result);
}
```

### 8.2 Test Exchange Missing

```java
@Test
void publisher_should_fail_when_exchange_does_not_exist() {
    assertThrows(PublishTopologyException.class, () -> {
        publisher.publish(
            "missing.exchange",
            "case.evidence.submitted",
            TestMessages.evidenceSubmitted()
        );
    });
}
```

Failure type harus berbeda:

```text
missing exchange  -> channel exception / topology error
unroutable message -> returned message if mandatory=true
broker accepted    -> publisher confirm ack
```

### 8.3 Test Confirm Timeout

Confirm timeout sulit dipicu secara deterministic di unit/integration test biasa.

Untuk adapter, tes dengan fake confirm gateway:

```java
@Test
void publisher_should_treat_confirm_timeout_as_unknown_outcome() {
    fakeConfirmGateway.neverCompletes();

    var result = publisher.publishWithTimeout(TestMessages.evidenceSubmitted(), Duration.ofMillis(50));

    assertInstanceOf(PublishResult.TimedOut.class, result);
}
```

Invariant:

> Confirm timeout is not equivalent to broker rejection. It is unknown outcome.

---

## 9. Testing Consumer Acknowledgement Semantics

Ack behavior sulit dites kalau listener langsung terikat ke RabbitMQ.

Pisahkan adapter decision.

### 9.1 Adapter Unit Test with Fake Channel

Misal adapter:

```java
public final class ManualAckListenerAdapter<T> {
    private final MessageDecoder<T> decoder;
    private final MessageHandler<T> handler;
    private final ConsumerFailureClassifier classifier;

    public void onMessage(Message amqpMessage, Channel channel) throws IOException {
        long tag = amqpMessage.getMessageProperties().getDeliveryTag();
        try {
            var envelope = decoder.decode(amqpMessage);
            var result = handler.handle(envelope);
            channel.basicAck(tag, false);
        } catch (Throwable error) {
            var decision = classifier.classify(error, MessageContext.from(amqpMessage));
            applyDecision(channel, tag, decision);
        }
    }
}
```

Test:

```java
@Test
void should_ack_when_handler_succeeds() throws Exception {
    when(handler.handle(any())).thenReturn(new HandlerResult.Success());

    adapter.onMessage(amqpMessageWithDeliveryTag(42L), channel);

    verify(channel).basicAck(42L, false);
    verify(channel, never()).basicNack(anyLong(), anyBoolean(), anyBoolean());
}

@Test
void should_reject_without_requeue_for_permanent_failure() throws Exception {
    when(handler.handle(any())).thenThrow(new PermanentBusinessException("invalid"));
    when(classifier.classify(any(), any())).thenReturn(FailureDecision.REJECT_TO_DLX);

    adapter.onMessage(amqpMessageWithDeliveryTag(42L), channel);

    verify(channel).basicReject(42L, false);
}

@Test
void should_not_infinite_requeue_poison_message() throws Exception {
    when(handler.handle(any())).thenThrow(new ValidationException("bad payload"));
    when(classifier.classify(any(), any())).thenReturn(FailureDecision.REJECT_TO_DLX);

    adapter.onMessage(amqpMessageWithDeliveryTag(42L), channel);

    verify(channel, never()).basicNack(42L, false, true);
    verify(channel).basicReject(42L, false);
}
```

### 9.2 Integration Test: Consumer Crash Before Ack

Untuk membuktikan redelivery, perlu scenario nyata.

Desain test:

1. publish message
2. consumer pertama menerima lalu crash sebelum ack
3. consumer kedua menerima ulang
4. assert `redelivered=true` atau side effect idempotent

Pseudo:

```java
@Test
void unacked_message_should_be_redelivered_after_consumer_channel_closes() throws Exception {
    var connection = connectionFactory.newConnection();
    var channel = connection.createChannel();
    channel.basicQos(1);

    rabbitTemplate.convertAndSend("case.commands.x", "case.review.requested", payload);

    var delivery = nextDeliveryWithoutAck(channel, "case.review.requested.q");
    assertNotNull(delivery);

    channel.close();
    connection.close();

    var secondConnection = connectionFactory.newConnection();
    var secondChannel = secondConnection.createChannel();

    var redelivery = nextDeliveryWithoutAck(secondChannel, "case.review.requested.q");

    assertTrue(redelivery.getEnvelope().isRedeliver());
}
```

Gunakan hati-hati karena low-level client test bisa lebih kompleks daripada Spring listener test.

---

## 10. Testing Idempotency

Idempotency adalah test wajib.

### 10.1 Duplicate Same Message ID

```java
@Test
void duplicate_message_id_should_not_duplicate_side_effect() {
    var messageId = UUID.randomUUID();
    var event = TestMessages.evidenceSubmittedWithMessageId(messageId);

    rabbitTemplate.convertAndSend("case.events.x", "case.evidence.submitted", event);
    rabbitTemplate.convertAndSend("case.events.x", "case.evidence.submitted", event);

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        var evidenceRows = evidenceRepository.findByMessageId(messageId);
        assertEquals(1, evidenceRows.size());
    });

    assertEquals(1, riskEvaluationRequestRepository.countByCausationId(messageId));
}
```

### 10.2 Same Business Event, Different Message ID

Kadang duplicate datang dengan message ID berbeda tetapi business key sama.

Contoh:

- same `caseId`
- same `evidenceId`
- different `messageId`

Test:

```java
@Test
void duplicate_business_key_should_not_create_duplicate_evidence() {
    var caseId = UUID.randomUUID();
    var evidenceId = UUID.randomUUID();

    var event1 = TestMessages.evidenceSubmitted(caseId, evidenceId, UUID.randomUUID());
    var event2 = TestMessages.evidenceSubmitted(caseId, evidenceId, UUID.randomUUID());

    rabbitTemplate.convertAndSend("case.events.x", "case.evidence.submitted", event1);
    rabbitTemplate.convertAndSend("case.events.x", "case.evidence.submitted", event2);

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        assertEquals(1, evidenceRepository.countByEvidenceId(evidenceId));
    });
}
```

Dua level idempotency:

```text
message idempotency  -> same message not processed twice
business idempotency -> same business fact not applied twice
```

Sistem kuat biasanya butuh keduanya.

---

## 11. Testing Retry and DLQ

Retry test harus menghindari durasi panjang. Jangan pakai retry TTL 5 menit dalam CI.

Gunakan test profile:

```yaml
app:
  messaging:
    retry:
      first-delay-ms: 100
      second-delay-ms: 200
      max-attempts: 3
```

### 11.1 Transient Failure Eventually Succeeds

```java
@Test
void transient_failure_should_retry_and_eventually_succeed() {
    externalRiskService.failNextCalls(2);

    rabbitTemplate.convertAndSend(
        "case.commands.x",
        "case.risk.evaluate",
        TestMessages.riskEvaluationRequested()
    );

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        assertEquals(3, externalRiskService.callCount());
        assertEquals(1, riskResultRepository.count());
    });

    assertQueueEmpty("case.risk.evaluate.dlq");
}
```

### 11.2 Permanent Failure Goes to DLQ

```java
@Test
void permanent_failure_should_go_to_dlq_without_retry_storm() {
    var invalid = TestMessages.invalidRiskEvaluationRequest();

    rabbitTemplate.convertAndSend("case.commands.x", "case.risk.evaluate", invalid);

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        assertQueueDepth("case.risk.evaluate.dlq", 1);
    });

    assertThat(handlerInvocationCounter.countFor(invalid.messageId()))
        .isLessThanOrEqualTo(1);
}
```

### 11.3 Exhausted Retry Goes to Parking Lot

```java
@Test
void exhausted_retries_should_move_to_parking_lot() {
    externalRiskService.alwaysTimeout();

    rabbitTemplate.convertAndSend(
        "case.commands.x",
        "case.risk.evaluate",
        TestMessages.riskEvaluationRequested()
    );

    await().atMost(Duration.ofSeconds(15)).untilAsserted(() -> {
        assertQueueDepth("case.risk.evaluate.parking.q", 1);
    });

    assertThat(externalRiskService.callCount()).isEqualTo(3);
}
```

Invariant:

> Retry must be bounded, observable, and classified.

---

## 12. Testing Outbox Pattern

Outbox is critical for publisher correctness around DB transaction boundary.

### 12.1 Unit Test Outbox Record Creation

```java
@Test
void domain_transaction_should_create_outbox_event() {
    var caseId = UUID.randomUUID();

    caseService.submitEvidence(caseId, evidenceCommand);

    var outbox = outboxRepository.findByAggregateId(caseId);
    assertEquals(1, outbox.size());
    assertEquals("case.evidence.submitted", outbox.getFirst().messageType());
}
```

### 12.2 Relay Publishes and Marks Sent Only After Confirm

```java
@Test
void relay_should_mark_outbox_sent_only_after_publisher_confirm() {
    var record = outboxRepository.save(TestOutbox.pendingEvidenceSubmitted());

    fakePublisher.confirmNextPublish();

    relay.runOnce();

    var updated = outboxRepository.findById(record.id()).orElseThrow();
    assertEquals(OutboxStatus.SENT, updated.status());
}

@Test
void relay_should_not_mark_sent_when_confirm_timeout() {
    var record = outboxRepository.save(TestOutbox.pendingEvidenceSubmitted());

    fakePublisher.timeoutNextPublish();

    relay.runOnce();

    var updated = outboxRepository.findById(record.id()).orElseThrow();
    assertEquals(OutboxStatus.UNKNOWN_OR_PENDING, updated.status());
}
```

### 12.3 Duplicate Publish Safety

```java
@Test
void relay_retry_after_unknown_outcome_should_be_safe_due_to_stable_message_id() {
    var record = outboxRepository.save(TestOutbox.pendingEvidenceSubmittedWithStableMessageId());

    fakePublisher.timeoutNextPublish();
    relay.runOnce();

    fakePublisher.confirmNextPublish();
    relay.runOnce();

    assertEquals(2, fakePublisher.publishAttempts(record.messageId()));
    assertEquals(1, downstreamInbox.countByMessageId(record.messageId()));
}
```

Invariant:

> Outbox retry can duplicate publish attempts; consumers must tolerate duplicates.

---

## 13. Testing Inbox Pattern

Inbox prevents duplicate consumer side effects.

### 13.1 Race Condition Test

Duplicate messages may be processed concurrently by multiple consumers if topology/partitioning allows it.

Test with two threads:

```java
@Test
void concurrent_duplicate_messages_should_apply_business_effect_once() throws Exception {
    var envelope = TestMessages.evidenceSubmitted();
    var latch = new CountDownLatch(2);
    var executor = Executors.newFixedThreadPool(2);

    var task = (Callable<HandlerResult>) () -> {
        latch.countDown();
        latch.await();
        return handler.handle(envelope);
    };

    var f1 = executor.submit(task);
    var f2 = executor.submit(task);

    var results = List.of(f1.get(), f2.get());

    assertEquals(1, evidenceRepository.countByEvidenceId(envelope.payload().evidenceId()));
    assertEquals(1, inboxRepository.countByMessageId(envelope.messageId()));
}
```

Untuk lulus, DB harus punya unique constraint:

```sql
CREATE UNIQUE INDEX ux_inbox_message_id ON message_inbox(message_id);
```

Jangan hanya mengandalkan `exists()` lalu `insert()`, karena itu race-prone tanpa constraint.

---

## 14. Testing Ordering and State Guards

Ordering tidak selalu dijamin end-to-end. Test state machine guard.

Scenario:

- `CaseEscalated` datang sebelum `CaseReviewCompleted`
- duplicate `CaseReviewCompleted`
- stale version event datang setelah newer event

### 14.1 Out-of-Order Event

```java
@Test
void out_of_order_event_should_not_break_case_state() {
    var caseId = UUID.randomUUID();
    caseRepository.save(CaseEntity.open(caseId));

    rabbitTemplate.convertAndSend(
        "case.events.x",
        "case.escalated",
        TestMessages.caseEscalated(caseId, version: 3)
    );

    rabbitTemplate.convertAndSend(
        "case.events.x",
        "case.review.completed",
        TestMessages.caseReviewCompleted(caseId, version: 2)
    );

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        var entity = caseRepository.findById(caseId).orElseThrow();
        assertEquals(CaseStatus.ESCALATED, entity.status());
        assertEquals(3, entity.version());
    });
}
```

State guard:

```java
if (event.version() <= caseEntity.version()) {
    return DuplicateOrStale.ignored();
}
```

Invariant:

> Business correctness must not depend solely on broker delivery order.

---

## 15. Testing RabbitMQ Streams

RabbitMQ Streams test berbeda dari queue test.

Yang diuji:

- producer confirm
- deduplication
- offset store
- replay from offset/timestamp/beginning
- idempotent projection rebuild
- filter behavior
- stream retention assumptions

### 15.1 Test Stream Producer Deduplication

Pseudo:

```java
@Test
void stream_should_deduplicate_same_producer_and_publishing_id() {
    var producerName = "audit-relay-test";
    var publishingId = 1001L;

    streamPublisher.publish(producerName, publishingId, TestMessages.auditEvent());
    streamPublisher.publish(producerName, publishingId, TestMessages.auditEvent());

    var events = streamConsumer.readFromBeginning("case.audit.s", Duration.ofSeconds(5));

    assertEquals(1, events.stream()
        .filter(e -> e.publishingId() == publishingId)
        .count());
}
```

### 15.2 Test Replay Does Not Trigger External Side Effects

```java
@Test
void replay_consumer_should_rebuild_projection_without_sending_notifications() {
    streamPublisher.publishMany(TestMessages.caseLifecycleAuditEvents());

    replayProjectionConsumer.rebuildFromBeginning();

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        assertEquals(expectedProjectionCount, projectionRepository.count());
    });

    verify(notificationGateway, never()).send(any());
}
```

Replay invariant:

```text
Live consumer may trigger side effects.
Replay consumer must usually not trigger irreversible side effects.
```

### 15.3 Test Offset Commit After Projection Commit

```java
@Test
void stream_offset_should_be_stored_after_projection_commit() {
    projectionRepository.failNextCommit();

    streamConsumer.processNextBatch();

    assertEquals(previousOffset, offsetRepository.currentOffset("case.audit.projection"));
}
```

Invariant:

> Never advance offset beyond durable business progress.

---

## 16. Testing Request/Reply RPC

RPC over RabbitMQ must test timeout, late reply, duplicate reply, and correlation mismatch.

### 16.1 Timeout Is Unknown

```java
@Test
void rpc_timeout_should_return_unknown_not_business_failure() {
    responder.delayBeyondClientTimeout();

    var result = client.requestRiskScore(caseId);

    assertInstanceOf(RpcResult.UnknownTimeout.class, result);
}
```

### 16.2 Late Reply Ignored or Handled Safely

```java
@Test
void late_reply_should_not_corrupt_new_request() {
    responder.delayFirstReply();

    var first = client.requestRiskScore(caseId);
    var second = client.requestRiskScore(caseId);

    assertThat(first).isInstanceOf(RpcResult.UnknownTimeout.class);
    assertThat(second).isInstanceOf(RpcResult.Success.class);

    assertNoCorrelationLeakage();
}
```

### 16.3 Correlation ID Mismatch

```java
@Test
void reply_with_wrong_correlation_id_should_be_discarded() {
    replyQueue.injectReplyWithCorrelationId(UUID.randomUUID().toString());

    assertThat(client.pendingRequests()).doesNotCompleteUnexpectedly();
}
```

Invariant:

> Reply must be matched by correlation ID, not by arrival order.

---

## 17. Testing Security and Permissions

Security is testable.

Examples:

- publisher user can write exchange but cannot read queue
- consumer user can read queue but cannot configure topology
- app user cannot access another vhost
- topology deployer can configure but runtime user cannot

### 17.1 Permission Test

```java
@Test
void runtime_consumer_should_not_be_allowed_to_declare_topology() {
    var factory = connectionFactoryFor("case-review-consumer", "secret");

    assertThrows(IOException.class, () -> {
        try (var connection = factory.newConnection();
             var channel = connection.createChannel()) {
            channel.exchangeDeclare("unauthorized.x", "topic", true);
        }
    });
}
```

### 17.2 Cross-Vhost Isolation Test

```java
@Test
void service_account_should_not_access_other_vhost() {
    var factory = connectionFactoryForVhost("tenant-b", "tenant-a-service", "secret");

    assertThrows(AuthenticationFailureException.class, factory::newConnection);
}
```

Do not run all security tests on every unit build if setup is expensive, but run them in integration pipeline.

---

## 18. Testing Observability

Observability must be tested because incident response depends on it.

### 18.1 Log Correlation Test

Use a test appender:

```java
@Test
void consumer_logs_should_include_message_identity() {
    var event = TestMessages.evidenceSubmitted();

    handler.handle(event);

    assertThat(testLogAppender.events())
        .anySatisfy(log -> {
            assertThat(log).contains("messageId=" + event.messageId());
            assertThat(log).contains("correlationId=" + event.correlationId());
            assertThat(log).contains("messageType=case.evidence.submitted");
        });
}
```

### 18.2 Metrics Test

```java
@Test
void consumer_should_increment_success_metric() {
    var before = meterRegistry.counter("rabbit.consumer.processed", "result", "success").count();

    handler.handle(TestMessages.evidenceSubmitted());

    var after = meterRegistry.counter("rabbit.consumer.processed", "result", "success").count();
    assertEquals(before + 1, after);
}
```

### 18.3 DLQ Metric Test

```java
@Test
void dlq_publish_should_increment_failure_metric() {
    var invalid = TestMessages.invalidEvidenceSubmitted();

    listenerAdapter.onMessage(invalidMessage(invalid), channel);

    assertMetricIncremented("rabbit.consumer.failed", Tags.of("decision", "dlq"));
}
```

Invariant:

> Every operationally meaningful failure path should emit a metric and a correlated log.

---

## 19. Load and Performance Testing

Functional integration test is not load test.

Load test answers:

- throughput capacity
- tail latency
- backlog recovery rate
- publisher confirm latency
- consumer utilization
- disk/network saturation
- redelivery behavior under failure
- max safe prefetch/concurrency
- queue growth under burst

### 19.1 Performance Test Profiles

Define scenarios:

```text
Scenario A: Normal command workload
- 100 msg/s
- 2 KB payload
- quorum queue
- 8 consumers
- prefetch 20

Scenario B: Burst workload
- 2,000 msg/s for 5 minutes
- consumer processing 50 ms/message
- expect backlog but recovery within 15 minutes

Scenario C: Retry storm simulation
- 20% transient external failures
- max retry 3
- assert broker remains healthy

Scenario D: Audit stream workload
- 5,000 msg/s append
- stream retention 7 days
- replay projection from beginning
```

### 19.2 Success Criteria

Bad load test:

```text
It didn't crash.
```

Good load test:

```text
p95 processing latency < 2s
p99 processing latency < 10s
oldest message age < 60s during steady state
confirm p99 < 500ms
redelivery rate < 0.1% except injected failures
DLQ rate = expected invalid input rate
no memory/disk alarm
backlog drains within 10 minutes after burst ends
```

### 19.3 Test Result Template

```md
# RabbitMQ Load Test Report

## Scenario
- Workload:
- Queue type:
- Message size:
- Producer count:
- Consumer count:
- Prefetch:
- Broker nodes:
- Disk type:

## Results
- Publish rate:
- Deliver rate:
- Ack rate:
- Confirm latency p50/p95/p99:
- End-to-end latency p50/p95/p99:
- Max ready messages:
- Max unacked messages:
- Max oldest message age:
- Redelivery rate:
- DLQ count:
- CPU/memory/disk/network:

## Findings
- Bottleneck:
- Saturation point:
- Safe operating envelope:
- Recommended config:

## Risks
- Untested failure mode:
- Capacity margin:
```

---

## 20. Chaos and Failure Testing

Chaos testing untuk messaging tidak harus spektakuler. Mulai dari failure kecil yang realistis.

### 20.1 Failure Scenarios

Test these deliberately:

1. consumer crash before ack
2. consumer crash after DB commit before ack
3. publisher confirm timeout
4. broker restart
5. queue leader failover for quorum queue
6. slow consumer
7. external dependency timeout
8. invalid payload
9. poison message
10. retry queue overload
11. DLQ unavailable/misconfigured
12. duplicate delivery
13. out-of-order event
14. stream replay after projection reset
15. network interruption between app and broker

### 20.2 Consumer Crash After Commit Before Ack

This is one of the most important tests.

Expected:

- DB commit succeeds
- ack not sent
- message redelivered
- idempotency suppresses duplicate side effect
- consumer eventually acks duplicate

Pseudo:

```java
@Test
void crash_after_commit_before_ack_should_be_safe() {
    crashInjector.crashAfterDatabaseCommitBeforeAckOnce();

    rabbitTemplate.convertAndSend(
        "case.events.x",
        "case.evidence.submitted",
        TestMessages.evidenceSubmitted()
    );

    await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> {
        assertEquals(1, evidenceRepository.count());
        assertEquals(1, inboxRepository.count());
        assertQueueEventuallyEmpty("case.evidence.submitted.q");
    });
}
```

If this test fails, your at-least-once design is unsafe.

---

## 21. CI/CD Strategy

Not all tests run at same frequency.

Suggested pipeline:

```text
On every commit:
- unit tests
- mapper tests
- contract golden sample tests
- retry classifier tests
- topology bean tests

On pull request:
- Testcontainers integration tests
- publisher confirm/return tests
- DLQ/retry tests
- idempotency duplicate tests

Nightly:
- broker restart tests
- consumer crash tests
- stream replay tests
- permission tests
- load smoke tests

Before release:
- full load test
- chaos/failure drills
- topology drift comparison against staging/prod
- migration compatibility tests
```

### 21.1 Test Isolation

Avoid shared queue names in CI.

Use suffix per test run:

```text
case.events.x.${testRunId}
case.review.requested.q.${testRunId}
```

Or create a unique vhost per test suite.

Preferred for integration isolation:

```text
vhost: /test-${buildId}
```

Then clean up after test.

### 21.2 Avoid Test Cross-Talk

Common problem:

- test A publishes message
- test B consumes it
- stale DLQ message breaks assertion
- retry from previous test fires during current test

Mitigation:

- unique vhost
- unique queue names
- purge test queues before test
- avoid global listener containers if not needed
- disable unrelated consumers in test profile
- assert queue empty at start
- deterministic test routing keys

---

## 22. Test Data Design

Message test data should be explicit and reusable.

### 22.1 Test Message Builder

```java
public final class TestMessages {
    public static MessageEnvelope<EvidenceSubmittedEvent> evidenceSubmitted(UUID caseId) {
        var messageId = UUID.randomUUID();
        return new MessageEnvelope<>(
            messageId,
            "case.evidence.submitted",
            1,
            UUID.randomUUID(),
            UUID.randomUUID(),
            "tenant-test",
            Instant.parse("2026-06-19T00:00:00Z"),
            new EvidenceSubmittedEvent(
                caseId,
                UUID.randomUUID(),
                "PDF",
                Instant.parse("2026-06-19T00:00:00Z"),
                "test-user"
            )
        );
    }

    public static MessageEnvelope<EvidenceSubmittedEvent> evidenceSubmittedWithMessageId(UUID messageId) {
        var msg = evidenceSubmitted(UUID.randomUUID());
        return new MessageEnvelope<>(
            messageId,
            msg.messageType(),
            msg.schemaVersion(),
            msg.correlationId(),
            msg.causationId(),
            msg.tenantId(),
            msg.occurredAt(),
            msg.payload()
        );
    }
}
```

### 22.2 Deterministic Time

Inject `Clock`:

```java
@Bean
Clock clock() {
    return Clock.systemUTC();
}
```

Test:

```java
@TestConfiguration
class FixedClockConfig {
    @Bean
    Clock clock() {
        return Clock.fixed(
            Instant.parse("2026-06-19T00:00:00Z"),
            ZoneOffset.UTC
        );
    }
}
```

Avoid tests that fail because current time changed.

---

## 23. Testing Topology Migration

RabbitMQ systems evolve. Test migration paths.

Examples:

- classic queue to quorum queue
- queue split into multiple queues
- routing key taxonomy change
- DLQ introduced to existing queue
- message version v1 to v2
- new consumer added
- old consumer removed
- stream introduced as audit tap

### 23.1 Version Compatibility Test

```java
@Test
void v2_consumer_should_accept_v1_message_during_migration_window() {
    var v1Json = Files.readString(Path.of("contracts/case.evidence.submitted.v1.json"));

    var result = v2Consumer.decodeAndHandle(v1Json);

    assertInstanceOf(HandlerResult.Success.class, result);
}
```

### 23.2 Routing Compatibility Test

```java
@Test
void exchange_should_route_old_and_new_routing_keys_during_migration() {
    rabbitTemplate.convertAndSend("case.events.x", "case.evidence.submitted", oldMessage);
    rabbitTemplate.convertAndSend("case.events.x", "case.evidence.v2.submitted", newMessage);

    await().untilAsserted(() -> {
        assertQueueDepth("case.evidence.consumer.q", 2);
    });
}
```

Invariant:

> During migration, both old and new producers/consumers must coexist for a defined compatibility window.

---

## 24. Testing Manual Operations

Some RabbitMQ failures happen during manual operations.

Test or rehearse:

- DLQ replay
- parking lot replay
- queue purge procedure
- consumer disable/enable
- topology deploy rollback
- broker restart
- node drain
- credential rotation
- certificate rotation
- policy update
- queue migration

### 24.1 DLQ Replay Dry Run

Replay tool should support dry run:

```bash
java -jar messaging-tools.jar dlq-replay \
  --source case.evidence.submitted.dlq \
  --target-exchange case.events.x \
  --target-routing-key case.evidence.submitted \
  --max 100 \
  --dry-run
```

Test expected output:

```text
would_replay=100
would_skip=0
target_exchange=case.events.x
target_routing_key=case.evidence.submitted
```

Replay tool tests:

- preserves original message id or creates explicit replay metadata
- does not replay poison messages without approval
- supports max count
- supports filter by message type/correlation id/time
- logs operator identity
- emits audit event

---

## 25. Common Testing Anti-Patterns

### 25.1 Only Testing Happy Path

If only valid messages are tested, you do not know what happens to invalid/poison messages.

### 25.2 Relying on Sleep

Sleep-based async tests are flaky and slow.

### 25.3 Using In-Memory Fake Broker for Integration Semantics

A fake broker cannot reproduce:

- redelivery
- DLX
- TTL
- prefetch
- publisher confirms
- queue type behavior
- connection/channel failure

Use fake only for unit-level adapter tests.

### 25.4 No Duplicate Tests

At-least-once systems without duplicate tests are unproven.

### 25.5 No Topology Tests

Messaging correctness depends on topology. Treat topology as code.

### 25.6 Testing RabbitMQ Instead of Your Contract

Do not spend time proving RabbitMQ routes direct exchanges correctly. Test that your topology and application assumptions are correct.

### 25.7 Production Retry Delays in CI

Use shortened retry delays in test profile.

### 25.8 Shared Test Broker Without Isolation

Shared broker causes cross-test pollution.

### 25.9 No Failure Injection

A system that never tests crash-before-ack does not know if its ack boundary is correct.

### 25.10 No Observability Assertion

If logs/metrics/traces are not tested, incident response may fail when needed.

---

## 26. Testing Checklist by Capability

### 26.1 Publisher Checklist

- [ ] serializes contract correctly
- [ ] includes message id
- [ ] includes correlation id
- [ ] includes causation id
- [ ] uses correct exchange
- [ ] uses correct routing key
- [ ] sets persistent delivery mode for durable work
- [ ] uses publisher confirms
- [ ] handles confirm ack
- [ ] handles confirm nack
- [ ] handles confirm timeout as unknown
- [ ] uses mandatory publish where appropriate
- [ ] handles returned message
- [ ] does not mark outbox sent before confirm
- [ ] retry publish uses stable message id
- [ ] logs publish result
- [ ] emits publish metrics

### 26.2 Consumer Checklist

- [ ] decodes valid message
- [ ] rejects invalid contract
- [ ] validates metadata
- [ ] uses manual ack for critical work
- [ ] acks only after durable business progress
- [ ] handles duplicate message id
- [ ] handles duplicate business key
- [ ] classifies transient vs permanent errors
- [ ] does not infinite requeue
- [ ] sends poison message to DLQ/parking lot
- [ ] preserves correlation id in logs
- [ ] emits success/failure/retry metrics
- [ ] handles redelivery
- [ ] handles crash after commit before ack

### 26.3 Topology Checklist

- [ ] exchange type correct
- [ ] queue type correct
- [ ] durable settings correct
- [ ] bindings correct
- [ ] DLX configured
- [ ] DLQ exists
- [ ] retry queues configured
- [ ] alternate exchange configured if required
- [ ] queue length/TTL guardrails set where required
- [ ] permissions match ownership
- [ ] topology declarations are environment-safe

### 26.4 Stream Checklist

- [ ] stream exists
- [ ] retention configured
- [ ] producer confirms tested
- [ ] deduplication tested
- [ ] offset storage tested
- [ ] replay tested
- [ ] replay side effects disabled
- [ ] projection rebuild tested
- [ ] filter behavior tested if used
- [ ] lag metric tested

---

## 27. Reference Test Matrix

| Risk | Test Type | Example |
|---|---:|---|
| Invalid payload causes poison loop | Integration | publish invalid message, assert DLQ not requeue storm |
| Duplicate delivery creates duplicate side effect | Unit + integration | same message ID twice, assert one business effect |
| Consumer crash after DB commit | Failure integration | inject crash before ack, assert redelivery safe |
| Publisher loses message silently | Integration | unroutable mandatory publish returns failure |
| Topology drift | Topology test | assert exchange/queue/binding/DLX arguments |
| Retry storm | Integration/load | transient failure rate, assert bounded retries |
| Stream replay sends external notification | Stream integration | replay projection, verify notification not called |
| Version change breaks consumer | Contract test | v1 golden sample read by v2 consumer |
| Hidden ordering assumption | Unit/integration | out-of-order events, assert state guard |
| Missing observability | Unit/integration | assert logs/metrics include message identity |

---

## 28. Mini Lab

### Lab 1 — Contract Test

Create golden sample JSON for:

```text
case.evidence.submitted.v1
```

Write tests that:

1. deserialize into Java record,
2. verify required metadata,
3. verify unknown optional fields do not break consumer,
4. verify missing required field fails validation.

### Lab 2 — DLQ Integration Test

Using Testcontainers:

1. create exchange `case.events.x`,
2. create queue `case.evidence.submitted.q`,
3. configure DLX `case.dlx`,
4. publish invalid message,
5. assert message reaches DLQ.

### Lab 3 — Idempotency Test

Publish same message twice.

Assert:

- inbox has one row,
- business table has one effect,
- outbound outbox has one follow-up message.

### Lab 4 — Crash Before Ack

Simulate handler success then channel close before ack.

Assert:

- message redelivered,
- duplicate ignored,
- eventual queue empty.

### Lab 5 — Stream Replay Test

Publish 100 audit events to stream.

Run projection rebuild from beginning.

Assert:

- projection count correct,
- external side effect mock not called,
- offset stored after projection commit.

---

## 29. Architecture Review Questions

Use these during design review:

1. What exact failure modes are covered by tests?
2. What happens if consumer crashes after DB commit but before ack?
3. What happens if publisher confirm times out?
4. What happens if message is unroutable?
5. What happens if same message is delivered twice?
6. What happens if same business event is delivered with different message IDs?
7. What happens if invalid message enters queue?
8. What happens if retry target dependency is down for 30 minutes?
9. Is DLQ monitored and tested?
10. Can DLQ replay be tested safely?
11. Is topology asserted in CI?
12. Are contract samples versioned?
13. Can old consumers read new messages during migration window?
14. Are manual operations rehearsed?
15. Are metrics/logs/traces tested?
16. Are stream replays side-effect safe?
17. Is outbox marking sent only after confirm?
18. Is inbox protected by unique constraints?
19. Are test queues isolated per test run?
20. Are retry delays shortened in CI?

---

## 30. Final Mental Model

RabbitMQ testing is not about proving RabbitMQ works.

RabbitMQ already works.

Your tests must prove that your system has correct boundaries around RabbitMQ's semantics:

```text
Publisher:
    Did I safely hand the message to broker?

Broker topology:
    Will the message route where I think it routes?

Consumer:
    Can I process, commit, and ack safely?

Failure handling:
    Can I classify, retry, DLQ, and recover without storm?

Contract:
    Can independent services evolve without breaking each other?

Operations:
    Can humans inspect, replay, drain, migrate, and debug safely?
```

The most important tests are not the happy-path publish/consume tests.

The most important tests are the failure-boundary tests:

- duplicate delivery
- crash before ack
- crash after commit before ack
- confirm timeout
- unroutable publish
- poison message
- exhausted retry
- out-of-order event
- stream replay
- topology drift

A RabbitMQ-based system becomes production-grade when those failure paths are no longer theoretical. They are tested, observable, bounded, and operationally rehearsed.

---

## 31. What Comes Next

Part berikutnya:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-30.md
```

Topik:

```text
Migration, Refactoring, and Legacy RabbitMQ Systems
```

Kita akan membahas bagaimana memperbaiki sistem RabbitMQ yang sudah berjalan:

- classic queue legacy
- mirrored queue migration
- moving to quorum queues
- introducing DLQ safely
- adding publisher confirms
- adding outbox/inbox
- refactoring routing topology
- splitting overloaded queues
- zero-downtime consumer migration
- schema compatibility window
- blue-green messaging topology

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-28.md">⬅️ Part 28 — Anti-Patterns and Failure Case Studies</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-30.md">Part 30 — Migration, Refactoring, and Legacy RabbitMQ Systems ➡️</a>
</div>

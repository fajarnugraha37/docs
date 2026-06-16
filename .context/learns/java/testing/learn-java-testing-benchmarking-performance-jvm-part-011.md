# learn-java-testing-benchmarking-performance-jvm-part-011

# Testing Messaging, Event Flow, Outbox, Scheduler, dan Async Processing

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `011`  
> Target pembaca: Java engineer yang sudah paham Java dasar, concurrency dasar, JDBC/JPA dasar, REST/Jakarta/Spring ecosystem, dan ingin naik level dalam testing sistem asynchronous/event-driven enterprise.  
> Rentang Java: Java 8 sampai Java 25.  

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas testing HTTP API. HTTP biasanya terasa mudah diuji karena request-response-nya eksplisit:

```text
request masuk
  -> handler dipanggil
  -> response keluar
```

Tetapi sistem enterprise jarang hanya sinkron. Banyak behavior penting terjadi di luar response HTTP:

```text
request masuk
  -> transaksi database commit
  -> event dikirim
  -> consumer lain memproses
  -> audit dibuat
  -> email dikirim
  -> SLA recalculation dijalankan
  -> scheduler pickup data tertentu
  -> retry jalan jika external system gagal
  -> dead-letter jika message tidak bisa diproses
```

Part ini membahas bagaimana menguji sistem seperti itu secara serius.

Fokus utama:

1. Membedakan testing synchronous flow dan asynchronous flow.
2. Membuat mental model event-driven testing.
3. Menguji producer, consumer, message contract, outbox, inbox/dedup, retry, DLQ, scheduler, dan async worker.
4. Menghindari test flaky karena `Thread.sleep`, timing race, broker state, dan ordering assumption.
5. Menggunakan tool seperti JUnit, Awaitility, Testcontainers, Kafka/RabbitMQ test broker, dan fake clock.
6. Mendesain test untuk sistem regulatory/case-management: auditability, idempotency, state transition, SLA, authorization, dan side-effect defensibility.

Part ini bukan tutorial “cara connect Kafka/RabbitMQ” dari nol. Itu sudah masuk wilayah messaging infrastructure. Kita fokus pada **testing strategy dan correctness evidence**.

---

## 1. Mental Model: Async Flow Bukan “Synchronous Test yang Diberi Sleep”

Kesalahan paling umum saat menguji asynchronous code adalah memperlakukannya seperti synchronous code yang kebetulan lambat.

Contoh buruk:

```java
@Test
void shouldProcessMessage() throws Exception {
    producer.publish(new CaseSubmittedEvent("CASE-001"));

    Thread.sleep(2000);

    CaseEntity entity = caseRepository.findById("CASE-001").orElseThrow();
    assertThat(entity.getStatus()).isEqualTo(CaseStatus.UNDER_REVIEW);
}
```

Test ini terlihat sederhana, tetapi sebenarnya rapuh.

Masalahnya:

1. Kalau mesin CI lambat, 2 detik mungkin kurang.
2. Kalau mesin cepat, test tetap membuang waktu 2 detik.
3. Kalau consumer gagal cepat, test tetap menunggu 2 detik.
4. Kalau message tidak pernah diproses, failure message tidak menjelaskan akar masalah.
5. Test tidak membedakan “belum selesai” dan “gagal permanen”.
6. Test menyembunyikan fakta bahwa async system punya eventual consistency.

Testing asynchronous system harus memakai mental model berbeda:

```text
Trigger sebuah asynchronous action.
Lalu tunggu sampai observable condition menjadi benar,
dengan timeout yang eksplisit,
dan failure diagnostic yang berguna.
```

Lebih baik:

```java
@Test
void shouldProcessSubmittedCaseMessage() {
    producer.publish(new CaseSubmittedEvent("CASE-001"));

    await()
        .atMost(Duration.ofSeconds(10))
        .pollInterval(Duration.ofMillis(100))
        .untilAsserted(() -> {
            CaseEntity entity = caseRepository.findById("CASE-001").orElseThrow();
            assertThat(entity.getStatus()).isEqualTo(CaseStatus.UNDER_REVIEW);
        });
}
```

Di sini test tidak menunggu waktu tetap. Test menunggu **condition**.

Prinsip utama:

```text
Do not wait for time.
Wait for state, event, offset, count, observable side effect, or absence of undesired effect.
```

---

## 2. Vocabulary Penting

Sebelum masuk ke pola testing, kita perlu menyamakan istilah.

### 2.1 Message

Message adalah unit data yang dikirim melalui broker/channel.

Contoh:

```json
{
  "eventId": "EVT-001",
  "eventType": "CASE_SUBMITTED",
  "caseId": "CASE-123",
  "occurredAt": "2026-06-16T04:00:00Z",
  "actorId": "user-001"
}
```

Message bisa berupa:

- command,
- event,
- notification,
- document processing request,
- audit request,
- integration payload,
- scheduled job payload.

### 2.2 Event

Event menyatakan sesuatu yang **sudah terjadi**.

Contoh:

```text
CaseSubmitted
PaymentReceived
DocumentUploaded
AppealApproved
EmailDeliveryFailed
```

Event seharusnya ditulis dalam past tense karena ia bukan instruksi.

### 2.3 Command

Command menyatakan instruksi untuk melakukan sesuatu.

Contoh:

```text
SendEmail
GenerateReport
RecalculateSla
SyncCaseToExternalAgency
```

Command bisa gagal karena penerima boleh menolak instruksi.

### 2.4 Producer

Producer adalah komponen yang mengirim message.

Dalam test producer, pertanyaan utamanya:

```text
Apakah message yang benar dikirim pada kondisi yang benar?
Apakah message tidak dikirim pada kondisi yang salah?
Apakah metadata/headers/schema/correlation id benar?
```

### 2.5 Consumer

Consumer adalah komponen yang menerima message.

Dalam test consumer, pertanyaan utamanya:

```text
Apakah message valid diproses benar?
Apakah message invalid ditolak dengan cara yang benar?
Apakah duplicate aman?
Apakah failure menyebabkan retry/DLQ/rollback yang benar?
```

### 2.6 Broker

Broker adalah middleware pengantar message.

Contoh:

- Kafka,
- RabbitMQ,
- ActiveMQ,
- AWS SQS/SNS,
- Redis Streams,
- Pulsar.

Dalam test, broker bisa:

- dimock,
- diganti fake,
- dijalankan real via container,
- dipakai instance test environment.

Untuk correctness integration, real broker via Testcontainers biasanya jauh lebih bernilai daripada mock.

### 2.7 Topic, Queue, Exchange, Routing Key

Istilah berbeda tergantung teknologi.

Kafka:

```text
topic -> partition -> offset -> consumer group
```

RabbitMQ:

```text
exchange -> routing key -> queue -> consumer
```

SQS:

```text
queue -> visibility timeout -> redrive policy -> DLQ
```

Testing harus memahami semantics broker yang digunakan, karena failure behavior-nya berbeda.

### 2.8 At-Least-Once Delivery

At-least-once berarti message bisa dikirim lebih dari sekali.

Implikasi test:

```text
Consumer harus aman terhadap duplicate.
```

Jika test hanya mengirim satu message satu kali, test belum membuktikan safety production.

### 2.9 At-Most-Once Delivery

At-most-once berarti message tidak akan dikirim lebih dari sekali, tetapi bisa hilang.

Implikasi test:

```text
Cocok untuk telemetry non-critical.
Tidak cocok untuk workflow regulatory yang butuh defensibility.
```

### 2.10 Exactly-Once

Exactly-once sering misleading.

Dalam sistem distributed, exactly-once biasanya berarti kombinasi dari:

- deduplication,
- transactional producer,
- idempotent consumer,
- offset management,
- transactional sink,
- deterministic side effect.

Untuk testing enterprise, lebih aman berpikir:

```text
Assume duplicate can happen.
Assume partial failure can happen.
Assume retry can happen.
Make consumer idempotent.
Test the idempotency.
```

---

## 3. Kenapa Async Testing Lebih Sulit

Async testing sulit bukan hanya karena thread. Ia sulit karena behavior tersebar di waktu, proses, dan storage.

### 3.1 Tidak Ada Response Langsung

Dalam HTTP sinkron:

```text
input -> output langsung
```

Dalam async:

```text
input -> eventually output somewhere
```

Output bisa muncul sebagai:

- row database,
- message baru,
- audit record,
- email record,
- file generated,
- external API call,
- metric,
- log,
- status transition,
- DLQ message.

Test harus memilih observable output yang tepat.

### 3.2 Ordering Tidak Selalu Dijamin

Kafka menjamin ordering dalam partition, bukan seluruh topic.

RabbitMQ queue bisa menjaga urutan dasar, tetapi retry/requeue/multiple consumer bisa mengubah observasi praktis.

Scheduler dan thread pool juga bisa memproses item secara berbeda antar run.

Jadi test yang mengasumsikan global ordering sering flaky.

### 3.3 Duplicate Itu Normal

Banyak broker dan integration pattern memberi at-least-once delivery.

Artinya duplicate bukan bug broker. Duplicate adalah bagian dari contract.

Test yang hanya menguji happy path single delivery belum cukup.

### 3.4 Failure Bisa Terjadi Setelah Side Effect

Contoh:

```text
consumer menerima message
  -> insert audit berhasil
  -> update case berhasil
  -> publish next event berhasil
  -> ack broker gagal
  -> broker mengirim ulang message
```

Sekarang consumer menerima duplicate setelah side effect sudah terjadi.

Pertanyaannya:

```text
Apakah side effect kedua dicegah?
Apakah audit duplicate dicegah?
Apakah status tetap valid?
Apakah event downstream tidak double?
```

### 3.5 Test Timing Bisa Menipu

Kadang test pass bukan karena logic benar, tetapi karena timing kebetulan.

Contoh:

```text
Thread.sleep(500)
```

Di laptop pass, di CI fail.

Atau sebaliknya:

```text
Thread.sleep(5000)
```

Test stabil tapi lambat dan menyembunyikan failure.

### 3.6 Observability Test Harus Disiapkan

Async system butuh observability sejak desain.

Minimal:

- correlation id,
- event id,
- message key,
- attempt count,
- status table,
- audit trail,
- DLQ inspection,
- consumer lag,
- processing timestamp.

Tanpa itu, test sulit memastikan apa yang terjadi.

---

## 4. Test Taxonomy untuk Messaging dan Async Flow

Untuk async system, kita biasanya butuh beberapa level test.

### 4.1 Producer Unit Test

Tujuan:

```text
Membuktikan producer dipanggil dengan payload dan metadata yang benar.
```

Biasanya broker dimock atau diganti fake collector.

Contoh:

```java
@Test
void submitCaseShouldPublishCaseSubmittedEvent() {
    FakeEventPublisher publisher = new FakeEventPublisher();
    CaseService service = new CaseService(repository, publisher, clock);

    service.submit("CASE-001", Actor.user("U-001"));

    assertThat(publisher.events())
        .singleElement()
        .satisfies(event -> {
            assertThat(event.type()).isEqualTo("CASE_SUBMITTED");
            assertThat(event.aggregateId()).isEqualTo("CASE-001");
            assertThat(event.actorId()).isEqualTo("U-001");
            assertThat(event.occurredAt()).isEqualTo(Instant.parse("2026-06-16T04:00:00Z"));
        });
}
```

Kelebihan:

- cepat,
- deterministic,
- bagus untuk domain/application layer.

Kelemahan:

- tidak membuktikan serialization,
- tidak membuktikan broker routing,
- tidak membuktikan transaction boundary,
- tidak membuktikan consumer bisa membaca message.

### 4.2 Producer Integration Test

Tujuan:

```text
Membuktikan message benar-benar masuk ke broker/topic/queue dengan format yang benar.
```

Biasanya pakai real broker Testcontainers.

Pertanyaan yang diuji:

- topic/queue benar,
- routing key benar,
- key/partitioning benar,
- header benar,
- serialization benar,
- schema compatibility benar.

### 4.3 Consumer Unit Test

Tujuan:

```text
Menguji handler logic tanpa broker.
```

Contoh:

```java
@Test
void shouldApproveCaseWhenApprovalEventReceived() {
    CaseApprovedEvent event = new CaseApprovedEvent("EVT-001", "CASE-001", "manager-001");

    consumer.handle(event);

    CaseEntity entity = repository.findById("CASE-001").orElseThrow();
    assertThat(entity.getStatus()).isEqualTo(CaseStatus.APPROVED);
}
```

Kelebihan:

- cepat,
- fokus business behavior,
- mudah menguji edge cases.

Kelemahan:

- tidak membuktikan broker listener config,
- tidak membuktikan deserialization,
- tidak membuktikan ack/nack/retry.

### 4.4 Consumer Integration Test

Tujuan:

```text
Membuktikan message yang masuk ke broker dikonsumsi oleh listener dan menghasilkan side effect benar.
```

Biasanya:

```text
Test -> publish message ke broker -> app listener consume -> assert DB/audit/outbound message
```

Ini sangat penting untuk enterprise flow.

### 4.5 Contract Test

Tujuan:

```text
Membuktikan producer dan consumer sepakat terhadap schema/message contract.
```

Contract meliputi:

- field wajib,
- field optional,
- enum values,
- event type,
- version,
- header,
- timestamp format,
- semantic meaning.

Contract test bisa dilakukan dengan:

- JSON schema,
- Avro schema compatibility,
- Pact asynchronous/message contract,
- custom fixture contract,
- golden sample messages.

### 4.6 End-to-End Async Flow Test

Tujuan:

```text
Membuktikan satu business flow lintas beberapa component berjalan dari trigger sampai efek akhir.
```

Contoh:

```text
Submit case via API
  -> DB status submitted
  -> outbox event created
  -> outbox relay publishes CaseSubmitted
  -> compliance consumer receives
  -> screening task created
  -> audit trail created
```

Test ini mahal. Jangan terlalu banyak. Pilih flow high-risk.

### 4.7 Resilience/Fault Injection Test

Tujuan:

```text
Membuktikan behavior saat broker, DB, external system, atau consumer gagal.
```

Contoh:

- external API gagal 500,
- DB deadlock,
- duplicate message,
- malformed payload,
- poison message,
- publish failure,
- consumer crash sebelum ack,
- retry exhausted,
- DLQ routing.

### 4.8 Scheduler Test

Tujuan:

```text
Membuktikan job periodik memilih data yang benar, menjalankan side effect aman, dan tidak double-process.
```

Contoh:

- SLA escalation due,
- expired application cleanup,
- outbox relay,
- retry pending integration,
- reminder email,
- report generation.

---

## 5. Tooling Map

### 5.1 JUnit

JUnit tetap test runner utama.

Pada Java 8/11, biasanya:

- JUnit 5/Jupiter,
- JUnit 4 legacy via Vintage jika masih perlu.

Pada Java 17+, bisa mempertimbangkan:

- JUnit 5 modern,
- JUnit 6 jika ekosistem project sudah siap.

### 5.2 Awaitility

Awaitility adalah DSL Java untuk menyatakan expectation pada asynchronous system dengan cara yang ringkas dan readable.

Pola utamanya:

```java
await()
    .atMost(Duration.ofSeconds(10))
    .untilAsserted(() -> {
        assertThat(repository.countProcessed()).isEqualTo(1);
    });
```

Gunakan Awaitility untuk:

- menunggu DB row muncul,
- menunggu status berubah,
- menunggu message consumed,
- menunggu audit created,
- menunggu DLQ message,
- menunggu no more processing dengan hati-hati,
- menghindari `Thread.sleep`.

### 5.3 Testcontainers

Testcontainers menyediakan dependency nyata yang disposable untuk integration test.

Untuk messaging:

- Kafka container,
- RabbitMQ container,
- database container untuk outbox/inbox,
- Redis container jika async cache/stream,
- localstack jika SQS/SNS-style testing.

Keuntungan:

- semantics lebih dekat production,
- mengurangi fake broker behavior,
- test repeatable,
- cocok untuk CI.

Kekurangan:

- lebih lambat,
- butuh Docker/container runtime,
- perlu lifecycle management,
- perlu cleanup topic/queue/data.

### 5.4 WireMock / MockWebServer

Dipakai ketika consumer memanggil external HTTP API.

Penting untuk menguji:

- retry,
- timeout,
- malformed response,
- 4xx/5xx,
- rate limit,
- idempotency key header.

### 5.5 Fake Clock

Untuk scheduler dan SLA, fake clock lebih baik daripada waktu real.

Buruk:

```java
Thread.sleep(60_000);
```

Baik:

```java
MutableClock clock = new MutableClock(Instant.parse("2026-06-16T00:00:00Z"));
clock.advance(Duration.ofDays(3));
scheduler.runOnce();
```

### 5.6 Embedded Broker: Hati-Hati

Embedded broker kadang berguna, tetapi bisa berbeda dari production.

Contoh risiko:

- Kafka embedded tidak identik dengan cluster config production,
- Rabbit embedded jarang mereplikasi exchange/queue policy nyata,
- retry/DLQ semantics bisa berbeda,
- version mismatch.

Untuk correctness penting, pilih real broker via container.

---

## 6. Prinsip Desain Async Test

### 6.1 Assert Observable Outcome, Bukan Internal Thread Behavior

Jangan assert bahwa method internal tertentu dipanggil oleh thread tertentu kecuali itu bagian dari contract.

Lebih baik assert:

- status berubah,
- row dibuat,
- event diterbitkan,
- audit ada,
- DLQ berisi message,
- duplicate tidak membuat side effect tambahan.

### 6.2 Prefer Deterministic Trigger

Test harus punya trigger yang jelas.

Contoh trigger:

- publish message,
- insert outbox row lalu run relay once,
- call API,
- call scheduler `runOnce`,
- advance fake clock,
- manually invoke consumer handler.

Hindari test yang bergantung pada scheduler real setiap 1 menit.

### 6.3 Separate Handler Logic from Broker Adapter

Desain yang testable:

```java
public final class CaseSubmittedMessageListener {
    private final CaseSubmittedHandler handler;

    @KafkaListener(topics = "case.submitted")
    public void onMessage(String payload) {
        CaseSubmittedEvent event = objectMapper.readValue(payload, CaseSubmittedEvent.class);
        handler.handle(event);
    }
}
```

Handler bisa diuji tanpa broker:

```java
handler.handle(event);
```

Adapter/listener bisa diuji integration dengan broker.

Ini memisahkan:

```text
business correctness
  dari
messaging infrastructure correctness
```

### 6.4 Make Time Explicit

Async system sering bergantung waktu:

- retry delay,
- SLA due,
- scheduled pickup,
- timeout,
- message expiry,
- lock lease,
- visibility timeout.

Gunakan abstraction:

```java
Clock clock;
RetryPolicy retryPolicy;
BackoffStrategy backoffStrategy;
JobLeaseRepository leaseRepository;
```

Test menjadi deterministic.

### 6.5 Make Idempotency Explicit

Jangan berharap duplicate tidak terjadi.

Test harus mengirim duplicate dengan `eventId` sama atau business key sama.

```java
@Test
void duplicateMessageShouldNotCreateDuplicateAudit() {
    CaseSubmittedEvent event = new CaseSubmittedEvent("EVT-001", "CASE-001");

    consumer.handle(event);
    consumer.handle(event);

    assertThat(auditRepository.findByEventId("EVT-001")).hasSize(1);
    assertThat(caseRepository.findById("CASE-001").orElseThrow().getStatus())
        .isEqualTo(CaseStatus.SUBMITTED);
}
```

### 6.6 Assert Negative Side Effects

Async failure tests harus membuktikan bukan hanya efek yang terjadi, tetapi juga efek yang tidak boleh terjadi.

Contoh:

```java
assertThat(emailRepository.findByCaseId("CASE-001")).isEmpty();
assertThat(auditRepository.findByCaseId("CASE-001")).hasSize(1);
assertThat(outboundEvents.findByAggregateId("CASE-001")).isEmpty();
```

### 6.7 Use Eventually and Consistently Correctly

Ada dua jenis async assertion:

#### Eventually

Sesuatu harus akhirnya terjadi.

```java
await().untilAsserted(() ->
    assertThat(repository.existsById("CASE-001")).isTrue()
);
```

#### Consistently

Sesuatu tidak boleh terjadi selama periode tertentu.

```java
await()
    .during(Duration.ofSeconds(1))
    .atMost(Duration.ofSeconds(2))
    .untilAsserted(() ->
        assertThat(emailRepository.countByCaseId("CASE-001")).isZero()
    );
```

Gunakan `during` dengan hati-hati. Negative async assertion selalu lebih sulit karena “tidak terjadi sekarang” belum tentu “tidak akan terjadi”.

---

## 7. Producer Testing

Producer testing sering diremehkan. Padahal producer menentukan kualitas message contract.

### 7.1 Apa yang Harus Diuji dari Producer

Checklist:

1. Event type benar.
2. Event id unik dan valid.
3. Aggregate id benar.
4. Actor/user/system identity benar.
5. Timestamp benar dan memakai clock yang bisa dikontrol.
6. Payload field lengkap.
7. Optional field semantics benar.
8. Routing topic/queue/exchange benar.
9. Message key benar.
10. Headers benar:
    - correlation id,
    - causation id,
    - tenant/agency id,
    - schema version,
    - trace id.
11. Event hanya dipublish setelah state change valid.
12. Event tidak dipublish jika transaction gagal.

### 7.2 Producer Unit Test dengan Fake Publisher

Alih-alih mock berat, fake publisher sering lebih bersih.

```java
public interface DomainEventPublisher {
    void publish(DomainEvent event);
}

public final class RecordingEventPublisher implements DomainEventPublisher {
    private final List<DomainEvent> events = new ArrayList<>();

    @Override
    public void publish(DomainEvent event) {
        events.add(event);
    }

    public List<DomainEvent> events() {
        return List.copyOf(events);
    }
}
```

Test:

```java
@Test
void submitShouldEmitCaseSubmittedEvent() {
    RecordingEventPublisher publisher = new RecordingEventPublisher();
    MutableClock clock = MutableClock.fixed("2026-06-16T00:00:00Z");
    CaseService service = new CaseService(repository, publisher, clock);

    service.submit("CASE-001", Actor.user("U-001"));

    assertThat(publisher.events())
        .singleElement()
        .satisfies(event -> {
            assertThat(event).isInstanceOf(CaseSubmittedEvent.class);
            CaseSubmittedEvent submitted = (CaseSubmittedEvent) event;
            assertThat(submitted.caseId()).isEqualTo("CASE-001");
            assertThat(submitted.actorId()).isEqualTo("U-001");
            assertThat(submitted.occurredAt()).isEqualTo(clock.instant());
        });
}
```

Keunggulan fake:

- test lebih readable,
- assertion bisa berbasis state,
- tidak overspecify method interaction,
- cocok untuk multiple events.

### 7.3 Producer Integration Test dengan Broker

Contoh pseudo Kafka:

```java
@Testcontainers
class CaseEventProducerKafkaIT {

    @Container
    static KafkaContainer kafka = new KafkaContainer("apache/kafka-native:latest");

    @Test
    void shouldPublishCaseSubmittedToTopic() {
        CaseEventProducer producer = createProducer(kafka.getBootstrapServers());
        KafkaTestConsumer consumer = createConsumer(kafka.getBootstrapServers(), "case-events");

        producer.publish(new CaseSubmittedEvent("EVT-001", "CASE-001"));

        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
            ConsumerRecord<String, String> record = consumer.pollOne();
            assertThat(record.key()).isEqualTo("CASE-001");
            assertThat(record.value()).contains("CASE_SUBMITTED");
            assertThat(record.headers().lastHeader("event-id").value())
                .isEqualTo("EVT-001".getBytes(StandardCharsets.UTF_8));
        });
    }
}
```

Yang ingin dibuktikan:

```text
Bukan hanya producer.publish() dipanggil,
tetapi message yang sebenarnya terlihat oleh consumer broker-compatible.
```

### 7.4 Producer Transaction Boundary

Ini sangat penting.

Bug umum:

```text
DB update gagal tapi event sudah terkirim.
```

Atau:

```text
DB update berhasil tapi publish gagal sehingga downstream tidak tahu.
```

Test producer langsung ke broker tidak cukup untuk menyelesaikan masalah ini. Untuk transactional consistency, biasanya gunakan **outbox pattern**.

---

## 8. Consumer Testing

Consumer adalah tempat banyak bug production muncul.

### 8.1 Apa yang Harus Diuji dari Consumer

Checklist:

1. Valid message diproses benar.
2. Invalid schema ditolak benar.
3. Missing required field ditolak benar.
4. Unknown field kompatibel atau ditolak sesuai policy.
5. Unknown enum ditangani sesuai policy.
6. Duplicate message aman.
7. Message lama/stale tidak merusak state.
8. Out-of-order message aman.
9. Retryable failure memicu retry.
10. Non-retryable failure masuk DLQ atau rejected.
11. Side effect transactional.
12. Audit dibuat tepat sekali.
13. Downstream event tidak duplicate.
14. Offset/ack dilakukan setelah commit, bukan sebelum.

### 8.2 Consumer Handler Unit Test

Pisahkan listener adapter dan handler.

```java
public final class CaseApprovedHandler {
    private final CaseRepository caseRepository;
    private final AuditRepository auditRepository;
    private final ProcessedMessageRepository processedMessages;

    public void handle(CaseApprovedEvent event) {
        if (processedMessages.exists(event.eventId())) {
            return;
        }

        CaseEntity caseEntity = caseRepository.getRequired(event.caseId());
        caseEntity.approve(event.approvedBy(), event.occurredAt());

        caseRepository.save(caseEntity);
        auditRepository.insert(AuditEntry.from(event));
        processedMessages.insert(event.eventId());
    }
}
```

Test:

```java
@Test
void shouldApproveCaseAndCreateAudit() {
    repository.save(CaseEntity.underReview("CASE-001"));

    handler.handle(new CaseApprovedEvent(
        "EVT-001",
        "CASE-001",
        "MANAGER-001",
        Instant.parse("2026-06-16T00:00:00Z")
    ));

    CaseEntity entity = repository.getRequired("CASE-001");
    assertThat(entity.getStatus()).isEqualTo(CaseStatus.APPROVED);

    assertThat(auditRepository.findByCaseId("CASE-001"))
        .singleElement()
        .satisfies(audit -> {
            assertThat(audit.getEventId()).isEqualTo("EVT-001");
            assertThat(audit.getAction()).isEqualTo("CASE_APPROVED");
        });
}
```

### 8.3 Consumer Duplicate Test

```java
@Test
void duplicateEventShouldBeIgnoredAfterFirstProcessing() {
    repository.save(CaseEntity.underReview("CASE-001"));

    CaseApprovedEvent event = new CaseApprovedEvent("EVT-001", "CASE-001", "MANAGER-001", now);

    handler.handle(event);
    handler.handle(event);

    assertThat(auditRepository.findByEventId("EVT-001")).hasSize(1);
    assertThat(processedMessages.exists("EVT-001")).isTrue();
    assertThat(outboundEventRepository.findByCausationId("EVT-001")).hasSize(1);
}
```

### 8.4 Consumer Out-of-Order Test

Misalnya event `CaseApproved` datang sebelum `CaseSubmitted` karena integration issue.

Policy harus jelas:

- reject ke DLQ,
- retry later,
- store pending event,
- ignore stale/invalid transition,
- mark integration error.

Test:

```java
@Test
void approvedEventBeforeSubmittedShouldBeRejectedAsInvalidTransition() {
    repository.save(CaseEntity.draft("CASE-001"));

    CaseApprovedEvent event = new CaseApprovedEvent("EVT-002", "CASE-001", "MANAGER-001", now);

    assertThatThrownBy(() -> handler.handle(event))
        .isInstanceOf(InvalidCaseTransitionException.class)
        .hasMessageContaining("DRAFT")
        .hasMessageContaining("APPROVED");

    assertThat(repository.getRequired("CASE-001").getStatus()).isEqualTo(CaseStatus.DRAFT);
    assertThat(auditRepository.findByCaseId("CASE-001")).isEmpty();
}
```

### 8.5 Consumer Integration Test

Pseudo Spring/Kafka style:

```java
@Test
void kafkaListenerShouldConsumeCaseApprovedEvent() {
    repository.save(CaseEntity.underReview("CASE-001"));

    kafkaTemplate.send("case.approved", "CASE-001", jsonOf(new CaseApprovedEvent(
        "EVT-001",
        "CASE-001",
        "MANAGER-001",
        now
    )));

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        CaseEntity entity = repository.getRequired("CASE-001");
        assertThat(entity.getStatus()).isEqualTo(CaseStatus.APPROVED);
        assertThat(auditRepository.findByEventId("EVT-001")).hasSize(1);
    });
}
```

Yang diuji:

- broker config,
- listener registration,
- topic name,
- deserialization,
- handler invocation,
- DB side effect.

---

## 9. Message Contract Testing

Message contract adalah perjanjian antara producer dan consumer.

Jika contract lemah, async integration akan sering rusak diam-diam.

### 9.1 Contract Bukan Hanya Schema

Schema hanya menjawab:

```text
Apakah bentuk payload valid?
```

Contract juga harus menjawab:

```text
Apa makna field ini?
Kapan event ini diterbitkan?
Apakah field boleh null?
Apakah enum boleh bertambah?
Apa versioning policy?
Apa idempotency key?
Apakah timestamp event time atau processing time?
```

### 9.2 Contract Elements

Minimal contract message:

```json
{
  "eventId": "UUID or ULID, globally unique",
  "eventType": "CASE_SUBMITTED",
  "schemaVersion": 1,
  "aggregateType": "CASE",
  "aggregateId": "CASE-001",
  "occurredAt": "ISO-8601 instant",
  "actor": {
    "actorId": "U-001",
    "actorType": "USER"
  },
  "payload": {
    "caseReferenceNo": "EA-2026-0001",
    "submissionChannel": "INTERNET"
  }
}
```

Headers:

```text
event-id: EVT-001
correlation-id: CORR-001
causation-id: CMD-001
schema-version: 1
content-type: application/json
```

### 9.3 Golden Message Contract Test

Simpan sample message sebagai fixture:

```text
src/test/resources/contracts/case-submitted-v1.json
src/test/resources/contracts/case-approved-v1.json
```

Test consumer deserialization:

```java
@Test
void shouldReadCaseSubmittedV1ContractMessage() throws Exception {
    String json = readResource("contracts/case-submitted-v1.json");

    CaseSubmittedEvent event = objectMapper.readValue(json, CaseSubmittedEvent.class);

    assertThat(event.eventId()).isNotBlank();
    assertThat(event.caseId()).isEqualTo("CASE-001");
    assertThat(event.schemaVersion()).isEqualTo(1);
}
```

Test producer output compatibility:

```java
@Test
void producedCaseSubmittedEventShouldMatchContractShape() throws Exception {
    CaseSubmittedEvent event = fixture.caseSubmitted();

    String json = objectMapper.writeValueAsString(event);

    assertThatJson(json)
        .node("eventType").isEqualTo("CASE_SUBMITTED")
        .node("schemaVersion").isEqualTo(1)
        .node("payload.caseReferenceNo").isPresent();
}
```

### 9.4 Backward Compatibility Test

Jika consumer versi baru masih harus menerima message lama:

```java
@ParameterizedTest
@ValueSource(strings = {
    "contracts/case-submitted-v1.json",
    "contracts/case-submitted-v2.json"
})
void consumerShouldReadSupportedCaseSubmittedVersions(String resource) {
    String json = readResource(resource);

    CaseSubmittedEvent event = objectMapper.readValue(json, CaseSubmittedEvent.class);

    assertThat(event.caseId()).isNotBlank();
}
```

### 9.5 Schema Evolution Rules

Aturan praktis JSON event:

Safe-ish:

- tambah optional field,
- tambah enum hanya jika consumer unknown-enum tolerant,
- tambah metadata header optional,
- tambah nested optional object.

Breaking:

- rename field,
- remove required field,
- ubah tipe field,
- ubah semantic timestamp,
- ubah idempotency key,
- ubah meaning enum existing,
- ubah event timing.

Test harus menangkap breaking change sebelum deploy.

---

## 10. Outbox Pattern Testing

Outbox pattern adalah salah satu pattern paling penting untuk consistency antara database dan message broker.

### 10.1 Problem yang Diselesaikan

Tanpa outbox:

```java
@Transactional
public void submitCase(String caseId) {
    caseRepository.updateStatus(caseId, SUBMITTED);
    kafkaTemplate.send("case.submitted", event);
}
```

Failure scenario:

```text
DB commit sukses, publish gagal -> event hilang.
Publish sukses, DB rollback -> event palsu terkirim.
```

Dengan outbox:

```java
@Transactional
public void submitCase(String caseId) {
    caseRepository.updateStatus(caseId, SUBMITTED);
    outboxRepository.insert(CaseSubmittedEvent(...));
}
```

Lalu relay terpisah:

```text
outbox table -> relay worker -> broker -> mark published
```

### 10.2 Apa yang Harus Diuji

Checklist outbox:

1. Business state dan outbox row dibuat dalam transaksi yang sama.
2. Jika transaksi rollback, outbox row tidak ada.
3. Relay hanya mengambil row pending.
4. Relay publish message dengan payload benar.
5. Relay mark published setelah publish sukses.
6. Jika publish gagal, row tetap pending/retryable.
7. Relay idempotent saat retry.
8. Multiple relay worker tidak double-publish row yang sama.
9. Ordering policy jelas jika dibutuhkan.
10. Cleanup/archive tidak menghapus row yang belum published.

### 10.3 Test Transactional Outbox Creation

```java
@Test
void submitShouldPersistCaseAndOutboxInSameTransaction() {
    service.submitCase("CASE-001", Actor.user("U-001"));

    CaseEntity entity = caseRepository.getRequired("CASE-001");
    assertThat(entity.getStatus()).isEqualTo(CaseStatus.SUBMITTED);

    List<OutboxMessage> outbox = outboxRepository.findByAggregateId("CASE-001");
    assertThat(outbox)
        .singleElement()
        .satisfies(message -> {
            assertThat(message.getEventType()).isEqualTo("CASE_SUBMITTED");
            assertThat(message.getStatus()).isEqualTo(OutboxStatus.PENDING);
        });
}
```

### 10.4 Test Rollback Tidak Meninggalkan Outbox

```java
@Test
void failedSubmitShouldRollbackCaseAndOutbox() {
    assertThatThrownBy(() -> service.submitCaseWithForcedFailure("CASE-001"))
        .isInstanceOf(RuntimeException.class);

    assertThat(caseRepository.findById("CASE-001")).isEmpty();
    assertThat(outboxRepository.findByAggregateId("CASE-001")).isEmpty();
}
```

### 10.5 Test Outbox Relay Success

```java
@Test
void relayShouldPublishPendingOutboxAndMarkPublished() {
    OutboxMessage message = outboxRepository.insertPending(caseSubmittedOutbox("CASE-001"));

    relay.runOnce();

    assertThat(fakeBroker.publishedMessages())
        .singleElement()
        .satisfies(published -> {
            assertThat(published.topic()).isEqualTo("case.submitted");
            assertThat(published.key()).isEqualTo("CASE-001");
        });

    OutboxMessage updated = outboxRepository.getRequired(message.getId());
    assertThat(updated.getStatus()).isEqualTo(OutboxStatus.PUBLISHED);
    assertThat(updated.getPublishedAt()).isNotNull();
}
```

### 10.6 Test Outbox Relay Publish Failure

```java
@Test
void relayShouldKeepMessagePendingWhenPublishFails() {
    fakeBroker.failNextPublish(new BrokerUnavailableException("broker down"));
    OutboxMessage message = outboxRepository.insertPending(caseSubmittedOutbox("CASE-001"));

    relay.runOnce();

    OutboxMessage updated = outboxRepository.getRequired(message.getId());
    assertThat(updated.getStatus()).isEqualTo(OutboxStatus.PENDING);
    assertThat(updated.getAttemptCount()).isEqualTo(1);
    assertThat(updated.getLastError()).contains("broker down");
}
```

### 10.7 Test Concurrent Relay Workers

Jika dua worker relay jalan bersamaan, jangan sampai double publish.

Strategi implementasi:

- `SELECT ... FOR UPDATE SKIP LOCKED`,
- claim token,
- status `IN_PROGRESS`,
- lease timeout,
- unique publish id,
- broker idempotent key.

Test pseudo:

```java
@Test
void concurrentRelayWorkersShouldNotPublishSameOutboxTwice() throws Exception {
    outboxRepository.insertPending(caseSubmittedOutbox("CASE-001"));

    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);

    Future<?> first = executor.submit(() -> {
        awaitLatch(start);
        relay.runOnce();
    });

    Future<?> second = executor.submit(() -> {
        awaitLatch(start);
        relay.runOnce();
    });

    start.countDown();
    first.get();
    second.get();

    assertThat(fakeBroker.publishedMessages()).hasSize(1);
}
```

Catatan penting:

Test seperti ini bisa flaky jika tidak didesain hati-hati. Untuk concurrency correctness mendalam, nanti seri ini punya part khusus `jcstress`. Untuk integration behavior outbox, test ini tetap berguna sebagai smoke guard.

---

## 11. Inbox / Processed Message / Dedup Testing

Jika outbox melindungi producer side, inbox/dedup melindungi consumer side.

### 11.1 Problem

At-least-once delivery berarti message bisa diproses ulang.

Tanpa dedup:

```text
message diterima dua kali
  -> audit double
  -> email double
  -> state transition double
  -> external sync double
```

### 11.2 Dedup Table

Contoh table:

```sql
CREATE TABLE processed_message (
    message_id VARCHAR(100) PRIMARY KEY,
    consumer_name VARCHAR(100) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    aggregate_id VARCHAR(100),
    status VARCHAR(30) NOT NULL
);
```

Untuk multi-consumer, primary key bisa:

```text
(consumer_name, message_id)
```

### 11.3 Idempotent Consumer Flow

```text
receive message
  -> begin transaction
  -> insert processed_message(message_id)
       if duplicate -> return/ack safely
  -> apply business side effect
  -> commit
  -> ack message
```

### 11.4 Test Duplicate Message

```java
@Test
void sameMessageShouldOnlyBeProcessedOnce() {
    repository.save(CaseEntity.underReview("CASE-001"));

    CaseApprovedEvent event = approvedEvent("EVT-001", "CASE-001");

    consumer.handle(event);
    consumer.handle(event);

    assertThat(processedMessageRepository.exists("case-approved-consumer", "EVT-001"))
        .isTrue();
    assertThat(auditRepository.findByEventId("EVT-001")).hasSize(1);
    assertThat(emailRepository.findByCaseId("CASE-001")).hasSize(1);
}
```

### 11.5 Test Duplicate Race

Dua thread menerima same event hampir bersamaan.

```java
@Test
void concurrentDuplicateShouldNotDoubleProcess() throws Exception {
    repository.save(CaseEntity.underReview("CASE-001"));
    CaseApprovedEvent event = approvedEvent("EVT-001", "CASE-001");

    runConcurrently(
        () -> consumer.handle(event),
        () -> consumer.handle(event)
    );

    assertThat(auditRepository.findByEventId("EVT-001")).hasSize(1);
    assertThat(emailRepository.findByCaseId("CASE-001")).hasSize(1);
}
```

Syarat production:

- unique constraint benar,
- transaction boundary benar,
- duplicate key handling benar.

Tanpa unique constraint, test ini bisa pass di laptop tapi gagal production.

---

## 12. Retry Testing

Retry adalah salah satu sumber incident terbesar jika tidak diuji.

### 12.1 Retry Harus Punya Policy

Retry policy minimal:

```text
Apa yang retryable?
Berapa max attempt?
Berapa delay/backoff?
Apakah jitter dipakai?
Apa yang terjadi setelah exhausted?
Apakah side effect aman saat retry?
```

### 12.2 Retryable vs Non-Retryable

Retryable:

- network timeout,
- external 503,
- broker temporary unavailable,
- DB deadlock,
- optimistic lock conflict tertentu,
- rate limit 429 dengan backoff.

Non-retryable:

- invalid schema,
- missing required field,
- unknown aggregate permanen,
- authorization forbidden,
- invalid state transition permanen,
- validation error.

Test harus membedakan keduanya.

### 12.3 Unit Test Retry with Fake External Client

```java
@Test
void shouldRetryTransientExternalFailure() {
    FakeExternalClient client = new FakeExternalClient()
        .failTimes(2, new ExternalUnavailableException())
        .thenReturn(SyncResult.success());

    SyncHandler handler = new SyncHandler(client, retryPolicy(maxAttempts(3)), auditRepository);

    handler.handle(syncCommand("CMD-001", "CASE-001"));

    assertThat(client.calls()).hasSize(3);
    assertThat(auditRepository.findByCommandId("CMD-001"))
        .singleElement()
        .satisfies(audit -> assertThat(audit.getResult()).isEqualTo("SUCCESS_AFTER_RETRY"));
}
```

### 12.4 Test Retry Exhausted

```java
@Test
void shouldMoveToFailureWhenRetryExhausted() {
    FakeExternalClient client = new FakeExternalClient()
        .alwaysFail(new ExternalUnavailableException());

    SyncHandler handler = new SyncHandler(client, retryPolicy(maxAttempts(3)), failureRepository);

    assertThatThrownBy(() -> handler.handle(syncCommand("CMD-001", "CASE-001")))
        .isInstanceOf(RetryExhaustedException.class);

    assertThat(client.calls()).hasSize(3);
    assertThat(failureRepository.findByCommandId("CMD-001"))
        .singleElement()
        .satisfies(failure -> {
            assertThat(failure.getAttemptCount()).isEqualTo(3);
            assertThat(failure.getStatus()).isEqualTo("FAILED_RETRY_EXHAUSTED");
        });
}
```

### 12.5 Broker-Level Retry Test

Beberapa framework melakukan retry di listener container.

Test harus membuktikan:

- message di-redeliver,
- attempt count meningkat,
- setelah max attempt masuk DLQ,
- side effect tidak partial/duplicate.

Pseudo:

```java
@Test
void malformedMessageShouldGoToDlqWithoutBusinessSideEffect() {
    kafkaTemplate.send("case.approved", "CASE-001", "{ invalid-json");

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        ConsumerRecord<String, String> dlq = dlqConsumer.pollOne();
        assertThat(dlq.key()).isEqualTo("CASE-001");
        assertThat(dlq.value()).contains("invalid-json");
    });

    assertThat(auditRepository.findByCaseId("CASE-001")).isEmpty();
}
```

### 12.6 Retry Amplification Test

Dalam system integration, retry bisa memperparah outage.

Contoh:

```text
10 requests fail
3 retry each
30 extra calls
external dependency makin jatuh
```

Test di level unit/integration bisa memverifikasi max attempt dan backoff.

Performance/load test nanti memverifikasi amplification secara sistemik.

---

## 13. Dead Letter Queue / Dead Letter Channel Testing

DLQ adalah tempat message yang tidak bisa diproses setelah policy tertentu.

### 13.1 DLQ Bukan Tempat Sampah

DLQ harus menjadi evidence.

DLQ message idealnya membawa:

- original payload,
- original headers,
- failure reason,
- exception class/message,
- attempt count,
- failed at,
- consumer name,
- correlation id,
- stack trace terbatas atau reference error id.

### 13.2 Kapan Message Masuk DLQ

Umum:

- schema invalid,
- poison message,
- non-retryable validation failure,
- retry exhausted,
- unsupported version,
- unauthorized source,
- permanent domain conflict.

### 13.3 Test DLQ Routing

```java
@Test
void unsupportedSchemaVersionShouldBePublishedToDlq() {
    String payload = """
        {
          "eventId": "EVT-001",
          "eventType": "CASE_SUBMITTED",
          "schemaVersion": 999,
          "aggregateId": "CASE-001"
        }
        """;

    broker.publish("case.submitted", "CASE-001", payload);

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        DlqMessage dlq = dlqRepository.findByEventId("EVT-001").orElseThrow();
        assertThat(dlq.getReason()).contains("Unsupported schemaVersion");
        assertThat(dlq.getOriginalPayload()).contains("CASE_SUBMITTED");
    });

    assertThat(caseRepository.findById("CASE-001")).isEmpty();
}
```

### 13.4 Test DLQ Does Not Ack Too Early

Bug serius:

```text
consumer ack message sebelum DB commit,
lalu DB gagal,
message hilang dan tidak masuk DLQ.
```

Sulit diuji di unit test. Butuh integration test dengan broker atau framework listener yang mendukung manual ack.

Test idea:

1. Publish message.
2. Force DB failure during handler.
3. Assert message redelivered atau DLQ sesuai policy.
4. Assert business side effect tidak commit.

---

## 14. Scheduler Testing

Scheduler testing sering flaky karena engineer membiarkan scheduler real berjalan.

### 14.1 Jangan Test Cron Expression sebagai Waktu Real

Buruk:

```java
@Test
void jobShouldRunAtMidnight() throws Exception {
    Thread.sleep(Duration.between(now, midnight).toMillis());
    assertThat(jobResult()).isTrue();
}
```

Tentu tidak masuk akal.

Pisahkan:

1. cron trigger config,
2. job logic,
3. locking/lease,
4. data selection,
5. side effect.

### 14.2 Job Harus Punya `runOnce()`

Desain:

```java
public final class SlaEscalationJob {
    public void runOnce() {
        List<CaseEntity> dueCases = caseRepository.findCasesDueForEscalation(clock.instant());
        for (CaseEntity c : dueCases) {
            escalationService.escalate(c.getId(), clock.instant());
        }
    }
}
```

Scheduler adapter:

```java
@Scheduled(cron = "0 */5 * * * *")
public void scheduledRun() {
    job.runOnce();
}
```

Test job logic tanpa menunggu cron.

### 14.3 Test Data Selection

```java
@Test
void shouldEscalateOnlyCasesPastSlaDueTime() {
    MutableClock clock = MutableClock.fixed("2026-06-16T10:00:00Z");

    repository.save(CaseEntity.underReview("CASE-DUE", dueAt("2026-06-16T09:59:00Z")));
    repository.save(CaseEntity.underReview("CASE-NOT-DUE", dueAt("2026-06-16T10:01:00Z")));
    repository.save(CaseEntity.approved("CASE-DONE", dueAt("2026-06-16T09:00:00Z")));

    job.runOnce();

    assertThat(repository.getRequired("CASE-DUE").isEscalated()).isTrue();
    assertThat(repository.getRequired("CASE-NOT-DUE").isEscalated()).isFalse();
    assertThat(repository.getRequired("CASE-DONE").isEscalated()).isFalse();
}
```

### 14.4 Test Job Idempotency

Scheduler bisa jalan dua kali.

```java
@Test
void runningEscalationJobTwiceShouldNotCreateDuplicateEscalation() {
    repository.save(CaseEntity.underReview("CASE-001", dueAtPast()));

    job.runOnce();
    job.runOnce();

    assertThat(escalationRepository.findByCaseId("CASE-001")).hasSize(1);
    assertThat(auditRepository.findByCaseIdAndAction("CASE-001", "SLA_ESCALATED"))
        .hasSize(1);
}
```

### 14.5 Test Job Locking

Jika ada multiple instances, scheduler perlu distributed lock/lease.

Test:

```java
@Test
void secondJobInstanceShouldSkipWhenLockHeld() {
    lockRepository.acquire("sla-escalation", "instance-1", clock.instant().plusSeconds(60));

    JobRunResult result = jobInstance2.runOnce();

    assertThat(result.status()).isEqualTo(JobRunStatus.SKIPPED_LOCK_HELD);
    assertThat(escalationRepository.findAll()).isEmpty();
}
```

### 14.6 Test Expired Lock Recovery

```java
@Test
void shouldAcquireExpiredLock() {
    lockRepository.acquire("sla-escalation", "dead-instance", clock.instant().minusSeconds(1));

    JobRunResult result = job.runOnce();

    assertThat(result.status()).isEqualTo(JobRunStatus.COMPLETED);
    assertThat(lockRepository.ownerOf("sla-escalation")).isEqualTo("current-instance");
}
```

### 14.7 Test Batch Limit

Scheduler harus punya limit agar tidak overload.

```java
@Test
void shouldProcessOnlyConfiguredBatchSize() {
    insertDueCases(100);

    SlaEscalationJob job = new SlaEscalationJob(repository, service, batchSize(25));

    job.runOnce();

    assertThat(escalationRepository.count()).isEqualTo(25);
}
```

---

## 15. Async Worker dan Executor Testing

Async worker bisa memakai:

- `ExecutorService`,
- `CompletableFuture`,
- Spring `@Async`,
- virtual threads,
- queue internal,
- scheduler pool.

### 15.1 Jangan Biarkan Executor Sulit Dikontrol

Buruk:

```java
public void submit(Task task) {
    Executors.newFixedThreadPool(10).submit(() -> process(task));
}
```

Masalah:

- thread pool tidak bisa diganti di test,
- lifecycle bocor,
- test tidak tahu kapan selesai.

Baik:

```java
public final class TaskProcessor {
    private final Executor executor;

    public TaskProcessor(Executor executor) {
        this.executor = executor;
    }

    public CompletableFuture<Void> submit(Task task) {
        return CompletableFuture.runAsync(() -> process(task), executor);
    }
}
```

Test bisa pakai direct executor:

```java
Executor directExecutor = Runnable::run;
```

### 15.2 Unit Test dengan Direct Executor

```java
@Test
void shouldProcessTaskSynchronouslyInTest() {
    TaskProcessor processor = new TaskProcessor(Runnable::run, repository);

    CompletableFuture<Void> future = processor.submit(new Task("TASK-001"));

    assertThat(future).isCompleted();
    assertThat(repository.get("TASK-001").status()).isEqualTo(TaskStatus.PROCESSED);
}
```

### 15.3 Integration Test dengan Real Executor

Untuk behavior concurrency tertentu, gunakan real executor.

```java
@Test
void shouldProcessTasksConcurrentlyWithoutDuplicateResult() {
    ExecutorService executor = Executors.newFixedThreadPool(4);
    TaskProcessor processor = new TaskProcessor(executor, repository);

    List<CompletableFuture<Void>> futures = IntStream.range(0, 20)
        .mapToObj(i -> processor.submit(new Task("TASK-" + i)))
        .toList();

    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

    assertThat(repository.countByStatus(TaskStatus.PROCESSED)).isEqualTo(20);
}
```

### 15.4 Testing CompletableFuture Failure

```java
@Test
void failedAsyncTaskShouldCompleteExceptionally() {
    TaskProcessor processor = new TaskProcessor(Runnable::run, failingHandler);

    CompletableFuture<Void> future = processor.submit(new Task("TASK-001"));

    assertThat(future).isCompletedExceptionally();
}
```

### 15.5 Async Exception Visibility

Bug umum:

```text
exception terjadi di async thread tapi test tetap pass.
```

Pastikan test mengamati:

- returned future,
- error repository,
- DLQ,
- failed task status,
- uncaught exception handler,
- metric/error counter.

---

## 16. Testing Message Ordering

Ordering harus diuji hanya jika menjadi business requirement.

### 16.1 Jangan Asumsikan Global Ordering

Kafka ordering hanya dalam partition.

Jika key berbeda, ordering antar key tidak dijamin.

Test yang salah:

```text
publish event A key CASE-1
publish event B key CASE-2
expect A processed before B
```

Itu bukan contract Kafka.

### 16.2 Per-Aggregate Ordering

Untuk workflow case, biasanya ordering yang penting adalah per case.

```text
CASE-001: submitted -> reviewed -> approved
CASE-002: submitted -> withdrawn
```

Gunakan aggregate id sebagai message key jika broker mendukung partition ordering.

Test producer:

```java
@Test
void caseEventsShouldUseCaseIdAsMessageKey() {
    producer.publish(caseSubmitted("CASE-001"));

    PublishedMessage message = fakeBroker.singleMessage();
    assertThat(message.key()).isEqualTo("CASE-001");
}
```

### 16.3 Consumer Stale Event Test

Jika event lama datang setelah state lebih baru:

```java
@Test
void staleSubmittedEventShouldNotMoveApprovedCaseBackToSubmitted() {
    repository.save(CaseEntity.approved("CASE-001"));

    consumer.handle(caseSubmitted("EVT-OLD", "CASE-001", occurredAtPast()));

    assertThat(repository.getRequired("CASE-001").getStatus())
        .isEqualTo(CaseStatus.APPROVED);
    assertThat(auditRepository.findByEventId("EVT-OLD"))
        .singleElement()
        .satisfies(audit -> assertThat(audit.getResult()).isEqualTo("IGNORED_STALE_EVENT"));
}
```

### 16.4 Version-Based Ordering

Jika aggregate punya version:

```json
{
  "caseId": "CASE-001",
  "aggregateVersion": 5
}
```

Test:

```java
@Test
void eventWithOlderAggregateVersionShouldBeIgnored() {
    repository.save(CaseEntity.withVersion("CASE-001", 6));

    consumer.handle(eventWithVersion("EVT-001", "CASE-001", 5));

    assertThat(repository.getRequired("CASE-001").version()).isEqualTo(6);
}
```

---

## 17. Testing Message Serialization dan Deserialization

Async failure sering terjadi karena serialization mismatch.

### 17.1 JSON Message Pitfalls

- `LocalDateTime` tanpa timezone.
- `BigDecimal` menjadi floating point.
- Enum rename.
- Unknown property failure.
- Null vs missing field.
- Empty string vs null.
- Field case mismatch.
- Date format berubah.
- Polymorphic type unsafe.

### 17.2 Deserialization Contract Test

```java
@Test
void shouldDeserializeEventWithUnknownOptionalField() throws Exception {
    String json = """
        {
          "eventId": "EVT-001",
          "eventType": "CASE_SUBMITTED",
          "caseId": "CASE-001",
          "occurredAt": "2026-06-16T00:00:00Z",
          "futureField": "new-value"
        }
        """;

    CaseSubmittedEvent event = objectMapper.readValue(json, CaseSubmittedEvent.class);

    assertThat(event.caseId()).isEqualTo("CASE-001");
}
```

### 17.3 Required Field Test

```java
@Test
void missingCaseIdShouldBeRejected() {
    String json = """
        {
          "eventId": "EVT-001",
          "eventType": "CASE_SUBMITTED"
        }
        """;

    assertThatThrownBy(() -> parser.parse(json))
        .isInstanceOf(InvalidMessageException.class)
        .hasMessageContaining("caseId");
}
```

### 17.4 Null Semantics Test

```java
@Test
void explicitNullReasonShouldBeRejectedForRejectionEvent() {
    String json = """
        {
          "eventId": "EVT-001",
          "eventType": "CASE_REJECTED",
          "caseId": "CASE-001",
          "reason": null
        }
        """;

    assertThatThrownBy(() -> parser.parse(json))
        .isInstanceOf(InvalidMessageException.class)
        .hasMessageContaining("reason");
}
```

---

## 18. Testing Audit dan Observability untuk Async Flow

Dalam sistem regulatory, audit async sama pentingnya dengan state change.

### 18.1 Audit Harus Menjawab

```text
Message apa yang memicu perubahan?
Kapan diterima?
Kapan diproses?
Siapa aktornya?
Correlation id apa?
State sebelum dan sesudah apa?
Apakah retry terjadi?
Apakah message duplicate?
Apakah ada failure?
```

### 18.2 Audit Test

```java
@Test
void messageProcessingShouldCreateAuditWithCorrelationId() {
    CaseApprovedEvent event = new CaseApprovedEvent(
        "EVT-001",
        "CASE-001",
        "MANAGER-001",
        now,
        "CORR-001"
    );

    handler.handle(event);

    assertThat(auditRepository.findByCorrelationId("CORR-001"))
        .singleElement()
        .satisfies(audit -> {
            assertThat(audit.getEventId()).isEqualTo("EVT-001");
            assertThat(audit.getAction()).isEqualTo("CASE_APPROVED");
            assertThat(audit.getBeforeStatus()).isEqualTo("UNDER_REVIEW");
            assertThat(audit.getAfterStatus()).isEqualTo("APPROVED");
        });
}
```

### 18.3 Failure Audit Test

```java
@Test
void failedMessageShouldRecordFailureAudit() {
    CaseApprovedEvent event = approvedEvent("EVT-001", "UNKNOWN-CASE");

    assertThatThrownBy(() -> handler.handle(event))
        .isInstanceOf(CaseNotFoundException.class);

    assertThat(auditRepository.findFailureByEventId("EVT-001"))
        .singleElement()
        .satisfies(audit -> {
            assertThat(audit.getResult()).isEqualTo("FAILED");
            assertThat(audit.getErrorCode()).isEqualTo("CASE_NOT_FOUND");
        });
}
```

### 18.4 Metrics Test: Biasanya Jangan Terlalu Banyak

Metrics bisa diuji jika punya wrapper/fake registry.

```java
@Test
void shouldIncrementRetryMetricOnTransientFailure() {
    fakeClient.failOnceThenSucceed();

    handler.handle(command);

    assertThat(metrics.counter("case.sync.retry", Tags.of("reason", "timeout")).count())
        .isEqualTo(1);
}
```

Namun jangan membuat terlalu banyak test yang rapuh terhadap nama metric jika metric bukan contract penting.

---

## 19. Testing External Side Effects dari Consumer

Consumer sering memanggil external system.

Contoh:

```text
CaseApprovedEvent -> call external registry -> update sync status
```

### 19.1 Test Success

```java
@Test
void shouldSyncApprovedCaseToExternalRegistry() {
    wireMock.stubFor(post("/registry/cases")
        .willReturn(okJson("{\"status\":\"ACCEPTED\"}")));

    handler.handle(caseApproved("EVT-001", "CASE-001"));

    wireMock.verify(postRequestedFor(urlEqualTo("/registry/cases"))
        .withHeader("Idempotency-Key", equalTo("EVT-001"))
        .withRequestBody(containing("CASE-001")));

    assertThat(syncRepository.findByEventId("EVT-001").status())
        .isEqualTo(SyncStatus.SUCCESS);
}
```

### 19.2 Test Timeout

```java
@Test
void externalTimeoutShouldBeRetryable() {
    wireMock.stubFor(post("/registry/cases")
        .willReturn(aResponse().withFixedDelay(10_000)));

    assertThatThrownBy(() -> handler.handle(caseApproved("EVT-001", "CASE-001")))
        .isInstanceOf(RetryableExternalException.class);

    assertThat(syncRepository.findByEventId("EVT-001").status())
        .isEqualTo(SyncStatus.RETRY_PENDING);
}
```

### 19.3 Test 4xx Non-Retryable

```java
@Test
void externalBadRequestShouldNotRetryAndShouldMarkPermanentFailure() {
    wireMock.stubFor(post("/registry/cases")
        .willReturn(badRequest().withBody("invalid case")));

    assertThatThrownBy(() -> handler.handle(caseApproved("EVT-001", "CASE-001")))
        .isInstanceOf(NonRetryableExternalException.class);

    assertThat(syncRepository.findByEventId("EVT-001").status())
        .isEqualTo(SyncStatus.PERMANENT_FAILURE);
}
```

---

## 20. Testing Transaction Boundary in Async Consumer

Transaction boundary menentukan apakah side effect atomic.

### 20.1 Dangerous Consumer

```java
public void handle(Event event) {
    auditRepository.insert(...);
    caseRepository.update(...);
    externalClient.call(...);
    processedMessageRepository.insert(...);
}
```

Jika external call gagal setelah DB update, state bisa partial.

### 20.2 Test Partial Failure

```java
@Test
void externalFailureShouldNotCommitCaseUpdateIfPolicyRequiresAtomicity() {
    repository.save(CaseEntity.underReview("CASE-001"));
    externalClient.alwaysFail();

    assertThatThrownBy(() -> handler.handle(caseApproved("EVT-001", "CASE-001")))
        .isInstanceOf(ExternalUnavailableException.class);

    assertThat(repository.getRequired("CASE-001").getStatus())
        .isEqualTo(CaseStatus.UNDER_REVIEW);
    assertThat(auditRepository.findByEventId("EVT-001")).isEmpty();
}
```

Namun sering kali external call tidak boleh berada dalam DB transaction. Maka pattern lebih baik:

```text
message consumer -> update DB + create outbox external-sync-command -> commit
external sync worker -> call external system idempotently
```

Test harus sesuai policy arsitektur.

### 20.3 Test Commit Before Ack

High-level assertion:

```text
Jika DB commit gagal, message tidak boleh dianggap selesai.
```

Pseudo:

```java
@Test
void databaseCommitFailureShouldCauseMessageRetry() {
    database.failNextCommit();

    broker.publish("case.approved", payload);

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        assertThat(broker.deliveryAttempts("EVT-001")).isGreaterThanOrEqualTo(2);
    });

    assertThat(processedMessageRepository.exists("EVT-001")).isFalse();
}
```

Implementasi detail tergantung broker/framework.

---

## 21. RabbitMQ-Specific Testing Notes

RabbitMQ memiliki semantics berbeda dari Kafka.

### 21.1 Hal yang Perlu Diuji

- exchange name,
- exchange type,
- routing key,
- queue binding,
- durable queue,
- dead-letter exchange,
- TTL,
- manual ack/nack,
- requeue behavior,
- prefetch,
- consumer concurrency.

### 21.2 Routing Test

```java
@Test
void shouldRouteCaseSubmittedMessageToCaseWorkflowQueue() {
    rabbitTemplate.convertAndSend(
        "case.exchange",
        "case.submitted",
        payload
    );

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        Message message = rabbitTemplate.receive("case.workflow.queue");
        assertThat(message).isNotNull();
        assertThat(new String(message.getBody(), UTF_8)).contains("CASE_SUBMITTED");
    });
}
```

### 21.3 Nack/DLQ Test

```java
@Test
void invalidMessageShouldBeDeadLettered() {
    rabbitTemplate.convertAndSend("case.exchange", "case.submitted", "invalid-json");

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        Message dlq = rabbitTemplate.receive("case.workflow.dlq");
        assertThat(dlq).isNotNull();
        assertThat(new String(dlq.getBody(), UTF_8)).contains("invalid-json");
    });
}
```

### 21.4 Prefetch dan Concurrency

Jika prefetch terlalu tinggi, satu consumer bisa mengambil banyak message dan menyebabkan unfairness atau memory pressure.

Testing unit tidak cukup. Integration/load test lebih cocok.

Tetapi test config bisa memverifikasi property binding:

```java
assertThat(listenerContainer.getPrefetchCount()).isEqualTo(10);
assertThat(listenerContainer.getConcurrentConsumers()).isEqualTo(4);
```

Jangan terlalu banyak test config internal kecuali setting itu critical.

---

## 22. Kafka-Specific Testing Notes

Kafka testing punya perhatian khusus.

### 22.1 Hal yang Perlu Diuji

- topic name,
- key,
- partitioning strategy,
- consumer group,
- offset commit,
- deserialization error handler,
- retry topic / DLT,
- schema registry compatibility,
- transactional producer jika dipakai,
- compaction key jika compacted topic.

### 22.2 Key Test

```java
@Test
void caseEventsShouldUseCaseIdAsKafkaKey() {
    producer.publish(caseSubmitted("CASE-001"));

    ProducerRecord<String, String> record = fakeKafkaProducer.singleRecord();
    assertThat(record.topic()).isEqualTo("case.events");
    assertThat(record.key()).isEqualTo("CASE-001");
}
```

Kenapa key penting?

```text
Key menentukan partition.
Partition menentukan ordering per aggregate.
```

### 22.3 Consumer Group Test

Biasanya tidak perlu unit test consumer group, tetapi integration test bisa menangkap misconfiguration topic/group.

```java
@Test
void listenerShouldConsumeFromConfiguredTopic() {
    kafkaTemplate.send("case.events", "CASE-001", payload);

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
        assertThat(repository.getRequired("CASE-001").status())
            .isEqualTo(CaseStatus.SUBMITTED)
    );
}
```

### 22.4 Offset Commit Semantics

Offset commit terlalu awal bisa menyebabkan message loss.

Framework biasanya mengelola ini. Tetapi untuk critical consumer, test failure behavior.

```text
publish message
handler fails before commit
expect redelivery or DLT
```

### 22.5 Compacted Topic Test

Jika memakai compacted topic, key null bisa fatal.

Producer test:

```java
@Test
void compactedTopicMessageShouldAlwaysHaveKey() {
    producer.publish(caseSnapshot("CASE-001"));

    assertThat(fakeKafkaProducer.singleRecord().key()).isEqualTo("CASE-001");
}
```

---

## 23. Testcontainers Strategy untuk Messaging

### 23.1 Kapan Pakai Testcontainers

Gunakan real broker container saat ingin membuktikan:

- listener benar-benar connected,
- serialization/deserialization benar,
- routing/topic/queue benar,
- DLQ behavior benar,
- retry integration benar,
- broker-specific semantics benar.

Tidak perlu pakai container untuk setiap business edge case. Handler unit test lebih cepat.

### 23.2 Layering yang Efisien

Ideal:

```text
Banyak handler unit tests
Beberapa producer/consumer integration tests
Sedikit full async flow tests
Sedikit failure/DLQ tests
```

Jangan semua test memakai broker container.

### 23.3 Container Lifecycle

Untuk kecepatan:

- gunakan static container per test class,
- reuse container jika policy project mengizinkan,
- isolate topic/queue per test,
- cleanup state antar test,
- gunakan unique consumer group per test.

### 23.4 Dynamic Properties

Spring-style pseudo:

```java
@DynamicPropertySource
static void kafkaProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
}
```

### 23.5 Topic/Queue Isolation

Flaky test sering terjadi karena state broker sisa test lain.

Strategi:

```java
String topic = "case.events." + UUID.randomUUID();
String groupId = "test-group-" + UUID.randomUUID();
```

Atau cleanup topic/queue sebelum test.

---

## 24. Async Test Failure Diagnostics

Test async harus gagal dengan informasi yang jelas.

### 24.1 Failure Message Buruk

```text
ConditionTimeoutException: Condition was not fulfilled within 10 seconds.
```

Tidak cukup.

### 24.2 Failure Message Baik

Tambahkan diagnostic saat polling.

```java
await()
    .alias("case CASE-001 should become APPROVED after CaseApprovedEvent EVT-001")
    .atMost(Duration.ofSeconds(10))
    .untilAsserted(() -> {
        Optional<CaseEntity> entity = repository.findById("CASE-001");
        List<AuditEntry> audits = auditRepository.findByCaseId("CASE-001");
        List<FailureRecord> failures = failureRepository.findByEventId("EVT-001");

        assertThat(entity)
            .as("case entity; audits=%s failures=%s", audits, failures)
            .isPresent();

        assertThat(entity.orElseThrow().getStatus())
            .as("audits=%s failures=%s", audits, failures)
            .isEqualTo(CaseStatus.APPROVED);
    });
```

### 24.3 Capture Message Trace

Untuk test integration, simpan trace:

```java
record MessageTrace(
    String eventId,
    String topic,
    String key,
    Instant publishedAt,
    Instant consumedAt,
    String consumerName,
    String result,
    String error
) {}
```

Dalam test failure, tampilkan trace.

### 24.4 Assert Intermediate State Jika Penting

Misalnya outbox flow:

```text
API submit
  -> assert outbox pending created
  -> run relay
  -> assert broker received
  -> assert outbox published
```

Jangan langsung assert final state jika failure sulit didiagnosis.

---

## 25. Anti-Patterns

### 25.1 `Thread.sleep` Everywhere

Gejala:

```java
Thread.sleep(1000);
```

Solusi:

- Awaitility,
- future join with timeout,
- latch only jika event deterministic,
- fake clock,
- runOnce.

### 25.2 Testing Framework Instead of Behavior

Buruk:

```java
verify(kafkaTemplate).send(...)
```

Ini kadang berguna, tetapi tidak membuktikan message contract atau side effect.

Lebih baik untuk producer unit:

```text
assert domain event content
```

Untuk integration:

```text
assert broker-observed message
```

### 25.3 One Giant E2E Async Test

Buruk:

```text
submit API -> 10 services -> 6 queues -> 3 DBs -> assert report generated
```

Masalah:

- lambat,
- flaky,
- sulit diagnosis,
- environment-heavy.

Pecah menjadi:

- producer tests,
- contract tests,
- consumer tests,
- outbox relay tests,
- one or two critical E2E smoke tests.

### 25.4 Assuming No Duplicate

Jika test tidak pernah mengirim duplicate, consumer belum terbukti production-safe.

### 25.5 Assuming Ordering Without Key/Version

Ordering harus didesain, bukan diasumsikan.

### 25.6 Scheduler Without `runOnce`

Jika job logic hanya bisa dipicu cron, test menjadi sulit dan flaky.

### 25.7 Hidden Global Broker State

Topic/queue yang sama dipakai banyak test bisa menyebabkan cross-test pollution.

### 25.8 Ack Before Commit

Ini bukan test anti-pattern saja, tapi design bug.

Test harus menangkap message loss scenario untuk flow critical.

### 25.9 Mocking Broker Too Much

Mock broker tidak punya:

- serialization semantics,
- offset,
- requeue,
- DLQ,
- routing,
- consumer group,
- ordering.

Gunakan mock untuk unit, bukan confidence integration.

### 25.10 No Negative Assertions

Happy path async test tanpa negative assertion bisa melewatkan duplicate side effect.

---

## 26. Java 8–25 Compatibility Notes

### 26.1 Java 8

Masih banyak enterprise system Java 8 memakai:

- JUnit 4 atau JUnit 5,
- `CompletableFuture`,
- executor manual,
- older Spring Boot,
- older Kafka/Rabbit client,
- limited modern test library versions.

Catatan:

- `List.of` belum ada.
- `var` belum ada.
- records belum ada.
- text block belum ada.
- virtual threads belum ada.
- JUnit 6 tidak cocok karena butuh Java 17+.

Untuk materi, contoh modern kadang memakai records/text block. Untuk Java 8, ubah menjadi class POJO/string biasa.

### 26.2 Java 11

Baseline migration umum.

Fitur membantu:

- `var` di local variable,
- HTTP Client standard,
- improved container awareness dibanding era lama,
- still no records/text blocks final.

### 26.3 Java 17

Modern enterprise baseline.

Fitur membantu:

- records,
- sealed classes,
- text blocks,
- pattern matching improvements,
- JUnit 6 compatibility baseline.

Message DTO bisa dibuat record jika framework serialization mendukung.

### 26.4 Java 21

Virtual threads tersedia sebagai fitur final.

Implikasi test async:

- virtual threads memudahkan blocking-style concurrency,
- tetap tidak menghilangkan race condition,
- tetap perlu idempotency,
- tetap perlu timeout,
- pinned carrier thread bisa relevan untuk performance, bukan correctness unit test biasa.

Test tidak boleh menganggap virtual thread membuat async flow deterministic.

### 26.5 Java 25

Untuk seri ini, Java 25 diperlakukan sebagai modern JDK target. Prinsip testing async tetap sama:

- deterministic time,
- observable state,
- idempotency,
- broker semantics,
- contract compatibility,
- production diagnostics.

Perbedaan utama biasanya ada pada toolchain/library support, bukan prinsip fundamental.

---

## 27. Practical Architecture Pattern: Testable Async Component

Gunakan boundary seperti ini:

```text
Broker Adapter / Listener
  -> Message Parser / Validator
  -> Application Handler
  -> Domain Service / Aggregate
  -> Repository
  -> Outbox / Audit / Processed Message
```

### 27.1 Example Structure

```java
public final class CaseApprovedListener {
    private final MessageParser parser;
    private final CaseApprovedHandler handler;

    public void onMessage(String rawPayload, MessageHeaders headers) {
        CaseApprovedEvent event = parser.parse(rawPayload, headers);
        handler.handle(event);
    }
}
```

```java
public final class CaseApprovedHandler {
    private final ProcessedMessageService processedMessages;
    private final CaseRepository caseRepository;
    private final AuditRepository auditRepository;
    private final OutboxRepository outboxRepository;

    @Transactional
    public void handle(CaseApprovedEvent event) {
        if (!processedMessages.tryStart("case-approved-handler", event.eventId())) {
            return;
        }

        CaseEntity caseEntity = caseRepository.getRequired(event.caseId());
        caseEntity.approve(event.actorId(), event.occurredAt());

        caseRepository.save(caseEntity);
        auditRepository.insert(AuditEntry.caseApproved(event, caseEntity));
        outboxRepository.insert(NotifyApplicantCommand.from(event));

        processedMessages.markProcessed("case-approved-handler", event.eventId());
    }
}
```

### 27.2 Test Layers

#### Parser Test

```text
raw JSON + headers -> event object or InvalidMessageException
```

#### Handler Unit Test

```text
event object -> DB/audit/outbox behavior
```

#### Listener Integration Test

```text
broker payload -> listener -> handler -> DB/audit/outbox
```

#### Outbox Relay Test

```text
outbox row -> broker message -> mark published
```

#### End-to-End Smoke

```text
API command -> outbox -> relay -> consumer -> final state
```

---

## 28. Case Study: Case Submitted Event Flow

### 28.1 Business Flow

```text
User submits application case.
System must:
1. change case status from DRAFT to SUBMITTED,
2. create audit trail,
3. create outbox event CaseSubmitted,
4. relay event to broker,
5. screening consumer creates screening task,
6. duplicate event must not create duplicate screening task,
7. invalid event must go to DLQ.
```

### 28.2 Unit Test: Submit Creates Outbox

```java
@Test
void submitCaseShouldCreateAuditAndOutbox() {
    repository.save(CaseEntity.draft("CASE-001"));

    service.submit("CASE-001", Actor.user("U-001"));

    assertThat(repository.getRequired("CASE-001").getStatus())
        .isEqualTo(CaseStatus.SUBMITTED);

    assertThat(auditRepository.findByCaseId("CASE-001"))
        .singleElement()
        .satisfies(audit -> {
            assertThat(audit.getAction()).isEqualTo("CASE_SUBMITTED");
            assertThat(audit.getActorId()).isEqualTo("U-001");
        });

    assertThat(outboxRepository.findByAggregateId("CASE-001"))
        .singleElement()
        .satisfies(outbox -> {
            assertThat(outbox.getEventType()).isEqualTo("CASE_SUBMITTED");
            assertThat(outbox.getStatus()).isEqualTo(OutboxStatus.PENDING);
        });
}
```

### 28.3 Integration Test: Relay Publishes Message

```java
@Test
void relayShouldPublishCaseSubmittedEvent() {
    outboxRepository.insertPending(caseSubmittedOutbox("CASE-001"));

    relay.runOnce();

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        PublishedMessage msg = brokerTestClient.findByKey("CASE-001").orElseThrow();
        assertThat(msg.topic()).isEqualTo("case.submitted");
        assertThat(msg.payload()).contains("CASE_SUBMITTED");
    });
}
```

### 28.4 Consumer Test: Create Screening Task

```java
@Test
void screeningConsumerShouldCreateTaskForSubmittedCase() {
    repository.save(CaseEntity.submitted("CASE-001"));

    screeningConsumer.handle(caseSubmitted("EVT-001", "CASE-001"));

    assertThat(screeningTaskRepository.findByCaseId("CASE-001"))
        .singleElement()
        .satisfies(task -> {
            assertThat(task.getSourceEventId()).isEqualTo("EVT-001");
            assertThat(task.getStatus()).isEqualTo(ScreeningStatus.PENDING);
        });
}
```

### 28.5 Duplicate Consumer Test

```java
@Test
void duplicateSubmittedEventShouldNotCreateDuplicateScreeningTask() {
    repository.save(CaseEntity.submitted("CASE-001"));

    CaseSubmittedEvent event = caseSubmitted("EVT-001", "CASE-001");

    screeningConsumer.handle(event);
    screeningConsumer.handle(event);

    assertThat(screeningTaskRepository.findByCaseId("CASE-001")).hasSize(1);
    assertThat(processedMessageRepository.exists("screening-consumer", "EVT-001")).isTrue();
}
```

### 28.6 Invalid Message DLQ Test

```java
@Test
void invalidSubmittedMessageShouldGoToDlq() {
    broker.publish("case.submitted", "CASE-001", "{ invalid-json");

    await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
        DlqMessage dlq = dlqClient.findByKey("CASE-001").orElseThrow();
        assertThat(dlq.reason()).contains("JSON");
    });

    assertThat(screeningTaskRepository.findByCaseId("CASE-001")).isEmpty();
}
```

---

## 29. Review Checklist untuk Async/Messaging Test

Gunakan checklist ini saat review PR.

### 29.1 Producer

- [ ] Event hanya diproduksi pada state transition valid.
- [ ] Payload field penting diuji.
- [ ] Message key/routing diuji.
- [ ] Headers/correlation id diuji jika critical.
- [ ] Tidak publish jika transaksi gagal.
- [ ] Outbox digunakan jika consistency DB+broker penting.

### 29.2 Consumer

- [ ] Valid message menghasilkan side effect benar.
- [ ] Invalid message tidak menghasilkan side effect bisnis.
- [ ] Duplicate message aman.
- [ ] Out-of-order/stale message punya policy dan test.
- [ ] Retryable vs non-retryable dibedakan.
- [ ] DLQ behavior diuji untuk poison message.
- [ ] Ack/commit boundary aman.
- [ ] Audit/observability diuji untuk flow critical.

### 29.3 Scheduler

- [ ] Job logic punya `runOnce()`.
- [ ] Fake clock dipakai untuk time-dependent logic.
- [ ] Data selection diuji.
- [ ] Job idempotency diuji.
- [ ] Lock/lease diuji jika multi-instance.
- [ ] Batch limit diuji.

### 29.4 Test Quality

- [ ] Tidak ada `Thread.sleep` tanpa alasan kuat.
- [ ] Await condition berdasarkan state/side effect.
- [ ] Timeout eksplisit.
- [ ] Failure diagnostic cukup jelas.
- [ ] Test data isolated.
- [ ] Topic/queue/consumer group isolated.
- [ ] Tidak semua edge case memakai broker container.
- [ ] Handler unit test cukup banyak.
- [ ] Integration test cukup untuk wiring/broker semantics.

---

## 30. Top 1% Engineer Notes

Engineer biasa sering bertanya:

```text
Bagaimana cara test Kafka consumer?
```

Engineer yang lebih kuat bertanya:

```text
Contract apa yang harus dibuktikan oleh consumer ini?
Apa failure mode production yang paling mungkin?
Apakah duplicate aman?
Apakah ack terjadi setelah commit?
Apa evidence jika message gagal?
Apakah outbox/inbox boundary benar?
Apakah test ini deterministic?
Apakah failure test memberi diagnosis?
```

Perbedaan levelnya bukan pada library, tetapi pada **model risiko**.

Async/message-driven system harus diuji dengan mindset:

```text
Messages can be duplicated.
Messages can arrive late.
Messages can arrive out of order.
Consumers can crash after side effects.
Brokers can redeliver.
External systems can timeout.
Schedulers can overlap.
Tests must prove the system remains safe.
```

Untuk sistem regulatory/case-management, kata kuncinya adalah **defensibility**:

```text
Setiap state change harus bisa dijelaskan.
Setiap side effect harus bisa dilacak.
Setiap duplicate harus aman.
Setiap failure harus meninggalkan evidence.
Setiap retry harus bounded.
Setiap scheduler harus idempotent.
```

---

## 31. Summary

Part ini membahas testing untuk messaging, event flow, outbox, scheduler, dan async processing.

Inti yang harus dibawa:

1. Async test bukan synchronous test yang diberi `sleep`.
2. Tunggu observable condition, bukan waktu tetap.
3. Producer test harus membuktikan payload, routing, key, metadata, dan transaction boundary.
4. Consumer test harus membuktikan valid path, invalid path, duplicate safety, retry, DLQ, dan side-effect atomicity.
5. Outbox pattern perlu diuji sebagai consistency boundary antara DB dan broker.
6. Inbox/dedup perlu diuji sebagai safety boundary consumer.
7. Scheduler harus punya `runOnce`, fake clock, lock/lease, batch limit, dan idempotency test.
8. Broker integration test berguna, tetapi jangan semua test dipaksa memakai broker.
9. Message contract mencakup schema dan semantic meaning.
10. Async system production-safe jika duplicate, retry, crash, stale message, dan partial failure sudah dipikirkan sejak test design.

---

## 32. Referensi

- Awaitility documentation: https://www.awaitility.org/
- Awaitility GitHub: https://github.com/awaitility/awaitility
- Testcontainers: https://testcontainers.com/
- Testcontainers Java Kafka module: https://java.testcontainers.org/modules/kafka/
- Testcontainers RabbitMQ module: https://testcontainers.com/modules/rabbitmq/
- Testcontainers guide for testing Spring Boot Kafka listener: https://testcontainers.com/guides/testing-spring-boot-kafka-listener-using-testcontainers/
- Enterprise Integration Patterns - Messaging Patterns Overview: https://www.enterpriseintegrationpatterns.com/patterns/messaging
- Enterprise Integration Patterns - Idempotent Receiver: https://www.enterpriseintegrationpatterns.com/patterns/messaging/IdempotentReceiver.html
- Enterprise Integration Patterns - Dead Letter Channel: https://www.enterpriseintegrationpatterns.com/patterns/messaging/DeadLetterChannel.html
- Enterprise Integration Patterns - Competing Consumers: https://www.enterpriseintegrationpatterns.com/patterns/messaging/CompetingConsumers.html
- JUnit User Guide: https://docs.junit.org/

---

## 33. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 011 selesai dari total rencana 031 part.
```

Part berikutnya:

```text
Part 012 — Property-Based Testing dan Generative Testing untuk Java
```

# learn-kafka-event-streaming-mastery-for-java-engineers-part-023.md

# Part 023 — Testing Kafka Systems: Unit, Integration, Contract, Replay, Chaos, and Determinism

> Seri: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin naik dari “bisa pakai Kafka” menjadi engineer yang mampu mendesain, membuktikan, menguji, dan mengoperasikan sistem event-driven Kafka secara production-grade.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan testing Kafka pada level **producer**, **consumer**, **stream processing**, **schema contract**, **integration**, **replay**, dan **failure semantics**.
2. Mendesain test yang membuktikan invariant penting, bukan sekadar membuktikan bahwa “message berhasil dikirim”.
3. Menguji consumer Kafka terhadap duplicate delivery, poison pill, manual commit, retry, DLQ, rebalance, dan graceful shutdown.
4. Menguji Kafka Streams topology secara deterministik menggunakan `TopologyTestDriver`.
5. Menguji integrasi nyata menggunakan Testcontainers Kafka.
6. Membuat schema compatibility test agar perubahan event tidak mematahkan consumer downstream.
7. Membuat replay test untuk memastikan sistem aman saat event lama diproses ulang.
8. Memahami batasan embedded Kafka, mock Kafka, Testcontainers, dan real staging cluster.
9. Menyusun strategi CI/CD untuk sistem Kafka yang reliable.
10. Berpikir seperti production engineer: setiap test harus menjawab failure mode tertentu.

---

## 2. Mental Model Utama

Testing Kafka bukan testing transport. Testing Kafka adalah testing **semantics under distributed uncertainty**.

Kafka memperkenalkan beberapa realitas yang tidak selalu muncul dalam aplikasi request-response biasa:

1. Event dapat diproses ulang.
2. Event dapat datang terlambat.
3. Event dapat diproses lebih dari sekali.
4. Consumer dapat crash setelah side effect tetapi sebelum commit offset.
5. Consumer group dapat rebalance di tengah pemrosesan.
6. Producer dapat retry dan menghasilkan duplicate jika konfigurasi buruk.
7. Ordering hanya dijamin dalam partition, bukan di seluruh topic.
8. Schema dapat berubah saat producer dan consumer di-deploy secara independen.
9. DLQ bisa menyelamatkan pipeline, tetapi juga bisa menyembunyikan data loss semantik.
10. State stream processing dapat berubah karena window, grace period, late event, suppression, dan restore.

Karena itu, pertanyaan testing Kafka yang benar bukan:

```text
Apakah consumer menerima message?
```

Pertanyaan yang lebih matang:

```text
Jika event yang sama diproses dua kali, apakah side effect tetap benar?
Jika consumer crash setelah menulis ke database tetapi sebelum commit offset, apakah sistem tetap konsisten?
Jika schema menambah optional field, apakah consumer lama tetap bisa membaca?
Jika event datang out-of-order, apakah projection tetap benar?
Jika topic di-replay dari awal, apakah read model bisa dibangun ulang tanpa korupsi?
Jika poison pill muncul, apakah consumer group berhenti total atau record diarahkan ke DLQ?
Jika deploy rolling menyebabkan rebalance, apakah in-flight processing aman?
```

Kafka testing harus selalu dikaitkan dengan **invariant**.

Invariant adalah properti yang harus selalu benar, apa pun urutan event, retry, crash, rebalance, atau replay yang terjadi.

Contoh invariant:

```text
Satu payment_id hanya boleh menghasilkan satu settlement side effect.
Case status tidak boleh mundur dari CLOSED ke IN_REVIEW kecuali ada ReopenCaseApproved event.
Consumer tidak boleh commit offset sebelum business side effect berhasil.
Setiap event gagal permanen harus tercatat di DLQ dengan original payload dan error metadata.
Projection case harus bisa dibangun ulang dari event stream tanpa manual patch.
```

---

## 3. Testing Pyramid untuk Kafka Systems

Kafka system membutuhkan testing pyramid yang berbeda dari aplikasi CRUD biasa.

```text
                  ┌──────────────────────────────┐
                  │ Chaos / Failure / Load Tests  │
                  └───────────────▲──────────────┘
                                  │
                  ┌───────────────┴──────────────┐
                  │ Replay / Migration Tests      │
                  └───────────────▲──────────────┘
                                  │
                  ┌───────────────┴──────────────┐
                  │ Integration Tests             │
                  │ Kafka + DB + Schema Registry  │
                  └───────────────▲──────────────┘
                                  │
                  ┌───────────────┴──────────────┐
                  │ Contract / Schema Tests        │
                  └───────────────▲──────────────┘
                                  │
                  ┌───────────────┴──────────────┐
                  │ Component Tests               │
                  │ Producer / Consumer / Streams  │
                  └───────────────▲──────────────┘
                                  │
                  ┌───────────────┴──────────────┐
                  │ Pure Unit Tests               │
                  │ Mapping / Validation / Rules   │
                  └──────────────────────────────┘
```

Setiap layer punya tujuan berbeda.

| Layer | Tujuan | Contoh |
|---|---|---|
| Unit test | Validasi fungsi murni | mapping domain event, validation, idempotency key generation |
| Producer component test | Validasi event yang dipublish | topic, key, header, schema, payload |
| Consumer component test | Validasi processing logic | retry, DLQ, manual ack, idempotency |
| Streams topology test | Validasi topology deterministik | join, window, aggregation, late event |
| Schema/contract test | Validasi evolusi event | backward/forward compatibility |
| Integration test | Validasi wiring nyata | Kafka broker + app + DB + Schema Registry |
| Replay test | Validasi reprocess dari history | rebuild projection, migration, backfill |
| Chaos/failure test | Validasi behavior saat rusak | broker restart, rebalance, duplicate, latency |
| Load test | Validasi throughput/latency/lag | batch config, partition scale, consumer concurrency |

Anti-pattern umum:

```text
Punya 100 integration test yang hanya produce satu event dan assert database berubah,
tetapi tidak punya satu pun test untuk duplicate delivery, schema compatibility, replay,
atau crash-before-commit.
```

Itu bukan Kafka testing yang matang.

---

## 4. Apa yang Perlu Dites di Producer

Producer test bertujuan memastikan aplikasi mempublikasikan event yang benar, dengan metadata yang benar, ke boundary yang benar.

Hal yang perlu diuji:

1. Topic yang dipilih benar.
2. Key benar dan stabil.
3. Payload merepresentasikan fakta domain yang benar.
4. Event id unik.
5. Correlation id dan causation id diteruskan.
6. Timestamp benar secara semantik.
7. Schema valid.
8. Header penting tersedia.
9. Producer tidak publish event sebelum transaksi domain berhasil.
10. Jika memakai outbox, row outbox dibuat secara atomik bersama state change.

### 4.1 Producer Test Tidak Harus Selalu Butuh Kafka

Untuk banyak kasus, producer dapat diuji tanpa broker Kafka.

Misalnya service membuat event:

```java
public final class CaseEventFactory {
    public CaseEscalatedEvent create(CaseEntity c, EscalationDecision decision, TraceContext trace) {
        return new CaseEscalatedEvent(
                UUID.randomUUID().toString(),
                c.caseId().value(),
                decision.reasonCode(),
                decision.level(),
                trace.correlationId(),
                trace.causationId(),
                Instant.now()
        );
    }
}
```

Unit test-nya tidak perlu Kafka:

```java
class CaseEventFactoryTest {

    @Test
    void shouldCreateCaseEscalatedEventWithRequiredMetadata() {
        var factory = new CaseEventFactory();
        var caseEntity = new CaseEntity(new CaseId("CASE-123"), CaseStatus.UNDER_REVIEW);
        var decision = new EscalationDecision("SLA_BREACH", EscalationLevel.LEVEL_2);
        var trace = new TraceContext("corr-1", "cmd-9");

        var event = factory.create(caseEntity, decision, trace);

        assertThat(event.caseId()).isEqualTo("CASE-123");
        assertThat(event.reasonCode()).isEqualTo("SLA_BREACH");
        assertThat(event.escalationLevel()).isEqualTo(EscalationLevel.LEVEL_2);
        assertThat(event.correlationId()).isEqualTo("corr-1");
        assertThat(event.causationId()).isEqualTo("cmd-9");
        assertThat(event.eventId()).isNotBlank();
        assertThat(event.occurredAt()).isNotNull();
    }
}
```

Ini menguji event semantics, bukan transport.

### 4.2 Producer Boundary Test

Boundary test memverifikasi bahwa event dikirim ke topic/key/header yang benar.

Dengan Spring Kafka, kamu bisa mock `KafkaTemplate`:

```java
@ExtendWith(MockitoExtension.class)
class CaseEventPublisherTest {

    @Mock
    KafkaTemplate<String, CaseEscalatedEvent> kafkaTemplate;

    @InjectMocks
    CaseEventPublisher publisher;

    @Test
    void shouldPublishCaseEscalatedEventWithCaseIdAsKey() {
        var event = new CaseEscalatedEvent(
                "evt-1",
                "CASE-123",
                "SLA_BREACH",
                EscalationLevel.LEVEL_2,
                "corr-1",
                "cmd-1",
                Instant.parse("2026-06-19T10:00:00Z")
        );

        publisher.publish(event);

        verify(kafkaTemplate).send(
                eq("case.lifecycle.events.v1"),
                eq("CASE-123"),
                eq(event)
        );
    }
}
```

Yang ingin dibuktikan:

```text
key = caseId
```

Karena key menentukan ordering domain. Kalau key salah, event lifecycle case bisa terpecah ke beberapa partition dan urutannya tidak lagi terjamin.

### 4.3 Test untuk Outbox Producer

Jika memakai outbox, test yang lebih penting bukan “Kafka menerima event”, tetapi:

```text
state change dan outbox record ditulis dalam transaksi database yang sama.
```

Contoh invariant:

```text
Ketika case dieskalasi:
- case.status berubah menjadi ESCALATED
- outbox row CaseEscalated dibuat
- keduanya commit atau rollback bersama
```

Pseudo-test:

```java
@Test
void shouldPersistCaseStateAndOutboxEventAtomically() {
    var command = new EscalateCaseCommand("CASE-123", "SLA_BREACH");

    caseService.escalate(command);

    var savedCase = caseRepository.findById("CASE-123").orElseThrow();
    var outboxRows = outboxRepository.findByAggregateId("CASE-123");

    assertThat(savedCase.status()).isEqualTo(CaseStatus.ESCALATED);
    assertThat(outboxRows).hasSize(1);
    assertThat(outboxRows.get(0).eventType()).isEqualTo("CaseEscalated");
    assertThat(outboxRows.get(0).aggregateId()).isEqualTo("CASE-123");
}
```

Dan failure test:

```java
@Test
void shouldRollbackOutboxIfCaseUpdateFails() {
    forceFailureDuringTransaction();

    assertThatThrownBy(() -> caseService.escalate(command))
            .isInstanceOf(RuntimeException.class);

    assertThat(caseRepository.findById("CASE-123").status())
            .isEqualTo(CaseStatus.UNDER_REVIEW);
    assertThat(outboxRepository.findByAggregateId("CASE-123"))
            .isEmpty();
}
```

Ini lebih penting daripada langsung mock Kafka producer.

---

## 5. Apa yang Perlu Dites di Consumer

Consumer test harus membuktikan bahwa record Kafka diproses dengan benar dalam kondisi normal dan gagal.

Hal yang perlu diuji:

1. Valid event menghasilkan side effect yang benar.
2. Event duplicate tidak menggandakan side effect.
3. Event invalid diarahkan ke DLQ atau error path yang benar.
4. Consumer tidak commit/ack sebelum side effect sukses.
5. Retry tidak merusak ordering atau menghasilkan efek ganda.
6. Poison pill tidak menghentikan partition selamanya tanpa visibility.
7. Consumer aman terhadap replay.
8. Consumer aman terhadap out-of-order event sesuai domain policy.
9. Consumer meneruskan correlation id ke log/trace.
10. Consumer behavior jelas untuk unknown schema/event type.

### 5.1 Consumer Business Logic Harus Bisa Diuji Tanpa Kafka

Jangan campurkan terlalu banyak logic ke method listener.

Buruk:

```java
@KafkaListener(topics = "case.lifecycle.events.v1")
public void onMessage(ConsumerRecord<String, String> record) {
    // parse JSON
    // validate
    // call repository
    // mutate state
    // handle duplicate
    // call external API
    // commit
    // log
}
```

Lebih baik:

```java
@KafkaListener(topics = "case.lifecycle.events.v1")
public void onMessage(CaseLifecycleEvent event, Acknowledgment ack) {
    caseEventHandler.handle(event);
    ack.acknowledge();
}
```

Business handler:

```java
public class CaseEventHandler {

    private final ProcessedEventRepository processedEvents;
    private final CaseProjectionRepository projections;

    @Transactional
    public void handle(CaseLifecycleEvent event) {
        if (processedEvents.existsByEventId(event.eventId())) {
            return;
        }

        switch (event) {
            case CaseOpened e -> projections.create(e.caseId(), e.openedAt());
            case CaseEscalated e -> projections.markEscalated(e.caseId(), e.level(), e.occurredAt());
            case CaseClosed e -> projections.markClosed(e.caseId(), e.reason(), e.occurredAt());
        }

        processedEvents.save(new ProcessedEvent(event.eventId(), event.occurredAt()));
    }
}
```

Unit test:

```java
@Test
void shouldIgnoreDuplicateEvent() {
    var event = new CaseEscalatedEvent("evt-1", "CASE-123", EscalationLevel.LEVEL_2);
    processedEvents.save(new ProcessedEvent("evt-1", Instant.now()));

    handler.handle(event);

    verify(projections, never()).markEscalated(any(), any(), any());
}
```

Test ini membuktikan idempotency.

### 5.2 Commit/Ack Test

Jika menggunakan manual acknowledgment, invariant penting:

```text
ack hanya dipanggil setelah side effect berhasil.
```

Test:

```java
@Test
void shouldAckOnlyAfterSuccessfulHandling() {
    var event = validEvent();
    var ack = mock(Acknowledgment.class);

    listener.onMessage(event, ack);

    InOrder inOrder = inOrder(handler, ack);
    inOrder.verify(handler).handle(event);
    inOrder.verify(ack).acknowledge();
}
```

Failure test:

```java
@Test
void shouldNotAckIfHandlerFails() {
    var event = validEvent();
    var ack = mock(Acknowledgment.class);

    doThrow(new RuntimeException("db down"))
            .when(handler).handle(event);

    assertThatThrownBy(() -> listener.onMessage(event, ack))
            .isInstanceOf(RuntimeException.class);

    verify(ack, never()).acknowledge();
}
```

Ini lebih bernilai daripada test yang hanya memastikan listener method terpanggil.

---

## 6. Schema and Contract Testing

Di Kafka, producer dan consumer biasanya di-deploy independen. Karena itu, schema adalah kontrak antar tim.

Schema test menjawab:

```text
Apakah schema baru masih bisa dibaca oleh consumer lama?
Apakah producer baru masih memproduksi event yang kompatibel?
Apakah perubahan field enum akan merusak downstream?
Apakah field baru punya default value?
Apakah field yang dihapus masih dibutuhkan consumer?
```

### 6.1 Compatibility Test

Misalnya Avro schema v1:

```json
{
  "type": "record",
  "name": "CaseEscalated",
  "namespace": "com.example.caseevents",
  "fields": [
    { "name": "eventId", "type": "string" },
    { "name": "caseId", "type": "string" },
    { "name": "level", "type": "string" },
    { "name": "occurredAt", "type": "string" }
  ]
}
```

Schema v2 menambah field optional:

```json
{
  "type": "record",
  "name": "CaseEscalated",
  "namespace": "com.example.caseevents",
  "fields": [
    { "name": "eventId", "type": "string" },
    { "name": "caseId", "type": "string" },
    { "name": "level", "type": "string" },
    { "name": "occurredAt", "type": "string" },
    { "name": "reasonCode", "type": ["null", "string"], "default": null }
  ]
}
```

Ini biasanya compatible untuk backward mode karena field baru punya default.

Schema v3 yang buruk:

```json
{
  "name": "case_id",
  "type": "string"
}
```

Mengganti `caseId` menjadi `case_id` tanpa alias/default adalah breaking change.

### 6.2 Contract Test sebagai CI Gate

Contract test harus berjalan sebelum schema dipublish.

Pipeline ideal:

```text
1. Developer mengubah schema.
2. CI menjalankan compatibility check terhadap schema registry subject.
3. Jika incompatible, build gagal.
4. Jika compatible, schema bisa dipublish/deploy.
```

Pseudo-test:

```java
@Test
void newSchemaShouldBeBackwardCompatibleWithLatestRegisteredSchema() {
    var latestSchema = schemaRegistryClient.getLatestSchemaMetadata("case.lifecycle.events.v1-value");
    var newSchema = loadSchema("schemas/CaseEscalated.avsc");

    var result = avroCompatibilityChecker.isBackwardCompatible(newSchema, latestSchema);

    assertThat(result.isCompatible()).isTrue();
}
```

Untuk production maturity, contract test tidak boleh hanya ada di producer. Consumer juga perlu golden sample test.

### 6.3 Golden Event Fixtures

Golden fixture adalah sample event historis yang dianggap valid dan harus tetap bisa diproses.

Struktur:

```text
src/test/resources/events/case-opened-v1.json
src/test/resources/events/case-escalated-v1.json
src/test/resources/events/case-escalated-v2.json
src/test/resources/events/case-closed-v1.json
```

Consumer test:

```java
@ParameterizedTest
@ValueSource(strings = {
    "events/case-opened-v1.json",
    "events/case-escalated-v1.json",
    "events/case-escalated-v2.json",
    "events/case-closed-v1.json"
})
void shouldProcessHistoricalEventFixtures(String fixture) {
    var event = loadEvent(fixture);

    assertThatCode(() -> handler.handle(event))
            .doesNotThrowAnyException();
}
```

Ini melindungi consumer dari perubahan event yang tidak sengaja memutus kompatibilitas historis.

---

## 7. Integration Testing dengan Testcontainers

Unit test tidak membuktikan wiring Kafka nyata. Untuk itu gunakan Testcontainers.

Integration test cocok untuk membuktikan:

1. Producer benar-benar bisa serialize event.
2. Consumer benar-benar bisa deserialize event.
3. Listener container wiring benar.
4. Topic/config test environment benar.
5. Manual ack dan retry behavior bekerja.
6. App bisa connect ke Kafka bootstrap server.
7. Schema Registry integration bekerja jika digunakan.
8. Database + Kafka + app transaction boundary bekerja.

### 7.1 Minimal Testcontainers Kafka Setup

Contoh dengan JUnit 5 dan Spring Boot:

```java
@Testcontainers
@SpringBootTest
class CaseKafkaIntegrationTest {

    @Container
    static KafkaContainer kafka = new KafkaContainer(
            DockerImageName.parse("apache/kafka-native:3.8.0")
    );

    @DynamicPropertySource
    static void kafkaProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
    }

    @Autowired
    KafkaTemplate<String, CaseEscalatedEvent> kafkaTemplate;

    @Autowired
    CaseProjectionRepository projectionRepository;

    @Test
    void shouldConsumeCaseEscalatedEventAndUpdateProjection() {
        var event = new CaseEscalatedEvent(
                "evt-1",
                "CASE-123",
                EscalationLevel.LEVEL_2,
                Instant.parse("2026-06-19T10:00:00Z")
        );

        kafkaTemplate.send("case.lifecycle.events.v1", "CASE-123", event);

        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
            var projection = projectionRepository.findByCaseId("CASE-123").orElseThrow();
            assertThat(projection.status()).isEqualTo("ESCALATED");
            assertThat(projection.escalationLevel()).isEqualTo("LEVEL_2");
        });
    }
}
```

Catatan penting:

1. Jangan pakai `Thread.sleep()` untuk menunggu event.
2. Gunakan Awaitility atau polling assertion.
3. Pastikan topic test unik atau state dibersihkan antar test.
4. Jangan membuat test bergantung pada urutan antar test.
5. Jangan menguji terlalu banyak skenario dalam satu integration test.

### 7.2 Topic Isolation untuk Test

Buruk:

```text
Semua test memakai topic case.lifecycle.events.v1 yang sama.
```

Masalah:

1. Test saling mengganggu.
2. Event lama bisa terbaca test baru.
3. Consumer group offset bisa tersisa.
4. Flaky test.

Lebih aman:

```java
String topic = "case.lifecycle.events.test." + UUID.randomUUID();
String groupId = "case-projection-test-" + UUID.randomUUID();
```

Atau gunakan topic tetap tetapi group id unik per test class.

### 7.3 Integration Test Tidak Boleh Menjadi Satu-Satunya Test

Integration test mahal dan lebih lambat. Gunakan untuk wiring penting, bukan untuk semua kombinasi business rule.

Rule of thumb:

```text
Business logic matrix → unit/component tests.
Kafka wiring correctness → integration tests.
Failure semantics → targeted integration/failure tests.
```

---

## 8. Embedded Kafka vs Testcontainers vs Real Cluster

| Approach | Kelebihan | Kekurangan | Cocok untuk |
|---|---|---|---|
| Mock producer/consumer | Cepat, deterministik | Tidak menguji broker/serialization nyata | unit/boundary test |
| Embedded Kafka | Cepat untuk Spring tests | Bisa berbeda dari production runtime | local Spring Kafka tests |
| Testcontainers Kafka | Mirip runtime nyata, reproducible | Lebih lambat, butuh Docker | integration tests |
| Shared dev Kafka | Real infra | Test contamination, flakiness | manual/dev testing |
| Staging Kafka | Mirip production | Mahal, perlu governance | pre-prod, load, failure test |

Tidak ada satu tool yang cocok untuk semua test.

Gunakan kombinasi.

---

## 9. Kafka Streams Testing dengan TopologyTestDriver

Kafka Streams punya tool testing yang sangat penting: `TopologyTestDriver`.

Ia memungkinkan kamu menguji topology tanpa broker Kafka nyata.

Cocok untuk:

1. Stateless transformation.
2. Aggregation.
3. Join.
4. Windowing.
5. Timestamp behavior.
6. Late event behavior.
7. Output topic assertion.
8. State store assertion.

### 9.1 Contoh Topology

Misalnya topology untuk menghitung escalation per officer:

```java
public Topology buildTopology() {
    StreamsBuilder builder = new StreamsBuilder();

    KStream<String, CaseEscalatedEvent> escalations = builder.stream(
            "case.escalated.v1",
            Consumed.with(Serdes.String(), caseEscalatedSerde)
    );

    escalations
            .groupBy((caseId, event) -> event.officerId(),
                    Grouped.with(Serdes.String(), caseEscalatedSerde))
            .count(Materialized.as("officer-escalation-count-store"))
            .toStream()
            .to("officer.escalation.counts.v1", Produced.with(Serdes.String(), Serdes.Long()));

    return builder.build();
}
```

Test:

```java
class OfficerEscalationTopologyTest {

    private TopologyTestDriver testDriver;
    private TestInputTopic<String, CaseEscalatedEvent> input;
    private TestOutputTopic<String, Long> output;

    @BeforeEach
    void setUp() {
        Properties props = new Properties();
        props.put(StreamsConfig.APPLICATION_ID_CONFIG, "officer-escalation-test");
        props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "dummy:9092");

        testDriver = new TopologyTestDriver(new OfficerTopology().buildTopology(), props);

        input = testDriver.createInputTopic(
                "case.escalated.v1",
                new StringSerializer(),
                caseEscalatedSerializer
        );

        output = testDriver.createOutputTopic(
                "officer.escalation.counts.v1",
                new StringDeserializer(),
                new LongDeserializer()
        );
    }

    @AfterEach
    void tearDown() {
        testDriver.close();
    }

    @Test
    void shouldCountEscalationsByOfficer() {
        input.pipeInput("CASE-1", event("CASE-1", "OFFICER-7"));
        input.pipeInput("CASE-2", event("CASE-2", "OFFICER-7"));

        assertThat(output.readKeyValue()).isEqualTo(new KeyValue<>("OFFICER-7", 1L));
        assertThat(output.readKeyValue()).isEqualTo(new KeyValue<>("OFFICER-7", 2L));
    }
}
```

### 9.2 Testing Windowing

Window test harus mengontrol timestamp.

Contoh:

```java
@Test
void shouldAggregateWithinTumblingWindow() {
    Instant t0 = Instant.parse("2026-06-19T10:00:00Z");

    input.pipeInput("CASE-1", event("CASE-1", "OFFICER-7"), t0);
    input.pipeInput("CASE-2", event("CASE-2", "OFFICER-7"), t0.plusSeconds(30));
    input.pipeInput("CASE-3", event("CASE-3", "OFFICER-7"), t0.plusSeconds(90));

    // Assert output according to window definition.
}
```

Jangan membiarkan waktu sistem real menentukan hasil test window.

### 9.3 Testing State Store

Jika topology menulis state store:

```java
@Test
void shouldMaterializeLatestCaseStatus() {
    input.pipeInput("CASE-123", opened("CASE-123"));
    input.pipeInput("CASE-123", escalated("CASE-123"));

    KeyValueStore<String, CaseStatusView> store = testDriver.getKeyValueStore("case-status-store");

    assertThat(store.get("CASE-123").status()).isEqualTo("ESCALATED");
}
```

Ini membuktikan materialized state, bukan hanya output topic.

---

## 10. Replay Testing

Replay adalah kemampuan utama Kafka, tetapi tidak otomatis aman.

Replay test menjawab:

```text
Jika seluruh topic diproses ulang dari offset 0, apakah hasil akhir tetap benar?
```

Replay penting untuk:

1. Rebuild projection.
2. Backfill data.
3. Migrasi read model.
4. Recovery dari bug consumer.
5. Audit reconstruction.
6. New downstream onboarding.
7. Correcting derived state.

### 10.1 Replay-Safe Consumer

Consumer replay-safe biasanya memiliki karakteristik:

1. Idempotent side effect.
2. Deterministic transformation.
3. Tidak bergantung pada current wall-clock time secara sembarangan.
4. Tidak memanggil external API irreversible saat replay.
5. Bisa membedakan live processing dan replay/backfill jika diperlukan.
6. Menyimpan processed event id atau menggunakan natural idempotency.
7. Menggunakan event timestamp, bukan processing timestamp, untuk state historis.

### 10.2 Replay Test untuk Projection

Contoh event history:

```text
1. CaseOpened(caseId=CASE-123)
2. EvidenceSubmitted(caseId=CASE-123)
3. CaseEscalated(caseId=CASE-123, level=LEVEL_2)
4. CaseClosed(caseId=CASE-123)
```

Replay test:

```java
@Test
void shouldRebuildCaseProjectionFromEventHistory() {
    var events = List.of(
            opened("CASE-123", "2026-06-01T10:00:00Z"),
            evidenceSubmitted("CASE-123", "EVID-9", "2026-06-02T10:00:00Z"),
            escalated("CASE-123", EscalationLevel.LEVEL_2, "2026-06-03T10:00:00Z"),
            closed("CASE-123", "RESOLVED", "2026-06-04T10:00:00Z")
    );

    var projection = new CaseProjection();

    for (var event : events) {
        projection.apply(event);
    }

    assertThat(projection.caseId()).isEqualTo("CASE-123");
    assertThat(projection.status()).isEqualTo(CaseStatus.CLOSED);
    assertThat(projection.escalationLevel()).isEqualTo(EscalationLevel.LEVEL_2);
    assertThat(projection.evidenceCount()).isEqualTo(1);
}
```

### 10.3 Replay with Duplicate Events

Replay test harus memasukkan duplicate.

```java
@Test
void replayShouldBeIdempotentWhenDuplicateEventAppears() {
    var event = evidenceSubmitted("CASE-123", "EVID-9", "2026-06-02T10:00:00Z");

    projection.apply(opened("CASE-123"));
    projection.apply(event);
    projection.apply(event);

    assertThat(projection.evidenceCount()).isEqualTo(1);
}
```

Jika hasilnya 2, consumer tidak replay-safe.

### 10.4 Replay with Out-of-Order Events

Out-of-order test harus sesuai policy domain.

Misalnya policy:

```text
CaseClosed hanya valid jika CaseOpened sudah pernah ada.
Jika CaseClosed datang sebelum CaseOpened, simpan sebagai pending event atau kirim ke DLQ.
```

Test:

```java
@Test
void shouldRejectCloseEventIfCaseWasNeverOpened() {
    var close = closed("CASE-404", "RESOLVED", "2026-06-04T10:00:00Z");

    assertThatThrownBy(() -> projection.apply(close))
            .isInstanceOf(InvalidEventOrderException.class);
}
```

Atau jika policy-nya pending buffer:

```java
@Test
void shouldBufferCloseEventUntilOpenEventArrives() {
    handler.handle(closed("CASE-123"));
    handler.handle(opened("CASE-123"));

    assertThat(projectionRepository.findByCaseId("CASE-123").status())
            .isEqualTo(CaseStatus.CLOSED);
}
```

Yang penting bukan policy mana yang dipilih, tetapi policy itu eksplisit dan diuji.

---

## 11. Duplicate Delivery Testing

Kafka consumer biasanya harus diasumsikan at-least-once.

Maka duplicate test wajib.

### 11.1 Duplicate Event Same Event ID

```java
@Test
void shouldNotApplySameEventIdTwice() {
    var event = new PaymentCapturedEvent(
            "evt-1",
            "PAY-123",
            new BigDecimal("100.00")
    );

    handler.handle(event);
    handler.handle(event);

    var payment = paymentRepository.findById("PAY-123").orElseThrow();
    assertThat(payment.capturedAmount()).isEqualByComparingTo("100.00");

    assertThat(sideEffectRepository.countByEventId("evt-1")).isEqualTo(1);
}
```

### 11.2 Duplicate Business Event Different Event ID

Kadang duplicate punya event id berbeda tetapi business id sama.

Contoh:

```text
PaymentCaptured(eventId=evt-1, paymentId=PAY-123)
PaymentCaptured(eventId=evt-2, paymentId=PAY-123)
```

Jika domain menganggap `paymentId` unik untuk capture, idempotency key harus `paymentId`, bukan `eventId`.

Test:

```java
@Test
void shouldDeduplicateByPaymentIdForCaptureSideEffect() {
    handler.handle(captured("evt-1", "PAY-123"));
    handler.handle(captured("evt-2", "PAY-123"));

    assertThat(settlementRepository.countByPaymentId("PAY-123")).isEqualTo(1);
}
```

Pelajaran:

```text
Deduplication key harus mengikuti side effect semantics, bukan selalu eventId.
```

---

## 12. Poison Pill Testing

Poison pill adalah record yang selalu gagal diproses.

Penyebab:

1. Payload corrupt.
2. Schema incompatible.
3. Field required hilang.
4. Business invariant invalid.
5. Unknown enum.
6. Event type tidak dikenal.
7. Data menyebabkan bug deterministik.

Tanpa handling, poison pill dapat membuat consumer stuck di offset yang sama.

### 12.1 Test Deserialization Failure

Jika deserializer gagal sebelum listener dipanggil, error handling harus berada di container/deserializer level.

Dengan Spring Kafka biasanya gunakan error handling deserializer dan DLT strategy.

Test yang diharapkan:

```text
Given invalid payload
When consumer attempts to deserialize
Then record is sent to DLT with original topic/partition/offset metadata
And main consumer continues processing next valid record
```

### 12.2 Test Business Poison Pill

```java
@Test
void shouldSendInvalidBusinessEventToDlq() {
    var invalid = new CaseEscalatedEvent(
            "evt-1",
            "CASE-123",
            null, // invalid escalation level
            Instant.now()
    );

    listener.onMessage(invalid, acknowledgment);

    verify(dlqPublisher).publish(eq(invalid), any(ValidationException.class));
    verify(acknowledgment).acknowledge();
}
```

Ack after DLQ is often correct because the record has been handled by failure path. But this depends on policy.

If DLQ publish fails, offset should usually not be acknowledged:

```java
@Test
void shouldNotAckIfDlqPublishFails() {
    doThrow(new RuntimeException("DLQ unavailable"))
            .when(dlqPublisher).publish(any(), any());

    assertThatThrownBy(() -> listener.onMessage(invalidEvent(), ack))
            .isInstanceOf(RuntimeException.class);

    verify(ack, never()).acknowledge();
}
```

---

## 13. Retry Testing

Retry harus dibagi dua:

1. Transient failure.
2. Permanent failure.

Transient failure:

```text
Database temporarily unavailable.
HTTP downstream timeout.
Lock conflict.
```

Permanent failure:

```text
Invalid schema.
Unknown case id where policy says impossible.
Invalid enum.
Missing required business field.
```

### 13.1 Retry Should Eventually Succeed

```java
@Test
void shouldRetryTransientFailureAndEventuallySucceed() {
    doThrow(new TransientDatabaseException("deadlock"))
            .doNothing()
            .when(handler).handle(event);

    retryingListener.onMessage(event, ack);

    verify(handler, times(2)).handle(event);
    verify(ack).acknowledge();
}
```

### 13.2 Retry Should Not Hide Permanent Failure

```java
@Test
void shouldSendPermanentFailureToDlqWithoutExcessiveRetry() {
    doThrow(new InvalidEventException("missing caseId"))
            .when(handler).handle(invalidEvent);

    retryingListener.onMessage(invalidEvent, ack);

    verify(handler, times(1)).handle(invalidEvent);
    verify(dlqPublisher).publish(eq(invalidEvent), any(InvalidEventException.class));
    verify(ack).acknowledge();
}
```

Retrying permanent errors wastes resources and increases lag.

---

## 14. Rebalance Testing

Rebalance testing sulit, tetapi penting.

Failure scenario:

```text
Consumer A sedang memproses record offset 100.
Sebelum commit, consumer A terkena max.poll.interval atau shutdown.
Partition dipindahkan ke consumer B.
Consumer B memproses ulang offset 100.
```

Invariant:

```text
Processing offset 100 dua kali tidak boleh menggandakan side effect.
```

### 14.1 Component-Level Rebalance Simulation

Kamu tidak selalu perlu memicu rebalance nyata. Kamu bisa simulasikan duplicate processing.

```java
@Test
void shouldBeSafeWhenRecordIsProcessedAgainAfterRebalance() {
    var event = settlementRequested("evt-1", "CASE-123");

    handler.handle(event);
    handler.handle(event); // simulate partition reassignment before commit

    assertThat(settlementRepository.countByCaseId("CASE-123")).isEqualTo(1);
}
```

### 14.2 Integration-Level Rebalance Test

Untuk test lebih nyata:

1. Start consumer group dengan satu consumer.
2. Produce records.
3. Block processing record tertentu.
4. Start consumer kedua atau stop consumer pertama.
5. Assert duplicate-safe behavior.

Pseudo-flow:

```text
Given consumer A owns partition 0
And A starts processing event evt-1 but blocks before ack
When consumer B joins group
And A exceeds poll interval / stops
Then partition 0 is reassigned
And evt-1 may be processed again
And business side effect remains exactly once by idempotency
```

Test seperti ini cenderung lebih lambat dan flaky jika tidak hati-hati. Simpan di suite failure/integration, bukan unit test biasa.

---

## 15. Time and Determinism

Kafka systems sering gagal diuji karena waktu tidak dikontrol.

Sumber waktu:

1. Event time.
2. Ingestion time.
3. Processing time.
4. Wall-clock time.
5. Test execution time.

Rule:

```text
Business logic sebaiknya menerima Clock atau timestamp eksplisit, bukan langsung memanggil Instant.now() di mana-mana.
```

Buruk:

```java
public void handle(Event event) {
    projection.setLastUpdatedAt(Instant.now());
}
```

Lebih testable:

```java
public void handle(Event event) {
    projection.setLastEventAt(event.occurredAt());
}
```

Atau:

```java
public class Handler {
    private final Clock clock;

    public void handle(Event event) {
        projection.setProcessedAt(Instant.now(clock));
    }
}
```

Test:

```java
@Test
void shouldUseFixedClockForProcessedAt() {
    var clock = Clock.fixed(
            Instant.parse("2026-06-19T10:00:00Z"),
            ZoneOffset.UTC
    );

    var handler = new Handler(clock);
    handler.handle(event);

    assertThat(projection.processedAt())
            .isEqualTo(Instant.parse("2026-06-19T10:00:00Z"));
}
```

Deterministic tests require controlled time.

---

## 16. Testing Ordering Semantics

Ordering in Kafka hanya dijamin dalam partition.

Test harus membuktikan key yang dipakai benar untuk ordering domain.

### 16.1 Producer Key Test

```java
@Test
void allCaseLifecycleEventsShouldUseCaseIdAsKafkaKey() {
    assertThat(keySelector.keyFor(opened("CASE-123"))).isEqualTo("CASE-123");
    assertThat(keySelector.keyFor(escalated("CASE-123"))).isEqualTo("CASE-123");
    assertThat(keySelector.keyFor(closed("CASE-123"))).isEqualTo("CASE-123");
}
```

Jika `CaseOpened` memakai applicantId sedangkan `CaseClosed` memakai caseId, ordering lifecycle bisa rusak.

### 16.2 Out-of-Order Consumer Test

Meskipun key benar, out-of-order bisa terjadi karena replay, manual produce, bug upstream, atau multi-topic join.

```java
@Test
void shouldNotMoveClosedCaseBackToUnderReview() {
    projection.apply(closed("CASE-123", "2026-06-04T10:00:00Z"));
    projection.apply(underReview("CASE-123", "2026-06-03T10:00:00Z"));

    assertThat(projection.status()).isEqualTo(CaseStatus.CLOSED);
}
```

Domain state machine invariant harus menang atas urutan event yang buruk.

---

## 17. Testing DLQ Quality

DLQ bukan tempat membuang sampah diam-diam. DLQ adalah operational recovery interface.

DLQ record harus membawa informasi cukup:

1. Original topic.
2. Original partition.
3. Original offset.
4. Original key.
5. Original timestamp.
6. Consumer group/application name.
7. Error class.
8. Error message.
9. Stack trace atau summarized cause.
10. Failure timestamp.
11. Correlation id.
12. Event id jika bisa dibaca.
13. Payload original atau payload safe representation.

Test:

```java
@Test
void dlqRecordShouldContainOperationalMetadata() {
    var record = new ConsumerRecord<>(
            "case.lifecycle.events.v1",
            2,
            991L,
            "CASE-123",
            invalidPayload
    );

    dlqPublisher.publish(record, new InvalidEventException("missing field level"));

    var dlq = dlqRepository.lastPublished();

    assertThat(dlq.headers().get("original-topic")).isEqualTo("case.lifecycle.events.v1");
    assertThat(dlq.headers().get("original-partition")).isEqualTo("2");
    assertThat(dlq.headers().get("original-offset")).isEqualTo("991");
    assertThat(dlq.headers().get("error-class")).isEqualTo("InvalidEventException");
    assertThat(dlq.key()).isEqualTo("CASE-123");
}
```

Without metadata, DLQ is barely useful.

---

## 18. Contract Testing Antar Tim

Dalam organisasi besar, producer dan consumer biasanya dimiliki tim berbeda.

Masalah umum:

```text
Producer menganggap field optional.
Consumer menganggap field mandatory.
Producer mengubah enum.
Consumer tidak siap.
Producer mengganti semantics field tanpa mengganti nama/version.
Consumer tetap compile tetapi hasil bisnis salah.
```

Contract testing harus mencakup:

1. Schema compatibility.
2. Semantic compatibility.
3. Required business fields.
4. Enum policy.
5. Header policy.
6. Key policy.
7. Example payload.
8. Consumer expectation.

### 18.1 Consumer-Driven Contract

Consumer dapat mendefinisikan ekspektasi:

```yaml
consumer: case-projection-service
subject: case.lifecycle.events.v1-value
expects:
  eventTypes:
    - CaseOpened
    - CaseEscalated
    - CaseClosed
  requiredFields:
    CaseEscalated:
      - eventId
      - caseId
      - level
      - occurredAt
  key:
    expression: caseId
  headers:
    required:
      - correlation-id
      - event-type
```

Producer CI memvalidasi event output terhadap contract ini.

### 18.2 Semantic Contract Test

Schema compatible belum tentu semantic compatible.

Contoh breaking semantic change:

```text
Field `amount` tetap decimal, tetapi producer mengubah satuan dari dollars ke cents.
Schema tidak berubah, consumer rusak secara bisnis.
```

Test harus punya examples:

```java
@Test
void caseEscalatedLevelShouldUseBusinessLevelNotNumericPriority() {
    var event = producerFixture.caseEscalated();

    assertThat(event.level()).isIn("LEVEL_1", "LEVEL_2", "LEVEL_3");
    assertThat(event.level()).isNotEqualTo("P1");
}
```

---

## 19. Testing Kafka Connect Pipelines

Kafka Connect testing berbeda dari custom app.

Yang perlu diuji:

1. Connector config valid.
2. Source connector menghasilkan topic/key/value sesuai ekspektasi.
3. Sink connector menulis ke destination sesuai mapping.
4. SMT bekerja benar.
5. Error handling dan DLQ benar.
6. Offset behavior aman.
7. Restart connector tidak menggandakan data secara fatal.

### 19.1 Connector Config Test

Treat connector config sebagai code.

```json
{
  "name": "case-jdbc-source",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "${file:/secrets/db.properties:url}",
    "mode": "timestamp+incrementing",
    "timestamp.column.name": "updated_at",
    "incrementing.column.name": "id",
    "topic.prefix": "db.case.",
    "poll.interval.ms": "5000"
  }
}
```

Test config statically:

```java
@Test
void jdbcSourceShouldNotUseBulkModeForOperationalTables() {
    var config = loadConnectorConfig("case-jdbc-source.json");

    assertThat(config.get("mode")).isNotEqualTo("bulk");
    assertThat(config).containsKeys("timestamp.column.name", "incrementing.column.name");
}
```

### 19.2 SMT Test

Jika SMT digunakan untuk mengubah envelope, test sample input/output.

```text
Input Debezium envelope → ExtractNewRecordState SMT → flattened record
```

Assert:

1. Field penting tidak hilang.
2. Delete/tombstone behavior sesuai policy.
3. Key tetap stabil.
4. Metadata source jika dibutuhkan tetap tersedia.

---

## 20. Load and Performance Testing

Load test Kafka harus menjawab pertanyaan spesifik.

Bukan:

```text
Berapa throughput Kafka?
```

Melainkan:

```text
Dengan payload 2 KB, replication factor 3, acks=all, compression=zstd,
12 partitions, 6 consumer instances, dan p99 end-to-end latency target 2 detik,
apakah sistem mampu memproses 5.000 events/sec selama 2 jam tanpa lag explosion?
```

Metrik load test:

1. Producer throughput.
2. Producer p95/p99 latency.
3. Broker request latency.
4. Consumer throughput.
5. Consumer lag offset.
6. Consumer lag time.
7. End-to-end latency.
8. Error rate.
9. Retry rate.
10. Rebalance count.
11. Under-replicated partitions.
12. Disk usage growth.
13. CPU/network/disk saturation.
14. GC pause.
15. DLQ rate.

### 20.1 Load Test Data Must Be Realistic

Synthetic event terlalu kecil bisa menipu.

Test data harus realistis:

1. Payload size distribution.
2. Key cardinality.
3. Hot key distribution.
4. Event type distribution.
5. Burst behavior.
6. Invalid event rate.
7. Downstream database latency.
8. External API failure rate.

Jika production punya hot tenant, load test harus memasukkan hot tenant.

### 20.2 Load Test Anti-Pattern

Buruk:

```text
Produce 1 juta message dengan null key, payload 20 byte, no consumer side effect.
Kesimpulan: sistem siap production.
```

Itu hanya menguji sebagian kecil dari sistem.

---

## 21. Chaos and Failure Testing

Chaos testing Kafka tidak harus ekstrem. Mulai dari failure yang realistis.

Skenario penting:

1. Kill consumer process.
2. Restart broker.
3. Pause database.
4. Inject latency ke sink.
5. Produce duplicate event.
6. Produce invalid event.
7. Stop Schema Registry.
8. Fill DLQ.
9. Trigger rebalance during processing.
10. Reduce consumer instances.
11. Increase event rate suddenly.
12. Simulate disk pressure.

### 21.1 Consumer Crash Scenario

Test objective:

```text
Jika consumer crash setelah side effect tetapi sebelum offset commit,
record akan diproses ulang dan side effect tetap idempotent.
```

Cara sederhana:

1. Process event once.
2. Do not mark offset committed in simulation.
3. Process same event again.
4. Assert side effect count remains one.

### 21.2 Broker Restart Scenario

Test objective:

```text
Producer/consumer recover after temporary broker unavailability.
```

Dengan Testcontainers, kamu bisa stop/start container di suite khusus, tetapi hati-hati terhadap flakiness.

### 21.3 Schema Registry Unavailable

Jika producer membutuhkan Schema Registry saat schema belum cached:

```text
Produce may fail.
```

Test behavior:

1. Apakah service fail fast?
2. Apakah retry bounded?
3. Apakah alert muncul?
4. Apakah event disimpan di outbox untuk retry nanti?

---

## 22. Testing Idempotency Store

Idempotency sering bergantung pada database uniqueness.

Contoh table:

```sql
CREATE TABLE processed_event (
    event_id VARCHAR(100) PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL
);
```

Consumer transaction:

```java
@Transactional
public void handle(Event event) {
    try {
        processedEventRepository.insert(event.eventId());
    } catch (DuplicateKeyException duplicate) {
        return;
    }

    applyBusinessSideEffect(event);
}
```

Test concurrency:

```java
@Test
void concurrentDuplicateProcessingShouldApplySideEffectOnce() throws Exception {
    var event = event("evt-1", "CASE-123");

    var executor = Executors.newFixedThreadPool(2);
    var futures = List.of(
            executor.submit(() -> handler.handle(event)),
            executor.submit(() -> handler.handle(event))
    );

    for (var f : futures) {
        f.get(5, TimeUnit.SECONDS);
    }

    assertThat(sideEffectRepository.countByEventId("evt-1")).isEqualTo(1);
}
```

Kalau test ini gagal, idempotency implementation belum aman terhadap race.

---

## 23. Testing Transaction Boundary

Consumer dengan database side effect harus jelas transaction boundary-nya.

Common pattern:

```text
1. Consume Kafka record.
2. Begin DB transaction.
3. Insert processed_event.
4. Apply business mutation.
5. Commit DB transaction.
6. Ack/commit Kafka offset.
```

Invariant:

```text
Kafka offset commit tidak boleh terjadi sebelum DB commit berhasil.
```

Test failure DB commit:

```java
@Test
void shouldNotAckWhenDatabaseCommitFails() {
    doThrow(new CannotCommitTransactionException("commit failed"))
            .when(handler).handle(event);

    assertThatThrownBy(() -> listener.onMessage(event, ack))
            .isInstanceOf(CannotCommitTransactionException.class);

    verify(ack, never()).acknowledge();
}
```

Kafka offset dan DB transaction tidak otomatis atomic kecuali memakai desain khusus. Test harus membuktikan failure behavior yang kamu terima.

---

## 24. Testing Consumer Lag Behavior

Lag bukan hanya metric operasional. Beberapa behavior aplikasi harus diuji terhadap backlog.

Pertanyaan:

1. Jika backlog besar, apakah consumer memproses batch terlalu besar?
2. Apakah memory naik tak terkendali?
3. Apakah retry memperparah lag?
4. Apakah poison pill memblokir partition?
5. Apakah downstream DB bottleneck membuat consumer timeout?

Component test untuk batch size:

```java
@Test
void shouldProcessBatchWithoutLoadingUnboundedData() {
    var records = generateRecords(500);

    batchListener.onMessage(records, ack);

    verify(handler, times(500)).handle(any());
    verify(ack).acknowledge();
}
```

Load/integration test untuk lag:

```text
Produce 100k events.
Throttle DB writes.
Measure whether consumer lag eventually drains after throttle removed.
```

---

## 25. Testing Observability

Observability juga perlu diuji.

Hal yang perlu diuji:

1. Error log membawa event id/correlation id.
2. Metrics bertambah saat success/failure.
3. DLQ publish menghasilkan metric.
4. Retry count tercatat.
5. Processing latency tercatat.
6. Trace context diteruskan.

Contoh metric test:

```java
@Test
void shouldIncrementFailureMetricWhenProcessingFails() {
    doThrow(new InvalidEventException("invalid"))
            .when(handler).handle(event);

    listener.onMessage(event, ack);

    assertThat(meterRegistry.counter("case.consumer.failures", "reason", "invalid_event").count())
            .isEqualTo(1.0);
}
```

Logging test dapat menggunakan appender test atau structured log assertion.

---

## 26. CI/CD Strategy untuk Kafka Tests

Tidak semua test harus berjalan pada setiap commit dengan intensitas sama.

Rekomendasi:

```text
Every commit:
- unit tests
- component tests
- schema compatibility tests
- Kafka Streams topology tests

Pull request:
- Testcontainers integration tests
- Spring Kafka listener tests
- critical replay tests

Nightly:
- longer replay tests
- load smoke tests
- connector integration tests
- chaos/failure tests

Pre-release:
- staging end-to-end tests
- migration tests
- backward compatibility tests
- operational runbook validation
```

### 26.1 Test Suite Naming

Contoh struktur Maven/Gradle:

```text
src/test/java
  unit
  component
  contract
  streams
  integration
  replay
  failure
```

Atau tags:

```java
@Tag("unit")
@Tag("integration")
@Tag("replay")
@Tag("failure")
```

CI bisa menjalankan subset:

```bash
./gradlew test -PincludeTags=unit,component,contract
./gradlew integrationTest
./gradlew replayTest
```

---

## 27. Test Data Strategy

Kafka test data harus dikelola seperti contract artifact.

Gunakan:

1. Golden fixtures.
2. Event builders.
3. Randomized but bounded test data.
4. Invalid event catalog.
5. Historical event snapshots.
6. Schema version samples.
7. Replay scenario files.

### 27.1 Event Builder

```java
public final class CaseEvents {

    public static CaseOpenedEvent opened(String caseId) {
        return new CaseOpenedEvent(
                "evt-open-" + caseId,
                caseId,
                Instant.parse("2026-06-19T10:00:00Z")
        );
    }

    public static CaseEscalatedEvent escalated(String caseId) {
        return new CaseEscalatedEvent(
                "evt-esc-" + caseId,
                caseId,
                EscalationLevel.LEVEL_2,
                Instant.parse("2026-06-19T10:05:00Z")
        );
    }
}
```

Builder membuat test lebih readable.

### 27.2 Invalid Event Catalog

Simpan sample invalid:

```text
invalid/missing-case-id.json
invalid/unknown-event-type.json
invalid/unknown-enum.json
invalid/malformed-json.json
invalid/breaking-schema-v3.json
```

Gunakan dalam poison pill dan DLQ tests.

---

## 28. Anti-Patterns dalam Kafka Testing

### 28.1 Test Hanya Membuktikan Happy Path

```text
produce event → consumer updates DB
```

Ini perlu, tapi tidak cukup.

Tambahkan:

1. Duplicate event.
2. Invalid event.
3. Retry.
4. DLQ.
5. Replay.
6. Out-of-order.
7. Schema evolution.
8. Consumer restart.

### 28.2 Menggunakan `Thread.sleep()`

Buruk:

```java
Thread.sleep(5000);
assertThat(repository.findById(id)).isPresent();
```

Lebih baik:

```java
await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
        assertThat(repository.findById(id)).isPresent()
);
```

### 28.3 Topic dan Group ID Tidak Diisolasi

Shared topic/group antar test menyebabkan flaky tests.

### 28.4 Menganggap Integration Test Sama dengan Contract Test

Integration test bisa lulus meski schema change akan mematahkan consumer lama.

### 28.5 Tidak Menguji Idempotency

Jika consumer punya side effect, idempotency test wajib.

### 28.6 Testing Kafka Streams dengan Real Time

Window test harus mengontrol event timestamp.

### 28.7 Mengabaikan DLQ Metadata

DLQ tanpa metadata recovery adalah kuburan event.

### 28.8 Menguji Implementation Detail Terlalu Dalam

Jangan assert method internal yang tidak penting. Assert invariant.

Buruk:

```text
verify private method parsePayload called once
```

Baik:

```text
invalid payload produces DLQ record with original offset metadata
```

---

## 29. Testing Checklist

### Producer Checklist

- [ ] Event type benar.
- [ ] Topic benar.
- [ ] Key sesuai ordering domain.
- [ ] Required headers tersedia.
- [ ] Correlation/causation id diteruskan.
- [ ] Schema valid.
- [ ] Event id unik.
- [ ] Outbox atomic dengan state change jika digunakan.
- [ ] Producer error path jelas.

### Consumer Checklist

- [ ] Valid event menghasilkan side effect benar.
- [ ] Duplicate event aman.
- [ ] Manual ack hanya setelah side effect sukses.
- [ ] Failure tidak ack sebelum handled.
- [ ] Poison pill masuk DLQ atau error path sesuai policy.
- [ ] DLQ memiliki metadata cukup.
- [ ] Retry dibedakan transient vs permanent.
- [ ] Replay aman.
- [ ] Out-of-order behavior eksplisit.
- [ ] Observability tersedia.

### Schema Checklist

- [ ] Compatibility check berjalan di CI.
- [ ] Golden fixtures tersedia.
- [ ] Consumer lama bisa membaca event baru sesuai policy.
- [ ] Consumer baru bisa membaca event lama sesuai policy.
- [ ] Breaking change butuh versioning/migration.
- [ ] Semantic changes diuji, bukan hanya structural schema.

### Kafka Streams Checklist

- [ ] TopologyTestDriver digunakan untuk DSL/topology.
- [ ] Timestamp dikontrol.
- [ ] Window/grace/late event diuji.
- [ ] Join semantics diuji.
- [ ] Repartition expectation jelas.
- [ ] State store diuji jika materialized.
- [ ] Exactly-once config diuji pada integration level jika critical.

### Integration Checklist

- [ ] Testcontainers atau environment nyata digunakan untuk wiring critical.
- [ ] Topic/group isolated.
- [ ] Awaitility digunakan, bukan sleep.
- [ ] Serialization/deserialization nyata diuji.
- [ ] DB + Kafka boundary diuji.
- [ ] Test cleanup jelas.

### Failure Checklist

- [ ] Consumer crash simulation.
- [ ] Duplicate after rebalance simulation.
- [ ] Broker temporary unavailable.
- [ ] Schema Registry unavailable.
- [ ] Downstream DB/API unavailable.
- [ ] DLQ unavailable.
- [ ] Lag/backlog behavior.

---

## 30. Latihan / Thought Exercises

### Exercise 1 — Idempotent Consumer

Desain test untuk consumer `PaymentCapturedConsumer`.

Syarat:

1. Event punya `eventId`, `paymentId`, `amount`.
2. Settlement side effect harus terjadi satu kali per `paymentId`.
3. Duplicate bisa datang dengan eventId sama atau berbeda.

Pertanyaan:

1. Deduplication key mana yang kamu pilih?
2. Table uniqueness apa yang dibutuhkan?
3. Test apa yang membuktikan concurrency duplicate aman?

### Exercise 2 — Case Lifecycle Replay

Kamu punya event:

```text
CaseOpened
EvidenceSubmitted
CaseEscalated
CaseAssigned
CaseClosed
```

Desain replay test untuk rebuild `CaseProjection`.

Pertanyaan:

1. Apa expected final state?
2. Event mana yang idempotent?
3. Apa yang terjadi jika `EvidenceSubmitted` datang dua kali?
4. Apa yang terjadi jika `CaseClosed` datang sebelum `CaseOpened`?

### Exercise 3 — Schema Evolution

Producer ingin menambahkan field `escalationReason` ke `CaseEscalated`.

Pertanyaan:

1. Bagaimana schema dibuat agar backward compatible?
2. Golden fixture apa yang perlu ditambah?
3. Consumer lama akan melihat apa?
4. Consumer baru harus bagaimana saat field null?

### Exercise 4 — Poison Pill Policy

Consumer menerima event dengan enum `level=LEVEL_99` yang tidak dikenal.

Pertanyaan:

1. Apakah harus retry?
2. Apakah masuk DLQ?
3. Metadata DLQ apa yang wajib?
4. Apakah offset di-ack setelah DLQ publish?
5. Apa yang terjadi jika DLQ publish gagal?

### Exercise 5 — Kafka Streams Window

Kamu menghitung jumlah escalation per officer per 5 menit.

Pertanyaan:

1. Apakah pakai event time atau processing time?
2. Grace period berapa?
3. Apa expected behavior untuk event terlambat 10 menit?
4. Bagaimana test timestamp-nya?
5. Apa output saat window belum closed?

---

## 31. Ringkasan

Testing Kafka systems harus bergerak dari “apakah message sampai?” ke “apakah semantics benar di bawah retry, duplicate, replay, schema evolution, rebalance, dan failure?”.

Hal paling penting:

1. Kafka testing harus berbasis invariant.
2. Producer test harus membuktikan event, key, header, schema, dan outbox boundary benar.
3. Consumer test harus membuktikan idempotency, ack timing, retry, DLQ, dan replay safety.
4. Schema compatibility test adalah CI gate wajib untuk event-driven system lintas tim.
5. Golden event fixtures melindungi consumer dari historical compatibility regression.
6. Testcontainers bagus untuk integration test, tetapi bukan pengganti unit/component/contract test.
7. Kafka Streams topology harus diuji deterministik dengan timestamp yang dikontrol.
8. Replay test penting untuk projection, migration, backfill, dan audit reconstruction.
9. Poison pill dan DLQ harus diuji sebagai operational recovery path.
10. Failure testing harus memasukkan duplicate processing, consumer crash, rebalance, downstream failure, dan lag behavior.

Kafka production maturity terlihat dari jenis test yang dimiliki tim.

Engineer yang hanya menguji happy path akan terkejut saat production melakukan retry, rebalance, replay, dan schema evolution.

Engineer yang matang akan bertanya:

```text
Apa invariant sistem ini?
Failure mode apa yang bisa melanggarnya?
Test mana yang membuktikan invariant tetap benar?
```

Itulah perbedaan antara Kafka application yang “bisa jalan” dan Kafka system yang defensible di production.

---

## 32. Status Seri

Part ini adalah bagian ke-23 dari total 35 bagian:

```text
Part 000 sampai Part 023 selesai.
Part 024 sampai Part 034 belum selesai.
```

Seri belum selesai.

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-024.md
```

Judul:

```text
Observability: Lag, Throughput, Latency, JMX, Metrics, Tracing, and Alerting
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Spring Boot and Kafka: Practical Java Integration Without Losing Kafka Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-024.md">Part 024 — Observability: Lag, Throughput, Latency, JMX, Metrics, Tracing, and Alerting ➡️</a>
</div>

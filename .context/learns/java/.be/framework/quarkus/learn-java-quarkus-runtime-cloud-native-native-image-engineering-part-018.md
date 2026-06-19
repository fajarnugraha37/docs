# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-018

# Part 018 — Messaging I: Kafka, RabbitMQ, AMQP, SmallRye Reactive Messaging

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Fokus: Quarkus advanced runtime, cloud-native, native image, production engineering  
> Status: Part 018 dari 035  
> Prasyarat: sudah memahami Java concurrency, Jakarta REST, transaction, persistence, fault tolerance, dan reactive execution model dari part sebelumnya.

---

## 0. Tujuan Part Ini

Part ini membahas messaging di Quarkus dari perspektif **production engineering**, bukan hanya tutorial mengirim dan menerima pesan.

Setelah menyelesaikan part ini, target pemahamanmu:

1. Memahami Quarkus Messaging sebagai layer deklaratif di atas SmallRye Reactive Messaging.
2. Bisa membedakan broker semantics antara Kafka, RabbitMQ, dan AMQP 1.0.
3. Bisa mendesain consumer yang aman terhadap duplicate, retry, ordering, poison message, dan backpressure.
4. Bisa memutuskan kapan memakai messaging dan kapan sebaiknya tidak.
5. Bisa membuat failure strategy yang eksplisit: fail-fast, ignore, dead-letter, retry, manual nack, parking lot, replay.
6. Bisa memahami konsekuensi ack/nack terhadap offset commit, broker delivery, dan state domain.
7. Bisa membangun message-driven service yang observable, testable, dan native-image-aware.

Di level top-tier engineer, messaging tidak dipahami sebagai “queue untuk async”. Messaging adalah **distributed consistency boundary**. Begitu pesan keluar dari proses, kamu sudah masuk ke dunia:

- partial failure,
- duplicate delivery,
- ordering ambiguity,
- schema evolution,
- replay,
- eventual consistency,
- consumer lag,
- poison message,
- operational recovery.

---

## 1. Mental Model: Messaging Bukan Sekadar Async Function Call

Banyak engineer memperlakukan message broker seperti ini:

```text
service A calls service B asynchronously
```

Model itu terlalu dangkal.

Model yang lebih benar:

```text
Service A records an intent/fact into a durable communication substrate.
Service B later observes that fact/intent under broker-specific delivery semantics.
Between A and B, time, order, retries, failures, schema, and ownership become explicit design problems.
```

Messaging memisahkan waktu antara producer dan consumer. Ini memberi keuntungan:

- caller tidak harus menunggu consumer,
- throughput bisa di-buffer,
- consumer bisa scale independently,
- temporary downstream failure bisa diserap,
- event bisa digunakan banyak consumer.

Tetapi harganya besar:

- tidak ada synchronous transaction antar service,
- duplicate delivery harus diasumsikan,
- ordering tidak otomatis global,
- failure bisa tersembunyi di backlog,
- recovery butuh tooling,
- data contract harus versioned,
- observability lebih sulit.

Jadi invariant pertama:

> Messaging bukan cara menghindari complexity. Messaging adalah cara memindahkan complexity dari call stack ke distributed log/queue.

---

## 2. Quarkus Messaging Stack

Dalam Quarkus, messaging modern umumnya dibangun dengan:

```text
Application code
  ↓
@Incoming / @Outgoing / Emitter / MutinyEmitter
  ↓
SmallRye Reactive Messaging
  ↓
Connector
  ├── Kafka connector
  ├── RabbitMQ connector
  ├── AMQP 1.0 connector
  ├── MQTT connector
  └── In-memory connector for tests
  ↓
Broker / transport
```

Quarkus menyediakan integrasi Reactive Messaging untuk Kafka, RabbitMQ, AMQP, dan broker lain. Inti programming model-nya adalah channel. Application code bicara ke channel, bukan langsung ke broker API.

Contoh konseptual:

```java
@ApplicationScoped
public class CaseEventConsumer {

    @Incoming("case-events")
    public void consume(CaseSubmittedEvent event) {
        // process event
    }
}
```

Konfigurasi menentukan channel tersebut tersambung ke mana:

```properties
mp.messaging.incoming.case-events.connector=smallrye-kafka
mp.messaging.incoming.case-events.topic=case.events
mp.messaging.incoming.case-events.value.deserializer=com.example.CaseSubmittedEventDeserializer
```

Dengan model ini, kode domain tidak langsung tergantung pada `KafkaConsumer`, `Channel`, `RabbitTemplate`, atau client broker tertentu.

Namun jangan salah paham: abstraction ini tidak menghapus broker semantics.

Kafka tetap Kafka. RabbitMQ tetap RabbitMQ. AMQP tetap AMQP.

Abstraction hanya merapikan integration point, bukan menyamakan delivery model.

---

## 3. Broker Semantics: Kafka vs RabbitMQ vs AMQP

### 3.1 Kafka

Kafka paling tepat dipahami sebagai:

```text
partitioned durable append-only log with consumer offsets
```

Karakter utama:

- data disimpan dalam topic,
- topic dibagi menjadi partition,
- ordering dijamin per partition, bukan global,
- consumer group membagi partition antar consumer,
- offset menunjukkan progress consumer,
- replay bisa dilakukan dengan mengubah offset,
- retention berdasarkan waktu/size, bukan “hapus setelah dibaca” secara klasik.

Kafka cocok untuk:

- event stream,
- audit/event log,
- integration event,
- CDC pipeline,
- analytics ingestion,
- high-throughput fan-out,
- replayable processing.

Kafka kurang cocok untuk:

- task queue dengan arbitrary competing workers yang butuh requeue fleksibel,
- per-message priority,
- per-message delay kompleks,
- workflow orchestration detail,
- strict global ordering.

Mental model Kafka:

```text
Producer writes to topic partition.
Consumer group owns partition assignment.
Consumer processes record.
Ack means offset progress can be committed.
Failure strategy determines whether processing stops, skips, retries, or writes DLQ.
```

### 3.2 RabbitMQ

RabbitMQ paling tepat dipahami sebagai:

```text
message broker with exchanges, queues, routing keys, acknowledgements, and redelivery
```

Karakter utama:

- producer publish ke exchange,
- exchange route ke queue berdasarkan binding,
- consumer consume dari queue,
- message umumnya hilang dari queue setelah ack,
- nack/reject bisa requeue atau dead-letter,
- mendukung routing patterns yang fleksibel,
- cocok untuk task queue dan command dispatch.

RabbitMQ cocok untuk:

- work queue,
- command delivery,
- task distribution,
- routing berbasis exchange,
- request buffering,
- retry/dead-letter per queue,
- service command async.

RabbitMQ kurang cocok untuk:

- replay besar-besaran seperti event log,
- long-term event retention,
- analytics stream,
- consumer offset replay semantics seperti Kafka.

Mental model RabbitMQ:

```text
Producer publishes message.
Exchange routes message to queue.
Consumer receives message.
Ack removes message from queue.
Nack may requeue or dead-letter depending config.
```

### 3.3 AMQP 1.0

AMQP 1.0 adalah protokol messaging standar yang dipakai oleh beberapa broker/platform enterprise. Jangan disamakan begitu saja dengan RabbitMQ AMQP 0.9.1 model.

AMQP cocok saat:

- organisasi memakai broker enterprise berbasis AMQP,
- perlu interoperability antar platform,
- integrasi enterprise messaging existing,
- vendor/platform menentukan transport AMQP.

Mental model AMQP tergantung broker implementasi, tetapi di Quarkus kamu tetap memakai channel Reactive Messaging.

---

## 4. Channel sebagai Boundary

Dalam Quarkus Reactive Messaging, channel adalah abstraction boundary.

```text
domain/service code
  ↓
channel name
  ↓
connector configuration
  ↓
broker topic/queue/address
```

Channel name sebaiknya merepresentasikan intention, bukan detail broker.

Kurang baik:

```properties
mp.messaging.incoming.kafka-topic-case-submitted.connector=smallrye-kafka
```

Lebih baik:

```properties
mp.messaging.incoming.case-submitted-events.connector=smallrye-kafka
```

Kenapa?

Karena application code sebaiknya tidak tahu apakah channel itu dari topic Kafka, queue RabbitMQ, atau in-memory test connector.

Namun config harus eksplisit agar operational team tahu mapping-nya.

Contoh:

```properties
# Logical channel
mp.messaging.incoming.case-submitted-events.connector=smallrye-kafka

# Physical binding
mp.messaging.incoming.case-submitted-events.topic=case.submitted.v1
mp.messaging.incoming.case-submitted-events.bootstrap.servers=${KAFKA_BOOTSTRAP_SERVERS}
mp.messaging.incoming.case-submitted-events.group.id=case-workflow-service
```

Invariant:

> Channel name adalah application contract. Topic/queue/address adalah infrastructure binding.

---

## 5. Basic Consumer Patterns

### 5.1 Payload Consumer

```java
@ApplicationScoped
public class CaseSubmittedConsumer {

    @Incoming("case-submitted-events")
    public void onCaseSubmitted(CaseSubmittedEvent event) {
        // process event
    }
}
```

Sederhana, tetapi terbatas. Kamu tidak punya akses langsung ke metadata broker, ack/nack manual, header, key, partition, offset, delivery tag, dan sebagainya.

Cocok untuk:

- demo,
- low-criticality consumer,
- internal simple event,
- processing yang aman dan cepat.

Tidak ideal untuk:

- audit-heavy system,
- idempotency berbasis message id,
- correlation tracing,
- custom ack/nack,
- DLQ enrichment,
- partition-aware processing.

### 5.2 Message Consumer

```java
import org.eclipse.microprofile.reactive.messaging.Incoming;
import org.eclipse.microprofile.reactive.messaging.Message;

@ApplicationScoped
public class CaseSubmittedConsumer {

    @Incoming("case-submitted-events")
    public CompletionStage<Void> onCaseSubmitted(Message<CaseSubmittedEvent> message) {
        CaseSubmittedEvent event = message.getPayload();

        return process(event)
            .thenCompose(ignored -> message.ack())
            .exceptionallyCompose(ex -> message.nack(ex));
    }

    private CompletionStage<Void> process(CaseSubmittedEvent event) {
        // async processing
        return CompletableFuture.completedFuture(null);
    }
}
```

Dengan `Message<T>`, kamu bisa mengontrol acknowledgement.

Namun manual ack/nack harus disiplin. Kesalahan ack terlalu awal bisa menyebabkan data loss. Kesalahan tidak ack bisa menyebabkan redelivery/backlog.

### 5.3 Mutiny Consumer

```java
import io.smallrye.mutiny.Uni;
import org.eclipse.microprofile.reactive.messaging.Incoming;
import org.eclipse.microprofile.reactive.messaging.Message;

@ApplicationScoped
public class CaseSubmittedConsumer {

    @Incoming("case-submitted-events")
    public Uni<Void> onCaseSubmitted(Message<CaseSubmittedEvent> message) {
        return process(message.getPayload())
            .call(message::ack)
            .onFailure().call(message::nack)
            .replaceWithVoid();
    }

    private Uni<Void> process(CaseSubmittedEvent event) {
        return Uni.createFrom().voidItem();
    }
}
```

Mutiny cocok karena Quarkus reactive stack memakai Mutiny secara luas.

---

## 6. Producer Patterns

### 6.1 Method-to-Channel with `@Outgoing`

```java
@ApplicationScoped
public class CaseEventProducer {

    @Outgoing("case-submitted-events")
    public Multi<CaseSubmittedEvent> produce() {
        return Multi.createFrom().items(
            new CaseSubmittedEvent("CASE-001"),
            new CaseSubmittedEvent("CASE-002")
        );
    }
}
```

Ini cocok untuk stream generator/pipeline, tapi tidak selalu cocok untuk transactional application service.

### 6.2 Imperative `Emitter`

```java
import org.eclipse.microprofile.reactive.messaging.Channel;
import org.eclipse.microprofile.reactive.messaging.Emitter;

@ApplicationScoped
public class CaseEventPublisher {

    @Channel("case-submitted-events")
    Emitter<CaseSubmittedEvent> emitter;

    public void publish(CaseSubmittedEvent event) {
        emitter.send(event);
    }
}
```

Sederhana, tetapi perlu hati-hati:

- apakah `send` benar-benar sukses broker-level?
- apakah dipanggil dalam transaction database?
- bagaimana jika database commit sukses tapi publish gagal?
- bagaimana jika publish sukses tapi database rollback?

Untuk domain event penting, jangan publish langsung dari transaction kecuali kamu menerima inconsistency risk.

Gunakan outbox pattern untuk consistency.

### 6.3 MutinyEmitter

```java
import io.smallrye.reactive.messaging.MutinyEmitter;
import org.eclipse.microprofile.reactive.messaging.Channel;

@ApplicationScoped
public class CaseEventPublisher {

    @Channel("case-submitted-events")
    MutinyEmitter<CaseSubmittedEvent> emitter;

    public Uni<Void> publish(CaseSubmittedEvent event) {
        return emitter.send(event).replaceWithVoid();
    }
}
```

`MutinyEmitter` lebih cocok ketika flow kamu reactive atau ingin hasil pengiriman menjadi bagian dari pipeline.

---

## 7. Ack/Nack: Konsep Paling Penting Setelah Idempotency

Acknowledgement adalah sinyal bahwa message berhasil diproses.

Tetapi maknanya berbeda per broker:

```text
Kafka ack     → offset boleh dianggap selesai/committed
RabbitMQ ack  → message boleh dihapus dari queue
AMQP ack      → message accepted/settled sesuai broker semantics
```

Nack adalah sinyal gagal.

Maknanya juga broker-specific:

```text
Kafka nack    → failure strategy menentukan stop, ignore, DLQ, dll.
RabbitMQ nack → bisa requeue atau dead-letter
AMQP nack     → released/rejected/modified tergantung connector/broker
```

### 7.1 Ack Terlalu Awal

Contoh buruk:

```java
@Incoming("case-events")
public CompletionStage<Void> consume(Message<CaseEvent> msg) {
    msg.ack();
    process(msg.getPayload());
    return CompletableFuture.completedFuture(null);
}
```

Masalah:

- message dianggap selesai,
- process bisa gagal setelah ack,
- broker tidak tahu gagal,
- data hilang secara semantik.

Ack harus dilakukan setelah durable side effect selesai.

```text
receive message
  ↓
validate
  ↓
idempotency check
  ↓
transactional state change / durable side effect
  ↓
ack
```

### 7.2 Ack Terlalu Lambat

Ack terlalu lambat juga bermasalah:

- consumer lag naik,
- partition/queue tertahan,
- rebalance risk,
- redelivery risk,
- throughput turun.

Jika proses panjang, pertimbangkan:

- split workload,
- store command state lalu ack,
- process async dengan job state,
- jangan tahan message selama workflow panjang.

### 7.3 Nack Tanpa Strategi

Nack tanpa strategi eksplisit bisa menyebabkan:

- aplikasi unhealthy,
- infinite redelivery,
- poison message loop,
- topic/queue stuck,
- DLQ penuh,
- incident yang sulit dianalisis.

Top-tier rule:

> Setiap incoming channel production harus punya failure strategy eksplisit dan dokumentasi recovery.

---

## 8. Failure Strategy

### 8.1 Fail-Fast

Fail-fast berarti consumer berhenti atau channel menjadi unhealthy saat message gagal.

Kelebihan:

- tidak menyembunyikan bug,
- cocok untuk data critical yang tidak boleh skip,
- cepat terlihat oleh monitoring.

Kekurangan:

- satu poison message bisa menghentikan processing,
- backlog tumbuh,
- perlu operator intervention.

Cocok untuk:

- early development,
- strict pipeline,
- invariant violation serius,
- data yang tidak boleh diabaikan.

### 8.2 Ignore

Ignore berarti failure di-skip.

Kelebihan:

- pipeline tetap jalan,
- tidak stuck karena satu message.

Kekurangan:

- data loss semantik,
- bug bisa tersembunyi,
- audit buruk.

Cocok hanya untuk:

- telemetry non-critical,
- metric/log-like stream,
- data yang memang boleh hilang.

Untuk domain/regulatory event, ignore hampir selalu salah.

### 8.3 Dead-Letter Queue/Topic

DLQ berarti message gagal dipindahkan ke tempat khusus untuk investigasi/replay.

Kelebihan:

- main pipeline tetap jalan,
- message gagal tidak hilang,
- recovery bisa dilakukan terpisah.

Kekurangan:

- DLQ bisa menjadi kuburan message,
- perlu dashboard dan runbook,
- replay bisa menyebabkan duplicate side effect jika tidak idempotent.

Production DLQ harus punya:

- original payload,
- failure reason,
- stack/error code,
- original topic/queue,
- original partition/offset/delivery metadata,
- timestamp,
- correlation id,
- consumer service name/version,
- schema version,
- retry count,
- tenant/idempotency key jika relevan.

DLQ tanpa owner dan runbook adalah technical debt.

---

## 9. Kafka Configuration Patterns

### 9.1 Basic Incoming Kafka Channel

```properties
mp.messaging.incoming.case-submitted.connector=smallrye-kafka
mp.messaging.incoming.case-submitted.bootstrap.servers=${KAFKA_BOOTSTRAP_SERVERS}
mp.messaging.incoming.case-submitted.topic=case.submitted.v1
mp.messaging.incoming.case-submitted.group.id=case-workflow-service
mp.messaging.incoming.case-submitted.key.deserializer=org.apache.kafka.common.serialization.StringDeserializer
mp.messaging.incoming.case-submitted.value.deserializer=com.example.messaging.CaseSubmittedDeserializer
```

### 9.2 Failure Strategy DLQ

```properties
mp.messaging.incoming.case-submitted.failure-strategy=dead-letter-queue
mp.messaging.incoming.case-submitted.dead-letter-queue.topic=case.submitted.dlq.v1
```

### 9.3 Commit Strategy

Commit strategy menentukan kapan offset dicatat.

Yang perlu dipahami:

- commit offset terlalu cepat dapat menyebabkan kehilangan processing,
- commit terlalu lambat meningkatkan duplicate/redelivery saat crash,
- commit bukan transaksi domain,
- offset commit tidak menggantikan idempotency.

### 9.4 Partitioning and Ordering

Kafka ordering hanya dijamin dalam satu partition.

Jika event case harus urut per case, gunakan key:

```text
key = caseId
```

Dengan begitu semua event untuk case yang sama masuk partition yang sama.

Tapi trade-off:

- case populer bisa membuat hot partition,
- jumlah partition membatasi parallelism consumer group,
- re-keying topic adalah migration besar.

Contoh producer metadata biasanya memakai key. Dalam Quarkus, metadata Kafka dapat ditambahkan saat mengirim message.

Konseptual:

```java
Message<CaseSubmittedEvent> message = Message.of(event)
    .addMetadata(OutgoingKafkaRecordMetadata.<String>builder()
        .withKey(event.caseId())
        .build());
```

Invariant:

> Kafka key bukan hanya metadata. Kafka key adalah keputusan ordering, load distribution, dan future scaling.

---

## 10. RabbitMQ Configuration Patterns

### 10.1 Basic Incoming RabbitMQ Channel

```properties
mp.messaging.incoming.case-commands.connector=smallrye-rabbitmq
mp.messaging.incoming.case-commands.exchange.name=case.commands
mp.messaging.incoming.case-commands.queue.name=case-review-worker
mp.messaging.incoming.case-commands.routing-keys=case.review.requested
```

### 10.2 DLQ Pattern RabbitMQ

RabbitMQ DLQ biasanya dirancang dengan:

- main exchange,
- main queue,
- dead-letter exchange,
- dead-letter queue,
- routing key untuk dead-letter.

Konsep:

```text
case.commands.exchange
  → case-review-worker queue
       x-dead-letter-exchange = case.commands.dlx
       x-dead-letter-routing-key = case.review.failed

case.commands.dlx
  → case-review-dlq queue
```

Keputusan penting:

- apakah nack requeue?
- berapa retry sebelum DLQ?
- retry pakai TTL queue atau delayed exchange?
- apakah message order harus dipertahankan?
- apakah poison message boleh menahan queue?

### 10.3 RabbitMQ sebagai Work Queue

Untuk task distribution:

```text
producer publishes command
  ↓
queue buffers command
  ↓
multiple workers consume
  ↓
one message handled by one worker
  ↓
ack removes task
```

Ini sangat cocok untuk:

- email sending,
- file processing,
- report generation,
- external API sync,
- batch-like async task.

Tetapi untuk domain event replayable, Kafka sering lebih cocok.

---

## 11. AMQP 1.0 Configuration Patterns

AMQP 1.0 di Quarkus juga memakai Reactive Messaging channel.

Contoh konseptual:

```properties
mp.messaging.incoming.case-events.connector=smallrye-amqp
mp.messaging.incoming.case-events.address=case.events
mp.messaging.incoming.case-events.host=${AMQP_HOST}
mp.messaging.incoming.case-events.port=${AMQP_PORT}
mp.messaging.incoming.case-events.username=${AMQP_USERNAME}
mp.messaging.incoming.case-events.password=${AMQP_PASSWORD}
```

AMQP sering muncul di enterprise integration karena protokolnya standar dan interoperable.

Namun operational semantics tetap perlu divalidasi terhadap broker aktual:

- settlement mode,
- redelivery behavior,
- DLQ behavior,
- address/queue model,
- durable subscription,
- flow control,
- transaction support.

Jangan mengasumsikan semua AMQP broker identik.

---

## 12. Serialization and Schema Contract

Messaging contract lebih sulit daripada REST contract karena:

- producer dan consumer sering deploy terpisah,
- message bisa tersimpan lama,
- replay message lama harus tetap bisa diproses,
- DLQ bisa berisi payload versi lama,
- consumer baru bisa membaca event lama.

### 12.1 JSON

JSON mudah dibaca dan debug.

Kelebihan:

- human-readable,
- mudah dipakai,
- cocok untuk internal service awal,
- mudah masuk DLQ/investigation.

Kekurangan:

- schema enforcement lemah,
- ukuran lebih besar,
- evolusi enum/null bisa berbahaya,
- field rename rawan.

### 12.2 Avro/Protobuf

Cocok untuk:

- high-throughput,
- multi-team event contract,
- schema registry,
- strict compatibility rule.

Trade-off:

- tooling lebih kompleks,
- schema governance wajib,
- debugging manual lebih sulit.

### 12.3 Versioning Rule

Event versioning yang sehat:

```json
{
  "eventId": "evt-123",
  "eventType": "case.submitted",
  "eventVersion": 1,
  "occurredAt": "2026-06-20T10:15:30Z",
  "producer": "case-service",
  "correlationId": "corr-abc",
  "tenantId": "agency-a",
  "payload": {
    "caseId": "CASE-001",
    "submittedBy": "USER-123"
  }
}
```

Contract fields yang sebaiknya ada:

| Field | Alasan |
|---|---|
| `eventId` | idempotency/deduplication |
| `eventType` | routing dan handler selection |
| `eventVersion` | schema evolution |
| `occurredAt` | business time |
| `publishedAt` | infrastructure time |
| `correlationId` | tracing across services |
| `causationId` | event chain causality |
| `producer` | ownership |
| `tenantId` | multi-tenancy |
| `payload` | domain content |

---

## 13. Idempotency: Non-Negotiable Consumer Requirement

Dalam distributed messaging, duplicate bukan edge case. Duplicate adalah normal possibility.

Penyebab duplicate:

- consumer crash setelah side effect sebelum offset commit/ack,
- broker redelivery,
- retry producer,
- network timeout,
- rebalance,
- manual replay,
- DLQ replay,
- operational recovery.

Karena itu consumer harus idempotent.

### 13.1 Idempotency Table

Contoh table:

```sql
CREATE TABLE processed_message (
    consumer_name      VARCHAR(128) NOT NULL,
    message_id         VARCHAR(128) NOT NULL,
    processed_at       TIMESTAMP NOT NULL,
    source             VARCHAR(128),
    correlation_id     VARCHAR(128),
    PRIMARY KEY (consumer_name, message_id)
);
```

Consumer flow:

```text
receive message
  ↓
begin transaction
  ↓
insert processed_message(consumer, eventId)
  ↓
if duplicate key → already processed → ack
  ↓
apply domain change
  ↓
commit
  ↓
ack
```

Pseudo-code:

```java
@Transactional
public ProcessingResult handle(CaseSubmittedEvent event) {
    boolean firstTime = idempotencyRepository.tryRegister(
        "case-workflow-service",
        event.eventId()
    );

    if (!firstTime) {
        return ProcessingResult.duplicateIgnored();
    }

    workflowService.startReview(event.caseId());
    return ProcessingResult.processed();
}
```

### 13.2 Natural Idempotency

Kadang domain operation bisa idempotent secara natural:

```text
Set case status to SUBMITTED if current status is DRAFT
```

Jika status sudah SUBMITTED, ulang event tidak mengubah hasil.

Namun tetap lebih baik menyimpan processed message untuk audit dan replay control.

### 13.3 Idempotency Key Harus Stabil

Jangan gunakan:

- timestamp processing,
- random UUID consumer-side,
- offset saja untuk idempotency business,
- payload hash tanpa canonicalization.

Gunakan:

- event id producer-side,
- command id,
- business operation id,
- source aggregate id + version jika event sourced.

---

## 14. Ordering

Ordering adalah salah satu area paling sering disalahpahami.

### 14.1 Global Ordering Hampir Selalu Mahal

Jika kamu butuh global ordering semua event, kamu biasanya mengorbankan parallelism.

Kafka global ordering berarti satu partition. Itu bottleneck.

RabbitMQ queue ordering bisa rusak oleh:

- multiple consumers,
- redelivery,
- nack/requeue,
- retry queue,
- priority,
- dead-letter/replay.

### 14.2 Per-Aggregate Ordering

Untuk sistem case management, ordering yang sering dibutuhkan adalah per case:

```text
CASE-001: submitted → assigned → reviewed → approved
CASE-002: submitted → rejected
```

Tidak perlu event CASE-001 selalu sebelum CASE-002.

Maka Kafka key = `caseId` cocok.

### 14.3 Consumer-Side Version Check

Untuk domain penting, jangan hanya mengandalkan broker ordering. Tambahkan aggregate version.

```json
{
  "caseId": "CASE-001",
  "aggregateVersion": 7,
  "eventType": "case.approved"
}
```

Consumer bisa menolak/delay jika version gap:

```text
last_seen_version = 5
incoming_version = 7
missing version 6 → park/delay/retry
```

Ini penting untuk:

- replay,
- cross-topic event,
- consumer restart,
- manual fix,
- out-of-order delivery.

---

## 15. Backpressure

Backpressure berarti downstream memberi sinyal bahwa ia tidak sanggup menerima lebih banyak data pada kecepatan sekarang.

Dalam messaging, backpressure muncul dalam bentuk:

- consumer lag Kafka,
- queue depth RabbitMQ,
- unacked messages,
- high processing latency,
- DB connection pool saturation,
- worker pool saturation,
- memory growth,
- retry storm.

### 15.1 Broker Buffer Bukan Solusi Permanen

Broker bisa menyerap burst, tetapi tidak menyelesaikan mismatch kapasitas permanen.

Jika producer 10.000 msg/s dan consumer hanya 1.000 msg/s, backlog akan tumbuh tanpa batas sampai retention/disk/resource habis.

### 15.2 Consumer Concurrency

Meningkatkan concurrency tidak selalu menyelesaikan masalah.

Bottleneck bisa di:

- database,
- external API,
- lock contention,
- partition count,
- transaction conflict,
- downstream rate limit,
- CPU serialization/deserialization.

### 15.3 Rate Limiting Consumer

Untuk external API, consumer harus punya rate limit:

```text
incoming message rate may be high
but outbound API only allows 300/min
```

Maka desain:

- worker pool bounded,
- rate limiter,
- retry with backoff,
- DLQ for non-retryable,
- parking lot for retryable long wait,
- metrics for backlog.

---

## 16. Retry Design

Retry adalah obat yang bisa menjadi racun.

Retry aman hanya jika:

- operation idempotent,
- failure transient,
- retry budget terbatas,
- ada backoff/jitter,
- tidak memperbesar load saat dependency sedang sakit,
- error diklasifikasi.

### 16.1 Error Classification

| Error | Retry? | Action |
|---|---:|---|
| Network timeout | Ya | retry with backoff |
| HTTP 429 | Ya | respect rate limit/backoff |
| HTTP 503 | Ya | retry limited |
| Validation error | Tidak | DLQ |
| Unknown event version | Tidak/semi | park until supported or DLQ |
| Duplicate event | Tidak | ack as duplicate |
| DB unique conflict expected | Tidak | treat idempotently |
| DB unavailable | Ya | retry/backoff/fail-fast depending channel |
| Authorization error | Tidak | DLQ/security alert |

### 16.2 Retry Location

Retry bisa dilakukan di beberapa tempat:

1. In-memory retry dalam consumer.
2. Broker redelivery.
3. Retry topic/queue.
4. DLQ replay.
5. Scheduled repair job.

Untuk production, hindari infinite in-memory retry karena:

- menahan thread/event loop,
- menghambat partition/queue,
- hilang saat restart,
- tidak terlihat sebagai durable state.

Lebih baik gunakan retry topic/queue atau durable retry state untuk failure yang butuh waktu lama.

---

## 17. Poison Message

Poison message adalah message yang selalu gagal diproses.

Contoh:

- payload invalid,
- schema tidak dikenal,
- referenced entity tidak pernah ada,
- bug logic,
- data violates invariant,
- dependency always rejects.

Jika tidak ditangani, poison message bisa:

- menghentikan partition,
- membuat queue stuck,
- menyebabkan retry storm,
- membuat service unhealthy terus,
- menyembunyikan message lain di belakangnya.

Strategi:

```text
retry small number for transient suspicion
  ↓
classify error
  ↓
DLQ with enriched metadata
  ↓
alert owner
  ↓
manual/automated repair
  ↓
controlled replay
```

DLQ harus dipantau.

Metric penting:

- DLQ count,
- DLQ rate,
- oldest DLQ age,
- top failure reason,
- replay success/failure,
- repeated poison by producer version.

---

## 18. Consumer Lag and Queue Depth

### 18.1 Kafka Consumer Lag

Consumer lag:

```text
latest topic offset - committed consumer offset
```

Lag besar berarti consumer tertinggal.

Penyebab:

- consumer down,
- processing lambat,
- partition hot,
- DB lambat,
- retry storm,
- deserialization mahal,
- rebalance terlalu sering.

Lag harus dilihat bersama:

- input rate,
- processing rate,
- error rate,
- partition skew,
- consumer count,
- DB pool usage,
- CPU/memory.

### 18.2 RabbitMQ Queue Depth

Queue depth:

```text
messages ready + messages unacked
```

Perhatikan:

- ready messages tinggi → consumer kurang cepat/down,
- unacked tinggi → consumer menerima tapi belum ack,
- redelivered tinggi → failure/requeue loop,
- DLQ tinggi → poison/systemic error.

---

## 19. Message Handler Architecture

Handler yang sehat memisahkan concerns.

```text
Broker adapter
  ↓
Message envelope parser
  ↓
Validation
  ↓
Idempotency guard
  ↓
Domain application service
  ↓
Side effect/outbox/audit
  ↓
Ack/Nack decision
```

Contoh struktur package:

```text
com.example.caseworkflow.messaging
  CaseSubmittedConsumer.java
  CaseSubmittedMessageMapper.java
  CaseEventEnvelope.java

com.example.caseworkflow.application
  StartCaseReviewUseCase.java

com.example.caseworkflow.domain
  CaseReview.java
  CaseReviewPolicy.java

com.example.caseworkflow.infrastructure.idempotency
  ProcessedMessageRepository.java
```

Consumer tidak seharusnya berisi business process besar.

Buruk:

```java
@Incoming("case-events")
public void consume(CaseEvent event) {
    // parse
    // validate
    // query many tables
    // decide workflow
    // update status
    // call external API
    // send email
    // publish event
    // audit
    // handle retry
}
```

Lebih baik:

```java
@Incoming("case-events")
public Uni<Void> consume(Message<CaseEventEnvelope> message) {
    return messageProcessor.process(message.getPayload())
        .call(message::ack)
        .onFailure().call(message::nack)
        .replaceWithVoid();
}
```

---

## 20. Transaction Boundary with Messaging

### 20.1 Consumer Transaction

Consumer transaction umum:

```text
receive message
  ↓
begin DB transaction
  ↓
register idempotency
  ↓
apply domain state change
  ↓
write audit/outbox
  ↓
commit DB transaction
  ↓
ack message
```

Jika crash setelah commit tapi sebelum ack:

- broker bisa redeliver,
- idempotency table mencegah duplicate side effect,
- consumer ack duplicate.

Ini acceptable.

Jika ack sebelum commit:

- crash bisa membuat broker menganggap message selesai,
- DB change hilang,
- data loss semantik.

Maka ack setelah commit.

### 20.2 Producer Transaction Problem

Masalah klasik:

```text
DB commit success but message publish fails
message publish success but DB rollback
```

Solusi umum: outbox pattern.

```text
business transaction:
  update aggregate
  insert outbox event
  commit

publisher:
  read unpublished outbox
  publish to broker
  mark published
```

Outbox akan dibahas lebih dalam di Part 019, tetapi penting disebut di sini: untuk event domain penting, direct emitter dari service method sering tidak cukup.

---

## 21. Observability for Messaging

Messaging observability minimal:

### 21.1 Metrics

Per channel:

- consumed message count,
- produced message count,
- processing duration,
- ack count,
- nack count,
- retry count,
- DLQ count,
- deserialization failure count,
- duplicate ignored count,
- consumer lag,
- queue depth,
- unacked messages,
- handler error by type.

### 21.2 Logs

Structured log fields:

```json
{
  "event": "message_processing_failed",
  "channel": "case-submitted",
  "messageId": "evt-123",
  "eventType": "case.submitted",
  "eventVersion": 1,
  "correlationId": "corr-abc",
  "tenantId": "agency-a",
  "consumer": "case-workflow-service",
  "failureType": "VALIDATION_ERROR",
  "retryable": false
}
```

Jangan log payload penuh jika mengandung PII/sensitive data.

### 21.3 Tracing

Tracing harus membawa:

- traceparent dari message header,
- correlation id,
- causation id,
- producer span,
- consumer span,
- processing span,
- DB span,
- outbound HTTP span.

Tanpa context propagation, event-driven system terlihat seperti potongan-potongan log yang tidak terhubung.

---

## 22. Testing Messaging

### 22.1 Unit Test Handler

Business logic diuji tanpa broker.

```java
class CaseSubmittedHandlerTest {

    @Test
    void should_start_review_when_case_submitted() {
        // given event
        // when handler.process(event)
        // then domain state changed
    }
}
```

### 22.2 Component Test Consumer

Test consumer dengan fake/in-memory connector.

Tujuan:

- mapping payload,
- ack/nack behavior,
- idempotency behavior,
- error classification.

### 22.3 Integration Test with Dev Services/Testcontainers

Gunakan broker nyata untuk:

- Kafka partition/offset behavior,
- RabbitMQ ack/nack/redelivery,
- DLQ behavior,
- serialization/deserialization,
- consumer group behavior,
- config correctness.

### 22.4 Replay Test

Untuk event critical, buat replay test:

```text
given historical event v1/v2/v3
when consumed by current service
then processing remains compatible
```

Replay compatibility sering dilupakan sampai migration production gagal.

---

## 23. Native Image Implications

Messaging di native image perlu memperhatikan:

- serializer/deserializer reflection,
- Jackson reflection untuk DTO,
- Avro/Protobuf generated classes,
- SSL/TLS config,
- SASL/Kerberos compatibility,
- dynamic class loading,
- resource files,
- service loader metadata,
- broker client native support,
- DNS/network behavior.

Jika memakai custom serializer berbasis reflection, pastikan:

- class terdaftar untuk reflection jika perlu,
- field constructor tersedia,
- no dynamic proxy issue,
- no runtime classpath scanning assumption.

Native image cocok untuk:

- fast startup consumers,
- scale-to-zero workloads,
- short-lived processors,
- memory-constrained pods.

Tetapi untuk high-throughput long-running Kafka consumers, JVM mode sering tetap sangat kompetitif karena JIT throughput optimization.

Keputusan JVM vs native harus berdasarkan benchmark nyata, bukan asumsi.

---

## 24. Security in Messaging

Security messaging meliputi:

- broker authentication,
- TLS/mTLS,
- SASL mechanism,
- topic/queue authorization,
- producer permission,
- consumer permission,
- secret rotation,
- payload sensitivity,
- PII masking,
- tenant isolation,
- message signing/encryption jika perlu,
- replay abuse prevention.

### 24.1 Jangan Percaya Pesan Hanya Karena Datang dari Broker

Broker authentication membuktikan producer punya akses teknis. Itu tidak selalu membuktikan payload benar secara domain.

Consumer tetap harus validasi:

- schema,
- tenant,
- source service,
- event type,
- authorization domain,
- aggregate existence,
- allowed state transition.

### 24.2 Tenant Boundary

Untuk multi-tenant system:

- tenant id harus ada di envelope,
- consumer harus enforce tenant boundary,
- topic per tenant vs shared topic harus diputuskan sadar,
- DLQ tidak boleh mencampur data sensitif tanpa kontrol akses,
- metrics/logs jangan bocorkan tenant-sensitive data.

---

## 25. Anti-Patterns

### 25.1 “Fire and Forget” untuk Domain Critical Event

Jika event penting untuk state downstream, jangan treat sebagai fire-and-forget tanpa outbox, retry, observability, dan reconciliation.

### 25.2 Consumer Tanpa Idempotency

Ini bug production yang menunggu waktu.

### 25.3 Infinite Retry

Infinite retry membuat poison message menjadi incident permanen.

### 25.4 DLQ Tanpa Runbook

DLQ tanpa owner, dashboard, dan replay procedure hanya memindahkan failure ke tempat yang jarang dilihat.

### 25.5 Event Berisi Entity Snapshot Tanpa Contract

Mengirim seluruh entity internal membuat consumer tergantung pada model internal producer.

Gunakan event contract eksplisit.

### 25.6 Topic/Queue Name Hardcoded di Business Logic

Business code harus bicara channel, bukan detail broker.

### 25.7 Menggabungkan Command dan Event Semantics

Command:

```text
Please do X
```

Event:

```text
X happened
```

Jangan campur. Command punya intended recipient. Event adalah fact untuk observer.

### 25.8 Blocking Heavy Work di Event Loop

Jika consumer berjalan di reactive pipeline, jangan lakukan blocking JDBC/HTTP/file IO tanpa worker/virtual thread strategy.

### 25.9 Menganggap Kafka DLQ Sama dengan RabbitMQ DLQ

Istilah sama, semantics berbeda.

### 25.10 Tidak Menyimpan Message Metadata

Tanpa metadata, debugging/replay sulit.

---

## 26. Production Checklist

Untuk setiap incoming channel:

- [ ] Channel name logical dan konsisten.
- [ ] Broker binding terdokumentasi.
- [ ] Consumer group/queue name jelas.
- [ ] Failure strategy eksplisit.
- [ ] Ack/nack behavior dipahami.
- [ ] Idempotency key tersedia.
- [ ] Duplicate handling diuji.
- [ ] Ordering requirement didefinisikan.
- [ ] Retry policy bounded.
- [ ] DLQ/parking lot tersedia untuk poison message.
- [ ] DLQ punya owner dan runbook.
- [ ] Consumer lag/queue depth dimonitor.
- [ ] Processing latency dimonitor.
- [ ] Error taxonomy tersedia.
- [ ] Payload schema versioned.
- [ ] Backward compatibility diuji.
- [ ] Sensitive fields tidak bocor di log/DLQ.
- [ ] Trace/correlation id propagated.
- [ ] Broker credential aman.
- [ ] Integration test dengan broker nyata ada.
- [ ] Replay test untuk event penting ada.
- [ ] Native-image compatibility divalidasi jika target native.

Untuk setiap outgoing channel:

- [ ] Event/command semantics jelas.
- [ ] Contract owner jelas.
- [ ] Message key/routing key dirancang.
- [ ] Ordering/load distribution dipahami.
- [ ] Publishing failure ditangani.
- [ ] Outbox digunakan jika perlu consistency.
- [ ] Producer metrics tersedia.
- [ ] Schema evolution policy ada.

---

## 27. Case Study: Regulatory Case Submitted Event

Misal sistem regulatory case management punya event:

```text
case.submitted.v1
```

Producer: `case-management-service`  
Consumer: `case-workflow-service`, `notification-service`, `audit-indexer-service`

### 27.1 Event Envelope

```json
{
  "eventId": "evt-20260620-000001",
  "eventType": "case.submitted",
  "eventVersion": 1,
  "occurredAt": "2026-06-20T09:00:00Z",
  "publishedAt": "2026-06-20T09:00:01Z",
  "producer": "case-management-service",
  "correlationId": "corr-77a",
  "causationId": "cmd-submit-case-123",
  "tenantId": "agency-a",
  "aggregateId": "CASE-001",
  "aggregateVersion": 4,
  "payload": {
    "caseId": "CASE-001",
    "submittedBy": "USER-123",
    "submissionChannel": "INTERNET"
  }
}
```

### 27.2 Kafka Topic Design

```text
topic: case.submitted.v1
key: caseId
partition count: based on throughput + ordering requirement
consumer group: case-workflow-service
```

Reasoning:

- key `caseId` menjaga ordering per case,
- topic version memudahkan migration,
- consumer group per service menjaga independent consumption.

### 27.3 Consumer Flow

```text
receive event
  ↓
validate envelope
  ↓
validate eventVersion supported
  ↓
insert processed_message(consumer, eventId)
  ↓
load case workflow state
  ↓
if transition allowed: create review task
  ↓
write audit event
  ↓
commit
  ↓
ack
```

### 27.4 Failure Examples

| Failure | Handling |
|---|---|
| duplicate eventId | ack duplicate |
| invalid JSON | DLQ |
| unsupported eventVersion | DLQ or park |
| case not found | retry short, then DLQ/repair |
| DB unavailable | retry/backoff/fail-fast depending policy |
| transition invalid | DLQ + audit security/domain anomaly |

### 27.5 Why This Is Defensible

Karena setiap message punya:

- identity,
- version,
- causality,
- tenant,
- aggregate,
- ordering key,
- idempotency,
- audit trail,
- failure path,
- replay strategy.

Itu beda antara demo messaging dan production-grade messaging.

---

## 28. Design Decision Matrix

| Problem | Prefer Kafka | Prefer RabbitMQ | Prefer AMQP 1.0 |
|---|---:|---:|---:|
| Replayable event stream | Ya | Tidak utama | Tergantung broker |
| Task queue | Bisa, tapi tidak natural | Ya | Ya |
| Per-message routing | Terbatas | Kuat | Tergantung broker |
| Consumer group stream processing | Ya | Tidak sama | Tergantung broker |
| Long retention | Ya | Tidak utama | Tergantung broker |
| Enterprise protocol interoperability | Kadang | AMQP 0.9.1 specific | Ya |
| Priority queue | Tidak natural | Ya | Tergantung broker |
| High-throughput append log | Ya | Terbatas | Tergantung broker |
| Simple work distribution | Bisa | Ya | Ya |
| Event sourcing / CDC-like pipeline | Ya | Tidak ideal | Tidak utama |

---

## 29. Top 1% Engineering Questions

Sebelum membuat channel baru, tanyakan:

1. Apakah ini command atau event?
2. Siapa owner contract-nya?
3. Apakah message harus replayable?
4. Apakah ordering dibutuhkan? Global atau per aggregate?
5. Apa idempotency key-nya?
6. Apa failure strategy-nya?
7. Apa retry policy-nya?
8. Apa yang masuk DLQ?
9. Siapa owner DLQ?
10. Bagaimana replay dilakukan?
11. Apa schema evolution policy-nya?
12. Apa compatibility test-nya?
13. Bagaimana consumer lag dimonitor?
14. Bagaimana correlation id dipropagate?
15. Apakah payload mengandung PII?
16. Apakah event dipublish dalam transaction? Jika ya, bagaimana consistency dijaga?
17. Apakah consumer side effect idempotent?
18. Apakah broker choice sesuai semantics atau hanya karena tersedia?
19. Apa runbook saat poison message muncul?
20. Bagaimana memastikan message tidak menjadi hidden coupling antar service?

---

## 30. Ringkasan Invariants

1. Messaging memindahkan complexity dari call stack ke broker dan recovery workflow.
2. Channel abstraction tidak menghapus broker semantics.
3. Kafka adalah partitioned durable log, bukan sekadar queue.
4. RabbitMQ adalah broker routing/queue yang kuat untuk command/task distribution.
5. AMQP 1.0 adalah protokol enterprise; semantics aktual tergantung broker.
6. Ack berarti durable processing selesai, bukan handler baru mulai.
7. Nack tanpa failure strategy adalah incident waiting to happen.
8. Consumer production harus idempotent.
9. Ordering harus didefinisikan eksplisit: global, per aggregate, atau tidak perlu.
10. Retry harus bounded, classified, dan observable.
11. DLQ harus punya owner, metadata, runbook, dan replay strategy.
12. Outbox diperlukan saat event publish harus konsisten dengan database transaction.
13. Consumer lag/queue depth adalah health signal penting.
14. Event contract harus versioned dan backward-compatible.
15. Messaging yang bagus selalu punya observability, security, dan operational recovery.

---

## 31. Referensi Utama

- Quarkus Apache Kafka Reference Guide
- Quarkus Getting Started with RabbitMQ
- Quarkus Reactive Messaging RabbitMQ Connector Reference
- Quarkus AMQP 1.0 Guide and Reference
- Quarkus Kafka failure strategy documentation/blog
- SmallRye Reactive Messaging acknowledgement documentation
- SmallRye Reactive Messaging Kafka connector documentation

---

## 32. Status Seri

Part 018 selesai.

Seri belum selesai dan belum mencapai bagian terakhir.

Part berikutnya:

**Part 019 — Messaging II: Event-Driven Architecture, Outbox, CDC, Saga, and Process Boundary**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-017.md">⬅️ Part 017 — Security III: mTLS, Secrets, Crypto, Native Image Security, Supply Chain</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-019.md">Part 019 — Messaging II: Event-Driven Architecture, Outbox, CDC, Saga, and Process Boundary ➡️</a>
</div>

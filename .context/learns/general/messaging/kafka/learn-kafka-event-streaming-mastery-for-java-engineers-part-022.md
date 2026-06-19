# learn-kafka-event-streaming-mastery-for-java-engineers-part-022.md

# Part 022 — Spring Boot and Kafka: Practical Java Integration Without Losing Kafka Semantics

> Series: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Level: intermediate → advanced  
> Focus: memakai Spring Boot + Spring for Apache Kafka secara produktif tanpa kehilangan semantics Kafka yang sudah dibangun di Part 000–021.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 021, kita sudah membangun fondasi Kafka dari bawah:

1. Kafka sebagai distributed log.
2. Topic, partition, offset, ordering.
3. Broker internals, replication, durability.
4. Producer batching, acks, idempotence.
5. Consumer poll loop, offset commit, rebalance.
6. Delivery semantics.
7. Event design, schema governance, topic governance.
8. Kafka Connect, CDC, ksqlDB, Kafka Streams.

Part ini masuk ke realita Java ecosystem: banyak sistem production memakai **Spring Boot + Spring for Apache Kafka**.

Tetapi ada jebakan besar:

> Spring membuat Kafka mudah dipakai, tetapi Kafka semantics tidak hilang hanya karena kita memakai annotation.

`@KafkaListener` tidak menghapus konsep:

- partition ownership,
- offset position,
- committed offset,
- consumer group rebalance,
- at-least-once delivery,
- duplicate processing,
- poison record,
- backpressure,
- idempotency,
- retry topology,
- DLQ,
- transaction boundary,
- schema compatibility,
- ordering domain.

Spring Kafka adalah abstraction layer. Ia produktif kalau kita tahu apa yang disembunyikan. Ia berbahaya kalau kita menganggap abstraction itu mengubah sifat Kafka.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Memahami apa yang sebenarnya dilakukan Spring Kafka di atas Kafka Java client.
2. Mendesain producer Spring Boot yang aman, observable, dan tidak silently kehilangan event.
3. Mendesain consumer Spring Boot yang commit offset pada waktu yang benar.
4. Memilih ack mode berdasarkan failure semantics, bukan berdasarkan contoh tutorial.
5. Membedakan retry blocking, retry non-blocking, retry topic, dan DLQ.
6. Menghindari retry yang merusak ordering atau menyebabkan consumer stuck.
7. Menggunakan error handler tanpa menyembunyikan poison record.
8. Memahami concurrency Spring listener container terhadap partition assignment.
9. Mengintegrasikan idempotency, database transaction, dan Kafka offset secara realistis.
10. Menguji aplikasi Kafka dengan unit test, integration test, Embedded Kafka, dan Testcontainers.
11. Menyusun configuration baseline production untuk Spring Boot Kafka.
12. Mengidentifikasi abstraction leak umum dalam Spring Kafka.

---

## 2. Mental Model Utama

### 2.1 Spring Kafka Bukan Kafka Baru

Spring Kafka bukan broker, bukan protocol, bukan semantics engine baru.

Spring Kafka adalah:

```text
Spring abstraction + lifecycle management + configuration binding + listener container + error handling utilities + template API
```

Di bawahnya tetap ada:

```text
org.apache.kafka.clients.producer.KafkaProducer
org.apache.kafka.clients.consumer.KafkaConsumer
```

Artinya:

- producer tetap punya `acks`, batching, retry, idempotence, timeout;
- consumer tetap punya poll loop, group coordinator, partition assignment, heartbeat;
- offset tetap harus di-commit;
- rebalance tetap bisa terjadi;
- duplicate tetap mungkin;
- exactly-once tetap terbatas pada boundary tertentu;
- external side effect tetap butuh idempotency.

### 2.2 Annotation Tidak Sama Dengan Semantics

Kode seperti ini terlihat sederhana:

```java
@KafkaListener(topics = "case-events", groupId = "case-projection")
public void handle(CaseEvent event) {
    projectionService.apply(event);
}
```

Tetapi di baliknya ada pertanyaan besar:

1. Kapan offset di-commit?
2. Apa yang terjadi kalau `projectionService.apply(event)` sukses tetapi commit offset gagal?
3. Apa yang terjadi kalau commit offset sukses tetapi database write gagal?
4. Apa yang terjadi kalau event yang sama diproses dua kali?
5. Apa yang terjadi kalau listener exception terus-menerus?
6. Apakah retry blocking topic utama?
7. Apakah error dikirim ke DLQ?
8. Apakah DLQ punya metadata cukup untuk replay?
9. Apakah listener concurrency melebihi partition count?
10. Apakah ordering per key masih dijaga?

Spring Kafka memudahkan implementasi, bukan menghapus pertanyaan desain.

### 2.3 Listener Container Adalah Consumer Runtime

`@KafkaListener` tidak langsung “membaca Kafka”. Ia didaftarkan ke **listener container**.

Mental model:

```text
Spring Boot app
  └── KafkaListenerEndpointRegistry
        └── ConcurrentMessageListenerContainer
              ├── KafkaMessageListenerContainer thread-1
              │     └── KafkaConsumer
              ├── KafkaMessageListenerContainer thread-2
              │     └── KafkaConsumer
              └── ...
```

Container bertanggung jawab atas:

- membuat consumer,
- menjalankan poll loop,
- memanggil listener method,
- mengelola commit offset,
- menjalankan error handler,
- publish ke DLT bila dikonfigurasi,
- pause/resume,
- lifecycle start/stop,
- concurrency.

Jadi saat membaca konfigurasi Spring Kafka, selalu tanyakan:

> Ini mempengaruhi Kafka client, container, listener method, atau error recovery topology?

---

## 3. Spring Kafka Abstraction Model

### 3.1 Komponen Producer

Komponen utama producer di Spring Kafka:

```text
ProducerFactory
  └── creates KafkaProducer instances

KafkaTemplate
  └── convenience API to send records

ProducerListener
  └── observe success/failure of sends

TransactionManager
  └── optional transactional producer coordination
```

Di Spring Boot, banyak bean ini bisa auto-configured dari `application.yml`.

Contoh konfigurasi minimal:

```yaml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
```

Tetapi production-ready producer membutuhkan lebih dari itu.

### 3.2 Komponen Consumer

Komponen utama consumer:

```text
ConsumerFactory
  └── creates KafkaConsumer instances

ConcurrentKafkaListenerContainerFactory
  └── creates listener containers

ConcurrentMessageListenerContainer
  └── manages one or more KafkaMessageListenerContainer

ErrorHandler / CommonErrorHandler
  └── handles listener failure

DeadLetterPublishingRecoverer
  └── publishes failed records to dead-letter topic
```

Dengan annotation:

```java
@KafkaListener(topics = "case-events", groupId = "case-projection")
public void handle(CaseEvent event) {
    // business logic
}
```

Spring membuat endpoint dan menghubungkannya ke container factory.

### 3.3 Boot Auto-Configuration: Berguna, Tapi Harus Disadari

Spring Boot akan membaca property seperti:

```yaml
spring:
  kafka:
    consumer:
      group-id: case-projection
      auto-offset-reset: earliest
      enable-auto-commit: false
```

Lalu membuat bean default.

Masalah umum:

> Engineer menganggap karena aplikasi berjalan, maka konfigurasi semantics sudah benar.

Tidak selalu.

Default bisa cocok untuk development, tetapi belum tentu cocok untuk:

- idempotent projection,
- payment/event settlement,
- SLA escalation,
- regulatory audit,
- retry/DLQ governance,
- high-throughput consumer,
- schema evolution.

---

## 4. Producer Dengan KafkaTemplate

### 4.1 Basic Send

Contoh producer service:

```java
@Service
public class CaseEventProducer {

    private final KafkaTemplate<String, CaseEvent> kafkaTemplate;

    public CaseEventProducer(KafkaTemplate<String, CaseEvent> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public CompletableFuture<SendResult<String, CaseEvent>> publish(CaseEvent event) {
        String topic = "case.lifecycle.events.v1";
        String key = event.caseId();

        return kafkaTemplate.send(topic, key, event);
    }
}
```

Hal penting:

- `key = event.caseId()` menjaga semua event satu case masuk partition yang sama.
- `send()` asynchronous.
- Future harus diobservasi.

### 4.2 Jangan Fire-and-Forget Tanpa Observability

Anti-pattern:

```java
kafkaTemplate.send("case-events", event.caseId(), event);
return ResponseEntity.accepted().build();
```

Masalah:

- send bisa gagal setelah method return;
- event mungkin tidak pernah terkirim;
- caller mendapat response sukses palsu;
- tidak ada metric failure;
- tidak ada retry domain-level;
- tidak ada audit trail.

Lebih aman:

```java
public CompletableFuture<Void> publish(CaseEvent event) {
    return kafkaTemplate
            .send("case.lifecycle.events.v1", event.caseId(), event)
            .thenAccept(result -> {
                RecordMetadata metadata = result.getRecordMetadata();
                log.info(
                    "Published case event eventId={} topic={} partition={} offset={}",
                    event.eventId(),
                    metadata.topic(),
                    metadata.partition(),
                    metadata.offset()
                );
            })
            .exceptionally(ex -> {
                log.error("Failed to publish case event eventId={}", event.eventId(), ex);
                throw new EventPublishException(event.eventId(), ex);
            });
}
```

### 4.3 Producer Send Result Bukan Business Commit

Kafka ack berarti broker menerima record sesuai konfigurasi producer.

Kafka ack tidak berarti:

- consumer sudah memproses event;
- database downstream sudah update;
- workflow sudah selesai;
- user notification terkirim;
- event tidak akan pernah duplicate;
- event pasti valid secara domain.

Kafka ack adalah transport/storage acknowledgement.

### 4.4 Production Producer Configuration Baseline

Contoh baseline:

```yaml
spring:
  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 2147483647
      properties:
        enable.idempotence: true
        max.in.flight.requests.per.connection: 5
        delivery.timeout.ms: 120000
        request.timeout.ms: 30000
        linger.ms: 10
        batch.size: 32768
        compression.type: zstd
```

Catatan:

- `acks=all` berarti leader menunggu ISR sesuai `min.insync.replicas`.
- `enable.idempotence=true` mengurangi duplicate akibat retry producer.
- `retries` tinggi aman bila idempotence aktif, tetapi tetap harus dipahami dengan timeout.
- `delivery.timeout.ms` adalah batas total attempt send.
- `linger.ms` dan `batch.size` adalah latency-throughput trade-off.
- Compression menurunkan network/disk, tapi menaikkan CPU.

Untuk event critical seperti enforcement/case lifecycle, baseline ini jauh lebih masuk akal daripada `acks=1` fire-and-forget.

### 4.5 Header Untuk Observability dan Causality

Spring Kafka memungkinkan header.

```java
public CompletableFuture<SendResult<String, CaseEvent>> publish(CaseEvent event) {
    ProducerRecord<String, CaseEvent> record = new ProducerRecord<>(
            "case.lifecycle.events.v1",
            event.caseId(),
            event
    );

    record.headers().add("event-id", event.eventId().getBytes(StandardCharsets.UTF_8));
    record.headers().add("correlation-id", event.correlationId().getBytes(StandardCharsets.UTF_8));
    record.headers().add("causation-id", event.causationId().getBytes(StandardCharsets.UTF_8));
    record.headers().add("event-type", "CaseEscalated".getBytes(StandardCharsets.UTF_8));

    return kafkaTemplate.send(record);
}
```

Header cocok untuk metadata teknis:

- correlation id,
- causation id,
- trace id,
- schema id,
- tenant id,
- event type,
- producer service,
- originating command id.

Payload cocok untuk fakta domain.

Jangan menyembunyikan field domain penting hanya di header.

---

## 5. Consumer Dengan @KafkaListener

### 5.1 Basic Listener

```java
@Component
public class CaseProjectionListener {

    private final CaseProjectionService projectionService;

    public CaseProjectionListener(CaseProjectionService projectionService) {
        this.projectionService = projectionService;
    }

    @KafkaListener(
        topics = "case.lifecycle.events.v1",
        groupId = "case-projection-service"
    )
    public void handle(CaseEvent event) {
        projectionService.apply(event);
    }
}
```

Ini bagus untuk awal, tetapi belum cukup untuk production semantics.

### 5.2 Listener Dengan Metadata

Sering kali consumer perlu metadata record:

```java
@KafkaListener(topics = "case.lifecycle.events.v1", groupId = "case-projection-service")
public void handle(
        CaseEvent event,
        @Header(KafkaHeaders.RECEIVED_TOPIC) String topic,
        @Header(KafkaHeaders.RECEIVED_PARTITION) int partition,
        @Header(KafkaHeaders.OFFSET) long offset,
        @Header(name = "correlation-id", required = false) byte[] correlationId
) {
    log.info(
        "Consuming eventId={} topic={} partition={} offset={}",
        event.eventId(), topic, partition, offset
    );

    projectionService.apply(event);
}
```

Metadata penting untuk:

- debugging,
- replay,
- DLQ analysis,
- audit,
- traceability,
- incident response.

### 5.3 Listener Dengan ConsumerRecord

Untuk kontrol penuh:

```java
@KafkaListener(topics = "case.lifecycle.events.v1", groupId = "case-projection-service")
public void handle(ConsumerRecord<String, CaseEvent> record) {
    String key = record.key();
    CaseEvent event = record.value();

    log.info(
        "Received key={} eventId={} partition={} offset={}",
        key,
        event.eventId(),
        record.partition(),
        record.offset()
    );

    projectionService.apply(event);
}
```

Gunakan `ConsumerRecord` saat kamu butuh:

- key,
- partition,
- offset,
- timestamp,
- headers,
- raw metadata.

---

## 6. Offset Commit dan Ack Mode

### 6.1 Kafka Offset Refresh

Ingat dari Part 006:

```text
position offset    = offset berikutnya yang akan dibaca consumer
committed offset   = offset terakhir yang disimpan sebagai progress group
processed offset   = offset yang benar-benar selesai diproses aplikasi
```

Bug Kafka consumer sering terjadi karena tiga posisi ini dianggap sama.

### 6.2 Auto Commit Sebaiknya Dimatikan Untuk Consumer Serius

Baseline:

```yaml
spring:
  kafka:
    consumer:
      enable-auto-commit: false
```

Mengapa?

Karena auto commit bisa commit berdasarkan interval, bukan berdasarkan keberhasilan business processing.

Risiko:

```text
poll record
  -> auto commit terjadi
  -> business processing gagal
  -> consumer restart
  -> record tidak dibaca ulang
  -> data loss secara aplikasi
```

Kafka tidak kehilangan record, tetapi consumer group sudah melewati offset itu.

### 6.3 Ack Mode Spring Kafka

Spring listener container punya ack mode yang menentukan kapan offset di-commit.

Secara konseptual:

| Ack Mode | Mental Model | Cocok Untuk | Risiko |
|---|---|---|---|
| `RECORD` | commit setelah tiap record diproses | correctness lebih penting dari throughput | commit lebih sering |
| `BATCH` | commit setelah batch hasil poll selesai | throughput lebih baik | duplicate batch lebih besar saat crash |
| `TIME` | commit periodik berdasarkan waktu | workload toleran duplicate/loss risk tertentu | semantics kurang eksplisit |
| `COUNT` | commit setelah N record | throughput tuning | failure window lebih besar |
| `MANUAL` | listener memanggil ack | kontrol aplikasi | developer harus disiplin |
| `MANUAL_IMMEDIATE` | ack segera commit | kontrol kuat | overhead lebih tinggi |

Konfigurasi contoh:

```java
@Bean
ConcurrentKafkaListenerContainerFactory<String, CaseEvent> kafkaListenerContainerFactory(
        ConsumerFactory<String, CaseEvent> consumerFactory,
        CommonErrorHandler errorHandler
) {
    var factory = new ConcurrentKafkaListenerContainerFactory<String, CaseEvent>();
    factory.setConsumerFactory(consumerFactory);
    factory.setCommonErrorHandler(errorHandler);
    factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.RECORD);
    return factory;
}
```

### 6.4 Manual Ack Pattern

```java
@KafkaListener(
    topics = "case.lifecycle.events.v1",
    groupId = "case-projection-service",
    containerFactory = "manualAckKafkaListenerContainerFactory"
)
public void handle(ConsumerRecord<String, CaseEvent> record, Acknowledgment ack) {
    projectionService.apply(record.value());
    ack.acknowledge();
}
```

Semantics:

```text
business processing sukses -> acknowledge -> offset commit eligible
business processing gagal  -> no acknowledge -> record akan diretry / error handler
```

Tetapi hati-hati:

- `ack.acknowledge()` bukan database transaction.
- commit bisa gagal setelah business processing sukses.
- duplicate tetap mungkin.
- handler harus idempotent.

### 6.5 Commit Setelah Side Effect

Untuk at-least-once processing:

```text
consume event
  -> validate
  -> apply idempotent side effect
  -> commit offset
```

Jika crash setelah side effect sebelum commit:

```text
side effect sudah terjadi
offset belum commit
record akan diproses ulang
```

Karena itu side effect harus idempotent.

### 6.6 Commit Sebelum Side Effect Adalah At-Most-Once

```text
consume event
  -> commit offset
  -> apply side effect
```

Jika crash setelah commit sebelum side effect:

```text
offset sudah maju
side effect belum terjadi
record tidak diproses ulang
```

Ini data loss di level aplikasi.

Gunakan hanya bila kehilangan event dapat diterima. Untuk case management/regulatory workflow, biasanya tidak bisa diterima.

---

## 7. Error Handling

### 7.1 Jenis Error Consumer

Error consumer bisa berasal dari beberapa lapisan:

1. Deserialization error.
2. Schema incompatibility.
3. Validation error.
4. Business rule error.
5. Transient dependency error.
6. Permanent dependency error.
7. Database unique constraint conflict.
8. Timeout.
9. Poison event.
10. Programming bug.

Tidak semua error harus diperlakukan sama.

### 7.2 Error Classification

Gunakan klasifikasi:

| Error | Contoh | Retry? | DLQ? | Catatan |
|---|---|---:|---:|---|
| Transient infrastructure | DB timeout, HTTP 503 | Ya | Setelah limit | Retry dengan backoff |
| Permanent validation | missing required business field | Tidak | Ya | Butuh producer/schema fix |
| Duplicate event | idempotency conflict | Tidak sebagai error | Tidak | Treat as success |
| Schema incompatible | deserialization fail | Tidak/terbatas | Ya | Bisa stuck sebelum listener |
| Programming bug | NullPointerException | Terbatas | Ya/stop | Jangan infinite retry |
| Downstream throttling | rate limit | Ya | Mungkin | Pertimbangkan pause/backpressure |

### 7.3 Default Error Handler

Contoh blocking retry + recover to DLT:

```java
@Bean
CommonErrorHandler kafkaErrorHandler(KafkaTemplate<String, Object> kafkaTemplate) {
    DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(
            kafkaTemplate,
            (record, exception) -> new TopicPartition(record.topic() + ".DLT", record.partition())
    );

    FixedBackOff backOff = new FixedBackOff(1_000L, 3L);

    DefaultErrorHandler errorHandler = new DefaultErrorHandler(recoverer, backOff);

    errorHandler.addNotRetryableExceptions(
            IllegalArgumentException.class,
            NonRetryableBusinessException.class
    );

    return errorHandler;
}
```

Semantics:

```text
listener throws exception
  -> retry same record with backoff
  -> if retries exhausted, publish to DLT
  -> commit/recover based on container semantics
```

### 7.4 Blocking Retry

Blocking retry berarti consumer thread menunggu retry untuk record yang gagal.

Keuntungan:

- ordering partition lebih mudah dijaga;
- implementation sederhana;
- cocok untuk transient error singkat.

Kerugian:

- satu poison record bisa menahan partition;
- lag bisa naik;
- throughput turun;
- rebalance bisa terjadi bila processing melewati `max.poll.interval.ms`.

Cocok untuk:

- dependency glitch singkat,
- retry 1–3 kali,
- backoff pendek,
- event ordering critical.

Tidak cocok untuk:

- retry menit/jam,
- downstream outage panjang,
- high-throughput topic,
- mixed workload dengan banyak tenant.

### 7.5 Non-Blocking Retry / Retry Topic

Spring Kafka mendukung pattern retry topic melalui `@RetryableTopic` atau konfigurasi programmatic.

Mental model:

```text
main topic
  -> listener gagal
  -> publish ke retry topic delay-1
  -> listener retry gagal
  -> publish ke retry topic delay-2
  -> gagal lagi
  -> publish ke DLT
```

Contoh:

```java
@RetryableTopic(
    attempts = "4",
    backoff = @Backoff(delay = 1_000, multiplier = 2.0),
    dltTopicSuffix = ".DLT"
)
@KafkaListener(topics = "case.lifecycle.events.v1", groupId = "case-projection-service")
public void handle(CaseEvent event) {
    projectionService.apply(event);
}
```

Keuntungan:

- main consumer tidak stuck lama;
- retry delay panjang lebih realistis;
- lag main topic lebih terkendali;
- retry workload terlihat eksplisit lewat topic.

Kerugian:

- ordering bisa berubah;
- topology topic bertambah;
- governance retry topic diperlukan;
- observability lebih kompleks;
- event bisa diproses lebih lambat dan keluar dari urutan semula.

### 7.6 Ordering vs Retry Topic

Misal partition berisi event untuk case yang sama:

```text
offset 10: CaseSubmitted(case-1)
offset 11: CaseAssigned(case-1)
offset 12: CaseEscalated(case-1)
```

Jika offset 11 gagal lalu dipindah ke retry topic, offset 12 bisa diproses lebih dulu.

Akibat:

```text
projection melihat CaseEscalated sebelum CaseAssigned
```

Untuk workflow yang ordering-sensitive, retry topic perlu hati-hati.

Alternatif:

1. Blocking retry singkat lalu stop/alert.
2. Per-key sequencing guard di projection.
3. State machine yang menolak transition invalid dan menunggu missing predecessor.
4. Retry topic per ordering domain, walau kompleks.
5. Idempotent and commutative projection bila memungkinkan.

### 7.7 DLQ Bukan Tempat Sampah

DLQ harus menjadi **operational quarantine**, bukan kuburan event.

DLQ record harus menyimpan:

- original topic,
- original partition,
- original offset,
- original key,
- original timestamp,
- exception class,
- exception message,
- stack trace terbatas,
- consumer group,
- listener name,
- failure time,
- retry attempts,
- correlation id,
- event id,
- schema id bila ada.

DLQ harus punya:

- owner,
- alert,
- dashboard,
- triage process,
- replay tool,
- retention policy,
- access control.

Anti-pattern:

```text
error -> send to DLT -> forget
```

Itu bukan reliability. Itu delayed data loss.

---

## 8. Deserialization Error

### 8.1 Kenapa Deserialization Error Berbahaya

Jika value tidak bisa dideserialize, listener method mungkin tidak pernah dipanggil.

Artinya error tidak muncul di business code:

```java
@KafkaListener(...)
public void handle(CaseEvent event) {
    // Tidak pernah sampai sini jika deserialization gagal
}
```

Penyebab:

- incompatible schema,
- wrong serializer,
- corrupt payload,
- producer mengirim format salah,
- class/package mismatch untuk JSON,
- trusted packages salah,
- schema registry unavailable.

### 8.2 ErrorHandlingDeserializer

Spring Kafka menyediakan `ErrorHandlingDeserializer` untuk menangkap deserialization failure dan membawa error ke error handler.

Contoh konfigurasi JSON:

```yaml
spring:
  kafka:
    consumer:
      key-deserializer: org.springframework.kafka.support.serializer.ErrorHandlingDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.ErrorHandlingDeserializer
      properties:
        spring.deserializer.key.delegate.class: org.apache.kafka.common.serialization.StringDeserializer
        spring.deserializer.value.delegate.class: org.springframework.kafka.support.serializer.JsonDeserializer
        spring.json.value.default.type: com.example.caseevents.CaseEvent
        spring.json.trusted.packages: com.example.caseevents
```

Namun untuk production enterprise, lebih disarankan memakai schema-based serialization seperti Avro/Protobuf/JSON Schema dengan Schema Registry, sebagaimana Part 010.

---

## 9. Concurrency dan Partition Assignment

### 9.1 Listener Concurrency

Spring Kafka:

```java
factory.setConcurrency(4);
```

Atau:

```yaml
spring:
  kafka:
    listener:
      concurrency: 4
```

Mental model:

```text
concurrency = jumlah KafkaConsumer instances dalam container group untuk listener tersebut
```

Jika topic punya 12 partitions dan concurrency 4:

```text
consumer instance 1 -> 3 partitions
consumer instance 2 -> 3 partitions
consumer instance 3 -> 3 partitions
consumer instance 4 -> 3 partitions
```

Jika topic punya 3 partitions dan concurrency 10:

```text
3 consumer aktif
7 consumer idle
```

Concurrency tidak bisa melebihi partition parallelism.

### 9.2 Concurrency dan Ordering

Kafka menjaga ordering hanya dalam partition.

Jika semua event dengan key sama masuk partition sama, consumer concurrency tidak merusak ordering key tersebut karena satu partition hanya dimiliki satu consumer dalam group pada satu waktu.

Tetapi ordering bisa rusak bila:

- key salah;
- producer mengirim null key;
- retry topic dipakai;
- consumer memproses async paralel di dalam listener;
- offset di-ack sebelum async work selesai;
- partition count dinaikkan dan key mapping berubah untuk event baru.

### 9.3 Jangan Async Tanpa Offset Discipline

Anti-pattern:

```java
@KafkaListener(topics = "case-events")
public void handle(CaseEvent event) {
    CompletableFuture.runAsync(() -> projectionService.apply(event));
}
```

Listener method return sebelum processing selesai.

Akibat:

- container menganggap record selesai;
- offset bisa di-commit;
- async task bisa gagal diam-diam;
- data loss aplikasi;
- ordering rusak.

Jika butuh parallelism, pilih salah satu:

1. Tambah partition dan consumer concurrency.
2. Gunakan partition-aware worker queue dengan ack setelah work selesai.
3. Gunakan Kafka Streams.
4. Gunakan Parallel Consumer library dengan semantics yang jelas.
5. Gunakan retry/work topic terpisah.

---

## 10. Backpressure Dalam Spring Kafka

### 10.1 Backpressure Bukan Sekadar “Retry”

Backpressure berarti consumer mengatur laju konsumsi agar downstream tidak runtuh.

Sumber pressure:

- database lambat,
- external API rate limit,
- CPU penuh,
- thread pool penuh,
- lock contention,
- schema registry lambat,
- large payload,
- GC pressure.

### 10.2 Control Knobs

Kafka/Spring knobs:

```yaml
spring:
  kafka:
    consumer:
      max-poll-records: 100
      fetch-min-size: 1
      fetch-max-wait: 500ms
      properties:
        max.partition.fetch.bytes: 1048576
        max.poll.interval.ms: 300000
```

Application knobs:

- database connection pool size,
- listener concurrency,
- batch size,
- retry backoff,
- circuit breaker,
- pause/resume,
- rate limiter.

### 10.3 Pause/Resume

Spring container bisa pause/resume consumer.

Conceptual use:

```java
@Component
public class KafkaBackpressureController {

    private final KafkaListenerEndpointRegistry registry;

    public KafkaBackpressureController(KafkaListenerEndpointRegistry registry) {
        this.registry = registry;
    }

    public void pause(String listenerId) {
        MessageListenerContainer container = registry.getListenerContainer(listenerId);
        if (container != null) {
            container.pause();
        }
    }

    public void resume(String listenerId) {
        MessageListenerContainer container = registry.getListenerContainer(listenerId);
        if (container != null) {
            container.resume();
        }
    }
}
```

Listener id:

```java
@KafkaListener(
    id = "case-projection-listener",
    topics = "case.lifecycle.events.v1",
    groupId = "case-projection-service"
)
public void handle(CaseEvent event) {
    projectionService.apply(event);
}
```

Caution:

- pause terlalu lama bisa membuat lag naik;
- pause tidak menyelesaikan root cause;
- perlu metric dan alert;
- jangan manual pause tanpa operational runbook.

---

## 11. Transactions Dengan Spring Kafka

### 11.1 Kafka Transaction Boundary

Kafka transaction bisa atomically:

```text
consume from Kafka topic A
produce to Kafka topic B
commit consumed offsets
```

Dalam Kafka boundary.

Kafka transaction tidak otomatis membuat write ke external database atomic dengan Kafka offset commit.

### 11.2 Spring Kafka Transaction Producer

Konfigurasi producer transaction:

```yaml
spring:
  kafka:
    producer:
      transaction-id-prefix: case-service-tx-
```

Producer transactional bisa digunakan dengan `KafkaTransactionManager`.

Contoh konseptual:

```java
@Transactional
public void processAndPublish(CaseEvent input) {
    CaseDecision decision = decisionService.decide(input);
    kafkaTemplate.send("case.decisions.v1", decision.caseId(), decision);
}
```

Tetapi hati-hati: `@Transactional` default biasanya mengacu ke database transaction manager, bukan Kafka transaction manager, kecuali kamu konfigurasikan transaction manager dengan jelas.

### 11.3 Database + Kafka Transaction Problem

Kasus umum:

```text
HTTP command
  -> update database
  -> publish Kafka event
```

Jika DB commit sukses tetapi publish Kafka gagal:

```text
database berubah
event tidak keluar
```

Jika Kafka publish sukses tetapi DB commit gagal:

```text
event keluar
state database tidak sesuai
```

Solusi umum untuk sistem serius:

```text
Transactional Outbox
```

Flow:

```text
single DB transaction:
  -> update aggregate/case
  -> insert outbox_event row

separate relay / Debezium:
  -> read outbox_event
  -> publish to Kafka
```

Part 016 sudah membahas ini. Dalam Spring Boot, outbox lebih defensible daripada mencoba “dual transaction” DB+Kafka secara manual.

### 11.4 Consumer DB Write + Offset Commit

Kasus:

```text
consume Kafka event
  -> write projection to DB
  -> commit offset
```

Tidak ada atomic transaction natural antara DB commit dan Kafka offset commit.

Maka gunakan:

1. idempotency table,
2. unique event id,
3. processed_event table,
4. natural idempotency,
5. versioned aggregate projection,
6. retry-safe transaction.

Contoh:

```sql
CREATE TABLE processed_event (
    consumer_name varchar(200) NOT NULL,
    event_id varchar(100) NOT NULL,
    processed_at timestamp NOT NULL,
    PRIMARY KEY (consumer_name, event_id)
);
```

Pseudo-code:

```java
@Transactional
public void apply(CaseEvent event) {
    if (processedEventRepository.exists("case-projection-service", event.eventId())) {
        return;
    }

    projectionRepository.apply(event);
    processedEventRepository.insert("case-projection-service", event.eventId());
}
```

Jika duplicate datang, treat as success. Listener boleh ack.

---

## 12. Idempotent Consumer Pattern di Spring Boot

### 12.1 Idempotency Berdasarkan Event ID

Event harus punya stable unique id:

```java
public record CaseEscalatedEvent(
        String eventId,
        String caseId,
        String escalationId,
        String reason,
        Instant occurredAt,
        String correlationId,
        String causationId
) {}
```

Consumer:

```java
@Component
public class CaseProjectionListener {

    private final CaseProjectionService service;

    @KafkaListener(
        topics = "case.lifecycle.events.v1",
        groupId = "case-projection-service",
        containerFactory = "manualAckKafkaListenerContainerFactory"
    )
    public void handle(ConsumerRecord<String, CaseEscalatedEvent> record, Acknowledgment ack) {
        service.apply(record.value());
        ack.acknowledge();
    }
}
```

Service:

```java
@Service
public class CaseProjectionService {

    private final ProcessedEventRepository processedEvents;
    private final CaseProjectionRepository projections;

    @Transactional
    public void apply(CaseEscalatedEvent event) {
        boolean firstTime = processedEvents.tryInsert(
                "case-projection-service",
                event.eventId()
        );

        if (!firstTime) {
            return;
        }

        projections.markEscalated(
                event.caseId(),
                event.escalationId(),
                event.reason(),
                event.occurredAt()
        );
    }
}
```

Repository idea:

```java
public boolean tryInsert(String consumerName, String eventId) {
    try {
        jdbcTemplate.update(
            """
            INSERT INTO processed_event(consumer_name, event_id, processed_at)
            VALUES (?, ?, ?)
            """,
            consumerName,
            eventId,
            Instant.now()
        );
        return true;
    } catch (DuplicateKeyException duplicate) {
        return false;
    }
}
```

### 12.2 Jangan Simpan Offset Sebagai Idempotency Key Utama

Offset unik hanya dalam topic-partition.

`event_id` lebih baik karena:

- stabil lintas replay,
- stabil lintas retry topic,
- stabil lintas republish,
- domain-level identity,
- bisa dilacak di DLQ,
- bisa dipakai lintas consumer.

Offset berguna untuk observability, bukan identity bisnis.

---

## 13. Batch Listener

### 13.1 Kapan Batch Cocok

Batch listener cocok untuk:

- high throughput projection,
- bulk insert,
- analytics ingestion,
- search indexing,
- sink-like consumer,
- operasi yang efisien dalam batch.

Contoh:

```java
@KafkaListener(topics = "case.lifecycle.events.v1", groupId = "case-search-indexer")
public void handle(List<ConsumerRecord<String, CaseEvent>> records) {
    searchIndexer.index(records.stream().map(ConsumerRecord::value).toList());
}
```

Konfigurasi:

```java
factory.setBatchListener(true);
factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.BATCH);
```

### 13.2 Batch Failure Semantics

Jika satu record dalam batch gagal, pertanyaan:

1. Apakah seluruh batch gagal?
2. Apakah record sukses harus diulang?
3. Apakah partial commit boleh?
4. Bagaimana DLQ untuk satu record?
5. Apakah ordering harus dijaga?

Batch lebih cepat, tetapi failure semantics lebih rumit.

Untuk workflow critical, mulai dari record listener lebih aman. Optimasi ke batch setelah invariants jelas.

---

## 14. Schema dan Serialization di Spring Boot

### 14.1 JSON Serializer Untuk Development

Spring JSON serializer mudah:

```yaml
spring:
  kafka:
    producer:
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
    consumer:
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: com.example.events
```

Kelebihan:

- cepat untuk bootstrap;
- mudah dibaca;
- cocok untuk internal prototype.

Kekurangan:

- schema governance lemah;
- compatibility tidak otomatis;
- type header bisa bermasalah antar service/language;
- refactor package Java bisa merusak consumer;
- payload lebih besar.

### 14.2 Avro/Protobuf Dengan Schema Registry

Untuk production multi-team, lebih baik:

- Avro,
- Protobuf,
- JSON Schema,
- Schema Registry.

Spring Boot tetap bisa memakai serializer/deserializer Confluent atau library lain.

Contoh konseptual:

```yaml
spring:
  kafka:
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: io.confluent.kafka.serializers.KafkaAvroSerializer
      properties:
        schema.registry.url: ${SCHEMA_REGISTRY_URL}
    consumer:
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: io.confluent.kafka.serializers.KafkaAvroDeserializer
      properties:
        schema.registry.url: ${SCHEMA_REGISTRY_URL}
        specific.avro.reader: true
```

Kuncinya bukan tool-nya saja. Kuncinya governance:

- compatibility mode,
- subject naming strategy,
- schema review,
- event versioning,
- contract test,
- owner per event.

---

## 15. Spring Boot Configuration Baseline

### 15.1 application.yml Baseline

Contoh baseline realistis:

```yaml
spring:
  application:
    name: case-projection-service

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}

    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 2147483647
      properties:
        enable.idempotence: true
        linger.ms: 10
        batch.size: 32768
        compression.type: zstd
        delivery.timeout.ms: 120000
        request.timeout.ms: 30000

    consumer:
      group-id: case-projection-service
      enable-auto-commit: false
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.ErrorHandlingDeserializer
      properties:
        spring.deserializer.value.delegate.class: org.springframework.kafka.support.serializer.JsonDeserializer
        spring.json.trusted.packages: com.example.caseevents
        max.poll.records: 100
        max.poll.interval.ms: 300000
        session.timeout.ms: 45000
        heartbeat.interval.ms: 15000

    listener:
      ack-mode: record
      concurrency: 3
      missing-topics-fatal: true

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  metrics:
    tags:
      application: ${spring.application.name}
```

### 15.2 Jangan Copy-Paste Baseline Tanpa Menjawab Ini

Sebelum production, jawab:

1. Apa event key?
2. Apa ordering domain?
3. Berapa partition topic?
4. Berapa concurrency consumer?
5. Apa ack mode?
6. Apa retry strategy?
7. Apa DLQ topic dan owner?
8. Apakah consumer idempotent?
9. Bagaimana schema compatibility dijaga?
10. Bagaimana lag dimonitor?
11. Bagaimana replay dilakukan?
12. Bagaimana graceful shutdown diuji?
13. Apa yang terjadi jika DB down 30 menit?
14. Apa yang terjadi jika poison event masuk?
15. Apa yang terjadi saat rolling deploy?

---

## 16. Observability

### 16.1 Log Yang Harus Ada

Untuk producer sukses:

```text
Published eventId=... eventType=... topic=... partition=... offset=... correlationId=...
```

Untuk consumer receive:

```text
Received eventId=... topic=... partition=... offset=... key=... group=...
```

Untuk consumer success:

```text
Processed eventId=... durationMs=... idempotency=first|duplicate
```

Untuk failure:

```text
Failed eventId=... exception=... retryable=true attempt=... topic=... partition=... offset=...
```

Untuk DLQ:

```text
PublishedToDLT originalTopic=... originalPartition=... originalOffset=... dltTopic=... reason=...
```

### 16.2 Metrics

Minimal metrics:

Producer:

- send rate,
- send latency,
- error rate,
- retry rate,
- record size,
- batch size,
- buffer available bytes.

Consumer:

- records consumed rate,
- processing latency,
- commit latency,
- consumer lag,
- rebalance count,
- error count,
- DLT count,
- retry count,
- duplicate/idempotent skip count.

Spring/Micrometer:

- listener processing timer,
- error handler counter,
- DLT publishing counter,
- database latency,
- thread pool saturation.

### 16.3 Tracing

Propagate:

- `traceparent`,
- correlation id,
- causation id,
- event id.

Jangan hanya trace HTTP boundary. Kafka event adalah asynchronous boundary yang juga harus punya trace semantics.

---

## 17. Graceful Shutdown

### 17.1 Kenapa Penting

Saat deploy rolling restart:

```text
container receives stop
  -> consumer leaves group
  -> rebalance
  -> partitions assigned elsewhere
```

Jika shutdown tidak graceful:

- processing bisa terputus;
- offset belum commit;
- duplicate naik;
- rebalance storm;
- partial side effect.

### 17.2 Design Principle

Saat shutdown:

1. Stop menerima record baru.
2. Selesaikan record yang sedang diproses.
3. Commit offset setelah sukses.
4. Release resource.
5. Leave group bersih.

Spring container membantu, tetapi business logic harus:

- tidak spawn async orphan task;
- respect timeout;
- tidak block tanpa batas;
- punya timeout ke DB/API;
- idempotent terhadap duplicate setelah restart.

---

## 18. Testing Spring Kafka

### 18.1 Testing Pyramid

Untuk Spring Kafka aplikasi:

```text
Unit test
  -> event mapping, idempotency logic, state transition

Slice/integration test
  -> listener + DB + Kafka container

Contract test
  -> schema compatibility, event examples

End-to-end test
  -> producer service -> Kafka -> consumer service

Chaos/failure test
  -> duplicate, poison, rebalance, dependency down
```

### 18.2 Unit Test Listener Logic

Jangan membuat semua test butuh Kafka.

Business service:

```java
@Test
void duplicateEventShouldBeIgnored() {
    CaseEscalatedEvent event = fixture.caseEscalated("event-1", "case-1");

    service.apply(event);
    service.apply(event);

    assertThat(projectionRepository.find("case-1").status()).isEqualTo("ESCALATED");
    assertThat(processedEventRepository.count()).isEqualTo(1);
}
```

### 18.3 Embedded Kafka

Spring Kafka menyediakan test support untuk Embedded Kafka.

Cocok untuk:

- test cepat,
- listener wiring,
- simple produce-consume,
- tidak perlu external services kompleks.

Keterbatasan:

- tidak selalu identik dengan production deployment;
- kurang cocok untuk multi-service integration;
- kurang cocok bila butuh Schema Registry, Connect, atau realistic broker config.

### 18.4 Testcontainers Kafka

Testcontainers lebih cocok untuk integration test realistis:

- Kafka broker container,
- database container,
- Schema Registry container bila perlu,
- service dependency container.

Contoh konseptual:

```java
@Testcontainers
@SpringBootTest
class CaseProjectionKafkaIT {

    @Container
    static KafkaContainer kafka = new KafkaContainer(
            DockerImageName.parse("apache/kafka-native:latest")
    );

    @DynamicPropertySource
    static void kafkaProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
    }

    @Autowired
    KafkaTemplate<String, CaseEvent> kafkaTemplate;

    @Autowired
    CaseProjectionRepository projections;

    @Test
    void shouldProjectCaseEscalatedEvent() {
        CaseEvent event = Fixtures.caseEscalated("event-1", "case-1");

        kafkaTemplate.send("case.lifecycle.events.v1", event.caseId(), event);

        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
            assertThat(projections.find("case-1").status()).isEqualTo("ESCALATED");
        });
    }
}
```

Catatan:

- Gunakan Awaitility untuk async assertion.
- Jangan `Thread.sleep()` fixed.
- Buat topic secara eksplisit.
- Bersihkan state antar test.
- Test duplicate event.
- Test poison event.
- Test DLQ publish.

### 18.5 Test Yang Wajib Ada Untuk Consumer Serius

Minimal:

1. Valid event diproses.
2. Duplicate event di-ignore sebagai success.
3. Business validation failure masuk DLQ.
4. Transient failure diretry.
5. Retry exhausted masuk DLQ.
6. Deserialization error tidak membuat consumer stuck diam-diam.
7. Consumer restart setelah DB commit sebelum offset commit tidak merusak projection.
8. Ordering per key dijaga.
9. Graceful shutdown tidak kehilangan in-flight record.
10. Schema evolution backward-compatible.

---

## 19. Common Abstraction Leaks

### 19.1 “@KafkaListener Berarti Satu Thread”

Salah. Listener bisa punya concurrency. Satu listener annotation bisa menghasilkan banyak consumer.

### 19.2 “Concurrency 10 Berarti 10x Throughput”

Belum tentu. Parallelism dibatasi partition count, downstream capacity, serialization cost, dan DB/API bottleneck.

### 19.3 “Ack Manual Berarti Exactly Once”

Salah. Manual ack hanya memberi kontrol kapan offset commit. Duplicate tetap mungkin.

### 19.4 “DLQ Menyelesaikan Error”

Salah. DLQ hanya memindahkan error ke tempat lain. Tanpa triage dan replay, DLQ adalah data loss tertunda.

### 19.5 “Retry Topic Selalu Lebih Baik”

Salah. Retry topic bisa merusak ordering dan menambah complexity.

### 19.6 “Spring Transaction Menyelesaikan DB + Kafka Atomicity”

Tidak otomatis. Perlu pahami transaction manager, Kafka transaction boundary, dan outbox pattern.

### 19.7 “JSON Lebih Simple Jadi Lebih Aman”

Untuk prototype mungkin. Untuk multi-team production, schema governance lebih penting daripada kemudahan awal.

### 19.8 “Consumer Lag Tinggi Berarti Consumer Lambat”

Mungkin, tetapi bisa juga:

- producer spike,
- partition skew,
- poison record,
- downstream outage,
- rebalance storm,
- retry blocking,
- deployment issue,
- fetch config buruk.

### 19.9 “Offset Adalah Event ID”

Salah. Offset posisi dalam partition, bukan identity domain.

### 19.10 “KafkaTemplate.send Sukses Berarti Event Diproses”

Salah. Itu hanya send ke Kafka sesuai ack producer.

---

## 20. Design Patterns Untuk Spring Boot Kafka

### 20.1 Command API + Transactional Outbox

Untuk inbound HTTP command:

```text
POST /cases/{id}/escalate
  -> validate command
  -> DB transaction:
       update case state
       insert outbox event
  -> return accepted/success
  -> outbox relay publishes Kafka event
```

Kelebihan:

- DB state dan event intent atomic;
- tidak ada dual-write langsung;
- replayable;
- audit-friendly.

### 20.2 Kafka Consumer + Idempotent Projection

```text
Kafka event
  -> listener
  -> DB transaction:
       insert processed_event(event_id)
       update projection
  -> ack offset
```

Duplicate menjadi harmless.

### 20.3 Validation + DLQ

```text
consume event
  -> validate schema/domain invariants
  -> if invalid permanent: DLQ
  -> if transient: retry
  -> if duplicate: success
```

### 20.4 Retry Policy By Error Type

```java
errorHandler.addNotRetryableExceptions(
    InvalidEventException.class,
    UnknownEventTypeException.class,
    NonRetryableBusinessException.class
);
```

Untuk transient:

- SQL transient exception,
- timeout,
- temporary unavailable,
- deadlock loser,
- optimistic lock retryable conflict.

### 20.5 Partition-Key-Aware Design

Producer:

```java
kafkaTemplate.send(topic, event.caseId(), event);
```

Consumer/projection:

```text
caseId is ordering domain
```

Jika workflow state machine case membutuhkan event urut, jangan pakai random key atau null key.

---

## 21. Production Readiness Checklist

### 21.1 Producer Checklist

- [ ] Topic eksplisit dan dikelola.
- [ ] Key dipilih berdasarkan ordering domain.
- [ ] `acks=all` untuk event critical.
- [ ] Idempotent producer aktif.
- [ ] Send result diobservasi.
- [ ] Failure send tidak silently ignored.
- [ ] Header correlation/causation/trace tersedia.
- [ ] Schema serializer production-grade.
- [ ] Metrics producer aktif.
- [ ] Timeout dan retry jelas.

### 21.2 Consumer Checklist

- [ ] Auto commit disabled.
- [ ] Ack mode dipilih sadar semantics.
- [ ] Listener id jelas.
- [ ] Consumer group name stabil dan meaningful.
- [ ] Idempotent processing.
- [ ] Error handler configured.
- [ ] Retry policy classified by exception.
- [ ] DLQ topic exists and monitored.
- [ ] Deserialization error handled.
- [ ] Concurrency <= useful partition parallelism.
- [ ] No unsafe async processing.
- [ ] Graceful shutdown tested.

### 21.3 DLQ Checklist

- [ ] DLQ punya owner.
- [ ] DLQ punya alert.
- [ ] DLQ punya dashboard.
- [ ] DLQ record membawa original topic/partition/offset.
- [ ] DLQ record membawa exception metadata.
- [ ] DLQ retention policy cukup.
- [ ] Replay procedure tersedia.
- [ ] Access control tersedia.

### 21.4 Test Checklist

- [ ] Valid event test.
- [ ] Duplicate event test.
- [ ] Poison event test.
- [ ] Retry exhausted test.
- [ ] DLQ test.
- [ ] Schema compatibility test.
- [ ] Rebalance/restart scenario test.
- [ ] Backpressure scenario test.

---

## 22. Mini Case Study: Case Escalation Projection Service

### 22.1 Problem

Kita punya event:

```text
CaseSubmitted
CaseAssigned
CaseEscalated
CaseResolved
```

Kita ingin membuat projection untuk UI case management.

### 22.2 Topic

```text
case.lifecycle.events.v1
```

Key:

```text
caseId
```

Consumer group:

```text
case-projection-service
```

### 22.3 Invariants

1. Semua event untuk case yang sama harus diproses berurutan.
2. Duplicate event tidak boleh membuat duplicate escalation.
3. Invalid transition harus masuk quarantine, bukan silently ignored.
4. Projection boleh eventually consistent.
5. Event harus bisa direplay untuk rebuild projection.

### 22.4 Listener

```java
@Component
public class CaseLifecycleListener {

    private final CaseProjectionService projectionService;

    public CaseLifecycleListener(CaseProjectionService projectionService) {
        this.projectionService = projectionService;
    }

    @KafkaListener(
        id = "case-projection-listener",
        topics = "case.lifecycle.events.v1",
        groupId = "case-projection-service",
        containerFactory = "caseKafkaListenerContainerFactory"
    )
    public void onMessage(ConsumerRecord<String, CaseLifecycleEvent> record, Acknowledgment ack) {
        projectionService.apply(record.key(), record.value(), record.headers());
        ack.acknowledge();
    }
}
```

### 22.5 Service

```java
@Service
public class CaseProjectionService {

    private final ProcessedEventRepository processedEvents;
    private final CaseProjectionRepository projections;

    @Transactional
    public void apply(String key, CaseLifecycleEvent event, Headers headers) {
        if (!key.equals(event.caseId())) {
            throw new InvalidEventException("Record key must match event.caseId");
        }

        boolean firstProcessing = processedEvents.tryInsert(
                "case-projection-service",
                event.eventId()
        );

        if (!firstProcessing) {
            return;
        }

        switch (event) {
            case CaseSubmitted submitted -> projections.create(submitted);
            case CaseAssigned assigned -> projections.assign(assigned);
            case CaseEscalated escalated -> projections.escalate(escalated);
            case CaseResolved resolved -> projections.resolve(resolved);
            default -> throw new InvalidEventException("Unsupported event type");
        }
    }
}
```

### 22.6 Important Note

Invalid transition decision perlu dibedakan:

- duplicate event: success/idempotent skip;
- event datang out-of-order: bisa retry/quarantine tergantung design;
- impossible transition: DLQ/quarantine;
- missing predecessor during replay: mungkin perlu rebuild strategy;
- schema invalid: DLQ.

Untuk regulatory workflow, jangan langsung “skip” invalid event tanpa audit.

---

## 23. Anti-Patterns

### 23.1 Annotation-Driven Blindness

```java
@KafkaListener(topics = "events")
public void consume(Event e) {
    service.handle(e);
}
```

Tanpa memikirkan ack, retry, idempotency, DLQ, dan ordering.

### 23.2 One Topic, Many Event Types, No Schema Governance

```text
events
```

Semua service publish JSON arbitrary.

Akibat:

- consumer fragile,
- schema tidak jelas,
- ownership kabur,
- DLQ penuh mystery payload,
- replay berbahaya.

### 23.3 Infinite Retry Poison Record

Consumer terus retry event invalid.

Akibat:

- partition stuck,
- lag naik,
- deploy tidak membantu,
- alert noise.

### 23.4 DLQ Tanpa Replay Strategy

DLQ hanya menjadi tempat error ditumpuk.

### 23.5 Async Inside Listener

Listener return sebelum work selesai.

### 23.6 Consumer Melakukan Remote Call Lambat Per Record Tanpa Backpressure

```text
Kafka -> consumer -> external API per event
```

Tanpa rate limit, retry, circuit breaker, timeout.

### 23.7 Retry Topic Untuk Workflow Strict Ordering Tanpa Guard

Event bisa keluar urutan.

### 23.8 Menggunakan Offset Untuk Deduplication Domain

Offset bukan event identity.

### 23.9 Menganggap Spring `@Transactional` Menjamin Kafka + DB Atomic

Perlu transaction manager dan boundary jelas. Untuk dual-write, pertimbangkan outbox.

---

## 24. Latihan / Thought Exercises

### Latihan 1 — Ack Mode Decision

Kamu membangun consumer untuk update search index dari event case lifecycle.

Pertanyaan:

1. Ack mode apa yang kamu pilih?
2. Apakah duplicate indexing acceptable?
3. Apakah batch listener cocok?
4. Apa retry strategy?
5. Apa DLQ metadata wajib?

### Latihan 2 — Retry Ordering

Topic berisi event per `caseId` dengan ordering strict. Event `CaseAssigned` gagal karena DB timeout 10 menit.

Pertanyaan:

1. Apakah kamu memakai blocking retry?
2. Apakah kamu memakai retry topic?
3. Apa dampaknya ke `CaseEscalated` setelahnya?
4. Bagaimana state machine projection harus berperilaku?

### Latihan 3 — Dual Write

Service menerima HTTP command `EscalateCase`, update DB, lalu publish Kafka event.

Pertanyaan:

1. Apa failure jika DB commit sukses tapi Kafka send gagal?
2. Apa failure jika Kafka send sukses tapi DB rollback?
3. Apakah Spring transaction default menyelesaikan ini?
4. Bagaimana outbox memperbaiki invariant?

### Latihan 4 — Deserialization Failure

Sebuah producer mengirim event JSON baru dengan field enum yang tidak dikenali consumer.

Pertanyaan:

1. Apakah listener method dipanggil?
2. Bagaimana error handler menangkapnya?
3. Apakah DLQ menerima original payload?
4. Bagaimana schema compatibility mencegahnya?

### Latihan 5 — Concurrency

Topic punya 6 partitions. Listener concurrency diset 12.

Pertanyaan:

1. Berapa consumer aktif memproses partition?
2. Apa yang dilakukan 6 consumer lainnya?
3. Apakah throughput pasti naik?
4. Bottleneck apa yang harus dicek?

---

## 25. Ringkasan

Spring Boot + Spring Kafka sangat produktif, tetapi abstraction-nya harus dipakai dengan kesadaran Kafka semantics.

Poin utama:

1. `KafkaTemplate` tetap producer Kafka dengan batching, retry, acks, idempotence, dan timeout.
2. `@KafkaListener` tetap consumer Kafka dengan poll loop, partition assignment, heartbeat, offset commit, dan rebalance.
3. Auto commit biasanya tidak cocok untuk consumer production yang butuh correctness.
4. Manual ack memberi kontrol, tetapi bukan exactly-once.
5. Duplicate processing tetap mungkin; idempotent consumer wajib untuk workflow serius.
6. Error harus diklasifikasikan: transient, permanent, duplicate, poison, schema failure.
7. Retry blocking menjaga ordering lebih baik tetapi bisa membuat partition stuck.
8. Retry topic cocok untuk delay panjang tetapi bisa merusak ordering.
9. DLQ adalah quarantine operasional, bukan tempat sampah.
10. Concurrency dibatasi partition count dan downstream capacity.
11. Async processing di dalam listener bisa menyebabkan offset commit sebelum work selesai.
12. Spring transaction tidak otomatis menyelesaikan DB+Kafka atomicity; outbox tetap pattern utama untuk dual-write.
13. Testing harus mencakup duplicate, poison event, retry, DLQ, restart, schema evolution, dan backpressure.

Mental model akhir:

```text
Spring Kafka is a productivity layer.
Kafka semantics remain the source of truth.
```

Kalau kamu memakai Spring Kafka dengan mental model Kafka yang benar, kamu bisa membangun service yang ringkas sekaligus production-grade.

Kalau kamu memakai Spring Kafka hanya sebagai annotation framework, kamu akan menyembunyikan distributed-system complexity sampai complexity itu muncul sebagai incident.

---

## 26. Referensi Konseptual

Gunakan referensi ini untuk pendalaman:

1. Spring for Apache Kafka Reference Documentation — KafkaTemplate, listeners, containers, error handling, retry topics, transactions, testing.
2. Apache Kafka Documentation — producer configs, consumer configs, delivery semantics, transactions.
3. Confluent Documentation — Kafka producers/consumers, Schema Registry, delivery guarantees, Spring examples.
4. Testcontainers Kafka documentation — realistic integration testing with Kafka broker containers.
5. Micrometer / Spring Boot Actuator documentation — metrics and observability.

---

## 27. Status Seri

Part ini adalah bagian ke-22 dari 35 bagian total:

```text
Part 000–022 selesai.
Part 023 berikutnya: Testing Kafka Systems: Unit, Integration, Contract, Replay, Chaos, and Determinism.
```

Seri belum selesai.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Kafka Streams Processing Semantics: Windowing, Joins, Suppression, and Exactly-Once</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-023.md">Part 023 — Testing Kafka Systems: Unit, Integration, Contract, Replay, Chaos, and Determinism ➡️</a>
</div>

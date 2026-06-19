# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-17.md

# Part 17 — RabbitMQ Stream Java Client

> Seri: RabbitMQ, RabbitMQ Streams, dan Messaging Mastery untuk Java Engineers  
> Bagian: 17 dari 34  
> Fokus: menggunakan RabbitMQ Stream Java Client secara benar, bukan memperlakukan stream seperti queue biasa.

---

## 0. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita membangun mental model RabbitMQ Streams sebagai **append-only replicated log**:

- message tidak hilang hanya karena dikonsumsi;
- consumer membaca dari offset;
- retention menentukan umur data;
- replay adalah first-class capability;
- queue cocok untuk work distribution;
- stream cocok untuk history, replay, audit, dan high-throughput append.

Bagian ini masuk ke level implementasi Java.

Tujuannya bukan sekadar “bisa publish dan consume”, tetapi memahami:

1. objek apa saja yang hidup di client;
2. bagaimana publisher confirm bekerja pada stream;
3. bagaimana offset harus dikelola;
4. bagaimana deduplication bekerja;
5. bagaimana batching memengaruhi throughput dan latency;
6. bagaimana consumer harus dibuat idempotent;
7. bagaimana failure, reconnect, dan replay harus dipikirkan sejak awal.

RabbitMQ Stream Java Client berbeda dari RabbitMQ Java Client AMQP.

AMQP client berpikir dalam primitive:

```text
connection -> channel -> exchange -> queue -> delivery -> ack
```

Stream Java Client berpikir dalam primitive:

```text
environment -> stream -> producer -> append -> confirmation
            -> consumer -> offset -> replay -> offset store
```

Kalau kamu membawa mental model queue destructive consumption ke Stream Java Client, desainmu akan salah.

---

## 1. Apa Itu RabbitMQ Stream Java Client?

RabbitMQ Stream Java Client adalah library Java native untuk berbicara dengan RabbitMQ Stream Protocol.

Ia dipakai untuk:

- membuat stream;
- menghapus stream;
- publish message ke stream;
- consume message dari stream;
- membaca dari offset tertentu;
- menyimpan offset;
- menggunakan producer confirm;
- menggunakan deduplication;
- menggunakan batching;
- membangun stream consumer yang replayable.

Secara konseptual, Stream Java Client lebih dekat ke client log-streaming daripada queue client.

Namun jangan langsung menyamakannya dengan Kafka client.

Kafka client biasanya berpikir:

```text
topic -> partition -> consumer group -> offset commit
```

RabbitMQ Stream Client berpikir:

```text
stream -> producer -> consumer -> offset tracking
```

Untuk skala partitioned streaming, RabbitMQ menyediakan **super streams**, yang akan dibahas di bagian berikutnya.

---

## 2. Kapan Menggunakan Stream Java Client, Bukan AMQP Client?

Gunakan Stream Java Client ketika kebutuhan utamanya adalah:

- append-only event log;
- replay;
- audit trail;
- historical consumption;
- high-throughput publish;
- consumer membaca data lama dan baru;
- consumer offset independent;
- stream retention;
- long-lived event history;
- consumer dapat rebuild projection;
- event harus bisa dibaca oleh banyak consumer tanpa menghapus message.

Gunakan AMQP Java Client atau Spring AMQP ketika kebutuhan utamanya adalah:

- work queue;
- command handling;
- job processing;
- competing consumers;
- routing via exchange;
- DLQ/retry topology;
- request/reply;
- classic/quorum queue semantics;
- consumer ack sebagai “work selesai”.

Rule of thumb:

```text
Kalau message mewakili pekerjaan yang harus diselesaikan satu kali -> queue.
Kalau message mewakili fakta historis yang harus bisa dibaca ulang -> stream.
```

Contoh queue:

```text
review-assignment.command.q
```

Contoh stream:

```text
enforcement.case.audit.stream
```

---

## 3. Dependency Java

Contoh Maven:

```xml
<dependency>
  <groupId>com.rabbitmq</groupId>
  <artifactId>stream-client</artifactId>
  <version>${rabbitmq-stream-client.version}</version>
</dependency>
```

Gunakan versi client yang sesuai dengan versi RabbitMQ server yang kamu jalankan.

Untuk production, jangan hardcode versi dari contoh. Pin versi di dependency management dan baca release notes ketika upgrade.

Contoh struktur Maven:

```xml
<properties>
  <java.version>21</java.version>
  <rabbitmq-stream-client.version>0.x.x</rabbitmq-stream-client.version>
</properties>
```

Kenapa Java 21 layak dipakai?

- runtime modern;
- virtual thread dapat membantu bagian orchestration aplikasi, walau bukan pengganti backpressure;
- GC lebih matang;
- observability lebih baik;
- cocok dengan baseline modern enterprise Java.

Namun Stream Client tetap harus dipakai sesuai threading model library, bukan asal dibungkus virtual thread.

---

## 4. Local RabbitMQ Stream Setup

Di part 05 kita sudah menyiapkan local lab. Untuk Stream Java Client, pastikan plugin stream aktif.

Docker Compose minimal:

```yaml
services:
  rabbitmq:
    image: rabbitmq:4-management
    container_name: rabbitmq-stream-lab
    ports:
      - "5672:5672"     # AMQP
      - "15672:15672"   # Management UI
      - "5552:5552"     # Stream protocol
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    command: >
      bash -c "rabbitmq-plugins enable --offline rabbitmq_stream rabbitmq_stream_management && rabbitmq-server"
```

Port penting:

```text
5672   -> AMQP
15672  -> Management UI
5552   -> RabbitMQ Stream Protocol
```

Validasi plugin:

```bash
rabbitmq-plugins list | grep stream
```

Atau dari container:

```bash
docker exec -it rabbitmq-stream-lab rabbitmq-plugins list
```

---

## 5. Mental Model Object di Stream Java Client

Objek utama:

```text
Environment
  ├── Producer
  ├── Consumer
  └── Stream management operation
```

### 5.1 Environment

`Environment` adalah entry point client.

Ia mewakili:

- koneksi ke RabbitMQ Stream service;
- konfigurasi host/port/credentials;
- resource factory untuk producer dan consumer;
- lifecycle client.

Jangan membuat environment baru untuk setiap message.

Salah:

```java
for (Event e : events) {
    Environment env = Environment.builder().build();
    Producer producer = env.producerBuilder().stream("audit").build();
    producer.send(...);
    producer.close();
    env.close();
}
```

Benar:

```java
Environment env = Environment.builder().build();
Producer producer = env.producerBuilder().stream("audit").build();

for (Event e : events) {
    producer.send(...);
}
```

Lifecycle ideal:

```text
application start -> create Environment -> create Producers/Consumers
application run   -> publish/consume
application stop  -> close Producers/Consumers -> close Environment
```

### 5.2 Producer

Producer bertugas append message ke stream.

Ia bukan AMQP publisher ke exchange.

Stream producer menulis ke stream tertentu:

```text
producer -> stream
```

Bukan:

```text
producer -> exchange -> routing -> queue
```

Kalau kamu butuh routing kompleks, lakukan salah satu:

1. pakai AMQP exchange/queue;
2. buat beberapa stream berdasarkan domain/routing;
3. gunakan bridge pattern;
4. gunakan super stream untuk partitioning.

### 5.3 Consumer

Consumer membaca stream dari offset tertentu.

Consumer tidak “menghapus” message dari stream.

Consumer harus punya strategi offset:

- mulai dari awal;
- mulai dari offset tertentu;
- mulai dari timestamp;
- mulai dari next/latest;
- lanjut dari offset tersimpan.

---

## 6. Membuat Environment

Contoh dasar:

```java
import com.rabbitmq.stream.Environment;

public final class StreamEnvironmentFactory {

    public static Environment create() {
        return Environment.builder()
                .host("localhost")
                .port(5552)
                .username("guest")
                .password("guest")
                .build();
    }
}
```

Dalam aplikasi nyata, jangan hardcode.

Gunakan config:

```java
public record RabbitStreamProperties(
        String host,
        int port,
        String username,
        String password
) {}
```

Lalu:

```java
public final class StreamEnvironmentFactory {

    private final RabbitStreamProperties properties;

    public StreamEnvironmentFactory(RabbitStreamProperties properties) {
        this.properties = properties;
    }

    public Environment create() {
        return Environment.builder()
                .host(properties.host())
                .port(properties.port())
                .username(properties.username())
                .password(properties.password())
                .build();
    }
}
```

Production concern:

- TLS;
- credentials rotation;
- heartbeat/network timeout;
- connection name/client name jika tersedia;
- observability;
- bounded shutdown.

---

## 7. Membuat Stream

Stream bisa dibuat lewat:

- CLI;
- management API;
- definitions;
- Java client.

Untuk production, biasanya topology lebih baik dikelola secara deklaratif oleh infrastructure/IaC atau deployment pipeline, bukan dibuat diam-diam oleh runtime service.

Namun untuk lab dan integration test, Java creation berguna.

Contoh:

```java
try (Environment env = StreamEnvironmentFactory.create()) {
    env.streamCreator()
            .stream("case-audit-stream")
            .create();
}
```

Jika stream sudah ada, operasi create bisa gagal tergantung konfigurasi/behavior client. Untuk tooling production, buat operasi idempotent:

```text
check exists -> create if missing -> verify parameters
```

Tetapi hati-hati: “exists” saja tidak cukup.

Stream dengan nama sama tetapi retention berbeda adalah problem.

Checklist topology validation:

- nama stream benar;
- retention benar;
- max length/age sesuai;
- replication factor sesuai;
- leader placement masuk akal;
- permission user benar;
- metrics aktif;
- alert aktif.

---

## 8. Membuat Message

Stream message bukan sekadar JSON string.

Di level aplikasi, message harus membawa:

- payload;
- message id;
- message type;
- schema version;
- correlation id;
- causation id;
- occurred at;
- producer;
- subject/entity id;
- tenant/regulatory scope jika ada.

Contoh domain envelope:

```java
import java.time.Instant;
import java.util.UUID;

public record StreamEnvelope<T>(
        String messageId,
        String messageType,
        int schemaVersion,
        String correlationId,
        String causationId,
        String subject,
        String producer,
        Instant occurredAt,
        T payload
) {
    public static <T> StreamEnvelope<T> event(
            String messageType,
            int schemaVersion,
            String subject,
            String correlationId,
            String causationId,
            String producer,
            T payload
    ) {
        return new StreamEnvelope<>(
                UUID.randomUUID().toString(),
                messageType,
                schemaVersion,
                correlationId,
                causationId,
                subject,
                producer,
                Instant.now(),
                payload
        );
    }
}
```

Contoh payload:

```java
public record EvidenceSubmitted(
        String caseId,
        String evidenceId,
        String submittedBy,
        String evidenceType
) {}
```

Envelope:

```java
StreamEnvelope<EvidenceSubmitted> envelope = StreamEnvelope.event(
        "regulatory.case.evidence-submitted",
        1,
        "case-123",
        "corr-789",
        "cmd-456",
        "case-service",
        new EvidenceSubmitted("case-123", "ev-001", "officer-77", "PDF")
);
```

---

## 9. Serialization Boundary

Jangan serialize Java object internal sembarangan.

Hindari:

```java
objectMapper.writeValueAsBytes(jpaEntity)
```

Gunakan DTO contract:

```java
byte[] body = objectMapper.writeValueAsBytes(envelope);
```

Boundary ideal:

```text
Domain object -> Contract DTO -> Envelope -> bytes -> Stream Message
```

Bukan:

```text
JPA entity -> bytes
```

Kenapa?

Karena stream adalah history. Message lama mungkin dibaca ulang beberapa bulan kemudian. Kalau message berisi class internal yang berubah-ubah, replay akan rusak.

Contract harus:

- versioned;
- stable;
- backward-compatible;
- documented;
- testable;
- tidak bergantung pada internal persistence model.

---

## 10. Basic Producer

Contoh producer sederhana:

```java
import com.rabbitmq.stream.Environment;
import com.rabbitmq.stream.Producer;
import com.rabbitmq.stream.Message;

import java.nio.charset.StandardCharsets;

public final class BasicStreamProducer {

    public static void main(String[] args) throws Exception {
        try (Environment env = Environment.builder()
                .host("localhost")
                .port(5552)
                .username("guest")
                .password("guest")
                .build()) {

            String stream = "case-audit-stream";

            Producer producer = env.producerBuilder()
                    .stream(stream)
                    .build();

            Message message = producer.messageBuilder()
                    .addData("hello stream".getBytes(StandardCharsets.UTF_8))
                    .build();

            producer.send(message, confirmationStatus -> {
                if (confirmationStatus.isConfirmed()) {
                    System.out.println("message confirmed");
                } else {
                    System.err.println("message not confirmed: " + confirmationStatus.getCode());
                }
            });

            Thread.sleep(1000);
            producer.close();
        }
    }
}
```

Catatan penting:

- `send` asynchronous;
- confirmation callback memberi tahu status append;
- confirmed berarti broker menerima/menyimpan sesuai semantics stream;
- not confirmed harus ditangani;
- jangan exit aplikasi sebelum confirmation diproses;
- production code perlu bounded pending confirm tracking.

---

## 11. Producer Confirm: Apa Artinya?

Publisher confirm pada stream menjawab pertanyaan:

```text
Apakah broker menerima append message ini?
```

Bukan:

```text
Apakah semua consumer sudah membaca message ini?
```

Bukan:

```text
Apakah business process downstream berhasil?
```

Bukan:

```text
Apakah message tidak akan pernah duplicate?
```

Confirm hanya boundary producer → broker.

Mental model:

```text
Application creates event
  -> serialize
  -> send to stream producer
  -> broker appends
  -> producer receives confirm
  -> publisher marks event as published
```

Jika confirm gagal:

```text
send -> not confirmed
```

Status message adalah failed/unknown, tergantung error.

Jika callback tidak pernah diterima karena process crash:

```text
send -> process crash before confirm observed
```

Status message adalah unknown.

Karena itulah outbox tetap relevan.

---

## 12. Producer State Machine

Untuk publisher production-grade, pikirkan state machine:

```text
NEW
  -> SERIALIZED
  -> SEND_REQUESTED
  -> CONFIRMED
  -> FAILED
  -> UNKNOWN
```

Contoh:

```text
NEW
  event dibuat di DB transaction

SERIALIZED
  payload berhasil diubah ke bytes

SEND_REQUESTED
  producer.send dipanggil

CONFIRMED
  callback confirmed

FAILED
  callback not confirmed dengan error final

UNKNOWN
  timeout/crash sebelum callback
```

State `UNKNOWN` adalah bagian paling penting.

Engineer junior sering menganggap timeout berarti gagal. Itu salah.

Timeout berarti:

```text
client tidak tahu apakah broker menerima message atau tidak
```

Konsekuensi:

- retry bisa membuat duplicate;
- tidak retry bisa menyebabkan data loss;
- solusi: stable message id + deduplication/idempotent consumer/outbox reconciliation.

---

## 13. Bounded In-Flight Publishing

Jangan publish unlimited tanpa batas.

Buruk:

```java
for (Event event : millionsOfEvents) {
    producer.send(toMessage(event), callback);
}
```

Masalah:

- memory client bisa naik;
- pending callback menumpuk;
- broker overload;
- latency meningkat;
- error handling tidak terkontrol;
- shutdown sulit.

Gunakan bounded in-flight.

Contoh sederhana memakai `Semaphore`:

```java
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

public final class BoundedStreamPublisher {

    private final Producer producer;
    private final Semaphore inFlight;

    public BoundedStreamPublisher(Producer producer, int maxInFlight) {
        this.producer = producer;
        this.inFlight = new Semaphore(maxInFlight);
    }

    public void publish(Message message) throws InterruptedException {
        boolean acquired = inFlight.tryAcquire(5, TimeUnit.SECONDS);
        if (!acquired) {
            throw new IllegalStateException("publisher saturated: max in-flight reached");
        }

        producer.send(message, status -> {
            try {
                if (status.isConfirmed()) {
                    onConfirmed(message);
                } else {
                    onFailed(message, status.getCode());
                }
            } finally {
                inFlight.release();
            }
        });
    }

    private void onConfirmed(Message message) {
        // mark outbox row published, increment metric, log trace
    }

    private void onFailed(Message message, short code) {
        // mark failed or retryable depending on status
    }
}
```

Ini bukan kode final production, tapi mental modelnya benar:

```text
publisher concurrency harus dibatasi
```

---

## 14. Batch Publishing

Stream throughput biasanya sangat dipengaruhi batching.

Batching mengurangi overhead per message.

Trade-off:

```text
larger batch -> higher throughput -> higher latency per message
smaller batch -> lower latency -> lower throughput
```

Jangan memilih batch size berdasarkan feeling. Benchmark dengan payload nyata.

Parameter yang perlu diuji:

- message size;
- batch size;
- confirm latency;
- producer count;
- stream replication;
- disk type;
- network latency;
- retention config;
- consumer lag;
- serialization cost.

Heuristic awal:

```text
low latency event notification -> batch kecil
high throughput audit append    -> batch lebih besar
bulk replay/import              -> batch besar dengan rate limit
```

Namun finalnya harus berbasis measurement.

---

## 15. Producer Deduplication

RabbitMQ Streams mendukung deduplication berbasis producer identity dan publishing id.

Mental model:

```text
producer name + publishing id -> duplicate detection
```

Publisher harus menjaga publishing id meningkat secara konsisten.

Contoh konseptual:

```text
producer = case-service-audit-producer
publishing id = 1001
publishing id = 1002
publishing id = 1003
```

Jika producer mengirim ulang id yang sama:

```text
producer = case-service-audit-producer
publishing id = 1002
```

Broker dapat mengenali duplicate berdasarkan stream deduplication semantics.

Tapi deduplication bukan pengganti desain idempotent penuh.

Kenapa?

Karena duplicate bisa muncul dari layer lain:

- producer berbeda;
- reprocessing pipeline;
- manual replay;
- bridge dari queue ke stream;
- downstream consumer retry;
- message semantik sama tetapi id teknis berbeda.

Jadi gunakan dua level:

```text
broker-level deduplication  -> mengurangi duplicate publish tertentu
application idempotency     -> menjaga correctness end-to-end
```

---

## 16. Publishing ID Strategy

Publishing id harus stabil dan meningkat.

Strategi buruk:

```java
long publishingId = System.currentTimeMillis();
```

Masalah:

- tidak strictly monotonic dalam semua kondisi;
- clock bisa mundur;
- multi-thread bisa collision;
- restart bisa kacau;
- beberapa event dalam millisecond sama.

Strategi buruk lain:

```java
long publishingId = new Random().nextLong();
```

Itu bukan sequence.

Strategi lebih baik:

1. persist last publishing id per producer;
2. gunakan sequence database;
3. gunakan outbox row numeric id jika monotonik;
4. pastikan producer name stable;
5. jangan menjalankan dua instance dengan producer name sama tanpa koordinasi.

Contoh mapping:

```text
producer name  = case-service-audit-producer-prod
publishing id  = outbox.id
message id     = outbox.message_id UUID
```

Jika `outbox.id` monotonik, ia bisa menjadi candidate publishing id.

Tetapi pastikan:

- tidak reuse id;
- tidak publish out-of-order jika client mensyaratkan urutan tertentu;
- tidak ada dua publisher aktif dengan identity sama.

---

## 17. Outbox Dengan Stream Producer

Outbox pattern tetap penting untuk RabbitMQ Streams.

Problem:

```text
DB commit berhasil, publish gagal -> event hilang
publish berhasil, DB commit gagal -> event hantu
publish status unknown -> duplicate/data loss risk
```

Pattern:

```text
business transaction:
  update aggregate
  insert outbox event
  commit

publisher loop:
  read unpublished outbox rows
  send to stream
  wait confirm
  mark published
```

Contoh schema sederhana:

```sql
CREATE TABLE message_outbox (
    id BIGSERIAL PRIMARY KEY,
    message_id VARCHAR(64) NOT NULL UNIQUE,
    stream_name VARCHAR(255) NOT NULL,
    message_type VARCHAR(255) NOT NULL,
    schema_version INT NOT NULL,
    subject VARCHAR(255) NOT NULL,
    correlation_id VARCHAR(64),
    causation_id VARCHAR(64),
    payload_json TEXT NOT NULL,
    status VARCHAR(32) NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Status:

```text
NEW
PUBLISHING
PUBLISHED
FAILED_RETRYABLE
FAILED_PERMANENT
UNKNOWN
```

Publisher loop:

```java
while (running) {
    List<OutboxRow> rows = outboxRepository.lockNextBatch(100);

    for (OutboxRow row : rows) {
        Message message = toStreamMessage(row);
        publisher.publish(row, message);
    }
}
```

Pada confirm:

```java
if (confirmed) {
    outboxRepository.markPublished(row.id());
} else {
    outboxRepository.markRetryableFailure(row.id(), code);
}
```

Jika process crash sebelum mark published:

```text
broker mungkin sudah menerima message, DB masih NEW/PUBLISHING
```

Saat retry, deduplication + stable message id + downstream idempotency melindungi sistem.

---

## 18. Message Metadata Pada Stream Message

Ada dua tempat metadata:

1. body envelope;
2. message properties/application properties.

Body envelope bagus untuk long-term contract.

Application properties bagus untuk filtering, tracing, routing-like metadata, dan inspection.

Contoh konseptual:

```java
Message message = producer.messageBuilder()
        .properties()
            .messageId(envelope.messageId())
            .correlationId(envelope.correlationId())
        .messageBuilder()
        .applicationProperties()
            .entry("messageType", envelope.messageType())
            .entry("schemaVersion", envelope.schemaVersion())
            .entry("subject", envelope.subject())
            .entry("producer", envelope.producer())
        .messageBuilder()
        .addData(body)
        .build();
```

Exact builder chaining dapat berbeda antar versi client. Yang penting adalah prinsip:

```text
metadata yang diperlukan untuk observability/filtering jangan hanya disembunyikan dalam payload opaque
```

Namun jangan taruh PII/sensitive data sembarangan di headers/properties karena lebih mudah terekspos di tooling.

---

## 19. Basic Consumer

Consumer membaca dari stream.

Contoh dasar:

```java
import com.rabbitmq.stream.Consumer;
import com.rabbitmq.stream.Environment;
import com.rabbitmq.stream.OffsetSpecification;

public final class BasicStreamConsumer {

    public static void main(String[] args) throws Exception {
        try (Environment env = Environment.builder()
                .host("localhost")
                .port(5552)
                .username("guest")
                .password("guest")
                .build()) {

            Consumer consumer = env.consumerBuilder()
                    .stream("case-audit-stream")
                    .offset(OffsetSpecification.first())
                    .messageHandler((context, message) -> {
                        byte[] body = message.getBodyAsBinary();
                        System.out.println("received: " + new String(body));
                    })
                    .build();

            Thread.sleep(60_000);
            consumer.close();
        }
    }
}
```

`OffsetSpecification.first()` berarti baca dari awal stream.

Untuk service normal, jangan selalu dari awal kecuali memang ingin replay.

---

## 20. Offset Specification

Offset menentukan dari mana consumer mulai membaca.

Umumnya:

```text
first      -> dari awal stream
next/latest-> hanya message baru setelah consumer mulai
offset(n)  -> dari offset tertentu
timestamp  -> dari waktu tertentu
stored     -> dari offset yang disimpan sebelumnya
```

Pilih berdasarkan use case.

### 20.1 Audit Exporter

Butuh semua data sejak awal:

```text
offset = first
```

### 20.2 Real-Time Notification Projection

Butuh lanjut dari posisi terakhir:

```text
offset = stored
```

### 20.3 New Consumer Yang Tidak Perlu History

Mulai dari message baru:

```text
offset = next/latest
```

### 20.4 Rebuild Projection

Mulai dari awal atau timestamp tertentu:

```text
offset = first
```

atau:

```text
offset = timestamp(2026-01-01T00:00:00Z)
```

### 20.5 Incident Investigation

Mulai dari sekitar waktu incident:

```text
offset = timestamp(incident_start_minus_buffer)
```

---

## 21. Offset Is Not Ack

Ini perbedaan penting.

Queue consumer ack:

```text
message delivered -> process -> ack -> broker can remove/consider done
```

Stream consumer offset:

```text
message read -> process -> store offset -> consumer can resume later
```

Message tidak hilang dari stream karena offset disimpan.

Offset menyatakan:

```text
consumer X sudah aman melewati posisi Y
```

Bukan:

```text
message Y sudah selesai untuk semua consumer
```

Jadi offset adalah state consumer, bukan state message global.

---

## 22. Kapan Store Offset?

Ini pertanyaan correctness utama.

Jangan store offset sebelum side effect aman.

Buruk:

```text
receive message
store offset
update database
```

Jika crash setelah store offset sebelum DB update:

```text
consumer resume setelah offset -> message dilewati -> data loss pada projection
```

Lebih aman:

```text
receive message
update database idempotently
commit database
store offset
```

Jika crash setelah DB commit sebelum store offset:

```text
message akan dibaca ulang -> duplicate processing
```

Karena handler idempotent, itu aman.

Rule:

```text
Prefer duplicate over loss.
```

Untuk projection:

```text
process effect first, then advance offset
```

---

## 23. Offset Store Strategy

Ada beberapa strategi.

### 23.1 Server-Side Offset Tracking

Jika menggunakan offset tracking dari RabbitMQ client, consumer dapat menyimpan offset ke broker.

Kelebihan:

- mudah;
- dekat dengan stream;
- cocok untuk consumer sederhana.

Kekurangan:

- transaction boundary dengan DB terpisah;
- sulit atomically commit DB effect + offset;
- untuk projection kritikal, perlu hati-hati.

### 23.2 Application Database Offset Store

Simpan offset di database aplikasi.

Contoh table:

```sql
CREATE TABLE stream_consumer_offset (
    consumer_name VARCHAR(255) PRIMARY KEY,
    stream_name VARCHAR(255) NOT NULL,
    offset_value BIGINT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Dalam transaction yang sama:

```text
upsert projection
upsert offset
commit
```

Kelebihan:

- offset dan side effect bisa atomic dalam DB yang sama;
- bagus untuk projection correctness;
- mudah diaudit.

Kekurangan:

- aplikasi bertanggung jawab penuh;
- perlu handle replay manual;
- perlu migration/schema.

### 23.3 Hybrid

Gunakan DB offset untuk projection kritikal, dan broker offset untuk consumer non-kritikal.

Contoh:

```text
regulatory projection consumer -> DB offset
metrics/logging consumer       -> broker offset
ad-hoc audit reader            -> no stored offset
```

---

## 24. Idempotent Stream Consumer

Karena stream replayable, duplicate bukan anomali. Duplicate adalah bagian normal dari desain.

Idempotency harus berdasar business identity, bukan offset semata.

Contoh dedupe table:

```sql
CREATE TABLE consumed_message (
    consumer_name VARCHAR(255) NOT NULL,
    message_id VARCHAR(64) NOT NULL,
    processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (consumer_name, message_id)
);
```

Flow:

```text
begin transaction
  if message_id already consumed -> update offset if needed -> commit
  apply business effect
  insert consumed_message
  update consumer_offset
commit
```

Pseudo-code:

```java
@Transactional
public void handle(StreamRecord record) {
    if (consumedMessageRepository.exists(consumerName, record.messageId())) {
        offsetRepository.advanceIfGreater(consumerName, record.stream(), record.offset());
        return;
    }

    projectionRepository.apply(record.payload());
    consumedMessageRepository.insert(consumerName, record.messageId());
    offsetRepository.advanceIfGreater(consumerName, record.stream(), record.offset());
}
```

Advance offset harus hati-hati jika processing parallel. Jika parallel, offset tidak bisa selalu langsung maju ke message terbaru karena ada gap.

---

## 25. Offset Gap Problem Dalam Parallel Processing

Misal consumer menerima offset:

```text
100, 101, 102, 103
```

Diproses paralel.

Urutan selesai:

```text
100 done
102 done
103 done
101 masih proses
```

Boleh store offset 103?

Tidak, jika offset berarti “semua sampai posisi ini sudah aman”.

Kalau store 103 lalu crash sebelum 101 selesai, maka 101 dilewati.

Solusi:

### 25.1 Process Serial

Paling sederhana dan aman.

```text
read -> process -> store offset -> next
```

Throughput lebih rendah.

### 25.2 Per-Key Serial, Global Parallel

Partition workload by key.

```text
case-1 -> worker A serial
case-2 -> worker B serial
case-3 -> worker C serial
```

Offset global masih butuh tracking gap.

### 25.3 Gap Tracker

Simpan set offset selesai, advance hanya contiguous offset.

Contoh:

```text
lastCommitted = 99
completed = {100, 102, 103}
advance -> 100 only

when 101 done:
completed = {101,102,103}
advance -> 103
```

Ini lebih kompleks, tapi diperlukan untuk high-throughput projection dengan correctness.

---

## 26. Consumer Flow Control

Stream consumer harus punya backpressure.

Jangan membaca lebih cepat daripada kemampuan processing.

Masalah jika tidak ada kontrol:

- memory aplikasi naik;
- executor queue membengkak;
- DB overload;
- offset lag misleading;
- shutdown lama;
- retry storm downstream.

Pattern:

```text
consumer reads -> bounded executor -> if full, slow/stop intake
```

Jika API client menyediakan credit/flow control, gunakan. Jika tidak, desain handler agar tidak menumpuk unbounded work.

Buruk:

```java
ExecutorService executor = Executors.newCachedThreadPool();

messageHandler((context, message) -> {
    executor.submit(() -> process(message));
});
```

Lebih baik:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        8,
        8,
        0L,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(1000),
        new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Tapi `CallerRunsPolicy` dalam callback client harus dipahami: ia bisa memperlambat thread handler. Itu bisa baik sebagai backpressure, tapi jangan sampai deadlock.

---

## 27. Consumer Name

Consumer name bukan kosmetik.

Ia dipakai untuk:

- offset tracking;
- observability;
- ownership;
- incident debugging;
- replay control.

Naming convention:

```text
<service>.<purpose>.<environment>
```

Contoh:

```text
case-projection.audit-reader.prod
notification-service.case-event-reader.prod
fraud-signal-builder.evidence-reader.staging
```

Jangan gunakan random UUID sebagai consumer name untuk consumer yang butuh resume.

Buruk:

```text
consumer-7f8a91c2
```

Karena setiap restart dianggap consumer baru dan offset tidak ditemukan.

Untuk ad-hoc reader, random name boleh.

---

## 28. Stream Consumer Sebagai Projection Builder

Salah satu use case terbaik RabbitMQ Streams adalah membangun projection.

Contoh stream:

```text
case-audit-stream
```

Event:

```text
CaseOpened
EvidenceSubmitted
RiskScoreCalculated
ReviewAssigned
EnforcementActionProposed
DecisionApproved
```

Projection:

```text
case_current_state
case_timeline_view
case_risk_dashboard
case_sla_dashboard
```

Consumer projection:

```text
read event -> validate schema -> idempotency check -> apply projection -> store offset
```

Pseudo-code:

```java
@Transactional
public void onEvent(StreamEvent event) {
    switch (event.messageType()) {
        case "regulatory.case.opened" -> applyCaseOpened(event);
        case "regulatory.case.evidence-submitted" -> applyEvidenceSubmitted(event);
        case "regulatory.case.review-assigned" -> applyReviewAssigned(event);
        default -> unknownEventHandler(event);
    }

    consumedMessageRepository.markConsumed(consumerName, event.messageId());
    offsetRepository.advance(consumerName, event.stream(), event.offset());
}
```

Unknown event strategy:

- if forward-compatible: ignore and advance;
- if required but unsupported: stop consumer and alert;
- if optional: store unknown event record;
- never silently drop critical unknown events.

---

## 29. Replay Mode

Replay harus eksplisit.

Jangan campur consumer normal dan replay consumer tanpa kontrol.

Consumer normal:

```text
consumer name = case-projection.prod
offset = stored
side effects = enabled
```

Replay consumer:

```text
consumer name = case-projection-rebuild-2026-06
offset = first or timestamp
side effects = controlled target table
```

Replay ke target baru:

```text
case_projection_v2_rebuild
```

Setelah selesai:

```text
validate -> swap view/table -> retire old projection
```

Jangan replay langsung ke production side-effect external seperti email, payment, enforcement notification, atau third-party API kecuali ada replay guard.

Classification:

```text
safe replay effect:
  rebuild database projection
  recompute dashboard
  regenerate search index

unsafe replay effect:
  send email
  call enforcement partner
  create legal notice
  trigger human assignment again
```

Untuk unsafe effects, gunakan event handler yang membedakan:

```text
live mode vs replay mode
```

---

## 30. Stream Consumer Error Handling

Consumer error bukan hanya exception.

Taxonomy:

```text
serialization error
schema unsupported
validation error
business invariant violation
DB transient failure
DB permanent failure
external dependency failure
poison event
unknown message type
handler bug
```

Response berbeda.

### 30.1 Serialization Error

Message tidak bisa dibaca.

Action:

- log message metadata;
- stop consumer jika critical;
- store error record;
- jangan advance offset sembarangan kecuali policy jelas.

### 30.2 Unsupported Schema

Consumer belum support version.

Action:

- stop and alert;
- deploy compatible consumer;
- or skip if message optional and policy allows.

### 30.3 Business Invariant Violation

Contoh:

```text
EvidenceSubmitted untuk case yang belum pernah CaseOpened
```

Kemungkinan:

- out-of-order event;
- missing historical event;
- bug producer;
- projection rebuild mulai dari offset salah.

Action:

- jangan langsung discard;
- quarantine record;
- inspect causation;
- mungkin perlu buffering atau rebuild dari awal.

### 30.4 DB Transient Failure

Action:

- retry local dengan backoff terbatas;
- jangan advance offset sebelum commit;
- jika lama, stop consumer agar tidak membuat lag/error storm.

### 30.5 Poison Event

Action:

- quarantine;
- operator review;
- patch consumer atau data correction;
- replay dari offset setelah fix.

Stream tidak sama dengan queue DLQ. Karena stream message tetap ada, “DLQ” untuk stream biasanya berupa **quarantine table/stream** atau error projection, bukan remove message dari source.

---

## 31. Quarantine Pattern Untuk Stream Consumer

Table:

```sql
CREATE TABLE stream_consumer_quarantine (
    id BIGSERIAL PRIMARY KEY,
    consumer_name VARCHAR(255) NOT NULL,
    stream_name VARCHAR(255) NOT NULL,
    offset_value BIGINT NOT NULL,
    message_id VARCHAR(64),
    message_type VARCHAR(255),
    error_code VARCHAR(128) NOT NULL,
    error_message TEXT NOT NULL,
    payload_snapshot TEXT,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL
);
```

Policy:

```text
critical projection -> stop on quarantine
non-critical projection -> quarantine and continue only if safe
```

Untuk regulatory case management, biasanya lebih defensible untuk stop projection critical daripada diam-diam skip event.

Karena skip event bisa menghasilkan state salah.

---

## 32. Stream Publisher Untuk Audit Trail

Contoh domain: setiap perubahan case harus masuk audit stream.

Flow:

```text
case command accepted
DB transaction updates case state
outbox inserts CaseStateChanged event
publisher appends to case-audit-stream
consumer/projection builds timeline
```

Event:

```json
{
  "messageId": "msg-001",
  "messageType": "regulatory.case.state-changed",
  "schemaVersion": 1,
  "correlationId": "corr-123",
  "causationId": "cmd-777",
  "subject": "case-456",
  "producer": "case-service",
  "occurredAt": "2026-06-19T10:15:30Z",
  "payload": {
    "caseId": "case-456",
    "fromState": "UNDER_REVIEW",
    "toState": "ESCALATED",
    "reasonCode": "HIGH_RISK_SCORE",
    "policyVersion": "risk-policy-2026.04"
  }
}
```

Kenapa stream cocok?

- event adalah history;
- banyak consumer bisa membaca tanpa menghapus;
- audit reconstruction butuh replay;
- timeline bisa dibangun ulang;
- compliance review butuh causation/correlation chain.

---

## 33. Stream vs Queue Dalam Satu Workflow

Jangan memaksa semua hal masuk stream.

Contoh hybrid:

```text
Commands:
  review-assignment.command.q       -> quorum queue
  notification-send.command.q       -> quorum queue

Events:
  case.events.exchange              -> topic exchange

Audit/history:
  case-audit-stream                 -> stream

Retries:
  command retry/DLQ                 -> queue/DLX topology

Projection rebuild:
  read from case-audit-stream
```

Pipeline:

```text
Command queue -> handler -> DB update -> outbox -> stream append -> projections
```

Exchange tetap berguna untuk event notification. Stream tetap berguna untuk retained history.

RabbitMQ modern memberi beberapa primitive. Mastery adalah memilih primitive yang benar, bukan memakai satu primitive untuk semua problem.

---

## 34. Stream Filtering

RabbitMQ Streams mendukung konsep filtering untuk mengurangi traffic ke consumer yang hanya butuh subset message.

Mental model:

```text
stream berisi banyak event
consumer hanya tertarik message dengan filter tertentu
broker/client membantu mengurangi message yang dikirim
```

Contoh use case:

```text
case-audit-stream berisi semua case events
consumer A hanya butuh regulatory.case.evidence-submitted
consumer B hanya butuh regulatory.case.decision-approved
```

Agar filtering berguna, metadata filter harus tersedia di message property, bukan hanya tersembunyi di body JSON.

Contoh metadata:

```text
messageType = regulatory.case.evidence-submitted
subjectType = case
jurisdiction = ID-JK
```

Namun hati-hati:

- filtering bukan security boundary;
- consumer tetap harus validasi message;
- jangan masukkan sensitive metadata tanpa pertimbangan;
- jangan membuat terlalu banyak filter yang sulit dipahami.

---

## 35. Stream Performance Principles

Faktor utama:

- message size;
- batch size;
- producer count;
- consumer count;
- disk throughput;
- replication factor;
- network latency;
- retention pressure;
- serialization CPU;
- compression jika digunakan;
- confirm handling;
- offset store frequency.

### 35.1 Message Size

Large message buruk untuk broker.

Lebih baik:

```text
message contains metadata + pointer to blob/object storage
```

Bukan:

```text
message contains 20 MB PDF
```

Untuk evidence:

```json
{
  "evidenceId": "ev-001",
  "contentUri": "s3://...",
  "sha256": "...",
  "mimeType": "application/pdf",
  "sizeBytes": 1248890
}
```

### 35.2 Offset Store Frequency

Store offset per message paling aman tapi bisa mahal.

Store per batch lebih cepat tapi meningkatkan replay duplicate saat crash.

Trade-off:

```text
store every message -> lower duplicate on restart, more DB writes
store every N       -> fewer DB writes, more duplicate replay risk
store by time       -> balanced, but less deterministic
```

Untuk critical projection, correctness dulu, optimize kemudian.

### 35.3 Consumer Lag

Lag bukan selalu buruk.

Lag buruk jika:

- projection stale melewati SLA;
- stream retention hampir menghapus data yang belum dibaca;
- consumer error menyebabkan backlog;
- downstream system tertinggal.

Lag normal jika:

- consumer sedang replay;
- batch rebuild;
- low priority analytics;
- planned maintenance.

Alert harus memahami context.

---

## 36. Stream PerfTest

RabbitMQ menyediakan tooling performa untuk stream. Gunakan untuk memahami batas lab dan cluster.

Yang harus diuji:

```text
single producer, single consumer
multiple producers
multiple consumers
large message
small message
batch publish
replicated stream
consumer replay from beginning
consumer live tail
producer confirm latency
retention under load
```

Jangan benchmark dengan payload palsu 10 byte jika production payload 5 KB JSON.

Jangan benchmark tanpa consumer jika production selalu punya consumer.

Jangan benchmark di laptop lalu menganggap itu kapasitas cluster.

Dokumentasikan:

- environment;
- RabbitMQ version;
- client version;
- JVM version;
- CPU/memory;
- disk type;
- network;
- message size;
- producer count;
- consumer count;
- stream replication;
- retention;
- result percentile.

---

## 37. Spring Boot Dengan Stream Java Client

Spring AMQP tidak sama dengan RabbitMQ Stream Java Client.

Untuk Stream Client, kamu bisa membuat Spring bean sendiri.

Contoh properties:

```java
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.rabbitmq.stream")
public record RabbitStreamProperties(
        String host,
        int port,
        String username,
        String password,
        String auditStream
) {}
```

Configuration:

```java
import com.rabbitmq.stream.Environment;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitStreamConfiguration {

    @Bean(destroyMethod = "close")
    Environment rabbitStreamEnvironment(RabbitStreamProperties properties) {
        return Environment.builder()
                .host(properties.host())
                .port(properties.port())
                .username(properties.username())
                .password(properties.password())
                .build();
    }
}
```

Producer bean:

```java
import com.rabbitmq.stream.Environment;
import com.rabbitmq.stream.Producer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class StreamProducerConfiguration {

    @Bean(destroyMethod = "close")
    Producer auditStreamProducer(Environment environment, RabbitStreamProperties properties) {
        return environment.producerBuilder()
                .stream(properties.auditStream())
                .build();
    }
}
```

Service:

```java
import com.rabbitmq.stream.Message;
import com.rabbitmq.stream.Producer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

@Service
public class AuditStreamPublisher {

    private final Producer producer;
    private final ObjectMapper objectMapper;

    public AuditStreamPublisher(Producer producer, ObjectMapper objectMapper) {
        this.producer = producer;
        this.objectMapper = objectMapper;
    }

    public void publish(StreamEnvelope<?> envelope) {
        try {
            byte[] body = objectMapper.writeValueAsBytes(envelope);

            Message message = producer.messageBuilder()
                    .addData(body)
                    .build();

            producer.send(message, status -> {
                if (status.isConfirmed()) {
                    // mark outbox published or emit metric
                } else {
                    // mark retryable failure or alert
                }
            });
        } catch (Exception e) {
            throw new IllegalStateException("failed to publish audit stream event", e);
        }
    }
}
```

Production version harus menambahkan:

- outbox integration;
- bounded in-flight;
- confirm timeout handling;
- metrics;
- structured logging;
- graceful shutdown;
- deduplication identity;
- error classification.

---

## 38. Graceful Shutdown

Shutdown harus menjawab:

```text
Apakah semua in-flight publish sudah confirmed/failed sebelum process mati?
```

Untuk producer:

1. stop accepting new publish;
2. wait pending in-flight confirm sampai timeout;
3. mark remaining as unknown;
4. close producer;
5. close environment.

Untuk consumer:

1. stop receiving new messages;
2. finish in-flight processing;
3. commit offsets for completed messages;
4. leave incomplete messages uncommitted;
5. close consumer;
6. close environment.

Jangan shutdown dengan:

```text
kill -9
```

kecuali chaos test.

Kubernetes concern:

- `terminationGracePeriodSeconds` cukup;
- readiness false sebelum shutdown;
- drain producer/consumer;
- jangan langsung menerima traffic baru;
- monitor unknown publishes.

---

## 39. Observability Untuk Stream Client

Metrics publisher:

- publish attempts;
- publish confirmed;
- publish failed;
- publish unknown/timeouts;
- confirm latency;
- in-flight count;
- serialization failure;
- outbox lag;
- outbox oldest age;
- producer blocked/disconnected.

Metrics consumer:

- messages received;
- messages processed;
- processing latency;
- offset committed;
- consumer lag;
- duplicate detected;
- poison/quarantine count;
- schema unsupported count;
- replay mode flag;
- DB transaction failure;
- handler error rate.

Logs harus punya:

- message id;
- message type;
- schema version;
- stream;
- offset;
- correlation id;
- causation id;
- subject;
- consumer name;
- producer name.

Structured log example:

```json
{
  "event": "stream_message_processed",
  "stream": "case-audit-stream",
  "offset": 123456,
  "messageId": "msg-001",
  "messageType": "regulatory.case.evidence-submitted",
  "consumer": "case-projection.prod",
  "correlationId": "corr-123",
  "durationMs": 42
}
```

---

## 40. Security Considerations

Stream client security sama pentingnya dengan AMQP.

Checklist:

- gunakan user berbeda per service;
- permission minimum;
- TLS untuk production;
- credentials dari secret manager;
- jangan log payload sensitive;
- jangan masukkan PII ke metadata yang mudah terekspos;
- audit akses stream;
- pisahkan vhost jika multi-tenant;
- retention sesuai data policy;
- encryption at rest bergantung deployment/storage layer;
- replay access harus dikontrol karena stream berisi history.

Poin penting:

```text
Replay capability adalah privilege besar.
```

Consumer yang bisa membaca stream dari awal mungkin bisa melihat data historis luas. Jangan samakan privilege live notification consumer dengan audit replay consumer.

---

## 41. Common Anti-Patterns

### 41.1 Menganggap Stream Sama Dengan Queue

Salah:

```text
consumer membaca message -> message dianggap selesai/hilang
```

Benar:

```text
consumer membaca message -> message tetap ada sampai retention menghapusnya
```

### 41.2 Store Offset Sebelum Side Effect

Menyebabkan data loss pada projection.

### 41.3 Consumer Name Random Untuk Service Stateful

Menyebabkan resume offset gagal dan replay tak disengaja.

### 41.4 Tidak Punya Idempotency

Replay/crash/retry akan merusak state.

### 41.5 Publish Tanpa Confirm

Producer tidak tahu apakah append berhasil.

### 41.6 Outbox Dianggap Tidak Perlu

Stream tidak menghilangkan dual-write problem.

### 41.7 Replay Menghasilkan Side Effect Eksternal

Bisa mengirim email/legal notice dua kali.

### 41.8 Payload Besar Di Stream

Membebani broker, disk, network, replay, retention.

### 41.9 Retention Tanpa Consumer Lag Awareness

Consumer lambat bisa kehilangan data yang sudah expired.

### 41.10 Filtering Dianggap Security

Filtering hanya optimisasi consumption, bukan authorization.

---

## 42. End-to-End Example: Audit Event Publisher and Projection Consumer

### 42.1 Domain Command

```text
SubmitEvidenceCommand
```

Handler:

```text
validate command
store evidence metadata
change case state if needed
insert outbox event EvidenceSubmitted
commit
```

### 42.2 Outbox Event

```json
{
  "messageId": "msg-ev-001",
  "messageType": "regulatory.case.evidence-submitted",
  "schemaVersion": 1,
  "correlationId": "corr-001",
  "causationId": "cmd-submit-evidence-001",
  "subject": "case-123",
  "producer": "case-service",
  "occurredAt": "2026-06-19T10:15:30Z",
  "payload": {
    "caseId": "case-123",
    "evidenceId": "ev-001",
    "submittedBy": "officer-77",
    "evidenceType": "PDF"
  }
}
```

### 42.3 Publisher

```text
read outbox row
build stream message
send with confirm
if confirmed -> mark outbox published
if failed -> retry policy
if timeout/crash -> unknown -> retry with stable id/dedup/idempotency
```

### 42.4 Projection Consumer

```text
consumer = case-timeline-projection.prod
offset = stored
read event
validate schema
check consumed_message
insert timeline row
mark consumed
advance offset
commit
```

### 42.5 Replay Projection

```text
consumer = case-timeline-rebuild-2026-06
offset = first
target = case_timeline_v2_rebuild
side effects = database projection only
```

### 42.6 Failure Walkthrough

Publisher crash after send before confirm:

```text
outbox row remains PUBLISHING/UNKNOWN
retry sends same event again
broker dedup may ignore duplicate if publishing id stable
consumer idempotency protects projection anyway
```

Consumer crash after DB commit before offset store:

```text
event reread on restart
consumed_message detects duplicate
offset advances
projection remains correct
```

Unsupported schema:

```text
consumer stops
alert fires
deploy compatible consumer
resume from same offset
```

Retention too short:

```text
consumer offline too long
offset points to expired data
projection cannot resume correctly
must rebuild from backup/alternate source
```

This is why retention must be based on recovery objectives, not disk convenience only.

---

## 43. Production Checklist

### Publisher Checklist

- [ ] Uses stable message id.
- [ ] Uses stable producer identity if deduplication is enabled.
- [ ] Uses monotonic publishing id.
- [ ] Uses publisher confirmation.
- [ ] Handles negative confirmation.
- [ ] Handles confirmation timeout as unknown.
- [ ] Bounded in-flight messages.
- [ ] Integrated with outbox for DB-originated events.
- [ ] Does not publish JPA/internal entity.
- [ ] Emits metrics for confirm latency and failure.
- [ ] Graceful shutdown drains in-flight publish.

### Consumer Checklist

- [ ] Uses stable consumer name.
- [ ] Starts from stored offset for stateful consumer.
- [ ] Stores offset after side effect commit.
- [ ] Has idempotency table or equivalent.
- [ ] Handles unsupported schema explicitly.
- [ ] Has quarantine strategy.
- [ ] Does not replay unsafe side effects.
- [ ] Has lag monitoring.
- [ ] Has retention risk alert.
- [ ] Has replay procedure.

### Contract Checklist

- [ ] Envelope includes message id.
- [ ] Envelope includes message type.
- [ ] Envelope includes schema version.
- [ ] Envelope includes correlation id.
- [ ] Envelope includes causation id.
- [ ] Envelope includes occurred at.
- [ ] Payload is stable contract DTO.
- [ ] Metadata needed for filtering is exposed safely.
- [ ] Sensitive data minimized.
- [ ] Golden sample tests exist.

### Operations Checklist

- [ ] Stream exists with correct retention.
- [ ] Stream protocol port reachable.
- [ ] Plugin enabled.
- [ ] TLS configured in production.
- [ ] Credentials scoped.
- [ ] Metrics exported.
- [ ] Alert on lag/retention risk.
- [ ] Runbook for replay exists.
- [ ] Runbook for poison/quarantine exists.
- [ ] Capacity test done with real payload.

---

## 44. Mini Lab

### Lab 1 — Create Stream

1. Start RabbitMQ with stream plugin.
2. Create stream `case-audit-stream`.
3. Verify via management UI or CLI.

Expected:

```text
stream exists and is visible
```

### Lab 2 — Basic Publish

1. Build basic producer.
2. Publish 10 messages.
3. Wait for confirm callback.
4. Log confirmed count.

Expected:

```text
10 confirmed messages
```

### Lab 3 — Basic Consume From Beginning

1. Build consumer with `OffsetSpecification.first()`.
2. Read all 10 messages.
3. Stop consumer.
4. Start again from first.

Expected:

```text
same 10 messages can be read again
```

This proves non-destructive consumption.

### Lab 4 — Stored Offset

1. Add offset table.
2. Process messages and store offset.
3. Restart consumer.
4. Continue from stored offset.

Expected:

```text
consumer does not reprocess already committed messages, except by explicit replay
```

### Lab 5 — Crash Safety

1. Process message.
2. Commit DB effect.
3. Simulate crash before offset store.
4. Restart.
5. Ensure idempotency protects duplicate.

Expected:

```text
projection remains correct
```

### Lab 6 — Replay Projection

1. Create second projection table.
2. Start replay consumer from first.
3. Build new projection.
4. Compare with original projection.

Expected:

```text
projection can be rebuilt from stream
```

---

## 45. Review Questions

1. Why is Stream Java Client not the same as AMQP Java Client?
2. What does producer confirm guarantee, and what does it not guarantee?
3. Why does outbox remain relevant for streams?
4. Why is offset not the same as queue acknowledgement?
5. Why should offset be stored after side effect commit?
6. What failure happens if offset is stored before DB update?
7. Why is stable consumer name important?
8. What makes replay dangerous for external side effects?
9. Why is idempotency mandatory for replayable consumers?
10. How would you design a projection consumer that can recover after crash?
11. What is the offset gap problem?
12. When would you use broker-side offset tracking vs DB offset tracking?
13. Why is retention a correctness concern, not only storage concern?
14. Why should message metadata not all be hidden inside payload?
15. What metrics prove your stream publisher is healthy?

---

## 46. Key Takeaways

RabbitMQ Stream Java Client is for log-style messaging.

The core lifecycle is:

```text
Environment -> Producer -> append -> confirm
Environment -> Consumer -> read from offset -> process -> store offset
```

The most important correctness rules are:

```text
1. confirm publish before marking message published
2. use outbox for DB-originated events
3. store consumer offset after durable side effect
4. make consumers idempotent
5. use stable consumer names
6. treat replay as a controlled mode
7. treat retention as recovery design
```

Do not use streams just because they look modern.

Use streams when historical, replayable, retained event data is the correct abstraction.

Use queues when you need work distribution and completion semantics.

Use both when the system needs both:

```text
queue  -> work coordination
stream -> retained history/replay/audit
```

That distinction is one of the most important RabbitMQ architecture skills.

---

## 47. Hubungan Dengan Bagian Berikutnya

Part berikutnya membahas:

```text
Part 18 — Super Streams and Partitioned Streaming
```

Di bagian itu kita akan naik dari single stream ke partitioned stream model:

- kenapa single stream bisa menjadi bottleneck;
- apa itu super stream;
- bagaimana routing ke partition;
- bagaimana consumer group bekerja;
- bagaimana ordering berubah menjadi per-partition;
- bagaimana membandingkan super stream dengan Kafka partition tanpa menyamakan keduanya secara dangkal.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-16.md">⬅️ Part 16 — RabbitMQ Streams Mental Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-18.md">Part 18 — Super Streams and Partitioned Streaming ➡️</a>
</div>

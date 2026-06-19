# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-18.md

# Part 18 — Super Streams and Partitioned Streaming

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin menguasai RabbitMQ modern sampai level desain produksi.  
> Fokus bagian ini: memahami **Super Streams** sebagai abstraction untuk **partitioned streaming** di RabbitMQ: kapan dibutuhkan, bagaimana ia bekerja, bagaimana producer routing dan consumer group bekerja, apa konsekuensi terhadap ordering, scaling, failure, dan operability.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi berikut:

1. RabbitMQ bukan hanya queue; ia adalah broker, router, work distribution engine, dan sekarang juga streaming broker.
2. Queue tradisional cocok untuk work distribution yang destructive.
3. Stream cocok untuk history, replay, audit, dan non-destructive consumption.
4. Stream biasa tetap punya batas scaling karena satu logical stream tetap menjadi unit storage/traffic tertentu.
5. Java Stream Client memberi API native untuk producer, consumer, offset, confirm, batching, dan deduplication.

Part ini menjawab pertanyaan berikut:

> Kalau satu stream tidak cukup untuk throughput, storage, atau parallel consumption, bagaimana RabbitMQ Streams melakukan horizontal scaling?

Jawabannya: **Super Streams**.

Secara ringkas, Super Stream adalah **logical stream yang terdiri dari beberapa stream partition**. Aplikasi melihatnya sebagai satu stream besar, tetapi broker menyimpannya sebagai beberapa stream biasa yang dapat didistribusikan di cluster. Dokumentasi RabbitMQ menyebut super streams sebagai cara untuk scale out dengan mempartisi stream besar menjadi stream-stream yang lebih kecil, dan integrasinya dengan single active consumer membantu menjaga order di dalam partition.

---

## 1. Masalah yang Diselesaikan oleh Super Streams

Satu stream biasa memberikan model append-only log:

```text
producer -> stream -> consumer(s)
```

Ini cukup untuk banyak kebutuhan:

- audit log per domain kecil,
- replay low-volume event,
- event history internal,
- rebuild projection tertentu,
- stream notifikasi dengan traffic sedang.

Namun satu stream mulai menjadi bottleneck saat:

1. **write throughput terlalu tinggi**  
   Semua publish masuk ke satu stream.

2. **read throughput terlalu tinggi**  
   Banyak consumer membaca dari satu stream dan broker/node tertentu menjadi panas.

3. **storage terlalu besar untuk satu placement**  
   Segment stream bertumpuk pada satu logical stream dan replica set tertentu.

4. **consumer parallelism ingin dinaikkan tanpa kehilangan order per key**  
   Kita ingin banyak consumer aktif, tetapi tidak ingin dua consumer memproses entity/key yang sama secara bersamaan.

5. **domain punya natural partition key**  
   Misalnya:
   - `caseId`
   - `accountId`
   - `tenantId`
   - `merchantId`
   - `customerId`
   - `instrumentId`

6. **replay ingin dipecah secara horizontal**  
   Rebuild projection dari stream besar akan lebih cepat jika beberapa partition dapat dibaca paralel.

Super Stream adalah jawaban RabbitMQ Streams untuk masalah ini.

---

## 2. Mental Model Utama

Jangan bayangkan super stream sebagai tipe storage ajaib baru.

Bayangkan sebagai:

```text
Logical stream: case-events

Physical partitions:
  case-events-0
  case-events-1
  case-events-2
  case-events-3
```

Producer publish ke logical super stream. Berdasarkan routing strategy, message diarahkan ke salah satu partition stream.

Consumer group membaca logical super stream. Di belakang layar, consumer group membagi partition ke consumer aktif.

```text
                         +----------------+
producer ----publish----> | case-events    |  logical super stream
                         +-------+--------+
                                 |
             +-------------------+-------------------+
             |                   |                   |
             v                   v                   v
      case-events-0       case-events-1       case-events-2      ...
        partition           partition           partition
```

Yang penting:

- ordering dijaga **di dalam partition**, bukan global seluruh super stream;
- scaling terjadi dengan menambah partition;
- consumer group parallelism dibatasi oleh jumlah partition;
- partition key menentukan entity mana masuk ke partition mana;
- salah memilih partition key bisa membuat hot partition.

---

## 3. Super Stream vs Stream Biasa

| Aspek | Stream Biasa | Super Stream |
|---|---|---|
| Logical identity | Satu stream | Satu logical stream berisi banyak partition stream |
| Storage | Satu stream replicated | Beberapa stream replicated |
| Write scaling | Terbatas pada satu stream | Disebar ke partition |
| Read scaling | Banyak consumer bisa baca, tetapi satu stream tetap unit utama | Consumer group dapat membagi partition |
| Ordering | Order dalam stream | Order per partition |
| Replay | Dari satu stream | Paralel per partition |
| Operational complexity | Lebih sederhana | Lebih kompleks |
| Cocok untuk | Low/medium volume replay/audit | High-volume partitionable event stream |

Heuristik awal:

> Gunakan stream biasa sampai ada alasan nyata untuk partitioning. Gunakan super stream ketika throughput, storage, atau parallel consumption membutuhkan partitioning dan domain punya partition key yang stabil.

---

## 4. Super Stream vs Kafka Topic Partition

Karena kamu sudah punya Kafka series, kita tidak akan mengulang Kafka. Namun perbandingan minimal perlu untuk menempatkan mental model.

Keduanya punya kemiripan konseptual:

```text
Kafka topic     -> partitions
Rabbit super stream -> partition streams
```

Tetapi jangan menyamakan operational semantics secara total.

Perbedaan penting:

1. RabbitMQ tetap punya AMQP/exchange heritage. Super stream secara konsep dapat dipahami sebagai logical stream yang direpresentasikan oleh exchange + stream queues/bindings.
2. RabbitMQ Streams adalah bagian dari broker RabbitMQ, bukan Kafka broker.
3. RabbitMQ cocok ketika aplikasi juga butuh queue semantics, AMQP routing, work distribution, dan streaming ringan/menengah dalam satu platform.
4. Kafka tetap unggul untuk ekosistem event streaming skala besar, long retention besar, stream processing ecosystem, dan log-centric architecture yang sangat intensif.
5. RabbitMQ Super Streams paling masuk akal ketika kamu sudah berada di RabbitMQ ecosystem dan perlu scaling stream tanpa membawa platform Kafka untuk kebutuhan yang masih bisa dipenuhi RabbitMQ.

Decision smell:

- Kalau kebutuhan utamanya adalah distributed event log sebagai pusat data platform, Kafka biasanya lebih natural.
- Kalau kebutuhan utamanya adalah operational messaging + sebagian event replay/audit/streaming dengan routing AMQP yang kuat, RabbitMQ Streams/Super Streams bisa sangat masuk akal.

---

## 5. Anatomi Super Stream

Secara konseptual, super stream terdiri dari:

1. **Logical super stream name**  
   Contoh: `case-events`.

2. **Partition streams**  
   Contoh:

   ```text
   case-events-0
   case-events-1
   case-events-2
   case-events-3
   ```

3. **Routing layer**  
   Message diarahkan ke partition tertentu.

4. **Binding/routing rules**  
   Dalam AMQP representation, partition streams dapat dipahami sebagai stream queues yang diikat ke exchange super stream.

5. **Producer routing strategy**  
   Cara producer memilih partition.

6. **Consumer group coordination**  
   Cara consumer group membagi partition ke consumer aktif.

7. **Single active consumer behavior per partition**  
   Untuk menjaga satu consumer aktif per partition dalam group.

---

## 6. Partition Adalah Unit Ordering

Ini invariant terpenting.

Dalam super stream:

```text
Global stream order: tidak dijanjikan sebagai satu urutan tunggal yang harus dipakai aplikasi.
Partition order: dijaga dalam masing-masing partition.
```

Misalnya event regulatory case:

```text
Case A: A1, A2, A3
Case B: B1, B2, B3
Case C: C1, C2, C3
```

Jika partition key = `caseId`, maka semua event untuk case yang sama masuk ke partition yang sama.

```text
partition-0: A1 -> A2 -> A3
partition-1: B1 -> B2 -> B3
partition-2: C1 -> C2 -> C3
```

Tidak penting apakah `B2` diproses sebelum `A1` secara global, selama setiap case menjaga urutan internalnya.

Untuk workflow/case management, ini biasanya benar:

> Yang harus dijaga bukan global ordering semua event di sistem, melainkan ordering per aggregate/entity yang mempengaruhi state transition.

---

## 7. Global Ordering adalah Trap

Banyak engineer berkata:

> Semua event harus urut.

Pertanyaan arsitekturalnya:

> Urut menurut apa?

Kemungkinan jawaban:

1. Urut per broker append time.
2. Urut per producer publish time.
3. Urut per business occurrence time.
4. Urut per aggregate/entity.
5. Urut per tenant.
6. Urut per workflow instance.
7. Urut per regulatory case.
8. Urut per downstream projection.

Global ordering hampir selalu mahal dan sering tidak diperlukan.

Kalau kamu memaksakan global ordering:

- hanya satu partition,
- throughput lebih rendah,
- replay lebih lambat,
- satu hot stream,
- head-of-line blocking,
- failure satu entity bisa menahan semua entity lain,
- scaling consumer terbatas.

Top 1% engineer tidak bertanya “apakah ordered?”, tetapi:

> Order apa yang dibutuhkan untuk menjaga invariant bisnis?

---

## 8. Memilih Partition Key

Partition key adalah keputusan desain utama super stream.

Partition key ideal harus:

1. **stabil**  
   Tidak berubah sepanjang lifecycle entity.

2. **punya cardinality cukup tinggi**  
   Agar distribusi rata.

3. **berkorelasi dengan ordering requirement**  
   Semua event yang harus urut harus punya key yang sama.

4. **tidak terlalu panas**  
   Jangan pilih key yang membuat satu partition menerima mayoritas traffic.

5. **dapat dihitung oleh producer**  
   Producer harus tahu key saat publish.

6. **tidak mengandung sensitive data mentah**  
   Gunakan id internal atau hash aman bila perlu.

Contoh baik:

| Domain | Partition Key | Alasan |
|---|---|---|
| Case management | `caseId` | Semua transition case butuh order per case |
| Payment ledger event | `accountId` atau `ledgerAccountId` | State balance biasanya per account |
| Notification lifecycle | `notificationId` | Retry/status per notification |
| Tenant audit stream | `tenantId` jika traffic tenant seimbang | Isolasi per tenant, tapi risiko hot tenant |
| Device telemetry | `deviceId` | Order per device |

Contoh buruk:

| Key | Masalah |
|---|---|
| `eventType` | Semua event tipe populer masuk partition sama |
| `country` | Cardinality rendah, hot partition mudah muncul |
| `status` | Cardinality rendah dan berubah-ubah |
| `timestampMinute` | Ordering per entity rusak; burst per waktu |
| random UUID per event | Distribusi rata tapi ordering per entity hilang |

---

## 9. Partition Count

Partition count menentukan batas parallelism dan distribusi storage.

Contoh:

```text
super stream: case-events
partitions: 8
consumer instances in group: up to 8 active partition assignments
```

Jika jumlah consumer lebih kecil dari partition:

```text
4 partitions, 2 consumers
consumer A -> p0, p1
consumer B -> p2, p3
```

Jika jumlah consumer sama dengan partition:

```text
4 partitions, 4 consumers
consumer A -> p0
consumer B -> p1
consumer C -> p2
consumer D -> p3
```

Jika jumlah consumer lebih banyak dari partition:

```text
4 partitions, 6 consumers
4 active consumers, 2 idle/standby depending client/group behavior
```

Heuristik:

- terlalu sedikit partition: scaling terbatas;
- terlalu banyak partition: overhead operational naik;
- partition count lebih sulit dikurangi daripada dinaikkan secara desain;
- pilih berdasarkan throughput, storage, replay, dan expected consumer parallelism;
- jangan pilih angka hanya karena Kafka cluster lain memakai angka itu.

---

## 10. Sizing Awal Partition Count

Gunakan pendekatan engineering, bukan feeling.

Misalnya requirement:

```text
Peak publish rate      = 20,000 msg/s
Avg message size       = 2 KB
Peak write bandwidth   = 40 MB/s logical
Target per partition   = 5 MB/s logical
Minimum partitions     = ceil(40 / 5) = 8
```

Lalu cek consumer:

```text
Per consumer instance processing rate = 1,500 msg/s
Peak consume rate                     = 20,000 msg/s
Minimum active consumers              = ceil(20000 / 1500) = 14
```

Jika ingin satu active consumer per partition, partition minimal harus mendukung consumer parallelism target:

```text
Minimum partitions by consumer = 14
Minimum partitions by write    = 8
Choose at least                = 16, maybe 24/32 depending growth
```

Namun, di RabbitMQ, jangan oversize tanpa observability dan benchmark. Tiap partition adalah stream sendiri dengan metadata, storage, replica, dan operational surface.

Aman untuk part ini:

> Pilih partition count berdasarkan bottleneck nyata: write bandwidth, read parallelism, replay speed, node distribution, dan operational overhead.

---

## 11. Routing Strategy Producer

Producer harus memilih partition.

Secara konseptual ada beberapa strategy:

1. **Hash partitioning**

```text
partition = hash(partitionKey) % partitionCount
```

Cocok untuk:

- per-key ordering,
- distribusi cukup rata,
- producer tidak peduli partition spesifik.

2. **Routing-key mode**

Producer menentukan routing key dan broker/binding mengarahkannya ke partition sesuai binding rule.

Cocok untuk:

- topology eksplisit,
- routing yang ingin dikendalikan dengan binding,
- integrasi dengan exchange mental model.

3. **Explicit partition selection**

Producer memilih partition tertentu.

Cocok untuk:

- tool/admin/replay khusus,
- migration,
- controlled test,
- advanced custom partitioner.

Risiko:

- producer terlalu tahu topology internal;
- reconfiguration lebih susah;
- hot partition bisa makin parah.

---

## 12. Hash Partitioning: Benar dan Salah

Misalnya contract event:

```json
{
  "messageId": "01J...",
  "messageType": "enforcement.case.status.changed.v1",
  "schemaVersion": 1,
  "partitionKey": "CASE-2026-000123",
  "payload": {
    "caseId": "CASE-2026-000123",
    "fromStatus": "UNDER_REVIEW",
    "toStatus": "ESCALATED"
  }
}
```

Producer menggunakan `partitionKey`.

```text
hash("CASE-2026-000123") % 8 = 3
```

Semua event case itu masuk partition 3.

Benar:

- `case.opened`
- `evidence.submitted`
- `risk.score.updated`
- `case.escalated`
- `case.closed`

semuanya memakai `caseId` yang sama.

Salah:

- `case.opened` pakai `caseId`
- `evidence.submitted` pakai `evidenceId`
- `risk.score.updated` pakai `subjectId`
- `case.closed` pakai random UUID

Akibat:

- event satu case tersebar ke partition berbeda;
- ordering per case hilang;
- projection case state rawan out-of-order;
- consumer harus menyelesaikan masalah yang seharusnya diselesaikan di routing design.

---

## 13. Consumer Group Mental Model

Super stream consumer group memungkinkan beberapa consumer instance membaca logical stream yang sama dengan partition assignment.

Model sederhana:

```text
super stream: case-events
partitions: p0, p1, p2, p3
consumer group: projection-case-summary

instance A -> p0, p1
instance B -> p2
instance C -> p3
```

Jika instance B mati:

```text
instance A -> p0, p1, p2
instance C -> p3
```

Jika instance D join:

```text
instance A -> p0
instance C -> p3
instance D -> p1 or p2
...
```

Tujuan:

- setiap partition punya satu active consumer dalam group;
- order per partition tetap aman;
- consumer instance dapat scale horizontally;
- failure consumer menyebabkan reassignment.

---

## 14. Single Active Consumer dalam Super Stream

Single active consumer penting untuk menjaga hanya satu consumer aktif pada partition tertentu dalam group.

Tanpa kontrol ini, dua consumer bisa membaca partition sama dan memproses event yang sama/bertabrakan dalam konteks tertentu.

Dengan single active consumer:

```text
partition-0 -> active consumer A
partition-1 -> active consumer B
partition-2 -> active consumer C
```

Jika A mati:

```text
partition-0 -> active consumer D
```

Hal ini menjaga continuity sambil memungkinkan failover.

Namun perlu dipahami:

- failover bisa menyebabkan duplicate processing;
- offset commit timing menentukan replay range;
- consumer handler tetap harus idempotent;
- business state transition tetap harus guarded.

Single active consumer bukan exactly-once guarantee.

---

## 15. Offset dalam Super Stream

Setiap partition punya offset sendiri.

```text
case-events-0 offset: 120938
case-events-1 offset: 442901
case-events-2 offset: 88102
case-events-3 offset: 990012
```

Consumer group logical progress adalah gabungan offset per partition.

Konsekuensi:

1. Lag harus dilihat per partition.
2. Replay bisa dilakukan per partition.
3. Hot partition terlihat dari lag partition tertentu.
4. Offset store harus memahami partition.
5. Projection rebuild harus tahu semua partition selesai sampai point tertentu.

Jangan membuat metric seperti:

```text
consumer_lag = total_latest_offset - total_committed_offset
```

lalu berhenti di situ.

Lebih berguna:

```text
lag_by_partition
max_lag_partition
p95_partition_lag
oldest_unprocessed_timestamp_by_partition
hot_partition_id
```

---

## 16. Hot Partition

Hot partition terjadi ketika satu atau beberapa partition menerima traffic jauh lebih besar daripada yang lain.

Penyebab umum:

1. Partition key cardinality rendah.
2. Satu tenant/entity sangat aktif.
3. Routing strategy salah.
4. Hash distribution buruk.
5. Event type populer diarahkan ke satu key.
6. Partition count terlalu kecil.

Contoh:

```text
partition key = tenantId

Tenant A: 80% traffic
Tenant B: 10%
Tenant C: 5%
Tenant D: 5%
```

Walaupun partition count = 16, tenant A tetap hanya masuk satu partition jika hash berdasarkan tenant.

Solusi mungkin:

1. Pilih key lebih granular:

```text
tenantId + caseId
```

2. Split hot tenant ke super stream khusus.
3. Gunakan composite partition key.
4. Gunakan workload segregation.
5. Tambah partition jika masalahnya distribusi umum, bukan satu key tunggal.
6. Revisit domain ordering requirement.

Trade-off composite key:

```text
tenantId + caseId
```

Bagus untuk distribusi, tetapi ordering hanya per case, bukan semua event tenant.

Kalau memang ordering semua tenant dibutuhkan, kamu harus menerima bottleneck tenant tersebut atau mendesain sequencer khusus.

---

## 17. Rebalancing dan Failure

Ketika consumer group berubah, partition assignment bisa berubah.

Events:

- consumer join;
- consumer leave gracefully;
- consumer crash;
- network glitch;
- broker detects inactive consumer;
- deployment rolling update;
- partition/node issue.

Rebalancing consequence:

1. Ada jeda consumption untuk partition tertentu.
2. Event terakhir yang belum checkpoint bisa diproses ulang.
3. Handler harus idempotent.
4. Offset commit harus dilakukan setelah side effect aman.
5. Metrics bisa menunjukkan lag spike sementara.

Golden rule:

> Treat partition reassignment as normal operation, not exceptional disaster.

Consumer harus dirancang agar aman ketika:

```text
consume event E
write DB succeeded
process crashes before offset stored
new consumer starts from previous offset
consume E again
```

Solusinya tetap sama:

- idempotency table,
- unique business transition constraint,
- message id dedupe,
- aggregate version guard,
- offset stored in same transaction as projection update bila perlu.

---

## 18. Topology Naming

Naming yang buruk membuat super stream susah dioperasikan.

Contoh naming baik:

```text
super stream logical name:
  reg.case-events.v1

partition streams:
  reg.case-events.v1-0
  reg.case-events.v1-1
  reg.case-events.v1-2
  reg.case-events.v1-3

consumer group:
  case-summary-projection.v1
  escalation-detector.v1
  audit-exporter.v1
```

Prinsip:

1. Include domain/bounded context.
2. Include semantic stream name.
3. Include version jika breaking contract mungkin terjadi.
4. Jangan include environment dalam nama jika vhost sudah environment-specific.
5. Jangan include instance id dalam stream name.
6. Consumer group name harus stabil.

Smell:

```text
stream1
new-stream
case-events-test-final
rabbitmq-events
all-events
```

---

## 19. Creating Super Streams

Ada beberapa pendekatan:

1. CLI/tooling RabbitMQ streams.
2. Java Stream Client topology creation.
3. Infrastructure-as-code/script.
4. Pre-provisioned broker definitions.
5. Operator/Helm/Kubernetes automation.

Untuk production, hindari aplikasi bisnis sembarangan membuat/mengubah partition topology pada runtime.

Lebih aman:

```text
Infrastructure pipeline creates super stream.
Application validates existence and properties.
Application fails fast if topology mismatch.
```

Alasannya:

- partition count adalah keputusan kapasitas;
- retention adalah keputusan compliance/cost;
- replica adalah keputusan availability;
- mengubah topology runtime bisa mempengaruhi consumer group;
- auditability lebih baik jika topology change tercatat di deployment infra.

---

## 20. Java Super Stream Producer: Conceptual Skeleton

API detail dapat berubah antar versi client, jadi skeleton ini sengaja bersifat conceptual. Ide utamanya: producer dibuat terhadap logical super stream, bukan partition individual, lalu routing ditentukan dengan key.

```java
public final class CaseEventStreamPublisher implements AutoCloseable {

    private final Environment environment;
    private final Producer producer;
    private final ObjectMapper objectMapper;

    public CaseEventStreamPublisher(StreamSettings settings, ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;

        this.environment = Environment.builder()
                .uri(settings.uri())
                .build();

        this.producer = environment.producerBuilder()
                .stream(settings.superStreamName())
                // Conceptually: configure routing/hash strategy for super stream.
                // Actual method names depend on Stream Java Client version.
                .build();
    }

    public void publish(CaseEventEnvelope envelope) {
        String partitionKey = envelope.partitionKey(); // usually caseId

        byte[] body = serialize(envelope);

        Message message = producer.messageBuilder()
                .properties()
                    .messageId(envelope.messageId())
                    .correlationId(envelope.correlationId())
                .messageBuilder()
                .applicationProperties()
                    .entry("messageType", envelope.messageType())
                    .entry("schemaVersion", envelope.schemaVersion())
                    .entry("partitionKey", partitionKey)
                    .entry("tenantId", envelope.tenantId())
                .messageBuilder()
                .addData(body)
                .build();

        // Conceptually publish with partition/routing key.
        producer.send(message, confirmationStatus -> {
            if (confirmationStatus.isConfirmed()) {
                // mark outbox row published
            } else {
                // keep outbox row retryable; do not pretend event is safely published
            }
        });
    }

    private byte[] serialize(CaseEventEnvelope envelope) {
        try {
            return objectMapper.writeValueAsBytes(envelope);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Invalid event envelope", e);
        }
    }

    @Override
    public void close() {
        producer.close();
        environment.close();
    }
}
```

The code above is less important than the invariant:

```text
partitionKey must be part of the contract and must be stable.
```

Do not compute partition key from mutable status or local handler state.

---

## 21. Java Super Stream Consumer: Conceptual Skeleton

Consumer group processing must assume:

- partition assignment can change;
- same event can be seen again;
- offset is not business correctness;
- idempotency is mandatory.

```java
public final class CaseProjectionSuperStreamConsumer implements AutoCloseable {

    private final Environment environment;
    private final Consumer consumer;
    private final CaseProjectionHandler handler;

    public CaseProjectionSuperStreamConsumer(
            StreamSettings settings,
            CaseProjectionHandler handler
    ) {
        this.handler = handler;

        this.environment = Environment.builder()
                .uri(settings.uri())
                .build();

        this.consumer = environment.consumerBuilder()
                .stream(settings.superStreamName())
                .name(settings.consumerGroupName())
                .offset(OffsetSpecification.next())
                .messageHandler((context, message) -> {
                    handle(context, message);
                })
                .build();
    }

    private void handle(MessageHandler.Context context, Message message) {
        CaseEventEnvelope envelope = deserialize(message.getBodyAsBinary());

        ProcessingResult result = handler.apply(envelope);

        if (result.success()) {
            // Store offset only after business side effect is safe.
            context.storeOffset();
        } else if (result.retryable()) {
            // Do not store offset if you intentionally want replay later.
            // But avoid infinite poison blocking; use quarantine strategy.
            throw new RetryableStreamProcessingException(result.reason());
        } else {
            // For poison message, write quarantine record, then store offset.
            handler.quarantine(envelope, result.reason());
            context.storeOffset();
        }
    }

    @Override
    public void close() {
        consumer.close();
        environment.close();
    }
}
```

Important nuance:

In queue consumption, ack removes the message for that consumer flow. In stream consumption, storing offset advances position. The message remains in the stream until retention removes it.

---

## 22. Offset Store Strategy for Super Streams

Ada dua strategi umum:

### 22.1 Broker-side offset store

Consumer menggunakan mechanism client/broker untuk menyimpan offset.

Cocok untuk:

- simple consumer,
- at-least-once processing,
- tidak perlu atomicity kuat antara DB projection dan offset.

Risiko:

```text
DB commit succeeded
process crashes before offset store
event replayed
```

Harus idempotent.

### 22.2 Application-side offset store

Aplikasi menyimpan offset di database bersama projection state.

Contoh table:

```sql
CREATE TABLE stream_consumer_offsets (
    consumer_group      VARCHAR(200) NOT NULL,
    stream_name         VARCHAR(200) NOT NULL,
    partition_name      VARCHAR(200) NOT NULL,
    offset_value        BIGINT NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_group, stream_name, partition_name)
);
```

Lalu dalam transaksi yang sama:

```text
BEGIN
  apply projection update
  insert processed_message(message_id)
  update offset for partition
COMMIT
```

Cocok untuk:

- projection penting,
- regulatory audit read model,
- state rebuild yang harus deterministic,
- exactly-once effect approximation via idempotent DB transaction.

Tetap bukan exactly-once broker semantics, tetapi efek bisnis bisa dibuat effectively-once.

---

## 23. Super Stream dan Replay

Replay super stream berarti membaca ulang semua partition.

Mode replay:

1. Dari beginning semua partition.
2. Dari timestamp semua partition.
3. Dari stored offset per partition.
4. Dari offset khusus untuk partition tertentu.
5. Replay subset partition untuk incident/debug.

Projection rebuild flow:

```text
1. Stop live projection consumer or use separate rebuild consumer group.
2. Create new projection table/version.
3. Read all partitions from beginning or checkpoint.
4. Apply idempotent projection logic.
5. Track per-partition progress.
6. When caught up, switch read model alias/version.
```

Masalah umum:

- partition A selesai jauh lebih cepat dari partition B;
- hot partition menentukan total rebuild time;
- timestamp replay tidak selalu menghasilkan boundary bisnis sempurna;
- event schema lama harus tetap bisa dibaca;
- replay consumer bisa membebani broker dan DB.

---

## 24. Lag dan Monitoring

Untuk super stream, metric global saja tidak cukup.

Pantau:

```text
publish_rate_by_partition
consume_rate_by_partition
lag_by_partition
oldest_unprocessed_timestamp_by_partition
consumer_assignment_by_partition
consumer_rebalance_count
consumer_error_count
offset_store_failure_count
hot_partition_ratio
confirm_latency
publish_error_count
storage_bytes_by_partition
retention_age_by_partition
```

Derived metric berguna:

```text
hot_partition_ratio = max(partition_publish_rate) / avg(partition_publish_rate)
```

Jika ratio tinggi:

- partition key mungkin buruk;
- ada tenant/entity hot;
- event storm terjadi pada satu aggregate;
- downstream consumer lambat pada partition tertentu.

Alert yang baik:

```text
IF max_partition_lag_age > 10 minutes FOR 5 minutes
THEN alert projection team
```

Alert yang buruk:

```text
IF total messages > X
THEN alert
```

Karena total messages pada stream adalah normal akibat retention.

---

## 25. Failure Walkthrough: Consumer Crash

Scenario:

```text
super stream: case-events
partition: case-events-2
consumer group: escalation-detector.v1
active consumer: detector-instance-3
```

Timeline:

```text
T1 consume message M offset 88100
T2 detector writes escalation recommendation to DB
T3 process crashes before offset stored
T4 consumer group reassigns partition to detector-instance-5
T5 detector-instance-5 starts from offset 88099 or 88100 depending stored offset
T6 M is processed again
```

Correct design:

```sql
CREATE TABLE processed_messages (
    consumer_group VARCHAR(200) NOT NULL,
    message_id VARCHAR(200) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_group, message_id)
);
```

Handler transaction:

```text
BEGIN
  INSERT processed_messages(...)
  IF duplicate THEN skip side effect
  ELSE create/update escalation recommendation
  UPDATE offset
COMMIT
```

Result:

- duplicate message is harmless;
- partition reassignment is safe;
- state transition remains defensible.

---

## 26. Failure Walkthrough: Hot Tenant

Scenario:

```text
partition key = tenantId
partitions = 8
Tenant BIGBANK = 70% traffic
```

Symptoms:

```text
partition-3 publish rate = 14,000 msg/s
other partitions avg     = 800 msg/s
partition-3 lag grows
consumer assigned p3 overloaded
other consumers mostly idle
```

Wrong response:

```text
Add more consumer instances.
```

Why wrong?

Because partition-3 still has one active consumer in group if preserving partition order. Extra consumers cannot split that partition without sacrificing order.

Better options:

1. Change partition key to `tenantId + caseId` if ordering per tenant is not actually needed.
2. Create dedicated super stream for BIGBANK.
3. Split tenant workload by business subdomain.
4. Use a sequencer/projector for the small part that truly needs tenant-level ordering.
5. Increase partition count only if key distribution can benefit.

The architectural question:

> Do we require ordering across all events of tenant BIGBANK, or only per case/account/workflow?

Most systems only require per aggregate ordering.

---

## 27. Failure Walkthrough: Partition Count Too Low

Scenario:

```text
partitions = 3
consumer processing capacity per instance = 1,000 msg/s
peak = 10,000 msg/s
```

Even with 10 consumer instances, active parallelism is constrained by partition count.

Symptoms:

```text
3 consumers active
7 consumers idle/standby
lag grows on all partitions
CPU low on consumer deployment overall
```

Fix options:

1. Increase partition count with migration plan.
2. Create new versioned super stream with more partitions.
3. Dual publish during migration window.
4. Start new consumer group on new stream.
5. Retire old stream after retention/compatibility window.

Avoid assuming partition count can be changed with zero design consequence. It affects routing, ordering, replay, lag metrics, and possibly stored offsets.

---

## 28. Migration: Stream to Super Stream

Suppose you started with:

```text
stream: case-events.v1
```

Now volume grows. You want:

```text
super stream: case-events.v2
partitions: 16
partition key: caseId
```

Migration plan:

```text
1. Define v2 contract if needed.
2. Create super stream v2.
3. Update publisher to dual publish v1 and v2, or switch through outbox relay.
4. Start consumers on v2 with new consumer group.
5. Validate projection parity between v1 and v2.
6. Move downstream dependencies to v2.
7. Stop v1 publishing.
8. Keep v1 for retention window.
9. Remove v1 after audit/compliance approval.
```

If dual publish from app is risky, prefer outbox relay:

```text
DB outbox -> relay publishes to old stream and new super stream with confirms
```

This centralizes publish correctness.

---

## 29. Super Stream and DLQ/Quarantine

Streams do not behave like queues where poison messages can simply be dead-lettered out of the main queue in the same way.

For stream consumers, poison handling is usually application-level:

```text
consume message
try process
if poison:
  write quarantine record/table/queue
  store offset so stream progress can continue
```

Quarantine target options:

1. Database table:

```sql
CREATE TABLE stream_quarantine (
    id BIGSERIAL PRIMARY KEY,
    consumer_group VARCHAR(200) NOT NULL,
    stream_name VARCHAR(200) NOT NULL,
    partition_name VARCHAR(200) NOT NULL,
    offset_value BIGINT NOT NULL,
    message_id VARCHAR(200),
    reason_code VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL
);
```

2. RabbitMQ quorum queue for remediation:

```text
stream consumer -> publish poison summary to reg.case-events.quarantine.q
```

3. Separate quarantine stream:

```text
case-events-quarantine
```

For regulatory workflows, database quarantine is often strongest because remediation status, actor, reason, and audit trail can be modeled explicitly.

---

## 30. Super Streams in Regulatory Case Management

Target domain:

```text
case opened
subject linked
evidence submitted
risk score updated
review assigned
escalation triggered
enforcement action proposed
case closed
```

Need:

- replayable audit history,
- per-case ordering,
- parallel projection rebuild,
- multiple independent consumers,
- high-volume evidence/risk events,
- defensible reconstruction.

Design:

```text
Super Stream:
  reg.case-events.v1

Partition key:
  caseId

Partitions:
  16 initially

Producer:
  case-command-service
  evidence-service
  risk-scoring-service
  review-service

Consumer groups:
  case-summary-projection.v1
  escalation-detector.v1
  notification-policy-evaluator.v1
  audit-exporter.v1
  search-index-projector.v1
```

Message envelope:

```json
{
  "messageId": "01JZ...",
  "messageType": "reg.case.evidence.submitted.v1",
  "schemaVersion": 1,
  "partitionKey": "CASE-2026-000123",
  "correlationId": "corr-...",
  "causationId": "cmd-...",
  "tenantId": "tenant-a",
  "occurredAt": "2026-06-19T08:15:30Z",
  "publishedAt": "2026-06-19T08:15:31Z",
  "producer": "evidence-service",
  "reasonCode": "USER_SUBMISSION",
  "policyVersion": "evidence-policy-2026.04",
  "payload": {
    "caseId": "CASE-2026-000123",
    "evidenceId": "EVD-90001",
    "classification": "BANK_STATEMENT",
    "submittedBy": "officer-17"
  }
}
```

Invariant:

```text
All events affecting one case state machine must use the same partitionKey = caseId.
```

This allows:

- per-case order;
- parallelism across cases;
- deterministic projection;
- replayable audit;
- controlled failure handling.

---

## 31. Case Study: Escalation Detector

Escalation detector consumes `reg.case-events.v1`.

It detects patterns:

```text
risk score high
+ evidence category suspicious
+ deadline breached
=> create escalation recommendation
```

State table:

```sql
CREATE TABLE case_escalation_state (
    case_id VARCHAR(100) PRIMARY KEY,
    latest_risk_score NUMERIC,
    suspicious_evidence_count INT NOT NULL,
    deadline_breached BOOLEAN NOT NULL,
    escalation_recommended BOOLEAN NOT NULL,
    aggregate_version BIGINT NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

Processed messages:

```sql
CREATE TABLE escalation_processed_messages (
    message_id VARCHAR(200) PRIMARY KEY,
    case_id VARCHAR(100) NOT NULL,
    partition_name VARCHAR(200) NOT NULL,
    offset_value BIGINT NOT NULL,
    processed_at TIMESTAMP NOT NULL
);
```

Processing invariant:

```text
For each message:
  1. dedupe by messageId
  2. update case_escalation_state
  3. if threshold crossed and not already recommended, emit command/event
  4. store offset/progress
```

Do not rely on stream offset alone to avoid duplicate escalation.

Use business unique constraint:

```sql
CREATE UNIQUE INDEX uq_escalation_once
ON escalation_recommendations(case_id)
WHERE status IN ('OPEN', 'PENDING_REVIEW');
```

This is what makes the system defensible.

---

## 32. Producer Backpressure

Super stream increases capacity, but it does not remove backpressure.

Producer must handle:

- confirm latency increase;
- unavailable partition leader;
- connection blocked;
- in-flight confirm queue growth;
- broker/network failure;
- serialization failure;
- unroutable partition/routing problem;
- outbox relay backlog.

Use bounded in-flight publishes:

```text
maxInFlight = 10_000
if inFlight >= maxInFlight:
  stop reading outbox temporarily
```

Do not let outbox relay load millions of unconfirmed messages into memory.

Safe outbox relay loop:

```text
while running:
  rows = fetch unpublished outbox rows limit N
  publish with confirm callback
  mark published only after confirm
  if confirm latency high, reduce batch size
  if broker unavailable, backoff
```

---

## 33. Consumer Backpressure

Consumer must handle downstream pressure.

Backpressure sources:

- DB slow;
- external API slow;
- projection lock contention;
- poison message;
- hot partition;
- batch size too large;
- offset store slow.

Strategies:

1. Bound internal worker queues.
2. Process partition serially if order matters.
3. Store offset after durable side effect.
4. Pause/reduce consumption if downstream is degraded.
5. Quarantine poison messages.
6. Split heavy side effects out of projection path.
7. Use async command queue for slow external calls.

Do not process messages from one partition concurrently unless you can prove business ordering is irrelevant or guarded by version constraints.

---

## 34. Super Stream Anti-Patterns

### Anti-pattern 1: Super stream for everything

Using one giant super stream for all domains:

```text
company.all-events.v1
```

Problems:

- contract chaos;
- security/tenant concerns;
- retention requirements conflict;
- consumer filtering burden;
- hot domain affects all;
- ownership unclear.

Better:

```text
reg.case-events.v1
reg.notification-events.v1
reg.audit-events.v1
risk.scoring-events.v1
```

### Anti-pattern 2: partition key = event type

```text
partitionKey = "EvidenceSubmitted"
```

This destroys per-case ordering and creates hot partitions.

### Anti-pattern 3: assuming more consumers always help

Consumers cannot split one hot partition while preserving order.

### Anti-pattern 4: offset as correctness guarantee

Offset says where consumer is. It does not prove business side effect is correct, unique, or complete.

### Anti-pattern 5: no replay plan

If you use streams but cannot replay safely, you are only using streams as expensive queues.

### Anti-pattern 6: no schema evolution plan

Replay will eventually encounter old event versions.

### Anti-pattern 7: global ordering fantasy

Global ordering requirement often masks missing aggregate boundary.

### Anti-pattern 8: partition count copied from another system

Partition count must come from workload and failure model.

---

## 35. Design Checklist

Before using super stream, answer:

1. What logical stream are we modelling?
2. Why is a normal stream insufficient?
3. What is the required ordering scope?
4. What partition key preserves that ordering?
5. What is expected key cardinality?
6. What are the known hot key risks?
7. How many partitions are needed for write throughput?
8. How many partitions are needed for consumer parallelism?
9. What retention policy is required?
10. What replica/availability requirement exists?
11. How will producers handle confirms?
12. How will producer deduplication work?
13. How will consumers store offset?
14. How will consumers dedupe messages?
15. How will poison messages be quarantined?
16. How will replay be performed?
17. How will old schema versions be handled?
18. What metrics show hot partitions?
19. What is the migration plan if partition count is wrong?
20. Who owns topology changes?

---

## 36. Decision Matrix

| Requirement | Stream | Super Stream | Queue / Quorum Queue | Kafka |
|---|---:|---:|---:|---:|
| Work distribution with destructive ack | Weak | Weak | Strong | Medium |
| Replay history | Strong | Strong | Weak | Strong |
| Partitioned high-throughput stream | Medium | Strong | Weak | Strong |
| Broker-side routing richness | Medium | Medium/Strong | Strong | Weak/Medium |
| Per-key ordering with parallelism | Medium | Strong | Medium with sharding | Strong |
| Operational simplicity | Medium | Medium/Complex | Medium | Complex |
| RabbitMQ ecosystem integration | Strong | Strong | Strong | Weak |
| Large-scale event platform | Medium | Medium/Strong | Weak | Strong |
| Workflow command queues | Weak | Weak | Strong | Weak/Medium |
| Audit stream for case system | Strong | Strong if high volume | Weak | Strong |

---

## 37. Practical Heuristics

1. Start with stream if volume is moderate and replay is needed.
2. Move to super stream when you need partitioned scaling.
3. Partition by aggregate id when state transition ordering matters.
4. Do not partition by event type unless event type is truly the aggregate boundary, which is rare.
5. Consumer count cannot exceed useful partition parallelism.
6. Hot partition is usually a domain modelling problem, not just infrastructure shortage.
7. Store offset after side effect, not before.
8. Use idempotency even with single active consumer.
9. Monitor lag per partition, not only total lag.
10. Treat replay as a first-class design path.
11. Version stream names when changing partitioning or contract semantics.
12. Do not use super stream to avoid designing bounded contexts.
13. Use queue for work that must disappear after processing.
14. Use stream/super stream for history that must remain replayable.
15. Use RabbitMQ Super Streams when you need partitioned stream capability inside RabbitMQ ecosystem.

---

## 38. Mini Lab

### Lab 1 — Partition Key Analysis

Given events:

```text
case opened
case assigned
evidence submitted
risk score updated
case escalated
case closed
```

Try partition keys:

1. `caseId`
2. `tenantId`
3. `eventType`
4. `officerId`
5. random UUID

For each key, answer:

- Is per-case ordering preserved?
- Is distribution likely good?
- What hot key risk exists?
- What business invariant might break?

Expected conclusion:

```text
caseId is usually the best default for case lifecycle stream.
```

### Lab 2 — Consumer Group Assignment

Assume:

```text
partitions = 8
consumer instances = 3
```

Sketch possible assignment.

Then answer:

- What happens if one instance crashes?
- What duplicate processing window exists?
- Where should idempotency be enforced?

### Lab 3 — Hot Tenant Diagnosis

Assume lag:

```text
p0 lag age = 2s
p1 lag age = 3s
p2 lag age = 20m
p3 lag age = 1s
p4 lag age = 2s
p5 lag age = 1s
p6 lag age = 2s
p7 lag age = 3s
```

Questions:

- Is this global consumer issue or partition-specific issue?
- What metrics do you inspect next?
- What partition key issue might exist?
- Does adding 10 consumers solve it?

### Lab 4 — Replay Plan

Design replay for `case-summary-projection.v2` from `reg.case-events.v1`.

Include:

- offset starting point;
- target table version;
- schema compatibility;
- progress per partition;
- cutover strategy;
- rollback strategy.

---

## 39. Review Questions

1. What is a super stream?
2. Why does super stream exist?
3. What is the ordering guarantee of a super stream?
4. Why is partition key the central design choice?
5. Why is `eventType` usually a bad partition key?
6. Why can consumer count greater than partition count be wasteful?
7. What is hot partition?
8. How do you detect hot partition?
9. What is single active consumer’s role in super streams?
10. Why does single active consumer not remove the need for idempotency?
11. How does replay differ between stream and super stream?
12. Why should lag be tracked per partition?
13. How would you migrate from stream to super stream?
14. What is the difference between offset progress and business correctness?
15. When should Kafka still be preferred?

---

## 40. Final Mental Model

A RabbitMQ stream gives you a replayable log.

A RabbitMQ super stream gives you a replayable log that can be partitioned.

But partitioning is not free. It moves complexity into:

- partition key design,
- ordering scope,
- consumer group coordination,
- offset tracking,
- hot partition detection,
- replay planning,
- migration strategy.

The central invariant is:

```text
Messages that must be processed in order must share the same partition key.
Messages that can be processed independently should be allowed to spread across partitions.
```

For Java systems, the implementation detail is secondary. The architecture is decided by:

```text
aggregate boundary
+ ordering requirement
+ throughput target
+ replay requirement
+ idempotency model
+ operational ownership
```

Get those right, and Super Streams become a powerful primitive. Get them wrong, and you have built a distributed hot-partition generator with a nice API.

---

## 41. What Comes Next

Part berikutnya:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-19.md
```

Topik:

```text
Stream Deduplication, Filtering, and Replay Patterns
```

Kita akan membahas lebih dalam:

- producer deduplication;
- producer name;
- publishing id;
- strict monotonic sequence;
- stream filtering;
- replay from offset/timestamp/beginning;
- projection rebuild;
- quarantine;
- replay safety;
- audit reconstruction.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-17.md">⬅️ Part 17 — RabbitMQ Stream Java Client</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-19.md">Learn RabbitMQ Messaging & Streaming Mastery for Java Engineers ➡️</a>
</div>

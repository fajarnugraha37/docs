# learn-kafka-event-streaming-mastery-for-java-engineers-part-019.md

# Part 019 — Kafka Streams Fundamentals for Java Engineers

> Seri: Kafka, Kafka Connect, ksqlDB, Kafka Streams, dan Event Streaming Mastery untuk Java Software Engineer  
> Bagian: 019 dari 034  
> Status seri: belum selesai  
> Fokus: memahami Kafka Streams sebagai library Java untuk membangun aplikasi stream processing yang fault-tolerant, scalable, stateful, dan Kafka-native.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan apa itu Kafka Streams dan mengapa ia berbeda dari Kafka Consumer API biasa.
2. Memahami Kafka Streams sebagai **Java library**, bukan cluster processing terpisah seperti Flink/Spark.
3. Memahami building block utama: `StreamsBuilder`, `Topology`, `KStream`, `KTable`, `GlobalKTable`, `Processor`, `Task`, `Thread`, dan `StateStore`.
4. Mendesain mental model scaling Kafka Streams berdasarkan partition-task mapping.
5. Menjelaskan hubungan antara topic partition, stream task, stream thread, dan application instance.
6. Membaca topology Kafka Streams dan menalar konsekuensi operasionalnya.
7. Menulis aplikasi Kafka Streams sederhana dengan Java.
8. Memahami kapan memakai Kafka Streams, kapan memakai ksqlDB, kapan memakai plain consumer, dan kapan memakai engine lain.
9. Menghindari anti-pattern umum seperti memperlakukan Kafka Streams sebagai batch job, menyembunyikan repartitioning cost, atau membuat stateful processor tanpa memahami changelog.
10. Membangun fondasi untuk part berikutnya: RocksDB, changelog, restore, standby replica, interactive query, joins, windowing, dan exactly-once semantics.

---

## 2. Posisi Kafka Streams dalam Ekosistem Kafka

Sampai part sebelumnya, kita sudah membahas:

- Kafka sebagai distributed log.
- Producer dan consumer.
- Consumer group dan rebalance.
- Delivery semantics.
- Event design.
- Schema governance.
- Topic governance.
- Log compaction dan KTable mental model.
- Security.
- Kafka Connect.
- CDC.
- ksqlDB.

Kafka Streams berada di titik yang berbeda dari Kafka Connect dan ksqlDB.

Kafka Connect menjawab:

> “Bagaimana memindahkan data dari/ke Kafka dengan connector reusable?”

ksqlDB menjawab:

> “Bagaimana membuat stream processing dengan SQL-like interface di atas Kafka?”

Kafka Streams menjawab:

> “Bagaimana membangun aplikasi stream processing langsung di Java dengan kontrol penuh atas kode, deployment, state, error handling, domain logic, testing, dan integrasi aplikasi?”

Kafka Streams bukan broker. Kafka Streams bukan service cluster terpisah. Kafka Streams bukan connector framework. Kafka Streams adalah **library Java** yang kamu embed ke aplikasi. Aplikasi itu kemudian membaca topic Kafka, memproses record, menyimpan state lokal bila perlu, dan menulis hasil ke Kafka lagi.

Mental model paling sederhana:

```text
Kafka topic(s)  ->  Java application using Kafka Streams  ->  Kafka topic(s)
```

Namun mental model production yang lebih benar:

```text
Input topic partitions
        |
        v
Kafka Streams runtime
  - consumer group
  - stream tasks
  - stream threads
  - topology graph
  - serializers/deserializers
  - optional local state stores
  - optional internal repartition topics
  - optional changelog topics
        |
        v
Output topic partitions / materialized state / external query layer
```

Kafka Streams memakai Kafka consumer group protocol di bawahnya. Jadi scaling, partition ownership, rebalance, offset, dan fault tolerance tetap berakar pada konsep Kafka yang sudah dibahas di part 006–008.

---

## 3. Definisi Inti: Apa Itu Kafka Streams?

Kafka Streams adalah client library untuk membangun aplikasi dan microservice yang membaca data dari Kafka, melakukan transformasi/aggregation/join/windowing, dan menulis hasilnya kembali ke Kafka.

Karakteristik penting:

1. **Library, bukan cluster service**  
   Tidak ada Kafka Streams server yang perlu dikelola terpisah. Kamu menjalankan aplikasi Java seperti service biasa.

2. **Kafka-native**  
   Input, output, offset, partitioning, fault tolerance, changelog, dan repartitioning semuanya berbasis Kafka topic.

3. **Scalable horizontal**  
   Tambah instance aplikasi, Kafka Streams akan mendistribusikan task berdasarkan partition.

4. **Fault-tolerant**  
   Bila instance mati, task-nya dipindahkan ke instance lain. Bila ada state lokal, state bisa dipulihkan dari changelog topic.

5. **Stateful**  
   Kafka Streams bisa menyimpan local state store, umumnya berbasis RocksDB untuk persistent key-value state.

6. **Event-time aware**  
   Kafka Streams mendukung timestamp extractor, windowing, grace period, dan late record handling.

7. **Exactly-once capable untuk Kafka-to-Kafka processing**  
   Dengan konfigurasi processing guarantee yang sesuai, Kafka Streams dapat menggunakan transaksi Kafka untuk membaca, memproses, dan menulis hasil secara atomic dalam batas Kafka.

8. **Composable DSL dan Processor API**  
   Kamu bisa memakai high-level DSL (`KStream`, `KTable`) atau low-level Processor API untuk kontrol detail.

---

## 4. Masalah Apa yang Diselesaikan Kafka Streams?

Kafka Consumer API memberi kemampuan membaca record. Namun saat kebutuhan berkembang, kamu akan mulai menulis banyak plumbing:

- Bagaimana maintain offset dengan benar?
- Bagaimana melakukan parallelism sesuai partition?
- Bagaimana melakukan aggregation dengan local state?
- Bagaimana restore state setelah crash?
- Bagaimana materialized view dibuat dari stream?
- Bagaimana join stream dengan table?
- Bagaimana windowing berdasarkan event time?
- Bagaimana menangani rebalancing sambil mempertahankan state?
- Bagaimana membuat topology transformation yang bisa diuji?
- Bagaimana menjaga correctness saat repartitioning?

Kafka Streams menyediakan runtime dan abstraction untuk semua itu.

Plain consumer cocok untuk:

```text
Consume -> validate -> call service/database -> commit offset
```

Kafka Streams cocok untuk:

```text
Consume -> transform/filter/enrich/aggregate/join/window -> maintain state -> emit derived stream/table
```

Contoh use case:

1. Membuat projection status case terbaru dari event lifecycle.
2. Menghitung SLA breach candidate secara streaming.
3. Menggabungkan enforcement event dengan reference table aktif.
4. Membuat fraud signal dari sequence event.
5. Mengagregasi payment events per account per window.
6. Menghasilkan notification command dari state transition event.
7. Mengubah CDC table stream menjadi domain-friendly materialized event stream.
8. Membuat near-real-time read model untuk dashboard.

---

## 5. Kafka Streams vs Plain Kafka Consumer

Perbandingan sederhana:

| Aspek | Plain Consumer API | Kafka Streams |
|---|---|---|
| Level abstraction | Low-level | Higher-level stream processing |
| Offset handling | Manual/auto oleh aplikasi | Dikelola runtime Streams |
| Transformation graph | Kamu tulis sendiri | Topology eksplisit |
| Stateful processing | Manual | Built-in state store |
| Repartitioning | Manual | Bisa otomatis melalui internal topic |
| Changelog | Manual | Built-in untuk state store |
| Windowing | Manual sulit | Built-in |
| Join | Manual kompleks | Built-in DSL |
| Testing topology | Manual | `TopologyTestDriver` |
| Deployment | App/service biasa | App/service biasa |
| Cocok untuk | Side-effect worker, simple consumer | Stream processing, materialized view, event derivation |

Plain consumer memberi kontrol penuh, tetapi kamu harus membangun runtime semantics sendiri. Kafka Streams memberi abstraction stream processing, tetapi kamu harus memahami konsekuensi internal topic, repartitioning, state store, dan task assignment.

Jangan memilih Kafka Streams hanya karena ingin “lebih modern”. Pilih Kafka Streams jika problem kamu memang stream processing.

---

## 6. Kafka Streams vs ksqlDB

Karena part 017–018 sudah membahas ksqlDB, sekarang kita bandingkan dengan Kafka Streams.

| Aspek | ksqlDB | Kafka Streams |
|---|---|---|
| Interface | SQL-like | Java API |
| Deployment | ksqlDB server/cluster | Aplikasi Java sendiri |
| Logic complexity | Bagus untuk declarative stream processing | Bagus untuk custom domain logic |
| Testing | Lebih query/config oriented | Bisa unit/integration test seperti Java code |
| Operational model | Query pada ksqlDB runtime | Service milik tim aplikasi |
| Extensibility | UDF/UDAF, terbatas dibanding full Java | Full Java ecosystem |
| Use case | Projection, filtering, aggregation deklaratif | Complex processing, custom enrichment, domain workflow |
| Ownership | Data/platform team friendly | Application engineering friendly |

Gunakan ksqlDB jika:

- Transformasi bisa diekspresikan dengan SQL-like query.
- Tim ingin cepat membuat stream/table derived view.
- Logic tidak membutuhkan banyak branching domain-specific.
- Platform ingin self-service query layer di atas Kafka.

Gunakan Kafka Streams jika:

- Logic kompleks dan domain-heavy.
- Butuh integration dengan Java library internal.
- Butuh testing granular.
- Butuh error handling custom.
- Butuh deployment sebagai microservice biasa.
- Butuh explicit code review, ADR, dan lifecycle engineering.

Untuk Java engineer senior, Kafka Streams sering menjadi pilihan lebih natural saat stream processing adalah bagian dari aplikasi domain, bukan sekadar data transformation.

---

## 7. Kafka Streams vs Spark/Flink

Kafka Streams sering dibandingkan dengan Flink atau Spark Structured Streaming. Perbandingan ini harus hati-hati.

Kafka Streams:

- Library Java embedded.
- Kafka-first.
- Ringan secara operational.
- Cocok untuk microservice stream processing.
- State lokal per instance.
- Scaling berdasarkan Kafka partition.
- Sangat cocok untuk Kafka-to-Kafka processing.

Flink/Spark:

- Processing engine/cluster/framework lebih besar.
- Cocok untuk workload data processing yang lebih luas.
- Mendukung source/sink lebih beragam.
- Lebih kuat untuk kompleksitas event-time, batch-stream unification, large-scale analytics, dan job orchestration.
- Memiliki operational model tersendiri.

Rule of thumb:

```text
Jika problem-mu adalah domain microservice stream processing di sekitar Kafka,
Kafka Streams sering cukup dan lebih sederhana.

Jika problem-mu adalah large-scale analytical stream processing lintas banyak source/sink,
Flink/Spark mungkin lebih tepat.
```

---

## 8. Core Mental Model: Stream Processing sebagai Topology

Kafka Streams tidak berpikir dalam loop manual:

```java
while (true) {
    ConsumerRecords<K, V> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<K, V> record : records) {
        process(record);
    }
}
```

Kafka Streams berpikir dalam graph/topology:

```text
source topic
   |
   v
filter
   |
   v
map values
   |
   v
group by key
   |
   v
aggregate
   |
   v
sink topic
```

Topology adalah directed acyclic-ish processing graph yang mendefinisikan bagaimana record mengalir dari source processor ke transform processor ke sink processor. Beberapa operasi dapat membuat branch, merge, repartition, join, atau materialized state.

Contoh konseptual:

```text
case-events
   |
   |-- filter(eventType = CASE_CREATED)
   |       |
   |       v
   |   new-case-events
   |
   |-- filter(eventType = CASE_ESCALATED)
           |
           v
       escalation-events
```

Topology penting karena:

1. Ia adalah kontrak eksekusi aplikasi.
2. Ia menentukan internal topic yang mungkin dibuat.
3. Ia menentukan state store yang dibutuhkan.
4. Ia memengaruhi task assignment.
5. Ia menentukan cost runtime.
6. Ia bisa diuji dengan deterministic test.

---

## 9. StreamsBuilder, Topology, dan KafkaStreams

Kafka Streams aplikasi biasanya punya tiga bagian:

1. Build topology.
2. Configure runtime.
3. Start KafkaStreams instance.

Skeleton paling sederhana:

```java
import org.apache.kafka.common.serialization.Serdes;
import org.apache.kafka.streams.KafkaStreams;
import org.apache.kafka.streams.StreamsBuilder;
import org.apache.kafka.streams.StreamsConfig;
import org.apache.kafka.streams.kstream.KStream;

import java.util.Properties;

public class CaseEventStreamApp {

    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(StreamsConfig.APPLICATION_ID_CONFIG, "case-event-stream-app");
        props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass());
        props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass());

        StreamsBuilder builder = new StreamsBuilder();

        KStream<String, String> caseEvents = builder.stream("case-events");

        caseEvents
            .filter((key, value) -> value != null && value.contains("CASE_ESCALATED"))
            .to("case-escalation-events");

        KafkaStreams streams = new KafkaStreams(builder.build(), props);

        Runtime.getRuntime().addShutdownHook(new Thread(streams::close));

        streams.start();
    }
}
```

Mental model:

```text
StreamsBuilder  ->  deklarasi graph
builder.build() ->  Topology
KafkaStreams    ->  runtime yang menjalankan topology
```

`StreamsBuilder` bukan runtime. Ia hanya builder.

`Topology` adalah graph yang dihasilkan.

`KafkaStreams` adalah runtime object yang melakukan:

- connect ke Kafka,
- join consumer group,
- assign tasks,
- poll records,
- execute processors,
- manage state,
- commit progress,
- handle rebalance,
- write output.

---

## 10. KStream: Stream of Facts

`KStream<K, V>` merepresentasikan stream record immutable. Setiap record adalah fakta/event yang berdiri sendiri.

Contoh:

```text
case-events
----------------------------------------------------
offset | key       | value
----------------------------------------------------
0      | CASE-001  | CaseCreated
1      | CASE-001  | CaseAssigned
2      | CASE-001  | CaseEscalated
3      | CASE-002  | CaseCreated
4      | CASE-001  | CaseClosed
```

Sebagai `KStream`, setiap row adalah event individual.

Operasi umum:

- `filter`
- `map`
- `mapValues`
- `flatMap`
- `flatMapValues`
- `peek`
- `branch` atau predicate splitting style baru tergantung versi API
- `selectKey`
- `groupByKey`
- `groupBy`
- `join`
- `leftJoin`
- `to`

Contoh transformasi stateless:

```java
KStream<String, CaseEvent> events = builder.stream(
    "case-events",
    Consumed.with(Serdes.String(), caseEventSerde)
);

KStream<String, CaseEvent> escalations = events
    .filter((caseId, event) -> event != null)
    .filter((caseId, event) -> event.type() == CaseEventType.CASE_ESCALATED);

escalations.to(
    "case-escalation-events",
    Produced.with(Serdes.String(), caseEventSerde)
);
```

KStream cocok untuk:

- domain event,
- command stream,
- audit event,
- metric event,
- clickstream,
- CDC row change stream,
- notification stream.

KStream tidak menyiratkan latest state. Ia adalah urutan perubahan.

---

## 11. KTable: Changelog Stream as Table

`KTable<K, V>` merepresentasikan table yang berubah dari waktu ke waktu. Secara konsep, ia adalah materialized view dari changelog stream keyed by key.

Misal topic compacted:

```text
case-status-changelog
----------------------------------------------------
offset | key       | value
----------------------------------------------------
0      | CASE-001  | OPEN
1      | CASE-002  | OPEN
2      | CASE-001  | ESCALATED
3      | CASE-001  | CLOSED
```

Sebagai KTable, latest state-nya:

```text
CASE-001 -> CLOSED
CASE-002 -> OPEN
```

KTable cocok untuk:

- reference data,
- latest status per entity,
- materialized view,
- aggregation result,
- dimension table,
- stream-table join enrichment.

Contoh:

```java
KTable<String, CaseStatus> caseStatusTable = builder.table(
    "case-status",
    Consumed.with(Serdes.String(), caseStatusSerde)
);
```

Perbedaan penting:

```text
KStream: setiap record adalah event baru.
KTable : setiap record adalah update terhadap latest value untuk key.
```

Jika kamu memperlakukan KTable sebagai KStream, kamu akan salah menafsirkan update sebagai event historis. Jika kamu memperlakukan KStream sebagai KTable, kamu akan kehilangan fakta historis.

---

## 12. GlobalKTable: Full Replicated Table di Setiap Instance

`GlobalKTable<K, V>` adalah table yang direplikasi penuh ke setiap instance Kafka Streams application.

Perbedaan dengan KTable biasa:

```text
KTable:
  - dipartisi
  - setiap task hanya punya subset data
  - join biasanya membutuhkan co-partitioning

GlobalKTable:
  - semua instance punya full copy
  - cocok untuk reference data kecil/menengah
  - tidak membutuhkan co-partitioning untuk KStream-GlobalKTable join
  - lebih mahal dari sisi memory/disk/network bila data besar
```

Contoh use case:

- mapping office code -> region,
- product id -> product category,
- enforcement rule id -> rule metadata,
- country code -> jurisdiction,
- tenant config yang ukurannya kecil.

Contoh:

```java
GlobalKTable<String, JurisdictionInfo> jurisdictions = builder.globalTable(
    "jurisdiction-reference",
    Consumed.with(Serdes.String(), jurisdictionSerde)
);
```

KStream-GlobalKTable join:

```java
KStream<String, EnrichedCaseEvent> enriched = events.join(
    jurisdictions,
    (caseId, event) -> event.jurisdictionCode(),
    (event, jurisdiction) -> EnrichedCaseEvent.from(event, jurisdiction)
);
```

Hati-hati:

GlobalKTable menggoda karena menghindari repartitioning, tetapi bila data reference besar, setiap instance harus menyimpan full copy. Ini bisa menjadi bottleneck restore, disk, memory, dan network.

---

## 13. DSL vs Processor API

Kafka Streams menyediakan dua API utama:

1. Streams DSL.
2. Processor API.

### 13.1 Streams DSL

DSL adalah high-level API dengan abstraction seperti `KStream`, `KTable`, dan `GlobalKTable`.

Cocok untuk:

- filter,
- map,
- group,
- aggregate,
- join,
- window,
- materialized view,
- common stream processing.

Contoh:

```java
events
    .filter((key, value) -> value.isEscalation())
    .mapValues(CaseEscalationView::from)
    .to("case-escalation-view");
```

### 13.2 Processor API

Processor API memberi kontrol lebih rendah:

- akses record context,
- punctuator,
- custom state store access,
- custom processing logic,
- schedule periodic operation,
- topology manual.

Cocok untuk:

- logic yang tidak nyaman diekspresikan dengan DSL,
- custom stateful processing,
- complex event sequence detection,
- timer-like behavior,
- custom routing,
- low-level control.

Contoh konseptual:

```java
public class CaseSlaProcessor implements Processor<String, CaseEvent, String, SlaSignal> {
    private ProcessorContext<String, SlaSignal> context;
    private KeyValueStore<String, CaseSlaState> store;

    @Override
    public void init(ProcessorContext<String, SlaSignal> context) {
        this.context = context;
        this.store = context.getStateStore("case-sla-store");
    }

    @Override
    public void process(Record<String, CaseEvent> record) {
        // custom processing here
    }

    @Override
    public void close() {
    }
}
```

Rule of thumb:

```text
Mulai dari DSL.
Turun ke Processor API hanya ketika DSL tidak cukup jelas, tidak cukup ekspresif, atau tidak cukup efisien.
```

---

## 14. Application ID: Identitas Aplikasi Streams

`application.id` adalah konfigurasi paling penting di Kafka Streams.

Contoh:

```java
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "case-lifecycle-projection-v1");
```

`application.id` digunakan untuk:

1. Consumer group id.
2. Prefix internal topic.
3. Prefix state directory.
4. Identitas processing application.
5. Offset ownership.

Implikasi:

- Mengubah `application.id` berarti aplikasi dianggap consumer group baru.
- Aplikasi akan membaca dari awal atau sesuai `auto.offset.reset` jika tidak ada offset lama.
- Internal state/changelog/repartition topic baru bisa dibuat.
- Ini bukan sekadar nama kosmetik.

Mental model:

```text
application.id = identity of the stream processing application
```

Bila kamu ingin deploy versi baru yang melanjutkan state lama, jangan sembarang mengubah `application.id`.

Bila kamu ingin replay full dari awal sebagai aplikasi baru, mengganti `application.id` bisa menjadi strategi, tetapi harus direncanakan.

---

## 15. Task: Unit Eksekusi Kafka Streams

Task adalah unit parallelism utama di Kafka Streams.

Task dibentuk berdasarkan input partition. Jika aplikasi membaca topic dengan 6 partition, maka Kafka Streams akan membuat task yang merepresentasikan subset partition tersebut.

Contoh:

```text
Input topic: case-events
Partitions: 0, 1, 2, 3, 4, 5

Kafka Streams application tasks:
Task-0 -> partition 0
Task-1 -> partition 1
Task-2 -> partition 2
Task-3 -> partition 3
Task-4 -> partition 4
Task-5 -> partition 5
```

Jika aplikasi punya 3 instance:

```text
Instance A -> Task-0, Task-1
Instance B -> Task-2, Task-3
Instance C -> Task-4, Task-5
```

Jika instance B mati:

```text
Instance A -> Task-0, Task-1, Task-2
Instance C -> Task-3, Task-4, Task-5
```

Ini mirip consumer group partition assignment, tetapi task juga membawa state store dan processor topology execution unit.

Task penting karena:

1. Task adalah unit scaling.
2. Task adalah unit state ownership.
3. Task adalah unit restore.
4. Task adalah unit rebalance.
5. Task adalah unit offset progress.

Jika input topic hanya punya 3 partition, maka maximum active parallelism hanya sekitar 3 task untuk subtopology tersebut, walaupun kamu menjalankan 20 instance.

---

## 16. Stream Thread: Eksekutor Task dalam Instance

Satu Kafka Streams application instance bisa menjalankan beberapa stream thread.

Konfigurasi:

```java
props.put(StreamsConfig.NUM_STREAM_THREADS_CONFIG, 4);
```

Mental model:

```text
Application instance
  ├── StreamThread-1
  │     ├── Task A
  │     └── Task B
  ├── StreamThread-2
  │     ├── Task C
  │     └── Task D
  ├── StreamThread-3
  └── StreamThread-4
```

Menambah stream thread bisa meningkatkan parallelism dalam satu JVM, tetapi hanya sampai jumlah task/partition memungkinkan.

Jika task hanya 2, `num.stream.threads=8` tidak memberi 8x throughput.

Trade-off:

- Lebih banyak thread dapat meningkatkan CPU usage dan parallelism.
- Terlalu banyak thread dapat meningkatkan contention, memory pressure, dan complexity.
- Untuk stateful workload, thread tambahan tidak menghilangkan cost state restore.

Rule of thumb:

```text
Parallelism Kafka Streams dibatasi oleh partition/task.
Thread hanyalah cara menjalankan task di dalam instance.
```

---

## 17. Instance Scaling Model

Kafka Streams scaling adalah kombinasi:

```text
Number of input partitions
Number of stream tasks
Number of application instances
Number of stream threads per instance
State store size
Repartition topics
Changelog restore cost
```

Misal:

```text
Input topic: 12 partitions
Application instances: 3
num.stream.threads per instance: 2
Total stream threads: 6
Tasks: 12
```

Maka setiap thread kira-kira bisa memproses 2 task, tergantung assignment.

Jika instances dinaikkan menjadi 12:

```text
12 instances x 1 thread
12 tasks
```

Maka satu instance kira-kira memegang satu task.

Jika instances dinaikkan menjadi 24:

```text
24 instances
12 tasks
```

Maka 12 instance idle untuk subtopology tersebut.

Design implication:

- Partition count adalah upper bound parallelism.
- Menambah instance tanpa menambah partition tidak selalu berguna.
- Menambah partition setelah ada key-ordering dapat mengubah key distribution untuk record baru.
- Stateful apps perlu mempertimbangkan restore cost saat scaling up/down.

---

## 18. Subtopology dan Repartitioning

Topology Kafka Streams dapat terdiri dari beberapa subtopology. Subtopology sering dipisahkan oleh repartition boundary.

Contoh:

```java
KStream<String, CaseEvent> events = builder.stream("case-events");

KTable<String, Long> countsByOfficer = events
    .selectKey((caseId, event) -> event.assignedOfficerId())
    .groupByKey()
    .count();
```

Awalnya key adalah `caseId`. Lalu `selectKey` mengubah key menjadi `assignedOfficerId`. Ketika `groupByKey()` dipanggil, Kafka Streams perlu memastikan semua event dengan officer yang sama masuk ke task yang sama. Karena partitioning lama berdasarkan `caseId`, data harus direpartition berdasarkan `assignedOfficerId`.

Kafka Streams dapat membuat internal repartition topic.

Mental model:

```text
case-events keyed by caseId
   |
selectKey officerId
   |
internal repartition topic keyed by officerId
   |
groupByKey/count by officerId
```

Repartition bukan gratis.

Cost-nya:

- write tambahan ke Kafka,
- read tambahan dari Kafka,
- network,
- storage,
- latency,
- operational topic internal,
- schema/serde correctness,
- possible bottleneck bila key skew.

Top 1% engineer selalu bertanya:

```text
Apakah operasi ini menyebabkan repartition?
Apakah repartition ini memang diperlukan?
Apakah key baru punya cardinality dan distribution yang sehat?
```

---

## 19. Stateless Processing

Stateless processing tidak membutuhkan memory historis antar record.

Contoh:

- filter event invalid,
- map value,
- normalize field,
- route event ke topic lain,
- redact PII field,
- enrich dari static in-memory map kecil,
- split event type.

Contoh Java:

```java
KStream<String, CaseEvent> events = builder.stream(
    "case-events",
    Consumed.with(Serdes.String(), caseEventSerde)
);

events
    .filter((caseId, event) -> event != null)
    .filter((caseId, event) -> event.type() != CaseEventType.DEBUG_ONLY)
    .mapValues(event -> event.withoutSensitiveNotes())
    .to("case-events-redacted", Produced.with(Serdes.String(), caseEventSerde));
```

Stateless processing lebih mudah:

- Tidak ada state store.
- Tidak ada changelog topic.
- Restore lebih cepat.
- Rebalance lebih ringan.
- Failure recovery lebih sederhana.

Namun tetap perlu memperhatikan:

- serialization error,
- poison record,
- output topic availability,
- ordering per key,
- exactly-once bila output harus atomic dengan input offset.

---

## 20. Stateful Processing

Stateful processing membutuhkan memory historis.

Contoh:

- count per key,
- aggregate latest status,
- detect sequence event,
- windowed metrics,
- join dengan table,
- deduplication,
- SLA timer state,
- materialized view.

Contoh aggregation:

```java
KTable<String, Long> eventCountsByCase = events
    .groupByKey(Grouped.with(Serdes.String(), caseEventSerde))
    .count(Materialized.as("case-event-count-store"));
```

Ini membuat state store bernama `case-event-count-store`.

Mental model:

```text
Incoming record: CASE-001, CaseAssigned
Current state: CASE-001 -> 2
New state:     CASE-001 -> 3
Emit/update:   CASE-001 -> 3
```

Stateful processing membawa konsekuensi:

1. State disimpan lokal.
2. State harus fault-tolerant.
3. Kafka Streams membuat changelog topic untuk state store.
4. Saat task pindah instance, state harus direstore.
5. Besar state memengaruhi restart/rebalance time.
6. Disk lokal menjadi bagian dari architecture.

Kita akan membahas RocksDB, changelog, standby replica, dan restore lebih dalam di Part 020.

---

## 21. State Store: Local State sebagai Bagian dari Aplikasi

State store adalah storage lokal yang dipakai task untuk menyimpan state.

Jenis umum:

- persistent key-value store,
- in-memory key-value store,
- window store,
- session store.

Persistent store biasanya berbasis RocksDB.

Mental model:

```text
Kafka topic input
    |
    v
Stream task
    |
    +--> local state store
    |
    +--> changelog topic for recovery
    |
    v
output topic
```

State store bukan database utama aplikasi. Ia adalah local materialized state yang derived dari Kafka stream.

Implikasi desain:

- State harus bisa direkonstruksi dari Kafka.
- Jangan simpan satu-satunya source of truth di local state store tanpa changelog/replay path.
- Disk lokal perlu dimonitor.
- Restore time harus masuk SLO operasional.
- Store name adalah bagian dari compatibility internal aplikasi.

---

## 22. Changelog Topic: Fault Tolerance untuk State

Untuk stateful operation, Kafka Streams menulis perubahan state ke changelog topic.

Contoh:

```text
State store: case-event-count-store
Changelog topic: case-lifecycle-projection-v1-case-event-count-store-changelog
```

Jika instance mati dan task pindah ke instance lain:

```text
New instance reads changelog topic -> rebuild state store -> resume processing
```

Changelog topic biasanya compacted karena hanya latest state per key yang dibutuhkan untuk restore current state.

Ini membuat stateful Kafka Streams fault-tolerant tanpa external database untuk state internal.

Namun cost-nya:

- setiap update state juga menulis changelog,
- storage Kafka bertambah,
- network bertambah,
- restore butuh waktu,
- compaction config penting,
- internal topic harus dilindungi dari accidental deletion.

---

## 23. Internal Topics

Kafka Streams dapat membuat internal topic untuk:

1. Repartition.
2. Changelog.

Contoh naming:

```text
<application.id>-<store-name>-changelog
<application.id>-<repartition-node-name>-repartition
```

Internal topic bukan berarti tidak penting. Justru internal topic sering critical.

Jika internal changelog topic hilang:

- state store tidak bisa dipulihkan dengan cepat,
- aplikasi mungkin harus rebuild dari input topic,
- jika input retention sudah tidak cukup, state bisa hilang.

Jika repartition topic rusak:

- processing topology bisa gagal,
- output bisa tertunda,
- lag bisa naik.

Operational implication:

- Jangan exclude internal topics dari monitoring.
- Jangan delete internal topics tanpa memahami konsekuensi.
- Beri ACL yang benar.
- Pastikan replication factor internal topic sesuai production need.
- Pahami naming internal topic sebelum incident.

---

## 24. SerDes: Serialization/Deserialization di Kafka Streams

Kafka Streams membutuhkan SerDe untuk key dan value.

SerDe = Serializer + Deserializer.

Konfigurasi default:

```java
props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass());
props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass());
```

Namun untuk domain event, kamu biasanya memakai Avro/Protobuf/JSON Schema SerDe dengan Schema Registry.

Contoh konseptual:

```java
Map<String, String> serdeConfig = Map.of(
    "schema.registry.url", "http://localhost:8081"
);

SpecificAvroSerde<CaseEvent> caseEventSerde = new SpecificAvroSerde<>();
caseEventSerde.configure(serdeConfig, false);
```

Lalu:

```java
KStream<String, CaseEvent> events = builder.stream(
    "case-events",
    Consumed.with(Serdes.String(), caseEventSerde)
);
```

SerDe penting karena:

- topology bisa punya beberapa type berbeda,
- repartition topic butuh key/value SerDe,
- changelog topic butuh state SerDe,
- wrong SerDe bisa menyebabkan runtime failure,
- schema evolution harus compatible dengan consumer lama dan state store lama.

Anti-pattern:

```text
Mengandalkan default SerDe untuk semua node topology padahal tipe value berubah di tengah pipeline.
```

Lebih aman:

```java
stream
    .mapValues(this::toEscalationView)
    .to("case-escalation-view", Produced.with(Serdes.String(), escalationViewSerde));
```

---

## 25. Contoh Domain: Case Lifecycle Projection

Misal kita punya event:

```java
public enum CaseEventType {
    CASE_CREATED,
    CASE_ASSIGNED,
    CASE_ESCALATED,
    CASE_CLOSED
}

public record CaseEvent(
    String caseId,
    CaseEventType type,
    String assignedOfficerId,
    String severity,
    long eventTimeEpochMillis
) {
}

public record CaseSummary(
    String caseId,
    String status,
    String assignedOfficerId,
    String severity,
    long lastUpdatedAt
) {
}
```

Goal:

```text
Dari stream case-events, bangun latest case summary per caseId.
```

Kafka Streams topology:

```java
KStream<String, CaseEvent> caseEvents = builder.stream(
    "case-events",
    Consumed.with(Serdes.String(), caseEventSerde)
);

KTable<String, CaseSummary> caseSummary = caseEvents
    .groupByKey(Grouped.with(Serdes.String(), caseEventSerde))
    .aggregate(
        () -> null,
        (caseId, event, current) -> applyEvent(caseId, event, current),
        Materialized.<String, CaseSummary>as("case-summary-store")
            .withKeySerde(Serdes.String())
            .withValueSerde(caseSummarySerde)
    );

caseSummary
    .toStream()
    .to("case-summary", Produced.with(Serdes.String(), caseSummarySerde));
```

Reducer function:

```java
private static CaseSummary applyEvent(
    String caseId,
    CaseEvent event,
    CaseSummary current
) {
    return switch (event.type()) {
        case CASE_CREATED -> new CaseSummary(
            caseId,
            "OPEN",
            null,
            event.severity(),
            event.eventTimeEpochMillis()
        );
        case CASE_ASSIGNED -> new CaseSummary(
            caseId,
            current == null ? "OPEN" : current.status(),
            event.assignedOfficerId(),
            current == null ? event.severity() : current.severity(),
            event.eventTimeEpochMillis()
        );
        case CASE_ESCALATED -> new CaseSummary(
            caseId,
            "ESCALATED",
            current == null ? event.assignedOfficerId() : current.assignedOfficerId(),
            event.severity(),
            event.eventTimeEpochMillis()
        );
        case CASE_CLOSED -> new CaseSummary(
            caseId,
            "CLOSED",
            current == null ? event.assignedOfficerId() : current.assignedOfficerId(),
            current == null ? event.severity() : current.severity(),
            event.eventTimeEpochMillis()
        );
    };
}
```

Catatan penting:

1. Ini stateful aggregation.
2. Ada state store `case-summary-store`.
3. Ada changelog topic internal.
4. Correctness bergantung pada ordering per `caseId`.
5. Input topic harus keyed by `caseId`.
6. Jika event untuk case yang sama tersebar ke partition berbeda, lifecycle projection bisa salah.

---

## 26. Topology Description: Membaca Rencana Eksekusi

Kafka Streams bisa mendeskripsikan topology:

```java
Topology topology = builder.build();
System.out.println(topology.describe());
```

Output-nya kira-kira menunjukkan:

```text
Topologies:
   Sub-topology: 0
    Source: KSTREAM-SOURCE-0000000000 (topics: [case-events])
      --> KSTREAM-FILTER-0000000001
    Processor: KSTREAM-FILTER-0000000001
      --> KSTREAM-SINK-0000000002
      <-- KSTREAM-SOURCE-0000000000
    Sink: KSTREAM-SINK-0000000002 (topic: case-escalation-events)
      <-- KSTREAM-FILTER-0000000001
```

Untuk topology stateful/repartitioned, output bisa menunjukkan repartition source/sink dan state store.

Kenapa penting?

Karena topology description membantu menjawab:

- Source topic apa saja?
- Sink topic apa saja?
- Ada repartition topic tidak?
- Ada state store tidak?
- Node mana yang materialized?
- Ada subtopology berapa?

Di production review, topology description seharusnya menjadi bagian dari PR/ADR untuk Kafka Streams app yang kompleks.

---

## 27. Streams Lifecycle

KafkaStreams instance punya lifecycle state.

Secara konseptual:

```text
CREATED
  -> REBALANCING
  -> RUNNING
  -> PENDING_SHUTDOWN
  -> NOT_RUNNING
```

Aplikasi bisa memasang state listener:

```java
streams.setStateListener((newState, oldState) -> {
    System.out.printf("Kafka Streams state changed from %s to %s%n", oldState, newState);
});
```

Juga uncaught exception handler:

```java
streams.setUncaughtExceptionHandler(exception -> {
    // decide whether to replace thread, shutdown client, or shutdown application
    return StreamsUncaughtExceptionHandler.StreamThreadExceptionResponse.SHUTDOWN_APPLICATION;
});
```

Graceful shutdown:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    streams.close(Duration.ofSeconds(30));
}));
```

Production implications:

- Readiness probe sebaiknya aware terhadap `RUNNING`.
- During rebalance, aplikasi mungkin tidak siap melayani interactive query tertentu.
- Shutdown harus memberi waktu commit/close.
- Crash loop dapat menyebabkan rebalance storm.

---

## 28. Error Handling Mental Model

Kafka Streams error bisa muncul pada beberapa layer:

1. Deserialization error.
2. Processing logic error.
3. Production/output error.
4. State store error.
5. Rebalance/assignment error.
6. Fatal runtime error.

Deserialization exception handling:

```java
props.put(
    StreamsConfig.DEFAULT_DESERIALIZATION_EXCEPTION_HANDLER_CLASS_CONFIG,
    LogAndContinueExceptionHandler.class
);
```

Namun `LogAndContinue` harus digunakan hati-hati. Bila record rusak dilewati, apakah correctness masih valid?

Untuk processing exception, kamu harus membuat logic eksplisit. Misalnya:

```java
events.flatMapValues(event -> {
    try {
        return List.of(transform(event));
    } catch (InvalidDomainEventException e) {
        // route to dead-letter-like stream using branching pattern in real implementation
        return List.of();
    }
});
```

Kafka Streams tidak otomatis menyelesaikan poison event domain. Kamu tetap harus mendesain:

- validation,
- quarantine topic,
- DLQ pattern,
- retry boundary,
- idempotency,
- observability.

Top 1% engineer tidak hanya bertanya “apakah topology jalan”, tetapi:

```text
Apa yang terjadi pada record invalid?
Apa yang terjadi pada schema incompatible?
Apa yang terjadi jika transform throw exception?
Apa yang terjadi jika state store corrupt?
Apa yang terjadi jika output topic authorization gagal?
```

---

## 29. Kafka Streams dan Consumer Group Protocol

Kafka Streams application dengan `application.id` tertentu bergabung sebagai consumer group.

Jika kamu menjalankan 5 instance dengan `application.id` sama:

```text
Semua instance adalah anggota group yang sama.
Partitions/tasks dibagi antar instance.
```

Jika kamu menjalankan instance dengan `application.id` berbeda:

```text
Itu aplikasi stream processing berbeda.
Masing-masing membaca input secara independen.
```

Implikasi:

- Blue-green deployment dengan application.id sama harus hati-hati karena semua instance lama/baru bisa berada dalam group yang sama.
- Jika topology berubah incompatible tetapi application.id sama, internal state/topic lama bisa tidak cocok.
- Jika ingin parallel independent processing, gunakan application.id berbeda.
- Jika ingin rolling upgrade dari app yang sama, gunakan application.id sama tetapi pastikan topology/state compatibility.

---

## 30. Topology Compatibility dan Upgrade

Kafka Streams app memiliki state internal. Maka upgrade bukan sekadar mengganti jar.

Hal yang harus dipertimbangkan:

1. Apakah nama state store berubah?
2. Apakah schema state store berubah?
3. Apakah internal topic name berubah?
4. Apakah repartition topology berubah?
5. Apakah key berubah?
6. Apakah output event contract berubah?
7. Apakah application.id berubah?
8. Apakah processing guarantee berubah?
9. Apakah versi Kafka Streams berubah signifikan?

Contoh perubahan berbahaya:

```java
Materialized.as("case-summary-store")
```

diubah menjadi:

```java
Materialized.as("case-status-store")
```

Bagi Kafka Streams, ini bisa berarti state store baru dan changelog topic baru. Jika tidak direncanakan, aplikasi bisa restore ulang atau kehilangan continuity state.

Strategi upgrade:

- Gunakan explicit state store names.
- Gunakan explicit SerDes.
- Gunakan topology description diff.
- Test restore dari data lama.
- Test rolling deploy.
- Gunakan versioned output topic jika contract berubah besar.
- Dokumentasikan migration path.

---

## 31. Kafka Streams untuk Regulatory Case Management

Untuk konteks lifecycle enforcement/case management, Kafka Streams sangat cocok untuk membangun derived state dari event log.

Contoh stream:

```text
case-lifecycle-events
case-assignment-events
case-evidence-events
case-review-events
case-decision-events
sla-clock-events
```

Derived output:

```text
case-current-status
case-current-owner
case-sla-risk-signals
case-escalation-candidates
case-audit-projection
case-dashboard-summary
```

Contoh topology konseptual:

```text
case-lifecycle-events
   |
   +--> aggregate latest status per case
   |       -> case-status-store
   |       -> case-current-status topic
   |
   +--> detect escalation-worthy transition
   |       -> case-escalation-candidates topic
   |
   +--> join with jurisdiction reference GlobalKTable
           -> case-jurisdiction-enriched-events topic
```

Kafka Streams berguna karena:

1. Event log tetap immutable.
2. Projection bisa dibangun ulang.
3. State transition logic bisa diuji sebagai Java code.
4. Correlation/causation bisa dipertahankan.
5. Audit view bisa dibuat sebagai derived table.
6. SLA/escalation signal bisa dihitung near-real-time.
7. Regulatory explanation bisa ditopang oleh event lineage.

Namun ada risiko:

- Jangan membuat Kafka Streams state sebagai satu-satunya audit source.
- Jangan kehilangan event historis karena retention input terlalu pendek.
- Jangan membuat projection tanpa versioned event contract.
- Jangan mengabaikan correction event.
- Jangan mencampur command decision dengan derived signal tanpa boundary jelas.

---

## 32. Production Configuration Dasar

Contoh konfigurasi awal untuk aplikasi Kafka Streams production-ish:

```java
Properties props = new Properties();

props.put(StreamsConfig.APPLICATION_ID_CONFIG, "case-lifecycle-projection-v1");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "kafka-1:9092,kafka-2:9092,kafka-3:9092");

props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass());
props.put(StreamsConfig.NUM_STREAM_THREADS_CONFIG, 2);

props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, StreamsConfig.AT_LEAST_ONCE);

props.put(StreamsConfig.COMMIT_INTERVAL_MS_CONFIG, 1000);
props.put(StreamsConfig.STATE_DIR_CONFIG, "/var/lib/app/kafka-streams-state");

props.put(StreamsConfig.REPLICATION_FACTOR_CONFIG, 3);
props.put(StreamsConfig.producerPrefix("acks"), "all");
props.put(StreamsConfig.producerPrefix("enable.idempotence"), "true");

props.put(StreamsConfig.consumerPrefix("auto.offset.reset"), "earliest");
```

Catatan:

- `processing.guarantee` bisa `at_least_once` atau exactly-once variant tergantung versi/config.
- `state.dir` harus berada di storage yang cukup cepat dan stabil.
- Internal topic replication factor harus sesuai HA requirement.
- Producer/consumer config bisa diprefix bila perlu.
- Jangan copy config tanpa benchmark dan failure testing.

---

## 33. Minimal Maven Dependencies

Contoh dependency dasar:

```xml
<dependencies>
    <dependency>
        <groupId>org.apache.kafka</groupId>
        <artifactId>kafka-streams</artifactId>
        <version>${kafka.version}</version>
    </dependency>

    <dependency>
        <groupId>org.slf4j</groupId>
        <artifactId>slf4j-api</artifactId>
        <version>${slf4j.version}</version>
    </dependency>

    <dependency>
        <groupId>ch.qos.logback</groupId>
        <artifactId>logback-classic</artifactId>
        <version>${logback.version}</version>
    </dependency>
</dependencies>
```

Untuk Avro/Schema Registry, biasanya menambah dependency Confluent serializer, misalnya `kafka-avro-serializer`, tergantung environment dan repository configuration.

Untuk testing Kafka Streams, akan ada `kafka-streams-test-utils` yang dibahas lebih lengkap di Part 023.

---

## 34. Testing Singkat dengan TopologyTestDriver

Kafka Streams punya test utility untuk menjalankan topology tanpa Kafka broker nyata.

Contoh konseptual:

```java
Topology topology = buildTopology();

Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "test-app");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "dummy:9092");

try (TopologyTestDriver testDriver = new TopologyTestDriver(topology, props)) {
    TestInputTopic<String, CaseEvent> input = testDriver.createInputTopic(
        "case-events",
        new StringSerializer(),
        caseEventSerializer
    );

    TestOutputTopic<String, CaseEvent> output = testDriver.createOutputTopic(
        "case-escalation-events",
        new StringDeserializer(),
        caseEventDeserializer
    );

    input.pipeInput("CASE-001", new CaseEvent(...));

    KeyValue<String, CaseEvent> result = output.readKeyValue();

    assertEquals("CASE-001", result.key);
}
```

Manfaat:

- deterministic,
- cepat,
- tidak butuh broker,
- cocok untuk topology logic,
- bisa test window/time dengan controlled timestamps,
- bisa test state store output.

Limitasi:

- tidak menguji Kafka cluster behavior,
- tidak menguji real rebalance,
- tidak menguji network/security/ACL,
- tidak menggantikan integration test dengan Testcontainers.

---

## 35. Observability Dasar Kafka Streams

Kafka Streams app harus diamati sebagai:

1. Kafka consumer.
2. Kafka producer.
3. Stream processing runtime.
4. Stateful local storage process.
5. JVM service.

Metric penting:

- records consumed rate,
- records produced rate,
- process rate,
- process latency,
- commit latency,
- poll latency,
- task count,
- thread state,
- rebalance rate,
- skipped records,
- deserialization errors,
- state store metrics,
- restore metrics,
- RocksDB metrics bila enabled,
- consumer lag,
- internal topic lag,
- output topic produce errors.

Kafka Streams incident sering terjadi bukan karena broker down, tetapi karena:

- restore terlalu lama,
- state directory penuh,
- repartition topic bottleneck,
- key skew,
- poison record,
- schema incompatible,
- topology upgrade incompatible,
- output topic authorization error,
- rebalance storm.

---

## 36. Common Design Patterns

### 36.1 Filter and Route

```text
Input event stream -> split by event type -> output topics
```

Cocok untuk membuat downstream lebih fokus.

### 36.2 Projection

```text
Domain event stream -> aggregate latest state -> compacted topic/read model
```

Cocok untuk dashboard, query API, workflow state.

### 36.3 Enrichment

```text
Event stream + reference table -> enriched event stream
```

Cocok untuk menambah jurisdiction, tenant config, rule metadata.

### 36.4 Aggregation

```text
Events grouped by key/window -> count/sum/max/custom aggregate
```

Cocok untuk metrics, anomaly detection, SLA counters.

### 36.5 Deduplication

```text
Event stream -> state store of seen event ids -> unique stream
```

Cocok untuk at-least-once duplicate mitigation.

### 36.6 Materialized View

```text
Changelog/domain events -> KTable/state store -> queryable projection
```

Cocok untuk low-latency lookup, tetapi perlu Interactive Queries atau output compacted topic.

### 36.7 Stateful Signal Detection

```text
Event sequence -> state machine in store -> signal topic
```

Cocok untuk regulatory escalation, fraud pattern, lifecycle violation.

---

## 37. Common Anti-Patterns

### 37.1 Memakai Kafka Streams untuk Side Effect Berat ke Database/API

Kafka Streams paling natural untuk Kafka-to-Kafka processing. Jika tiap record memanggil API eksternal blocking, kamu bisa menghancurkan throughput, ordering, dan failure semantics.

Lebih baik:

- Kafka Streams menghasilkan command/signal topic.
- Worker consumer terpisah menjalankan side effect dengan idempotency.

### 37.2 Menganggap State Store sebagai Database Utama

State store adalah derived local state. Ia powerful, tetapi harus bisa dipulihkan.

Jika butuh durable query store enterprise, publish compacted output topic lalu sink ke database/search store bila perlu.

### 37.3 Tidak Menamai State Store Secara Eksplisit

Auto-generated name bisa berubah saat topology berubah.

Lebih baik:

```java
Materialized.as("case-summary-store")
```

### 37.4 Mengabaikan Repartitioning

Operasi `selectKey`, `groupBy`, dan join tertentu bisa membuat repartition.

Selalu inspect topology.

### 37.5 Key Buruk

Jika key tidak sesuai ordering domain, aggregation/join/projection salah.

Untuk lifecycle case:

```text
Key harus caseId untuk state per case.
```

### 37.6 Mengubah application.id Sembarangan

Ini bisa membuat aplikasi membaca ulang dari awal dan membuat internal state baru.

### 37.7 Tidak Memikirkan Restore Time

Stateful app mungkin cepat saat normal, tetapi sangat lambat saat restart karena harus restore state.

### 37.8 Menggunakan GlobalKTable untuk Data Besar

GlobalKTable menyalin seluruh table ke setiap instance. Bagus untuk reference kecil, buruk untuk dataset besar.

### 37.9 Tidak Memiliki Poison Record Strategy

Satu record buruk bisa menghentikan stream processing jika tidak ada strategy.

### 37.10 Mengabaikan Event Time

Jika logic membutuhkan waktu bisnis, jangan diam-diam memakai processing time.

---

## 38. Design Checklist untuk Kafka Streams App

Sebelum membuat Kafka Streams app, jawab pertanyaan berikut:

### Problem Fit

- Apakah ini benar-benar stream processing?
- Apakah output-nya Kafka topic/materialized state?
- Apakah plain consumer lebih sederhana?
- Apakah ksqlDB cukup?
- Apakah Flink/Spark lebih tepat?

### Input/Output

- Input topic apa?
- Output topic apa?
- Key input apa?
- Key output apa?
- Apakah ordering domain benar?
- Apakah schema sudah governed?

### Topology

- Ada operasi stateless apa?
- Ada operasi stateful apa?
- Ada repartition tidak?
- Ada join tidak?
- Ada window tidak?
- Ada state store tidak?
- Topology description sudah direview?

### State

- State store apa?
- Store name explicit?
- Changelog topic apa?
- Berapa besar state?
- Berapa lama restore?
- Perlu standby replica?
- Disk cukup?

### Semantics

- At-least-once cukup?
- Butuh exactly-once Kafka-to-Kafka?
- Duplicate output acceptable?
- Downstream idempotent?
- Late event handling bagaimana?

### Operations

- application.id apa?
- num.stream.threads berapa?
- replication factor internal topic berapa?
- monitoring apa?
- alert apa?
- DLQ/quarantine bagaimana?
- upgrade strategy bagaimana?
- rollback strategy bagaimana?

---

## 39. Latihan Mental Model

### Latihan 1 — Projection per Case

Kamu punya topic `case-events` dengan key `caseId`. Kamu ingin membuat latest status per case.

Pertanyaan:

1. Apakah kamu memakai KStream atau KTable sebagai input?
2. Apakah kamu butuh state store?
3. Apa nama state store?
4. Apa output topic?
5. Apa yang terjadi jika event datang out-of-order?
6. Apa yang terjadi jika input retention hanya 1 hari tetapi state perlu direbuild dari 1 tahun data?

Jawaban arah:

- Input adalah KStream karena tiap record adalah domain event.
- Output bisa KTable/materialized state dan compacted topic.
- Butuh state store untuk latest status.
- Out-of-order perlu policy berdasarkan event timestamp/version/sequence.
- Retention harus cukup untuk rebuild atau changelog harus aman.

### Latihan 2 — Count Escalation by Officer

Input key adalah `caseId`, tetapi kamu ingin count escalation per `officerId`.

Pertanyaan:

1. Apakah perlu mengubah key?
2. Apakah akan terjadi repartition?
3. Apa risiko hot key?
4. Apa yang terjadi jika satu officer menangani 80% case?

Jawaban arah:

- Perlu key by officerId untuk grouping.
- Ya, kemungkinan repartition.
- Officer dengan beban besar menjadi hot key.
- Satu partition/task bisa menjadi bottleneck.

### Latihan 3 — Reference Data Join

Input `case-events` perlu enrich dengan `jurisdiction-reference`.

Pertanyaan:

1. Pakai KTable atau GlobalKTable?
2. Apa ukuran reference data?
3. Apakah co-partitioning tersedia?
4. Apa cost restore?

Jawaban arah:

- GlobalKTable cocok jika reference kecil dan dibutuhkan penuh di tiap instance.
- KTable cocok jika data besar dan bisa co-partitioned.
- Ukuran dan update rate menentukan pilihan.

---

## 40. Java Engineer Perspective

Sebagai Java engineer, Kafka Streams harus dilihat sebagai runtime library yang membawa konsekuensi arsitektural.

Hal yang terasa familiar:

- Maven/Gradle dependency.
- Java type system.
- Unit test.
- Integration test.
- Spring Boot integration bila diperlukan.
- Deployment sebagai service.
- Observability via JVM metrics/logging.

Hal yang berbeda dari service Java biasa:

- State lokal adalah bagian dari correctness.
- Partition menentukan parallelism.
- Rebalance memengaruhi availability.
- Application ID adalah identity processing.
- Topology adalah runtime contract.
- Internal topics adalah state infrastructure.
- Event schema evolution memengaruhi long-running state.
- Disk lokal bukan cache sembarangan.

Java engineer yang kuat di Kafka Streams tidak hanya menulis DSL chain, tetapi bisa menjawab:

```text
Apa topology-nya?
Apa key invariant-nya?
Apa state invariant-nya?
Apa failure recovery path-nya?
Apa repartition cost-nya?
Apa upgrade compatibility-nya?
Apa observability signal-nya?
```

---

## 41. Production Failure Modes

### 41.1 State Restore Storm

Banyak instance restart bersamaan. Semua restore state dari changelog. Kafka broker dan network terbebani.

Mitigasi:

- rolling restart,
- standby replicas,
- monitor restore rate,
- avoid huge state where unnecessary,
- persistent volume reuse where appropriate.

### 41.2 Repartition Topic Bottleneck

Topology menyebabkan repartition besar. Internal topic menjadi bottleneck.

Mitigasi:

- review key design,
- pre-key input topic dengan benar,
- increase partition count bila aman,
- avoid unnecessary groupBy/selectKey.

### 41.3 Skewed Key

Satu key sangat dominan. Satu task panas.

Mitigasi:

- key salting bila aggregation dapat digabung dua tahap,
- redesign aggregation,
- separate heavy tenant/entity,
- detect skew via metrics.

### 41.4 Poison Record Stops Processing

Record invalid menyebabkan exception terus-menerus.

Mitigasi:

- schema validation,
- deserialization handler,
- quarantine topic,
- domain validation,
- replay tooling.

### 41.5 Incompatible State Schema

Deploy versi baru dengan schema state berubah tanpa migration.

Mitigasi:

- versioned state,
- compatible schema evolution,
- state migration plan,
- new application.id with rebuild if needed,
- topology upgrade testing.

### 41.6 Internal Topic Deleted

Operator menghapus topic internal karena dikira temporary.

Mitigasi:

- naming education,
- ACL,
- topic catalog,
- monitoring,
- backup/rebuild plan.

### 41.7 Output Topic ACL Failure

App bisa read input tetapi gagal produce output.

Mitigasi:

- pre-flight ACL check,
- integration test environment parity,
- alert on produce error,
- least privilege but complete privilege.

---

## 42. Ringkasan

Kafka Streams adalah library Java untuk membangun stream processing application di atas Kafka.

Poin paling penting:

1. Kafka Streams bukan broker dan bukan cluster engine terpisah.
2. Kafka Streams menjalankan topology di dalam aplikasi Java.
3. `KStream` adalah stream fakta/event.
4. `KTable` adalah table yang berubah dari changelog stream.
5. `GlobalKTable` adalah replicated table penuh di setiap instance.
6. `application.id` adalah identity aplikasi, consumer group, dan prefix internal state/topic.
7. Task adalah unit parallelism dan state ownership.
8. Stream thread menjalankan task dalam instance.
9. Parallelism dibatasi oleh partition/task.
10. Stateful processing memakai state store dan changelog topic.
11. Repartitioning sering tersembunyi di balik operasi key/group/join.
12. Internal topics adalah bagian critical dari state dan execution.
13. Kafka Streams cocok untuk Kafka-native Java stream processing, terutama domain projection, enrichment, aggregation, dan event-derived state.
14. Kafka Streams harus didesain dengan invariants: key, ordering, state, restore, semantics, observability, dan upgrade compatibility.

---

## 43. Preview Part Berikutnya

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-020.md
```

Judul:

```text
Kafka Streams State: RocksDB, Changelog, Standby Replica, Restore, Interactive Queries
```

Fokus berikutnya:

- local state store,
- RocksDB,
- changelog topic,
- state restoration,
- standby replica,
- state directory,
- interactive queries,
- query routing,
- disk pressure,
- restore storm,
- operational risk.

Part 019 memberi fondasi runtime Kafka Streams. Part 020 akan masuk lebih dalam ke bagian yang paling menentukan production reliability: **state**.

---

## 44. Referensi Utama

Referensi yang relevan untuk part ini:

1. Apache Kafka Documentation — Kafka Streams Core Concepts.
2. Apache Kafka Documentation — Kafka Streams Developer Guide.
3. Apache Kafka Documentation — Streams DSL and Processor API.
4. Apache Kafka Documentation — Streams Configuration.
5. Apache Kafka JavaDocs — `KafkaStreams`, `StreamsBuilder`, `Topology`, `KStream`, `KTable`, `GlobalKTable`.
6. Confluent Documentation — Kafka Streams Concepts.
7. Confluent Documentation — Kafka Streams DSL API.
8. Confluent Documentation — Kafka Streams Operations and Monitoring.
9. Confluent Documentation — Schema Registry and SerDes integration.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — ksqlDB Advanced: Joins, Windows, Aggregations, Repartitioning, and State</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-020.md">Part 020 — Kafka Streams State: RocksDB, Changelog, Standby Replica, Restore, Interactive Queries ➡️</a>
</div>

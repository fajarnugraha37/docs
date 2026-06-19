# learn-kafka-event-streaming-mastery-for-java-engineers-part-021.md

# Part 021 — Kafka Streams Processing Semantics: Windowing, Joins, Suppression, and Exactly-Once

> Series: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Fokus: memahami semantik pemrosesan Kafka Streams agar hasil stream processing benar, deterministik, dan production-safe.

---

## 0. Posisi Part Ini di Dalam Seri

Pada Part 019 kita membahas Kafka Streams sebagai library Java untuk membangun topology pemrosesan stream. Pada Part 020 kita membahas state store, RocksDB, changelog topic, restore, standby replica, dan interactive queries.

Part 021 menggabungkan dua hal itu ke pertanyaan yang jauh lebih sulit:

> “Ketika event datang out-of-order, terlambat, duplicate, gagal diproses, atau aplikasi restart, apakah hasil Kafka Streams kita tetap benar?”

Ini bukan sekadar pertanyaan API. Ini pertanyaan **semantik sistem**.

Kafka Streams bisa melakukan filter, map, join, aggregation, windowing, dan stateful processing. Tetapi correctness tidak otomatis muncul hanya karena memakai Kafka Streams. Correctness muncul dari kombinasi:

1. desain key,
2. timestamp semantics,
3. window definition,
4. grace period,
5. state store retention,
6. repartition strategy,
7. processing guarantee,
8. idempotency di boundary eksternal,
9. testing terhadap late/duplicate/out-of-order events.

Dokumentasi Apache Kafka menyatakan Kafka Streams mendukung event-time processing dan exactly-once processing semantics. Confluent juga mendokumentasikan bahwa Kafka Streams mendukung at-least-once dan exactly-once processing guarantees, dengan `at_least_once` sebagai default di banyak konfigurasi. Namun, istilah “exactly once” harus dipahami dalam scope Kafka Streams dan Kafka topics, bukan sebagai magic guarantee untuk semua side effect eksternal.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan **event time**, **processing time**, dan **ingestion time** dalam Kafka Streams.
2. Menjelaskan bagaimana Kafka Streams menentukan waktu record lewat `TimestampExtractor`.
3. Mendesain tumbling, hopping, sliding, dan session window secara benar.
4. Memahami late event dan grace period.
5. Menjelaskan kenapa window result bisa berubah setelah output pertama.
6. Menggunakan suppression untuk menunda hasil sampai window final.
7. Memahami stream-stream, stream-table, table-table, dan GlobalKTable join semantics.
8. Menjelaskan kenapa join membutuhkan key alignment dan co-partitioning.
9. Mendeteksi kapan Kafka Streams membuat repartition topic internal.
10. Memahami hubungan state store, changelog topic, repartition topic, dan exactly-once.
11. Memilih antara `at_least_once` dan `exactly_once_v2` secara sadar.
12. Menjelaskan batas exactly-once Kafka Streams terhadap database/API eksternal.
13. Membuat mental model testing untuk event-time, late event, duplicate event, dan restart.

---

## 2. Mental Model Utama

### 2.1 Kafka Streams adalah deterministic state machine di atas partitioned logs

Kafka Streams membaca input topic, menjalankan topology, menyimpan state lokal, dan menulis output topic. Secara konseptual:

```text
input topic partitions
        |
        v
Kafka Streams task
        |
        +-- local state store
        +-- changelog topic
        +-- repartition topic, jika perlu
        |
        v
output topic partitions
```

Setiap task memproses subset partition. Jika input, state, timestamp, key, dan topology deterministik, output bisa direkonstruksi lewat replay.

Namun determinisme ini bisa rusak oleh:

1. pemakaian wall-clock time sembarangan,
2. external API call di tengah topology,
3. random UUID untuk output identity,
4. mutable external state,
5. non-idempotent side effect,
6. join tanpa key/co-partitioning yang benar,
7. window/grace yang tidak sesuai domain event arrival.

Kafka Streams kuat ketika dipakai sebagai:

```text
Kafka input -> deterministic transformation/state -> Kafka output
```

Kafka Streams lebih berisiko ketika dipakai sebagai:

```text
Kafka input -> arbitrary side effect to external system -> output maybe Kafka maybe not
```

---

### 2.2 Processing semantics bukan hanya delivery semantics

Pada consumer biasa, kita sering bicara:

```text
consume -> process -> commit offset
```

Pada Kafka Streams, modelnya lebih kompleks:

```text
consume input records
update local state
write changelog records
write repartition records
write output records
commit consumed offsets
possibly commit Kafka transaction
```

Jadi guarantee bukan hanya “record dibaca sekali”. Guarantee yang penting adalah:

> Apakah perubahan state, output topic, dan input offset commit terlihat secara atomik dan konsisten?

Untuk at-least-once, duplicate output mungkin terjadi setelah crash. Untuk exactly-once Kafka Streams, update state/output/offset ke Kafka dapat dikoordinasikan lewat transaksi Kafka sehingga hasil Kafka-to-Kafka lebih konsisten.

Tetapi exactly-once Kafka Streams tidak otomatis mencakup:

1. write ke database eksternal,
2. HTTP call ke service lain,
3. email/SMS/push notification,
4. update cache eksternal,
5. object storage write,
6. non-transactional sink di luar Kafka.

---

## 3. Tiga Jenis Waktu dalam Stream Processing

### 3.1 Event time

Event time adalah waktu ketika kejadian bisnis sebenarnya terjadi.

Contoh:

```json
{
  "caseId": "CASE-9001",
  "eventType": "EvidenceSubmitted",
  "occurredAt": "2026-06-19T10:15:30Z"
}
```

Jika evidence dikirim jam 10:15 tetapi baru sampai Kafka jam 10:20, event time tetap 10:15.

Event time cocok untuk:

1. SLA bisnis,
2. fraud detection,
3. enforcement lifecycle timeline,
4. audit reconstruction,
5. window aggregation berdasarkan waktu kejadian sebenarnya.

---

### 3.2 Ingestion time

Ingestion time adalah waktu record masuk ke Kafka broker atau waktu producer mengirim record, tergantung konfigurasi timestamp topic/producer.

Contoh:

```text
event occurred  : 10:15:30
record produced : 10:16:05
broker append   : 10:16:06
consumer process: 10:20:00
```

Ingestion time cocok untuk:

1. pipeline monitoring,
2. ingestion delay,
3. throughput observability,
4. freshness metric.

Ingestion time kurang cocok untuk business SLA jika event bisa terlambat dikirim.

---

### 3.3 Processing time

Processing time adalah waktu saat Kafka Streams application memproses record.

Processing time dipengaruhi oleh:

1. consumer lag,
2. restart,
3. rebalance,
4. backlog,
5. throttling,
6. network delay,
7. GC pause,
8. deployment.

Processing time cocok untuk:

1. operational alert,
2. retry delay,
3. housekeeping,
4. wall-clock punctuation tertentu.

Processing time berbahaya jika dipakai untuk business event ordering.

---

### 3.4 Rule of thumb

Untuk business correctness:

```text
Gunakan event time.
```

Untuk pipeline observability:

```text
Gunakan ingestion/processing time.
```

Untuk regulatory/case-management audit:

```text
Simpan semuanya:
- occurredAt
- producedAt
- ingestedAt
- processedAt
- recordedAt / persistedAt
```

Karena ketika ada sengketa, kamu perlu menjawab:

1. kapan kejadian terjadi,
2. kapan sistem menerima,
3. kapan sistem memproses,
4. kapan keputusan dibuat,
5. kenapa ada delay.

---

## 4. TimestampExtractor

Kafka Streams menentukan timestamp record melalui `TimestampExtractor`.

Secara default, Kafka Streams dapat memakai timestamp Kafka record. Tetapi untuk domain event serius, sering lebih tepat mengambil timestamp dari payload, misalnya field `occurredAt`.

Contoh konseptual:

```java
public final class CaseEventTimestampExtractor implements TimestampExtractor {
    @Override
    public long extract(ConsumerRecord<Object, Object> record, long partitionTime) {
        CaseEvent event = (CaseEvent) record.value();

        if (event == null || event.occurredAt() == null) {
            // Strategy harus eksplisit: reject, fallback, atau mark invalid.
            return partitionTime;
        }

        return event.occurredAt().toInstant().toEpochMilli();
    }
}
```

Konfigurasi:

```java
props.put(StreamsConfig.DEFAULT_TIMESTAMP_EXTRACTOR_CLASS_CONFIG,
          CaseEventTimestampExtractor.class.getName());
```

### 4.1 Kesalahan umum

Kesalahan fatal:

```text
Window SLA memakai processing time padahal domain membutuhkan occurredAt.
```

Akibat:

1. backlog membuat event lama masuk window baru,
2. restart mengubah hasil aggregation,
3. replay historis menghasilkan output berbeda,
4. audit timeline tidak bisa dipertahankan.

Untuk sistem enforcement/regulatory, ini bukan sekadar bug teknis. Ini bisa menjadi masalah defensibility.

---

## 5. Stream Time

Kafka Streams punya konsep **stream time**, yaitu waktu yang bergerak berdasarkan timestamp record yang sudah diproses, bukan wall-clock time biasa.

Simplifikasi:

```text
stream time = max timestamp record yang sudah dilihat pada task/input partition set
```

Implikasinya:

1. Jika tidak ada record baru, stream time bisa tidak bergerak.
2. Window close/grace behavior bergantung pada advancement stream time.
3. Late event ditentukan relatif terhadap stream time/window end/grace.
4. Event out-of-order masih bisa diterima selama belum melewati grace.

Ini penting karena banyak engineer mengira window “selesai” berdasarkan jam dinding. Pada event-time processing, window selesai berdasarkan kemajuan waktu event dalam stream.

---

## 6. Windowing Fundamentals

Windowing menjawab pertanyaan:

> “Bagaimana kita mengelompokkan event berdasarkan waktu?”

Tanpa window, aggregation atas stream tidak pernah selesai karena stream bersifat unbounded.

Contoh pertanyaan windowed:

1. Berapa evidence submission per case per 10 menit?
2. Berapa case escalation dalam 1 jam terakhir?
3. Apakah payment diterima dalam 15 menit setelah invoice issued?
4. Apakah officer assignment terjadi dalam SLA 2 jam sejak case opened?
5. Apakah ada suspicious repeated update dalam 5 menit?

---

## 7. Tumbling Window

Tumbling window adalah window fixed-size yang tidak overlap.

Contoh:

```text
[10:00 - 10:05)
[10:05 - 10:10)
[10:10 - 10:15)
```

Setiap event masuk tepat satu window.

Kafka Streams DSL contoh:

```java
KTable<Windowed<String>, Long> counts = events
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeAndGrace(
        Duration.ofMinutes(5),
        Duration.ofMinutes(1)
    ))
    .count();
```

Makna:

```text
window size  : 5 menit
grace period : 1 menit
```

Event untuk window 10:00-10:05 masih diterima sampai stream time melewati 10:06.

Cocok untuk:

1. reporting fixed interval,
2. operational metrics,
3. rate monitoring,
4. periodic summary.

Risiko:

1. boundary effect,
2. late event setelah grace drop,
3. hasil bisa update beberapa kali sebelum final.

---

## 8. Hopping Window

Hopping window adalah fixed-size window yang overlap.

Contoh:

```text
size    : 10 menit
advance : 1 menit

[10:00 - 10:10)
[10:01 - 10:11)
[10:02 - 10:12)
...
```

Satu event bisa masuk banyak window.

Kafka Streams DSL:

```java
.windowedBy(TimeWindows
    .ofSizeAndGrace(Duration.ofMinutes(10), Duration.ofMinutes(2))
    .advanceBy(Duration.ofMinutes(1)))
```

Cocok untuk:

1. rolling metric,
2. moving count,
3. anomaly detection,
4. repeated behavior detection.

Trade-off:

1. output lebih banyak,
2. state lebih besar,
3. biaya RocksDB/changelog lebih tinggi,
4. downstream harus siap menerima banyak update.

---

## 9. Sliding Window

Sliding window berfokus pada pasangan event yang berada dalam jarak waktu tertentu.

Contoh:

> Join event A dan B jika terjadi dalam 15 menit untuk key yang sama.

Sliding window sering dipakai untuk join pattern dan temporal correlation.

Cocok untuk:

1. event correlation,
2. fraud pattern,
3. case step matching,
4. “X happened within N minutes of Y”.

Risiko:

1. state retention harus cukup,
2. out-of-order event bisa mengubah hasil,
3. join explosion jika cardinality/key buruk.

---

## 10. Session Window

Session window mengelompokkan event berdasarkan gap aktivitas.

Contoh:

```text
inactivity gap: 30 menit
```

Jika event untuk user/case datang berdekatan, mereka dianggap satu session. Jika gap lebih dari 30 menit, session baru dimulai.

DSL:

```java
.windowedBy(SessionWindows.ofInactivityGapAndGrace(
    Duration.ofMinutes(30),
    Duration.ofMinutes(5)
))
```

Cocok untuk:

1. user activity session,
2. investigation working session,
3. burst behavior,
4. interaction grouping.

Risiko penting:

1. session bisa merge ketika late event datang di antara dua session,
2. hasil sebelumnya bisa berubah,
3. downstream harus memahami bahwa session result tidak final sampai grace lewat.

---

## 11. Grace Period dan Late Events

Grace period adalah toleransi untuk menerima event yang datang terlambat relatif terhadap window.

Contoh:

```text
window       : 10:00 - 10:05
grace        : 1 menit
final close  : setelah 10:06, berdasarkan stream time
```

Event dengan timestamp 10:04:30 masih bisa diterima selama stream time belum melewati 10:06.

Jika event datang setelah grace, Kafka Streams menganggap event itu late beyond grace untuk window tersebut. Dalam banyak operasi windowed, record seperti ini tidak masuk aggregation window.

### 11.1 Grace adalah trade-off

Grace pendek:

```text
+ state lebih kecil
+ output lebih cepat final
+ latency rendah
- late event valid bisa hilang
- hasil business bisa kurang akurat
```

Grace panjang:

```text
+ lebih toleran terhadap delay/out-of-order
+ hasil lebih lengkap
- state lebih besar
- final result lebih lambat
- changelog lebih besar
- restore lebih berat
```

### 11.2 Cara memilih grace period

Jangan pilih grace secara asal. Gunakan data:

1. distribusi producer delay,
2. distribusi CDC delay,
3. network delay,
4. mobile/offline client behavior,
5. batch import delay,
6. SLA correctness,
7. toleransi bisnis terhadap revision/update.

Untuk regulatory system, grace harus dipertimbangkan terhadap aturan legal/prosedural. Misalnya, evidence yang terlambat disinkronkan dari offline device tetap mungkin valid secara hukum walau terlambat secara teknis.

---

## 12. Window Result Tidak Selalu Final

Aggregation windowed sering menghasilkan update berkali-kali.

Contoh count:

```text
10:00:10 event A -> count = 1
10:01:30 event B -> count = 2
10:04:50 event C -> count = 3
10:05:40 late event D timestamp 10:03 -> count = 4
```

Jika downstream mengira output pertama adalah final, sistem akan salah.

Ada dua model output:

### 12.1 Emit updates

Output dikirim setiap ada perubahan aggregate.

Cocok untuk:

1. dashboard real-time,
2. intermediate view,
3. monitoring.

Downstream harus mampu menerima update/overwrite berdasarkan key window.

### 12.2 Emit final result

Output hanya dikirim saat window final.

Cocok untuk:

1. billing,
2. compliance report,
3. SLA breach finalization,
4. external notification yang tidak boleh berubah.

Kafka Streams menyediakan suppression untuk skenario ini.

---

## 13. Suppression

Suppression menahan output intermediate sampai kondisi tertentu terpenuhi, misalnya window closed.

Contoh konseptual:

```java
KTable<Windowed<String>, Long> counts = events
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeAndGrace(
        Duration.ofMinutes(5),
        Duration.ofMinutes(1)
    ))
    .count()
    .suppress(Suppressed.untilWindowCloses(
        Suppressed.BufferConfig.unbounded()
    ));
```

Makna:

```text
Jangan emit perubahan count intermediate.
Emit hanya ketika window sudah close setelah grace.
```

### 13.1 Risiko suppression

Suppression butuh buffer.

Jika buffer unbounded:

```text
+ tidak kehilangan final result karena buffer penuh
- risiko memory pressure/OOM jika cardinality besar atau window panjang
```

Jika buffer bounded:

```text
+ memory lebih terkendali
- perlu strategi ketika buffer penuh
```

### 13.2 Kapan suppression tepat

Gunakan suppression ketika:

1. downstream butuh final result,
2. intermediate update berbahaya,
3. notification harus satu kali,
4. report window tidak boleh berubah setelah dikirim.

Hindari suppression jika:

1. cardinality sangat tinggi,
2. window panjang,
3. memory terbatas,
4. downstream bisa menerima update incremental.

---

## 14. Join Semantics

Join di stream processing tidak sama dengan SQL join di database.

SQL join biasanya bekerja pada bounded table snapshot.

Kafka Streams join bekerja pada:

```text
unbounded streams + partitioned state + event time + window/table semantics
```

Pertanyaan join yang harus selalu dijawab:

1. Join berdasarkan key apa?
2. Apakah kedua input co-partitioned?
3. Apakah ini stream-stream, stream-table, table-table, atau GlobalKTable join?
4. Apakah join butuh window?
5. Apakah late event boleh mengubah hasil?
6. Berapa lama state join disimpan?
7. Apa output saat pasangan belum ada?
8. Apa output saat record kanan berubah?
9. Apa yang terjadi jika record kiri/right duplicate?
10. Apa yang terjadi saat repartition internal dibuat?

---

## 15. Stream-Stream Join

Stream-stream join menghubungkan dua stream berdasarkan key dan window waktu.

Contoh domain:

```text
CaseOpened joined with OfficerAssigned within 2 hours by caseId.
```

DSL konseptual:

```java
KStream<String, CaseOpened> opened = builder.stream("case.opened");
KStream<String, OfficerAssigned> assigned = builder.stream("case.officer-assigned");

KStream<String, AssignmentSlaResult> result = opened.join(
    assigned,
    (o, a) -> AssignmentSlaResult.met(o.caseId(), o.occurredAt(), a.occurredAt()),
    JoinWindows.ofTimeDifferenceAndGrace(
        Duration.ofHours(2),
        Duration.ofMinutes(10)
    )
);
```

Semantik:

1. key harus sama,
2. timestamp kedua event harus berada dalam join window,
3. Kafka Streams menyimpan state dari kedua sisi untuk matching,
4. out-of-order event bisa tetap match selama belum melewati grace/retention,
5. duplicate di salah satu sisi bisa menghasilkan duplicate join output.

### 15.1 Inner join

Output muncul hanya jika kedua sisi match.

Cocok untuk:

1. correlation event,
2. completion detection,
3. pair matching.

### 15.2 Left join

Output muncul untuk sisi kiri, dengan kanan nullable jika belum ada match.

Namun hati-hati: pada stream-stream left join, timing output dipengaruhi oleh window semantics. Jangan mengasumsikan sama dengan SQL left join snapshot.

### 15.3 Outer join

Output muncul dari kedua sisi, walau pasangan tidak ada.

Cocok untuk gap detection, tetapi output cardinality dan interpretasi null harus hati-hati.

---

## 16. Stream-Table Join

Stream-table join memproses setiap record stream dengan lookup terhadap latest state table.

Contoh:

```text
case event stream enrich dengan latest officer profile table.
```

```java
KStream<String, CaseEvent> events = builder.stream("case.events");
KTable<String, OfficerProfile> officers = builder.table("officer.profile.compacted");

KStream<String, EnrichedCaseEvent> enriched = events.join(
    officers,
    (event, officer) -> EnrichedCaseEvent.of(event, officer)
);
```

Semantik:

1. setiap event kiri memicu lookup table kanan,
2. update table kanan tidak otomatis meng-emit ulang event kiri lama,
3. hasil bergantung pada table state saat record stream diproses,
4. jika replay dengan input order berbeda, hasil bisa berubah jika table changelog/order tidak dikontrol.

### 16.1 Risiko enrichment dengan latest state

Misalnya:

```text
10:00 CaseOpened by officer O1
10:10 OfficerProfile changed region from A to B
10:20 replay CaseOpened
```

Jika enrichment memakai latest profile tanpa event-time versioning, event lama bisa diperkaya dengan profile baru. Itu mungkin salah untuk audit.

Untuk regulatory historical correctness, pertimbangkan:

1. event-carried officer snapshot,
2. versioned reference data,
3. temporal table model,
4. include `validFrom` / `validTo`,
5. join dengan business-effective time, bukan latest state.

---

## 17. Table-Table Join

Table-table join menggabungkan dua changelog table.

Contoh:

```text
CaseStatusTable join CaseOwnerTable -> CaseAssignmentView
```

Semantik:

1. update di salah satu table bisa mengubah output table,
2. output adalah materialized view yang terus berubah,
3. tombstone/delete harus dipahami,
4. key alignment penting,
5. result table sering cocok untuk read model/projection.

Table-table join cocok untuk:

1. materialized view,
2. latest-state projection,
3. serving query via state store/interactive queries,
4. compacted output topic.

Tidak cocok untuk:

1. event historical fact reconstruction tanpa versioning,
2. one-time side effect,
3. notification yang tidak boleh berubah.

---

## 18. GlobalKTable Join

`GlobalKTable` mereplikasi seluruh table ke setiap Kafka Streams instance.

Cocok untuk reference data kecil/medium:

1. country code,
2. policy catalog,
3. officer metadata kecil,
4. tenant config,
5. product catalog kecil.

Keunggulan:

1. tidak perlu co-partitioning dengan stream kiri,
2. lookup bisa berdasarkan foreign key hasil mapping,
3. join lebih fleksibel.

Risiko:

1. seluruh data ada di setiap instance,
2. memory/disk membesar linear terhadap jumlah instance,
3. restore bisa berat,
4. tidak cocok untuk table sangat besar.

Rule of thumb:

```text
Small reference data -> GlobalKTable mungkin cocok.
Large domain table -> KTable dengan co-partitioning lebih masuk akal.
```

---

## 19. Co-Partitioning

Co-partitioning berarti topic yang akan di-join memiliki:

1. jumlah partition yang kompatibel,
2. partitioning strategy yang kompatibel,
3. key yang sama untuk record yang perlu bertemu,
4. data dengan key sama jatuh ke task yang sama.

Jika dua stream tidak co-partitioned, task lokal tidak bisa menjamin semua pasangan join ada di tempat yang sama.

Kafka Streams dapat membuat repartition topic internal pada operasi tertentu. Ini membantu correctness, tetapi punya biaya:

1. network shuffle,
2. extra topic,
3. extra storage,
4. extra serialization/deserialization,
5. extra latency,
6. extra failure surface.

---

## 20. Repartitioning

Repartitioning terjadi ketika key berubah sebelum operasi key-based seperti groupBy, join, aggregation.

Contoh:

```java
KStream<String, CaseEvent> byEventId = builder.stream("case.events");

KStream<String, CaseEvent> byCaseId = byEventId
    .selectKey((oldKey, event) -> event.caseId());

KTable<String, Long> counts = byCaseId
    .groupByKey()
    .count();
```

Karena key berubah dari `eventId` ke `caseId`, Kafka Streams perlu memastikan semua record dengan `caseId` sama berada di partition yang sama. Maka repartition topic bisa dibuat.

### 20.1 Repartition topic bukan detail kecil

Repartition topic adalah bagian dari data path.

Konsekuensi:

1. harus dimonitor,
2. mempengaruhi throughput,
3. mempengaruhi latency,
4. mempengaruhi storage,
5. mempengaruhi exactly-once transaction scope,
6. bisa menjadi bottleneck,
7. harus dipertimbangkan dalam capacity planning.

### 20.2 Cara mengurangi repartition tak perlu

1. Produce input topic dengan key yang benar sejak awal.
2. Hindari `selectKey` sebelum join/groupBy jika tidak perlu.
3. Gunakan topic khusus yang sudah keyed by domain key.
4. Pisahkan command/event stream yang key-nya berbeda.
5. Review topology description.

Gunakan:

```java
Topology topology = builder.build();
System.out.println(topology.describe());
```

untuk melihat source, processor, state store, sink, dan internal topic.

---

## 21. Aggregation Semantics

Aggregation mengubah stream event menjadi state.

Contoh:

```java
KTable<String, Long> countByCase = events
    .groupByKey()
    .count();
```

Ini bukan menghasilkan satu final result. Ini menghasilkan changelog update:

```text
case-1 -> 1
case-1 -> 2
case-1 -> 3
```

Output KTable adalah representasi perubahan state.

### 21.1 Reducer vs aggregator

Reducer cocok ketika value input dan output sama tipe atau bisa dikombinasikan langsung.

Aggregator cocok untuk state berbeda dari input.

Contoh aggregate:

```java
KTable<String, CaseSummary> summary = events
    .groupByKey()
    .aggregate(
        CaseSummary::empty,
        (caseId, event, aggregate) -> aggregate.apply(event),
        Materialized.as("case-summary-store")
    );
```

### 21.2 Aggregator harus deterministic

Hindari:

```java
aggregate.setUpdatedAt(Instant.now());
aggregate.setRandomId(UUID.randomUUID().toString());
aggregate.setExternalScore(callExternalApi(event));
```

Karena replay bisa menghasilkan output berbeda.

Gunakan data dari event atau metadata deterministik.

---

## 22. Window Store Retention

Windowed operation membutuhkan state store yang menyimpan record/aggregate selama window + grace + retention internal yang diperlukan.

Jika retention terlalu pendek:

1. late event valid bisa tidak diproses benar,
2. join match bisa hilang,
3. restore tidak punya state cukup,
4. hasil tidak akurat.

Jika retention terlalu panjang:

1. state store membesar,
2. changelog membesar,
3. restore lebih lama,
4. disk pressure meningkat,
5. compaction/cleanup lebih berat.

Rule:

```text
state retention harus mengikuti semantic requirement, bukan hanya storage preference.
```

---

## 23. Record Cache dan Commit Interval

Kafka Streams memiliki cache untuk mengurangi write amplification ke downstream topic/state changelog.

Efek cache:

1. multiple updates bisa digabung,
2. output bisa tertunda,
3. latency bisa berubah,
4. observasi intermediate result bisa berbeda.

`commit.interval.ms` mempengaruhi frekuensi commit processing progress. Dalam exactly-once, commit berarti commit transaksi yang mencakup offset dan output yang visible ke consumer dengan `read_committed`.

Konsekuensi:

1. commit terlalu sering -> overhead transaksi lebih tinggi,
2. commit terlalu jarang -> recovery replay lebih banyak,
3. cache besar -> throughput bagus, latency bisa naik,
4. cache kecil/disabled -> output lebih sering, write amplification naik.

---

## 24. Processing Guarantees Kafka Streams

Kafka Streams mendukung dua mode utama:

```text
at_least_once
exactly_once_v2
```

Beberapa versi lama juga mengenal `exactly_once`, tetapi untuk Kafka modern, pembahasan production biasanya mengarah ke `exactly_once_v2`.

---

## 25. At-Least-Once Semantics

Dengan at-least-once:

1. record tidak hilang selama Kafka dan aplikasi dikonfigurasi benar,
2. record bisa diproses ulang setelah crash,
3. output duplicate bisa terjadi,
4. state update bisa diulang,
5. downstream harus idempotent.

Contoh failure:

```text
1. Streams membaca offset 100.
2. Streams update state.
3. Streams menulis output.
4. Aplikasi crash sebelum commit offset.
5. Setelah restart, offset 100 dibaca lagi.
6. Output bisa ditulis lagi.
```

At-least-once cukup jika:

1. downstream idempotent,
2. output adalah update keyed compacted topic,
3. duplicate tidak berbahaya,
4. throughput/latency lebih penting,
5. sink eksternal sudah punya deduplication.

---

## 26. Exactly-Once v2 Semantics

Dengan `exactly_once_v2`, Kafka Streams memakai Kafka transactions untuk mengoordinasikan:

1. consumed offsets,
2. produced output records,
3. changelog updates,
4. repartition topic writes.

Tujuannya:

> Hasil pemrosesan Kafka-to-Kafka terlihat sekali secara konsisten meskipun terjadi failure.

Konfigurasi:

```java
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG,
          StreamsConfig.EXACTLY_ONCE_V2);
```

### 26.1 Apa yang dijamin

Dalam scope Kafka Streams dan Kafka topics:

1. offset commit dan output topic commit dikoordinasikan,
2. output dari transaction aborted tidak terlihat oleh consumer `read_committed`,
3. state/changelog/output lebih konsisten saat crash,
4. duplicate output Kafka-to-Kafka bisa dikurangi secara signifikan sesuai semantics.

### 26.2 Apa yang tidak dijamin

Tidak otomatis menjamin exactly-once untuk:

1. database write di dalam `foreach`,
2. REST call,
3. email sending,
4. payment API,
5. file write,
6. external cache mutation.

Jika butuh external effect, gunakan:

1. transactional outbox,
2. idempotency key,
3. dedup table,
4. idempotent sink connector,
5. write-behind dari Kafka output topic,
6. business-level reconciliation.

---

## 27. Isolation Level untuk Downstream Consumer

Jika upstream memakai transactions, downstream consumer harus menggunakan isolation yang sesuai.

Konsep:

```text
read_uncommitted -> bisa membaca record dari transaksi aborted
read_committed   -> hanya membaca committed transactional records
```

Untuk pipeline yang mengandalkan exactly-once Kafka transactions, downstream sebaiknya membaca dengan `read_committed`.

Kalau tidak, kamu bisa melihat output yang seharusnya tidak terlihat.

---

## 28. Exactly-Once dan Performance Trade-Off

Exactly-once bukan gratis.

Potensi biaya:

1. transaction coordination,
2. producer fencing,
3. commit overhead,
4. latency tambahan,
5. broker load tambahan,
6. konfigurasi lebih sensitif,
7. failure handling lebih kompleks.

Decision heuristic:

Pakai `exactly_once_v2` jika:

1. output Kafka-to-Kafka harus konsisten,
2. stateful processing penting,
3. duplicate output sulit ditoleransi,
4. downstream menggunakan compacted/materialized view penting,
5. correctness lebih penting daripada latency minimum.

Pakai `at_least_once` jika:

1. downstream idempotent,
2. duplicate acceptable,
3. pipeline sangat latency-sensitive,
4. topology stateless sederhana,
5. operational simplicity lebih penting.

---

## 29. The External Side Effect Trap

Anti-pattern umum:

```java
stream.foreach((key, event) -> {
    externalCaseApi.updateStatus(event.caseId(), event.status());
});
```

Masalah:

1. Kafka Streams tidak bisa memasukkan external API call ke Kafka transaction.
2. Jika call berhasil lalu aplikasi crash sebelum offset commit, event diproses ulang.
3. Jika call gagal setelah state update, state Kafka dan external system bisa diverge.
4. Retry bisa mengirim duplicate side effect.
5. Ordering external system belum tentu sama dengan Kafka partition ordering.

Pattern yang lebih aman:

```text
Kafka Streams input
      |
      v
Kafka Streams deterministic processing
      |
      v
output command/event topic
      |
      v
idempotent sink/service handles external side effect
```

Dengan event output berisi:

```json
{
  "eventId": "evt-123",
  "idempotencyKey": "case-9001:status:ESCALATED:v7",
  "caseId": "CASE-9001",
  "targetStatus": "ESCALATED"
}
```

External side-effect service harus menyimpan idempotency key.

---

## 30. Correctness Pattern untuk Regulatory Workflow

Untuk enforcement/case lifecycle system, Kafka Streams sering dipakai untuk:

1. SLA breach detection,
2. escalation trigger,
3. case timeline projection,
4. duplicate evidence detection,
5. assignment workload aggregation,
6. compliance reporting,
7. audit materialized view.

### 30.1 SLA breach detection

Naive model:

```text
If case not assigned after 2 hours, emit breach.
```

Pertanyaan correctness:

1. 2 jam sejak event apa?
2. Waktu pakai occurredAt atau ingestion time?
3. Bagaimana jika assignment event terlambat?
4. Bagaimana jika case cancelled sebelum 2 jam?
5. Bagaimana jika officer reassigned?
6. Apakah breach bisa direvisi?
7. Apakah notification boleh dikirim sebelum window final?
8. Apakah late evidence mengubah classification?

### 30.2 Better model

Gunakan stream/table state:

```text
CaseOpened stream
OfficerAssigned stream
CaseClosed/Cancelled stream
PolicyConfig table
```

Materialize state:

```text
caseId -> lifecycle state
```

Emit event:

```text
AssignmentSlaBreached
```

hanya jika invariant terpenuhi:

```text
case opened
AND no valid assignment within SLA window
AND not cancelled/closed before SLA boundary
AND grace period has passed
AND policy version known
```

Untuk finality, suppression atau scheduled processor/punctuator bisa dipertimbangkan, tetapi harus hati-hati terhadap stream-time vs wall-clock semantics.

---

## 31. Windowing untuk Timeout dan SLA

Kafka Streams windowing bisa membantu mendeteksi “event B tidak terjadi setelah event A”, tetapi modelnya tidak selalu sesederhana join.

### 31.1 Positive match

```text
A joined with B within 2 hours
```

Ini relatif mudah.

### 31.2 Negative match

```text
A happened, B did not happen within 2 hours
```

Ini lebih sulit karena kamu perlu menunggu sampai window benar-benar selesai.

Pilihan:

1. stream-stream left join + suppression/finalization,
2. state store + punctuator,
3. emit deadline event ke delay topic/scheduler,
4. external workflow engine,
5. hybrid Kafka + database state machine.

Kafka Streams bisa melakukan ini, tetapi desain harus eksplisit soal finality dan late events.

---

## 32. Punctuator: Stream-Time vs Wall-Clock-Time

Processor API menyediakan punctuation berdasarkan stream time atau wall-clock time.

### 32.1 Stream-time punctuator

Berjalan saat stream time bergerak.

Cocok untuk:

1. event-time deadline,
2. deterministic replay,
3. window-like behavior.

Risiko:

1. jika tidak ada event baru, punctuator tidak berjalan,
2. deadline bisa tidak “fire” saat stream idle.

### 32.2 Wall-clock punctuator

Berjalan berdasarkan waktu sistem.

Cocok untuk:

1. periodic cleanup,
2. operational heartbeat,
3. polling external metadata.

Risiko:

1. replay tidak deterministik,
2. output bisa berbeda antara run,
3. clock skew,
4. testing lebih sulit.

Untuk audit-critical stream processing, stream-time biasanya lebih defensible.

---

## 33. Duplicate Input dan Deduplication

Exactly-once Kafka Streams tidak otomatis menghapus duplicate business events jika producer mengirim event berbeda dengan business duplicate.

Contoh:

```text
Producer mengirim EvidenceSubmitted dua kali dengan eventId sama atau berbeda.
```

Kafka Streams bisa memproses dua record karena dari sudut Kafka itu dua records.

Deduplication butuh business key:

```text
dedup key = eventId
atau
caseId + evidenceId + actionType + version
```

Stateful dedup pattern:

```java
// Konseptual, biasanya dilakukan dengan Processor API/state store
if (seenEventIds.contains(event.eventId())) {
    drop;
} else {
    seenEventIds.put(event.eventId(), event.occurredAt());
    forward(event);
}
```

Trade-off:

1. retention dedup store berapa lama?
2. eventId global atau per aggregate?
3. memory/disk cost?
4. apa yang terjadi setelah retention habis?
5. apakah duplicate lama masih berbahaya?

---

## 34. Out-of-Order Events

Out-of-order adalah normal dalam distributed system.

Penyebab:

1. multiple producers,
2. retries,
3. network variation,
4. CDC snapshot + streaming transition,
5. mobile/offline sync,
6. partitioning berubah,
7. upstream batch import,
8. clock skew.

Kafka hanya menjamin ordering dalam partition berdasarkan append order. Event-time ordering bisa berbeda.

Contoh:

```text
Kafka offset 100 -> CaseEscalated occurredAt 10:20
Kafka offset 101 -> CaseAssigned  occurredAt 10:05
```

Jika logic bergantung pada occurredAt, harus menggunakan event-time state, bukan offset order semata.

---

## 35. Watermark: Hati-Hati dengan Istilah

Banyak stream processing system memakai konsep watermark eksplisit. Kafka Streams lebih sering menjelaskan behavior lewat stream time, window close, dan grace period.

Jangan asal memindahkan mental model Flink watermark ke Kafka Streams tanpa memahami perbedaannya.

Yang perlu kamu pikirkan di Kafka Streams:

1. record timestamp,
2. timestamp extractor,
3. stream time advancement,
4. window end,
5. grace period,
6. retention,
7. suppression/final result.

---

## 36. Testing Semantics dengan TopologyTestDriver

Kafka Streams menyediakan `TopologyTestDriver` untuk menguji topology secara deterministik.

Yang harus diuji:

1. ordered events,
2. out-of-order events,
3. late within grace,
4. late beyond grace,
5. duplicate events,
6. tombstone,
7. null values,
8. repartition behavior secara topology description,
9. window final output,
10. suppression behavior,
11. state restore assumption,
12. exactly-once tidak bisa sepenuhnya dites hanya dengan unit test; perlu integration/failure test.

Contoh pseudo-test:

```java
@Test
void shouldCountLateEventWithinGrace() {
    // given window 10:00-10:05 grace 1 minute
    pipeInput("case-1", eventAt("10:00:30"));
    pipeInput("case-1", eventAt("10:04:50"));

    // advance stream time but not beyond grace
    pipeInput("case-2", eventAt("10:05:30"));

    // late but within grace
    pipeInput("case-1", eventAt("10:03:00"));

    // expect count includes late event
}
```

Test late beyond grace:

```java
@Test
void shouldDropOrIgnoreLateEventBeyondGrace() {
    pipeInput("case-1", eventAt("10:00:30"));

    // advance stream time beyond 10:06
    pipeInput("case-2", eventAt("10:06:30"));

    // too late for window 10:00-10:05 grace 1
    pipeInput("case-1", eventAt("10:03:00"));

    // expect not included in final count
}
```

---

## 37. Integration Testing Exactly-Once

Exactly-once processing perlu diuji dengan failure scenario, bukan hanya happy path.

Test ideas:

1. kill application after input consumed before output visible,
2. kill during transaction commit,
3. restart and verify output duplicates,
4. verify downstream `read_committed`,
5. verify state restored correctly,
6. verify changelog/repartition topics survive restart,
7. verify producer fencing if duplicate app instance with same `application.id` appears.

Tools:

1. Testcontainers Kafka,
2. multiple app instances,
3. controlled crash hooks,
4. output topic assertion by key/version,
5. idempotency assertion.

---

## 38. Production Configuration Notes

Example baseline untuk stateful topology yang butuh stronger Kafka-to-Kafka correctness:

```java
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "case-sla-streams-v1");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "kafka:9092");
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, StreamsConfig.EXACTLY_ONCE_V2);
props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass().getName());
props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, SpecificAvroSerde.class.getName());
props.put(StreamsConfig.DEFAULT_TIMESTAMP_EXTRACTOR_CLASS_CONFIG,
          CaseEventTimestampExtractor.class.getName());
props.put(StreamsConfig.NUM_STREAM_THREADS_CONFIG, 4);
props.put(StreamsConfig.STATE_DIR_CONFIG, "/var/lib/kafka-streams/case-sla");
props.put(StreamsConfig.COMMIT_INTERVAL_MS_CONFIG, 1000);
```

Catatan:

1. `application.id` adalah identity stateful app; menggantinya berarti app baru dengan state baru.
2. `state.dir` harus berada di disk yang layak untuk RocksDB.
3. `processing.guarantee=exactly_once_v2` meningkatkan correctness Kafka-to-Kafka, tetapi bukan pengganti idempotency eksternal.
4. `commit.interval.ms` mempengaruhi latency/transaction overhead.
5. SerDe harus stabil dan schema-compatible.
6. Timestamp extractor harus sesuai domain.

---

## 39. Design Trade-Off Matrix

| Problem | Opsi | Kelebihan | Risiko |
|---|---|---|---|
| Real-time dashboard | Emit intermediate updates | Low latency | Hasil berubah |
| Compliance final report | Suppression sampai window close | Final result lebih kuat | Latency dan buffer cost |
| Late events sering | Grace panjang | Akurasi lebih baik | State besar |
| Latency ketat | Grace pendek | Cepat final | Late valid event hilang |
| Join large streams | Co-partitioned KStream join | Scalable | Key/partition harus benar |
| Reference data kecil | GlobalKTable | Fleksibel | Replicated state di semua instance |
| External side effect | Output command topic + idempotent sink | Recovery lebih aman | Komponen tambahan |
| Kafka-to-Kafka correctness | exactly_once_v2 | Lebih konsisten | Overhead transaksi |
| Duplicate acceptable | at_least_once | Simpler/faster | Downstream harus idempotent |

---

## 40. Anti-Patterns

### 40.1 Memakai processing time untuk business SLA

Buruk:

```text
SLA dihitung dari waktu consumer memproses event.
```

Akibat: backlog/restart mengubah hasil SLA.

Lebih baik:

```text
SLA dihitung dari event occurredAt + policy version.
```

---

### 40.2 Join tanpa memahami key

Buruk:

```text
case.events keyed by eventId
case.assignment keyed by officerId
lalu join berharap by caseId
```

Kafka Streams akan perlu repartition atau join tidak sesuai ekspektasi.

Lebih baik:

```text
Topic untuk lifecycle join harus keyed by caseId.
```

---

### 40.3 Menganggap KTable enrichment historis benar

Buruk:

```text
event tahun lalu diperkaya dengan latest officer profile hari ini.
```

Lebih baik:

```text
Gunakan snapshot dalam event atau versioned reference data.
```

---

### 40.4 Side effect di dalam topology

Buruk:

```java
stream.foreach((k, v) -> paymentApi.charge(v));
```

Lebih baik:

```text
Streams menulis PaymentCommand ke Kafka.
Payment service melakukan idempotent charge.
```

---

### 40.5 Suppression unbounded tanpa capacity analysis

Buruk:

```text
Suppression unbounded untuk high-cardinality 24-hour window.
```

Akibat: memory pressure/OOM.

Lebih baik:

```text
Hitung cardinality, window duration, record rate, memory budget, fallback behavior.
```

---

### 40.6 Menganggap exactly-once menghapus duplicate business events

Buruk:

```text
processing.guarantee=exactly_once_v2, jadi tidak perlu eventId/dedup.
```

Lebih baik:

```text
EOS mengatur processing transaction; business dedup tetap butuh idempotency key.
```

---

## 41. Production Failure Modes

### 41.1 Late event setelah grace

Gejala:

1. hasil aggregation tidak sesuai expected total,
2. audit menemukan event valid tidak dihitung,
3. window output sudah final.

Mitigasi:

1. ukur lateness distribution,
2. adjust grace,
3. buat late-event side output/manual review,
4. gunakan reprocessing/backfill policy,
5. pisahkan real-time result dan corrected result.

---

### 41.2 Repartition topic bottleneck

Gejala:

1. latency naik setelah deploy topology baru,
2. broker network meningkat,
3. internal topic throughput tinggi,
4. consumer lag di repartition source.

Mitigasi:

1. inspect topology,
2. produce with correct key upstream,
3. reduce unnecessary key changes,
4. increase partitions carefully,
5. monitor internal topics.

---

### 41.3 State store restore storm

Gejala:

1. restart lama,
2. changelog read tinggi,
3. disk/network spike,
4. app tidak ready lama.

Mitigasi:

1. standby replicas,
2. persistent state volume,
3. rolling restart gradual,
4. state size control,
5. changelog topic health monitoring.

---

### 41.4 Duplicate output after crash

Gejala:

1. downstream menerima event sama dua kali,
2. external side effect berulang,
3. compacted output aman tapi append-only output duplicate.

Mitigasi:

1. exactly_once_v2 untuk Kafka-to-Kafka,
2. idempotency key,
3. output event version,
4. sink dedup,
5. avoid external side effect inside Streams.

---

### 41.5 Historical replay menghasilkan hasil berbeda

Penyebab:

1. processing time dipakai,
2. external API enrichment,
3. latest KTable enrichment tanpa versioning,
4. random ID,
5. non-deterministic aggregation.

Mitigasi:

1. event-time timestamp,
2. deterministic functions,
3. reference data versioning,
4. avoid side effects,
5. golden replay tests.

---

## 42. Checklist Desain Kafka Streams Semantics

Sebelum production, jawab ini:

### Time

- [ ] Timestamp record berasal dari field apa?
- [ ] Event time atau processing time?
- [ ] Apakah timestamp extractor sudah dites untuk invalid/null timestamp?
- [ ] Apakah clock skew upstream dipertimbangkan?

### Window

- [ ] Window type apa: tumbling, hopping, sliding, session?
- [ ] Window size berdasarkan requirement apa?
- [ ] Grace period berdasarkan data lateness atau tebakan?
- [ ] Late beyond grace akan diapakan?
- [ ] Output intermediate atau final?

### Join

- [ ] Join type apa?
- [ ] Key sama?
- [ ] Co-partitioned?
- [ ] Butuh repartition?
- [ ] State retention cukup?
- [ ] Null/tombstone behavior dipahami?

### State

- [ ] State store size diestimasi?
- [ ] Changelog topic dikonfigurasi dan dimonitor?
- [ ] Restore time acceptable?
- [ ] Standby replica diperlukan?

### Processing Guarantee

- [ ] at-least-once cukup atau butuh exactly_once_v2?
- [ ] Downstream consumer pakai `read_committed` jika perlu?
- [ ] External side effects idempotent?
- [ ] Duplicate business event didedup?

### Testing

- [ ] Ordered event test?
- [ ] Out-of-order test?
- [ ] Late within grace test?
- [ ] Late beyond grace test?
- [ ] Duplicate test?
- [ ] Restart/failure test?
- [ ] Replay determinism test?

---

## 43. Latihan / Thought Exercises

### Exercise 1 — SLA Assignment

Desain Kafka Streams topology untuk mendeteksi:

```text
CaseOpened harus diikuti OfficerAssigned dalam 2 jam.
Jika tidak, emit AssignmentSlaBreached.
```

Jawab:

1. Topic input apa saja?
2. Key masing-masing topic?
3. Pakai stream-stream join, state store + punctuator, atau pattern lain?
4. Timestamp pakai apa?
5. Grace period berapa?
6. Bagaimana jika OfficerAssigned datang terlambat setelah breach emitted?
7. Apakah breach final atau bisa dikoreksi?
8. Bagaimana testing late event?

---

### Exercise 2 — Historical Enrichment

Ada event:

```text
CaseDecisionMade(caseId, officerId, occurredAt)
```

Kamu ingin enrich dengan officer department.

Pertanyaan:

1. Apakah cukup join dengan latest OfficerProfile KTable?
2. Apa masalah audit jika officer pindah department?
3. Bagaimana desain versioned reference data?
4. Apakah lebih baik event membawa department snapshot?
5. Apa trade-off event-carried state vs lookup table?

---

### Exercise 3 — Deduplication Store

Producer kadang mengirim duplicate `EvidenceSubmitted`.

Desain dedup:

1. Dedup key apa?
2. Retention dedup store berapa lama?
3. Apa yang terjadi jika duplicate datang setelah retention habis?
4. Bagaimana output jika duplicate ditemukan?
5. Bagaimana changelog topic dedup store dikonfigurasi?

---

### Exercise 4 — Suppression Capacity

Kamu punya:

```text
window size       : 1 jam
grace             : 15 menit
unique case/hour  : 2 juta
aggregate size    : 300 bytes
```

Pertanyaan:

1. Apakah unbounded suppression aman?
2. Estimasi buffer/state minimum?
3. Apa strategi jika memory tidak cukup?
4. Bisa downstream menerima intermediate update?
5. Apakah output final benar-benar wajib?

---

## 44. Ringkasan

Kafka Streams processing semantics adalah tentang memastikan bahwa output bukan hanya “terproduksi”, tetapi **benar menurut waktu, key, state, dan failure behavior**.

Inti Part 021:

1. Event-time correctness jauh lebih penting daripada processing-time convenience.
2. `TimestampExtractor` adalah keputusan domain, bukan detail teknis kecil.
3. Window selalu membawa trade-off antara latency, completeness, state size, dan finality.
4. Grace period harus dipilih berdasarkan lateness distribution dan requirement bisnis.
5. Window aggregation sering menghasilkan update, bukan final result.
6. Suppression bisa memberi final result, tetapi membawa risiko buffer/memory.
7. Join di Kafka Streams bergantung pada key, co-partitioning, state, dan waktu.
8. Repartition topic adalah bagian nyata dari data path dan harus dimonitor.
9. KTable enrichment memakai latest state; untuk audit historis, ini bisa salah tanpa versioning.
10. `exactly_once_v2` memperkuat Kafka-to-Kafka processing, tetapi tidak membuat external side effect otomatis exactly-once.
11. Business duplicate tetap butuh idempotency/deduplication key.
12. Topology yang benar harus diuji terhadap out-of-order, late, duplicate, restart, dan replay.

Jika Part 019 menjawab “bagaimana menulis aplikasi Kafka Streams”, dan Part 020 menjawab “bagaimana state disimpan”, maka Part 021 menjawab:

> “Bagaimana memastikan aplikasi Kafka Streams tetap benar ketika waktu, state, failure, dan ordering tidak ideal?”

---

## 45. Referensi

Referensi yang relevan untuk part ini:

1. Apache Kafka Documentation — Streams Core Concepts.
2. Apache Kafka Documentation — Streams DSL API.
3. Apache Kafka Documentation — Configuring Kafka Streams Applications.
4. Apache Kafka Documentation — Streams Developer Guide.
5. Confluent Documentation — Kafka Streams Concepts.
6. Confluent Documentation — Kafka Streams Configuration.
7. Confluent Documentation — Windowing in Kafka Streams.
8. Confluent Documentation — Kafka Streams Joins and Processing Guarantees.
9. Kafka Improvement Proposals terkait exactly-once dan Kafka Streams processing semantics.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Kafka Streams State: RocksDB, Changelog, Standby Replica, Restore, Interactive Queries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-022.md">Part 022 — Spring Boot and Kafka: Practical Java Integration Without Losing Kafka Semantics ➡️</a>
</div>

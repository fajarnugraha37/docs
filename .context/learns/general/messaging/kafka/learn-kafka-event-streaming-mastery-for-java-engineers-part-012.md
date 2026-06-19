# learn-kafka-event-streaming-mastery-for-java-engineers-part-012.md

# Part 012 — Log Compaction and KTable Mental Model

## Status Seri

- **Series**: `learn-kafka-event-streaming-mastery-for-java-engineers`
- **Part**: `012 / 034`
- **Status**: Belum selesai. Ini bukan bagian terakhir.
- **Part sebelumnya**: Part 011 — Topic Design and Governance: Naming, Retention, Compaction, ACL, Ownership
- **Part berikutnya**: Part 013 — Kafka Security: TLS, SASL, ACL, Principal, Multi-Tenant Boundaries

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu seharusnya mampu:

1. Memahami **log compaction** sebagai retention policy berbasis **key**, bukan berbasis waktu saja.
2. Membedakan topic dengan `cleanup.policy=delete`, `compact`, dan `compact,delete`.
3. Menjelaskan kenapa compacted topic dapat digunakan untuk merekonstruksi **latest state**.
4. Memahami hubungan antara **compacted topic**, **changelog stream**, **KTable**, dan **state store**.
5. Mendesain topic untuk reference data, snapshot state, cache warmup, materialized view, dan changelog internal.
6. Menjelaskan tombstone record dan konsekuensi delete semantics.
7. Menghindari kesalahan desain: key tidak stabil, null key, tombstone retention terlalu pendek, compaction dianggap synchronous, dan compacted topic dianggap database.
8. Melakukan reasoning production: bootstrap consumer dari compacted topic, restore state, data retention, disk growth, dan consistency window.

Part ini penting karena Kafka bukan hanya menyimpan event historis. Dengan log compaction, Kafka juga bisa menyimpan **state terkini per key**. Inilah jembatan mental antara:

```text
stream of events  --->  changelog of state  --->  table / materialized view
```

Kalau Part 001 membahas Kafka sebagai log, Part 012 membahas bagaimana log bisa diperlakukan sebagai **table yang berubah sepanjang waktu**.

---

## 2. Mental Model Utama

### 2.1 Retention biasa: buang berdasarkan usia/ukuran

Topic Kafka biasa menggunakan cleanup policy `delete`. Dengan policy ini, Kafka menyimpan record sampai segment log melampaui batas waktu atau ukuran tertentu.

Mental modelnya:

```text
record lama  --->  akhirnya dibuang
record baru  --->  disimpan sampai retention habis
```

Contoh:

```properties
cleanup.policy=delete
retention.ms=604800000       # 7 hari
retention.bytes=-1           # tidak dibatasi ukuran
```

Cocok untuk:

- event historis,
- telemetry,
- audit event dengan retention tertentu,
- clickstream,
- activity stream,
- command/event flow yang memang punya umur simpan terbatas.

Tetapi `delete` policy tidak menjawab kebutuhan ini:

> “Saya tidak butuh semua perubahan lama, tapi saya perlu tahu nilai terakhir dari setiap customer/product/case/account.”

Untuk itu Kafka menyediakan log compaction.

---

### 2.2 Log compaction: simpan latest value per key

Log compaction adalah retention policy yang menjaga agar Kafka mempertahankan **setidaknya record terakhir untuk setiap key** dalam partition.

Mental modelnya:

```text
key=A value=v1
key=B value=v1
key=A value=v2
key=A value=v3
key=B value=v2

Setelah compaction, Kafka boleh membuang update lama:

key=A value=v3
key=B value=v2
```

Bukan berarti Kafka langsung menghapus record lama saat record baru datang. Compaction adalah proses background. Sebelum log cleaner berjalan, record lama masih bisa ada. Setelah compaction, record lama untuk key yang sama boleh dibuang.

Jadi invariant yang benar:

```text
Compacted topic eventually retains the latest value for each key.
```

Bukan:

```text
Compacted topic always contains only one record per key.
```

Perbedaan ini sangat penting.

---

### 2.3 Compacted topic bukan database table biasa

Compacted topic mirip table karena menyimpan latest state per key, tapi bukan database table dalam arti umum.

| Aspek | Database Table | Compacted Kafka Topic |
|---|---|---|
| Update | Mutasi row in-place | Append record baru dengan key sama |
| Storage | Current row + engine internals | Append-only log + background compaction |
| Query by key | Native | Tidak native oleh broker Kafka biasa |
| Query arbitrary predicate | Bisa lewat index/query engine | Tidak bisa langsung |
| Uniqueness constraint | Bisa enforce primary key | Tidak enforce di write path |
| Delete | Delete row | Tombstone record |
| Snapshot | Current table state | Replay compacted log dari awal |
| Consistency | Bergantung DB isolation | Eventual via compaction/replay |

Kafka tetap log. Compaction hanya membuat log tersebut bisa digunakan sebagai sumber latest state.

---

### 2.4 Stream-table duality

Kafka Streams dan ksqlDB memperkenalkan mental model **stream-table duality**:

- Stream adalah sequence perubahan.
- Table adalah state terakhir hasil menerapkan sequence perubahan tersebut.

Contoh stream:

```text
offset=0 key=case-1 status=OPENED
offset=1 key=case-2 status=OPENED
offset=2 key=case-1 status=ASSIGNED
offset=3 key=case-1 status=ESCALATED
offset=4 key=case-2 status=CLOSED
```

Jika diperlakukan sebagai table, state akhirnya:

```text
case-1 -> ESCALATED
case-2 -> CLOSED
```

Inilah inti KTable:

```text
KTable = changelog stream interpreted as latest value per key
```

Setiap record adalah update terhadap row dengan primary key yang sama.

---

## 3. Konsep Inti

## 3.1 Key adalah syarat utama compaction

Log compaction bekerja berdasarkan **record key**.

Jika record tidak punya key, Kafka tidak bisa menentukan record mana yang menggantikan record mana.

Contoh buruk:

```json
{
  "caseId": "CASE-001",
  "status": "OPENED"
}
```

Jika `caseId` hanya ada di value dan Kafka record key adalah `null`, maka topic compacted tidak berguna untuk latest state per case.

Contoh benar:

```text
Kafka record key   = "CASE-001"
Kafka record value = { "caseId": "CASE-001", "status": "OPENED" }
```

Aturan desain:

```text
Jika topic akan dicompact, key harus menjadi identitas state yang ingin dikompact.
```

---

## 3.2 Compaction bekerja per partition

Kafka partition adalah unit log. Compaction berjalan di level partition.

Jika key yang sama secara konsisten diarahkan ke partition yang sama, compaction bisa menjaga latest value untuk key tersebut.

Default key partitioning Kafka menjaga key yang sama masuk ke partition yang sama selama:

1. key tidak berubah,
2. partition count tidak diubah secara sembarangan,
3. producer partitioner stabil,
4. serialization key stabil.

Jika partition count topic dinaikkan, mapping key ke partition bisa berubah untuk record baru. Akibatnya, key lama dan key baru berpotensi tersebar di partition berbeda tergantung partitioner dan timing. Karena compaction hanya per partition, ini bisa merusak asumsi latest-state reconstruction untuk key tertentu.

Konsekuensi desain:

```text
Untuk compacted topic yang menjadi state source penting, partition count harus direncanakan serius sejak awal.
```

---

## 3.3 Offset tetap tidak berubah

Compaction tidak membuat offset menjadi rapat kembali.

Sebelum compaction:

```text
offset 0: key=A value=1
offset 1: key=B value=1
offset 2: key=A value=2
offset 3: key=C value=1
offset 4: key=A value=3
```

Setelah compaction secara konseptual:

```text
offset 1: key=B value=1
offset 3: key=C value=1
offset 4: key=A value=3
```

Offset `0` dan `2` bisa hilang, tetapi offset yang tersisa tidak dinomori ulang.

Jadi jangan pernah membangun logika aplikasi yang mengasumsikan offset contiguous.

Offset adalah posisi di log, bukan nomor baris table.

---

## 3.4 Compaction tidak synchronous

Ketika kamu produce:

```text
key=A value=v1
key=A value=v2
key=A value=v3
```

Kafka tidak langsung menghapus `v1` dan `v2` saat `v3` masuk.

Compaction dilakukan oleh log cleaner thread. Ia memproses segment eligible berdasarkan konfigurasi seperti dirty ratio, segment age, dan resource background cleaning.

Jadi compacted topic bisa berisi banyak versi lama untuk key yang sama untuk beberapa waktu.

Invariant production:

```text
Consumer harus benar jika melihat beberapa update untuk key yang sama.
```

Karena itulah KTable memperlakukan record sebagai sequence upsert.

---

## 3.5 Tombstone record

Delete dalam compacted topic dilakukan dengan record yang value-nya `null`.

```text
key=A value={"name":"Alice"}
key=A value=null
```

Record dengan key non-null dan value null disebut **tombstone**.

Maknanya:

```text
Delete state for key A.
```

Setelah tombstone diproses oleh consumer, state lokal untuk key tersebut harus dihapus.

Secara konseptual:

```text
Before:
A -> Alice

Tombstone:
A -> null

After:
A is absent
```

Tombstone sendiri juga disimpan sementara. Setelah melewati `delete.retention.ms`, tombstone dapat dibersihkan juga oleh compaction.

---

## 3.6 `delete.retention.ms` adalah batas untuk bootstrap snapshot

`delete.retention.ms` menentukan berapa lama tombstone dipertahankan di compacted topic.

Ini penting untuk consumer baru yang membaca dari offset 0.

Misalnya:

```text
T0: key=A value=v1
T1: key=A value=null    # tombstone
T2: tombstone dibuang setelah delete.retention.ms
T3: consumer baru mulai baca dari offset 0
```

Jika consumer baru mulai setelah tombstone dibuang, ia mungkin tidak pernah melihat delete. Apakah itu masalah? Tergantung apakah record lama `v1` juga sudah dibuang. Dalam compacted log yang benar, old value untuk key yang sudah tombstoned seharusnya juga eligible untuk dibuang. Tetapi untuk restore state yang besar dan lambat, tombstone retention terlalu pendek bisa membuat proses bootstrap tidak mendapatkan snapshot delete yang konsisten jika scan dari awal belum selesai sebelum tombstone hilang.

Prinsipnya:

```text
Tombstone retention harus lebih lama daripada waktu maksimum consumer baru melakukan full bootstrap dari awal.
```

Untuk topic state besar, ini bukan detail kecil.

---

## 3.7 `cleanup.policy=compact` vs `cleanup.policy=compact,delete`

Ada dua pola umum.

### Compact only

```properties
cleanup.policy=compact
```

Tujuannya menjaga latest value per key tanpa batas umur eksplisit untuk latest record.

Cocok untuk:

- reference data,
- account profile,
- customer status,
- product catalog,
- case latest state,
- materialized view changelog.

### Compact plus delete

```properties
cleanup.policy=compact,delete
retention.ms=2592000000 # 30 hari
```

Tujuannya:

1. menjaga latest value per key selama record masih dalam retention window,
2. tetap membuang segment yang sudah terlalu tua.

Cocok untuk state yang punya horizon waktu:

- session state,
- temporary entitlement,
- rolling aggregate,
- transient workflow state,
- intermediate stream processing topic.

Tetapi hati-hati: `compact,delete` dapat membuat latest value untuk key hilang jika seluruh segment sudah melewati retention policy. Jangan gunakan untuk state yang harus bisa direkonstruksi selamanya.

---

## 4. Deep Dive: Bagaimana Log Compaction Bekerja

## 4.1 Log segment

Kafka topic partition disimpan sebagai beberapa segment.

Secara konseptual:

```text
partition-0/
  00000000000000000000.log
  00000000000000000000.index
  00000000000000100000.log
  00000000000000100000.index
  00000000000000200000.log
  00000000000000200000.index
```

Kafka tidak membersihkan record satu per satu di active segment secara langsung. Compaction biasanya bekerja pada segment yang sudah tidak aktif dan eligible untuk cleaning.

Mental model:

```text
active segment   = tempat write saat ini
closed segments  = kandidat compaction
```

---

## 4.2 Dirty dan clean section

Dalam compacted log, secara konseptual ada bagian:

```text
clean section | dirty section
```

- Clean section sudah pernah dicompact.
- Dirty section berisi record baru setelah compaction terakhir.

Log cleaner memproses dirty section, membangun map latest offset per key, lalu menyalin record yang masih relevan ke segment baru.

Sederhananya:

```text
Input dirty log:
A:v1
B:v1
A:v2
C:v1
A:v3
B:v2

Latest offset per key:
A -> offset of v3
B -> offset of v2
C -> offset of v1

Output after cleaning:
C:v1
A:v3
B:v2
```

Urutan fisik hasil compaction tetap mengikuti offset record yang dipertahankan, bukan sorted by key.

---

## 4.3 Compaction menjaga latest record, bukan menghitung aggregate

Log compaction tidak melakukan merge business-level.

Jika record:

```text
A: { "count": 1 }
A: { "count": 2 }
A: { "count": 3 }
```

Compaction hanya mempertahankan record terakhir:

```text
A: { "count": 3 }
```

Ia tidak tahu bahwa `count` harus dijumlahkan, dirata-rata, atau divalidasi.

Jika kamu butuh aggregate:

- lakukan di Kafka Streams,
- lakukan di ksqlDB,
- lakukan di consumer service,
- atau materialize ke database.

Compaction hanya retention strategy.

---

## 4.4 Compaction tidak menjamin satu record per key setiap saat

Karena compaction asynchronous, consumer bisa melihat:

```text
A:v1
A:v2
A:v3
```

Meskipun topic compacted.

Consumer harus menerapkan logika upsert:

```java
state.put(key, value);
```

Bukan:

```java
if (state.containsKey(key)) {
    throw new DuplicateKeyException();
}
```

Compacted topic adalah changelog, bukan CSV unique rows.

---

## 4.5 Compaction tidak mengubah semantic ordering per key

Karena Kafka mempertahankan offset order dalam partition, consumer yang replay dari awal tetap melihat update key sesuai order log yang tersedia.

Tetapi record lama yang sudah compacted hilang. Artinya kamu tidak bisa mengandalkan compacted topic untuk audit lengkap perubahan historis.

Jika butuh audit lengkap:

```text
Gunakan event topic dengan cleanup.policy=delete dan retention sesuai kebutuhan audit/compliance,
atau gunakan archival sink ke object storage,
atau pisahkan event history topic dan latest-state compacted topic.
```

Pattern yang sering sehat:

```text
case-events           cleanup.policy=delete    # historical facts
case-current-state    cleanup.policy=compact   # latest state per case
```

---

## 5. KTable Mental Model

## 5.1 KStream vs KTable

Dalam Kafka Streams:

- **KStream** adalah record stream: setiap record adalah event independen.
- **KTable** adalah changelog stream: setiap record adalah update terhadap state by key.

Contoh input:

```text
key=case-1 value={status:OPENED}
key=case-1 value={status:ASSIGNED}
key=case-2 value={status:OPENED}
key=case-1 value={status:ESCALATED}
```

Sebagai KStream:

```text
Ada 4 event.
Semua event penting sebagai fakta historis.
```

Sebagai KTable:

```text
case-1 -> ESCALATED
case-2 -> OPENED
```

KTable tidak berarti record lama tidak pernah diproses. KTable berarti record lama digunakan untuk membangun state terbaru.

---

## 5.2 KTable adalah changelog stream

KTable dapat dipahami seperti table yang row-nya berubah saat record baru datang.

```text
Input record: key=A value=10
Table: A=10

Input record: key=B value=20
Table: A=10, B=20

Input record: key=A value=15
Table: A=15, B=20

Input record: key=B value=null
Table: A=15
```

Setiap record adalah:

- insert jika key belum ada,
- update jika key sudah ada,
- delete jika value null.

Ini sangat mirip database upsert stream.

---

## 5.3 KTable dan compacted topic

KTable sering backed by compacted topic.

Kenapa?

Karena untuk membangun current table state, aplikasi tidak perlu semua update historis selamanya. Ia cukup butuh update terakhir per key, plus tombstone untuk delete.

Contoh:

```java
KTable<String, CaseState> caseTable = builder.table("case-current-state");
```

Jika topic `case-current-state` compacted, aplikasi Kafka Streams bisa restore state dengan membaca topic tersebut dari awal.

---

## 5.4 KTable bukan query engine global

KTable di Kafka Streams adalah abstraction di dalam aplikasi stream processing.

Ia bisa materialized ke state store lokal. Tetapi jangan membayangkan semua instance aplikasi punya semua key.

Kafka Streams membagi task berdasarkan partition.

Jika topic punya 12 partition dan aplikasi punya 3 instance, kira-kira:

```text
instance-1: partition 0,1,2,3
instance-2: partition 4,5,6,7
instance-3: partition 8,9,10,11
```

Masing-masing instance punya local state untuk partition yang dimilikinya.

Jika ingin query state by key, kamu perlu tahu key tersebut dimiliki instance mana. Ini yang nanti dibahas lebih dalam di Kafka Streams state dan interactive queries.

---

## 5.5 GlobalKTable

Kafka Streams juga punya `GlobalKTable`.

Mental model:

```text
KTable       = partitioned table; tiap instance punya sebagian state
GlobalKTable = replicated table; tiap instance punya seluruh state
```

GlobalKTable cocok untuk reference data kecil-menengah:

- country code,
- product catalog kecil,
- risk parameter,
- branch mapping,
- user role mapping terbatas.

Tidak cocok untuk table besar seperti semua transaksi, semua customer besar, semua case enterprise, atau high-churn state besar.

Trade-off:

| Aspek | KTable | GlobalKTable |
|---|---|---|
| State distribution | Sharded by partition | Full copy per instance |
| Memory/disk per instance | Lebih kecil | Lebih besar |
| Join | Key alignment penting | Bisa lookup lokal semua key |
| Scale large data | Lebih baik | Terbatas |
| Bootstrap time | Per partition assignment | Semua data di semua instance |

---

## 6. Java Engineer Perspective

## 6.1 Manual latest-state consumer

Sebelum memakai Kafka Streams, penting memahami cara consumer biasa membangun state dari compacted topic.

Pseudo-code:

```java
Map<String, CaseState> state = new HashMap<>();

while (running) {
    ConsumerRecords<String, CaseState> records = consumer.poll(Duration.ofMillis(500));

    for (ConsumerRecord<String, CaseState> record : records) {
        String key = record.key();
        CaseState value = record.value();

        if (key == null) {
            // For compacted topics, null key is usually invalid.
            continue;
        }

        if (value == null) {
            state.remove(key);       // tombstone
        } else {
            state.put(key, value);   // upsert
        }
    }

    consumer.commitSync();
}
```

Ini adalah mental model KTable paling sederhana.

---

## 6.2 Bootstrap dari compacted topic

Misalnya service perlu local cache `case-current-state`.

Startup flow:

```text
1. Consumer subscribe ke compacted topic.
2. Consumer seek ke earliest.
3. Consumer membaca semua record.
4. Untuk setiap key, simpan value terakhir.
5. Tombstone menghapus key.
6. Setelah mencapai end offset, cache dianggap caught up.
7. Setelah itu consumer terus mengikuti update baru.
```

Masalah production:

- topic terlalu besar,
- tombstone retention terlalu pendek,
- consumer restore terlalu lambat,
- record value besar,
- key cardinality besar,
- state tidak muat memory,
- consumer restart menyebabkan bootstrap lama,
- deployment rolling menyebabkan banyak instance restore bersamaan.

Solusi:

- gunakan persistent local store,
- gunakan Kafka Streams state store,
- gunakan standby replica,
- batasi ukuran state,
- pisahkan state besar dan kecil,
- gunakan snapshot eksternal bila perlu,
- monitor restore time.

---

## 6.3 Kafka Streams KTable example

Contoh konsep:

```java
StreamsBuilder builder = new StreamsBuilder();

KTable<String, CaseState> cases = builder.table(
    "case-current-state",
    Consumed.with(Serdes.String(), caseStateSerde)
);

KStream<String, CaseEvent> incomingEvents = builder.stream(
    "case-events",
    Consumed.with(Serdes.String(), caseEventSerde)
);

KStream<String, EnrichedCaseEvent> enriched = incomingEvents.leftJoin(
    cases,
    (event, currentState) -> new EnrichedCaseEvent(event, currentState)
);

enriched.to(
    "case-events-enriched",
    Produced.with(Serdes.String(), enrichedSerde)
);
```

Mental model:

```text
case-events          = fact stream
case-current-state   = latest state table
join                 = enrich event with current state
```

Catatan penting:

- join correctness bergantung pada key alignment,
- KTable harus punya key yang sama dengan event stream jika ingin join langsung,
- jika key berbeda, Kafka Streams perlu repartitioning,
- repartitioning punya biaya network, disk, latency, dan internal topic.

---

## 6.4 Membuat latest-state topic dari event topic

Sering ada event topic historis:

```text
case-events
```

Kamu ingin membangun latest-state compacted topic:

```text
case-current-state
```

Dengan Kafka Streams:

```java
KStream<String, CaseEvent> events = builder.stream(
    "case-events",
    Consumed.with(Serdes.String(), caseEventSerde)
);

KTable<String, CaseState> currentState = events
    .groupByKey(Grouped.with(Serdes.String(), caseEventSerde))
    .aggregate(
        CaseState::initial,
        (caseId, event, state) -> state.apply(event),
        Materialized.<String, CaseState, KeyValueStore<Bytes, byte[]>>as("case-current-state-store")
            .withKeySerde(Serdes.String())
            .withValueSerde(caseStateSerde)
    );

currentState.toStream().to(
    "case-current-state",
    Produced.with(Serdes.String(), caseStateSerde)
);
```

`case-current-state` sebaiknya compacted.

Kenapa?

Karena consumer downstream yang butuh latest state tidak perlu replay semua event historis dari `case-events`.

---

## 7. Production Design Patterns

## 7.1 Reference data topic

Contoh:

```text
risk-parameter-current
branch-directory-current
product-catalog-current
regulatory-rule-current
```

Karakteristik:

- key stabil,
- value merepresentasikan current state,
- update relatif jarang,
- consumer butuh cache lokal,
- latest state lebih penting daripada history lengkap.

Konfigurasi:

```properties
cleanup.policy=compact
min.cleanable.dirty.ratio=0.5
segment.ms=86400000
```

Pattern consumer:

```text
bootstrap from earliest -> build cache -> consume updates
```

Risiko:

- data terlalu besar untuk semua consumer,
- update burst menyebabkan restore lama,
- schema compatibility buruk merusak banyak consumer.

---

## 7.2 Current state projection

Contoh regulatory case management:

```text
case-events           # event history
case-current-state    # latest state per case
```

`case-events`:

```properties
cleanup.policy=delete
retention.ms=31536000000 # 1 tahun, contoh saja
```

`case-current-state`:

```properties
cleanup.policy=compact
```

Manfaat:

- consumer operasional membaca latest state cepat,
- audit/replay masih bisa dilakukan dari event history,
- sistem downstream tidak perlu memahami seluruh event history,
- read model bisa di-restore dari compacted topic.

Caveat:

- current state topic bukan pengganti event history,
- bug projection bisa menghasilkan state salah,
- perlu mekanisme rebuild projection dari event history.

---

## 7.3 Changelog topic internal Kafka Streams

Kafka Streams stateful operation membutuhkan fault tolerance.

Jika aplikasi menyimpan local RocksDB state, apa yang terjadi saat instance mati?

Jawabannya: state store di-backup ke Kafka changelog topic.

Mental model:

```text
local state store update ---> changelog topic append
instance crash           ---> new instance restores from changelog
```

Changelog topic biasanya compacted karena hanya latest state per key yang dibutuhkan untuk restore state.

Konsekuensi:

- jangan sembarangan delete internal topic Kafka Streams,
- jangan ubah retention internal topic tanpa paham efeknya,
- jangan menganggap internal topic noise tidak penting,
- monitoring restore lag sangat penting.

---

## 7.4 Cache warmup topic

Beberapa service Java membutuhkan cache lokal untuk low-latency lookup.

Pattern:

```text
source DB / admin service
        -> Kafka compacted topic
        -> service local cache
```

Contoh:

```text
user-permission-current
case-routing-rule-current
sla-policy-current
```

Service startup:

```text
Read topic from beginning, build local map, mark ready only after caught up.
```

Readiness check harus memperhitungkan bootstrap.

Jangan mark service ready sebelum cache mencapai end offset jika request handling bergantung pada cache tersebut.

---

## 7.5 Materialized view topic

Kafka Streams atau ksqlDB bisa membuat derived compacted topic:

```text
case-sla-status-current
case-assignee-current
case-risk-score-current
```

Ini adalah materialized view dalam bentuk Kafka topic.

Manfaat:

- downstream service tidak perlu menghitung sendiri,
- state bisa direplay,
- consumer bisa membangun read model,
- query layer eksternal bisa sink dari topic tersebut.

Risiko:

- derived state bisa stale,
- bug logic menyebar ke banyak downstream,
- perlu lineage jelas dari source topic ke derived topic,
- perlu rebuild strategy.

---

## 8. Design Trade-Offs

## 8.1 Compacted topic vs database table

Gunakan compacted topic jika:

- banyak consumer butuh latest state stream,
- state harus bisa direplay,
- update harus didistribusikan secara event-driven,
- consumer ingin local cache,
- state merupakan kontrak antar sistem.

Gunakan database jika:

- perlu ad-hoc query,
- perlu transaction constraint kompleks,
- perlu secondary index,
- perlu relational join interaktif,
- perlu low-latency point lookup dari pusat,
- state sering dimutasi dengan consistency requirement kuat.

Sering kali jawaban terbaik adalah kombinasi:

```text
Kafka compacted topic sebagai distribution log
Database/search/cache sebagai query-serving layer
```

---

## 8.2 Compacted topic vs event history topic

| Kebutuhan | Event History Topic | Compacted State Topic |
|---|---|---|
| Audit lengkap | Sangat cocok | Tidak cocok |
| Latest state | Bisa, tapi perlu replay semua event | Sangat cocok |
| Rebuild projection | Cocok | Cocok untuk restore latest snapshot |
| Investigasi timeline | Cocok | Tidak cukup |
| Storage efisien latest state | Kurang cocok | Cocok |
| Delete semantics | Event eksplisit | Tombstone |

Pattern sehat:

```text
Jangan paksa satu topic memenuhi semua kebutuhan.
Pisahkan event history dan state projection bila semantics berbeda.
```

---

## 8.3 Compact vs compact,delete

Gunakan `compact` jika latest state harus tersedia tanpa batas waktu selama key belum dihapus.

Gunakan `compact,delete` jika state bersifat temporal.

Contoh `compact,delete`:

```text
session-current-state
otp-validation-state
temporary-lock-state
rolling-window-aggregate
```

Hati-hati memakai `compact,delete` untuk:

```text
customer-current-state
case-current-state
product-current-state
```

Karena latest value bisa hilang karena retention time.

---

## 8.4 One compacted topic per entity vs per view

Pilihan 1: entity current state.

```text
case-current-state
```

Pilihan 2: view-specific state.

```text
case-assignment-current
case-sla-current
case-risk-current
case-compliance-current
```

Trade-off:

| Model | Kelebihan | Kekurangan |
|---|---|---|
| Entity current state | Simple, satu state lengkap | Value besar, coupling tinggi, semua consumer dapat field tidak perlu |
| View-specific state | Lebih focused, ownership jelas | Lebih banyak topic, lineage/governance lebih kompleks |

Untuk sistem regulasi/case management, view-specific topics sering lebih defensible karena semantics lebih jelas.

---

## 9. Anti-Patterns

## 9.1 Null key dalam compacted topic

Buruk:

```text
key=null value={"caseId":"CASE-1","status":"OPENED"}
```

Masalah:

- compaction tidak bisa bekerja per case,
- partitioning random/sticky,
- latest state tidak bisa direkonstruksi by case,
- KTable semantics rusak.

Rule:

```text
Compacted topic harus punya non-null stable key.
```

---

## 9.2 Key berubah karena field bisnis berubah

Misalnya key memakai email:

```text
key=alice@old.com
key=alice@new.com
```

Jika email berubah, Kafka melihatnya sebagai dua entity berbeda.

Lebih baik:

```text
key=user-id-123
value.email=alice@new.com
```

Key untuk compacted topic harus stable identifier, bukan mutable business attribute.

---

## 9.3 Menganggap compaction langsung menghapus duplikat

Salah:

```text
Topic compacted berarti hanya ada satu record per key.
```

Benar:

```text
Topic compacted eventually retains latest record per key setelah log cleaner berjalan.
```

Consumer tetap harus tahan melihat banyak update untuk key yang sama.

---

## 9.4 Menggunakan compacted topic sebagai audit log

Compacted topic membuang update lama. Ini bertentangan dengan audit lengkap.

Untuk audit/regulatory defensibility, gunakan event history topic yang immutable dan retention/archival-nya sesuai kebijakan.

Pattern:

```text
case-events-audit       # immutable historical event
case-current-state      # compacted latest projection
```

---

## 9.5 Tombstone tidak diproses consumer

Buruk:

```java
if (record.value() == null) {
    return; // ignore
}
```

Untuk compacted topic, tombstone berarti delete.

Benar:

```java
if (record.value() == null) {
    state.remove(record.key());
}
```

Jika tombstone diabaikan, local cache akan menyimpan data yang seharusnya sudah dihapus.

---

## 9.6 Value terlalu besar

Karena compacted topic sering dipakai untuk latest snapshot, ada godaan membuat value berisi seluruh aggregate besar.

Masalah:

- network besar,
- disk besar,
- restore lambat,
- memory pressure,
- GC pressure,
- schema evolution berat,
- semua consumer menerima payload besar walaupun hanya butuh sebagian.

Alternatif:

- pecah view-specific topic,
- gunakan pointer ke object storage untuk payload besar,
- pisahkan metadata dan detail,
- materialize ke database/search jika query berat.

---

## 9.7 Mengubah partition count compacted topic sembarangan

Untuk topic compacted, partition count menentukan distribusi key. Mengubah partition count dapat mengubah mapping key untuk record baru.

Risiko:

- latest state key tersebar,
- ordering per key rusak,
- restore hasil salah,
- KTable semantics terganggu.

Prinsip:

```text
Rencanakan partition count compacted topic lebih serius daripada topic event biasa.
```

Jika harus migrasi, gunakan topic baru dan controlled reprocessing.

---

## 9.8 Menggunakan compacted topic tanpa ownership

Compacted topic biasanya menjadi shared state contract. Jika tidak ada owner:

- schema berubah sembarangan,
- tombstone semantics tidak jelas,
- retention berubah tanpa analisis,
- consumer rusak,
- data contract membusuk.

Setiap compacted topic harus punya:

```text
owner
schema
key semantics
delete semantics
retention policy
compatibility policy
consumer bootstrap expectation
```

---

## 10. Regulatory / Case Management Perspective

Karena konteks kamu dekat dengan enforcement lifecycle dan complex case management, log compaction punya peran sangat kuat, tetapi harus dipakai dengan hati-hati.

## 10.1 Case lifecycle: event history vs current state

Untuk case management, jangan hanya punya satu topic.

Lebih defensible:

```text
case-lifecycle-events
case-current-state
case-assignment-current
case-sla-current
case-risk-current
```

`case-lifecycle-events` menyimpan fakta historis:

```text
CaseOpened
CaseAssigned
EvidenceSubmitted
CaseEscalated
DecisionIssued
CaseClosed
```

`case-current-state` menyimpan latest snapshot:

```json
{
  "caseId": "CASE-2026-0001",
  "status": "ESCALATED",
  "assignee": "officer-17",
  "slaState": "BREACHED",
  "riskLevel": "HIGH",
  "lastTransitionAt": "2026-06-19T10:15:00Z"
}
```

Audit dan reconstruction menggunakan event history.

Operational lookup menggunakan current state.

---

## 10.2 Correction event, not mutation

Dalam sistem regulasi, menghapus/mengubah fakta lama secara diam-diam berbahaya.

Jika ada kesalahan:

```text
CaseAssigned officer-17  # salah
```

Jangan berharap compacted topic menyelesaikan audit correction.

Buat event koreksi:

```text
CaseAssignmentCorrected oldAssignee=officer-17 newAssignee=officer-21 reason=manual-review
```

Projection latest-state boleh berubah:

```text
case-current-state: assignee=officer-21
```

Tetapi event history tetap menunjukkan sebab perubahan.

---

## 10.3 Redaction dan privacy

Compacted topic sering menyimpan latest state yang mudah disebarkan ke banyak consumer. Ini sensitif.

Pertanyaan desain:

1. Apakah data PII boleh berada di compacted topic?
2. Siapa consumer yang boleh membaca latest state?
3. Apakah tombstone cukup untuk right-to-erasure requirement?
4. Apakah data lama masih ada di event history atau object storage?
5. Apakah downstream cache ikut menghapus data saat tombstone?

Tombstone di compacted topic bukan solusi lengkap untuk privacy/compliance. Ia hanya delete signal pada topic tersebut.

---

## 10.4 Explainability

Current state tanpa history tidak cukup untuk menjelaskan keputusan.

Jika `case-current-state` mengatakan:

```text
riskLevel=HIGH
```

Auditor akan bertanya:

```text
Mengapa riskLevel menjadi HIGH?
Event mana yang menyebabkan perubahan itu?
Rule version apa yang dipakai?
Data input apa yang dipakai?
Siapa/apa yang memutuskan?
```

Maka compacted state harus membawa metadata explainability:

```json
{
  "caseId": "CASE-1",
  "riskLevel": "HIGH",
  "derivedFromEventId": "evt-abc",
  "ruleVersion": "risk-rule-v7",
  "calculatedAt": "2026-06-19T10:15:00Z",
  "correlationId": "corr-123",
  "causationId": "evt-previous"
}
```

Dan event history harus tetap tersedia untuk rekonstruksi.

---

## 11. Operational Tuning Notes

## 11.1 Konfigurasi penting

Beberapa konfigurasi topic/broker yang sering relevan:

```properties
cleanup.policy=compact
min.cleanable.dirty.ratio=0.5
delete.retention.ms=86400000
segment.ms=604800000
segment.bytes=1073741824
min.compaction.lag.ms=0
max.compaction.lag.ms=9223372036854775807
```

Makna ringkas:

| Config | Makna |
|---|---|
| `cleanup.policy` | Menentukan delete/compact/compact+delete |
| `min.cleanable.dirty.ratio` | Seberapa banyak dirty data sebelum log eligible dibersihkan |
| `delete.retention.ms` | Berapa lama tombstone disimpan |
| `segment.ms` / `segment.bytes` | Kapan segment digulung |
| `min.compaction.lag.ms` | Umur minimum record sebelum eligible compaction |
| `max.compaction.lag.ms` | Batas maksimum record menunggu compaction |

Jangan copy config tanpa workload reasoning.

---

## 11.2 Disk growth pada compacted topic

Compacted topic tetap bisa tumbuh besar karena:

- compaction belum berjalan,
- key cardinality sangat tinggi,
- value besar,
- banyak update untuk key sama sebelum cleaning,
- tombstone retention panjang,
- log cleaner tertinggal,
- segment belum eligible,
- `compact,delete` tidak digunakan untuk state temporal.

Monitoring penting:

```text
log size
log cleaner throughput
uncleanable partitions
compaction lag
segment count
tombstone volume
restore time
consumer bootstrap duration
```

---

## 11.3 Restore storm

Jika banyak consumer/Kafka Streams instance restart bersamaan, semuanya bisa membaca compacted topic dari awal atau restore state dari changelog.

Efek:

- broker read load naik,
- network tinggi,
- disk read tinggi,
- application startup lambat,
- consumer lag naik,
- readiness gagal,
- deployment rollback makin kacau.

Mitigasi:

- rolling restart bertahap,
- persistent local state,
- standby replicas Kafka Streams,
- tune restore consumers,
- capacity planning read burst,
- jangan hapus local state setiap deploy,
- jangan scale out besar-besaran tanpa memperhitungkan bootstrap.

---

## 11.4 Tombstone storm

Bulk delete bisa menghasilkan tombstone storm.

Contoh:

```text
1 juta customer permission dicabut
1 juta tombstone dikirim ke permission-current
```

Risiko:

- compacted topic membesar sementara,
- consumer harus memproses banyak delete,
- downstream cache churn,
- state store write amplification,
- compaction pressure.

Mitigasi:

- rate limit delete,
- batch operational window,
- monitor compaction backlog,
- pastikan consumer tombstone handling efisien,
- pastikan `delete.retention.ms` cukup.

---

## 12. Decision Framework

Gunakan compacted topic jika jawaban mayoritas adalah “ya”:

```text
[ ] Apakah record punya stable key?
[ ] Apakah latest value per key adalah kebutuhan utama?
[ ] Apakah consumer perlu bootstrap state dari Kafka?
[ ] Apakah update lama tidak perlu disimpan di topic yang sama?
[ ] Apakah delete bisa direpresentasikan sebagai tombstone?
[ ] Apakah schema evolution dikelola?
[ ] Apakah partition count sudah direncanakan?
[ ] Apakah owner topic jelas?
[ ] Apakah consumer tahu tombstone semantics?
[ ] Apakah audit history disimpan di tempat lain jika dibutuhkan?
```

Jangan gunakan compacted topic jika:

```text
[ ] key tidak stabil,
[ ] perlu full audit timeline di topic yang sama,
[ ] consumer perlu arbitrary query,
[ ] value sangat besar dan sering berubah,
[ ] delete semantics tidak jelas,
[ ] topic hanya command/event transient biasa,
[ ] state harus punya relational constraint kuat,
[ ] partition count kemungkinan sering berubah.
```

---

## 13. Worked Example: Enforcement Case Current State

## 13.1 Requirements

Sistem enforcement lifecycle punya kebutuhan:

1. Simpan semua event historis case.
2. Downstream service perlu latest status case.
3. UI projection perlu current assignee dan SLA state.
4. Audit harus bisa menjelaskan mengapa status berubah.
5. Jika case dihapus/diarsipkan dari operational view, downstream cache harus menghapusnya.

---

## 13.2 Topic design

```text
case-lifecycle-events
case-current-state
case-assignment-current
case-sla-current
```

### `case-lifecycle-events`

```properties
cleanup.policy=delete
retention.ms=31536000000
```

Key:

```text
caseId
```

Value:

```json
{
  "eventId": "evt-001",
  "eventType": "CaseEscalated",
  "caseId": "CASE-001",
  "occurredAt": "2026-06-19T10:15:00Z",
  "actorId": "officer-17",
  "reason": "SLA_BREACH",
  "correlationId": "corr-123",
  "causationId": "evt-000"
}
```

### `case-current-state`

```properties
cleanup.policy=compact
```

Key:

```text
caseId
```

Value:

```json
{
  "caseId": "CASE-001",
  "status": "ESCALATED",
  "assigneeId": "officer-17",
  "slaState": "BREACHED",
  "lastEventId": "evt-001",
  "lastChangedAt": "2026-06-19T10:15:00Z",
  "schemaVersion": 3
}
```

Tombstone:

```text
key=CASE-001 value=null
```

Makna tombstone:

```text
Remove CASE-001 from operational current-state projection.
```

Bukan berarti audit history hilang.

---

## 13.3 Projection service

Flow:

```text
case-lifecycle-events -> case-state-projector -> case-current-state
```

Pseudo-code:

```java
CaseState apply(CaseState state, CaseEvent event) {
    return switch (event.type()) {
        case "CaseOpened" -> CaseState.opened(event);
        case "CaseAssigned" -> state.assign(event.assigneeId(), event.eventId(), event.occurredAt());
        case "CaseEscalated" -> state.escalate(event.reason(), event.eventId(), event.occurredAt());
        case "DecisionIssued" -> state.decision(event.decision(), event.eventId(), event.occurredAt());
        case "CaseClosed" -> state.close(event.eventId(), event.occurredAt());
        case "CaseArchived" -> null; // publish tombstone to current-state topic
        default -> throw new UnknownEventTypeException(event.type());
    };
}
```

Important invariant:

```text
The projection is rebuildable from case-lifecycle-events.
```

Jika bug ditemukan, kamu bisa:

```text
1. deploy fixed projector,
2. reset/reprocess from event history,
3. regenerate case-current-state,
4. downstream consumers rebuild cache.
```

---

## 14. Failure Modes

## 14.1 Key mismatch between event topic and state topic

Problem:

```text
case-lifecycle-events key = tenantId
case-current-state key = caseId
```

Projection atau repartitioning menjadi perlu.

Jika tidak hati-hati, ordering per case bisa rusak.

Mitigation:

```text
Pilih key berdasarkan aggregate/order domain utama sejak awal.
```

---

## 14.2 Tombstone lost before restore complete

Problem:

```text
delete.retention.ms terlalu pendek
consumer bootstrap sangat lama
```

Mitigation:

```text
Ukur worst-case restore time.
Set delete.retention.ms > worst-case restore time + safety margin.
```

---

## 14.3 Compaction lag causes disk pressure

Problem:

```text
Update rate tinggi, log cleaner tertinggal, disk penuh.
```

Mitigation:

```text
Monitor dirty ratio, cleaner throughput, disk usage.
Tune cleaner resources.
Kurangi value size.
Review update frequency.
```

---

## 14.4 Consumer treats tombstone as deserialization error

Problem:

Beberapa deserializer atau framework layer salah dikonfigurasi sehingga value null dianggap error.

Mitigation:

```text
Test tombstone explicitly.
Pastikan consumer path value=null valid.
Buat contract test untuk delete semantics.
```

---

## 14.5 Latest state topic becomes source of truth accidentally

Problem:

Tim mulai menganggap compacted projection sebagai source of truth utama, lalu event history diabaikan.

Risiko:

- audit lemah,
- correction sulit,
- derived state bug menjadi fakta palsu,
- tidak bisa menjelaskan causality.

Mitigation:

```text
Dokumentasikan source-of-truth boundary.
Event history adalah facts.
Compacted state adalah projection.
```

---

## 15. Checklist

## 15.1 Compacted Topic Readiness Checklist

```text
[ ] Topic punya stable non-null key.
[ ] Key merepresentasikan identity state.
[ ] Partition count direncanakan untuk jangka panjang.
[ ] Value size masuk akal.
[ ] Tombstone semantics terdokumentasi.
[ ] Consumer wajib handle value=null.
[ ] Schema compatibility policy aktif.
[ ] Owner topic jelas.
[ ] Retention/compaction config terdokumentasi.
[ ] delete.retention.ms sesuai worst-case bootstrap.
[ ] Audit history tersedia jika dibutuhkan.
[ ] Monitoring compaction/disk/restore tersedia.
[ ] Rebuild strategy tersedia.
```

---

## 15.2 KTable Design Checklist

```text
[ ] Input topic keyed by table primary key.
[ ] Update semantics adalah upsert, bukan independent event.
[ ] Tombstone berarti delete row.
[ ] Join key alignment dipahami.
[ ] Repartitioning cost dipahami.
[ ] State store size dihitung.
[ ] Restore time dihitung.
[ ] Changelog topic tidak dianggap disposable.
[ ] Late/out-of-order update behavior dipahami.
[ ] Testing mencakup insert, update, delete, duplicate, replay.
```

---

## 16. Latihan / Thought Exercises

### Exercise 1 — Classify Topics

Klasifikasikan topic berikut sebagai `delete`, `compact`, atau `compact,delete`:

```text
payment-events
customer-current-profile
active-session-state
product-catalog-current
case-audit-events
case-current-state
sla-window-aggregate
```

Jelaskan alasan dan risiko tiap pilihan.

---

### Exercise 2 — Key Design

Topic:

```text
case-assignment-current
```

Candidate key:

```text
1. caseId
2. assigneeId
3. tenantId
4. tenantId + caseId
5. caseNumber visible di UI
```

Pilih key terbaik untuk compacted topic dan jelaskan trade-off.

---

### Exercise 3 — Tombstone Handling

Consumer local cache mengabaikan record value null.

Apa akibatnya untuk:

1. UI current case list?
2. permission cache?
3. regulatory redaction?
4. Kafka Streams KTable join?

---

### Exercise 4 — Event History vs Current State

Sistem hanya punya compacted topic:

```text
case-current-state
```

Lalu auditor meminta timeline perubahan status case.

Apa yang hilang? Bagaimana desain yang lebih benar?

---

### Exercise 5 — Partition Count Migration

Compacted topic `customer-current-profile` punya 6 partition. Load meningkat dan tim ingin menaikkan ke 24 partition.

Pertanyaan:

1. Apa risiko terhadap key mapping?
2. Apakah ini aman untuk compacted topic?
3. Bagaimana strategi migrasi yang lebih aman?

---

## 17. Ringkasan

Log compaction adalah mekanisme Kafka untuk mempertahankan **latest value per key** dalam topic. Ini membuat Kafka bukan hanya event transport, tetapi juga bisa menjadi distribution layer untuk latest state, reference data, materialized view, dan state store changelog.

Namun compacted topic tetap bukan database table biasa. Ia tetap append-only log dengan background cleaning. Compaction bersifat eventual, bekerja per partition, bergantung pada stable key, dan delete direpresentasikan lewat tombstone.

KTable adalah abstraksi stream processing yang membaca changelog stream sebagai table: setiap record adalah insert/update/delete terhadap key. KTable dan compacted topic saling cocok karena keduanya berbicara dalam model latest state per key.

Prinsip terpenting:

```text
Use event topics for history.
Use compacted topics for current state.
Use tombstones for delete.
Use stable keys for identity.
Use schema governance for contracts.
Never confuse projection with source-of-truth facts.
```

Dalam sistem regulasi dan case management, compacted topic sangat berguna untuk current operational view, tetapi auditability tetap membutuhkan immutable historical event stream.

---

## 18. Referensi

Referensi berikut menjadi dasar konseptual bagian ini:

1. Apache Kafka Documentation — Topic configuration, retention, cleanup policy, and Kafka Streams concepts.
2. Confluent Documentation — Kafka log compaction, topic configuration, KTable/changelog stream concepts.
3. Kafka Streams documentation — KStream, KTable, GlobalKTable, state store, and changelog topics.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Topic Design and Governance: Naming, Retention, Compaction, ACL, Ownership</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-013.md">Part 013 — Kafka Security: TLS, SASL, ACL, Principal, Multi-Tenant Boundaries ➡️</a>
</div>

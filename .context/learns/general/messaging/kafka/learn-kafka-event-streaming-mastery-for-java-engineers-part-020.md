# learn-kafka-event-streaming-mastery-for-java-engineers-part-020.md

# Part 020 — Kafka Streams State: RocksDB, Changelog, Standby Replica, Restore, Interactive Queries

> Seri: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Kafka Streams sampai level desain, operasional, failure modelling, dan production readiness.  
> Posisi dalam seri: setelah Part 019 yang membahas fundamental Kafka Streams: topology, task, thread, KStream, KTable, GlobalKTable, SerDes, dan application id.

---

## 0. Mengapa Part Ini Penting

Kafka Streams terlihat sederhana saat hanya melakukan operasi stateless:

```java
builder.stream("orders")
       .filter((key, order) -> order.total() > 1_000_000)
       .to("large-orders");
```

Tetapi begitu aplikasi membutuhkan `groupBy`, `aggregate`, `count`, `join`, `window`, deduplication, enrichment, materialized view, SLA tracker, atau lifecycle projection, aplikasi tersebut menjadi **stateful stream processor**.

Stateful stream processing adalah titik ketika Kafka Streams berubah dari:

```text
read event -> transform -> write event
```

menjadi:

```text
read event -> consult/update local state -> emit derived event/view -> recover state after failure
```

Perubahan kecil ini membawa konsekuensi besar:

1. Aplikasi membutuhkan local storage.
2. Local storage harus fault-tolerant.
3. State harus bisa direstore jika instance mati.
4. State harus dipartisi sesuai partition Kafka.
5. State bisa menjadi sangat besar.
6. Rebalance bisa memindahkan state ownership.
7. Startup bisa menjadi lambat karena restore.
8. Disk lokal aplikasi menjadi bagian dari production architecture.
9. Query terhadap state memerlukan routing ke instance yang benar.
10. Kesalahan konfigurasi bisa menyebabkan restore storm, latency spike, disk pressure, atau hasil stream processing salah.

Part ini membahas Kafka Streams state dari mental model sampai operational design.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Menjelaskan mengapa Kafka Streams membutuhkan state store.
2. Membedakan stateless processing dan stateful processing.
3. Menjelaskan local state store, RocksDB, in-memory store, dan persistent store.
4. Menjelaskan hubungan antara state store dan changelog topic.
5. Memahami bagaimana state direstore saat aplikasi start, restart, crash, atau rebalance.
6. Menjelaskan standby replica dan trade-off-nya.
7. Memahami `state.dir`, local disk, dan risiko operational-nya.
8. Mendesain stateful Kafka Streams app yang bisa survive failure.
9. Menjelaskan interactive queries dan routing query ke instance yang benar.
10. Mendeteksi failure mode: restore storm, corrupt local state, disk full, hot state, high cardinality, large window store, dan bad repartitioning.
11. Membuat checklist production readiness untuk stateful Kafka Streams.

---

## 2. Mental Model Utama

### 2.1 Kafka Streams adalah gabungan antara stream processor dan embedded database

Untuk workload stateful, Kafka Streams bukan hanya consumer-producer library. Ia adalah:

```text
Kafka consumer group
+ stream processing topology
+ local embedded state store
+ changelog-backed fault tolerance
+ task assignment protocol
+ optional query layer over local state
```

Dalam stateful Kafka Streams, setiap instance aplikasi menyimpan sebagian state secara lokal. State itu biasanya sesuai dengan partition yang sedang dimiliki task pada instance tersebut.

Contoh:

```text
Topic: case-events
Partitions: 0, 1, 2, 3

Kafka Streams application.id: case-lifecycle-projector
Instances: A, B

Assignment:
  Instance A:
    Task for partition 0
    Task for partition 1
    Local state for partition 0 and 1

  Instance B:
    Task for partition 2
    Task for partition 3
    Local state for partition 2 and 3
```

Jika instance A mati, task untuk partition 0 dan 1 pindah ke instance lain. Instance baru perlu state untuk partition tersebut. State bisa diperoleh dari:

1. Local disk yang masih ada jika task kembali ke instance yang sama.
2. Changelog topic jika local disk kosong/hilang/tidak lengkap.
3. Standby replica jika sebelumnya ada instance lain yang menjaga salinan state.

### 2.2 State lokal bukan sumber kebenaran final

Ini salah satu invariant paling penting:

```text
Kafka Streams local state is derived state.
The durable source of recovery is Kafka input/changelog data.
```

State store lokal adalah materialisasi dari event stream. Ia bisa dianggap seperti cache/materialized view yang dikelola Kafka Streams. Namun local state bisa hilang karena:

1. container restart dengan ephemeral disk,
2. node Kubernetes pindah,
3. deployment baru tanpa persistent volume,
4. disk corruption,
5. operator menghapus `state.dir`,
6. application reset,
7. task dipindahkan ke host lain.

Karena itu Kafka Streams menyimpan perubahan state ke Kafka changelog topic agar state bisa direkonstruksi.

### 2.3 Stateful processing adalah storage problem

Banyak engineer melihat Kafka Streams sebagai coding problem. Di production, stateful Kafka Streams adalah **storage + recovery + routing + capacity problem**.

Pertanyaan yang harus dijawab sejak desain:

1. Berapa banyak key unik?
2. Berapa besar value per key?
3. Berapa lama state harus disimpan?
4. Apakah state windowed atau non-windowed?
5. Berapa total ukuran local state per task?
6. Berapa lama restore yang bisa diterima?
7. Apakah local disk persistent atau ephemeral?
8. Apakah standby replica diperlukan?
9. Apa yang terjadi saat rolling deployment?
10. Bagaimana query diarahkan ke instance yang memegang key tertentu?

Jika pertanyaan-pertanyaan ini tidak dijawab, aplikasi mungkin berjalan di dev tetapi gagal di production.

---

## 3. Dari Stateless ke Stateful

### 3.1 Stateless processing

Stateless processing tidak perlu mengingat record sebelumnya.

Contoh:

```java
KStream<String, CaseEvent> events = builder.stream("case-events");

KStream<String, CaseEvent> highPriority = events
    .filter((caseId, event) -> event.priority() == Priority.HIGH);

highPriority.to("high-priority-case-events");
```

Setiap record bisa diproses sendiri.

Jika instance mati, record yang belum diproses akan dibaca ulang dari Kafka berdasarkan offset commit. Tidak ada state lokal besar yang harus direstore.

### 3.2 Stateful processing

Stateful processing membutuhkan memori tentang record sebelumnya.

Contoh count per case type:

```java
KTable<String, Long> counts = builder.stream("case-events")
    .groupBy((caseId, event) -> event.caseType())
    .count(Materialized.as("case-type-count-store"));
```

Untuk menghitung jumlah event per `caseType`, aplikasi harus menyimpan counter saat ini:

```text
caseType=FRAUD        -> 381928
caseType=LICENSING    -> 29381
caseType=SANCTION     -> 8721
```

Contoh lifecycle projection:

```java
KTable<String, CaseState> caseState = builder.stream("case-events")
    .groupByKey()
    .aggregate(
        CaseState::initial,
        (caseId, event, currentState) -> currentState.apply(event),
        Materialized.as("case-lifecycle-store")
    );
```

Untuk setiap `caseId`, aplikasi menyimpan state terbaru:

```text
CASE-001 -> UNDER_REVIEW, assignedTo=alice, slaDueAt=2026-06-21T10:00Z
CASE-002 -> ESCALATED, assignedTo=bob, escalationLevel=2
CASE-003 -> CLOSED, outcome=NO_BREACH
```

Ini bukan lagi hanya event transformation. Ini adalah materialized state.

---

## 4. State Store: Apa yang Disimpan Kafka Streams?

State store adalah storage lokal yang digunakan Kafka Streams untuk operasi stateful.

State store dapat menyimpan:

1. Aggregation result.
2. Join state.
3. Windowed aggregation.
4. Deduplication marker.
5. Latest value table.
6. Enrichment reference data.
7. Projection state.
8. Suppression buffer.
9. Custom processor state.

### 4.1 Contoh state untuk aggregate

Input:

```text
case-events:
  key=CASE-1, event=CaseOpened
  key=CASE-1, event=CaseAssigned
  key=CASE-1, event=EvidenceAdded
  key=CASE-1, event=CaseEscalated
```

Aggregate state:

```text
case-lifecycle-store:
  CASE-1 -> {
    status: ESCALATED,
    assignedTo: "investigator-7",
    evidenceCount: 1,
    escalationLevel: 1
  }
```

### 4.2 Contoh state untuk window

Jika menghitung jumlah alert per regulator region per 5 menit:

```text
key=(region=JKT, window=10:00-10:05) -> 92
key=(region=JKT, window=10:05-10:10) -> 130
key=(region=SBY, window=10:00-10:05) -> 41
```

Windowed state tidak hanya key biasa, tapi key + window boundary.

### 4.3 Contoh state untuk join

Stream-stream join perlu menyimpan record dari dua sisi selama join window.

```text
left store:
  payment-request events within last 10 minutes

right store:
  payment-confirmation events within last 10 minutes
```

Saat record dari sisi kanan datang, Kafka Streams mencari pasangan di sisi kiri yang timestamp-nya masuk window join.

---

## 5. Jenis State Store

Kafka Streams mendukung beberapa jenis store. Yang paling penting untuk dipahami:

1. Persistent key-value store.
2. In-memory key-value store.
3. Window store.
4. Session store.
5. Timestamped store.
6. Versioned key-value store.
7. Custom store.

### 5.1 Persistent key-value store

Persistent store biasanya menggunakan RocksDB sebagai backend lokal.

Karakteristik:

1. Disimpan di disk lokal.
2. Bisa bertahan antar restart jika `state.dir` tetap ada.
3. Cocok untuk state besar.
4. Restore bisa lebih cepat jika local state masih valid.
5. Perlu disk capacity planning.
6. Memiliki kompleksitas tuning RocksDB.

Contoh:

```java
Materialized.<String, CaseState, KeyValueStore<Bytes, byte[]>>as("case-state-store")
    .withKeySerde(Serdes.String())
    .withValueSerde(caseStateSerde);
```

Secara default, materialized state store untuk DSL biasanya persistent kecuali kamu eksplisit memilih in-memory store.

### 5.2 In-memory store

In-memory store menyimpan state di memory process.

Karakteristik:

1. Cepat untuk akses lokal.
2. Hilang saat restart.
3. Harus restore penuh dari changelog setelah restart.
4. Cocok untuk state kecil.
5. Berisiko OOM jika cardinality tidak dikontrol.
6. Tidak cocok untuk state besar atau critical recovery path.

Contoh:

```java
Materialized.<String, Long>as(Stores.inMemoryKeyValueStore("small-counter-store"));
```

In-memory store bukan berarti tidak fault-tolerant jika changelog aktif. Tetapi restart cost bisa mahal karena state harus dibangun ulang dari changelog.

### 5.3 Window store

Window store menyimpan state berdasarkan key dan window interval.

Contoh:

```java
KTable<Windowed<String>, Long> counts = builder.stream("case-events")
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(5)))
    .count(Materialized.as("case-events-5m-count-store"));
```

State internal:

```text
(key=CASE-1, windowStart=10:00, windowEnd=10:05) -> 3
(key=CASE-1, windowStart=10:05, windowEnd=10:10) -> 2
```

Window store membutuhkan retention. Retention harus cukup untuk window size + grace period + operational margin.

### 5.4 Session store

Session store menyimpan state berdasarkan session window. Session window terbentuk dari aktivitas yang berdekatan dalam gap tertentu.

Cocok untuk:

1. user activity session,
2. investigation burst,
3. device telemetry session,
4. fraud activity cluster.

Session store lebih kompleks karena window boundary bisa berubah/merge ketika event baru datang.

### 5.5 Timestamped store

Timestamped store menyimpan value beserta timestamp update terakhir. Ini berguna untuk operasi yang perlu mengetahui freshness state.

Contoh use case:

1. cache reference data dengan staleness check,
2. latest case assignment beserta update time,
3. SLA clock update.

### 5.6 Versioned store

Versioned store memungkinkan lookup berdasarkan timestamp historis dalam batas retention tertentu. Ini berguna saat join/processing membutuhkan value yang benar pada waktu event, bukan value terbaru saat processing.

Contoh:

```text
At event_time=10:05, rule config version should be v3,
even if current config at processing_time=10:20 is v5.
```

Ini penting untuk regulatory/audit system karena keputusan sering harus direkonstruksi berdasarkan aturan yang berlaku saat event terjadi.

---

## 6. RocksDB Mental Model

### 6.1 Apa itu RocksDB dalam Kafka Streams?

RocksDB adalah embedded key-value store berbasis LSM-tree yang sering digunakan Kafka Streams sebagai persistent local state backend.

Kafka Streams menggunakan RocksDB untuk menyimpan state lokal di disk process aplikasi.

Mental model:

```text
Kafka Streams task
  -> local state store API
    -> RocksDB instance/files under state.dir
      -> local disk
```

RocksDB bukan cluster database. Setiap instance aplikasi memiliki RocksDB lokal sendiri untuk task yang sedang dimiliki.

### 6.2 Kenapa Kafka Streams tidak menyimpan semua state di Kafka langsung?

Kafka adalah log, bukan low-latency random lookup engine.

Untuk operasi seperti aggregate/join, aplikasi perlu sering melakukan:

```text
get current value by key
update current value by key
write new value
```

Jika setiap lookup harus scan Kafka log, latency tidak masuk akal.

RocksDB memberi local random access:

```text
caseId -> current CaseState
```

Kafka tetap dipakai untuk durability melalui changelog topic.

### 6.3 LSM-tree secara singkat

RocksDB menggunakan pendekatan Log-Structured Merge Tree.

Secara konseptual:

1. Write masuk ke memory structure.
2. Data kemudian diflush ke immutable file di disk.
3. File-file kecil dikompaksi menjadi file lebih besar.
4. Read bisa perlu mencari di beberapa level/file.
5. Bloom filter/cache membantu read performance.

Konsekuensi:

1. Write throughput bagus.
2. Compaction bisa menggunakan CPU dan disk I/O signifikan.
3. Disk usage bisa sementara membengkak saat compaction.
4. Read latency bisa naik jika cache/tuning buruk.
5. State store performance bukan hanya Kafka problem, tapi juga RocksDB/disk problem.

### 6.4 RocksDB bukan magic

Kesalahan umum:

```text
"Kafka Streams pakai RocksDB, berarti state sebesar apa pun aman."
```

Tidak benar.

RocksDB membantu menyimpan state besar di disk, tetapi kamu tetap harus mengelola:

1. disk size,
2. IOPS,
3. write amplification,
4. compaction pressure,
5. state restore time,
6. memory cache,
7. filesystem behavior,
8. container disk lifecycle,
9. backup/DR expectation,
10. changelog retention.

---

## 7. `state.dir`: Direktori State Lokal

Kafka Streams menyimpan state lokal di `state.dir`.

Contoh config:

```properties
application.id=case-lifecycle-projector
bootstrap.servers=kafka-1:9092,kafka-2:9092,kafka-3:9092
state.dir=/var/lib/case-lifecycle-projector/kafka-streams-state
```

### 7.1 Jangan gunakan ephemeral directory sembarangan

Default atau konfigurasi yang mengarah ke `/tmp` sering menjadi masalah di production.

Jika state disimpan di ephemeral directory:

1. restart container bisa menghapus state,
2. task harus restore penuh,
3. rolling deployment bisa menyebabkan semua instance restore bersamaan,
4. broker dan changelog topic mendapat beban besar,
5. consumer lag naik,
6. aplikasi lambat kembali sehat.

### 7.2 Persistent volume di Kubernetes

Jika deploy di Kubernetes, stateful Kafka Streams app perlu keputusan eksplisit:

```text
Option A: ephemeral disk
  + sederhana
  + cocok untuk state kecil
  - restore penuh setiap reschedule
  - risiko restore storm

Option B: persistent volume
  + restore lebih cepat jika pod kembali memakai volume yang sama
  + cocok untuk state besar
  - operasional lebih kompleks
  - binding pod-volume-zone perlu dipikirkan
  - failover lintas node/zone bisa lebih lambat

Option C: standby replicas + ephemeral disk
  + failover lebih cepat dibanding restore penuh
  + tetap butuh kapasitas tambahan
  - tidak menghilangkan semua restore
  - butuh instance cukup
```

Tidak ada jawaban universal. Pilihan bergantung pada state size, RTO, deployment platform, dan cost.

### 7.3 State directory isolation

Jangan share `state.dir` antar aplikasi berbeda.

Gunakan path spesifik per aplikasi:

```text
/var/lib/kafka-streams/case-lifecycle-projector
/var/lib/kafka-streams/sla-monitor
/var/lib/kafka-streams/risk-score-enricher
```

`application.id` juga harus unik per logical application karena digunakan untuk internal topics dan consumer group.

---

## 8. Changelog Topic

### 8.1 Apa itu changelog topic?

Changelog topic adalah topic Kafka internal yang menyimpan perubahan state store.

Jika state store berisi:

```text
CASE-1 -> UNDER_REVIEW
CASE-2 -> ESCALATED
```

Maka setiap update ke state store juga direkam ke changelog:

```text
key=CASE-1, value=OPENED
key=CASE-1, value=UNDER_REVIEW
key=CASE-2, value=OPENED
key=CASE-2, value=ESCALATED
```

Saat instance kehilangan local state, Kafka Streams dapat membaca changelog topic untuk membangun ulang state store.

### 8.2 Naming changelog topic

Biasanya internal topic Kafka Streams mengikuti pola:

```text
<application.id>-<store-name>-changelog
```

Contoh:

```text
case-lifecycle-projector-case-state-store-changelog
```

Karena itu nama `application.id` dan `store-name` harus dipilih dengan hati-hati.

### 8.3 Changelog topic sering compacted

Untuk key-value state store, changelog topic biasanya compacted karena hanya latest state per key yang dibutuhkan untuk restore current state.

Contoh:

```text
CASE-1 -> OPENED
CASE-1 -> ASSIGNED
CASE-1 -> UNDER_REVIEW
CASE-1 -> ESCALATED
```

Setelah compaction:

```text
CASE-1 -> ESCALATED
```

Restore current state tidak perlu semua intermediate value jika store hanya latest state.

Namun untuk beberapa state/window use case, retention dan compaction behavior harus dipahami lebih detail.

### 8.4 Changelog topic adalah production-critical

Jangan treat internal topic sebagai sampah.

Changelog topic adalah durability layer untuk local state. Jika changelog topic hilang atau salah retention, state tidak bisa direstore dengan benar.

Checklist:

1. Replication factor cukup.
2. `min.insync.replicas` sesuai durability target.
3. Retention/compaction tidak menghancurkan data yang masih dibutuhkan.
4. Internal topic tidak dihapus manual tanpa memahami reset strategy.
5. ACL mengizinkan aplikasi membaca/menulis internal topic.
6. Monitoring mencakup internal topic size dan broker pressure.

### 8.5 Changelog vs input topic

Kafka Streams bisa restore state dari changelog, bukan selalu dari input topic.

Input topic:

```text
Source event stream
```

Changelog topic:

```text
State mutation stream generated by Kafka Streams
```

Untuk aggregate kompleks, changelog bisa lebih efisien daripada replay semua input dari awal.

Contoh:

Input events 2 tahun:

```text
10 billion records
```

Current state:

```text
50 million active case IDs
```

Changelog compacted dapat menyimpan latest aggregate per key. Restore dari changelog jauh lebih murah daripada replay seluruh event 2 tahun, walaupun tetap bisa sangat besar.

---

## 9. Restore: Bagaimana State Dibangun Ulang

### 9.1 Kapan restore terjadi?

Restore dapat terjadi ketika:

1. Aplikasi pertama kali start.
2. Instance restart dan local state kosong.
3. Task pindah ke instance lain karena rebalance.
4. Local state corrupt.
5. `state.dir` dihapus.
6. Application reset dilakukan.
7. Deployment memindahkan pod ke node baru.
8. Scaling out/in mengubah assignment.

### 9.2 Restore process secara konseptual

```text
1. Kafka Streams menentukan task assignment.
2. Untuk setiap task, Kafka Streams melihat state store yang diperlukan.
3. Jika local state lengkap dan valid, task dapat lanjut cepat.
4. Jika state hilang/tidak lengkap, Kafka Streams membaca changelog topic.
5. Record changelog diterapkan ke local state store.
6. Setelah restore mencapai offset yang diperlukan, task mulai processing input baru.
```

### 9.3 Restore time matters

Restore time adalah bagian dari availability.

Jika aplikasi crash dan butuh 45 menit untuk restore, maka secara praktis aplikasi tidak highly available meskipun Kafka cluster sehat.

Pertanyaan production:

```text
How long does it take to restore one task?
How long does it take to restore all tasks after node loss?
How long does it take after full rolling deployment?
Can the business tolerate that RTO?
```

### 9.4 Restore dari persistent state

Jika local RocksDB masih ada dan checkpoint valid, Kafka Streams tidak perlu restore dari awal. Ia hanya perlu mengejar delta dari changelog.

Ini membuat persistent state sangat berguna untuk state besar.

Tetapi ini bergantung pada:

1. state directory tidak hilang,
2. task kembali ke host/volume yang sama,
3. checkpoint valid,
4. changelog masih memiliki data sejak checkpoint,
5. tidak ada corruption.

### 9.5 Restore dari changelog penuh

Jika local state hilang total:

```text
restore time ≈ changelog data to read / effective restore throughput
```

Faktor yang mempengaruhi:

1. changelog size,
2. broker throughput,
3. network throughput,
4. RocksDB write throughput,
5. disk I/O,
6. number of tasks restoring concurrently,
7. compression,
8. record size,
9. compaction efficiency,
10. throttling/quota.

### 9.6 Restore storm

Restore storm terjadi saat banyak instance/task restore secara bersamaan.

Contoh penyebab:

1. semua pod restart karena deployment,
2. node pool rolling upgrade,
3. `state.dir` ephemeral sehingga semua state hilang,
4. Kubernetes reschedule ke node baru,
5. application id berubah tidak sengaja,
6. internal changelog topic dihapus,
7. scaling event besar.

Dampak:

1. broker load naik,
2. network penuh,
3. disk broker dan app sibuk,
4. consumer lag naik,
5. aplikasi lama sehat,
6. timeout dan rebalance tambahan,
7. cascade failure.

Mitigasi:

1. gunakan persistent local state untuk state besar,
2. rolling deployment bertahap,
3. gunakan standby replica untuk state kritikal,
4. batasi concurrency restore jika perlu,
5. capacity planning untuk worst-case restore,
6. monitor restore metrics,
7. jangan ubah `application.id` sembarangan,
8. jangan hapus internal topic tanpa reset plan.

---

## 10. Standby Replica

### 10.1 Apa itu standby replica?

Standby replica adalah salinan pasif dari local state store yang dijaga di instance lain.

Jika task aktif pindah karena failure, instance yang sudah punya standby state dapat mengambil alih lebih cepat karena tidak perlu restore penuh dari changelog.

Mental model:

```text
Active task:
  consumes input topic
  updates local state
  writes output
  writes changelog

Standby task:
  consumes changelog topic
  keeps local copy of state warm
  does not process input as active task
  ready to be promoted on failure
```

### 10.2 Config

Konfigurasi utama:

```properties
num.standby.replicas=1
```

Artinya Kafka Streams mencoba membuat satu standby replica untuk setiap state store task, jika ada instance cukup.

### 10.3 Trade-off standby replica

Keuntungan:

1. Failover lebih cepat.
2. Restore dari changelog penuh berkurang.
3. RTO lebih baik untuk state besar.
4. Rolling restart lebih aman.
5. Bisa mengurangi impact node loss.

Biaya:

1. Disk usage bertambah.
2. Network usage bertambah karena standby membaca changelog.
3. CPU/disk write di instance standby bertambah.
4. Perlu instance cukup untuk placement.
5. Tidak menghilangkan semua restore scenario.
6. Complexity observability meningkat.

### 10.4 Standby replica bukan backup universal

Standby replica bukan pengganti changelog topic.

Jika changelog rusak/hilang, standby mungkin punya state sementara, tetapi lifecycle state tetap tidak aman secara platform. Changelog adalah recovery source yang durable.

Standby juga tidak membantu jika:

1. semua instance restart dan local disks hilang,
2. deployment mengganti semua pods dengan ephemeral storage,
3. state corruption menyebar karena bug logika,
4. application id berubah,
5. topic/schema salah menghasilkan state salah.

### 10.5 Kapan memakai standby replica?

Gunakan standby replica jika:

1. state besar,
2. restore time tidak bisa ditoleransi,
3. aplikasi melayani query interactive,
4. SLA recovery ketat,
5. rolling deployment sering,
6. failure node harus cepat pulih,
7. business impact tinggi saat stream processor unavailable.

Tidak selalu perlu jika:

1. state kecil,
2. restore hanya beberapa detik,
3. workload batch-ish dan downtime tolerable,
4. cost disk/network sangat sensitif.

---

## 11. Task, Partition, dan State Ownership

State di Kafka Streams mengikuti task. Task biasanya terkait dengan input topic partition.

### 11.1 Partition menentukan state sharding

Jika input topic memiliki 12 partition, maka state store biasanya terbagi menjadi 12 shard/task.

```text
Input topic partitions: 12
Kafka Streams tasks: 12
State store shards: 12
```

Jika kamu punya 3 instances:

```text
Instance A: tasks 0,1,2,3
Instance B: tasks 4,5,6,7
Instance C: tasks 8,9,10,11
```

Setiap instance hanya menyimpan state untuk task yang dimiliki.

### 11.2 Scaling out

Jika scale dari 3 ke 4 instances:

```text
Some tasks move.
Moved tasks may need state on new host.
If standby exists, failover faster.
If not, restore from changelog.
```

Scaling out bukan gratis untuk stateful apps.

### 11.3 Partition count terlalu rendah

Jika topic hanya punya 2 partition, maksimum active parallelism hanya 2 task untuk topology yang bergantung pada topic tersebut.

```text
2 partitions -> max 2 active tasks
10 app instances -> 8 mostly idle for that workload
```

### 11.4 Partition count terlalu tinggi

Partition terlalu tinggi juga punya biaya:

1. task lebih banyak,
2. state store instances lebih banyak,
3. RocksDB files lebih banyak,
4. internal topic partitions lebih banyak,
5. rebalance lebih kompleks,
6. restore overhead lebih fragmentary,
7. metadata overhead lebih besar.

Partisi adalah unit parallelism dan state sharding, bukan angka yang bisa dinaikkan tanpa biaya.

---

## 12. Stateful Operation Patterns

### 12.1 Aggregation

Contoh: menghitung jumlah case per status.

```java
KTable<String, Long> countByStatus = builder.stream("case-events")
    .selectKey((caseId, event) -> event.status().name())
    .groupByKey()
    .count(Materialized.as("case-count-by-status-store"));
```

State:

```text
OPEN -> 100
UNDER_REVIEW -> 73
ESCALATED -> 14
CLOSED -> 893
```

Risiko:

1. key skew jika satu status sangat dominan,
2. repartition karena `selectKey`,
3. aggregate semantics salah jika event bukan transition delta,
4. duplicate event bisa menaikkan count dua kali.

### 12.2 Projection

Contoh: membangun latest case state dari event lifecycle.

```java
KTable<String, CaseState> caseState = builder.stream("case-events")
    .groupByKey()
    .aggregate(
        CaseState::initial,
        (caseId, event, current) -> current.apply(event),
        Materialized.as("case-state-store")
    );
```

Risiko:

1. event out of order,
2. duplicate event,
3. invalid transition,
4. missing event,
5. schema evolution,
6. state object membesar tanpa batas.

### 12.3 Deduplication

State store dapat menyimpan event id yang sudah diproses.

```text
processed-event-id-store:
  EVT-001 -> seenAt=10:01
  EVT-002 -> seenAt=10:02
```

Risiko:

1. store tumbuh tanpa retention,
2. dedupe window terlalu pendek,
3. event id tidak stabil,
4. memory/disk besar.

### 12.4 Join state

Join memerlukan state untuk menyimpan sisi yang menunggu pasangan.

Contoh enforcement:

```text
CaseEscalated event joins with OfficerAvailability table
```

atau

```text
EvidenceSubmitted joins with CaseOpened within 7 days
```

Risiko:

1. join key salah,
2. input tidak co-partitioned,
3. window terlalu besar,
4. late event,
5. state retention meledak.

### 12.5 Suppression buffer

Suppression digunakan untuk menahan hasil intermediate sampai window final.

Risiko:

1. buffer tumbuh besar,
2. memory pressure,
3. final result terlambat,
4. grace period salah.

---

## 13. Interactive Queries

### 13.1 Apa itu interactive queries?

Interactive queries memungkinkan aplikasi luar atau endpoint dalam aplikasi membaca state store Kafka Streams.

Misalnya Kafka Streams app membangun materialized view:

```text
case-state-store:
  CASE-1 -> UNDER_REVIEW
  CASE-2 -> ESCALATED
```

Daripada menulis hasil ke database eksternal, kamu bisa mengekspos endpoint:

```http
GET /cases/CASE-1/state
```

Endpoint membaca local state store.

### 13.2 Local state query

Jika key berada di task lokal instance tersebut, query bisa langsung membaca local store.

Pseudo-code:

```java
ReadOnlyKeyValueStore<String, CaseState> store = streams.store(
    StoreQueryParameters.fromNameAndType(
        "case-state-store",
        QueryableStoreTypes.keyValueStore()
    )
);

CaseState state = store.get("CASE-1");
```

### 13.3 Distributed state problem

State dibagi di banyak instance.

```text
CASE-1 may be on instance A
CASE-2 may be on instance B
CASE-3 may be on instance C
```

Jika request untuk `CASE-2` datang ke instance A, instance A harus tahu bahwa key itu dimiliki instance B.

Kafka Streams menyediakan metadata untuk menemukan host yang memiliki key/store tertentu.

### 13.4 `application.server`

Untuk interactive queries lintas instance, tiap instance perlu mengiklankan endpoint host/port:

```properties
application.server=case-streams-0.case-streams:8080
```

Ini digunakan dalam metadata discovery.

Di Kubernetes, ini perlu dirancang hati-hati:

1. stable DNS name,
2. pod identity,
3. service routing,
4. readiness state,
5. rolling deployment behavior,
6. TLS/auth antar instance jika query forwarding.

### 13.5 Query routing pattern

Pattern umum:

```text
1. HTTP request masuk ke any instance.
2. Instance cek metadata: key ini milik host mana?
3. Jika local, baca local store.
4. Jika remote, forward request ke host pemilik key.
5. Remote host membaca local store dan return result.
```

Pseudo-code:

```java
KeyQueryMetadata metadata = streams.queryMetadataForKey(
    "case-state-store",
    caseId,
    Serdes.String().serializer()
);

HostInfo activeHost = metadata.activeHost();

if (isThisHost(activeHost)) {
    return localStore.get(caseId);
}

return httpClient.get("http://" + activeHost.host() + ":" + activeHost.port()
    + "/internal/cases/" + caseId + "/state");
```

### 13.6 Interactive queries cocok untuk apa?

Cocok:

1. low-latency lookup atas materialized view,
2. dashboard internal,
3. operational status query,
4. serving layer sederhana,
5. state inspection/debugging,
6. SLA/case state lookup dengan volume terkendali.

Kurang cocok:

1. ad-hoc query kompleks,
2. query global scan besar,
3. search/filter multi-field,
4. transactional update,
5. query dengan strict read-your-write across systems,
6. public API dengan availability requirement yang lebih tinggi dari stream app.

### 13.7 Jangan menjadikan Kafka Streams sebagai database umum

Interactive query menggoda engineer untuk menjadikan Kafka Streams app sebagai database serving layer utama. Ini bisa valid untuk use case tertentu, tetapi harus hati-hati.

Pertanyaan desain:

1. Apa query pattern-nya key lookup atau scan?
2. Apakah query volume mengganggu stream processing?
3. Apa latency SLO query?
4. Apa availability SLO query saat rebalance/restore?
5. Bagaimana authentication/authorization?
6. Bagaimana pagination/search?
7. Bagaimana backup dan disaster recovery?
8. Bagaimana routing saat instance rolling restart?

Jika jawaban tidak jelas, lebih aman materialize output ke database/search store khusus.

---

## 14. State Store Sizing

### 14.1 Estimasi kasar state size

Formula awal:

```text
state_size ≈ number_of_keys × average_serialized_value_size × overhead_factor
```

Untuk window store:

```text
window_state_size ≈ keys_per_window × number_of_open_windows × value_size × overhead_factor
```

Untuk join store:

```text
join_state_size ≈ records_retained_within_join_window × average_record_size × overhead_factor
```

Overhead factor mencakup RocksDB/index/metadata/compaction/filesystem overhead. Jangan mengasumsikan 1:1 dengan serialized value.

### 14.2 Contoh lifecycle projection

Misal:

```text
active + retained cases: 50 million
average serialized CaseState: 1 KB
rough raw state: 50 GB
estimated with overhead: 80–150 GB
standby replicas=1: double local fleet storage
```

Jika ada 10 tasks merata:

```text
per task raw: 5 GB
with overhead: 8–15 GB
```

Jika ada 5 instances:

```text
per instance active state: 16–30 GB
with standby replica: additional 16–30 GB depending placement
```

### 14.3 Contoh dedupe store

Jika dedupe berdasarkan event id selama 7 hari:

```text
throughput: 5,000 events/sec
retention: 7 days
records retained: 5,000 × 60 × 60 × 24 × 7 = 3,024,000,000 event ids
```

Bahkan jika event id kecil, ini sangat besar.

Dedupe window harus dipilih berdasarkan real duplicate horizon, bukan “biar aman simpan selamanya”.

### 14.4 Window state explosion

Window store bisa meledak karena:

1. window size besar,
2. grace period besar,
3. key cardinality tinggi,
4. hopping window menghasilkan banyak overlapping windows,
5. late event policy longgar,
6. input rate tinggi.

Contoh hopping window:

```text
window size = 1 hour
advance = 1 minute
```

Satu record bisa masuk ke banyak window. Ini meningkatkan state dan write amplification.

---

## 15. State Retention

### 15.1 Retention untuk non-windowed state

Untuk latest-state store, retention biasanya dikendalikan oleh key lifecycle.

Pertanyaan:

1. Kapan key dianggap selesai?
2. Apakah state closed case perlu disimpan?
3. Apakah perlu tombstone/delete?
4. Apakah compliance membutuhkan retention panjang?
5. Apakah state store harus menyimpan full history atau latest state saja?

Kafka Streams state store latest-state bukan pengganti audit log. Audit log tetap di event topic.

### 15.2 Retention untuk windowed state

Windowed state retention harus cukup untuk:

```text
window size + grace period + margin
```

Jika retention terlalu pendek, late event yang masih valid bisa gagal diproses benar.

Jika retention terlalu panjang, state membengkak.

### 15.3 Tombstone dan cleanup

Untuk key-value table, tombstone dapat menghapus key.

Contoh:

```text
key=CASE-1, value=null
```

Artinya state `CASE-1` dihapus.

Namun tombstone harus dirancang hati-hati:

1. Apakah delete berarti case hilang atau closed?
2. Apakah downstream perlu tahu deletion?
3. Apakah audit log tetap menyimpan event historis?
4. Apakah compacted changelog retention cukup menyimpan tombstone sampai semua replica melihatnya?

---

## 16. Cache, Commit Interval, dan Flush Semantics

Kafka Streams memiliki caching layer untuk mengurangi write amplification dan output intermediate.

### 16.1 Record cache

Cache dapat menahan update state sebelum flush ke downstream/changelog.

Contoh:

```text
Input:
  CASE-1 -> status A
  CASE-1 -> status B
  CASE-1 -> status C

Dengan cache:
  downstream mungkin hanya melihat CASE-1 -> status C saat flush
```

Ini baik untuk throughput, tetapi memengaruhi observabilitas dan latency output.

### 16.2 Commit interval

`commit.interval.ms` memengaruhi seberapa sering Kafka Streams commit progress dan flush state terkait.

Trade-off:

```text
Lower commit interval:
  + lower recovery replay
  + lower output latency
  - more overhead

Higher commit interval:
  + better throughput
  + less overhead
  - more records replayed after crash
  - output/changelog visibility may be delayed
```

### 16.3 Cache bisa menyembunyikan intermediate updates

Untuk KTable, downstream sering hanya membutuhkan latest value. Cache membantu mengurangi noise.

Namun untuk debugging, engineer kadang bingung karena tidak semua intermediate update muncul langsung.

---

## 17. Rebalance dan Stateful Apps

### 17.1 Rebalance lebih mahal untuk stateful topology

Pada stateless app, rebalance mostly berarti partition ownership pindah.

Pada stateful app, rebalance juga berarti:

1. state ownership pindah,
2. state restore mungkin diperlukan,
3. local RocksDB mungkin dibuka/ditutup,
4. standby assignment berubah,
5. query routing berubah,
6. latency bisa spike.

### 17.2 Rolling deployment

Rolling deployment stateful Kafka Streams harus lebih hati-hati dibanding stateless service.

Checklist:

1. Gunakan cooperative rebalancing jika tersedia dan cocok.
2. Jangan restart semua instance sekaligus.
3. Pastikan readiness probe tidak menerima traffic sebelum streams state running.
4. Pastikan liveness probe tidak terlalu agresif saat restore.
5. Monitor restore progress.
6. Pastikan `state.dir` persistent jika state besar.
7. Pastikan standby replica cukup jika RTO ketat.

### 17.3 Readiness state

Aplikasi tidak boleh dianggap ready hanya karena HTTP server up.

Kafka Streams app bisa berada dalam state:

1. CREATED,
2. REBALANCING,
3. RUNNING,
4. PENDING_SHUTDOWN,
5. NOT_RUNNING,
6. ERROR.

Readiness sebaiknya mempertimbangkan apakah Streams sudah RUNNING dan store yang dibutuhkan sudah queryable.

---

## 18. Failure Modes

### 18.1 Disk full

Gejala:

1. RocksDB write gagal,
2. stream thread error,
3. app crash/restart loop,
4. restore tidak selesai,
5. output berhenti,
6. lag naik.

Penyebab:

1. state size underestimated,
2. window retention terlalu panjang,
3. changelog/repartition internal topic menghasilkan state besar,
4. RocksDB compaction temporary space,
5. logs/app files satu disk dengan state,
6. standby replica menambah state.

Mitigasi:

1. disk capacity planning,
2. separate volume untuk state,
3. alert disk usage,
4. retention tuning,
5. reduce state cardinality,
6. add partitions/instances jika sharding dibutuhkan,
7. cleanup closed/inactive keys dengan tombstone.

### 18.2 Restore storm

Sudah dibahas di atas, tetapi ini salah satu incident paling mahal.

Mitigasi utama:

1. persistent local state,
2. standby replica,
3. rolling deployment lambat,
4. avoid mass restart,
5. monitor restore throughput,
6. broker capacity for recovery.

### 18.3 State corruption

Penyebab:

1. bug application logic,
2. incompatible serde change,
3. manual file manipulation,
4. RocksDB issue/disk issue,
5. application reset salah,
6. schema evolution breaking.

Mitigasi:

1. schema compatibility checks,
2. deterministic replay tests,
3. state validation output,
4. backup input/changelog retention strategy,
5. controlled reset procedure,
6. avoid manual edit local state.

### 18.4 Hot key / hot state

Jika satu key menerima banyak event, satu task menjadi bottleneck.

Contoh:

```text
tenantId=BIG_TENANT -> 70% traffic
```

Dampak:

1. satu partition panas,
2. satu RocksDB store shard panas,
3. satu stream task lag,
4. scaling instance tidak membantu.

Mitigasi:

1. desain key lebih granular,
2. split hot tenant dengan sub-key,
3. two-stage aggregation,
4. custom partitioning hati-hati,
5. isolate hot tenant topic.

### 18.5 Changelog topic misconfigured

Gejala:

1. restore gagal,
2. state hilang setelah restart,
3. internal topic tidak replicated cukup,
4. unauthorized access,
5. retention menghapus data dibutuhkan.

Mitigasi:

1. jangan override internal topic sembarangan,
2. pastikan broker defaults aman,
3. set replication factor internal topics sesuai environment,
4. monitor internal topics,
5. ACL untuk application id.

### 18.6 Query hits wrong instance

Interactive query failure:

1. metadata stale,
2. instance sedang rebalance,
3. remote host tidak reachable,
4. Kubernetes service routing salah,
5. `application.server` tidak stabil,
6. key serializer untuk metadata lookup berbeda dari stream key serializer.

Mitigasi:

1. retry dengan backoff,
2. return 503 saat rebalancing,
3. use stable pod DNS,
4. consistent serializer,
5. internal endpoint health checks,
6. fallback to external materialized DB jika availability query penting.

---

## 19. Java Example: Lifecycle Projection with Queryable Store

### 19.1 Domain model sederhana

```java
public enum CaseStatus {
    OPENED,
    UNDER_REVIEW,
    ESCALATED,
    CLOSED
}

public record CaseEvent(
    String eventId,
    String caseId,
    String eventType,
    Instant eventTime,
    String actor,
    Map<String, String> attributes
) {}

public record CaseState(
    String caseId,
    CaseStatus status,
    String assignedTo,
    int evidenceCount,
    int escalationLevel,
    Instant lastEventTime
) {
    public static CaseState initial(String caseId) {
        return new CaseState(caseId, null, null, 0, 0, null);
    }

    public CaseState apply(CaseEvent event) {
        return switch (event.eventType()) {
            case "CaseOpened" -> new CaseState(
                event.caseId(),
                CaseStatus.OPENED,
                null,
                evidenceCount,
                escalationLevel,
                event.eventTime()
            );
            case "CaseAssigned" -> new CaseState(
                caseId,
                CaseStatus.UNDER_REVIEW,
                event.attributes().get("assignedTo"),
                evidenceCount,
                escalationLevel,
                event.eventTime()
            );
            case "EvidenceAdded" -> new CaseState(
                caseId,
                status,
                assignedTo,
                evidenceCount + 1,
                escalationLevel,
                event.eventTime()
            );
            case "CaseEscalated" -> new CaseState(
                caseId,
                CaseStatus.ESCALATED,
                assignedTo,
                evidenceCount,
                escalationLevel + 1,
                event.eventTime()
            );
            case "CaseClosed" -> new CaseState(
                caseId,
                CaseStatus.CLOSED,
                assignedTo,
                evidenceCount,
                escalationLevel,
                event.eventTime()
            );
            default -> this;
        };
    }
}
```

Catatan penting:

1. Ini contoh sederhana, bukan full production code.
2. Production code perlu validasi transition.
3. Production code perlu idempotency/deduplication jika event duplicate mungkin terjadi.
4. Production code perlu handle out-of-order event.

### 19.2 Topology

```java
public final class CaseLifecycleTopology {

    public static final String INPUT_TOPIC = "case.events.v1";
    public static final String OUTPUT_TOPIC = "case.state-updated.v1";
    public static final String STORE_NAME = "case-state-store";

    public Topology build(
        Serde<String> stringSerde,
        Serde<CaseEvent> caseEventSerde,
        Serde<CaseState> caseStateSerde
    ) {
        StreamsBuilder builder = new StreamsBuilder();

        KStream<String, CaseEvent> events = builder.stream(
            INPUT_TOPIC,
            Consumed.with(stringSerde, caseEventSerde)
        );

        KTable<String, CaseState> caseState = events
            .groupByKey(Grouped.with(stringSerde, caseEventSerde))
            .aggregate(
                () -> null,
                (caseId, event, current) -> {
                    CaseState base = current == null
                        ? CaseState.initial(caseId)
                        : current;
                    return base.apply(event);
                },
                Materialized.<String, CaseState, KeyValueStore<Bytes, byte[]>>as(STORE_NAME)
                    .withKeySerde(stringSerde)
                    .withValueSerde(caseStateSerde)
            );

        caseState.toStream()
            .to(OUTPUT_TOPIC, Produced.with(stringSerde, caseStateSerde));

        return builder.build();
    }
}
```

### 19.3 Streams configuration

```java
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "case-lifecycle-projector");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "kafka-1:9092,kafka-2:9092,kafka-3:9092");
props.put(StreamsConfig.STATE_DIR_CONFIG, "/var/lib/case-lifecycle-projector/state");
props.put(StreamsConfig.NUM_STANDBY_REPLICAS_CONFIG, 1);
props.put(StreamsConfig.COMMIT_INTERVAL_MS_CONFIG, 1000);
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, StreamsConfig.EXACTLY_ONCE_V2);
props.put(StreamsConfig.APPLICATION_SERVER_CONFIG, "case-lifecycle-0.case-lifecycle:8080");
```

Important:

1. `application.id` menentukan consumer group dan internal topic prefix.
2. `state.dir` harus production-grade untuk state besar.
3. `num.standby.replicas=1` meningkatkan failover readiness, tetapi menambah storage.
4. `application.server` diperlukan untuk interactive queries discovery.
5. Exactly-once tidak otomatis membuat side effect eksternal exactly-once.

---

## 20. Interactive Query Example

### 20.1 Local lookup service

```java
public final class CaseStateQueryService {

    private final KafkaStreams streams;

    public CaseStateQueryService(KafkaStreams streams) {
        this.streams = streams;
    }

    public CaseState getLocal(String caseId) {
        ReadOnlyKeyValueStore<String, CaseState> store = streams.store(
            StoreQueryParameters.fromNameAndType(
                CaseLifecycleTopology.STORE_NAME,
                QueryableStoreTypes.keyValueStore()
            )
        );

        return store.get(caseId);
    }
}
```

### 20.2 Metadata-based routing

```java
public final class CaseStateRouter {

    private final KafkaStreams streams;
    private final Serializer<String> keySerializer;
    private final HostInfo thisHost;
    private final CaseStateQueryService localService;
    private final RemoteCaseStateClient remoteClient;

    public CaseStateRouter(
        KafkaStreams streams,
        Serializer<String> keySerializer,
        HostInfo thisHost,
        CaseStateQueryService localService,
        RemoteCaseStateClient remoteClient
    ) {
        this.streams = streams;
        this.keySerializer = keySerializer;
        this.thisHost = thisHost;
        this.localService = localService;
        this.remoteClient = remoteClient;
    }

    public CaseState get(String caseId) {
        KeyQueryMetadata metadata = streams.queryMetadataForKey(
            CaseLifecycleTopology.STORE_NAME,
            caseId,
            keySerializer
        );

        HostInfo activeHost = metadata.activeHost();

        if (activeHost == null || activeHost.equals(HostInfo.unavailable())) {
            throw new IllegalStateException("State is not currently queryable for key " + caseId);
        }

        if (activeHost.equals(thisHost)) {
            return localService.getLocal(caseId);
        }

        return remoteClient.getCaseState(activeHost, caseId);
    }
}
```

### 20.3 Important behavior

Interactive query endpoint harus siap menghadapi:

1. store not queryable during rebalance,
2. stale metadata,
3. remote host unavailable,
4. key not found,
5. local state restoring,
6. serialization mismatch,
7. authorization failure,
8. timeout.

Return code design:

```text
200 -> found
404 -> key not found
409/425 -> state not ready/rebalancing, retry later
503 -> instance not ready
504 -> remote query timeout
```

---

## 21. Testing Stateful Kafka Streams

### 21.1 TopologyTestDriver

Kafka Streams menyediakan testing utility untuk menjalankan topology secara deterministic di unit test.

Contoh test projection:

```java
@Test
void should_project_case_lifecycle_state() {
    Topology topology = new CaseLifecycleTopology().build(
        Serdes.String(),
        caseEventSerde,
        caseStateSerde
    );

    Properties props = new Properties();
    props.put(StreamsConfig.APPLICATION_ID_CONFIG, "test-case-lifecycle");
    props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "dummy:9092");

    try (TopologyTestDriver driver = new TopologyTestDriver(topology, props)) {
        TestInputTopic<String, CaseEvent> input = driver.createInputTopic(
            CaseLifecycleTopology.INPUT_TOPIC,
            Serdes.String().serializer(),
            caseEventSerde.serializer()
        );

        ReadOnlyKeyValueStore<String, CaseState> store = driver.getKeyValueStore(
            CaseLifecycleTopology.STORE_NAME
        );

        input.pipeInput("CASE-1", new CaseEvent(
            "EVT-1",
            "CASE-1",
            "CaseOpened",
            Instant.parse("2026-06-19T10:00:00Z"),
            "system",
            Map.of()
        ));

        input.pipeInput("CASE-1", new CaseEvent(
            "EVT-2",
            "CASE-1",
            "CaseEscalated",
            Instant.parse("2026-06-19T10:10:00Z"),
            "supervisor",
            Map.of()
        ));

        CaseState state = store.get("CASE-1");
        assertEquals(CaseStatus.ESCALATED, state.status());
        assertEquals(1, state.escalationLevel());
    }
}
```

### 21.2 Test yang harus ada

Untuk stateful app, test minimal:

1. Aggregation happy path.
2. Duplicate event behavior.
3. Out-of-order event behavior.
4. Invalid transition behavior.
5. Tombstone/delete behavior.
6. Schema evolution compatibility.
7. Window boundary.
8. Late event/grace behavior.
9. Repartition correctness.
10. Restore/replay deterministic behavior.

### 21.3 Deterministic replay test

Salah satu test paling bernilai:

```text
Given the same ordered input event fixture,
When topology is replayed from empty state,
Then final materialized state is exactly the same.
```

Ini penting untuk auditability.

Jika replay menghasilkan output berbeda karena current time, random value, external API call, atau non-deterministic ordering, sistem sulit dipertahankan secara regulatory.

---

## 22. Production Observability

### 22.1 Metrics yang harus dipantau

Kafka Streams stateful app membutuhkan observability pada beberapa lapisan:

#### Application state

1. Kafka Streams state: RUNNING, REBALANCING, ERROR.
2. Stream thread count.
3. Failed stream thread.
4. Task assignment.
5. Rebalance count/duration.

#### Processing

1. process rate,
2. process latency,
3. punctuate latency,
4. commit latency,
5. skipped records,
6. deserialization errors,
7. production errors.

#### State store

1. state store size,
2. RocksDB put/get latency,
3. RocksDB block cache usage,
4. memtable size,
5. compaction time,
6. write stalls,
7. open file count.

#### Restore

1. restore start/end,
2. records restored,
3. bytes restored,
4. restore rate,
5. restore lag.

#### Kafka dependency

1. input consumer lag,
2. changelog restore lag,
3. internal topic health,
4. producer latency to changelog/output,
5. broker under-replicated partitions.

#### Host/disk

1. disk usage,
2. disk IOPS,
3. disk latency,
4. filesystem errors,
5. available inode,
6. container restarts.

### 22.2 Alert examples

Useful alerts:

```text
Kafka Streams app not RUNNING for > 5 minutes
Restore in progress for > expected threshold
State directory disk usage > 80%
State directory disk usage > 90%
Consumer lag increasing for > 15 minutes
Rebalance count > baseline
RocksDB write stall detected
Changelog topic under replicated
Internal topic unauthorized/error
Interactive query 5xx rate high
```

### 22.3 Dashboard design

Dashboard should show:

1. input rate,
2. output rate,
3. consumer lag,
4. processing latency,
5. rebalance timeline,
6. restore timeline,
7. state store size per instance,
8. disk usage per instance,
9. RocksDB pressure,
10. internal topic health,
11. interactive query latency/error.

---

## 23. Configuration Checklist

### 23.1 Core Kafka Streams configs

```properties
application.id=case-lifecycle-projector
bootstrap.servers=kafka-1:9092,kafka-2:9092,kafka-3:9092
state.dir=/var/lib/case-lifecycle-projector/state
num.stream.threads=2
num.standby.replicas=1
commit.interval.ms=1000
processing.guarantee=exactly_once_v2
application.server=case-lifecycle-0.case-lifecycle:8080
```

### 23.2 Internal topic durability

Depending on environment, ensure internal topics have appropriate:

```properties
replication.factor=3
min.insync.replicas=2
```

Kafka Streams has internal topic replication configuration knobs, but platform defaults should also be sane.

### 23.3 Consumer/producer inherited configs

Kafka Streams internally uses producer and consumer clients. Some configs may need tuning:

```properties
producer.compression.type=zstd
producer.acks=all
producer.delivery.timeout.ms=120000
consumer.max.poll.records=500
```

Do not blindly copy configs from plain producer/consumer apps. Kafka Streams has its own processing loop and semantics.

### 23.4 RocksDB tuning

RocksDB tuning is workload-specific. Start with defaults, observe, then tune.

Potential tuning areas:

1. block cache size,
2. write buffer size,
3. max write buffers,
4. compaction style,
5. max background compactions,
6. bloom filters,
7. block size,
8. direct I/O.

Avoid premature tuning without metrics. Bad RocksDB tuning can make performance worse.

---

## 24. Design Trade-Offs

### 24.1 Local state vs external database

| Option | Strength | Weakness |
|---|---|---|
| Kafka Streams local state | low-latency processing, co-located with task, Kafka-native fault tolerance | query routing complexity, disk management, limited ad-hoc queries |
| External database | mature serving/query layer, operational familiarity | extra write path, dual consistency concerns, extra cost/latency |
| Both | stream-native processing + serving flexibility | more moving parts, eventual consistency between state and DB |

Decision guide:

Use local state if processing needs fast per-key state and query pattern is simple. Use external DB/search store if serving/query requirements dominate.

### 24.2 Persistent store vs in-memory store

| Choice | Good for | Risk |
|---|---|---|
| Persistent RocksDB | large state, fast restart with local disk | disk pressure, RocksDB tuning |
| In-memory | small state, low latency | OOM, full restore after restart |

### 24.3 Standby replica vs no standby

| Choice | Good for | Risk |
|---|---|---|
| No standby | small state, lower cost | slower failover |
| Standby replica | large state, faster failover | extra disk/network/cost |

### 24.4 Interactive query vs output topic materialization

| Choice | Good for | Risk |
|---|---|---|
| Interactive query | direct local lookup, fewer systems | routing/availability complexity |
| Output to DB | robust serving, rich query | extra sink, consistency lag |

---

## 25. Anti-Patterns

### Anti-pattern 1: State besar di ephemeral disk tanpa standby

```text
State size: 500 GB
Disk: ephemeral
Standby: none
Deployment: rolling restart semua pod cepat
```

Ini recipe untuk restore storm.

### Anti-pattern 2: Mengubah `application.id` karena ingin “deploy versi baru”

`application.id` menentukan identity aplikasi, consumer group, dan internal topics. Mengubahnya membuat Kafka Streams menganggap ini aplikasi baru.

Dampak:

1. mulai dari offset baru/tergantung config,
2. internal topics baru,
3. state store baru,
4. restore/reprocessing besar,
5. output duplicate/berubah.

### Anti-pattern 3: Menghapus internal topics untuk “membersihkan Kafka”

Internal topics Kafka Streams bukan temporary garbage.

Menghapus changelog/repartition topics tanpa reset plan bisa merusak state recovery.

### Anti-pattern 4: Interactive query tanpa routing plan

Endpoint:

```http
GET /case/{id}
```

hanya membaca local store dan return 404 jika key tidak ada lokal.

Ini salah. Key mungkin ada di instance lain.

### Anti-pattern 5: Window retention asal besar

```text
Window: 5 minutes
Grace: 7 days
```

Tanpa alasan kuat, ini membuat state jauh lebih besar dari kebutuhan.

### Anti-pattern 6: Aggregate tidak idempotent terhadap duplicate

Jika duplicate event menyebabkan counter naik dua kali, maka at-least-once/retry/rebalance dapat merusak angka.

### Anti-pattern 7: External API call di aggregator

Aggregator harus deterministic dan cepat. Memanggil external API saat update state membuat replay tidak deterministic dan recovery rapuh.

### Anti-pattern 8: State object terus membesar

Contoh buruk:

```text
CASE-1 -> includes list of every evidence event forever
```

Lebih baik simpan summary/count/reference, bukan seluruh history jika event log sudah menyimpan history.

---

## 26. Regulatory / Case Management Perspective

Untuk sistem regulatory enforcement, Kafka Streams state bisa sangat powerful.

### 26.1 Case lifecycle projection

Input event:

```text
CaseOpened
CaseAssigned
EvidenceSubmitted
ReviewCompleted
CaseEscalated
DecisionIssued
AppealSubmitted
CaseClosed
```

State store:

```text
caseId -> current lifecycle state
```

Use case:

1. dashboard current case status,
2. SLA monitoring,
3. escalation rules,
4. workload allocation,
5. audit reconstruction support,
6. decision support.

### 26.2 SLA monitor

State store menyimpan due date dan current SLA state:

```text
CASE-1 -> dueAt=2026-06-21T10:00Z, status=ON_TRACK
CASE-2 -> dueAt=2026-06-18T17:00Z, status=BREACHED
```

Processor bisa emit:

```text
SlaWarningRaised
SlaBreached
EscalationRequired
```

### 26.3 Auditability invariant

Untuk regulatory system, invariant penting:

```text
State store is not the audit log.
State store is a projection derived from auditable events.
```

Audit harus bisa kembali ke event log:

```text
Why is CASE-2 escalated?
Show causation chain:
  CaseOpened -> EvidenceSubmitted -> ReviewOverdue -> SlaBreached -> CaseEscalated
```

State store hanya latest materialized view.

### 26.4 Replay defensibility

Aplikasi harus bisa menjawab:

```text
If we replay all events up to timestamp T, do we get the same state that was used for decision D?
```

Untuk itu:

1. event harus immutable,
2. schema evolution compatible,
3. aggregation deterministic,
4. external dependencies versioned atau avoided,
5. rule/config changes event-sourced atau versioned,
6. timestamp semantics jelas.

---

## 27. Production Readiness Checklist

Sebelum stateful Kafka Streams app production, jawab checklist ini.

### 27.1 State model

- [ ] Apa saja state store yang dibuat topology?
- [ ] Apakah setiap store punya nama eksplisit?
- [ ] Berapa cardinality key?
- [ ] Berapa average/max value size?
- [ ] Apakah state bounded atau unbounded?
- [ ] Bagaimana key dihapus?
- [ ] Apakah tombstone digunakan?
- [ ] Apakah state object bisa membesar tanpa batas?

### 27.2 Storage

- [ ] Di mana `state.dir` berada?
- [ ] Apakah disk persistent atau ephemeral?
- [ ] Berapa disk size per instance?
- [ ] Apakah ada margin untuk RocksDB compaction?
- [ ] Apakah logs dan state berbagi disk?
- [ ] Apakah inode cukup?
- [ ] Apakah disk usage dimonitor?

### 27.3 Recovery

- [ ] Berapa estimasi restore time per task?
- [ ] Berapa restore time jika satu node hilang?
- [ ] Berapa restore time jika semua pods pindah?
- [ ] Apakah standby replica diperlukan?
- [ ] Apakah changelog topic replicated cukup?
- [ ] Apakah restore metrics dimonitor?
- [ ] Apakah rolling restart pernah diuji?

### 27.4 Correctness

- [ ] Apakah duplicate event aman?
- [ ] Apakah out-of-order event ditangani?
- [ ] Apakah late event/window behavior jelas?
- [ ] Apakah aggregator deterministic?
- [ ] Apakah external API tidak dipanggil dalam state update path?
- [ ] Apakah schema evolution diuji?
- [ ] Apakah replay test menghasilkan state sama?

### 27.5 Interactive queries

- [ ] Apakah store memang perlu queryable?
- [ ] Apakah query hanya key lookup?
- [ ] Apakah routing lintas instance diimplementasikan?
- [ ] Apakah `application.server` stabil?
- [ ] Apakah endpoint menolak request saat state belum ready?
- [ ] Apakah remote query timeout/retry jelas?
- [ ] Apakah authorization diterapkan?

### 27.6 Operations

- [ ] Dashboard menunjukkan stream state, lag, restore, disk, RocksDB.
- [ ] Alert untuk disk full, restore lama, app not running.
- [ ] Runbook untuk corrupt state.
- [ ] Runbook untuk application reset.
- [ ] Runbook untuk internal topic issue.
- [ ] Deployment strategy menghindari mass restore.
- [ ] Capacity test dilakukan dengan data realistis.

---

## 28. Latihan / Thought Exercises

### Exercise 1 — Estimasi state size

Kamu punya stream `case-events` dengan:

```text
10 million active cases
average state size 2 KB
10 partitions
5 application instances
num.standby.replicas=1
```

Pertanyaan:

1. Berapa raw state total?
2. Berapa estimasi state per partition?
3. Berapa estimasi state aktif per instance?
4. Berapa storage tambahan karena standby?
5. Apakah 20 GB disk per instance cukup?

### Exercise 2 — Dedupe window

Stream menerima 20,000 events/sec. Business ingin dedupe event id selama 30 hari.

Pertanyaan:

1. Berapa event id yang perlu disimpan?
2. Apakah ini masuk akal untuk local state?
3. Apa alternatif desain?
4. Apakah duplicate horizon benar-benar 30 hari?

### Exercise 3 — Interactive query routing

Ada 4 instances. Request `GET /cases/CASE-123/state` masuk ke instance A, tetapi key dimiliki instance C.

Pertanyaan:

1. Bagaimana instance A tahu key ada di C?
2. Apa yang terjadi jika metadata stale?
3. Apa response jika C sedang rebalance?
4. Bagaimana desain retry?

### Exercise 4 — Restore storm

Semua pods Kafka Streams restart bersamaan setelah node pool upgrade. Disk state ephemeral. Changelog size total 2 TB.

Pertanyaan:

1. Apa dampak ke Kafka brokers?
2. Apa dampak ke app availability?
3. Apa konfigurasi/deployment yang bisa mengurangi risiko?
4. Bagaimana menguji ini sebelum production?

### Exercise 5 — Regulatory replay

Aplikasi lifecycle projection menghasilkan state `ESCALATED` untuk `CASE-999`. Auditor bertanya mengapa.

Pertanyaan:

1. Apakah cukup membaca state store?
2. Event apa yang harus ditelusuri?
3. Bagaimana correlation/causation membantu?
4. Bagaimana memastikan replay menghasilkan state yang sama?

---

## 29. Ringkasan

Stateful Kafka Streams adalah salah satu fitur paling kuat dalam Kafka ecosystem, tetapi juga salah satu area dengan failure mode paling mahal.

Mental model utama:

```text
Kafka Streams state = local materialized state + Kafka changelog durability + task ownership
```

Hal yang harus diingat:

1. State store adalah local storage untuk operasi stateful.
2. RocksDB sering menjadi backend persistent state store.
3. Changelog topic adalah recovery source untuk state.
4. Persistent `state.dir` dapat mengurangi restore cost.
5. Standby replica mempercepat failover tetapi menambah disk/network cost.
6. Restore time adalah bagian dari availability.
7. Interactive queries membutuhkan routing karena state terdistribusi.
8. Rebalance pada stateful app lebih mahal daripada stateless app.
9. State size, retention, key cardinality, dan disk pressure harus dihitung sejak desain.
10. Untuk regulatory systems, state store adalah projection, bukan audit log.

Jika Part 019 menjelaskan bagaimana Kafka Streams membagi pekerjaan menjadi topology, task, thread, dan local state, maka Part 020 menjelaskan bagaimana state itu bertahan, dipulihkan, diquery, dan dioperasikan di production.

---

## 30. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-021.md
```

Judul:

```text
Kafka Streams Processing Semantics: Windowing, Joins, Suppression, and Exactly-Once
```

Part 021 akan masuk lebih dalam ke correctness semantics:

1. event time vs processing time,
2. timestamp extractor,
3. window stores,
4. grace period,
5. late events,
6. stream-stream join,
7. KStream-KTable join,
8. repartitioning,
9. suppression,
10. exactly-once v2,
11. transaction boundaries,
12. testing semantic correctness.

Dengan kata lain, Part 020 fokus pada **state storage and recovery**, sedangkan Part 021 fokus pada **stateful processing correctness**.

---

## 31. Referensi

Referensi yang relevan untuk pendalaman:

1. Apache Kafka Documentation — Kafka Streams configuration and state-related settings.  
   `https://kafka.apache.org/documentation/`

2. Apache Kafka Streams Developer Guide — Interactive Queries.  
   `https://kafka.apache.org/42/streams/developer-guide/interactive-queries/`

3. Apache Kafka Streams Architecture and Core Concepts.  
   `https://kafka.apache.org/documentation/streams/`

4. Confluent Documentation — Configure Kafka Streams applications, standby replicas, state stores, and application server.  
   `https://docs.confluent.io/platform/current/streams/developer-guide/config-streams.html`

5. Confluent Developer Course — Changelogs and Standbys with Kafka Streams.  
   `https://developer.confluent.io/courses/kafka-streams/stateful-fault-tolerance/`

6. Confluent Blog — RocksDB tuning for Kafka Streams state stores.  
   `https://www.confluent.io/blog/how-to-tune-rocksdb-kafka-streams-state-stores-performance/`



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Kafka Streams Fundamentals for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-021.md">Part 021 — Kafka Streams Processing Semantics: Windowing, Joins, Suppression, and Exactly-Once ➡️</a>
</div>

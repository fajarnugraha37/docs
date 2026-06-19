# learn-kafka-event-streaming-mastery-for-java-engineers-part-005.md

# Part 005 — Partitioning Strategy: Keys, Ordering Domains, Hot Partitions, and Scalability

> Seri: Kafka, Kafka ksqlDB, Kafka Connect, Kafka Streams, Event Streaming Mastery untuk Java Software Engineer  
> Fokus part ini: memahami partitioning sebagai keputusan arsitektur, bukan sekadar konfigurasi producer.  
> Status seri: Part 005 dari 034. Seri belum selesai.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan mengapa partition adalah unit paling penting untuk ordering, parallelism, throughput, storage distribution, dan consumer ownership.
2. Membedakan **topic design** dengan **partitioning strategy**.
3. Memilih key Kafka berdasarkan **ordering domain**, bukan sekadar berdasarkan field yang tersedia.
4. Menghindari hot partition, hot key, dan skewed workload.
5. Memahami dampak menambah partition count terhadap ordering, throughput, metadata, consumer group, dan operasional cluster.
6. Mendesain partitioning untuk workload Java backend, regulatory workflow, case lifecycle, CDC, audit stream, dan multi-tenant system.
7. Mengetahui kapan memakai null key, business key, technical key, composite key, bucketed key, custom partitioner, atau topic split.
8. Membuat partitioning decision record yang bisa dipertanggungjawabkan secara arsitektural.

---

## 2. Mental Model Utama

Partitioning adalah jawaban Kafka terhadap pertanyaan:

> “Bagaimana satu stream log besar dipecah menjadi beberapa log independen agar bisa ditulis, disimpan, direplikasi, dan dibaca secara paralel, tanpa kehilangan ordering yang kita butuhkan?”

Kafka tidak memberikan total ordering global untuk semua record di sebuah topic. Kafka memberi ordering di dalam **satu partition**. Karena itu, setiap keputusan key dan partition adalah keputusan tentang:

```text
apa yang harus tetap urut
vs
apa yang boleh diproses paralel
```

Inilah mental model terpenting:

```text
Topic     = kategori stream/event contract
Partition = shard log fisik/logis
Key       = routing decision menuju partition
Offset    = posisi record di dalam partition
Ordering  = hanya dijamin di dalam partition
Parallelism = jumlah partition yang dapat dimiliki consumer group
```

Contoh:

```text
Topic: case-events

Partition 0:
  offset 0: CASE-1 CREATED
  offset 1: CASE-1 ASSIGNED
  offset 2: CASE-1 ESCALATED

Partition 1:
  offset 0: CASE-2 CREATED
  offset 1: CASE-2 CLOSED
```

Ordering `CASE-1` aman jika semua event `CASE-1` masuk partition yang sama. Ordering antar `CASE-1` dan `CASE-2` tidak dijamin dan biasanya memang tidak dibutuhkan.

---

## 3. Konsep Inti

### 3.1 Partition Adalah Unit Ordering

Record dalam satu partition memiliki urutan offset yang monoton naik.

```text
partition-3:
  offset 100 -> event A
  offset 101 -> event B
  offset 102 -> event C
```

Consumer yang membaca partition tersebut akan melihat A sebelum B sebelum C.

Namun, antar partition tidak ada urutan global yang meaningful:

```text
partition-0 offset 10
partition-1 offset 20
partition-2 offset 7
```

Tidak ada jawaban natural untuk “mana yang terjadi dulu?” hanya dari offset karena offset bersifat lokal per partition.

Untuk mengetahui urutan bisnis lintas entity, kamu butuh timestamp, sequence number domain, event version, atau mekanisme ordering eksternal.

---

### 3.2 Partition Adalah Unit Parallelism

Dalam satu consumer group, satu partition hanya dimiliki oleh satu consumer pada satu waktu.

Jika topic punya 6 partition dan consumer group punya 3 instance:

```text
consumer-A -> partition 0, 1
consumer-B -> partition 2, 3
consumer-C -> partition 4, 5
```

Jika consumer group punya 10 instance tapi topic hanya punya 6 partition:

```text
6 consumer aktif
4 consumer idle
```

Maka partition count membatasi parallelism maksimum consumer group.

---

### 3.3 Partition Adalah Unit Storage Distribution

Setiap partition memiliki leader replica di salah satu broker, dan follower replica di broker lain.

```text
Topic: case-events
Replication factor: 3
Partitions: 6

partition-0 leader -> broker-1
partition-1 leader -> broker-2
partition-2 leader -> broker-3
partition-3 leader -> broker-1
partition-4 leader -> broker-2
partition-5 leader -> broker-3
```

Semakin banyak partition, semakin banyak unit log yang perlu dikelola broker, controller, filesystem, replication pipeline, dan consumer group.

Partition bukan gratis.

---

### 3.4 Key Adalah Routing Hint

Key Kafka tidak otomatis berarti primary key bisnis. Key adalah input untuk menentukan partition.

Default logic modern Kafka secara konseptual:

1. Jika producer mengirim explicit partition, pakai partition itu.
2. Jika tidak ada explicit partition tetapi ada key, pilih partition berdasarkan hash dari key.
3. Jika tidak ada partition dan tidak ada key, gunakan sticky partitioning agar batching lebih efisien.

Konfigurasi producer Kafka mendokumentasikan bahwa `partitioner.class` menentukan partition tujuan; default logic memilih partition berdasarkan hash key bila key ada, dan menggunakan sticky partition bila key tidak ada. Dokumentasi Apache Kafka 4.2 juga menjelaskan sticky partition berubah setelah minimal `batch.size` bytes diproduksi ke partition tersebut.

---

## 4. Kesalahan Paling Umum

### 4.1 Mengira Topic = Queue

Dalam queue tradisional, message biasanya dikonsumsi lalu hilang dari queue. Dalam Kafka, record disimpan sampai retention/compaction policy menghapusnya. Banyak consumer group bisa membaca stream yang sama secara independen.

Karena itu, partitioning Kafka bukan sekadar “membagi antrian”. Partitioning adalah membagi log agar banyak pembaca bisa membaca ulang stream dengan posisi offset masing-masing.

---

### 4.2 Mengira Key = ID Record

Contoh buruk:

```json
{
  "eventId": "evt-123",
  "caseId": "case-456",
  "eventType": "CASE_ESCALATED"
}
```

Jika key = `eventId`, maka setiap event kemungkinan tersebar ke partition berbeda.

Akibatnya:

```text
CASE_CREATED  -> partition 1
CASE_ASSIGNED -> partition 4
CASE_ESCALATED -> partition 0
```

Ordering per case hilang.

Jika yang perlu urut adalah lifecycle per case, key yang benar biasanya `caseId`, bukan `eventId`.

---

### 4.3 Menggunakan Key dengan Cardinality Rendah

Contoh:

```text
key = status
values = OPEN, CLOSED, ESCALATED, REJECTED
```

Jika ada 20 partition tetapi hanya 4 kemungkinan key, maka maksimal hanya beberapa partition yang aktif.

Akibat:

```text
partition 0: sangat ramai
partition 1: kosong
partition 2: sangat ramai
partition 3: kosong
...
```

Key cardinality rendah sering menyebabkan hot partition.

---

### 4.4 Menambah Partition Setelah Production Tanpa Memahami Ordering

Menambah partition bisa mengubah mapping key ke partition.

Misal awalnya:

```text
hash(case-123) % 6 = partition 2
```

Setelah partition dinaikkan menjadi 12:

```text
hash(case-123) % 12 = partition 8
```

Event lama untuk `case-123` ada di partition 2, event baru masuk partition 8. Ordering per case tidak lagi satu log kontinu.

Kafka memang membolehkan menambah partition, tetapi bukan berarti aman untuk semua topic.

---

### 4.5 Memakai Custom Partitioner Terlalu Cepat

Custom partitioner terlihat menarik, tetapi menambah risiko:

1. Bug routing sulit dideteksi.
2. Upgrade client lebih berisiko.
3. Producer di bahasa berbeda harus meniru logic yang sama.
4. Reprocessing dan reasoning menjadi lebih sulit.
5. Operational team harus memahami logic non-standar.

Custom partitioner seharusnya pilihan terakhir, bukan default.

---

## 5. Ordering Domain

### 5.1 Definisi

**Ordering domain** adalah cakupan entity/proses yang record-nya harus diproses dalam urutan yang sama dengan urutan masuk ke Kafka.

Pertanyaan utamanya:

```text
Untuk hal apa urutan event benar-benar penting?
```

Bukan:

```text
Field apa yang tersedia sebagai key?
```

---

### 5.2 Contoh Ordering Domain

| Sistem | Ordering domain yang mungkin | Key Kafka yang mungkin |
|---|---|---|
| Case management | satu case | `caseId` |
| Payment | satu payment intent | `paymentId` |
| Account ledger | satu account | `accountId` |
| Order lifecycle | satu order | `orderId` |
| Shipment tracking | satu shipment | `shipmentId` |
| User activity projection | satu user | `userId` |
| Regulatory enforcement | satu enforcement case | `caseId` atau `enforcementId` |
| Multi-tenant audit | satu tenant + aggregate | `tenantId:aggregateId` |

---

### 5.3 Ordering Domain yang Salah

Misal regulatory case system:

```text
CASE_CREATED
CASE_ASSIGNED
EVIDENCE_SUBMITTED
CASE_ESCALATED
CASE_CLOSED
```

Kita ingin setiap case diproses sesuai urutan lifecycle.

Key buruk:

```text
key = eventType
```

Karena semua `CASE_CREATED` bisa masuk partition yang sama, semua `CASE_ESCALATED` ke partition lain, dan lifecycle satu case tercerai-berai.

Key lebih tepat:

```text
key = caseId
```

Karena semua event untuk case yang sama masuk partition yang sama.

---

## 6. Key Selection Framework

Gunakan proses berikut saat memilih key.

### Step 1 — Tentukan Invariant Ordering

Tulis kalimat eksplisit:

```text
Untuk topic X, event harus tetap urut per ________.
```

Contoh:

```text
Untuk topic case-events, event harus tetap urut per caseId.
Untuk topic account-ledger-events, event harus tetap urut per accountId.
Untuk topic tenant-audit-events, event harus tetap urut per tenantId + aggregateId.
```

Jika kamu tidak bisa mengisi bagian kosong tersebut, mungkin kamu tidak butuh key.

---

### Step 2 — Cek Cardinality

Key harus punya cardinality cukup tinggi agar distribusi merata.

Buruk:

```text
countryCode: ID, SG, MY, US
status: OPEN, CLOSED, FAILED
priority: LOW, MEDIUM, HIGH
```

Lebih baik:

```text
caseId
accountId
orderId
userId
tenantId:caseId
```

Tapi high cardinality saja tidak cukup. Distribusi traffic juga harus diperiksa.

---

### Step 3 — Cek Skew

Walau cardinality tinggi, workload bisa skewed.

Contoh:

```text
userId punya jutaan value,
tetapi 1 user bot menghasilkan 30% event.
```

Atau:

```text
tenantId punya 1000 value,
tetapi 1 tenant enterprise menghasilkan 70% traffic.
```

High cardinality tidak otomatis berarti balanced.

---

### Step 4 — Cek Stability

Key harus stabil selama lifecycle entity.

Buruk:

```text
key = caseStatus
key = assignedOfficerId
key = currentDepartment
```

Karena status, officer, dan department bisa berubah.

Lebih baik:

```text
key = caseId
```

---

### Step 5 — Cek Privacy dan Compliance

Key sering terlihat di logs, monitoring, DLQ, connector payload, dan debugging tools.

Hindari key yang berisi data sensitif langsung:

```text
nationalId
email
phoneNumber
passportNumber
```

Lebih baik:

```text
opaque internal id
hashed id dengan governance yang jelas
surrogate aggregate id
```

---

### Step 6 — Cek Cross-Language Determinism

Jika producer ditulis dalam Java, Go, Node.js, dan Python, pastikan routing key semantics konsisten.

Default partitioner Kafka client biasanya mengurus hash key, tetapi custom partitioner lintas bahasa bisa menjadi sumber inkonsistensi.

---

## 7. Null Key: Kapan Benar, Kapan Salah

### 7.1 Null Key Benar Jika Ordering Per Entity Tidak Dibutuhkan

Contoh workload:

```text
application logs
metrics
clickstream mentah
telemetry sensor yang tidak butuh ordering per sensor
security event firehose
```

Untuk workload seperti ini, null key bisa meningkatkan batching karena producer dapat menggunakan sticky partitioning.

---

### 7.2 Null Key Salah Jika Entity Lifecycle Harus Urut

Contoh buruk:

```text
case-events dengan null key
```

Akibatnya:

```text
CASE_CREATED(case-1)   -> partition 0
CASE_ASSIGNED(case-1)  -> partition 3
CASE_CLOSED(case-1)    -> partition 1
```

Consumer group dapat memproses event tersebut paralel dan tidak berurutan.

---

### 7.3 Null Key dan Sticky Partitioning

Sticky partitioning mengirim batch record tanpa key ke partition yang sama untuk sementara agar batch lebih besar dan lebih efisien.

Implikasi:

1. Throughput bisa lebih baik daripada round-robin per record.
2. Latency bisa lebih rendah karena batch lebih efektif.
3. Tidak ada guarantee ordering per entity karena entity tidak digunakan sebagai key.
4. Distribusi akan merata dalam jangka waktu cukup panjang, tetapi tidak harus merata pada window pendek.

---

## 8. Business Key vs Technical Key

### 8.1 Business Key

Business key berasal dari domain.

Contoh:

```text
caseId
orderId
accountId
paymentId
customerId
```

Kelebihan:

1. Mudah dipahami.
2. Selaras dengan ordering domain.
3. Memudahkan debugging.
4. Cocok untuk lifecycle event.

Risiko:

1. Bisa mengandung informasi sensitif.
2. Bisa berubah jika domain tidak stabil.
3. Bisa menyebabkan skew jika beberapa entity sangat aktif.

---

### 8.2 Technical Key

Technical key dibuat untuk routing teknis.

Contoh:

```text
hash(caseId)
tenantId:bucketId
aggregateType:aggregateId
shardKey
```

Kelebihan:

1. Bisa menyembunyikan PII.
2. Bisa membantu distribusi.
3. Bisa encode routing decision yang lebih stabil.

Risiko:

1. Sulit dibaca manusia.
2. Bisa melemahkan domain traceability.
3. Jika terlalu abstrak, downstream consumer sulit memahami intent.

---

### 8.3 Rule of Thumb

Gunakan business key jika:

```text
business key stabil
bukan PII sensitif
cardinality tinggi
traffic cukup merata
ordering domain natural
```

Gunakan technical key jika:

```text
business key sensitif
business key terlalu skewed
perlu multi-tenant routing khusus
perlu bucketed parallelism
```

---

## 9. Composite Key Design

Composite key dipakai saat ordering domain adalah kombinasi beberapa dimensi.

Contoh:

```text
tenantId:caseId
jurisdictionId:caseId
accountId:ledgerType
customerId:productId
```

### 9.1 Kapan Composite Key Berguna

Gunakan composite key jika:

1. `caseId` hanya unik di dalam tenant.
2. Perlu menghindari collision antar domain.
3. Downstream perlu partition affinity berdasarkan gabungan entity.
4. Topic multi-tenant tetapi ordering harus per tenant+aggregate.

---

### 9.2 Format Composite Key

Jangan membuat composite key secara ambigu:

Buruk:

```text
TENANT1CASE123
```

Lebih baik:

```text
tenant=TENANT1|case=CASE123
TENANT1:CASE123
```

Lebih robust:

```json
{
  "tenantId": "TENANT1",
  "caseId": "CASE123"
}
```

Namun perlu diingat: key serialization harus konsisten. Jika key berupa structured object, pastikan producer dan consumer memakai schema/Serde yang sama.

---

### 9.3 Composite Key Anti-Pattern

Jangan memasukkan field yang berubah:

```text
tenantId:caseId:status
```

Karena saat status berubah, key berubah, partition bisa berubah, dan ordering lifecycle rusak.

---

## 10. Hot Partitions dan Hot Keys

### 10.1 Definisi Hot Partition

Hot partition adalah partition yang menerima traffic jauh lebih besar dibanding partition lain.

Contoh:

```text
partition 0: 500 MB/s
partition 1: 20 MB/s
partition 2: 18 MB/s
partition 3: 22 MB/s
```

Akibat:

1. Broker leader partition tersebut overload.
2. Consumer yang memegang partition tersebut tertinggal.
3. Lag tidak bisa diselesaikan dengan menambah consumer jika bottleneck ada di satu partition.
4. End-to-end latency naik.
5. Rebalance tidak banyak membantu.

---

### 10.2 Definisi Hot Key

Hot key adalah key yang menghasilkan traffic sangat besar.

Contoh:

```text
tenantId = BIG_BANK menghasilkan 70% event
```

Jika key adalah `tenantId`, semua event tenant tersebut masuk satu partition.

---

### 10.3 Cara Deteksi

Broker/topic metrics:

```text
bytes in per partition
records in per partition
leader partition distribution
request latency by broker
```

Consumer metrics:

```text
lag per partition
records consumed rate per partition
processing time per partition
```

Application metrics:

```text
event count by key hash bucket
top N keys by volume
tenant traffic distribution
entity event frequency
```

Untuk observability mature, jangan hanya lihat lag total consumer group. Lihat lag per partition.

---

### 10.4 Mengapa Hot Partition Berbahaya

Misal topic punya 24 partition dan 24 consumer.

Jika satu partition punya 60% traffic:

```text
consumer-7 memegang partition-7 yang hot
consumer lain relatif idle
```

Menambah consumer jadi 48 tidak membantu karena partition-7 tetap hanya bisa dimiliki satu consumer dalam consumer group.

Solusi harus ada pada:

1. Key design.
2. Topic split.
3. Workload split.
4. Bucketed key.
5. Parallelism di dalam consumer untuk side effect tertentu dengan tetap menjaga ordering lokal jika diperlukan.

---

## 11. Strategi Mengatasi Hot Key

Tidak ada satu solusi universal. Setiap solusi mengorbankan sesuatu.

### 11.1 Pilih Key Lebih Spesifik

Jika key terlalu kasar:

```text
key = tenantId
```

Mungkin bisa diganti:

```text
key = tenantId:caseId
```

Dengan ini, satu tenant besar tetap tersebar berdasarkan case.

Cocok jika ordering yang dibutuhkan adalah per case, bukan per tenant.

---

### 11.2 Bucketed Key

Jika satu entity benar-benar sangat panas, kamu bisa menambahkan bucket.

```text
key = accountId:bucketId
```

Misal:

```text
account-123:0
account-123:1
account-123:2
account-123:3
```

Ini memecah satu entity ke beberapa partition.

Tapi trade-off besar:

```text
ordering global per account hilang
```

Bucketed key hanya aman jika operasi dapat diparalelkan atau ordering bisa direkonstruksi dengan sequence number.

---

### 11.3 Split Topic Berdasarkan Workload

Daripada satu topic campur semua traffic:

```text
all-events
```

Pisahkan:

```text
case-lifecycle-events
case-audit-events
case-evidence-events
case-notification-events
```

Jika hot traffic berasal dari event type tertentu, split topic bisa mengisolasi bottleneck.

Namun jangan split topic hanya karena ingin menghindari desain key yang benar.

---

### 11.4 Special Handling untuk Tenant Besar

Dalam multi-tenant platform, tenant besar kadang perlu jalur khusus.

Contoh:

```text
case-events-standard
case-events-enterprise-tenant-x
```

Atau:

```text
tenant-x.case-events
global.case-events
```

Trade-off:

1. Operasional lebih kompleks.
2. Consumer perlu subscribe lebih banyak topic.
3. Governance topic lebih berat.
4. Namun noisy neighbor lebih terkendali.

---

### 11.5 Downstream Parallelism Setelah Ordered Consumer

Jika Kafka partition harus menjaga ordering tetapi side effect mahal, consumer bisa memisahkan:

```text
single partition poll loop
  -> validate order
  -> route independent work ke worker pool berdasarkan sub-key
```

Namun hati-hati. Jika side effect harus urut, worker pool bisa melanggar ordering.

Gunakan model seperti:

```text
per-key serial executor
bounded queue
idempotent side effect
commit offset setelah safe checkpoint
```

---

## 12. Partition Count Sizing

### 12.1 Partition Count Bukan Sekadar Jumlah Consumer

Partition count dipengaruhi oleh:

1. Target throughput producer.
2. Target throughput consumer.
3. Jumlah consumer group independen.
4. Ordering requirement.
5. Broker count.
6. Replication factor.
7. Retention size.
8. Rebalance cost.
9. Future growth.
10. Metadata overhead.
11. File handle dan segment count.
12. Operational limits di managed Kafka.

---

### 12.2 Starting Formula Sederhana

Secara kasar:

```text
required_partitions >= max(
  producer_throughput_needed / throughput_per_partition_write,
  consumer_throughput_needed / throughput_per_partition_read,
  desired_max_parallel_consumers
)
```

Tapi ini hanya titik awal. Harus diuji dengan workload nyata.

---

### 12.3 Contoh Sizing

Misal:

```text
Target write throughput: 120 MB/s
Sustainable per partition write: 8 MB/s
Target consumer parallelism: 24
```

Maka:

```text
120 / 8 = 15 partition minimum dari sisi write
consumer parallelism = 24
```

Pilih minimal:

```text
24 partition
```

Tapi kemudian cek:

1. Apakah key distribution merata?
2. Apakah broker cukup?
3. Apakah replication factor 3 membuat total replica = 72?
4. Apakah retention storage cukup?
5. Apakah consumer group rebalance cost dapat diterima?

---

### 12.4 Terlalu Sedikit Partition

Risiko:

1. Throughput terbatas.
2. Consumer parallelism terbatas.
3. Satu partition bisa terlalu besar.
4. Recovery lambat.
5. Hot key lebih terasa.

---

### 12.5 Terlalu Banyak Partition

Risiko:

1. Metadata lebih besar.
2. Leader election lebih banyak.
3. Open file handle lebih banyak.
4. Memory overhead broker naik.
5. Rebalance consumer group lebih mahal.
6. Latency bisa meningkat.
7. Banyak partition kecil membuat batching kurang efisien.
8. Operational complexity meningkat.

Partition count harus cukup, bukan sebanyak mungkin.

---

## 13. Menambah Partition Setelah Production

### 13.1 Yang Terjadi Saat Partition Ditambah

Jika topic dinaikkan dari 6 ke 12 partition, record baru dapat diarahkan ke partition baru.

Untuk keyed record, mapping hash modulo partition count bisa berubah.

Dampak:

```text
Event lama untuk key K ada di partition lama.
Event baru untuk key K bisa masuk partition baru.
```

Akibatnya ordering per key sepanjang sejarah tidak lagi dijamin jika producer menggunakan default hash-to-partition mapping.

---

### 13.2 Kapan Relatif Aman

Menambah partition relatif aman jika:

1. Topic memakai null key dan tidak butuh ordering per entity.
2. Topic hanya dipakai untuk telemetry/log/firehose.
3. Consumer tidak mengandalkan per-key historical ordering.
4. Backfill/replay ordering tidak penting.
5. Semua downstream memahami perubahan.

---

### 13.3 Kapan Berbahaya

Berbahaya jika:

1. Topic lifecycle event keyed by aggregate id.
2. Consumer melakukan stateful processing per key.
3. Kafka Streams/KTable bergantung pada key partitioning.
4. Event harus replayable secara urut per entity dari awal.
5. Audit reconstruction bergantung pada partition order.

---

### 13.4 Alternatif Jika Butuh Scale

Alih-alih menambah partition sembarangan:

1. Buat topic baru versi baru dengan partition count lebih besar.
2. Migrasikan producer ke topic baru.
3. Jalankan dual publish sementara jika perlu.
4. Backfill dari topic lama ke topic baru dengan strategi ordering jelas.
5. Migrasikan consumer bertahap.
6. Deprecate topic lama.

Contoh:

```text
case-events-v1: 12 partitions
case-events-v2: 48 partitions
```

Namun versioning topic juga punya biaya governance.

---

## 14. Partitioning dan Consumer Group

### 14.1 Partition Ownership

Dalam satu consumer group:

```text
satu partition -> maksimal satu consumer aktif
satu consumer -> bisa memiliki banyak partition
```

Jika partition count = 10:

```text
maksimal consumer aktif = 10
```

---

### 14.2 Scaling Consumer

Jika consumer lambat karena CPU per record tinggi, menambah instance hanya membantu sampai jumlah consumer mencapai jumlah partition.

Jika bottleneck satu partition hot, menambah consumer tidak membantu.

---

### 14.3 Multiple Consumer Groups

Partition count membatasi parallelism per consumer group, tetapi banyak consumer group bisa membaca topic yang sama.

Contoh:

```text
case-events
  group: case-projection-service
  group: audit-indexer
  group: notification-service
  group: fraud-detection
```

Setiap group punya offset masing-masing.

---

### 14.4 Consumer Group Rebalance Cost

Semakin banyak partition dan consumer, semakin besar biaya assignment dan state movement saat rebalance.

Untuk stateless consumer, dampaknya mungkin kecil.

Untuk stateful Kafka Streams, rebalance bisa memicu state restore dan berdampak besar.

---

## 15. Partitioning dan Kafka Streams / ksqlDB

Partitioning menjadi lebih kritis dalam stream processing.

### 15.1 Co-Partitioning

Join antar stream/table sering membutuhkan data dengan key yang sama berada pada partition yang koresponding.

Contoh:

```text
orders topic: key = customerId
payments topic: key = customerId
```

Jika partition count dan partitioning kompatibel, join lebih natural.

Jika tidak, Kafka Streams/ksqlDB mungkin perlu repartition topic internal.

---

### 15.2 Repartitioning Cost

Repartitioning berarti:

1. Membaca record.
2. Mengubah key.
3. Menulis ke internal repartition topic.
4. Membaca ulang dari topic tersebut.

Dampak:

1. Latency bertambah.
2. Storage bertambah.
3. Network bertambah.
4. Failure surface bertambah.
5. Operasional lebih kompleks.

---

### 15.3 KTable dan Key Semantics

Untuk KTable, key merepresentasikan identity state.

Jika key salah, table state salah.

Contoh buruk:

```text
customer-profile topic key = eventId
```

KTable akan menganggap setiap event sebagai row berbeda.

Lebih tepat:

```text
customer-profile topic key = customerId
```

---

## 16. Partitioning untuk CDC

CDC topic sering dibuat berdasarkan table.

Contoh:

```text
dbserver1.public.case
```

Key biasanya primary key table.

### 16.1 Kenapa Primary Key Masuk Akal

Untuk perubahan row:

```text
INSERT case-1
UPDATE case-1
UPDATE case-1
DELETE case-1
```

Ordering per row penting. Primary key menjaga perubahan row masuk partition yang sama.

---

### 16.2 CDC Bukan Domain Event

CDC event biasanya merepresentasikan perubahan row, bukan event domain.

```text
row updated
```

Bukan:

```text
case escalated
```

Jangan menganggap partitioning CDC otomatis cocok untuk semua domain consumer.

Kadang perlu transformasi dari CDC/raw table topic ke curated domain event topic.

---

### 16.3 Outbox Topic

Untuk outbox pattern, key biasanya aggregate id.

Contoh outbox row:

```json
{
  "eventId": "evt-1",
  "aggregateType": "Case",
  "aggregateId": "case-123",
  "eventType": "CASE_ESCALATED",
  "payload": {...}
}
```

Key Kafka yang baik:

```text
aggregateId
```

Atau:

```text
aggregateType:aggregateId
```

---

## 17. Partitioning untuk Regulatory / Case Management Systems

Karena kamu bekerja di konteks regulatory systems, bagian ini penting.

### 17.1 Case Lifecycle Topic

Topic:

```text
case-lifecycle-events
```

Event:

```text
CASE_CREATED
CASE_ASSIGNED
EVIDENCE_REQUESTED
EVIDENCE_SUBMITTED
CASE_REVIEWED
CASE_ESCALATED
CASE_RESOLVED
CASE_CLOSED
```

Ordering domain:

```text
per case
```

Key:

```text
caseId
```

Alasan:

1. Lifecycle satu case harus bisa direkonstruksi secara urut.
2. State machine case consumer butuh transition yang konsisten.
3. Audit replay harus deterministik.
4. Escalation logic bergantung pada state sebelumnya.

---

### 17.2 Evidence Events

Topic:

```text
evidence-events
```

Ordering domain bisa berbeda.

Jika evidence harus urut per case:

```text
key = caseId
```

Jika evidence processing independen per evidence item:

```text
key = evidenceId
```

Jika evidence item bisa sangat besar atau prosesnya berat, pisahkan metadata event dari blob storage.

Kafka record bukan tempat ideal untuk file besar.

---

### 17.3 Assignment Events

Topic:

```text
case-assignment-events
```

Pertanyaan:

```text
Apakah ordering perlu per case atau per officer?
```

Jika ingin memastikan assignment lifecycle satu case urut:

```text
key = caseId
```

Jika ingin membangun workload projection per officer:

```text
key = officerId
```

Namun jika satu topic dipakai untuk dua kebutuhan ordering berbeda, itu tanda mungkin perlu derived topic/projection.

---

### 17.4 SLA / Escalation Events

Topic:

```text
case-sla-events
```

Key yang umum:

```text
caseId
```

Tetapi untuk scheduler/timer workload, partitioning bisa berdasarkan bucket waktu:

```text
dueDateBucket
```

Trade-off:

1. Key `caseId` menjaga lifecycle per case.
2. Key `dueDateBucket` membantu batch processing berdasarkan waktu.
3. Untuk correctness state machine, `caseId` biasanya lebih aman.
4. Untuk timer scanning, gunakan topic/projection terpisah.

---

### 17.5 Audit Events

Audit topic bisa punya kebutuhan berbeda:

```text
regulatory-audit-events
```

Jika audit reconstruction per case:

```text
key = caseId
```

Jika audit query utama per actor:

```text
key = actorId
```

Jika audit query utama per tenant:

```text
key = tenantId:caseId
```

Audit sering butuh banyak access pattern. Jangan memaksakan satu topic untuk semua. Gunakan stream processing untuk membuat projection/index topic sesuai kebutuhan.

---

## 18. Multi-Tenant Partitioning

Multi-tenant system sering menghadapi tension:

```text
isolation per tenant
vs
load balancing across tenants
```

### 18.1 Key = tenantId

Kelebihan:

1. Semua event tenant urut.
2. Mudah enforce tenant-level ordering.
3. Mudah observability per tenant.

Kekurangan:

1. Tenant besar menjadi hot key.
2. Parallelism tenant besar terbatas satu partition.
3. Tenant kecil tidak memanfaatkan cluster optimal.

---

### 18.2 Key = tenantId:aggregateId

Kelebihan:

1. Ordering per aggregate tetap aman.
2. Tenant besar tersebar berdasarkan aggregate.
3. Cocok untuk case/order/account lifecycle.

Kekurangan:

1. Tidak ada ordering global per tenant.
2. Tenant-level reporting perlu aggregation downstream.

Biasanya ini pilihan lebih sehat untuk platform multi-tenant.

---

### 18.3 Key = aggregateId Saja

Kelebihan:

1. Simpel.
2. Distribusi mungkin baik jika aggregate id global unique.

Kekurangan:

1. Jika aggregate id tidak global unique, collision semantic terjadi.
2. Observability tenant lebih sulit dari key.
3. Governance multi-tenant kurang eksplisit.

---

### 18.4 Dedicated Topic per Large Tenant

Cocok jika:

1. Tenant besar punya SLA khusus.
2. Traffic tenant sangat dominan.
3. Perlu isolation compliance.
4. Perlu retention/security berbeda.

Tidak cocok jika:

1. Jumlah tenant sangat banyak.
2. Platform belum punya topic governance kuat.
3. Consumer tidak siap subscribe pattern banyak topic.

---

## 19. Hash Stability dan Partition Mapping

### 19.1 Mengapa Hash Stability Penting

Kafka default partitioning dengan key bergantung pada hash key dan jumlah partition.

Jika producer di service berbeda mengirim key yang sama tetapi serialization key berbeda, hasil hash bisa berbeda.

Contoh:

```text
"case-123" sebagai string UTF-8
vs
{"caseId":"case-123"} sebagai JSON bytes
```

Walaupun secara domain sama, bytes key berbeda, hash berbeda, partition bisa berbeda.

---

### 19.2 Rule

Untuk satu topic, tetapkan:

```text
key schema
key serialization
key semantic
key compatibility rule
```

Jangan hanya mendefinisikan value schema.

Key adalah bagian dari contract.

---

## 20. Custom Partitioner

### 20.1 Kapan Perlu

Custom partitioner bisa dipertimbangkan jika:

1. Butuh routing berdasarkan metadata kompleks.
2. Butuh isolate tenant tertentu ke partition range khusus.
3. Butuh affinity dengan external shard.
4. Butuh load-aware routing khusus.
5. Butuh backward-compatible partition mapping saat partition count bertambah.

---

### 20.2 Kapan Jangan

Jangan gunakan custom partitioner jika alasanmu hanya:

1. “Biar lebih canggih.”
2. “Agar distribusi terlihat rata.”
3. “Agar bisa handle semua use case dalam satu topic.”
4. “Karena default partitioner tidak dipahami.”

Default partitioning biasanya cukup jika key design benar.

---

### 20.3 Risiko Custom Partitioner

1. Harus tersedia di semua producer.
2. Harus versioned.
3. Harus deterministic.
4. Harus diuji dengan property-based testing.
5. Harus punya fallback behavior.
6. Harus diamati distribusinya di production.
7. Harus dipahami saat incident.

---

### 20.4 Skeleton Java Custom Partitioner

```java
import org.apache.kafka.clients.producer.Partitioner;
import org.apache.kafka.common.Cluster;
import org.apache.kafka.common.PartitionInfo;
import org.apache.kafka.common.utils.Utils;

import java.util.List;
import java.util.Map;

public final class TenantAwarePartitioner implements Partitioner {

    @Override
    public void configure(Map<String, ?> configs) {
        // Load routing rules carefully.
        // Avoid remote calls. Partitioner must be fast and deterministic.
    }

    @Override
    public int partition(
            String topic,
            Object key,
            byte[] keyBytes,
            Object value,
            byte[] valueBytes,
            Cluster cluster
    ) {
        List<PartitionInfo> partitions = cluster.partitionsForTopic(topic);
        int partitionCount = partitions.size();

        if (keyBytes == null) {
            // Fallback: use a deterministic safe choice, or delegate to default logic in real design.
            return 0;
        }

        return Utils.toPositive(Utils.murmur2(keyBytes)) % partitionCount;
    }

    @Override
    public void close() {
        // Clean resources if any, though ideally none.
    }
}
```

Important warning:

```text
A custom partitioner must not call database, HTTP service, or remote config on the hot path.
```

Partitioning happens for every produced record. Slow partitioner means slow producer.

---

## 21. Advanced Pattern: Stable Virtual Buckets

Salah satu problem default hash modulo adalah mapping berubah saat partition count berubah.

Pattern alternatif:

```text
key -> virtual bucket -> physical partition
```

Contoh:

```text
caseId -> hash(caseId) % 1024 virtual buckets
virtual bucket -> mapped to Kafka partition
```

Jika partition count berubah, mapping virtual bucket ke partition bisa dikontrol.

Trade-off:

1. Perlu custom partitioner.
2. Perlu mapping table/versioning.
3. Perlu semua producer konsisten.
4. Operasional lebih kompleks.

Pattern ini hanya layak untuk platform besar dengan kebutuhan scale dan compatibility tinggi.

---

## 22. Decision Matrix

| Requirement | Recommended key strategy | Catatan |
|---|---|---|
| Lifecycle per case harus urut | `caseId` | Default untuk case management |
| Multi-tenant lifecycle per case | `tenantId:caseId` | Baik untuk isolation semantic |
| Log/metrics tanpa ordering | null key | Manfaatkan sticky batching |
| CDC table row changes | primary key row | Cocok untuk row-level ordering |
| Outbox domain event | `aggregateType:aggregateId` | Cocok untuk domain event |
| Tenant besar hot | `tenantId:aggregateId` atau topic split | Hindari key hanya `tenantId` |
| Entity sangat hot | bucketed key | Mengorbankan global ordering per entity |
| Need join Kafka Streams | key join field | Hindari repartition mahal |
| Audit reconstruction per case | `caseId` | Deterministic replay |
| Query projection per actor | derived topic key `actorId` | Jangan paksa source topic berubah |

---

## 23. Anti-Patterns

### 23.1 Key by Event Type

```text
key = CASE_CREATED
key = CASE_ESCALATED
```

Ini hampir selalu salah untuk lifecycle event.

---

### 23.2 Key by Status

```text
key = OPEN
key = CLOSED
```

Cardinality rendah, hot partition, ordering lifecycle rusak.

---

### 23.3 Key by Timestamp

```text
key = 2026-06-19T10:00:00Z
```

Biasanya menyebabkan burst ke key/bucket waktu tertentu dan tidak menjaga entity ordering.

---

### 23.4 Random Key untuk Mengatasi Hot Partition

Random key memang meratakan load, tetapi menghapus ordering.

Ini bukan solusi jika ordering domain penting.

---

### 23.5 One Topic to Rule Them All

Topic besar berisi semua event:

```text
platform-events
```

Masalah:

1. Partitioning key tidak bisa cocok untuk semua event type.
2. Retention tidak bisa optimal untuk semua.
3. Schema governance kacau.
4. Consumer harus filter banyak event tidak relevan.
5. Hot event type mengganggu event lain.

---

### 23.6 Too Many Tiny Topics untuk Menghindari Partitioning

Sebaliknya, membuat topic terlalu granular juga buruk:

```text
case-created-events
case-assigned-events
case-escalated-events
case-closed-events
```

Jika lifecycle reconstruction butuh semua event, kamu kehilangan log lifecycle yang natural.

Topic split harus mengikuti contract dan lifecycle, bukan hanya event type.

---

## 24. Practical Java Producer Configuration

Contoh producer untuk keyed lifecycle event:

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, "io.confluent.kafka.serializers.KafkaAvroSerializer");

props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
props.put(ProducerConfig.LINGER_MS_CONFIG, "10");
props.put(ProducerConfig.BATCH_SIZE_CONFIG, Integer.toString(64 * 1024));

KafkaProducer<String, CaseEvent> producer = new KafkaProducer<>(props);

String key = event.caseId();
ProducerRecord<String, CaseEvent> record = new ProducerRecord<>(
        "case-lifecycle-events",
        key,
        event
);

producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        // Log with event id, case id, topic, and failure category.
        // Do not silently drop.
        return;
    }

    // metadata.partition() is useful for debugging distribution.
});
```

Important:

```text
The key is part of the business correctness model.
Do not set it casually.
```

---

## 25. Testing Partitioning

### 25.1 Unit Test Key Selection

```java
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CaseEventKeyTest {

    @Test
    void lifecycleEventsShouldBeKeyedByCaseId() {
        CaseEvent event = new CaseEscalatedEvent(
                "case-123",
                "evt-999",
                "HIGH"
        );

        String key = CaseEventKey.of(event);

        assertThat(key).isEqualTo("case-123");
    }
}
```

---

### 25.2 Distribution Test

```java
@Test
void keysShouldDistributeReasonablyAcrossPartitions() {
    int partitions = 24;
    int[] counts = new int[partitions];

    for (int i = 0; i < 1_000_000; i++) {
        String key = "case-" + i;
        int partition = positiveMurmur2(key.getBytes(StandardCharsets.UTF_8)) % partitions;
        counts[partition]++;
    }

    int min = Arrays.stream(counts).min().orElseThrow();
    int max = Arrays.stream(counts).max().orElseThrow();

    double skewRatio = (double) max / min;
    assertThat(skewRatio).isLessThan(1.20);
}
```

Ini bukan pengganti production observability, tetapi membantu mendeteksi key design yang jelas buruk.

---

### 25.3 Property-Based Test untuk Composite Key

Invariant:

```text
Semua event dengan tenantId dan caseId yang sama harus menghasilkan key yang sama.
```

Contoh assertion:

```java
assert key(event1).equals(key(event2));
```

Untuk:

```text
event1 = CASE_CREATED tenant=A case=123
event2 = CASE_ESCALATED tenant=A case=123
```

---

## 26. Operational Metrics Checklist

Pantau minimal:

```text
records-in-rate per partition
bytes-in-rate per partition
bytes-out-rate per partition
consumer lag per partition
leader distribution per broker
under-replicated partitions
produce request latency
fetch request latency
consumer processing time by partition
record key top-N volume if safe
```

Application-level metric yang sangat membantu:

```text
events_by_logical_key_hash_bucket
```

Misalnya hash key ke 100 bucket lalu ukur distribusi. Ini membantu melihat skew tanpa mengekspos raw key sensitif.

---

## 27. Partitioning Design Review Template

Gunakan template ini sebelum membuat topic production.

```markdown
# Kafka Partitioning Decision

## Topic
`case-lifecycle-events`

## Business Purpose
Menyimpan event lifecycle case untuk workflow, projection, audit replay, dan escalation processing.

## Ordering Requirement
Event harus urut per `caseId`.

## Selected Key
`caseId`

## Why This Key
- Semua transition satu case harus masuk partition yang sama.
- Consumer state machine memerlukan ordered transition.
- Audit reconstruction per case harus deterministik.

## Cardinality Analysis
- Expected active cases: 5 million/year.
- Expected high-traffic case: investigasi kompleks bisa menghasilkan ratusan event, tetapi tidak dominan secara global.

## Skew Risk
- Risiko tenant besar menghasilkan banyak case.
- Karena key adalah caseId, tenant besar tetap tersebar antar case.

## Partition Count
Initial: 48 partitions.
Rationale:
- Target max consumer parallelism 48.
- Write throughput estimate X MB/s.
- Retention estimate Y TB.

## Repartition Risk
Menambah partition dapat mengubah key mapping. Jika perlu scale besar, pertimbangkan topic v2 migration.

## Consumer Groups
- case-projection-service
- escalation-service
- audit-indexer
- notification-service

## Failure Considerations
- Hot case dapat membuat satu partition lag.
- Duplicate events harus ditangani idempotently.
- Consumer rebalance dapat memproses ulang event.

## Observability
- Lag per partition.
- Throughput per partition.
- Top hashed key bucket.
- Processing time per partition.
```

---

## 28. Worked Example: Designing `case-lifecycle-events`

### 28.1 Requirement

Sistem regulatory case management perlu mengirim event lifecycle case:

```text
CASE_CREATED
CASE_ASSIGNED
EVIDENCE_ADDED
CASE_ESCALATED
CASE_REVIEWED
CASE_CLOSED
```

Consumer:

1. Case projection service.
2. Audit indexer.
3. SLA escalation service.
4. Notification service.
5. Analytics sink.

---

### 28.2 Candidate Keys

| Candidate key | Evaluation |
|---|---|
| `eventId` | Buruk. Ordering per case hilang. |
| `eventType` | Buruk. Cardinality rendah dan lifecycle tercerai. |
| `tenantId` | Berisiko hot tenant dan parallelism rendah. |
| `caseId` | Baik jika caseId global unique. |
| `tenantId:caseId` | Baik jika caseId unik per tenant atau tenant isolation penting. |
| null | Buruk untuk lifecycle ordering. |

---

### 28.3 Decision

Gunakan:

```text
key = tenantId:caseId
```

Jika `caseId` sudah global unique dan tenant selalu tersedia di value, `caseId` saja juga bisa diterima. Namun untuk regulatory multi-tenant platform, composite key sering lebih eksplisit.

---

### 28.4 Partition Count

Mulai dengan:

```text
48 partitions
replication factor 3
```

Alasan:

1. Cukup untuk parallelism beberapa service.
2. Tidak terlalu besar untuk cluster menengah.
3. Memberi ruang growth tanpa langsung ratusan partition.

Namun angka nyata harus divalidasi dengan benchmark workload.

---

### 28.5 Consequence

Kelebihan:

1. Semua event satu case urut.
2. Consumer state machine aman.
3. Replay audit per case deterministik.
4. Tenant besar tetap tersebar karena case berbeda.

Kekurangan:

1. Tidak ada ordering global per tenant.
2. Query per officer/actor perlu projection lain.
3. Jika satu case sangat aktif, tetap bisa hot key.

---

## 29. Thought Exercises

### Exercise 1 — Payment Topic

Topic:

```text
payment-events
```

Events:

```text
PAYMENT_INITIATED
PAYMENT_AUTHORIZED
PAYMENT_CAPTURED
PAYMENT_FAILED
PAYMENT_REFUNDED
```

Pertanyaan:

1. Apa ordering domain?
2. Key apa yang akan kamu pilih?
3. Apa risiko jika key = customerId?
4. Apa risiko jika key = paymentId?

Jawaban yang diharapkan:

```text
Ordering domain biasanya per paymentId.
Key paymentId menjaga lifecycle satu payment.
Key customerId menjaga ordering semua payment customer, tetapi bisa mengurangi parallelism dan membuat customer besar hot.
```

---

### Exercise 2 — Audit Topic

Topic:

```text
user-activity-events
```

Use case:

1. Security detection per user.
2. Analytics global.
3. Audit per tenant.

Pertanyaan:

```text
Apakah satu topic dengan satu key cukup?
```

Jawaban:

Tidak selalu. Source topic bisa keyed by `userId` untuk security per user. Projection/derived topic bisa keyed by `tenantId` atau `tenantId:userId` untuk audit tenant.

---

### Exercise 3 — Hot Tenant

Kamu punya topic:

```text
tenant-events
key = tenantId
```

Satu tenant menghasilkan 80% traffic.

Pertanyaan:

1. Mengapa menambah consumer tidak menyelesaikan masalah?
2. Alternatif key apa?
3. Apa trade-off-nya?

Jawaban:

Menambah consumer tidak menyelesaikan karena semua event tenant tersebut tetap satu partition. Alternatif: `tenantId:aggregateId`, dedicated topic, atau bucketed key. Trade-off: ordering global per tenant hilang atau operasional lebih kompleks.

---

## 30. Production Failure Modes

### 30.1 Partition Count Terlalu Rendah

Gejala:

```text
consumer lag tinggi
consumer idle tidak bisa ditambah efektif
throughput mentok
```

Root cause:

```text
parallelism dibatasi partition count
```

---

### 30.2 Key Salah Setelah Deployment

Gejala:

```text
state machine menerima CASE_CLOSED sebelum CASE_CREATED
projection tidak konsisten
replay menghasilkan state berbeda
```

Root cause:

```text
event satu aggregate tersebar ke partition berbeda
```

---

### 30.3 Hot Partition

Gejala:

```text
lag hanya tinggi di satu partition
broker leader tertentu overload
consumer tertentu CPU tinggi
```

Root cause:

```text
hot key atau low-cardinality key
```

---

### 30.4 Partition Ditambah dan Ordering Pecah

Gejala:

```text
setelah partition increase, event baru untuk key lama muncul di partition berbeda
replay tidak deterministik
consumer stateful salah hasil
```

Root cause:

```text
hash modulo partition count berubah
```

---

### 30.5 Custom Partitioner Bug

Gejala:

```text
producer Java dan Node mengirim key sama ke partition berbeda
consumer join gagal
lag tidak merata
```

Root cause:

```text
custom routing logic tidak konsisten antar producer
```

---

## 31. Checklist

Sebelum membuat topic production, jawab:

```text
[ ] Apa business purpose topic ini?
[ ] Apa event contract-nya?
[ ] Apa ordering domain-nya?
[ ] Apakah ordering domain benar-benar perlu?
[ ] Apa selected key?
[ ] Apakah key stabil?
[ ] Apakah key cardinality cukup tinggi?
[ ] Apakah key traffic distribution cukup merata?
[ ] Apakah key mengandung data sensitif?
[ ] Apakah key serialization didefinisikan?
[ ] Apakah partition count dipilih berdasarkan throughput dan consumer parallelism?
[ ] Apakah risiko menambah partition sudah dipahami?
[ ] Apakah consumer group yang membaca topic sudah diketahui?
[ ] Apakah Kafka Streams/ksqlDB join membutuhkan co-partitioning?
[ ] Apakah observability per partition tersedia?
[ ] Apakah ada mitigasi untuk hot key?
[ ] Apakah ada decision record?
```

---

## 32. Ringkasan

Partitioning adalah salah satu keputusan paling fundamental dalam Kafka. Topic menentukan **jenis stream**, tetapi partitioning menentukan **bagaimana stream itu diskalakan dan dijaga ordering-nya**.

Prinsip utama:

1. Kafka hanya menjamin ordering di dalam partition.
2. Key menentukan partition jika partition tidak ditentukan eksplisit.
3. Pilih key berdasarkan ordering domain.
4. Jangan gunakan key rendah cardinality seperti status/event type.
5. Null key cocok untuk workload yang tidak butuh ordering per entity.
6. Hot key tidak bisa diselesaikan hanya dengan menambah consumer.
7. Menambah partition setelah production bisa memecah historical key ordering.
8. Untuk lifecycle event, key biasanya aggregate id seperti `caseId`, `orderId`, atau `paymentId`.
9. Untuk multi-tenant lifecycle, composite key seperti `tenantId:aggregateId` sering lebih aman.
10. Custom partitioner adalah alat advanced, bukan default.

Kalimat yang perlu diingat:

```text
Partitioning is not a throughput knob only.
Partitioning is the boundary between ordering and parallelism.
```

---

## 33. Referensi

Referensi yang relevan untuk bagian ini:

1. Apache Kafka Documentation — Introduction, topics, partitions, replication, and producer behavior.
2. Apache Kafka Producer Configs — `partitioner.class`, default partitioning logic, key-based partition selection, sticky partitioning.
3. Confluent Producer Configuration Reference — partitioner behavior and sticky partitioning.
4. Confluent Kafka partition key guide — key hashing and partition assignment.
5. Kafka design documentation — partition as unit of log ordering, replication, and parallelism.

---

## 34. Status Seri

```text
Status: belum selesai
Progress: Part 000 sampai Part 005 selesai
Part saat ini: Part 005 — Partitioning Strategy
Part berikutnya: Part 006 — Consumers Deep Dive: Poll Loop, Offset Management, Fetching, and Backpressure
Total rencana: Part 000 sampai Part 034
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — Producers Deep Dive: Batching, Compression, Acks, Idempotence, and Throughput</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-006.md">Part 006 — Consumers Deep Dive: Poll Loop, Offset Management, Fetching, and Backpressure ➡️</a>
</div>

# learn-kafka-event-streaming-mastery-for-java-engineers-part-001.md

# Part 001 — The Log Mental Model: Topics, Partitions, Offsets, and Ordering

> Seri: Kafka, Kafka Connect, ksqlDB, Kafka Streams, dan Event Streaming Mastery untuk Java Software Engineer  
> Fokus: memahami Kafka sebagai **distributed append-only log**, bukan sekadar queue.  
> Status seri: Part 001 dari 034. Seri belum selesai.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa menjelaskan Kafka dengan mental model yang jauh lebih presisi daripada “message broker”. Secara khusus, kamu harus mampu:

1. Menjelaskan Kafka sebagai **log terpartisi**.
2. Membedakan **topic**, **partition**, **record**, dan **offset** secara konseptual dan praktis.
3. Memahami kenapa ordering Kafka kuat di dalam partition, tetapi tidak global di seluruh topic.
4. Mendesain key record berdasarkan **ordering domain** bisnis.
5. Menjelaskan konsekuensi jumlah partition terhadap throughput, ordering, consumer parallelism, storage, dan operasional.
6. Memahami bahwa offset adalah **posisi dalam log**, bukan ID bisnis.
7. Memahami bagaimana retention membuat Kafka berbeda dari queue tradisional.
8. Menghindari anti-pattern umum seperti menganggap Kafka message akan hilang setelah dibaca, membuat topic terlalu generic, memakai key asal-asalan, atau mengharapkan global order dari multi-partition topic.
9. Membangun fondasi untuk part berikutnya: broker internals, producer, consumer, consumer group, compaction, stream processing, Connect, dan ksqlDB.

---

## 2. Masalah Mental Model: Mengapa Banyak Engineer Salah Memahami Kafka

Banyak engineer pertama kali mendekati Kafka dengan analogi yang terlalu sederhana:

```text
Kafka = message queue besar
```

Analogi ini berguna selama beberapa menit pertama, tetapi cepat menjadi jebakan.

Queue tradisional biasanya dipahami seperti ini:

```text
producer -> queue -> consumer

message dikirim
message diambil consumer
message selesai
message hilang atau di-ack sebagai selesai
```

Kafka bekerja dengan model yang berbeda:

```text
producer -> append record ke log
consumer -> membaca posisi tertentu dari log
record tetap tersimpan selama retention policy mengizinkan
consumer hanya menyimpan progress baca melalui offset
```

Perbedaannya fundamental.

Dalam Kafka, consumer **tidak mengambil lalu menghapus** record. Consumer membaca log pada posisi tertentu. Record tetap ada, sehingga consumer lain dapat membaca record yang sama, consumer lama dapat replay, dan sistem baru dapat melakukan bootstrap dari histori event.

Kafka lebih mirip:

```text
append-only commit log yang bisa dibaca banyak pembaca secara independen
```

daripada:

```text
antrian kerja yang item-nya habis setelah diproses
```

Perubahan mental model ini memengaruhi seluruh desain:

- cara memilih key,
- cara menentukan partition,
- cara menghitung parallelism,
- cara mendesain retry,
- cara replay data,
- cara membangun audit trail,
- cara menghubungkan Kafka dengan database,
- cara membuat consumer idempotent,
- cara memahami lag,
- cara menghindari data loss dan duplicate processing.

Kalau mental model log belum kuat, konfigurasi Kafka akan terlihat seperti kumpulan parameter acak. Kalau mental model log kuat, banyak konfigurasi Kafka menjadi konsekuensi yang masuk akal.

---

## 3. Kafka sebagai Append-Only Log

### 3.1 Apa itu log?

Dalam konteks Kafka, log adalah urutan record yang hanya bertambah di akhir.

Secara sederhana:

```text
partition log:

offset 0  -> record A
offset 1  -> record B
offset 2  -> record C
offset 3  -> record D
offset 4  -> record E
```

Operasi utamanya adalah:

```text
append(record)
```

Bukan:

```text
insert at arbitrary position
update existing record
remove after read
```

Karakter append-only ini memberikan beberapa sifat penting:

1. **Ordering lokal jelas**  
   Record yang masuk ke partition yang sama memiliki urutan offset.

2. **Write path efisien**  
   Broker dapat menulis secara sekuensial ke file log.

3. **Replay memungkinkan**  
   Consumer bisa membaca ulang dari offset lama selama data masih disimpan.

4. **Multiple independent readers**  
   Banyak consumer group bisa membaca log yang sama tanpa saling menghapus data.

5. **Auditability lebih kuat**  
   Event historis dapat dipertahankan sebagai fakta yang pernah terjadi.

### 3.2 Log bukan table

Table menyimpan state terbaru:

```text
case_id = C-1001
status  = CLOSED
```

Log menyimpan perubahan atau fakta dari waktu ke waktu:

```text
0: CaseCreated(caseId=C-1001)
1: CaseAssigned(caseId=C-1001, assignee=Ayu)
2: EvidenceSubmitted(caseId=C-1001)
3: CaseEscalated(caseId=C-1001)
4: DecisionIssued(caseId=C-1001)
5: CaseClosed(caseId=C-1001)
```

Table menjawab:

```text
Apa state sekarang?
```

Log menjawab:

```text
Apa saja yang terjadi, dalam urutan apa, sehingga state sekarang terbentuk?
```

Untuk sistem regulasi, case management, enforcement lifecycle, fraud workflow, audit trail, atau compliance, kemampuan kedua sering jauh lebih penting daripada sekadar mengetahui state terbaru.

---

## 4. Record: Unit Data Terkecil di Kafka

Kafka record biasanya memiliki struktur konseptual seperti ini:

```text
record = {
  topic: "case.lifecycle.events",
  partition: 3,
  offset: 928177,
  key: "CASE-2026-000123",
  value: {...event payload...},
  headers: {...metadata...},
  timestamp: "2026-06-19T10:15:20Z"
}
```

Komponen penting:

| Komponen | Fungsi |
|---|---|
| Topic | Nama stream/log secara logical |
| Partition | Sub-log fisik/logical di dalam topic |
| Offset | Posisi record di dalam partition |
| Key | Dasar routing ke partition dan ordering domain |
| Value | Payload event/message |
| Headers | Metadata tambahan tanpa mengubah payload utama |
| Timestamp | Waktu record, bisa event time atau append/create time tergantung konfigurasi |

### 4.1 Key bukan sekadar metadata

Di Kafka, key sangat penting karena biasanya menentukan partition.

Contoh:

```text
key = caseId
```

Jika semua event untuk `CASE-123` memakai key yang sama, maka semua event itu akan masuk ke partition yang sama. Karena Kafka menjaga urutan di dalam partition, consumer akan melihat event untuk case tersebut dalam urutan append yang konsisten.

```text
case.lifecycle.events partition 2:

100 -> CaseCreated(CASE-123)
101 -> CaseAssigned(CASE-123)
102 -> EvidenceSubmitted(CASE-123)
103 -> CaseEscalated(CASE-123)
104 -> CaseClosed(CASE-123)
```

Kalau key tidak konsisten, event untuk entity yang sama bisa tersebar ke beberapa partition.

```text
partition 1:
100 -> CaseCreated(CASE-123)

partition 7:
210 -> CaseClosed(CASE-123)

partition 4:
302 -> EvidenceSubmitted(CASE-123)
```

Dari sudut pandang topic global, tidak ada urutan tunggal yang aman. Consumer parallel bisa memproses `CaseClosed` sebelum `EvidenceSubmitted`, tergantung scheduling, fetch, dan processing time.

### 4.2 Value adalah fakta bisnis, bukan instruksi teknis semata

Bad event:

```json
{
  "operation": "UPDATE",
  "table": "case",
  "id": "CASE-123",
  "fields": {
    "status": "ESCALATED"
  }
}
```

Lebih baik:

```json
{
  "eventType": "CaseEscalated",
  "eventId": "evt-839d...",
  "caseId": "CASE-123",
  "escalationLevel": "LEVEL_2",
  "reason": "SLA_BREACH",
  "occurredAt": "2026-06-19T10:15:20Z"
}
```

Yang kedua membawa makna domain. Kafka bukan hanya transport byte. Kafka sering menjadi kontrak integrasi lintas sistem. Kalau event-nya miskin makna, downstream akan menebak-nebak.

---

## 5. Topic: Nama Log Secara Logical

Topic adalah stream/log bernama.

Contoh topic:

```text
case.lifecycle.events
case.assignment.events
evidence.ingestion.events
enforcement.decision.events
notification.commands
payment.transaction.events
customer.profile.changelog
```

Topic bukan table, walaupun kadang satu topic bisa merepresentasikan perubahan pada satu aggregate atau satu entity type.

### 5.1 Topic sebagai kontrak publik

Untuk aplikasi kecil, topic mungkin terlihat seperti konfigurasi teknis. Untuk organisasi besar, topic adalah API publik.

Topic menentukan:

- siapa producer yang boleh menulis,
- siapa consumer yang boleh membaca,
- schema apa yang berlaku,
- retention berapa lama,
- apakah data compacted atau delete-retained,
- apakah topic berisi fakta domain, command, changelog, atau integration event,
- siapa owner topic,
- bagaimana topic akan berevolusi.

Karena itu, topic sebaiknya diperlakukan seperti API contract.

### 5.2 Topic terlalu besar vs terlalu kecil

Bad design 1: satu topic generic untuk semua hal.

```text
all-events
```

Masalah:

- schema campur aduk,
- consumer harus filter banyak event tidak relevan,
- ownership kabur,
- retention tidak bisa spesifik,
- ACL kasar,
- evolusi schema sulit,
- incident blast radius besar.

Bad design 2: topic terlalu granular tanpa alasan.

```text
case-created-events
case-assigned-events
case-escalated-events
case-closed-events
case-reopened-events
case-comment-added-events
case-note-edited-events
```

Masalah:

- consumer yang butuh lifecycle lengkap harus subscribe banyak topic,
- ordering antar event berbeda topic tidak dijamin,
- governance overhead besar,
- evolusi workflow sulit,
- observability terpecah.

Sering kali topic yang lebih baik adalah berdasarkan stream domain yang cohesive:

```text
case.lifecycle.events
```

Payload membedakan event type:

```json
{
  "eventType": "CaseEscalated",
  "caseId": "CASE-123",
  ...
}
```

Tapi ini bukan aturan mutlak. Pemisahan topic harus mempertimbangkan:

- ownership,
- access control,
- retention,
- throughput,
- schema compatibility,
- consumer kebutuhan,
- ordering boundary,
- data sensitivity,
- operational blast radius.

---

## 6. Partition: Unit Ordering, Parallelism, Storage, dan Replication

Topic dipecah menjadi partition.

```text
Topic: case.lifecycle.events

partition 0: 0, 1, 2, 3, 4, ...
partition 1: 0, 1, 2, 3, 4, ...
partition 2: 0, 1, 2, 3, 4, ...
partition 3: 0, 1, 2, 3, 4, ...
```

Setiap partition adalah log independen. Offset hanya bermakna di dalam partition tersebut.

Artinya:

```text
partition 0 offset 10 != partition 1 offset 10
```

Keduanya adalah posisi ke-10 di log yang berbeda.

### 6.1 Partition punya empat peran besar

#### 1. Unit ordering

Kafka menjaga ordering di dalam partition.

```text
partition 0:
0 -> A
1 -> B
2 -> C
```

Consumer yang membaca partition tersebut akan membaca A, lalu B, lalu C.

#### 2. Unit parallelism

Beberapa partition bisa diproses paralel oleh beberapa consumer dalam consumer group.

```text
partition 0 -> consumer A
partition 1 -> consumer B
partition 2 -> consumer C
partition 3 -> consumer D
```

Jika topic hanya punya 1 partition, satu consumer group hanya bisa memproses topic itu secara efektif dengan 1 consumer aktif untuk topic tersebut.

#### 3. Unit storage distribution

Partition disimpan dan direplikasi di broker. Topic dengan banyak partition dapat tersebar di banyak broker.

```text
broker 1: partition 0 leader
broker 2: partition 1 leader
broker 3: partition 2 leader
```

#### 4. Unit replication

Replication Kafka terjadi pada level partition. Jika topic punya replication factor 3, tiap partition punya 3 replica di broker berbeda.

```text
partition 0:
  leader  -> broker 1
  follower -> broker 2
  follower -> broker 3
```

### 6.2 Partition bukan shard database biasa

Partition mirip shard karena membagi data, tetapi konsekuensinya berbeda.

Pada database sharding, pertanyaan utama biasanya:

```text
Di shard mana row disimpan?
```

Pada Kafka partitioning, pertanyaannya lebih kaya:

```text
Untuk entity/event ini, ordering domain apa yang harus dijaga?
Berapa parallelism yang dibutuhkan?
Apa risiko hot key?
Apa efek partition count terhadap consumer group?
Bagaimana replay akan dilakukan?
Apa dampaknya pada downstream state store?
```

Partition adalah desain arsitektur, bukan hanya tuning performa.

---

## 7. Offset: Posisi, Bukan Identitas Bisnis

Offset adalah nomor urut record dalam partition.

```text
case.lifecycle.events partition 2:

0 -> CaseCreated(CASE-1)
1 -> CaseCreated(CASE-2)
2 -> CaseAssigned(CASE-1)
3 -> CaseEscalated(CASE-1)
4 -> CaseClosed(CASE-2)
```

Offset `3` berarti record keempat di partition itu. Offset tidak berarti:

- event id,
- primary key,
- business sequence number,
- globally unique ordering marker,
- timestamp,
- status processing selesai.

### 7.1 Offset scope

Offset selalu scoped ke:

```text
topic + partition
```

Identifier posisi lengkap:

```text
(topic=case.lifecycle.events, partition=2, offset=3)
```

Bukan hanya:

```text
offset=3
```

### 7.2 Offset dan consumer progress

Consumer menyimpan progress dengan commit offset.

Misal consumer sudah berhasil memproses record offset 0, 1, dan 2. Consumer biasanya commit offset berikutnya:

```text
committed offset = 3
```

Maknanya:

```text
Mulai baca lagi dari offset 3 jika consumer restart.
```

Ini sering membingungkan karena commit offset `3` bukan berarti record offset `3` sudah selesai. Umumnya berarti semua record sebelum `3` dianggap selesai.

### 7.3 Offset bukan event ID

Jangan memakai offset sebagai business identifier.

Buruk:

```text
caseDecisionId = topic + partition + offset
```

Masalah:

- offset bergantung pada Kafka storage, bukan domain,
- replay ke topic baru dapat mengubah offset,
- compaction/retention tidak cocok untuk identity bisnis,
- multi-region replication bisa mengubah konteks offset,
- consumer tidak boleh membuat kontrak bisnis berdasarkan posisi fisik log.

Lebih baik:

```json
{
  "eventId": "evt-01JZ...",
  "caseId": "CASE-123",
  "decisionId": "DEC-9981"
}
```

Offset digunakan untuk transport/progress. Event ID digunakan untuk idempotency dan audit bisnis.

---

## 8. Ordering: Jaminan Kuat, Tapi Lokal

Kafka sering disebut menjaga ordering. Kalimat itu benar tetapi tidak lengkap.

Kalimat yang presisi:

```text
Kafka menjaga urutan record di dalam satu partition.
Kafka tidak memberikan global ordering otomatis di seluruh partition dalam satu topic.
```

### 8.1 Single partition ordering

Jika semua record masuk ke partition yang sama:

```text
partition 0:
0 -> A
1 -> B
2 -> C
3 -> D
```

Consumer membaca dalam urutan:

```text
A, B, C, D
```

### 8.2 Multi-partition tidak punya global order

Jika record tersebar:

```text
partition 0:
0 -> A
1 -> C

partition 1:
0 -> B
1 -> D
```

Tidak ada urutan global tunggal:

```text
A, B, C, D
```

atau:

```text
B, A, D, C
```

Kafka tidak menjanjikan itu.

Bahkan jika timestamp ada, timestamp bukan ordering primitive yang sempurna:

- producer clock bisa berbeda,
- event time bisa terlambat,
- network delay bisa berubah,
- retry bisa mengubah arrival order,
- producer paralel bisa menulis bersamaan,
- broker append order per partition tetap lokal.

### 8.3 Ordering domain

Yang harus didesain bukan “global order”, tetapi **ordering domain**.

Ordering domain adalah batas di mana urutan harus benar secara bisnis.

Contoh:

| Domain | Ordering key yang mungkin |
|---|---|
| Case lifecycle | `caseId` |
| Payment transaction | `transactionId` atau `accountId`, tergantung invariant |
| Customer profile | `customerId` |
| Enforcement workflow | `caseId` atau `enforcementActionId` |
| Inventory per SKU/location | `skuId + warehouseId` |
| Account balance | `accountId` |

Pertanyaan desain:

```text
Untuk entity apa event tidak boleh diproses out of order?
```

Jawabannya biasanya menjadi Kafka record key.

### 8.4 Contoh: regulatory case lifecycle

Invariant bisnis:

```text
Case tidak boleh CLOSED sebelum DECISION_ISSUED.
Escalation harus terjadi setelah assignment.
EvidenceSubmitted harus dikaitkan dengan case yang sudah created.
```

Maka ordering domain yang masuk akal:

```text
caseId
```

Semua event lifecycle case yang sama memakai key `caseId`.

```text
key = CASE-123
```

Hasil:

```text
partition 5:
10 -> CaseCreated(CASE-123)
11 -> CaseAssigned(CASE-123)
12 -> EvidenceSubmitted(CASE-123)
13 -> DecisionIssued(CASE-123)
14 -> CaseClosed(CASE-123)
```

Case lain bisa diproses paralel di partition lain.

```text
partition 2: CASE-777 events
partition 5: CASE-123 events
partition 8: CASE-999 events
```

Ini menciptakan keseimbangan:

```text
ordered per case, parallel across cases
```

Itulah pola desain Kafka yang sangat umum.

---

## 9. Key-Based Partitioning

Producer menentukan partition untuk setiap record. Ada beberapa cara:

1. Producer mengisi partition eksplisit.
2. Producer mengisi key, partition dipilih berdasarkan hash key.
3. Producer tidak mengisi key, default partitioner memakai strategi untuk distribusi/batching.
4. Producer memakai custom partitioner.

### 9.1 Key present

Jika key ada, default partitioner Kafka memilih partition berdasarkan hash key.

Konseptual:

```text
partition = hash(key) % number_of_partitions
```

Tidak harus persis implementasi internalnya dalam semua versi, tetapi mental model ini cukup untuk desain.

Konsekuensi:

```text
key yang sama -> partition yang sama
```

Selama jumlah partition tidak berubah dan partitioner tetap kompatibel.

### 9.2 Key absent

Jika key tidak ada, Kafka tidak punya ordering domain bisnis. Producer akan mendistribusikan record untuk batching/throughput.

Ini cocok untuk event yang tidak butuh ordering per entity, misalnya:

```text
system.metrics.raw
clickstream.anonymous.events
log.ingestion.events
```

Tetapi buruk untuk workflow entity lifecycle jika urutan penting.

### 9.3 Custom partitioner

Custom partitioner bisa berguna untuk:

- menghindari hot partition tertentu,
- menempatkan tenant besar secara eksplisit,
- menjaga kompatibilitas legacy routing,
- melakukan routing berdasarkan field kompleks.

Tapi custom partitioner berisiko:

- logic tersembunyi di producer,
- sulit diubah,
- bisa tidak konsisten antar bahasa/client,
- bisa menciptakan skew,
- bisa mempersulit replay dan debugging.

Default rule:

```text
Gunakan key yang benar sebelum berpikir custom partitioner.
```

---

## 10. Partition Count: Keputusan yang Mahal

Jumlah partition bukan parameter kecil. Ini memengaruhi banyak hal.

### 10.1 Partition count menentukan batas parallelism consumer group

Jika topic punya 6 partition:

```text
P0 P1 P2 P3 P4 P5
```

Maka dalam satu consumer group, maksimal 6 consumer bisa aktif membaca topic itu secara paralel untuk assignment partition unik.

```text
consumer A -> P0
consumer B -> P1
consumer C -> P2
consumer D -> P3
consumer E -> P4
consumer F -> P5
consumer G -> idle untuk topic ini
```

Consumer ke-7 tidak meningkatkan parallelism untuk topic ini.

### 10.2 Partition count memengaruhi ordering saat dinaikkan

Misal awalnya topic punya 4 partition:

```text
partition = hash(caseId) % 4
```

Lalu dinaikkan menjadi 8 partition:

```text
partition = hash(caseId) % 8
```

Sebagian key bisa berpindah partition untuk event baru.

Akibatnya, event lama untuk `CASE-123` ada di partition lama, event baru mungkin masuk partition baru.

```text
partition 1:
100 -> CaseCreated(CASE-123)
101 -> CaseAssigned(CASE-123)

partition 5:
0 -> CaseClosed(CASE-123)
```

Untuk entity yang masih aktif, ini bisa merusak asumsi ordering.

Karena itu, menaikkan partition count pada topic ber-key dan ber-ordering penting harus diperlakukan sebagai migrasi desain, bukan sekadar scaling knob.

Strategi yang lebih aman:

1. Pilih partition count awal dengan headroom.
2. Buat topic baru dengan partition count baru.
3. Migrasi producer dan consumer dengan rencana transisi.
4. Gunakan versioned topic jika perlu.
5. Pastikan entity aktif tidak split ordering secara diam-diam.

### 10.3 Terlalu sedikit partition

Masalah:

- throughput terbatas,
- consumer parallelism terbatas,
- broker distribution kurang optimal,
- satu partition besar bisa menjadi bottleneck,
- recovery/replay bisa lambat.

### 10.4 Terlalu banyak partition

Masalah:

- metadata lebih besar,
- file handle lebih banyak,
- memory overhead broker meningkat,
- leader election lebih berat,
- recovery bisa lebih kompleks,
- consumer rebalance bisa lebih mahal,
- monitoring lebih noisy,
- small batches lebih mungkin jika traffic per partition rendah.

Partition count adalah trade-off. Tidak ada angka sakti.

---

## 11. Retention: Kafka Menyimpan Data Setelah Dibaca

Kafka menyimpan record berdasarkan retention policy, bukan berdasarkan apakah record sudah dibaca consumer.

Contoh:

```text
retention.ms = 7 days
```

Record disimpan sekitar 7 hari, terlepas dari:

- sudah dibaca consumer A,
- belum dibaca consumer B,
- dibaca 100 consumer group,
- tidak dibaca siapa pun.

### 11.1 Dampak retention

Retention memungkinkan:

1. **Replay**  
   Consumer bisa membaca ulang histori.

2. **Backfill**  
   Service baru bisa membangun state dari event lama.

3. **Recovery**  
   Consumer yang down bisa mengejar selama data belum expired.

4. **Multiple consumers**  
   Banyak consumer group membaca stream yang sama untuk tujuan berbeda.

5. **Decoupling waktu**  
   Producer tidak perlu tahu consumer sedang online atau tidak.

### 11.2 Retention bukan backup penuh

Jangan menganggap Kafka sebagai backup tak terbatas kecuali memang didesain begitu.

Jika retention 7 hari dan consumer down 10 hari:

```text
sebagian data sudah hilang dari topic
consumer tidak bisa mengejar dari Kafka
```

Untuk data regulasi atau audit, retention harus diputuskan berdasarkan kebutuhan compliance, storage cost, replay, dan downstream archival.

### 11.3 Delete retention vs compacted retention

Kafka punya dua model cleanup utama:

```text
cleanup.policy=delete
cleanup.policy=compact
cleanup.policy=compact,delete
```

Part ini fokus pada delete retention. Log compaction akan dibahas detail di Part 012.

Mental model awal:

- `delete`: simpan record berdasarkan waktu/ukuran, lalu hapus segment lama.
- `compact`: simpan setidaknya nilai terbaru per key, dengan proses pembersihan background.

---

## 12. Replay: Superpower dan Risiko

Replay adalah kemampuan membaca ulang event dari offset lama.

Contoh use case:

1. Rebuild projection database.
2. Membangun search index baru.
3. Mengisi data lake.
4. Menguji logic consumer versi baru.
5. Mengulang event setelah bug diperbaiki.
6. Audit investigasi.
7. Membuat read model baru.

### 12.1 Replay bukan gratis

Replay bisa menimbulkan risiko:

- duplicate side effect,
- email terkirim ulang,
- payment diproses ulang,
- external API dipanggil ulang,
- database state tertimpa logic lama,
- downstream overload,
- lag consumer lain meningkat,
- DLQ penuh.

Karena itu consumer harus dirancang idempotent.

### 12.2 Replay-safe consumer

Consumer replay-safe biasanya memiliki karakteristik:

1. Memakai event ID untuk idempotency.
2. Side effect eksternal dilindungi idempotency key.
3. Projection bersifat deterministic dari event stream.
4. Logic bisa membedakan command side effect dan state reconstruction.
5. Ada mode backfill/replay dengan rate limit.
6. Ada observability untuk progress dan error.

Buruk:

```java
onEvent(CaseEscalated event) {
    emailService.sendEmail(event.assignee(), "Case escalated");
}
```

Lebih aman:

```java
onEvent(CaseEscalated event) {
    if (processedEventRepository.alreadyProcessed(event.eventId())) {
        return;
    }

    notificationService.sendOnce(
        idempotencyKey = event.eventId(),
        recipient = event.assignee(),
        template = "CASE_ESCALATED"
    );

    processedEventRepository.markProcessed(event.eventId());
}
```

Tetap ada detail transaksional yang perlu dibahas di part delivery semantics, tetapi arah pikirnya jelas: Kafka memungkinkan replay, maka aplikasi harus siap duplicate.

---

## 13. Topic, Partition, Offset: Visual Mental Model

Bayangkan topic sebagai buku besar yang dibagi menjadi beberapa jilid paralel.

```text
Topic: case.lifecycle.events

Partition 0                  Partition 1                  Partition 2
-----------                  -----------                  -----------
0 CaseCreated C-1             0 CaseCreated C-2             0 CaseCreated C-3
1 CaseAssigned C-1            1 EvidenceAdded C-2           1 CaseAssigned C-3
2 CaseEscalated C-1           2 CaseClosed C-2              2 CaseEscalated C-3
3 CaseClosed C-1              3 ...                         3 ...
```

Ordering dijamin vertikal dalam satu partition:

```text
Partition 0: offset 0 -> 1 -> 2 -> 3
```

Tidak dijamin horizontal antar partition:

```text
Partition 0 offset 2 tidak pasti sebelum/sesudah Partition 1 offset 2 secara global
```

Consumer group membaca partition assignment:

```text
Consumer Group: case-projection-service

Consumer A -> Partition 0
Consumer B -> Partition 1
Consumer C -> Partition 2
```

Consumer group lain dapat membaca topic yang sama secara independen:

```text
Consumer Group: audit-indexer

Consumer X -> Partition 0, 1
Consumer Y -> Partition 2
```

Progress mereka independen.

```text
case-projection-service committed offset P0 = 1000
audit-indexer committed offset P0 = 200
```

Itu normal.

---

## 14. Kafka vs Queue: Perbedaan Praktis

| Aspek | Queue tradisional | Kafka |
|---|---|---|
| Model utama | Work queue | Distributed append-only log |
| Message setelah dibaca | Biasanya dihapus/ack selesai | Tetap ada sampai retention/compaction |
| Banyak consumer independen | Bisa, tapi sering semantik berbeda | Natural melalui consumer group berbeda |
| Replay | Tidak selalu natural | Fitur inti selama data masih ada |
| Ordering | Tergantung queue dan consumer | Per partition |
| Parallelism | Worker mengambil message | Partition assignment dalam group |
| Progress | Queue tracking/ack | Consumer offset |
| Storage | Sering dianggap buffer | Kafka memang menyimpan log |
| Use case kuat | Task distribution | Event streaming, integration, replay, CDC, stream processing |

Kafka bisa dipakai untuk workload seperti queue, tetapi memaksanya menjadi queue biasa sering membuat desain buruk.

Contoh workload queue murni:

```text
Generate PDF for document X
Send email Y
Resize image Z
```

Kafka bisa melakukannya, tetapi sistem seperti RabbitMQ/SQS/Celery-style queue mungkin lebih sederhana jika tidak butuh replay, event history, multi-consumer stream, atau ordered log.

---

## 15. Kafka vs Database Log

Kafka mirip database transaction log dalam beberapa hal:

- append-only,
- ordered,
- durable,
- bisa direplay,
- merepresentasikan perubahan/fakta.

Tetapi Kafka berbeda dari database log:

| Aspek | Database transaction log | Kafka topic log |
|---|---|---|
| Tujuan utama | Recovery/replication internal database | Event streaming antar aplikasi |
| Konsumsi aplikasi | Biasanya tidak langsung | Memang didesain untuk client consumer |
| Schema | Mengikuti table/storage engine | Didesain sebagai contract event |
| Retention | Untuk recovery/replication | Untuk replay, integration, streaming |
| Ownership | Database engine | Platform/application teams |

CDC menghubungkan dua dunia ini: perubahan dari database log diterbitkan ke Kafka topic. Tapi event CDC mentah bukan selalu domain event yang baik. Ini akan dibahas di Part 016.

---

## 16. Design Heuristics untuk Java Engineer

### 16.1 Mulai dari invariant, bukan dari topic

Jangan mulai dengan:

```text
Butuh berapa topic?
```

Mulai dengan:

```text
Event apa yang terjadi?
Entity apa yang berubah?
Urutan apa yang harus dijaga?
Consumer siapa yang membutuhkan event ini?
Apa efek duplicate?
Berapa lama histori harus tersedia?
Apa kebutuhan replay?
```

Baru setelah itu desain topic, key, partition, schema, dan retention.

### 16.2 Pilih key berdasarkan ordering domain

Contoh:

```text
caseId -> jika lifecycle case harus ordered per case
accountId -> jika balance mutation harus ordered per account
customerId -> jika profile update harus ordered per customer
transactionId -> jika event hanya terkait satu transaction
```

Jangan memakai random UUID sebagai key jika kamu butuh ordering per entity. Random UUID akan menyebarkan event entity yang sama ke partition berbeda jika UUID berbeda per event.

Buruk:

```text
key = eventId
```

Untuk lifecycle case, lebih baik:

```text
key = caseId
```

Event ID tetap ada di payload/header untuk idempotency.

### 16.3 Jangan mengejar global order kecuali benar-benar perlu

Global order biasanya mahal. Untuk mendapatkan global order, kamu mungkin tergoda memakai satu partition.

```text
topic partitions = 1
```

Ini memberi ordering total untuk topic, tetapi mengorbankan parallelism dan throughput.

Pertanyaan yang lebih baik:

```text
Apakah bisnis benar-benar butuh semua event global ordered?
Atau hanya butuh ordered per case/account/customer/order?
```

Sebagian besar sistem hanya butuh ordering per aggregate/entity.

### 16.4 Treat partition count as architecture

Partition count bukan sekadar angka performa. Ia memengaruhi:

- consumer scalability,
- ordering stability,
- broker resources,
- failover,
- state store distribution,
- partition reassignment,
- future migration.

Dokumentasikan alasan partition count dalam ADR.

### 16.5 Desain replay dari hari pertama

Untuk setiap consumer, tanyakan:

```text
Apa yang terjadi jika event yang sama diproses dua kali?
Apa yang terjadi jika consumer replay dari awal?
Apa yang terjadi jika consumer tertinggal 2 hari?
Apa yang terjadi jika event lama diproses oleh logic baru?
```

Kalau jawabannya tidak jelas, sistem belum production-grade.

---

## 17. Worked Example: Enforcement Case Lifecycle Stream

Kita desain topic untuk lifecycle enforcement case.

### 17.1 Requirement

Sistem memiliki case enforcement. Case dapat:

1. dibuat,
2. ditugaskan,
3. menerima evidence,
4. dieskalasi,
5. diputuskan,
6. ditutup,
7. dibuka ulang.

Downstream consumer:

- case projection service,
- SLA monitoring service,
- audit indexing service,
- notification service,
- analytics pipeline,
- regulatory reporting service.

Requirement ordering:

```text
Event untuk case yang sama harus diproses sesuai urutan lifecycle.
Event untuk case berbeda boleh diproses paralel.
```

### 17.2 Topic

Candidate:

```text
case.lifecycle.events
```

Alasan:

- lifecycle case adalah stream cohesive,
- consumer sering butuh urutan per case,
- event type masih satu bounded context,
- retention bisa diatur sesuai kebutuhan audit/replay,
- ACL dapat diberikan kepada consumer relevan.

### 17.3 Key

```text
key = caseId
```

Alasan:

- ordering domain adalah case,
- semua event satu case masuk partition sama,
- parallelism tetap ada antar case.

### 17.4 Event envelope

```json
{
  "eventId": "evt-01JZ8H8Q0N7A9PK7FQ9Z5T8G3A",
  "eventType": "CaseEscalated",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T10:15:20Z",
  "producedAt": "2026-06-19T10:15:21Z",
  "caseId": "CASE-2026-000123",
  "correlationId": "corr-abc",
  "causationId": "evt-previous",
  "actor": {
    "type": "USER",
    "id": "usr-928"
  },
  "payload": {
    "fromLevel": "LEVEL_1",
    "toLevel": "LEVEL_2",
    "reason": "SLA_BREACH"
  }
}
```

### 17.5 Partition count thinking

Misal throughput estimasi:

```text
average: 500 events/second
peak: 5,000 events/second
expected consumer group parallelism: 12-24 consumers
retention: 30 days hot replay
```

Partition count awal mungkin:

```text
24 or 48 partitions
```

Tapi keputusan final harus mempertimbangkan:

- broker count,
- replication factor,
- expected key distribution,
- case count cardinality,
- hot case risk,
- consumer processing latency,
- future growth,
- operational overhead.

### 17.6 Hot key scenario

Jika satu mega-case menghasilkan 40% traffic:

```text
CASE-MEGA-001 -> partition 7
```

Partition 7 menjadi hot.

Solusi tidak selalu mudah karena memecah key bisa merusak ordering case.

Pilihan desain:

1. Terima hot key jika masih dalam kapasitas.
2. Pisahkan event high-volume subdomain ke topic berbeda, misalnya `case.evidence.events` dengan key `evidenceId` atau `caseId:evidenceType` jika ordering evidence tidak harus total per case.
3. Buat aggregate boundary lebih kecil.
4. Gunakan workflow sequencer khusus untuk case besar.
5. Gunakan command side untuk heavy artifact, Kafka hanya menyimpan event metadata.

Trade-off harus eksplisit.

---

## 18. Worked Example: Salah Desain dan Perbaikannya

### 18.1 Desain buruk

```text
topic: regulatory-events
key: random event UUID
partitions: 3
payload:
{
  "type": "UPDATE",
  "entity": "CASE",
  "id": "CASE-123",
  "data": {...}
}
```

Masalah:

1. Topic terlalu generic.
2. Key random membuat event case yang sama tersebar.
3. `UPDATE` tidak punya makna domain.
4. Consumer harus menebak perubahan.
5. Ordering lifecycle case tidak aman.
6. Sulit audit secara semantik.
7. Sulit schema governance.
8. Retention untuk semua event dipukul rata.

### 18.2 Desain lebih baik

```text
topic: case.lifecycle.events
key: caseId
partitions: 24
payload:
{
  "eventId": "evt-...",
  "eventType": "CaseEscalated",
  "caseId": "CASE-123",
  "occurredAt": "...",
  "payload": {
    "fromLevel": "LEVEL_1",
    "toLevel": "LEVEL_2",
    "reason": "SLA_BREACH"
  }
}
```

Keuntungan:

1. Ordering aman per case.
2. Event bermakna domain.
3. Consumer lebih sederhana.
4. Replay lebih masuk akal.
5. Audit trail lebih jelas.
6. Schema evolution lebih terkontrol.
7. Topic ownership lebih jelas.

---

## 19. Anti-Patterns

### Anti-pattern 1: Menganggap Kafka menghapus message setelah dibaca

Salah:

```text
Consumer sudah baca, berarti message hilang.
```

Benar:

```text
Record tetap ada sampai retention/compaction menghapusnya.
Consumer hanya mengubah committed offset.
```

### Anti-pattern 2: Menggunakan eventId sebagai key untuk semua event

Salah untuk entity lifecycle:

```text
key = eventId
```

Karena event ID berbeda untuk setiap event. Ordering per entity hilang.

Benar untuk case lifecycle:

```text
key = caseId
```

### Anti-pattern 3: Mengharapkan global order dari topic multi-partition

Salah:

```text
Topic punya 12 partition tapi saya ingin semua event diproses global ordered.
```

Benar:

```text
Kafka ordering per partition. Desain ordering domain atau gunakan single partition dengan sadar terhadap trade-off.
```

### Anti-pattern 4: Menambah partition tanpa memikirkan key remapping

Salah:

```text
Traffic naik, langsung naikkan partition dari 12 ke 48.
```

Risiko:

- key remap,
- ordering entity aktif pecah,
- consumer behavior berubah,
- stateful stream processing terdampak.

### Anti-pattern 5: Topic `events` untuk semua hal

Salah:

```text
events
all-events
message-bus
integration-topic
```

Biasanya ini menjadi dumping ground.

### Anti-pattern 6: Payload CRUD tanpa domain meaning

Salah:

```json
{
  "op": "U",
  "table": "case",
  "columns": {...}
}
```

Tidak selalu salah untuk CDC internal, tetapi buruk sebagai domain integration event jika consumer butuh makna bisnis.

### Anti-pattern 7: Replay tanpa idempotency

Salah:

```text
Kafka bisa replay, jadi tinggal reset offset.
```

Benar:

```text
Replay aman hanya jika consumer dan side effect dirancang idempotent atau replay-mode aware.
```

---

## 20. Checklist Desain Topic Awal

Gunakan checklist ini setiap kali membuat topic Kafka baru.

### 20.1 Purpose

- [ ] Topic ini merepresentasikan stream apa?
- [ ] Apakah ini domain event, integration event, command, changelog, atau raw ingestion?
- [ ] Siapa owner topic?
- [ ] Siapa producer yang sah?
- [ ] Siapa consumer utama?

### 20.2 Ordering

- [ ] Apakah ordering penting?
- [ ] Ordering dibutuhkan global atau per entity?
- [ ] Entity apa yang menjadi ordering domain?
- [ ] Apakah key sudah sesuai ordering domain?
- [ ] Apa yang terjadi jika event entity yang sama masuk partition berbeda?

### 20.3 Partitioning

- [ ] Berapa cardinality key?
- [ ] Apakah ada risiko hot key?
- [ ] Berapa target throughput peak?
- [ ] Berapa consumer parallelism yang dibutuhkan?
- [ ] Apakah partition count punya headroom?
- [ ] Apa rencana jika partition count harus dinaikkan?

### 20.4 Retention

- [ ] Berapa lama data harus tersedia untuk replay?
- [ ] Apakah ada kebutuhan audit/compliance?
- [ ] Apakah topic memakai delete, compact, atau compact+delete?
- [ ] Apa dampak jika consumer down lebih lama dari retention?

### 20.5 Schema

- [ ] Format serialization apa?
- [ ] Apakah schema registered?
- [ ] Compatibility policy apa?
- [ ] Apakah event memiliki eventId?
- [ ] Apakah event memiliki occurredAt, correlationId, causationId?

### 20.6 Consumer semantics

- [ ] Apakah consumer idempotent?
- [ ] Apa efek duplicate?
- [ ] Apa efek out-of-order?
- [ ] Apa strategi DLQ?
- [ ] Apa strategi replay/backfill?

---

## 21. Latihan Mental Model

### Latihan 1 — Pilih key

Kamu memiliki event:

```text
PaymentAuthorized
PaymentCaptured
PaymentRefunded
```

Pilihan key:

1. `eventId`
2. `paymentId`
3. `customerId`
4. `merchantId`

Pertanyaan:

```text
Ordering domain apa yang benar?
```

Jawaban bergantung pada invariant.

Jika invariant utama:

```text
Satu payment tidak boleh refunded sebelum captured.
```

Maka key natural:

```text
paymentId
```

Jika invariant utama terkait account balance customer:

```text
Mutasi balance customer harus sequential.
```

Maka mungkin:

```text
customerId
```

Tidak ada jawaban universal tanpa invariant bisnis.

### Latihan 2 — Global order

Requirement:

```text
Semua event audit harus bisa ditampilkan dalam urutan global yang sama persis dengan saat diterima sistem.
```

Pertanyaan:

```text
Apakah Kafka multi-partition topic cukup?
```

Jawaban:

Tidak jika benar-benar butuh total global order. Kafka memberi ordering per partition. Solusi mungkin:

- single partition audit sequencer,
- centralized sequence service,
- database sequence untuk audit ledger,
- post-processing sort berdasarkan sequence yang dibuat upstream,
- menerima partial order per entity jika global order sebenarnya tidak wajib.

Tantang requirement: sering kali “global order” sebenarnya kebutuhan UI/reporting, bukan invariant pemrosesan.

### Latihan 3 — Menambah partition

Topic `case.lifecycle.events` awalnya punya 8 partition dengan key `caseId`. Setelah 1 tahun, traffic naik dan ingin dinaikkan ke 32 partition.

Pertanyaan:

```text
Apa risikonya?
```

Jawaban:

- hash key bisa remap,
- event baru untuk case aktif bisa masuk partition berbeda dari event lama,
- ordering per case bisa pecah untuk case yang belum selesai,
- stateful consumer bisa perlu migrasi,
- replay dan projection bisa terdampak.

Mitigasi:

- buat topic baru versi baru,
- migrasi hanya untuk case baru,
- drain case lama,
- gunakan routing compatibility layer,
- dokumentasikan cutover.

### Latihan 4 — Replay

Consumer `notification-service` membaca `case.lifecycle.events` dan mengirim email saat `CaseEscalated`.

Pertanyaan:

```text
Apa yang terjadi jika offset di-reset 7 hari ke belakang?
```

Risiko:

- email lama terkirim ulang,
- user bingung,
- audit noise,
- rate limit email provider,
- compliance issue.

Solusi:

- idempotency key = eventId,
- notification ledger,
- replay mode disable external side effect,
- separate projection consumer dan side-effect consumer,
- explicit operator approval untuk replay side effect.

---

## 22. Java Engineer Perspective

Sebagai Java engineer, kamu akan sering berinteraksi dengan Kafka melalui:

1. Kafka Producer API.
2. Kafka Consumer API.
3. Spring Kafka.
4. Kafka Streams.
5. Kafka Connect connector configuration.
6. Schema Registry SerDes.

Tapi library apa pun yang kamu pakai, mental model log tetap harus terlihat.

### 22.1 ProducerRecord

Konseptual Java:

```java
ProducerRecord<String, CaseLifecycleEvent> record =
    new ProducerRecord<>(
        "case.lifecycle.events",
        event.caseId(),      // key
        event                // value
    );
```

Hal penting:

```text
key = caseId
```

Bukan karena Java butuh string, tetapi karena Kafka butuh routing untuk ordering domain.

### 22.2 ConsumerRecord

Konseptual Java:

```java
void handle(ConsumerRecord<String, CaseLifecycleEvent> record) {
    String topic = record.topic();
    int partition = record.partition();
    long offset = record.offset();
    String key = record.key();
    CaseLifecycleEvent event = record.value();
}
```

`topic`, `partition`, dan `offset` berguna untuk:

- logging,
- debugging,
- tracing,
- DLQ metadata,
- replay diagnostics,
- idempotency diagnostics.

Tapi jangan jadikan offset sebagai ID bisnis.

### 22.3 Logging yang baik

Buruk:

```text
Failed to process message
```

Lebih baik:

```text
Failed to process Kafka record topic=case.lifecycle.events partition=5 offset=109283 key=CASE-123 eventId=evt-abc eventType=CaseEscalated
```

Debugging Kafka tanpa topic-partition-offset adalah penderitaan.

### 22.4 Idempotency table

Contoh sederhana:

```sql
CREATE TABLE processed_event (
    event_id VARCHAR(64) PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL
);
```

Consumer:

```java
@Transactional
public void handle(CaseLifecycleEvent event) {
    if (processedEventRepository.exists(event.eventId())) {
        return;
    }

    projectionRepository.apply(event);
    processedEventRepository.insert(event.eventId());
}
```

Detail transaksi dengan offset commit akan dibahas di Part 008 dan Part 022. Untuk saat ini, pahami invariant-nya:

```text
Kafka replay dan retry berarti duplicate harus diasumsikan mungkin.
```

---

## 23. Production Failure Modes Terkait Log Mental Model

### 23.1 Consumer tertinggal lebih lama dari retention

Kondisi:

```text
retention = 3 days
consumer down = 5 days
```

Akibat:

```text
offset yang dibutuhkan consumer sudah tidak tersedia
```

Consumer akan terkena offset out of range. Recovery mungkin butuh:

- reset ke earliest yang masih tersedia,
- restore dari snapshot,
- backfill dari data lake/database,
- manual reconciliation.

### 23.2 Key berubah karena refactor

Versi lama:

```text
key = caseId
```

Versi baru:

```text
key = tenantId + ":" + caseId
```

Jika dilakukan tanpa rencana, partition untuk case bisa berubah. Ordering dan stateful processing dapat terdampak.

### 23.3 Producer mengirim null key karena bug

Akibat:

- event entity tersebar,
- ordering rusak,
- consumer state bisa salah,
- bug sulit dideteksi jika tidak ada validation.

Mitigasi:

- producer-side validation,
- schema/envelope validation,
- reject null key untuk topic yang wajib keyed,
- observability key-null-rate,
- contract test.

### 23.4 Hot partition

Satu key/tenant menghasilkan traffic dominan.

Gejala:

- lag tinggi hanya di partition tertentu,
- consumer untuk partition itu CPU tinggi,
- broker leader partition itu lebih sibuk,
- p99 latency naik.

Mitigasi harus mempertimbangkan ordering. Jangan asal salting key jika ordering per key wajib.

### 23.5 Replay menyebabkan side effect ulang

Reset offset tanpa idempotency dapat menimbulkan side effect bisnis ulang.

Mitigasi:

- idempotency key,
- side effect ledger,
- replay mode,
- separation between projection and effect,
- explicit runbook.

---

## 24. Design Trade-Offs

### 24.1 Single partition vs multi-partition

| Pilihan | Kelebihan | Kekurangan |
|---|---|---|
| Single partition | Total order sederhana | Throughput dan parallelism terbatas |
| Multi-partition | Scalable, parallel | Ordering hanya per partition |

Rule:

```text
Gunakan single partition hanya jika total order benar-benar invariant utama dan throughput cukup.
```

### 24.2 Fat event vs thin event

Fat event:

```text
Event membawa data cukup lengkap untuk consumer.
```

Kelebihan:

- consumer tidak perlu callback ke producer,
- replay lebih stabil,
- temporal coupling lebih rendah.

Kekurangan:

- payload besar,
- schema evolution lebih berat,
- data duplication,
- privacy risk.

Thin event:

```text
Event hanya membawa ID dan consumer fetch detail sendiri.
```

Kelebihan:

- payload kecil,
- data sensitif tidak banyak tersebar.

Kekurangan:

- consumer coupling ke API/database producer,
- replay bisa tidak deterministik karena state terbaru berbeda dari state saat event terjadi,
- load tambahan ke service sumber.

### 24.3 Long retention vs short retention

Long retention:

- replay lebih kuat,
- audit lebih baik,
- storage cost naik,
- privacy/compliance harus dipikirkan.

Short retention:

- cost lebih rendah,
- risiko consumer tertinggal lebih besar,
- backfill lebih sulit.

### 24.4 One topic per event type vs one topic per event family

One topic per event type:

- ACL dan retention spesifik,
- schema sederhana,
- ordering antar event type sulit.

One topic per event family:

- lifecycle stream cohesive,
- ordering per entity lebih mudah,
- schema polymorphism perlu governance.

---

## 25. Ringkasan Inti

Jika hanya boleh mengingat beberapa hal dari part ini, ingat ini:

1. Kafka adalah **distributed append-only log**, bukan queue biasa.
2. Topic adalah nama stream/log logical.
3. Topic terdiri dari partition.
4. Partition adalah unit ordering, parallelism, storage distribution, dan replication.
5. Offset adalah posisi record dalam partition, bukan ID bisnis.
6. Ordering Kafka dijamin di dalam partition, bukan global di seluruh topic multi-partition.
7. Key menentukan ordering domain dan biasanya menentukan partition.
8. Pilih key berdasarkan invariant bisnis, bukan asal field yang tersedia.
9. Consumer membaca log dan menyimpan progress melalui committed offset.
10. Record tetap ada sampai retention/compaction, bukan hilang setelah dibaca.
11. Replay adalah superpower Kafka, tetapi hanya aman jika consumer idempotent.
12. Partition count adalah keputusan arsitektur yang mahal untuk diubah.
13. Topic adalah kontrak publik; desain topic yang buruk akan menjadi hutang arsitektur besar.
14. Untuk sistem workflow/regulatory/case management, Kafka sangat kuat jika event dimodelkan sebagai fakta domain yang immutable dan ordered per aggregate.

---

## 26. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk bagian ini:

1. Apache Kafka Documentation — Introduction and core concepts: `https://kafka.apache.org/documentation/`
2. Apache Kafka Producer Configs — partitioning behavior and producer configuration: `https://kafka.apache.org/41/configuration/producer-configs/`
3. Confluent Kafka Design — replication and topic partition replication model: `https://docs.confluent.io/kafka/design/replication.html`
4. Confluent Kafka Consumer documentation — consumer offsets, consumer groups, and rebalancing overview: `https://docs.confluent.io/platform/current/clients/consumer.html`
5. Confluent Kafka Design — log compaction overview: `https://docs.confluent.io/kafka/design/log_compaction.html`

---

## 27. Apa Berikutnya

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-002.md
```

Judul:

```text
Broker Internals: Storage, Page Cache, Replication, and Durability
```

Kenapa ini berikutnya?

Karena setelah memahami topic-partition-offset, kita perlu memahami bagaimana broker benar-benar menyimpan log:

- segment file,
- index file,
- page cache,
- sequential I/O,
- replication,
- leader/follower,
- ISR,
- high watermark,
- durability guarantee,
- dan kondisi nyata yang bisa menyebabkan data loss atau availability issue.

Tanpa pemahaman broker internals, konfigurasi seperti `acks`, `min.insync.replicas`, `replication.factor`, retention, dan flush policy akan terasa seperti hafalan.

---

## Status Seri

```text
Part 000 selesai.
Part 001 selesai.
Part 002 belum dibuat.
...
Part 034 belum dibuat.
```

Seri belum selesai dan belum mencapai bagian terakhir.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation: Kafka as a Distributed Log, Not Just a Queue</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-002.md">Part 002 — Broker Internals: Storage, Page Cache, Replication, and Durability ➡️</a>
</div>

# learn-kafka-event-streaming-mastery-for-java-engineers-part-002.md

# Part 002 — Broker Internals: Storage, Page Cache, Replication, and Durability

> Seri: Kafka, Kafka ksqlDB, Kafka Connect, dan Event Streaming Mastery untuk Java Software Engineer
>
> Status seri: **Part 002 dari 034**
>
> Fokus: memahami Kafka broker dari dalam: bagaimana record disimpan, dibaca, direplikasi, diakui, dan kapan guarantee durability benar-benar berlaku.

---

## 0. Kenapa Part Ini Penting

Di Part 000 kita memposisikan Kafka sebagai **distributed commit log**, bukan sekadar message broker. Di Part 001 kita membangun mental model tentang **topic, partition, offset, ordering, dan replay**.

Part 002 masuk ke lapisan yang lebih dalam: **broker internals**.

Kafka sering terdengar sederhana:

```text
producer -> broker -> consumer
```

Tapi production Kafka incident jarang sesederhana itu. Incident yang sebenarnya biasanya berbentuk:

```text
producer ack sukses, tapi data hilang setelah failover
consumer lag naik padahal broker CPU rendah
under-replicated partitions naik saat disk lambat
acks=all dipakai tapi durability ternyata masih lemah
partition leader pindah dan consumer tidak melihat record tertentu
broker restart lalu restore lambat karena page cache dingin
```

Untuk memahami kasus seperti itu, kita perlu masuk ke mekanisme broker:

1. Kafka menyimpan data sebagai **log segment files**.
2. Kafka mengandalkan **sequential I/O** dan **OS page cache**.
3. Kafka memakai **partition leader** sebagai authority untuk read/write.
4. Kafka mereplikasi log dari leader ke follower.
5. Kafka menentukan record yang aman dibaca melalui **high watermark**.
6. Kafka durability bergantung pada kombinasi producer config, topic config, cluster health, dan failure timing.

Part ini penting karena banyak engineer mengira Kafka durable “karena replication factor 3”. Itu belum cukup. Durability Kafka baru bermakna jika kita memahami hubungan antara:

```text
replication.factor
min.insync.replicas
acks
ISR
leader election
high watermark
producer retry/idempotence
unclean leader election
disk behavior
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Menjelaskan bagaimana Kafka menyimpan record di disk.
2. Menjelaskan perbedaan logical log dan physical segment files.
3. Memahami mengapa Kafka bisa cepat walaupun menulis ke disk.
4. Memahami peran OS page cache dalam performa Kafka.
5. Menjelaskan zero-copy secara mental model.
6. Memahami leader-follower replication per partition.
7. Menjelaskan ISR, high watermark, dan leader epoch secara konseptual.
8. Memahami hubungan antara `acks`, `replication.factor`, dan `min.insync.replicas`.
9. Menganalisis kapan data bisa hilang meskipun Kafka memakai replication.
10. Membedakan durability guarantee yang diberikan broker dari guarantee end-to-end aplikasi.
11. Membaca beberapa sinyal operational penting seperti under-replicated partition, offline partition, ISR shrink, dan disk pressure.
12. Mengambil keputusan konfigurasi broker/topik secara defensible, bukan copy-paste.

---

## 2. Mental Model Utama

Kafka broker adalah server yang menyimpan banyak partition log.

Satu topic partition secara logical terlihat seperti ini:

```text
Topic: case-events
Partition: 0

Offset:   0      1      2      3      4      5      6
Record:  e0     e1     e2     e3     e4     e5     e6
```

Tapi secara physical di broker, partition itu disimpan sebagai kumpulan segment file:

```text
/data/kafka-logs/case-events-0/
  00000000000000000000.log
  00000000000000000000.index
  00000000000000000000.timeindex
  00000000000000000000.snapshot / txnindex / leader-epoch-checkpoint ...

  00000000000000010420.log
  00000000000000010420.index
  00000000000000010420.timeindex

  00000000000000022100.log
  00000000000000022100.index
  00000000000000022100.timeindex
```

Intinya:

```text
logical partition log
        ↓
physical directory per partition replica
        ↓
multiple segment files
        ↓
append-only writes to active segment
        ↓
old segments retained, compacted, or deleted based on policy
```

Kafka cepat karena ia tidak memperlakukan disk seperti random-access database OLTP. Kafka memperlakukan disk seperti **sequential append log**.

Perbandingan kasar:

```text
Random write database mindset:
  update row A
  update row B
  update index X
  update index Y
  flush page
  handle lock/latch/contention

Kafka log mindset:
  append record batch to end of file
  update sparse offset/time index
  rely on OS page cache
  replicate sequentially
```

Itulah sebabnya Kafka bisa menyimpan data durable sekaligus tetap throughput tinggi.

---

## 3. Broker sebagai Pemilik Physical Partition Replica

Topic adalah logical abstraction. Partition adalah unit ordering dan parallelism. Broker menyimpan **replica** dari partition.

Misal topic `case-events` punya:

```text
partitions = 3
replication.factor = 3
```

Maka ada 9 partition replica:

```text
case-events-0 replica di broker 1, 2, 3
case-events-1 replica di broker 2, 3, 4
case-events-2 replica di broker 3, 4, 1
```

Satu replica akan menjadi **leader** untuk partition tersebut. Replica lain menjadi **follower**.

Contoh:

```text
Partition case-events-0

Broker 1: leader
Broker 2: follower
Broker 3: follower
```

Producer menulis ke leader. Consumer membaca dari leader secara default. Follower mereplikasi dari leader.

```text
Producer
   |
   v
Broker 1 leader for case-events-0
   |
   | replication fetch
   v
Broker 2 follower
Broker 3 follower
```

Konsekuensi penting:

1. Leadership terjadi per partition, bukan per topic.
2. Satu broker bisa leader untuk beberapa partition dan follower untuk partition lain.
3. Load Kafka harus dilihat dari distribusi partition leadership, bukan hanya jumlah broker.
4. Broker yang menyimpan banyak leader partition lebih berat daripada broker yang kebanyakan follower.
5. Saat leader pindah, latency dan availability bisa berubah sementara.

---

## 4. Dari Record ke Log Segment

Producer tidak selalu mengirim satu record satu network request. Producer biasanya mengirim **record batch**.

Record batch itu masuk ke broker, lalu broker append batch ke active segment partition.

```text
Producer batch
  [r100, r101, r102, r103]
        |
        v
Leader broker append to active .log segment
        |
        v
Offset assigned
  r100 -> offset 5000
  r101 -> offset 5001
  r102 -> offset 5002
  r103 -> offset 5003
```

Important mental model:

```text
Offset ditetapkan oleh broker saat append ke partition log.
```

Offset bukan dikirim oleh producer sebagai identity bisnis.

### 4.1 File `.log`

File `.log` menyimpan record batch secara berurutan.

Satu segment file punya base offset. Contoh:

```text
00000000000000000000.log      berisi offset 0 sampai 10419
00000000000000010420.log      berisi offset 10420 sampai 22099
00000000000000022100.log      berisi offset 22100 dan seterusnya
```

Nama file menggunakan base offset supaya Kafka bisa menemukan segment yang relevan.

### 4.2 File `.index`

File `.index` adalah sparse offset index.

Ia tidak menyimpan setiap offset. Ia menyimpan mapping sebagian offset ke posisi byte di file `.log`.

Contoh mental model:

```text
.index
  offset relative 0     -> file position 0
  offset relative 500   -> file position 128000
  offset relative 1000  -> file position 256000
```

Kenapa sparse?

Karena Kafka tidak perlu index terlalu detail. Log bersifat sequential. Kafka hanya perlu melompat mendekati posisi yang benar, lalu scan sedikit.

### 4.3 File `.timeindex`

File `.timeindex` membantu lookup berdasarkan timestamp.

Ini dipakai untuk operasi seperti mencari offset berdasarkan waktu:

```text
read from timestamp >= 2026-06-19T10:00:00Z
```

Use case:

1. Replay sejak waktu tertentu.
2. Consumer reset berdasarkan timestamp.
3. Debugging incident berdasarkan waktu kejadian.
4. Reprocessing window tertentu.

### 4.4 Active Segment vs Closed Segment

Hanya segment terakhir yang aktif untuk append.

```text
Segment 0      closed
Segment 10420  closed
Segment 22100  active append target
```

Kafka melakukan segment rolling berdasarkan konfigurasi seperti:

```text
log.segment.bytes
log.roll.ms
log.roll.hours
```

Rolling segment penting karena retention dan compaction bekerja pada segment, bukan pada record individual secara langsung.

---

## 5. Mengapa Kafka Cepat Walaupun Menulis ke Disk

Banyak orang punya asumsi:

```text
memory = fast
disk = slow
```

Asumsi itu terlalu kasar.

Yang lebih tepat:

```text
sequential disk I/O bisa sangat cepat
random disk I/O bisa sangat lambat
OS page cache bisa membuat disk read terasa seperti memory read
network dan serialization sering menjadi bottleneck sebelum disk
```

Kafka dirancang agar hot path-nya dominan sequential:

```text
producer append -> sequential write
consumer read   -> sequential read
replication     -> sequential fetch
```

### 5.1 Sequential Append

Kafka tidak update record lama di tempat. Kafka append record baru ke akhir log.

```text
before:
[record 0][record 1][record 2]

append record 3:
[record 0][record 1][record 2][record 3]
```

Ini berbeda dari sistem yang sering melakukan random write:

```text
update row X somewhere in file
update index page somewhere else
update metadata elsewhere
```

Append-only membuat write path lebih sederhana:

1. Tidak perlu mencari posisi lama record.
2. Tidak perlu overwrite random page.
3. Tidak perlu banyak index update kompleks.
4. Lebih cocok untuk batching.
5. Lebih cocok untuk replication sequential.

### 5.2 Batch-Oriented Storage

Producer mengirim batch, broker menyimpan batch, follower mereplikasi batch, consumer fetch batch.

```text
record-by-record mindset:
  expensive per message overhead

batch mindset:
  amortize system call, network roundtrip, compression, checksum, replication
```

Batching adalah salah satu alasan Kafka throughput tinggi.

### 5.3 OS Page Cache

Kafka secara historis tidak mencoba menyimpan semua data di JVM heap. Kafka memanfaatkan OS page cache.

Mental model page cache:

```text
Application writes file
        ↓
OS stores dirty pages in memory page cache
        ↓
OS flushes pages to disk according to policy
```

Untuk read:

```text
Consumer reads recently written data
        ↓
OS may serve from page cache
        ↓
No physical disk read needed if page is hot
```

Ini sangat cocok dengan Kafka karena banyak consumer membaca data yang baru saja ditulis.

```text
producer writes hot data
        ↓
data enters page cache
        ↓
consumer/follower reads same hot data
        ↓
served from page cache
```

### 5.4 Kenapa Tidak Menaruh Semua di JVM Heap?

Karena JVM heap besar punya masalah:

1. Garbage collection pressure.
2. Object overhead.
3. Copy dari heap ke kernel buffer untuk network I/O.
4. Memory duplication antara application cache dan OS page cache.
5. Restart kehilangan warm cache di proses, sementara OS page cache bisa tetap relevan lebih natural tergantung kondisi.

Kafka lebih suka menyimpan data sebagai bytes di file dan membiarkan OS mengelola caching.

### 5.5 Zero-Copy Mental Model

Tanpa zero-copy, path read dari disk ke network bisa seperti ini:

```text
Disk -> kernel page cache -> user-space buffer -> socket buffer -> network card
```

Dengan zero-copy/sendfile-style optimization, Kafka dapat mengurangi copy ke user-space:

```text
Disk/page cache -> kernel socket path -> network card
```

Makna praktis:

1. CPU lebih rendah.
2. Memory copy lebih sedikit.
3. Cache pollution lebih rendah.
4. Throughput consumer/replication lebih tinggi.

Zero-copy bukan berarti tidak ada copy sama sekali secara fisik dalam semua layer hardware/OS. Maksud praktisnya adalah Kafka menghindari copy mahal ke user-space untuk path tertentu.

---

## 6. Write Path Broker: Dari Producer Request ke Acknowledgement

Mari kita lihat alur saat producer mengirim record ke Kafka.

```text
1. Producer menentukan target topic partition.
2. Producer mengirim ProduceRequest ke broker leader partition.
3. Broker menerima request di network thread.
4. Request diproses oleh request handler.
5. Record batch divalidasi.
6. Broker append batch ke local leader log.
7. Follower mereplikasi dari leader.
8. Broker menentukan apakah syarat ack terpenuhi.
9. Broker mengirim response ke producer.
```

Ack behavior tergantung `acks` producer config.

### 6.1 `acks=0`

Producer tidak menunggu acknowledgement dari broker.

```text
producer send -> fire and forget
```

Konsekuensi:

1. Throughput bisa tinggi.
2. Latency rendah secara nominal.
3. Producer bisa tidak tahu kalau broker gagal menerima data.
4. Data loss sangat mungkin.

Cocok hanya untuk telemetry yang benar-benar disposable.

Untuk sistem enforcement, case management, payment, compliance, audit, `acks=0` hampir selalu salah.

### 6.2 `acks=1`

Leader acknowledge setelah append ke local log leader.

```text
Producer -> Leader append local -> ack
                    |
                    | follower replication may happen later
                    v
                 Followers
```

Risiko:

1. Leader menerima record.
2. Leader mengirim ack ke producer.
3. Leader crash sebelum follower mereplikasi record.
4. Follower yang belum punya record menjadi leader baru.
5. Record yang sudah di-ack bisa hilang.

Jadi `acks=1` bukan guarantee durability lintas broker.

### 6.3 `acks=all`

Leader acknowledge setelah record berhasil direplikasi ke cukup replica in-sync sesuai `min.insync.replicas`.

```text
replication.factor=3
min.insync.replicas=2
acks=all

Producer -> Leader append
              |
              +-> wait until at least 2 ISR replicas have record
              |
              v
            ack to producer
```

Ini konfigurasi umum untuk durability yang lebih kuat.

Tapi harus dipahami:

```text
acks=all tidak berarti semua replica harus punya record.
acks=all berarti semua syarat in-sync replica minimum terpenuhi.
```

Kalau `min.insync.replicas=1`, maka `acks=all` bisa menjadi tidak jauh berbeda dari `acks=1` dari sudut durability lintas broker.

---

## 7. Replication Factor, ISR, dan min.insync.replicas

### 7.1 Replication Factor

`replication.factor` menentukan berapa banyak replica partition disimpan.

```text
replication.factor=3

Partition P0:
  broker 1 leader
  broker 2 follower
  broker 3 follower
```

Replication factor 3 berarti ada tiga copy jika semua replica sehat.

Tapi durability saat write bukan hanya soal jumlah copy yang *dikonfigurasi*. Yang penting adalah berapa replica yang benar-benar **in sync** saat write terjadi.

### 7.2 ISR: In-Sync Replicas

ISR adalah set replica yang dianggap cukup up-to-date terhadap leader.

```text
Partition P0 replicas: [1,2,3]
Leader: 1
ISR: [1,2,3]
```

Jika broker 3 lambat atau terputus:

```text
Partition P0 replicas: [1,2,3]
Leader: 1
ISR: [1,2]
Broker 3 out of sync
```

Jika tinggal leader saja yang sehat:

```text
Partition P0 replicas: [1,2,3]
Leader: 1
ISR: [1]
```

Ini situasi berbahaya untuk durability.

### 7.3 min.insync.replicas

`min.insync.replicas` menentukan jumlah minimal ISR yang harus menerima write agar producer dengan `acks=all` mendapat ack sukses.

Contoh recommended baseline untuk banyak workload penting:

```text
replication.factor=3
min.insync.replicas=2
producer acks=all
```

Interpretasi:

```text
Harus ada minimal 2 replica in-sync yang menerima record sebelum write dianggap sukses.
```

Jika ISR turun menjadi 1:

```text
ISR: [leader only]
min.insync.replicas=2
acks=all
```

Maka producer akan menerima error seperti insufficient replicas, bukan silent success.

Ini bagus. Sistem menjadi **unavailable for writes** daripada menerima write yang durability-nya terlalu lemah.

Trade-off:

```text
higher durability -> possible write unavailability during replica degradation
higher availability -> possible data loss under failure
```

Tidak ada konfigurasi yang menghapus trade-off ini.

---

## 8. High Watermark: Batas Aman yang Bisa Dibaca Consumer

High watermark adalah konsep penting.

Mental model:

```text
Leader log:
offset 0 1 2 3 4 5 6 7 8 9

Follower A replicated up to 9
Follower B replicated up to 7

High watermark = 7
```

Record setelah high watermark belum dianggap committed/aman untuk consumer karena belum direplikasi cukup jauh oleh ISR.

Consumer hanya boleh membaca sampai high watermark, bukan selalu sampai ujung leader log.

Kenapa?

Karena jika leader crash, record yang belum mencapai high watermark bisa hilang saat leader baru dipilih.

Contoh:

```text
Leader has:   0 1 2 3 4 5 6 7 8 9
Follower has: 0 1 2 3 4 5 6 7

Consumer visible: 0..7
Not yet visible: 8..9
```

Ini menjaga agar consumer tidak melihat record yang kemudian hilang karena failover.

### 8.1 High Watermark vs Log End Offset

Ada beberapa posisi penting:

```text
Log Start Offset     offset paling awal yang masih tersedia
High Watermark       offset tertinggi yang committed/visible
Log End Offset       offset setelah record terakhir di leader log
Committed Offset     posisi yang disimpan consumer group
Consumer Position    posisi read consumer saat ini
```

Jangan campur semua istilah ini.

Contoh:

```text
Log Start Offset: 1000
High Watermark:   5000
Log End Offset:   5004
Consumer Commit:  4300
Consumer Position:4350
```

Interpretasi:

1. Record sebelum 1000 sudah tidak tersedia karena retention.
2. Record sampai 4999 visible untuk consumer.
3. Record 5000-5003 mungkin sudah ada di leader tapi belum committed/visible.
4. Consumer group terakhir commit 4300.
5. Consumer instance sedang membaca sampai 4350.

---

## 9. Leader and Follower Replication Flow

Follower mereplikasi dari leader dengan fetch request, mirip consumer internal.

```text
Follower -> Leader: fetch from offset N
Leader -> Follower: records N..M
Follower append to local log
Follower -> Leader: fetch from offset M+1
```

Jika follower terus mengikuti leader dalam batas tertentu, ia tetap di ISR.

Jika follower terlalu lambat, ia keluar dari ISR.

Penyebab follower keluar ISR:

1. Broker follower down.
2. Network lambat.
3. Disk follower lambat.
4. GC pause.
5. CPU saturation.
6. Fetch thread tertahan.
7. Broker overload.

### 9.1 Replication Lag Bukan Consumer Lag

Ada dua jenis lag yang sering tertukar:

```text
Consumer lag:
  consumer tertinggal dari topic high watermark/log end

Replica lag:
  follower replica tertinggal dari leader
```

Keduanya berbeda.

Consumer lag mempengaruhi aplikasi consumer.

Replica lag mempengaruhi durability dan availability Kafka.

---

## 10. Disk Flush dan Durability Realistis

Kafka append ke file. Tapi kapan data benar-benar sampai ke persistent disk?

Ada beberapa lapisan:

```text
Kafka process
  -> OS page cache
    -> disk controller/cache
      -> physical storage/media
```

Kafka biasanya mengandalkan replication lebih daripada forcing fsync setiap message.

Kenapa?

Karena fsync setiap write akan sangat mahal.

Instead, Kafka mengandalkan:

1. Append to local log.
2. Replication to other brokers.
3. OS flushing policy.
4. Failure independence antar broker/disk.

Durability Kafka adalah kombinasi antara:

```text
replication durability + storage durability + acknowledgement policy
```

Bukan hanya “file sudah ditulis”.

### 10.1 Bahaya Salah Paham Page Cache

Saat broker append, data bisa berada di page cache sebelum flush fisik.

Jika satu broker mati mendadak, data di page cache broker itu bisa hilang.

Tapi jika record sudah direplikasi ke broker lain, Kafka masih bisa survive single broker failure.

Maka durability Kafka lebih banyak mengandalkan replication quorum-like behavior, bukan fsync per record.

### 10.2 Apa Artinya untuk Production?

Untuk workload penting:

```text
replication.factor=3
min.insync.replicas=2
producer acks=all
enable.idempotence=true
unclean.leader.election.enable=false
```

Ini bukan silver bullet, tapi baseline yang jauh lebih masuk akal daripada default sembarang.

---

## 11. Failure Scenario: Data Hilang dengan `acks=1`

Mari lihat scenario konkret.

Konfigurasi:

```text
replication.factor=3
producer acks=1
```

State awal:

```text
Partition P0
Leader: broker 1
Followers: broker 2, broker 3
ISR: [1,2,3]
```

Step:

```text
1. Producer mengirim record R offset 100.
2. Broker 1 append R ke local log.
3. Broker 1 mengirim ack ke producer karena acks=1.
4. Sebelum broker 2 dan 3 fetch R, broker 1 crash total.
5. Broker 2 dipilih menjadi leader.
6. Broker 2 tidak punya R.
7. Offset 100 hilang dari committed history.
```

Dari sudut producer:

```text
send succeeded
```

Dari sudut sistem:

```text
record lost
```

Inilah alasan `acks=1` tidak cukup untuk data penting.

---

## 12. Failure Scenario: `acks=all` Tapi `min.insync.replicas=1`

Konfigurasi:

```text
replication.factor=3
min.insync.replicas=1
producer acks=all
```

Pada awalnya terlihat aman karena `acks=all`. Tapi lihat saat ISR turun:

```text
ISR: [broker 1 only]
Leader: broker 1
```

Producer mengirim record R.

Karena `min.insync.replicas=1`, leader sendiri cukup untuk memenuhi syarat.

```text
Leader append R
acks=all satisfied because ISR count requirement = 1
ack success
```

Lalu broker 1 crash sebelum broker lain catch up.

Result:

```text
record acknowledged but lost
```

Pelajaran:

```text
acks=all only meaningful when min.insync.replicas > 1
```

---

## 13. Failure Scenario: Write Unavailable Itu Kadang Benar

Konfigurasi:

```text
replication.factor=3
min.insync.replicas=2
producer acks=all
```

State sehat:

```text
ISR: [1,2,3]
```

Broker 2 dan 3 bermasalah:

```text
ISR: [1]
```

Producer mencoba write.

Kafka menolak write karena syarat durability tidak terpenuhi.

```text
NotEnoughReplicas / NotEnoughReplicasAfterAppend
```

Engineer junior mungkin berkata:

```text
Kafka down, buruk.
```

Engineer senior melihat:

```text
Kafka sedang mencegah acknowledged data loss.
```

Ini keputusan desain:

```text
Apakah lebih baik menerima write tapi mungkin hilang?
Atau menolak write sampai durability minimum pulih?
```

Untuk sistem audit/regulatory, jawaban biasanya:

```text
Tolak write lebih baik daripada silently lose acknowledged evidence.
```

Tapi untuk telemetry disposable, mungkin berbeda.

---

## 14. Unclean Leader Election

Leader election normal memilih leader baru dari ISR.

```text
ISR: [1,2]
Leader 1 crash
Broker 2 becomes leader
```

Karena broker 2 in-sync, datanya aman sampai high watermark.

Unclean leader election memungkinkan replica yang tidak in-sync menjadi leader.

Contoh:

```text
Replicas: [1,2,3]
Leader: 1
ISR: [1]
Broker 2 and 3 are stale
Broker 1 crash
```

Jika unclean election allowed:

```text
Broker 2 may become leader even though stale
```

Akibat:

```text
records that existed only on broker 1 can be lost
```

Trade-off:

```text
unclean leader election enabled:
  higher availability
  possible data loss

unclean leader election disabled:
  lower data loss risk
  possible partition unavailability
```

Untuk workload penting, unclean leader election biasanya harus disabled.

---

## 15. Broker Request Path: Network Threads, Request Queue, I/O Threads

Secara sederhana, broker memproses request melalui beberapa layer:

```text
client connection
   ↓
network processor thread
   ↓
request queue
   ↓
request handler / I/O thread
   ↓
log append / fetch / metadata operation
   ↓
response queue
   ↓
network response
```

Jika broker lambat, penyebabnya bisa di banyak tempat:

1. Network thread saturated.
2. Request queue penuh.
3. Request handler idle rendah.
4. Disk I/O lambat.
5. Page cache miss tinggi.
6. Replication throttled.
7. Controller/metadata issue.
8. GC pause.
9. Too many partitions.
10. Large messages.

Jangan langsung menyimpulkan “disk lambat” hanya karena latency naik.

---

## 16. Read Path Consumer

Consumer membaca dari broker leader.

Simplified flow:

```text
1. Consumer sends FetchRequest(topic partition, offset).
2. Broker checks requested offset validity.
3. Broker reads data from log segment.
4. OS may serve data from page cache.
5. Broker sends records to consumer.
6. Consumer advances position locally.
7. Consumer may commit offset separately.
```

Important:

```text
read offset dan committed offset adalah dua hal berbeda
```

Broker hanya menyajikan records. Consumer group offset management dibahas lebih dalam di Part 006 dan 007.

### 16.1 Fetch from Page Cache

Jika consumer membaca data yang baru ditulis, data mungkin masih di page cache.

```text
producer writes at time T
consumer fetches at time T+100ms
```

Read bisa sangat cepat.

Jika consumer replay data lama yang tidak lagi di page cache:

```text
consumer fetches records from 2 days ago
```

Broker mungkin harus read dari disk/object storage/tiered storage tergantung setup.

Konsekuensi:

```text
hot path read != cold replay read
```

Jangan load test hanya hot data lalu mengklaim replay lama akan sama cepat.

---

## 17. Retention: Mengapa Kafka Tidak Menyimpan Semua Selamanya Secara Default

Kafka log tumbuh terus jika tidak dihapus.

Retention menentukan kapan segment lama bisa dihapus.

Common policies:

```text
retention.ms
retention.bytes
cleanup.policy=delete
cleanup.policy=compact
cleanup.policy=compact,delete
```

Di part ini kita fokus `delete` retention.

Jika retention 7 hari:

```text
records older than 7 days may be deleted when segment eligible
```

Penting:

```text
retention bekerja pada segment, bukan record individual satu per satu secara real-time
```

Jadi record bisa hidup sedikit lebih lama dari retention nominal tergantung segment boundary.

### 17.1 Retention dan Log Start Offset

Jika retention menghapus segment lama, log start offset naik.

```text
Before deletion:
Log Start Offset = 0
Log End Offset   = 1,000,000

After old segments deleted:
Log Start Offset = 300,000
Log End Offset   = 1,000,000
```

Consumer yang ingin membaca offset 100,000 akan gagal karena data sudah tidak ada.

Error semacam:

```text
offset out of range
```

Ini sangat penting untuk replay/backfill design.

---

## 18. Segment Rolling dan Operational Consequences

Segment rolling menentukan granularity retention dan compaction.

Jika segment terlalu besar:

```text
retention deletion lebih kasar
recovery scan bisa lebih berat
compaction eligibility lebih lambat
```

Jika segment terlalu kecil:

```text
file count tinggi
open file pressure
index overhead
metadata overhead
```

Tidak ada satu nilai ideal untuk semua workload.

Pertanyaan yang harus ditanyakan:

1. Berapa throughput per partition?
2. Berapa retention?
3. Berapa ukuran record rata-rata?
4. Apakah topic compacted?
5. Apakah banyak replay lama?
6. Apakah filesystem/inode/open file limit cukup?
7. Apakah broker punya ribuan partition kecil?

---

## 19. Broker Disk Layout

Kafka menyimpan partition replica pada log directories.

Contoh:

```text
log.dirs=/mnt/disk1/kafka-logs,/mnt/disk2/kafka-logs,/mnt/disk3/kafka-logs
```

Kafka menempatkan partition replica pada salah satu log dir.

Operational implication:

1. Disk penuh bisa membuat broker bermasalah.
2. Disk lambat bisa menyebabkan follower lag.
3. Disk failure bisa membuat replica offline.
4. Reassignment partition antar broker/disk butuh bandwidth.
5. JBOD vs RAID punya trade-off.

### 19.1 Disk Full

Disk full adalah salah satu incident Kafka paling jelas tetapi dampaknya besar.

Jika broker tidak bisa append:

```text
producer write latency/error naik
replication terganggu
partition bisa offline
broker bisa crash/stop
```

Disk usage harus dimonitor dengan serius:

```text
disk used %
log dir offline count
retention headroom
incoming bytes rate
time to full estimate
```

---

## 20. Replication Placement dan Rack Awareness

Jika semua replica partition berada di physical failure domain yang sama, replication factor menipu.

Bad placement:

```text
broker 1 rack A
broker 2 rack A
broker 3 rack A

Partition P0 replicas: broker 1,2,3
```

Jika rack A mati, semua replica hilang.

Better placement:

```text
broker 1 rack A
broker 2 rack B
broker 3 rack C

Partition P0 replicas: broker 1,2,3
```

Kafka mendukung rack awareness agar replica tersebar antar rack/AZ.

Untuk cloud deployment, failure domain biasanya:

```text
availability zone
node group
storage class
network segment
region
```

Production thinking:

```text
replication.factor=3 hanya bermakna jika replica tersebar di failure domain independen
```

---

## 21. Durability Matrix

Berikut matrix sederhana.

| replication.factor | min.insync.replicas | producer acks | Behavior | Risiko |
|---:|---:|---|---|---|
| 1 | 1 | 1/all | Single copy write | Broker loss = data loss |
| 3 | 1 | 1 | Ack after leader append | Acked data can be lost on leader crash |
| 3 | 1 | all | Looks strong but weak when ISR=1 | Acked data can still be lost |
| 3 | 2 | all | Common durable baseline | Write unavailable if ISR < 2 |
| 5 | 3 | all | Stronger tolerance | More cost, latency, replication overhead |

Untuk banyak sistem production penting:

```text
replication.factor=3
min.insync.replicas=2
acks=all
enable.idempotence=true
```

Tetapi tetap perlu:

1. Monitoring ISR.
2. Alert under-replicated partitions.
3. Rack awareness.
4. Disk health.
5. Retry/idempotence.
6. Application idempotency.

---

## 22. Java Engineer Perspective: Apa yang Harus Kamu Pedulikan dari Broker Internals?

Sebagai Java engineer, kamu mungkin tidak mengelola broker setiap hari. Tapi pemahaman broker internals tetap penting karena pilihan client/config kamu langsung mempengaruhi durability dan performance.

### 22.1 Producer Config yang Tidak Boleh Dipilih Sembarangan

Untuk event penting:

```properties
acks=all
enable.idempotence=true
retries=2147483647
max.in.flight.requests.per.connection=5
delivery.timeout.ms=120000
request.timeout.ms=30000
linger.ms=5
batch.size=32768
compression.type=zstd
```

Catatan:

1. Ini bukan template universal.
2. `linger.ms` dan `batch.size` harus disesuaikan latency/throughput target.
3. Compression bergantung CPU dan payload.
4. `delivery.timeout.ms` harus konsisten dengan retry behavior.
5. `acks=all` butuh topic/broker `min.insync.replicas` yang benar.

### 22.2 Topic Config yang Harus Ditanyakan ke Platform Team

Saat membuat topic penting, jangan hanya minta nama topic.

Tanyakan:

```text
replication.factor berapa?
min.insync.replicas berapa?
retention.ms berapa?
cleanup.policy apa?
partition count berapa?
rack awareness aktif?
unclean leader election disabled?
quota ada?
ACL siapa saja?
schema compatibility policy apa?
```

### 22.3 Consumer Design Dipengaruhi Retention

Jika consumer bisa down 3 hari, retention 1 hari tidak cukup.

Jika audit replay butuh 7 tahun, Kafka hot retention mungkin bukan tempat tunggal yang cocok. Mungkin perlu:

```text
Kafka retention: 7-30 days for operational replay
Object storage/archive: long-term immutable retention
Database/read model: query-serving projection
```

Jangan memaksa Kafka menjadi arsip abadi tanpa memahami cost dan operational impact.

---

## 23. Production Failure Modes

### 23.1 Under-Replicated Partitions

Under-replicated partition berarti ada replica yang seharusnya in-sync tapi tertinggal/tidak tersedia.

Dampak:

1. Durability menurun.
2. Producer dengan `acks=all` bisa mulai error jika ISR turun di bawah minimum.
3. Failover risk meningkat.

Possible causes:

1. Broker down.
2. Disk lambat.
3. Network issue.
4. Broker overload.
5. Reassignment terlalu agresif.
6. GC pause.

### 23.2 Offline Partitions

Offline partition berarti tidak ada leader available.

Dampak:

```text
produce unavailable
consume unavailable
```

Ini lebih serius daripada under-replicated.

### 23.3 ISR Shrink/Expand Flapping

ISR sering shrink/expand menunjukkan instability.

Possible causes:

1. Network jitter.
2. Follower disk latency.
3. Broker overloaded.
4. Replication fetch lag.
5. Too many partitions.

Flapping membuat latency dan durability tidak stabil.

### 23.4 Slow Disk Causes Cascading Failure

Disk lambat pada follower:

```text
follower cannot append replication fast enough
        ↓
follower exits ISR
        ↓
ISR shrinks
        ↓
acks=all writes may fail if min ISR not met
        ↓
producer retry storm
        ↓
broker/network load rises
        ↓
cluster worsens
```

### 23.5 Cold Page Cache After Restart

Broker restart bisa membuat access pattern berubah.

Jika banyak consumer membaca data lama atau restore state setelah restart:

```text
page cache miss rises
disk read rises
fetch latency rises
consumer lag rises
```

Ini alasan rolling restart harus dipantau, bukan hanya “process started”.

---

## 24. Anti-Patterns

### Anti-Pattern 1: “Replication Factor 3 Berarti Aman”

Salah.

Aman relatif terhadap:

```text
ISR health
acks
min.insync.replicas
leader election policy
rack placement
disk durability
operator behavior
```

### Anti-Pattern 2: `acks=all` Tapi Tidak Cek `min.insync.replicas`

`acks=all` dengan `min.insync.replicas=1` bisa memberi rasa aman palsu.

### Anti-Pattern 3: Semua Topic Pakai Config Sama

Telemetry disposable dan audit event tidak seharusnya punya durability/retention yang sama.

### Anti-Pattern 4: Menganggap Kafka Sama dengan Database OLTP

Kafka bukan tempat untuk update random record by primary key.

Kafka adalah log. State terbaru bisa dibangun dari log, tapi log bukan row-store mutable.

### Anti-Pattern 5: Retention Pendek untuk Sistem yang Butuh Replay Panjang

Jika downstream bisa outage 3 hari, retention 24 jam adalah bom waktu.

### Anti-Pattern 6: Terlalu Banyak Partition Kecil

Partition terlalu banyak bisa meningkatkan:

1. File handle.
2. Metadata overhead.
3. Recovery time.
4. Leader election complexity.
5. Replication overhead.

### Anti-Pattern 7: Mengabaikan Disk Karena “Kafka Pakai Page Cache”

Page cache membantu, tapi disk tetap penting untuk:

1. Cold reads.
2. Recovery.
3. Retention volume.
4. Replication catch-up.
5. Segment deletion/compaction.

---

## 25. Design Trade-Offs

### 25.1 Durability vs Availability

```text
min.insync.replicas high
  + stronger durability
  - more write unavailability during failure

min.insync.replicas low
  + higher write availability
  - higher acknowledged data loss risk
```

### 25.2 Throughput vs Latency

```text
larger batch / linger
  + throughput up
  + compression better
  - per-record latency can increase

smaller batch / low linger
  + latency lower
  - throughput lower
  - more request overhead
```

### 25.3 Retention vs Cost

```text
long retention
  + replay/backfill safer
  + consumer outage tolerance higher
  - disk/storage cost higher
  - recovery/index management more demanding
```

### 25.4 Partition Count vs Operational Overhead

```text
more partitions
  + more parallelism
  + more throughput potential
  - more metadata
  - more files
  - more leader elections
  - harder rebalancing
```

### 25.5 Compression vs CPU

```text
compression
  + network/disk lower
  + storage lower
  - CPU higher
  - latency can increase depending codec/payload
```

---

## 26. Broker Internals Checklist untuk Design Review

Saat review desain Kafka, gunakan checklist ini.

### 26.1 Topic Durability

```text
[ ] replication.factor sesuai criticality?
[ ] min.insync.replicas minimal 2 untuk RF=3?
[ ] producer acks=all untuk event penting?
[ ] idempotent producer enabled?
[ ] unclean leader election disabled?
[ ] replica tersebar across rack/AZ?
```

### 26.2 Storage and Retention

```text
[ ] retention.ms cukup untuk outage/replay SLA?
[ ] retention.bytes realistis terhadap disk capacity?
[ ] segment size sesuai retention granularity?
[ ] disk headroom cukup?
[ ] compaction perlu atau tidak?
```

### 26.3 Operational Risk

```text
[ ] alert under-replicated partitions?
[ ] alert offline partitions?
[ ] alert ISR shrink?
[ ] alert disk usage/time-to-full?
[ ] alert request latency?
[ ] alert produce/fetch error rate?
```

### 26.4 Failure Readiness

```text
[ ] apa yang terjadi jika leader broker mati?
[ ] apa yang terjadi jika 1 AZ mati?
[ ] apa yang terjadi jika consumer down lebih lama dari retention?
[ ] apa yang terjadi jika follower lag lama?
[ ] apa yang terjadi jika producer menerima NotEnoughReplicas?
```

---

## 27. Case Management Example: Enforcement Event Durability

Bayangkan sistem regulatory enforcement lifecycle.

Topic:

```text
reg.enforcement.case-events.v1
```

Event:

```json
{
  "eventId": "evt-2026-0001",
  "eventType": "CASE_ESCALATED",
  "caseId": "CASE-123",
  "fromStage": "INVESTIGATION",
  "toStage": "ENFORCEMENT_REVIEW",
  "actorId": "user-88",
  "occurredAt": "2026-06-19T10:15:00Z",
  "reasonCode": "SLA_BREACH"
}
```

Jika event ini hilang setelah producer mendapat success, konsekuensinya serius:

1. Audit trail tidak lengkap.
2. Case state downstream salah.
3. SLA escalation tidak terjadi.
4. Regulatory explanation menjadi lemah.
5. Investigation reconstruction cacat.

Maka config topic/producer tidak boleh seperti telemetry disposable.

Reasonable baseline:

```text
replication.factor=3
min.insync.replicas=2
producer acks=all
enable.idempotence=true
unclean leader election disabled
retention >= operational replay window
archive sink for long-term evidence retention
```

Jika ISR turun menjadi 1 dan producer gagal menulis, itu bukan sekadar error teknis. Itu domain-relevant protection:

```text
Sistem memilih tidak menerima evidence transition daripada menerima dan mungkin menghilangkannya.
```

Untuk regulatory systems, ini lebih defensible.

---

## 28. Deep Reasoning: Kafka Durability Bukan Boolean

Jangan bertanya:

```text
Apakah Kafka durable?
```

Pertanyaan itu terlalu lemah.

Pertanyaan yang benar:

```text
Durable terhadap failure apa?
Dengan acknowledgement policy apa?
Dengan replication health apa?
Dengan storage placement apa?
Dengan retention berapa lama?
Dengan recovery objective apa?
Untuk data criticality level apa?
```

Contoh durability claims yang lebih presisi:

```text
Untuk topic case-events dengan RF=3, minISR=2, producer acks=all,
unclean election disabled, dan replica tersebar di 3 AZ,
sistem dapat menoleransi kehilangan satu broker/AZ tanpa acknowledged write loss,
asalkan write sudah berhasil di-ack dan minimal dua ISR menerima record.
Jika ISR turun di bawah 2, write akan gagal daripada diterima dengan durability lemah.
```

Ini jauh lebih defensible daripada:

```text
Kafka durable karena RF=3.
```

---

## 29. Latihan Mental Model

### Latihan 1

Konfigurasi:

```text
replication.factor=3
min.insync.replicas=2
acks=all
ISR=[broker1, broker2, broker3]
Leader=broker1
```

Producer write record R. Broker 1 dan broker 2 sudah append. Broker 3 belum. Apakah producer bisa mendapat ack?

Jawaban:

```text
Ya, karena min.insync.replicas=2 terpenuhi oleh broker1 dan broker2.
```

### Latihan 2

Setelah ack pada Latihan 1, broker 1 crash. Apakah R hilang?

Jawaban:

```text
Tidak, selama broker2 yang memiliki R dapat menjadi leader dari ISR atau ada replica in-sync lain yang memiliki record sampai high watermark.
```

### Latihan 3

Konfigurasi:

```text
replication.factor=3
min.insync.replicas=1
acks=all
ISR=[broker1]
Leader=broker1
```

Producer mendapat ack, lalu broker1 crash total. Broker2 stale menjadi leader karena unclean election enabled. Apakah acknowledged data bisa hilang?

Jawaban:

```text
Ya. Ini contoh rasa aman palsu dari acks=all tanpa minISR yang cukup dan dengan unclean election.
```

### Latihan 4

Consumer ingin membaca offset 100, tapi log start offset sudah 500 karena retention. Apa yang terjadi?

Jawaban:

```text
Consumer tidak bisa membaca offset 100. Data sudah tidak tersedia. Consumer harus reset offset sesuai policy atau dilakukan recovery/backfill dari storage lain.
```

---

## 30. Ringkasan

Kafka broker menyimpan data sebagai partition replica dalam bentuk log segment files. Kafka cepat karena desainnya memanfaatkan append-only sequential I/O, batching, OS page cache, dan zero-copy data path untuk read/fetch tertentu.

Durability Kafka bukan hanya `replication.factor`. Durability bergantung pada kombinasi:

```text
replication.factor
min.insync.replicas
producer acks
ISR health
leader election policy
rack/AZ placement
disk behavior
retention policy
```

High watermark adalah batas record yang dianggap committed/aman untuk dibaca consumer. Follower yang tertinggal keluar dari ISR. Jika ISR turun di bawah `min.insync.replicas`, producer dengan `acks=all` akan gagal menulis, dan ini sering merupakan perilaku yang benar untuk mencegah acknowledged data loss.

Untuk Java engineer, broker internals mempengaruhi keputusan client config, event criticality, replay strategy, error handling, dan production readiness. Kafka bukan magic durability box; Kafka adalah distributed log yang sangat kuat jika invariants-nya dipahami dan dijaga.

---

## 31. Apa yang Harus Diingat Sebelum Lanjut

Sebelum masuk Part 003, pastikan kamu benar-benar paham kalimat berikut:

```text
Kafka durability adalah hasil dari replicated log discipline, bukan hanya karena data ditulis ke disk.
```

Dan:

```text
Write success dari producer hanya sekuat ack policy, ISR state, dan leader election safety pada saat write itu terjadi.
```

Part berikutnya akan membahas cluster architecture modern:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-003.md
```

Dengan fokus:

```text
Kafka Cluster Architecture: KRaft, Controllers, Metadata, and Quorum
```

---

## 32. Status Seri

```text
Part 000 selesai — Orientation: Kafka as a Distributed Log, Not Just a Queue
Part 001 selesai — The Log Mental Model: Topics, Partitions, Offsets, and Ordering
Part 002 selesai — Broker Internals: Storage, Page Cache, Replication, and Durability
Part 003 berikutnya — Kafka Cluster Architecture: KRaft, Controllers, Metadata, and Quorum
```

Seri belum selesai. Masih ada Part 003 sampai Part 034.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — The Log Mental Model: Topics, Partitions, Offsets, and Ordering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-003.md">Part 003 — Kafka Cluster Architecture: KRaft, Controllers, Metadata, and Quorum ➡️</a>
</div>

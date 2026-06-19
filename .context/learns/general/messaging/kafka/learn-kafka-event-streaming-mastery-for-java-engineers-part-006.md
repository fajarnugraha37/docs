# learn-kafka-event-streaming-mastery-for-java-engineers-part-006.md

# Part 006 — Consumers Deep Dive: Poll Loop, Offset Management, Fetching, and Backpressure

> Seri: Kafka Event Streaming Mastery for Java Engineers  
> Bagian: 006 dari 034  
> Status seri: belum selesai  
> Fokus: Kafka consumer sebagai runtime stateful, bukan sekadar loop pembaca message

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami Kafka consumer sebagai **stateful distributed client** yang berinteraksi dengan broker, coordinator, assignment, offset, dan group membership.
2. Membedakan dengan jelas antara:
   - record offset,
   - current position,
   - committed offset,
   - processed offset,
   - safe-to-commit offset.
3. Menulis poll loop Java yang benar untuk production, bukan hanya contoh demo.
4. Memahami mengapa `poll()` bukan sekadar operasi baca, tetapi juga bagian dari mekanisme liveness consumer.
5. Menjelaskan efek `enable.auto.commit`, manual commit, `commitSync`, dan `commitAsync` terhadap duplicate/loss risk.
6. Mendesain strategi backpressure ketika downstream lambat.
7. Menangani poison pill, retry, DLQ, pause/resume, graceful shutdown, dan partial failure.
8. Menghubungkan konfigurasi seperti `max.poll.records`, `max.poll.interval.ms`, `session.timeout.ms`, `heartbeat.interval.ms`, `fetch.min.bytes`, dan `fetch.max.wait.ms` ke perilaku runtime.
9. Membuat mental model failure: crash sebelum commit, crash setelah side effect, rebalance saat processing, dan lag explosion.
10. Melihat consumer bukan sebagai “message handler”, tetapi sebagai **deterministic state transition runner**.

---

## 2. Mental Model Utama

Kafka consumer sering terlihat sederhana:

```java
while (true) {
    ConsumerRecords<K, V> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<K, V> record : records) {
        process(record);
    }
}
```

Tetapi ini hanya permukaan.

Secara mental, consumer adalah gabungan dari beberapa mesin kecil:

```text
KafkaConsumer =
  fetch engine
+ offset position tracker
+ offset commit client
+ group membership participant
+ heartbeat/liveness participant
+ partition assignment owner
+ deserialization boundary
+ application backpressure boundary
+ failure recovery boundary
```

Artinya, setiap consumer tidak hanya “membaca data”. Ia juga menjawab beberapa pertanyaan sulit:

1. Partition mana yang saat ini menjadi tanggung jawab saya?
2. Dari offset mana saya harus membaca?
3. Offset mana yang sudah saya baca?
4. Offset mana yang benar-benar sudah diproses?
5. Offset mana yang aman untuk saya commit?
6. Apakah saya masih dianggap hidup oleh group coordinator?
7. Apa yang terjadi kalau saya terlalu lama memproses satu batch?
8. Apa yang terjadi kalau saya crash setelah menulis ke database tetapi sebelum commit offset?
9. Apa yang terjadi kalau record tertentu selalu gagal diproses?
10. Bagaimana saya memperlambat konsumsi tanpa keluar dari consumer group?

Kalau producer adalah mesin untuk **mengirim fact ke log**, consumer adalah mesin untuk **mengubah fact dari log menjadi side effect atau derived state**.

Side effect bisa berupa:

- update database,
- panggil service lain,
- publish event baru,
- update search index,
- kirim email,
- update cache,
- menulis audit projection,
- memicu workflow escalation,
- menulis ke data warehouse,
- menghitung aggregate.

Masalahnya: Kafka hanya tahu offset. Kafka tidak tahu apakah side effect kamu berhasil.

Di sinilah kompleksitas consumer muncul.

---

## 3. Kafka Consumer dalam Arsitektur Besar

Secara sederhana:

```text
Producer -> Topic Partition Log -> Consumer -> Side Effect / Derived State
```

Tetapi secara production:

```text
                       +------------------+
                       | Group Coordinator|
                       +---------+--------+
                                 |
                                 | membership, heartbeat, assignment
                                 |
+----------+      fetch       +---v-------------+      side effect      +------------+
| Broker   | <--------------> | Kafka Consumer  | -------------------> | Database   |
| Partition|                  | Application     |                      | API/Search |
+----------+                  +-----------------+                      +------------+
       ^                               |
       |                               | commit offset
       +-------------------------------+
```

Consumer berinteraksi dengan dua hal berbeda:

1. **Partition leader broker** untuk fetch data.
2. **Group coordinator** untuk membership, heartbeat, rebalance, dan offset commit.

Ini penting karena masalah fetch dan masalah group membership bisa terjadi secara terpisah.

Contoh:

- Broker leader partition sehat, tetapi coordinator lambat.
- Consumer masih bisa fetch, tetapi commit gagal karena rebalance.
- Consumer processing terlalu lama, sehingga dianggap tidak responsif.
- Consumer masih hidup secara proses OS, tetapi tidak melakukan `poll()` cukup sering.

---

## 4. Core Terminology

### 4.1 Consumer

Consumer adalah client yang membaca record dari topic partition.

Kafka consumer tidak menghapus record dari topic. Record tetap berada di log sampai retention/compaction policy membersihkannya.

### 4.2 Consumer Group

Consumer group adalah sekumpulan consumer yang berbagi pekerjaan membaca topic.

Untuk satu consumer group:

```text
Satu partition hanya boleh dimiliki oleh satu consumer aktif dalam group yang sama.
```

Tetapi partition yang sama bisa dibaca oleh banyak group berbeda secara independen.

```text
Topic orders, partition 0
  -> consumer group billing-service
  -> consumer group search-indexer
  -> consumer group fraud-detector
  -> consumer group audit-projector
```

Masing-masing group punya committed offset sendiri.

### 4.3 Topic Partition

Partition adalah unit:

- ordering,
- parallelism,
- assignment,
- offset sequence,
- fetch,
- commit.

Consumer tidak benar-benar membaca “topic” sebagai satu kesatuan. Ia membaca satu atau lebih partition.

### 4.4 Offset

Offset adalah posisi record di dalam partition.

```text
partition-0:
  offset 0: record A
  offset 1: record B
  offset 2: record C
  offset 3: record D
```

Offset hanya meaningful di dalam partition yang sama.

Offset 10 di partition 0 tidak bisa dibandingkan dengan offset 10 di partition 1 sebagai urutan global.

### 4.5 Position

Position adalah offset berikutnya yang akan dibaca oleh consumer.

Kalau consumer baru saja membaca offset 10, maka position biasanya menjadi 11.

```text
last fetched record offset = 10
consumer position          = 11
```

### 4.6 Committed Offset

Committed offset adalah offset yang disimpan sebagai progress consumer group.

Kafka convention:

```text
committed offset = next offset to read
```

Jika offset 10 sudah selesai diproses, commit yang benar adalah 11.

Ini sering membingungkan.

```text
Processed: 0, 1, 2, 3, 4
Safe committed offset: 5
```

Artinya saat restart, consumer mulai dari offset 5.

### 4.7 Consumer Lag

Consumer lag adalah jarak antara log end offset dan committed/position offset consumer.

```text
Log end offset      = 1,000,000
Committed offset    =   990,000
Lag                 =    10,000 records
```

Tetapi lag record tidak selalu sama dengan lag waktu.

10.000 record bisa berarti:

- 1 detik backlog pada topic high-throughput,
- 3 jam backlog pada topic low-throughput,
- 1 record besar yang butuh proses 10 menit,
- 10.000 event kecil yang selesai dalam 2 detik.

Lag harus dibaca bersama throughput, processing latency, event time, dan business SLA.

---

## 5. Poll Loop: Jantung Kafka Consumer

### 5.1 Poll Loop Dasar

Bentuk paling sederhana:

```java
while (running) {
    ConsumerRecords<String, OrderEvent> records = consumer.poll(Duration.ofMillis(500));

    for (ConsumerRecord<String, OrderEvent> record : records) {
        process(record);
    }
}
```

Tetapi untuk production, ini belum cukup.

Kita perlu memikirkan:

1. commit offset,
2. exception handling,
3. poison pill,
4. graceful shutdown,
5. rebalance listener,
6. partition-level ordering,
7. slow downstream,
8. retry,
9. idempotency,
10. metrics.

### 5.2 Apa yang Dilakukan `poll()`?

`poll()` melakukan lebih dari “ambil message”.

Secara konseptual, `poll()` dapat memicu/mengelola:

1. join group,
2. maintain membership,
3. receive partition assignment,
4. send fetch request,
5. return fetched records,
6. update consumer position,
7. execute rebalance callbacks,
8. propagate deserialization/fetch errors.

Pada consumer group classic, heartbeat dikirim di background thread, tetapi progress aplikasi tetap terkait dengan polling. Jika aplikasi terlalu lama tidak memanggil `poll()`, Kafka dapat menganggap consumer tidak sehat dari perspektif progress dan memicu rebalance berdasarkan batas seperti `max.poll.interval.ms`.

Mental model praktis:

```text
poll() adalah napas consumer.
```

Kalau consumer berhenti polling terlalu lama, ia bisa kehilangan ownership partition.

### 5.3 Poll Loop sebagai State Machine

Poll loop production lebih tepat dilihat seperti state machine:

```text
START
  -> SUBSCRIBE
  -> POLL
  -> DESERIALIZE
  -> PROCESS_BATCH
  -> COMMIT_SAFE_OFFSETS
  -> POLL
  -> ...
  -> WAKEUP / SHUTDOWN
  -> FINAL_COMMIT
  -> CLOSE
```

Setiap transisi punya failure mode.

---

## 6. Offset: Position vs Commit vs Processing

Ini bagian yang wajib benar.

Bayangkan partition seperti ini:

```text
orders-0
offset 100: OrderCreated(orderId=O-1)
offset 101: OrderPaid(orderId=O-1)
offset 102: OrderCreated(orderId=O-2)
offset 103: OrderCancelled(orderId=O-1)
```

Consumer poll mengambil offset 100-103.

Setelah poll return, consumer position internal bisa bergerak ke 104, karena record sudah diberikan ke aplikasi.

Tetapi apakah offset 100-103 sudah diproses?

Belum tentu.

```text
Fetched by consumer? yes
Returned by poll? yes
Processed by application? maybe
Side effect completed? maybe
Committed? maybe
```

Kesalahan umum:

```text
Mengira record yang sudah dipoll berarti sudah aman.
```

Tidak benar.

Kafka sudah menyerahkan record ke aplikasi, tetapi aplikasi masih bisa gagal sebelum menyelesaikan side effect.

### 6.1 Lima Offset yang Harus Dibedakan

| Jenis Offset | Arti | Disimpan di mana? |
|---|---|---|
| Record offset | Posisi record di partition | Kafka log |
| Consumer position | Offset berikutnya yang akan dipoll | Memory consumer client |
| Processed offset | Offset terakhir yang berhasil diproses aplikasi | Aplikasi harus tahu |
| Safe-to-commit offset | Offset berikutnya setelah semua record sebelumnya aman | Aplikasi harus hitung |
| Committed offset | Progress group yang disimpan ke Kafka | Kafka `__consumer_offsets` |

### 6.2 Kenapa Commit Offset Selalu “Next Offset”?

Kafka commit menyimpan offset berikutnya yang harus dibaca.

Jika record offset 100 berhasil diproses, commit offset 101.

```text
Processed offset: 100
Commit offset:    101
```

Jika batch 100-109 berhasil diproses semua, commit offset 110.

---

## 7. Auto Commit

### 7.1 Apa itu Auto Commit?

Dengan `enable.auto.commit=true`, consumer secara periodik meng-commit offset secara otomatis berdasarkan interval `auto.commit.interval.ms`.

Contoh konfigurasi:

```properties
enable.auto.commit=true
auto.commit.interval.ms=5000
```

Masalahnya: auto commit biasanya tidak tahu apakah side effect aplikasi benar-benar berhasil.

### 7.2 Failure Mode Auto Commit

Misal:

```text
poll returns offsets 100-199
consumer starts processing
at time T, auto commit commits position 200
record 130 fails processing
process crashes
restart from committed offset 200
records 130-199 skipped
```

Ini bisa menyebabkan data loss dari perspektif aplikasi.

Kafka tidak kehilangan record. Record masih ada di log. Tetapi consumer group melompati offset itu karena commit sudah maju.

### 7.3 Kapan Auto Commit Boleh Dipakai?

Auto commit bisa diterima untuk:

1. telemetry low criticality,
2. metric sampling,
3. debug consumer,
4. non-critical analytics,
5. consumer yang processing-nya murni in-memory dan loss acceptable.

Auto commit buruk untuk:

1. pembayaran,
2. regulatory workflow,
3. enforcement lifecycle,
4. audit projection,
5. case assignment,
6. notification penting,
7. sink database yang harus konsisten,
8. event-driven state transition.

Untuk sistem serius, default mental model:

```text
disable auto commit; commit manual setelah processing aman.
```

---

## 8. Manual Commit

Konfigurasi:

```properties
enable.auto.commit=false
```

Lalu aplikasi mengontrol commit.

### 8.1 Commit Setelah Processing

Pattern umum:

```java
while (running) {
    ConsumerRecords<String, OrderEvent> records = consumer.poll(Duration.ofMillis(500));

    for (ConsumerRecord<String, OrderEvent> record : records) {
        process(record);
    }

    consumer.commitSync();
}
```

Ini lebih aman dari auto commit, tetapi masih punya risiko.

Jika semua record dalam batch berhasil, commit aman.
Jika ada satu record gagal dan exception keluar sebelum commit, batch akan dibaca ulang.

Ini menghasilkan at-least-once semantics.

### 8.2 At-Least-Once dengan Manual Commit

Failure scenario:

```text
poll offsets 100-109
process 100 success
process 101 success
process 102 success
crash before commit
restart from committed offset 100
process 100,101,102 again
```

Tidak ada data loss, tetapi ada duplicate processing.

Maka consumer harus idempotent.

### 8.3 `commitSync()`

`commitSync()` menunggu broker/coordinator mengonfirmasi commit atau error.

Kelebihan:

- lebih mudah reasoning,
- failure terlihat langsung,
- cocok untuk final commit saat shutdown,
- cocok untuk batch critical.

Kekurangan:

- blocking,
- mengurangi throughput,
- bisa memperbesar latency,
- jika dipanggil terlalu sering, coordinator load naik.

### 8.4 `commitAsync()`

`commitAsync()` tidak blocking. Commit dikirim dan callback dipanggil kemudian.

Kelebihan:

- throughput lebih baik,
- latency lebih rendah,
- cocok untuk high-throughput consumer.

Kekurangan:

- ordering callback bisa rumit,
- commit lama yang gagal tidak selalu aman untuk retry sembarangan,
- perlu hati-hati agar offset tidak mundur.

Masalah klasik:

```text
commitAsync offset 300 dikirim
commitAsync offset 400 dikirim
commit 400 success
commit 300 callback failure lalu retry
retry 300 success
committed offset mundur ke 300
```

Karena itu retry commit async harus dirancang hati-hati.

Pattern umum:

```text
During normal operation: commitAsync
During shutdown/revoke: commitSync final known-safe offsets
```

---

## 9. Commit Granularity

Ada beberapa level commit.

### 9.1 Per Batch

```text
poll 500 records
process all
commit last offset + 1
```

Kelebihan:

- efisien,
- sedikit commit request,
- throughput tinggi.

Kekurangan:

- crash di tengah batch menyebabkan duplicate lebih besar,
- batch besar bisa memperbesar retry cost.

### 9.2 Per Record

```text
process record
commit offset + 1
```

Kelebihan:

- duplicate window kecil.

Kekurangan:

- sangat mahal,
- coordinator load tinggi,
- throughput turun,
- latency naik.

Biasanya tidak disarankan kecuali volume kecil dan correctness sangat penting.

### 9.3 Per Partition

Dalam satu `poll()`, record bisa berasal dari banyak partition.

```text
records:
  partition 0: offsets 100,101,102
  partition 1: offsets 50,51
  partition 2: offsets 900,901,902,903
```

Commit bisa dilakukan per partition:

```java
Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();
offsets.put(new TopicPartition("orders", 0), new OffsetAndMetadata(103));
offsets.put(new TopicPartition("orders", 1), new OffsetAndMetadata(52));
offsets.put(new TopicPartition("orders", 2), new OffsetAndMetadata(904));
consumer.commitSync(offsets);
```

Ini penting jika processing per partition berbeda kecepatannya.

### 9.4 Safe Offset Per Partition

Safe offset harus dihitung per partition, bukan global.

```text
partition 0 processed up to 102 -> commit 103
partition 1 processed up to 51  -> commit 52
partition 2 processed up to 903 -> commit 904
```

Jangan commit partition 2 hanya karena partition 0 selesai.

---

## 10. Fetching: Bagaimana Consumer Mengambil Data

Consumer tidak mengambil satu record satu request. Kafka dirancang untuk batch.

Parameter penting:

### 10.1 `max.poll.records`

Jumlah maksimum record yang dikembalikan dari satu `poll()`.

```properties
max.poll.records=500
```

Ini bukan batas jumlah record yang di-fetch dari broker secara internal; ini membatasi berapa record yang diserahkan ke aplikasi per poll.

Gunakan untuk mengontrol processing batch size.

Jika processing tiap record berat, turunkan.
Jika processing ringan dan throughput penting, naikkan dengan hati-hati.

### 10.2 `fetch.min.bytes`

Jumlah minimum data yang diharapkan broker kumpulkan sebelum merespons fetch.

```properties
fetch.min.bytes=1
```

Nilai lebih besar bisa meningkatkan batching dan throughput, tetapi menambah latency.

### 10.3 `fetch.max.wait.ms`

Berapa lama broker menunggu sampai `fetch.min.bytes` terpenuhi sebelum mengirim response.

```properties
fetch.max.wait.ms=500
```

Trade-off:

```text
fetch.min.bytes besar + fetch.max.wait.ms besar
  -> throughput lebih baik
  -> latency lebih tinggi
```

### 10.4 `max.partition.fetch.bytes`

Maksimum data per partition dalam satu fetch response.

Kalau record besar, nilai terlalu kecil bisa menyebabkan masalah consumption.

### 10.5 `fetch.max.bytes`

Maksimum data total per fetch request.

Ini membantu membatasi memory pressure di consumer.

---

## 11. Liveness: `session.timeout.ms`, `heartbeat.interval.ms`, `max.poll.interval.ms`

Tiga konfigurasi ini sering dicampuradukkan.

### 11.1 `session.timeout.ms`

Ini batas waktu group coordinator menunggu heartbeat sebelum menganggap consumer mati.

Jika consumer benar-benar mati, coordinator perlu mendeteksi dan memicu rebalance.

### 11.2 `heartbeat.interval.ms`

Interval heartbeat dari consumer ke coordinator. Pada group protocol classic, nilai ini harus lebih kecil dari `session.timeout.ms`, dan biasanya tidak lebih dari sepertiganya.

### 11.3 `max.poll.interval.ms`

Ini batas maksimum waktu antara pemanggilan `poll()` saat consumer menggunakan group management.

Kalau aplikasi memproses terlalu lama dan tidak memanggil `poll()` lagi dalam batas ini, consumer dianggap gagal melakukan progress. Partition bisa dicabut melalui rebalance.

### 11.4 Bedanya Apa?

```text
session.timeout.ms:
  Apakah consumer masih hidup dari sisi heartbeat/session?

heartbeat.interval.ms:
  Seberapa sering consumer membuktikan dirinya masih hidup?

max.poll.interval.ms:
  Apakah aplikasi masih melakukan polling/progress secara wajar?
```

### 11.5 Failure Scenario: Processing Terlalu Lama

```text
max.poll.interval.ms = 5 minutes
poll returns 1000 records
processing batch takes 8 minutes
consumer tidak call poll selama 8 menit
coordinator menganggap consumer stuck
rebalance terjadi
partition pindah ke consumer lain
consumer lama masih memproses record
consumer baru juga memproses record yang sama
```

Hasil:

- duplicate processing,
- commit failure,
- state inconsistency jika tidak idempotent,
- possible zombie side effects.

Solusi:

1. kecilkan `max.poll.records`,
2. percepat processing,
3. gunakan pause/resume untuk partition tertentu,
4. offload processing ke worker pool dengan bounded queue secara hati-hati,
5. naikkan `max.poll.interval.ms` jika memang processing batch valid lama,
6. pecah workload menjadi event yang lebih kecil,
7. hindari blocking call lambat di poll thread.

---

## 12. Backpressure

Backpressure adalah kemampuan sistem untuk memperlambat input saat downstream tidak mampu memproses dengan kecepatan yang sama.

Kafka consumer memiliki dua sisi pressure:

```text
Kafka -> Consumer -> Downstream
```

Jika downstream lambat, consumer harus memilih:

1. tetap fetch dan menumpuk memory,
2. stop poll dan risiko rebalance,
3. pause partition tetapi tetap poll untuk heartbeat,
4. scale out consumer,
5. throttle processing,
6. degrade feature,
7. route gagal ke DLQ/retry topic.

### 12.1 Jangan Berhenti Polling Begitu Saja

Kesalahan umum:

```java
if (downstreamIsSlow()) {
    Thread.sleep(Duration.ofMinutes(10));
}
```

Ini berbahaya karena consumer tidak memanggil `poll()` cukup lama.

Lebih baik:

```text
pause assigned partitions
continue poll periodically
resume when capacity returns
```

### 12.2 `pause()` dan `resume()`

Kafka consumer mendukung pause/resume per partition.

Mental model:

```text
pause(partition)  -> jangan return record baru dari partition itu
resume(partition) -> lanjut return record dari partition itu
```

Tetapi consumer tetap perlu `poll()` untuk menjaga liveness.

Contoh:

```java
Set<TopicPartition> paused = new HashSet<>();

while (running) {
    if (workQueueIsFull() && paused.isEmpty()) {
        Set<TopicPartition> assignment = consumer.assignment();
        consumer.pause(assignment);
        paused.addAll(assignment);
    }

    if (workQueueHasCapacity() && !paused.isEmpty()) {
        consumer.resume(paused);
        paused.clear();
    }

    ConsumerRecords<String, OrderEvent> records = consumer.poll(Duration.ofMillis(500));
    enqueue(records);
}
```

### 12.3 Backpressure dengan Worker Pool

Kadang processing per record lambat, sehingga engineer ingin menggunakan worker pool.

```text
poll thread -> bounded queue -> worker threads
```

Ini bisa meningkatkan throughput, tetapi sangat berbahaya jika ordering dan commit tidak dikontrol.

Risiko:

1. record offset 101 selesai sebelum 100,
2. commit offset 102 padahal 100 gagal,
3. ordering per partition rusak,
4. queue memory membengkak,
5. rebalance terjadi saat worker masih memproses record lama.

Rule aman:

```text
Jika butuh ordering per key/partition, jangan proses record dari partition yang sama secara paralel tanpa mekanisme ordered completion.
```

### 12.4 Partition-Aware Worker Model

Lebih aman:

```text
poll thread
  -> partition 0 queue -> single worker for partition 0
  -> partition 1 queue -> single worker for partition 1
  -> partition 2 queue -> single worker for partition 2
```

Dengan ini, ordering per partition tetap terjaga.

Namun tetap perlu:

- bounded queue,
- safe offset tracking,
- revoke handling,
- final commit,
- stop accepting work on revoked partition.

---

## 13. Error Handling

Consumer error tidak satu jenis.

### 13.1 Error Taxonomy

| Error | Contoh | Biasanya |
|---|---|---|
| Deserialization error | payload corrupt, schema mismatch | DLQ atau stop |
| Validation error | field wajib kosong | DLQ/business reject |
| Transient downstream | DB timeout, HTTP 503 | retry |
| Permanent downstream | constraint violation | DLQ/manual intervention |
| Poison pill | record selalu gagal | DLQ/quarantine |
| Commit error | rebalance, coordinator unavailable | retry/final sync |
| Authorization error | ACL salah | fail fast |
| Logic bug | NullPointerException | stop, fix code |

### 13.2 Jangan Retry Selamanya di Poll Thread

Anti-pattern:

```java
while (true) {
    try {
        process(record);
        break;
    } catch (Exception e) {
        Thread.sleep(10000);
    }
}
```

Jika record poison, consumer stuck selamanya di offset itu.

Akibat:

- lag naik,
- partition blocked,
- consumer dianggap slow,
- downstream tidak mendapat event berikutnya,
- incident membesar.

### 13.3 Retry Strategy

Pilihan:

1. immediate retry terbatas,
2. delayed retry topic,
3. exponential backoff,
4. DLQ setelah batas retry,
5. manual replay dari DLQ,
6. quarantine topic untuk investigation.

### 13.4 DLQ Bukan Tempat Sampah

DLQ harus punya:

- original topic,
- original partition,
- original offset,
- original key,
- original value atau safe representation,
- error class,
- error message,
- stack trace ringkas,
- timestamp,
- consumer group,
- application version,
- correlation id,
- schema id jika ada,
- retry count.

Contoh DLQ envelope:

```json
{
  "sourceTopic": "case.lifecycle.events",
  "sourcePartition": 3,
  "sourceOffset": 918273,
  "sourceKey": "CASE-2026-0001",
  "errorType": "VALIDATION_ERROR",
  "errorMessage": "missing enforcementDecision.reasonCode",
  "consumerGroup": "case-projection-service",
  "applicationVersion": "1.42.0",
  "failedAt": "2026-06-19T08:30:00Z",
  "correlationId": "corr-abc-123"
}
```

DLQ tanpa owner dan replay process hanya menunda masalah.

---

## 14. Deserialization Boundary

Deserialization terjadi sebelum record diserahkan ke aplikasi.

Jika deserializer melempar exception, aplikasi mungkin tidak pernah menerima `ConsumerRecord` normal.

Ini berbahaya karena:

- record gagal sebelum business handler,
- offset belum maju secara aman,
- consumer bisa stuck pada record yang tidak bisa dideserialize.

Solusi umum:

1. gunakan error-handling deserializer jika framework mendukung,
2. consume raw bytes lalu deserialize di aplikasi untuk kontrol penuh,
3. validasi schema compatibility sebelum deploy producer,
4. gunakan Schema Registry compatibility policy,
5. siapkan DLQ untuk payload invalid.

Untuk sistem critical, deserialization harus dianggap sebagai bagian dari contract boundary.

---

## 15. Graceful Shutdown

Shutdown yang buruk adalah sumber duplicate besar.

### 15.1 Masalah

Jika proses dimatikan saat sedang memproses batch:

```text
poll offsets 100-199
process 100-150 success
SIGTERM
process killed before commit
restart from 100
100-150 duplicate
```

Duplicate mungkin acceptable jika idempotent, tetapi tetap bisa mahal.

### 15.2 Wakeup Pattern

Kafka consumer tidak thread-safe untuk semua operasi, tetapi `wakeup()` dirancang untuk menghentikan blocking `poll()` dari thread lain.

Pattern:

```java
AtomicBoolean running = new AtomicBoolean(true);

Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    running.set(false);
    consumer.wakeup();
}));

try {
    while (running.get()) {
        ConsumerRecords<String, OrderEvent> records = consumer.poll(Duration.ofMillis(500));
        process(records);
        consumer.commitSync();
    }
} catch (WakeupException e) {
    if (running.get()) {
        throw e;
    }
} finally {
    try {
        consumer.commitSync();
    } finally {
        consumer.close();
    }
}
```

### 15.3 Final Commit Harus Berdasarkan Safe Offset

Jangan final commit offset yang belum aman.

Kalau kamu memakai worker pool, final commit harus menunggu:

1. stop polling new records,
2. stop accepting new work,
3. wait in-flight work selesai atau cancel aman,
4. commit hanya offset yang benar-benar selesai,
5. close consumer.

---

## 16. Rebalance dan Consumer Loop

Rebalance dibahas lebih dalam di Part 007, tetapi consumer loop harus sudah siap.

Ketika partition dicabut dari consumer, consumer tidak boleh terus memproses dan commit partition itu sembarangan.

Gunakan `ConsumerRebalanceListener`.

```java
consumer.subscribe(List.of("orders"), new ConsumerRebalanceListener() {
    @Override
    public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
        // stop work for revoked partitions
        // flush side effects if possible
        // commit safe offsets for revoked partitions
    }

    @Override
    public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
        // initialize state if needed
    }
});
```

### 16.1 Kenapa Commit Saat Revoked Penting?

Jika partition dicabut, consumer lain akan mengambil alih dari committed offset terakhir.

Kalau consumer lama sudah memproses beberapa record tetapi belum commit, consumer baru akan memproses ulang.

Ini at-least-once.

Kalau consumer lama commit offset yang belum selesai, data bisa diskip.

Maka revoke callback adalah boundary penting.

---

## 17. Seek: Mengatur Posisi Baca Secara Manual

Consumer bisa mengubah posisi baca menggunakan `seek()`.

Contoh use case:

1. replay dari offset tertentu,
2. reprocess data setelah bug fix,
3. skip poison offset secara manual,
4. restore projection,
5. debugging,
6. backfill.

Contoh:

```java
TopicPartition tp = new TopicPartition("orders", 0);
consumer.assign(List.of(tp));
consumer.seek(tp, 12345L);
```

Hati-hati:

```text
seek mengubah position, bukan committed offset secara otomatis.
```

Jika kamu ingin group restart dari posisi baru, kamu harus commit offset yang sesuai.

### 17.1 `auto.offset.reset`

Jika tidak ada committed offset untuk group, consumer memakai `auto.offset.reset`.

Pilihan umum:

- `earliest`: mulai dari offset paling awal yang masih tersedia.
- `latest`: mulai dari akhir log.
- `none`: error jika offset tidak ditemukan.

Untuk consumer baru:

```text
latest bisa menyebabkan historical records tidak dibaca.
earliest bisa menyebabkan backlog besar.
none memaksa keputusan eksplisit.
```

Untuk sistem critical, `none` sering lebih aman karena gagal cepat daripada diam-diam membaca dari posisi yang salah.

---

## 18. Idempotent Consumer

Kafka consumer production harus diasumsikan akan menerima duplicate.

At-least-once adalah default realistis untuk banyak aplikasi.

### 18.1 Idempotency Key

Gunakan event id atau business operation id.

```text
eventId = globally unique id untuk event
operationId = id unik untuk side effect bisnis
```

Jangan gunakan offset sebagai idempotency key bisnis lintas topic/partition.

Offset hanya meaningful dalam partition.

### 18.2 Idempotency Table

Contoh table:

```sql
CREATE TABLE processed_event (
    consumer_name VARCHAR(200) NOT NULL,
    event_id VARCHAR(200) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, event_id)
);
```

Processing:

```text
begin transaction
  insert processed_event(consumer, eventId)
  if duplicate -> skip safely
  apply business side effect
commit transaction
commit kafka offset
```

Jika crash setelah DB commit tetapi sebelum Kafka commit, event akan dibaca ulang, insert duplicate gagal, side effect tidak diulang, lalu offset bisa di-commit.

### 18.3 Natural Idempotency

Beberapa operasi natural idempotent:

```text
set case status to APPROVED if current version < event version
upsert projection by event aggregate version
write search document with deterministic id
```

Beberapa tidak idempotent:

```text
send email
charge credit card
append notification row without unique key
increment counter blindly
create ticket with generated id
```

Untuk operasi tidak idempotent, perlu engineered idempotency.

---

## 19. Consumer dan External Side Effects

Kafka offset commit dan external database commit bukan satu atomic transaction, kecuali kamu merancang khusus.

### 19.1 Crash Matrix

| Waktu Crash | DB Side Effect | Kafka Commit | Akibat |
|---|---|---|---|
| Sebelum processing | belum | belum | record dibaca ulang |
| Setelah side effect, sebelum commit | sudah | belum | duplicate saat restart |
| Setelah commit, sebelum side effect | belum | sudah | data loss aplikasi |
| Setelah side effect dan commit | sudah | sudah | aman |

Pattern aman:

```text
process side effect first, then commit offset
```

Ini memberi at-least-once, bukan at-most-once.

Lalu duplicate ditangani dengan idempotency.

### 19.2 Jangan Commit Sebelum Side Effect

Anti-pattern:

```java
consumer.commitSync();
process(record);
```

Jika proses crash setelah commit sebelum process, record hilang dari perspektif consumer group.

---

## 20. Java Consumer Production Skeleton

Contoh skeleton single-thread, manual commit, batch processing, graceful shutdown.

```java
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.errors.WakeupException;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

public final class OrderConsumerRunner implements Runnable {
    private final KafkaConsumer<String, OrderEvent> consumer;
    private final AtomicBoolean running = new AtomicBoolean(true);
    private final Map<TopicPartition, OffsetAndMetadata> safeOffsets = new HashMap<>();

    public OrderConsumerRunner(KafkaConsumer<String, OrderEvent> consumer) {
        this.consumer = consumer;
    }

    public void shutdown() {
        running.set(false);
        consumer.wakeup();
    }

    @Override
    public void run() {
        try {
            consumer.subscribe(List.of("order.events"), new ConsumerRebalanceListener() {
                @Override
                public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
                    commitSafeOffsetsFor(partitions);
                }

                @Override
                public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
                    // Initialize partition state if needed.
                }
            });

            while (running.get()) {
                ConsumerRecords<String, OrderEvent> records = consumer.poll(Duration.ofMillis(500));

                for (ConsumerRecord<String, OrderEvent> record : records) {
                    processOne(record);
                    markProcessed(record);
                }

                if (!safeOffsets.isEmpty()) {
                    consumer.commitAsync(new HashMap<>(safeOffsets), (offsets, exception) -> {
                        if (exception != null) {
                            // log and rely on future commit/final commit
                            // do not blindly retry stale async commits
                        }
                    });
                }
            }
        } catch (WakeupException e) {
            if (running.get()) {
                throw e;
            }
        } finally {
            try {
                if (!safeOffsets.isEmpty()) {
                    consumer.commitSync(new HashMap<>(safeOffsets));
                }
            } finally {
                consumer.close();
            }
        }
    }

    private void processOne(ConsumerRecord<String, OrderEvent> record) {
        // 1. validate
        // 2. idempotency check
        // 3. apply side effect transactionally if possible
        // 4. publish downstream event if required via outbox or transaction-aware mechanism
    }

    private void markProcessed(ConsumerRecord<String, OrderEvent> record) {
        TopicPartition tp = new TopicPartition(record.topic(), record.partition());
        safeOffsets.put(tp, new OffsetAndMetadata(record.offset() + 1));
    }

    private void commitSafeOffsetsFor(Collection<TopicPartition> partitions) {
        Map<TopicPartition, OffsetAndMetadata> offsetsToCommit = new HashMap<>();
        for (TopicPartition partition : partitions) {
            OffsetAndMetadata offset = safeOffsets.get(partition);
            if (offset != null) {
                offsetsToCommit.put(partition, offset);
            }
        }
        if (!offsetsToCommit.isEmpty()) {
            consumer.commitSync(offsetsToCommit);
        }
    }
}
```

Catatan:

1. Skeleton ini masih sederhana.
2. Untuk worker pool, offset tracking harus lebih kompleks.
3. Untuk side effect database, idempotency harus ada.
4. Untuk poison pill, `processOne` harus punya error strategy.
5. Untuk rebalance, revoked partition harus dihentikan dari processing.

---

## 21. Configuration Baseline untuk Java Consumer

Contoh baseline:

```properties
bootstrap.servers=kafka-1:9092,kafka-2:9092,kafka-3:9092
group.id=case-projection-service
client.id=case-projection-service-1

enable.auto.commit=false
auto.offset.reset=none

key.deserializer=org.apache.kafka.common.serialization.StringDeserializer
value.deserializer=com.example.kafka.CaseEventDeserializer

max.poll.records=500
max.poll.interval.ms=300000
session.timeout.ms=45000
heartbeat.interval.ms=15000

fetch.min.bytes=1
fetch.max.wait.ms=500
max.partition.fetch.bytes=1048576
fetch.max.bytes=52428800

isolation.level=read_committed
```

### 21.1 Penjelasan

`enable.auto.commit=false`  
Karena aplikasi ingin commit setelah processing aman.

`auto.offset.reset=none`  
Untuk sistem critical, lebih baik gagal jika offset tidak ada daripada diam-diam mulai dari earliest/latest.

`max.poll.records=500`  
Mulai dari nilai default umum; turunkan jika processing berat.

`max.poll.interval.ms=300000`  
Pastikan batch processing selesai jauh sebelum batas ini.

`session.timeout.ms` dan `heartbeat.interval.ms`  
Harus cocok dengan group protocol dan broker config. Untuk classic protocol, heartbeat biasanya lebih kecil dari session timeout.

`isolation.level=read_committed`  
Jika producer menggunakan transaksi Kafka dan consumer tidak ingin membaca aborted transactional records.

---

## 22. Consumer Throughput Model

Throughput consumer dipengaruhi oleh:

```text
number of partitions assigned
x records per poll
x processing speed per record
x commit frequency
x downstream capacity
x serialization cost
x network fetch efficiency
```

Formula kasar:

```text
consumer throughput = min(
  Kafka fetch capacity,
  application processing capacity,
  downstream side-effect capacity,
  partition parallelism capacity
)
```

Jika bottleneck ada di database, menambah consumer belum tentu membantu. Bisa memperparah database overload.

Jika bottleneck ada di partition count, menambah consumer melebihi jumlah partition tidak membantu.

Jika bottleneck ada di deserialization CPU, compression/schema choices mempengaruhi.

Jika bottleneck ada di commit frequency, commit per record bisa menjadi masalah.

---

## 23. Lag Explosion

Lag explosion terjadi saat production rate lebih besar dari consumption rate dalam waktu cukup lama.

```text
produce rate = 50,000 records/sec
consume rate = 30,000 records/sec
lag growth   = 20,000 records/sec
```

Dalam 1 jam:

```text
20,000 * 3600 = 72,000,000 records lag
```

### 23.1 Penyebab Umum

1. downstream database lambat,
2. deployment consumer gagal,
3. poison pill blocking partition,
4. rebalance storm,
5. partition hot spot,
6. schema deserialization error,
7. remote API throttling,
8. commit failure loop,
9. insufficient partitions,
10. bad `max.poll.records` atau fetch config.

### 23.2 Recovery

Pilihan recovery:

1. scale consumer sampai batas partition,
2. optimize processing,
3. temporarily disable expensive side effect,
4. replay to faster sink,
5. split heavy consumer responsibilities,
6. increase partition count jika desain memungkinkan,
7. isolate hot key,
8. route poison event ke DLQ,
9. backfill dengan dedicated consumer group.

Jangan hanya “restart consumer” tanpa memahami penyebabnya.

---

## 24. Ordering dan Consumer Processing

Kafka menjaga ordering per partition, tetapi aplikasi bisa merusaknya.

### 24.1 Ordering Aman

```text
single consumer thread
process records in order
commit after processing
```

Ordering per partition aman.

### 24.2 Ordering Rusak

```text
poll records 100,101,102 from same partition
submit ke worker pool
102 selesai dulu
commit 103
100 gagal
restart dari 103
100 hilang dari perspektif aplikasi
```

Parallelism harus partition-aware atau key-aware.

### 24.3 Key-Level Ordering

Jika key selalu masuk partition yang sama, dan consumer memproses partition secara berurutan, ordering key terjaga.

Jika kamu memecah record ke worker pool tanpa menjaga key order, ordering bisnis bisa rusak.

---

## 25. Consumer untuk Regulatory / Case Management System

Untuk sistem enforcement lifecycle atau case management, consumer sering menjalankan transisi penting:

```text
CaseCreated
CaseAssigned
EvidenceSubmitted
ViolationDetected
EnforcementRecommended
SupervisorReviewRequested
DecisionIssued
AppealSubmitted
CaseClosed
```

Consumer bisa bertugas:

1. membangun read model case,
2. menghitung SLA,
3. memicu escalation,
4. menulis audit trail,
5. membuat notification,
6. mengupdate search index,
7. menghitung workload officer,
8. mendeteksi overdue state.

Di domain seperti ini, consumer harus punya invariant:

```text
Tidak boleh ada event lifecycle yang dianggap selesai diproses sebelum side effect defensible selesai.
```

Contoh invariant:

```text
Offset CaseDecisionIssued tidak boleh di-commit oleh projection consumer
sebelum decision projection tersimpan dengan eventId dan causationId.
```

Jika commit lebih dulu, audit projection bisa kehilangan event.

### 25.1 Regulatory Consumer Checklist

Untuk consumer regulatory:

1. `enable.auto.commit=false`.
2. Semua event punya `eventId`.
3. Semua event punya `caseId` sebagai key jika ordering case penting.
4. Semua side effect idempotent.
5. Offset commit setelah durable side effect.
6. DLQ punya original offset dan payload reference.
7. Replay path diuji.
8. Projection bisa direbuild dari topic.
9. Consumer lag by time dimonitor.
10. Poison event tidak boleh memblokir seluruh platform tanpa alert.

---

## 26. Anti-Patterns

### 26.1 Auto Commit untuk Critical Workflow

```text
enable.auto.commit=true
```

Untuk workflow critical, ini sering salah karena commit tidak dikaitkan dengan side effect.

### 26.2 Commit Sebelum Processing

```text
commit -> process
```

Ini memberi risiko data loss aplikasi.

### 26.3 Sleep Lama di Poll Thread

```text
Thread.sleep(10 minutes)
```

Bisa memicu rebalance dan duplicate.

### 26.4 Worker Pool Tanpa Offset Tracking

Parallelism tanpa safe offset tracking bisa menyebabkan skip atau reorder.

### 26.5 DLQ Tanpa Replay Process

DLQ yang tidak pernah dipantau adalah data loss yang ditunda.

### 26.6 Menggunakan Offset sebagai Business ID

Offset bukan business identity.

### 26.7 Consumer Terlalu Banyak

Jika partition hanya 6, consumer aktif efektif maksimal 6 dalam satu group. Consumer ke-7 idle.

### 26.8 Menganggap Lag Nol Selalu Sehat

Lag nol bisa berarti:

- consumer sehat,
- topic tidak ada data,
- consumer membaca dari latest dan melewatkan historical data,
- consumer group baru salah konfigurasi,
- producer mati.

Lag harus dibaca bersama produce rate dan business metrics.

---

## 27. Production Failure Modes

### 27.1 Crash Before Commit

```text
process success
crash before commit
```

Akibat: duplicate.

Mitigasi: idempotency.

### 27.2 Commit Before Process

```text
commit success
crash before process
```

Akibat: data loss aplikasi.

Mitigasi: jangan commit sebelum processing.

### 27.3 Rebalance During Processing

```text
consumer A processing partition 0
rebalance revokes partition 0
consumer B starts from old committed offset
A still writes side effect
B writes same side effect
```

Akibat: duplicate/zombie side effect.

Mitigasi:

- revoke listener,
- stop work on revoked partition,
- idempotency,
- static membership/cooperative rebalance untuk mengurangi disruption.

### 27.4 Poison Pill

```text
record offset 777 always fails
consumer keeps retrying
partition blocked
lag grows
```

Mitigasi:

- bounded retry,
- DLQ,
- alert,
- manual remediation.

### 27.5 Slow Downstream

```text
DB latency naik 20x
consumer throughput drop
lag explosion
```

Mitigasi:

- backpressure,
- pause/resume,
- bulk writes,
- rate limit,
- circuit breaker,
- scale downstream.

### 27.6 Deserialization Error

```text
producer deploys incompatible schema
consumer cannot deserialize
consumer stuck
```

Mitigasi:

- schema compatibility checks,
- contract test,
- error-handling deserializer,
- DLQ.

---

## 28. Design Trade-Offs

### 28.1 Large Batch vs Small Batch

| Choice | Pros | Cons |
|---|---|---|
| Large batch | throughput tinggi, commit lebih sedikit | duplicate window besar, processing lama |
| Small batch | latency rendah, duplicate window kecil | overhead tinggi |

### 28.2 Sync Commit vs Async Commit

| Choice | Pros | Cons |
|---|---|---|
| Sync | mudah reasoning, safer shutdown | blocking, throughput turun |
| Async | throughput tinggi | callback ordering rumit |

### 28.3 Single Thread vs Worker Pool

| Choice | Pros | Cons |
|---|---|---|
| Single thread | ordering mudah, offset mudah | throughput terbatas |
| Worker pool | parallelism lebih tinggi | offset/order/rebalance kompleks |

### 28.4 Earliest vs Latest vs None

| `auto.offset.reset` | Cocok untuk | Risiko |
|---|---|---|
| earliest | replay/backfill/new projection | backlog besar |
| latest | realtime only/non-critical | historical data skipped |
| none | critical explicit start | startup error jika offset belum ada |

---

## 29. Checklist Consumer Production Readiness

Sebelum deploy consumer production, jawab pertanyaan ini:

1. Apakah `enable.auto.commit` sengaja dipilih?
2. Jika manual commit, kapan offset di-commit?
3. Apakah side effect idempotent?
4. Apa idempotency key-nya?
5. Apa yang terjadi jika crash setelah side effect sebelum commit?
6. Apa yang terjadi jika record gagal deserialization?
7. Apa retry policy?
8. Apa DLQ policy?
9. Siapa owner DLQ?
10. Bagaimana replay dari DLQ?
11. Apakah consumer bisa graceful shutdown?
12. Apakah consumer punya rebalance listener?
13. Apakah processing batch selesai sebelum `max.poll.interval.ms`?
14. Apakah `max.poll.records` sesuai processing cost?
15. Apakah lag dimonitor by partition?
16. Apakah lag by time dimonitor?
17. Apakah downstream capacity cukup?
18. Apakah worker pool menjaga ordering?
19. Apakah offset commit per partition benar?
20. Apakah consumer diuji dengan duplicate event?
21. Apakah consumer diuji dengan rebalance?
22. Apakah consumer diuji dengan poison pill?
23. Apakah consumer diuji dengan shutdown saat in-flight processing?
24. Apakah alert membedakan lag, failure, dan no input?
25. Apakah runbook recovery jelas?

---

## 30. Latihan / Thought Exercises

### Latihan 1 — Commit Semantics

Consumer membaca offset 10, 11, 12. Offset 10 dan 11 berhasil diproses. Offset 12 gagal.

Pertanyaan:

1. Offset berapa yang aman di-commit?
2. Apa akibat jika commit 13?
3. Apa akibat jika tidak commit sama sekali?

Jawaban mental:

```text
Aman commit 12, karena next offset setelah 11.
Commit 13 akan melewati offset 12 yang gagal.
Tidak commit sama sekali akan membuat 10 dan 11 diproses ulang saat restart.
```

### Latihan 2 — Slow Processing

`max.poll.interval.ms=300000`. Consumer poll 1000 record. Processing batch butuh 8 menit.

Pertanyaan:

1. Apa kemungkinan terjadi?
2. Solusi apa yang lebih aman daripada langsung menaikkan timeout?

Jawaban mental:

```text
Consumer bisa dianggap tidak melakukan progress dan partition direvoke.
Solusi: kecilkan max.poll.records, optimalkan processing, gunakan pause/resume,
pecah workload, atau desain worker partition-aware.
```

### Latihan 3 — Regulatory Projection

Consumer `case-projection-service` menerima `DecisionIssued`. Ia harus update projection table.

Pertanyaan:

1. Commit sebelum update table atau setelah?
2. Bagaimana menghindari duplicate update?
3. Metadata apa yang harus disimpan?

Jawaban mental:

```text
Commit setelah update durable.
Gunakan eventId/idempotency table atau projection version.
Simpan eventId, caseId, eventType, eventTime, source topic-partition-offset, causationId.
```

### Latihan 4 — Worker Pool

Kamu ingin memproses record dari satu partition dengan 10 worker parallel.

Pertanyaan:

1. Apa risiko terhadap ordering?
2. Apa risiko terhadap commit?
3. Bagaimana desain yang lebih aman?

Jawaban mental:

```text
Ordering bisa rusak karena offset lebih baru selesai lebih dulu.
Commit bisa maju melewati offset yang gagal.
Lebih aman partition-aware single worker atau ordered completion tracking.
```

---

## 31. Ringkasan

Kafka consumer adalah salah satu bagian Kafka yang paling sering diremehkan.

Mental model penting:

```text
Consumer bukan sekadar message reader.
Consumer adalah stateful runtime yang mengelola fetch, position, commit, group membership,
backpressure, error handling, and side-effect consistency.
```

Hal yang wajib diingat:

1. Offset commit adalah progress consumer group, bukan bukti business side effect selesai.
2. Record yang sudah dipoll belum tentu aman di-commit.
3. Commit offset berarti “mulai dari sini saat restart”, bukan “record ini sudah dibaca”.
4. Untuk critical workflow, disable auto commit.
5. Commit setelah processing durable.
6. Duplicate adalah realitas; consumer harus idempotent.
7. `poll()` adalah bagian dari liveness/progress consumer.
8. Processing terlalu lama bisa menyebabkan rebalance.
9. Backpressure harus dilakukan tanpa membuat consumer berhenti bernapas.
10. Worker pool tanpa offset/order discipline bisa menyebabkan data loss aplikasi.
11. DLQ harus punya ownership dan replay path.
12. Consumer yang baik didesain dari failure modes, bukan dari happy path.

---

## 32. Koneksi ke Part Berikutnya

Part ini membahas consumer dari sudut satu instance aplikasi.

Part berikutnya akan membahas consumer dalam konteks group penuh:

```text
Part 007 — Consumer Groups and Rebalancing: Assignment, Ownership, and Failure Modes
```

Kita akan masuk lebih dalam ke:

1. group coordinator,
2. partition assignment,
3. eager vs cooperative rebalance,
4. static membership,
5. rebalance trigger,
6. duplicate saat ownership berpindah,
7. rolling deployment,
8. consumer scaling limit,
9. zombie consumer,
10. failure modelling consumer group.

Kalau Part 006 adalah tentang “bagaimana satu consumer bernapas”, Part 007 adalah tentang “bagaimana sekumpulan consumer membagi ownership dan bertahan saat ada perubahan”.

---

## Referensi

Referensi utama untuk bagian ini:

1. Apache Kafka Documentation — Consumer Configurations.
2. Apache Kafka Java Client Javadocs — `KafkaConsumer`, `Consumer`, `commitSync`, `commitAsync`, `pause`, `resume`, `poll`.
3. Confluent Documentation — Kafka Consumer Configuration Reference.
4. Confluent Documentation — Kafka Consumer Design and Consumer Groups.
5. Confluent Platform Consumer Client Documentation — offset commit and group reassignment behavior.
6. Confluent Blog — Consumer Offsets Guide and KIP-1094 context.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Partitioning Strategy: Keys, Ordering Domains, Hot Partitions, and Scalability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-007.md">Part 007 — Consumer Groups and Rebalancing: Assignment, Ownership, and Failure Modes ➡️</a>
</div>

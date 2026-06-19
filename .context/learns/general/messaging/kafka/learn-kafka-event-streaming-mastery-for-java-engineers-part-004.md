# learn-kafka-event-streaming-mastery-for-java-engineers-part-004.md

# Part 004 — Producers Deep Dive: Batching, Compression, Acks, Idempotence, and Throughput

> Seri: Kafka Event Streaming Mastery for Java Engineers  
> Bagian: 004 dari 034  
> Status seri: belum selesai  
> Fokus: producer internals, delivery semantics dari sisi producer, batching, compression, retries, idempotence, timeout, ordering, dan konfigurasi Java producer untuk production.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami apa yang benar-benar terjadi ketika aplikasi Java memanggil `KafkaProducer.send()`.
2. Membedakan antara keberhasilan lokal di client, keberhasilan request ke broker, dan keberhasilan durable di replicated log.
3. Menjelaskan hubungan antara `acks`, replication, ISR, `min.insync.replicas`, retries, dan kemungkinan data loss.
4. Mendesain producer configuration berdasarkan tujuan nyata: throughput, latency, durability, ordering, atau cost.
5. Memahami batching, `linger.ms`, `batch.size`, `buffer.memory`, compression, dan backpressure producer.
6. Memahami idempotent producer dan mengapa ini penting untuk mencegah duplicate write akibat retry.
7. Memahami batasan idempotence: ia mengurangi duplicate pada Kafka log, tetapi tidak menyelesaikan semua duplicate end-to-end di aplikasi.
8. Menghindari kesalahan umum seperti blocking di callback, memakai key salah, menganggap `send()` berarti sudah durable, atau tuning producer hanya dengan menaikkan partition.
9. Menulis Java producer yang production-conscious: safe shutdown, callback handling, error classification, observability, timeout, dan config eksplisit.
10. Membangun mental model yang akan dipakai lagi saat membahas consumer, exactly-once, Kafka Streams, Kafka Connect, CDC, dan event-driven architecture.

---

## 2. Mental Model Utama

Producer Kafka bukan hanya object kecil yang mengirim network request.

Producer adalah **runtime client** yang melakukan beberapa pekerjaan sekaligus:

```text
application thread
  -> serialize key/value
  -> choose partition
  -> append to producer memory buffer
  -> batch records by topic-partition
  -> sender thread sends ProduceRequest to broker leader
  -> broker appends to leader log
  -> replicas fetch and acknowledge depending on acks/min ISR
  -> response returns
  -> callback/future completes
```

Hal penting:

```text
send() returning successfully != record already stored in Kafka
callback success          == broker accepted according to requested acks
callback failure          == producer could not prove success
callback failure          != record definitely absent
```

Ini adalah distinction yang sangat penting.

Dalam distributed systems, ketika client mendapat timeout, client sering tidak tahu apakah server gagal memproses request, berhasil memproses request tetapi response hilang, atau berhasil sebagian. Karena itu Kafka producer harus dipahami sebagai sistem yang hidup di antara:

1. Application code.
2. Client memory buffer.
3. Network.
4. Broker leader.
5. Follower replicas.
6. ISR membership.
7. Timeout dan retry policy.
8. Ordering dan sequence control.

Producer yang baik bukan producer yang “bisa kirim message”. Producer yang baik adalah producer yang **jelas guarantee-nya**.

---

## 3. Producer dalam Arsitektur Kafka

Pada part sebelumnya kita sudah melihat Kafka sebagai distributed log. Producer adalah pihak yang menambahkan record ke log.

Dalam bentuk paling sederhana:

```text
Producer -> Topic Partition Leader -> Replicated Log
```

Tapi realitanya:

```text
Java Application
  |
  | send(record)
  v
KafkaProducer
  |
  | serialize, partition, batch, retry, compress
  v
Broker Leader for target partition
  |
  | append to local log
  v
Follower replicas fetch
  |
  | ISR acknowledgement condition
  v
Producer receives response
```

Producer tidak menulis ke semua broker. Producer menulis ke **leader replica** untuk partition tujuan. Follower replica mereplikasi dari leader.

Maka, producer harus tahu metadata cluster:

1. Topic apa saja yang ada.
2. Partition mana saja untuk topic tersebut.
3. Broker mana yang menjadi leader untuk setiap partition.
4. Broker mana yang tersedia sebagai bootstrap entry point.
5. Kapan metadata berubah akibat leader election, topic creation, atau broker failure.

Producer menyimpan metadata cache dan memperbaruinya ketika perlu.

---

## 4. Anatomy of a Produce Operation

Misalkan aplikasi Java menjalankan:

```java
producer.send(new ProducerRecord<>(
    "case-events",
    caseId,
    event
), callback);
```

Secara mental, urutannya seperti ini.

### 4.1 Construct ProducerRecord

`ProducerRecord` biasanya berisi:

1. Topic.
2. Optional partition.
3. Optional timestamp.
4. Optional key.
5. Value.
6. Optional headers.

Contoh:

```java
ProducerRecord<String, CaseEvent> record = new ProducerRecord<>(
    "case-events",
    caseId,
    caseEvent
);
```

Jika partition tidak diberikan, producer akan memilih partition berdasarkan key/partitioner.

### 4.2 Serialize Key and Value

Kafka di broker tidak memahami object Java. Broker menyimpan bytes.

Maka producer harus mengubah:

```text
String key       -> byte[]
CaseEvent value -> byte[]
```

Kesalahan serialization bisa terjadi sebelum record masuk ke buffer producer.

Contoh failure:

```text
CaseEvent contains unsupported field
Schema Registry unreachable
Schema incompatible
Serializer throws exception
```

Serialization failure biasanya bukan retriable network error. Ini sering berarti bug data atau schema.

### 4.3 Determine Partition

Jika `ProducerRecord` sudah menentukan partition eksplisit, producer memakai partition itu.

Jika tidak:

1. Jika key ada, producer menggunakan hash key untuk memilih partition.
2. Jika key null, producer memakai strategi partitioning untuk menyebarkan load.

Key bukan sekadar metadata. Key menentukan:

1. Ordering domain.
2. Load distribution.
3. Consumer-side grouping.
4. Repartition cost di Kafka Streams/ksqlDB.
5. Hot partition risk.

### 4.4 Append to Record Accumulator

Producer tidak langsung mengirim setiap record satu per satu. Producer menaruh record ke memory buffer yang dikelompokkan per topic-partition.

Secara konseptual:

```text
RecordAccumulator
  case-events-0 -> batch [r1, r2, r3]
  case-events-1 -> batch [r4, r5]
  case-events-2 -> batch [r6]
```

Batching adalah salah satu alasan Kafka bisa throughput tinggi.

### 4.5 Sender Thread Sends Batches

Kafka producer memiliki background sender thread. Thread ini mengambil batch yang siap dikirim, membuat ProduceRequest, lalu mengirimkannya ke broker leader.

Satu request ke broker bisa membawa batch untuk beberapa partition yang leader-nya ada di broker tersebut.

### 4.6 Broker Appends to Log

Broker leader menerima request, memvalidasi, lalu append batch ke log partition.

Tergantung config, broker akan merespons producer setelah:

1. Tidak menunggu apa-apa (`acks=0`).
2. Leader append selesai (`acks=1`).
3. Leader dan cukup ISR replica mengakui (`acks=all`).

### 4.7 Callback Completes

Setelah response diterima atau failure diputuskan, callback dipanggil.

Callback success biasanya membawa `RecordMetadata`:

```text
topic
partition
offset
timestamp
serialized key size
serialized value size
```

Callback failure membawa exception.

---

## 5. `send()` Is Asynchronous

`KafkaProducer.send()` secara default asynchronous.

Artinya:

```java
Future<RecordMetadata> future = producer.send(record);
```

Pemanggilan `send()` biasanya hanya menaruh record ke buffer dan mengembalikan `Future`. Pengiriman network dilakukan oleh sender thread.

Jika kamu melakukan ini:

```java
producer.send(record);
```

lalu tidak pernah memeriksa callback/future, kamu mungkin kehilangan visibility terhadap error.

### 5.1 Fire-and-Forget

```java
producer.send(record);
```

Kelebihan:

1. Throughput tinggi.
2. Latency aplikasi rendah.
3. Code sederhana.

Kekurangan:

1. Error mudah tersembunyi.
2. Tidak ada audit keberhasilan.
3. Sulit membedakan accepted vs dropped.
4. Berbahaya untuk event penting.

Fire-and-forget cocok hanya untuk event yang toleran terhadap loss, misalnya telemetry non-critical dengan sampling.

Untuk regulatory/case lifecycle event, fire-and-forget biasanya buruk.

### 5.2 Async with Callback

```java
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        // handle failure
    } else {
        // success
    }
});
```

Ini pola umum yang baik.

Kelebihan:

1. Tetap asynchronous.
2. Error terlihat.
3. Bisa collect metrics.
4. Bisa logging offset/partition.

Kekurangan:

1. Callback harus ringan.
2. Error handling harus hati-hati.
3. Tidak boleh blocking berat di callback.

### 5.3 Sync Send

```java
RecordMetadata metadata = producer.send(record).get();
```

Kelebihan:

1. Sederhana untuk command-line, migration script, atau low-throughput critical path.
2. Caller tahu hasil per record.

Kekurangan:

1. Throughput rendah.
2. Menghilangkan manfaat batching.
3. Mudah membuat latency tinggi.
4. Jika dipakai di request thread, bisa membuat service lambat.

Dalam aplikasi high-throughput, sync send per record biasanya anti-pattern.

---

## 6. Producer Batching

Batching adalah core performance mechanism.

Tanpa batching:

```text
1 record -> 1 request -> 1 syscall/network roundtrip
```

Dengan batching:

```text
many records -> 1 batch -> 1 request
```

Batching mengurangi overhead:

1. Per-record network overhead.
2. Per-request broker processing overhead.
3. Per-record compression overhead.
4. Per-record disk/log append overhead.

### 6.1 `batch.size`

`batch.size` mengontrol ukuran maksimum batch per partition dalam bytes.

Misalnya:

```properties
batch.size=65536
```

Artinya producer akan mencoba mengumpulkan record untuk partition yang sama sampai batch mendekati 64 KiB sebelum dikirim, tetapi producer tidak harus menunggu penuh.

Hal penting:

```text
batch.size bukan jumlah record.
batch.size adalah bytes per topic-partition batch.
```

Jika record besar, batch mungkin hanya berisi sedikit record.

Jika traffic rendah per partition, batch mungkin tidak pernah penuh dan akan dikirim karena `linger.ms` atau kondisi lain.

### 6.2 `linger.ms`

`linger.ms` adalah waktu tunggu tambahan sebelum mengirim batch yang belum penuh.

Misalnya:

```properties
linger.ms=10
```

Producer dapat menunggu sampai 10 ms untuk memberi kesempatan record lain masuk ke batch.

Trade-off:

```text
higher linger -> better batching/compression/throughput, higher latency
lower linger  -> lower latency, worse batching
```

Untuk throughput-heavy workloads, `linger.ms` kecil seperti 5–20 ms sering memberi peningkatan besar.

Untuk ultra-low-latency command/event, `linger.ms` bisa 0 atau kecil sekali.

### 6.3 Batch Per Partition

Batching terjadi per topic-partition.

Jika satu topic punya 100 partition tetapi traffic tersebar tipis, tiap partition mungkin menerima sedikit record sehingga batching buruk.

Maka partition count terlalu tinggi bisa menurunkan batching efficiency.

Ini trade-off penting:

```text
more partitions -> more parallelism potential
more partitions -> smaller per-partition batches if traffic fixed
smaller batches -> worse compression and more overhead
```

### 6.4 Batching and Latency Distribution

Banyak engineer hanya melihat average latency. Kafka producer tuning harus melihat distribusi:

1. p50 latency.
2. p95 latency.
3. p99 latency.
4. timeout/error rate.
5. record queue time.
6. request latency.
7. batch size average.

`linger.ms=10` bukan berarti setiap record pasti terlambat 10 ms. Jika batch penuh lebih cepat, producer bisa mengirim lebih cepat. Tetapi pada low-traffic partitions, record bisa menunggu mendekati linger.

---

## 7. Producer Memory Buffer and Backpressure

Producer punya memory buffer global untuk menampung record yang belum terkirim.

Config utama:

```properties
buffer.memory=33554432
```

Default historisnya sekitar 32 MiB, tetapi jangan mengandalkan default tanpa sadar. Untuk workload besar, ini perlu dihitung.

### 7.1 Apa yang Terjadi Jika Buffer Penuh?

Jika aplikasi memanggil `send()` lebih cepat daripada producer bisa mengirim ke broker, buffer akan penuh.

Ketika buffer penuh, `send()` dapat memblokir sampai ada ruang atau sampai timeout terkait tercapai.

Gejala:

1. Request thread aplikasi tiba-tiba lambat.
2. CPU mungkin tidak tinggi, tetapi latency naik.
3. Error seperti buffer exhaustion/timeout.
4. Producer metrics menunjukkan bufferpool wait time naik.

### 7.2 Backpressure Adalah Signal, Bukan Noise

Buffer penuh berarti ada mismatch:

```text
application produce rate > Kafka accepted rate
```

Penyebab bisa:

1. Broker lambat.
2. Network lambat.
3. Topic leader unavailable.
4. ISR insufficient.
5. Record terlalu besar.
6. Compression CPU bottleneck.
7. Partition hot spot.
8. Quota membatasi producer.
9. Downstream storage broker penuh.

Jangan hanya menaikkan `buffer.memory` tanpa memahami penyebab. Menaikkan buffer bisa menunda failure dan membuat latency semakin tidak terlihat.

### 7.3 Producer Backpressure Strategy

Di aplikasi Java, kamu perlu keputusan eksplisit:

1. Apakah request user boleh menunggu Kafka?
2. Jika Kafka lambat, apakah API harus gagal?
3. Apakah event boleh masuk local durable outbox dulu?
4. Apakah event boleh di-drop?
5. Apakah producer service perlu circuit breaker?

Untuk event bisnis penting, strategi lebih aman biasanya:

```text
business transaction -> write DB + outbox atomically -> async relay to Kafka
```

Ini akan dibahas lebih dalam di part outbox/CDC.

---

## 8. Compression

Kafka producer dapat melakukan compression pada batch.

Common codecs:

1. `none`
2. `gzip`
3. `snappy`
4. `lz4`
5. `zstd`

Compression dilakukan pada batch, bukan hanya record individual. Karena itu batching yang baik meningkatkan compression ratio.

### 8.1 Compression Trade-Off

Compression menukar CPU dengan network/disk efficiency.

```text
better compression -> lower network bytes, lower disk bytes, possible higher CPU
worse compression  -> higher network/disk, lower CPU
```

Untuk Kafka, compression sering sangat menguntungkan karena:

1. Network biasanya bottleneck penting.
2. Disk usage turun.
3. Page cache lebih efektif.
4. Replication traffic turun.
5. Consumer juga membaca compressed batches.

### 8.2 Choosing Compression Type

Simplified heuristic:

| Codec | Karakter umum | Cocok untuk |
|---|---|---|
| none | CPU rendah, bytes tinggi | debugging, tiny low-volume workload |
| gzip | compression ratio bagus, CPU tinggi | archival/low throughput, bukan default high-throughput modern |
| snappy | cepat, ratio sedang | legacy/general low CPU |
| lz4 | cepat, latency baik | low-latency throughput workloads |
| zstd | ratio bagus, performa modern baik | default kuat untuk banyak workload modern |

Untuk banyak workload production modern, `zstd` atau `lz4` sering menjadi pilihan awal yang masuk akal. Namun keputusan final harus diukur.

### 8.3 Compression and Broker

Producer mengirim compressed batch ke broker. Broker tidak perlu decompress untuk menyimpan normal path. Ini membantu Kafka mempertahankan throughput tinggi.

Namun broker mungkin perlu inspect beberapa metadata batch atau melakukan validation tertentu. Jangan menganggap compression selalu gratis.

### 8.4 Compression and Consumer

Consumer akan menerima compressed data dan decompress di client. Artinya CPU cost sebagian berpindah ke consumer.

Jika consumer CPU-bound, compression yang terlalu berat bisa memperlambat consumption.

---

## 9. Acknowledgement: `acks`

`acks` menentukan kapan broker dianggap sudah cukup menerima record untuk merespons producer.

Nilai utama:

```properties
acks=0
acks=1
acks=all
```

### 9.1 `acks=0`

Producer tidak menunggu response broker.

Mental model:

```text
producer sends request -> considers it done
```

Kelebihan:

1. Latency sangat rendah.
2. Throughput bisa tinggi.
3. Tidak menunggu broker response.

Kekurangan:

1. Producer tidak tahu apakah broker menerima.
2. Tidak ada retry meaningful berbasis response.
3. Data loss sangat mungkin.
4. Tidak cocok untuk event bisnis penting.

Cocok untuk:

1. Metrics yang disposable.
2. Sampling telemetry.
3. Data yang memang boleh hilang.

Tidak cocok untuk:

1. Payment event.
2. Case lifecycle event.
3. Regulatory decision event.
4. Audit event.
5. Assignment/escalation event.

### 9.2 `acks=1`

Broker leader merespons setelah record ditulis ke leader log.

Mental model:

```text
leader appended -> success returned
```

Kelebihan:

1. Lebih aman daripada `acks=0`.
2. Latency lebih rendah daripada `acks=all`.
3. Throughput baik.

Kekurangan:

1. Jika leader crash sebelum follower replica catch up, acknowledged data bisa hilang.
2. Tidak memberi replicated durability guarantee.

Scenario data loss:

```text
replication.factor=3
acks=1
producer writes to leader
leader appends and returns success
followers belum fetch record
leader dies
new leader elected without that record
record hilang walaupun producer melihat success
```

### 9.3 `acks=all`

Producer menunggu sampai leader menerima acknowledgement dari in-sync replicas sesuai aturan broker/topic.

Mental model:

```text
leader appended + enough ISR condition satisfied -> success
```

Dengan `acks=all`, durability bergantung pada:

```text
replication.factor
min.insync.replicas
current ISR size
unclean leader election setting
```

Konfigurasi umum untuk critical data:

```properties
acks=all
enable.idempotence=true
```

Broker/topic:

```properties
replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false
```

Dengan ini, producer success berarti record sudah diterima oleh leader dan minimal replica condition yang diminta terpenuhi. Ini bukan absolute guarantee terhadap semua kemungkinan disaster, tetapi jauh lebih kuat daripada `acks=1`.

### 9.4 `acks=all` Bisa Gagal Saat ISR Tidak Cukup

Jika `min.insync.replicas=2`, tetapi ISR tinggal 1, broker dapat menolak write dengan error seperti insufficient replicas.

Ini behavior yang benar.

Ia memilih availability loss daripada menerima write yang tidak memenuhi durability target.

Trade-off:

```text
strict durability -> may reject writes during degraded replication
higher availability -> may accept writes with weaker durability
```

Untuk sistem regulatory, reject writes sering lebih baik daripada menerima event yang kemudian hilang diam-diam.

---

## 10. Replication, ISR, and Producer Durability

Producer durability tidak bisa dibahas hanya dari sisi producer config.

Producer config:

```properties
acks=all
```

harus dipasangkan dengan broker/topic config:

```properties
replication.factor=3
min.insync.replicas=2
```

Jika `replication.factor=1`, maka `acks=all` tetap hanya satu replica.

Ini kesalahan umum:

```text
acks=all does not magically create replication.
```

### 10.1 Replication Factor

`replication.factor=3` berarti setiap partition punya tiga replica.

Satu leader, dua follower.

### 10.2 ISR

ISR adalah replica yang dianggap cukup up-to-date.

Producer dengan `acks=all` tidak menunggu semua replica yang pernah ada, tetapi menunggu sesuai ISR/min ISR semantics.

### 10.3 `min.insync.replicas`

`min.insync.replicas=2` berarti write dengan `acks=all` harus memenuhi minimal dua in-sync replicas.

Jika tidak, write ditolak.

Ini penting untuk mencegah acknowledged write hanya berada di satu broker saat cluster degraded.

### 10.4 Practical Invariant

Untuk critical stream:

```text
replication.factor >= 3
min.insync.replicas >= 2
acks=all
enable.idempotence=true
unclean leader election disabled
```

Jika salah satu hilang, guarantee melemah.

---

## 11. Retries

Distributed systems gagal secara transient:

1. Broker leader berubah.
2. Network blip.
3. Metadata stale.
4. Request timeout.
5. Broker overload.
6. Throttling.

Producer retries membantu menyembuhkan transient failure.

Config terkait:

```properties
retries=...
retry.backoff.ms=...
delivery.timeout.ms=...
request.timeout.ms=...
```

### 11.1 Retry Tanpa Idempotence Bisa Membuat Duplicate

Scenario:

```text
producer sends batch B
broker appends B
response lost before producer receives it
producer times out
producer retries B
broker appends B again
```

Hasil:

```text
same logical records appear twice in Kafka log
```

Producer tidak tahu batch pertama berhasil karena response hilang.

Inilah alasan idempotent producer penting.

### 11.2 Retry Tidak Selalu Aman

Retry aman jika operasi idempotent atau ada deduplication.

Kafka idempotent producer membuat retry produce ke Kafka log lebih aman, tetapi event bisnis tetap perlu idempotency downstream.

Jika consumer melakukan side effect ke database/external API, duplicate record masih mungkin dari sumber lain:

1. Producer app menghasilkan dua event logis.
2. Consumer reprocess karena offset commit failure.
3. Rebalance terjadi setelah processing.
4. Replay manual.
5. CDC snapshot ulang.

Jadi:

```text
idempotent producer reduces duplicate writes caused by producer retry.
It does not eliminate all duplicate processing in the system.
```

---

## 12. Idempotent Producer

Idempotent producer membuat broker dapat mengenali duplicate batch dari producer yang sama untuk partition yang sama.

Secara konseptual producer punya:

1. Producer ID.
2. Producer epoch.
3. Sequence number per partition.

Broker melacak sequence number sehingga duplicate retry tidak diappend dua kali.

### 12.1 Apa yang Diselesaikan Idempotence?

Ia menyelesaikan kasus seperti:

```text
send batch -> broker append -> response lost -> retry same batch
```

Tanpa idempotence, duplicate bisa muncul.

Dengan idempotence, broker dapat mendeteksi bahwa batch itu sudah pernah ditulis.

### 12.2 Config Idempotence

Pada Kafka client modern, idempotence default-nya sudah aktif dalam kondisi config tidak konflik. Namun untuk event penting, lebih baik eksplisit:

```properties
enable.idempotence=true
acks=all
retries=2147483647
max.in.flight.requests.per.connection=5
```

Catatan: producer idempotence memiliki constraint terhadap config lain. Misalnya, idempotence membutuhkan `acks=all`, retries aktif, dan batas `max.in.flight.requests.per.connection` yang kompatibel.

### 12.3 Idempotence and Ordering

Sebelum idempotent producer, retry dengan lebih dari satu in-flight request bisa menyebabkan reordering.

Scenario klasik:

```text
send batch 1
send batch 2
batch 1 fails transiently
batch 2 succeeds
batch 1 retried and succeeds later
```

Jika tidak ada sequence protection, log bisa menerima batch 2 sebelum batch 1.

Idempotent producer membantu broker menjaga sequence per producer-partition.

### 12.4 Batasan Idempotent Producer

Idempotent producer bukan exactly-once end-to-end.

Tidak menyelesaikan:

1. Aplikasi mengirim event yang sama dua kali dengan event id berbeda.
2. Service crash setelah DB commit tetapi sebelum Kafka send.
3. Consumer melakukan side effect dua kali.
4. Duplicate akibat replay.
5. Duplicate lintas producer instance tanpa transactional identity yang tepat.

Idempotence adalah bagian dari puzzle, bukan keseluruhan puzzle.

---

## 13. In-Flight Requests and Ordering

`max.in.flight.requests.per.connection` menentukan berapa banyak request yang boleh dikirim tanpa menunggu response pada koneksi yang sama.

Trade-off:

```text
higher max in-flight -> higher throughput
lower max in-flight  -> simpler ordering under retry
```

Dengan idempotence modern, nilai sampai batas tertentu tetap menjaga guarantee producer. Namun tetap penting memahami konsekuensinya.

### 13.1 Ordering Scope

Ordering Kafka dijamin per partition, bukan global topic.

Producer ordering juga practical-nya per producer instance dan per target partition.

Jika dua producer berbeda menulis ke key yang sama ke partition sama, Kafka menjaga urutan append yang tiba di broker, tetapi tidak ada urutan “niat bisnis” global kecuali aplikasi mendesainnya.

### 13.2 Multi-Threaded Producers

`KafkaProducer` thread-safe. Banyak thread bisa memakai instance producer yang sama.

Namun ordering antar thread tidak selalu sesuai ekspektasi bisnis.

Contoh:

```text
Thread A sends CaseAssigned(case-1)
Thread B sends CaseClosed(case-1)
```

Jika dua operasi ini berasal dari causal chain yang berbeda dan tidak diserialisasi di aplikasi, Kafka hanya mengurutkan berdasarkan append arrival, bukan berdasarkan business causality.

Jika ordering penting, desain aplikasi harus memastikan:

1. Key sama.
2. Partition sama.
3. Producer call order sesuai causality.
4. Tidak ada multiple writers yang race tanpa coordination.

---

## 14. Timeouts: The Most Misunderstood Producer Area

Kafka producer memiliki beberapa timeout yang sering disalahpahami.

Config utama:

```properties
delivery.timeout.ms
request.timeout.ms
linger.ms
max.block.ms
```

### 14.1 `delivery.timeout.ms`

Ini batas total waktu untuk mengirim record sejak masuk producer sampai berhasil atau gagal final.

Ia mencakup:

1. Time in buffer.
2. Batching linger.
3. Request send.
4. Retries.
5. Broker response wait.

Jika delivery timeout tercapai, producer menyelesaikan record sebagai failed.

Namun distributed ambiguity tetap ada: failure karena timeout tidak selalu berarti broker tidak pernah menulis.

### 14.2 `request.timeout.ms`

Ini timeout untuk satu request ke broker.

Jika request tidak mendapat response dalam waktu ini, producer bisa retry jika error dianggap retriable dan masih dalam delivery timeout.

### 14.3 `max.block.ms`

Ini batas waktu `send()` boleh block ketika:

1. Producer buffer penuh.
2. Metadata belum tersedia.
3. Topic metadata tidak bisa diambil.

Jika aplikasi melihat `send()` melempar timeout akibat `max.block.ms`, biasanya ada masalah kapasitas, metadata, topic availability, atau cluster connectivity.

### 14.4 Timeout Design

Jangan memilih timeout sembarangan. Pertanyaan desain:

1. Berapa lama request user boleh menunggu?
2. Apakah event harus durable sebelum response API dikembalikan?
3. Apakah ada outbox lokal?
4. Apakah duplicate lebih bisa diterima daripada loss?
5. Berapa lama outage Kafka bisa ditoleransi aplikasi?

Untuk synchronous critical produce di request path, timeout pendek bisa menyebabkan false failure dan duplicate retry di level aplikasi.

Untuk async outbox relay, timeout lebih panjang mungkin masuk akal karena tidak memblokir user request.

---

## 15. Error Taxonomy

Producer error handling harus membedakan jenis error.

Secara praktis:

1. Retriable transient error.
2. Non-retriable configuration/schema error.
3. Authorization/security error.
4. Serialization error.
5. Timeout ambiguity.
6. Fatal producer state error.

### 15.1 Retriable Errors

Contoh:

1. Leader not available.
2. Not leader or follower.
3. Network exception.
4. Request timeout.
5. Coordinator/metadata transient issue.

Producer bisa retry otomatis jika config memungkinkan.

### 15.2 Non-Retriable Errors

Contoh:

1. Serialization exception.
2. Record too large.
3. Invalid topic.
4. Authorization failed.
5. Incompatible schema.
6. Message format/config mismatch.

Retry terus-menerus biasanya tidak membantu.

### 15.3 Timeout Ambiguity

Timeout adalah kasus khusus.

Jika producer callback menerima timeout, aplikasi sering ingin “kirim ulang”. Tapi pengiriman ulang bisa membuat duplicate jika operasi sebelumnya sebenarnya berhasil.

Dengan idempotent producer, retry internal lebih aman. Namun jika aplikasi membuat record baru dan mengirim ulang dengan event id baru, duplicate business event bisa muncul.

Maka event bisnis harus punya `eventId` stabil.

---

## 16. Java Producer: Baseline Production Example

Berikut contoh producer Java yang lebih sadar production dibanding contoh minimal.

### 16.1 Maven Dependencies

Contoh dependency Kafka client:

```xml
<dependency>
    <groupId>org.apache.kafka</groupId>
    <artifactId>kafka-clients</artifactId>
    <version>${kafka.clients.version}</version>
</dependency>
```

Gunakan versi yang kompatibel dengan cluster dan platform dependency management kamu.

### 16.2 Event Model

```java
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record CaseLifecycleEvent(
        String eventId,
        String caseId,
        String eventType,
        int schemaVersion,
        Instant occurredAt,
        String actorId,
        Map<String, Object> data
) {
    public static CaseLifecycleEvent assigned(
            String caseId,
            String actorId,
            String assigneeId
    ) {
        return new CaseLifecycleEvent(
                UUID.randomUUID().toString(),
                caseId,
                "CASE_ASSIGNED",
                1,
                Instant.now(),
                actorId,
                Map.of("assigneeId", assigneeId)
        );
    }
}
```

Catatan:

1. `eventId` harus stabil jika event yang sama di-retry dari aplikasi/outbox.
2. `caseId` cocok menjadi key jika ordering per case penting.
3. `occurredAt` adalah event time, bukan broker append time.
4. `schemaVersion` eksplisit membantu transisi sebelum Schema Registry dibahas.

### 16.3 Producer Configuration

```java
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;

import java.util.Properties;

public final class KafkaProducerConfigFactory {

    public static Properties productionLikeConfig(String bootstrapServers) {
        Properties props = new Properties();

        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ProducerConfig.CLIENT_ID_CONFIG, "case-service-producer");

        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, JsonSerializer.class.getName());

        // Durability and duplicate protection
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");

        // Batching and throughput
        props.put(ProducerConfig.LINGER_MS_CONFIG, "10");
        props.put(ProducerConfig.BATCH_SIZE_CONFIG, Integer.toString(64 * 1024));
        props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");

        // Timeouts
        props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "120000");
        props.put(ProducerConfig.REQUEST_TIMEOUT_MS_CONFIG, "30000");
        props.put(ProducerConfig.MAX_BLOCK_MS_CONFIG, "10000");

        // Safety boundaries
        props.put(ProducerConfig.MAX_REQUEST_SIZE_CONFIG, Integer.toString(1024 * 1024));

        return props;
    }
}
```

`JsonSerializer` di atas adalah placeholder. Untuk production enterprise, Avro/Protobuf/JSON Schema dengan Schema Registry biasanya lebih kuat daripada JSON custom tanpa governance.

### 16.4 Simple JSON Serializer Example

Untuk pembelajaran lokal:

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.apache.kafka.common.errors.SerializationException;
import org.apache.kafka.common.serialization.Serializer;

public final class JsonSerializer<T> implements Serializer<T> {
    private final ObjectMapper mapper = new ObjectMapper()
            .registerModule(new JavaTimeModule());

    @Override
    public byte[] serialize(String topic, T data) {
        if (data == null) {
            return null;
        }
        try {
            return mapper.writeValueAsBytes(data);
        } catch (Exception e) {
            throw new SerializationException("Failed to serialize record for topic " + topic, e);
        }
    }
}
```

Catatan penting:

1. Ini bukan rekomendasi final untuk enterprise schema governance.
2. Ini hanya agar producer example bisa dipahami.
3. Schema Registry akan dibahas pada Part 010.

### 16.5 Producer Service

```java
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.header.internals.RecordHeader;

import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;

public final class CaseEventProducer implements AutoCloseable {

    private final KafkaProducer<String, CaseLifecycleEvent> producer;
    private final String topic;

    public CaseEventProducer(Properties props, String topic) {
        this.producer = new KafkaProducer<>(props);
        this.topic = Objects.requireNonNull(topic);
    }

    public CompletableFuture<RecordMetadata> publish(CaseLifecycleEvent event) {
        Objects.requireNonNull(event, "event");

        String key = event.caseId();

        ProducerRecord<String, CaseLifecycleEvent> record = new ProducerRecord<>(
                topic,
                null,
                event.occurredAt().toEpochMilli(),
                key,
                event
        );

        record.headers().add(new RecordHeader(
                "event-id",
                event.eventId().getBytes(StandardCharsets.UTF_8)
        ));
        record.headers().add(new RecordHeader(
                "event-type",
                event.eventType().getBytes(StandardCharsets.UTF_8)
        ));
        record.headers().add(new RecordHeader(
                "schema-version",
                Integer.toString(event.schemaVersion()).getBytes(StandardCharsets.UTF_8)
        ));

        CompletableFuture<RecordMetadata> result = new CompletableFuture<>();

        producer.send(record, (metadata, exception) -> {
            if (exception != null) {
                result.completeExceptionally(exception);
                return;
            }
            result.complete(metadata);
        });

        return result;
    }

    public void flush() {
        producer.flush();
    }

    @Override
    public void close() {
        producer.close();
    }
}
```

### 16.6 Usage Example

```java
public class Main {
    public static void main(String[] args) {
        var props = KafkaProducerConfigFactory.productionLikeConfig("localhost:9092");

        try (var producer = new CaseEventProducer(props, "case-lifecycle-events")) {
            var event = CaseLifecycleEvent.assigned(
                    "CASE-123",
                    "user-77",
                    "investigator-9"
            );

            producer.publish(event)
                    .whenComplete((metadata, error) -> {
                        if (error != null) {
                            System.err.println("Failed to publish eventId=" + event.eventId() + ": " + error);
                        } else {
                            System.out.printf(
                                    "Published eventId=%s topic=%s partition=%d offset=%d%n",
                                    event.eventId(),
                                    metadata.topic(),
                                    metadata.partition(),
                                    metadata.offset()
                            );
                        }
                    })
                    .join();
        }
    }
}
```

Perhatikan bahwa `.join()` di sini hanya untuk demo CLI. Dalam service high-throughput, jangan join per event di request path kecuali memang requirement-nya synchronous.

---

## 17. Callback Design

Callback producer dieksekusi oleh thread internal producer. Karena itu callback harus ringan.

Jangan lakukan:

```java
producer.send(record, (metadata, exception) -> {
    // bad idea
    callSlowExternalService();
    performDatabaseTransaction();
    producer.send(anotherRecord).get();
});
```

Masalah:

1. Menghambat sender thread.
2. Menurunkan throughput producer.
3. Bisa deadlock jika callback menunggu producer yang sama.
4. Membuat latency tidak stabil.

Callback sebaiknya:

1. Complete future.
2. Increment metric.
3. Log ringan.
4. Submit heavy work ke executor lain jika perlu.

### 17.1 Logging in Callback

Logging setiap success event bisa menjadi bottleneck.

Lebih baik:

1. Log failure detail.
2. Sample success logs.
3. Gunakan metrics untuk success rate.
4. Simpan offset hanya jika benar-benar perlu untuk audit/debug.

### 17.2 Callback Error Handling

Jangan swallow exception.

Minimal:

```java
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        log.error("Kafka produce failed topic={} key={} eventId={}",
                topic, key, eventId, exception);
        failureCounter.increment();
        return;
    }
    successCounter.increment();
});
```

Untuk event critical, failure harus masuk mekanisme recovery:

1. Outbox remains unsent.
2. Retry scheduler.
3. DLQ lokal.
4. Alert.
5. Circuit breaker.

---

## 18. Producer and Application Transaction Boundary

Salah satu pertanyaan paling penting:

```text
Kapan business transaction dianggap selesai?
```

Misalnya API:

```text
POST /cases/{id}/assign
```

Operasi perlu:

1. Update database case assignment.
2. Publish `CASE_ASSIGNED` event ke Kafka.

Naive implementation:

```text
begin DB transaction
update case assignment
commit DB transaction
producer.send(CASE_ASSIGNED)
return 200
```

Failure:

```text
DB commit succeeds
service crashes before Kafka send
```

Database berubah, event tidak pernah muncul.

Alternative naive:

```text
producer.send(CASE_ASSIGNED)
begin DB transaction
update case assignment
commit DB transaction
```

Failure:

```text
Kafka event published
DB transaction fails
```

Event mengatakan assignment terjadi, tetapi database tidak berubah.

Ini disebut dual-write problem.

### 18.1 Producer Config Tidak Menyelesaikan Dual-Write

`acks=all` dan idempotence membuat write ke Kafka lebih kuat, tetapi tidak membuat atomic dengan database transaction.

Untuk atomicity antara database dan Kafka, pattern umum:

```text
begin DB transaction
update business table
insert outbox row with stable eventId
commit DB transaction
outbox relay publishes to Kafka
mark outbox row sent
```

Atau menggunakan CDC terhadap outbox table.

Ini akan dibahas detail di Part 016.

### 18.2 Kapan Direct Produce Cukup?

Direct produce bisa cukup jika:

1. Kafka adalah source of truth.
2. Tidak ada local DB transaction yang harus atomic.
3. Event loss/duplication ditangani di domain.
4. API dapat gagal jika Kafka gagal.
5. Service memang ingestion service ke Kafka.

Contoh cocok:

1. Telemetry ingestion.
2. Clickstream collector.
3. Log pipeline.
4. Command ingestion ke event-sourced system dengan Kafka as first durable write.

Untuk case management dengan relational state, outbox sering lebih aman.

---

## 19. Event Key Design from Producer Perspective

Producer memilih key. Key menentukan partition.

Pertanyaan penting:

```text
Unit bisnis apa yang membutuhkan ordering?
```

Contoh:

| Use case | Key yang mungkin tepat | Alasan |
|---|---|---|
| Case lifecycle | `caseId` | Semua event case yang sama harus urut |
| Payment lifecycle | `paymentId` | State payment harus urut |
| Account balance | `accountId` | Update account harus urut |
| Tenant metrics | mungkin `tenantId + metricType` | Hindari hot tenant tergantung volume |
| Notification event | `recipientId` atau null | Tergantung ordering kebutuhan recipient |

### 19.1 Wrong Key Consequences

Jika memakai random event id sebagai key:

```text
CASE_CREATED(case-1) -> partition 2
CASE_ASSIGNED(case-1) -> partition 8
CASE_CLOSED(case-1) -> partition 1
```

Consumer paralel bisa memproses out of order.

Jika memakai `caseId`:

```text
CASE_CREATED(case-1) -> partition 4
CASE_ASSIGNED(case-1) -> partition 4
CASE_CLOSED(case-1) -> partition 4
```

Ordering per case lebih terjaga.

### 19.2 Hot Key Risk

Jika satu key sangat populer, semua event key itu masuk satu partition.

Contoh:

```text
tenantId = government-agency-large
```

Jika tenant ini menghasilkan 80% traffic, partition-nya hot.

Solusi mungkin:

1. Key berdasarkan entity ID, bukan tenant ID.
2. Composite key dengan shard suffix jika ordering tenant global tidak perlu.
3. Split domain topic.
4. Use separate topic untuk large tenant.
5. Reconsider ordering requirement.

---

## 20. Headers

Kafka record headers berguna untuk metadata teknis atau routing ringan.

Contoh header:

1. `event-id`
2. `event-type`
3. `correlation-id`
4. `causation-id`
5. `traceparent`
6. `tenant-id`
7. `schema-version`
8. `producer-service`

Headers jangan menjadi tempat domain payload utama.

Payload tetap sumber utama fakta bisnis.

### 20.1 Header vs Payload

Gunakan header untuk:

1. Observability.
2. Routing infra.
3. Tracing.
4. Dedup metadata.
5. Compatibility metadata.

Gunakan payload untuk:

1. Business facts.
2. Domain data.
3. State transition details.
4. Evidence/decision fields.

### 20.2 Correlation and Causation

Untuk sistem workflow/regulatory, dua field ini penting:

```text
correlation-id: semua event dalam satu business flow
causation-id: event/command yang menyebabkan event ini
```

Contoh:

```text
correlation-id = case-CASE-123-investigation-flow-456
causation-id   = command-ASSIGN-789
```

Ini membantu reconstruct chain of events.

---

## 21. Producer Metrics

Producer production harus dimonitor.

Metrik penting:

1. Record send rate.
2. Record error rate.
3. Request latency average/p95/p99.
4. Record queue time.
5. Batch size average.
6. Compression rate.
7. Record retry rate.
8. Record size max/average.
9. Buffer available bytes.
10. Buffer exhausted/blocking time.
11. Outgoing byte rate.
12. Request rate.
13. Response rate.
14. Metadata age.
15. Throttle time.

### 21.1 Metrics Tell Different Stories

High retry rate:

```text
broker/network/metadata instability
```

High buffer wait:

```text
producer generating faster than sender/broker can accept
```

Low batch size with high request rate:

```text
poor batching, maybe too many partitions or low linger
```

High request latency:

```text
broker overloaded, ISR issue, network, disk, throttling
```

High throttle time:

```text
quota is limiting producer
```

### 21.2 Application-Level Metrics

Selain Kafka client metrics, kamu butuh business metrics:

1. Events attempted.
2. Events accepted by producer callback.
3. Events failed after retries.
4. Outbox pending count.
5. Outbox oldest unsent age.
6. Event publish latency from business commit to Kafka append.
7. Event type distribution.
8. Tenant distribution.
9. Key skew.

Untuk regulatory systems, `oldest unsent event age` sering lebih berguna daripada raw send rate.

---

## 22. Tuning by Goal

Tidak ada config producer universal. Tuning harus berdasarkan goal.

### 22.1 Goal: Maximum Durability for Critical Events

Producer:

```properties
acks=all
enable.idempotence=true
compression.type=zstd
linger.ms=5-20
batch.size=32768-131072
delivery.timeout.ms=120000
request.timeout.ms=30000
```

Topic/broker:

```properties
replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false
```

Application:

```text
stable eventId
outbox pattern if DB write involved
idempotent consumers
monitor failed publish
```

Trade-off:

1. Lower availability during degraded cluster.
2. Higher latency than weak durability.
3. More operational correctness.

### 22.2 Goal: Low Latency

Producer:

```properties
linger.ms=0-2
batch.size=16384-32768
compression.type=lz4 or none depending measurement
acks=all or 1 depending durability requirement
```

But be careful:

```text
low latency does not justify data loss unless business accepts it.
```

Measure p99, not only average.

### 22.3 Goal: High Throughput

Producer:

```properties
linger.ms=10-50
batch.size=65536-262144
compression.type=zstd or lz4
acks=all with adequate cluster sizing
buffer.memory increased based on load
```

Also:

1. Use async send.
2. Avoid blocking per record.
3. Use enough partitions, not too many.
4. Use stable keys with enough cardinality.
5. Monitor batch size and compression ratio.

### 22.4 Goal: Best Effort Telemetry

Producer:

```properties
acks=0 or 1
linger.ms=20-100
compression.type=zstd
```

Application:

1. Allow drops.
2. Sampling.
3. No critical audit expectation.
4. Clear documentation that stream is lossy.

Do not reuse this config for business events.

---

## 23. Common Anti-Patterns

### 23.1 Treating KafkaProducer as Per-Request Object

Bad:

```java
public void publish(Event event) {
    KafkaProducer<String, Event> producer = new KafkaProducer<>(props);
    producer.send(record).get();
    producer.close();
}
```

Problems:

1. Recreates network connections.
2. Recreates metadata cache.
3. Kills batching.
4. Expensive under load.
5. Terrible latency.

Better:

```text
one shared producer per service instance per config/security context
```

`KafkaProducer` is thread-safe.

### 23.2 Ignoring Callback Errors

Bad:

```java
producer.send(record);
```

For critical event, this hides failure.

### 23.3 Blocking in Callback

Bad because callback runs on producer internals.

### 23.4 Using Random Key for Ordered Domain

Bad:

```text
key = UUID.randomUUID()
```

if ordering per entity is required.

### 23.5 Oversized Events

Kafka can handle large messages with config changes, but it is usually bad design.

Problems:

1. Broker memory pressure.
2. Network spikes.
3. Consumer memory pressure.
4. Poor batching.
5. Long GC pauses.
6. Replication overhead.

Better:

```text
store large blob elsewhere
send reference + metadata event
```

### 23.6 Assuming `acks=all` Means No Data Loss Ever

`acks=all` is strong but conditional.

It depends on:

1. Replication factor.
2. Min ISR.
3. ISR health.
4. Unclean leader election.
5. Disk durability assumptions.
6. Disaster scope.

### 23.7 Tuning Without Metrics

Changing `linger.ms`, `batch.size`, `compression.type`, and partition count without metrics is guessing.

Minimum observe:

1. Send rate.
2. Error rate.
3. Retry rate.
4. Request latency.
5. Batch size.
6. Compression ratio.
7. Buffer wait.
8. Broker under-replicated partitions.

---

## 24. Failure Modes

### 24.1 Broker Unavailable

Symptoms:

1. Metadata refresh fails.
2. Send blocks waiting metadata.
3. Retries increase.
4. Callback failures after delivery timeout.

Handling:

1. Alert.
2. Outbox retains unsent events.
3. API degrades or fails explicitly.
4. Do not silently drop critical events.

### 24.2 Leader Election During Produce

Producer may receive leader-related errors and refresh metadata.

This is normal during broker restart/failure.

Good producer config should tolerate transient leader movement.

### 24.3 ISR Shrink

With `acks=all` and `min.insync.replicas=2`, produce may fail if ISR shrinks below min.

This is a protective failure.

Operational response:

1. Fix replication lag.
2. Check broker health.
3. Check disk/network.
4. Avoid lowering min ISR impulsively.

### 24.4 Serialization Failure

Producer cannot serialize event.

This usually means:

1. Bad payload.
2. Bad schema evolution.
3. Serializer bug.
4. Schema Registry issue.

Retriable only if dependency outage; not if payload/schema invalid.

### 24.5 Record Too Large

If record exceeds producer/broker/topic size constraints, send fails.

Fix design or config. Prefer design fix.

### 24.6 Producer Buffer Exhaustion

Producer cannot send as fast as application produces.

Handling:

1. Apply application backpressure.
2. Shed low-priority load.
3. Increase capacity only after diagnosing bottleneck.
4. Use outbox for durable decoupling.

### 24.7 Callback Success but Downstream Failure

Producer success only means Kafka accepted record according to `acks`.

It does not mean consumers processed it.

For end-to-end workflow, you need downstream monitoring, lag metrics, and possibly acknowledgement events.

---

## 25. Producer Design for Case Management / Regulatory Systems

Untuk enforcement lifecycle/case management, producer design harus menjawab:

1. Apakah event adalah audit fact?
2. Apakah event merepresentasikan state transition?
3. Apakah event bisa dikoreksi?
4. Apakah event harus replayable untuk legal reconstruction?
5. Apakah event loss bisa diterima?
6. Apakah duplicate bisa diterima jika consumers idempotent?
7. Apakah ordering per case wajib?

### 25.1 Recommended Baseline

Untuk event seperti:

1. `CASE_CREATED`
2. `CASE_ASSIGNED`
3. `CASE_ESCALATED`
4. `EVIDENCE_ATTACHED`
5. `DECISION_RECORDED`
6. `CASE_CLOSED`

Baseline:

```text
key = caseId
acks = all
enable.idempotence = true
replication.factor = 3
min.insync.replicas = 2
stable eventId
correlationId + causationId
outbox if DB transaction involved
idempotent consumer design
```

### 25.2 Correction, Not Mutation

Jika event salah, jangan mencoba “menghapus sejarah” dari Kafka log untuk normal correction.

Gunakan correction event:

```text
CASE_ASSIGNMENT_CORRECTED
DECISION_SUPERSEDED
EVIDENCE_REDACTION_APPLIED
```

Ini menjaga auditability.

### 25.3 Produce Acceptance vs Business Completion

Untuk regulatory workflow, jangan menganggap:

```text
Kafka callback success == workflow completed
```

Lebih tepat:

```text
Kafka callback success == fact accepted into event log
workflow completion == all required state transitions and downstream projections complete or acknowledged
```

---

## 26. Practical Configuration Profiles

### 26.1 Critical Business Event Producer

```properties
bootstrap.servers=kafka-1:9092,kafka-2:9092,kafka-3:9092
client.id=case-service-producer

key.serializer=org.apache.kafka.common.serialization.StringSerializer
value.serializer=...

acks=all
enable.idempotence=true
retries=2147483647
max.in.flight.requests.per.connection=5

compression.type=zstd
linger.ms=10
batch.size=65536
buffer.memory=67108864

delivery.timeout.ms=120000
request.timeout.ms=30000
max.block.ms=10000

max.request.size=1048576
```

Topic expectation:

```properties
replication.factor=3
min.insync.replicas=2
cleanup.policy=delete
retention.ms=...
```

### 26.2 Low-Latency Event Producer

```properties
acks=all
enable.idempotence=true
compression.type=lz4
linger.ms=0
batch.size=16384
delivery.timeout.ms=30000
request.timeout.ms=10000
```

Measure carefully. Low latency with `acks=all` requires healthy broker/network/disk.

### 26.3 Bulk Ingestion Producer

```properties
acks=all
enable.idempotence=true
compression.type=zstd
linger.ms=50
batch.size=262144
buffer.memory=268435456
delivery.timeout.ms=300000
```

Use only after capacity testing. Large buffers and batches can increase memory footprint and latency.

---

## 27. Testing Producer Behavior

Producer tests should cover more than “message exists”.

### 27.1 Unit Tests

Test:

1. Key selection.
2. Header creation.
3. Event envelope correctness.
4. Serialization of valid event.
5. Serialization failure of invalid event.

### 27.2 Integration Tests with Testcontainers

Test:

1. Produce to real Kafka.
2. Consume and verify key/value/header.
3. Verify same `caseId` maps consistently.
4. Verify callback receives metadata.
5. Verify invalid topic/auth if applicable.

### 27.3 Failure Tests

Harder but valuable:

1. Broker restart during produce.
2. Topic missing.
3. Serialization exception.
4. Record too large.
5. Buffer pressure.
6. ISR insufficient if test cluster supports it.

### 27.4 Contract Tests

If consumers rely on schema:

1. Validate schema compatibility.
2. Validate required fields.
3. Validate event type enum evolution.
4. Validate headers if part of contract.

---

## 28. Debugging Producer Incidents

When producer incident happens, ask in this order.

### 28.1 Is the Application Actually Producing?

Check:

1. Event attempted count.
2. Serialization errors.
3. Callback failures.
4. Producer closed state.
5. Thread pool saturation.

### 28.2 Is Producer Blocked Locally?

Check:

1. Buffer wait time.
2. `max.block.ms` timeout.
3. Metadata availability.
4. DNS/connectivity.
5. Security handshake.

### 28.3 Is Broker Accepting Writes?

Check:

1. Topic exists.
2. Leader exists.
3. ISR sufficient.
4. ACL allows write.
5. Quota throttle.
6. Broker request latency.
7. Disk full.
8. Under-replicated partitions.

### 28.4 Is Data Actually in Topic?

Check with console consumer or admin tooling:

1. Topic partition offsets.
2. Record key.
3. Timestamp.
4. Headers.
5. Consumer group not relevant for producer acceptance.

### 28.5 Is It a Downstream Problem?

Producer success but business effect missing may be consumer/projection issue.

Check:

1. Consumer lag.
2. Consumer errors.
3. DLQ.
4. Projection database.
5. Schema mismatch.

---

## 29. Design Trade-Off Summary

| Decision | Favors | Costs |
|---|---|---|
| `acks=0` | latency/throughput | data loss visibility buruk |
| `acks=1` | latency with leader durability | acknowledged data can be lost on leader crash |
| `acks=all` | replicated durability | higher latency, possible write rejection during degraded ISR |
| high `linger.ms` | throughput/compression | added latency |
| low `linger.ms` | low latency | poor batching |
| large `batch.size` | throughput/compression | memory, latency, large request risk |
| compression `zstd` | lower bytes/cost | CPU cost |
| idempotence on | safer retry/order | config constraints, not end-to-end exactly once |
| sync send | simple correctness surface | low throughput, high latency |
| async callback | performance and visibility | requires careful error handling |
| random key | distribution | destroys entity ordering |
| entity key | ordering per entity | possible hot key |

---

## 30. Checklist

### 30.1 Producer Correctness Checklist

- [ ] Apakah event punya stable `eventId`?
- [ ] Apakah key dipilih berdasarkan ordering domain yang benar?
- [ ] Apakah callback error ditangani?
- [ ] Apakah `acks` sesuai criticality event?
- [ ] Apakah idempotence aktif?
- [ ] Apakah topic replication factor dan min ISR mendukung producer durability target?
- [ ] Apakah application transaction boundary aman?
- [ ] Apakah outbox dibutuhkan?
- [ ] Apakah serialization/schema failure ditangani berbeda dari network retry?
- [ ] Apakah producer shutdown melakukan flush/close dengan benar?

### 30.2 Producer Performance Checklist

- [ ] Apakah send asynchronous?
- [ ] Apakah callback ringan?
- [ ] Apakah batch size diamati?
- [ ] Apakah compression ratio diamati?
- [ ] Apakah buffer wait time rendah?
- [ ] Apakah retry rate normal?
- [ ] Apakah request latency stabil?
- [ ] Apakah partition count masuk akal terhadap throughput?
- [ ] Apakah key distribution tidak skew parah?
- [ ] Apakah record size bounded?

### 30.3 Producer Operational Checklist

- [ ] Metrics producer diekspor.
- [ ] Alert untuk error rate.
- [ ] Alert untuk retry spike.
- [ ] Alert untuk buffer exhaustion.
- [ ] Alert untuk publish latency.
- [ ] Alert untuk outbox oldest unsent age.
- [ ] Runbook tersedia untuk ISR insufficient.
- [ ] Runbook tersedia untuk serialization/schema failure.
- [ ] ACL/security failure mudah didiagnosis.
- [ ] Topic ownership jelas.

---

## 31. Latihan / Thought Exercises

### Latihan 1 — Pilih Key

Kamu punya event:

```text
CASE_CREATED
CASE_ASSIGNED
CASE_ESCALATED
CASE_COMMENT_ADDED
CASE_CLOSED
```

Pertanyaan:

1. Key apa yang kamu pilih?
2. Apa ordering guarantee yang kamu dapat?
3. Apa trade-off jika satu case sangat aktif?
4. Apakah `tenantId` lebih baik daripada `caseId`?
5. Kapan kamu akan memakai composite key?

Jawaban yang diharapkan:

`caseId` biasanya key terbaik jika semua event lifecycle case harus urut per case. `tenantId` bisa menyebabkan hot partition dan ordering terlalu luas. Composite key bisa dipakai jika ordering domain lebih sempit atau perlu sharding.

### Latihan 2 — Analyze Failure

Config:

```properties
acks=1
replication.factor=3
min.insync.replicas=2
```

Scenario:

```text
producer receives success
leader crashes immediately
followers had not replicated record
```

Pertanyaan:

1. Bisa data hilang?
2. Apakah `min.insync.replicas=2` membantu jika `acks=1`?
3. Apa config producer yang lebih tepat?

Jawaban:

Ya, data bisa hilang. `min.insync.replicas` relevan untuk produce request dengan `acks=all`; dengan `acks=1`, producer hanya menunggu leader. Gunakan `acks=all` untuk durability yang lebih kuat.

### Latihan 3 — Timeout Ambiguity

Producer mendapat delivery timeout untuk event `CASE_CLOSED`.

Pertanyaan:

1. Apakah event pasti tidak ada di Kafka?
2. Apakah aman membuat event baru dengan eventId baru dan mengirim ulang?
3. Apa strategi lebih aman?

Jawaban:

Tidak pasti. Timeout bisa berarti response hilang setelah append. Lebih aman memakai stable eventId dan idempotent processing. Untuk DB-backed workflow, outbox relay harus retry row event yang sama, bukan membuat event baru.

### Latihan 4 — Throughput Tuning

Producer mengirim 50k events/sec, p99 latency naik, broker tidak overload, tetapi request rate sangat tinggi dan average batch size kecil.

Pertanyaan:

1. Apa dugaan awal?
2. Config apa yang diperiksa?
3. Apa risiko terlalu banyak partition?

Jawaban:

Batching buruk. Periksa `linger.ms`, `batch.size`, traffic per partition, key distribution, partition count. Terlalu banyak partition dapat membuat traffic per partition terlalu kecil sehingga batch tidak efisien.

### Latihan 5 — Regulatory Event Design

Event `DECISION_RECORDED` harus menjadi audit fact.

Pertanyaan:

1. Apakah boleh `acks=0`?
2. Apakah callback boleh diabaikan?
3. Apakah perlu outbox?
4. Field metadata apa yang harus ada?

Jawaban:

Tidak cocok dengan `acks=0`. Callback/error harus ditangani. Jika decision juga disimpan di DB, outbox sangat disarankan. Metadata minimal: eventId, decisionId/caseId, occurredAt, actorId, correlationId, causationId, schemaVersion, reason/evidence reference.

---

## 32. Ringkasan

Producer Kafka adalah komponen aktif yang melakukan serialization, partitioning, buffering, batching, compression, retry, idempotence, metadata refresh, dan asynchronous network I/O.

Hal terpenting dari Part 004:

1. `send()` bukan bukti record sudah durable.
2. Callback success berarti broker menerima sesuai `acks`, bukan consumer sudah memproses.
3. `acks=all` harus dipasangkan dengan replication factor dan `min.insync.replicas` yang benar.
4. Retry tanpa idempotence bisa menyebabkan duplicate write.
5. Idempotent producer mengurangi duplicate akibat retry, tetapi bukan exactly-once end-to-end.
6. Batching dan compression adalah sumber utama throughput Kafka producer.
7. `linger.ms`, `batch.size`, `buffer.memory`, dan compression harus dituning berdasarkan goal dan metrics.
8. Key menentukan ordering domain dan load distribution.
9. Producer config tidak menyelesaikan dual-write antara DB dan Kafka.
10. Untuk business-critical/regulatory event, gunakan stable event id, key yang benar, `acks=all`, idempotence, outbox bila perlu, observability, dan idempotent downstream processing.

Mental model final:

```text
A Kafka producer is not just a sender.
It is a distributed log writer with memory buffering, ordering constraints,
retry ambiguity, durability trade-offs, and business-level consequences.
```

---

## 33. Referensi

Referensi yang relevan untuk bagian ini:

1. Apache Kafka Documentation — Producer Configurations.  
   https://kafka.apache.org/documentation/#producerconfigs

2. Apache Kafka Documentation — Design and Replication.  
   https://kafka.apache.org/documentation/#design

3. Apache Kafka JavaDocs — `KafkaProducer`.  
   https://kafka.apache.org/javadoc/

4. Confluent Documentation — Kafka Producer Configuration Reference.  
   https://docs.confluent.io/platform/current/installation/configuration/producer-configs.html

5. Confluent Documentation — Kafka Producer Design.  
   https://docs.confluent.io/kafka/design/producer-design.html

6. Confluent Documentation — Kafka Message Delivery Guarantees.  
   https://docs.confluent.io/kafka/design/delivery-semantics.html

7. Apache Kafka Documentation — Configuration Reference for `acks`, `batch.size`, `linger.ms`, `delivery.timeout.ms`, `enable.idempotence`, and related configs.

---

## 34. Status Seri

Progress seri:

```text
Part 000 — selesai
Part 001 — selesai
Part 002 — selesai
Part 003 — selesai
Part 004 — selesai
Part 005 — berikutnya
```

Seri belum selesai. Bagian berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-005.md
```

Topik berikutnya:

```text
Partitioning Strategy: Keys, Ordering Domains, Hot Partitions, and Scalability
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Kafka Cluster Architecture: KRaft, Controllers, Metadata, and Quorum</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-005.md">Part 005 — Partitioning Strategy: Keys, Ordering Domains, Hot Partitions, and Scalability ➡️</a>
</div>

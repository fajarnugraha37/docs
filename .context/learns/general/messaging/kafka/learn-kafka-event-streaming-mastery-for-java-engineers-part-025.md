# learn-kafka-event-streaming-mastery-for-java-engineers-part-025.md

# Part 025 — Performance Engineering: Throughput, Latency, Batching, Compression, Partitions, and Quotas

> Seri: Kafka Event Streaming Mastery for Java Engineers  
> Bagian: 025 dari 034  
> Fokus: performance engineering Kafka dari sisi producer, broker, consumer, topic design, quota, benchmarking, dan diagnosis bottleneck production.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa performa Kafka bukan “tinggal tambah partition”, tetapi hasil dari interaksi antara producer batching, compression, network, broker I/O, replication, page cache, consumer fetch, dan downstream processing.
2. Membedakan optimasi untuk **throughput**, **latency**, **tail latency**, **cost efficiency**, dan **stability**.
3. Mendesain konfigurasi producer yang sesuai untuk workload low-latency, high-throughput, dan balanced.
4. Mendesain konfigurasi consumer untuk menghindari lag explosion, over-fetching, under-fetching, dan rebalance karena processing terlalu lama.
5. Menentukan partition count dengan reasoning, bukan angka mistis.
6. Memahami efek compression terhadap CPU, network, disk, dan latency.
7. Menganalisis bottleneck Kafka secara sistematis: client, broker, disk, network, partition skew, replication, consumer, atau downstream.
8. Mendesain benchmark yang valid dan tidak menipu.
9. Menggunakan quota untuk mencegah noisy neighbor pada Kafka cluster multi-tenant.
10. Menyusun checklist performance readiness sebelum sebuah pipeline Kafka masuk production.

---

## 2. Mental Model Utama

Kafka performance harus dilihat sebagai pipeline, bukan sebagai satu komponen.

```text
producer application
  -> serializer
  -> partitioner
  -> producer accumulator
  -> batch
  -> compression
  -> network request
  -> broker request queue
  -> leader append
  -> page cache / disk
  -> replication to followers
  -> high watermark / ack
  -> consumer fetch
  -> deserializer
  -> application processing
  -> offset commit
  -> downstream side effect
```

Jika ada bottleneck di satu titik, seluruh pipeline terlihat “Kafka lambat”, padahal penyebabnya bisa sangat berbeda:

```text
Symptom: consumer lag naik
Possible causes:
- producer rate meningkat
- consumer processing lambat
- downstream database lambat
- partition skew
- rebalance storm
- broker overloaded
- fetch size terlalu kecil
- message terlalu besar
- schema/deserialize lambat
- GC pause
- quota throttling
- network saturation
```

Performance engineering Kafka berarti menjawab pertanyaan:

> Di titik mana pipeline menghabiskan waktu, CPU, memory, disk, network, atau coordination cost?

---

## 3. Throughput vs Latency: Trade-off Paling Dasar

### 3.1 Throughput

Throughput adalah jumlah data atau record yang berhasil diproses per satuan waktu.

Contoh ukuran:

```text
records/sec
MB/sec
requests/sec
partitions/sec
transactions/sec
```

Kafka umumnya sangat kuat untuk throughput karena:

1. Write path append-only.
2. Sequential I/O.
3. Batching.
4. Compression.
5. Partition-level parallelism.
6. OS page cache.
7. Pull-based consumer fetch.

### 3.2 Latency

Latency adalah waktu yang dibutuhkan satu event dari titik A ke titik B.

Jenis latency:

```text
produce latency
  waktu dari producer send sampai ack broker

broker append latency
  waktu broker menerima request sampai append selesai

replication latency
  waktu follower mengejar leader

consumer fetch latency
  waktu event tersedia sampai consumer mengambil

processing latency
  waktu aplikasi memproses event

end-to-end latency
  waktu dari event dibuat sampai efek bisnis terlihat
```

### 3.3 Tail Latency

Rata-rata latency sering menipu. Sistem production biasanya rusak di p95, p99, atau p999.

```text
avg latency = 20 ms
p99 latency = 5 seconds
```

Artinya mayoritas event cepat, tetapi sebagian kecil event terlambat parah. Untuk regulatory workflow, payment, notification, SLA escalation, atau fraud detection, tail latency sering lebih penting daripada average.

### 3.4 Trade-off Utama

Optimasi throughput sering dilakukan dengan:

```text
larger batches
more linger
compression
more partitions
larger fetch
more buffering
```

Efeknya:

```text
throughput naik
CPU/network/disk lebih efisien
latency per individual record bisa naik
memory usage naik
failure recovery bisa lebih berat
```

Optimasi latency sering dilakukan dengan:

```text
smaller linger
smaller batch waiting
faster ack path
less buffering
more predictable processing
```

Efeknya:

```text
latency turun
request overhead naik
compression ratio menurun
broker request load naik
cost per record naik
```

Tidak ada konfigurasi “terbaik”. Yang ada adalah konfigurasi yang cocok dengan SLO.

---

## 4. Performance Objective: Jangan Tuning Sebelum Menentukan Target

Sebelum menyentuh konfigurasi, tentukan target.

Contoh target buruk:

```text
Kafka harus cepat.
```

Contoh target lebih baik:

```text
Producer dapat mengirim 50 MB/s dengan p99 produce latency < 200 ms.
Consumer dapat memproses 10.000 records/sec dengan lag time < 30 detik.
End-to-end SLA: event CaseEscalated terlihat di read model dalam p95 < 5 detik dan p99 < 30 detik.
```

Target perlu memisahkan:

1. **Data rate**: berapa MB/sec dan records/sec.
2. **Message size**: rata-rata, p95, p99.
3. **Latency SLO**: average, p95, p99.
4. **Durability**: `acks=all`? `min.insync.replicas`?
5. **Ordering**: key-level ordering wajib atau tidak.
6. **Duplication tolerance**: consumer idempotent atau tidak.
7. **Retention**: berapa lama data disimpan.
8. **Replay requirement**: seberapa sering replay besar dilakukan.
9. **Multi-tenancy**: apakah workload berbagi cluster.
10. **Cost ceiling**: berapa broker, disk, network budget.

---

## 5. Producer Performance

Producer adalah tempat pertama throughput/latency dibentuk.

### 5.1 Producer Accumulator

Kafka producer tidak langsung mengirim setiap record satu per satu. Producer menaruh record ke buffer internal berdasarkan target topic-partition.

```text
send(record)
  -> serialize
  -> determine partition
  -> append to accumulator for that partition
  -> send batch when ready
```

Batch siap dikirim jika:

1. Ukuran batch mencapai `batch.size`.
2. Waktu tunggu mencapai `linger.ms`.
3. Producer flush/close.
4. Backpressure atau internal condition lain.

### 5.2 `batch.size`

`batch.size` adalah batas atas ukuran batch per partition.

Mental model:

```text
small batch.size
  -> request lebih banyak
  -> overhead broker/network lebih tinggi
  -> latency bisa lebih rendah untuk low traffic

large batch.size
  -> request lebih sedikit
  -> compression lebih efektif
  -> throughput lebih baik
  -> memory lebih banyak
  -> record bisa menunggu lebih lama jika traffic rendah
```

Namun `batch.size` bukan berarti producer selalu menunggu sampai batch penuh. `linger.ms` ikut menentukan.

### 5.3 `linger.ms`

`linger.ms` adalah waktu tunggu producer untuk mengumpulkan lebih banyak record sebelum mengirim batch.

Kafka producer modern memiliki default `linger.ms` yang tidak selalu nol pada versi terbaru. Jadi jangan mengandalkan asumsi lama. Selalu cek dokumentasi versi Kafka yang kamu pakai.

Mental model:

```text
linger.ms = 0
  producer cenderung mengirim segera jika sender siap
  latency rendah
  batching kurang efektif

linger.ms = 5-20 ms
  sedikit delay
  batch lebih besar
  throughput dan compression membaik
  p99 latency perlu dipantau

linger.ms sangat besar
  throughput bisa baik
  latency memburuk
  tidak cocok untuk interactive workflow
```

### 5.4 `buffer.memory`

`buffer.memory` adalah total memory producer untuk buffering record sebelum dikirim.

Jika broker lambat atau network bermasalah, buffer bisa penuh. Saat penuh, `send()` dapat block sampai `max.block.ms` atau gagal.

Failure mode:

```text
broker throttling / slow broker
  -> producer batches menumpuk
  -> buffer.memory penuh
  -> send() block
  -> application thread stuck
  -> upstream request latency naik
```

Untuk Java service, ini sangat penting karena producer backpressure bisa menjalar ke HTTP thread, scheduler, batch job, atau workflow executor.

### 5.5 Compression

Kafka mendukung compression di producer. Compression dilakukan per batch, bukan per individual record.

Pilihan umum:

```text
none
 gzip
 snappy
 lz4
 zstd
```

Trade-off:

| Compression | Karakter Umum | Cocok Untuk |
|---|---|---|
| none | CPU rendah, network/disk tinggi | low latency kecil, data kecil, network longgar |
| gzip | rasio tinggi, CPU lebih mahal | bandwidth/storage constrained, latency tidak terlalu ketat |
| snappy | cepat, rasio sedang | balanced, low CPU overhead |
| lz4 | sangat cepat, rasio baik | low latency + throughput |
| zstd | rasio sangat baik, tunable | throughput tinggi, storage/network saving |

Compression membantu jika bottleneck adalah network/disk. Compression merugikan jika bottleneck adalah CPU producer/consumer.

### 5.6 `acks` dan Durability Cost

Producer `acks` mempengaruhi latency dan durability.

```text
acks=0
  producer tidak menunggu broker ack
  latency rendah
  durability lemah
  error visibility rendah

acks=1
  leader ack setelah write lokal
  latency sedang
  risiko data hilang jika leader crash sebelum replication

acks=all
  leader menunggu ISR sesuai min.insync.replicas
  durability lebih kuat
  latency lebih tinggi
```

Untuk production critical event, default engineering stance biasanya:

```properties
acks=all
enable.idempotence=true
```

Tapi ini harus dipasangkan dengan broker/topic config yang benar:

```properties
replication.factor=3
min.insync.replicas=2
```

Jika tidak, `acks=all` bisa memberi rasa aman palsu.

### 5.7 Retry, Idempotence, dan In-flight Request

Retry meningkatkan reliability tetapi bisa menciptakan duplicate tanpa idempotence.

Idempotent producer menjaga agar retry tidak menghasilkan duplicate pada log Kafka untuk producer session yang sama.

Namun performance implication-nya:

1. Ada sequence tracking.
2. Ordering lebih aman.
3. Retry lebih reliable.
4. Error semantics lebih ketat.

Untuk high-throughput producer modern, idempotence biasanya harus dianggap default unless ada alasan kuat untuk mematikan.

### 5.8 Producer Latency Breakdown

Producer latency bisa dipecah:

```text
application enqueue time
serialization time
batch waiting time
compression time
network send time
broker queue time
broker append time
replication wait time
response network time
callback execution time
```

Jika hanya melihat total latency, kamu tidak tahu bagian mana yang lambat.

### 5.9 Producer Metrics Penting

Pantau:

```text
record-send-rate
record-error-rate
record-retry-rate
record-size-avg
batch-size-avg
batch-size-max
records-per-request-avg
request-latency-avg
request-latency-max
produce-throttle-time-avg
buffer-available-bytes
bufferpool-wait-time-total
compression-rate-avg
outgoing-byte-rate
```

Interpretasi:

```text
records-per-request rendah
  batching buruk

bufferpool-wait-time naik
  buffer penuh atau broker lambat

record-retry-rate naik
  broker/network/metadata issue

produce-throttle-time naik
  quota aktif

request-latency naik
  broker/network/acks/replication bottleneck
```

---

## 6. Broker Performance

Broker adalah pusat I/O, replication, metadata, request handling, dan quota enforcement.

### 6.1 Broker Workload

Broker melakukan:

1. Menerima produce request.
2. Append ke leader log.
3. Melayani fetch follower replica.
4. Melayani fetch consumer.
5. Mengelola request queue.
6. Mengelola page cache/disk segment.
7. Mengirim response.
8. Enforce quota.
9. Mengelola metadata dan coordination.

Broker bukan hanya “disk writer”. Broker adalah network + disk + CPU + memory + coordination process.

### 6.2 Broker Threading Mental Model

Kafka broker memiliki thread untuk menerima koneksi/network, memproses request, dan melakukan I/O.

Config yang sering muncul:

```properties
num.network.threads
num.io.threads
queued.max.requests
num.replica.fetchers
```

Jangan tuning thread secara buta. Lihat dulu metrics:

```text
request handler idle percent
network processor idle percent
request queue size
response queue size
request latency by type
```

Jika request handler idle rendah terus-menerus, broker CPU/request processing bisa bottleneck.

Jika network processor idle rendah, network thread bisa bottleneck.

Jika disk await tinggi, storage bottleneck.

### 6.3 Page Cache

Kafka sangat bergantung pada OS page cache.

Mental model:

```text
producer write
  -> append to filesystem cache
  -> OS flush to disk later

consumer read recent data
  -> served from page cache

consumer replay old data
  -> may hit disk heavily
```

Jika workload mostly real-time, consumer membaca data yang baru ditulis dan masih ada di page cache. Ini sangat cepat.

Jika workload replay besar, consumer membaca segment lama yang mungkin tidak ada di page cache. Disk I/O bisa melonjak dan mengganggu workload real-time.

### 6.4 Disk Performance

Disk penting untuk:

1. Append leader log.
2. Follower replication writes.
3. Segment reads untuk replay.
4. Compaction.
5. Retention deletion.
6. State restoration workload.

Metrics/indikator:

```text
disk utilization
disk await
disk read/write throughput
disk queue depth
log flush time
under replicated partitions
request latency
page cache hit/miss indirectly via read patterns
```

Kafka biasanya lebih suka disk yang stabil daripada disk yang hanya cepat burst sesaat.

### 6.5 Network Performance

Network sering menjadi bottleneck sebelum disk.

Network load berasal dari:

```text
producer -> broker leader
broker leader -> follower replicas
consumer -> broker
cross-AZ replication
mirror/cluster linking
connect sinks/sources
replay jobs
```

Replication factor meningkatkan network amplification.

Contoh sederhana:

```text
incoming producer traffic: 100 MB/s
replication.factor=3
leader menerima 100 MB/s
followers total menerima kira-kira 200 MB/s dari leader
consumer group A membaca 100 MB/s
consumer group B membaca 100 MB/s
```

Total broker/network traffic bisa jauh lebih besar daripada input producer.

### 6.6 Replication Cost

Replication memperkuat durability tetapi menambah:

1. Network traffic.
2. Disk writes di follower.
3. Latency untuk `acks=all`.
4. Risiko under-replicated partitions jika broker lambat.

Important relationship:

```text
acks=all + min.insync.replicas=2 + RF=3
  producer ack menunggu cukup replica in-sync
  latency dipengaruhi follower health
```

Jika follower lambat, producer latency bisa naik atau request gagal.

### 6.7 Partition Count dan Broker Load

Partition adalah unit parallelism, tetapi juga unit overhead.

Semakin banyak partition:

```text
lebih banyak file/segment
lebih banyak leader/follower replica
lebih banyak metadata
lebih banyak request/fetch tracking
lebih banyak recovery work
lebih banyak election work
lebih banyak open file handles
lebih banyak memory overhead
```

Terlalu sedikit partition:

```text
parallelism kurang
hot leader
consumer scaling terbatas
throughput per topic terbatas
```

Terlalu banyak partition:

```text
metadata overhead tinggi
rebalance lebih berat
recovery lebih lama
controller/broker pressure
small batch problem
```

---

## 7. Consumer Performance

Consumer performance sering terlihat sebagai lag.

Namun lag bukan diagnosis. Lag adalah symptom.

### 7.1 Consumer Bottleneck Categories

Consumer lambat karena:

1. Fetch terlalu kecil.
2. Processing logic lambat.
3. Downstream database/API lambat.
4. Deserialization mahal.
5. Batch terlalu besar untuk memory.
6. Commit terlalu sering.
7. Rebalance sering.
8. Partition skew.
9. Consumer count tidak sesuai partition count.
10. Poison pill membuat partition stuck.

### 7.2 `max.poll.records`

`max.poll.records` membatasi jumlah record yang dikembalikan dalam satu `poll()`.

Trade-off:

```text
small max.poll.records
  memory lebih terkendali
  per-poll processing lebih pendek
  overhead poll lebih tinggi
  commit lebih sering jika tidak hati-hati

large max.poll.records
  throughput bisa naik
  batch processing efisien
  risiko max.poll.interval.ms terlampaui
  memory naik
  duplicate replay setelah crash bisa lebih besar
```

Rule of thumb:

```text
processing_time_per_poll < max.poll.interval.ms dengan margin besar
```

Jika satu record butuh 500 ms dan `max.poll.records=1000`, worst-case poll batch bisa 500 detik. Itu bisa memicu rebalance jika `max.poll.interval.ms` lebih kecil.

### 7.3 Fetch Configs

Config penting:

```properties
fetch.min.bytes
fetch.max.wait.ms
max.partition.fetch.bytes
fetch.max.bytes
```

Mental model:

```text
fetch.min.bytes besar
  broker menunggu data lebih banyak sebelum response
  throughput lebih baik
  latency bisa naik

fetch.max.wait.ms kecil
  consumer cepat dapat response
  latency turun
  request overhead naik

max.partition.fetch.bytes terlalu kecil
  large record bisa bermasalah atau throughput rendah

fetch.max.bytes terlalu besar
  memory pressure di consumer
```

### 7.4 Commit Cost

Commit offset terlalu sering dapat menambah overhead.

```text
commit setiap record
  duplicate window kecil
  overhead tinggi

commit per batch
  overhead lebih rendah
  duplicate window lebih besar
```

Untuk at-least-once processing, commit dilakukan setelah side effect selesai.

### 7.5 Parallel Processing dalam Consumer

Satu consumer thread tidak boleh sembarang memproses partition secara parallel tanpa menjaga ordering dan commit boundary.

Pattern yang aman:

```text
1 consumer thread polls
records grouped by partition
per-partition worker serial execution
commit only after partition work completed in order
```

Pattern berbahaya:

```text
poll 500 records
submit semua ke thread pool random
commit offset tertinggi setelah beberapa selesai
record offset rendah gagal tapi offset tinggi sudah committed
```

Ini menciptakan data loss pada level aplikasi.

### 7.6 Consumer Lag by Offset vs Lag by Time

Offset lag:

```text
latest broker offset - committed consumer offset
```

Time lag:

```text
now - event timestamp atau log append timestamp dari record terakhir yang diproses
```

Offset lag 10.000 bisa ringan jika record kecil dan processing cepat.

Offset lag 100 bisa berat jika tiap record payload besar atau processing mahal.

Untuk SLO bisnis, lag waktu lebih meaningful.

---

## 8. Partition Count Engineering

Partition count adalah keputusan capacity + ordering + operability.

### 8.1 Partition sebagai Unit Parallelism

Producer bisa menulis parallel ke banyak partition.

Consumer group bisa memproses parallel maksimal sebesar jumlah partition.

```text
topic partitions = 12
consumer instances in same group = 6
roughly 2 partitions per consumer

topic partitions = 12
consumer instances = 20
hanya 12 consumer aktif punya partition
8 consumer idle
```

### 8.2 Partition Count Formula Sederhana

Untuk estimasi awal:

```text
required_partitions_by_produce = target_topic_write_throughput / sustainable_write_per_partition
required_partitions_by_consume = target_topic_read_throughput / sustainable_processing_per_partition
partition_count = max(required_by_produce, required_by_consume, required_consumer_parallelism)
```

Tapi angka sustainable harus diukur dengan workload aktual.

### 8.3 Faktor yang Mempengaruhi Partition Count

1. Target throughput.
2. Message size.
3. Number of consumer groups.
4. Ordering requirement.
5. Key cardinality.
6. Hot key distribution.
7. Retention size.
8. Broker count.
9. Replication factor.
10. Future growth.
11. Rebalance tolerance.
12. Recovery time objective.

### 8.4 Jangan Over-Partition Tanpa Alasan

Over-partitioning menyebabkan:

```text
small batches
more memory overhead
more metadata
more file handles
slower leader election
slower recovery
more complex balancing
more controller pressure
```

### 8.5 Jangan Under-Partition Karena Takut Overhead

Under-partitioning menyebabkan:

```text
consumer scaling ceiling rendah
hot partition
broker leader imbalance
sulit mengejar traffic growth
repartitioning mahal
```

### 8.6 Partition Count dan Ordering

Jika ordering per key penting, partition count harus mempertahankan key affinity.

Menambah partition dapat mengubah mapping key -> partition jika producer memakai default hash modulo partition count.

Akibat:

```text
sebelum tambah partition:
case-123 -> partition 2

setelah tambah partition:
case-123 -> partition 7
```

Event lama ada di partition 2, event baru di partition 7. Ordering historis per key bisa rusak saat consumer membaca dua partition tersebut.

---

## 9. Message Size Engineering

Kafka lebih optimal untuk banyak message kecil/sedang daripada sedikit message sangat besar.

### 9.1 Problem Large Message

Large message menyebabkan:

1. Producer memory pressure.
2. Batch inefficient.
3. Compression CPU spike.
4. Broker request besar.
5. Consumer fetch memory besar.
6. Replication latency naik.
7. Tail latency buruk.
8. Retry mahal.
9. DLQ menjadi berat.

### 9.2 Pattern untuk Payload Besar

Jika payload sangat besar, pertimbangkan:

```text
store payload in object storage
send pointer/reference event to Kafka
include checksum, URI, size, content type, version
```

Contoh event:

```json
{
  "eventId": "evt-001",
  "eventType": "EvidenceUploaded",
  "caseId": "CASE-7788",
  "payloadRef": {
    "storage": "s3",
    "bucket": "case-evidence-prod",
    "key": "cases/CASE-7788/evidence/doc-001.pdf",
    "sha256": "...",
    "sizeBytes": 18392011
  }
}
```

Kafka membawa metadata dan signal. Object storage membawa blob.

### 9.3 Jangan Menggunakan Kafka sebagai File Transfer System

Kafka bisa dikonfigurasi untuk large message, tetapi bukan berarti desainnya tepat.

Jika event payload 50 MB dan consumer group banyak, network amplification sangat besar.

---

## 10. Compression Strategy

Compression bukan sekadar “aktifkan zstd”.

### 10.1 Kapan Compression Membantu

Compression membantu jika:

1. Network bottleneck.
2. Disk usage tinggi.
3. Payload repetitive.
4. Batch cukup besar.
5. CPU masih tersedia.

### 10.2 Kapan Compression Merugikan

Compression merugikan jika:

1. CPU producer sudah bottleneck.
2. CPU consumer sudah bottleneck.
3. Payload sudah compressed, seperti JPEG/PDF/ZIP.
4. Batch terlalu kecil.
5. Latency sangat sensitif.

### 10.3 Compression dan Batch

Compression efektif jika batch berisi cukup banyak record.

```text
small batch + compression
  overhead CPU ada
  rasio tidak optimal

large batch + compression
  rasio lebih baik
  network/disk hemat
```

Jadi compression tuning selalu terkait dengan `batch.size` dan `linger.ms`.

---

## 11. Quotas dan Multi-Tenant Performance

Pada cluster bersama, masalahnya bukan hanya performa maksimum, tetapi fairness.

Kafka mendukung quota untuk membatasi resource client.

Jenis quota umum:

1. Produce byte rate.
2. Consume byte rate.
3. Request percentage / request quota.
4. Controller mutation rate pada beberapa konteks.

### 11.1 Mengapa Quota Penting

Tanpa quota:

```text
satu producer replay/backfill besar
  -> broker network penuh
  -> latency producer lain naik
  -> consumer critical lag
  -> SLO platform rusak
```

Dengan quota:

```text
client heavy workload dithrottle
critical workload tetap punya ruang
```

### 11.2 Quota sebagai Contract

Quota harus diperlakukan sebagai bagian dari platform contract:

```text
team: enforcement-case-service
produce quota: 20 MB/s
consume quota: 40 MB/s
burst policy: allowed for 10 minutes via approval
critical topics: case.lifecycle.events
```

### 11.3 Throttling Metrics

Pantau client metric:

```text
produce-throttle-time-avg
produce-throttle-time-max
fetch-throttle-time-avg
fetch-throttle-time-max
```

Jika throttle time tinggi, jangan langsung tuning producer. Mungkin quota bekerja sesuai desain.

---

## 12. Benchmarking Kafka dengan Benar

Benchmark Kafka mudah dibuat, tetapi sulit dibuat jujur.

### 12.1 Kesalahan Benchmark Umum

1. Menggunakan message size tidak realistis.
2. Tidak memakai schema/serialization nyata.
3. Tidak memakai replication factor production.
4. Menguji `acks=1`, padahal production `acks=all`.
5. Tidak mengaktifkan TLS/SASL seperti production.
6. Consumer hanya discard message, padahal production menulis database.
7. Tidak mengukur p99.
8. Tidak mengukur broker metrics.
9. Mengabaikan warmup.
10. Mengabaikan broker restart/rebalance.
11. Menguji cluster kosong, padahal production multi-tenant.
12. Tidak menguji replay.
13. Tidak menguji poison event.
14. Tidak menguji quota.

### 12.2 Benchmark Harus Menjawab Pertanyaan Spesifik

Contoh:

```text
Berapa producer throughput maksimum untuk topic RF=3, minISR=2, acks=all, zstd, payload p95 4 KB, p99 20 KB, pada 6 broker?

Berapa p99 end-to-end latency untuk CaseEscalated -> projection update saat traffic normal dan saat replay 50 juta event berjalan?

Berapa lama consumer group pulih setelah rolling deploy 20 instances dengan cooperative rebalancing?
```

### 12.3 Benchmark Matrix

Minimal matrix:

| Variable | Values |
|---|---|
| message size | p50, p95, p99 realistic |
| compression | none, lz4, zstd |
| acks | all production config |
| partition count | current, 2x, 4x |
| consumers | 1x, target, overloaded |
| replication factor | production RF |
| security | TLS/SASL same as prod |
| workload | steady, burst, replay |
| downstream | real or realistic mock latency |

### 12.4 Warmup dan Steady State

JVM, page cache, TCP, compression dictionary behavior, and broker cache all need warmup.

Benchmark phases:

```text
cold start
warmup
steady state
burst
failure injection
recovery
cooldown
```

### 12.5 Metrics yang Harus Dikumpulkan

Producer:

```text
send rate
error rate
retry rate
request latency p95/p99
batch size
records per request
compression rate
buffer wait
throttle time
```

Broker:

```text
bytes in/out
request queue
request handler idle
network processor idle
produce/fetch request latency
under replicated partitions
ISR shrink/expand
disk utilization
network utilization
CPU
GC
```

Consumer:

```text
records consumed/sec
bytes consumed/sec
poll latency
processing latency
commit latency
offset lag
time lag
rebalance count
fetch latency
throttle time
```

Application:

```text
business processing latency
downstream DB/API latency
error rate
DLQ rate
idempotency conflict rate
```

---

## 13. Diagnosis Bottleneck: Systematic Method

Jangan tuning random. Gunakan decision tree.

### 13.1 Symptom: Producer Latency Naik

Check:

```text
producer request latency naik?
producer throttle time naik?
producer retries naik?
bufferpool wait naik?
broker produce request latency naik?
under replicated partitions naik?
network saturation?
disk await tinggi?
```

Interpretasi:

```text
throttle time tinggi
  -> quota

retries tinggi
  -> transient broker/network/metadata issue

bufferpool wait tinggi
  -> broker/network lambat atau producer rate terlalu tinggi

broker produce latency tinggi + URP naik
  -> replication/broker issue

producer CPU tinggi
  -> serialization/compression issue
```

### 13.2 Symptom: Consumer Lag Naik

Check:

```text
input producer rate naik?
consumer processing time naik?
consumer fetch rate turun?
consumer rebalance count naik?
partition skew?
downstream latency naik?
consumer error/DLQ naik?
broker fetch latency naik?
quota throttle?
```

Interpretasi:

```text
lag naik tapi consumer CPU rendah
  -> downstream blocking, fetch config, assignment imbalance, quota, or stuck partition

lag naik dan CPU tinggi
  -> processing/deserialization/compression bottleneck

lag hanya pada partition tertentu
  -> hot key / poison pill / partition skew

lag naik setelah deploy
  -> rebalance, config, new code performance regression
```

### 13.3 Symptom: Broker CPU Tinggi

Possible causes:

1. Compression/decompression overhead.
2. Too many small requests.
3. Too many partitions.
4. TLS overhead.
5. High consumer fan-out.
6. Compaction heavy workload.
7. Quota enforcement overhead.
8. Controller/broker metadata activity.

### 13.4 Symptom: Disk Tinggi

Possible causes:

1. Replay old data.
2. Retention huge with cold reads.
3. Compaction heavy topics.
4. Too many consumers reading different offsets.
5. Broker recovery.
6. Tiered storage local cache misses, if used.
7. Large messages.

### 13.5 Symptom: Network Tinggi

Possible causes:

1. Producer traffic high.
2. Replication factor amplification.
3. Many consumer groups.
4. Reprocessing/replay jobs.
5. Cross-AZ traffic.
6. Large messages.
7. Compression disabled or ineffective.

---

## 14. Java Engineer Perspective

### 14.1 Producer Configuration Profiles

#### Low Latency Profile

```properties
acks=all
enable.idempotence=true
compression.type=lz4
linger.ms=0
batch.size=16384
delivery.timeout.ms=120000
request.timeout.ms=30000
max.in.flight.requests.per.connection=5
```

Catatan:

1. Cocok untuk event kecil dan latency-sensitive.
2. Throughput mungkin tidak maksimal.
3. Monitor request rate dan broker overhead.

#### Balanced Profile

```properties
acks=all
enable.idempotence=true
compression.type=zstd
linger.ms=5
batch.size=32768
buffer.memory=67108864
delivery.timeout.ms=120000
request.timeout.ms=30000
```

Catatan:

1. Cocok untuk sebagian besar microservice event.
2. Batching cukup baik tanpa latency terlalu tinggi.
3. Tetap ukur p99.

#### High Throughput Profile

```properties
acks=all
enable.idempotence=true
compression.type=zstd
linger.ms=20
batch.size=131072
buffer.memory=268435456
delivery.timeout.ms=180000
request.timeout.ms=60000
```

Catatan:

1. Cocok untuk telemetry, ingestion, analytics pipeline.
2. Memory lebih besar.
3. Latency individual record naik.
4. Harus dipastikan application thread tidak block berlebihan.

### 14.2 Consumer Configuration Profiles

#### Low Latency Consumer

```properties
enable.auto.commit=false
max.poll.records=100
fetch.min.bytes=1
fetch.max.wait.ms=50
max.partition.fetch.bytes=1048576
max.poll.interval.ms=300000
```

#### High Throughput Consumer

```properties
enable.auto.commit=false
max.poll.records=1000
fetch.min.bytes=65536
fetch.max.wait.ms=500
max.partition.fetch.bytes=4194304
fetch.max.bytes=52428800
max.poll.interval.ms=900000
```

### 14.3 Measure Processing Time Explicitly

Java consumer harus mengukur processing time sendiri.

```java
long startNanos = System.nanoTime();
try {
    process(record);
} finally {
    long elapsedMicros = (System.nanoTime() - startNanos) / 1_000;
    processingLatencyTimer.record(elapsedMicros, TimeUnit.MICROSECONDS);
}
```

Jangan hanya mengandalkan Kafka client metrics. Kafka client tahu fetch/commit, tetapi tidak selalu tahu business processing bottleneck.

### 14.4 Avoid Blocking Kafka Callback

Producer callback jangan melakukan pekerjaan berat.

Buruk:

```java
producer.send(record, (metadata, exception) -> {
    if (exception == null) {
        auditRepository.save(...); // blocking DB call in callback
    }
});
```

Lebih baik:

```java
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        errorCounter.increment();
        log.warn("Kafka send failed", exception);
        return;
    }
    sentCounter.increment();
});
```

Callback berjalan di thread producer network/client context. Blocking callback dapat merusak throughput producer.

### 14.5 Backpressure ke Application Layer

Jika producer buffer penuh, service harus punya strategi:

1. Return 503/429 untuk request baru.
2. Queue internal bounded.
3. Circuit breaker.
4. Shed non-critical load.
5. Persist outbox lalu publish async.
6. Alarm sebelum total failure.

Jangan membuat unbounded queue di Java service untuk “menyerap Kafka lambat”. Itu hanya memindahkan outage ke heap memory.

---

## 15. Production Failure Modes

### 15.1 Tuning untuk Throughput Menghancurkan Latency

```text
linger.ms dinaikkan ke 100 ms
batch.size sangat besar
fetch.min.bytes besar
```

Throughput benchmark terlihat baik, tetapi user-facing SLA rusak.

### 15.2 Tuning untuk Latency Menghancurkan Broker

```text
linger.ms=0
batch kecil
banyak producer
record kecil
```

Broker menerima terlalu banyak request kecil. CPU/request overhead naik.

### 15.3 Partition Skew

```text
90% event memakai key tenant-super-large
semua masuk partition 4
consumer lain idle
lag partition 4 meledak
```

Solusi bisa berupa key redesign, sharding key, tenant isolation, atau dedicated topic.

### 15.4 Replay Mengganggu Traffic Real-Time

Backfill/replay consumer membaca data lama dalam jumlah besar.

Efek:

1. Disk read tinggi.
2. Page cache terganggu.
3. Broker fetch latency naik.
4. Consumer critical lag naik.

Solusi:

1. Quota untuk replay client.
2. Dedicated replay cluster/topic mirror.
3. Schedule replay di low traffic window.
4. Rate limit consumer.
5. Tiered architecture.

### 15.5 DLQ Menjadi Bottleneck Baru

Saat bad event spike:

```text
main consumer gagal banyak
semua record dikirim ke DLQ
DLQ producer overload
broker additional write load
alert storm
```

DLQ harus punya capacity planning juga.

### 15.6 Downstream Database Menghambat Consumer

Kafka cepat, database lambat.

```text
consumer poll cepat
processing melakukan insert/update DB
DB connection pool penuh
processing time naik
max.poll.interval.ms terlampaui
rebalance
duplicate processing
DB makin berat
```

Solusi:

1. Bounded concurrency.
2. Batch write dengan idempotency.
3. Separate projection table optimized.
4. Pause/resume partition.
5. Increase `max.poll.interval.ms` with reasoning.
6. Rate limit consumer.

---

## 16. Design Trade-Offs

### 16.1 More Partitions vs More Operational Overhead

More partitions:

```text
+ more parallelism
+ more throughput potential
+ more consumer scaling room
- more metadata
- more file handles
- more rebalance/recovery cost
- smaller batches if traffic sparse
```

### 16.2 Compression vs CPU

Compression:

```text
+ lower network
+ lower disk
+ better throughput if network-bound
- producer CPU
- consumer CPU
- possible latency increase
```

### 16.3 Larger Batches vs Tail Latency

Larger batches:

```text
+ throughput
+ compression
+ fewer requests
- waiting time
- memory usage
- bigger duplicate window
- bigger retry cost
```

### 16.4 More Consumers vs More Rebalance/Downstream Load

More consumers:

```text
+ parallel processing up to partition count
+ lower lag if processing-bound
- more DB/API pressure
- more rebalance complexity
- idle consumers if > partitions
```

### 16.5 Quota vs User Experience

Quota:

```text
+ protects cluster
+ isolates tenants
+ prevents noisy neighbor
- client sees throttling
- backfill takes longer
- requires governance
```

---

## 17. Anti-Patterns

### 17.1 “Consumer Lag Naik, Tambah Partition”

Lag bisa karena downstream DB lambat. Menambah partition tidak mempercepat DB. Bahkan bisa memperparah karena lebih banyak concurrent writes.

### 17.2 “Kafka Lambat, Naikkan Broker”

Jika bottleneck adalah serialization CPU di producer, broker tambahan tidak membantu.

### 17.3 “Set Everything Huge”

```properties
batch.size=10MB
linger.ms=1000
fetch.max.bytes=500MB
max.poll.records=100000
```

Ini biasanya menciptakan memory pressure, latency buruk, dan failure recovery berat.

### 17.4 “Benchmark Tanpa Security”

Production memakai TLS/SASL, benchmark tidak. Hasil benchmark terlalu optimistis.

### 17.5 “Unlimited Replay”

Replay/backfill tanpa quota/rate limit bisa mengganggu traffic real-time.

### 17.6 “Large Payload Langsung ke Kafka”

Kafka dipakai sebagai file bus untuk PDF/image besar. Akhirnya semua consumer membayar biaya payload yang belum tentu mereka butuhkan.

### 17.7 “Commit Offset Sebelum Side Effect”

Performance terlihat cepat karena commit dilakukan awal. Tapi saat crash, data hilang secara aplikasi.

### 17.8 “Thread Pool Random di Consumer”

Parallelism tanpa per-partition ordering dan commit discipline menciptakan data loss, duplicate chaos, dan nondeterministic bug.

---

## 18. Performance Checklist

### 18.1 Producer Checklist

```text
[ ] Target throughput dan latency jelas.
[ ] acks sesuai durability requirement.
[ ] enable.idempotence dipakai untuk critical events.
[ ] batch.size dan linger.ms diuji dengan payload nyata.
[ ] compression diuji terhadap CPU/network/disk.
[ ] buffer.memory cukup dan dipantau.
[ ] callback tidak blocking.
[ ] retry/error metrics dipantau.
[ ] quota/throttle metrics dipantau.
[ ] producer backpressure strategy jelas.
```

### 18.2 Topic/Partition Checklist

```text
[ ] Partition count dihitung dari throughput + consumer parallelism.
[ ] Ordering domain jelas.
[ ] Key cardinality cukup.
[ ] Hot key analysis dilakukan.
[ ] Retention size dihitung.
[ ] Replication factor sesuai durability.
[ ] min.insync.replicas sesuai acks.
[ ] Growth plan jelas.
[ ] Repartitioning risk dipahami.
```

### 18.3 Broker Checklist

```text
[ ] Broker CPU baseline diketahui.
[ ] Disk utilization dan await dipantau.
[ ] Network headroom cukup.
[ ] Request handler idle dipantau.
[ ] Network processor idle dipantau.
[ ] Under replicated partition alert aktif.
[ ] Offline partition alert aktif.
[ ] ISR shrink/expand dipantau.
[ ] Quota policy tersedia.
[ ] Replay/backfill policy tersedia.
```

### 18.4 Consumer Checklist

```text
[ ] max.poll.records sesuai processing time.
[ ] max.poll.interval.ms punya margin.
[ ] fetch configs diuji.
[ ] Manual commit dilakukan setelah processing.
[ ] Processing latency dipantau.
[ ] Downstream latency dipantau.
[ ] Poison pill strategy tersedia.
[ ] DLQ capacity dipikirkan.
[ ] Rebalance count dipantau.
[ ] Lag by time dipantau, bukan hanya offset lag.
```

### 18.5 Benchmark Checklist

```text
[ ] Payload realistis.
[ ] Schema/serialization production digunakan.
[ ] TLS/SASL production digunakan jika relevan.
[ ] RF/minISR/acks production digunakan.
[ ] p95/p99/p999 diukur.
[ ] Broker, producer, consumer metrics dikumpulkan.
[ ] Warmup dilakukan.
[ ] Replay scenario diuji.
[ ] Failure/restart/rebalance diuji.
[ ] Downstream dependency direpresentasikan realistis.
```

---

## 19. Latihan / Thought Exercises

### Latihan 1 — Diagnose Producer Latency

Sebuah service Java mengalami p99 Kafka send latency naik dari 80 ms ke 2 detik. Metrics:

```text
producer retry rate: normal
producer throttle time: high
broker CPU: normal
broker disk: normal
```

Pertanyaan:

1. Apa hipotesis utama?
2. Apakah menambah broker akan membantu?
3. Apa action yang benar?

Hint:

```text
Throttle time tinggi biasanya mengarah ke quota.
```

### Latihan 2 — Consumer Lag Naik Setelah Deploy

Setelah deploy versi baru, consumer lag naik. Metrics:

```text
rebalance count: naik drastis
max.poll.interval exceeded: muncul di log
processing latency p99: naik dari 100 ms ke 8 detik
```

Pertanyaan:

1. Apa penyebab paling mungkin?
2. Config apa yang mungkin perlu ditinjau?
3. Apakah solusi terbaik langsung menambah consumer?

### Latihan 3 — Partition Count

Topic `case.lifecycle.events` memiliki:

```text
target input: 30 MB/s
estimated sustainable per partition produce: 3 MB/s
consumer processing capacity per partition: 1.5 MB/s
ordering required per caseId
expected consumer group count: 4
```

Pertanyaan:

1. Berapa partition minimal dari sisi produce?
2. Berapa partition minimal dari sisi consume?
3. Apa risiko jika partition count dinaikkan nanti?

### Latihan 4 — Large Payload

Tim ingin mengirim evidence PDF 20 MB langsung sebagai Kafka event.

Pertanyaan:

1. Apa masalah performance-nya?
2. Apa desain alternatif?
3. Metadata apa yang harus tetap dikirim di Kafka?

### Latihan 5 — Replay Policy

Tim analytics ingin replay 2 tahun data dari topic production pada jam kerja.

Pertanyaan:

1. Risiko terhadap workload real-time apa?
2. Metrics apa yang perlu dipantau?
3. Guardrail apa yang harus diberlakukan?

---

## 20. Ringkasan

Kafka performance bukan satu knob. Kafka performance adalah sistem trade-off.

Prinsip utama:

1. Tentukan objective sebelum tuning.
2. Throughput dan latency sering berlawanan.
3. Batching meningkatkan throughput, tetapi dapat menambah latency.
4. Compression menghemat network/disk, tetapi memakai CPU.
5. Partition menambah parallelism, tetapi juga overhead.
6. Consumer lag adalah symptom, bukan diagnosis.
7. Large message memperburuk banyak aspek Kafka sekaligus.
8. Quota penting untuk multi-tenant stability.
9. Benchmark harus realistis terhadap production semantics.
10. Diagnosis harus berbasis metrics, bukan tebakan.

Mental model akhir:

```text
Kafka performance =
  producer batching/compression/acks
  + broker request/network/disk/replication capacity
  + partition distribution
  + consumer fetch/processing/commit discipline
  + downstream dependency capacity
  + governance controls such as quota and replay policy
```

Top 1% Kafka engineer bukan hanya tahu config. Mereka tahu:

```text
which bottleneck exists,
why it exists,
what trade-off a tuning change creates,
and how to prove improvement with measurement.
```

---

## 21. Referensi

Referensi berikut digunakan sebagai dasar konsep dan istilah:

1. Apache Kafka Documentation — Producer Configs: https://kafka.apache.org/41/configuration/producer-configs/
2. Apache Kafka Documentation — Consumer Configs: https://kafka.apache.org/41/configuration/consumer-configs/
3. Apache Kafka Documentation — Monitoring: https://kafka.apache.org/41/operations/monitoring/
4. Apache Kafka Documentation — Design: https://kafka.apache.org/42/design/design/
5. Confluent Documentation — Producer Configuration Reference: https://docs.confluent.io/platform/current/installation/configuration/producer-configs.html
6. Confluent Documentation — Kafka Quotas: https://docs.confluent.io/kafka/design/quotas.html
7. Confluent Documentation — Optimize Clients for Throughput: https://docs.confluent.io/cloud/current/client-apps/optimizing/throughput.html
8. Confluent Blog — Configure Kafka to Minimize Latency: https://www.confluent.io/blog/configure-kafka-to-minimize-latency/
9. Red Hat Streams for Apache Kafka — Producer Configuration Tuning: https://docs.redhat.com/en/documentation/red_hat_streams_for_apache_kafka/

---

## 22. Status Seri

```text
Progress saat ini:
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 selesai
Part 006 selesai
Part 007 selesai
Part 008 selesai
Part 009 selesai
Part 010 selesai
Part 011 selesai
Part 012 selesai
Part 013 selesai
Part 014 selesai
Part 015 selesai
Part 016 selesai
Part 017 selesai
Part 018 selesai
Part 019 selesai
Part 020 selesai
Part 021 selesai
Part 022 selesai
Part 023 selesai
Part 024 selesai
Part 025 selesai

Seri belum selesai.
Part berikutnya: Part 026 — Failure Modelling: Data Loss, Duplication, Reordering, Lag Explosion, and Split Brain Thinking
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Observability: Lag, Throughput, Latency, JMX, Metrics, Tracing, and Alerting</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-026.md">Part 026 — Failure Modelling: Data Loss, Duplication, Reordering, Lag Explosion, and Split Brain Thinking ➡️</a>
</div>

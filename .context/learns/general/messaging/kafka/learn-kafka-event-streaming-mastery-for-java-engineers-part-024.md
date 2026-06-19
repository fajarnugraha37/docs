# learn-kafka-event-streaming-mastery-for-java-engineers-part-024.md

# Part 024 — Observability: Lag, Throughput, Latency, JMX, Metrics, Tracing, and Alerting

> Seri: Kafka, Kafka ksqlDB, Kafka Connect, Kafka Streams, dan Event Streaming Mastery untuk Java Software Engineer  
> Bagian: 024 dari 034  
> Status seri: belum selesai  
> Fokus: observability Kafka production systems, bukan sekadar dashboard metrik

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **monitoring**, **observability**, **alerting**, **debugging**, dan **incident response** dalam konteks Kafka.
2. Membaca Kafka bukan sebagai satu proses, tetapi sebagai sistem terdistribusi berlapis: broker, controller, producer, consumer, topic, partition, storage, network, schema, connector, stream processor, dan downstream side effect.
3. Menjelaskan mengapa **consumer lag** penting tetapi tidak cukup.
4. Membedakan **offset lag**, **time lag**, **processing latency**, **produce latency**, **end-to-end latency**, dan **freshness**.
5. Menentukan metrik broker yang benar-benar kritikal: offline partition, under-replicated partition, ISR shrink, request latency, disk usage, network saturation, controller health, dan rebalance symptom.
6. Menentukan metrik producer yang penting: send rate, error rate, retry rate, request latency, batch size, compression rate, buffer exhaustion, throttle time, dan record queue time.
7. Menentukan metrik consumer yang penting: records consumed rate, commit latency, poll cadence, processing time, fetch latency, lag, rebalance rate, assignment stability, dan error rate.
8. Mendesain alert yang actionable, bukan noise.
9. Mendesain dashboard yang mengikuti pertanyaan operasional, bukan mengikuti daftar MBean mentah.
10. Menghubungkan observability dengan failure modelling dari part sebelumnya: data loss risk, duplication, reordering, lag explosion, poison pill, schema breakage, DLQ overflow, dan downstream outage.
11. Mendesain observability untuk Kafka Connect, ksqlDB, Kafka Streams, dan Spring Kafka.
12. Membuat runbook incident untuk gejala umum: lag naik, producer timeout, broker disk penuh, under replicated partitions, rebalance storm, DLQ spike, consumer stuck, dan latency end-to-end memburuk.

---

## 2. Mental Model Utama

Kafka observability bukan pertanyaan:

> “Metric Kafka apa saja yang perlu dipantau?”

Pertanyaan yang lebih benar:

> “Invariant produksi apa yang harus tetap benar, sinyal apa yang membuktikan invariant itu masih benar, dan sinyal apa yang menunjukkan invariant sedang pecah?”

Kafka adalah sistem yang memindahkan event dari producer ke log terdistribusi lalu ke consumer/downstream. Observability harus menjawab empat pertanyaan besar:

1. **Apakah data masih bisa ditulis dengan aman?**  
   Fokus: producer error, broker availability, ISR, min ISR, disk, request latency.

2. **Apakah data masih durable dan replicated?**  
   Fokus: under-replicated partitions, offline partitions, ISR shrink/expand, high watermark movement, disk health.

3. **Apakah data masih bisa dibaca dan diproses tepat waktu?**  
   Fokus: consumer lag, processing latency, commit health, rebalance, downstream saturation.

4. **Apakah hasil bisnis masih benar?**  
   Fokus: duplicate handling, DLQ, schema compatibility, idempotency, reconciliation, audit gap, event freshness, projection correctness.

Metrik Kafka mentah hanya berguna bila bisa dipetakan ke pertanyaan tersebut.

---

## 3. Monitoring vs Observability vs Alerting

### 3.1 Monitoring

Monitoring adalah pengumpulan dan visualisasi sinyal sistem.

Contoh:

- `UnderReplicatedPartitions`
- `OfflinePartitionsCount`
- `BytesInPerSec`
- `BytesOutPerSec`
- consumer group lag
- producer request latency
- disk usage broker
- JVM heap usage
- GC pause

Monitoring menjawab:

> “Apa yang sedang terjadi menurut metrik yang sudah kita definisikan?”

### 3.2 Observability

Observability adalah kemampuan memahami internal state sistem dari external signals.

External signals utama:

1. Metrics
2. Logs
3. Traces
4. Events/audit records
5. Health checks
6. Synthetic probes
7. Reconciliation reports

Observability menjawab:

> “Mengapa sistem berperilaku seperti ini?”

Dalam Kafka, observability yang baik memungkinkan kamu membedakan:

- lag karena consumer lambat,
- lag karena downstream database lambat,
- lag karena rebalance storm,
- lag karena hot partition,
- lag karena poison pill,
- lag karena producer spike,
- lag karena broker fetch latency,
- lag karena quota throttling,
- lag karena consumer diam tetapi masih dianggap alive,
- lag karena offset commit tidak bergerak meski processing berjalan.

### 3.3 Alerting

Alerting adalah mekanisme memberi tahu manusia atau automation ketika action diperlukan.

Alert yang buruk:

> “Consumer lag > 10.000.”

Alert yang lebih baik:

> “Consumer lag pada group `case-projection-v2` meningkat selama 15 menit, lag time > 10 menit, records consumed rate lebih rendah dari produce rate, dan tidak ada rebalance aktif. Kemungkinan consumer/downstream bottleneck.”

Alert harus actionable:

- siapa owner-nya?
- impact-nya apa?
- apa langkah diagnosis pertama?
- kapan harus escalate?
- apa mitigation aman?
- apa yang tidak boleh dilakukan?

---

## 4. Kafka Observability Stack: Layered View

Jangan mulai dari tools. Mulai dari layer.

```text
Business invariant
  ↓
Application semantics
  ↓
Consumer processing
  ↓
Kafka client runtime
  ↓
Topic / partition / offset
  ↓
Broker request path
  ↓
Replication / ISR / controller
  ↓
Disk / network / JVM / OS
  ↓
Infrastructure / cloud / Kubernetes / VM
```

Jika dashboard hanya menampilkan broker CPU, bytes in, bytes out, dan consumer lag, kamu hanya melihat sebagian sistem.

---

## 5. The Four Golden Signals for Kafka

Site Reliability Engineering sering memakai empat golden signals:

1. Latency
2. Traffic
3. Errors
4. Saturation

Untuk Kafka, bentuknya perlu diterjemahkan.

### 5.1 Latency

Kafka latency bukan satu angka.

Jenis latency:

| Jenis | Arti |
|---|---|
| Produce latency | waktu producer mengirim batch sampai broker ack |
| Broker request latency | waktu broker menangani request produce/fetch/metadata |
| Replication latency | waktu follower mengejar leader |
| Fetch latency | waktu consumer mendapatkan data dari broker |
| Processing latency | waktu aplikasi memproses record |
| Commit latency | waktu commit offset selesai |
| End-to-end latency | waktu dari event terjadi sampai efek downstream selesai |
| Freshness lag | seberapa basi projection/read model dibanding source event |

Kesalahan umum: memakai consumer lag offset sebagai proxy tunggal untuk latency. Offset lag tidak selalu setara dengan time lag.

### 5.2 Traffic

Traffic Kafka meliputi:

- records per second
- bytes per second
- requests per second
- produce requests
- fetch requests
- replication traffic
- consumer group offset commits
- DLQ records
- schema registry calls
- Kafka Connect task throughput
- Kafka Streams processed records

### 5.3 Errors

Errors Kafka perlu diklasifikasikan:

- producer send errors
- retriable errors
- non-retriable errors
- serialization errors
- authorization errors
- timeout errors
- commit failures
- rebalance-related failures
- schema compatibility failures
- connector task failures
- downstream sink failures
- DLQ publishes

### 5.4 Saturation

Saturation adalah tanda resource mendekati batas:

- disk usage
- disk I/O wait
- network bandwidth
- broker request handler saturation
- producer buffer exhaustion
- consumer processing thread saturation
- downstream connection pool saturation
- Kafka Streams state store disk pressure
- Connect worker/task saturation
- controller event queue buildup

Saturation sering muncul sebelum error. Observability yang baik mendeteksi saturation sebelum user melihat impact.

---

## 6. Metrics Source: Dari Mana Data Observability Diambil?

Kafka metrics biasanya berasal dari:

1. **JMX/MBeans** dari broker, controller, producer, consumer, Kafka Streams, Connect.
2. **Client metrics** dari Java application.
3. **Consumer group offset data** dari Kafka Admin API atau tool seperti `kafka-consumer-groups`.
4. **Application metrics** dari business processing.
5. **Logs** dari broker dan aplikasi.
6. **Distributed traces** dari producer hingga consumer/downstream.
7. **Infrastructure metrics** dari node/container/cloud.
8. **Synthetic probes** yang menghasilkan dan mengonsumsi event uji.
9. **DLQ dan audit topics** sebagai sinyal kualitas data.

Apache Kafka exposes monitoring through JMX, and remote JMX must be explicitly enabled and secured in production. Confluent documentation also emphasizes Kafka/Confluent component metrics via JMX and MBeans for brokers, controllers, producers, and consumers.

---

## 7. Consumer Lag: Penting, Tapi Sering Disalahpahami

### 7.1 Apa itu offset lag?

Offset lag biasanya dihitung sebagai:

```text
log_end_offset - committed_offset
```

Artinya:

> Berapa banyak record yang sudah ada di partition tetapi belum di-commit oleh consumer group.

Contoh:

```text
topic: case-events
partition: 0
log_end_offset: 1,000,000
committed_offset: 990,000
lag: 10,000
```

Consumer group tertinggal 10.000 record pada partition itu.

### 7.2 Offset lag bukan selalu business delay

Offset lag 10.000 bisa berarti:

- delay 5 detik jika throughput 2.000 rps,
- delay 3 jam jika throughput 1 rps tetapi ada burst historis,
- tidak urgent jika topic batch analytics,
- sangat urgent jika topic fraud/enforcement alert.

Karena itu perlu **lag by time** atau **event freshness**.

### 7.3 Time lag

Time lag dapat dihitung dari timestamp record terakhir yang sudah diproses:

```text
now - max(event_time_processed)
```

Atau ingestion time:

```text
now - max(kafka_record_timestamp_processed)
```

Tergantung kebutuhan.

### 7.4 Offset lag vs time lag

| Kondisi | Offset lag | Time lag | Interpretasi |
|---|---:|---:|---|
| high throughput topic | besar | kecil | mungkin sehat |
| low throughput topic | kecil | besar | mungkin ada event lama tertahan |
| consumer paused | naik | naik | bottleneck nyata |
| replay/backfill | besar | tidak selalu buruk | tergantung mode operasi |
| compacted topic | bisa membingungkan | perlu hati-hati | offset bukan jumlah state final |

### 7.5 Lag harus dibaca per partition

Total consumer group lag bisa menipu.

Contoh:

```text
partition 0: lag 900,000
partition 1: lag 0
partition 2: lag 0
partition 3: lag 0
```

Total lag 900.000. Masalahnya bukan seluruh group lambat, tetapi **hot partition** atau stuck partition.

### 7.6 Lag tanpa throughput context tidak cukup

Selalu lihat:

```text
lag trend
produce rate
consume rate
processing rate
error rate
rebalance rate
DLQ rate
downstream latency
```

Jika lag naik karena produce rate tiba-tiba 10x tetapi consume rate normal, masalahnya capacity.  
Jika lag naik karena consume rate turun, masalahnya consumer/downstream.  
Jika lag naik hanya di satu partition, masalahnya key skew/poison pill/hot entity.

---

## 8. Broker Metrics: Sinyal Kesehatan Cluster

Broker metrics harus menjawab:

1. Apakah semua partition punya leader?
2. Apakah replicas in-sync?
3. Apakah broker mampu menerima produce/fetch request?
4. Apakah disk aman?
5. Apakah controller sehat?
6. Apakah ada broker overload?

### 8.1 Offline partitions

Offline partition berarti partition tidak punya leader yang available.

Impact:

- producer tidak bisa menulis partition tersebut,
- consumer tidak bisa membaca partition tersebut,
- availability terganggu,
- ini umumnya page-level severity untuk production topic penting.

Alert:

```text
OfflinePartitionsCount > 0
```

Severity tergantung topic, tapi secara umum sangat serius.

### 8.2 Under-replicated partitions

Under-replicated partition berarti replica tidak lengkap/in-sync sesuai replication factor.

Contoh:

```text
replication factor = 3
ISR = [broker-1, broker-2]
expected replicas = [broker-1, broker-2, broker-3]
```

Partition masih available, tetapi redundancy berkurang.

Impact:

- data loss risk meningkat jika broker tambahan gagal,
- producer dengan `acks=all` dan `min.insync.replicas` tertentu bisa mulai gagal,
- replication lag mungkin sedang memburuk.

Alert:

```text
UnderReplicatedPartitions > 0 for sustained period
```

Jangan langsung panik untuk spike beberapa detik saat rolling restart. Panik jika sustained, melebar, atau terjadi tanpa maintenance.

### 8.3 Under-min-ISR partitions

Ini lebih serius dari under-replicated biasa.

Jika ISR turun di bawah `min.insync.replicas`, producer dengan `acks=all` tidak bisa menulis dengan durability guarantee yang diminta.

Impact:

- write availability bisa turun,
- producer error meningkat,
- sistem yang benar mungkin sengaja gagal menulis daripada menerima durability risk.

### 8.4 ISR shrink/expand rate

ISR sering shrink/expand menandakan instability.

Penyebab:

- broker lambat,
- disk I/O buruk,
- network issue,
- GC pause,
- overload,
- broker restart,
- follower replication tertinggal.

Jika ISR flapping, cluster mungkin terlihat “available” tetapi durability sedang tidak stabil.

### 8.5 Request latency

Broker menangani banyak jenis request:

- Produce
- FetchConsumer
- FetchFollower
- Metadata
- OffsetCommit
- FindCoordinator
- JoinGroup/SyncGroup/Heartbeat

Metrik latency perlu dilihat per request type.

Contoh interpretasi:

| Request latency naik | Kemungkinan |
|---|---|
| Produce | disk/network/broker overloaded |
| FetchConsumer | broker read path lambat, consumer fetch pressure |
| FetchFollower | replication terganggu |
| Metadata | controller/broker metadata issue |
| OffsetCommit | group coordinator overload |
| JoinGroup/SyncGroup | rebalance pressure |

### 8.6 Request handler idle

Jika request handler idle turun mendekati nol, broker threads sibuk terus.

Impact:

- request latency naik,
- timeout client meningkat,
- metadata/fetch/produce semua bisa terdampak.

### 8.7 Network processor idle

Jika network processor saturated:

- broker kesulitan menerima/mengirim request,
- bytes in/out mungkin mendekati limit,
- client melihat latency/timeout.

### 8.8 Disk usage

Kafka adalah storage system. Disk penuh adalah incident besar.

Pantau:

- disk used percent,
- free bytes,
- log dir availability,
- per-topic/per-partition size,
- retention headroom,
- disk I/O wait,
- disk read/write throughput,
- disk latency.

Disk penuh dapat menyebabkan:

- broker crash atau log dir failure,
- produce failure,
- replica falling out of ISR,
- retention tidak cukup cepat membersihkan data,
- cascading rebalance/replication issue.

### 8.9 Page cache dan OS metrics

Kafka sangat bergantung pada OS page cache.

Pantau:

- memory available,
- page cache pressure,
- swap usage,
- major page faults,
- disk read amplification.

Swap pada broker Kafka umumnya buruk karena bisa menyebabkan latency spike ekstrem.

### 8.10 JVM metrics

Pantau:

- heap usage,
- GC pause time,
- GC frequency,
- direct memory,
- thread count,
- file descriptors.

GC pause panjang bisa menyebabkan broker tertinggal, controller instability, atau client timeout.

---

## 9. Controller and KRaft Observability

Kafka modern menggunakan KRaft metadata quorum. Observability control plane penting karena controller mengelola metadata cluster.

Sinyal penting:

1. Active controller count harus stabil.
2. Controller election tidak boleh sering terjadi.
3. Metadata propagation harus sehat.
4. Broker registration tidak flapping.
5. Partition leader election tidak abnormal.
6. Controller event processing tidak backlog panjang.
7. Quorum voters sehat.

Gejala control plane bermasalah:

- metadata request latency naik,
- topic creation/deletion lambat,
- leader election lambat,
- broker sering dianggap offline/online,
- client sering refresh metadata,
- deployment terasa “random unstable”.

Control plane failure berbeda dari data plane failure. Broker bisa masih melayani produce/fetch tertentu, tetapi metadata operations terganggu.

---

## 10. Producer Metrics

Producer metrics menjawab:

1. Apakah producer berhasil menulis?
2. Apakah producer mulai retry?
3. Apakah producer dibatasi broker/quota?
4. Apakah batching bekerja?
5. Apakah buffer penuh?
6. Apakah latency user meningkat?

### 10.1 Record send rate

Jumlah record per detik yang dikirim.

Gunakan untuk:

- baseline traffic,
- detect spike,
- capacity planning,
- compare dengan broker bytes in.

### 10.2 Byte rate

Bytes per second lebih penting daripada record count untuk resource.

Record kecil vs besar punya dampak berbeda:

```text
1,000 records/s × 1 KB = 1 MB/s
1,000 records/s × 1 MB = 1 GB/s
```

### 10.3 Request latency

Producer request latency meliputi waktu request ke broker sampai response.

Jika naik:

- broker lambat,
- network lambat,
- `acks=all` menunggu replication,
- ISR bermasalah,
- broker throttling,
- batch terlalu besar,
- request queue menumpuk.

### 10.4 Record queue time

Waktu record menunggu di buffer producer sebelum dikirim.

Jika queue time tinggi:

- batching terlalu agresif,
- broker/network lambat,
- producer buffer pressure,
- send thread tidak mampu mengejar.

### 10.5 Batch size

Batch size terlalu kecil:

- throughput buruk,
- overhead request tinggi,
- compression kurang efektif.

Batch size terlalu besar:

- latency naik,
- memory pressure,
- large request risk.

### 10.6 Compression rate

Compression ratio membantu melihat apakah compression efektif.

Trade-off:

- compression menurunkan network/disk usage,
- compression menambah CPU producer/broker/consumer.

### 10.7 Retry rate

Retry rate adalah sinyal awal instability.

Retry bisa terjadi karena:

- leader election,
- network issue,
- broker overload,
- timeout,
- metadata stale,
- quota throttling,
- not enough replicas.

Retry rate kecil saat rolling deploy mungkin normal. Retry rate sustained pada path bisnis penting adalah warning.

### 10.8 Error rate

Pisahkan error:

| Error | Makna |
|---|---|
| Serialization error | bug/schema issue sebelum dikirim |
| TimeoutException | broker/network/queue/acks issue |
| AuthorizationException | ACL/security issue |
| RecordTooLargeException | payload/topic/broker limit issue |
| OutOfOrderSequenceException | idempotence/ordering issue |
| ProducerFencedException | transactional producer conflict |
| NotEnoughReplicas | ISR/min ISR durability issue |

### 10.9 Buffer available bytes

Jika producer buffer habis:

- `send()` bisa block,
- aplikasi latency naik,
- timeout meningkat,
- memory pressure meningkat.

### 10.10 Throttle time

Jika broker quota aktif, producer bisa ditahan.

Throttle bukan bug; itu policy. Tetapi aplikasi harus tahu bahwa throughput sedang dibatasi.

---

## 11. Consumer Metrics

Consumer metrics menjawab:

1. Apakah consumer mengambil data?
2. Apakah consumer memproses data?
3. Apakah offset commit sehat?
4. Apakah consumer group stabil?
5. Apakah downstream menjadi bottleneck?
6. Apakah consumer stuck pada record tertentu?

### 11.1 Records consumed rate

Jumlah record yang diterima consumer dari Kafka per detik.

Jangan samakan dengan record selesai diproses. Consumer bisa fetch record tetapi processing gagal.

### 11.2 Processing rate

Ini metrik aplikasi, bukan Kafka client default.

Tambahkan metrik:

```text
records_processed_total
records_processed_success_total
records_processed_failure_total
record_processing_duration_seconds
```

### 11.3 Poll interval

Pantau jarak antar `poll()`.

Jika processing terlalu lama dan `poll()` tidak dipanggil, consumer bisa melewati `max.poll.interval.ms` dan dikeluarkan dari group.

### 11.4 Commit latency

Commit offset lambat bisa menunjukkan:

- group coordinator issue,
- network issue,
- broker overload,
- too frequent commit,
- rebalance conflict.

### 11.5 Commit rate

Commit terlalu sering:

- overhead tinggi,
- coordinator pressure.

Commit terlalu jarang:

- duplicate replay lebih besar saat crash.

### 11.6 Rebalance metrics

Rebalance adalah sinyal ownership instability.

Pantau:

- rebalance count,
- rebalance duration,
- partition assigned/revoked events,
- consumer generation changes,
- member join/leave frequency.

Jika rebalance sering:

- deployment terlalu agresif,
- consumer processing melewati max poll interval,
- heartbeat/session config buruk,
- network/GC pause,
- dynamic membership tanpa static membership,
- autoscaling flapping.

### 11.7 Fetch latency

Fetch latency naik bisa berasal dari:

- broker lambat,
- network lambat,
- fetch min/wait config,
- consumer thread blocked,
- overloaded broker.

### 11.8 Consumer error taxonomy

Pantau error berdasarkan kelas:

- deserialization error,
- business validation error,
- downstream timeout,
- database deadlock,
- HTTP dependency failure,
- authorization error,
- commit error,
- rebalance interruption,
- poison pill.

Semua error tidak sama. Error taxonomy menentukan runbook.

---

## 12. Application-Level Observability

Kafka client metrics hanya memberi tahu bahwa record bergerak. Mereka tidak menjamin bisnis benar.

Untuk Java/Spring/Kafka Streams apps, tambahkan metrik aplikasi:

1. Records received.
2. Records processed successfully.
3. Records failed.
4. Records skipped.
5. Records sent to DLQ.
6. Duplicate records detected.
7. Idempotency conflicts.
8. Downstream write duration.
9. Business validation failures.
10. Last processed event timestamp.
11. Projection freshness.
12. Per-event-type throughput.
13. Per-tenant throughput.
14. Per-partition processing duration.
15. Poison pill count.

### 12.1 Last processed event timestamp

Untuk sistem workflow/case management, ini sangat penting.

Contoh:

```text
last_processed_event_time{consumer_group="case-projection"} = 2026-06-19T10:20:00Z
freshness_seconds = now - last_processed_event_time
```

Ini lebih business-relevant daripada offset lag.

### 12.2 Per-event-type metrics

Jika topic berisi beberapa event type:

```text
case.created: 100/s
case.assigned: 30/s
case.escalated: 2/s
case.closed: 20/s
```

Jika `case.escalated` tiba-tiba 0 selama jam kerja, mungkin bukan Kafka issue, tetapi upstream workflow issue.

### 12.3 Per-tenant metrics

Dalam sistem multi-tenant:

- satu tenant bisa membuat hot partition,
- satu tenant bisa membanjiri DLQ,
- satu tenant bisa menyebabkan downstream throttling.

Metrik global sering menyembunyikan tenant-level incident.

---

## 13. Logs: Apa yang Harus Dicatat?

Kafka application logs harus mendukung investigasi tanpa membocorkan data sensitif.

### 13.1 Log minimal untuk producer

Saat send gagal:

```text
event_type
aggregate_id / key
topic
partition if known
offset if known
correlation_id
causation_id
schema_id
error_class
retry_attempt
transactional_id if relevant
```

Jangan log payload penuh jika mengandung PII atau evidence sensitif.

### 13.2 Log minimal untuk consumer

Saat processing gagal:

```text
topic
partition
offset
key
event_type
event_id
correlation_id
consumer_group
attempt
error_class
failure_stage
will_retry
sent_to_dlq
```

### 13.3 Failure stage

Tambahkan stage:

```text
DESERIALIZATION
VALIDATION
DEDUPLICATION
BUSINESS_RULE
DOWNSTREAM_WRITE
OFFSET_COMMIT
DLQ_PUBLISH
UNKNOWN
```

Ini mempercepat diagnosis.

### 13.4 Structured logging

Gunakan JSON logs atau structured logging agar bisa di-query.

Contoh:

```json
{
  "level": "ERROR",
  "service": "case-projection-consumer",
  "event_type": "CaseEscalated",
  "event_id": "evt-123",
  "topic": "reg.case.events.v1",
  "partition": 7,
  "offset": 928381,
  "consumer_group": "case-projection-v2",
  "correlation_id": "corr-456",
  "failure_stage": "DOWNSTREAM_WRITE",
  "error_class": "SQLTransientConnectionException",
  "will_retry": true
}
```

---

## 14. Distributed Tracing for Kafka

Tracing Kafka berbeda dari HTTP synchronous call karena producer dan consumer terpisah waktu.

### 14.1 Trace context propagation

Gunakan header Kafka untuk membawa trace context:

```text
traceparent
tracestate
correlation-id
causation-id
```

Producer membuat atau meneruskan context. Consumer melanjutkan span dari context header.

### 14.2 Span model

Model umum:

```text
HTTP request / command
  └── produce CaseAssigned event
        └── consume CaseAssigned event
              └── update read model
              └── produce CaseAssignmentProjected event
```

### 14.3 Jangan hanya trace send()

Trace harus membedakan:

- time to enqueue producer buffer,
- time to broker ack,
- time waiting in Kafka log,
- time to consumer fetch,
- time processing,
- time downstream side effect.

### 14.4 Trace sampling

Kafka traffic bisa tinggi. Full tracing semua event bisa mahal.

Strategi:

- sample by percentage,
- always sample errors,
- always sample slow events,
- always sample important event types,
- sample specific tenant/case during investigation.

### 14.5 Tracing vs audit

Tracing bukan audit trail.

| Trace | Audit |
|---|---|
| debugging performance/call path | legal/business history |
| sampled bisa diterima | harus lengkap untuk domain tertentu |
| retention pendek | retention sesuai compliance |
| teknis | business/legal |

Untuk regulatory systems, jangan mengganti audit event dengan trace.

---

## 15. Dashboard Design

Dashboard yang buruk menampilkan 200 grafik tanpa narasi. Dashboard yang baik menjawab pertanyaan.

### 15.1 Executive / SLO dashboard

Tujuan: apakah platform sehat?

Panel:

1. Produce success rate.
2. Consume success rate.
3. End-to-end freshness per critical pipeline.
4. Offline partitions.
5. Under-min-ISR partitions.
6. DLQ rate critical topics.
7. Critical consumer groups lag time.
8. Error budget burn.
9. Kafka Connect failed tasks.
10. Kafka Streams app health.

### 15.2 Broker health dashboard

Panel:

1. Broker up/down.
2. Controller health.
3. Offline partitions.
4. Under-replicated partitions.
5. Under-min-ISR partitions.
6. ISR shrink/expand rate.
7. Produce/fetch request latency p95/p99.
8. Request handler idle.
9. Network processor idle.
10. Disk usage per broker/log dir.
11. Disk I/O wait.
12. Bytes in/out.
13. JVM heap/GC.
14. Open file descriptors.

### 15.3 Topic / partition dashboard

Panel:

1. Records in per topic.
2. Bytes in per topic.
3. Bytes out per topic.
4. Partition count.
5. Partition skew.
6. Per-partition log end offset rate.
7. Per-partition size.
8. Retention headroom.
9. Compaction backlog if relevant.
10. Tombstone rate for compacted topics.

### 15.4 Producer dashboard

Panel:

1. Record send rate.
2. Byte send rate.
3. Error rate by exception.
4. Retry rate.
5. Request latency p95/p99.
6. Record queue time.
7. Batch size average.
8. Compression ratio.
9. Buffer available bytes.
10. Throttle time.
11. Metadata age/refresh errors.

### 15.5 Consumer dashboard

Panel:

1. Offset lag per partition.
2. Time lag/freshness.
3. Records consumed rate.
4. Records processed success/failure rate.
5. Processing latency p95/p99.
6. Commit latency.
7. Rebalance count/duration.
8. Assigned partitions count.
9. Poll interval.
10. DLQ rate.
11. Downstream dependency latency.

### 15.6 Pipeline dashboard

Untuk pipeline end-to-end:

```text
producer → topic → consumer → database/search/read model → API/user visible projection
```

Panel:

1. Events produced.
2. Events in Kafka.
3. Events consumed.
4. Events processed.
5. Events written downstream.
6. Events failed.
7. DLQ events.
8. Freshness.
9. Reconciliation gap.

Pipeline dashboard lebih berguna untuk business incident daripada broker dashboard.

---

## 16. Alert Design: Dari Noise ke Action

### 16.1 Prinsip alert

Alert harus memenuhi minimal salah satu:

1. User impact sedang terjadi.
2. User impact akan segera terjadi jika tidak ada tindakan.
3. Data loss/durability risk meningkat.
4. Security/compliance invariant dilanggar.
5. Automation perlu dipicu.

Jangan alert untuk hal yang tidak butuh tindakan.

### 16.2 Alert buruk

```text
CPU > 80%
```

Masalah:

- Kafka bisa normal di CPU tinggi.
- Tidak jelas impact.
- Tidak jelas owner.
- Bisa noise.

### 16.3 Alert lebih baik

```text
Broker request handler idle < 10% for 10 minutes
AND produce request p99 latency > SLO
AND producer retry rate increasing
```

Ini mengarah ke broker saturation yang berdampak write path.

### 16.4 Multi-window burn rate

Untuk SLO, gunakan alert berbasis error budget.

Contoh:

```text
Critical pipeline freshness SLO:
99.9% events projected within 60 seconds
```

Alert:

- fast burn: violation tinggi dalam 5–15 menit,
- slow burn: violation moderat dalam 1–6 jam.

### 16.5 Alert severity

Contoh severity:

| Severity | Contoh |
|---|---|
| SEV1 | offline partition pada critical topic, data unavailable |
| SEV2 | under-min-ISR sustained, critical consumer freshness breach |
| SEV3 | lag meningkat tetapi SLO belum breach |
| SEV4 | disk usage warning, capacity trend |

### 16.6 Alert harus punya runbook

Setiap alert harus punya:

```text
Meaning:
Impact:
Owner:
First checks:
Likely causes:
Safe mitigations:
Unsafe actions:
Escalation:
Links:
```

---

## 17. SLO untuk Kafka Systems

Kafka platform SLO harus dibedakan dari application pipeline SLO.

### 17.1 Platform SLO

Contoh:

1. Kafka broker availability.
2. Produce availability for critical topics.
3. Consume availability for critical topics.
4. No offline partitions.
5. No sustained under-min-ISR for critical topics.
6. Metadata operation latency.

### 17.2 Pipeline SLO

Contoh:

1. 99.9% `CaseCreated` events projected within 30 seconds.
2. 99.5% `CaseEscalated` events evaluated within 10 seconds.
3. 99.9% valid events not sent to DLQ.
4. 100% audit-critical events eventually persisted to audit store.
5. Reconciliation gap between Kafka and read model < 0.01%.

### 17.3 Freshness SLO

Freshness SLO sangat cocok untuk event-driven projection.

```text
case_projection_freshness_seconds < 60 for 99.9% of time
```

### 17.4 Correctness SLO

Untuk regulatory systems, latency saja tidak cukup.

Contoh:

```text
No missing audit-critical event in daily reconciliation.
No event processed without schema validation.
No enforcement decision event without causation id.
```

---

## 18. Kafka Connect Observability

Kafka Connect adalah runtime stateful. Observability harus mencakup worker, connector, task, source/sink offset, errors, DLQ, dan downstream health.

### 18.1 Connect worker metrics

Pantau:

- worker up/down,
- rebalance count,
- connector count,
- task count,
- failed task count,
- REST API availability,
- internal topic health.

### 18.2 Connector metrics

Pantau:

- connector state: RUNNING/PAUSED/FAILED,
- task state,
- records read/written,
- records failed,
- retries,
- DLQ records,
- offset commit success/failure,
- source poll duration,
- sink put duration.

### 18.3 Source connector observability

Untuk source connector:

- source offset movement,
- source lag,
- snapshot status,
- streaming status,
- records emitted,
- schema changes,
- source connection health.

CDC source khusus:

- binlog/WAL/redo log lag,
- snapshot progress,
- replication slot health,
- connector restart frequency,
- transaction size impact.

### 18.4 Sink connector observability

Untuk sink connector:

- sink write latency,
- batch size,
- retry rate,
- failed records,
- downstream throttling,
- idempotency conflict,
- DLQ.

Sink connector sering terlihat “Kafka lag” padahal root cause-nya adalah target database/search/object storage.

### 18.5 Connect alert penting

1. Task FAILED.
2. Connector FAILED.
3. DLQ rate > baseline.
4. Source lag growing.
5. Sink put latency high.
6. Worker rebalance storm.
7. Internal topic unavailable.
8. Offset not moving.

---

## 19. Kafka Streams Observability

Kafka Streams adalah aplikasi Java + Kafka consumer/producer + state store + internal topics.

Pantau:

1. Input records rate.
2. Processed records rate.
3. Processing latency.
4. Commit latency.
5. Task assignment.
6. Rebalance count/duration.
7. State store size.
8. RocksDB metrics.
9. Changelog restore progress.
10. Standby replica lag.
11. Suppression buffer usage.
12. Internal topic lag.
13. Punctuator errors.
14. Deserialization errors.
15. Production errors to output topics.

### 19.1 Restore observability

Saat Kafka Streams instance restart, state bisa dipulihkan dari changelog.

Pantau:

```text
restore records remaining
restore rate
restore duration
state directory size
changelog consumer lag
```

Jika restore terlalu lama, app mungkin sehat secara process tetapi belum ready secara fungsional.

### 19.2 State store disk pressure

Stateful app butuh disk lokal.

Pantau:

- RocksDB size,
- block cache,
- compaction latency,
- disk usage,
- write stalls,
- state directory growth.

### 19.3 Streams readiness

Jangan declare app ready hanya karena HTTP health endpoint hidup.

Ready jika:

- assigned tasks running,
- state restored,
- store queryable jika interactive query dipakai,
- no fatal stream thread exception,
- lag/freshness within threshold.

---

## 20. ksqlDB Observability

ksqlDB menjalankan persistent queries sebagai stream processing workloads.

Pantau:

1. Server up/down.
2. Query status.
3. Query error.
4. Processing throughput.
5. Processing latency.
6. Consumer lag internal queries.
7. Repartition topic throughput.
8. Changelog topic size.
9. State store disk.
10. Pull query latency.
11. Push query client count.
12. Schema/serialization errors.
13. Query restart count.

### 20.1 Query health

Persistent query yang RUNNING belum tentu benar.

Perlu cek:

- input topic data masuk,
- output topic data keluar,
- lag tidak growing,
- error log bersih,
- repartition topic tidak exploding,
- state store tidak disk penuh,
- result matches expected semantics.

---

## 21. DLQ Observability

DLQ bukan tempat membuang masalah. DLQ adalah production signal.

Pantau:

1. DLQ records per second.
2. DLQ records by source topic.
3. DLQ records by consumer group/connector.
4. DLQ records by error class.
5. DLQ records by event type.
6. DLQ records by schema version.
7. DLQ age.
8. DLQ replay status.
9. DLQ backlog.
10. DLQ storage retention.

### 21.1 DLQ spike interpretation

| DLQ pattern | Kemungkinan |
|---|---|
| sudden spike all event types | downstream outage / code deploy bug |
| one event type only | schema/business rule issue |
| one tenant only | tenant data quality issue |
| one partition only | poison pill / hot key |
| after deploy | backward compatibility bug |
| after schema change | schema evolution bug |

### 21.2 DLQ SLO

Contoh:

```text
Valid events sent to DLQ: 0
Invalid events triaged within 4 hours
Audit-critical DLQ events replayed or closed with decision record within 24 hours
```

Untuk regulatory systems, DLQ harus punya workflow resolusi, bukan hanya topic.

---

## 22. Schema Registry Observability

Schema Registry sering menjadi dependency tersembunyi pada producer/consumer startup atau serialization path.

Pantau:

1. Registry availability.
2. Request latency.
3. Error rate.
4. Compatibility check failures.
5. Schema registration rate.
6. Subject count growth.
7. Auth failures.
8. Cache hit/miss jika tersedia.

Gejala schema issue:

- producer serialization error,
- consumer deserialization error,
- new deployment gagal start,
- compatibility check failed di CI/CD,
- event dengan schema id unknown.

---

## 23. Business Observability untuk Regulatory / Case Management

Untuk sistem enforcement lifecycle, Kafka observability harus menjawab pertanyaan legal dan operasional.

Contoh business metrics:

1. Case events produced by type.
2. Case state projection freshness.
3. Escalation event processing delay.
4. SLA breach evaluation delay.
5. Assignment event delay.
6. Decision event audit completeness.
7. Evidence ingestion lag.
8. Appeal/review event lag.
9. Events missing causation id.
10. Events missing actor/principal.
11. Correction events by reason.
12. Reconciliation gaps between event log and case read model.

### 23.1 Audit completeness metric

Contoh:

```text
audit_critical_events_produced_total
audit_critical_events_persisted_total
audit_gap = produced - persisted
```

Jika audit gap > 0, itu bukan sekadar performance issue. Itu defensibility issue.

### 23.2 State transition observability

Untuk workflow state machine:

```text
transition_attempted_total{from="UNDER_REVIEW",to="ESCALATED"}
transition_succeeded_total{from="UNDER_REVIEW",to="ESCALATED"}
transition_rejected_total{reason="invalid_state"}
```

Ini membantu membedakan bug processing dari event bisnis yang memang tidak valid.

---

## 24. Practical Java/Spring Instrumentation

### 24.1 Producer instrumentation

Tambahkan metrics wrapper di producer service.

Pseudo-code:

```java
public CompletableFuture<SendResult<String, CaseEvent>> publish(CaseEvent event) {
    long startNanos = System.nanoTime();

    return kafkaTemplate.send("reg.case.events.v1", event.caseId(), event)
        .whenComplete((result, ex) -> {
            long durationNanos = System.nanoTime() - startNanos;

            if (ex == null) {
                metrics.timer("kafka.producer.send.duration", tags(event))
                    .record(durationNanos, TimeUnit.NANOSECONDS);
                metrics.counter("kafka.producer.send.success", tags(event)).increment();
            } else {
                metrics.counter("kafka.producer.send.failure",
                    Tags.of("event_type", event.type(), "error", ex.getClass().getSimpleName()))
                    .increment();
            }
        });
}
```

Catatan:

- Jangan hanya bergantung pada Kafka client metrics.
- Tambahkan tag event type/domain/tenant dengan cardinality terkendali.
- Jangan jadikan `caseId` sebagai tag metrik karena cardinality sangat tinggi.

### 24.2 Consumer instrumentation

Pseudo-code:

```java
@KafkaListener(topics = "reg.case.events.v1", groupId = "case-projection-v2")
public void consume(
        ConsumerRecord<String, CaseEvent> record,
        Acknowledgment ack
) {
    long startNanos = System.nanoTime();
    String eventType = record.value().type();

    try {
        projectionService.apply(record.value());

        metrics.counter("kafka.consumer.process.success",
            Tags.of("event_type", eventType)).increment();

        metrics.timer("kafka.consumer.process.duration",
            Tags.of("event_type", eventType))
            .record(System.nanoTime() - startNanos, TimeUnit.NANOSECONDS);

        metrics.gauge("kafka.consumer.last_processed_event_time", record.value().occurredAt().toEpochMilli());

        ack.acknowledge();
    } catch (RetryableDependencyException ex) {
        metrics.counter("kafka.consumer.process.failure",
            Tags.of("stage", "DOWNSTREAM_WRITE", "retryable", "true")).increment();
        throw ex;
    } catch (Exception ex) {
        metrics.counter("kafka.consumer.process.failure",
            Tags.of("stage", classify(ex), "retryable", "false")).increment();
        throw ex;
    }
}
```

### 24.3 Cardinality warning

Good metric tags:

```text
event_type
service
consumer_group
topic
error_class
stage
tenant_tier
region
```

Dangerous metric tags:

```text
event_id
case_id
user_id
email
raw exception message
full topic if dynamically generated per customer
```

High cardinality bisa merusak monitoring backend.

---

## 25. Incident Runbooks

### 25.1 Runbook: Consumer lag naik

#### Step 1 — Scope

Tanya:

```text
Apakah semua consumer group terdampak atau satu group?
Apakah semua topic atau satu topic?
Apakah semua partition atau satu partition?
Apakah offset lag atau time lag?
Apakah ada deploy baru?
Apakah ada traffic spike?
```

#### Step 2 — Bandingkan rates

```text
produce rate > consume rate?
consume rate turun?
processing failure naik?
DLQ naik?
downstream latency naik?
rebalance naik?
```

#### Step 3 — Diagnosis umum

| Gejala | Kemungkinan |
|---|---|
| lag naik, consume rate normal, produce spike | capacity issue |
| lag naik, consume rate turun | consumer/downstream issue |
| lag satu partition | hot key/poison pill |
| lag naik setelah deploy | code/config bug |
| lag naik saat rebalance storm | group instability |
| lag naik dan DLQ naik | data/schema/business validation issue |
| lag naik dan DB latency naik | downstream bottleneck |

#### Step 4 — Mitigation

Aman:

- scale consumer jika partition cukup,
- pause non-critical workload,
- increase downstream capacity,
- rollback bad deploy,
- isolate poison pill,
- increase retry backoff,
- route bad records to DLQ jika policy memungkinkan.

Tidak aman tanpa analisis:

- reset offset ke latest,
- delete topic,
- increase partition count pada keyed ordered topic,
- disable error handling,
- skip records tanpa audit,
- lower durability configs.

---

### 25.2 Runbook: Producer timeout/error spike

Cek:

```text
Which exception?
Which topic?
All producers or one app?
Broker produce request latency?
Under-min-ISR?
Authorization changes?
Record size changes?
Quota throttle?
Network issue?
```

Diagnosis:

| Error | Kemungkinan |
|---|---|
| TimeoutException | broker/network/acks/buffer/request queue |
| NotEnoughReplicas | ISR below min ISR |
| AuthorizationException | ACL/security change |
| RecordTooLargeException | payload limit |
| SerializationException | schema/data bug |
| ProducerFencedException | transactional id conflict |

Mitigation:

- rollback producer deploy,
- check broker health,
- check ISR/min ISR,
- check payload size,
- check schema registry,
- scale or repair broker resource,
- fix ACL if accidental.

---

### 25.3 Runbook: Under-replicated partitions

Cek:

```text
Which brokers?
Which topics?
Is maintenance ongoing?
Follower fetch latency?
Disk I/O?
Network?
Broker logs?
GC pause?
```

Likely causes:

- broker down,
- broker slow,
- disk issue,
- network issue,
- overloaded partition,
- replication throttling,
- reassignment in progress.

Mitigation:

- restore failed broker,
- reduce load,
- stop heavy reassignment if needed,
- verify disk health,
- check network,
- avoid unnecessary rolling restart.

---

### 25.4 Runbook: Offline partitions

Severity tinggi.

Cek:

```text
Which partitions?
Which leaders unavailable?
How many replicas alive?
Controller health?
Recent broker failures?
Unclean leader election setting?
```

Mitigation:

- restore broker with latest replica if possible,
- avoid forcing unsafe leader election unless business accepts data loss risk,
- communicate impact,
- capture timeline,
- after recovery, run data reconciliation.

---

### 25.5 Runbook: DLQ spike

Cek:

```text
Which event type?
Which schema version?
Which consumer group/connector?
Which error class?
After deploy/schema change?
One tenant or all?
```

Mitigation:

- pause consumer if DLQ means data corruption risk,
- rollback bad consumer/producer,
- fix schema/data mapping,
- create replay plan,
- document disposition for audit-critical records.

---

### 25.6 Runbook: Rebalance storm

Cek:

```text
Consumer restarts?
max.poll.interval exceeded?
GC pause?
Kubernetes liveness killing pods?
Autoscaler flapping?
Network issue?
Static membership configured?
Cooperative assignor?
```

Mitigation:

- stabilize deployment/autoscaling,
- increase processing parallelism outside poll loop,
- tune max poll interval carefully,
- use cooperative sticky assignor,
- use static membership for stable instances,
- fix long blocking processing.

---

## 26. Synthetic Monitoring

Synthetic monitoring membuat event kecil secara periodik dan memverifikasi event sampai ke downstream.

Contoh:

```text
synthetic producer → synthetic topic → synthetic consumer → synthetic sink → freshness metric
```

Untuk pipeline bisnis:

```text
synthetic CaseCreated → case projection → read model visible → audit event persisted
```

Manfaat:

- mendeteksi issue end-to-end,
- tidak hanya bergantung pada traffic user,
- cocok untuk low-throughput critical pipeline,
- bisa mengukur freshness real.

Hati-hati:

- synthetic event harus ditandai jelas,
- jangan mencemari audit/legal event tanpa policy,
- jangan memicu workflow nyata.

---

## 27. Reconciliation as Observability

Metrics tidak cukup untuk correctness. Reconciliation membandingkan state antar sistem.

Contoh:

```text
Kafka case events count by case_id
vs
case read model latest state
vs
audit store event count
```

Reconciliation menjawab:

1. Ada event hilang?
2. Ada event duplicate yang berdampak?
3. Ada projection out-of-sync?
4. Ada DLQ belum diproses?
5. Ada audit gap?

Untuk sistem regulasi, reconciliation adalah bagian dari observability, bukan batch report tambahan.

---

## 28. Common Anti-Patterns

### 28.1 Hanya memantau broker

Broker sehat tidak berarti pipeline sehat.

Consumer bisa mati, DLQ bisa naik, read model bisa basi, tetapi broker dashboard hijau.

### 28.2 Hanya memantau lag offset

Lag offset tidak menunjukkan correctness, time freshness, atau downstream success.

### 28.3 Alert tanpa owner

Alert tanpa owner menjadi noise.

### 28.4 Alert tanpa runbook

Alert tanpa runbook memperlambat incident.

### 28.5 Log payload penuh

Berbahaya untuk PII, evidence, credentials, dan compliance.

### 28.6 High-cardinality metrics

Tag seperti event_id/case_id/user_id bisa membuat metrics backend mahal atau rusak.

### 28.7 DLQ tanpa proses resolusi

DLQ yang tidak ditriase adalah data loss yang ditunda.

### 28.8 Readiness hanya process alive

Consumer process alive belum tentu assigned, restored, caught up, atau mampu memproses.

### 28.9 Menganggap replay selalu aman

Replay tanpa idempotency dan observability bisa menggandakan side effect.

### 28.10 Dashboard terlalu banyak grafik

Dashboard harus dimulai dari pertanyaan operasional, bukan dari daftar semua MBean.

---

## 29. Production Checklist

### 29.1 Cluster-level checklist

- [ ] Offline partitions alert.
- [ ] Under-replicated partitions alert.
- [ ] Under-min-ISR alert.
- [ ] ISR shrink/expand dashboard.
- [ ] Broker request latency by request type.
- [ ] Request handler/network processor saturation.
- [ ] Disk usage/log dir health.
- [ ] JVM heap/GC metrics.
- [ ] Controller/KRaft health.
- [ ] Broker bytes in/out.
- [ ] Partition skew dashboard.

### 29.2 Producer checklist

- [ ] Send success/failure by topic/event type.
- [ ] Retry rate.
- [ ] Error taxonomy.
- [ ] Request latency p95/p99.
- [ ] Queue time.
- [ ] Batch size.
- [ ] Compression ratio.
- [ ] Buffer exhaustion.
- [ ] Throttle time.
- [ ] Serialization/schema errors.

### 29.3 Consumer checklist

- [ ] Offset lag per partition.
- [ ] Time lag/freshness.
- [ ] Records consumed rate.
- [ ] Records processed success/failure.
- [ ] Processing latency p95/p99.
- [ ] Commit latency/failure.
- [ ] Rebalance count/duration.
- [ ] Poll interval.
- [ ] DLQ rate.
- [ ] Downstream dependency metrics.

### 29.4 Kafka Connect checklist

- [ ] Worker health.
- [ ] Connector/task state.
- [ ] Failed tasks alert.
- [ ] Source/sink lag.
- [ ] DLQ rate.
- [ ] Retry/error rate.
- [ ] Internal topics monitored.
- [ ] Offset movement.
- [ ] Downstream latency.

### 29.5 Kafka Streams/ksqlDB checklist

- [ ] Query/topology health.
- [ ] Task/thread health.
- [ ] State restore metrics.
- [ ] State store disk usage.
- [ ] Changelog/repartition topic lag.
- [ ] Processing latency.
- [ ] Commit latency.
- [ ] Fatal exception alert.
- [ ] Output correctness checks.

### 29.6 Business checklist

- [ ] Critical event freshness.
- [ ] Audit completeness.
- [ ] DLQ triage workflow.
- [ ] Reconciliation job.
- [ ] Missing causation/correlation id detection.
- [ ] SLA breach processing delay.
- [ ] Case projection staleness.
- [ ] Tenant-level anomaly detection.

---

## 30. Thought Exercises

### Exercise 1 — Lag diagnosis

Consumer group `case-projection-v2` memiliki total lag 1.000.000. Produce rate 5.000 rps, consume rate 5.200 rps, freshness 45 detik, SLO freshness 2 menit.

Pertanyaan:

1. Apakah ini incident?
2. Apa metrik tambahan yang ingin kamu lihat?
3. Apakah scaling consumer perlu?

Jawaban yang baik: belum tentu incident. Consume rate lebih tinggi dari produce rate dan freshness masih dalam SLO. Perlu lihat trend, per-partition lag, DLQ, error rate, dan apakah ini backlog backfill yang sedang turun.

### Exercise 2 — Lag kecil, user complain data basi

Offset lag hanya 20 record, tetapi user melihat case status terlambat 30 menit.

Kemungkinan:

1. Topic low throughput sehingga 20 record bisa berarti 30 menit.
2. Consumer commit offset sebelum downstream write selesai.
3. Projection write gagal diam-diam.
4. Read model cache/API stale.
5. Consumer memproses event tetapi event_time lama.

Metrik yang dibutuhkan:

- freshness by event time,
- downstream write success,
- projection last update time,
- audit/reconciliation gap,
- application processing logs.

### Exercise 3 — Under-replicated partitions saat rolling restart

Under-replicated partitions naik selama 2 menit saat restart broker, lalu turun ke nol.

Apakah alert harus page? Biasanya tidak jika dalam maintenance window dan cepat pulih. Tetapi harus tercatat di dashboard. Page jika sustained, terjadi di luar maintenance, atau disertai under-min-ISR/producer errors.

### Exercise 4 — DLQ spike setelah schema change

DLQ naik hanya untuk `CaseDecisionRecorded` schema v4.

Kemungkinan:

- compatibility break,
- consumer belum support field baru,
- enum value baru tidak dikenal,
- default missing,
- business validation belum diupdate.

Langkah:

- cek Schema Registry compatibility,
- cek consumer deserialization/business validation logs,
- rollback producer atau deploy consumer fix,
- siapkan replay DLQ.

---

## 31. Ringkasan

Kafka observability yang matang tidak berhenti di broker metrics atau consumer lag. Kafka adalah sistem event streaming end-to-end, sehingga observability harus mencakup:

1. **Cluster health**: offline partitions, under-replicated partitions, ISR, controller, disk, request latency.
2. **Producer health**: send latency, retry, error, batching, buffer, throttle.
3. **Consumer health**: lag, freshness, processing latency, commit, rebalance, error, DLQ.
4. **Stream processing health**: state store, changelog, restore, task, query, internal topics.
5. **Connect health**: worker, connector, task, source/sink offset, downstream, DLQ.
6. **Schema health**: compatibility, registration, serialization/deserialization errors.
7. **Business health**: audit completeness, projection freshness, SLA evaluation, reconciliation gap.

Consumer lag adalah sinyal penting, tetapi bukan satu-satunya sinyal. Dalam sistem production serius, terutama regulatory/case management, observability harus membuktikan bahwa:

```text
Event produced safely.
Event stored durably.
Event consumed correctly.
Side effect applied idempotently.
Projection fresh enough.
Audit trail complete.
Failures visible and recoverable.
```

Jika keenam hal itu bisa dilihat, diukur, dan diinvestigasi, Kafka bukan lagi black box. Kafka menjadi platform yang bisa dioperasikan dengan confidence.

---

## 32. Koneksi ke Part Berikutnya

Part 024 membahas bagaimana melihat dan mendiagnosis sistem Kafka. Part berikutnya akan masuk ke **performance engineering**:

```text
Part 025 — Performance Engineering: Throughput, Latency, Batching, Compression, Partitions, and Quotas
```

Di Part 025, kita akan membahas bagaimana meningkatkan throughput dan menurunkan latency tanpa merusak durability, ordering, cost, atau operational stability.

---

## 33. Referensi

Referensi utama yang relevan untuk bagian ini:

1. Apache Kafka Documentation — Monitoring and Operations.
2. Apache Kafka Documentation — Consumer, Producer, Broker, and Streams Metrics.
3. Confluent Documentation — Monitor Kafka with JMX and MBeans.
4. Confluent Documentation — Consumer Lag Monitoring.
5. Confluent Documentation — Kafka Connect Monitoring.
6. Confluent Documentation — Kafka Streams Monitoring.
7. OpenTelemetry Concepts — Distributed Tracing and Context Propagation.
8. Google SRE Concepts — Golden Signals and SLO-based Alerting.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Testing Kafka Systems: Unit, Integration, Contract, Replay, Chaos, and Determinism</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-025.md">Part 025 — Performance Engineering: Throughput, Latency, Batching, Compression, Partitions, and Quotas ➡️</a>
</div>

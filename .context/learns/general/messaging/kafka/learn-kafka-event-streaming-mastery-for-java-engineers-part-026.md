# learn-kafka-event-streaming-mastery-for-java-engineers-part-026.md

# Part 026 — Failure Modelling: Data Loss, Duplication, Reordering, Lag Explosion, and Split Brain Thinking

## Status Seri

- Seri: `learn-kafka-event-streaming-mastery-for-java-engineers`
- Part: `026 / 034`
- Status: **belum selesai**
- Part sebelumnya: `025 — Performance Engineering: Throughput, Latency, Batching, Compression, Partitions, and Quotas`
- Part berikutnya: `027 — Event-Driven Architecture with Kafka: Choreography, Orchestration, Sagas, and Workflow Boundaries`

---

## 1. Tujuan Pembelajaran

Di bagian sebelumnya kita sudah membahas performance engineering: batching, compression, throughput, latency, partition count, quotas, dan benchmark. Tetapi Kafka production maturity tidak berhenti di performa. Sistem yang cepat tetapi gagal dengan cara yang tidak dipahami adalah sistem yang berbahaya.

Part ini membahas **failure modelling**: cara berpikir sistematis untuk memprediksi, membatasi, mendeteksi, dan memulihkan kegagalan Kafka.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **data loss**, **duplicate processing**, **reordering**, **lag explosion**, **poison event**, dan **availability failure**.
2. Menjelaskan skenario producer crash sebelum/sesudah ack.
3. Menjelaskan skenario consumer crash sebelum/sesudah commit offset.
4. Memahami hubungan `acks`, `replication.factor`, `min.insync.replicas`, ISR, dan unclean leader election.
5. Memahami bagaimana rebalancing, GC pause, network pause, dan rolling deploy dapat memicu duplicate processing.
6. Mendesain consumer yang idempotent dan recovery-friendly.
7. Membuat failure matrix untuk Kafka-based architecture.
8. Mengubah diskusi “Kafka reliable atau tidak?” menjadi pertanyaan yang lebih presisi: **reliable terhadap kegagalan apa, dengan konfigurasi apa, dan invariant apa yang dijaga?**

---

## 2. Mental Model Utama

Kafka bukan sistem yang “selalu exactly-once” atau “selalu at-least-once”. Kafka adalah sekumpulan mekanisme yang memberikan guarantee berbeda pada titik berbeda:

```text
producer -> broker leader -> follower replicas -> consumer fetch -> application processing -> offset commit -> external side effect
```

Setiap panah bisa gagal.

Kegagalan Kafka jarang terjadi sebagai satu error sederhana. Biasanya ia muncul sebagai kombinasi:

```text
slow disk + ISR shrink + producer timeout + retry + rebalance + non-idempotent side effect
```

atau:

```text
consumer GC pause + session timeout + partition reassignment + stale worker still writing to DB
```

atau:

```text
schema breaking change + poison event + retry loop + lag explosion + DLQ tidak dipantau
```

Top 1% Kafka engineer berpikir dalam **failure chains**, bukan isolated exceptions.

---

## 3. First Principles: Kafka Failure Surfaces

Kafka pipeline dapat dipetakan menjadi beberapa surface kegagalan.

```text
+----------------+     +----------------+     +------------------+     +------------------+
| Producer       | --> | Broker Leader  | --> | Follower Replica | --> | Consumer Group   |
+----------------+     +----------------+     +------------------+     +------------------+
        |                       |                       |                         |
        v                       v                       v                         v
  retry/timeout            disk/network            ISR lag/shrink          commit/rebalance
        |                       |                       |                         |
        v                       v                       v                         v
  duplicate risk           data loss risk           availability risk       duplicate/lag risk
```

Tambahkan sistem eksternal:

```text
Consumer -> Database/API/Search/Cache/Object Storage
```

Di sinilah banyak “exactly-once” claim runtuh. Kafka dapat menyinkronkan transaksi Kafka-to-Kafka, tetapi side effect ke database, REST API, email, payment gateway, atau legacy system memerlukan desain idempotency sendiri.

---

## 4. Failure Taxonomy

Kita akan gunakan taxonomy berikut sepanjang part ini.

| Failure Type | Arti | Contoh |
|---|---|---|
| Data loss | Record yang dianggap berhasil tidak lagi tersedia untuk consumer | Producer menerima ack lalu leader/follower failure dengan durability config lemah |
| Duplicate delivery | Record yang sama diproses lebih dari sekali | Consumer crash setelah side effect tetapi sebelum offset commit |
| Reordering | Urutan event yang diproses tidak sesuai urutan bisnis yang diasumsikan | Producer retry dengan config lama/tidak aman atau key berubah partition |
| Lag explosion | Backlog meningkat lebih cepat dari kemampuan consumer memproses | Downstream lambat, poison event retry loop, deploy buruk |
| Availability loss | Cluster/client tidak bisa menerima atau memproses traffic | ISR terlalu kecil, broker down, quota/throttle, controller issue |
| Semantic corruption | Data ada dan terkirim, tetapi maknanya salah | Breaking schema, event name generik, ordering domain salah |
| Recovery failure | Sistem bisa gagal, tetapi tidak bisa pulih dengan aman | Tidak ada replay plan, DLQ tidak bisa direprocess, offset sudah maju |
| Observability blindness | Failure terjadi tetapi tidak terlihat | Hanya monitor CPU, tidak monitor lag/ISR/offline partitions/DLQ |

Failure modelling harus selalu mengaitkan failure dengan **invariant**.

Contoh invariant:

```text
Setiap CaseDecisionApproved harus menghasilkan tepat satu audit ledger entry.
Tidak boleh ada EnforcementNoticeSent tanpa CaseDecisionApproved sebelumnya.
Setiap event dengan event_id yang sama harus diproses idempotently.
Consumer tidak boleh commit offset sebelum side effect durable.
Topic public tidak boleh menerima schema breaking change tanpa compatibility approval.
```

Tanpa invariant, diskusi failure berubah menjadi opini.

---

## 5. Producer Failure Modes

### 5.1 Producer Mengirim Record tetapi Crash Sebelum `send()` Selesai

Skenario:

```text
producer.send(record)
process crashes before callback
```

Kemungkinan:

1. Record belum pernah keluar dari buffer producer.
2. Record sudah dikirim ke broker tetapi producer belum menerima response.
3. Broker sudah menulis record tetapi producer crash sebelum tahu hasilnya.

Dari sisi aplikasi, status record adalah **unknown**.

Konsekuensi:

- Jika aplikasi tidak retry, bisa terjadi data loss dari perspektif bisnis.
- Jika aplikasi retry, bisa terjadi duplicate kecuali producer idempotence dan/atau event idempotency digunakan.

Production rule:

```text
Unknown outcome must be treated as retryable, but retry must be made idempotent.
```

### 5.2 Producer Mendapat Timeout

Timeout bukan bukti bahwa write gagal.

Skenario:

```text
producer sends batch
broker writes batch
broker response delayed
producer request timeout fires
producer retries
```

Kemungkinan outcome:

- Batch pertama sebenarnya berhasil.
- Retry menghasilkan duplicate jika idempotence tidak aktif.
- Producer idempotence membantu broker mengenali duplicate dari producer session/sequence.

Rule:

```text
Timeout means unknown, not failed.
```

### 5.3 Producer Mendapat Ack tetapi Data Hilang

Ini adalah failure paling sensitif.

Kemungkinan terjadi jika durability config terlalu lemah.

Contoh config berisiko:

```properties
acks=1
replication.factor=1
```

atau:

```properties
acks=1
replication.factor=3
```

tetapi leader crash sebelum follower menerima data.

Dengan `acks=1`, producer mendapat ack setelah leader menulis data. Jika leader mati sebelum data direplikasi ke ISR lain, data yang sudah di-ack bisa hilang ketika leader baru dipilih.

Config lebih kuat:

```properties
acks=all
min.insync.replicas=2
replication.factor=3
```

Dengan config ini, record dianggap sukses hanya jika leader dan minimal satu replica in-sync lain sudah mengakui write.

Namun ini bukan magic. Jika jumlah ISR turun di bawah `min.insync.replicas`, producer akan menerima error dan availability write turun. Ini trade-off durability vs availability.

### 5.4 Producer Retry dan Reordering

Ordering pada partition bisa rusak jika producer mengirim beberapa request in-flight dan retry menyebabkan batch lama ditulis setelah batch baru.

Konsep:

```text
Batch A sent
Batch B sent
Batch A fails transiently
Batch B succeeds
Batch A retried and succeeds later
```

Jika tidak ada mekanisme sequence/idempotence yang benar, consumer bisa melihat:

```text
B before A
```

Kafka modern mengaktifkan idempotence secara default selama tidak ada konfigurasi yang konflik, tetapi engineer tetap harus memahami konfigurasi yang dapat melemahkan guarantee.

Rule:

```text
Ordering is not a wish. Ordering is a consequence of key, partition, producer sequencing, and retry semantics.
```

---

## 6. Broker and Replication Failure Modes

### 6.1 Leader Crash

Setiap partition punya leader. Producer menulis ke leader, consumer membaca dari leader secara default. Jika leader crash:

1. Controller mendeteksi broker/leader tidak tersedia.
2. Leader election dilakukan dari replica yang eligible.
3. Client metadata diperbarui.
4. Producer/consumer reconnect ke leader baru.

Dampak:

- Temporary unavailable untuk partition tersebut.
- Produce/fetch error sementara.
- Potential data loss jika leader baru tidak memiliki semua record yang sudah di-ack sebelumnya, bergantung config.

### 6.2 ISR Shrink

ISR = in-sync replicas.

Follower dapat keluar dari ISR jika tertinggal terlalu jauh atau tidak memenuhi sync requirement.

Skenario:

```text
replication.factor=3
ISR initially: broker-1, broker-2, broker-3
broker-3 disk slow
ISR becomes: broker-1, broker-2
broker-2 network issue
ISR becomes: broker-1
```

Jika:

```properties
min.insync.replicas=2
acks=all
```

maka write baru gagal ketika ISR hanya 1.

Ini bukan Kafka “rusak”. Ini Kafka menjaga durability invariant.

Trade-off:

```text
Keep accepting writes with weak durability
or
reject writes until enough replicas are in sync
```

Untuk sistem regulatory/enforcement, biasanya pilihan yang benar adalah reject writes untuk event critical, lalu expose backpressure/incident, bukan menerima write yang berisiko hilang.

### 6.3 Unclean Leader Election

Unclean leader election berarti replica yang tidak in-sync dapat dipilih menjadi leader.

Dampaknya:

- Availability bisa pulih lebih cepat.
- Data yang hanya ada pada leader lama tetapi belum ada di replica baru dapat hilang.

Rule:

```text
Unclean leader election trades data safety for availability.
```

Untuk event audit, financial decision, enforcement state transition, atau evidence lifecycle, unclean leader election harus diperlakukan sebagai risiko tinggi.

### 6.4 Disk Full

Kafka adalah sistem storage. Disk full bukan edge case; ini failure mode utama.

Penyebab:

- Retention terlalu panjang.
- Compaction tidak berjalan cukup cepat.
- DLQ tidak dipantau.
- Repartition/internal topics membengkak.
- Kafka Streams changelog besar.
- Consumer lag menyebabkan retention harus diperpanjang.
- Mirror/replication topic tidak dikontrol.

Dampak:

- Broker tidak bisa menerima write.
- Segment tidak bisa dibuat.
- Replication terganggu.
- Controller/broker stability menurun.

Rule:

```text
Disk capacity is part of correctness, not only operations.
```

Jika retention habis sebelum consumer memproses backlog, itu data loss dari perspektif consumer walaupun Kafka bekerja sesuai konfigurasi.

### 6.5 Network Partition

Network partition bisa terjadi antara:

- producer dan broker,
- consumer dan broker,
- broker dan broker,
- broker dan controller quorum,
- Connect worker dan Kafka,
- application dan Schema Registry.

Dampak berbeda:

```text
producer <-> broker down       -> produce timeout/retry
broker <-> broker degraded     -> ISR shrink, replication lag
consumer <-> broker unstable   -> fetch error, heartbeat issue, rebalance
app <-> schema registry down   -> serialization/deserialization failure
```

Network partition jarang terlihat sebagai “network partition” di log aplikasi. Biasanya terlihat sebagai timeout, retry, authentication reconnect, coordinator unavailable, rebalance, atau request latency spike.

---

## 7. Consumer Failure Modes

### 7.1 Consumer Crash Sebelum Processing

Skenario:

```text
poll returns records
consumer crashes before processing
no offset commit
```

Outcome:

- Partition akan diambil consumer lain.
- Record akan dibaca ulang dari committed offset terakhir.
- Tidak ada side effect yang terjadi.
- Aman, kecuali processing sebelumnya partial.

Ini biasanya bukan masalah besar.

### 7.2 Consumer Crash Setelah Processing tetapi Sebelum Commit

Skenario:

```text
poll record offset 100
write to database succeeds
process crashes before commit offset 101
```

Outcome:

- Consumer baru mulai dari offset terakhir yang committed.
- Offset 100 diproses ulang.
- Database write bisa duplicate jika tidak idempotent.

Ini adalah sumber duplicate paling umum.

Rule:

```text
At-least-once means your side effect must tolerate replay.
```

Solusi:

1. Idempotency key.
2. Unique constraint berdasarkan `event_id`.
3. Upsert berbasis business key dan version.
4. Inbox table.
5. Processed event table.
6. Transactional side effect + offset tracking di database.

### 7.3 Consumer Commit Sebelum Processing

Skenario:

```text
poll record offset 100
commit offset 101
process crashes before DB write
```

Outcome:

- Kafka menganggap record sudah selesai.
- Consumer tidak akan membaca ulang offset 100 secara normal.
- Side effect hilang.

Ini adalah at-most-once.

Kadang cocok untuk telemetry low-value, tetapi tidak cocok untuk enforcement lifecycle, audit, billing, atau workflow state transition.

Rule:

```text
Commit before durable side effect means possible data loss.
```

### 7.4 Consumer Lambat tetapi Heartbeat Masih Hidup

Consumer bisa tetap menjadi member group tetapi tertinggal jauh karena processing lambat.

Penyebab:

- Downstream database lambat.
- Batch terlalu besar.
- Per-record HTTP call.
- Lock contention.
- Poison event retry inline.
- GC pressure.
- Thread pool saturated.

Dampak:

- Consumer lag naik.
- Retention risk meningkat.
- SLA event-time processing gagal.
- Downstream projection stale.

Solusi:

- Batch processing terkontrol.
- Pause/resume.
- Async bounded concurrency.
- Circuit breaker untuk downstream.
- DLQ untuk poison event.
- Scale partition/consumer jika bottleneck bukan downstream shared resource.

### 7.5 Consumer GC Pause atau Stop-the-World Pause

Skenario:

```text
consumer owns partition-0
long GC pause > session.timeout.ms
broker coordinator considers it dead
partition-0 assigned to consumer B
consumer A resumes and still thinks it can write
```

Jika aplikasi tidak dirancang dengan fencing/idempotency, consumer A dan B dapat melakukan side effect overlapping.

Kafka group protocol akan mencegah A terus fetch setelah sadar assignment berubah, tetapi side effect yang sedang berjalan di thread aplikasi tidak otomatis dibatalkan.

Rule:

```text
Partition ownership does not automatically fence external side effects.
```

Solusi:

1. Per-record idempotency.
2. Cancellation-aware processing.
3. Check assignment before committing long-running result.
4. Avoid long blocking operations in poll thread.
5. Use bounded worker pool and pause/resume.
6. Use static membership untuk mengurangi rebalance karena restart singkat, tetapi jangan mengandalkannya sebagai correctness mechanism.

---

## 8. Rebalancing Failure Modes

Rebalance adalah perpindahan partition ownership antar consumer dalam group.

Trigger umum:

- Consumer join.
- Consumer leave.
- Consumer crash.
- Session timeout.
- `max.poll.interval.ms` exceeded.
- Topic partition count berubah.
- Rolling deployment.
- Coordinator change.

### 8.1 Duplicate During Rebalance

Skenario:

```text
consumer A polls offset 100-199
processes 100-150
rebalance starts
A loses partition before committing 151
consumer B starts from committed offset 100
records 100-150 reprocessed
```

Ini normal dalam at-least-once design.

Solusi bukan “hilangkan duplicate”, tetapi:

```text
make duplicate harmless
```

### 8.2 Stop-the-World Rebalance

Pada eager rebalancing, consumer dapat revoke semua partition, lalu group melakukan assignment ulang. Ini menyebabkan pause processing.

Dampak:

- Latency spike.
- Lag naik.
- Retry timeout downstream.
- Deploy memperparah backlog.

Cooperative rebalancing mengurangi dampak dengan incremental partition movement, tetapi tidak menghilangkan kebutuhan idempotency.

### 8.3 Rolling Deploy Storm

Skenario buruk:

```text
10 consumer pods
rolling deploy restarts one by one
setiap restart trigger rebalance
processing pause berulang
lag naik
autoscaler menambah pod
tambahan pod trigger rebalance lagi
lag makin naik
```

Ini disebut self-amplifying failure.

Mitigasi:

1. Cooperative sticky assignor.
2. Static membership bila cocok.
3. Deployment pacing.
4. Graceful shutdown.
5. Avoid aggressive autoscaling on lag alone.
6. Scale berdasarkan lag slope + processing rate + downstream health.

### 8.4 Rebalance Commit Race

Skenario:

```text
consumer A processes records
rebalance revokes partition
consumer B takes ownership
consumer A tries async commit late
```

Risiko:

- Commit dari owner lama menimpa asumsi owner baru.
- Offset tracking menjadi sulit dipahami.

Mitigasi:

- Commit offset saat partition revoked dengan hati-hati.
- Hindari async commit tanpa callback/error handling untuk critical workload.
- Gunakan `ConsumerRebalanceListener` untuk cleanup.
- Pastikan processing berhenti sebelum partition benar-benar dilepas.

---

## 9. Data Loss Scenarios

Data loss dapat terjadi di beberapa layer.

### 9.1 Producer-Side Data Loss

Contoh:

```java
producer.send(record);
// application exits immediately
```

Jika aplikasi tidak flush/close dengan benar, record masih bisa berada di buffer producer.

Rule:

```text
Producer close/flush is part of durability at application boundary.
```

### 9.2 Broker-Side Data Loss

Konfigurasi rentan:

```properties
acks=1
replication.factor=1
```

atau:

```properties
acks=1
replication.factor=3
```

ketika leader crash sebelum replica sync.

Mitigasi:

```properties
acks=all
min.insync.replicas=2
replication.factor=3
enable.idempotence=true
```

Tetap perlu monitoring:

- ISR shrink.
- Under-replicated partitions.
- Offline partitions.
- Produce error rate.
- Request latency.

### 9.3 Consumer-Side Data Loss

Commit sebelum processing:

```text
commit offset -> crash -> side effect never happened
```

Mitigasi:

- Process before commit.
- Use idempotent side effect.
- Store offset with side effect transaction if needed.

### 9.4 Retention-Induced Data Loss

Kafka retention menghapus data sesuai kebijakan. Jika consumer tertinggal lebih lama dari retention, event lama hilang sebelum diproses.

Contoh:

```properties
retention.ms=86400000 # 1 day
consumer outage=3 days
```

Outcome:

- Consumer tidak bisa replay dari offset lama.
- OffsetOutOfRange.
- Data hilang dari perspektif aplikasi.

Mitigasi:

1. Retention disesuaikan dengan RTO/RPO dan recovery window.
2. Monitor lag by time, bukan hanya lag by offset.
3. Mirror/archive critical topics ke object storage jika perlu.
4. Buat backfill strategy.

### 9.5 DLQ Data Loss

DLQ sering dianggap solusi, padahal DLQ sendiri adalah sistem data critical.

Data loss DLQ bisa terjadi jika:

- DLQ topic retention terlalu pendek.
- DLQ tidak punya owner.
- DLQ tidak dimonitor.
- DLQ event tidak menyimpan error context.
- DLQ reprocessor tidak ada.

Rule:

```text
DLQ without replay process is just delayed data loss.
```

---

## 10. Duplication Scenarios

Duplicate adalah normal dalam distributed system. Goal bukan menghapus seluruh duplicate, tetapi membuat duplicate tidak merusak state.

### 10.1 Duplicate from Producer Retry

Unknown write outcome + retry dapat menghasilkan duplicate jika idempotence tidak efektif atau event-level idempotency tidak ada.

Mitigasi:

- Enable idempotence.
- Stable key.
- Event ID unik.
- Consumer-side dedup.

### 10.2 Duplicate from Consumer Crash

Consumer memproses side effect lalu crash sebelum commit.

Mitigasi:

- Idempotent sink.
- Transactional write + processed event table.
- Upsert with version.

### 10.3 Duplicate from Rebalance

Partition dipindah sebelum offset commit terbaru.

Mitigasi sama: idempotency.

### 10.4 Duplicate from Replay

Replay adalah fitur, bukan bug. Tetapi replay akan menduplikasi side effect jika consumer tidak replay-aware.

Pisahkan consumer:

```text
projection consumer: replay safe
notification consumer: replay dangerous unless guarded
external side effect consumer: needs dedup/fencing
```

Untuk email/SMS/webhook/payment, replay harus sangat hati-hati.

---

## 11. Reordering Scenarios

Kafka hanya menjamin ordering per partition.

### 11.1 Wrong Key

Jika event untuk aggregate yang sama memakai key berbeda:

```text
CaseOpened key=case-123
CaseAssigned key=user-88
CaseClosed key=case-123
```

Consumer bisa melihat urutan yang salah untuk lifecycle case.

Rule:

```text
Ordering domain must be encoded in the Kafka key.
```

### 11.2 Partition Count Increase

Jika partition count topic ditambah, mapping key ke partition dapat berubah untuk record baru.

Dampak:

- Ordering per key historis bisa terganggu jika key yang sama mulai masuk partition baru.
- Ini bergantung partitioner dan hashing behavior.

Rule:

```text
Increasing partitions is not a free scaling operation for keyed ordered streams.
```

### 11.3 Multiple Producers for Same Key

Jika beberapa producer menghasilkan event untuk aggregate yang sama tanpa single source of sequencing, ordering bisnis bisa rusak.

Contoh:

```text
service A emits CaseEscalated(case-1)
service B emits CaseClosed(case-1)
```

Kafka akan mengurutkan berdasarkan arrival pada partition, bukan berdasarkan causal truth bisnis.

Mitigasi:

- Single writer principle per aggregate.
- Version number.
- Event timestamp tidak cukup untuk ordering correctness.
- Consumer reject stale version.
- Process manager/orchestrator jika lifecycle harus dikendalikan.

### 11.4 Retry/Timeout Reordering

Producer retry dengan in-flight request dapat mengubah urutan jika idempotence/ordering config tidak aman.

Mitigasi:

- Idempotent producer.
- Safe `max.in.flight.requests.per.connection`.
- Avoid disabling idempotence.
- Use sequence/version at domain layer.

---

## 12. Lag Explosion

Lag explosion terjadi ketika backlog tumbuh secara tidak terkendali.

Formula sederhana:

```text
lag growth rate = input rate - processing rate
```

Jika input rate 50k records/s dan consumer hanya memproses 20k records/s:

```text
lag grows by 30k records/s
```

Dalam 1 jam:

```text
108 million records backlog
```

### 12.1 Penyebab Lag Explosion

1. Downstream database lambat.
2. Consumer CPU saturated.
3. Network issue.
4. Broker fetch latency tinggi.
5. Rebalance storm.
6. Poison event retry inline.
7. Large message.
8. Bad batch size.
9. Partition skew.
10. Hot key.
11. Sink quota/throttle.
12. Schema Registry latency/deserialization failure.

### 12.2 Lag by Offset vs Lag by Time

Lag offset:

```text
latest offset - committed offset
```

Lag time:

```text
now - timestamp of oldest unprocessed event
```

Untuk SLA bisnis, lag time sering lebih penting.

Contoh:

```text
10,000 records lag on low-volume critical topic = 3 days behind
1,000,000 records lag on high-volume telemetry topic = 2 minutes behind
```

### 12.3 Lag Explosion Feedback Loop

Skenario:

```text
downstream DB slow
consumer processing slows
lag rises
autoscaler adds consumers
more consumers increase DB pressure
DB gets slower
lag rises faster
```

Solusi bukan selalu scale out consumer. Kadang solusi adalah:

- throttle input,
- protect downstream,
- pause consumer,
- shed non-critical workload,
- fix hot query,
- batch writes,
- split topic/consumer by priority.

### 12.4 Lag and Retention Deadline

Jika retention 7 hari dan lag time 6 hari, kamu sedang mendekati data loss.

Alert yang benar:

```text
lag_time / retention_window > threshold
```

Contoh:

```text
if lag_time > 70% of retention_window => page
```

---

## 13. Poison Event Failure Model

Poison event adalah record yang selalu gagal diproses.

Contoh:

- Schema invalid.
- Required field missing.
- Enum tidak dikenal.
- Data melanggar invariant.
- Downstream menolak payload.
- Bug consumer untuk kombinasi field tertentu.

### 13.1 Poison Event Without DLQ

Skenario:

```text
consumer reads offset 100
processing fails
consumer retries forever
offset never advances
lag grows forever
```

Ini mengubah satu event buruk menjadi outage seluruh partition.

### 13.2 Poison Event With Bad DLQ

Skenario:

```text
consumer fails
sends to DLQ
commits offset
DLQ not monitored
business event never repaired
```

Ini mengubah outage menjadi silent data loss.

### 13.3 Good Poison Event Strategy

Untuk setiap poison event, simpan:

```text
original topic
partition
offset
key
headers
payload
schema id/version
exception class
exception message
stack trace hash
consumer name/version
processing timestamp
correlation id
causation id
tenant id
retry count
```

DLQ harus punya:

1. Owner.
2. Alert.
3. Dashboard.
4. Retention cukup panjang.
5. Reprocessing tool.
6. Triage classification.
7. Audit trail repair.

Rule:

```text
DLQ is not a trash bin. DLQ is a repair queue.
```

---

## 14. Split Brain Thinking

Kafka sendiri menggunakan coordination protocol untuk menghindari dua leader valid untuk partition yang sama dalam kondisi normal. Tetapi aplikasi di sekitar Kafka bisa mengalami “split brain secara semantik”.

### 14.1 Consumer Split Brain Semantics

Consumer A kehilangan ownership karena pause, tetapi masih menjalankan side effect lama. Consumer B sudah mengambil partition dan memproses event yang sama.

Dari perspektif Kafka, ownership sudah jelas. Dari perspektif side effect eksternal, dua actor bisa menulis.

Mitigasi:

- Idempotency key.
- Fencing token.
- Optimistic locking.
- Versioned aggregate update.
- Write condition: only update if current_version < event_version.

### 14.2 Workflow Split Brain

Dalam event-driven workflow, dua service bisa mengeluarkan event state transition yang konflik.

Contoh:

```text
CaseClosed
CaseEscalated
```

untuk case yang sama hampir bersamaan.

Kafka akan mengurutkan event jika key sama, tetapi Kafka tidak tahu mana transisi yang valid secara domain.

Mitigasi:

- State machine invariant.
- Single writer for lifecycle transition.
- Process manager.
- Versioned commands.
- Reject invalid transition.
- Emit correction/rejection event.

### 14.3 Multi-Region Split Brain

Active-active multi-region dapat menghasilkan event konflik untuk key yang sama dari dua region.

Contoh:

```text
region-a emits CaseAssigned(case-1, officer-A)
region-b emits CaseAssigned(case-1, officer-B)
```

Kafka replication tidak otomatis menyelesaikan konflik semantik.

Mitigasi:

- Region ownership per key/tenant.
- Conflict resolution policy.
- Global sequence authority.
- Single active writer for critical workflow.
- Active-passive untuk state transition sensitif.

---

## 15. Recovery Patterns

### 15.1 Replay

Replay berarti membaca ulang event dari offset lama atau dari topic source untuk membangun ulang state.

Replay cocok untuk:

- read model projection,
- cache rebuild,
- search index rebuild,
- analytical sink,
- audit reconstruction,
- Kafka Streams state restoration.

Replay berbahaya untuk:

- email,
- SMS,
- webhook,
- payment,
- irreversible external API,
- legal notice dispatch,
- anything human-visible.

Rule:

```text
Every consumer must declare whether it is replay-safe.
```

### 15.2 Reset Offset

Reset offset adalah operasi besar.

Pertanyaan sebelum reset:

1. Consumer ini idempotent?
2. Side effect sudah pernah terjadi?
3. Ada dedup key?
4. Apakah replay akan mengirim notifikasi ulang?
5. Apakah downstream bisa menerima update ulang?
6. Apakah schema lama masih bisa dibaca?
7. Apakah retention masih menyimpan event yang dibutuhkan?
8. Apakah ada snapshot untuk mempercepat rebuild?

### 15.3 Reprocess DLQ

DLQ reprocessing bukan sekadar produce ulang payload.

Harus jelas:

1. Error sudah diperbaiki di code/config/data?
2. Event asli masih valid secara domain?
3. Reprocess ke topic asal atau repair topic?
4. Offset original dipakai untuk audit?
5. Bagaimana mencegah duplicate side effect?
6. Bagaimana mencatat repair decision?

### 15.4 Backfill

Backfill adalah menghasilkan atau mengirim ulang historical data.

Risiko:

- Mengganggu consumer real-time.
- Membanjiri broker.
- Mengubah ordering dengan event baru.
- Mengaktifkan side effect lama.
- Schema lama tidak kompatibel.

Pattern:

```text
separate backfill topic
or
same topic with event metadata: source=backfill, backfill_id=...
```

Consumer harus tahu apakah backfill boleh memicu side effect.

---

## 16. Failure Matrix Template

Gunakan template ini untuk design review Kafka.

| Failure | Detection | Expected Behavior | Data Risk | Recovery | Owner |
|---|---|---|---|---|---|
| Producer timeout | Producer error metric/log | Retry idempotently | Duplicate if unsafe | Retry with same event_id | App team |
| Broker leader crash | Controller/broker metrics | New leader elected | Possible loss if weak config | Verify ISR, replay | Platform |
| ISR below min | Under-replicated/produce errors | Reject writes | No loss, lower availability | Restore broker/replica | Platform |
| Consumer crash after DB write before commit | App logs + duplicate key | Reprocess safely | Duplicate side effect risk | Idempotent write | App team |
| Rebalance storm | Rebalance metric + lag spike | Slow but safe processing | Duplicate risk | Stabilize deployment/group | App/platform |
| Poison event | Consumer error + DLQ | Move to DLQ after bounded retry | Business event delayed | Repair/reprocess | App/domain |
| Lag near retention | Lag time alert | Page before data expires | Data loss if ignored | Scale/fix/replay/backfill | App/platform |
| Schema breaking change | Schema registry/consumer errors | Reject or DLQ | Semantic/data loss | Rollback schema/consumer | Producer owner |

---

## 17. Java Consumer Failure-Safe Skeleton

Contoh berikut bukan framework final, tetapi skeleton mental model.

```java
public final class FailureAwareConsumer implements AutoCloseable {
    private final KafkaConsumer<String, CaseEvent> consumer;
    private final CaseEventHandler handler;
    private volatile boolean running = true;

    public void run() {
        try {
            consumer.subscribe(List.of("case.lifecycle.events"));

            while (running) {
                ConsumerRecords<String, CaseEvent> records = consumer.poll(Duration.ofMillis(500));

                for (ConsumerRecord<String, CaseEvent> record : records) {
                    try {
                        // Must be idempotent at domain/storage boundary.
                        handler.handle(record.key(), record.value(), metadata(record));

                        // Commit after durable side effect.
                        consumer.commitSync(Map.of(
                            new TopicPartition(record.topic(), record.partition()),
                            new OffsetAndMetadata(record.offset() + 1)
                        ));
                    } catch (NonRetryablePoisonEventException e) {
                        handler.publishToDlq(record, e);

                        // Commit only after DLQ write is durable.
                        consumer.commitSync(Map.of(
                            new TopicPartition(record.topic(), record.partition()),
                            new OffsetAndMetadata(record.offset() + 1)
                        ));
                    } catch (RetryableDownstreamException e) {
                        // Do not commit; allow retry after backoff.
                        // But avoid tight loop.
                        sleepBackoff();
                        break;
                    }
                }
            }
        } finally {
            consumer.close(Duration.ofSeconds(10));
        }
    }

    private EventMetadata metadata(ConsumerRecord<String, CaseEvent> record) {
        return new EventMetadata(
            record.topic(),
            record.partition(),
            record.offset(),
            record.timestamp(),
            header(record, "event_id"),
            header(record, "correlation_id"),
            header(record, "causation_id")
        );
    }

    private String header(ConsumerRecord<String, CaseEvent> record, String name) {
        Header header = record.headers().lastHeader(name);
        return header == null ? null : new String(header.value(), StandardCharsets.UTF_8);
    }

    private void sleepBackoff() {
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            running = false;
        }
    }

    @Override
    public void close() {
        running = false;
        consumer.wakeup();
    }
}
```

Catatan penting:

1. Commit setelah side effect durable.
2. DLQ write harus durable sebelum commit.
3. Retryable error tidak langsung commit.
4. Handler harus idempotent.
5. Untuk throughput tinggi, commit per record terlalu mahal; gunakan batch/partition-level tracking, tetapi invariant sama.

---

## 18. Idempotent Consumer Pattern

### 18.1 Processed Event Table

Skema sederhana:

```sql
CREATE TABLE processed_event (
    event_id        VARCHAR(100) PRIMARY KEY,
    topic           VARCHAR(255) NOT NULL,
    partition_no    INT NOT NULL,
    offset_no       BIGINT NOT NULL,
    processed_at    TIMESTAMP NOT NULL,
    consumer_name   VARCHAR(255) NOT NULL
);
```

Processing:

```text
begin transaction
  insert into processed_event(event_id, ...) values (...)
  if duplicate key -> already processed -> skip safely
  apply business side effect
commit transaction
commit Kafka offset
```

Jika crash setelah DB commit sebelum Kafka commit, event akan dibaca ulang, insert `processed_event` gagal karena duplicate, consumer skip, lalu commit offset. Aman.

### 18.2 Versioned Aggregate Update

Untuk event yang membawa aggregate version:

```sql
UPDATE case_projection
SET status = ?, version = ?
WHERE case_id = ?
  AND version < ?;
```

Jika event lama direplay, update tidak berdampak.

### 18.3 Natural Idempotency

Beberapa operasi natural idempotent:

```text
set case status to CLOSED at version 7
upsert projection row by case_id
replace cache value by key
index document by deterministic id
```

Operasi tidak idempotent:

```text
insert ledger row without unique key
send email
call payment capture
append audit row without event_id uniqueness
increment counter blindly
```

---

## 19. Failure Invariants untuk Regulatory / Case Management Platform

Untuk sistem enforcement lifecycle, gunakan invariant seperti ini.

### 19.1 Audit Invariant

```text
Every externally visible decision must have a durable audit event.
```

Konsekuensi:

- Tidak boleh commit offset sebelum audit write durable.
- Audit event harus punya event_id dan causation_id.
- Correction harus berupa event baru, bukan mutasi diam-diam.

### 19.2 State Transition Invariant

```text
A case can transition only through valid state machine edges.
```

Contoh invalid:

```text
DRAFT -> CLOSED
APPEALED -> ASSIGNED
CLOSED -> ESCALATED
```

Consumer/projection tidak boleh menerima event hanya karena event ada di Kafka. Kafka menyimpan fakta teknis; domain tetap harus memvalidasi transisi.

### 19.3 Notification Invariant

```text
A legal notice must not be sent twice for the same notice_id.
```

Konsekuensi:

- Email/SMS/webhook consumer wajib punya dedup key.
- Replay tidak boleh otomatis mengirim ulang.
- Harus ada `NotificationRequested` dan `NotificationSent` event dengan correlation.

### 19.4 SLA Invariant

```text
Escalation must be evaluated using event time, not processing time alone.
```

Jika lag 2 jam, processing time dapat menyesatkan. SLA harus menggunakan event timestamp/domain timestamp.

### 19.5 Evidence Invariant

```text
Evidence metadata event must not claim evidence is available until object storage write is durable.
```

Kafka event yang menunjuk object eksternal harus mengikuti ordering side effect yang aman.

---

## 20. Anti-Patterns

### Anti-Pattern 1 — “Kafka Exactly-Once Jadi Tidak Perlu Idempotency”

Salah. Exactly-once Kafka tidak otomatis membuat external side effect exactly-once.

### Anti-Pattern 2 — Commit Offset Terlalu Awal

Commit sebelum side effect berarti data loss ketika crash.

### Anti-Pattern 3 — Retry Forever di Partition Utama

Satu poison event bisa menghentikan seluruh partition.

### Anti-Pattern 4 — DLQ Tanpa Owner

DLQ tanpa ownership adalah silent failure.

### Anti-Pattern 5 — Autoscale Consumer Hanya Berdasarkan Lag

Lag naik belum tentu consumer kurang. Bisa jadi downstream bottleneck. Menambah consumer bisa memperparah.

### Anti-Pattern 6 — Menganggap Timestamp sebagai Ordering Guarantee

Timestamp membantu reasoning, tetapi Kafka ordering ditentukan partition log order. Domain ordering perlu version/sequence.

### Anti-Pattern 7 — Tidak Menguji Rebalance

Banyak bug Kafka hanya muncul saat deploy, crash, atau rebalance.

### Anti-Pattern 8 — Retention Lebih Pendek dari Recovery Window

Jika RTO/RPO butuh replay 7 hari tetapi retention 24 jam, desainnya kontradiktif.

### Anti-Pattern 9 — Mengabaikan Internal Topics

Kafka Connect internal topics, Kafka Streams changelog/repartition topics, dan consumer offsets adalah state critical.

### Anti-Pattern 10 — Menganggap “Message Ada di Kafka” Sama Dengan “Bisnis Selesai”

Kafka menyimpan event. Bisnis selesai hanya jika seluruh invariant downstream terpenuhi.

---

## 21. Production Readiness Checklist

### Producer

- [ ] `acks=all` untuk event critical.
- [ ] `enable.idempotence=true` atau tidak dinonaktifkan oleh config konflik.
- [ ] `retries` dan timeout dipahami sebagai unknown outcome handling.
- [ ] Event punya stable `event_id`.
- [ ] Key sesuai ordering domain.
- [ ] Producer flush/close saat shutdown.
- [ ] Callback error tidak diabaikan.

### Broker / Topic

- [ ] `replication.factor >= 3` untuk critical topics.
- [ ] `min.insync.replicas >= 2` untuk critical topics.
- [ ] Unclean leader election policy dipahami dan sesuai risk appetite.
- [ ] Retention sesuai replay/recovery window.
- [ ] DLQ topic retention cukup panjang.
- [ ] Under-replicated/offline partitions dimonitor.
- [ ] Disk capacity alert berbasis trend.

### Consumer

- [ ] Commit setelah durable side effect.
- [ ] Processing idempotent.
- [ ] Duplicate event test tersedia.
- [ ] Rebalance test tersedia.
- [ ] Poison event masuk DLQ setelah bounded retry.
- [ ] DLQ punya owner dan reprocessor.
- [ ] Lag by time dimonitor.
- [ ] Graceful shutdown diimplementasikan.

### Schema / Semantic

- [ ] Schema compatibility policy aktif.
- [ ] Breaking change dicegah di pipeline.
- [ ] Event versioning jelas.
- [ ] Consumer punya strategy untuk unknown enum/field.
- [ ] Event name tidak generik berlebihan.

### Recovery

- [ ] Replay plan documented.
- [ ] Offset reset procedure documented.
- [ ] Backfill strategy documented.
- [ ] DLQ repair workflow documented.
- [ ] Critical workflows punya audit reconstruction plan.

---

## 22. Latihan / Thought Exercises

### Latihan 1 — Producer Unknown Outcome

Aplikasi mengirim `CaseDecisionApproved` lalu producer timeout. Apakah aplikasi harus retry? Jika retry, bagaimana mencegah duplicate audit decision?

Jawab dengan:

1. event_id strategy,
2. producer config,
3. consumer idempotency,
4. audit invariant.

### Latihan 2 — Consumer Crash

Consumer memproses event dan berhasil menulis ke database, lalu crash sebelum commit offset. Apa yang terjadi setelah restart? Desain tabel idempotency untuk mencegah duplicate side effect.

### Latihan 3 — Lag Near Retention

Topic retention 3 hari. Consumer lag time 2 hari 12 jam dan terus naik. Apa alert yang seharusnya sudah menyala? Apa tindakan recovery yang aman?

### Latihan 4 — Poison Event

Satu event dengan enum baru membuat consumer lama gagal deserialize. Apa yang terjadi jika retry inline tanpa DLQ? Apa desain DLQ yang benar?

### Latihan 5 — Rebalance During Deploy

Rolling deploy 20 pod consumer menyebabkan lag spike besar. Buat mitigation plan yang mencakup assignor, static membership, graceful shutdown, deployment pacing, dan autoscaling policy.

### Latihan 6 — Regulatory Notice Duplicate

Consumer mengirim legal notice berdasarkan event `NoticeRequested`. Consumer crash setelah email gateway sukses tetapi sebelum offset commit. Bagaimana mencegah notice terkirim dua kali?

---

## 23. Ringkasan

Failure modelling Kafka harus dimulai dari pipeline lengkap:

```text
producer -> broker -> replica -> consumer -> processing -> offset commit -> external side effect
```

Setiap titik punya failure mode berbeda.

Prinsip utama:

1. Timeout berarti unknown, bukan failed.
2. Ack guarantee bergantung pada `acks`, ISR, replication factor, dan `min.insync.replicas`.
3. At-least-once berarti duplicate harus dianggap normal.
4. Commit sebelum side effect durable berarti data loss risk.
5. Commit setelah side effect durable berarti duplicate risk, sehingga perlu idempotency.
6. Ordering hanya kuat di partition, dan partition dipilih oleh key.
7. Rebalance adalah normal, bukan exception.
8. Poison event tanpa DLQ dapat menghentikan partition.
9. DLQ tanpa owner adalah silent data loss.
10. Lag harus dibaca terhadap time dan retention, bukan offset saja.
11. Exactly-once Kafka tidak otomatis menyelesaikan external side effect.
12. Recovery harus didesain sebelum incident, bukan saat incident.

Kafka yang production-grade bukan Kafka yang tidak pernah gagal. Kafka yang production-grade adalah Kafka yang ketika gagal:

```text
terdeteksi cepat,
dibatasi dampaknya,
tidak merusak invariant bisnis,
bisa direplay atau diperbaiki,
dan meninggalkan audit trail yang bisa dipertanggungjawabkan.
```

---

## 24. Referensi

Referensi utama untuk part ini:

1. Apache Kafka Documentation — konsep Kafka sebagai distributed system, producer, consumer, replication, configuration, dan monitoring.
2. Apache Kafka Producer Configuration — `acks`, idempotence, retries, delivery timeout, in-flight request behavior.
3. Apache Kafka Consumer Configuration — offset, polling, heartbeat, session timeout, `max.poll.interval.ms`, group behavior.
4. Apache Kafka Operations / Monitoring — JMX metrics, broker/client metrics, under-replicated/offline partitions.
5. Confluent Documentation — Kafka message delivery guarantees, consumer offset behavior, exactly-once semantics, and production operational guidance.
6. Confluent Kafka Consumer Documentation — committed offset behavior when consumers crash or partitions are reassigned.
7. Prior parts in this series: Part 004, 006, 007, 008, 011, 024, and 025.

---

## 25. Penutup

Part 026 menyelesaikan blok production failure modelling. Setelah ini kita naik satu level: dari mekanik Kafka dan failure semantics menuju **arsitektur event-driven**.

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-027.md
```

Judul:

```text
Event-Driven Architecture with Kafka: Choreography, Orchestration, Sagas, and Workflow Boundaries
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Performance Engineering: Throughput, Latency, Batching, Compression, Partitions, and Quotas</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-027.md">Part 027 — Event-Driven Architecture with Kafka: Choreography, Orchestration, Sagas, and Workflow Boundaries ➡️</a>
</div>

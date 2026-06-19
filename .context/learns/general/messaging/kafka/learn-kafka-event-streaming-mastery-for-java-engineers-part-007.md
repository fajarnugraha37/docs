# learn-kafka-event-streaming-mastery-for-java-engineers-part-007.md

# Part 007 — Consumer Groups and Rebalancing: Assignment, Ownership, and Failure Modes

> Seri: **Kafka Event Streaming Mastery for Java Engineers**  
> Bagian: **007 dari 034**  
> Status seri: **Belum selesai**  
> Fokus: memahami consumer group sebagai protokol distributed ownership, bukan sekadar “beberapa consumer membaca topic yang sama”.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan **consumer group** sebagai mekanisme distribusi ownership partition.
2. Membedakan **topic partition**, **consumer instance**, **consumer group**, **group coordinator**, dan **assignment strategy**.
3. Memahami mengapa Kafka hanya memberi parallelism sampai batas jumlah partition.
4. Menjelaskan bagaimana **rebalance** terjadi ketika consumer join, leave, crash, timeout, deploy, atau topic partition berubah.
5. Membedakan **eager rebalancing** dan **cooperative/incremental rebalancing**.
6. Memahami kapan memakai **RangeAssignor**, **RoundRobinAssignor**, **StickyAssignor**, dan **CooperativeStickyAssignor**.
7. Memahami fungsi **static membership** melalui `group.instance.id`.
8. Memprediksi failure mode seperti:
   - duplicate processing,
   - stop-the-world pause,
   - rebalance storm,
   - commit race,
   - zombie consumer,
   - slow consumer,
   - partition starvation,
   - deploy-induced lag spike.
9. Mendesain consumer group yang aman untuk workload Java production.
10. Membuat checklist operasional untuk mengurangi insiden akibat rebalancing.

---

## 2. Mental Model Utama

Consumer group adalah **distributed partition ownership protocol**.

Kafka topic bisa memiliki banyak partition. Consumer group adalah sekumpulan consumer yang bekerja sama membaca topic tersebut. Di dalam satu consumer group, **satu partition hanya boleh dimiliki oleh satu consumer aktif pada satu waktu**.

Artinya:

```text
Topic: case-events
Partitions: P0 P1 P2 P3

Consumer Group: enforcement-projection-service

Consumer A owns: P0, P1
Consumer B owns: P2
Consumer C owns: P3
```

Consumer A, B, dan C adalah bagian dari aplikasi logis yang sama. Mereka membagi pekerjaan berdasarkan partition.

Mental model yang benar:

```text
Kafka tidak membagi record langsung ke consumer.
Kafka membagi partition ke consumer.
Consumer membaca record dari partition yang ia miliki.
```

Kalimat ini penting.

Banyak engineer berpikir:

```text
"Kalau saya punya 10 consumer, Kafka akan otomatis membagi 10 consumer itu untuk semua message."
```

Lebih tepat:

```text
"Kalau saya punya N partition dan M consumer dalam group yang sama, Kafka akan meng-assign partition kepada consumer.
Satu partition hanya bisa diproses oleh satu consumer dalam group tersebut pada satu waktu.
Parallelism efektif dibatasi oleh jumlah partition."
```

Jika topic hanya punya 3 partition, lalu kamu menjalankan 10 consumer dalam consumer group yang sama, maksimum hanya 3 consumer yang aktif memproses partition. Sisanya idle.

```text
3 partitions + 10 consumers
= maksimal 3 consumers aktif
= 7 consumers idle
```

---

## 3. Problem yang Diselesaikan Consumer Group

Bayangkan satu service membaca event `case-events`.

Jika hanya satu consumer:

```text
case-events P0 -> Consumer A
case-events P1 -> Consumer A
case-events P2 -> Consumer A
case-events P3 -> Consumer A
```

Semua pekerjaan masuk ke satu process. Throughput terbatas.

Dengan consumer group:

```text
case-events P0 -> Consumer A
case-events P1 -> Consumer B
case-events P2 -> Consumer C
case-events P3 -> Consumer D
```

Kafka memberi:

1. **Horizontal scalability**  
   Tambah consumer untuk memproses lebih banyak partition secara paralel.

2. **Fault tolerance**  
   Jika satu consumer mati, partition yang sebelumnya dimiliki consumer itu akan dipindahkan ke consumer lain.

3. **Load distribution**  
   Partition dibagi antar consumer dalam group.

4. **Independent application consumption**  
   Consumer group berbeda bisa membaca topic yang sama secara independen.

Contoh:

```text
Topic: case-events

Group A: enforcement-projection-service
Group B: audit-indexer-service
Group C: sla-escalation-service
Group D: notification-service
```

Semua group membaca topic yang sama, tetapi offset masing-masing group independen.

```text
case-events:
  P0: offset 0..100000
  P1: offset 0..95000

Group enforcement-projection-service:
  P0 committed offset 90000
  P1 committed offset 91000

Group audit-indexer-service:
  P0 committed offset 100000
  P1 committed offset 95000

Group sla-escalation-service:
  P0 committed offset 70000
  P1 committed offset 72000
```

Satu consumer group lambat tidak otomatis membuat group lain lambat.

---

## 4. Istilah Inti

### 4.1 Consumer

Consumer adalah client Kafka yang membaca record dari topic partition.

Di Java:

```java
KafkaConsumer<String, CaseEvent> consumer = new KafkaConsumer<>(props);
consumer.subscribe(List.of("case-events"));
```

Consumer bisa menjadi bagian dari group jika memiliki:

```properties
group.id=enforcement-projection-service
```

Tanpa `group.id`, consumer tidak ikut group management normal dan biasanya memakai `assign()` manual.

---

### 4.2 Consumer Group

Consumer group adalah nama logis aplikasi pembaca stream.

```properties
group.id=enforcement-projection-service
```

Semua process consumer dengan `group.id` yang sama bekerja sama membagi partition.

```text
service instance 1: group.id=enforcement-projection-service
service instance 2: group.id=enforcement-projection-service
service instance 3: group.id=enforcement-projection-service
```

Mereka bukan tiga aplikasi berbeda. Mereka adalah satu aplikasi logis yang diskalakan horizontal.

---

### 4.3 Group Coordinator

Group coordinator adalah broker yang bertanggung jawab mengelola membership dan offset commit untuk consumer group tertentu.

Consumer group tidak dikoordinasikan oleh semua broker sekaligus. Ada broker yang menjadi coordinator untuk group.

Tugas group coordinator:

1. Menerima join group.
2. Menangani heartbeat.
3. Mendeteksi consumer mati atau timeout.
4. Memulai rebalance.
5. Menyimpan offset commit ke internal topic `__consumer_offsets`.
6. Menentukan lifecycle group.

Mental model:

```text
Consumer group = distributed team
Group coordinator = team coordinator
Partition assignor = algorithm pembagi tugas
```

---

### 4.4 Group Leader

Dalam proses rebalance, salah satu consumer menjadi group leader. Group leader menjalankan assignment strategy untuk menentukan partition mana diberikan ke consumer mana.

Jangan salah paham: group leader bukan leader data Kafka. Ia bukan partition leader broker. Ia hanya consumer yang bertugas menghitung assignment saat rebalance.

```text
Broker partition leader:
  Mengelola read/write partition di broker side.

Consumer group leader:
  Consumer member yang menghitung partition assignment untuk group.
```

---

### 4.5 Assignment

Assignment adalah hasil keputusan:

```text
Consumer A -> P0, P1
Consumer B -> P2
Consumer C -> P3
```

Assignment menentukan partition mana boleh dibaca consumer.

---

### 4.6 Rebalance

Rebalance adalah proses mengubah assignment partition antar consumer dalam satu group.

Rebalance terjadi ketika:

1. Consumer baru join.
2. Consumer leave secara normal.
3. Consumer crash.
4. Consumer gagal heartbeat.
5. Consumer terlalu lama tidak memanggil `poll()`.
6. Topic yang di-subscribe memiliki partition baru.
7. Subscription pattern berubah.
8. Coordinator berubah.
9. Deploy/rolling restart menyebabkan membership berubah.
10. Network pause membuat consumer tampak mati.
11. GC pause terlalu lama.
12. Autoscaler terlalu agresif menambah/mengurangi instance.

Rebalance adalah fitur penting, tetapi juga sumber latency dan duplicate processing.

---

## 5. Consumer Group vs Pub/Sub

Kafka sering disebut pub/sub, tetapi consumer group membuat modelnya lebih kaya.

Jika dua consumer memiliki **group.id yang sama**:

```text
Topic: case-events
Group: projection-service

Consumer A
Consumer B
```

Mereka membagi partition. Record pada satu partition hanya diproses oleh salah satu consumer dalam group.

Jika dua consumer memiliki **group.id berbeda**:

```text
Topic: case-events

Group: projection-service
Group: audit-service
```

Masing-masing group membaca record secara independen.

Contoh:

```text
Record R1 di case-events P0

projection-service membaca R1
audit-service juga membaca R1
notification-service juga membaca R1
```

Kafka memberikan kombinasi:

```text
queue-like semantics di dalam group
pub/sub-like semantics antar group
```

Ini mental model penting.

---

## 6. Parallelism Rule

Aturan dasar:

```text
Maximum active consumers in one group for one topic <= number of partitions subscribed.
```

Contoh:

```text
Topic case-events punya 6 partitions.

Jika group punya:
1 consumer  -> 1 consumer aktif, masing-masing consumer punya 6 partitions
2 consumers -> 2 consumer aktif, partition dibagi sekitar 3:3
3 consumers -> 3 consumer aktif, partition dibagi sekitar 2:2:2
6 consumers -> 6 consumer aktif, masing-masing 1 partition
10 consumers -> 6 aktif, 4 idle
```

Jika satu consumer subscribe banyak topic, assignment bisa lebih kompleks, tetapi prinsip umumnya tetap: unit distribusi adalah partition.

---

## 7. Why One Partition Cannot Be Processed by Two Consumers in Same Group

Karena Kafka menjaga ordering guarantee dalam partition.

Jika satu partition dibaca oleh dua consumer aktif dalam group yang sama, Kafka tidak bisa menjamin urutan processing.

Misal:

```text
Partition P0:
offset 10: CaseCreated(case-123)
offset 11: CaseAssigned(case-123)
offset 12: CaseEscalated(case-123)
```

Jika P0 diproses dua consumer:

```text
Consumer A proses offset 10
Consumer B proses offset 11
Consumer A lambat
Consumer B selesai dulu
```

Maka downstream bisa melihat `CaseAssigned` sebelum `CaseCreated`.

Kafka menghindari ini dengan memastikan:

```text
Dalam satu consumer group, satu partition hanya dimiliki satu consumer pada satu waktu.
```

---

## 8. Consumer Group Lifecycle

Secara konseptual, lifecycle consumer group:

```text
1. Consumer start
2. Consumer subscribe topic
3. Consumer menemukan coordinator
4. Consumer join group
5. Group coordinator memilih generation baru
6. Salah satu consumer menjadi group leader
7. Group leader menghitung assignment
8. Assignment dikirim ke semua consumer
9. Consumer mulai poll partition yang dimiliki
10. Consumer heartbeat secara berkala
11. Consumer commit offset
12. Jika membership berubah, rebalance terjadi
```

ASCII flow:

```text
Consumer A ---- FindCoordinator ----> Broker Coordinator
Consumer A ---- JoinGroup ---------> Coordinator
Consumer B ---- JoinGroup ---------> Coordinator
Consumer C ---- JoinGroup ---------> Coordinator

Coordinator selects group leader

Leader computes:
  A -> P0
  B -> P1
  C -> P2

Coordinator sends assignment

Consumers poll assigned partitions
```

---

## 9. Consumer Group Generation

Setiap rebalance menghasilkan **generation** baru.

Generation bisa dipahami sebagai versi assignment group.

```text
Generation 1:
  A -> P0, P1
  B -> P2, P3

Consumer C join

Generation 2:
  A -> P0
  B -> P1
  C -> P2, P3
```

Offset commit biasanya terkait dengan generation. Ini mencegah consumer lama melakukan commit setelah ia bukan lagi owner partition.

Namun, aplikasi masih bisa punya race jika tidak hati-hati, terutama jika processing asynchronous.

---

## 10. Assignment Strategies

Assignment strategy menentukan bagaimana partition dibagi ke consumer.

Konfigurasi:

```properties
partition.assignment.strategy=...
```

Di Kafka Java client, assignor umum:

1. `RangeAssignor`
2. `RoundRobinAssignor`
3. `StickyAssignor`
4. `CooperativeStickyAssignor`

---

## 11. RangeAssignor

Range assignor membagi partition per topic secara berurutan ke consumer.

Misal:

```text
Topic A: P0 P1 P2 P3
Consumers: C1 C2

Range:
  C1 -> A-P0, A-P1
  C2 -> A-P2, A-P3
```

Untuk satu topic, hasilnya mudah dipahami.

Namun untuk multi-topic subscription, RangeAssignor bisa menyebabkan imbalance.

Misal:

```text
Topic A: P0 P1
Topic B: P0 P1
Consumers: C1 C2

Range possible:
  C1 -> A-P0, B-P0
  C2 -> A-P1, B-P1
```

Atau dalam kondisi tertentu, consumer tertentu bisa mendapat lebih banyak partition dibanding lainnya tergantung jumlah topic, partition, dan subscription.

Kapan cocok:

1. Subscription sederhana.
2. Topic sedikit.
3. Kamu ingin pembagian range per topic.
4. Tidak ada state besar yang perlu dipertahankan antar rebalance.

Risiko:

1. Imbalance pada multi-topic.
2. Assignment bisa kurang optimal untuk workload heterogen.
3. Eager rebalance default lama bisa menyebabkan pause besar.

---

## 12. RoundRobinAssignor

RoundRobinAssignor menyusun semua topic-partition lalu membagikannya bergiliran ke consumer.

Contoh:

```text
Partitions:
A-P0, A-P1, A-P2, A-P3

Consumers:
C1, C2

RoundRobin:
C1 -> A-P0, A-P2
C2 -> A-P1, A-P3
```

Kapan cocok:

1. Banyak topic.
2. Ingin pembagian jumlah partition lebih merata.
3. Consumer memiliki subscription yang sama.

Risiko:

1. Assignment bisa berubah signifikan saat membership berubah.
2. Tidak sticky.
3. Bisa menyebabkan banyak partition berpindah pada rebalance.
4. Untuk stateful processing, perpindahan partition mahal.

---

## 13. StickyAssignor

StickyAssignor mencoba dua hal:

1. Assignment seimbang.
2. Mempertahankan sebanyak mungkin assignment lama.

Tujuan sticky:

```text
Kalau sebelumnya C1 memegang P0,
dan setelah rebalance C1 masih bisa memegang P0,
maka jangan pindahkan P0 tanpa alasan.
```

Ini penting karena perpindahan partition bisa mahal:

1. Local cache invalid.
2. State store perlu restore.
3. In-flight work dibatalkan.
4. Lag sementara naik.
5. External connection/resource warmed ulang.
6. Assignment churn membuat observability lebih noisy.

StickyAssignor cocok untuk:

1. Consumer dengan local cache.
2. Kafka Streams-like stateful workload.
3. Consumer yang mahal melakukan warmup.
4. Sistem yang ingin mengurangi assignment churn.

Namun StickyAssignor tradisional masih menggunakan eager rebalancing.

---

## 14. CooperativeStickyAssignor

CooperativeStickyAssignor adalah assignor modern yang menggabungkan stickiness dengan incremental cooperative rebalancing.

Dalam eager rebalance:

```text
Semua consumer revoke semua partition.
Group berhenti.
Assignment baru dihitung.
Semua consumer resume.
```

Dalam cooperative rebalance:

```text
Consumer hanya revoke partition yang benar-benar perlu dipindah.
Partition yang tetap dimiliki boleh terus diproses.
```

Perbedaan mental model:

```text
Eager:
  "Semua letakkan pekerjaan, kita bagi ulang dari nol."

Cooperative:
  "Tetap kerjakan bagianmu, hanya pindahkan bagian yang perlu dipindah."
```

Ini mengurangi stop-the-world pause.

Contoh:

Sebelum:

```text
C1 -> P0, P1
C2 -> P2, P3
```

C3 join.

Target:

```text
C1 -> P0
C2 -> P2
C3 -> P1, P3
```

Eager:

```text
C1 revoke P0, P1
C2 revoke P2, P3
Semua pause
Assignment baru
```

Cooperative:

```text
C1 tetap P0, revoke P1
C2 tetap P2, revoke P3
C3 dapat P1, P3 setelah revoked
```

Kapan cocok:

1. Hampir selalu untuk consumer modern.
2. Stateful consumer.
3. Rolling deployment.
4. Autoscaling.
5. Workload yang sensitif pada latency spike.
6. Kafka Streams / ksqlDB style workloads.

Catatan penting:

Untuk memakai cooperative protocol dengan aman, semua consumer dalam group harus kompatibel dengan assignor tersebut. Jangan mencampur strategi sembarangan pada satu group production.

---

## 15. Eager vs Cooperative Rebalancing

### 15.1 Eager Rebalancing

Eager rebalancing adalah model lama.

Karakteristik:

1. Semua partition dicabut dari semua consumer.
2. Semua consumer berhenti memproses sementara.
3. Assignment baru dibuat.
4. Semua consumer mendapat partition baru.
5. Processing resume.

Kelebihan:

1. Sederhana.
2. Mudah dipahami.
3. Aman secara ownership.

Kekurangan:

1. Stop-the-world.
2. Latency spike.
3. Lag naik saat rebalance.
4. Banyak duplicate risk jika processing belum commit.
5. Sangat mengganggu stateful workload.
6. Rolling deploy bisa membuat incident.

---

### 15.2 Cooperative Rebalancing

Cooperative rebalancing adalah model incremental.

Karakteristik:

1. Hanya partition yang perlu berpindah yang dicabut.
2. Partition yang tetap assigned bisa terus diproses.
3. Bisa terjadi lebih dari satu round rebalance.
4. Mengurangi downtime group.

Kelebihan:

1. Lebih sedikit pause.
2. Lebih stabil saat rolling deploy.
3. Lebih baik untuk stateful consumer.
4. Lebih sedikit assignment churn.
5. Lebih baik untuk consumer dengan local cache.

Kekurangan:

1. Lebih kompleks.
2. Butuh assignor yang mendukung cooperative.
3. Upgrade harus hati-hati.
4. Revoke/assign callback perlu benar.
5. Aplikasi harus menghormati partition revocation.

---

## 16. Static Membership

Static membership memungkinkan consumer memiliki identitas stabil antar restart.

Konfigurasi:

```properties
group.instance.id=enforcement-projection-service-0
```

Tanpa static membership, consumer mendapat member ID dinamis dari coordinator. Saat process restart, coordinator melihatnya sebagai member baru.

Dengan static membership:

```text
Instance lama:
  group.instance.id=projection-0

Restart cepat:
  group.instance.id=projection-0

Coordinator bisa mengenali bahwa ini instance logis yang sama.
```

Manfaat:

1. Mengurangi rebalance tidak perlu saat rolling restart.
2. Menjaga assignment lebih stabil.
3. Berguna untuk stateful consumer.
4. Mengurangi cache/state restore.
5. Lebih predictable untuk deployment tetap.

Risiko:

1. `group.instance.id` harus unik dalam group.
2. Duplicate ID bisa menyebabkan fencing.
3. Tidak cocok untuk autoscaling acak tanpa identitas stabil.
4. Di Kubernetes, perlu mapping stabil seperti StatefulSet ordinal.
5. Salah konfigurasi bisa membuat group sulit pulih.

Contoh Kubernetes StatefulSet:

```text
pod: projection-service-0 -> group.instance.id=projection-service-0
pod: projection-service-1 -> group.instance.id=projection-service-1
pod: projection-service-2 -> group.instance.id=projection-service-2
```

Untuk Deployment biasa dengan pod name ephemeral, static membership lebih tricky.

---

## 17. Rebalance Triggers

### 17.1 Consumer Join

Saat consumer baru join group:

```text
Before:
  C1 -> P0, P1
  C2 -> P2, P3

C3 joins

After:
  C1 -> P0
  C2 -> P1
  C3 -> P2, P3
```

Kafka perlu membagi ulang.

---

### 17.2 Consumer Leave

Saat consumer shutdown normal dan memanggil `consumer.close()`:

```text
C2 leaves

Before:
  C1 -> P0
  C2 -> P1
  C3 -> P2, P3

After:
  C1 -> P0, P1
  C3 -> P2, P3
```

Shutdown graceful membantu coordinator tahu bahwa consumer keluar secara sengaja.

---

### 17.3 Consumer Crash

Jika process mati tanpa close, coordinator tidak langsung tahu. Ia menunggu session timeout.

```text
C2 crash
No heartbeat
session.timeout.ms expires
Coordinator marks C2 dead
Rebalance
```

Jika timeout terlalu besar, failover lambat. Jika terlalu kecil, false positive meningkat.

---

### 17.4 Heartbeat Failure

Heartbeat membuktikan consumer masih hidup.

Jika heartbeat gagal karena:

1. Network issue.
2. Broker overload.
3. JVM pause.
4. CPU starvation.
5. Event loop blocked.
6. Container throttling.

Coordinator bisa menganggap consumer mati dan memulai rebalance.

---

### 17.5 `max.poll.interval.ms` Expired

Consumer bukan hanya harus heartbeat. Ia juga harus memanggil `poll()` dalam batas waktu `max.poll.interval.ms`.

Jika processing record terlalu lama dan consumer tidak kembali ke `poll()`:

```text
poll()
process records for too long
max.poll.interval.ms expires
consumer considered failed
rebalance
```

Ini sering terjadi pada Java service yang melakukan:

1. Call external API lambat.
2. Batch database write terlalu besar.
3. Processing CPU-heavy.
4. Lock contention.
5. Deadlock.
6. Backpressure tidak dikendalikan.

---

### 17.6 Topic Partition Count Changes

Jika topic yang di-subscribe group mendapat partition baru:

```text
case-events: 6 partitions -> 12 partitions
```

Kafka perlu membuat assignment baru.

Catatan penting:

Menambah partition bisa mengubah distribusi key untuk record baru jika default partitioner memakai hash modulo jumlah partition. Ini bisa memengaruhi ordering domain. Sudah dibahas di Part 005.

---

### 17.7 Subscription Changes

Jika consumer menggunakan pattern subscription:

```java
consumer.subscribe(Pattern.compile("case-.*"));
```

Lalu topic baru muncul:

```text
case-events
case-decisions
case-escalations
```

Group bisa rebalance karena subscription set berubah.

---

### 17.8 Rolling Deployment

Rolling deploy bisa menyebabkan sequence:

```text
Instance 1 stop -> rebalance
Instance 1 start -> rebalance
Instance 2 stop -> rebalance
Instance 2 start -> rebalance
Instance 3 stop -> rebalance
Instance 3 start -> rebalance
```

Tanpa mitigasi, deploy normal bisa menghasilkan banyak rebalance.

Mitigasi:

1. CooperativeStickyAssignor.
2. Static membership.
3. Graceful shutdown.
4. Drain before shutdown.
5. Reasonable session timeout.
6. Avoid aggressive autoscaling.
7. Avoid simultaneous restart semua consumer.

---

## 18. Rebalance Callback

Java consumer menyediakan callback saat partition assigned/revoked/lost.

Contoh:

```java
consumer.subscribe(
    List.of("case-events"),
    new ConsumerRebalanceListener() {
        @Override
        public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
            // Commit processed offsets before losing ownership.
        }

        @Override
        public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
            // Initialize resources for new partitions.
        }

        @Override
        public void onPartitionsLost(Collection<TopicPartition> partitions) {
            // Partitions lost without clean revoke.
            // Do not assume you can safely commit here.
        }
    }
);
```

### 18.1 `onPartitionsRevoked`

Dipanggil sebelum partition dicabut dari consumer.

Biasanya digunakan untuk:

1. Flush in-memory state.
2. Commit offset terakhir yang aman.
3. Stop per-partition workers.
4. Release partition-specific resource.
5. Ensure no async processing still running for revoked partition.

Bahaya:

```text
Jika kamu commit offset untuk record yang belum selesai diproses,
kamu bisa kehilangan data secara aplikasi.
```

---

### 18.2 `onPartitionsAssigned`

Dipanggil saat consumer mendapat partition baru.

Biasanya digunakan untuk:

1. Init per-partition state.
2. Load cache.
3. Seek offset khusus jika perlu.
4. Start per-partition worker.
5. Record metric assignment.

---

### 18.3 `onPartitionsLost`

Dipanggil ketika partition hilang tanpa revoke normal.

Ini bisa terjadi ketika consumer sudah bukan member valid group. Dalam kondisi ini, jangan sembarangan commit offset karena consumer mungkin tidak lagi memiliki ownership valid.

Mental model:

```text
revoked = kamu masih diberi kesempatan membereskan sebelum kehilangan ownership.
lost = ownership sudah hilang; jangan bertindak seolah masih owner.
```

---

## 19. Commit Race During Rebalance

Salah satu failure mode paling penting:

```text
1. Consumer A owns P0.
2. Consumer A polls offsets 100..109.
3. Consumer A mulai process async.
4. Rebalance terjadi.
5. P0 dipindahkan ke Consumer B.
6. Consumer A masih menyelesaikan async work.
7. Consumer A commit offset 110.
8. Consumer B mungkin sudah memproses dari offset lama.
```

Masalah:

1. Duplicate side effect.
2. Offset commit gagal karena generation berubah.
3. Offset commit sukses dalam kondisi tertentu jika tidak pakai group management benar.
4. External DB update race.
5. Record bisa dianggap selesai padahal side effect belum konsisten.

Mitigasi:

1. Jangan process record async tanpa tracking ownership partition.
2. Stop worker saat partition revoked.
3. Tunggu in-flight work selesai atau batalkan sebelum commit.
4. Commit hanya offset yang benar-benar selesai.
5. Gunakan per-partition processing queue.
6. Gunakan idempotency pada side effect.
7. Jangan commit dari thread sembarangan tanpa koordinasi dengan poll thread.
8. Desain consumer agar revoke callback bisa drain dengan batas waktu.

---

## 20. Duplicate Processing During Rebalance

Duplicate processing adalah normal di at-least-once Kafka.

Contoh:

```text
Committed offset: 100
Consumer A polls 100..109
Consumer A processes 100..105
Rebalance before commit
Consumer B receives P0
Consumer B starts from committed offset 100
Offsets 100..105 processed again
```

Ini bukan bug Kafka. Ini konsekuensi commit offset setelah processing.

Solusi bukan “menghilangkan duplicate” sepenuhnya, tetapi:

```text
Design side effects to be idempotent.
```

Contoh idempotency:

```sql
INSERT INTO processed_events(event_id, processed_at)
VALUES (?, now())
ON CONFLICT (event_id) DO NOTHING;
```

Atau:

```text
Use event_id as idempotency key.
Use natural business key and version.
Use deterministic projection update.
Use compare-and-set expected version.
```

---

## 21. Stop-the-World Rebalance

Pada eager rebalance, semua consumer berhenti memproses sementara.

Dampaknya:

1. Lag naik.
2. End-to-end latency naik.
3. Alert false positive.
4. Downstream projection stale.
5. Batch processing tertunda.
6. SLA escalation terlambat.
7. Autoscaler salah membaca lag lalu menambah instance.
8. Tambahan instance memicu rebalance lagi.
9. Rebalance storm.

ASCII incident loop:

```text
Consumer slow
  -> lag rises
  -> autoscaler adds consumers
  -> rebalance
  -> processing pauses
  -> lag rises more
  -> autoscaler adds more consumers
  -> more rebalances
```

Mitigasi:

1. Cooperative rebalance.
2. Autoscaling dengan cooldown.
3. Scale based on lag trend, not instant lag.
4. Cap max replicas.
5. Monitor rebalance count.
6. Deploy gradually.
7. Use static membership for stable instances.

---

## 22. Rebalance Storm

Rebalance storm adalah kondisi group terus-menerus rebalance sehingga processing efektif tidak stabil.

Penyebab umum:

1. `max.poll.interval.ms` terlalu kecil.
2. Processing terlalu lama.
3. Consumer crash loop.
4. Kubernetes liveness probe terlalu agresif.
5. CPU throttling.
6. Memory pressure dan GC pause.
7. Network instability.
8. Autoscaling terlalu agresif.
9. Consumer tidak graceful shutdown.
10. Mixed assignor config.
11. Duplicate `group.instance.id`.
12. Broker coordinator overload.

Gejala:

1. Consumer lag naik turun tajam.
2. Throughput turun.
3. Banyak log:
   - `Revoking previously assigned partitions`
   - `Successfully joined group`
   - `Rebalance in progress`
   - `CommitFailedException`
4. Assignment sering berubah.
5. Processing latency p95/p99 naik.
6. External sink menerima duplicate lebih banyak.

Mitigasi:

1. Stabilkan process lifecycle.
2. Perbaiki processing time.
3. Atur `max.poll.records`.
4. Atur `max.poll.interval.ms`.
5. Gunakan cooperative sticky assignor.
6. Gunakan static membership jika topology stabil.
7. Kurangi autoscaler sensitivity.
8. Graceful shutdown.
9. Jangan restart consumer karena lag tinggi tanpa diagnosis.

---

## 23. Zombie Consumer

Zombie consumer adalah consumer yang secara aplikasi masih berjalan atau masih melakukan side effect, tetapi secara consumer group sudah kehilangan ownership partition.

Contoh:

```text
Consumer A mengalami GC pause 2 menit.
Coordinator menganggap A mati.
P0 dipindahkan ke Consumer B.
Consumer A bangun lagi dan masih menulis hasil processing lama ke database.
```

Dampak:

1. Duplicate update.
2. Out-of-order side effect.
3. Last-write-wins corruption.
4. Offset commit failure.
5. External lock conflict.
6. Projection inconsistent.

Mitigasi:

1. Idempotent side effects.
2. Fencing token / generation-aware processing.
3. Per-partition worker cancellation on revoke.
4. Avoid long GC pause.
5. Monitor JVM pauses.
6. Use transactional/idempotent writes where possible.
7. Use version checks in downstream store.

---

## 24. Consumer Count > Partition Count

Misal:

```text
Topic partitions: 4
Consumer instances: 8
```

Hasil:

```text
4 active
4 idle
```

Idle consumer tetap:

1. Join group.
2. Heartbeat.
3. Ikut rebalance.
4. Menambah overhead.
5. Bisa memperlama assignment.
6. Membuat deployment lebih noisy.

Menambah consumer di atas jumlah partition tidak meningkatkan throughput untuk topic itu.

Namun ada pengecualian jika consumer subscribe banyak topic dengan total partition lebih banyak.

Contoh:

```text
Topic A: 4 partitions
Topic B: 4 partitions
Topic C: 4 partitions

Total assignable partitions: 12
Consumer: 8
```

Maka 8 consumer bisa aktif jika assignment tersebar.

---

## 25. Slow Consumer and Partition Starvation

Karena partition adalah unit ownership, jika satu partition punya data jauh lebih banyak atau processing lebih berat, satu consumer bisa menjadi bottleneck.

Contoh:

```text
P0: 1,000,000 events/hour
P1: 100,000 events/hour
P2: 100,000 events/hour
P3: 100,000 events/hour

C1 owns P0
C2 owns P1
C3 owns P2
C4 owns P3
```

C1 tertinggal jauh. Menambah consumer tidak membantu jika P0 tetap satu partition.

Solusi harus kembali ke desain partitioning:

1. Perbaiki key distribution.
2. Tambah partition untuk future data.
3. Split hot key.
4. Ubah model event.
5. Gunakan sub-key.
6. Gunakan parallelism internal yang tetap menjaga ordering domain.
7. Proses hot key dengan strategi khusus.
8. Jangan berharap rebalance menyelesaikan hot partition.

---

## 26. Assignment and Ordering

Saat partition berpindah consumer, ordering dalam partition tetap dijaga selama hanya satu consumer valid memproses partition pada satu waktu.

Namun aplikasi bisa merusak ordering jika:

1. Memproses record async tanpa menjaga order.
2. Menggunakan thread pool global.
3. Commit offset lebih maju daripada record selesai.
4. Side effect dilakukan paralel untuk key yang sama.
5. Rebalance terjadi saat in-flight work belum selesai.
6. Consumer lama masih melakukan side effect setelah kehilangan ownership.

Untuk menjaga ordering per partition:

```text
One partition -> one ordered processing lane.
```

Jika butuh parallelism di dalam consumer, gunakan partition-aware execution.

Contoh:

```text
P0 -> worker-lane-0
P1 -> worker-lane-1
P2 -> worker-lane-2
```

Bukan:

```text
P0 offsets 100..110 -> random global thread pool
```

---

## 27. Java Consumer Group Pattern: Single Poll Thread

KafkaConsumer tidak thread-safe. Pola aman:

```text
Satu thread memanggil poll().
Processing bisa didelegasikan, tetapi akses ke KafkaConsumer tetap di poll thread.
```

Contoh skeleton sederhana:

```java
public final class CaseEventConsumer implements AutoCloseable {
    private final KafkaConsumer<String, CaseEvent> consumer;
    private volatile boolean running = true;

    public CaseEventConsumer(KafkaConsumer<String, CaseEvent> consumer) {
        this.consumer = consumer;
    }

    public void run() {
        consumer.subscribe(List.of("case-events"), new ConsumerRebalanceListener() {
            @Override
            public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
                // Flush and commit only completed offsets.
                consumer.commitSync();
            }

            @Override
            public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
                // Initialize per-partition state if needed.
            }

            @Override
            public void onPartitionsLost(Collection<TopicPartition> partitions) {
                // Do not assume safe commit here.
            }
        });

        try {
            while (running) {
                ConsumerRecords<String, CaseEvent> records =
                    consumer.poll(Duration.ofMillis(500));

                for (ConsumerRecord<String, CaseEvent> record : records) {
                    process(record);
                }

                consumer.commitSync();
            }
        } finally {
            consumer.close();
        }
    }

    private void process(ConsumerRecord<String, CaseEvent> record) {
        // Business logic must be idempotent.
    }

    @Override
    public void close() {
        running = false;
        consumer.wakeup();
    }
}
```

Namun skeleton ini masih sederhana. Untuk production, kamu perlu:

1. Handle `WakeupException`.
2. Track offset per partition.
3. Commit offset hanya setelah record selesai.
4. Handle poison pill.
5. Handle rebalance callback dengan hati-hati.
6. Avoid blocking too long inside poll loop.
7. Graceful shutdown.

---

## 28. Better Java Pattern: Per-Partition Offset Tracking

Commit offset harus merepresentasikan offset berikutnya yang aman dibaca.

Jika record offset 42 selesai diproses, commit offset 43.

```java
Map<TopicPartition, OffsetAndMetadata> offsetsToCommit = new HashMap<>();

for (ConsumerRecord<String, CaseEvent> record : records) {
    TopicPartition tp = new TopicPartition(record.topic(), record.partition());

    process(record);

    offsetsToCommit.put(
        tp,
        new OffsetAndMetadata(record.offset() + 1)
    );
}

consumer.commitSync(offsetsToCommit);
```

Mengapa offset + 1?

Karena committed offset adalah posisi berikutnya, bukan offset terakhir yang telah diproses.

```text
Processed offset 42
Commit offset 43
Next start from 43
```

---

## 29. Async Processing: Dangerous but Sometimes Necessary

Kadang processing per record terlalu lambat sehingga consumer ingin delegate ke worker pool.

Bahaya utama:

1. Poll thread tetap harus memanggil `poll()` agar group tidak timeout.
2. Offset tidak boleh commit sebelum work selesai.
3. Partition revoke harus menghentikan work partition tersebut.
4. Ordering per partition bisa rusak.
5. Memory bisa meledak jika queue tidak dibatasi.

Pattern yang lebih aman:

```text
poll thread
  -> dispatch records by partition to bounded per-partition queue
  -> workers process sequentially per partition
  -> completed offset tracked per partition
  -> poll thread commits completed contiguous offsets
  -> pause partition if queue full
  -> resume partition when queue drains
```

ASCII:

```text
KafkaConsumer poll thread
  P0 records -> lane P0 -> worker sequential -> completed offset P0
  P1 records -> lane P1 -> worker sequential -> completed offset P1
  P2 records -> lane P2 -> worker sequential -> completed offset P2

Commit only contiguous completed offsets.
```

Jangan commit offset 110 jika offset 108 belum selesai.

---

## 30. Partition Revocation with Async Processing

Saat `onPartitionsRevoked(P0)`:

1. Stop menerima work baru untuk P0.
2. Pause P0 jika perlu.
3. Tunggu in-flight work P0 selesai sampai batas waktu.
4. Commit completed contiguous offset P0.
5. Cancel sisanya jika tidak selesai.
6. Pastikan worker lama tidak lagi menulis side effect setelah ownership hilang.
7. Release resource P0.

Pseudo-flow:

```java
@Override
public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
    for (TopicPartition tp : partitions) {
        partitionWorkers.stopAccepting(tp);
    }

    partitionWorkers.awaitDrain(partitions, Duration.ofSeconds(20));

    Map<TopicPartition, OffsetAndMetadata> safeOffsets =
        partitionWorkers.completedOffsets(partitions);

    consumer.commitSync(safeOffsets);

    partitionWorkers.release(partitions);
}
```

Dalam cooperative rebalance, hanya partition tertentu yang direvoke, bukan semua. Callback harus menghormati itu.

---

## 31. Static Membership in Java Config

Contoh config:

```properties
bootstrap.servers=kafka-1:9092,kafka-2:9092,kafka-3:9092
group.id=enforcement-projection-service
group.instance.id=enforcement-projection-service-0
enable.auto.commit=false
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
```

Untuk Kubernetes StatefulSet:

```yaml
env:
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
```

Lalu:

```java
props.put(
    ConsumerConfig.GROUP_INSTANCE_ID_CONFIG,
    System.getenv("POD_NAME")
);
```

Pastikan `POD_NAME` stabil dan unik dalam group.

---

## 32. CooperativeStickyAssignor Config

Contoh:

```properties
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
```

Dalam beberapa versi/konfigurasi, default list assignor bisa berisi lebih dari satu strategy. Untuk production clarity, explicit config sering lebih baik.

Namun saat migrasi dari assignor lama, jangan langsung mengganti semua tanpa rencana. Pastikan semua consumer dalam group mendukung cooperative assignor.

---

## 33. Important Consumer Group Configs

### 33.1 `group.id`

Identitas group.

```properties
group.id=enforcement-projection-service
```

Ubah `group.id` berarti aplikasi membaca sebagai group baru, biasanya mulai dari offset sesuai `auto.offset.reset` jika belum ada committed offset.

---

### 33.2 `group.instance.id`

Static member identity.

```properties
group.instance.id=enforcement-projection-service-0
```

Harus unik dalam group.

---

### 33.3 `partition.assignment.strategy`

Assignment algorithm.

```properties
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
```

---

### 33.4 `session.timeout.ms`

Berapa lama coordinator menunggu heartbeat sebelum menganggap consumer mati.

Trade-off:

```text
Lebih kecil:
  + failover cepat
  - lebih rentan false positive

Lebih besar:
  + toleran network/GC pause
  - failover lambat
```

---

### 33.5 `heartbeat.interval.ms`

Interval heartbeat untuk menjaga session tetap aktif.

Biasanya lebih kecil dari `session.timeout.ms`.

---

### 33.6 `max.poll.interval.ms`

Batas maksimum antar pemanggilan `poll()`.

Jika processing terlalu lama dan poll tidak dipanggil, consumer dianggap failed.

Trade-off:

```text
Lebih kecil:
  + cepat mendeteksi stuck processing
  - long processing mudah dianggap mati

Lebih besar:
  + toleran long processing
  - zombie/stuck consumer lebih lama dipertahankan
```

Lebih baik memperbaiki processing/backpressure daripada sekadar menaikkan besar-besaran.

---

### 33.7 `max.poll.records`

Jumlah record maksimum per poll.

Jika processing per record mahal, nilai terlalu besar bisa membuat poll loop terlalu lama dan memicu `max.poll.interval.ms`.

Contoh:

```text
max.poll.records=500
avg processing = 200ms/record
total worst case = 100s
```

Jika `max.poll.interval.ms=60s`, consumer bisa timeout.

---

### 33.8 `enable.auto.commit`

Untuk production yang butuh correctness, biasanya:

```properties
enable.auto.commit=false
```

Karena auto commit bisa commit offset sebelum processing benar-benar selesai.

---

## 34. Deployment Failure Mode

### 34.1 Bad Rolling Deploy

Misal service punya 6 pods dan eager rebalance.

```text
Pod 1 terminated -> rebalance
Pod 1 started    -> rebalance
Pod 2 terminated -> rebalance
Pod 2 started    -> rebalance
...
```

Jika setiap rebalance 10-30 detik, deployment normal bisa membuat group terganggu beberapa menit.

Dampak:

1. Lag naik.
2. Projection stale.
3. SLA monitor terlambat.
4. Duplicate processing.
5. Alert storm.

---

### 34.2 Better Rolling Deploy

Gunakan:

```text
CooperativeStickyAssignor
+ graceful shutdown
+ static membership for stable pods
+ preStop hook
+ enough terminationGracePeriodSeconds
+ readiness probe that does not flap
+ autoscaling cooldown
```

Kubernetes concept:

```yaml
terminationGracePeriodSeconds: 60
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 15"]
```

Aplikasi juga harus menangani SIGTERM:

```text
SIGTERM received
stop accepting new HTTP requests if any
stop polling new Kafka records
finish in-flight processing within deadline
commit safe offsets
close consumer
exit
```

---

## 35. Autoscaling Consumer Groups

Autoscaling berdasarkan lag terlihat menarik, tetapi harus hati-hati.

Masalah:

```text
Lag naik -> scaler menambah pod -> rebalance -> processing pause -> lag makin naik -> scaler tambah pod lagi
```

Gunakan sinyal lebih matang:

1. Lag trend.
2. Lag per partition.
3. Processing rate.
4. Produce rate.
5. Time lag, bukan hanya offset lag.
6. Rebalance count.
7. CPU/memory.
8. Sink latency.
9. Cooldown period.
10. Max replica bound.
11. Partition count ceiling.

Jika topic punya 12 partition, scaling ke 100 consumer tidak masuk akal untuk group yang hanya membaca topic itu.

---

## 36. Observability untuk Consumer Group

Monitor minimal:

1. Consumer lag per group-topic-partition.
2. Max lag per partition.
3. Lag time jika tersedia.
4. Rebalance count/rate.
5. Assigned partitions per consumer.
6. Records consumed rate.
7. Bytes consumed rate.
8. Commit rate.
9. Commit latency.
10. Poll latency.
11. Processing latency.
12. Time since last poll.
13. Time since last commit.
14. Heartbeat failures.
15. Consumer instance restarts.
16. JVM GC pause.
17. Thread pool queue depth.
18. DLQ rate.
19. Duplicate detection rate.
20. External sink latency/error.

Dashboard yang hanya menampilkan total lag sering menyesatkan.

Contoh:

```text
Total lag: 1,000,000
P0 lag: 990,000
P1 lag: 2,000
P2 lag: 3,000
P3 lag: 5,000
```

Masalahnya bukan kekurangan consumer umum. Masalahnya hot partition P0.

---

## 37. Rebalance-Aware Metrics

Tambahkan application metrics:

```text
consumer.rebalance.revoked.count
consumer.rebalance.assigned.count
consumer.rebalance.lost.count
consumer.rebalance.duration
consumer.partition.assignment.count
consumer.partition.inflight.records
consumer.partition.completed.offset
consumer.partition.committed.offset
consumer.partition.processing.lag
consumer.partition.queue.depth
```

Log assignment saat startup/rebalance:

```text
assigned partitions:
  case-events-0
  case-events-3
  case-events-7
```

Ini membantu incident response.

---

## 38. Common Anti-Patterns

### 38.1 Menganggap consumer count selalu menaikkan throughput

Salah. Batasnya partition count dan hot partition distribution.

---

### 38.2 Auto commit untuk side effect penting

Auto commit bisa menyebabkan offset maju walaupun processing gagal.

---

### 38.3 Processing terlalu lama dalam poll loop

Menyebabkan `max.poll.interval.ms` expired dan rebalance.

---

### 38.4 Tidak handle rebalance callback

Tanpa callback, consumer mungkin kehilangan partition tanpa flush/commit state yang aman.

---

### 38.5 Async processing tanpa offset tracking

Commit offset bisa melompati record yang belum selesai.

---

### 38.6 Global thread pool yang merusak ordering

Record dari partition yang sama bisa selesai out of order.

---

### 38.7 Autoscaling agresif berdasarkan lag instan

Bisa menciptakan rebalance storm.

---

### 38.8 Kubernetes liveness probe membunuh consumer saat lag tinggi

Lag tinggi bukan selalu process mati. Membunuh pod bisa memperparah lag lewat rebalance.

---

### 38.9 Duplicate `group.instance.id`

Static membership membutuhkan ID unik. Duplikasi bisa menyebabkan fencing dan instability.

---

### 38.10 Satu group.id dipakai banyak aplikasi berbeda

Ini fatal.

Jika dua aplikasi berbeda memakai `group.id` sama, mereka akan membagi partition seolah satu aplikasi. Akibatnya masing-masing tidak membaca semua data yang diharapkan.

Contoh buruk:

```text
audit-service group.id=case-consumer
projection-service group.id=case-consumer
```

Hasil:

```text
audit-service hanya dapat sebagian partition
projection-service hanya dapat sebagian partition
```

Seharusnya:

```text
audit-service group.id=audit-service
projection-service group.id=projection-service
```

---

## 39. Design Trade-Offs

### 39.1 Fast Failover vs Stability

`session.timeout.ms` kecil:

```text
+ Cepat memindahkan partition dari consumer mati
- Mudah false positive saat network/GC pause
```

`session.timeout.ms` besar:

```text
+ Stabil terhadap pause sementara
- Partition dari consumer mati lebih lama tidak diproses
```

Tidak ada nilai universal. Sesuaikan dengan:

1. Processing criticality.
2. Network reliability.
3. JVM pause profile.
4. Deploy model.
5. RTO aplikasi.
6. Duplicate tolerance.

---

### 39.2 Large Batch vs Poll Stability

`max.poll.records` besar:

```text
+ Throughput potensial lebih tinggi
+ Overhead poll lebih kecil
- Processing batch bisa terlalu lama
- Rebalance risk
- Memory pressure
```

`max.poll.records` kecil:

```text
+ Poll loop lebih responsif
+ Rebalance lebih cepat ditangani
+ Memory lebih terkendali
- Throughput bisa turun
- Commit overhead relatif naik
```

---

### 39.3 Dynamic Scaling vs Assignment Stability

Autoscaling dinamis:

```text
+ Bisa adaptasi traffic
- Rebalance lebih sering
- Assignment churn
- State/cache restore
```

Replica tetap:

```text
+ Stabil
+ Predictable
- Bisa overprovision
- Kurang elastis
```

Untuk stateful atau latency-sensitive consumer, stabilitas sering lebih penting daripada scaling agresif.

---

### 39.4 Cooperative Complexity vs Reduced Pause

Cooperative rebalance:

```text
+ Reduced disruption
+ Better rolling deploy
+ Better stateful processing
- Callback lebih tricky
- Migration harus hati-hati
```

Untuk production modern, trade-off ini biasanya layak.

---

## 40. Case Study: Enforcement Projection Service

### 40.1 Context

Kita punya Kafka topic:

```text
case-events
partitions: 12
key: caseId
```

Service:

```text
enforcement-projection-service
```

Tugas:

1. Membaca semua event kasus.
2. Update read model `case_current_state`.
3. Menjaga audit projection.
4. Mendukung query UI.
5. Processing harus idempotent.
6. Ordering per `caseId` penting.

Karena key = `caseId`, semua event untuk case yang sama masuk partition yang sama.

---

### 40.2 Initial Deployment

```text
12 partitions
4 consumer pods
```

Assignment kira-kira:

```text
pod-0 -> P0, P1, P2
pod-1 -> P3, P4, P5
pod-2 -> P6, P7, P8
pod-3 -> P9, P10, P11
```

Config:

```properties
group.id=enforcement-projection-service
enable.auto.commit=false
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
max.poll.records=100
max.poll.interval.ms=300000
session.timeout.ms=45000
heartbeat.interval.ms=15000
```

Jika pakai StatefulSet:

```properties
group.instance.id=${POD_NAME}
```

---

### 40.3 Processing Logic

Setiap event punya:

```text
eventId
caseId
eventType
eventVersion
occurredAt
correlationId
causationId
```

Projection update idempotent:

```sql
INSERT INTO processed_event(event_id, processed_at)
VALUES (:eventId, now())
ON CONFLICT (event_id) DO NOTHING;
```

Jika insert berhasil, apply projection. Jika conflict, skip.

Projection bisa memakai optimistic version:

```sql
UPDATE case_current_state
SET status = :newStatus,
    version = :eventVersion
WHERE case_id = :caseId
  AND version < :eventVersion;
```

---

### 40.4 Rebalance During Deploy

Pod-1 restart.

Dengan eager rebalance:

```text
All pods revoke all partitions.
Processing pauses.
All assignments recalculated.
```

Dengan cooperative + static membership:

```text
Jika restart cepat dan identity stabil,
assignment bisa tetap lebih stabil.
Jika partition perlu dipindah, hanya subset yang direvoke.
```

---

### 40.5 Failure Scenario

Pod-2 mengalami GC pause 90 detik.

Jika `session.timeout.ms=45s`:

```text
Coordinator marks pod-2 dead.
P6,P7,P8 reassigned.
Pod-2 wakes up later.
Potential zombie side effects if app not guarded.
```

Mitigasi:

1. JVM tuning.
2. Monitor GC pause.
3. Idempotent DB writes.
4. Stop processing when consumer detects lost partition.
5. Avoid long blocking operations in consumer process.
6. Use static membership where appropriate, but do not treat it as substitute for correctness.

---

## 41. Production Configuration Baseline

Baseline untuk banyak Java consumer service:

```properties
bootstrap.servers=kafka-1:9092,kafka-2:9092,kafka-3:9092
group.id=enforcement-projection-service
enable.auto.commit=false
auto.offset.reset=earliest

key.deserializer=org.apache.kafka.common.serialization.StringDeserializer
value.deserializer=...

partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor

max.poll.records=100
max.poll.interval.ms=300000
session.timeout.ms=45000
heartbeat.interval.ms=15000

fetch.min.bytes=1
fetch.max.wait.ms=500
```

Catatan:

1. Jangan copy mentah untuk semua sistem.
2. Sesuaikan `max.poll.records` dengan processing latency.
3. Sesuaikan timeout dengan JVM, network, dan deploy model.
4. Untuk static membership, tambahkan `group.instance.id` unik.
5. Gunakan observability sebelum tuning agresif.

---

## 42. Checklist Desain Consumer Group

Sebelum production, jawab:

1. Apa `group.id` service ini?
2. Apakah ada service lain yang tidak sengaja memakai `group.id` sama?
3. Berapa topic yang dibaca?
4. Berapa total partition?
5. Berapa consumer instance?
6. Apakah consumer count melebihi partition count?
7. Assignment strategy apa yang dipakai?
8. Apakah cooperative rebalance sudah digunakan?
9. Apakah static membership cocok?
10. Apakah deployment memakai StatefulSet atau Deployment?
11. Bagaimana graceful shutdown dilakukan?
12. Apakah `enable.auto.commit=false`?
13. Kapan offset di-commit?
14. Apakah commit offset hanya setelah side effect selesai?
15. Apakah processing idempotent?
16. Apakah event punya `eventId`?
17. Apakah per-partition ordering dijaga?
18. Apakah async processing menjaga contiguous offset?
19. Apakah rebalance callback diimplementasikan?
20. Apakah `onPartitionsLost` dibedakan dari `onPartitionsRevoked`?
21. Apakah `max.poll.records` sesuai processing time?
22. Apakah `max.poll.interval.ms` realistis?
23. Apakah consumer bisa terkena GC pause panjang?
24. Apakah autoscaling punya cooldown?
25. Apakah monitor rebalance count tersedia?
26. Apakah lag dilihat per partition?
27. Apakah hot partition bisa dideteksi?
28. Apakah DLQ tersedia untuk poison event?
29. Apakah liveness/readiness probe tidak menyebabkan restart agresif?
30. Apakah runbook rebalance storm tersedia?

---

## 43. Checklist Incident: Lag Naik Setelah Deploy

Jika lag naik setelah deploy consumer:

1. Cek apakah terjadi rebalance berulang.
2. Cek jumlah restart pod.
3. Cek log `Revoking partitions`, `Assigned partitions`, `Rebalance in progress`.
4. Cek assignment berubah atau stabil.
5. Cek consumer count vs partition count.
6. Cek `max.poll.interval.ms` exceeded.
7. Cek processing latency.
8. Cek external sink latency.
9. Cek GC pause.
10. Cek CPU throttling.
11. Cek network error.
12. Cek DLQ/poison pill.
13. Cek apakah autoscaler menambah pod saat lag naik.
14. Cek apakah deploy restart terlalu cepat.
15. Cek apakah graceful shutdown berjalan.
16. Cek apakah assignment strategy masih eager.
17. Cek apakah static membership ID duplicate.
18. Jangan langsung restart semua pod.

---

## 44. Thought Exercises

### Exercise 1

Topic `case-events` punya 8 partition. Consumer group punya 12 instance.

Pertanyaan:

1. Berapa instance maksimal yang aktif membaca?
2. Apa yang dilakukan 4 instance lain?
3. Apakah menambah instance ke 20 membantu throughput?
4. Apa yang harus dianalisis jika lag tetap tinggi?

Jawaban ringkas:

1. Maksimal 8 aktif.
2. Idle tetapi tetap member group.
3. Tidak untuk topic itu.
4. Lag per partition, hot partition, processing latency, sink latency, partitioning key.

---

### Exercise 2

Consumer memproses record 2 detik/record. `max.poll.records=500`.

Pertanyaan:

1. Worst-case processing batch berapa lama?
2. Apa risiko terhadap `max.poll.interval.ms=300000`?
3. Bagaimana mitigasinya?

Jawaban:

1. 1000 detik.
2. Melebihi 5 menit, consumer bisa dianggap failed.
3. Turunkan `max.poll.records`, gunakan bounded async per partition, optimalkan processing, pause/resume, atau naikkan timeout dengan pertimbangan.

---

### Exercise 3

Dua service berbeda memakai `group.id=case-service`.

Pertanyaan:

1. Apa yang terjadi?
2. Mengapa berbahaya?
3. Apa perbaikannya?

Jawaban:

1. Mereka membagi partition dalam group yang sama.
2. Masing-masing service tidak menerima semua event.
3. Beri `group.id` berbeda per aplikasi logis.

---

### Exercise 4

Consumer A memproses offset 100..109. Offset 100..105 selesai, lalu rebalance terjadi sebelum commit.

Pertanyaan:

1. Consumer baru akan mulai dari mana?
2. Apa konsekuensinya?
3. Apa strategi aman?

Jawaban:

1. Dari committed offset terakhir, misal 100.
2. Offset 100..105 diproses ulang.
3. Idempotent processing dan commit hanya completed offset.

---

## 45. Ringkasan

Consumer group adalah mekanisme Kafka untuk membagi partition antar consumer dalam satu aplikasi logis.

Ingat prinsip utama:

```text
Kafka membagi partition, bukan record.
Satu partition hanya dimiliki satu consumer dalam group pada satu waktu.
Parallelism efektif dibatasi oleh jumlah partition.
Rebalance adalah perubahan ownership partition.
Rebalance memberi fault tolerance, tetapi bisa menyebabkan pause, duplicate, dan latency spike.
```

Top 1% Kafka engineer memahami bahwa rebalancing bukan detail internal kecil. Rebalancing adalah bagian dari runtime correctness aplikasi.

Hal yang harus melekat:

1. `group.id` adalah identitas aplikasi logis.
2. Consumer group berbeda membaca topic secara independen.
3. Rebalance adalah normal, bukan exceptional.
4. Duplicate processing adalah bagian dari at-least-once.
5. Offset commit harus mengikuti side effect yang benar-benar selesai.
6. Assignment strategy memengaruhi stability.
7. CooperativeStickyAssignor mengurangi disruption.
8. Static membership membantu deployment stabil jika ID unik dan stabil.
9. Async processing perlu per-partition ordering dan offset tracking.
10. Observability harus melihat rebalance, lag per partition, dan processing latency.

Jika Part 006 menjelaskan cara consumer membaca record, Part 007 menjelaskan bagaimana banyak consumer membagi ownership secara aman.

Part berikutnya akan membahas:

```text
Part 008 — Delivery Semantics:
At-Most-Once, At-Least-Once, Effectively-Once, Exactly-Once
```

Di sana kita akan menghubungkan producer, consumer, offset commit, idempotency, transaction, outbox, dan external side effect menjadi satu model correctness.

---

## 46. Referensi

Referensi utama untuk bagian ini:

1. Apache Kafka Documentation — Consumer Configs  
   https://kafka.apache.org/documentation/#consumerconfigs

2. Apache Kafka Documentation — Consumer Group Configuration  
   https://kafka.apache.org/documentation/#groupconfigs

3. Apache Kafka JavaDoc — `KafkaConsumer`  
   https://kafka.apache.org/documentation/

4. Apache Kafka JavaDoc — `CooperativeStickyAssignor`  
   https://kafka.apache.org/

5. Apache Kafka KIP-429 — Incremental Cooperative Rebalancing  
   https://cwiki.apache.org/confluence/display/KAFKA/KIP-429%3A+Kafka+Consumer+Incremental+Rebalance+Protocol

6. Confluent Documentation — Consumer Configs  
   https://docs.confluent.io/platform/current/installation/configuration/consumer-configs.html

7. Confluent Developer — Consumer Group Protocol  
   https://developer.confluent.io/courses/architecture/consumer-group-protocol/

8. Confluent Blog — Cooperative Rebalancing in Kafka Consumers, Kafka Streams, and ksqlDB  
   https://www.confluent.io/blog/cooperative-rebalancing-in-kafka-streams-consumer-ksqldb/

9. Confluent — Kafka Rebalancing Explained  
   https://www.confluent.io/learn/kafka-rebalancing/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Consumers Deep Dive: Poll Loop, Offset Management, Fetching, and Backpressure</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-008.md">Part 008 — Delivery Semantics: At-Most-Once, At-Least-Once, Effectively-Once, Exactly-Once ➡️</a>
</div>

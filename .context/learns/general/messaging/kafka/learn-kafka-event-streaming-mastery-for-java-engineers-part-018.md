# learn-kafka-event-streaming-mastery-for-java-engineers-part-018.md

# Part 018 — ksqlDB Advanced: Joins, Windows, Aggregations, Repartitioning, and State

> Series: Kafka, Kafka ksqlDB, Kafka Connect, etc. for Java Software Engineers  
> Audience: Java software engineer / tech lead yang ingin memahami Kafka ecosystem sampai level desain, failure modelling, dan production reasoning.  
> Fokus part ini: semantics advanced di ksqlDB: join, window, aggregation, repartitioning, internal state, late events, dan cara debug hasil yang tampak benar tetapi sebenarnya salah.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami perbedaan semantics **stream-stream join**, **stream-table join**, dan **table-table join** di ksqlDB.
2. Menentukan kapan data harus **co-partitioned**, kapan ksqlDB membuat internal repartition topic, dan apa biaya operasionalnya.
3. Mendesain query windowed aggregation dengan benar menggunakan **event time**, **window type**, dan **grace period**.
4. Menjelaskan mengapa event terlambat bisa diterima, ditolak, atau menghasilkan update ulang terhadap aggregate.
5. Memahami hubungan antara ksqlDB persistent query, Kafka Streams application, state store, changelog topic, repartition topic, dan materialized view.
6. Menghindari anti-pattern seperti join tanpa key yang benar, window tanpa memahami late arrival, aggregation unbounded, dan hidden internal topic explosion.
7. Membuat decision framework: kapan pakai ksqlDB, kapan pakai Kafka Streams Java, kapan pakai Flink/Spark, dan kapan cukup consumer biasa.
8. Melakukan debugging hasil query yang salah secara sistematis: key, partition, timestamp, schema, state, window, dan query topology.

Part ini bukan tutorial SQL permukaan. Kita akan melihat ksqlDB sebagai **declarative interface di atas Kafka Streams**, sehingga setiap query SQL perlu dipahami sebagai topology stream processing yang berjalan terus-menerus.

---

## 2. Mental Model Utama

### 2.1 ksqlDB bukan SQL database tradisional

Di SQL database biasa, kamu punya table yang relatif stabil, lalu query mengeksekusi per request terhadap snapshot atau transaction view.

Di ksqlDB, banyak query adalah **persistent stream processing application**:

```text
input topic(s)
   -> ksqlDB query plan
   -> Kafka Streams topology
   -> optional repartition topic(s)
   -> optional local state store(s)
   -> optional changelog topic(s)
   -> output topic / materialized table / push result
```

Artinya:

- Query tidak hanya “membaca data”; query bisa menjadi aplikasi yang hidup terus.
- Query tidak hanya “menghasilkan result”; query bisa membuat topic baru, state lokal, dan changelog.
- Query tidak hanya dipengaruhi SQL syntax; query dipengaruhi partitioning, key, event time, retention, dan rebalancing.

### 2.2 Stream processing adalah incremental computation

ksqlDB bekerja dengan prinsip:

> Setiap record baru adalah perubahan terhadap dunia, dan query menghitung akibat perubahan itu secara incremental.

Contoh aggregate:

```sql
SELECT customer_id, COUNT(*)
FROM orders
GROUP BY customer_id
EMIT CHANGES;
```

Di database biasa, `COUNT(*)` menghitung dari seluruh table. Di stream processing, setiap order baru memperbarui count customer tersebut.

Mental modelnya:

```text
old state + new event -> new state -> emitted update
```

### 2.3 Join dan aggregation adalah stateful

Filter dan projection bisa stateless:

```sql
SELECT order_id, amount
FROM orders
WHERE amount > 100;
```

Namun join dan aggregation hampir selalu stateful:

```sql
-- aggregation
SELECT customer_id, SUM(amount)
FROM orders
GROUP BY customer_id
EMIT CHANGES;

-- join
SELECT o.order_id, c.segment
FROM orders o
JOIN customers c
ON o.customer_id = c.customer_id;
```

Stateful berarti ksqlDB perlu menyimpan memori/penyimpanan lokal tentang data sebelumnya, biasanya melalui state store dan changelog topic.

### 2.4 Key adalah pusat gravitasi

Di Kafka/ksqlDB, join dan aggregation bukan hanya soal kolom yang cocok. Mereka bergantung pada **record key** dan partitioning.

SQL database dapat melakukan join menggunakan index, hash join, nested loop, broadcast, atau query optimizer. ksqlDB bekerja dalam sistem stream partitioned. Agar dua record yang perlu bertemu bisa diproses node yang sama, record harus diarahkan ke partition/task yang sama.

Karena itu, pertanyaan pertama sebelum join bukan:

```text
Apakah kolomnya sama?
```

Tetapi:

```text
Apakah stream/table ini keyed dan partitioned dengan cara yang membuat matching record diproses bersama?
```

### 2.5 Time bukan satu hal

Dalam event streaming, ada beberapa konsep waktu:

1. **Event time** — kapan kejadian bisnis sebenarnya terjadi.
2. **Ingestion time** — kapan event masuk ke Kafka.
3. **Processing time** — kapan query memproses event.

Windowing yang benar biasanya memakai event time. Namun event time membawa konsekuensi: event bisa datang terlambat, out-of-order, atau dikoreksi.

---

## 3. Konsep Inti

### 3.1 Stream

Stream adalah sequence event immutable.

Contoh:

```text
orders stream
-------------------------------------------------
offset | key        | value
0      | customer-1 | order-101 amount=50
1      | customer-2 | order-102 amount=70
2      | customer-1 | order-103 amount=30
```

Stream cocok untuk fakta historis:

- `OrderPlaced`
- `PaymentAuthorized`
- `CaseEscalated`
- `EvidenceUploaded`
- `InspectionCompleted`

### 3.2 Table

Table adalah latest value per key, dibangun dari changelog stream.

Contoh:

```text
customers table
-------------------------------------------------
key        | latest value
customer-1 | segment=GOLD, status=ACTIVE
customer-2 | segment=SILVER, status=ACTIVE
```

Table cocok untuk state saat ini:

- customer profile latest state
- account status
- merchant risk score latest
- case current assignment
- reference data

### 3.3 Stream-table duality

Stream dapat membangun table:

```text
customer-updates stream -> latest customer table
```

Table dapat menghasilkan stream perubahan:

```text
customer table updates -> changelog stream
```

Di ksqlDB, perbedaan stream/table sangat penting untuk join semantics.

### 3.4 Persistent query

Persistent query berjalan terus dan menghasilkan stream/table baru.

Contoh:

```sql
CREATE STREAM high_value_orders AS
SELECT *
FROM orders
WHERE amount > 100000
EMIT CHANGES;
```

Query ini bukan request satu kali. Ia akan terus memproses record baru dari `orders` dan menulis ke topic output.

### 3.5 Repartition

Repartition adalah proses menulis ulang stream ke topic internal dengan key baru agar operasi downstream bisa diproses berdasarkan key tersebut.

Contoh:

```sql
CREATE STREAM orders_by_customer AS
SELECT *
FROM orders
PARTITION BY customer_id
EMIT CHANGES;
```

Mental model:

```text
orders keyed by order_id
   -> repartition by customer_id
   -> orders_by_customer internal/output topic keyed by customer_id
```

Repartition bukan gratis:

- menambah write ke Kafka
- menambah read dari Kafka
- menambah topic
- menambah storage
- menambah network
- menambah latency
- bisa mengubah ordering domain

### 3.6 State store

State store adalah local storage yang dipakai query stateful.

Contoh penggunaan:

- menyimpan aggregate count/sum per key
- menyimpan table latest state
- menyimpan windowed aggregate
- menyimpan sisi join

Karena state store lokal bisa hilang ketika node mati, Kafka Streams/ksqlDB menyimpan changelog topic agar state bisa dipulihkan.

### 3.7 Changelog topic

Changelog topic adalah Kafka topic yang merekam perubahan state store.

Jika ksqlDB node mati:

```text
new node starts
   -> reads changelog topic
   -> rebuilds local state store
   -> continues processing
```

Changelog adalah fondasi fault tolerance untuk stateful processing.

### 3.8 Materialized view

Materialized view adalah hasil query stateful yang disimpan dan bisa di-query.

Contoh:

```sql
CREATE TABLE customer_order_total AS
SELECT customer_id, SUM(amount) AS total_amount
FROM orders
GROUP BY customer_id
EMIT CHANGES;
```

Ini membuat table yang terus diperbarui. Setiap order baru memperbarui aggregate customer.

---

## 4. Deep Dive: Join Semantics

Join adalah operasi yang tampak familiar dari SQL, tetapi dalam stream processing maknanya berbeda karena data datang seiring waktu.

Ada tiga kategori besar:

1. Stream-stream join.
2. Stream-table join.
3. Table-table join.

---

## 5. Stream-Stream Join

### 5.1 Mental model

Stream-stream join menggabungkan dua sequence event.

Contoh bisnis:

- `orders` join `payments`
- `case_created` join `initial_assignment`
- `login_attempts` join `device_fingerprint_events`

Karena kedua sisi adalah event stream yang terus bergerak, ksqlDB perlu tahu batas waktu pencarian pasangan event.

Karena itu stream-stream join biasanya membutuhkan **window**.

### 5.2 Contoh

```sql
CREATE STREAM paid_orders AS
SELECT
  o.order_id,
  o.customer_id,
  o.amount,
  p.payment_id,
  p.payment_status
FROM orders o
JOIN payments p
  WITHIN 10 MINUTES
  ON o.order_id = p.order_id
EMIT CHANGES;
```

Artinya:

> Gabungkan order dan payment dengan `order_id` sama jika keduanya terjadi dalam window 10 menit.

### 5.3 Kenapa perlu window?

Tanpa window, sistem harus menyimpan semua event lama selamanya untuk berjaga-jaga ada event pasangan yang datang di masa depan.

Itu tidak bounded.

Window membuat state bounded:

```text
keep possible matches for 10 minutes (+ grace/retention)
```

### 5.4 Inner join

Inner stream-stream join hanya menghasilkan output ketika kedua sisi match.

```text
orders:   O1 ---------
payments: ---- P1 ----
output:       O1+P1
```

Jika payment tidak pernah datang dalam window, tidak ada output.

### 5.5 Left join

Left join menghasilkan event dari kiri walaupun kanan belum match, tergantung semantics dan timing.

Contoh:

```sql
CREATE STREAM orders_with_payment_status AS
SELECT
  o.order_id,
  o.amount,
  p.payment_status
FROM orders o
LEFT JOIN payments p
  WITHIN 10 MINUTES
  ON o.order_id = p.order_id
EMIT CHANGES;
```

Namun hati-hati: dalam stream processing, left join bisa menghasilkan output awal dengan sisi kanan null, lalu bisa menghasilkan update/record lanjutan ketika sisi kanan datang.

### 5.6 Outer join

Outer join dapat mengeluarkan record ketika salah satu sisi tidak memiliki pasangan.

Ini jarang ideal untuk alur bisnis yang butuh determinisme tinggi, karena kamu harus jelas apakah output null berarti:

- pasangan memang tidak ada,
- pasangan belum datang,
- pasangan datang terlambat,
- pasangan key-nya salah,
- pasangan ter-drop karena melewati grace/window.

### 5.7 Ordering problem

Misalnya payment masuk sebelum order:

```text
time 10:00 payment P1 order_id=O1 arrives
time 10:03 order O1 arrives
```

Stream-stream join masih bisa match jika kedua record berada dalam window join dan state sisi payment masih tersedia.

Jadi stream join bukan “order harus duluan”. Ia lebih tepat dipahami sebagai:

```text
find matching records across two streams within a time interval
```

### 5.8 Key requirement

Agar join efisien dan benar, data harus co-partitioned berdasarkan join key.

Jika `orders` keyed by `order_id`, dan `payments` keyed by `order_id`, dengan jumlah partition sama, maka matching event masuk ke task yang sama.

Jika tidak, ksqlDB perlu repartition.

---

## 6. Stream-Table Join

### 6.1 Mental model

Stream-table join berarti event stream diperkaya dengan latest state dari table.

Contoh:

```text
OrderPlaced event + current CustomerProfile table -> enriched order event
```

Ini adalah pattern paling umum untuk enrichment.

### 6.2 Contoh

```sql
CREATE STREAM enriched_orders AS
SELECT
  o.order_id,
  o.customer_id,
  o.amount,
  c.segment,
  c.risk_level
FROM orders o
JOIN customers c
  ON o.customer_id = c.customer_id
EMIT CHANGES;
```

Artinya:

> Saat order event datang, lookup current customer state berdasarkan key, lalu emit enriched order.

### 6.3 Important: lookup happens at processing time

Stream-table join sering disalahpahami.

Jika customer segment berubah setelah order terjadi tetapi sebelum order diproses, hasil join bisa memakai state customer yang tersedia saat processing.

Pertanyaan penting:

```text
Apakah enrichment harus memakai state saat event terjadi, atau latest state saat diproses?
```

Jika butuh historical correctness, stream-table join dengan latest table mungkin tidak cukup. Kamu mungkin butuh:

- event-carried state transfer,
- temporal table/versioned table support jika tersedia dan cocok,
- stream-stream join dengan dimension change events,
- custom Kafka Streams logic,
- database temporal model di luar Kafka.

### 6.4 Inner stream-table join

Jika table tidak memiliki key tersebut saat event stream diproses, inner join tidak mengeluarkan output.

```text
order customer_id=C1 arrives
customers table has no C1
output: none
```

### 6.5 Left stream-table join

Left join mengeluarkan output walaupun lookup table tidak ada.

```sql
CREATE STREAM enriched_orders AS
SELECT
  o.order_id,
  o.customer_id,
  c.segment
FROM orders o
LEFT JOIN customers c
  ON o.customer_id = c.customer_id
EMIT CHANGES;
```

Output mungkin:

```text
order_id=O1, customer_id=C1, segment=null
```

Ini berguna jika event tidak boleh hilang hanya karena reference data belum tersedia.

### 6.6 Stream-table join tidak otomatis update ulang ketika table berubah

Misalnya:

```text
10:00 order O1 customer C1 arrives
10:00 customers table: C1 segment=SILVER
10:01 output enriched order: segment=SILVER
10:10 customer C1 changes to GOLD
```

Apakah enriched order lama berubah menjadi GOLD?

Umumnya tidak. Stream-table join menghasilkan output ketika stream side record diproses. Perubahan table setelah itu tidak otomatis “memproses ulang” event stream lama.

Ini sangat penting.

Jika kamu butuh semua order historis ikut diperbarui ketika customer berubah, itu bukan sekadar stream-table enrichment. Itu materialized relational projection problem.

### 6.7 Use case cocok

Stream-table join cocok untuk:

- enrichment event baru dengan reference data terbaru,
- adding customer segment to order event,
- adding case current assignee to new action event,
- adding merchant risk level to transaction event,
- adding product category to purchase event.

Tidak cocok jika:

- butuh historical dimension as-of event time,
- perubahan dimension harus retroactively update output lama,
- dimension table sangat besar dan state tidak muat,
- correctness hukum/regulatory membutuhkan exact snapshot at event time.

---

## 7. Table-Table Join

### 7.1 Mental model

Table-table join menghasilkan table baru dari dua table yang masing-masing berubah seiring waktu.

Contoh:

```text
customer_current_profile table
JOIN
customer_current_risk table
=
customer_current_view table
```

Jika salah satu table berubah, hasil table join bisa berubah.

### 7.2 Contoh

```sql
CREATE TABLE customer_current_view AS
SELECT
  p.customer_id,
  p.name,
  p.status,
  r.risk_level,
  r.risk_score
FROM customer_profiles p
JOIN customer_risks r
  ON p.customer_id = r.customer_id
EMIT CHANGES;
```

Jika `customer_risks` berubah untuk `customer_id=C1`, row output untuk C1 berubah.

### 7.3 Table-table join adalah continuously maintained view

Ini lebih mirip materialized view daripada event enrichment.

```text
left table update  -> recompute joined row
right table update -> recompute joined row
```

### 7.4 Tombstone impact

Jika table backed by compacted topic dan menerima tombstone untuk key tertentu, row bisa dihapus.

Dampaknya pada join:

- inner join: output row bisa hilang atau tombstone emitted.
- left join: right side deletion bisa menghasilkan row dengan right fields null.
- downstream consumer harus siap menerima tombstone/update semantics.

### 7.5 Use case cocok

Table-table join cocok untuk:

- current customer view,
- current case assignment + current case SLA,
- latest merchant profile + latest compliance status,
- materialized read model keyed by entity id.

Tidak cocok untuk:

- historical fact stream enrichment,
- high-cardinality volatile state tanpa capacity planning,
- ad hoc analytical join besar,
- join banyak table seperti data warehouse tanpa desain state.

---

## 8. Co-Partitioning

### 8.1 Definisi

Dua input dikatakan co-partitioned jika matching key berada pada partition yang sama dan diproses oleh task yang sama.

Secara praktis, ini biasanya membutuhkan:

1. Key yang sama secara semantic.
2. Serialization key yang sama secara byte-level atau compatible.
3. Partition count sama.
4. Partitioner/hash strategy compatible.

### 8.2 Kenapa penting?

Kafka Streams/ksqlDB memproses partition secara paralel. Jika `orders` untuk `customer_id=C1` ada di partition 2 tetapi `customers` untuk `C1` ada di partition 5, satu task tidak bisa join keduanya tanpa memindahkan data.

Maka ksqlDB harus melakukan repartition.

### 8.3 Contoh co-partitioned

```text
orders topic:
  key = customer_id
  partitions = 12

customers topic:
  key = customer_id
  partitions = 12

join key = customer_id
```

Ini ideal.

### 8.4 Contoh tidak co-partitioned

```text
orders topic:
  key = order_id
  partitions = 24

customers topic:
  key = customer_id
  partitions = 12

join key = customer_id
```

Masalah:

- orders tidak keyed by customer_id.
- partition count berbeda.
- ksqlDB perlu repartition orders, dan mungkin perlu menyesuaikan partitioning.

### 8.5 Repartition bukan cuma masalah performance

Repartition juga masalah semantics.

Jika stream awal keyed by `order_id`, ordering domain-nya adalah order. Setelah repartition by `customer_id`, ordering domain berubah menjadi customer.

```text
before: all events for same order stay ordered
after : all events for same customer stay ordered
```

Ini bisa benar atau salah tergantung use case.

### 8.6 Repartition checklist

Sebelum menerima query yang memicu repartition, jawab:

1. Key baru apa?
2. Ordering domain berubah dari apa ke apa?
3. Apakah downstream mengandalkan ordering lama?
4. Berapa throughput stream?
5. Berapa besar record?
6. Berapa partition output?
7. Berapa storage tambahan internal topic?
8. Apakah topic internal dimonitor?
9. Apakah query recovery akan membaca ulang repartition/changelog besar?
10. Apakah latency tambahan acceptable?

---

## 9. Windowing

Windowing adalah cara membuat operasi atas stream menjadi bounded berdasarkan waktu.

Tanpa window:

```text
count all orders per customer forever
```

Dengan window:

```text
count orders per customer per 5 minutes
```

---

## 10. Time Semantics

### 10.1 Event time

Event time adalah waktu kejadian bisnis terjadi.

Contoh:

```json
{
  "order_id": "O-1001",
  "customer_id": "C-9",
  "ordered_at": "2026-06-19T10:15:30Z"
}
```

Untuk analytics, SLA, fraud, monitoring bisnis, dan regulatory audit, event time biasanya lebih benar.

### 10.2 Ingestion time

Ingestion time adalah waktu record masuk Kafka.

Ini berguna untuk pipeline monitoring tetapi belum tentu benar secara bisnis.

### 10.3 Processing time

Processing time adalah waktu ksqlDB memproses record.

Ini bisa berubah karena:

- lag,
- downtime,
- replay,
- reprocessing,
- backfill,
- rebalance,
- throttling.

Jika query memakai processing time untuk bisnis, replay bisa menghasilkan hasil yang berbeda dari run pertama.

### 10.4 Rule of thumb

Gunakan event time untuk business correctness.

Gunakan processing/ingestion time untuk operational measurement.

---

## 11. Tumbling Window

### 11.1 Definisi

Tumbling window adalah window fixed-size yang tidak overlap.

Contoh: 5 menit.

```text
10:00 - 10:05
10:05 - 10:10
10:10 - 10:15
```

Setiap event masuk tepat ke satu window.

### 11.2 Contoh SQL

```sql
CREATE TABLE orders_per_customer_5m AS
SELECT
  customer_id,
  COUNT(*) AS order_count,
  SUM(amount) AS total_amount
FROM orders
WINDOW TUMBLING (SIZE 5 MINUTES)
GROUP BY customer_id
EMIT CHANGES;
```

### 11.3 Use case

- jumlah transaksi per 1 menit,
- total order per 5 menit,
- jumlah escalation per jam,
- event rate monitoring,
- suspicious activity count per interval.

### 11.4 Output key

Windowed aggregation biasanya keyed by:

```text
business key + window start/end
```

Contoh:

```text
customer_id=C1, window=10:00-10:05 -> count=3
customer_id=C1, window=10:05-10:10 -> count=2
```

### 11.5 Common mistake

Menganggap tumbling window selalu emit satu final result.

Dalam stream processing, aggregate bisa emit update berkali-kali ketika event baru untuk window yang sama datang.

```text
10:01 order -> count=1
10:02 order -> count=2
10:04 order -> count=3
```

Downstream harus memahami bahwa output adalah update stream, bukan final report statis.

---

## 12. Hopping Window

### 12.1 Definisi

Hopping window adalah fixed-size window yang overlap.

Contoh:

```text
SIZE = 10 minutes
ADVANCE BY = 5 minutes

10:00 - 10:10
10:05 - 10:15
10:10 - 10:20
```

Satu event bisa masuk ke beberapa window.

### 12.2 Contoh SQL

```sql
CREATE TABLE orders_per_customer_hopping AS
SELECT
  customer_id,
  COUNT(*) AS order_count
FROM orders
WINDOW HOPPING (SIZE 10 MINUTES, ADVANCE BY 5 MINUTES)
GROUP BY customer_id
EMIT CHANGES;
```

### 12.3 Use case

- moving count,
- rolling fraud signal,
- near-real-time trend detection,
- rolling SLA breach signal.

### 12.4 Cost

Karena satu event bisa masuk ke beberapa window, hopping window lebih mahal daripada tumbling window.

Jika size 1 hour dan advance 1 minute, satu event bisa masuk ke 60 window.

```text
state writes per event ~= size / advance
```

Ini bisa membunuh throughput jika tidak dihitung.

### 12.5 Common mistake

Membuat hopping window terlalu rapat karena ingin dashboard halus.

Untuk dashboard, kadang lebih baik:

- aggregate per 1 menit,
- biarkan visualization layer melakukan rolling view,
- atau gunakan dedicated analytics store.

---

## 13. Session Window

### 13.1 Definisi

Session window mengelompokkan event berdasarkan aktivitas dengan gap inactivity.

Contoh:

```text
session gap = 30 minutes
```

Jika user aktif terus dengan jeda kurang dari 30 menit, event masuk session yang sama. Jika jeda lebih besar, session baru dibuat.

### 13.2 Contoh SQL

```sql
CREATE TABLE user_sessions AS
SELECT
  user_id,
  COUNT(*) AS event_count
FROM user_activity
WINDOW SESSION (30 MINUTES)
GROUP BY user_id
EMIT CHANGES;
```

### 13.3 Use case

- user activity session,
- case worker activity burst,
- fraud attempt session,
- customer journey session,
- device activity period.

### 13.4 Session merge

Session window bisa merge.

Contoh:

```text
Event A at 10:00
Event B at 10:20
Event C arrives late with event time 10:10
```

Late event C dapat menghubungkan/merge sessions yang sebelumnya terpisah, tergantung gap dan grace.

Ini membuat output session window bisa berubah lebih kompleks dibanding tumbling window.

### 13.5 Common mistake

Menganggap session window menghasilkan boundary final sederhana. Dalam real system, late event dapat mengubah session boundary.

Jika downstream tidak siap menerima update, session aggregate bisa terlihat “aneh”.

---

## 14. Grace Period and Late Events

### 14.1 Late event

Late event adalah record yang event time-nya jatuh ke window lama tetapi baru diproses setelah window secara event-time sudah lewat.

Contoh:

```text
window: 10:00 - 10:05
record event_time: 10:03
record arrives/processed: 10:07
```

Apakah record diterima? Tergantung grace period.

### 14.2 Grace period

Grace period adalah toleransi keterlambatan setelah window end.

Contoh:

```sql
WINDOW TUMBLING (SIZE 5 MINUTES, GRACE PERIOD 2 MINUTES)
```

Artinya:

```text
window 10:00 - 10:05
late events accepted until 10:07 event-time progress boundary
```

### 14.3 Trade-off grace period

Grace lebih panjang:

- lebih toleran terhadap late/out-of-order events,
- hasil lebih correct untuk data terlambat,
- state disimpan lebih lama,
- finality lebih lambat,
- storage lebih besar.

Grace lebih pendek:

- state lebih kecil,
- result lebih cepat final,
- late event lebih banyak drop,
- correctness bisa turun.

### 14.4 Regulatory example

Misalnya sistem enforcement menghitung jumlah escalation per case per day.

Jika mobile officer offline dan sync event 6 jam terlambat, grace 5 menit akan membuat event tersebut tidak masuk aggregate harian.

Pertanyaannya bukan teknis saja:

```text
Apakah laporan compliance boleh mengabaikan event terlambat?
```

Jika tidak, kamu perlu grace panjang, correction flow, atau batch reconciliation.

### 14.5 Late event bukan error selalu

Late event bisa normal karena:

- mobile offline,
- upstream retry,
- CDC lag,
- region replication lag,
- backfill,
- batch import,
- clock skew,
- old event replay.

Karena itu, late event policy harus eksplisit.

### 14.6 Handling late events

Pilihan:

1. Terima dengan grace period cukup panjang.
2. Drop setelah grace dan monitor dropped records.
3. Kirim ke dead-letter/correction stream jika didukung pipeline.
4. Buat reconciliation job.
5. Pisahkan real-time aggregate dan authoritative historical aggregate.

---

## 15. Aggregations

### 15.1 Aggregation adalah state update

Aggregation di ksqlDB bukan proses membaca semua data setiap kali.

Ia menyimpan state:

```text
current aggregate per key/window
```

Setiap record baru memperbarui state.

### 15.2 COUNT

```sql
CREATE TABLE order_count_by_customer AS
SELECT
  customer_id,
  COUNT(*) AS order_count
FROM orders
GROUP BY customer_id
EMIT CHANGES;
```

State:

```text
customer_id -> count
```

### 15.3 SUM

```sql
CREATE TABLE order_total_by_customer AS
SELECT
  customer_id,
  SUM(amount) AS total_amount
FROM orders
GROUP BY customer_id
EMIT CHANGES;
```

State:

```text
customer_id -> total_amount
```

### 15.4 COUNT DISTINCT problem

Distinct aggregation can be expensive because it needs to remember seen values or approximate them depending on implementation/function.

Untuk high-cardinality streams, hati-hati dengan:

- memory/state growth,
- changelog size,
- restore time,
- correctness approximation jika pakai approximate functions.

### 15.5 Latest value by key

Beberapa use case membutuhkan latest event per key.

Contoh:

```sql
CREATE TABLE latest_case_status AS
SELECT
  case_id,
  LATEST_BY_OFFSET(status) AS current_status
FROM case_status_events
GROUP BY case_id
EMIT CHANGES;
```

Namun hati-hati: `LATEST_BY_OFFSET` berarti latest berdasarkan offset processing order, bukan selalu event-time latest.

Jika event terlambat dengan event_time lebih lama tetapi offset lebih baru, ia bisa dianggap latest by offset.

### 15.6 Aggregate output adalah changelog

Table aggregation menghasilkan changelog updates.

Contoh:

```text
C1 count=1
C1 count=2
C1 count=3
```

Downstream harus treat output sebagai update stream, bukan append-only facts biasa.

Jika downstream sink ke database, sink harus upsert by key, bukan insert blind.

### 15.7 Aggregation key harus stabil

Jika key berubah, aggregate berpindah ke key lain.

Contoh:

```text
case_id=C100 assigned_team=A
case_id=C100 assigned_team=B
```

Jika aggregate by `assigned_team`, event historis lama tetap dihitung ke team A kecuali ada explicit correction/retraction semantics.

Stream aggregation bukan relational group-by yang bisa recompute seluruh histori begitu dimension berubah.

---

## 16. Repartitioning in Detail

### 16.1 Kapan terjadi?

ksqlDB dapat membutuhkan repartition ketika:

- `GROUP BY` memakai kolom yang bukan key saat ini.
- `JOIN` memakai key yang tidak sesuai partitioning input.
- `PARTITION BY` eksplisit digunakan.
- Query membuat derived stream/table dengan key baru.

### 16.2 Contoh group-by memicu repartition

Input topic keyed by `order_id`:

```text
key=order_id, value contains customer_id
```

Query:

```sql
CREATE TABLE order_count_by_customer AS
SELECT customer_id, COUNT(*)
FROM orders
GROUP BY customer_id
EMIT CHANGES;
```

Karena aggregation by `customer_id`, ksqlDB perlu memastikan semua order customer yang sama masuk task yang sama.

Maka data harus repartition by `customer_id`.

### 16.3 Internal repartition topic

Query bisa menghasilkan internal topic seperti:

```text
_confluent-ksql-<service-id>query_<query-id>-repartition
```

Nama persis tergantung versi/config, tetapi prinsipnya: ada topic internal yang menyimpan data keyed ulang.

### 16.4 Biaya repartition

Untuk setiap record:

```text
consume input -> produce to repartition topic -> consume repartition topic -> continue processing
```

Biaya:

- producer cost,
- broker write,
- broker replication,
- consumer read,
- network,
- serialization,
- latency,
- monitoring topic tambahan.

### 16.5 Repartition dan compaction

Repartition topic biasanya bukan data product. Jangan konsumsi topic internal sebagai public contract.

Jika kamu butuh hasil repartition sebagai public stream, buat output stream eksplisit dengan naming dan governance yang jelas.

### 16.6 Repartition anti-pattern

Anti-pattern umum:

```text
raw stream keyed randomly
-> many ksqlDB queries each repartition by different columns
-> internal topic explosion
-> broker storage/network pressure
-> restore/recovery lambat
```

Solusi:

- desain key upstream lebih baik,
- buat curated keyed stream reusable,
- buat derived topic resmi,
- batasi ad hoc persistent query di production,
- monitor internal topics.

---

## 17. State Store and Changelog Deep Dive

### 17.1 State store sebagai local materialization

ksqlDB query stateful berjalan di server node. State lokal membuat processing cepat karena lookup tidak perlu remote call per record.

Contoh stream-table join:

```text
customers table materialized locally
orders stream record arrives
lookup customer_id in local store
emit enriched order
```

### 17.2 Partitioned state

State dibagi berdasarkan partition/task.

Jika topic punya 12 partition, state store logical bisa punya 12 shard.

Setiap ksqlDB server memegang subset task.

### 17.3 Failure recovery

Jika node mati:

```text
1. group rebalance terjadi
2. task dipindahkan ke node lain
3. node baru restore state dari changelog topic
4. processing lanjut
```

Restore time tergantung:

- ukuran state,
- changelog retention/compaction,
- disk/network throughput,
- standby replica,
- jumlah task,
- cache config,
- broker throughput.

### 17.4 Changelog topic harus dianggap critical

Changelog topic bukan sampah internal yang boleh sembarang dihapus.

Jika changelog rusak/hilang, state store tidak bisa dipulihkan dengan benar kecuali query bisa rebuild dari input topic yang masih lengkap dan retention mencukupi.

### 17.5 State store capacity planning

Pertimbangkan:

1. Cardinality key.
2. Window count.
3. Value size.
4. Number of partitions.
5. Number of stateful operators.
6. Cache size per store.
7. Changelog replication factor.
8. Restore time objective.

Formula kasar:

```text
state size ~= number_of_keys_or_key_windows * average_state_value_size * overhead_factor
```

Untuk windowed aggregation:

```text
state cardinality ~= distinct_keys * active_windows_per_key
```

Hopping window bisa meningkatkan active windows secara signifikan.

---

## 18. Suppression and Final Results

### 18.1 Masalah intermediate updates

Windowed aggregate bisa emit banyak update:

```text
10:01 count=1
10:02 count=2
10:03 count=3
```

Jika downstream butuh hanya final result setelah window selesai, intermediate update mengganggu.

### 18.2 Suppression concept

Suppression menahan update sampai kondisi tertentu, misalnya window close.

Mental model:

```text
without suppression: emit every update
with suppression   : buffer updates, emit final when window closes
```

### 18.3 Trade-off

Suppression membutuhkan buffer/state tambahan.

Risiko:

- memory pressure,
- delayed visibility,
- output muncul lebih lambat,
- failure recovery perlu memperhitungkan buffered state.

### 18.4 Tidak semua use case butuh final-only

Untuk monitoring dashboard, intermediate update justru berguna.

Untuk billing/regulatory report, final/corrected result mungkin lebih penting.

Decision:

```text
Do users need live evolving value or final closed-window value?
```

---

## 19. Debugging Wrong Results

Ketika query ksqlDB menghasilkan data yang “aneh”, jangan langsung menyalahkan ksqlDB. Ikuti checklist sistematis.

### 19.1 Cek key

Pertanyaan:

1. Apa key topic input?
2. Apakah key sesuai join/group-by?
3. Apakah key null?
4. Apakah key serialized dengan format yang diharapkan?
5. Apakah field di value berbeda dari Kafka key?

Masalah umum:

```text
value.customer_id = C1
Kafka key = O99
```

Query join by customer_id bisa memerlukan repartition.

### 19.2 Cek partitioning

Pertanyaan:

1. Berapa partition setiap input?
2. Apakah co-partitioned?
3. Apakah partition count berubah setelah topic dibuat?
4. Apakah producer memakai custom partitioner?
5. Apakah topic repartition internal muncul?

### 19.3 Cek timestamp

Pertanyaan:

1. Timestamp apa yang dipakai ksqlDB?
2. Apakah event time field benar?
3. Apakah timezone benar?
4. Apakah clock upstream skew?
5. Apakah event late melewati grace?

### 19.4 Cek window

Pertanyaan:

1. Window type apa?
2. Size berapa?
3. Advance berapa?
4. Grace berapa?
5. Apakah event bisa masuk beberapa window?
6. Apakah output intermediate atau final?

### 19.5 Cek table vs stream

Pertanyaan:

1. Apakah input didefinisikan sebagai STREAM padahal sebenarnya changelog/table?
2. Apakah input didefinisikan sebagai TABLE padahal event append-only?
3. Apakah tombstone ditangani?
4. Apakah key table benar?

### 19.6 Cek join type

Pertanyaan:

1. Inner/left/outer?
2. Stream-stream atau stream-table?
3. Apakah stream-stream memakai WITHIN?
4. Apakah table side punya data saat stream event diproses?
5. Apakah update table setelah stream event diharapkan memicu output ulang?

### 19.7 Cek internal topics

Pertanyaan:

1. Apakah ada repartition topic?
2. Apakah ada changelog topic?
3. Apakah topic internal punya replication factor benar?
4. Apakah retention/compaction topic internal aman?
5. Apakah lag di internal consumer group tinggi?

### 19.8 Cek query explain/topology

Gunakan command ksqlDB seperti:

```sql
EXPLAIN <query_id>;
```

Cari:

- source topics,
- sink topics,
- repartition steps,
- state stores,
- query status,
- error messages,
- topology nodes.

### 19.9 Cek dropped/skipped records

Records bisa ter-skip karena:

- deserialization error,
- schema mismatch,
- null key untuk table operation,
- late event melewati grace,
- incompatible timestamp,
- query exception.

Monitor skipped records metrics/log.

---

## 20. Java Engineer Perspective

Walaupun ksqlDB menggunakan SQL-like syntax, sebagai Java engineer kamu perlu memetakan query ke konsep Kafka Streams.

### 20.1 SQL ke topology

Query:

```sql
CREATE TABLE order_total_by_customer AS
SELECT customer_id, SUM(amount) AS total
FROM orders
GROUP BY customer_id
EMIT CHANGES;
```

Mental model Java/Kafka Streams:

```java
builder.stream("orders")
    .selectKey((key, value) -> value.customerId())
    .groupByKey()
    .aggregate(
        () -> BigDecimal.ZERO,
        (customerId, order, total) -> total.add(order.amount())
    )
    .toStream()
    .to("ORDER_TOTAL_BY_CUSTOMER");
```

Jika `selectKey` terjadi, biasanya ada repartition sebelum aggregation.

### 20.2 ksqlDB hides code, not semantics

ksqlDB menyembunyikan boilerplate Java, tetapi tidak menghilangkan:

- keying,
- partitioning,
- state,
- changelog,
- restore,
- late events,
- duplication risk,
- exactly-once trade-off,
- schema compatibility.

### 20.3 When Java Kafka Streams is better

Gunakan Kafka Streams Java jika kamu butuh:

- custom business logic kompleks,
- custom state store access,
- precise error handling,
- custom timestamp extraction,
- complex branching,
- integration dengan service/domain code,
- typed code dan tests granular,
- library reuse,
- advanced topology control.

### 20.4 When ksqlDB is better

Gunakan ksqlDB jika kamu butuh:

- declarative transformation,
- enrichment sederhana,
- aggregation umum,
- materialized view cepat,
- prototyping stream processing,
- platform-managed query,
- less Java boilerplate,
- SQL accessibility untuk data/platform engineers.

---

## 21. Production Failure Modes

### 21.1 Wrong key causes silent wrong join

Gejala:

- join result kosong,
- join result banyak null,
- aggregate pecah ke key aneh,
- internal repartition membengkak.

Root cause:

- Kafka key tidak sesuai value field,
- table key salah,
- `PARTITION BY` tidak dilakukan,
- producer memakai null key.

Mitigasi:

- enforce key contract,
- validate topic metadata,
- add contract tests,
- inspect records with key and value,
- define canonical keyed streams.

### 21.2 Late events dropped

Gejala:

- count harian kurang,
- SLA aggregate tidak sesuai database,
- fraud signal missed,
- reports berbeda setelah replay.

Root cause:

- grace period terlalu pendek,
- event timestamp salah,
- replay lama masuk sebagai late,
- upstream lag tinggi.

Mitigasi:

- define lateness SLO,
- set grace based on real data distribution,
- monitor late/dropped records,
- separate real-time and reconciliation pipelines.

### 21.3 State restore storm

Gejala:

- setelah deploy/restart, query lama pulih,
- consumer lag naik besar,
- broker read throughput spike,
- ksqlDB server disk/network penuh.

Root cause:

- state store besar,
- changelog besar,
- no standby replica,
- too many stateful queries,
- frequent rebalance.

Mitigasi:

- capacity planning,
- reduce state cardinality,
- tune standby replicas if supported/configured,
- avoid unnecessary stateful queries,
- deploy gradually,
- monitor restore metrics.

### 21.4 Internal topic explosion

Gejala:

- banyak topic `_confluent-ksql...repartition/changelog`,
- broker metadata besar,
- storage meningkat,
- replication traffic meningkat.

Root cause:

- banyak persistent query ad hoc,
- query masing-masing repartition sendiri,
- tidak ada governance,
- tidak ada cleanup lifecycle.

Mitigasi:

- query review,
- canonical derived streams,
- cleanup unused queries/topics,
- naming/governance,
- platform quota.

### 21.5 Table side not ready

Gejala:

- stream-table inner join kehilangan event,
- left join menghasilkan banyak null,
- enrichment tidak konsisten saat startup.

Root cause:

- table belum fully materialized,
- input table topic belum lengkap,
- query start sebelum reference data tersedia,
- recovery restore lambat.

Mitigasi:

- ensure table source readiness,
- use left join + downstream compensation if appropriate,
- preload/reference table strategy,
- monitor state restoration.

### 21.6 Misinterpreting changelog output as facts

Gejala:

- database sink duplicate rows,
- count terlihat double,
- audit log salah karena update dianggap event baru.

Root cause:

- table output/changelog dikonsumsi sebagai append-only fact stream.

Mitigasi:

- distinguish fact topics vs changelog topics,
- sink table output with upsert semantics,
- document topic contract,
- name topics clearly.

---

## 22. Design Trade-Offs

### 22.1 ksqlDB vs Kafka Streams

| Dimension | ksqlDB | Kafka Streams Java |
|---|---|---|
| Development style | SQL-like declarative | Java code |
| Speed to build | High | Medium |
| Fine-grained control | Medium | High |
| Testing granularity | Medium | High |
| Complex domain logic | Medium/Low | High |
| Platform operation | Centralized ksqlDB servers | App-owned runtime |
| Type safety | Lower | Higher |
| Suitable for data engineering | High | Medium |
| Suitable for embedded service logic | Medium | High |

### 22.2 Window correctness vs latency

Long grace:

```text
more correct for late data, slower finality, more state
```

Short grace:

```text
faster finality, less state, more dropped late data
```

### 22.3 Repartition flexibility vs cost

Allowing many arbitrary repartitions gives flexibility but can create platform cost explosion.

Better approach:

```text
raw topics -> curated keyed topics -> governed derived views
```

### 22.4 Latest-state enrichment vs historical correctness

Stream-table join is easy for latest-state enrichment.

But for legal/audit correctness, ask:

```text
Should event be interpreted using state as of event time?
```

If yes, latest-state table may be wrong.

---

## 23. Anti-Patterns

### 23.1 Joining on value field while ignoring Kafka key

SQL syntax can make you think join is relational. But if data is not keyed/partitioned correctly, ksqlDB must repartition or results/performance suffer.

### 23.2 Using ksqlDB as ad hoc data warehouse

ksqlDB is for stream processing, not arbitrary large analytical joins over historical datasets.

### 23.3 Treating every persistent query as free

Each query may create:

- consumer group,
- producers,
- internal topics,
- state stores,
- changelog topics,
- ongoing resource consumption.

### 23.4 Window without lateness analysis

Choosing `GRACE PERIOD 0` or arbitrary grace without measuring lateness distribution is dangerous.

### 23.5 Huge unbounded aggregation

Aggregation by high-cardinality key forever can create unbounded state.

Examples:

- count by user-agent string,
- count by IP without retention/window,
- aggregate by request ID,
- group by free-text field.

### 23.6 Consuming internal topics as public API

Internal topics are implementation details. They can change with query lifecycle/version.

### 23.7 Assuming left join null means “does not exist”

Null can mean:

- not found,
- not loaded yet,
- late table event,
- key mismatch,
- tombstone deleted,
- restore not complete,
- schema issue.

### 23.8 Assuming `LATEST_BY_OFFSET` means business-latest

Offset order is Kafka log order, not necessarily event time order.

### 23.9 Forgetting tombstones

Tables backed by compacted topics use tombstones for deletion semantics. Downstream code must understand null values.

---

## 24. Case Study: Enforcement Lifecycle Stream Processing

### 24.1 Scenario

Kamu membangun platform regulatory enforcement lifecycle.

Events:

- `CaseOpened`
- `CaseAssigned`
- `EvidenceUploaded`
- `RiskScoreUpdated`
- `CaseEscalated`
- `DecisionIssued`
- `AppealSubmitted`

Tables:

- current case state
- current assignee
- current risk score
- current SLA policy

### 24.2 Use case 1: enrich case events with current risk

```sql
CREATE STREAM enriched_case_events AS
SELECT
  e.case_id,
  e.event_type,
  e.event_time,
  r.risk_level,
  r.risk_score
FROM case_events e
LEFT JOIN case_risk_current r
  ON e.case_id = r.case_id
EMIT CHANGES;
```

Question:

```text
Is current risk at processing time acceptable?
```

If this is just operational dashboard, maybe yes.

If this is legal audit explaining why a decision was made, maybe no. You may need risk snapshot embedded in decision event or temporal risk history.

### 24.3 Use case 2: count escalations per office per day

```sql
CREATE TABLE daily_escalations_by_office AS
SELECT
  office_id,
  COUNT(*) AS escalation_count
FROM case_escalations
WINDOW TUMBLING (SIZE 1 DAY, GRACE PERIOD 12 HOURS)
GROUP BY office_id
EMIT CHANGES;
```

Why grace 12 hours?

Because field officers may sync late. But this must be based on measured data, not guesswork.

### 24.4 Use case 3: detect repeated evidence upload failures

```sql
CREATE TABLE evidence_failure_bursts AS
SELECT
  case_id,
  COUNT(*) AS failure_count
FROM evidence_upload_events
WINDOW SESSION (30 MINUTES)
WHERE status = 'FAILED'
GROUP BY case_id
HAVING COUNT(*) >= 3
EMIT CHANGES;
```

This detects failure bursts per case.

Important questions:

- What timestamp is used?
- Are retries separate events?
- Are duplicate failures idempotently handled?
- Does session merge change output?

### 24.5 Use case 4: join case opened and first assignment

```sql
CREATE STREAM case_opened_with_assignment AS
SELECT
  c.case_id,
  c.opened_at,
  a.assigned_to,
  a.assigned_team
FROM case_opened c
LEFT JOIN case_assigned a
  WITHIN 15 MINUTES
  ON c.case_id = a.case_id
EMIT CHANGES;
```

This is stream-stream join because both are facts.

Need to define:

- should assignment after 15 minutes be ignored or treated as late?
- should left output with null assignment trigger alert?
- should assignment before case opened be allowed?
- what happens during replay?

### 24.6 Case management correctness invariant

For regulatory systems, define invariants explicitly:

```text
Every derived decision must be traceable to input events, event timestamps, query version, schema version, and state snapshot assumption.
```

Without this, stream processing output can be operationally useful but legally weak.

---

## 25. Practical Query Review Checklist

Before promoting a ksqlDB query to production, review:

### Semantics

- What is the business meaning of output?
- Is output a fact stream, changelog stream, or materialized view?
- Are intermediate updates acceptable?
- Are tombstones expected?

### Keying

- What is the Kafka key of each input?
- What is the output key?
- Does `GROUP BY` or `JOIN` require repartition?
- Does repartition change ordering domain?

### Time

- What timestamp is used?
- Is event time configured correctly?
- What is lateness distribution?
- What is grace period?
- What happens to events after grace?

### State

- Does query create state store?
- How large can state grow?
- Is state windowed/bounded?
- What is changelog topic config?
- What is restore time objective?

### Operations

- How many internal topics are created?
- What is expected throughput?
- What is consumer lag alert?
- What is skipped record alert?
- What is state restoration alert?
- Who owns query lifecycle?

### Failure

- What happens during restart?
- What happens during rebalance?
- What happens if table side is unavailable/not restored?
- What happens if schema changes?
- What happens with duplicates?

---

## 26. Latihan / Thought Exercises

### Exercise 1 — Stream-table correctness

Kamu punya `transactions` stream dan `customer_risk` table. Kamu membuat stream-table join untuk enrich transaction dengan risk level.

Pertanyaan:

1. Jika risk berubah 5 menit setelah transaksi, apakah enriched transaction lama berubah?
2. Jika risk update datang terlambat, apakah transaction sudah terlanjur enriched dengan risk lama?
3. Apakah output ini valid untuk audit fraud decision?
4. Apa alternatif desain jika butuh risk as-of transaction time?

### Exercise 2 — Window grace

Mobile inspector bisa offline 4 jam sebelum sync event. Query menghitung `EvidenceUploaded` per day dengan grace 10 menit.

Pertanyaan:

1. Apa yang terjadi pada upload event terlambat?
2. Apakah aggregate harian authoritative?
3. Bagaimana kamu menentukan grace yang benar?
4. Apakah perlu reconciliation pipeline?

### Exercise 3 — Repartition cost

Topic `orders` keyed by `order_id`, throughput 50k records/s. Kamu membuat 5 query berbeda group by `customer_id`, `merchant_id`, `region_id`, `product_id`, dan `campaign_id`.

Pertanyaan:

1. Berapa repartition stream yang mungkin tercipta?
2. Apa dampak storage/network?
3. Apakah lebih baik membuat curated topics?
4. Key mana yang seharusnya dipilih upstream?

### Exercise 4 — Table output consumed wrongly

`customer_order_total` adalah ksqlDB table output. Tim downstream menganggap setiap record output adalah fakta “customer spent X more” dan melakukan insert append-only.

Pertanyaan:

1. Mengapa total mereka double-count?
2. Bagaimana seharusnya mereka consume changelog table output?
3. Naming atau contract apa yang bisa mencegah salah paham?

### Exercise 5 — Regulatory defensibility

Sistem membuat daily SLA breach aggregate dari stream `case_events`. Ada event koreksi yang datang 2 hari setelah window ditutup.

Pertanyaan:

1. Apakah window aggregate real-time harus berubah?
2. Apakah correction event harus masuk pipeline terpisah?
3. Bagaimana membuat audit trail yang menjelaskan perubahan laporan?
4. Apa beda dashboard operational dan report authoritative?

---

## 27. Ringkasan

Part ini membangun pemahaman advanced ksqlDB:

1. ksqlDB query bukan sekadar SQL; persistent query menjadi Kafka Streams application yang terus berjalan.
2. Join dan aggregation adalah stateful operation yang bergantung pada key, partitioning, time, dan state store.
3. Stream-stream join membutuhkan window karena kedua sisi adalah event stream yang tidak bounded.
4. Stream-table join cocok untuk enrichment dengan latest state, tetapi tidak otomatis historical-correct.
5. Table-table join memelihara materialized view yang berubah ketika salah satu table berubah.
6. Co-partitioning adalah requirement fundamental agar matching records diproses bersama.
7. Repartition memberi fleksibilitas tetapi mahal secara network, storage, latency, dan ordering semantics.
8. Windowing membuat stream processing bounded, tetapi memperkenalkan keputusan tentang event time, grace period, late events, dan finality.
9. Aggregation menghasilkan changelog update, bukan selalu append-only business fact.
10. State store dan changelog topic adalah bagian critical dari fault tolerance.
11. Hasil query yang salah biasanya bisa ditelusuri melalui key, partition, timestamp, window, join type, state, dan internal topics.
12. Untuk regulatory/case management systems, semantics waktu dan state harus eksplisit agar output defensible.

---

## 28. Referensi

Referensi yang relevan untuk part ini:

1. Confluent Docs — ksqlDB Joins Overview  
   https://docs.confluent.io/platform/current/ksqldb/developer-guide/joins/overview.html

2. Confluent Docs — Partition Data to Enable Joins in ksqlDB  
   https://docs.confluent.io/platform/current/ksqldb/developer-guide/joins/partition-data.html

3. Confluent Docs — Join Event Streams with ksqlDB  
   https://docs.confluent.io/platform/current/ksqldb/developer-guide/joins/join-streams-and-tables.html

4. Confluent Docs — Time and Windows in ksqlDB Queries  
   https://docs.confluent.io/platform/current/ksqldb/concepts/time-and-windows-in-ksqldb-queries.html

5. Confluent Docs — ksqlDB Queries  
   https://docs.confluent.io/platform/current/ksqldb/concepts/queries.html

6. Confluent Docs — Architecture of ksqlDB  
   https://docs.confluent.io/platform/current/ksqldb/operate-and-deploy/how-it-works.html

7. Confluent Docs — Materialized Views in ksqlDB  
   https://docs.confluent.io/platform/current/ksqldb/concepts/materialized-views.html

8. Confluent Docs — ksqlDB Performance Guidelines  
   https://docs.confluent.io/platform/current/ksqldb/operate-and-deploy/performance-guidelines.html

9. Confluent Docs — ksqlDB Processing Guarantees  
   https://docs.confluent.io/platform/current/ksqldb/operate-and-deploy/processing-guarantees.html

10. Apache Kafka / Confluent Kafka Streams Concepts  
    https://docs.confluent.io/platform/current/streams/concepts.html

---

## 29. Status Seri

Progress seri:

```text
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
```

Seri belum selesai.

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-019.md
```

Topik berikutnya:

```text
Kafka Streams Fundamentals for Java Engineers
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — ksqlDB Fundamentals: Streams, Tables, Persistent Queries, Push/Pull Queries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-019.md">Part 019 — Kafka Streams Fundamentals for Java Engineers ➡️</a>
</div>

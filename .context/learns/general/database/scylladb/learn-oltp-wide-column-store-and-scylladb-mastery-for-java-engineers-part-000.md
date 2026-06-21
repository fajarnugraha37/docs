# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-000.md

# Part 000 — Orientation: OLTP Wide-Column Store, ScyllaDB, dan Cara Belajar Seri Ini

> Seri: **OLTP, Wide-Column Store, and ScyllaDB Mastery for Java Engineers**  
> Target pembaca: Java/backend engineer yang sudah punya exposure ke SQL, PostgreSQL/MySQL, Redis, MongoDB, Kafka/RabbitMQ, ClickHouse, HTTP, dan sistem backend produksi.  
> Tujuan part ini: membangun peta mental sebelum masuk ke CQL, partition key, storage engine, Java driver, consistency level, operasi cluster, dan failure modelling.

---

## 0.1. Kenapa Seri Ini Perlu Dipelajari Secara Berbeda

ScyllaDB bukan sekadar database lain yang bisa dipelajari dengan menghafal syntax `CREATE TABLE`, `INSERT`, `SELECT`, lalu langsung dipakai seperti SQL. Kalau cara belajarnya seperti itu, biasanya hasilnya buruk: query tidak bisa dijalankan tanpa `ALLOW FILTERING`, partition membengkak, node tertentu panas, retry menggandakan efek write, tombstone menumpuk, p99 latency liar, dan tim aplikasi bingung kenapa database yang katanya cepat justru terasa rapuh.

Wide-column store harus dipelajari dari **bentuk fisik data dan bentuk query**. Relational database melatih kita memikirkan model logis dulu: entity, relationship, normalisasi, constraint, join, index, optimizer. Document database melatih kita memikirkan aggregate document dan embedding/reference. Redis melatih kita memikirkan struktur data in-memory, TTL, dan latency rendah. Kafka melatih kita memikirkan log, ordering, consumer group, dan replay. ClickHouse melatih kita memikirkan scan kolom, part, merge, partitioning, dan analytical throughput.

ScyllaDB melatih sesuatu yang lain:

```text
access pattern -> partition key -> replica set -> shard -> SSTable/read path -> consistency/latency/correctness contract
```

Dengan kata lain, ScyllaDB bukan database yang bertanya, “data kamu secara logis berelasi bagaimana?” Pertanyaan yang lebih tepat adalah:

```text
Untuk setiap request produksi yang penting:
1. key apa yang diketahui saat request masuk?
2. berapa banyak partition yang harus disentuh?
3. dalam satu partition, range mana yang dibaca?
4. berapa besar partition itu sekarang dan nanti?
5. replica mana yang harus menjawab?
6. consistency level apa yang cukup benar untuk invariant bisnis?
7. apa yang terjadi kalau write timeout tapi sebagian replica sudah menerima mutation?
8. bagaimana data yang diduplikasi akan diperbaiki bila salah satu write gagal?
9. apakah pola delete/TTL akan menghasilkan tombstone storm?
10. apakah driver Java mengirim request ke shard yang tepat?
```

Ini adalah seri tentang menjawab pertanyaan-pertanyaan itu dengan disiplin engineering.

---

## 0.2. Apa yang Akan Dibangun oleh Seri Ini

Setelah menyelesaikan seri ini, targetnya bukan hanya “bisa pakai ScyllaDB”. Targetnya adalah mampu:

1. **Mendesain tabel ScyllaDB dari access pattern**, bukan dari ERD.
2. **Membedakan query murah, query mahal, dan query yang secara model salah.**
3. **Memilih partition key dan clustering key** dengan mempertimbangkan cardinality, hot key, retention, sort order, dan query range.
4. **Menggunakan consistency level secara sadar**, bukan hanya ikut default.
5. **Memahami write path dan read path** sampai cukup untuk menjelaskan p99 latency spike.
6. **Menggunakan Java driver dengan benar**, termasuk session lifecycle, prepared statement, paging, async API, retry, idempotency, token/shard awareness.
7. **Mendesain duplicate table dan derived view** tanpa kehilangan kontrol terhadap consistency antar tabel.
8. **Menganalisis failure mode** seperti node down, partial write, timeout, tombstone storm, compaction debt, hot partition, disk saturation, dan cross-shard overhead.
9. **Menyusun production readiness review** untuk sistem berbasis ScyllaDB.
10. **Berpikir seperti engineer produksi**, bukan hanya developer yang menjalankan query dari tutorial.

Top 1% di area ini bukan orang yang paling banyak hafal command. Top 1% adalah orang yang bisa membaca requirement bisnis, mengubahnya menjadi model data fisik, menghitung risikonya, memprediksi failure mode-nya, menginstrumentasi sistemnya, dan menjelaskan trade-off-nya ke tim aplikasi, SRE, security, dan product.

---

## 0.3. Batasan Seri Ini Agar Tidak Mengulang Materi Lama

Kamu sudah punya atau sudah pernah meminta seri tentang Git, HTTP frontend/backend, Nginx, SQL, PostgreSQL, MySQL, Kafka, RabbitMQ, Redis, MongoDB, dan ClickHouse. Jadi seri ini tidak akan mengulang panjang materi berikut:

| Area yang tidak diulang panjang | Kenapa tidak diulang | Hanya dipakai sebagai pembanding ketika |
|---|---|---|
| Normalisasi SQL | Sudah covered di SQL/PostgreSQL/MySQL | Menjelaskan kenapa ScyllaDB sengaja denormalized |
| Join optimizer | Tidak relevan sebagai tool utama ScyllaDB | Membandingkan query flexibility SQL vs query predictability ScyllaDB |
| B-tree index | Sudah covered di RDBMS | Menjelaskan kenapa secondary index di wide-column store punya cost model berbeda |
| ACID transaction multi-row | Sudah covered di SQL | Menjelaskan batas atomicity dan LWT |
| MongoDB document embedding | Sudah covered di document DB | Membandingkan aggregate document vs partition/clustering row |
| Redis cache/TTL/rate limit | Sudah covered di Redis | Membandingkan TTL ScyllaDB dan tombstone impact |
| Kafka ordering/replay | Sudah covered di Kafka | Membahas ingestion/backfill/CDC hanya dari sisi storage target |
| ClickHouse OLAP columnar | Sudah covered di OLAP | Menegaskan wide-column OLTP bukan columnar analytical engine |
| HTTP/API fundamentals | Sudah covered | Hanya digunakan ketika mapping request API ke access pattern |
| Docker/Kubernetes basics | Sudah covered | Hanya dibahas saat deployment/ops ScyllaDB yang spesifik |

Dengan batasan ini, seri akan efisien: kita tidak membangun ulang semua konsep distributed systems dari nol, tapi mengarahkan konsep yang sudah kamu punya ke bentuk kerja ScyllaDB.

---

## 0.4. ScyllaDB dalam Satu Kalimat yang Tidak Menyesatkan

ScyllaDB adalah **distributed NoSQL wide-column database** yang kompatibel dengan Apache Cassandra/CQL, dirancang untuk workload OLTP berskala besar dengan throughput tinggi dan latency rendah yang predictable, memakai arsitektur internal shard-per-core berbasis Seastar.

Kalimat itu padat, tapi setiap frasa punya konsekuensi:

| Frasa | Arti praktis | Konsekuensi desain |
|---|---|---|
| distributed | data tersebar di banyak node | setiap operasi punya konsekuensi network, replica, coordinator, failure |
| NoSQL | tidak bergantung pada relational algebra/join | model data harus mengikuti query, bukan sebaliknya |
| wide-column | data dikelompokkan dalam partition dan row yang diurutkan oleh clustering key | primary key menentukan bentuk fisik data dan query |
| Cassandra/CQL compatible | banyak konsep dan driver Cassandra berlaku | jangan menyamakan CQL dengan SQL |
| OLTP | operasi kecil, sering, latency-sensitive | scan besar/ad-hoc query bukan target utama |
| high throughput | mampu menangani banyak request bila model benar | model salah bisa tetap menghancurkan cluster |
| low latency | arsitektur menghindari bottleneck shared state | p99 tetap bisa rusak karena tombstone, hot key, compaction, network, driver |
| shard-per-core | satu node dibagi menjadi shard internal per CPU core | client routing dan cross-shard behavior menjadi penting |

Dokumentasi resmi ScyllaDB menyatakan ScyllaDB sebagai pengganti/drop-in replacement untuk Apache Cassandra 3.11 dengan tambahan fitur dari Cassandra 4.0, kompatibel dengan CQL 3.3.1 dan protocol v4 dengan tambahan fitur dari versi lebih baru. Dokumentasi ScyllaDB juga menjelaskan bahwa CQL driver kompatibel dapat bekerja dengan ScyllaDB, sedangkan driver ScyllaDB menambahkan optimisasi seperti shard-aware routing.

---

## 0.5. Wide-Column Store: Nama yang Sering Menjebak

Istilah “wide-column” sering membuat orang salah paham. Banyak engineer mengira wide-column berarti sama seperti “columnar database” semacam ClickHouse, BigQuery, atau Parquet. Itu salah.

Wide-column store di keluarga Cassandra/ScyllaDB berarti:

```text
row dikelompokkan dalam partition,
partition bisa memiliki banyak row,
row diurutkan oleh clustering key,
kolom bisa sparse,
dan akses paling efisien terjadi ketika query mengarah ke partition tertentu.
```

Column-oriented OLAP berarti:

```text
nilai dari kolom yang sama disimpan bersama,
scan/aggregation atas banyak row dibuat efisien,
compression dan vectorized execution sangat penting,
dan query analytical/ad-hoc menjadi target utama.
```

Perbedaan ini fundamental.

| Dimensi | Wide-column OLTP, ScyllaDB | Columnar OLAP, ClickHouse-like |
|---|---|---|
| Unit akses utama | partition key + clustering range | kolom + part + segment scan |
| Query ideal | lookup/range kecil yang predictable | scan/aggregate besar |
| Latency target | rendah per request | throughput scan/aggregate |
| Data modeling | query-first denormalized table | analytical schema, sort key, partition, materialized aggregate |
| Update pattern | banyak write kecil | append/batch lebih natural |
| Join/ad-hoc | sangat terbatas | bisa ada, tapi tetap cost-aware |
| Failure utama | hot partition, tombstone, consistency ambiguity | merge backlog, partition pruning buruk, memory spill |

Jadi kalau ada requirement seperti:

```text
Tampilkan 50 event terbaru milik user X.
Ambil status terakhir device Y.
Cari semua transaksi merchant M pada bucket hari tertentu.
Cek apakah idempotency key K sudah pernah diproses.
Ambil 100 kasus enforcement milik tenant T dalam state S dengan urutan update terbaru.
```

ScyllaDB bisa cocok, asalkan key dan range-nya jelas.

Tapi kalau requirement-nya:

```text
Buat laporan revenue per kota per bulan untuk semua merchant selama 5 tahun.
Cari semua user yang memenuhi filter arbitrer dari 20 atribut.
Join order, customer, product, shipment, refund secara dinamis.
Eksplorasi data interaktif oleh analyst.
```

Maka ScyllaDB bukan pilihan utama. Untuk itu, relational/OLAP/search engine lebih masuk akal.

---

## 0.6. Mental Model Pertama: Query adalah Bentuk Fisik

Di SQL, kamu bisa mulai dari model domain:

```text
Customer
Order
OrderItem
Payment
Shipment
```

Lalu normalisasi, buat foreign key, index, dan membiarkan optimizer memilih plan.

Di ScyllaDB, pendekatannya dibalik:

```text
Query: get latest 20 orders by customer
Table: orders_by_customer
Primary key: ((customer_id, bucket_month), order_created_at DESC, order_id)
```

Query melahirkan tabel. Tabel bukan representasi netral dari domain. Tabel adalah materialisasi dari jalur baca/tulis tertentu.

Contoh satu domain bisa punya banyak tabel:

```text
orders_by_customer_month
orders_by_merchant_day
order_by_id
orders_by_payment_status_day
orders_by_fraud_review_state
idempotency_by_key
```

Tabel-tabel itu bisa menyimpan data yang tumpang tindih. Ini bukan pelanggaran desain. Ini desain yang disengaja untuk menghindari query mahal saat runtime.

Konsekuensinya: correctness tidak lagi hanya urusan database. Aplikasi harus bertanggung jawab untuk:

1. menulis ke beberapa tabel secara idempotent,
2. menangani partial failure,
3. memperbaiki derived table bila ada drift,
4. menentukan apakah stale read masih bisa diterima,
5. memisahkan invariant yang butuh LWT dari invariant yang cukup eventual,
6. menjaga agar data model tetap sesuai access pattern ketika product berkembang.

Ini alasan seri ini akan sangat menekankan **application-data contract**, bukan hanya database internals.

---

## 0.7. Mental Model Kedua: Partition adalah Boundary Paling Penting

Partition adalah konsep pusat. Banyak masalah ScyllaDB bisa dibaca dari partition.

Partition key menentukan:

1. data masuk token range mana,
2. replica set mana yang menyimpan data,
3. shard mana yang akan menangani data di node,
4. apakah write/read tersebar merata,
5. apakah query bisa single-partition atau fanout,
6. apakah partition akan tumbuh sehat atau menjadi monster,
7. apakah satu tenant/user/entity bisa membuat hotspot.

Contoh desain buruk:

```sql
CREATE TABLE events_by_type (
  event_type text,
  event_time timestamp,
  event_id uuid,
  payload text,
  PRIMARY KEY ((event_type), event_time, event_id)
);
```

Kalau `event_type = 'CLICK'` menerima 80% traffic global, partition `CLICK` akan menjadi sangat panas dan sangat besar. Ini bukan masalah “kurang index”. Ini masalah bentuk fisik.

Desain yang lebih waras mungkin:

```sql
CREATE TABLE events_by_type_day_bucket (
  event_type text,
  day date,
  bucket int,
  event_time timestamp,
  event_id uuid,
  payload text,
  PRIMARY KEY ((event_type, day, bucket), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC);
```

Tapi desain ini juga tidak otomatis benar. Kita harus menjawab:

1. bucket dihitung dari apa?
2. berapa banyak bucket?
3. query membaca berapa bucket?
4. apakah query “latest 100” harus merge dari semua bucket?
5. apakah event datang out-of-order?
6. berapa retention?
7. apakah TTL menghasilkan tombstone berbahaya?
8. apakah p99 masih stabil ketika satu bucket panas?

Jadi partisi bukan sekadar syntax primary key. Partition adalah unit distribusi, unit locality, unit scale, dan sering kali unit correctness.

---

## 0.8. Mental Model Ketiga: Clustering Key adalah Urutan dalam Partition

Kalau partition key menjawab “data ini berada di kelompok mana”, clustering key menjawab “dalam kelompok itu data disusun bagaimana”.

Contoh:

```sql
PRIMARY KEY ((customer_id, month), created_at, order_id)
WITH CLUSTERING ORDER BY (created_at DESC);
```

Artinya:

```text
Partition: semua order customer tertentu dalam bulan tertentu.
Urutan row dalam partition: created_at descending, lalu order_id sebagai tie breaker.
```

Query ideal:

```sql
SELECT * FROM orders_by_customer_month
WHERE customer_id = ?
  AND month = ?
LIMIT 20;
```

atau:

```sql
SELECT * FROM orders_by_customer_month
WHERE customer_id = ?
  AND month = ?
  AND created_at >= ?
  AND created_at < ?;
```

Query buruk:

```sql
SELECT * FROM orders_by_customer_month
WHERE customer_id = ?
  AND status = 'PAID';
```

Kenapa buruk? Karena `status` bukan bagian dari key yang menentukan layout. Database harus memeriksa row di partition untuk mencari status tersebut. Kalau partition besar, ini mahal. Kalau dilakukan terus, ini workload design bug.

Solusinya bukan selalu index. Solusinya sering kali tabel lain:

```sql
orders_by_customer_status_month
orders_by_status_day
orders_by_merchant_status_day
```

Di ScyllaDB, desain tabel adalah precomputed access path.

---

## 0.9. Mental Model Keempat: Consistency adalah Kontrak per Operasi

ScyllaDB/Cassandra-style system memiliki tunable consistency. Untuk setiap operasi, client bisa menentukan berapa banyak replica yang harus memberi acknowledgement sebelum operasi dianggap sukses.

Contoh level yang sering muncul:

| Consistency Level | Intuisi kasar | Risiko / trade-off |
|---|---|---|
| ONE | cukup satu replica menjawab | latency/availability baik, stale read lebih mungkin |
| LOCAL_QUORUM | mayoritas replica di local DC | umum untuk multi-DC OLTP yang butuh balance correctness-latency |
| QUORUM | mayoritas replica global | lebih mahal di multi-DC karena cross-region |
| ALL | semua replica harus menjawab | consistency tinggi, availability rendah |
| SERIAL / LOCAL_SERIAL | digunakan untuk LWT/CAS | jauh lebih mahal, harus dibatasi |

Yang sering keliru: engineer menganggap `QUORUM` berarti “sudah seperti SQL transaction”. Tidak. Quorum adalah aturan acknowledgement replica, bukan isolation level relational multi-row.

Pertanyaan yang lebih benar:

```text
Apakah use case ini butuh latest value secara kuat?
Apakah stale read beberapa ratus ms/detik masih aman?
Apakah double submit bisa ditoleransi?
Apakah idempotency key harus unik secara linearizable?
Apakah state transition boleh last-write-wins?
Apa yang terjadi kalau write timeout tapi satu replica sudah menerima mutation?
```

Pada sistem regulasi, enforcement, case lifecycle, atau platform audit, pertanyaan seperti ini bukan detail teknis kecil. Ini bagian dari defensibility sistem.

---

## 0.10. Mental Model Kelima: Write Sukses, Write Gagal, dan Write Ambiguous

Dalam single-node database, banyak engineer terbiasa dengan jawaban sederhana:

```text
commit success -> data masuk
commit failed -> data tidak masuk
```

Di distributed database, ada state ketiga yang sangat penting:

```text
client melihat failure/timeout, tetapi sebagian replica mungkin sudah menerima write
```

Ini disebut ambiguity dari perspektif client. Contoh:

1. Client mengirim write dengan CL `QUORUM`, RF=3.
2. Replica A menerima dan menulis mutation.
3. Replica B lambat.
4. Replica C unreachable.
5. Coordinator timeout sebelum quorum terpenuhi.
6. Client menerima error.
7. Tapi data di Replica A mungkin tetap ada dan nanti bisa menyebar via repair/anti-entropy.

Kalau aplikasi otomatis retry write yang tidak idempotent, hasilnya bisa kacau.

Contoh buruk:

```text
POST /wallet/debit amount=100
write timeout
retry
write timeout
retry
```

Kalau setiap retry menghasilkan mutation baru tanpa idempotency key, balance bisa terpotong lebih dari sekali.

Pola yang lebih benar:

```text
command_id = UUID dari client/business operation
write ledger entry dengan command_id sebagai bagian dari primary key atau uniqueness guard
retry aman karena command yang sama tidak menghasilkan efek ganda
```

Seri ini akan sering kembali ke prinsip ini: **distributed database error handling harus diasumsikan ambiguous sampai dibuktikan sebaliknya.**

---

## 0.11. Mental Model Keenam: Low Latency Bukan Default, Melainkan Hasil Desain

ScyllaDB dirancang untuk throughput tinggi dan latency rendah. Namun desain database tidak menyelamatkan workload yang bentuknya buruk.

Latency bisa rusak karena:

1. partition terlalu besar,
2. partition terlalu panas,
3. query membaca banyak partition,
4. query memakai filtering,
5. page size terlalu besar,
6. tombstone terlalu banyak,
7. compaction tertinggal,
8. disk saturated,
9. network cross-DC,
10. driver tidak token/shard-aware,
11. retry storm dari aplikasi,
12. timeout terlalu agresif,
13. GC atau event-loop starvation di service Java,
14. client concurrency tidak dibatasi,
15. request menyentuh derived table terlalu banyak.

Jadi kalimat “ScyllaDB cepat” harus diterjemahkan menjadi:

```text
ScyllaDB bisa sangat cepat jika data model, driver routing, consistency level,
resource isolation, compaction, dan operasi cluster selaras dengan workload.
```

Ini bukan pesimisme. Ini cara berpikir production.

---

## 0.12. ScyllaDB vs Cassandra: Kompatibel Bukan Identik

ScyllaDB kompatibel dengan Cassandra di banyak level, terutama CQL dan wire protocol, sehingga banyak tooling/driver Cassandra bisa digunakan. Tetapi ScyllaDB bukan Cassandra yang hanya “ditulis ulang lebih cepat”. Ada perbedaan arsitektur yang penting.

ScyllaDB menggunakan C++ dan Seastar dengan model shard-per-core. Setiap core menjalankan shard database sendiri dengan resource yang lebih terisolasi. Komunikasi antar core dilakukan eksplisit, bukan bergantung pada shared mutable state dan lock-heavy concurrency seperti model tradisional.

Dampak praktis:

1. CPU core bukan hanya kapasitas abstrak; setiap core/shard punya ownership data dan queue sendiri.
2. Request yang sampai ke shard yang salah bisa perlu forwarding internal.
3. Driver shard-aware dapat mengurangi hop internal.
4. Observability harus bisa membaca imbalance per shard, bukan hanya rata-rata node.
5. Sizing dan tuning OS/CPU/disk lebih penting daripada pada banyak service stateless biasa.

Di seri ini, Cassandra concepts akan digunakan sebagai fondasi konseptual, tapi ScyllaDB-specific internals akan dibahas sebagai hal yang mempengaruhi desain dan operasi.

---

## 0.13. OLTP: Yang Sebenarnya Kita Maksud

OLTP sering didefinisikan sebagai Online Transaction Processing. Tapi definisi textbook terlalu umum. Dalam konteks seri ini, OLTP berarti:

```text
banyak request kecil,
latency-sensitive,
concurrent,
berhubungan dengan state operasional,
sering berada di jalur user-facing atau machine-facing real-time,
dan membutuhkan correctness contract yang jelas.
```

Contoh workload OLTP yang cocok untuk wide-column store:

| Workload | Kenapa cocok |
|---|---|
| user timeline | query latest/range by user/time bucket |
| device telemetry latest/range | entity + time bucket natural |
| session/event store | high write, lookup by key/entity/time |
| fraud/case event history | append-heavy, read by case/tenant/status |
| notification inbox | per-user partition + time ordered feed |
| idempotency/dedup store | key lookup, TTL, high concurrency |
| order/activity feed | entity-scoped timeline |
| large-scale preference/state lookup | key-based access predictable |
| audit event by subject | subject/time partitioning |
| enforcement lifecycle projections | table-per-query for operational screens |

Workload OLTP yang sering tidak cocok:

| Workload | Kenapa kurang cocok |
|---|---|
| ad-hoc reporting | ScyllaDB tidak punya optimizer/join/scan fleksibel seperti SQL/OLAP |
| arbitrary filtering | secondary index tidak menggantikan search engine atau relational index strategy |
| multi-entity transaction kompleks | LWT terbatas dan mahal; bukan pengganti relational transaction luas |
| small dataset with rich query | relational database lebih simpel |
| graph traversal | bukan graph database |
| full-text search | butuh search engine |
| analytical aggregation besar | pakai OLAP/columnar engine |

Salah satu skill penting adalah berani berkata: **jangan pakai ScyllaDB untuk ini**. Top engineer tidak memaksakan tool.

---

## 0.14. Apa Itu “Query-First” Secara Konkret

Query-first bukan berarti kita tidak peduli domain. Domain tetap penting. Tapi urutan berpikirnya berbeda.

Urutan relational umum:

```text
entity -> relationship -> normalized table -> index -> query
```

Urutan ScyllaDB:

```text
user journey / API / background job
-> access pattern
-> required key known at runtime
-> cardinality and volume estimate
-> partition design
-> clustering/sort design
-> table-per-query
-> write fanout and consistency strategy
-> operational guardrail
```

Contoh requirement:

```text
Compliance officer membuka dashboard tenant dan melihat 50 case terbaru yang state-nya NEEDS_REVIEW.
Filter tenant wajib. Sort by last_updated_at descending. Data retention 3 tahun. Jumlah tenant besar. Beberapa tenant enterprise bisa sangat panas.
```

Pendekatan ScyllaDB:

```text
Query name:
  list_recent_cases_by_tenant_state

Runtime keys known:
  tenant_id, state

Sort:
  last_updated_at desc

Potential table:
  cases_by_tenant_state_month

Primary key sketch:
  ((tenant_id, state, month_bucket, shard_bucket), last_updated_at, case_id)

Need to answer:
  - Apakah month_bucket cukup?
  - Apakah perlu shard_bucket untuk tenant besar?
  - Berapa bucket yang dibaca untuk page pertama?
  - Bagaimana cursor pagination?
  - Bagaimana update state menghapus/menandai row lama?
  - Apakah duplicate row antar state bisa muncul saat partial failure?
  - Apakah screen boleh eventual consistency?
  - Bagaimana backfill ketika state model berubah?
```

Kita tidak langsung menulis CQL. Kita mengaudit access pattern dulu.

---

## 0.15. Unit Desain: Table Bukan Entity

Dalam SQL, tabel sering merepresentasikan entity atau relationship:

```text
case
case_event
case_assignee
case_status_history
```

Dalam ScyllaDB, tabel sering merepresentasikan pertanyaan:

```text
case_by_id
case_events_by_case
cases_by_tenant_state_month
cases_by_assignee_due_date
cases_by_regulatory_program_state
case_transition_idempotency
case_audit_events_by_subject_month
```

Ini mengubah ownership desain. Kalau product menambah screen baru, mungkin perlu tabel baru. Kalau screen mengubah sort/filter, mungkin perlu primary key baru dan migrasi data.

Jangan anggap ini kelemahan murni. Ini trade-off:

| Keuntungan | Harga yang dibayar |
|---|---|
| Query sangat predictable | Data diduplikasi |
| Latency rendah untuk access pattern penting | Ad-hoc query lemah |
| Scale-out write/read bagus | Aplikasi mengelola consistency antar table |
| Tidak bergantung pada optimizer kompleks | Desain harus benar sejak awal |
| Bisa menangani volume besar | Operasi cluster dan data lifecycle serius |

Di sistem enterprise/regulatory, trade-off ini bisa sangat masuk akal bila access pattern stabil, volume tinggi, dan latency/availability penting.

---

## 0.16. Vocabulary Dasar yang Harus Bersih Sejak Awal

Sebelum masuk part berikutnya, vocabulary harus tepat.

### Keyspace

Namespace yang berisi table dan replication configuration. Dalam SQL, kadang orang mengibaratkan keyspace seperti database/schema, tapi analoginya tidak sempurna. Yang penting: replication strategy dan RF biasanya didefinisikan pada level keyspace.

### Table

Struktur CQL yang menyimpan row. Dalam ScyllaDB, table idealnya mewakili access pattern tertentu.

### Partition key

Bagian dari primary key yang menentukan partition. Partition key di-hash menjadi token, lalu token menentukan distribusi data ke cluster/tablet/replica.

### Partition

Kumpulan row yang memiliki partition key sama. Partition adalah unit locality logis utama.

### Clustering key

Bagian primary key setelah partition key yang menentukan urutan row dalam partition.

### Row

Record dalam partition. Uniknya ditentukan oleh partition key + clustering key.

### Column

Field dalam row. Kolom bisa regular, static, collection, UDT, counter, dan lain-lain.

### Replica

Salinan data pada node tertentu sesuai replication factor dan strategy.

### Coordinator

Node yang menerima request client dan mengoordinasikan operasi ke replica yang tepat. Coordinator belum tentu replica untuk data itu.

### Consistency Level

Jumlah/jenis replica yang harus memberi acknowledgement agar operasi dianggap sukses oleh coordinator.

### Shard

Unit internal ScyllaDB per CPU core. Data dan request dipartisi lagi di dalam node agar tiap core menangani subset workload.

### Tablet

Unit distribusi data modern di ScyllaDB. Tabel dibagi menjadi tablets; tiap partition dipetakan secara deterministik ke tablet; tablet punya replica pada node berbeda sesuai RF.

### SSTable

File immutable di disk yang menyimpan data hasil flush dari memtable. Read path bisa melibatkan banyak SSTable jika compaction/read amplification tidak terkendali.

### Memtable

Struktur in-memory yang menerima write sebelum di-flush ke SSTable.

### Commitlog

Log durability untuk write sebelum data di-flush ke SSTable.

### Tombstone

Marker untuk delete/expired data. Tombstone penting untuk replikasi dan eventual deletion, tapi bisa menjadi sumber latency dan failure bila menumpuk.

### Repair

Proses sinkronisasi replica agar data yang berbeda antar replica diperbaiki.

---

## 0.17. CQL Bukan SQL

CQL sengaja terlihat mirip SQL agar familiar:

```sql
SELECT * FROM users WHERE user_id = ?;
```

Tapi mental model-nya berbeda.

Di SQL, query ini bertanya:

```text
optimizer, tolong cari plan terbaik untuk predicate ini.
```

Di CQL/ScyllaDB, query ini lebih seperti:

```text
saya berjanji predicate ini sesuai primary key/index/access path yang kamu punya.
kalau tidak, query ini ditolak atau menjadi mahal.
```

Contoh SQL yang normal:

```sql
SELECT *
FROM orders
WHERE customer_id = ?
  AND status = 'PAID'
  AND created_at >= ?
ORDER BY created_at DESC
LIMIT 50;
```

Di ScyllaDB, query seperti itu hanya sehat kalau tabel memang didesain untuk access pattern tersebut, misalnya:

```sql
CREATE TABLE paid_orders_by_customer_month (
  customer_id uuid,
  month text,
  created_at timestamp,
  order_id uuid,
  amount decimal,
  PRIMARY KEY ((customer_id, month), created_at, order_id)
) WITH CLUSTERING ORDER BY (created_at DESC);
```

Kalau status ingin difilter, biasanya status menjadi bagian partition key atau tabel terpisah:

```sql
CREATE TABLE orders_by_customer_status_month (
  customer_id uuid,
  status text,
  month text,
  created_at timestamp,
  order_id uuid,
  amount decimal,
  PRIMARY KEY ((customer_id, status, month), created_at, order_id)
) WITH CLUSTERING ORDER BY (created_at DESC);
```

CQL bukan relational algebra. CQL adalah interface untuk access path yang sudah kamu desain.

---

## 0.18. Denormalization Bukan Dosa, Tapi Kontrak

Di ScyllaDB, denormalization bukan workaround. Ia adalah pola utama.

Namun denormalization berarti kamu membuat kontrak baru:

```text
Jika data order berubah, semua table projection yang relevan harus ikut berubah.
Jika salah satu update gagal, sistem harus bisa mendeteksi/memperbaiki divergence.
Jika ada duplicate event, write harus idempotent.
Jika ada schema baru, backfill harus aman.
```

Contoh projection:

```text
order_by_id
orders_by_customer_month
orders_by_merchant_day
orders_by_status_day
orders_by_risk_review_queue
```

Satu business event `OrderPaid` mungkin menghasilkan mutation ke beberapa tabel.

Ada beberapa pola:

### Synchronous fanout

Aplikasi menulis semua tabel dalam request yang sama.

Kelebihan:

```text
read path segera tersedia
sederhana untuk volume kecil-menengah
```

Kekurangan:

```text
latency write bertambah
partial failure sulit
retry harus sangat hati-hati
```

### Asynchronous projection

Aplikasi menulis source-of-truth/event log lalu worker membangun projection.

Kelebihan:

```text
write path utama lebih kecil
projection bisa retry/backfill
lebih jelas untuk eventual consistency
```

Kekurangan:

```text
read path bisa stale
perlu monitoring lag dan reconciliation
butuh desain replay/idempotency
```

### Hybrid

Data kritis ditulis sinkron; projection sekunder dibangun async.

Top engineer tidak fanatik pada satu pola. Ia memilih berdasarkan invariant, latency, failure cost, dan operability.

---

## 0.19. “Source of Truth” di ScyllaDB Perlu Didefinisikan

Dalam relational system, sering ada satu normalized table yang dianggap authoritative. Di ScyllaDB, karena table-per-query, istilah source of truth harus lebih eksplisit.

Ada beberapa pilihan:

### 1. Entity table sebagai source of truth

Contoh:

```text
case_by_id
```

Projection lain seperti:

```text
cases_by_tenant_state_month
cases_by_assignee_due_date
case_events_by_case
```

bisa diperbaiki dari `case_by_id` dan event history.

### 2. Event history sebagai source of truth

Contoh:

```text
case_events_by_case
```

Current state adalah projection dari event.

### 3. External source of truth

Misalnya command/event masuk dari Kafka, dan ScyllaDB hanya menyimpan serving projection.

### 4. Multi-source yang harus direkonsiliasi

Ini paling berbahaya jika tidak ada aturan prioritas.

Sebelum mendesain tabel, tanyakan:

```text
Kalau dua tabel tidak konsisten, mana yang dipercaya?
Bagaimana membangun ulang tabel turunan?
Apakah ada event log untuk replay?
Apakah projection drift bisa dideteksi?
Berapa lama drift boleh terjadi?
```

Tanpa jawaban ini, denormalization menjadi utang operasional.

---

## 0.20. ScyllaDB dan Java Engineer: Titik-Titik yang Harus Dikuasai

Sebagai Java engineer, kamu akan berinteraksi dengan ScyllaDB terutama lewat driver dan service logic. Kesalahan umum terjadi bukan hanya di CQL, tapi di integration layer.

Hal yang harus dikuasai:

### Session lifecycle

`Session`/client object harus long-lived. Membuat session per request adalah anti-pattern.

### Prepared statement

Prepared statement harus digunakan untuk query stabil. Ia menghindari parsing berulang dan membantu driver mengetahui routing metadata.

### Bound statement

Bind value dengan tipe yang benar. Hindari string concatenation.

### Paging

Result set besar harus dipaging. Tetapi paging bukan izin untuk melakukan query yang secara model salah.

### Async API

Async API memungkinkan concurrency tinggi, tapi harus dibatasi. Tanpa bounded concurrency, service Java bisa membuat database overload.

### Retry policy

Retry hanya aman bila statement idempotent atau operation-level idempotency dijamin.

### Timeout

Timeout bukan hanya angka. Timeout menentukan kapan client menyerah, sementara server/replica mungkin masih memproses.

### Speculative execution

Bisa mengurangi tail latency, tapi bisa menggandakan load bila disalahgunakan.

### Token/shard awareness

Driver yang memahami token/shard bisa mengirim request lebih dekat ke pemilik data/shard yang tepat, mengurangi forwarding internal.

### Metrics

Metrics client sama pentingnya dengan metrics server. Banyak masalah terlihat lebih awal di client: queueing, timeout, retry, pool saturation, p99 per statement.

---

## 0.21. Perbedaan “Bisa Jalan” dan “Production-Ready”

Kode ini bisa jalan:

```java
session.execute("SELECT * FROM events WHERE user_id = " + userId);
```

Tapi production-ready membutuhkan pertanyaan:

```text
Apakah query memakai prepared statement?
Apakah user_id adalah full partition key?
Apakah partition user_id bisa terlalu besar?
Apakah result dipaging?
Apakah limit eksplisit?
Apakah consistency level sesuai?
Apakah timeout sesuai p99 target?
Apakah retry aman?
Apakah tracing bisa mengidentifikasi statement ini?
Apakah metrics per query tersedia?
Apakah tenant/user tertentu bisa membuat hotspot?
```

Seri ini akan terus menekan perbedaan tersebut.

---

## 0.22. Arsitektur Shard-per-Core: Kenapa Kamu Harus Peduli Walau Bukan DBA

Banyak application engineer berpikir internals database bukan urusan mereka. Di ScyllaDB, sebagian internals mempengaruhi cara aplikasi seharusnya mengirim request.

ScyllaDB menjalankan satu shard per core. Setiap shard punya resource sendiri dan bertanggung jawab atas subset data. Ini bagus untuk menghindari lock contention dan cache bouncing. Tetapi kalau request masuk ke core/shard yang tidak tepat, request bisa perlu diteruskan internal.

Aplikasi tidak harus mengelola shard secara manual, tapi harus:

1. menggunakan driver yang tepat,
2. menggunakan prepared statement agar routing metadata tersedia,
3. tidak menyembunyikan partition key dari driver,
4. menghindari query yang menyentuh terlalu banyak partition,
5. memonitor imbalance per shard,
6. memahami bahwa satu node “CPU 70%” bisa menyembunyikan satu shard 100%.

Ini mirip dengan memahami event loop di Netty atau Node.js: kamu tidak selalu menulis scheduler, tapi kamu harus tahu blocking call akan menghancurkan latency.

---

## 0.23. Tablets: Kenapa Seri Ini Akan Membahas ScyllaDB Modern

ScyllaDB modern menggunakan konsep tablets untuk distribusi data. Tabel dibagi menjadi tablets; setiap partition dipetakan ke tablet; tablet punya replica pada node berbeda sesuai replication factor. Tablets bisa dipindahkan untuk balancing dan bisa split saat tabel tumbuh.

Bagi application engineer, tablets tidak selalu terlihat di CQL, tapi penting untuk operasi:

1. scaling cluster,
2. balancing disk usage,
3. balancing shard load,
4. node replacement,
5. understanding data movement,
6. capacity planning,
7. operational risk saat topology berubah.

Kita akan membahas tablets bukan sebagai trivia internal, tapi sebagai bagian dari mental model produksi.

---

## 0.24. Tombstone: Konsep Kecil yang Sering Menjatuhkan Sistem Besar

Dalam ScyllaDB/Cassandra-style storage, delete dan TTL biasanya tidak langsung menghapus data fisik. Database menulis tombstone agar replica lain tahu bahwa data tersebut harus dianggap deleted.

Tombstone diperlukan karena distributed system harus menangani replica yang offline. Kalau data dihapus secara fisik langsung dari satu replica sementara replica lain belum tahu, data lama bisa hidup kembali ketika replica disinkronisasi. Tombstone mencegah zombie data.

Tapi tombstone juga bisa menjadi beban:

```text
query harus melewati banyak marker delete,
read latency naik,
compaction harus membersihkan,
repair/gc_grace_seconds mempengaruhi safety,
TTL-heavy workload bisa menghasilkan tombstone massal.
```

Jadi TTL bukan “free cleanup”. TTL adalah write lifecycle yang menghasilkan pekerjaan storage engine.

Contoh desain yang perlu hati-hati:

```text
session_by_user dengan TTL pendek tapi traffic sangat tinggi
idempotency_keys dengan TTL pendek dan cardinality besar
event table dengan TTL per row dan query range besar
queue-like table dengan delete setelah consume
```

Kita akan membahas tombstone lebih dalam karena ini salah satu penyebab paling umum ScyllaDB/Cassandra workload rusak.

---

## 0.25. Compaction: Garbage Collection untuk Storage, Tapi Bukan GC Biasa

SSTable immutable. Write baru tidak mengubah file lama di tempat; ia membuat data baru. Delete menulis tombstone. Update juga secara fisik adalah mutation baru. Akibatnya, storage engine perlu compaction untuk menggabungkan SSTable, membuang data lama/tombstone yang aman dibuang, dan mengurangi read amplification.

Compaction salah pilih atau tertinggal bisa menghasilkan:

1. read amplification tinggi,
2. disk space membengkak,
3. latency spike,
4. compaction backlog,
5. IO contention,
6. tombstone tetap terbaca terlalu lama,
7. operasi cluster menjadi lambat.

ScyllaDB menyediakan beberapa compaction strategy. Kita tidak akan menghafal nama strategy saja. Kita akan menganalisis:

```text
workload append-only atau update-heavy?
TTL seragam atau tidak?
read latest atau historical range?
partition tumbuh seiring waktu atau bounded?
space amplification mana yang bisa diterima?
read p99 lebih penting atau write throughput?
```

---

## 0.26. Index di ScyllaDB: Jangan Membawa Ekspektasi SQL Mentah-Mentah

Di SQL, index B-tree sering menjadi jawaban natural untuk predicate tambahan. Di ScyllaDB, secondary index bisa membantu kasus tertentu, tetapi bukan pengganti table-per-query.

Pertanyaan sebelum membuat index:

```text
Berapa cardinality kolom index?
Apakah predicate tersebar merata?
Apakah query masih perlu partition key?
Berapa banyak replica/partition yang akan disentuh?
Berapa write amplification?
Apakah stale/inconsistent view acceptable?
Apakah tabel duplicate lebih predictable?
```

Banyak query yang di SQL cukup ditangani dengan index, di ScyllaDB lebih benar dibuat sebagai tabel projection terpisah.

---

## 0.27. LWT: Bukan Transaction Serbaguna

Lightweight Transaction atau LWT menyediakan conditional mutation seperti:

```sql
INSERT INTO user_by_email (email, user_id)
VALUES (?, ?)
IF NOT EXISTS;
```

Ini berguna untuk uniqueness, reservation, compare-and-set, dan guard state transition tertentu. Tetapi LWT mahal karena membutuhkan koordinasi konsensus. LWT bukan alat untuk membuat semua write terasa seperti relational transaction.

Pola yang baik:

```text
gunakan LWT untuk invariant kecil dan jelas,
idealnya scoped ke partition sempit,
ukur throughput dan p99,
jangan pakai LWT dalam hot path volume tinggi tanpa budget,
pertimbangkan idempotency/reservation table sebagai desain eksplisit.
```

Pola buruk:

```text
semua update state pakai IF untuk merasa aman,
LWT dipakai di partition yang sangat panas,
LWT digabung dengan fanout table banyak,
retry LWT tanpa memahami timeout ambiguity.
```

---

## 0.28. Batch: Nama yang Menyesatkan

Di banyak database, batch berarti optimisasi throughput. Di ScyllaDB/Cassandra, batch punya semantics berbeda. Batch bukan cara umum untuk mempercepat banyak write ke banyak partition.

Batch berguna terutama untuk atomicity/logging tertentu pada mutation yang terkait, bukan untuk bulk loading sembarangan. Batch lintas partition bisa membebani coordinator dan batchlog.

Untuk high-volume ingestion, pola yang biasanya lebih sehat:

```text
prepared statement,
async write,
bounded concurrency,
partition-aware distribution,
idempotency,
backpressure,
load test,
monitoring compaction/write latency.
```

Kita akan membahas ini khusus karena Java engineer sering tergoda mengumpulkan ribuan write lalu “batch execute”.

---

## 0.29. Paging: Bukan Izin untuk Scan

Paging memungkinkan hasil query dibaca bertahap. Tetapi paging tidak membuat query buruk menjadi baik.

Query baik:

```text
single partition, clustering order sesuai kebutuhan, LIMIT jelas, page size masuk akal
```

Query buruk yang dipaging:

```text
scan banyak partition, filtering, hasil besar, user menekan next sampai ribuan page
```

Dalam API design, pagination harus dipikirkan bersama data model:

1. cursor berbasis clustering key,
2. tidak mengandalkan offset seperti SQL,
3. page size stabil,
4. batas maksimum eksplisit,
5. behavior saat data berubah di antara page jelas,
6. sort order sesuai clustering order.

---

## 0.30. Multi-Tenant: Tenant ID Hampir Selalu Bukan Detail

Banyak sistem enterprise/regulatory bersifat multi-tenant. Tenant bukan hanya atribut authorization. Tenant sering menjadi dimensi data distribution, rate limiting, backup/restore, dan blast radius.

Pertanyaan desain:

```text
Apakah tenant_id harus menjadi bagian partition key?
Apakah satu tenant bisa sangat besar?
Apakah tenant kecil banyak sekali?
Apakah query selalu scoped by tenant?
Apakah restore per tenant dibutuhkan?
Apakah data residency berbeda per tenant?
Apakah noisy tenant harus dibatasi?
Apakah ada tenant enterprise dengan traffic 1000x tenant biasa?
```

Contoh buruk:

```sql
PRIMARY KEY ((tenant_id), updated_at, case_id)
```

Jika satu tenant punya jutaan case aktif dan dashboard traffic tinggi, partition tenant bisa panas dan besar.

Lebih sehat mungkin:

```sql
PRIMARY KEY ((tenant_id, state, month_bucket, shard_bucket), updated_at, case_id)
```

Tapi lagi-lagi, bucket menambah kompleksitas read. Desain selalu trade-off.

---

## 0.31. Multi-Region: Jangan Dicampur dengan “Tinggal Tambah DC”

ScyllaDB/Cassandra-style system mendukung multi-DC/multi-region topology, tetapi multi-region bukan fitur kosmetik. Ia mengubah latency, consistency, failure mode, cost, dan operability.

Pertanyaan utama:

```text
Apakah write aktif di banyak region?
Apakah konflik last-write-wins bisa diterima?
Apakah clock skew mempengaruhi correctness?
Apakah LOCAL_QUORUM cukup?
Bagaimana failover dilakukan?
Apakah client routing locality-aware?
Apakah data residency membatasi replica placement?
Apakah operasi repair/backup per region jelas?
```

Kalau business butuh active-active global writes dengan invariant kuat antar entity, ScyllaDB mungkin bukan satu-satunya komponen. Bisa perlu coordinator service, idempotency layer, conflict resolution domain-specific, atau desain ownership region.

---

## 0.32. Failure Modelling: Cara Membaca Sistem Ini Saat Rusak

ScyllaDB production incident jarang terlihat sebagai “database mati total”. Lebih sering gejalanya:

```text
p99 naik,
read timeout naik,
write timeout naik,
satu shard pegged,
compaction backlog meningkat,
disk utilization tidak seimbang,
tombstone warning muncul,
node tertentu overloaded,
client retry meningkat,
queue di service Java penuh,
sebagian endpoint lambat tapi endpoint lain normal.
```

Maka troubleshooting harus dimulai dari bentuk query dan partition:

```text
Endpoint apa yang lambat?
Statement apa yang dipanggil?
Partition key apa yang sering muncul?
Apakah key tertentu hot?
Apakah query membaca tombstone?
Apakah result terlalu besar?
Apakah consistency level berubah?
Apakah driver routing berubah?
Apakah node/shard tertentu menerima beban tidak proporsional?
Apakah compaction atau repair sedang berjalan?
```

Sistem seperti ini tidak cukup dimonitor dengan CPU average dan request count. Kita perlu query-level dan shard-level view.

---

## 0.33. Regulatory/Case Management Lens

Karena kamu bekerja di area regulatory systems, enforcement lifecycle, dan complex case management, ScyllaDB bisa relevan untuk pola tertentu:

```text
case timeline append/read by case
case state projections by tenant/state/assignee
idempotency for command processing
audit event by subject/time
notification/task inbox per user/team
high-volume event ingestion for operational serving
current state lookup by id
SLA queue projection by due date/state
```

Tapi hati-hati pada invariant:

```text
state transition legal atau tidak?
apakah dua reviewer bisa mengambil case yang sama?
apakah audit log harus immutable?
apakah delete legal boleh menghapus audit trail?
apakah case visibility harus strongly consistent?
apakah regulatory decision harus reconstructable?
apakah stale dashboard bisa diterima?
```

ScyllaDB bisa menjadi serving store yang kuat untuk access pattern operasional, tetapi invariant legal/regulatory harus dimodelkan eksplisit. Jangan mengandalkan “eventual consistency” sebagai alasan kabur. Harus ada kontrak:

```text
mana yang strong,
mana yang eventual,
berapa stale window,
bagaimana reconciliation,
bagaimana audit evidence,
bagaimana recovery.
```

---

## 0.34. Cara Menilai Apakah ScyllaDB Cocok untuk Use Case

Gunakan decision checklist berikut.

### ScyllaDB cenderung cocok bila:

```text
access pattern known dan stabil,
query bisa diarahkan oleh key yang jelas,
volume data/write tinggi,
latency rendah penting,
horizontal scale penting,
denormalization bisa diterima,
eventual consistency untuk sebagian projection bisa diterima,
operasi cluster serius tersedia,
tim mampu melakukan capacity planning dan failure modelling.
```

### ScyllaDB cenderung tidak cocok bila:

```text
query sangat ad-hoc,
filter berubah-ubah,
join kompleks dibutuhkan,
transaction multi-entity kuat menjadi pusat domain,
data kecil dan query fleksibel lebih penting daripada scale,
tim belum siap memegang distributed operational complexity,
search/full-text adalah kebutuhan utama,
analytical aggregation besar menjadi workload utama.
```

### ScyllaDB mungkin cocok sebagai salah satu komponen bila:

```text
SQL tetap menjadi system of record,
ScyllaDB menjadi high-scale serving projection,
Kafka menjadi event backbone,
ClickHouse menjadi analytical sink,
Elasticsearch/OpenSearch menjadi search sink,
Redis menjadi cache/ephemeral coordination layer.
```

Top architecture sering bukan memilih satu database untuk semua. Ia membagi role dengan jelas.

---

## 0.35. Contoh Arsitektur Mental: Enforcement Lifecycle Platform

Bayangkan platform enforcement lifecycle:

```text
Tenant -> Regulatory Program -> Case -> Event -> Task -> Decision -> Audit Evidence
```

Kebutuhan:

1. Case detail harus bisa dibuka cepat by `case_id`.
2. Timeline event case harus tampil urut waktu.
3. Dashboard tenant/state harus menampilkan case terbaru.
4. Queue assignee harus menampilkan task due date terdekat.
5. Audit event harus bisa dicari by subject dalam rentang waktu.
6. Command processing harus idempotent.
7. State transition harus defensible.
8. Dashboard boleh stale beberapa detik, tetapi audit log tidak boleh hilang.

Potensi tabel ScyllaDB:

```text
case_by_id
case_events_by_case
cases_by_tenant_state_month
cases_by_assignee_due_date
case_audit_by_subject_month
command_idempotency_by_tenant_key
case_state_transition_by_case
```

Tapi kita harus membedakan:

```text
source of truth:
  mungkin case_events_by_case + case_by_id

serving projection:
  cases_by_tenant_state_month
  cases_by_assignee_due_date

correctness guard:
  command_idempotency_by_tenant_key
  LWT/reservation table untuk transition tertentu

analytics:
  bukan ScyllaDB utama, mungkin ClickHouse

search:
  bukan ScyllaDB utama, mungkin OpenSearch
```

Dengan cara ini, ScyllaDB tidak dipaksa menjadi segalanya. Ia dipakai untuk jalur operasional high-scale yang key-based dan predictable.

---

## 0.36. Anti-Pattern yang Akan Kita Lawan Sepanjang Seri

### Anti-pattern 1: ERD-first ScyllaDB

Membuat tabel seperti relational schema:

```text
users
orders
order_items
payments
```

lalu berharap bisa query fleksibel. Ini biasanya gagal.

### Anti-pattern 2: One giant table

Membuat satu tabel generik:

```text
events(tenant_id, type, timestamp, payload, many_columns...)
```

lalu semua use case dipaksa masuk. Hasilnya partition/query/TTL/index kacau.

### Anti-pattern 3: Low-cardinality partition key

Partition key seperti `status`, `country`, `event_type`, `state` tanpa bucket/entity tambahan. Ini menciptakan hot partition.

### Anti-pattern 4: Unbounded partition

Partition key seperti `user_id` untuk user timeline tanpa time bucket, padahal user bisa punya jutaan event.

### Anti-pattern 5: ALLOW FILTERING sebagai solusi

`ALLOW FILTERING` sering berarti kamu meminta database melakukan pekerjaan yang data model tidak dukung.

### Anti-pattern 6: Secondary index everywhere

Membawa kebiasaan SQL index ke ScyllaDB tanpa memikirkan cardinality dan fanout.

### Anti-pattern 7: Batch for speed

Batch lintas partition untuk bulk write besar sering memperburuk performa.

### Anti-pattern 8: Retry tanpa idempotency

Timeout dianggap “gagal total”, lalu retry menggandakan efek.

### Anti-pattern 9: TTL everywhere

TTL dipakai untuk semua cleanup tanpa menghitung tombstone.

### Anti-pattern 10: Monitoring average only

CPU average, latency average, dan node-level metrics saja tidak cukup. p99 dan shard/query-level perlu dibaca.

---

## 0.37. Engineering Invariants untuk Seri Ini

Kita akan memakai beberapa invariant berulang. Ini bukan hukum absolut, tapi guardrail.

### Invariant 1: Query harus punya access path yang eksplisit

Jika query penting tidak punya table/index/access path yang jelas, desain belum selesai.

### Invariant 2: Partition harus bounded atau sengaja dikelola

Tidak semua partition harus kecil, tapi partition besar harus disengaja, diukur, dan punya alasan.

### Invariant 3: Hot key lebih berbahaya daripada rata-rata traffic

Cluster bisa terlihat punya kapasitas besar, tapi satu partition hot bisa menghancurkan p99 endpoint tertentu.

### Invariant 4: Duplicate table berarti duplicate correctness responsibility

Denormalization mempercepat read, tapi memindahkan sebagian correctness ke aplikasi/reconciliation.

### Invariant 5: Timeout bukan rollback

Client timeout tidak membuktikan mutation tidak terjadi.

### Invariant 6: Consistency level bukan transaction isolation

CL mengatur acknowledgement replica, bukan semantic transaction multi-entity.

### Invariant 7: TTL/delete menghasilkan storage work

Data lifecycle harus didesain seperti workload, bukan afterthought.

### Invariant 8: Driver behavior adalah bagian dari system design

Routing, retry, paging, pool, timeout, and concurrency mempengaruhi correctness dan latency.

### Invariant 9: Operability harus didesain bersama schema

Schema yang tidak bisa direpair, dibackfill, diobserve, atau dimigrasi bukan schema production-ready.

### Invariant 10: “Cocok” berarti cocok untuk workload tertentu

Tidak ada database yang cocok secara universal.

---

## 0.38. Cara Membaca Part-Part Berikutnya

Setiap part setelah ini akan ditulis dengan pola:

```text
1. mental model
2. konsep inti
3. contoh konkret
4. konsekuensi desain
5. failure mode
6. Java/application implications bila relevan
7. production checklist
8. latihan/review questions
```

Tujuannya agar kamu bukan hanya menghafal fitur, tapi bisa melakukan design review.

Ketika membaca setiap part, selalu tanyakan:

```text
Apa boundary fisik konsep ini?
Apa cost model-nya?
Apa yang terjadi saat scale naik 10x?
Apa yang terjadi saat node gagal?
Apa yang terjadi saat client timeout?
Apa yang harus dilakukan service Java?
Apa metrik yang membuktikan desain ini sehat?
Bagaimana rollback/migration-nya?
```

---

## 0.39. Peta Seri Lengkap

Seri akan terdiri dari 35 part:

```text
000 Orientation: OLTP Wide-Column Store, ScyllaDB, dan Cara Belajar Seri Ini
001 Wide-Column Store Mental Model
002 Distributed OLTP Constraints
003 Dynamo Lineage: Ring, Token, Replication, Coordinator, Gossip
004 ScyllaDB Architecture: Shard-per-Core, Seastar, Reactor
005 Tablets, VNodes, Token Ranges, dan Data Distribution Modern
006 Storage Engine Internals: Commitlog, Memtable, SSTable, Cache, Flush
007 CQL Deep Dive I: Keyspace, Table, Types, DDL, DML
008 Primary Key Design: Partition Key, Clustering Key, Physical Query Shape
009 Query-First Data Modeling
010 Partition Sizing, Cardinality, Hot Partition, Bucketing
011 Time-Series Modeling di ScyllaDB
012 Multi-Access-Pattern Design: Duplicate Tables, Fanout, Derived Views
013 Consistency Levels: ONE, QUORUM, LOCAL_QUORUM, ALL, SERIAL
014 Lightweight Transactions, CAS, Conditional Mutation
015 Deletes, TTL, Tombstones, gc_grace_seconds, Data Lifecycle
016 Compaction Strategies and Cost Model
017 Secondary Indexes, Local Secondary Indexes, Materialized Views
018 Counters, Atomicity Boundaries, Static Columns, Collections, UDT
019 Java Client Engineering I: Driver, Session, Prepared Statement, Paging, Async API
020 Java Client Engineering II: Token Awareness, Shard Awareness, Retry, Idempotency
021 Query Execution and Performance: How to Think in p99
022 Batching, Bulk Loading, Backfill, High-Volume Write Pipelines
023 Schema Evolution: Safe Changes, Compatibility, Rollout, Backward Reads
024 Multi-Tenant ScyllaDB Design
025 Multi-Region and Multi-DC Design
026 Operations I: Installation, Node Sizing, Disk, Network, OS, Kernel Concerns
027 Operations II: Cluster Lifecycle, Bootstrap, Decommission, Replace, Repair, Rebuild
028 Operations III: Backup, Restore, Snapshot, PITR Thinking, Disaster Recovery
029 Observability: Metrics, Dashboards, Tracing, Logs, Flame Graphs
030 Failure Modelling: What Breaks, How It Looks, How to Recover
031 Correctness Patterns for Application Engineers
032 Security, Access Control, Encryption, Secrets, Compliance Posture
033 Migration and Interoperability: Cassandra to ScyllaDB, SQL to ScyllaDB, DynamoDB API, CDC
034 Capstone: Designing a Production-Grade ScyllaDB-Backed OLTP Platform
```

---

## 0.40. Learning Contract: Cara Praktis Menguasai Materi Ini

Untuk benar-benar menguasai seri ini, jangan baca sebagai essay. Baca sebagai engineering training.

Setiap part sebaiknya menghasilkan satu artefak kecil:

| Part range | Artefak belajar |
|---|---|
| 000–002 | decision matrix kapan pakai ScyllaDB |
| 003–006 | diagram request path dan storage path |
| 007–012 | query matrix dan table design untuk domain contoh |
| 013–018 | consistency/lifecycle/index decision checklist |
| 019–022 | Java client template dan load test harness |
| 023–025 | migration/multi-tenant/multi-region design note |
| 026–030 | production runbook dan incident triage tree |
| 031–034 | full design review document |

Kalau kamu hanya membaca, kamu akan merasa paham. Kalau kamu menggambar query matrix dan menghitung partition size, kamu akan benar-benar paham.

---

## 0.41. Mini Framework: Dari Requirement ke ScyllaDB Design

Gunakan framework ini sebagai template awal.

### Step 1 — Daftar user journey

Contoh:

```text
Officer membuka list case NEEDS_REVIEW.
Officer membuka detail case.
System menambahkan event baru ke case.
Worker mengambil task due soon.
Auditor melihat event by subject.
Command processor mengecek idempotency key.
```

### Step 2 — Turunkan access pattern

```text
AP-001 list cases by tenant/state/month sorted by updated_at desc
AP-002 get case by case_id
AP-003 list events by case_id sorted by event_time asc
AP-004 list tasks by assignee/due_date
AP-005 get idempotency record by tenant/command_key
```

### Step 3 — Tentukan known key at runtime

```text
tenant_id known? yes
state known? yes
month known? maybe from current month; fallback previous months
case_id known? yes for detail
assignee known? yes
```

### Step 4 — Estimasi cardinality dan volume

```text
cases per tenant per month
states count
hot tenant ratio
events per case
tasks per assignee
idempotency keys per day
```

### Step 5 — Desain partition key

```text
bounded?
even distribution?
risk hot key?
needs bucket?
query fanout acceptable?
```

### Step 6 — Desain clustering key

```text
sort order?
range query?
tie breaker?
pagination cursor?
```

### Step 7 — Tentukan write model

```text
single table?
duplicate tables?
sync fanout?
async projection?
LWT needed?
idempotency required?
```

### Step 8 — Tentukan consistency level

```text
read CL?
write CL?
LOCAL_QUORUM?
ONE acceptable?
SERIAL needed?
```

### Step 9 — Tentukan lifecycle

```text
TTL?
delete?
retention?
gc_grace?
repair schedule?
compaction strategy?
```

### Step 10 — Tentukan observability dan recovery

```text
metrics per statement?
large partition detection?
tombstone warning?
projection reconciliation?
backfill job?
restore drill?
```

Framework ini akan dipakai berulang sampai menjadi refleks.

---

## 0.42. Contoh Salah Kaprah: “Saya Butuh Filter Banyak Field”

Requirement:

```text
User ingin mencari case berdasarkan tenant, state, assignee, priority, due date, program, risk score, created date, updated date, dan keyword.
```

Engineer yang membawa mental SQL mungkin ingin satu tabel `case` lalu index banyak field. Di ScyllaDB, ini sinyal bahwa requirement mungkin bukan serving key-value/wide-column lookup murni.

Pecah requirement:

```text
Apakah ini dashboard operasional dengan beberapa filter utama yang predictable?
Apakah ini search/exploration?
Apakah keyword search wajib?
Apakah kombinasi filter bebas?
Apakah hasil harus strongly consistent?
Apakah list hanya page pertama, atau user bisa eksplorasi ribuan record?
```

Mungkin desain yang benar:

```text
ScyllaDB:
  cases_by_tenant_state_month
  cases_by_assignee_due_date
  case_by_id

Search engine:
  case_search_index for arbitrary filtering/keyword

SQL/OLAP:
  reporting and audit analysis
```

Jangan memaksa ScyllaDB menyelesaikan semua bentuk query. Jadikan ia serving store untuk access path yang jelas.

---

## 0.43. Contoh Salah Kaprah: “Saya Ingin Join”

Jika endpoint perlu:

```text
case + officer + program + latest decision + SLA + audit count + external registry status
```

Di SQL, join mungkin natural. Di ScyllaDB, pilihannya:

1. **Precompute projection** yang sudah berisi field yang dibutuhkan screen.
2. **Fanout read by key** ke beberapa tabel/service jika jumlahnya kecil dan latency budget cukup.
3. **Materialized read model** dibangun dari event stream.
4. **Gunakan SQL/search/OLAP** jika query eksploratif atau relational.

Yang tidak sehat:

```text
menyimpan entity terpisah seperti relational,
lalu melakukan banyak query per row untuk membangun list page,
lalu heran N+1 query membuat p99 naik.
```

Dalam ScyllaDB, list screen biasanya harus punya row yang sudah cukup kaya untuk ditampilkan tanpa fanout besar.

---

## 0.44. Contoh Salah Kaprah: “Saya Butuh Transaction”

Pertanyaan “apakah ScyllaDB support transaction?” sering kurang tepat. Pertanyaan yang lebih baik:

```text
Invariant apa yang harus dijaga?
Invariant itu scoped ke satu partition atau banyak entity?
Apakah bisa dijaga dengan idempotency?
Apakah bisa dijaga dengan LWT?
Apakah bisa dijaga dengan single-writer ownership?
Apakah bisa dijaga dengan event sourcing dan reconciliation?
Apakah sebenarnya butuh relational database?
```

Contoh invariant:

```text
Satu case hanya boleh di-claim oleh satu officer.
```

Mungkin bisa:

```sql
INSERT INTO case_claim_by_case (case_id, officer_id, claimed_at)
VALUES (?, ?, ?)
IF NOT EXISTS;
```

Tapi jika invariant:

```text
Total active case per officer tidak boleh lebih dari 20, across all programs.
```

Ini bukan sekadar single-partition CAS kecuali kamu mendesain counter/reservation boundary dengan sangat hati-hati. Mungkin butuh coordinator service atau database lain.

---

## 0.45. Performance Vocabulary: p50, p95, p99, p999

Untuk sistem OLTP, rata-rata latency sering menipu. Yang dirasakan user dan downstream service adalah tail latency.

```text
p50: median, separuh request lebih cepat dari ini
p95: 95% request lebih cepat dari ini
p99: 99% request lebih cepat dari ini
p999: 99.9% request lebih cepat dari ini
```

ScyllaDB sering dipilih karena ingin p99 rendah pada volume tinggi. Tetapi p99 sensitif terhadap outlier:

```text
satu query dengan partition besar,
satu shard overloaded,
satu compaction wave,
satu retry storm,
satu GC pause service Java,
satu network hiccup cross-DC,
satu page size terlalu besar.
```

Dalam seri ini, performa akan selalu dibahas sebagai distribusi, bukan angka tunggal.

---

## 0.46. Capacity Thinking Awal

Sebelum membuat tabel, biasakan estimasi kasar:

```text
writes per second per access pattern
reads per second per access pattern
row size
rows per partition
partitions per tenant/entity/time bucket
retention period
replication factor
compression ratio estimate
write amplification
read amplification
peak/average ratio
hot key distribution
```

Contoh cepat:

```text
10.000 event/sec global
100 tenants
tenant terbesar 40% traffic
retention 90 hari
query by tenant/day/latest
row compressed ~500 bytes
RF=3
```

Kalau partition key hanya `(tenant_id, day)`, tenant terbesar pada satu hari menerima:

```text
10.000 * 0.40 = 4.000 event/sec untuk satu tenant/day partition
4.000 * 86.400 = 345.600.000 row per day partition
```

Ini jelas tidak sehat. Perlu bucket lebih granular:

```text
(tenant_id, day, hour, bucket)
atau (tenant_id, day, shard_bucket)
```

Tapi bucket membuat read harus merge beberapa partition. Trade-off harus dihitung.

---

## 0.47. Production Readiness Mindset

Sebuah desain ScyllaDB belum production-ready sampai bisa menjawab:

```text
Apa top 10 query by traffic?
Apa primary key masing-masing?
Berapa estimasi row per partition sekarang dan 12 bulan lagi?
Apa hot key terbesar?
Apa consistency level per query?
Apakah retry policy aman?
Apa timeout per query?
Apa SLA p99?
Apa compaction strategy?
Apa retention/TTL/delete strategy?
Apa dashboard monitoring?
Apa alert paling penting?
Bagaimana backup dan restore diuji?
Bagaimana table projection direkonsiliasi?
Bagaimana schema migration dilakukan tanpa downtime?
Apa failure mode paling mahal?
Apa runbook saat node down?
Apa runbook saat tombstone storm?
```

Jika jawaban belum ada, sistem mungkin bisa demo, tapi belum mature.

---

## 0.48. Checklist Awal Sebelum Memilih ScyllaDB untuk Project

Gunakan checklist ini saat design review awal.

### Workload

```text
[ ] Query utama sudah diketahui.
[ ] Query utama key-based/range-within-partition.
[ ] Tidak butuh ad-hoc join/filter sebagai core path.
[ ] Volume cukup besar sehingga complexity ScyllaDB terbayar.
[ ] Latency rendah/high throughput adalah requirement nyata, bukan gengsi arsitektur.
```

### Data model

```text
[ ] Setiap query penting punya tabel/access path.
[ ] Partition key punya cardinality cukup.
[ ] Partition size diperkirakan.
[ ] Hot partition scenario dipikirkan.
[ ] Bucketing strategy jelas bila diperlukan.
[ ] Sort order sesuai clustering key.
[ ] Pagination tidak memakai offset.
```

### Correctness

```text
[ ] Source of truth didefinisikan.
[ ] Derived table/projection punya reconciliation path.
[ ] Idempotency strategy jelas.
[ ] Retry safety jelas.
[ ] Consistency level per operation dipilih sadar.
[ ] LWT hanya dipakai untuk invariant yang tepat.
```

### Lifecycle

```text
[ ] TTL/delete strategy jelas.
[ ] Tombstone risk dianalisis.
[ ] Compaction strategy sesuai workload.
[ ] Retention dan compliance requirement dipetakan.
```

### Java integration

```text
[ ] Driver yang tepat dipilih.
[ ] Session long-lived.
[ ] Prepared statements digunakan.
[ ] Async concurrency dibatasi.
[ ] Timeout/retry/idempotency diselaraskan.
[ ] Metrics client dikumpulkan.
```

### Operations

```text
[ ] Sizing awal dibuat.
[ ] RF dan topology jelas.
[ ] Backup/restore diuji.
[ ] Repair strategy jelas.
[ ] Monitoring/alerting siap.
[ ] Runbook failure tersedia.
[ ] Load test realistis dilakukan.
```

---

## 0.49. Latihan Awal

Sebelum lanjut ke Part 001, coba jawab latihan berikut. Tidak perlu sempurna; tujuannya membangun kebiasaan berpikir.

### Latihan 1 — Klasifikasi workload

Untuk setiap workload, tentukan apakah ScyllaDB cocok, tidak cocok, atau cocok sebagai salah satu komponen:

```text
1. Feed notifikasi user, query latest 50 by user.
2. Dashboard analytics revenue per region per quarter.
3. Search case by keyword and arbitrary filters.
4. Idempotency key store untuk payment command.
5. Audit timeline by case_id.
6. Transactional transfer balance antar akun.
7. Device telemetry latest state by device_id.
8. Regulatory case queue by tenant/state/due_date.
9. Full-text search document evidence.
10. High-volume event serving projection by tenant/hour.
```

### Latihan 2 — Identify partition risk

Diberikan primary key:

```sql
PRIMARY KEY ((status), updated_at, case_id)
```

Jawab:

```text
Apa risikonya?
Kapan bisa rusak?
Bagaimana alternatifnya?
Apa trade-off alternatif tersebut?
```

### Latihan 3 — Timeout ambiguity

Sebuah write idempotency record menerima timeout. Client tidak tahu apakah write berhasil. Apa strategi retry yang aman?

### Latihan 4 — Table-per-query

Untuk screen:

```text
List task milik assignee A yang due dalam 7 hari, sorted by due_date ascending.
```

Rancang sketch table dan primary key. Lalu jelaskan:

```text
partition key,
clustering key,
cardinality risk,
pagination,
retention,
update ketika task selesai.
```

---

## 0.50. Referensi Resmi yang Dipakai untuk Orientasi Ini

Referensi berikut menjadi dasar awal seri. Part berikutnya akan menambahkan referensi lebih spesifik.

1. ScyllaDB Documentation — Apache Cassandra Compatibility  
   `https://docs.scylladb.com/manual/stable/using-scylla/cassandra-compatibility.html`

2. ScyllaDB Documentation — Consistency Levels  
   `https://docs.scylladb.com/manual/stable/cql/consistency.html`

3. ScyllaDB Documentation — Data Distribution with Tablets  
   `https://docs.scylladb.com/manual/stable/architecture/tablets.html`

4. ScyllaDB — Shard-per-Core Architecture  
   `https://www.scylladb.com/product/technology/shard-per-core-architecture/`

5. ScyllaDB Java Driver Documentation  
   `https://java-driver.docs.scylladb.com/scylla-3.11.0.x/index.html`

6. ScyllaDB Documentation — Install ScyllaDB 2026.1  
   `https://docs.scylladb.com/manual/stable/getting-started/install-scylla/`

---

## 0.51. Ringkasan Part 000

Part ini membangun fondasi:

```text
ScyllaDB adalah wide-column OLTP distributed database.
Ia harus dipelajari dari access pattern, partition, replica, shard, consistency, dan storage lifecycle.
CQL terlihat seperti SQL, tapi bukan SQL.
Table mewakili query, bukan entity netral.
Denormalization adalah desain utama, tapi membawa tanggung jawab correctness.
Partition key adalah boundary distribusi dan scale.
Consistency level adalah kontrak per operasi, bukan transaction isolation.
Timeout bisa ambiguous.
Low latency adalah hasil desain, bukan default otomatis.
Java driver behavior adalah bagian dari system design.
Production readiness membutuhkan modelling, observability, runbook, dan recovery path.
```

Kalau satu kalimat harus diingat sebelum lanjut:

> Di ScyllaDB, kamu tidak “menulis query terhadap data”; kamu “mendesain data agar query tertentu menjadi murah, predictable, dan operable.”

---

## 0.52. Jembatan ke Part 001

Part berikutnya akan membedah mental model wide-column store lebih dalam:

```text
learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-001.md
```

Fokus Part 001:

```text
- wide-column vs relational vs document vs key-value vs OLAP columnar
- keyspace/table/partition/clustering/cell sebagai model fisik
- sparse data dan wide row
- kenapa query-first modelling wajib
- contoh transformasi requirement menjadi beberapa tabel
- anti-pattern awal yang harus dibuang
```

Setelah Part 001, baru kita masuk ke distributed OLTP constraints dan arsitektur Dynamo-style yang menjadi fondasi Cassandra/ScyllaDB.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-001.md">Part 001 — Wide-Column Store Mental Model: Bukan SQL, Bukan Document DB, Bukan OLAP Columnar ➡️</a>
</div>

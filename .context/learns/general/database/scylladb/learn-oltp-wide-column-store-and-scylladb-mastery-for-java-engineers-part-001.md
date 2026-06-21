# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-001.md

# Part 001 — Wide-Column Store Mental Model: Bukan SQL, Bukan Document DB, Bukan OLAP Columnar

> Seri: **OLTP, Wide-Column Store, and ScyllaDB Mastery for Java Engineers**  
> Target pembaca: Java/backend engineer yang sudah punya exposure ke SQL, PostgreSQL/MySQL, Redis, MongoDB, Kafka/RabbitMQ, ClickHouse, HTTP, dan sistem backend produksi.  
> Tujuan part ini: membangun mental model wide-column store secara presisi sebelum masuk ke CQL, partition key design, clustering key, consistency, storage engine, dan Java driver.

---

## 1.0. Posisi Part Ini di Dalam Seri

Part 000 menjelaskan kenapa ScyllaDB perlu dipelajari dari access pattern, partition, replica, consistency, dan failure model. Part 001 memperdalam satu pertanyaan dasar:

```text
Apa sebenarnya wide-column store itu, dan kenapa cara berpikirnya berbeda dari database lain yang sudah kamu kenal?
```

Pertanyaan ini kelihatan sederhana, tapi sangat menentukan. Banyak kegagalan desain ScyllaDB terjadi bukan karena engineer tidak tahu syntax CQL, melainkan karena membawa mental model database lain secara diam-diam.

Contohnya:

```text
SQL mindset:
"Saya punya entity Order, OrderItem, Payment, Shipment. Saya normalisasi dulu, nanti query pakai join/index."

MongoDB mindset:
"Saya punya aggregate Order. Saya embed semua yang sering dibaca bersama."

Redis mindset:
"Saya punya key-value access cepat. Yang penting key naming dan TTL."

ClickHouse mindset:
"Saya punya event besar. Saya susun columnar table untuk scan dan aggregate."

ScyllaDB mindset:
"Saya punya request produksi tertentu. Saat request itu masuk, partition key apa yang saya punya? Data dalam partition diurutkan bagaimana? Berapa partition yang disentuh? Berapa besar partition itu? Consistency level apa yang dibutuhkan?"
```

Kalau kamu salah membawa mental model, CQL akan terasa “SQL yang kurang fitur”. Padahal ScyllaDB bukan SQL yang dikurangi. Ia adalah database dengan kontrak berbeda: query harus cocok dengan bentuk fisik data.

---

## 1.1. Definisi Praktis Wide-Column Store

Secara praktis, wide-column store adalah database yang menyimpan data sebagai kumpulan row yang dikelompokkan berdasarkan **partition key**, lalu di dalam partition itu row diurutkan berdasarkan **clustering key**.

Bentuk sederhananya:

```text
Table
└── Partition key = tenant_id:user_id
    ├── clustering key = 2026-06-21T10:01:00Z -> columns...
    ├── clustering key = 2026-06-21T10:02:00Z -> columns...
    ├── clustering key = 2026-06-21T10:03:00Z -> columns...
    └── clustering key = 2026-06-21T10:04:00Z -> columns...
```

Atau dalam bentuk lain:

```text
Table: user_activity_by_user_day

Partition: (tenant_id = T1, user_id = U9, day = 2026-06-21)

Rows inside partition ordered by clustering key:

activity_time                 activity_id     type        payload
------------------------------------------------------------------
2026-06-21T09:00:01Z          A100            LOGIN       {...}
2026-06-21T09:05:10Z          A101            VIEW_CASE   {...}
2026-06-21T09:07:40Z          A102            UPDATE      {...}
2026-06-21T09:09:11Z          A103            LOGOUT      {...}
```

Yang penting bukan sekadar “kolomnya banyak”. Istilah wide-column sering membingungkan karena orang membayangkan “table dengan banyak column”. Itu hanya sebagian kecil dari cerita.

Mental model yang lebih akurat:

```text
wide-column store = distributed sorted map

(table, partition_key) -> ordered rows by clustering key -> sparse cells/columns
```

Dengan kata lain, query paling natural adalah:

```text
Berikan saya data untuk partition X,
opsional dibatasi range clustering key Y..Z,
dengan jumlah row yang masuk akal.
```

Contoh query natural:

```sql
SELECT *
FROM user_activity_by_user_day
WHERE tenant_id = ?
  AND user_id = ?
  AND day = ?
  AND activity_time >= ?
  AND activity_time < ?
ORDER BY activity_time DESC
LIMIT 100;
```

Contoh query yang biasanya tidak natural:

```sql
SELECT *
FROM user_activity_by_user_day
WHERE type = 'UPDATE'
  AND payload CONTAINS 'high-risk'
ORDER BY activity_time DESC;
```

Kenapa tidak natural? Karena query kedua tidak memberi tahu database partition mana yang harus dibaca. Kalau tidak ada model tambahan, database harus mencari ke banyak partition. Itu bertentangan dengan desain dasar ScyllaDB.

---

## 1.2. Wide-Column Store Bukan “Columnar OLAP Database”

Ini sumber kebingungan terbesar.

ScyllaDB disebut wide-column store. ClickHouse disebut column-oriented atau columnar database. Keduanya memakai kata “column”, tapi maksudnya berbeda.

| Aspek | Wide-column OLTP, misalnya ScyllaDB | Columnar OLAP, misalnya ClickHouse |
|---|---|---|
| Optimasi utama | Point/range read per partition, high write throughput, predictable low latency | Large scan, aggregation, compression, analytical throughput |
| Unit akses natural | Partition + clustering range | Column scan over many rows/parts |
| Query shape | Diketahui dari awal, query-first, terbatas | Lebih fleksibel untuk filter/aggregate besar |
| Latency target | Millisecond-level operational request | Analytical latency, bisa subsecond sampai detik/menit tergantung skala |
| Write pattern | Banyak mutation kecil, distributed OLTP | Batch/stream ingest, append-heavy analytical |
| Data model | Denormalized table-per-query | Fact/dimension/event table, materialized view/projection |
| Query engine | Tidak dirancang untuk arbitrary analytical scan | Dirancang untuk scan dan aggregate besar |

Wide-column store tidak berarti data disimpan per column untuk mempercepat aggregate seperti:

```sql
SELECT country, count(*), avg(amount)
FROM events
WHERE event_date >= today() - 30
GROUP BY country;
```

Query seperti itu adalah dunia OLAP. Di ScyllaDB, query seperti itu biasanya salah tempat kecuali kamu sudah memodelkan table khusus yang menjawab query itu secara langsung, misalnya aggregate precomputed per country/day.

ScyllaDB lebih dekat ke:

```text
Saya tahu tenant_id dan case_id.
Saya ingin mengambil timeline case terakhir 50 event.
```

Bukan:

```text
Saya ingin scan semua case lintas tenant, group by risk level, dan cari trend 6 bulan.
```

Perbedaan ini harus menjadi reflex. Jangan tertipu oleh kata “column”.

---

## 1.3. Wide-Column Store Bukan SQL yang Tidak Punya Join

Cara salah memahami ScyllaDB:

```text
ScyllaDB itu seperti SQL, tapi tidak punya join dan fiturnya lebih terbatas.
```

Cara benar:

```text
ScyllaDB adalah distributed storage engine untuk query yang sudah dimodelkan secara fisik.
Ia menukar fleksibilitas query SQL dengan predictable scale-out access pattern.
```

Relational database biasanya membangun logical model terlebih dahulu:

```text
Customer
Order
OrderItem
Payment
Shipment
```

Lalu query bisa dibuat belakangan:

```sql
SELECT c.name, o.id, p.status
FROM customer c
JOIN orders o ON o.customer_id = c.id
JOIN payment p ON p.order_id = o.id
WHERE c.email = ?
ORDER BY o.created_at DESC;
```

Kalau performa buruk, kamu menambahkan index, memperbaiki query plan, melakukan denormalisasi terbatas, membuat materialized view, atau melakukan caching.

Di ScyllaDB, pendekatan itu dibalik. Kamu mulai dari query:

```text
Given customer_email, show latest 20 orders with payment status.
```

Lalu kamu desain table fisik:

```sql
CREATE TABLE orders_by_customer_email (
    tenant_id text,
    customer_email text,
    order_created_at timestamp,
    order_id uuid,
    customer_name text,
    payment_status text,
    order_total decimal,
    PRIMARY KEY ((tenant_id, customer_email), order_created_at, order_id)
) WITH CLUSTERING ORDER BY (order_created_at DESC);
```

Artinya data customer dan payment status mungkin diduplikasi di table ini. Duplikasi bukan pelanggaran normalisasi; duplikasi adalah mekanisme untuk membuat query menjadi satu-partition atau bounded-partition read.

Konsekuensi besarnya:

```text
SQL:
model normalized -> query fleksibel -> optimizer mencari plan

ScyllaDB:
query diketahui -> table didesain untuk query itu -> runtime harus predictable
```

Jadi jangan bertanya:

```text
Bagaimana saya menyimpan entity ini?
```

Tanya:

```text
Bagaimana sistem membaca/menulis data ini dalam request produksi?
```

---

## 1.4. Wide-Column Store Bukan Document Database

MongoDB/document database membuat kamu berpikir dalam aggregate document:

```json
{
  "caseId": "C-1001",
  "tenantId": "T1",
  "subject": "Late filing",
  "status": "OPEN",
  "assignedOfficer": "U7",
  "events": [
    { "time": "2026-06-21T09:00:00Z", "type": "CREATED" },
    { "time": "2026-06-21T09:15:00Z", "type": "ASSIGNED" }
  ]
}
```

Ini bagus kalau aggregate punya boundary jelas dan dokumen sering dibaca/ditulis sebagai satu unit. Tetapi document model bisa membuat orang membawa asumsi berikut ke ScyllaDB:

```text
Saya punya satu aggregate besar. Saya simpan semua child records di satu row/collection.
```

Di ScyllaDB, itu sering berbahaya.

Kenapa? Karena satu row besar atau collection besar dapat menyebabkan:

```text
- read/write amplification,
- serialization/deserialization cost besar,
- tombstone besar jika item collection dihapus,
- update contention pada row yang sama,
- sulit melakukan range read pada child records,
- sulit mengontrol partition growth.
```

ScyllaDB lebih natural menyimpan child records sebagai clustering rows di dalam partition:

```text
Partition: case_id = C-1001

clustering rows:
2026-06-21T09:00:00Z | CREATED
2026-06-21T09:15:00Z | ASSIGNED
2026-06-21T09:30:00Z | COMMENT_ADDED
```

Bukan satu JSON document raksasa.

Contoh table:

```sql
CREATE TABLE case_events_by_case (
    tenant_id text,
    case_id text,
    event_time timestamp,
    event_id uuid,
    event_type text,
    actor_id text,
    payload text,
    PRIMARY KEY ((tenant_id, case_id), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC);
```

Mental modelnya:

```text
Document DB:
aggregate = document boundary

ScyllaDB:
query partition = locality boundary
```

Kadang boundary itu sama. Sering tidak.

---

## 1.5. Wide-Column Store Bukan Redis dengan Disk dan Replication

Redis membuat kita nyaman dengan pola:

```text
key -> value
key -> list
key -> set
key -> sorted set
```

ScyllaDB juga bisa dipakai seperti key-value store:

```sql
CREATE TABLE session_by_token (
    token text PRIMARY KEY,
    user_id text,
    expires_at timestamp,
    attributes text
);
```

Tetapi kalau kamu hanya melihat ScyllaDB sebagai Redis-on-disk, kamu akan kehilangan kekuatan utamanya: partition + clustering range.

Redis sorted set:

```text
ZADD user:U1:activity 1718950000 A1
ZRANGE user:U1:activity 0 99 REV
```

ScyllaDB equivalent secara mental:

```sql
CREATE TABLE activity_by_user_day (
    user_id text,
    day date,
    activity_time timestamp,
    activity_id uuid,
    type text,
    payload text,
    PRIMARY KEY ((user_id, day), activity_time, activity_id)
) WITH CLUSTERING ORDER BY (activity_time DESC);
```

Keduanya bisa menjawab timeline. Tetapi perbedaannya besar:

```text
Redis:
- in-memory first,
- single-thread/event-loop per shard style,
- explicit data structures,
- sering dipakai untuk cache, coordination, rate limit, ephemeral state.

ScyllaDB:
- persistent distributed database,
- replica consistency level,
- storage engine dengan SSTable/compaction,
- partition/clustering data model,
- operational concerns: repair, tombstone, compaction, disk, shard, replica.
```

ScyllaDB bukan pengganti Redis untuk semua hal. Redis masih lebih cocok untuk ultra-low-latency ephemeral operations, atomic data-structure commands, cache, dan coordination tertentu. ScyllaDB cocok ketika data persistent, volume besar, throughput tinggi, dan access pattern bisa dimodelkan.

---

## 1.6. Core Object Model: Keyspace, Table, Partition, Row, Cell

Untuk memahami wide-column store, jangan mulai dari syntax. Mulai dari hirarki fisik-logisnya.

```text
Cluster
└── Keyspace
    └── Table
        └── Partition
            └── Clustering Row
                └── Cell / Column Value
```

### 1.6.1. Cluster

Cluster adalah kumpulan node ScyllaDB. Data direplikasi antar node sesuai replication strategy dan replication factor.

Dalam production, kamu jarang berpikir “data ada di database X” secara tunggal. Kamu berpikir:

```text
partition P direplikasi ke beberapa replica,
request dikirim ke coordinator,
coordinator menghubungi replica sesuai consistency level,
hasil dikembalikan ke client.
```

### 1.6.2. Keyspace

Keyspace adalah namespace dan tempat mendefinisikan replication strategy.

Contoh:

```sql
CREATE KEYSPACE regulatory_core
WITH replication = {
  'class': 'NetworkTopologyStrategy',
  'datacenter1': 3
};
```

Keyspace bukan sekadar schema namespace seperti database/schema di SQL. Ia juga membawa makna distribusi dan durability, karena replication factor didefinisikan di level keyspace.

### 1.6.3. Table

Table adalah struktur data yang didesain untuk query tertentu.

Dalam SQL, satu table sering merepresentasikan entity. Dalam ScyllaDB, satu table sering merepresentasikan access pattern.

```text
SQL table:
orders

ScyllaDB tables:
orders_by_customer
orders_by_status_day
orders_by_merchant_day
order_by_id
orders_pending_review_by_officer
```

Ini bukan overengineering. Ini konsekuensi dari query-first modeling.

### 1.6.4. Partition

Partition adalah kelompok row yang berbagi partition key.

Contoh:

```sql
PRIMARY KEY ((tenant_id, case_id), event_time, event_id)
```

Partition key:

```text
(tenant_id, case_id)
```

Semua event untuk case tertentu berada dalam partition yang sama, lalu diurutkan oleh clustering key.

Partition adalah konsep paling penting. Ia mempengaruhi:

```text
- distribusi data antar node,
- replica set yang menyimpan data,
- query routing,
- read locality,
- hot partition risk,
- partition size,
- repair/compaction behavior,
- latency,
- operational blast radius.
```

### 1.6.5. Clustering Row

Clustering row adalah row di dalam partition, diidentifikasi oleh clustering key.

Kalau primary key:

```sql
PRIMARY KEY ((tenant_id, case_id), event_time, event_id)
```

Maka clustering key:

```text
event_time, event_id
```

Clustering key menentukan uniqueness dan sort order di dalam partition.

### 1.6.6. Cell / Column Value

Setiap row memiliki column values. Secara storage engine, cell memiliki timestamp dan bisa memiliki TTL/tombstone semantics.

Ini penting karena update/delete di ScyllaDB bukan semata mengganti row seperti mental model SQL sederhana. Mutation membawa timestamp. Delete menghasilkan tombstone. TTL juga berakhir sebagai tombstone. Ini akan dibahas detail di part 015.

---

## 1.7. Primary Key Anatomy: Yang Harus Terpatri di Kepala

Primary key ScyllaDB/Cassandra-style memiliki dua bagian:

```text
PRIMARY KEY ((partition_key_columns...), clustering_key_columns...)
```

Contoh:

```sql
CREATE TABLE case_events_by_case (
    tenant_id text,
    case_id text,
    event_time timestamp,
    event_id uuid,
    event_type text,
    actor_id text,
    payload text,
    PRIMARY KEY ((tenant_id, case_id), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC);
```

Di sini:

```text
Partition key:
(tenant_id, case_id)

Clustering key:
event_time, event_id

Regular columns:
event_type, actor_id, payload
```

Interpretasi fisiknya:

```text
Semua event untuk satu case berada dalam satu partition.
Dalam partition itu, event diurutkan berdasarkan event_time DESC,
lalu event_id dipakai untuk uniqueness ketika timestamp sama.
```

Query yang natural:

```sql
SELECT *
FROM case_events_by_case
WHERE tenant_id = ?
  AND case_id = ?
LIMIT 50;
```

Atau:

```sql
SELECT *
FROM case_events_by_case
WHERE tenant_id = ?
  AND case_id = ?
  AND event_time >= ?
  AND event_time < ?;
```

Query yang buruk/tidak cocok:

```sql
SELECT *
FROM case_events_by_case
WHERE actor_id = ?;
```

Karena `actor_id` bukan partition key dan bukan bagian clustering yang bisa dipakai setelah partition key diketahui.

Kalau kamu butuh query by actor, buat table lain:

```sql
CREATE TABLE case_events_by_actor_day (
    tenant_id text,
    actor_id text,
    day date,
    event_time timestamp,
    case_id text,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY ((tenant_id, actor_id, day), event_time, case_id, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC);
```

Ini inti desain wide-column: query berbeda sering berarti table berbeda.

---

## 1.8. Partition Key: Distribution Boundary dan Locality Boundary

Partition key melakukan dua hal sekaligus:

```text
1. Menentukan distribusi data ke token/range/node/replica.
2. Menentukan locality untuk query.
```

Ini trade-off besar.

Partition key terlalu sempit:

```text
PRIMARY KEY ((tenant_id), case_id)
```

Risiko:

```text
- satu tenant besar menjadi hot partition,
- partition terlalu besar,
- semua case tenant itu menumpuk dalam satu partition,
- query per case tidak lagi isolated secara fisik.
```

Partition key terlalu granular:

```text
PRIMARY KEY ((tenant_id, case_id, event_id), event_time)
```

Risiko:

```text
- setiap event menjadi partition sendiri,
- sulit query timeline case karena harus membaca banyak partition,
- locality hilang,
- query latest events menjadi fanout.
```

Partition key yang lebih seimbang:

```text
PRIMARY KEY ((tenant_id, case_id), event_time, event_id)
```

Atau kalau case bisa sangat besar:

```text
PRIMARY KEY ((tenant_id, case_id, month_bucket), event_time, event_id)
```

Partition key design selalu menjawab dua pertanyaan:

```text
Apakah data yang sering dibaca bersama berada dekat?
Apakah data itu tidak terlalu besar/panas untuk satu partition?
```

Jika jawaban pertama “tidak”, query akan fanout.
Jika jawaban kedua “tidak”, partition akan menjadi hot/large.

---

## 1.9. Clustering Key: Urutan dan Range di Dalam Partition

Clustering key bukan index sekunder. Clustering key adalah urutan fisik-logis row di dalam partition.

Contoh:

```sql
PRIMARY KEY ((tenant_id, case_id), event_time, event_id)
WITH CLUSTERING ORDER BY (event_time DESC)
```

Query natural:

```sql
-- latest events
SELECT *
FROM case_events_by_case
WHERE tenant_id = ?
  AND case_id = ?
LIMIT 100;
```

Karena clustering order descending, latest event mudah diambil dari awal urutan.

Kalau kamu sering query berdasarkan state transition sequence, kamu bisa modelkan:

```sql
PRIMARY KEY ((tenant_id, case_id), sequence_no)
```

Kalau kamu sering query by due date dalam officer queue:

```sql
PRIMARY KEY ((tenant_id, officer_id, queue_date), due_at, case_id)
```

Clustering key menentukan:

```text
- sort order dalam partition,
- range query yang murah,
- uniqueness row bersama partition key,
- pagination behavior,
- apakah latest N murah atau mahal,
- apakah time-window query natural.
```

Golden rule:

```text
Partition key memilih “bucket data mana”.
Clustering key memilih “urutan data di dalam bucket itu”.
```

---

## 1.10. Sparse Columns: Fleksibel, Tapi Bukan Alasan Membuat Model Amburadul

Wide-column store sering diasosiasikan dengan sparse data: tidak semua row harus memiliki semua column.

Contoh:

```text
case_id | event_time | event_type      | comment_text | assigned_to | status_after
-------------------------------------------------------------------------
C1      | 09:00      | CREATED         | null         | null        | OPEN
C1      | 09:10      | COMMENT_ADDED   | "..."        | null        | null
C1      | 09:20      | ASSIGNED        | null         | U7          | null
C1      | 09:30      | STATUS_CHANGED  | null         | null        | UNDER_REVIEW
```

Ini memungkinkan satu table menyimpan variasi event yang berbeda.

Tetapi jangan salah memahami fleksibilitas ini sebagai:

```text
Saya bisa membuat satu table universal dengan ratusan nullable columns untuk semua use case.
```

Itu biasanya tanda model belum jelas.

Sparse column berguna ketika:

```text
- row dalam partition merepresentasikan event/item dengan variasi atribut,
- query shape tetap jelas,
- partition key dan clustering key tetap sehat,
- column yang jarang dipakai tidak menjadi dasar query utama.
```

Sparse column berbahaya ketika:

```text
- digunakan untuk menghindari desain table-per-query,
- field arbitrary dipakai untuk filter tanpa model index/table,
- payload menjadi dumping ground,
- data lifecycle tiap column berbeda ekstrem,
- schema governance hilang.
```

Dalam sistem regulasi/case management, ini sering muncul sebagai table seperti:

```sql
CREATE TABLE generic_case_data (
    tenant_id text,
    case_id text,
    field_name text,
    field_value text,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, case_id), field_name)
);
```

Table ini terlihat fleksibel. Tapi ia tidak menjawab query produksi dengan baik kecuali query-nya memang “ambil semua field untuk case X”. Kalau nanti butuh “cari semua case yang field risk_score > 80”, model ini runtuh.

---

## 1.11. Query-First Modeling: Dari API ke Table

Di ScyllaDB, desain table dimulai dari daftar query. Bukan dari daftar entity.

Misalnya sistem regulatory enforcement lifecycle punya use case:

```text
1. Officer membuka case detail.
2. Officer melihat timeline event case terbaru.
3. Supervisor melihat queue case pending review per officer.
4. Sistem mencari case by external reference.
5. Audit service mengambil immutable event by event_id.
6. Notification service mengambil due reminders per tenant/day.
```

Jangan mulai dengan:

```text
Entity:
- Case
- Event
- Officer
- Review
- Reminder
```

Mulai dengan query matrix:

| Query | Known at request time | Sort/range | Result size | Freshness | Candidate table |
|---|---|---|---:|---|---|
| Case detail by id | tenant_id, case_id | none | 1 row | strong-ish | case_by_id |
| Case timeline | tenant_id, case_id | event_time desc | latest 50/100 | normal | case_events_by_case |
| Officer queue | tenant_id, officer_id, queue_date | due_at asc | paged | normal | review_queue_by_officer_day |
| External ref lookup | tenant_id, external_ref | none | 1 row | strong-ish | case_by_external_ref |
| Event by id | tenant_id, event_id | none | 1 row | immutable | case_event_by_id |
| Due reminders | tenant_id, due_date, bucket | due_at asc | paged | normal | reminders_by_due_day_bucket |

Dari situ muncul table:

```text
case_by_id
case_events_by_case
review_queue_by_officer_day
case_by_external_ref
case_event_by_id
reminders_by_due_day_bucket
```

Ini terasa “banyak table” bagi orang SQL. Tapi dalam ScyllaDB, ini normal jika query-nya memang berbeda.

---

## 1.12. Table-per-Query Bukan Berarti Satu Table per Endpoint Secara Buta

Ada jebakan lain: setelah mendengar “table-per-query”, engineer membuat table berlebihan tanpa berpikir.

Prinsip yang benar:

```text
Buat table berdasarkan access pattern fisik yang berbeda,
bukan berdasarkan jumlah endpoint REST.
```

Dua endpoint bisa memakai table sama jika access pattern sama:

```text
GET /cases/{caseId}/events?limit=50
GET /internal/cases/{caseId}/audit-timeline?limit=100
```

Keduanya mungkin memakai:

```text
case_events_by_case
```

Satu endpoint bisa butuh beberapa table jika access pattern berbeda:

```text
GET /dashboard/officer/{officerId}
```

Mungkin membaca:

```text
review_queue_by_officer_day
case_count_by_officer_status
breach_risk_by_officer_day
```

Table-per-query lebih tepat dipahami sebagai:

```text
physical read path per access pattern
```

Bukan:

```text
copy-paste table per API route
```

---

## 1.13. Denormalization: Desain Utama, Bukan Kompromi Malu-Malu

Di SQL, denormalization sering dianggap optimasi setelah normalisasi tidak cukup cepat.

Di ScyllaDB, denormalization adalah desain utama.

Contoh entity logis:

```text
Case:
- case_id
- external_ref
- status
- assigned_officer
- risk_level
- created_at
- updated_at
```

Access pattern:

```text
1. get case by id
2. get case by external_ref
3. list open cases by officer
4. list high risk cases by tenant/day
```

Model ScyllaDB bisa menjadi:

```sql
CREATE TABLE case_by_id (... PRIMARY KEY ((tenant_id, case_id)));

CREATE TABLE case_by_external_ref (... PRIMARY KEY ((tenant_id, external_ref)));

CREATE TABLE open_cases_by_officer_day (
    tenant_id text,
    officer_id text,
    day date,
    priority int,
    updated_at timestamp,
    case_id text,
    status text,
    external_ref text,
    risk_level text,
    PRIMARY KEY ((tenant_id, officer_id, day), priority, updated_at, case_id)
);

CREATE TABLE high_risk_cases_by_day (
    tenant_id text,
    day date,
    risk_score int,
    case_id text,
    external_ref text,
    status text,
    assigned_officer text,
    PRIMARY KEY ((tenant_id, day), risk_score, case_id)
) WITH CLUSTERING ORDER BY (risk_score DESC);
```

Duplikasi field `status`, `external_ref`, `risk_level`, `assigned_officer` adalah intentional.

Tetapi denormalization membawa tanggung jawab:

```text
- bagaimana menulis ke semua table?
- apa yang terjadi jika write ke table kedua gagal?
- apakah update harus synchronous atau asynchronous?
- apakah data boleh eventual consistent antar view?
- bagaimana melakukan repair/backfill?
- bagaimana mendeteksi divergence?
```

ScyllaDB membuat read path cepat dengan memindahkan kompleksitas ke write path dan data lifecycle.

---

## 1.14. Atomicity Boundary: Jangan Mengarang Transaksi yang Tidak Ada

Dalam SQL, kamu terbiasa berpikir:

```text
BEGIN;
UPDATE cases;
INSERT case_events;
UPDATE officer_queue;
COMMIT;
```

Di ScyllaDB, kamu harus lebih eksplisit. Mutation dalam satu partition punya property berbeda dari update lintas banyak partition/table. LWT ada, tetapi bukan pengganti general transaction SQL.

Mental model aman:

```text
Atomicity kuat hanya boleh diasumsikan pada boundary yang benar-benar dijamin.
Untuk multi-table/multi-partition workflow, desain idempotency, retry, reconciliation, dan compensating repair.
```

Contoh update case assignment:

```text
1. update case_by_id
2. insert assignment event into case_events_by_case
3. insert into open_cases_by_officer_day for new officer
4. delete from open_cases_by_officer_day for old officer
```

Pertanyaan yang harus dijawab:

```text
- Kalau step 1 sukses, step 2 timeout, step 3 sukses, step 4 gagal, state sistem bagaimana?
- Apakah endpoint read detail dan officer queue boleh berbeda beberapa detik?
- Apakah event log menjadi source of truth?
- Apakah ada reconciliation job?
- Apakah mutation idempotent jika retry?
```

Top-tier ScyllaDB engineering bukan menghindari pertanyaan ini. Justru mendesain jawabannya sejak awal.

---

## 1.15. Query Validity: Kenapa Banyak Query “Tidak Boleh”

Di ScyllaDB, banyak query yang tampak wajar bagi SQL engineer tidak valid atau tidak efisien.

Contoh table:

```sql
CREATE TABLE case_events_by_case (
    tenant_id text,
    case_id text,
    event_time timestamp,
    event_id uuid,
    event_type text,
    actor_id text,
    PRIMARY KEY ((tenant_id, case_id), event_time, event_id)
);
```

Valid/natural:

```sql
SELECT *
FROM case_events_by_case
WHERE tenant_id = 'T1'
  AND case_id = 'C1';
```

Valid/natural dengan range clustering:

```sql
SELECT *
FROM case_events_by_case
WHERE tenant_id = 'T1'
  AND case_id = 'C1'
  AND event_time >= '2026-06-01'
  AND event_time < '2026-07-01';
```

Tidak natural:

```sql
SELECT *
FROM case_events_by_case
WHERE event_type = 'STATUS_CHANGED';
```

Tidak natural:

```sql
SELECT *
FROM case_events_by_case
WHERE actor_id = 'U1';
```

Tidak natural:

```sql
SELECT *
FROM case_events_by_case
WHERE tenant_id = 'T1';
```

Kenapa query terakhir juga bermasalah? Karena partition key adalah `(tenant_id, case_id)`, bukan hanya `tenant_id`. Memberikan sebagian partition key tidak cukup untuk menentukan partition.

Aturan mental:

```text
Untuk query cepat dan natural, kamu harus tahu partition key lengkap.
Setelah itu, kamu boleh memakai clustering key sesuai urutan dan rule range-nya.
```

Kalau kamu ingin query by `actor_id`, desain table by actor.
Kalau kamu ingin query by `event_type`, desain table by event type.
Kalau kamu ingin query by tenant only, desain table yang partition key-nya tenant + bucket agar tidak menjadi mega-partition.

---

## 1.16. Locality vs Distribution: Tension Utama Wide-Column Design

Setiap desain partition key adalah kompromi antara locality dan distribution.

Locality berarti:

```text
data yang dibaca bersama berada bersama.
```

Distribution berarti:

```text
data dan traffic tersebar merata ke cluster.
```

Contoh locality ekstrem:

```sql
PRIMARY KEY ((tenant_id), case_id, event_time)
```

Semua data tenant dekat. Query dashboard tenant mungkin mudah. Tapi tenant besar menjadi hot/large partition.

Contoh distribution ekstrem:

```sql
PRIMARY KEY ((tenant_id, case_id, event_id), event_time)
```

Data tersebar sangat rata. Tapi timeline case butuh membaca banyak partition.

Desain seimbang:

```sql
PRIMARY KEY ((tenant_id, case_id, month_bucket), event_time, event_id)
```

Atau:

```sql
PRIMARY KEY ((tenant_id, officer_id, queue_date), priority, due_at, case_id)
```

Pertanyaan evaluasi:

```text
1. Berapa banyak row per partition per hari/bulan/tahun?
2. Berapa request per second per partition pada puncak?
3. Apakah satu tenant/officer/case bisa menjadi outlier besar?
4. Apakah query perlu latest N atau full history?
5. Apakah data bisa dibucket tanpa merusak UX?
6. Apakah pagination harus lintas bucket?
7. Apakah ada operational procedure untuk re-bucketing jika asumsi salah?
```

Wide-column design selalu hidup di tension ini.

---

## 1.17. Sparse Wide Rows vs Large Partitions

Istilah “wide row” kadang dipakai untuk partition yang punya banyak clustering rows. Ini bisa berguna, tapi juga bisa membunuh performa kalau tidak dikontrol.

Contoh partition sehat:

```text
case_events_by_case
partition = tenant_id + case_id + month_bucket
rows = 10 sampai 10.000 event per month untuk case aktif
query = latest 50 atau range harian
```

Contoh partition berbahaya:

```text
all_events_by_tenant
partition = tenant_id
rows = ratusan juta event
query = filter by case/status/time
```

Masalah large partition:

```text
- read latency naik,
- compaction lebih berat,
- repair lebih mahal,
- cache tidak efektif,
- shard tertentu bisa panas,
- tombstone scan berbahaya,
- operational diagnosis lebih sulit.
```

Namun kebalikannya juga buruk: terlalu banyak partition kecil untuk query yang harus membaca banyak data bersama.

Contoh terlalu granular:

```text
partition = event_id
```

Untuk timeline case 100 event, kamu membaca 100 partition. Itu bukan locality.

Prinsip:

```text
Partition harus cukup besar untuk menyediakan locality,
tapi cukup kecil untuk menghindari hot/large partition.
```

---

## 1.18. Ordering: Hanya Murah Jika Sudah Ada di Clustering Key

SQL engineer sering berpikir:

```sql
ORDER BY created_at DESC
```

Lalu database mungkin memakai index atau sort. Di ScyllaDB, order murah jika order itu sudah menjadi clustering order dalam partition.

Contoh natural:

```sql
CREATE TABLE cases_by_officer_day (
    tenant_id text,
    officer_id text,
    day date,
    priority int,
    created_at timestamp,
    case_id text,
    status text,
    PRIMARY KEY ((tenant_id, officer_id, day), priority, created_at, case_id)
) WITH CLUSTERING ORDER BY (priority DESC, created_at ASC);
```

Query:

```sql
SELECT *
FROM cases_by_officer_day
WHERE tenant_id = ?
  AND officer_id = ?
  AND day = ?
LIMIT 50;
```

Hasil sudah keluar dalam urutan priority DESC, created_at ASC.

Kalau kamu ingin order by `updated_at`, kamu butuh table berbeda:

```sql
cases_by_officer_day_updated_at
```

Atau clustering key berbeda.

ScyllaDB bukan tempat untuk “ambil semua lalu sort arbitrary”. Sort order harus bagian dari model.

---

## 1.19. Filtering: Bukan Masalah Syntax, Tapi Masalah Model

`ALLOW FILTERING` sering muncul saat engineer frustrasi:

```sql
SELECT *
FROM cases_by_officer_day
WHERE tenant_id = ?
  AND status = 'OPEN'
ALLOW FILTERING;
```

Di SQL, filter pada kolom non-index mungkin lambat tapi bisa jalan. Di ScyllaDB, filtering tanpa partition/clustering alignment sering berarti database harus membaca banyak data lalu membuang sebagian besar hasil.

Masalahnya bukan “ScyllaDB pelit fitur”. Masalahnya query tidak cocok dengan model.

Jika status adalah access pattern utama, buat table:

```sql
CREATE TABLE cases_by_tenant_status_day (
    tenant_id text,
    status text,
    day date,
    updated_at timestamp,
    case_id text,
    assigned_officer text,
    risk_level text,
    PRIMARY KEY ((tenant_id, status, day), updated_at, case_id)
) WITH CLUSTERING ORDER BY (updated_at DESC);
```

Atau kalau status per officer:

```sql
CREATE TABLE cases_by_officer_status_day (
    tenant_id text,
    officer_id text,
    status text,
    day date,
    updated_at timestamp,
    case_id text,
    PRIMARY KEY ((tenant_id, officer_id, status, day), updated_at, case_id)
) WITH CLUSTERING ORDER BY (updated_at DESC);
```

Filtering adalah smell yang harus memicu desain ulang:

```text
Apa partition key yang diketahui?
Apa hasil perlu diurutkan?
Berapa result size?
Apakah query ini seharusnya punya table sendiri?
```

---

## 1.20. Secondary Index dan Materialized View: Jangan Dijadikan Pelarian Awal

ScyllaDB punya secondary index, local secondary index, dan materialized view. Tapi untuk mental model awal, jangan jadikan itu jawaban pertama.

Jawaban pertama tetap:

```text
model table sesuai query.
```

Index bisa berguna ketika:

```text
- cardinality dan selectivity masuk akal,
- query bukan critical hot path ekstrem,
- result set bounded,
- write amplification diterima,
- behavior consistency/index update dipahami,
- operational monitoring siap.
```

Index berbahaya ketika:

```text
- dipakai untuk menggantikan data modeling,
- kolom low-cardinality seperti status tanpa bucket,
- result set sangat besar,
- query critical p99 rendah,
- write rate tinggi,
- tim tidak paham index query path.
```

Materialized view juga bukan magic. Ia membuat view table dari base table, tetapi tetap punya cost, consistency behavior, dan operational consideration.

Dalam seri ini, index/MV dibahas detail di part 017. Untuk sekarang, simpan prinsip:

```text
Gunakan index setelah kamu bisa menjelaskan kenapa duplicate table bukan pilihan yang lebih baik.
```

---

## 1.21. Timestamp, Last-Write-Wins, dan Bahaya Menganggap Update Selalu Sederhana

ScyllaDB/Cassandra-style systems menggunakan timestamp pada mutation untuk menentukan versi cell. Ini menyebabkan last-write-wins semantics pada banyak skenario.

Secara mental:

```text
write A pada column X timestamp 10
write B pada column X timestamp 11
=> B menang
```

Kelihatannya sederhana. Tetapi dalam distributed system:

```text
- client clocks bisa skew,
- retry bisa mengirim mutation dengan timestamp berbeda,
- dua service bisa update field sama,
- delete/tombstone juga punya timestamp,
- write timeout tidak berarti write tidak terjadi,
- old write dengan timestamp baru bisa menimpa state yang lebih benar.
```

Contoh regulatory case state:

```text
OPEN -> UNDER_REVIEW -> CLOSED
```

Kalau dua service bisa menulis status:

```text
Service A menulis CLOSED
Service B retry menulis UNDER_REVIEW dengan timestamp lebih baru
```

Secara bisnis, state mundur. Secara database, write terbaru menang.

Karena itu, untuk state machine penting, jangan hanya mengandalkan “update status”. Kamu perlu desain correctness:

```text
- monotonic transition validation di application layer,
- LWT untuk transition tertentu,
- event log sebagai source of truth,
- version number,
- idempotency key,
- reconciliation,
- audit trail immutable.
```

Ini bukan detail kecil. Ini inti defensibility sistem case/regulatory.

---

## 1.22. Read Path Mental Model: Kenapa Query Murah Bisa Sangat Murah

Query paling murah di ScyllaDB adalah query yang menentukan partition key lengkap dan membaca range kecil di clustering order.

Contoh:

```sql
SELECT *
FROM case_events_by_case
WHERE tenant_id = ?
  AND case_id = ?
LIMIT 50;
```

Mental path:

```text
client driver tahu token/replica target
-> request ke coordinator/replica yang tepat
-> replica mencari partition
-> membaca awal clustering order
-> mengembalikan 50 row
```

Jika data ada di cache/memtable/SSTable yang mudah ditemukan, ini sangat cepat.

Query mahal:

```sql
SELECT *
FROM case_events_by_case
WHERE tenant_id = ?
ALLOW FILTERING;
```

Mental path:

```text
database tidak tahu satu partition pasti
-> perlu scan banyak partition/token range
-> baca banyak data
-> filter sebagian
-> latency tidak predictable
```

Wide-column store mengejar predictable latency dengan membatasi query shape. Ia bukan engine untuk arbitrary exploration.

---

## 1.23. Write Path Mental Model: Kenapa Write Cepat Tapi Bukan Gratis

Write ScyllaDB biasanya cepat karena tidak perlu mencari dan mengubah page random seperti banyak row-store scenario. Mutation ditulis ke commitlog/memtable dan nanti menjadi SSTable. Tapi write tetap punya cost:

```text
- replication ke beberapa replica,
- consistency level acknowledgement,
- commitlog durability,
- memtable memory,
- flush,
- compaction,
- write amplification,
- secondary index/materialized view update,
- tombstone lifecycle,
- cross-shard routing jika tidak shard-aware.
```

Write cepat bukan berarti kamu boleh menulis tanpa desain.

Bad write pattern:

```text
Untuk satu logical event, tulis ke 12 table synchronous,
semua dengan retry agresif,
tanpa idempotency,
tanpa bounded concurrency,
tanpa observability divergence.
```

Better write pattern:

```text
- bedakan critical source-of-truth write dan derived table write,
- pakai idempotency key,
- batasi concurrency,
- pilih consistency level sadar,
- gunakan retry hanya untuk idempotent mutation,
- siapkan reconciliation/backfill,
- monitor failed/partial derived writes.
```

ScyllaDB memindahkan banyak kompleksitas ke desain write path. Ini harga dari read path predictable.

---

## 1.24. Mental Model untuk Java Engineer

Sebagai Java engineer, kamu akan melihat ScyllaDB dari service boundary:

```text
Controller/API
-> application service
-> domain validation/state transition
-> repository/DAO
-> Java driver
-> ScyllaDB cluster
```

Kesalahan umum:

```java
repository.findByAnything(filterObject);
```

Ini SQL/JPA mindset. Di ScyllaDB, repository harus lebih eksplisit:

```java
caseEventsByCaseRepository.findLatest(tenantId, caseId, limit);
caseEventsByActorDayRepository.findByActor(tenantId, actorId, day, pageState);
caseByExternalRefRepository.findOne(tenantId, externalRef);
reviewQueueByOfficerDayRepository.findDue(tenantId, officerId, day, pageState);
```

Repository name sebaiknya mencerminkan table/access pattern. Jangan menyembunyikan physical model terlalu jauh sampai engineer lupa constraint-nya.

Contoh anti-pattern:

```java
interface CaseRepository {
    List<Case> search(CaseSearchCriteria criteria);
}
```

Kecuali method itu memakai search engine/OLAP/read model lain, ini berbahaya untuk ScyllaDB. Ia memberi ilusi arbitrary query.

Better:

```java
interface CaseByIdDao {
    Optional<CaseRow> getById(TenantId tenantId, CaseId caseId);
}

interface CasesByOfficerStatusDayDao {
    Page<CaseSummaryRow> findByOfficerStatusDay(
        TenantId tenantId,
        OfficerId officerId,
        CaseStatus status,
        LocalDate day,
        PageRequest pageRequest
    );
}

interface CaseEventsByCaseDao {
    Page<CaseEventRow> findLatestByCase(
        TenantId tenantId,
        CaseId caseId,
        int limit,
        PageState pageState
    );
}
```

ScyllaDB-friendly Java code membuat access pattern terlihat, bukan disembunyikan.

---

## 1.25. Design Smells: Tanda Kamu Masih Membawa Mental Model Salah

Berikut smell yang harus langsung membuatmu berhenti dan review desain.

### Smell 1: Banyak query butuh `ALLOW FILTERING`

Artinya table tidak didesain untuk query.

### Smell 2: Repository generic search terlalu fleksibel

Artinya application layer menganggap ScyllaDB seperti SQL/search engine.

### Smell 3: Partition key low cardinality

Contoh:

```text
status
country
tenant_type
case_type
```

Low-cardinality key membuat data menumpuk dan hot.

### Smell 4: Partition key terlalu high-cardinality tanpa locality

Contoh:

```text
event_id untuk timeline query
```

Distribusi bagus, locality buruk.

### Smell 5: Semua data tenant dalam satu partition

Ini sering terlihat masuk akal sampai tenant besar menghancurkan p99.

### Smell 6: Collection dipakai untuk list yang tumbuh tanpa batas

List/map/set besar bukan pengganti child table.

### Smell 7: Delete/TTL heavy tapi tidak ada tombstone strategy

TTL bukan free cleanup. TTL menghasilkan tombstone sebelum compaction membersihkan.

### Smell 8: Multi-table write tanpa idempotency

Retry akan membuat duplicate, inconsistent derived table, atau state mundur.

### Smell 9: Menganggap QUORUM berarti “seperti transaction SQL”

QUORUM bukan full serializable transaction.

### Smell 10: Tidak ada estimate partition size

Kalau kamu tidak bisa memperkirakan row per partition, kamu belum selesai desain.

---

## 1.26. Contoh Mental Model: Case Timeline

Requirement:

```text
Officer membuka halaman case detail dan melihat 100 event terbaru.
Event bisa mencapai ratusan ribu untuk case yang sangat aktif.
Mayoritas case hanya punya < 500 event.
Beberapa case investigasi besar bisa punya > 1 juta event selama bertahun-tahun.
```

Naive design:

```sql
CREATE TABLE case_events_by_case (
    tenant_id text,
    case_id text,
    event_time timestamp,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY ((tenant_id, case_id), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC);
```

Untuk mayoritas case, ini bagus. Tapi untuk case besar, partition bisa terlalu besar.

Pertanyaan:

```text
Apakah query selalu latest 100?
Apakah user perlu scroll history bertahun-tahun?
Apakah timeline difilter per bulan?
Apakah event lama lebih sering archive?
Apakah case besar rare tapi critical?
```

Alternatif bucketed:

```sql
CREATE TABLE case_events_by_case_month (
    tenant_id text,
    case_id text,
    month_bucket text,
    event_time timestamp,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, month_bucket), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC);
```

Trade-off:

```text
Pros:
- partition size bounded per case/month,
- old history lebih terkontrol,
- compaction/repair lebih sehat.

Cons:
- latest 100 mungkin perlu membaca current month lalu previous month jika current month sedikit,
- pagination lintas bucket lebih kompleks,
- application harus tahu bucket traversal.
```

Top-tier design bukan memilih salah satu secara dogmatis. Top-tier design menghitung workload dan memilih boundary yang paling aman.

---

## 1.27. Contoh Mental Model: Officer Queue

Requirement:

```text
Officer melihat daftar case yang harus direview hari ini,
diurutkan berdasarkan priority dan due_at.
Supervisor bisa reassign case ke officer lain.
Case bisa berubah status sehingga keluar dari queue.
```

Table:

```sql
CREATE TABLE review_queue_by_officer_day (
    tenant_id text,
    officer_id text,
    queue_day date,
    priority int,
    due_at timestamp,
    case_id text,
    case_title text,
    status text,
    risk_level text,
    PRIMARY KEY ((tenant_id, officer_id, queue_day), priority, due_at, case_id)
) WITH CLUSTERING ORDER BY (priority DESC, due_at ASC);
```

Query:

```sql
SELECT *
FROM review_queue_by_officer_day
WHERE tenant_id = ?
  AND officer_id = ?
  AND queue_day = ?
LIMIT 50;
```

Looks good. Tapi update/reassign membawa complexity:

```text
- insert row ke officer baru,
- delete row dari officer lama,
- update case_by_id,
- insert event timeline,
- mungkin update aggregate count.
```

Delete dari queue menghasilkan tombstone. Jika queue sering berubah, tombstone bisa menumpuk.

Alternatif:

```text
- queue rows immutable dengan status marker,
- short TTL untuk stale queue entries,
- background compaction/cleanup strategy,
- derived queue rebuilt dari event stream,
- explicit active flag dengan periodic repair.
```

Tidak ada jawaban universal. Yang penting: table design harus menyertakan mutation lifecycle, bukan hanya read query.

---

## 1.28. Contoh Mental Model: Lookup by External Reference

Requirement:

```text
External system mengirim reference number.
Service harus menemukan case_id.
Reference unik per tenant.
```

Table:

```sql
CREATE TABLE case_by_external_ref (
    tenant_id text,
    external_ref text,
    case_id text,
    status text,
    created_at timestamp,
    PRIMARY KEY ((tenant_id, external_ref))
);
```

Query:

```sql
SELECT *
FROM case_by_external_ref
WHERE tenant_id = ?
  AND external_ref = ?;
```

Ini seperti key-value lookup. Cocok.

Tapi uniqueness butuh perhatian:

```text
Apakah dua request concurrent bisa membuat case dengan external_ref sama?
```

Jika ya, pilihan:

```text
- LWT INSERT IF NOT EXISTS pada case_by_external_ref,
- external coordinator,
- upstream idempotency guarantee,
- deterministic case_id dari external_ref,
- reservation table.
```

Jangan menganggap primary key otomatis memberi uniqueness bisnis di seluruh workflow jika multi-table write tidak dirancang.

---

## 1.29. Query Shape Checklist

Untuk setiap query yang ingin kamu dukung, isi checklist ini.

```text
1. Apa nama access pattern-nya?
2. Siapa caller-nya?
3. Field apa yang pasti diketahui saat query masuk?
4. Mana yang menjadi partition key lengkap?
5. Apakah query menyentuh satu partition atau banyak partition?
6. Jika banyak partition, apakah fanout bounded dan sengaja?
7. Apakah result perlu sort order tertentu?
8. Apakah sort order itu clustering order?
9. Apakah query perlu range? Pada clustering key mana?
10. Berapa maksimal row yang dibaca per request?
11. Berapa maksimal byte yang dibaca per request?
12. Berapa rows per partition sekarang?
13. Berapa rows per partition dalam 1 tahun/3 tahun?
14. Apakah ada tenant/user/case outlier?
15. Apakah TTL/delete akan sering terjadi?
16. Apakah stale read acceptable?
17. Consistency level apa yang dibutuhkan?
18. Apakah write ke table ini source-of-truth atau derived?
19. Bagaimana table ini direpair/backfill?
20. Apa metric/alert untuk mendeteksi model ini rusak?
```

Kalau kamu tidak bisa menjawab sebagian besar, desain belum siap production.

---

## 1.30. Data Model Review Rubric

Gunakan rubric berikut saat review desain ScyllaDB.

### A. Query alignment

```text
- Semua query utama punya partition key lengkap.
- Range query hanya pada clustering key yang tepat.
- ORDER BY sesuai clustering order.
- Tidak ada query critical dengan ALLOW FILTERING.
```

### B. Partition health

```text
- Estimasi rows/partition tersedia.
- Estimasi bytes/partition tersedia.
- Hot key/outlier dianalisis.
- Bucketing dipertimbangkan jika perlu.
```

### C. Write path correctness

```text
- Multi-table writes terdaftar.
- Idempotency strategy ada.
- Retry safety jelas.
- Partial failure behavior jelas.
- Reconciliation/backfill strategy ada.
```

### D. Lifecycle

```text
- TTL/delete pattern dipahami.
- Tombstone risk dianalisis.
- Compaction strategy kandidat disebutkan.
- Retention requirement jelas.
```

### E. Operational fit

```text
- Cardinality cukup untuk distribusi.
- Workload read/write ratio jelas.
- Expected p99 target realistis.
- Metrics dan alerts dirancang.
- Failure mode utama sudah disimulasikan secara mental.
```

### F. Java integration

```text
- DAO mencerminkan access pattern.
- Prepared statements digunakan.
- Paging strategy jelas.
- Timeout/retry/idempotency policy jelas.
- Tidak ada generic repository yang menyembunyikan query shape.
```

---

## 1.31. Decision Matrix: ScyllaDB atau Bukan?

ScyllaDB cocok ketika:

```text
- workload OLTP high-throughput,
- query shape diketahui dan stabil,
- access pattern bisa dimodelkan dengan partition + clustering,
- scale-out horizontal penting,
- low-latency predictable lebih penting daripada arbitrary query,
- denormalization acceptable,
- eventual consistency antar derived views bisa dikelola,
- tim siap dengan operational discipline.
```

ScyllaDB kurang cocok ketika:

```text
- query ad-hoc sangat fleksibel,
- join kompleks adalah kebutuhan utama,
- transaksi multi-entity kuat adalah requirement inti,
- data model sering berubah tanpa access pattern stabil,
- analytics scan/aggregate besar adalah use case utama,
- full-text search adalah kebutuhan utama,
- tim tidak siap mengelola denormalized consistency.
```

Alternatif yang mungkin lebih cocok:

```text
- PostgreSQL/MySQL untuk relational transactional domain dengan join/constraint kuat.
- MongoDB untuk document aggregate yang cocok dengan boundary dokumen.
- Redis untuk ephemeral low-latency data structures/cache.
- Kafka untuk ordered event log/replay/integration stream.
- ClickHouse untuk analytical scan/aggregate.
- Elasticsearch/OpenSearch untuk text/search/filter exploration.
```

Top-tier engineer tidak memaksakan ScyllaDB. Top-tier engineer tahu kapan ScyllaDB memberi leverage dan kapan menjadi beban.

---

## 1.32. Latihan: Ubah Requirement Menjadi Access Pattern

Coba ambil requirement berikut:

```text
Regulator ingin melihat semua case aktif yang melewati SLA,
dikelompokkan per officer,
untuk tenant tertentu,
dengan sort berdasarkan breach severity dan due_at.
```

Jangan langsung membuat table. Jawab dulu:

```text
1. Siapa caller-nya?
2. Apakah query per officer atau semua officer?
3. Apakah result size bounded?
4. Apakah dashboard realtime atau precomputed?
5. Apakah group by dilakukan di database atau application?
6. Apakah data perlu diupdate saat status berubah?
7. Apakah breach severity berubah seiring waktu?
8. Apakah query perlu pagination?
9. Apakah query per day/week/month?
10. Apakah tenant besar bisa punya jutaan active case?
```

Kemungkinan model pertama:

```sql
CREATE TABLE breached_cases_by_officer_day (
    tenant_id text,
    officer_id text,
    breach_day date,
    severity int,
    due_at timestamp,
    case_id text,
    case_title text,
    status text,
    PRIMARY KEY ((tenant_id, officer_id, breach_day), severity, due_at, case_id)
) WITH CLUSTERING ORDER BY (severity DESC, due_at ASC);
```

Jika supervisor ingin semua officer, jangan scan semua officer tanpa batas. Mungkin butuh table lain:

```sql
CREATE TABLE breached_cases_by_tenant_day_bucket (
    tenant_id text,
    breach_day date,
    bucket int,
    severity int,
    due_at timestamp,
    officer_id text,
    case_id text,
    case_title text,
    status text,
    PRIMARY KEY ((tenant_id, breach_day, bucket), severity, due_at, officer_id, case_id)
) WITH CLUSTERING ORDER BY (severity DESC, due_at ASC);
```

Bucket diperlukan jika tenant besar. Kalau tidak, `(tenant_id, breach_day)` bisa menjadi hot/large partition.

Perhatikan: requirement yang terdengar seperti satu query bisnis bisa menjadi dua read models karena access pattern berbeda.

---

## 1.33. Ringkasan Mental Model

Simpan ringkasan ini:

```text
ScyllaDB table bukan entity table.
ScyllaDB table adalah physical read path.

Partition key memilih lokasi dan locality.
Clustering key memilih urutan dan range dalam locality itu.

Query murah = partition key lengkap + clustering range bounded.
Query mahal = scan/filter/sort tanpa alignment dengan key.

Denormalization bukan hack.
Denormalization adalah cara membayar read latency dengan write complexity.

Consistency level bukan transaction isolation.
Consistency level adalah jumlah replica acknowledgement/read response.

Timeout bukan proof of failure.
Timeout adalah uncertainty.

TTL/delete bukan free cleanup.
TTL/delete menghasilkan tombstone.

Large partition dan hot partition adalah desain failure, bukan sekadar tuning problem.

Java repository harus mengekspos access pattern, bukan menyembunyikan ScyllaDB di balik generic search abstraction.
```

---

## 1.34. Apa yang Harus Kamu Kuasai Sebelum Lanjut

Sebelum masuk part berikutnya, pastikan kamu bisa menjelaskan tanpa melihat catatan:

```text
1. Bedanya wide-column OLTP dan columnar OLAP.
2. Kenapa ScyllaDB bukan SQL tanpa join.
3. Kenapa table ScyllaDB didesain dari query.
4. Apa perbedaan partition key dan clustering key.
5. Kenapa partition key lengkap penting untuk query.
6. Kenapa clustering key menentukan sort/range yang murah.
7. Kenapa denormalization adalah default design.
8. Kenapa multi-table write butuh idempotency/reconciliation.
9. Kenapa ALLOW FILTERING adalah smell.
10. Kenapa large/hot partition adalah risiko desain.
```

Kalau sepuluh poin ini sudah terasa natural, kamu siap masuk ke Part 002: **Distributed OLTP Constraints: Latency, Throughput, Availability, Consistency**.

---

## 1.35. Referensi Resmi dan Bacaan Lanjutan

Referensi utama untuk part ini:

1. ScyllaDB Docs — CQL Data Definition / primary key, partition key, clustering column concepts.  
   `https://docs.scylladb.com/manual/stable/cql/ddl.html`

2. ScyllaDB Docs — Data Modeling Best Practices.  
   `https://docs.scylladb.com/stable/get-started/data-modeling/best-practices.html`

3. ScyllaDB Docs — Glossary, clustering key definition.  
   `https://docs.scylladb.com/manual/stable/reference/glossary.html`

4. ScyllaDB Glossary — Wide Column Store / Wide Column Database.  
   `https://www.scylladb.com/glossary/wide-column-store/`  
   `https://www.scylladb.com/glossary/wide-column-database/`

5. Apache Cassandra Documentation — Data Modeling Introduction.  
   `https://cassandra.apache.org/doc/latest/cassandra/developing/data-modeling/intro.html`

6. Apache Cassandra Documentation — CQL DDL / primary key and clustering columns.  
   `https://cassandra.apache.org/doc/latest/cassandra/developing/cql/ddl.html`



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation: OLTP Wide-Column Store, ScyllaDB, dan Cara Belajar Seri Ini</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-002.md">Part 002 — Distributed OLTP Constraints: Latency, Throughput, Availability, Consistency ➡️</a>
</div>

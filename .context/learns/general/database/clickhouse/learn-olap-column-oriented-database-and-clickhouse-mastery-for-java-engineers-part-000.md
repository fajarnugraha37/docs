# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-000.md

# Part 000 — Orientation: Why OLAP Is a Different Engineering Discipline

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Target pembaca: **Java software engineer / backend engineer / tech lead** yang sudah familiar dengan sistem transaksional, SQL, distributed systems, messaging, dan ingin menguasai sistem analitik skala besar secara arsitektural dan praktis.  
> Status seri: **Part 000 dari 35**. Seri **belum selesai**.

---

## 0. Cara Membaca Part Ini

Part ini bukan tutorial ClickHouse syntax.

Part ini adalah fondasi mental.

Kalau langsung melompat ke:

```sql
CREATE TABLE ... ENGINE = MergeTree ORDER BY ...
```

kita mungkin bisa membuat table, insert data, dan menjalankan query. Tetapi itu belum berarti kita memahami **mengapa ClickHouse cepat**, **mengapa schema tertentu buruk**, **mengapa query tertentu membaca terlalu banyak data**, atau **mengapa cluster tampak sehat tetapi dashboard tetap lambat**.

Part 000 bertujuan membentuk cara berpikir:

1. Apa bedanya OLAP dengan OLTP.
2. Mengapa column-oriented database berbeda secara fundamental dari row-oriented database.
3. Mengapa ClickHouse bukan sekadar “database SQL cepat”.
4. Apa jenis problem yang cocok dan tidak cocok untuk ClickHouse.
5. Apa saja axis desain yang harus selalu diperhatikan: latency, throughput, freshness, scan volume, cardinality, compression, concurrency, dan cost.
6. Bagaimana seluruh seri ini akan disusun agar tidak menjadi kumpulan tips terpisah.

Setelah part ini, targetnya bukan Anda langsung ahli ClickHouse, tetapi Anda punya **peta besar** sehingga setiap konsep berikutnya punya tempat yang jelas.

---

## 1. Core Thesis

OLAP adalah disiplin engineering yang berbeda karena sistem analitik mengoptimalkan hal yang berbeda dari sistem transaksional.

Sistem transaksional bertanya:

> “Bagaimana saya memproses satu perubahan bisnis secara benar, konsisten, dan aman?”

Sistem analitik bertanya:

> “Bagaimana saya membaca, mengagregasi, dan menafsirkan data dalam jumlah sangat besar dengan cepat, murah, dan cukup benar untuk kebutuhan keputusan?”

Perbedaan ini mengubah hampir semua keputusan:

| Area | OLTP / Transactional System | OLAP / Analytical System |
|---|---|---|
| Unit kerja utama | Transaction | Query scan / aggregation |
| Akses data | Beberapa row spesifik | Banyak row, sebagian kolom |
| Optimasi utama | Write correctness, consistency, point lookup | Read throughput, compression, aggregation speed |
| Pola query | Known access path, low latency per entity | Exploratory, group-by, top-N, filtering large range |
| Storage layout | Row-oriented sering ideal | Column-oriented sering ideal |
| Update | Sering, granular | Append-first, update/delete mahal relatif |
| Index | B-tree/hash untuk lookup | Sorting key, sparse index, pruning, skip index, pre-aggregation |
| Normalisasi | Penting untuk integrity | Sering dikompromikan untuk speed |
| Correctness | Strong transactional invariants | Metric correctness, reconciliation, data freshness, late events |
| Failure impact | Corrupt state bisnis | Wrong dashboard, wrong alert, wrong decision |

Sebagai Java engineer, Anda mungkin terbiasa memikirkan sistem dari perspektif service boundary, transaction boundary, aggregate root, database row, request-response, dan concurrency control.

Untuk OLAP, Anda perlu menambahkan perspektif baru:

> “Berapa banyak byte yang harus dibaca, didecompress, difilter, diagregasi, disortir, dan dikirim lewat network untuk menjawab pertanyaan ini?”

Itu adalah pertanyaan inti.

---

## 2. Apa Itu OLAP?

OLAP adalah singkatan dari **Online Analytical Processing**.

Secara praktis, OLAP adalah kelas sistem yang dirancang untuk membaca dan menganalisis data besar, biasanya untuk:

- dashboard bisnis,
- reporting,
- observability,
- product analytics,
- fraud analytics,
- audit analytics,
- operational intelligence,
- financial/regulatory reporting,
- ad-hoc analysis,
- data product,
- machine-learning feature exploration,
- near-real-time monitoring.

Contoh pertanyaan OLAP:

```text
Berapa jumlah transaksi per region per jam selama 30 hari terakhir?
```

```text
Berapa p95 latency API checkout per service, per version, per datacenter?
```

```text
Dari semua enforcement cases yang masuk bulan ini, berapa persen yang eskalasi ke investigation dalam 3 hari?
```

```text
Top 20 merchants dengan fraud signal tertinggi dalam 6 jam terakhir?
```

```text
Berapa jumlah event user per funnel step, segmented by acquisition channel?
```

Query-query tersebut biasanya memiliki ciri:

1. Membaca banyak baris.
2. Hanya membutuhkan beberapa kolom.
3. Banyak filter range waktu.
4. Banyak `GROUP BY`.
5. Banyak aggregation.
6. Banyak sort/top-N.
7. Sering membutuhkan data cukup fresh.
8. Tidak selalu membutuhkan row-level transaction semantics.

---

## 3. Apa Itu ClickHouse dalam Peta Ini?

ClickHouse adalah database management system **column-oriented** yang dibuat untuk workload **OLAP** dan real-time analytics. ClickHouse menyimpan data per kolom, bukan per row, dan mengeksekusi query dengan pendekatan vectorized/chunk-based sebanyak mungkin.

Secara praktis, ClickHouse sangat kuat untuk workload seperti:

- event analytics,
- logs analytics,
- metrics analytics,
- trace/span analytics,
- product analytics,
- dashboard real-time,
- high-cardinality analytical filtering,
- large-scale reporting,
- pre-aggregated serving tables,
- query cepat di dataset sangat besar.

ClickHouse bukan pengganti universal untuk PostgreSQL/MySQL sebagai database transaksional utama. Ia lebih tepat diposisikan sebagai:

1. **Analytical serving database**.
2. **Real-time data warehouse**.
3. **Speed layer** di atas OLTP/data lake/stream.
4. **Observability/event store** untuk query agregat cepat.
5. **Backend untuk analytics API**.

Dokumentasi resmi ClickHouse mendeskripsikan ClickHouse sebagai sistem database column-oriented untuk membuat laporan analitik real-time memakai SQL. Dokumentasi arsitekturnya juga menekankan penyimpanan kolom dan eksekusi vectorized sebagai prinsip utama.

---

## 4. Mengapa OLAP Bukan Sekadar SQL Besar?

Karena SQL adalah bahasa query, bukan model performa.

Dua query SQL yang terlihat sederhana bisa punya biaya eksekusi sangat berbeda.

Contoh:

```sql
SELECT count(*)
FROM events
WHERE event_date = today();
```

vs:

```sql
SELECT user_id, count(*)
FROM events
WHERE toString(metadata) LIKE '%timeout%'
GROUP BY user_id
ORDER BY count(*) DESC
LIMIT 100;
```

Keduanya tampak “SQL biasa”. Tetapi dari sisi mesin:

| Aspek | Query 1 | Query 2 |
|---|---:|---:|
| Filter bisa pruning data? | Sangat mungkin | Mungkin buruk |
| Kolom dibaca | Sedikit | Bisa banyak/mahal |
| Aggregation cardinality | 1 result | Bisa jutaan key |
| Sorting | Tidak | Ya |
| Memory pressure | Rendah | Bisa tinggi |
| CPU string processing | Rendah | Tinggi |
| Risiko full scan | Rendah-sedang | Tinggi |

Dalam OLAP, SQL hanya lapisan ekspresi. Yang penting adalah:

- physical layout,
- sort order,
- partitioning,
- compression,
- aggregation strategy,
- filter selectivity,
- cardinality,
- data freshness,
- distributed execution,
- memory limit,
- query concurrency.

Jadi, engineer OLAP yang kuat tidak hanya membaca SQL sebagai logic. Ia membaca SQL sebagai **rencana kerja fisik**.

Pertanyaannya selalu:

```text
Query ini akan membaca kolom apa?
Query ini bisa melewati data apa?
Query ini akan mengagregasi berapa banyak key?
Query ini akan menggunakan memory di mana?
Query ini akan melakukan network fan-out ke berapa shard?
Query ini butuh data raw atau bisa dijawab dari rollup?
```

---

## 5. OLTP vs OLAP: Perbedaan yang Sering Diremehkan

### 5.1 OLTP: Optimized for Change

OLTP mengoptimalkan perubahan state bisnis.

Contoh:

```text
Create order
Pay invoice
Approve case
Assign investigation
Update customer profile
Cancel shipment
```

Properti yang penting:

- ACID transaction,
- consistency,
- constraint enforcement,
- point lookup,
- row update,
- referential integrity,
- concurrency control,
- isolation level,
- correctness of current state.

Di Java backend, OLTP sering muncul sebagai:

```java
@Transactional
public void approveCase(CaseId id, User approver) {
    Case c = repository.findByIdForUpdate(id);
    c.approve(approver);
    auditLog.record(...);
    repository.save(c);
}
```

Pusat perhatian:

```text
Apakah state transition valid?
Apakah race condition dicegah?
Apakah invariant domain terjaga?
Apakah transaction atomic?
```

### 5.2 OLAP: Optimized for Reading Many Things

OLAP mengoptimalkan pembacaan banyak data untuk insight.

Contoh:

```text
Show count of approved cases by risk category per week.
```

Pusat perhatian berubah:

```text
Apakah query membaca terlalu banyak data?
Apakah data sudah disusun sesuai access pattern?
Apakah aggregation meledak karena cardinality?
Apakah dashboard perlu data raw atau rollup?
Apakah freshness 1 menit cukup atau harus 5 detik?
```

### 5.3 Satu Data, Dua Kebenaran Berbeda

Dalam OLTP:

```text
Case status saat ini adalah APPROVED.
```

Dalam OLAP:

```text
Berapa lama rata-rata case berada di status REVIEW sebelum APPROVED?
```

Untuk menjawab pertanyaan kedua, current state saja tidak cukup. Kita butuh history/event/state transition.

Ini alasan mengapa desain OLAP sering memerlukan:

- event log,
- audit trail,
- snapshots,
- slowly changing dimensions,
- derived metrics,
- rollups,
- correction strategy.

---

## 6. Column-Oriented Database: Intuisi Dasar

Bayangkan table event dengan 200 kolom dan 10 miliar row.

Query dashboard:

```sql
SELECT event_type, count(*)
FROM events
WHERE event_date >= today() - 7
  AND tenant_id = 'abc'
GROUP BY event_type;
```

Query ini mungkin hanya butuh kolom:

- `event_type`,
- `event_date`,
- `tenant_id`.

Dalam row store, data satu row disimpan bersama:

```text
row1: tenant_id, event_time, event_type, user_id, session_id, ip, url, metadata, ... 200 columns
row2: tenant_id, event_time, event_type, user_id, session_id, ip, url, metadata, ... 200 columns
row3: tenant_id, event_time, event_type, user_id, session_id, ip, url, metadata, ... 200 columns
```

Dalam column store, data disimpan per kolom:

```text
tenant_id:   abc, abc, xyz, ...
event_time:  t1,  t2,  t3, ...
event_type:  click, view, error, ...
user_id:     u1, u2, u3, ...
...
```

Konsekuensinya:

1. Query bisa membaca hanya kolom yang diperlukan.
2. Nilai dalam satu kolom cenderung mirip sehingga lebih mudah dikompresi.
3. CPU bisa memproses batch/vector nilai sejenis.
4. Aggregation/filtering pada kolom menjadi sangat efisien.
5. Rekonstruksi satu row penuh menjadi lebih mahal relatif.

Maka columnar database cocok untuk:

```text
Baca banyak row + sedikit kolom + agregasi/filter besar.
```

Dan kurang ideal untuk:

```text
Update satu row sering + ambil seluruh row lengkap + transactional invariant kompleks.
```

---

## 7. Kenapa Compression Sangat Penting di OLAP?

Compression bukan hanya soal hemat disk.

Di OLAP, compression sering langsung meningkatkan performa karena bottleneck query besar sering berada di I/O dan memory bandwidth.

Jika data 1 TB bisa dikompresi menjadi 150 GB, maka query yang perlu scan data tersebut membaca jauh lebih sedikit byte dari storage.

Tetapi compression bekerja baik jika data memiliki pola.

Contoh kolom `status`:

```text
OPEN, OPEN, OPEN, REVIEW, REVIEW, APPROVED, APPROVED, APPROVED
```

lebih mudah dikompresi daripada row campuran acak.

Columnar layout membantu karena nilai sejenis berdekatan.

Sorting key juga membantu karena jika data disusun berdasarkan `tenant_id`, `event_date`, `event_type`, maka nilai berulang dan berdekatan meningkat.

Inilah alasan physical order dalam ClickHouse bukan detail kecil. Ia memengaruhi:

- index pruning,
- compression ratio,
- disk I/O,
- CPU decompress,
- query latency,
- storage cost.

---

## 8. Vectorized Execution: Kenapa CPU Lebih Bahagia

Dalam banyak aplikasi Java, kita sering membayangkan processing seperti ini:

```java
for (Row row : rows) {
    if (row.getStatus().equals("APPROVED")) {
        count++;
    }
}
```

Ini row-at-a-time mental model.

Columnar analytical engine lebih suka memproses batch nilai:

```text
status column chunk:
[OPEN, REVIEW, APPROVED, APPROVED, OPEN, ...]
```

Operasi filter/agregasi bisa dilakukan pada arrays/chunks kolom. Ini sering disebut vectorized execution.

Keuntungannya:

1. Lebih sedikit overhead dispatch per nilai.
2. Lebih cache-friendly.
3. Lebih mudah memanfaatkan CPU modern.
4. Lebih efisien untuk operasi berulang pada tipe data sama.

ClickHouse secara arsitektural menyimpan data per kolom dan memproses data sebagai arrays/chunks dalam banyak operasi.

---

## 9. ClickHouse Sweet Spot

ClickHouse sangat cocok ketika workload Anda memiliki ciri-ciri berikut:

### 9.1 Data Besar, Query Agregat

Contoh:

```sql
SELECT toStartOfHour(event_time) AS hour,
       event_type,
       count(*)
FROM events
WHERE event_time >= now() - INTERVAL 7 DAY
GROUP BY hour, event_type
ORDER BY hour;
```

Ini cocok karena:

- scan banyak row,
- baca sedikit kolom,
- filter waktu,
- aggregation jelas,
- output jauh lebih kecil dari input.

### 9.2 Append-Heavy

ClickHouse cocok untuk event/log/measurement yang masuk terus-menerus.

Contoh:

```text
API logs
user events
payment events
case transition events
fraud signals
metric samples
trace spans
```

### 9.3 Query Bisa Didukung Physical Layout

Jika query sering filter by:

```text
tenant_id + time range
```

maka table bisa disusun dengan sorting key yang membantu pola tersebut.

### 9.4 Banyak Dashboard dan Analytics API

ClickHouse cocok sebagai backend query cepat untuk:

- dashboard internal,
- customer-facing analytics,
- operational cockpit,
- alert investigation,
- reporting explorer.

### 9.5 Data Freshness Penting, tetapi Tidak Harus Transactional

ClickHouse cocok untuk near-real-time analytics:

```text
Data masuk dalam hitungan detik/menit, lalu langsung bisa dianalisis.
```

Namun ClickHouse biasanya bukan tempat utama untuk memutuskan transaksi bisnis individual.

---

## 10. Kapan ClickHouse Tidak Cocok?

ClickHouse sering disalahgunakan karena performanya mengesankan. Tetapi ada workload yang tidak cocok.

### 10.1 High-Frequency Row Updates

Jika aplikasi Anda perlu update row individual secara sering:

```sql
UPDATE account SET balance = balance - 100 WHERE id = ?;
```

itu bukan sweet spot ClickHouse.

ClickHouse lebih append-oriented. Update/delete bisa dilakukan, tetapi model biayanya berbeda dan sering berupa mutation/rewrite, bukan update murah seperti OLTP row store.

### 10.2 Transactional Source of Truth

Jika sistem butuh:

- foreign key constraint,
- transaction multi-entity,
- uniqueness enforcement kuat,
- row locking,
- strict serializable workflow,
- transactional write path utama,

maka database OLTP tetap lebih cocok.

### 10.3 Point Lookup Dominan

Jika 99% query adalah:

```sql
SELECT * FROM users WHERE id = ?;
```

ClickHouse bukan pilihan utama.

### 10.4 Query Mengambil Banyak Row Penuh

Columnar database kuat ketika query membaca sebagian kolom. Jika Anda sering mengambil semua kolom untuk sedikit row atau banyak row penuh, keuntungan columnar berkurang.

### 10.5 Data Kecil dan Sederhana

Jika data kecil dan query sederhana, PostgreSQL/MySQL mungkin cukup. ClickHouse menambah operational surface area.

### 10.6 Need Sub-Millisecond Per-Entity Serving

Untuk serving entity individual dengan latency sangat rendah, key-value store/cache/search index mungkin lebih tepat.

---

## 11. Axis Desain OLAP yang Harus Selalu Dibawa

Saat mendesain ClickHouse, jangan mulai dari “table apa?”. Mulai dari axis berikut.

### 11.1 Latency

Latency adalah waktu query selesai.

Pertanyaan:

```text
Apakah dashboard boleh 2 detik?
Apakah API customer-facing harus <300 ms?
Apakah report batch boleh 5 menit?
```

Latency target mengubah desain:

- raw scan mungkin cukup,
- perlu materialized view,
- perlu projection,
- perlu rollup,
- perlu cache,
- perlu query limit,
- perlu precomputation.

### 11.2 Throughput

Throughput adalah jumlah data yang bisa diproses.

Ada dua throughput:

1. Ingestion throughput: rows/sec atau MB/sec masuk.
2. Query throughput: jumlah query/sec dan data scanned/sec.

ClickHouse bisa sangat cepat, tetapi tetap ada batas CPU, disk, memory, dan network.

### 11.3 Freshness

Freshness adalah seberapa baru data yang terlihat oleh query.

Contoh target:

```text
<5 seconds
<1 minute
<15 minutes
T+1 day
```

Freshness memengaruhi:

- ingestion architecture,
- batch size,
- async insert,
- materialized view lag,
- deduplication,
- late-arriving event handling.

### 11.4 Scan Volume

Scan volume adalah jumlah data yang dibaca query.

Ini sering menjadi penjelasan paling jujur untuk performa.

Query lambat biasanya karena:

```text
membaca terlalu banyak kolom,
membaca terlalu banyak granule,
mengagregasi terlalu banyak key,
atau melakukan distributed fan-out terlalu luas.
```

### 11.5 Cardinality

Cardinality adalah jumlah nilai unik.

Contoh cardinality rendah:

```text
status: OPEN, CLOSED, APPROVED
country: ID, SG, US, JP
risk_level: LOW, MEDIUM, HIGH
```

Contoh cardinality tinggi:

```text
user_id
request_id
session_id
trace_id
case_id
ip_address
url_full
```

High cardinality memengaruhi:

- group-by memory,
- index usefulness,
- compression,
- sort key design,
- dictionary encoding,
- rollup feasibility.

### 11.6 Selectivity

Selectivity adalah seberapa banyak data lolos filter.

Filter:

```sql
WHERE country = 'ID'
```

mungkin tidak terlalu selective jika 80% data dari Indonesia.

Filter:

```sql
WHERE tenant_id = 'tenant_123'
```

mungkin sangat selective jika ada ribuan tenant.

Index/sort key berguna jika membantu melewati data yang tidak perlu dibaca.

### 11.7 Concurrency

Query cepat sendirian belum tentu cepat saat 200 user dashboard refresh bersamaan.

Pertanyaan:

```text
Berapa banyak dashboard bersamaan?
Berapa banyak ad-hoc analyst?
Apakah query berat bisa mengganggu ingestion?
Apakah tenant besar bisa mengganggu tenant kecil?
```

Concurrency memengaruhi:

- resource governance,
- query limits,
- workload isolation,
- pre-aggregation,
- cache,
- cluster sizing.

### 11.8 Cost

Cost bukan hanya biaya server.

Cost mencakup:

- storage,
- CPU,
- memory,
- network,
- operational complexity,
- on-call burden,
- debugging time,
- data correctness incidents,
- rebuild/backfill cost.

OLAP system yang “cepat” tapi tidak bisa dioperasikan bukan sistem yang baik.

---

## 12. Mental Model: Query sebagai Pipeline Fisik

Jangan membaca query ClickHouse hanya seperti logic deklaratif.

Baca seperti pipeline:

```text
SQL text
  ↓
parse / analyze
  ↓
choose tables, columns, filters
  ↓
prune partitions / parts / granules
  ↓
read selected column chunks
  ↓
decompress
  ↓
apply filters
  ↓
compute expressions
  ↓
aggregate / join / sort
  ↓
merge partial results
  ↓
return result
```

Setiap tahap punya biaya.

### 12.1 Kolom yang Dibaca

Query:

```sql
SELECT count()
FROM events
WHERE event_time >= now() - INTERVAL 1 DAY;
```

bisa sangat murah karena tidak perlu membaca semua kolom.

Query:

```sql
SELECT *
FROM events
WHERE event_time >= now() - INTERVAL 1 DAY;
```

bisa jauh lebih mahal karena membaca semua kolom.

### 12.2 Granule yang Dibaca

ClickHouse tidak selalu membaca row satu per satu. Pada MergeTree, data disusun dalam granule/mark. Primary index yang sparse membantu menentukan granule mana yang mungkin relevan.

Jika sorting key cocok dengan filter, banyak granule bisa dilewati.

Jika tidak cocok, query mungkin harus membaca jauh lebih banyak data.

### 12.3 Data yang Didecompress

Compression mengurangi I/O tetapi membutuhkan CPU untuk decompress.

Jika query membaca banyak data compressed, bottleneck bisa pindah dari disk ke CPU.

### 12.4 Aggregation State

Query:

```sql
SELECT user_id, count()
FROM events
GROUP BY user_id;
```

bisa membutuhkan memory besar jika `user_id` cardinality tinggi.

### 12.5 Distributed Merge

Pada cluster, query bisa dieksekusi di banyak shard lalu hasil partial digabung.

Ini berarti ada biaya:

- fan-out,
- remote read,
- partial aggregation,
- network transfer,
- final merge.

---

## 13. Kenapa Sorting Key Lebih Penting dari Banyak Index

Engineer dari PostgreSQL/MySQL sering membawa intuisi:

```text
Kalau query lambat, tambahkan index.
```

Di ClickHouse, intuisi ini perlu dikalibrasi ulang.

ClickHouse MergeTree menggunakan physical order dan sparse primary index. Artinya data diurutkan berdasarkan key tertentu, lalu index menyimpan titik-titik referensi untuk melewati range data.

Primary key ClickHouse bukan primary key OLTP. Ia tidak menjamin uniqueness seperti primary key relational transactional database. Ia adalah alat untuk mengatur physical order dan mempercepat filtering.

Karena itu, pertanyaan desain utama bukan:

```text
Kolom apa yang harus dibuat index?
```

Tetapi:

```text
Dalam urutan apa data harus disimpan agar query utama membaca data sesedikit mungkin dan kompresi tetap baik?
```

Contoh buruk:

```sql
ORDER BY request_id
```

Jika `request_id` random UUID dan query utama filter by tenant + time, maka data yang relevan tersebar acak.

Contoh lebih masuk akal:

```sql
ORDER BY (tenant_id, event_date, event_time, event_type)
```

Jika query utama memang tenant/time-oriented.

Tetapi tidak ada key universal. Sorting key adalah trade-off.

---

## 14. OLAP Correctness: Bukan Hanya ACID

Dalam OLTP, correctness sering berarti:

```text
Transaction valid, constraints terpenuhi, state konsisten.
```

Dalam OLAP, correctness lebih luas dan sering lebih licin.

Pertanyaan correctness OLAP:

1. Apakah event duplicate?
2. Apakah event terlambat masuk?
3. Apakah timezone benar?
4. Apakah metric definisinya stabil?
5. Apakah denominator benar?
6. Apakah dimension berubah historis?
7. Apakah data raw dan rollup konsisten?
8. Apakah query dashboard exclude test data?
9. Apakah backfill overwrite data lama dengan benar?
10. Apakah delete/retention comply dengan kebijakan?

Contoh:

```text
“Jumlah case approved hari ini”
```

Tampak sederhana. Tetapi definisinya bisa ambigu:

- Approved berdasarkan waktu event approval?
- Approved berdasarkan current status saat query?
- Approved di timezone siapa?
- Jika approval dibatalkan, tetap dihitung?
- Jika event approval duplicate, dihitung sekali atau dua kali?
- Jika data terlambat datang besok, report hari ini berubah?
- Jika case pindah tenant/region, atribusi historis ikut berubah atau tetap?

OLAP engineering yang matang selalu memisahkan:

```text
Data truth
Metric definition
Query implementation
Serving latency
Operational reconciliation
```

---

## 15. Data Modeling Mindset: Event, State, Snapshot

Untuk analitik, Anda harus jelas jenis data yang sedang dimodelkan.

### 15.1 Event

Event adalah sesuatu yang terjadi pada waktu tertentu.

Contoh:

```text
case_created
case_assigned
case_escalated
case_approved
payment_failed
login_success
api_request_completed
```

Event biasanya append-only.

Kolom umum:

```text
event_time
event_type
entity_id
tenant_id
actor_id
attributes
```

Event cocok untuk:

- funnel,
- timeline,
- audit,
- transition analytics,
- volume over time,
- latency between events.

### 15.2 State

State adalah kondisi terkini entity.

Contoh:

```text
case_id = C123
status = APPROVED
assigned_team = Enforcement A
risk_level = HIGH
```

State cocok untuk:

- current dashboard,
- inventory current count,
- current open cases,
- latest profile.

Tetapi state saja buruk untuk menjawab history.

### 15.3 Snapshot

Snapshot adalah state yang diambil pada interval tertentu.

Contoh:

```text
Jumlah open cases per team setiap jam.
Daily balance snapshot.
End-of-day portfolio snapshot.
```

Snapshot cocok untuk:

- point-in-time reporting,
- trend current-state over time,
- reconciliation.

### 15.4 Derived Aggregate

Derived aggregate adalah hasil precomputed.

Contoh:

```text
cases_approved_daily_by_region
api_latency_p95_hourly_by_service
fraud_signal_count_5min_by_merchant
```

Ini cocok untuk dashboard cepat.

Trade-off:

```text
lebih cepat query, tetapi lebih kompleks ingestion/backfill/correction.
```

---

## 16. Freshness vs Correctness vs Cost

Salah satu trade-off paling penting:

```text
Apakah kita ingin jawaban cepat, sangat fresh, sangat benar, atau murah?
```

Tidak selalu bisa mendapat semuanya sekaligus.

### 16.1 Example: Real-Time Fraud Dashboard

Requirement:

```text
Dashboard fraud signal harus update dalam 10 detik.
```

Konsekuensi:

- ingestion harus near-real-time,
- batch terlalu besar bisa menambah lag,
- dedup harus cepat,
- late events harus ditangani,
- query harus ringan atau pre-aggregated,
- alert bisa false negative jika event terlambat.

### 16.2 Example: Regulatory Monthly Report

Requirement:

```text
Report bulanan harus akurat dan defensible.
```

Konsekuensi:

- freshness tidak perlu detik,
- reconciliation penting,
- lineage penting,
- metric definition harus versioned,
- correction/backfill harus traceable,
- auditability lebih penting daripada latency super rendah.

### 16.3 Lesson

Jangan memakai arsitektur yang sama untuk semua analytics.

Dashboard operational, customer analytics API, dan regulatory report punya SLA dan correctness profile berbeda.

---

## 17. ClickHouse di Arsitektur Sistem Java

Dalam sistem Java modern, ClickHouse biasanya bukan service pertama yang menerima command bisnis.

Pola yang lebih umum:

```text
Java service / OLTP database
        ↓
Domain events / CDC / outbox / log pipeline
        ↓
Ingestion layer
        ↓
ClickHouse raw tables
        ↓
Materialized views / rollups / serving tables
        ↓
Analytics API / dashboard / alerting / reporting
```

### 17.1 Jangan Jadikan ClickHouse sebagai Domain Transaction Boundary

Misalnya:

```text
Approve case → write ClickHouse → assume business state changed
```

Ini biasanya desain buruk.

Lebih baik:

```text
Approve case → OLTP transaction commits → event emitted → ClickHouse eventually reflects it
```

### 17.2 Analytics API dari Java

Java service bisa menggunakan ClickHouse untuk:

- dashboard query,
- reporting endpoint,
- customer-facing analytics,
- export,
- investigation drill-down,
- internal operation analytics.

Tetapi service harus mengatur:

- query timeout,
- parameter validation,
- tenant filtering,
- query limits,
- pagination/export model,
- backpressure,
- fallback/degradation,
- observability.

### 17.3 Jangan Biarkan User Menulis SQL Bebas Tanpa Guardrail

Untuk ad-hoc analyst internal mungkin boleh dengan environment khusus.

Untuk customer-facing API, query harus dikontrol.

Risiko SQL bebas:

- full scan tidak sengaja,
- memory explosion,
- cross-tenant data leak,
- query terlalu mahal,
- dashboard mengganggu ingestion,
- query injection.

---

## 18. Workload Taxonomy

Sebelum desain ClickHouse, klasifikasikan workload.

### 18.1 Dashboard Workload

Ciri:

- query berulang,
- pola relatif stabil,
- latency sensitif,
- concurrency bisa tinggi,
- cocok untuk rollup/pre-aggregation.

Contoh:

```text
Daily active users
Cases by status
Error rate by service
Transactions by region
```

### 18.2 Exploratory Analytics

Ciri:

- query ad-hoc,
- analyst mencoba berbagai dimensi,
- latency bisa lebih longgar,
- butuh raw/semi-raw data,
- resource isolation penting.

### 18.3 Customer-Facing Analytics API

Ciri:

- latency harus stabil,
- tenant isolation kritis,
- query harus bounded,
- caching berguna,
- API contract penting.

### 18.4 Observability

Ciri:

- ingest sangat besar,
- high-cardinality labels,
- retention agresif,
- query investigasi mendadak,
- sering time-range oriented.

### 18.5 Regulatory / Audit Reporting

Ciri:

- correctness dan traceability penting,
- data lineage penting,
- metric definition harus jelas,
- backfill dan reconciliation penting,
- latency sering lebih longgar.

---

## 19. The Dangerous Phrase: “Just Put It in ClickHouse”

Kalimat ini berbahaya karena menyembunyikan pertanyaan desain.

Harusnya kita bertanya:

1. Data apa yang masuk?
2. Apakah data append-only atau mutable?
3. Berapa volume per hari?
4. Berapa retention?
5. Query utama apa?
6. Filter utama apa?
7. Group-by utama apa?
8. Cardinality kolom-kolom utama bagaimana?
9. Berapa freshness yang dibutuhkan?
10. Apakah data bisa duplicate?
11. Apakah late event diterima?
12. Apakah perlu delete/PII erasure?
13. Apakah multi-tenant?
14. Apakah ada SLA customer-facing?
15. Apakah perlu rollup?
16. Apakah perlu raw data untuk audit?
17. Bagaimana backfill dilakukan?
18. Bagaimana correctness diverifikasi?
19. Bagaimana query buruk dibatasi?
20. Siapa yang on-call jika merge backlog naik?

Tanpa jawaban ini, table ClickHouse mungkin bisa dibuat, tetapi sistem analitiknya rapuh.

---

## 20. Example: Case Management Analytics

Karena Anda berada di area regulatory/case management, mari pakai contoh konkret.

### 20.1 OLTP View

Entity:

```text
Case
- case_id
- status
- assigned_team
- risk_level
- created_at
- updated_at
```

Workflow:

```text
CREATED → TRIAGED → UNDER_REVIEW → ESCALATED → INVESTIGATED → RESOLVED
```

OLTP concern:

- transition valid,
- actor authorized,
- SLA state updated,
- audit record written,
- notification sent.

### 20.2 OLAP Questions

Analytical questions:

```text
Berapa jumlah case yang masuk per risk level per hari?
```

```text
Berapa median waktu dari TRIAGED ke ESCALATED?
```

```text
Team mana yang memiliki backlog aging > 7 hari?
```

```text
Berapa persen case HIGH risk yang resolved dalam SLA?
```

```text
Apakah ada region dengan escalation spike dalam 24 jam terakhir?
```

### 20.3 Data yang Dibutuhkan

Satu table current state tidak cukup.

Kita mungkin butuh:

1. `case_events_raw`
   - satu row per event/transition.
2. `case_current_state`
   - latest known state per case.
3. `case_transition_durations`
   - derived table untuk durasi antar status.
4. `case_daily_rollup`
   - aggregate per day/team/risk/status.
5. `case_sla_breach_rollup`
   - aggregate untuk SLA monitoring.

### 20.4 ClickHouse Fit

ClickHouse cocok untuk query seperti:

```sql
SELECT
    toDate(event_time) AS day,
    risk_level,
    count() AS cases
FROM case_events
WHERE event_type = 'CASE_CREATED'
  AND event_time >= now() - INTERVAL 90 DAY
GROUP BY day, risk_level
ORDER BY day, risk_level;
```

Tetapi untuk command:

```text
Approve case C123 if user has authority and case is in UNDER_REVIEW.
```

pakai OLTP/domain service, bukan ClickHouse.

---

## 21. Example: Observability Analytics

### 21.1 Data

```text
api_request_completed
- timestamp
- service
- endpoint
- method
- status_code
- latency_ms
- trace_id
- tenant_id
- region
- version
```

### 21.2 Query

```sql
SELECT
    service,
    quantile(0.95)(latency_ms) AS p95,
    countIf(status_code >= 500) / count() AS error_rate
FROM api_events
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY service
ORDER BY error_rate DESC;
```

Ini sangat ClickHouse-friendly:

- time filter,
- baca sedikit kolom,
- aggregate banyak row,
- output kecil.

### 21.3 Hidden Complexity

Namun desain tetap sulit:

- `endpoint` cardinality bisa meledak jika mengandung ID mentah.
- `trace_id` high cardinality.
- `tenant_id` multi-tenant sensitive.
- retention logs bisa mahal.
- p99/p999 quantile butuh perhatian.
- dashboard high concurrency bisa membebani cluster.

---

## 22. Example: Product Analytics

### 22.1 Event

```text
user_signed_up
page_viewed
button_clicked
checkout_started
payment_completed
subscription_cancelled
```

### 22.2 Query

```text
Conversion funnel by acquisition channel.
Retention cohort by signup week.
Feature usage by plan.
Top flows before cancellation.
```

### 22.3 Challenges

- user identity merging,
- sessionization,
- bot/test data filtering,
- late mobile events,
- dimension changes,
- high-cardinality URLs,
- approximate distinct users,
- attribution windows.

ClickHouse bisa sangat kuat, tetapi metric definition harus matang.

---

## 23. Layering: Raw, Refined, Serving

Pola umum yang sehat:

```text
Raw layer
  ↓
Refined layer
  ↓
Serving layer
```

### 23.1 Raw Layer

Tujuan:

- simpan data sedekat mungkin dengan sumber,
- auditability,
- replay/backfill,
- debugging ingestion.

Karakter:

- append-only,
- schema mungkin masih fleksibel,
- query langsung bisa mahal,
- retention bisa berbeda.

### 23.2 Refined Layer

Tujuan:

- data dibersihkan,
- tipe dinormalisasi,
- dimensi penting diekstrak,
- duplicate ditangani,
- tenant/time fields jelas.

### 23.3 Serving Layer

Tujuan:

- query cepat,
- bentuk sesuai dashboard/API,
- bisa berupa rollup/materialized view,
- SLA jelas.

### 23.4 Kenapa Layering Penting

Tanpa raw layer, backfill sulit.

Tanpa refined layer, query menjadi penuh parsing dan conditional logic.

Tanpa serving layer, dashboard bisa terus-menerus melakukan full scan raw data.

---

## 24. Apa yang Membuat ClickHouse Cepat?

Secara ringkas, kombinasi beberapa hal:

1. Columnar storage.
2. Compression efektif.
3. Vectorized execution.
4. Sparse primary index.
5. Physical sorting via `ORDER BY`.
6. Partition pruning.
7. Data skipping indexes untuk kasus tertentu.
8. Parallel execution.
9. Distributed query execution.
10. MergeTree architecture untuk high ingest dan large volume.
11. Pre-aggregation via materialized views / aggregate engines.
12. Banyak fungsi analytics built-in.

Tetapi tidak ada magic.

ClickHouse cepat jika workload dan physical design cocok.

Jika desain buruk, ClickHouse tetap bisa dipaksa membaca terlalu banyak data, menghabiskan memory, dan menghasilkan query lambat.

---

## 25. ClickHouse Table Engine Mental Model

Di ClickHouse, table engine bukan detail minor. Engine menentukan bagaimana data disimpan, dibaca, digabung, direplikasi, dan dimutasi.

Engine paling penting adalah keluarga MergeTree.

MergeTree cocok untuk:

- volume data besar,
- high insert rate,
- data tersimpan sebagai parts,
- background merges,
- sparse primary index,
- partitioning,
- TTL,
- replication via replicated variants.

Part berikutnya akan membahas ini lebih dalam, tetapi untuk orientasi:

```text
Insert tidak selalu langsung menjadi satu file besar rapi.
Insert menghasilkan data parts.
Background process menggabungkan parts.
Query membaca parts yang relevan.
Primary index membantu melewati granules.
```

Ini menjelaskan banyak masalah produksi:

- terlalu banyak insert kecil → terlalu banyak parts,
- terlalu banyak partition → part explosion,
- mutation besar → rewrite berat,
- merge backlog → query/insert terganggu,
- salah ORDER BY → pruning buruk.

---

## 26. Ingestion: Yang Sering Menentukan Nasib Sistem

Banyak kegagalan ClickHouse bukan karena query, tetapi ingestion.

### 26.1 Small Insert Problem

Jika aplikasi mengirim insert row-by-row:

```text
insert 1 row
insert 1 row
insert 1 row
...
```

ClickHouse akan menerima banyak part kecil. Ini dapat membebani background merges.

Pola lebih sehat:

```text
batch rows → insert block
```

### 26.2 Retry dan Duplicate

Jika client timeout setelah insert, apakah data sudah masuk atau belum?

Jika retry dilakukan, apakah duplicate muncul?

Untuk analytics, duplicate bisa mengubah metric.

### 26.3 Late Events

Event mobile/offline/streaming bisa datang terlambat.

Pertanyaan:

```text
Apakah dashboard hari kemarin boleh berubah?
Apakah rollup harus dikoreksi?
Apakah report sudah closed period?
```

### 26.4 Backpressure

Jika ClickHouse lambat menerima data, upstream harus apa?

- buffer,
- drop,
- retry,
- degrade,
- circuit break,
- queue.

Ingestion architecture adalah bagian inti dari sistem OLAP, bukan plumbing.

---

## 27. Query Serving: Tidak Semua Query Harus ke Raw Table

Raw table memberi fleksibilitas, tetapi sering terlalu mahal untuk query berulang.

Contoh dashboard:

```text
count events by hour, tenant, event_type for last 30 days
```

Jika dashboard ini dibuka ratusan kali, jangan selalu scan raw events.

Alternatif:

1. Materialized view ke hourly rollup.
2. AggregatingMergeTree untuk aggregate states.
3. Projection jika cocok.
4. Cache di API layer.
5. Precomputed dashboard table.

Rule of thumb:

```text
Raw table untuk fleksibilitas dan audit.
Serving table untuk SLA.
```

---

## 28. Multi-Tenancy: Analytical Isolation Berbeda dari OLTP

Dalam OLTP, tenant isolation sering dilakukan di row-level application logic atau separate schema/database.

Dalam OLAP, multi-tenancy punya tambahan masalah:

1. Tenant besar bisa mendominasi storage.
2. Tenant besar bisa membuat query lebih mahal.
3. Query tanpa tenant filter bisa bocor data.
4. Sorting key perlu mempertimbangkan tenant.
5. Rollup harus menjaga boundary tenant.
6. Export tenant besar bisa mengganggu cluster.
7. Retention bisa berbeda per tenant.

Contoh sorting key:

```sql
ORDER BY (tenant_id, event_date, event_time)
```

bisa bagus jika hampir semua query tenant-scoped.

Tetapi jika query utama adalah global aggregate lintas tenant, key tersebut punya trade-off.

Tidak ada jawaban universal. Workload menentukan.

---

## 29. Design Smells Awal

Berikut tanda desain ClickHouse yang kemungkinan bermasalah.

### 29.1 `ORDER BY tuple()` untuk Table Besar

Tanpa sort key, ClickHouse kehilangan mekanisme utama untuk data pruning.

Mungkin acceptable untuk table kecil/staging, buruk untuk table besar production.

### 29.2 Random UUID sebagai Kolom Pertama Sorting Key

Random high-cardinality first key sering merusak locality untuk query time-range.

### 29.3 Terlalu Banyak Partition

Partition per tenant per day misalnya bisa menghasilkan ledakan jumlah part jika tenant banyak.

### 29.4 Semua Kolom Nullable

Nullable punya overhead dan sering menandakan schema belum dipikirkan.

### 29.5 Query Dashboard Langsung ke Raw Event Table Besar

Bisa benar untuk awal, tetapi sering gagal saat volume/concurrency naik.

### 29.6 Insert Row-by-Row dari Java

Ini hampir selalu buruk untuk throughput ClickHouse.

### 29.7 Menggunakan ClickHouse untuk Workflow Transactional

ClickHouse bukan workflow state machine database.

### 29.8 Tidak Ada Backfill Strategy

Analytics system tanpa backfill/replay strategy akan sulit diperbaiki ketika bug metric ditemukan.

### 29.9 Tidak Ada Query Guardrail

User/API bisa membuat full scan tak terbatas.

### 29.10 Tidak Ada Metric Definition Ownership

Dashboard cepat tetapi definisi metric berubah-ubah tetap berbahaya.

---

## 30. Cara Berpikir Top 1% untuk OLAP/ClickHouse

Engineer kuat tidak hanya tahu command. Ia punya kemampuan diagnosis dan desain.

### 30.1 Selalu Mulai dari Workload

Bukan:

```text
Table-nya bagaimana?
```

Tetapi:

```text
Pertanyaan apa yang harus dijawab?
Berapa sering?
Untuk siapa?
Dengan SLA apa?
Dengan correctness profile apa?
Dari data berapa besar?
```

### 30.2 Pisahkan Data Model dan Serving Model

Model raw yang bagus untuk audit belum tentu bagus untuk dashboard.

Model serving yang cepat belum tentu cukup untuk forensic analysis.

Butuh layering.

### 30.3 Treat Physical Design as API

`ORDER BY`, `PARTITION BY`, data type, TTL, dan materialized view adalah kontrak performa.

Mengubahnya nanti bisa mahal.

### 30.4 Measure, Jangan Tebak

Gunakan:

- query log,
- system tables,
- EXPLAIN,
- read rows/bytes,
- memory usage,
- part count,
- merge status,
- query duration percentiles.

### 30.5 Design for Repair

Bug analytics akan terjadi.

Maka desain harus mendukung:

- replay,
- backfill,
- rebuild rollup,
- verify counts,
- reconcile source vs derived,
- metric versioning.

### 30.6 Understand Failure Modes

OLAP failure mode bukan hanya “database down”.

Termasuk:

- dashboard stale,
- duplicate events,
- wrong aggregation,
- merge backlog,
- mutation stuck,
- memory limit exceeded,
- slow distributed query,
- replica lag,
- cost explosion,
- cross-tenant leak,
- retention accidentally deletes useful audit data.

---

## 31. Roadmap Seri Lengkap

Seri ini terdiri dari 35 part:

```text
part-000 Orientation: Why OLAP Is a Different Engineering Discipline
part-001 OLAP Workload Anatomy: Queries, Facts, Dimensions, Events, and Metrics
part-002 Columnar Storage Mental Model: From Rows to Columns to Compressed Blocks
part-003 ClickHouse Architecture Overview: Server, Tables, Parts, Blocks, and Pipelines
part-004 MergeTree Internals I: Parts, Granules, Marks, Primary Index, and Sorting Key
part-005 MergeTree Internals II: Background Merges, Mutations, TTL, and Part Explosion
part-006 Schema Design for ClickHouse: Physical Design Before Logical Beauty
part-007 Sorting Key Design: The Most Important Performance Decision
part-008 Partitioning Strategy: Lifecycle Boundary, Not Query Silver Bullet
part-009 Data Types, Compression, Encoding, and Storage Cost Engineering
part-010 Ingestion Architecture I: Inserts, Batching, Idempotency, and Backpressure
part-011 Ingestion Architecture II: Streaming, CDC, Object Storage, and Batch Loads
part-012 Query Execution Model: From SQL Text to Pipeline Execution
part-013 Aggregation Deep Dive: GROUP BY, States, Approximation, and Memory
part-014 Materialized Views I: Incremental Transformation Mental Model
part-015 Materialized Views II: Rollups, Pre-Aggregation, and Serving Tables
part-016 Projections, Data Skipping Indexes, and Secondary Access Paths
part-017 Joins in ClickHouse: Algorithms, Dictionaries, Denormalization, and Trade-offs
part-018 ClickHouse Table Engines Beyond Basic MergeTree
part-019 Updates, Deletes, Deduplication, and Mutable Analytics
part-020 Distributed ClickHouse I: Shards, Replicas, Distributed Tables, and Query Routing
part-021 Distributed ClickHouse II: Consistency, Failover, Keeper, and Operational Realities
part-022 Cloud-Native ClickHouse: Object Storage, Separation of Compute/Storage, and SharedMergeTree
part-023 Performance Engineering I: Reading EXPLAIN, Query Logs, and System Tables
part-024 Performance Engineering II: Query Optimization Patterns
part-025 Performance Engineering III: CPU, Memory, Disk, Network, and Concurrency
part-026 Data Modeling Patterns: Events, Metrics, Logs, Traces, Audits, and Case Lifecycles
part-027 Time-Series and Observability Analytics with ClickHouse
part-028 Real-Time Analytics Architecture: Freshness, Latency, and Correctness
part-029 Java Integration Deep Dive: Clients, JDBC, HTTP, Pooling, and Type Mapping
part-030 Application Architecture: Serving Analytics APIs from ClickHouse
part-031 Security, Governance, Multi-Tenancy, and Compliance
part-032 Backup, Restore, Migration, Backfill, and Disaster Recovery
part-033 Comparative Architecture: ClickHouse vs Druid, Pinot, BigQuery, Snowflake, DuckDB, Elasticsearch
part-034 Capstone: Designing a Production-Grade Real-Time Analytics Platform
```

Part ini adalah fondasi untuk seluruh roadmap.

---

## 32. Practical Orientation Checklist

Sebelum membuat table ClickHouse production, jawab pertanyaan berikut.

### 32.1 Data Shape

```text
Apa event/entity utama?
Append-only atau mutable?
Berapa row per hari?
Berapa ukuran per row?
Berapa retention?
Kolom mana high-cardinality?
Kolom mana low-cardinality?
Kolom mana sering null?
```

### 32.2 Query Shape

```text
Query paling penting apa?
Filter utama apa?
Group-by utama apa?
Sort/top-N utama apa?
Time range umum apa?
Apakah query tenant-scoped?
Apakah query global?
Apakah perlu drill-down raw?
```

### 32.3 SLA

```text
Latency target?
Freshness target?
Concurrency target?
Availability target?
Correctness requirement?
```

### 32.4 Physical Design

```text
ORDER BY apa?
PARTITION BY apa?
Data type apa?
TTL apa?
Perlu materialized view?
Perlu rollup?
Perlu projection/skip index?
```

### 32.5 Operations

```text
Bagaimana ingestion retry?
Bagaimana dedup?
Bagaimana backfill?
Bagaimana monitor part count?
Bagaimana monitor query lambat?
Bagaimana recovery?
Bagaimana access control?
Bagaimana retention/delete?
```

---

## 33. Mini Thought Experiments

Gunakan latihan ini untuk menguji mental model.

### 33.1 Experiment 1: Dashboard Lambat

Dashboard menjalankan query:

```sql
SELECT endpoint, count()
FROM api_events
WHERE timestamp >= now() - INTERVAL 30 DAY
GROUP BY endpoint
ORDER BY count() DESC
LIMIT 20;
```

Dashboard lambat.

Pertanyaan diagnosis:

1. Berapa row 30 hari?
2. Apakah `timestamp` bagian sorting key?
3. Apakah `endpoint` sudah normalized atau mengandung ID dinamis?
4. Berapa cardinality endpoint?
5. Berapa kolom yang dibaca?
6. Apakah perlu rollup harian/jam?
7. Apakah query ini dipanggil banyak user?
8. Apakah hasilnya bisa cache?

### 33.2 Experiment 2: Metric Berubah Setelah Backfill

Report minggu lalu berubah setelah backfill.

Pertanyaan:

1. Apakah event terlambat memang valid?
2. Apakah report period sudah closed?
3. Apakah duplicate masuk?
4. Apakah materialized view ikut direbuild?
5. Apakah metric definition memperbolehkan restatement?
6. Apakah stakeholder tahu data bisa berubah?

### 33.3 Experiment 3: Insert Throughput Turun

Ingestion mulai lambat.

Pertanyaan:

1. Apakah insert terlalu kecil?
2. Berapa jumlah active parts?
3. Apakah merge backlog naik?
4. Apakah disk penuh/lambat?
5. Apakah mutation sedang berjalan?
6. Apakah partition terlalu granular?
7. Apakah compression codec terlalu berat?
8. Apakah cluster menerima query berat bersamaan?

### 33.4 Experiment 4: Multi-Tenant Query Bocor

Customer A melihat data Customer B.

Pertanyaan:

1. Apakah tenant filter enforced di API?
2. Apakah query builder aman?
3. Apakah row policy dipakai?
4. Apakah materialized view menyimpan tenant_id?
5. Apakah aggregate table kehilangan tenant dimension?
6. Apakah cache key include tenant?

---

## 34. Vocabulary Awal

Beberapa istilah yang akan sering muncul:

| Istilah | Makna Praktis |
|---|---|
| OLAP | Sistem untuk analisis data besar |
| OLTP | Sistem untuk transaksi bisnis |
| Columnar | Data disimpan per kolom |
| Row store | Data disimpan per row |
| Scan | Membaca banyak data untuk query |
| Predicate | Kondisi filter, misalnya `WHERE tenant_id = ...` |
| Cardinality | Jumlah nilai unik |
| Selectivity | Seberapa sempit filter |
| Compression | Penyandian data agar lebih kecil |
| Vectorized execution | Eksekusi batch/chunk nilai kolom |
| MergeTree | Keluarga engine utama ClickHouse |
| Part | Unit data fisik di MergeTree |
| Granule | Unit data yang bisa dilewati/dibaca via index granularity |
| Mark | Metadata posisi baca untuk granule |
| Sparse primary index | Index ringkas yang tidak menunjuk setiap row |
| Sorting key | Urutan fisik data pada disk |
| Partition | Boundary lifecycle/pruning tingkat besar |
| Materialized view | Transformasi/precompute saat insert |
| Rollup | Aggregate pada resolusi lebih kasar |
| Freshness | Seberapa baru data terlihat |
| Backfill | Mengisi/memperbaiki data historis |
| Mutation | Update/delete/rewrite data existing |

---

## 35. What You Should Remember

Jika hanya mengingat beberapa hal dari part ini, ingat ini:

1. OLAP berbeda dari OLTP karena unit optimasinya adalah scan/agregasi besar, bukan transaction row-level.
2. Columnar database cepat karena membaca kolom yang diperlukan, mengompresi lebih baik, dan memproses data dalam batch/vector.
3. ClickHouse sangat cocok untuk append-heavy real-time analytics, bukan sebagai source-of-truth transactional workflow.
4. Performa ClickHouse sangat bergantung pada physical design: sorting key, partition, data type, ingestion pattern, dan pre-aggregation.
5. SQL di OLAP harus dibaca sebagai pipeline fisik: kolom dibaca, granule dilewati, data didecompress, aggregation state dibuat, hasil digabung.
6. Cardinality, selectivity, scan volume, freshness, concurrency, dan cost harus selalu dipikirkan.
7. Raw data, refined data, dan serving data sebaiknya dipisahkan.
8. Correctness OLAP mencakup duplicate, late event, metric definition, timezone, backfill, lineage, dan reconciliation.
9. Sistem analitik yang baik harus bisa diperbaiki: replay, backfill, rebuild, verify.
10. Jangan “just put it in ClickHouse”; desainlah berdasarkan workload dan failure mode.

---

## 36. Latihan Mandiri

Jawab dengan konteks sistem Anda sendiri.

### Latihan 1 — Pilih Satu Use Case Analytics

Pilih satu use case:

```text
case lifecycle analytics
API observability
customer-facing product analytics
fraud/risk monitoring
regulatory reporting
```

Tuliskan:

1. 5 pertanyaan bisnis/operasional yang ingin dijawab.
2. Data source untuk masing-masing pertanyaan.
3. Apakah butuh event, state, snapshot, atau aggregate.
4. Freshness target.
5. Correctness risk.

### Latihan 2 — Identifikasi Cardinality

Ambil 20 kolom dari event Anda.

Kategorikan:

```text
low cardinality
medium cardinality
high cardinality
unbounded cardinality
```

Lalu pikirkan dampaknya untuk:

- compression,
- group by,
- sorting key,
- filtering,
- rollup.

### Latihan 3 — Query Cost Reading

Ambil satu query dashboard.

Jawab:

1. Kolom apa saja yang dibaca?
2. Time range berapa?
3. Apakah filter cocok dengan physical order?
4. Berapa estimasi row yang discan?
5. Berapa cardinality group-by?
6. Apakah raw scan masuk akal atau butuh rollup?

### Latihan 4 — Failure Mode

Untuk satu pipeline analytics, tuliskan apa yang terjadi jika:

1. Event duplicate.
2. Event terlambat 2 hari.
3. Backfill salah.
4. Query dashboard full scan.
5. Tenant filter hilang.
6. Materialized view gagal.
7. Retention menghapus data yang masih dibutuhkan.

---

## 37. Referensi Resmi dan Bacaan Lanjutan

Referensi ini akan menjadi dasar untuk part-part berikutnya:

1. ClickHouse official site — deskripsi ClickHouse sebagai open-source column-oriented DBMS untuk real-time analytical reports dengan SQL: https://clickhouse.com/
2. ClickHouse Docs — What is ClickHouse?: https://clickhouse.com/docs/intro
3. ClickHouse Docs — Architecture Overview: https://clickhouse.com/docs/development/architecture
4. ClickHouse Docs — What is a columnar database?: https://clickhouse.com/docs/faq/general/columnar-database
5. ClickHouse Docs — MergeTree table engine: https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree
6. ClickHouse Docs — MergeTree Engine Family: https://clickhouse.com/docs/engines/table-engines/mergetree-family
7. ClickHouse Docs — Primary indexes: https://clickhouse.com/docs/primary-indexes
8. ClickHouse Docs — Sparse primary indexes best practice: https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes
9. ClickHouse Docs — Choosing a primary key: https://clickhouse.com/docs/best-practices/choosing-a-primary-key
10. ClickHouse Docs — Data skipping indexes: https://clickhouse.com/docs/optimize/skipping-indexes
11. ClickHouse Docs — Data types: https://clickhouse.com/docs/sql-reference/data-types
12. ClickHouse Docs — TTL: https://clickhouse.com/docs/guides/developer/ttl
13. ClickHouse Java Clients & JDBC Driver: https://github.com/ClickHouse/clickhouse-java

---

## 38. Penutup Part 000

Part ini adalah orientasi dan mental model dasar.

Kita belum masuk detail syntax, table engine, atau tuning. Itu disengaja. Tanpa fondasi ini, ClickHouse mudah dipelajari sebagai kumpulan fitur, tetapi sulit dikuasai sebagai sistem.

Pada part berikutnya, kita akan masuk ke:

```text
Part 001 — OLAP Workload Anatomy: Queries, Facts, Dimensions, Events, and Metrics
```

Di sana kita akan membedah bentuk workload OLAP secara lebih formal: fact, dimension, measure, event, metric, granularity, additive/semi-additive/non-additive metrics, cohort, funnel, retention, dan bagaimana menerjemahkan requirement analytics menjadi model data yang bisa dieksekusi efisien.

**Status seri:** belum selesai. Ini adalah **Part 000 dari 35**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-001.md">Part 001 — OLAP Workload Anatomy: Queries, Facts, Dimensions, Events, and Metrics ➡️</a>
</div>

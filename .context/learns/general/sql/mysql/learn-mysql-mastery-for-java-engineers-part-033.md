# learn-mysql-mastery-for-java-engineers-part-033.md

# Part 033 — Performance Engineering Methodology

## Status seri

- Seri: `learn-mysql-mastery-for-java-engineers`
- Part: `033 / 034`
- Topik: **Performance Engineering Methodology**
- Status seri setelah part ini: **belum selesai**
- Part berikutnya: `learn-mysql-mastery-for-java-engineers-part-034.md` — **Production Readiness Checklist and Capstone Architecture**

---

## 1. Tujuan bagian ini

Bagian ini membahas **cara berpikir performance engineering untuk MySQL**, bukan sekadar daftar konfigurasi atau tips query tuning.

Banyak engineer mengira tuning MySQL berarti:

```text
Tambah index.
Naikkan buffer pool.
Naikkan connection pool.
Gunakan EXPLAIN.
Selesai.
```

Itu terlalu dangkal.

Performance engineering yang benar adalah proses sistematis untuk menjawab:

1. Workload apa yang sedang dilayani?
2. Bottleneck sebenarnya di mana?
3. Apakah masalahnya ada di query, index, schema, transaction, connection pool, storage, replication, atau pola aplikasi?
4. Apakah perubahan yang dilakukan benar-benar memperbaiki metrik yang penting?
5. Apakah perbaikannya stabil di bawah load, data growth, concurrency, dan failure condition?
6. Apakah perubahan itu aman secara correctness?

Performance bukan hanya tentang membuat query cepat. Performance adalah kemampuan sistem memenuhi **SLO** di bawah kondisi realistis tanpa merusak correctness, operability, dan evolvability.

---

## 2. Mental model utama

### 2.1 Performance adalah properti workload, bukan properti query tunggal

Query yang cepat dalam isolasi bisa menjadi buruk saat:

- dijalankan ribuan kali per menit,
- berjalan bersamaan dengan transaksi write,
- mengakses data yang tidak lagi muat di buffer pool,
- memicu lock contention,
- menghasilkan temporary table besar,
- menyebabkan replication lag,
- dipanggil dari endpoint yang juga melakukan external API call,
- dijalankan dengan parameter yang distribusinya sangat skewed.

Jadi pertanyaan yang lebih benar bukan:

```text
Apakah query ini cepat?
```

Tetapi:

```text
Apakah workload ini stabil pada volume, concurrency, distribusi data, dan SLO yang ditargetkan?
```

---

### 2.2 Performance selalu punya trade-off

Tidak ada tuning gratis.

Contoh:

| Optimisasi | Manfaat | Biaya / Risiko |
|---|---|---|
| Tambah index | Read lebih cepat | Write lebih mahal, storage naik, optimizer bisa pilih plan berbeda |
| Naikkan connection pool | Lebih banyak request bisa menunggu DB | DB bisa overload, memory per connection naik, lock contention naik |
| Batch write | Throughput naik | Transaction lebih lama, lock lebih lama, rollback lebih mahal |
| Denormalisasi | Query read lebih cepat | Consistency logic pindah ke aplikasi |
| Cache | Latency turun | Staleness, invalidation, correctness risk |
| Read replica | Scale read | Stale read, read-your-writes problem, routing complexity |
| Partitioning | Retention/drop partition lebih murah | Query/index/migration complexity naik |
| Lower durability setting | Commit lebih cepat | Data loss risk saat crash |

Top engineer tidak hanya bertanya “lebih cepat atau tidak”, tetapi juga:

```text
Lebih cepat dengan membayar apa?
```

---

### 2.3 Latency adalah distribusi, bukan angka tunggal

Rata-rata latency sering menipu.

Misalnya:

```text
Average latency: 20 ms
```

Terdengar bagus. Tapi bisa saja distribusinya:

```text
P50  = 5 ms
P95  = 80 ms
P99  = 900 ms
P999 = 5 s
```

Untuk user-facing system, queue worker, SLA escalation, atau regulatory case processing, tail latency sering lebih penting daripada average.

Kenapa?

Karena user dan workflow merasakan request nyata, bukan rata-rata statistik.

Jika endpoint membuka case detail memanggil 8 query serial, dan masing-masing punya P99 200 ms, maka total tail latency bisa meledak.

---

## 3. Performance taxonomy: masalah bisa muncul di banyak layer

Masalah MySQL jarang berdiri sendiri. Ia sering berada di antara beberapa layer.

```text
User request
   ↓
HTTP endpoint
   ↓
Java service
   ↓
Transaction boundary
   ↓
Connection pool
   ↓
JDBC driver
   ↓
MySQL connection/session
   ↓
Parser / optimizer / executor
   ↓
InnoDB buffer pool / locks / logs
   ↓
Storage / network / replication
```

Jika hanya melihat satu layer, diagnosis mudah salah.

---

## 4. Jenis bottleneck utama di MySQL-backed Java system

### 4.1 CPU-bound di MySQL

Gejala:

- MySQL CPU tinggi.
- Query latency naik.
- Disk I/O tidak dominan.
- Banyak query melakukan scan, sort, aggregation, function evaluation, JSON extraction, atau join besar.

Kemungkinan penyebab:

- missing index,
- bad execution plan,
- query terlalu kompleks,
- expression di predicate membuat index tidak efektif,
- JSON processing berlebihan,
- ORDER BY / GROUP BY besar,
- terlalu banyak query per request,
- high QPS dari polling/dashboard.

Contoh masalah:

```sql
SELECT *
FROM enforcement_case
WHERE LOWER(subject_name) = LOWER(?);
```

Jika tidak ada functional index yang sesuai, fungsi pada kolom dapat membuat index biasa tidak berguna.

Perbaikan mungkin:

- simpan normalized column,
- gunakan generated column,
- gunakan functional index,
- ubah collation bila semantik cocok,
- batasi query pattern.

---

### 4.2 I/O-bound

Gejala:

- Disk read/write tinggi.
- Buffer pool miss tinggi.
- Query lambat terutama saat cold cache.
- Checkpoint/flushing pressure tinggi.
- Commit latency tidak stabil.

Kemungkinan penyebab:

- working set lebih besar dari buffer pool,
- table/index terlalu besar,
- query scan banyak page,
- secondary index lookup banyak random I/O,
- temporary table jatuh ke disk,
- redo/binlog fsync pressure,
- storage cloud latency.

Perbaikan mungkin:

- index yang lebih selektif,
- covering index,
- archiving/purging data lama,
- partitioning untuk retention,
- mengurangi row width,
- menaikkan buffer pool dengan batas realistis,
- storage class yang lebih baik,
- batching yang lebih tepat,
- mengurangi write amplification.

---

### 4.3 Lock-bound

Gejala:

- CPU rendah tapi request lambat.
- Banyak thread menunggu lock.
- `Lock wait timeout exceeded`.
- Deadlock meningkat.
- Query update/delete sederhana tiba-tiba lama.

Kemungkinan penyebab:

- transaksi terlalu lama,
- range update tanpa index tepat,
- missing index menyebabkan lock footprint besar,
- update order tidak konsisten,
- external call di dalam transaksi,
- job batch mengunci banyak row,
- foreign key locking,
- hot row / hot counter.

Perbaikan mungkin:

- perkecil transaction boundary,
- perbaiki index untuk predicate locking,
- deterministic update order,
- optimistic locking,
- idempotent retry,
- split hot aggregate,
- queue pattern dengan `SKIP LOCKED`,
- batch lebih kecil.

---

### 4.4 Connection-bound

Gejala:

- Java service menunggu connection dari HikariCP.
- MySQL `Threads_connected` tinggi.
- MySQL CPU tidak selalu tinggi.
- Request timeout terjadi sebelum query dieksekusi.

Kemungkinan penyebab:

- pool terlalu kecil untuk legitimate concurrency,
- pool terlalu besar hingga DB overload,
- connection leak,
- transaction terlalu lama,
- slow query menahan connection,
- endpoint melakukan banyak query serial,
- external call dalam transaction menahan connection.

Kesalahan umum:

```text
Masalah: Hikari pool exhausted.
Solusi salah: naikkan maximumPoolSize besar-besaran.
```

Jika akar masalah adalah query lambat atau transaksi terlalu lama, menaikkan pool hanya membuat MySQL menerima lebih banyak kerja yang belum sanggup diselesaikan.

---

### 4.5 Replication-bound

Gejala:

- Replica lag.
- Read replica stale.
- Reporting query mengganggu replica.
- Failover menghasilkan kehilangan data atau stale state.

Kemungkinan penyebab:

- write burst di primary,
- replica storage lebih lambat,
- long-running query di replica,
- single-thread bottleneck pada apply path tertentu,
- large transaction,
- DDL besar,
- network delay,
- insufficient replica resources.

Perbaikan mungkin:

- kecilkan transaction batch,
- pisahkan reporting replica,
- parallel replication tuning,
- hindari read-your-writes dari replica,
- gunakan GTID/session consistency strategy,
- buat routing rule berbasis consistency need.

---

### 4.6 Application-bound

Gejala:

- MySQL tampak normal, tapi aplikasi lambat.
- Banyak query kecil per request.
- ORM menghasilkan SQL buruk.
- Serialization/deserialization mahal.
- DTO mapping berlebihan.
- Network round-trip tinggi.

Kemungkinan penyebab:

- N+1 query,
- chatty repository calls,
- lazy loading tidak terkendali,
- batch tidak digunakan,
- query result terlalu besar,
- service melakukan redundant lookup,
- cache local tidak ada untuk reference data yang aman.

Perbaikan mungkin:

- reshape query,
- projection DTO,
- fetch join secara hati-hati,
- batch fetch,
- reduce round-trip,
- caching dengan invalidation boundary jelas,
- command/query separation.

---

## 5. Metodologi performance engineering

Gunakan siklus berikut:

```text
1. Define objective
2. Model workload
3. Measure baseline
4. Identify bottleneck
5. Form hypothesis
6. Change one thing
7. Re-measure
8. Validate correctness
9. Validate under concurrency
10. Document and guard against regression
```

Mari pecah satu per satu.

---

## 6. Step 1 — Define objective

Jangan mulai tuning sebelum objective jelas.

Objective buruk:

```text
Database harus lebih cepat.
```

Objective lebih baik:

```text
Endpoint GET /cases/search harus memenuhi P95 < 300 ms dan P99 < 1 s
untuk 200 RPS, dengan 50 juta case rows, 3 tahun data aktif,
dan 20 filter kombinasi paling umum.
```

Objective produksi harus menyebut:

- endpoint/job/query/workload mana,
- target throughput,
- target latency,
- target percentile,
- data volume,
- concurrency,
- read/write ratio,
- correctness requirement,
- freshness requirement,
- failure tolerance.

Contoh untuk regulatory platform:

```text
SLA escalation worker harus dapat mengevaluasi 2 juta active obligations
setiap 5 menit tanpa mengunci case update transaction dan tanpa menyebabkan
replication lag lebih dari 30 detik.
```

Objective ini jauh lebih berguna daripada “query escalation harus cepat”.

---

## 7. Step 2 — Model workload

Workload model menjawab:

```text
Sistem ini sebenarnya melakukan apa ke database?
```

Minimal workload model:

| Dimensi | Pertanyaan |
|---|---|
| Volume data | Berapa row sekarang? Berapa growth per bulan? |
| Hot set | Data mana yang sering diakses? |
| Read/write ratio | Lebih banyak read, write, atau mixed? |
| Query mix | Query top apa saja berdasarkan frequency dan cost? |
| Concurrency | Berapa request/job paralel? |
| Distribution | Apakah tenant/status/date/user tersebar merata atau skewed? |
| Transaction shape | Berapa row dikunci per transaksi? Berapa lama? |
| Freshness | Boleh stale read atau harus primary? |
| Retention | Data lama tetap online atau bisa archive? |

---

### 7.1 Contoh workload model: case search

```text
Feature: case search page
Data size:
  - 80 million total cases
  - 8 million active/open cases
  - 5 years retained online

Query pattern:
  - tenant_id always present
  - status often present
  - assigned_team often present
  - created_at range often present
  - subject_name sometimes present
  - free text sometimes present

Sort:
  - default by priority_score desc, updated_at desc, case_id desc
  - alternate by created_at desc

Pagination:
  - users rarely go beyond first 5 pages
  - API currently uses OFFSET

SLO:
  - P95 < 500 ms for first page
  - P99 < 1.5 s

Freshness:
  - must show committed changes within primary transaction boundary
  - replica allowed only for export/reporting, not active queue
```

Dari model ini, kita sudah bisa melihat beberapa keputusan:

- tenant harus muncul di composite index,
- status/team/date/sort perlu diprioritaskan,
- offset pagination berbahaya,
- free text mungkin bukan domain MySQL B+Tree biasa,
- active queue tidak cocok dibaca dari stale replica.

---

## 8. Step 3 — Measure baseline

Tanpa baseline, tuning berubah menjadi tebak-tebakan.

Baseline harus mencakup beberapa layer.

### 8.1 Application metrics

Pantau:

- request throughput,
- request latency P50/P95/P99,
- error rate,
- timeout rate,
- retry count,
- queue depth,
- connection pool active/idle/pending,
- transaction duration,
- query count per request,
- external dependency latency.

Untuk Java/HikariCP, minimal:

- active connections,
- idle connections,
- pending threads,
- connection acquire time,
- connection usage time,
- connection timeout count.

Jika connection usage time tinggi, connection sedang lama dipakai. Bisa karena query lambat, transaksi lama, atau kode aplikasi menahan connection terlalu lama.

---

### 8.2 MySQL server metrics

Pantau:

- connections,
- running threads,
- queries per second,
- slow query count,
- rows examined,
- rows sent,
- temp table count,
- disk temp table count,
- sort merge passes,
- buffer pool hit/miss,
- dirty page percentage,
- redo log pressure,
- lock waits,
- deadlocks,
- replication lag,
- disk IOPS/latency,
- CPU usage.

---

### 8.3 Query-level metrics

Gunakan:

- slow query log,
- Performance Schema statement digest,
- `sys` schema views,
- `EXPLAIN`,
- `EXPLAIN ANALYZE`,
- query execution timing dari aplikasi,
- trace correlation.

Yang penting bukan hanya query paling lambat, tapi juga query paling mahal secara total.

Dua query:

```text
Query A: 5 detik, 10 kali sehari
Query B: 80 ms, 2 juta kali sehari
```

Query B mungkin lebih penting karena total cost-nya jauh lebih besar.

---

## 9. Step 4 — Identify bottleneck

Gunakan gejala untuk mempersempit.

### 9.1 Decision tree sederhana

```text
Latency naik.

Apakah app menunggu connection pool?
  Ya → connection-bound/app-bound/DB saturation.
  Tidak → lanjut.

Apakah MySQL CPU tinggi?
  Ya → query CPU-bound, scan/sort/join/function/JSON/high QPS.
  Tidak → lanjut.

Apakah disk latency/IOPS tinggi?
  Ya → I/O-bound, buffer miss, temp disk, redo/binlog/fsync.
  Tidak → lanjut.

Apakah banyak lock wait/deadlock?
  Ya → lock-bound/transaction design/index issue.
  Tidak → lanjut.

Apakah replica lag/freshness issue?
  Ya → replication-bound/write burst/large transaction/reporting.
  Tidak → lanjut.

Apakah query count per request tinggi?
  Ya → application-bound/N+1/chatty access.
  Tidak → cek network, GC, external dependency, deployment change.
```

---

### 9.2 Jangan hanya melihat satu metrik

Contoh kesalahan:

```text
CPU MySQL tinggi → tambah CPU.
```

Mungkin benar, tapi mungkin juga CPU tinggi karena:

- query scan tanpa index,
- terlalu banyak polling,
- ORM melakukan N+1,
- index salah sehingga rows examined tinggi,
- fungsi pada kolom memaksa evaluation banyak row.

Tambah CPU hanya menunda masalah.

---

## 10. Step 5 — Form hypothesis

Hypothesis harus spesifik dan bisa diuji.

Hypothesis buruk:

```text
Database lambat karena index kurang.
```

Hypothesis baik:

```text
Endpoint case search lambat karena query default filter tenant_id + status
+ updated_at order tidak memiliki composite index yang mendukung filtering
dan ordering. MySQL membaca 1.2 juta rows dan melakukan filesort.
Menambahkan index (tenant_id, status, updated_at desc, case_id desc)
akan menurunkan rows examined dan menghilangkan filesort untuk query default.
```

Hypothesis yang baik menyebut:

- workload,
- gejala,
- mekanisme penyebab,
- perubahan yang diusulkan,
- metrik yang diharapkan berubah.

---

## 11. Step 6 — Change one thing

Kalau mengubah banyak hal sekaligus, hasil sulit dipercaya.

Contoh perubahan buruk:

```text
Tambah 8 index, naikkan buffer pool, ubah pool size, rewrite query,
ubah isolation level, pindahkan read ke replica.
```

Jika latency membaik, kita tidak tahu mana yang membantu.
Jika correctness rusak, kita juga tidak tahu penyebabnya.

Lebih baik:

```text
Eksperimen 1: rewrite pagination dari OFFSET ke keyset.
Eksperimen 2: tambah composite index pendukung keyset.
Eksperimen 3: ubah endpoint agar hanya mengambil projection columns.
Eksperimen 4: optimasi query count dari 9 menjadi 3.
```

---

## 12. Step 7 — Re-measure

Setelah perubahan, ukur lagi dengan workload yang sama.

Bandingkan:

- P50/P95/P99 latency,
- throughput,
- CPU,
- I/O,
- rows examined,
- rows sent,
- temp table disk,
- lock wait,
- deadlock,
- replication lag,
- error rate,
- connection pool pressure.

Jangan puas hanya karena satu query cepat di laptop.

---

## 13. Step 8 — Validate correctness

Optimisasi bisa merusak correctness.

Contoh:

| Optimisasi | Risiko correctness |
|---|---|
| Read dari replica | stale read |
| Cache result | data lama tampil |
| Denormalisasi | data drift |
| Lower isolation | anomaly |
| Skip locked queue | item bisa tidak terlihat sementara |
| Approximate count | angka tidak legal untuk laporan resmi |
| Async write | user melihat sukses sebelum durable |
| Batch retry | duplicate effect tanpa idempotency |

Dalam sistem regulatory/case management, correctness sering lebih penting daripada latency.

Misalnya:

```text
Tidak boleh ada enforcement action yang diterbitkan berdasarkan state stale.
```

Jika begitu, query tertentu harus ke primary atau harus punya version guard, meskipun read replica lebih cepat.

---

## 14. Step 9 — Validate under concurrency

Banyak query terlihat baik sendirian tapi buruk saat concurrency.

Contoh:

```sql
UPDATE case_counter
SET next_sequence = next_sequence + 1
WHERE tenant_id = ?;
```

Sendirian sangat cepat.

Di concurrency tinggi, row ini menjadi hot row.

Contoh lain:

```sql
SELECT id
FROM task
WHERE status = 'READY'
ORDER BY priority DESC, created_at ASC
LIMIT 100
FOR UPDATE;
```

Jika banyak worker menjalankan ini bersamaan tanpa desain queue yang benar, mereka bisa saling menunggu row lock.

Performance test harus menguji:

- concurrent readers,
- concurrent writers,
- mixed read/write,
- background jobs,
- migration/backfill bersamaan,
- replica lag impact,
- cold start,
- failover/reconnect scenario bila relevan.

---

## 15. Step 10 — Prevent regression

Performance improvement yang tidak dijaga akan hilang.

Regression guard bisa berupa:

- query performance tests,
- load test scenario reguler,
- slow query budget,
- index review pada schema migration,
- dashboard statement digest,
- alert rows examined spike,
- code review checklist untuk repository query,
- migration review checklist,
- ORM SQL snapshot test untuk query kritikal,
- production query digest comparison sebelum/sesudah release.

Performance harus menjadi bagian dari engineering lifecycle, bukan ritual setelah incident.

---

## 16. Latency math untuk Java engineer

### 16.1 Serial query amplification

Jika satu request menjalankan query serial:

```text
Q1: 20 ms
Q2: 30 ms
Q3: 40 ms
Q4: 50 ms
```

Maka minimal DB time:

```text
140 ms
```

Belum termasuk:

- network round-trip,
- app processing,
- serialization,
- lock wait,
- pool acquire,
- GC,
- downstream call.

Jika query count naik menjadi 20 query, meskipun masing-masing “cepat”, endpoint bisa lambat.

---

### 16.2 Tail latency multiplication

Jika endpoint melakukan 10 operasi serial, masing-masing punya peluang 1% lambat, peluang minimal satu operasi lambat menjadi jauh lebih besar.

Secara kasar:

```text
P(no slow op) = 0.99^10 ≈ 0.904
P(at least one slow op) ≈ 9.6%
```

Artinya P99 komponen bisa menjadi P90 endpoint.

Ini sebabnya mengurangi jumlah round-trip sering lebih penting daripada mengoptimasi satu query kecil.

---

## 17. Throughput, concurrency, dan Little's Law

Little's Law:

```text
Concurrency = Throughput × Latency
```

Jika endpoint melayani:

```text
Throughput = 200 requests/second
Average DB connection hold time = 100 ms = 0.1 s
```

Maka rata-rata connection yang dibutuhkan:

```text
200 × 0.1 = 20 active connections
```

Jika hold time naik menjadi 500 ms:

```text
200 × 0.5 = 100 active connections
```

Tanpa traffic naik pun, connection pressure bisa naik 5x hanya karena latency naik.

Implikasi:

- slow query menyebabkan pool exhaustion,
- pool exhaustion menyebabkan request menunggu,
- request menunggu bisa membuat thread pile-up,
- thread pile-up bisa memperburuk JVM dan upstream timeout.

---

## 18. Connection pool sizing: bukan makin besar makin baik

Connection pool harus disesuaikan dengan:

- DB capacity,
- query latency,
- transaction duration,
- CPU core,
- I/O capacity,
- jumlah aplikasi instance,
- workload mix.

Misalnya:

```text
20 service instances
Hikari maximumPoolSize = 50
```

Total potensi connection:

```text
20 × 50 = 1000 connections
```

Jika MySQL tidak dirancang untuk 1000 concurrent active sessions, ini bisa menciptakan overload.

Lebih banyak connection bisa menyebabkan:

- context switching,
- memory pressure,
- lock contention,
- lebih banyak query aktif,
- latency naik,
- tail latency memburuk.

Prinsip:

```text
Pool size harus cukup untuk menjaga throughput yang sehat,
tetapi cukup kecil untuk memberikan backpressure sebelum DB runtuh.
```

---

## 19. Query performance methodology

Untuk query kritikal, gunakan langkah ini:

```text
1. Ambil query nyata dari production.
2. Ambil parameter nyata atau distribusi parameter realistis.
3. Ukur latency dan rows examined.
4. EXPLAIN query.
5. EXPLAIN ANALYZE bila aman di environment test.
6. Periksa index yang dipakai.
7. Periksa estimated rows vs actual rows.
8. Periksa temporary table / filesort.
9. Periksa result size.
10. Rewrite/index/change schema bila perlu.
11. Test dengan data size realistis.
12. Test dengan concurrency.
```

---

### 19.1 Jangan benchmark dengan data kecil

Query yang cepat pada 10 ribu row bisa buruk pada 100 juta row.

Data kecil menyembunyikan:

- scan cost,
- sort cost,
- index selectivity problem,
- buffer pool miss,
- temp table disk,
- skewed distribution,
- partition pruning issue,
- lock contention.

Benchmark harus memakai:

- volume realistis,
- distribusi realistis,
- cardinality realistis,
- skew realistis,
- data lama dan data baru,
- tenant besar dan tenant kecil.

---

### 19.2 Parameter matters

Query yang sama dengan parameter berbeda bisa punya perilaku berbeda.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
ORDER BY updated_at DESC
LIMIT 50;
```

Untuk tenant kecil:

```text
Rows matched: 200
```

Untuk tenant besar:

```text
Rows matched: 10,000,000
```

Plan yang cocok untuk tenant kecil belum tentu cocok untuk tenant besar.

Dalam multi-tenant system, benchmark harus menyertakan:

- tenant median,
- tenant besar,
- tenant sangat besar,
- tenant dengan data skewed,
- tenant dengan banyak active case.

---

## 20. Schema performance methodology

Schema adalah performance design yang paling fundamental.

Periksa:

- primary key shape,
- row width,
- nullable columns,
- large text/json/blob placement,
- normalization/denormalization boundary,
- foreign key usage,
- index count,
- composite index overlap,
- generated columns,
- partitioning requirement,
- archival path,
- audit table growth.

---

### 20.1 Row width matters

Row lebar berarti:

- lebih sedikit row per page,
- lebih banyak page dibaca,
- buffer pool lebih cepat penuh,
- secondary lookup bisa lebih mahal,
- network payload lebih besar,
- `SELECT *` lebih berbahaya.

Untuk query list page, jangan ambil semua kolom.

Buruk:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = ?
ORDER BY updated_at DESC
LIMIT 50;
```

Lebih baik:

```sql
SELECT case_id,
       case_number,
       status,
       priority,
       assigned_team_id,
       updated_at
FROM enforcement_case
WHERE tenant_id = ?
ORDER BY updated_at DESC
LIMIT 50;
```

Projection adalah performance tool.

---

### 20.2 Index count matters

Setiap secondary index harus di-update saat write.

Jika tabel punya 12 secondary indexes, maka insert/update/delete membayar lebih banyak:

- CPU,
- redo log,
- undo/logical change,
- page split,
- buffer dirtying,
- storage,
- replication apply cost.

Index bukan hanya mempercepat read. Index juga memperberat write.

Pertanyaan review index:

```text
Query apa yang dilayani index ini?
Berapa frekuensi query itu?
Apakah index ini overlap dengan index lain?
Apakah masih dipakai setelah perubahan fitur?
Apakah manfaat read-nya lebih besar dari biaya write-nya?
```

---

## 21. Workload pattern: OLTP vs reporting

MySQL production OLTP sering rusak karena reporting query.

OLTP query biasanya:

- pendek,
- selektif,
- banyak concurrency,
- menyentuh sedikit row,
- perlu latency rendah,
- sering read/write mixed.

Reporting query biasanya:

- scan besar,
- aggregation besar,
- sort besar,
- temporary table besar,
- latency bisa lebih panjang,
- resource intensive.

Mencampur keduanya di primary yang sama berbahaya.

Solusi:

- reporting replica,
- materialized summary table,
- ETL/ELT ke warehouse,
- precomputed dashboard,
- event-driven projection,
- time-windowed aggregation,
- query budget.

---

## 22. Performance anti-patterns umum di Java + MySQL

### 22.1 N+1 query

Contoh:

```text
Load 50 cases.
For each case, load latest action.
For each case, load assigned officer.
For each case, load attachments count.
```

Total:

```text
1 + 50 + 50 + 50 = 151 queries
```

Solusi:

- batch query,
- join/projection,
- precomputed summary,
- `IN (...)` batch dengan ukuran wajar,
- data loader pattern,
- dedicated read model.

---

### 22.2 `SELECT *` di API list

Masalah:

- mengambil kolom yang tidak dibutuhkan,
- mematikan covering index opportunity,
- menaikkan network payload,
- menyentuh off-page data,
- membuat perubahan schema berdampak ke payload cost.

Gunakan projection eksplisit.

---

### 22.3 Offset pagination dalam large table

Buruk:

```sql
SELECT case_id, status, updated_at
FROM enforcement_case
WHERE tenant_id = ?
ORDER BY updated_at DESC
LIMIT 50 OFFSET 500000;
```

Database tetap harus berjalan melewati banyak row sebelum mengembalikan page.

Lebih baik:

```sql
SELECT case_id, status, updated_at
FROM enforcement_case
WHERE tenant_id = ?
  AND (updated_at, case_id) < (?, ?)
ORDER BY updated_at DESC, case_id DESC
LIMIT 50;
```

Keyset pagination lebih stabil untuk deep navigation.

---

### 22.4 Transaksi terlalu luas

Buruk:

```java
@Transactional
public void approveCase(ApproveCommand cmd) {
    Case c = caseRepo.lockById(cmd.caseId());
    policyClient.validate(c);       // external HTTP call
    documentClient.generate(c);     // external HTTP call
    c.approve();
    caseRepo.save(c);
}
```

Masalah:

- connection ditahan lama,
- lock ditahan lama,
- external latency masuk transaction duration,
- deadlock/timeout risk naik.

Lebih baik:

- validasi eksternal sebelum lock bila aman,
- transaction hanya untuk state transition atomik,
- gunakan outbox untuk side effect,
- gunakan version guard.

---

### 22.5 Batch terlalu besar

Batch besar bisa menaikkan throughput, tetapi:

- lock lebih lama,
- undo/redo lebih besar,
- replication lag naik,
- rollback mahal,
- transaction uncertainty naik.

Lebih baik batch terukur:

```text
Process 500-2000 rows per transaction depending on row size, index cost,
lock footprint, and replication behavior.
```

Tidak ada angka universal. Harus diukur.

---

### 22.6 Polling dashboard

Dashboard yang refresh tiap beberapa detik bisa membanjiri DB.

Contoh:

```text
500 users × 10 widgets × refresh every 5 seconds
= 1000 widget queries/second
```

Solusi:

- server-side aggregation,
- cache short TTL,
- materialized summary,
- event-driven counters,
- rate limit,
- push update bila perlu.

---

## 23. Benchmarking: cara yang benar

### 23.1 Benchmark harus menjawab pertanyaan spesifik

Benchmark buruk:

```text
Berapa TPS MySQL?
```

Terlalu umum.

Benchmark baik:

```text
Berapa P95/P99 latency submit enforcement action saat 100 RPS,
20 concurrent reviewer, 5 background worker, 30 juta audit rows,
dan replication enabled dengan durability production?
```

---

### 23.2 Komponen benchmark realistis

Benchmark yang baik memiliki:

- schema production-like,
- index production-like,
- data volume realistis,
- data distribution realistis,
- query mix realistis,
- concurrency realistis,
- connection pool config realistis,
- MySQL config production-like,
- hardware/storage mirip production,
- replication/binlog sesuai production,
- warmup phase,
- measurement phase,
- correctness validation.

---

### 23.3 Warm cache vs cold cache

Warm cache:

```text
Data/index sudah banyak ada di buffer pool.
```

Cold cache:

```text
Data/index harus dibaca dari storage.
```

Keduanya penting.

Warm cache menunjukkan steady state.
Cold cache menunjukkan restart/failover/working-set-shift behavior.

Jika benchmark hanya warm cache, sistem bisa terlihat terlalu baik.

---

### 23.4 Jangan benchmark tanpa binlog jika production pakai binlog

Jika production memakai binary log untuk replication/PITR, benchmark tanpa binlog tidak merepresentasikan write path production.

Write latency bisa dipengaruhi oleh:

- redo log,
- binary log,
- fsync,
- group commit,
- storage latency,
- transaction size,
- durability settings.

Benchmark harus memakai durability mode yang sesuai dengan risk appetite production.

---

## 24. EXPLAIN bukan akhir diagnosis

`EXPLAIN` penting, tapi tidak cukup.

`EXPLAIN` memberi estimasi plan.

Yang perlu dicek:

- access type,
- possible keys,
- chosen key,
- key length,
- estimated rows,
- filtered percentage,
- Extra:
  - Using where,
  - Using index,
  - Using temporary,
  - Using filesort,
  - Using index condition.

Tetapi estimasi bisa salah.

Karena itu gunakan juga:

- `EXPLAIN ANALYZE` di environment aman,
- actual timing,
- actual rows examined,
- statement digest,
- slow query log,
- production parameter samples.

---

## 25. Performance tuning urutan prioritas

Urutan praktis:

```text
1. Kurangi kerja yang tidak perlu.
2. Pastikan query shape benar.
3. Pastikan index sesuai workload.
4. Pastikan transaction boundary pendek.
5. Pastikan connection pool memberi backpressure sehat.
6. Pastikan schema tidak melawan access pattern.
7. Pisahkan OLTP dan reporting bila perlu.
8. Baru tuning konfigurasi server.
9. Baru upgrade hardware/storage.
10. Baru pertimbangkan arsitektur lebih besar.
```

Kenapa konfigurasi bukan nomor 1?

Karena konfigurasi tidak bisa menyelamatkan query yang membaca 20 juta row untuk menampilkan 50 item.

---

## 26. Query rewrite contoh: case queue

### 26.1 Masalah awal

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = ?
  AND status IN ('OPEN', 'UNDER_REVIEW')
  AND deleted_at IS NULL
ORDER BY priority DESC, updated_at ASC
LIMIT 50 OFFSET 0;
```

Masalah potensial:

- `SELECT *`,
- sort mungkin tidak didukung index,
- status IN dengan sort perlu index tepat,
- row lebar,
- deleted_at soft delete perlu dipikirkan,
- jika pagination pakai offset lebih dalam, makin mahal.

---

### 26.2 Index yang mungkin

```sql
CREATE INDEX idx_case_queue
ON enforcement_case (
  tenant_id,
  status,
  deleted_at,
  priority DESC,
  updated_at ASC,
  case_id ASC
);
```

Tapi ini belum tentu ideal karena `status IN (...)` bisa memengaruhi ordering global antar status.

Alternatif desain:

- pisahkan queue table untuk active work,
- gunakan derived priority bucket,
- materialized assignment queue,
- keyset pagination dengan cursor,
- query per status lalu merge di aplikasi bila batas kecil dan correctness jelas.

---

### 26.3 Projection

```sql
SELECT case_id,
       case_number,
       status,
       priority,
       assigned_team_id,
       updated_at
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
  AND deleted_at IS NULL
ORDER BY priority DESC, updated_at ASC, case_id ASC
LIMIT 50;
```

Dengan index:

```sql
CREATE INDEX idx_case_queue_status
ON enforcement_case (
  tenant_id,
  status,
  deleted_at,
  priority DESC,
  updated_at ASC,
  case_id ASC
);
```

Ini bisa menjadi covering index jika semua selected columns ada di index. Namun menambah terlalu banyak kolom ke index juga menambah ukuran index.

Trade-off harus diukur.

---

## 27. Write performance methodology

Untuk write-heavy workload, ukur:

- rows per transaction,
- indexes updated per row,
- redo generation,
- binlog size,
- fsync latency,
- lock wait,
- deadlocks,
- replication lag,
- batch size effect,
- retry rate,
- row size.

---

### 27.1 Insert performance

Insert dipengaruhi oleh:

- primary key order,
- secondary index count,
- unique constraint checks,
- foreign key checks,
- row size,
- transaction batch size,
- redo/binlog durability,
- concurrent insert pattern.

AUTO_INCREMENT primary key biasanya append-friendly.
Random UUID primary key bisa menyebabkan page split dan random write lebih banyak.

Jika butuh UUID, pertimbangkan:

- UUID binary storage,
- time-ordered UUID/ULID/Snowflake-like ID,
- pemisahan public id dan clustered primary key.

---

### 27.2 Update performance

Update mahal bila:

- mengubah indexed column,
- menyentuh banyak secondary index,
- menyebabkan row relocation/off-page changes,
- memegang lock lama,
- melakukan range update besar,
- berjalan tanpa index tepat.

Buruk:

```sql
UPDATE enforcement_case
SET status = 'EXPIRED'
WHERE due_at < NOW()
  AND status = 'OPEN';
```

Jika jutaan row, ini bisa:

- lock banyak row,
- generate redo/undo besar,
- menyebabkan replication lag,
- mengganggu OLTP.

Lebih aman:

```sql
UPDATE enforcement_case
SET status = 'EXPIRED'
WHERE status = 'OPEN'
  AND due_at < ?
ORDER BY due_at, case_id
LIMIT 1000;
```

Diulang dalam batch dengan sleep/backpressure dan monitoring lag.

---

### 27.3 Delete performance

Large delete berbahaya karena:

- lock banyak row,
- undo besar,
- purge tertahan,
- replication lag,
- index maintenance,
- page fragmentation.

Retention delete harus dirancang, bukan dilakukan spontan.

Alternatif:

- partition drop untuk time-based data,
- archive then delete batch,
- soft delete dengan later purge,
- move cold data ke archive store,
- legal hold exclusion.

---

## 28. Performance untuk regulatory/case-management system

Sistem regulatory biasanya punya pola khusus:

1. State transition harus benar.
2. Audit trail tumbuh besar.
3. Search/filter kompleks.
4. Dashboard dan SLA queue sering dipakai.
5. Reporting membutuhkan data historis.
6. Retention dan legal hold membatasi deletion.
7. Consistency lebih penting dari sekadar speed.

---

### 28.1 State transition performance

State transition harus pendek dan guarded.

Contoh:

```sql
UPDATE enforcement_case
SET status = 'APPROVED',
    version = version + 1,
    approved_at = NOW(6)
WHERE case_id = ?
  AND status = 'UNDER_REVIEW'
  AND version = ?;
```

Keuntungan:

- atomic guard,
- optimistic concurrency,
- tidak perlu lock panjang sebelum validasi,
- retry/feedback jelas.

Jika affected rows = 0, berarti state/version sudah berubah.

---

### 28.2 Audit trail performance

Audit table biasanya append-heavy.

Desain:

```sql
CREATE TABLE case_audit_event (
  audit_event_id BIGINT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  case_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  actor_id BIGINT NULL,
  payload JSON NOT NULL,
  KEY idx_case_audit_case_time (case_id, occurred_at, audit_event_id),
  KEY idx_case_audit_tenant_time (tenant_id, occurred_at, audit_event_id)
);
```

Pertanyaan performance:

- Apakah audit sering dibaca per case?
- Apakah audit sering dicari lintas tenant/time?
- Apakah payload JSON perlu di-query?
- Apakah audit perlu partitioning per waktu?
- Apakah retention berbeda untuk audit?

---

### 28.3 SLA queue performance

Jangan hitung semuanya setiap request.

Buruk:

```sql
SELECT COUNT(*)
FROM enforcement_case
WHERE tenant_id = ?
  AND status IN (...)
  AND due_at < NOW();
```

Jika dashboard memanggil ini terus, DB terbebani.

Alternatif:

- precomputed SLA buckets,
- event-driven update,
- periodic materialization,
- indexed active obligation table,
- approximate count untuk UI non-legal,
- exact count hanya untuk report resmi.

---

## 29. Capacity planning

Capacity planning menjawab:

```text
Kapan sistem akan kehabisan ruang, I/O, CPU, memory, connection, atau replication capacity?
```

Pantau growth:

- table size,
- index size,
- rows per table,
- audit/event growth,
- binlog volume per day,
- backup duration,
- restore duration,
- replication lag trend,
- buffer pool working set,
- peak QPS,
- peak active connections,
- slow query trend.

---

### 29.1 Data growth projection

Contoh:

```text
New cases per month: 5 million
Audit events per case average: 20
Audit events per month: 100 million
Average audit row including indexes: 1.5 KB
Monthly audit storage growth: ~150 GB
```

Dalam 12 bulan:

```text
~1.8 TB audit-related growth
```

Jika backup/restore strategy tidak mengikuti pertumbuhan ini, DR akan gagal walaupun database masih berjalan.

---

### 29.2 Capacity bukan hanya storage

Large table memengaruhi:

- backup time,
- restore time,
- schema migration time,
- index creation time,
- query planning/statistics,
- purge behavior,
- replication catch-up,
- failover recovery time,
- incident blast radius.

---

## 30. Performance review checklist

Gunakan checklist ini saat review fitur baru.

### 30.1 Workload checklist

- [ ] Berapa QPS/RPS expected?
- [ ] Berapa peak concurrency?
- [ ] Berapa data volume sekarang dan 12 bulan lagi?
- [ ] Query top apa saja?
- [ ] Read/write ratio?
- [ ] Ada background job?
- [ ] Ada export/reporting?
- [ ] Freshness requirement?
- [ ] Bisa baca dari replica atau harus primary?

### 30.2 Query checklist

- [ ] Predicate memakai index?
- [ ] Sort memakai index atau filesort?
- [ ] Ada temporary table?
- [ ] Rows examined masuk akal?
- [ ] Result set dibatasi?
- [ ] Tidak memakai `SELECT *` untuk list?
- [ ] Pagination stabil?
- [ ] Query count per request masuk akal?
- [ ] Parameter besar/skewed sudah diuji?

### 30.3 Transaction checklist

- [ ] Transaction boundary pendek?
- [ ] Tidak ada external call dalam transaksi?
- [ ] Locking read benar-benar perlu?
- [ ] Retry aman dan idempotent?
- [ ] Update order deterministik?
- [ ] Batch size terukur?

### 30.4 Index checklist

- [ ] Index melayani query konkret?
- [ ] Composite order sesuai equality/range/order?
- [ ] Tidak overlap tidak perlu?
- [ ] Write cost dapat diterima?
- [ ] Index size dipertimbangkan?
- [ ] Ada rencana remove index obsolete?

### 30.5 Operational checklist

- [ ] Slow query observable?
- [ ] Dashboard tersedia?
- [ ] Alert ada untuk latency/lock/lag/connection?
- [ ] Load test realistis?
- [ ] Backup/restore tidak terdampak buruk?
- [ ] Migration aman untuk data size ini?

---

## 31. Anti-folklore: tuning myths

### Myth 1 — “Tambah index pasti mempercepat”

Tidak selalu.

Index bisa:

- tidak dipakai optimizer,
- membuat write lambat,
- memperbesar storage,
- menurunkan cache efficiency,
- overlap dengan index lain,
- membuat plan berubah buruk.

---

### Myth 2 — “Connection pool besar berarti throughput besar”

Tidak selalu.

Jika DB bottleneck, pool besar hanya memperbesar antrian di DB.

Backpressure lebih sehat daripada membanjiri database.

---

### Myth 3 — “Query P50 cepat berarti aman”

Tidak.

Tail latency, lock wait, dan parameter skew bisa membunuh P99.

---

### Myth 4 — “Read replica menyelesaikan semua masalah read scaling”

Tidak.

Replica membawa:

- stale read,
- lag,
- routing complexity,
- failover complexity,
- reporting isolation problem.

---

### Myth 5 — “Partitioning mempercepat query otomatis”

Tidak.

Partitioning membantu jika query dapat melakukan partition pruning atau jika objective-nya retention/drop partition. Jika query tetap menyentuh banyak partition, benefit bisa kecil atau negatif.

---

### Myth 6 — “Hardware upgrade lebih mudah daripada desain ulang query”

Kadang benar untuk jangka pendek, tetapi buruk jika akar masalah adalah access pattern.

Hardware upgrade sering hanya membeli waktu.

---

## 32. Practical performance playbook

### 32.1 Jika endpoint lambat

Langkah:

1. Cek request latency breakdown.
2. Cek connection acquire time.
3. Cek jumlah query per request.
4. Cek query paling mahal.
5. Cek slow query log / statement digest.
6. Cek `EXPLAIN` dan rows examined.
7. Cek lock wait.
8. Cek result size dan serialization.
9. Cek downstream call.
10. Buat hypothesis dan ubah satu hal.

---

### 32.2 Jika MySQL CPU tinggi

Langkah:

1. Ambil top statement digest.
2. Lihat rows examined total.
3. Lihat queries dengan high frequency.
4. Lihat queries dengan temp/filesort.
5. Lihat execution plan.
6. Cek recent release/change.
7. Cek dashboard/polling/job.
8. Kurangi workload atau optimize query.

---

### 32.3 Jika pool exhausted

Langkah:

1. Cek active/idle/pending.
2. Cek connection usage time.
3. Cek slow query.
4. Cek transaction duration.
5. Cek leak detection.
6. Cek thread dump bila perlu.
7. Jangan langsung naikkan pool.
8. Pastikan timeout hierarchy benar.

---

### 32.4 Jika replication lag

Langkah:

1. Cek write burst.
2. Cek large transaction.
3. Cek DDL/backfill.
4. Cek replica resource.
5. Cek long query di replica.
6. Cek binlog volume.
7. Throttle batch/job.
8. Route critical reads ke primary.

---

## 33. Performance engineering maturity model

### Level 1 — Reactive

Ciri:

- tuning setelah incident,
- tidak ada baseline,
- slow query log tidak dipakai,
- index ditambah manual tanpa review,
- pool dinaikkan saat timeout.

### Level 2 — Measured

Ciri:

- ada dashboard dasar,
- slow query log dipantau,
- query critical pakai EXPLAIN,
- pool metrics tersedia,
- incident bisa didiagnosis.

### Level 3 — Systematic

Ciri:

- workload model ada,
- load test realistis,
- index review rutin,
- migration performance diperiksa,
- query regression dicegah,
- p95/p99 dipantau.

### Level 4 — Predictive

Ciri:

- capacity planning berbasis growth,
- performance budget per feature,
- production digest dibandingkan antar release,
- schema evolution memperhitungkan 12-24 bulan,
- DR/restore time masuk capacity planning.

### Level 5 — Architecture-aware

Ciri:

- sistem membedakan OLTP/reporting/search/archive,
- consistency boundary eksplisit,
- read model dirancang,
- workload isolation jelas,
- MySQL digunakan untuk hal yang cocok,
- keluar ke sistem lain saat trade-off menuntut.

Target seri ini adalah membawa pembaca minimal ke Level 4, dan untuk sistem kompleks mendekati Level 5.

---

## 34. Latihan praktis

### Latihan 1 — Workload inventory

Ambil satu service Java yang memakai MySQL.

Buat tabel:

| Endpoint/job | Query count | Tables touched | Read/write | P95 | P99 | Rows examined | Notes |
|---|---:|---|---|---:|---:|---:|---|

Tujuan:

- tahu workload nyata,
- bukan asumsi.

---

### Latihan 2 — Top query digest review

Ambil top 10 query berdasarkan:

- total time,
- count,
- avg latency,
- rows examined,
- tmp disk table,
- errors.

Untuk tiap query, jawab:

```text
Query ini penting secara bisnis?
Query ini sering atau hanya mahal sekali-sekali?
Apakah rows examined masuk akal?
Apakah index mendukung query shape?
Apakah result size masuk akal?
Apakah query ini berasal dari endpoint, job, atau report?
```

---

### Latihan 3 — Transaction duration audit

Cari transaksi yang lama.

Untuk tiap transaksi, jawab:

```text
Apa yang dilakukan dalam transaksi?
Apakah ada external call?
Apakah ada loop query?
Apakah ada locking read?
Apakah ada batch terlalu besar?
Apakah connection ditahan lebih lama dari perlu?
```

---

### Latihan 4 — Pagination redesign

Ambil satu endpoint list yang memakai OFFSET.

Desain ulang menjadi keyset pagination:

- tentukan stable order,
- tentukan cursor columns,
- tentukan composite index,
- tentukan response cursor,
- tentukan behavior untuk duplicate timestamp,
- test page consistency.

---

### Latihan 5 — Capacity projection

Pilih tabel terbesar.

Hitung:

```text
Rows sekarang
Rows growth per bulan
Average row size
Index size
Backup size
Restore time
Projected 12 bulan
Projected 24 bulan
```

Tentukan apakah retention/archive perlu dirancang sekarang.

---

## 35. Ringkasan mental model

Performance engineering MySQL untuk Java engineer dapat diringkas seperti ini:

```text
Performance = workload × data shape × query shape × index design
              × transaction behavior × concurrency
              × memory/I/O/logging × application access pattern
              × operational constraints.
```

Jangan mulai dari tuning parameter.

Mulai dari:

1. workload,
2. objective,
3. measurement,
4. bottleneck,
5. hypothesis,
6. controlled change,
7. validation,
8. regression guard.

Top engineer tidak hanya bisa membuat satu query cepat. Top engineer bisa menjelaskan:

- kenapa query lambat,
- kapan index membantu atau merusak,
- bagaimana transaksi memengaruhi concurrency,
- bagaimana connection pool berinteraksi dengan DB capacity,
- bagaimana replication dan backup terkena dampak write pattern,
- bagaimana desain schema hari ini memengaruhi operability tahun depan.

Itulah beda antara “bisa pakai MySQL” dan “bisa mengoperasikan MySQL sebagai bagian dari sistem produksi yang serius”.

---

## 36. Checklist pemahaman

Setelah menyelesaikan bagian ini, kamu harus bisa menjawab:

- Apa beda performance tuning dan performance engineering?
- Kenapa average latency tidak cukup?
- Bagaimana P99 endpoint bisa buruk meski query individual terlihat cepat?
- Bagaimana Little's Law membantu sizing connection pool?
- Apa saja bottleneck utama MySQL-backed Java system?
- Kenapa benchmark dengan data kecil menipu?
- Kenapa read replica bukan solusi universal untuk read scaling?
- Kenapa partitioning bukan index ajaib?
- Bagaimana membuat hypothesis performance yang bisa diuji?
- Bagaimana mencegah performance regression setelah release?

---

## 37. Koneksi ke part berikutnya

Part ini memberi metodologi umum.

Part berikutnya adalah penutup besar seri:

```text
learn-mysql-mastery-for-java-engineers-part-034.md
Production Readiness Checklist and Capstone Architecture
```

Di part terakhir, seluruh konsep akan digabungkan menjadi checklist produksi dan rancangan capstone untuk platform regulatory enforcement/case management:

- schema,
- index,
- transaction,
- state transition,
- audit trail,
- SLA queue,
- migration,
- backup,
- HA,
- security,
- observability,
- operational runbook.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — MySQL in Distributed Systems and Microservices</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-034.md">Part 034 — Production Readiness Checklist and Capstone Architecture ➡️</a>
</div>

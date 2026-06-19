# learn-postgresql-mastery-for-java-engineers-part-033.md

# Part 033 — Performance Engineering Methodology: Benchmark, Diagnose, Tune, Verify

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu melakukan performance engineering PostgreSQL secara sistematis, bukan sekadar mencoba-coba parameter.  
> Status seri: Part 033 dari 034. Seri belum selesai.

---

## 0. Tujuan Bagian Ini

Pada bagian-bagian sebelumnya, kita sudah membahas banyak mekanisme PostgreSQL:

- process architecture,
- connection lifecycle,
- storage model,
- MVCC,
- transaction isolation,
- WAL,
- buffer manager,
- query lifecycle,
- planner statistics,
- `EXPLAIN`,
- index internals,
- locking,
- constraints,
- JSONB,
- partitioning,
- vacuum,
- read/write path,
- replication,
- HA,
- security,
- migration,
- Java integration,
- workload-specific design.

Bagian ini menyatukan semuanya ke dalam satu kemampuan yang membedakan engineer biasa dan engineer senior/top-tier:

> kemampuan melakukan performance engineering PostgreSQL secara metodologis.

Bukan:

```text
query lambat → tambah index
CPU tinggi → naikkan instance
latency tinggi → naikkan pool
memory tinggi → naikkan memory
vacuum lambat → matikan autovacuum
```

Tetapi:

```text
gejala → bukti → hipotesis → eksperimen terkontrol → perubahan minimal → verifikasi → rollback plan → dokumentasi
```

Performance engineering bukan kegiatan mistik. Ia adalah disiplin investigasi.

---

## 1. Performance Engineering Bukan Tuning Parameter

Kesalahan umum adalah menganggap performa PostgreSQL terutama ditentukan oleh parameter seperti:

- `shared_buffers`,
- `work_mem`,
- `max_connections`,
- `effective_cache_size`,
- `checkpoint_timeout`,
- `random_page_cost`,
- `autovacuum_*`,
- `wal_buffers`,
- `maintenance_work_mem`.

Parameter memang penting, tetapi parameter biasanya bukan akar masalah pertama.

Dalam sistem produksi, masalah performa lebih sering berasal dari:

1. query shape buruk,
2. missing atau wrong index,
3. planner statistics keliru,
4. connection pool terlalu besar,
5. transaction terlalu panjang,
6. lock contention,
7. bloat,
8. write amplification,
9. ORM menghasilkan query tidak terkendali,
10. workload berubah,
11. data distribution berubah,
12. schema migration menambah blocking,
13. replica lag,
14. cache invalidation salah,
15. storage I/O saturated,
16. CPU habis untuk sort/hash/join,
17. autovacuum tidak mengejar churn,
18. reporting query berjalan di primary OLTP.

Parameter tuning tanpa diagnosis seperti mengganti obat tanpa tahu penyakit.

---

## 2. Mental Model Performance PostgreSQL

PostgreSQL performance dapat dipetakan menjadi beberapa resource dan boundary:

```text
Application
  ↓
Connection pool
  ↓
PostgreSQL backend process
  ↓
Parser / planner / executor
  ↓
Locks / MVCC / snapshots
  ↓
Buffer manager
  ↓
WAL
  ↓
OS cache / filesystem
  ↓
Disk / network / CPU / memory
```

Setiap query yang lambat pasti tersangkut di salah satu atau beberapa area:

```text
waiting for connection
waiting for lock
planning too long
executing too many rows
bad join strategy
sorting/hashing too much
spilling to disk
reading too much from disk
writing too much WAL
blocked by vacuum/checkpoint/I/O
waiting on replica/failover/network
```

Top-tier engineer tidak bertanya:

```text
Postgres-nya lambat kenapa?
```

Ia bertanya:

```text
Resource/boundary mana yang sedang saturated atau salah digunakan?
```

---

## 3. Pertanyaan Pertama Saat Ada Masalah Performa

Sebelum membuka konfigurasi PostgreSQL, jawab pertanyaan berikut.

### 3.1 Masalahnya latency, throughput, atau availability?

Contoh berbeda:

```text
P95 API naik dari 200 ms ke 2 detik.
```

Ini latency problem.

```text
Sistem biasanya memproses 2.000 request/detik, sekarang hanya 600 request/detik.
```

Ini throughput problem.

```text
Request gagal karena connection timeout.
```

Ini availability/capacity problem.

```text
Query write berhasil tetapi replica terlambat 5 menit.
```

Ini replication freshness problem.

Jangan mencampur semuanya sebagai “database lambat”.

---

### 3.2 Masalah terjadi di read, write, transaction, atau background maintenance?

Klasifikasi awal:

```text
Read path:
- SELECT lambat
- pagination lambat
- report lambat
- search lambat
- replica stale

Write path:
- INSERT lambat
- UPDATE lambat
- UPSERT deadlock
- DELETE menyebabkan bloat
- batch import lambat

Transaction path:
- lock wait
- deadlock
- serialization failure
- idle in transaction
- long transaction

Maintenance path:
- autovacuum tertinggal
- checkpoint spike
- WAL archive gagal
- replication slot menahan WAL
- backup memperberat I/O
```

Diagnosis akan berbeda total untuk masing-masing.

---

### 3.3 Masalah global atau lokal?

Global:

```text
semua query melambat
semua endpoint melambat
CPU/database saturated
I/O tinggi
connection pool penuh
```

Lokal:

```text
satu endpoint lambat
satu tenant lambat
satu query fingerprint lambat
satu table bloat
satu migration blocking
```

Global problem sering resource/capacity/configuration.  
Lokal problem sering query/index/statistics/data distribution.

---

### 3.4 Masalah baru muncul setelah apa?

Cari trigger:

- deployment aplikasi,
- migration schema,
- traffic spike,
- batch job baru,
- data growth,
- tenant baru,
- query pattern baru,
- index drop/create,
- autovacuum setting berubah,
- upgrade PostgreSQL,
- failover,
- cache flush,
- reporting dashboard baru,
- background worker baru,
- feature flag aktif.

Performance regression hampir selalu punya sebab perubahan.

---

## 4. Golden Signals untuk PostgreSQL

Untuk service backend, golden signals umumnya:

- latency,
- traffic,
- errors,
- saturation.

Untuk PostgreSQL, kita bisa turunkan menjadi:

```text
Latency:
- query duration
- transaction duration
- lock wait duration
- commit latency
- replication replay delay

Traffic:
- query rate
- transaction rate
- rows read/written
- WAL generated
- connections active

Errors:
- deadlocks
- serialization failures
- lock timeout
- statement timeout
- connection timeout
- disk full
- replication errors

Saturation:
- CPU
- I/O latency
- I/O throughput
- memory pressure
- temp file spill
- connection exhaustion
- lock wait queue
- WAL archive backlog
- autovacuum backlog
```

Observability harus menjawab empat kategori ini.

---

## 5. Membedakan Bottleneck CPU, I/O, Lock, Memory, Connection, dan Planner

### 5.1 CPU-bound

Gejala:

- CPU PostgreSQL tinggi,
- disk tidak terlalu tinggi,
- banyak query aktif,
- plan melakukan hash/join/aggregate besar,
- sorting besar,
- expression/function mahal,
- JSONB processing berat,
- JIT mungkin muncul di plan.

Contoh penyebab:

```sql
SELECT tenant_id, status, count(*)
FROM cases
WHERE created_at >= now() - interval '1 year'
GROUP BY tenant_id, status;
```

Jika tabel sangat besar dan filter tidak selektif, CPU bisa habis untuk scan + aggregate.

Solusi mungkin:

- index yang sesuai,
- pre-aggregation,
- materialized view,
- partitioning,
- read replica/reporting DB,
- mengurangi cardinality,
- query rewrite,
- caching hasil.

Bukan langsung menaikkan `work_mem`.

---

### 5.2 I/O-bound

Gejala:

- disk read/write latency tinggi,
- `EXPLAIN (ANALYZE, BUFFERS)` menunjukkan banyak read dari disk,
- cache hit ratio turun,
- checkpoint spike,
- WAL write tinggi,
- temp file besar,
- backup/reporting job memperberat disk.

Penyebab:

- query scan terlalu banyak data,
- working set lebih besar dari cache,
- index tidak efektif,
- bloat besar,
- bulk write menghasilkan WAL tinggi,
- checkpoint terlalu agresif,
- storage tier tidak cukup.

Solusi mungkin:

- query/index redesign,
- partition pruning,
- vacuum/bloat control,
- mengatur checkpoint,
- memindahkan reporting,
- storage upgrade,
- cache strategy.

---

### 5.3 Lock-bound

Gejala:

- CPU rendah tetapi latency tinggi,
- banyak session `active` menunggu lock,
- `pg_locks` menunjukkan blocker,
- `pg_stat_activity.wait_event_type = 'Lock'`,
- `lock_timeout` atau deadlock meningkat,
- satu transaksi lama memblokir banyak transaksi.

Penyebab:

- transaction terlalu panjang,
- DDL migration blocking,
- row hot spot,
- inconsistent lock order,
- foreign key tanpa index,
- `SELECT FOR UPDATE` terlalu luas,
- batch update terlalu besar,
- ORM flush di waktu tak terduga.

Solusi:

- pendekkan transaksi,
- buat lock order eksplisit,
- index foreign key,
- batch kecil,
- `NOWAIT`/`SKIP LOCKED` untuk pola tertentu,
- timeout guardrail,
- zero-downtime migration discipline.

---

### 5.4 Memory-bound

Gejala:

- temp file spill,
- OOM di container,
- swap,
- query sort/hash besar,
- banyak parallel worker,
- banyak connection,
- `work_mem` terlalu tinggi secara global.

Penyebab:

- pool terlalu besar,
- query sort/hash paralel,
- reporting workload bercampur OLTP,
- `work_mem` dinaikkan tanpa memahami multiplication,
- hash aggregate besar.

Ingat:

```text
work_mem bukan total memory.
work_mem dapat dipakai per operation, per query, per worker, per connection.
```

Solusi:

- tuning per session/query,
- batasi pool,
- pisahkan reporting,
- index untuk menghindari sort besar,
- pre-aggregation,
- query rewrite.

---

### 5.5 Connection-bound

Gejala:

- aplikasi timeout menunggu connection,
- HikariCP active connections penuh,
- PostgreSQL `max_connections` mendekati limit,
- database CPU mungkin rendah,
- banyak session idle/idle in transaction,
- request queue menumpuk di aplikasi.

Penyebab:

- pool terlalu kecil untuk beban valid,
- pool terlalu besar sehingga database overload,
- connection leak,
- transaksi lambat menahan connection,
- query lambat,
- endpoint melakukan terlalu banyak query serial,
- missing timeout.

Solusi:

- ukur waktu tunggu pool,
- cari query/transaction lama,
- kurangi roundtrip,
- set timeout,
- perbaiki leak,
- gunakan PgBouncer bila sesuai,
- pisahkan pool read/write/batch.

Pool bukan solusi performa universal. Pool adalah alat backpressure.

---

### 5.6 Planner-bound

Gejala:

- query kadang cepat kadang lambat,
- plan berubah setelah data berubah,
- row estimate jauh dari actual,
- index ada tetapi tidak dipakai,
- prepared statement generic plan buruk,
- multi-tenant skew,
- correlated predicates.

Penyebab:

- statistics stale,
- data distribution skew,
- missing extended statistics,
- parameter sensitivity,
- generic plan,
- expression/JSONB predicate kurang stats,
- partition statistics tidak cukup.

Solusi:

- `ANALYZE`,
- naikkan statistics target pada kolom tertentu,
- buat extended statistics,
- rewrite query,
- partial index,
- expression index,
- hindari generic plan untuk query parameter-sensitive,
- pecah workload hot tenant.

---

## 6. Baseline: Kamu Tidak Bisa Men-tune yang Tidak Diukur

Sebelum tuning, buat baseline.

Minimal baseline produksi:

```text
Database-level:
- transactions per second
- query latency distribution
- active/idle connections
- deadlocks
- lock waits
- temp files
- WAL generated
- checkpoint frequency/duration
- cache hit
- table/index bloat proxy
- autovacuum activity
- replication lag

Application-level:
- endpoint latency P50/P95/P99
- DB call duration
- connection acquisition time
- pool active/idle/pending
- error rate by SQLSTATE
- retry count
- transaction duration

Infrastructure-level:
- CPU
- memory
- disk read/write latency
- disk throughput
- IOPS
- network latency
- filesystem usage
```

Tanpa baseline, kamu tidak tahu apakah perubahan memperbaiki atau hanya memindahkan masalah.

---

## 7. Latency Percentile: Jangan Tertipu Average

Average latency sering menipu.

Contoh:

```text
Query A:
- average: 40 ms
- P95: 50 ms
- P99: 70 ms

Query B:
- average: 40 ms
- P95: 200 ms
- P99: 3000 ms
```

Keduanya punya average sama, tetapi Query B punya tail latency buruk.

Untuk aplikasi Java, tail latency lebih penting karena:

- request thread tertahan,
- connection tertahan,
- transaction lebih lama,
- lock lebih lama,
- retry meningkat,
- pool exhaustion bisa terjadi,
- cascading failure muncul.

Pantau minimal:

```text
P50: normal user experience
P95: typical bad experience
P99: tail behavior / incident risk
max: outlier / stuck query / lock
```

---

## 8. Query Fingerprint, Bukan Query Literal

Query literal:

```sql
SELECT * FROM cases WHERE id = 'a1';
SELECT * FROM cases WHERE id = 'b2';
SELECT * FROM cases WHERE id = 'c3';
```

Query fingerprint:

```sql
SELECT * FROM cases WHERE id = ?;
```

Untuk performance engineering, yang penting adalah fingerprint.

`pg_stat_statements` membantu mengelompokkan query berdasarkan bentuknya, sehingga kamu bisa melihat:

- total time,
- mean time,
- calls,
- rows,
- shared block hits/reads,
- temp block reads/writes,
- WAL impact pada versi yang mendukung,
- planning/execution metrics bila diaktifkan.

Pertanyaan yang harus dijawab:

```text
Query mana yang menghabiskan total waktu terbesar?
Query mana yang punya mean latency tinggi?
Query mana yang sering dipanggil?
Query mana yang membaca block paling banyak?
Query mana yang menulis WAL besar?
Query mana yang menghasilkan temp spill?
```

Query paling lambat secara individual belum tentu prioritas tertinggi.

Contoh:

```text
Query A: 10 detik, 1 kali per hari → total 10 detik
Query B: 50 ms, 2 juta kali per hari → total 100.000 detik
```

Query B mungkin lebih penting.

---

## 9. Workload Characterization

Sebelum tuning, karakterisasi workload.

### 9.1 OLTP

Ciri:

- query pendek,
- transaksi pendek,
- high concurrency,
- banyak point lookup/update,
- strict correctness,
- latency sensitive.

Risiko:

- lock contention,
- pool exhaustion,
- index write amplification,
- hot rows,
- bloat dari update intensif.

Prioritas:

- predictable low latency,
- transaksi pendek,
- index tepat,
- constraint benar,
- backpressure.

---

### 9.2 Reporting / analytical-ish workload

Ciri:

- scan besar,
- aggregation,
- sort,
- join besar,
- query lebih lama,
- concurrency lebih rendah.

Risiko:

- mengganggu OLTP,
- temp spill,
- cache pollution,
- CPU/I/O spike,
- replica lag bila di replica.

Prioritas:

- read replica,
- materialized view,
- summary table,
- partition pruning,
- job scheduling,
- resource isolation.

---

### 9.3 Event log / audit workload

Ciri:

- append-heavy,
- range query by time/entity,
- retention,
- compliance sensitivity,
- immutability expectation.

Risiko:

- table growth,
- index growth,
- partition lifecycle,
- backup size,
- reporting scan.

Prioritas:

- partitioning,
- BRIN/B-tree mix,
- retention plan,
- append-only discipline,
- archive strategy.

---

### 9.4 Queue-like workload

Ciri:

- workers claim rows,
- frequent status update,
- `FOR UPDATE SKIP LOCKED`,
- high churn.

Risiko:

- bloat,
- hot index pages,
- autovacuum pressure,
- starvation,
- lock contention.

Prioritas:

- small active set,
- partition/archive completed rows,
- partial indexes,
- batch claim carefully,
- monitor dead tuples.

---

### 9.5 Multi-tenant workload

Ciri:

- tenant_id everywhere,
- skew between tenants,
- hot tenant,
- noisy neighbor,
- per-tenant reporting.

Risiko:

- generic plan buruk,
- global index kurang efektif,
- statistics menyembunyikan skew,
- satu tenant mendominasi resource.

Prioritas:

- tenant-aware indexes,
- partial index untuk hot tenant bila perlu,
- extended statistics,
- workload isolation,
- rate limiting,
- per-tenant observability.

---

## 10. Benchmark: Apa yang Sering Salah

Benchmark yang buruk lebih berbahaya daripada tidak benchmark, karena memberi rasa percaya diri palsu.

Kesalahan umum:

1. dataset terlalu kecil,
2. semua data muat di memory,
3. concurrency tidak realistis,
4. query terlalu sederhana,
5. tidak ada write contention,
6. tidak ada lock contention,
7. tidak ada autovacuum,
8. tidak ada checkpoint,
9. tidak mengukur P95/P99,
10. tidak mengukur error/retry,
11. tidak memakai schema/index yang sama,
12. tidak memakai network path yang sama,
13. benchmark hanya 1 menit,
14. warm cache dan cold cache dicampur,
15. hasil single run dianggap benar.

Benchmark harus menjawab pertanyaan spesifik.

Buruk:

```text
Seberapa cepat PostgreSQL?
```

Baik:

```text
Dengan dataset 500 juta audit rows, apakah query timeline by entity_id dalam 90 hari bisa P95 < 300 ms pada 100 concurrent readers?
```

Baik:

```text
Apakah ingestion 5.000 events/detik dengan 3 secondary indexes menjaga replication lag < 10 detik?
```

Baik:

```text
Apakah migration add constraint NOT VALID + validate aman terhadap OLTP traffic 1.500 TPS?
```

---

## 11. pgbench: Berguna, tapi Jangan Disalahpahami

`pgbench` berguna untuk:

- baseline hardware,
- membandingkan konfigurasi,
- menguji connection/concurrency,
- menguji transaction throughput,
- membuat custom script workload,
- melihat efek latency network,
- stress test sederhana.

Tetapi default `pgbench` bukan representasi aplikasi kamu.

Gunakan default `pgbench` untuk:

```text
Apakah database/storage ini punya kapasitas transaksi dasar yang masuk akal?
```

Gunakan custom script untuk:

```text
Apakah workload aplikasi kita aman?
```

Contoh custom script harus memasukkan:

- distribusi akses data,
- hot keys,
- transaction mix,
- read/write ratio,
- query shape nyata,
- contention scenario,
- batch jobs,
- think time bila relevan.

---

## 12. Dataset Benchmark Harus Production-like

Dataset kecil sering menipu.

Query yang cepat di 100 ribu rows bisa hancur di 100 juta rows.

Hal yang harus realistis:

```text
Row count
Row width
Index count
Data distribution
Tenant skew
Status distribution
Time distribution
Deleted/updated row churn
Bloat level
JSONB payload size
Foreign key relationship cardinality
Partition count
```

Contoh data distribution yang penting:

```text
90% tenant kecil
9% tenant sedang
1% tenant sangat besar
```

Jika benchmark menggunakan distribusi uniform, hasilnya tidak akan memprediksi hot tenant problem.

---

## 13. Warm Cache vs Cold Cache

PostgreSQL memakai shared buffers dan OS cache. Maka performa query bisa sangat berbeda antara:

```text
cold cache: data belum ada di memory
warm cache: data sudah ada di memory
```

Keduanya penting.

Cold cache relevan untuk:

- restart,
- failover,
- query jarang,
- reporting scan besar,
- working set lebih besar dari memory.

Warm cache relevan untuk:

- hot OLTP workload,
- repeated point lookup,
- frequently accessed tenant,
- cached index pages.

Benchmark harus menyebutkan kondisi cache.

---

## 14. Method: Diagnose Before Tune

Gunakan urutan berikut.

```text
1. Define symptom clearly
2. Establish scope
3. Collect evidence
4. Identify bottleneck class
5. Form hypothesis
6. Validate with targeted measurement
7. Apply minimal change
8. Measure again
9. Check side effects
10. Document result
```

Jangan lakukan:

```text
ubah 5 parameter sekaligus
buat 4 index sekaligus
naikkan instance sekaligus
ubah query dan config bersamaan
```

Kalau banyak hal berubah sekaligus, kamu tidak tahu mana yang berdampak.

---

## 15. Evidence Collection Checklist

### 15.1 Untuk query lambat

Ambil:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT ...;
```

Lihat:

- total execution time,
- planning time,
- estimated rows vs actual rows,
- loops,
- scan method,
- join method,
- sort/hash memory,
- temp spill,
- shared hit/read,
- rows removed by filter,
- index condition vs filter,
- parallelism,
- JIT.

Jangan lupa:

- parameter query nyata,
- tenant nyata,
- waktu kejadian,
- apakah query di primary atau replica,
- apakah ada lock wait,
- apakah data sudah berubah.

---

### 15.2 Untuk lock issue

Ambil:

```sql
SELECT
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocker.pid AS blocker_pid,
    blocker.query AS blocker_query,
    blocked.wait_event_type,
    blocked.wait_event,
    now() - blocked.query_start AS blocked_duration,
    now() - blocker.query_start AS blocker_duration
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks
    ON blocked_locks.pid = blocked.pid
JOIN pg_locks blocker_locks
    ON blocker_locks.locktype = blocked_locks.locktype
   AND blocker_locks.database IS NOT DISTINCT FROM blocked_locks.database
   AND blocker_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
   AND blocker_locks.page IS NOT DISTINCT FROM blocked_locks.page
   AND blocker_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
   AND blocker_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
   AND blocker_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
   AND blocker_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
   AND blocker_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
   AND blocker_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
   AND blocker_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocker
    ON blocker.pid = blocker_locks.pid
WHERE NOT blocked_locks.granted
  AND blocker_locks.granted;
```

Lihat:

- siapa blocker,
- query blocker,
- umur transaksi blocker,
- aplikasi blocker,
- lock type,
- apakah blocker idle in transaction,
- apakah ada migration.

---

### 15.3 Untuk connection pool issue

Dari aplikasi:

- active connections,
- idle connections,
- pending threads,
- connection acquisition time,
- connection timeout count,
- max lifetime churn,
- leak detection logs,
- endpoint yang menahan connection.

Dari PostgreSQL:

```sql
SELECT
    state,
    wait_event_type,
    count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state, wait_event_type
ORDER BY count(*) DESC;
```

Lihat:

- active vs idle,
- idle in transaction,
- lock wait,
- banyak connection dari app mana,
- transaction age.

---

### 15.4 Untuk bloat/vacuum issue

Ambil:

```sql
SELECT
    schemaname,
    relname,
    n_live_tup,
    n_dead_tup,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze,
    vacuum_count,
    autovacuum_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 30;
```

Cek long transaction:

```sql
SELECT
    pid,
    usename,
    application_name,
    state,
    now() - xact_start AS xact_age,
    query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start ASC;
```

Lihat:

- dead tuples,
- autovacuum terakhir,
- long transaction,
- idle in transaction,
- table churn,
- partition retention.

---

### 15.5 Untuk WAL/checkpoint issue

Cek:

```sql
SELECT * FROM pg_stat_bgwriter;
```

Pada versi modern, cek juga view checkpoint/WAL yang tersedia di environment.

Lihat:

- checkpoint frequency,
- buffers checkpoint,
- buffers backend,
- WAL generation,
- archive failures,
- replication slot retention,
- disk usage `pg_wal`.

Pertanyaan:

```text
Apakah write spike menghasilkan WAL tinggi?
Apakah checkpoint terlalu sering?
Apakah WAL archive gagal?
Apakah replication slot menahan WAL?
Apakah bulk load berjalan tanpa strategi?
```

---

## 16. Query-level Tuning Method

Urutan tuning query:

```text
1. Pahami business requirement
2. Pahami cardinality
3. Pahami access pattern
4. Ambil EXPLAIN ANALYZE BUFFERS
5. Identifikasi node mahal
6. Cek estimate vs actual
7. Cek index condition vs filter
8. Cek sort/hash spill
9. Cek join order/method
10. Cek row width
11. Rewrite query bila perlu
12. Tambah/ubah index bila terbukti
13. ANALYZE/extended stats bila misestimate
14. Uji dengan parameter berbeda
15. Uji dengan tenant/data besar
```

Jangan langsung membuat index.

### 16.1 Contoh: Query lambat karena filter tidak selektif

Query:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Index ada:

```sql
CREATE INDEX idx_cases_status ON cases(status);
```

Masalah:

- `status = 'OPEN'` mungkin 70% table,
- index status tidak membantu sorting,
- PostgreSQL tetap harus mengambil banyak rows lalu sort.

Index lebih sesuai:

```sql
CREATE INDEX idx_cases_open_created_at
ON cases (created_at DESC)
WHERE status = 'OPEN';
```

Ini bukan “tambah index”, tetapi “sesuaikan index dengan predicate + ordering + limit”.

---

### 16.2 Contoh: Query lambat karena row terlalu lebar

Buruk:

```sql
SELECT *
FROM case_events
WHERE case_id = ?
ORDER BY occurred_at DESC
LIMIT 100;
```

Jika table punya JSONB payload besar, `SELECT *` bisa mahal.

Lebih baik:

```sql
SELECT id, case_id, event_type, occurred_at, actor_id
FROM case_events
WHERE case_id = ?
ORDER BY occurred_at DESC
LIMIT 100;
```

Jika payload perlu detail, ambil lazily by id.

Mental model:

```text
Read path cepat sering dimulai dari memilih kolom yang benar.
```

---

### 16.3 Contoh: Query lambat karena OFFSET

Buruk:

```sql
SELECT id, created_at, status
FROM cases
WHERE tenant_id = ?
ORDER BY created_at DESC, id DESC
OFFSET 100000
LIMIT 50;
```

Masalah:

- PostgreSQL tetap harus melewati 100.000 rows.

Lebih baik keyset:

```sql
SELECT id, created_at, status
FROM cases
WHERE tenant_id = ?
  AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_tenant_created_id
ON cases (tenant_id, created_at DESC, id DESC);
```

---

## 17. Index-level Tuning Method

Index tuning bukan hanya menambah index.

Pertanyaan sebelum membuat index:

```text
Query apa yang akan dipercepat?
Predicate-nya apa?
Ordering-nya apa?
Join key-nya apa?
Selectivity-nya bagaimana?
Apakah index mendukung LIMIT?
Apakah index bisa partial?
Apakah index akan dipakai untuk write-heavy table?
Berapa write amplification-nya?
Apakah index bisa dibuat concurrently?
Bagaimana rollback-nya?
```

### 17.1 Index ROI

Index punya biaya:

- storage,
- insert overhead,
- update overhead,
- delete overhead,
- WAL overhead,
- vacuum overhead,
- planner overhead,
- rebuild/maintenance overhead.

Maka index harus punya return:

- query latency turun,
- total DB time turun,
- lock duration turun,
- CPU/I/O turun,
- endpoint SLO membaik.

### 17.2 Ukur index usage

```sql
SELECT
    schemaname,
    relname,
    indexrelname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

Hati-hati:

- index yang jarang dipakai mungkin tetap penting untuk constraint,
- index untuk monthly report mungkin jarang tapi valid,
- statistik reset bisa menipu,
- index baru perlu waktu untuk terlihat usage-nya.

---

## 18. Schema-level Tuning

Kadang query lambat bukan karena query, tapi schema.

Contoh schema smell:

```text
satu table menyimpan semua event 10 tahun tanpa partition
status disimpan sebagai text bebas
timestamp tanpa timezone policy
JSONB menyimpan field yang selalu difilter
foreign key tidak punya supporting index
soft delete tanpa partial index
multi-tenant tanpa tenant_id di index
row terlalu lebar untuk list page
```

Tuning schema bisa berupa:

- split hot/cold columns,
- add generated column,
- normalize field JSONB yang sering difilter,
- partition by time,
- partial index untuk active rows,
- composite index tenant-aware,
- summary table,
- materialized view,
- archive old rows,
- reduce unnecessary secondary indexes.

Schema adalah performance contract jangka panjang.

---

## 19. Config-level Tuning

Konfigurasi tetap penting, tetapi harus dilakukan setelah memahami workload.

### 19.1 `max_connections`

Naikkan `max_connections` bukan default solusi.

Banyak connection berarti:

- banyak backend process,
- memory pressure,
- context switching,
- lock contention meningkat,
- database bisa collapse alih-alih memberi backpressure.

Lebih baik:

- pool aplikasi rasional,
- PgBouncer bila sesuai,
- endpoint timeout,
- backpressure.

---

### 19.2 `shared_buffers`

`shared_buffers` terlalu kecil bisa buruk, tetapi terlalu besar juga bukan selalu lebih baik karena OS cache tetap penting.

Ukur:

- working set,
- buffer hit/read,
- OS cache behavior,
- memory untuk connection/query.

---

### 19.3 `work_mem`

`work_mem` harus dipahami sebagai per operation.

Jangan:

```text
semua query spill → naikkan work_mem global besar-besaran
```

Lebih aman:

- per role,
- per session,
- per job,
- query rewrite,
- index untuk menghindari sort,
- pre-aggregation.

Contoh:

```sql
BEGIN;
SET LOCAL work_mem = '256MB';
-- reporting query tertentu
COMMIT;
```

---

### 19.4 Checkpoint settings

Checkpoint terlalu sering dapat menyebabkan write pressure.

Tuning berkaitan dengan:

- write workload,
- WAL generation,
- recovery time objective,
- storage performance,
- checkpoint completion target.

Jangan mengubahnya tanpa memonitor:

- checkpoint count,
- checkpoint duration,
- WAL volume,
- recovery expectation.

---

### 19.5 Autovacuum settings

Autovacuum bukan musuh.

Jika autovacuum menyebabkan I/O, pertanyaan yang benar:

```text
Kenapa table menghasilkan dead tuples sebanyak itu?
Kenapa vacuum baru bekerja saat sudah parah?
Apakah scale factor terlalu tinggi untuk table besar?
Apakah long transaction menghambat cleanup?
```

Per-table tuning sering lebih tepat daripada global tuning.

---

## 20. Application-level Tuning

Banyak masalah PostgreSQL berasal dari aplikasi.

### 20.1 Kurangi roundtrip

Buruk:

```text
for each item:
  SELECT ...
  UPDATE ...
```

Lebih baik:

- batch,
- set-based operation,
- single transaction dengan batas jelas,
- `COPY`,
- bulk fetch,
- `WHERE id = ANY (?)`,
- outbox batching.

---

### 20.2 Atur transaction boundary

Buruk:

```text
@Transactional
  call external API
  update DB
  send email
  run expensive query
```

Masalah:

- connection tertahan,
- lock tertahan,
- snapshot panjang,
- vacuum terhambat,
- failure ambiguity.

Lebih baik:

```text
validate input
call external dependency outside DB transaction where safe
open short transaction
change state atomically
write outbox
commit
process external side effect asynchronously
```

---

### 20.3 Hindari ORM accidental workload

Hibernate/JPA bisa menghasilkan:

- N+1 queries,
- unexpected flush,
- large persistence context,
- full entity load untuk projection kecil,
- cascade update besar,
- pessimistic lock terlalu luas,
- inefficient pagination,
- lazy loading di loop.

Gunakan:

- DTO projection,
- fetch join secara hati-hati,
- batch size,
- entity graph,
- jOOQ untuk query kritikal,
- native SQL untuk hot path bila perlu.

---

## 21. Capacity Planning

Capacity planning bukan menebak instance size.

Minimal hitung:

```text
Current TPS
Peak TPS
Growth rate
Read/write ratio
Average query cost
P95/P99 latency
Data growth per day
Index growth per day
WAL generation per day
Backup size
Retention period
Replica lag tolerance
Restore time objective
```

### 21.1 Data growth

Misal:

```text
case_events:
- 20 juta events/hari
- average row 600 bytes logical
- index overhead 2x
- WAL overhead signifikan
```

Perkiraan kasar:

```text
20,000,000 * 600 bytes = 12 GB/day heap logical
Dengan index + overhead bisa 30–50 GB/day
Dalam 1 tahun bisa >10 TB
```

Ini mengubah keputusan:

- partitioning,
- retention,
- archive,
- backup,
- BRIN,
- reporting separation.

---

### 21.2 Connection capacity

Misal:

```text
20 service instances
masing-masing Hikari maxPoolSize 30
```

Total potensi:

```text
600 PostgreSQL connections
```

Jika database hanya mampu menjalankan efektif 80 concurrent active queries, pool 600 bisa memperburuk keadaan.

Prinsip:

```text
Pool size harus mengikuti kapasitas database dan latency target, bukan jumlah thread aplikasi.
```

---

## 22. Performance Regression Testing

Setiap perubahan berikut perlu performance regression awareness:

- index baru,
- index drop,
- query rewrite,
- ORM upgrade,
- PostgreSQL upgrade,
- driver upgrade,
- migration besar,
- partitioning change,
- config change,
- new reporting dashboard,
- new batch job,
- new feature with different access pattern.

Regression test harus mengukur:

```text
query latency
plan shape
rows estimate
buffer usage
temp spill
lock behavior
WAL generated
connection usage
```

Simpan plan sebelum/sesudah untuk query kritikal.

---

## 23. Plan Regression

Plan bisa berubah karena:

- data bertambah,
- statistics berubah,
- PostgreSQL upgrade,
- parameter berubah,
- index baru/drop,
- prepared statement generic plan,
- partition count berubah,
- correlation berubah.

Untuk query kritikal, simpan:

```text
query fingerprint
sample parameters
expected plan shape
expected max rows scanned
expected index usage
acceptable latency
```

Jangan mengunci semua plan secara membabi buta. PostgreSQL planner biasanya adaptif. Tetapi query kritikal perlu guardrail.

---

## 24. Tuning Under Incident Pressure

Saat insiden, tujuan bukan desain sempurna. Tujuannya:

```text
stabilkan sistem → kurangi dampak → pahami akar masalah → perbaiki permanen
```

### 24.1 Immediate stabilization options

Tergantung kasus:

- kill blocker session,
- pause batch job,
- disable endpoint/report,
- reduce app concurrency,
- lower pool size,
- enable circuit breaker,
- set statement timeout,
- add temporary index concurrently,
- route reporting to replica,
- stop migration,
- increase storage if disk full,
- release WAL retention issue,
- promote replica only jika prosedur jelas.

### 24.2 Jangan lakukan sembarangan

Berbahaya:

- restart database tanpa tahu blocker,
- `VACUUM FULL` di production hot table,
- drop index karena terlihat unused tanpa analisis,
- naikkan `max_connections` saat database sudah saturated,
- matikan autovacuum,
- kill random backend,
- failover tanpa memahami replication lag,
- ubah isolation level global,
- menaikkan `work_mem` global besar.

---

## 25. Contoh Diagnosis End-to-End: Endpoint Case List Lambat

Gejala:

```text
GET /cases?status=OPEN&page=2000 lambat P99 8 detik.
```

### 25.1 Scope

- hanya endpoint list,
- hanya tenant besar,
- database CPU sedang,
- tidak ada lock wait besar.

### 25.2 Query

```sql
SELECT id, title, status, created_at
FROM cases
WHERE tenant_id = ?
  AND status = 'OPEN'
ORDER BY created_at DESC
OFFSET 100000
LIMIT 50;
```

### 25.3 Evidence

`EXPLAIN ANALYZE` menunjukkan:

- index digunakan,
- tetapi membaca >100.000 rows,
- banyak heap fetch,
- latency naik linear dengan offset.

### 25.4 Diagnosis

Bottleneck bukan missing index utama. Bottleneck adalah pagination model.

### 25.5 Fix

Ganti keyset pagination:

```sql
SELECT id, title, status, created_at
FROM cases
WHERE tenant_id = ?
  AND status = 'OPEN'
  AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX CONCURRENTLY idx_cases_tenant_status_created_id
ON cases (tenant_id, status, created_at DESC, id DESC);
```

### 25.6 Verification

Ukur:

- P95/P99 endpoint,
- rows scanned,
- buffer hits/reads,
- DB total time,
- index write overhead,
- UX compatibility.

---

## 26. Contoh Diagnosis: CPU Tinggi Setelah Feature Baru

Gejala:

```text
CPU database 95% setelah deployment dashboard compliance.
```

Query baru:

```sql
SELECT officer_id, count(*)
FROM cases
WHERE tenant_id = ?
  AND metadata->>'riskLevel' = 'HIGH'
  AND created_at >= now() - interval '180 days'
GROUP BY officer_id;
```

Masalah:

- filter JSONB expression tidak punya index/statistics cukup,
- scan banyak rows,
- aggregate besar,
- dashboard refresh terlalu sering.

Solusi bertahap:

1. Tambah generated column atau expression index.
2. Pertimbangkan summary table.
3. Cache dashboard.
4. Batasi refresh.
5. Jalankan di replica/reporting DB bila workload besar.

Contoh index:

```sql
CREATE INDEX CONCURRENTLY idx_cases_tenant_risk_created_officer
ON cases (tenant_id, (metadata->>'riskLevel'), created_at DESC, officer_id);
```

Atau schema evolution:

```sql
ALTER TABLE cases
ADD COLUMN risk_level text GENERATED ALWAYS AS (metadata->>'riskLevel') STORED;
```

Lalu index pada `risk_level`.

---

## 27. Contoh Diagnosis: Pool Exhaustion tapi DB CPU Rendah

Gejala:

```text
Hikari connection timeout meningkat.
Database CPU 20%.
```

Ini sering berarti query tidak CPU-bound, tetapi connection tertahan.

Cek:

```sql
SELECT
    state,
    wait_event_type,
    count(*)
FROM pg_stat_activity
GROUP BY state, wait_event_type
ORDER BY count(*) DESC;
```

Hasil:

```text
idle in transaction: 45
active / Lock: 20
```

Diagnosis:

- transaksi aplikasi terbuka terlalu lama,
- beberapa session idle in transaction menahan lock/snapshot,
- pool penuh karena connection tidak dilepas.

Fix:

- cari endpoint/transaction owner,
- pendekkan `@Transactional`,
- set `idle_in_transaction_session_timeout`,
- set Hikari leak detection sementara,
- tambah application_name detail,
- audit code path yang melakukan external call di dalam transaction.

Bukan menaikkan pool.

---

## 28. Contoh Diagnosis: Write Throughput Turun Setelah Tambah Index

Gejala:

```text
Ingestion turun dari 8.000 row/detik ke 2.500 row/detik setelah release.
```

Perubahan:

```sql
CREATE INDEX idx_events_payload_gin ON events USING gin (payload);
CREATE INDEX idx_events_actor ON events(actor_id);
CREATE INDEX idx_events_status ON events(status);
```

Diagnosis:

- table append-heavy,
- setiap insert harus update 3 index baru,
- GIN index pada payload mahal,
- WAL volume naik,
- checkpoint/replication lag naik.

Fix:

- cek apakah semua index benar-benar dibutuhkan,
- partial index bila query hanya status tertentu,
- expression index untuk key tertentu, bukan full payload,
- staging + batch transform,
- partition by time,
- reporting/search projection terpisah.

---

## 29. Performance Incident Report Template

Gunakan format ringkas tapi lengkap.

```markdown
# PostgreSQL Performance Incident Report

## 1. Summary
- Waktu kejadian:
- Dampak user/business:
- Sistem/endpoint terdampak:
- Durasi:
- Severity:

## 2. Symptoms
- Latency:
- Throughput:
- Error rate:
- Saturation:
- Affected query/workload:

## 3. Timeline
- T-0:
- Detection:
- Mitigation:
- Recovery:
- Follow-up:

## 4. Evidence
- pg_stat_activity:
- pg_stat_statements:
- EXPLAIN ANALYZE:
- logs:
- application metrics:
- infrastructure metrics:

## 5. Root Cause
- Primary cause:
- Contributing factors:
- Trigger:
- Why detection was delayed:

## 6. Mitigation
- Immediate actions:
- Risk of mitigation:
- Validation:

## 7. Permanent Fix
- Query/schema/config/app changes:
- Rollout plan:
- Rollback plan:
- Tests:

## 8. Prevention
- Alerts:
- Dashboards:
- Runbook changes:
- Load/performance tests:
- Ownership:
```

Top-tier engineer tidak hanya memadamkan api, tetapi memperbaiki sistem agar api berikutnya lebih kecil atau lebih cepat terdeteksi.

---

## 30. Performance Review Checklist untuk Pull Request

Saat PR memperkenalkan query/schema baru, tanyakan:

```text
Apakah query shape diketahui?
Apakah ada EXPLAIN pada dataset realistis?
Apakah query memakai index yang tepat?
Apakah pagination menggunakan keyset bila data besar?
Apakah SELECT * dihindari untuk list endpoint?
Apakah transaction boundary pendek?
Apakah ada external call di dalam transaction?
Apakah batch job punya limit dan backpressure?
Apakah migration DDL aman?
Apakah index dibuat concurrently?
Apakah constraint besar memakai NOT VALID bila perlu?
Apakah read/write path akan mengganggu OLTP?
Apakah retry SQLSTATE benar?
Apakah pool impact dipahami?
Apakah observability cukup?
```

Performance bukan aktivitas setelah production incident. Ia harus masuk ke review design dan PR.

---

## 31. Decision Framework: Tune Query, Index, Schema, App, Config, atau Hardware?

Gunakan urutan ini:

```text
1. Query shape
2. Index design
3. Statistics/planner
4. Transaction/locking behavior
5. Application behavior
6. Schema/data model
7. Background maintenance
8. Configuration
9. Infrastructure/hardware
10. Architecture split
```

### 31.1 Kapan tune query?

Jika:

- rows scanned terlalu banyak,
- join/sort/aggregate buruk,
- `SELECT *`,
- offset pagination,
- ORM menghasilkan query buruk,
- predicate tidak sargable.

### 31.2 Kapan tambah/ubah index?

Jika:

- access pattern jelas,
- predicate/order/join membutuhkan index,
- selectivity cukup,
- write overhead diterima,
- EXPLAIN membuktikan benefit.

### 31.3 Kapan update statistics?

Jika:

- estimate vs actual jauh,
- data skew,
- correlated predicates,
- multi-tenant distribution,
- plan berubah buruk.

### 31.4 Kapan ubah schema?

Jika:

- JSONB field sering difilter,
- table terlalu besar tanpa retention,
- hot/cold data bercampur,
- row terlalu lebar,
- invariant tidak jelas,
- access pattern tidak cocok dengan model.

### 31.5 Kapan ubah app?

Jika:

- transaction terlalu panjang,
- too many roundtrips,
- N+1,
- pool salah,
- retry salah,
- external call di transaction,
- cache tidak ada/salah.

### 31.6 Kapan ubah config?

Jika:

- evidence menunjukkan memory/checkpoint/autovacuum/connection setting tidak sesuai workload,
- perubahan query/schema/app tidak cukup,
- baseline tersedia.

### 31.7 Kapan scale hardware?

Jika:

- workload valid,
- query/index/schema/app sudah reasonable,
- bottleneck resource nyata,
- cost lebih rendah daripada complexity redesign,
- growth membutuhkan headroom.

Scaling hardware tanpa memperbaiki query buruk biasanya hanya menunda insiden.

---

## 32. Common Anti-patterns

### 32.1 “Tambah index saja”

Index salah bisa:

- tidak dipakai,
- memperlambat write,
- memperbesar WAL,
- memperbesar backup,
- memperlambat vacuum,
- membuat planner memilih plan buruk.

### 32.2 “Naikkan pool biar throughput naik”

Pool terlalu besar bisa:

- membanjiri database,
- meningkatkan lock contention,
- menaikkan memory,
- memperburuk latency P99,
- menghapus backpressure.

### 32.3 “Matikan autovacuum”

Ini hampir selalu salah.

Efek:

- bloat naik,
- stats stale,
- wraparound risk,
- performa makin buruk.

### 32.4 “EXPLAIN tanpa ANALYZE cukup”

`EXPLAIN` tanpa `ANALYZE` hanya prediksi. Untuk diagnosis performa, kamu perlu actual runtime jika aman dijalankan.

### 32.5 “Benchmark di laptop cukup”

Laptop benchmark bisa berguna untuk logika awal, tetapi tidak cukup untuk keputusan produksi.

### 32.6 “Average latency turun berarti aman”

Tail latency bisa tetap buruk.

### 32.7 “Read replica menyelesaikan semua read problem”

Read replica membawa:

- stale read,
- lag,
- failover complexity,
- routing complexity,
- consistency issue.

---

## 33. PostgreSQL Performance Maturity Model

### Level 1 — Reactive

Ciri:

- tuning saat incident,
- tidak ada slow query dashboard,
- query lambat dicari manual,
- pool sizing asal,
- migration sering blocking.

### Level 2 — Observable

Ciri:

- `pg_stat_statements` aktif,
- slow query logs,
- Hikari metrics,
- basic DB dashboard,
- lock wait terlihat.

### Level 3 — Systematic

Ciri:

- query kritikal punya EXPLAIN baseline,
- PR review mempertimbangkan query/index,
- migration zero-downtime discipline,
- autovacuum dipantau,
- backup restore diuji.

### Level 4 — Predictive

Ciri:

- capacity planning,
- load test realistic,
- performance regression test,
- per-tenant observability,
- runbook matang,
- trend bloat/WAL/growth dipantau.

### Level 5 — Architecture-aware

Ciri:

- workload dipisahkan dengan tepat,
- PostgreSQL digunakan sesuai kekuatannya,
- reporting/search/queue/warehouse dipisah bila perlu,
- correctness dan performance dirancang bersama,
- database decisions masuk architecture governance.

Target seri ini adalah membawa kamu ke Level 4–5.

---

## 34. Latihan Praktis

### Latihan 1 — Query diagnosis

Ambil satu query lambat dari aplikasi nyata atau dummy. Dokumentasikan:

```text
query
parameter
EXPLAIN ANALYZE BUFFERS
estimated vs actual rows
node paling mahal
bottleneck class
hipotesis fix
hasil setelah fix
```

### Latihan 2 — Pool sizing review

Untuk satu service Java:

```text
jumlah instance
maxPoolSize per instance
total max connection
P95 query duration
P95 transaction duration
connection acquisition time
pending threads
```

Jawab:

```text
Apakah pool menjadi backpressure sehat atau justru overload amplifier?
```

### Latihan 3 — Index ROI

Pilih satu table dengan index banyak.

Cek:

```text
index size
idx_scan
query yang memakai index
write rate table
apakah index constraint-backed
apakah index masih relevan
```

### Latihan 4 — Workload map

Petakan database kamu:

```text
OLTP tables
append-only event/audit tables
reporting queries
queue-like tables
multi-tenant hot spots
JSONB-heavy tables
large tables needing retention
```

Untuk masing-masing, tulis performance risk-nya.

---

## 35. Ringkasan Inti

Performance engineering PostgreSQL adalah disiplin evidence-based.

Intinya:

1. Jangan mulai dari parameter.
2. Mulai dari gejala yang jelas.
3. Bedakan latency, throughput, errors, dan saturation.
4. Klasifikasikan bottleneck: CPU, I/O, lock, memory, connection, planner, vacuum, WAL, replication.
5. Gunakan `EXPLAIN (ANALYZE, BUFFERS)` untuk query.
6. Gunakan `pg_stat_activity`, `pg_locks`, dan `pg_stat_statements` untuk production evidence.
7. Query shape sering lebih penting daripada hardware.
8. Index adalah trade-off, bukan free lunch.
9. Pool adalah backpressure, bukan multiplier ajaib.
10. Transaction boundary aplikasi sangat mempengaruhi database.
11. Benchmark harus production-like.
12. Tuning harus satu perubahan terukur setiap kali.
13. Regression test diperlukan untuk query dan migration penting.
14. Incident harus menghasilkan runbook dan prevention, bukan hanya fix sementara.

Engineer top-tier tidak hanya tahu fitur PostgreSQL. Ia mampu membangun model sebab-akibat:

```text
aplikasi → query → planner → executor → MVCC/lock → buffer/WAL → OS/storage → user latency
```

Dengan model itu, performa bukan lagi tebak-tebakan.

---

## 36. Koneksi ke Part Berikutnya

Part berikutnya adalah bagian terakhir seri:

```text
Part 034 — PostgreSQL Production Playbook: Failure Modelling, Runbook, Upgrade, dan Mastery Checklist
```

Di sana kita akan menyatukan semua bagian menjadi playbook produksi:

- failure catalogue,
- incident response,
- operational runbook,
- upgrade strategy,
- backup/restore confidence,
- HA/failover drill,
- migration governance,
- mastery checklist,
- system design interview checklist,
- final learning map.

Seri belum selesai. Saat ini selesai sampai Part 033 dari 034.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Workload-specific Design: OLTP, Workflow Engine, Event Log, Audit, Reporting, Multi-tenant</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-034.md">Part 034 — PostgreSQL Production Playbook: Failure Modelling, Runbook, Upgrade, dan Mastery Checklist ➡️</a>
</div>

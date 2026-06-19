# learn-postgresql-mastery-for-java-engineers-part-007.md

# Part 007 — Buffer Manager dan Memory: Shared Buffers, OS Cache, Work Mem, Maintenance Mem

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `007 / 034`  
> Fokus: memahami model memori PostgreSQL secara operasional dan menghubungkannya dengan workload Java production.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membangun fondasi:

1. PostgreSQL sebagai engine, bukan sekadar SQL database.
2. Arsitektur proses PostgreSQL.
3. Connection lifecycle dan pooling.
4. Storage model fisik.
5. MVCC.
6. WAL, durability, checkpoint, dan crash recovery.

Sekarang kita masuk ke lapisan yang sering menyebabkan kebingungan besar di production: **memory**.

Banyak engineer mengira tuning PostgreSQL memory berarti:

```text
shared_buffers besar = performa lebih cepat
work_mem besar = query lebih cepat
maintenance_work_mem besar = maintenance lebih cepat
max_connections besar = lebih banyak traffic
```

Premis ini berbahaya.

PostgreSQL memory bukan satu angka tunggal. Memory PostgreSQL adalah kombinasi dari:

1. memory global yang dipakai bersama,
2. memory per backend process,
3. memory per query operation,
4. memory untuk maintenance,
5. memory OS page cache,
6. memory extension,
7. memory background worker,
8. memory parallel worker,
9. memory client-side atau driver-side,
10. memory efek tidak langsung dari connection pool Java.

Mental model yang benar:

```text
PostgreSQL memory safety = shared memory + per-connection memory + per-operation memory + OS cache + concurrency envelope
```

Kesalahan tuning biasanya bukan karena satu query memakai banyak memory, tetapi karena **banyak koneksi menjalankan banyak operator memory-heavy secara bersamaan**.

---

## 1. Kenapa Topik Memory Penting untuk Java Engineer

Sebagai Java engineer, kamu biasanya familiar dengan:

1. JVM heap,
2. off-heap memory,
3. thread pool,
4. connection pool,
5. GC pressure,
6. backpressure,
7. latency percentile,
8. memory leak,
9. container memory limit.

PostgreSQL punya dinamika yang mirip tetapi tidak identik.

Di Java service, kamu sering membatasi concurrency dengan:

```text
HTTP worker threads
async executor
Kafka consumer concurrency
HikariCP maximumPoolSize
rate limiter
queue size
```

Di PostgreSQL, setiap koneksi aktif dapat memicu penggunaan memory di sisi database. Jadi pool size Java bukan hanya menentukan jumlah koneksi. Pool size ikut menentukan **upper bound concurrency memory PostgreSQL**.

Contoh sederhana:

```text
Hikari maximumPoolSize = 80
work_mem = 64MB
satu query bisa punya 3 sort/hash node
```

Upper bound kasar:

```text
80 connections × 3 operators × 64MB = 15,360MB
```

Itu belum termasuk:

1. shared buffers,
2. OS cache,
3. autovacuum,
4. maintenance operation,
5. parallel workers,
6. WAL buffers,
7. backend private memory,
8. kernel overhead,
9. other processes,
10. container overhead.

Maka rule penting:

```text
work_mem bukan memory per query.
work_mem adalah limit per memory-intensive operation per process.
```

Ini salah satu jebakan terbesar PostgreSQL.

---

## 2. Model Besar Memory PostgreSQL

Secara praktis, memory PostgreSQL bisa dipikirkan dalam beberapa zona.

```text
+--------------------------------------------------------------+
| OS / Host / Container Memory                                 |
|                                                              |
|  +----------------------+   +-----------------------------+  |
|  | PostgreSQL Shared    |   | OS Page Cache               |  |
|  | Memory               |   |                             |  |
|  | - shared_buffers     |   | - cached data files         |  |
|  | - WAL buffers        |   | - cached index files        |  |
|  | - lock tables        |   | - filesystem cache          |  |
|  | - shared state       |   |                             |  |
|  +----------------------+   +-----------------------------+  |
|                                                              |
|  +--------------------------------------------------------+  |
|  | Backend Private Memory                                |  |
|  | per connection/process:                               |  |
|  | - query execution memory                              |  |
|  | - work_mem operations                                 |  |
|  | - temp buffers                                        |  |
|  | - prepared statement/session state                    |  |
|  +--------------------------------------------------------+  |
|                                                              |
|  +--------------------------------------------------------+  |
|  | Background Worker / Maintenance Memory                |  |
|  | - autovacuum workers                                  |  |
|  | - CREATE INDEX                                        |  |
|  | - VACUUM                                              |  |
|  | - logical replication                                 |  |
|  | - parallel query workers                              |  |
|  +--------------------------------------------------------+  |
+--------------------------------------------------------------+
```

Beberapa memory bersifat tetap atau relatif tetap.
Beberapa memory meningkat sesuai concurrency.
Beberapa memory meningkat sesuai query shape.

Yang membuat PostgreSQL tuning sulit adalah kombinasi ini:

```text
Memory usage = configuration × workload × concurrency × plan shape
```

Bukan hanya konfigurasi.

---

## 3. `shared_buffers`: Cache Internal PostgreSQL

`shared_buffers` adalah area memory bersama yang dipakai PostgreSQL untuk menyimpan page data dan index yang sering diakses.

PostgreSQL table dan index disimpan dalam page/block. Secara default page size PostgreSQL biasanya 8KB. Saat query membaca row, PostgreSQL tidak membaca “row” secara abstrak. PostgreSQL membaca page.

Alur sederhana:

```text
Query butuh tuple
  ↓
Executor meminta page
  ↓
Buffer manager cek shared_buffers
  ↓
Jika page ada: buffer hit
  ↓
Jika tidak ada: baca dari OS/filesystem/disk ke shared_buffers
```

`shared_buffers` bukan satu-satunya cache. OS juga punya page cache.

Mental model:

```text
shared_buffers = PostgreSQL-managed cache
OS page cache   = kernel/filesystem-managed cache
```

PostgreSQL tidak berusaha mengambil seluruh RAM untuk dirinya sendiri seperti beberapa database engine lain. PostgreSQL bekerja bersama OS cache.

Dokumentasi PostgreSQL menyatakan `shared_buffers` mengatur jumlah memory yang digunakan server untuk shared memory buffers; default umumnya 128MB, tetapi production biasanya memerlukan nilai lebih tinggi. Namun ini tidak berarti harus memakai mayoritas RAM.

---

## 4. Kenapa `shared_buffers` Terlalu Besar Bisa Tidak Ideal

Naifnya:

```text
RAM 64GB
shared_buffers 48GB
```

Terlihat masuk akal, tetapi sering tidak ideal.

Kenapa?

Karena PostgreSQL juga membutuhkan OS page cache. Data file PostgreSQL tetap berada di filesystem. OS cache bisa membantu banyak operasi I/O, termasuk akses file PostgreSQL yang tidak sedang berada di `shared_buffers`.

Jika `shared_buffers` terlalu besar:

1. OS cache mengecil.
2. Checkpoint dapat menjadi lebih berat karena banyak dirty buffers.
3. Eviction behavior bisa menjadi tidak optimal.
4. Recovery/checkpoint pressure bisa meningkat.
5. Memory tersisa untuk query operations berkurang.
6. Container bisa mendekati OOM jika total memory tidak dihitung benar.

`shared_buffers` adalah cache penting, tetapi bukan satu-satunya sumber performa.

Mental model yang lebih sehat:

```text
PostgreSQL read performance = shared_buffers + OS cache + query plan + index design + data locality + I/O subsystem
```

Bukan:

```text
PostgreSQL read performance = shared_buffers only
```

---

## 5. `effective_cache_size`: Bukan Alokasi Memory

`effective_cache_size` sering disalahpahami.

Ini bukan memory yang dialokasikan PostgreSQL.

`effective_cache_size` adalah **estimasi planner** tentang berapa banyak cache yang mungkin tersedia untuk data PostgreSQL, termasuk `shared_buffers` dan OS page cache.

Planner memakai nilai ini untuk memperkirakan apakah index scan kemungkinan murah karena page yang dibutuhkan mungkin sudah cache.

Jika terlalu rendah:

```text
Planner mengira cache kecil
  ↓
Index scan terlihat mahal
  ↓
Sequential scan mungkin lebih sering dipilih
```

Jika terlalu tinggi:

```text
Planner terlalu optimis cache hit
  ↓
Index scan bisa dipilih walau realitasnya banyak random I/O
```

Jadi `effective_cache_size` adalah sinyal ke optimizer, bukan hard reservation.

Mental model:

```text
shared_buffers        = memory nyata
work_mem              = memory nyata saat operator butuh
maintenance_work_mem  = memory nyata saat maintenance

effective_cache_size  = asumsi planner
```

Ini penting karena banyak engineer melihat konfigurasi memory PostgreSQL lalu menjumlahkan semuanya seolah semua adalah alokasi nyata. `effective_cache_size` tidak boleh dijumlahkan sebagai penggunaan memory.

---

## 6. `work_mem`: Parameter Kecil dengan Efek Besar

`work_mem` mengatur jumlah memory yang bisa digunakan oleh operasi internal tertentu sebelum PostgreSQL menulis data sementara ke disk.

Operasi yang bisa memakai `work_mem` meliputi:

1. sort,
2. hash join,
3. hash aggregate,
4. materialize,
5. merge operation tertentu,
6. DISTINCT,
7. ORDER BY,
8. GROUP BY,
9. some set operations.

Jebakan utamanya:

```text
work_mem dihitung per operation, bukan per query dan bukan per connection.
```

Satu query bisa punya beberapa node yang masing-masing memakai `work_mem`.

Contoh query:

```sql
SELECT customer_id, status, count(*)
FROM enforcement_case
WHERE created_at >= now() - interval '90 days'
GROUP BY customer_id, status
ORDER BY count(*) DESC;
```

Plan mungkin membutuhkan:

1. hash aggregate,
2. sort,
3. mungkin hash join jika join ke table lain,
4. parallel workers.

Jika `work_mem = 64MB`, bukan berarti query maksimal 64MB.

Kasar:

```text
hash aggregate 64MB
sort           64MB
hash join      64MB
parallel x 4
```

Bisa menjadi:

```text
3 × 64MB × 4 workers = 768MB
```

Untuk satu query.

Jika 20 query serupa bersamaan:

```text
20 × 768MB = 15GB+
```

Maka menaikkan `work_mem` secara global adalah tindakan berisiko.

---

## 7. Temp File: Tanda `work_mem` Tidak Cukup atau Plan Tidak Cocok

Jika operasi sort/hash tidak cukup di memory, PostgreSQL spill ke disk sebagai temporary files.

Ini tidak selalu buruk. Spill kecil sesekali bisa diterima.

Yang berbahaya:

1. temp file besar berulang,
2. temp file muncul pada query latency-sensitive,
3. temp file meningkat saat traffic puncak,
4. temp file menyebabkan disk I/O saturation,
5. temp file terjadi karena plan salah akibat statistik buruk,
6. temp file terjadi karena query shape buruk.

Gejalanya:

```text
latency naik
I/O wait naik
temp_bytes naik
disk busy naik
query dengan ORDER BY/GROUP BY lambat
```

Cara observasi:

```sql
SELECT datname, temp_files, temp_bytes
FROM pg_stat_database
ORDER BY temp_bytes DESC;
```

Untuk logging temp file:

```sql
SHOW log_temp_files;
```

Di production, kamu bisa mengatur threshold agar PostgreSQL mencatat temp file besar.

Contoh konsep:

```conf
log_temp_files = '64MB'
```

Artinya temp file yang melewati threshold akan tercatat di log.

Namun diagnosis tidak berhenti di “naikkan work_mem”. Pertanyaan yang benar:

1. Query mana yang spill?
2. Apakah spill karena sorting dataset besar?
3. Apakah index bisa menghindari sort?
4. Apakah cardinality estimate salah?
5. Apakah grouping bisa dikurangi lebih awal?
6. Apakah query perlu pagination/keyset?
7. Apakah concurrency terlalu tinggi?
8. Apakah operation harus dipindah ke reporting replica?

---

## 8. `maintenance_work_mem`: Memory untuk Maintenance Operation

`maintenance_work_mem` digunakan untuk operasi maintenance seperti:

1. `VACUUM`,
2. `CREATE INDEX`,
3. `ALTER TABLE ADD FOREIGN KEY`,
4. beberapa operasi maintenance lain.

Berbeda dari `work_mem`, ini bukan dipakai oleh query biasa.

Nilai lebih besar dapat mempercepat beberapa operasi maintenance, terutama index creation atau vacuum tertentu. Namun tetap harus dihitung dengan concurrency maintenance.

Contoh:

```text
maintenance_work_mem = 2GB
autovacuum_max_workers = 6
```

Jika autovacuum worker dapat memakai memory besar, secara kasar potensi memory bisa signifikan.

Ada parameter khusus:

```conf
autovacuum_work_mem
```

Jika tidak diset, autovacuum menggunakan `maintenance_work_mem`.

Ini penting karena autovacuum bukan optional. Ia bagian dari survival PostgreSQL. Tetapi jika memory maintenance terlalu besar tanpa perhitungan, ia dapat bersaing dengan workload aplikasi.

Mental model:

```text
maintenance memory harus cukup untuk menjaga kesehatan database,
tetapi tidak boleh mencuri kapasitas dari workload kritikal secara tidak terkendali.
```

---

## 9. `temp_buffers`: Memory untuk Temporary Tables

`temp_buffers` mengatur maksimum memory per session untuk temporary table buffers.

Ini hanya relevan jika session memakai temporary tables.

Jebakan untuk Java app:

1. Jika temporary table dipakai dalam pooled connection, session state bisa bertahan selama connection hidup.
2. Transaction pooling PgBouncer tidak cocok dengan session-dependent temp table usage.
3. Temporary table dapat meningkatkan memory dan disk pressure jika tidak dikendalikan.
4. ORM jarang butuh temp table, tetapi reporting/custom SQL bisa menggunakannya.

Jika sistem memakai temp table untuk batch processing:

```text
Pastikan lifecycle temp table jelas.
Pastikan connection pooling mode kompatibel.
Pastikan concurrency batch tidak berlebihan.
Pastikan temp file/temp table I/O dipantau.
```

---

## 10. `wal_buffers`: Memory untuk WAL

`wal_buffers` adalah shared memory untuk data WAL sebelum ditulis ke disk.

Pada banyak deployment modern, default otomatis sudah cukup baik. Tuning manual biasanya jarang menjadi langkah pertama.

Yang lebih penting dipahami:

1. write-heavy workload menghasilkan WAL tinggi,
2. index tambahan meningkatkan WAL,
3. update row lebar meningkatkan WAL,
4. full-page writes dapat meningkatkan WAL setelah checkpoint,
5. replication dan archiving bergantung pada WAL,
6. disk untuk WAL harus cukup dan cepat.

Memory WAL bukan tempat utama tuning performa tulis. Biasanya lebih penting melihat:

1. checkpoint behavior,
2. WAL volume,
3. disk latency,
4. batching,
5. unnecessary indexes,
6. transaction size,
7. synchronous commit,
8. replication lag.

---

## 11. OS Page Cache: Partner PostgreSQL yang Sering Dilupakan

OS page cache menyimpan file data/index PostgreSQL di memory kernel. Saat PostgreSQL membaca page dari disk, OS mungkin sudah punya page tersebut di cache.

Jadi ada dua level cache:

```text
PostgreSQL shared_buffers
  ↓ miss
OS page cache
  ↓ miss
storage device
```

Beberapa page bisa ada di kedua cache. Ini bukan selalu buruk; ini bagian dari desain umum PostgreSQL.

Implikasi praktis:

1. Jangan memberi semua RAM ke `shared_buffers`.
2. Sisakan memory untuk OS cache.
3. Jangan ukur performa hanya dari cache hit ratio PostgreSQL.
4. Disk read rendah bisa terjadi karena OS cache, bukan hanya shared_buffers.
5. Setelah restart PostgreSQL, shared_buffers kosong tetapi OS cache mungkin masih hangat jika OS tidak restart.
6. Setelah host restart, semua cache dingin.

Cold cache vs warm cache adalah perbedaan penting dalam benchmark.

```text
Warm cache benchmark sering terlalu optimis.
Cold cache benchmark sering lebih mendekati recovery/failover reality.
```

---

## 12. Cache Hit Ratio: Berguna tetapi Sering Disalahgunakan

Query umum:

```sql
SELECT
  datname,
  blks_hit,
  blks_read,
  round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) AS cache_hit_pct
FROM pg_stat_database
WHERE datname IS NOT NULL
ORDER BY cache_hit_pct ASC;
```

Interpretasi hati-hati:

1. Cache hit tinggi bukan berarti query optimal.
2. Cache hit rendah bukan otomatis masalah jika workload memang scan data besar.
3. Cache hit bisa tinggi tetapi latency tetap buruk karena lock wait.
4. Cache hit bisa tinggi tetapi CPU bound.
5. Cache hit bisa tinggi tetapi query membaca terlalu banyak page.
6. Cache hit database-level terlalu agregat untuk diagnosis detail.

Cache hit ratio adalah sinyal awal, bukan kesimpulan.

Pertanyaan lanjutan:

1. Query mana yang membaca banyak buffer?
2. Apakah buffer hit atau read?
3. Apakah index scan membaca terlalu banyak random pages?
4. Apakah sequential scan memang tepat?
5. Apakah table/index bloat membuat page count membengkak?
6. Apakah data locality buruk?

Gunakan `EXPLAIN (ANALYZE, BUFFERS)` untuk query-level understanding.

---

## 13. `EXPLAIN (ANALYZE, BUFFERS)` untuk Memahami Memory dan I/O

Contoh:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Output bisa menunjukkan:

```text
Buffers: shared hit=1200 read=80 dirtied=3
```

Makna kasar:

1. `shared hit`: page ditemukan di shared_buffers.
2. `shared read`: page harus dibaca ke shared_buffers.
3. `dirtied`: page dibuat dirty oleh query.
4. `written`: page ditulis selama operasi.

Untuk sort, PostgreSQL bisa menampilkan:

```text
Sort Method: quicksort  Memory: 2048kB
```

atau:

```text
Sort Method: external merge  Disk: 512000kB
```

Interpretasi:

```text
quicksort Memory = sort cukup di memory
external merge Disk = sort spill ke disk
```

Ini jauh lebih kuat daripada menebak dari konfigurasi.

---

## 14. Memory Multiplication Problem

Ini inti bagian ini.

Memory PostgreSQL tidak boleh dihitung seperti ini:

```text
shared_buffers + work_mem + maintenance_work_mem
```

Itu salah.

Lebih realistis:

```text
Total memory risk ≈
  shared_buffers
+ wal_buffers
+ fixed shared memory overhead
+ active_connections × backend_base_memory
+ active_queries × memory_nodes_per_query × work_mem
+ parallel_workers × memory_nodes_per_worker × work_mem
+ maintenance_workers × maintenance_work_mem/autovacuum_work_mem
+ temp_buffers_sessions × temp_buffers
+ OS cache target
+ background processes
+ safety margin
```

Tentu ini bukan rumus presisi. Ini model risiko.

Contoh skenario:

```text
RAM host/container: 32GB
shared_buffers: 8GB
max_connections: 200
Hikari total across services: 160
work_mem: 64MB
maintenance_work_mem: 1GB
autovacuum_max_workers: 3
```

Jika 50 connection aktif menjalankan query dengan 2 memory-heavy nodes:

```text
50 × 2 × 64MB = 6.4GB
```

Jika ada parallelism x 2:

```text
bisa mendekati 12GB+
```

Tambahkan:

```text
shared_buffers 8GB
maintenance/autovacuum beberapa GB
OS cache beberapa GB
backend overhead
```

32GB bisa cepat habis.

Masalahnya tidak muncul saat traffic normal. Masalah muncul saat:

1. traffic spike,
2. deploy menyebabkan query plan berubah,
3. statistics stale,
4. batch job berjalan bersamaan,
5. report besar dijalankan,
6. autovacuum aktif,
7. index build berjalan,
8. failover membuat cache dingin,
9. pool reconnect storm terjadi.

---

## 15. Connection Pool Java sebagai Memory Governor

HikariCP bukan hanya tool untuk menghindari connection creation overhead. Ia adalah governor concurrency database.

Jika pool terlalu besar:

```text
lebih banyak query bisa masuk database bersamaan
  ↓
lebih banyak backend process aktif
  ↓
lebih banyak work_mem operation aktif
  ↓
lebih banyak lock contention
  ↓
lebih banyak context switching
  ↓
latency naik
  ↓
timeout/retry naik
  ↓
traffic efektif makin buruk
```

Ini mirip thread pool terlalu besar di Java.

Rule mental:

```text
Pool size harus mengikuti kapasitas database, bukan jumlah request maksimum aplikasi.
```

Database bukan request queue. Aplikasi harus melakukan backpressure.

Desain lebih baik:

```text
HTTP request
  ↓
app concurrency limit
  ↓
Hikari pool bounded
  ↓
PostgreSQL active query bounded
  ↓
latency stabil
```

Desain buruk:

```text
HTTP request spike
  ↓
thread banyak
  ↓
connection pool besar
  ↓
PostgreSQL overload
  ↓
semua query lambat
  ↓
retry storm
  ↓
incident
```

---

## 16. Pool Sizing dan Memory: Cara Berpikir Praktis

Tidak ada angka universal.

Tetapi cara berpikirnya:

1. Berapa core database?
2. Apakah workload CPU-bound atau I/O-bound?
3. Berapa query aktif yang benar-benar bisa berjalan produktif?
4. Berapa query yang memory-heavy?
5. Berapa `work_mem` per operation?
6. Berapa banyak service instance?
7. Apakah semua instance punya pool sendiri?
8. Apakah ada batch/reporting worker?
9. Apakah read replica dipakai?
10. Apakah PgBouncer dipakai?

Kesalahan umum:

```text
service replicas = 20
Hikari maximumPoolSize = 20
```

Total potensi koneksi:

```text
20 × 20 = 400 connections
```

Jika setiap connection hanya idle, mungkin masih terlihat aman.
Jika traffic spike membuat banyak connection aktif, PostgreSQL bisa overload.

Top-tier engineer menghitung **total fleet concurrency**, bukan hanya satu service instance.

```text
Total DB concurrency = sum(pool size semua instance semua service yang menuju DB yang sama)
```

---

## 17. Query Memory Shape: Tidak Semua Query Sama

Dua query bisa sama-sama “1 query”, tetapi memory impact sangat berbeda.

Query A:

```sql
SELECT *
FROM users
WHERE id = ?;
```

Biasanya:

```text
index lookup
sedikit page
sedikit memory
latency rendah
```

Query B:

```sql
SELECT tenant_id, status, count(*)
FROM enforcement_case
WHERE created_at >= now() - interval '1 year'
GROUP BY tenant_id, status
ORDER BY count(*) DESC;
```

Bisa melibatkan:

```text
large scan
hash aggregate
sort
temp file
parallel workers
high CPU
high memory
```

Query C:

```sql
SELECT *
FROM audit_event
ORDER BY created_at DESC
OFFSET 500000 LIMIT 50;
```

Bisa melibatkan:

```text
large index walk atau sort
banyak page dibaca
memory/disk pressure
latency buruk
```

Maka pool untuk OLTP request kecil dan pool untuk reporting/batch sebaiknya dipisahkan.

Contoh boundary:

```text
API pool:       20 connections, strict timeout
Batch pool:      4 connections, longer timeout
Reporting pool:  4 connections, read replica preferred
```

Tujuannya bukan sekadar fairness. Tujuannya mencegah query berat memakan memory/concurrency query kritikal.

---

## 18. Parallel Query dan Memory

PostgreSQL dapat memakai parallel workers untuk query tertentu.

Parallelism bisa mempercepat query besar, tetapi juga dapat menggandakan penggunaan memory.

Jika query memakai:

```text
Gather
  Parallel Hash Join
  Parallel Seq Scan
  Sort
```

Maka beberapa operasi terjadi di worker process. Masing-masing worker dapat memakai memory sendiri.

Konfigurasi terkait:

```conf
max_worker_processes
max_parallel_workers
max_parallel_workers_per_gather
```

Dari sisi memory:

```text
parallelism = speed potential + memory multiplication + CPU contention potential
```

Untuk OLTP latency-sensitive, parallel query tidak selalu menguntungkan. Untuk analytics/reporting, parallel query bisa sangat berguna.

Jangan aktifkan atau naikkan parallelism tanpa melihat:

1. CPU utilization,
2. query plan,
3. memory spill,
4. concurrency,
5. workload class,
6. replica vs primary.

---

## 19. Hash Operations dan `hash_mem_multiplier`

PostgreSQL memiliki parameter `hash_mem_multiplier` yang memengaruhi batas memory untuk hash-based operations relatif terhadap `work_mem`.

Artinya beberapa hash operation bisa memakai lebih dari `work_mem` dasar.

Ini penting untuk:

1. hash join,
2. hash aggregate,
3. hash-based query plans.

Jika hash operation terlalu kecil memory-nya, ia bisa batch/spill ke disk. Jika terlalu besar dan concurrency tinggi, memory risk meningkat.

Mental model:

```text
Hash plan bagus jika hash table cukup muat di memory.
Hash plan bisa buruk jika estimasi row salah dan hash spill besar.
```

Ketika melihat query lambat dengan hash node, periksa:

```sql
EXPLAIN (ANALYZE, BUFFERS)
...
```

Cari indikator seperti:

```text
Buckets
Batches
Memory Usage
Disk Usage
```

Jika `Batches` lebih dari 1, hash operation mungkin tidak cukup memory atau estimasi meleset.

---

## 20. JIT dan Memory/CPU Trade-off

PostgreSQL mendukung JIT compilation untuk beberapa query. JIT dapat membantu query kompleks dan berat, tetapi bisa menambah overhead untuk query kecil.

Dari sudut pandang memory dan latency:

1. JIT bukan fokus tuning pertama.
2. JIT overhead bisa terlihat di `EXPLAIN ANALYZE`.
3. OLTP kecil sering tidak butuh JIT.
4. Analytical query besar mungkin diuntungkan.

Jika query latency-sensitive tiba-tiba punya planning/execution overhead tinggi, cek apakah JIT muncul dalam plan.

Namun jangan langsung mematikan JIT global tanpa workload analysis.

---

## 21. Dirty Buffers, Background Writer, dan Checkpoint Interaction

Ketika query mengubah data, PostgreSQL mengubah page di shared_buffers. Page itu menjadi dirty.

Dirty page akhirnya harus ditulis ke disk.

Aktor yang terlibat:

1. backend process,
2. background writer,
3. checkpointer,
4. WAL writer,
5. OS flush.

`shared_buffers` yang besar berarti lebih banyak page bisa berada di cache, tetapi juga bisa berarti lebih banyak dirty page perlu dikelola.

Checkpoint memaksa semua dirty page yang perlu masuk checkpoint untuk ditulis. Jika checkpoint terlalu agresif atau I/O tidak cukup, latency bisa terganggu.

Gejala:

```text
write latency spike
checkpoint spikes
backend writes meningkat
I/O saturation
WAL volume tinggi
```

Memory tidak bisa dipisahkan dari WAL/checkpoint. Banyak tuning memory yang terlihat seperti masalah cache ternyata akar masalahnya write path.

---

## 22. Container dan Kubernetes: Memory Limit Mengubah Permainan

Jika PostgreSQL berjalan dalam container, memory limit harus diperlakukan sebagai batas keras.

Masalah umum:

```text
Host punya RAM 128GB
Container limit PostgreSQL 16GB
shared_buffers diset berdasarkan host, bukan container
```

Akibat:

```text
PostgreSQL + OS cache + backend memory > container limit
  ↓
OOM kill
  ↓
database crash
  ↓
crash recovery
  ↓
possible downtime
```

Dalam Kubernetes, OS page cache tetap dihitung terhadap memory cgroup pada banyak konfigurasi modern. Jadi “biarkan OS cache pakai sisanya” tetap harus dihitung terhadap limit container.

Prinsip:

```text
Tune berdasarkan memory limit efektif, bukan RAM fisik node jika berjalan di container.
```

Tambahkan safety margin.

```text
usable_memory_for_postgres < container_limit
```

Karena masih ada:

1. process overhead,
2. allocator fragmentation,
3. kernel/cgroup accounting,
4. monitoring agent,
5. extension memory,
6. transient spikes.

---

## 23. Huge Pages

PostgreSQL dapat memanfaatkan huge pages untuk shared memory pada sistem tertentu.

Potensi manfaat:

1. mengurangi overhead page table,
2. memperbaiki TLB behavior,
3. lebih berguna untuk shared_buffers besar.

Namun huge pages adalah tuning OS-level. Ia perlu konfigurasi benar.

Kesalahan konfigurasi bisa membuat PostgreSQL gagal start atau tidak memakai huge pages.

Prinsip:

```text
Huge pages adalah optimization setelah sizing dasar benar.
Bukan pengganti query tuning, index tuning, atau pool sizing.
```

Untuk sebagian managed database, kontrol huge pages mungkin tidak tersedia langsung.

---

## 24. NUMA Consideration

Pada host besar multi-socket, NUMA bisa memengaruhi memory latency.

PostgreSQL workload yang sangat besar bisa terpengaruh oleh:

1. memory locality,
2. CPU socket locality,
3. OS scheduler,
4. shared memory access pattern.

Namun untuk banyak deployment aplikasi biasa, NUMA bukan tuning pertama.

Prioritas tuning tetap:

1. query plan,
2. index,
3. pool sizing,
4. memory parameter utama,
5. I/O,
6. vacuum,
7. checkpoint,
8. observability.

NUMA baru relevan saat kamu mengoperasikan PostgreSQL pada mesin besar dengan throughput tinggi dan gejala tidak bisa dijelaskan oleh faktor umum.

---

## 25. Memory Leak vs Memory Growth Normal

PostgreSQL process memory bisa terlihat tumbuh.

Tidak semua pertumbuhan adalah leak.

Kemungkinan:

1. backend session menyimpan prepared statement/cache,
2. query execution membutuhkan memory sementara,
3. extension menggunakan memory,
4. allocator tidak langsung mengembalikan memory ke OS,
5. long-lived backend process mempertahankan memory context,
6. temp table/session state,
7. logical replication worker.

Di Java, kita terbiasa melihat heap usage dan GC. Di PostgreSQL, memory context dikelola internal dan per process. Backend process yang selesai disconnect akan hilang bersama memory-nya.

Karena itu connection pooling membuat backend bisa hidup lama, sehingga memory/session state bisa bertahan lebih lama.

Jika memory backend tertentu abnormal:

1. cari PID,
2. cek `pg_stat_activity`,
3. cek query aktif,
4. cek state idle in transaction,
5. cek temp file,
6. cek prepared statements/session behavior,
7. pertimbangkan connection lifetime di pool.

Hikari punya parameter seperti max lifetime untuk recycle connection. Namun recycle bukan solusi utama jika akar masalahnya query atau session state misuse.

---

## 26. Statement Timeout, Memory, dan Backpressure

Memory incident sering diperburuk oleh query yang dibiarkan berjalan terlalu lama.

Parameter penting:

```conf
statement_timeout
lock_timeout
idle_in_transaction_session_timeout
```

Dari sisi memory:

1. query lama menahan memory lebih lama,
2. query lama menahan snapshot lebih lama,
3. query lama bisa membuat temp file besar,
4. query lama bisa menahan lock,
5. query lama bisa menghambat vacuum.

Java service sebaiknya punya timeout layering:

```text
client timeout
  > application timeout
    > JDBC query timeout / statement_timeout
      > lock_timeout for lock-sensitive operation
```

Jangan biarkan database query tetap berjalan setelah request client sudah timeout.

Jika request HTTP timeout 2 detik tetapi query masih berjalan 60 detik, database tetap menerima beban walaupun user tidak lagi menunggu.

---

## 27. Memory dan ORM: Hibernate/JPA Pitfalls

Hibernate bisa memperbesar dampak memory PostgreSQL secara tidak langsung.

Contoh:

1. query fetch terlalu banyak row,
2. pagination offset besar,
3. eager fetch menghasilkan join besar,
4. N+1 query menyebabkan connection aktif lama,
5. flush otomatis terjadi pada waktu tidak terduga,
6. transaction terlalu luas,
7. batch size tidak dikendalikan,
8. streaming result tidak dipakai untuk dataset besar,
9. query generated tidak sesuai index.

Dari sisi PostgreSQL, ORM tidak terlihat sebagai ORM. PostgreSQL hanya melihat SQL.

Maka untuk query Hibernate yang lambat:

1. ambil SQL final,
2. jalankan `EXPLAIN (ANALYZE, BUFFERS)`,
3. cek sort/hash spill,
4. cek row count actual vs estimate,
5. cek index usage,
6. cek jumlah query per request,
7. cek transaction duration,
8. cek connection hold time.

Jangan tuning `work_mem` untuk menutupi query ORM yang mengambil 500 ribu row ke aplikasi.

---

## 28. Streaming Result Set dan Fetch Size di JDBC

Untuk result set besar, Java app dapat mengalami memory issue di sisi aplikasi dan database.

PostgreSQL JDBC behavior perlu dipahami:

1. fetch size default dapat menyebabkan banyak data dibaca sekaligus tergantung mode,
2. server-side cursor membutuhkan transaction terbuka,
3. transaction yang lama menahan snapshot,
4. snapshot lama dapat menghambat vacuum,
5. streaming besar bisa memperpanjang connection hold time.

Jadi streaming result bukan solusi gratis.

Desain yang lebih baik:

1. gunakan keyset pagination untuk online API,
2. gunakan batch window untuk background job,
3. gunakan read replica untuk export/reporting,
4. batasi fetch size,
5. batasi transaction duration,
6. hindari export besar dari primary OLTP saat jam sibuk.

Mental model:

```text
Streaming mengurangi memory aplikasi,
tetapi dapat memperpanjang umur transaction dan connection.
```

---

## 29. Memory untuk Sorting: Index Bisa Menghapus Kebutuhan Sort

Jika query sering melakukan:

```sql
ORDER BY created_at DESC
LIMIT 50
```

Tanpa index yang sesuai, PostgreSQL mungkin harus sort banyak row.

Dengan index:

```sql
CREATE INDEX idx_case_status_created_at
ON enforcement_case (status, created_at DESC);
```

Query:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

bisa berjalan sebagai index scan yang sudah ordered, tanpa sort besar.

Jadi solusi memory spill tidak selalu:

```text
naikkan work_mem
```

Sering kali solusi lebih tepat:

```text
ubah access path agar sort besar tidak diperlukan
```

Pertanyaan penting:

1. Apakah query perlu sort semua row?
2. Apakah index bisa menyediakan order?
3. Apakah LIMIT bisa dipush lebih awal?
4. Apakah predicate cukup selective?
5. Apakah partial index bisa membantu?
6. Apakah keyset pagination bisa mengganti offset?

---

## 30. Memory untuk Hash Join: Index dan Join Order Bisa Lebih Penting

Hash join membutuhkan memory untuk membangun hash table dari salah satu sisi join.

Jika planner salah memperkirakan cardinality, sisi hash bisa jauh lebih besar dari perkiraan.

Contoh:

```sql
SELECT c.id, e.event_type
FROM enforcement_case c
JOIN audit_event e ON e.case_id = c.id
WHERE c.tenant_id = ?
  AND e.created_at >= now() - interval '30 days';
```

Jika statistik tidak memahami korelasi tenant dan created_at, planner bisa salah memilih join order.

Dampaknya:

1. hash table terlalu besar,
2. spill ke disk,
3. temp file besar,
4. latency naik,
5. memory pressure meningkat.

Solusi potensial:

1. index yang sesuai,
2. extended statistics,
3. query rewrite,
4. partitioning,
5. filter lebih awal,
6. memperbarui statistics,
7. menaikkan work_mem khusus untuk query tertentu.

Khusus query tertentu, kamu bisa memakai:

```sql
SET LOCAL work_mem = '256MB';
```

Di dalam transaction untuk operasi tertentu.

Ini lebih aman daripada menaikkan global `work_mem`.

---

## 31. `SET LOCAL work_mem`: Tuning Spesifik, Bukan Global

Jika ada query batch/reporting tertentu yang butuh memory lebih besar, pendekatan aman:

```sql
BEGIN;
SET LOCAL work_mem = '256MB';

-- query berat terkontrol di sini
SELECT ...;

COMMIT;
```

`SET LOCAL` berlaku hanya sampai akhir transaction.

Namun di aplikasi Java, hati-hati:

1. Pastikan connection dikembalikan ke pool dalam state bersih.
2. Gunakan transaction boundary eksplisit.
3. Jangan pakai `SET` biasa tanpa reset pada pooled connection.
4. Pastikan PgBouncer mode kompatibel.
5. Batasi concurrency query berat tersebut.

Pattern yang lebih aman:

```text
Dedicated reporting job
  ↓
small pool
  ↓
SET LOCAL work_mem higher
  ↓
read replica if possible
  ↓
strict timeout
```

Bukan:

```text
Naikkan work_mem global karena satu report lambat
```

---

## 32. Memory dan Vacuum

Vacuum berhubungan dengan memory melalui beberapa cara:

1. vacuum memakai maintenance memory,
2. vacuum membaca banyak page,
3. vacuum memengaruhi visibility map,
4. vacuum membantu index-only scan,
5. vacuum membersihkan dead tuple sehingga mengurangi page yang perlu dibaca,
6. vacuum yang tertunda menyebabkan bloat,
7. bloat membuat cache kurang efektif.

Jika table bloat:

```text
jumlah page meningkat
  ↓
lebih banyak shared_buffers/OS cache dipakai untuk data mati
  ↓
cache hit terlihat tinggi tetapi useful data density rendah
  ↓
query membaca lebih banyak page
  ↓
latency naik
```

Maka memory tuning tanpa vacuum health sering menipu.

Jika cache penuh dengan page bloat, menambah cache hanya menyimpan lebih banyak sampah.

---

## 33. Memory dan Index Bloat

Index bloat juga memengaruhi memory.

Index lookup yang seharusnya kecil bisa membaca lebih banyak page karena index membengkak.

Dampak:

1. shared_buffers terisi index page tidak efisien,
2. OS cache pressure naik,
3. random I/O naik,
4. index-only scan kurang efektif,
5. update/insert lebih mahal,
6. WAL volume naik.

Gejala:

```text
index size jauh lebih besar dari ekspektasi
query index scan tetap lambat
buffers read/hit tinggi
write amplification tinggi
```

Solusi bisa berupa:

1. memperbaiki autovacuum,
2. `REINDEX CONCURRENTLY`,
3. drop index tidak terpakai,
4. mengubah fillfactor,
5. mengubah update pattern,
6. menghindari index berlebihan.

---

## 34. Memory dan Read Replica

Read replica sering dipakai untuk query berat. Tetapi replica juga punya memory sendiri.

Kesalahan umum:

```text
Primary dituning baik.
Replica diberi ukuran kecil.
Reporting query besar diarahkan ke replica.
Replica spill/temp file tinggi.
Replication replay terganggu.
Lag naik.
Aplikasi membaca data stale.
```

Read replica bukan tempat membuang query buruk tanpa konsekuensi.

Replica perlu sizing berdasarkan workload baca yang diarahkan ke sana.

Pertanyaan:

1. Apakah replica untuk HA atau reporting?
2. Apakah query reporting memory-heavy?
3. Apakah replica punya cukup I/O untuk temp files?
4. Apakah replication lag dipantau?
5. Apakah stale read acceptable?
6. Apakah query reporting perlu timeout berbeda?

---

## 35. Memory dan Multi-tenant Workload

Pada sistem multi-tenant, distribusi data sering skewed.

Contoh:

```text
tenant kecil: 10 ribu row
tenant besar: 200 juta row
```

Query yang sama:

```sql
SELECT status, count(*)
FROM enforcement_case
WHERE tenant_id = ?
GROUP BY status;
```

Bisa sangat ringan untuk tenant kecil dan sangat berat untuk tenant besar.

Jika planner memakai generic plan untuk prepared statement, plan mungkin tidak optimal untuk semua tenant.

Dampak memory:

1. tenant besar memicu hash/sort besar,
2. temp file spike hanya pada tenant tertentu,
3. pool habis saat tenant besar menjalankan report,
4. query kecil tenant lain ikut terdampak.

Mitigasi:

1. per-tenant query budget,
2. query timeout per workload,
3. partial/tenant-aware index jika masuk akal,
4. partitioning jika benar-benar dibutuhkan,
5. prepared statement plan behavior dipahami,
6. report tenant besar dipindah ke async job,
7. concurrency limit per tenant.

---

## 36. Observability: Apa yang Harus Dipantau

Untuk memory dan I/O PostgreSQL, pantau minimal:

### Database-level

```sql
SELECT
  datname,
  blks_read,
  blks_hit,
  temp_files,
  temp_bytes,
  deadlocks
FROM pg_stat_database
ORDER BY temp_bytes DESC;
```

### Activity

```sql
SELECT
  pid,
  usename,
  application_name,
  state,
  wait_event_type,
  wait_event,
  now() - query_start AS query_age,
  left(query, 200) AS query_sample
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY query_age DESC;
```

### Long transactions

```sql
SELECT
  pid,
  usename,
  application_name,
  state,
  now() - xact_start AS xact_age,
  left(query, 200) AS query_sample
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_age DESC;
```

### Temp-heavy queries via logs / `pg_stat_statements`

Jika `pg_stat_statements` tersedia, lihat query dengan waktu tinggi, call tinggi, atau block/temp behavior sesuai kolom versi yang tersedia.

### Table/index level

```sql
SELECT
  relname,
  heap_blks_read,
  heap_blks_hit,
  idx_blks_read,
  idx_blks_hit,
  toast_blks_read,
  toast_blks_hit
FROM pg_statio_user_tables
ORDER BY heap_blks_read + idx_blks_read DESC
LIMIT 20;
```

### Checkpoint/background writer

Pantau checkpoint dan writes untuk melihat apakah memory/cache/writeback menyebabkan latency spike.

---

## 37. Diagnosis Flow: Saat PostgreSQL Memory Terasa Bermasalah

Gejala:

```text
query lambat
CPU belum penuh
RAM tinggi
disk I/O tinggi
temp files meningkat
connection pool timeout
```

Diagnosis step-by-step:

### Step 1 — Apakah database benar-benar memory pressure?

Cek:

1. OS memory,
2. swap usage,
3. OOM log,
4. container memory limit,
5. process RSS,
6. disk I/O,
7. temp file volume.

### Step 2 — Apakah banyak temp file?

```sql
SELECT datname, temp_files, temp_bytes
FROM pg_stat_database
ORDER BY temp_bytes DESC;
```

Jika iya, cari query penyebab via log atau `pg_stat_statements`.

### Step 3 — Apakah query spill?

Jalankan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
...
```

Cari:

```text
Sort Method: external merge Disk
Hash Batches > 1
Temp Read/Write
```

### Step 4 — Apakah concurrency terlalu tinggi?

Cek:

```sql
SELECT state, count(*)
FROM pg_stat_activity
GROUP BY state;
```

Cek total pool dari semua service.

### Step 5 — Apakah plan buruk karena statistik?

Cari mismatch:

```text
estimated rows: 100
actual rows: 10,000,000
```

Jika ada, periksa `ANALYZE`, statistics target, extended stats.

### Step 6 — Apakah index bisa mengubah shape?

Jika sort besar, cari index yang bisa menyediakan order.
Jika hash besar, cari filter/join index yang mengurangi input.

### Step 7 — Apakah workload perlu dipisah?

Jika query berat legitimate:

1. pindah ke async job,
2. read replica,
3. dedicated small pool,
4. `SET LOCAL work_mem`,
5. precomputed summary/materialized view.

---

## 38. Anti-pattern Tuning Memory

### Anti-pattern 1 — Menaikkan `work_mem` global karena satu query lambat

Bahaya:

```text
satu query membaik
traffic puncak OOM
```

Lebih baik:

1. diagnose plan,
2. index/query rewrite,
3. `SET LOCAL work_mem`,
4. batasi concurrency query berat.

### Anti-pattern 2 — `max_connections` besar tanpa pooler

Bahaya:

```text
backend process banyak
memory overhead naik
context switching naik
work_mem concurrency risk naik
```

Lebih baik:

1. Hikari pool kecil,
2. PgBouncer jika perlu,
3. app-level backpressure.

### Anti-pattern 3 — Memberi semua RAM ke `shared_buffers`

Bahaya:

```text
OS cache kecil
query memory sempit
checkpoint pressure
OOM risk
```

Lebih baik:

1. shared_buffers cukup,
2. OS cache cukup,
3. workload-specific tuning.

### Anti-pattern 4 — Mengandalkan cache hit ratio saja

Bahaya:

```text
cache hit tinggi tetapi query tetap membaca terlalu banyak page
```

Lebih baik:

1. `EXPLAIN BUFFERS`,
2. bloat check,
3. query-level metrics.

### Anti-pattern 5 — Reporting query berjalan di pool OLTP

Bahaya:

```text
report besar memakan connection, memory, temp I/O
API latency ikut naik
```

Lebih baik:

1. separate pool,
2. read replica,
3. async job,
4. resource budget.

---

## 39. Practical Configuration Thinking

Parameter umum yang perlu dipahami:

```conf
shared_buffers
work_mem
maintenance_work_mem
autovacuum_work_mem
effective_cache_size
temp_buffers
wal_buffers
max_connections
max_worker_processes
max_parallel_workers
max_parallel_workers_per_gather
hash_mem_multiplier
```

Urutan berpikir:

```text
1. Tentukan memory limit efektif.
2. Sisihkan OS dan safety margin.
3. Tentukan shared_buffers.
4. Tentukan max_connections berdasarkan pool total.
5. Tentukan work_mem konservatif global.
6. Gunakan SET LOCAL untuk query berat tertentu.
7. Tentukan maintenance/autovacuum memory.
8. Pantau temp file dan plan.
9. Revisi berdasarkan workload nyata.
```

Jangan mulai dari copy-paste config internet.

---

## 40. Contoh Sizing Sederhana

Misal:

```text
PostgreSQL container memory limit: 32GB
Primary workload: OLTP Java services
Total desired active DB concurrency: 40-80
Reporting: dipisah ke replica
```

Pendekatan kasar:

```text
shared_buffers: 8GB
OS cache + free margin: signifikan
work_mem global: 8MB-32MB range awal, tergantung query
maintenance_work_mem: 512MB-1GB
max_connections: tidak jauh di atas total pool yang direncanakan
```

Ini bukan rekomendasi final universal. Ini contoh cara berpikir.

Jika query OLTP mostly indexed point/range lookup, `work_mem` besar tidak banyak membantu.
Jika query sering aggregate/sort besar, jangan langsung naikkan global `work_mem`; ubah workload boundary.

---

## 41. Case Study 1 — API Lambat Setelah Work Mem Dinaikkan

Situasi:

```text
Satu report lambat karena sort spill.
Engineer menaikkan work_mem dari 8MB ke 256MB global.
Saat traffic pagi, API timeout massal.
Database OOM/restart.
```

Analisis:

1. `work_mem` berlaku per operation.
2. Banyak API query juga memiliki sort/hash kecil.
3. Concurrency membuat memory naik drastis.
4. Report mungkin membaik, tetapi seluruh system risk naik.

Solusi lebih tepat:

1. Kembalikan `work_mem` global konservatif.
2. Identifikasi report query.
3. Tambahkan index agar sort tidak perlu, jika mungkin.
4. Jalankan report di worker pool kecil.
5. Gunakan `SET LOCAL work_mem` hanya untuk report.
6. Pindahkan ke read replica jika sesuai.
7. Tambahkan timeout dan concurrency limit.

---

## 42. Case Study 2 — Cache Hit 99%, tetapi Query Tetap Lambat

Situasi:

```text
cache hit ratio 99.5%
query list case lambat 2 detik
engineer bingung karena hampir semua hit
```

Analisis:

Cache hit tinggi hanya berarti page ditemukan di memory PostgreSQL, bukan berarti jumlah page sedikit.

Query bisa membaca:

```text
500,000 buffer hits
```

Walau semua dari memory, tetap mahal:

1. CPU untuk scan banyak tuple,
2. memory bandwidth,
3. executor overhead,
4. filter banyak row,
5. bloat.

Solusi:

1. `EXPLAIN (ANALYZE, BUFFERS)`.
2. Cek rows removed by filter.
3. Cek index order untuk pagination.
4. Ubah offset pagination ke keyset.
5. Tambahkan partial/composite index jika sesuai.
6. Cek bloat.

Lesson:

```text
Cache hit ratio tinggi bukan bukti query efisien.
```

---

## 43. Case Study 3 — Kubernetes OOM pada PostgreSQL

Situasi:

```text
PostgreSQL di Kubernetes
memory limit 16GB
shared_buffers 8GB
work_mem 64MB
max_connections 200
batch job berjalan malam
pod OOMKilled
```

Analisis:

Konfigurasi terlihat “masuk akal” jika hanya melihat shared_buffers. Tetapi upper bound memory tidak dihitung.

Batch job mungkin menjalankan banyak query sort/hash.

Masalah:

1. shared_buffers 8GB,
2. OS page cache ikut cgroup,
3. active backend memory,
4. work_mem multiplication,
5. autovacuum/maintenance,
6. temp file/cache pressure,
7. safety margin kurang.

Solusi:

1. Turunkan pool/concurrency batch.
2. Turunkan global `work_mem`.
3. Pakai `SET LOCAL` untuk batch tertentu.
4. Kurangi `max_connections`.
5. Gunakan PgBouncer bila banyak idle connection.
6. Tambah memory limit atau pindah workload.
7. Pantau temp file dan OOM events.

---

## 44. Case Study 4 — Read Replica Lag karena Reporting Query

Situasi:

```text
Read replica dipakai untuk report.
Report berjalan 20 menit.
Replica lag naik.
Aplikasi membaca data lama.
```

Kemungkinan penyebab:

1. report memakai CPU/memory/I/O besar,
2. temp file besar bersaing dengan WAL replay,
3. long query conflict dengan recovery/replay behavior,
4. replica under-sized,
5. query tidak dibatasi timeout.

Solusi:

1. Pisahkan HA replica dan reporting replica.
2. Beri resource cukup untuk reporting.
3. Batasi query concurrency.
4. Gunakan materialized summaries.
5. Pantau lag dan temp file.
6. Buat SLA stale read eksplisit.

Lesson:

```text
Replica bukan resource tak terbatas.
```

---

## 45. Checklist Memory Review untuk Java + PostgreSQL

Gunakan checklist ini saat review sistem.

### A. Host/container

- [ ] Berapa memory limit efektif PostgreSQL?
- [ ] Apakah PostgreSQL berjalan di container?
- [ ] Apakah OS page cache dihitung dalam limit?
- [ ] Apakah swap aktif?
- [ ] Apakah pernah ada OOM kill?

### B. Shared memory

- [ ] Berapa `shared_buffers`?
- [ ] Apakah masih ada ruang untuk OS cache?
- [ ] Apakah checkpoint/write behavior sehat?

### C. Query memory

- [ ] Berapa `work_mem`?
- [ ] Apakah global `work_mem` konservatif?
- [ ] Apakah ada query spill ke disk?
- [ ] Apakah ada `SET LOCAL work_mem` untuk job berat?
- [ ] Apakah reporting query dipisah?

### D. Maintenance

- [ ] Berapa `maintenance_work_mem`?
- [ ] Berapa `autovacuum_work_mem`?
- [ ] Berapa `autovacuum_max_workers`?
- [ ] Apakah vacuum mengganggu workload atau justru kurang agresif?

### E. Pooling

- [ ] Berapa Hikari max pool per instance?
- [ ] Berapa jumlah instance?
- [ ] Berapa total pool semua service?
- [ ] Apakah batch/reporting punya pool terpisah?
- [ ] Apakah PgBouncer dipakai?

### F. Observability

- [ ] Apakah `pg_stat_statements` aktif?
- [ ] Apakah `log_temp_files` diset?
- [ ] Apakah slow query log aktif?
- [ ] Apakah dashboard punya temp bytes, cache hit, active connection, wait events?
- [ ] Apakah query berat bisa dihubungkan ke service/endpoint?

---

## 46. Mental Model Final

Memory PostgreSQL bukan satu knob.

Model final:

```text
shared_buffers
  = cache internal PostgreSQL

OS page cache
  = cache filesystem yang tetap penting

effective_cache_size
  = asumsi planner, bukan alokasi

work_mem
  = memory per operation per backend/worker

maintenance_work_mem
  = memory untuk maintenance operation

temp_buffers
  = memory per session untuk temp tables

pool size
  = governor concurrency memory database

query plan
  = penentu berapa banyak operator memory-heavy aktif

vacuum/bloat
  = penentu seberapa efisien cache menyimpan data berguna
```

Prinsip besar:

```text
Jangan tuning memory PostgreSQL secara terpisah dari query plan, pool size, workload class, dan failure model.
```

Top-tier PostgreSQL engineer tidak bertanya:

```text
Berapa shared_buffers terbaik?
```

Mereka bertanya:

```text
Apa workload-nya?
Berapa concurrency efektif?
Query mana yang sort/hash besar?
Apakah temp file meningkat?
Apakah index bisa mengubah query shape?
Apakah pool Java membatasi database dengan benar?
Apakah memory limit container realistis?
Apakah vacuum menjaga data density?
Apa yang terjadi saat spike, failover, batch, dan cold cache?
```

---

## 47. Latihan Praktis

### Latihan 1 — Hitung Memory Risk Kasar

Ambil konfigurasi hipotetis:

```text
RAM/container: 32GB
shared_buffers: 8GB
work_mem: 64MB
max_connections: 200
active query peak: 60
memory-heavy nodes/query: 2
parallel workers/query: 2 untuk sebagian query
maintenance_work_mem: 1GB
autovacuum workers: 3
```

Hitung skenario risiko memory.

Pertanyaan:

1. Apakah konfigurasi aman?
2. Apa yang terjadi jika 30 query memakai 2 sort/hash node?
3. Apa yang terjadi jika parallelism aktif?
4. Apa yang harus diturunkan lebih dulu?
5. Apa yang harus dipisahkan dari workload OLTP?

### Latihan 2 — Diagnosis Temp File

Jalankan query:

```sql
SELECT datname, temp_files, temp_bytes
FROM pg_stat_database
ORDER BY temp_bytes DESC;
```

Lalu jawab:

1. Database mana yang menghasilkan temp file terbesar?
2. Apakah temp file meningkat dari waktu ke waktu?
3. Query mana penyebabnya?
4. Apakah sort/hash spill bisa dihindari dengan index?
5. Apakah query tersebut seharusnya online API atau background job?

### Latihan 3 — Explain Buffers

Ambil satu query lambat dan jalankan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
...
```

Cari:

1. shared hit,
2. shared read,
3. temp read/write,
4. sort method,
5. hash batches,
6. estimated vs actual rows.

Tulis diagnosis:

```text
Masalah utama query ini adalah ...
Bukti dari plan adalah ...
Solusi yang lebih tepat daripada menaikkan work_mem adalah ...
```

### Latihan 4 — Review Hikari Pool

Untuk setiap service Java:

```text
service name
replica count
maximumPoolSize
minimumIdle
peak active connections
timeout
query class
```

Hitung:

```text
total possible DB connections
```

Lalu tentukan:

1. Apakah total pool masuk akal?
2. Apakah semua service perlu pool sebesar itu?
3. Apakah batch/reporting terpisah?
4. Apakah database punya memory untuk concurrency itu?

---

## 48. Ringkasan

Bagian ini membahas PostgreSQL memory sebagai sistem yang dinamis, bukan sekadar parameter konfigurasi.

Hal terpenting:

1. `shared_buffers` adalah cache internal PostgreSQL, tetapi OS cache tetap penting.
2. `effective_cache_size` adalah asumsi planner, bukan alokasi memory.
3. `work_mem` berlaku per operation, bukan per query.
4. Query dengan banyak sort/hash node dapat menggandakan memory usage.
5. Parallel worker dapat menggandakan memory usage lagi.
6. `maintenance_work_mem` dan `autovacuum_work_mem` perlu dihitung bersama maintenance concurrency.
7. Temp file adalah sinyal penting untuk sort/hash spill atau plan buruk.
8. Cache hit ratio tinggi tidak membuktikan query efisien.
9. Java connection pool adalah governor concurrency PostgreSQL.
10. Container memory limit harus menjadi basis tuning, bukan RAM fisik host.
11. Memory tuning harus dilakukan bersama query plan, index design, workload separation, vacuum health, dan failure modelling.

---

## 49. Apa yang Akan Dibahas Berikutnya

Part berikutnya:

```text
Part 008 — Query Lifecycle: Parse, Rewrite, Plan, Execute
```

Kita akan membahas perjalanan query dari SQL text sampai eksekusi:

1. parser,
2. analyzer,
3. rewriter,
4. planner,
5. executor,
6. custom plan vs generic plan,
7. prepared statement,
8. parameter-sensitive plan,
9. implikasi JDBC dan Hibernate.

Ini akan menyambungkan memory model dengan planner behavior.

---

## Status Seri

```text
Seri: learn-postgresql-mastery-for-java-engineers
Selesai sampai: Part 007 / 034
Status: BELUM SELESAI
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — WAL, Durability, Checkpoint, dan Crash Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-008.md">Part 008 — Query Lifecycle: Parse, Rewrite, Plan, Execute ➡️</a>
</div>

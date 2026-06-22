# learn-mysql-mastery-for-java-engineers-part-018.md

# Part 018 — Buffer Pool, Memory, and I/O Behavior

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `018 / 034`  
> Topik: Buffer Pool, Memory, and I/O Behavior  
> Baseline: MySQL 8.4 LTS, InnoDB, Java production systems

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya, kita membahas **write path internals**: redo log, undo log, binlog, doublewrite, checkpoint, group commit, dan crash recovery. Bagian itu menjelaskan bagaimana perubahan data menjadi durable.

Bagian ini menjawab pertanyaan lanjutannya:

> Setelah data ada di disk, bagaimana MySQL membuat akses data tetap cepat, stabil, dan predictable di bawah workload nyata?

Jawabannya tidak cukup dengan kalimat “pakai index”. Index hanya menentukan **jalur pencarian logis**. Performa nyata MySQL sangat dipengaruhi oleh:

- apakah page yang dibutuhkan sudah ada di memory,
- apakah MySQL harus membaca dari disk,
- apakah dirty page terlalu banyak,
- apakah flushing mengejar workload,
- apakah connection terlalu banyak menghabiskan memory,
- apakah temporary table pindah ke disk,
- apakah query membuat buffer per-session besar,
- apakah Java connection pool memberi tekanan yang masuk akal atau justru memperparah overload.

Bagian ini membangun mental model bahwa MySQL/InnoDB bukan hanya SQL executor, tetapi juga **memory manager + page cache + I/O scheduler + concurrency boundary**.

Setelah menyelesaikan bagian ini, kamu diharapkan bisa:

1. Menjelaskan fungsi InnoDB buffer pool secara fisik.
2. Membedakan data page, index page, dirty page, free page, dan flushed page.
3. Memahami working set dan kenapa ukuran buffer pool sangat menentukan performa.
4. Menjelaskan bagaimana read path dan write path memakai buffer pool.
5. Memahami dirty page flushing, checkpoint pressure, dan I/O capacity.
6. Mengenali perbedaan memory global vs per-connection.
7. Menjelaskan kenapa terlalu banyak koneksi Java dapat merusak performa MySQL.
8. Menentukan prinsip awal sizing buffer pool, connection pool, temporary memory, dan I/O.
9. Membaca sinyal observability terkait memory dan I/O.
10. Menghubungkan keputusan aplikasi Java dengan perilaku memory/I/O MySQL.

---

## 1. Mental Model Utama

Kalau harus diringkas:

> InnoDB tidak bekerja langsung terhadap row di disk. InnoDB bekerja terhadap page di memory. Disk adalah backing store; buffer pool adalah medan kerja utama.

Ini penting.

Ketika kamu menjalankan:

```sql
SELECT *
FROM cases
WHERE case_id = 12345;
```

Secara konseptual kamu berpikir:

> “Ambil row dengan case_id 12345.”

Tapi secara fisik InnoDB berpikir:

> “Cari B+Tree page yang memuat key 12345. Kalau page belum ada di buffer pool, baca page dari disk. Setelah page ada di memory, cari record di dalam page.”

Ketika kamu menjalankan:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE case_id = 12345;
```

Secara konseptual kamu berpikir:

> “Ubah status case.”

Tapi secara fisik InnoDB berpikir:

> “Pastikan page yang memuat record ada di buffer pool. Ubah record di memory. Buat undo untuk rollback/MVCC. Tulis redo untuk crash recovery. Tandai page sebagai dirty. Commit bisa selesai sebelum page data benar-benar ditulis ke tablespace.”

Jadi ada pemisahan:

| Layer | Yang Dilihat Developer | Yang Dilihat InnoDB |
|---|---|---|
| SQL | row, table, index | access path, iterator, condition |
| InnoDB memory | data/index page | buffer frame, dirty page, LRU |
| Disk | `.ibd`, redo, undo | persistent page image, log stream |
| Java app | repository/service transaction | sessions, connections, transactions, locks |

Kesalahan umum engineer adalah menganggap performa MySQL hanya ditentukan oleh SQL. Padahal query yang sama bisa cepat atau lambat tergantung apakah page yang dibutuhkan ada di buffer pool.

---

## 2. Buffer Pool: Apa Sebenarnya yang Dicache?

InnoDB buffer pool adalah area memory utama tempat InnoDB menyimpan page table dan index yang sedang atau sering diakses.

Yang dicache bukan “object Java”, bukan “result set”, dan bukan “row individual” sebagai unit utama. Unit kerja utamanya adalah **page**.

Secara umum:

- InnoDB page default: 16KB.
- Page berisi record, index node, metadata, atau struktur internal lain.
- B+Tree index terdiri dari banyak page.
- Table InnoDB secara fisik adalah clustered index.
- Secondary index juga tersusun dari page.

Ketika satu row dibaca, InnoDB biasanya harus membawa satu page penuh ke memory.

Artinya:

```text
Read 1 row != read only that row
Read 1 row ~= ensure containing page is in buffer pool
```

Kalau page berisi banyak row kecil, satu read dapat membawa banyak row yang mungkin nanti ikut berguna. Kalau row sangat besar, page memuat lebih sedikit record, locality turun, dan cache efficiency memburuk.

---

## 3. Buffer Pool sebagai Cache dan Workspace

Buffer pool punya dua peran sekaligus:

1. **Cache untuk read**
2. **Workspace untuk write**

Untuk read:

```text
Query needs page
  -> if page in buffer pool: memory access
  -> if not: disk read, then page loaded into buffer pool
```

Untuk write:

```text
UPDATE/INSERT/DELETE
  -> modify page in buffer pool
  -> generate redo/undo
  -> mark page dirty
  -> flush dirty page later
```

Ini menghasilkan konsekuensi penting:

> Commit transaksi tidak selalu berarti semua data page sudah ditulis ke tablespace. Commit berarti redo/durability contract terpenuhi sesuai konfigurasi.

Data page boleh tetap dirty di memory selama redo log cukup untuk memulihkannya saat crash.

---

## 4. Istilah Penting dalam Buffer Pool

### 4.1 Buffer Frame

Buffer frame adalah slot memory di buffer pool yang menampung satu page.

Kalau page size 16KB, maka secara kasar:

```text
1 buffer frame ~= 16KB page + metadata overhead
```

Buffer pool besar berarti banyak frame tersedia.

### 4.2 Clean Page

Clean page adalah page di buffer pool yang sama dengan versi di disk.

Kalau page clean harus dikeluarkan dari buffer pool, InnoDB dapat membuangnya tanpa menulis ke disk.

### 4.3 Dirty Page

Dirty page adalah page di buffer pool yang sudah berubah di memory tetapi belum ditulis kembali ke tablespace.

Dirty page tidak boleh dibuang begitu saja. Sebelum frame dipakai ulang, dirty page harus diflush.

### 4.4 Free Page

Free page adalah frame kosong yang dapat dipakai untuk memuat page baru.

### 4.5 LRU List

Buffer pool memakai mekanisme mirip LRU untuk menentukan page mana yang dipertahankan dan mana yang dapat dievict.

Namun InnoDB LRU bukan LRU sederhana. Ada mekanisme untuk mencegah table scan besar langsung mengusir working set penting.

### 4.6 Flush List

Flush list melacak dirty page yang perlu ditulis ke disk.

### 4.7 Page Young dan Old

InnoDB membagi LRU menjadi area young dan old. Page yang baru dibaca tidak selalu langsung dianggap “hot”. Ini membantu mengurangi polusi cache dari scan besar.

Contoh:

```sql
SELECT * FROM audit_events;
```

Kalau tabel audit sangat besar, query scan seperti ini dapat membawa banyak page ke buffer pool. Tanpa proteksi LRU, scan ini bisa mengusir page OLTP penting seperti `cases`, `case_tasks`, atau `case_assignments`.

---

## 5. Working Set: Konsep Paling Penting untuk Memory MySQL

Working set adalah subset data/index yang aktif dipakai workload dalam periode tertentu.

Bukan ukuran total database yang paling penting, tetapi:

> Berapa banyak page yang harus sering ada di memory agar workload utama tidak terus membaca disk?

Contoh:

Database total:

```text
cases              200 GB
case_events        1.5 TB
audit_log          3 TB
users              2 GB
case_assignments   30 GB
```

Tapi workload harian aktif mungkin hanya:

```text
open cases last 90 days                 40 GB
active assignments                       8 GB
recent case_events index pages          60 GB
user/role/permission data                2 GB
hot secondary indexes                   50 GB
```

Working set mungkin sekitar 160GB, bukan 4.7TB.

Kalau buffer pool 192GB, workload utama mungkin stabil.

Kalau buffer pool 32GB, MySQL akan terus melakukan random disk reads, latency meningkat, dan CPU bisa terlihat idle karena thread menunggu I/O.

---

## 6. Hit Ratio: Berguna, Tapi Bisa Menyesatkan

Buffer pool hit ratio adalah rasio akses page yang dilayani dari memory dibanding harus membaca disk.

Secara umum, hit ratio tinggi lebih baik.

Tapi ada jebakan:

### 6.1 Hit Ratio Tinggi Tidak Selalu Berarti Sistem Sehat

Misalnya:

- workload sangat kecil,
- query buruk tetap full scan di memory,
- CPU tinggi karena membaca terlalu banyak page dari buffer pool,
- temp table/sort yang besar terjadi di luar indikator utama buffer pool.

Hit ratio 99.9% bisa tetap lambat kalau query membaca 50 juta row dari memory.

### 6.2 Hit Ratio Rendah Tidak Selalu Fatal

Analytical/reporting query yang memang membaca data dingin bisa menghasilkan miss. Kalau workload itu terpisah dan tidak mengganggu OLTP, bisa diterima.

### 6.3 Yang Harus Dilihat Bersama

Jangan baca hit ratio sendirian. Gabungkan dengan:

- buffer pool reads dari disk,
- read latency,
- rows examined,
- query latency percentile,
- dirty page percentage,
- checkpoint age,
- disk IOPS/throughput,
- pending reads/writes,
- CPU wait/I/O wait,
- connection concurrency.

---

## 7. Read Path: Dari Query ke Page

Misalnya:

```sql
SELECT id, status, assigned_to, updated_at
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY updated_at DESC
LIMIT 50;
```

Dengan index:

```sql
CREATE INDEX idx_cases_tenant_status_updated
ON cases (tenant_id, status, updated_at DESC, id);
```

Read path ideal:

```text
1. Optimizer memilih index idx_cases_tenant_status_updated
2. Executor meminta row dari storage engine
3. InnoDB traversal B+Tree index
4. InnoDB butuh root/internal/leaf pages
5. Jika page ada di buffer pool -> memory hit
6. Jika page tidak ada -> disk read
7. Jika index covering -> hasil bisa dari secondary index
8. Jika tidak covering -> lookup ke clustered index untuk tiap row
9. Result dikembalikan ke SQL layer
10. SQL layer mengirim row ke client
```

Yang sering dilupakan:

> Secondary index non-covering bisa menghasilkan banyak random clustered lookup.

Kalau `LIMIT 50`, biaya mungkin kecil.

Kalau query mengambil 100.000 row, lookup ke clustered index dapat membaca banyak page tambahan.

---

## 8. Write Path dan Dirty Page

Pada update:

```sql
UPDATE cases
SET status = 'CLOSED', closed_at = NOW(6)
WHERE id = 10001;
```

InnoDB harus:

1. menemukan page clustered index yang memuat row,
2. memuat page ke buffer pool jika belum ada,
3. membuat undo record,
4. memodifikasi record di page,
5. memperbarui secondary index jika kolom indexed berubah,
6. menghasilkan redo log,
7. menandai affected pages sebagai dirty,
8. commit sesuai durability setting,
9. flush dirty pages nanti.

Perhatikan: satu update row bisa mengubah beberapa page:

- clustered index page,
- secondary index page untuk status,
- secondary index page untuk closed_at,
- undo page,
- internal metadata page tertentu.

Semakin banyak index, semakin banyak page yang berpotensi dirty.

---

## 9. Dirty Page Flushing

Dirty page tidak bisa dibiarkan tak terbatas. Pada akhirnya InnoDB harus menulisnya ke tablespace.

Flushing terjadi karena beberapa alasan:

1. **Checkpoint pressure**
2. **Buffer pool butuh free frame**
3. **Background flushing**
4. **Shutdown**
5. **DDL atau operational event tertentu**

### 9.1 Checkpoint Pressure

Redo log menyimpan perubahan yang belum tentu sudah ada di data file.

Kalau terlalu banyak dirty page belum diflush, redo log harus menyimpan recovery range makin panjang.

InnoDB perlu melakukan checkpoint agar crash recovery tetap bounded.

Mental model:

```text
Write workload tinggi
  -> dirty pages naik
  -> redo log fills
  -> checkpoint pressure naik
  -> flushing harus mengejar
  -> kalau tidak cukup, foreground query ikut melambat
```

### 9.2 Free Frame Pressure

Kalau query butuh memuat page baru tetapi buffer pool penuh, InnoDB harus mencari victim page.

Kalau victim page clean, tinggal evict.

Kalau victim page dirty, harus flush dulu.

Ini lebih mahal.

### 9.3 Adaptive Flushing

InnoDB memiliki mekanisme adaptive flushing untuk menyesuaikan rate flushing dirty pages berdasarkan workload dan kondisi redo/checkpoint. Tujuannya menghindari burst I/O yang terlalu mendadak.

---

## 10. I/O Capacity: Memberitahu InnoDB Kemampuan Storage

InnoDB perlu tahu kira-kira seberapa kuat storage melakukan I/O background.

Variabel penting:

```sql
SHOW VARIABLES LIKE 'innodb_io_capacity';
SHOW VARIABLES LIKE 'innodb_io_capacity_max';
```

Secara konsep:

- `innodb_io_capacity` memberi target kapasitas I/O normal untuk background tasks.
- `innodb_io_capacity_max` memberi batas saat workload membutuhkan flushing lebih agresif.

Kalau terlalu rendah:

- flushing terlalu lambat,
- dirty page menumpuk,
- checkpoint pressure naik,
- spike latency muncul.

Kalau terlalu tinggi:

- background flushing bisa mengganggu foreground query,
- storage menjadi sibuk walaupun tidak perlu,
- latency read/write bisa naik.

Di cloud, angka ini tidak bisa hanya ditebak dari “SSD”. Harus melihat:

- IOPS provisioned,
- throughput limit,
- latency P95/P99,
- burst credit,
- network-attached storage behavior,
- noisy neighbor,
- fsync latency.

---

## 11. Disk I/O: Random vs Sequential

B+Tree lookup pada index cenderung menghasilkan random access bila page belum ada di memory.

Redo log dan binlog cenderung append/sequential.

Data page flushing bisa random karena dirty page tersebar di banyak tablespace/page.

Tipe I/O umum:

| Aktivitas | Pola I/O | Catatan |
|---|---:|---|
| Index lookup miss | random read | mahal pada disk lambat |
| Full table/index scan | sequential-ish read | bisa throughput besar |
| Redo log write | sequential write | latency fsync penting |
| Binlog write | sequential write | penting untuk replication/PITR |
| Dirty page flush | random write | dipengaruhi checkpoint |
| Temp table spill | read/write temp | bisa mengganggu workload utama |
| Sort spill | temp file I/O | sering muncul dari query report |

Untuk OLTP, random read latency sangat penting.

Untuk reporting, throughput dan temp I/O sering lebih dominan.

---

## 12. OS Page Cache vs InnoDB Buffer Pool

Ada dua cache yang sering dibingungkan:

1. **InnoDB buffer pool**
2. **Operating system page cache**

InnoDB buffer pool memahami page InnoDB, dirty state, LRU internal, dan struktur storage engine.

OS page cache memahami block file system.

Untuk InnoDB, buffer pool adalah cache utama. Biasanya sebagian besar memory server database diberikan ke buffer pool, bukan dibiarkan ke OS page cache.

Namun OS tetap butuh memory untuk:

- kernel,
- filesystem metadata,
- process memory lain,
- network buffers,
- page cache untuk file non-InnoDB tertentu,
- mysqld overhead di luar buffer pool.

Kesalahan umum:

```text
RAM server = 64GB
innodb_buffer_pool_size = 63GB
```

Ini berisiko karena MySQL juga punya memory lain:

- per-connection buffers,
- temp tables,
- Performance Schema,
- adaptive hash index/change buffer/log buffer metadata,
- thread stacks,
- OS memory.

---

## 13. Global Memory vs Per-Connection Memory

Ini salah satu hal paling penting untuk Java engineer.

Memory MySQL dapat dibagi kasar:

```text
Total mysqld memory
  ~= global memory
   + per-connection memory * active connections
   + temporary workload memory
   + engine/internal overhead
```

### 13.1 Global Memory

Contoh global memory:

- InnoDB buffer pool
- redo log buffer
- change buffer inside system tablespace/buffered structures
- adaptive hash index memory
- Performance Schema memory
- dictionary/cache metadata

### 13.2 Per-Connection Memory

Setiap koneksi dapat membutuhkan memory untuk:

- thread stack,
- network buffers,
- read buffer,
- sort buffer,
- join buffer,
- binlog cache untuk transaction,
- temporary table memory,
- prepared statement state,
- result buffering tertentu.

Tidak semua buffer dialokasikan penuh setiap saat. Banyak yang dialokasikan saat operasi membutuhkan.

Namun masalah muncul saat banyak koneksi aktif secara bersamaan melakukan sort/join/temp operation besar.

---

## 14. Connection Count: Kenapa Lebih Banyak Tidak Selalu Lebih Cepat

Dari perspektif Java, sering ada asumsi:

> “Kalau throughput kurang, tambah connection pool.”

Ini sering salah.

Database bukan HTTP stateless service biasa. MySQL punya bottleneck internal:

- CPU core terbatas,
- buffer pool latch/mutex,
- row locks,
- disk I/O,
- redo/binlog fsync,
- memory bandwidth,
- replication pipeline,
- network bandwidth.

Connection pool terlalu besar dapat menyebabkan:

1. terlalu banyak query aktif,
2. context switching naik,
3. lock contention naik,
4. memory per-session naik,
5. buffer pool churn,
6. disk queue meningkat,
7. tail latency memburuk,
8. timeout cascade di aplikasi.

### 14.1 Pool Size Bukan Kapasitas Bisnis

Kalau HikariCP pool size 100, bukan berarti sistem mampu menjalankan 100 transaksi DB berat secara paralel dengan baik.

Lebih tepat:

> Pool size adalah batas concurrency database dari satu aplikasi instance.

Kalau ada 20 pod Java, masing-masing pool 30:

```text
20 pods * 30 connections = 600 possible DB connections
```

600 connection mungkin sangat berlebihan untuk satu MySQL primary.

### 14.2 Pool Size Harus Dilihat Secara Fleet-Level

Sizing harus memperhitungkan:

- jumlah app instance,
- jumlah service yang connect ke DB yang sama,
- workload per service,
- query latency,
- transaction duration,
- CPU DB,
- max_connections,
- failover behavior,
- autoscaling.

Formula kasar:

```text
Total possible connections
= sum(service_instance_count * pool_size_per_instance)
```

Jangan hanya melihat satu service.

---

## 15. Little's Law untuk Connection Pool

Little's Law:

```text
concurrency = throughput * latency
```

Jika service butuh 1000 DB operations/sec dan rata-rata DB operation latency 10 ms:

```text
concurrency = 1000 * 0.010 = 10 active DB operations
```

Secara teori, sekitar 10 active connections cukup untuk workload tersebut, ditambah headroom.

Kalau latency naik menjadi 100 ms:

```text
concurrency = 1000 * 0.100 = 100 active DB operations
```

Artinya pool besar sering hanya menutupi latency yang memburuk, bukan menyelesaikan akar masalah.

Lebih buruk lagi, menaikkan concurrency saat DB sudah overload dapat membuat latency makin naik.

Loop buruk:

```text
DB latency naik
  -> request menunggu lebih lama
  -> lebih banyak connection aktif
  -> DB makin padat
  -> latency makin naik
  -> timeout/retry
  -> traffic makin banyak
```

---

## 16. Per-Connection Buffers yang Sering Disalahpahami

Beberapa variabel sering dinaikkan sembarangan:

```sql
sort_buffer_size
join_buffer_size
read_buffer_size
read_rnd_buffer_size
tmp_table_size
max_heap_table_size
```

Masalahnya: sebagian buffer ini dapat dialokasikan per session/per operation.

Menaikkan dari 256KB ke 64MB terlihat kecil untuk satu query, tapi fatal jika ratusan koneksi aktif.

Contoh kasar:

```text
200 active connections * 64MB sort buffer = 12.8GB potential memory
```

Belum termasuk join buffer, temp table, thread stack, result set, dan lainnya.

Prinsip:

> Jangan membesarkan per-session buffer sebagai default global hanya karena satu query lambat.

Lebih baik:

1. perbaiki index,
2. perbaiki query shape,
3. batasi result set,
4. gunakan session-level setting untuk job khusus,
5. pisahkan reporting workload,
6. ukur spill/temp behavior.

---

## 17. Internal Temporary Tables

MySQL dapat membuat internal temporary table untuk:

- `GROUP BY`,
- `DISTINCT`,
- `ORDER BY` tertentu,
- derived table,
- CTE materialization,
- window functions,
- UNION,
- complex joins,
- aggregation.

Temporary table bisa berada di memory atau disk.

Jika terlalu besar atau mengandung tipe tertentu, temporary table dapat pindah ke disk.

Dampaknya:

```text
Query terlihat sederhana
  -> creates temp table
  -> temp table grows
  -> spills to disk
  -> disk I/O naik
  -> latency naik
  -> query lain ikut terdampak
```

### 17.1 Contoh Query Berbahaya

```sql
SELECT assigned_to, status, COUNT(*)
FROM cases
WHERE tenant_id = ?
GROUP BY assigned_to, status
ORDER BY COUNT(*) DESC;
```

Kalau index tidak membantu aggregation/order, MySQL mungkin harus membuat temp table dan sort.

Untuk dashboard kecil mungkin aman. Untuk tenant besar, bisa berat.

### 17.2 Java Layer Trap

API backend sering membuat query fleksibel:

```text
filter optional + sort optional + group optional + export optional
```

Jika semua digabung dalam satu endpoint generik, query plan bisa sangat bervariasi dan sulit dioptimasi.

Desain lebih baik:

- pisahkan query OLTP dan reporting,
- batasi filter kombinasi yang didukung,
- gunakan pre-aggregation untuk dashboard,
- gunakan cursor untuk listing,
- gunakan async export untuk hasil besar,
- gunakan read replica/reporting store bila cocok.

---

## 18. Sort Buffer dan Filesort

`filesort` di MySQL tidak selalu berarti sort di file disk. Istilah ini berarti MySQL melakukan sorting sendiri, bukan membaca hasil dalam order index yang sudah sesuai.

Namun sort besar dapat memakai memory dan bisa spill ke disk.

Contoh:

```sql
SELECT id, title, created_at
FROM cases
WHERE tenant_id = ?
ORDER BY priority DESC, created_at DESC
LIMIT 100;
```

Kalau tidak ada index yang cocok, MySQL perlu:

1. menemukan candidate rows,
2. menyortir,
3. ambil 100 teratas.

Untuk tenant kecil aman. Untuk tenant besar mahal.

Index mungkin:

```sql
CREATE INDEX idx_cases_tenant_priority_created
ON cases (tenant_id, priority DESC, created_at DESC, id);
```

Tapi index ini harus dievaluasi terhadap workload lain. Jangan setiap sort dibuat index tanpa melihat write cost.

---

## 19. Join Buffer

Join buffer dipakai untuk join yang tidak bisa memakai index secara efisien pada sisi inner table.

Jika join buffer muncul, sering itu sinyal:

- join predicate tidak indexed,
- data type join tidak cocok,
- collation mismatch,
- fungsi diterapkan pada kolom join,
- cardinality buruk,
- optimizer memilih join order tertentu.

Contoh buruk:

```sql
SELECT c.id, e.id
FROM cases c
JOIN case_events e
  ON CAST(e.case_id AS CHAR) = c.external_case_id
WHERE c.tenant_id = ?;
```

Fungsi/cast di join dapat merusak index usage.

Prinsip:

> Join buffer bukan pengganti index. Ia adalah mekanisme eksekusi saat index path tidak cukup baik.

---

## 20. Change Buffer

Change buffer adalah struktur InnoDB untuk menunda perubahan pada secondary index page yang belum ada di buffer pool.

Misalnya:

```sql
INSERT INTO case_events (...)
```

Jika insert juga harus memperbarui secondary index, tapi page secondary index target belum ada di buffer pool, InnoDB dapat mencatat perubahan di change buffer dan menggabungkannya nanti saat page tersebut dibaca.

Manfaat:

- mengurangi random read untuk secondary index page dingin,
- membantu workload write-heavy pada secondary indexes,
- membuat write lebih efisien saat affected secondary index pages tidak hot.

Namun change buffer bukan gratis:

- merge nanti tetap perlu terjadi,
- bisa menambah background work,
- manfaatnya lebih kecil jika working set index sudah hot,
- tidak semua jenis index/operation mendapat manfaat sama.

Mental model:

```text
Without change buffer:
  update secondary index page now -> may require random read

With change buffer:
  buffer secondary index change -> merge later
```

Untuk workload OLTP modern dengan SSD cepat dan memory besar, efeknya harus diukur, bukan diasumsikan.

---

## 21. Adaptive Hash Index

Adaptive Hash Index atau AHI adalah optimisasi InnoDB yang dapat membuat lookup tertentu lebih cepat dengan struktur hash internal berdasarkan pola akses B+Tree.

Mental model:

```text
Repeated B+Tree lookups on hot index pattern
  -> InnoDB may build hash access path
  -> some lookups avoid full B+Tree traversal
```

AHI dapat membantu workload dengan:

- banyak point lookup,
- buffer pool cukup besar,
- pola akses berulang,
- index pages hot.

Namun AHI juga bisa menjadi sumber contention pada workload tertentu.

Karena itu, status AHI harus dilihat sebagai tuning yang workload-dependent, bukan magic switch.

---

## 22. Read-Ahead

InnoDB dapat melakukan read-ahead saat mendeteksi pola akses sequential.

Contoh:

```sql
SELECT *
FROM case_events
WHERE tenant_id = ?
  AND created_at >= '2026-01-01'
  AND created_at < '2026-02-01';
```

Jika access path membaca banyak page berurutan, read-ahead membantu dengan memuat page sebelum diminta foreground thread.

Namun untuk OLTP random lookup, read-ahead tidak banyak membantu.

Kunci:

- sequential scan lebih throughput-oriented,
- point lookup lebih latency-oriented,
- workload campuran perlu isolasi.

---

## 23. Insert Buffering, Page Split, dan I/O

Primary key choice memengaruhi I/O.

### 23.1 Sequential Primary Key

```sql
id BIGINT AUTO_INCREMENT PRIMARY KEY
```

Insert biasanya menuju ujung kanan B+Tree.

Kelebihan:

- locality bagus,
- page split lebih terkendali,
- cache behavior predictable.

Kekurangan:

- potensi hotspot pada insert sangat tinggi,
- ID mudah ditebak,
- tidak ideal untuk semua distributed ID scenario.

### 23.2 Random UUID Primary Key

```sql
id CHAR(36) PRIMARY KEY
```

atau random binary UUID.

Insert tersebar ke banyak page.

Dampak:

- random page access,
- page split lebih sering,
- buffer pool churn,
- secondary index lebih besar karena menyimpan primary key,
- write amplification naik.

### 23.3 Ordered UUID/ULID/Snowflake-like ID

Lebih baik untuk locality daripada random UUID, tetapi masih perlu evaluasi:

- monotonicity,
- collision,
- clock behavior,
- shard/node id,
- privacy,
- Java generator reliability.

---

## 24. Large Rows dan Buffer Pool Efficiency

Buffer pool bekerja pada page. Kalau row besar, jumlah row per page turun.

Contoh sederhana:

```text
Page size: 16KB
Average row size: 200 bytes -> ~80 rows/page
Average row size: 4KB       -> ~4 rows/page
```

Dengan row besar:

- lebih banyak page dibutuhkan untuk jumlah row sama,
- cache efficiency turun,
- index lookup bisa membawa data yang tidak dibutuhkan,
- update row besar lebih mahal,
- page split/fragmentation meningkat.

Kolom seperti ini perlu diperhatikan:

- `TEXT`,
- `BLOB`,
- `JSON`,
- `VARCHAR` sangat besar,
- serialized object,
- document snapshot.

Prinsip desain:

> Jangan campur data hot kecil dengan payload besar dingin tanpa alasan kuat.

Contoh pemisahan:

```sql
CREATE TABLE cases (
  id BIGINT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  priority VARCHAR(32) NOT NULL,
  assigned_to BIGINT NULL,
  updated_at DATETIME(6) NOT NULL,
  version BIGINT NOT NULL
);

CREATE TABLE case_payloads (
  case_id BIGINT PRIMARY KEY,
  form_json JSON NOT NULL,
  last_payload_update DATETIME(6) NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id)
);
```

Listing dan workflow update tidak perlu selalu membawa payload JSON besar.

---

## 25. Hot Data vs Cold Data

Dalam sistem case management:

Hot data:

- open cases,
- active assignments,
- pending approvals,
- SLA timers,
- latest state transitions,
- user permissions,
- active workflow definitions.

Cold data:

- closed cases lama,
- audit logs lama,
- historical events,
- archived attachments,
- old notification records.

Kalau hot dan cold dicampur tanpa strategi:

- index membesar,
- buffer pool terisi page dingin saat report berjalan,
- purge/delete mahal,
- backup/restore membesar,
- query dashboard terganggu.

Strategi:

1. index yang memprioritaskan hot access pattern,
2. partitioning untuk retention/time-series-like table,
3. archive table,
4. reporting replica,
5. async export,
6. summary table,
7. data lifecycle policy.

---

## 26. Buffer Pool Sizing

Tidak ada angka universal, tapi ada prinsip.

Untuk dedicated MySQL server:

```text
innodb_buffer_pool_size = large fraction of RAM
```

Namun jangan sampai menghabiskan semua memory.

Sisakan untuk:

- OS,
- per-connection memory,
- temporary tables,
- Performance Schema,
- replication threads,
- backup tools,
- monitoring agent,
- filesystem/kernel overhead.

### 26.1 Contoh Sizing Awal

Server:

```text
RAM: 128GB
Dedicated MySQL primary
Workload: OLTP Java services
```

Initial thinking:

```text
Buffer pool: 80GB - 96GB
OS + MySQL overhead + sessions: 32GB - 48GB
```

Jika connection banyak dan temp queries berat, buffer pool mungkin perlu lebih rendah.

Jika workload sangat murni OLTP dengan connection terbatas, buffer pool bisa lebih tinggi.

### 26.2 Container/Kubernetes Trap

Jika MySQL berjalan di container:

- MySQL mungkin tidak sadar penuh terhadap cgroup limit di semua konfigurasi lama/varian,
- OOM kill lebih fatal daripada query lambat,
- buffer pool + per-session memory harus di bawah memory limit,
- backup/restore sidecar bisa menambah memory,
- page cache behavior berbeda tergantung storage.

Untuk production MySQL, menjalankan stateful database di Kubernetes butuh disiplin tinggi pada storage, memory, restart behavior, dan operator.

---

## 27. Buffer Pool Warmup dan Cold Start

Setelah restart, buffer pool bisa dingin.

Dampak:

- query yang biasanya cepat mendadak lambat,
- disk read naik,
- latency P99 spike,
- replicas setelah restart butuh waktu stabil,
- failover ke replica cold bisa buruk.

InnoDB mendukung dump/load buffer pool state agar restart bisa lebih cepat warm.

Namun warmup bukan solusi penuh. Jika workload berubah, atau dataset terlalu besar, tetap perlu waktu.

Operational implication:

- jangan ukur performa langsung setelah restart dan menganggap itu steady state,
- failover plan harus memperhatikan cache warmth,
- pre-warm critical queries kadang diperlukan,
- rolling restart harus hati-hati.

---

## 28. Checkpoint dan Latency Spike

Checkpoint adalah proses memastikan dirty pages cukup diflush sehingga redo log tidak tumbuh tanpa batas dan recovery tetap manageable.

Latency spike bisa muncul saat:

- dirty pages terlalu banyak,
- redo log hampir penuh,
- flushing mengejar,
- storage tidak cukup kuat,
- foreground thread harus membantu flush,
- fsync latency tinggi.

Gejala:

- write latency naik,
- commit latency naik,
- dirty page percentage tinggi,
- pending flush naik,
- I/O utilization tinggi,
- CPU mungkin tidak penuh.

Respons yang salah:

```text
Tambah connection pool agar throughput naik
```

Respons yang lebih masuk akal:

1. cek dirty page/checkpoint pressure,
2. cek disk latency,
3. cek redo log capacity,
4. cek write workload spike,
5. cek batch transaction terlalu besar,
6. cek jumlah secondary index,
7. cek flushing settings,
8. cek storage provisioning.

---

## 29. Redo Log Capacity dan Buffer Pool Flushing

Redo log capacity memengaruhi seberapa agresif InnoDB perlu memflush dirty pages.

Redo log lebih besar dapat memberi ruang lebih besar untuk menunda flushing, sehingga write burst bisa lebih smooth.

Namun bukan berarti redo log besar selalu menyelesaikan masalah:

- crash recovery bisa lebih lama,
- dirty page tetap harus diflush akhirnya,
- storage tetap bottleneck jika sustained write melebihi kapasitas,
- backup/restore dan operational behavior perlu dievaluasi.

Mental model:

```text
Small redo capacity:
  less room for dirty pages -> more frequent/aggressive flushing

Larger redo capacity:
  more burst absorption -> smoother writes, but recovery/window considerations
```

---

## 30. Log Buffer

InnoDB log buffer menyimpan redo records sebelum ditulis ke redo log file.

Variabel:

```sql
SHOW VARIABLES LIKE 'innodb_log_buffer_size';
```

Log buffer terlalu kecil bisa menjadi masalah untuk transaksi besar yang menghasilkan banyak redo.

Namun untuk OLTP kecil, membesarkan log buffer biasanya bukan tuning pertama.

Transaksi besar yang mengubah jutaan row lebih sering sebaiknya dipecah menjadi batch kecil, bukan hanya menaikkan log buffer.

---

## 31. Batch Writes dari Java

Java engineer sering melakukan batch insert/update.

Batch membantu karena:

- mengurangi round trip,
- meningkatkan group commit opportunity,
- mengurangi overhead statement,
- meningkatkan throughput.

Tapi batch terlalu besar berisiko:

- transaksi terlalu lama,
- undo/redo besar,
- lock ditahan lama,
- dirty page spike,
- replication lag,
- rollback mahal,
- memory driver/app meningkat,
- timeout lebih mungkin.

Prinsip:

```text
Batch cukup besar untuk efisiensi,
tapi cukup kecil untuk menjaga lock, redo, undo, replication, dan retry tetap manageable.
```

Contoh awal praktis:

```text
100 - 1000 row per batch untuk banyak OLTP insert/update
```

Tapi angka final harus diukur.

---

## 32. Streaming Reads dan Memory

Untuk result besar, Java dapat memakai streaming/fetching agar tidak memuat semua row ke memory aplikasi.

Namun dari perspektif MySQL:

- transaksi bisa lebih lama,
- cursor/result set menahan resource,
- connection tidak kembali ke pool,
- snapshot MVCC bisa bertahan,
- purge bisa tertahan,
- lock bisa tertahan jika locking read.

Jangan gunakan streaming result untuk operasi bisnis interaktif tanpa batas.

Untuk export besar:

- jalankan async,
- pakai replica/reporting database bila aman,
- pakai pagination berbasis keyset,
- commit per chunk bila memungkinkan,
- jangan tahan transaction snapshot terlalu lama,
- berikan backpressure.

---

## 33. Temporary Workload dari Reporting dan Export

Sistem regulatory/case management sering punya kebutuhan:

- export Excel,
- laporan bulanan,
- audit review,
- trend escalation,
- SLA aging report,
- case history full export.

Ini bukan workload yang sama dengan OLTP harian.

Jika dijalankan di primary yang sama:

- buffer pool bisa tercemar,
- temp disk naik,
- CPU dipakai sorting/aggregation,
- lock/metadata pressure bisa muncul,
- replication lag bisa terjadi jika query di replica terlalu berat,
- app OLTP terkena P99 latency spike.

Strategi:

1. read replica untuk report,
2. precomputed summary,
3. event-driven projection,
4. warehouse/OLAP store untuk analitik,
5. job queue dengan concurrency limit,
6. export chunked dan resumable,
7. query guardrail.

---

## 34. Memory Pressure dan OOM

MySQL bisa terlihat normal sampai memory pressure terjadi.

Gejala:

- swap aktif,
- latency tiba-tiba naik drastis,
- mysqld OOM killed,
- connection gagal,
- query error out of memory,
- OS kill process lain,
- container restart.

Penyebab umum:

- buffer pool terlalu besar,
- `max_connections` terlalu tinggi,
- connection pool fleet terlalu besar,
- per-session buffer dinaikkan global,
- temp table workload besar,
- query export paralel,
- Performance Schema terlalu banyak instrumentasi tanpa sizing,
- memory leak/bug eksternal,
- backup tool berjalan bersamaan.

Prinsip:

> Jangan sizing MySQL hanya dari kondisi normal. Sizing harus mencakup spike, failover, retry storm, dan job paralel.

---

## 35. Swap: Hampir Selalu Tanda Bahaya untuk Database OLTP

Swap dapat membuat proses tidak mati, tetapi untuk database OLTP, swap berat biasanya menghancurkan latency.

Jika buffer pool page atau internal memory masuk swap:

- akses memory menjadi disk access,
- latency unpredictable,
- thread menumpuk,
- timeout cascade,
- failover bisa terpicu.

Operational stance:

- hindari swap aktif berat,
- monitor swap in/out,
- sisakan memory headroom,
- gunakan OOM policy yang dipahami,
- jangan overcommit memory tanpa kontrol.

---

## 36. Observability: Apa yang Harus Dilihat

### 36.1 Buffer Pool Metrics

Pantau:

- buffer pool size,
- database pages,
- free pages,
- dirty pages,
- buffer pool reads,
- read requests,
- pages read,
- pages written,
- LRU eviction,
- flush activity.

Query awal:

```sql
SHOW ENGINE INNODB STATUS\G
```

Dan Performance Schema / sys schema untuk breakdown lebih baik.

### 36.2 Dirty Page dan Flush Metrics

Pantau:

- dirty page percentage,
- checkpoint age,
- pending writes,
- fsync latency,
- page cleaner behavior,
- redo log pressure.

### 36.3 I/O Metrics

Pantau di DB dan OS/cloud:

- read IOPS,
- write IOPS,
- throughput,
- queue depth,
- await/read latency/write latency,
- fsync latency,
- disk utilization,
- burst credit.

### 36.4 Connection Metrics

Pantau:

- current connections,
- active threads,
- running queries,
- aborted connections,
- connection errors,
- max used connections,
- per-service connection count.

### 36.5 Temporary Table Metrics

Pantau:

- created temporary tables,
- created temporary disk tables,
- temp file usage,
- query digest yang membuat temp table.

### 36.6 Java Metrics yang Harus Dikorelasikan

Dari aplikasi:

- Hikari active connections,
- idle connections,
- pending threads waiting for connection,
- connection acquisition time,
- query latency,
- transaction duration,
- timeout count,
- retry count,
- HTTP request P95/P99,
- batch job concurrency.

Jangan debug MySQL terpisah dari aplikasi. Banyak masalah MySQL adalah hasil dari pola concurrency aplikasi.

---

## 37. Query untuk Pemeriksaan Awal

### 37.1 Buffer Pool Basic

```sql
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
SHOW VARIABLES LIKE 'innodb_page_size';
SHOW STATUS LIKE 'Innodb_buffer_pool%';
```

### 37.2 Connections

```sql
SHOW VARIABLES LIKE 'max_connections';
SHOW STATUS LIKE 'Threads%';
SHOW STATUS LIKE 'Max_used_connections';
```

### 37.3 Temp Tables

```sql
SHOW STATUS LIKE 'Created_tmp%';
```

### 37.4 Sorts

```sql
SHOW STATUS LIKE 'Sort%';
```

### 37.5 InnoDB Status

```sql
SHOW ENGINE INNODB STATUS\G
```

### 37.6 Top Statement Digests via sys Schema

```sql
SELECT *
FROM sys.statement_analysis
ORDER BY total_latency DESC
LIMIT 20;
```

```sql
SELECT *
FROM sys.statements_with_temp_tables
ORDER BY disk_tmp_tables DESC
LIMIT 20;
```

```sql
SELECT *
FROM sys.schema_table_statistics_with_buffer
ORDER BY innodb_buffer_allocated DESC
LIMIT 20;
```

Catatan: nama view dan kolom dapat berbeda tergantung versi/config. Gunakan sebagai starting point, bukan dogma.

---

## 38. Pattern: OLTP Primary yang Stabil

Ciri workload OLTP primary yang stabil:

- query kecil dan indexed,
- transaction pendek,
- connection concurrency terkendali,
- buffer pool memuat working set utama,
- dirty page stabil,
- disk latency rendah,
- temp table disk minimal,
- reporting berat tidak berjalan di primary,
- batch job dibatasi,
- retry memakai backoff dan idempotency,
- pool size dihitung fleet-level.

Architecture sketch:

```text
Java API services
  -> bounded Hikari pools
  -> MySQL primary for writes and critical reads
  -> read replica/reporting path for heavy reads
  -> async workers with concurrency limit
  -> observability: app + DB + storage
```

---

## 39. Pattern: Reporting Mengganggu OLTP

Gejala:

- API lambat hanya saat jam report/export,
- disk read/write naik,
- temp disk table naik,
- buffer pool hit ratio turun atau reads naik,
- CPU sorting/aggregation naik,
- query OLTP kecil ikut melambat.

Penyebab:

- report full scan tabel besar,
- ORDER BY/GROUP BY tidak cocok index,
- export paralel tanpa limit,
- query mengambil payload besar,
- report jalan di primary,
- tidak ada summary table.

Solusi bertahap:

1. identifikasi query digest report,
2. beri limit concurrency,
3. pindahkan ke replica jika consistency memungkinkan,
4. buat index/report-specific projection,
5. pre-aggregate dashboard,
6. pindahkan analitik berat ke OLAP/search engine,
7. pisahkan endpoint interactive vs export.

---

## 40. Pattern: Connection Storm dari Java

Gejala:

- `Threads_connected` tinggi,
- `Threads_running` tinggi,
- Hikari pending acquisition naik,
- timeout cascade,
- DB CPU/I/O tinggi,
- lock wait meningkat,
- app retry memperparah traffic.

Penyebab:

- pool terlalu besar per pod,
- autoscaling menambah pod saat DB sudah lambat,
- retry tanpa backoff,
- query lambat menahan connection,
- transaction terlalu panjang,
- circuit breaker tidak ada,
- batch job bersamaan dengan traffic online.

Solusi:

1. batasi pool per service,
2. hitung total fleet connection,
3. set timeout realistis,
4. gunakan backoff/jitter,
5. pisahkan worker pool,
6. kill/optimasi query penyebab,
7. tambah guardrail di endpoint mahal,
8. scale DB/storage bila memang bottleneck kapasitas.

---

## 41. Pattern: Dirty Page Storm

Gejala:

- write latency spike,
- commit lambat,
- dirty pages tinggi,
- pending flush tinggi,
- storage write latency tinggi,
- replication lag mungkin naik.

Penyebab:

- batch update/delete besar,
- import masif,
- terlalu banyak secondary index,
- redo/checkpoint pressure,
- storage write capacity kurang,
- purge tertahan karena long transaction,
- checkpoint/flushing config tidak sesuai storage.

Solusi:

1. pecah batch,
2. throttle job,
3. cek secondary index cost,
4. cek long transaction,
5. evaluasi redo log capacity,
6. tune I/O capacity berdasarkan storage,
7. scale storage,
8. jadwalkan maintenance dengan kontrol.

---

## 42. Practical Sizing Framework

Gunakan framework bertahap, bukan angka sakti.

### Step 1 — Tentukan Workload

Pisahkan:

- online transaction,
- background job,
- reporting,
- export,
- migration,
- CDC/replication,
- backup.

### Step 2 — Ukur Data Aktif

Cari:

- ukuran tabel,
- ukuran index,
- row count,
- data hot by time/status/tenant,
- index hot path.

### Step 3 — Tentukan Memory Budget

```text
RAM total
- OS headroom
- MySQL non-buffer global memory
- per-connection worst reasonable memory
- temp workload headroom
= candidate buffer pool
```

### Step 4 — Tentukan Connection Budget

```text
DB max active concurrency
/ number of app instances
= rough per-instance pool upper bound
```

Lalu validasi dengan load test.

### Step 5 — Tentukan Storage Budget

Ukur:

- read IOPS,
- write IOPS,
- fsync latency,
- throughput,
- burst behavior,
- backup load,
- replication impact.

### Step 6 — Load Test dengan Data Realistis

Jangan test dengan 10.000 row jika production 500 juta row.

Perhatikan:

- data distribution,
- tenant skew,
- status skew,
- historical rows,
- hot/cold ratio,
- concurrency,
- report/export overlap.

---

## 43. Java Design Rules yang Berhubungan Langsung dengan Buffer Pool/I/O

### Rule 1 — Ambil Kolom yang Dibutuhkan

Buruk:

```sql
SELECT * FROM cases WHERE tenant_id = ? AND status = ?;
```

Lebih baik:

```sql
SELECT id, case_number, status, priority, assigned_to, updated_at
FROM cases
WHERE tenant_id = ? AND status = ?
ORDER BY updated_at DESC
LIMIT 50;
```

`SELECT *` membawa payload yang mungkin tidak perlu, merusak covering index opportunity, dan meningkatkan network/memory.

### Rule 2 — Jangan Campur Export Besar dengan Request Interaktif

Export harus async dan dibatasi.

### Rule 3 — Jangan Memperbesar Pool untuk Menutupi Query Lambat

Query lambat harus dianalisis. Pool besar sering membuat DB lebih lambat.

### Rule 4 — Hindari Transaction yang Menahan Connection Lama

Jangan lakukan ini:

```java
@Transactional
public void closeCase(Long id) {
    Case c = repository.findForUpdate(id);
    externalDocumentService.generatePdf(c); // slow external call
    repository.close(id);
}
```

Lebih baik pisahkan efek samping dan transaksi DB.

### Rule 5 — Gunakan Backpressure

Batch job harus punya concurrency limit.

### Rule 6 — Ukur di DB dan App

Hikari metrics tanpa MySQL metrics tidak cukup. MySQL metrics tanpa app metrics juga tidak cukup.

---

## 44. Case Study: Regulatory Case Dashboard Lambat

### 44.1 Situasi

Endpoint:

```http
GET /cases?tenant=42&status=OPEN&sort=updatedAtDesc&page=0&size=50
```

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY updated_at DESC
LIMIT 50 OFFSET 0;
```

Tabel `cases` punya JSON payload besar.

Index hanya:

```sql
PRIMARY KEY (id)
INDEX idx_tenant (tenant_id)
INDEX idx_status (status)
```

### 44.2 Gejala

- endpoint P99 lambat,
- buffer pool reads naik,
- rows examined tinggi,
- sort merge pass naik,
- network response besar,
- CPU DB naik saat banyak user membuka dashboard.

### 44.3 Diagnosis

Masalah bukan satu hal:

1. index tidak cocok filter + order,
2. `SELECT *` membawa JSON besar,
3. offset pagination akan buruk untuk page lanjut,
4. query dashboard bersaing dengan OLTP update,
5. working set index tidak efisien.

### 44.4 Perbaikan

Index:

```sql
CREATE INDEX idx_cases_tenant_status_updated_id
ON cases (tenant_id, status, updated_at DESC, id DESC);
```

Query listing:

```sql
SELECT id, case_number, status, priority, assigned_to, updated_at
FROM cases
WHERE tenant_id = ?
  AND status = ?
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

Payload detail dipanggil hanya saat user membuka case.

Untuk page berikutnya, gunakan cursor:

```sql
SELECT id, case_number, status, priority, assigned_to, updated_at
FROM cases
WHERE tenant_id = ?
  AND status = ?
  AND (updated_at, id) < (?, ?)
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

Hasil:

- page index lebih hot,
- row besar tidak selalu dibaca,
- sort berkurang,
- buffer pool lebih efektif,
- network lebih kecil,
- tail latency turun.

---

## 45. Case Study: Batch Escalation Membuat Write Spike

### 45.1 Situasi

Setiap malam job eskalasi menjalankan:

```sql
UPDATE cases
SET status = 'ESCALATED', escalated_at = NOW(6)
WHERE status = 'OPEN'
  AND due_at < NOW(6);
```

Jumlah row: 2 juta.

### 45.2 Gejala

- write latency naik,
- dirty pages tinggi,
- replication lag,
- lock wait meningkat,
- app online lambat,
- redo/checkpoint pressure.

### 45.3 Masalah

Satu statement besar:

- membuat transaksi besar,
- menghasilkan banyak redo/undo,
- mengubah banyak secondary index,
- menahan lock lama,
- membuat dirty page storm,
- sulit diretry dengan aman.

### 45.4 Desain Lebih Baik

Ambil batch candidate:

```sql
SELECT id
FROM cases
WHERE status = 'OPEN'
  AND due_at < NOW(6)
ORDER BY due_at, id
LIMIT 500;
```

Update batch by primary key:

```sql
UPDATE cases
SET status = 'ESCALATED', escalated_at = NOW(6)
WHERE id IN (...)
  AND status = 'OPEN';
```

Gunakan loop dengan:

- batch size terbatas,
- sleep/throttle,
- idempotency,
- progress checkpoint,
- metric lag/latency,
- stop condition.

Efek:

- dirty page lebih terkendali,
- lock duration lebih pendek,
- rollback lebih murah,
- replication lebih manageable,
- online workload tetap hidup.

---

## 46. Anti-Patterns

### Anti-Pattern 1 — Semua Memory Diberikan ke Buffer Pool

```text
RAM 64GB, buffer pool 62GB, max_connections 1000
```

Berisiko OOM.

### Anti-Pattern 2 — `max_connections` Sangat Besar Tanpa Kontrol Pool

`max_connections = 5000` tidak membuat DB lebih scalable. Ia hanya memperbolehkan lebih banyak concurrency masuk sebelum gagal.

### Anti-Pattern 3 — Global Sort Buffer Dinaikkan Besar

Karena satu query error sort memory, semua session diberi sort buffer besar. Ini bisa menyebabkan memory pressure.

### Anti-Pattern 4 — Reporting di Primary Tanpa Guardrail

Satu export besar bisa mengganggu transaksi kecil.

### Anti-Pattern 5 — Random UUID PK pada Tabel Write-Heavy Besar Tanpa Pertimbangan

Ini bisa memperburuk locality dan write amplification.

### Anti-Pattern 6 — Batch Update/Delete Raksasa

Membuat undo/redo/dirty page/replication pressure besar.

### Anti-Pattern 7 — Menilai Performa dari Average Latency

Database incident sering muncul di P95/P99, bukan average.

---

## 47. Checklist Desain

### 47.1 Buffer Pool

- Apakah buffer pool cukup untuk working set utama?
- Apakah tabel/index hot teridentifikasi?
- Apakah restart/failover memperhitungkan cold cache?
- Apakah report/export mencemari buffer pool primary?

### 47.2 Memory

- Apakah ada headroom OS?
- Apakah per-connection memory dipertimbangkan?
- Apakah `max_connections` realistis?
- Apakah total Hikari pool seluruh fleet dihitung?
- Apakah temp table workload punya batas?

### 47.3 I/O

- Apakah storage IOPS/throughput cukup?
- Apakah fsync latency dimonitor?
- Apakah dirty page/checkpoint pressure dimonitor?
- Apakah backup/report/migration bersamaan dengan peak traffic?

### 47.4 Java

- Apakah pool size dibatasi?
- Apakah transaksi pendek?
- Apakah query export async?
- Apakah retry memakai backoff?
- Apakah batch job punya throttle?
- Apakah query hanya mengambil kolom yang perlu?

### 47.5 Query

- Apakah query dashboard memakai index filter+order?
- Apakah offset pagination dihindari untuk data besar?
- Apakah `SELECT *` dihindari di path hot?
- Apakah temporary disk table dipantau?
- Apakah sorting besar dipahami?

---

## 48. Exercise

### Exercise 1 — Hit Ratio Trap

Kamu melihat buffer pool hit ratio 99.9%, tetapi endpoint list case tetap lambat.

Jelaskan minimal lima kemungkinan penyebab.

Petunjuk:

- rows examined,
- sorting,
- temp table,
- CPU,
- network payload,
- lock wait,
- non-covering index,
- query plan.

### Exercise 2 — Pool Sizing

Ada 12 pod Java, masing-masing Hikari pool 40. Database primary punya 16 vCPU dan `max_connections=600`.

Pertanyaan:

1. Berapa total possible app connections?
2. Apa risikonya?
3. Metric apa yang harus dilihat sebelum menaikkan pool?
4. Bagaimana pendekatan sizing yang lebih sehat?

### Exercise 3 — Batch Update

Job update 5 juta row menyebabkan replication lag dan write latency spike.

Desain ulang job tersebut dengan:

- batch size,
- progress checkpoint,
- retry,
- throttling,
- metric stop condition,
- idempotency.

### Exercise 4 — Hot/Cold Split

Tabel `cases` memiliki 50 kolom termasuk JSON payload besar. Endpoint dashboard hanya butuh 8 kolom.

Desain ulang schema/query agar buffer pool lebih efisien.

### Exercise 5 — Report Isolation

Sistem punya laporan SLA bulanan yang membaca 300 juta `case_events`.

Buat tiga alternatif arsitektur untuk mencegah laporan tersebut mengganggu OLTP primary.

---

## 49. Jawaban Singkat Exercise

### Jawaban 1

Hit ratio tinggi tapi lambat bisa terjadi karena:

- query membaca terlalu banyak row dari memory,
- sort/temp table mahal,
- CPU bottleneck,
- lock wait,
- network payload besar,
- query tidak covering,
- ORM melakukan N+1,
- result set besar,
- app connection pool penuh,
- transaction menunggu resource lain.

### Jawaban 2

Total possible connections:

```text
12 * 40 = 480
```

Risiko:

- hampir menyentuh `max_connections`,
- DB concurrency terlalu tinggi,
- memory per-session besar,
- lock/I/O contention,
- autoscaling bisa menambah tekanan.

Lihat:

- active vs idle Hikari,
- Threads_running,
- query latency,
- DB CPU/I/O,
- lock waits,
- connection acquisition time,
- throughput aktual.

### Jawaban 3

Ubah menjadi batch by primary key, misalnya 500-2000 row per transaksi, dengan progress table, retry idempotent, sleep adaptif berdasarkan replication lag/DB latency, dan stop jika lag/latency melewati threshold.

### Jawaban 4

Pisahkan payload besar ke tabel detail, gunakan query listing yang hanya mengambil kolom dashboard, buat index composite untuk filter+order, dan gunakan keyset pagination.

### Jawaban 5

Alternatif:

1. read replica khusus reporting,
2. summary table/pre-aggregation di MySQL,
3. pipeline CDC ke OLAP/search store.

---

## 50. Ringkasan Mental Model

MySQL/InnoDB performa production sangat bergantung pada memory dan I/O behavior.

Ingat prinsip berikut:

1. InnoDB bekerja pada page, bukan row individual.
2. Buffer pool adalah workspace utama InnoDB.
3. Working set lebih penting daripada total database size.
4. Query cepat jika page yang dibutuhkan hot dan access path efisien.
5. Dirty page memungkinkan write cepat, tetapi harus diflush akhirnya.
6. Checkpoint pressure dapat membuat latency spike.
7. Storage latency, khususnya fsync dan random I/O, sangat penting.
8. Per-connection memory membuat connection pool terlalu besar menjadi berbahaya.
9. Reporting/export dapat mencemari cache dan mengganggu OLTP.
10. Java pool size adalah concurrency control, bukan sekadar konfigurasi koneksi.
11. Batch besar harus dikontrol agar redo/undo/dirty page/replication tetap manageable.
12. Observability harus menggabungkan app metrics, MySQL metrics, dan storage metrics.

Kalimat kunci:

> Performa MySQL yang stabil bukan hasil dari satu query cepat, tetapi hasil dari workload yang memory-conscious, I/O-conscious, dan concurrency-conscious.

---

## 51. Referensi Resmi yang Relevan

Gunakan referensi ini saat ingin memvalidasi detail implementasi atau konfigurasi:

- MySQL 8.4 Reference Manual — InnoDB Buffer Pool
- MySQL 8.4 Reference Manual — InnoDB Buffer Pool Configuration
- MySQL 8.4 Reference Manual — Change Buffer
- MySQL 8.4 Reference Manual — Adaptive Hash Index
- MySQL 8.4 Reference Manual — Configuring InnoDB I/O Capacity
- MySQL 8.4 Reference Manual — InnoDB Startup Options and System Variables
- MySQL Reference Manual — Internal Temporary Tables
- MySQL Reference Manual — Performance Schema and sys schema

---

## 52. Koneksi ke Part Berikutnya

Bagian ini menjelaskan memory dan I/O behavior.

Part berikutnya akan membahas:

```text
Part 019 — Configuration That Actually Matters
```

Di sana kita akan membangun prinsip konfigurasi MySQL production:

- global vs session variables,
- persisted variables,
- InnoDB core settings,
- timeout settings,
- SQL mode,
- binary log settings,
- character set/time zone defaults,
- dangerous legacy defaults,
- config drift,
- checklist konfigurasi production.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Write Path Internals: Redo Log, Undo Log, Binlog, Doublewrite</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-019.md">Part 019 — Configuration That Actually Matters ➡️</a>
</div>

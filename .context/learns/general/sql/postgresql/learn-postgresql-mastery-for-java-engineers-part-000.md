# learn-postgresql-mastery-for-java-engineers-part-000.md

# Part 000 — PostgreSQL sebagai Database Engine, bukan Sekadar SQL Database

## Status Seri

Seri: `learn-postgresql-mastery-for-java-engineers`  
Part: `000` dari `034`  
Status: **belum selesai**. Ini adalah bagian pertama/fondasi. Masih ada Part 001 sampai Part 034.

## Target Pembaca

Materi ini ditulis untuk Java software engineer yang sudah memahami SQL dasar dan ingin naik level dari:

```text
"Saya bisa menulis query PostgreSQL"
```

menjadi:

```text
"Saya memahami bagaimana PostgreSQL menjaga correctness, durability, concurrency, performance, dan operability di sistem produksi."
```

Kita tidak akan mengulang materi SQL umum secara panjang. Fokus seri ini adalah PostgreSQL sebagai **database engine produksi**: proses, storage, MVCC, WAL, planner, locking, index internals, vacuum, replication, backup, observability, migration, Java integration, dan failure modelling.

---

# 1. Kenapa Part 000 Ini Penting

Banyak engineer belajar PostgreSQL dari permukaan:

```sql
SELECT * FROM users WHERE id = ?;
CREATE INDEX idx_users_email ON users(email);
BEGIN;
COMMIT;
```

Itu berguna, tetapi belum cukup untuk production engineering.

Di sistem produksi, pertanyaan yang muncul bukan hanya:

```text
Bagaimana menulis query ini?
```

melainkan:

```text
Kenapa query ini lambat hari ini padahal kemarin cepat?
Kenapa index sudah ada tapi tidak dipakai planner?
Kenapa table membesar padahal row count tidak naik signifikan?
Kenapa transaksi Java terlihat benar tapi tetap race condition?
Kenapa replica tertinggal dan user membaca data lama?
Kenapa migration ADD COLUMN menyebabkan lock panjang?
Kenapa pool connection penuh padahal CPU database rendah?
Kenapa VACUUM tidak bisa membersihkan dead tuple?
Kenapa database tidak bisa start setelah disk penuh?
Kenapa backup ada, tetapi restore gagal memenuhi RTO?
```

Pertanyaan seperti itu tidak bisa dijawab hanya dengan SQL syntax. Butuh model internal.

Part 000 ini bertujuan memberi peta besar. Kita akan membangun vocabulary, mental model, dan cara melihat PostgreSQL sebagai sistem stateful yang hidup, bukan sebagai kotak hitam penerima query.

---

# 2. PostgreSQL Bukan Hanya “Relational Database”

Secara formal, PostgreSQL adalah object-relational database management system. Ia mendukung SQL, transaksi, constraint, indexing, extensibility, data type kaya, function, operator, replication, dan banyak fitur produksi.

Namun dari perspektif software architecture, PostgreSQL lebih tepat dipahami sebagai kombinasi beberapa subsistem:

```text
PostgreSQL
├── Client/server protocol layer
├── Authentication and session management
├── SQL parser/analyzer
├── Query rewriter
├── Planner/optimizer
├── Executor
├── Access methods
├── Buffer manager
├── Lock manager
├── MVCC visibility engine
├── Heap storage
├── Index storage
├── WAL and crash recovery
├── Checkpointing
├── Vacuum/autovacuum
├── Statistics collector/cumulative stats
├── Replication subsystem
├── Backup/recovery subsystem
├── Extension system
└── System catalogs
```

Ketika Java service menjalankan query, ia sedang memicu rangkaian subsistem tersebut.

Contoh sederhana:

```java
User user = userRepository.findByEmail(email);
```

Di bawahnya bisa terjadi:

```text
Java method call
  ↓
Spring Data / Hibernate / jOOQ / JDBC
  ↓
Connection pool mengambil koneksi
  ↓
pgJDBC mengirim query melalui PostgreSQL wire protocol
  ↓
PostgreSQL backend process menerima query
  ↓
Parser membuat parse tree
  ↓
Analyzer memvalidasi nama table/column/type
  ↓
Rewriter menerapkan rule/view rewrite bila ada
  ↓
Planner memilih sequential scan / index scan / bitmap scan / join strategy
  ↓
Executor menjalankan plan
  ↓
Buffer manager mencari page di shared buffers atau disk
  ↓
MVCC mengecek apakah tuple visible untuk snapshot transaksi
  ↓
Result row dikirim balik ke client
  ↓
JDBC mapping menjadi Java object
```

Jika query itu `UPDATE`, rangkaiannya bertambah:

```text
Executor menemukan row lama
  ↓
Lock row
  ↓
Buat tuple version baru
  ↓
Tandai tuple lama tidak lagi current
  ↓
Update index bila perlu
  ↓
Tulis WAL record
  ↓
Commit menunggu WAL flush sesuai durability setting
  ↓
Dead tuple lama akan dibersihkan nanti oleh VACUUM
```

Dari sini terlihat bahwa PostgreSQL bukan sekadar tempat menyimpan tabel. Ia adalah engine yang menjaga konsistensi melalui banyak mekanisme internal.

---

# 3. Tujuan Seri Ini

Target akhir seri ini adalah membuat kamu bisa berpikir seperti engineer yang bisa mengoperasikan PostgreSQL di sistem nyata.

Bukan hanya bisa:

```text
- Membuat table
- Membuat index
- Menulis query
- Menjalankan migration
```

Tetapi bisa:

```text
- Menjelaskan kenapa PostgreSQL memilih execution plan tertentu
- Membaca EXPLAIN ANALYZE secara benar
- Mendesain index berdasarkan access pattern, bukan feeling
- Memahami dampak transaksi panjang terhadap vacuum
- Memilih isolation level berdasarkan invariant domain
- Mendesain constraint untuk mencegah race condition
- Menghindari migration yang mengunci table besar
- Mengatur pool connection Java agar tidak membunuh database
- Menentukan kapan JSONB tepat dan kapan berbahaya
- Mendesain backup/restore berdasarkan RPO/RTO
- Menjelaskan read-after-write issue pada replica
- Mendiagnosis lock contention
- Membedakan CPU-bound, IO-bound, lock-bound, memory-bound workload
- Melakukan tuning berdasarkan observasi, bukan cargo cult
```

---

# 4. Hal yang Tidak Akan Diulang dari Seri SQL

Karena kamu sudah punya seri SQL, kita tidak akan menghabiskan banyak ruang untuk:

```text
- SELECT dasar
- WHERE dasar
- JOIN syntax umum
- GROUP BY dasar
- HAVING dasar
- ORDER BY dasar
- Normalisasi dasar
- Primary key/foreign key sebagai konsep umum
- ACID sebagai definisi textbook panjang
```

Tetapi konsep tersebut akan tetap muncul ketika diperlukan untuk PostgreSQL-specific reasoning.

Contoh:

Kita tidak akan mengulang:

```sql
SELECT u.name, o.total
FROM users u
JOIN orders o ON o.user_id = u.id;
```

Tetapi kita akan membahas:

```text
Kenapa PostgreSQL memilih Hash Join, Nested Loop, atau Merge Join?
Kenapa cardinality estimate salah?
Kenapa index pada orders.user_id tidak cukup?
Kenapa join order berubah setelah ANALYZE?
Kenapa plan berbeda antara literal query dan prepared statement?
```

---

# 5. PostgreSQL dari Sudut Pandang Java Engineer

Java backend engineer biasanya berinteraksi dengan PostgreSQL melalui salah satu stack berikut:

```text
Java application
├── Spring Boot
│   ├── Spring JDBC
│   ├── Spring Data JPA
│   └── Transaction manager
├── Hibernate / JPA
├── jOOQ
├── MyBatis
├── plain JDBC
├── R2DBC, kadang-kadang
└── Connection pool, biasanya HikariCP
```

Di permukaan, stack tersebut membuat database terlihat seperti dependency biasa. Namun PostgreSQL memiliki sifat yang berbeda dari service stateless.

Service stateless:

```text
- Bisa diskalakan horizontal relatif mudah
- Request tidak terlalu terikat state internal proses
- Restart biasanya tidak mengubah data permanen
- Load balancer bisa menyebar request
```

PostgreSQL:

```text
- Stateful
- Memiliki storage permanen
- Memiliki WAL dan recovery lifecycle
- Memiliki lock dan transaction state
- Memiliki session state
- Memiliki background maintenance
- Tidak bisa "ditambah instance" seperti app server biasa untuk write scaling
- Memiliki batas koneksi yang nyata
- Memiliki konsekuensi berat bila disk, memory, atau WAL bermasalah
```

Kesalahan umum Java engineer adalah memperlakukan PostgreSQL seperti remote collection:

```java
List<Order> orders = orderRepository.findByStatus("OPEN");
```

Padahal query itu bisa berarti:

```text
- scan jutaan row
- sort besar ke disk
- lock contention
- stale statistics
- index tidak selective
- N+1 query dari ORM
- transaksi idle terlalu lama
- memory work_mem terpakai banyak per query
```

Di seri ini, kita akan selalu melihat PostgreSQL dari dua sisi:

```text
Application perspective:
Apa yang Java service lakukan?

Database perspective:
Apa yang PostgreSQL benar-benar kerjakan?
```

---

# 6. Model Besar PostgreSQL: Query, State, dan Time

Untuk memahami PostgreSQL, gunakan tiga dimensi utama:

```text
1. Query
2. State
3. Time
```

## 6.1 Query

Query adalah instruksi yang dikirim client.

Contoh:

```sql
SELECT * FROM enforcement_case WHERE case_id = $1;
```

Namun PostgreSQL tidak menjalankan SQL text secara langsung. SQL melewati pipeline:

```text
SQL text
  ↓
Parse
  ↓
Analyze
  ↓
Rewrite
  ↓
Plan
  ↓
Execute
```

Pertanyaan penting:

```text
- Apakah query bisa menggunakan index?
- Apakah planner memperkirakan jumlah row dengan benar?
- Apakah query membaca terlalu banyak data?
- Apakah query menunggu lock?
- Apakah query menghasilkan temp file?
- Apakah query dipengaruhi prepared statement generic plan?
```

## 6.2 State

State adalah data dan metadata yang hidup di PostgreSQL.

State mencakup:

```text
- Table data
- Index data
- Tuple versions
- Transaction IDs
- WAL records
- Statistics
- Locks
- Connection/session state
- Replication slots
- System catalogs
- Visibility map
- Free space map
```

Masalah produksi sering terjadi karena state tersembunyi ini berubah.

Contoh:

```text
Row count sama, tetapi table size naik.
```

Kemungkinan:

```text
- banyak dead tuples
- vacuum tertahan
- index bloat
- HOT update tidak terjadi
- fillfactor tidak cocok
```

Contoh lain:

```text
Query sama, data sama, tapi plan berubah.
```

Kemungkinan:

```text
- statistics berubah
- parameter berbeda
- generic plan dipilih
- cache state berbeda
- table/index bloat mengubah cost
- PostgreSQL versi baru punya planner behavior berbeda
```

## 6.3 Time

Database adalah sistem yang berubah terhadap waktu.

Ada waktu dalam banyak bentuk:

```text
- Transaction lifetime
- Statement duration
- Lock wait duration
- WAL flush time
- Checkpoint interval
- Autovacuum cadence
- Replication lag
- Backup window
- Retention window
- Query latency percentile
- Migration duration
```

Engineer yang kuat tidak hanya bertanya:

```text
Apakah query benar?
```

Tetapi juga:

```text
Berapa lama query berjalan?
Apa yang terjadi selama query berjalan?
Apa yang query tahan?
Apa yang menahan query?
Apa efeknya terhadap transaksi lain?
Apa efeknya terhadap vacuum?
Apa efeknya terhadap WAL, replica, dan backup?
```

---

# 7. PostgreSQL sebagai Sistem Client/Server

PostgreSQL berjalan sebagai database server. Aplikasi Java adalah client.

Model sederhananya:

```text
Java App Instance A ─┐
Java App Instance B ─┼── TCP connections ── PostgreSQL Server
Java App Instance C ─┘
```

Setiap koneksi bukan benda gratis. Koneksi membawa:

```text
- backend process/server-side resources
- session state
- memory overhead
- transaction state
- prepared statement state
- temporary objects
- locks jika transaksi aktif
```

Kesalahan umum:

```text
App punya 20 instance.
Setiap instance HikariCP maxPoolSize = 50.
Total potensi koneksi = 1000.
PostgreSQL dipaksa melayani 1000 backend process.
CPU context switching naik.
Memory pressure naik.
Latency naik.
Database makin lambat.
Pool makin penuh.
Aplikasi retry.
Database makin hancur.
```

Ini contoh positive feedback loop buruk:

```text
Slow DB
  ↓
Connection tertahan lebih lama
  ↓
Pool penuh
  ↓
Request menunggu
  ↓
Timeout/retry
  ↓
Query lebih banyak
  ↓
DB makin lambat
```

Karena itu, connection management bukan detail konfigurasi kecil. Ia adalah bagian dari arsitektur PostgreSQL.

---

# 8. PostgreSQL Execution Pipeline

Saat PostgreSQL menerima query, ia tidak langsung membaca table.

Pipeline konseptual:

```text
Client query
  ↓
Parser
  ↓
Analyzer
  ↓
Rewriter
  ↓
Planner / Optimizer
  ↓
Executor
  ↓
Access methods
  ↓
Buffer manager
  ↓
Storage / WAL / locks / MVCC
```

## 8.1 Parser

Parser mengubah SQL text menjadi parse tree.

Contoh input:

```sql
SELECT id, status
FROM enforcement_case
WHERE status = 'OPEN';
```

Output konseptual:

```text
SelectStmt
├── targetList: id, status
├── fromClause: enforcement_case
└── whereClause: status = 'OPEN'
```

Parser belum memahami semua detail semantic. Ia terutama memahami grammar.

## 8.2 Analyzer

Analyzer mengecek:

```text
- table ada atau tidak
- column ada atau tidak
- operator cocok dengan type
- function resolve
- privilege
- type coercion
```

Jika kamu menulis:

```sql
SELECT unknown_column FROM enforcement_case;
```

Error semantic terjadi di tahap ini.

## 8.3 Rewriter

PostgreSQL memiliki rule system. View, misalnya, dapat di-rewrite menjadi query terhadap underlying table.

Contoh:

```sql
SELECT * FROM active_cases;
```

Bila `active_cases` adalah view:

```sql
CREATE VIEW active_cases AS
SELECT * FROM enforcement_case WHERE closed_at IS NULL;
```

Maka query dapat di-rewrite menjadi bentuk yang mengacu ke `enforcement_case`.

## 8.4 Planner / Optimizer

Planner memilih cara menjalankan query.

Untuk query:

```sql
SELECT * FROM enforcement_case WHERE status = 'OPEN';
```

Planner bisa memilih:

```text
- Sequential Scan
- Index Scan
- Bitmap Index Scan + Bitmap Heap Scan
```

Pilihan bergantung pada:

```text
- estimasi jumlah row
- statistics
- index yang tersedia
- cost setting
- table size
- correlation
- selectivity predicate
- parameter query
- join relation
```

Planner tidak tahu masa depan. Ia membuat estimasi.

Banyak masalah performa berasal dari satu kalimat ini:

```text
Planner memilih plan berdasarkan estimasi, bukan kenyataan sempurna.
```

## 8.5 Executor

Executor menjalankan plan node.

Contoh plan sederhana:

```text
Index Scan using idx_case_status on enforcement_case
  Index Cond: status = 'OPEN'
```

Executor akan:

```text
- membaca index page
- menemukan TID/table row reference
- membaca heap page
- memeriksa MVCC visibility
- mengembalikan row visible
```

Index tidak otomatis cukup. Untuk PostgreSQL heap table, index entry menunjuk ke heap tuple. Visibility tetap harus dicek, kecuali kondisi tertentu memungkinkan index-only scan.

---

# 9. PostgreSQL Storage Mental Model

PostgreSQL menyimpan data dalam struktur fisik.

Model tinggi:

```text
Cluster data directory
├── global metadata
├── database directories
│   ├── relation files
│   ├── index files
│   ├── TOAST files
│   ├── free space map
│   └── visibility map
├── pg_wal
├── pg_xact
├── pg_multixact
├── pg_stat
└── configuration/control files
```

Dalam table, data disimpan sebagai page/block, umumnya 8KB.

```text
Table relation
├── Page 0
│   ├── tuple pointer
│   ├── tuple pointer
│   └── tuple data
├── Page 1
├── Page 2
└── ...
```

Row di PostgreSQL lebih tepat disebut tuple. Karena MVCC, satu logical row bisa punya banyak physical tuple version.

Contoh logical row:

```text
case_id = 123, status = OPEN
```

Setelah update:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED'
WHERE case_id = 123;
```

Secara konseptual:

```text
Old tuple version:
case_id = 123, status = OPEN, visible_to_old_snapshots

New tuple version:
case_id = 123, status = ESCALATED, visible_to_new_snapshots
```

Ini penting karena UPDATE bukan sekadar overwrite.

Konsekuensinya:

```text
- UPDATE menghasilkan dead tuple
- Dead tuple perlu dibersihkan VACUUM
- Index bisa ikut bertambah
- Table bisa bloat
- Long-running transaction bisa menahan cleanup
```

---

# 10. MVCC: Fondasi Concurrency PostgreSQL

MVCC adalah Multi-Version Concurrency Control.

Intuisi sederhananya:

```text
Alih-alih satu row hanya punya satu versi global,
PostgreSQL bisa menyimpan beberapa versi row,
dan setiap transaksi melihat versi yang sesuai dengan snapshot-nya.
```

Tujuannya:

```text
- pembaca tidak perlu selalu memblokir penulis
- penulis tidak perlu selalu memblokir pembaca
- transaksi dapat melihat snapshot yang konsisten
```

Contoh:

```text
T1 mulai transaksi dan membaca case #123 = OPEN.
T2 mengubah case #123 menjadi ESCALATED lalu commit.
T1, tergantung isolation level, mungkin tetap melihat OPEN.
Transaksi baru T3 melihat ESCALATED.
```

Secara konseptual:

```text
Tuple version A: status = OPEN
Tuple version B: status = ESCALATED
```

Visibility ditentukan oleh metadata transaksi, seperti transaction ID yang membuat atau menghapus versi tuple.

## 10.1 MVCC Bukan Berarti Tanpa Lock

Ini kesalahpahaman besar.

MVCC mengurangi konflik read-write, tetapi PostgreSQL tetap menggunakan lock untuk banyak hal:

```text
- row modification
- DDL
- foreign key enforcement
- unique constraint enforcement
- explicit SELECT FOR UPDATE
- advisory lock
- predicate lock pada Serializable
```

Jadi statement berikut salah:

```text
PostgreSQL pakai MVCC, jadi tidak ada blocking.
```

Yang lebih benar:

```text
MVCC membuat read biasa tidak memblokir write biasa dan sebaliknya dalam banyak kasus, tetapi blocking tetap mungkin dan sering terjadi pada operasi write-write, DDL, constraint, dan explicit locking.
```

## 10.2 MVCC dan Java Service

Dalam Java service, transaksi sering disembunyikan oleh annotation:

```java
@Transactional
public void escalateCase(UUID caseId) {
    Case c = repository.findById(caseId).orElseThrow();
    c.escalate();
    repository.save(c);
}
```

Kode ini terlihat atomik. Namun correctness tergantung pada:

```text
- isolation level
- apakah row dikunci
- apakah ada optimistic locking/version column
- apakah invariant dijaga constraint
- apakah concurrent transaction bisa membaca state lama
- apakah update condition cukup spesifik
```

Contoh race condition:

```text
Invariant: satu case hanya boleh punya satu active assignment.

T1 cek tidak ada active assignment.
T2 cek tidak ada active assignment.
T1 insert active assignment.
T2 insert active assignment.
Hasil: dua active assignment.
```

Solusi kuat biasanya bukan hanya `@Transactional`, melainkan constraint:

```sql
CREATE UNIQUE INDEX uq_one_active_assignment
ON case_assignment(case_id)
WHERE ended_at IS NULL;
```

Inilah cara berpikir PostgreSQL untuk correctness: gunakan database sebagai penjaga invariant yang tidak bisa dilanggar oleh race antar aplikasi.

---

# 11. WAL: Fondasi Durability dan Recovery

WAL adalah Write-Ahead Log.

Aturan intinya:

```text
Sebelum perubahan data dianggap aman,
catatan perubahan harus ditulis lebih dulu ke WAL.
```

Ketika transaksi commit:

```text
Data page mungkin belum langsung ditulis ke file table.
Tetapi WAL record commit harus durable sesuai setting.
Jika crash terjadi, PostgreSQL bisa replay WAL untuk memulihkan konsistensi.
```

Model sederhana:

```text
UPDATE row
  ↓
Modify buffer page in memory
  ↓
Generate WAL record
  ↓
Commit flush WAL
  ↓
Later: checkpoint writes dirty pages to data files
```

WAL digunakan untuk:

```text
- crash recovery
- replication
- point-in-time recovery
- logical decoding
- backup consistency
```

## 11.1 Kenapa WAL Penting untuk Java Engineer

Karena aplikasi sering hanya melihat commit sukses/gagal.

Namun di bawahnya, commit latency bisa dipengaruhi oleh:

```text
- fsync latency
- synchronous_commit
- disk performance
- WAL volume
- checkpoint pressure
- replication synchronous mode
```

Contoh:

```text
Bulk update besar
  ↓
WAL volume melonjak
  ↓
Disk write pressure naik
  ↓
Commit latency naik
  ↓
Connection tertahan lebih lama
  ↓
Pool penuh
  ↓
Request timeout
```

Jadi performa write bukan hanya tentang jumlah row. Ia juga tentang WAL amplification.

---

# 12. Checkpoint: Titik Konsistensi di Data Files

PostgreSQL tidak harus menulis semua perubahan langsung ke table files saat commit. Banyak perubahan tinggal dulu di shared buffers sebagai dirty pages.

Checkpoint adalah proses yang memastikan dirty pages sampai titik tertentu ditulis ke disk sehingga recovery tidak perlu replay WAL terlalu jauh.

Model:

```text
WAL terus bertambah
Dirty pages terkumpul
Checkpoint terjadi
Dirty pages ditulis ke disk
Recovery point maju
```

Trade-off:

```text
Checkpoint terlalu sering:
- lebih banyak IO burst
- write amplification
- latency spike

Checkpoint terlalu jarang:
- recovery setelah crash lebih lama
- WAL retention lebih besar
```

Top-tier engineer tidak men-tune checkpoint dengan menebak. Ia melihat:

```text
- checkpoint frequency
- checkpoint write time
- WAL generation rate
- disk latency
- recovery objective
- workload write pattern
```

---

# 13. Vacuum dan Autovacuum: Maintenance yang Menentukan Hidup-Mati PostgreSQL

Karena MVCC menghasilkan tuple version, PostgreSQL membutuhkan proses pembersihan.

Setelah row di-update atau di-delete, versi lama tidak langsung hilang. Ia menjadi dead tuple ketika tidak lagi visible untuk transaksi mana pun.

VACUUM bertugas:

```text
- menemukan dead tuple
- menandai space bisa dipakai ulang
- membantu visibility map
- membantu mencegah transaction ID wraparound
- memperbarui beberapa metadata
```

Autovacuum adalah mekanisme otomatis untuk menjalankan VACUUM dan ANALYZE.

Masalah umum:

```text
Autovacuum dianggap optional.
```

Padahal autovacuum adalah bagian dari normal operation PostgreSQL.

## 13.1 Long-running Transaction sebagai Musuh Vacuum

Contoh:

```text
T1 membuka transaksi jam 10:00 dan tidak commit.
T2 sampai T100000 melakukan update/delete banyak row.
Autovacuum ingin membersihkan dead tuple.
Namun beberapa dead tuple mungkin masih dibutuhkan snapshot T1.
Cleanup tertahan.
Table dan index membesar.
Query makin lambat.
```

Ini sering terjadi karena:

```text
- aplikasi membuka transaksi terlalu lama
- cursor/streaming result tidak ditutup
- batch job lambat
- idle in transaction
- manual psql session lupa commit/rollback
```

Dari sisi Java, penyebabnya bisa:

```java
@Transactional
public void exportHugeReport() {
    List<Row> rows = repository.findHugeDataset();
    callExternalService();
    writeCsvSlowly(rows);
}
```

Masalah:

```text
Transaksi database tetap terbuka selama operasi non-database yang lambat.
```

Lebih baik boundary transaksi dipersempit.

---

# 14. Planner dan Statistics: Kenapa Query Bisa Salah Jalan

PostgreSQL planner memilih execution plan berdasarkan estimasi.

Estimasi membutuhkan statistics.

Statistics memberi informasi seperti:

```text
- jumlah row
- jumlah distinct value
- value paling umum
- distribusi nilai
- null fraction
- correlation
- extended statistics antar kolom
```

Contoh table:

```text
enforcement_case
├── status
├── tenant_id
├── region
├── created_at
└── priority
```

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = 'A'
  AND status = 'OPEN'
  AND priority = 'HIGH';
```

Jika planner menganggap predicate independen, padahal data sangat correlated, estimasi bisa salah.

Contoh:

```text
Planner estimate: 10 rows
Actual: 500,000 rows
```

Akibat:

```text
- planner memilih Nested Loop
- query menjadi sangat lambat
- CPU dan IO naik
- aplikasi timeout
```

Solusi mungkin:

```text
- ANALYZE
- extended statistics
- index composite yang tepat
- query rewrite
- data model adjustment
```

Bukan langsung:

```text
Tambah index di semua kolom.
```

---

# 15. Index Bukan Tombol Turbo

Index mempercepat sebagian read pattern, tetapi menambah biaya lain.

Manfaat index:

```text
- lookup lebih cepat
- range scan lebih efisien
- sort avoidance
- uniqueness enforcement
- join support
- index-only scan pada kondisi tertentu
```

Biaya index:

```text
- insert lebih mahal
- update lebih mahal
- delete lebih mahal
- storage bertambah
- WAL bertambah
- vacuum/index maintenance bertambah
- planner search space bertambah
- bloat bisa terjadi
```

Anti-pattern:

```text
Query lambat → tambah index → query lain lambat → tambah index lagi → write throughput turun → vacuum berat → storage membengkak.
```

Cara berpikir yang benar:

```text
Access pattern → predicate shape → data distribution → selectivity → ordering requirement → index design
```

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND status = $2
ORDER BY created_at DESC
LIMIT 50;
```

Index kandidat:

```sql
CREATE INDEX idx_case_tenant_status_created_desc
ON enforcement_case(tenant_id, status, created_at DESC);
```

Tapi ini belum pasti benar. Perlu melihat:

```text
- cardinality tenant_id
- cardinality status
- distribusi per tenant
- apakah status sangat skewed
- apakah query selalu ORDER BY created_at DESC
- apakah LIMIT kecil
- apakah ada filter tambahan
- write frequency table
```

Index design adalah engineering decision, bukan pattern hafalan.

---

# 16. Locking: Correctness dan Contention

PostgreSQL memiliki banyak jenis lock. Untuk Part 000, cukup pahami bahwa lock dipakai untuk menjaga struktur dan data tetap konsisten.

Jenis besar:

```text
- table-level locks
- row-level locks
- page/internal locks
- predicate locks
- advisory locks
```

Contoh row locking:

```sql
SELECT *
FROM enforcement_case
WHERE case_id = $1
FOR UPDATE;
```

Ini memberi sinyal:

```text
Saya akan mengubah row ini; transaksi lain yang ingin mengubah row sama harus menunggu.
```

Lock diperlukan untuk beberapa workflow:

```text
- case escalation
- inventory reservation
- payment capture
- task claiming
- exactly-once-ish processing
- state transition yang harus linear
```

Namun lock juga dapat menyebabkan:

```text
- blocking
- deadlock
- queueing
- latency spike
- transaction timeout
```

## 16.1 Locking dan Workflow State Machine

Misalnya ada state machine:

```text
DRAFT → SUBMITTED → UNDER_REVIEW → ESCALATED → CLOSED
```

Jika dua actor mencoba transisi bersamaan:

```text
T1: UNDER_REVIEW → ESCALATED
T2: UNDER_REVIEW → CLOSED
```

Tanpa kontrol concurrency, hasil bisa tidak deterministik.

Pilihan desain:

```text
1. Optimistic locking dengan version column
2. Pessimistic locking dengan SELECT FOR UPDATE
3. Conditional update
4. Constraint-backed invariant
5. Serializable transaction + retry
```

Contoh conditional update:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED', version = version + 1
WHERE case_id = $1
  AND status = 'UNDER_REVIEW'
  AND version = $2;
```

Jika affected row = 0, transisi gagal karena state sudah berubah.

Ini sering lebih baik daripada membaca state lalu update tanpa guard.

---

# 17. Constraint sebagai Domain Invariant

PostgreSQL bukan hanya tempat penyimpanan. Ia bisa menjadi penjaga kebenaran domain.

Constraint umum:

```text
- NOT NULL
- CHECK
- UNIQUE
- PRIMARY KEY
- FOREIGN KEY
- EXCLUSION
- DEFERRABLE constraint
```

Contoh invariant:

```text
Satu case hanya boleh punya satu assignment aktif.
```

Implementasi kuat:

```sql
CREATE UNIQUE INDEX uq_case_one_active_assignment
ON case_assignment(case_id)
WHERE ended_at IS NULL;
```

Contoh invariant lain:

```text
Tanggal selesai tidak boleh sebelum tanggal mulai.
```

```sql
ALTER TABLE investigation
ADD CONSTRAINT chk_investigation_time_order
CHECK (closed_at IS NULL OR closed_at >= opened_at);
```

Mengapa constraint penting?

Karena aplikasi bisa punya banyak instance:

```text
App A
App B
App C
Background worker
Admin tool
Migration script
Manual SQL
```

Jika invariant hanya ada di Java code, semua jalur harus disiplin. Jika invariant ada di database, PostgreSQL menolak data invalid dari semua jalur.

Top-tier PostgreSQL engineer melihat constraint sebagai bagian dari architecture, bukan formalitas schema.

---

# 18. PostgreSQL dan Sistem Produksi: Lima Sifat Utama

Untuk sistem produksi, PostgreSQL harus dilihat melalui lima sifat:

```text
1. Correctness
2. Durability
3. Performance
4. Availability
5. Operability
```

## 18.1 Correctness

Pertanyaan:

```text
Apakah data tetap benar di bawah concurrency, retry, failure, dan partial execution?
```

Tools:

```text
- transaction
- isolation level
- lock
- constraint
- idempotency key
- unique index
- foreign key
- check constraint
- serializable transaction
```

## 18.2 Durability

Pertanyaan:

```text
Jika commit sukses, apakah data bisa dipulihkan setelah crash?
```

Tools:

```text
- WAL
- fsync
- checkpoint
- synchronous_commit
- backup
- PITR
- replication
```

## 18.3 Performance

Pertanyaan:

```text
Apakah database memenuhi latency dan throughput target di workload nyata?
```

Tools:

```text
- indexing
- query planning
- statistics
- memory tuning
- connection pooling
- schema design
- batching
- partitioning
- query rewrite
```

## 18.4 Availability

Pertanyaan:

```text
Apakah sistem tetap melayani ketika node, disk, network, atau process bermasalah?
```

Tools:

```text
- replication
- failover
- backups
- connection routing
- retry policy
- read replica
- HA architecture
```

## 18.5 Operability

Pertanyaan:

```text
Bisakah tim mengamati, mendiagnosis, memperbaiki, upgrade, restore, dan menjalankan PostgreSQL dengan aman?
```

Tools:

```text
- logs
- metrics
- pg_stat views
- runbook
- alerting
- migration strategy
- restore drill
- capacity planning
- version upgrade plan
```

---

# 19. Mental Model: PostgreSQL sebagai State Machine Besar

Sebagai engineer yang tertarik pada lifecycle modelling, kamu bisa melihat PostgreSQL sebagai state machine berlapis.

## 19.1 Transaction State Machine

```text
IDLE
  ↓ BEGIN
IN TRANSACTION
  ↓ query ok
IN TRANSACTION
  ↓ error
FAILED TRANSACTION
  ↓ ROLLBACK
IDLE
  ↓ COMMIT
IDLE
```

Dalam PostgreSQL, setelah error dalam transaksi, transaksi masuk state aborted/failed sampai rollback.

Dari Java, ini penting:

```text
Jika satu statement gagal dalam transaksi,
statement berikutnya bisa ikut gagal sampai transaksi di-rollback.
```

## 19.2 Row Lifecycle State Machine

Logical row mengalami lifecycle:

```text
Non-existent
  ↓ INSERT
Live tuple
  ↓ UPDATE
Old tuple dead eventually + new live tuple
  ↓ DELETE
Dead tuple
  ↓ VACUUM
Reusable space
```

Tetapi “dead eventually” bergantung pada snapshot transaksi lain.

## 19.3 Query Lifecycle State Machine

```text
Received
  ↓ parse
Parsed
  ↓ analyze
Analyzed
  ↓ rewrite
Rewritten
  ↓ plan
Planned
  ↓ execute
Executing
  ↓ done/error/cancel/timeout
Completed/Failed
```

## 19.4 Connection Lifecycle State Machine

```text
Disconnected
  ↓ connect/authenticate
Connected idle
  ↓ BEGIN/query
Active
  ↓ waiting lock/io/cpu
Waiting/Running
  ↓ done
Idle
  ↓ BEGIN but no activity
Idle in transaction
  ↓ timeout/commit/rollback
Idle/Disconnected
```

`idle in transaction` adalah state yang sering merusak vacuum dan menyebabkan lock tertahan.

## 19.5 Replication State Machine

```text
Primary generates WAL
  ↓
WAL sent to standby
  ↓
Standby receives WAL
  ↓
Standby writes WAL
  ↓
Standby replays WAL
  ↓
Replica catches up or lags
```

Read replica bukan magic. Ia membaca masa lalu jika replay tertinggal.

---

# 20. PostgreSQL dan Failure Modelling

PostgreSQL harus dirancang dengan asumsi failure akan terjadi.

Failure yang relevan:

```text
Application failure:
- request timeout
- retry storm
- connection leak
- transaction tidak ditutup
- bug migration

Database process failure:
- backend process crash
- postmaster restart
- extension crash

Infrastructure failure:
- disk full
- disk latency tinggi
- fsync bermasalah
- network partition
- VM/container restart

Data failure:
- accidental delete
- bad update without WHERE
- migration corrupts data
- duplicate business records
- broken invariant

Operational failure:
- backup tidak bisa direstore
- replica lag tidak dimonitor
- alert terlalu noisy
- failover tidak pernah diuji
```

Engineer matang tidak hanya bertanya:

```text
Bagaimana membuat ini berjalan?
```

Tetapi:

```text
Bagaimana ini gagal?
Bagaimana kita tahu ini gagal?
Apa blast radius-nya?
Apa recovery path-nya?
Apa invariant yang tetap harus benar saat gagal?
```

---

# 21. PostgreSQL dan Java Transaction Boundary

Di Java, transaction boundary sering terlihat seperti ini:

```java
@Transactional
public void submitCase(UUID caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    c.submit();
    caseRepository.save(c);
    notificationClient.sendCaseSubmitted(c.id());
}
```

Ada beberapa pertanyaan penting:

```text
Apakah HTTP call notification terjadi di dalam transaksi DB?
Jika notification lambat, apakah lock tertahan?
Jika transaksi rollback setelah notification dikirim, apakah external side effect sudah terjadi?
Jika method retry, apakah notification terkirim dua kali?
Jika dua request submit case bersamaan, apakah state transition aman?
```

PostgreSQL mastery selalu terkait application boundary.

Desain yang lebih aman sering memakai outbox:

```text
Begin transaction
  ↓
Update case state
  ↓
Insert outbox event
  ↓
Commit
  ↓
Background publisher membaca outbox
  ↓
Kirim notification dengan idempotency
```

Di sini PostgreSQL menjaga atomicity antara state change dan event record.

---

# 22. PostgreSQL Tidak Menyelesaikan Semua Masalah

PostgreSQL sangat kuat, tetapi bukan jawaban untuk semua hal.

PostgreSQL cocok untuk:

```text
- OLTP state utama
- relational integrity
- transactional workflow
- audit trail yang queryable
- moderate analytics
- JSONB hybrid modelling
- full-text search ringan-menengah
- event/outbox storage dengan volume terkendali
- geospatial dengan PostGIS
```

PostgreSQL kurang cocok sebagai satu-satunya solusi untuk:

```text
- high-throughput distributed log skala Kafka
- search engine ranking kompleks skala Elasticsearch/OpenSearch
- analytical warehouse skala sangat besar
- globally distributed multi-primary write tanpa trade-off besar
- cache latency sub-millisecond seperti Redis
- object/blob storage besar seperti S3
```

Top-tier engineer tidak fanatik. Ia tahu kapan PostgreSQL cukup, kapan perlu komponen lain, dan apa konsekuensi integrasinya.

---

# 23. Cara Belajar PostgreSQL yang Efektif

Belajar PostgreSQL sebaiknya tidak dimulai dari menghafal konfigurasi.

Urutan yang lebih kuat:

```text
1. Pahami lifecycle query
2. Pahami storage dan tuple version
3. Pahami MVCC dan transaction visibility
4. Pahami WAL dan durability
5. Pahami planner dan statistics
6. Pahami index internals
7. Pahami lock dan isolation
8. Pahami vacuum dan bloat
9. Pahami observability
10. Pahami backup/restore/replication
11. Pahami integration dengan Java
12. Pahami production failure modes
```

Konfigurasi seperti `shared_buffers`, `work_mem`, `checkpoint_timeout`, atau `autovacuum_*` baru masuk akal setelah kamu tahu subsistem yang dikendalikan.

---

# 24. Peta Seri dari Part 001 sampai Part 034

Setelah Part 000 ini, perjalanan kita:

```text
Part 001: Arsitektur proses PostgreSQL
Part 002: Connection lifecycle dan pooling Java
Part 003: Storage model
Part 004: MVCC deep dive
Part 005: Transaction isolation PostgreSQL
Part 006: WAL, durability, checkpoint, crash recovery
Part 007: Memory dan buffer manager
Part 008: Query lifecycle
Part 009: Planner statistics
Part 010: EXPLAIN mastery
Part 011: B-tree internals
Part 012: GIN/GiST/BRIN/Hash/SP-GiST
Part 013: Advanced index design
Part 014: Locking deep dive
Part 015: Constraints as invariants
Part 016: PostgreSQL-specific schema design
Part 017: JSONB dan hybrid modelling
Part 018: Partitioning
Part 019: Vacuum, autovacuum, freeze, bloat
Part 020: Write path performance
Part 021: Read path performance
Part 022: Functions, procedures, triggers
Part 023: Full text search
Part 024: Extensions
Part 025: Observability
Part 026: Backup, restore, PITR
Part 027: Replication
Part 028: High availability architecture
Part 029: Security
Part 030: Zero-downtime migration
Part 031: PostgreSQL dengan Java
Part 032: Workload-specific design
Part 033: Performance engineering methodology
Part 034: Production playbook
```

---

# 25. Kompetensi yang Harus Terbentuk Setelah Part 000

Setelah membaca Part 000, kamu belum diharapkan bisa men-tune PostgreSQL. Tetapi kamu harus punya peta mental.

Kamu harus bisa menjelaskan:

```text
1. PostgreSQL adalah database engine dengan banyak subsistem internal.
2. Query melewati parse, analyze, rewrite, plan, execute.
3. Planner memilih plan berdasarkan estimasi statistik.
4. MVCC membuat row bisa punya beberapa physical tuple version.
5. UPDATE bukan overwrite sederhana.
6. Dead tuple perlu dibersihkan vacuum.
7. WAL adalah fondasi durability, recovery, replication, dan PITR.
8. Connection PostgreSQL mahal dibanding object biasa di Java.
9. Lock tetap ada walaupun PostgreSQL memakai MVCC.
10. Constraint adalah alat menjaga invariant domain.
11. Database production harus dilihat dari correctness, durability, performance, availability, operability.
12. Banyak masalah PostgreSQL berasal dari interaksi application behavior dan database internals.
```

---

# 26. Kesalahan Mental Model yang Harus Dihindari

## 26.1 “Index Selalu Membuat Query Cepat”

Salah.

Lebih benar:

```text
Index membantu query tertentu dengan predicate dan ordering tertentu pada distribusi data tertentu, tetapi menambah biaya write, storage, WAL, dan maintenance.
```

## 26.2 “Kalau Sudah @Transactional Berarti Aman”

Salah.

Lebih benar:

```text
@Transactional memberi boundary transaksi, tetapi correctness tetap tergantung isolation, lock, constraint, retry, dan invariant design.
```

## 26.3 “Read Replica Menyelesaikan Scaling Read Tanpa Konsekuensi”

Salah.

Lebih benar:

```text
Read replica bisa membantu read scaling, tetapi membawa replication lag dan read-after-write consistency problem.
```

## 26.4 “VACUUM Itu Cleanup Opsional”

Salah.

Lebih benar:

```text
Vacuum adalah bagian normal dari cara PostgreSQL hidup dengan MVCC.
```

## 26.5 “Pool Connection Besar Berarti Throughput Besar”

Salah.

Lebih benar:

```text
Pool terlalu besar dapat meningkatkan concurrency melebihi kapasitas database, menyebabkan context switching, memory pressure, lock contention, dan latency lebih buruk.
```

## 26.6 “Backup Ada Berarti Aman”

Salah.

Lebih benar:

```text
Backup hanya berguna jika bisa direstore dalam target RPO/RTO dan sudah diuji.
```

---

# 27. Mini Case Study: Kenapa Query Tiba-tiba Lambat?

Misalnya ada endpoint:

```http
GET /cases?tenantId=A&status=OPEN&pageSize=50
```

Query:

```sql
SELECT id, status, priority, created_at
FROM enforcement_case
WHERE tenant_id = $1
  AND status = $2
ORDER BY created_at DESC
LIMIT 50;
```

Kemarin cepat. Hari ini lambat.

Engineer permukaan mungkin berkata:

```text
Tambah index.
```

Engineer PostgreSQL yang matang bertanya:

```text
1. Execution plan berubah atau tidak?
2. Rows estimate vs actual rows berapa?
3. Apakah statistics stale?
4. Apakah tenant A tumbuh jauh lebih besar?
5. Apakah status OPEN sangat dominan?
6. Apakah index mendukung WHERE sekaligus ORDER BY?
7. Apakah query menunggu lock?
8. Apakah table/index bloat?
9. Apakah cache state berubah?
10. Apakah ada autovacuum/checkpoint pressure?
11. Apakah app mengirim parameter sebagai prepared statement dan generic plan dipilih?
12. Apakah OFFSET pagination dipakai di halaman besar?
```

Kemungkinan solusi berbeda-beda:

```text
- ANALYZE table
- tambah extended statistics
- ubah composite index
- partial index untuk status tertentu
- keyset pagination
- kurangi select column
- perbaiki connection pool
- pecah transaksi panjang
- tune autovacuum table tertentu
```

Inilah tujuan seri ini: kamu tidak hanya punya resep, tetapi decision tree.

---

# 28. Mini Case Study: Race Condition pada Workflow Transition

Requirement:

```text
Case hanya boleh di-close jika semua task wajib sudah selesai.
```

Implementasi naif:

```java
@Transactional
public void closeCase(UUID caseId) {
    boolean hasOpenRequiredTask = taskRepository.existsOpenRequiredTask(caseId);
    if (hasOpenRequiredTask) {
        throw new IllegalStateException("Required tasks still open");
    }

    Case c = caseRepository.findById(caseId).orElseThrow();
    c.close();
    caseRepository.save(c);
}
```

Concurrent scenario:

```text
T1 closeCase melihat tidak ada open required task.
T2 membuat required task baru.
T1 close case.
Hasil: case CLOSED tetapi masih ada required task open.
```

Pertanyaan PostgreSQL:

```text
- Invariant harus dijaga di mana?
- Apakah perlu lock row case?
- Apakah task insert harus mengecek case status?
- Apakah foreign key/check constraint cukup?
- Apakah butuh trigger?
- Apakah perlu serializable transaction?
- Apakah workflow transition harus conditional update?
```

Kemungkinan desain:

```text
1. Semua operasi task/case mengunci row case yang sama.
2. Task insert menolak case CLOSED.
3. Close case memakai conditional update dan validasi dalam transaksi yang sama.
4. Invariant kritis dipindah ke constraint/trigger jika tidak bisa diekspresikan sebagai constraint biasa.
5. Serialization failure di-retry jika memakai SERIALIZABLE.
```

Pelajaran:

```text
Correctness bukan hanya urusan Java code. Correctness adalah kontrak antara Java transaction boundary, PostgreSQL isolation, lock, constraint, dan domain invariant.
```

---

# 29. Mini Case Study: Database Lambat Padahal CPU Rendah

Gejala:

```text
- Endpoint lambat
- Hikari pool penuh
- PostgreSQL CPU hanya 25%
- Memory masih cukup
```

Kemungkinan penyebab:

```text
- query menunggu lock
- disk IO latency tinggi
- connection menunggu karena transaksi lain idle
- semua backend menunggu client membaca result
- network lambat
- checkpoint write pressure
- replica sync commit menunggu standby
- pool exhaustion di aplikasi, bukan CPU bottleneck di DB
```

Langkah diagnosis:

```text
1. Lihat pg_stat_activity.
2. Periksa wait_event_type dan wait_event.
3. Cari transaksi idle in transaction.
4. Periksa pg_locks.
5. Lihat slow query log.
6. Lihat disk latency.
7. Lihat checkpoint dan WAL metrics.
8. Korelasikan dengan app traces.
```

Pelajaran:

```text
Database lambat tidak selalu berarti CPU penuh. Banyak bottleneck PostgreSQL adalah wait, bukan compute.
```

---

# 30. Istilah Kunci yang Akan Sering Dipakai

## 30.1 Cluster

Satu instance data PostgreSQL yang dikelola oleh satu server PostgreSQL. Cluster berisi banyak database.

## 30.2 Database

Namespace besar di dalam cluster. Koneksi client terhubung ke satu database tertentu.

## 30.3 Schema

Namespace object di dalam database, misalnya table, view, function.

## 30.4 Relation

Object seperti table atau index yang disimpan sebagai relation.

## 30.5 Tuple

Versi fisik row di table heap.

## 30.6 Page / Block

Unit storage dasar, biasanya 8KB.

## 30.7 Snapshot

Pandangan konsisten terhadap database pada waktu transaksi/statement tertentu.

## 30.8 Transaction ID

Identifier transaksi yang digunakan untuk MVCC visibility.

## 30.9 WAL

Write-Ahead Log, catatan perubahan untuk durability dan recovery.

## 30.10 LSN

Log Sequence Number, posisi dalam WAL stream.

## 30.11 Checkpoint

Titik ketika dirty pages sampai posisi tertentu ditulis ke disk sehingga recovery bisa dimulai dari checkpoint tersebut.

## 30.12 Vacuum

Proses membersihkan dead tuples dan menjaga kesehatan MVCC.

## 30.13 Analyze

Proses mengumpulkan statistics untuk planner.

## 30.14 Planner

Subsistem yang memilih execution plan.

## 30.15 Executor

Subsistem yang menjalankan execution plan.

## 30.16 Lock

Mekanisme sinkronisasi untuk menjaga consistency saat operasi concurrent.

## 30.17 Bloat

Pembesaran table/index akibat dead tuples atau space yang tidak efisien digunakan.

## 30.18 Replication Lag

Selisih antara perubahan di primary dan perubahan yang sudah diterima/replay di replica.

---

# 31. Checklist Mental Model Part 000

Gunakan checklist ini untuk menguji pemahaman.

## 31.1 Engine Model

Kamu paham bahwa:

```text
[ ] PostgreSQL memiliki parser, rewriter, planner, executor.
[ ] Query plan dipilih sebelum execution.
[ ] Planner menggunakan statistics dan cost estimation.
[ ] Execution plan bisa berubah walaupun SQL text sama.
```

## 31.2 Storage Model

Kamu paham bahwa:

```text
[ ] Table disimpan sebagai page/block.
[ ] Row fisik disebut tuple.
[ ] UPDATE membuat versi tuple baru.
[ ] Dead tuple perlu dibersihkan.
[ ] Index bisa ikut mengalami bloat.
```

## 31.3 Concurrency Model

Kamu paham bahwa:

```text
[ ] MVCC berarti snapshot-based visibility.
[ ] MVCC bukan berarti tidak ada lock.
[ ] Isolation level memengaruhi apa yang dilihat transaksi.
[ ] @Transactional tidak otomatis mencegah semua race condition.
```

## 31.4 Durability Model

Kamu paham bahwa:

```text
[ ] WAL ditulis sebelum data page dianggap aman.
[ ] Commit latency bisa dipengaruhi WAL flush.
[ ] Checkpoint memengaruhi IO dan recovery time.
[ ] Backup harus diuji dengan restore.
```

## 31.5 Production Model

Kamu paham bahwa:

```text
[ ] Pool terlalu besar bisa merusak database.
[ ] Slow database bisa disebabkan waiting, bukan CPU.
[ ] Autovacuum adalah bagian normal operasi.
[ ] Replica bisa stale.
[ ] Migration bisa mengambil lock berbahaya.
```

---

# 32. Latihan Berpikir

Jawab tanpa menjalankan PostgreSQL dulu. Tujuannya membentuk reasoning.

## Latihan 1

Sebuah query lambat. Ada index pada kolom filter. Sebutkan minimal 8 alasan kenapa query tetap lambat.

Petunjuk jawaban:

```text
- index tidak selective
- planner estimate salah
- statistics stale
- query butuh sort besar
- index tidak mendukung ORDER BY
- filter memakai expression yang tidak cocok dengan index
- data correlation buruk
- table/index bloat
- query menunggu lock
- result terlalu besar
- generic plan buruk
- work_mem kurang sehingga sort/hash spill ke disk
```

## Latihan 2

Kenapa transaksi yang hanya membaca data bisa mengganggu vacuum?

Petunjuk:

```text
Karena snapshot transaksi lama bisa membuat tuple version lama masih dianggap mungkin dibutuhkan, sehingga vacuum tidak boleh membersihkannya.
```

## Latihan 3

Kenapa constraint database lebih kuat daripada validasi Java untuk invariant kritis?

Petunjuk:

```text
Karena constraint berlaku untuk semua writer concurrent dan semua jalur perubahan data, termasuk multiple app instances, worker, migration, dan manual SQL.
```

## Latihan 4

Kenapa read replica dapat menyebabkan bug UX setelah user submit form?

Petunjuk:

```text
Write commit di primary, tetapi read berikutnya diarahkan ke replica yang belum replay WAL sampai perubahan tersebut. User melihat data lama.
```

## Latihan 5

Kenapa pool connection yang terlalu besar dapat menurunkan throughput?

Petunjuk:

```text
Karena concurrency melebihi kapasitas efektif database, meningkatkan memory pressure, context switching, lock contention, IO contention, dan queueing di database.
```

---

# 33. Prinsip-Prinsip Dasar Seri Ini

Sepanjang seri ini, kita akan memakai prinsip berikut.

## 33.1 Measure Before Tune

Jangan tuning dengan feeling.

Gunakan:

```text
- EXPLAIN ANALYZE
- pg_stat_activity
- pg_stat_statements
- pg_locks
- logs
- metrics
- traces
```

## 33.2 Access Pattern Before Index

Jangan mulai dari index. Mulai dari:

```text
- query apa yang sering terjadi
- predicate apa
- ordering apa
- limit apa
- data distribution bagaimana
- write frequency bagaimana
```

## 33.3 Invariant Before Code Style

Untuk domain penting, tanya:

```text
Invariant apa yang tidak boleh dilanggar?
```

Baru tentukan:

```text
- constraint
- transaction boundary
- lock
- retry
- application validation
```

## 33.4 Failure Before Optimism

Untuk setiap desain, tanya:

```text
Bagaimana jika request retry?
Bagaimana jika transaksi gagal di tengah?
Bagaimana jika network timeout setelah commit?
Bagaimana jika replica lag?
Bagaimana jika migration rollback tidak mungkin?
Bagaimana jika backup tidak bisa restore?
```

## 33.5 Database Is Shared Infrastructure

PostgreSQL biasanya dipakai banyak service/job/user. Satu query buruk bisa memengaruhi semuanya.

Karena itu, desain database harus mempertimbangkan blast radius.

---

# 34. Ringkasan Part 000

PostgreSQL harus dipahami sebagai database engine produksi, bukan hanya SQL endpoint.

Poin utama:

```text
1. PostgreSQL terdiri dari banyak subsistem: parser, planner, executor, MVCC, WAL, buffer manager, lock manager, vacuum, replication, dan lain-lain.
2. Java application berinteraksi dengan PostgreSQL melalui connection yang membawa session dan transaction state.
3. Query performance bergantung pada planner, statistics, index, data distribution, memory, lock, dan IO.
4. MVCC membuat concurrency lebih baik, tetapi menghasilkan tuple version dan membutuhkan vacuum.
5. WAL adalah fondasi durability, crash recovery, replication, dan PITR.
6. Constraint adalah alat arsitektural untuk menjaga invariant domain.
7. Connection pooling harus didesain berdasarkan kapasitas database, bukan sekadar throughput aplikasi.
8. Production PostgreSQL harus dilihat dari correctness, durability, performance, availability, dan operability.
9. Banyak insiden PostgreSQL berasal dari interaksi buruk antara application behavior dan database internals.
10. Seri ini akan membangun pemahaman dari engine internals sampai production playbook.
```

---

# 35. Referensi Utama untuk Part 000

Referensi ini bukan untuk dihafal sekarang, tetapi menjadi anchor resmi untuk seri ini.

1. PostgreSQL 18 Documentation — What Is PostgreSQL?  
   https://www.postgresql.org/docs/current/intro-whatis.html

2. PostgreSQL 18 Documentation — Concurrency Control / MVCC  
   https://www.postgresql.org/docs/current/mvcc.html

3. PostgreSQL 18 Documentation — MVCC Introduction  
   https://www.postgresql.org/docs/current/mvcc-intro.html

4. PostgreSQL 18 Documentation — Reliability and the Write-Ahead Log  
   https://www.postgresql.org/docs/current/wal.html

5. PostgreSQL 18 Documentation — Write-Ahead Logging  
   https://www.postgresql.org/docs/current/wal-intro.html

6. PostgreSQL 18 Documentation — Routine Vacuuming  
   https://www.postgresql.org/docs/current/routine-vacuuming.html

7. PostgreSQL 18 Documentation — Using EXPLAIN  
   https://www.postgresql.org/docs/current/using-explain.html

8. PostgreSQL 18 Documentation — Planner/Optimizer  
   https://www.postgresql.org/docs/current/planner-optimizer.html

9. PostgreSQL 18 Documentation — Indexes  
   https://www.postgresql.org/docs/current/indexes.html

10. PostgreSQL 18 Documentation — High Availability, Load Balancing, and Replication  
    https://www.postgresql.org/docs/current/high-availability.html

---

# 36. Penutup Part 000

Part 000 adalah fondasi cara berpikir. Mulai Part 001, kita akan masuk ke arsitektur proses PostgreSQL:

```text
postmaster / postgres main process
per-connection backend process
shared memory
background writer
checkpointer
WAL writer
autovacuum launcher/worker
parallel workers
replication-related processes
```

Tujuannya adalah memahami kenapa koneksi PostgreSQL mahal, kenapa pooling penting, dan kenapa desain Java backend harus menghormati process model PostgreSQL.

Seri belum selesai. Lanjutkan ke:

```text
learn-postgresql-mastery-for-java-engineers-part-001.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-001.md">Part 001 — Arsitektur Proses PostgreSQL: Backend Process, Shared Memory, dan Background Workers ➡️</a>
</div>

# Learn MySQL Mastery for Java Engineers — Part 000

## Orientation: MySQL Mental Model for Java Engineers

**Nama file:** `learn-mysql-mastery-for-java-engineers-part-000.md`  
**Seri:** `learn-mysql-mastery-for-java-engineers`  
**Part:** `000 / 034`  
**Status seri:** belum selesai  
**Baseline utama:** MySQL 8.4 LTS, dengan catatan MySQL 9.x Innovation/LTS bila relevan  
**Target pembaca:** Java software engineer yang sudah memahami SQL dasar dan ingin naik level ke production-grade MySQL engineering

---

## 0. Kenapa Part 000 Ini Penting?

Bagian ini bukan tutorial `SELECT`, `JOIN`, `GROUP BY`, atau normalisasi dasar. Materi seperti itu sudah masuk ke domain SQL umum dan tidak efisien untuk diulang. Fokus bagian ini adalah membangun **mental model MySQL sebagai sistem produksi**.

Sebagai Java engineer, Anda tidak cukup hanya tahu bahwa MySQL menyimpan data. Dalam sistem nyata, MySQL adalah pusat banyak keputusan desain:

- bagaimana transaksi dipotong;
- bagaimana request concurrent saling menunggu;
- bagaimana index mempengaruhi locking;
- bagaimana desain primary key mempengaruhi storage fisik;
- bagaimana connection pool bisa membunuh database;
- bagaimana replication lag menyebabkan stale read;
- bagaimana migration yang terlihat kecil bisa membuat production stuck;
- bagaimana backup yang tidak pernah diuji restore sebenarnya bukan backup;
- bagaimana failure database harus diterjemahkan menjadi retry, fallback, alert, atau manual intervention di aplikasi Java.

Tujuan Part 000 adalah memberi peta besar sebelum masuk ke bagian teknis mendalam. Setelah bagian ini, Anda harus bisa melihat MySQL bukan sebagai satu kotak bernama “database”, tetapi sebagai kumpulan subsystem yang saling berinteraksi.

---

## 1. Apa Itu MySQL dalam Mental Model Production?

Secara sederhana, MySQL adalah relational database management system. Tetapi untuk engineer senior, definisi itu terlalu dangkal.

Dalam production, MySQL lebih tepat dilihat sebagai:

> **stateful concurrent durable system yang menerima query dari banyak client, memilih execution plan, mengakses storage engine, mengelola transaksi, menjaga durability melalui log, melayani pembacaan dari cache dan disk, mereplikasi perubahan, serta membuka banyak permukaan operasional untuk observability, backup, security, dan recovery.**

Kalimat itu panjang karena MySQL memang bukan satu mekanisme tunggal.

Untuk Java engineer, request aplikasi biasanya terlihat seperti ini:

```text
HTTP / gRPC / Message Consumer
        |
        v
Java Service
        |
        v
Transaction Boundary
        |
        v
Connection Pool
        |
        v
JDBC Driver / Connector/J
        |
        v
MySQL Server
        |
        +--> SQL Layer
        |       +--> Parser
        |       +--> Resolver
        |       +--> Optimizer
        |       +--> Executor
        |
        +--> Storage Engine Interface
                |
                v
              InnoDB
                +--> Buffer Pool
                +--> B+Tree Indexes
                +--> MVCC / Undo
                +--> Locks
                +--> Redo Log
                +--> Doublewrite
                +--> Tablespaces
```

Kalau Anda hanya memahami bagian Java Service dan SQL query, maka sebagian besar penyebab incident akan tampak misterius. Query yang sama bisa cepat kemarin dan lambat hari ini. Update sederhana bisa deadlock. Migration bisa menggantung. Replica bisa terlambat. Connection pool yang terlalu besar bisa membuat semua request makin lambat, bukan makin cepat.

MySQL mastery berarti mampu membaca hubungan antar-layer tersebut.

---

## 2. Scope Seri Ini: Apa yang Akan dan Tidak Akan Kita Ulang

Seri ini dibuat setelah materi SQL dan PostgreSQL pernah dibahas. Maka seri MySQL ini harus hemat dan tajam.

### 2.1 Yang Tidak Akan Diulang Panjang

Kita tidak akan menghabiskan banyak waktu untuk:

- definisi tabel, kolom, row;
- `SELECT` dasar;
- `WHERE`, `JOIN`, `GROUP BY`, `HAVING` dasar;
- normalisasi 1NF/2NF/3NF secara textbook;
- konsep ACID secara definisi umum;
- index secara abstrak tanpa kaitan ke InnoDB;
- generic relational modeling.

Hal-hal itu tetap akan muncul bila relevan, tetapi hanya sebagai pendukung.

### 2.2 Yang Akan Jadi Fokus

Kita akan fokus pada hal yang membuat MySQL berbeda dan penting di production:

- arsitektur MySQL server;
- InnoDB storage engine;
- clustered primary key;
- secondary index amplification;
- MVCC dan undo log;
- transaction isolation khas InnoDB;
- record lock, gap lock, next-key lock;
- deadlock dan lock wait timeout;
- optimizer, statistics, execution plan;
- redo log, binlog, group commit;
- buffer pool dan memory behavior;
- replication, lag, failover;
- backup, restore, point-in-time recovery;
- online DDL, metadata lock, migration safety;
- Performance Schema, sys schema, slow query log;
- Connector/J, HikariCP, timeout, prepared statement, batch;
- MySQL untuk workflow, state machine, audit trail, dan regulatory lifecycle system.

---

## 3. Versi MySQL: Kenapa Baseline Kita MySQL 8.4 LTS

MySQL modern memiliki release model dengan dua jalur utama:

1. **LTS / Long-Term Support**
2. **Innovation Release**

Untuk pembelajaran production, baseline yang paling masuk akal adalah **MySQL 8.4 LTS** karena LTS lebih cocok sebagai acuan sistem yang butuh stabilitas, dokumentasi panjang, dan strategi upgrade yang lebih defensible.

MySQL 9.x tetap penting, tetapi untuk seri ini kita akan memperlakukannya sebagai konteks tambahan, bukan baseline utama. Ini menghindari pembelajaran yang terlalu bergantung pada fitur yang mungkin belum menjadi standar di banyak enterprise environment.

### 3.1 Implikasi untuk Java Engineer

Bila Anda bekerja di sistem enterprise, regulatory, banking, insurance, commerce, internal platform, atau case-management system, kemungkinan besar concern Anda bukan “pakai fitur paling baru”, tetapi:

- apakah versi ini stabil?
- apakah driver kompatibel?
- apakah patch security tersedia?
- apakah backup/restore tooling mature?
- apakah observability tersedia?
- apakah behavior-nya terdokumentasi?
- apakah upgrade path jelas?

Karena itu, seri ini menggunakan pendekatan:

```text
Default mental model: MySQL 8.4 LTS
Tambahan: MySQL 9.x bila fitur/behavior relevan
Hindari: bergantung pada behavior lama MySQL 5.7 kecuali sebagai legacy warning
```

---

## 4. MySQL Bukan PostgreSQL dengan Syntax Sedikit Berbeda

Karena Anda sudah punya konteks SQL dan mungkin PostgreSQL, penting untuk tidak membawa asumsi yang salah.

MySQL dan PostgreSQL sama-sama relational database, tetapi berbeda dalam banyak aspek production behavior.

Beberapa perbedaan mental model:

| Area | MySQL / InnoDB | PostgreSQL |
|---|---|---|
| Storage default | InnoDB clustered index | Heap table + indexes |
| Primary key | Menentukan physical clustering InnoDB | Tidak otomatis menjadi physical clustering permanen |
| MVCC storage | Undo log-based | Tuple version in heap |
| Vacuum/purge | InnoDB purge process | VACUUM process |
| Locking range | Gap/next-key lock penting | Predicate/range behavior berbeda |
| Replication umum | Binlog-based replication | WAL-based physical/logical replication |
| Auto increment | Punya behavior khusus di InnoDB | Sequence object model berbeda |
| JSON | Native JSON dengan generated columns/index strategy | JSONB sangat kuat dan berbeda model |
| Optimizer behavior | MySQL-specific cost/statistics/hints | PostgreSQL-specific planner/statistics |

Perbedaan paling penting untuk seri ini:

> Di InnoDB, **primary key adalah bentuk fisik utama tabel**. Ini bukan detail kecil. Ini mempengaruhi semua secondary index, locality, insert pattern, page split, locking, dan storage amplification.

Jika satu hal saja yang Anda ingat dari bagian awal ini, ingat ini:

> Di MySQL/InnoDB, desain primary key adalah keputusan arsitektur storage, bukan hanya keputusan logical modeling.

---

## 5. Arsitektur Besar MySQL

Mari kita pecah MySQL menjadi beberapa lapisan.

```text
+---------------------------------------------------+
|                    Clients                        |
| Java apps, CLI, migration tools, BI tools          |
+-------------------------+-------------------------+
                          |
                          v
+---------------------------------------------------+
|                 MySQL Server Layer                |
| Connection, auth, parser, resolver, optimizer,     |
| executor, privileges, metadata, binlog             |
+-------------------------+-------------------------+
                          |
                          v
+---------------------------------------------------+
|              Storage Engine Interface             |
+-------------------------+-------------------------+
                          |
                          v
+---------------------------------------------------+
|                     InnoDB                        |
| Buffer pool, B+Tree, MVCC, locks, redo, undo,      |
| doublewrite, purge, tablespaces                    |
+-------------------------+-------------------------+
                          |
                          v
+---------------------------------------------------+
|                 Operating System                  |
| Filesystem, page cache, disk, fsync, network       |
+---------------------------------------------------+
```

Setiap layer punya jenis masalah sendiri.

### 5.1 Client Layer

Untuk Java engineer, client layer biasanya terdiri dari:

- Spring Boot application;
- JDBC;
- MySQL Connector/J;
- HikariCP atau connection pool lain;
- ORM seperti Hibernate/JPA;
- migration tool seperti Flyway/Liquibase;
- batch job;
- message consumer;
- scheduler;
- admin/reporting tool.

Masalah umum di layer ini:

- connection leak;
- transaction terlalu panjang;
- query generated ORM buruk;
- N+1 query;
- batch insert tidak optimal;
- timeout tidak selaras;
- retry tanpa idempotency;
- read/write routing salah;
- pool terlalu besar;
- terlalu banyak service instance membuka koneksi bersamaan.

### 5.2 MySQL Server Layer

Server layer menangani:

- koneksi;
- authentication;
- privilege check;
- parsing SQL;
- resolving nama table/column;
- query optimization;
- query execution orchestration;
- stored routines;
- views;
- metadata dictionary;
- binary logging;
- replication coordination.

Masalah umum di layer ini:

- query plan buruk;
- metadata lock;
- privilege salah;
- SQL mode mismatch;
- collation mismatch;
- too many connections;
- binlog overhead;
- plan berubah karena statistics.

### 5.3 Storage Engine Layer

MySQL punya storage engine interface, tetapi untuk production transactional workload modern, fokus utama kita adalah **InnoDB**.

InnoDB bertanggung jawab untuk:

- table/index storage;
- clustered index;
- secondary index;
- row-level locking;
- MVCC;
- transaction isolation;
- redo log;
- undo log;
- crash recovery;
- buffer pool;
- foreign key enforcement;
- online DDL behavior tertentu.

Masalah umum di InnoDB:

- deadlock;
- lock wait timeout;
- long transaction;
- purge lag;
- buffer pool miss;
- redo log pressure;
- page split;
- fragmented indexes;
- primary key hotspot;
- range update locking terlalu luas.

### 5.4 Operating System / Infrastructure Layer

MySQL sangat sensitif terhadap:

- disk latency;
- fsync behavior;
- filesystem;
- CPU saturation;
- memory pressure;
- network jitter;
- cloud volume performance;
- container limit;
- noisy neighbor;
- IOPS burst credit;
- DNS/proxy/failover behavior.

Di production, query yang “secara logika benar” bisa tetap buruk karena storage atau infrastructure tidak cocok.

---

## 6. The Most Important Mental Model: MySQL Is a Queueing System

Banyak engineer melihat database sebagai function call:

```java
User user = userRepository.findById(id);
```

Tetapi production MySQL lebih tepat dipahami sebagai queueing system.

Setiap query:

1. menunggu connection;
2. masuk ke MySQL server;
3. mungkin menunggu CPU;
4. mungkin menunggu lock;
5. mungkin menunggu disk I/O;
6. mungkin menunggu flush log;
7. mungkin menunggu network;
8. mungkin memblokir query lain;
9. mungkin membuat replica tertinggal;
10. mungkin meninggalkan efek pada buffer pool, undo log, redo log, binlog, statistics, dan lock state.

Satu query lambat jarang hanya “satu query lambat”. Ia bisa menjadi sumber antrean.

Contoh:

```text
Query update lambat
  -> memegang lock lebih lama
  -> query lain menunggu lock
  -> thread MySQL makin banyak aktif
  -> CPU context switching naik
  -> connection pool penuh
  -> request Java menunggu connection
  -> timeout aplikasi
  -> retry storm
  -> load makin tinggi
  -> database makin lambat
```

Ini adalah pola incident klasik.

Top 1% engineer tidak hanya bertanya:

> “Query mana yang lambat?”

Mereka bertanya:

> “Query lambat ini menahan resource apa, siapa yang menunggu resource itu, retry apa yang dipicu aplikasi, dan apakah efeknya menyebar ke replica, migration, atau batch job?”

---

## 7. MySQL sebagai State Machine untuk Data

Karena Anda tertarik pada lifecycle, escalation logic, user journey, dan regulatory defensibility, kita akan sering memakai contoh sistem seperti ini:

```text
Case
  -> Draft
  -> Submitted
  -> Under Review
  -> Need More Information
  -> Investigation
  -> Enforcement Proposed
  -> Enforcement Approved
  -> Closed
  -> Archived
```

MySQL sering menjadi tempat state transition itu dijaga.

Pertanyaan desainnya bukan hanya:

```sql
UPDATE cases SET status = 'APPROVED' WHERE id = ?;
```

Pertanyaan sebenarnya:

- apakah transition dari status lama ke status baru valid?
- siapa yang boleh melakukan transition?
- apakah dua officer bisa mengubah case yang sama secara bersamaan?
- apakah approval harus idempotent?
- apakah audit trail atomic dengan perubahan status?
- apakah SLA queue ikut berubah?
- apakah event outbox harus dibuat dalam transaksi yang sama?
- apakah external notification dikirim setelah commit?
- apakah read replica boleh dipakai untuk menampilkan status setelah update?
- apakah report regulator boleh membaca data stale?
- apakah migration status enum bisa dilakukan tanpa downtime?

MySQL mastery berarti mampu menjawab pertanyaan-pertanyaan itu dengan memahami transaction, locking, isolation, index, dan operational behavior.

---

## 8. Request Lifecycle: Dari Java Method ke InnoDB Page

Bayangkan method Java berikut:

```java
@Transactional
public void approveCase(long caseId, long officerId) {
    CaseRecord c = caseRepository.findForUpdate(caseId);
    c.approve(officerId);
    caseRepository.save(c);
    auditRepository.insert(caseId, officerId, "APPROVED");
    outboxRepository.insertCaseApproved(caseId);
}
```

Di permukaan, ini terlihat seperti business logic biasa. Di bawahnya, terjadi banyak hal.

### 8.1 Di Java Layer

- Spring membuka transaksi.
- Connection dipinjam dari pool.
- Session MySQL mulai dipakai.
- Autocommit mungkin dimatikan sementara.
- ORM/JDBC mengirim SQL.
- Timeout aplikasi mulai berjalan.

### 8.2 Di MySQL Server Layer

- SQL diterima.
- Query diparse.
- Table dan column di-resolve.
- Permission dicek.
- Optimizer memilih index dan join strategy.
- Executor memanggil InnoDB.

### 8.3 Di InnoDB

- B+Tree primary key dicari.
- Page mungkin ditemukan di buffer pool atau dibaca dari disk.
- Row version diperiksa.
- Lock mungkin diambil.
- Undo record dibuat untuk update.
- Redo record dibuat untuk durability.
- Secondary index mungkin diperbarui.
- Commit akan berinteraksi dengan redo log dan binlog.

### 8.4 Setelah Commit

- Lock dilepas.
- Perubahan tersedia untuk transaksi lain.
- Binlog event dapat dikirim ke replica.
- Outbox consumer mungkin mengambil event.
- Replica mungkin belum catch up.
- Java connection dikembalikan ke pool.

Satu method Java bisa menyentuh parser, optimizer, buffer pool, lock manager, redo log, binlog, replication, dan application-level consistency boundary.

---

## 9. InnoDB: Pusat Gravitasi Seri Ini

MySQL mendukung konsep storage engine, tetapi untuk sebagian besar transactional workload modern, InnoDB adalah default dan pusat pembelajaran.

InnoDB penting karena ia mengelola:

- physical table layout;
- primary key clustering;
- B+Tree indexes;
- MVCC;
- transaction isolation;
- row locks;
- gap locks;
- foreign keys;
- redo log;
- undo log;
- crash recovery;
- buffer pool;
- purge;
- online DDL behavior.

### 9.1 Apa yang Harus Ada di Kepala Saat Mendengar “InnoDB”

Jangan hanya pikir:

```text
InnoDB = storage engine
```

Pikir:

```text
InnoDB = storage + transaction + concurrency + recovery + memory + physical index layout
```

Atau lebih visual:

```text
InnoDB
├── Storage
│   ├── Tablespaces
│   ├── Pages
│   ├── Clustered indexes
│   └── Secondary indexes
│
├── Concurrency
│   ├── MVCC
│   ├── Row locks
│   ├── Gap locks
│   ├── Next-key locks
│   └── Deadlock detection
│
├── Durability
│   ├── Redo log
│   ├── Undo log
│   ├── Doublewrite buffer
│   └── Crash recovery
│
├── Memory
│   ├── Buffer pool
│   ├── Change buffer
│   └── Adaptive hash index
│
└── Maintenance
    ├── Purge
    ├── Checkpointing
    └── Online DDL support
```

---

## 10. MySQL Failure Modes yang Harus Dikuasai Java Engineer

Bagian ini penting karena engineering maturity terlihat dari kemampuan memprediksi failure, bukan hanya menulis happy path.

### 10.1 Slow Query

Slow query bisa disebabkan oleh:

- index tidak cocok;
- optimizer memilih plan buruk;
- statistics stale;
- sorting besar;
- temp table ke disk;
- lock wait;
- buffer pool miss;
- disk latency;
- network delay;
- row terlalu banyak dikirim ke aplikasi;
- ORM menghasilkan query buruk.

Jangan langsung menyimpulkan “butuh index”. Kadang masalahnya bukan index, tetapi locking, memory, atau query pattern.

### 10.2 Deadlock

Deadlock terjadi ketika dua atau lebih transaksi saling menunggu resource yang tidak akan dilepas kecuali salah satu transaksi dibatalkan.

Deadlock bukan selalu bug database. Dalam sistem concurrent, deadlock bisa menjadi konsekuensi normal dari urutan update yang berbeda.

Aplikasi Java harus punya strategi:

- mendeteksi error deadlock;
- retry transaksi secara aman;
- memastikan operasi idempotent;
- membatasi retry;
- logging cukup untuk analisis;
- tidak melakukan external side effect sebelum commit.

### 10.3 Lock Wait Timeout

Lock wait timeout berbeda dari deadlock.

Deadlock: siklus menunggu terdeteksi.  
Lock wait timeout: query menunggu terlalu lama dan akhirnya timeout.

Penyebab umum:

- transaksi lain terlalu lama;
- update range tanpa index tepat;
- batch job memegang lock;
- migration atau DDL blocking;
- user transaction idle karena bug aplikasi;
- connection dipinjam tapi tidak commit/rollback.

### 10.4 Connection Exhaustion

Connection exhaustion sering bukan karena database “kurang connection”, tetapi karena aplikasi terlalu banyak membuka koneksi atau query terlalu lambat sehingga koneksi tertahan.

Contoh formula kasar:

```text
Jumlah koneksi aktif = throughput request × durasi koneksi dipakai
```

Jika query yang biasanya 20 ms menjadi 2 detik, kebutuhan koneksi bisa naik 100x untuk throughput yang sama.

Menambah pool size sering memperparah keadaan karena MySQL harus menangani lebih banyak concurrent work.

### 10.5 Replication Lag

Replication lag berarti replica tertinggal dari primary.

Efek ke aplikasi:

- user baru update data tapi membaca nilai lama dari replica;
- dashboard status terlambat;
- workflow mengambil keputusan berdasarkan state stale;
- report tidak konsisten;
- failover bisa promote node yang belum punya semua data;
- read/write splitting menjadi sumber bug consistency.

### 10.6 Migration Stuck

DDL di MySQL dapat berinteraksi dengan metadata lock. Migration kecil seperti menambah kolom atau index bisa menunggu transaksi lama, lalu query lain ikut antre.

Pola buruk:

```text
Long SELECT transaction
  -> ALTER TABLE menunggu metadata lock
  -> query baru ikut menunggu di belakang ALTER
  -> aplikasi timeout massal
```

### 10.7 Bad Backup

Backup yang belum pernah diuji restore adalah asumsi, bukan jaminan.

Masalah umum:

- backup tidak konsisten;
- binary log tidak tersedia untuk PITR;
- restore terlalu lama;
- credential restore hilang;
- backup terenkripsi tapi key tidak tersedia;
- backup sukses tetapi data korup;
- runbook tidak pernah diuji.

### 10.8 Uncertain Commit

Aplikasi bisa mengalami timeout saat commit. Masalahnya: aplikasi tidak selalu tahu apakah commit berhasil atau gagal.

Contoh:

```text
Java sends COMMIT
  -> MySQL commits successfully
  -> network drops before response
  -> Java sees timeout/error
```

Jika aplikasi langsung retry tanpa idempotency, duplicate side effect bisa terjadi.

---

## 11. MySQL Tidak Bisa Dipisahkan dari Aplikasi Java

Banyak masalah MySQL sebenarnya dimulai dari aplikasi.

### 11.1 Transaction Scope Buruk

Contoh buruk:

```java
@Transactional
public void approveCase(long caseId) {
    Case c = caseRepository.findForUpdate(caseId);
    externalRiskService.call(c);       // network call inside transaction
    c.approve();
    caseRepository.save(c);
}
```

Masalah:

- lock dipegang selama external API call;
- latency external service memperpanjang transaction;
- timeout external service bisa meninggalkan lock lama;
- throughput database turun;
- deadlock/timeout lebih mungkin.

Lebih baik:

- ambil data yang diperlukan;
- commit jika tidak perlu lock;
- panggil external service di luar transaksi;
- gunakan state transition yang eksplisit;
- gunakan outbox untuk side effect setelah commit.

### 11.2 Connection Pool Bukan Solusi Semua Masalah

Connection pool membantu reuse koneksi. Tetapi pool juga bisa menjadi amplifier incident.

Jika pool terlalu kecil:

- request menunggu connection;
- latency naik;
- timeout di aplikasi.

Jika pool terlalu besar:

- MySQL menerima terlalu banyak concurrent query;
- CPU context switching naik;
- memory per-connection naik;
- lock contention naik;
- disk I/O makin acak;
- throughput bisa turun.

Pool size harus dipilih berdasarkan workload, latency, concurrency, dan kapasitas MySQL, bukan sekadar jumlah request puncak.

### 11.3 Timeout Harus Selaras

Timeout yang umum:

- HTTP request timeout;
- thread pool timeout;
- transaction timeout;
- JDBC query timeout;
- socket timeout;
- Hikari connection timeout;
- MySQL lock wait timeout;
- MySQL wait timeout;
- proxy/load balancer timeout.

Jika timeout tidak selaras, sistem bisa berperilaku aneh:

- aplikasi sudah menyerah tetapi query masih berjalan di MySQL;
- retry dikirim saat query lama masih memegang lock;
- connection dianggap mati padahal server masih memproses;
- user mendapat error tetapi transaksi mungkin commit.

---

## 12. Mental Model Query Performance

Performance MySQL tidak bisa direduksi menjadi “pakai index”.

Satu query dipengaruhi oleh:

```text
SQL shape
  + data distribution
  + index design
  + table size
  + cardinality
  + optimizer statistics
  + selected execution plan
  + buffer pool state
  + concurrent locks
  + disk latency
  + network transfer
  + application fetch pattern
```

### 12.1 Query Cepat Itu Bukan Hanya Query yang Punya Index

Index yang salah bisa tidak membantu. Index yang terlalu banyak bisa memperlambat write. Composite index dengan urutan kolom salah bisa tidak berguna. Index bisa dipakai untuk filtering tetapi tidak membantu ordering. Index bisa membuat query cepat tetapi membuat update mahal.

Top 1% engineer bertanya:

- workload apa yang dominan?
- query mana yang latency-sensitive?
- query mana yang boleh stale?
- query mana yang write-heavy?
- index mana yang melayani banyak query sekaligus?
- index mana yang hanya melayani query jarang?
- apakah index memperbesar secondary index amplification?
- apakah index memperlebar lock atau justru mempersempit lock?

### 12.2 Optimizer Bukan Oracle yang Selalu Benar

Optimizer memilih plan berdasarkan estimasi. Estimasi bisa salah karena:

- statistics tidak representatif;
- distribusi data skewed;
- predicate correlated;
- parameter berbeda;
- data berubah;
- histogram tidak ada atau tidak cocok;
- query terlalu kompleks.

Karena itu `EXPLAIN`, `EXPLAIN ANALYZE`, slow query log, Performance Schema, dan observability menjadi bagian penting dari engineering loop.

---

## 13. MySQL Concurrency: Jangan Berpikir Hanya Row-Level Lock

Kalimat “InnoDB punya row-level locking” benar tetapi tidak cukup.

Dalam MySQL, concurrency dipengaruhi oleh:

- isolation level;
- consistent read vs locking read;
- index yang dipakai;
- apakah query equality atau range;
- record lock;
- gap lock;
- next-key lock;
- insert intention lock;
- foreign key check;
- unique constraint check;
- metadata lock;
- transaction duration;
- order akses row.

Contoh sederhana:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE tenant_id = 10
  AND status = 'OVERDUE';
```

Jika index tidak tepat, MySQL mungkin harus scan lebih banyak row. Selain lambat, locking scope bisa lebih luas. Ini bisa memblokir transaksi lain yang secara business logic terlihat tidak berhubungan.

Maka index bukan hanya alat performance. Dalam InnoDB, index juga mempengaruhi concurrency.

---

## 14. Primary Key sebagai Keputusan Arsitektur

Di banyak database, primary key sering diperlakukan sebagai logical identifier saja. Di InnoDB, primary key jauh lebih penting.

InnoDB menyimpan table data dalam clustered index berdasarkan primary key. Secondary index menyimpan primary key sebagai pointer ke row.

Implikasi:

- primary key besar membuat semua secondary index lebih besar;
- primary key random menyebabkan insert tersebar dan page split;
- primary key sequential bisa menciptakan insert hotspot tetapi locality bagus;
- composite primary key bisa sangat bagus atau sangat mahal;
- UUID string sebagai primary key sering mahal;
- binary UUID/ULID/Snowflake-style ID punya trade-off berbeda;
- pilihan ID di Java entity mempengaruhi storage fisik.

Contoh:

```sql
CREATE TABLE case_events (
    event_id BINARY(16) PRIMARY KEY,
    case_id BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    payload JSON NOT NULL,
    INDEX idx_case_created (case_id, created_at)
);
```

Jika `event_id` random, insert event tersebar di clustered index. Jika event volume tinggi, ini bisa berdampak pada page split dan buffer behavior.

Alternatif:

```sql
CREATE TABLE case_events (
    case_id BIGINT NOT NULL,
    sequence_no BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (case_id, sequence_no),
    INDEX idx_created_at (created_at)
);
```

Ini membuat event per case tersimpan lebih lokal, tetapi ada trade-off:

- perlu sequence per case;
- concurrency append event per case harus aman;
- secondary index menyimpan composite primary key yang lebih besar;
- query global by event_id tidak langsung tersedia kecuali ada unique index tambahan.

Tidak ada jawaban universal. Yang ada adalah trade-off yang harus eksplisit.

---

## 15. MySQL as Source of Truth vs MySQL as Read Model

Dalam sistem microservices atau event-driven, MySQL bisa berperan sebagai:

1. source of truth;
2. read model;
3. outbox store;
4. audit log store;
5. queue-like table;
6. reporting source;
7. temporary staging area;
8. operational metadata store.

Setiap peran punya desain berbeda.

### 15.1 Source of Truth

Butuh:

- constraint kuat;
- transaction benar;
- backup kuat;
- audit trail;
- migration hati-hati;
- consistency lebih penting daripada latency ekstrem.

### 15.2 Read Model

Butuh:

- query cepat;
- denormalisasi mungkin masuk akal;
- rebuild strategy;
- eventual consistency dapat diterima;
- indexing berdasarkan UI/query pattern.

### 15.3 Outbox Store

Butuh:

- atomic insert bersama business transaction;
- polling/CDC;
- idempotent consumer;
- retry;
- retention;
- ordering semantics.

### 15.4 Queue-like Table

Butuh hati-hati karena database bukan message broker.

Bisa dilakukan untuk workload tertentu dengan:

- `SELECT ... FOR UPDATE SKIP LOCKED`;
- batching;
- visibility timeout pattern;
- status transitions;
- retry count;
- dead-letter state.

Tetapi untuk throughput tinggi atau fanout besar, Kafka/RabbitMQ mungkin lebih cocok.

---

## 16. MySQL dan Regulatory Defensibility

Dalam domain regulatory/case-management, pertanyaan database bukan hanya “cepat atau tidak”. Ada aspek defensibility:

- apakah setiap perubahan state bisa diaudit?
- apakah actor dan timestamp jelas?
- apakah alasan perubahan tersimpan?
- apakah data bisa direkonstruksi?
- apakah report konsisten dengan snapshot tertentu?
- apakah retention policy diterapkan?
- apakah legal hold bisa mencegah purge?
- apakah perubahan schema tidak merusak interpretasi data lama?
- apakah restore bisa membuktikan integritas data?
- apakah admin access tercatat?

MySQL dapat mendukung ini, tetapi tidak otomatis.

Contoh desain buruk:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE id = ?;
```

Tanpa audit trail, alasan, actor, previous state, dan transaction boundary, update itu tidak defensible.

Contoh lebih baik secara konsep:

```text
Transaction:
  1. Lock current case row.
  2. Validate current state transition.
  3. Update case current state.
  4. Insert immutable case_state_transition record.
  5. Insert audit_event.
  6. Insert outbox event.
  7. Commit.
```

Tabel current state memudahkan query operasional. Tabel transition/audit menjaga reconstructability.

---

## 17. Common Anti-Patterns yang Akan Sering Kita Lawan

### 17.1 “Nanti Index Belakangan”

Index bukan garnish. Untuk MySQL/InnoDB, index mempengaruhi:

- query performance;
- lock scope;
- foreign key enforcement;
- join strategy;
- ordering;
- pagination;
- write cost;
- storage size.

Index harus didesain bersama query pattern.

### 17.2 “Semua Read Bisa ke Replica”

Tidak semua read aman ke replica.

Read yang butuh read-your-writes harus ke primary atau harus punya mekanisme consistency lain. Misalnya setelah user submit case, halaman detail tidak boleh menampilkan status lama hanya karena replica lag.

### 17.3 “Retry Semua Error Database”

Retry tanpa klasifikasi bisa berbahaya.

Error yang mungkin retriable:

- deadlock;
- lock wait timeout dalam konteks tertentu;
- transient connection failure;
- failover transient.

Error yang biasanya tidak diselesaikan dengan retry:

- duplicate key karena business conflict;
- data truncation;
- syntax error;
- privilege error;
- missing table;
- invalid foreign key;
- constraint violation yang valid.

Retry juga harus idempotent.

### 17.4 “Transaksi Semakin Besar Semakin Aman”

Transaksi besar tidak otomatis lebih aman. Ia bisa:

- memegang lock lebih lama;
- membuat undo log membesar;
- memperlambat purge;
- meningkatkan deadlock risk;
- membuat replication lag;
- memperbesar rollback cost;
- membuat timeout lebih mungkin.

Transaksi harus cukup besar untuk menjaga invariant, tetapi tidak lebih besar dari itu.

### 17.5 “ORM Akan Mengurus Semuanya”

ORM membantu mapping object-relational, tetapi tidak menghapus realitas database.

ORM bisa menghasilkan:

- N+1 query;
- lazy loading di tempat salah;
- update semua kolom;
- transaction terlalu panjang;
- flush timing tak terduga;
- query tanpa index cocok;
- lock tak sadar;
- batch insert tidak optimal.

Senior engineer harus bisa melihat SQL nyata yang dikirim ORM.

---

## 18. Vocabulary Utama Sebelum Masuk Part Berikutnya

Bagian berikutnya akan sering memakai istilah berikut. Kita definisikan dulu secara ringkas.

### 18.1 SQL Layer

Bagian MySQL yang menangani SQL sebelum akses storage engine: parser, resolver, optimizer, executor, privilege, metadata, dan beberapa server-level feature.

### 18.2 Storage Engine

Komponen yang bertanggung jawab menyimpan dan mengambil data secara fisik. Dalam seri ini, fokus utama adalah InnoDB.

### 18.3 InnoDB

Storage engine default transactional untuk MySQL modern. Mengelola storage, transaction, locking, MVCC, buffer pool, redo/undo, dan crash recovery.

### 18.4 Clustered Index

Struktur index tempat data row sebenarnya disimpan. Di InnoDB, table diorganisasi berdasarkan primary key.

### 18.5 Secondary Index

Index selain clustered primary key. Entry secondary index menyimpan key index tersebut dan primary key row yang dituju.

### 18.6 MVCC

Multi-Version Concurrency Control. Mekanisme agar transaksi bisa membaca snapshot data tanpa selalu memblokir writer.

### 18.7 Undo Log

Data lama yang dipakai untuk rollback dan consistent read.

### 18.8 Redo Log

Log perubahan yang dipakai untuk crash recovery dan durability.

### 18.9 Binary Log / Binlog

Log server-level yang merekam perubahan untuk replication dan point-in-time recovery.

### 18.10 Buffer Pool

Memory cache utama InnoDB untuk page data dan index.

### 18.11 Gap Lock

Lock pada celah antar-record index. Penting untuk memahami range locking di InnoDB.

### 18.12 Next-Key Lock

Kombinasi record lock dan gap lock. Digunakan untuk mencegah anomaly tertentu pada isolation level tertentu.

### 18.13 Metadata Lock

Lock pada metadata object seperti table definition. Bisa membuat DDL dan query saling menunggu.

### 18.14 Replication Lag

Kondisi ketika replica belum menerapkan semua perubahan dari primary.

### 18.15 Point-in-Time Recovery

Kemampuan restore database ke waktu tertentu menggunakan backup dan binlog.

---

## 19. Cara Belajar Seri Ini

Karena targetnya top-tier engineering, jangan belajar MySQL sebagai daftar fitur. Belajarlah sebagai hubungan antar-invariant.

Gunakan pertanyaan ini di setiap part:

1. **Resource apa yang dikelola?**  
   CPU, memory, disk, lock, connection, log, network, metadata?

2. **Invariant apa yang dijaga?**  
   Consistency, uniqueness, ordering, durability, visibility, auditability?

3. **Apa trade-off-nya?**  
   Latency vs durability, consistency vs availability, write cost vs read speed, online migration vs simplicity?

4. **Apa failure mode-nya?**  
   Timeout, deadlock, stale read, data drift, partial side effect, corruption, restore failure?

5. **Bagaimana aplikasi Java harus bereaksi?**  
   Retry, rollback, alert, circuit break, fallback, idempotency, compensation?

6. **Bagaimana mengobservasi?**  
   Log apa, metric apa, query apa, dashboard apa, trace apa?

7. **Bagaimana mencegah regression?**  
   Test, migration checklist, query review, load test, alert, runbook?

---

## 20. Minimal Local Lab untuk Seri Ini

Seri ini bisa dibaca secara konseptual, tetapi akan jauh lebih kuat bila Anda menjalankan lab.

### 20.1 Docker Compose Minimal

```yaml
services:
  mysql:
    image: mysql:8.4
    container_name: mysql84-lab
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: labdb
      MYSQL_USER: app
      MYSQL_PASSWORD: app
    ports:
      - "3306:3306"
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_0900_ai_ci
      - --log-bin=mysql-bin
      - --server-id=1
      - --performance-schema=ON
    volumes:
      - mysql84_data:/var/lib/mysql

volumes:
  mysql84_data:
```

### 20.2 Connect dari CLI

```bash
mysql -h 127.0.0.1 -P 3306 -u app -p labdb
```

### 20.3 Basic Sanity Check

```sql
SELECT VERSION();
SELECT @@version_comment;
SELECT @@transaction_isolation;
SELECT @@character_set_server;
SELECT @@collation_server;
```

### 20.4 Java Dependency Contoh

Maven:

```xml
<dependency>
  <groupId>com.mysql</groupId>
  <artifactId>mysql-connector-j</artifactId>
  <version>9.7.0</version>
</dependency>
```

Catatan: versi driver di project nyata sebaiknya mengikuti dependency management organisasi dan compatibility matrix yang disetujui. Untuk seri ini, kita akan membahas prinsip Connector/J modern, bukan hanya satu versi artifact.

---

## 21. Baseline Schema untuk Contoh Seri

Kita akan memakai contoh domain case-management/regulatory workflow secara berkala.

```sql
CREATE TABLE cases (
    id BIGINT NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    case_number VARCHAR(64) NOT NULL,
    subject_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    assigned_officer_id BIGINT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_cases_tenant_case_number (tenant_id, case_number),
    KEY idx_cases_tenant_status_priority (tenant_id, status, priority, created_at),
    KEY idx_cases_assigned_status (assigned_officer_id, status, updated_at)
) ENGINE=InnoDB;
```

```sql
CREATE TABLE case_state_transitions (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NOT NULL,
    actor_id BIGINT NOT NULL,
    reason_code VARCHAR(64) NULL,
    reason_text TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_transitions_case_created (case_id, created_at),
    CONSTRAINT fk_transitions_case
      FOREIGN KEY (case_id) REFERENCES cases(id)
) ENGINE=InnoDB;
```

```sql
CREATE TABLE audit_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id BIGINT NOT NULL,
    action VARCHAR(64) NOT NULL,
    actor_id BIGINT NOT NULL,
    payload JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_audit_entity_created (entity_type, entity_id, created_at),
    KEY idx_audit_tenant_created (tenant_id, created_at)
) ENGINE=InnoDB;
```

```sql
CREATE TABLE outbox_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP NULL,
    retry_count INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_outbox_status_created (status, created_at),
    KEY idx_outbox_aggregate (aggregate_type, aggregate_id, id)
) ENGINE=InnoDB;
```

Schema ini belum final. Justru sepanjang seri kita akan mengkritik dan memperbaikinya:

- apakah primary key cocok?
- apakah index cocok?
- apakah status sebagai `VARCHAR` cukup baik?
- apakah JSON audit payload aman?
- apakah FK membantu atau menghambat?
- apakah outbox polling aman?
- apakah purge audit dan outbox aman?
- apakah query dashboard bisa memakai index?
- apakah tenant isolation cukup kuat?

---

## 22. Production Thinking: Membaca MySQL dari Gejala

Berikut beberapa gejala dan kemungkinan sumbernya.

### 22.1 Aplikasi Timeout Tetapi MySQL CPU Rendah

Kemungkinan:

- lock wait;
- metadata lock;
- connection pool wait;
- network issue;
- thread menunggu disk;
- query blocked di replica;
- app-side thread pool penuh.

CPU rendah bukan berarti database sehat.

### 22.2 CPU MySQL Tinggi

Kemungkinan:

- full table scan;
- sort besar;
- join buruk;
- terlalu banyak concurrent query;
- parsing query unik terlalu banyak;
- function di predicate;
- missing index;
- bad execution plan;
- excessive context switching.

### 22.3 Disk I/O Tinggi

Kemungkinan:

- buffer pool terlalu kecil;
- working set lebih besar dari memory;
- checkpoint pressure;
- redo log pressure;
- temp table ke disk;
- backup sedang berjalan;
- large scan;
- purge/delete besar;
- index rebuild.

### 22.4 Deadlock Spike

Kemungkinan:

- deployment mengubah urutan update;
- batch job baru;
- index berubah;
- query range lebih luas;
- traffic naik;
- retry storm;
- foreign key cascade;
- concurrent workflow transition.

### 22.5 Replica Lag

Kemungkinan:

- write spike di primary;
- long transaction;
- DDL;
- replica hardware lebih lemah;
- large transaction sulit diparalelkan;
- slow query di replica;
- network issue;
- replication thread blocked.

---

## 23. Skill Target Setelah Menyelesaikan Seri

Setelah menyelesaikan seri ini, targetnya bukan sekadar “bisa MySQL”. Targetnya adalah bisa melakukan reasoning seperti engineer senior.

Anda harus bisa:

1. Mendesain schema MySQL berdasarkan workload, bukan hanya entity diagram.
2. Memilih primary key dengan memahami efek fisiknya.
3. Membaca `EXPLAIN` dan menghubungkannya ke index design.
4. Mengidentifikasi query yang lambat karena plan, lock, I/O, atau app fetch pattern.
5. Menjelaskan perbedaan deadlock dan lock wait timeout.
6. Mendesain retry transaction yang aman dan idempotent.
7. Menentukan transaction boundary di Java service.
8. Mengatur connection pool secara rasional.
9. Menyelaraskan timeout app, JDBC, pool, dan MySQL.
10. Memahami read/write splitting dan consistency boundary.
11. Mendesain migration tanpa downtime yang naif.
12. Menyiapkan backup yang benar-benar bisa direstore.
13. Menggunakan observability MySQL untuk incident debugging.
14. Menilai kapan MySQL cukup dan kapan perlu search engine/message broker/OLAP store.
15. Membuat runbook production untuk failure database.

---

## 24. Learning Contract untuk Seri Ini

Setiap bagian berikutnya akan mencoba menjaga pola:

1. **Mental model** — apa konsep intinya.
2. **Internal behavior** — apa yang terjadi di dalam MySQL/InnoDB.
3. **Java implication** — apa artinya untuk service, transaction, pool, dan error handling.
4. **Production failure mode** — bagaimana konsep ini gagal di dunia nyata.
5. **Design heuristics** — aturan praktis yang defensible.
6. **Hands-on snippets** — SQL atau Java yang bisa diuji.
7. **Checklist** — cara mengevaluasi sistem sendiri.

Dengan pola ini, Anda tidak hanya menghafal fitur, tetapi belajar membuat keputusan.

---

## 25. Kesimpulan Part 000

MySQL mastery untuk Java engineer bukan tentang hafal syntax. Itu adalah kemampuan memahami MySQL sebagai sistem:

```text
Application concurrency
  -> connection pool
  -> SQL execution
  -> optimizer plan
  -> InnoDB indexes
  -> MVCC visibility
  -> locks
  -> redo/undo/binlog
  -> replication
  -> backup/recovery
  -> observability
  -> operational runbook
```

Part ini adalah peta. Bagian berikutnya mulai membedah arsitektur dari request client sampai storage engine.

Jika Anda memahami peta ini, Anda akan lebih siap menghadapi materi berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-001.md
MySQL Architecture: From Client Connection to Storage Engine
```

---

## 26. Checklist Pemahaman Part 000

Gunakan checklist ini untuk menguji apakah mental model awal sudah terbentuk.

- [ ] Saya paham bahwa MySQL bukan hanya SQL parser, tetapi sistem storage, concurrency, durability, dan replication.
- [ ] Saya paham mengapa InnoDB menjadi pusat seri ini.
- [ ] Saya paham bahwa primary key di InnoDB mempengaruhi physical storage.
- [ ] Saya paham bahwa index mempengaruhi performance dan locking.
- [ ] Saya paham bahwa connection pool bisa memperbaiki atau memperburuk incident.
- [ ] Saya paham bahwa timeout harus dipikirkan lintas layer.
- [ ] Saya paham bahwa deadlock bisa normal dan harus ditangani dengan retry yang idempotent.
- [ ] Saya paham bahwa read replica tidak selalu aman untuk semua read.
- [ ] Saya paham bahwa migration bisa gagal karena metadata lock.
- [ ] Saya paham bahwa backup tanpa restore test belum cukup.
- [ ] Saya paham bahwa MySQL production engineering perlu observability dan runbook.

---

## 27. Referensi Resmi yang Menjadi Baseline Seri

Referensi ini tidak perlu dibaca semua sekarang. Daftar ini menjadi anchor agar pembelajaran tetap grounded pada dokumentasi resmi.

- MySQL 8.4 Reference Manual: `https://dev.mysql.com/doc/refman/8.4/en/`
- MySQL 8.4 Release Notes: `https://dev.mysql.com/doc/relnotes/mysql/8.4/en/`
- MySQL release model LTS dan Innovation: `https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html`
- InnoDB Storage Engine: `https://dev.mysql.com/doc/refman/8.4/en/innodb-storage-engine.html`
- InnoDB Architecture: `https://dev.mysql.com/doc/refman/8.4/en/innodb-architecture.html`
- InnoDB and ACID Model: `https://dev.mysql.com/doc/refman/8.4/en/mysql-acid.html`
- InnoDB and MySQL Replication: `https://dev.mysql.com/doc/refman/8.4/en/innodb-and-mysql-replication.html`
- Optimization: `https://dev.mysql.com/doc/refman/8.4/en/optimization.html`
- Memory Use and Buffer Pool Concepts: `https://dev.mysql.com/doc/refman/8.4/en/memory-use.html`
- Connector/J Developer Guide: `https://dev.mysql.com/doc/connector-j/en/`
- Connector/J Configuration Properties: `https://dev.mysql.com/doc/connector-j/en/connector-j-reference-configuration-properties.html`

---

## 28. Status Seri

**Part saat ini:** `000`  
**Part berikutnya:** `001 — MySQL Architecture: From Client Connection to Storage Engine`  
**Seri sudah selesai?** Belum. Ini adalah bagian pembuka dari total 35 part.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-001.md">Part 001 — MySQL Architecture: From Client Connection to Storage Engine ➡️</a>
</div>

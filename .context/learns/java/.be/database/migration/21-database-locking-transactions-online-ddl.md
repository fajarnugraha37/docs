# 21 — Database Locking, Transactions, and Online DDL

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Bagian: `21-database-locking-transactions-online-ddl.md`  
> Topik: locking, transaction semantics, online DDL, timeout, blocking, dan strategi migration production-grade  
> Target: Java 8–25, Flyway, Liquibase, Spring Boot, Jakarta EE, plain Java, CI/CD, production database

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas **expand/contract zero-downtime migration**. Di sana kita sudah melihat bahwa perubahan database yang aman bukan hanya soal SQL benar, tetapi juga soal **deployment choreography** antara versi aplikasi dan versi schema.

Bagian ini masuk ke sisi yang lebih operasional dan sering menjadi penyebab kegagalan migration di production:

- migration terlihat benar di local, tetapi timeout di production;
- `ALTER TABLE` kecil ternyata menahan lock besar;
- index creation memblokir write traffic;
- backfill jutaan row membuat transaction log / undo / WAL membengkak;
- migration sukses di staging kecil, tetapi gagal di production karena volume data;
- aplikasi freeze karena migration menunggu lock atau membuat lock;
- rollback code tidak membantu karena database sudah terlanjur memegang lock/partial change;
- Flyway/Liquibase terlihat “hang”, padahal sebenarnya sedang menunggu database lock.

Tujuan utama bagian ini adalah membangun mental model berikut:

> Migration yang aman bukan hanya migration yang valid secara syntax, tetapi migration yang **memiliki lock profile, transaction profile, data-volume profile, timeout boundary, recovery path, dan observability** yang jelas.

Setelah bagian ini, kamu seharusnya mampu:

1. membaca migration dan memperkirakan lock yang mungkin terjadi;
2. membedakan DDL yang metadata-only, table rewrite, index build, validation, dan data backfill;
3. menentukan apakah migration aman dijalankan saat traffic aktif;
4. memilih antara transactional migration, non-transactional migration, chunked migration, online DDL, atau external job;
5. membuat runbook untuk migration yang berpotensi blocking;
6. mendesain migration yang kompatibel dengan Flyway/Liquibase dan real-world production database.

---

## 2. Core Mental Model: Database Migration Is Concurrent System Change

Database production bukan objek statis. Saat migration berjalan, database sedang melayani:

- transaksi user;
- API request;
- batch job;
- scheduler;
- message consumer;
- report query;
- replication;
- backup;
- monitoring query;
- ETL / CDC process;
- admin operation.

Jadi migration bukan berjalan di ruang kosong. Migration adalah perubahan terhadap sistem yang sedang bergerak.

Model sederhananya:

```text
          ┌──────────────────────┐
          │      Application     │
          │  old/new instances   │
          └──────────┬───────────┘
                     │ SQL traffic
                     ▼
┌────────────────────────────────────────┐
│              Database                  │
│                                        │
│  ┌──────────────┐   ┌──────────────┐   │
│  │ User Tx      │   │ Batch Tx     │   │
│  └──────────────┘   └──────────────┘   │
│                                        │
│  ┌────────────────────────────────┐    │
│  │ Migration Tx / DDL / Backfill  │    │
│  └────────────────────────────────┘    │
│                                        │
│  Locks, MVCC, redo/WAL, undo, stats    │
└────────────────────────────────────────┘
```

Migration perlu dipikirkan sebagai operasi concurrent:

- siapa yang membaca objek yang akan diubah?
- siapa yang menulis objek tersebut?
- migration butuh lock apa?
- lock itu compatible dengan traffic normal atau tidak?
- berapa lama lock ditahan?
- apakah migration menunggu transaksi lain?
- apakah transaksi lain menunggu migration?
- apakah ada timeout?
- kalau gagal di tengah, state database seperti apa?

Top engineer tidak hanya bertanya:

> “SQL ini jalan atau tidak?”

Tetapi bertanya:

> “SQL ini akan berinteraksi seperti apa dengan traffic production?”

---

## 3. Apa Itu Lock?

Lock adalah mekanisme database untuk menjaga konsistensi saat banyak transaksi membaca/menulis objek yang sama.

Secara kasar, lock dapat terjadi pada:

- row;
- page/block;
- table;
- index;
- metadata/catalog;
- schema object;
- advisory/application-level lock;
- migration history table;
- changelog lock table.

Lock bukan selalu buruk. Tanpa lock, database tidak bisa menjaga constraint dan consistency. Masalahnya adalah ketika lock:

- terlalu besar cakupannya;
- ditahan terlalu lama;
- tidak kompatibel dengan traffic normal;
- tidak memiliki timeout;
- tidak terlihat oleh operator;
- terjadi saat deployment window kritis.

### 3.1 Lock Compatibility

Inti lock bukan hanya “ada lock”, tetapi apakah lock A compatible dengan lock B.

Contoh sederhana:

```text
Operation A              Operation B              Compatible?
----------------------------------------------------------------
SELECT normal            SELECT normal            Usually yes
SELECT normal            UPDATE same row          Depends on DB/isolation
UPDATE row X             UPDATE row X             No, one waits
ALTER TABLE              INSERT/UPDATE table      Often no / depends
CREATE INDEX ONLINE      INSERT/UPDATE table      Depends on DB/options
VALIDATE CONSTRAINT      DML                      Depends on DB/options
DROP COLUMN              SELECT/INSERT/UPDATE     Usually risky/blocking
```

Karena detailnya vendor-specific, migration engineer harus membaca documentation/behavior engine yang dipakai. Namun mental model umumnya tetap sama:

> Semakin besar operasi menyentuh struktur fisik/logis table, semakin besar kemungkinan ia membutuhkan lock kuat.

---

## 4. DDL Lock vs DML Lock

### 4.1 DML Lock

DML adalah operasi data:

```sql
INSERT INTO orders (...);
UPDATE orders SET status = 'PAID' WHERE id = 10;
DELETE FROM orders WHERE id = 10;
```

DML biasanya mengambil lock pada row yang dimodifikasi. Namun efeknya bisa melebar karena:

- foreign key check;
- unique index check;
- trigger;
- cascading delete/update;
- missing index on FK child table;
- full table scan update;
- high isolation level;
- gap lock / next-key lock di beberapa engine;
- long transaction.

### 4.2 DDL Lock

DDL adalah operasi struktur:

```sql
ALTER TABLE orders ADD COLUMN external_ref VARCHAR(100);
CREATE INDEX idx_orders_status ON orders(status);
DROP TABLE old_orders;
ALTER TABLE orders ADD CONSTRAINT ...;
```

DDL sering membutuhkan lock pada metadata table/object. Bahkan ketika DDL tampak sederhana, database perlu memastikan tidak ada transaksi lain yang melihat struktur setengah berubah.

Masalahnya:

- beberapa database melakukan implicit commit sebelum/sesudah DDL;
- beberapa DDL tidak transactional;
- beberapa DDL melakukan table rewrite;
- beberapa DDL memblokir DML;
- beberapa DDL menunggu semua transaksi aktif selesai;
- beberapa DDL cepat jika metadata-only, lambat jika perlu rewrite.

---

## 5. Metadata-Only Change vs Physical Rewrite

Ini salah satu perbedaan paling penting.

Dua migration dapat terlihat mirip:

```sql
ALTER TABLE customer ADD COLUMN nickname VARCHAR(100);
```

vs

```sql
ALTER TABLE customer ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
```

Tetapi lock dan biaya fisiknya bisa sangat berbeda tergantung database dan versi.

### 5.1 Metadata-Only Change

Metadata-only berarti database hanya mengubah catalog/metadata, tidak membaca dan menulis ulang seluruh row.

Contoh yang sering metadata-only di banyak engine modern:

```sql
ALTER TABLE orders ADD COLUMN note VARCHAR(255);
```

Jika nullable dan tanpa expensive default, ini bisa cepat karena row lama tidak perlu langsung diubah secara fisik.

### 5.2 Physical Rewrite

Physical rewrite berarti database perlu memproses banyak atau seluruh row existing.

Contoh yang berpotensi rewrite:

```sql
ALTER TABLE orders ALTER COLUMN amount TYPE DECIMAL(19, 4);
```

```sql
ALTER TABLE orders ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
```

```sql
ALTER TABLE orders SET NOT NULL ON some_column;
```

```sql
ALTER TABLE orders DROP COLUMN large_payload;
```

Physical rewrite berisiko karena:

- durasi panjang;
- lock panjang;
- redo/WAL/transaction log besar;
- undo besar;
- replication lag;
- IO spike;
- blocking traffic;
- rollback mahal;
- disk usage sementara naik.

Rule of thumb:

> Jangan menilai risiko migration dari jumlah baris SQL. Nilai dari jumlah row/data/object yang disentuh dan lock yang dibutuhkan.

---

## 6. Transaction Semantics in Migration

Saat Flyway/Liquibase menjalankan migration, ada pertanyaan penting:

> Apakah migration berjalan dalam transaction?

Jawabannya tergantung:

- database engine;
- jenis statement;
- konfigurasi Flyway/Liquibase;
- driver/JDBC behavior;
- apakah DDL transactional di database tersebut;
- apakah migration script mengandung statement yang tidak bisa dijalankan dalam transaction.

### 6.1 Transactional Migration

Transactional migration idealnya punya sifat:

```text
all applied OR nothing applied
```

Jika statement ke-3 gagal, statement 1–2 ikut rollback.

Keuntungan:

- atomic;
- mudah reasoning;
- migration history tidak mudah inconsistent;
- failure recovery lebih sederhana.

Risiko:

- transaction panjang;
- lock ditahan sampai commit;
- undo/WAL/log besar;
- replication lag;
- timeout;
- vacuum/cleanup terhambat di MVCC database;
- sulit untuk backfill besar.

### 6.2 Non-Transactional Migration

Beberapa DDL non-transactional atau auto-commit. Jika gagal di tengah, perubahan sebelumnya tetap ada.

Contoh konseptual:

```text
Statement 1: ALTER TABLE add column     SUCCESS committed
Statement 2: CREATE INDEX               SUCCESS committed
Statement 3: ALTER TABLE add constraint FAILED
```

State akhir:

```text
column exists
index exists
constraint missing
migration marked failed / not completed
```

Recovery-nya harus manual/explicit:

- cek object yang sudah dibuat;
- buat corrective migration;
- repair history jika perlu;
- hindari edit migration lama sembarangan;
- pastikan semua environment converge.

### 6.3 Long Transaction Problem

Backfill seperti ini terlihat simpel:

```sql
UPDATE customer
SET normalized_email = LOWER(email)
WHERE normalized_email IS NULL;
```

Jika `customer` berisi 100 juta row, ini bisa menjadi long transaction.

Dampaknya:

- row lock banyak;
- undo/WAL besar;
- replication lag;
- query lain lambat;
- vacuum cleanup tertahan;
- rollback sangat mahal;
- database bisa kehabisan disk/log space;
- application timeout.

Karena itu data migration besar sebaiknya chunked:

```text
update 5k rows
commit
sleep/throttle
repeat
checkpoint progress
```

Flyway/Liquibase migration file bukan selalu tempat terbaik untuk backfill besar. Kadang schema migration dilakukan oleh Flyway/Liquibase, sedangkan backfill dilakukan oleh controlled batch job.

---

## 7. Migration History Lock: Flyway and Liquibase

Selain lock di table aplikasi, migration tool sendiri juga menggunakan mekanisme koordinasi.

### 7.1 Flyway Schema History Table

Flyway menyimpan riwayat migration di schema history table. Table ini berisi migration yang sudah dijalankan, versinya, checksum, status, dan metadata lain. Ini berfungsi sebagai audit trail dan source of truth untuk menentukan migration berikutnya.

Konsekuensi:

- dua proses Flyway tidak boleh sembarangan menjalankan migration bersamaan;
- ada mekanisme locking/coordination agar migration serial;
- jika aplikasi scale-out dan semua instance menjalankan Flyway saat startup, hanya satu yang seharusnya melakukan migration;
- instance lain bisa menunggu, gagal, atau start setelah migration selesai tergantung konfigurasi dan timing.

### 7.2 Liquibase DATABASECHANGELOG and DATABASECHANGELOGLOCK

Liquibase memakai table `DATABASECHANGELOG` untuk mencatat changeset yang sudah dijalankan dan `DATABASECHANGELOGLOCK` untuk mencegah dua proses Liquibase melakukan update bersamaan.

Konsekuensi:

- jika process mati saat lock aktif, lock bisa tertinggal;
- operator perlu tahu cara release lock secara aman;
- jangan asal delete lock tanpa memastikan tidak ada migration masih berjalan;
- migration job harus punya timeout dan observability.

### 7.3 Application Startup Migration Risk

Pattern umum:

```text
Kubernetes deploy 10 pods
all pods start
all pods attempt migration
one wins lock
others wait/fail
```

Untuk production serius, sering lebih aman menggunakan external migration step:

```text
CI/CD pipeline
  ├─ deploy migration job
  ├─ wait until migration success
  ├─ deploy application pods
  └─ verify app health
```

Atau:

```text
Kubernetes Job runs migration
application deployment starts after Job success
```

Ini mengurangi risiko race condition saat startup.

---

## 8. Common Locking Failure Scenarios

### 8.1 Migration Menunggu Transaksi Lama

Skenario:

```text
10:00 report query starts long transaction
10:02 migration ALTER TABLE starts
10:02 migration waits for lock
10:03 application DML queues behind migration
10:05 users see timeout
```

Masalahnya bukan hanya long query. Migration yang menunggu lock bisa menyebabkan antrian baru.

Pattern blocking chain:

```text
Long Tx holds weak/old lock
        ↓
Migration waits for strong lock
        ↓
New app queries wait behind migration
        ↓
Production outage
```

Ini sering terjadi karena database memberi prioritas pada pending exclusive lock. Query baru yang sebenarnya compatible dengan long transaction ikut tertahan karena ada DDL menunggu exclusive lock.

Mitigasi:

- pre-flight check active transactions;
- set lock timeout pendek;
- jangan biarkan migration menunggu selamanya;
- jalankan saat low traffic;
- kill/cancel long idle transaction jika sesuai prosedur;
- gunakan online DDL jika tersedia;
- pecah migration.

### 8.2 Index Creation Blocking Writes

Migration:

```sql
CREATE INDEX idx_order_status ON orders(status);
```

Di table kecil aman. Di table besar bisa:

- scan table panjang;
- consume IO/CPU;
- block write tergantung DB/options;
- produce replication lag;
- fail karena disk/temp space;
- hold metadata lock.

Mitigasi:

- gunakan online/concurrent index option jika database mendukung;
- jalankan di maintenance window;
- monitor progress;
- pastikan disk/temp space cukup;
- create index sebelum constraint yang bergantung pada index;
- hindari migration transaction wrapping jika statement tidak boleh dalam transaction.

### 8.3 Adding NOT NULL Column to Large Table

Risky version:

```sql
ALTER TABLE users
ADD COLUMN country_code VARCHAR(2) NOT NULL DEFAULT 'ID';
```

Lebih aman dengan expand/backfill/contract:

```sql
-- V1 expand
ALTER TABLE users ADD COLUMN country_code VARCHAR(2);
```

```sql
-- Backfill separately/chunked
UPDATE users
SET country_code = 'ID'
WHERE country_code IS NULL
  AND id BETWEEN ? AND ?;
```

```sql
-- V2 contract after validation
ALTER TABLE users ALTER COLUMN country_code SET NOT NULL;
```

Bahkan `SET NOT NULL` sendiri bisa butuh scan/validation. Jadi perlu precheck:

```sql
SELECT COUNT(*)
FROM users
WHERE country_code IS NULL;
```

### 8.4 Foreign Key Constraint Without Index

Menambahkan foreign key dapat memicu lock dan validation besar.

```sql
ALTER TABLE order_item
ADD CONSTRAINT fk_order_item_order
FOREIGN KEY (order_id) REFERENCES orders(id);
```

Risiko:

- existing data harus divalidasi;
- child table besar discan;
- DML ke parent/child bisa terdampak;
- delete/update parent bisa lambat jika FK child tidak diindex;
- lock behavior vendor-specific.

Mitigasi:

- buat index child FK column dulu;
- validate data dulu;
- gunakan NOT VALID / NOVALIDATE pattern jika tersedia;
- validate constraint separately;
- jalankan saat traffic rendah.

### 8.5 Drop Column/Table Too Early

```sql
ALTER TABLE customer DROP COLUMN old_email;
```

Risiko:

- old app masih membaca column;
- report masih memakai column;
- stored procedure/view masih bergantung;
- table rewrite / metadata lock;
- rollback aplikasi gagal;
- audit/debug data hilang.

Mitigasi:

- deprecate dulu;
- stop write/read dari aplikasi;
- monitor no usage;
- contract di release berikutnya;
- backup/export jika data bernilai;
- jangan drop di release yang sama dengan code switch kecuali maintenance offline jelas.

---

## 9. Vendor-Specific Locking Overview

Bagian ini bukan dokumentasi lengkap setiap database. Tujuannya memberi mental map.

### 9.1 PostgreSQL

PostgreSQL menggunakan MVCC dan lock modes. Banyak DDL mengambil lock pada table. Beberapa operasi punya mode lebih aman, tetapi tetap perlu hati-hati.

Contoh concern:

- `ALTER TABLE` tertentu mengambil lock kuat;
- `CREATE INDEX` biasa dapat memblokir writes;
- `CREATE INDEX CONCURRENTLY` mengurangi blocking tetapi tidak boleh berjalan dalam transaction block;
- `DROP INDEX CONCURRENTLY` juga punya constraint serupa;
- `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID` bisa menghindari full validation langsung;
- `VALIDATE CONSTRAINT` dapat dilakukan terpisah;
- long transaction dapat menghambat vacuum;
- migration dalam transaction Flyway dapat konflik dengan statement `CONCURRENTLY`.

Contoh safer index creation:

```sql
CREATE INDEX CONCURRENTLY idx_orders_status
ON orders(status);
```

Tetapi ini punya implikasi:

- tidak bisa dijalankan inside transaction block;
- jika gagal, dapat meninggalkan invalid index;
- perlu cleanup;
- Flyway migration perlu configured non-transactional untuk migration tersebut.

Contoh safer FK addition:

```sql
ALTER TABLE order_item
ADD CONSTRAINT fk_order_item_order
FOREIGN KEY (order_id) REFERENCES orders(id)
NOT VALID;
```

Lalu:

```sql
ALTER TABLE order_item
VALIDATE CONSTRAINT fk_order_item_order;
```

### 9.2 Oracle

Oracle punya banyak fitur online operations, tetapi detailnya tergantung edition, versi, object type, dan operasi.

Concern umum:

- DDL melakukan implicit commit;
- beberapa DDL cepat, beberapa butuh lock/metadata change;
- online index rebuild/create dapat mengurangi blocking;
- constraint bisa `ENABLE NOVALIDATE`, `ENABLE VALIDATE`, dan variasi lain;
- LOB operation dapat sangat mahal;
- segment movement/shrink dapat berdampak pada index/locks;
- long transaction menggunakan undo;
- DDL menunggu DML lock dapat menimbulkan blocking;
- object invalidation bisa terjadi pada view/procedure/package.

Pattern constraint bertahap:

```sql
ALTER TABLE order_item ADD CONSTRAINT fk_order_item_order
FOREIGN KEY (order_id) REFERENCES orders(id)
ENABLE NOVALIDATE;
```

Makna konseptual:

- constraint berlaku untuk data baru;
- data lama belum seluruhnya divalidasi;
- validasi historis bisa direncanakan terpisah.

Index online example:

```sql
CREATE INDEX idx_orders_status
ON orders(status)
ONLINE;
```

Namun jangan menganggap semua operasi Oracle otomatis aman. Untuk table besar/LOB-heavy table, profile operation harus diuji dengan data realistis.

### 9.3 MySQL / MariaDB / InnoDB

MySQL/InnoDB punya konsep metadata lock yang sering mengejutkan.

Concern umum:

- DDL mengambil metadata lock;
- query lama dapat menahan metadata lock;
- DDL yang menunggu metadata lock dapat membuat query baru ikut antre;
- `ALTER TABLE` bisa copy table, inplace, atau instant tergantung versi/operation;
- `ALGORITHM=INPLACE` / `ALGORITHM=INSTANT` / `LOCK=NONE` bisa membantu tapi tidak universal;
- foreign key dan index behavior perlu diperhatikan;
- long transaction dapat memperparah purge/undo;
- online DDL tetap dapat memengaruhi performance.

Contoh intent lebih aman:

```sql
ALTER TABLE users
ADD COLUMN nickname VARCHAR(100),
ALGORITHM=INSTANT,
LOCK=NONE;
```

Tetapi engine dapat menolak jika operasi tidak mendukung algorithm tersebut. Itu bagus, karena failure lebih baik daripada diam-diam melakukan table copy besar.

### 9.4 SQL Server

SQL Server punya locking, blocking, online index options pada edition tertentu, dan transaction log concern.

Concern umum:

- DDL dapat mengambil schema modification locks;
- online index operation tersedia untuk skenario tertentu;
- transaction log dapat membesar saat backfill besar;
- lock escalation bisa terjadi;
- snapshot isolation/read committed snapshot memengaruhi blocking behavior;
- adding constraint/index di table besar perlu planning;
- long transaction menghambat log truncation.

Contoh online index intent:

```sql
CREATE INDEX IX_Orders_Status
ON dbo.Orders(Status)
WITH (ONLINE = ON);
```

Tetap perlu validasi edition/support dan test volume realistis.

---

## 10. Online DDL: Apa Artinya Sebenarnya?

“Online DDL” sering disalahpahami sebagai “tidak ada impact”. Itu salah.

Online DDL biasanya berarti:

- operasi mencoba mengurangi blocking;
- DML mungkin masih bisa berjalan;
- lock eksklusif mungkin hanya sebentar di awal/akhir;
- database mungkin membuat struktur sementara;
- ada overhead CPU/IO/log;
- masih bisa gagal;
- masih bisa menimbulkan lag;
- masih butuh monitoring.

Mental model:

```text
Offline DDL:
  lock strongly → do work → release

Online DDL:
  brief lock/setup → concurrent work with overhead → brief lock/cutover → release
```

Online DDL mengurangi risiko, bukan menghapus risiko.

### 10.1 Online Does Not Mean Free

Online index creation di table besar tetap bisa:

- membaca seluruh table;
- menulis index baru;
- menggunakan temp space;
- membuat redo/WAL/log besar;
- memperlambat query normal;
- menimbulkan replication lag;
- gagal jika concurrent write pattern terlalu tinggi;
- memerlukan short exclusive lock saat finalization.

Jadi runbook tetap diperlukan.

---

## 11. Timeout Strategy

Migration tanpa timeout adalah risiko besar.

Ada beberapa jenis timeout:

- lock timeout: berapa lama boleh menunggu lock;
- statement timeout: berapa lama statement boleh berjalan;
- transaction timeout: berapa lama transaction boleh hidup;
- application startup timeout;
- CI/CD job timeout;
- Kubernetes Job active deadline;
- database session idle timeout.

### 11.1 Lock Timeout

Lock timeout menjawab:

> Kalau migration tidak bisa mendapatkan lock dengan cepat, apakah lebih baik menunggu atau gagal cepat?

Untuk production, sering lebih baik gagal cepat daripada membuat blocking chain panjang.

Contoh PostgreSQL:

```sql
SET lock_timeout = '5s';
SET statement_timeout = '5min';
```

Contoh Oracle conceptual:

```sql
ALTER SESSION SET DDL_LOCK_TIMEOUT = 5;
```

Strategi:

- set lock timeout pendek untuk DDL berisiko;
- set statement timeout sesuai expected duration;
- fail fast jika lock tidak tersedia;
- retry di deployment window atau setelah blocker dibersihkan;
- jangan biarkan migration menggantung tanpa batas.

### 11.2 Statement Timeout

Statement timeout menjawab:

> Kalau statement berjalan terlalu lama, kapan dianggap tidak sehat?

Perlu hati-hati. Untuk index creation besar, timeout terlalu pendek membuat migration gagal padahal sedang sehat. Untuk DDL kecil, timeout terlalu panjang bisa membuat outage.

Gunakan klasifikasi:

```text
Small metadata DDL:       lock timeout short, statement timeout short/medium
Online index:             lock timeout short, statement timeout long enough
Backfill chunk:           per chunk timeout short/medium
Constraint validation:    lock timeout short, statement timeout based on volume test
```

---

## 12. Pre-Flight Checks Before Migration

Production-grade migration perlu pre-flight check.

### 12.1 Object Existence and Drift Check

Sebelum migration:

- apakah object sudah ada?
- apakah column type sesuai expectation?
- apakah constraint belum ada?
- apakah index belum ada?
- apakah migration history clean?
- apakah ada manual drift?

Flyway:

```bash
flyway validate
flyway info
```

Liquibase:

```bash
liquibase status
liquibase validate
```

### 12.2 Active Transaction Check

Cari transaksi lama yang bisa memblokir DDL.

Generic questions:

- ada transaction lebih dari N menit?
- ada session idle in transaction?
- ada query report panjang?
- ada batch job sedang running?
- ada lock wait existing?
- ada replication lag?

### 12.3 Data Volume Check

Untuk table target:

```sql
SELECT COUNT(*) FROM target_table;
```

Tapi count bisa mahal di beberapa DB. Alternatif:

- catalog stats;
- approximate row count;
- table size;
- index size;
- partition size;
- latest analyze stats.

Pertanyaan utama:

- berapa row?
- berapa GB?
- ada LOB?
- ada partition?
- write rate berapa?
- growth rate berapa?
- query critical apa yang menyentuh table ini?

### 12.4 Disk/Log/Undo/WAL Capacity Check

Migration besar dapat memakai storage tambahan.

Check:

- free disk;
- temp tablespace;
- undo tablespace;
- transaction log;
- WAL archive space;
- redo log pressure;
- replication slot lag;
- backup window overlap.

### 12.5 Dependency Check

Sebelum drop/alter object:

- view yang bergantung;
- stored procedure/function;
- trigger;
- foreign key;
- report;
- ETL;
- BI dashboard;
- app query;
- ORM mapping;
- MyBatis mapper;
- external integration.

---

## 13. During-Flight Monitoring

Saat migration berjalan, operator harus bisa menjawab:

- migration sedang statement apa?
- berapa lama sudah berjalan?
- sedang menunggu lock atau melakukan work?
- siapa blocker-nya?
- siapa yang diblokir olehnya?
- CPU/IO naik wajar atau abnormal?
- transaction log/WAL naik berbahaya atau tidak?
- replication lag naik atau tidak?
- app error rate naik atau tidak?

Minimal observability:

```text
Migration job logs:
  - migration version
  - statement/chunk name
  - start time
  - duration
  - rows affected
  - success/failure

Database monitoring:
  - active sessions
  - lock wait
  - blocking session
  - long transaction
  - temp usage
  - log/WAL growth
  - replication lag

Application monitoring:
  - latency
  - error rate
  - connection pool usage
  - timeout count
```

---

## 14. Post-Flight Verification

Setelah migration selesai, jangan hanya percaya exit code.

Checklist:

- migration history updated;
- expected table/column/index/constraint exists;
- invalid object tidak ada;
- seed/backfill row count sesuai;
- application health normal;
- slow query tidak memburuk;
- index dipakai oleh query planner;
- replication lag normal;
- no unexpected locks;
- no failed jobs;
- no error spike;
- no data drift.

Contoh verification query:

```sql
SELECT COUNT(*)
FROM users
WHERE new_column IS NULL;
```

```sql
SELECT status, COUNT(*)
FROM migration_checkpoint
GROUP BY status;
```

```sql
-- vendor-specific explain plan check
EXPLAIN SELECT * FROM orders WHERE status = 'PAID';
```

---

## 15. Lock-Safe Migration Design Patterns

### 15.1 Add Nullable Column First

Safer:

```sql
ALTER TABLE customer ADD COLUMN normalized_email VARCHAR(320);
```

Then backfill:

```sql
UPDATE customer
SET normalized_email = LOWER(email)
WHERE normalized_email IS NULL
  AND id BETWEEN :fromId AND :toId;
```

Then enforce:

```sql
ALTER TABLE customer ALTER COLUMN normalized_email SET NOT NULL;
```

### 15.2 Create Index Before Constraint

Instead of adding unique constraint directly to huge table:

```sql
ALTER TABLE users
ADD CONSTRAINT uk_users_email UNIQUE(email);
```

Safer pattern:

1. clean duplicate data;
2. create unique index online/concurrently if supported;
3. attach/enforce constraint using index if supported;
4. validate separately.

### 15.3 Constraint Not Valid / Novalidate First

Add constraint for future writes first, validate old data later.

Conceptual:

```text
Phase 1: add constraint but do not scan all old data
Phase 2: fix old violations
Phase 3: validate constraint
```

### 15.4 Chunked Backfill

Avoid:

```sql
UPDATE huge_table SET new_col = expensive_function(old_col);
```

Prefer:

```text
while rows remain:
  update next chunk
  commit
  record checkpoint
  sleep if needed
```

### 15.5 Shadow Object

For large type/table reshape:

```text
create new table/column
copy data gradually
dual-write
verify
switch reads
contract old object later
```

### 15.6 Avoid Same-Release Drop

Do not add new code and drop old column in same release if rollback is needed.

```text
Release N: add new column
Release N: app writes both
Release N+1: app reads new
Release N+2: stop writing old
Release N+3: drop old
```

---

## 16. Flyway-Specific Transaction and Lock Considerations

### 16.1 Transaction Per Migration

Flyway commonly executes SQL migrations in transaction where database supports it. But not all statements can be transactional.

Examples needing special handling:

- PostgreSQL `CREATE INDEX CONCURRENTLY`;
- PostgreSQL `DROP INDEX CONCURRENTLY`;
- some database-specific online operations;
- statements that auto-commit;
- long-running backfill that should not be one transaction.

Design implication:

- isolate non-transactional operation in its own migration file;
- document why it is non-transactional;
- add pre/post validation;
- ensure recovery if it fails partially.

### 16.2 One Risky Statement Per Migration

For high-risk DDL, avoid bundling too much:

Bad:

```sql
ALTER TABLE users ADD COLUMN normalized_email VARCHAR(320);
CREATE INDEX CONCURRENTLY idx_users_normalized_email ON users(normalized_email);
ALTER TABLE users ADD CONSTRAINT ...;
UPDATE users SET normalized_email = LOWER(email);
```

Better:

```text
V202610010900__add_users_normalized_email_column.sql
V202610010910__create_users_normalized_email_index.sql
V202610010920__validate_users_normalized_email_backfill_ready.sql
V202610010930__add_users_normalized_email_constraint.sql
```

### 16.3 Flyway Callback for Session Timeout

You can use callbacks to set session parameters before migration.

Example conceptual PostgreSQL callback:

```sql
-- beforeMigrate.sql
SET lock_timeout = '5s';
SET statement_timeout = '10min';
```

But be careful:

- one timeout does not fit all migrations;
- index migration may need different statement timeout;
- backfill chunk may need shorter timeout;
- vendor behavior differs.

---

## 17. Liquibase-Specific Transaction and Lock Considerations

### 17.1 `runInTransaction`

Liquibase changesets can control whether they run in transaction, depending on database support.

Conceptual example:

```yaml
databaseChangeLog:
  - changeSet:
      id: 20261001-001-create-index-concurrently
      author: team
      runInTransaction: false
      changes:
        - sql:
            sql: CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status);
```

Use this carefully.

If `runInTransaction: false` and multiple statements exist in the same changeset, partial application is possible. Prefer one risky statement per changeset.

### 17.2 Liquibase Lock Table

If Liquibase process crashes, `DATABASECHANGELOGLOCK` may remain locked.

Safe release process:

1. verify no Liquibase process still running;
2. inspect database active session;
3. inspect deployment job status;
4. inspect partial changes;
5. only then release lock using official command/procedure;
6. rerun status/validate;
7. continue with repair/corrective changeset if needed.

Do not manually update lock table casually.

### 17.3 Preconditions as Lock Risk Guard

Liquibase preconditions can prevent risky statements from running in unexpected state.

Example conceptual:

```yaml
preConditions:
  - onFail: HALT
  - tableExists:
      tableName: users
  - columnExists:
      tableName: users
      columnName: email
```

For lock-sensitive operations, preconditions can check structural readiness, but they do not replace operational checks like active transactions and data volume.

---

## 18. Migration and Java Application Runtime

### 18.1 Startup Migration Risk in Spring Boot

If Spring Boot app runs Flyway/Liquibase at startup:

```text
pod starts
migration runs
JPA initializes
app becomes ready
```

Risk:

- startup timeout;
- readiness probe failure;
- multiple pods racing;
- app deploy blocked by migration lock;
- migration failure causes all pods to crash;
- rollback app cannot rollback database automatically.

For small internal apps this may be acceptable. For high-availability production, prefer separate migration job.

### 18.2 Connection Pool Interaction

Migration should not use the same constrained runtime pool in a way that starves application traffic.

Risks:

- migration holds connection long;
- app pool exhausted;
- startup migration competes with JPA validation;
- batch backfill opens too many connections;
- transaction isolation/session settings leak if connection reused incorrectly.

In Java systems:

- separate migration datasource may be useful;
- migration user should have DDL privileges;
- app user should have limited privileges;
- connection pool size for migration should be small and intentional;
- chunk workers should not exceed DB capacity.

### 18.3 Readiness and Liveness

If migration runs inside app startup:

- readiness should be false until migration complete;
- liveness should not kill long but healthy migration prematurely;
- startup probe may be needed in Kubernetes;
- deployment timeout must align with migration expected duration.

But this is fragile for long migration. External job is cleaner.

---

## 19. Choosing Where to Run the Migration

### 19.1 Inside Application Startup

Good for:

- small apps;
- local/dev/test;
- simple schema change;
- low traffic system;
- single instance deployment;
- fast migration.

Bad for:

- large migration;
- multi-pod production;
- strict uptime;
- complex backfill;
- privileged migration user separation;
- approval-gated production.

### 19.2 CI/CD Migration Step

Good for:

- controlled release process;
- auditability;
- approval gate;
- migration logs centralized;
- app deployment only after migration success.

Risk:

- pipeline must access DB securely;
- network path and secrets need governance;
- failed migration needs runbook;
- rollback must be explicit.

### 19.3 Kubernetes Job

Good for:

- cloud-native deployment;
- same network/security boundary as app;
- controlled one-shot execution;
- logs observable;
- can use service account/secrets.

Need:

- active deadline;
- backoff limit;
- idempotency;
- no multiple concurrent jobs;
- clear cleanup policy;
- deployment dependency.

### 19.4 Manual DBA Execution

Sometimes required in regulated/high-risk systems.

Good for:

- privileged operation;
- maintenance window;
- large one-time changes;
- strict approval.

Risk:

- drift from repository;
- manual typo;
- migration history not updated;
- poor repeatability;
- hard to reproduce lower env.

If DBA executes SQL manually, repository and migration history still need reconciliation.

---

## 20. Designing a Lock Profile for a Migration

For every non-trivial migration, write a lock profile.

Template:

```text
Migration:
  V202610011000__add_order_status_index.sql

Target object:
  orders

Operation:
  create index on orders(status)

Expected data volume:
  150M rows, 320GB table, high write rate during business hours

Lock expectation:
  online/concurrent index build
  brief metadata lock at start/end
  should not block normal writes except short finalization phase

Transaction profile:
  non-transactional / cannot run inside transaction block

Timeout:
  lock timeout 5s
  statement timeout 2h
  pipeline timeout 3h

Risk:
  IO spike, replication lag, invalid index if failed

Pre-flight:
  check long tx
  check disk/temp
  check replication lag
  check index not exists

During-flight:
  monitor index progress, lock wait, IO, app latency

Post-flight:
  verify index valid
  verify query plan
  verify app latency

Recovery:
  if invalid/failed index remains, drop concurrently/online if supported
  rerun migration/corrective migration
```

This is the kind of detail that separates production engineering from “migration script writing”.

---

## 21. Common Anti-Patterns

### 21.1 Blind `ALTER TABLE` on Large Table

```sql
ALTER TABLE transaction_log ADD COLUMN processed BOOLEAN NOT NULL DEFAULT FALSE;
```

Without knowing table size, DB version, default behavior, and lock profile, this is gambling.

### 21.2 Huge Backfill in One Migration Transaction

```sql
UPDATE audit_trail
SET searchable_text = LOWER(full_text);
```

If table is huge/CLOB-heavy, this can be catastrophic.

### 21.3 Creating Index During Peak Traffic

Even online index build can damage latency.

### 21.4 No Lock Timeout

Migration waits forever, blocks chain, outage happens.

### 21.5 Mixing DDL and Massive DML

```sql
ALTER TABLE users ADD COLUMN x VARCHAR(100);
UPDATE users SET x = ...;
ALTER TABLE users ALTER COLUMN x SET NOT NULL;
```

This couples fast schema change with slow data change and hard contract enforcement.

### 21.6 Running Migration from Every App Instance

Scale-out startup migration can cause race/wait/failure behavior.

### 21.7 Trusting Staging with Tiny Data

A migration that runs in 2 seconds on staging with 10k rows may run for 2 hours on production with 500M rows.

### 21.8 Assuming Online Means No Impact

Online is lower blocking, not zero cost.

### 21.9 Editing Old Migration After Production

This creates checksum mismatch and environment divergence.

### 21.10 No Recovery Plan

Every high-risk migration should answer:

- what if it fails before start?
- what if it fails halfway?
- what if it succeeds but app fails?
- what if it causes latency spike?
- what if rollback code is needed?

---

## 22. Practical Design Example: Adding an Index Safely

### 22.1 Naive Version

```sql
CREATE INDEX idx_orders_created_at ON orders(created_at);
```

Problem:

- may block writes;
- may run too long;
- no timeout;
- no precheck;
- no recovery;
- no validation.

### 22.2 Production-Oriented Version

For PostgreSQL conceptually:

```sql
-- V202610011000__create_orders_created_at_index.sql
SET lock_timeout = '5s';
SET statement_timeout = '2h';

CREATE INDEX CONCURRENTLY idx_orders_created_at
ON orders(created_at);
```

But because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, configure this migration as non-transactional according to your Flyway/Liquibase mechanism.

Pre-flight:

```sql
-- check no duplicate name / index not exists
-- check active long transactions
-- check disk
-- check replication lag
```

Post-flight:

```sql
-- verify index exists and is valid
-- run EXPLAIN for target query
-- monitor performance
```

Recovery:

```sql
-- if invalid index remains
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_created_at;
```

Vendor-specific SQL changes, but the engineering shape remains.

---

## 23. Practical Design Example: Adding a NOT NULL Column Safely

Requirement:

> Add `customer.risk_level` and make it mandatory.

### 23.1 Bad Version

```sql
ALTER TABLE customer
ADD COLUMN risk_level VARCHAR(20) NOT NULL DEFAULT 'LOW';
```

Risk depends on DB. Could be fine for small table, dangerous for huge table.

### 23.2 Safer Multi-Phase Version

#### Phase 1 — Expand

```sql
ALTER TABLE customer
ADD COLUMN risk_level VARCHAR(20);
```

#### Phase 2 — App Dual Behavior

New app writes `risk_level` for new/updated customers.

#### Phase 3 — Backfill

Chunked job:

```sql
UPDATE customer
SET risk_level = 'LOW'
WHERE risk_level IS NULL
  AND id >= :from_id
  AND id < :to_id;
```

#### Phase 4 — Validate

```sql
SELECT COUNT(*)
FROM customer
WHERE risk_level IS NULL;
```

Must return `0`.

#### Phase 5 — Contract

```sql
ALTER TABLE customer
ALTER COLUMN risk_level SET NOT NULL;
```

Or vendor equivalent.

Even Phase 5 may scan/lock depending on DB. Schedule and test it.

---

## 24. Practical Design Example: Adding Foreign Key Safely

Requirement:

> Add FK from `case_assignment.assignee_id` to `user_account.id`.

### 24.1 Precheck Orphan Data

```sql
SELECT ca.assignee_id
FROM case_assignment ca
LEFT JOIN user_account ua ON ua.id = ca.assignee_id
WHERE ca.assignee_id IS NOT NULL
  AND ua.id IS NULL
FETCH FIRST 100 ROWS ONLY;
```

If rows exist, fix data first.

### 24.2 Ensure Child Index

```sql
CREATE INDEX idx_case_assignment_assignee_id
ON case_assignment(assignee_id);
```

Use online/concurrent option if needed.

### 24.3 Add Constraint in Low-Risk Mode

Vendor-specific:

```text
PostgreSQL: ADD CONSTRAINT ... NOT VALID
Oracle: ENABLE NOVALIDATE
SQL Server/MySQL: different patterns/locking considerations
```

### 24.4 Validate Later

```text
validate constraint when traffic and lock risk acceptable
```

---

## 25. Operational Runbook: Lock-Sensitive Migration

### 25.1 Before Migration

```text
[ ] Confirm migration artifact/version
[ ] Confirm backup/PITR readiness
[ ] Confirm migration history clean
[ ] Confirm no unexpected schema drift
[ ] Confirm table size and row count
[ ] Confirm disk/temp/log/undo capacity
[ ] Confirm no long-running transactions
[ ] Confirm no critical batch window overlap
[ ] Confirm replication lag normal
[ ] Confirm app error rate normal
[ ] Confirm lock timeout configured
[ ] Confirm statement timeout configured
[ ] Confirm rollback/roll-forward plan
[ ] Confirm communication channel open
```

### 25.2 During Migration

```text
[ ] Watch migration logs
[ ] Watch active sessions
[ ] Watch blocking/blocked sessions
[ ] Watch DB CPU/IO
[ ] Watch log/WAL/undo growth
[ ] Watch replication lag
[ ] Watch app latency and error rate
[ ] Decide abort if go/no-go threshold breached
```

### 25.3 After Migration

```text
[ ] Confirm migration marked successful
[ ] Confirm object exists/valid
[ ] Confirm expected data state
[ ] Confirm app health
[ ] Confirm query plans if index-related
[ ] Confirm no invalid objects
[ ] Confirm no lingering locks
[ ] Confirm replication lag recovered
[ ] Record duration and observations
[ ] Update runbook with lessons learned
```

---

## 26. How to Think Like a Top 1% Engineer

A basic engineer writes:

```sql
ALTER TABLE users ADD COLUMN x VARCHAR(100);
```

A stronger engineer asks:

- how many rows?
- what DB engine/version?
- is it metadata-only?
- does it rewrite table?
- what lock is taken?
- how long is it held?
- what if there is long transaction?
- can old app still run?
- can new app run before backfill?
- does rollback need old schema?
- should this be expand/contract?
- should backfill be external job?
- do we need timeout?
- what do we monitor?
- what is recovery if migration fails?

A top engineer turns that into a repeatable engineering standard:

```text
Every migration has:
  - classification
  - compatibility assessment
  - lock profile
  - transaction profile
  - data volume estimate
  - timeout plan
  - observability plan
  - recovery plan
  - verification query
  - ownership
```

---

## 27. Practical Checklist for Reviewing Migration PRs

Use this checklist during code review.

### 27.1 Structural Review

```text
[ ] Migration filename/version is correct
[ ] Migration is ordered correctly
[ ] Migration does not edit old applied migration
[ ] Migration has clear purpose
[ ] Migration is small enough to reason about
[ ] DDL and DML are separated when appropriate
```

### 27.2 Compatibility Review

```text
[ ] Old app can tolerate new schema
[ ] New app can tolerate old/intermediate schema if needed
[ ] Rollback app scenario considered
[ ] Destructive changes delayed to contract phase
```

### 27.3 Lock/Transaction Review

```text
[ ] Lock profile understood
[ ] Transaction behavior understood
[ ] Non-transactional statements isolated
[ ] Long-running statements avoided or justified
[ ] Lock timeout considered
[ ] Statement timeout considered
```

### 27.4 Data Volume Review

```text
[ ] Table size known
[ ] Row count known/estimated
[ ] Backfill is chunked if large
[ ] Index build cost considered
[ ] Constraint validation cost considered
[ ] LOB/large column impact considered
```

### 27.5 Operational Review

```text
[ ] Pre-flight query exists
[ ] Post-flight query exists
[ ] Monitoring plan exists
[ ] Recovery plan exists
[ ] Migration owner identified
[ ] Deployment window appropriate
```

---

## 28. Summary

Database locking and transaction behavior are central to safe migration engineering.

Key takeaways:

1. Migration is a concurrent system change, not just SQL execution.
2. DDL may require strong metadata/schema locks.
3. DML backfill can create long transactions and massive log/undo pressure.
4. Metadata-only and physical rewrite operations have very different risk profiles.
5. Online DDL reduces blocking but does not eliminate cost.
6. Lock timeout is a production safety mechanism.
7. Long transactions can block DDL, and pending DDL can block new traffic.
8. Flyway and Liquibase also use locking for migration coordination.
9. High-risk operations should be isolated, observable, and recoverable.
10. Top-tier migration engineering requires lock profile, transaction profile, timeout plan, and runbook.

---

## 29. What Comes Next

Bagian berikutnya:

```text
22-vendor-specific-migration-engineering.md
```

Kita akan membahas lebih dalam vendor-specific migration engineering untuk:

- PostgreSQL;
- Oracle;
- MySQL/MariaDB;
- SQL Server;
- H2/HSQLDB test database trap;
- type differences;
- sequence/identity differences;
- JSON/CLOB/BLOB;
- constraint/index behavior;
- identifier and naming limits;
- testing against real engine.

Jika Part 21 ini fokus pada locking dan online DDL secara umum, Part 22 akan masuk ke perbedaan nyata antar database engine agar migration yang kita tulis tidak hanya benar di local, tetapi benar di production database yang sebenarnya.

---

## 30. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Completed:
  Part 0  - Orientation: Database Change as Engineering Discipline
  Part 1  - Taxonomy of Database Changes
  Part 2  - Migration Invariants and Failure Models
  Part 3  - Database Versioning Models
  Part 4  - Flyway Mental Model
  Part 5  - Flyway Setup in Java 8–25 Projects
  Part 6  - Flyway SQL Migration Design
  Part 7  - Flyway Repeatable Migrations
  Part 8  - Flyway Java-Based Migrations
  Part 9  - Flyway Callbacks and Lifecycle Hooks
  Part 10 - Flyway Baseline, Repair, Validate, Clean
  Part 11 - Liquibase Mental Model
  Part 12 - Liquibase Setup in Java 8–25 Projects
  Part 13 - Liquibase Changelog Design
  Part 14 - Liquibase Preconditions, Contexts, Labels
  Part 15 - Liquibase Rollback Engineering
  Part 16 - Flyway vs Liquibase: Decision Framework
  Part 17 - Seeding Strategy: Reference Data, Master Data, and Bootstrap Data
  Part 18 - Idempotent and Deterministic Seed Design
  Part 19 - Data Migration and Backfill Engineering
  Part 20 - Expand/Contract Pattern for Zero-Downtime Migration
  Part 21 - Database Locking, Transactions, and Online DDL

Remaining:
  Part 22 - Vendor-Specific Migration Engineering
  Part 23 - Migration Testing Strategy
  Part 24 - Migration in Spring Boot Applications
  Part 25 - Migration in Jakarta EE, Plain Java, and Non-Spring Systems
  Part 26 - CI/CD Pipeline for Database Migration
  Part 27 - Multi-Service, Multi-Module, and Shared Database Migrations
  Part 28 - Multi-Tenant Database Migration
  Part 29 - Security, Compliance, and Auditability
  Part 30 - Observability and Operational Runbooks
  Part 31 - Advanced Patterns and Anti-Patterns
  Part 32 - Case Studies: Realistic Production Scenarios
  Part 33 - Capstone: Designing a Production-Grade Migration Platform
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 20 — Expand/Contract Pattern for Zero-Downtime Migration](./20-expand-contract-zero-downtime-migration.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 22 — Vendor-Specific Migration Engineering](./22-vendor-specific-migration-engineering.md)

</div>
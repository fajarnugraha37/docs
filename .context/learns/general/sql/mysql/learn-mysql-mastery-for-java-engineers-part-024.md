# learn-mysql-mastery-for-java-engineers-part-024.md

# Part 024 — Schema Migration Without Taking Production Down

## Metadata

- **Series**: `learn-mysql-mastery-for-java-engineers`
- **Part**: `024 / 034`
- **Topic**: Schema Migration Without Taking Production Down
- **Audience**: Java software engineer / tech lead / backend architect
- **Baseline**: MySQL 8.4 LTS, InnoDB, production Java services
- **Goal**: Membuat engineer mampu merancang, mengeksekusi, mengobservasi, dan memulihkan schema migration MySQL tanpa menjatuhkan sistem produksi.

---

## 1. Core Thesis

Schema migration bukan sekadar menjalankan `ALTER TABLE`.

Dalam sistem production, schema migration adalah **perubahan kontrak antara aplikasi, database, data lama, data baru, deployment pipeline, replication topology, backup/restore strategy, dan operational runbook**.

Kesalahan umum engineer adalah menganggap migration sebagai aktivitas statis:

```sql
ALTER TABLE cases ADD COLUMN priority VARCHAR(20);
```

Padahal secara sistem, migration adalah aktivitas konkuren:

```text
old application version
        |
        | still reading/writing
        v
old schema ---- migration ---- new schema
        ^                       |
        |                       v
      replicas              new application version
```

Selama migration berjalan, ada banyak aktor yang hidup bersamaan:

- versi aplikasi lama
- versi aplikasi baru
- transaksi lama yang belum commit
- connection pool yang masih memegang session state
- background job
- batch processor
- reporting query
- read replica
- migration tool seperti Flyway/Liquibase
- backup job
- failover automation
- DBA/operator

Karena itu migration aman harus menjawab pertanyaan:

> “Apakah seluruh versi aplikasi dan database yang mungkin berjalan pada saat transisi tetap kompatibel, observable, recoverable, dan tidak mengunci workload kritikal?”

---

## 2. Learning Objectives

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membedakan **schema migration**, **data migration**, dan **behavior migration**.
2. Memahami bagaimana MySQL menjalankan DDL melalui algorithm seperti `INSTANT`, `INPLACE`, dan `COPY`.
3. Memahami mengapa `ALTER TABLE` bisa tetap berbahaya walaupun disebut “online”.
4. Mendesain migration dengan pola **expand-contract**.
5. Menjalankan backfill besar tanpa menghancurkan latency production.
6. Menghindari metadata lock incident.
7. Menulis migration yang kompatibel dengan rolling deployment Java.
8. Mengelola migration dengan Flyway/Liquibase secara aman.
9. Menentukan apakah migration bisa dilakukan otomatis, butuh maintenance window, atau harus menggunakan online schema change tooling.
10. Membuat checklist production readiness untuk migration.

---

## 3. Why Schema Migration Is Hard in MySQL

Schema migration sulit karena mengubah struktur yang dipakai oleh transaksi yang sedang berjalan.

Pada level aplikasi, migration terlihat seperti:

```sql
ALTER TABLE enforcement_case ADD COLUMN risk_score INT NULL;
```

Pada level database engine, perubahan itu dapat melibatkan:

- perubahan data dictionary
- metadata lock
- validasi constraint
- rebuild table
- scan seluruh table
- pembuatan index baru
- temporary storage
- redo/undo/binlog generation
- replication event
- lock pada operasi DML tertentu
- perubahan query plan
- invalidasi prepared statement atau metadata cache
- perubahan behavior aplikasi lama dan baru

Pada sistem Java, migration juga menyentuh:

- entity class
- DTO/API contract
- validation logic
- default value logic
- repository/query method
- batch job
- transaction boundary
- serialization/deserialization
- generated SQL dari ORM
- migration ordering di CI/CD
- rollback strategy

Itu sebabnya “migration berhasil di staging” tidak cukup. Yang penting adalah apakah migration berhasil **di bawah concurrency production**.

---

## 4. Three Kinds of Migration

Banyak incident terjadi karena semua perubahan disebut “database migration”, padahal jenisnya berbeda.

### 4.1 Schema Migration

Mengubah bentuk database object.

Contoh:

```sql
ALTER TABLE cases ADD COLUMN severity VARCHAR(20) NULL;
CREATE INDEX idx_cases_status_created_at ON cases(status, created_at);
ALTER TABLE actions MODIFY COLUMN action_code VARCHAR(64) NOT NULL;
```

Risikonya:

- metadata lock
- table rebuild
- index build cost
- query plan berubah
- replication lag
- incompatibility dengan aplikasi lama

### 4.2 Data Migration

Mengubah isi data agar sesuai dengan model baru.

Contoh:

```sql
UPDATE cases
SET severity = 'MEDIUM'
WHERE severity IS NULL;
```

Risikonya:

- transaksi besar
- undo/redo/binlog besar
- lock footprint besar
- replication lag
- buffer pool churn
- deadlock dengan workload aplikasi
- partial progress jika gagal

### 4.3 Behavior Migration

Mengubah cara aplikasi membaca/menulis data.

Contoh:

- sebelumnya membaca `case_status`, sekarang membaca `lifecycle_state`
- sebelumnya satu kolom `address`, sekarang beberapa kolom normalized
- sebelumnya synchronous write, sekarang outbox
- sebelumnya validasi di aplikasi saja, sekarang ada constraint database

Risikonya:

- old/new code incompatibility
- dual-write bug
- semantic drift
- inconsistent read model
- rollback sulit

### 4.4 Production Rule

Migration besar hampir selalu harus dipecah menjadi beberapa tahap:

```text
schema expansion
    -> application writes both / reads old
    -> backfill
    -> application reads new
    -> verify
    -> stop old write
    -> contract old schema
```

Jangan mencampur semua perubahan ke satu script besar kecuali sistem kecil dan downtime acceptable.

---

## 5. MySQL DDL Mental Model

DDL adalah Data Definition Language:

- `CREATE TABLE`
- `ALTER TABLE`
- `DROP TABLE`
- `CREATE INDEX`
- `DROP INDEX`
- `RENAME TABLE`
- `TRUNCATE TABLE`

Di MySQL modern, banyak DDL sudah jauh lebih aman dibanding era lama. Tetapi “lebih aman” bukan berarti “gratis”.

DDL bisa melibatkan tiga dimensi:

```text
1. What must change?
   metadata only? index? full row layout? full table copy?

2. How much concurrency is allowed?
   can DML continue? are reads blocked? are writes blocked?

3. How long are locks held?
   brief metadata lock? long shared lock? exclusive lock?
```

---

## 6. ALTER TABLE Algorithms: INSTANT, INPLACE, COPY

MySQL mendukung beberapa algorithm untuk `ALTER TABLE`.

Syntax umum:

```sql
ALTER TABLE table_name
  ADD COLUMN new_col INT NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

Atau:

```sql
ALTER TABLE table_name
  ADD INDEX idx_status_created_at(status, created_at),
  ALGORITHM=INPLACE,
  LOCK=NONE;
```

### 6.1 `ALGORITHM=INSTANT`

`INSTANT` berarti operasi hanya mengubah metadata di data dictionary. Data table tidak dibaca ulang dan tidak di-copy.

Mental model:

```text
Before:
  table metadata: columns = [id, status]

ALTER ADD COLUMN priority NULL ALGORITHM=INSTANT

After:
  table metadata: columns = [id, status, priority]
  existing rows: interpreted as priority = NULL/default
```

Kelebihan:

- sangat cepat
- tidak rebuild table
- tidak scan seluruh data
- concurrent DML umumnya tetap bisa berjalan

Tetapi jangan salah paham:

- tetap butuh metadata lock, walaupun singkat
- tidak semua ALTER bisa instant
- ada limitasi tergantung operasi, row format, table state, versi MySQL, dan fitur storage engine
- jika ada transaksi lama yang menahan metadata lock, `INSTANT` bisa tetap menunggu

Contoh yang sering instant pada MySQL modern:

```sql
ALTER TABLE cases
  ADD COLUMN risk_score INT NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

Tetapi kamu tetap harus menguji di environment yang mirip production.

### 6.2 `ALGORITHM=INPLACE`

`INPLACE` berarti operasi dilakukan tanpa membuat full logical copy table seperti algorithm `COPY`, tetapi bukan berarti tidak menyentuh data.

Contoh:

```sql
ALTER TABLE cases
  ADD INDEX idx_cases_status_created_at(status, created_at),
  ALGORITHM=INPLACE,
  LOCK=NONE;
```

Index creation biasanya perlu membaca table untuk membangun struktur index. Jadi meskipun DML bisa berjalan, operasi dapat:

- mengonsumsi I/O
- mengonsumsi CPU
- membuat redo/binlog
- membuat temporary files
- menyebabkan replication lag
- mempengaruhi buffer pool
- memegang lock fase tertentu

Mental model:

```text
INPLACE != free
INPLACE != no work
INPLACE != zero risk
INPLACE means MySQL avoids the old full table-copy path when supported.
```

### 6.3 `ALGORITHM=COPY`

`COPY` adalah mode paling berat.

Mental model:

```text
1. create temporary table with new definition
2. copy rows from old table to new table
3. apply changes depending on lock/concurrency model
4. swap table metadata
5. drop old structure
```

Risikonya:

- bisa lama sekali untuk table besar
- butuh disk tambahan
- bisa memblokir writes
- bisa menghasilkan replication lag besar
- rawan timeout/operational incident

Contoh operasi yang bisa memicu rebuild/copy tergantung versi dan kondisi:

- mengubah tipe kolom tertentu
- mengubah panjang kolom dengan cara yang butuh row rewrite
- mengubah column order
- mengubah primary key
- mengubah row format tertentu
- operasi tertentu pada partitioned table

Production rule:

> Jangan biarkan MySQL diam-diam fallback ke algorithm yang lebih berat.

Gunakan explicit algorithm/lock jika kamu ingin operasi gagal daripada diam-diam menjalankan operasi mahal:

```sql
ALTER TABLE cases
  ADD COLUMN risk_score INT NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

Jika operasi tidak support `INSTANT`, biarkan gagal. Setelah itu baru desain strategi lain.

---

## 7. LOCK Clause: NONE, SHARED, EXCLUSIVE

Selain algorithm, MySQL mendukung `LOCK` clause pada banyak operasi DDL.

```sql
ALTER TABLE cases
  ADD INDEX idx_cases_status(status),
  ALGORITHM=INPLACE,
  LOCK=NONE;
```

### 7.1 `LOCK=NONE`

Tujuan:

- DML concurrent tetap bisa berjalan
- aplikasi masih bisa read/write

Tetapi:

- bukan berarti tanpa metadata lock sama sekali
- ada fase awal/akhir yang tetap perlu koordinasi metadata
- operasi bisa menunggu transaksi lain

### 7.2 `LOCK=SHARED`

Umumnya read masih boleh, write mungkin diblokir.

Ini bisa acceptable untuk sistem read-mostly atau maintenance window pendek, tetapi berbahaya untuk OLTP write-heavy.

### 7.3 `LOCK=EXCLUSIVE`

Read dan write terhadap table dapat diblokir.

Ini biasanya hanya acceptable untuk:

- table kecil
- maintenance window
- offline migration
- non-critical table

### 7.4 Rule

Untuk production OLTP:

```text
Prefer:
  ALGORITHM=INSTANT, LOCK=NONE

Accept sometimes:
  ALGORITHM=INPLACE, LOCK=NONE

Be very cautious:
  LOCK=SHARED

Avoid for hot large tables:
  ALGORITHM=COPY or LOCK=EXCLUSIVE
```

---

## 8. Metadata Locks: The Hidden Migration Killer

Metadata lock atau MDL adalah mekanisme MySQL untuk melindungi konsistensi object metadata.

Contoh sederhana:

```sql
-- Session A
START TRANSACTION;
SELECT * FROM cases WHERE id = 1;
-- transaction remains open

-- Session B
ALTER TABLE cases ADD COLUMN risk_score INT NULL;
```

Session B dapat menunggu karena Session A masih memegang metadata lock pada table `cases`.

Yang membuat MDL berbahaya adalah efek antrean.

```text
T1: long transaction holds metadata lock on cases
T2: ALTER TABLE waits for exclusive metadata lock
T3: new application query arrives
T4: T3 can queue behind pending ALTER
T5: traffic piles up
T6: connection pool exhausted
T7: outage
```

Dari sudut aplikasi, terlihat seperti:

- endpoint tiba-tiba lambat
- connection pool penuh
- thread blocked
- query sederhana tidak selesai
- CPU database mungkin tidak tinggi
- banyak session status `Waiting for table metadata lock`

### 8.1 Why This Happens

DDL butuh metadata lock yang kompatibel dengan perubahan schema. Jika ada transaksi lama yang masih memakai table, DDL menunggu. Setelah DDL menunggu, operasi baru yang butuh metadata lock kompatibel juga bisa terjebak di belakang antrean.

Ini sebabnya `ALTER TABLE` yang “instant” tetap bisa menyebabkan incident jika dijalankan saat ada long transaction.

### 8.2 How Java Apps Cause MDL Problems

Pola berbahaya:

```java
@Transactional
public void generateLargeReport() {
    Stream<CaseEntity> cases = repository.streamOpenCases();
    cases.forEach(this::processSlowly);
}
```

Masalah:

- transaksi terbuka lama
- cursor/stream menjaga resource
- table metadata lock ikut hidup
- migration menunggu

Pola lain:

```java
@Transactional
public void approveCase(UUID caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    externalRegulatorApi.notifyApproval(c); // slow external call
    c.approve();
}
```

Masalah:

- transaction terlalu lebar
- external call menahan transaksi
- migration bisa blocked
- locks dan MVCC cleanup ikut terdampak

---

## 9. Migration Compatibility Matrix

Sebelum migration, jangan hanya tanya:

> “Apakah SQL-nya valid?”

Tanya:

> “Apakah semua kombinasi versi aplikasi dan schema valid selama deployment?”

Dalam rolling deployment, kombinasi yang mungkin:

```text
A0 + S0 = old app + old schema
A0 + S1 = old app + expanded schema
A1 + S1 = new app + expanded schema
A1 + S2 = new app + contracted schema
A0 + S2 = old app + contracted schema  <-- usually dangerous
```

Keterangan:

- `A0`: aplikasi lama
- `A1`: aplikasi baru
- `S0`: schema lama
- `S1`: schema expanded, backward compatible
- `S2`: schema final setelah kolom/index lama dihapus

Migration aman menghindari state di mana aplikasi lama tidak bisa berjalan.

---

## 10. Expand-Contract Pattern

Expand-contract adalah pola utama schema migration tanpa downtime.

Intinya:

```text
Do not replace schema in one step.
Add new structure first.
Move behavior gradually.
Verify.
Remove old structure last.
```

### 10.1 Example: Rename Column Safely

Kamu ingin mengganti `case_status` menjadi `lifecycle_state`.

Naive migration:

```sql
ALTER TABLE cases RENAME COLUMN case_status TO lifecycle_state;
```

Masalah:

- aplikasi lama masih membaca `case_status`
- deployment rolling bisa gagal
- rollback aplikasi rusak karena schema sudah berubah

Safe migration:

#### Step 1 — Expand Schema

```sql
ALTER TABLE cases
  ADD COLUMN lifecycle_state VARCHAR(32) NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

#### Step 2 — Deploy App That Dual-Writes

Saat update:

```java
caseRecord.setCaseStatus(newStatus);
caseRecord.setLifecycleState(newStatus);
```

Read masih dari old column:

```java
return caseRecord.getCaseStatus();
```

#### Step 3 — Backfill Existing Rows

```sql
UPDATE cases
SET lifecycle_state = case_status
WHERE lifecycle_state IS NULL
LIMIT 1000;
```

Jalankan batch berulang dengan throttle, bukan satu transaksi raksasa.

#### Step 4 — Verify

```sql
SELECT COUNT(*)
FROM cases
WHERE lifecycle_state IS NULL
   OR lifecycle_state <> case_status;
```

#### Step 5 — Switch Reads

Deploy app baru yang membaca `lifecycle_state`.

#### Step 6 — Stop Writing Old Column

Deploy app yang tidak lagi bergantung pada `case_status`.

#### Step 7 — Contract Schema

Setelah yakin tidak ada old app:

```sql
ALTER TABLE cases
  DROP COLUMN case_status;
```

Catatan: drop column bisa punya implikasi DDL yang harus diuji. Jangan asumsikan gratis.

---

## 11. Backfill Without Production Collapse

Backfill adalah data migration untuk mengisi struktur baru.

Backfill buruk:

```sql
UPDATE cases SET risk_score = 0 WHERE risk_score IS NULL;
```

Jika table besar, ini dapat:

- mengunci banyak row
- membuat undo log besar
- membuat redo log besar
- membuat binlog besar
- menyebabkan replication lag
- memanaskan buffer pool dengan halaman yang tidak relevan
- membuat transaksi lama
- meningkatkan deadlock

Backfill aman harus:

- chunked
- idempotent
- resumable
- observable
- throttled
- bounded transaction
- retry-safe

### 11.1 Chunk by Primary Key

Contoh:

```sql
UPDATE cases
SET risk_score = 0
WHERE id > ?
  AND id <= ?
  AND risk_score IS NULL;
```

Atau ambil batch ID dulu:

```sql
SELECT id
FROM cases
WHERE risk_score IS NULL
ORDER BY id
LIMIT 1000;
```

Lalu update berdasarkan ID:

```sql
UPDATE cases
SET risk_score = 0
WHERE id IN (...)
  AND risk_score IS NULL;
```

### 11.2 Use Idempotent Conditions

Selalu buat backfill aman di-run ulang:

```sql
UPDATE cases
SET lifecycle_state = case_status
WHERE lifecycle_state IS NULL;
```

Bukan:

```sql
UPDATE cases
SET lifecycle_state = case_status;
```

Karena jika aplikasi baru sudah menulis nilai berbeda yang valid, query kedua bisa overwrite data baru.

### 11.3 Keep Transactions Small

Buruk:

```java
@Transactional
public void backfillAll() {
    while (...) {
        updateBatch();
    }
}
```

Lebih aman:

```java
public void backfillAll() {
    while (true) {
        int updated = transactionTemplate.execute(status -> updateOneBatch());
        if (updated == 0) break;
        sleep(throttleMs);
    }
}
```

Setiap batch commit sendiri.

### 11.4 Throttle Based on Production Signals

Throttle bukan fixed sleep saja. Gunakan sinyal:

- replication lag
- DB CPU
- lock wait
- P95/P99 latency aplikasi
- buffer pool dirty page pressure
- connection usage
- deadlock rate

Pseudo-control loop:

```text
if replication_lag > threshold:
    pause backfill
else if app_p99_latency > threshold:
    reduce batch size
else if db_cpu_low and lag_low:
    cautiously increase batch size
```

### 11.5 Store Progress

Untuk backfill besar, simpan progress:

```sql
CREATE TABLE migration_progress (
  migration_name VARCHAR(128) PRIMARY KEY,
  last_processed_id BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

Ini membuat job bisa resume setelah restart.

---

## 12. Adding a Column Safely

### 12.1 Nullable Column Without Default

Biasanya paling aman:

```sql
ALTER TABLE cases
  ADD COLUMN risk_score INT NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

Lalu aplikasi menangani null.

### 12.2 Column With Default

Contoh:

```sql
ALTER TABLE cases
  ADD COLUMN source_system VARCHAR(32) NOT NULL DEFAULT 'INTERNAL';
```

Pada MySQL modern, beberapa operasi default dapat instant, tetapi tetap harus diuji.

Desain aman:

1. Add nullable column.
2. Deploy app that writes value.
3. Backfill old rows.
4. Verify no null.
5. Add `NOT NULL` constraint jika didukung aman.

```sql
ALTER TABLE cases
  ADD COLUMN source_system VARCHAR(32) NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

Backfill:

```sql
UPDATE cases
SET source_system = 'INTERNAL'
WHERE source_system IS NULL
LIMIT 1000;
```

Validate:

```sql
SELECT COUNT(*) FROM cases WHERE source_system IS NULL;
```

Then constrain:

```sql
ALTER TABLE cases
  MODIFY COLUMN source_system VARCHAR(32) NOT NULL;
```

Catatan: perubahan nullability dapat butuh validasi/rebuild tergantung kondisi. Test dulu di clone production-like.

---

## 13. Adding an Index Safely

Menambahkan index pada table besar adalah operasi mahal walaupun online.

```sql
ALTER TABLE cases
  ADD INDEX idx_cases_status_created_at(status, created_at),
  ALGORITHM=INPLACE,
  LOCK=NONE;
```

Risiko:

- full table scan untuk build index
- I/O pressure
- CPU pressure
- temporary storage
- replication lag
- query plan berubah setelah index tersedia
- write throughput turun karena index baru harus dipelihara

### 13.1 Before Adding Index

Tanya:

1. Query apa yang akan memakai index ini?
2. Apakah query pattern stabil?
3. Apakah order kolom benar?
4. Apakah index ini covering?
5. Apakah ada index existing yang redundant?
6. Apa biaya write amplification-nya?
7. Apakah index build aman di jam traffic tinggi?
8. Apakah replica akan lag?
9. Apakah storage cukup?
10. Bagaimana rollback jika plan memburuk?

### 13.2 Use Invisible Index for Testing

MySQL mendukung invisible index. Index tetap dipelihara, tetapi optimizer tidak menggunakannya secara default.

```sql
ALTER TABLE cases
  ADD INDEX idx_cases_status_created_at(status, created_at) INVISIBLE;
```

Kemudian test dengan session tertentu:

```sql
SET optimizer_switch='use_invisible_indexes=on';
EXPLAIN ANALYZE
SELECT *
FROM cases
WHERE status = 'OPEN'
ORDER BY created_at
LIMIT 50;
```

Jika cocok, jadikan visible:

```sql
ALTER TABLE cases
  ALTER INDEX idx_cases_status_created_at VISIBLE;
```

### 13.3 Dropping Index Safely

Sebelum drop index:

1. Jadikan invisible dulu.
2. Observasi query latency dan execution plan.
3. Jika aman, drop.

```sql
ALTER TABLE cases
  ALTER INDEX idx_old_status INVISIBLE;
```

Setelah observasi:

```sql
ALTER TABLE cases
  DROP INDEX idx_old_status;
```

---

## 14. Changing Column Type Safely

Mengubah tipe kolom sering jauh lebih berisiko daripada menambah kolom.

Naive:

```sql
ALTER TABLE cases
  MODIFY COLUMN external_reference VARCHAR(128) NOT NULL;
```

Risiko:

- table rebuild
- lock lebih lama
- data truncation
- invalid old data
- aplikasi lama tidak kompatibel
- replication lag

Pola aman:

1. Add new column with desired type.
2. Dual-write.
3. Backfill and transform.
4. Validate semantic equivalence.
5. Switch reads.
6. Stop old writes.
7. Drop old column.

Contoh:

```sql
ALTER TABLE cases
  ADD COLUMN external_reference_v2 VARCHAR(128) NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

Backfill:

```sql
UPDATE cases
SET external_reference_v2 = external_reference
WHERE external_reference_v2 IS NULL
  AND external_reference IS NOT NULL;
```

Verify:

```sql
SELECT COUNT(*)
FROM cases
WHERE external_reference IS NOT NULL
  AND external_reference_v2 <> external_reference;
```

---

## 15. Adding NOT NULL Constraints Safely

`NOT NULL` adalah constraint kuat, tetapi berbahaya jika data lama belum siap.

Buruk:

```sql
ALTER TABLE cases
  ADD COLUMN risk_category VARCHAR(20) NOT NULL;
```

Masalah:

- butuh default atau gagal
- existing rows harus valid
- aplikasi lama mungkin tidak mengisi kolom

Pola aman:

```text
1. add nullable column
2. deploy app writes non-null
3. backfill existing rows
4. enforce app-level validation
5. verify no null for a while
6. alter to NOT NULL
```

Validasi:

```sql
SELECT COUNT(*) FROM cases WHERE risk_category IS NULL;
```

Tambahkan constraint setelah aman:

```sql
ALTER TABLE cases
  MODIFY COLUMN risk_category VARCHAR(20) NOT NULL;
```

---

## 16. Adding Foreign Keys Safely

Foreign key dapat meningkatkan integritas data, tetapi di MySQL production ia juga membawa konsekuensi:

- validasi existing rows
- lock pada parent/child metadata
- overhead write
- deadlock possibility
- cascade risk
- migration lebih sulit
- cross-service boundary conflict

Sebelum menambah FK, pastikan:

1. Data existing bersih.
2. Parent index tersedia.
3. Child index tersedia.
4. Tidak ada orphan rows.
5. Workload write memahami lock tambahan.
6. FK tidak melintasi bounded context microservice.

Cek orphan:

```sql
SELECT c.id
FROM enforcement_action c
LEFT JOIN cases p ON p.id = c.case_id
WHERE p.id IS NULL
LIMIT 100;
```

Tambahkan setelah bersih:

```sql
ALTER TABLE enforcement_action
  ADD CONSTRAINT fk_action_case
  FOREIGN KEY (case_id) REFERENCES cases(id);
```

Untuk sistem regulatory, FK berguna untuk integritas kuat, tetapi jangan menaruh cascade delete sembarangan. Data enforcement biasanya punya retention/audit requirement. `ON DELETE CASCADE` sering bertentangan dengan auditability.

---

## 17. Migration and Replication

DDL dan backfill juga direplikasi.

Risiko:

- replica menjalankan DDL/backfill lebih lambat
- replication lag meningkat
- read replica menyajikan schema/data berbeda sementara
- read/write split bisa error jika aplikasi membaca kolom baru di replica yang belum apply DDL
- failover saat migration dapat membuat state sulit dipahami

### 17.1 Schema Version Across Replicas

Saat primary sudah menjalankan:

```sql
ALTER TABLE cases ADD COLUMN risk_score INT NULL;
```

Replica mungkin belum apply event itu jika lag.

Jika aplikasi baru membaca dari replica:

```sql
SELECT id, risk_score FROM cases WHERE id = ?;
```

Maka bisa gagal:

```text
Unknown column 'risk_score'
```

Karena itu migration yang menyentuh read path harus mempertimbangkan replica lag.

### 17.2 Safe Rule

Setelah schema expansion:

1. Tunggu DDL apply di semua replica.
2. Verifikasi schema version.
3. Baru deploy app yang membaca kolom baru dari replica.

Gunakan tabel schema version/migration history dan observability replication.

---

## 18. Migration and Rollback Reality

Banyak tim berkata “kalau gagal tinggal rollback”. Untuk schema migration, rollback sering tidak simetris.

Rollback aplikasi mudah:

```text
A1 -> A0
```

Rollback schema tidak selalu mudah:

```text
S1 -> S0 may lose data
S2 -> S1 may be impossible if column already dropped
```

### 18.1 Prefer Roll-Forward

Untuk migration production, strategi utama biasanya:

```text
make next safe change
not restore old state blindly
```

Misalnya jika aplikasi baru bug setelah column addition:

- rollback aplikasi ke versi lama
- biarkan kolom baru tetap ada
- jangan drop kolom hanya karena rollback aplikasi

Ini alasan expand-contract penting. Expanded schema harus kompatibel dengan aplikasi lama.

### 18.2 Irreversible Operations

Operasi yang harus dianggap irreversible atau high-risk:

- drop column
- drop table
- truncate table
- destructive type conversion
- data rewrite tanpa backup
- normalization yang menghapus raw source
- hash/encryption tanpa key strategy

Untuk operasi ini, lakukan setelah:

- data archived
- backup verified
- application dependency removed
- monitoring menunjukkan old column tidak dipakai
- ada approval eksplisit

---

## 19. Flyway and Liquibase in MySQL Production

Flyway/Liquibase membantu versioning migration, tetapi tidak otomatis membuat migration aman.

Mereka menjawab:

```text
Which migrations ran?
In what order?
Did checksum change?
```

Mereka tidak otomatis menjawab:

```text
Is this ALTER online?
Will metadata lock occur?
Will replica lag explode?
Is this compatible with rolling deploy?
Is backfill throttled?
Can this be resumed?
```

### 19.1 Migration Tooling Rules

1. Jangan masukkan backfill raksasa ke single migration transaction.
2. Pisahkan schema migration dan data backfill job.
3. Gunakan explicit `ALGORITHM` dan `LOCK` untuk DDL besar.
4. Review semua `ALTER TABLE` pada table besar.
5. Jangan auto-run destructive migration tanpa gate.
6. Simpan migration history.
7. Pastikan migration compatible dengan rollback aplikasi.
8. Jangan edit migration lama yang sudah production.
9. Gunakan repeatable migration dengan hati-hati.
10. Buat precondition/check sebelum destructive change.

### 19.2 Flyway Example

Schema expansion migration:

```sql
-- V2026_06_22_001__add_cases_risk_score.sql
ALTER TABLE cases
  ADD COLUMN risk_score INT NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

Do not put this in same file:

```sql
UPDATE cases SET risk_score = 0 WHERE risk_score IS NULL;
```

Backfill sebaiknya application job atau controlled SQL runner.

### 19.3 Liquibase Example

Liquibase changeset bisa express preconditions, tetapi tetap butuh review.

Conceptual example:

```xml
<changeSet id="2026-06-22-add-risk-score" author="team">
    <preConditions onFail="MARK_RAN">
        <not>
            <columnExists tableName="cases" columnName="risk_score"/>
        </not>
    </preConditions>
    <sql>
        ALTER TABLE cases
          ADD COLUMN risk_score INT NULL,
          ALGORITHM=INSTANT,
          LOCK=NONE
    </sql>
</changeSet>
```

---

## 20. Online Schema Change Tools

Untuk table sangat besar atau operasi yang tidak bisa online aman, pertimbangkan online schema change tooling seperti:

- `pt-online-schema-change` dari Percona Toolkit
- `gh-ost`
- managed cloud online DDL features
- vendor-specific migration tooling

Mental model tools ini:

```text
1. create ghost/shadow table with new schema
2. copy rows gradually
3. capture ongoing changes
4. verify
5. swap tables
```

Tetapi tools ini juga bukan magic.

Risiko:

- trigger/binlog overhead
- replication topology issue
- foreign key complexity
- disk usage
- cutover metadata lock
- operational complexity
- monitoring requirement

Gunakan ketika:

- native DDL tidak cukup aman
- table sangat besar
- operasi butuh rebuild
- downtime tidak acceptable
- tim punya maturity operasional untuk menjalankan tool

---

## 21. Safe Migration Patterns

### 21.1 Additive Change Pattern

Aman relatif tinggi:

```sql
ALTER TABLE cases
  ADD COLUMN priority VARCHAR(20) NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

Aplikasi lama tidak peduli kolom baru.

### 21.2 Dual-Write Pattern

Digunakan saat berpindah dari field lama ke baru.

```java
void updateState(CaseId id, State newState) {
    repository.updateBothStateColumns(id, newState.name(), newState.name());
}
```

Bahaya dual-write:

- satu write berhasil, satu gagal
- semantics tidak identik
- ordering issue
- partial migration

Mitigasi:

- satu row update atomik
- constraint/checker
- reconciliation job
- metrics mismatch

### 21.3 Read Fallback Pattern

Selama backfill:

```java
String state = row.lifecycleState() != null
    ? row.lifecycleState()
    : row.caseStatus();
```

Ini menjaga aplikasi tetap benar saat data belum lengkap.

### 21.4 Shadow Read Pattern

Aplikasi tetap memakai field lama, tetapi membaca field baru untuk validasi.

```java
String oldValue = row.caseStatus();
String newValue = row.lifecycleState();

if (newValue != null && !newValue.equals(oldValue)) {
    metrics.increment("case.state.mismatch");
}

return oldValue;
```

### 21.5 Feature Flag Pattern

Switch read behavior dengan flag:

```text
case.state.read.source = old | new | fallback | shadow
```

Useful untuk rollback behavior tanpa rollback schema.

---

## 22. Dangerous Migration Anti-Patterns

### 22.1 Big Bang Rename

```sql
ALTER TABLE cases RENAME COLUMN status TO lifecycle_state;
```

Berbahaya untuk rolling deploy.

### 22.2 Single Huge Backfill Transaction

```sql
UPDATE cases SET risk_score = 0 WHERE risk_score IS NULL;
```

Berbahaya untuk table besar.

### 22.3 Drop Before Observability

```sql
ALTER TABLE cases DROP COLUMN old_status;
```

Sebelum tahu apakah semua code path berhenti memakai old column.

### 22.4 Relying on Staging Alone

Staging biasanya tidak punya:

- ukuran data production
- distribusi data production
- long transactions
- replication lag
- traffic concurrency
- dirty data historis
- connection pool pressure

### 22.5 Implicit Algorithm

```sql
ALTER TABLE cases ADD INDEX idx_new(foo, bar);
```

Tanpa `ALGORITHM`/`LOCK`, kamu bisa tidak sadar operation memilih path yang mahal.

### 22.6 DDL During Unknown Long Transactions

Menjalankan migration tanpa mengecek transaksi aktif dan MDL risk.

---

## 23. Pre-Migration Checklist

Sebelum menjalankan migration pada table production penting, jawab ini.

### 23.1 Scope

- Table apa yang berubah?
- Ukuran table?
- Jumlah row?
- Growth rate?
- Table hot atau cold?
- Ada foreign key?
- Ada trigger?
- Ada partition?
- Ada replica?

### 23.2 Compatibility

- Apakah schema baru backward-compatible dengan aplikasi lama?
- Apakah aplikasi baru compatible dengan schema lama selama deployment?
- Apakah rollback aplikasi aman?
- Apakah old/new app bisa hidup bersamaan?

### 23.3 DDL Mechanics

- Apakah operation `INSTANT`, `INPLACE`, atau `COPY`?
- Apakah butuh `LOCK=NONE`?
- Apa yang terjadi jika requested algorithm tidak didukung?
- Sudah diuji di clone dengan ukuran data realistis?

### 23.4 Backfill

- Apakah perlu backfill?
- Berapa batch size?
- Bagaimana progress disimpan?
- Bagaimana resume?
- Bagaimana throttle?
- Apa stop condition?

### 23.5 Observability

- Metric apa yang dipantau?
- Alert threshold apa?
- Bagaimana melihat MDL wait?
- Bagaimana melihat replication lag?
- Bagaimana melihat deadlock/lock wait?
- Bagaimana melihat app error akibat unknown column?

### 23.6 Rollback / Roll-Forward

- Jika app error, rollback app atau roll-forward?
- Jika migration blocked, apakah kill query aman?
- Jika backfill partial, apakah data tetap valid?
- Jika replica lag, apakah read routing harus diubah?
- Jika migration gagal, apakah bisa retry?

### 23.7 Communication

- Siapa owner migration?
- Siapa operator on-call?
- Apa migration window?
- Apa abort criteria?
- Apa success criteria?
- Siapa yang approve destructive step?

---

## 24. Running the Migration: Operational Flow

### 24.1 Before Execution

```sql
-- Check long transactions
SELECT *
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

Check processlist:

```sql
SHOW FULL PROCESSLIST;
```

Check table size:

```sql
SELECT
  table_schema,
  table_name,
  table_rows,
  data_length,
  index_length
FROM information_schema.tables
WHERE table_schema = 'appdb'
  AND table_name = 'cases';
```

Check replica lag using your environment's replication status tooling.

### 24.2 Execute DDL With Explicit Safety

```sql
ALTER TABLE cases
  ADD COLUMN risk_score INT NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

If it fails, do not blindly remove `ALGORITHM=INSTANT`. Investigate.

### 24.3 After DDL

Verify column exists:

```sql
SHOW COLUMNS FROM cases LIKE 'risk_score';
```

Verify app errors:

- unknown column
- SQL syntax issue
- ORM metadata issue
- prepared statement issue
- serialization issue

Verify replicas have applied schema before routing reads that depend on new column.

---

## 25. Monitoring Metadata Locks

MySQL exposes metadata lock information through Performance Schema when instrumentation is enabled.

Useful table:

```sql
SELECT *
FROM performance_schema.metadata_locks
WHERE OBJECT_SCHEMA = 'appdb'
  AND OBJECT_NAME = 'cases';
```

You may join with threads/processlist depending on environment:

```sql
SELECT
  ml.OBJECT_SCHEMA,
  ml.OBJECT_NAME,
  ml.LOCK_TYPE,
  ml.LOCK_DURATION,
  ml.LOCK_STATUS,
  t.PROCESSLIST_ID,
  t.PROCESSLIST_USER,
  t.PROCESSLIST_HOST,
  t.PROCESSLIST_DB,
  t.PROCESSLIST_COMMAND,
  t.PROCESSLIST_TIME,
  t.PROCESSLIST_STATE,
  t.PROCESSLIST_INFO
FROM performance_schema.metadata_locks ml
JOIN performance_schema.threads t
  ON ml.OWNER_THREAD_ID = t.THREAD_ID
WHERE ml.OBJECT_SCHEMA = 'appdb'
  AND ml.OBJECT_NAME = 'cases';
```

Look for:

- `PENDING` lock status
- long-running sessions
- transaction open too long
- DDL waiting
- application sessions piling up

---

## 26. Case Study: Adding SLA Escalation Field

Requirement:

> Regulatory case management needs a new `next_escalation_at` timestamp used to select cases approaching SLA breach.

Current table:

```sql
CREATE TABLE cases (
  id BIGINT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  assigned_team_id BIGINT NULL
) ENGINE=InnoDB;
```

New requirement:

- add `next_escalation_at`
- backfill for open cases
- query dashboard:

```sql
SELECT *
FROM cases
WHERE tenant_id = ?
  AND status IN ('OPEN', 'UNDER_REVIEW')
  AND next_escalation_at <= ?
ORDER BY next_escalation_at
LIMIT 100;
```

### 26.1 Bad Plan

```sql
ALTER TABLE cases
  ADD COLUMN next_escalation_at DATETIME(6) NOT NULL;

UPDATE cases
SET next_escalation_at = created_at + INTERVAL 7 DAY
WHERE status IN ('OPEN', 'UNDER_REVIEW');

CREATE INDEX idx_escalation ON cases(next_escalation_at);
```

Problems:

- adding `NOT NULL` immediately unsafe
- huge update
- index not aligned with tenant/status query
- no rolling compatibility
- no throttle
- no verification

### 26.2 Better Plan

#### Migration 1 — Expand

```sql
ALTER TABLE cases
  ADD COLUMN next_escalation_at DATETIME(6) NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

#### Migration 2 — Add Index

```sql
ALTER TABLE cases
  ADD INDEX idx_cases_escalation_queue
    (tenant_id, status, next_escalation_at, id),
  ALGORITHM=INPLACE,
  LOCK=NONE;
```

Index reasoning:

- `tenant_id`: equality and multi-tenant isolation
- `status`: equality/in-list
- `next_escalation_at`: range and order
- `id`: stable tie-breaker

#### App Version 1 — Write New Value

When case created or status changes:

```java
caseRecord.setNextEscalationAt(calculateNextEscalationAt(caseRecord));
```

Read path still does not depend exclusively on new column.

#### Backfill Job

```sql
SELECT id
FROM cases
WHERE next_escalation_at IS NULL
  AND status IN ('OPEN', 'UNDER_REVIEW')
ORDER BY id
LIMIT 1000;
```

Then:

```sql
UPDATE cases
SET next_escalation_at = created_at + INTERVAL 7 DAY
WHERE id IN (...)
  AND next_escalation_at IS NULL;
```

#### App Version 2 — Use New Query

After replica schema and backfill acceptable:

```sql
SELECT id, status, next_escalation_at
FROM cases
WHERE tenant_id = ?
  AND status IN ('OPEN', 'UNDER_REVIEW')
  AND next_escalation_at <= ?
ORDER BY next_escalation_at, id
LIMIT 100;
```

#### Optional Later Constraint

If business requires it:

```sql
ALTER TABLE cases
  MODIFY COLUMN next_escalation_at DATETIME(6) NOT NULL;
```

Only after verifying all relevant rows have non-null values and application always writes it.

---

## 27. Case Study: Splitting a Column

Existing:

```sql
customer_address TEXT NULL
```

Target:

```sql
address_line1 VARCHAR(255)
address_line2 VARCHAR(255)
city VARCHAR(128)
postal_code VARCHAR(32)
country_code CHAR(2)
```

Naive migration tries to parse all existing addresses in SQL. Bad idea.

Safer:

1. Add new nullable columns.
2. App writes both raw and structured address for new updates.
3. Backfill with application parser and manual review queue.
4. For ambiguous addresses, keep raw source.
5. Read structured if complete, fallback to raw.
6. Only drop raw after legal/product approval, often never.

In regulatory systems, raw historical data may be legally important. Normalization should not destroy original submitted text unless retention policy allows it.

---

## 28. Java/JPA/Hibernate Migration Pitfalls

### 28.1 Entity Assumes Column Exists Too Early

If app version with new entity deploys before schema expansion:

```java
@Column(name = "risk_score")
private Integer riskScore;
```

Generated SQL may include `risk_score`, causing:

```text
Unknown column 'risk_score'
```

Safe ordering:

```text
1. deploy schema expansion
2. verify all DB nodes have schema
3. deploy app using new column
```

### 28.2 Non-Nullable Field Too Early

Java primitive:

```java
private int riskScore;
```

If DB column is nullable during transition, primitive `int` hides null as zero or breaks mapping behavior depending path.

Prefer wrapper during migration:

```java
private Integer riskScore;
```

Then enforce after backfill.

### 28.3 Hibernate DDL Auto

Do not let Hibernate auto-mutate production schema.

Avoid production:

```properties
spring.jpa.hibernate.ddl-auto=update
```

Use controlled migrations.

### 28.4 Cached Metadata

Some frameworks or long-lived connections can cache metadata or prepared statements. Usually this is manageable, but migration rollout should include:

- restart strategy if needed
- connection pool recycle if necessary
- prepared statement cache awareness

---

## 29. Decision Framework: Native DDL vs Online Schema Change vs Maintenance Window

Use this decision model.

### 29.1 Native DDL Is Usually Fine When

- table small
- operation is `INSTANT`
- operation is additive
- backward compatible
- no heavy backfill inside DDL
- tested on production-like data
- metadata lock risk low

### 29.2 Native Online DDL May Be Fine When

- operation is `INPLACE LOCK=NONE`
- table medium/large but I/O capacity sufficient
- index build acceptable
- replication lag acceptable
- migration can be paused/aborted safely
- monitoring ready

### 29.3 Online Schema Change Tool Needed When

- operation requires rebuild/copy
- table is huge/hot
- downtime unacceptable
- native DDL causes too much lock/lag
- team has operational maturity for tool

### 29.4 Maintenance Window Needed When

- operation inherently blocks writes
- schema contract cannot be made backward compatible
- data transformation complex and risky
- business accepts downtime
- operational simplicity beats complex online migration

---

## 30. Migration Review Template

Use this as a practical review artifact.

```markdown
# Migration Review

## Change Summary
- Migration name:
- Tables affected:
- Application versions involved:
- Business reason:

## Current State
- Table size:
- Row count:
- Write QPS:
- Read QPS:
- Replicas:
- Existing indexes:

## Target State
- Schema change:
- Data change:
- Behavior change:

## Compatibility
- Old app + old schema:
- Old app + new schema:
- New app + old schema:
- New app + new schema:

## DDL Plan
- SQL:
- Expected algorithm:
- Expected lock:
- Tested on production-like clone:
- Estimated duration:

## Backfill Plan
- Required? yes/no
- Batch size:
- Transaction size:
- Progress tracking:
- Throttle:
- Retry behavior:

## Observability
- Metrics:
- Logs:
- Queries:
- Alerts:

## Abort Criteria
- Replication lag >
- P99 latency >
- Lock wait >
- Error rate >

## Rollback / Roll-forward
- App rollback safe?
- Schema rollback needed?
- Data rollback needed?
- Roll-forward action:

## Approval
- Engineering owner:
- DBA/platform owner:
- Business/system owner:
```

---

## 31. Practical Commands Library

### 31.1 Show Running Queries

```sql
SHOW FULL PROCESSLIST;
```

### 31.2 Check Long Transactions

```sql
SELECT
  trx_id,
  trx_state,
  trx_started,
  trx_mysql_thread_id,
  trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

### 31.3 Check Table Size

```sql
SELECT
  table_schema,
  table_name,
  table_rows,
  ROUND(data_length / 1024 / 1024, 2) AS data_mb,
  ROUND(index_length / 1024 / 1024, 2) AS index_mb
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY data_length + index_length DESC;
```

### 31.4 Check Metadata Locks

```sql
SELECT
  OBJECT_SCHEMA,
  OBJECT_NAME,
  LOCK_TYPE,
  LOCK_DURATION,
  LOCK_STATUS,
  OWNER_THREAD_ID
FROM performance_schema.metadata_locks
WHERE OBJECT_SCHEMA = DATABASE();
```

### 31.5 Add Column Safely

```sql
ALTER TABLE cases
  ADD COLUMN risk_score INT NULL,
  ALGORITHM=INSTANT,
  LOCK=NONE;
```

### 31.6 Add Index Safely

```sql
ALTER TABLE cases
  ADD INDEX idx_cases_status_created_at(status, created_at, id),
  ALGORITHM=INPLACE,
  LOCK=NONE;
```

### 31.7 Add Invisible Index

```sql
ALTER TABLE cases
  ADD INDEX idx_candidate(status, created_at, id) INVISIBLE;
```

### 31.8 Make Index Visible

```sql
ALTER TABLE cases
  ALTER INDEX idx_candidate VISIBLE;
```

### 31.9 Chunked Backfill Pattern

```sql
UPDATE cases
SET risk_score = 0
WHERE id > :last_id
  AND id <= :next_id
  AND risk_score IS NULL;
```

---

## 32. Key Invariants

Keep these invariants in mind.

### Invariant 1 — Expanded Schema Must Be Backward Compatible

Aplikasi lama harus tetap bisa berjalan setelah additive schema migration.

### Invariant 2 — Contract Happens Last

Drop/rename/destructive changes dilakukan setelah semua code path lama mati dan diverifikasi.

### Invariant 3 — Backfill Must Be Idempotent

Backfill harus aman diulang.

### Invariant 4 — Large Migration Must Be Observable

Jika kamu tidak bisa melihat progress dan pressure, kamu tidak sedang mengoperasikan migration; kamu sedang berjudi.

### Invariant 5 — DDL Algorithm Must Be Known

Jangan jalankan DDL besar tanpa tahu apakah dia `INSTANT`, `INPLACE`, atau `COPY`.

### Invariant 6 — Rollback App Is Not Rollback Schema

Schema migration harus dirancang agar rollback aplikasi tidak membutuhkan rollback schema destruktif.

### Invariant 7 — Replicas Are Part of the Migration

Jika aplikasi membaca dari replica, schema migration belum selesai sampai replica aman.

---

## 33. Mental Model Summary

Schema migration aman adalah choreography:

```text
1. Expand database contract
2. Keep old behavior working
3. Deploy application that can handle both worlds
4. Backfill gradually
5. Verify equivalence
6. Switch reads/writes carefully
7. Observe
8. Remove old structure last
```

Naive mental model:

```text
migration = SQL script
```

Production mental model:

```text
migration = distributed compatibility protocol
```

Dalam sistem Java production, database schema adalah public contract. Begitu ada banyak instance aplikasi, job, replica, cache, dan integration consumer, schema tidak bisa diubah seolah-olah hanya ada satu process.

Top engineer tidak hanya tahu syntax `ALTER TABLE`; mereka tahu:

- kapan ALTER aman
- kapan ALTER menunggu metadata lock
- kapan index build menghantam I/O
- kapan backfill menyebabkan replication lag
- kapan aplikasi lama dan baru tidak kompatibel
- kapan rollback mustahil
- kapan harus stop sebelum incident

---

## 34. Exercises

### Exercise 1 — Classify Migration

Untuk setiap perubahan berikut, klasifikasikan sebagai schema/data/behavior migration dan rancang tahapannya:

1. Add `risk_score` to `cases`.
2. Rename `status` to `lifecycle_state`.
3. Change `external_id VARCHAR(32)` to `VARCHAR(128)`.
4. Add unique constraint on `(tenant_id, external_reference)`.
5. Split `full_name` into `first_name`, `middle_name`, `last_name`.
6. Drop `legacy_status`.

### Exercise 2 — Design Backfill

Table `case_event` memiliki 500 juta row. Kamu perlu mengisi `event_day DATE` dari `occurred_at DATETIME(6)`.

Rancang:

- DDL
- backfill query
- progress tracking
- throttle signal
- verification
- rollback/roll-forward

### Exercise 3 — Rolling Deployment Matrix

Aplikasi A0 membaca `case_status`.
Aplikasi A1 membaca `lifecycle_state`.

Buat migration plan yang membuat kombinasi berikut aman:

- A0 + S0
- A0 + S1
- A1 + S1
- rollback A1 -> A0

### Exercise 4 — Metadata Lock Incident

Migration:

```sql
ALTER TABLE cases ADD COLUMN priority VARCHAR(20) NULL;
```

Incident:

- query aplikasi mulai timeout
- processlist menunjukkan banyak `Waiting for table metadata lock`
- ada report query yang sudah berjalan 40 menit

Rancang runbook:

- apa dicek dulu?
- siapa yang boleh kill session?
- apakah kill DDL atau report query?
- bagaimana mencegah kejadian ulang?

---

## 35. Further Reading

Referensi utama yang relevan:

1. MySQL 8.4 Reference Manual — `ALTER TABLE` statement.
2. MySQL 8.4 Reference Manual — InnoDB Online DDL Operations.
3. MySQL 8.4 Reference Manual — Metadata Locking.
4. MySQL 8.4 Reference Manual — Performance Schema `metadata_locks` table.
5. MySQL 8.4 Reference Manual — Atomic DDL.
6. Flyway documentation — versioned migrations.
7. Liquibase documentation — changesets and preconditions.
8. Percona Toolkit — `pt-online-schema-change`.
9. GitHub `gh-ost` documentation.

---

## 36. Part 024 Completion

Kamu sekarang punya mental model bahwa schema migration MySQL adalah perubahan kontrak yang harus compatible, observable, throttled, dan recoverable.

Part berikutnya akan masuk lebih dalam ke salah satu failure mode paling sering saat migration:

**Part 025 — Metadata Locks and Operational Surprises**

Di sana kita akan membedah metadata lock sebagai sistem antrean, bagaimana SELECT biasa bisa menghalangi DDL, bagaimana DDL pending bisa menahan query baru, dan bagaimana membuat runbook untuk stuck migration.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Backup, Restore, PITR, and Disaster Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-025.md">Part 025 — Metadata Locks and Operational Surprises ➡️</a>
</div>

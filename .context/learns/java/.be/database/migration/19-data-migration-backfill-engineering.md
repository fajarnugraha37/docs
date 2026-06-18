# 19 — Data Migration and Backfill Engineering

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Part: 19 dari 34  
> Topik: Data migration, backfill, chunking, idempotency, throttling, observability, validation, dan cutover engineering  
> Target pembaca: Java engineer yang sudah memahami JDBC/JPA/Hibernate/MyBatis dan ingin naik ke level production-grade database change engineering

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Membedakan **schema migration**, **seed migration**, **data migration**, dan **backfill** secara operasional.
2. Menentukan kapan data migration boleh dijalankan lewat Flyway/Liquibase, dan kapan harus dipisahkan menjadi batch job/application job.
3. Mendesain backfill yang **safe, resumable, idempotent, observable, throttled, dan production-friendly**.
4. Menghindari kesalahan umum seperti long transaction, table-wide update, blocking lock, memory blow-up, duplicate processing, dan non-deterministic transformation.
5. Membuat migration plan untuk perubahan besar seperti column split, column derivation, denormalization, encryption, masking, tenant migration, atau status normalization.
6. Membuat validation strategy sebelum, selama, dan setelah backfill.
7. Menghubungkan migration/backfill dengan rollout aplikasi: expand, backfill, switch read, contract.

Bagian ini adalah jembatan penting menuju Part 20 tentang **expand/contract zero-downtime migration**.

---

## 2. Core Mental Model

Data migration adalah proses mengubah **isi** database dari kontrak lama ke kontrak baru.

Backfill adalah subtype data migration yang mengisi data baru berdasarkan data lama, biasanya setelah schema diperluas.

Contoh sederhana:

```sql
ALTER TABLE users ADD COLUMN normalized_email VARCHAR(255);
```

Schema migration di atas hanya menambah kolom. Namun sistem belum benar-benar berubah sampai kolom baru diisi:

```sql
UPDATE users
SET normalized_email = LOWER(TRIM(email))
WHERE normalized_email IS NULL;
```

Pada database kecil, ini terlihat trivial.

Pada database production besar, statement itu bisa menjadi bencana:

- menahan lock terlalu lama,
- menghasilkan massive redo/WAL/undo,
- menyebabkan replication lag,
- membuat autovacuum/statistics/segment growth bermasalah,
- memenuhi transaction log,
- memperlambat query user,
- timeout di deployment pipeline,
- gagal di tengah tanpa recovery marker,
- sulit dibedakan mana row yang sudah berhasil dan belum.

Mental model yang benar:

> Schema migration mengubah bentuk kontrak.  
> Data migration mengubah state.  
> Backfill menghubungkan state lama ke kontrak baru secara bertahap.  
> Production backfill adalah workload operasional, bukan sekadar SQL statement.

---

## 3. Kenapa Data Migration Lebih Berbahaya daripada DDL Kecil

DDL kecil sering cepat selesai, meskipun tetap bisa berbahaya karena lock.

Data migration sering menyentuh banyak row.

Perbedaan karakter:

| Aspek | DDL kecil | Data migration/backfill besar |
|---|---:|---:|
| Jumlah row tersentuh | sering 0 | bisa jutaan/miliaran |
| Durasi | detik/menit | menit/jam/hari |
| Transaction log | rendah/sedang | tinggi |
| Lock row | sedikit | banyak |
| Bisa diulang? | biasanya ya jika versioned | harus didesain |
| Observability | migration history cukup | perlu progress metric |
| Failure mode | object exists/checksum/lock | partial state, inconsistent transformation |
| Recovery | repair/retry | resume/compensate/roll-forward |

Flyway dan Liquibase sangat baik untuk mengatur **urutan perubahan database**. Namun tidak semua data movement cocok dimasukkan sebagai migration yang blocking startup/deployment.

Dokumentasi Flyway menyatakan bahwa Flyway melacak migration yang sudah diterapkan melalui schema history table, dan migration bisa berupa SQL maupun Java-based migration. Ini bagus untuk change tracking, tetapi bukan berarti semua long-running backfill harus diletakkan sebagai startup migration. Flyway sendiri juga menjelaskan bahwa integrasi Java biasanya menjalankan migration sebelum aplikasi berjalan agar database kompatibel dengan aplikasi. Untuk backfill besar, sifat “sebelum aplikasi start” ini bisa menjadi risiko jika workload butuh waktu lama atau harus berjalan bertahap. Referensi: Redgate Flyway documentation, “Migrations” dan “API Java”.

Liquibase juga sangat kuat untuk change tracking dan rollback/tagging berbasis changelog. Namun perubahan data besar tetap perlu dilihat sebagai workload yang punya transaksi, checkpoint, retry, dan observability sendiri. Referensi: Liquibase database change management documentation dan rollback documentation.

---

## 4. Taxonomy Data Migration

Tidak semua data migration sama. Strateginya bergantung pada jenisnya.

### 4.1 Derivation Backfill

Mengisi kolom baru dari kolom lama.

Contoh:

```sql
UPDATE customer
SET normalized_email = LOWER(TRIM(email))
WHERE normalized_email IS NULL;
```

Risiko:

- rule normalisasi berubah,
- email invalid,
- unique conflict setelah dinormalisasi,
- row lama memiliki format aneh,
- backfill tidak idempotent jika kolom target bisa diedit user.

### 4.2 Denormalization Backfill

Mengisi kolom/cache table dari join atau aggregate.

Contoh:

```sql
UPDATE invoice i
SET total_amount = (
  SELECT SUM(line.amount)
  FROM invoice_line line
  WHERE line.invoice_id = i.id
)
WHERE i.total_amount IS NULL;
```

Risiko:

- expensive join,
- inconsistent aggregate jika transaksi user masih berjalan,
- race dengan write baru,
- membutuhkan dual-write atau recalculation path.

### 4.3 Normalization Migration

Memindahkan data dari format embedded menjadi relational table.

Contoh:

Sebelum:

```text
users.role = 'ADMIN,REVIEWER'
```

Sesudah:

```text
user_roles(user_id, role_code)
```

Risiko:

- parsing data lama,
- duplicate role,
- invalid role,
- missing lookup,
- perubahan query aplikasi,
- compatibility selama transisi.

### 4.4 Table Split

Memecah satu tabel besar menjadi beberapa tabel.

Contoh:

```text
customer(id, name, email, billing_address, shipping_address)
```

menjadi:

```text
customer(id, name, email)
customer_address(customer_id, type, address)
```

Risiko:

- foreign key baru,
- data duplication,
- aplikasi lama masih membaca tabel lama,
- cutover read/write kompleks.

### 4.5 Table Merge

Menggabungkan dua tabel menjadi satu.

Risiko:

- duplicate key,
- conflict business meaning,
- precedence rule,
- audit trail hilang,
- referential integrity berubah.

### 4.6 Data Correction

Memperbaiki data salah.

Contoh:

```sql
UPDATE application
SET status = 'REJECTED'
WHERE status = 'REJCTED';
```

Risiko:

- correction logic tidak terdokumentasi,
- row scope terlalu luas,
- tidak ada evidence approval,
- business owner tidak memvalidasi.

### 4.7 Encryption / Hashing / Tokenization Migration

Mengubah data sensitif menjadi encrypted/tokenized/hashed representation.

Risiko:

- key management,
- irreversible transformation,
- performance,
- partial migration membuat data tidak bisa dibaca,
- aplikasi harus support old/new format selama transisi.

### 4.8 Tenant Migration

Menambahkan `tenant_id`, memindahkan tenant, atau mempartisi data per tenant.

Risiko:

- cross-tenant data leak,
- incomplete tenant tagging,
- foreign key tidak tenant-aware,
- tenant drift.

### 4.9 Historical Data Archival / Purge

Memindahkan atau menghapus data lama.

Risiko:

- legal retention,
- audit requirement,
- referential integrity,
- restore requirement,
- performance selama delete besar.

### 4.10 Semantic Data Migration

Mengubah arti data, bukan hanya bentuk.

Contoh:

```text
old status: APPROVED
new status: APPROVED_PENDING_PAYMENT / APPROVED_PAID / APPROVED_EXPIRED
```

Risiko:

- mapping tidak 1:1,
- butuh business decision,
- data lama tidak punya cukup informasi,
- kemungkinan butuh default/manual review.

---

## 5. Backfill Bukan Sekadar UPDATE

Backfill production-grade minimal memiliki 8 properti:

1. **Scoped** — jelas row mana yang eligible.
2. **Deterministic** — input sama menghasilkan output sama.
3. **Idempotent** — aman dijalankan ulang.
4. **Chunked** — tidak memproses semua row dalam satu transaksi besar.
5. **Resumable** — bisa lanjut dari titik terakhir.
6. **Throttled** — tidak menghabiskan resource production.
7. **Observable** — progress dan error terlihat.
8. **Validated** — ada query pembuktian correctness.

Statement seperti ini biasanya belum production-grade:

```sql
UPDATE huge_table
SET new_col = compute_from(old_col)
WHERE new_col IS NULL;
```

Versi lebih aman perlu mempertimbangkan:

- chunk size,
- ordering,
- commit boundary,
- lock wait,
- retry,
- skip/error policy,
- checkpoint,
- validation,
- parallelism,
- rate limiting.

---

## 6. Kapan Data Migration Boleh Masuk Flyway/Liquibase?

### 6.1 Cocok Masuk Flyway/Liquibase

Data migration cocok sebagai migration versioned jika:

- data kecil,
- deterministik,
- cepat,
- tidak membutuhkan retry kompleks,
- tidak perlu observability detail,
- tidak berisiko lock lama,
- harus selesai sebelum aplikasi baru start,
- scope row sangat terbatas,
- transformation tidak bergantung external service.

Contoh cocok:

```sql
UPDATE permission
SET display_name = 'Case Reviewer'
WHERE code = 'CASE_REVIEWER';
```

Atau:

```sql
INSERT INTO status_lookup(code, name, active)
VALUES ('PENDING_REVIEW', 'Pending Review', true);
```

### 6.2 Lebih Cocok Sebagai Batch Job / Application Job

Data migration sebaiknya dipisah dari Flyway/Liquibase jika:

- row sangat besar,
- durasi tidak predictable,
- butuh chunking,
- butuh checkpoint,
- butuh retry per row/chunk,
- butuh throttling,
- butuh progress dashboard,
- butuh parallelism,
- perlu berjalan sambil aplikasi tetap live,
- perlu pause/resume,
- perlu koordinasi cutover.

Contoh:

- backfill 80 juta rows,
- re-encrypt PII,
- migrate JSON blob ke relational table,
- split large table,
- populate search projection,
- compute derived aggregate untuk semua historical records.

### 6.3 Hybrid Pattern

Pola paling sering di sistem serius:

1. Flyway/Liquibase membuat schema baru.
2. Aplikasi deploy dengan compatibility mode.
3. Batch/backfill job mengisi data.
4. Validation memastikan data lengkap.
5. Feature flag/read path dipindah ke data baru.
6. Migration berikutnya membersihkan struktur lama.

Dengan kata lain:

```text
schema migration != data migration workload
```

Flyway/Liquibase tetap menjadi control plane untuk schema, seed kecil, dan checkpoint object. Backfill besar menjadi workload terpisah.

---

## 7. Design Principle: Make Partial State Valid

Kesalahan desain terbesar adalah mengasumsikan backfill akan selesai seketika.

Production reality:

```text
Ada periode ketika sebagian row sudah dimigrasi dan sebagian belum.
```

Aplikasi harus tahu cara hidup dalam partial state.

Contoh buruk:

```java
String normalized = user.getNormalizedEmail();
sendEmail(normalized);
```

Jika sebagian row belum backfilled, `normalizedEmail` null.

Versi compatibility-safe:

```java
String normalized = user.getNormalizedEmail();
if (normalized == null && user.getEmail() != null) {
    normalized = normalizeEmail(user.getEmail());
}
sendEmail(normalized);
```

Atau read path menggunakan fallback:

```sql
SELECT COALESCE(normalized_email, LOWER(TRIM(email))) AS effective_email
FROM users
WHERE id = ?;
```

Mental model:

> Backfill yang aman bukan hanya job yang benar.  
> Backfill yang aman membutuhkan aplikasi yang tahan terhadap intermediate state.

---

## 8. Idempotency in Backfill

Backfill harus aman dijalankan ulang.

### 8.1 Idempotent Target Predicate

Pattern umum:

```sql
UPDATE users
SET normalized_email = LOWER(TRIM(email))
WHERE normalized_email IS NULL
  AND email IS NOT NULL;
```

Ini aman selama `normalized_email IS NULL` berarti “belum diproses”.

Namun predicate ini tidak selalu cukup.

Jika rule berubah atau data lama berubah, row yang sudah diisi tidak akan dikoreksi.

### 8.2 Versioned Backfill Marker

Untuk transformasi besar, gunakan marker:

```sql
ALTER TABLE users ADD COLUMN email_migration_version INTEGER;
```

Lalu:

```sql
UPDATE users
SET normalized_email = LOWER(TRIM(email)),
    email_migration_version = 1
WHERE email IS NOT NULL
  AND (email_migration_version IS NULL OR email_migration_version < 1);
```

Jika rule berubah:

```sql
UPDATE users
SET normalized_email = canonicalize_email(email),
    email_migration_version = 2
WHERE email IS NOT NULL
  AND email_migration_version < 2;
```

### 8.3 Separate Progress Table

Jika tidak ingin menambah kolom ke tabel domain:

```sql
CREATE TABLE migration_progress (
    migration_name VARCHAR(200) PRIMARY KEY,
    last_processed_id BIGINT,
    processed_count BIGINT NOT NULL DEFAULT 0,
    failed_count BIGINT NOT NULL DEFAULT 0,
    started_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP NULL
);
```

Kelebihan:

- tidak mengotori domain table,
- mudah di-observe,
- cocok untuk job resumable.

Kekurangan:

- checkpoint by id tidak cukup jika row bisa berubah,
- sulit jika tidak ada monotonic primary key,
- perlu menangani gap dan late insert.

### 8.4 Idempotency pada Insert Target

Jika backfill insert ke tabel baru:

```sql
INSERT INTO user_role(user_id, role_code)
SELECT u.id, r.role_code
FROM users u
JOIN parsed_roles r ON r.user_id = u.id
ON CONFLICT (user_id, role_code) DO NOTHING;
```

PostgreSQL style.

Untuk Oracle:

```sql
MERGE INTO user_role target
USING (
    SELECT :user_id AS user_id, :role_code AS role_code FROM dual
) source
ON (target.user_id = source.user_id AND target.role_code = source.role_code)
WHEN NOT MATCHED THEN
    INSERT (user_id, role_code)
    VALUES (source.user_id, source.role_code);
```

Untuk MySQL:

```sql
INSERT INTO user_role(user_id, role_code)
VALUES (?, ?)
ON DUPLICATE KEY UPDATE role_code = VALUES(role_code);
```

Idempotency sering bergantung pada unique constraint. Tanpa unique constraint, “insert if absent” bisa race.

---

## 9. Chunking Strategy

Chunking berarti memproses data dalam batch kecil.

Tujuan:

- membatasi durasi transaksi,
- mengurangi lock pressure,
- mengurangi undo/redo/WAL spike,
- memberi progress point,
- memudahkan retry,
- menghindari memory blow-up.

Spring Batch mendokumentasikan model chunk-oriented processing sebagai proses read/write yang melakukan commit secara periodik berdasarkan commit interval; commit per item terlalu mahal untuk banyak kasus, sehingga chunk commit digunakan untuk efisiensi transaksi.

### 9.1 Chunk by Primary Key Range

Pattern:

```sql
SELECT id
FROM users
WHERE id > :lastId
  AND normalized_email IS NULL
ORDER BY id
FETCH FIRST :chunkSize ROWS ONLY;
```

Lalu update row tersebut.

Pseudo-flow:

```text
lastId = read_checkpoint()
loop:
  ids = select next ids where id > lastId order by id limit chunkSize
  if empty: complete
  update ids
  lastId = max(ids)
  save_checkpoint(lastId)
  sleep/throttle
```

Kelebihan:

- sederhana,
- predictable,
- cocok untuk numeric monotonik id.

Kekurangan:

- late insert dengan id lebih kecil dari checkpoint bisa terlewat,
- tidak cocok jika primary key UUID random,
- row yang gagal di tengah perlu error table.

### 9.2 Chunk by Created Date + ID

Jika id tidak cukup:

```sql
SELECT id, created_at
FROM orders
WHERE (created_at, id) > (:lastCreatedAt, :lastId)
ORDER BY created_at, id
FETCH FIRST :chunkSize ROWS ONLY;
```

Checkpoint:

```text
(last_created_at, last_id)
```

Ini cocok jika data diurutkan waktu.

### 9.3 Chunk by Hash Partition

Untuk UUID/random id:

```text
bucket = hash(id) % 100
process bucket 0..99
```

Contoh konseptual:

```sql
SELECT id
FROM customer
WHERE MOD(ABS(HASH(id)), 100) = :bucket
  AND migration_version IS NULL;
```

Kelebihan:

- bisa paralel per bucket,
- tidak perlu id monotonik.

Kekurangan:

- vendor-specific hash,
- sulit estimate per bucket,
- perlu desain retry per bucket.

### 9.4 Chunk by Business Scope

Misalnya per tenant:

```text
for tenant in tenants:
  migrate tenant data
```

Kelebihan:

- blast radius kecil,
- mudah komunikasi per tenant,
- cocok multi-tenant rollout.

Kekurangan:

- tenant besar bisa menjadi hotspot,
- cross-tenant data relation menyulitkan.

### 9.5 Chunk Size Selection

Tidak ada angka universal.

Mulai dari kecil:

```text
100 / 500 / 1,000 / 5,000 rows per chunk
```

Naikkan berdasarkan pengukuran:

- durasi per chunk,
- lock wait,
- CPU,
- DB I/O,
- replication lag,
- undo/WAL growth,
- app latency,
- deadlock frequency.

Rule praktis:

> Chunk size bukan angka konfigurasi asal.  
> Chunk size adalah hasil observasi production-like workload.

---

## 10. Transaction Boundary

Kesalahan klasik:

```java
@Transactional
public void migrateAll() {
    while (...) {
        processChunk();
    }
}
```

Ini membuat seluruh migration berada dalam satu transaksi besar.

Yang benar biasanya:

```text
one chunk = one transaction
```

Pseudo Java:

```java
while (true) {
    List<Long> ids = loadNextIds(lastId, chunkSize);
    if (ids.isEmpty()) break;

    transactionTemplate.executeWithoutResult(tx -> {
        migrateIds(ids);
        saveCheckpoint(max(ids));
    });

    sleep(throttleMillis);
}
```

Keuntungan:

- gagal satu chunk tidak membatalkan seluruh proses,
- lock dilepas lebih cepat,
- checkpoint konsisten dengan commit,
- retry lebih mudah.

Namun ada konsekuensi:

- partial state terjadi,
- aplikasi harus compatibility-safe,
- validasi harus memperhitungkan data belum selesai.

---

## 11. Read-Modify-Write vs Set-Based SQL

Ada dua pendekatan utama.

### 11.1 Set-Based SQL

Contoh:

```sql
UPDATE users
SET normalized_email = LOWER(TRIM(email))
WHERE id BETWEEN :fromId AND :toId
  AND normalized_email IS NULL;
```

Kelebihan:

- cepat,
- memanfaatkan engine database,
- sedikit data keluar dari DB,
- cocok untuk transformasi SQL-native.

Kekurangan:

- logic kompleks sulit ditulis,
- error per row sulit ditangani,
- vendor-specific,
- observability per item terbatas.

### 11.2 Read-Modify-Write di Java

Contoh:

```java
for (UserRow row : rows) {
    String normalized = EmailCanonicalizer.normalize(row.email());
    jdbc.update("""
        UPDATE users
        SET normalized_email = ?, email_migration_version = 1
        WHERE id = ?
          AND (email_migration_version IS NULL OR email_migration_version < 1)
        """, normalized, row.id());
}
```

Kelebihan:

- bisa memakai business logic Java,
- bisa validate per row,
- bisa log error per row,
- cocok untuk parsing/encryption/complex transform.

Kekurangan:

- lebih lambat,
- risk memory/network roundtrip,
- harus hati-hati transaction dan batching,
- berpotensi dependency ke code versi sekarang.

### 11.3 Decision Rule

Gunakan SQL jika:

- transformasi sederhana,
- bisa diekspresikan jelas,
- data besar,
- DB engine lebih efisien.

Gunakan Java jika:

- transformasi kompleks,
- butuh library/domain logic,
- butuh per-row error handling,
- butuh encryption/key access,
- butuh custom validation.

Tetapi hati-hati:

> Java migration/backfill tidak boleh bergantung pada mutable business service yang bisa berubah di release berikutnya tanpa menjaga compatibility migration.

---

## 12. Resume and Checkpoint Design

Backfill besar harus bisa dilanjutkan.

### 12.1 Simple Checkpoint Table

```sql
CREATE TABLE data_migration_job (
    job_name VARCHAR(200) PRIMARY KEY,
    status VARCHAR(30) NOT NULL,
    last_processed_id BIGINT,
    total_processed BIGINT NOT NULL DEFAULT 0,
    total_failed BIGINT NOT NULL DEFAULT 0,
    started_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP NULL,
    error_message VARCHAR(4000)
);
```

Status:

```text
PENDING
RUNNING
PAUSED
FAILED
COMPLETED
```

### 12.2 Per-Chunk Checkpoint

```sql
CREATE TABLE data_migration_chunk (
    job_name VARCHAR(200) NOT NULL,
    chunk_no BIGINT NOT NULL,
    from_id BIGINT,
    to_id BIGINT,
    status VARCHAR(30) NOT NULL,
    row_count BIGINT NOT NULL DEFAULT 0,
    failed_count BIGINT NOT NULL DEFAULT 0,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message VARCHAR(4000),
    PRIMARY KEY (job_name, chunk_no)
);
```

Kelebihan:

- audit detail,
- retry chunk tertentu,
- progress lebih akurat,
- bisa parallel execution.

### 12.3 Per-Row Error Table

```sql
CREATE TABLE data_migration_error (
    job_name VARCHAR(200) NOT NULL,
    source_table VARCHAR(100) NOT NULL,
    source_id VARCHAR(200) NOT NULL,
    error_code VARCHAR(100) NOT NULL,
    error_message VARCHAR(4000),
    payload_snapshot CLOB,
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (job_name, source_table, source_id)
);
```

Ini penting jika beberapa row invalid dan tidak boleh menghentikan seluruh migration.

### 12.4 Checkpoint Must Commit with Work

Jangan update checkpoint sebelum data commit.

Buruk:

```text
save checkpoint
update data
commit
```

Jika update gagal setelah checkpoint tersimpan, row bisa terlewat.

Lebih aman:

```text
begin transaction
update data
save checkpoint
commit
```

---

## 13. Throttling and Backpressure

Backfill harus sopan terhadap production workload.

Throttling bisa dilakukan dengan:

- sleep antar chunk,
- limit chunk size,
- limit concurrent workers,
- pause saat CPU tinggi,
- pause saat replication lag tinggi,
- pause saat lock wait meningkat,
- run hanya di maintenance window,
- dynamic rate adjustment.

Pseudo:

```java
if (dbMetrics.replicationLagSeconds() > 30) {
    sleep(Duration.ofSeconds(10));
    continue;
}

if (dbMetrics.lockWaitsHigh()) {
    reduceChunkSize();
}
```

Simple throttling:

```java
processChunk();
Thread.sleep(200);
```

Advanced throttling:

```text
if p95 app latency > threshold: pause
if DB CPU > 75%: reduce workers
if replication lag > 60s: pause
if deadlock count increases: halve chunk size
```

Mental model:

> Backfill bukan workload prioritas utama.  
> User traffic tetap lebih penting.

---

## 14. Parallel Backfill

Parallelism mempercepat migration, tetapi menambah risiko.

### 14.1 Safe Parallelism by Partition

Contoh per tenant:

```text
worker-1: tenant A
worker-2: tenant B
worker-3: tenant C
```

Atau per hash bucket:

```text
worker-1: bucket 0-9
worker-2: bucket 10-19
...
```

### 14.2 Dangerous Parallelism

Berbahaya jika beberapa worker bisa menyentuh row yang sama.

Gejala:

- deadlock,
- lock wait,
- duplicate insert,
- inconsistent aggregate,
- unique constraint violation.

### 14.3 Claim-and-Process Pattern

Untuk parallel worker, gunakan claim table/status.

```sql
UPDATE migration_task
SET status = 'RUNNING', claimed_by = :workerId, claimed_at = CURRENT_TIMESTAMP
WHERE task_id IN (
    SELECT task_id
    FROM migration_task
    WHERE status = 'PENDING'
    ORDER BY task_id
    FETCH FIRST :limit ROWS ONLY
)
```

Beberapa database punya fitur `SKIP LOCKED`.

Contoh PostgreSQL/Oracle style konseptual:

```sql
SELECT id
FROM migration_task
WHERE status = 'PENDING'
FOR UPDATE SKIP LOCKED;
```

Gunanya:

- worker tidak saling menunggu row yang sama,
- task bisa dibagi secara aman,
- stuck task bisa direclaim.

Tetapi tetap vendor-specific dan harus diuji.

---

## 15. Lock Minimization

Data migration sering menyebabkan lock bukan karena DDL, tetapi karena update banyak row.

Strategi minimisasi:

1. Update by indexed predicate.
2. Hindari full table scan berulang.
3. Proses dalam primary key order.
4. Chunk kecil.
5. Commit per chunk.
6. Set lock timeout.
7. Hindari update row yang tidak berubah.
8. Hindari foreign key cascade besar.
9. Hindari trigger mahal selama backfill jika memungkinkan dan aman.
10. Monitor lock wait.

### 15.1 Avoid Updating Same Value

Buruk:

```sql
UPDATE users
SET normalized_email = LOWER(TRIM(email));
```

Lebih baik:

```sql
UPDATE users
SET normalized_email = LOWER(TRIM(email))
WHERE normalized_email IS NULL
   OR normalized_email <> LOWER(TRIM(email));
```

Namun hati-hati dengan null comparison per DB.

PostgreSQL:

```sql
WHERE normalized_email IS DISTINCT FROM LOWER(TRIM(email));
```

### 15.2 Indexed Selection

Jika predicate:

```sql
WHERE migration_version IS NULL
```

pada tabel besar, pertimbangkan index sementara/partial index jika DB mendukung.

Contoh PostgreSQL:

```sql
CREATE INDEX CONCURRENTLY idx_users_email_mig_pending
ON users(id)
WHERE email_migration_version IS NULL;
```

Tapi index creation sendiri adalah migration yang harus dipertimbangkan lock dan durasinya. Ini akan dibahas lebih detail pada Part 21.

---

## 16. Validation Strategy

Backfill tanpa validation hanya “berharap benar”.

Validation harus menjawab:

1. Semua row eligible sudah diproses?
2. Row yang diproses benar hasilnya?
3. Tidak ada duplicate/corruption?
4. Aplikasi sudah membaca data baru dengan benar?
5. Data lama dan data baru konsisten selama dual-write?

### 16.1 Count Validation

```sql
SELECT COUNT(*)
FROM users
WHERE email IS NOT NULL
  AND normalized_email IS NULL;
```

Expected: `0`.

### 16.2 Sample Validation

```sql
SELECT id, email, normalized_email
FROM users
WHERE normalized_email <> LOWER(TRIM(email))
FETCH FIRST 100 ROWS ONLY;
```

### 16.3 Hash Validation

Untuk data besar:

```sql
SELECT COUNT(*) AS row_count,
       SUM(LENGTH(normalized_email)) AS checksum_like
FROM users
WHERE email IS NOT NULL;
```

Ini bukan cryptographic checksum, tetapi bisa menjadi sanity check.

Untuk validasi lebih serius, gunakan checksum deterministik per bucket.

### 16.4 Exception Validation

```sql
SELECT error_code, COUNT(*)
FROM data_migration_error
WHERE job_name = 'normalize-email-v1'
GROUP BY error_code;
```

### 16.5 Referential Validation

Jika migrasi ke tabel baru:

```sql
SELECT COUNT(*)
FROM users u
WHERE NOT EXISTS (
    SELECT 1
    FROM user_profile p
    WHERE p.user_id = u.id
);
```

### 16.6 Business Validation

Contoh status migration:

```sql
SELECT old_status, new_status, COUNT(*)
FROM application_status_mapping_audit
GROUP BY old_status, new_status
ORDER BY old_status, new_status;
```

Business owner bisa review mapping distribution.

---

## 17. Cutover Pattern

Backfill jarang berdiri sendiri. Biasanya ada cutover.

Generic flow:

```text
1. Add new schema object
2. Deploy app that writes old + new or can read both
3. Backfill historical data
4. Validate completeness
5. Switch read path to new data
6. Monitor
7. Stop writing old data
8. Drop old object in later release
```

Contoh column migration:

```text
old: users.email
new: users.normalized_email
```

Flow:

1. Add `normalized_email` nullable.
2. New app writes both `email` and `normalized_email`.
3. Backfill existing rows.
4. Validate no null for eligible users.
5. App reads `normalized_email` primary, fallback `email` temporarily.
6. Later enforce not null/unique constraint.
7. Later remove fallback.

Cutover harus reversible sejauh mungkin.

---

## 18. Data Migration with Flyway Java Migration

Untuk migration kecil-menengah yang harus jalan dalam Flyway, Java migration bisa dipakai.

Skeleton:

```java
package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;

public class V20260617_1900__backfill_normalized_email extends BaseJavaMigration {

    private static final int CHUNK_SIZE = 500;

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        long lastId = 0L;

        while (true) {
            List<Long> ids = loadIds(connection, lastId);
            if (ids.isEmpty()) {
                break;
            }

            updateRows(connection, ids);
            lastId = ids.get(ids.size() - 1);
        }
    }

    private List<Long> loadIds(Connection connection, long lastId) throws Exception {
        String sql = """
            SELECT id
            FROM users
            WHERE id > ?
              AND email IS NOT NULL
              AND normalized_email IS NULL
            ORDER BY id
            FETCH FIRST ? ROWS ONLY
            """;

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setLong(1, lastId);
            ps.setInt(2, CHUNK_SIZE);
            try (ResultSet rs = ps.executeQuery()) {
                List<Long> ids = new ArrayList<>();
                while (rs.next()) {
                    ids.add(rs.getLong(1));
                }
                return ids;
            }
        }
    }

    private void updateRows(Connection connection, List<Long> ids) throws Exception {
        String sql = """
            UPDATE users
            SET normalized_email = LOWER(TRIM(email))
            WHERE id = ?
              AND normalized_email IS NULL
            """;

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            for (Long id : ids) {
                ps.setLong(1, id);
                ps.addBatch();
            }
            ps.executeBatch();
        }
    }
}
```

Namun hati-hati:

- Flyway migration biasanya berada dalam transaksi tergantung DB/support.
- Jika seluruh Java migration satu transaksi, chunking tidak memberi commit boundary.
- Untuk long-running backfill, lebih baik external job.
- Jangan mengandalkan dependency service layer aplikasi secara sembarangan.

Flyway Java migration cocok jika workload masih terkontrol.

---

## 19. Data Migration with Liquibase

Liquibase bisa melakukan data change lewat SQL changeset atau custom change.

### 19.1 SQL Changeset

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260617-1900-backfill-normalized-email
      author: fajar
      changes:
        - sql:
            sql: |
              UPDATE users
              SET normalized_email = LOWER(TRIM(email))
              WHERE normalized_email IS NULL
                AND email IS NOT NULL;
      rollback:
        - sql:
            sql: |
              UPDATE users
              SET normalized_email = NULL
              WHERE email IS NOT NULL;
```

Rollback di atas mungkin tidak aman jika `normalized_email` sudah dipakai aplikasi. Jadi rollback data harus dipikirkan secara business, bukan mekanik.

### 19.2 Preconditions

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260617-1901-safe-small-backfill
      author: fajar
      preConditions:
        - onFail: HALT
        - columnExists:
            tableName: users
            columnName: normalized_email
      changes:
        - sql:
            sql: |
              UPDATE users
              SET normalized_email = LOWER(TRIM(email))
              WHERE normalized_email IS NULL
                AND email IS NOT NULL;
```

Preconditions bagus untuk guardrail, tetapi tidak menggantikan chunking untuk data besar.

### 19.3 Custom Change

Liquibase custom change bisa dipakai untuk logic Java. Namun prinsipnya sama:

- deterministic,
- tested,
- bounded,
- not dependent on external unstable system,
- observable enough,
- safe to rerun.

Untuk large backfill, custom change juga bisa menjadi terlalu berat jika dipaksakan sebagai blocking migration.

---

## 20. Spring Batch as Backfill Engine

Untuk Java ecosystem, Spring Batch sering cocok untuk backfill besar.

Model dasar:

```text
ItemReader -> ItemProcessor -> ItemWriter
```

dengan chunk boundary:

```text
read N items -> process -> write -> commit
```

Spring Batch cocok ketika:

- data besar,
- butuh restartability,
- butuh skip/retry,
- butuh metrics,
- butuh partitioning,
- butuh job repository,
- butuh operational job control.

Namun jangan otomatis memakai Spring Batch untuk semua. Untuk backfill kecil, SQL chunk script atau simple Java job cukup.

Decision rule:

| Kondisi | Pendekatan |
|---|---|
| < ribuan row, simple update | Flyway/Liquibase SQL |
| ratusan ribu row, simple SQL | external SQL chunk job |
| jutaan row, complex transform | Java batch job/Spring Batch |
| perlu restart/skip/retry/partition | Spring Batch atau custom job framework |
| perlu online cutover | app-compatible backfill pipeline |

---

## 21. Memory Safety in Java Backfill

Buruk:

```java
List<User> users = userRepository.findAll();
for (User user : users) {
    migrate(user);
}
```

Masalah:

- semua row masuk memory,
- persistence context membesar,
- dirty checking mahal,
- OOM risk,
- transaction terlalu panjang.

Lebih aman:

```java
long lastId = 0;
while (true) {
    List<UserRow> rows = userDao.findNextChunk(lastId, 500);
    if (rows.isEmpty()) break;

    migrateChunk(rows);
    lastId = rows.get(rows.size() - 1).id();
}
```

Untuk JPA/Hibernate, jika terpaksa:

```java
entityManager.flush();
entityManager.clear();
```

Tetapi untuk backfill besar, JDBC sering lebih predictable daripada ORM.

Mental model:

> ORM bagus untuk domain interaction.  
> Backfill besar sering lebih cocok memakai JDBC/set-based SQL karena membutuhkan kontrol eksplisit.

---

## 22. Error Handling Model

Tidak semua error sama.

### 22.1 Fatal Error

Harus menghentikan job:

- target table missing,
- schema incompatible,
- permission denied,
- DB unavailable,
- transformation code bug,
- checksum/config mismatch.

### 22.2 Retriable Error

Bisa dicoba ulang:

- deadlock,
- lock timeout,
- transient network failure,
- connection timeout,
- temporary resource pressure.

### 22.3 Row-Level Business Error

Bisa dicatat dan dilewati jika disetujui:

- invalid email,
- malformed JSON,
- unknown legacy status,
- missing optional relation.

### 22.4 Error Policy

Sebelum menjalankan backfill, tentukan:

```text
Should one bad row stop the entire job?
Should invalid row be skipped?
Who approves skipped rows?
Where are skipped rows recorded?
Can skipped rows be repaired later?
```

---

## 23. Avoid External Side Effects

Data migration sebaiknya tidak melakukan side effect eksternal.

Hindari:

- mengirim email,
- memanggil payment gateway,
- memanggil government API,
- publish event bisnis tanpa idempotency kuat,
- men-trigger webhook,
- generate document external.

Kenapa?

Karena retry migration bisa mengulang side effect.

Jika perlu event setelah migration, gunakan outbox pattern dengan idempotency key.

Contoh:

```sql
INSERT INTO outbox_event(event_id, aggregate_id, event_type, payload, created_at)
SELECT gen_event_id(id), id, 'USER_EMAIL_NORMALIZED', build_payload(...), CURRENT_TIMESTAMP
FROM users
WHERE email_migration_version = 1
ON CONFLICT (event_id) DO NOTHING;
```

---

## 24. Auditability

Data migration harus meninggalkan bukti.

Minimal:

- migration name,
- version/release,
- who approved,
- when started/completed,
- row count expected,
- row count processed,
- row count failed/skipped,
- validation query result,
- rollback/roll-forward plan,
- production log link,
- ticket/change request reference.

Untuk regulated systems, data correction harus lebih ketat:

```text
Correction reason
Business owner approval
Before/after evidence
Scope query
Execution timestamp
Executor identity
Validation result
Incident/change ticket
```

Migration bukan hanya technical operation. Ia adalah change evidence.

---

## 25. Example: Migrating Status String to Lookup Table

### 25.1 Current State

```text
application.status VARCHAR(50)
```

Values:

```text
DRAFT
SUBMITTED
APPROVED
REJECTED
PENDING_DOC
PEND_DOC
```

Ada typo legacy `PEND_DOC`.

### 25.2 Target State

```text
application.status_code -> status_lookup.code
```

### 25.3 Step 1 — Add Lookup and New Column

```sql
CREATE TABLE status_lookup (
    code VARCHAR(50) PRIMARY KEY,
    display_name VARCHAR(200) NOT NULL,
    active BOOLEAN NOT NULL
);

INSERT INTO status_lookup(code, display_name, active) VALUES
('DRAFT', 'Draft', true),
('SUBMITTED', 'Submitted', true),
('APPROVED', 'Approved', true),
('REJECTED', 'Rejected', true),
('PENDING_DOCUMENT', 'Pending Document', true);

ALTER TABLE application ADD COLUMN status_code VARCHAR(50);
```

### 25.4 Step 2 — Deploy Compatibility App

Write path:

```text
when status changes:
  write old status
  write new status_code
```

Read path:

```text
prefer status_code
fallback map(status)
```

### 25.5 Step 3 — Backfill

```sql
UPDATE application
SET status_code = CASE status
    WHEN 'DRAFT' THEN 'DRAFT'
    WHEN 'SUBMITTED' THEN 'SUBMITTED'
    WHEN 'APPROVED' THEN 'APPROVED'
    WHEN 'REJECTED' THEN 'REJECTED'
    WHEN 'PENDING_DOC' THEN 'PENDING_DOCUMENT'
    WHEN 'PEND_DOC' THEN 'PENDING_DOCUMENT'
END
WHERE status_code IS NULL;
```

For large table, do this in chunks.

### 25.6 Step 4 — Validate

```sql
SELECT status, COUNT(*)
FROM application
WHERE status_code IS NULL
GROUP BY status;
```

Expected: no rows.

Check invalid mapping:

```sql
SELECT status, status_code, COUNT(*)
FROM application
GROUP BY status, status_code
ORDER BY status, status_code;
```

### 25.7 Step 5 — Enforce Constraint Later

```sql
ALTER TABLE application
ADD CONSTRAINT fk_application_status
FOREIGN KEY (status_code)
REFERENCES status_lookup(code);
```

Possibly with vendor-specific non-blocking validation strategy.

### 25.8 Step 6 — Contract Later

In later release:

```sql
ALTER TABLE application DROP COLUMN status;
```

Only after app no longer needs fallback.

---

## 26. Example: Large Backfill Job with JDBC

```java
public final class EmailBackfillJob {

    private final DataSource dataSource;
    private final int chunkSize;
    private final Duration delay;

    public EmailBackfillJob(DataSource dataSource, int chunkSize, Duration delay) {
        this.dataSource = dataSource;
        this.chunkSize = chunkSize;
        this.delay = delay;
    }

    public void run() throws Exception {
        long lastId = loadCheckpoint();

        while (true) {
            List<UserEmailRow> rows = loadChunk(lastId);
            if (rows.isEmpty()) {
                markCompleted();
                return;
            }

            long maxId = rows.get(rows.size() - 1).id();

            try {
                migrateChunk(rows, maxId);
            } catch (TransientDatabaseException ex) {
                sleep(Duration.ofSeconds(5));
                continue;
            }

            lastId = maxId;
            sleep(delay);
        }
    }

    private List<UserEmailRow> loadChunk(long lastId) throws SQLException {
        String sql = """
            SELECT id, email
            FROM users
            WHERE id > ?
              AND email IS NOT NULL
              AND email_migration_version IS NULL
            ORDER BY id
            FETCH FIRST ? ROWS ONLY
            """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, lastId);
            ps.setInt(2, chunkSize);

            try (ResultSet rs = ps.executeQuery()) {
                List<UserEmailRow> rows = new ArrayList<>();
                while (rs.next()) {
                    rows.add(new UserEmailRow(rs.getLong("id"), rs.getString("email")));
                }
                return rows;
            }
        }
    }

    private void migrateChunk(List<UserEmailRow> rows, long maxId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            try {
                updateRows(c, rows);
                saveCheckpoint(c, maxId, rows.size());
                c.commit();
            } catch (SQLException e) {
                c.rollback();
                throw e;
            }
        }
    }

    private void updateRows(Connection c, List<UserEmailRow> rows) throws SQLException {
        String sql = """
            UPDATE users
            SET normalized_email = ?,
                email_migration_version = 1
            WHERE id = ?
              AND email_migration_version IS NULL
            """;

        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (UserEmailRow row : rows) {
                ps.setString(1, normalize(row.email()));
                ps.setLong(2, row.id());
                ps.addBatch();
            }
            ps.executeBatch();
        }
    }

    private String normalize(String email) {
        return email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }

    private void sleep(Duration duration) throws InterruptedException {
        Thread.sleep(duration.toMillis());
    }
}
```

Catatan:

- `loadCheckpoint`, `saveCheckpoint`, `markCompleted`, dan exception wrapper harus dibuat serius.
- Gunakan metric/logging.
- Jangan log PII seperti email mentah di production.
- Gunakan vendor-specific pagination syntax sesuai DB.

---

## 27. Observability Checklist

Backfill harus menjawab pertanyaan ini saat berjalan:

```text
Berapa total row eligible?
Berapa sudah diproses?
Berapa gagal?
Berapa speed rows/sec?
Chunk mana yang sedang jalan?
Durasi rata-rata per chunk?
Error apa yang paling banyak?
Apakah lock wait naik?
Apakah replication lag naik?
Apakah aplikasi user terdampak?
Kapan estimasi selesai berdasarkan rate saat ini?
```

Metric yang berguna:

- `migration_rows_processed_total`
- `migration_rows_failed_total`
- `migration_chunk_duration_seconds`
- `migration_current_checkpoint`
- `migration_rows_per_second`
- `migration_retry_total`
- `migration_deadlock_total`
- `migration_lock_timeout_total`
- `migration_lag_seconds`

Structured log per chunk:

```json
{
  "event": "data_migration_chunk_completed",
  "job": "normalize-email-v1",
  "chunk": 128,
  "fromId": 64001,
  "toId": 64500,
  "rowCount": 500,
  "durationMs": 842,
  "status": "SUCCESS"
}
```

---

## 28. Pre-Flight Checklist

Sebelum menjalankan backfill:

```text
[ ] Scope query reviewed
[ ] Expected row count known
[ ] Transformation rule approved
[ ] Idempotency proven
[ ] Chunk size tested
[ ] Runtime estimated
[ ] Validation query prepared
[ ] Error handling policy defined
[ ] Roll-forward plan ready
[ ] Rollback/compensation plan understood
[ ] App compatibility verified
[ ] Monitoring dashboard ready
[ ] Lock/timeout settings known
[ ] DB capacity checked
[ ] Replication/log impact considered
[ ] Backup/restore posture understood
[ ] Business owner aware for semantic changes
```

---

## 29. During-Flight Checklist

Saat backfill berjalan:

```text
[ ] Monitor processed count
[ ] Monitor failed count
[ ] Monitor chunk duration
[ ] Monitor DB CPU/I/O
[ ] Monitor lock wait/deadlock
[ ] Monitor app latency/error rate
[ ] Monitor replication lag
[ ] Pause if thresholds exceeded
[ ] Record anomalies
[ ] Do not manually mutate data outside agreed runbook
```

---

## 30. Post-Flight Checklist

Setelah selesai:

```text
[ ] Completion marker recorded
[ ] Eligible remaining count = 0 or explained
[ ] Error table reviewed
[ ] Business validation passed
[ ] App read path verified
[ ] Metrics/logs archived
[ ] Change ticket updated
[ ] Next contract migration scheduled
[ ] Temporary indexes/checkpoints reviewed
[ ] Cleanup plan prepared
```

---

## 31. Common Anti-Patterns

### 31.1 One Giant UPDATE in Production

```sql
UPDATE huge_table SET new_col = transform(old_col);
```

Masalah:

- lock lama,
- log besar,
- timeout,
- rollback mahal,
- no progress visibility.

### 31.2 Backfill in Application Startup

Aplikasi start lalu menjalankan backfill jutaan row.

Masalah:

- startup timeout,
- readiness gagal,
- rolling deployment stuck,
- multiple pods bisa menjalankan job bersamaan jika lock tidak benar.

### 31.3 No Idempotency

Job gagal di tengah dan saat dijalankan ulang menghasilkan duplicate/corrupt data.

### 31.4 No Compatibility Window

Aplikasi baru langsung mengasumsikan semua data sudah backfilled.

### 31.5 External API Calls inside Migration

Retry migration menghasilkan side effect eksternal berulang.

### 31.6 ORM `findAll()` Migration

Mengambil semua data ke memory.

### 31.7 Editing Old Migration to Fix Data

Mengubah file migration lama setelah pernah diterapkan menyebabkan checksum mismatch dan merusak audit trail.

### 31.8 No Validation Query

Menganggap job sukses karena process exit code `0`.

---

## 32. Decision Matrix

| Pertanyaan | Jika Ya | Jika Tidak |
|---|---|---|
| Row sedikit dan cepat? | Flyway/Liquibase SQL cukup | Pertimbangkan job |
| Transformasi SQL-native? | Set-based SQL | Java processor |
| Butuh retry per row? | Batch job | Migration biasa mungkin cukup |
| Bisa partial state? | Online backfill aman | Perlu maintenance window atau compatibility change |
| Butuh progress dashboard? | External job | Migration history cukup |
| Butuh pause/resume? | Checkpoint job | Versioned migration cukup |
| Ada side effect eksternal? | Redesign/outbox | Aman lanjut |
| Data sensitif? | Audit, masking, key control | Standard control cukup |
| Multi-tenant? | Per-tenant rollout | Global rollout mungkin cukup |

---

## 33. Practical Pattern Catalog

### Pattern A — Small Deterministic SQL Data Fix

Use:

- Flyway SQL migration,
- Liquibase SQL changeset.

Example:

```sql
UPDATE lookup
SET display_name = 'Pending Review'
WHERE code = 'PENDING_REVIEW';
```

### Pattern B — Medium Chunked SQL Backfill

Use:

- external script/job,
- checkpoint table,
- SQL batch update.

Example:

```text
run job until no pending rows
```

### Pattern C — Large Java Transform Backfill

Use:

- Java batch job,
- JDBC batching,
- checkpoint,
- metrics,
- error table.

### Pattern D — Online Dual-Write Migration

Use:

- expand schema,
- deploy dual-write app,
- backfill old rows,
- switch reads,
- contract later.

### Pattern E — Business-Semantic Migration

Use:

- mapping table,
- approval evidence,
- sample review,
- exception report,
- staged rollout.

---

## 34. The Top 1% View

Engineer biasa melihat backfill sebagai:

```text
UPDATE table SET new_col = old_col;
```

Engineer senior melihat:

```text
Apakah statement ini lock table?
Berapa row?
Berapa log growth?
Bisa retry?
Apa partial state valid?
Apa aplikasi kompatibel?
Apa validasi completeness?
Apa error policy?
Apa evidence untuk audit?
Kapan read path pindah?
Apa rencana contract?
```

Engineer top-tier melihat lebih jauh:

```text
Backfill adalah distributed operational workflow yang kebetulan memodifikasi database.
```

Ia punya:

- state machine,
- checkpoint,
- observability,
- failure handling,
- business validation,
- rollout choreography,
- security/audit control,
- cutover strategy,
- cleanup strategy.

---

## 35. Ringkasan

Data migration dan backfill adalah bagian paling berisiko dari database change engineering karena menyentuh state production secara luas.

Prinsip utama:

1. Jangan perlakukan backfill besar sebagai SQL file biasa.
2. Buat partial state valid.
3. Proses data dalam chunk.
4. Commit per chunk.
5. Buat job resumable.
6. Desain idempotency.
7. Tambahkan throttling.
8. Observasi progress dan error.
9. Validasi hasil.
10. Hubungkan backfill dengan deployment choreography.

Flyway dan Liquibase tetap penting sebagai control plane migration. Namun untuk data migration besar, workload sering harus dipisahkan menjadi job yang lebih operasional.

---

## 36. Referensi

- Redgate Flyway Documentation — Migrations: SQL, Java-based migrations, script migrations, and schema history table.
- Redgate Flyway Documentation — Java API: migration can be run before application startup to keep database compatible with application code.
- Liquibase Documentation — Database change management, changelog tracking, rollback/tag behavior.
- Spring Batch Reference — Chunk-oriented processing and commit interval.
- PostgreSQL, Oracle, MySQL, SQL Server vendor documentation for locking, transaction, indexing, and DDL behavior should always be checked for the exact production database version.

---

## 37. Materi Berikutnya

Part berikutnya:

```text
20-expand-contract-zero-downtime-migration.md
```

Topik berikutnya akan membahas bagaimana schema migration, app deployment, dual-write, backfill, read-switch, dan cleanup dirangkai menjadi strategi **zero-downtime migration**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./18-idempotent-deterministic-seed-design.md">⬅️ Idempotent and Deterministic Seed Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./20-expand-contract-zero-downtime-migration.md">Part 20 — Expand/Contract Pattern for Zero-Downtime Migration ➡️</a>
</div>

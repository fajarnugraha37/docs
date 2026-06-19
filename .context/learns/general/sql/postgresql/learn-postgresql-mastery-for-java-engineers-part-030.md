# learn-postgresql-mastery-for-java-engineers-part-030.md

# Part 030 — Migration dan Zero-downtime Schema Change

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang membangun sistem backend produksi  
> Fokus: PostgreSQL-specific migration, DDL locking, compatibility, backfill, constraint validation, index lifecycle, dan zero/near-zero downtime schema evolution  
> Prasyarat: Part 000–029, terutama MVCC, locking, indexing, constraints, write path, observability, backup/restore, replication, HA, dan security

---

## 0. Tujuan Bagian Ini

Di banyak sistem produksi, database migration adalah salah satu sumber insiden paling mahal. Bukan karena engineer tidak tahu SQL, tetapi karena migration sering diperlakukan sebagai aktivitas sederhana:

```sql
ALTER TABLE orders ADD COLUMN status text NOT NULL DEFAULT 'NEW';
```

atau:

```sql
ALTER TABLE case_events ALTER COLUMN payload TYPE jsonb USING payload::jsonb;
```

Masalahnya, di PostgreSQL, DDL bukan sekadar perubahan metadata abstrak. DDL berinteraksi dengan:

- lock manager,
- MVCC,
- table rewrite,
- index build,
- autovacuum,
- replication lag,
- prepared statements,
- application deployment order,
- connection pool,
- read replica,
- backup/PITR,
- rollback strategy,
- dan compatibility antara versi lama dan versi baru aplikasi.

Part ini bertujuan membuat kamu bisa menjawab pertanyaan-pertanyaan berikut dengan percaya diri:

1. Apakah migration ini akan mengambil lock berbahaya?
2. Apakah DDL ini metadata-only atau table rewrite?
3. Apakah perubahan schema kompatibel dengan versi aplikasi lama?
4. Bagaimana menjalankan backfill tanpa membunuh database?
5. Bagaimana menambah constraint di tabel besar tanpa blocking lama?
6. Bagaimana menambah index di production tanpa menghentikan write?
7. Bagaimana melakukan rename/drop column secara aman?
8. Bagaimana rollback migration kalau app sudah deploy sebagian?
9. Bagaimana mendesain migration untuk sistem multi-instance Java?
10. Bagaimana membuat migration defensible untuk sistem regulatory/case management?

Targetnya bukan hanya “bisa pakai Flyway/Liquibase”, tetapi memahami **schema evolution sebagai distributed systems problem**.

---

## 1. Mental Model: Migration adalah Perubahan State Machine Sistem

Banyak engineer melihat migration sebagai perubahan database schema. Itu terlalu sempit.

Dalam sistem produksi, migration mengubah state dari beberapa komponen sekaligus:

```text
Application code version
        ↓
SQL query shape
        ↓
Database schema
        ↓
Data shape
        ↓
Indexes / constraints
        ↓
Background jobs
        ↓
Read replicas
        ↓
Reports / ETL / CDC consumers
        ↓
Operational runbooks
```

Artinya, migration adalah transisi sistem dari state lama ke state baru.

Sistem lama:

```text
App V1 expects schema S1 and data shape D1
```

Sistem baru:

```text
App V2 expects schema S2 and data shape D2
```

Zero-downtime migration berarti kamu tidak melompat langsung dari `(V1, S1, D1)` ke `(V2, S2, D2)`, melainkan melewati state antara yang kompatibel:

```text
State A: App V1 + Schema S1 + Data D1
State B: App V1 + Schema S1+S2-compatible + Data D1
State C: App V1/V2 + Schema compatible + Data D1/D2 transitional
State D: App V2 + Schema compatible + Data D2
State E: App V2 + Schema S2 final + Data D2
```

Ini sangat mirip state machine. Setiap step harus:

- aman bila dijalankan sekali,
- aman bila dijalankan ulang,
- aman bila app lama dan app baru hidup bersamaan,
- aman bila deploy gagal di tengah,
- aman bila rollback aplikasi terjadi,
- observable,
- dan tidak mengambil lock yang tidak bisa diterima.

### Prinsip inti

```text
Migration aman bukan yang “benar secara SQL”, tetapi yang semua intermediate state-nya aman.
```

---

## 2. PostgreSQL DDL: Transactional, tetapi Tidak Berarti Aman dari Downtime

PostgreSQL mendukung transactional DDL untuk banyak operasi. Contoh:

```sql
BEGIN;

ALTER TABLE enforcement_case ADD COLUMN review_deadline timestamptz;
CREATE INDEX idx_case_review_deadline ON enforcement_case (review_deadline);

ROLLBACK;
```

Secara konsep, jika rollback, perubahan DDL bisa dibatalkan.

Tetapi ada jebakan besar:

```text
Transactional DDL ≠ non-blocking DDL.
```

DDL tetap bisa mengambil lock kuat. Jika lock menunggu terlalu lama atau memblokir transaksi lain, aplikasi bisa terlihat down walaupun database masih hidup.

Contoh bahaya:

```sql
ALTER TABLE enforcement_case DROP COLUMN old_status;
```

atau:

```sql
ALTER TABLE enforcement_case ALTER COLUMN external_ref TYPE varchar(128);
```

Operasi tersebut bisa mengambil lock pada tabel. Dalam kondisi tertentu, lock menunggu transaksi aktif selesai. Ketika DDL menunggu, DDL juga bisa berada di depan queue lock dan membuat query lain ikut menunggu.

### Lock queue problem

Bayangkan:

```text
T1: long SELECT/transaction sedang memegang lock ringan pada table cases
T2: ALTER TABLE cases ... menunggu AccessExclusiveLock
T3: SELECT biasa datang setelah T2
```

Walaupun T3 sebenarnya kompatibel dengan T1, T3 bisa ikut tertahan karena T2 sudah menunggu lock eksklusif. Ini menyebabkan pile-up.

Secara operasional:

```text
Satu migration yang “hanya menunggu” bisa membuat traffic normal ikut berhenti.
```

Karena itu setiap migration production harus punya:

- `lock_timeout`,
- `statement_timeout`,
- observability lock,
- retry plan,
- dan rollback/abort plan.

---

## 3. Kategori Migration Berdasarkan Risiko

Tidak semua migration punya risiko sama. Kita butuh taksonomi.

### 3.1 Metadata-only migration

Contoh:

```sql
ALTER TABLE enforcement_case ADD COLUMN reviewer_id uuid;
```

Menambah nullable column tanpa default biasanya hanya metadata change dan cepat. Namun tetap mengambil lock singkat.

Risiko:

- lock singkat,
- prepared statement/cache invalidation,
- aplikasi lama biasanya aman karena kolom baru tidak dipakai.

### 3.2 Metadata + validation migration

Contoh:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT chk_priority_valid
CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')) NOT VALID;
```

Lalu:

```sql
ALTER TABLE enforcement_case
VALIDATE CONSTRAINT chk_priority_valid;
```

Menambah constraint dengan `NOT VALID` dapat memisahkan fase metadata dari fase validasi data historis. Ini lebih aman untuk tabel besar.

### 3.3 Index build migration

Contoh aman production:

```sql
CREATE INDEX CONCURRENTLY idx_case_assignee_status
ON enforcement_case (assignee_id, status);
```

Risiko:

- lebih lama,
- lebih banyak I/O,
- tidak bisa dijalankan di transaction block,
- bisa gagal bila ada masalah duplicate untuk unique index,
- tetap menambah write amplification.

### 3.4 Data backfill migration

Contoh:

```sql
UPDATE enforcement_case
SET normalized_status = lower(status)
WHERE normalized_status IS NULL;
```

Risiko:

- row lock besar,
- WAL besar,
- replication lag,
- bloat,
- autovacuum pressure,
- long transaction,
- cache churn,
- index update cost.

Backfill hampir selalu harus dipecah batch.

### 3.5 Table rewrite migration

Contoh berpotensi berat:

```sql
ALTER TABLE enforcement_case
ALTER COLUMN payload TYPE jsonb USING payload::jsonb;
```

atau operasi lain yang harus menulis ulang banyak row.

Risiko:

- lock kuat,
- rewrite seluruh tabel,
- WAL besar,
- disk growth,
- replication lag,
- downtime efektif.

### 3.6 Destructive migration

Contoh:

```sql
DROP TABLE old_case_snapshot;
ALTER TABLE enforcement_case DROP COLUMN old_status;
```

Risiko:

- rollback sulit,
- aplikasi lama bisa rusak,
- report/ETL bisa rusak,
- prepared query bisa gagal,
- audit history bisa hilang.

Destructive migration harus menjadi step paling akhir setelah observasi cukup.

---

## 4. Compatibility First: Aturan Utama Zero-downtime Migration

Aplikasi Java produksi biasanya berjalan lebih dari satu instance:

```text
App instance A: old version
App instance B: old version
App instance C: new version just deployed
App instance D: old version not restarted yet
```

Jika deployment rolling, selama beberapa menit sampai jam, app lama dan app baru bisa berjalan bersamaan.

Maka schema harus kompatibel dengan dua versi aplikasi.

### 4.1 Backward compatibility

Schema baru harus masih bisa dipakai app lama.

Contoh aman:

```sql
ALTER TABLE enforcement_case ADD COLUMN review_deadline timestamptz;
```

App lama tidak tahu kolom itu. Biasanya aman.

Contoh tidak aman:

```sql
ALTER TABLE enforcement_case RENAME COLUMN status TO lifecycle_status;
```

App lama masih query `status`, lalu gagal.

### 4.2 Forward compatibility

App baru harus bisa berjalan sebelum semua data berubah sempurna.

Misalnya app baru membaca `normalized_status`:

```sql
ALTER TABLE enforcement_case ADD COLUMN normalized_status text;
```

Jika app baru langsung menganggap kolom ini selalu non-null, ia akan gagal untuk row lama.

App baru harus sementara membaca fallback:

```java
String effectiveStatus = row.normalizedStatus() != null
    ? row.normalizedStatus()
    : normalize(row.status());
```

atau SQL:

```sql
SELECT COALESCE(normalized_status, lower(status)) AS effective_status
FROM enforcement_case
WHERE id = ?;
```

### 4.3 Expand-contract pattern

Pattern umum zero-downtime:

```text
1. Expand schema: tambah struktur baru tanpa merusak struktur lama.
2. Deploy app yang bisa dual-read/dual-write.
3. Backfill data lama.
4. Verify consistency.
5. Switch read path ke struktur baru.
6. Stop writing struktur lama.
7. Contract schema: hapus struktur lama setelah aman.
```

Ini pattern paling penting dalam migration.

---

## 5. Expand-contract Pattern secara Mendalam

Misal sistem lama punya kolom:

```sql
status text NOT NULL
```

Kamu ingin mengganti ke model lebih formal:

```sql
lifecycle_status text NOT NULL
```

atau bahkan foreign key ke lookup table.

### Step 1 — Expand: tambah kolom baru nullable

```sql
ALTER TABLE enforcement_case
ADD COLUMN lifecycle_status text;
```

Aman karena app lama tetap memakai `status`.

### Step 2 — Deploy app dual-write

Saat update case:

```java
void transitionCase(UUID id, CaseStatus newStatus) {
    jdbc.update("""
        UPDATE enforcement_case
        SET status = ?,
            lifecycle_status = ?,
            updated_at = now()
        WHERE id = ?
        """,
        newStatus.legacyCode(),
        newStatus.normalizedCode(),
        id
    );
}
```

Pada fase ini:

```text
write lama tetap jalan
write baru mulai diisi
read masih bisa dari lama
```

### Step 3 — Backfill historis dalam batch

Jangan:

```sql
UPDATE enforcement_case
SET lifecycle_status = normalize_status(status)
WHERE lifecycle_status IS NULL;
```

Di tabel besar, ini bisa sangat mahal.

Gunakan batch:

```sql
WITH batch AS (
    SELECT id
    FROM enforcement_case
    WHERE lifecycle_status IS NULL
    ORDER BY id
    LIMIT 1000
)
UPDATE enforcement_case c
SET lifecycle_status = lower(c.status)
FROM batch
WHERE c.id = batch.id;
```

Dijalankan berulang oleh job dengan throttle.

### Step 4 — Verify

```sql
SELECT count(*) AS missing_lifecycle_status
FROM enforcement_case
WHERE lifecycle_status IS NULL;
```

Dan consistency check:

```sql
SELECT status, lifecycle_status, count(*)
FROM enforcement_case
GROUP BY status, lifecycle_status
ORDER BY count(*) DESC;
```

### Step 5 — Tambahkan constraint secara aman

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT chk_lifecycle_status_not_null
CHECK (lifecycle_status IS NOT NULL) NOT VALID;
```

Lalu validasi:

```sql
ALTER TABLE enforcement_case
VALIDATE CONSTRAINT chk_lifecycle_status_not_null;
```

Catatan: untuk `NOT NULL` asli, PostgreSQL memiliki mekanisme tersendiri, tetapi pattern check constraint `IS NOT NULL` sering dipakai dalam strategi staged validation. Setelah aman, bisa dirapikan sesuai kebutuhan.

### Step 6 — Deploy app read-new

App membaca `lifecycle_status` sebagai sumber utama.

### Step 7 — Stop writing old column

Deploy app yang tidak lagi memakai `status`, atau tetap menulis sementara untuk rollback window.

### Step 8 — Contract: drop old column setelah aman

```sql
ALTER TABLE enforcement_case
DROP COLUMN status;
```

Ini dilakukan paling akhir, setelah:

- tidak ada query lama,
- tidak ada report memakai kolom lama,
- tidak ada ETL/CDC consumer memakai kolom lama,
- backup/restore policy jelas,
- rollback aplikasi tidak lagi membutuhkan kolom lama.

---

## 6. DDL Locking: Apa yang Perlu Kamu Takuti

DDL sering mengambil `ACCESS EXCLUSIVE` lock pada tabel. Lock ini konflik dengan hampir semua operasi lain.

Tidak semua operasi sama durasinya. Ada dua dimensi:

```text
Lock strength: seberapa eksklusif lock-nya
Lock duration: berapa lama lock dipegang
```

Operasi metadata-only bisa mengambil lock kuat tetapi sangat singkat. Masalah terjadi jika:

- ada transaksi lama,
- lock tidak segera didapat,
- DDL masuk lock queue,
- traffic normal mulai menumpuk di belakangnya.

### 6.1 Selalu pakai lock timeout untuk DDL production

Contoh:

```sql
SET lock_timeout = '2s';
SET statement_timeout = '5min';

ALTER TABLE enforcement_case
ADD COLUMN review_deadline timestamptz;
```

Tujuannya bukan agar migration selalu sukses. Tujuannya agar migration **fail fast** daripada membuat pile-up.

Untuk migration tool, kamu bisa menaruh ini di awal script:

```sql
SET lock_timeout = '2s';
SET statement_timeout = '10min';
SET idle_in_transaction_session_timeout = '30s';
```

Tapi hati-hati: beberapa tool menjalankan migration dalam transaction block. `CREATE INDEX CONCURRENTLY` tidak boleh di dalam transaction block.

### 6.2 Diagnosis lock sebelum migration

Cek transaksi lama:

```sql
SELECT
    pid,
    usename,
    application_name,
    state,
    now() - xact_start AS xact_age,
    now() - query_start AS query_age,
    wait_event_type,
    wait_event,
    left(query, 200) AS query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;
```

Cek session idle in transaction:

```sql
SELECT
    pid,
    usename,
    application_name,
    now() - xact_start AS xact_age,
    left(query, 200) AS last_query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
ORDER BY xact_start;
```

DDL di tabel besar jangan dijalankan jika banyak transaksi lama aktif.

---

## 7. Add Column: Aman, tetapi Ada Detail Penting

### 7.1 Nullable column tanpa default

Biasanya aman:

```sql
ALTER TABLE enforcement_case
ADD COLUMN reviewer_id uuid;
```

Karakteristik:

- app lama aman,
- tidak perlu isi row lama,
- lock biasanya singkat,
- tidak membuat backfill otomatis.

### 7.2 Add column dengan default

Contoh:

```sql
ALTER TABLE enforcement_case
ADD COLUMN priority text DEFAULT 'MEDIUM';
```

Di PostgreSQL modern, penambahan kolom dengan default konstan dapat lebih murah dibanding versi lama karena tidak selalu perlu rewrite seluruh tabel. Namun kamu tetap harus berpikir operasional:

- apakah default expression volatile?
- apakah default akan mempengaruhi app lama?
- apakah kolom juga `NOT NULL`?
- apakah semantik default benar untuk data historis?

Jangan hanya karena engine bisa melakukannya cepat, lalu menganggap domain semantics benar.

### 7.3 Add NOT NULL column

Berbahaya jika langsung:

```sql
ALTER TABLE enforcement_case
ADD COLUMN assigned_team_id uuid NOT NULL;
```

Row lama tidak punya nilai. Ini gagal kecuali ada default. Kalau default dipakai, kamu harus yakin nilai itu benar untuk semua data historis.

Pattern aman:

```text
1. ADD COLUMN nullable.
2. Deploy app yang menulis kolom baru.
3. Backfill historical rows.
4. Verify no null.
5. Add/validate constraint.
6. Optionally set NOT NULL in final step.
```

---

## 8. Rename Column/Table: Hampir Selalu Tidak Zero-downtime

Rename terlihat sederhana:

```sql
ALTER TABLE enforcement_case
RENAME COLUMN status TO lifecycle_status;
```

Tapi rename merusak compatibility:

```text
App lama query status → error
App baru query lifecycle_status → error sebelum migration
```

Dalam rolling deployment, ini sangat berbahaya.

### Pattern aman untuk rename column

Jangan rename langsung. Lakukan copy-column migration:

```text
1. Add new column lifecycle_status.
2. Dual-write status + lifecycle_status.
3. Backfill lifecycle_status.
4. Deploy read-new.
5. Stop using status.
6. Drop status later.
```

Ini memang lebih panjang, tetapi kompatibel.

### Rename table

Rename table juga merusak query lama:

```sql
ALTER TABLE case_event RENAME TO enforcement_case_event;
```

Solusi transisional bisa memakai view, tetapi harus hati-hati dengan write, trigger, permission, dan ORM mapping.

Dalam sistem Java/Hibernate, rename entity/table sering lebih baik dilakukan lewat expand-contract daripada rename langsung.

---

## 9. Drop Column/Table: Destructive Migration Harus Ditunda

Drop adalah finalization step, bukan migration awal.

```sql
ALTER TABLE enforcement_case DROP COLUMN legacy_status;
```

Risiko:

- app lama gagal,
- rollback app gagal,
- report gagal,
- ETL gagal,
- CDC consumer gagal,
- forensic/debugging kehilangan data,
- restore selective lebih sulit.

### Safe drop checklist

Sebelum drop:

```text
[ ] Tidak ada query runtime memakai kolom/tabel.
[ ] Tidak ada report/BI/ETL memakai kolom/tabel.
[ ] Tidak ada CDC consumer memakai field tersebut.
[ ] Tidak ada stored procedure/trigger/view memakai field tersebut.
[ ] Tidak ada rollback aplikasi yang butuh field tersebut.
[ ] Sudah lewat retention window observasi.
[ ] Backup/PITR tersedia.
[ ] Owner domain menyetujui penghapusan.
```

Dalam sistem regulatory, drop data harus ekstra hati-hati. Banyak data yang terlihat “legacy” mungkin masih punya nilai audit.

---

## 10. Type Change: Sering Lebih Aman dengan Kolom Baru

Contoh:

```sql
ALTER TABLE enforcement_case
ALTER COLUMN external_ref TYPE uuid USING external_ref::uuid;
```

Masalah:

- mungkin table rewrite,
- bisa gagal di tengah karena data invalid,
- lock berat,
- app lama mungkin masih menulis format lama,
- rollback sulit.

Pattern aman:

```text
1. Add new column external_ref_uuid uuid.
2. Deploy app dual-write.
3. Backfill valid rows in batches.
4. Capture invalid rows.
5. Add validation constraint.
6. Switch read path.
7. Drop old column later.
```

Contoh:

```sql
ALTER TABLE enforcement_case
ADD COLUMN external_ref_uuid uuid;
```

Backfill batch:

```sql
WITH batch AS (
    SELECT id
    FROM enforcement_case
    WHERE external_ref_uuid IS NULL
      AND external_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY id
    LIMIT 1000
)
UPDATE enforcement_case c
SET external_ref_uuid = c.external_ref::uuid
FROM batch
WHERE c.id = batch.id;
```

Tangani invalid data:

```sql
SELECT id, external_ref
FROM enforcement_case
WHERE external_ref_uuid IS NULL
  AND external_ref IS NOT NULL;
```

Top-tier engineer tidak menganggap type change sebagai operasi syntactic. Ia melihatnya sebagai data quality migration.

---

## 11. Constraint Migration Tanpa Downtime

Constraint adalah invariant. Tetapi menambah constraint ke tabel besar harus hati-hati.

### 11.1 Menambah CHECK constraint dengan NOT VALID

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT chk_case_priority
CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')) NOT VALID;
```

Efek:

- row baru harus memenuhi constraint,
- row lama belum divalidasi,
- lock lebih aman dibanding scan penuh langsung.

Lalu:

```sql
ALTER TABLE enforcement_case
VALIDATE CONSTRAINT chk_case_priority;
```

### 11.2 Menambah FOREIGN KEY dengan NOT VALID

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT fk_case_assignee
FOREIGN KEY (assignee_id)
REFERENCES app_user(id)
NOT VALID;
```

Lalu:

```sql
ALTER TABLE enforcement_case
VALIDATE CONSTRAINT fk_case_assignee;
```

### 11.3 Index untuk foreign key

PostgreSQL tidak otomatis membuat index di referencing column foreign key. Untuk tabel child besar, sering perlu:

```sql
CREATE INDEX CONCURRENTLY idx_case_assignee_id
ON enforcement_case (assignee_id);
```

Jika tidak, delete/update parent bisa sangat mahal karena harus cek child rows.

### 11.4 Unique constraint di tabel besar

Untuk unique constraint production, sering pattern-nya:

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_case_external_ref_idx
ON enforcement_case (tenant_id, external_ref)
WHERE deleted_at IS NULL;
```

Lalu bisa attach sebagai constraint untuk beberapa jenis unique index sesuai kebutuhan dan batasan PostgreSQL. Tetapi partial unique index sendiri sudah sering cukup sebagai invariant.

Sebelum unique index:

```sql
SELECT tenant_id, external_ref, count(*)
FROM enforcement_case
WHERE deleted_at IS NULL
GROUP BY tenant_id, external_ref
HAVING count(*) > 1;
```

Jangan build unique index sebelum duplicate dibersihkan.

---

## 12. Index Migration di Production

### 12.1 Jangan gunakan CREATE INDEX biasa di tabel write-heavy production

```sql
CREATE INDEX idx_case_status ON enforcement_case (status);
```

Ini bisa memblokir write.

Gunakan:

```sql
CREATE INDEX CONCURRENTLY idx_case_status
ON enforcement_case (status);
```

Karakteristik `CONCURRENTLY`:

- tidak memblokir normal insert/update/delete seperti index biasa,
- lebih lama,
- membutuhkan beberapa fase,
- tidak boleh dalam transaction block,
- jika gagal, bisa meninggalkan invalid index yang harus dibersihkan.

### 12.2 Flyway/Liquibase implication

Banyak migration tool menjalankan migration dalam transaction secara default.

`CREATE INDEX CONCURRENTLY` butuh non-transactional migration.

Di Flyway, biasanya butuh konfigurasi/script khusus agar migration tertentu tidak berjalan dalam transaction. Di Liquibase, gunakan fitur yang sesuai untuk menjalankan SQL tanpa transaction bila perlu.

Prinsipnya:

```text
Migration tool convenience tidak boleh mengalahkan requirement PostgreSQL.
```

### 12.3 Drop index

Gunakan:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_case_old_status;
```

Jangan drop index yang belum terbukti unused. Cek:

```sql
SELECT
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE relname = 'enforcement_case'
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;
```

Catatan: `idx_scan = 0` bukan bukti absolut index tidak dipakai. Statistik bisa reset, workload bisa periodik, dan constraint-backed index mungkin jarang discan tetapi tetap penting.

### 12.4 Reindex

Untuk bloat/corruption maintenance:

```sql
REINDEX INDEX CONCURRENTLY idx_case_status;
```

Gunakan dengan pemahaman I/O dan disk usage. Reindex concurrent tetap membutuhkan ruang tambahan sementara.

---

## 13. Backfill: Migration Data adalah Workload Produksi

Backfill sering lebih berbahaya daripada DDL.

Contoh buruk:

```sql
UPDATE enforcement_case
SET normalized_status = lower(status)
WHERE normalized_status IS NULL;
```

Jika tabel berisi 200 juta row:

- satu transaksi besar,
- WAL sangat besar,
- row lock lama,
- autovacuum tertahan,
- replication lag,
- bloat,
- disk penuh,
- query normal terganggu.

### 13.1 Batch update pattern

Gunakan batch kecil:

```sql
WITH batch AS (
    SELECT id
    FROM enforcement_case
    WHERE normalized_status IS NULL
    ORDER BY id
    LIMIT 1000
)
UPDATE enforcement_case c
SET normalized_status = lower(c.status)
FROM batch
WHERE c.id = batch.id;
```

Run loop dari job Java:

```java
while (true) {
    int updated = jdbc.update("""
        WITH batch AS (
            SELECT id
            FROM enforcement_case
            WHERE normalized_status IS NULL
            ORDER BY id
            LIMIT 1000
        )
        UPDATE enforcement_case c
        SET normalized_status = lower(c.status)
        FROM batch
        WHERE c.id = batch.id
        """);

    if (updated == 0) break;

    Thread.sleep(100);
}
```

Namun ini masih sederhana. Dalam produksi, job harus punya:

- throttle dinamis,
- observability,
- checkpoint,
- cancellation,
- retry,
- max runtime per window,
- lock timeout,
- statement timeout,
- dan awareness replication lag.

### 13.2 Keyset batch lebih baik daripada OFFSET

Jangan:

```sql
SELECT id
FROM enforcement_case
ORDER BY id
OFFSET 1000000
LIMIT 1000;
```

Gunakan cursor/keyset:

```sql
SELECT id
FROM enforcement_case
WHERE id > :last_id
ORDER BY id
LIMIT 1000;
```

Untuk UUID random, urutan tidak locality-friendly. Bisa pakai synthetic ordered key, `created_at`, atau batch by partition/time window.

### 13.3 Skip locked untuk worker paralel

Untuk parallel backfill:

```sql
WITH batch AS (
    SELECT id
    FROM enforcement_case
    WHERE normalized_status IS NULL
    ORDER BY id
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
)
UPDATE enforcement_case c
SET normalized_status = lower(c.status)
FROM batch
WHERE c.id = batch.id
RETURNING c.id;
```

Ini memungkinkan beberapa worker mengambil batch berbeda.

Trade-off:

- bagus untuk throughput,
- bisa melewati row yang terkunci,
- perlu loop sampai benar-benar selesai,
- jangan terlalu banyak worker karena bisa membuat write amplification dan WAL storm.

### 13.4 Backfill harus idempotent

Backfill aman harus bisa dijalankan ulang:

```sql
UPDATE enforcement_case
SET normalized_status = lower(status)
WHERE id = ?
  AND normalized_status IS NULL;
```

Jangan backfill yang menggandakan efek:

```sql
UPDATE account
SET balance = balance + adjustment_amount;
```

Kecuali kamu punya idempotency key/ledger.

### 13.5 Backfill observability

Progress:

```sql
SELECT
    count(*) FILTER (WHERE normalized_status IS NULL) AS remaining,
    count(*) AS total
FROM enforcement_case;
```

Untuk tabel besar, `count(*)` mahal. Gunakan estimasi, partition progress, atau job checkpoint table:

```sql
CREATE TABLE migration_job_progress (
    job_name text PRIMARY KEY,
    last_processed_id uuid,
    processed_rows bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 14. Migration dan Replication Lag

Setiap update menghasilkan WAL. Backfill besar bisa membuat replica tertinggal.

Masalah:

```text
Primary terlihat baik-baik saja
Replica lag 30 menit
Read traffic membaca data lama
Failover menjadi berisiko
WAL disk menumpuk karena replica/slot tertinggal
```

Monitor:

```sql
SELECT
    application_name,
    state,
    sync_state,
    write_lag,
    flush_lag,
    replay_lag,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS byte_lag
FROM pg_stat_replication;
```

Backfill job harus bisa throttle berdasarkan lag.

Pseudo-logic:

```java
if (replicationLagBytes > threshold || replayLagSeconds > threshold) {
    sleepLonger();
} else {
    processNextBatch();
}
```

Dalam sistem dengan read replica, jangan switch read path ke kolom baru sebelum replica mengejar jika aplikasi membaca dari replica.

---

## 15. Migration dan Prepared Statements / Connection Pool

PostgreSQL dan driver Java bisa memakai prepared statement. Setelah schema berubah, prepared statement lama bisa gagal atau perlu re-plan.

Contoh risiko:

- app lama prepared query `SELECT status FROM case` lalu kolom di-drop,
- app baru prepared query mengasumsikan kolom baru ada sebelum migration,
- generic plan berubah setelah index baru dibuat,
- pool menyimpan session state lama.

Prinsip:

```text
Jangan deploy app yang membutuhkan schema baru sebelum schema expand tersedia.
Jangan contract schema sebelum semua app lama mati.
```

Dalam rolling deploy:

```text
1. Run expand migration.
2. Deploy app version that can handle old+new data.
3. Complete data migration.
4. Deploy app version that only relies on new model.
5. Contract later.
```

Kadang setelah migration besar, restart app/pool bisa membantu membersihkan prepared statement/session state, tetapi jangan jadikan ini pengganti compatibility design.

---

## 16. Flyway/Liquibase: Tool Membantu Versi, Bukan Menghilangkan Risiko

Migration tool memberi:

- versioning,
- ordering,
- checksum,
- audit trail,
- repeatability,
- deployment integration.

Tetapi tool tidak otomatis tahu:

- DDL lock impact,
- table rewrite impact,
- replication lag,
- app compatibility,
- backfill throttle,
- rollback semantics,
- domain invariant,
- timing window.

### 16.1 Migration naming

Contoh Flyway style:

```text
V20260619_001__add_lifecycle_status_to_enforcement_case.sql
V20260619_002__create_index_concurrently_case_lifecycle_status.sql
V20260619_003__add_lifecycle_status_check_not_valid.sql
```

Pisahkan migration berdasarkan karakter:

- schema expand,
- index concurrent,
- constraint not valid,
- validation,
- destructive cleanup.

Jangan campur banyak operasi unrelated dalam satu file.

### 16.2 Transactional vs non-transactional

Contoh migration transaction-safe:

```sql
ALTER TABLE enforcement_case ADD COLUMN lifecycle_status text;
```

Contoh butuh non-transactional:

```sql
CREATE INDEX CONCURRENTLY idx_case_lifecycle_status
ON enforcement_case (lifecycle_status);
```

Tool harus dikonfigurasi sesuai.

### 16.3 Repeatable scripts

Untuk view/function:

```sql
CREATE OR REPLACE VIEW active_enforcement_case AS
SELECT *
FROM enforcement_case
WHERE closed_at IS NULL;
```

Tetapi hati-hati: `CREATE OR REPLACE` tidak selalu bisa mengubah semua hal tanpa dependency issue.

---

## 17. Rollback Reality: Database Rollback Tidak Sama dengan Application Rollback

Banyak tim punya asumsi:

```text
Kalau deploy gagal, rollback app saja.
```

Ini tidak cukup jika migration sudah mengubah data/schema.

### 17.1 Backward-compatible migration membuat app rollback aman

Jika kamu hanya menambah nullable column, app lama masih bisa jalan.

```sql
ALTER TABLE enforcement_case ADD COLUMN review_deadline timestamptz;
```

Rollback app aman karena kolom ekstra tidak mengganggu.

### 17.2 Destructive migration membuat rollback app tidak aman

Jika kamu sudah drop column:

```sql
ALTER TABLE enforcement_case DROP COLUMN status;
```

App lama tidak bisa jalan.

### 17.3 Data transformation rollback sering tidak realistis

Contoh:

```sql
UPDATE case_event
SET payload = payload - 'legacyField';
```

Jika field dihapus dari JSONB, rollback butuh backup atau log historis.

### 17.4 Roll-forward sering lebih realistis

Untuk banyak migration produksi, strategi lebih baik:

```text
Design migration so rollback app remains possible.
If data migration fails, pause/fix/roll forward.
Avoid destructive step until confidence high.
```

### 17.5 Rollback plan harus spesifik

Buruk:

```text
Rollback if failed.
```

Baik:

```text
If app V2 fails before read switch:
- rollback app to V1
- keep added nullable column
- stop dual-write job
- no schema rollback needed

If backfill fails:
- pause job
- inspect failed rows in migration_error table
- fix transform logic
- resume idempotently

If contract migration fails:
- abort before drop
- restore dropped structure only from backup if already executed
```

---

## 18. Online Migration untuk Large Table: Practical Playbook

Misal tabel:

```sql
CREATE TABLE enforcement_case (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
```

Target:

```text
Tambah lifecycle_status yang non-null, indexed, dan menggantikan status.
```

### Migration 1 — expand schema

```sql
SET lock_timeout = '2s';
SET statement_timeout = '1min';

ALTER TABLE enforcement_case
ADD COLUMN lifecycle_status text;
```

### Migration 2 — deploy app dual-write

App menulis dua kolom:

```sql
UPDATE enforcement_case
SET status = :legacy_status,
    lifecycle_status = :lifecycle_status,
    updated_at = now()
WHERE id = :id;
```

Read path masih bisa pakai old atau fallback.

### Migration 3 — create supporting index concurrently

```sql
CREATE INDEX CONCURRENTLY idx_case_tenant_lifecycle_created
ON enforcement_case (tenant_id, lifecycle_status, created_at DESC, id DESC);
```

### Migration 4 — backfill in batches

```sql
WITH batch AS (
    SELECT id
    FROM enforcement_case
    WHERE lifecycle_status IS NULL
    ORDER BY created_at, id
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
)
UPDATE enforcement_case c
SET lifecycle_status = CASE c.status
    WHEN 'OPEN' THEN 'ACTIVE'
    WHEN 'PENDING_REVIEW' THEN 'UNDER_REVIEW'
    WHEN 'CLOSED' THEN 'CLOSED'
    ELSE 'UNKNOWN'
END
FROM batch
WHERE c.id = batch.id;
```

### Migration 5 — verify

```sql
SELECT count(*)
FROM enforcement_case
WHERE lifecycle_status IS NULL;
```

```sql
SELECT status, lifecycle_status, count(*)
FROM enforcement_case
GROUP BY status, lifecycle_status
ORDER BY count(*) DESC;
```

### Migration 6 — add constraint not valid

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT chk_case_lifecycle_status
CHECK (lifecycle_status IN ('ACTIVE', 'UNDER_REVIEW', 'CLOSED', 'UNKNOWN'))
NOT VALID;
```

### Migration 7 — validate constraint

```sql
ALTER TABLE enforcement_case
VALIDATE CONSTRAINT chk_case_lifecycle_status;
```

### Migration 8 — deploy app read-new

App reads `lifecycle_status`.

### Migration 9 — optional set stronger invariant

Jika sudah yakin:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT chk_case_lifecycle_status_not_null
CHECK (lifecycle_status IS NOT NULL)
NOT VALID;
```

```sql
ALTER TABLE enforcement_case
VALIDATE CONSTRAINT chk_case_lifecycle_status_not_null;
```

Atau lanjut ke `SET NOT NULL` pada window yang diuji sesuai versi dan ukuran tabel.

### Migration 10 — contract later

Setelah observasi dan rollback window selesai:

```sql
ALTER TABLE enforcement_case
DROP COLUMN status;
```

Tetapi untuk sistem audit/regulatory, pertimbangkan menyimpan legacy value lebih lama atau pindahkan ke audit snapshot.

---

## 19. Zero-downtime Migration untuk NOT NULL

Menambahkan `NOT NULL` pada kolom besar harus dipikirkan.

### Pattern aman

1. Tambah kolom nullable.
2. Pastikan app menulis value untuk row baru.
3. Backfill row lama.
4. Tambah check constraint `IS NOT NULL NOT VALID`.
5. Validate constraint.
6. Baru pertimbangkan `ALTER COLUMN SET NOT NULL`.

Contoh:

```sql
ALTER TABLE enforcement_case
ADD COLUMN source_system text;
```

App mulai menulis:

```sql
INSERT INTO enforcement_case (..., source_system)
VALUES (..., 'CASE_PORTAL');
```

Backfill:

```sql
WITH batch AS (
    SELECT id
    FROM enforcement_case
    WHERE source_system IS NULL
    ORDER BY created_at, id
    LIMIT 1000
)
UPDATE enforcement_case c
SET source_system = 'LEGACY'
FROM batch
WHERE c.id = batch.id;
```

Constraint:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT chk_case_source_system_not_null
CHECK (source_system IS NOT NULL) NOT VALID;
```

Validate:

```sql
ALTER TABLE enforcement_case
VALIDATE CONSTRAINT chk_case_source_system_not_null;
```

Final optional:

```sql
ALTER TABLE enforcement_case
ALTER COLUMN source_system SET NOT NULL;
```

Sebelum final step, uji di staging dengan dataset production-like dan pahami lock behavior.

---

## 20. Migration untuk Enum: Hati-hati dengan Evolusi Domain

PostgreSQL enum bisa bagus untuk domain yang sangat stabil. Tetapi migration enum punya karakteristik khusus.

Menambah enum value:

```sql
ALTER TYPE case_status ADD VALUE 'ESCALATED';
```

Risiko arsitektural:

- app lama mungkin tidak mengenal value baru,
- Java enum mapping bisa gagal,
- report bisa salah grouping,
- downstream consumer bisa gagal deserialize.

Jika Java memakai enum strict:

```java
enum CaseStatus {
    OPEN,
    PENDING_REVIEW,
    CLOSED
}
```

Lalu DB mulai mengirim `ESCALATED`, app lama bisa error.

Pattern:

```text
1. Deploy app yang tolerant terhadap unknown/new enum.
2. Tambah enum value di DB.
3. Mulai tulis value baru.
4. Setelah semua consumer compatible, enforce usage.
```

Untuk domain yang sering berubah, `text + CHECK constraint` atau lookup table kadang lebih fleksibel daripada PostgreSQL enum.

---

## 21. Migration untuk Partitioned Table

Partitioned table menambah dimensi migration.

Pertanyaan:

- Apakah DDL pada parent otomatis berlaku ke partition?
- Apakah index dibuat di semua partition?
- Apakah constraint valid di semua partition?
- Apakah backfill harus per partition?
- Apakah detach/attach mempengaruhi migration?

### 21.1 Backfill per partition

Lebih baik:

```sql
UPDATE enforcement_case_2026_06
SET lifecycle_status = lower(status)
WHERE lifecycle_status IS NULL;
```

Daripada scan parent besar tanpa kontrol.

### 21.2 Index per partition

Declarative partitioning punya konsep partitioned index, tetapi operationally kamu tetap harus memahami build pada partition. Untuk tabel besar, sering lebih aman membangun index pada partition lama secara bertahap.

### 21.3 Retention sebagai migration simplifier

Jika data lama akan di-retain/detach, jangan backfill semua data bila tidak perlu.

Contoh:

```text
Only active partitions need new query path.
Archived partitions are read through legacy report path.
```

Tetapi ini harus eksplisit dan terdokumentasi.

---

## 22. Migration dan Multi-tenant Workload

Dalam multi-tenant table:

```sql
CREATE TABLE enforcement_case (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    ...,
    PRIMARY KEY (tenant_id, id)
);
```

Backfill global bisa membuat hot tenant atau large tenant mendominasi.

### Tenant-aware backfill

```sql
WITH batch AS (
    SELECT tenant_id, id
    FROM enforcement_case
    WHERE tenant_id = :tenant_id
      AND lifecycle_status IS NULL
    ORDER BY id
    LIMIT 1000
)
UPDATE enforcement_case c
SET lifecycle_status = lower(c.status)
FROM batch
WHERE c.tenant_id = batch.tenant_id
  AND c.id = batch.id;
```

Keuntungan:

- progress per tenant,
- bisa throttle tenant besar,
- bisa prioritize tenant penting,
- bisa isolate failure.

Risiko:

- fairness scheduling,
- tenant besar butuh waktu lama,
- constraint validation tetap global jika constraint global.

---

## 23. Migration dan Regulatory / Case Management Systems

Untuk sistem regulatory/enforcement lifecycle, migration bukan hanya technical change. Ia bisa mempengaruhi defensibility.

Contoh:

- mengubah status mapping,
- menghapus reason code,
- mengubah escalation timestamp,
- menormalisasi actor/assignee,
- memindahkan evidence metadata,
- mengubah audit event payload.

Pertanyaan yang harus dijawab:

1. Apakah migration mengubah makna historis data?
2. Apakah mapping lama ke baru deterministik?
3. Apakah ada data yang tidak bisa dimapping?
4. Apakah invalid rows dicatat?
5. Apakah transform logic versioned?
6. Apakah migration bisa diaudit?
7. Apakah hasil migration bisa direkonsiliasi?
8. Apakah laporan historis tetap reproducible?

### Migration audit table

```sql
CREATE TABLE migration_audit_log (
    id bigserial PRIMARY KEY,
    migration_name text NOT NULL,
    entity_table text NOT NULL,
    entity_id uuid NOT NULL,
    old_value jsonb,
    new_value jsonb,
    transformed_at timestamptz NOT NULL DEFAULT now(),
    transformed_by text NOT NULL
);
```

Untuk semua migration tidak perlu audit row-level penuh. Tetapi untuk perubahan domain-critical, ini bisa sangat penting.

### Error capture table

```sql
CREATE TABLE migration_error_log (
    id bigserial PRIMARY KEY,
    migration_name text NOT NULL,
    entity_table text NOT NULL,
    entity_id uuid,
    error_code text NOT NULL,
    error_detail jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

Daripada job berhenti total karena satu row buruk, row error bisa dicatat dan ditangani.

---

## 24. Migration dan CDC / Outbox / Downstream Consumers

Jika sistem memakai CDC/logical replication/outbox, schema migration mempengaruhi consumer.

Risiko:

- drop column memecahkan deserializer,
- rename field membuat consumer kehilangan data,
- enum value baru tidak dikenal,
- JSON payload berubah tanpa versioning,
- outbox event schema tidak compatible,
- logical replication publication tidak include table baru,
- replica identity tidak cukup untuk update/delete.

### Event compatibility rule

Database schema boleh berubah internal, tetapi event contract harus versioned.

Contoh outbox payload:

```json
{
  "eventType": "CaseStatusChanged",
  "eventVersion": 2,
  "caseId": "...",
  "oldStatus": "PENDING_REVIEW",
  "newLifecycleStatus": "UNDER_REVIEW"
}
```

Jangan diam-diam mengubah payload versi lama.

### Expand-contract untuk event

```text
1. Producer mulai mengirim field baru sambil tetap mengirim field lama.
2. Consumer deploy support field baru.
3. Producer switch ke field baru.
4. Field lama dihapus setelah semua consumer aman.
```

Sama seperti database schema.

---

## 25. View sebagai Compatibility Layer

Kadang view bisa membantu migration.

Misal tabel baru:

```sql
CREATE TABLE enforcement_case_v2 (
    id uuid PRIMARY KEY,
    lifecycle_status text NOT NULL
);
```

View legacy:

```sql
CREATE VIEW enforcement_case_legacy AS
SELECT
    id,
    lifecycle_status AS status
FROM enforcement_case_v2;
```

Kegunaan:

- menjaga read compatibility,
- memudahkan report lama,
- memisahkan physical schema dari logical contract.

Risiko:

- write melalui view tidak selalu sederhana,
- permission bisa membingungkan,
- planner behavior perlu diuji,
- ORM mapping ke view bisa terbatas,
- dependency chain bisa menyulitkan drop/alter.

View adalah alat, bukan solusi universal.

---

## 26. Shadow Table dan Dual-write Migration

Untuk perubahan besar, kadang kolom baru tidak cukup. Butuh tabel baru.

Contoh dari:

```sql
case_assignment(case_id, assignee_id, assigned_at)
```

ke model historis:

```sql
case_assignment_history(
    id,
    case_id,
    assignee_id,
    valid_from,
    valid_to,
    assigned_by,
    reason
)
```

Pattern:

```text
1. Create new shadow table.
2. App dual-write old + new table.
3. Backfill new table from old.
4. Verify consistency.
5. Read path switch to new table.
6. Stop writing old.
7. Keep old for rollback window.
8. Drop/archive old.
```

### Consistency check

```sql
SELECT count(*) FROM case_assignment;
SELECT count(DISTINCT case_id) FROM case_assignment_history WHERE valid_to IS NULL;
```

More precise:

```sql
SELECT a.case_id
FROM case_assignment a
LEFT JOIN case_assignment_history h
  ON h.case_id = a.case_id
 AND h.assignee_id = a.assignee_id
 AND h.valid_to IS NULL
WHERE h.case_id IS NULL;
```

### Dual-write risk

Dual-write dari aplikasi bisa gagal sebagian jika tidak dalam satu DB transaction. Jika dua tabel di database sama, bungkus dalam satu transaksi.

Jika target beda database/service, gunakan outbox/eventual consistency.

---

## 27. Online Table Rewrite dengan Copy-and-swap

Untuk perubahan fisik besar, kadang strategi terbaik adalah membuat tabel baru, copy data bertahap, lalu switch.

Pattern:

```text
1. Create new table with desired schema.
2. Copy historical data in batches.
3. Capture ongoing changes via dual-write or trigger.
4. Verify row counts/checksums.
5. Brief maintenance window for cutover.
6. Rename/swap.
7. Keep old table temporarily.
```

Risiko:

- complex,
- storage dobel,
- trigger overhead,
- consistency hard,
- FK/dependency sulit,
- sequence/identity handling,
- permissions/indexes/triggers/views harus disalin.

Ini biasanya untuk tabel sangat besar atau perubahan yang tidak bisa dilakukan online dengan sederhana.

---

## 28. Migration Safety Guardrails

### 28.1 Always set timeouts

```sql
SET lock_timeout = '2s';
SET statement_timeout = '5min';
```

Untuk backfill batch:

```sql
SET lock_timeout = '500ms';
SET statement_timeout = '30s';
```

### 28.2 Avoid unbounded update/delete

Jangan:

```sql
DELETE FROM case_event WHERE created_at < now() - interval '7 years';
```

Gunakan partition detach/drop atau batch delete:

```sql
WITH batch AS (
    SELECT id
    FROM case_event
    WHERE created_at < now() - interval '7 years'
    ORDER BY created_at, id
    LIMIT 1000
)
DELETE FROM case_event e
USING batch
WHERE e.id = batch.id;
```

### 28.3 Avoid long transaction migration

Jangan bungkus backfill jutaan row dalam satu transaction besar.

### 28.4 Always know affected row count

Sebelum update:

```sql
SELECT count(*)
FROM enforcement_case
WHERE lifecycle_status IS NULL;
```

Jika count mahal, ambil estimasi atau sample.

### 28.5 Test with production-like data

Staging kosong tidak membuktikan apa-apa.

Minimal test:

- row count besar,
- index mirip production,
- data skew mirip production,
- concurrent traffic simulation,
- autovacuum setting mirip,
- replication jika relevan.

---

## 29. Observability Selama Migration

Sebelum migration, pantau:

```sql
SELECT
    count(*) FILTER (WHERE state = 'active') AS active,
    count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
    count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting_lock
FROM pg_stat_activity;
```

Lock:

```sql
SELECT
    blocked.pid AS blocked_pid,
    blocked.application_name AS blocked_app,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.application_name AS blocking_app,
    blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks
  ON blocked_locks.pid = blocked.pid
JOIN pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
 AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
 AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
 AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
 AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
 AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
 AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
 AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
 AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
 AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
 AND blocking_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocking
  ON blocking.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted
  AND blocking_locks.granted;
```

Replication:

```sql
SELECT
    application_name,
    state,
    sync_state,
    write_lag,
    flush_lag,
    replay_lag
FROM pg_stat_replication;
```

Table stats:

```sql
SELECT
    relname,
    n_live_tup,
    n_dead_tup,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = 'enforcement_case';
```

Index build progress:

```sql
SELECT *
FROM pg_stat_progress_create_index;
```

Vacuum progress:

```sql
SELECT *
FROM pg_stat_progress_vacuum;
```

---

## 30. Migration Review Checklist

Sebelum merge migration:

```text
Schema compatibility
[ ] Apakah app lama tetap jalan setelah migration?
[ ] Apakah app baru bisa jalan sebelum data backfill selesai?
[ ] Apakah rolling deploy aman?
[ ] Apakah rollback app aman?

Locking
[ ] Operasi DDL mengambil lock apa?
[ ] Berapa lama lock diperkirakan?
[ ] Apakah lock_timeout diset?
[ ] Apakah ada transaction lama yang perlu dihindari?

Data volume
[ ] Berapa row terdampak?
[ ] Apakah ada table rewrite?
[ ] Apakah backfill dibatch?
[ ] Apakah batch idempotent?

Indexes
[ ] Apakah index dibuat CONCURRENTLY bila perlu?
[ ] Apakah migration tool mendukung non-transactional migration?
[ ] Apakah index baru benar-benar sesuai query shape?
[ ] Apakah index lama akan dihapus hanya setelah observasi?

Constraints
[ ] Apakah constraint ditambah dengan NOT VALID bila tabel besar?
[ ] Apakah data lama sudah diverifikasi?
[ ] Apakah constraint violation dipetakan di aplikasi?

Replication/HA
[ ] Apakah migration menghasilkan WAL besar?
[ ] Apakah replication lag dimonitor?
[ ] Apakah failover saat migration aman?
[ ] Apakah read replica bisa membaca schema baru?

Java integration
[ ] Apakah Hibernate/JPA mapping compatible?
[ ] Apakah prepared statement/session state aman?
[ ] Apakah pool perlu restart setelah perubahan tertentu?
[ ] Apakah enum mapping tolerant?

Downstream
[ ] Apakah report/ETL/CDC terdampak?
[ ] Apakah outbox event contract berubah?
[ ] Apakah consumer sudah compatible?

Rollback/roll-forward
[ ] Apa yang dilakukan jika migration gagal sebelum selesai?
[ ] Apa yang dilakukan jika app deploy gagal setelah migration?
[ ] Apa yang dilakukan jika backfill menemukan data invalid?
[ ] Apakah destructive step ditunda?

Observability
[ ] Metric apa yang dipantau saat migration?
[ ] Query diagnosis sudah disiapkan?
[ ] Alert lock/lag/error sudah ada?
[ ] Migration progress terlihat?
```

---

## 31. Anti-pattern Migration yang Sering Menyebabkan Insiden

### Anti-pattern 1 — Rename langsung saat rolling deploy

```sql
ALTER TABLE x RENAME COLUMN old_name TO new_name;
```

Masalah: app lama rusak.

### Anti-pattern 2 — Drop terlalu cepat

```sql
ALTER TABLE x DROP COLUMN old_column;
```

Masalah: rollback app tidak mungkin.

### Anti-pattern 3 — Backfill satu transaksi besar

```sql
UPDATE huge_table SET new_col = transform(old_col);
```

Masalah: WAL, lock, bloat, lag.

### Anti-pattern 4 — CREATE INDEX biasa di tabel aktif

```sql
CREATE INDEX idx ON huge_table (col);
```

Masalah: write blocking.

### Anti-pattern 5 — Migration tanpa timeout

Masalah: lock queue bisa membuat aplikasi terlihat down.

### Anti-pattern 6 — Constraint langsung validasi tabel besar

```sql
ALTER TABLE huge_table ADD CONSTRAINT ... CHECK (...);
```

Masalah: scan/lock impact tak dipahami.

### Anti-pattern 7 — App baru mengasumsikan backfill selesai

Masalah: null/old data membuat bug.

### Anti-pattern 8 — Enum value baru tanpa consumer compatibility

Masalah: Java enum deserialization gagal.

### Anti-pattern 9 — Migration tool dianggap safety net penuh

Masalah: Flyway/Liquibase tidak menggantikan operational reasoning.

### Anti-pattern 10 — Tidak ada restore drill

Masalah: destructive migration salah hanya bisa dipulihkan dari backup yang belum pernah diuji.

---

## 32. Case Study: Menambah Idempotency Key ke Tabel Payment/Action

Misal ada tabel:

```sql
CREATE TABLE enforcement_action (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL,
    action_type text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

Kamu ingin menambah idempotency untuk mencegah duplicate action dari retry API.

Target invariant:

```text
Untuk tenant + idempotency_key yang sama, hanya boleh ada satu action aktif.
```

### Step 1 — Add nullable column

```sql
ALTER TABLE enforcement_action
ADD COLUMN tenant_id uuid;

ALTER TABLE enforcement_action
ADD COLUMN idempotency_key text;
```

Jika `tenant_id` sebenarnya bisa diturunkan dari case, backfill nanti.

### Step 2 — App mulai menulis tenant_id dan idempotency_key untuk action baru

```sql
INSERT INTO enforcement_action (
    id, tenant_id, case_id, action_type, idempotency_key
)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT DO NOTHING;
```

Tapi belum ada unique index, jadi conflict belum efektif.

### Step 3 — Backfill tenant_id

```sql
WITH batch AS (
    SELECT a.id, c.tenant_id
    FROM enforcement_action a
    JOIN enforcement_case c ON c.id = a.case_id
    WHERE a.tenant_id IS NULL
    ORDER BY a.created_at, a.id
    LIMIT 1000
)
UPDATE enforcement_action a
SET tenant_id = batch.tenant_id
FROM batch
WHERE a.id = batch.id;
```

### Step 4 — Create partial unique index concurrently

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_action_idempotency
ON enforcement_action (tenant_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
```

Sebelum itu cek duplicate:

```sql
SELECT tenant_id, idempotency_key, count(*)
FROM enforcement_action
WHERE idempotency_key IS NOT NULL
GROUP BY tenant_id, idempotency_key
HAVING count(*) > 1;
```

### Step 5 — App memakai ON CONFLICT sesuai constraint/index

```sql
INSERT INTO enforcement_action (
    id, tenant_id, case_id, action_type, idempotency_key
)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (tenant_id, idempotency_key)
WHERE idempotency_key IS NOT NULL
DO NOTHING;
```

Atau gunakan `DO UPDATE` bila perlu return existing row.

### Step 6 — Add constraints jika required

Jika idempotency wajib untuk action tertentu, gunakan partial constraint/check logic sesuai domain.

---

## 33. Case Study: Mengubah Status Workflow untuk Enforcement Lifecycle

Sistem lama:

```text
status:
- NEW
- IN_PROGRESS
- DONE
```

Sistem baru:

```text
lifecycle_status:
- DRAFT
- SUBMITTED
- TRIAGED
- UNDER_REVIEW
- ESCALATED
- CLOSED
```

Ini bukan rename. Ini semantic migration.

### Risiko

- `IN_PROGRESS` bisa map ke beberapa state baru.
- Historical meaning bisa ambiguity.
- SLA report bisa berubah.
- Audit trail bisa tidak lagi cocok.
- Java enum lama tidak tahu value baru.

### Pattern

1. Tambah kolom baru.
2. Buat mapping table eksplisit:

```sql
CREATE TABLE case_status_migration_mapping (
    old_status text PRIMARY KEY,
    new_status text NOT NULL,
    mapping_reason text NOT NULL
);
```

3. Isi mapping yang disetujui domain owner:

```sql
INSERT INTO case_status_migration_mapping
(old_status, new_status, mapping_reason)
VALUES
('NEW', 'DRAFT', 'Legacy NEW maps to DRAFT before first submission'),
('DONE', 'CLOSED', 'Legacy DONE maps to CLOSED');
```

Untuk ambiguous:

```sql
-- IN_PROGRESS requires case-by-case derivation
```

4. Backfill deterministic rows.
5. Capture ambiguous rows.
6. Manual/domain workflow untuk ambiguous rows.
7. Validate.
8. Switch app.

Top-tier decision:

```text
Tidak semua migration harus full automatic jika domain semantics tidak deterministik.
```

---

## 34. Operational Runbook: Migration Menyebabkan Lock Pile-up

Gejala:

- API latency naik tajam,
- request timeout,
- DB CPU mungkin rendah,
- banyak session wait `Lock`,
- migration session sedang menunggu lock.

### Diagnosis

```sql
SELECT
    pid,
    state,
    wait_event_type,
    wait_event,
    now() - query_start AS query_age,
    left(query, 200) AS query
FROM pg_stat_activity
WHERE wait_event_type = 'Lock'
ORDER BY query_start;
```

Cari blocker:

```sql
SELECT
    blocked.pid AS blocked_pid,
    blocking.pid AS blocking_pid,
    now() - blocking.xact_start AS blocking_xact_age,
    blocking.state AS blocking_state,
    left(blocking.query, 200) AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid
JOIN pg_locks kl
  ON kl.locktype = bl.locktype
 AND kl.database IS NOT DISTINCT FROM bl.database
 AND kl.relation IS NOT DISTINCT FROM bl.relation
 AND kl.pid <> bl.pid
JOIN pg_stat_activity blocking ON blocking.pid = kl.pid
WHERE NOT bl.granted
  AND kl.granted;
```

### Immediate actions

1. Jika migration menunggu lock dan membuat queue, cancel migration:

```sql
SELECT pg_cancel_backend(<migration_pid>);
```

2. Jika tidak berhenti, terminate dengan hati-hati:

```sql
SELECT pg_terminate_backend(<migration_pid>);
```

3. Jangan langsung kill blocker tanpa tahu siapa/apa. Bisa jadi blocker adalah transaksi bisnis penting.

4. Setelah stabil, evaluasi:

- lock timeout kenapa tidak bekerja?
- ada idle transaction?
- migration dijalankan di jam traffic tinggi?
- DDL terlalu besar?
- butuh split migration?

---

## 35. Operational Runbook: Backfill Membuat Replication Lag

Gejala:

- replica lag naik,
- read-after-write bug,
- WAL disk naik,
- failover risk meningkat.

### Diagnosis

```sql
SELECT
    application_name,
    state,
    sync_state,
    write_lag,
    flush_lag,
    replay_lag,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS byte_lag
FROM pg_stat_replication;
```

### Immediate actions

1. Pause backfill job.
2. Tunggu replica catch up.
3. Kurangi batch size.
4. Tambah sleep antar batch.
5. Jalankan di window lebih sepi.
6. Cek apakah index tambahan menyebabkan update lebih mahal.
7. Cek slot/WAL retention.

### Prevention

Backfill job harus punya throttle:

```text
if lag > threshold:
    pause
else:
    continue
```

---

## 36. Operational Runbook: CREATE INDEX CONCURRENTLY Gagal

Gejala:

- migration gagal,
- ada invalid index,
- query belum memakai index,
- migration tool menandai failed.

Cek invalid index:

```sql
SELECT
    n.nspname AS schema_name,
    c.relname AS index_name,
    i.indisvalid,
    i.indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT i.indisvalid
   OR NOT i.indisready;
```

Drop invalid index:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_name;
```

Lalu rerun setelah penyebab diperbaiki.

Untuk unique index, penyebab umum adalah duplicate data masuk selama build atau sudah ada sebelumnya.

---

## 37. Production Migration Template

Gunakan template berpikir berikut untuk setiap migration besar.

```markdown
# Migration Plan: <name>

## Goal
Apa tujuan domain/technical dari migration ini?

## Current State
Schema/data/app behavior sekarang.

## Target State
Schema/data/app behavior setelah selesai.

## Compatibility
- App lama dengan schema baru: aman/tidak?
- App baru dengan data lama: aman/tidak?
- Rolling deploy: aman/tidak?
- App rollback: aman/tidak?

## Steps
1. Expand schema
2. Deploy compatibility app
3. Backfill
4. Validate
5. Switch read/write path
6. Contract schema

## Locking Risk
DDL apa mengambil lock apa?
Apa timeout-nya?

## Data Risk
Berapa row terdampak?
Apakah transformation deterministic?
Bagaimana invalid data dicatat?

## Performance Risk
WAL, bloat, replication lag, query plan change.

## Observability
Metric/query yang dipantau.

## Rollback / Roll-forward
Apa tindakan jika gagal di setiap step?

## Owner Approval
Domain owner, DBA/platform owner, service owner.
```

---

## 38. Checklist Skill yang Harus Kamu Kuasai Setelah Part Ini

Setelah bagian ini, kamu harus bisa:

1. Menjelaskan kenapa transactional DDL tidak otomatis zero-downtime.
2. Membedakan migration metadata-only, validation, index build, backfill, rewrite, dan destructive.
3. Mendesain expand-contract migration.
4. Menambah nullable column secara aman.
5. Menambah non-null invariant secara bertahap.
6. Menambah constraint dengan `NOT VALID` dan `VALIDATE CONSTRAINT`.
7. Menambah index dengan `CREATE INDEX CONCURRENTLY`.
8. Mengetahui kapan migration tool harus non-transactional.
9. Mendesain batch backfill yang idempotent.
10. Mengontrol replication lag akibat backfill.
11. Menunda destructive migration sampai rollback window aman.
12. Mengevaluasi rename/drop/type-change sebagai compatibility problem.
13. Menghubungkan migration dengan Java rolling deploy.
14. Menghubungkan migration dengan Hibernate/JPA enum/query mapping.
15. Membuat runbook lock pile-up.
16. Membuat runbook failed concurrent index.
17. Membuat migration plan yang bisa direview secara arsitektural.

---

## 39. Ringkasan Mental Model

Schema migration di PostgreSQL bukan aktivitas administratif. Ia adalah perubahan state sistem produksi.

Mental model paling penting:

```text
Zero-downtime migration = sequence of compatible intermediate states.
```

DDL harus dipahami dari sisi:

```text
lock strength + lock duration + table size + traffic + app compatibility
```

Backfill harus dipahami dari sisi:

```text
batching + idempotency + WAL + bloat + replication lag + observability
```

Contract/destructive step harus dipahami dari sisi:

```text
rollback window + downstream dependency + audit + restore capability
```

Untuk Java engineer, aturan paling praktis:

```text
Deploy schema expand before app needs it.
Deploy app compatibility before data shape changes.
Backfill safely.
Validate objectively.
Only then contract schema.
```

Engineer biasa bertanya:

```text
SQL migration-nya apa?
```

Engineer senior bertanya:

```text
Apa semua intermediate state aman untuk app lama, app baru, data lama, data baru, replica, consumer, rollback, dan operasi produksi?
```

Itulah perbedaan antara sekadar memakai PostgreSQL dan mengoperasikan PostgreSQL sebagai bagian dari sistem produksi yang benar.

---

## Status Seri

Selesai: **Part 030 dari 034**.

Seri belum selesai. Bagian berikutnya:

```text
Part 031 — PostgreSQL dengan Java: JDBC, HikariCP, Hibernate, jOOQ, Spring Data
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Security: Roles, Privileges, RLS, TLS, Secrets, dan Auditability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-031.md">Part 031 — PostgreSQL dengan Java: JDBC, HikariCP, Hibernate, jOOQ, dan Spring Data ➡️</a>
</div>

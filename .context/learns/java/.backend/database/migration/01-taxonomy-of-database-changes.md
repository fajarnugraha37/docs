# Part 1 — Taxonomy of Database Changes

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `01-taxonomy-of-database-changes.md`  
**Target pembaca:** Java engineer yang sudah memahami JDBC, JPA/Hibernate, MyBatis, SQL dasar-menengah, deployment, dan ingin naik ke level production-grade database change engineering.  
**Java scope:** Java 8 sampai Java 25.  
**Tools context:** Flyway, Liquibase, Spring Boot, Jakarta EE, plain Java, CI/CD, container/Kubernetes, dan database umum seperti PostgreSQL, Oracle, MySQL/MariaDB, SQL Server.

---

## 0. Tujuan Bagian Ini

Di Part 0 kita sudah membingkai bahwa database migration bukan sekadar “menjalankan file SQL”. Database adalah **shared mutable state** yang mengikat beberapa versi aplikasi, batch job, integrasi eksternal, report, audit trail, dan proses operasional.

Part 1 ini membahas **taxonomy of database changes**: klasifikasi perubahan database. Ini penting karena banyak kegagalan migration bukan terjadi karena engineer tidak bisa SQL, tetapi karena semua perubahan diperlakukan sama.

Contoh:

- menambah nullable column,
- mengganti tipe data kolom,
- mengisi ulang lookup table,
- membuat index besar di table production,
- backfill 100 juta row,
- mengganti struktur permission,
- membuat stored procedure,
- memperbaiki data corrupt,
- bootstrap tenant baru,
- menambah constraint `NOT NULL`,
- menghapus kolom lama,
- rename enum/status,
- membuat admin user awal,
- mengubah materialized view,
- memindahkan data antar table.

Semua itu sering disebut “migration”, tetapi risikonya berbeda, strategi deployment-nya berbeda, review checklist-nya berbeda, rollback model-nya berbeda, dan ownership-nya berbeda.

Tujuan bagian ini adalah membangun peta mental agar setiap perubahan database bisa dijawab dengan pertanyaan:

> “Perubahan ini termasuk kategori apa, risikonya di mana, apakah bisa forward-compatible, apakah perlu backfill, apakah aman dijalankan saat traffic aktif, apakah boleh rollback, dan apakah data ini deterministic?”

---

## 1. Mental Model Utama: Database Change Bukan Satu Dimensi

Database change minimal punya beberapa dimensi:

1. **Apa yang berubah?**  
   Schema, data, object database, permission, index, constraint, seed, metadata, atau konfigurasi.

2. **Siapa yang bergantung pada perubahan itu?**  
   Satu service, banyak service, batch job, reporting system, ETL, dashboard, external API, support user, atau regulatory audit.

3. **Kapan perubahan itu aman digunakan?**  
   Sebelum aplikasi baru deploy, sesudah aplikasi baru deploy, setelah backfill selesai, atau setelah semua consumer pindah.

4. **Apakah perubahan itu reversible?**  
   Bisa di-drop balik, bisa rollback dengan data loss, bisa rollback secara teknis tapi tidak secara bisnis, atau hanya aman roll-forward.

5. **Apakah perubahan itu blocking?**  
   Cepat dan metadata-only, atau memindai/mengunci table besar.

6. **Apakah perubahan itu deterministic?**  
   Hasilnya sama di semua environment, atau tergantung data existing, waktu, sequence, environment, tenant, konfigurasi, atau state eksternal.

7. **Apakah perubahan itu harus audit-ready?**  
   Ada approval, checksum, evidence, migration history, dan hasil validasi; atau hanya eksperimen lokal.

Tool seperti Flyway dan Liquibase membantu mengeksekusi dan mencatat perubahan. Flyway, misalnya, menggunakan schema history table untuk melacak migration yang sudah diterapkan, termasuk kapan dan oleh siapa. Liquibase menggunakan changelog/changeset sebagai ledger text-based untuk mencatat perubahan database secara berurutan. Tetapi tool tidak otomatis membuat desain perubahan menjadi aman. Engineer tetap harus memahami kategori perubahan.

---

## 2. Klasifikasi Level Tertinggi

Secara kasar, perubahan database bisa dibagi menjadi sembilan keluarga besar:

1. **Schema structure changes**  
   Perubahan bentuk struktur data: table, column, data type, constraint, foreign key, partition, sequence, identity.

2. **Database object changes**  
   Perubahan object eksekusi atau object turunan: view, materialized view, function, stored procedure, trigger, package, synonym.

3. **Index and performance structure changes**  
   Perubahan struktur akses data: index, statistics, partition index, full-text index, covering index.

4. **Data changes**  
   Perubahan isi data: correction, backfill, normalization, denormalization, migration antar table.

5. **Seed changes**  
   Data awal atau data referensi: lookup, master data, role, permission, feature flag, tenant default.

6. **Security and access changes**  
   User database, role, grant, revoke, row-level security policy, encryption metadata, privilege separation.

7. **Operational metadata changes**  
   Migration metadata, version marker, tenant registry, job checkpoint, release marker, audit metadata.

8. **Environment bootstrap changes**  
   Perubahan untuk membuat environment siap dipakai: local dev, test, integration, staging, ephemeral review app.

9. **Emergency or repair changes**  
   Hotfix, data repair, checksum repair, failed migration recovery, production-only correction.

Di sistem kecil, semua ini sering dicampur dalam satu folder `db/migration`. Di sistem besar, minimal harus ada perbedaan policy:

- mana yang boleh otomatis saat app startup,
- mana yang harus lewat pipeline approval,
- mana yang harus dijalankan sebagai batch job,
- mana yang perlu pre-flight check,
- mana yang hanya boleh di maintenance window,
- mana yang harus punya rollback script,
- mana yang hanya boleh roll-forward.

---

## 3. DDL Migration: Perubahan Struktur Schema

DDL migration adalah perubahan terhadap struktur database. DDL biasanya mencakup `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`, dan sejenisnya.

Contoh:

```sql
ALTER TABLE customer ADD COLUMN risk_level VARCHAR(20);

CREATE TABLE customer_risk_assessment (
    id BIGINT PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    assessed_at TIMESTAMP NOT NULL
);

ALTER TABLE customer_risk_assessment
ADD CONSTRAINT fk_customer_risk_customer
FOREIGN KEY (customer_id) REFERENCES customer(id);
```

### 3.1 Subkategori DDL

DDL sendiri masih terlalu luas. Kita perlu pecah lagi.

#### 3.1.1 Additive DDL

Perubahan yang menambah object tanpa merusak contract lama.

Contoh:

- tambah nullable column,
- tambah table baru,
- tambah index baru,
- tambah view baru,
- tambah sequence baru,
- tambah enum/status table baru yang belum dipakai,
- tambah constraint yang belum divalidasi.

Biasanya ini paling aman untuk zero-downtime deployment karena aplikasi lama masih bisa berjalan.

Contoh aman:

```sql
ALTER TABLE application ADD COLUMN external_reference_no VARCHAR(100);
```

Aplikasi lama tidak tahu kolom ini ada. Query lama tetap jalan. Insert lama tetap jalan karena kolom nullable.

Tapi “additive” tidak selalu aman. Menambah index di table besar bisa blocking atau memakan resource. Menambah nullable column dengan default tertentu di beberapa database bisa rewrite table. Menambah foreign key bisa scan data existing. Jadi additive secara contract belum tentu ringan secara operasional.

#### 3.1.2 Contract-breaking DDL

Perubahan yang memutus kompatibilitas aplikasi lama.

Contoh:

- drop column,
- rename column,
- rename table,
- ubah tipe data yang tidak kompatibel,
- jadikan nullable column menjadi `NOT NULL`,
- tambah constraint yang bisa menolak write lama,
- hapus status/lookup yang masih dipakai,
- ubah primary key,
- ubah semantic foreign key.

Contoh berbahaya:

```sql
ALTER TABLE customer DROP COLUMN full_name;
```

Jika versi aplikasi yang masih membaca `full_name` masih hidup, aplikasi akan error. Ini sering terjadi di rolling deployment, blue/green deployment, autoscaling, batch job lama, report query lama, atau service lain yang masih memakai schema lama.

#### 3.1.3 Metadata-only DDL

Beberapa DDL hanya mengubah metadata database dan relatif cepat.

Contoh tergantung database:

- rename constraint,
- add nullable column tanpa default,
- comment on column,
- create synonym,
- create view kecil.

Namun jangan mengasumsikan metadata-only tanpa tahu database engine dan versinya. PostgreSQL, Oracle, MySQL, dan SQL Server punya perilaku berbeda. Bahkan versi database yang berbeda bisa punya optimasi berbeda.

#### 3.1.4 Data-rewriting DDL

DDL yang menyebabkan database membaca/menulis ulang data existing.

Contoh:

- ubah tipe data kolom besar,
- add column dengan non-null default pada engine tertentu,
- rebuild table,
- move table/tablespace,
- shrink/move LOB,
- change compression,
- change partitioning,
- create index besar,
- validate constraint terhadap data besar.

Ini bukan sekadar schema change; ini workload production. Ia bisa:

- mengunci table,
- memenuhi undo/redo/WAL,
- menaikkan replication lag,
- membuat query lambat,
- meningkatkan CPU/I/O,
- menimbulkan deadlock,
- membuat deployment timeout.

#### 3.1.5 Destructive DDL

Perubahan yang menghapus data atau object.

Contoh:

```sql
DROP TABLE old_payment_event;
ALTER TABLE user_profile DROP COLUMN legacy_identifier;
TRUNCATE TABLE temp_import_result;
```

Destructive DDL harus diperlakukan sebagai tahap akhir, bukan tahap awal. Di production-grade system, destructive change biasanya masuk fase **contract** dari expand/contract pattern, setelah:

1. tidak ada aplikasi yang membaca object lama,
2. tidak ada write baru ke object lama,
3. data sudah dimigrasi,
4. monitoring menunjukkan object lama tidak digunakan,
5. backup/restore strategy jelas,
6. approval eksplisit.

---

## 4. DML Migration: Perubahan Isi Data

DML migration mengubah row data. Ini bisa jauh lebih berbahaya daripada DDL sederhana karena hasilnya sering tidak mudah dikembalikan.

Contoh:

```sql
UPDATE application
SET status = 'SUBMITTED'
WHERE status = 'PENDING_SUBMISSION';
```

Atau:

```sql
INSERT INTO customer_risk_assessment (id, customer_id, risk_level, assessed_at)
SELECT nextval('customer_risk_assessment_seq'), id, 'LOW', CURRENT_TIMESTAMP
FROM customer
WHERE risk_level IS NULL;
```

### 4.1 Subkategori DML Migration

#### 4.1.1 Data correction

Memperbaiki data yang salah.

Contoh:

- salah mapping status,
- salah timezone,
- duplicate reference,
- typo master data,
- invalid foreign key karena bug lama,
- nilai nullable padahal seharusnya mandatory.

Karakteristik:

- sering production-specific,
- butuh evidence,
- butuh before/after query,
- harus diketahui business owner,
- rollback bisa sulit jika original value tidak disimpan.

Pattern yang lebih aman:

```sql
CREATE TABLE data_fix_2026_06_17_application_status_backup AS
SELECT id, status
FROM application
WHERE status = 'PENDING_SUBMISSION';

UPDATE application
SET status = 'SUBMITTED'
WHERE status = 'PENDING_SUBMISSION';
```

Tetapi membuat backup table juga punya konsekuensi: storage, permission, lifecycle, dan data retention.

#### 4.1.2 Backfill

Mengisi data baru dari data lama.

Contoh:

- setelah menambah kolom `normalized_email`, isi dari `email`,
- setelah membuat table baru, copy data dari table lama,
- setelah split `full_name`, isi `first_name` dan `last_name`,
- setelah menambah `tenant_id`, isi semua row lama.

Backfill adalah salah satu jenis migration paling penting.

Contoh sederhana:

```sql
UPDATE user_account
SET normalized_email = LOWER(TRIM(email))
WHERE normalized_email IS NULL;
```

Untuk table kecil, ini mungkin cukup. Untuk table besar, ini bisa berbahaya karena satu transaction besar bisa:

- memegang lock terlalu lama,
- membuat undo/redo/WAL besar,
- memperlambat replication,
- membuat vacuum/cleanup berat,
- gagal di tengah tanpa checkpoint.

Untuk table besar, backfill sering lebih baik dijalankan sebagai job terkontrol, bukan sebagai satu migration SQL tunggal.

#### 4.1.3 Data reshape

Mengubah bentuk representasi data.

Contoh:

- satu kolom JSON menjadi table relational,
- satu table besar dipecah menjadi beberapa table,
- beberapa table digabung,
- enum string menjadi foreign key ke lookup table,
- denormalized text menjadi structured columns.

Data reshape biasanya butuh choreography:

1. tambah struktur baru,
2. dual-write,
3. backfill,
4. compare old vs new,
5. switch read,
6. stop write lama,
7. drop struktur lama.

#### 4.1.4 Data derivation

Mengisi data hasil perhitungan.

Contoh:

- `total_amount` dihitung dari line items,
- `risk_score` dihitung dari rules,
- `case_age_days` dihitung dari created date,
- `latest_activity_at` dihitung dari audit/activity table.

Bahaya data derivation adalah rule bisa berubah. Migration harus menyebut versi rule yang dipakai. Jika tidak, engineer masa depan tidak tahu mengapa data dihitung seperti itu.

#### 4.1.5 Data deletion/purge

Menghapus data.

Contoh:

```sql
DELETE FROM audit_log WHERE created_at < DATE '2020-01-01';
```

Ini terlihat sederhana, tetapi di production bisa sangat berat. Delete besar bisa:

- mengunci banyak row,
- membuat undo/redo/WAL besar,
- menyebabkan table/index bloat,
- memperlambat replica,
- melanggar retention policy,
- menghapus evidence audit.

Untuk data purge, taxonomy harus menanyakan:

- Apakah retention policy mengizinkan?
- Apakah ada legal hold?
- Apakah data sudah diarsip?
- Apakah delete harus batch?
- Apakah foreign key cascade akan meledak?
- Apakah ada audit evidence?

---

## 5. Reference Data, Master Data, dan Seed Data

Seed data sering dianggap sebagai “data.sql”. Di sistem production, ini terlalu sederhana.

Kita perlu membedakan beberapa jenis data.

### 5.1 Reference Data

Reference data adalah data relatif stabil yang dipakai untuk validasi atau pilihan sistem.

Contoh:

- country code,
- currency code,
- application status,
- case priority,
- document type,
- gender code,
- risk category,
- payment method,
- notification template type.

Karakteristik:

- sering kecil,
- sering dipakai foreign key,
- harus konsisten antar environment,
- kadang berubah karena regulasi/bisnis,
- bisa punya effective date,
- tidak boleh sembarang dihapus.

Contoh seed:

```sql
INSERT INTO case_priority (code, name, sort_order)
VALUES ('HIGH', 'High', 1);
```

Untuk production-grade seed, insert biasa sering tidak cukup. Jika migration dijalankan ulang, insert duplicate bisa gagal. Maka perlu idempotent seed.

Contoh PostgreSQL:

```sql
INSERT INTO case_priority (code, name, sort_order)
VALUES ('HIGH', 'High', 1)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order;
```

Contoh Oracle `MERGE`:

```sql
MERGE INTO case_priority target
USING (
    SELECT 'HIGH' AS code, 'High' AS name, 1 AS sort_order FROM dual
) source
ON (target.code = source.code)
WHEN MATCHED THEN
    UPDATE SET target.name = source.name,
               target.sort_order = source.sort_order
WHEN NOT MATCHED THEN
    INSERT (code, name, sort_order)
    VALUES (source.code, source.name, source.sort_order);
```

### 5.2 Master Data

Master data adalah data inti bisnis yang kadang terlihat seperti reference data, tetapi lebih hidup dan lebih kompleks.

Contoh:

- organization,
- agency,
- product,
- license type,
- user group,
- branch,
- regulatory category,
- service channel.

Karakteristik:

- bisa diubah oleh admin/business user,
- punya ownership bisnis,
- punya lifecycle,
- kadang environment-specific,
- bisa punya audit trail,
- kadang tidak boleh di-overwrite oleh seed.

Bahaya: engineer memasukkan master data mutable sebagai seed repeatable. Akibatnya perubahan manual oleh business user bisa tertimpa setiap deploy.

Rule penting:

> Jika data bisa dikelola oleh user bisnis di production, jangan sembarang dianggap immutable seed.

### 5.3 Bootstrap Data

Bootstrap data adalah data minimum agar sistem bisa start dan digunakan.

Contoh:

- default admin role,
- default permission matrix,
- system user,
- default tenant,
- default workflow state,
- default configuration group,
- initial feature flag.

Bootstrap data sering mandatory. Tanpa data ini, aplikasi bisa start tetapi tidak usable.

Pertanyaan penting:

- Apakah bootstrap data sama untuk semua environment?
- Apakah ada secret/password? Jika iya, jangan taruh plain di migration.
- Apakah data ini boleh berubah setelah production live?
- Apakah migration harus fail jika data sudah ada tetapi berbeda?
- Apakah perlu audit owner?

### 5.4 Test Fixture Data

Test fixture adalah data untuk test.

Contoh:

- sample user,
- dummy order,
- synthetic case,
- test applicant,
- mock agency.

Test fixture tidak boleh bocor ke production migration.

Anti-pattern:

```sql
INSERT INTO user_account (username, password_hash, role)
VALUES ('test-admin', '...', 'ADMIN');
```

Jika file ini masuk production, risiko security-nya besar.

Pisahkan:

- production migration,
- local dev seed,
- integration test fixture,
- performance test dataset,
- demo dataset.

Spring Boot sendiri menyediakan mekanisme SQL initialization seperti `schema.sql` dan `data.sql`, tetapi ketika memakai Flyway atau Liquibase, strategi utama schema/data initialization sebaiknya tidak dicampur secara sembarangan. Dalam project serius, migration tool harus menjadi source of truth, sedangkan test fixture punya lifecycle sendiri.

---

## 6. Repeatable Object Changes

Tidak semua perubahan cocok menjadi versioned migration yang hanya sekali jalan. Ada object database yang secara natural “didefinisikan ulang” sebagai whole object.

Contoh:

- view,
- materialized view definition,
- stored procedure,
- function,
- trigger,
- package body,
- synonym,
- database policy object.

Flyway punya konsep repeatable migration: migration yang dijalankan ulang saat checksum berubah, dan dalam satu run dieksekusi setelah pending versioned migrations. Ini cocok untuk object yang bisa dibuat dengan pola `CREATE OR REPLACE`, tetapi tidak otomatis cocok untuk semua seed data.

### 6.1 View

Contoh:

```sql
CREATE OR REPLACE VIEW application_listing_view AS
SELECT
    a.id,
    a.application_no,
    a.status,
    c.name AS customer_name,
    a.created_at
FROM application a
JOIN customer c ON c.id = a.customer_id;
```

View sering cocok sebagai repeatable karena definisi view adalah satu unit. Jika berubah, kita ingin definisi terbaru berlaku.

Risiko:

- dependent view bisa invalid,
- application query bisa berubah hasilnya,
- permission/grant view bisa hilang tergantung database,
- materialized view perlu refresh,
- performance bisa berubah drastis.

### 6.2 Stored Procedure / Function

Contoh:

```sql
CREATE OR REPLACE FUNCTION normalize_email(input_email TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN lower(trim(input_email));
END;
$$ LANGUAGE plpgsql;
```

Function/procedure cocok sebagai repeatable jika definisi lengkap selalu dikelola di source control.

Risiko:

- signature change bisa memutus caller lama,
- overloaded function bisa membingungkan,
- grant bisa perlu reapplied,
- behavior berubah tanpa schema version baru,
- rollback behavior sulit jika function dipakai oleh data migration.

### 6.3 Trigger

Trigger lebih sensitif.

Contoh trigger dipakai untuk dual-write:

```sql
CREATE OR REPLACE TRIGGER trg_customer_sync
AFTER INSERT OR UPDATE ON customer
FOR EACH ROW
BEGIN
    -- sync shadow table
END;
```

Trigger bisa membantu migration, tetapi juga bisa menyembunyikan behavior. Ia harus didokumentasikan kuat karena aplikasi mungkin tidak sadar ada write tambahan.

Pertanyaan sebelum memakai trigger:

- Apakah trigger temporary atau permanent?
- Bagaimana observability-nya?
- Apakah trigger bisa recursive?
- Bagaimana jika trigger gagal?
- Apakah bulk load akan lambat?
- Apakah ordering antar trigger jelas?

---

## 7. Index Changes

Index adalah schema object, tetapi layak punya kategori sendiri karena dampak operasionalnya besar.

### 7.1 Create Index

```sql
CREATE INDEX idx_application_status_created_at
ON application(status, created_at);
```

Manfaat:

- mempercepat query,
- mendukung constraint,
- mendukung join/filter/order,
- mengurangi full table scan.

Risiko:

- create index di table besar bisa lama,
- bisa blocking write tergantung database dan mode,
- menambah storage,
- memperlambat insert/update/delete,
- optimizer belum tentu memilih index,
- index salah urutan kolom bisa tidak berguna.

### 7.2 Drop Index

```sql
DROP INDEX idx_old_application_status;
```

Risiko:

- query lama bisa mendadak lambat,
- batch/report bisa timeout,
- foreign key/constraint mungkin bergantung pada index tertentu,
- perubahan tidak langsung terlihat saat deploy tetapi muncul saat traffic puncak.

Drop index harus didasarkan pada evidence:

- unused index stats,
- query plan,
- monitoring periode cukup panjang,
- knowledge batch/report schedule,
- rollback plan.

### 7.3 Rebuild/Reorganize Index

Operasional, bukan sekadar migration.

Contoh:

- rebuild index karena bloat,
- move index tablespace,
- change fillfactor,
- rebuild unusable index,
- create index concurrently/online.

Ini sering lebih cocok sebagai DBA/ops task atau controlled migration job, bukan bagian startup aplikasi.

### 7.4 Unique Index / Constraint Introduction

Menambah uniqueness ke data existing berisiko karena data lama mungkin duplicate.

Strategi aman:

1. detect duplicate,
2. repair duplicate,
3. create non-unique/helper index jika perlu,
4. add unique constraint/index,
5. update aplikasi agar menjaga invariant.

Contoh pre-check:

```sql
SELECT email, COUNT(*)
FROM user_account
GROUP BY email
HAVING COUNT(*) > 1;
```

Jika query ini menghasilkan row, migration unique constraint harus gagal atau ditunda.

---

## 8. Constraint Changes

Constraint adalah deklarasi invariant di database. Ia powerful karena mencegah data invalid, tetapi bisa menjadi breaking change.

### 8.1 NOT NULL Constraint

Menjadikan kolom `NOT NULL` biasanya butuh beberapa tahap.

Buruk:

```sql
ALTER TABLE customer ALTER COLUMN risk_level SET NOT NULL;
```

Jika ada row lama null atau aplikasi lama masih insert null, migration atau runtime akan gagal.

Lebih aman:

1. add nullable column,
2. update aplikasi agar menulis value,
3. backfill row lama,
4. validate tidak ada null,
5. add `NOT NULL`,
6. monitor.

### 8.2 Foreign Key Constraint

Foreign key menjaga referential integrity.

Risiko:

- data lama orphan,
- insert/update lama gagal,
- delete parent bisa gagal,
- cascade bisa menghapus banyak data,
- constraint validation bisa scan table besar,
- lock bisa berat.

Pre-check:

```sql
SELECT child.customer_id
FROM order_header child
LEFT JOIN customer parent ON parent.id = child.customer_id
WHERE child.customer_id IS NOT NULL
  AND parent.id IS NULL;
```

### 8.3 Check Constraint

Contoh:

```sql
ALTER TABLE application
ADD CONSTRAINT chk_application_status
CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));
```

Risiko:

- status lama tidak masuk daftar,
- aplikasi lama masih menulis status lama,
- enum hardcoded di beberapa service,
- report masih mengenali status lama.

### 8.4 Constraint as Documentation vs Enforcement

Constraint bukan hanya enforcement, tetapi dokumentasi executable. Namun tidak semua invariant harus langsung dipaksa.

Tahap maturity:

1. invariant hanya di application code,
2. invariant dimonitor dengan query,
3. invariant divalidasi di migration pre-check,
4. invariant dijadikan database constraint,
5. invariant dijadikan part of contract test.

---

## 9. Column Changes

Kolom adalah unit perubahan paling sering, tetapi juga sumber banyak kesalahan.

### 9.1 Add Column

Pertanyaan:

- nullable atau not null?
- ada default?
- apakah default akan rewrite table?
- apakah aplikasi lama aman?
- apakah ORM entity sudah sinkron?
- apakah query `SELECT *` terdampak?
- apakah serialization/report berubah?

Aman secara umum:

```sql
ALTER TABLE customer ADD COLUMN risk_level VARCHAR(20);
```

Lebih berisiko:

```sql
ALTER TABLE customer ADD COLUMN risk_level VARCHAR(20) NOT NULL DEFAULT 'LOW';
```

Tergantung database, ini bisa menjadi operasi besar.

### 9.2 Drop Column

Drop column adalah destructive. Jangan dilakukan di deployment yang sama dengan perubahan aplikasi pertama kali.

Pattern aman:

1. aplikasi berhenti membaca kolom,
2. aplikasi berhenti menulis kolom,
3. monitor akses,
4. backup/archival jika perlu,
5. drop column di release berikutnya.

### 9.3 Rename Column

Rename terlihat kecil tetapi contract-breaking.

Buruk:

```sql
ALTER TABLE customer RENAME COLUMN full_name TO display_name;
```

Aplikasi lama akan error.

Pattern aman:

1. tambah `display_name`,
2. dual-write `full_name` dan `display_name`,
3. backfill `display_name`,
4. read dari `display_name`, fallback `full_name`,
5. stop write `full_name`,
6. drop `full_name` setelah aman.

### 9.4 Change Column Type

Contoh:

```sql
ALTER TABLE payment ALTER COLUMN amount TYPE NUMERIC(19, 4);
```

Pertanyaan:

- Apakah semua value bisa dikonversi?
- Apakah precision berubah?
- Apakah index terdampak?
- Apakah application mapping berubah?
- Apakah ORM generated SQL berubah?
- Apakah conversion blocking?
- Apakah rollback mungkin?

Untuk perubahan tipe besar, sering lebih aman memakai shadow column.

---

## 10. Table-Level Changes

### 10.1 Create Table

Create table biasanya aman jika belum dipakai. Namun desainnya harus mempertimbangkan:

- primary key strategy,
- audit columns,
- tenant column,
- soft delete,
- indexing,
- foreign keys,
- naming convention,
- ownership module,
- retention policy,
- data classification.

Contoh production-grade create table:

```sql
CREATE TABLE case_assignment (
    id BIGINT NOT NULL,
    case_id BIGINT NOT NULL,
    assigned_user_id BIGINT NOT NULL,
    assigned_at TIMESTAMP NOT NULL,
    assigned_by BIGINT NOT NULL,
    assignment_reason VARCHAR(500),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL,
    created_by BIGINT NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    updated_by BIGINT NOT NULL,
    CONSTRAINT pk_case_assignment PRIMARY KEY (id)
);

CREATE INDEX idx_case_assignment_case_id
ON case_assignment(case_id);
```

### 10.2 Drop Table

Drop table sangat destructive. Bahkan jika aplikasi tidak memakai, mungkin masih dipakai oleh:

- report,
- support script,
- data warehouse,
- audit extraction,
- batch job,
- external integration,
- manual DBA query.

Sebelum drop:

- cari dependency,
- monitor query,
- communicate deprecation,
- archive jika perlu,
- backup,
- schedule,
- approval.

### 10.3 Split Table

Contoh: `user_profile` dipecah menjadi `user_account`, `user_personal_info`, `user_preference`.

Ini bukan satu migration. Ini program migrasi.

Tahap:

1. create new tables,
2. dual-write,
3. backfill,
4. validate counts and checksums,
5. switch reads,
6. stop old writes,
7. archive/drop old columns/table.

### 10.4 Merge Table

Menggabungkan table juga butuh strategi:

- conflict key,
- duplicate data,
- semantic mismatch,
- nullability,
- audit history,
- foreign key redirection,
- query rewrite.

---

## 11. Sequence, Identity, and Key Strategy Changes

Primary key strategy sering dianggap detail teknis, padahal sangat berpengaruh ke migration.

### 11.1 Sequence Changes

Contoh:

```sql
CREATE SEQUENCE application_seq START WITH 1 INCREMENT BY 1;
```

Risiko:

- sequence value lebih kecil dari data existing,
- collision saat insert,
- caching behavior,
- multi-node allocation,
- import data manual tidak update sequence,
- rollback tidak mengembalikan sequence.

Setelah bulk import, perlu sync:

```sql
-- PostgreSQL example
SELECT setval('application_seq', (SELECT MAX(id) FROM application));
```

### 11.2 Identity Changes

Mengubah identity/autoincrement strategy bisa breaking untuk ORM dan aplikasi.

Pertanyaan:

- Apakah Hibernate memakai sequence allocation size?
- Apakah MyBatis insert mengambil generated key?
- Apakah batch insert bergantung pada key generation?
- Apakah replication/import memakai explicit id?
- Apakah data warehouse mengasumsikan monotonic id?

### 11.3 Natural Key vs Surrogate Key

Seed data sering lebih aman memakai natural key stabil, misalnya `code`, bukan id sequence.

Buruk:

```sql
INSERT INTO role_permission (role_id, permission_id)
VALUES (1, 10);
```

Lebih aman:

```sql
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code = 'CASE_APPROVE'
WHERE r.code = 'CASE_MANAGER';
```

---

## 12. Permission, Role, and Security Data Changes

Dalam enterprise application, role/permission seed adalah kategori khusus karena efeknya langsung ke access control.

Contoh:

- tambah permission `CASE_APPROVE`,
- assign permission ke role `CASE_MANAGER`,
- create system role,
- revoke dangerous permission,
- migrate role model,
- split admin role menjadi module admin.

Risiko:

- privilege escalation,
- user kehilangan akses,
- segregation of duties rusak,
- audit finding,
- production support terganggu,
- environment berbeda permission-nya.

### 12.1 Permission Seed Harus Deterministic

Gunakan stable code:

```sql
MERGE INTO permission p
USING (
    SELECT 'CASE_APPROVE' AS code, 'Approve case' AS name FROM dual
) s
ON (p.code = s.code)
WHEN MATCHED THEN UPDATE SET p.name = s.name
WHEN NOT MATCHED THEN INSERT (code, name) VALUES (s.code, s.name);
```

### 12.2 Permission Assignment Harus Explicit

Hindari “grant all new permissions to admin-like roles” tanpa review.

Buruk:

```sql
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.name LIKE '%ADMIN%';
```

Lebih baik:

```sql
INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code = 'CASE_APPROVE'
WHERE r.code IN ('CASE_MANAGER', 'SENIOR_CASE_OFFICER');
```

### 12.3 Security Data Bukan Test Fixture

Jangan seed user/password production di migration. Jika perlu system account, gunakan controlled provisioning dan secret manager.

---

## 13. Configuration Data Changes

Banyak aplikasi menyimpan konfigurasi di database.

Contoh:

- email template config,
- SLA threshold,
- workflow transition config,
- integration endpoint config,
- feature flag,
- notification rule,
- rate limit setting,
- approval matrix.

Konfigurasi database punya dua wajah:

1. Ia terlihat seperti seed.
2. Ia sering berubah oleh business/admin.

Karena itu harus ditentukan ownership-nya.

### 13.1 Immutable Configuration

Konfigurasi yang hanya berubah lewat release.

Cocok untuk migration/seed.

Contoh:

- daftar permission code,
- system workflow state definition,
- internal enum mapping.

### 13.2 Mutable Configuration

Konfigurasi yang boleh diubah di production UI.

Tidak boleh sembarang di-overwrite oleh migration.

Contoh:

- SLA threshold yang diatur admin,
- email template content,
- agency-specific setting,
- feature flag rollout percentage.

Strategi:

- seed hanya jika belum ada,
- jangan update jika user sudah mengubah,
- pakai version/effective date,
- atau pindahkan ownership ke config management terpisah.

---

## 14. Workflow and State Machine Data Changes

Untuk sistem case management/regulatory, workflow/state machine sering disimpan di database.

Contoh:

- state `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`,
- transition `SUBMIT`, `ASSIGN`, `APPROVE`, `REJECT`,
- role allowed transition,
- SLA per state,
- escalation rule.

Ini seed data, tetapi dampaknya adalah behavior sistem.

### 14.1 State Addition

Menambah state baru terlihat seperti insert lookup, tetapi sebenarnya mengubah lifecycle.

Pertanyaan:

- Apakah existing case bisa masuk state ini?
- Apakah report memahami state baru?
- Apakah SLA logic memahami state baru?
- Apakah notification logic memahami state baru?
- Apakah UI filter memahami state baru?
- Apakah external integration memahami state baru?

### 14.2 State Rename

Jangan rename state code langsung jika code disimpan di banyak table.

Buruk:

```sql
UPDATE case_table SET status = 'IN_REVIEW' WHERE status = 'UNDER_REVIEW';
```

Pertimbangkan:

- apakah audit trail menyimpan status lama?
- apakah historical report harus mempertahankan label lama?
- apakah external API contract memakai code lama?
- apakah backward compatibility dibutuhkan?

Sering lebih aman menambah display label baru, bukan mengubah code.

### 14.3 Transition Changes

Menambah/menghapus transition bisa mengubah access path user.

Migration harus disertai test scenario:

- old case in old state,
- old case in new state,
- new case lifecycle,
- role-based transition,
- invalid transition rejection,
- SLA and escalation behavior.

---

## 15. Audit, History, and Regulatory Data Changes

Audit table berbeda dari transactional table biasa.

Contoh:

- audit trail,
- event history,
- status history,
- login history,
- approval history,
- correspondence log,
- document access log.

### 15.1 Audit Schema Change

Menambah kolom audit:

```sql
ALTER TABLE audit_trail ADD COLUMN correlation_id VARCHAR(100);
```

Pertanyaan:

- Apakah old audit row perlu backfill?
- Apakah null acceptable untuk historical data?
- Apakah report audit berubah?
- Apakah evidence legal tetap valid?
- Apakah serialization audit lama bisa dibaca?

### 15.2 Audit Data Correction

Data audit biasanya tidak boleh diubah sembarangan. Jika harus diperbaiki, perlu:

- explicit approval,
- immutable correction record,
- before/after evidence,
- reason,
- actor,
- timestamp,
- impact analysis.

Di banyak domain, audit data lebih baik dikoreksi dengan compensating entry, bukan update langsung.

---

## 16. Reporting, View, and Read Model Changes

Read model sering tidak dianggap “core database”, tetapi sangat sensitif.

Contoh:

- reporting table,
- denormalized dashboard table,
- materialized view,
- search index source table,
- BI extraction view,
- export view.

### 16.1 Reporting View Change

Mengubah view bisa mengubah laporan tanpa error teknis.

Pertanyaan:

- Apakah kolom berubah?
- Apakah jumlah row berubah?
- Apakah filter implicit berubah?
- Apakah duplicate muncul/hilang?
- Apakah report downstream bergantung pada column order?
- Apakah BI tool memakai `SELECT *`?

### 16.2 Materialized View Change

Materialized view punya lifecycle tambahan:

- refresh complete vs incremental,
- refresh time,
- lock saat refresh,
- storage,
- index materialized view,
- dependency.

Migration definisi materialized view harus memikirkan refresh strategy.

---

## 17. Environment-Specific Changes

Tidak semua perubahan berlaku sama di semua environment. Tetapi terlalu banyak branching environment akan membuat migration tidak deterministic.

### 17.1 Legitimate Environment Differences

Contoh yang bisa diterima:

- local dev test data,
- integration endpoint dummy,
- feature flag default berbeda,
- performance test dataset,
- tenant dummy,
- mock external system config.

### 17.2 Dangerous Environment Differences

Contoh berbahaya:

- production punya schema berbeda,
- UAT punya kolom tambahan manual,
- DEV punya seed permission yang tidak ada di PROD,
- migration dilewati di environment tertentu,
- nama constraint berbeda antar environment,
- table dibuat manual di staging.

Prinsip:

> Environment boleh berbeda pada data operasional dan konfigurasi yang memang environment-specific, tetapi struktur schema dan migration history seharusnya semirip mungkin.

Liquibase menyediakan context dan label untuk mengontrol changeset berdasarkan lingkungan atau target release. Fitur ini powerful, tetapi jika dipakai berlebihan bisa membuat changelog sulit dipahami. Flyway lebih sederhana dan biasanya mendorong folder/config separation atau placeholder, tetapi tetap perlu disiplin agar environment tidak drift.

---

## 18. Tenant-Specific Changes

Multi-tenant system memperumit taxonomy.

Jenis deployment:

1. **Shared schema**: semua tenant di table yang sama dengan `tenant_id`.
2. **Schema per tenant**: satu database, banyak schema.
3. **Database per tenant**: setiap tenant punya database sendiri.

### 18.1 Shared Schema Tenant Change

Contoh:

```sql
ALTER TABLE application ADD COLUMN tenant_id BIGINT;
```

Pertanyaan:

- Bagaimana backfill tenant existing?
- Apakah semua query sudah filter tenant?
- Apakah unique constraint perlu tenant scope?
- Apakah index perlu diawali tenant_id?
- Apakah data leakage risk meningkat?

### 18.2 Schema-per-Tenant Migration

Migration harus dijalankan untuk banyak schema.

Masalah:

- satu tenant gagal, tenant lain berhasil,
- version drift,
- migration duration panjang,
- retry tenant tertentu,
- per-tenant lock,
- audit per tenant,
- rollout wave.

### 18.3 Tenant Seed

Tenant bootstrap data mungkin berbeda per tenant:

- role default,
- organization structure,
- workflow config,
- allowed features,
- SLA config.

Ini bukan seed global biasa. Harus ada tenant bootstrap workflow.

---

## 19. Hotfix, Repair, and Emergency Changes

Tidak semua perubahan datang dari release normal. Production incident sering memaksa perubahan cepat.

### 19.1 Hotfix Migration

Contoh:

- tambah missing index untuk incident performance,
- repair invalid data agar user bisa proceed,
- add missing permission,
- disable broken config,
- fix failed migration metadata.

Hotfix harus tetap masuk source control. Anti-pattern terbesar adalah “langsung alter di production, nanti lupa dimasukkan ke repo”.

### 19.2 Repair Migration

Repair migration memperbaiki efek migration sebelumnya.

Contoh:

- migration V20 salah insert seed,
- jangan edit V20 jika sudah applied di shared/prod,
- buat V21 untuk memperbaiki.

Pattern:

```sql
-- V21__fix_wrong_permission_assignment.sql
DELETE FROM role_permission
WHERE role_id = (SELECT id FROM role WHERE code = 'VIEWER')
  AND permission_id = (SELECT id FROM permission WHERE code = 'CASE_APPROVE');
```

### 19.3 Checksum Repair

Flyway dan Liquibase memakai checksum untuk mendeteksi perubahan file migration/changelog yang sudah applied. Jika file lama diedit setelah applied, tool bisa menolak karena history tidak cocok. Ini bukan gangguan; ini safety mechanism.

Repair tool metadata hanya boleh dilakukan setelah memahami:

- apakah perubahan file hanya komentar/format,
- apakah SQL berubah,
- apakah production sudah menjalankan versi lama,
- apakah perlu corrective migration,
- apakah audit evidence lengkap.

---

## 20. Generated vs Handwritten Changes

Tool bisa generate migration dari diff ORM/schema. Ini berguna, tetapi berbahaya jika dipercaya mentah-mentah.

### 20.1 Generated Migration

Contoh sumber:

- Hibernate schema diff,
- Liquibase generateChangeLog/diffChangeLog,
- IDE database diff,
- Prisma-like diff tool,
- manual compare schema.

Kelebihan:

- cepat,
- mengurangi missing object,
- berguna untuk baseline,
- membantu review perbedaan.

Risiko:

- rename dianggap drop+create,
- data loss tidak terlihat,
- index/constraint naming buruk,
- order tidak aman,
- default tidak sesuai,
- vendor-specific behavior tidak dipahami,
- generated SQL tidak memikirkan zero-downtime.

Rule:

> Generated migration adalah draft, bukan desain final.

### 20.2 Handwritten Migration

Lebih intentional, tetapi bisa miss detail.

Kualitas handwritten migration bergantung pada review:

- apakah backward-compatible,
- apakah lock risk dipahami,
- apakah data existing valid,
- apakah rollback/roll-forward jelas,
- apakah naming konsisten,
- apakah test ada.

---

## 21. Idempotent vs Versioned Changes

Ini dimensi penting.

### 21.1 Versioned Change

Dijalankan sekali sesuai urutan.

Cocok untuk:

- create table,
- add column,
- data correction spesifik,
- one-time backfill kecil,
- create initial index,
- add constraint.

Flyway versioned migration dan Liquibase changeset umumnya mengikuti model ini.

### 21.2 Idempotent Change

Aman dijalankan berkali-kali dengan hasil akhir sama.

Contoh:

```sql
CREATE TABLE IF NOT EXISTS example (...);
```

atau seed upsert.

Idempotent bukan berarti selalu lebih baik. Jika semua migration dibuat idempotent dengan `IF EXISTS`/`IF NOT EXISTS`, bisa menyembunyikan drift.

Contoh bahaya:

```sql
CREATE TABLE IF NOT EXISTS customer (...);
```

Jika table `customer` sudah ada tetapi definisinya salah, migration tetap sukses. Ini membuat pipeline hijau padahal schema tidak sesuai.

### 21.3 Deterministic Change

Perubahan deterministic menghasilkan state yang sama jika input state sama.

Tidak deterministic:

```sql
INSERT INTO config_value (key, value, created_at)
VALUES ('DEFAULT_TIMEOUT', '30', CURRENT_TIMESTAMP);
```

Untuk audit mungkin acceptable, tetapi untuk seed deterministic, timestamp runtime bisa membuat perbedaan antar environment.

Lebih deterministic:

```sql
INSERT INTO config_value (key, value, created_at)
VALUES ('DEFAULT_TIMEOUT', '30', TIMESTAMP '2026-01-01 00:00:00');
```

Atau lebih baik pisahkan metadata created_at yang memang runtime-generated.

---

## 22. Online vs Offline Changes

### 22.1 Online Change

Perubahan yang bisa dilakukan saat aplikasi dan traffic aktif.

Syarat:

- backward-compatible,
- tidak mengunci lama,
- resource terkendali,
- bisa dimonitor,
- bisa dihentikan atau retry,
- tidak memutus aplikasi lama.

Contoh relatif online:

- add nullable column,
- create table baru,
- create view baru,
- add index concurrently/online jika database mendukung,
- backfill chunked dengan throttle.

### 22.2 Offline Change

Perubahan yang butuh maintenance window atau stop traffic.

Contoh:

- destructive schema change besar,
- table rewrite besar,
- incompatible type change,
- primary key rewrite,
- massive backfill tanpa online strategy,
- migration yang memblokir write utama.

Offline tidak selalu buruk. Untuk sistem kecil atau internal, offline window bisa lebih murah daripada desain zero-downtime kompleks. Top engineer bukan selalu memaksa zero-downtime, tetapi memilih trade-off sadar.

---

## 23. Backward-Compatible vs Forward-Compatible Changes

### 23.1 Backward-Compatible Schema Change

Schema baru masih bisa dipakai aplikasi lama.

Contoh:

- tambah nullable column,
- tambah table yang belum dipakai,
- tambah index,
- tambah permission seed yang tidak mengubah existing role behavior.

### 23.2 Forward-Compatible Application Change

Aplikasi baru masih bisa berjalan dengan schema lama, atau minimal graceful.

Contoh:

- aplikasi membaca kolom baru jika ada,
- fallback jika field null,
- dual-read old/new,
- feature flag sebelum memakai schema baru.

Dalam deployment serius, kombinasi ini penting karena urutan bisa bervariasi:

- DB migrated before app,
- app rolled while old pods still alive,
- rollback app after DB migration,
- batch job lama masih berjalan,
- read replica belum catch up.

Matrix sederhana:

| Schema | App | Harus Aman? | Catatan |
|---|---|---:|---|
| Old schema | Old app | Ya | baseline |
| New schema | Old app | Ya untuk zero-downtime | backward-compatible schema |
| New schema | New app | Ya | target |
| Old schema | New app | Tergantung strategi | perlu feature flag/fallback jika app bisa deploy dulu |

---

## 24. Migration vs Application Logic vs Batch Job

Tidak semua perubahan data harus dijalankan oleh Flyway/Liquibase.

### 24.1 Cocok di Migration Tool

- DDL kecil-menengah,
- create table/column/index,
- seed deterministic,
- small data correction,
- view/function definition,
- constraint setelah validasi,
- metadata changes.

### 24.2 Cocok di Batch Job

- backfill jutaan row,
- data transformation kompleks,
- migration yang perlu checkpoint,
- migration yang perlu throttle,
- migration yang perlu pause/resume,
- migration yang perlu progress dashboard,
- migration yang bisa berlangsung berjam-jam/hari.

### 24.3 Cocok di Application Logic

- dual-write,
- dual-read,
- lazy migration saat record dibaca,
- feature-flagged behavior,
- transitional compatibility.

### 24.4 Cocok di Manual/DBA Operation

- storage move,
- tablespace resize,
- partition maintenance,
- index rebuild besar,
- DB engine upgrade,
- emergency lock resolution.

Rule:

> Migration tool adalah orchestrator perubahan versi, bukan tempat memaksa semua pekerjaan database masuk ke satu transaction deploy.

---

## 25. Classification Matrix

Gunakan matrix berikut saat mereview perubahan database.

| Jenis Change | Contoh | Risiko Utama | Strategi Umum |
|---|---|---|---|
| Add nullable column | `ADD COLUMN x` | default/rewrite, ORM mismatch | versioned DDL, deploy before app uses it |
| Add non-null column | `ADD COLUMN x NOT NULL` | data existing invalid, app lama gagal | expand/backfill/contract |
| Drop column | `DROP COLUMN x` | app/report lama gagal, data loss | deprecate, monitor, backup, contract later |
| Rename column | `RENAME COLUMN` | contract-breaking | shadow column + dual-write |
| Change type | `VARCHAR` to `BIGINT` | conversion, lock, invalid data | shadow column/backfill/validate/switch |
| Add index | `CREATE INDEX` | lock, storage, write overhead | online/concurrent if possible, monitor |
| Drop index | `DROP INDEX` | query regression | prove unused, rollback plan |
| Add FK | `ADD CONSTRAINT FK` | orphan data, validation scan | pre-check, clean data, validate carefully |
| Add unique | `UNIQUE(email)` | duplicate existing data | detect/repair duplicates first |
| Seed lookup | insert status | duplicate/drift | idempotent upsert by stable code |
| Seed permission | insert role permission | privilege escalation | explicit mapping, approval |
| Backfill small | update 1k rows | wrong mapping | versioned DML + validation |
| Backfill large | update 100M rows | lock/WAL/timeout | batch job, chunk, checkpoint |
| View change | `CREATE OR REPLACE VIEW` | report behavior change | repeatable migration + regression test |
| Function change | replace function | caller compatibility | version/signature discipline |
| Trigger change | dual-write trigger | hidden side effect | temporary, documented, monitored |
| Data correction | fix wrong status | irreversible semantic change | backup/evidence/approval |
| Purge | delete old audit | compliance/storage/locks | retention approval + batch delete |
| Tenant bootstrap | create tenant defaults | partial tenant state | tenant registry + retry model |
| Hotfix | prod index/data fix | drift | commit to source control immediately |

---

## 26. Decision Tree: Menentukan Jenis Database Change

Saat menerima requirement database change, jalankan pertanyaan berikut.

### Step 1 — Apakah struktur berubah?

Jika ya:

- Apakah additive?
- Apakah destructive?
- Apakah breaking untuk app lama?
- Apakah butuh backfill?
- Apakah butuh constraint/index?
- Apakah table besar?

### Step 2 — Apakah data existing berubah?

Jika ya:

- Berapa row?
- Apakah update deterministic?
- Apakah original value perlu backup?
- Apakah bisa chunked?
- Apakah rollback mungkin?
- Apakah ada approval business?

### Step 3 — Apakah seed/reference/config?

Jika ya:

- Immutable atau mutable?
- Production atau test-only?
- Natural key apa?
- Apakah upsert aman?
- Apakah boleh overwrite perubahan admin?
- Apakah environment-specific?

### Step 4 — Apakah object executable berubah?

Jika ya:

- View/function/procedure/trigger?
- Repeatable atau versioned?
- Apakah caller lama kompatibel?
- Apakah grant/dependency perlu diurus?
- Apakah performance berubah?

### Step 5 — Apakah operationally heavy?

Jika ya:

- Apakah perlu maintenance window?
- Apakah ada online option?
- Apakah perlu DBA review?
- Apakah perlu monitoring khusus?
- Apakah perlu throttle/checkpoint?

### Step 6 — Apakah multi-service/multi-tenant?

Jika ya:

- Siapa owner schema?
- Apakah service lain masih memakai contract lama?
- Apakah tenant bisa drift?
- Apakah migration harus per tenant?
- Apakah ada release choreography?

---

## 27. Naming Taxonomy: Nama Migration Harus Mengungkap Jenis Perubahan

Nama migration bukan formalitas. Nama yang baik membantu reviewer memahami risiko.

Buruk:

```text
V42__update.sql
V43__fix.sql
V44__changes.sql
V45__new_column.sql
```

Lebih baik:

```text
V20260617_0900__add_nullable_customer_risk_level.sql
V20260617_0930__backfill_customer_risk_level_from_assessment.sql
V20260617_1000__add_not_null_constraint_customer_risk_level.sql
V20260617_1030__seed_case_priority_reference_data.sql
V20260617_1100__create_index_application_status_created_at.sql
```

Untuk Liquibase changeset, nama/id juga harus jelas:

```sql
--liquibase formatted sql

--changeset fajar:20260617-0900-add-customer-risk-level
ALTER TABLE customer ADD risk_level VARCHAR(20);
```

Nama yang baik menjawab:

- apa object-nya,
- apa aksinya,
- apakah backfill/seed/constraint/index,
- apakah sifatnya nullable/not-null/destructive,
- apakah reference data atau correction.

---

## 28. Anti-Pattern Taxonomy

### 28.1 “All-in-one Migration”

Satu file melakukan:

- add column,
- backfill jutaan row,
- add not null,
- drop old column,
- seed permission,
- create index,
- update config.

Ini sulit direview dan sulit recovery.

Lebih baik pecah berdasarkan tahap dan risiko.

### 28.2 “Edit Old Migration”

Setelah migration applied di shared/prod, mengedit file lama akan membuat checksum mismatch. Ini merusak audit trail.

Gunakan corrective migration baru.

### 28.3 “Seed Everything Every Startup”

Aplikasi start lalu selalu overwrite config database.

Risiko:

- perubahan admin hilang,
- production beda dari ekspektasi user,
- audit sulit,
- startup lambat,
- race condition antar instance.

### 28.4 “DDL Auto Update in Production”

Mengandalkan ORM auto-DDL untuk production adalah anti-pattern serius. ORM tidak tahu choreography deployment, data retention, lock risk, dan approval process.

### 28.5 “Environment-Specific Schema”

DEV/UAT/PROD punya schema berbeda karena manual patch.

Akibat:

- bug tidak reproduce,
- migration gagal di production,
- test misleading,
- support sulit.

### 28.6 “Rollback Fantasy”

Menganggap semua migration bisa rollback.

Contoh:

```sql
UPDATE customer SET email = LOWER(email);
```

Jika original case email tidak disimpan, rollback tidak mungkin mengembalikan nilai persis.

---

## 29. Practical Review Checklist

Sebelum approve migration, tanyakan:

### Classification

- Ini DDL, DML, seed, object, index, constraint, config, atau repair?
- Apakah perubahan ini additive, destructive, atau contract-breaking?
- Apakah online atau offline?
- Apakah versioned atau repeatable?
- Apakah deterministic?

### Compatibility

- Apakah aplikasi lama tetap jalan setelah migration?
- Apakah aplikasi baru bisa handle data lama?
- Apakah batch/report/integration terdampak?
- Apakah ada rolling deployment?

### Data Safety

- Apakah data existing berubah?
- Apakah ada backup/evidence?
- Apakah update bisa divalidasi?
- Apakah rollback benar-benar mungkin?
- Apakah ada PII/audit/regulatory implication?

### Operational Safety

- Apakah table besar?
- Apakah akan lock?
- Apakah akan scan full table?
- Apakah create index online/concurrent?
- Apakah migration punya timeout?
- Apakah perlu maintenance window?

### Seed Safety

- Apakah seed production atau test?
- Apakah memakai stable natural key?
- Apakah idempotent?
- Apakah akan overwrite perubahan user/admin?
- Apakah environment-specific?

### Governance

- Apakah migration masuk source control?
- Apakah nama jelas?
- Apakah reviewer bisa memahami intent?
- Apakah ada approval untuk destructive/security/data correction?
- Apakah history/checksum akan tetap valid?

---

## 30. Concrete Example: Requirement to Add `risk_level` to Customer

Requirement:

> Sistem perlu menyimpan risk level customer. Risk level dihitung dari assessment existing. Field wajib untuk customer baru. Customer lama harus diisi berdasarkan data assessment.

Engineer junior mungkin membuat satu migration:

```sql
ALTER TABLE customer ADD risk_level VARCHAR(20) NOT NULL DEFAULT 'LOW';
UPDATE customer SET risk_level = 'HIGH' WHERE ...;
```

Masalah:

- add not null default bisa berat,
- aplikasi lama mungkin tidak mengisi risk_level,
- backfill rule dicampur dengan DDL,
- tidak ada validasi,
- rollback tidak jelas,
- risk rule tidak terdokumentasi,
- table besar bisa lock.

Production-grade taxonomy:

1. **Additive DDL**  
   Tambah nullable column.

```sql
ALTER TABLE customer ADD risk_level VARCHAR(20);
```

2. **Application compatibility**  
   Aplikasi mulai menulis risk_level untuk customer baru, tetapi masih handle null untuk customer lama.

3. **Data backfill**  
   Isi customer lama secara chunked atau controlled DML.

```sql
UPDATE customer c
SET risk_level = (
    SELECT CASE
        WHEN MAX(a.score) >= 80 THEN 'HIGH'
        WHEN MAX(a.score) >= 40 THEN 'MEDIUM'
        ELSE 'LOW'
    END
    FROM customer_assessment a
    WHERE a.customer_id = c.id
)
WHERE c.risk_level IS NULL;
```

Untuk table besar, jangan satu update besar; gunakan batch job.

4. **Validation**

```sql
SELECT COUNT(*)
FROM customer
WHERE risk_level IS NULL;
```

5. **Constraint DDL**

```sql
ALTER TABLE customer ALTER COLUMN risk_level SET NOT NULL;
```

6. **Optional seed/reference**  
   Jika risk_level harus lookup table:

```sql
INSERT INTO risk_level(code, name, sort_order)
VALUES ('LOW', 'Low', 1), ('MEDIUM', 'Medium', 2), ('HIGH', 'High', 3);
```

7. **Contract**  
   Jika ada kolom lama yang diganti, drop hanya setelah aman.

Ini menunjukkan taxonomy mengubah “satu SQL” menjadi program perubahan aman.

---

## 31. Concrete Example: Seed Role Permission

Requirement:

> Tambahkan permission baru `CASE_REOPEN` untuk role `CASE_MANAGER` dan `SUPERVISOR`.

Kategori:

- seed/security data,
- production behavior change,
- access control,
- deterministic,
- harus idempotent,
- perlu approval.

Buruk:

```sql
INSERT INTO permission VALUES (99, 'CASE_REOPEN');
INSERT INTO role_permission VALUES (2, 99);
INSERT INTO role_permission VALUES (3, 99);
```

Masalah:

- hardcoded id,
- duplicate risk,
- role id beda antar environment,
- permission id collision,
- tidak idempotent,
- tidak explicit nama role.

Lebih baik:

```sql
-- create permission if missing
INSERT INTO permission (code, name)
SELECT 'CASE_REOPEN', 'Reopen case'
WHERE NOT EXISTS (
    SELECT 1 FROM permission WHERE code = 'CASE_REOPEN'
);

-- assign to exact roles if missing
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code = 'CASE_REOPEN'
WHERE r.code IN ('CASE_MANAGER', 'SUPERVISOR')
  AND NOT EXISTS (
      SELECT 1
      FROM role_permission rp
      WHERE rp.role_id = r.id
        AND rp.permission_id = p.id
  );
```

Untuk Oracle, gunakan `MERGE` atau pattern equivalent.

Review tambahan:

- Apakah role `SUPERVISOR` memang boleh reopen?
- Apakah UI menu akan muncul?
- Apakah backend authorization juga berubah?
- Apakah audit trail mencatat reopen?
- Apakah existing closed case boleh reopen?

---

## 32. Concrete Example: Rename Status Code

Requirement:

> Ganti status `PENDING_REVIEW` menjadi `UNDER_REVIEW`.

Kategori:

- reference/workflow data,
- possible data migration,
- compatibility risk,
- report/API risk.

Naive:

```sql
UPDATE case_table
SET status = 'UNDER_REVIEW'
WHERE status = 'PENDING_REVIEW';

UPDATE case_status
SET code = 'UNDER_REVIEW', name = 'Under Review'
WHERE code = 'PENDING_REVIEW';
```

Masalah:

- old app mungkin masih memakai `PENDING_REVIEW`,
- external API mungkin kontraknya `PENDING_REVIEW`,
- audit history lama berubah semantic,
- report historical berubah,
- workflow transition config bisa rusak,
- enum Java bisa mismatch.

Alternatif lebih aman:

1. Jika hanya label yang berubah, jangan ubah code:

```sql
UPDATE case_status
SET display_name = 'Under Review'
WHERE code = 'PENDING_REVIEW';
```

2. Jika code benar-benar harus berubah:

- tambah code baru,
- aplikasi support dua code sementara,
- migrate data,
- update integration/report,
- deprecate code lama,
- hapus setelah aman.

---

## 33. How This Taxonomy Maps to Flyway and Liquibase

### 33.1 Flyway Mapping

Flyway cocok untuk:

- versioned SQL migration,
- repeatable SQL migration,
- Java-based migration,
- schema history tracking,
- checksum validation,
- simple ordered migration model.

Mapping:

| Taxonomy | Flyway Strategy |
|---|---|
| Add table/column | Versioned migration |
| Small seed | Versioned migration, idempotent SQL |
| View/function | Repeatable migration |
| Large backfill | Java migration or external batch; often not startup migration |
| Repair | New versioned corrective migration |
| Baseline existing DB | Flyway baseline |
| Manual checksum issue | Validate then repair only with governance |

### 33.2 Liquibase Mapping

Liquibase cocok untuk:

- changeset model,
- preconditions,
- contexts/labels,
- rollback metadata,
- changelog hierarchy,
- multi-format changelog,
- governance-heavy enterprise environments.

Mapping:

| Taxonomy | Liquibase Strategy |
|---|---|
| Add table/column | Changeset with change type or SQL |
| Conditional change | Preconditions |
| Environment/tenant targeting | Contexts/labels, carefully |
| Rollback-sensitive change | Explicit rollback block |
| View/function | SQL changeset, possibly runOnChange with caution |
| Large backfill | Custom change/batch job; not always changelog-only |
| Release boundary | Tags |

### 33.3 Tool Does Not Replace Classification

Flyway and Liquibase can tell:

- whether a migration was applied,
- whether checksum changed,
- what order changes ran,
- sometimes how to rollback,
- whether changelog/history table is consistent.

They cannot automatically tell:

- whether your column rename breaks old pods,
- whether your backfill locks production,
- whether your seed overwrites admin config,
- whether your permission grants too much access,
- whether your workflow state change breaks reporting,
- whether rollback is legally/business-wise valid.

That judgment is engineering responsibility.

---

## 34. Summary Mental Model

Setelah bagian ini, setiap database change harus dilihat melalui taxonomy:

1. **Structure change** — apa bentuk schema berubah?
2. **Data change** — apakah row existing berubah?
3. **Seed change** — apakah ini reference/master/bootstrap/test/config data?
4. **Object change** — apakah view/function/procedure/trigger berubah?
5. **Performance structure change** — apakah index/statistics/partition berubah?
6. **Security change** — apakah role/permission/grant berubah?
7. **Operational change** — apakah berat, blocking, perlu window, perlu monitoring?
8. **Compatibility change** — apakah app lama/app baru bisa hidup bersama?
9. **Governance change** — apakah audit, approval, evidence, rollback jelas?

Kalimat kunci:

> Jangan mulai dari “pakai Flyway atau Liquibase?”. Mulai dari “perubahan ini jenis apa, invariant apa yang harus dijaga, failure mode apa yang mungkin terjadi, dan strategi deployment apa yang aman?”.

Tooling datang setelah taxonomy.

---

## 35. Latihan Pemahaman

Klasifikasikan requirement berikut:

1. Tambah kolom `last_login_at` nullable ke `user_account`.
2. Tambah kolom `tenant_id` not null ke semua table utama.
3. Ubah `status` dari string bebas menjadi foreign key ke `case_status`.
4. Tambah permission `DOCUMENT_DELETE` untuk role admin.
5. Hapus permission `CASE_APPROVE` dari role officer.
6. Buat index untuk query dashboard yang lambat.
7. Drop column `legacy_code` yang sudah tidak dipakai aplikasi.
8. Backfill `normalized_email` untuk 20 juta user.
9. Ubah view report agar join ke table baru.
10. Repair data production karena 300 case salah status.
11. Tambah default tenant seed saat onboarding agency baru.
12. Rename status `PENDING_REVIEW` menjadi `UNDER_REVIEW`.
13. Tambah unique constraint ke `email`.
14. Purge audit log lebih dari 7 tahun.
15. Replace stored procedure untuk perhitungan SLA.

Untuk masing-masing, jawab:

- kategori taxonomy,
- online/offline,
- additive/destructive/breaking,
- versioned/repeatable/batch,
- perlu pre-check apa,
- perlu rollback/roll-forward strategy apa,
- perlu approval siapa.

---

## 36. What Comes Next

Part berikutnya adalah:

**`02-migration-invariants-and-failure-models.md`**

Di sana kita akan membahas invariant dan failure model secara lebih formal:

- schema version invariant,
- migration ordering invariant,
- checksum/history invariant,
- seed determinism invariant,
- partial failure,
- concurrent deployment,
- lock timeout,
- rollback mismatch,
- environment drift,
- repair vs roll-forward.

Part 1 ini belum masuk detail Flyway/Liquibase command karena fondasinya adalah klasifikasi. Tanpa taxonomy ini, command tooling hanya menjadi hafalan.

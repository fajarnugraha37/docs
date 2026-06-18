# Part 6 — Flyway SQL Migration Design

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> File: `06-flyway-sql-migration-design.md`  
> Fokus: mendesain SQL migration Flyway yang aman, deterministic, reviewable, production-aware, dan cocok untuk Java systems dari Java 8 sampai Java 25.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami bahwa SQL migration bukan sekadar file `ALTER TABLE`, tetapi artefak release yang harus bisa diaudit, diuji, dipromosikan, dan dipulihkan.
2. Mendesain naming, ordering, struktur, komentar, dan isi migration Flyway agar scalable untuk team dan long-lived system.
3. Membedakan migration yang aman, berisiko, destructive, non-destructive, idempotent, repeatable, transactional, dan online-friendly.
4. Menulis migration yang lebih mudah direview oleh developer, DBA, reviewer security, release manager, dan incident responder.
5. Menghindari anti-pattern seperti mengubah migration lama, menyisipkan environment-specific logic, memasukkan data besar dalam startup migration, atau mengandalkan ORM auto-DDL.
6. Membentuk mental model untuk memilih apakah sebuah perubahan harus berupa versioned migration, repeatable migration, Java migration, batch job, atau operational script.

Bagian ini sengaja tidak mengulang SQL dasar, JDBC, JPA, Hibernate, atau MyBatis. Kita fokus pada **engineering discipline** di sekitar SQL migration.

---

## 1. Posisi Part Ini dalam Seri

Sampai titik ini kita sudah membahas:

- Part 0: database change sebagai engineering discipline.
- Part 1: taxonomy of database changes.
- Part 2: invariants dan failure models.
- Part 3: database versioning models.
- Part 4: Flyway mental model.
- Part 5: setup Flyway untuk Java 8–25.

Sekarang kita mulai menjawab pertanyaan yang lebih praktis:

> “Kalau saya harus menulis file `V2026_06_17_0900__add_customer_status.sql`, bagaimana caranya agar file itu aman untuk production, mudah direview, tidak merusak rollback strategy, dan tetap masuk akal 3 tahun kemudian?”

Itulah inti Part 6.

---

## 2. Mental Model: Migration SQL adalah Kontrak Evolusi, Bukan Script Sementara

Banyak developer memperlakukan migration seperti script sementara:

```sql
ALTER TABLE users ADD COLUMN status VARCHAR(20);
```

Secara syntax benar. Secara engineering belum tentu cukup.

Migration harus dipahami sebagai **kontrak evolusi** antara:

1. **Aplikasi lama** yang mungkin masih berjalan.
2. **Aplikasi baru** yang akan memakai struktur baru.
3. **Database lama** yang sedang dipromosikan ke struktur baru.
4. **Database baru** setelah migration selesai.
5. **Pipeline release** yang menjalankan migration.
6. **Operator/DBA** yang harus memahami dampaknya.
7. **Incident responder** yang harus menangani kegagalan.
8. **Auditor** yang perlu tahu apa berubah, kapan, dan mengapa.

Migration yang baik bukan hanya “berhasil dijalankan sekali di laptop”. Migration yang baik harus menjawab:

- Apakah migration ini aman jika dijalankan di production volume?
- Apakah migration ini bisa gagal di tengah jalan?
- Kalau gagal, state database seperti apa yang tersisa?
- Apakah aplikasi lama masih bisa berjalan setelah migration?
- Apakah aplikasi baru butuh migration ini sebelum start?
- Apakah ada lock panjang?
- Apakah ada data loss?
- Apakah ada perubahan privilege/security?
- Apakah migration ini deterministic?
- Apakah reviewer bisa memahami maksudnya?
- Apakah script ini masih dapat dipercaya 2 tahun kemudian?

Top engineer menulis migration dengan memikirkan semua pertanyaan tersebut.

---

## 3. Prinsip Dasar Flyway SQL Migration

Flyway SQL migration umumnya berbentuk file seperti:

```text
src/main/resources/db/migration/V1__init.sql
src/main/resources/db/migration/V2__add_customer_status.sql
src/main/resources/db/migration/V3__backfill_customer_status.sql
```

atau timestamp style:

```text
src/main/resources/db/migration/V2026_06_17_0900__add_customer_status.sql
src/main/resources/db/migration/V2026_06_17_0910__backfill_customer_status.sql
src/main/resources/db/migration/V2026_06_17_0920__add_customer_status_not_null.sql
```

Flyway menjalankan versioned migration berdasarkan versi yang belum tercatat di schema history table. Setelah migration dijalankan, Flyway menyimpan metadata seperti version, description, script, checksum, execution time, installed rank, dan success flag.

Artinya file migration adalah bagian dari history permanen.

Konsekuensi penting:

1. **Migration yang sudah pernah masuk shared environment tidak boleh diedit sembarangan.**
2. **Checksum mismatch adalah sinyal bahwa history sudah berubah.**
3. **Perbaikan harus dibuat sebagai migration baru, bukan rewrite masa lalu.**
4. **Naming dan ordering harus tahan terhadap branch conflict.**
5. **Migration harus diperlakukan seperti production code.**

---

## 4. Karakteristik SQL Migration yang Baik

SQL migration yang baik memiliki karakteristik berikut.

### 4.1 Explicit

Migration harus jelas melakukan apa.

Buruk:

```sql
ALTER TABLE account ADD field1 VARCHAR(255);
```

Lebih baik:

```sql
ALTER TABLE account
    ADD external_reference_number VARCHAR(255);
```

Kenapa?

Karena migration adalah dokumen historis. Nama `field1` mungkin terasa cepat saat development, tetapi menjadi technical debt permanen.

---

### 4.2 Minimal tetapi lengkap

Satu migration sebaiknya memuat satu perubahan logis.

Buruk:

```sql
ALTER TABLE customer ADD status VARCHAR(20);
ALTER TABLE invoice ADD paid_at TIMESTAMP;
CREATE INDEX idx_order_created_at ON orders(created_at);
UPDATE product SET active = 1 WHERE active IS NULL;
DROP TABLE old_temp_table;
```

Masalahnya:

- Sulit direview.
- Sulit mengukur risiko.
- Jika gagal, sulit tahu perubahan mana yang bermasalah.
- Sulit rollback/roll-forward.
- Sulit dikaitkan dengan requirement.

Lebih baik dipisah:

```text
V2026_06_17_0900__add_customer_status_column.sql
V2026_06_17_0910__add_invoice_paid_at_column.sql
V2026_06_17_0920__create_orders_created_at_index.sql
V2026_06_17_0930__backfill_product_active_flag.sql
V2026_06_17_0940__drop_old_temp_table.sql
```

Tetapi jangan ekstrem juga. Jika satu perubahan logis butuh beberapa statement yang memang satu paket, boleh dalam satu migration.

Contoh:

```sql
ALTER TABLE customer
    ADD status_code VARCHAR(20);

CREATE INDEX idx_customer_status_code
    ON customer(status_code);
```

Kalau index tersebut merupakan bagian langsung dari fitur status lookup, satu migration masih masuk akal. Tetapi untuk high-volume production table, lebih aman dipisah agar lock/performance risk bisa dikelola terpisah.

---

### 4.3 Deterministic

Migration harus menghasilkan hasil yang sama ketika dijalankan pada input state yang sama.

Buruk:

```sql
INSERT INTO app_config (config_key, config_value, created_at)
VALUES ('FEATURE_X_ENABLED', 'false', CURRENT_TIMESTAMP);
```

Masalah:

- `created_at` berbeda per environment.
- Kadang tidak masalah, tetapi jika field ikut audit/comparison, hasil menjadi tidak deterministic.

Lebih deterministic:

```sql
INSERT INTO app_config (config_key, config_value, created_at)
VALUES ('FEATURE_X_ENABLED', 'false', TIMESTAMP '2026-06-17 00:00:00');
```

Namun ini pun perlu hati-hati. Untuk production audit, `created_at` mungkin memang harus waktu aktual. Maka pertanyaannya bukan “selalu hindari current timestamp”, tetapi:

> Apakah nilai non-deterministic ini bagian dari business truth, operational audit, atau accidental variability?

Kalau accidental, hindari. Kalau memang operational audit, dokumentasikan.

---

### 4.4 Reviewable

Migration harus mudah dibaca manusia.

Buruk:

```sql
ALTER TABLE A ADD C1 VARCHAR(12);CREATE INDEX X1 ON A(C1);ALTER TABLE B ADD C2 NUMBER(1);
```

Lebih baik:

```sql
-- Add external reference number to support reconciliation with upstream payment system.
ALTER TABLE payment_transaction
    ADD external_reference_number VARCHAR(64);

-- Lookup is frequently performed by external reference during reconciliation job.
CREATE INDEX idx_payment_transaction_ext_ref
    ON payment_transaction(external_reference_number);
```

Reviewer harus bisa melihat:

- Objek apa yang diubah.
- Kenapa diubah.
- Apakah ada risiko lock/performance.
- Apakah ada data loss.
- Apakah aplikasi lama masih kompatibel.

---

### 4.5 Safe by default

Migration harus menghindari perubahan destructive tanpa choreography.

High-risk examples:

```sql
DROP TABLE customer;
DROP COLUMN old_status;
ALTER TABLE customer MODIFY status VARCHAR(5);
UPDATE huge_table SET flag = 'Y';
ALTER TABLE order_line ADD CONSTRAINT fk_order_line_order ...;
```

Bukan berarti statement tersebut tidak boleh. Tetapi statement seperti ini harus diperlakukan sebagai **risk-bearing migration** dan biasanya butuh:

- pre-check,
- backup/snapshot,
- expand/contract,
- lock analysis,
- data validation,
- rollback/roll-forward plan,
- observability,
- approval.

---

### 4.6 Forward-compatible

Migration yang baik sering kali bukan migration yang langsung membuat schema final, tetapi yang membuat schema transisi aman.

Misalnya ingin mengubah `customer.status` dari free text menjadi foreign key ke table `customer_status`.

Buruk jika langsung:

```sql
ALTER TABLE customer
    ADD CONSTRAINT fk_customer_status
    FOREIGN KEY (status) REFERENCES customer_status(code);
```

Kalau existing data belum bersih, migration gagal. Kalau aplikasi lama masih menulis status lama, aplikasi rusak.

Lebih baik bertahap:

1. Tambah table status.
2. Seed allowed statuses.
3. Tambah nullable `status_code` baru.
4. Deploy app dual-write.
5. Backfill data.
6. Validate orphan/inconsistent data.
7. Tambah constraint.
8. Switch read.
9. Hapus kolom lama di release berikutnya.

Ini contoh expand/contract. Detailnya akan dibahas lebih dalam pada Part 20.

---

## 5. Naming Convention Migration Flyway

Naming bukan kosmetik. Naming menentukan:

- ordering,
- conflict resolution,
- auditability,
- reviewability,
- readability saat incident,
- traceability ke requirement/ticket.

Flyway SQL versioned migration memakai pola umum:

```text
V<version>__<description>.sql
```

Dua underscore `__` memisahkan version dan description.

Contoh:

```text
V1__init.sql
V2__add_customer_status.sql
```

Untuk sistem kecil, ini cukup. Untuk sistem besar, versi numerik sederhana sering menimbulkan conflict.

---

## 6. Numeric Versioning

Contoh:

```text
V1__init.sql
V2__add_customer.sql
V3__add_invoice.sql
V4__add_payment.sql
```

### Kelebihan

- Mudah dipahami.
- Cocok untuk project kecil.
- Cocok untuk single branch linear development.

### Kekurangan

- Mudah conflict saat banyak branch.
- Developer A dan B sama-sama membuat `V10__...`.
- Merge conflict bisa trivial tetapi berdampak pada ordering.
- Sulit dikaitkan ke waktu/release.

### Kapan cocok

- Project kecil.
- Satu tim kecil.
- Migration jarang.
- Release linear.
- Tidak banyak parallel feature branch.

---

## 7. Timestamp Versioning

Contoh:

```text
V2026_06_17_0900__add_customer_status_column.sql
V2026_06_17_0915__seed_customer_status_reference_data.sql
V2026_06_17_0930__backfill_customer_status_code.sql
```

Atau lebih compact:

```text
V202606170900__add_customer_status_column.sql
V202606170915__seed_customer_status_reference_data.sql
```

### Kelebihan

- Mengurangi branch conflict.
- Ordering lebih natural.
- Audit-friendly.
- Mudah melihat kapan migration dibuat.

### Kekurangan

- Bisa terjadi ordering yang tidak sesuai dependency jika developer tidak hati-hati.
- Timestamp bukan release boundary.
- Perubahan yang dibuat belakangan bisa seharusnya berjalan lebih dulu.
- Butuh convention timezone.

### Rekomendasi timezone

Pilih satu timezone untuk version timestamp. Biasanya:

- UTC untuk distributed/global team.
- Local office timezone jika semua release governance memakai timezone yang sama.

Untuk team enterprise, saya lebih menyarankan UTC di repository, lalu release note boleh memakai local timezone.

Contoh convention:

```text
V202606170230__add_customer_status_column.sql
```

Artinya timestamp UTC `2026-06-17 02:30`.

Kalau memakai local timezone, tulis di team standard:

```text
All migration versions use Asia/Jakarta local time.
```

Yang penting: konsisten.

---

## 8. Release-Based Versioning

Contoh:

```text
V2026_06_0_001__add_customer_status_column.sql
V2026_06_0_002__seed_customer_status.sql
V2026_06_0_003__backfill_customer_status.sql
```

Atau:

```text
V2_14_0_001__add_customer_status_column.sql
V2_14_0_002__seed_customer_status.sql
```

### Kelebihan

- Mudah mengaitkan migration ke release.
- Cocok untuk regulated release train.
- Bagus untuk deployment package review.

### Kekurangan

- Branch conflict tetap bisa terjadi.
- Jika migration pindah release, version naming jadi awkward.
- Perlu governance lebih ketat.

### Cocok untuk

- Enterprise release train.
- Government/regulatory systems.
- Sistem dengan release note formal.
- Sistem yang butuh approval per release package.

---

## 9. Hybrid Versioning

Untuk sistem besar, hybrid style sering paling praktis.

Contoh:

```text
V2026_06_17_0900__ACEAS_3182_add_internet_audit_prefix_column.sql
V2026_06_17_0915__ACEAS_3182_backfill_internet_audit_prefix.sql
```

Atau:

```text
V202606170900__ticket_3182_add_internet_audit_prefix_column.sql
```

### Kelebihan

- Timestamp mengurangi conflict.
- Ticket id memberi traceability.
- Description memberi readability.

### Kekurangan

- Nama file panjang.
- Butuh discipline agar tidak menjadi noisy.

### Rekomendasi praktis

Untuk sistem enterprise Java, gunakan pola:

```text
VyyyyMMddHHmm__<ticket-or-domain>_<verb>_<object>_<purpose>.sql
```

Contoh:

```text
V202606170900__case_add_escalation_due_date_column.sql
V202606170930__auth_seed_default_permission_codes.sql
V202606171000__audit_create_activity_module_index.sql
```

Kalau ticket id wajib:

```text
V202606170900__ACEAS_3182_audit_add_internet_source_column.sql
```

---

## 10. Description Naming: Verb, Object, Purpose

Nama migration sebaiknya menjawab:

```text
What is changed?
```

Lebih bagus jika juga menjawab:

```text
Why is this change needed?
```

### Pola baik

```text
V202606170900__customer_add_status_code_column.sql
V202606170910__customer_status_seed_initial_codes.sql
V202606170920__customer_backfill_status_code_from_legacy_status.sql
V202606170930__customer_status_add_foreign_key_constraint.sql
```

### Pola buruk

```text
V202606170900__changes.sql
V202606170910__update.sql
V202606170920__fix.sql
V202606170930__new_table.sql
V202606170940__final.sql
```

Saat incident, nama seperti `fix.sql` tidak membantu siapa pun.

---

## 11. Satu File Satu Perubahan Logis

Pertanyaan penting:

> “Seberapa besar satu migration file seharusnya?”

Jawaban yang lebih baik:

> “Satu migration harus merepresentasikan satu perubahan logis yang bisa direview, diuji, dan dipulihkan sebagai unit risiko.”

Bukan berdasarkan jumlah baris.

### Contoh satu perubahan logis

```sql
-- Add status code to customer to support normalized status lookup.
ALTER TABLE customer
    ADD status_code VARCHAR(20);

CREATE INDEX idx_customer_status_code
    ON customer(status_code);
```

Ini masih satu perubahan logis jika index langsung mendukung kolom baru.

### Contoh terlalu banyak

```sql
ALTER TABLE customer ADD status_code VARCHAR(20);
CREATE TABLE notification_template (...);
UPDATE invoice SET status = 'PAID' WHERE paid_at IS NOT NULL;
DROP TABLE old_report_cache;
CREATE INDEX idx_case_created_at ON case_file(created_at);
```

Ini bukan satu perubahan logis. Ini satu release dump.

---

## 12. Split Migration Berdasarkan Risk Class

Untuk production-grade migration, lebih baik split berdasarkan risk class.

Misalnya satu fitur butuh:

1. Tambah nullable column.
2. Backfill 10 juta rows.
3. Tambah not null constraint.
4. Tambah index.
5. Drop column lama.

Jangan jadikan satu file.

Lebih baik:

```text
V202606170900__customer_add_status_code_nullable_column.sql
V202606170930__customer_backfill_status_code_from_legacy_status.sql
V202606171000__customer_add_status_code_not_null_constraint.sql
V202606171030__customer_create_status_code_index.sql
V202607010900__customer_drop_legacy_status_column.sql
```

Kenapa?

- `ADD nullable column` biasanya low risk.
- `Backfill 10 juta rows` high risk.
- `NOT NULL constraint` bisa scan table dan fail jika data belum bersih.
- `CREATE INDEX` bisa lock/consume resources tergantung DBMS.
- `DROP column` destructive dan harus dilakukan setelah beberapa release.

Dengan split seperti ini, review dan deployment bisa lebih aman.

---

## 13. Struktur Internal File Migration

Gunakan struktur konsisten agar semua migration mudah dibaca.

Template sederhana:

```sql
-- =====================================================================
-- Purpose : Add customer.status_code for normalized customer status model.
-- Ticket  : CASE-1234
-- Risk    : Low for DDL add nullable column; no data rewrite.
-- Notes   : Application must dual-write legacy status and status_code in release 2.14.
-- =====================================================================

ALTER TABLE customer
    ADD status_code VARCHAR(20);

CREATE INDEX idx_customer_status_code
    ON customer(status_code);
```

Untuk team yang lebih formal:

```sql
-- =====================================================================
-- Migration : V202606170900__customer_add_status_code_column.sql
-- Purpose   : Add customer.status_code for normalized customer status flow.
-- Owner     : Customer Domain Team
-- Ticket    : CASE-1234
-- Risk      : Low
-- Data Loss : No
-- Lock Risk : Metadata lock only; expected short duration on target DBMS.
-- Rollback  : Roll-forward preferred. Column can remain unused if app rollback occurs.
-- =====================================================================
```

Komentar seperti ini bukan bureaucracy jika digunakan pada migration yang berisiko. Untuk migration sangat kecil, jangan berlebihan. Tetapi untuk enterprise, komentar risk sangat membantu.

---

## 14. Commenting: Kapan Perlu dan Kapan Berlebihan

Komentar yang baik menjelaskan **why** dan **risk**, bukan mengulang syntax.

Buruk:

```sql
-- Add column status_code
ALTER TABLE customer ADD status_code VARCHAR(20);
```

Komentar ini tidak memberi informasi tambahan.

Lebih baik:

```sql
-- Nullable first to keep old application version compatible during rolling deployment.
ALTER TABLE customer
    ADD status_code VARCHAR(20);
```

Komentar ini menjelaskan alasan desain.

Contoh komentar bagus lain:

```sql
-- Do not add NOT NULL yet. Existing rows are backfilled by V202606170930.
ALTER TABLE customer
    ADD status_code VARCHAR(20);
```

```sql
-- Index supports nightly reconciliation query by external reference number.
CREATE INDEX idx_payment_ext_ref
    ON payment_transaction(external_reference_number);
```

```sql
-- Constraint is added only after data quality validation in prior migration.
ALTER TABLE customer
    ADD CONSTRAINT fk_customer_status
    FOREIGN KEY (status_code)
    REFERENCES customer_status(code);
```

---

## 15. Transactional Behavior: Jangan Asumsikan Semua Database Sama

Salah satu jebakan migration adalah mengasumsikan semua DB memperlakukan DDL sama.

Secara umum:

- PostgreSQL mendukung banyak DDL dalam transaction, tetapi beberapa operasi seperti `CREATE INDEX CONCURRENTLY` tidak boleh dijalankan dalam transaction block.
- Oracle melakukan implicit commit sebelum dan sesudah banyak DDL.
- MySQL/MariaDB memiliki variasi transactional DDL tergantung engine dan operasi.
- SQL Server mendukung transaction untuk banyak DDL tetapi lock behavior tetap harus dianalisis.
- H2/HSQLDB sering tidak mewakili behavior production DB.

Konsekuensi:

```sql
ALTER TABLE customer ADD status_code VARCHAR(20);
UPDATE customer SET status_code = 'ACTIVE' WHERE status_code IS NULL;
ALTER TABLE customer MODIFY status_code NOT NULL;
```

Di satu DB, ini mungkin atomic. Di DB lain, sebagian statement bisa commit meskipun statement berikutnya gagal.

Top engineer tidak hanya bertanya:

> “SQL ini jalan atau tidak?”

Tetapi:

> “Kalau statement kedua gagal, apakah statement pertama sudah commit? Bagaimana state database setelah gagal?”

---

## 16. Flyway `executeInTransaction`

Flyway memiliki kemampuan mengontrol apakah migration dijalankan dalam transaction, tergantung database support dan konfigurasi.

Untuk SQL migration tertentu, ada kasus di mana migration tidak boleh dibungkus transaction.

Contoh PostgreSQL:

```sql
CREATE INDEX CONCURRENTLY idx_customer_email
    ON customer(email);
```

`CREATE INDEX CONCURRENTLY` tidak boleh berada dalam transaction block.

Dalam Flyway, strategy bisa berupa konfigurasi global atau script configuration, tergantung versi dan setup.

Prinsipnya:

- Jangan blindly disable transaction untuk semua migration.
- Jangan blindly enable transaction dan mengira semua aman.
- Pahami operasi spesifik DBMS.
- Dokumentasikan migration yang non-transactional.

Contoh komentar:

```sql
-- Non-transactional by DBMS requirement.
-- PostgreSQL CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
CREATE INDEX CONCURRENTLY idx_customer_email
    ON customer(email);
```

---

## 17. Statement Delimiter dan Parser Awareness

Flyway perlu mem-parse SQL script menjadi statement. Untuk SQL sederhana, semicolon cukup.

```sql
CREATE TABLE customer (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);
```

Namun stored procedure/function/package bisa punya delimiter khusus.

Contoh problem konseptual:

```sql
CREATE OR REPLACE FUNCTION do_something()
RETURNS void AS $$
BEGIN
    -- semicolon inside function body
    PERFORM 1;
END;
$$ LANGUAGE plpgsql;
```

Flyway harus memahami delimiter/block syntax DBMS.

Untuk Oracle PL/SQL, sering ada `/` sebagai terminator block:

```sql
CREATE OR REPLACE PROCEDURE refresh_customer_status AS
BEGIN
    NULL;
END;
/
```

Prinsip:

- Pahami SQL dialect.
- Jangan campur banyak dialect dalam satu migration location kecuali sudah diset `locations` per vendor.
- Test migration dengan database asli, bukan hanya H2.
- Untuk stored procedure besar, pertimbangkan repeatable migration.

---

## 18. Placeholder Usage

Flyway mendukung placeholder, misalnya:

```sql
CREATE SCHEMA ${app_schema};
```

atau:

```sql
INSERT INTO app_config (config_key, config_value)
VALUES ('APP_ENV', '${environment}');
```

Placeholder bisa berguna, tetapi juga bisa berbahaya.

### Placeholder yang masuk akal

- Schema name berbeda per environment.
- Tablespace name berbeda per environment.
- Role name berbeda per environment.
- Minor deployment parameter yang tidak mengubah business meaning.

Contoh:

```sql
CREATE TABLE ${app_schema}.customer_status (
    code VARCHAR(20) PRIMARY KEY,
    description VARCHAR(255) NOT NULL
);
```

### Placeholder yang berbahaya

```sql
INSERT INTO app_config (config_key, config_value)
VALUES ('PAYMENT_PROVIDER_URL', '${payment_provider_url}');
```

Ini mungkin seeding config, tapi perlu hati-hati. Apakah URL itu secret? Apakah environment config seharusnya di DB? Apakah migration menjadi berbeda antar environment?

Lebih buruk:

```sql
ALTER TABLE ${table_to_alter}
    ADD COLUMN ${column_to_add} VARCHAR(255);
```

Ini membuat migration tidak lagi stabil sebagai artifact. Isi migration bergantung pada runtime config.

### Prinsip placeholder

Gunakan placeholder untuk **deployment binding**, bukan untuk mengubah **logical meaning** migration.

Baik:

```sql
CREATE INDEX idx_customer_status_code
    ON ${app_schema}.customer(status_code);
```

Buruk:

```sql
${dynamic_ddl_statement}
```

Kalau migration logic berubah karena placeholder, reviewer tidak lagi bisa memahami apa yang benar-benar dijalankan.

---

## 19. Environment-Specific Logic: Hindari Jika Bisa

Anti-pattern umum:

```sql
-- dev only
INSERT INTO user_account (username, password_hash)
VALUES ('admin', '...');

-- prod only
DELETE FROM test_data;
```

Dalam migration versioned yang sama, environment-specific logic bisa menyebabkan drift.

### Masalahnya

Jika Dev, UAT, dan Prod menjalankan file yang sama tetapi menghasilkan state berbeda, maka migration history berkata “sama”, tetapi real database berbeda.

Itu berbahaya untuk:

- debugging,
- audit,
- rollback,
- compliance,
- schema comparison,
- incident response.

### Alternatif

Pisahkan lokasi migration:

```text
classpath:db/migration/common
classpath:db/migration/dev
classpath:db/migration/test
```

Tetapi gunakan sangat hati-hati. Untuk production schema, idealnya common migration sama di semua environment.

Untuk test/dev data, lebih baik gunakan:

- test fixture framework,
- testcontainers init script,
- dev-only seed runner,
- application bootstrap untuk local only,
- separate profile-specific migration location yang tidak pernah aktif di prod.

### Rule of thumb

Production schema migration harus sama across environments.

Environment-specific data boleh ada, tetapi jangan dicampur dengan production schema evolution kecuali ada alasan kuat.

---

## 20. Idempotency dalam Flyway Versioned Migration

Pertanyaan umum:

> “Apakah Flyway migration harus idempotent?”

Jawaban nuanced:

- Flyway versioned migration secara normal **tidak perlu idempotent** karena Flyway menjamin migration dijalankan sekali berdasarkan schema history.
- Namun migration tetap perlu **safe against expected state**.
- Idempotency bisa berguna untuk seed/upsert tertentu, tetapi bisa menyembunyikan drift jika dipakai sembarangan.

Contoh non-idempotent yang normal:

```sql
ALTER TABLE customer
    ADD status_code VARCHAR(20);
```

Jika dijalankan dua kali, gagal. Tidak masalah karena Flyway harus menjalankannya sekali.

Contoh idempotent:

PostgreSQL:

```sql
ALTER TABLE customer
    ADD COLUMN IF NOT EXISTS status_code VARCHAR(20);
```

Apakah lebih baik? Belum tentu.

Jika column sudah ada karena manual hotfix dengan tipe salah, `IF NOT EXISTS` membuat migration lolos padahal schema salah.

### Risiko idempotent DDL

Idempotent DDL bisa menyembunyikan masalah:

```sql
CREATE TABLE IF NOT EXISTS customer_status (
    code VARCHAR(20) PRIMARY KEY,
    description VARCHAR(255) NOT NULL
);
```

Jika table sudah ada tetapi struktur berbeda, migration tetap sukses. Flyway history mencatat sukses, tetapi schema tidak sesuai.

### Prinsip

Gunakan idempotency untuk DML seed/backfill dengan natural key yang jelas. Untuk DDL versioned migration, lebih baik fail fast jika expected state tidak sesuai, kecuali kamu benar-benar sedang membuat migration repair/adoption dengan precondition eksplisit.

---

## 21. Precondition Manual Pattern di Flyway

Liquibase punya preconditions secara built-in. Flyway SQL migration tidak memiliki precondition abstraction yang sama, tetapi kita bisa membuat pattern manual.

Contoh: pastikan tidak ada data invalid sebelum menambah constraint.

PostgreSQL style:

```sql
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM customer
        WHERE status_code IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot add NOT NULL: customer.status_code contains NULL values';
    END IF;
END $$;

ALTER TABLE customer
    ALTER COLUMN status_code SET NOT NULL;
```

Oracle style konseptual:

```sql
DECLARE
    v_count NUMBER;
BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM customer
    WHERE status_code IS NULL;

    IF v_count > 0 THEN
        RAISE_APPLICATION_ERROR(-20001, 'Cannot add NOT NULL: customer.status_code contains NULL values');
    END IF;
END;
/

ALTER TABLE customer
    MODIFY status_code NOT NULL;
```

SQL Server style:

```sql
IF EXISTS (SELECT 1 FROM customer WHERE status_code IS NULL)
BEGIN
    THROW 51000, 'Cannot add NOT NULL: customer.status_code contains NULL values', 1;
END;

ALTER TABLE customer
    ALTER COLUMN status_code VARCHAR(20) NOT NULL;
```

### Kapan gunakan precondition manual

- Sebelum menambah `NOT NULL`.
- Sebelum menambah unique constraint.
- Sebelum menambah foreign key.
- Sebelum drop column/table.
- Sebelum data correction irreversible.
- Sebelum migration yang asumsi data tertentu.

### Jangan berlebihan

Untuk simple `ADD nullable column`, precondition manual biasanya tidak perlu.

---

## 22. Fail Fast vs Tolerant Migration

Migration harus jelas memilih posture:

1. **Fail fast** jika state tidak sesuai.
2. **Tolerant/adaptive** terhadap beberapa kondisi yang diprediksi.

Contoh fail fast:

```sql
ALTER TABLE customer
    ADD status_code VARCHAR(20);
```

Jika column sudah ada, gagal. Ini baik jika column seharusnya belum ada.

Contoh tolerant:

```sql
INSERT INTO customer_status (code, description)
SELECT 'ACTIVE', 'Active customer'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_status WHERE code = 'ACTIVE'
);
```

Ini masuk akal untuk seed by natural key.

### Decision rule

Gunakan fail fast untuk schema structure yang harus dikontrol ketat.

Gunakan tolerant/idempotent untuk seed data yang memang boleh sudah ada karena:

- migration replay scenario,
- environment bootstrap,
- multi-tenant onboarding,
- repair seed,
- parallel setup script.

Tetapi tolerant migration harus tetap mendeteksi konflik nilai.

Buruk:

```sql
INSERT INTO customer_status (code, description)
SELECT 'ACTIVE', 'Active'
WHERE NOT EXISTS (...);
```

Jika sudah ada `ACTIVE` dengan description `Enabled`, migration lolos tanpa tahu apakah itu benar.

Lebih baik dengan validation:

```sql
-- PostgreSQL example
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM customer_status
        WHERE code = 'ACTIVE'
          AND description <> 'Active customer'
    ) THEN
        RAISE EXCEPTION 'customer_status ACTIVE exists with unexpected description';
    END IF;
END $$;

INSERT INTO customer_status (code, description)
SELECT 'ACTIVE', 'Active customer'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_status WHERE code = 'ACTIVE'
);
```

---

## 23. DDL Migration Design Patterns

### 23.1 Add nullable column

Ini salah satu migration paling aman.

```sql
ALTER TABLE customer
    ADD status_code VARCHAR(20);
```

Kenapa nullable dulu?

- Existing rows tidak butuh immediate value.
- Aplikasi lama tidak terganggu.
- Rolling deployment lebih aman.
- Backfill bisa dilakukan terpisah.

### 23.2 Add column with default

Hati-hati:

```sql
ALTER TABLE customer
    ADD active_flag BOOLEAN DEFAULT TRUE NOT NULL;
```

Di beberapa DB/version, ini bisa rewrite table besar atau lock lama. Di DB lain sudah optimized. Jangan asumsi.

Safer staged approach:

```sql
ALTER TABLE customer
    ADD active_flag BOOLEAN;
```

Lalu backfill:

```sql
UPDATE customer
SET active_flag = TRUE
WHERE active_flag IS NULL;
```

Lalu constraint:

```sql
ALTER TABLE customer
    ALTER COLUMN active_flag SET NOT NULL;
```

Untuk table kecil, satu statement mungkin cukup. Untuk table besar, staged approach lebih aman.

---

### 23.3 Add index

Simple:

```sql
CREATE INDEX idx_customer_email
    ON customer(email);
```

Production concern:

- Apakah table besar?
- Apakah index creation blocking writes?
- Apakah butuh online/concurrent index?
- Apakah index name unique globally?
- Apakah index benar-benar dipakai query?
- Apakah ada duplicate index?

PostgreSQL:

```sql
CREATE INDEX CONCURRENTLY idx_customer_email
    ON customer(email);
```

Oracle:

```sql
CREATE INDEX idx_customer_email
    ON customer(email)
    ONLINE;
```

SQL Server:

```sql
CREATE INDEX idx_customer_email
    ON customer(email)
    WITH (ONLINE = ON);
```

Tidak semua edition/engine mendukung opsi online. Perlu validasi vendor-specific.

---

### 23.4 Add foreign key

```sql
ALTER TABLE order_line
    ADD CONSTRAINT fk_order_line_order
    FOREIGN KEY (order_id)
    REFERENCES orders(id);
```

Risiko:

- Existing orphan rows membuat migration gagal.
- DB mungkin scan child table.
- Lock bisa signifikan.
- Write path bisa terdampak.

Better pattern:

1. Validate orphan rows.
2. Clean/correct data.
3. Add FK with vendor-specific low-lock option jika tersedia.
4. Monitor.

Precheck:

```sql
SELECT order_line.order_id
FROM order_line
LEFT JOIN orders ON orders.id = order_line.order_id
WHERE order_line.order_id IS NOT NULL
  AND orders.id IS NULL;
```

Dalam migration, fail if exists.

---

### 23.5 Add unique constraint

```sql
ALTER TABLE user_account
    ADD CONSTRAINT uq_user_account_email UNIQUE (email);
```

Risiko:

- Duplicate data membuat migration gagal.
- Bisa lock/scan table.
- Bisa berdampak pada write throughput.

Precheck:

```sql
SELECT email, COUNT(*)
FROM user_account
GROUP BY email
HAVING COUNT(*) > 1;
```

Kalau duplicate ada, jangan tambah constraint dulu. Buat data correction migration atau manual remediation.

---

### 23.6 Rename column

Direct rename:

```sql
ALTER TABLE customer
    RENAME COLUMN status TO status_code;
```

Ini breaking change untuk aplikasi lama.

Zero-downtime safer approach:

1. Add new column `status_code`.
2. App dual-write `status` and `status_code`.
3. Backfill `status_code`.
4. Switch reads to `status_code`.
5. Stop writing old `status`.
6. Drop `status` later.

Direct rename cocok jika:

- downtime diterima,
- single app deployment atomic,
- tidak ada rolling deployment,
- tidak ada external consumers,
- migration window terkontrol.

---

### 23.7 Drop column/table

```sql
ALTER TABLE customer
    DROP COLUMN legacy_status;
```

Drop adalah destructive. Biasanya jangan dilakukan di release yang sama dengan code switch.

Safer pattern:

1. Stop reading column.
2. Stop writing column.
3. Monitor no usage.
4. Optional mark deprecated/comment.
5. Drop in later release.

Untuk table:

```sql
DROP TABLE old_customer_status;
```

Sebelum drop:

- Pastikan tidak dipakai app lama.
- Pastikan tidak dipakai reporting.
- Pastikan tidak dipakai ETL/integration.
- Pastikan backup/snapshot tersedia.
- Pastikan tidak ada view/procedure dependency.

---

## 24. DML Migration Design Patterns

DML migration mengubah data. Risikonya sering lebih besar daripada DDL.

### 24.1 Small deterministic update

```sql
UPDATE customer_status
SET description = 'Suspended customer'
WHERE code = 'SUSPENDED';
```

Untuk reference data kecil, ini masuk akal.

Tetapi tambahkan validation jika penting:

```sql
UPDATE customer_status
SET description = 'Suspended customer'
WHERE code = 'SUSPENDED'
  AND description = 'Suspended';
```

Lalu cek rows affected? SQL murni tidak selalu portable untuk assert row count. Bisa gunakan vendor-specific block jika penting.

---

### 24.2 Large backfill

Buruk:

```sql
UPDATE audit_trail
SET module_code = 'CASE'
WHERE module_code IS NULL;
```

Jika table besar, ini bisa:

- lock banyak rows,
- generate undo/redo besar,
- membebani replication,
- membuat transaction panjang,
- menyebabkan timeout,
- memperbesar WAL/archive logs,
- mengganggu production traffic.

Untuk large backfill, pertimbangkan:

- Java migration dengan batching,
- separate batch job,
- online backfill worker,
- chunked SQL per primary key range,
- resumable migration.

Flyway SQL masih bisa untuk backfill kecil/medium, tetapi jangan jadikan Flyway startup migration untuk backfill raksasa tanpa analisis.

---

### 24.3 Insert seed data

```sql
INSERT INTO customer_status (code, description, sort_order)
VALUES
    ('ACTIVE', 'Active customer', 10),
    ('SUSPENDED', 'Suspended customer', 20),
    ('CLOSED', 'Closed customer', 30);
```

Ini simple tetapi tidak idempotent. Di Flyway versioned migration, ini normal jika table belum punya data.

Untuk seed yang mungkin sudah ada:

PostgreSQL:

```sql
INSERT INTO customer_status (code, description, sort_order)
VALUES
    ('ACTIVE', 'Active customer', 10),
    ('SUSPENDED', 'Suspended customer', 20),
    ('CLOSED', 'Closed customer', 30)
ON CONFLICT (code) DO UPDATE
SET description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order;
```

Oracle:

```sql
MERGE INTO customer_status target
USING (
    SELECT 'ACTIVE' AS code, 'Active customer' AS description, 10 AS sort_order FROM dual
    UNION ALL
    SELECT 'SUSPENDED', 'Suspended customer', 20 FROM dual
    UNION ALL
    SELECT 'CLOSED', 'Closed customer', 30 FROM dual
) source
ON (target.code = source.code)
WHEN MATCHED THEN
    UPDATE SET
        target.description = source.description,
        target.sort_order = source.sort_order
WHEN NOT MATCHED THEN
    INSERT (code, description, sort_order)
    VALUES (source.code, source.description, source.sort_order);
```

SQL Server:

```sql
MERGE customer_status AS target
USING (VALUES
    ('ACTIVE', 'Active customer', 10),
    ('SUSPENDED', 'Suspended customer', 20),
    ('CLOSED', 'Closed customer', 30)
) AS source(code, description, sort_order)
ON target.code = source.code
WHEN MATCHED THEN
    UPDATE SET
        description = source.description,
        sort_order = source.sort_order
WHEN NOT MATCHED THEN
    INSERT (code, description, sort_order)
    VALUES (source.code, source.description, source.sort_order);
```

Seed strategy akan dibahas lebih dalam pada Part 17 dan 18.

---

## 25. Avoiding ORM Auto-DDL Conflict

Dalam Java applications, sering ada temptation:

```properties
spring.jpa.hibernate.ddl-auto=update
```

atau schema generation dari JPA/Jakarta Persistence.

Untuk serious systems, migration tool harus menjadi owner schema evolution. ORM auto-DDL boleh untuk prototype/local experiment, tetapi jangan menjadi production change mechanism.

Masalah ORM auto-DDL:

- Tidak reviewable sebagai release artifact.
- Tidak selalu deterministic.
- Tidak memberi choreography untuk data migration.
- Tidak memahami production lock risk.
- Tidak cocok untuk regulated audit.
- Bisa menghasilkan perubahan unexpected karena entity berubah.
- Tidak menggantikan seed/backfill/expand-contract.

Recommended posture:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

atau disable schema generation dan gunakan Flyway/Liquibase sebagai source of truth.

Untuk non-Spring Jakarta Persistence, hindari `jakarta.persistence.schema-generation.database.action=create/drop-and-create/update` di production.

---

## 26. Vendor-Specific SQL: Kapan Diterima?

Ada idealisme bahwa migration harus portable lintas database. Dalam praktik enterprise, migration yang benar sering harus vendor-specific.

Contoh:

- PostgreSQL `CREATE INDEX CONCURRENTLY`.
- Oracle `ONLINE`, `TABLESPACE`, `LOB`, `ENABLE NOVALIDATE`.
- SQL Server `WITH (ONLINE = ON)`.
- MySQL `ALGORITHM=INPLACE`, `LOCK=NONE`.

Jika production DB adalah Oracle, migration harus Oracle-aware. Memaksa generic SQL bisa menghilangkan fitur safety penting.

### Prinsip

1. Jika aplikasi benar-benar multi-DB product, desain migration per database vendor.
2. Jika aplikasi enterprise hanya memakai satu DB vendor, optimalkan untuk vendor itu.
3. Jangan berpura-pura portable kalau behavior production tidak portable.
4. Test terhadap database engine asli.

Folder layout bisa seperti:

```text
src/main/resources/db/migration/oracle
src/main/resources/db/migration/postgresql
```

atau service/config memilih location berbeda.

---

## 27. Ordering dan Dependency antar Migration

Migration sering punya dependency implisit.

Contoh:

```text
V202606170900__customer_create_status_table.sql
V202606170910__customer_seed_status_table.sql
V202606170920__customer_add_status_code_column.sql
V202606170930__customer_backfill_status_code.sql
V202606170940__customer_add_status_fk.sql
```

Dependency:

- Seed butuh table ada.
- Backfill butuh column ada.
- FK butuh data clean.

Jangan mengandalkan reviewer untuk menebak. Buat ordering jelas melalui version dan naming.

Komentar bisa menambah clarity:

```sql
-- Depends on:
-- - V202606170900__customer_create_status_table.sql
-- - V202606170920__customer_add_status_code_column.sql
```

Untuk migration besar, release note atau migration manifest bisa membantu.

---

## 28. Out-of-Order Migration: Jangan Jadikan Kebiasaan

Flyway memiliki konsep out-of-order migration. Ini bisa berguna saat hotfix branch perlu menambahkan migration dengan versi lebih lama daripada current latest.

Tetapi dalam governance matang, out-of-order migration harus exception, bukan normal.

Risikonya:

- Ordering historis menjadi sulit dipahami.
- Migration yang dibuat untuk state lama dijalankan pada state baru.
- Dependency bisa salah.
- Audit trail lebih sulit.

Lebih aman membuat migration baru dengan version terbaru untuk hotfix, kecuali benar-benar ada alasan release branch.

---

## 29. Checksum dan Larangan Mengedit Migration Lama

Flyway checksum memastikan file migration tidak berubah setelah diterapkan.

Anti-pattern:

```text
V202606170900__add_customer_status.sql
```

Sudah dijalankan di UAT. Lalu developer mengedit file yang sama karena “ada typo kecil”.

Akibat:

- Dev baru mungkin jalan.
- UAT/Prod checksum mismatch.
- Pipeline validate gagal.
- Team tergoda menjalankan `repair` sembarangan.

### Rule

Jika migration sudah masuk shared environment, jangan edit. Buat migration baru.

Contoh:

```text
V202606171100__customer_fix_status_code_length.sql
```

Kapan boleh edit migration lama?

- Belum pernah dipush.
- Belum pernah dijalankan di shared environment.
- Masih private local branch.
- Sudah disepakati migration history reset untuk pre-production prototype.

Untuk production system, treat applied migration as immutable.

---

## 30. Migration Review Checklist

Setiap SQL migration sebaiknya direview dengan checklist berikut.

### 30.1 General

- Apakah nama file jelas?
- Apakah version ordering benar?
- Apakah satu file memuat satu perubahan logis?
- Apakah perubahan ini sesuai ticket/requirement?
- Apakah ada komentar untuk risk/why?
- Apakah migration deterministic?
- Apakah ada environment-specific logic yang tidak perlu?

### 30.2 Schema safety

- Apakah ada drop/rename/destructive change?
- Apakah ada constraint baru?
- Apakah ada index baru?
- Apakah ada column default/not null?
- Apakah table besar terdampak?
- Apakah lock behavior diketahui?
- Apakah DBMS-specific syntax benar?

### 30.3 Data safety

- Apakah ada update/delete massal?
- Apakah ada backfill?
- Apakah backfill bounded atau full-table?
- Apakah transaction terlalu besar?
- Apakah migration bisa di-resume jika gagal?
- Apakah ada validation query?
- Apakah seed data idempotent jika diperlukan?

### 30.4 Compatibility

- Apakah aplikasi lama tetap bisa berjalan setelah migration?
- Apakah aplikasi baru butuh migration ini?
- Apakah rolling deployment aman?
- Apakah ada external consumer/reporting/ETL yang terdampak?
- Apakah ada expand/contract plan?

### 30.5 Operational

- Apakah migration aman dijalankan saat traffic aktif?
- Apakah perlu maintenance window?
- Apakah perlu backup/snapshot?
- Apakah ada expected duration?
- Apakah ada kill/retry plan?
- Apakah ada post-migration verification?

---

## 31. SQL Formatting Standard

Formatting bukan hanya estetika. Formatting mempengaruhi review quality.

### 31.1 Use uppercase SQL keywords

```sql
ALTER TABLE customer
    ADD status_code VARCHAR(20);
```

### 31.2 One major clause per line

Buruk:

```sql
CREATE INDEX idx_customer_status_code ON customer(status_code);
```

Lebih reviewable:

```sql
CREATE INDEX idx_customer_status_code
    ON customer(status_code);
```

### 31.3 Align complex inserts

```sql
INSERT INTO customer_status (code, description, sort_order)
VALUES
    ('ACTIVE',    'Active customer',    10),
    ('SUSPENDED', 'Suspended customer', 20),
    ('CLOSED',    'Closed customer',    30);
```

### 31.4 Avoid huge one-line generated SQL

Generated SQL sering sulit direview. Kalau harus memakai generated migration, format ulang dan review manual.

---

## 32. Handling Generated SQL

Tool bisa menghasilkan DDL diff dari schema. Ini berguna, tetapi berbahaya jika langsung dipercaya.

Risiko generated SQL:

- Drop/recreate object tanpa sadar.
- Rename dianggap drop+add.
- Constraint/index name tidak sesuai convention.
- Vendor-specific options hilang.
- Data migration tidak tercakup.
- Ordering tidak optimal.
- Lock risk tidak dianalisis.

Generated SQL harus diperlakukan sebagai draft, bukan final artifact.

Workflow sehat:

1. Generate diff.
2. Review manual.
3. Rename object/index/constraint sesuai convention.
4. Split berdasarkan risk.
5. Tambah comments/prechecks.
6. Test on real DB.
7. Review by peer/DBA.

---

## 33. Constraint Naming Convention

Jangan biarkan database generate nama constraint acak jika sistem butuh maintainability.

Buruk:

```sql
ALTER TABLE order_line
    ADD FOREIGN KEY (order_id)
    REFERENCES orders(id);
```

DB akan memberi nama default seperti:

```text
SYS_C008123
FK8sdfkjwe9sdf
```

Lebih baik:

```sql
ALTER TABLE order_line
    ADD CONSTRAINT fk_order_line__orders
    FOREIGN KEY (order_id)
    REFERENCES orders(id);
```

Convention contoh:

```text
pk_<table>
fk_<child_table>__<parent_table>
uq_<table>__<columns>
ck_<table>__<rule>
idx_<table>__<columns_or_purpose>
```

Contoh:

```sql
ALTER TABLE customer_status
    ADD CONSTRAINT pk_customer_status
    PRIMARY KEY (code);

ALTER TABLE customer
    ADD CONSTRAINT fk_customer__customer_status
    FOREIGN KEY (status_code)
    REFERENCES customer_status(code);

ALTER TABLE user_account
    ADD CONSTRAINT uq_user_account__email
    UNIQUE (email);

ALTER TABLE invoice
    ADD CONSTRAINT ck_invoice__amount_non_negative
    CHECK (amount >= 0);
```

Kenapa penting?

- Error message lebih jelas.
- Drop/alter constraint lebih mudah.
- Incident debugging lebih cepat.
- Schema diff lebih stabil.

---

## 34. Index Naming Convention

Index harus dinamai dengan jelas.

Buruk:

```sql
CREATE INDEX idx1 ON customer(status_code);
```

Lebih baik:

```sql
CREATE INDEX idx_customer__status_code
    ON customer(status_code);
```

Untuk index berdasarkan use case:

```sql
CREATE INDEX idx_audit_trail__listing_filter
    ON audit_trail(module_id, created_date_time);
```

Gunakan purpose jika column list terlalu panjang atau index mendukung query khusus.

Hati-hati batas panjang identifier:

- Oracle historically memiliki batas identifier lebih pendek pada versi lama.
- PostgreSQL truncate identifier panjang.
- MySQL/SQL Server punya batas masing-masing.

Karena itu convention harus memperhatikan DB target.

---

## 35. Table dan Column Naming dalam Migration

Migration bukan tempat untuk memperbaiki semua naming buruk sekaligus. Tetapi setiap objek baru harus mengikuti standard.

Prinsip:

- Nama table singular/plural pilih salah satu dan konsisten.
- Nama column jelas secara domain.
- Hindari reserved words: `user`, `order`, `group`, `case` bisa bermasalah tergantung DB.
- Hindari quoted identifiers kecuali sangat perlu.
- Hindari case-sensitive object names.
- Hindari nama generik seperti `data`, `value`, `type`, `status` tanpa konteks jika ambigu.

Contoh lebih baik:

```sql
CREATE TABLE case_escalation_rule (
    id BIGINT PRIMARY KEY,
    case_type_code VARCHAR(50) NOT NULL,
    escalation_level_code VARCHAR(50) NOT NULL,
    due_days INTEGER NOT NULL
);
```

Daripada:

```sql
CREATE TABLE rules (
    id BIGINT PRIMARY KEY,
    type VARCHAR(50),
    value VARCHAR(50),
    days INTEGER
);
```

---

## 36. Migration dan Application Compatibility Matrix

Sebelum migration, buat matrix:

| State | Old App | New App |
|---|---:|---:|
| Old DB | harus jalan | mungkin tidak jalan |
| Expanded DB | harus jalan | harus jalan |
| Contracted DB | tidak harus jalan | harus jalan |

Migration awal harus membawa DB dari Old DB ke Expanded DB yang kompatibel dengan old app dan new app.

Contoh:

```sql
ALTER TABLE customer
    ADD status_code VARCHAR(20);
```

Old app masih tidak peduli column baru. New app bisa mulai menulis column baru.

Buruk:

```sql
ALTER TABLE customer
    DROP COLUMN status;
```

Old app langsung rusak.

Top engineer berpikir dalam compatibility matrix, bukan hanya final schema.

---

## 37. Migration dan Rolling Deployment

Dalam Kubernetes atau distributed deployment, aplikasi tidak selalu diganti sekaligus.

Urutan mungkin:

1. Migration berjalan.
2. Pod lama masih menerima traffic.
3. Pod baru mulai naik.
4. Sebagian traffic ke pod lama, sebagian ke pod baru.
5. Pod lama mati bertahap.

Jika migration breaking, rolling deployment rusak.

Contoh breaking:

```sql
ALTER TABLE payment
    RENAME COLUMN ref_no TO external_reference_number;
```

Pod lama masih query `ref_no`, lalu error.

Safer:

```sql
ALTER TABLE payment
    ADD external_reference_number VARCHAR(64);
```

Lalu aplikasi baru dual-write/read-compatible.

---

## 38. Migration dan Blue/Green Deployment

Blue/green deployment lebih tricky.

Jika green app deploy dengan DB migration, tetapi rollback traffic ke blue app terjadi, blue app harus tetap kompatibel dengan migrated DB.

Karena itu migration sebelum traffic switch harus backward-compatible.

Destructive migration sebaiknya dilakukan setelah blue sudah tidak akan digunakan, biasanya release berikutnya.

Pattern:

- Release N: expand schema.
- Release N: deploy green app.
- Release N: switch traffic.
- Release N+1 or N+2: contract schema.

---

## 39. Migration dan Canary Deployment

Canary berarti hanya sebagian instance/user memakai kode baru.

Database migration harus mendukung old dan new behavior bersamaan.

Implication:

- Jangan drop old column.
- Jangan enforce constraint yang old app belum patuhi.
- Jangan ubah enum/status value tanpa compatibility.
- Jangan mengubah meaning kolom yang masih dibaca old app.

Untuk canary, migration harus lebih konservatif daripada full downtime deployment.

---

## 40. Handling Enum/Status Evolution

Java systems sering punya enum di code dan lookup/status di DB.

Contoh Java:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

DB:

```sql
CREATE TABLE case_status (
    code VARCHAR(30) PRIMARY KEY,
    description VARCHAR(255) NOT NULL
);
```

Migration menambah status:

```sql
INSERT INTO case_status (code, description)
VALUES ('PENDING_REVIEW', 'Pending review');
```

Risiko:

- DB punya status baru, old app enum tidak mengenalnya.
- Old app gagal deserialize/map.
- Reports tidak tahu status baru.

Pattern aman:

1. Deploy app yang tolerate unknown status atau sudah punya enum baru tapi belum dipakai.
2. Seed status baru.
3. Enable feature yang menghasilkan status baru.
4. Update reporting/integration.

Jangan sekadar seed enum baru tanpa memikirkan consumers.

---

## 41. Seed in Versioned Migration vs Repeatable Migration

Flyway punya versioned dan repeatable migration.

Reference seed sering membuat bingung.

### Versioned seed cocok jika

- Seed merepresentasikan perubahan historis.
- Data berubah sebagai bagian release.
- Perlu audit kapan status/permission/config ditambah.
- Setiap perubahan harus explicit.

Contoh:

```text
V202606170930__auth_seed_case_approval_permissions.sql
```

### Repeatable seed cocok jika

- Data ingin disinkronkan ke desired state setiap kali berubah.
- Dataset kecil dan deterministic.
- Team menerima model “current desired state”.

Namun repeatable seed bisa berbahaya jika production data boleh diedit manual/admin.

Rule praktis:

- Permission/reference data yang owned by code: bisa versioned atau repeatable tergantung governance.
- Data yang owned by business/admin UI: jangan overwrite lewat repeatable migration.
- Data yang immutable historical: versioned lebih cocok.

Detail seed akan dibahas Part 17–18.

---

## 42. Deleting Data dalam Migration

`DELETE` adalah destructive DML.

Contoh:

```sql
DELETE FROM app_config
WHERE config_key = 'OLD_FEATURE_FLAG';
```

Ini mungkin aman. Tetapi untuk production, tanyakan:

- Apakah data ini bisa dibuat ulang?
- Apakah ada audit dependency?
- Apakah data ini mungkin diedit user?
- Apakah delete akan cascade?
- Apakah ada FK?
- Apakah ada backup?
- Apakah old app masih membaca key ini?

Safer alternative:

```sql
UPDATE app_config
SET active = false
WHERE config_key = 'OLD_FEATURE_FLAG';
```

Atau contract in later release.

Untuk large delete, jangan lakukan full delete dalam single transaction tanpa analisis. Pertimbangkan archival, chunking, partition drop, atau operational job.

---

## 43. Avoid Secrets in Migration

Jangan seed secrets ke database lewat migration script yang masuk Git.

Buruk:

```sql
INSERT INTO api_credentials (client_id, client_secret)
VALUES ('onemap-client', 'super-secret-value');
```

Masalah:

- Secret masuk repository.
- Secret masuk artifact.
- Secret masuk logs/backups.
- Secret masuk developer laptop.
- Rotation sulit.

Alternatif:

- Secret manager.
- Environment variable injection.
- AWS SSM Parameter Store / Secrets Manager.
- Vault.
- Kubernetes Secret.
- Runtime configuration.

Migration boleh membuat struktur:

```sql
CREATE TABLE external_service_config (
    service_code VARCHAR(50) PRIMARY KEY,
    token_parameter_name VARCHAR(255) NOT NULL
);
```

Dan seed pointer non-secret:

```sql
INSERT INTO external_service_config (service_code, token_parameter_name)
VALUES ('ONEMAP', '/aceas/prod/onemap/client-secret');
```

Tetapi secret value tidak ada di migration.

---

## 44. Avoid PII in Migration Seed/Test Data

Jangan masukkan data pribadi realistis ke migration.

Buruk:

```sql
INSERT INTO user_account (name, nric, email)
VALUES ('John Tan', 'S1234567A', 'john.tan@example.com');
```

Untuk test/dev, gunakan synthetic data. Untuk production seed, hindari user/person data kecuali benar-benar business-required dan melalui control process.

Migration repository bukan tempat menyimpan PII.

---

## 45. Migration File Location Strategy

Default Flyway:

```text
classpath:db/migration
```

Untuk modular Java system, bisa butuh struktur:

```text
src/main/resources/db/migration
  V202606170900__common_create_module_dimension.sql
  V202606170910__case_create_case_file.sql
  V202606170920__appeal_create_appeal.sql
```

Atau per module:

```text
src/main/resources/db/migration/common
src/main/resources/db/migration/case
src/main/resources/db/migration/appeal
src/main/resources/db/migration/compliance
```

Namun hati-hati: Flyway menggabungkan migrations dari locations dan mengurutkan berdasarkan version. Jika tiap module membuat version sendiri tanpa global coordination, conflict bisa terjadi.

### Rekomendasi

Untuk satu schema bersama:

- Gunakan global version namespace.
- Boleh folder per module, tetapi version tetap global.
- Naming mencantumkan module/domain.

Contoh:

```text
common/V202606170900__common_create_module_dimension.sql
case/V202606170910__case_add_escalation_due_date.sql
appeal/V202606170920__appeal_add_appeal_reason_code.sql
```

Untuk schema per service:

- Masing-masing service punya migration sendiri.
- Version namespace boleh per service.
- Jangan satu service mengubah schema service lain.

---

## 46. Handling Multiple Schemas

Enterprise DB sering punya multiple schema:

```text
app_owner
app_runtime
audit_owner
report_owner
```

Migration harus jelas schema mana yang diubah.

Buruk:

```sql
CREATE TABLE audit_trail (...);
```

Tergantung default schema/session.

Lebih eksplisit:

```sql
CREATE TABLE audit_owner.audit_trail (...);
```

Atau gunakan placeholder:

```sql
CREATE TABLE ${audit_schema}.audit_trail (...);
```

Prinsip:

- Jangan bergantung pada default schema jika environment bisa berbeda.
- Pastikan migration user punya privilege cukup tetapi tidak berlebihan.
- Pastikan Flyway `schemas` dan `defaultSchema` dikonfigurasi jelas.
- Pastikan schema history table ditempatkan di lokasi yang disepakati.

---

## 47. SQL Migration dan Privilege

Migration user biasanya butuh privilege lebih besar daripada application runtime user.

Application user mungkin hanya:

- SELECT,
- INSERT,
- UPDATE,
- DELETE,
- execute procedure tertentu.

Migration user mungkin butuh:

- CREATE TABLE,
- ALTER TABLE,
- CREATE INDEX,
- CREATE SEQUENCE,
- CREATE VIEW,
- CREATE PROCEDURE,
- GRANT.

Jangan menjalankan aplikasi dengan migration user di production.

Pattern lebih aman:

- Pipeline menjalankan Flyway dengan migration credentials.
- Aplikasi berjalan dengan runtime credentials.
- Migration credentials disimpan di secret manager.
- Access migration credentials dibatasi ke CI/CD/release operator.

SQL migration harus juga menghindari privilege escalation tidak perlu.

Buruk:

```sql
GRANT ALL ON customer TO app_user;
```

Lebih baik:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON customer TO app_user;
```

---

## 48. Migration dan Audit Trail

Migration bisa membuat audit trail dalam beberapa level:

1. Flyway schema history table.
2. Git commit history.
3. CI/CD pipeline logs.
4. DB native audit logs.
5. Change request / approval ticket.
6. Release note.

SQL migration sebaiknya mudah dikaitkan dengan semua itu.

Naming dengan ticket/domain membantu:

```text
V202606170900__ACEAS_3182_audit_add_internet_source_column.sql
```

Komentar header membantu:

```sql
-- Ticket : ACEAS-3182
-- Purpose: Support separate audit listing source for Internet-originated actions.
```

Dalam regulated systems, ini bukan formalitas. Ini membantu menjawab:

- Siapa meminta perubahan?
- Kenapa perubahan dilakukan?
- Kapan diterapkan?
- Apa dampaknya?
- Apakah ada data loss?
- Siapa approve?

---

## 49. Migration dan Performance Planning

Sebelum menjalankan migration, estimasi dampak performance.

### Low risk biasanya

- Add nullable column tanpa default pada table kecil/medium.
- Create small lookup table.
- Insert few reference rows.
- Create view kecil.

### Medium risk

- Create index pada table medium.
- Add FK pada table medium.
- Update ribuan hingga ratusan ribu rows.
- Add not null setelah backfill.

### High risk

- Full-table update jutaan rows.
- Create index pada table besar saat traffic aktif.
- Add column with default/not null pada table besar di DBMS tertentu.
- Add FK/unique constraint pada table besar tanpa precheck.
- Drop/rebuild large table.
- Alter column type pada table besar.

Untuk medium/high risk, migration file harus disertai reasoning dan runbook.

---

## 50. Validation Query Setelah Migration

Migration yang baik sering disertai validation query, meskipun tidak selalu dijalankan oleh Flyway.

Contoh setelah backfill:

```sql
SELECT COUNT(*)
FROM customer
WHERE status_code IS NULL;
```

Expected: `0`.

Setelah seed:

```sql
SELECT code, description
FROM customer_status
ORDER BY code;
```

Setelah index:

- check index exists,
- explain plan untuk query target,
- monitor slow query.

Untuk pipeline, validation bisa dimasukkan sebagai automated post-migration check.

Dalam file migration, bisa tulis komentar:

```sql
-- Post-check:
-- SELECT COUNT(*) FROM customer WHERE status_code IS NULL;
-- Expected: 0 before applying NOT NULL constraint.
```

Atau buat separate verification script.

---

## 51. Migration Dry Run dan SQL Review

Flyway SQL migration sudah berupa SQL, jadi dry run lebih tentang:

- validate migration order,
- run against disposable DB,
- inspect Flyway output,
- measure duration,
- check locks,
- run validation queries.

Untuk Liquibase, dry-run SQL generation lebih prominent. Untuk Flyway, artifact biasanya SQL langsung.

Namun tetap lakukan:

1. Fresh DB migration test.
2. Previous release DB upgrade test.
3. Production-like data volume test untuk risky migration.
4. Rollback app compatibility test.
5. Post-migration app test.

---

## 52. Migration Testing Locally

Local dev minimal:

```bash
./gradlew flywayMigrate
```

atau:

```bash
mvn flyway:migrate
```

atau aplikasi Spring Boot start dengan Flyway enabled.

Tetapi local H2 tidak cukup untuk migration serius.

Lebih baik:

- Testcontainers PostgreSQL/Oracle XE/MySQL/SQL Server sesuai target.
- Docker Compose DB lokal.
- Restore anonymized production sample.
- Run migration from previous release snapshot.

Untuk Java 8–25, Testcontainers membutuhkan kompatibilitas dependency yang sesuai Java baseline. Jika project masih Java 8, pilih versi library yang kompatibel atau jalankan migration test di module terpisah dengan JDK lebih baru jika kebijakan project mengizinkan.

---

## 53. Migration in CI

Pipeline minimal:

1. Compile app.
2. Validate migration naming.
3. Run Flyway migrate on empty DB.
4. Run Flyway migrate on previous release DB snapshot.
5. Run application schema validation.
6. Run integration tests.

Untuk advanced:

1. Generate migration risk report.
2. Detect destructive statement.
3. Detect large table operations.
4. Require DBA approval for high-risk migration.
5. Store migration logs as artifact.
6. Run performance smoke test.

---

## 54. Common Anti-Patterns

### 54.1 `V999__final.sql`

```text
V999__final.sql
```

Tidak ada yang final dalam long-lived system.

---

### 54.2 Editing old migration

Sudah dibahas: jangan edit applied migration.

---

### 54.3 One huge release migration

```text
V202606170900__release_2_14_changes.sql
```

Isi 3000 baris campur DDL, DML, seed, drop, index, function. Ini sulit direview dan sulit recover.

---

### 54.4 ORM-generated migration blindly committed

Tool-generated SQL tanpa review bisa destructive.

---

### 54.5 Dev/test data in production migration

```sql
INSERT INTO user_account (username) VALUES ('testuser');
```

Jangan.

---

### 54.6 Secret in migration

Jangan commit password/token/client secret.

---

### 54.7 Silent tolerant DDL

```sql
CREATE TABLE IF NOT EXISTS ...
```

Bisa menyembunyikan drift.

---

### 54.8 Big data backfill in startup migration

Aplikasi gagal start karena migration backfill jutaan rows. Lebih baik externalized job atau controlled batch.

---

### 54.9 Destructive migration in same release as app change

Drop old column terlalu cepat membuat rollback app tidak mungkin.

---

### 54.10 Environment branching inside SQL

Satu migration menghasilkan schema berbeda antar environment. Ini drift generator.

---

## 55. Practical Example: Adding a Customer Status Safely

Requirement:

> Normalize `customer.status` free text menjadi lookup table `customer_status` dan kolom baru `customer.status_code`.

Naive migration:

```sql
CREATE TABLE customer_status (
    code VARCHAR(20) PRIMARY KEY,
    description VARCHAR(255) NOT NULL
);

INSERT INTO customer_status VALUES ('ACTIVE', 'Active');
INSERT INTO customer_status VALUES ('SUSPENDED', 'Suspended');
INSERT INTO customer_status VALUES ('CLOSED', 'Closed');

ALTER TABLE customer ADD status_code VARCHAR(20) NOT NULL;

UPDATE customer
SET status_code = UPPER(status);

ALTER TABLE customer
ADD CONSTRAINT fk_customer_status
FOREIGN KEY (status_code) REFERENCES customer_status(code);

ALTER TABLE customer DROP COLUMN status;
```

Masalah:

- `status_code NOT NULL` gagal karena existing rows belum punya value.
- `UPPER(status)` mungkin menghasilkan value yang tidak ada di lookup.
- FK bisa gagal.
- Drop `status` merusak old app.
- Semua risiko dicampur.
- Rollback app tidak aman.

Better migration plan:

### V1: Create lookup table

```sql
CREATE TABLE customer_status (
    code VARCHAR(20) NOT NULL,
    description VARCHAR(255) NOT NULL,
    sort_order INTEGER NOT NULL,
    active_flag BOOLEAN NOT NULL,
    CONSTRAINT pk_customer_status PRIMARY KEY (code)
);
```

### V2: Seed lookup data

```sql
INSERT INTO customer_status (code, description, sort_order, active_flag)
VALUES
    ('ACTIVE', 'Active customer', 10, TRUE),
    ('SUSPENDED', 'Suspended customer', 20, TRUE),
    ('CLOSED', 'Closed customer', 30, TRUE);
```

### V3: Add nullable column

```sql
-- Nullable for rolling deployment compatibility.
ALTER TABLE customer
    ADD status_code VARCHAR(20);
```

### V4: Backfill with explicit mapping

```sql
UPDATE customer
SET status_code = CASE
    WHEN status = 'Active' THEN 'ACTIVE'
    WHEN status = 'Suspended' THEN 'SUSPENDED'
    WHEN status = 'Closed' THEN 'CLOSED'
    ELSE NULL
END
WHERE status_code IS NULL;
```

### V5: Validate and add FK

PostgreSQL example:

```sql
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM customer
        WHERE status_code IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot add customer.status_code FK: NULL status_code exists';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM customer c
        LEFT JOIN customer_status s ON s.code = c.status_code
        WHERE c.status_code IS NOT NULL
          AND s.code IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot add customer.status_code FK: invalid status_code exists';
    END IF;
END $$;

ALTER TABLE customer
    ADD CONSTRAINT fk_customer__customer_status
    FOREIGN KEY (status_code)
    REFERENCES customer_status(code);
```

### V6: Add NOT NULL after app compatibility confirmed

```sql
ALTER TABLE customer
    ALTER COLUMN status_code SET NOT NULL;
```

### V7: Drop old column in later release

```sql
-- Only after old application versions and external consumers no longer use customer.status.
ALTER TABLE customer
    DROP COLUMN status;
```

This is migration engineering, not just SQL writing.

---

## 56. Practical Example: Adding Permission Seed

Requirement:

> Add permission `CASE_ESCALATE` and assign to role `CASE_MANAGER`.

Naive:

```sql
INSERT INTO permission VALUES (100, 'CASE_ESCALATE');
INSERT INTO role_permission VALUES (1, 100);
```

Problems:

- Hardcoded IDs may differ by environment.
- Duplicate risk.
- Role id may not be `1`.
- Permission id may conflict.

Better natural-key seed:

PostgreSQL example:

```sql
INSERT INTO permission (permission_code, description)
VALUES ('CASE_ESCALATE', 'Escalate case')
ON CONFLICT (permission_code) DO UPDATE
SET description = EXCLUDED.description;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.permission_code = 'CASE_ESCALATE'
WHERE r.role_code = 'CASE_MANAGER'
  AND NOT EXISTS (
      SELECT 1
      FROM role_permission rp
      WHERE rp.role_id = r.id
        AND rp.permission_id = p.id
  );
```

Even better with validation:

```sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM role WHERE role_code = 'CASE_MANAGER') THEN
        RAISE EXCEPTION 'Role CASE_MANAGER does not exist';
    END IF;
END $$;
```

Principle:

- Use stable natural keys.
- Avoid environment-dependent surrogate IDs.
- Validate required parent data.
- Make relationship insert idempotent.

---

## 57. Practical Example: Creating Index for Audit Listing

Requirement:

> Audit listing frequently filters by module and created date.

Migration:

```sql
-- Supports audit listing filter by module and date range.
-- Review expected query pattern before changing column order.
CREATE INDEX idx_audit_trail__module_created_at
    ON audit_trail(module_id, created_date_time);
```

But before production:

- Check table size.
- Check existing indexes.
- Check query predicate order.
- Check cardinality.
- Check if index creation blocks writes.
- Use online/concurrent option if needed.
- Verify execution plan.

For Oracle production large table:

```sql
CREATE INDEX idx_audit_trail__module_created_at
    ON audit_trail(module_id, created_date_time)
    ONLINE;
```

But `ONLINE` support/options depend on Oracle version/edition and operation. Validate in target environment.

---

## 58. SQL Migration Design Decision Tree

Before writing migration, ask:

```text
1. Is this schema, seed, or data migration?
2. Is it destructive?
3. Does it affect a large table?
4. Does it need to be compatible with old app and new app?
5. Can it run during traffic?
6. Does it need batching?
7. Does it depend on existing data quality?
8. Does it require precondition validation?
9. Is SQL migration enough, or should this be Java migration/batch job?
10. Is the migration deterministic and reviewable?
```

Decision:

- Simple DDL → Flyway SQL versioned migration.
- View/procedure/function desired-state → Flyway repeatable migration.
- Small reference seed → versioned SQL migration.
- Desired-state static seed → maybe repeatable migration.
- Large data backfill → Java migration or external batch job.
- Online schema evolution → expand/contract multi-step migration.
- Vendor-specific online DDL → SQL migration with DBMS-specific syntax and runbook.

---

## 59. Production-Grade SQL Migration Template

```sql
-- =====================================================================
-- Migration : VyyyyMMddHHmm__domain_action_object_purpose.sql
-- Purpose   : <why this migration exists>
-- Ticket    : <ticket/reference>
-- Owner     : <team/domain>
-- Risk      : Low | Medium | High
-- Data Loss : No | Yes, explain
-- Lock Risk : <expected lock behavior>
-- Rollback  : <roll-forward / safe to leave / manual rollback note>
-- Notes     : <compatibility/dependency notes>
-- =====================================================================

-- Optional precondition / validation block.

-- Main migration statements.

-- Optional postcondition / assertion block.
```

Example:

```sql
-- =====================================================================
-- Migration : V202606170900__customer_add_status_code_column.sql
-- Purpose   : Add normalized customer status_code while preserving legacy status.
-- Ticket    : CUSTOMER-241
-- Owner     : Customer Domain Team
-- Risk      : Low
-- Data Loss : No
-- Lock Risk : Metadata-only add nullable column; expected short lock.
-- Rollback  : Roll-forward preferred. Column can remain unused if app rollback occurs.
-- Notes     : NOT NULL and FK added in later migrations after backfill.
-- =====================================================================

ALTER TABLE customer
    ADD status_code VARCHAR(20);
```

---

## 60. Minimal Team Standard for Flyway SQL Migration

Untuk team Java enterprise, minimal standard yang sehat:

1. Semua schema change harus lewat Flyway, bukan manual DB console.
2. Migration yang sudah applied di shared environment immutable.
3. Nama migration memakai timestamp + domain + action.
4. Satu migration satu perubahan logis.
5. Destructive migration harus dipisah dan butuh approval.
6. Large data migration tidak boleh sembarangan dijalankan saat app startup.
7. Seed production harus deterministic dan tidak mengandung secrets/PII.
8. Constraint/index pada table besar harus dianalisis lock/performance.
9. Migration harus dites pada DB engine yang sama dengan production.
10. ORM auto-DDL tidak boleh menjadi production schema management.
11. Rollback aplikasi harus dipertimbangkan sebelum contract/drop migration.
12. Migration logs dan schema history harus menjadi bagian dari release evidence.

---

## 61. Java 8–25 Considerations

SQL migration design sebagian besar tidak bergantung pada versi Java. Tetapi ekosistem aplikasinya berbeda.

### Java 8 legacy systems

Biasanya:

- Spring Boot lama atau non-Spring.
- Flyway versi lama mungkin dipakai.
- Database driver lama.
- CI/CD kurang matang.
- Migration mungkin bercampur manual script.

Fokus:

- Stabilize convention.
- Baseline existing DB.
- Hindari upgrade tool besar tanpa testing.
- Pisahkan migration dari ORM auto-DDL.
- Tambahkan validate di pipeline.

### Java 11/17 systems

Biasanya:

- Lebih mudah memakai tool modern.
- Testcontainers lebih umum.
- CI/CD lebih siap.
- Spring Boot 2.x/3.x transition.

Fokus:

- Migration testing.
- Backward-compatible deployment.
- Better seed design.
- Multi-module governance.

### Java 21/25 systems

Biasanya:

- Modern runtime.
- Spring Boot 3.x/4.x era atau modern Jakarta.
- Container/Kubernetes standard.
- Observability lebih matang.

Fokus:

- Externalized migration job.
- Zero-downtime patterns.
- Native image/AOT consideration jika relevan.
- Strong CI/CD governance.
- Release evidence and audit.

Core principle sama: SQL migration harus deterministic, reviewable, safe, dan compatible.

---

## 62. Latihan Praktis

### Latihan 1: Refactor migration buruk

Diberikan migration:

```sql
ALTER TABLE user ADD status VARCHAR(20) DEFAULT 'ACTIVE' NOT NULL;
UPDATE user SET status='ACTIVE';
CREATE INDEX idx1 ON user(status);
INSERT INTO role_permission VALUES (1, 5);
DROP TABLE old_users;
```

Tugas:

1. Identifikasi minimal 10 masalah.
2. Pecah menjadi beberapa migration.
3. Beri nama file migration yang baik.
4. Tambahkan precheck yang relevan.
5. Jelaskan mana yang low/medium/high risk.

---

### Latihan 2: Design migration plan

Requirement:

> Rename `case_file.owner_user_id` menjadi `case_file.assigned_officer_id` tanpa downtime.

Tugas:

1. Jangan pakai direct rename.
2. Buat expand/dual-write/backfill/read-switch/contract plan.
3. Tentukan migration file names.
4. Tentukan app release choreography.
5. Tentukan rollback-safe point.

---

### Latihan 3: Seed permission safely

Requirement:

> Tambah permission `DOCUMENT_EXPORT` untuk role `COMPLIANCE_OFFICER`.

Tugas:

1. Jangan hardcode surrogate ID.
2. Gunakan natural key.
3. Buat insert permission idempotent.
4. Buat insert role-permission idempotent.
5. Tambahkan validation jika role tidak ada.

---

## 63. Ringkasan Mental Model

Flyway SQL migration yang baik bukan hanya valid secara syntax. Ia harus valid secara lifecycle.

Ingat prinsip ini:

1. Migration adalah release artifact permanen.
2. Applied migration immutable.
3. Naming adalah bagian dari operability.
4. Satu file sebaiknya satu perubahan logis.
5. Split berdasarkan risk, bukan hanya feature.
6. DDL tidak selalu transactional.
7. DBMS behavior matters.
8. Idempotency bukan selalu lebih baik.
9. Tolerant DDL bisa menyembunyikan drift.
10. Seed harus deterministic dan natural-key friendly.
11. Destructive change harus ditunda sampai aman.
12. Rolling/blue-green/canary deployment butuh backward-compatible schema.
13. Large backfill bukan sekadar `UPDATE all rows`.
14. Secrets dan PII tidak boleh masuk migration.
15. ORM auto-DDL bukan production migration strategy.

Top 1% engineer tidak menulis migration hanya untuk membuat database “jadi sesuai entity”. Mereka mendesain jalur perubahan yang aman dari old system ke new system dengan memahami data, traffic, deployment, failure, rollback, audit, dan operasi production.

---

## 64. Checklist Cepat Sebelum Commit Migration

Sebelum commit file migration, tanyakan:

- [ ] Apakah nama file jelas dan sesuai convention?
- [ ] Apakah migration sudah satu perubahan logis?
- [ ] Apakah migration ini immutable setelah masuk shared environment?
- [ ] Apakah ada destructive operation?
- [ ] Apakah old app tetap compatible?
- [ ] Apakah new app membutuhkan migration ini sebelum start?
- [ ] Apakah migration aman saat rolling deployment?
- [ ] Apakah ada full-table update/scan?
- [ ] Apakah ada lock risk?
- [ ] Apakah perlu precondition?
- [ ] Apakah seed menggunakan natural key?
- [ ] Apakah ada secret/PII?
- [ ] Apakah diuji di DB engine asli?
- [ ] Apakah ada post-migration verification?
- [ ] Apakah rollback/roll-forward strategy jelas?

Kalau beberapa jawaban belum jelas, migration belum siap production.

---

## 65. Penutup

Part ini membentuk fondasi praktis untuk menulis SQL migration Flyway yang matang. Setelah ini, kita akan masuk ke **Flyway Repeatable Migrations**.

Versioned migration cocok untuk perubahan historis yang harus berjalan sekali. Namun ada jenis object database yang lebih cocok diperlakukan sebagai desired-state artifact, seperti view, procedure, function, trigger, dan package. Di situlah repeatable migration masuk.

---

# Status Seri

Seri belum selesai.

- Selesai: Part 0 sampai Part 6.
- Berikutnya: Part 7 — `07-flyway-repeatable-migrations.md`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./05-flyway-setup-java-8-to-25.md">⬅️ Part 5 — Flyway Setup in Java 8–25 Projects</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./07-flyway-repeatable-migrations.md">Part 7 — Flyway Repeatable Migrations ➡️</a>
</div>

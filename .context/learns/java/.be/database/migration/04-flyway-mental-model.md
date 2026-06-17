# Part 4 — Flyway Mental Model

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `04-flyway-mental-model.md`  
**Target:** Java 8–25 software engineer, tech lead, backend/platform engineer  
**Focus:** memahami Flyway sebagai *database change coordination engine*, bukan sekadar library untuk menjalankan SQL saat startup.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Menjelaskan **apa sebenarnya yang dilakukan Flyway** saat `migrate`, `validate`, `repair`, `baseline`, dan `clean`.
2. Membaca Flyway bukan sebagai “tool migration”, tetapi sebagai **state machine** antara:
   - source migration files,
   - target database,
   - schema history table,
   - release aplikasi,
   - dan kondisi production saat deployment.
3. Membedakan dengan tajam:
   - versioned migration,
   - repeatable migration,
   - baseline migration,
   - undo migration,
   - Java-based migration,
   - callback.
4. Memahami mengapa checksum, ordering, naming, dan immutability menjadi pusat dari keselamatan migration.
5. Menentukan kapan Flyway cocok, kapan Flyway perlu dibatasi, dan kapan mekanisme migration harus dipisah dari startup aplikasi.

Bagian ini belum fokus pada setup Maven/Gradle/Spring Boot. Itu dibahas di Part 5. Di sini kita fokus ke **model mental**.

---

## 1. Flyway dalam Satu Kalimat

Flyway adalah tool yang menjaga agar **database schema/data evolution** berjalan secara terurut, dapat dilacak, dapat divalidasi, dan reproducible berdasarkan sekumpulan migration files yang disimpan bersama source code.

Kalimat yang lebih engineering:

> Flyway membandingkan daftar migration yang tersedia di source code dengan daftar migration yang tercatat di database, lalu mengeksekusi migration yang belum pernah diterapkan, dalam urutan deterministik, sambil mencatat hasilnya ke schema history table.

Ini penting: Flyway tidak “mengingat” state dari aplikasi. Flyway mengingat state dari **database target** melalui table history.

---

## 2. Problem yang Diselesaikan Flyway

Tanpa Flyway, perubahan database biasanya terjadi lewat mekanisme rapuh:

```text
Developer membuat SQL
  ↓
SQL dikirim via chat/ticket/email
  ↓
DBA/manual operator menjalankan SQL
  ↓
Tidak semua environment sama
  ↓
Ada script lupa dijalankan
  ↓
Aplikasi gagal karena schema mismatch
  ↓
Team bingung: database ini versi berapa?
```

Flyway mencoba mengganti model itu menjadi:

```text
Migration disimpan di version control
  ↓
Migration punya nama, versi, checksum
  ↓
CI/CD menjalankan validate/migrate
  ↓
Database mencatat migration yang sudah applied
  ↓
Environment bisa dibandingkan berdasarkan history
  ↓
Perubahan database menjadi bagian dari release engineering
```

Flyway menyelesaikan beberapa pertanyaan operasional:

| Pertanyaan | Tanpa Flyway | Dengan Flyway |
|---|---|---|
| Script mana yang sudah jalan di DB ini? | Cek manual/tanya DBA | Lihat schema history table |
| Script dijalankan berapa kali? | Tidak jelas | Versioned migration hanya sekali |
| Script berubah setelah dijalankan? | Sulit tahu | Checksum mismatch saat validate |
| Environment UAT dan PROD sama? | Perlu diff manual | Bandingkan migration history |
| DB kosong harus dibuat dari mana? | Jalankan script manual | Jalankan semua migration dari awal atau baseline |
| Existing DB mau diadopsi bagaimana? | Sulit | Baseline |
| Script gagal di tengah? | Tergantung DB & operator | Status failed tercatat dan perlu recovery |

---

## 3. Flyway Bukan ORM dan Bukan Schema Diff Tool

Salah satu kesalahan awal adalah menyamakan Flyway dengan ORM schema generation.

Flyway tidak membaca entity Java lalu otomatis menyimpulkan perubahan schema. Flyway juga bukan tool utama untuk melakukan database diff otomatis dan langsung apply ke production.

### 3.1 Flyway vs Hibernate `ddl-auto`

Hibernate/JPA schema generation berpikir seperti ini:

```text
Entity model sekarang → database schema seharusnya seperti ini
```

Flyway berpikir seperti ini:

```text
Database sekarang berada di versi X
Migration source code punya V1, V2, V3, V4
Yang belum applied adalah V4
Apply V4
Catat hasilnya
```

Perbedaannya sangat besar.

Hibernate schema generation cocok untuk:

- local prototyping,
- throwaway test database,
- early proof-of-concept.

Flyway cocok untuk:

- production schema evolution,
- audited change,
- multi-environment deployment,
- CI/CD,
- controlled upgrade path.

Untuk sistem serius, jangan menjadikan ORM sebagai pemilik schema production. ORM boleh menjadi consumer dari schema contract, tetapi migration tool harus menjadi pemilik perubahan schema.

### 3.2 Flyway vs Schema Diff

Schema diff tool biasanya membandingkan:

```text
desired schema snapshot vs actual schema
```

Lalu menghasilkan SQL untuk mencapai desired state.

Flyway memakai pendekatan:

```text
ordered migration history
```

Dalam engineering production, ordered migration lebih defensible karena:

- perubahan punya konteks waktu,
- perubahan dapat di-review sebagai unit kecil,
- setiap environment punya jejak upgrade path,
- operasi destructive terlihat jelas,
- data migration bisa disisipkan pada titik yang tepat.

Schema diff tetap berguna, tetapi lebih cocok sebagai alat review/drift detection, bukan sebagai sumber utama production migration tanpa pemeriksaan manusia.

---

## 4. Core Mental Model: Source State vs Database State

Flyway selalu bekerja dengan dua dunia:

```text
┌──────────────────────────────┐
│ Source Code / Migration Files │
│                              │
│ V1__init.sql                  │
│ V2__add_customer_table.sql    │
│ V3__add_customer_status.sql   │
│ R__customer_view.sql          │
└───────────────┬──────────────┘
                │ compare
                ▼
┌──────────────────────────────┐
│ Target Database               │
│                              │
│ flyway_schema_history         │
│ actual tables/indexes/data    │
└──────────────────────────────┘
```

Flyway tidak hanya melihat apakah table ada. Flyway melihat apakah migration tertentu sudah tercatat sebagai applied.

Contoh source files:

```text
src/main/resources/db/migration/
  V1__create_customer.sql
  V2__create_order.sql
  V3__add_customer_email.sql
```

Contoh history database:

| installed_rank | version | description | script | checksum | success |
|---:|---|---|---|---:|---|
| 1 | 1 | create customer | V1__create_customer.sql | 12345 | true |
| 2 | 2 | create order | V2__create_order.sql | 67890 | true |

Saat `migrate`, Flyway menyimpulkan:

```text
V1 sudah applied
V2 sudah applied
V3 belum applied
→ execute V3
→ insert record V3 ke history
```

---

## 5. Schema History Table sebagai Ledger

Flyway membuat table history, secara default dikenal sebagai `flyway_schema_history`.

Secara mental, table ini adalah **ledger**. Bukan sekadar log biasa.

Ledger ini menjawab:

- migration apa yang sudah applied,
- urutannya apa,
- script file mana yang dipakai,
- checksum-nya apa,
- siapa yang menjalankan,
- kapan dijalankan,
- berapa lama durasinya,
- berhasil atau gagal.

Model sederhananya:

```text
Migration file in repo  ──applied to──>  Database
       │                                  │
       └──────── recorded as ─────────────┘
              flyway_schema_history
```

### 5.1 Kenapa History Table Penting?

Karena database tidak bisa dipercaya hanya dari bentuk fisiknya.

Dua database bisa punya table yang terlihat sama tetapi history berbeda:

```text
DB A:
V1 create customer
V2 add email
V3 backfill email
V4 add not-null constraint

DB B:
manual create customer table
manual alter email nullable
manual update data sebagian
```

Secara sekilas schema bisa mirip, tetapi operational risk sangat berbeda.

Top engineer tidak hanya bertanya:

> “Apakah column-nya ada?”

Tetapi:

> “Lewat jalur migration apa database ini sampai ke kondisi tersebut?”

---

## 6. Flyway sebagai State Machine

Flyway bisa dipahami sebagai state machine terhadap setiap migration.

```text
Available in source
       │
       │ migrate
       ▼
Pending ───────────────► Applied Success
       │                      │
       │ execution fails       │ validate checksum
       ▼                      ▼
Failed                 Valid / Invalid
```

Untuk source/database secara keseluruhan:

```text
No history table
   │
   ├─ empty schema → migrate from V1
   │
   └─ non-empty schema → baseline or fail

History exists
   │
   ├─ all migrations applied and valid → up-to-date
   ├─ new migrations exist → pending
   ├─ applied migration file changed → validation error
   ├─ applied migration missing from source → validation error/ignored depending config
   ├─ failed migration exists → repair/recovery needed
   └─ future migration exists in DB → source is older than DB
```

Model ini membantu saat incident. Jangan mulai dari “SQL apa yang error?” saja. Mulai dari state:

1. Apakah history table ada?
2. Apakah database kosong atau existing?
3. Apakah ada failed migration?
4. Apakah checksum mismatch?
5. Apakah source code lebih lama daripada database?
6. Apakah ada manual drift?
7. Apakah migration yang pending aman untuk app version ini?

---

## 7. Jenis Migration di Flyway

Flyway mengenal beberapa jenis migration utama:

1. Versioned migration.
2. Repeatable migration.
3. Baseline migration.
4. Undo migration.
5. Java-based migration.

Masing-masing punya mental model berbeda.

---

## 8. Versioned Migration

Versioned migration adalah migration yang punya versi eksplisit dan dijalankan **sekali saja** pada database target.

Contoh:

```text
V1__create_customer_table.sql
V2__add_customer_email_column.sql
V3__create_order_table.sql
```

Flyway mengeksekusi versioned migration berdasarkan urutan version.

```text
V1 → V2 → V3 → V4
```

### 8.1 Kapan Menggunakan Versioned Migration?

Gunakan untuk perubahan yang bersifat historis dan harus terjadi sebagai langkah upgrade:

- create table,
- add column,
- drop column,
- add constraint,
- create index,
- alter column type,
- backfill data kecil,
- update reference data versi tertentu,
- create seed data yang bagian dari release,
- change permission set,
- create sequence,
- create extension,
- one-time data correction.

### 8.2 Prinsip Versioned Migration

Versioned migration harus dianggap immutable setelah applied ke shared environment.

Artinya:

- jangan edit file migration lama,
- jangan rename file migration lama,
- jangan reformat file migration lama jika sudah applied,
- jangan mengubah comment sekalipun tanpa sadar dampak checksum,
- jika perlu perubahan, buat migration baru.

Alasan: Flyway menyimpan checksum. Jika file yang sudah applied berubah, validate dapat mendeteksi mismatch.

### 8.3 Contoh Baik

```sql
-- V2026_06_17_0900__add_customer_status.sql
ALTER TABLE customer ADD status VARCHAR(30);

UPDATE customer
SET status = 'ACTIVE'
WHERE status IS NULL;

ALTER TABLE customer ALTER COLUMN status SET NOT NULL;
```

Untuk table kecil ini mungkin acceptable. Untuk table besar, ini berbahaya karena update besar dan constraint langsung bisa lock lama. Dalam sistem besar, lebih baik dipisah menjadi expand/backfill/contract.

### 8.4 Contoh Lebih Production-Friendly

```sql
-- V2026_06_17_0900__expand_customer_status.sql
ALTER TABLE customer ADD status VARCHAR(30);
```

```sql
-- V2026_06_17_0930__seed_default_customer_status_small_env.sql
UPDATE customer
SET status = 'ACTIVE'
WHERE status IS NULL;
```

```sql
-- V2026_06_17_1000__add_customer_status_constraint.sql
ALTER TABLE customer ALTER COLUMN status SET NOT NULL;
```

Namun untuk volume besar, backfill sebaiknya bukan migration transaction besar, tetapi batch job terkontrol. Ini akan dibahas di Part 19 dan Part 20.

---

## 9. Repeatable Migration

Repeatable migration tidak punya version number. Ia dijalankan ulang ketika checksum berubah.

Contoh:

```text
R__customer_listing_view.sql
R__order_summary_view.sql
R__refresh_reporting_functions.sql
```

Mental model:

```text
Jika isi R__customer_listing_view.sql berubah
  → checksum berubah
  → Flyway menjalankannya ulang
```

Flyway menerapkan repeatable migration setelah versioned migration yang pending selesai. Repeatable migration diurutkan berdasarkan description/nama secara alfabetis.

### 9.1 Kapan Repeatable Migration Cocok?

Cocok untuk object database yang definisinya selalu ingin berada pada bentuk terbaru:

- view,
- stored function,
- stored procedure,
- package body,
- trigger definition,
- generated helper object,
- report view,
- compatibility view.

Contoh:

```sql
-- R__customer_listing_view.sql
CREATE OR REPLACE VIEW customer_listing_view AS
SELECT
    c.id,
    c.name,
    c.email,
    c.status
FROM customer c
WHERE c.deleted_at IS NULL;
```

### 9.2 Kenapa Harus `CREATE OR REPLACE`?

Karena repeatable migration bisa dijalankan ulang. Jika script-nya tidak aman dijalankan ulang, migration kedua bisa gagal.

Buruk:

```sql
CREATE VIEW customer_listing_view AS
SELECT id, name FROM customer;
```

Jika view sudah ada, script ini gagal.

Lebih baik:

```sql
CREATE OR REPLACE VIEW customer_listing_view AS
SELECT id, name FROM customer;
```

Catatan: sintaks berbeda per database. SQL Server bisa memakai `CREATE OR ALTER`. PostgreSQL punya keterbatasan tertentu pada `CREATE OR REPLACE VIEW` jika perubahan kolom tidak kompatibel. Oracle punya aturan invalidation object. Jadi tetap vendor-aware.

### 9.3 Anti-Pattern Repeatable Migration

Jangan memakai repeatable migration untuk semua hal hanya karena ingin “selalu latest”.

Buruk:

```text
R__all_tables.sql
R__all_seed_data.sql
R__current_schema.sql
```

Masalahnya:

- history perubahan hilang,
- review sulit,
- rollback reasoning sulit,
- repeat bisa merusak production data,
- ordering antar perubahan tidak jelas.

Repeatable bukan pengganti versioned migration.

### 9.4 Repeatable Migration untuk Seed Data?

Jawaban pendek: hati-hati.

Repeatable seed bisa masuk akal untuk **pure reference data** yang benar-benar dimiliki aplikasi dan bisa di-upsert deterministik.

Contoh relatif aman:

```sql
MERGE INTO country_ref AS target
USING (VALUES
    ('ID', 'Indonesia'),
    ('SG', 'Singapore'),
    ('MY', 'Malaysia')
) AS source(code, name)
ON target.code = source.code
WHEN MATCHED THEN UPDATE SET name = source.name
WHEN NOT MATCHED THEN INSERT (code, name) VALUES (source.code, source.name);
```

Namun berbahaya untuk:

- data yang bisa diedit user,
- config production yang dikelola operation,
- permission yang bisa dimodifikasi admin,
- tenant-specific data,
- data yang mengandung secret,
- data yang punya audit legal.

Seed data akan dibahas khusus di Part 17 dan Part 18.

---

## 10. Baseline dan Baseline Migration

Baseline adalah cara mengatakan:

> “Database ini sudah berada pada state tertentu. Mulai sekarang Flyway akan mengelola perubahan setelah titik ini.”

Ini penting saat mengadopsi Flyway pada existing database.

Tanpa baseline, Flyway melihat database non-empty tanpa history table dan tidak tahu apakah aman menjalankan `V1__init.sql`.

### 10.1 Situasi Baseline

Contoh:

```text
Production database sudah ada sejak 2021
Belum pernah pakai Flyway
Sekarang team ingin mulai pakai Flyway di 2026
```

Tidak mungkin menjalankan:

```text
V1__create_all_tables.sql
```

karena table sudah ada.

Maka team membuat baseline:

```text
Database production dianggap berada di version 100
Migration baru dimulai dari V101
```

### 10.2 Baseline Command vs Baseline Migration

Secara konseptual ada dua ide:

1. **Baseline existing database**: menandai database existing sebagai baseline version tertentu.
2. **Baseline migration file**: migration kumulatif yang bisa mempercepat pembuatan environment baru dari awal.

Contoh baseline existing:

```text
Existing PROD → baseline at version 100
Future migrations: V101, V102, V103
```

Contoh baseline migration:

```text
B100__baseline_schema.sql
V101__add_customer_status.sql
V102__add_order_index.sql
```

Baseline migration berguna jika history lama terlalu panjang, dan environment baru tidak perlu replay ratusan migration historis.

### 10.3 Risiko `baselineOnMigrate`

`baselineOnMigrate` dapat membuat Flyway otomatis melakukan baseline ketika migrate dijalankan pada schema non-empty tanpa history table.

Ini nyaman, tetapi berbahaya.

Risikonya:

- salah pointing database,
- schema seharusnya kosong ternyata tidak kosong,
- migration tidak jalan tetapi database dianggap baseline,
- production drift tertutup oleh baseline otomatis,
- kesalahan konfigurasi tidak fail fast.

Untuk production, baseline sebaiknya tindakan eksplisit dengan review.

---

## 11. Undo Migration

Undo migration adalah migration yang mencoba membalik efek versioned migration tertentu.

Contoh:

```text
V5__add_customer_status.sql
U5__add_customer_status.sql
```

Mental model:

```text
V5 apply forward change
U5 undo V5
```

Namun rollback database tidak sesederhana rollback code.

### 11.1 Kenapa Undo Migration Berbahaya?

Misalnya migration forward:

```sql
ALTER TABLE customer DROP COLUMN legacy_code;
```

Undo-nya mungkin:

```sql
ALTER TABLE customer ADD legacy_code VARCHAR(100);
```

Tetapi data lama sudah hilang. Secara schema bisa “undo”, tetapi secara informasi tidak bisa.

Contoh lain:

```sql
UPDATE invoice SET status = 'CANCELLED' WHERE expired_at < CURRENT_DATE;
```

Undo-nya apa? Status sebelumnya tidak diketahui kecuali disimpan.

### 11.2 Kapan Undo Migration Masuk Akal?

Undo bisa masuk akal untuk:

- dev/test database,
- reversible DDL sederhana,
- demo environment,
- perubahan yang tidak merusak data,
- migrasi yang memang menyimpan state lama,
- controlled deployment dengan strict rollback requirement.

Namun untuk production, strategi yang sering lebih sehat adalah:

```text
roll forward with corrective migration
```

bukan:

```text
blind undo
```

### 11.3 Prinsip Production Rollback

Rollback production harus menjawab:

1. Apakah schema rollback aman untuk app lama?
2. Apakah data yang berubah bisa dikembalikan?
3. Apakah traffic sempat menulis data dalam format baru?
4. Apakah ada background job yang sudah berjalan?
5. Apakah integration external sudah melihat data baru?
6. Apakah audit trail perlu mempertahankan perubahan?

Jika jawaban tidak jelas, undo migration bukan solusi.

---

## 12. Java-Based Migration

Flyway tidak hanya menjalankan SQL. Ia juga bisa menjalankan migration berbasis Java.

Mental model:

```text
Migration sebagai kode Java yang dieksekusi oleh Flyway pada titik version tertentu
```

Contoh nama class konseptual:

```text
V202606170930__BackfillCustomerStatus.java
```

### 12.1 Kapan Java Migration Diperlukan?

Gunakan Java migration jika SQL murni terlalu sulit atau tidak cukup ekspresif:

- transformasi data kompleks,
- parsing JSON/XML/CLOB,
- dekripsi/enkripsi ulang data,
- mapping legacy status ke state baru dengan rule kompleks,
- batch update dengan checkpoint ringan,
- validasi antar table yang rumit,
- penggunaan library Java internal.

### 12.2 Risiko Java Migration

Java migration membawa risiko tambahan:

- bisa memuat terlalu banyak data ke memory,
- bisa memanggil service external secara tidak deterministik,
- bisa bergantung pada versi application code yang berubah,
- bisa sulit di-review oleh DBA,
- bisa lebih lambat dari SQL set-based operation,
- bisa gagal di tengah dengan partial side effects,
- bisa mencampur business logic runtime dengan migration logic.

### 12.3 Prinsip Java Migration yang Aman

Java migration harus:

- deterministik,
- idempotent jika mungkin,
- chunked,
- memiliki logging progres,
- tidak memanggil API external kecuali benar-benar unavoidable,
- tidak bergantung pada mutable application service,
- memakai JDBC secara sadar,
- punya batas transaksi jelas,
- dites dengan database real via Testcontainers atau environment setara,
- punya recovery plan.

Contoh mental pattern:

```text
Read batch by primary key
  ↓
Transform deterministically
  ↓
Update by primary key with guard condition
  ↓
Commit
  ↓
Continue from last processed key
```

Bukan:

```text
SELECT * FROM huge_table
  ↓
Load all into List
  ↓
Loop and call remote API
  ↓
One giant transaction
```

---

## 13. Callback

Callback adalah hook lifecycle Flyway.

Mental model:

```text
beforeMigrate
  beforeEachMigrate
    execute migration
  afterEachMigrate
afterMigrate
```

Callback dapat berupa SQL callback atau Java callback tergantung setup.

### 13.1 Kapan Callback Berguna?

Callback berguna untuk cross-cutting concerns:

- set session variable,
- set lock timeout,
- set statement timeout,
- set application/module name di DB session,
- audit deployment event,
- emit metric,
- log start/end migration,
- validate environment guard,
- disable/enable trigger dalam situasi sangat terkendali,
- collect diagnostic info.

Contoh konseptual PostgreSQL:

```sql
-- beforeMigrate.sql
SET lock_timeout = '5s';
SET statement_timeout = '5min';
```

Contoh konseptual Oracle:

```sql
-- beforeMigrate.sql
BEGIN
  DBMS_APPLICATION_INFO.SET_MODULE('flyway-migration', 'release-2026-06-17');
END;
/
```

### 13.2 Anti-Pattern Callback

Jangan memakai callback untuk business migration utama.

Buruk:

```text
beforeMigrate.sql berisi alter table besar
```

Kenapa buruk?

- tidak terlihat sebagai migration version biasa,
- sulit dilacak sebagai perubahan domain,
- bisa berjalan pada waktu yang tidak diharapkan,
- membuat audit migration kacau.

Callback harus mendukung lifecycle, bukan menyembunyikan domain change.

---

## 14. Checksum sebagai Tamper Detection

Checksum adalah mekanisme Flyway untuk mendeteksi bahwa migration file yang sudah applied berubah.

Contoh:

```text
V2__add_customer_email.sql applied with checksum 123456
File sekarang checksum 999999
→ validate fails
```

Ini bukan bug. Ini fitur.

### 14.1 Kenapa Editing Migration Lama Berbahaya?

Misalnya V2 awal:

```sql
ALTER TABLE customer ADD email VARCHAR(255);
```

Sudah applied di UAT dan PROD.

Lalu developer mengubahnya menjadi:

```sql
ALTER TABLE customer ADD email VARCHAR(320);
```

Database baru dari awal akan punya email 320. Database lama punya email 255. Source code seolah satu versi, tetapi realita environment berbeda.

Checksum mencegah kebohongan ini.

### 14.2 Apa yang Dilakukan Jika Migration Lama Salah?

Jangan edit migration lama yang sudah applied ke shared environment.

Buat migration baru:

```sql
-- V3__increase_customer_email_length.sql
ALTER TABLE customer ALTER COLUMN email TYPE VARCHAR(320);
```

Dengan begitu history jujur:

```text
V2 add email 255
V3 increase email to 320
```

Production engineering butuh sejarah yang jujur, bukan sejarah yang diedit agar terlihat rapi.

---

## 15. Validate

`validate` memeriksa apakah migration source code masih konsisten dengan history database.

Secara mental:

```text
For each applied migration in DB history:
  find corresponding migration file
  compare metadata/checksum
  detect mismatch/missing/future/failed state
```

Validate menjawab:

> “Apakah source migration yang sekarang masih dapat dipercaya terhadap database ini?”

### 15.1 Validate Bukan Testing SQL

Validate tidak membuktikan bahwa migration baru pasti sukses. Validate terutama membuktikan bahwa applied migrations tidak berubah/missing secara tidak sah.

Untuk membuktikan migration baru sukses, kamu tetap perlu menjalankan migration pada database test.

### 15.2 Kapan Validate Harus Dijalankan?

Minimal:

- saat CI,
- sebelum deploy ke shared environment,
- sebelum migrate production,
- sebagai health check migration artifact,
- saat incident checksum mismatch.

Dalam banyak setup, validate otomatis berjalan saat migrate.

---

## 16. Repair

`repair` adalah command untuk memperbaiki metadata history Flyway dalam kondisi tertentu.

Repair bukan “memperbaiki database schema”. Repair memperbaiki catatan Flyway.

Contoh kasus:

- migration gagal dan perlu menghapus failed entry setelah manual cleanup,
- checksum berubah dan secara sadar ingin memperbarui checksum di history,
- metadata history perlu diselaraskan setelah investigasi.

### 16.1 Kenapa Repair Harus Dibatasi?

Repair dapat membuat Flyway “percaya” pada kondisi baru. Jika digunakan sembarangan, ia bisa menutupi perubahan ilegal.

Sebelum repair, harus jelas:

1. Apa yang berubah?
2. Siapa yang mengubah?
3. Apakah database object benar-benar sesuai?
4. Apakah perubahan hanya comment/formatting atau logic SQL?
5. Apakah semua environment terdampak?
6. Apakah ada approval?
7. Apakah perlu corrective migration daripada repair?

### 16.2 Mental Model Repair

```text
repair does not make schema correct
repair makes Flyway metadata consistent with chosen reality
```

Kalau “chosen reality”-nya salah, repair membuat sistem makin sulit dipulihkan.

---

## 17. Clean

`clean` menghapus object database yang dikelola pada schema target.

Mental model:

```text
Drop everything in configured schema(s)
```

Ini berguna untuk:

- local dev reset,
- integration test reset,
- ephemeral environment,
- CI database rebuild.

Ini sangat berbahaya untuk:

- UAT shared,
- staging shared,
- production,
- database dengan data real,
- database yang schema-nya tidak fully owned oleh aplikasi.

Flyway modern secara default men-disable clean untuk mencegah kecelakaan production.

### 17.1 Rule Praktis

Untuk production:

```text
cleanDisabled = true
```

Dan jangan hanya mengandalkan config. Batasi juga:

- credential migration user,
- network access,
- pipeline approval,
- environment guard,
- database-level permission.

Safety tidak boleh bergantung pada satu toggle.

---

## 18. Info

`info` memberi gambaran status migration.

Secara mental, ini seperti membaca dashboard state:

```text
Applied
Pending
Ignored
Future
Missing
Failed
Out of Order
Baseline
Repeatable outdated
```

Gunakan `info` saat:

- debugging deployment,
- membandingkan environment,
- sebelum migrate production,
- mencari migration pending,
- memahami failed migration.

Top engineer sering memulai investigasi dengan:

```text
flyway info
flyway validate
query flyway_schema_history
```

bukan langsung menjalankan SQL manual.

---

## 19. Migrate

`migrate` adalah command utama.

Pseudo-flow sederhana:

```text
load configuration
connect to database
ensure schema history table exists or handle baseline condition
scan migration locations
resolve migrations
validate if configured
acquire lock
find pending migrations
execute migrations in order
record each migration result
execute pending repeatables if checksum changed
release lock
```

### 19.1 Kenapa Lock Penting?

Tanpa lock, dua instance aplikasi bisa menjalankan migration bersamaan.

Contoh Kubernetes:

```text
Pod A starts → Flyway migrate V10
Pod B starts → Flyway migrate V10
```

Jika tidak dikontrol, hasilnya bisa:

- duplicate DDL attempt,
- deadlock,
- failed deployment,
- partial state,
- inconsistent history.

Flyway menggunakan mekanisme locking agar hanya satu migration process aktif pada satu target database pada satu waktu.

Namun secara arsitektur, untuk production Kubernetes, sering lebih baik menjalankan migration lewat **dedicated migration job** sebelum aplikasi rollout, bukan setiap pod menjalankan migration sendiri.

---

## 20. Naming Convention sebagai Contract

Flyway sangat bergantung pada naming convention.

Default umum:

```text
V<version>__<description>.sql
R__<description>.sql
U<version>__<description>.sql
B<version>__<description>.sql
```

Contoh:

```text
V1__init.sql
V2__create_customer.sql
V2026_06_17_0900__add_customer_status.sql
R__customer_listing_view.sql
U2__create_customer.sql
B100__baseline_schema.sql
```

### 20.1 Naming adalah Interface untuk Manusia

Nama migration dibaca oleh:

- developer,
- reviewer,
- DBA,
- release manager,
- auditor,
- incident responder,
- diri kamu sendiri 6 bulan kemudian.

Nama buruk:

```text
V12__fix.sql
V13__update.sql
V14__changes.sql
V15__new.sql
```

Nama baik:

```text
V2026_06_17_0900__add_customer_status_nullable.sql
V2026_06_17_0930__backfill_customer_status_active.sql
V2026_06_17_1000__enforce_customer_status_not_null.sql
```

Nama yang baik menjelaskan intention dan risiko.

---

## 21. Flyway Location sebagai Boundary

Migration files biasanya diletakkan di:

```text
src/main/resources/db/migration
```

Namun pada sistem besar, location bisa dipakai sebagai boundary:

```text
db/migration/common
 db/migration/customer
 db/migration/order
 db/migration/reporting
```

Atau:

```text
db/migration/postgresql
 db/migration/oracle
 db/migration/mysql
```

Hati-hati: semakin banyak location, semakin besar risiko ordering ambiguity dan ownership confusion.

Prinsip:

- location harus mencerminkan ownership,
- ordering tetap harus jelas,
- jangan membuat location per developer,
- jangan membuat location per environment kecuali benar-benar ada governance,
- vendor-specific location harus eksplisit.

---

## 22. Placeholders

Placeholder memungkinkan nilai tertentu diganti saat migration dijalankan.

Contoh konseptual:

```sql
INSERT INTO app_config(config_key, config_value)
VALUES ('external_base_url', '${externalBaseUrl}');
```

### 22.1 Kapan Placeholder Berguna?

Berguna untuk:

- schema name,
- tablespace name,
- environment label,
- application user name,
- optional feature flag default,
- DB-specific tuning value.

### 22.2 Risiko Placeholder

Placeholder bisa membuat migration tidak deterministik antar environment.

Contoh berbahaya:

```sql
INSERT INTO admin_user(username, password_hash)
VALUES ('admin', '${adminPasswordHash}');
```

Masalah:

- secret masuk migration,
- audit sulit,
- production value berbeda dari test,
- replay sulit,
- checksum script sama tetapi efek beda.

Prinsip:

```text
Placeholder boleh untuk deployment context,
tetapi jangan membuat business data menjadi unpredictable.
```

---

## 23. SQL Migration vs Java Migration vs External Job

Tidak semua perubahan harus menjadi Flyway SQL migration.

Decision model:

| Jenis Perubahan | Flyway SQL | Flyway Java | External Job |
|---|---:|---:|---:|
| Create small table | Cocok | Tidak perlu | Tidak perlu |
| Add nullable column | Cocok | Tidak perlu | Tidak perlu |
| Create view | Cocok, repeatable | Tidak perlu | Tidak perlu |
| Backfill 500 rows | Cocok | Bisa | Tidak perlu |
| Backfill 500 juta rows | Berisiko | Berisiko | Lebih cocok |
| Transform encrypted data | Sulit | Cocok | Cocok |
| Reindex large table online | Bisa, vendor-specific | Tidak | Bisa via controlled ops |
| Tenant migration thousands DB | Terbatas | Terbatas | Lebih cocok orchestrator |
| Long-running operational correction | Tidak ideal | Tidak ideal | Cocok |

Rule of thumb:

> Flyway bagus untuk perubahan yang relatif bounded, deterministic, dan bagian dari release path. Untuk pekerjaan data besar, gunakan Flyway untuk membuat struktur pendukung dan mencatat contract, lalu jalankan backfill via job terkontrol.

---

## 24. Flyway dan Application Startup

Banyak framework, terutama Spring Boot, memudahkan Flyway berjalan saat aplikasi start.

Ini nyaman untuk local/dev.

Namun untuk production, pertanyaannya:

> Apakah migration boleh terjadi sebagai side effect dari aplikasi start?

### 24.1 Startup Migration Cocok Jika

- single instance,
- database kecil,
- migration cepat,
- deployment sederhana,
- downtime acceptable,
- team kecil,
- environment tidak regulated.

### 24.2 Startup Migration Berisiko Jika

- Kubernetes multi-pod,
- rolling deployment,
- zero-downtime requirement,
- migration bisa lock lama,
- DB besar,
- compliance/audit ketat,
- approval DBA diperlukan,
- app startup timeout pendek,
- migration harus dipantau terpisah.

### 24.3 Production Pattern yang Lebih Aman

```text
CI builds application artifact
  ↓
CI validates migration artifact
  ↓
Deployment pipeline runs migration job
  ↓
Migration job succeeds
  ↓
Application rollout starts
  ↓
Post-deploy verification
```

Di Kubernetes:

```text
Job: app-db-migrate
  ↓ success
Deployment: app-service rollout
```

Aplikasi tetap bisa menyertakan Flyway dependency untuk local/dev, tetapi production menjalankan migration secara eksplisit.

---

## 25. Flyway dalam Release Compatibility

Migration tidak boleh hanya benar untuk versi aplikasi baru. Ia harus dipikirkan terhadap versi aplikasi lama saat deployment berlangsung.

### 25.1 Rolling Deployment Problem

Dalam rolling deployment:

```text
T0: old app + old schema
T1: migration applied → new schema
T2: some old pods still running
T3: new pods gradually replace old pods
```

Maka migration di T1 harus compatible dengan old app.

Contoh buruk:

```sql
ALTER TABLE customer DROP COLUMN full_name;
```

Jika old app masih membaca `full_name`, old app gagal.

Lebih aman:

```text
Release A:
  add first_name, last_name nullable
  app writes both old and new columns
  backfill new columns

Release B:
  app reads new columns
  keep old column

Release C:
  drop old column after no old app depends on it
```

Inilah expand/contract pattern, dibahas detail di Part 20.

---

## 26. Flyway dan Branching Conflict

Flyway terlihat linear, tetapi development team bekerja paralel.

Contoh:

```text
Branch feature-a creates V10__add_customer_flag.sql
Branch feature-b creates V10__add_order_index.sql
```

Saat merge, conflict version muncul.

### 26.1 Strategi Mengurangi Conflict

Beberapa pilihan:

1. Sequential integer version:

```text
V1, V2, V3
```

Mudah dibaca, tetapi rawan conflict.

2. Timestamp version:

```text
V2026_06_17_0900
V2026_06_17_0915
```

Mengurangi conflict, tetapi ordering perlu disiplin.

3. Release prefix:

```text
V2026_06_17_01
V2026_06_17_02
```

Bagus untuk release train.

4. Module prefix dalam description, bukan version:

```text
V2026_06_17_0900__customer_add_status.sql
V2026_06_17_0915__order_add_index.sql
```

### 26.2 Jangan Mengorbankan Ordering Semantik

Timestamp bukan berarti boleh asal urut. Jika migration B bergantung pada A, pastikan version B lebih tinggi dari A.

Buruk:

```text
V2026_06_17_1000__add_not_null_customer_status.sql
V2026_06_17_1030__backfill_customer_status.sql
```

Constraint dipasang sebelum backfill.

Baik:

```text
V2026_06_17_1000__add_customer_status_nullable.sql
V2026_06_17_1030__backfill_customer_status.sql
V2026_06_17_1100__add_not_null_customer_status.sql
```

---

## 27. Flyway dan Environment Drift

Environment drift terjadi ketika database berubah di luar jalur migration.

Contoh:

- DBA hotfix index langsung di PROD,
- developer alter table manual di UAT,
- seed data diedit manual,
- constraint di-disable untuk troubleshooting,
- view diubah langsung via SQL console,
- table dibuat oleh script lama.

Flyway history bisa tetap hijau, tetapi actual database drift.

```text
Migration history says: V1-V20 applied
Actual schema has: manual index, changed view, missing constraint
```

Flyway basic tidak selalu mendeteksi semua drift fisik. Checksum hanya mendeteksi migration file berubah, bukan semua manual DB changes.

### 27.1 Cara Mengelola Drift

- Batasi manual DB access.
- Semua change masuk migration baru.
- Gunakan schema diff sebagai audit tambahan.
- Review object definition untuk view/procedure.
- Capture emergency hotfix menjadi migration sesegera mungkin.
- Jalankan drift detection di CI/CD jika tooling tersedia.
- Gunakan database audit untuk DDL.

Prinsip:

> Manual hotfix boleh terjadi saat incident besar, tetapi harus menjadi migration formal setelah itu. Kalau tidak, production menjadi fork dari source code.

---

## 28. Flyway dan Multi-Schema

Banyak enterprise database tidak hanya satu schema.

Contoh Oracle:

```text
APP_OWNER
APP_RUNTIME
REPORTING
AUDIT
INTEGRATION
```

Flyway bisa dikonfigurasi dengan schema tertentu. Namun mental model ownership harus jelas.

Pertanyaan penting:

1. Schema mana yang menyimpan `flyway_schema_history`?
2. User migration punya privilege ke schema mana?
3. Apakah semua schema dimiliki aplikasi yang sama?
4. Apakah ada shared schema yang dipakai aplikasi lain?
5. Apakah ordering antar schema penting?
6. Apakah object cross-schema punya dependency?

### 28.1 Anti-Pattern Multi-Schema

Buruk:

```text
Satu Flyway run punya privilege superuser ke semua schema tanpa boundary.
```

Lebih baik:

```text
Per aplikasi/per bounded context punya migration ownership jelas.
Migration user punya privilege minimal sesuai kebutuhan.
```

---

## 29. Flyway dan Multi-Database Product

Jika aplikasi mendukung PostgreSQL, Oracle, SQL Server, dan MySQL, migration menjadi lebih kompleks.

Pilihan:

1. Satu migration SQL portable.
2. Vendor-specific migration location.
3. Java migration abstraction.
4. Liquibase-style abstraction lebih cocok.
5. Batasi supported DB feature subset.

Flyway cenderung SQL-first. Ini kuat karena jujur terhadap database, tetapi portability tidak otomatis.

Contoh issue:

| Concern | PostgreSQL | Oracle | MySQL | SQL Server |
|---|---|---|---|---|
| Boolean | native `boolean` | sering `NUMBER(1)`/`CHAR(1)` | `TINYINT(1)` | `BIT` |
| Sequence | sequence/identity | sequence/identity | auto increment | identity/sequence |
| Text large | `text` | `CLOB` | `TEXT` | `NVARCHAR(MAX)` |
| Online index | `CONCURRENTLY` | online options | online DDL varies | edition-dependent |
| Transactional DDL | many DDL transactional | implicit commit behavior | varies | varies |

Jika target hanya satu database enterprise, gunakan kekuatan vendor. Jika target multi-DB, desain migration strategy dari awal.

---

## 30. Flyway dan Auditability

Flyway membantu audit, tetapi tidak otomatis memenuhi semua kebutuhan audit.

Flyway memberi:

- migration history,
- checksum,
- installed date,
- installed by,
- execution time,
- success/failure.

Namun audit enterprise/regulatory biasanya juga butuh:

- change request ID,
- approval evidence,
- reviewer,
- release version,
- deployment window,
- rollback plan,
- data impact assessment,
- privilege approval,
- production log retention,
- segregation of duties.

Maka migration file sebaiknya mengandung metadata minimal:

```sql
-- Change Request: CR-2026-0142
-- Release: 2026.06.17
-- Module: Customer Management
-- Risk: additive nullable column, backward-compatible
-- Rollback: roll-forward via V_next if required
-- Data impact: no existing row modified

ALTER TABLE customer ADD customer_segment VARCHAR(30);
```

Bukan karena Flyway butuh, tetapi karena manusia dan audit butuh.

---

## 31. Flyway sebagai Contract, Bukan Hanya Tool

Dalam organisasi matang, Flyway menjadi bagian dari contract:

```text
Semua perubahan schema production harus melalui migration file.
Migration file immutable setelah applied.
Migration harus lolos review.
Migration harus diuji dari previous release ke current release.
Migration harus compatible dengan deployment strategy.
Migration harus punya rollback/roll-forward reasoning.
```

Tool bisa diganti, tetapi contract harus tetap.

Flyway hanyalah implementasi dari disiplin:

```text
database change is code
code must be versioned
versioned change must be reviewed
deployed change must be auditable
auditable change must be recoverable
```

---

## 32. Contoh End-to-End Mental Simulation

Kita ambil skenario sederhana: menambahkan status customer.

### 32.1 Naive Migration

```sql
-- V10__add_customer_status.sql
ALTER TABLE customer ADD status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
```

Tampak sederhana, tetapi pertanyaan production:

1. Table customer berapa besar?
2. Apakah DB melakukan table rewrite?
3. Apakah default + not null akan lock lama?
4. Apakah old app tahu column ini?
5. Apakah insert lama tanpa column status tetap berhasil?
6. Apakah status baru perlu enum/reference table?
7. Apakah reporting view perlu update?
8. Apakah seed status perlu ada?
9. Apakah rollback aman?

### 32.2 Better Migration Plan

Release 1, expand:

```sql
-- V10__customer_add_status_nullable.sql
ALTER TABLE customer ADD status VARCHAR(20);
```

Release 1, app change:

```text
New app writes status for new/updated customers.
Old app still works because column nullable.
```

Backfill:

```sql
-- V11__customer_backfill_status_for_small_table.sql
UPDATE customer
SET status = 'ACTIVE'
WHERE status IS NULL;
```

Untuk table besar, gunakan external job.

Release 2, contract:

```sql
-- V12__customer_status_not_null.sql
ALTER TABLE customer ALTER COLUMN status SET NOT NULL;
```

Repeatable view update:

```sql
-- R__customer_listing_view.sql
CREATE OR REPLACE VIEW customer_listing_view AS
SELECT id, name, status
FROM customer;
```

Mental model-nya:

```text
V10 safe for old app
V11 fills old data
App reads/writes new field
V12 enforces invariant after data is clean
R view always reflects latest projection
```

---

## 33. Common Misconceptions

### Misconception 1 — “Kalau pakai Flyway, migration pasti aman.”

Salah. Flyway membuat migration terurut dan terlacak. Ia tidak otomatis membuat SQL aman terhadap lock, data loss, atau compatibility.

### Misconception 2 — “Rollback tinggal pakai undo.”

Salah. Rollback database sering tidak mungkin tanpa kehilangan informasi. Roll-forward sering lebih realistis.

### Misconception 3 — “Edit migration lama lebih rapi daripada buat migration baru.”

Salah untuk shared/prod environment. History yang rapi palsu lebih berbahaya daripada history yang jujur.

### Misconception 4 — “Repeatable migration lebih fleksibel, jadi pakai semua repeatable.”

Salah. Repeatable cocok untuk latest-definition object, bukan semua historical change.

### Misconception 5 — “Migration harus selalu jalan saat app startup.”

Salah. Startup migration nyaman, tetapi production-grade pipeline sering memisahkan migration job dari application rollout.

### Misconception 6 — “Flyway menggantikan DBA.”

Salah. Flyway memberi process dan automation. DBA/database engineer tetap penting untuk review lock, performance, storage, privilege, backup, dan recovery.

---

## 34. Decision Checklist: Apakah Change Ini Cocok Masuk Flyway?

Sebelum menulis Flyway migration, tanyakan:

1. Apakah change ini deterministic?
2. Apakah bisa dijalankan dalam durasi deployment yang aman?
3. Apakah transaction/lock behavior dipahami?
4. Apakah compatible dengan versi aplikasi lama saat rolling deployment?
5. Apakah change destructive?
6. Apakah ada data loss?
7. Apakah perlu backfill besar?
8. Apakah perlu pause/resume?
9. Apakah perlu observability progress?
10. Apakah perlu approval DBA/security?
11. Apakah seed data-nya owned oleh aplikasi?
12. Apakah environment-specific?
13. Apakah rollback/roll-forward plan jelas?
14. Apakah migration bisa diuji dari previous release database?
15. Apakah migration file akan tetap immutable setelah applied?

Jika banyak jawaban belum jelas, jangan buru-buru menulis SQL. Desain migration plan dulu.

---

## 35. Flyway Fit/Not-Fit Matrix

| Situasi | Flyway Fit? | Catatan |
|---|---:|---|
| Add nullable column | Sangat fit | Biasanya aman, tetap cek lock |
| Create new table | Sangat fit | Pastikan ownership jelas |
| Add small lookup seed | Fit | Gunakan idempotent/natural key bila perlu |
| Create/replace view | Fit | Repeatable migration cocok |
| Add large index online | Fit dengan caution | Vendor-specific, cek lock |
| Drop column used by old app | Tidak langsung | Butuh expand/contract |
| Backfill millions rows | Partial | Flyway bisa prepare, job external lebih aman |
| Data correction legal/financial | Caution | Perlu audit dan validation kuat |
| Per-tenant migration ribuan tenant | Caution | Butuh orchestration tambahan |
| Emergency production hotfix | Bisa setelah formalized | Jangan biarkan manual drift permanen |
| Reset local DB | Fit | `clean` boleh di local/test |
| Reset production DB | Tidak | Jangan |

---

## 36. Practical Mental Rules

Gunakan aturan ini sebagai pegangan:

1. **Migration adalah bagian dari release, bukan task sampingan.**
2. **Schema history table adalah ledger, perlakukan seperti audit record.**
3. **Versioned migration lama immutable setelah applied.**
4. **Repeatable migration untuk object definisi terbaru, bukan pengganti history.**
5. **Baseline adalah adopsi state, bukan pembersih kekacauan.**
6. **Repair memperbaiki metadata, bukan schema.**
7. **Clean tidak boleh tersedia di production.**
8. **Undo bukan rollback strategy yang cukup.**
9. **Migration harus compatible dengan deployment topology.**
10. **Untuk data besar, orchestration lebih penting daripada tool.**
11. **Jangan percaya H2/local test untuk membuktikan production DDL aman.**
12. **Manual DB change harus diformalkan kembali ke migration.**
13. **Flyway membantu disiplin, tetapi tidak menggantikan desain.**

---

## 37. Mini Exercise

Gunakan skenario berikut untuk melatih mental model.

### Scenario A

Kamu punya migration:

```text
V1__create_user.sql
V2__add_user_email.sql
V3__add_user_status.sql
```

UAT sudah apply V1–V3. Lalu developer mengubah V2 karena ingin email length dari 255 ke 320.

Pertanyaan:

1. Apa yang akan terjadi saat validate?
2. Kenapa edit V2 salah?
3. Migration baru apa yang seharusnya dibuat?

Jawaban mental:

1. Checksum mismatch.
2. Karena UAT/PROD sudah punya history V2 lama; mengubah file lama membuat source history tidak jujur.
3. Buat `V4__increase_user_email_length.sql`.

### Scenario B

Production database sudah ada 5 tahun tanpa Flyway. Team ingin mulai pakai Flyway.

Pertanyaan:

1. Apakah `V1__create_all_tables.sql` langsung dijalankan ke PROD?
2. Apa konsep yang dibutuhkan?
3. Migration berikutnya mulai dari mana?

Jawaban mental:

1. Tidak.
2. Baseline.
3. Dari version setelah baseline, misalnya V101.

### Scenario C

Ada table 200 juta rows. Kamu perlu mengisi column baru berdasarkan rule kompleks.

Pertanyaan:

1. Apakah satu Flyway SQL `UPDATE` besar ideal?
2. Apa alternatifnya?
3. Flyway tetap berperan di mana?

Jawaban mental:

1. Biasanya tidak.
2. External batch/backfill job dengan chunking, checkpoint, throttle, observability.
3. Flyway menambahkan column/table pendukung dan mungkin mencatat contract/cutover migration.

---

## 38. Ringkasan

Flyway harus dipahami sebagai mekanisme koordinasi perubahan database yang berbasis history.

Inti modelnya:

```text
Migration files in source control
  +
Schema history table in target database
  +
Deterministic ordering/checksum
  =
Controlled database evolution
```

Flyway kuat karena sederhana:

- migration diberi nama,
- migration diurutkan,
- migration dijalankan sekali atau repeat berdasarkan checksum,
- hasil dicatat,
- perubahan file lama terdeteksi.

Tetapi kesederhanaan ini juga berarti Flyway tidak otomatis menyelesaikan:

- lock risk,
- data volume risk,
- zero-downtime compatibility,
- rollback data loss,
- environment drift fisik,
- multi-tenant orchestration,
- governance compliance penuh.

Top engineer menggunakan Flyway bukan sebagai “magic migration tool”, tetapi sebagai salah satu komponen dalam database release engineering.

---

## 39. Referensi Resmi dan Bacaan Lanjutan

- Redgate Flyway Documentation — Migrations: menjelaskan migration sebagai versioned, repeatable, dan baseline, serta regular/undo migration.
- Redgate Flyway Documentation — Versioned Migrations: versioned migration diterapkan berurutan dan hanya sekali, dengan tracking di `flyway_schema_history`.
- Redgate Flyway Documentation — Repeatable Migrations: repeatable migration dijalankan setelah versioned migration dan perlu aman untuk dijalankan ulang.
- Redgate Flyway Documentation — Undo Migrations: undo migration tersedia untuk membalik versioned migration tertentu, tetapi tidak berlaku untuk repeatable migration.
- Redgate Flyway Documentation — Baselines dan Baseline Migrations: baseline menandai starting state untuk database existing atau cumulative migration.
- Redgate Flyway Documentation — Validate, Repair, Clean settings: validate menjaga konsistensi source/history, repair mengubah metadata history, dan clean sebaiknya disabled untuk production.

---

## 40. Posisi dalam Seri

Kita sudah menyelesaikan:

- Part 0 — Orientation: Database Change as Engineering Discipline
- Part 1 — Taxonomy of Database Changes
- Part 2 — Migration Invariants and Failure Models
- Part 3 — Versioning Models for Database Schema
- Part 4 — Flyway Mental Model

Seri belum selesai.

Part berikutnya:

```text
05-flyway-setup-java-8-to-25.md
```


# 10 — Flyway Baseline, Repair, Validate, and Clean

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Part: 10 dari 34  
> File: `10-flyway-baseline-repair-validate-clean.md`  
> Fokus: operasi kritis Flyway untuk existing database, checksum mismatch, migration drift, failed migration, dan destructive reset.

---

## 1. Kenapa Bagian Ini Penting

Sampai titik ini kita sudah membahas Flyway sebagai migration runner yang membaca migration dari lokasi tertentu, membandingkannya dengan `flyway_schema_history`, lalu menjalankan migration yang belum pernah dijalankan.

Namun di sistem nyata, yang paling menentukan kualitas engineer bukan hanya kemampuan menulis file:

```text
V1__create_table.sql
V2__add_index.sql
V3__seed_lookup.sql
```

Yang lebih menentukan adalah kemampuan menjawab pertanyaan seperti:

- Bagaimana mengadopsi Flyway pada database production yang sudah ada selama bertahun-tahun?
- Apa yang harus dilakukan saat `validate` gagal karena checksum mismatch?
- Kapan `repair` boleh digunakan dan kapan justru menyembunyikan masalah?
- Apa yang terjadi saat migration gagal di tengah jalan?
- Bagaimana membedakan repair metadata dengan repair actual database object?
- Kenapa `clean` harus dianggap sebagai destructive weapon, bukan convenience command?
- Bagaimana membuat runbook production saat migration failure terjadi?

Flyway bukan hanya tool untuk menjalankan SQL. Flyway adalah **state reconciliation engine** antara:

```text
source migration files
        |
        v
resolved migration model
        |
        v
flyway_schema_history
        |
        v
actual database objects and data
```

Masalah muncul ketika empat hal tersebut tidak lagi sinkron.

Part ini membahas empat command penting:

1. `baseline`
2. `validate`
3. `repair`
4. `clean`

Keempatnya terlihat sederhana, tetapi secara operasional sangat sensitif.

---

## 2. Core Mental Model

Flyway mengandalkan satu prinsip besar:

> Migration history adalah kontrak bahwa database sudah melewati urutan perubahan tertentu.

Flyway menyimpan metadata migration pada schema history table. Dokumentasi resmi Redgate menyebut schema history table sebagai audit trail perubahan schema, berisi migration yang sudah dijalankan, checksum, dan status keberhasilan migration.  
Referensi: <https://documentation.red-gate.com/fd/flyway-schema-history-table-273973417.html>

Artinya, untuk Flyway, database bukan hanya kumpulan table/index/view. Database juga memiliki **riwayat perubahan**.

Perhatikan perbedaan ini:

```text
Physical state:
- Table customer ada
- Column email ada
- Index idx_customer_email ada

Historical state:
- V1__create_customer_table.sql pernah berhasil
- V2__add_customer_email.sql pernah berhasil
- V3__add_customer_email_index.sql pernah berhasil
```

Dua state ini bisa berbeda.

Contoh:

```text
Physical state:
- Table customer ada

Historical state:
- Flyway tidak mencatat V1 pernah jalan
```

Atau sebaliknya:

```text
Historical state:
- V1 tercatat sukses

Physical state:
- Table yang dibuat V1 sudah dihapus manual oleh DBA
```

Flyway terutama memverifikasi **historical state**, bukan melakukan full database diff terhadap semua object fisik. Ini penting.

### 2.1 Flyway Tidak Sama dengan Schema Diff Tool

Flyway tidak secara default bertanya:

```text
Apakah seluruh struktur database sekarang identik dengan hasil ideal semua migration?
```

Flyway lebih bertanya:

```text
Migration mana yang sudah tercatat?
Migration mana yang tersedia di source?
Apakah migration yang pernah dijalankan masih sama checksum-nya?
Migration mana yang perlu dijalankan berikutnya?
```

Jadi kalau seseorang mengubah table secara manual langsung di database, Flyway bisa saja tidak tahu, kecuali perubahan itu menyebabkan migration berikutnya gagal atau validation scenario tertentu.

Top-tier engineer harus memahami batas ini. Flyway adalah migration history tool, bukan magic database governance system.

---

## 3. Command Map

Empat command dalam part ini punya fungsi berbeda:

| Command | Tujuan Utama | Mengubah DB Object? | Mengubah History Table? | Risiko |
|---|---:|---:|---:|---|
| `baseline` | Mulai mengelola existing database dari versi tertentu | Tidak langsung membuat object bisnis | Ya | Salah baseline bisa membuat migration penting tidak pernah jalan |
| `validate` | Memastikan migration source konsisten dengan history | Tidak | Tidak | Bisa menggagalkan deployment jika source berubah |
| `repair` | Memperbaiki metadata history table | Tidak memperbaiki object bisnis | Ya | Bisa menyembunyikan root cause jika dipakai sembarangan |
| `clean` | Menghapus object di schema yang dikelola | Ya, destructive | Tergantung hasil reset | Sangat tinggi, production data loss |

Mental model:

```text
baseline = declare starting point
validate = detect history/source mismatch
repair   = fix metadata, not business schema
clean    = destroy managed schema objects
```

---

# SECTION A — BASELINE

---

## 4. Apa Itu Baseline

`baseline` digunakan saat database sudah berisi object sebelum Flyway diperkenalkan.

Contoh situasi:

```text
Tahun 2020-2026:
- Aplikasi sudah production
- Schema dibuat manual, lewat Hibernate ddl-auto, script DBA, atau tool lama
- Belum ada Flyway

Tahun 2026:
- Team ingin mulai memakai Flyway
```

Masalahnya:

Flyway tidak bisa begitu saja menjalankan:

```text
V1__create_existing_tables.sql
V2__create_existing_indexes.sql
V3__seed_existing_lookup.sql
```

Karena object sudah ada.

Jika `V1` berisi:

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    username VARCHAR(100) NOT NULL
);
```

Lalu table `users` sudah ada di production, maka migration gagal:

```text
ERROR: table users already exists
```

Baseline menyelesaikan masalah ini dengan mengatakan:

> Anggap database ini sudah berada pada versi tertentu. Mulai dari migration setelah versi itu.

---

## 5. Baseline sebagai Pernyataan Historis

Baseline bukan membuat database menjadi benar. Baseline hanya membuat Flyway **menganggap** database sudah benar sampai titik tertentu.

Contoh:

```text
Existing production schema dianggap equivalent dengan version 100.

Flyway baseline version = 100

Maka migration yang akan jalan setelah baseline:
- V101__add_new_column.sql
- V102__create_new_index.sql
- V103__seed_new_permission.sql
```

Migration <= 100 dianggap sudah tercakup oleh kondisi existing database.

Ini berarti baseline adalah **trust declaration**.

Kalau existing database sebenarnya tidak cocok dengan baseline script, Flyway tidak otomatis memperbaiki.

---

## 6. Kapan Baseline Diperlukan

Baseline cocok untuk:

1. Existing production database yang belum memakai Flyway.
2. Database yang dibuat dari restore backup/snapshot, lalu ingin dikelola Flyway dari titik tertentu.
3. Legacy schema yang terlalu besar untuk direkonstruksi dari migration historis.
4. Migrasi dari tool lama ke Flyway.
5. Aplikasi enterprise yang awalnya dibuat manual oleh DBA.

Baseline tidak cocok untuk:

1. Database baru dari nol.
2. Menutupi migration yang gagal.
3. Menyembunyikan drift antar environment.
4. Menghindari pekerjaan membuat initial schema script.
5. Mengakali checksum mismatch.

---

## 7. Baseline Strategy untuk Existing Database

Ada dua strategi utama.

### 7.1 Baseline Metadata-Only

Kita menjalankan `flyway baseline` pada existing DB, tanpa membuat migration besar untuk schema existing.

Struktur migration:

```text
src/main/resources/db/migration/
  V101__add_customer_risk_score.sql
  V102__create_case_assignment_index.sql
  V103__seed_new_case_status.sql
```

Flyway history akan memiliki marker baseline:

```text
version = 100
state   = Baseline
```

Kelebihan:

- Cepat mengadopsi Flyway.
- Tidak perlu reverse-engineer seluruh legacy schema.
- Cocok jika schema sangat besar.

Kekurangan:

- Database baru tidak bisa dibangun dari nol hanya dari repository.
- Developer onboarding sulit jika tidak ada dump/snapshot.
- Audit historis sebelum baseline tidak ada di Flyway.
- Drift existing object sulit diketahui.

Cocok untuk:

```text
Large legacy enterprise database
+ production sudah lama
+ tidak feasible membuat ulang semua migration historis
+ punya backup/dump baseline resmi
```

### 7.2 Baseline with Initial Snapshot Script

Kita membuat satu script besar yang merepresentasikan schema existing:

```text
V100__baseline_existing_schema.sql
V101__add_customer_risk_score.sql
V102__create_case_assignment_index.sql
```

Tetapi script `V100` biasanya tidak dijalankan di production existing. Production dibaseline pada version 100. Database baru bisa menjalankan `V100` dari nol.

Kelebihan:

- Database baru bisa dibuat dari repository.
- Developer environment lebih mudah.
- CI fresh migration test lebih realistis.
- Baseline state terdokumentasi.

Kekurangan:

- Membuat initial snapshot script butuh effort.
- Script besar sulit review.
- Bisa tidak sepenuhnya portable.
- Perlu validasi terhadap production schema.

Cocok untuk:

```text
Legacy DB cukup penting
+ team ingin long-term maintainability
+ ada waktu membuat canonical baseline script
```

---

## 8. Recommended Baseline Adoption Workflow

Untuk sistem production serius, gunakan workflow berikut.

### Step 1 — Freeze Manual Schema Change

Sebelum Flyway diperkenalkan:

```text
Stop semua manual DDL kecuali emergency.
```

Jika manual DDL masih berlangsung paralel, baseline akan langsung usang.

### Step 2 — Extract Current Schema

Ambil struktur existing database:

- Table
- Column
- Constraint
- Index
- Sequence/identity
- View
- Function/procedure/package
- Trigger
- Synonym jika DB seperti Oracle
- Grant/role jika dikelola sebagai bagian schema

### Step 3 — Decide Baseline Version

Contoh pilihan:

```text
V1    = baseline existing schema
V1000 = baseline existing schema
V202606170900 = baseline existing schema
```

Untuk enterprise, saya lebih suka baseline version yang jelas sebagai marker:

```text
V202606170000__baseline_existing_production_schema.sql
```

Atau kalau ingin ruang untuk migration historis manual:

```text
V1000__baseline_existing_production_schema.sql
```

Yang penting: konsisten.

### Step 4 — Create Baseline Artifact

Minimal:

```text
baseline/
  production-schema-ddl-2026-06-17.sql
  production-object-inventory-2026-06-17.csv
  baseline-decision-record.md
```

Kalau memakai migration snapshot:

```text
src/main/resources/db/migration/
  V1000__baseline_existing_schema.sql
```

### Step 5 — Validate in Clone Environment

Jangan baseline langsung di production.

Gunakan clone/snapshot:

```text
production snapshot -> staging clone -> run flyway baseline -> run future migrations
```

### Step 6 — Apply Baseline in Lower Environments

Urutan:

```text
DEV clone
SIT/UAT clone
STAGING clone
PROD
```

Jangan jadikan production sebagai tempat eksperimen pertama.

### Step 7 — Lock the Policy

Setelah baseline:

```text
Semua DB change harus lewat migration.
Manual DDL hanya emergency dengan follow-up migration reconciliation.
```

Tanpa policy ini, Flyway hanya menjadi dekorasi.

---

## 9. Baseline Anti-Patterns

### 9.1 Baseline untuk Mengabaikan Error

Buruk:

```text
V1 gagal karena table exists.
Solusi: baseline ke V1.
```

Ini bisa benar hanya jika table benar-benar equivalent dengan V1. Kalau tidak, kita hanya menipu Flyway.

### 9.2 Baseline Version Terlalu Rendah

Misalnya existing schema sebenarnya sudah mencakup perubahan sampai V50, tetapi baseline ke V10.

Akibat:

```text
V11-V50 akan dijalankan lagi
-> object already exists
-> duplicate data
-> constraint conflict
```

### 9.3 Baseline Version Terlalu Tinggi

Existing schema baru mencakup perubahan sampai V50, tetapi baseline ke V100.

Akibat:

```text
V51-V100 tidak pernah dijalankan
-> missing column/table/index/data
-> aplikasi gagal runtime
```

Ini lebih berbahaya karena bisa tidak langsung kelihatan.

### 9.4 Baseline Without Evidence

Buruk:

```text
Kita baseline aja ke V100 karena kira-kira schema sudah sama.
```

Baik:

```text
Baseline version V100 dipilih berdasarkan:
- schema export timestamp
- object inventory
- comparison dengan staging
- approval DBA/app team
- migration adoption record
```

---

# SECTION B — VALIDATE

---

## 10. Apa Itu Validate

`validate` membandingkan migration yang sudah diterapkan di database dengan migration yang tersedia di source code/classpath/filesystem.

Dokumentasi resmi menjelaskan bahwa `validate` memvalidasi applied migrations terhadap available migrations. Untuk SQL migration, checksum disimpan ketika migration dijalankan dan dipakai untuk mendeteksi perubahan file setelah diterapkan.  
Referensi: <https://documentation.red-gate.com/fd/validate-277578898.html>

Intinya:

> Validate menjawab: apakah source migration kita masih konsisten dengan history database?

---

## 11. Kenapa Validate Penting

Tanpa validate, skenario ini bisa lolos:

```text
Senin:
V5__add_customer_type.sql dijalankan di DEV dan UAT.

Selasa:
Developer mengedit isi V5 karena ingin memperbaiki typo.

Rabu:
Production belum menjalankan V5.
UAT sudah menjalankan V5 versi lama.
Source code sekarang punya V5 versi baru.
```

Sekarang environment tidak lagi punya definisi migration yang sama.

Jika ini dibiarkan:

- UAT dan PROD bisa punya hasil berbeda untuk version yang sama.
- Rebuild database dari nol tidak menghasilkan state yang sama.
- Audit trail menjadi tidak dapat dipercaya.
- Debugging menjadi sangat sulit.

Validate mencegah ini.

---

## 12. Checksum Mental Model

Flyway menghitung checksum dari migration file.

Saat migration dijalankan:

```text
File: V5__add_customer_type.sql
Checksum: 123456789
Stored in flyway_schema_history
```

Saat validate:

```text
Current file checksum: 987654321
Stored checksum:       123456789
```

Hasil:

```text
Validation failed: checksum mismatch
```

Checksum mismatch berarti:

> File migration yang dulu pernah dijalankan tidak lagi sama dengan file yang sekarang tersedia.

Ini bukan sekadar error teknis. Ini sinyal bahwa chain of custody migration rusak.

---

## 13. Apa Saja yang Bisa Membuat Validate Gagal

### 13.1 Checksum Mismatch

Penyebab:

- File lama diedit.
- Whitespace/comment berubah, tergantung checksum handling versi/tooling.
- Line ending berubah.
- Placeholder behavior berubah.
- Encoding berubah.
- Build process memodifikasi file.

Contoh:

```text
V12__create_order_table.sql
DB checksum      = 111
Source checksum  = 222
```

### 13.2 Description Mismatch

File rename dari:

```text
V12__create_order_table.sql
```

menjadi:

```text
V12__create_orders_table.sql
```

Walaupun SQL sama, metadata description berubah.

### 13.3 Type Mismatch

Contoh migration yang dulu SQL sekarang menjadi Java migration dengan version sama.

```text
V12__create_order_table.sql
V12__create_order_table.java
```

### 13.4 Applied Migration Missing from Source

Database punya record:

```text
V7__add_case_priority.sql applied
```

Tetapi file hilang dari repository/artifact.

Ini bisa terjadi karena:

- File dihapus.
- Branch salah.
- Packaging salah.
- Location Flyway salah.
- Migration ada di module lain tapi tidak ikut deploy.

### 13.5 Resolved Migration Not Applied

Ada migration di source yang belum diterapkan.

Dalam beberapa mode ini normal sebelum `migrate`, tetapi dalam context validate-only pipeline bisa menjadi sinyal bahwa environment belum update.

### 13.6 Failed Migration Record

Migration pernah gagal dan meninggalkan record failed di history table, terutama pada database yang DDL-nya tidak sepenuhnya transactional.

---

## 14. Validate di CI/CD

Validate harus dijalankan di beberapa titik.

### 14.1 Local Developer

Sebelum push:

```bash
flyway validate
flyway migrate
```

Atau via Maven:

```bash
mvn flyway:validate
```

Atau Gradle:

```bash
./gradlew flywayValidate
```

### 14.2 Pull Request Pipeline

PR harus mengecek:

```text
- migration naming valid
- no duplicate version
- validate against test DB
- migrate fresh DB
- migrate previous-release DB
```

### 14.3 Pre-Deployment

Sebelum production migration:

```text
validate -> info -> preflight checks -> migrate
```

Kalau validate gagal, jangan lanjut migrate.

---

## 15. Cara Merespons Validate Failure

Jangan langsung `repair`.

Gunakan decision tree:

```text
Validate failed
│
├─ Apakah file lama diedit setelah diterapkan?
│  ├─ Ya -> revert file lama, buat migration baru
│  └─ Tidak
│
├─ Apakah location/artifact salah?
│  ├─ Ya -> fix packaging/location
│  └─ Tidak
│
├─ Apakah migration memang sengaja dihapus?
│  ├─ Ya -> evaluasi lifecycle dan repair hanya jika aman
│  └─ Tidak
│
├─ Apakah ada failed migration record?
│  ├─ Ya -> cek object/data partial, cleanup manual, baru repair
│  └─ Tidak
│
└─ Investigasi drift/source mismatch lebih lanjut
```

---

## 16. Rule of Thumb Validate

### Jangan Edit Migration yang Sudah Applied

Kalau migration sudah masuk environment bersama, terutama UAT/prod, anggap immutable.

Buruk:

```sql
-- V15__add_status_column.sql
ALTER TABLE application ADD status VARCHAR(20);
```

Lalu diedit menjadi:

```sql
ALTER TABLE application ADD status VARCHAR(50);
```

Baik:

```sql
-- V16__widen_application_status_column.sql
ALTER TABLE application ALTER COLUMN status TYPE VARCHAR(50);
```

Untuk Oracle:

```sql
ALTER TABLE application MODIFY status VARCHAR2(50);
```

### Migration Salah Tetapi Sudah Applied? Buat Migration Koreksi

Contoh:

```text
V20 salah membuat index non-unique.
```

Jangan edit V20.

Buat:

```text
V21__replace_customer_email_index_with_unique_index.sql
```

Isi:

```sql
DROP INDEX idx_customer_email;
CREATE UNIQUE INDEX ux_customer_email ON customer(email);
```

Tentu pastikan data duplicate sudah ditangani.

---

# SECTION C — REPAIR

---

## 17. Apa Itu Repair

`repair` memperbaiki schema history table.

Dokumentasi resmi Redgate menyebut `repair` melakukan beberapa hal, antara lain menghapus failed migration dari schema history table, menyelaraskan checksum/description/type dengan migration yang tersedia, dan menandai missing migration sebagai deleted. Dokumentasi juga menekankan bahwa user objects yang tertinggal akibat failed migration tetap harus dibersihkan manual.  
Referensi: <https://documentation.red-gate.com/fd/repair-277578892.html>

Kalimat paling penting:

> Repair fixes Flyway metadata. Repair does not magically fix your business schema/data.

---

## 18. Repair Bukan Rollback

Misalnya migration gagal:

```sql
CREATE TABLE payment_audit (
    id BIGINT PRIMARY KEY,
    payload CLOB
);

CREATE INDEX idx_payment_audit_created_at
ON payment_audit(created_at);
```

Ternyata column `created_at` belum ada, sehingga index gagal.

Kemungkinan state database:

```text
payment_audit table created
index creation failed
flyway_schema_history contains failed V30
```

Jika kita menjalankan `flyway repair`, Flyway bisa menghapus record failed dari history table.

Tetapi table `payment_audit` yang sudah terbuat tetap ada.

Kalau setelah itu kita memperbaiki SQL dan menjalankan ulang migration:

```sql
CREATE TABLE payment_audit (...);
```

Migration bisa gagal lagi karena table sudah ada.

Jadi urutan yang benar:

```text
1. Investigasi object/data partial
2. Cleanup manual atau buat recovery script
3. Pastikan database kembali ke pre-migration state atau intended state
4. Baru jalankan repair jika metadata perlu dibersihkan
5. Jalankan validate
6. Jalankan migrate ulang
```

---

## 19. Use Case Repair yang Sah

### 19.1 Failed Migration pada Non-Transactional DDL Database

Beberapa database tidak rollback DDL secara penuh. Jika migration gagal setelah sebagian object tercipta, Flyway history bisa menyimpan failed record.

Repair boleh dipakai setelah cleanup manual.

Workflow:

```text
migration failed
-> inspect DB object partial
-> drop/adjust partial objects
-> fix migration script if needed
-> flyway repair
-> flyway validate
-> flyway migrate
```

### 19.2 Checksum Realignment Setelah Keputusan Governance

Misalnya file migration berubah hanya karena line ending normalization di repository dan sudah diputuskan bahwa perubahan tidak mengubah semantics.

Tetapi ini harus sangat hati-hati.

Sebelum repair:

```text
- compare old vs new file
- confirm semantic equivalence
- record approval
- run repair
```

### 19.3 Mark Missing Migration as Deleted

Kadang migration lama sengaja tidak lagi tersedia, misalnya saat repository direstrukturisasi. Repair bisa menandai missing migration sebagai deleted.

Namun ini jarang ideal. Untuk sistem audit-sensitive, lebih baik migration lama tetap disimpan.

### 19.4 Setelah Manual History Table Corruption Recovery

Jika schema history table rusak akibat restore/partial operation, repair bisa menjadi bagian recovery, tetapi harus dipakai dengan backup dan evidence.

---

## 20. Use Case Repair yang Tidak Sah

### 20.1 Mengakali Migration yang Diedit Sembarangan

Buruk:

```text
Checksum mismatch karena developer edit migration lama.
Solusi: flyway repair.
```

Ini menyamakan history dengan source baru, tetapi database yang sudah menjalankan source lama tidak otomatis berubah.

### 20.2 Menghindari Root Cause

Buruk:

```text
Validate gagal. Kita tidak tahu kenapa. Repair saja.
```

Ini seperti menghapus alarm kebakaran tanpa mencari api.

### 20.3 Setelah Partial Migration Tanpa Cleanup

Buruk:

```text
Migration gagal di tengah.
Langsung repair.
Lalu migrate ulang.
```

Risikonya:

- duplicate object
- partially populated data
- broken constraints
- inconsistent seed
- migration berikutnya gagal

### 20.4 Production Repair Tanpa Approval

Repair mengubah audit metadata. Di environment regulated, ini harus punya approval dan record.

---

## 21. Repair Decision Matrix

| Kondisi | Boleh Repair? | Syarat |
|---|---:|---|
| Failed migration record setelah object partial dibersihkan | Ya | Cleanup terbukti, script fixed |
| Checksum mismatch karena migration lama diedit | Biasanya tidak | Revert file, buat migration baru |
| Checksum mismatch karena line ending normalization | Mungkin | Diff semantic proof, approval |
| Missing migration karena packaging salah | Tidak | Fix artifact/location |
| Missing migration karena file sengaja archived | Mungkin | Governance decision |
| Drift karena manual DB change | Tidak langsung | Buat reconciliation migration |
| History table corrupt | Mungkin | Backup, DBA approval, evidence |

---

## 22. Repair Runbook

Gunakan runbook ini untuk production.

### 22.1 Pre-Repair Checklist

```text
[ ] Backup/snapshot tersedia
[ ] Flyway info output disimpan
[ ] Flyway validate error disimpan
[ ] Current migration files artifact disimpan
[ ] Schema history table export disimpan
[ ] Partial DB object/data dicek
[ ] Root cause diketahui
[ ] Remediation plan disetujui
[ ] Roll-forward plan tersedia
[ ] App compatibility dicek
```

### 22.2 Evidence Commands

Contoh:

```bash
flyway info > flyway-info-before-repair.txt
flyway validate > flyway-validate-before-repair.txt
```

Export history:

```sql
SELECT *
FROM flyway_schema_history
ORDER BY installed_rank;
```

### 22.3 Repair Execution

```bash
flyway repair
```

Setelah itu:

```bash
flyway validate
flyway info
```

### 22.4 Post-Repair Verification

```text
[ ] Failed record sudah hilang atau status sesuai
[ ] Checksum mismatch resolved sesuai approval
[ ] No unexpected missing migration
[ ] Migration berikutnya bisa dry-run/test di clone
[ ] Aplikasi kompatibel
[ ] Audit note dibuat
```

---

# SECTION D — CLEAN

---

## 23. Apa Itu Clean

`clean` menghapus object di schema yang dikelola Flyway.

Ini berguna di local dev/test untuk reset database.

Tetapi di production, ini sangat berbahaya.

Redgate mendokumentasikan setting `cleanDisabled`, dengan default `true` pada dokumentasi terbaru, dan menyebutnya berguna untuk production karena menjalankan clean dapat menjadi tindakan yang sangat merugikan.  
Referensi: <https://documentation.red-gate.com/fd/flyway-clean-disabled-setting-277578981.html>

Mental model:

```text
clean = destroy managed schema objects
```

Bukan:

```text
clean = tidy up migration metadata
```

---

## 24. Kapan Clean Berguna

Clean berguna untuk:

1. Local development reset.
2. Integration test fresh database.
3. CI ephemeral database.
4. Demo database reset.
5. Training/lab environment.

Contoh workflow test:

```bash
flyway clean
flyway migrate
mvn test
```

Namun hanya jika database disposable.

---

## 25. Kapan Clean Tidak Boleh Digunakan

Jangan gunakan clean pada:

1. Production.
2. UAT dengan data penting.
3. Staging yang merepresentasikan production snapshot.
4. Shared development database tanpa koordinasi.
5. Database yang berisi data manual tester.
6. Environment yang tidak bisa direbuild otomatis.

Kalau clean dijalankan di schema salah, akibatnya bisa:

```text
- table hilang
- data hilang
- sequence hilang
- view hilang
- procedure/package hilang
- permission-dependent object rusak
- aplikasi down
```

---

## 26. Clean Safety Policy

Untuk sistem serius:

```properties
flyway.cleanDisabled=true
```

Untuk Spring Boot:

```properties
spring.flyway.clean-disabled=true
```

Untuk local test, aktifkan hanya dalam profile khusus:

```properties
# application-local-test.properties
spring.flyway.clean-disabled=false
```

Jangan pernah menaruh ini di config default production:

```properties
spring.flyway.clean-disabled=false
```

### 26.1 Environment Guard

Bahkan jika `cleanDisabled=false` di local, tambahkan guard:

```text
- DB host harus localhost/testcontainer
- DB name harus mengandung _test atau _dev
- user bukan production user
- environment variable explicit CLEAN_ALLOWED=true
```

### 26.2 Separate Credentials

Production migration user sebaiknya tidak punya privilege destructive yang tidak diperlukan.

Jika migration user bisa drop semua object, blast radius lebih besar.

Namun ini harus diseimbangkan dengan kebutuhan migration. Banyak DDL memang butuh privilege tinggi. Karena itu kontrol deployment dan config menjadi penting.

---

## 27. Clean dalam Testcontainers

Di integration test modern, sering lebih aman membuat container database baru daripada menjalankan clean pada shared DB.

Pattern:

```text
start PostgreSQL/Oracle/MySQL container
-> flyway migrate
-> run integration tests
-> destroy container
```

Keuntungan:

- Tidak ada risiko salah target shared DB.
- Test isolasi penuh.
- Fresh schema per test suite.
- Cocok untuk CI.

Clean masih berguna jika ingin reset cepat di container yang sama, tetapi ephemeral DB lebih aman.

---

# SECTION E — PRODUCTION FAILURE SCENARIOS

---

## 28. Scenario 1: Checksum Mismatch di UAT

### Kondisi

```text
UAT sudah menjalankan V15.
Developer mengubah V15 setelah UAT deploy.
Validate gagal.
```

### Salah

```bash
flyway repair
```

Tanpa investigasi.

### Benar

1. Diff file V15 lama vs baru.
2. Jika migration lama sudah applied di shared env, revert V15 ke bentuk lama.
3. Buat V16 untuk koreksi.
4. Validate ulang.
5. Deploy.

### Mental Model

Migration applied harus immutable.

---

## 29. Scenario 2: Migration Gagal Setelah Create Table

### Kondisi

```sql
CREATE TABLE report_job (...);
CREATE INDEX idx_report_job_status ON report_job(status);
```

Index gagal karena column typo.

### Database State

```text
report_job table mungkin sudah ada
index belum ada
flyway_schema_history mencatat failed migration
```

### Runbook

```text
1. Stop deployment.
2. Cek apakah table terbuat.
3. Jika table kosong dan aman, drop table manual.
4. Fix migration SQL.
5. flyway repair.
6. flyway validate.
7. flyway migrate.
8. Verify object and app startup.
```

Jika table sudah berisi data, jangan asal drop. Evaluasi apakah data berasal dari partial app traffic atau manual process.

---

## 30. Scenario 3: Existing Production Database Mau Diadopsi Flyway

### Kondisi

```text
Production schema sudah ada.
Tidak ada flyway_schema_history.
Team ingin mulai versioning.
```

### Runbook

```text
1. Freeze manual DDL.
2. Export schema.
3. Buat baseline artifact.
4. Pilih baseline version.
5. Test di clone.
6. Run flyway baseline di clone.
7. Run future migration di clone.
8. Apply di lower env.
9. Apply di prod.
10. Enforce migration-only policy.
```

### Jangan

```text
Langsung run migrate dengan V1 create all tables ke production existing.
```

---

## 31. Scenario 4: Migration Hilang dari Artifact

### Kondisi

Production history punya:

```text
V20__add_payment_reference.sql
```

Tetapi deployment artifact sekarang tidak mengandung file tersebut.

### Penyebab Umum

- Multi-module packaging salah.
- Resource folder tidak masuk jar.
- Branch tidak lengkap.
- File dihapus karena dianggap lama.
- `flyway.locations` berubah.

### Salah

```bash
flyway repair
```

### Benar

1. Cek artifact content.
2. Cek `flyway.locations`.
3. Restore migration file ke repository/artifact.
4. Validate ulang.

Repair hanya dipertimbangkan jika memang ada keputusan formal untuk menghapus/menandai migration lama, dan itu jarang ideal.

---

## 32. Scenario 5: Clean Tidak Sengaja Mengarah ke Shared DB

### Kondisi

Developer mengira connect ke local DB, ternyata ke shared DEV.

```bash
flyway clean
```

### Prevention

```text
- cleanDisabled true by default
- clean allowed only local profile
- DB URL guard
- separate credentials
- Testcontainers
- no shared password in local config
```

### Recovery

Jika terjadi:

```text
1. Stop application traffic.
2. Notify team.
3. Restore from backup/snapshot.
4. Re-run migration if needed.
5. Verify app data.
6. Rotate credentials if leak/config issue.
7. Incident review.
```

---

# SECTION F — JAVA AND SPRING BOOT PRACTICALS

---

## 33. Programmatic Flyway Usage

Di plain Java, Flyway bisa dipanggil programmatically.

Contoh konseptual:

```java
import org.flywaydb.core.Flyway;

public class MigrationRunner {
    public static void main(String[] args) {
        Flyway flyway = Flyway.configure()
                .dataSource(
                        System.getenv("DB_URL"),
                        System.getenv("DB_USER"),
                        System.getenv("DB_PASSWORD")
                )
                .locations("classpath:db/migration")
                .cleanDisabled(true)
                .load();

        flyway.validate();
        flyway.migrate();
    }
}
```

Untuk production, biasanya lebih baik migration dijalankan sebagai:

```text
- CI/CD step
- Kubernetes Job
- init job sebelum app rollout
- controlled release task
```

Bukan selalu di setiap aplikasi startup, terutama jika ada banyak replica.

---

## 34. Spring Boot Configuration

Contoh konfigurasi aman:

```properties
spring.flyway.enabled=true
spring.flyway.locations=classpath:db/migration
spring.flyway.clean-disabled=true
spring.jpa.hibernate.ddl-auto=validate
```

Untuk production, hindari:

```properties
spring.jpa.hibernate.ddl-auto=update
```

Karena schema change harus lewat migration yang eksplisit, reviewable, dan auditable.

### 34.1 Baseline Existing DB di Spring Boot

Contoh:

```properties
spring.flyway.baseline-version=1000
spring.flyway.baseline-description=Existing production schema baseline
```

Hati-hati dengan:

```properties
spring.flyway.baseline-on-migrate=true
```

`baselineOnMigrate` bisa berguna saat adoption, tetapi berbahaya jika salah target database. Ia dapat membuat Flyway otomatis melakukan baseline pada database non-empty yang belum punya history table. Gunakan hanya dengan kontrol ketat.

### 34.2 Validate on Migrate

Pastikan validate tidak dimatikan tanpa alasan kuat.

Prinsip:

```text
validate failure is a deployment stop signal, not annoyance.
```

---

## 35. Kubernetes Deployment Pattern

Untuk aplikasi Java di Kubernetes, ada dua pola umum.

### 35.1 Migration on Application Startup

Setiap pod menjalankan Flyway saat startup.

Kelebihan:

- Simple.
- Tidak perlu job terpisah.
- Cocok untuk aplikasi kecil.

Kekurangan:

- Banyak replica bisa berebut migration lock.
- Startup aplikasi tergantung DB migration.
- Sulit kontrol approval production.
- Migration berat memperlambat rollout.

### 35.2 Migration as Kubernetes Job

Pipeline menjalankan migration job sebelum rollout app.

```text
CI/CD
  -> deploy migration job
  -> job runs flyway validate/migrate
  -> verify success
  -> rollout application deployment
```

Kelebihan:

- Lebih terkontrol.
- Log migration terpisah.
- Bisa approval gate.
- Cocok untuk regulated production.

Kekurangan:

- Pipeline lebih kompleks.
- Perlu koordinasi app version dan DB version.

Untuk enterprise, pattern job biasanya lebih defensible.

---

# SECTION G — GOVERNANCE AND RUNBOOKS

---

## 36. Production Command Policy

| Command | DEV Local | CI Ephemeral | SIT/UAT | Production |
|---|---:|---:|---:|---:|
| `info` | Yes | Yes | Yes | Yes |
| `validate` | Yes | Yes | Yes | Yes |
| `migrate` | Yes | Yes | Controlled | Controlled |
| `baseline` | Rare | Rare | Adoption only | Adoption only with approval |
| `repair` | Rare | Rare | Approval | Emergency/approval |
| `clean` | Disposable only | Disposable only | No | No |

---

## 37. Pre-Deployment Checklist

```text
[ ] Correct DB URL
[ ] Correct DB user
[ ] Correct schema
[ ] Correct flyway.locations
[ ] Artifact version recorded
[ ] flyway info reviewed
[ ] flyway validate successful
[ ] Pending migrations expected
[ ] Backup/snapshot available
[ ] Long-running sessions checked
[ ] Lock risk assessed
[ ] Roll-forward script ready if applicable
[ ] App compatibility checked
[ ] Approval obtained
```

---

## 38. Post-Deployment Checklist

```text
[ ] flyway info shows expected version
[ ] flyway validate passes
[ ] New objects exist
[ ] Critical constraints/indexes exist
[ ] Seed data exists and is correct
[ ] App starts successfully
[ ] Smoke test passes
[ ] Logs show no DB compatibility errors
[ ] Metrics stable
[ ] Deployment evidence archived
```

---

## 39. Baseline Decision Record Template

Gunakan dokumen seperti ini saat adoption:

```markdown
# Database Baseline Decision Record

Date: 2026-06-17
System: <system-name>
Environment: Production
Database: <db-engine/version>
Schema(s): <schema-list>

## Context
Existing database was created before Flyway adoption.

## Baseline Version
V1000

## Baseline Evidence
- Schema export file: production-schema-2026-06-17.sql
- Object inventory: production-object-inventory-2026-06-17.csv
- Snapshot validation: staging-clone-2026-06-17

## Decision
Flyway will baseline production at version 1000.
Future migrations start at V1001.

## Risks
- Historical migrations before V1000 are not represented individually.
- Fresh rebuild requires baseline snapshot script.

## Controls
- Manual DDL prohibited after baseline.
- All future changes must be delivered through Flyway migration.

## Approvals
- App Lead:
- DBA:
- Release Manager:
```

---

## 40. Repair Decision Record Template

```markdown
# Flyway Repair Decision Record

Date: <date>
Environment: <env>
Database: <db>
Schema: <schema>

## Trigger
Flyway validate/migrate failed due to:
<error>

## Root Cause
<explanation>

## Current State
- Flyway history state:
- Physical object state:
- Data impact:

## Remediation Before Repair
<manual cleanup or verification>

## Repair Scope
<what repair is expected to change in schema history table>

## Validation Plan
- flyway validate
- flyway info
- object verification query
- application smoke test

## Approval
- App Lead:
- DBA:
- Release Manager:
```

---

# SECTION H — COMMON QUESTIONS

---

## 41. Apakah Baseline Sama dengan Initial Migration?

Tidak selalu.

Initial migration adalah script yang membuat schema dari nol.

Baseline adalah metadata marker bahwa database existing dianggap sudah berada pada versi tertentu.

Mereka bisa digabung dalam strategi:

```text
V1000__baseline_existing_schema.sql
```

Untuk database baru, script itu dijalankan.

Untuk production existing, Flyway dibaseline ke V1000 sehingga script itu tidak dijalankan ulang.

---

## 42. Apakah Repair Aman?

Repair aman hanya jika kita tahu persis metadata apa yang diperbaiki dan physical database state sudah benar.

Repair tidak aman jika dipakai sebagai respons otomatis untuk semua validate failure.

---

## 43. Apakah Clean Boleh untuk Local?

Boleh jika database benar-benar disposable.

Lebih aman:

```text
Testcontainers > local disposable DB > shared DEV DB
```

Jangan clean shared DB tanpa persetujuan.

---

## 44. Kalau Migration Salah Tapi Belum Pernah Applied di Mana Pun?

Kalau migration benar-benar belum pernah dijalankan di environment mana pun dan belum pernah masuk artifact shared, boleh edit.

Namun di team besar, asumsi ini berbahaya.

Rule praktis:

```text
Jika sudah merged ke main branch, treat as immutable.
```

Lebih aman membuat migration baru.

---

## 45. Kalau Migration Baru Applied di Local Saja?

Kalau hanya local pribadi dan belum push, boleh reset local DB atau edit migration.

Tapi begitu migration masuk shared environment, jangan edit.

---

## 46. Apakah Validate Harus Selalu Dijalankan?

Ya, untuk pipeline serius.

Validate adalah early warning bahwa chain migration rusak.

Menonaktifkan validate sama seperti mematikan smoke detector karena berisik.

---

# SECTION I — TOP 1% ENGINEER MENTAL MODEL

---

## 47. Melihat Flyway Command sebagai State Transition

Engineer biasa melihat:

```text
baseline, validate, repair, clean = command Flyway
```

Engineer senior melihat:

```text
baseline = state assertion
validate = consistency verification
repair   = metadata reconciliation
clean    = destructive reset
```

Top-tier engineer melihat:

```text
Setiap command mengubah trust boundary antara:
- source code
- migration artifact
- schema history
- physical database state
- production data
- release process
- audit evidence
```

---

## 48. Jangan Hanya Bertanya “Command Apa?”

Pertanyaan yang benar:

```text
Apa state database sekarang?
Apa state Flyway history sekarang?
Apa state migration source sekarang?
Apa yang berbeda?
Apakah perbedaan itu disengaja?
Apakah physical object/data sudah aman?
Apakah command ini memperbaiki root cause atau hanya metadata?
Apa evidence-nya?
Apa rollback/roll-forward path?
```

---

## 49. Migration History adalah Evidence, Bukan Sampah Teknis

`flyway_schema_history` bukan table internal yang boleh dimanipulasi sembarangan.

Ia menjawab:

- Siapa menjalankan migration?
- Kapan dijalankan?
- Script apa yang dijalankan?
- Berapa checksum-nya?
- Berhasil atau gagal?
- Versi database sekarang apa?

Dalam environment regulated, ini bagian dari audit evidence.

---

## 50. Repair Harus Lebih Mirip Incident Handling daripada Routine Command

Jika `repair` sering dipakai, itu tanda:

- migration sering diedit setelah applied
- process review lemah
- artifact packaging tidak stabil
- developer belum paham immutability
- environment drift tidak dikendalikan

Repair adalah emergency tool, bukan workflow normal.

---

## 51. Clean Harus Dianggap Berbahaya secara Default

`clean` harus diperlakukan seperti:

```text
rm -rf database_schema
```

Bukan seperti:

```text
reset cache
```

Karena itu default posture yang sehat:

```text
clean disabled everywhere except disposable environments
```

---

# 52. Practical Cheat Sheet

## Baseline

Gunakan saat:

```text
existing DB sudah ada sebelum Flyway
```

Jangan gunakan untuk:

```text
menutupi migration gagal atau drift yang tidak dipahami
```

## Validate

Gunakan:

```text
selalu di CI/CD dan pre-deploy
```

Jika gagal:

```text
investigasi, jangan langsung repair
```

## Repair

Gunakan saat:

```text
metadata Flyway perlu diselaraskan setelah root cause dan physical DB state ditangani
```

Jangan gunakan untuk:

```text
mengakali checksum mismatch tanpa analisis
```

## Clean

Gunakan hanya pada:

```text
disposable DB
```

Jangan gunakan pada:

```text
production, staging penting, UAT data penting, shared DB
```

---

# 53. Minimal Production Runbook

```text
Before migration:
1. Confirm artifact version.
2. Confirm DB target.
3. Run flyway info.
4. Run flyway validate.
5. Review pending migrations.
6. Confirm backup.
7. Confirm go/no-go.

If validate fails:
1. Stop deployment.
2. Identify mismatch type.
3. Compare source vs history.
4. Fix artifact or create corrective migration.
5. Use repair only with approval.

If migrate fails:
1. Stop app rollout.
2. Inspect schema history.
3. Inspect partial object/data.
4. Cleanup or roll-forward.
5. Repair only after physical state is safe.
6. Re-validate.
7. Re-migrate.

Never:
1. Run clean in production.
2. Edit applied migration casually.
3. Repair without root cause.
4. Baseline without evidence.
```

---

# 54. Summary

Part ini membahas empat command Flyway yang paling sensitif secara operasional:

- `baseline` adalah deklarasi titik awal untuk database existing.
- `validate` adalah mekanisme deteksi ketidakkonsistenan antara source migration dan migration history.
- `repair` adalah metadata reconciliation, bukan schema/data repair otomatis.
- `clean` adalah destructive reset dan harus dilarang pada environment penting.

Kemampuan menggunakan command ini dengan benar membedakan engineer yang hanya tahu Flyway secara syntax dari engineer yang mampu menjaga database production secara defensible.

Prinsip utama:

```text
Do not optimize for making Flyway green.
Optimize for making database state truthful, recoverable, and auditable.
```

---

# 55. Referensi

- Redgate Flyway Documentation — Schema History Table: <https://documentation.red-gate.com/fd/flyway-schema-history-table-273973417.html>
- Redgate Flyway Documentation — Validate: <https://documentation.red-gate.com/fd/validate-277578898.html>
- Redgate Flyway Documentation — Repair: <https://documentation.red-gate.com/fd/repair-277578892.html>
- Redgate Flyway Documentation — Clean Disabled Setting: <https://documentation.red-gate.com/fd/flyway-clean-disabled-setting-277578981.html>
- Redgate Flyway Documentation — Commands overview: <https://documentation.red-gate.com/fd/redgate-flyway-documentation-138346877.html>

---

# 56. Posisi dalam Seri

Kita sudah menyelesaikan:

```text
Part 0  — Orientation: Database Change as Engineering Discipline
Part 1  — Taxonomy of Database Changes
Part 2  — Migration Invariants and Failure Models
Part 3  — Versioning Models for Database Schema
Part 4  — Flyway Mental Model
Part 5  — Flyway Setup in Java 8–25 Projects
Part 6  — Flyway SQL Migration Design
Part 7  — Flyway Repeatable Migrations
Part 8  — Flyway Java-Based Migrations
Part 9  — Flyway Callbacks and Lifecycle Hooks
Part 10 — Flyway Baseline, Repair, Validate, and Clean
```

Seri belum selesai. Berikutnya:

```text
Part 11 — Liquibase Mental Model
File    — 11-liquibase-mental-model.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: 09 — Flyway Callbacks and Lifecycle Hooks](./09-flyway-callbacks-lifecycle-hooks.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 11 — Liquibase Mental Model](./11-liquibase-mental-model.md)

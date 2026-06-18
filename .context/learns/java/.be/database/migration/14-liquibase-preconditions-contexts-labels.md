# Part 14 — Liquibase Preconditions, Contexts, and Labels

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Part: `14 / 33`  
> File: `14-liquibase-preconditions-contexts-labels.md`  
> Fokus: menggunakan Liquibase sebagai **execution control system**, bukan hanya changelog runner.

---

## 0. Posisi Materi Ini Dalam Seri

Di Part 11 kita membangun mental model Liquibase: changelog, changeset, checksum, lock table, rollback, dan metadata table.  
Di Part 12 kita membahas setup Liquibase di Java 8 sampai Java 25.  
Di Part 13 kita membahas desain changelog agar scalable.

Part ini masuk ke salah satu alasan utama Liquibase sering dipilih di sistem enterprise: **preconditions, contexts, dan labels**.

Ketiga fitur ini menjawab pertanyaan berbeda:

| Fitur | Pertanyaan utama | Level keputusan |
|---|---|---|
| Preconditions | “Apakah aman menjalankan changeset ini terhadap database saat ini?” | State database/runtime |
| Contexts | “Di environment/use case mana changeset ini boleh ikut dieksekusi?” | Deployment environment/execution mode |
| Labels | “Changeset ini bagian dari fitur/release/tenant/scope logis apa?” | Selection/governance/release targeting |

Secara sederhana:

```text
Preconditions = guard sebelum eksekusi
Contexts      = filter berdasarkan konteks eksekusi
Labels        = filter berdasarkan metadata logis/release/fitur
```

Namun dalam praktik production, ketiganya sering disalahgunakan. Banyak tim memakai contexts untuk environment branching terlalu ekstrem, labels untuk mengganti branching Git, atau preconditions untuk menutupi changelog yang tidak deterministik.

Target Part ini: setelah selesai, kamu tidak hanya tahu syntax Liquibase, tetapi bisa mendesain policy migration yang defensible untuk sistem Java enterprise.

---

## 1. Mental Model: Liquibase Bukan Sekadar “Run SQL”

Liquibase changeset bukan hanya kumpulan instruksi SQL. Ia memiliki metadata dan control plane.

```text
Changelog
  └── Changeset
        ├── identity: id + author + file path
        ├── change body: createTable/addColumn/sql/etc
        ├── metadata: context, labels, dbms, runAlways, runOnChange, etc
        ├── preconditions: guard berdasarkan kondisi database/runtime
        └── rollback: cara membalik perubahan, jika memungkinkan
```

Dalam model ini, sebuah changeset punya dua sisi:

1. **Data plane**: perubahan aktual ke database.
2. **Control plane**: aturan kapan, di mana, dan dengan syarat apa perubahan boleh berjalan.

Preconditions, contexts, dan labels berada di sisi control plane.

Tanpa control plane yang baik, migration menjadi:

```text
“Jalankan file ini, semoga benar.”
```

Dengan control plane yang baik:

```text
“Jalankan perubahan ini hanya jika environment, release, DBMS, dan state database memenuhi kontrak yang eksplisit.”
```

Itulah perbedaan antara migration script dan database change governance.

---

## 2. Sumber Kebenaran Konseptual

Menurut dokumentasi Liquibase, changeset adalah unit dasar perubahan dan dapat memiliki preconditions, contexts, labels, serta atribut lain untuk mengontrol kapan changeset dijalankan. Liquibase juga menggunakan table `DATABASECHANGELOG` untuk melacak perubahan yang sudah dideploy. Dokumentasi Liquibase menjelaskan preconditions sebagai tag di changelog atau changeset untuk mengontrol eksekusi update berdasarkan state database; jika precondition pada changeset gagal, Liquibase tidak men-deploy changeset tersebut. Contexts dan labels adalah mekanisme filtering untuk menentukan changeset mana yang ikut dieksekusi pada migration run tertentu. Referensi resmi Liquibase juga menyebut label filter sebagai logical expression yang digunakan saat runtime untuk memilih changeset berlabel tertentu.  

Sumber rujukan:

- Liquibase changeset concept: `https://docs.liquibase.com/secure/user-guide-5-2/what-is-a-changeset`
- Liquibase changelog concept: `https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-a-changelog`
- Liquibase preconditions: `https://docs.liquibase.com/community/user-guide-5-0/what-are-preconditions`
- Liquibase contexts: `https://docs.liquibase.com/secure/reference-guide-5-1-1/changelog-attributes/what-are-contexts`
- Liquibase labels: `https://docs.liquibase.com/reference-guide/changelog-attributes/what-are-labels`

Catatan: syntax detail bisa berubah antar versi Liquibase, terutama antara 4.x dan 5.x. Untuk project Java 8/11 yang masih memakai Liquibase 4.x, validasi kembali syntax terhadap dokumentasi versi yang dipakai.

---

## 3. Preconditions: Safety Guard Berdasarkan State Database

### 3.1 Apa Itu Preconditions?

Precondition adalah syarat yang harus benar sebelum Liquibase menjalankan changelog atau changeset.

Contoh pertanyaan yang bisa dijawab precondition:

- Apakah table ini sudah ada?
- Apakah column ini belum ada?
- Apakah constraint ini belum dibuat?
- Apakah database engine yang dipakai adalah PostgreSQL/Oracle/MySQL?
- Apakah user yang menjalankan migration benar?
- Apakah schema berada dalam state yang diharapkan?
- Apakah jumlah row memenuhi ekspektasi?
- Apakah query validasi custom menghasilkan nilai tertentu?

Precondition bukan sekadar convenience. Dalam sistem production, precondition adalah **executable assumption**.

Tanpa precondition, asumsi migration tersembunyi di kepala developer atau reviewer:

```text
Saya asumsikan column customer.email belum ada.
Saya asumsikan table order_item sudah ada.
Saya asumsikan constraint lama sudah di-drop.
Saya asumsikan migration ini hanya dijalankan di Oracle.
```

Dengan precondition, asumsi itu ditulis sebagai kontrak eksplisit:

```yaml
preConditions:
  - onFail: HALT
  - not:
      - columnExists:
          tableName: customer
          columnName: email
```

Artinya:

```text
Jangan lanjut kalau customer.email sudah ada.
```

---

## 4. Preconditions Sebagai Executable Assumptions

Engineer biasa menulis migration berdasarkan happy path.

Engineer kuat menulis migration dengan asumsi yang bisa dieksekusi.

Contoh migration tanpa precondition:

```sql
ALTER TABLE customer ADD email VARCHAR(320);
```

Masalah:

- Jika column sudah ada karena manual hotfix, migration gagal.
- Jika table tidak ada karena environment drift, migration gagal dengan error teknis mentah.
- Jika migration dijalankan di schema salah, efeknya bisa berbahaya.
- Reviewer tidak tahu asumsi apa yang dipegang migration.

Versi lebih defensible:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-17-001-add-customer-email
      author: fajar
      preConditions:
        - onFail: HALT
        - tableExists:
            tableName: customer
        - not:
            - columnExists:
                tableName: customer
                columnName: email
      changes:
        - addColumn:
            tableName: customer
            columns:
              - column:
                  name: email
                  type: varchar(320)
```

Sekarang kontraknya jelas:

```text
1. customer table harus ada.
2. customer.email belum boleh ada.
3. Kalau tidak sesuai, stop, jangan diam-diam lanjut.
```

---

## 5. Level Preconditions: Changelog-Level vs Changeset-Level

Preconditions bisa ditempatkan di dua level:

1. **Changelog-level preconditions**
2. **Changeset-level preconditions**

### 5.1 Changelog-Level Preconditions

Dipakai untuk guard global.

Contoh:

```yaml
databaseChangeLog:
  - preConditions:
      - onFail: HALT
      - dbms:
          type: postgresql

  - changeSet:
      id: 001-create-customer
      author: fajar
      changes:
        - createTable:
            tableName: customer
            columns:
              - column:
                  name: id
                  type: bigint
                  constraints:
                    primaryKey: true
```

Makna:

```text
Seluruh changelog ini hanya boleh dijalankan untuk PostgreSQL.
```

Cocok untuk:

- Changelog vendor-specific.
- Changelog khusus schema tertentu.
- Migration package yang hanya valid untuk mode tertentu.
- Guard besar sebelum seluruh file diproses.

Tidak cocok untuk:

- Guard detail per-object.
- Guard yang berbeda antar changeset.
- Kondisi yang hanya relevan ke satu perubahan.

### 5.2 Changeset-Level Preconditions

Dipakai untuk guard spesifik pada satu perubahan.

Contoh:

```yaml
databaseChangeLog:
  - changeSet:
      id: 002-add-customer-status
      author: fajar
      preConditions:
        - onFail: HALT
        - tableExists:
            tableName: customer
        - not:
            - columnExists:
                tableName: customer
                columnName: status
      changes:
        - addColumn:
            tableName: customer
            columns:
              - column:
                  name: status
                  type: varchar(32)
```

Cocok untuk:

- Object existence check.
- Data readiness check.
- Drift detection per changeset.
- Guard sebelum destructive action.

---

## 6. Common Preconditions

Berikut kategori precondition yang sering dipakai.

### 6.1 DBMS Guard

```yaml
preConditions:
  - onFail: HALT
  - dbms:
      type: oracle
```

Gunakan saat migration memakai fitur vendor-specific.

Contoh:

- Oracle `CLOB`, sequence, package, online operation.
- PostgreSQL `jsonb`, `CREATE INDEX CONCURRENTLY`.
- MySQL engine-specific DDL.
- SQL Server filtered index.

Mental model:

```text
Kalau SQL tidak portable, jangan pura-pura portable.
Tulis guard vendor secara eksplisit.
```

### 6.2 Table Exists / Not Exists

```yaml
preConditions:
  - onFail: HALT
  - tableExists:
      tableName: customer
```

Untuk create table yang harus tidak ada:

```yaml
preConditions:
  - onFail: HALT
  - not:
      - tableExists:
          tableName: customer_archive
```

### 6.3 Column Exists / Not Exists

```yaml
preConditions:
  - onFail: HALT
  - columnExists:
      tableName: customer
      columnName: old_status
```

Untuk add column:

```yaml
preConditions:
  - onFail: HALT
  - not:
      - columnExists:
          tableName: customer
          columnName: new_status
```

### 6.4 Foreign Key / Index / Constraint Exists

Gunakan saat membuat atau menghapus constraint.

Contoh konseptual:

```yaml
preConditions:
  - onFail: HALT
  - not:
      - foreignKeyConstraintExists:
          foreignKeyName: fk_order_customer
```

Mengapa penting?

Constraint dan index sering dibuat manual saat incident performance. Jika changelog tidak mengecek keberadaan object, migration bisa gagal atau membuat duplicate object dengan nama berbeda.

### 6.5 SQL Check

`sqlCheck` adalah escape hatch untuk kondisi custom.

Contoh:

```yaml
preConditions:
  - onFail: HALT
  - sqlCheck:
      expectedResult: 0
      sql: SELECT COUNT(*) FROM customer WHERE email IS NULL
```

Makna:

```text
Jangan lanjut kalau masih ada customer.email yang NULL.
```

Cocok untuk:

- Validasi data sebelum constraint.
- Memastikan backfill selesai.
- Memastikan tidak ada duplicate sebelum unique index.
- Memastikan lookup seed sudah tersedia.
- Memastikan tidak ada orphan record sebelum FK.

Contoh sebelum membuat unique constraint:

```yaml
preConditions:
  - onFail: HALT
  - sqlCheck:
      expectedResult: 0
      sql: |
        SELECT COUNT(*)
        FROM (
          SELECT email
          FROM customer
          WHERE email IS NOT NULL
          GROUP BY email
          HAVING COUNT(*) > 1
        ) duplicates
```

Mental model:

```text
Constraint creation bukan hanya DDL.
Constraint creation adalah deklarasi bahwa semua data historis sudah memenuhi invariant baru.
```

---

## 7. onFail dan onError

Preconditions punya dua tipe kegagalan penting:

| Jenis | Makna |
|---|---|
| Fail | Precondition berhasil dievaluasi, tetapi hasilnya false |
| Error | Precondition tidak bisa dievaluasi karena error teknis |

Contoh fail:

```text
columnExists mengecek customer.email dan ternyata column tidak ada.
```

Contoh error:

```text
SQL check error karena table tidak ditemukan, permission kurang, syntax salah, atau koneksi bermasalah.
```

Liquibase menyediakan tindakan seperti:

| Action | Makna umum |
|---|---|
| HALT | Stop migration |
| WARN | Beri warning lalu lanjut |
| CONTINUE | Skip changeset dan lanjut |
| MARK_RAN | Tandai changeset sebagai sudah berjalan tanpa menjalankan perubahan |

Catatan: ketersediaan action bisa berbeda tergantung level precondition dan versi Liquibase. Validasi terhadap versi yang dipakai.

---

## 8. HALT: Default Aman Untuk Production

`HALT` adalah pilihan paling aman untuk production.

```yaml
preConditions:
  - onFail: HALT
  - not:
      - columnExists:
          tableName: customer
          columnName: email
```

Makna:

```text
Kalau asumsi tidak sesuai, hentikan deployment.
```

Gunakan `HALT` untuk:

- Destructive change.
- Constraint creation.
- Type conversion.
- Data migration berisiko.
- Production release migration.
- Security-sensitive seed.
- Permission/role changes.
- Schema drift detection.

Kenapa `HALT` penting?

Karena database drift adalah sinyal kuat bahwa realitas production tidak sama dengan asumsi repository. Dalam kondisi itu, melanjutkan otomatis sering lebih berbahaya daripada gagal cepat.

---

## 9. MARK_RAN: Berguna, Tapi Berbahaya Jika Sembarangan

`MARK_RAN` menandai changeset sebagai executed tanpa menjalankan change body.

Contoh:

```yaml
preConditions:
  - onFail: MARK_RAN
  - not:
      - tableExists:
          tableName: country
changes:
  - createTable:
      tableName: country
      columns:
        - column:
            name: code
            type: varchar(2)
```

Makna:

```text
Kalau table country sudah ada, anggap changeset ini sudah selesai.
```

Ini bisa masuk akal untuk onboarding legacy database ketika object sudah dibuat manual sebelum Liquibase diperkenalkan.

Namun, bahayanya besar.

Jika `country` sudah ada tetapi strukturnya berbeda, `MARK_RAN` akan tetap menganggap perubahan selesai.

Contoh risiko:

```text
Expected:
country(code varchar(2) primary key, name varchar(100) not null)

Actual production:
country(code varchar(3), description varchar(255))
```

Jika hanya mengecek `tableExists`, `MARK_RAN` terlalu lemah.

Versi lebih defensible:

```yaml
preConditions:
  - onFail: MARK_RAN
  - tableExists:
      tableName: country
  - columnExists:
      tableName: country
      columnName: code
  - columnExists:
      tableName: country
      columnName: name
```

Namun ini pun belum mengecek type, nullability, PK, dan constraint secara lengkap.

Rule:

```text
Gunakan MARK_RAN hanya ketika existing state benar-benar ekuivalen dengan hasil changeset.
```

Jika tidak yakin, gunakan `HALT` dan lakukan manual reconciliation.

---

## 10. WARN dan CONTINUE: Cocok Untuk Non-Critical Guard, Bukan Core Migration

`WARN` dan `CONTINUE` terlihat menggoda karena deployment tidak berhenti. Tetapi untuk production schema migration, ini sering menyembunyikan masalah.

Contoh yang buruk:

```yaml
preConditions:
  - onFail: WARN
  - sqlCheck:
      expectedResult: 0
      sql: SELECT COUNT(*) FROM customer WHERE email IS NULL
changes:
  - addNotNullConstraint:
      tableName: customer
      columnName: email
```

Ini buruk karena jika masih ada `NULL`, perubahan berikutnya kemungkinan gagal atau menghasilkan kondisi tidak jelas.

`WARN` lebih cocok untuk:

- Informational check.
- Non-critical metadata warning.
- Temporary visibility dalam dev/test.

`CONTINUE` lebih cocok untuk:

- Optional changeset yang memang boleh dilewati.
- Dev-only object.
- Non-production helper object.

Untuk core production invariant, gunakan `HALT`.

---

## 11. Nested Preconditions: AND, OR, NOT

Liquibase mendukung kombinasi logika seperti `and`, `or`, dan `not`.

Contoh: changeset boleh berjalan jika table ada dan column belum ada.

```yaml
preConditions:
  - onFail: HALT
  - and:
      - tableExists:
          tableName: customer
      - not:
          - columnExists:
              tableName: customer
              columnName: email
```

Contoh: hanya boleh berjalan pada PostgreSQL atau Oracle.

```yaml
preConditions:
  - onFail: HALT
  - or:
      - dbms:
          type: postgresql
      - dbms:
          type: oracle
```

Namun nested preconditions jangan dibuat terlalu kompleks.

Jika guard sudah seperti ini:

```text
(A and B and not C) or (D and E and not F) or (G and H)
```

itu tanda bahwa migration mungkin terlalu banyak memuat branching.

Lebih baik pecah menjadi changelog/changeset vendor-specific atau environment-specific yang lebih eksplisit.

---

## 12. Preconditions Untuk Destructive Changes

Destructive change adalah perubahan yang bisa menghilangkan data, constraint, atau compatibility.

Contoh:

- Drop column.
- Drop table.
- Drop index yang masih dipakai query penting.
- Change type yang bisa truncate data.
- Delete seed data.
- Rename object secara breaking.

Precondition untuk destructive change harus lebih ketat.

Contoh drop column:

```yaml
- changeSet:
    id: 2026-06-17-010-drop-customer-old-status
    author: fajar
    preConditions:
      - onFail: HALT
      - tableExists:
          tableName: customer
      - columnExists:
          tableName: customer
          columnName: old_status
      - sqlCheck:
          expectedResult: 0
          sql: |
            SELECT COUNT(*)
            FROM customer
            WHERE old_status IS NOT NULL
    changes:
      - dropColumn:
          tableName: customer
          columnName: old_status
```

Makna:

```text
Hanya drop old_status kalau column ada dan sudah tidak menyimpan data bermakna.
```

Namun ini belum cukup untuk zero-downtime. Kamu juga harus memastikan aplikasi versi aktif sudah tidak membaca/menulis column tersebut.

Precondition bisa mengecek database state, tetapi tidak selalu bisa mengecek application compatibility.

---

## 13. Preconditions Untuk Constraint Introduction

Membuat constraint adalah deklarasi invariant baru.

Contoh menambahkan `NOT NULL`:

```yaml
- changeSet:
    id: 2026-06-17-020-customer-email-not-null
    author: fajar
    preConditions:
      - onFail: HALT
      - columnExists:
          tableName: customer
          columnName: email
      - sqlCheck:
          expectedResult: 0
          sql: SELECT COUNT(*) FROM customer WHERE email IS NULL
    changes:
      - addNotNullConstraint:
          tableName: customer
          columnName: email
          columnDataType: varchar(320)
```

Contoh menambahkan unique constraint:

```yaml
- changeSet:
    id: 2026-06-17-021-customer-email-unique
    author: fajar
    preConditions:
      - onFail: HALT
      - sqlCheck:
          expectedResult: 0
          sql: |
            SELECT COUNT(*)
            FROM (
              SELECT email
              FROM customer
              WHERE email IS NOT NULL
              GROUP BY email
              HAVING COUNT(*) > 1
            ) duplicate_email
    changes:
      - addUniqueConstraint:
          tableName: customer
          columnNames: email
          constraintName: uk_customer_email
```

Mental model:

```text
Backfill dulu, validate data dulu, baru enforce constraint.
```

---

## 14. Preconditions Untuk Data Migration

Data migration sering lebih berbahaya daripada schema migration karena efeknya masuk ke business semantics.

Contoh: migrasi status string menjadi status code.

```yaml
- changeSet:
    id: 2026-06-17-030-backfill-customer-status-code
    author: fajar
    preConditions:
      - onFail: HALT
      - columnExists:
          tableName: customer
          columnName: status
      - columnExists:
          tableName: customer
          columnName: status_code
      - sqlCheck:
          expectedResult: 0
          sql: |
            SELECT COUNT(*)
            FROM customer
            WHERE status IS NOT NULL
              AND status NOT IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')
    changes:
      - sql: |
          UPDATE customer
          SET status_code = CASE status
              WHEN 'ACTIVE' THEN 'A'
              WHEN 'INACTIVE' THEN 'I'
              WHEN 'SUSPENDED' THEN 'S'
          END
          WHERE status_code IS NULL;
```

Precondition memastikan tidak ada status tidak dikenal sebelum backfill.

Tanpa check ini, migration bisa diam-diam menghasilkan `NULL` atau mapping salah.

---

## 15. Preconditions Untuk Seed Data

Seed data harus deterministik. Preconditions bisa membantu memastikan seed tidak merusak data yang sudah ada.

Contoh seed role:

```yaml
- changeSet:
    id: 2026-06-17-040-seed-role-case-officer
    author: fajar
    preConditions:
      - onFail: HALT
      - tableExists:
          tableName: app_role
      - sqlCheck:
          expectedResult: 0
          sql: |
            SELECT COUNT(*)
            FROM app_role
            WHERE code = 'CASE_OFFICER'
              AND name <> 'Case Officer'
    changes:
      - sql: |
          INSERT INTO app_role(code, name, is_system)
          SELECT 'CASE_OFFICER', 'Case Officer', true
          WHERE NOT EXISTS (
            SELECT 1 FROM app_role WHERE code = 'CASE_OFFICER'
          );
```

Makna:

```text
Kalau role belum ada, insert.
Kalau role sudah ada dengan nama benar, aman.
Kalau role sudah ada tapi nilainya berbeda, halt karena ada drift.
```

Ini lebih defensible daripada blindly update:

```sql
UPDATE app_role SET name = 'Case Officer' WHERE code = 'CASE_OFFICER';
```

Blind update bisa menimpa konfigurasi production yang sengaja diubah.

---

## 16. Contexts: Filtering Berdasarkan Konteks Eksekusi

Contexts dipakai untuk menentukan changeset mana yang dijalankan pada konteks tertentu.

Contoh:

```yaml
- changeSet:
    id: 2026-06-17-050-insert-dev-user
    author: fajar
    context: dev
    changes:
      - sql: |
          INSERT INTO app_user(username, display_name)
          VALUES ('dev.admin', 'Development Admin');
```

Saat menjalankan Liquibase dengan context `dev`, changeset ini ikut berjalan. Saat production tanpa context `dev`, changeset ini tidak dijalankan.

Mental model:

```text
Contexts menjawab: migration run ini sedang dalam mode apa?
```

Contoh context yang masuk akal:

| Context | Makna |
|---|---|
| `dev` | Local development helper |
| `test` | Automated test fixture |
| `uat` | UAT-specific setup |
| `prod` | Production-only change |
| `seed` | Seed execution mode |
| `demo` | Demo data |
| `perf` | Performance test data |
| `tenant-bootstrap` | Tenant onboarding |

Namun konteks harus dipakai hati-hati.

---

## 17. Contexts Untuk Environment Targeting

### 17.1 Use Case Yang Masuk Akal

Contoh dev-only data:

```yaml
- changeSet:
    id: 2026-06-17-060-dev-sample-customer
    author: fajar
    context: dev
    changes:
      - sql: |
          INSERT INTO customer(id, name)
          VALUES (100001, 'Local Dev Customer');
```

Contoh performance testing data:

```yaml
- changeSet:
    id: 2026-06-17-061-perf-test-index-helper
    author: fajar
    context: perf
    changes:
      - createIndex:
          tableName: audit_trail
          indexName: idx_audit_trail_perf_test
          columns:
            - column:
                name: created_at
```

### 17.2 Use Case Yang Berbahaya

Contoh buruk:

```yaml
- changeSet:
    id: 2026-06-17-062-create-customer-prod
    author: fajar
    context: prod
    changes:
      - createTable:
          tableName: customer
          columns:
            - column:
                name: id
                type: bigint

- changeSet:
    id: 2026-06-17-063-create-customer-uat
    author: fajar
    context: uat
    changes:
      - createTable:
          tableName: customer
          columns:
            - column:
                name: id
                type: bigint
            - column:
                name: test_flag
                type: varchar(10)
```

Ini menciptakan schema berbeda antara UAT dan production.

Kalau UAT tidak merepresentasikan production, UAT kehilangan fungsi utamanya.

Rule:

```text
Jangan gunakan contexts untuk membuat core schema berbeda antar environment.
```

Environment boleh berbeda untuk:

- Test data.
- Demo data.
- Performance data.
- Optional helper object.
- Environment-specific bootstrap yang memang bukan business schema inti.

Environment sebaiknya tidak berbeda untuk:

- Core table.
- Core column.
- Core constraint.
- Core index untuk query production.
- Business lookup utama.
- Permission model utama.

---

## 18. Context Expression

Contexts bisa memakai expression.

Contoh konseptual:

```yaml
context: dev,test
```

Artinya changeset relevan untuk dev atau test.

Contoh lain:

```yaml
context: '!prod'
```

Artinya bukan production.

Namun expression negatif seperti `!prod` perlu hati-hati.

Masalahnya:

```text
Kalau environment baru bernama staging, apakah staging seharusnya menerima changeset non-prod itu?
```

Sering kali lebih aman menulis allowlist eksplisit:

```yaml
context: dev,test
```

Daripada denylist:

```yaml
context: '!prod'
```

Rule:

```text
Untuk migration berisiko, gunakan allowlist. Jangan bergantung pada not-prod.
```

---

## 19. Labels: Filtering Berdasarkan Scope Logis

Labels mirip contexts, tetapi mental modelnya berbeda.

Contexts biasanya merepresentasikan mode/environment eksekusi.

Labels merepresentasikan metadata logis dari changeset:

- Fitur.
- Release.
- Modul.
- Tenant group.
- Regulatory package.
- Hotfix.
- Experiment.
- Data correction campaign.

Contoh:

```yaml
- changeSet:
    id: 2026-06-17-070-add-case-priority
    author: fajar
    labels: case-management,release-2026-q2
    changes:
      - addColumn:
          tableName: enforcement_case
          columns:
            - column:
                name: priority
                type: varchar(20)
```

Kemudian saat runtime, deployment bisa memilih label tertentu.

Mental model:

```text
Labels menjawab: changeset ini milik scope logis apa?
```

---

## 20. Contexts vs Labels

Perbandingan penting:

| Dimensi | Contexts | Labels |
|---|---|---|
| Pertanyaan | “Kapan/di mode mana dijalankan?” | “Bagian dari scope apa?” |
| Contoh | dev, test, prod, perf | feature-x, release-1.8, module-case |
| Owner | Deployment/runtime | Change author/governance |
| Sifat | Environment/execution oriented | Metadata/release oriented |
| Risiko | Environment drift | Selective deployment chaos |

Contoh kombinasi:

```yaml
- changeSet:
    id: 2026-06-17-080-seed-demo-cases
    author: fajar
    context: demo
    labels: case-management,demo-dataset
    changes:
      - sql: |
          INSERT INTO enforcement_case(case_no, title)
          VALUES ('DEMO-001', 'Demo enforcement case');
```

Artinya:

```text
Changeset ini hanya untuk konteks demo dan merupakan bagian dari dataset demo case-management.
```

---

## 21. Labels Untuk Release Targeting

Labels bisa dipakai untuk mengelompokkan changeset berdasarkan release.

Contoh:

```yaml
- changeSet:
    id: 2026-06-17-090-add-risk-score
    author: fajar
    labels: release-2.4.0,risk-engine
    changes:
      - addColumn:
          tableName: case_screening_result
          columns:
            - column:
                name: risk_score
                type: decimal(10,2)
```

Namun ada risiko besar jika labels dipakai sebagai pengganti ordering normal changelog.

Liquibase changelog tetap harus punya urutan deterministik.

Labels boleh membantu selection, tetapi jangan membuat database bisa lompat-lompat ke kombinasi perubahan yang tidak dites.

Contoh buruk:

```text
Run label feature-a, skip feature-b, run feature-c,
padahal feature-c bergantung pada column dari feature-b.
```

Rule:

```text
Labels boleh membatasi deployment, tapi dependency antar changeset harus tetap eksplisit dan diuji.
```

---

## 22. Labels Untuk Module Ownership

Dalam sistem Java enterprise besar, labels berguna untuk ownership.

Contoh:

```yaml
labels: module-case-management
labels: module-correspondence
labels: module-compliance
labels: module-reporting
labels: module-authz
```

Manfaat:

- Audit perubahan per modul.
- Review oleh owner modul.
- Impact analysis.
- Selective dry-run.
- Reporting migration scope.

Namun jangan menjadikan module labels sebagai cara menjalankan hanya sebagian schema tanpa dependency analysis.

Contoh:

```text
Liquibase update --label-filter=module-case-management
```

Ini hanya aman jika module benar-benar isolated.

Jika ada shared lookup, shared FK, atau shared audit table, selective execution bisa menyebabkan schema tidak konsisten.

---

## 23. Labels Untuk Hotfix

Hotfix database sering perlu dilacak.

Contoh:

```yaml
- changeSet:
    id: 2026-06-17-100-hotfix-fix-invalid-case-status
    author: fajar
    labels: hotfix,incident-2026-06-17,case-management
    preConditions:
      - onFail: HALT
      - sqlCheck:
          expectedResult: 3
          sql: |
            SELECT COUNT(*)
            FROM enforcement_case
            WHERE status = 'PENDNG'
    changes:
      - sql: |
          UPDATE enforcement_case
          SET status = 'PENDING'
          WHERE status = 'PENDNG';
```

Labels membantu audit:

```text
Tunjukkan semua database changeset terkait incident-2026-06-17.
```

Tetapi hotfix tetap harus masuk repository. Jangan melakukan manual update production lalu lupa merekonsiliasi changelog.

---

## 24. Labels Untuk Regulatory / Compliance Package

Dalam sistem regulated, labels dapat merepresentasikan regulatory scope.

Contoh:

```yaml
labels: regulatory-reporting,aml,release-2026-q3
labels: data-retention,privacy,release-2026-q3
labels: audit-trail,compliance,release-2026-q3
```

Manfaat:

- Bukti audit perubahan yang terkait regulasi tertentu.
- Traceability ke requirement/ticket.
- Approval workflow per domain.
- Segregation of duty.
- Impact analysis untuk compliance.

Namun label bukan pengganti approval system. Label hanya metadata di changelog. Evidence tetap perlu pipeline logs, ticket approval, code review, artifact hash, dan deployment record.

---

## 25. Jangan Memakai Context/Label Untuk Menyembunyikan Drift

Anti-pattern umum:

```yaml
context: prod
```

berisi SQL berbeda dari:

```yaml
context: uat
```

untuk schema inti.

Ini biasanya terjadi karena:

- Production sudah terlanjur beda.
- Ada manual hotfix.
- UAT refresh tidak sinkron.
- Developer mencoba “menyesuaikan” environment.

Masalahnya bukan context. Masalahnya adalah drift.

Solusi yang lebih baik:

1. Deteksi drift.
2. Dokumentasikan actual state.
3. Buat reconciliation migration.
4. Baseline/repair secara terkendali jika diperlukan.
5. Samakan kembali migration path.

Context/label tidak boleh menjadi tempat menyembunyikan database yang tidak konsisten.

---

## 26. Combining Preconditions, Contexts, and Labels

Ketiganya bisa dipakai bersama.

Contoh seed UAT untuk module case-management:

```yaml
- changeSet:
    id: 2026-06-17-110-uat-seed-case-types
    author: fajar
    context: uat
    labels: module-case-management,seed,release-2.4.0
    preConditions:
      - onFail: HALT
      - tableExists:
          tableName: case_type
      - sqlCheck:
          expectedResult: 0
          sql: |
            SELECT COUNT(*)
            FROM case_type
            WHERE code = 'DISCIPLINARY'
              AND name <> 'Disciplinary Case'
    changes:
      - sql: |
          INSERT INTO case_type(code, name, is_system)
          SELECT 'DISCIPLINARY', 'Disciplinary Case', true
          WHERE NOT EXISTS (
            SELECT 1 FROM case_type WHERE code = 'DISCIPLINARY'
          );
```

Interpretasi:

```text
Context: hanya untuk UAT.
Labels: bagian dari module case-management, seed, release 2.4.0.
Preconditions: hanya jalan kalau table ada dan tidak ada conflicting value.
```

---

## 27. Pattern: Safe Add Column With Backfill and Constraint

Contoh urutan production-grade:

### Step 1 — Expand: add nullable column

```yaml
- changeSet:
    id: 2026-06-17-120-add-customer-email-normalized
    author: fajar
    labels: customer,release-2.5.0,expand
    preConditions:
      - onFail: HALT
      - tableExists:
          tableName: customer
      - not:
          - columnExists:
              tableName: customer
              columnName: email_normalized
    changes:
      - addColumn:
          tableName: customer
          columns:
            - column:
                name: email_normalized
                type: varchar(320)
```

### Step 2 — Backfill

```yaml
- changeSet:
    id: 2026-06-17-121-backfill-customer-email-normalized
    author: fajar
    labels: customer,release-2.5.0,backfill
    preConditions:
      - onFail: HALT
      - columnExists:
          tableName: customer
          columnName: email
      - columnExists:
          tableName: customer
          columnName: email_normalized
    changes:
      - sql: |
          UPDATE customer
          SET email_normalized = LOWER(TRIM(email))
          WHERE email IS NOT NULL
            AND email_normalized IS NULL;
```

### Step 3 — Validate uniqueness before constraint

```yaml
- changeSet:
    id: 2026-06-17-122-unique-customer-email-normalized
    author: fajar
    labels: customer,release-2.5.0,constraint
    preConditions:
      - onFail: HALT
      - sqlCheck:
          expectedResult: 0
          sql: |
            SELECT COUNT(*)
            FROM (
              SELECT email_normalized
              FROM customer
              WHERE email_normalized IS NOT NULL
              GROUP BY email_normalized
              HAVING COUNT(*) > 1
            ) duplicate_email
    changes:
      - addUniqueConstraint:
          tableName: customer
          columnNames: email_normalized
          constraintName: uk_customer_email_normalized
```

This pattern matters because each changeset has a distinct risk profile.

```text
Add column    = schema expansion risk
Backfill      = data correctness/performance risk
Constraint    = invariant enforcement risk
```

Do not hide all three inside one giant changeset.

---

## 28. Pattern: Environment-Specific Demo Data Without Schema Drift

Correct pattern:

```yaml
- changeSet:
    id: 2026-06-17-130-demo-customer-data
    author: fajar
    context: demo
    labels: demo-data,customer
    preConditions:
      - onFail: HALT
      - tableExists:
          tableName: customer
    changes:
      - sql: |
          INSERT INTO customer(id, name, email)
          SELECT 900001, 'Demo Customer', 'demo.customer@example.test'
          WHERE NOT EXISTS (
            SELECT 1 FROM customer WHERE id = 900001
          );
```

Schema tetap sama. Hanya data demo yang berbeda.

Wrong pattern:

```yaml
- changeSet:
    id: 2026-06-17-131-demo-extra-column
    author: fajar
    context: demo
    changes:
      - addColumn:
          tableName: customer
          columns:
            - column:
                name: demo_only_flag
                type: varchar(10)
```

Ini membuat schema demo berbeda dari production.

---

## 29. Pattern: Production-Only Operational Fix

Kadang production butuh perubahan data yang tidak relevan di lower environment karena data incident hanya ada di production.

Gunakan context/label secara eksplisit dan precondition ketat.

```yaml
- changeSet:
    id: 2026-06-17-140-prod-fix-invalid-case-status
    author: fajar
    context: prod
    labels: hotfix,case-management,incident-2026-06-17
    preConditions:
      - onFail: HALT
      - sqlCheck:
          expectedResult: 12
          sql: |
            SELECT COUNT(*)
            FROM enforcement_case
            WHERE status = 'PENDNG'
    changes:
      - sql: |
          UPDATE enforcement_case
          SET status = 'PENDING'
          WHERE status = 'PENDNG';
```

Mengapa expected count eksplisit?

Karena untuk data correction incident, kamu biasanya tahu jumlah affected rows dari analysis. Jika jumlah berubah, berarti realitas production berubah dan harus re-evaluate.

Namun hati-hati: expected count bisa berubah jika sistem masih aktif menulis data. Untuk sistem live, gunakan freeze window, stronger predicate, atau pre-flight verification.

---

## 30. Pattern: Tenant Bootstrap

Untuk sistem multi-tenant, context/label bisa membantu bootstrap tenant.

```yaml
- changeSet:
    id: 2026-06-17-150-bootstrap-default-tenant-config
    author: fajar
    context: tenant-bootstrap
    labels: tenant,bootstrap,config
    preConditions:
      - onFail: HALT
      - tableExists:
          tableName: tenant_config
    changes:
      - sql: |
          INSERT INTO tenant_config(tenant_id, config_key, config_value)
          SELECT '${tenantId}', 'CASE_AUTO_ASSIGNMENT', 'false'
          WHERE NOT EXISTS (
            SELECT 1
            FROM tenant_config
            WHERE tenant_id = '${tenantId}'
              AND config_key = 'CASE_AUTO_ASSIGNMENT'
          );
```

Catatan penting:

- Placeholder tenant harus dikontrol pipeline/job.
- Jangan hardcode tenant production sembarangan.
- Tenant bootstrap perlu audit.
- Tenant migration registry biasanya diperlukan untuk tenant-per-schema atau tenant-per-database.

---

## 31. Governance Rules Untuk Contexts

Gunakan aturan ini di team:

### Rule 1 — Core schema tidak boleh context-specific

Buruk:

```yaml
context: uat
changes:
  - addColumn: test_only_core_column
```

Baik:

```yaml
Core schema changeset tanpa context environment.
```

### Rule 2 — Dev/test/demo data harus context-specific

Buruk:

```yaml
INSERT INTO app_user(username) VALUES ('dev.admin');
```

tanpa context.

Baik:

```yaml
context: dev
```

### Rule 3 — Jangan pakai `!prod` untuk data berisiko

Buruk:

```yaml
context: '!prod'
```

Baik:

```yaml
context: dev,test
```

### Rule 4 — Context list harus terdokumentasi

Harus ada daftar resmi:

```text
dev
local-test
integration-test
uat
perf
demo
prod
tenant-bootstrap
```

Jangan biarkan setiap developer membuat context baru tanpa standar.

---

## 32. Governance Rules Untuk Labels

### Rule 1 — Label harus punya taxonomy

Contoh taxonomy:

```text
module:<module-name>
release:<release-id>
feature:<feature-id>
hotfix:<incident-id>
seed
backfill
expand
contract
compliance:<domain>
```

Karena Liquibase label string biasanya sederhana, implementasi praktis bisa memakai format:

```text
module-case-management
release-2.5.0
feature-risk-score
hotfix-incident-2026-06-17
seed
backfill
expand
contract
compliance-audit-trail
```

### Rule 2 — Jangan pakai label sebagai pengganti branch strategy

Label bukan version control.

Buruk:

```text
Semua fitur masuk master changelog, nanti pilih pakai label saat deploy.
```

Risiko:

- Dependency kacau.
- Kombinasi tidak dites.
- Release tidak reproducible.
- Database state sulit dijelaskan.

### Rule 3 — Label harus membantu audit

Label baik menjawab:

```text
Perubahan ini milik modul apa?
Perubahan ini bagian release apa?
Apakah ini seed/backfill/contract/hotfix?
Apakah ini terkait compliance domain tertentu?
```

### Rule 4 — Jangan over-label

Buruk:

```yaml
labels: case,customer,data,table,column,small-change,fajar,june,wednesday,prod-safe
```

Label terlalu banyak menjadi noise.

Gunakan label yang mendukung filtering, audit, dan governance.

---

## 33. Governance Rules Untuk Preconditions

### Rule 1 — Gunakan precondition untuk asumsi penting

Jika migration akan gagal buruk saat asumsi salah, tulis precondition.

### Rule 2 — Jangan gunakan precondition untuk membuat migration “fleksibel tanpa batas”

Buruk:

```yaml
if table exists do this
if not exists do that
if column exists skip
if data exists update
if not exists insert
```

Jika changeset terlalu fleksibel, hasil akhirnya sulit diprediksi.

Migration harus deterministik.

### Rule 3 — Untuk destructive change, precondition wajib ketat

Drop column/table tanpa guard adalah red flag.

### Rule 4 — SQL check harus cukup murah

Precondition yang melakukan full table scan besar saat deployment bisa menjadi masalah.

Contoh mahal:

```sql
SELECT COUNT(*) FROM audit_trail WHERE dbms_lob.getlength(metadata) > 0;
```

Pada table CLOB besar, ini bisa mahal sekali.

Untuk table besar, pertimbangkan:

- Precomputed validation table.
- Sampling terbatas jika sesuai.
- Index-supported predicate.
- Pre-flight validation job.
- Manual approval evidence.

### Rule 5 — Precondition bukan observability

Precondition hanya guard saat execution. Tetap butuh log, metric, dashboard, dan post-deploy validation.

---

## 34. Anti-Pattern: Context Explosion

Context explosion terjadi ketika context bertambah tanpa kendali:

```text
dev
local
local-fajar
test
qa
sit
sit2
uat
uat-new
uat-client
staging
preprod
prod
prod-hotfix
prod-client-a
not-prod
nonprod
```

Gejala:

- Tidak ada yang tahu context mana dipakai pipeline.
- Changeset penting tidak jalan karena context salah.
- Dev data masuk UAT/production.
- Production fix tidak pernah dites di staging.
- Changelog menjadi maze.

Solusi:

- Buat registry context resmi.
- Pipeline hanya boleh memakai context dari registry.
- Code review menolak context baru tanpa approval.
- Jangan menamai context berdasarkan orang.
- Jangan menamai context berdasarkan temporary incident kecuali benar-benar hotfix terkontrol.

---

## 35. Anti-Pattern: Label as Feature Toggle Runtime

Label bukan runtime feature flag.

Buruk:

```text
Feature belum siap? Jangan run label feature-x.
Feature siap? Run label feature-x nanti.
```

Masalah:

- Database changes sering menjadi dependency untuk code path lain.
- Skipping schema change bisa membuat aplikasi gagal start.
- Selective label deployment menciptakan state yang tidak diuji.

Lebih baik:

```text
Deploy database change secara backward-compatible.
Gunakan application feature flag untuk behavior runtime.
```

Contoh:

- Add nullable column sekarang.
- Deploy code yang bisa handle old/new state.
- Backfill.
- Enable feature flag.
- Enforce constraint/contract kemudian.

---

## 36. Anti-Pattern: Preconditions as Band-Aid for Bad Ordering

Buruk:

```yaml
- changeSet:
    id: 010-create-order
    preConditions:
      - onFail: CONTINUE
      - tableExists:
          tableName: customer
    changes:
      - createTable:
          tableName: customer_order
```

Ini mencoba menyembunyikan dependency ordering.

Jika `customer` harus ada sebelum `customer_order`, pastikan changelog order benar.

Precondition boleh memvalidasi dependency, bukan menggantikan dependency ordering.

Correct mental model:

```text
Ordering menentukan urutan perubahan.
Precondition memvalidasi asumsi urutan itu masih benar terhadap database aktual.
```

---

## 37. Anti-Pattern: Production Secrets in Seed Changesets

Buruk:

```yaml
- changeSet:
    id: seed-prod-admin
    context: prod
    changes:
      - sql: |
          INSERT INTO app_user(username, password_hash)
          VALUES ('admin', 'hardcoded-hash');
```

Masalah:

- Secret masuk Git.
- Secret masuk changelog artifact.
- Secret masuk logs/backups.
- Rotation sulit.
- Audit buruk.

Better:

- Seed role/permission structure, bukan secret.
- Initial admin dibuat melalui secure provisioning flow.
- Password/token berasal dari secret manager/runtime secure channel.
- Changelog hanya membuat structural requirement.

---

## 38. Anti-Pattern: Environment-Specific Business Semantics

Buruk:

```yaml
context: uat
INSERT INTO approval_threshold(amount) VALUES (1000);

context: prod
INSERT INTO approval_threshold(amount) VALUES (5000);
```

Jika approval threshold adalah business configuration, perbedaannya harus dikelola sebagai configuration governance, bukan disembunyikan di migration context.

Pertanyaan yang harus dijawab:

- Apakah threshold memang berbeda per environment?
- Siapa approvernya?
- Apakah UAT masih valid untuk test production behavior?
- Apakah perubahan threshold perlu audit business?

Migration changelog bukan tempat terbaik untuk semua operational configuration.

---

## 39. Design Checklist Sebelum Menambahkan Context/Label/Precondition

Sebelum menulis context:

```text
[ ] Apakah changeset ini benar-benar environment/mode-specific?
[ ] Apakah schema inti tetap sama antar environment?
[ ] Apakah context termasuk registry resmi?
[ ] Apakah pipeline menjalankan context ini secara eksplisit?
[ ] Apakah risiko accidental execution sudah dikurangi?
```

Sebelum menulis label:

```text
[ ] Apakah label membantu release, module, audit, atau governance?
[ ] Apakah label mengikuti taxonomy resmi?
[ ] Apakah label tidak menggantikan branching/release discipline?
[ ] Apakah selective deployment dengan label sudah diuji?
[ ] Apakah dependency antar label jelas?
```

Sebelum menulis precondition:

```text
[ ] Asumsi apa yang sedang divalidasi?
[ ] Apakah onFail harus HALT, MARK_RAN, WARN, atau CONTINUE?
[ ] Apakah check cukup murah untuk production?
[ ] Apakah check mendeteksi drift yang penting?
[ ] Apakah destructive action punya guard kuat?
[ ] Apakah data migration punya validation query?
[ ] Apakah hasil precondition deterministik?
```

---

## 40. Review Checklist Untuk Pull Request

Saat review Liquibase PR, cek:

### Identity

```text
[ ] Changeset id unik.
[ ] Author jelas.
[ ] File path stabil.
[ ] Tidak mengubah changeset lama yang sudah deployed.
```

### Contexts

```text
[ ] Context hanya dipakai jika memang perlu.
[ ] Tidak membuat schema inti berbeda antar environment.
[ ] Context terdaftar di registry.
[ ] Tidak menggunakan denylist berbahaya seperti !prod untuk perubahan sensitif.
```

### Labels

```text
[ ] Label mengikuti taxonomy.
[ ] Ada release/module label jika diwajibkan team.
[ ] Hotfix/incident label jelas jika relevan.
[ ] Tidak memakai label untuk deployment kombinasi yang belum dites.
```

### Preconditions

```text
[ ] Preconditions memvalidasi asumsi penting.
[ ] Destructive changes memakai HALT.
[ ] MARK_RAN hanya dipakai jika state ekuivalen.
[ ] SQL check tidak terlalu mahal.
[ ] Data migration punya validation guard.
[ ] Constraint introduction mengecek data historis.
```

### Runtime

```text
[ ] Pipeline menjalankan context/label yang benar.
[ ] Dry-run/updateSQL direview jika tersedia.
[ ] Rollback/roll-forward strategy jelas.
[ ] Post-deploy validation tersedia.
```

---

## 41. Example: Enterprise Changelog Dengan Control Plane

```yaml
databaseChangeLog:
  - preConditions:
      - onFail: HALT
      - dbms:
          type: postgresql

  - changeSet:
      id: 2026-06-17-200-expand-case-priority
      author: fajar
      labels: module-case-management,release-2.6.0,expand
      preConditions:
        - onFail: HALT
        - tableExists:
            tableName: enforcement_case
        - not:
            - columnExists:
                tableName: enforcement_case
                columnName: priority
      changes:
        - addColumn:
            tableName: enforcement_case
            columns:
              - column:
                  name: priority
                  type: varchar(20)

  - changeSet:
      id: 2026-06-17-201-seed-case-priority-lookup
      author: fajar
      labels: module-case-management,release-2.6.0,seed
      preConditions:
        - onFail: HALT
        - tableExists:
            tableName: case_priority
        - sqlCheck:
            expectedResult: 0
            sql: |
              SELECT COUNT(*)
              FROM case_priority
              WHERE code = 'HIGH'
                AND display_name <> 'High'
      changes:
        - sql: |
            INSERT INTO case_priority(code, display_name, sort_order)
            SELECT 'HIGH', 'High', 10
            WHERE NOT EXISTS (
              SELECT 1 FROM case_priority WHERE code = 'HIGH'
            );

  - changeSet:
      id: 2026-06-17-202-demo-case-priority-data
      author: fajar
      context: demo
      labels: module-case-management,demo-data
      preConditions:
        - onFail: HALT
        - tableExists:
            tableName: enforcement_case
      changes:
        - sql: |
            UPDATE enforcement_case
            SET priority = 'HIGH'
            WHERE case_no = 'DEMO-CASE-001';
```

Yang bagus dari contoh ini:

- DBMS guard jelas.
- Core schema tidak context-specific.
- Demo data context-specific.
- Labels membantu module/release/audit.
- Preconditions memvalidasi assumptions.
- Seed tidak blindly overwrite.

---

## 42. Java/Spring Boot Configuration Awareness

Dalam Spring Boot, Liquibase bisa dikonfigurasi melalui properties. Secara umum, kamu harus memastikan context dan label filter yang dipakai pipeline jelas.

Contoh konseptual:

```yaml
spring:
  liquibase:
    change-log: classpath:/db/changelog/db.changelog-master.yaml
    contexts: dev
    label-filter: module-case-management
```

Namun hati-hati: jangan membuat aplikasi production diam-diam menjalankan context/label berbeda karena profile salah.

Untuk production-grade system, sering lebih aman menjalankan Liquibase sebagai pipeline step atau Kubernetes Job dengan parameter eksplisit, bukan implicit startup behavior yang bergantung pada active profile.

Contoh model deployment:

```text
CI/CD pipeline
  ├── build app artifact
  ├── validate changelog
  ├── generate updateSQL/dry-run
  ├── approval
  ├── run Liquibase migration job with explicit context/label
  ├── verify DATABASECHANGELOG
  └── deploy application
```

---

## 43. Context/Label Parameterization Risk

Jika context/label berasal dari environment variable:

```bash
liquibase update \
  --contexts=${LIQUIBASE_CONTEXTS} \
  --label-filter=${LIQUIBASE_LABEL_FILTER}
```

Pastikan:

```text
[ ] Variable wajib ada.
[ ] Empty value tidak berarti “run everything” tanpa sengaja.
[ ] Pipeline menampilkan value yang digunakan.
[ ] Approval mencakup context/label value.
[ ] Production value dikunci.
```

Salah satu failure mode paling berbahaya:

```text
Expected: run with context=prod
Actual: context variable kosong
Effect: changeset yang seharusnya difilter bisa ikut/skip tergantung konfigurasi dan versi/tooling
```

Karena itu, treat context/label values as deployment inputs.

---

## 44. Production Runbook Untuk Preconditions Failure

Jika migration gagal karena precondition:

```text
1. Jangan langsung repair.
2. Jangan langsung ubah checksum.
3. Jangan edit changeset lama yang sudah deployed.
4. Ambil error detail.
5. Identifikasi precondition mana yang gagal.
6. Bandingkan expected state vs actual database state.
7. Tentukan apakah ini:
   a. drift,
   b. dependency missing,
   c. salah environment,
   d. data belum siap,
   e. bug di precondition,
   f. bug di migration ordering.
8. Putuskan recovery:
   a. fix data lalu rerun,
   b. apply missing previous migration,
   c. buat reconciliation changeset,
   d. rollback release,
   e. roll-forward dengan hotfix migration.
9. Dokumentasikan keputusan.
```

Precondition failure adalah sinyal, bukan gangguan yang harus dimatikan.

---

## 45. Production Runbook Untuk Wrong Context/Label

Jika context/label salah:

### Scenario A — Changeset yang harus jalan ternyata tidak jalan

```text
1. Stop application deployment jika schema belum compatible.
2. Jalankan Liquibase status/history.
3. Verifikasi changeset missing.
4. Jalankan ulang dengan context/label benar jika masih aman.
5. Jika aplikasi sudah deploy, evaluasi compatibility.
6. Tambahkan pipeline guard agar tidak berulang.
```

### Scenario B — Changeset yang tidak boleh jalan ternyata jalan

```text
1. Identifikasi changeset affected.
2. Cek apakah perubahan destructive atau data-mutating.
3. Jangan asumsi rollback aman.
4. Generate rollback SQL jika tersedia, review manual.
5. Jika data berubah, bandingkan backup/audit.
6. Putuskan rollback atau roll-forward.
7. Tambahkan deployment input validation.
```

---

## 46. Recommended Team Standard

Contoh standard minimal untuk team Java enterprise:

```text
1. Semua core schema migration tidak memakai context environment.
2. Context hanya untuk dev/test/demo/perf/tenant-bootstrap/prod-hotfix yang disetujui.
3. Production data correction wajib:
   - context=prod atau label hotfix,
   - ticket/incident label,
   - precondition expected count jika memungkinkan,
   - post-deploy validation query.
4. Semua destructive changes wajib precondition HALT.
5. Semua constraint introduction wajib data validation precondition.
6. Semua seed wajib idempotent dan tidak blindly overwrite.
7. Labels wajib minimal mencakup module dan release untuk changeset production.
8. Label filter tidak boleh digunakan untuk kombinasi deployment yang belum diuji.
9. MARK_RAN membutuhkan justification di PR.
10. Context/label values di pipeline harus explicit, logged, dan approved.
```

---

## 47. Ringkasan Mental Model

Preconditions, contexts, dan labels bukan fitur kosmetik.

Mereka adalah cara untuk mengubah migration dari:

```text
script execution
```

menjadi:

```text
controlled database change delivery
```

Inti pemahamannya:

```text
Preconditions protect against wrong database state.
Contexts protect against wrong execution mode.
Labels protect traceability and selection by logical scope.
```

Namun masing-masing bisa menjadi sumber masalah:

```text
Bad preconditions  -> false safety or hidden drift
Bad contexts       -> environment divergence
Bad labels         -> untested selective deployment
```

Top-tier engineer tidak hanya bertanya:

```text
Apakah migration bisa jalan?
```

Tetapi:

```text
Apakah migration ini boleh jalan dalam state ini,
di environment ini,
untuk release/scope ini,
dengan failure behavior yang eksplisit,
dan hasil akhirnya deterministic serta defensible?
```

---

## 48. Latihan Praktis

### Latihan 1 — Add Column Guard

Buat changeset Liquibase untuk menambahkan column `customer.phone_number` dengan precondition:

```text
- table customer harus ada
- column phone_number belum boleh ada
- jika gagal, HALT
```

### Latihan 2 — Constraint Guard

Buat migration untuk menambahkan unique constraint pada `app_user.username` dengan precondition:

```text
- tidak boleh ada duplicate username
- username tidak boleh null
- constraint belum boleh ada
```

### Latihan 3 — Seed Drift Detection

Buat seed role `CASE_SUPERVISOR`:

```text
code = CASE_SUPERVISOR
name = Case Supervisor
is_system = true
```

Syarat:

```text
- insert jika belum ada
- jika sudah ada dengan value berbeda, HALT
- jangan blindly update
```

### Latihan 4 — Context Design

Klasifikasikan changeset berikut apakah perlu context atau tidak:

```text
1. create table customer
2. insert demo customer
3. add production hotfix correction
4. seed country code
5. create performance test dataset
6. add not null constraint
7. insert local dev admin user
```

### Latihan 5 — Label Taxonomy

Desain label taxonomy untuk sistem dengan modul:

```text
case-management
correspondence
compliance
audit-trail
reporting
authz
```

Harus mendukung:

```text
- release tracking
- module ownership
- seed/backfill/expand/contract classification
- hotfix/incident tracking
- compliance domain tracking
```

---

## 49. Jawaban Singkat Latihan 4

| Changeset | Perlu context? | Alasan |
|---|---:|---|
| create table customer | Tidak | Core schema harus sama antar environment |
| insert demo customer | Ya, `demo` | Demo data bukan production data |
| production hotfix correction | Ya/label hotfix | Scope operational khusus production/incident |
| seed country code | Biasanya tidak | Reference data core harus konsisten |
| performance test dataset | Ya, `perf` | Data volume test tidak boleh masuk production |
| add not null constraint | Tidak | Core invariant schema |
| insert local dev admin user | Ya, `dev` | Local-only helper data |

---

## 50. Penutup

Part ini membahas tiga fitur yang sering dianggap detail kecil, tetapi sebenarnya menentukan apakah Liquibase bisa dipakai sebagai database change governance tool yang serius.

Setelah memahami bagian ini, kamu harus mulai melihat migration sebagai kombinasi:

```text
changeset body + execution guard + selection metadata + audit trail
```

Bukan hanya:

```text
SQL yang dijalankan berurutan.
```

Di Part berikutnya kita akan masuk ke topik yang lebih sensitif: **Liquibase rollback engineering**. Kita akan membahas mengapa rollback database sering tidak simetris, kapan rollback valid, kapan harus roll-forward, bagaimana menulis rollback block, dan bagaimana mendesain rollback decision tree untuk production.

---

# Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 14 selesai dari total 34 part.
```

Part berikutnya:

```text
15-liquibase-rollback-engineering.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 13 — Liquibase Changelog Design](./13-liquibase-changelog-design.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 15 — Liquibase Rollback Engineering](./15-liquibase-rollback-engineering.md)

</div>
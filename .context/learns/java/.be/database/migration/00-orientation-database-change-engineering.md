# Part 0 — Orientation: Database Change as Engineering Discipline

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `00-orientation-database-change-engineering.md`  
**Target:** Java 8 hingga Java 25  
**Level:** Advanced / production-grade / architecture-oriented  

> Tujuan bagian ini bukan langsung menghafal command Flyway atau Liquibase. Tujuan bagian ini adalah membangun _mental model_ bahwa perubahan database adalah disiplin engineering tersendiri: ada state, ordering, compatibility, auditability, rollback semantics, failure recovery, dan operational governance.

---

## 0.1 Posisi Materi Ini Dalam Seri Besar Java

Sebelumnya kita sudah membahas banyak fondasi Java dan enterprise backend:

- Java language, collections, concurrency, data types, reliability, DSA.
- I/O, networking, HTTP/gRPC, filesystem, security, JDBC, HikariCP.
- OOP, functional, reflection, testing, JVM memory, Jakarta.
- JAX-RS, Validation, JPA, Hibernate, EclipseLink, MyBatis.
- CDI, Servlet, WebSocket, JSON/XML/SOAP, security/authentication/authorization/identity.
- Jakarta concurrency, batch, mail, server-side UI.
- Build tools, deployment, runtime release delivery, mapper/transformation engineering.

Karena itu, seri ini tidak akan mengulang hal-hal seperti:

- Cara membuat `DataSource`.
- Cara menulis query JDBC sederhana.
- Cara mapping entity JPA.
- Cara kerja persistence context Hibernate.
- Cara konfigurasi MyBatis mapper.
- Cara dasar SQL `SELECT`, `INSERT`, `UPDATE`, `DELETE`.
- Cara dasar Spring Boot project.

Seri ini akan fokus pada lapisan yang lebih tinggi dan lebih berbahaya:

> Bagaimana perubahan database diperlakukan sebagai artefak release yang terkontrol, reproducible, observable, auditable, compatible, dan recoverable.

Dalam sistem kecil, database migration sering terasa seperti folder berisi file SQL. Dalam sistem production besar, database migration adalah mekanisme koordinasi antara:

- developer,
- reviewer,
- CI/CD,
- database administrator,
- release manager,
- security,
- compliance,
- SRE/operations,
- aplikasi versi lama,
- aplikasi versi baru,
- data historis,
- data aktif,
- downtime budget,
- rollback policy,
- dan business continuity.

Itulah sudut pandang yang akan kita pakai.

---

## 0.2 Core Problem: Code Bisa Diganti, Database Membawa Riwayat

Aplikasi Java bisa di-build ulang dari source code. Container image bisa diganti. Pod Kubernetes bisa dihancurkan dan dibuat ulang. Artifact lama bisa diganti artifact baru.

Database berbeda.

Database adalah stateful system. Ia membawa riwayat:

- data user,
- transaksi,
- audit trail,
- konfigurasi,
- permission,
- workflow state,
- dokumen,
- event,
- error lama,
- data legacy,
- dan keputusan masa lalu.

Kode biasanya stateless atau setidaknya lebih mudah diredeploy. Database tidak bisa begitu saja dihapus dan dibuat ulang di production.

Perbedaan mental model:

| Aspek | Code/Application | Database |
|---|---|---|
| Bisa rebuild dari source? | Umumnya iya | Tidak, karena berisi state historis |
| Bisa rollback artifact? | Relatif mudah | Sulit jika schema/data sudah berubah |
| Versi lama bisa dibuang? | Bisa | Data lama tetap ada |
| Perubahan salah bisa diulang? | Biasanya mudah | Bisa menyebabkan data loss atau corruption |
| Testing fresh install cukup? | Kadang cukup | Tidak cukup; perlu upgrade dari state lama |
| Failure impact | Service error | Data corruption, downtime, compliance issue |

Inilah akar mengapa migration engineering penting.

Saat developer menulis:

```sql
ALTER TABLE application ADD status VARCHAR2(50);
```

ia mungkin berpikir: “Saya hanya tambah kolom.”

Tetapi engineer production-grade akan bertanya:

1. Apakah operasi ini locking table?
2. Apakah aman saat traffic berjalan?
3. Apakah kolom nullable atau non-null?
4. Apakah aplikasi versi lama bisa tetap berjalan setelah kolom ditambah?
5. Apakah aplikasi versi baru bisa berjalan sebelum kolom ada?
6. Apakah perlu default value?
7. Apakah default value akan rewrite seluruh table?
8. Apakah perlu backfill?
9. Apakah query existing berubah execution plan?
10. Apakah perlu index?
11. Apakah index bisa dibuat online/concurrently?
12. Apakah rollback code masih kompatibel dengan schema baru?
13. Apakah migration ini bisa diulang di SIT/UAT/PROD dengan hasil sama?
14. Apakah ada audit trail bahwa migration ini pernah dijalankan?
15. Apakah ada cara mendeteksi kalau file migration diubah setelah dijalankan?
16. Apakah seed data perlu update?
17. Apakah environment lain akan drift?
18. Apakah DBA perlu approve?
19. Apakah ada query validasi pasca migration?
20. Apakah kita punya runbook jika migration gagal di tengah?

Pertanyaan-pertanyaan inilah yang membedakan “bisa menulis SQL” dari “bisa mengelola perubahan database”.

---

## 0.3 Apa Itu Database Migration?

Secara sederhana:

> Database migration adalah proses terkontrol untuk membawa database dari satu state/version ke state/version berikutnya.

Tetapi definisi yang lebih engineering:

> Database migration adalah serangkaian perubahan terurut, terdokumentasi, dapat direproduksi, dapat divalidasi, dan dapat diaudit, yang mengubah struktur, data, constraint, object, atau metadata database agar tetap kompatibel dengan kontrak aplikasi dan kebutuhan bisnis.

Migration bukan hanya DDL.

Migration bisa mencakup:

- membuat table,
- menambah kolom,
- menghapus kolom,
- mengubah tipe data,
- membuat index,
- menambah constraint,
- membuat view,
- membuat function/procedure,
- backfill data,
- normalisasi data,
- denormalisasi data,
- memperbaiki data historis,
- mengubah reference data,
- menambah permission seed,
- menambah feature flag,
- membuat tenant bootstrap,
- mengubah sequence,
- mengubah trigger,
- memperbarui stored procedure,
- mengubah materialized view,
- atau membangun compatibility layer.

Flyway dan Liquibase adalah tool untuk mengelola perubahan ini. Tetapi tool bukan inti pemahaman. Tool hanya implementasi dari disiplin yang lebih fundamental.

Jika mental model salah, Flyway atau Liquibase tetap bisa digunakan dengan buruk.

Contoh penggunaan buruk:

- mengedit migration lama setelah sudah jalan di production,
- memakai `clean` sembarangan,
- seed data dengan `DELETE FROM table; INSERT ...` di production,
- menjalankan migration otomatis saat setiap pod startup tanpa lock strategy yang jelas,
- mencampur Hibernate `ddl-auto=update` dengan migration tool,
- menaruh password admin default di seed,
- menganggap rollback database selalu mungkin,
- membuat migration besar yang mengunci table aktif selama jam kerja,
- memakai H2 untuk menguji migration PostgreSQL/Oracle lalu percaya diri deploy,
- menjalankan data correction manual tanpa migration history.

Top engineer tidak hanya tahu command. Top engineer tahu failure surface.

---

## 0.4 Mengapa Database Change Lebih Sulit Dari Code Change?

Ada beberapa alasan struktural.

### 0.4.1 Database Adalah Shared Mutable State

Dalam banyak sistem enterprise, database dipakai oleh banyak pihak:

- service utama,
- batch job,
- reporting job,
- admin portal,
- ETL,
- data warehouse pipeline,
- legacy integration,
- external connector,
- manual support query,
- audit process,
- regulatory export,
- BI dashboard.

Mengubah satu kolom bisa merusak lebih dari satu aplikasi.

Contoh:

```sql
ALTER TABLE case_file RENAME COLUMN officer_id TO assigned_officer_id;
```

Dari sudut pandang service baru, ini bersih. Tetapi mungkin ada:

- report lama yang masih membaca `officer_id`,
- stored procedure yang memakai `officer_id`,
- MyBatis XML query yang hardcode `officer_id`,
- Excel export query,
- database view,
- data warehouse job,
- audit query,
- integration mapping.

Karena database sering menjadi integration surface tersembunyi, perubahan schema harus dianggap sebagai contract change.

### 0.4.2 Database Version Tidak Selalu Sama Dengan Application Version

Aplikasi bisa punya version `2.4.0`.

Database mungkin sudah berada di migration `V20260617_083000__add_case_status.sql`.

Di saat deployment rolling:

- sebagian pod masih aplikasi lama,
- sebagian pod sudah aplikasi baru,
- database sudah schema baru,
- traffic masih masuk,
- batch job mungkin berjalan,
- scheduler mungkin aktif,
- external integration mungkin belum tahu perubahan.

Jadi pertanyaannya bukan hanya “apakah aplikasi baru cocok dengan database baru?”

Pertanyaan yang benar:

| Kombinasi | Harus Dipikirkan? |
|---|---:|
| Old app + old schema | Baseline normal |
| New app + new schema | Target akhir |
| Old app + new schema | Penting untuk rolling deploy/rollback |
| New app + old schema | Penting jika app start sebelum migration selesai |

Top engineer mendesain migration agar kombinasi transisional tetap aman atau setidaknya dikendalikan.

### 0.4.3 Rollback Code Tidak Sama Dengan Rollback Database

Rollback aplikasi biasanya berarti deploy ulang image lama.

Rollback database tidak sesederhana itu.

Misalnya release baru melakukan:

```sql
ALTER TABLE customer DROP COLUMN legacy_code;
```

Lalu aplikasi baru gagal di production. Kita rollback aplikasi ke versi lama. Tetapi aplikasi lama masih butuh `legacy_code`.

Masalah:

- kolom sudah hilang,
- data di kolom itu sudah hilang,
- backup restore mungkin terlalu mahal,
- restore bisa menghilangkan transaksi baru,
- membuat ulang kolom tidak mengembalikan data,
- rollback SQL tidak cukup.

Karena itu, banyak organisasi mature memakai prinsip:

> Prefer roll-forward untuk database. Hindari destructive changes sampai benar-benar aman.

Rollback database bisa mungkin untuk perubahan tertentu, tetapi tidak boleh diasumsikan universal.

### 0.4.4 Data Lama Tidak Selalu Sesuai Asumsi Baru

Developer sering membuat migration berdasarkan model ideal.

Contoh:

```sql
ALTER TABLE application ADD CONSTRAINT chk_status
CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));
```

Secara domain terlihat benar. Tetapi data lama mungkin punya:

- `NULL`,
- `draft`,
- `Draft`,
- `PENDING_APPROVAL`,
- empty string,
- typo,
- data hasil manual patch,
- data migrasi dari sistem lama.

Constraint yang benar secara model bisa gagal karena realita data.

Top engineer selalu membedakan:

- target domain model,
- current production data reality,
- transitional compatibility,
- cleanup path.

### 0.4.5 Performance dan Locking Bisa Lebih Berbahaya Dari Syntax Error

Syntax error biasanya terlihat cepat.

Yang lebih berbahaya:

- migration jalan 40 menit,
- table lock membuat request timeout,
- index creation memblokir write,
- backfill membuat undo/redo/WAL membengkak,
- replication lag naik,
- CPU database spike,
- connection pool habis,
- batch job deadlock,
- transaction log penuh,
- storage penuh,
- autovacuum terganggu,
- Oracle undo tablespace membengkak,
- MySQL metadata lock menunggu transaksi lama,
- PostgreSQL `CREATE INDEX` non-concurrent memblokir write.

Migration harus dipikirkan sebagai workload production, bukan script administratif kecil.

---

## 0.5 Tooling Landscape: Flyway dan Liquibase Dalam Satu Kalimat

Kita akan mendalami Flyway dan Liquibase nanti. Untuk Part 0, cukup pahami posisi mentalnya.

### Flyway

Flyway cenderung SQL-first, sederhana, linear, dan convention-driven.

Mental model:

> “Saya punya urutan script migration. Tool akan mencatat mana yang sudah dijalankan, memvalidasi checksum, lalu menjalankan yang belum.”

Konsep penting Flyway:

- versioned migration,
- repeatable migration,
- schema history table,
- checksum,
- validate,
- repair,
- baseline,
- clean,
- callbacks,
- Java migration.

Dokumentasi Redgate menyebut Flyway menambahkan schema history table khusus sebagai audit trail perubahan yang dilakukan terhadap schema. Ini penting karena migration history bukan hanya metadata teknis, melainkan bukti urutan perubahan database.

### Liquibase

Liquibase cenderung changelog-first, changeset-based, lebih ekspresif, dan punya fitur governance lebih kaya.

Mental model:

> “Saya mendefinisikan daftar changeset dalam changelog. Tool akan mencatat changeset mana yang sudah dijalankan, memvalidasi checksum, memakai precondition/context/label bila perlu, dan bisa membantu menghasilkan rollback untuk beberapa jenis perubahan.”

Konsep penting Liquibase:

- changelog,
- changeset,
- `DATABASECHANGELOG`,
- `DATABASECHANGELOGLOCK`,
- checksum,
- preconditions,
- contexts,
- labels,
- rollback,
- tag,
- include/includeAll,
- SQL/XML/YAML/JSON changelog.

Dokumentasi Liquibase menyebut changeset sebagai unit dasar perubahan di dalam changelog. Jadi “unit of change” Liquibase bukan file SQL secara mentah, tetapi changeset identity: kombinasi id, author, dan lokasi/logical file path.

### Spring Boot Context

Spring Boot mendukung Flyway dan Liquibase sebagai migration tool tingkat lebih tinggi. Dokumentasi Spring Boot memperingatkan bahwa jika memakai Flyway atau Liquibase, sebaiknya tool itu digunakan sendiri untuk membuat dan menginisialisasi schema; mencampurnya dengan `schema.sql` dan `data.sql` tidak direkomendasikan.

Pelajaran pentingnya:

> Dalam sistem serius, harus ada satu mekanisme utama yang menjadi source of truth untuk schema/database initialization. Jangan ada banyak mekanisme diam-diam yang saling berebut mengubah database.

---

## 0.6 Database Migration Bukan Sekadar Startup Script

Banyak developer Java pertama kali mengenal migration melalui Spring Boot:

- tambahkan dependency Flyway,
- taruh file di `src/main/resources/db/migration`,
- aplikasi start,
- migration jalan otomatis.

Untuk local development, ini nyaman.

Tetapi di production, pendekatan “migration jalan saat app startup” punya pertanyaan serius:

1. Kalau ada 10 pod start bersamaan, siapa yang menjalankan migration?
2. Apakah tool lock cukup?
3. Apa yang terjadi jika pod mati di tengah migration?
4. Apakah readiness probe menunggu migration selesai?
5. Apakah migration lambat menyebabkan rollout timeout?
6. Apakah migration membutuhkan privilege lebih besar dari app user?
7. Apakah app runtime user boleh punya `ALTER TABLE`?
8. Apakah semua pod harus membawa migration script?
9. Apakah deployment aplikasi harus gagal jika migration gagal?
10. Apakah kita ingin migration terjadi sebelum atau sesudah traffic dialihkan?

Dalam production-grade system, ada beberapa model eksekusi:

| Model | Deskripsi | Cocok Untuk | Risiko |
|---|---|---|---|
| App startup migration | App menjalankan migration saat boot | Small/simple services | Startup delay, privilege issue, multi-pod concern |
| External CLI migration | Pipeline menjalankan Flyway/Liquibase sebelum deploy app | Controlled release | Butuh pipeline discipline |
| Kubernetes Job/init job | Job khusus menjalankan migration | Cloud-native deployment | Ordering dan retry harus jelas |
| DBA-run reviewed script | DBA menjalankan SQL hasil review | Highly regulated org | Manual drift jika tidak tercatat tool |
| Hybrid | Tool generate SQL, DBA approve/run, history tetap dikelola | Enterprise regulated | Process lebih kompleks |

Tidak ada satu jawaban universal. Yang penting adalah sadar trade-off.

---

## 0.7 Vocabulary Dasar Yang Harus Jelas

Sebelum masuk ke Part berikutnya, kita harus membedakan beberapa istilah yang sering dicampur.

### 0.7.1 Schema Migration

Perubahan struktur database.

Contoh:

```sql
CREATE TABLE enforcement_case (
    id BIGINT PRIMARY KEY,
    case_no VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL
);
```

Atau:

```sql
ALTER TABLE enforcement_case ADD priority VARCHAR(20);
```

Schema migration mencakup:

- table,
- column,
- index,
- constraint,
- sequence,
- view,
- procedure,
- function,
- trigger,
- schema/database object.

### 0.7.2 Data Migration

Perubahan terhadap data existing agar cocok dengan model baru.

Contoh:

```sql
UPDATE enforcement_case
SET priority = 'NORMAL'
WHERE priority IS NULL;
```

Data migration sering lebih berbahaya dari schema migration karena menyentuh data hidup.

### 0.7.3 Backfill

Jenis data migration yang mengisi data baru berdasarkan data lama.

Contoh:

```sql
UPDATE application
SET submitted_year = EXTRACT(YEAR FROM submitted_at)
WHERE submitted_year IS NULL;
```

Backfill bisa kecil atau masif. Untuk jutaan/barisan ratusan juta row, backfill harus diperlakukan sebagai workload batch dengan chunking, throttling, checkpoint, dan observability.

### 0.7.4 Seeding

Seeding adalah pengisian data awal atau data referensi.

Contoh:

```sql
INSERT INTO case_status(code, name, sort_order)
VALUES ('DRAFT', 'Draft', 10);
```

Tetapi dalam production, seeding harus jelas jenisnya:

- reference data,
- master data,
- configuration data,
- role/permission data,
- feature flag data,
- tenant bootstrap data,
- test fixture,
- demo data.

Tidak semua seed aman untuk semua environment.

### 0.7.5 Fixture

Fixture adalah data untuk testing.

Contoh:

- test user,
- fake application,
- fake case,
- dummy document,
- generated address.

Fixture tidak boleh bocor ke production.

### 0.7.6 Reference Data

Data yang relatif stabil dan menjadi bagian dari domain.

Contoh:

- country,
- currency,
- status,
- gender code,
- document type,
- application type,
- permission code.

Reference data sering lebih mirip code daripada transactional data. Karena itu bisa dikelola via migration, tetapi tetap harus berhati-hati jika production memungkinkan admin mengubahnya.

### 0.7.7 Configuration Data

Data yang mengontrol behavior sistem.

Contoh:

- SLA threshold,
- email template setting,
- feature flag,
- workflow routing rule,
- assignment rule.

Configuration data bisa berbeda antar environment. Karena itu seeding-nya perlu strategi overlay dan governance.

### 0.7.8 Migration History

Catatan resmi migration yang pernah dijalankan.

Flyway menyimpan ini di schema history table. Liquibase menyimpan di `DATABASECHANGELOG`.

History penting untuk:

- menentukan migration berikutnya,
- validasi checksum,
- audit,
- troubleshooting,
- drift detection,
- release evidence.

### 0.7.9 Drift

Drift adalah kondisi ketika database aktual berbeda dari definisi migration/changelog yang seharusnya.

Penyebab drift:

- manual SQL di production,
- hotfix tanpa migration,
- migration file diedit setelah jalan,
- environment tertentu dilewati,
- DBA mengubah object langsung,
- script emergency tidak masuk repo,
- Hibernate `ddl-auto` mengubah schema,
- branch conflict migration.

Drift adalah musuh reproducibility.

### 0.7.10 Rollback vs Roll-forward

Rollback berarti mencoba kembali ke state sebelumnya.

Roll-forward berarti membuat perubahan baru untuk memperbaiki state saat ini.

Dalam database, roll-forward sering lebih realistis.

Contoh:

Jika migration `V10` salah membuat index, jangan edit `V10` setelah production. Buat `V11` untuk memperbaiki.

---

## 0.8 Mental Model: Database Sebagai State Machine

Sebagai engineer yang terbiasa dengan state machine, kita bisa melihat migration sebagai transisi state.

Database berada di state:

```text
S0 -> S1 -> S2 -> S3 -> ... -> Sn
```

Setiap migration adalah transition:

```text
M1: S0 -> S1
M2: S1 -> S2
M3: S2 -> S3
```

Migration tool bertugas memastikan:

1. transition dijalankan dalam urutan benar,
2. transition yang sudah dijalankan tidak berubah diam-diam,
3. transition yang gagal terdeteksi,
4. state akhir bisa diverifikasi,
5. metadata transisi tersimpan.

Tetapi production reality lebih kompleks:

```text
Application v1 expects DB contract C1
Application v2 expects DB contract C2
Migration M2 transforms DB from C1-compatible to C2-compatible
```

Untuk zero-downtime, kita sering butuh state antara:

```text
C1 only
  -> C1 + C2 compatible
  -> C2 preferred
  -> C2 only
```

Ini disebut expand/contract pattern.

Contoh rename column tanpa downtime:

```text
Step 1: Add new column assigned_officer_id while keeping officer_id
Step 2: App writes both columns
Step 3: Backfill assigned_officer_id from officer_id
Step 4: App reads assigned_officer_id, fallback to officer_id
Step 5: App reads only assigned_officer_id
Step 6: Drop officer_id after old app no longer exists
```

Jadi migration bukan hanya “rename column”. Migration adalah choreography beberapa release.

---

## 0.9 The Contract View: Database Schema Adalah API

Developer sering memperlakukan database sebagai implementation detail. Dalam microservice ideal, database memang private per service. Tetapi dalam enterprise system, database schema sering menjadi API internal.

Schema menjadi kontrak untuk:

- application code,
- ORM mappings,
- SQL mapper,
- stored procedure,
- reporting,
- data export,
- batch job,
- integration,
- support tooling.

Jika API HTTP breaking change butuh versioning, database schema breaking change juga butuh versioning.

Contoh breaking schema change:

- drop column,
- rename column,
- change type incompatible,
- make nullable column non-null,
- tighten constraint,
- change meaning of status code,
- delete seed row still referenced,
- alter view output columns,
- change stored procedure signature.

Contoh non-breaking atau additive change:

- add nullable column,
- add new table unused by old app,
- add index,
- add new optional status code if old app ignores unknown values,
- add new view not used by old app.

Tetapi “non-breaking” tergantung consumer.

Menambah status baru bisa breaking jika kode lama melakukan:

```java
switch (status) {
    case "DRAFT": ...
    case "SUBMITTED": ...
    case "APPROVED": ...
    default: throw new IllegalStateException("Unknown status");
}
```

Jadi database migration harus dipikirkan bersama application compatibility.

---

## 0.10 The Release View: Database Migration Dalam Deployment

Dalam release modern, kita punya beberapa artefak:

```text
source code
  -> build artifact / jar
  -> container image
  -> database migration scripts
  -> config
  -> infrastructure manifest
  -> deployment pipeline
```

Pertanyaan penting:

> Apakah migration adalah bagian dari aplikasi, bagian dari pipeline, atau bagian dari operasi DBA?

Jawaban bisa berbeda per organisasi. Tetapi dari sudut engineering, migration harus punya properties berikut:

1. Version-controlled.
2. Immutable setelah dijalankan di shared environment.
3. Ordered.
4. Reviewable.
5. Testable.
6. Reproducible.
7. Observable.
8. Auditable.
9. Recoverable.
10. Compatible dengan deployment strategy.

### 0.10.1 Deployment Ordering

Ada beberapa urutan umum.

#### Model A — Migrate Then Deploy

```text
1. Run DB migration
2. Deploy new app
```

Cocok jika migration additive dan old app tetap kompatibel dengan schema baru.

Risiko:

- jika migration breaking, old app bisa rusak sebelum new app deploy,
- jika migration sukses tapi deploy app gagal, database sudah berubah.

#### Model B — Deploy Then Migrate

```text
1. Deploy new app
2. Run DB migration
```

Cocok jika new app bisa berjalan dengan schema lama sampai migration selesai.

Risiko:

- app baru mungkin error karena column/table belum ada,
- perlu feature flag atau compatibility code.

#### Model C — Expand/Migrate/Deploy/Switch/Contract

```text
1. Expand schema dengan perubahan additive
2. Deploy app yang compatible dengan old+new schema
3. Backfill data
4. Switch read/write behavior
5. Deploy app yang hanya pakai schema baru
6. Contract schema lama
```

Ini model paling aman untuk perubahan besar, tetapi butuh lebih banyak release step.

### 0.10.2 Rolling Deployment Compatibility

Dalam Kubernetes rolling deployment, selama beberapa menit bisa ada:

```text
old pod + new pod + one shared database
```

Maka migration harus mendukung overlap.

Contoh tidak aman:

```sql
ALTER TABLE user_account RENAME COLUMN username TO login_name;
```

Aplikasi lama masih query `username`, aplikasi baru query `login_name`. Saat rename dilakukan, salah satu pasti rusak.

Contoh lebih aman:

```text
Release 1: add login_name nullable
Release 2: write username + login_name
Release 3: backfill login_name
Release 4: read login_name
Release 5: stop using username
Release 6: drop username
```

Engineering yang mature sering lebih lambat dalam jumlah step, tetapi lebih aman secara operasional.

---

## 0.11 The Audit View: Migration Sebagai Evidence

Dalam sistem regulated, kita tidak cukup berkata: “Database sudah berubah.”

Kita perlu menjawab:

- siapa yang mengusulkan perubahan,
- siapa yang review,
- kapan dijalankan,
- di environment mana,
- script mana yang dijalankan,
- checksum apa,
- hasilnya sukses/gagal,
- berapa lama durasinya,
- apakah ada rollback plan,
- apakah ada approval,
- apakah ada post-deployment verification,
- apakah ada emergency change,
- apakah production berbeda dari UAT,
- apakah ada manual change di luar pipeline.

Flyway schema history atau Liquibase `DATABASECHANGELOG` bukan pengganti proses audit organisasi, tetapi menjadi bukti teknis penting.

Auditability membutuhkan:

1. Migration script tersimpan di Git.
2. Pull request review.
3. CI validate.
4. Artifact immutable.
5. Execution log.
6. Migration history table.
7. Deployment record.
8. Approval record jika diperlukan.
9. Post-check result.
10. Drift detection.

Dalam sistem pemerintahan, keuangan, asuransi, healthcare, atau regulated platform, hal ini bukan nice-to-have.

---

## 0.12 The Security View: Migration User Bukan App User

Aplikasi runtime biasanya tidak seharusnya punya privilege DDL.

Contoh privilege runtime app user:

- `SELECT`,
- `INSERT`,
- `UPDATE`,
- `DELETE`,
- execute procedure tertentu.

Contoh privilege migration user:

- `CREATE TABLE`,
- `ALTER TABLE`,
- `CREATE INDEX`,
- `CREATE VIEW`,
- `CREATE SEQUENCE`,
- `DROP` tertentu,
- modify schema object.

Jika app user punya DDL privilege, bug aplikasi atau SQL injection bisa jauh lebih merusak.

Model yang lebih aman:

```text
CI/CD migration job uses migration_user
Application runtime uses app_user
Reporting uses read_only_user
Support tooling uses controlled_support_user
```

Tetapi pemisahan ini berdampak pada deployment model:

- app startup migration menjadi kurang ideal,
- migration lebih cocok dijalankan external job/pipeline,
- secrets harus dipisah,
- audit lebih jelas.

Security dan migration architecture saling terkait.

---

## 0.13 The Data View: Schema Benar Belum Tentu Data Benar

Migration sering fokus ke struktur, tetapi production failure sering terjadi karena data.

Contoh:

```sql
ALTER TABLE user_account ADD CONSTRAINT uq_user_email UNIQUE (email);
```

DDL ini benar jika email memang unik. Tetapi data existing mungkin punya duplikasi.

Sebelum migration, perlu query assessment:

```sql
SELECT email, COUNT(*)
FROM user_account
GROUP BY email
HAVING COUNT(*) > 1;
```

Jika ada duplikasi, perlu remediation:

- merge user,
- pilih canonical record,
- mark duplicate,
- update email invalid,
- business approval.

Jadi perubahan database sering terdiri dari beberapa fase:

```text
1. Assess data reality
2. Clean/normalize data
3. Add supporting structure
4. Backfill
5. Validate
6. Enforce constraint
7. Monitor
```

Dalam sistem dengan data lama, “constraint introduction” bukan sekadar `ALTER TABLE ADD CONSTRAINT`.

---

## 0.14 Fresh Database vs Existing Database

Migration harus diuji dalam dua mode berbeda.

### Fresh Database

Mulai dari database kosong lalu jalankan semua migration.

Tujuan:

- memastikan project bisa bootstrap,
- developer baru bisa setup lokal,
- test environment bisa dibuat ulang,
- migration chain tidak rusak.

### Existing Database Upgrade

Mulai dari database versi sebelumnya dengan data realistis lalu jalankan migration baru.

Tujuan:

- memastikan production upgrade aman,
- data lama kompatibel,
- constraint tidak gagal,
- backfill benar,
- performance cukup.

Banyak tim hanya menguji fresh database. Ini bahaya.

Production hampir selalu existing database upgrade, bukan fresh install.

---

## 0.15 Migration as Code, But Not Just Code

Istilah “migration as code” berguna tetapi tidak lengkap.

Migration memang harus:

- version-controlled,
- reviewed,
- tested,
- automated.

Namun migration berbeda dari code biasa karena:

- punya efek permanen pada state,
- bisa menyentuh data sensitif,
- bisa lock database,
- bisa tidak reversible,
- bisa berdampak pada semua versi app,
- bisa perlu approval eksternal,
- bisa harus comply dengan regulasi.

Jadi migration harus diperlakukan sebagai:

```text
code + operations + data governance + release management + security control
```

---

## 0.16 Anti-Pattern Awal Yang Harus Dihindari

Bagian ini penting karena banyak masalah database migration berasal dari kebiasaan kecil.

### Anti-Pattern 1 — Mengedit Migration Lama

Misalnya:

```text
V12__add_status_column.sql
```

sudah jalan di UAT dan production. Lalu developer mengubah isi file karena ingin memperbaiki typo.

Masalah:

- checksum mismatch,
- environment lama dan baru berbeda,
- history tidak lagi sesuai file,
- audit rusak,
- reproducibility hilang.

Prinsip:

> Setelah migration dijalankan di shared environment, jangan edit. Buat migration baru.

Exception ada, misalnya migration belum pernah keluar dari local branch. Tetapi begitu sudah masuk shared environment, anggap immutable.

### Anti-Pattern 2 — Manual Production Change Tanpa Migration

DBA atau developer menjalankan:

```sql
ALTER TABLE payment ADD retry_count NUMBER(10);
```

langsung di production, tetapi tidak masuk Git.

Akibat:

- production drift,
- SIT/UAT tidak sama,
- fresh database tidak bisa recreate production,
- migration berikutnya bisa gagal,
- audit tidak lengkap.

Jika emergency manual change harus dilakukan, setelah itu harus ada reconciliation migration dan record.

### Anti-Pattern 3 — Mengandalkan ORM Auto-DDL di Production

Contoh Hibernate:

```properties
spring.jpa.hibernate.ddl-auto=update
```

Untuk local prototype, ini nyaman. Untuk production, ini berbahaya.

Masalah:

- perubahan tidak selalu eksplisit,
- tidak cukup reviewable,
- tidak ideal untuk destructive change,
- tidak mengelola data migration,
- tidak memberi release choreography,
- bisa berbeda antar dialect,
- sulit diaudit.

Production-grade system sebaiknya memakai migration tool eksplisit.

### Anti-Pattern 4 — Seed Data Tidak Idempotent

Contoh:

```sql
INSERT INTO role(code, name) VALUES ('ADMIN', 'Administrator');
```

Jika dijalankan ulang, gagal duplicate key. Jika tidak ada unique key, bisa membuat duplicate row.

Seed production harus didesain idempotent atau versioned dengan jelas.

### Anti-Pattern 5 — Test Data Dicampur Dengan Production Seed

Contoh buruk:

```sql
INSERT INTO user_account(username, password) VALUES ('testadmin', 'password');
```

Jika script ini masuk production, terjadi security incident.

Pisahkan:

- production reference seed,
- dev seed,
- test fixture,
- demo dataset.

### Anti-Pattern 6 — Satu Migration Terlalu Besar

Contoh:

```text
V50__mega_release.sql
```

berisi:

- create 20 tables,
- alter 15 tables,
- insert seed,
- update 10 juta row,
- create indexes,
- drop old columns,
- create procedures.

Masalah:

- sulit review,
- sulit isolate failure,
- sulit rollback,
- sulit monitor,
- lock duration tidak jelas,
- blast radius besar.

Pecah berdasarkan logical change dan operational risk.

### Anti-Pattern 7 — Menganggap Semua Migration Harus Dalam Satu Transaction

Transaksi memang bagus, tetapi tidak semua DDL transactional di semua database.

Selain itu, data migration besar dalam satu transaction bisa:

- membuat undo/redo/WAL besar,
- menahan lock terlalu lama,
- memperlambat replication,
- gagal setelah waktu lama lalu rollback mahal.

Top engineer tahu kapan perlu transaction atomic dan kapan perlu chunked resumable migration.

### Anti-Pattern 8 — “Rollback Script Ada, Berarti Aman”

Rollback script tidak selalu mengembalikan realita.

Jika migration menghapus data, rollback DDL tidak mengembalikan data.

Jika migration mengubah data berdasarkan logic lossy, rollback tidak tahu nilai asli.

Jika app baru sudah menulis data dengan format baru, rollback schema bisa merusak data baru.

Rollback harus diuji, bukan hanya ditulis.

---

## 0.17 Migration Categories Berdasarkan Risiko

Untuk review engineering, perubahan database bisa dikategorikan.

### Low Risk

Biasanya aman, tetapi tetap perlu review:

- add nullable column tanpa default berat,
- add new table unused by old app,
- add non-unique index online/concurrent,
- add new optional seed row,
- create new view not used yet.

### Medium Risk

Perlu assessment:

- add column with default,
- add unique index,
- add foreign key,
- add check constraint,
- update reference data,
- backfill moderate data,
- modify view used by report,
- add not-null after data cleanup.

### High Risk

Butuh choreography dan runbook:

- drop column/table,
- rename column/table,
- change data type,
- rewrite large table,
- large backfill,
- change primary key,
- split/merge table,
- change status semantics,
- remove seed/reference row,
- modify heavily used procedure,
- migration requiring long lock.

### Critical Risk

Biasanya butuh special release window atau phased migration:

- alter huge table under traffic,
- migration touching financial/regulatory/audit data,
- encryption/key rotation data migration,
- tenant-wide data rewrite,
- cross-service shared schema breaking change,
- irreversible data deletion,
- migration requiring downtime,
- production drift repair.

Risk category menentukan:

- review depth,
- testing requirement,
- DBA involvement,
- rollback/roll-forward plan,
- deployment window,
- monitoring,
- approval.

---

## 0.18 Change Safety Checklist Awal

Sebelum menulis migration, tanya:

### Contract

- App versi mana yang membutuhkan perubahan ini?
- Apakah old app masih kompatibel setelah migration?
- Apakah new app kompatibel sebelum migration?
- Apakah ada batch/report/integration yang terdampak?
- Apakah ada stored procedure/view yang memakai object lama?

### Data

- Apakah data existing memenuhi asumsi baru?
- Apakah perlu pre-check query?
- Apakah perlu cleanup?
- Apakah ada data historis aneh?
- Apakah data migration lossy?
- Apakah perlu backup subset?

### Operational

- Apakah migration locking?
- Apakah bisa berjalan online?
- Berapa estimasi durasi?
- Berapa row terdampak?
- Apakah perlu chunking?
- Apakah perlu throttling?
- Apakah ada peak hour restriction?

### Tooling

- Apakah migration version sudah benar?
- Apakah script immutable?
- Apakah checksum akan stabil?
- Apakah repeatable migration tepat?
- Apakah perlu baseline?
- Apakah ada environment-specific branch?

### Security

- User mana yang menjalankan migration?
- Apakah privilege terlalu besar?
- Apakah ada secret dalam script?
- Apakah ada PII di log?
- Apakah seed data mengandung credential?

### Recovery

- Jika gagal sebelum mulai, apa action?
- Jika gagal di tengah, apa action?
- Jika migration sukses tapi app gagal, apa action?
- Jika app sukses tapi data salah, apa action?
- Apakah rollback realistis?
- Apakah roll-forward tersedia?

---

## 0.19 Java 8 Hingga Java 25: Implikasi Untuk Migration Tooling

Seri ini mencakup Java 8 sampai Java 25. Artinya kita harus sadar bahwa ekosistem tooling punya baseline berbeda.

### Java 8 Legacy Reality

Banyak enterprise system masih memakai Java 8 atau 11. Untuk proyek seperti ini:

- versi Flyway/Liquibase terbaru mungkin tidak kompatibel,
- plugin build perlu versi tertentu,
- Spring Boot versi lama punya behavior berbeda,
- JDBC driver lama bisa membatasi fitur,
- TLS/certificate/security library bisa menjadi masalah,
- migration CLI external kadang lebih mudah daripada embedded library.

### Java 17/21 Modern Baseline

Java 17 dan 21 banyak dipakai sebagai baseline modern enterprise.

Keuntungan:

- library modern lebih kompatibel,
- Spring Boot 3.x ecosystem,
- better container support,
- better observability ecosystem,
- lebih cocok dengan tool versi baru.

### Java 25 Forward-Looking

Java 25 adalah long-term support line baru dalam roadmap OpenJDK modern. Untuk seri ini, prinsip migration tetap sama. Yang berubah biasanya:

- versi plugin,
- minimum runtime tool,
- CI image,
- compatibility dependency,
- module/classpath issue,
- container base image.

Prinsip penting:

> Database migration discipline lebih stabil daripada versi Java. Tetapi implementasi library/plugin harus disesuaikan dengan baseline Java project.

Karena itu, di bagian setup nanti kita akan membahas strategi:

- embedded Flyway/Liquibase vs CLI,
- Maven/Gradle plugin,
- Spring Boot integration,
- pinned version,
- compatibility matrix,
- build image terpisah dari runtime image.

---

## 0.20 Migration Ownership

Pertanyaan penting:

> Siapa pemilik migration?

Kemungkinan:

1. Developer pemilik fitur.
2. Backend team.
3. DBA team.
4. Platform team.
5. Release engineering team.
6. Data governance team.
7. Gabungan melalui review workflow.

Dalam tim modern, developer biasanya menulis migration bersama perubahan code. Tetapi ownership tidak berhenti di developer.

Idealnya:

- developer menulis migration,
- reviewer memeriksa correctness dan compatibility,
- DBA/platform memeriksa risk untuk perubahan besar,
- CI menjalankan validation,
- pipeline menjalankan migration,
- operations memonitor,
- audit menyimpan evidence.

Jika hanya DBA yang menulis semua migration, developer bisa kehilangan ownership terhadap contract aplikasi. Jika hanya developer yang menulis tanpa DBA/process, operational risk bisa tinggi.

Model terbaik tergantung organisasi, tetapi prinsipnya:

> Migration harus dimiliki oleh orang yang memahami domain change dan direview oleh orang yang memahami database risk.

---

## 0.21 Folder dan Artifact Thinking

Dalam proyek Java, migration sering berada di:

```text
src/main/resources/db/migration
```

untuk Flyway, atau:

```text
src/main/resources/db/changelog
```

untuk Liquibase.

Tetapi struktur folder bukan sekadar preferensi. Ia mencerminkan ownership dan lifecycle.

Contoh struktur sederhana:

```text
src/main/resources/db/migration/
  V1__create_user_table.sql
  V2__create_role_table.sql
  V3__seed_roles.sql
```

Contoh struktur lebih besar:

```text
database/
  flyway/
    common/
    oracle/
    postgres/
  seed/
    production/
    dev/
    test/
  checks/
    pre/
    post/
  rollback/
  docs/
```

Contoh multi-module:

```text
modules/
  case-management/
    src/main/resources/db/migration/
  application-management/
    src/main/resources/db/migration/
  compliance/
    src/main/resources/db/migration/
```

Tetapi multi-module migration bisa menciptakan ordering conflict. Karena itu nanti kita akan bahas global vs per-module migration repository.

Untuk sekarang, pahami bahwa migration adalah artifact release. Artifact ini harus:

- ikut version control,
- ikut build/release,
- bisa divalidasi,
- bisa dijalankan konsisten,
- bisa dipromosikan antar environment.

---

## 0.22 Migration dan Branching

Database migration punya masalah unik dengan Git branching.

Contoh:

Branch A membuat:

```text
V10__add_case_priority.sql
```

Branch B juga membuat:

```text
V10__add_payment_retry.sql
```

Saat merge, conflict version terjadi.

Atau lebih halus:

Branch A:

```sql
ALTER TABLE application ADD status VARCHAR(30);
```

Branch B:

```sql
ALTER TABLE application ADD status_code VARCHAR(30);
```

Keduanya tidak conflict file, tetapi conflict domain.

Strategi yang umum:

- gunakan timestamp version,
- gunakan release prefix,
- rebase migration sebelum merge,
- CI detect duplicate version,
- migration review wajib,
- jangan merge migration tanpa menjalankan full chain test.

Migration branching adalah alasan mengapa naming convention bukan hal kosmetik.

---

## 0.23 Database Migration dan Environment Promotion

Environment umum:

```text
local -> dev -> SIT -> UAT -> staging -> production
```

Prinsip maturity:

> Script yang sama harus dipromosikan antar environment. Jangan membuat script berbeda untuk production kecuali memang dikendalikan melalui mekanisme yang jelas.

Masalah umum:

- local memakai H2, production Oracle/PostgreSQL,
- dev sudah diubah manual,
- UAT dilewati migration tertentu,
- production punya hotfix manual,
- seed data berbeda tanpa dokumentasi,
- migration berhasil di fresh dev tapi gagal di UAT karena data lama.

Top engineer menjaga environment promotion sebagai chain, bukan kumpulan database independen.

Pertanyaan untuk setiap environment:

- version migration terakhir apa?
- apakah checksum sama?
- apakah ada failed migration?
- apakah ada manual object berbeda?
- apakah seed data sama?
- apakah data volume representative?
- apakah DBMS version sama?
- apakah privilege sama?
- apakah timezone/collation/nls setting sama?

---

## 0.24 Why `schema.sql` and `data.sql` Are Not Enough

Dalam Spring Boot, `schema.sql` dan `data.sql` berguna untuk initialization sederhana.

Tetapi untuk sistem serius, ada keterbatasan:

- tidak punya version history sekuat migration tool,
- tidak cocok untuk long-lived production evolution,
- kurang eksplisit untuk ordering kompleks,
- tidak ideal untuk rollback/validate/checksum,
- sulit untuk multi-release upgrade,
- bisa membingungkan jika dicampur dengan Flyway/Liquibase.

Spring Boot documentation secara eksplisit menyarankan: jika memakai Flyway atau Liquibase, gunakan tool tersebut untuk create dan initialize schema; mencampur basic scripts dengan migration tool tidak direkomendasikan.

Mental model:

```text
schema.sql/data.sql = bootstrap convenience
Flyway/Liquibase = database change lifecycle management
```

Untuk top-tier engineering, kita butuh yang kedua.

---

## 0.25 Migration dan ORM: Kenapa Hibernate `ddl-auto` Tidak Cukup

Hibernate/JPA tahu entity model, tetapi tidak sepenuhnya tahu release choreography.

Entity:

```java
@Entity
class Application {
    @Id
    private Long id;

    private String status;
}
```

Hibernate bisa menebak bahwa kolom `status` perlu ada. Tetapi Hibernate tidak tahu:

- apakah existing data valid,
- apakah migration harus phased,
- apakah old app masih butuh column lama,
- apakah index harus online,
- apakah constraint harus `NOT VALID` dulu,
- apakah perlu backfill batch,
- apakah seed permission perlu ditambah,
- apakah DBA perlu approve,
- apakah rollback realistis,
- apakah perubahan perlu release note.

ORM schema generation berguna untuk prototype dan test tertentu, tetapi bukan pengganti migration discipline.

Dalam sistem production, entity model dan migration harus sinkron, tetapi migration tetap eksplisit.

---

## 0.26 Migration dan Seed Dalam Domain Enforcement/Workflow Systems

Untuk sistem case management, enforcement lifecycle, regulatory workflow, atau enterprise approval platform, migration punya risiko domain yang lebih tinggi.

Contoh object:

- case,
- application,
- appeal,
- compliance record,
- investigation,
- correspondence,
- document,
- officer assignment,
- status transition,
- SLA timer,
- workflow task,
- audit trail,
- role/permission,
- notification template,
- report view.

Perubahan kecil bisa mempengaruhi lifecycle.

Contoh seed permission:

```sql
INSERT INTO permission(code, description)
VALUES ('CASE_REOPEN', 'Allow reopening closed case');
```

Pertanyaan:

- role mana yang mendapat permission ini?
- apakah permission aktif di semua environment?
- apakah audit mencatat penggunaan permission?
- apakah old app tahu permission ini?
- apakah UI harus menyembunyikan fitur sampai release FE?
- apakah seed harus idempotent?
- apakah permission bisa dihapus jika salah?

Contoh status migration:

```text
Old: PENDING
New: PENDING_REVIEW, PENDING_APPROVAL
```

Ini bukan hanya data change. Ini mengubah state machine.

Pertanyaan:

- existing `PENDING` dipetakan ke mana?
- apakah semua transition masih valid?
- apakah SLA timer berubah?
- apakah report lama masih valid?
- apakah audit trail bisa menjelaskan perubahan?
- apakah integration partner menerima status baru?
- apakah role assignment berubah?

Dalam workflow/regulatory systems, database migration sering sama dengan domain migration.

---

## 0.27 First Principles Untuk Seri Ini

Seluruh seri akan memakai beberapa prinsip inti.

### Principle 1 — Prefer Explicit Over Implicit

Perubahan database harus eksplisit.

Lebih baik:

```text
V20260617_001__add_case_priority_column.sql
```

daripada perubahan diam-diam oleh ORM auto-update.

### Principle 2 — Prefer Additive Before Destructive

Untuk zero-downtime, tambah dulu, pakai, validasi, baru hapus.

```text
add -> backfill -> switch -> validate -> remove
```

### Principle 3 — Migration Files Are Historical Records

Migration bukan hanya instruksi teknis. Ia adalah catatan sejarah.

Jangan edit sejarah setelah sudah dipakai shared environment.

### Principle 4 — Data Reality Beats Model Assumption

Model baru bisa benar, tetapi data lama tetap harus dihormati.

Selalu cek data existing sebelum constraint/backfill besar.

### Principle 5 — Rollback Is A Feature, Not A Belief

Rollback harus didesain dan diuji. Jika tidak, jangan klaim rollback aman.

### Principle 6 — Seed Data Must Have Ownership

Seed tanpa owner akan menjadi sampah domain.

Setiap seed penting harus jelas:

- siapa pemiliknya,
- apakah boleh berubah manual,
- apakah migration boleh overwrite,
- apa natural key-nya,
- apakah environment-specific.

### Principle 7 — Test Upgrade, Not Only Fresh Install

Production adalah upgrade dari state lama. Test harus mencerminkan itu.

### Principle 8 — Database Migration Is Operational Workload

Migration bisa mengonsumsi CPU, IO, lock, storage, undo/redo/WAL, replication bandwidth.

Monitor seperti workload production.

### Principle 9 — One Source of Truth

Jangan biarkan Flyway, Liquibase, Hibernate auto-DDL, manual DBA script, `schema.sql`, dan ad-hoc shell script semuanya menjadi sumber perubahan tanpa koordinasi.

### Principle 10 — Compatibility Is More Valuable Than Cleverness

Migration yang membosankan tetapi kompatibel lebih baik daripada migration elegan yang breaking.

---

## 0.28 Simple Example: Dari Naive Migration Ke Production-Grade Thinking

Misalnya requirement:

> Tambahkan prioritas case: LOW, NORMAL, HIGH, URGENT.

### Naive Approach

```sql
ALTER TABLE enforcement_case ADD priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL';
```

Terlihat sederhana.

Potensi masalah:

- table besar bisa rewrite tergantung DBMS/version,
- `NOT NULL DEFAULT` bisa lock,
- old app tidak tahu kolom ini,
- new app mungkin butuh index,
- existing API response berubah,
- report sorting berubah,
- seed lookup belum ada,
- tidak ada validation query,
- tidak ada rollback strategy.

### Better Approach

Step 1 — Add nullable column:

```sql
ALTER TABLE enforcement_case ADD priority VARCHAR(20);
```

Step 2 — Add reference data:

```sql
INSERT INTO case_priority(code, label, sort_order)
SELECT 'LOW', 'Low', 10
WHERE NOT EXISTS (SELECT 1 FROM case_priority WHERE code = 'LOW');

INSERT INTO case_priority(code, label, sort_order)
SELECT 'NORMAL', 'Normal', 20
WHERE NOT EXISTS (SELECT 1 FROM case_priority WHERE code = 'NORMAL');

INSERT INTO case_priority(code, label, sort_order)
SELECT 'HIGH', 'High', 30
WHERE NOT EXISTS (SELECT 1 FROM case_priority WHERE code = 'HIGH');

INSERT INTO case_priority(code, label, sort_order)
SELECT 'URGENT', 'Urgent', 40
WHERE NOT EXISTS (SELECT 1 FROM case_priority WHERE code = 'URGENT');
```

Step 3 — Deploy app that writes priority for new cases and treats null as NORMAL.

Step 4 — Backfill old rows in chunks:

```sql
UPDATE enforcement_case
SET priority = 'NORMAL'
WHERE priority IS NULL
  AND id BETWEEN :start_id AND :end_id;
```

Step 5 — Validate:

```sql
SELECT COUNT(*)
FROM enforcement_case
WHERE priority IS NULL;
```

Step 6 — Add constraint after data valid:

```sql
ALTER TABLE enforcement_case MODIFY priority NOT NULL;
```

Step 7 — Add check/FK depending design.

Step 8 — Update reports/indexes if needed.

Step 9 — Remove fallback code later.

Ini lebih panjang, tetapi jauh lebih aman.

---

## 0.29 Another Example: Permission Seed

Requirement:

> Tambahkan permission baru `CASE_ESCALATE` untuk role supervisor.

Naive:

```sql
INSERT INTO permission(code, name) VALUES ('CASE_ESCALATE', 'Escalate Case');
INSERT INTO role_permission(role_id, permission_id) VALUES (1, 99);
```

Masalah:

- role id `1` mungkin berbeda antar environment,
- permission id `99` mungkin berbeda,
- insert ulang bisa duplicate,
- role supervisor mungkin namanya berbeda,
- permission mungkin sudah dibuat manual di UAT,
- tidak ada audit semantic,
- tidak jelas apakah production config boleh dioverwrite.

Lebih baik:

```sql
INSERT INTO permission(code, name)
SELECT 'CASE_ESCALATE', 'Escalate Case'
WHERE NOT EXISTS (
    SELECT 1 FROM permission WHERE code = 'CASE_ESCALATE'
);

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code = 'CASE_ESCALATE'
WHERE r.code = 'SUPERVISOR'
  AND NOT EXISTS (
      SELECT 1
      FROM role_permission rp
      WHERE rp.role_id = r.id
        AND rp.permission_id = p.id
  );
```

Mental model:

- gunakan natural key (`code`), bukan surrogate id,
- idempotent,
- environment-safe,
- tidak duplicate,
- bisa dijalankan ulang,
- lebih reviewable.

Nanti kita akan bahas pattern seed lebih detail.

---

## 0.30 Apa Yang Akan Kita Pelajari Setelah Ini

Part 0 ini membangun orientasi. Setelah ini:

- Part 1 akan membahas taxonomy database changes secara detail.
- Part 2 membahas invariants dan failure models.
- Part 3 membahas versioning model.
- Part 4–10 masuk Flyway mendalam.
- Part 11–15 masuk Liquibase mendalam.
- Part 16 membandingkan Flyway vs Liquibase.
- Part 17–23 masuk seed, backfill, zero-downtime, locking, vendor-specific, testing.
- Part 24–28 membahas integrasi Spring Boot, Jakarta EE, CI/CD, multi-service, multi-tenant.
- Part 29–33 membahas security, compliance, runbook, advanced anti-pattern, case study, capstone.

---

## 0.31 Practical Starting Standard Untuk Team

Walaupun detail teknis akan datang nanti, mulai sekarang kita bisa menetapkan standard awal.

### Standard 1 — Semua Schema Change Harus Lewat Migration

Tidak ada manual schema change tanpa reconciliation.

### Standard 2 — Migration Lama Immutable Setelah Shared Environment

Jika sudah masuk dev/SIT/UAT/prod, jangan edit. Buat migration baru.

### Standard 3 — Hindari ORM Auto-DDL Untuk Production

Gunakan migration eksplisit.

### Standard 4 — Pisahkan Production Seed dan Test Fixture

Jangan campur data test dengan seed production.

### Standard 5 — Gunakan Natural Key Untuk Seed

Jangan bergantung pada surrogate id antar environment.

### Standard 6 — Additive First

Untuk perubahan breaking, desain phased migration.

### Standard 7 — Pre-check dan Post-check Untuk Migration Berisiko

Setiap migration medium/high risk harus punya query validasi.

### Standard 8 — Migration Harus Direview Dari Sudut DB dan App Compatibility

Review bukan hanya syntax SQL.

### Standard 9 — Test Fresh dan Upgrade

Jalankan migration dari database kosong dan dari versi sebelumnya.

### Standard 10 — Dokumentasikan Recovery

Minimal tulis apa yang dilakukan jika migration gagal.

---

## 0.32 Minimal Review Template

Untuk setiap migration PR, gunakan checklist berikut.

```text
Migration Name:
Related Feature/Issue:
DBMS Target:
Environment Target:

Change Type:
[ ] Schema additive
[ ] Schema destructive
[ ] Data migration
[ ] Seed/reference data
[ ] Index/constraint
[ ] View/procedure/function
[ ] Permission/config

Compatibility:
[ ] Old app works with new schema
[ ] New app works with old schema
[ ] Rolling deployment considered
[ ] Batch/report/integration checked

Data:
[ ] Existing data assessed
[ ] Backfill needed
[ ] Backfill idempotent
[ ] Validation query included

Operational:
[ ] Locking risk assessed
[ ] Runtime duration estimated
[ ] Large table impact checked
[ ] Index creation strategy checked
[ ] Transaction size acceptable

Security:
[ ] No secrets in migration
[ ] No test users in production seed
[ ] Migration user privilege considered

Recovery:
[ ] Failure mode understood
[ ] Rollback or roll-forward plan defined
[ ] Manual intervention documented if needed

Tooling:
[ ] Version naming correct
[ ] Old migration not edited
[ ] Checksum expected stable
[ ] Tested locally
[ ] Tested in CI or integration DB
```

Template ini akan kita refine di part-part berikutnya.

---

## 0.33 Key Takeaways

1. Database migration adalah disiplin engineering, bukan folder SQL biasa.
2. Database berbeda dari code karena membawa state historis.
3. Migration harus dipikirkan sebagai state transition yang ordered, auditable, dan recoverable.
4. Schema adalah contract; breaking change harus dikelola seperti API breaking change.
5. Rollback database tidak bisa diasumsikan mudah.
6. Seeding harus deterministic, idempotent, dan punya ownership.
7. Data reality sering lebih kompleks daripada domain model baru.
8. Zero-downtime migration membutuhkan expand/contract thinking.
9. Tool seperti Flyway dan Liquibase membantu, tetapi tidak menggantikan mental model.
10. Top-tier engineer tidak hanya bertanya “SQL-nya jalan?”, tetapi “apakah perubahan ini aman untuk lifecycle production?”

---

## 0.34 Referensi Resmi dan Bacaan Lanjutan

Referensi ini dipakai sebagai pijakan konseptual awal. Detailnya akan dibahas lebih dalam pada part teknis Flyway/Liquibase/Spring Boot.

- Flyway documentation — Schema history table: https://documentation.red-gate.com/fd/flyway-schema-history-table-273973417.html
- Redgate Flyway Community overview: https://www.red-gate.com/products/flyway/community/
- Redgate article — Flyway baseline migrations: https://www.red-gate.com/hub/product-learning/flyway/flyways-baseline-migrations-explained-simply/
- Liquibase documentation — What is a changeset: https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-a-changeset
- Liquibase documentation — Attributes, contexts, labels: https://docs.liquibase.com/oss/user-guide-4-33/what-are-attributes
- Liquibase blog — Changeset checksums: https://www.liquibase.com/blog/what-affects-changeset-checksums
- Spring Boot documentation — Database initialization: https://docs.spring.io/spring-boot/how-to/data-initialization.html
- OpenJDK JDK 25 project page: https://openjdk.org/projects/jdk/25/

---

## 0.35 Status Seri

Seri **belum selesai**. Ini adalah **Part 0 dari 34**.

Part berikutnya:

```text
01-taxonomy-of-database-changes.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 34 — Capstone: Designing a Production-Grade Persistence Layer for Complex Case Management](../jpa/34-capstone-production-grade-persistence-layer-complex-case-management.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 1 — Taxonomy of Database Changes](./01-taxonomy-of-database-changes.md)

</div>
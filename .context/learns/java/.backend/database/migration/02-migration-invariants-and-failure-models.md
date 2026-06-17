# 02 — Migration Invariants and Failure Models

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Part: 2 dari 34  
> Topik: Invariants, failure model, recovery model, dan cara berpikir production-grade sebelum menulis database migration  
> Target: Java 8 sampai Java 25, dengan konteks Flyway, Liquibase, Spring Boot, Jakarta EE, plain Java, CI/CD, dan production operations

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas taksonomi perubahan database: DDL, DML, seed, backfill, repeatable object, hotfix, bootstrap, dan operational migration.

Bagian ini naik satu level lebih dalam: **apa yang harus selalu benar sebelum, selama, dan sesudah migration berjalan?**

Di level pemula, database migration sering dipahami seperti ini:

> “Ada file SQL. Jalankan berurutan. Selesai.”

Di level engineer production-grade, cara berpikirnya berbeda:

> “Migration adalah state transition terhadap shared durable state. Setiap transition harus punya invariant, precondition, postcondition, failure model, dan recovery model.”

Database bukan file konfigurasi biasa. Database adalah state yang hidup, dipakai aplikasi, dipakai user, dipakai report, dipakai job, dipakai integrasi, dan sering kali menjadi sumber kebenaran bisnis. Karena itu migration yang salah bukan hanya membuat build gagal, tetapi bisa:

- merusak data historis,
- memblokir transaksi production,
- membuat aplikasi versi lama dan baru tidak kompatibel,
- menciptakan drift antar environment,
- membuat rollback aplikasi tidak mungkin,
- merusak audit trail,
- membuat seed data berbeda antar tenant,
- menimbulkan incident yang baru terlihat beberapa hari kemudian.

Tujuan bagian ini adalah membangun **mental model kegagalan**. Setelah memahami bagian ini, kamu harus bisa melihat migration script dan langsung bertanya:

1. Apa invariant yang dijaga script ini?
2. Apa precondition-nya?
3. Apa postcondition-nya?
4. Apa yang terjadi jika script berhenti di tengah?
5. Apa yang terjadi jika dijalankan dua kali?
6. Apa yang terjadi jika aplikasi versi lama masih berjalan?
7. Apa yang terjadi jika migration sukses tetapi deployment aplikasi gagal?
8. Apa yang terjadi jika migration gagal tetapi sebagian perubahan sudah committed?
9. Bagaimana cara membuktikan database berada di state yang benar?
10. Jika terjadi incident, apakah kita rollback, roll-forward, retry, repair, restore, atau quarantine?

Bagian ini sengaja belum membahas command Flyway/Liquibase secara detail. Kita sedang membangun fondasi yang akan membuat penggunaan Flyway/Liquibase nanti lebih matang.

---

## 1. Core Mental Model: Database Migration sebagai State Transition

Database migration harus dilihat sebagai perubahan state.

Secara sederhana:

```text
Database State S0
    + Migration M1
    = Database State S1
```

Contoh:

```text
S0:
- table customer punya kolom id, name, email
- aplikasi membaca customer.name

M1:
- tambah kolom normalized_name
- backfill normalized_name dari name

S1:
- table customer punya kolom id, name, email, normalized_name
- normalized_name terisi untuk existing rows
```

Namun dalam production, modelnya tidak sesederhana itu. Ada aplikasi, traffic, deployment, job, integrasi, dan kemungkinan failure.

Model yang lebih realistis:

```text
Application Version A1  ───────┐
                               │ reads/writes
Database State S0 ── M1 ──> S1 │
                               │ reads/writes
Application Version A2  ───────┘

Other actors:
- background jobs
- reports
- batch processing
- admin tools
- external integrations
- manual DBA scripts
- analytics/ETL
- CDC consumers
```

Migration bukan hanya mengubah struktur database, tetapi mengubah kontrak antara database dan seluruh actor yang mengaksesnya.

Maka invariant utamanya:

> Setiap database state yang dapat diamati oleh actor harus tetap memenuhi kontrak minimal yang diperlukan actor tersebut.

Kalau masih ada aplikasi versi lama yang membaca kolom `name`, kamu tidak bisa langsung drop `name`. Kalau ada batch job yang memakai status `PENDING`, kamu tidak bisa langsung mengganti status menjadi `WAITING_FOR_REVIEW` tanpa compatibility layer. Kalau ada report yang membaca view lama, kamu tidak bisa mengganti view secara breaking tanpa koordinasi.

---

## 2. Apa Itu Invariant?

Invariant adalah kondisi yang harus tetap benar.

Dalam database migration, invariant bisa berada di beberapa level:

1. **Schema invariant**: struktur database harus sesuai kontrak.
2. **Data invariant**: data harus valid dan konsisten.
3. **History invariant**: migration yang sudah dijalankan harus tercatat dan tidak berubah diam-diam.
4. **Ordering invariant**: migration harus berjalan dalam urutan yang benar.
5. **Compatibility invariant**: aplikasi lama/baru harus tetap bisa berjalan selama transition.
6. **Operational invariant**: migration tidak boleh menyebabkan downtime/blocking yang melebihi toleransi.
7. **Security invariant**: migration tidak boleh membuka privilege/data exposure yang tidak semestinya.
8. **Audit invariant**: perubahan harus bisa dijelaskan, dilacak, dan dibuktikan.

Invariant bukan dokumentasi formal yang harus selalu ditulis panjang, tetapi engineer yang matang selalu memikirkannya.

Contoh invariant sederhana:

```text
Invariant:
Every row in application_request must have a non-null status.
```

Contoh invariant yang lebih production-grade:

```text
Invariant:
During deployment from app v1 to app v2, both app versions must be able to read and write application_request.status without semantic mismatch.
```

Contoh invariant untuk migration history:

```text
Invariant:
A migration version that has been applied in any shared environment must never be modified in-place.
```

Contoh invariant untuk seed:

```text
Invariant:
Role code values must be stable across all environments because authorization mapping depends on role code, not generated numeric id.
```

Contoh invariant untuk online migration:

```text
Invariant:
No migration step may hold an exclusive lock on a high-traffic table for longer than the agreed deployment lock budget.
```

---

## 3. Precondition, Postcondition, and Transition

Setiap migration idealnya bisa dipahami dengan tiga pertanyaan:

```text
Precondition:
What must be true before this migration runs?

Transition:
What does this migration change?

Postcondition:
What must be true after this migration succeeds?
```

Contoh migration:

```sql
ALTER TABLE user_account ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
```

Precondition:

```text
- table user_account exists
- column email_verified does not exist
- adding nullable/default column is safe for target DB engine
```

Transition:

```text
- add email_verified column
- default new rows to false
```

Postcondition:

```text
- user_account.email_verified exists
- existing rows have false or DB-defined default behavior, depending engine
- new app can read email_verified
```

Namun kalau database engine tertentu tidak mengisi default untuk existing rows seperti yang kamu kira, postcondition bisa salah. Kalau table besar dan engine melakukan table rewrite, migration bisa mengunci table terlalu lama. Jadi precondition dan postcondition harus realistis terhadap database vendor.

Contoh data migration:

```sql
UPDATE user_account
SET email_verified = TRUE
WHERE verified_at IS NOT NULL;
```

Precondition:

```text
- column email_verified exists
- column verified_at exists
- verified_at semantics benar-benar berarti email verified
```

Transition:

```text
- derive email_verified from verified_at
```

Postcondition:

```text
- all users with verified_at not null have email_verified true
- users with verified_at null remain false
```

Hidden assumption:

```text
verified_at always means email verification, not admin verification, phone verification, or imported legacy verification.
```

Banyak data migration gagal bukan karena SQL syntax salah, tetapi karena precondition bisnis salah.

---

## 4. Migration Invariant #1: Schema Version Must Match Application Contract

Aplikasi Java tidak berinteraksi dengan database secara abstrak penuh. Pada akhirnya, kode punya ekspektasi terhadap schema.

Contoh ekspektasi aplikasi:

```java
public record CustomerDto(
    Long id,
    String name,
    String email,
    String normalizedName
) {}
```

Repository mungkin menjalankan query:

```sql
SELECT id, name, email, normalized_name
FROM customer
WHERE normalized_name = ?
```

Maka aplikasi versi ini membutuhkan `customer.normalized_name`.

Invariant-nya:

```text
Application version A2 must not run against database state S0 if S0 does not contain customer.normalized_name.
```

Sebaliknya:

```text
Application version A1 must not break when database state S1 contains additional compatible columns.
```

Karena itu safe migration biasanya bergerak seperti ini:

```text
Step 1: Expand schema in backward-compatible way
        old app still works
        new app can work

Step 2: Deploy new app
        old/new overlap is safe

Step 3: Backfill/switch reads/writes
        data contract stabilizes

Step 4: Contract old schema only after old app no longer depends on it
```

Ini adalah dasar expand/contract pattern yang akan dibahas detail di Part 20.

Anti-pattern:

```text
Deployment same time:
- drop old column
- deploy code that no longer uses it
```

Kenapa berbahaya?

Karena deployment jarang atomic di distributed system. Dalam rolling deployment Kubernetes, beberapa pod lama bisa masih berjalan saat schema sudah berubah. Jika old pod masih membaca kolom yang sudah di-drop, request gagal.

Lebih aman:

```text
Release N:
- add new column
- app writes old + new if needed

Release N+1:
- app reads new column
- old column still exists

Release N+2:
- remove old column after proving no dependency remains
```

---

## 5. Migration Invariant #2: Migration Must Be Ordered

Database migration hampir selalu order-sensitive.

Contoh:

```text
V1: create table role
V2: create table user_role referencing role
V3: seed roles
V4: seed admin user role mapping
```

Jika V4 berjalan sebelum V3, gagal. Jika V2 berjalan sebelum V1, gagal. Jika V3 berjalan dua kali tanpa idempotency, bisa duplicate.

Invariant:

```text
A migration can only run when all its dependencies have already been applied.
```

Flyway menegakkan ordering dengan versioned migration dan schema history table. Liquibase menegakkan execution dengan changelog/changeset identity dan `DATABASECHANGELOG`.

Namun tool hanya menegakkan urutan mekanis. Tool tidak tahu dependency semantik kecuali kita menuliskannya secara benar.

Contoh migration yang secara version order benar tetapi semantic order salah:

```text
V10__add_user_status_column.sql
V11__drop_legacy_status_column.sql
V12__backfill_user_status.sql
```

Secara teknis V10 → V11 → V12 valid, tetapi secara semantik salah karena backfill harus dilakukan sebelum drop legacy column.

Urutan yang benar:

```text
V10__add_user_status_column.sql
V11__backfill_user_status_from_legacy_status.sql
V12__add_user_status_constraints.sql
V13__drop_legacy_status_column_after_app_cutover.sql
```

Lesson:

> Version order bukan pengganti reasoning. Naming dan review harus membuat dependency terlihat.

---

## 6. Migration Invariant #3: Migration History Must Be Tamper-Evident

Salah satu aturan paling penting:

> Migration yang sudah dijalankan di shared environment tidak boleh diedit diam-diam.

Kenapa?

Karena migration history adalah narasi resmi perubahan database.

Misal di branch lokal ada file:

```text
V12__add_customer_status.sql
```

Isi awal:

```sql
ALTER TABLE customer ADD status VARCHAR(30);
```

File ini sudah dijalankan di DEV/UAT. Lalu seseorang mengedit file yang sama menjadi:

```sql
ALTER TABLE customer ADD status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE';
```

Sekarang ada dua realitas:

```text
DEV database:
- sudah menjalankan V12 versi lama
- kolom status VARCHAR(30), nullable

Git repository:
- V12 sekarang terlihat seperti VARCHAR(50), NOT NULL, default ACTIVE
```

Ini adalah drift antara history dan artifact.

Tool seperti Flyway/Liquibase memakai checksum untuk mendeteksi perubahan ini. Namun checksum error bukan gangguan; checksum error adalah alarm bahwa sejarah sudah tidak konsisten.

Invariant:

```text
Applied migration artifact must remain immutable.
```

Kalau ada kesalahan di migration yang sudah applied, jangan edit file lama. Buat migration baru:

```text
V13__alter_customer_status_to_varchar_50_and_backfill.sql
```

Aturan praktis:

```text
Before applied to shared env:
- boleh squash/edit/reorder sesuai workflow team

After applied to shared env:
- treat as immutable
- correction must be new migration
```

Shared environment minimal biasanya DEV bersama, SIT, UAT, staging, production. Untuk local database pribadi, aturannya bisa lebih fleksibel.

---

## 7. Migration Invariant #4: Seeds Must Be Deterministic

Seed data sering terlihat sederhana:

```sql
INSERT INTO role (name) VALUES ('ADMIN');
INSERT INTO role (name) VALUES ('USER');
```

Tapi ini tidak deterministik jika aplikasi bergantung pada numeric ID.

Misal di DEV:

```text
ADMIN id = 1
USER  id = 2
```

Di UAT, karena ada data manual sebelumnya:

```text
ADMIN id = 7
USER  id = 8
```

Jika kode atau config memakai `role_id = 1`, maka environment berbeda perilakunya.

Invariant seed:

```text
Business identity must not depend on environment-specific generated surrogate id.
```

Lebih aman:

```sql
INSERT INTO role (code, name)
VALUES ('ADMIN', 'Administrator');

INSERT INTO role (code, name)
VALUES ('USER', 'User');
```

Aplikasi memakai `code`, bukan numeric id:

```java
if (user.hasRoleCode("ADMIN")) {
    // ...
}
```

Seed deterministic berarti:

- identitas stabil,
- hasil sama antar environment,
- aman dijalankan ulang jika idempotent,
- tidak bergantung pada urutan auto-increment,
- tidak memakai random value untuk business key,
- tidak membuat timestamp berbeda kecuali memang audit metadata,
- tidak memasukkan secret berbeda tanpa mekanisme secret management.

Contoh seed tidak deterministic:

```sql
INSERT INTO app_config (key, value, created_at)
VALUES ('max_login_attempt', '5', CURRENT_TIMESTAMP);
```

Kalau `created_at` hanya metadata, mungkin acceptable. Tapi kalau checksum data atau audit membandingkan antar environment, timestamp ini membuat drift.

Contoh lebih deterministic:

```sql
INSERT INTO app_config (config_key, config_value, created_by, created_at)
VALUES ('MAX_LOGIN_ATTEMPT', '5', 'migration:V21', TIMESTAMP '2026-01-01 00:00:00');
```

Namun hardcoded timestamp juga harus dipakai hati-hati. Untuk banyak sistem, lebih baik audit metadata dikelola database default, sementara business identity tetap deterministic.

---

## 8. Migration Invariant #5: Migrations Should Be Forward-Recoverable

Banyak organisasi berbicara tentang rollback. Namun untuk database, rollback sering lebih sulit daripada roll-forward.

Contoh migration:

```sql
ALTER TABLE customer DROP COLUMN legacy_code;
```

Kalau setelah deploy ada bug dan kamu rollback aplikasi, aplikasi lama mungkin butuh `legacy_code`. Tapi kolom sudah hilang. Bahkan jika kolom dibuat ulang, datanya hilang.

Rollback tidak selalu mungkin.

Maka invariant yang lebih realistis:

```text
Production database migration should be designed to be forward-recoverable.
```

Forward-recoverable berarti jika ada masalah, kita bisa membuat migration korektif berikutnya untuk membawa database ke state aman tanpa restore total.

Contoh:

```text
Bad:
- drop column immediately
- data lost
- rollback app impossible

Better:
- stop writing legacy column
- observe
- keep column for one or more releases
- drop only after confirmed unused
```

Forward recovery strategy:

```text
1. Additive changes first.
2. Avoid destructive changes during same release as code switch.
3. Keep compatibility buffer.
4. Make data migration resumable.
5. Keep old data until no rollback path needs it.
6. Prefer correction migration over manual DB edits.
```

Flyway has undo migrations in paid/advanced workflows, and Liquibase supports rollback definitions, but tool support does not remove logical risk. A reverse script can recreate schema, but it cannot magically restore business semantics after destructive mutation.

---

## 9. Migration Invariant #6: Database Drift Must Be Detectable

Database drift adalah kondisi ketika database actual tidak sama dengan expected state dari migration repository.

Penyebab drift:

- DBA menjalankan hotfix manual.
- Developer mengubah DEV database manual.
- Script emergency dijalankan di production tetapi tidak dimasukkan ke repo.
- Migration gagal sebagian lalu diperbaiki manual.
- Seed diubah via admin UI tetapi dianggap static.
- Environment lama tidak pernah di-reset.
- Branch migration conflict diselesaikan manual hanya di DB.

Invariant:

```text
Differences between expected schema and actual schema must be detectable before they cause release failure.
```

Drift berbahaya karena membuat pipeline menipu.

Contoh:

```text
DEV migration sukses karena kolom sudah dibuat manual.
UAT migration gagal karena kolom belum ada.
Production migration gagal saat deployment window.
```

Atau:

```text
Production punya index manual.
Query cepat di production.
UAT tidak punya index.
Performance test tidak representatif.
```

Cara mendeteksi drift:

- migration validation,
- checksum validation,
- schema diff,
- expected object inventory,
- DB metadata query,
- baseline comparison,
- migration dry-run terhadap clone database,
- prohibiting manual changes except emergency process,
- every manual production change must be converted into versioned migration afterward.

Prinsip:

> Manual DB changes may be necessary in emergency, but they must not remain undocumented reality.

---

## 10. Migration Invariant #7: A Failed Migration Must Leave a Known State

Migration bisa gagal.

Pertanyaannya bukan “bagaimana agar tidak pernah gagal”, tetapi:

> Jika gagal, apakah kita tahu database berada di state apa?

Beberapa database mendukung transactional DDL secara luas, beberapa tidak. Bahkan dalam database yang mendukung transaksi, beberapa operasi DDL besar atau vendor-specific bisa auto-commit.

Contoh skenario:

```sql
ALTER TABLE invoice ADD COLUMN tax_amount DECIMAL(19,2);
UPDATE invoice SET tax_amount = amount * 0.11 WHERE country = 'ID';
ALTER TABLE invoice MODIFY tax_amount NOT NULL;
```

Kemungkinan failure:

```text
Case A:
- add column committed
- update gagal halfway/rolled back
- not null belum berjalan

Case B:
- add column committed
- update sebagian committed karena script chunk manual
- not null gagal karena masih ada null

Case C:
- semua dalam transaction dan rollback total
```

Recovery berbeda untuk setiap case.

Invariant:

```text
Migration design must make failure state diagnosable and recoverable.
```

Cara membuatnya recoverable:

- pecah migration menjadi tahap jelas,
- gunakan precondition/check query,
- hindari operasi irreversible terlalu awal,
- tulis migration idempotent untuk data backfill,
- gunakan checkpoint untuk long-running data migration,
- simpan progress jika proses bisa berhenti,
- tambahkan validation query setelah backfill,
- jangan menggabungkan terlalu banyak unrelated changes dalam satu file,
- pastikan logs cukup untuk tahu step terakhir.

---

## 11. Migration Invariant #8: Migration Must Not Depend on Uncontrolled Runtime State

Migration yang baik harus deterministik terhadap database state dan artifact yang dikontrol.

Anti-pattern:

```java
public class V42__seed_admin_password extends BaseJavaMigration {
    public void migrate(Context context) {
        String password = System.getenv("TEMP_ADMIN_PASSWORD");
        // insert password hash
    }
}
```

Masalah:

- env var bisa kosong,
- nilainya berbeda antar environment,
- secret bisa masuk log,
- migration history tidak menjelaskan hasil data,
- rerun tidak deterministic,
- audit sulit.

Bukan berarti migration tidak boleh membaca configuration sama sekali. Tetapi dependency harus jelas, terkendali, dan aman.

Contoh dependency yang lebih acceptable:

```text
- placeholder schema name for target schema
- database role name per environment
- tablespace name for Oracle
- context/label for Liquibase environment targeting
```

Contoh dependency yang berbahaya:

```text
- current time for business-effective date without reason
- random UUID as stable business key
- current application user
- external HTTP API response
- file from local developer machine
- secret plain text
- production-only manual pre-step not encoded anywhere
```

Invariant:

```text
Given the same migration artifact and equivalent starting database state, the resulting business state should be equivalent.
```

---

## 12. Migration Invariant #9: Application Startup Must Not Hide Migration Risk

Banyak Java/Spring Boot aplikasi menjalankan Flyway/Liquibase saat startup. Ini nyaman, tetapi tidak selalu aman untuk production.

Model startup migration:

```text
Pod starts
  -> application initializes datasource
  -> Flyway/Liquibase migrates database
  -> application context starts
  -> app receives traffic
```

Keuntungan:

- local development mudah,
- app selalu memastikan DB up-to-date,
- tidak perlu pipeline step terpisah,
- cocok untuk small services.

Risiko:

- beberapa pod start bersamaan dan berebut migration lock,
- migration lambat membuat readiness terlambat,
- migration gagal membuat app gagal start,
- rolling deployment bisa menjalankan DB change saat old pods masih serve traffic,
- migration heavy berjalan di app container yang resource-nya bukan untuk batch/DDL,
- production operator sulit memisahkan “deploy app” dan “deploy DB”.

Invariant:

```text
The migration execution model must match operational risk.
```

Untuk sistem kecil, startup migration mungkin cukup.

Untuk sistem besar/regulated/high-traffic, sering lebih baik:

```text
CI/CD pipeline:
1. build app artifact
2. validate migration
3. run migration as controlled job
4. verify database state
5. deploy application
6. post-deploy verification
```

Di Kubernetes:

```text
Option A: migration in app startup
- simple
- risky for heavy production migrations

Option B: migration as init container
- app pod waits for migration
- still tied to pod lifecycle

Option C: migration as separate Kubernetes Job
- clearer operational boundary
- easier approval and logs
- easier retry/rollback decision

Option D: migration outside cluster via CI runner/bastion
- controlled access
- more governance
- more operational setup
```

Tidak ada satu jawaban untuk semua. Yang penting migration execution model sadar terhadap failure model.

---

## 13. Migration Invariant #10: Old and New Application Versions May Coexist

Dalam deployment modern, terutama Kubernetes, deployment jarang instant.

Rolling update:

```text
Time T0: all pods run v1
Time T1: pod-1 runs v2, pod-2/pod-3 still v1
Time T2: pod-1/pod-2 run v2, pod-3 still v1
Time T3: all pods run v2
```

Jika migration dilakukan sebelum rolling update:

```text
DB S1 already active while some app v1 pods still run.
```

Jika migration dilakukan saat app startup:

```text
First v2 pod may migrate DB while v1 pods still receive traffic.
```

Invariant:

```text
Any database state visible during deployment must be compatible with all application versions that can still run.
```

Compatibility matrix:

```text
                 DB S0       DB S1       DB S2
App v1           OK          OK?         FAIL?
App v2           FAIL?       OK          OK
```

Goal safe deployment:

```text
                 DB S0       DB S1       DB S2
App v1           OK          OK          not used
App v2           maybe       OK          OK
```

Contoh unsafe:

```text
DB S1 drops column old_name.
App v1 still selects old_name.
Result: runtime failure during rolling deployment.
```

Contoh safe:

```text
DB S1 adds column new_name but keeps old_name.
App v1 still works.
App v2 can write both.
```

Ini berlaku bukan hanya untuk pods, tetapi juga:

- async workers,
- scheduled jobs,
- batch processors,
- admin apps,
- reporting tools,
- integration consumers,
- old mobile clients jika database indirectly exposed via APIs.

---

## 14. Failure Model: Kategori Kegagalan Database Migration

Mari kita klasifikasikan failure mode secara sistematis.

### 14.1 Syntax Failure

Contoh:

```sql
ALTER TABLE customer ADD COLUMN status VARCHAR(30 NOT NULL;
```

Penyebab:

- typo,
- syntax tidak cocok database vendor,
- reserved keyword,
- delimiter salah,
- function tidak tersedia.

Biasanya terdeteksi cepat di CI jika migration diuji terhadap database real.

Recovery:

```text
- fix sebelum masuk shared env
- jika sudah applied sebagian, buat corrective migration atau repair sesuai tool
```

### 14.2 Object Existence Failure

Contoh:

```text
column already exists
index already exists
constraint name already used
table does not exist
```

Penyebab:

- drift,
- branch conflict,
- manual hotfix,
- migration order salah,
- environment tidak baseline benar.

Recovery:

```text
- inspect actual schema
- compare migration history
- decide: repair history, create corrective migration, or align environment
```

### 14.3 Data Constraint Failure

Contoh:

```sql
ALTER TABLE customer ADD CONSTRAINT uq_customer_email UNIQUE (email);
```

Gagal karena ada duplicate email.

Penyebab:

- data actual tidak memenuhi asumsi,
- production lebih kotor daripada DEV/UAT,
- legacy import,
- missing validation di aplikasi lama.

Recovery:

```text
- identify offending rows
- decide correction rule
- run data cleanup migration
- add constraint after validation
```

Prinsip:

> Constraint migration should often be preceded by data profiling and cleanup.

### 14.4 Lock Timeout / Blocking Failure

Contoh:

```text
ALTER TABLE huge_order ADD COLUMN x ...
CREATE INDEX ...
UPDATE millions of rows ...
```

Gagal karena:

- table sedang dipakai transaksi,
- DDL butuh exclusive lock,
- long-running query menahan metadata lock,
- migration menunggu lock lalu timeout,
- migration justru memblokir traffic.

Recovery:

```text
- stop/retry only if safe
- inspect blocking sessions
- use online DDL/concurrent index where available
- split migration
- run during window
- add lock timeout
```

### 14.5 Partial Commit Failure

Migration berhenti setelah sebagian perubahan committed.

Contoh:

```text
Step 1 committed: column added
Step 2 failed: backfill
Step 3 not executed: constraint
```

Recovery:

```text
- determine last committed state
- rerun if idempotent
- manually mark/repair only if schema truly matches expected state
- create corrective migration if needed
```

### 14.6 Checksum Failure

Tool mendeteksi migration yang sudah applied berubah.

Penyebab:

- file lama diedit,
- line ending berubah,
- formatting berubah,
- merge conflict diselesaikan salah,
- generated SQL regenerated.

Recovery:

```text
- do not blindly repair
- inspect diff
- if change accidental, revert file
- if actual DB needs change, create new migration
- use repair only after proving history consistency
```

### 14.7 Concurrent Migration Failure

Dua process mencoba migrate database yang sama.

Penyebab:

- multiple app instances start bersamaan,
- CI job parallel,
- manual operator menjalankan CLI saat deployment,
- multiple services share schema.

Tool biasanya memakai lock. Namun lock contention tetap bisa menjadi operational issue.

Recovery:

```text
- ensure only one migration runner per schema
- separate migration job from app startup for production
- define ownership
```

### 14.8 Application Compatibility Failure

Migration sukses, tetapi aplikasi gagal.

Contoh:

```text
DB migration renames column.
App query masih menggunakan old column.
```

Atau:

```text
DB migration changes enum/status values.
App switch-case tidak mengenali value baru.
```

Recovery:

```text
- rollback app may not help if DB is no longer compatible
- roll-forward app fix often required
- compatibility layer may be needed
```

### 14.9 Semantic Data Failure

Migration berhasil secara teknis tetapi data salah secara bisnis.

Contoh:

```sql
UPDATE application
SET status = 'APPROVED'
WHERE approved_date IS NOT NULL;
```

Ternyata `approved_date` juga terisi untuk historical migrated rejected cases karena field itu berarti “decision date”, bukan approved date.

Recovery:

```text
- investigate data lineage
- create corrective migration
- restore from backup only if correction impossible
- involve business owner
```

Ini salah satu failure paling berbahaya karena tidak selalu langsung terlihat.

### 14.10 Performance Regression Failure

Migration sukses, aplikasi jalan, tetapi query lambat.

Penyebab:

- index hilang,
- cardinality berubah,
- query plan berubah,
- constraint/statistics berubah,
- column type berubah,
- data distribution berubah,
- backfill membuat table/index bloat.

Recovery:

```text
- analyze query plan
- update statistics
- create/rebuild index
- rewrite query
- revert read path if possible
```

### 14.11 Replication / CDC Failure

Migration memengaruhi replication atau downstream consumers.

Penyebab:

- DDL tidak supported oleh CDC tool,
- table rename tidak dipahami consumer,
- column drop memutus pipeline,
- large update menghasilkan replication lag,
- trigger/backfill membanjiri downstream.

Recovery:

```text
- coordinate schema change with CDC consumers
- throttle backfill
- use expand/contract
- monitor replication lag
```

### 14.12 Environment Drift Failure

Migration sukses di DEV, gagal di UAT/PROD.

Penyebab:

- data berbeda,
- schema manual berbeda,
- extension/package berbeda,
- permission berbeda,
- DB version berbeda,
- collation/timezone berbeda.

Recovery:

```text
- compare environment metadata
- improve preflight validation
- reduce reliance on H2/in-memory tests
- test against production-like clone where possible
```

---

## 15. Recovery Model: Retry, Repair, Restore, Roll-Forward, Rollback, Quarantine

Ketika migration gagal, jangan langsung panik dan menjalankan command yang terdengar benar. Pilih recovery model yang sesuai.

### 15.1 Retry

Retry cocok jika failure bersifat transient dan migration idempotent atau belum melakukan partial commit berbahaya.

Cocok untuk:

```text
- temporary connection failure
- lock timeout sebelum perubahan terjadi
- migration job killed before execution
- transient network issue
```

Tidak cocok untuk:

```text
- partial data update tanpa checkpoint
- duplicate seed insert
- destructive DDL yang sudah committed
```

Pertanyaan sebelum retry:

```text
- Apakah migration sudah melakukan perubahan?
- Apakah tool menandai migration failed?
- Apakah script aman dijalankan ulang?
- Apakah failure root cause sudah hilang?
```

### 15.2 Repair

Repair dalam konteks Flyway/Liquibase biasanya berarti memperbaiki metadata history/checksum/failed marker, bukan memperbaiki database business state.

Repair cocok jika:

```text
- metadata history tidak sinkron tetapi actual schema sudah benar
- failed migration marker perlu dibersihkan setelah manual verified correction
- checksum mismatch sudah dipahami dan diputuskan aman
```

Repair berbahaya jika dipakai untuk menutupi masalah.

Anti-pattern:

```text
Checksum mismatch? Just repair.
```

Yang benar:

```text
Checksum mismatch?
1. inspect file diff
2. inspect database state
3. understand why mismatch happened
4. decide revert, corrective migration, or repair
```

### 15.3 Restore

Restore berarti mengembalikan database dari backup/snapshot.

Cocok untuk:

```text
- destructive data loss
- massive semantic corruption
- failed migration impossible to correct safely
- early deployment window before new writes significant
```

Risiko restore:

```text
- data baru setelah backup hilang
- downtime besar
- coordination dengan downstream systems
- sequence/replication inconsistency
- audit implications
```

Restore bukan sekadar teknis DBA. Ini keputusan bisnis/operasional.

### 15.4 Roll-Forward

Roll-forward berarti membuat migration korektif untuk membawa DB ke state benar berikutnya.

Cocok untuk:

```text
- schema change sudah applied dan bisa diperbaiki additive
- data salah bisa dikoreksi dengan deterministic rule
- rollback aplikasi tidak feasible
- production writes sudah terjadi setelah migration
```

Contoh:

```text
V42 added nullable column but forgot index.
Roll-forward with V43 add index.
```

Atau:

```text
V51 backfilled wrong status for known subset.
Roll-forward with V52 correction based on verified business rule.
```

Roll-forward sering menjadi pilihan utama production database.

### 15.5 Rollback

Rollback berarti mengembalikan database ke state sebelumnya.

Cocok jika:

```text
- change masih reversible
- tidak ada data loss
- app rollback membutuhkan old schema
- rollback path sudah diuji
```

Rollback tidak cocok jika:

```text
- column dropped and data lost
- table rewritten with lossy transform
- production writes already use new schema
- external systems already consumed new data
```

Rollback database harus dianggap fitur yang perlu didesain, bukan asumsi default.

### 15.6 Quarantine

Quarantine berarti menahan sebagian data/tenant/environment agar tidak dilanjutkan sebelum diperiksa.

Cocok untuk:

```text
- multi-tenant migration where some tenants fail
- data anomaly in subset
- backfill finds invalid rows
- one module schema drift while others okay
```

Pattern:

```text
- mark failed tenant as MIGRATION_FAILED
- stop serving risky feature for tenant
- continue safe tenants
- investigate and apply corrective migration
```

Quarantine penting dalam sistem besar karena tidak semua failure harus menghentikan seluruh dunia.

---

## 16. Designing Failure-Aware Migrations

Sekarang kita ubah prinsip menjadi teknik desain.

### 16.1 Make Migration Small Enough to Reason About

Bad:

```text
V100__big_release.sql
- create 12 tables
- alter 8 tables
- seed 30 roles
- backfill 5 million rows
- drop old columns
- create indexes
- update stored procedures
```

Masalah:

- sulit review,
- sulit tahu step mana gagal,
- sulit recovery,
- unrelated changes tergabung,
- lock/performance sulit diprediksi.

Better:

```text
V100__create_case_assignment_table.sql
V101__add_case_assignment_fk.sql
V102__seed_case_assignment_permissions.sql
V103__add_case_assignment_read_model_columns.sql
V104__backfill_case_assignment_read_model.sql
V105__add_case_assignment_indexes.sql
```

Namun jangan juga terlalu granular sampai kehilangan konteks. Tujuannya bukan banyak file, tetapi failure boundary jelas.

### 16.2 Separate Schema Expansion from Data Backfill

Bad:

```sql
ALTER TABLE order_item ADD COLUMN total_price DECIMAL(19,2);
UPDATE order_item SET total_price = quantity * unit_price;
ALTER TABLE order_item MODIFY total_price NOT NULL;
```

Untuk table besar, ini riskan.

Better:

```text
V10: add nullable total_price column
V11: deploy app dual-write total_price for new rows
V12: backfill existing rows in chunks
V13: validate no null total_price
V14: add not null constraint
```

### 16.3 Make Backfill Resumable

Backfill long-running harus bisa berhenti dan lanjut.

Pattern:

```sql
UPDATE order_item
SET total_price = quantity * unit_price
WHERE total_price IS NULL
  AND id BETWEEN :start_id AND :end_id;
```

Atau gunakan checkpoint table:

```sql
CREATE TABLE migration_checkpoint (
    migration_code VARCHAR(100) PRIMARY KEY,
    last_processed_id BIGINT NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

Konsep:

```text
Migration can run chunk 1..N.
If stopped at chunk 37, resume from 37/38.
Already processed rows are not corrupted if revisited.
```

### 16.4 Validate Before Enforcing

Bad:

```sql
ALTER TABLE customer ADD CONSTRAINT uq_customer_email UNIQUE (email);
```

Better:

```sql
SELECT email, COUNT(*)
FROM customer
WHERE email IS NOT NULL
GROUP BY email
HAVING COUNT(*) > 1;
```

Jika hasil kosong, baru enforce constraint.

Untuk production, validation query bisa menjadi preflight step di pipeline.

### 16.5 Add Constraints in Safe Phases

Constraint sering punya dua risiko:

1. Existing data tidak valid.
2. DB perlu scan/lock table besar.

Pattern aman:

```text
1. Add new column nullable.
2. Backfill.
3. Ensure app writes valid values.
4. Validate no invalid data.
5. Add constraint with vendor-specific online/validated approach if available.
```

### 16.6 Prefer Additive First

Additive changes biasanya lebih compatible:

- add table,
- add nullable column,
- add index,
- add view,
- add new seed code,
- add new permission,
- add new foreign key later after data valid.

Destructive changes perlu delay:

- drop column,
- rename column,
- change type lossy,
- delete seed used by old app,
- tighten constraint,
- remove enum/status value.

### 16.7 Avoid Manual Hidden Steps

Bad runbook:

```text
Before running migration, ask DBA to manually delete duplicate rows.
```

Better:

```text
V20__identify_duplicate_customers_report.sql        -- optional/reporting
V21__resolve_duplicate_customers_by_business_rule.sql
V22__add_unique_constraint_customer_email.sql
```

Jika manual approval dibutuhkan, tetap buat artifact yang jelas.

---

## 17. Common Hidden Assumptions in Migration Scripts

Top engineer tidak hanya membaca SQL; dia membaca asumsi.

### 17.1 “Column Exists Means Semantics Are Correct”

Contoh:

```sql
UPDATE account SET active = TRUE WHERE disabled_at IS NULL;
```

Hidden assumption:

```text
disabled_at null means active.
```

Tapi mungkin:

```text
- imported account has disabled_at null but status CLOSED
- pending account has disabled_at null but not active
- deleted account has disabled_at null due legacy bug
```

### 17.2 “DEV Data Represents Production Data”

DEV sering terlalu bersih.

Production bisa punya:

- duplicate,
- orphan rows,
- invalid enum,
- null di kolom yang dianggap required,
- legacy migrated rows,
- manual correction rows,
- old business process rows,
- tenant-specific exception.

### 17.3 “DDL Is Fast”

DDL bisa cepat di empty DEV, tetapi lambat di production.

Contoh yang bisa mahal:

- adding column with default pada engine tertentu,
- changing column type,
- adding not null with validation,
- adding unique constraint,
- creating index on large table,
- dropping/rebuilding large index,
- moving LOB segment,
- altering partitioned table.

### 17.4 “Rollback App Means Rollback System”

Tidak selalu.

Kalau database sudah berubah secara incompatible, app rollback bisa gagal.

### 17.5 “Seed Is Static Forever”

Reference data bisa berubah. Contoh:

- regulatory status,
- permission mapping,
- workflow state,
- country/currency list,
- email template code,
- feature config.

Jika seed berubah via admin UI, migration seed bisa menimpa perubahan manual.

### 17.6 “One Migration Runner Is Guaranteed”

Dalam cloud deployment, bisa ada banyak runner:

- multiple app pods,
- CI retry,
- manual CLI,
- migration job duplicate,
- multiple services using same schema.

Butuh locking dan operational discipline.

### 17.7 “Generated Migration Is Correct”

Tool bisa generate diff, tetapi tidak tahu:

- data safety,
- lock impact,
- compatibility,
- business semantics,
- release choreography,
- naming convention,
- rollback feasibility.

Generated migration adalah draft, bukan kebenaran.

---

## 18. Migration Failure Decision Tree

Gunakan decision tree ini saat migration gagal.

```text
Migration failed
│
├─ 1. Did it change the database?
│   ├─ No / likely no
│   │   ├─ Is root cause transient? retry after fixing cause
│   │   └─ Is script invalid? fix before shared env or create new migration
│   │
│   └─ Yes / unknown
│       │
│       ├─ 2. Is the current DB state known?
│       │   ├─ No
│       │   │   ├─ inspect metadata
│       │   │   ├─ inspect migration history table
│       │   │   ├─ inspect object existence/data counts
│       │   │   └─ stop further automated retries
│       │   │
│       │   └─ Yes
│       │       │
│       │       ├─ 3. Is migration idempotent/resumable?
│       │       │   ├─ Yes: fix cause and rerun/resume
│       │       │   └─ No
│       │       │       │
│       │       │       ├─ 4. Can we roll-forward safely?
│       │       │       │   ├─ Yes: create corrective migration
│       │       │       │   └─ No
│       │       │       │
│       │       │       ├─ 5. Can we rollback logically and technically?
│       │       │       │   ├─ Yes: execute tested rollback
│       │       │       │   └─ No
│       │       │       │
│       │       │       └─ 6. Restore/quarantine/escalate
```

Key rule:

> Do not retry a failed database migration blindly when partial commit is possible.

---

## 19. How Flyway and Liquibase Relate to These Invariants

Flyway and Liquibase help enforce parts of the model, but they do not replace engineering judgment.

### 19.1 Flyway Helps With

- ordered versioned migration,
- schema history,
- checksum validation,
- repeatable migration detection,
- baseline,
- repair metadata,
- migration lock coordination,
- callbacks,
- Java-based migrations,
- integration with build/app lifecycle.

But Flyway does not automatically know:

- whether your data transformation is semantically correct,
- whether old app still needs dropped column,
- whether production has duplicate data,
- whether DDL will lock too long,
- whether rollback is logically possible,
- whether seed identity should use natural key.

### 19.2 Liquibase Helps With

- changelog/changeset tracking,
- database changelog table,
- lock table,
- checksum,
- preconditions,
- contexts/labels,
- rollback definitions,
- SQL generation,
- DBMS targeting,
- structured changelog organization.

But Liquibase also does not automatically know:

- whether generated rollback is business-safe,
- whether context branching creates governance chaos,
- whether `delete` seed operation breaks old app,
- whether a precondition is sufficient,
- whether DB abstraction hides vendor-specific lock impact.

Tooling gives guardrails. Invariants give judgment.

---

## 20. Practical Invariant Checklist Before Writing a Migration

Sebelum menulis migration, jawab pertanyaan ini.

### 20.1 Schema Contract

```text
- App version mana yang butuh perubahan ini?
- App versi lama masih akan berjalan bersamaan?
- Apakah perubahan additive atau breaking?
- Apakah ada job/report/integration yang mengakses object ini?
```

### 20.2 Data Contract

```text
- Apakah existing data memenuhi asumsi?
- Apakah perlu profiling query?
- Apakah transformasi data lossless?
- Apakah ada tenant/module exception?
```

### 20.3 Ordering

```text
- Migration ini bergantung pada migration apa?
- Apakah seed harus sebelum/ setelah schema?
- Apakah backfill harus sebelum constraint?
- Apakah code deployment harus sebelum contract phase?
```

### 20.4 Idempotency and Retry

```text
- Jika gagal di tengah, bisa dijalankan ulang?
- Jika seed sudah ada, apakah duplicate?
- Jika backfill sudah sebagian, apakah aman resume?
- Apakah ada checkpoint?
```

### 20.5 Lock and Performance

```text
- Table berapa besar?
- Operasi butuh exclusive lock?
- Ada index creation besar?
- Ada update jutaan rows?
- Perlu chunking/throttling?
- Perlu maintenance window?
```

### 20.6 Recovery

```text
- Jika migration gagal, state apa yang mungkin terjadi?
- Recovery-nya retry, repair, rollback, roll-forward, restore, atau quarantine?
- Apakah backup/snapshot dibutuhkan?
- Apakah rollback diuji?
```

### 20.7 Audit and Governance

```text
- Apakah migration artifact immutable setelah applied?
- Apakah approval jelas?
- Apakah seed perubahan permission/security direview?
- Apakah production manual step terdokumentasi?
```

---

## 21. Example: Adding a Required Column Safely

Requirement:

```text
Add customer.risk_category, required for all customers.
Allowed values: LOW, MEDIUM, HIGH.
New application will display and filter by risk_category.
```

Naive migration:

```sql
ALTER TABLE customer ADD risk_category VARCHAR(20) NOT NULL;
```

Masalah:

- existing rows tidak punya value,
- table besar bisa lock,
- app lama tidak tahu kolom ini,
- risk category mungkin butuh business rule,
- default asal-asalan bisa salah secara regulatory/business.

Better approach:

### Step 1 — Expand Schema

```sql
ALTER TABLE customer ADD risk_category VARCHAR(20);
```

Invariant:

```text
Old app still works.
New app can start using the column.
Existing rows may be null temporarily.
```

### Step 2 — Deploy App That Writes New Column

Aplikasi baru memastikan new/updated customer punya risk category.

Invariant:

```text
New writes produce risk_category.
Old rows still need backfill.
```

### Step 3 — Backfill Existing Rows

```sql
UPDATE customer
SET risk_category = CASE
    WHEN risk_score >= 80 THEN 'HIGH'
    WHEN risk_score >= 40 THEN 'MEDIUM'
    ELSE 'LOW'
END
WHERE risk_category IS NULL;
```

Untuk table besar, chunking.

Invariant:

```text
Backfill rule must be approved.
Backfill is idempotent because it only updates null values.
```

### Step 4 — Validate

```sql
SELECT COUNT(*)
FROM customer
WHERE risk_category IS NULL;
```

Expected:

```text
0
```

### Step 5 — Add Constraint

```sql
ALTER TABLE customer ADD CONSTRAINT ck_customer_risk_category
CHECK (risk_category IN ('LOW', 'MEDIUM', 'HIGH'));

ALTER TABLE customer MODIFY risk_category NOT NULL;
```

Vendor syntax berbeda; detail vendor akan dibahas di Part 22.

### Step 6 — Monitor

Postcondition:

```text
- no null risk_category
- all values in allowed set
- app query performance acceptable
- old app no longer deployed if it cannot handle new semantics
```

---

## 22. Example: Renaming a Column Without Breaking Rolling Deployment

Requirement:

```text
Rename customer.name to customer.full_name.
```

Naive migration:

```sql
ALTER TABLE customer RENAME COLUMN name TO full_name;
```

Masalah:

- old app still queries `name`,
- report may query `name`,
- ORM mapping may fail,
- rollback app fails.

Safer expand/contract:

### Release 1 — Add New Column

```sql
ALTER TABLE customer ADD full_name VARCHAR(255);
```

### Release 1 App — Dual Write

```text
On create/update:
- write name
- write full_name
```

### Backfill

```sql
UPDATE customer
SET full_name = name
WHERE full_name IS NULL;
```

### Release 2 App — Read New, Still Write Both

```text
Read full_name.
Still maintain name for compatibility.
```

### Verify No Old Readers

Check:

- app code,
- reports,
- SQL logs,
- dependencies,
- dashboards,
- integrations.

### Release 3 — Contract

```sql
ALTER TABLE customer DROP COLUMN name;
```

Invariant sepanjang transition:

```text
No deployed actor should fail regardless of whether it reads old or new column during allowed overlap window.
```

---

## 23. Example: Seed Role/Permission Safely

Requirement:

```text
Add new permission CASE_REOPEN.
Assign it to role CASE_MANAGER.
```

Naive seed:

```sql
INSERT INTO permission VALUES (123, 'CASE_REOPEN');
INSERT INTO role_permission VALUES (4, 123);
```

Masalah:

- numeric id beda antar environment,
- duplicate jika rerun,
- role id unknown,
- permission may already exist in production hotfix,
- audit unclear.

Better seed using stable codes:

```sql
-- permission seed
INSERT INTO permission (permission_code, permission_name)
SELECT 'CASE_REOPEN', 'Reopen Case'
WHERE NOT EXISTS (
    SELECT 1 FROM permission WHERE permission_code = 'CASE_REOPEN'
);

-- role permission mapping
INSERT INTO role_permission (role_code, permission_code)
SELECT 'CASE_MANAGER', 'CASE_REOPEN'
WHERE EXISTS (
    SELECT 1 FROM role WHERE role_code = 'CASE_MANAGER'
)
AND EXISTS (
    SELECT 1 FROM permission WHERE permission_code = 'CASE_REOPEN'
)
AND NOT EXISTS (
    SELECT 1 FROM role_permission
    WHERE role_code = 'CASE_MANAGER'
      AND permission_code = 'CASE_REOPEN'
);
```

Catatan:

- Syntax `INSERT ... SELECT ... WHERE NOT EXISTS` berbeda antar DB; vendor-specific pattern akan dibahas lagi.
- Jika mapping wajib, sebaiknya failure eksplisit jika role tidak ada, bukan silent skip.

Invariant:

```text
Permission identity is stable by permission_code.
Role mapping is deterministic.
Rerun does not duplicate.
If required parent role missing, migration should fail visibly unless intentional.
```

---

## 24. Example: Failed Migration Recovery Scenario

Skenario:

```text
V80__add_invoice_tax_amount.sql
```

Isi:

```sql
ALTER TABLE invoice ADD tax_amount DECIMAL(19,2);
UPDATE invoice SET tax_amount = amount * 0.11 WHERE country_code = 'ID';
ALTER TABLE invoice MODIFY tax_amount NOT NULL;
```

Failure:

```text
NOT NULL gagal karena invoice non-ID masih null.
```

Pertanyaan recovery:

### 24.1 Apa yang sudah berubah?

Kemungkinan:

```text
- column tax_amount sudah ada
- ID rows sudah terisi
- non-ID rows null
- migration history menandai V80 failed
```

### 24.2 Apakah retry aman?

Jika retry menjalankan dari awal:

```text
ALTER TABLE invoice ADD tax_amount ...
```

akan gagal karena column already exists.

Retry buta tidak aman.

### 24.3 Apa root cause?

Precondition salah:

```text
Migration assumed all invoices should have 11% tax.
Actually only ID invoices get 11%, others need 0 or country-specific tax.
```

### 24.4 Recovery options

Option A — manual fix then repair:

```sql
UPDATE invoice SET tax_amount = 0 WHERE tax_amount IS NULL;
ALTER TABLE invoice MODIFY tax_amount NOT NULL;
```

Lalu repair metadata.

Risiko:

```text
Manual changes not represented as migration unless documented.
```

Option B — create corrective migration after cleaning failed marker depending tool policy:

```text
V81__complete_invoice_tax_amount_backfill.sql
```

Isi:

```sql
UPDATE invoice
SET tax_amount = 0
WHERE tax_amount IS NULL;

ALTER TABLE invoice MODIFY tax_amount NOT NULL;
```

Butuh handle metadata failed migration sesuai tool.

Better original design:

```text
V80__add_invoice_tax_amount_nullable.sql
V81__backfill_invoice_tax_amount.sql
V82__validate_invoice_tax_amount.sql
V83__make_invoice_tax_amount_not_null.sql
```

Lesson:

> Failure-aware design mengurangi kebutuhan emergency repair.

---

## 25. The Production Migration Readiness Review

Untuk migration penting, lakukan review seperti design review kecil.

Template:

```text
Migration Name:
Owner:
Related Application Release:
Target Environments:
Database Engine:
Estimated Data Volume:
Expected Duration:
Lock Risk:
Requires Downtime:
Requires Backup:
Rollback/Roll-forward Plan:
Validation Queries:
Post-deploy Monitoring:
```

Checklist pertanyaan:

```text
1. What schema/data contract changes?
2. Is this backward-compatible?
3. Can old and new app versions coexist?
4. Does existing production data satisfy the migration preconditions?
5. Is this migration transactional on the target database?
6. If it fails halfway, what state remains?
7. Is retry safe?
8. Is rollback logically possible?
9. Is roll-forward available?
10. What query proves success?
11. What metric/log proves no performance regression?
12. Who approves business data transformation?
13. Who owns execution and communication?
```

Ini terdengar formal, tetapi untuk production-critical system, review seperti ini menghindari incident mahal.

---

## 26. Java-Specific Considerations

Karena seri ini untuk Java 8 sampai 25, ada beberapa aspek Java yang memengaruhi migration engineering.

### 26.1 Application Startup Lifecycle

Spring Boot:

```text
DataSource initialized
Flyway/Liquibase auto-run
JPA EntityManagerFactory initialized
Application ready
```

Implication:

```text
If migration fails, application fails startup.
```

Jakarta EE:

```text
Migration may run via external CLI, servlet listener, CDI startup observer, EJB singleton, or deployment pipeline.
```

Plain Java:

```text
Migration may be explicitly invoked before application service starts.
```

Invariant:

```text
Migration must run before code path requiring new schema becomes active.
```

### 26.2 ORM Auto-DDL Must Not Compete with Migration Tool

Jika Hibernate `ddl-auto=update` masih aktif, Hibernate bisa mengubah schema di luar Flyway/Liquibase history.

Masalah:

- migration history tidak lengkap,
- schema drift,
- production behavior sulit diprediksi,
- generated DDL tidak reviewed,
- rollback/release governance rusak.

Production-grade rule:

```text
Use migration tool as source of truth for schema evolution.
Disable ORM auto schema mutation in serious environments.
```

Hibernate/JPA masih boleh digunakan untuk validation:

```text
- validate entity mapping against schema
- fail startup if mismatch
```

Tetapi bukan untuk diam-diam mutate schema production.

### 26.3 Java-Based Migration Version Compatibility

Jika memakai Java-based migration, class migration adalah bagian dari artifact.

Risiko:

```text
- migration compiled with Java 21 but runtime Java 17
- old migration class depends on library version removed later
- migration logic changes when shared utility changes
- migration class not immutable if recompilation changes behavior
```

Prinsip:

```text
Java migration should be self-contained and stable.
Avoid depending on mutable business service logic.
```

Bad:

```java
new CustomerRiskService().calculateRisk(customer)
```

Kenapa?

Karena `CustomerRiskService` bisa berubah di release berikutnya, membuat migration lama tidak lagi merepresentasikan logic saat dibuat.

Better:

```text
- encode migration-specific transformation explicitly
- or call stable library version intentionally
- document business rule snapshot
```

### 26.4 Multiple Application Instances

Java backend modern sering horizontal scaled.

Jika Flyway/Liquibase run on startup:

```text
pod-1 starts migration
pod-2 waits lock
pod-3 waits lock
```

Ini bisa acceptable untuk small migrations. Untuk heavy migration, ini buruk.

Production pattern:

```text
Run migration once as controlled job.
Then deploy app replicas.
```

---

## 27. What “Top 1%” Looks Like in Migration Thinking

Engineer biasa bertanya:

```text
Does the SQL run?
```

Engineer kuat bertanya:

```text
Does the SQL run on production-sized data, under current traffic, with old and new app versions coexisting, and with a known recovery path if interrupted?
```

Engineer biasa bertanya:

```text
Can we rollback?
```

Engineer kuat bertanya:

```text
Which state transitions are reversible, which are irreversible, and what compatibility buffer do we need before destructive cleanup?
```

Engineer biasa bertanya:

```text
Can we seed this role?
```

Engineer kuat bertanya:

```text
What is the stable business identity of this role, who owns it, can it drift by environment, and what happens if it already exists with different attributes?
```

Engineer biasa bertanya:

```text
Why checksum error?
```

Engineer kuat bertanya:

```text
Has our migration history been tampered with, or is our artifact no longer a faithful record of applied database state?
```

Engineer biasa bertanya:

```text
Why migration failed in UAT?
```

Engineer kuat bertanya:

```text
Which precondition was true in DEV but false in UAT, and how do we encode that precondition into future validation?
```

---

## 28. Anti-Patterns to Avoid Early

### 28.1 Editing Old Migration After Shared Apply

Bad:

```text
V10 already applied in UAT.
Developer edits V10 to fix a typo.
```

Correct:

```text
Create V11 corrective migration.
```

### 28.2 Mixing ORM Auto-DDL and Migration Tool

Bad:

```text
Hibernate creates/updates some tables.
Flyway creates/updates others.
```

Correct:

```text
Migration tool owns schema mutation.
ORM validates mapping.
```

### 28.3 Big Bang Breaking Change

Bad:

```text
One release renames column, backfills data, drops old column, deploys new app.
```

Correct:

```text
Use expand/contract across releases.
```

### 28.4 Seed with Environment-Specific IDs

Bad:

```sql
INSERT INTO role_permission VALUES (1, 7);
```

Correct:

```text
Use stable codes/natural keys or deterministic ID strategy.
```

### 28.5 Blind Repair

Bad:

```text
Flyway validate failed. Run repair.
```

Correct:

```text
Understand mismatch first. Repair only after proving metadata correction is safe.
```

### 28.6 Unbounded Backfill Inside Startup Migration

Bad:

```text
App startup migration updates 50 million rows.
```

Correct:

```text
Use controlled batch/backfill process with throttling/checkpointing.
```

### 28.7 Production Manual Hotfix Never Backported

Bad:

```text
DBA fixes production manually. Repo remains unchanged.
```

Correct:

```text
Convert hotfix into migration artifact or align baseline/history with documented process.
```

---

## 29. A Compact Migration Design Template

Gunakan template ini saat mendesain migration non-trivial.

```markdown
# Migration Design: <name>

## Intent
What business/application change requires this database transition?

## Type
Schema / data / seed / backfill / repeatable object / operational / hotfix

## Starting State
What must be true before this migration?

## Target State
What must be true after this migration?

## Compatibility
- Old app compatible with new DB? yes/no/why
- New app compatible with old DB? yes/no/why
- Rolling deployment safe? yes/no/why

## Data Assumptions
What data assumptions are required?
How are they validated?

## Lock and Performance Risk
What tables are touched?
How many rows?
What locks are expected?

## Failure Model
What happens if it fails before/during/after each step?

## Recovery Plan
Retry / repair / rollback / roll-forward / restore / quarantine

## Validation
Queries/checks proving success.

## Audit Notes
Approval, owner, ticket, rationale.
```

Untuk migration kecil, template ini cukup dipikirkan singkat. Untuk migration besar, tulis eksplisit.

---

## 30. Ringkasan Mental Model

Database migration adalah state transition terhadap durable shared state.

Hal yang harus selalu diingat:

1. **Migration bukan hanya SQL execution.** Migration adalah perubahan kontrak sistem.
2. **Invariant lebih penting daripada tool.** Flyway/Liquibase membantu, tetapi tidak menggantikan reasoning.
3. **History harus immutable setelah applied.** Jangan edit migration lama di shared environment.
4. **Ordering harus semantik, bukan hanya numerik.** Versi benar tidak menjamin dependency benar.
5. **Seed harus deterministic.** Jangan bergantung pada generated ID yang berbeda antar environment.
6. **Rollback database tidak selalu mungkin.** Banyak production migration harus forward-recoverable.
7. **Partial failure harus dipikirkan.** Retry buta bisa memperparah state.
8. **Old/new app coexistence adalah realita deployment.** Terutama rolling deployment dan distributed workers.
9. **Drift harus bisa dideteksi.** Manual changes tanpa migration artifact menciptakan realitas tersembunyi.
10. **Operational model harus sesuai risiko.** Startup migration nyaman, tetapi tidak selalu tepat untuk production-heavy changes.

---

## 31. Latihan Berpikir

Gunakan latihan ini untuk menguji pemahaman.

### Latihan 1 — Add Non-Null Column

Kamu perlu menambahkan kolom `case.priority` yang wajib diisi. Existing table punya 10 juta rows.

Jawab:

```text
- Apa precondition-nya?
- Apa invariant-nya?
- Apa strategi expand/contract-nya?
- Bagaimana backfill dilakukan?
- Apa validation query-nya?
- Kapan NOT NULL boleh ditambahkan?
- Apa recovery jika backfill gagal di tengah?
```

### Latihan 2 — Rename Status Value

Status `PENDING_APPROVAL` ingin diganti menjadi `AWAITING_REVIEW`.

Jawab:

```text
- Apakah ini schema migration atau data migration?
- Apakah app lama masih mengenali value baru?
- Perlukah compatibility mapping?
- Bagaimana report lama terdampak?
- Apakah rollback aman?
```

### Latihan 3 — Permission Seed

Tambahkan permission `CASE_EXPORT` ke role `SUPERVISOR`.

Jawab:

```text
- Apa stable business key-nya?
- Apakah seed idempotent?
- Apa yang terjadi jika permission sudah ada dengan nama berbeda?
- Apakah migration harus fail atau update?
- Bagaimana audit-nya?
```

### Latihan 4 — Checksum Mismatch

Flyway/Liquibase mendeteksi checksum mismatch di migration yang sudah applied di UAT.

Jawab:

```text
- Apa kemungkinan penyebab?
- Apa yang tidak boleh langsung dilakukan?
- Bagaimana investigasi?
- Kapan repair boleh dilakukan?
- Kapan harus membuat corrective migration?
```

### Latihan 5 — Migration Sukses, App Gagal

Migration berhasil drop column `legacy_code`, lalu aplikasi versi baru gagal start. Rollback aplikasi ke versi lama juga gagal.

Jawab:

```text
- Invariant apa yang dilanggar?
- Mengapa rollback app tidak cukup?
- Recovery options apa yang tersedia?
- Bagaimana desain yang lebih aman sejak awal?
```

---

## 32. Koneksi ke Part Berikutnya

Part ini membangun bahasa dasar:

- invariant,
- precondition,
- postcondition,
- failure mode,
- recovery model,
- compatibility,
- drift,
- deterministic seed,
- forward recovery.

Part berikutnya akan membahas:

```text
03-database-versioning-models.md
```

Di sana kita akan mendalami bagaimana database diberi versi, bagaimana migration naming dibuat scalable, bagaimana branch conflict ditangani, bagaimana schema version dikaitkan dengan app version/release train, dan bagaimana migration history menjadi sumber kebenaran operational.

---

# Status Seri

Seri `learn-java-database-migrations-seedings-flyway-liquibase` belum selesai.

Progress saat ini:

```text
[x] Part 0  - Orientation: Database Change as Engineering Discipline
[x] Part 1  - Taxonomy of Database Changes
[x] Part 2  - Migration Invariants and Failure Models
[ ] Part 3  - Database Versioning Models
[ ] Part 4  - Flyway Mental Model
[ ] Part 5  - Flyway Setup in Java 8–25 Projects
[ ] Part 6  - Flyway SQL Migration Design
[ ] Part 7  - Flyway Repeatable Migrations
[ ] Part 8  - Flyway Java-Based Migrations
[ ] Part 9  - Flyway Callbacks and Lifecycle Hooks
[ ] Part 10 - Flyway Baseline, Repair, Validate, Clean
[ ] Part 11 - Liquibase Mental Model
[ ] Part 12 - Liquibase Setup in Java 8–25 Projects
[ ] Part 13 - Liquibase Changelog Design
[ ] Part 14 - Liquibase Preconditions, Contexts, Labels
[ ] Part 15 - Liquibase Rollback Engineering
[ ] Part 16 - Flyway vs Liquibase: Decision Framework
[ ] Part 17 - Seeding Strategy: Reference Data, Master Data, and Bootstrap Data
[ ] Part 18 - Idempotent and Deterministic Seed Design
[ ] Part 19 - Data Migration and Backfill Engineering
[ ] Part 20 - Expand/Contract Pattern for Zero-Downtime Migration
[ ] Part 21 - Database Locking, Transactions, and Online DDL
[ ] Part 22 - Vendor-Specific Migration Engineering
[ ] Part 23 - Migration Testing Strategy
[ ] Part 24 - Migration in Spring Boot Applications
[ ] Part 25 - Migration in Jakarta EE, Plain Java, and Non-Spring Systems
[ ] Part 26 - CI/CD Pipeline for Database Migration
[ ] Part 27 - Multi-Service, Multi-Module, and Shared Database Migrations
[ ] Part 28 - Multi-Tenant Database Migration
[ ] Part 29 - Security, Compliance, and Auditability
[ ] Part 30 - Observability and Operational Runbooks
[ ] Part 31 - Advanced Patterns and Anti-Patterns
[ ] Part 32 - Case Studies: Realistic Production Scenarios
[ ] Part 33 - Capstone: Designing a Production-Grade Migration Platform
```

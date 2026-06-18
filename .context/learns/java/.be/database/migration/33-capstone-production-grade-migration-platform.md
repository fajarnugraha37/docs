# Part 33 — Capstone: Designing a Production-Grade Migration Platform

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> File: `33-capstone-production-grade-migration-platform.md`  
> Fokus: menyatukan seluruh prinsip database migration, seeding, Flyway, Liquibase, CI/CD, security, observability, dan governance menjadi model platform yang production-grade.

---

## 1. Tujuan Bagian Ini

Bagian ini adalah capstone. Artinya, kita tidak lagi belajar fitur Flyway atau Liquibase secara terpisah. Kita akan menyusun **sistem kerja lengkap** untuk mengelola perubahan database secara aman, repeatable, audit-ready, dan scalable.

Target akhirnya adalah agar kamu mampu menjawab pertanyaan seperti:

- Bagaimana seharusnya struktur repository migration dibuat?
- Siapa yang boleh membuat migration?
- Siapa yang boleh menjalankan migration?
- Kapan migration dijalankan: saat app startup, CI/CD, Kubernetes Job, atau DBA window?
- Bagaimana memastikan migration aman untuk production?
- Bagaimana menangani failed migration?
- Bagaimana mencegah environment drift?
- Bagaimana membuat seed data deterministic?
- Bagaimana membuat perubahan database tetap kompatibel dengan old app dan new app?
- Bagaimana membuktikan kepada auditor bahwa perubahan database terkendali?
- Bagaimana mengukur maturity team dalam database change engineering?

Mental model utamanya:

```text
Production-grade database migration platform
= tool + convention + pipeline + ownership + observability + recovery + governance
```

Flyway dan Liquibase hanya satu lapisan. Platform migration yang matang adalah kombinasi dari:

1. standar teknis,
2. standar review,
3. standar deployment,
4. standar rollback/roll-forward,
5. standar security,
6. standar audit,
7. standar operasional.

---

## 2. Masalah yang Ingin Diselesaikan

Banyak team memakai Flyway/Liquibase tetapi tetap mengalami masalah:

- migration berhasil di local tetapi gagal di UAT,
- script diubah setelah pernah dijalankan,
- production punya schema berbeda dari UAT,
- ada manual hotfix langsung di DB,
- seed data berbeda antar environment,
- app baru butuh column baru tetapi old app crash,
- rollback aplikasi gagal karena schema sudah berubah,
- DBA tidak percaya script developer,
- developer tidak tahu lock impact,
- pipeline hanya menjalankan `migrate` tanpa pre-check,
- log migration tidak cukup untuk incident analysis,
- tidak ada runbook ketika migration stuck,
- migration dijalankan oleh app pod bersamaan dan membuat race condition,
- permission migration user terlalu besar,
- audit hanya berupa “lihat git commit”.

Masalah-masalah ini bukan masalah tool. Ini masalah **operating model**.

Tool hanya menjawab:

```text
Bagaimana migration dijalankan?
```

Platform menjawab:

```text
Bagaimana perubahan database dikelola dari ide sampai production, termasuk ketika gagal?
```

---

## 3. Prinsip Inti Platform Migration

Sebelum masuk desain, tetapkan prinsip.

### 3.1 Database Change Is a Product Contract Change

Database bukan storage pasif. Database adalah kontrak antara:

- aplikasi,
- batch job,
- reporting,
- integration service,
- data pipeline,
- admin tool,
- audit/reporting system,
- sometimes external consumers.

Karena itu perubahan database harus diperlakukan sebagai **contract change**.

Contoh:

```sql
ALTER TABLE users DROP COLUMN full_name;
```

Secara SQL sederhana. Secara contract berbahaya jika:

- old app masih membaca `full_name`,
- report masih memakai `full_name`,
- ETL masih extract `full_name`,
- view masih reference column tersebut,
- stored procedure masih menggunakannya,
- rollback app masih butuh column tersebut.

Production-grade mindset:

```text
Sebelum mengubah database, identifikasi semua consumer kontraknya.
```

---

### 3.2 Migration Must Be Immutable After Applied

Rule paling penting:

```text
Migration yang sudah pernah dijalankan di shared environment tidak boleh diedit.
```

Kenapa?

Karena migration history table menyimpan checksum. Jika file diubah setelah dijalankan, environment lain bisa punya interpretasi berbeda terhadap versi yang sama.

Contoh buruk:

```text
V2026_01_10_0900__create_user_table.sql
```

Sudah jalan di DEV dan UAT, lalu developer mengubah file yang sama agar cocok dengan bug baru. Akibat:

- DEV schema mungkin hasil versi lama,
- local developer baru menjalankan versi baru,
- UAT checksum mismatch,
- PROD belum jelas akan dapat versi mana,
- audit tidak bisa membuktikan perubahan aktual.

Rule:

```text
Jika perlu koreksi, buat migration baru.
```

Contoh:

```text
V2026_01_10_0900__create_user_table.sql
V2026_01_12_1430__fix_user_email_constraint.sql
```

---

### 3.3 Roll-Forward Is the Default Recovery Model

Rollback database sering tidak semudah rollback aplikasi.

Aplikasi:

```text
deploy v10 -> error -> redeploy v9
```

Database:

```text
add column -> backfill data -> app writes new data -> drop old column?
```

Rollback bisa mustahil jika:

- data lama sudah hilang,
- data sudah diubah irreversible,
- external system sudah membaca format baru,
- dual-write tidak tersedia,
- user sudah membuat transaksi berdasarkan schema baru.

Karena itu default production-grade adalah:

```text
Prefer roll-forward correction over rollback fantasy.
```

Rollback tetap perlu didesain, tetapi bukan asumsi kosong.

---

### 3.4 Compatibility Beats Cleverness

Migration yang bagus bukan yang paling pendek. Migration yang bagus adalah yang menjaga compatibility.

Contoh buruk:

```sql
ALTER TABLE orders RENAME COLUMN status TO order_status;
```

Jika old app masih membaca `status`, maka crash.

Contoh lebih aman:

```text
Release A:
1. add order_status nullable
2. app writes both status and order_status
3. backfill order_status
4. app reads order_status with fallback to status

Release B:
5. app reads only order_status
6. stop writing status

Release C:
7. drop status after old app no longer exists
```

Prinsip:

```text
Production database changes should be compatible across deployment windows.
```

---

### 3.5 Every Migration Must Be Observable

Migration yang tidak observable adalah black box.

Minimal harus bisa menjawab:

- migration apa yang jalan?
- kapan mulai?
- kapan selesai?
- siapa/apa yang menjalankan?
- berapa lama?
- migration mana yang gagal?
- berapa row terdampak?
- lock wait terjadi atau tidak?
- apa database version sebelum dan sesudah?
- apakah schema history berubah?

Tanpa observability, setiap incident menjadi forensik manual.

---

## 4. Platform Architecture: Lapisan-Lapisan Sistem Migration

Kita bisa melihat platform migration sebagai beberapa lapisan.

```text
+------------------------------------------------------------+
| Governance & Audit                                          |
| approval, evidence, ownership, compliance                   |
+------------------------------------------------------------+
| Operational Runbook                                         |
| pre-flight, go/no-go, incident, recovery                    |
+------------------------------------------------------------+
| Observability                                               |
| logs, metrics, dashboard, alert, migration report           |
+------------------------------------------------------------+
| CI/CD Pipeline                                              |
| lint, validate, dry-run, test, promote, deploy              |
+------------------------------------------------------------+
| Migration Tool                                              |
| Flyway / Liquibase                                          |
+------------------------------------------------------------+
| Migration Artifact                                          |
| SQL, changelog, Java migration, seed, metadata              |
+------------------------------------------------------------+
| Database Platform                                           |
| PostgreSQL / Oracle / MySQL / SQL Server / others           |
+------------------------------------------------------------+
| Application Ecosystem                                       |
| services, jobs, reports, integrations, users                |
+------------------------------------------------------------+
```

Setiap lapisan punya responsibility.

Jika hanya ada tool, platform belum matang.

---

## 5. Repository Structure

Struktur repository menentukan maintainability migration jangka panjang.

### 5.1 Single-Service Repository

Untuk satu aplikasi dengan satu schema:

```text
my-service/
  src/
  build.gradle
  src/main/resources/
    db/
      migration/
        V2026_01_10_0900__create_user_table.sql
        V2026_01_11_1100__add_user_email_index.sql
        R__user_read_model_view.sql
      seed/
        V2026_01_10_1000__seed_initial_roles.sql
      callback/
        beforeMigrate.sql
        afterMigrate.sql
  docs/
    database/
      migration-standard.md
      rollback-policy.md
      seed-policy.md
```

Cocok untuk:

- app kecil-menengah,
- ownership jelas,
- satu team,
- satu database utama.

---

### 5.2 Multi-Module Monorepo

Untuk monorepo dengan banyak module tetapi satu deployment boundary:

```text
platform/
  modules/
    user-service/
    order-service/
    billing-service/
  database/
    flyway/
      common/
        V2026_01_01_0900__create_common_schema.sql
      user/
        V2026_01_10_0900__create_user_tables.sql
      order/
        V2026_01_10_1000__create_order_tables.sql
      billing/
        V2026_01_10_1100__create_billing_tables.sql
    seed/
      common/
      user/
      order/
      billing/
    docs/
      ownership.md
      dependency-map.md
```

Risiko:

- ordering antar module,
- dependency migration,
- shared lookup table,
- conflict version number,
- unclear ownership.

Mitigasi:

- gunakan timestamp naming,
- buat dependency map,
- larang module A mengubah table module B tanpa review owner,
- pisahkan schema bila memungkinkan.

---

### 5.3 Dedicated Database Migration Repository

Untuk enterprise dengan banyak aplikasi yang menyentuh database bersama:

```text
database-change-repo/
  README.md
  schemas/
    aceas/
      flyway/
        V2026_01_10_0900__case_add_status_reason.sql
        V2026_01_12_1400__audit_add_actor_type.sql
      liquibase/
        changelog-root.yaml
      seed/
        role-permission/
        reference-data/
    reporting/
    integration/
  standards/
    naming-convention.md
    review-checklist.md
    rollback-policy.md
    production-runbook.md
  pipeline/
    Jenkinsfile
    github-actions.yml
  scripts/
    validate.sh
    dry-run.sh
    drift-check.sh
```

Cocok untuk:

- database shared,
- DBA-heavy organization,
- compliance-heavy environment,
- release train,
- controlled production changes.

Trade-off:

- lebih governance-heavy,
- developer flow lebih lambat,
- butuh disiplin koordinasi.

---

## 6. Naming Convention Standard

Naming convention harus menyelesaikan tiga masalah:

1. ordering,
2. readability,
3. traceability.

### 6.1 Flyway Versioned Migration

Rekomendasi umum:

```text
VYYYY_MM_DD_HHMM__short_description.sql
```

Contoh:

```text
V2026_02_03_0930__case_add_escalation_reason_column.sql
V2026_02_03_1015__case_backfill_escalation_reason.sql
V2026_02_04_0900__case_add_escalation_reason_not_null_check.sql
```

Kenapa timestamp?

- mengurangi conflict branch,
- mudah trace ke waktu pembuatan,
- cocok untuk parallel team,
- tidak perlu memperebutkan `V42`, `V43`, `V44`.

Hindari:

```text
V1.sql
V2.sql
V3.sql
```

untuk sistem besar, karena mudah conflict.

---

### 6.2 Flyway Repeatable Migration

Format:

```text
R__object_type_object_name.sql
```

Contoh:

```text
R__view_case_listing.sql
R__function_calculate_sla_deadline.sql
R__procedure_refresh_case_summary.sql
```

Rule:

- hanya untuk object definition yang boleh direcreate,
- jangan untuk historical DDL,
- jangan untuk mutable production data sembarangan.

---

### 6.3 Liquibase Changeset Identity

Liquibase changeset identity adalah kombinasi:

```text
id + author + file path
```

Contoh YAML:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-02-03-0930-case-add-escalation-reason-column
      author: case-team
      changes:
        - addColumn:
            tableName: case_record
            columns:
              - column:
                  name: escalation_reason
                  type: varchar(255)
```

Rule:

- `id` harus stable,
- `author` boleh team-based agar tidak personal-fragile,
- logical file path harus konsisten,
- jangan rename file changelog setelah applied tanpa strategi.

---

## 7. Migration Classification Standard

Setiap migration harus diklasifikasikan sebelum review.

Contoh metadata sederhana di komentar file:

```sql
-- change-type: schema-expand
-- risk-level: medium
-- owner: case-team
-- issue: ACEAS-1234
-- compatible-with-old-app: yes
-- rollback-strategy: roll-forward
-- estimated-duration: < 30s
-- lock-impact: metadata lock on case_record
```

Klasifikasi:

| Class | Meaning | Example | Default Gate |
|---|---|---|---|
| `schema-expand` | Additive schema change | add nullable column | normal review |
| `schema-contract` | Remove/rename/tighten contract | drop column | senior review |
| `data-seed` | deterministic reference seed | role permission seed | seed review |
| `data-backfill` | transform existing data | fill new column | performance review |
| `index-change` | index add/drop/rebuild | add composite index | lock/perf review |
| `constraint-change` | FK/unique/not-null/check | add unique constraint | data validation review |
| `object-replace` | view/function/procedure | replace view | dependency review |
| `security-change` | privilege/role/security config | grant role | security review |
| `tenant-change` | tenant-specific migration | bootstrap tenant | tenant registry review |
| `emergency-fix` | production hotfix | repair bad data | incident review |

Benefit:

- reviewer tahu apa yang harus dicari,
- pipeline bisa menerapkan gate berbeda,
- audit evidence lebih jelas.

---

## 8. Review Checklist

Migration review tidak boleh hanya “SQL-nya valid atau tidak”.

### 8.1 General Checklist

Gunakan checklist ini untuk hampir semua migration:

```text
[ ] Nama migration jelas dan mengikuti convention.
[ ] Migration belum pernah diedit setelah applied di shared environment.
[ ] Migration deterministic.
[ ] Tidak bergantung pada data local developer.
[ ] Tidak memakai secret hardcoded.
[ ] Tidak memakai timestamp/random value tanpa alasan.
[ ] Tidak mencampur schema change besar dan data backfill besar dalam satu script tanpa alasan.
[ ] Ada issue/ticket reference.
[ ] Ada owner.
[ ] Ada rollback atau roll-forward strategy.
[ ] Ada estimasi lock impact.
[ ] Ada estimasi durasi.
[ ] Sudah dites dari empty database.
[ ] Sudah dites dari previous release database.
[ ] Sudah dites terhadap database engine asli, bukan hanya H2.
```

---

### 8.2 DDL Checklist

```text
[ ] Apakah change ini additive?
[ ] Jika breaking, apakah sudah pakai expand/contract?
[ ] Apakah old app masih kompatibel?
[ ] Apakah new app masih kompatibel jika migration belum jalan?
[ ] Apakah ada dependency view/procedure/report?
[ ] Apakah constraint baru sudah divalidasi terhadap data existing?
[ ] Apakah index creation bisa lock table lama?
[ ] Apakah nama constraint/index eksplisit?
[ ] Apakah identifier length aman untuk target DB?
[ ] Apakah type compatible lintas DB target?
```

---

### 8.3 Data Migration Checklist

```text
[ ] Apakah jumlah row terdampak diketahui?
[ ] Apakah query update menggunakan predicate yang aman?
[ ] Apakah migration idempotent atau resumable?
[ ] Apakah ada chunking untuk data besar?
[ ] Apakah ada checkpoint/resume marker?
[ ] Apakah ada validation query?
[ ] Apakah long transaction dihindari?
[ ] Apakah row lock impact dipahami?
[ ] Apakah ada backup/snapshot sebelum run?
[ ] Apakah bisa roll-forward jika gagal sebagian?
```

---

### 8.4 Seed Checklist

```text
[ ] Seed memakai stable natural key.
[ ] Seed deterministic.
[ ] Seed aman dijalankan ulang.
[ ] Seed tidak menghapus data production user.
[ ] Seed tidak menyimpan password/secret plaintext.
[ ] Seed tidak memakai environment-specific value tanpa mekanisme overlay.
[ ] Seed punya owner domain.
[ ] Seed punya validation query.
[ ] Seed membedakan reference data vs test fixture.
```

---

### 8.5 Security Checklist

```text
[ ] Migration user tidak sama dengan app user.
[ ] Migration user least privilege sebisa mungkin.
[ ] Secret tidak masuk repository.
[ ] Tidak ada PII dump dalam migration.
[ ] Data masking dipakai untuk test fixture.
[ ] Privilege grant/revoke direview security/DBA.
[ ] Audit trail cukup untuk menjawab siapa, kapan, apa.
```

---

## 9. Local Developer Workflow

Local workflow harus cepat, tetapi tidak boleh mengajarkan kebiasaan buruk.

### 9.1 Prinsip Local Workflow

Local developer boleh mudah reset database, tetapi harus tetap memakai migration resmi.

```text
Local convenience must not bypass production discipline.
```

Contoh workflow:

```bash
./gradlew clean build
./gradlew flywayClean flywayMigrate -Penv=local
./gradlew test
```

Atau dengan Docker Compose:

```text
docker compose up -d postgres
./scripts/migrate-local.sh
./scripts/run-tests.sh
```

---

### 9.2 Local Reset vs Shared Reset

Local boleh:

```text
clean -> migrate -> seed
```

Shared DEV/UAT/PROD tidak boleh clean sembarangan.

Rule:

| Environment | Clean Allowed? | Notes |
|---|---:|---|
| local | yes | for developer convenience |
| ephemeral test | yes | recreated often |
| shared dev | rarely | with approval only |
| SIT/UAT | no by default | data may be meaningful |
| staging | no | production-like |
| production | never | except disaster rebuild with formal process |

---

### 9.3 Developer Migration Creation Flow

```text
1. Pull latest main.
2. Create migration with timestamp name.
3. Run migration from clean local DB.
4. Run migration from previous local snapshot if available.
5. Run application tests.
6. Generate migration report/dry-run if needed.
7. Open PR with checklist filled.
8. Reviewer checks SQL, compatibility, risk, rollback/roll-forward.
9. Merge only after validation.
```

---

## 10. CI/CD Pipeline Design

A mature pipeline has stages.

```text
commit
  -> static validation
  -> migration syntax check
  -> clean database migration test
  -> previous-release upgrade test
  -> seed validation
  -> application contract test
  -> dry-run/report
  -> artifact packaging
  -> deploy lower env
  -> promote
  -> production preflight
  -> production migrate
  -> postflight verification
```

---

### 10.1 Static Validation Stage

Checks:

- file naming convention,
- duplicate version,
- modified applied migration,
- forbidden commands,
- missing metadata comments,
- disallowed `DROP` without approval,
- disallowed `TRUNCATE` in production migration,
- hardcoded secret pattern,
- environment-specific endpoint.

Example policy:

```text
Fail pipeline if migration contains:
- DROP TABLE
- TRUNCATE TABLE
- DELETE FROM without WHERE
- UPDATE without WHERE
- GRANT DBA
- CREATE USER with hardcoded password
```

Not every forbidden command is always wrong, but it must require explicit exception.

---

### 10.2 Clean Database Migration Test

Purpose:

```text
Can a new environment be created from scratch?
```

Flow:

```text
1. Start real DB container.
2. Run all migrations.
3. Run all seeds.
4. Start app.
5. Run smoke tests.
```

This catches:

- syntax errors,
- missing dependency ordering,
- broken view/function,
- invalid seed order,
- missing baseline assumptions.

---

### 10.3 Previous Release Upgrade Test

Purpose:

```text
Can production-like previous version be upgraded to current version?
```

Flow:

```text
1. Restore previous release schema snapshot.
2. Restore representative data sample.
3. Run new migrations.
4. Run validation queries.
5. Start new app.
6. Run contract/regression tests.
```

This is more important than clean migration test for production.

Why?

Production is not empty. Production is an old database with old data.

---

### 10.4 Drift Detection Stage

Drift means database state changed outside migration control.

Examples:

- DBA added index manually,
- hotfix altered column directly,
- UAT has extra column,
- production missing old migration,
- checksum mismatch.

Detection approach:

```text
1. Validate migration history.
2. Compare schema snapshot with expected schema.
3. Compare important reference data checksum.
4. Fail or warn depending environment.
```

Drift should never be ignored. It should be classified:

| Drift Type | Severity | Action |
|---|---:|---|
| checksum mismatch | high | investigate before deploy |
| missing migration | high | stop deploy |
| extra manual index | medium | document or codify migration |
| reference data difference | medium/high | reconcile seed ownership |
| environment-only config | low/medium | move to approved overlay |

---

### 10.5 Dry-Run / SQL Review Stage

For Liquibase, generated SQL can be reviewed before execution. For Flyway SQL migrations, the file itself is the SQL, but pipeline can still package a report.

Report should include:

```text
- target database
- current schema version
- pending migrations
- script names
- checksums
- estimated risk class
- destructive statements found
- lock-sensitive statements found
- validation queries
```

---

### 10.6 Artifact Packaging

Migration should be deployed as immutable artifact.

Bad:

```text
Pipeline pulls latest branch and runs whatever SQL is there.
```

Better:

```text
Build produces versioned artifact containing exact migration files.
Promoted artifact is the same from SIT -> UAT -> PROD.
```

Example artifact:

```text
my-service-db-migration-2026.02.03-build.145.zip
  db/migration/...
  db/seed/...
  manifest.json
  checksum.txt
  migration-report.md
```

Manifest example:

```json
{
  "application": "case-service",
  "release": "2026.02.03",
  "build": "145",
  "gitCommit": "abc123",
  "tool": "flyway",
  "targetDatabases": ["oracle19c"],
  "migrations": [
    {
      "file": "V2026_02_03_0930__case_add_escalation_reason_column.sql",
      "checksum": "...",
      "type": "schema-expand",
      "risk": "medium"
    }
  ]
}
```

---

## 11. Deployment Models

Ada beberapa cara menjalankan migration.

### 11.1 App Startup Migration

Aplikasi menjalankan migration saat startup.

Kelebihan:

- sederhana,
- cocok untuk small app,
- no separate deployment job,
- local developer mudah.

Risiko:

- multiple app pods race,
- app startup lambat,
- migration failure membuat app unavailable,
- app user sering butuh privilege besar,
- sulit approval terpisah,
- long migration tidak cocok.

Cocok untuk:

- small service,
- low-risk schema,
- non-critical environment,
- app dengan satu instance atau locking matang.

Tidak cocok untuk:

- regulated production,
- long-running migration,
- multi-pod deployment,
- high availability system,
- privileged DDL separation.

---

### 11.2 External Migration Job

Migration dijalankan oleh pipeline/Kubernetes Job sebelum app rollout.

```text
1. Deploy migration job.
2. Job runs Flyway/Liquibase.
3. Job succeeds.
4. Deploy app.
5. Run smoke test.
```

Kelebihan:

- migration terpisah dari app startup,
- permission bisa dipisah,
- log lebih jelas,
- approval lebih mudah,
- cocok untuk Kubernetes.

Risiko:

- butuh pipeline lebih matang,
- butuh secret management,
- butuh ordering jelas,
- rollback choreography lebih kompleks.

Ini biasanya pilihan terbaik untuk production-grade system.

---

### 11.3 DBA-Controlled Migration Window

DBA menjalankan reviewed SQL di change window.

Kelebihan:

- cocok untuk database critical,
- DBA bisa monitor lock/session,
- compliance kuat,
- perubahan destructive bisa dikontrol.

Risiko:

- developer feedback lambat,
- manual execution risk,
- artifact drift jika SQL tidak sama dengan repo,
- Flyway/Liquibase history bisa tertinggal jika tidak disiplin.

Jika DBA menjalankan manual SQL, tetap harus:

```text
- berasal dari artifact resmi,
- direkam di schema history,
- punya evidence execution,
- punya post-check,
- tidak diedit manual saat window tanpa capture balik ke repo.
```

---

### 11.4 Hybrid Model

Model matang sering hybrid:

| Change Type | Execution Model |
|---|---|
| small additive DDL | pipeline job |
| reference seed | pipeline job |
| large backfill | controlled batch job |
| dangerous contract migration | DBA window + pipeline history sync |
| online index large table | DBA-controlled or special job |
| tenant wave migration | tenant migration orchestrator |

Production-grade platform tidak memaksa semua migration lewat satu mekanisme jika risk profile berbeda.

---

## 12. Production Deployment Choreography

### 12.1 Default Safe Sequence

Untuk perubahan additive:

```text
1. Pre-flight checks.
2. Backup/snapshot if required.
3. Run migration job.
4. Validate schema history.
5. Validate key schema objects.
6. Deploy app.
7. Smoke test.
8. Monitor errors and DB metrics.
9. Mark release complete.
```

---

### 12.2 Expand/Contract Sequence

Untuk breaking change:

```text
Release 1 — Expand
  - Add new nullable column/table/object.
  - Keep old contract.
  - Deploy app that writes both or reads fallback.

Release 2 — Migrate Data
  - Backfill data.
  - Validate consistency.
  - Monitor dual-write correctness.

Release 3 — Switch Read Contract
  - App reads new structure.
  - Old structure still exists.
  - Rollback app still possible.

Release 4 — Contract
  - Stop writing old structure.
  - Drop old column/table only after safety window.
```

Safety window depends on:

- release rollback policy,
- traffic volume,
- compliance retention,
- reporting dependency,
- downstream integration cadence.

---

### 12.3 Go/No-Go Criteria

Before production migration:

```text
GO if:
[ ] migration passed UAT on production-like data,
[ ] backup/snapshot complete if required,
[ ] no active long-running blocking transaction,
[ ] DBA/on-call aware for high-risk change,
[ ] rollback/roll-forward path documented,
[ ] app version compatibility confirmed,
[ ] monitoring dashboard ready,
[ ] communication channel open.

NO-GO if:
[ ] checksum mismatch unexplained,
[ ] production schema drift unresolved,
[ ] migration duration unknown for large table,
[ ] destructive change without approval,
[ ] no recovery path,
[ ] dependent service not ready,
[ ] target DB under incident/high load.
```

---

## 13. Rollback and Roll-Forward Policy

### 13.1 Policy Statement

A mature policy sounds like this:

```text
Database rollback is not assumed to be available.
Every migration must declare one of:
1. reversible rollback,
2. compensating roll-forward,
3. restore-from-backup recovery,
4. no-rollback with explicit business approval.
```

---

### 13.2 Recovery Strategy Matrix

| Migration Type | Preferred Recovery |
|---|---|
| add nullable column | usually no rollback needed; app can ignore |
| add index | drop index if harmful |
| add table | drop only if no data written; otherwise ignore/roll-forward |
| seed reference data | compensating update/delete if safe |
| large backfill | resumable roll-forward correction |
| drop column | restore backup or compatibility delay before drop |
| rename column | expand/contract; avoid direct rename |
| tighten constraint | remove/relax constraint if fails, but preserve data |
| privilege grant | revoke if wrong |
| data correction | compensating correction with audit |

---

### 13.3 App Rollback Compatibility

Every release should answer:

```text
Can app vN-1 run against database after migration vN?
```

If yes:

```text
app rollback is safe.
```

If no:

```text
deployment must be treated as irreversible or require coordinated rollback.
```

Top-tier engineer does not say “we can rollback” unless this matrix is verified.

---

## 14. Seeding Policy

Seed policy prevents production data chaos.

### 14.1 Seed Categories

| Category | Example | Versioned? | Mutable? |
|---|---|---:|---:|
| reference data | country, currency, status | yes | rarely |
| permission seed | role-action mapping | yes | controlled |
| bootstrap data | default tenant config | yes | controlled |
| feature flag seed | default feature switch | yes | mutable via config process |
| test fixture | sample users/orders | no production | yes in test |
| environment config | endpoint URL | not normal seed | env-managed |
| secret | password/API key | never in seed | secret manager |

---

### 14.2 Stable Key Rule

Seed must use stable business key.

Bad:

```sql
INSERT INTO role_permission (role_id, permission_id)
VALUES (1, 12);
```

Better:

```sql
INSERT INTO role_permission (role_code, permission_code)
SELECT 'CASE_OFFICER', 'CASE_APPROVE'
WHERE NOT EXISTS (
  SELECT 1
  FROM role_permission
  WHERE role_code = 'CASE_OFFICER'
    AND permission_code = 'CASE_APPROVE'
);
```

Why?

Because surrogate IDs differ across environments.

---

### 14.3 Seed Drift Policy

Seed drift happens when production reference data differs from expected seed.

Policy:

```text
If seed-owned data drifts, do not blindly overwrite.
Classify:
1. authorized operational change,
2. unauthorized manual change,
3. obsolete seed,
4. environment-specific override,
5. bug.
```

Then choose:

- codify operational change as new migration,
- repair unauthorized change,
- update seed policy,
- move environment config out of seed.

---

## 15. Security Model

### 15.1 Separate Users

Do not use one DB user for everything.

```text
app_user
  - SELECT/INSERT/UPDATE/DELETE on needed tables
  - no DDL
  - no broad admin privilege

migration_user
  - DDL privilege needed for migration
  - controlled use in pipeline
  - not used by running app

readonly_user
  - reporting/read-only access

admin/dba_user
  - manual operational use
  - break-glass only
```

---

### 15.2 Least Privilege Migration

In reality, migration user often needs broad DDL. But still reduce scope:

- schema-specific privilege,
- no superuser unless unavoidable,
- no cross-database privilege,
- no user management unless required,
- rotate credentials,
- store secret in vault/SSM/Kubernetes Secret,
- restrict network path,
- audit login.

---

### 15.3 Secret Handling

Never:

```text
- put DB password in migration file,
- create app admin password in seed,
- put API token in seed,
- commit environment credential,
- log JDBC URL with password.
```

Use:

- Vault,
- AWS SSM Parameter Store,
- AWS Secrets Manager,
- Kubernetes Secret with external sync,
- CI/CD secret store.

---

## 16. Audit and Compliance Evidence

A regulated production migration should leave evidence.

### 16.1 Minimum Evidence

```text
- approved ticket/change request,
- migration artifact version,
- git commit hash,
- reviewer identity,
- migration list,
- checksum list,
- execution timestamp,
- executor identity/service account,
- target environment,
- pre-check result,
- post-check result,
- validation query result,
- incident notes if any.
```

---

### 16.2 Evidence Report Template

```markdown
# Database Migration Execution Report

## Release
- Application: case-service
- Release: 2026.02.03
- Build: 145
- Git commit: abc123
- Migration tool: Flyway
- Target DB: Oracle 19c
- Environment: Production

## Approval
- Change request: CR-2026-000123
- Approved by: <name/team>
- Approval time: <timestamp>

## Pre-flight
- Schema history validated: yes
- Drift detected: no
- Backup/snapshot: completed
- Blocking session check: clear
- Estimated migration duration: 45s

## Executed Migrations
| Version | Description | Checksum | Duration | Status |
|---|---|---:|---:|---|
| 2026.02.03.0930 | case add escalation reason | 12345 | 2s | success |
| 2026.02.03.1015 | backfill escalation reason | 67890 | 32s | success |

## Post-flight
- Schema version: 2026.02.03.1015
- Validation queries: passed
- App smoke test: passed
- Error rate: normal
- DB locks: normal

## Notes
- No incident.
```

---

## 17. Observability Standard

### 17.1 Logs

Migration logs should include:

```text
timestamp
release id
artifact id
environment
database
schema
migration version
migration description
start time
end time
duration
status
error code
correlation id
```

Example structured log:

```json
{
  "event": "database_migration_completed",
  "app": "case-service",
  "release": "2026.02.03",
  "env": "prod",
  "tool": "flyway",
  "version": "2026.02.03.0930",
  "description": "case add escalation reason column",
  "durationMs": 1842,
  "status": "success",
  "correlationId": "deploy-20260203-145"
}
```

---

### 17.2 Metrics

Useful metrics:

```text
migration_total
migration_success_total
migration_failure_total
migration_duration_seconds
pending_migration_count
schema_version
migration_lock_wait_seconds
migration_rows_affected
migration_last_success_timestamp
migration_last_failure_timestamp
```

---

### 17.3 Alerts

Alert conditions:

```text
- migration failed in production,
- migration duration exceeds threshold,
- migration lock wait exceeds threshold,
- schema version mismatch after deployment,
- app starts with pending migration unexpectedly,
- checksum mismatch detected,
- drift detected in staging/production,
- DATABASECHANGELOGLOCK/Flyway lock stuck beyond threshold.
```

---

## 18. Operational Runbooks

### 18.1 Pre-Flight Runbook

```text
1. Confirm release artifact.
2. Confirm target environment.
3. Confirm current DB version.
4. Run migration validate.
5. Check pending migrations.
6. Check drift.
7. Check DB health.
8. Check long-running transactions.
9. Check lock-sensitive statements.
10. Confirm backup/snapshot.
11. Confirm app compatibility.
12. Confirm on-call/DBA availability for risky change.
13. Announce start.
```

---

### 18.2 During-Flight Runbook

```text
1. Start migration job.
2. Watch migration logs.
3. Watch DB sessions/locks.
4. Watch CPU/IO/load.
5. Watch migration duration.
6. Do not manually interrupt unless threshold is breached.
7. If blocked, identify blocker.
8. Follow stop/continue decision tree.
```

---

### 18.3 Post-Flight Runbook

```text
1. Confirm schema history status.
2. Confirm no pending failed migration.
3. Run validation queries.
4. Confirm app starts.
5. Run smoke tests.
6. Monitor error rate.
7. Monitor DB load.
8. Record evidence report.
9. Announce completion.
```

---

### 18.4 Failed Migration Runbook

```text
1. Stop automatic retries if unsafe.
2. Capture logs and DB state.
3. Identify whether migration is transactional.
4. Check schema history table.
5. Check partially created objects.
6. Check data partial update.
7. Decide recovery path:
   a. retry after fixing environmental issue,
   b. repair history after manual correction,
   c. run compensating migration,
   d. restore backup,
   e. roll forward app/migration.
8. Do not edit already-applied migration blindly.
9. Document incident.
10. Add regression test.
```

---

## 19. Migration Platform Maturity Model

### Level 0 — Manual Chaos

Characteristics:

- SQL run manually,
- no migration history,
- no standard naming,
- no audit,
- production differs from lower env,
- rollback unknown.

Risk:

```text
High. Every deploy is a trust exercise.
```

---

### Level 1 — Tool Adoption

Characteristics:

- Flyway/Liquibase installed,
- migration files in repo,
- history table exists,
- local and CI can run migrations.

Still missing:

- review standard,
- drift detection,
- rollback policy,
- observability.

---

### Level 2 — Team Standardization

Characteristics:

- naming convention,
- PR checklist,
- seed policy,
- no editing old migrations,
- clean DB test,
- previous release upgrade test.

Risk lower, but production may still be weak.

---

### Level 3 — Pipeline-Controlled Migration

Characteristics:

- migration artifact immutable,
- CI/CD validates migration,
- dry-run/report,
- external migration job,
- environment promotion,
- drift detection,
- production preflight.

This is strong for most teams.

---

### Level 4 — Operationally Mature

Characteristics:

- dashboard,
- alerting,
- runbooks,
- lock monitoring,
- recovery drills,
- migration duration metrics,
- rollback/roll-forward tested,
- production evidence report.

This is where migration becomes operable.

---

### Level 5 — Governance and Platform Excellence

Characteristics:

- multi-team ownership model,
- schema contract registry,
- tenant migration orchestrator,
- automated risk classification,
- automated policy enforcement,
- compliance evidence automated,
- migration SLO,
- regular drift audit,
- organization-wide standards.

This is top-tier enterprise maturity.

---

## 20. Decision Framework: What Should Your Team Build?

Not every team needs Level 5. Build based on risk.

### 20.1 Small Internal App

Minimum:

```text
- Flyway or Liquibase
- versioned migrations
- local clean migrate
- CI migration test
- no editing applied migrations
- basic seed policy
```

---

### 20.2 Medium Business-Critical App

Add:

```text
- previous release upgrade test
- migration PR checklist
- migration artifact
- external migration job
- backup preflight
- rollback/roll-forward policy
- structured logs
```

---

### 20.3 High-Availability Production System

Add:

```text
- expand/contract mandatory for breaking change
- lock impact review
- performance test for large tables
- canary/blue-green compatible migrations
- DB monitoring during migration
- incident runbook
- DBA/on-call gate for high-risk change
```

---

### 20.4 Regulated Enterprise/Government/Financial System

Add:

```text
- formal approval evidence
- immutable migration artifact
- separate migration user
- audit report
- drift detection
- security review for privilege/data changes
- retention of execution logs
- production access control
- periodic audit
```

---

### 20.5 Multi-Tenant SaaS

Add:

```text
- tenant migration registry
- tenant version tracking
- wave rollout
- tenant quarantine
- retry/resume model
- tenant seed ownership
- per-tenant dashboard
```

---

## 21. Reference Implementation Blueprint

Berikut blueprint platform yang bisa kamu adaptasi.

### 21.1 Repository

```text
case-service/
  src/main/java/...
  src/main/resources/db/migration/
    V2026_02_03_0930__case_add_escalation_reason_column.sql
    V2026_02_03_1015__case_backfill_escalation_reason.sql
    R__view_case_listing.sql
  src/main/resources/db/callback/
    beforeMigrate.sql
    afterMigrate.sql
  src/test/java/.../MigrationTest.java
  database/
    validation/
      post_migration_checks.sql
    docs/
      migration-standard.md
      seed-policy.md
      rollback-policy.md
      runbook.md
  pipeline/
    migrate-job.yaml
    migration-report-template.md
```

---

### 21.2 CI Pipeline

```text
Stage 1: build app
Stage 2: validate migration filenames
Stage 3: detect modified applied migrations
Stage 4: run migration on clean DB
Stage 5: run migration on previous-release DB snapshot
Stage 6: run seed validation
Stage 7: run app integration tests
Stage 8: generate migration report
Stage 9: package migration artifact
Stage 10: publish artifact
```

---

### 21.3 CD Pipeline

```text
Stage 1: select immutable artifact
Stage 2: preflight target DB
Stage 3: backup/snapshot gate
Stage 4: run migration job
Stage 5: run post-migration validation
Stage 6: deploy app
Stage 7: smoke test
Stage 8: monitor
Stage 9: publish execution report
```

---

### 21.4 Kubernetes Migration Job Pattern

Conceptual example:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: case-service-db-migration-20260203
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: registry.example.com/case-service-db-migration:2026.02.03-145
          env:
            - name: DB_URL
              valueFrom:
                secretKeyRef:
                  name: case-service-db
                  key: url
            - name: DB_USER
              valueFrom:
                secretKeyRef:
                  name: case-service-db
                  key: migration-user
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: case-service-db
                  key: migration-password
```

Important policies:

```text
- backoffLimit 0 or controlled retry for unsafe migrations,
- migration job must finish before app rollout,
- logs retained,
- job image immutable,
- app pod should not also run migration in production.
```

---

## 22. Example Enterprise Standard

Ini contoh standar yang bisa dipakai team.

```text
Database Migration Standard v1.0

1. All database changes must be represented as versioned migration artifacts.
2. Applied migrations must not be edited.
3. Destructive changes require senior review and explicit approval.
4. Breaking changes must use expand/contract unless exception is approved.
5. Application rollback compatibility must be documented for every release.
6. Seeds must be deterministic, idempotent, and based on stable keys.
7. Test fixtures must not be deployed to production.
8. Migration user must be separate from application user in production.
9. Production migrations must run through approved pipeline or controlled DBA process.
10. Production execution must produce evidence report.
11. Failed migrations must follow incident runbook; direct manual repair must be documented.
12. Schema drift must be investigated before production deployment.
13. Large data migrations must be chunked, observable, and resumable.
14. Roll-forward is the default recovery model unless rollback is explicitly tested.
15. Clean/drop/reset operations are forbidden in production.
```

---

## 23. What Top 1% Engineers Do Differently

Top engineers do not merely know Flyway commands or Liquibase syntax.

They think in contracts, failure modes, and operational consequences.

### 23.1 They Ask Compatibility Questions

Before merging migration:

```text
Will old app still work?
Will new app work if migration is delayed?
Can rollback app still work?
Are downstream consumers affected?
```

---

### 23.2 They Separate Change Types

They do not mix everything into one script:

```text
create column + backfill 50M rows + add not null + drop old column
```

They split by phase:

```text
1. expand schema,
2. deploy compatible app,
3. backfill,
4. validate,
5. switch reads,
6. contract later.
```

---

### 23.3 They Treat Migration as Production Code

Migration must have:

- review,
- tests,
- naming,
- ownership,
- observability,
- recovery path.

---

### 23.4 They Avoid Rollback Fantasy

They do not say:

```text
If failed, rollback.
```

They say:

```text
If failed before commit, retry after resolving lock.
If failed after partial backfill, resume from checkpoint.
If app fails after additive schema, rollback app safely.
If destructive change fails, restore from backup or execute compensating migration.
```

---

### 23.5 They Know When Tool Abstraction Ends

They know:

- Oracle DDL commit behavior matters,
- PostgreSQL concurrent index has caveats,
- MySQL metadata locks can surprise,
- SQL Server online index availability depends on edition/config,
- H2 is not production DB,
- ORM auto-DDL is not migration governance.

---

## 24. Final Production Checklist

Use this before serious production migration.

```text
Architecture
[ ] Change type classified.
[ ] Owner identified.
[ ] Consumer impact reviewed.
[ ] App compatibility verified.
[ ] Expand/contract used for breaking change.

Migration Quality
[ ] Naming convention followed.
[ ] Migration deterministic.
[ ] Seed idempotent if applicable.
[ ] No hardcoded secret.
[ ] No accidental destructive command.
[ ] Large data changes chunked/resumable.

Testing
[ ] Clean DB migration test passed.
[ ] Previous release upgrade test passed.
[ ] Real DB engine used.
[ ] Validation queries passed.
[ ] Performance/lock impact reviewed for large changes.

Pipeline
[ ] Immutable artifact produced.
[ ] Migration report generated.
[ ] Drift check passed.
[ ] Approval gate passed.
[ ] Backup/snapshot ready if required.

Production Execution
[ ] Migration user available.
[ ] App user does not need DDL.
[ ] Monitoring ready.
[ ] On-call/DBA notified if needed.
[ ] Runbook ready.
[ ] Communication channel open.

Recovery
[ ] Rollback/roll-forward strategy documented.
[ ] App rollback compatibility known.
[ ] Failed migration runbook understood.
[ ] Manual intervention procedure documented.

Audit
[ ] Change ticket linked.
[ ] Git commit linked.
[ ] Reviewer recorded.
[ ] Execution report retained.
[ ] Post-flight validation retained.
```

---

## 25. Suggested Team Adoption Roadmap

Jika team belum matang, jangan langsung membangun semuanya. Naikkan maturity bertahap.

### Month 1 — Basic Control

```text
- pilih Flyway/Liquibase standard,
- semua migration masuk repo,
- larang edit applied migration,
- naming convention,
- local clean migrate,
- basic PR checklist.
```

### Month 2 — Testing Discipline

```text
- CI migration test,
- real DB via Testcontainers/container DB,
- previous-release upgrade test,
- seed validation,
- detect duplicate/modified migration.
```

### Month 3 — Production Safety

```text
- external migration job,
- immutable artifact,
- preflight checklist,
- backup gate,
- postflight validation,
- structured logs.
```

### Month 4 — Operational Maturity

```text
- dashboard,
- alerting,
- runbooks,
- failed migration drill,
- lock monitoring,
- drift detection.
```

### Month 5+ — Governance and Scale

```text
- multi-team ownership,
- tenant migration orchestration,
- policy-as-code,
- automated evidence report,
- migration maturity review.
```

---

## 26. Summary

Production-grade database migration platform bukan sekadar memilih Flyway atau Liquibase.

Flyway/Liquibase menjawab:

```text
How do we execute and track migrations?
```

Platform migration menjawab:

```text
How do we design, review, test, deploy, observe, audit, and recover database changes safely?
```

Inti dari seluruh seri ini:

```text
Database migration is controlled evolution of a production contract.
```

Untuk menjadi engineer level atas, fokuslah pada:

- compatibility,
- determinism,
- immutability,
- observability,
- recovery,
- auditability,
- ownership,
- operational realism.

Jika semua itu diterapkan, database migration berubah dari aktivitas menegangkan menjadi proses engineering yang bisa dipercaya.

---

## 27. Status Seri

Ini adalah **Part 33 dari 34** dalam seri:

```text
learn-java-database-migrations-seedings-flyway-liquibase
```

Dengan struktur Part 0 sampai Part 33, maka seri ini sudah mencapai bagian terakhir.

Seri ini selesai.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 32 — Case Studies: Realistic Production Scenarios](./32-case-studies-production-scenarios.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: 00 — MyBatis Orientation: SQL-First Persistence Mental Model](../mybatis/00-mybatis-orientation-sql-first-persistence-mental-model.md)

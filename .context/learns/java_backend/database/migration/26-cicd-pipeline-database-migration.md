# 26 — CI/CD Pipeline for Database Migration

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Part: 26 dari 34  
> Topik: CI/CD pipeline untuk database migration pada sistem Java 8–25, Flyway, Liquibase, Spring Boot, Jakarta EE, Kubernetes, dan enterprise production release.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu merancang pipeline database migration yang bukan hanya “menjalankan Flyway/Liquibase”, tetapi menjadi sistem kendali perubahan database yang:

1. **deterministik** — hasil migration dapat diprediksi di semua environment;
2. **repeatable** — pipeline bisa dijalankan ulang tanpa menghasilkan state liar;
3. **auditable** — siapa, apa, kapan, dari artifact mana, dan approval mana bisa dilacak;
4. **safe-by-default** — destructive operation, long lock, checksum mismatch, dan drift tidak lolos diam-diam;
5. **compatible dengan deployment aplikasi** — schema dan kode dirilis dengan urutan yang aman;
6. **recoverable** — saat gagal, tim tahu apakah retry, repair, restore, rollback code, atau roll-forward database;
7. **scalable untuk banyak service/module/team** — migration ownership tidak berubah menjadi chaos.

Bagian ini tidak mengulang cara setup Flyway/Liquibase, karena sudah dibahas sebelumnya. Fokus kita adalah **pipeline architecture** dan **operational control**.

---

## 2. Mental Model: Database Migration Bukan Step, Tetapi Release System

Kesalahan umum adalah menganggap database migration sebagai satu command di pipeline:

```bash
flyway migrate
# or
liquibase update
```

Itu terlalu sempit.

Dalam production-grade system, migration adalah sub-sistem release yang terdiri dari:

```text
Source control
  -> migration artifact build
  -> static validation
  -> real DB validation
  -> drift detection
  -> generated SQL/dry-run review
  -> deployment ordering decision
  -> backup/snapshot gate
  -> exclusive execution/locking
  -> observability
  -> post-migration verification
  -> application rollout
  -> rollback/roll-forward decision
  -> audit evidence
```

Artinya, migration pipeline harus menjawab pertanyaan berikut:

| Pertanyaan | Mengapa penting |
|---|---|
| Migration mana yang akan dijalankan? | Mencegah file tak sengaja ikut rilis. |
| Artifact mana yang membawa migration itu? | Mencegah “script lokal” berbeda dari artifact CI. |
| Apakah target DB sudah dalam state yang diharapkan? | Mencegah drift dan missing baseline. |
| Apakah SQL yang akan dijalankan aman? | Mencegah destructive/locking operation tak terlihat. |
| Siapa yang approve? | Governance dan auditability. |
| Apakah migration kompatibel dengan app versi lama dan baru? | Zero-downtime release. |
| Jika gagal di tengah, apa recovery path? | Mengurangi panic-driven manual fix. |

Top engineer tidak melihat migration sebagai “file SQL”. Ia melihat migration sebagai **state transition terhadap asset paling sulit di-rollback: database production**.

---

## 3. Prinsip Dasar Pipeline Migration

### 3.1 Migration Harus Menjadi Artifact, Bukan Efek Samping Repository

Anti-pattern:

```text
Pipeline checkout repo latest branch
Pipeline run whatever migration files exist at that moment
```

Masalah:

- file bisa berubah antara build dan deploy;
- hotfix branch bisa membawa migration yang tidak dimaksud;
- tidak ada artifact immutability;
- sulit membuktikan migration mana yang benar-benar dirilis.

Better model:

```text
Commit SHA
  -> build migration artifact
  -> assign build version
  -> archive artifact
  -> promote same artifact across environments
```

Artifact bisa berupa:

- application JAR yang berisi `db/migration`;
- dedicated migration JAR;
- Docker image migration runner;
- tar/zip migration bundle;
- Liquibase changelog package;
- Flyway SQL migration package.

Rule penting:

> Production harus menjalankan migration dari artifact yang sama yang sudah melewati lower environment, bukan dari working tree baru.

---

### 3.2 Pipeline Harus Memisahkan Validate dan Execute

Jangan langsung migrate tanpa tahap validasi.

Minimal pipeline:

```text
validate -> dry-run/plan -> approve -> migrate -> verify
```

Maknanya:

- `validate`: memastikan metadata migration konsisten;
- `dry-run/plan`: melihat perubahan yang akan terjadi;
- `approve`: human/automated gate berdasarkan risiko;
- `migrate`: eksekusi aktual;
- `verify`: validasi schema/data/app contract setelah migration.

Flyway dan Liquibase punya kemampuan berbeda, tetapi konsep ini tetap sama.

---

### 3.3 Migration Execution Harus Single-Writer

Walaupun database mendukung banyak koneksi, migration tidak boleh dieksekusi oleh banyak runner bersamaan.

Risiko concurrent migration:

- dua pod Spring Boot start bersamaan dan sama-sama mencoba migrate;
- dua pipeline environment trigger overlap;
- hotfix dan normal release berjalan berdekatan;
- Kubernetes restart menyebabkan migration command retry tanpa koordinasi;
- manual DBA script berjalan paralel dengan automated migration.

Maka pipeline harus punya:

- migration lock;
- deployment lock;
- environment lock;
- release window lock;
- atau orchestration yang menjamin hanya satu migration writer.

Flyway dan Liquibase memiliki locking/history mechanism masing-masing, tetapi pipeline tetap harus mencegah overlap dari level deployment.

---

### 3.4 Migration Harus Precede App When Expanding, Follow App When Contracting

Untuk zero-downtime:

```text
Expand migration -> deploy compatible app -> backfill/read switch -> contract migration later
```

Pipeline tidak boleh menganggap semua migration dijalankan di waktu yang sama relatif terhadap aplikasi.

Contoh:

- menambah nullable column: bisa sebelum app deploy;
- drop column lama: harus setelah semua app tidak lagi memakai column itu;
- add constraint: setelah data bersih;
- create index: sebelum query baru dipakai;
- remove seed role: setelah feature/security rule tidak membutuhkannya.

Maka pipeline perlu mengenali kategori migration:

| Kategori | Kapan dijalankan |
|---|---|
| Pre-deploy expand | Sebelum app baru |
| App deploy | Rollout aplikasi |
| Post-deploy data/backfill | Setelah app compatible |
| Contract cleanup | Release berikutnya atau setelah observasi |
| Emergency fix | Berdasarkan incident workflow |

---

## 4. Reference Architecture Pipeline

Berikut bentuk umum pipeline migration enterprise.

```text
Developer commit
   |
   v
Static checks
   - naming convention
   - checksum/history rule
   - forbidden SQL lint
   - style validation
   |
   v
Build migration artifact
   - immutable artifact
   - version metadata
   - commit SHA
   |
   v
Ephemeral DB migration test
   - fresh DB
   - previous-release DB
   - seed verification
   - app contract smoke test
   |
   v
Dry-run / generated SQL / migration plan
   - SQL output
   - object diff
   - risk classification
   |
   v
Environment promotion
   - DEV
   - SIT
   - UAT
   - STAGING
   - PROD
   |
   v
Pre-production gates
   - backup/snapshot
   - approval
   - lock/window check
   - drift check
   - active session/lock check
   |
   v
Production migration execution
   - single runner
   - structured logs
   - timeout/lock settings
   - metrics
   |
   v
Post verification
   - migration history
   - object exists
   - constraints/indexes
   - seed state
   - app health
   |
   v
Application rollout / continuation
```

Yang penting bukan tools spesifiknya, tetapi **separation of concerns**:

- developer menulis migration;
- CI memvalidasi migration;
- artifact repository membekukan migration;
- CD mempromosikan artifact;
- production gate mengendalikan risiko;
- observability membuktikan hasil;
- runbook menangani kegagalan.

---

## 5. Repository Layout untuk Migration Pipeline

### 5.1 Migration Embedded dalam Application Repository

Contoh Spring Boot/Flyway:

```text
my-service/
  src/main/java/
  src/main/resources/
    db/migration/
      V2026.06.17.001__create_case_table.sql
      V2026.06.17.002__add_case_status_index.sql
    db/callback/
  pom.xml
```

Kelebihan:

- schema contract dekat dengan kode aplikasi;
- code review mudah;
- developer ownership jelas;
- cocok untuk service-owned schema.

Kekurangan:

- app startup migration bisa menggoda;
- shared DB lebih sulit;
- artifact aplikasi dan artifact migration sulit dipisah jika pipeline belum matang.

---

### 5.2 Dedicated Migration Module dalam Monorepo

```text
platform/
  services/
    case-service/
    appeal-service/
  database/
    case-schema/
      flyway.conf
      sql/
    compliance-schema/
      changelog.yaml
  build.gradle
```

Kelebihan:

- database release bisa dikontrol terpisah;
- bagus untuk multi-module enterprise;
- bisa build migration artifact khusus.

Kekurangan:

- ownership harus jelas;
- risiko migration terpisah dari code contract;
- butuh discipline untuk cross-module review.

---

### 5.3 Dedicated Database Repository

```text
database-change-repo/
  schemas/
    aceas_case/
    aceas_compliance/
  releases/
    2026-Q2-R1/
  environments/
    dev/
    uat/
    prod/
```

Cocok bila:

- DB dikelola DBA/platform team;
- banyak aplikasi berbagi database;
- regulatory control ketat;
- deployment database harus punya approval terpisah.

Risiko:

- database change bisa jauh dari application code;
- cycle time lambat;
- developer kehilangan sense of ownership.

Top-tier approach biasanya bukan memilih dogmatis, tetapi memilih berdasarkan **ownership boundary**.

---

## 6. Static Validation Stage

Static validation berjalan tanpa koneksi ke production DB. Tujuannya menangkap kesalahan murah sedini mungkin.

### 6.1 Naming Convention Check

Contoh rule:

```text
VYYYY.MM.DD.NNN__short_description.sql
```

Valid:

```text
V2026.06.17.001__create_case_assignment_table.sql
V2026.06.17.002__add_idx_case_assignment_officer.sql
```

Tidak ideal:

```text
V1__test.sql
V2__fix.sql
V3__new_changes.sql
V20260617__misc.sql
```

Kenapa naming penting?

- membantu review;
- membantu audit;
- mengurangi conflict antar branch;
- membuat release note lebih mudah;
- migration history lebih meaningful.

---

### 6.2 Forbidden SQL Pattern Check

Pipeline bisa melakukan scan sederhana terhadap migration SQL.

Contoh pattern yang perlu gate khusus:

```text
DROP TABLE
DROP COLUMN
TRUNCATE
DELETE FROM <table> without WHERE
UPDATE <table> without WHERE
ALTER TABLE ... NOT NULL
ALTER TABLE ... RENAME
ALTER TABLE ... MODIFY datatype
CREATE INDEX without ONLINE/CONCURRENTLY where applicable
```

Bukan berarti semua dilarang. Maksudnya:

> SQL berisiko tinggi harus memicu review/gate khusus.

Contoh shell sederhana:

```bash
#!/usr/bin/env bash
set -euo pipefail

FAILED=0

for file in src/main/resources/db/migration/*.sql; do
  if grep -Eiq '\b(drop\s+table|truncate\s+table|drop\s+column)\b' "$file"; then
    echo "High-risk destructive SQL detected in $file"
    FAILED=1
  fi

  if grep -Eiq '^\s*delete\s+from\s+[a-zA-Z0-9_]+\s*;' "$file"; then
    echo "DELETE without WHERE detected in $file"
    FAILED=1
  fi

  if grep -Eiq '^\s*update\s+[a-zA-Z0-9_]+\s+set\s+' "$file" \
     && ! grep -Eiq '\bwhere\b' "$file"; then
    echo "Potential UPDATE without WHERE detected in $file"
    FAILED=1
  fi
done

exit "$FAILED"
```

Ini bukan pengganti reviewer, tetapi guardrail awal.

---

### 6.3 Placeholder and Environment Variable Check

Migration tidak boleh diam-diam mengandung nilai environment-specific tanpa kontrol.

Danger:

```sql
INSERT INTO external_endpoint_config(name, url)
VALUES ('PAYMENT_API', 'https://prod-payment.example.com');
```

Better:

```sql
INSERT INTO external_endpoint_config(name, url)
VALUES ('PAYMENT_API', '${payment_api_url}');
```

Namun placeholder juga berbahaya bila tidak dikontrol.

Pipeline harus memastikan:

- placeholder wajib tersedia;
- placeholder tidak kosong;
- placeholder prod tidak tertukar dengan UAT;
- secret tidak dicetak di log;
- generated SQL tidak membocorkan secret.

---

### 6.4 Checksum and Edited Migration Rule

Rule fundamental:

> Migration yang sudah pernah dijalankan di shared environment tidak boleh diedit sembarangan.

CI dapat mendeteksi perubahan file migration lama dengan membandingkan terhadap main branch atau release branch.

Contoh rule:

| Kondisi | Action |
|---|---|
| Migration baru | boleh |
| Migration lama belum pernah release ke shared env | boleh dengan review |
| Migration lama sudah di DEV/SIT | butuh alasan kuat |
| Migration lama sudah di UAT/PROD | jangan edit; buat migration baru |

Kenapa?

Karena Flyway/Liquibase checksum mismatch bukan sekadar error teknis. Itu sinyal bahwa history yang sudah tercatat tidak lagi cocok dengan source artifact.

---

## 7. Real Database Validation Stage

Static check tidak cukup. Migration harus dijalankan terhadap database engine nyata.

### 7.1 Fresh Database Test

Tujuan:

> Membuktikan semua migration dari kosong sampai current version bisa membangun schema lengkap.

Pipeline:

```text
start database container
run all migrations
run schema smoke test
run seed verification
run app startup smoke test
```

Contoh dengan Maven + Flyway:

```bash
mvn -B test \
  -Dspring.profiles.active=migration-test
```

Atau dedicated command:

```bash
flyway \
  -url="$TEST_DB_URL" \
  -user="$TEST_DB_USER" \
  -password="$TEST_DB_PASSWORD" \
  migrate
```

Kelemahan fresh DB test:

- tidak membuktikan upgrade dari production-like state;
- tidak menangkap data lama yang melanggar constraint baru;
- tidak menangkap volume/performance issue.

---

### 7.2 Previous Release Upgrade Test

Ini lebih penting untuk production.

Pipeline:

```text
restore previous release schema/data snapshot
run current migration
run compatibility tests
```

Tujuan:

- membuktikan upgrade path dari versi yang benar-benar ada;
- menangkap migration yang hanya berhasil di fresh DB;
- menangkap data existing yang tidak cocok dengan constraint baru;
- menguji backfill pada bentuk data lama.

Contoh:

```text
Release R10 DB snapshot
  -> apply R11 migrations
  -> verify R11 app contract
```

Ini wajib untuk sistem serius.

Fresh DB test menjawab:

> “Apakah schema bisa dibuat dari kosong?”

Previous-release test menjawab:

> “Apakah customer production bisa di-upgrade?”

Production lebih peduli yang kedua.

---

### 7.3 Real Engine, Not H2 Illusion

Untuk migration, H2 sering terlalu permisif atau berbeda dari production DB.

Masalah H2:

- DDL behavior berbeda;
- locking berbeda;
- index behavior berbeda;
- data type berbeda;
- sequence/identity berbeda;
- transaction DDL berbeda;
- function/operator berbeda;
- constraint validation berbeda.

Gunakan Testcontainers atau ephemeral real database:

- PostgreSQL container untuk PostgreSQL production;
- MySQL/MariaDB container untuk MySQL/MariaDB production;
- SQL Server container untuk SQL Server production;
- Oracle Free/Express container untuk Oracle-oriented tests jika feasible.

Rule:

> H2 boleh untuk unit-level convenience, tetapi jangan menjadi authority untuk migration correctness.

---

## 8. Flyway Pipeline Pattern

### 8.1 Basic Flyway CI Flow

```text
flyway info
flyway validate
flyway migrate on ephemeral DB
flyway info after migration
```

Contoh:

```bash
flyway \
  -url="$DB_URL" \
  -user="$DB_USER" \
  -password="$DB_PASSWORD" \
  -locations="filesystem:src/main/resources/db/migration" \
  validate

flyway \
  -url="$DB_URL" \
  -user="$DB_USER" \
  -password="$DB_PASSWORD" \
  -locations="filesystem:src/main/resources/db/migration" \
  migrate

flyway \
  -url="$DB_URL" \
  -user="$DB_USER" \
  -password="$DB_PASSWORD" \
  info
```

---

### 8.2 Flyway Validate Gate

`validate` harus menjadi gate sebelum execution.

Menangkap:

- checksum mismatch;
- missing migration;
- applied migration not resolved locally;
- failed migration state;
- naming/ordering inconsistency tertentu;
- repeatable migration checksum change.

Namun `validate` tidak menjamin SQL aman secara operational. Ia hanya menjamin konsistensi Flyway metadata.

Maka `validate` harus dipasangkan dengan:

- SQL lint;
- dry-run/review;
- target DB drift check;
- performance/lock analysis;
- approval untuk high-risk SQL.

---

### 8.3 Flyway Migration Artifact Image

Salah satu pattern kuat di Kubernetes:

```Dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY flyway/ /flyway/
COPY db/migration/ /app/db/migration/
COPY scripts/run-flyway.sh /app/run-flyway.sh
ENTRYPOINT ["/app/run-flyway.sh"]
```

Atau memakai official Flyway image dengan migration mounted/copied.

Run script:

```bash
#!/usr/bin/env bash
set -euo pipefail

flyway \
  -url="$DB_URL" \
  -user="$DB_MIGRATION_USER" \
  -password="$DB_MIGRATION_PASSWORD" \
  -locations="filesystem:/app/db/migration" \
  -connectRetries=10 \
  -validateMigrationNaming=true \
  migrate
```

Kelebihan dedicated image:

- migration artifact immutable;
- app pod tidak perlu privilege migration;
- migration bisa dijalankan sebagai Kubernetes Job;
- logs terpisah;
- easier audit.

---

## 9. Liquibase Pipeline Pattern

### 9.1 Basic Liquibase CI Flow

```text
liquibase validate
liquibase status
liquibase updateSQL
liquibase update on ephemeral DB
liquibase history
```

Contoh:

```bash
liquibase \
  --url="$DB_URL" \
  --username="$DB_USER" \
  --password="$DB_PASSWORD" \
  --changeLogFile="db/changelog/db.changelog-master.yaml" \
  validate

liquibase \
  --url="$DB_URL" \
  --username="$DB_USER" \
  --password="$DB_PASSWORD" \
  --changeLogFile="db/changelog/db.changelog-master.yaml" \
  status

liquibase \
  --url="$DB_URL" \
  --username="$DB_USER" \
  --password="$DB_PASSWORD" \
  --changeLogFile="db/changelog/db.changelog-master.yaml" \
  updateSQL > build/liquibase/update.sql
```

`updateSQL` sangat berguna untuk review karena menghasilkan SQL yang akan dijalankan.

---

### 9.2 Liquibase Context and Label Gates

Liquibase context/label bisa membantu pipeline memilih changeset.

Contoh:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-17-001
      author: fajar
      context: prod
      labels: release-2026-q2-r1
      changes:
        - addColumn:
            tableName: case_record
            columns:
              - column:
                  name: risk_score
                  type: number(5,2)
```

Pipeline:

```bash
liquibase \
  --contexts=prod \
  --labels=release-2026-q2-r1 \
  update
```

Guardrail:

- context bukan tempat menaruh banyak branch logic sembarangan;
- label harus sesuai release plan;
- pipeline harus mencetak context/label yang dipakai;
- reviewer harus tahu changeset mana yang include/exclude.

---

## 10. Dry-Run, Plan, dan SQL Review

### 10.1 Mengapa Dry-Run Penting

Migration file tidak selalu sama dengan SQL final.

Alasannya:

- placeholder substitution;
- Liquibase declarative changes menghasilkan vendor-specific SQL;
- contexts/labels memfilter changeset;
- callbacks bisa mengubah session;
- default schema/search path bisa memengaruhi object target;
- generated SQL tergantung DB engine.

Dry-run membantu menjawab:

```text
Apa tepatnya yang akan dijalankan di target environment?
```

---

### 10.2 Review Artifact

Pipeline harus menyimpan:

```text
build/reports/database-migration/
  migration-plan.txt
  update.sql
  flyway-info-before.txt
  flyway-info-after.txt
  liquibase-status.txt
  risk-classification.txt
  approval-record.json
```

Contoh risk classification:

```text
Migration Risk Report
=====================

Artifact: case-service-db-migration:2026.06.17.42
Commit: a1b2c3d4
Target: UAT

Detected changes:
- CREATE TABLE: 1
- ALTER TABLE ADD COLUMN: 2
- CREATE INDEX: 1
- DROP: 0
- TRUNCATE: 0
- Data update: 1

Risk level: MEDIUM
Reason:
- Data update detected
- Index creation on CASE_RECORD expected to affect large table

Required approval:
- Tech Lead
- DBA for UAT/PROD
```

---

## 11. Drift Detection

### 11.1 Apa Itu Drift?

Drift adalah kondisi ketika database target tidak lagi cocok dengan migration history/source of truth.

Contoh:

- DBA menambah index manual di production;
- hotfix SQL dijalankan langsung tanpa migration file;
- migration history table diubah manual;
- column diubah di UAT tetapi tidak di source repo;
- seed data diubah manual;
- stored procedure di production berbeda dari repeatable migration.

Drift membuat pipeline berbahaya karena pipeline mengira target DB berada di state A, padahal sebenarnya state B.

---

### 11.2 Level Drift

| Level | Contoh | Risiko |
|---|---|---|
| Metadata drift | History table tidak sesuai source | Migration bisa gagal atau salah urutan |
| Schema drift | Object DB berbeda dari expected | App bisa error runtime |
| Data drift | Seed/reference data berbeda | Behaviour aplikasi beda antar env |
| Permission drift | Role/privilege beda | Migration/app gagal hanya di prod |
| Performance drift | Index/statistics beda | Migration/query lambat |

---

### 11.3 Drift Detection Tactics

Minimal:

- Flyway `validate`;
- Liquibase `validate`/`status`;
- compare expected object existence;
- query migration history table;
- seed verification queries.

Advanced:

- schema diff tool;
- generated snapshot comparison;
- metadata export comparison;
- checksum for stored procedures/views;
- DBA-managed baseline report;
- environment drift dashboard.

Contoh seed verification query:

```sql
SELECT code, name, active
FROM ref_case_status
ORDER BY code;
```

Expected output disimpan sebagai controlled artifact, bukan ditebak manual.

---

## 12. Environment Promotion Model

### 12.1 Promote Artifact, Not Rebuild

Bad:

```text
DEV build from commit A
UAT rebuild from branch main later
PROD rebuild from main even later
```

Better:

```text
Build once -> artifact v42
DEV uses v42
SIT uses v42
UAT uses v42
PROD uses v42
```

Kenapa?

- memastikan yang dites sama dengan yang diprod;
- mengurangi “works in UAT but prod got different file”;
- audit lebih mudah;
- rollback artifact lebih jelas.

---

### 12.2 Promotion Gates

Contoh promotion matrix:

| Stage | Gate |
|---|---|
| DEV | compile, validate, fresh DB migration |
| SIT | integration test, previous-release upgrade |
| UAT | generated SQL review, business smoke test |
| Staging | prod-like volume/performance check |
| PROD | approval, backup, drift check, lock check, runbook ready |

---

## 13. Pre-Production Gates

Production migration sebaiknya tidak langsung berjalan hanya karena pipeline hijau.

### 13.1 Backup/Snapshot Gate

Untuk managed DB:

- verify automated backup active;
- create manual snapshot untuk high-risk change;
- validate recovery point objective;
- pastikan restore procedure diketahui;
- pastikan restore time acceptable.

Backup bukan rollback strategi utama untuk semua kasus, tetapi tetap penting sebagai last-resort recovery.

---

### 13.2 Active Session and Lock Gate

Sebelum migration besar:

- cek active long-running transaction;
- cek blocking session;
- cek replication lag;
- cek pending locks;
- cek batch job yang sedang berjalan;
- cek maintenance window.

Contoh PostgreSQL lock check:

```sql
SELECT pid, state, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY query_start;
```

Contoh Oracle session check:

```sql
SELECT sid, serial#, username, status, event, seconds_in_wait
FROM v$session
WHERE username IS NOT NULL
ORDER BY seconds_in_wait DESC;
```

---

### 13.3 Migration User Privilege Gate

Migration user sebaiknya berbeda dari app user.

| User | Privilege |
|---|---|
| App user | DML terbatas sesuai runtime need |
| Migration user | DDL/DML migration sesuai schema ownership |
| DBA/admin | Emergency/admin only |

Pipeline harus memastikan:

- credential migration user tidak tersedia di app runtime;
- secret tidak muncul di log;
- privilege cukup tapi tidak terlalu luas;
- prod credential hanya tersedia di prod deployment context.

---

## 14. Deployment Ordering Patterns

### 14.1 App Startup Migration Pattern

Aplikasi menjalankan migration saat start.

Kelebihan:

- sederhana;
- cocok untuk small app;
- developer friendly;
- local dev mudah.

Risiko:

- banyak pod start bersamaan;
- app user butuh privilege DDL;
- migration failure = app startup failure;
- sulit approval terpisah;
- sulit observability terpisah;
- deployment rollback bisa kacau bila DB sudah berubah.

Cocok untuk:

- internal small service;
- early-stage project;
- local/dev/test;
- non-critical app.

Kurang cocok untuk:

- regulated production;
- multi-pod Kubernetes;
- high availability service;
- migration berat/long-running.

---

### 14.2 Pre-Deploy Migration Job Pattern

Pipeline menjalankan migration sebelum app rollout.

```text
Run DB migration Job
  -> verify success
  -> deploy app
```

Kelebihan:

- clear separation;
- app tidak perlu DDL privilege;
- approval/log terpisah;
- cocok untuk Kubernetes Job;
- migration bisa dicegah sebelum app terganggu.

Risiko:

- schema baru harus backward-compatible dengan app lama;
- jika app deploy gagal, DB sudah terlanjur expand;
- butuh pipeline orchestration lebih matang.

Cocok untuk expand migration.

---

### 14.3 Post-Deploy Migration Pattern

Migration dijalankan setelah app deploy.

Cocok untuk:

- cleanup data after new app runs;
- contract phase;
- backfill yang bergantung pada app dual-write;
- async operational migration.

Risiko:

- app harus siap menghadapi old dan partial new state;
- pipeline harus memisahkan success app deploy dan success post migration;
- monitoring lebih penting.

---

### 14.4 Out-of-Band Migration Pattern

Migration dijalankan terpisah dari app release.

Cocok untuk:

- large backfill;
- index creation on huge table;
- data correction;
- partition maintenance;
- archival;
- long-running operational migration.

Dalam pattern ini, migration lebih mirip controlled operation dibanding release step biasa.

---

## 15. Kubernetes Migration Job Pattern

### 15.1 Basic Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: case-service-db-migration
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migration
          image: registry.example.com/case-service-db-migration:2026.06.17.42
          env:
            - name: DB_URL
              valueFrom:
                secretKeyRef:
                  name: case-db-migration-secret
                  key: url
            - name: DB_MIGRATION_USER
              valueFrom:
                secretKeyRef:
                  name: case-db-migration-secret
                  key: username
            - name: DB_MIGRATION_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: case-db-migration-secret
                  key: password
```

Important settings:

- `backoffLimit: 0` untuk menghindari retry buta pada destructive/partial failure;
- `restartPolicy: Never`;
- timeout/active deadline untuk menghindari job menggantung;
- logs harus dikirim ke centralized logging;
- secret khusus migration.

---

### 15.2 Avoid Migration in Every Pod

Bad pattern:

```text
Replica 1 starts -> runs migration
Replica 2 starts -> waits/tries migration
Replica 3 starts -> waits/tries migration
```

Walaupun Flyway/Liquibase punya lock, ini tetap tidak ideal.

Better:

```text
Migration Job succeeds -> Deployment rollout starts
```

Aplikasi tetap boleh punya `validate` ringan saat startup, tetapi bukan migration execution utama.

---

## 16. Rollback vs Roll-Forward in Pipeline

### 16.1 Code Rollback Tidak Sama dengan DB Rollback

Skenario umum:

```text
Migration success
App deploy fails
Team rollback app
```

Pertanyaan:

> Apakah old app masih kompatibel dengan new schema?

Jika migration adalah expand-compatible, old app masih bisa jalan.

Jika migration breaking, rollback app bisa gagal.

Karena itu pipeline harus enforce:

```text
No breaking DB migration in same release as app requiring rollback compatibility,
unless maintenance window/offline release is explicitly approved.
```

---

### 16.2 Roll-Forward Bias

Untuk production database, roll-forward sering lebih aman daripada rollback.

Rollback DB sulit karena:

- data baru sudah masuk;
- data lama sudah diubah;
- drop column menghapus informasi;
- constraint/index state berubah;
- external systems mungkin sudah melihat data baru;
- app/user action terjadi selama window.

Pipeline harus punya decision tree:

```text
Did migration fail before any change?
  -> fix config and retry

Did migration fail after transactional rollback?
  -> investigate and retry after fix

Did migration partially apply non-transactional DDL?
  -> manual recovery/repair/roll-forward

Did app fail after migration success?
  -> rollback app only if schema compatible
  -> otherwise roll-forward app fix or compatibility patch

Did data corruption occur?
  -> stop writes, assess restore/point-in-time recovery/data correction
```

---

## 17. Production Runbook Template

Setiap high-risk migration sebaiknya punya runbook.

```markdown
# Production DB Migration Runbook

## Release
- Service:
- Version:
- Migration artifact:
- Commit SHA:
- Target DB/schema:
- Window:

## Change Summary
- Schema changes:
- Data changes:
- Seed changes:
- Expected duration:
- Risk level:

## Compatibility
- Compatible with old app? yes/no
- Compatible with new app? yes/no
- Requires app deploy before/after? explain

## Pre-Checks
- Backup/snapshot verified:
- Drift validation passed:
- Active lock/session check passed:
- Required approvals:
- Monitoring dashboard ready:

## Execution
- Command/job:
- Operator:
- Expected logs:

## Verification
- Migration history query:
- Object verification:
- Data verification:
- App health check:
- Business smoke test:

## Failure Handling
- If validate fails:
- If lock timeout:
- If partial migration:
- If app deploy fails after migration:
- Escalation contact:

## Post-Deployment
- Evidence archived:
- Observed duration:
- Issues:
- Follow-up contract cleanup:
```

Runbook ini bukan bureaucracy. Ini cara membuat migration defensible.

---

## 18. Audit Evidence

Untuk regulated/enterprise environment, pipeline harus menyimpan evidence.

Minimal evidence:

- commit SHA;
- artifact version;
- migration files/changelog;
- generated SQL/dry-run;
- validation result;
- approval record;
- execution timestamp;
- executor identity;
- target DB/environment;
- before/after migration history;
- logs;
- verification result;
- incident/deviation jika ada.

Audit evidence harus immutable atau setidaknya sulit diubah tanpa jejak.

---

## 19. CI/CD Example: GitHub Actions + Flyway + Testcontainers Style

Contoh konseptual:

```yaml
name: database-migration-ci

on:
  pull_request:
    paths:
      - 'src/main/resources/db/migration/**'
      - 'pom.xml'

jobs:
  validate-migrations:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'

      - name: Check migration naming
        run: ./ci/check-migration-naming.sh

      - name: Check high-risk SQL
        run: ./ci/check-high-risk-sql.sh

      - name: Run migration tests
        run: mvn -B test -Dgroups=migration

      - name: Generate migration report
        run: ./ci/generate-migration-report.sh

      - name: Upload migration report
        uses: actions/upload-artifact@v4
        with:
          name: migration-report
          path: build/reports/database-migration
```

Catatan:

- contoh ini bukan satu-satunya bentuk;
- di enterprise bisa memakai Jenkins, GitLab CI, Azure DevOps, Argo CD, Tekton, atau internal orchestrator;
- prinsipnya tetap sama.

---

## 20. CI/CD Example: Liquibase updateSQL Review

```yaml
name: liquibase-migration-ci

on:
  pull_request:
    paths:
      - 'db/changelog/**'

jobs:
  liquibase-review:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: appdb
          POSTGRES_USER: app
          POSTGRES_PASSWORD: app
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Liquibase validate
        run: |
          liquibase \
            --url=jdbc:postgresql://localhost:5432/appdb \
            --username=app \
            --password=app \
            --changeLogFile=db/changelog/db.changelog-master.yaml \
            validate

      - name: Generate SQL preview
        run: |
          mkdir -p build/reports/liquibase
          liquibase \
            --url=jdbc:postgresql://localhost:5432/appdb \
            --username=app \
            --password=app \
            --changeLogFile=db/changelog/db.changelog-master.yaml \
            updateSQL > build/reports/liquibase/update.sql

      - name: Apply migration to ephemeral DB
        run: |
          liquibase \
            --url=jdbc:postgresql://localhost:5432/appdb \
            --username=app \
            --password=app \
            --changeLogFile=db/changelog/db.changelog-master.yaml \
            update

      - name: Upload SQL preview
        uses: actions/upload-artifact@v4
        with:
          name: liquibase-update-sql
          path: build/reports/liquibase/update.sql
```

---

## 21. Risk Classification Model

Pipeline harus bisa membedakan low-risk dan high-risk migration.

### 21.1 Low Risk

Biasanya:

- create new table not used yet;
- add nullable column;
- add non-unique index on small table;
- insert deterministic reference data;
- create view/function with no destructive effect.

Tetap perlu review, tetapi mungkin tidak butuh DBA approval khusus.

---

### 21.2 Medium Risk

Contoh:

- index on large table;
- backfill limited rows;
- add foreign key with existing data;
- add check constraint initially not validated;
- update reference data used by business logic;
- rename internal object with compatibility layer.

Butuh:

- generated SQL review;
- performance consideration;
- test on production-like data;
- rollback/roll-forward notes.

---

### 21.3 High Risk

Contoh:

- drop table/column;
- truncate;
- large update/delete;
- data type change on populated column;
- add NOT NULL without phased migration;
- add unique constraint on messy data;
- table rewrite operation;
- partition restructure;
- migration touching PII/encrypted data;
- migration involving external system consistency.

Butuh:

- explicit approval;
- backup/snapshot;
- maintenance window or zero-downtime plan;
- runbook;
- post-verification;
- rollback/roll-forward decision.

---

## 22. Pipeline Anti-Patterns

### 22.1 Running Migration from Developer Laptop

Bad:

```text
Developer connects VPN
Runs SQL manually on UAT/prod
Copies result into chat
```

Masalah:

- no artifact;
- no audit trail;
- secret exposure;
- inconsistent execution;
- sulit recovery;
- human error tinggi.

Emergency manual fix kadang tidak bisa dihindari, tetapi harus diikuti dengan **reconciliation migration** dan incident record.

---

### 22.2 Mixing ORM Auto-DDL and Migration Tool

Bad:

```properties
spring.jpa.hibernate.ddl-auto=update
spring.flyway.enabled=true
```

Masalah:

- schema berubah tanpa migration history;
- tool tidak lagi menjadi source of truth;
- production drift;
- rollback/review hilang.

Serious system harus memilih migration tool sebagai pengendali schema. ORM auto-DDL boleh untuk eksperimen lokal, bukan production governance.

---

### 22.3 Editing Old Migration to Fix Production

Bad:

```text
V12 already applied in UAT/PROD
Developer edits V12
Pipeline checksum mismatch
Someone runs repair
```

Ini merusak audit story.

Better:

```text
Create V13__fix_previous_case_constraint.sql
Explain why V12 needs corrective migration
```

`repair` bukan penghapus dosa. `repair` adalah operasi metadata yang harus punya alasan jelas.

---

### 22.4 Running All App Pods with Migration Enabled

Masalah:

- startup storm;
- lock contention;
- poor observability;
- unclear owner of failure;
- DDL privilege leaks into app runtime.

Better untuk production:

```text
Dedicated migration job -> app deployment
```

---

### 22.5 Treating UAT Success as Production Proof

UAT sering berbeda:

- volume data lebih kecil;
- index berbeda;
- stats berbeda;
- concurrent traffic tidak sama;
- privileges tidak sama;
- data quality lebih bersih/kotor secara berbeda;
- long-running transactions tidak ada.

Untuk high-risk migration, production-like validation harus lebih kuat daripada sekadar “UAT pass”.

---

## 23. Checklist Pull Request untuk Migration

Gunakan checklist ini dalam review.

```markdown
## Database Migration Review Checklist

### Classification
- [ ] Change type identified: schema/data/seed/backfill/contract
- [ ] Risk level identified: low/medium/high
- [ ] Target DB/vendor considered

### Compatibility
- [ ] Compatible with current app version
- [ ] Compatible with next app version
- [ ] Expand/contract phase identified if needed

### Safety
- [ ] No destructive operation without explicit plan
- [ ] No large unbounded update/delete
- [ ] Lock/performance impact considered
- [ ] Timeout strategy considered

### Determinism
- [ ] No environment-specific hardcoded value
- [ ] Seed is idempotent/deterministic
- [ ] No random/generated unstable value

### Testing
- [ ] Fresh DB migration tested
- [ ] Previous release upgrade tested
- [ ] Data verification query provided
- [ ] Roll-forward/rollback note provided

### Operations
- [ ] Runbook required? yes/no
- [ ] Approval required? yes/no
- [ ] Backup/snapshot required? yes/no
- [ ] Monitoring/verification defined
```

---

## 24. Practical Design: Pipeline Stages for Different Environments

### 24.1 DEV

DEV should be fast but not careless.

Recommended:

- automatic migration;
- allow clean/recreate only for disposable DB;
- quick validation;
- seed baseline;
- developer feedback.

Avoid:

- pretending DEV behavior equals PROD;
- manual schema changes without migration;
- sharing dirty DEV DB as authority.

---

### 24.2 SIT / Integration

Recommended:

- run migration artifact, not local scripts;
- run app integration tests;
- verify cross-service compatibility;
- check seed/reference data consistency;
- test previous-release upgrade when possible.

---

### 24.3 UAT

Recommended:

- use production-like release procedure;
- generated SQL review;
- business smoke test;
- approval simulation;
- runbook rehearsal for high-risk changes.

UAT should not only test business UI. It should rehearse release operations.

---

### 24.4 PROD

Recommended:

- immutable artifact;
- explicit approval;
- backup/snapshot gate;
- drift check;
- lock/session check;
- single migration runner;
- structured logs;
- post verification;
- incident decision tree.

---

## 25. Handling Hotfix Migrations

Hotfix migration is dangerous because it happens under pressure.

Rules:

1. Still create migration file/changelog.
2. Still build immutable artifact if possible.
3. Still validate against target state.
4. Still document approval, even if expedited.
5. After emergency manual SQL, create reconciliation migration.
6. Never let hotfix branch permanently diverge from main.

Hotfix flow:

```text
Incident identified
  -> classify DB fix needed
  -> create hotfix migration
  -> validate on restored/similar DB if possible
  -> approval
  -> execute
  -> verify
  -> merge back to main
  -> add postmortem action
```

---

## 26. Handling Failed Migration in Pipeline

### 26.1 Failure Before Execution

Examples:

- cannot connect;
- missing secret;
- validate fails;
- checksum mismatch;
- lock not acquired.

Action:

- do not force;
- inspect state;
- fix config/source/history issue;
- retry only after understanding.

---

### 26.2 Failure During Transactional Migration

If DB rolls back the migration fully:

- inspect error;
- fix migration by new version if already shared;
- rerun validation;
- retry.

---

### 26.3 Failure During Non-Transactional DDL

More dangerous.

Example:

```text
ALTER TABLE succeeded
CREATE INDEX failed
History table marks failed migration
```

Action:

- freeze further deployment;
- inspect actual DB state;
- decide repair vs corrective migration;
- avoid blind rerun;
- document manual action;
- verify history table.

---

### 26.4 Failure After Migration Success but App Failure

Decision:

- if schema backward-compatible: rollback app;
- if not: roll-forward app fix or compatibility patch;
- if data corruption: stop writes and assess recovery.

This is why expand/contract matters.

---

## 27. Metrics and Observability in Pipeline

Collect:

- migration start/end time;
- duration per script/changeset;
- rows affected where possible;
- lock wait time;
- retry count;
- target DB/environment;
- artifact version;
- status: success/failure;
- error code/message;
- migration history before/after.

Structured log example:

```json
{
  "event": "database_migration_completed",
  "service": "case-service",
  "environment": "prod",
  "artifact": "case-service-db-migration:2026.06.17.42",
  "commit": "a1b2c3d4",
  "tool": "flyway",
  "fromVersion": "2026.06.10.003",
  "toVersion": "2026.06.17.002",
  "durationMs": 18420,
  "status": "success"
}
```

---

## 28. Designing for Java 8–25 Reality

Pipeline harus sadar bahwa enterprise Java estate sering campur versi.

### 28.1 Java 8/11 Legacy

Concerns:

- modern Flyway/Liquibase version may not support older Java;
- old JDBC driver compatibility;
- old Maven/Gradle plugin behavior;
- TLS/certificate issue;
- old app server classloader issue.

Pattern:

- gunakan migration runner terpisah dengan Java version yang sesuai tool;
- jangan paksa app runtime Java 8 menjalankan tool modern jika tidak kompatibel;
- package migration sebagai external CLI/container.

---

### 28.2 Java 17/21/25 Modern

Concerns:

- stronger encapsulation/module issues for some old drivers/tools;
- container base image selection;
- compatibility dengan DB driver terbaru;
- platform engineering standard.

Pattern:

- standardize migration runner image;
- pin tool version;
- pin JDBC driver version;
- run real DB tests;
- maintain upgrade matrix.

---

## 29. Minimal Viable Production Pipeline

Jika tim belum matang, mulai dari ini:

```text
1. Migration files in source control
2. Naming convention check
3. Flyway/Liquibase validate in CI
4. Ephemeral real DB migration test
5. Immutable build artifact
6. Same artifact promoted to UAT/PROD
7. Production migration via dedicated job/step
8. Backup/snapshot gate for medium/high risk
9. Post-migration verification query
10. No editing old applied migrations
```

Ini sudah jauh lebih baik daripada migration manual.

---

## 30. Mature Production Pipeline

Untuk high-maturity system:

```text
- Static SQL risk analyzer
- Real previous-release upgrade test
- Production-like volume test for high-risk migration
- Generated SQL/dry-run artifact
- Automated drift detection
- Approval workflow integrated with change management
- Dedicated migration runner image
- Separate migration user
- Kubernetes Job orchestration
- Structured migration telemetry
- Immutable audit evidence
- Roll-forward playbooks
- Multi-service release choreography
- Contract cleanup tracking
```

---

## 31. Decision Framework: Migration at Startup or Pipeline?

| Question | Startup migration okay? | Dedicated pipeline/job better? |
|---|---:|---:|
| Small internal app | Yes | Optional |
| Single instance | Yes | Optional |
| Multi-pod Kubernetes | Risky | Yes |
| Regulated environment | Weak | Yes |
| Separate DBA approval | No | Yes |
| Large backfill | No | Yes |
| DDL privilege should not be in app | No | Yes |
| Need audit evidence | Weak | Yes |
| Need zero-downtime choreography | Weak | Yes |

General rule:

> The more production-critical the database, the less migration should be hidden inside app startup.

---

## 32. End-to-End Example Scenario

Case:

> Add `risk_score` to `case_record`, backfill from existing case attributes, and deploy new app that reads it.

Bad plan:

```text
ALTER TABLE add NOT NULL risk_score
UPDATE all rows in one transaction
Deploy app
```

Better pipeline-aware plan:

### Release A — Expand

Migration:

```sql
ALTER TABLE case_record ADD risk_score NUMBER(5,2);
```

Pipeline:

- low/medium risk;
- fresh DB test;
- previous-release upgrade test;
- deploy before app;
- old app still works.

### Release B — App Dual Logic

App:

- writes `risk_score` for new/updated cases;
- reads fallback if null;
- exposes metric for null count.

### Release C — Backfill

Backfill job:

- chunked by primary key;
- resumable;
- throttled;
- observable;
- not necessarily Flyway migration if very large.

Verification:

```sql
SELECT COUNT(*)
FROM case_record
WHERE risk_score IS NULL;
```

### Release D — Contract

After null count zero and app no longer fallback:

```sql
ALTER TABLE case_record MODIFY risk_score NOT NULL;
```

Possibly add index/constraint as separate migration.

This is how migration pipeline and application release choreography work together.

---

## 33. What Top 1% Engineers Pay Attention To

Top engineers do not only ask:

> “Does the migration run?”

They ask:

1. What state does DB start from?
2. What state does DB end in?
3. Is the transition compatible with running application versions?
4. Is it safe under real traffic?
5. What locks can occur?
6. What if migration fails halfway?
7. What if app deploy fails after DB migration succeeds?
8. Can we prove what changed?
9. Can we replay this in lower environment?
10. Can we detect drift before production?
11. Can we recover without guessing?
12. Is this operation reversible, or do we need roll-forward?
13. Does the pipeline enforce the rule or rely on memory?

The last question is crucial.

A rule that lives only in people’s heads is not a reliable production control.

---

## 34. Summary

CI/CD untuk database migration bukan sekadar command `migrate` di pipeline.

Pipeline yang matang harus mengontrol:

- artifact immutability;
- validation;
- dry-run review;
- drift detection;
- environment promotion;
- backup/approval gates;
- deployment ordering;
- execution locking;
- observability;
- verification;
- rollback/roll-forward decision;
- audit evidence.

Flyway dan Liquibase menyediakan mekanisme penting seperti migration history, checksum, validate, status, changelog, dan lock table. Namun production safety datang dari kombinasi antara **tooling, pipeline design, release choreography, database knowledge, dan operational discipline**.

Prinsip terakhir:

> Migration yang baik bukan hanya berhasil dijalankan. Migration yang baik bisa dijelaskan, diuji, diaudit, diamati, dan dipulihkan.

---

## 35. Checklist Penguasaan Part 26

Kamu dianggap menguasai bagian ini jika bisa menjawab:

- Mengapa migration harus diperlakukan sebagai artifact?
- Apa bedanya validate, dry-run, migrate, dan verify?
- Mengapa fresh DB test tidak cukup untuk production?
- Bagaimana previous-release upgrade test bekerja?
- Kapan migration boleh dijalankan saat app startup?
- Mengapa Kubernetes production lebih cocok memakai dedicated migration Job?
- Apa itu drift dan bagaimana mendeteksinya?
- Apa saja pre-production gates untuk migration high-risk?
- Mengapa code rollback tidak sama dengan DB rollback?
- Bagaimana membangun runbook migration?
- Bagaimana membedakan low/medium/high-risk migration?
- Bagaimana memastikan audit evidence tersedia?

---

## 36. Posisi dalam Seri

Kita sudah menyelesaikan:

- Part 0 — Orientation: Database Change as Engineering Discipline
- Part 1 — Taxonomy of Database Changes
- Part 2 — Migration Invariants and Failure Models
- Part 3 — Versioning Models for Database Schema
- Part 4 — Flyway Mental Model
- Part 5 — Flyway Setup in Java 8–25 Projects
- Part 6 — Flyway SQL Migration Design
- Part 7 — Flyway Repeatable Migrations
- Part 8 — Flyway Java-Based Migrations
- Part 9 — Flyway Callbacks and Lifecycle Hooks
- Part 10 — Flyway Baseline, Repair, Validate, Clean
- Part 11 — Liquibase Mental Model
- Part 12 — Liquibase Setup in Java 8–25 Projects
- Part 13 — Liquibase Changelog Design
- Part 14 — Liquibase Preconditions, Contexts, Labels
- Part 15 — Liquibase Rollback Engineering
- Part 16 — Flyway vs Liquibase: Decision Framework
- Part 17 — Seeding Strategy: Reference Data, Master Data, and Bootstrap Data
- Part 18 — Idempotent and Deterministic Seed Design
- Part 19 — Data Migration and Backfill Engineering
- Part 20 — Expand/Contract Pattern for Zero-Downtime Migration
- Part 21 — Database Locking, Transactions, and Online DDL
- Part 22 — Vendor-Specific Migration Engineering
- Part 23 — Migration Testing Strategy
- Part 24 — Migration in Spring Boot Applications
- Part 25 — Migration in Jakarta EE, Plain Java, and Non-Spring Systems
- Part 26 — CI/CD Pipeline for Database Migration

Seri belum selesai. Berikutnya:

**Part 27 — Multi-Service, Multi-Module, and Shared Database Migrations**

# Part 30 — Observability and Operational Runbooks

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `30-observability-operational-runbooks.md`  
**Scope:** Java 8–25, Flyway, Liquibase, Spring Boot, Jakarta EE, plain Java, CI/CD, production operations  
**Audience:** Senior/Staff-level Java engineer yang ingin memahami database migration sebagai production operation, bukan sekadar script deployment

---

## 0. Posisi Part Ini Dalam Seri

Di bagian sebelumnya kita sudah membahas:

- taxonomy database changes,
- invariants dan failure model,
- versioning,
- Flyway dan Liquibase,
- seeding,
- backfill,
- expand/contract,
- locking dan online DDL,
- vendor-specific behavior,
- testing,
- Spring Boot / Jakarta EE integration,
- CI/CD pipeline,
- multi-service,
- multi-tenant,
- security, compliance, dan auditability.

Part ini menjawab pertanyaan lanjutan yang sering diabaikan:

> Setelah migration kita desain dengan benar, bagaimana kita tahu migration itu sedang berjalan sehat, gagal secara aman, bisa diverifikasi, bisa diaudit, dan bisa dipulihkan ketika production deployment bermasalah?

Topik ini adalah perbedaan besar antara engineer yang hanya bisa menulis migration dan engineer yang bisa **mengoperasikan database change di production**.

---

## 1. Mental Model: Migration Is a Production Operation

Database migration bukan hanya bagian dari build. Ia adalah operasi production yang memodifikasi state paling kritis dalam sistem: database.

Code deployment biasanya bisa diganti dengan image/container baru. Database migration berbeda karena:

1. Ia mengubah shared mutable state.
2. Ia dapat memblokir transaksi aplikasi.
3. Ia dapat memicu lock escalation atau metadata lock.
4. Ia dapat memakan undo/redo/WAL/temp space.
5. Ia dapat membuat aplikasi lama tidak kompatibel.
6. Ia sering sulit di-rollback setelah data berubah.
7. Ia menghasilkan efek yang tetap ada meskipun proses deployment gagal.

Karena itu, migration perlu diperlakukan sebagai operasi dengan lifecycle:

```text
Plan
  -> Pre-flight check
  -> Execute
  -> Observe
  -> Verify
  -> Decide
  -> Communicate
  -> Recover if needed
  -> Close with evidence
```

Observability dan runbook adalah mekanisme agar lifecycle ini tidak bergantung pada feeling seseorang saat deployment.

---

## 2. Apa Itu Observability Untuk Database Migration?

Observability untuk migration adalah kemampuan menjawab pertanyaan berikut dengan cepat:

1. Migration mana yang sedang berjalan?
2. Migration dimulai kapan?
3. Siapa atau pipeline apa yang menjalankannya?
4. Database/schema/tenant mana yang menjadi target?
5. Berapa lama setiap step berjalan?
6. Apakah ada lock wait?
7. Apakah ada blocking session?
8. Berapa rows yang sudah diproses?
9. Apakah migration bisa dilanjutkan jika terputus?
10. Apakah migration berhasil secara teknis?
11. Apakah hasilnya benar secara domain?
12. Apakah aplikasi setelahnya kompatibel?
13. Apakah ada drift antara expected state dan actual state?
14. Apa keputusan jika migration lambat, gagal, atau partial?

Jika pertanyaan-pertanyaan ini tidak bisa dijawab dari log, metric, query, dan dashboard, berarti migration kita masih black box.

---

## 3. Tool Metadata Bukan Observability Lengkap

Flyway dan Liquibase memberi metadata dasar.

Flyway menggunakan schema history table sebagai audit trail perubahan schema. Redgate mendeskripsikan schema history table sebagai catatan lengkap dari perubahan yang dilakukan terhadap schema. Migration Flyway juga dipakai untuk menjalankan perubahan secara konsisten dalam urutan yang sama di environment berbeda.  

Liquibase menggunakan `DATABASECHANGELOG` untuk riwayat changeset dan `DATABASECHANGELOGLOCK` untuk memastikan hanya satu instance Liquibase yang berjalan pada satu waktu terhadap target database. Liquibase juga mendukung workflow portable lewat Flow Files untuk menjalankan perintah dalam CI/CD atau desktop developer.

Spring Boot Actuator juga menyediakan endpoint untuk menampilkan informasi migration Flyway/Liquibase ketika actuator dan endpoint terkait diaktifkan.

Namun metadata bawaan ini belum cukup untuk production observability. Ia menjawab sebagian pertanyaan:

- migration apa yang sudah dijalankan,
- checksum apa yang tercatat,
- siapa author/id changeset,
- apakah migration berhasil/gagal,
- kapan dieksekusi.

Tetapi ia biasanya tidak cukup menjawab:

- lock wait detail,
- blocking session,
- row progress per chunk,
- business validation result,
- deployment correlation id,
- backup snapshot id,
- approval ticket id,
- tenant rollout wave,
- application version compatibility,
- operator decision saat incident.

Maka kita perlu layer observability tambahan.

---

## 4. Observability Layers

Database migration sebaiknya diamati pada beberapa layer.

```text
┌────────────────────────────────────────────────────────────┐
│  Business / Domain Verification                            │
│  - counts, invariants, reconciliation, functional checks    │
├────────────────────────────────────────────────────────────┤
│  Application Compatibility                                 │
│  - app startup, health, feature behavior, API contract      │
├────────────────────────────────────────────────────────────┤
│  Migration Tool Layer                                      │
│  - Flyway/Liquibase history, checksum, lock, status         │
├────────────────────────────────────────────────────────────┤
│  Database Runtime Layer                                    │
│  - locks, waits, sessions, temp/undo/WAL, index progress    │
├────────────────────────────────────────────────────────────┤
│  Infrastructure / Pipeline Layer                           │
│  - job id, image id, commit, environment, timeout, logs     │
├────────────────────────────────────────────────────────────┤
│  Governance / Audit Layer                                  │
│  - approval, ticket, evidence, operator, incident record    │
└────────────────────────────────────────────────────────────┘
```

Engineer top-tier tidak hanya mengecek `flyway migrate success` atau `liquibase update success`. Ia mengecek apakah **seluruh sistem** masih memenuhi contract setelah perubahan state.

---

## 5. Migration Logs: Apa Yang Harus Ada

Log migration harus cukup untuk menjawab: siapa melakukan apa, terhadap target mana, dari artifact mana, dengan hasil apa.

Minimal field log:

| Field | Tujuan |
|---|---|
| `timestamp` | Urutan kejadian |
| `level` | INFO/WARN/ERROR |
| `environment` | dev/sit/uat/staging/prod |
| `service` | nama aplikasi/module |
| `database` | logical database name |
| `schema` | target schema |
| `tenant_id` | jika multi-tenant |
| `migration_tool` | flyway/liquibase/custom |
| `migration_version` | versi migration |
| `migration_name` | nama file/changeset |
| `migration_type` | DDL/DML/backfill/seed/repeatable |
| `artifact_version` | app/migration artifact version |
| `git_commit` | commit yang menghasilkan artifact |
| `pipeline_run_id` | CI/CD run id |
| `release_id` | release/ticket id |
| `correlation_id` | penghubung antar log |
| `duration_ms` | lama proses |
| `rows_affected` | jumlah row jika relevan |
| `status` | started/succeeded/failed/skipped |
| `error_code` | normalized error code |
| `error_message` | pesan error aman tanpa secret |

Contoh structured log:

```json
{
  "timestamp": "2026-06-17T09:15:20.123Z",
  "level": "INFO",
  "event": "database_migration_started",
  "environment": "prod",
  "service": "case-service",
  "database": "aceas_prod",
  "schema": "case_mgmt",
  "migration_tool": "flyway",
  "migration_version": "2026.06.17.001",
  "migration_name": "add_case_assignment_index",
  "migration_type": "DDL_INDEX",
  "artifact_version": "case-service-4.18.0",
  "git_commit": "8c02e81",
  "pipeline_run_id": "deploy-982113",
  "release_id": "CR-2026-0412",
  "correlation_id": "mig-prod-20260617-0001"
}
```

Contoh completion log:

```json
{
  "timestamp": "2026-06-17T09:16:04.889Z",
  "level": "INFO",
  "event": "database_migration_completed",
  "environment": "prod",
  "service": "case-service",
  "schema": "case_mgmt",
  "migration_tool": "flyway",
  "migration_version": "2026.06.17.001",
  "duration_ms": 44766,
  "rows_affected": 0,
  "status": "SUCCEEDED",
  "correlation_id": "mig-prod-20260617-0001"
}
```

---

## 6. Log Anti-Patterns

### 6.1 Log Tidak Menyebut Target Database

Buruk:

```text
Migration succeeded.
```

Lebih baik:

```text
Migration succeeded: env=prod database=aceas_prod schema=case_mgmt version=2026.06.17.001 duration=44s
```

Tanpa target, log tidak defensible.

### 6.2 Log Tidak Punya Correlation ID

Jika pipeline, application startup, migration job, database monitoring, dan incident channel tidak memiliki ID bersama, investigasi akan lambat.

Gunakan correlation id yang sama untuk:

- pipeline job,
- migration command,
- application deployment,
- health verification,
- notification,
- incident record.

### 6.3 Log Menyimpan Secret

Jangan pernah log:

- JDBC password,
- token,
- private key,
- full connection string dengan credential,
- PII sample dari row yang sedang dimigrasi.

Log harus cukup informatif tanpa membocorkan data sensitif.

### 6.4 Log Hanya Ada di Console CI/CD

Jika log hanya hidup di CI job dan hilang setelah retention pendek, audit dan incident review akan lemah.

Minimal log penting harus masuk ke log platform:

- CloudWatch,
- ELK/OpenSearch,
- Splunk,
- Datadog,
- Grafana Loki,
- atau centralized logging lain.

---

## 7. Metrics Yang Perlu Dikumpulkan

Metrics membuat kita tahu trend dan threshold.

### 7.1 Migration Execution Metrics

| Metric | Type | Arti |
|---|---|---|
| `db_migration_duration_seconds` | histogram | durasi migration |
| `db_migration_total` | counter | jumlah migration dijalankan |
| `db_migration_failed_total` | counter | jumlah gagal |
| `db_migration_rows_processed_total` | counter | rows diproses |
| `db_migration_current_version` | gauge/info | versi schema saat ini |
| `db_migration_pending_count` | gauge | migration belum jalan |
| `db_migration_lock_wait_seconds` | histogram | waktu menunggu lock |
| `db_migration_validation_failed_total` | counter | validation failure |
| `db_migration_repair_total` | counter | repair operation |
| `db_migration_rollback_total` | counter | rollback operation |

### 7.2 Database Runtime Metrics

| Metric | Risiko Yang Dideteksi |
|---|---|
| active sessions | migration menambah beban |
| blocked sessions | aplikasi terblokir migration |
| lock wait time | DDL/DML menunggu lock |
| deadlocks | konflik transaksi |
| CPU | migration query berat |
| I/O throughput | index build/backfill berat |
| temp usage | sort/hash besar |
| undo/rollback segment | transaksi besar |
| redo/WAL generation | write amplification |
| replication lag | migration membebani replica |
| connection pool saturation | aplikasi tidak bisa ambil koneksi |

### 7.3 Application Metrics Selama Migration

| Metric | Mengapa Penting |
|---|---|
| HTTP 5xx rate | migration mungkin memblokir request |
| latency p95/p99 | lock contention muncul sebagai latency |
| DB pool active/waiting | aplikasi menunggu koneksi |
| timeout count | query aplikasi terdampak |
| error rate per endpoint | module tertentu terdampak |
| consumer lag | batch/backfill mempengaruhi worker |
| health status | app startup setelah migration |

---

## 8. Metric Label Design

Metric harus punya label yang membantu slicing, tapi jangan terlalu cardinality tinggi.

Contoh label baik:

```text
environment="prod"
service="case-service"
database="aceas_prod"
schema="case_mgmt"
tool="flyway"
status="succeeded"
migration_type="ddl_index"
```

Label yang perlu hati-hati:

```text
migration_name="V202606170001__very_long_name.sql"
```

Boleh dipakai jika jumlah migration tidak terlalu tinggi dan retention dikelola.

Label yang buruk:

```text
sql_text="ALTER TABLE ..."
error_message="ORA-00054 resource busy and acquire with NOWAIT specified..."
tenant_id="tenant-123456789"
```

Alasan:

- cardinality terlalu tinggi,
- metric backend bisa mahal/lambat,
- error message membuat time series meledak,
- tenant id bisa sangat banyak.

Gunakan log untuk detail granular; gunakan metric untuk agregasi.

---

## 9. Tracing Untuk Migration

Tracing berguna jika migration adalah bagian dari deployment orchestration yang panjang.

Trace bisa punya span:

```text
release-deploy
  ├── preflight-check
  ├── backup-snapshot
  ├── flyway-validate
  ├── flyway-migrate
  │     ├── V202606170001__add_column
  │     ├── V202606170002__backfill_small_lookup
  │     └── V202606170003__add_index
  ├── application-deploy
  ├── smoke-test
  └── postflight-verification
```

Untuk Java, tracing bisa dilakukan dengan OpenTelemetry jika migration dijalankan dari aplikasi/custom runner. Untuk CLI-only migration, biasanya lebih realistis memakai structured log + pipeline timeline daripada distributed tracing penuh.

Prinsipnya:

- trace migration sebagai bagian dari release,
- jangan trace setiap row backfill,
- trace chunk-level jika backfill panjang,
- gunakan correlation id yang sama di log, metric, dan deployment record.

---

## 10. Dashboard Migration

Dashboard migration tidak harus cantik. Ia harus menjawab pertanyaan operasional.

### 10.1 Dashboard Overview

Panel yang berguna:

1. Current schema version per environment.
2. Pending migration count.
3. Last successful migration.
4. Last failed migration.
5. Duration p50/p95/p99 per migration type.
6. Migration failure count by service/module.
7. Migration history timeline.
8. Lock wait trend during migration window.
9. Application error/latency overlay.
10. Replication lag during migration.

### 10.2 Dashboard During Deployment

Saat deployment, operator butuh panel real-time:

```text
Release: CR-2026-0412
Environment: PROD
Migration status: RUNNING
Current step: V202606170003__add_case_assignment_index
Elapsed: 00:03:12
Lock wait: 0s
Blocked sessions: 0
App p95 latency: normal
5xx rate: normal
Replication lag: 2s
Decision: continue
```

### 10.3 Dashboard Untuk Backfill

Untuk long-running backfill:

```text
Backfill job: migrate_case_status
Total rows expected: 12,450,000
Rows processed: 8,120,000
Rows failed: 0
Chunks completed: 812 / 1245
Current chunk: id 8120001 - 8130000
Rate: 8,500 rows/sec
Estimated remaining: 8 min
Lock wait: low
Replication lag: acceptable
Throttle: normal
```

Estimasi remaining harus dianggap indikatif, bukan janji pasti.

---

## 11. Alerting: Kapan Harus Bangun?

Tidak semua migration warning butuh page. Alert harus berdasarkan impact dan actionability.

### 11.1 Alert Yang Layak High Severity

| Kondisi | Severity | Alasan |
|---|---:|---|
| migration failed di production | high | deployment mungkin partial |
| migration lock held terlalu lama | high | deployment lain/app bisa terblokir |
| blocked sessions melebihi threshold | high | user traffic terdampak |
| app error rate naik saat migration | high | migration memicu incident |
| replication lag besar | high | failover/read replica terdampak |
| checksum mismatch di prod | high | possible drift/tampering/manual change |
| destructive migration detected tanpa approval | high | compliance risk |

### 11.2 Alert Medium

| Kondisi | Severity | Alasan |
|---|---:|---|
| migration duration melebihi baseline | medium | perlu investigasi |
| pending migration count tidak nol setelah deploy | medium | pipeline mungkin skip |
| seed drift terdeteksi | medium | behavior bisa beda antar env |
| validation warning | medium | belum tentu incident |

### 11.3 Alert Low / Info

| Kondisi | Severity | Alasan |
|---|---:|---|
| migration succeeded | info | audit event |
| backfill progress milestone | info | tracking |
| dry-run completed | info | pipeline evidence |

---

## 12. Alert Anti-Patterns

### 12.1 Alert Saat Migration Sukses Sebagai Page

Migration sukses tidak perlu membangunkan orang. Kirim ke release channel atau audit stream.

### 12.2 Alert Tanpa Runbook

Alert yang baik harus menjawab:

- apa yang terjadi,
- seberapa parah,
- environment mana,
- service mana,
- link dashboard/log,
- langkah pertama.

Buruk:

```text
DB migration error.
```

Baik:

```text
PROD migration failed: case-service V202606170003__add_case_assignment_index
Pipeline: deploy-982113
Correlation: mig-prod-20260617-0001
First action: open runbook DBM-RB-003, check flyway_schema_history and blocked sessions.
```

### 12.3 Alert Terlalu Sensitif

Jika setiap migration yang >30 detik mengirim high alert, tim akan mengabaikan alert.

Gunakan baseline per migration type:

- add nullable column: seconds,
- create large index: minutes,
- backfill large table: minutes/hours,
- metadata-only change: seconds.

---

## 13. Operational Runbook: Definisi

Runbook adalah instruksi eksplisit yang dapat diikuti saat kondisi tertentu terjadi.

Runbook migration harus:

1. spesifik,
2. executable,
3. punya decision point,
4. menyebut query/command yang aman,
5. menjelaskan kapan stop/continue/escalate,
6. mencatat evidence yang harus disimpan,
7. tidak mengandalkan ingatan satu orang.

Runbook bukan essay. Runbook adalah alat operasi.

---

## 14. Runbook Structure Yang Baik

Template:

```markdown
# Runbook: <Scenario>

## Purpose
Apa tujuan runbook ini.

## Scope
Environment/service/database yang berlaku.

## Symptoms
Gejala yang memicu runbook.

## Safety Notes
Hal yang tidak boleh dilakukan.

## Required Access
Akses/log/dashboard/credential yang dibutuhkan.

## Pre-checks
Validasi awal.

## Procedure
Langkah-langkah.

## Decision Points
Kapan continue, stop, rollback, roll-forward, escalate.

## Verification
Cara membuktikan masalah selesai.

## Evidence To Capture
Screenshot/log/query output/ticket.

## Escalation
Siapa/role yang harus dilibatkan.

## Post-Incident Actions
Tindak lanjut.
```

---

## 15. Pre-Flight Checklist Sebelum Migration Production

Pre-flight check bertujuan mencegah migration masuk ke kondisi yang sudah jelas berbahaya.

### 15.1 Release Artifact Check

- [ ] Migration artifact berasal dari commit yang sama dengan release.
- [ ] Artifact immutable.
- [ ] Checksum artifact tercatat.
- [ ] Migration sudah lolos CI.
- [ ] Migration sudah diuji dari previous production-like version.
- [ ] SQL dry-run/review tersedia jika diperlukan.
- [ ] Approval/ticket tersedia.

### 15.2 Database State Check

- [ ] Target database benar.
- [ ] Target schema benar.
- [ ] Schema version sesuai expected pre-version.
- [ ] Tidak ada failed migration sebelumnya.
- [ ] Tidak ada pending manual repair.
- [ ] Tidak ada drift yang belum disetujui.
- [ ] Free storage cukup.
- [ ] Temp/undo/WAL capacity cukup.
- [ ] Replication sehat.
- [ ] Backup/snapshot tersedia sesuai policy.

### 15.3 Runtime Check

- [ ] Traffic level acceptable.
- [ ] Tidak ada long-running transaction berbahaya.
- [ ] Tidak ada batch besar sedang berjalan.
- [ ] Tidak ada maintenance lain paralel.
- [ ] Connection pool normal.
- [ ] CPU/I/O normal.
- [ ] Alerting aktif.
- [ ] Dashboard dibuka.

### 15.4 Application Compatibility Check

- [ ] Migration bersifat backward compatible jika rolling deployment.
- [ ] Old app bisa berjalan di schema expanded.
- [ ] New app bisa berjalan setelah migration.
- [ ] Feature flag state sesuai.
- [ ] Contract test lewat.
- [ ] Roll-forward plan tersedia.

---

## 16. During-Flight Checklist Saat Migration Berjalan

Selama migration berjalan, operator tidak boleh hanya menunggu command selesai.

Pantau:

- [ ] current migration step,
- [ ] elapsed time,
- [ ] lock wait,
- [ ] blocked sessions,
- [ ] database CPU/I/O,
- [ ] temp/undo/WAL usage,
- [ ] application p95/p99 latency,
- [ ] error rate,
- [ ] replication lag,
- [ ] backfill progress jika ada,
- [ ] log error/warning,
- [ ] migration history/lock table state.

Decision rule sederhana:

```text
IF migration is progressing
AND app metrics normal
AND DB metrics within threshold
THEN continue.

IF migration is not progressing
OR lock wait exceeds threshold
OR app error rate increases materially
THEN pause/abort/escalate according to runbook.
```

---

## 17. Post-Flight Verification

Migration command success belum cukup.

Post-flight verification harus mencakup:

### 17.1 Tool-Level Verification

Flyway:

- history table menunjukkan migration success,
- no failed entry,
- checksum sesuai,
- validate success,
- pending migration sesuai expected.

Liquibase:

- `DATABASECHANGELOG` berisi changeset expected,
- no unexpected lock di `DATABASECHANGELOGLOCK`,
- checksum valid,
- update status bersih,
- context/label yang dijalankan sesuai.

### 17.2 Schema Verification

- table/column/index/constraint ada,
- type benar,
- nullability benar,
- default benar,
- FK/unique/check constraint benar,
- view/procedure/function compile valid,
- grants benar.

### 17.3 Data Verification

- row count expected,
- no orphan rows,
- no duplicate natural key,
- status mapping benar,
- seed data lengkap,
- backfill coverage 100%,
- reconciliation query pass.

### 17.4 Application Verification

- app started successfully,
- health endpoint OK,
- smoke test pass,
- key API pass,
- background worker pass,
- no elevated error rate,
- no abnormal latency,
- audit/logging still works.

### 17.5 Business Verification

Untuk sistem regulated/enterprise, validasi teknis tidak cukup. Perlu validasi domain:

- case lifecycle masih valid,
- permission masih valid,
- status transition masih valid,
- report masih valid,
- downstream integration masih valid,
- audit trail masih terbentuk.

---

## 18. Verification Query Patterns

### 18.1 Row Count Verification

```sql
SELECT COUNT(*) AS total_rows
FROM case_record;
```

Untuk backfill:

```sql
SELECT
    COUNT(*) AS total_rows,
    SUM(CASE WHEN new_status_id IS NULL THEN 1 ELSE 0 END) AS missing_new_status
FROM case_record;
```

Expected:

```text
missing_new_status = 0
```

### 18.2 Duplicate Detection

```sql
SELECT external_ref_no, COUNT(*) AS cnt
FROM case_record
GROUP BY external_ref_no
HAVING COUNT(*) > 1;
```

Expected:

```text
0 rows
```

### 18.3 Orphan Detection

```sql
SELECT c.id
FROM case_record c
LEFT JOIN case_status s ON s.id = c.status_id
WHERE s.id IS NULL;
```

Expected:

```text
0 rows
```

### 18.4 Mapping Coverage

```sql
SELECT old_status, COUNT(*) AS cnt
FROM case_record
WHERE new_status_id IS NULL
GROUP BY old_status;
```

Expected:

```text
0 rows
```

### 18.5 Constraint Validation

Vendor-specific, tetapi pattern-nya:

```text
Check whether constraint exists
Check whether constraint is enabled/validated/trusted
Check whether invalid data remains
```

---

## 19. Runbook: Migration Failed Before Any Change

### Symptoms

- Flyway/Liquibase gagal sebelum menjalankan migration.
- Error pada connection, permission, config, missing file, invalid changelog.
- History table tidak berubah.

### Procedure

1. Konfirmasi target environment dan schema.
2. Cek log error.
3. Cek apakah history table berubah.
4. Cek apakah lock table/history table punya failed marker.
5. Jika tidak ada perubahan database, perbaiki config/artifact/pipeline.
6. Jalankan ulang dari pipeline, bukan manual lokal.

### Decision

```text
IF no database state changed
THEN safe to rerun after fixing pipeline/config.

IF database state changed partially
THEN switch to partial failure runbook.
```

### Do Not

- Jangan edit migration lama.
- Jangan repair checksum jika belum ada perubahan database.
- Jangan baseline ulang production.

---

## 20. Runbook: Flyway Migration Failed Mid-Way

### Symptoms

- `flyway migrate` gagal.
- `flyway_schema_history` menunjukkan failed migration atau migration terakhir tidak complete.
- Error bisa karena syntax, lock, permission, timeout, storage, constraint violation.

### Procedure

1. Stop deployment aplikasi berikutnya.
2. Capture log lengkap.
3. Query schema history table.
4. Identifikasi apakah DDL transactional atau non-transactional di DB tersebut.
5. Cek actual schema object yang mungkin sudah dibuat.
6. Cek blocked sessions dan lock.
7. Klasifikasikan failure:
   - no change applied,
   - partial DDL applied,
   - partial DML applied,
   - tool metadata inconsistent,
   - application already deployed.
8. Tentukan strategi:
   - rerun,
   - fix-forward migration,
   - manual correction + repair,
   - restore jika catastrophic.

### Example Query

```sql
SELECT installed_rank, version, description, type, script, checksum,
       installed_by, installed_on, execution_time, success
FROM flyway_schema_history
ORDER BY installed_rank DESC;
```

### Decision Matrix

| Situation | Action |
|---|---|
| SQL failed before object created | fix migration artifact if not released, rerun in lower env first |
| object created but history failed | verify object, decide repair only after approval |
| DML partially committed | run reconciliation query, create corrective migration |
| lock timeout no changes | rerun in safer window or adjust migration strategy |
| checksum mismatch | investigate drift, do not blindly repair |

### Safety Notes

`repair` memperbaiki metadata Flyway, bukan memperbaiki database business state. Gunakan hanya setelah actual database state sudah diverifikasi benar.

---

## 21. Runbook: Liquibase Migration Locked

### Symptoms

- Liquibase menunggu changelog lock.
- `DATABASECHANGELOGLOCK` menunjukkan locked.
- Pipeline timeout.

### Procedure

1. Pastikan tidak ada Liquibase process lain yang masih aktif.
2. Cek database session yang memegang lock.
3. Cek `DATABASECHANGELOGLOCK`.
4. Jika process masih berjalan, jangan release lock manual.
5. Jika process mati dan lock stale, release lock melalui mekanisme resmi/approved.
6. Jalankan `status`/verification sebelum retry.

### Example Query

```sql
SELECT *
FROM DATABASECHANGELOGLOCK;
```

### Decision

```text
IF another migration is actively running
THEN wait or coordinate.

IF lock is stale and process is dead
THEN release lock after approval and evidence capture.

IF unsure whether lock is stale
THEN escalate to DBA/platform owner.
```

### Do Not

- Jangan update lock table tanpa memastikan tidak ada proses aktif.
- Jangan menjalankan dua Liquibase update paralel ke schema yang sama.
- Jangan menghapus changelog lock table.

---

## 22. Runbook: Checksum Mismatch

### Symptoms

- Flyway validate gagal karena checksum mismatch.
- Liquibase checksum mismatch.
- Migration/changeset yang sudah pernah dijalankan berubah di repository.

### Interpretation

Checksum mismatch berarti ada salah satu kemungkinan:

1. File lama diedit setelah dijalankan.
2. Line ending/encoding berubah.
3. Build process mengubah file.
4. Branch merge salah.
5. Manual metadata manipulation.
6. Migration history menunjuk artifact yang berbeda dari repo saat ini.

### Procedure

1. Stop deployment.
2. Ambil checksum yang tercatat di database.
3. Ambil artifact yang sedang dideploy.
4. Bandingkan dengan artifact release sebelumnya.
5. Identifikasi apakah perubahan semantik atau non-semantik.
6. Jika semantik berubah, buat migration baru untuk correction.
7. Jika non-semantik dan database state valid, repair boleh dipertimbangkan dengan approval.
8. Catat evidence.

### Rule

```text
Do not edit applied migration.
Append a new migration.
Repair metadata only after proving actual state is correct.
```

---

## 23. Runbook: Migration Causes Application Errors

### Symptoms

- Migration sukses, tetapi aplikasi error.
- Startup gagal.
- Endpoint tertentu 500.
- Query aplikasi gagal karena missing column/table/type mismatch.

### Procedure

1. Identifikasi apakah app sudah dideploy atau masih versi lama.
2. Cek error log aplikasi.
3. Cek schema actual.
4. Cek expected compatibility matrix.
5. Tentukan apakah masalah:
   - migration belum lengkap,
   - app version salah,
   - feature flag salah,
   - contract broken,
   - missing seed,
   - grant/permission kurang.
6. Jika old app broken oleh new schema, ini failure expand/contract.
7. Jika new app butuh migration yang belum jalan, stop rollout dan jalankan missing migration jika aman.
8. Jika seed/grant kurang, buat corrective migration atau hotfix approved.
9. Jika data corrupt, aktifkan incident path.

### Decision

| Cause | Preferred Action |
|---|---|
| app deployed before migration | deploy order fix |
| migration missing | run pending migration if validated |
| seed missing | corrective seed migration |
| incompatible schema | roll-forward compatibility fix |
| destructive change broke old app | emergency fix-forward or restore depending impact |

---

## 24. Runbook: Backfill Too Slow

### Symptoms

- Backfill berjalan jauh lebih lama dari baseline.
- Rows/sec rendah.
- Replication lag naik.
- DB load tinggi.
- App latency naik.

### Procedure

1. Cek progress marker/checkpoint.
2. Cek rows processed per minute.
3. Cek query execution plan.
4. Cek lock/blocking.
5. Cek index support untuk predicate backfill.
6. Cek batch size.
7. Cek commit frequency.
8. Cek replica lag dan I/O.
9. Kurangi throttle jika sistem terdampak.
10. Pause jika melebihi threshold.
11. Resume dari checkpoint setelah adjustment.

### Decision

```text
IF app health normal AND progress acceptable
THEN continue.

IF app latency/error impacted
THEN throttle or pause.

IF no progress and DB blocked
THEN stop and investigate locks.

IF backfill cannot complete within window
THEN switch to online resumable job strategy.
```

---

## 25. Runbook: Destructive Migration Accidentally Applied

### Symptoms

- Column/table/data dropped unexpectedly.
- Old app broken.
- Data missing.
- Rollback request muncul.

### Procedure

1. Declare incident.
2. Stop further deployments.
3. Preserve logs and DB evidence.
4. Identify exact migration and timestamp.
5. Check backup/PITR availability.
6. Determine blast radius:
   - schema only,
   - data loss,
   - app outage,
   - downstream corruption.
7. Decide restore vs roll-forward vs partial data recovery.
8. Communicate impact.
9. Do not run ad-hoc reconstruction without approval.
10. Capture RCA evidence.

### Decision

| Scenario | Likely Action |
|---|---|
| dropped unused column with no app impact | document and continue |
| dropped column needed by old app but data still recoverable elsewhere | fix-forward compatibility |
| dropped table with production data | restore/PITR evaluation |
| destructive seed overwrote config | restore config from audit/export and corrective migration |

---

## 26. Pre-Approved SQL Diagnostic Kit

Tim sebaiknya punya diagnostic SQL yang sudah direview DBA/security.

### 26.1 Generic History Checks

Flyway:

```sql
SELECT *
FROM flyway_schema_history
ORDER BY installed_rank DESC;
```

Liquibase:

```sql
SELECT *
FROM DATABASECHANGELOG
ORDER BY DATEEXECUTED DESC, ORDEREXECUTED DESC;
```

Liquibase lock:

```sql
SELECT *
FROM DATABASECHANGELOGLOCK;
```

### 26.2 Object Existence

Pattern generic:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = '<schema>'
  AND table_name = '<table>';
```

Oracle variant:

```sql
SELECT owner, table_name
FROM all_tables
WHERE owner = '<SCHEMA>'
  AND table_name = '<TABLE>';
```

### 26.3 Index Existence

PostgreSQL:

```sql
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = '<schema>'
  AND tablename = '<table>';
```

Oracle:

```sql
SELECT owner, index_name, table_name, status
FROM all_indexes
WHERE owner = '<SCHEMA>'
  AND table_name = '<TABLE>';
```

SQL Server:

```sql
SELECT
    t.name AS table_name,
    i.name AS index_name,
    i.type_desc,
    i.is_disabled
FROM sys.indexes i
JOIN sys.tables t ON t.object_id = i.object_id
WHERE t.name = '<table>';
```

### 26.4 Blocking Session Checks

Vendor-specific blocking queries harus disiapkan per database engine. Jangan improvisasi saat incident.

Minimal harus bisa menjawab:

- session mana yang blocking,
- session mana yang blocked,
- SQL apa yang berjalan,
- berapa lama wait,
- user/program/module apa,
- apakah aman kill session.

---

## 27. Evidence Capture

Untuk production migration, simpan evidence berikut:

| Evidence | Waktu |
|---|---|
| approval ticket | sebelum deployment |
| migration artifact checksum | sebelum deployment |
| pre-flight checklist result | sebelum migration |
| backup/snapshot id | sebelum migration |
| schema version before | sebelum migration |
| migration logs | selama migration |
| database metrics screenshot/export | selama migration |
| schema version after | setelah migration |
| validation query output | setelah migration |
| smoke test result | setelah app deploy |
| decision notes | saat issue terjadi |
| incident ticket/RCA | jika gagal |

Untuk regulated environment, evidence ini sering lebih penting daripada sekadar “deployment success”.

---

## 28. Communication Runbook

Migration failure sering menjadi buruk bukan hanya karena teknis, tetapi karena komunikasi lambat dan tidak jelas.

### 28.1 Start Notification

```text
Starting PROD database migration for case-service.
Release: CR-2026-0412
Window: approved deployment window
Correlation ID: mig-prod-20260617-0001
Expected impact: no downtime expected
Monitoring: dashboard link
```

### 28.2 Progress Notification

```text
Migration in progress.
Current step: V202606170003__add_case_assignment_index
Elapsed: 4 minutes
Application metrics: normal
DB lock/blocking: none observed
Decision: continue
```

### 28.3 Warning Notification

```text
Migration warning detected.
Current step is slower than baseline.
Application metrics remain normal.
DB replication lag increased but within threshold.
Action: continuing with close monitoring.
Next update after next checkpoint or if threshold is crossed.
```

### 28.4 Failure Notification

```text
PROD database migration failed.
Failed step: V202606170004__backfill_case_status
Impact: application deployment paused; existing application remains running
Initial assessment: failure during data backfill validation
Action: executing migration failure runbook and preserving evidence
Correlation ID: mig-prod-20260617-0001
```

### 28.5 Success Notification

```text
PROD database migration completed successfully.
Schema version: 2026.06.17.004
Validation: passed
Application smoke test: passed
Observed impact: none detected
Evidence attached in release ticket.
```

---

## 29. Go / No-Go Criteria

### 29.1 Go Criteria

Proceed jika:

- approval lengkap,
- artifact immutable,
- backup/snapshot tersedia,
- pre-version sesuai,
- no drift unresolved,
- migration tested,
- compatibility verified,
- database health normal,
- monitoring ready,
- rollback/roll-forward decision tree tersedia,
- operator/DBA/platform support tersedia jika dibutuhkan.

### 29.2 No-Go Criteria

Jangan lanjut jika:

- target database/schema tidak pasti,
- checksum mismatch belum dijelaskan,
- failed migration sebelumnya belum diselesaikan,
- backup policy tidak terpenuhi,
- long-running transaction kritikal sedang berjalan,
- replication sudah lag besar sebelum migration,
- app compatibility belum jelas,
- destructive migration tidak punya approval,
- operator tidak punya akses dashboard/log,
- runbook untuk high-risk migration tidak ada.

---

## 30. Stop / Continue / Escalate Decision Model

Saat migration berjalan, keputusan harus berbasis threshold.

```text
CONTINUE
  when progress exists
  and app health normal
  and DB metrics within threshold.

THROTTLE
  when progress exists
  but DB/app pressure increases.

PAUSE
  when backfill is resumable
  and pressure crosses warning threshold.

ABORT
  when migration is safe to stop
  and continuing increases blast radius.

ESCALATE
  when state is uncertain
  or data correctness is in doubt
  or manual DB intervention is needed.

RESTORE/PITR EVALUATE
  when irreversible data loss or corruption is suspected.
```

Rule penting:

> Jangan melakukan tindakan irreversible kedua untuk memperbaiki tindakan irreversible pertama tanpa evidence dan approval.

---

## 31. Observability Untuk Spring Boot Migration

Spring Boot memberi integrasi otomatis Flyway/Liquibase, tetapi production operation tetap perlu desain.

### 31.1 Migration Saat Application Startup

Kelebihan:

- simple,
- cocok local/dev,
- app selalu mencoba membawa DB ke version expected,
- lifecycle mudah.

Risiko:

- banyak replica app bisa mencoba migration bersamaan,
- startup lambat,
- readiness tertunda,
- migration failure membuat pod crashloop,
- sulit pisahkan permission migration user vs app user,
- observability bercampur dengan app startup log.

### 31.2 External Migration Job

Kelebihan:

- lebih controllable,
- satu execution point,
- permission bisa dipisah,
- timeout jelas,
- log lebih fokus,
- cocok Kubernetes Job / CI/CD gate,
- app deploy bisa menunggu migration success.

Risiko:

- pipeline lebih kompleks,
- perlu ordering jelas,
- perlu secret management terpisah,
- developer local flow perlu disederhanakan.

### 31.3 Actuator

Spring Boot Actuator bisa membantu expose informasi migration dan metrics, tetapi jangan expose endpoint sensitif sembarangan. Endpoint migration harus diproteksi karena dapat mengungkap struktur schema dan history perubahan.

Prinsip:

- aktifkan hanya di network/role aman,
- gunakan untuk observability internal,
- jangan jadikan actuator sebagai satu-satunya audit evidence,
- jangan expose detail migration ke publik.

---

## 32. Observability Untuk Jakarta EE / Plain Java

Di Jakarta EE atau plain Java, kita biasanya tidak punya auto-config Spring Boot.

Pilihan observability:

1. External CLI logs.
2. Custom Java runner dengan structured logging.
3. Servlet/CDI/EJB startup hook logging.
4. App server deployment logs.
5. Database audit/history table.
6. CI/CD pipeline evidence.

Untuk production, external runner biasanya lebih mudah dikontrol daripada migration yang tersembunyi di app server startup.

Jika tetap menjalankan migration dalam aplikasi:

- log harus structured,
- migration harus berjalan sekali,
- jangan semua node menjalankan migration paralel,
- gunakan DB/tool lock,
- readiness app harus gagal jika migration gagal,
- punya timeout,
- punya clear failure behavior.

---

## 33. Observability Untuk Multi-Tenant Migration

Multi-tenant migration menambah dimensi: target bukan hanya schema, tetapi tenant.

Metric tambahan:

| Metric | Arti |
|---|---|
| tenants_total | jumlah tenant target |
| tenants_migrated_total | tenant berhasil |
| tenants_failed_total | tenant gagal |
| tenant_migration_duration_seconds | durasi per tenant |
| tenant_migration_pending_total | tenant belum migrasi |
| tenant_migration_quarantined_total | tenant ditahan karena gagal |

Log per tenant harus memuat:

- tenant id atau logical tenant key,
- tenant schema/database,
- migration wave,
- before version,
- after version,
- status,
- failure reason,
- retry count.

Namun hati-hati cardinality. Untuk metrics agregasi, gunakan wave/status. Untuk detail tenant, gunakan log/table registry.

Contoh tenant registry:

```sql
CREATE TABLE tenant_migration_registry (
    tenant_id           VARCHAR(100) NOT NULL,
    target_database     VARCHAR(200) NOT NULL,
    target_schema       VARCHAR(200) NOT NULL,
    migration_version   VARCHAR(100) NOT NULL,
    status              VARCHAR(30)  NOT NULL,
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    error_code          VARCHAR(100),
    error_message       VARCHAR(1000),
    retry_count         INTEGER NOT NULL DEFAULT 0,
    last_correlation_id VARCHAR(100),
    PRIMARY KEY (tenant_id, migration_version)
);
```

---

## 34. Observability Untuk Seed Drift

Seed drift terjadi ketika reference/config/master data berbeda dari expected state.

Contoh:

- role permission berbeda antar environment,
- status lookup ada yang hilang,
- feature flag default berbeda,
- country/currency code tidak lengkap,
- admin/bootstrap account berubah manual,
- tenant config diubah tanpa audit.

Observability seed drift:

1. Expected seed manifest.
2. Query actual seed state.
3. Compare natural key + significant fields.
4. Report missing/extra/changed.
5. Alert jika production drift tidak approved.

Contoh manifest konseptual:

```yaml
seed_set: case_status
version: 2026.06.17
records:
  - code: DRAFT
    label: Draft
    active: true
  - code: SUBMITTED
    label: Submitted
    active: true
  - code: CLOSED
    label: Closed
    active: true
```

Drift report:

```text
Seed drift detected: case_status
Missing: none
Extra: LEGACY_PENDING
Changed:
  - code=CLOSED field=active expected=true actual=false
Decision: investigate manual change before correction
```

---

## 35. Observability Untuk Backfill Correctness

Backfill observability harus membedakan progress dan correctness.

Progress menjawab:

```text
Berapa banyak sudah diproses?
```

Correctness menjawab:

```text
Apakah hasil transformasi benar?
```

Contoh:

```sql
SELECT COUNT(*) AS total_unmigrated
FROM case_record
WHERE new_status_id IS NULL;
```

Itu progress/cakupan.

Correctness perlu query seperti:

```sql
SELECT old_status, new_status_id, COUNT(*) AS cnt
FROM case_record
GROUP BY old_status, new_status_id
ORDER BY old_status, new_status_id;
```

Lalu bandingkan dengan expected mapping.

Untuk regulated systems, simpan reconciliation result sebagai evidence.

---

## 36. Kill Switch dan Throttle

Long-running migration/backfill perlu kontrol runtime.

### 36.1 Kill Switch

Kill switch memungkinkan operator menghentikan migration/backfill secara aman.

Pattern:

```sql
CREATE TABLE migration_control (
    migration_name VARCHAR(200) PRIMARY KEY,
    enabled        BOOLEAN NOT NULL,
    throttle_ms    INTEGER NOT NULL DEFAULT 0,
    updated_at     TIMESTAMP NOT NULL
);
```

Backfill worker membaca control table per chunk:

```text
IF enabled = false
THEN stop after current chunk commits.
```

Jangan stop di tengah transaksi besar. Stop di boundary yang aman.

### 36.2 Throttle

Throttle mengurangi pressure:

```text
process chunk
commit
sleep throttle_ms
repeat
```

Throttle dapat disesuaikan berdasarkan:

- replication lag,
- app latency,
- DB CPU,
- lock wait,
- time window.

---

## 37. Migration Runbook Untuk Kubernetes

Jika migration dijalankan sebagai Kubernetes Job:

Pre-check:

- [ ] image tag benar,
- [ ] config map/secret benar,
- [ ] service account benar,
- [ ] network policy mengizinkan DB access,
- [ ] job parallelism = 1,
- [ ] backoff limit sesuai,
- [ ] active deadline seconds sesuai,
- [ ] logs dikirim ke centralized logging,
- [ ] resource request/limit cukup.

Execution:

```text
CI/CD creates migration job
  -> wait for completion
  -> fetch logs
  -> run verification
  -> deploy application
```

Failure behavior:

```text
IF job failed
THEN do not deploy app
AND run migration failure runbook.
```

Anti-pattern:

- migration berjalan di setiap app pod initContainer tanpa koordinasi jelas,
- job retry otomatis menjalankan non-idempotent migration berulang,
- job timeout membunuh migration saat transaksi besar tanpa recovery plan,
- app deployment lanjut meskipun migration job gagal.

---

## 38. Migration Runbook Untuk Blue/Green dan Canary

### 38.1 Blue/Green

Database tetap shared, sehingga blue/green app tidak otomatis membuat database change aman.

Rule:

- DB migration harus compatible dengan blue dan green selama transisi.
- Destructive contract migration dilakukan setelah traffic penuh pindah dan old version tidak perlu rollback.
- Jika rollback traffic ke blue masih mungkin, schema tidak boleh mematahkan blue.

### 38.2 Canary

Canary app hanya sebagian traffic, tetapi DB migration biasanya global.

Implikasi:

- Jangan menganggap canary app berarti canary database change.
- Gunakan expand migration dulu.
- Aktifkan new behavior dengan feature flag.
- Backfill bisa gradual.
- Contract migration belakangan.

---

## 39. Migration Evidence Table

Selain Flyway/Liquibase history, organisasi bisa membuat release-level migration evidence table.

```sql
CREATE TABLE deployment_migration_evidence (
    id                   VARCHAR(100) PRIMARY KEY,
    release_id            VARCHAR(100) NOT NULL,
    environment           VARCHAR(50)  NOT NULL,
    service_name          VARCHAR(200) NOT NULL,
    database_name         VARCHAR(200) NOT NULL,
    schema_name           VARCHAR(200) NOT NULL,
    tool_name             VARCHAR(50)  NOT NULL,
    artifact_version      VARCHAR(200) NOT NULL,
    git_commit            VARCHAR(100) NOT NULL,
    pipeline_run_id       VARCHAR(200) NOT NULL,
    correlation_id        VARCHAR(200) NOT NULL,
    pre_version           VARCHAR(100),
    post_version          VARCHAR(100),
    started_at            TIMESTAMP NOT NULL,
    completed_at          TIMESTAMP,
    status                VARCHAR(30) NOT NULL,
    validation_status     VARCHAR(30),
    approved_by           VARCHAR(200),
    approval_reference    VARCHAR(200),
    backup_reference      VARCHAR(200),
    notes                 VARCHAR(2000)
);
```

Ini bukan pengganti history table tool. Ini adalah layer evidence release/governance.

---

## 40. Runbook: Production Migration Standard Flow

```text
1. Confirm release scope
2. Confirm target environment
3. Confirm artifact and checksum
4. Confirm approval
5. Confirm backup/snapshot
6. Confirm current schema version
7. Run validate/status
8. Check DB health
9. Check application health
10. Announce start
11. Execute migration
12. Monitor live metrics
13. Verify tool history
14. Verify schema
15. Verify data
16. Deploy/restart application if required
17. Run smoke test
18. Monitor after release
19. Announce completion
20. Attach evidence
```

---

## 41. Example: Production Migration Control Sheet

```markdown
# Production Migration Control Sheet

Release ID: CR-2026-0412
Service: case-service
Environment: PROD
Database: aceas_prod
Schema: case_mgmt
Migration Tool: Flyway
Artifact Version: case-service-4.18.0
Git Commit: 8c02e81
Pipeline Run: deploy-982113
Correlation ID: mig-prod-20260617-0001

## Pre-flight
- Approval: PASS / reference
- Backup: PASS / snapshot id
- Current schema version: 2026.06.10.003
- Expected target version: 2026.06.17.004
- Validate: PASS
- DB health: PASS
- App health: PASS

## Execution
- Start time:
- End time:
- Status:
- Failed migration if any:

## Verification
- Flyway validate: PASS
- Schema checks: PASS
- Data checks: PASS
- Smoke test: PASS
- App metrics: PASS

## Evidence
- Logs:
- Dashboard screenshot/export:
- Query output:
- Approval ticket:

## Decision
- Completed / Rolled forward / Rolled back / Incident raised
```

---

## 42. Common Production Smells

### 42.1 “Migration Succeeded” Tapi Tidak Ada Verification

Command success hanya berarti tool selesai. Bukan berarti business invariant benar.

### 42.2 “Kita Bisa Rollback Nanti” Tanpa Test

Rollback yang belum diuji adalah asumsi, bukan strategi.

### 42.3 “DBA Bisa Fix Manual”

Manual fix tanpa artifact dan evidence akan menciptakan drift.

### 42.4 “Ini Cuma Seed Data”

Seed permission/status/config bisa mengubah behavior aplikasi secara besar.

### 42.5 “Ini Cuma Index”

Index creation pada table besar bisa memicu lock, I/O pressure, temp usage, replication lag.

### 42.6 “Cuma Satu Column Rename”

Column rename adalah breaking change bagi aplikasi lama, query report, integration, stored procedure, dan ETL.

---

## 43. Production Readiness Checklist Untuk Migration Observability

Tim siap production jika bisa menjawab “ya” untuk hal berikut:

- [ ] Migration punya structured log.
- [ ] Migration punya correlation id.
- [ ] Migration logs masuk centralized logging.
- [ ] Migration history table dimonitor.
- [ ] Liquibase/Flyway lock/failure state bisa dicek.
- [ ] Migration duration tercatat.
- [ ] Backfill progress tercatat.
- [ ] DB lock/blocking monitoring tersedia.
- [ ] App metrics di-overlay dengan migration window.
- [ ] Alert untuk failed migration tersedia.
- [ ] Alert punya runbook.
- [ ] Pre-flight checklist ada.
- [ ] Post-flight verification ada.
- [ ] Evidence disimpan.
- [ ] Decision matrix stop/continue/escalate jelas.
- [ ] Restore/PITR path diketahui.
- [ ] Manual DB change policy jelas.
- [ ] Seed drift bisa dideteksi.
- [ ] Multi-tenant rollout bisa dilacak jika relevan.

---

## 44. How Top 1% Engineers Think About This

Engineer biasa bertanya:

> Script migration-nya jalan atau tidak?

Engineer production-grade bertanya:

> Apakah migration ini mengubah database ke state yang benar, dengan dampak runtime yang terkendali, evidence yang cukup, recovery path yang jelas, dan compatibility contract yang tetap terpenuhi selama deployment?

Perbedaan ini terlihat dalam desain:

| Engineer biasa | Engineer top-tier |
|---|---|
| menulis SQL lalu deploy | mendesain change lifecycle |
| cek success log | cek invariant dan verification |
| rollback dianggap reverse SQL | rollback/roll-forward diputus berbasis data loss dan compatibility |
| migration dijalankan app startup tanpa kontrol | migration punya ownership, lock, log, metric, runbook |
| seed dianggap data kecil | seed dianggap behavior contract |
| incident ditangani improvisasi | incident mengikuti runbook dan evidence |
| manual DB fix dianggap normal | manual DB fix dianggap controlled exception |

---

## 45. Final Mental Model

Database migration observability bukan hanya logging. Ia adalah kemampuan operasional untuk menjaga sistem tetap defensible saat state berubah.

Model akhirnya:

```text
Migration file defines intended change.
Tool history records applied change.
Logs explain execution behavior.
Metrics reveal runtime impact.
Verification proves correctness.
Runbook controls decisions.
Evidence supports audit.
Recovery plan limits blast radius.
```

Jika salah satu hilang, migration masih punya blind spot.

---

## 46. Ringkasan

Dalam Part 30 ini, kita mempelajari:

- migration sebagai production operation,
- observability layers,
- structured logging,
- metrics,
- tracing,
- dashboards,
- alerts,
- pre-flight/during-flight/post-flight checklist,
- runbook untuk failure umum,
- checksum mismatch handling,
- lock handling,
- application error after migration,
- backfill monitoring,
- destructive migration incident,
- Kubernetes migration job,
- blue/green dan canary implication,
- evidence capture,
- communication template,
- go/no-go criteria,
- production readiness checklist.

Inti utamanya:

> Migration yang baik bukan hanya migration yang bisa dijalankan. Migration yang baik adalah migration yang bisa diamati, diverifikasi, dihentikan secara aman, dipulihkan, dan dipertanggungjawabkan.

---

## 47. Referensi Resmi dan Bacaan Lanjutan

- Redgate Flyway Documentation — Schema History Table.
- Redgate Flyway Documentation — Migrations.
- Redgate Flyway Documentation — Callbacks.
- Liquibase Documentation — `DATABASECHANGELOG` and `DATABASECHANGELOGLOCK` concepts.
- Liquibase Documentation — Update command and Flow Files.
- Spring Boot Reference Documentation — Actuator endpoints, metrics, Flyway/Liquibase integration.
- PostgreSQL Documentation — Lock monitoring, concurrent index creation, transaction behavior.
- Oracle Database Documentation — DDL locks, online operations, invalid objects, session monitoring.
- MySQL Documentation — Metadata locks and online DDL.
- SQL Server Documentation — lock monitoring and online index operations.
- OpenTelemetry Documentation — tracing and metrics concepts.

---

## 48. Status Seri

Seri belum selesai.

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
- Part 27 — Multi-Service, Multi-Module, and Shared Database Migrations
- Part 28 — Multi-Tenant Database Migration
- Part 29 — Security, Compliance, and Auditability
- Part 30 — Observability and Operational Runbooks

Berikutnya:

- Part 31 — Advanced Patterns and Anti-Patterns


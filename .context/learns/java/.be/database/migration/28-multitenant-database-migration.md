# Part 28 — Multi-Tenant Database Migration

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> File: `28-multitenant-database-migration.md`  
> Topik: Java database migrations & seedings, Flyway, Liquibase, multi-tenant migration engineering  
> Target: Java 8 hingga Java 25, legacy enterprise sampai cloud-native SaaS

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu memahami dan mendesain migration untuk sistem multi-tenant secara production-grade, bukan hanya menjalankan migration loop ke banyak schema.

Bagian ini akan membahas:

1. Apa yang membuat database migration multi-tenant jauh lebih kompleks daripada single-tenant migration.
2. Perbedaan migration untuk:
   - shared database shared schema,
   - shared database schema-per-tenant,
   - database-per-tenant,
   - hybrid tenancy.
3. Bagaimana mendesain tenant migration registry.
4. Bagaimana menangani tenant version drift.
5. Bagaimana melakukan rollout bertahap dengan wave, batch, retry, dan quarantine.
6. Bagaimana menggunakan Flyway dan Liquibase dalam konteks multi-tenant.
7. Bagaimana mendesain onboarding tenant baru.
8. Bagaimana menangani failed tenant migration tanpa merusak seluruh estate.
9. Bagaimana menjaga auditability, observability, dan compliance untuk ribuan tenant.
10. Bagaimana berpikir seperti engineer senior/top-tier saat database bukan hanya satu target, tetapi banyak target dengan kondisi berbeda.

---

## 2. Core Mental Model

Single-tenant migration biasanya punya model mental seperti ini:

```text
Application version N
        |
        v
Database schema version N
        |
        v
One migration history
```

Multi-tenant migration mengubah masalahnya menjadi:

```text
Application version N
        |
        v
Tenant A database/schema version N
Tenant B database/schema version N-1
Tenant C database/schema version N-3
Tenant D failed at N-2 partially
Tenant E newly onboarded at N
Tenant F customized at N-1 + extension X
```

Artinya, migration bukan hanya soal **urutan file SQL**. Migration menjadi sistem distribusi perubahan ke banyak isolated state.

Dalam sistem multi-tenant, pertanyaan utama bukan lagi:

> “Apakah migration sudah jalan?”

Tetapi:

> “Migration sudah jalan ke tenant mana, pada versi apa, dengan hasil apa, durasi berapa, gagal kenapa, aman di-retry atau tidak, dan apakah aplikasi masih kompatibel dengan tenant yang tertinggal?”

Itulah inti bagian ini.

---

## 3. Definisi: Apa Itu Tenant?

Tenant adalah unit isolasi pelanggan, organisasi, agency, business unit, merchant, sekolah, cabang, region, atau logical customer dalam satu platform.

Tenant tidak selalu berarti “customer eksternal SaaS”. Dalam sistem enterprise/government, tenant bisa berupa:

- agency,
- department,
- ministry,
- subsidiary,
- country,
- branch,
- region,
- business unit,
- environment partition,
- internal client.

Yang penting: tenant memiliki boundary data, configuration, access, dan lifecycle sendiri.

Contoh:

```text
Tenant A: schema tenant_cea
Tenant B: schema tenant_cpds
Tenant C: schema tenant_rom
Tenant D: database db_agency_x
Tenant E: rows with tenant_id = 'AGENCY_Y'
```

Multi-tenancy bukan hanya konsep aplikasi. Ia berdampak langsung pada migration, karena schema/data target bisa berbeda-beda per tenant.

---

## 4. Kenapa Multi-Tenant Migration Sulit?

Karena jumlah state yang harus dikelola bertambah.

Single-tenant:

```text
1 database target
1 schema version
1 history table
1 failure point
```

Multi-tenant:

```text
N tenant targets
N possible schema versions
N migration histories
N possible failure points
N possible lock/timeout/data-volume profiles
```

Masalahnya bukan linear saja. Kompleksitasnya naik karena tenant bisa berbeda dalam:

- ukuran data,
- feature enabled,
- custom configuration,
- region,
- database engine version,
- timezone,
- regulatory boundary,
- load pattern,
- extension object,
- manual hotfix history,
- migration drift,
- historical seed data.

Satu migration yang aman untuk tenant kecil bisa berbahaya untuk tenant besar.

Contoh:

```sql
ALTER TABLE case_record ADD COLUMN normalized_status VARCHAR(50);
UPDATE case_record SET normalized_status = UPPER(status);
ALTER TABLE case_record MODIFY normalized_status NOT NULL;
```

Untuk tenant kecil dengan 5.000 rows, ini mungkin selesai cepat.

Untuk tenant besar dengan 200 juta rows, ini bisa:

- mengunci tabel,
- menghabiskan undo/redo,
- memperlambat replication,
- membuat application timeout,
- gagal di tengah,
- menahan deployment semua tenant lain.

Top-tier engineer tidak memperlakukan semua tenant sebagai target homogen.

---

## 5. Empat Model Multi-Tenant Database

Secara umum ada empat model.

---

## 5.1 Shared Database, Shared Schema

Semua tenant berada dalam satu schema/table yang sama. Isolasi dilakukan dengan kolom `tenant_id`.

```text
Database: app_db
Schema: public/app

case_record
--------------------------------
id | tenant_id | case_no | status
1  | AGENCY_A  | C-001   | OPEN
2  | AGENCY_B  | C-002   | CLOSED
3  | AGENCY_A  | C-003   | PENDING
```

### Karakteristik

Kelebihan:

- paling sederhana secara operasional,
- satu schema history,
- migration hanya dijalankan sekali,
- resource sharing tinggi,
- onboarding tenant cepat.

Kekurangan:

- isolasi lemah,
- query wajib tenant-aware,
- risiko cross-tenant data leakage,
- tenant besar bisa mengganggu tenant kecil,
- data migration per tenant sulit dipisahkan,
- rollback per tenant hampir tidak mungkin.

### Dampak ke Migration

Schema migration hanya sekali:

```text
V1 -> V2 -> V3
```

Tetapi data migration bisa tenant-aware:

```sql
UPDATE case_record
SET normalized_status = UPPER(status)
WHERE tenant_id = 'AGENCY_A';
```

Atau global:

```sql
UPDATE case_record
SET normalized_status = UPPER(status)
WHERE normalized_status IS NULL;
```

Masalah utama: satu data migration besar bisa berdampak ke semua tenant.

---

## 5.2 Shared Database, Schema-per-Tenant

Setiap tenant punya schema sendiri dalam database yang sama.

```text
Database: app_db

Schema tenant_a:
  case_record
  appeal
  document

Schema tenant_b:
  case_record
  appeal
  document

Schema tenant_c:
  case_record
  appeal
  document
```

### Karakteristik

Kelebihan:

- isolasi lebih kuat daripada shared schema,
- per-tenant migration mungkin,
- per-tenant backup/restore sebagian mungkin lebih mudah daripada shared schema,
- tenant version bisa dilacak per schema,
- tenant failure bisa diisolasi.

Kekurangan:

- jumlah schema bisa sangat banyak,
- migration perlu loop per tenant,
- metadata object bertambah,
- connection/search path/default schema harus hati-hati,
- migration history bisa ada per tenant,
- cross-tenant reporting lebih sulit,
- DDL ke ribuan schema bisa lama.

### Dampak ke Migration

Migration harus dijalankan per tenant schema.

```text
tenant_a: V1 -> V2 -> V3
tenant_b: V1 -> V2
tenant_c: V1 -> V2 -> failed V3
tenant_d: V1 -> V2 -> V3
```

Di sinilah tenant migration registry menjadi penting.

---

## 5.3 Database-per-Tenant

Setiap tenant punya database sendiri.

```text
Tenant A -> db_tenant_a
Tenant B -> db_tenant_b
Tenant C -> db_tenant_c
```

### Karakteristik

Kelebihan:

- isolasi paling kuat,
- restore per tenant lebih bersih,
- scaling per tenant lebih mudah,
- noisy neighbor lebih terkendali,
- compliance boundary lebih jelas,
- per-tenant versioning lebih natural.

Kekurangan:

- operasional lebih kompleks,
- connection management lebih berat,
- migration orchestration harus menangani banyak connection target,
- cost lebih tinggi,
- observability lebih kompleks,
- global analytics lebih sulit,
- credential/secret management lebih besar.

### Dampak ke Migration

Migration runner harus tahu daftar database tenant dan credential/connection masing-masing.

```text
for each tenant_database:
  acquire tenant lock
  run migration
  record status
  release tenant lock
```

Ini sudah mendekati distributed migration orchestration.

---

## 5.4 Hybrid Tenancy

Hybrid biasanya muncul di enterprise nyata.

Contoh:

```text
Small tenants      -> shared schema
Medium tenants     -> schema-per-tenant
Large tenants      -> database-per-tenant
Regulated tenants  -> dedicated database/cluster
Legacy tenants     -> older schema layout
```

Atau:

```text
Core transactional tables: schema-per-tenant
Shared reference tables: global schema
Audit tables: centralized schema
Reporting warehouse: shared analytical database
```

### Dampak ke Migration

Hybrid membuat migration lebih kompleks karena satu release bisa punya beberapa target:

- global schema migration,
- tenant schema migration,
- tenant seed migration,
- reference data migration,
- reporting schema migration,
- feature-specific migration.

Urutan menjadi penting:

```text
1. migrate global reference schema
2. migrate shared config schema
3. migrate tenant schemas in waves
4. migrate reporting views
5. enable feature flag
6. contract old objects later
```

---

## 6. Tooling Reality: Flyway dan Liquibase Tidak Menghilangkan Kompleksitas Tenancy

Flyway dan Liquibase menyediakan fondasi:

- ordered migration,
- history table,
- checksum,
- locking,
- validation,
- repeatability tertentu,
- rollback support tertentu,
- CLI/API/plugin integration.

Namun keduanya tidak otomatis menyelesaikan:

- daftar tenant mana yang aktif,
- tenant mana yang eligible,
- tenant mana yang harus di-skip,
- tenant mana yang gagal,
- tenant mana yang harus quarantine,
- rollout wave,
- concurrency limit,
- health gate,
- observability lintas tenant,
- tenant-specific customization,
- compatibility aplikasi terhadap tenant dengan versi berbeda.

Jadi untuk multi-tenant, migration tool adalah **engine**, bukan **orchestrator penuh**.

Kita biasanya butuh layer tambahan:

```text
Migration Orchestrator
        |
        +-- Tenant Registry
        +-- Tenant Migration Registry
        +-- Flyway/Liquibase Runner
        +-- Lock Manager
        +-- Retry Policy
        +-- Quarantine Policy
        +-- Metrics/Logs/Audit
        +-- Deployment Gate
```

---

## 7. Tenant Registry vs Tenant Migration Registry

Keduanya berbeda.

---

## 7.1 Tenant Registry

Tenant registry menjawab:

> “Tenant apa saja yang ada dan bagaimana cara mengaksesnya?”

Contoh table:

```sql
CREATE TABLE tenant_registry (
    tenant_id             VARCHAR(100) PRIMARY KEY,
    tenant_name           VARCHAR(255) NOT NULL,
    tenancy_model         VARCHAR(50) NOT NULL,
    db_host               VARCHAR(255),
    db_name               VARCHAR(255),
    schema_name           VARCHAR(255),
    region                VARCHAR(50),
    status                VARCHAR(50) NOT NULL,
    migration_enabled     BOOLEAN NOT NULL,
    feature_tier          VARCHAR(50),
    created_at            TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP NOT NULL
);
```

Status contoh:

```text
ACTIVE
SUSPENDED
DECOMMISSIONING
DECOMMISSIONED
ONBOARDING
QUARANTINED
```

Tenant registry adalah inventory.

---

## 7.2 Tenant Migration Registry

Tenant migration registry menjawab:

> “Migration untuk tenant ini sudah sampai mana dan hasilnya apa?”

Contoh:

```sql
CREATE TABLE tenant_migration_registry (
    id                    BIGINT PRIMARY KEY,
    tenant_id             VARCHAR(100) NOT NULL,
    target_release        VARCHAR(100) NOT NULL,
    target_schema_version VARCHAR(100) NOT NULL,
    current_schema_version VARCHAR(100),
    migration_tool        VARCHAR(50) NOT NULL,
    started_at            TIMESTAMP,
    finished_at           TIMESTAMP,
    status                VARCHAR(50) NOT NULL,
    attempt_no            INT NOT NULL,
    runner_instance       VARCHAR(255),
    error_code            VARCHAR(100),
    error_message         CLOB,
    last_successful_step  VARCHAR(255),
    rows_affected         BIGINT,
    checksum_summary      VARCHAR(255),
    created_at            TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP NOT NULL
);
```

Status contoh:

```text
PENDING
RUNNING
SUCCESS
FAILED_RETRYABLE
FAILED_NON_RETRYABLE
SKIPPED
QUARANTINED
ROLLED_FORWARD
MANUAL_INTERVENTION_REQUIRED
```

Perhatikan: Flyway punya `flyway_schema_history`; Liquibase punya `DATABASECHANGELOG`. Tetapi dalam multi-tenant system, sering masih perlu registry tambahan di control database untuk melihat status semua tenant dari satu tempat.

---

## 8. Dua Level History: Local History dan Global Control History

Dalam multi-tenant migration, biasanya ada dua level history.

### Level 1 — Local History

Ini history milik tool di target tenant:

```text
Flyway:
  flyway_schema_history

Liquibase:
  DATABASECHANGELOG
  DATABASECHANGELOGLOCK
```

Flyway mendokumentasikan schema history table sebagai audit trail perubahan yang sudah dilakukan terhadap schema, termasuk checksum dan status migration. Liquibase memakai `DATABASECHANGELOG` untuk melacak changeset yang sudah dijalankan, dan `DATABASECHANGELOGLOCK` untuk mencegah lebih dari satu instance Liquibase melakukan update pada waktu yang sama.

### Level 2 — Global Control History

Ini registry milik platform/orchestrator:

```text
control_db.tenant_migration_registry
control_db.tenant_migration_attempt
control_db.tenant_migration_event
```

Tujuannya:

- menampilkan progress semua tenant,
- menentukan tenant mana yang gagal,
- mengatur retry,
- mengatur rollout wave,
- menyimpan error summary,
- memberi dashboard operasional,
- menjadi bukti audit deployment.

Tanpa global control history, kamu harus query history table tenant satu per satu.

Itu tidak scalable untuk puluhan, ratusan, atau ribuan tenant.

---

## 9. Tenant Version Drift

Tenant version drift terjadi ketika tenant tidak berada pada versi schema yang sama.

Contoh:

```text
Tenant A: V2026.06.01.001
Tenant B: V2026.06.01.001
Tenant C: V2026.05.15.003
Tenant D: V2026.04.30.009
Tenant E: failed at V2026.06.01.001
```

Drift bisa terjadi karena:

- tenant offline,
- tenant dikunci karena incident,
- tenant punya custom extension,
- migration gagal,
- tenant belum eligible untuk feature,
- region belum masuk rollout wave,
- manual hotfix,
- database maintenance,
- tenant baru dibuat dari baseline lama,
- release rollback sebagian.

Drift tidak selalu salah. Dalam rollout bertahap, drift sementara adalah normal.

Yang berbahaya adalah **uncontrolled drift**.

---

## 10. Controlled Drift vs Uncontrolled Drift

### Controlled Drift

```text
Expected:
  Wave 1 tenants -> V10
  Wave 2 tenants -> V9
  Wave 3 tenants -> V9

Application compatibility:
  supports V9 and V10

Monitoring:
  drift accepted until 2026-06-20
```

Ini sehat.

### Uncontrolled Drift

```text
Tenant A -> V10
Tenant B -> V7
Tenant C -> V8 plus manual column
Tenant D -> V10 but missing seed
Tenant E -> unknown
Application -> assumes V10 only
```

Ini berbahaya.

Masalah utama bukan drift itu sendiri, tetapi tidak adanya contract:

- versi minimum yang masih didukung aplikasi,
- versi maksimum yang boleh ada,
- berapa lama tenant boleh tertinggal,
- apa yang terjadi jika tenant di bawah minimum,
- apakah request tenant harus diblokir,
- apakah tenant masuk maintenance mode.

---

## 11. Application Compatibility Matrix untuk Multi-Tenant

Dalam single-tenant, aplikasi biasanya hanya perlu kompatibel dengan satu versi schema.

Dalam multi-tenant, aplikasi mungkin harus kompatibel dengan beberapa versi tenant schema selama rollout.

Contoh:

```text
Application 5.2 supports tenant schema: 5.0, 5.1, 5.2
Application 5.3 supports tenant schema: 5.1, 5.2, 5.3
Application 5.4 supports tenant schema: 5.3, 5.4 only
```

Matrix:

| App Version | Min Tenant Schema | Max Tenant Schema | Notes |
|---|---:|---:|---|
| 5.2 | 5.0 | 5.2 | transitional support |
| 5.3 | 5.1 | 5.3 | old compatibility removed slowly |
| 5.4 | 5.3 | 5.4 | contract phase done |

Ini penting untuk expand/contract.

Jika aplikasi langsung mengasumsikan semua tenant sudah V10, maka tenant yang tertinggal akan error.

---

## 12. Pattern: Tenant-Aware Migration Orchestrator

Untuk tenant banyak, jangan hanya melakukan:

```java
for (Tenant tenant : tenants) {
    flywayFor(tenant).migrate();
}
```

Itu terlalu naif.

Minimal orchestrator harus punya alur:

```text
1. Load eligible tenants
2. Check global rollout policy
3. Create migration attempt record
4. Acquire tenant-level lock
5. Check tenant current version
6. Check preconditions
7. Run migration tool
8. Verify postconditions
9. Update tenant migration registry
10. Emit metrics/log/audit event
11. Retry or quarantine if failed
12. Continue next tenant according to policy
```

Pseudo-code:

```java
for (Tenant tenant : tenantSelector.eligibleFor(releaseId)) {
    MigrationAttempt attempt = registry.startAttempt(tenant, releaseId);

    try (TenantLock lock = lockManager.acquire(tenant.id(), releaseId)) {
        TenantVersion current = versionReader.read(tenant);

        preflightChecker.check(tenant, current, releaseId);

        MigrationResult result = migrationRunner.run(tenant, releaseId);

        postflightVerifier.verify(tenant, releaseId);

        registry.markSuccess(attempt, result);
        metrics.recordSuccess(tenant, result.duration());
    } catch (RetryableMigrationException ex) {
        registry.markRetryableFailure(attempt, ex);
        retryScheduler.schedule(tenant, releaseId, ex);
    } catch (NonRetryableMigrationException ex) {
        registry.markNonRetryableFailure(attempt, ex);
        quarantineService.quarantine(tenant, ex);
    }
}
```

Top-tier point: migration orchestrator adalah **workflow engine** kecil untuk database change delivery.

---

## 13. Tenant Selection

Tidak semua tenant harus dimigrasikan sekaligus.

Selector bisa berdasarkan:

- tenant status,
- region,
- feature tier,
- data volume,
- customer criticality,
- maintenance window,
- migration previous status,
- current schema version,
- explicit allowlist,
- explicit denylist,
- wave number.

Contoh query:

```sql
SELECT tenant_id, schema_name, region
FROM tenant_registry
WHERE status = 'ACTIVE'
  AND migration_enabled = true
  AND region = 'ap-southeast-1'
  AND tenant_id NOT IN (
      SELECT tenant_id
      FROM tenant_migration_registry
      WHERE target_release = '2026.06.R1'
        AND status IN ('SUCCESS', 'QUARANTINED')
  )
ORDER BY tenant_id;
```

Selector yang baik harus deterministic.

Jangan biarkan urutan tenant berubah-ubah tanpa alasan karena ini menyulitkan debug.

---

## 14. Wave Rollout

Wave rollout berarti migrasi tenant bertahap.

Contoh:

```text
Wave 0: internal tenants / test tenants
Wave 1: small tenants
Wave 2: medium tenants
Wave 3: large tenants
Wave 4: regulated/critical tenants
```

Atau berdasarkan region:

```text
Wave 1: dev-like tenants
Wave 2: Indonesia region
Wave 3: Singapore region
Wave 4: Australia region
Wave 5: global remaining tenants
```

Atau berdasarkan risk:

```text
Wave 1: low volume, low criticality
Wave 2: low volume, high criticality
Wave 3: high volume, low criticality
Wave 4: high volume, high criticality
```

### Kenapa Wave Penting?

Karena migration risk tidak selalu terlihat sebelum dijalankan.

Wave kecil memberi sinyal:

- apakah SQL compatible,
- apakah lock duration aman,
- apakah seed deterministic,
- apakah migration script salah asumsi,
- apakah data quality tenant berbeda,
- apakah observability cukup.

---

## 15. Batch Size dan Concurrency Limit

Jika ada 5.000 tenant, menjalankan migration secara serial bisa terlalu lama.

Tetapi menjalankan semua parallel bisa membunuh database.

Maka diperlukan concurrency control.

Contoh:

```text
Max global parallel migrations: 10
Max per database host: 2
Max per region: 5
Max large tenant migration: 1
Max DDL migration concurrent: 1
Max data backfill concurrent: 3
```

Pseudo policy:

```yaml
migrationPolicy:
  release: 2026.06.R1
  maxGlobalConcurrency: 8
  maxPerClusterConcurrency: 2
  maxLargeTenantConcurrency: 1
  retry:
    maxAttempts: 3
    backoff: exponential
  quarantine:
    afterNonRetryableFailure: true
```

Concurrency harus mempertimbangkan:

- connection pool,
- DB CPU,
- IO,
- lock behavior,
- replication lag,
- transaction log volume,
- undo/redo pressure,
- backup window,
- maintenance window.

---

## 16. Retry Policy

Retry tidak selalu aman.

Migration yang idempotent dan transactional biasanya lebih aman di-retry.

Migration yang partial dan non-transactional harus diperlakukan hati-hati.

### Retryable Failure

Contoh:

- transient network error,
- lock timeout,
- statement timeout sebelum perubahan terjadi,
- temporary connection issue,
- deadlock yang rollback transaction,
- database unavailable sementara.

### Non-Retryable Failure

Contoh:

- column already exists karena manual drift,
- data violates constraint,
- missing required table,
- invalid seed assumption,
- checksum mismatch,
- partial non-transactional DDL,
- incompatible tenant customization.

### Retry Decision Matrix

| Failure | Retry? | Reason |
|---|---:|---|
| Connection timeout before execution | Usually yes | no DB mutation likely |
| Lock timeout | Usually yes | transaction likely not applied |
| Deadlock with rollback | Usually yes | DB rolled back transaction |
| Constraint violation | No | data condition must be fixed |
| Checksum mismatch | No | source/history integrity issue |
| Object already exists | Depends | may be idempotent or drift |
| Partial DDL success | No automatic retry | inspect first |

Retry policy harus mencatat attempt.

```sql
CREATE TABLE tenant_migration_attempt (
    id BIGINT PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    release_id VARCHAR(100) NOT NULL,
    attempt_no INT NOT NULL,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    status VARCHAR(50) NOT NULL,
    failure_category VARCHAR(100),
    failure_message CLOB
);
```

---

## 17. Quarantine Pattern

Quarantine berarti tenant dikeluarkan sementara dari rollout otomatis karena kondisinya butuh intervensi.

Contoh:

```text
Tenant C migration failed due to unexpected duplicate status code.
Tenant C marked QUARANTINED.
Rollout continues to other tenants.
Tenant C excluded from normal batch until manual correction.
```

Tanpa quarantine, satu tenant bermasalah bisa menghentikan semua tenant.

Dengan quarantine, rollout tetap berjalan tetapi tenant bermasalah tetap terlihat.

Quarantine record:

```sql
CREATE TABLE tenant_migration_quarantine (
    tenant_id VARCHAR(100) PRIMARY KEY,
    release_id VARCHAR(100) NOT NULL,
    reason_code VARCHAR(100) NOT NULL,
    reason_message CLOB,
    quarantined_at TIMESTAMP NOT NULL,
    quarantined_by VARCHAR(255),
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(255),
    resolution_note CLOB
);
```

Quarantine bukan tempat menyembunyikan error. Ia adalah control mechanism.

---

## 18. Per-Tenant Locking

Migration multi-tenant perlu lock agar tenant yang sama tidak dimigrasikan oleh dua runner.

Ada beberapa level lock.

### 18.1 Tool-Level Lock

Liquibase punya `DATABASECHANGELOGLOCK` untuk memastikan hanya satu instance Liquibase melakukan update ke database target pada satu waktu.

Flyway memiliki locking internal sesuai database/metadata operation dan schema history behavior, tetapi dalam multi-tenant orchestration kamu tetap perlu lock di level tenant/workflow.

### 18.2 Orchestrator-Level Lock

Contoh:

```sql
CREATE TABLE tenant_migration_lock (
    tenant_id VARCHAR(100) PRIMARY KEY,
    release_id VARCHAR(100) NOT NULL,
    locked_by VARCHAR(255) NOT NULL,
    locked_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL
);
```

Acquisition:

```sql
INSERT INTO tenant_migration_lock (
    tenant_id, release_id, locked_by, locked_at, expires_at
) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 minutes');
```

Jika insert gagal karena PK conflict, tenant sedang dimigrasikan runner lain.

### 18.3 Distributed Lock

Jika orchestrator berjalan di Kubernetes dengan banyak pod, bisa memakai:

- database lock table,
- advisory lock PostgreSQL,
- DBMS lock Oracle,
- Redis lock dengan fencing token,
- Kubernetes Lease,
- workflow engine lock.

Untuk migration, database-backed lock sering paling audit-friendly karena dekat dengan state yang dikontrol.

---

## 19. Flyway untuk Schema-per-Tenant

Flyway dapat dijalankan per schema dengan konfigurasi berbeda.

Konsep umum:

```java
Flyway flyway = Flyway.configure()
    .dataSource(dataSource)
    .schemas(schemaName)
    .defaultSchema(schemaName)
    .locations("classpath:db/migration/tenant")
    .table("flyway_schema_history")
    .load();

flyway.migrate();
```

Untuk schema-per-tenant, biasanya ada dua strategi history table.

---

## 19.1 History Table Per Tenant Schema

```text
tenant_a.flyway_schema_history
tenant_b.flyway_schema_history
tenant_c.flyway_schema_history
```

Kelebihan:

- history dekat dengan tenant schema,
- tenant bisa di-restore lebih independen,
- tenant version mudah diketahui dari schema itu sendiri,
- cocok untuk schema-per-tenant.

Kekurangan:

- sulit melihat semua tenant dari satu query,
- perlu global registry tambahan,
- jika schema banyak, metadata banyak.

---

## 19.2 Centralized History Table

```text
control_schema.flyway_schema_history_tenant
```

Flyway default tidak didesain sebagai one history table untuk semua tenant target dengan semantic tenant dimension. Bisa dikustomisasi per run dengan table/schema, tetapi untuk tenant dimension yang eksplisit biasanya lebih aman membuat tenant migration registry sendiri, bukan memaksa Flyway history menjadi global tenant registry.

Rekomendasi praktis:

```text
Use Flyway local history per tenant target
+ platform-level tenant_migration_registry
```

---

## 20. Flyway untuk Database-per-Tenant

Untuk database-per-tenant:

```java
for (Tenant tenant : tenants) {
    DataSource tenantDataSource = dataSourceFactory.forTenant(tenant);

    Flyway flyway = Flyway.configure()
        .dataSource(tenantDataSource)
        .locations("classpath:db/migration/tenant")
        .table("flyway_schema_history")
        .load();

    flyway.migrate();
}
```

Namun production-grade implementation harus menambahkan:

- connection timeout,
- lock timeout,
- migration timeout,
- structured logging,
- tenant id in MDC/log context,
- attempt registry,
- retry policy,
- quarantine policy,
- credentials rotation support,
- per-tenant database capability check.

Jangan membuka ribuan datasource sekaligus.

Gunakan bounded concurrency.

---

## 21. Flyway Placeholder untuk Tenant

Flyway placeholder bisa membantu membuat script generic.

Contoh:

```sql
INSERT INTO tenant_config (tenant_id, config_key, config_value)
VALUES ('${tenantId}', 'CASE_RETENTION_DAYS', '${caseRetentionDays}');
```

Konfigurasi:

```java
Flyway.configure()
    .placeholders(Map.of(
        "tenantId", tenant.id(),
        "caseRetentionDays", tenant.caseRetentionDays()
    ));
```

Tetapi hati-hati:

- jangan masukkan secret sebagai placeholder migration,
- jangan membuat script terlalu environment-specific,
- jangan membuat migration berbeda diam-diam per tenant tanpa audit,
- pastikan placeholder value tercatat di audit jika mempengaruhi data.

Placeholder cocok untuk metadata tenant yang stabil dan non-secret.

---

## 22. Liquibase untuk Schema-per-Tenant

Liquibase dapat dijalankan per tenant dengan parameter schema/default schema.

Konsep umum:

```java
try (Connection connection = dataSource.getConnection()) {
    Database database = DatabaseFactory.getInstance()
        .findCorrectDatabaseImplementation(new JdbcConnection(connection));

    database.setDefaultSchemaName(schemaName);

    Liquibase liquibase = new Liquibase(
        "db/changelog/tenant/master.xml",
        new ClassLoaderResourceAccessor(),
        database
    );

    liquibase.update(new Contexts(), new LabelExpression());
}
```

Untuk CLI/property, parameter seperti default schema dan Liquibase schema perlu dipahami dengan hati-hati.

Liquibase memiliki `DATABASECHANGELOG` untuk mencatat changeset yang sudah dijalankan dan `DATABASECHANGELOGLOCK` untuk locking. Untuk schema-per-tenant, umumnya table tersebut bisa berada per tenant schema atau pada schema tertentu tergantung konfigurasi.

---

## 23. Liquibase Contexts dan Labels untuk Multi-Tenant

Liquibase contexts dan labels dapat mengontrol changeset mana yang berjalan.

Contoh:

```xml
<changeSet id="2026-06-add-premium-config" author="team">
    <preConditions onFail="MARK_RAN">
        <tableExists tableName="tenant_config"/>
    </preConditions>
    <insert tableName="tenant_config">
        <column name="config_key" value="PREMIUM_SEARCH_ENABLED"/>
        <column name="config_value" value="true"/>
    </insert>
</changeSet>
```

Dengan context:

```xml
<changeSet id="2026-06-premium-feature" author="team" context="premium">
    ...
</changeSet>
```

Dengan label:

```xml
<changeSet id="2026-06-agency-feature" author="team" labels="agency-a,case-module">
    ...
</changeSet>
```

### Kapan contexts/labels berguna?

- tenant tier berbeda,
- feature rollout bertahap,
- module-specific tenant,
- region-specific object,
- dev/test seed berbeda dari production,
- optional feature schema.

### Bahaya contexts/labels

Jika terlalu banyak branching:

```text
context="tenantA and prod and regionSG and premium and notLegacy and wave3"
```

Maka changelog menjadi sulit dipahami, sulit dites, dan sulit diaudit.

Rule of thumb:

```text
Contexts/labels boleh mengontrol variasi yang eksplisit dan stabil.
Jangan jadikan contexts/labels sebagai tempat business routing chaos.
```

---

## 24. Per-Tenant Preconditions

Precondition sangat penting untuk tenant yang mungkin drift.

Contoh Liquibase:

```xml
<changeSet id="2026-06-add-normalized-status" author="team">
    <preConditions onFail="HALT">
        <tableExists tableName="case_record"/>
        <not>
            <columnExists tableName="case_record" columnName="normalized_status"/>
        </not>
    </preConditions>

    <addColumn tableName="case_record">
        <column name="normalized_status" type="varchar(50)"/>
    </addColumn>
</changeSet>
```

Flyway tidak punya precondition declarative setara Liquibase dalam SQL migration biasa, tetapi bisa memakai:

- vendor-specific guard SQL,
- Java migration pre-check,
- callback pre-check,
- orchestrator preflight check.

Contoh preflight di orchestrator:

```sql
SELECT COUNT(*)
FROM information_schema.columns
WHERE table_schema = ?
  AND table_name = 'case_record'
  AND column_name = 'normalized_status';
```

Jika tidak sesuai ekspektasi, tenant masuk quarantine daripada migration dipaksakan.

---

## 25. Tenant Onboarding Migration

Tenant baru harus dibuat pada versi schema yang benar.

Ada dua pendekatan.

---

## 25.1 Replay All Migrations

Saat tenant baru dibuat:

```text
create schema tenant_new
run V1
run V2
run V3
...
run V500
seed tenant defaults
```

Kelebihan:

- konsisten dengan migration history,
- mudah secara konseptual,
- tidak perlu baseline snapshot.

Kekurangan:

- lambat jika migration sudah ratusan/ribuan,
- migration lama mungkin tidak kompatibel dengan engine baru,
- seed lama mungkin obsolete,
- risk dari legacy migration meningkat.

---

## 25.2 Baseline Snapshot + Delta

Saat tenant baru dibuat:

```text
create schema tenant_new from baseline version V450
mark baseline
run V451..V500
seed tenant defaults
```

Kelebihan:

- lebih cepat,
- migration lama tidak perlu diulang,
- cocok untuk platform mature.

Kekurangan:

- baseline harus dijaga,
- baseline harus diaudit,
- baseline perlu diuji,
- ada risiko mismatch baseline vs migration chain.

Rekomendasi:

```text
Early-stage system: replay all migrations masih acceptable.
Mature system with many migrations: gunakan periodic audited baseline.
```

---

## 26. Tenant Bootstrap Seed

Tenant onboarding tidak hanya schema.

Biasanya perlu seed:

- tenant metadata,
- default roles,
- default permissions,
- default workflow state,
- default case statuses,
- default notification templates,
- default SLA rules,
- default feature flags,
- default numbering sequences,
- default document categories,
- default system user/service account.

Contoh seed flow:

```text
1. create tenant schema/database
2. migrate schema to current version
3. insert tenant metadata
4. insert reference data
5. insert default roles/permissions
6. insert default workflow config
7. insert feature flags
8. verify tenant bootstrap invariant
9. mark tenant ACTIVE
```

Tenant jangan diaktifkan sebelum bootstrap invariant lulus.

---

## 27. Tenant Bootstrap Invariants

Contoh invariants:

```text
Tenant schema exists.
Tenant schema version == target version.
Required tables exist.
Required seed rows exist.
Admin role exists.
Default permission set exists.
Default workflow states exist.
Default status mapping exists.
Feature flags initialized.
No failed migration record.
Tenant status still ONBOARDING until verification passed.
```

SQL verification contoh:

```sql
SELECT COUNT(*)
FROM role
WHERE code = 'TENANT_ADMIN';
```

```sql
SELECT COUNT(*)
FROM workflow_state
WHERE workflow_code = 'CASE'
  AND state_code IN ('DRAFT', 'SUBMITTED', 'PROCESSING', 'CLOSED');
```

Jika invariant gagal, tenant tidak boleh masuk `ACTIVE`.

---

## 28. Large Tenant vs Small Tenant Strategy

Jangan pakai strategi sama untuk semua tenant.

### Small Tenant

```text
Rows: < 100k
Migration: online, direct, low risk
Batch: larger
Window: normal deployment
```

### Medium Tenant

```text
Rows: 100k–10M
Migration: online with chunking
Batch: moderate
Window: controlled
```

### Large Tenant

```text
Rows: > 10M or business critical
Migration: expand/contract, backfill job, throttling
Batch: small
Window: dedicated
```

Tenant registry bisa menyimpan classification:

```sql
ALTER TABLE tenant_registry ADD data_size_class VARCHAR(20);
```

Values:

```text
SMALL
MEDIUM
LARGE
CRITICAL
```

Migration policy bisa berbeda:

```yaml
smallTenant:
  parallelism: 10
  backfillChunkSize: 10000

largeTenant:
  parallelism: 1
  backfillChunkSize: 1000
  requireManualApproval: true
```

---

## 29. Backfill dalam Multi-Tenant

Backfill multi-tenant perlu strategy.

Pilihan:

### 29.1 Backfill Per Tenant Serial

```text
tenant_a -> complete
tenant_b -> complete
tenant_c -> complete
```

Kelebihan:

- sederhana,
- mudah debug,
- risiko resource rendah.

Kekurangan:

- lambat.

### 29.2 Backfill Per Tenant Parallel

```text
tenant_a, tenant_b, tenant_c in parallel
```

Kelebihan:

- lebih cepat.

Kekurangan:

- resource pressure,
- lock contention,
- monitoring lebih sulit.

### 29.3 Backfill Global Worker Pool

```text
worker pool pulls tenant chunks from queue
```

Contoh queue item:

```text
tenant_id=tenant_a, table=case_record, pk_range=1..10000
tenant_id=tenant_a, table=case_record, pk_range=10001..20000
tenant_id=tenant_b, table=case_record, pk_range=1..5000
```

Ini lebih scalable, tetapi juga lebih kompleks.

---

## 30. Jangan Selalu Jalankan Backfill Besar di Flyway/Liquibase

Flyway/Liquibase bagus untuk versioned schema migration.

Tetapi backfill besar sering lebih cocok sebagai controlled batch job.

Pattern:

```text
Migration 1: add nullable column
Deployment 1: app dual-write
Batch job: backfill tenant by tenant
Migration 2: add constraint after verification
Deployment 2: read from new column
Migration 3: drop old column later
```

Jangan memaksa semuanya ke satu migration script:

```sql
ALTER TABLE huge_table ADD new_col ...;
UPDATE huge_table SET new_col = expensive_function(old_col);
ALTER TABLE huge_table ALTER COLUMN new_col SET NOT NULL;
```

Ini sering gagal di tenant besar.

---

## 31. Tenant-Specific Customization

Tenant-specific customization adalah salah satu sumber complexity terbesar.

Contoh:

```text
Tenant A punya extra column.
Tenant B punya custom workflow states.
Tenant C punya dedicated index.
Tenant D punya custom report view.
Tenant E belum memakai module tertentu.
```

Ada dua jenis customization.

### 31.1 Supported Customization

Customization resmi, diketahui platform.

Dicatat di registry:

```sql
CREATE TABLE tenant_capability (
    tenant_id VARCHAR(100),
    capability_code VARCHAR(100),
    enabled BOOLEAN,
    PRIMARY KEY (tenant_id, capability_code)
);
```

Migration bisa membaca capability ini.

### 31.2 Unsupported Drift

Customization manual atau historis yang tidak tercatat.

Ini berbahaya.

Contoh:

```text
DBA manually added index.
Old hotfix added column directly.
Tenant-specific view was patched manually.
Migration history does not know.
```

Untuk unsupported drift, jangan otomatis lanjut. Masukkan quarantine.

---

## 32. Multi-Tenant Drift Detection

Drift detection harus dilakukan per tenant.

Yang perlu dicek:

- missing table,
- missing column,
- extra column,
- different datatype,
- missing index,
- unexpected constraint,
- different seed data,
- checksum mismatch,
- history table mismatch,
- failed migration record,
- object invalid status,
- tenant data invariant violation.

Drift detection output:

```text
Tenant A: OK
Tenant B: missing index IDX_CASE_STATUS
Tenant C: column CASE_RECORD.STATUS length 30 expected 50
Tenant D: checksum mismatch at V2026_06_01_001
Tenant E: missing seed ROLE_CASE_OFFICER
```

Drift detection bisa dipakai sebelum wave rollout.

---

## 33. Multi-Tenant Migration Dashboard

Dashboard minimal:

```text
Release: 2026.06.R1
Target version: V2026.06.01.001

Total tenants: 1200
Eligible: 1150
Pending: 300
Running: 8
Success: 820
Failed retryable: 12
Failed non-retryable: 5
Quarantined: 5
Skipped: 30

P95 migration duration: 42s
Max migration duration: 18m
Total rows affected: 920M
Current wave: 3
```

Per tenant detail:

```text
Tenant: AGENCY_X
Current version: V2026.05.15.003
Target version: V2026.06.01.001
Status: FAILED_NON_RETRYABLE
Failure: duplicate status code in seed table
Last successful migration: V2026.05.30.002
Attempt: 2
Started: 2026-06-17 21:00:00
Finished: 2026-06-17 21:03:12
Runner: migration-runner-pod-7
```

Tanpa dashboard, operasi multi-tenant migration menjadi blind.

---

## 34. Observability: Logs, Metrics, Events

Setiap migration tenant harus menghasilkan log yang tenant-aware.

Structured log contoh:

```json
{
  "event": "tenant_migration_started",
  "release": "2026.06.R1",
  "tenantId": "AGENCY_X",
  "targetVersion": "V2026.06.01.001",
  "runner": "migration-runner-7",
  "attempt": 1
}
```

Success:

```json
{
  "event": "tenant_migration_succeeded",
  "release": "2026.06.R1",
  "tenantId": "AGENCY_X",
  "durationMs": 42120,
  "migrationsApplied": 4,
  "rowsAffected": 120034
}
```

Failure:

```json
{
  "event": "tenant_migration_failed",
  "release": "2026.06.R1",
  "tenantId": "AGENCY_X",
  "failureCategory": "CONSTRAINT_VIOLATION",
  "retryable": false,
  "migration": "V2026.06.01.001__add_status_constraint.sql"
}
```

Metrics:

```text
tenant_migration_total{release,status}
tenant_migration_duration_seconds{release,tenant_class}
tenant_migration_failed_total{release,failure_category}
tenant_migration_retry_total{release}
tenant_migration_quarantine_total{release}
tenant_migration_rows_affected_total{release}
```

---

## 35. Security dan Secret Management

Database-per-tenant sering berarti credential-per-tenant.

Risiko:

- secret sprawl,
- wrong credential used for wrong tenant,
- logging JDBC URL with password,
- migration user too privileged,
- tenant isolation breach,
- credential rotation mismatch,
- stale tenant connection config.

Best practice:

```text
Use separate migration identity from app identity.
Use least privilege.
Resolve credentials at runtime from secret manager.
Never store password in tenant registry table.
Never log full JDBC URL with password.
Audit which identity migrated which tenant.
Rotate credentials safely.
```

Privilege model:

```text
app_user:
  SELECT/INSERT/UPDATE/DELETE on application tables

migration_user:
  DDL privileges required for migration
  DML seed/backfill privileges
  no unnecessary superuser/admin privilege
```

Untuk schema-per-tenant, migration user bisa punya access ke semua tenant schema atau per-tenant credential. Pilihan ini adalah trade-off antara operational simplicity dan isolation.

---

## 36. Compliance dan Auditability

Dalam regulated system, pertanyaan audit bisa seperti:

- Tenant mana yang terkena migration ini?
- Siapa menyetujui migration?
- Kapan migration dijalankan?
- Migration script apa yang dijalankan?
- Checksum artifact-nya apa?
- Berapa tenant yang gagal?
- Apa evidence retry/quarantine?
- Apakah ada tenant yang masih versi lama?
- Apakah perubahan data tenant bisa dijelaskan?
- Apakah ada PII yang disentuh migration?

Maka audit event harus cukup kaya.

Contoh audit table:

```sql
CREATE TABLE tenant_migration_audit_event (
    id BIGINT PRIMARY KEY,
    release_id VARCHAR(100) NOT NULL,
    tenant_id VARCHAR(100),
    event_type VARCHAR(100) NOT NULL,
    event_time TIMESTAMP NOT NULL,
    actor VARCHAR(255) NOT NULL,
    artifact_checksum VARCHAR(255),
    details CLOB
);
```

Event:

```text
RELEASE_APPROVED
WAVE_STARTED
TENANT_MIGRATION_STARTED
TENANT_MIGRATION_SUCCEEDED
TENANT_MIGRATION_FAILED
TENANT_QUARANTINED
TENANT_RETRY_SCHEDULED
TENANT_MANUAL_FIX_APPLIED
WAVE_COMPLETED
RELEASE_COMPLETED
```

---

## 37. App Runtime Behavior Ketika Tenant Belum Dimigrasikan

Ini sering dilupakan.

Apa yang terjadi jika user tenant B mengakses aplikasi saat tenant B masih schema lama?

Pilihan:

### 37.1 App Supports Multiple Schema Versions

Aplikasi bisa bekerja dengan V9 dan V10.

Ini ideal selama rollout.

Contoh:

```java
TenantSchemaVersion version = tenantVersionService.getVersion(tenantId);

if (version.isAtLeast("10")) {
    return repository.findUsingNewColumn(...);
}
return repository.findUsingOldColumn(...);
```

Namun jangan terlalu lama mempertahankan branching ini.

### 37.2 Tenant Maintenance Mode

Tenant dikunci selama migration.

```text
Tenant A: available
Tenant B: maintenance mode 22:00-22:15
Tenant C: available
```

Ini lebih sederhana tetapi berdampak user.

### 37.3 Global Maintenance Window

Semua tenant down sementara.

Ini paling sederhana tetapi sering tidak acceptable untuk SaaS/mission-critical system.

### 37.4 Request-Level Guard

Jika tenant schema version di bawah minimum app version, request ditolak dengan controlled error.

```text
Tenant schema version unsupported. Tenant is under maintenance.
```

Lebih baik controlled error daripada runtime SQL error.

---

## 38. Feature Flag dan Tenant Migration

Feature flag sering dipakai untuk memisahkan schema rollout dari feature activation.

Pattern:

```text
1. Add schema support to all/selected tenants.
2. Backfill data.
3. Verify tenant readiness.
4. Enable feature flag per tenant.
5. Monitor.
6. Contract old schema later.
```

Tenant feature readiness table:

```sql
CREATE TABLE tenant_feature_readiness (
    tenant_id VARCHAR(100),
    feature_code VARCHAR(100),
    schema_ready BOOLEAN NOT NULL,
    data_ready BOOLEAN NOT NULL,
    config_ready BOOLEAN NOT NULL,
    enabled BOOLEAN NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    PRIMARY KEY (tenant_id, feature_code)
);
```

Jangan aktifkan feature hanya karena migration file sukses.

Aktifkan feature setelah invariant readiness terpenuhi.

---

## 39. Data Quality Problem Per Tenant

Migration sering gagal bukan karena schema, tetapi data quality.

Contoh:

```sql
ALTER TABLE user_account ADD CONSTRAINT uq_user_email UNIQUE (email);
```

Tenant A aman.
Tenant B punya duplicate email.
Tenant C punya null email.
Tenant D punya email invalid.

Preflight:

```sql
SELECT email, COUNT(*)
FROM user_account
GROUP BY email
HAVING COUNT(*) > 1;
```

Per-tenant output:

```text
Tenant A: 0 duplicate
Tenant B: 15 duplicate
Tenant C: 0 duplicate
Tenant D: 2 duplicate
```

Tenant B/D harus diperbaiki sebelum constraint migration.

Ini alasan preflight wajib ada untuk destructive/constraint migration.

---

## 40. Handling Failed Tenant Migration

Saat tenant migration gagal, jangan panik dan jangan langsung repair sembarangan.

Gunakan decision flow:

```text
1. Was the migration transactional?
   - yes: likely rolled back
   - no: inspect partial state

2. Did tool history mark it failed?
   - yes: check local history
   - no: check object state manually

3. Is failure retryable?
   - yes: retry with backoff
   - no: quarantine

4. Is tenant app traffic impacted?
   - yes: maintenance mode / route isolation
   - no: continue rollout if policy allows

5. Is repair needed?
   - only after understanding physical state

6. Is roll-forward possible?
   - prefer roll-forward for production
```

Catatan penting:

```text
Repair tool history is not the same as repairing database state.
```

Flyway repair atau Liquibase clear lock/checksum handling tidak otomatis memperbaiki object/data yang sudah berubah sebagian.

---

## 41. Tenant Migration Runbook

Minimal runbook untuk production:

### Pre-flight

```text
- Confirm release artifact checksum.
- Confirm tenant selector result.
- Confirm excluded/quarantined tenants.
- Confirm backup/snapshot policy.
- Confirm migration user credential.
- Confirm DB capacity.
- Confirm lock/statement timeout.
- Confirm app compatibility matrix.
- Confirm rollback/roll-forward policy.
- Confirm dashboard and alerting ready.
```

### During-flight

```text
- Start wave 0.
- Monitor failure category.
- Monitor duration p95/p99.
- Monitor DB CPU/IO/locks.
- Monitor application error rate.
- Pause if failure threshold exceeded.
- Quarantine non-retryable failures.
- Continue if within policy.
```

### Post-flight

```text
- Verify all target tenants status.
- Verify schema version distribution.
- Verify seed/data invariants.
- Verify application errors.
- Verify no stuck locks.
- Verify no failed local tool history.
- Export audit report.
- Document quarantined tenants.
- Plan remediation wave.
```

---

## 42. Failure Threshold dan Circuit Breaker

Multi-tenant migration harus punya stop condition.

Contoh policy:

```yaml
failurePolicy:
  stopWaveIfFailureRateAbovePercent: 5
  stopWaveIfNonRetryableFailuresAbove: 3
  stopAllIfCriticalTenantFails: true
  stopAllIfP95DurationAboveSeconds: 300
  stopAllIfDbCpuAbovePercent: 85
  stopAllIfReplicationLagAboveSeconds: 120
```

Tanpa circuit breaker, orchestrator bisa terus merusak tenant berikutnya dengan migration yang salah.

Circuit breaker penting terutama untuk:

- bad SQL,
- wrong assumption,
- missing seed,
- data quality issue widespread,
- lock storm,
- DB overload,
- wrong credential mapping.

---

## 43. Multi-Tenant Migration Artifact Design

Migration artifact harus immutable dan traceable.

Contoh artifact:

```text
migration-bundle-2026.06.R1.zip
  /flyway/db/migration/tenant/V2026_06_01_001__add_case_status.sql
  /flyway/db/migration/global/V2026_06_01_001__add_global_config.sql
  /liquibase/db/changelog/tenant/master.xml
  /metadata/release.json
  /metadata/checksums.sha256
  /metadata/compatibility.json
  /metadata/tenant-selector.sql
```

`release.json`:

```json
{
  "releaseId": "2026.06.R1",
  "targetTenantSchemaVersion": "2026.06.01.001",
  "minSupportedTenantSchemaVersion": "2026.05.01.000",
  "requiresAppVersion": "5.6.0",
  "createdBy": "platform-team",
  "createdAt": "2026-06-17T10:00:00Z"
}
```

`compatibility.json`:

```json
{
  "applicationVersion": "5.6.0",
  "supportsTenantSchemaVersions": [
    "2026.05.01.000",
    "2026.06.01.001"
  ],
  "contractRemovalPlannedAfter": "2026.07.R1"
}
```

---

## 44. Shared Reference Schema dalam Multi-Tenant

Banyak sistem punya global reference schema.

Contoh:

```text
global.country
global.currency
global.permission_catalog
global.feature_catalog
global.status_catalog
```

Tenant schema refer ke global reference.

Migration urutan:

```text
1. migrate global reference schema
2. seed global reference data
3. migrate tenant schemas
4. seed tenant-specific mapping
```

Bahaya:

- tenant migration butuh reference data yang belum ada,
- global seed berubah breaking untuk tenant lama,
- tenant override tidak sinkron,
- global change tidak backward-compatible.

Gunakan additive change dulu.

Contoh:

```text
Add new status to global catalog.
Tenant migration maps old status to new status.
Application supports both.
After all tenants migrated, old status deprecated.
```

---

## 45. Reporting dan Analytics Schema

Multi-tenant system sering punya reporting schema/warehouse.

Transactional tenant migration belum cukup.

Pertanyaan:

- Apakah reporting view harus berubah setelah tenant schema berubah?
- Apakah ETL/CDC pipeline kompatibel dengan schema lama dan baru?
- Apakah tenant yang belum migrated masih bisa dilaporkan?
- Apakah reporting harus menampilkan versi data berbeda?
- Apakah materialized view perlu refresh per tenant?

Pattern:

```text
1. Expand transactional schema.
2. Update CDC/ETL to tolerate old + new schema.
3. Backfill tenant data.
4. Update reporting view with compatibility logic.
5. Switch dashboard.
6. Contract old schema later.
```

Jangan lupa bahwa database migration berdampak ke consumer non-application juga.

---

## 46. Testing Multi-Tenant Migration

Testing harus mencakup variasi tenant.

Minimal dataset:

```text
Tenant small clean
Tenant medium clean
Tenant large synthetic
Tenant with old version
Tenant with missing optional feature
Tenant with custom feature enabled
Tenant with bad data
Tenant with previous failed migration
Tenant newly onboarded
Tenant suspended
```

Test cases:

```text
- migrate all eligible tenants
- skip suspended tenant
- quarantine bad data tenant
- retry lock timeout tenant
- stop wave on failure threshold
- onboard new tenant from baseline
- verify tenant registry updated
- verify local Flyway/Liquibase history
- verify app compatibility with old tenant version
```

Testcontainers bisa membantu untuk menjalankan real database engine, tetapi multi-tenant behavior tetap perlu disimulasikan secara eksplisit.

---

## 47. Java Implementation Sketch: Migration Orchestrator

Contoh struktur sederhana:

```text
com.example.migration
  TenantMigrationApplication
  TenantSelector
  TenantRegistryRepository
  TenantMigrationRegistryRepository
  TenantMigrationRunner
  FlywayTenantMigrationRunner
  LiquibaseTenantMigrationRunner
  TenantLockManager
  MigrationPreflightChecker
  MigrationPostflightVerifier
  MigrationRetryPolicy
  TenantQuarantineService
  MigrationMetrics
```

Interface:

```java
public interface TenantMigrationRunner {
    MigrationResult migrate(Tenant tenant, MigrationPlan plan) throws MigrationException;
}
```

Flyway runner:

```java
public final class FlywayTenantMigrationRunner implements TenantMigrationRunner {

    private final TenantDataSourceFactory dataSourceFactory;

    public FlywayTenantMigrationRunner(TenantDataSourceFactory dataSourceFactory) {
        this.dataSourceFactory = dataSourceFactory;
    }

    @Override
    public MigrationResult migrate(Tenant tenant, MigrationPlan plan) {
        DataSource dataSource = dataSourceFactory.create(tenant);

        Flyway flyway = Flyway.configure()
            .dataSource(dataSource)
            .locations(plan.locations().toArray(new String[0]))
            .schemas(tenant.schemaName())
            .defaultSchema(tenant.schemaName())
            .table("flyway_schema_history")
            .placeholders(plan.placeholdersFor(tenant))
            .load();

        int migrations = flyway.migrate().migrationsExecuted;

        return MigrationResult.success(migrations);
    }
}
```

Production implementation harus menambahkan error mapping, duration, logs, timeout, dan cleanup.

---

## 48. Java Implementation Sketch: Bounded Parallel Execution

```java
ExecutorService executor = Executors.newFixedThreadPool(policy.maxConcurrency());
CompletionService<TenantMigrationOutcome> completionService =
    new ExecutorCompletionService<>(executor);

for (Tenant tenant : tenants) {
    completionService.submit(() -> migrateOneTenant(tenant, plan));
}

int submitted = tenants.size();
int completed = 0;

while (completed < submitted) {
    Future<TenantMigrationOutcome> future = completionService.take();
    TenantMigrationOutcome outcome = future.get();

    completed++;
    failurePolicy.record(outcome);

    if (failurePolicy.shouldStop()) {
        executor.shutdownNow();
        break;
    }
}
```

Catatan:

- Java 8 bisa pakai `ExecutorService`.
- Java 21/25 bisa mempertimbangkan virtual threads untuk IO-bound orchestration, tetapi tetap harus dibatasi oleh DB capacity.
- Virtual threads tidak berarti boleh membuka migration tak terbatas.
- Bottleneck utama tetap database.

---

## 49. Anti-Patterns

### 49.1 Run All Tenants Blindly

```text
for every tenant: migrate
```

Tanpa preflight, wave, retry, quarantine, atau dashboard.

### 49.2 Global Stop Karena Satu Tenant Jelek

Satu tenant data-nya rusak, semua tenant lain tidak mendapat migration.

Harus ada quarantine policy.

### 49.3 Ignore Drift

Aplikasi mengasumsikan semua tenant berada di versi terbaru.

Tenant yang tertinggal akan error runtime.

### 49.4 Tenant-Specific SQL Tidak Terdokumentasi

```sql
-- quick fix for tenant A
UPDATE ...
```

Tanpa audit/registry.

Ini technical debt berbahaya.

### 49.5 Context/Label Explosion

Liquibase contexts/labels dipakai untuk semua variasi tenant hingga changelog tidak bisa dipahami.

### 49.6 Backfill Besar di Startup Migration

Aplikasi startup menunggu backfill tenant besar selesai.

Akibatnya deployment timeout atau pod crashloop.

### 49.7 No App Compatibility Window

Migration dan aplikasi harus sempurna serentak untuk semua tenant.

Ini rapuh.

### 49.8 No Failure Threshold

Migration salah terus berjalan ke 1.000 tenant.

Harus ada circuit breaker.

### 49.9 Repair History Without Repairing State

Menghapus/memperbaiki record history tanpa memastikan object/data aktual benar.

Ini bisa menyembunyikan corruption.

### 49.10 Tenant Registry as Secret Store

Menyimpan password tenant database dalam table registry.

Gunakan secret manager.

---

## 50. Decision Framework

Gunakan pertanyaan berikut sebelum mendesain multi-tenant migration.

### 50.1 Tenancy Model

```text
Apakah tenant shared schema, schema-per-tenant, database-per-tenant, atau hybrid?
Apakah model ini akan berubah?
Apakah ada tenant dedicated?
```

### 50.2 Versioning

```text
Apakah tiap tenant punya schema history sendiri?
Apakah ada global migration registry?
Apakah aplikasi mendukung tenant version drift?
Berapa versi minimum tenant yang didukung?
```

### 50.3 Rollout

```text
Apakah migration dijalankan semua tenant sekaligus atau wave?
Bagaimana memilih tenant eligible?
Bagaimana skip/quarantine tenant?
Apa stop condition?
```

### 50.4 Failure

```text
Apa failure yang retryable?
Apa failure yang non-retryable?
Apakah migration idempotent?
Apakah partial migration bisa terjadi?
Apa recovery plan?
```

### 50.5 Data Volume

```text
Apakah tenant besar butuh strategi khusus?
Apakah backfill harus job terpisah?
Apakah ada throttling?
```

### 50.6 Security

```text
Siapa migration user?
Bagaimana credential tenant disimpan?
Apakah migration user terlalu powerful?
Apakah audit mencatat actor dan artifact?
```

### 50.7 Operations

```text
Apakah dashboard ada?
Apakah logs tenant-aware?
Apakah metrics per tenant/wave/release ada?
Apakah runbook jelas?
```

---

## 51. Practical Blueprint

Untuk kebanyakan enterprise multi-tenant Java system, blueprint yang sehat:

```text
1. Gunakan Flyway/Liquibase sebagai local migration engine.
2. Simpan local history di tiap tenant schema/database.
3. Buat global tenant registry.
4. Buat global tenant migration registry.
5. Jalankan migration melalui orchestrator/pipeline, bukan random app startup semua pod.
6. Gunakan wave rollout.
7. Gunakan bounded concurrency.
8. Gunakan preflight dan postflight checks.
9. Gunakan retry hanya untuk failure yang aman.
10. Gunakan quarantine untuk tenant bermasalah.
11. Pastikan aplikasi mendukung compatibility window.
12. Pisahkan schema migration dan large backfill.
13. Gunakan feature flag untuk activation.
14. Audit semua attempt.
15. Dashboard-kan status semua tenant.
```

---

## 52. Example End-to-End Scenario

### Problem

Kita ingin menambahkan `normalized_status` ke table `case_record` untuk semua tenant.

### Bad Approach

```sql
ALTER TABLE case_record ADD normalized_status VARCHAR(50);
UPDATE case_record SET normalized_status = UPPER(status);
ALTER TABLE case_record ALTER COLUMN normalized_status SET NOT NULL;
```

Dijalankan ke semua tenant sekaligus.

Risiko:

- tenant besar lock lama,
- tenant dengan bad data gagal,
- tenant yang gagal menghentikan rollout,
- aplikasi baru mengasumsikan kolom wajib ada,
- rollback sulit.

### Better Approach

Release 1 — Expand:

```text
Add nullable normalized_status.
App dual-writes status and normalized_status.
App can read old/new.
```

Migration:

```sql
ALTER TABLE case_record ADD normalized_status VARCHAR(50);
```

Rollout:

```text
Wave 0: internal tenants
Wave 1: small tenants
Wave 2: medium tenants
Wave 3: large tenants separately
```

Backfill:

```text
Run tenant-aware batch job.
Chunk by primary key.
Record progress per tenant.
Throttle large tenants.
```

Verification:

```sql
SELECT COUNT(*)
FROM case_record
WHERE normalized_status IS NULL;
```

Release 2 — Enforce:

```text
Add constraint only for tenants with zero null.
```

Release 3 — Switch read:

```text
App reads normalized_status.
```

Release 4 — Contract:

```text
Drop old status or keep as compatibility depending on policy.
```

Ini production-grade.

---

## 53. Ringkasan

Multi-tenant database migration adalah masalah orchestration, bukan hanya masalah SQL.

Hal terpenting:

1. Tenant adalah unit lifecycle migration.
2. Tiap tenant bisa punya versi, kondisi data, dan failure mode berbeda.
3. Flyway/Liquibase memberi migration engine, tetapi orchestrator tetap diperlukan untuk estate multi-tenant.
4. Local history table perlu dilengkapi global tenant migration registry.
5. Tenant version drift harus dikontrol, bukan diabaikan.
6. Wave rollout, bounded concurrency, retry policy, quarantine, dashboard, dan runbook adalah komponen wajib untuk skala besar.
7. Large tenant tidak boleh diperlakukan sama dengan small tenant.
8. Backfill besar sering lebih cocok sebagai job terpisah daripada migration startup.
9. Aplikasi harus punya compatibility strategy selama tenant belum seragam versinya.
10. Auditability dan observability adalah bagian inti, bukan tambahan.

Mental model akhirnya:

```text
Single-tenant migration:
  change database from version A to B

Multi-tenant migration:
  safely distribute, verify, observe, and govern database change
  across many isolated tenant states with controlled drift and recovery.
```

---

## 54. Checklist Praktis

Sebelum melakukan migration multi-tenant, pastikan:

```text
[ ] Tenancy model jelas.
[ ] Tenant registry tersedia.
[ ] Tenant migration registry tersedia.
[ ] Local Flyway/Liquibase history aktif.
[ ] Tenant selector deterministic.
[ ] Wave rollout didefinisikan.
[ ] Concurrency limit didefinisikan.
[ ] Retry policy didefinisikan.
[ ] Quarantine policy didefinisikan.
[ ] Preflight checks tersedia.
[ ] Postflight checks tersedia.
[ ] App compatibility matrix tersedia.
[ ] Feature flag/readiness strategy tersedia.
[ ] Large tenant strategy tersedia.
[ ] Backfill strategy tersedia.
[ ] Dashboard tersedia.
[ ] Logs tenant-aware.
[ ] Metrics tersedia.
[ ] Audit event tersedia.
[ ] Secret handling aman.
[ ] Runbook production tersedia.
[ ] Stop condition/circuit breaker tersedia.
```

---

## 55. Kapan Seri Ini Selesai?

Belum selesai.

Kita sudah menyelesaikan:

```text
Part 28 — Multi-Tenant Database Migration
```

Berikutnya:

```text
Part 29 — Security, Compliance, and Auditability
File: 29-security-compliance-auditability.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./27-multiservice-multimodule-shared-database-migrations.md">⬅️ Part 27 — Multi-Service, Multi-Module, and Shared Database Migrations</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./29-security-compliance-auditability.md">Security, Compliance, and Auditability in Database Migration ➡️</a>
</div>

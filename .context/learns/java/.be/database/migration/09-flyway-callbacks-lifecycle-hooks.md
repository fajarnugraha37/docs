# 09 — Flyway Callbacks and Lifecycle Hooks

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Bagian: 09 dari 34  
> Topik: Flyway callbacks, lifecycle hooks, auditability, session setup, timeout, observability, dan guardrail operasional  
> Target: Java 8 sampai Java 25, dengan fokus pada engineering discipline, bukan sekadar konfigurasi tool

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

1. mental model Flyway,
2. setup Flyway untuk Java 8 sampai Java 25,
3. desain SQL migration,
4. repeatable migration,
5. Java-based migration.

Bagian ini membahas fitur yang sering dianggap kecil tetapi sangat penting dalam sistem serius: **Flyway callbacks**.

Callback adalah mekanisme untuk menjalankan logic pada titik tertentu dalam lifecycle Flyway, misalnya:

- sebelum proses migration dimulai,
- sebelum setiap migration dijalankan,
- sesudah setiap migration berhasil,
- ketika migration gagal,
- setelah keseluruhan migration selesai,
- sebelum validate,
- setelah clean,
- dan event lain dalam lifecycle Flyway.

Namun bagian ini tidak akan berhenti di “buat file `beforeMigrate.sql`”. Fokus utama kita adalah memahami callback sebagai **control plane** untuk database migration.

Artinya:

- migration file berisi perubahan schema/data,
- callback berisi logic pendukung lifecycle,
- pipeline berisi orkestrasi deployment,
- monitoring/logging berisi observability,
- runbook berisi respon operasional.

Engineer yang kuat tidak mencampur semua itu ke satu tempat.

---

## 1. Mental Model: Migration Plane vs Control Plane

Sebelum membahas syntax, kita perlu membedakan dua lapisan.

### 1.1 Migration Plane

Migration plane adalah lapisan yang mengubah database.

Contoh:

```sql
ALTER TABLE customer ADD email_verified BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_customer_email ON customer(email);
UPDATE account SET status = 'ACTIVE' WHERE status IS NULL;
```

Migration plane menjawab pertanyaan:

> “Perubahan apa yang harus terjadi pada database?”

Di Flyway, ini biasanya ada pada:

```text
V001__create_customer_table.sql
V002__add_customer_email.sql
V003__backfill_customer_status.sql
R__customer_view.sql
```

### 1.2 Control Plane

Control plane adalah lapisan yang mengontrol, mengamati, dan menjaga proses migration.

Contoh:

```sql
-- set lock timeout before migration
SET lock_timeout = '5s';
```

```sql
-- insert audit row after migration
INSERT INTO migration_audit(event_type, executed_at)
VALUES ('AFTER_MIGRATE', CURRENT_TIMESTAMP);
```

```java
// emit metric after each migration
metrics.record("flyway.migration.duration", duration);
```

Control plane menjawab pertanyaan:

> “Bagaimana proses migration dikontrol, diamati, dan diamankan?”

Callback berada di control plane.

### 1.3 Mengapa Pemisahan Ini Penting?

Jika control plane dicampur ke migration plane, migration menjadi:

- sulit dibaca,
- sulit direview,
- sulit diuji,
- sulit dipindahkan antar environment,
- rawan duplikasi,
- rawan inkonsistensi,
- sulit diaudit.

Contoh buruk:

```sql
-- V120__add_customer_risk_score.sql

INSERT INTO deployment_log(event_name, created_at)
VALUES ('starting V120', CURRENT_TIMESTAMP);

SET lock_timeout = '5s';

ALTER TABLE customer ADD risk_score NUMBER(5,2);

INSERT INTO deployment_log(event_name, created_at)
VALUES ('finished V120', CURRENT_TIMESTAMP);
```

Masalahnya:

1. Setiap migration harus mengulang logging.
2. Jika lupa menambahkan logging, audit tidak konsisten.
3. Jika format logging berubah, semua migration baru harus mengikuti manual.
4. Logic operasional bercampur dengan perubahan domain schema.

Lebih baik:

```text
callbacks/
  beforeEachMigrate.sql
  afterEachMigrate.sql
  afterEachMigrateError.sql

migrations/
  V120__add_customer_risk_score.sql
```

Migration tetap fokus pada perubahan database.

Callback fokus pada lifecycle behavior.

---

## 2. Apa Itu Flyway Callback?

Flyway callback adalah script atau class Java yang dijalankan oleh Flyway ketika event lifecycle tertentu terjadi.

Secara sederhana:

```text
Flyway command: migrate
        |
        v
beforeMigrate callback
        |
        v
beforeEachMigrate callback
        |
        v
V001 migration
        |
        v
afterEachMigrate callback
        |
        v
beforeEachMigrate callback
        |
        v
V002 migration
        |
        v
afterEachMigrate callback
        |
        v
afterMigrate callback
```

Jika terjadi error:

```text
beforeEachMigrate
        |
        v
V003 migration fails
        |
        v
afterEachMigrateError
        |
        v
afterMigrateError
```

Callback dapat ditulis sebagai:

1. **SQL callback**
2. **Java callback**
3. **script callback**, tergantung dukungan edisi/format yang dipakai

Untuk mayoritas Java application team, dua bentuk paling relevan adalah:

- SQL callback,
- Java callback.

---

## 3. Callback Bukan Migration

Ini prinsip penting.

Callback **bukan** tempat utama untuk melakukan perubahan schema.

Callback boleh melakukan hal seperti:

- setup session,
- set timeout,
- tulis audit event,
- validate environment guard,
- emit metrics,
- cleanup temporary runtime state,
- collect diagnostics on failure.

Callback sebaiknya tidak melakukan:

- `ALTER TABLE` utama,
- create table domain,
- business backfill,
- data correction besar,
- seed data utama,
- permission model utama,
- migration yang harus versioned.

Mengapa?

Karena callback tidak punya posisi versioning yang sama seperti migration file.

Migration:

```text
V101__add_case_priority.sql
```

punya identitas historis jelas.

Callback:

```text
afterMigrate.sql
```

berjalan berdasarkan event lifecycle, bukan sebagai perubahan domain yang punya versi bisnis.

Jika callback diubah hari ini, perilakunya untuk migration run berikutnya berubah. Ini kuat untuk control plane, tetapi berbahaya untuk business schema change.

---

## 4. Bentuk Callback di Flyway

## 4.1 SQL Callback

SQL callback adalah file SQL yang namanya mengikuti nama event callback.

Contoh:

```text
src/main/resources/db/callback/
  beforeMigrate.sql
  beforeEachMigrate.sql
  afterEachMigrate.sql
  afterEachMigrateError.sql
  afterMigrate.sql
```

Konfigurasi lokasi callback tergantung setup.

Contoh Flyway config konseptual:

```properties
flyway.locations=classpath:db/migration
flyway.callbackLocations=classpath:db/callback
```

Pada Spring Boot:

```properties
spring.flyway.locations=classpath:db/migration
spring.flyway.callback-locations=classpath:db/callback
```

Catatan: nama property bisa berbeda tergantung integrasi/version wrapper, jadi selalu validasi dengan dokumentasi versi yang digunakan.

SQL callback cocok untuk:

- session setting,
- lightweight audit insert,
- database-native diagnostics,
- guard check sederhana,
- setting lock/statement timeout.

Contoh:

```sql
-- beforeMigrate.sql
-- PostgreSQL example
SET lock_timeout = '5s';
SET statement_timeout = '10min';
```

Contoh Oracle:

```sql
-- beforeMigrate.sql
ALTER SESSION SET ddl_lock_timeout = 30;
```

Contoh SQL Server:

```sql
-- beforeMigrate.sql
SET LOCK_TIMEOUT 5000;
```

SQL callback sangat dekat dengan database behavior, sehingga cocok untuk hal-hal yang memang database-specific.

---

## 4.2 Java Callback

Java callback adalah class Java yang mengimplementasikan contract callback Flyway.

Secara konseptual:

```java
import org.flywaydb.core.api.callback.Callback;
import org.flywaydb.core.api.callback.Context;
import org.flywaydb.core.api.callback.Event;

public final class MigrationAuditCallback implements Callback {

    @Override
    public boolean supports(Event event, Context context) {
        return event == Event.AFTER_EACH_MIGRATE
            || event == Event.AFTER_EACH_MIGRATE_ERROR;
    }

    @Override
    public boolean canHandleInTransaction(Event event, Context context) {
        return true;
    }

    @Override
    public void handle(Event event, Context context) {
        // Use context.getConnection() carefully.
        // Insert audit row, emit logs, collect metadata, etc.
    }

    @Override
    public String getCallbackName() {
        return "migration-audit-callback";
    }
}
```

Java callback cocok untuk:

- structured logging,
- metrics emission,
- integration dengan observability stack,
- logic audit yang reusable,
- JSON audit payload,
- environment guard yang butuh konfigurasi aplikasi,
- correlation id handling,
- custom policy enforcement.

Namun Java callback lebih berbahaya jika dipakai sembarangan karena ia bisa:

- membuka network call,
- membaca config terlalu banyak,
- memanggil service eksternal,
- membuat migration tidak deterministic,
- membuat deployment tergantung sistem lain.

Prinsip praktis:

> SQL callback untuk database session behavior. Java callback untuk application-level observability/policy yang ringan dan deterministic.

---

## 5. Callback Event Lifecycle

Flyway menyediakan banyak event lifecycle. Tidak semua harus digunakan.

Secara praktis, event yang paling sering relevan untuk command `migrate` adalah:

```text
beforeMigrate
beforeEachMigrate
beforeEachMigrateStatement
afterEachMigrateStatement
afterEachMigrateStatementError
afterEachMigrate
afterEachMigrateError
afterMigrate
afterMigrateApplied
afterMigrateError
```

Ada juga event untuk command lain seperti:

```text
beforeValidate
afterValidate
afterValidateError
beforeClean
afterClean
afterCleanError
beforeInfo
afterInfo
beforeBaseline
afterBaseline
beforeRepair
afterRepair
```

Tidak semua event tersedia sama untuk semua connector/native connector/edisi/version. Karena itu, jangan mendesain governance yang bergantung pada event yang belum diverifikasi di runtime yang dipakai.

---

## 6. Lifecycle `migrate` Secara Detail

Mari lihat urutan konseptual.

```text
flyway migrate
  |
  +-- beforeMigrate
  |
  +-- for each pending versioned migration:
  |      |
  |      +-- beforeEachMigrate
  |      |
  |      +-- beforeEachMigrateStatement
  |      +-- execute statement
  |      +-- afterEachMigrateStatement
  |      |
  |      +-- if statement error:
  |      |      +-- afterEachMigrateStatementError
  |      |      +-- afterEachMigrateError
  |      |      +-- afterMigrateError
  |      |
  |      +-- afterEachMigrate
  |
  +-- beforeRepeatables
  |
  +-- for each pending repeatable migration:
  |      +-- beforeEachMigrate
  |      +-- execute repeatable
  |      +-- afterEachMigrate
  |
  +-- afterMigrate
  |
  +-- afterMigrateApplied, if at least one migration was applied
```

Poin penting:

- `afterMigrate` bisa berjalan walaupun tidak ada migration baru, tergantung versi/event behavior.
- `afterMigrateApplied` lebih tepat jika logic hanya boleh terjadi ketika ada migration yang benar-benar diterapkan.
- `beforeEachMigrate` terjadi untuk tiap migration, bukan sekali per run.
- Statement-level callback bisa sangat mahal jika migration berisi banyak statement.

---

## 7. Event Selection: Jangan Pakai Semua Event

Top engineer tidak bertanya:

> “Callback apa saja yang tersedia?”

Tetapi:

> “Event apa yang benar-benar perlu kita hook, dan apa konsekuensinya?”

Tabel praktis:

| Kebutuhan | Event yang Cocok | Catatan |
|---|---|---|
| Set session timeout sebelum migration | `beforeMigrate` | Biasanya SQL callback |
| Set variable sebelum setiap migration | `beforeEachMigrate` | Hati-hati overhead |
| Audit setiap migration sukses | `afterEachMigrate` | Cocok untuk audit granular |
| Audit failure per migration | `afterEachMigrateError` | Penting untuk incident response |
| Notify setelah semua migration sukses | `afterMigrateApplied` | Lebih aman daripada `afterMigrate` jika hanya ingin saat ada perubahan |
| Collect diagnostics saat run gagal | `afterMigrateError` | Jangan terlalu berat |
| Statement-level logging | `beforeEachMigrateStatement`/`afterEachMigrateStatement` | Jarang perlu; overhead tinggi |
| Policy check sebelum validate | `beforeValidate` | Untuk governance advanced |
| Prevent accidental clean | `beforeClean` | Lebih baik disable clean di config production |

---

## 8. Use Case Callback yang Sehat

## 8.1 Session-Level Timeout

Migration production sering gagal karena lock menunggu terlalu lama.

Daripada setiap migration menulis timeout manual, gunakan callback.

PostgreSQL:

```sql
-- db/callback/beforeMigrate.sql
SET lock_timeout = '5s';
SET statement_timeout = '15min';
```

Oracle:

```sql
-- db/callback/beforeMigrate.sql
ALTER SESSION SET ddl_lock_timeout = 30;
```

SQL Server:

```sql
-- db/callback/beforeMigrate.sql
SET LOCK_TIMEOUT 5000;
```

MySQL/MariaDB caveat:

- behavior lock/timeout berbeda,
- beberapa setting tergantung engine/version,
- online DDL tetap perlu dianalisis per statement.

Mental model:

> Callback tidak membuat migration otomatis aman. Callback hanya memberi default guardrail.

Migration tetap harus didesain agar lock-aware.

---

## 8.2 Audit Start/End Migration Run

Misalnya kita ingin mencatat migration run ke tabel audit internal.

```sql
CREATE TABLE migration_run_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    database_name VARCHAR(200),
    schema_name VARCHAR(200),
    executed_at TIMESTAMP NOT NULL,
    executed_by VARCHAR(200),
    notes VARCHAR(1000)
);
```

Callback:

```sql
-- beforeMigrate.sql
INSERT INTO migration_run_audit (
    event_type,
    database_name,
    schema_name,
    executed_at,
    executed_by,
    notes
) VALUES (
    'BEFORE_MIGRATE',
    CURRENT_DATABASE,
    CURRENT_SCHEMA,
    CURRENT_TIMESTAMP,
    CURRENT_USER,
    'Flyway migration run started'
);
```

Vendor-specific caveat:

- `CURRENT_DATABASE` tidak universal.
- `CURRENT_SCHEMA` tidak universal.
- Oracle, PostgreSQL, SQL Server, MySQL punya function berbeda.

Jadi jangan membuat callback portable palsu. Buat folder vendor-specific jika perlu.

Contoh layout:

```text
src/main/resources/
  db/
    migration/
      postgresql/
      oracle/
    callback/
      postgresql/
        beforeMigrate.sql
        afterMigrateApplied.sql
      oracle/
        beforeMigrate.sql
        afterMigrateApplied.sql
```

---

## 8.3 Audit Per Migration

Audit run-level menjawab:

> “Kapan migration run dimulai dan selesai?”

Audit per-migration menjawab:

> “Migration mana yang berhasil atau gagal?”

Secara ideal, Flyway schema history table sudah menyimpan histori migration. Namun dalam beberapa organisasi, kita tetap membuat audit tambahan untuk compliance, correlation, atau integrasi dashboard.

Contoh:

```sql
CREATE TABLE migration_event_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    event_time TIMESTAMP NOT NULL,
    executed_by VARCHAR(200),
    note VARCHAR(1000)
);
```

Callback:

```sql
-- afterEachMigrate.sql
INSERT INTO migration_event_audit (
    event_type,
    event_time,
    executed_by,
    note
) VALUES (
    'AFTER_EACH_MIGRATE',
    CURRENT_TIMESTAMP,
    CURRENT_USER,
    'A migration completed successfully'
);
```

Keterbatasan SQL callback:

- akses metadata migration yang sedang berjalan bisa terbatas,
- placeholder mungkin membantu, tetapi tidak semua metadata tersedia seperti yang kita inginkan,
- Java callback lebih fleksibel untuk membaca context.

---

## 8.4 Environment Guard

Callback bisa mencegah migration berjalan pada environment yang salah.

Contoh kasus:

- migration production tidak boleh pakai user dev,
- migration tidak boleh berjalan di schema yang salah,
- migration tidak boleh berjalan di database replica,
- migration tidak boleh berjalan di luar maintenance window,
- migration tidak boleh berjalan jika app masih punya koneksi aktif di versi lama.

Contoh sederhana PostgreSQL:

```sql
-- beforeMigrate.sql
DO $$
BEGIN
    IF current_schema() <> 'app_schema' THEN
        RAISE EXCEPTION 'Migration must run on app_schema, current schema is %', current_schema();
    END IF;
END $$;
```

Contoh Oracle:

```sql
-- beforeMigrate.sql
DECLARE
    v_user VARCHAR2(128);
BEGIN
    SELECT USER INTO v_user FROM dual;

    IF v_user <> 'APP_OWNER' THEN
        RAISE_APPLICATION_ERROR(-20001, 'Migration must run as APP_OWNER');
    END IF;
END;
/
```

Namun hati-hati: terlalu banyak environment branching di callback bisa membuat behavior sulit diprediksi.

Prinsip:

> Callback guard boleh menghentikan migration jika invariant operasional dilanggar. Tetapi callback tidak boleh menjadi tempat semua policy bisnis deployment disembunyikan.

---

## 8.5 Diagnostics on Failure

Saat migration gagal, kita ingin data untuk debugging.

Callback `afterEachMigrateError` atau `afterMigrateError` dapat digunakan untuk mengambil snapshot ringan.

Contoh konseptual:

```sql
-- afterMigrateError.sql
INSERT INTO migration_failure_audit (
    failed_at,
    executed_by,
    diagnostic_note
) VALUES (
    CURRENT_TIMESTAMP,
    CURRENT_USER,
    'Migration failed. Check Flyway logs, schema history, lock views, and deployment pipeline logs.'
);
```

Untuk diagnostics lebih advanced, Java callback bisa emit structured log:

```java
public final class MigrationFailureLoggingCallback implements Callback {

    @Override
    public boolean supports(Event event, Context context) {
        return event == Event.AFTER_MIGRATE_ERROR
            || event == Event.AFTER_EACH_MIGRATE_ERROR;
    }

    @Override
    public boolean canHandleInTransaction(Event event, Context context) {
        return false;
    }

    @Override
    public void handle(Event event, Context context) {
        System.err.println("Flyway migration failure event=" + event.getId());
    }

    @Override
    public String getCallbackName() {
        return "migration-failure-logging";
    }
}
```

Tetapi jangan melakukan hal berat seperti:

- query lock besar yang lambat,
- dump data ribuan baris,
- call incident API yang bisa timeout,
- mengirim email synchronous,
- memanggil Slack webhook tanpa timeout.

Failure callback harus **ringan, cepat, dan tidak memperburuk failure**.

---

## 8.6 Metrics Emission

Untuk aplikasi Java modern, Java callback dapat mengirim metrics.

Contoh metric yang berguna:

```text
flyway.migrate.started.count
flyway.migrate.completed.count
flyway.migrate.failed.count
flyway.migration.completed.count
flyway.migration.failed.count
flyway.migrate.duration.ms
```

Namun ada batas penting:

- callback Flyway tidak selalu punya semua konteks deployment pipeline,
- lebih baik pipeline juga mencatat duration command,
- Flyway log harus tetap menjadi sumber debugging utama,
- metrics tidak boleh membuat migration gagal jika monitoring down.

Rule:

> Observability failure must not become migration failure, kecuali policy organisasi memang mengharuskannya.

---

## 9. Use Case Callback yang Berbahaya

## 9.1 Seed Data Utama di `afterMigrate`

Contoh buruk:

```sql
-- afterMigrate.sql
INSERT INTO role(name) VALUES ('ADMIN');
INSERT INTO role(name) VALUES ('USER');
```

Mengapa buruk?

1. Seed tidak punya versi jelas.
2. Jika callback berubah, behavior berubah untuk run berikutnya.
3. Jika `afterMigrate` jalan saat tidak ada migration baru, bisa terjadi duplicate/error.
4. Audit historis seed menjadi kabur.

Lebih baik:

```text
V010__seed_initial_roles.sql
V045__add_case_manager_role.sql
```

Atau jika seed bersifat repeatable dan benar-benar cocok:

```text
R__reference_status_data.sql
```

Tetapi nanti seeding akan dibahas detail di Part 17 dan 18.

---

## 9.2 Business Backfill di Callback

Contoh buruk:

```sql
-- afterMigrate.sql
UPDATE customer
SET risk_score = calculate_risk_score(customer_id)
WHERE risk_score IS NULL;
```

Ini berbahaya karena:

- backfill tidak versioned,
- bisa berjalan di waktu yang tidak diharapkan,
- bisa berat,
- bisa lock banyak row,
- sulit retry/resume,
- tidak jelas terkait release mana.

Lebih baik:

```text
V180__add_customer_risk_score_column.sql
V181__backfill_customer_risk_score.sql
```

Atau untuk data besar:

- migration hanya menambah struktur,
- backfill dijalankan oleh batch job terpisah,
- cutover dilakukan setelah validasi.

---

## 9.3 Network Call di Callback

Contoh buruk:

```java
public void handle(Event event, Context context) {
    httpClient.post("https://external-system/deployment-event", payload);
}
```

Masalah:

- external system down membuat migration gagal,
- latency network memperlambat deployment,
- retry bisa duplicate,
- security token perlu dikelola,
- callback menjadi integration job.

Jika tetap perlu notifikasi:

- lakukan di CI/CD pipeline setelah Flyway command selesai,
- atau emit log/metric lokal lalu collector mengirim async,
- atau gunakan callback dengan timeout sangat pendek dan failure-swallowing yang eksplisit.

---

## 9.4 Auto-Repair di Callback

Contoh sangat buruk:

```sql
-- afterMigrateError.sql
DELETE FROM flyway_schema_history WHERE success = false;
```

Ini hampir selalu anti-pattern.

Mengapa?

- menyembunyikan failure,
- merusak audit trail,
- membuat state tidak jelas,
- bisa membuat migration berikutnya berjalan di atas database partial,
- berbahaya di production.

Repair harus menjadi tindakan sadar melalui runbook, bukan callback otomatis.

---

## 10. Callback and Transaction Boundaries

Salah satu hal paling penting: callback bisa berjalan dalam konteks transaksi tertentu tergantung database, event, dan konfigurasi.

Masalahnya:

- beberapa database mendukung transactional DDL,
- beberapa tidak,
- beberapa statement menyebabkan implicit commit,
- beberapa callback bisa dijalankan dalam transaksi migration,
- beberapa tidak boleh/kurang cocok.

### 10.1 Mengapa Ini Penting?

Misalnya `afterEachMigrate.sql` melakukan audit insert.

Jika migration gagal setelah audit insert, apakah audit ikut rollback?

Tergantung:

- database,
- transaction mode,
- event,
- implementation callback,
- statement type.

Jangan mengasumsikan audit callback selalu committed.

### 10.2 Praktik Aman

Untuk audit yang harus survive failure:

- pertimbangkan audit di pipeline/log eksternal,
- gunakan database autonomous transaction jika vendor mendukung dan policy mengizinkan,
- gunakan Java callback dengan separate connection jika benar-benar perlu,
- atau terima bahwa audit DB bisa rollback dan Flyway log menjadi primary evidence.

Namun separate connection juga punya risiko:

- credential tambahan,
- transaction consistency berbeda,
- potensi deadlock/lock conflict,
- audit bisa committed walaupun migration rollback.

Tidak ada solusi universal. Yang penting adalah eksplisit.

---

## 11. SQL Callback Design Pattern

Struktur callback SQL yang baik:

```sql
-- ============================================================
-- Callback: beforeMigrate
-- Purpose : Set migration session guardrails.
-- Scope   : Applies to every Flyway migrate run.
-- Risk    : Must be lightweight and deterministic.
-- Notes   : Do not put schema/data migration here.
-- ============================================================

-- vendor-specific session settings here
```

Contoh PostgreSQL:

```sql
-- ============================================================
-- Callback: beforeMigrate
-- Purpose : Set safe timeout defaults for Flyway migration session.
-- DBMS    : PostgreSQL
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '15min';
SET idle_in_transaction_session_timeout = '5min';
```

Contoh Oracle:

```sql
-- ============================================================
-- Callback: beforeMigrate
-- Purpose : Set safe DDL lock timeout for Flyway migration session.
-- DBMS    : Oracle
-- ============================================================

ALTER SESSION SET ddl_lock_timeout = 30;
```

Contoh SQL Server:

```sql
-- ============================================================
-- Callback: beforeMigrate
-- Purpose : Set lock wait timeout for Flyway migration session.
-- DBMS    : SQL Server
-- ============================================================

SET LOCK_TIMEOUT 5000;
```

---

## 12. Java Callback Design Pattern

Java callback yang baik harus:

- kecil,
- deterministic,
- tidak tergantung external network by default,
- punya timeout jika melakukan I/O,
- tidak menyimpan state mutable global,
- tidak memanggil business service,
- tidak menjalankan migration logic domain,
- robust terhadap exception.

Contoh skeleton:

```java
package com.example.db.migration.callback;

import org.flywaydb.core.api.callback.Callback;
import org.flywaydb.core.api.callback.Context;
import org.flywaydb.core.api.callback.Event;

public final class StructuredMigrationLoggingCallback implements Callback {

    @Override
    public boolean supports(Event event, Context context) {
        return event == Event.BEFORE_MIGRATE
            || event == Event.AFTER_MIGRATE
            || event == Event.AFTER_MIGRATE_ERROR
            || event == Event.AFTER_EACH_MIGRATE
            || event == Event.AFTER_EACH_MIGRATE_ERROR;
    }

    @Override
    public boolean canHandleInTransaction(Event event, Context context) {
        return false;
    }

    @Override
    public void handle(Event event, Context context) {
        // Keep this callback lightweight.
        // Prefer structured logger in a real application.
        System.out.println("flyway_event=" + event.getId());
    }

    @Override
    public String getCallbackName() {
        return "structured-migration-logging";
    }
}
```

### 12.1 Exception Policy

Pertanyaan penting:

> Jika callback gagal, apakah migration harus gagal?

Jawabannya tergantung callback.

Callback guard:

- jika gagal, migration harus berhenti.

Callback metrics:

- jika gagal, biasanya migration tidak harus gagal.

Callback audit compliance:

- tergantung regulasi dan policy.

Contoh policy:

```java
@Override
public void handle(Event event, Context context) {
    try {
        emitMetric(event);
    } catch (Exception ex) {
        // Metrics failure should not fail migration.
        System.err.println("Failed to emit migration metric: " + ex.getMessage());
    }
}
```

Sebaliknya untuk guard:

```java
@Override
public void handle(Event event, Context context) {
    if (!isAllowedEnvironment()) {
        throw new IllegalStateException("Migration is not allowed in this environment");
    }
}
```

---

## 13. Callback Configuration Patterns

## 13.1 Spring Boot Configuration

Contoh `application.yml`:

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    callback-locations: classpath:db/callback
```

Untuk profile-specific callback:

```yaml
# application-prod.yml
spring:
  flyway:
    callback-locations: classpath:db/callback/common,classpath:db/callback/prod
```

Namun hati-hati:

- semakin banyak profile-specific callback, semakin sulit reasoning,
- environment behavior bisa drift,
- production-only behavior sulit dites.

Lebih baik jika callback common sebanyak mungkin dan environment-specific hanya untuk guardrail yang benar-benar perlu.

---

## 13.2 Plain Java Configuration

Contoh:

```java
Flyway flyway = Flyway.configure()
    .dataSource(dataSource)
    .locations("classpath:db/migration")
    .callbackLocations("classpath:db/callback")
    .load();

flyway.migrate();
```

Dengan Java callback:

```java
Flyway flyway = Flyway.configure()
    .dataSource(dataSource)
    .locations("classpath:db/migration")
    .callbacks(new StructuredMigrationLoggingCallback())
    .load();
```

Atau classpath scanning tergantung versi/konfigurasi.

---

## 13.3 Maven/Gradle/CLI Configuration

Untuk CLI, callback location biasanya dikonfigurasi di file config.

Contoh konseptual:

```properties
flyway.locations=filesystem:sql
flyway.callbackLocations=filesystem:callbacks
```

Folder:

```text
project/
  sql/
    V001__init.sql
    V002__add_customer.sql
  callbacks/
    beforeMigrate.sql
    afterMigrateApplied.sql
    afterMigrateError.sql
```

---

## 14. Callback Location Strategy

Ada beberapa strategi layout.

### 14.1 Simple Project

```text
src/main/resources/db/
  migration/
    V001__init.sql
  callback/
    beforeMigrate.sql
    afterMigrateError.sql
```

Cocok untuk:

- satu database,
- satu aplikasi,
- satu schema,
- logic callback sederhana.

### 14.2 Vendor-Specific Project

```text
src/main/resources/db/
  migration/
    postgresql/
      V001__init.sql
    oracle/
      V001__init.sql
  callback/
    postgresql/
      beforeMigrate.sql
    oracle/
      beforeMigrate.sql
```

Cocok untuk:

- produk mendukung beberapa DBMS,
- SQL migration memang vendor-specific,
- session setting berbeda.

### 14.3 Environment-Specific Guardrail

```text
src/main/resources/db/callback/
  common/
    afterMigrateError.sql
  prod/
    beforeMigrate.sql
  dev/
    beforeMigrate.sql
```

Gunakan hati-hati.

Semakin banyak perbedaan environment, semakin besar risiko:

- migration lolos di dev tapi gagal di prod,
- prod behavior tidak pernah diuji,
- callback menjadi hidden deployment policy.

---

## 15. Callback for Lock and Statement Timeout

Ini salah satu use case paling praktis.

### 15.1 Mengapa Timeout Penting?

Tanpa timeout, migration bisa:

- menunggu lock terlalu lama,
- menggantung deployment,
- menahan connection,
- membuat pipeline timeout tanpa pesan jelas,
- menyebabkan cascading failure.

Dengan timeout:

- migration gagal lebih cepat,
- failure lebih eksplisit,
- deployment bisa dihentikan aman,
- engineer bisa melakukan diagnosis lock.

### 15.2 Namun Timeout Bukan Pengganti Desain Migration

Contoh:

```sql
ALTER TABLE huge_order_table ADD COLUMN note VARCHAR(500);
```

Timeout bisa mencegah lock wait lama, tetapi tidak mengubah fakta bahwa statement itu mungkin rewrite table atau block traffic tergantung database.

Jadi tetap perlu:

- online DDL awareness,
- index concurrently/online jika tersedia,
- expand/contract,
- backfill chunking,
- maintenance window jika perlu.

---

## 16. Callback for Session Context

Kadang database audit trigger membutuhkan session context.

Contoh:

- `application_name`,
- module name,
- client identifier,
- tenant context,
- deployment id,
- release version.

PostgreSQL:

```sql
SET application_name = 'flyway-migration';
```

Oracle:

```sql
BEGIN
  DBMS_APPLICATION_INFO.SET_MODULE(
    module_name => 'flyway-migration',
    action_name => 'database-change'
  );
END;
/
```

SQL Server:

```sql
EXEC sp_set_session_context @key = N'application_name', @value = N'flyway-migration';
```

Manfaat:

- DB monitoring bisa membedakan migration session dari app session,
- audit log lebih jelas,
- DBA bisa melihat active session dengan konteks,
- lock diagnostic lebih mudah.

---

## 17. Callback for Correlation ID

Dalam deployment modern, setiap release sebaiknya punya correlation id:

```text
release_id=2026.06.17.1
pipeline_run_id=github-actions-123456
commit_sha=abc123
change_ticket=CR-2026-0012
```

Callback bisa memasukkan informasi ini ke audit.

Dengan placeholder/config:

```properties
flyway.placeholders.release_id=2026.06.17.1
flyway.placeholders.change_ticket=CR-2026-0012
```

Callback:

```sql
INSERT INTO migration_run_audit (
    event_type,
    release_id,
    change_ticket,
    executed_at
) VALUES (
    'BEFORE_MIGRATE',
    '${release_id}',
    '${change_ticket}',
    CURRENT_TIMESTAMP
);
```

Caveat:

- placeholder replacement harus dikonfigurasi benar,
- jangan memasukkan secret ke placeholder,
- jangan percaya placeholder dari environment yang tidak terkontrol,
- validate value di pipeline.

---

## 18. Callback for Policy Enforcement

Callback bisa dipakai untuk enforce policy.

Contoh policy:

1. migration tidak boleh berjalan jika current user bukan migration user,
2. migration tidak boleh berjalan di production tanpa release id,
3. migration tidak boleh berjalan jika schema history table tidak berada di schema yang benar,
4. migration tidak boleh berjalan saat database read-only,
5. migration tidak boleh berjalan jika ada active old-version app session.

Namun policy berat sering lebih baik di pipeline.

### 18.1 Callback Policy yang Cocok

Cocok:

- check database user,
- check schema,
- check database name,
- check session role,
- check required placeholder exists,
- check migration lock guard.

Kurang cocok:

- approval workflow,
- CAB validation,
- Jira status check,
- Slack approval,
- production calendar,
- multi-system orchestration.

Yang kurang cocok sebaiknya ada di CI/CD governance, bukan callback.

---

## 19. Callback and Audit Table Design

Jika organisasi memerlukan audit tambahan di luar Flyway schema history, desain tabel audit dengan hati-hati.

Contoh minimal:

```sql
CREATE TABLE db_change_audit_event (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    event_time TIMESTAMP NOT NULL,
    database_user VARCHAR(200),
    release_id VARCHAR(200),
    pipeline_run_id VARCHAR(200),
    change_ticket VARCHAR(200),
    flyway_event VARCHAR(100),
    message VARCHAR(1000)
);
```

Jangan menyimpan:

- full SQL migration text jika sensitif,
- credential,
- PII,
- data sample produksi,
- payload terlalu besar.

Audit harus membantu menjawab:

1. migration run terjadi kapan,
2. dijalankan oleh siapa/user apa,
3. terkait release/ticket apa,
4. event apa yang terjadi,
5. berhasil atau gagal,
6. bukti log mana yang bisa dicari.

---

## 20. Callback and Flyway Schema History Table

Flyway sudah punya schema history table.

Jangan menduplikasi semua isi schema history table tanpa alasan.

Schema history table menjawab:

- migration apa yang sudah applied,
- urutan apply,
- checksum,
- success/failure,
- installed by,
- installed on,
- execution time.

Audit tambahan berguna jika perlu:

- correlation id pipeline,
- change ticket,
- environment tag,
- deployment approver,
- extra compliance metadata,
- external log link,
- operational notes.

Jadi desainnya:

```text
Flyway schema history = technical migration source of truth
Custom audit table     = organizational/deployment evidence
Pipeline logs          = execution evidence
DB audit               = privileged access evidence
```

Jangan membuat satu tabel mencoba menjadi semuanya.

---

## 21. Callback and Repeatable Migration

Repeatable migration dijalankan setelah pending versioned migration dalam satu migration run.

Callback seperti `beforeEachMigrate` dan `afterEachMigrate` dapat berlaku juga pada repeatable migration yang dijalankan.

Implikasi:

- audit per migration harus siap menerima repeatable execution,
- metric count bisa naik karena repeatable berubah,
- failure handling harus membedakan versioned vs repeatable jika perlu,
- expensive callback akan terasa jika repeatable banyak.

Jangan mengasumsikan `beforeEachMigrate` hanya untuk `V...` file.

---

## 22. Callback and Java Version Compatibility

Karena seri ini mencakup Java 8 sampai Java 25, ada beberapa prinsip.

### 22.1 Java 8/11 Legacy Projects

Untuk project Java 8 atau 11:

- pilih Flyway version yang masih support runtime tersebut,
- Java callback harus dikompilasi sesuai target bytecode,
- hindari menggunakan API Java modern di callback,
- jangan compile callback dengan Java 21 lalu dijalankan di Java 8 runtime.

### 22.2 Java 17/21/25 Modern Projects

Untuk Java 17+:

- callback bisa memakai language/API modern jika runtime mendukung,
- tetap hati-hati dependency bloat,
- callback harus kecil dan stabil,
- jangan menarik seluruh application context jika tidak perlu.

### 22.3 Build Discipline

Di Maven:

```xml
<properties>
    <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Di Gradle:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}
```

Untuk library/shared migration module, pastikan target runtime jelas.

---

## 23. Callback and Spring Boot Lifecycle

Dalam Spring Boot, Flyway biasanya berjalan saat application context startup, sebelum JPA EntityManagerFactory siap.

Implikasi:

- Java callback tidak boleh bergantung pada bean yang belum siap kecuali dikonfigurasi khusus,
- migrasi failure dapat membuat aplikasi gagal start,
- callback yang lambat memperlambat startup,
- callback yang memanggil service application internal bisa menciptakan lifecycle coupling.

Lebih aman:

- callback sebagai class kecil,
- dependency minimal,
- gunakan Flyway configuration customizer jika perlu,
- jangan menjadikan callback sebagai Spring service kompleks.

Contoh Spring Boot customizer konseptual:

```java
@Configuration
public class FlywayCallbackConfiguration {

    @Bean
    public FlywayConfigurationCustomizer flywayConfigurationCustomizer() {
        return configuration -> configuration.callbacks(
            new StructuredMigrationLoggingCallback()
        );
    }
}
```

Catatan: nama interface/import tergantung versi Spring Boot.

---

## 24. Callback in Kubernetes Deployment

Dalam Kubernetes, ada dua pola umum menjalankan Flyway:

1. Flyway berjalan saat aplikasi start.
2. Flyway berjalan sebagai Kubernetes Job/init step sebelum aplikasi baru naik.

### 24.1 Callback Saat App Startup

```text
Deployment pod starts
  -> Spring Boot starts
  -> Flyway migrate
  -> callbacks run
  -> app starts serving
```

Risiko:

- banyak pod start bersamaan,
- migration lock contention,
- startup lambat,
- pod crash loop jika migration gagal,
- callback berjalan berkali-kali pada startup walaupun tidak ada migration applied.

### 24.2 Callback Saat Migration Job

```text
Kubernetes Job: flyway migrate
  -> callbacks run
  -> migration done
Deployment rollout app
```

Lebih cocok untuk production serius karena:

- migration dipisah dari app startup,
- log migration jelas,
- retry job bisa dikontrol,
- approval gate lebih jelas,
- app pod tidak berebut migration.

Callback tetap berguna di migration job untuk:

- session context,
- audit,
- timeout,
- diagnostics.

---

## 25. Callback Observability Model

Observability migration sebaiknya tidak hanya bergantung pada callback.

Model yang lebih kuat:

```text
CI/CD pipeline
  - command start/end
  - duration
  - exit code
  - artifact version
  - release id

Flyway logs
  - migration order
  - applied migration
  - failure stacktrace

Flyway schema history
  - technical source of truth
  - checksum
  - installed rank
  - success/failure

Callback audit
  - environment context
  - release ticket
  - session settings
  - custom policy result

Database monitoring
  - locks
  - blocked sessions
  - wait events
  - query duration
```

Callback hanya satu bagian dari observability, bukan semuanya.

---

## 26. Statement-Level Callback: Powerful but Dangerous

Event seperti:

```text
beforeEachMigrateStatement
afterEachMigrateStatement
afterEachMigrateStatementError
```

memberi kontrol sangat granular.

Namun hati-hati:

- migration dengan 500 statement akan trigger callback 500 kali,
- logging bisa sangat besar,
- performance overhead tinggi,
- audit noise tinggi,
- callback failure bisa mengganggu migration.

Use case yang mungkin valid:

- debugging migration framework,
- strict compliance untuk sistem tertentu,
- statement-level timing di environment test,
- temporary diagnostic.

Untuk production umum, lebih baik hindari statement-level callback kecuali ada alasan kuat.

---

## 27. Error Callback Design

Error callback harus menjawab:

> “Apa informasi minimal yang harus tersedia saat migration gagal?”

Bukan:

> “Bagaimana kita otomatis memperbaiki migration?”

Checklist error callback yang baik:

- mencatat event failure,
- mencatat timestamp,
- mencatat database user/schema,
- mencatat release/pipeline id jika tersedia,
- mencatat pesan pendek,
- tidak melakukan heavy query,
- tidak melakukan auto-repair,
- tidak menyembunyikan exception asli,
- tidak membuat failure menjadi lebih kacau.

Contoh:

```sql
-- afterMigrateError.sql
INSERT INTO db_change_audit_event (
    event_type,
    event_time,
    database_user,
    release_id,
    pipeline_run_id,
    message
) VALUES (
    'MIGRATE_ERROR',
    CURRENT_TIMESTAMP,
    CURRENT_USER,
    '${release_id}',
    '${pipeline_run_id}',
    'Flyway migrate failed. Check Flyway logs and schema history.'
);
```

---

## 28. Callback Testing Strategy

Callback juga harus dites.

### 28.1 Test SQL Callback

Gunakan database nyata via Testcontainers jika memungkinkan.

Test minimal:

1. Flyway bisa load callback.
2. Callback syntax valid untuk DBMS target.
3. Callback tidak gagal saat tidak ada migration pending.
4. Callback tidak duplicate audit secara tidak sengaja.
5. Callback error behavior sesuai policy.

### 28.2 Test Java Callback

Test unit:

- `supports()` benar,
- exception policy benar,
- event mapping benar.

Test integration:

- callback registered,
- Flyway migrate memicu callback,
- failure migration memicu error callback,
- callback tidak membuat migration success menjadi failure kecuali memang guard.

### 28.3 Test Production-Like Behavior

Terutama untuk:

- session timeout,
- lock timeout,
- schema guard,
- environment guard,
- audit insert permission,
- migration user privilege.

Banyak callback gagal bukan karena logic salah, tetapi karena migration user tidak punya privilege insert ke audit table, atau session setting tidak valid di DB version tertentu.

---

## 29. Callback Review Checklist

Setiap callback harus direview dengan checklist berikut.

### 29.1 Purpose

- Apakah callback punya tujuan jelas?
- Apakah tujuan itu control-plane, bukan migration-plane?
- Apakah callback ini benar-benar perlu?

### 29.2 Determinism

- Apakah callback deterministic?
- Apakah hasilnya sama di setiap run dengan input yang sama?
- Apakah callback bergantung network/external service?

### 29.3 Scope

- Apakah callback berjalan sekali per run atau sekali per migration?
- Apakah event yang dipilih tepat?
- Apakah callback bisa berjalan saat tidak ada migration pending?

### 29.4 Performance

- Apakah callback ringan?
- Apakah ada query berat?
- Apakah statement-level callback digunakan tanpa alasan kuat?

### 29.5 Failure Behavior

- Jika callback gagal, apakah migration harus gagal?
- Apakah failure callback bisa gagal juga?
- Apakah callback menyembunyikan root cause?

### 29.6 Security

- Apakah callback mengekspos secret?
- Apakah placeholder aman?
- Apakah audit table menyimpan PII?
- Apakah callback membutuhkan privilege berlebihan?

### 29.7 Portability

- Apakah callback vendor-specific?
- Jika iya, apakah folder/config-nya jelas?
- Apakah callback diuji di DBMS target?

---

## 30. Production Callback Design Template

Berikut template praktis untuk organisasi.

```text
callbacks/
  common/
    afterMigrateError.sql
  postgresql/
    beforeMigrate.sql
    afterMigrateApplied.sql
  oracle/
    beforeMigrate.sql
    afterMigrateApplied.sql
```

### 30.1 `beforeMigrate.sql`

Tujuan:

- set session context,
- set lock timeout,
- validate schema/user,
- insert run start audit jika diperlukan.

Tidak boleh:

- create/alter domain table,
- seed business data,
- backfill data besar.

### 30.2 `afterMigrateApplied.sql`

Tujuan:

- audit migration applied,
- update deployment metadata ringan,
- log success event.

Lebih aman daripada `afterMigrate` jika hanya ingin event saat ada perubahan.

### 30.3 `afterMigrateError.sql`

Tujuan:

- audit failure,
- emit diagnostic note,
- tidak memperbaiki otomatis.

### 30.4 Java Callback Optional

Gunakan untuk:

- structured logging,
- metrics,
- policy guard yang butuh config app,
- correlation id processing.

---

## 31. Contoh End-to-End: PostgreSQL Callback Set

### 31.1 Struktur

```text
src/main/resources/db/
  migration/
    V001__create_customer.sql
    V002__add_customer_email.sql
  callback/
    beforeMigrate.sql
    afterMigrateApplied.sql
    afterMigrateError.sql
```

### 31.2 Audit Table Migration

```sql
-- V001__create_migration_audit.sql
CREATE TABLE db_change_audit_event (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    event_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    database_user VARCHAR(200),
    release_id VARCHAR(200),
    pipeline_run_id VARCHAR(200),
    message VARCHAR(1000)
);
```

### 31.3 `beforeMigrate.sql`

```sql
-- ============================================================
-- Callback: beforeMigrate
-- Purpose : Set safe session defaults and write migration start audit.
-- DBMS    : PostgreSQL
-- ============================================================

SET application_name = 'flyway-migration';
SET lock_timeout = '5s';
SET statement_timeout = '15min';
SET idle_in_transaction_session_timeout = '5min';

INSERT INTO db_change_audit_event (
    event_type,
    event_time,
    database_user,
    release_id,
    pipeline_run_id,
    message
) VALUES (
    'BEFORE_MIGRATE',
    CURRENT_TIMESTAMP,
    CURRENT_USER,
    '${release_id}',
    '${pipeline_run_id}',
    'Flyway migration run started'
);
```

### 31.4 `afterMigrateApplied.sql`

```sql
-- ============================================================
-- Callback: afterMigrateApplied
-- Purpose : Write audit only when at least one migration was applied.
-- DBMS    : PostgreSQL
-- ============================================================

INSERT INTO db_change_audit_event (
    event_type,
    event_time,
    database_user,
    release_id,
    pipeline_run_id,
    message
) VALUES (
    'AFTER_MIGRATE_APPLIED',
    CURRENT_TIMESTAMP,
    CURRENT_USER,
    '${release_id}',
    '${pipeline_run_id}',
    'Flyway migration run completed and applied changes'
);
```

### 31.5 `afterMigrateError.sql`

```sql
-- ============================================================
-- Callback: afterMigrateError
-- Purpose : Write audit when Flyway migrate fails.
-- DBMS    : PostgreSQL
-- ============================================================

INSERT INTO db_change_audit_event (
    event_type,
    event_time,
    database_user,
    release_id,
    pipeline_run_id,
    message
) VALUES (
    'MIGRATE_ERROR',
    CURRENT_TIMESTAMP,
    CURRENT_USER,
    '${release_id}',
    '${pipeline_run_id}',
    'Flyway migration failed. Check Flyway logs and flyway_schema_history.'
);
```

### 31.6 Caveat Penting

Jika `db_change_audit_event` belum ada, `beforeMigrate.sql` akan gagal.

Solusi:

1. audit table dibuat manual sebagai platform table,
2. audit table dibuat pada baseline awal sebelum callback aktif,
3. callback guard mengecek table existence sebelum insert,
4. audit dilakukan di pipeline/log, bukan DB table.

Untuk project baru, biasanya aman jika audit table adalah migration paling awal dan callback audit aktif setelah initial bootstrap. Tetapi pada fresh database, callback `beforeMigrate` akan berjalan sebelum `V001`, sehingga audit table belum ada.

Ini contoh penting kenapa callback harus dipikirkan sebagai lifecycle, bukan hanya script.

---

## 32. Bootstrap Problem: Callback Membutuhkan Object yang Dibuat Migration

Ini salah satu jebakan paling umum.

Contoh:

```text
beforeMigrate.sql inserts into migration_audit
V001__create_migration_audit.sql creates migration_audit
```

Urutan eksekusi:

```text
beforeMigrate.sql
V001__create_migration_audit.sql
```

Maka callback gagal karena table belum ada.

### 32.1 Solusi 1: Audit Table Dibuat Di Baseline Manual

Untuk enterprise environment, tabel platform seperti audit bisa dibuat sebagai bagian dari environment provisioning.

```text
platform bootstrap
  -> create migration_audit table
flyway migrate
  -> beforeMigrate can insert audit
```

### 32.2 Solusi 2: Gunakan Guard Existence Check

PostgreSQL example:

```sql
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'db_change_audit_event'
    ) THEN
        INSERT INTO db_change_audit_event (
            event_type,
            event_time,
            database_user,
            message
        ) VALUES (
            'BEFORE_MIGRATE',
            CURRENT_TIMESTAMP,
            CURRENT_USER,
            'Flyway migration run started'
        );
    END IF;
END $$;
```

Trade-off:

- lebih robust untuk fresh DB,
- callback lebih kompleks,
- vendor-specific,
- audit awal bisa tidak tercatat.

### 32.3 Solusi 3: Audit di `afterMigrateApplied`

Jika audit table dibuat oleh migration awal, `afterMigrateApplied` mungkin bisa insert setelah migration selesai.

Namun jika migration gagal sebelum audit table dibuat, failure audit tetap tidak tercatat.

### 32.4 Solusi 4: Audit di Pipeline

Pipeline log selalu ada sebelum database object dibuat.

Untuk compliance serius, kombinasikan:

- pipeline log,
- Flyway schema history,
- DB audit table setelah tersedia,
- database native audit jika perlu.

---

## 33. Callback and Security Model

Callback biasanya berjalan dengan credential yang sama dengan Flyway migration user.

Ini berarti callback memiliki privilege migration user.

### 33.1 Risiko

Jika migration user powerful, callback juga powerful.

Callback bisa:

- membaca data sensitif,
- menulis audit palsu,
- mengubah schema,
- drop object,
- disable constraint,
- expose secret via log.

Karena itu callback harus direview seperti migration.

### 33.2 Least Privilege

Ideal:

```text
app_user       -> runtime DML limited privilege
migration_user -> DDL privilege for owned schema
read_only_user -> reporting
admin_user     -> DBA only
```

Callback audit insert membutuhkan privilege insert ke audit table.

Jangan memberi migration user privilege luas hanya karena callback butuh satu table.

Lebih baik:

- audit table berada di schema yang migration user boleh insert,
- gunakan stored procedure audit dengan controlled grant,
- atau audit di pipeline.

---

## 34. Callback and Secrets

Jangan simpan secret di callback file.

Buruk:

```sql
INSERT INTO audit_sink_config(api_key) VALUES ('secret-value');
```

Buruk:

```java
private static final String TOKEN = "hardcoded-token";
```

Juga hati-hati dengan placeholder:

```properties
flyway.placeholders.slack_token=...
```

Karena placeholder bisa:

- muncul di log,
- terlihat di config,
- terbaca di process env,
- bocor ke audit table.

Prinsip:

> Callback tidak boleh membutuhkan secret eksternal kecuali benar-benar unavoidable, dan jika unavoidable harus dikelola via secret manager dengan timeout/failure policy eksplisit.

---

## 35. Callback Anti-Patterns

## 35.1 Callback as Hidden Migration

```text
beforeMigrate.sql secretly creates tables
```

Masalah:

- tidak versioned,
- tidak obvious,
- schema history tidak merepresentasikan perubahan,
- review sulit.

## 35.2 Callback as Hidden Seed

```text
afterMigrate.sql inserts roles/configs
```

Masalah:

- duplicate risk,
- tidak punya versi domain,
- tidak jelas kapan berubah.

## 35.3 Callback as Integration Worker

```text
afterMigrate calls external service
```

Masalah:

- coupling deployment dengan network/service eksternal,
- failure mode buruk.

## 35.4 Callback as Repair Automation

```text
afterMigrateError manipulates flyway_schema_history
```

Masalah:

- audit rusak,
- state makin tidak jelas,
- recovery berbahaya.

## 35.5 Too Many Environment-Specific Callbacks

```text
callback/dev/beforeMigrate.sql
callback/sit/beforeMigrate.sql
callback/uat/beforeMigrate.sql
callback/prod/beforeMigrate.sql
```

Masalah:

- behavior drift,
- prod-only bugs,
- reasoning sulit.

## 35.6 Statement-Level Logging Everywhere

Masalah:

- log bloat,
- overhead,
- noise,
- performance unpredictable.

---

## 36. Decision Framework: Should This Be a Callback?

Gunakan pertanyaan berikut.

### 36.1 Apakah Ini Mengubah Domain Schema/Data?

Jika ya, jangan callback. Gunakan migration.

### 36.2 Apakah Ini Lifecycle Concern?

Jika ya, callback mungkin cocok.

Contoh lifecycle concern:

- before migration run,
- after migration success,
- on migration error,
- per migration audit,
- session setup.

### 36.3 Apakah Perlu Versioned History?

Jika ya, migration lebih cocok.

### 36.4 Apakah Harus Berjalan Walaupun Tidak Ada Migration Baru?

Jika ya, `afterMigrate` mungkin cocok.

Jika tidak, gunakan `afterMigrateApplied` atau per-migration event.

### 36.5 Apakah Callback Failure Harus Menggagalkan Migration?

Jika tidak, tangani exception.

Jika ya, throw error eksplisit.

### 36.6 Apakah Logic Ini Bisa Dijalankan di Pipeline?

Jika ya, pertimbangkan pipeline lebih dulu.

Pipeline sering lebih cocok untuk:

- notifikasi,
- approval,
- release metadata,
- artifact verification,
- Slack/email,
- CAB integration.

Callback lebih cocok untuk:

- database session,
- DB-local audit,
- DB-local guard.

---

## 37. Practical Production Standard

Untuk organisasi yang ingin standar sederhana, mulai dari ini.

### 37.1 Minimal Callback Set

```text
beforeMigrate.sql
 afterMigrateApplied.sql
 afterMigrateError.sql
```

Dengan isi:

- `beforeMigrate`: set session context dan timeout.
- `afterMigrateApplied`: audit success jika ada migration applied.
- `afterMigrateError`: audit failure ringan.

### 37.2 Jangan Gunakan Dulu

Hindari dulu:

- statement-level callback,
- Java callback kompleks,
- environment-specific callback terlalu banyak,
- callback yang call external network,
- callback yang mengubah domain data.

### 37.3 Tambahkan Jika Butuh

Tambahkan Java callback jika:

- butuh structured logging,
- butuh metric integration,
- butuh policy check yang sulit dilakukan di SQL,
- sudah ada testing dan clear failure policy.

---

## 38. Review Example: Buruk vs Baik

### 38.1 Buruk

```sql
-- afterMigrate.sql
INSERT INTO role(name) VALUES ('ADMIN');
INSERT INTO role(name) VALUES ('USER');

UPDATE customer SET status = 'ACTIVE' WHERE status IS NULL;

SELECT send_email('Migration done');
```

Masalah:

- seed role harus versioned,
- customer backfill harus migration/job,
- email notification tidak cocok di DB callback,
- callback bisa berjalan saat tidak ada migration baru,
- idempotency tidak jelas.

### 38.2 Baik

```text
V010__seed_initial_roles.sql
V011__add_customer_status_default.sql
V012__backfill_customer_status.sql
callbacks/
  beforeMigrate.sql
  afterMigrateApplied.sql
  afterMigrateError.sql
pipeline/
  notify-on-success
  notify-on-failure
```

Pembagian tanggung jawab lebih jelas:

- schema/data change ada di migration,
- lifecycle DB guard ada di callback,
- notification ada di pipeline.

---

## 39. Checklist Sebelum Mengaktifkan Callback di Production

Sebelum callback production aktif:

1. Sudah diuji di database engine yang sama.
2. Sudah diuji pada fresh database.
3. Sudah diuji pada existing database.
4. Sudah diuji saat tidak ada migration pending.
5. Sudah diuji saat migration gagal.
6. Sudah jelas apakah callback failure menggagalkan migration.
7. Sudah jelas privilege yang dibutuhkan.
8. Tidak ada secret hardcoded.
9. Tidak ada business schema/data migration di callback.
10. Tidak ada network dependency tanpa timeout/failure policy.
11. Log tidak terlalu noisy.
12. Statement-level callback tidak digunakan tanpa alasan kuat.
13. Behavior environment-specific terdokumentasi.
14. Runbook mencantumkan callback behavior.
15. Tim tahu callback berjalan sebagai bagian dari Flyway lifecycle.

---

## 40. Mental Model Akhir

Callbacks adalah alat untuk menjawab:

> “Apa yang harus terjadi di sekitar proses migration?”

Bukan:

> “Perubahan database apa yang harus dilakukan?”

Perubahan database utama tetap harus berada di migration:

```text
V... migration
R... repeatable migration
Java-based migration jika memang perlu
```

Callback idealnya kecil, deterministic, ringan, dan bersifat operasional.

Cara berpikirnya:

```text
Migration file      = domain/database change
Callback            = lifecycle hook
Pipeline            = release orchestration
Schema history      = technical source of truth
Audit/log/metrics   = evidence and observability
Runbook             = human recovery model
```

Jika callback mulai terasa seperti mini-application, kemungkinan besar desainnya sudah salah.

---

## 41. Ringkasan

Pada bagian ini kita mempelajari:

- callback sebagai control plane Flyway,
- perbedaan migration plane dan control plane,
- SQL callback vs Java callback,
- event lifecycle utama Flyway,
- cara memilih event yang tepat,
- use case sehat untuk callback,
- anti-pattern callback,
- transaction boundary concern,
- audit design,
- timeout/session context pattern,
- Kubernetes/Spring Boot lifecycle implication,
- testing strategy,
- production checklist.

Inti kemampuan top-tier engineer di area ini bukan menghafal nama callback, tetapi mengetahui:

1. kapan callback membantu,
2. kapan callback merusak desain,
3. bagaimana failure callback memengaruhi deployment,
4. bagaimana menjaga migration tetap audit-friendly dan deterministic,
5. bagaimana memisahkan migration, control, pipeline, dan observability.

---

## 42. Latihan Pemahaman

### Latihan 1

Sebuah tim menaruh seed role permission di `afterMigrate.sql` karena ingin role selalu tersedia setelah migration.

Pertanyaan:

- Apa risiko desain ini?
- Apakah `afterMigrateApplied` memperbaiki semua masalah?
- Di mana seed role seharusnya diletakkan?

### Latihan 2

Migration production sering menunggu lock terlalu lama.

Pertanyaan:

- Callback apa yang bisa membantu?
- Apakah callback cukup untuk menjamin zero downtime?
- Apa yang tetap harus dianalisis di migration SQL?

### Latihan 3

Organisasi ingin mencatat release id, pipeline id, dan change ticket pada setiap migration run.

Pertanyaan:

- Informasi ini lebih cocok di schema history table atau audit table tambahan?
- Bagaimana placeholder bisa membantu?
- Apa risiko menyimpan metadata dari environment variable?

### Latihan 4

Java callback mengirim HTTP request ke incident management system pada `afterMigrateError`.

Pertanyaan:

- Apa failure mode-nya?
- Bagaimana membuatnya lebih aman?
- Apakah pipeline lebih cocok?

### Latihan 5

`beforeMigrate.sql` melakukan insert ke table `migration_audit`, tetapi table tersebut dibuat oleh `V001__create_migration_audit.sql`.

Pertanyaan:

- Apa yang terjadi pada fresh database?
- Apa solusi desainnya?
- Mana solusi yang paling cocok untuk sistem enterprise?

---

## 43. Referensi

- Redgate Flyway Documentation — Callback Events.
- Redgate Flyway Documentation — Callbacks.
- Redgate Flyway Documentation — Callback Locations setting.
- Redgate Flyway Documentation — Skip Default Callbacks setting.
- Redgate Flyway Documentation — Migration placeholders.
- Redgate Flyway Documentation — Migrations.

---

## 44. Posisi Kita dalam Seri

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

Berikutnya:

- Part 10 — Flyway Baseline, Repair, Validate, Clean

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 8 — Flyway Java-Based Migrations](./08-flyway-java-based-migrations.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: 10 — Flyway Baseline, Repair, Validate, and Clean](./10-flyway-baseline-repair-validate-clean.md)

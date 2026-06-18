# learn-java-deployment-runtime-release-delivery-engineering

## Part 18 — Database-Aware Deployment and Schema Migration

> Seri: Java Deployment, Runtime, Release, and Delivery Engineering  
> Scope versi Java: Java 8 sampai Java 25  
> Fokus: bagaimana merilis aplikasi Java yang mengubah database tanpa merusak compatibility, transaksi berjalan, data historis, rollback path, auditability, dan operasional production.

---

## 0. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami bahwa deployment database bukan sekadar menjalankan script SQL sebelum aplikasi naik.
2. Mendesain perubahan schema yang aman untuk rolling deployment, blue-green deployment, canary, dan multi-instance Java service.
3. Membedakan perubahan schema yang backward-compatible, forward-compatible, destructive, blocking, dan data-sensitive.
4. Menggunakan pola **expand-contract** untuk zero/near-zero downtime schema evolution.
5. Menentukan kapan migration harus berjalan di pipeline, sebagai job terpisah, saat startup aplikasi, atau manual DBA-controlled.
6. Memahami failure mode Flyway/Liquibase, migration locking, checksum drift, partially-applied migration, dan environment drift.
7. Mendesain rollback/roll-forward strategy yang realistis, terutama ketika data sudah berubah.
8. Membuat application-version/database-version matrix yang bisa dipakai untuk release governance.
9. Menghubungkan Java deployment dengan transaction boundary, ORM mapping, connection pool, cache, message processing, reporting, dan audit trail.
10. Membangun checklist production deployment ketika release menyentuh database.

---

## 1. Mental Model: Database Is Not Just Another Dependency

Dalam deployment Java, database sering diperlakukan seperti dependency biasa:

```text
application.jar -> needs database -> run migration -> start app
```

Model ini terlalu dangkal.

Database berbeda dari dependency lain karena ia menyimpan **state jangka panjang**. Container bisa dibuang. Pod bisa diganti. Artifact bisa rollback. Tetapi database menyimpan fakta historis, transaksi user, audit trail, workflow state, dan referensi legal/bisnis.

Deployment aplikasi Java biasanya bersifat **replaceable**:

```text
old app process dies
new app process starts
```

Deployment database bersifat **evolutionary**:

```text
old schema/data state evolves into new schema/data state
```

Perbedaan paling penting:

```text
Application artifact rollback is usually easy.
Database rollback is often not logically reversible.
```

Contoh:

```sql
ALTER TABLE customer DROP COLUMN old_identifier;
```

Kalau aplikasi baru gagal, kamu bisa rollback JAR. Tetapi column yang sudah di-drop tidak bisa dikembalikan tanpa backup/restore atau reconstruction.

Contoh lain:

```sql
UPDATE application_case
SET status = 'CLOSED'
WHERE status = 'APPROVED_AND_COMPLETED';
```

Secara SQL mungkin rollback bisa ditulis. Tetapi secara bisnis, apakah semua `CLOSED` setelah migration pasti berasal dari nilai lama itu? Kalau ada user yang membuat perubahan baru setelah migration, rollback data bisa merusak fakta baru.

Jadi, database-aware deployment harus memandang database sebagai:

1. **stateful system**;
2. **compatibility boundary**;
3. **coordination point** antar versi aplikasi;
4. **audit surface**;
5. **source of truth**;
6. **failure amplifier** ketika perubahan salah.

---

## 2. Deployment Problem: Code and Schema Do Not Change Atomically

Salah satu kesalahan mental model terbesar adalah menganggap aplikasi dan database berubah bersamaan secara atomik.

Dalam production, ini hampir tidak pernah benar.

Misalnya ada service Java dengan 6 replicas:

```text
app-v1 pod-1
app-v1 pod-2
app-v1 pod-3
app-v1 pod-4
app-v1 pod-5
app-v1 pod-6
```

Deployment rolling update mulai:

```text
app-v1 pod-1
app-v1 pod-2
app-v1 pod-3
app-v2 pod-4
app-v2 pod-5
app-v1 pod-6
```

Pada momen itu, database yang sama diakses oleh **dua versi aplikasi**.

```text
          +-------- app-v1
          |
database -+-------- app-v1
          |
          +-------- app-v2
```

Jika schema hanya cocok untuk v2, maka v1 bisa gagal. Jika schema hanya cocok untuk v1, maka v2 bisa gagal.

Karena itu, deployment database harus menjawab pertanyaan ini:

> Dalam window transisi, apakah schema dan data bisa dipakai oleh versi lama dan versi baru secara bersamaan?

Inilah inti **backward and forward compatibility**.

---

## 3. Istilah Penting

### 3.1 Schema

Schema adalah struktur database yang dipakai aplikasi:

- table;
- column;
- index;
- constraint;
- view;
- sequence/identity;
- stored procedure/function;
- trigger;
- materialized view;
- partition;
- type/enum;
- synonym;
- grant/privilege;
- schema ownership.

Untuk Java developer, schema bukan hanya DDL. Schema adalah **contract antara application code dan persisted state**.

---

### 3.2 Migration

Migration adalah perubahan terurut dari state database lama ke state database baru.

Contoh:

```text
V42__add_case_priority_column.sql
V43__backfill_case_priority.sql
V44__add_not_null_constraint_case_priority.sql
```

Migration harus dianggap seperti code:

- versioned;
- reviewed;
- tested;
- repeatable dalam environment baru;
- traceable ke release/change request;
- punya failure handling;
- punya ownership.

---

### 3.3 Backward-Compatible Schema Change

Schema baru masih bisa dipakai aplikasi lama.

Contoh biasanya aman:

```sql
ALTER TABLE case_file ADD priority VARCHAR(20);
```

Aplikasi lama tidak tahu column `priority`. Selama column nullable dan tidak ada constraint yang mengganggu insert lama, aplikasi lama tetap jalan.

---

### 3.4 Forward-Compatible Application Change

Aplikasi baru masih bisa berjalan terhadap schema lama untuk sementara.

Contoh:

```java
String priority = row.hasColumn("priority") ? row.getString("priority") : "NORMAL";
```

Dalam praktik ORM seperti JPA, forward compatibility terhadap schema lama lebih sulit karena mapping entity biasanya mengharapkan column tersedia. Karena itu, banyak strategi release memilih urutan:

```text
expand schema first -> deploy app -> contract schema later
```

---

### 3.5 Destructive Change

Perubahan yang menghapus atau merusak compatibility:

- drop column;
- rename column langsung;
- change type incompatible;
- tighten constraint tanpa data cleanup;
- delete reference data yang masih dipakai;
- change enum values;
- change stored procedure signature;
- remove index yang dipakai query lama;
- change semantic value.

Destructive change tidak selalu salah, tetapi hampir selalu perlu dipisahkan dari deployment aplikasi utama.

---

## 4. The Fundamental Rule: Never Couple App Cutover with Irreversible DB Cutover

Aturan senior/principal engineer:

```text
Do not make the first deployment step irreversible.
```

Release yang baik memberi ruang untuk:

1. deploy schema tambahan;
2. deploy app baru;
3. verify app baru;
4. rollback app jika perlu;
5. baru membersihkan schema lama setelah aman.

Release yang buruk melakukan ini:

```text
drop old column -> deploy app -> hope nothing fails
```

Release yang lebih aman:

```text
add new column -> dual write -> backfill -> read new column -> verify -> stop old usage -> drop old column later
```

---

## 5. Expand-Contract Pattern

Pola paling penting dalam database-aware deployment adalah **expand-contract**, juga dikenal sebagai **parallel change**. Martin Fowler menjelaskan parallel change sebagai teknik untuk melakukan perubahan backward-incompatible secara aman melalui fase ekspansi, perpindahan, lalu kontraksi.

### 5.1 Intuisi

Jangan langsung mengganti contract lama dengan contract baru.

Tambahkan contract baru di samping contract lama, biarkan dua versi hidup bersama, pindahkan traffic/data secara bertahap, lalu hapus contract lama setelah tidak ada pengguna.

```text
Phase 1: Expand
old contract + new contract coexist

Phase 2: Migrate
application moves from old to new

Phase 3: Contract
old contract removed
```

---

### 5.2 Contoh: Rename Column

Masalah:

```text
customer.full_name -> customer.legal_name
```

Anti-pattern:

```sql
ALTER TABLE customer RENAME COLUMN full_name TO legal_name;
```

Ini berbahaya untuk rolling deployment karena aplikasi lama masih mencari `full_name`.

Pola aman:

#### Release A — Expand

```sql
ALTER TABLE customer ADD legal_name VARCHAR(255);
```

Aplikasi v1 tetap memakai `full_name`.

#### Release B — Dual Write

Aplikasi v2 menulis ke dua column:

```text
write full_name
write legal_name
read full_name as source of truth
```

#### Release C — Backfill

```sql
UPDATE customer
SET legal_name = full_name
WHERE legal_name IS NULL;
```

Untuk table besar, jangan satu transaksi besar. Gunakan chunking.

#### Release D — Switch Read

Aplikasi v3 membaca dari `legal_name`, tetapi masih fallback ke `full_name`:

```text
read legal_name if present
else read full_name
write both
```

#### Release E — Stop Old Write

Aplikasi v4 hanya menulis `legal_name`, tetapi `full_name` masih ada.

#### Release F — Contract

Setelah aman:

```sql
ALTER TABLE customer DROP COLUMN full_name;
```

Ini bisa terjadi di release berbeda, setelah monitoring membuktikan tidak ada query/app lama yang memakai column lama.

---

### 5.3 Contoh: Split Column

Masalah:

```text
person.full_name -> person.first_name + person.last_name
```

Ini lebih sulit karena mapping data tidak selalu reversible.

Pola:

```text
1. add first_name, last_name nullable
2. app writes full_name and parsed names
3. backfill best-effort
4. expose UI/manual correction for ambiguous rows
5. app reads new fields with fallback
6. stop old field usage
7. drop full_name only after confidence
```

Dalam domain regulatory/case management, perubahan seperti ini harus hati-hati karena nama legal bisa punya struktur berbeda antar negara/budaya.

---

### 5.4 Contoh: Tighten Constraint

Masalah:

```text
case_file.priority nullable -> NOT NULL
```

Anti-pattern:

```sql
ALTER TABLE case_file MODIFY priority VARCHAR(20) NOT NULL;
```

Kalau masih ada data null, gagal. Kalau table besar, bisa lock lama tergantung database.

Pola aman:

```text
1. add application default for new writes
2. backfill old null values in chunks
3. validate no null remains
4. add NOT NULL constraint
5. monitor insert/update violations
```

SQL:

```sql
UPDATE case_file
SET priority = 'NORMAL'
WHERE priority IS NULL;
```

Untuk table besar:

```sql
-- pseudo pattern
UPDATE case_file
SET priority = 'NORMAL'
WHERE priority IS NULL
  AND id BETWEEN :low AND :high;
```

---

## 6. Database Migration Categories

Tidak semua migration sama. Kategorisasi menentukan risk dan deployment strategy.

### 6.1 Additive Schema Change

Contoh:

```sql
ALTER TABLE appeal ADD reviewer_comment VARCHAR(4000);
```

Biasanya aman jika:

- nullable;
- tidak ada default mahal;
- tidak mengubah trigger yang mempengaruhi insert lama;
- tidak menambah constraint yang dilanggar data lama;
- tidak memaksa table rewrite besar.

Risk level: rendah sampai sedang.

---

### 6.2 Constraint Change

Contoh:

```sql
ALTER TABLE appeal ADD CONSTRAINT chk_status CHECK (status IN ('DRAFT', 'SUBMITTED'));
```

Risk:

- data lama melanggar constraint;
- aplikasi lama masih menulis value lama;
- bulk import/job masih memakai format lama;
- constraint validation lock/blocking.

Risk level: sedang sampai tinggi.

---

### 6.3 Index Change

Contoh:

```sql
CREATE INDEX idx_case_status_created ON case_file(status, created_at);
```

Risk:

- table lock/blocking tergantung database dan mode;
- IO spike;
- redo/WAL generation;
- replication lag;
- longer insert/update cost setelah index ada;
- query plan berubah tidak selalu lebih baik.

Risk level: sedang.

---

### 6.4 Data Migration

Contoh:

```sql
UPDATE case_file SET normalized_status = 'OPEN' WHERE status IN ('NEW', 'IN_PROGRESS');
```

Risk:

- long transaction;
- undo/redo/WAL growth;
- row lock;
- replication lag;
- application sees partially migrated data;
- irreversible semantic conversion.

Risk level: tinggi.

---

### 6.5 Destructive Schema Change

Contoh:

```sql
DROP TABLE legacy_case_audit;
```

Risk:

- irreversible without backup;
- hidden consumers break;
- reports/jobs break;
- rollback app impossible;
- audit/legal evidence lost.

Risk level: sangat tinggi.

---

### 6.6 Reference Data Change

Contoh:

```sql
INSERT INTO code_table(code, label) VALUES ('SUSPENDED', 'Suspended');
```

Risk sering diremehkan.

Reference data bisa menjadi contract untuk:

- frontend dropdown;
- validation;
- workflow state;
- report;
- external integration;
- authorization rule;
- SLA calculation.

Risk level: rendah sampai tinggi tergantung domain.

---

### 6.7 Stored Procedure / Function / Trigger Change

Risk:

- aplikasi Java tidak terlihat berubah, tapi behavior berubah;
- hidden side effect;
- transaction semantics berubah;
- performance berubah;
- rollback sulit jika data sudah dimutasi.

Risk level: tinggi.

---

## 7. Deployment Strategy by Migration Type

| Migration Type | Bias Strategy | App Rolling Safe? | Rollback App Safe? | Notes |
|---|---:|---:|---:|---|
| Add nullable column | Expand before app | Usually yes | Usually yes | Ensure old inserts unaffected |
| Add non-null column with default | Expand carefully | Depends | Depends | May rewrite/lock table depending DB |
| Rename column | Expand-contract | No if direct rename | No if direct rename | Use dual read/write |
| Drop column | Contract later | No | No | Only after old app impossible |
| Add index | Separate migration window/job | Usually yes | Usually yes | Monitor lock/IO/plan |
| Drop index | Delayed contract | Depends | Risky | Old query may degrade |
| Add constraint | After cleanup | Depends | Depends | Validate existing data first |
| Data backfill | Async/chunked | Depends | Often hard | Design idempotent backfill |
| Enum/code change | Multi-phase | Depends | Depends | Watch integrations |
| Stored proc signature change | Versioned proc | No if direct | No if direct | Add v2 proc first |

---

## 8. Java Application Compatibility Dimensions

Database schema compatibility tidak cukup. Java application punya beberapa layer yang ikut terdampak.

### 8.1 ORM Entity Mapping

Contoh JPA entity:

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {
    @Column(name = "PRIORITY", nullable = false)
    private String priority;
}
```

Kalau column `PRIORITY` belum ada, aplikasi bisa gagal saat query/insert. Kalau nullable DB tetapi entity menganggap not null, bug bisa muncul di layer validasi.

Masalah umum:

- entity mengharapkan column baru sebelum migration jalan;
- schema auto-update Hibernate tidak sengaja aktif di production;
- naming strategy berbeda antar environment;
- enum ordinal dipakai sehingga perubahan enum merusak data;
- lazy association berubah query plan;
- generated SQL tidak compatible dengan index baru/lama.

Prinsip:

```text
Production schema must be controlled by migration, not by ORM auto-DDL.
```

Hibernate `ddl-auto=update` terlihat praktis, tetapi untuk production governance ia berbahaya karena:

- tidak cukup explicit;
- sulit review;
- tidak selalu menghasilkan DDL optimal;
- bisa berbeda antar database dialect;
- tidak cocok untuk phased migration;
- tidak menjelaskan rollback/contract phase.

---

### 8.2 JDBC SQL / MyBatis / Native Query

Native query lebih explicit, tetapi rawan terhadap rename/drop column.

Contoh:

```sql
SELECT id, full_name FROM customer WHERE status = ?
```

Jika column `full_name` dihapus, query gagal.

Untuk phased migration, kamu mungkin perlu query transisi:

```sql
SELECT id,
       COALESCE(legal_name, full_name) AS display_name
FROM customer
WHERE status = ?
```

Tetapi jangan jadikan fallback selamanya. Fallback harus punya exit plan.

---

### 8.3 Connection Pool

Migration sering butuh connection terpisah dari traffic aplikasi.

Masalah umum:

```text
app starts -> Hikari pool opens 50 connections -> migration also needs lock/DDL -> database saturated
```

Atau:

```text
migration long-running -> app startup blocked -> Kubernetes startup probe fails -> pod killed -> migration retried -> chaos
```

Prinsip:

```text
Do not let migration behavior be accidentally controlled by app startup lifecycle unless the risk is intentionally accepted.
```

---

### 8.4 Cache

Jika schema/data berubah, cache bisa menyimpan bentuk lama.

Contoh:

```text
Redis cache stores CustomerDto{name}
new app expects CustomerDto{legalName}
```

Risk:

- deserialization error;
- stale value;
- semantic mismatch;
- cache poisoning antar versi;
- old and new app sharing incompatible cache key/value.

Pola aman:

- versioned cache key;
- cache namespace per app version jika perlu;
- tolerate missing field;
- invalidate after migration;
- avoid Java native serialization for cross-version cache;
- use JSON/protobuf with compatibility rules.

---

### 8.5 Message Consumers

Database migration sering bertemu asynchronous processing.

Contoh:

```text
message created by v1 -> consumed by v2 -> writes to new schema
message created by v2 -> consumed by v1 -> fails
```

Jika release menyentuh DB dan message schema, perlu versioning ganda:

```text
application version compatibility
+ database schema compatibility
+ message schema compatibility
```

---

### 8.6 Reports and External Consumers

Hidden consumers sering menjadi penyebab deployment gagal:

- reporting query langsung ke DB;
- BI dashboard;
- scheduled export;
- downstream ETL;
- database link;
- manual SQL by operations;
- read-only integration user;
- audit view;
- materialized view.

Sebelum drop/rename, cari consumer.

Pertanyaan penting:

```text
Who reads this table/column besides the Java application?
```

---

## 9. Flyway and Liquibase: Tooling Mental Model

Flyway dan Liquibase bukan magic safety layer. Mereka adalah **migration orchestration tools**.

Mereka membantu:

- ordering;
- tracking applied changes;
- preventing accidental re-run;
- checksum validation;
- repeatability;
- integration with Maven/Gradle/CLI/pipeline;
- environment consistency.

Mereka tidak otomatis menjamin:

- zero downtime;
- backward compatibility;
- no locking;
- semantic correctness;
- reversible data transformation;
- safe rollback;
- proper chunking;
- no query plan regression.

---

### 9.1 Flyway Mental Model

Flyway memakai migration scripts yang biasanya diberi version:

```text
V1__create_case_table.sql
V2__add_case_priority.sql
V3__backfill_case_priority.sql
R__refresh_case_listing_view.sql
```

Flyway menyimpan state migration pada schema history table. Dokumentasi Redgate menyebut Flyway menambahkan schema history table yang berfungsi sebagai audit trail perubahan schema yang telah dilakukan.

Konsep penting:

- versioned migration;
- repeatable migration;
- checksum;
- baseline;
- repair;
- out-of-order migration;
- schema history table;
- locations;
- placeholders;
- callbacks.

Prinsip production:

```text
A migration file that has run in a shared environment should be treated as immutable.
```

Kalau file lama diubah setelah applied, checksum mismatch dapat terjadi. Itu bagus, karena tool menangkap drift antara source-controlled migration dan database state.

---

### 9.2 Liquibase Mental Model

Liquibase memakai changelog dan changeset. Dokumentasi Liquibase mendefinisikan changeset sebagai unit dasar perubahan yang disimpan di changelog, dan changelog dapat memakai format SQL, XML, YAML, atau JSON.

Contoh YAML:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-18-001-add-case-priority
      author: fajar
      changes:
        - addColumn:
            tableName: case_file
            columns:
              - column:
                  name: priority
                  type: varchar(20)
```

Konsep penting:

- changeset id + author + path identity;
- checksum;
- preconditions;
- contexts;
- labels;
- rollback definitions;
- changelog include/includeAll;
- databasechangelog table;
- databasechangeloglock table;
- updateSQL/dry-run SQL;
- tag and rollback-to-tag.

Contexts di Liquibase dipakai untuk mengontrol changeset mana yang dijalankan berdasarkan filter runtime.

---

### 9.3 Flyway vs Liquibase: Deployment Perspective

| Dimension | Flyway | Liquibase |
|---|---|---|
| Mental model | SQL-first versioned migrations | Changelog/changeset abstraction |
| Best fit | Teams comfortable with explicit SQL | Teams needing cross-DB abstraction/governance |
| SQL control | Very direct | Direct or generated depending style |
| Rollback | Often manual/Teams features depending edition/use | Built-in rollback model, but still must be logically valid |
| Governance metadata | Simple but clear | Richer labels/contexts/preconditions |
| Cross-database | Possible, but SQL tends DB-specific | Stronger abstraction, still requires DB expertise |
| Zero downtime | Must be designed by team | Must be designed by team |

Top engineer tidak memilih tool karena hype. Ia memilih berdasarkan:

- DB complexity;
- team SQL maturity;
- DBA governance;
- audit requirement;
- multi-database need;
- release process;
- rollback expectation;
- CI/CD integration;
- enterprise approval model.

---

## 10. Where Should Migration Run?

Ada beberapa strategi.

### 10.1 Migration Runs on Application Startup

Contoh Spring Boot:

```text
app starts -> Flyway/Liquibase runs -> app accepts traffic
```

Kelebihan:

- simple;
- environment otomatis up-to-date;
- cocok untuk small service/simple schema;
- developer experience baik.

Risiko:

- multiple replicas race/lock;
- pod startup blocked;
- migration failure causes app unavailable;
- long migration conflicts with Kubernetes probe;
- app identity punya DDL privilege;
- hard to separate DB approval from app deployment;
- rollback app can accidentally run wrong migration behavior.

Cocok jika:

- schema small;
- migration cepat;
- low criticality;
- single instance or controlled startup;
- DDL privilege acceptable;
- migration backward-compatible.

Tidak cocok jika:

- regulated production;
- long-running data migration;
- many replicas;
- strict DBA control;
- zero downtime requirement;
- destructive changes.

---

### 10.2 Migration Runs as CI/CD Pipeline Step

```text
build artifact -> deploy migration -> deploy app
```

Kelebihan:

- migration terpisah dari app startup;
- logs/evidence jelas;
- failure stops release before app rollout;
- better approval gate;
- app runtime tidak perlu DDL privilege.

Risiko:

- pipeline needs DB access;
- credential management lebih sensitif;
- network path ke DB harus disediakan;
- coordination dengan app rollout penting;
- partial release handling perlu jelas.

Cocok untuk enterprise production.

---

### 10.3 Migration Runs as Kubernetes Job

```text
kubectl apply job/db-migration
wait success
kubectl rollout deployment/app
```

Kelebihan:

- dekat dengan cluster runtime;
- dapat memakai same secret/config;
- logs captured;
- one-shot execution;
- easy integrate with Helm hooks/Argo workflows.

Risiko:

- Job retry bisa berbahaya jika migration tidak idempotent;
- hook ordering bisa kompleks;
- cleanup/history harus diatur;
- migration image harus versioned;
- RBAC/secret handling.

Pattern:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: case-service-db-migration-v42
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migration
          image: registry.example.com/case-service-migration:1.42.0
          envFrom:
            - secretRef:
                name: case-service-db-secret
```

Untuk migration production, `backoffLimit: 0` sering lebih aman daripada retry otomatis buta. Retry harus keputusan sadar setelah inspeksi failure.

---

### 10.4 Manual DBA-Controlled Migration

```text
DBA reviews SQL -> DBA runs SQL -> app deployment follows
```

Kelebihan:

- kontrol tinggi;
- cocok untuk regulated/high-risk DB;
- DBA bisa monitor lock/session;
- cocok untuk Oracle/large enterprise.

Risiko:

- manual error;
- drift dari source control;
- slower delivery;
- script versioning sering kacau jika tidak disiplin;
- evidence tersebar.

Cara membuatnya tetap modern:

- SQL generated from versioned migration;
- checksum recorded;
- execution log stored;
- pre-check/post-check scripted;
- rollback/roll-forward decision documented;
- DBA execution tetap traceable ke Git commit/release ID.

---

## 11. Migration Ordering Models

### 11.1 Schema Before App

```text
1. run backward-compatible schema expansion
2. deploy app
```

Ini default paling aman untuk rolling deployment.

Contoh:

```text
add nullable column -> deploy app that writes it
```

---

### 11.2 App Before Schema

Kadang dipakai jika app baru tidak langsung memakai schema baru karena feature flag mati.

```text
1. deploy app code dormant
2. run schema migration
3. enable feature flag
```

Risk:

- code path harus benar-benar dormant;
- accidental activation bisa fail;
- health check tidak boleh menyentuh missing schema;
- background job tidak boleh berjalan lebih awal.

---

### 11.3 Schema and App Together

```text
run migration and app rollout in same window
```

Ini umum, tapi harus dibedakan:

- together with backward-compatible schema: acceptable;
- together with destructive schema: risky;
- together with long data migration: risky;
- together with multi-service dependency: very risky.

---

### 11.4 Contract After Stability Window

```text
release N: expand
release N+1: app uses new contract
release N+2 or later: remove old contract
```

Ini paling cocok untuk high-criticality systems.

---

## 12. Database Locks and Blocking: Deployment Reality

DDL tidak gratis. Banyak DDL mengambil lock.

Walaupun syntax terlihat sederhana:

```sql
ALTER TABLE case_file ADD COLUMN priority VARCHAR(20);
```

Efeknya tergantung DB engine, version, table size, default value, nullability, index, constraints, replication, dan concurrent transactions.

### 12.1 Lock Questions to Ask

Sebelum menjalankan DDL:

```text
1. Lock apa yang diambil?
2. Apakah read blocked?
3. Apakah write blocked?
4. Berapa lama lock ditahan?
5. Apakah table di-rewrite?
6. Apakah index build online/concurrently tersedia?
7. Apakah replication lag akan naik?
8. Apakah DDL transactional di database ini?
9. Apakah ada long-running transaction yang bisa menahan DDL?
10. Bagaimana membatalkan migration jika blocked?
```

PostgreSQL dokumentasi menjelaskan lock mode dipakai untuk mengontrol concurrent access, dan banyak command otomatis mengambil lock yang sesuai agar object tidak dimodifikasi/dihapus secara incompatible saat command berjalan.

---

### 12.2 Long-Running Transaction Problem

DDL sering menunggu transaksi lama.

```text
transaction A reads table for 20 minutes
migration B wants ALTER TABLE
migration B waits
new writes queue behind migration lock
application latency spikes
incident
```

Ini disebut lock queue amplification.

Mitigasi:

- set lock timeout;
- check active sessions before migration;
- kill/coordinate long-running session;
- run during low traffic;
- online DDL where available;
- split migration;
- avoid transaction wrapping around long DDL if DB-specific behavior requires;
- use concurrent index creation where supported.

---

### 12.3 Index Creation

Index creation bisa mahal.

Pertanyaan:

```text
Is the index build blocking writes?
Is online/concurrent mode available?
How much temp space is needed?
Will it change query plans immediately?
Can it be cancelled safely?
```

PostgreSQL punya `CREATE INDEX CONCURRENTLY`, tetapi ada batasan transactional dan failure behavior. Oracle punya konsep online index build di edisi/fitur tertentu. MySQL/InnoDB punya online DDL dengan variasi tergantung operation/version.

Prinsip:

```text
Never assume DDL behavior from one database applies to another.
```

---

## 13. Data Migration and Backfill

Data migration jauh lebih berbahaya daripada schema migration sederhana.

### 13.1 Bad Backfill

```sql
UPDATE audit_trail
SET normalized_module = UPPER(module);
```

Jika table berisi 200 juta row, ini bisa:

- membuat transaksi sangat besar;
- menghabiskan undo/redo/WAL;
- memblokir row;
- membuat replication lag;
- membuat vacuum/cleanup pressure;
- memenuhi tablespace/storage;
- mengganggu backup;
- membuat app timeout.

---

### 13.2 Chunked Backfill

Lebih aman:

```text
process rows in batches
commit per batch
sleep between batches
track progress
make operation idempotent
allow stop/resume
monitor DB load
```

Pseudo SQL:

```sql
UPDATE case_file
SET priority = 'NORMAL'
WHERE priority IS NULL
  AND id > :last_id
  AND id <= :next_id;
```

Pseudo Java runner:

```java
while (true) {
    BatchRange range = progress.nextRange();
    int updated = repository.backfillPriority(range.low(), range.high());
    progress.markCompleted(range);

    if (updated == 0 && progress.isFinished()) {
        break;
    }

    Thread.sleep(throttleMs);
}
```

Backfill harus punya table progress:

```sql
CREATE TABLE migration_progress (
    migration_id VARCHAR(100) PRIMARY KEY,
    last_processed_id BIGINT,
    status VARCHAR(30),
    updated_count BIGINT,
    started_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

---

### 13.3 Idempotency

Backfill harus aman dijalankan ulang.

Buruk:

```sql
UPDATE account SET balance = balance + bonus_amount;
```

Jika retry, bonus dobel.

Lebih aman:

```sql
UPDATE account
SET balance = original_balance + bonus_amount,
    bonus_applied = true
WHERE bonus_applied = false;
```

Atau simpan ledger/event sehingga transformasi punya identity.

---

### 13.4 Dual-Run and Verification

Untuk data penting:

```text
1. compute old result
2. compute new result
3. compare
4. log mismatch
5. fix mismatch
6. switch read path only after confidence
```

Contoh:

```sql
SELECT COUNT(*) FROM customer WHERE legal_name IS NULL;
SELECT COUNT(*) FROM customer WHERE legal_name <> full_name;
```

Untuk domain kompleks, verification bukan sekadar row count. Perlu semantic invariant:

```text
Every active enforcement case must still have exactly one current owner.
Every submitted application must still be linked to an applicant profile.
Every audit event must remain associated with original case id.
```

---

## 14. Rollback Reality

Aplikasi bisa rollback dari `v2` ke `v1`.

Database sering tidak bisa rollback dengan aman.

### 14.1 Three Types of Rollback

#### 1. Application rollback

```text
app-v2 -> app-v1
```

Ini aman jika schema masih compatible dengan v1.

#### 2. Schema rollback

```text
schema-v2 -> schema-v1
```

Ini mungkin jika perubahan additive belum dipakai, tetapi sulit jika data sudah berubah.

#### 3. Data rollback

```text
data after transformation -> data before transformation
```

Ini paling sulit karena bisa kehilangan perubahan user setelah migration.

---

### 14.2 Roll-Forward Bias

Untuk production database, sering lebih aman melakukan **roll-forward fix** daripada rollback database.

Contoh:

```text
V42 adds nullable column
app v2 fails because query bug
rollback app to v1
leave schema V42 in place
later deploy app v2.1
```

Ini aman jika V42 backward-compatible.

Prinsip:

```text
Design database changes so application rollback does not require database rollback.
```

---

### 14.3 When DB Rollback Is Reasonable

DB rollback mungkin reasonable jika:

- migration failed before commit;
- DDL transactional and rolled back automatically;
- change is additive and unused;
- no user traffic has written to new structure;
- rollback SQL is tested;
- backup/restore window acceptable;
- environment is non-production.

DB rollback berbahaya jika:

- data sudah transformed;
- old data overwritten;
- new app served user traffic;
- external systems consumed new values;
- audit/legal data changed;
- destructive DDL executed.

---

## 15. Application-Version / Database-Version Matrix

Untuk release yang menyentuh DB, buat matrix compatibility.

Contoh:

| App Version | DB V41 | DB V42 Expand | DB V43 Backfill | DB V44 Contract |
|---|---:|---:|---:|---:|
| app v1 | ✅ | ✅ | ✅ | ❌ |
| app v2 dual-write | ❌/⚠️ | ✅ | ✅ | ✅ |
| app v3 read-new | ❌ | ⚠️ | ✅ | ✅ |
| app v4 no-old | ❌ | ❌ | ✅ | ✅ |

Interpretasi:

- `app v1` bisa rollback selama contract belum dilakukan.
- `app v3` butuh backfill cukup lengkap atau fallback logic.
- `DB V44 Contract` tidak boleh dilakukan sebelum semua app lama mustahil berjalan.

Matrix ini jauh lebih berguna daripada kalimat “migration sudah tested”.

---

## 16. Release Plan Example: Add Priority to Case File

### 16.1 Requirement

Tambahkan `priority` untuk case file.

Nilai:

```text
LOW
NORMAL
HIGH
URGENT
```

Existing case harus default `NORMAL`.

---

### 16.2 Bad Plan

```text
1. add NOT NULL priority column
2. deploy app
3. hope all rows valid
```

Risk:

- table rewrite;
- failure karena existing rows;
- old app insert gagal;
- rollback app gagal jika DB constraint terlalu ketat.

---

### 16.3 Good Plan

#### Release N — Expand

```sql
ALTER TABLE case_file ADD priority VARCHAR(20);
```

No NOT NULL yet.

#### Release N — App Dual Behavior

App writes priority for new cases. Read fallback:

```java
public Priority effectivePriority(String dbPriority) {
    if (dbPriority == null || dbPriority.isBlank()) {
        return Priority.NORMAL;
    }
    return Priority.valueOf(dbPriority);
}
```

#### Release N+1 — Backfill

```sql
UPDATE case_file
SET priority = 'NORMAL'
WHERE priority IS NULL;
```

For large table, chunk it.

#### Release N+2 — Constraint

```sql
ALTER TABLE case_file
ADD CONSTRAINT chk_case_file_priority
CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'));
```

Then:

```sql
ALTER TABLE case_file MODIFY priority NOT NULL;
```

DB-specific syntax differs.

#### Release N+3 — Remove Fallback

Only after data verified.

---

## 17. Release Plan Example: Replace Status Code Semantics

### 17.1 Problem

Old statuses:

```text
NEW
IN_PROGRESS
DONE
```

New statuses:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
CLOSED
```

This is not a simple enum rename. It changes workflow semantics.

---

### 17.2 Risk

- old app does not understand new statuses;
- new app may not understand old statuses;
- reports break;
- SLA calculation changes;
- audit trail interpretation changes;
- downstream integrations reject values;
- state machine transition history becomes ambiguous.

---

### 17.3 Safer Plan

```text
1. Add new_status nullable
2. New app writes both old_status and new_status where possible
3. Define explicit mapping table
4. Backfill new_status with auditable mapping rules
5. Validate workflow invariants
6. Switch read to new_status with fallback
7. Update reports/integrations
8. Stop writing old_status
9. Contract old_status much later
```

Mapping table:

```sql
CREATE TABLE status_migration_mapping (
    old_status VARCHAR(50) NOT NULL,
    condition_code VARCHAR(100) NOT NULL,
    new_status VARCHAR(50) NOT NULL,
    rule_version VARCHAR(50) NOT NULL,
    approved_by VARCHAR(100),
    approved_at TIMESTAMP
);
```

For regulatory systems, mapping must be explainable. You need to know why a case moved from old status to new status.

---

## 18. Migration with Multiple Java Services

Single service migration is already complex. Multi-service makes it harder.

Suppose:

```text
case-service writes case_file
appeal-service reads case_file
report-service queries case_file
notification-service reacts to case events
```

Changing `case_file.status` affects all.

Deployment plan must include:

```text
producer compatibility
consumer compatibility
database compatibility
message compatibility
report compatibility
API compatibility
```

Bad sequence:

```text
case-service deploys new status
appeal-service not updated
report-service fails
```

Better:

```text
1. expand DB
2. update consumers to tolerate old + new
3. update producer to emit/write new
4. verify downstream
5. remove old only after all consumers migrated
```

This is the same expand-contract idea, but across services.

---

## 19. Migration and Feature Flags

Feature flags are useful but not a replacement for schema compatibility.

### 19.1 Safe Use

```text
Deploy code that can use new schema, but keep feature off until schema ready.
```

### 19.2 Dangerous Use

```text
Drop old column, hide UI behind feature flag, assume safe.
```

Feature flag does not protect:

- background jobs;
- API calls;
- old app versions;
- reports;
- integration jobs;
- direct DB consumers;
- ORM startup validation;
- scheduled batch.

Rule:

```text
Feature flag controls behavior, not structural compatibility.
```

---

## 20. Migration and Java Transaction Boundaries

A database change may subtly break application transaction logic.

Example:

```java
@Transactional
public void submitCase(Long caseId) {
    CaseFile caseFile = repository.findByIdForUpdate(caseId);
    caseFile.submit();
    auditTrail.record(caseFile);
    notification.enqueue(caseFile);
}
```

If migration adds trigger that writes audit automatically, you may now double-write audit.

If migration adds FK constraint, old transaction order may fail:

```text
insert child before parent -> previously allowed -> now fails
```

If migration changes unique constraint, concurrent requests that previously worked may now conflict.

Deployment review must inspect:

- transaction order;
- flush timing;
- ORM dirty checking;
- optimistic lock version;
- pessimistic lock queries;
- trigger side effects;
- constraint timing;
- isolation level assumptions.

---

## 21. Migration and Connection Pool Sizing

During migration, DB load changes.

### 21.1 Common Failure

```text
migration runs heavy update
app pool still sends normal traffic
DB CPU/IO spikes
Hikari requests timeout
app readiness fails
Kubernetes restarts pods
connection storm worsens DB
```

### 21.2 Controls

- reduce app traffic during heavy migration;
- run migration in maintenance window;
- throttle backfill;
- reduce migration batch size;
- isolate migration connection pool;
- set statement timeout;
- set lock timeout;
- monitor active sessions;
- avoid app auto-restart storm;
- temporarily disable non-critical schedulers.

---

## 22. Migration and Schedulers / Batch Jobs

Java apps often have scheduled jobs:

- nightly report;
- SLA recalculation;
- reminder email;
- data sync;
- cleanup;
- queue retry;
- archival.

Schema migration may conflict with these jobs.

Questions:

```text
1. Should scheduled jobs pause during migration?
2. Can jobs run against mixed schema?
3. Can jobs process partially migrated data?
4. Can jobs create old-shape data after backfill?
5. Who owns job disable/enable in release plan?
```

If a backfill updates `priority` to `NORMAL`, but an old batch keeps inserting null, your validation will keep failing.

---

## 23. Migration and Auditability

For serious systems, migration must leave evidence.

Evidence includes:

- migration scripts;
- checksum;
- Git commit;
- release version;
- CR/ticket ID;
- execution timestamp;
- executor identity;
- database user;
- environment;
- pre-check result;
- post-check result;
- row counts affected;
- exception logs;
- approval record;
- rollback/roll-forward decision.

For data migration, also record:

- mapping rules;
- counts by category;
- rejected/ambiguous rows;
- manual correction list;
- reconciliation report.

---

## 24. Pre-Deployment Checklist for DB-Aware Java Release

### 24.1 Compatibility

```text
[ ] Can old app run on new schema?
[ ] Can new app tolerate old data shape?
[ ] During rolling update, can old and new app coexist?
[ ] Are all consumers updated/tolerant?
[ ] Are reports/views/jobs checked?
[ ] Are cache keys/value formats compatible?
[ ] Are messages/events compatible?
```

### 24.2 Migration Safety

```text
[ ] Is migration additive, destructive, or data-changing?
[ ] Does it lock large tables?
[ ] Has lock behavior been tested on realistic data volume?
[ ] Is there lock timeout?
[ ] Is there statement timeout?
[ ] Is there progress tracking for long migration?
[ ] Is migration idempotent or safely non-repeatable?
[ ] Is retry behavior defined?
[ ] Is backup/restore requirement understood?
```

### 24.3 Rollback/Roll-Forward

```text
[ ] Can app rollback without DB rollback?
[ ] If DB rollback is needed, has it been tested?
[ ] Is roll-forward fix preferred?
[ ] Is destructive contract delayed?
[ ] Is compatibility matrix documented?
```

### 24.4 Operations

```text
[ ] Who runs migration?
[ ] What credential is used?
[ ] Does app runtime have DDL privilege? Should it?
[ ] Are DBA and app team aligned?
[ ] Are monitoring dashboards ready?
[ ] Are slow query/lock/session views ready?
[ ] Is there a stop/cancel procedure?
[ ] Are affected jobs paused if needed?
```

### 24.5 Verification

```text
[ ] Migration history table updated?
[ ] Expected columns/tables/indexes exist?
[ ] Row counts match expectation?
[ ] Invalid data count is zero?
[ ] Application smoke test passed?
[ ] Critical workflow synthetic test passed?
[ ] Logs clean from SQL errors?
[ ] DB CPU/IO/lock metrics normal?
[ ] Replication lag normal?
```

---

## 25. Post-Deployment Verification Queries

Examples only; adapt to DB.

### 25.1 Schema Existence

```sql
SELECT column_name, data_type, nullable
FROM information_schema.columns
WHERE table_name = 'case_file'
  AND column_name = 'priority';
```

For Oracle:

```sql
SELECT column_name, data_type, nullable
FROM all_tab_columns
WHERE table_name = 'CASE_FILE'
  AND column_name = 'PRIORITY';
```

---

### 25.2 Data Quality

```sql
SELECT COUNT(*) AS null_priority_count
FROM case_file
WHERE priority IS NULL;
```

```sql
SELECT priority, COUNT(*)
FROM case_file
GROUP BY priority
ORDER BY priority;
```

---

### 25.3 Invalid Reference

```sql
SELECT cf.priority, COUNT(*)
FROM case_file cf
LEFT JOIN priority_code pc ON pc.code = cf.priority
WHERE pc.code IS NULL
GROUP BY cf.priority;
```

---

### 25.4 Application Error Signal

Application-level query patterns to check in logs:

```text
SQLSyntaxErrorException
SQLIntegrityConstraintViolationException
DataIntegrityViolationException
BadSqlGrammarException
ConstraintViolationException
SQLTransientConnectionException
Lock wait timeout
Deadlock found
ORA-00054
ORA-00060
ORA-01400
ORA-02291
ORA-02292
```

---

## 26. Anti-Patterns

### 26.1 “Just Let Hibernate Update the Schema”

Bad because production DDL becomes implicit.

---

### 26.2 “Migration Runs on Every Pod Startup”

Bad for multi-replica systems if not intentionally controlled.

---

### 26.3 “Rename Column Directly”

Breaks old version during rolling deployment.

---

### 26.4 “Drop Old Column in Same Release”

Kills rollback path.

---

### 26.5 “One Huge Data Update Transaction”

Can destroy DB availability.

---

### 26.6 “Rollback SQL Means We Are Safe”

Rollback SQL may be technically valid but semantically unsafe.

---

### 26.7 “Only App Uses This Table”

Often false in enterprise systems.

---

### 26.8 “Tested on DEV with Small Data”

Locking, IO, and plan behavior on production-sized data can differ massively.

---

### 26.9 “DDL Is Fast Because It Was Fast Locally”

Local database has no production concurrency, replication, volume, or long transactions.

---

### 26.10 “Blue-Green Solves DB Migration”

Blue-green helps app cutover, but both blue and green often share one database. If schema is incompatible, blue-green alone does not solve the database problem.

---

## 27. Production-Grade DB Migration Architecture

A mature Java deployment setup often looks like this:

```text
Git
 |
 |-- application source
 |-- migration scripts
 |-- migration metadata
 |
CI
 |
 |-- compile/test
 |-- package artifact
 |-- validate migration order/checksum
 |-- generate migration SQL preview
 |-- static review/risk classification
 |
Artifact Registry
 |
 |-- app image
 |-- migration image or migration bundle
 |
CD Pipeline
 |
 |-- pre-check DB
 |-- run expand migration
 |-- deploy app canary/rolling
 |-- smoke/synthetic test
 |-- run optional backfill job
 |-- verify metrics/logs/data
 |-- later contract migration
```

Important separation:

```text
app image != migration execution responsibility, unless consciously chosen
```

Migration can be packaged with app source but executed as separate release step.

---

## 28. Recommended Policy by Environment

### 28.1 Local

- ORM auto-DDL acceptable for quick experiments, but not as source of truth.
- Migration should still be runnable.
- Seed data allowed.

### 28.2 DEV

- Migration auto-run acceptable.
- Destructive reset possible if team agrees.
- Catch basic migration ordering issues.

### 28.3 SIT/UAT

- Migration should mimic production pipeline.
- No manual hidden SQL.
- Data volume should be realistic enough for lock/backfill testing.
- Rollback/roll-forward rehearsed for risky release.

### 28.4 Production

- Explicit approval.
- Least privilege.
- Pre-check and post-check required.
- Long migration separated.
- Destructive contract delayed.
- Evidence retained.
- DBA/app owner alignment.

---

## 29. Java-Specific Implementation Patterns

### 29.1 Spring Boot: Disable Auto Migration in Production App Startup

Example:

```yaml
spring:
  flyway:
    enabled: false
```

Then migration runs via pipeline/job:

```bash
java -jar migration-runner.jar migrate
```

Or Flyway CLI container.

This avoids app startup being migration orchestrator.

---

### 29.2 Separate Migration Module

Project layout:

```text
case-service/
  app/
    src/main/java/...
  db-migration/
    src/main/resources/db/migration/
    Dockerfile
  deployment/
    k8s/
```

Benefits:

- app runtime image can be minimal;
- migration image can include tools/scripts;
- ownership clear;
- pipeline can run migration without starting app.

---

### 29.3 Migration Runner with Advisory Lock

For custom migration/backfill, enforce single runner.

Pseudo:

```java
public void runMigration() {
    if (!lockService.tryAcquire("backfill-case-priority")) {
        throw new IllegalStateException("Migration already running");
    }

    try {
        backfill.run();
    } finally {
        lockService.release("backfill-case-priority");
    }
}
```

Use DB-native advisory lock where available, or migration progress table with safe transaction semantics.

---

### 29.4 Backfill as Batch Job, Not HTTP Request

Do not run large backfill from admin HTTP endpoint without robust control.

Better:

- Kubernetes Job;
- Spring Batch job;
- Quartz controlled job;
- CLI runner;
- DBA script with progress table.

Required features:

- resumable;
- idempotent;
- observable;
- throttled;
- cancellable;
- auditable.

---

## 30. Deployment Decision Framework

When a release touches database, ask:

### 30.1 Structural Question

```text
Is this change additive, modifying, or destructive?
```

### 30.2 Compatibility Question

```text
Can app old/new coexist with DB old/new?
```

### 30.3 State Question

```text
Is existing data transformed, reinterpreted, or deleted?
```

### 30.4 Lock Question

```text
Can this block production reads/writes?
```

### 30.5 Volume Question

```text
Does data size change the risk profile?
```

### 30.6 Consumer Question

```text
Who else reads/writes this object?
```

### 30.7 Rollback Question

```text
Can app rollback happen without DB rollback?
```

### 30.8 Governance Question

```text
What evidence proves this was executed correctly?
```

---

## 31. Example Release Runbook

```text
Release: case-service 2.14.0
DB migration: V20260618_001_add_case_priority
Risk: additive schema + data backfill
Rollback strategy: app rollback only; DB schema remains
```

### 31.1 Pre-Check

```text
[ ] Confirm current app version 2.13.x
[ ] Confirm DB migration at V20260601_004
[ ] Confirm no long-running transaction > 5 minutes
[ ] Confirm available tablespace/storage
[ ] Confirm backup completed
[ ] Confirm scheduled jobs paused if required
```

### 31.2 Migration

```text
[ ] Run expand migration
[ ] Verify column exists
[ ] Run app deployment canary
[ ] Verify canary logs no SQL error
[ ] Increase rollout
[ ] Run backfill job throttled
[ ] Verify null count zero
```

### 31.3 Post-Check

```text
[ ] Smoke test create case
[ ] Smoke test update case priority
[ ] Smoke test old case listing
[ ] Verify metrics normal
[ ] Verify DB lock wait normal
[ ] Verify error logs clean
[ ] Attach migration output to CR
```

### 31.4 Rollback

If app failure:

```text
[ ] rollback app to 2.13.x
[ ] do not rollback DB V20260618_001
[ ] confirm old app works with nullable priority column
[ ] create follow-up fix release
```

If migration failure before app deploy:

```text
[ ] stop deployment
[ ] inspect migration state
[ ] if no partial mutation, repair/retry based on DBA decision
[ ] if partial mutation, execute approved roll-forward correction
```

---

## 32. Top 1% Engineer Heuristics

1. A schema migration is a distributed systems problem disguised as SQL.
2. The dangerous part is not the DDL text; it is the compatibility window.
3. A rollback plan that requires restoring production database is usually not a rollback plan; it is disaster recovery.
4. Destructive changes belong in delayed contract releases.
5. Backfill must be resumable, idempotent, throttled, and observable.
6. Old and new app versions must be assumed to coexist during deployment.
7. Hidden consumers matter as much as the main Java service.
8. Database migration tools track execution; they do not design safety.
9. Lock behavior must be understood on the actual database engine/version.
10. App rollback should not require DB rollback.
11. Never let convenience in DEV become uncontrolled DDL in production.
12. Data semantics matter more than column names.
13. Schema compatibility should be represented as a matrix, not as hope.
14. Migration evidence is part of production readiness.
15. The safest deployment is often multi-release, not one heroic release.

---

## 33. Summary

Database-aware deployment is one of the most important differences between average backend engineering and senior/principal-level production engineering.

A Java application is not deployed into an empty world. It runs against persistent state, shared schema, historical data, background jobs, caches, queues, reports, external integrations, and operational governance.

The central principle is:

```text
Design schema changes so old and new application versions can coexist safely.
```

From that principle flow the rest:

- use expand-contract;
- avoid direct destructive changes;
- separate long backfills;
- delay contract cleanup;
- understand locks;
- design app rollback without DB rollback;
- keep migration scripts immutable;
- produce audit evidence;
- verify data semantics, not only SQL success.

If Part 17 was about release strategy at the application traffic layer, this Part 18 is about release strategy at the persistent state layer.

The deeper lesson:

```text
Deployment safety is compatibility engineering over time.
```

---

## 34. Practical Exercises

### Exercise 1 — Rename Column Safely

Design expand-contract plan for:

```text
application.applicant_name -> application.legal_representative_name
```

Include:

- migration scripts;
- app versions;
- fallback behavior;
- backfill;
- verification;
- rollback path;
- contract cleanup.

---

### Exercise 2 — Add NOT NULL Column to Large Table

Table `audit_trail` has 300 million rows. Add `source_channel NOT NULL`.

Design:

- expansion;
- defaulting strategy;
- backfill chunking;
- progress table;
- constraint validation;
- monitoring;
- failure handling.

---

### Exercise 3 — Status Model Migration

Old states:

```text
PENDING
APPROVED
REJECTED
```

New states:

```text
DRAFT
SUBMITTED
SCREENING
APPROVED
REJECTED
CANCELLED
EXPIRED
```

Design migration preserving audit/legal defensibility.

---

### Exercise 4 — Choose Migration Execution Model

For each environment, decide whether migration runs:

- at app startup;
- in pipeline;
- as Kubernetes Job;
- manually by DBA.

Explain trade-offs.

---

## 35. Referensi

- Redgate Flyway Documentation — Schema History Table.
- Redgate Flyway Documentation — Frequently Asked Questions.
- Liquibase Documentation — Changesets, Changelogs, Contexts, Rollback.
- Martin Fowler — Parallel Change.
- Martin Fowler — Evolutionary Database Design.
- PostgreSQL Documentation — Explicit Locking, ALTER TABLE, LOCK.
- Kubernetes Documentation — Jobs and deployment orchestration concepts.
- Spring Boot Documentation — Flyway/Liquibase integration and production configuration.

---

## 36. Status Series

Bagian ini adalah **Part 18 dari 35** dalam series:

```text
learn-java-deployment-runtime-release-delivery-engineering
```

Series **belum selesai**.

Part berikutnya:

```text
Part 19 — Stateful Java Deployment: Sessions, Caches, Queues, Schedulers, and Jobs
```

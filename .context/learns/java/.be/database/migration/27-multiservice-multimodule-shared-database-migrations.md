# Part 27 — Multi-Service, Multi-Module, and Shared Database Migrations

> Series: `learn-java-database-migrations-seedings-flyway-liquibase`  
> File: `27-multiservice-multimodule-shared-database-migrations.md`  
> Scope: Java 8–25, Flyway, Liquibase, Spring Boot, Jakarta EE, plain Java, distributed systems, modular monolith, microservices, shared database governance.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan bisa:

1. Membedakan strategi migration untuk:
   - single application single schema,
   - modular monolith shared schema,
   - multi-service shared database,
   - database-per-service,
   - multi-module enterprise application.
2. Mendesain ownership database change agar tidak kacau ketika banyak tim/module/service melakukan perubahan.
3. Memahami kenapa shared database sering menjadi bottleneck evolusi arsitektur.
4. Menentukan kapan migration boleh dimiliki service tertentu dan kapan harus dikelola sebagai platform/global migration.
5. Menghindari breaking change lintas service saat schema berubah.
6. Mendesain migration ordering, dependency, release train, dan compatibility matrix.
7. Membuat governance model yang realistis: cukup ketat untuk production, cukup ringan agar delivery tidak lumpuh.
8. Memahami bagaimana Flyway/Liquibase dipakai dalam sistem multi-module dan multi-service.

---

## 2. Core Mental Model

Database migration di satu aplikasi relatif sederhana:

```text
application version N  --->  migration version N  --->  database schema N
```

Namun dalam sistem besar, relasinya tidak lagi linear.

```text
Service A v12  ----\
Service B v7    ----+----> shared schema version 45
Batch Job C v3 ----/
Reporting D v9 ----/
Admin UI E v4 ----/
```

Masalah utamanya bukan sekadar “migration mana dulu”. Masalah sebenarnya adalah:

> Banyak runtime dengan release cadence berbeda bergantung pada satu stateful contract yang sama.

Database menjadi **shared contract**.

Jika contract berubah tanpa compatibility, maka satu perubahan kecil bisa merusak banyak aplikasi.

---

## 3. Why Shared Database Migration Is Hard

### 3.1 Code can be independently deployed; database often cannot

Service A bisa deploy jam 10:00. Service B bisa deploy jam 15:00. Batch job mungkin baru jalan jam 23:00. Reporting tool mungkin tidak deploy selama 3 bulan.

Tetapi database hanya punya satu keadaan aktual pada satu waktu.

```text
10:00 schema changed
10:01 Service A works
10:02 Service B breaks
23:00 Batch job breaks
next day Reporting query breaks
```

Inilah akar masalah shared database migration.

---

### 3.2 Database is both storage and integration surface

Dalam arsitektur sehat, service seharusnya berkomunikasi lewat API/event contract. Namun pada sistem enterprise, database sering juga menjadi integration surface:

- service lain membaca table langsung,
- batch job melakukan join antar module,
- report membaca view internal,
- ETL membaca transactional table,
- admin tool melakukan correction langsung,
- legacy app masih memakai schema yang sama.

Akibatnya, perubahan table bukan hanya perubahan storage. Itu perubahan API tersembunyi.

---

### 3.3 Migration conflict is a coordination problem

Dua tim bisa membuat migration valid secara lokal tetapi konflik secara global.

Contoh:

```text
Team A:
V20260617_1000__add_customer_status.sql
ALTER TABLE customer ADD status VARCHAR(20);

Team B:
V20260617_1010__rename_customer_status.sql
ALTER TABLE customer RENAME COLUMN status_code TO status;
```

Keduanya masuk akal sendiri-sendiri. Bersama-sama, konflik.

Migration conflict bukan hanya file conflict di Git. Bisa berupa:

- object naming conflict,
- semantic conflict,
- ordering conflict,
- data assumption conflict,
- ownership conflict,
- release timing conflict,
- runtime compatibility conflict.

---

## 4. Architectural Contexts

Sebelum memilih strategi migration, identifikasi bentuk sistemnya.

---

## 4.1 Single Application, Single Schema

```text
App ---> Schema
```

Ini bentuk paling sederhana.

Karakteristik:

- satu aplikasi utama,
- satu lifecycle deployment,
- migration bisa dijalankan sebelum app start,
- Flyway/Liquibase di aplikasi sering cukup,
- ordering relatif mudah.

Risiko:

- tetap bisa gagal jika migration besar,
- tetap perlu backward compatibility untuk rollback,
- tetap perlu governance untuk production.

Strategi umum:

```text
app artifact includes migrations
pipeline runs migration
app starts after migration success
```

Cocok untuk:

- small-to-medium service,
- internal application,
- single team ownership.

---

## 4.2 Modular Monolith, Shared Schema

```text
Module A ----\
Module B -----+---> same application runtime ---> shared schema
Module C ----/
```

Secara deployment, ini satu aplikasi. Secara domain, ini banyak module.

Contoh Java:

```text
src/main/java/com/company/application/customer
src/main/java/com/company/application/order
src/main/java/com/company/application/billing
src/main/resources/db/migration
```

Masalah:

- siapa boleh ubah table milik siapa?
- apakah module A boleh foreign key ke table module B?
- apakah migration disusun per module atau global?
- apakah satu changelog master atau banyak changelog module?

Strategi sehat:

```text
schema ownership follows module ownership
migration ordering remains global
review requires impacted module approval
```

Contoh struktur Flyway:

```text
src/main/resources/db/migration/
  V202606170900__customer_create_customer_table.sql
  V202606171000__order_create_order_table.sql
  V202606171100__billing_add_invoice_table.sql
```

Contoh struktur Liquibase:

```text
db/changelog/
  db.changelog-master.yaml
  customer/customer.changelog.yaml
  order/order.changelog.yaml
  billing/billing.changelog.yaml
```

Tetapi master changelog tetap menentukan ordering eksplisit.

---

## 4.3 Multi-Service, Database per Service

```text
Service A ---> DB A
Service B ---> DB B
Service C ---> DB C
```

Ini ideal microservice boundary.

Karakteristik:

- setiap service memiliki database sendiri,
- migration mengikuti service deployment,
- schema internal tidak boleh dibaca service lain,
- integrasi lewat API/event.

Kelebihan:

- ownership jelas,
- deployment lebih independen,
- migration risk terisolasi,
- schema bisa berevolusi tanpa koordinasi global yang berat.

Risiko:

- data duplication,
- eventual consistency,
- reporting lebih sulit,
- cross-service transaction harus dihindari,
- perlu eventing/API contract yang matang.

Strategi migration:

```text
service artifact owns its migrations
service pipeline validates and migrates its own DB
no cross-service table references
```

Rule keras:

> Service lain tidak boleh join langsung ke database service ini.

Kalau rule ini dilanggar, sebenarnya kamu tidak punya database-per-service secara arsitektural; kamu hanya punya banyak aplikasi yang berbagi integrasi database tersembunyi.

---

## 4.4 Multi-Service, Shared Database

```text
Service A ----\
Service B -----+---> Shared DB
Service C ----/
```

Ini sering terjadi pada:

- legacy modernization,
- strangler migration,
- enterprise suite,
- monolith yang dipecah sebagian,
- organisasi dengan satu central database,
- aplikasi pemerintah/regulatory yang punya banyak module lintas proses.

Ini bentuk paling berisiko.

Masalah utama:

1. ownership tidak jelas,
2. release cadence berbeda,
3. schema menjadi shared contract,
4. migration ordering lebih rumit,
5. rollback hampir selalu lintas aplikasi,
6. destructive change sulit,
7. data correction bisa berdampak ke banyak service,
8. audit lebih sulit.

Strategi realistis:

```text
Treat database as an explicit shared platform contract.
```

Artinya:

- ada schema ownership registry,
- ada migration review gate,
- ada compatibility rule,
- ada version matrix,
- ada release coordination,
- ada forbidden change list,
- ada deprecation process.

---

## 4.5 Shared Database with Separate Schemas

```text
Service A ---> DB cluster / schema_a
Service B ---> DB cluster / schema_b
Service C ---> DB cluster / schema_c
```

Ini lebih baik daripada semua service memakai schema yang sama, tetapi belum sekuat database-per-service.

Kelebihan:

- logical ownership lebih jelas,
- permission bisa dipisah per schema,
- migration history table bisa per schema,
- naming conflict lebih kecil.

Risiko:

- cross-schema join temptation,
- shared DB resource contention,
- backup/restore coupling,
- maintenance window coupling,
- DB engine upgrade coupling.

Rule sehat:

```text
Cross-schema read is an integration contract, not an implementation detail.
```

Kalau service A membaca schema B, harus diperlakukan seperti membaca API:

- documented,
- versioned,
- reviewed,
- monitored,
- compatibility-managed.

---

## 5. Ownership: The Most Important Design Decision

Migration chaos biasanya bukan karena Flyway atau Liquibase kurang kuat. Biasanya karena ownership tidak jelas.

Pertanyaan ownership:

1. Siapa pemilik table ini?
2. Siapa boleh mengubah column ini?
3. Siapa harus approve destructive change?
4. Siapa bertanggung jawab kalau seed permission salah?
5. Siapa menjalankan migration production?
6. Siapa memutuskan rollback vs roll-forward?
7. Siapa menjaga migration history?
8. Siapa menyelesaikan conflict antar branch?

Tanpa jawaban ini, tooling hanya mempercepat chaos.

---

## 6. Schema Ownership Models

### 6.1 Application-Owned Schema

```text
Application owns all tables in its schema.
```

Cocok untuk service kecil atau database-per-service.

Kelebihan:

- sederhana,
- cepat,
- ownership jelas,
- pipeline mudah.

Kekurangan:

- sulit jika database dipakai banyak aplikasi,
- bisa menimbulkan konflik jika schema sebenarnya shared.

---

### 6.2 Module-Owned Tables

```text
Customer module owns CUSTOMER_* tables.
Order module owns ORDER_* tables.
Billing module owns BILLING_* tables.
```

Cocok untuk modular monolith atau enterprise app besar.

Contoh registry:

| Object Pattern | Owner Module | Approver | Notes |
|---|---:|---:|---|
| `CUSTOMER_%` | Customer | Customer lead | transactional |
| `ORDER_%` | Order | Order lead | high volume |
| `BILLING_%` | Billing | Billing lead + Finance | audit-sensitive |
| `REF_%` | Platform/Data governance | shared approval | reference data |
| `SEC_%` | Security/Auth module | security lead | role/permission |

Rule:

> Migration yang menyentuh object module lain harus mendapat review dari owner module tersebut.

---

### 6.3 Domain-Owned Schema

```text
customer.customer
customer.customer_address
order.order_header
order.order_line
```

Cocok untuk DBMS yang mendukung schema namespace dengan baik, seperti PostgreSQL, SQL Server, Oracle user/schema model tertentu.

Kelebihan:

- namespace lebih jelas,
- permission bisa dipisahkan,
- migration history bisa dipisahkan,
- ownership terlihat di object path.

Kekurangan:

- cross-schema FK/join tetap bisa coupling,
- operational setup lebih kompleks,
- tooling perlu konfigurasi multi-schema.

---

### 6.4 Platform-Owned Shared Schema

```text
Platform/database team owns shared schema.
Application teams submit migration proposals.
```

Cocok untuk regulated enterprise, multi-team shared DB, atau highly controlled production.

Kelebihan:

- governance kuat,
- consistency tinggi,
- audit lebih rapi,
- production risk lebih terkendali.

Kekurangan:

- delivery bisa lambat,
- bottleneck pada DB/platform team,
- aplikasi kurang otonom,
- risiko “ticket queue architecture”.

Model sehat bukan platform team menulis semua migration, tetapi:

```text
application team proposes
owner team reviews
platform pipeline enforces
production process audits
```

---

## 7. Migration Repository Models

---

## 7.1 Migration Inside Application Repository

```text
service-a/
  src/main/java/...
  src/main/resources/db/migration/...
```

Kelebihan:

- code dan schema contract dekat,
- developer mudah menjalankan lokal,
- PR review natural,
- release artifact self-contained.

Kekurangan:

- sulit untuk shared DB lintas service,
- migration ordering antar service bisa konflik,
- global visibility lebih rendah.

Cocok untuk:

- database-per-service,
- single application,
- modular monolith.

Kurang cocok untuk:

- banyak aplikasi menulis schema yang sama.

---

## 7.2 Central Migration Repository

```text
database-migrations/
  customer/
  order/
  billing/
  security/
  reporting/
```

Kelebihan:

- global ordering jelas,
- review governance mudah,
- audit artifact terpusat,
- cocok untuk shared DB.

Kekurangan:

- code dan schema change terpisah,
- koordinasi PR lintas repo,
- developer workflow lebih berat,
- risiko mismatch app release dengan migration release.

Cocok untuk:

- shared database enterprise,
- regulated system,
- release train,
- platform-managed DB.

---

## 7.3 Hybrid Model

```text
application repo owns proposed migrations
central repo consumes approved migrations
pipeline promotes immutable migration bundle
```

Atau:

```text
module repo owns local migrations
release pipeline assembles global migration artifact
```

Kelebihan:

- developer masih dekat dengan change,
- production tetap terkontrol,
- review bisa dilakukan di dua level: module dan global.

Kekurangan:

- pipeline lebih kompleks,
- perlu tooling untuk assemble/order/validate,
- perlu convention yang ketat.

Cocok untuk enterprise yang ingin balance autonomy dan governance.

---

## 8. Flyway in Multi-Module Systems

Flyway secara natural memakai ordered versioned migration.

Tantangan multi-module:

- version collision,
- naming collision,
- module ordering,
- cross-module dependency,
- repeatable migration order,
- shared history table.

---

## 8.1 Single Global Flyway History

```text
flyway_schema_history
```

Semua migration masuk satu urutan global.

Contoh:

```text
V202606171000__customer_create_customer.sql
V202606171015__order_create_order.sql
V202606171030__billing_create_invoice.sql
V202606171045__customer_add_status.sql
```

Kelebihan:

- ordering jelas,
- audit sederhana,
- cocok untuk satu schema shared.

Kekurangan:

- version collision perlu dikontrol,
- module tidak bisa deploy schema secara independen,
- semua migration ada dalam satu stream.

Gunakan convention timestamp granular:

```text
VyyyyMMddHHmmss__module_action.sql
```

Contoh:

```text
V20260617103000__customer_add_kyc_status_column.sql
```

---

## 8.2 Multiple Flyway Locations, One History

```properties
flyway.locations=classpath:db/migration/customer,classpath:db/migration/order,classpath:db/migration/billing
```

Semua lokasi digabung dan diurutkan berdasarkan version.

Kelebihan:

- file bisa dipisah per module,
- history tetap global.

Risiko:

- developer bisa salah mengira module ordering independen,
- version tetap harus unik global,
- cross-module dependency harus eksplisit.

Struktur:

```text
src/main/resources/db/migration/
  customer/
    V20260617100000__customer_create_customer.sql
  order/
    V20260617100500__order_create_order.sql
  billing/
    V20260617101000__billing_create_invoice.sql
```

---

## 8.3 Separate Flyway History Per Schema

```text
customer.flyway_schema_history
order.flyway_schema_history
billing.flyway_schema_history
```

Cocok jika schema benar-benar dipisah.

Kelebihan:

- module lebih independen,
- migration stream lebih kecil,
- ownership lebih jelas.

Risiko:

- cross-schema dependency sulit,
- ordering antar schema tidak dijamin otomatis,
- deployment orchestration lebih kompleks.

Rule:

> Separate history only works if schema boundaries are real boundaries.

Kalau customer migration membutuhkan order table sudah ada, maka kamu tetap punya global dependency.

---

## 9. Liquibase in Multi-Module Systems

Liquibase lebih ekspresif untuk multi-module karena changelog bisa dipecah dengan `include` dan `includeAll`.

Namun ekspresif bukan berarti otomatis aman.

---

## 9.1 Master Changelog with Explicit Includes

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/customer/customer.changelog.yaml
  - include:
      file: db/changelog/order/order.changelog.yaml
  - include:
      file: db/changelog/billing/billing.changelog.yaml
```

Kelebihan:

- ordering jelas,
- reviewable,
- deterministic,
- mudah memahami dependency.

Kekurangan:

- master changelog perlu sering disentuh,
- conflict di master file mungkin terjadi.

Untuk production-grade system, explicit include biasanya lebih aman daripada includeAll.

---

## 9.2 Per-Release Master Changelog

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-06-17/customer.yaml
  - include:
      file: db/changelog/releases/2026-06-17/order.yaml
  - include:
      file: db/changelog/releases/2026-06-17/billing.yaml
```

Cocok untuk release train.

Kelebihan:

- release artifact jelas,
- approval per release mudah,
- rollback/tagging lebih manageable.

Kekurangan:

- kurang natural untuk continuous deployment,
- perlu release manager atau pipeline assembly.

---

## 9.3 Contexts and Labels for Module/Release Control

Contoh:

```yaml
- changeSet:
    id: 20260617-001
    author: customer-team
    labels: customer,release-2026-06-17
    context: prod
    changes:
      - addColumn:
          tableName: customer
          columns:
            - column:
                name: kyc_status
                type: varchar(30)
```

Fungsi:

- labels untuk memilih release/module,
- contexts untuk environment/runtime targeting.

Peringatan:

> Jangan menjadikan contexts/labels sebagai pengganti ownership dan ordering governance.

Contexts/labels membantu filtering. Mereka tidak menyelesaikan semantic dependency.

---

## 10. Cross-Service Database Dependencies

Dependency lintas service/module bisa muncul dalam beberapa bentuk.

---

## 10.1 Foreign Key Dependency

```text
order.customer_id -> customer.id
```

Jika `order` service dan `customer` service terpisah, FK lintas service adalah coupling kuat.

Dampaknya:

- service deployment coupling,
- data lifecycle coupling,
- delete/update coupling,
- migration ordering coupling,
- test fixture coupling.

Dalam database-per-service murni, FK lintas service tidak boleh ada karena database-nya berbeda.

Dalam modular monolith, FK antar module bisa diterima, tetapi harus direview sebagai domain dependency.

---

## 10.2 Shared Lookup Dependency

```text
application.status_code -> ref_status.code
case.priority_code -> ref_priority.code
```

Lookup/shared reference data sering dianggap aman, padahal bisa menjadi global coupling.

Pertanyaan penting:

- siapa pemilik `ref_status`?
- apakah status boleh dihapus?
- apakah label boleh berubah?
- apakah code stable?
- apakah semua module memakai semantic yang sama?
- apakah status baru breaking bagi old app?

Reference data shared harus punya compatibility rule.

Contoh rule:

```text
Never delete active reference code.
Never reuse retired code.
Only add new code as backward-compatible change.
Meaning of existing code must not change silently.
```

---

## 10.3 Reporting Dependency

Reporting sering membaca table internal langsung.

```sql
SELECT c.name, o.total_amount, p.payment_status
FROM customer c
JOIN order_header o ON o.customer_id = c.id
JOIN payment p ON p.order_id = o.id;
```

Jika table internal berubah, report rusak.

Strategi lebih sehat:

1. exposed reporting views,
2. data mart,
3. CDC/event pipeline,
4. versioned read model,
5. compatibility view.

Contoh:

```sql
CREATE OR REPLACE VIEW reporting.v_order_summary_v1 AS
SELECT ...;
```

Lalu migration internal tidak langsung memecahkan report selama view contract dipertahankan.

---

## 10.4 Batch Job Dependency

Batch job sering tersembunyi dari release flow.

Risiko:

- app online berhasil,
- migration berhasil,
- batch malam gagal,
- data partial,
- incident baru terlihat esok hari.

Checklist sebelum schema change:

```text
[ ] Online services checked
[ ] Batch jobs checked
[ ] Reports checked
[ ] ETL checked
[ ] Data correction scripts checked
[ ] External integration checked
[ ] Manual operational query checked
```

---

## 11. Compatibility Rules for Shared Database

Untuk shared database, prinsip utama:

> A database migration must be compatible with all currently running and rollback-target application versions.

Bukan hanya compatible dengan app baru.

---

## 11.1 Compatibility Matrix

Contoh:

| App Version | Schema Old | Schema Expanded | Schema Contracted |
|---|---:|---:|---:|
| Old App | works | must work | may break |
| New App | may not work | works | works |
| Rollback App | works | must work | may break |

Kesimpulan:

- expand phase harus old-app compatible,
- contract phase hanya boleh setelah old app tidak mungkin kembali,
- destructive change harus ditunda.

---

## 11.2 Forbidden Immediate Changes

Dalam shared database, perubahan berikut biasanya tidak boleh dilakukan langsung:

- drop column yang masih mungkin dibaca,
- rename column langsung,
- change column type incompatible,
- add NOT NULL tanpa default/backfill strategy,
- delete reference data code,
- change semantic existing status,
- drop index yang masih dibutuhkan query service lain,
- change primary key tanpa transition,
- move table tanpa compatibility view,
- change stored procedure signature tanpa versioning.

Pattern aman biasanya expand/contract.

---

## 11.3 Additive Changes Are Usually Safer

Contoh additive:

```sql
ALTER TABLE customer ADD kyc_status VARCHAR(30);
```

Biasanya aman untuk old app karena old app mengabaikan column baru.

Tetapi tetap perlu cek:

- trigger lama,
- insert statement eksplisit tanpa column list,
- ORM mapping strict,
- replication/ETL,
- audit trigger,
- view `SELECT *`,
- CSV export fixed-position.

Additive tidak selalu otomatis aman, tetapi jauh lebih aman daripada destructive.

---

## 12. Migration Ordering in Multi-Service Systems

Ada tiga jenis ordering:

1. file ordering,
2. deployment ordering,
3. semantic ordering.

---

## 12.1 File Ordering

Flyway:

```text
V20260617100000__add_customer_column.sql
V20260617101000__backfill_customer_column.sql
V20260617102000__add_customer_constraint.sql
```

Liquibase:

```yaml
- include: add-customer-column.yaml
- include: backfill-customer-column.yaml
- include: add-customer-constraint.yaml
```

File ordering menjawab: migration mana dijalankan dulu.

---

## 12.2 Deployment Ordering

```text
1. deploy database expand migration
2. deploy producer service dual-write
3. run backfill
4. deploy consumer service read-new
5. disable old path
6. contract schema
```

Deployment ordering menjawab: runtime mana berubah dulu.

---

## 12.3 Semantic Ordering

Contoh:

```text
Role seed must exist before permission assignment.
Permission must exist before UI menu is enabled.
Menu must exist before user role mapping is migrated.
```

Semantic ordering tidak selalu terlihat dari SQL dependency.

Itu perlu didokumentasikan dalam migration description, release note, dan review checklist.

---

## 13. Release Train vs Independent Deployment

---

## 13.1 Release Train

```text
All services release together every 2 weeks.
```

Kelebihan:

- coordination lebih mudah,
- shared DB change lebih terkendali,
- approval lebih jelas.

Kekurangan:

- delivery lebih lambat,
- coupling organisasi meningkat,
- satu service bisa menahan release semua.

Cocok untuk:

- regulated enterprise,
- shared database besar,
- low deployment frequency,
- strong UAT/release governance.

---

## 13.2 Independent Deployment

```text
Each service deploys independently.
```

Kelebihan:

- autonomy tinggi,
- faster delivery,
- blast radius bisa kecil jika boundary benar.

Kekurangan:

- shared DB sangat berbahaya,
- perlu compatibility discipline tinggi,
- observability dan contract testing harus matang.

Cocok jika:

- database-per-service,
- API/event contract jelas,
- shared DB avoided atau read-only dengan contract view.

---

## 13.3 Hybrid Release

```text
Normal app changes deploy independently.
Shared database breaking/contracting changes follow release train.
```

Ini sering paling realistis.

Rule contoh:

```text
Additive migration: independent with review.
Backfill: scheduled with ops awareness.
Contract/destructive migration: release train only.
Shared reference data semantic change: governance approval.
```

---

## 14. Migration Ownership Patterns

---

## 14.1 Service-Owned Migration

Service owns its schema.

```text
service-a owns db_a migrations
```

Use when:

- database-per-service,
- no direct external reads,
- service team owns production support.

Do not use when:

- table is shared,
- other services directly depend on schema,
- database operations centralized.

---

## 14.2 Shared Migration Board

A group reviews shared DB changes.

Members:

- app/module owner,
- DBA/platform,
- QA/release,
- security/compliance if needed,
- reporting/data owner if impacted.

Good board behavior:

- reviews high-risk changes,
- enforces standards,
- approves ownership exceptions,
- keeps release moving.

Bad board behavior:

- reviews every tiny change manually,
- becomes bottleneck,
- replaces automated checks with meetings,
- makes no clear decision.

---

## 14.3 Database Contract Owner

For shared objects, assign a contract owner.

Example:

```text
reporting.v_case_summary_v1 -> Reporting Platform team
sec_permission -> Security module team
ref_country -> Data Governance team
case_table -> Case Management team
```

Contract owner decides:

- allowed changes,
- deprecation period,
- compatibility views,
- semantic meaning,
- communication to consumers.

---

## 15. Shared Table Change Workflow

Saat satu table dipakai banyak module/service, gunakan workflow eksplisit.

### Step 1: Identify object owner

```text
Object: CASE_MAIN
Owner: Case Management module
Consumers: Case service, Compliance service, Reporting, Batch closure job
```

### Step 2: Classify change

```text
Change: rename CASE_STATUS to STATUS_CODE
Type: destructive/contract change
Risk: high
```

### Step 3: Define compatibility strategy

```text
Phase 1: add STATUS_CODE
Phase 2: dual-write CASE_STATUS and STATUS_CODE
Phase 3: backfill STATUS_CODE
Phase 4: switch readers
Phase 5: deprecate CASE_STATUS
Phase 6: drop CASE_STATUS after confirmed no consumers
```

### Step 4: Define affected releases

```text
Release A: expand
Release B: read switch
Release C: contract
```

### Step 5: Add verification

```sql
SELECT COUNT(*)
FROM case_main
WHERE status_code IS NULL
  AND case_status IS NOT NULL;
```

### Step 6: Approve and execute

Approval should include:

- owner approval,
- consumer approval,
- DBA/platform review for risk,
- rollback/roll-forward plan,
- production timing.

---

## 16. Cross-Module Foreign Keys

Foreign keys are not merely integrity constraints. They encode ownership dependency.

### 16.1 Healthy FK inside same aggregate/module

```text
order_header -> order_line
```

Usually good.

### 16.2 Risky FK across modules

```text
case_main.assigned_user_id -> user_account.id
application.case_id -> case_main.id
```

Can be okay in modular monolith, but must be intentional.

Question:

- does lifecycle align?
- who owns delete behavior?
- can one module migrate independently?
- does FK create deployment ordering?
- does FK block archival/data retention?

### 16.3 Dangerous FK across microservices

```text
service_a_db.table_x -> service_b_db.table_y
```

Usually impossible if DB separated. If same DB, it means services are not truly independent.

---

## 17. Contract Views as Compatibility Layer

When consumers read internal tables, introduce views as stable contracts.

```sql
CREATE OR REPLACE VIEW reporting.v_customer_v1 AS
SELECT
  id,
  customer_no,
  display_name,
  status_code
FROM customer;
```

If internal table changes:

```sql
CREATE OR REPLACE VIEW reporting.v_customer_v1 AS
SELECT
  c.id,
  c.customer_no,
  p.full_name AS display_name,
  c.status_code
FROM customer c
JOIN person_profile p ON p.customer_id = c.id;
```

Consumers of `v_customer_v1` stay stable.

Versioned view pattern:

```text
reporting.v_customer_v1
reporting.v_customer_v2
```

Deprecation flow:

```text
create v2 -> migrate consumers -> monitor v1 usage -> retire v1
```

Caveat:

- views can hide performance issues,
- views need ownership,
- views need versioning,
- `SELECT *` in views is dangerous,
- permission grants must be managed.

---

## 18. Shared Reference Data Governance

Reference data often crosses modules.

Example:

```text
ref_status
ref_country
ref_currency
ref_document_type
ref_permission
ref_case_outcome
```

Governance rules:

1. Code is stable.
2. Meaning is stable.
3. Display label may be localized or versioned.
4. Retired values are not deleted immediately.
5. New values must be backward-compatible.
6. Existing values must not be reused.
7. Seeds must be idempotent.
8. Ownership must be explicit.

Bad seed:

```sql
DELETE FROM ref_status;
INSERT INTO ref_status VALUES ('A', 'Active');
INSERT INTO ref_status VALUES ('I', 'Inactive');
```

Production-safe approach:

```sql
MERGE INTO ref_status t
USING (
  SELECT 'ACTIVE' code, 'Active' label FROM dual
) s
ON (t.code = s.code)
WHEN MATCHED THEN UPDATE SET t.label = s.label
WHEN NOT MATCHED THEN INSERT (code, label) VALUES (s.code, s.label);
```

But even update must be reviewed if label has business/legal meaning.

---

## 19. Shared Permission and Role Migrations

Permission seed changes are database migrations with security impact.

Example:

```text
PERM_CASE_APPROVE
PERM_CASE_ESCALATE
PERM_REPORT_EXPORT
ROLE_CASE_MANAGER
ROLE_COMPLIANCE_OFFICER
```

Risks:

- giving too much access,
- removing needed access,
- changing role behavior unexpectedly,
- creating orphan menu items,
- enabling UI without backend permission,
- backend permission without UI visibility,
- old app not understanding new permission.

Safe workflow:

```text
1. add new permission inactive or unused
2. deploy backend authorization check
3. deploy UI/menu visibility
4. map permission to intended role
5. audit effective access
6. remove old permission only after usage confirms safe
```

Do not treat permission seed as harmless lookup data.

---

## 20. Shared Migration Artifact

In complex systems, migration should be treated as release artifact.

Artifact includes:

```text
- migration scripts/changelogs
- generated SQL preview
- checksum manifest
- target database engine/version
- execution order
- owner metadata
- review approvals
- rollback/roll-forward note
- verification queries
- known risks
```

Example manifest:

```yaml
release: 2026.06.17
schema: aceas_core
migrations:
  - id: V20260617100000__case_add_escalation_status.sql
    owner: case-module
    risk: medium
    type: additive
    compatibleWithOldApp: true
  - id: V20260617103000__case_backfill_escalation_status.sql
    owner: case-module
    risk: high
    type: backfill
    verification: verify_case_escalation_status.sql
```

This is especially useful in regulated environments.

---

## 21. Dependency Graph Thinking

In multi-module migration, think in graph, not list.

Example:

```text
A: create ref_status
B: add case.status_code referencing ref_status
C: seed case statuses
D: backfill case.status_code
E: add NOT NULL constraint
F: deploy app reading status_code
G: drop old status column
```

Dependencies:

```text
A -> C
A -> B
B -> D
C -> D
D -> E
E -> F? not always
F -> G
```

A linear migration file order is only a projection of the dependency graph.

Top-tier migration design asks:

- what must exist before this runs?
- what data assumption must hold?
- what app version must be deployed?
- what can run independently?
- what can be retried?
- what must not run yet?

---

## 22. Detecting Impacted Consumers

Before changing shared schema, identify consumers.

Sources:

- code search,
- SQL repository,
- report definitions,
- ETL jobs,
- batch jobs,
- database audit logs,
- query monitoring,
- view/procedure dependencies,
- grants,
- application config,
- documentation,
- DBA knowledge,
- production query history.

SQL object dependency examples differ per DBMS, but conceptually:

```text
Find views/procedures/triggers depending on table/column.
Find users/roles granted access to object.
Find scheduled jobs touching object.
Find application queries containing object name.
```

Do not rely only on static code search. Some consumers are external.

---

## 23. Migration Review Checklist for Shared DB

Use this checklist for PR/release review.

```text
Ownership
[ ] Object owner identified
[ ] Impacted modules/services listed
[ ] Required approvals obtained

Compatibility
[ ] Old app compatibility checked
[ ] New app compatibility checked
[ ] Rollback app compatibility checked
[ ] Batch/report/ETL compatibility checked

Change Type
[ ] Additive/destructive/backfill/seed classified
[ ] Expand/contract needed?
[ ] Contract phase separated?

Ordering
[ ] Migration order explicit
[ ] App deployment order explicit
[ ] Semantic dependency explicit

Safety
[ ] Locking impact assessed
[ ] Runtime estimate known
[ ] Backfill chunking strategy exists if needed
[ ] Verification query exists
[ ] Roll-forward plan exists
[ ] Rollback limitation documented

Governance
[ ] Migration name follows convention
[ ] Owner metadata included
[ ] Production execution window decided
[ ] Audit evidence retained
```

---

## 24. Common Anti-Patterns

### 24.1 Every service ships its own migration to same schema

```text
service-a/db/migration -> shared_db
service-b/db/migration -> shared_db
service-c/db/migration -> shared_db
```

Problem:

- ordering conflict,
- history conflict,
- concurrent migration risk,
- unclear ownership,
- hard rollback.

Better:

```text
shared migration pipeline for shared schema
or real database-per-service
```

---

### 24.2 Editing old migration after it reached shared environment

Bad:

```text
V12__create_case_table.sql edited after UAT/prod
```

Effect:

- checksum mismatch,
- environment drift,
- audit confusion,
- hard recovery.

Better:

```text
create V13__alter_case_table.sql
```

Only repair checksum if there is a controlled, audited reason.

---

### 24.3 Shared lookup delete

Bad:

```sql
DELETE FROM ref_case_status WHERE code = 'PENDING_REVIEW';
```

Could break:

- existing rows,
- old app enum mapping,
- reports,
- audit history,
- dropdown assumptions.

Better:

```sql
UPDATE ref_case_status
SET active = 0,
    retired_at = CURRENT_TIMESTAMP
WHERE code = 'PENDING_REVIEW';
```

But even this needs consumer review.

---

### 24.4 Direct rename in shared schema

Bad:

```sql
ALTER TABLE customer RENAME COLUMN name TO full_name;
```

Better:

```text
1. add full_name
2. dual-write/sync
3. migrate readers
4. deprecate name
5. drop name later
```

---

### 24.5 Assuming service boundary while sharing tables

Claim:

```text
Customer service and Order service are independent microservices.
```

Reality:

```text
Both read/write CUSTOMER and ORDER tables directly.
```

This is distributed monolith at database layer.

Migration discipline must match reality, not architecture diagram.

---

### 24.6 Reporting reads transactional tables directly

This creates invisible contract.

Better:

- reporting views,
- replicated read model,
- event-driven data mart,
- documented query contract.

---

## 25. Practical Patterns

---

## 25.1 Global Version Namespace

Use timestamp versioning to avoid collision.

```text
V20260617143000__case_add_appeal_due_date.sql
V20260617143500__appeal_seed_outcome_codes.sql
```

Guidelines:

- include module prefix,
- include intent,
- avoid generic names,
- use UTC or agreed timezone,
- do not reuse versions.

---

## 25.2 Module Prefix Naming

```text
V20260617100000__case_add_status_reason.sql
V20260617101000__compliance_add_inspection_score.sql
V20260617102000__security_seed_case_approve_permission.sql
```

Benefits:

- ownership visible,
- review routing easier,
- audit easier,
- search easier.

---

## 25.3 Contract Phase Marker

For destructive changes, make it obvious.

```text
V20260617100000__case_expand_add_new_status_column.sql
V20260624100000__case_backfill_new_status_column.sql
V20260701100000__case_contract_drop_old_status_column.sql
```

This prevents accidental immediate destructive migration.

---

## 25.4 Deprecation Registry

Track old columns/views/tables pending removal.

Example:

| Object | Replacement | Deprecated Since | Earliest Drop | Consumers Remaining |
|---|---|---:|---:|---|
| `case_main.case_status` | `case_main.status_code` | 2026-06-17 | 2026-07-17 | reporting v1 |
| `v_customer_v1` | `v_customer_v2` | 2026-06-01 | 2026-09-01 | legacy report |

This is simple but powerful.

---

## 25.5 Consumer Contract Tests

If Service B depends on DB contract from Service A, test it.

Example:

```text
Given schema migration applied
When reporting query runs
Then expected columns and semantics still hold
```

This can be implemented as:

- SQL smoke tests,
- Testcontainers integration tests,
- view contract tests,
- generated schema diff checks,
- stored procedure signature checks.

---

## 26. Example: Shared Status Column Migration

Scenario:

```text
Old:
case_main.status VARCHAR(20)

New:
case_main.status_code VARCHAR(30) references ref_case_status(code)
```

Consumers:

- Case service writes status,
- Compliance service reads status,
- Reporting view exposes status,
- Batch job closes expired cases.

Unsafe migration:

```sql
ALTER TABLE case_main RENAME COLUMN status TO status_code;
ALTER TABLE case_main ADD CONSTRAINT fk_case_status FOREIGN KEY (status_code) REFERENCES ref_case_status(code);
```

Why unsafe:

- old app breaks,
- reporting query breaks,
- batch query breaks,
- existing values may not match ref table,
- FK may fail,
- rollback hard.

Safe multi-release plan:

### Release 1: Expand

```sql
ALTER TABLE case_main ADD status_code VARCHAR(30);
```

Seed reference:

```sql
MERGE INTO ref_case_status t
USING (
  SELECT 'OPEN' code, 'Open' label FROM dual UNION ALL
  SELECT 'CLOSED' code, 'Closed' label FROM dual UNION ALL
  SELECT 'ESCALATED' code, 'Escalated' label FROM dual
) s
ON (t.code = s.code)
WHEN NOT MATCHED THEN INSERT (code, label) VALUES (s.code, s.label)
WHEN MATCHED THEN UPDATE SET t.label = s.label;
```

### Release 2: App dual-write

```text
When status changes:
write old status
write new status_code
```

### Release 3: Backfill

```sql
UPDATE case_main
SET status_code = CASE status
  WHEN 'Open' THEN 'OPEN'
  WHEN 'Closed' THEN 'CLOSED'
  WHEN 'Escalated' THEN 'ESCALATED'
END
WHERE status_code IS NULL;
```

For large table, do chunked backfill instead of one giant update.

### Release 4: Validate and constrain

```sql
SELECT COUNT(*)
FROM case_main
WHERE status_code IS NULL;
```

Then:

```sql
ALTER TABLE case_main ADD CONSTRAINT fk_case_status
FOREIGN KEY (status_code) REFERENCES ref_case_status(code);
```

Add NOT NULL only after all rows valid and application always writes it.

### Release 5: Switch readers

```text
Compliance service reads status_code.
Reporting v2 exposes status_code.
Batch job uses status_code.
```

### Release 6: Contract

```sql
ALTER TABLE case_main DROP COLUMN status;
```

Only after confirmed no consumers remain.

---

## 27. Example: Multi-Module Flyway Structure

```text
src/main/resources/db/migration/
  V20260617090000__security_create_permission_tables.sql
  V20260617091000__case_create_case_tables.sql
  V20260617092000__case_seed_case_statuses.sql
  V20260617093000__appeal_create_appeal_tables.sql
  V20260617094000__appeal_seed_appeal_outcomes.sql
  V20260617095000__reporting_create_case_summary_view.sql
```

Convention:

```text
V<timestamp>__<module>_<verb>_<object>_<intent>.sql
```

Examples:

```text
V20260617110000__case_expand_add_status_code.sql
V20260617120000__case_backfill_status_code.sql
V20260618100000__reporting_update_case_summary_v2.sql
V20260701100000__case_contract_drop_status.sql
```

---

## 28. Example: Multi-Module Liquibase Structure

```text
db/changelog/
  db.changelog-master.yaml
  modules/
    security/security.changelog.yaml
    case/case.changelog.yaml
    appeal/appeal.changelog.yaml
    reporting/reporting.changelog.yaml
  releases/
    2026-06-17.yaml
```

Master:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/releases/2026-06-17.yaml
```

Release changelog:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/modules/security/20260617-security-permissions.yaml
  - include:
      file: db/changelog/modules/case/20260617-case-status-expand.yaml
  - include:
      file: db/changelog/modules/reporting/20260617-reporting-case-summary-v2.yaml
```

Changeset:

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260617-case-001
      author: case-team
      labels: case,release-2026-06-17,expand
      changes:
        - addColumn:
            tableName: case_main
            columns:
              - column:
                  name: status_code
                  type: varchar(30)
```

---

## 29. Operational Strategy for Shared DB Migration

### 29.1 Pre-deployment

```text
[ ] Freeze migration bundle
[ ] Validate on restored production-like DB
[ ] Run dry-run SQL if Liquibase
[ ] Run Flyway validate
[ ] Check lock risk
[ ] Check object dependencies
[ ] Notify impacted service owners
[ ] Confirm backup/restore point
[ ] Confirm roll-forward plan
```

### 29.2 Deployment

```text
[ ] Run migration through single controlled runner
[ ] Prevent concurrent migration runners
[ ] Capture logs/checksums
[ ] Monitor lock waits
[ ] Monitor DB CPU/IO
[ ] Execute verification queries
[ ] Deploy dependent applications in planned order
```

### 29.3 Post-deployment

```text
[ ] Verify app health
[ ] Verify batch/report health
[ ] Verify migration history
[ ] Verify seed data
[ ] Capture incident notes if any
[ ] Update deprecation registry
[ ] Communicate completion
```

---

## 30. Concurrency Control: One Runner Rule

In shared DB, do not let every pod/service run migrations independently.

Bad Kubernetes pattern:

```text
10 pods start
10 pods try Flyway migrate
shared DB lock contention
startup storm
unclear failure
```

Better:

```text
Kubernetes Job runs migration once
app deployment waits/depends on migration success
pods start after migration
```

Or:

```text
Only one designated migration service runs migration
all others disable migration at startup
```

For Spring Boot shared DB:

```properties
spring.flyway.enabled=false
```

on non-owner services.

Migration owner pipeline runs Flyway/Liquibase externally.

---

## 31. Handling Branch Conflicts

### 31.1 Flyway Version Collision

Two branches create:

```text
V20260617100000__case_add_column.sql
V20260617100000__appeal_add_column.sql
```

Resolution:

- one must be renamed before merge,
- never edit already-applied migration in shared environment,
- run validate after merge.

Use timestamp with seconds or milliseconds to reduce collision.

---

### 31.2 Liquibase Changeset Identity Collision

Liquibase identity is roughly:

```text
id + author + file path
```

Collision can occur if teams reuse generic ids:

```yaml
id: 001
author: dev
```

Better:

```yaml
id: 20260617-case-001
author: case-team
```

Avoid generic author like `admin`, `developer`, `system`.

---

## 32. Governance Without Killing Delivery

Too little governance:

```text
everyone changes DB freely -> production drift and incidents
```

Too much governance:

```text
every column needs committee -> delivery paralysis
```

Balanced model:

| Change Type | Approval Needed | Automation |
|---|---|---|
| Add nullable column in owned table | owner team | lint + test |
| Add index | owner + DBA if large table | performance check |
| Add shared reference code | owner + data governance | seed validation |
| Backfill large table | owner + DBA + ops | dry-run + runtime estimate |
| Drop/rename column | owner + consumers + release manager | deprecation registry |
| Permission/role seed | security owner | access diff check |
| Cross-module FK | both module owners | dependency review |

Governance should be risk-based.

---

## 33. How This Applies to Java Systems

In Java systems, migration ownership often maps to module/runtime boundaries.

### Spring Boot microservice

```text
service owns Flyway/Liquibase migrations only for its DB
```

### Spring Boot modular monolith

```text
one global migration stream
module prefix naming
owner review per module
```

### Jakarta EE enterprise app

```text
external migration job before app deployment
JNDI datasource not always ideal for migration runner
central pipeline often safer
```

### Batch-heavy Java system

```text
migration plan must include batch job compatibility
not only online application startup
```

### Hibernate/JPA project

```text
Hibernate ddl-auto disabled for managed environments
Flyway/Liquibase owns schema change
JPA entity changes reviewed against migration compatibility
```

### MyBatis project

```text
Mapper SQL must be included in impact analysis
column rename/drop can break mapper XML or annotation SQL immediately
```

---

## 34. Decision Framework

Use these questions.

### 34.1 Is the database truly owned by one service?

If yes:

```text
migration can live with service
```

If no:

```text
shared migration governance required
```

---

### 34.2 Can all consumers deploy together?

If yes:

```text
release train possible
```

If no:

```text
backward-compatible migration mandatory
```

---

### 34.3 Is the change destructive?

If yes:

```text
expand/contract required
```

---

### 34.4 Is the data shared reference/config/security data?

If yes:

```text
seed governance and audit required
```

---

### 34.5 Is this migration safe to run from every app instance?

Usually no for shared DB.

Use one controlled runner.

---

## 35. Practical Standard Template

Use this for shared DB migration proposals.

```markdown
# Migration Proposal

## Summary

## Owner

## Affected Objects

## Affected Consumers

## Change Type
- [ ] Additive
- [ ] Destructive
- [ ] Backfill
- [ ] Seed
- [ ] Constraint
- [ ] Index
- [ ] View/procedure

## Compatibility
- Old app:
- New app:
- Rollback app:
- Batch/report/ETL:

## Execution Plan
1.
2.
3.

## Verification Queries

## Rollback / Roll-forward Plan

## Locking / Performance Risk

## Approvals
```

This simple document prevents many incidents.

---

## 36. Key Takeaways

1. Multi-service migration is primarily an ownership and compatibility problem, not a tooling problem.
2. Shared database is a shared contract; treat it like an API.
3. Database-per-service makes migration easier only if direct database sharing is actually forbidden.
4. Modular monolith can be healthy if module ownership and global ordering are explicit.
5. Flyway works well with a global ordered stream; use naming convention to encode module ownership.
6. Liquibase works well with changelog hierarchy; use explicit includes for deterministic ordering.
7. Destructive changes in shared DB require expand/contract and deprecation tracking.
8. Shared reference data and permission seeds need governance because they change application behavior.
9. Use one migration runner for shared DB, not every service/pod.
10. Review database migrations using risk classification: additive, destructive, backfill, seed, constraint, index, shared object.

---

## 37. Practice Questions

1. Apa bedanya database-per-service secara diagram dan database-per-service secara nyata?
2. Kenapa shared database harus diperlakukan seperti API contract?
3. Kapan migration boleh disimpan di service repository?
4. Kapan migration sebaiknya dikelola di central migration repository?
5. Apa risiko jika setiap service menjalankan Flyway sendiri ke shared schema?
6. Bagaimana cara aman rename column yang dipakai banyak service?
7. Mengapa shared lookup data tidak boleh sembarangan dihapus?
8. Apa bedanya file ordering, deployment ordering, dan semantic ordering?
9. Bagaimana contract view membantu reporting dependency?
10. Apa isi minimal migration proposal untuk shared DB?

---

## 38. Production Readiness Checklist

```text
[ ] Database ownership model documented
[ ] Table/object owner registry exists
[ ] Migration naming convention includes module/owner
[ ] Shared DB migrations run through single controlled runner
[ ] App startup migrations disabled for non-owner services
[ ] Destructive changes use expand/contract
[ ] Shared reference data has seed policy
[ ] Permission/role changes reviewed as security changes
[ ] Reporting/batch/ETL consumers included in impact analysis
[ ] Migration history is audited
[ ] Drift detection exists
[ ] Deprecation registry exists for old columns/views/tables
[ ] CI validates migration order and conflicts
[ ] Production runbook exists
```

---

## 39. Closing Mental Model

Untuk sistem kecil, migration bisa terasa seperti file SQL berurutan.

Untuk sistem besar, migration adalah bentuk **distributed contract management**.

Database tidak hanya menyimpan data. Ia menyimpan asumsi:

- asumsi kode aplikasi,
- asumsi batch job,
- asumsi report,
- asumsi permission,
- asumsi audit,
- asumsi integrasi,
- asumsi operasi production.

Top-tier engineer tidak hanya bertanya:

```text
Can this SQL run?
```

Tetapi bertanya:

```text
Who depends on this contract?
What versions must remain compatible?
What is the safe transition path?
Who owns the risk?
How do we verify it in production?
```

Itulah perbedaan antara migration sebagai script dan migration sebagai engineering discipline.

---

# End of Part 27

Part berikutnya: `28-multitenant-database-migration.md`

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: CI/CD Pipeline for Database Migration](./26-cicd-pipeline-database-migration.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 28 — Multi-Tenant Database Migration](./28-multitenant-database-migration.md)

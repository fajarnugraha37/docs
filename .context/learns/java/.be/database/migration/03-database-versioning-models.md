# Part 3 — Database Versioning Models

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `03-database-versioning-models.md`  
**Scope:** Java 8–25, database migration engineering, Flyway, Liquibase, CI/CD, production release discipline

---

## 1. Tujuan Part Ini

Di Part 0 kita membangun orientasi bahwa database migration adalah disiplin engineering, bukan sekadar file SQL.  
Di Part 1 kita mengklasifikasikan jenis perubahan database.  
Di Part 2 kita membahas invariants dan failure model.

Part ini menjawab pertanyaan berikut:

> Kalau database berubah dari waktu ke waktu, bagaimana kita memberi versi pada perubahan itu sehingga sistem tetap bisa dipahami, direview, dideploy, dan dipulihkan?

Database versioning adalah fondasi sebelum masuk ke Flyway dan Liquibase secara teknis.

Tanpa versioning model yang jelas, migration akan berubah menjadi kumpulan file acak:

```text
init.sql
update.sql
fix.sql
fix2.sql
new_column.sql
prod_hotfix.sql
final_fix.sql
really_final_fix.sql
```

File seperti itu mungkin berjalan di laptop developer, tetapi tidak cukup untuk production system.

Database versioning yang baik harus menjawab:

1. Perubahan database mana yang sudah diterapkan?
2. Urutannya apa?
3. Perubahan mana yang belum diterapkan?
4. Apakah file migration berubah setelah pernah dijalankan?
5. Apakah environment DEV, SIT, UAT, staging, dan PROD berada pada versi schema yang konsisten?
6. Apakah aplikasi versi tertentu kompatibel dengan database versi tertentu?
7. Bagaimana menangani branch paralel yang membuat migration berbeda?
8. Bagaimana menangani hotfix production?
9. Bagaimana melakukan audit jika regulator atau production reviewer bertanya “kapan perubahan ini masuk?”

Tujuan utama Part ini adalah membangun mental model agar kita tidak hanya tahu format `V1__init.sql`, tetapi paham konsekuensi arsitektural dari pilihan versioning.

---

## 2. Core Mental Model: Database Version Is Not Just a Number

Banyak engineer berpikir database version adalah angka:

```text
v1
v2
v3
```

Itu terlalu dangkal.

Dalam sistem production, database version lebih tepat dipahami sebagai:

> State historis yang terbentuk dari urutan perubahan yang telah diterapkan ke database.

Artinya, database version bukan hanya label. Database version adalah **hasil akumulasi ordered changes**.

Contoh:

```text
V1  create users table
V2  create roles table
V3  add users.email
V4  add unique index on users.email
V5  seed default roles
```

Database pada version `V5` berarti database telah melewati urutan perubahan tersebut.

Tetapi perhatikan: version `V5` bukan hanya angka 5. Version itu menyiratkan banyak hal:

- table `users` ada,
- table `roles` ada,
- column `users.email` ada,
- unique index pada `users.email` ada,
- default roles sudah diseed,
- semua migration sebelum `V5` telah berhasil,
- checksum file yang pernah dijalankan masih sesuai,
- aplikasi yang butuh email unique constraint bisa mengasumsikan constraint tersebut tersedia.

Jadi database version adalah **contractual state**.

---

## 3. Database Version vs Application Version vs API Version

Sebelum masuk ke model numbering, kita harus membedakan tiga jenis versi yang sering tercampur.

### 3.1 Application Version

Application version adalah versi artifact aplikasi.

Contoh:

```text
aceas-case-service:1.42.0
billing-service:2026.06.17.3
user-service:release-2026-Q2
```

Version ini menjawab:

> Code apa yang sedang berjalan?

Application version biasanya ada di:

- JAR/WAR artifact,
- container image tag,
- deployment manifest,
- Git commit,
- release note,
- CI/CD build number.

### 3.2 API Version

API version adalah contract external/internal yang dikonsumsi client.

Contoh:

```text
/api/v1/applications
/api/v2/applications
application.created.v3
```

Version ini menjawab:

> Contract komunikasi apa yang disediakan ke consumer?

API version belum tentu berubah saat database berubah.

Contoh:

- Menambahkan index tidak mengubah API.
- Menambahkan nullable column internal tidak mengubah API.
- Mengubah enum status internal mungkin mengubah API jika status itu terekspos ke client.

### 3.3 Database Version

Database version adalah state schema/data setelah migration diterapkan.

Contoh:

```text
V202606170930__add_application_risk_score.sql
V202606171000__seed_default_case_priorities.sql
```

Version ini menjawab:

> Struktur dan data pendukung apa yang sudah tersedia di database?

### 3.4 Hubungan Ketiganya

Ketiganya berhubungan, tetapi tidak sama.

```text
Application Version
        |
        | expects
        v
Database Version
        |
        | supports
        v
API Behavior
```

Contoh:

```text
Application 2.8.0 expects database >= V202606170930
Database V202606170930 provides column application.risk_score
API /applications now includes computed riskScore
```

Tetapi bisa juga:

```text
Application 2.8.1 expects same database as 2.8.0
```

Atau:

```text
Database migration adds index only
Application version unchanged or patch-only
API unchanged
```

Top engineer tidak menyamakan semua version ini. Ia membuat mapping yang eksplisit.

---

## 4. Why Database Versioning Is Harder Than Code Versioning

Code artifact bisa diganti.

Jika deployment gagal, kita bisa rollback container image:

```text
app:1.42.0 -> app:1.41.0
```

Database tidak sesederhana itu.

Jika migration sudah menjalankan:

```sql
ALTER TABLE customer DROP COLUMN legacy_id;
```

Lalu kita rollback aplikasi ke versi lama yang masih membaca `legacy_id`, aplikasi lama bisa rusak.

Problem utama database versioning:

1. Database adalah mutable state.
2. Database sering shared oleh banyak service/module.
3. Data production tidak bisa diganti seperti artifact.
4. Migration bisa irreversible.
5. DDL bisa auto-commit di beberapa database.
6. Migration bisa partial.
7. Environment bisa drift.
8. Hotfix production bisa mendahului release normal.
9. Branch development paralel bisa menghasilkan konflik version.
10. Aplikasi lama dan baru bisa berjalan bersamaan saat rolling deployment.

Karena itu, database versioning harus dipikirkan bersama deployment choreography.

---

## 5. Fundamental Requirement of a Database Versioning Model

Sebuah database versioning model yang sehat harus memenuhi beberapa requirement.

### 5.1 Ordered

Migration harus punya urutan deterministik.

Buruk:

```text
add_email.sql
create_user.sql
seed_roles.sql
```

Tidak jelas mana duluan.

Baik:

```text
V001__create_user.sql
V002__add_email_to_user.sql
V003__seed_roles.sql
```

Atau:

```text
V202606170900__create_user.sql
V202606170930__add_email_to_user.sql
V202606171000__seed_roles.sql
```

### 5.2 Unique

Setiap migration harus punya identity unik.

Jika dua developer membuat:

```text
V17__add_status.sql
```

maka akan terjadi konflik.

### 5.3 Immutable

Migration yang sudah pernah diterapkan ke shared environment tidak boleh diedit sembarangan.

Buruk:

```text
V12__add_customer_email.sql
```

Awalnya:

```sql
ALTER TABLE customer ADD email VARCHAR(255);
```

Lalu setelah sudah masuk UAT, diedit menjadi:

```sql
ALTER TABLE customer ADD email VARCHAR(320);
```

Environment yang sudah menjalankan versi lama dan environment yang belum menjalankan akan menghasilkan state berbeda.

### 5.4 Auditable

Harus bisa menjawab:

- siapa membuat perubahan,
- kapan diterapkan,
- migration mana yang berjalan,
- berapa lama durasinya,
- apakah sukses/gagal,
- checksum-nya apa,
- environment mana yang sudah menerima.

Tool seperti Flyway dan Liquibase menyediakan history table untuk membantu audit ini, tetapi governance tetap perlu didesain.

### 5.5 Deterministic

Migration yang sama harus menghasilkan state yang sama, sejauh input database awalnya sama.

Buruk:

```sql
INSERT INTO config (key, value)
VALUES ('cutoff_date', CURRENT_DATE);
```

Jika dijalankan hari berbeda, hasilnya beda.

Lebih baik:

```sql
INSERT INTO config (key, value)
VALUES ('cutoff_date', '2026-01-01');
```

### 5.6 Environment-Aware but Not Environment-Random

Kadang DEV, UAT, dan PROD butuh konfigurasi berbeda.

Tetapi migration tidak boleh berubah liar berdasarkan environment tanpa governance.

Buruk:

```sql
-- pseudo example
IF env = 'prod' THEN
  INSERT INTO config VALUES ('endpoint', 'https://prod.example.com');
ELSE
  INSERT INTO config VALUES ('endpoint', 'http://localhost:8080');
END IF;
```

Lebih baik:

- schema migration tetap sama,
- seed reference data tetap sama,
- environment-specific config dikelola lewat config management,
- jika harus seeded, gunakan mechanism eksplisit seperti context/label/profile dengan review.

### 5.7 Compatible with Deployment Style

Jika deployment menggunakan rolling update, schema migration harus kompatibel dengan aplikasi lama dan baru.

Jika deployment offline maintenance window, ruang geraknya lebih besar.

Versioning model tidak bisa dipisahkan dari deployment model.

---

## 6. Linear Versioning Model

Linear versioning adalah model paling sederhana.

```text
V1 -> V2 -> V3 -> V4 -> V5
```

Setiap migration punya nomor berurutan.

Contoh:

```text
V1__create_customer_table.sql
V2__create_order_table.sql
V3__add_customer_email.sql
V4__create_order_index.sql
```

### 6.1 Kelebihan

- Mudah dipahami.
- Cocok untuk small team.
- Cocok untuk single branch release.
- Mudah dibaca di migration history.
- Mudah direview secara urutan.

### 6.2 Kekurangan

- Sering konflik saat banyak developer bekerja paralel.
- Butuh koordinasi nomor migration.
- Rebase branch bisa menyakitkan.
- Hotfix production bisa mengganggu urutan.
- Tidak scalable untuk banyak tim/module.

### 6.3 Contoh Konflik

Developer A membuat:

```text
V12__add_customer_phone.sql
```

Developer B juga membuat:

```text
V12__add_order_status.sql
```

Saat merge, salah satu harus rename.

Jika sudah pernah dijalankan di environment tertentu, rename bisa menjadi masalah.

### 6.4 Kapan Cocok

Linear versioning cocok untuk:

- project kecil,
- satu tim,
- satu release branch,
- frekuensi migration rendah,
- deployment sederhana,
- sistem internal low-risk.

### 6.5 Kapan Tidak Cocok

Kurang cocok untuk:

- banyak tim,
- microservices banyak schema,
- trunk-based development dengan banyak parallel changes,
- frequent releases,
- regulated environments dengan hotfix paralel,
- monorepo besar.

---

## 7. Zero-Padded Linear Versioning

Variasi linear versioning:

```text
V001__init.sql
V002__create_user.sql
V003__create_role.sql
V004__add_user_email.sql
```

Zero-padding membuat file sorting lebih rapi.

### 7.1 Kenapa Zero Padding Penting

Tanpa padding, sort lexical bisa membingungkan:

```text
V1
V10
V11
V2
V3
```

Dengan padding:

```text
V001
V002
V003
V010
V011
```

Tool migration biasanya punya parser version sendiri, tetapi manusia tetap membaca lewat IDE, GitHub, GitLab, atau file explorer. Naming yang ramah manusia mengurangi error review.

### 7.2 Batasan

Jika dimulai dengan `V001`, pertanyaannya:

> Setelah `V999`, bagaimana?

Untuk sistem panjang, gunakan padding lebih besar:

```text
V000001__init.sql
```

Tetapi untuk tim besar, timestamp versioning biasanya lebih baik.

---

## 8. Timestamp Versioning Model

Timestamp versioning menggunakan waktu sebagai identity version.

Contoh:

```text
V202606170900__create_customer_table.sql
V202606170930__add_customer_email.sql
V202606171015__create_order_index.sql
```

Format umum:

```text
VyyyyMMddHHmm__description.sql
```

Atau lebih detail:

```text
VyyyyMMddHHmmss__description.sql
```

### 8.1 Kelebihan

- Mengurangi konflik antar developer.
- Tidak perlu booking nomor versi.
- Urutan natural mengikuti waktu pembuatan.
- Cocok untuk trunk-based development.
- Cocok untuk banyak developer.
- Mudah melihat kapan migration dibuat.

### 8.2 Kekurangan

- Timestamp bukan selalu dependency order yang benar.
- Dua migration bisa dibuat di waktu sama jika resolusi menit terlalu rendah.
- Timezone bisa membingungkan.
- Nama file lebih panjang.
- Hotfix yang dibuat belakangan tetapi perlu masuk sebelum migration lain bisa perlu strategi khusus.

### 8.3 Timestamp Is Identity, Not Truth

Timestamp memberi urutan default, tetapi tidak membuktikan dependency logic.

Contoh:

```text
V202606171000__add_customer_status_id.sql
V202606170930__create_customer_status_table.sql
```

Urutan benar jika status table dibuat sebelum column/FK.

Tetapi jika developer salah timestamp:

```text
V202606170930__add_customer_status_id.sql
V202606171000__create_customer_status_table.sql
```

Migration bisa gagal.

Jadi timestamp bukan pengganti design review.

### 8.4 Timezone Convention

Gunakan satu timezone convention.

Pilihan umum:

```text
UTC timestamp
```

Contoh:

```text
V20260617023000__add_customer_email.sql
```

Atau local team timezone jika semua tim satu negara, tetapi ini kurang portable.

Untuk distributed team, UTC lebih aman.

### 8.5 Recommended Format

Untuk sistem enterprise:

```text
V20260617093000__module_action_object.sql
```

Contoh:

```text
V20260617093000__case_add_risk_score_column.sql
V20260617101000__case_backfill_risk_score.sql
V20260617103000__case_add_risk_score_index.sql
```

Kenapa include module?

Karena dalam sistem besar, file list akan panjang. Prefix module membantu review.

---

## 9. Semantic Migration Versioning

Semantic migration versioning mengikat migration ke release version.

Contoh:

```text
V2_3_0_001__create_case_priority.sql
V2_3_0_002__seed_case_priority.sql
V2_3_1_001__fix_case_priority_label.sql
```

Atau:

```text
V2026_2_0_001__add_customer_segment.sql
```

### 9.1 Kelebihan

- Mudah mengaitkan migration dengan release aplikasi.
- Cocok untuk release train.
- Cocok untuk enterprise release documentation.
- Mudah menjawab “migration apa yang masuk release 2.3.0?”

### 9.2 Kekurangan

- Sulit dalam continuous delivery.
- Jika migration dibuat sebelum release version final, perlu rename.
- Parallel feature branch bisa bentrok.
- Hotfix bisa membingungkan.
- Migration identity terlalu tergantung proses release.

### 9.3 Kapan Cocok

Cocok untuk:

- release cadence lambat,
- regulated enterprise,
- on-premise software product,
- customer-specific upgrade package,
- vendor product yang dikirim ke banyak customer,
- release train dengan approval formal.

### 9.4 Kapan Kurang Cocok

Kurang cocok untuk:

- high-frequency deployment,
- trunk-based continuous delivery,
- banyak feature parallel,
- cloud-native SaaS yang deploy beberapa kali sehari.

---

## 10. Release-Based Versioning Model

Release-based versioning mirip semantic versioning, tetapi menggunakan nama release.

Contoh:

```text
V2026Q2_001__add_application_risk_score.sql
V2026Q2_002__seed_case_priority.sql
V2026Q3_001__add_compliance_flag.sql
```

Atau:

```text
VREL_2026_06_001__add_customer_tier.sql
```

### 10.1 Kelebihan

- Cocok untuk organisasi dengan release window formal.
- Mudah untuk release note.
- Cocok untuk UAT batch.
- Cocok untuk change advisory board.

### 10.2 Kekurangan

- Kurang fleksibel untuk hotfix.
- Membuat migration terlihat seperti milik release, bukan milik domain/module.
- Jika feature pindah release, migration identity bisa terganggu.

### 10.3 Hidden Risk

Migration seharusnya immutable setelah masuk shared environment.

Jika feature ditunda dari release, jangan sembarangan delete atau rename migration yang sudah pernah dijalankan di SIT/UAT. Buat migration korektif atau atur environment rebuild sesuai governance.

---

## 11. Branch-Based Versioning and Its Trap

Dalam Git, developer bekerja di branch:

```text
feature/customer-email
feature/order-status
hotfix/prod-index
```

Setiap branch bisa membuat migration.

Masalahnya: database migration punya global ordering, sementara Git branch punya parallel history.

### 11.1 Contoh Konflik Branch

Main branch:

```text
V10__create_customer.sql
V11__create_order.sql
```

Branch A:

```text
V12__add_customer_email.sql
```

Branch B:

```text
V12__add_order_status.sql
```

Saat merge:

```text
V12 duplicate
```

Solusi umum:

- pakai timestamp versioning,
- rebase dan rename sebelum merge,
- migration conflict check di CI,
- ownership convention per module,
- avoid long-lived branch.

### 11.2 Branch Prefix Anti-Pattern

Kadang tim mencoba:

```text
Vfeature_customer_email_001__add_email.sql
```

Ini buruk untuk migration tool yang butuh ordered version stabil.

Branch adalah concept Git. Database version harus merepresentasikan production ordering, bukan temporary branch identity.

### 11.3 Long-Lived Branch Problem

Semakin lama branch hidup, semakin besar risiko:

- migration conflict,
- schema assumption stale,
- duplicate column/index,
- seed data conflict,
- object rename conflict,
- migration order salah.

Untuk database-heavy system, branch lama adalah risiko serius.

---

## 12. Out-of-Order Migrations

Out-of-order migration terjadi ketika migration dengan version lebih kecil muncul setelah database sudah berada pada version lebih tinggi.

Contoh:

PROD sudah punya:

```text
V10
V11
V12
```

Lalu branch lama merge membawa:

```text
V09_1__missing_hotfix.sql
```

Atau:

```text
V11_5__add_index.sql
```

Secara version order, migration itu “di masa lalu”.

### 12.1 Kenapa Berbahaya

Out-of-order migration bisa berbahaya karena:

- asumsi schema saat migration dibuat mungkin sudah berubah,
- migration mungkin harusnya berjalan sebelum data berubah,
- migration bisa konflik dengan object baru,
- audit chronology membingungkan.

### 12.2 Kapan Dapat Diterima

Kadang acceptable untuk hotfix kecil, misalnya menambahkan index non-breaking.

Contoh:

```text
V202606010900__add_missing_index.sql
```

Muncul setelah PROD sudah sampai:

```text
V202606170900
```

Jika tool dikonfigurasi untuk allow out-of-order, migration itu dapat tetap diterapkan.

Tetapi ini harus governance decision, bukan default santai.

### 12.3 Better Strategy

Biasanya lebih aman membuat migration baru dengan version terbaru:

```text
V202606171530__add_missing_customer_index_hotfix.sql
```

Daripada menyisipkan migration lama.

Database history harus mencerminkan real deployment order.

---

## 13. Hotfix Versioning Model

Hotfix production sering terjadi saat release normal belum siap.

Contoh:

- index tambahan karena query lambat,
- constraint correction,
- data correction,
- emergency seed update,
- sequence fix,
- invalid object recompilation,
- permission grant.

### 13.1 Problem

Misal UAT sedang test release `R2.5` dengan migration:

```text
V202606170900__add_new_case_field.sql
V202606171000__seed_case_category.sql
```

Tiba-tiba PROD butuh hotfix:

```text
add index on audit_trail(created_date_time)
```

Jika hotfix dibuat langsung di PROD manual, maka environment drift.

Jika hotfix dibuat sebagai migration, harus dipastikan masuk ke main branch dan semua environment lain.

### 13.2 Hotfix Naming

Gunakan naming eksplisit:

```text
V20260617143000__hotfix_add_audit_trail_created_datetime_index.sql
```

Atau module-specific:

```text
V20260617143000__audit_hotfix_add_created_datetime_index.sql
```

### 13.3 Hotfix Rule

Rule yang sehat:

> Every production hotfix must become a normal migration artifact in source control.

Artinya:

- jangan hanya manual SQL di PROD,
- jangan lupa back-merge ke main,
- jangan lupa apply ke lower env,
- jangan hilangkan dari history,
- jangan treat sebagai pengecualian tak terdokumentasi.

### 13.4 Hotfix Back-Merge Flow

```text
1. Incident detected
2. Hotfix migration created
3. Reviewed quickly
4. Applied to PROD through controlled pipeline/manual emergency run
5. Merged to main
6. Promoted/applied to DEV/SIT/UAT if missing
7. Release branch reconciled
8. Post-incident review records reason
```

Jika step 5–7 dilewatkan, drift hampir pasti terjadi.

---

## 14. One Application One Schema Versioning

Model paling sederhana:

```text
one application -> one schema -> one migration history
```

Contoh:

```text
case-service owns case_schema
```

Migration ada di repository service:

```text
case-service/
  src/main/resources/db/migration/
    V202606170900__create_case.sql
    V202606171000__add_case_priority.sql
```

### 14.1 Kelebihan

- Ownership jelas.
- Deployment mudah.
- Migration dekat dengan code yang membutuhkannya.
- Review domain lebih mudah.
- CI bisa test service + database together.

### 14.2 Kekurangan

- Cross-service dependency perlu dikelola.
- Shared reference data bisa duplicate.
- Reporting schema bisa sulit.
- Data warehouse/analytics tidak otomatis included.

### 14.3 Best Practice

Jika memungkinkan, ini model paling bersih.

```text
Service owns its schema.
Only that service writes to its schema.
Other services access through API/event, not direct table.
```

Dalam real enterprise, ini tidak selalu bisa, tetapi tetap ideal yang bagus.

---

## 15. Many Applications One Shared Schema

Model ini umum di legacy enterprise.

```text
application A
application B
application C
       |
       v
shared_schema
```

Contoh:

- monolith modular,
- beberapa batch job dan web app berbagi DB,
- reporting tool membaca table operational,
- admin app dan public app share schema,
- Jakarta EE modules share persistence unit.

### 15.1 Problem

Shared schema membuat database versioning lebih sulit karena:

- satu migration bisa memengaruhi banyak aplikasi,
- satu aplikasi bisa butuh schema baru saat aplikasi lain belum siap,
- rollback satu aplikasi tidak berarti rollback schema aman,
- ownership table sering kabur,
- manual patch sering terjadi,
- release coordination lebih berat.

### 15.2 Versioning Strategy

Untuk shared schema, lebih baik migration repository juga shared atau setidaknya dikoordinasikan.

Opsi A: Central migration repository

```text
database-migrations/
  common/
  case/
  compliance/
  reporting/
```

Opsi B: One module owns migration, others depend on contract

```text
case-module owns case tables
compliance-module owns compliance tables
shared migration pipeline orders all modules
```

Opsi C: Per-app migration with strict namespace

```text
app-a/db/migration
app-b/db/migration
```

Ini berbahaya jika semua menulis ke schema sama tanpa coordination.

### 15.3 Rule

Dalam shared schema:

> Table ownership must be explicit.

Jika tidak, migration review akan selalu kabur.

Contoh ownership document:

| Object Pattern | Owner | Other Writers | Other Readers | Change Approval |
|---|---|---:|---:|---|
| `CASE_%` | Case module | No | Reporting, Compliance | Case + impacted readers |
| `COMPLIANCE_%` | Compliance module | No | Reporting | Compliance |
| `REF_%` | Platform/Common | Controlled | Many | Architecture review |
| `AUDIT_%` | Platform | No direct writes | Many | Platform + DBA |

---

## 16. One Application Many Schemas

Kadang satu aplikasi mengelola banyak schema.

Contoh:

```text
case-service
  - case_schema
  - audit_schema
  - reporting_schema
```

Atau multi-schema Oracle:

```text
ACEAS_APP
ACEAS_AUDIT
ACEAS_REPORT
ACEAS_REF
```

### 16.1 Problem

- Migration order antar schema.
- Cross-schema grants.
- Synonyms/views.
- Different DB users.
- Different permissions.
- Tool configuration per schema.
- History table location.

### 16.2 Strategy

Ada beberapa strategy.

#### Strategy A — One history table per schema

```text
case_schema.flyway_schema_history
audit_schema.flyway_schema_history
report_schema.flyway_schema_history
```

Kelebihan:

- isolated,
- ownership jelas,
- failure lebih terlokalisasi.

Kekurangan:

- ordering antar schema perlu pipeline orchestration,
- sulit tahu global database state.

#### Strategy B — One central history table

```text
migration_admin.flyway_schema_history
```

Kelebihan:

- satu audit trail,
- global ordering jelas.

Kekurangan:

- permission lebih kompleks,
- migration user sangat privileged,
- object ownership perlu hati-hati.

#### Strategy C — Separate tool execution per schema

```text
flyway -schemas=case_schema migrate
flyway -schemas=audit_schema migrate
```

Atau Liquibase changelog per schema.

Cocok jika schema benar-benar independen.

### 16.3 Recommendation

Untuk enterprise system:

- pisahkan ownership per schema,
- minimalkan cross-schema DDL,
- dokumentasikan dependency,
- gunakan pipeline yang eksplisit,
- jangan biarkan application startup menjalankan migration multi-schema kompleks tanpa kontrol.

---

## 17. Multi-Module Monolith Versioning

Monolith modern sering modular:

```text
application-management
case-management
compliance
correspondence
revenue
reporting
```

Semuanya satu deployable artifact tetapi banyak module domain.

### 17.1 Options

#### Option A — Single global migration folder

```text
src/main/resources/db/migration/
  V202606170900__case_create_case.sql
  V202606171000__compliance_create_check.sql
```

Kelebihan:

- simple,
- satu order global,
- cocok dengan Flyway default.

Kekurangan:

- folder sangat panjang,
- ownership kurang terlihat,
- merge conflict banyak.

#### Option B — Module-specific folders with ordered aggregation

```text
src/main/resources/db/migration/case/
src/main/resources/db/migration/compliance/
src/main/resources/db/migration/revenue/
```

Lalu tool dikonfigurasi membaca multiple locations.

Kelebihan:

- ownership lebih jelas,
- module lebih terorganisir.

Kekurangan:

- global ordering tetap harus dijaga,
- duplicate version antar folder bisa problem tergantung tool/config,
- reviewer harus melihat linting output.

#### Option C — Changelog master by module

Lebih natural di Liquibase:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/case/changelog-case.yaml
  - include:
      file: db/changelog/compliance/changelog-compliance.yaml
```

Kelebihan:

- hierarchy jelas,
- per-module changelog,
- cocok untuk enterprise.

Kekurangan:

- include order menjadi critical,
- generated changelog bisa noisy,
- perlu convention ketat.

### 17.2 Recommended Convention

Untuk multi-module monolith:

```text
V<timestamp>__<module>_<action>_<object>.sql
```

Contoh:

```text
V20260617090000__case_create_case_priority_table.sql
V20260617093000__case_seed_default_case_priorities.sql
V20260617100000__compliance_add_screening_result_index.sql
```

Ini membuat folder global tetap readable.

---

## 18. Microservices Versioning

Microservices idealnya:

```text
one service owns one database/schema
```

Maka migration berada bersama service.

```text
user-service/
  src/main/resources/db/migration
order-service/
  src/main/resources/db/migration
billing-service/
  src/main/resources/db/migration
```

### 18.1 Kelebihan

- autonomy,
- local ownership,
- deployment independent,
- schema change follows service release,
- no global migration bottleneck.

### 18.2 Hidden Problem

Microservices bukan berarti tidak ada database dependency.

Contoh:

- reporting DB membaca semua schema,
- search indexer membaca tables,
- CDC pipeline tergantung column,
- batch job masih direct query,
- legacy service share database,
- BI dashboards direct SQL.

Maka database versioning harus memasukkan downstream dependency.

### 18.3 Contract-Oriented Schema Change

Untuk microservices, schema harus diperlakukan sebagai internal detail. Consumer tidak boleh bergantung pada table langsung.

Tetapi jika ada CDC/event:

```text
DB schema -> CDC -> event -> consumer
```

Perubahan schema bisa mengubah event shape jika CDC mentah diekspos.

Top engineer akan membedakan:

- internal DB schema version,
- event schema version,
- API version,
- read model version.

---

## 19. Migration History Table as Source of Truth

Migration tool biasanya menyimpan histori.

Flyway menggunakan schema history table.  
Liquibase menggunakan `DATABASECHANGELOG` dan lock table.

Konsepnya sama:

> Database itself records which migrations have been applied.

### 19.1 Why History Table Matters

Tanpa history table, tool tidak tahu apakah migration sudah berjalan.

History table menyimpan informasi seperti:

- version,
- description,
- script name,
- checksum,
- installed by,
- installed on,
- execution time,
- success/failure.

### 19.2 History Table Is Not Optional

Kadang developer mencoba “simple migration runner” yang hanya run semua SQL di folder.

Itu berbahaya.

Minimal harus ada:

```text
migration_id
script_name
checksum
executed_at
executed_by
status
execution_time
```

Kalau tidak, sistem tidak punya memory.

### 19.3 History Table and Git

Git menyimpan source code migration.

History table menyimpan applied state di database.

Keduanya harus cocok.

```text
Git migration files + DB migration history = database change truth
```

Jika Git bilang ada migration tetapi DB belum menerapkan, migration pending.

Jika DB history punya migration yang tidak ada di Git, ada drift atau artifact hilang.

Jika checksum DB berbeda dari file Git, migration diedit setelah diterapkan.

---

## 20. Checksums and Immutability

Checksum adalah fingerprint dari migration content.

Jika file berubah, checksum berubah.

### 20.1 Why Checksum Exists

Contoh:

`V5__add_email.sql` awalnya:

```sql
ALTER TABLE users ADD email VARCHAR(255);
```

Sudah dijalankan di UAT.

Lalu developer mengubah file menjadi:

```sql
ALTER TABLE users ADD email VARCHAR(320);
```

Nama file sama, tetapi content beda.

Tool mendeteksi checksum mismatch.

Ini bukan bug. Ini proteksi.

### 20.2 Rule

> Once a migration is applied to a shared environment, do not edit it. Create a new migration.

Jika belum pernah diterapkan di environment shared dan masih local-only, edit mungkin acceptable. Tetapi setelah masuk shared env, treat as immutable.

### 20.3 Exception

Kadang checksum berubah karena:

- line ending berubah,
- formatting berubah,
- comment berubah,
- tool version behavior berubah,
- encoding berubah.

Tetap harus hati-hati. Jangan langsung `repair` tanpa paham.

`repair` bukan penghapus dosa. `repair` adalah tindakan administratif yang harus punya alasan.

---

## 21. Version Number Anti-Patterns

### 21.1 Reusing Version

Buruk:

```text
V10__add_email.sql
V10__add_status.sql
```

Hasil:

- conflict,
- tool error,
- ambiguity.

### 21.2 Editing Old Version

Buruk:

```text
V10__create_table.sql
```

Diubah setelah UAT/PROD.

Hasil:

- checksum mismatch,
- environment drift,
- loss of auditability.

### 21.3 Skipping Version Is Not Problem

Ini bukan masalah:

```text
V001
V002
V005
```

Selama tool menerima dan urutan jelas.

Jangan memaksakan contiguous numbering jika itu menyebabkan rename migration yang sudah applied.

### 21.4 Meaningless Description

Buruk:

```text
V202606170900__fix.sql
V202606171000__update.sql
V202606171100__changes.sql
```

Baik:

```text
V202606170900__case_add_risk_score_column.sql
V202606171000__case_backfill_risk_score_from_assessment.sql
V202606171100__case_add_risk_score_not_null_constraint.sql
```

Description membantu review dan incident response.

### 21.5 Too Much Meaning in Version

Buruk:

```text
VPROD_FINAL_APPROVED_RELEASE_2_4_20260617__add_index.sql
```

Version field sebaiknya tetap machine-orderable. Metadata lain bisa ada di description, release note, PR, atau changelog.

---

## 22. Naming Convention That Scales

Naming convention harus memenuhi kebutuhan machine dan manusia.

### 22.1 Recommended Flyway Naming

Untuk tim medium-large:

```text
V<UTC_TIMESTAMP>__<module>_<action>_<object>.sql
```

Contoh:

```text
V20260617090000__case_create_case_priority_table.sql
V20260617093000__case_add_priority_id_to_case.sql
V20260617100000__case_seed_default_priorities.sql
V20260617103000__case_add_priority_fk.sql
```

### 22.2 Action Vocabulary

Gunakan vocabulary konsisten:

```text
create
add
drop
rename
alter
seed
backfill
normalize
denormalize
index
constraint
fix
repair
hotfix
rebuild
recompile
```

Contoh:

```text
V20260617110000__audit_add_created_datetime_index.sql
V20260617120000__user_backfill_normalized_email.sql
V20260617130000__common_seed_default_permissions.sql
```

### 22.3 Object Naming

Sebut object utama:

```text
case_priority_table
customer_email_column
idx_audit_created_datetime
role_permission_seed
```

Jangan terlalu generic.

### 22.4 Description Must Tell Intent

Bandingkan:

```text
V20260617090000__add_column.sql
```

vs

```text
V20260617090000__case_add_risk_score_column.sql
```

Yang kedua langsung menjawab:

- module: case,
- action: add,
- object: risk_score column.

---

## 23. Versioning Schema Changes and Data Changes Together

Pertanyaan umum:

> Apakah schema migration dan data migration harus dipisah?

Jawabannya: sering iya, tetapi tidak selalu.

### 23.1 Same Migration

Boleh jika perubahan kecil dan tightly coupled.

Contoh:

```sql
ALTER TABLE case_priority ADD display_order INT;

UPDATE case_priority
SET display_order = 1
WHERE code = 'HIGH';
```

Tetapi jika data banyak, jangan.

### 23.2 Separate Migration

Lebih baik untuk:

- backfill besar,
- lock-sensitive update,
- migration yang butuh observability,
- data correction,
- seed mutable,
- multi-step expand/contract.

Contoh:

```text
V20260617090000__case_add_risk_score_column.sql
V20260617100000__case_backfill_risk_score.sql
V20260617110000__case_add_risk_score_not_null_constraint.sql
```

Urutan ini lebih jelas dan aman.

### 23.3 Why Separate Helps

Pemisahan membantu:

- review,
- rollback reasoning,
- performance testing,
- monitoring,
- incident recovery,
- partial failure handling.

Jika satu migration melakukan terlalu banyak, sulit tahu bagian mana yang gagal.

---

## 24. Versioning Reference Data

Reference data sering dianggap “data biasa”, padahal sering menjadi contract aplikasi.

Contoh:

```text
CASE_STATUS
APPLICATION_TYPE
ROLE
PERMISSION
COUNTRY
CURRENCY
```

Jika code Java mengandalkan `CASE_STATUS = APPROVED`, maka seed status itu adalah bagian dari contract.

### 24.1 Versioned Seed

Contoh:

```text
V20260617090000__common_seed_case_statuses.sql
```

Cocok untuk seed yang berubah historis dan perlu audit.

### 24.2 Repeatable Seed

Kadang seed dikelola sebagai repeatable object.

Contoh:

```text
R__common_reference_data.sql
```

Ini bisa berbahaya jika delete/reinsert sembarangan.

### 24.3 Guideline

Untuk production reference data:

- gunakan stable natural key,
- hindari delete-reinsert jika sudah direferensikan,
- gunakan upsert/merge hati-hati,
- simpan audit perubahan,
- pisahkan reference data immutable vs configurable,
- jangan seed secret/password plaintext.

Versioning reference data akan dibahas lebih dalam di Part 17 dan 18.

---

## 25. Versioning Repeatable Objects

Tidak semua database object cocok sebagai versioned migration biasa.

Contoh object yang sering repeatable:

- views,
- functions,
- stored procedures,
- packages,
- triggers,
- materialized view definition,
- grants sometimes,
- synonyms sometimes.

### 25.1 Why Repeatable

Misal view:

```sql
CREATE OR REPLACE VIEW case_summary AS ...
```

Setiap definisi berubah, kita ingin apply definisi terbaru.

Flyway repeatable migration biasanya dinamai:

```text
R__case_summary_view.sql
```

Liquibase bisa mengelola ini lewat changeset atau `runOnChange` pattern.

### 25.2 Risk

Repeatable migration bisa menyembunyikan history perubahan.

Jika view berubah 20 kali tetapi file yang sama diedit, history detail ada di Git, bukan migration history.

Untuk regulated system, pastikan Git/PR audit cukup.

### 25.3 Rule

Gunakan repeatable untuk object definition yang secara alami “replaceable”. Jangan gunakan repeatable untuk destructive stateful data mutation.

---

## 26. Database Compatibility Matrix

Top engineer tidak hanya bertanya:

> Migration sudah jalan?

Ia bertanya:

> Kombinasi aplikasi dan database mana yang kompatibel?

Contoh:

| Application Version | Database State | Compatible? | Reason |
|---|---|---:|---|
| App 1.0 | DB V10 | Yes | Baseline |
| App 1.0 | DB V11 add nullable column | Yes | Old app ignores column |
| App 1.1 | DB V10 | No | App expects new column |
| App 1.1 | DB V11 | Yes | Required schema exists |
| App 1.2 | DB V12 drop old column | Yes only after old app drained | Breaking for App 1.0 |

### 26.1 Rolling Deployment Concern

Dalam Kubernetes rolling deployment:

```text
old pods and new pods may run at same time
```

Maka database harus kompatibel dengan keduanya sementara.

### 26.2 Expand/Contract Compatibility

Pattern umum:

```text
1. Expand DB: add new nullable column/table/index
2. Deploy app that writes both old and new
3. Backfill
4. Switch reads to new
5. Stop using old
6. Contract DB: drop old column/table later
```

Versioning harus mencerminkan tiap phase.

Contoh:

```text
V20260617090000__user_add_email_normalized_column.sql
V20260617100000__user_backfill_email_normalized.sql
V20260617110000__user_add_email_normalized_index.sql
V20260701090000__user_drop_legacy_email_column.sql
```

Contract phase sering release berbeda.

---

## 27. Database Version in CI/CD

Versioning tidak boleh hanya hidup di folder migration. CI/CD harus memvalidasi.

### 27.1 Checks

Pipeline ideal memeriksa:

- duplicate version,
- invalid naming,
- checksum issue,
- migration can run from empty DB,
- migration can run from previous release DB,
- migration can validate existing history,
- forbidden operation detection,
- destructive change requires approval,
- seed deterministic,
- rollback/roll-forward documented,
- generated SQL reviewed.

### 27.2 Artifact Versioning

Pertanyaan penting:

> Migration file ikut artifact aplikasi atau artifact terpisah?

Opsi A: Migration bundled in app JAR

```text
app.jar contains db/migration
```

Kelebihan:

- simple,
- app and migration version aligned,
- Spring Boot friendly.

Kekurangan:

- app startup may run migration,
- difficult with privileged migration user,
- less control in production.

Opsi B: Migration artifact separate

```text
db-migrations-1.42.0.zip
```

Kelebihan:

- controlled execution,
- approvals easier,
- DBA review easier,
- app runtime does not need DDL privilege.

Kekurangan:

- more pipeline complexity,
- must coordinate app and db artifact.

### 27.3 Recommended for Serious Production

Untuk high-risk production:

```text
Build once:
  - app artifact
  - migration artifact

Promote same artifacts across environments:
  DEV -> SIT -> UAT -> PROD
```

Jangan rebuild migration berbeda untuk PROD.

---

## 28. Versioning in Local Development

Local dev sering lebih fleksibel, tetapi jangan sampai kebiasaan lokal merusak production discipline.

### 28.1 Local Reset

Developer boleh sering reset database lokal:

```text
drop schema
migrate from scratch
seed test data
```

Tetapi migration yang sudah masuk shared env tetap immutable.

### 28.2 Local Experimental Migration

Saat eksperimen, developer bisa membuat migration sementara.

Sebelum merge:

- squash jika belum shared,
- rename sesuai convention,
- split schema/data jika perlu,
- hapus test-only seed dari production path,
- pastikan clean migration from empty DB berhasil.

### 28.3 Danger

Jika developer mengandalkan ORM auto-DDL di local:

```properties
spring.jpa.hibernate.ddl-auto=update
```

lalu lupa membuat migration, local app jalan tetapi environment lain gagal.

Untuk serious system, local harus mendekati production flow:

```text
start DB -> run migration -> run app
```

---

## 29. Versioning Across Environments

Environment umum:

```text
LOCAL -> DEV -> SIT -> UAT -> STAGING -> PROD
```

Database version harus bisa dibandingkan.

### 29.1 Same Migration, Different Timing

Idealnya migration yang sama dipromosikan.

```text
DEV    V100
SIT    V098
UAT    V095
PROD   V090
```

Ini normal jika release belum sampai PROD.

Yang tidak normal:

```text
PROD has V091_hotfix not in DEV/SIT/UAT source control
```

Itu drift.

### 29.2 Environment Drift Types

#### Type 1 — Extra Migration in PROD

Ada perubahan manual/hotfix yang tidak ada di Git.

#### Type 2 — Missing Migration in UAT

UAT tidak menjalankan migration yang seharusnya sudah ada.

#### Type 3 — Different Checksum

File sama namanya tetapi content berbeda.

#### Type 4 — Data Seed Drift

Reference data berbeda antar environment.

#### Type 5 — Permission Drift

Schema sama tetapi grants berbeda.

#### Type 6 — Object Definition Drift

View/procedure/index berbeda karena manual change.

### 29.3 Drift Detection

Cara mendeteksi:

- compare migration history table,
- compare schema diff,
- compare reference data checksum,
- compare grants,
- compare object definitions,
- validate migration checksums,
- run smoke queries.

Drift detection akan dibahas lebih dalam di CI/CD dan observability parts.

---

## 30. Versioning and Baseline Existing Database

Banyak project tidak mulai dari database kosong.

Ada existing production database tanpa Flyway/Liquibase.

### 30.1 Problem

Database sudah punya:

- ratusan table,
- index,
- views,
- procedures,
- data,
- grants,
- manual changes.

Lalu kita ingin mulai migration tool.

### 30.2 Baseline Concept

Baseline berarti:

> Menandai database existing sebagai starting point version tertentu tanpa menjalankan semua migration historis dari nol.

Contoh:

```text
Existing PROD state = V1000 baseline
Future migration starts at V1001
```

### 30.3 Baseline Script

Sebaiknya tetap punya baseline DDL untuk fresh environment:

```text
B001__baseline_schema.sql
```

Atau:

```text
V1000__baseline_existing_schema.sql
```

Tetapi strategi detail tergantung tool.

### 30.4 Risk

Baseline yang buruk bisa membuat DEV fresh database berbeda dari PROD baseline.

Jika baseline script dihasilkan dari database yang sudah drift, drift menjadi canon.

### 30.5 Baseline Governance

Saat baseline:

- freeze manual schema changes,
- export schema definition,
- review object count,
- compare environments,
- clean invalid objects,
- decide baseline version,
- create migration history marker,
- document assumptions,
- validate fresh build.

---

## 31. Versioning Strategy Decision Matrix

| Context | Recommended Versioning | Why |
|---|---|---|
| Small single-team app | `V001`, `V002` linear | Simple and readable |
| Medium team, frequent merges | timestamp | Avoids version collision |
| Regulated release train | release + sequence or timestamp + release metadata | Audit and release mapping |
| Monorepo multi-module | timestamp + module prefix | Reduces conflict, improves ownership |
| Microservices | per-service timestamp | Service autonomy |
| Shared legacy schema | central timestamp + ownership convention | Prevents uncoordinated changes |
| On-prem product | semantic/release-based | Customer upgrade mapping |
| Multi-tenant SaaS | timestamp + tenant migration registry | Need per-tenant tracking |
| Hotfix-heavy production | timestamp + explicit hotfix description | Preserves real chronology |

---

## 32. Recommended Default for This Series

Untuk seri ini, default convention yang akan kita pakai:

```text
V<yyyyMMddHHmmss>__<module>_<action>_<object>.sql
```

Contoh:

```text
V20260617090000__case_create_case_priority_table.sql
V20260617093000__case_seed_default_case_priorities.sql
V20260617100000__case_add_priority_id_to_case.sql
V20260617103000__case_add_priority_foreign_key.sql
```

Untuk repeatable:

```text
R__<module>_<object_type>_<object_name>.sql
```

Contoh:

```text
R__case_view_case_summary.sql
R__report_view_monthly_case_volume.sql
```

Untuk Liquibase, equivalent convention:

```text
db/changelog/
  db.changelog-master.yaml
  case/
    2026-06-17-090000-case-create-case-priority-table.yaml
    2026-06-17-093000-case-seed-default-case-priorities.yaml
```

Atau SQL-first Liquibase:

```text
db/changelog/case/20260617090000_case_create_case_priority_table.sql
```

---

## 33. Practical Example: Feature Requiring Multiple Database Versions

Misal kita ingin menambahkan `risk_score` ke `case`.

Naive approach:

```sql
ALTER TABLE case ADD risk_score NUMBER NOT NULL;
```

Ini bisa gagal karena existing rows tidak punya value.

Lebih mature:

### Step 1 — Expand

```text
V20260617090000__case_add_nullable_risk_score_column.sql
```

```sql
ALTER TABLE cases ADD risk_score NUMBER(5,2);
```

Aplikasi lama tetap aman karena column nullable dan tidak digunakan.

### Step 2 — Deploy App Dual Logic

Aplikasi baru mulai menulis `risk_score` untuk data baru.

### Step 3 — Backfill

```text
V20260617100000__case_backfill_risk_score.sql
```

```sql
UPDATE cases
SET risk_score = 0
WHERE risk_score IS NULL;
```

Untuk table besar, jangan satu update besar. Gunakan batch/chunking. Ini dibahas di Part 19.

### Step 4 — Constraint

```text
V20260617110000__case_add_risk_score_not_null_constraint.sql
```

```sql
ALTER TABLE cases MODIFY risk_score NOT NULL;
```

Syntax berbeda per database.

### Step 5 — Index

```text
V20260617113000__case_add_risk_score_index.sql
```

```sql
CREATE INDEX idx_cases_risk_score ON cases(risk_score);
```

### Step 6 — Contract Later

Jika ada old field yang digantikan, drop di release berikutnya.

```text
V20260701090000__case_drop_legacy_risk_category.sql
```

### Lesson

Satu feature bisa butuh banyak database version.

Database versioning bukan representasi feature. Ia representasi safe state transitions.

---

## 34. Practical Example: Branch Conflict Resolution

Main branch punya:

```text
V20260617090000__case_create_case_priority_table.sql
```

Developer A membuat:

```text
V20260617100000__case_add_priority_to_case.sql
```

Developer B membuat:

```text
V20260617100000__compliance_add_screening_index.sql
```

Conflict karena timestamp sama.

### Resolution

Salah satu rename sebelum merge:

```text
V20260617100100__compliance_add_screening_index.sql
```

Jika belum pernah applied di shared env, rename aman.

Jika sudah applied di shared env, jangan rename sembarangan. Buat migration baru atau coordinate environment repair/rebuild.

### CI Rule

Pipeline harus fail jika duplicate version ditemukan.

---

## 35. Practical Example: Hotfix Reconciliation

PROD mengalami slow query pada audit table.

Emergency index dibuat:

```text
V20260617143000__audit_hotfix_add_created_datetime_index.sql
```

```sql
CREATE INDEX idx_audit_created_datetime
ON audit_trail(created_date_time);
```

### Good Flow

```text
1. Migration dibuat di hotfix branch
2. Applied to PROD
3. Merged to main
4. Applied to DEV/SIT/UAT if not present
5. Release branch rebased/merged
6. Incident record links migration
```

### Bad Flow

```text
1. DBA runs CREATE INDEX manually in PROD
2. Nobody commits migration
3. Later migration tries to create same index
4. UAT does not match PROD
5. Incident repeats during release
```

Hotfix yang tidak dimasukkan ke versioning system adalah technical debt sekaligus audit risk.

---

## 36. Practical Example: Seed Versioning

Aplikasi menambah role baru:

```text
ROLE_CASE_REVIEWER
```

Naive seed:

```sql
INSERT INTO roles (id, code, name)
VALUES (role_seq.nextval, 'CASE_REVIEWER', 'Case Reviewer');
```

Masalah:

- sequence ID beda antar env,
- jika dijalankan ulang duplicate,
- jika role sudah ada manual, fail,
- tidak jelas apakah role mutable.

Lebih baik gunakan stable key dan idempotent logic.

Contoh generic pseudo-SQL:

```sql
INSERT INTO roles (code, name)
SELECT 'CASE_REVIEWER', 'Case Reviewer'
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE code = 'CASE_REVIEWER'
);
```

Atau vendor-specific upsert/merge.

Migration name:

```text
V20260617150000__security_seed_case_reviewer_role.sql
```

Jika permission mapping juga ditambah:

```text
V20260617151000__security_seed_case_reviewer_permissions.sql
```

Pisahkan agar audit lebih jelas.

---

## 37. How to Think Like a Top-Tier Engineer

Saat membuat migration baru, jangan mulai dari SQL.

Mulai dari pertanyaan desain.

### 37.1 Questions Before Writing Migration

1. Ini schema change, data change, seed, backfill, atau repeatable object?
2. Apakah destructive?
3. Apakah backward-compatible dengan aplikasi lama?
4. Apakah forward-compatible dengan aplikasi baru?
5. Apakah bisa berjalan saat traffic aktif?
6. Apakah butuh lock lama?
7. Apakah butuh chunking?
8. Apakah harus dipisah menjadi beberapa migration?
9. Apakah seed idempotent?
10. Apakah migration deterministic?
11. Apakah migration bisa diulang setelah gagal?
12. Apakah rollback realistis atau harus roll-forward?
13. Apakah environment-specific?
14. Siapa owner object yang diubah?
15. Aplikasi/module lain terdampak?
16. Apakah ada reporting/CDC/batch dependency?
17. Apakah nama migration menjelaskan intent?
18. Apakah migration sudah immutable setelah merge?
19. Apakah CI akan mendeteksi konflik?
20. Apakah production runbook jelas?

### 37.2 Mindset Shift

Dari:

```text
Saya perlu menambah column.
```

Menjadi:

```text
Saya perlu membawa database dari state A ke state B melalui state transisi yang aman, auditable, compatible dengan deployment, dan recoverable jika gagal.
```

Itu perbedaan besar.

---

## 38. Recommended Repository Patterns

### 38.1 Spring Boot Single Service

```text
src/main/resources/
  db/
    migration/
      V20260617090000__customer_create_customer_table.sql
      V20260617100000__customer_add_email_column.sql
```

### 38.2 Multi-Module Monolith

```text
src/main/resources/
  db/
    migration/
      V20260617090000__case_create_case_table.sql
      V20260617093000__case_create_case_priority_table.sql
      V20260617100000__compliance_create_screening_table.sql
      V20260617103000__revenue_create_payment_table.sql
```

### 38.3 Liquibase Hierarchical

```text
src/main/resources/
  db/
    changelog/
      db.changelog-master.yaml
      case/
        case.changelog.yaml
        20260617090000_case_create_case_table.yaml
      compliance/
        compliance.changelog.yaml
        20260617100000_compliance_create_screening_table.yaml
```

### 38.4 Separate Migration Repository

```text
database-migrations/
  flyway.conf
  migrations/
    V20260617090000__case_create_case_table.sql
  scripts/
    validate.sh
    dry-run.sh
  docs/
    release-notes/
```

This is useful when:

- DBA approval required,
- app runtime cannot have DDL privilege,
- multiple apps share schema,
- migration deployment is separate from app deployment.

---

## 39. Checklist: Choosing a Versioning Model

Gunakan checklist berikut.

### 39.1 Team and Workflow

- Berapa banyak developer membuat migration paralel?
- Apakah branch short-lived atau long-lived?
- Apakah release train atau continuous delivery?
- Apakah hotfix sering terjadi?
- Apakah migration direview DBA?

### 39.2 Architecture

- One app one schema?
- Shared schema?
- Multi-module monolith?
- Microservices?
- Multi-tenant?
- Multi-database?

### 39.3 Risk

- Apakah production traffic tinggi?
- Apakah downtime allowed?
- Apakah data regulated?
- Apakah rollback wajib?
- Apakah audit formal diperlukan?

### 39.4 Tool Fit

- Flyway SQL-first cukup?
- Liquibase changelog/precondition/rollback lebih cocok?
- Perlu contexts/labels?
- Perlu repeatable object management?
- Perlu generated rollback SQL?

### 39.5 Naming Decision

- Linear atau timestamp?
- Include module prefix?
- Include action/object?
- UTC timestamp?
- Hotfix naming?
- Repeatable naming?

---

## 40. Strong Recommendations

Untuk kebanyakan Java enterprise systems modern, saya merekomendasikan default berikut:

### 40.1 Use Timestamp Versioning

```text
VyyyyMMddHHmmss__module_action_object.sql
```

Lebih scalable daripada sequential `V1`, `V2`.

### 40.2 Make Migration Immutable After Shared Environment

Jika sudah masuk DEV/SIT/UAT/PROD, jangan edit. Buat migration baru.

### 40.3 Separate Large Data Migration from Schema Migration

Jangan gabungkan DDL ringan dengan backfill jutaan row.

### 40.4 Make Hotfix a First-Class Migration

Tidak ada production SQL manual tanpa back-merge ke source control.

### 40.5 Track Compatibility, Not Just Version

Buat matrix aplikasi vs database untuk breaking changes.

### 40.6 Prefer Expand/Contract for Production

Drop/rename/change type langsung adalah sumber incident.

### 40.7 Validate in CI

Jangan menunggu deployment untuk tahu migration conflict.

### 40.8 Do Not Mix ORM Auto-DDL with Serious Migration

Hibernate `ddl-auto=update` bukan migration governance.

### 40.9 Keep Seed Data Deterministic

Seed harus bisa dipahami, diaudit, dan tidak bergantung random runtime.

### 40.10 Treat Database History as Audit Evidence

History table bukan sekadar internal metadata tool. Ia bagian dari operational truth.

---

## 41. Mini Decision Examples

### Example A — Small Internal Tool

Context:

- 2 developers,
- one database,
- low risk,
- monthly release.

Good enough:

```text
V001__init.sql
V002__create_user.sql
V003__add_role.sql
```

### Example B — Enterprise Case Management System

Context:

- many modules,
- Java backend,
- Oracle/PostgreSQL,
- UAT/PROD approvals,
- audit requirement,
- many migrations.

Better:

```text
V20260617090000__case_create_case_priority_table.sql
V20260617100000__compliance_add_screening_index.sql
V20260617110000__audit_hotfix_add_created_datetime_index.sql
```

### Example C — SaaS Microservices

Context:

- many services,
- per-service schema,
- frequent deploy,
- Kubernetes rolling deployment.

Better:

```text
Each service owns its own migration folder.
Use timestamp versioning.
Use expand/contract.
Run migration as controlled job before app rollout.
```

### Example D — On-Prem Product

Context:

- customer upgrades from version 4.2 to 4.5,
- rollback package expected,
- support team needs mapping.

Possible:

```text
V4_3_0_001__add_customer_segment.sql
V4_4_0_001__add_billing_cycle.sql
V4_5_0_001__migrate_invoice_status.sql
```

Release-based versioning may be justified.

---

## 42. Common Misconceptions

### Misconception 1 — “Database version equals latest migration number.”

More accurate:

> Database version is the applied migration history and resulting state.

### Misconception 2 — “If migration ran successfully, it is safe.”

Not necessarily. It might break old app, lock table too long, corrupt seed semantics, or create future rollback problem.

### Misconception 3 — “Rollback means run down migration.”

Often false. Data loss, irreversible transformations, and app compatibility may make rollback unsafe. Roll-forward is often better.

### Misconception 4 — “Timestamp versioning solves ordering.”

It reduces collision, but dependency order still needs review.

### Misconception 5 — “Seed data is not migration.”

Production reference seed is part of system contract and must be versioned.

### Misconception 6 — “Manual PROD patch is okay if small.”

Small manual patches create drift unless captured as migration artifact.

### Misconception 7 — “ORM can manage schema for us.”

ORM schema generation is useful for prototypes/tests, not production change governance.

---

## 43. Summary

Database versioning adalah cara kita mengubah database dari satu state ke state lain secara ordered, auditable, deterministic, dan compatible dengan deployment aplikasi.

Hal penting dari Part ini:

1. Database version bukan sekadar angka; ia adalah state historis hasil ordered migrations.
2. Application version, API version, dan database version berbeda tetapi saling terkait.
3. Database versioning lebih sulit daripada code versioning karena database adalah mutable production state.
4. Migration harus ordered, unique, immutable, auditable, deterministic, dan deployment-aware.
5. Linear versioning sederhana tetapi rawan konflik di tim besar.
6. Timestamp versioning lebih scalable untuk banyak developer dan frequent release.
7. Release/semantic versioning cocok untuk release train dan on-prem product.
8. Branch parallel dan hotfix production adalah sumber konflik utama.
9. Migration history table adalah source of truth applied state.
10. Checksum menjaga immutability dan mencegah silent drift.
11. Shared schema dan multi-module system butuh ownership convention.
12. Microservices tetap butuh schema contract awareness jika ada CDC/reporting/direct dependency.
13. Seed/reference data harus ikut versioning jika menjadi contract aplikasi.
14. Compatibility matrix lebih penting daripada sekadar “latest version”.
15. Default yang kuat untuk seri ini adalah timestamp + module + action + object.

---

## 44. What Comes Next

Part berikutnya:

```text
04-flyway-mental-model.md
```

Kita akan masuk ke Flyway dari mental model dulu, bukan langsung konfigurasi.

Kita akan bahas:

- Flyway sebagai ordered migration runner,
- versioned migration,
- repeatable migration,
- undo migration,
- baseline,
- validate,
- repair,
- clean,
- checksum,
- schema history table,
- placeholder,
- callback,
- Java-based migration,
- kapan Flyway cocok dan kapan tidak.

---

# End of Part 3

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Migration Invariants and Failure Models](./02-migration-invariants-and-failure-models.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 4 — Flyway Mental Model](./04-flyway-mental-model.md)

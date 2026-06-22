# Part 7 — Flyway Repeatable Migrations

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> File: `07-flyway-repeatable-migrations.md`  
> Scope: Java 8–25, Flyway, SQL migration engineering, repeatable database object management  
> Status seri: Part 7 dari 34 — **seri belum selesai**

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu memahami **Flyway repeatable migration** bukan hanya sebagai fitur bernama `R__something.sql`, tetapi sebagai mekanisme untuk mengelola **database object definition yang mutable secara source-code**, sambil tetap menjaga database history, reviewability, dan production safety.

Bagian ini akan menjawab pertanyaan praktis dan arsitektural berikut:

1. Apa bedanya versioned migration dan repeatable migration?
2. Mengapa repeatable migration tidak punya versi?
3. Kapan repeatable migration cocok dipakai?
4. Kapan repeatable migration justru menjadi anti-pattern?
5. Bagaimana repeatable migration dieksekusi, diurutkan, dan divalidasi oleh Flyway?
6. Bagaimana cara mendesain repeatable migration untuk view, function, procedure, trigger, package, dan materialized view?
7. Bagaimana hubungan repeatable migration dengan seed data?
8. Bagaimana menghindari masalah checksum, dependency ordering, dan environment drift?
9. Bagaimana membuat repeatable migration aman untuk production?
10. Bagaimana berpikir seperti engineer senior ketika database object selalu berubah tetapi migration history harus tetap konsisten?

---

## 1. Core Mental Model

### 1.1 Versioned Migration Adalah “Event History”

Versioned migration menjawab pertanyaan:

> “Perubahan apa yang pernah terjadi terhadap database, dalam urutan waktu tertentu?”

Contoh:

```text
V001__create_customer_table.sql
V002__add_customer_email_column.sql
V003__create_customer_email_index.sql
V004__backfill_customer_email.sql
```

Setiap file adalah **event**. Setelah event terjadi, file tersebut seharusnya tidak diubah lagi.

Jika `V002__add_customer_email_column.sql` sudah pernah dijalankan di production, mengedit file itu setelahnya berarti mengubah sejarah. Database production tidak otomatis tahu bahwa isi file lama berubah. Flyway akan mendeteksi checksum mismatch dan menganggap ini sebagai sinyal bahaya.

Versioned migration cocok untuk:

- Membuat tabel.
- Menambah kolom.
- Mengubah struktur schema.
- Membuat index.
- Membuat constraint.
- Melakukan backfill versi tertentu.
- Mengubah data dengan efek historis tertentu.

Karakteristiknya:

```text
Versioned migration = immutable historical event
```

---

### 1.2 Repeatable Migration Adalah “Current Definition”

Repeatable migration menjawab pertanyaan berbeda:

> “Definisi database object saat ini seharusnya seperti apa?”

Contoh:

```text
R__customer_search_view.sql
R__customer_status_summary_view.sql
R__calculate_customer_risk_score_function.sql
R__audit_case_change_trigger.sql
```

Untuk object seperti view, procedure, function, trigger, atau package, yang sering kita inginkan bukan menulis sejarah perubahan kecil satu per satu:

```text
V010__create_customer_search_view.sql
V011__add_phone_to_customer_search_view.sql
V012__fix_customer_search_view_join.sql
V013__add_risk_score_to_customer_search_view.sql
V014__remove_legacy_status_from_customer_search_view.sql
```

Secara historis itu valid, tetapi dalam jangka panjang definisi object menjadi tersebar di banyak file. Untuk memahami bentuk view saat ini, engineer harus membaca rantai perubahan dari `V010` sampai `V014`.

Repeatable migration memindahkan modelnya menjadi:

```text
R__customer_search_view.sql
```

Isi file tersebut selalu merepresentasikan **definisi final terkini**.

Karakteristiknya:

```text
Repeatable migration = mutable current-state definition
```

---

### 1.3 Perbedaan Paling Penting

| Aspek | Versioned Migration | Repeatable Migration |
|---|---|---|
| Tujuan | Merekam event perubahan historis | Menyimpan definisi terkini |
| Nama file | `V<version>__description.sql` | `R__description.sql` |
| Punya versi? | Ya | Tidak |
| Dieksekusi | Sekali per versi | Setiap checksum berubah |
| Boleh diedit setelah apply? | Tidak, kecuali belum pernah masuk shared/prod DB | Ya, memang didesain untuk diedit |
| Cocok untuk | DDL/DML historis | View, procedure, function, trigger, package |
| Risiko utama | Checksum mismatch jika diubah | Re-run tidak sadar karena checksum berubah |
| Cara berpikir | Event sourcing | Desired state |

---

## 2. Cara Flyway Menjalankan Repeatable Migration

Menurut dokumentasi Flyway, repeatable migration dijalankan ulang saat checksum-nya berubah. Repeatable migration berguna untuk database object yang definisinya dipelihara dalam satu file, seperti view, procedure, function, package, dan bulk reference data reinserts. Flyway juga menjelaskan bahwa repeatable migration tidak memiliki versi, melainkan description dan checksum. Dalam satu run, repeatable migration dijalankan setelah pending versioned migrations, dan urutannya berdasarkan description.

Sumber utama:

- Redgate Flyway documentation — Repeatable migrations: <https://documentation.red-gate.com/fd/repeatable-migrations-273973335.html>
- Flyway documentation source — migrations concept: <https://github.com/flyway/flywaydb.org/blob/gh-pages/documentation/concepts/migrations.md>

Secara mental, alurnya seperti ini:

```text
flyway migrate
   |
   |-- scan migration locations
   |
   |-- identify versioned migrations: V...
   |
   |-- identify repeatable migrations: R...
   |
   |-- compare with flyway_schema_history
   |
   |-- apply pending versioned migrations in version order
   |
   |-- apply repeatable migrations whose checksum changed
   |      in description order
   |
   |-- record execution in flyway_schema_history
```

---

## 3. Naming Convention

### 3.1 Basic Pattern

Default repeatable migration naming pattern:

```text
R__description.sql
```

Contoh:

```text
R__customer_search_view.sql
R__case_listing_view.sql
R__calculate_penalty_function.sql
R__audit_application_change_trigger.sql
R__refresh_reporting_views.sql
```

Ingat:

- Prefix default: `R`
- Separator default: `__`
- Tidak ada version number.
- Description dipakai untuk ordering.

---

### 3.2 Description Bukan Sekadar Nama Cantik

Karena repeatable migration diurutkan berdasarkan description, nama file harus dianggap sebagai bagian dari dependency control.

Buruk:

```text
R__view_customer.sql
R__function_risk_score.sql
R__view_customer_risk.sql
```

Masalah:

- Urutan alfabetis tidak jelas dari dependency.
- View mungkin membutuhkan function yang belum dibuat.
- Engineer harus menebak dependency dari isi file.

Lebih baik:

```text
R__001_function_calculate_customer_risk_score.sql
R__010_view_customer_base.sql
R__020_view_customer_risk_summary.sql
R__030_view_customer_search.sql
```

Ini bukan version number historis. Ini adalah **ordering prefix** untuk repeatable object layer.

---

### 3.3 Rekomendasi Naming untuk Sistem Besar

Untuk sistem enterprise multi-module, gunakan pola:

```text
R__<order>_<module>_<object_type>_<object_name>.sql
```

Contoh:

```text
R__001_common_function_normalize_text.sql
R__010_case_view_case_base.sql
R__020_case_view_case_listing.sql
R__030_case_view_case_dashboard.sql
R__040_case_function_calculate_case_age.sql
R__050_case_view_case_sla_summary.sql
R__100_audit_trigger_case_audit_trg.sql
```

Aturan praktis:

| Prefix range | Makna |
|---|---|
| `001–099` | Common utility objects |
| `100–199` | Core domain views/functions |
| `200–299` | Reporting views |
| `300–399` | Integration views |
| `400–499` | Audit/logging triggers |
| `900–999` | Last-mile compatibility objects |

Tujuannya bukan membuat numbering kompleks, tetapi membuat dependency terlihat dari nama file.

---

## 4. Apa yang Cocok Menjadi Repeatable Migration?

### 4.1 View

View adalah kandidat paling natural.

Contoh PostgreSQL:

```sql
CREATE OR REPLACE VIEW customer_search_view AS
SELECT
    c.id,
    c.customer_no,
    c.full_name,
    c.email,
    c.status,
    c.created_at
FROM customer c
WHERE c.deleted_at IS NULL;
```

Mengapa cocok?

- View adalah object definition.
- Definisi view sering berubah mengikuti kebutuhan query/reporting.
- Engineer ingin melihat definisi terkini dalam satu file.
- `CREATE OR REPLACE VIEW` biasanya mendukung model desired-state.

Namun ada batasan:

- Tidak semua database mengizinkan perubahan struktur view tertentu via `CREATE OR REPLACE` tanpa drop.
- Jika view memiliki dependent objects, replace bisa gagal.
- Jika permission/grant hilang setelah replace/drop-create, harus dikelola.

---

### 4.2 Stored Procedure

Stored procedure juga cocok.

Contoh SQL Server style:

```sql
CREATE OR ALTER PROCEDURE dbo.recalculate_customer_score
    @customer_id BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.customer
    SET risk_score = (
        SELECT COUNT(*)
        FROM dbo.customer_case cc
        WHERE cc.customer_id = @customer_id
          AND cc.status = 'OPEN'
    )
    WHERE id = @customer_id;
END;
```

Mengapa cocok?

- Procedure adalah executable database object.
- Definisinya dapat berubah berkali-kali.
- Sering lebih mudah direview sebagai satu current definition.

Risiko:

- Procedure bisa berisi business logic tersembunyi.
- Dependency terhadap table/column harus dikelola.
- Error baru bisa muncul saat runtime jika procedure tidak dites.

---

### 4.3 Function

Function sangat cocok, terutama untuk logic yang memang harus hidup di database.

Contoh PostgreSQL:

```sql
CREATE OR REPLACE FUNCTION normalize_text(input_text TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT lower(trim(input_text));
$$;
```

Perhatian:

- Function volatility (`IMMUTABLE`, `STABLE`, `VOLATILE`) harus benar.
- Return type change bisa tidak kompatibel.
- Dependency dari view/procedure terhadap function harus diurutkan.

---

### 4.4 Trigger

Trigger bisa dikelola sebagai repeatable migration, tetapi harus lebih hati-hati.

Contoh konseptual:

```sql
CREATE OR REPLACE FUNCTION audit_customer_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO audit_trail(entity_name, entity_id, action_type, changed_at)
    VALUES ('customer', NEW.id, TG_OP, now());

    RETURN NEW;
END;
$$;
```

Lalu trigger attachment:

```sql
DROP TRIGGER IF EXISTS customer_audit_trg ON customer;

CREATE TRIGGER customer_audit_trg
AFTER INSERT OR UPDATE ON customer
FOR EACH ROW
EXECUTE FUNCTION audit_customer_change();
```

Catatan penting:

- Trigger function dan trigger attachment bisa dipisahkan.
- Function definition cocok repeatable.
- Trigger attachment kadang lebih cocok versioned jika attach/detach adalah event schema.
- Drop-create trigger harus dipastikan tidak membuka window inconsistent behavior dalam production migration.

---

### 4.5 Oracle Package

Untuk Oracle-heavy system, package adalah kandidat repeatable yang sangat natural.

Umumnya dipisah:

```text
R__010_pkg_case_service_spec.sql
R__011_pkg_case_service_body.sql
```

Kenapa spec dan body dipisah?

- Package body bergantung pada package spec.
- Spec change bisa menyebabkan invalidation lebih luas.
- Body lebih sering berubah daripada spec.

Mental model:

```text
Package spec = public contract
Package body = implementation
```

Jika spec berubah, perlakukan seperti API contract change. Jangan dianggap sekadar edit kecil.

---

### 4.6 Materialized View

Materialized view bisa dikelola dengan repeatable migration, tetapi lebih rumit daripada normal view.

Pertanyaan sebelum memakai repeatable migration untuk materialized view:

1. Apakah database mendukung `CREATE OR REPLACE MATERIALIZED VIEW`?
2. Apakah refresh strategy akan terganggu?
3. Apakah dependent index/grant/comment harus dibuat ulang?
4. Apakah drop-create akan menghapus data materialized view dan menyebabkan refresh berat?
5. Apakah downtime acceptable?

Sering kali, materialized view butuh kombinasi:

```text
Versioned migration:
- create base table/index/log structure
- introduce materialized view first time
- change refresh configuration

Repeatable migration:
- maintain query definition when safe
```

---

### 4.7 Bulk Reference Data Reinsert

Dokumentasi Flyway menyebut bulk reference data reinserts sebagai salah satu penggunaan repeatable migration. Tetapi ini harus dipahami dengan hati-hati.

Repeatable seed data hanya aman jika:

- Data benar-benar reference/static.
- Natural key stabil.
- Tidak ada user production yang boleh mengubah data tersebut.
- Script deterministic.
- Re-run tidak menghapus data user.
- Ada strategy untuk removed/renamed values.

Contoh relatif aman:

```sql
MERGE INTO country c
USING (
    SELECT 'ID' AS code, 'Indonesia' AS name FROM dual UNION ALL
    SELECT 'SG' AS code, 'Singapore' AS name FROM dual UNION ALL
    SELECT 'MY' AS code, 'Malaysia' AS name FROM dual
) src
ON (c.code = src.code)
WHEN MATCHED THEN
    UPDATE SET c.name = src.name
WHEN NOT MATCHED THEN
    INSERT (code, name)
    VALUES (src.code, src.name);
```

Contoh berbahaya:

```sql
DELETE FROM role_permission;
INSERT INTO role_permission(role_id, permission_id) VALUES (...);
```

Masalah:

- Bisa menghapus permission yang sudah diubah production.
- Bisa menghapus tenant-specific config.
- Bisa merusak auditability.
- Bisa menyebabkan privilege berubah tanpa approval jelas.

Untuk seed data, seri ini akan masuk jauh lebih detail di Part 17 dan Part 18.

---

## 5. Apa yang Tidak Cocok Menjadi Repeatable Migration?

### 5.1 Table Creation

Buruk:

```text
R__customer_table.sql
```

Isi:

```sql
CREATE TABLE customer (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);
```

Kenapa buruk?

- Table creation adalah historical schema event.
- Setelah table ada, perubahan berikutnya harus eksplisit.
- Repeatable migration akan gagal saat re-run jika tidak idempotent.
- Jika dibuat idempotent dengan `CREATE TABLE IF NOT EXISTS`, perubahan definisi tidak otomatis diterapkan.

Table creation harus versioned:

```text
V001__create_customer_table.sql
V002__add_customer_email_column.sql
V003__add_customer_status_index.sql
```

---

### 5.2 Column Addition

Buruk:

```text
R__customer_columns.sql
```

Isi:

```sql
ALTER TABLE customer ADD email VARCHAR(255);
```

Masalah:

- `ALTER TABLE ADD` bukan desired-state definition.
- Jika checksum berubah, script bisa re-run dan gagal.
- Jika dibuat conditional, history menjadi tidak jelas.

Kolom adalah schema evolution event. Gunakan versioned migration.

---

### 5.3 Backfill Data

Buruk:

```text
R__backfill_customer_email.sql
```

Isi:

```sql
UPDATE customer
SET email_normalized = lower(email)
WHERE email IS NOT NULL;
```

Kenapa buruk?

- Backfill adalah event data transformation.
- Harus punya titik waktu yang jelas.
- Harus bisa diaudit kapan dilakukan.
- Re-run karena checksum berubah bisa mengubah data production ulang.
- Bisa mahal secara performance.

Backfill biasanya harus versioned atau dijalankan sebagai controlled batch job.

---

### 5.4 One-Time Data Correction

Buruk:

```text
R__fix_invalid_customer_status.sql
```

Isi:

```sql
UPDATE customer
SET status = 'ACTIVE'
WHERE status = 'ACTVE';
```

Ini bukan current definition. Ini adalah correction event.

Gunakan:

```text
V042__fix_invalid_customer_status_typo.sql
```

Atau batch job dengan evidence/audit.

---

### 5.5 Environment-Specific Mutation

Buruk:

```text
R__dev_test_admin_user.sql
```

Isi:

```sql
INSERT INTO app_user(username, password_hash)
VALUES ('admin', '...');
```

Masalah:

- Password/secret tidak boleh hidup dalam migration repo.
- Environment-specific behavior membuat repeatability palsu.
- Production risk jika context salah.

Gunakan provisioning terpisah, secret management, atau seed dengan context yang sangat jelas.

---

## 6. Ordering dan Dependency Management

### 6.1 Repeatable Migration Selalu Setelah Pending Versioned Migration

Dalam satu run, pending versioned migrations dieksekusi lebih dulu. Setelah itu, repeatable migrations yang berubah dieksekusi.

Implikasi penting:

Jika kamu punya versioned migration yang membutuhkan function dari repeatable migration yang belum pernah ada, ini bisa gagal.

Contoh:

```text
V010__create_invoice_table.sql
V011__create_invoice_trigger.sql
R__calculate_invoice_total_function.sql
```

Jika `V011` membuat trigger yang mereferensikan function dari `R__...`, versioned migration bisa gagal karena repeatable belum dijalankan.

Solusi:

1. Buat function pertama kali sebagai versioned migration.
2. Setelah object ada, maintain definisi berikutnya via repeatable migration.

Contoh:

```text
V010__create_invoice_table.sql
V011__create_calculate_invoice_total_function_initial.sql
V012__create_invoice_trigger.sql
R__001_function_calculate_invoice_total.sql
```

Ini terlihat duplikatif, tetapi secara lifecycle masuk akal:

- `V011` menjamin object tersedia saat schema event membutuhkan object itu.
- `R__001` menjadi source of truth terkini untuk definisi function setelah seluruh versioned migration pending selesai.

Alternatif lain:

```text
V011__create_invoice_function_and_trigger.sql
```

Lalu di release berikutnya baru diperkenalkan repeatable function.

---

### 6.2 Repeatable Diurutkan Berdasarkan Description

Contoh:

```text
R__010_function_normalize_text.sql
R__020_view_customer_base.sql
R__030_view_customer_search.sql
```

Urutan eksekusi:

```text
010 function
020 base view
030 search view
```

Jika `customer_search_view` bergantung pada `customer_base_view`, prefix membantu memastikan urutan benar.

Tanpa prefix:

```text
R__customer_search_view.sql
R__customer_base_view.sql
```

Urutan alfabetis bisa membuat dependent view dibuat sebelum base view.

---

### 6.3 Jangan Membuat Dependency Graph Terlalu Rumit

Repeatable migration bukan build system untuk database object graph kompleks.

Jika kamu punya puluhan view yang saling bergantung secara dalam:

```text
view_a -> view_b -> view_c -> function_d -> view_e -> package_f
```

Itu tanda desain database object layer perlu dirapikan.

Strategi:

- Pisahkan base views dan presentation/reporting views.
- Kurangi chained views terlalu dalam.
- Jangan membuat view bergantung pada view bergantung pada view terlalu banyak.
- Gunakan naming prefix per layer.
- Dokumentasikan dependency besar.

Contoh layer:

```text
R__010_common_function_*.sql
R__100_base_view_*.sql
R__200_domain_view_*.sql
R__300_reporting_view_*.sql
R__900_compatibility_view_*.sql
```

---

## 7. Checksum: Kekuatan dan Sumber Masalah

### 7.1 Apa Itu Checksum dalam Konteks Repeatable

Flyway menghitung checksum dari isi migration. Untuk repeatable migration:

- Jika belum pernah dijalankan: dijalankan.
- Jika pernah dijalankan dan checksum sama: dilewati.
- Jika pernah dijalankan dan checksum berubah: dijalankan ulang.

Mental model:

```text
file content changed -> checksum changed -> repeatable migration becomes pending again
```

---

### 7.2 Perubahan Komentar Bisa Memicu Re-run

Jika checksum dihitung dari isi file, perubahan kecil seperti komentar, whitespace, atau formatting dapat menyebabkan checksum berubah, tergantung detail parsing dan konfigurasi.

Contoh:

```sql
-- add comment only
CREATE OR REPLACE VIEW customer_search_view AS
SELECT id, name FROM customer;
```

Meskipun object definition sama secara semantik, Flyway bisa menganggap file berubah.

Implikasi:

- Jangan mengubah repeatable migration untuk kosmetik ketika tidak perlu.
- Formatting massal bisa menyebabkan banyak repeatable re-run.
- Review PR harus sadar bahwa perubahan comment/format bisa punya efek production.

---

### 7.3 Placeholder Dapat Mempengaruhi Checksum

Jika repeatable migration memakai placeholder, perubahan placeholder dapat membuat migration re-run.

Contoh:

```sql
CREATE OR REPLACE VIEW app_config_view AS
SELECT '${environment}' AS environment_name;
```

Masalah:

- Environment berbeda bisa menghasilkan checksum berbeda.
- Repeatable migration bisa terus dianggap berubah antar environment.
- Schema history menjadi sulit dibandingkan.

Gunakan placeholder untuk repeatable migration dengan sangat hati-hati.

Aturan praktis:

```text
Repeatable migration should usually be environment-neutral.
```

Jika benar-benar butuh environment-specific object, pertimbangkan:

- Separate migration location per environment.
- Explicit operational script.
- Runtime configuration table yang diisi oleh deployment config, bukan migration object definition.

---

### 7.4 Checksum Mismatch vs Repeatable Re-application

Untuk versioned migration, checksum berubah setelah apply adalah masalah serius.

Untuk repeatable migration, checksum berubah adalah sinyal normal untuk re-apply.

Tabel mental:

| Migration type | Checksum berubah setelah apply | Makna |
|---|---|---|
| Versioned | Biasanya error/validate failure | History diubah |
| Repeatable | Normal | Current definition berubah dan perlu re-run |

Karena itu, review discipline untuk repeatable berbeda:

- Versioned migration: “Apakah file lama diedit?”
- Repeatable migration: “Apakah definisi baru aman dijalankan ulang?”

---

## 8. Pattern untuk View

### 8.1 Basic View Pattern

```sql
CREATE OR REPLACE VIEW case_listing_view AS
SELECT
    c.id,
    c.case_no,
    c.status,
    c.created_at,
    c.updated_at
FROM case_record c
WHERE c.deleted_at IS NULL;
```

Checklist:

- View name stable.
- Column alias explicit.
- Tidak memakai `SELECT *`.
- Join eksplisit.
- Filter lifecycle jelas.
- Tidak menyembunyikan business rule yang terlalu besar.

---

### 8.2 Jangan Pakai `SELECT *`

Buruk:

```sql
CREATE OR REPLACE VIEW customer_view AS
SELECT * FROM customer;
```

Kenapa buruk?

- Tambah kolom di table bisa mengubah view contract diam-diam.
- Aplikasi/reporting consumer bisa menerima kolom baru tanpa review.
- Column order bisa menjadi tidak stabil.
- Dependency analysis menjadi buruk.

Lebih baik:

```sql
CREATE OR REPLACE VIEW customer_view AS
SELECT
    id,
    customer_no,
    full_name,
    email,
    status,
    created_at
FROM customer;
```

---

### 8.3 Stable Contract View

Untuk view yang dipakai aplikasi, treat view seperti API contract.

Contoh:

```sql
CREATE OR REPLACE VIEW customer_api_v1_view AS
SELECT
    c.id AS customer_id,
    c.customer_no AS customer_number,
    c.full_name AS display_name,
    c.status AS status_code
FROM customer c;
```

Jika ingin breaking change, jangan langsung ubah view yang sama.

Gunakan:

```text
customer_api_v1_view
customer_api_v2_view
```

Lalu migrasikan consumer secara bertahap.

---

### 8.4 Compatibility View

Compatibility view berguna saat table diubah tetapi old app masih butuh contract lama.

Skenario:

Sebelumnya:

```text
customer.full_name
```

Akan dipecah menjadi:

```text
customer.first_name
customer.last_name
```

Compatibility view:

```sql
CREATE OR REPLACE VIEW customer_legacy_view AS
SELECT
    id,
    customer_no,
    trim(first_name || ' ' || last_name) AS full_name,
    status
FROM customer;
```

Ini sangat berguna dalam expand/contract migration.

---

## 9. Pattern untuk Function

### 9.1 Pure Utility Function

Function pure dan deterministic adalah kandidat repeatable yang baik.

```sql
CREATE OR REPLACE FUNCTION normalize_email(input_email TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT lower(trim(input_email));
$$;
```

Cocok karena:

- Tidak punya side effect.
- Mudah dites.
- Mudah direview.
- Dependency jelas.

---

### 9.2 Business Function

Function yang mengandung business rule harus lebih hati-hati.

```sql
CREATE OR REPLACE FUNCTION calculate_case_priority(
    severity TEXT,
    submitted_at TIMESTAMP
)
RETURNS INTEGER
LANGUAGE SQL
STABLE
AS $$
    SELECT
        CASE
            WHEN severity = 'HIGH' THEN 100
            WHEN submitted_at < now() - interval '7 days' THEN 80
            ELSE 50
        END;
$$;
```

Pertanyaan review:

1. Apakah business rule ini memang harus di database?
2. Apakah perubahan function akan mengubah hasil report/audit lama?
3. Apakah function dipakai index expression?
4. Apakah function dipakai generated column?
5. Apakah function dipakai trigger?
6. Apakah ada test data yang memvalidasi hasilnya?

---

### 9.3 Function Signature Change

Mengubah body function relatif aman. Mengubah signature lebih berbahaya.

Contoh breaking:

```sql
-- lama
calculate_case_priority(severity TEXT)

-- baru
calculate_case_priority(severity TEXT, submitted_at TIMESTAMP)
```

Jika view/procedure lama masih memanggil signature lama, re-run repeatable bisa gagal atau runtime bisa error.

Strategi aman:

1. Tambah function baru tanpa menghapus lama.
2. Migrasikan dependent objects.
3. Migrasikan aplikasi.
4. Hapus function lama di versioned migration contract phase.

Contoh:

```text
R__010_function_calculate_case_priority_v1.sql
R__011_function_calculate_case_priority_v2.sql
V120__drop_calculate_case_priority_v1_after_contract.sql
```

---

## 10. Pattern untuk Procedure

### 10.1 Procedure sebagai Database Operation

Procedure sering dipakai untuk operation yang harus dekat dengan database.

Contoh:

```sql
CREATE OR REPLACE PROCEDURE recalculate_case_statistics()
LANGUAGE SQL
AS $$
    UPDATE case_summary cs
    SET open_case_count = src.open_count
    FROM (
        SELECT owner_id, COUNT(*) AS open_count
        FROM case_record
        WHERE status = 'OPEN'
        GROUP BY owner_id
    ) src
    WHERE cs.owner_id = src.owner_id;
$$;
```

Pertanyaan review:

- Apakah procedure idempotent?
- Apakah procedure akan lock banyak row?
- Apakah procedure bisa dijalankan ulang aman?
- Apakah procedure punya transaction boundary jelas?
- Apakah procedure digunakan oleh aplikasi, scheduler, atau manual DBA?

---

### 10.2 Procedure Definition vs Procedure Execution

Ini distinction penting.

Repeatable migration cocok untuk:

```text
Define procedure
```

Repeatable migration biasanya tidak cocok untuk:

```text
Execute procedure to mutate production data
```

Buruk:

```sql
CREATE OR REPLACE PROCEDURE fix_data() ...;
CALL fix_data();
```

Jika checksum berubah, procedure akan dipanggil ulang. Ini bisa sangat berbahaya.

Pisahkan:

```text
R__100_procedure_recalculate_case_statistics.sql
V120__execute_case_statistics_recalculation_once.sql
```

Atau jalankan execution sebagai controlled job.

---

## 11. Pattern untuk Trigger

### 11.1 Trigger Function Repeatable, Attachment Versioned

Untuk database seperti PostgreSQL, biasanya lebih baik:

```text
R__100_function_audit_customer_change.sql
V050__attach_customer_audit_trigger.sql
```

Kenapa?

- Function logic bisa berubah berulang kali.
- Trigger attachment adalah schema event.
- Attach/detach trigger sering punya konsekuensi operasional.

---

### 11.2 Drop-Create Trigger Risk

Beberapa database tidak punya `CREATE OR REPLACE TRIGGER`. Pola yang sering dipakai:

```sql
DROP TRIGGER IF EXISTS customer_audit_trg ON customer;
CREATE TRIGGER customer_audit_trg ...;
```

Risiko:

- Jika migration gagal setelah drop sebelum create, trigger hilang.
- Jika ada concurrent transaction, behavior bisa tidak konsisten.
- Jika trigger terkait compliance/audit, window tanpa trigger mungkin tidak acceptable.

Mitigasi:

- Jalankan dalam transaction jika database mendukung transactional DDL.
- Gunakan versioned migration dengan maintenance window untuk trigger critical.
- Tambahkan post-check validation.
- Jangan drop trigger audit kritikal sembarangan.

---

## 12. Pattern untuk Oracle Package

### 12.1 Package Spec dan Body

Struktur:

```text
R__010_case_pkg_spec.sql
R__011_case_pkg_body.sql
```

Spec:

```sql
CREATE OR REPLACE PACKAGE case_pkg AS
    FUNCTION calculate_case_age(p_case_id IN NUMBER) RETURN NUMBER;
END case_pkg;
/
```

Body:

```sql
CREATE OR REPLACE PACKAGE BODY case_pkg AS
    FUNCTION calculate_case_age(p_case_id IN NUMBER) RETURN NUMBER IS
        v_created_date DATE;
    BEGIN
        SELECT created_date
        INTO v_created_date
        FROM case_record
        WHERE id = p_case_id;

        RETURN TRUNC(SYSDATE - v_created_date);
    END calculate_case_age;
END case_pkg;
/
```

Perhatian:

- Oracle sering butuh delimiter `/` untuk PL/SQL block.
- Spec harus dieksekusi sebelum body.
- Invalid objects harus dicek setelah migration.
- Grants dan synonyms mungkin perlu dikelola.

---

### 12.2 Invalid Object Check

Setelah repeatable package/view/function, production runbook harus punya check:

```sql
SELECT object_name, object_type, status
FROM user_objects
WHERE status <> 'VALID';
```

Atau untuk schema tertentu:

```sql
SELECT owner, object_name, object_type, status
FROM all_objects
WHERE owner = 'APP_SCHEMA'
  AND status <> 'VALID';
```

Invalid object bukan selalu immediate deployment failure, tetapi bisa menjadi runtime failure.

---

## 13. Repeatable Migration dan Seed Data

### 13.1 Seed Data Adalah Area Abu-Abu

Flyway documentation menyebut bulk reference data reinserts sebagai possible use case. Tetapi dalam sistem enterprise, tidak semua seed data aman dianggap repeatable.

Klasifikasi sederhana:

| Data type | Repeatable cocok? | Catatan |
|---|---:|---|
| Country list | Bisa | Jika benar-benar static dan controlled |
| Currency list | Bisa | Perlu lifecycle untuk obsolete code |
| Role-permission | Hati-hati | Bisa merusak privilege production |
| Admin user | Tidak | Secret/security risk |
| Feature flag | Biasanya tidak | Runtime config sering mutable |
| Tenant config | Tidak umum | Tenant-specific drift |
| Test data | Tidak untuk prod | Pisahkan location/context |
| Lookup status internal | Bisa | Jika app-owned dan immutable-ish |

---

### 13.2 Safe Repeatable Seed Pattern

Contoh PostgreSQL:

```sql
INSERT INTO ref_case_status(code, display_name, sort_order, active)
VALUES
    ('DRAFT', 'Draft', 10, true),
    ('SUBMITTED', 'Submitted', 20, true),
    ('PROCESSING', 'Processing', 30, true),
    ('CLOSED', 'Closed', 40, true)
ON CONFLICT (code)
DO UPDATE SET
    display_name = EXCLUDED.display_name,
    sort_order = EXCLUDED.sort_order,
    active = EXCLUDED.active;
```

Syarat aman:

- `code` adalah natural key stable.
- Data dimiliki aplikasi, bukan user.
- Update semantics eksplisit.
- Tidak menghapus data tanpa strategi deprecation.

---

### 13.3 Dangerous Repeatable Seed Pattern

```sql
TRUNCATE TABLE ref_case_status;

INSERT INTO ref_case_status(code, display_name)
VALUES
    ('DRAFT', 'Draft'),
    ('SUBMITTED', 'Submitted'),
    ('CLOSED', 'Closed');
```

Masalah:

- Bisa melanggar foreign key.
- Bisa reset metadata.
- Bisa menghapus value production yang masih dipakai.
- Bisa menyebabkan outage jika table dipakai transaksi aktif.

---

### 13.4 Deleting Seed Data

Menghapus seed data lebih berbahaya daripada menambah.

Daripada delete:

```sql
DELETE FROM ref_case_status WHERE code = 'ARCHIVED';
```

Lebih aman:

```sql
UPDATE ref_case_status
SET active = false,
    deprecated_at = CURRENT_TIMESTAMP
WHERE code = 'ARCHIVED';
```

Delete hanya aman jika:

- Tidak ada referensi aktif.
- Sudah ada data cleanup.
- Sudah ada validation query.
- Sudah ada approval.
- Dilakukan sebagai versioned migration contract phase.

---

## 14. Repeatable Migration dalam Java Project

### 14.1 Classpath Layout

Default Flyway location biasanya:

```text
src/main/resources/db/migration
```

Struktur contoh:

```text
src/main/resources/db/migration/
  V001__create_customer_table.sql
  V002__create_case_table.sql
  V003__add_case_status_index.sql
  R__001_common_function_normalize_text.sql
  R__010_case_view_case_base.sql
  R__020_case_view_case_listing.sql
```

Untuk sistem besar, bisa dipisah:

```text
src/main/resources/db/migration/versioned/
src/main/resources/db/migration/repeatable/
```

Lalu konfigurasi Flyway locations:

```properties
flyway.locations=classpath:db/migration/versioned,classpath:db/migration/repeatable
```

Namun pastikan tim memahami ordering global tetap berlaku berdasarkan scanning dan naming, bukan folder semata.

---

### 14.2 Spring Boot Concern

Dalam Spring Boot, Flyway migration biasanya dijalankan saat application startup sebelum database-dependent beans digunakan.

Untuk repeatable migration, ini berarti:

- Perubahan view/function bisa terjadi saat app start.
- Jika repeatable gagal, app gagal start.
- Jika beberapa pod start bersamaan, Flyway lock harus mengatur concurrency.
- Startup time bisa meningkat jika banyak repeatable re-run.

Rekomendasi production untuk sistem serius:

```text
Prefer external migration job before application rollout
```

Terutama jika repeatable migration:

- Membuat view kompleks.
- Recompile package besar.
- Rebuild materialized view.
- Menyentuh grants/synonyms.
- Mengubah object yang dipakai banyak service.

---

### 14.3 Java 8 sampai Java 25 Concern

Repeatable migration sendiri tidak terlalu bergantung pada versi Java, tetapi toolchain dan integrasi iya.

Pertanyaan compatibility:

1. Versi Flyway yang dipakai masih mendukung runtime Java project?
2. Apakah project Java 8 memakai Flyway versi lama karena modern Flyway butuh Java lebih baru?
3. Apakah migration dijalankan via CLI container sehingga tidak terikat runtime aplikasi?
4. Apakah build plugin berjalan di JDK berbeda dari runtime aplikasi?
5. Apakah driver database compatible dengan JDK yang dipakai?

Strategi umum:

| Project runtime | Strategi migration |
|---|---|
| Java 8 legacy | Pertimbangkan Flyway versi compatible atau jalankan CLI eksternal |
| Java 11 | Masih bisa app-integrated atau external job, tergantung versi Flyway |
| Java 17 | Cocok untuk modern toolchain |
| Java 21 | Cocok untuk modern Spring Boot/Jakarta stack |
| Java 25 | Treat as modern LTS/current toolchain, validasi driver/plugin |

Untuk enterprise, memisahkan migration runtime dari app runtime sering mengurangi coupling.

---

## 15. Review Checklist untuk Repeatable Migration

Setiap PR yang mengubah `R__*.sql` harus menjawab pertanyaan berikut.

### 15.1 Semantics

- Apakah file ini benar-benar current object definition?
- Apakah ini bukan one-time event?
- Apakah perubahan ini aman dijalankan ulang?
- Apakah ada side effect data mutation?
- Apakah object ini dipakai aplikasi runtime?

### 15.2 Dependency

- Apakah dependent table/column sudah ada sebelum repeatable dijalankan?
- Apakah dependent function/view/package dibuat lebih dulu?
- Apakah ordering prefix benar?
- Apakah ada circular dependency?
- Apakah ada object downstream yang bisa invalid?

### 15.3 Compatibility

- Apakah perubahan ini backward compatible dengan versi aplikasi lama?
- Apakah deployment blue/green/canary aman?
- Apakah old pod dan new pod bisa sama-sama berjalan?
- Apakah view column rename/removal berisiko breaking?
- Apakah function signature berubah?

### 15.4 Operational Safety

- Apakah script bisa lock object terlalu lama?
- Apakah create/replace akan invalidate banyak object?
- Apakah materialized view refresh akan berat?
- Apakah trigger drop-create membuka audit gap?
- Apakah migration bisa dijalankan saat traffic aktif?

### 15.5 Observability

- Apakah ada validation query?
- Apakah ada invalid object check?
- Apakah log Flyway cukup?
- Apakah runbook menjelaskan recovery jika gagal?
- Apakah perubahan bisa diverifikasi tanpa membaca seluruh app?

---

## 16. Production Runbook Pattern

Untuk repeatable migration yang signifikan, gunakan runbook minimal berikut.

### 16.1 Before Migration

```text
1. Confirm target app release.
2. Confirm database backup/restore point policy.
3. Run Flyway validate.
4. List repeatable migrations whose checksum changed.
5. Review changed objects.
6. Check active sessions/locks if object critical.
7. Confirm dependent app version compatibility.
8. Confirm rollback/roll-forward plan.
```

### 16.2 During Migration

```text
1. Run migration from controlled runner.
2. Monitor Flyway logs.
3. Monitor DB locks and long-running statements.
4. Capture migration duration.
5. Stop if unexpected object/data mutation appears.
```

### 16.3 After Migration

```text
1. Run invalid object check.
2. Run smoke query for changed views/functions.
3. Verify flyway_schema_history.
4. Verify application startup.
5. Verify representative business flow.
6. Record deployment evidence.
```

---

## 17. Failure Scenarios

### 17.1 Repeatable View Fails Because Column Does Not Exist

Skenario:

```sql
CREATE OR REPLACE VIEW customer_search_view AS
SELECT id, email_normalized FROM customer;
```

Tetapi column `email_normalized` belum ada di environment tertentu.

Kemungkinan penyebab:

- Missing versioned migration.
- Branch migration conflict.
- Out-of-order environment.
- Manual drift.

Recovery:

1. Jangan edit history sembarangan.
2. Jalankan `flyway info`.
3. Compare applied versioned migrations.
4. Pastikan migration penambah column ada dan pending/applied benar.
5. Jika environment drift, repair dengan migration baru atau controlled manual correction plus schema history alignment.

---

### 17.2 Repeatable Function Fails Because Signature Conflict

Skenario:

```sql
CREATE OR REPLACE FUNCTION calculate_score(input_id BIGINT)
RETURNS INTEGER
...
```

Database menolak replace karena return type berubah atau dependent object masih memakai signature lama.

Recovery:

- Buat function baru dengan name/signature berbeda.
- Update dependent objects.
- Drop old function di versioned migration setelah aman.

---

### 17.3 Repeatable Re-run Takes Too Long

Skenario:

Engineer melakukan formatting terhadap 50 repeatable files. Semua checksum berubah. Production deployment menjalankan ulang banyak view/package/materialized view.

Masalah:

- Deployment lambat.
- Object invalidation luas.
- Lock meningkat.
- App startup delay.

Prevention:

- Jangan mass-format repeatable migration tanpa alasan.
- Batasi PR repeatable object changes.
- Review `flyway info` sebelum deploy.
- Pisahkan cosmetic change dari functional change.

---

### 17.4 Repeatable Seed Overwrites Production Config

Skenario:

```sql
MERGE INTO app_config ...
WHEN MATCHED THEN UPDATE SET value = src.value;
```

Production admin mengubah config lewat UI. Deploy berikutnya mengembalikan nilai dari seed.

Masalah:

- Source of truth tidak jelas.
- Migration melawan runtime administration.
- Config drift dianggap salah padahal mungkin expected.

Solusi desain:

- Tentukan ownership setiap config.
- App-owned immutable config boleh di-seed.
- User/admin-owned mutable config tidak boleh di-overwrite oleh repeatable seed.
- Gunakan config provisioning terpisah.

---

## 18. Anti-Patterns

### 18.1 Repeatable as Mutable Versioned Migration

Buruk:

```text
R__all_schema_changes.sql
```

Isi terus ditambah:

```sql
ALTER TABLE customer ADD email VARCHAR(255);
ALTER TABLE customer ADD phone VARCHAR(50);
ALTER TABLE customer ADD address VARCHAR(500);
```

Ini menghancurkan histori.

Gunakan versioned migration.

---

### 18.2 Repeatable with Non-Idempotent DML

Buruk:

```sql
INSERT INTO permission(code, name)
VALUES ('CASE_APPROVE', 'Approve Case');
```

Jika re-run, bisa duplicate atau gagal.

Minimal gunakan natural key/upsert jika memang repeatable seed.

---

### 18.3 Repeatable with Time-Dependent Values

Buruk:

```sql
CREATE OR REPLACE VIEW deployment_info_view AS
SELECT CURRENT_TIMESTAMP AS deployed_at;
```

Atau seed:

```sql
INSERT INTO config(key, value, created_at)
VALUES ('X', 'Y', CURRENT_TIMESTAMP);
```

Masalah:

- Tidak deterministic.
- Re-run menghasilkan hasil berbeda.
- Sulit audit.

---

### 18.4 Repeatable with Environment Branching

Buruk:

```sql
-- pseudo
IF environment = 'prod' THEN
   create prod view
ELSE
   create dev view
END IF;
```

Migration harus sebisa mungkin environment-neutral.

Jika perlu environment-specific, buat strategy eksplisit, bukan hidden branching.

---

### 18.5 Repeatable That Calls External System

Buruk dalam Java-based repeatable migration:

```text
Call API -> fetch config -> update DB object/data
```

Masalah:

- Non-deterministic.
- External dependency bisa down.
- Re-run behavior tidak stabil.
- Audit sulit.

Migration harus deterministic dan self-contained sejauh mungkin.

---

## 19. Best Practice Summary

### 19.1 Use Repeatable For

Gunakan repeatable migration untuk:

- View definition.
- Function definition.
- Stored procedure definition.
- Oracle package spec/body.
- Trigger function logic.
- Safe, deterministic, app-owned reference data reinserts.
- Compatibility view.
- Database API layer object.

---

### 19.2 Avoid Repeatable For

Hindari repeatable migration untuk:

- Table creation.
- Column addition/removal.
- Constraint introduction.
- Index creation yang historis.
- One-time backfill.
- Data correction.
- Mutable production config.
- Admin user/password creation.
- Tenant-specific data mutation.
- Long-running batch transformation.

---

### 19.3 Design Rules

```text
Rule 1: Repeatable migration should represent current object definition.
Rule 2: Repeatable migration must be safe to run again when checksum changes.
Rule 3: Repeatable migration should be environment-neutral.
Rule 4: Repeatable migration should not hide one-time data events.
Rule 5: Repeatable migration ordering must be explicit through naming.
Rule 6: Repeatable migration should be reviewed as production executable code.
Rule 7: Repeatable migration must preserve app/database compatibility during rollout.
```

---

## 20. Example Repository Structure

```text
learn-java-database-migrations-seedings-flyway-liquibase/
  app/
    src/main/java/...
    src/main/resources/
      db/
        migration/
          V001__create_customer_table.sql
          V002__create_case_table.sql
          V003__add_case_status.sql
          V004__create_audit_trail_table.sql

          R__001_common_function_normalize_text.sql
          R__010_customer_view_customer_base.sql
          R__020_customer_view_customer_search.sql
          R__100_case_function_calculate_case_age.sql
          R__110_case_view_case_listing.sql
          R__200_audit_function_audit_case_change.sql
```

Alternative for large systems:

```text
src/main/resources/db/migration/
  versioned/
    V001__create_customer_table.sql
    V002__create_case_table.sql
  repeatable/
    common/
      R__001_common_function_normalize_text.sql
    customer/
      R__010_customer_view_customer_base.sql
      R__020_customer_view_customer_search.sql
    case/
      R__100_case_function_calculate_case_age.sql
      R__110_case_view_case_listing.sql
```

Catatan:

Folder membantu organisasi manusia, tetapi ordering repeatable tetap harus jelas dari nama file.

---

## 21. Worked Example: Customer Search View Evolution

### 21.1 Initial Schema

```text
V001__create_customer_table.sql
```

```sql
CREATE TABLE customer (
    id BIGINT PRIMARY KEY,
    customer_no VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL
);
```

### 21.2 Initial Repeatable View

```text
R__010_customer_view_customer_search.sql
```

```sql
CREATE OR REPLACE VIEW customer_search_view AS
SELECT
    id,
    customer_no,
    full_name,
    email,
    status,
    created_at
FROM customer;
```

### 21.3 New Requirement: Add Normalized Email

Wrong approach:

```sql
CREATE OR REPLACE VIEW customer_search_view AS
SELECT
    id,
    customer_no,
    full_name,
    lower(email) AS email_normalized,
    status,
    created_at
FROM customer;
```

This may be fine if no persisted column is needed. But if application needs indexed search, maybe better:

```text
V010__add_customer_email_normalized_column.sql
V011__backfill_customer_email_normalized.sql
V012__create_customer_email_normalized_index.sql
R__010_customer_view_customer_search.sql
```

Updated repeatable view:

```sql
CREATE OR REPLACE VIEW customer_search_view AS
SELECT
    id,
    customer_no,
    full_name,
    email,
    email_normalized,
    status,
    created_at
FROM customer;
```

### 21.4 Compatibility Question

If old app expects view columns:

```text
id, customer_no, full_name, email, status, created_at
```

Adding `email_normalized` is usually backward compatible.

But renaming:

```text
full_name -> display_name
```

is breaking.

Safer:

```sql
CREATE OR REPLACE VIEW customer_search_view AS
SELECT
    id,
    customer_no,
    full_name,
    full_name AS display_name,
    email,
    email_normalized,
    status,
    created_at
FROM customer;
```

Then later contract:

```text
V020__drop_legacy_full_name_from_customer_search_contract.sql
```

But because removing a column from view can break consumers, treat it like API versioning.

---

## 22. Worked Example: Role Permission Seed

### 22.1 Dangerous Naive Repeatable

```text
R__900_seed_role_permissions.sql
```

```sql
DELETE FROM role_permission;

INSERT INTO role_permission(role_code, permission_code)
VALUES
    ('ADMIN', 'CASE_VIEW'),
    ('ADMIN', 'CASE_APPROVE'),
    ('OFFICER', 'CASE_VIEW');
```

This is dangerous.

### 22.2 Safer App-Owned Permission Code Seed

Permission code itself may be app-owned:

```sql
INSERT INTO permission(code, description)
VALUES
    ('CASE_VIEW', 'View case'),
    ('CASE_APPROVE', 'Approve case'),
    ('CASE_REJECT', 'Reject case')
ON CONFLICT (code)
DO UPDATE SET
    description = EXCLUDED.description;
```

But role assignment may be admin-owned:

```text
role_permission = production security configuration
```

So maybe do not overwrite it in repeatable seed.

### 22.3 Better Governance

Split:

```text
R__800_seed_permission_catalog.sql       -- app-owned permission definitions
V120__grant_case_approve_to_admin.sql    -- explicit governed privilege change
```

Privilege changes should often be versioned because they are auditable security events.

---

## 23. Worked Example: Oracle View and Package

```text
R__010_case_pkg_spec.sql
R__011_case_pkg_body.sql
R__020_case_listing_view.sql
```

Package spec:

```sql
CREATE OR REPLACE PACKAGE case_pkg AS
    FUNCTION get_case_age_days(p_case_id IN NUMBER) RETURN NUMBER;
END case_pkg;
/
```

Package body:

```sql
CREATE OR REPLACE PACKAGE BODY case_pkg AS
    FUNCTION get_case_age_days(p_case_id IN NUMBER) RETURN NUMBER IS
        v_created_at DATE;
    BEGIN
        SELECT created_at
        INTO v_created_at
        FROM case_record
        WHERE id = p_case_id;

        RETURN TRUNC(SYSDATE - v_created_at);
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN NULL;
    END get_case_age_days;
END case_pkg;
/
```

View:

```sql
CREATE OR REPLACE VIEW case_listing_view AS
SELECT
    c.id,
    c.case_no,
    c.status,
    case_pkg.get_case_age_days(c.id) AS case_age_days
FROM case_record c;
```

Post-check:

```sql
SELECT object_name, object_type, status
FROM user_objects
WHERE status <> 'VALID';
```

---

## 24. Decision Tree

Gunakan decision tree ini ketika menentukan apakah sebuah script harus repeatable.

```text
Is this a database object definition?
  |
  |-- No --> Usually versioned migration or external job
  |
  |-- Yes
       |
       |-- Is the object naturally maintained as current definition?
       |      |
       |      |-- No --> Versioned migration
       |      |
       |      |-- Yes
       |            |
       |            |-- Is re-apply on checksum change safe?
       |                   |
       |                   |-- No --> Versioned migration or controlled job
       |                   |
       |                   |-- Yes
       |                         |
       |                         |-- Are dependencies ordered and compatible?
       |                                |
       |                                |-- No --> Fix ordering/versioned bootstrap first
       |                                |
       |                                |-- Yes --> Repeatable migration
```

For seed data:

```text
Is this app-owned static reference data?
  |
  |-- No --> Do not use repeatable seed blindly
  |
  |-- Yes
       |
       |-- Is the natural key stable?
       |-- Is update behavior deterministic?
       |-- Is deletion/deprecation handled safely?
       |-- Is production allowed to modify it?

If all safe: repeatable seed may be acceptable.
Otherwise: versioned migration or config provisioning.
```

---

## 25. Engineer-Level Takeaways

Repeatable migration terlihat sederhana, tetapi konsekuensinya besar.

Engineer biasa melihat:

```text
R__ means file can run again.
```

Engineer senior melihat:

```text
R__ means current-state object definition whose checksum controls production re-application.
```

Engineer top-tier bertanya:

1. Apakah ini definisi object atau event historis?
2. Apakah aman jika dijalankan ulang karena komentar berubah?
3. Apakah dependency object stabil?
4. Apakah old app masih compatible?
5. Apakah ini akan menyebabkan object invalidation?
6. Apakah ada seed data yang akan overwrite production state?
7. Apakah migration runtime dipisah dari app startup?
8. Apakah runbook punya validation query?
9. Apakah file ini membantu atau merusak auditability?
10. Apakah ini membuat database lebih mudah dipahami 1 tahun dari sekarang?

---

## 26. Ringkasan

Repeatable migration adalah fitur Flyway untuk mengelola object database yang sifatnya **current definition**, bukan **historical event**.

Gunakan repeatable migration untuk view, function, procedure, package, trigger function, dan sebagian reference data yang benar-benar deterministic. Hindari repeatable migration untuk table evolution, column changes, one-time backfill, data correction, dan mutable production configuration.

Hal paling penting:

```text
Versioned migration preserves history.
Repeatable migration preserves current definition.
```

Jika kamu salah menempatkan event historis ke repeatable migration, kamu kehilangan auditability. Jika kamu salah menempatkan current object definition ke banyak versioned migration, kamu membuat definisi final sulit dipahami.

Top-tier database migration engineering adalah kemampuan memilih model yang tepat untuk perubahan yang tepat.

---

## 27. Referensi

- Redgate Flyway Documentation — Repeatable migrations: <https://documentation.red-gate.com/fd/repeatable-migrations-273973335.html>
- Flyway documentation source — Concepts / migrations: <https://github.com/flyway/flywaydb.org/blob/gh-pages/documentation/concepts/migrations.md>
- Redgate Flyway Documentation — Tutorial Repeatable Migrations: <https://documentation.red-gate.com/fd/tutorial-repeatable-migrations-277579352.html>
- Redgate Flyway Documentation — Callbacks setting: <https://documentation.red-gate.com/fd/flyway-callbacks-setting-277578977.html>

---

## 28. Posisi dalam Seri

Kita sudah menyelesaikan:

- Part 0 — Orientation: Database Change as Engineering Discipline
- Part 1 — Taxonomy of Database Changes
- Part 2 — Migration Invariants and Failure Models
- Part 3 — Versioning Models for Database Schema
- Part 4 — Flyway Mental Model
- Part 5 — Flyway Setup in Java 8–25 Projects
- Part 6 — Flyway SQL Migration Design
- Part 7 — Flyway Repeatable Migrations

Berikutnya:

- Part 8 — Flyway Java-Based Migrations

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./06-flyway-sql-migration-design.md">⬅️ Part 6 — Flyway SQL Migration Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./08-flyway-java-based-migrations.md">Part 8 — Flyway Java-Based Migrations ➡️</a>
</div>

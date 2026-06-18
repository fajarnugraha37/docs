# 18 — Idempotent and Deterministic Seed Design

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Bagian: `18-idempotent-deterministic-seed-design.md`  
> Target: Java 8–25, Flyway, Liquibase, Spring Boot, Jakarta EE, plain Java, enterprise systems  
> Fokus: bagaimana mendesain seed data yang aman dijalankan ulang, deterministik, auditabel, dan tidak menyebabkan drift antar environment.

---

## 1. Posisi Materi Ini dalam Seri

Pada bagian sebelumnya kita sudah membedakan beberapa jenis seed:

- reference data,
- master data,
- bootstrap data,
- permission/role seed,
- tenant seed,
- feature/config seed,
- test fixture,
- environment-specific seed.

Bagian ini masuk lebih dalam pada kualitas desain seed. Pertanyaan utamanya bukan lagi:

> “Bagaimana cara memasukkan data awal?”

Tetapi:

> “Bagaimana membuat data awal aman dijalankan ulang, menghasilkan state yang sama, tidak diam-diam merusak konfigurasi production, dan tetap bisa diaudit setelah sistem berjalan bertahun-tahun?”

Inilah perbedaan antara seed biasa dan seed engineering-grade.

---

## 2. Core Mental Model

Seed data adalah bagian dari **application contract**.

Kode aplikasi sering mengasumsikan bahwa data tertentu sudah ada:

- status `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`,
- role `ADMIN`, `OFFICER`, `SUPERVISOR`,
- permission `CASE_READ`, `CASE_ASSIGN`, `CASE_APPROVE`,
- country `SG`, `ID`, `MY`,
- workflow state,
- notification template,
- system parameter,
- default tenant configuration.

Jika data ini hilang, berbeda, berubah ID, berubah meaning, atau hanya ada di environment tertentu, aplikasi bisa gagal walaupun kode dan schema benar.

Jadi seed bukan data tambahan. Seed adalah **runtime dependency**.

Mental model yang benar:

```text
Application Code
   depends on
Database Schema
   depends on
Reference / Bootstrap / Configuration Data
   depends on
Deterministic Seed Process
   depends on
Migration History + Review + Governance
```

Jika seed tidak deterministik, maka environment tidak bisa dipercaya.

---

## 3. Definisi Idempotent Seed

Seed disebut **idempotent** jika dijalankan berkali-kali tetap menghasilkan state akhir yang sama.

Secara sederhana:

```text
seed(state) = state'
seed(state') = state'
seed(seed(seed(state))) = state'
```

Contoh non-idempotent:

```sql
INSERT INTO role (name) VALUES ('ADMIN');
```

Jika dijalankan dua kali:

- bisa gagal karena unique constraint,
- bisa menghasilkan duplikasi jika tidak ada constraint,
- bisa membuat environment berbeda.

Contoh lebih idempotent:

```sql
INSERT INTO role (code, name)
SELECT 'ADMIN', 'Administrator'
WHERE NOT EXISTS (
    SELECT 1 FROM role WHERE code = 'ADMIN'
);
```

Atau dengan upsert vendor-specific:

```sql
INSERT INTO role (code, name)
VALUES ('ADMIN', 'Administrator')
ON CONFLICT (code)
DO UPDATE SET name = EXCLUDED.name;
```

Tetapi idempotency tidak otomatis berarti aman. Upsert bisa saja overwriting data production yang sudah sengaja dikonfigurasi berbeda.

Idempotency harus selalu dipadukan dengan **ownership model**.

---

## 4. Definisi Deterministic Seed

Seed disebut **deterministic** jika input yang sama selalu menghasilkan output yang sama.

Seed deterministic tidak boleh bergantung pada hal-hal acak atau temporal yang tidak dikontrol:

- `CURRENT_TIMESTAMP` tanpa alasan jelas,
- auto-generated password,
- random UUID runtime,
- sequence-generated ID yang dipakai oleh kode,
- urutan file yang tidak stabil,
- data dari API eksternal,
- local timezone mesin deployment,
- environment variable yang tidak terdokumentasi,
- result query tanpa `ORDER BY` saat membuat derived seed.

Contoh non-deterministic:

```sql
INSERT INTO system_user (id, username, created_at)
VALUES (sys_guid(), 'system', CURRENT_TIMESTAMP);
```

Masalah:

- ID berbeda antar environment,
- timestamp berbeda,
- jika ID dipakai sebagai foreign key seed lain, hasil bisa berbeda,
- sulit dibandingkan antar environment.

Contoh lebih deterministic:

```sql
INSERT INTO system_user (id, username, created_at)
SELECT '00000000-0000-0000-0000-000000000001', 'system', TIMESTAMP '2024-01-01 00:00:00'
WHERE NOT EXISTS (
    SELECT 1 FROM system_user WHERE username = 'system'
);
```

Tentu fixed timestamp bukan selalu benar untuk audit bisnis. Tetapi untuk bootstrap technical account, lebih baik deterministic daripada berpura-pura seolah timestamp seed adalah event bisnis nyata.

---

## 5. Idempotent vs Deterministic: Tidak Sama

Banyak engineer mencampur keduanya. Padahal berbeda.

| Sifat | Pertanyaan | Contoh masalah |
|---|---|---|
| Idempotent | Aman dijalankan ulang? | Insert duplikat role |
| Deterministic | Hasilnya sama untuk input yang sama? | UUID/timestamp berbeda |
| Auditable | Bisa dibuktikan apa yang berubah? | Seed overwrite diam-diam |
| Governed | Jelas siapa pemilik data? | Config production tertimpa |

Contoh idempotent tapi tidak deterministic:

```sql
INSERT INTO feature_flag (code, enabled, created_at)
SELECT 'NEW_DASHBOARD', false, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM feature_flag WHERE code = 'NEW_DASHBOARD'
);
```

Aman dijalankan ulang, tetapi nilai `created_at` berbeda tergantung kapan pertama kali dijalankan.

Contoh deterministic tapi tidak idempotent:

```sql
INSERT INTO role (id, code, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'ADMIN', 'Administrator');
```

Nilainya deterministic, tetapi dijalankan ulang akan gagal jika constraint ada.

Seed production-grade perlu keduanya.

---

## 6. Golden Rule: Stable Natural Key First

Seed harus punya **stable identity**.

Jangan menjadikan auto-increment ID sebagai identitas logis seed.

Buruk:

```sql
INSERT INTO status (name) VALUES ('SUBMITTED');
-- aplikasi menganggap id = 2 adalah SUBMITTED
```

Lebih baik:

```sql
INSERT INTO status (code, name)
VALUES ('SUBMITTED', 'Submitted');
```

Lalu aplikasi memakai `code`, bukan hardcoded numeric ID.

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Dan query:

```sql
SELECT * FROM application WHERE status_code = 'SUBMITTED';
```

Bukan:

```sql
SELECT * FROM application WHERE status_id = 2;
```

Numeric surrogate key boleh ada untuk join/performance, tetapi bukan contract utama antara aplikasi dan seed.

---

## 7. Natural Key vs Surrogate Key

### 7.1 Surrogate Key

Surrogate key adalah key buatan sistem:

- sequence number,
- identity column,
- generated UUID,
- synthetic ID.

Contoh:

```sql
CREATE TABLE role (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL
);
```

`id` bagus untuk foreign key internal. Tetapi untuk seed identity, `code` lebih penting.

### 7.2 Natural Key

Natural key adalah key yang memiliki makna domain atau konfigurasi:

- `role.code`,
- `permission.code`,
- `country.iso_code`,
- `currency.iso_code`,
- `workflow_state.code`,
- `system_parameter.key`,
- `template.code`.

Contoh:

```sql
CREATE TABLE permission (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    code VARCHAR(128) NOT NULL UNIQUE,
    description VARCHAR(500) NOT NULL
);
```

Seed harus ditulis berdasarkan `code`, bukan `id`.

---

## 8. Jangan Mengandalkan Sequence untuk Seed Contract

Anti-pattern:

```sql
INSERT INTO role (name) VALUES ('ADMIN');
INSERT INTO role (name) VALUES ('OFFICER');
INSERT INTO role (name) VALUES ('SUPERVISOR');

INSERT INTO user_role (user_id, role_id) VALUES (1, 1);
```

Masalah:

- `role_id = 1` belum tentu `ADMIN` di semua environment,
- urutan insert bisa berubah,
- data manual bisa sudah ada,
- sequence bisa berbeda antar environment,
- restore partial bisa mengubah state.

Lebih baik:

```sql
INSERT INTO user_role (user_id, role_id)
SELECT u.id, r.id
FROM app_user u
JOIN role r ON r.code = 'ADMIN'
WHERE u.username = 'system'
AND NOT EXISTS (
    SELECT 1
    FROM user_role ur
    WHERE ur.user_id = u.id
      AND ur.role_id = r.id
);
```

Seed relasi harus resolve FK melalui natural key.

---

## 9. Stable UUID: Kapan Berguna?

Ada kasus seed perlu ID stabil, terutama saat:

- data dipakai lintas service,
- data direferensikan oleh konfigurasi eksternal,
- data dikirim ke event/message,
- data harus sama antar environment,
- seed dipakai untuk authorization matrix,
- tenant bootstrap perlu referensi fixed.

Contoh:

```sql
INSERT INTO role (id, code, name)
SELECT '10000000-0000-0000-0000-000000000001', 'ADMIN', 'Administrator'
WHERE NOT EXISTS (
    SELECT 1 FROM role WHERE code = 'ADMIN'
);
```

Tetapi stable UUID harus diperlakukan seperti API contract:

- jangan digenerate ulang,
- jangan berubah karena refactor,
- dokumentasikan di file seed,
- jangan pakai random UUID runtime,
- gunakan namespace/prefix strategy bila banyak module.

Contoh struktur:

```text
10000000-0000-0000-0000-000000000001  role:ADMIN
10000000-0000-0000-0000-000000000002  role:OFFICER
20000000-0000-0000-0000-000000000001  permission:CASE_READ
20000000-0000-0000-0000-000000000002  permission:CASE_ASSIGN
```

---

## 10. Upsert Pattern

Upsert adalah operasi:

```text
if row exists:
    update it
else:
    insert it
```

Upsert sangat berguna untuk seed, tetapi juga berbahaya jika dipakai tanpa ownership.

### 10.1 PostgreSQL `ON CONFLICT`

PostgreSQL mendukung `INSERT ... ON CONFLICT DO UPDATE/DO NOTHING`, sering disebut upsert. Dokumentasi PostgreSQL menjelaskan bahwa `ON CONFLICT DO UPDATE` menentukan aksi update ketika terjadi conflict. Untuk seed, conflict target biasanya natural key seperti `code` atau `key`.

```sql
INSERT INTO role (code, name, description)
VALUES ('ADMIN', 'Administrator', 'Full system administrator')
ON CONFLICT (code)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description;
```

### 10.2 Oracle `MERGE`

Oracle menyediakan `MERGE` untuk memilih row dari source lalu melakukan update atau insert ke target. Dokumentasi Oracle menyatakan bahwa `MERGE` dapat menggabungkan operasi insert, update, dan delete, serta bersifat deterministic: satu target row tidak boleh di-update beberapa kali dalam satu `MERGE` statement.

```sql
MERGE INTO role r
USING (
    SELECT 'ADMIN' AS code,
           'Administrator' AS name,
           'Full system administrator' AS description
    FROM dual
) src
ON (r.code = src.code)
WHEN MATCHED THEN
    UPDATE SET
        r.name = src.name,
        r.description = src.description
WHEN NOT MATCHED THEN
    INSERT (code, name, description)
    VALUES (src.code, src.name, src.description);
```

### 10.3 SQL Server / H2 / MySQL

Vendor berbeda punya variasi:

- SQL Server punya `MERGE`, tetapi perlu hati-hati dengan concurrency dan known pitfalls.
- MySQL punya `INSERT ... ON DUPLICATE KEY UPDATE`.
- H2 bisa meniru beberapa syntax, tetapi jangan jadikan H2 sebagai bukti migration production aman.

Rule penting:

> Seed pattern harus diuji terhadap database engine production, bukan hanya in-memory test database.

---

## 11. Insert-if-not-exists Pattern

Pattern ini hanya insert jika row belum ada.

```sql
INSERT INTO role (code, name)
SELECT 'ADMIN', 'Administrator'
WHERE NOT EXISTS (
    SELECT 1 FROM role WHERE code = 'ADMIN'
);
```

Kelebihan:

- tidak menimpa perubahan existing,
- aman untuk data yang mungkin dikelola admin setelah bootstrap,
- cocok untuk initial default.

Kekurangan:

- jika nilai existing salah, seed tidak memperbaiki,
- drift bisa diam-diam bertahan,
- tidak cocok untuk reference data yang harus controlled by code.

Gunakan untuk:

- initial admin placeholder,
- default tenant config yang boleh dimodifikasi,
- optional bootstrap,
- data yang ownership-nya pindah ke operator/user setelah dibuat.

Jangan gunakan untuk:

- permission matrix yang harus identik,
- status code application contract,
- enum-like lookup,
- system role yang harus selalu sinkron.

---

## 12. Upsert vs Insert-if-not-exists

| Pattern | Cocok untuk | Risiko |
|---|---|---|
| Insert-if-not-exists | default yang boleh dimodifikasi user/operator | drift tidak diperbaiki |
| Upsert | reference/config yang dimiliki aplikasi | overwrite perubahan production |
| Delete-and-reinsert | static small lookup tanpa FK atau dengan full control | merusak FK/audit/history |
| Versioned correction | perubahan data penting yang harus traceable | lebih banyak script |
| Manual admin operation | data production-sensitive | tidak repeatable jika tidak diaudit |

Tidak ada satu pattern untuk semua seed.

Decision rule:

```text
Jika data dimiliki aplikasi dan harus sama di semua environment:
    gunakan controlled upsert/versioned seed.
Jika data hanya default awal dan boleh berubah setelah deploy:
    gunakan insert-if-not-exists.
Jika data sangat sensitif production:
    jangan auto-overwrite; gunakan migration eksplisit + approval.
```

---

## 13. Delete-and-Reinsert: Kenapa Berbahaya?

Pattern yang sering terlihat:

```sql
DELETE FROM status;

INSERT INTO status (code, name) VALUES ('DRAFT', 'Draft');
INSERT INTO status (code, name) VALUES ('SUBMITTED', 'Submitted');
INSERT INTO status (code, name) VALUES ('APPROVED', 'Approved');
```

Masalah besar:

- bisa gagal karena foreign key,
- bisa menghapus row yang sedang dipakai transaksi bisnis,
- bisa reset metadata audit,
- bisa mengganti surrogate ID,
- bisa menghapus extension data production,
- bisa menyebabkan cascade delete jika FK salah desain,
- bisa memicu trigger side effect,
- bisa menghancurkan referential history.

Delete-and-reinsert hanya relatif aman jika:

- tabel benar-benar static,
- tidak direferensikan transaction table,
- tidak punya audit history penting,
- seed dikelola penuh oleh aplikasi,
- operasi dilakukan dalam controlled migration,
- ada validasi before/after.

Bahkan untuk static lookup, lebih sering lebih aman memakai upsert berbasis natural key.

---

## 14. Seed Ownership Model

Sebelum menulis seed, jawab pertanyaan ini:

> Siapa pemilik authoritative row ini setelah dibuat?

Ada beberapa model.

### 14.1 Code-Owned Seed

Data dimiliki source code.

Contoh:

- workflow state,
- permission code,
- system role,
- enum-like status,
- error code mapping,
- internal system parameter yang tidak boleh diedit.

Karakter:

- harus sama antar environment,
- perubahan harus lewat PR/migration,
- boleh di-upsert,
- harus direview seperti code.

### 14.2 Operator-Owned Seed

Data awal dibuat oleh seed, tetapi setelah itu dikelola operator/admin.

Contoh:

- default email template,
- default SLA config,
- default branch office,
- default assignment group,
- default tenant setting.

Karakter:

- insert-if-not-exists lebih aman,
- jangan overwrite tanpa explicit migration,
- perlu drift report, bukan auto-repair diam-diam.

### 14.3 Environment-Owned Seed

Data berbeda antar environment.

Contoh:

- endpoint external system,
- sandbox credential reference,
- mock integration toggle,
- test-only user.

Karakter:

- jangan dicampur dengan production seed,
- gunakan context/profile/label/placeholder dengan sangat disiplin,
- jangan menanam secret di seed,
- harus terlihat jelas bahwa ini environment-specific.

### 14.4 User-Owned Data

Data dibuat user/bisnis.

Contoh:

- application/case/transaction,
- customer profile,
- document,
- approval record,
- payment record.

Karakter:

- bukan seed,
- jangan disentuh seed,
- perubahan harus berupa data correction/backfill dengan audit ketat.

---

## 15. Seed Classification Matrix

Gunakan matrix ini saat review PR seed.

| Data | Owned by | Pattern | Boleh overwrite? | Example |
|---|---|---|---|---|
| Status code | Code | Upsert/versioned | Ya, jika field controlled | `SUBMITTED` |
| Permission code | Code | Upsert/versioned | Ya | `CASE_APPROVE` |
| Role-permission mapping | Code/governance | Upsert/sync carefully | Tergantung policy | `OFFICER -> CASE_READ` |
| Email template | Operator after bootstrap | Insert-if-not-exists | Tidak otomatis | `CASE_APPROVED_EMAIL` |
| Feature flag | Product/operator | Insert-if-not-exists or explicit change | Tidak diam-diam | `NEW_UI_ENABLED` |
| Tenant config | Tenant/operator | Insert-if-not-exists | Tidak otomatis | `defaultTimezone` |
| Country/currency | Code/reference | Upsert or controlled sync | Ya untuk canonical fields | `ID`, `SGD` |
| Test user | Test env | Context/profile only | N/A | `qa_admin` |
| Secret | Secret manager | Jangan seed plaintext | Tidak | password/API key |

---

## 16. Seed Data as Contract with Java Code

Di Java, seed sering berhubungan dengan enum, constant, atau authorization annotation.

Contoh enum:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Database:

```sql
CREATE TABLE case_status (
    code VARCHAR(64) PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    terminal BOOLEAN NOT NULL
);
```

Seed:

```sql
INSERT INTO case_status (code, display_name, terminal)
VALUES ('DRAFT', 'Draft', false)
ON CONFLICT (code)
DO UPDATE SET
    display_name = EXCLUDED.display_name,
    terminal = EXCLUDED.terminal;
```

Contract:

```text
Java enum constant name == database status code
```

Jika salah satu berubah, harus ada migration plan.

Anti-pattern:

```java
if (caseEntity.getStatusId() == 3L) {
    approve();
}
```

Better:

```java
if (caseEntity.hasStatus(CaseStatus.APPROVED)) {
    approve();
}
```

Top-tier approach:

- code menggunakan symbolic code,
- database menyimpan stable code,
- seed memastikan code tersedia,
- test memverifikasi enum dan seed sinkron.

---

## 17. Testing Enum-to-Seed Consistency

Untuk Java system, buat test yang membandingkan enum dengan database seed.

Contoh pseudo-test:

```java
@Test
void allCaseStatusEnumValuesExistInDatabase() {
    Set<String> enumCodes = Arrays.stream(CaseStatus.values())
            .map(Enum::name)
            .collect(Collectors.toSet());

    Set<String> dbCodes = jdbcTemplate.queryForList(
            "select code from case_status",
            String.class
    ).stream().collect(Collectors.toSet());

    assertThat(dbCodes).containsAll(enumCodes);
}
```

Lebih kuat lagi:

```java
@Test
void databaseDoesNotContainUnknownCaseStatusCodes() {
    Set<String> enumCodes = Arrays.stream(CaseStatus.values())
            .map(Enum::name)
            .collect(Collectors.toSet());

    Set<String> dbCodes = jdbcTemplate.queryForList(
            "select code from case_status where code not like 'CUSTOM_%'",
            String.class
    ).stream().collect(Collectors.toSet());

    assertThat(dbCodes).isEqualTo(enumCodes);
}
```

Tetapi hati-hati: jika database boleh punya configurable status tambahan, test tidak boleh terlalu ketat.

---

## 18. Seed Checksum Table

Untuk seed yang penting, migration history Flyway/Liquibase saja kadang tidak cukup.

Kenapa?

Karena migration history menjawab:

> Script apa yang pernah dijalankan?

Tetapi kadang kita juga perlu menjawab:

> Apakah data seed saat ini masih sesuai canonical definition?

Maka bisa dibuat table tambahan:

```sql
CREATE TABLE seed_registry (
    seed_key VARCHAR(128) PRIMARY KEY,
    seed_version VARCHAR(64) NOT NULL,
    checksum VARCHAR(128) NOT NULL,
    applied_at TIMESTAMP NOT NULL,
    applied_by VARCHAR(128) NOT NULL
);
```

Contoh:

```text
seed_key      = permission-matrix
seed_version  = 2026.06.17.01
checksum      = sha256(permission_matrix.csv)
applied_at    = deployment timestamp
applied_by    = flyway/liquibase pipeline user
```

Ini berguna untuk:

- permission matrix besar,
- role mapping,
- workflow transition seed,
- notification template seed,
- system parameter pack,
- tenant bootstrap pack.

Tetapi jangan over-engineer untuk semua hal kecil. Gunakan ketika drift detection penting.

---

## 19. Drift: Masalah Nyata Seed Production

Seed drift terjadi ketika data seed antar environment berbeda.

Contoh:

```text
DEV:
  ROLE.ADMIN.name = Administrator

UAT:
  ROLE.ADMIN.name = System Administrator

PROD:
  ROLE.ADMIN.name = Admin
```

Atau lebih berbahaya:

```text
DEV:
  OFFICER has CASE_APPROVE = false

PROD:
  OFFICER has CASE_APPROVE = true
```

Penyebab drift:

- manual update di database,
- seed script lama diubah setelah apply,
- upsert tidak konsisten,
- environment-specific override tidak terdokumentasi,
- production hotfix tidak di-backport ke repo,
- generated IDs berbeda,
- test data bercampur dengan seed,
- operator mengubah data yang seharusnya code-owned.

Seed design yang bagus harus punya jawaban untuk drift:

- apakah drift boleh?
- siapa boleh mengubah?
- apakah pipeline harus memperbaiki?
- apakah pipeline hanya melaporkan?
- apakah drift harus block deployment?

---

## 20. Drift Detection Strategy

Untuk data code-owned, drift harus dideteksi otomatis.

Contoh query sederhana:

```sql
SELECT code, name, description
FROM role
ORDER BY code;
```

Hasil dibandingkan dengan canonical file:

```text
seed/role.csv
seed/permission.csv
seed/role_permission.csv
```

Pendekatan:

1. Extract current DB seed.
2. Sort deterministically.
3. Normalize whitespace/null.
4. Compare with canonical seed definition.
5. Fail pipeline or produce report.

Contoh normalization rule:

```text
NULL      -> <NULL>
''        -> <EMPTY>
trim?     -> only if business says whitespace irrelevant
ordering  -> by natural key
boolean   -> true/false canonical
```

Jangan compare dump mentah tanpa normalization karena noise akan tinggi.

---

## 21. Seed Source Format

Seed bisa ditulis dalam berbagai format:

- SQL file,
- CSV,
- JSON,
- YAML,
- XML,
- Java code,
- Liquibase changelog,
- Flyway Java migration.

Tidak ada format universal. Pilih berdasarkan jenis data.

### 21.1 SQL Seed

Cocok untuk:

- simple lookup,
- static reference,
- database-specific upsert,
- small controlled data.

Kelebihan:

- langsung terlihat oleh DBA,
- explicit,
- mudah direview untuk DDL/DML sederhana.

Kekurangan:

- verbose untuk matrix besar,
- vendor-specific,
- sulit validasi kompleks,
- raw string mudah typo.

### 21.2 CSV Seed

Cocok untuk:

- permission matrix,
- country/currency list,
- role mapping,
- status transition matrix.

Kelebihan:

- mudah diff,
- mudah dibandingkan,
- bisa generate SQL,
- cocok untuk canonical data.

Kekurangan:

- butuh loader,
- type handling terbatas,
- comment/metadata terbatas.

### 21.3 JSON/YAML Seed

Cocok untuk:

- nested configuration,
- workflow definition,
- template metadata,
- tenant bootstrap pack.

Kelebihan:

- ekspresif,
- cocok untuk hierarchical data,
- bisa divalidasi schema.

Kekurangan:

- diff bisa noisy,
- ordering harus disiplin,
- YAML rawan ambiguity jika tidak strict.

### 21.4 Java Seed Loader

Cocok untuk:

- complex transformation,
- validation-heavy seed,
- cross-table seed,
- data derived from canonical file.

Kelebihan:

- bisa validasi kuat,
- bisa reusable,
- bisa testable.

Kekurangan:

- bisa menjadi business logic tersembunyi,
- lebih sulit direview DBA,
- harus hati-hati transaction/chunking.

---

## 22. Canonical Seed File Pattern

Untuk data kompleks, pisahkan canonical definition dari execution mechanism.

Contoh:

```text
src/main/resources/db/seed/canonical/
  roles.csv
  permissions.csv
  role-permissions.csv
  workflow-states.csv
  workflow-transitions.csv

src/main/resources/db/migration/
  V2026_06_17_001__seed_roles.sql
  V2026_06_17_002__seed_permissions.sql
  V2026_06_17_003__seed_role_permissions.sql
```

Atau:

```text
src/main/resources/db/migration/
  V2026_06_17_001__load_permission_matrix.java

src/main/resources/db/seed/
  permission-matrix.csv
```

Keuntungan:

- canonical data bisa direview terpisah,
- loader bisa reusable,
- checksum bisa dihitung dari canonical file,
- drift detection lebih mudah,
- business reviewer bisa membaca CSV tanpa membaca SQL panjang.

---

## 23. Environment Overlay Pattern

Beberapa seed perlu berbeda antar environment.

Contoh:

```text
base:
  FEATURE_X_ENABLED = false

dev:
  FEATURE_X_ENABLED = true

prod:
  FEATURE_X_ENABLED = false
```

Struktur:

```text
seed/
  base/system-parameters.yaml
  env/dev/system-parameters.yaml
  env/uat/system-parameters.yaml
  env/prod/system-parameters.yaml
```

Rule penting:

1. Base selalu berlaku untuk semua environment.
2. Overlay hanya boleh override key yang explicitly allowed.
3. Overlay harus kecil.
4. Secret tidak boleh ada di overlay file repo.
5. Perbedaan prod harus intentional dan direview.

Anti-pattern:

```text
seed-dev.sql
seed-uat.sql
seed-prod.sql
```

Jika ketiganya berisi copy-paste besar dengan sedikit beda, drift hampir pasti terjadi.

Lebih baik:

```text
base seed + minimal overlay
```

---

## 24. Secret Seed Anti-Pattern

Jangan seed secret plaintext ke database lewat migration.

Buruk:

```sql
INSERT INTO integration_config (code, api_key)
VALUES ('PAYMENT_GATEWAY', 'sk_live_xxxxxx');
```

Masalah:

- secret masuk git history,
- secret masuk artifact,
- secret muncul di log migration,
- secret masuk backup database,
- secret bisa terbaca reviewer yang tidak berhak,
- rotasi sulit,
- melanggar least privilege.

Lebih baik simpan reference:

```sql
INSERT INTO integration_config (code, secret_ref)
VALUES ('PAYMENT_GATEWAY', 'ssm:/prod/payment-gateway/api-key');
```

Atau:

```sql
INSERT INTO integration_config (code, secret_name)
VALUES ('PAYMENT_GATEWAY', 'payment-gateway-api-key');
```

Secret value harus dikelola oleh secret manager:

- AWS Secrets Manager,
- AWS SSM Parameter Store,
- HashiCorp Vault,
- Kubernetes Secret dengan governance,
- cloud provider secret store lain.

Seed hanya boleh menyimpan metadata/reference, bukan secret value.

---

## 25. Generated Password Seed Anti-Pattern

Buruk:

```sql
INSERT INTO app_user (username, password_hash)
VALUES ('admin', 'default-password-hash');
```

Atau lebih buruk:

```java
String password = RandomStringUtils.randomAlphanumeric(16);
insertAdmin(passwordEncoder.encode(password));
log.info("Generated admin password: {}", password);
```

Masalah:

- default credential bisa bocor,
- password random tidak bisa direproduksi,
- jika hilang, admin tidak bisa login,
- jika logged, secret bocor,
- jika sama di semua environment, attack surface besar.

Lebih baik:

- bootstrap admin disabled by default,
- use external identity provider,
- first admin provisioned via secure operational process,
- password reset flow,
- break-glass account dengan controlled secret manager,
- no default password in migration.

Jika benar-benar perlu bootstrap user:

```sql
INSERT INTO app_user (username, enabled, auth_provider, external_subject)
SELECT 'system-admin', false, 'EXTERNAL_IDP', 'pending'
WHERE NOT EXISTS (
    SELECT 1 FROM app_user WHERE username = 'system-admin'
);
```

Lalu aktivasi dilakukan lewat proses terpisah yang diaudit.

---

## 26. Timestamp Handling in Seed

Timestamp seed harus jelas semantiknya.

Pertanyaan:

> Apakah timestamp ini event bisnis nyata, atau hanya metadata teknis saat seed dibuat?

Untuk audit column seperti `created_at`, sering ada pilihan:

### Option A — Fixed Technical Timestamp

```sql
created_at = TIMESTAMP '2026-01-01 00:00:00'
```

Cocok jika:

- data adalah static seed,
- timestamp tidak punya makna bisnis,
- ingin deterministic antar environment.

### Option B — Migration Execution Timestamp

```sql
created_at = CURRENT_TIMESTAMP
```

Cocok jika:

- ingin tahu kapan seed masuk environment tersebut,
- tidak dipakai untuk equality comparison,
- drift report menormalisasi field ini.

### Option C — Separate Field

```sql
created_at = CURRENT_TIMESTAMP,
seed_version = '2026.06.17.01'
```

Lebih baik untuk audit.

Rule:

- Jangan pakai timestamp runtime untuk field yang dipakai sebagai business rule.
- Jangan compare timestamp non-deterministic dalam drift detection kecuali dinormalisasi.
- Jangan berpura-pura timestamp seed adalah user-created event.

---

## 27. Handling Mutable Fields

Tidak semua kolom seed harus di-update setiap run.

Contoh table:

```sql
CREATE TABLE email_template (
    code VARCHAR(128) PRIMARY KEY,
    subject VARCHAR(255) NOT NULL,
    body CLOB NOT NULL,
    editable BOOLEAN NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

Jika template boleh diedit admin di production, jangan lakukan ini:

```sql
ON CONFLICT (code)
DO UPDATE SET
    subject = EXCLUDED.subject,
    body = EXCLUDED.body;
```

Karena setiap deploy akan menimpa edit admin.

Lebih aman:

```sql
INSERT INTO email_template (code, subject, body, editable, created_at, updated_at)
VALUES ('CASE_APPROVED', 'Case Approved', '...', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (code)
DO NOTHING;
```

Atau jika ingin mengubah template versi baru:

```sql
-- explicit migration with business approval
UPDATE email_template
SET subject = 'Application Approved',
    body = '...',
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'CASE_APPROVED'
  AND editable = false;
```

Design principle:

```text
Controlled fields boleh di-upsert.
Operator-owned fields tidak boleh di-overwrite diam-diam.
```

---

## 28. Partial Upsert Pattern

Kadang sebagian kolom code-owned, sebagian operator-owned.

Contoh:

```sql
CREATE TABLE feature_flag (
    code VARCHAR(128) PRIMARY KEY,
    description VARCHAR(500) NOT NULL,
    default_enabled BOOLEAN NOT NULL,
    current_enabled BOOLEAN NOT NULL,
    owner VARCHAR(128) NOT NULL
);
```

Code-owned:

- `code`,
- `description`,
- `default_enabled`,
- `owner`.

Operator-owned:

- `current_enabled`.

Upsert harus hanya update controlled columns:

```sql
INSERT INTO feature_flag (
    code,
    description,
    default_enabled,
    current_enabled,
    owner
)
VALUES (
    'NEW_CASE_DASHBOARD',
    'New dashboard for case officers',
    false,
    false,
    'case-platform'
)
ON CONFLICT (code)
DO UPDATE SET
    description = EXCLUDED.description,
    default_enabled = EXCLUDED.default_enabled,
    owner = EXCLUDED.owner;
```

Perhatikan: `current_enabled` tidak di-update saat conflict.

Ini pattern penting untuk production.

---

## 29. Seed Deletion Strategy

Bagaimana jika seed tidak lagi diperlukan?

Misalnya permission lama:

```text
CASE_LEGACY_APPROVE
```

Jangan langsung delete tanpa analisis.

Pertanyaan:

1. Apakah masih direferensikan role?
2. Apakah masih direferensikan audit trail?
3. Apakah masih dipakai historical authorization record?
4. Apakah masih ada user session/token lama berisi permission itu?
5. Apakah aplikasi versi lama masih berjalan saat rolling deployment?
6. Apakah report historical masih membutuhkan label permission itu?

Strategi:

### 29.1 Soft Deprecate

```sql
UPDATE permission
SET deprecated = true,
    active = false
WHERE code = 'CASE_LEGACY_APPROVE';
```

### 29.2 Remove Mapping First

```sql
DELETE FROM role_permission
WHERE permission_id = (
    SELECT id FROM permission WHERE code = 'CASE_LEGACY_APPROVE'
);
```

### 29.3 Delete Later

Hapus setelah yakin tidak ada dependency.

```sql
DELETE FROM permission
WHERE code = 'CASE_LEGACY_APPROVE'
  AND NOT EXISTS (
      SELECT 1 FROM role_permission rp
      WHERE rp.permission_id = permission.id
  );
```

Top-tier approach biasanya prefer deprecate dulu, delete belakangan.

---

## 30. Role-Permission Seed Design

Permission matrix adalah seed yang sangat sensitif.

Buruk:

```sql
INSERT INTO role_permission (role_id, permission_id)
VALUES (1, 12);
```

Lebih baik:

```sql
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code = 'CASE_READ'
WHERE r.code = 'OFFICER'
AND NOT EXISTS (
    SELECT 1
    FROM role_permission rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
);
```

Tetapi permission matrix punya pertanyaan ownership:

- Apakah role-permission full controlled by code?
- Apakah admin boleh mengubah role-permission di UI?
- Apakah seed harus sync exact matrix?
- Apakah seed hanya menambahkan missing baseline permission?
- Apakah production override allowed?

Jika full controlled by code, Anda bisa menerapkan sync strategy:

```text
canonical matrix = source of truth
DB matrix must equal canonical matrix
extra mapping should be removed or flagged
missing mapping should be added
```

Jika admin boleh modify, seed hanya boleh bootstrap:

```text
insert missing baseline only
never delete existing operator changes automatically
```

Jangan mencampur dua model.

---

## 31. Exact Sync vs Additive Seed

### 31.1 Exact Sync

Database harus sama persis dengan canonical seed.

Cocok untuk:

- permission matrix controlled by code,
- workflow transition controlled by release,
- internal system status.

Risiko:

- menghapus production customization,
- perlu approval kuat,
- perlu drift detection.

### 31.2 Additive Seed

Seed hanya menambah data yang kurang.

Cocok untuk:

- default role,
- default template,
- tenant bootstrap,
- optional configuration.

Risiko:

- tidak memperbaiki drift,
- stale data menumpuk,
- environment bisa berbeda.

Decision:

```text
Jika data adalah contract aplikasi:
    exact sync atau controlled upsert.
Jika data adalah default awal untuk operator:
    additive seed.
```

---

## 32. Seed for Workflow Systems

Untuk sistem case management/regulatory/enforcement lifecycle, seed sering berupa workflow state dan transition.

Contoh:

```sql
workflow_state:
  DRAFT
  SUBMITTED
  UNDER_REVIEW
  APPROVED
  REJECTED
  CLOSED

workflow_transition:
  DRAFT -> SUBMITTED
  SUBMITTED -> UNDER_REVIEW
  UNDER_REVIEW -> APPROVED
  UNDER_REVIEW -> REJECTED
  APPROVED -> CLOSED
  REJECTED -> CLOSED
```

Ini bukan sekadar lookup. Ini adalah business control plane.

Design requirement:

- state code stable,
- transition deterministic,
- authorization mapping jelas,
- old cases tetap bisa membaca historical state,
- state removal sangat berisiko,
- transition removal bisa memblokir cases in-flight,
- versioning workflow perlu dipikirkan.

Seed workflow harus memperhatikan in-flight entity.

Misalnya Anda menghapus transition:

```text
UNDER_REVIEW -> REJECTED
```

Dampak:

- case yang sedang `UNDER_REVIEW` tidak bisa reject,
- UI action hilang,
- audit expectation berubah,
- SOP bisnis mungkin dilanggar.

Workflow seed lebih dekat ke domain model daripada static data.

---

## 33. Versioned Workflow Seed

Untuk workflow kompleks, pertimbangkan versioning.

```sql
CREATE TABLE workflow_definition (
    code VARCHAR(128) NOT NULL,
    version INT NOT NULL,
    active BOOLEAN NOT NULL,
    PRIMARY KEY (code, version)
);

CREATE TABLE workflow_state (
    workflow_code VARCHAR(128) NOT NULL,
    workflow_version INT NOT NULL,
    state_code VARCHAR(128) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    PRIMARY KEY (workflow_code, workflow_version, state_code)
);
```

Entity bisnis menyimpan workflow version:

```sql
ALTER TABLE case_record
ADD workflow_code VARCHAR(128),
ADD workflow_version INT;
```

Dengan begitu:

- case lama tetap pakai workflow lama,
- case baru pakai workflow baru,
- migration tidak perlu memaksa semua in-flight case pindah,
- audit lebih defensible.

Ini advanced, tetapi penting untuk regulatory systems.

---

## 34. Seed and Audit Columns

Banyak tabel punya kolom audit:

```sql
created_by
created_at
updated_by
updated_at
version
```

Untuk seed, tentukan convention.

Contoh:

```sql
created_by = 'SYSTEM_MIGRATION'
updated_by = 'SYSTEM_MIGRATION'
```

Jangan pakai user personal:

```sql
created_by = 'fajar'
```

Karena seed bukan tindakan personal user aplikasi. Seed adalah tindakan deployment pipeline.

Better:

```text
created_by = MIGRATION_PIPELINE
updated_by = MIGRATION_PIPELINE
seed_source = V2026_06_17_001__seed_roles.sql
seed_version = 2026.06.17.001
```

Jika audit table merekam perubahan, pastikan seed tidak membanjiri audit dengan noise tanpa nilai. Tapi jangan juga mematikan audit sembarangan di production.

---

## 35. Seed and Optimistic Lock Version

Jika tabel punya `version` untuk optimistic locking:

```sql
version INT NOT NULL
```

Seed harus memberi nilai awal stabil:

```sql
version = 0
```

Untuk upsert, hati-hati.

Buruk:

```sql
ON CONFLICT (code)
DO UPDATE SET
    name = EXCLUDED.name,
    version = version + 1;
```

Jika migration dijalankan ulang, version naik terus. Ini tidak idempotent secara state.

Lebih baik:

```sql
ON CONFLICT (code)
DO UPDATE SET
    name = EXCLUDED.name,
    version = CASE
        WHEN role.name IS DISTINCT FROM EXCLUDED.name THEN role.version + 1
        ELSE role.version
    END;
```

Atau untuk seed code-owned:

```sql
version = 0
```

Tetapi ini bisa konflik dengan ORM expectation jika row diedit aplikasi. Lagi-lagi ownership menentukan.

---

## 36. Avoiding Hidden Business Logic in Seed

Seed harus mendefinisikan data. Seed tidak boleh diam-diam menjalankan keputusan bisnis kompleks.

Buruk:

```sql
UPDATE case_record
SET status = 'CLOSED'
WHERE status = 'PENDING'
  AND created_at < CURRENT_DATE - 90;
```

Ini bukan seed. Ini data correction/business operation.

Masalah:

- efeknya tergantung data production saat itu,
- tidak deterministic,
- bisa mengubah transaksi bisnis,
- butuh approval bisnis,
- harus punya audit dan rollback plan.

Seed harus dibatasi pada data awal/reference/config. Jika menyentuh transactional data, namanya backfill/correction, bukan seed.

---

## 37. Flyway and Seed Design

Flyway punya versioned migration dan repeatable migration. Dokumentasi Flyway menyatakan repeatable migration akan dijalankan ulang ketika checksum berubah, dan cocok untuk object definition seperti view/procedure/function/package; dokumentasi juga menyebut bulk reference data reinsert sebagai salah satu use case repeatable. Namun dalam production enterprise, bulk reference reinserts harus tetap dikontrol oleh ownership dan drift policy.

### 37.1 Flyway Versioned Seed

Cocok untuk:

- perubahan seed historis,
- penambahan permission,
- perubahan status,
- correction eksplisit,
- release-based seed.

Contoh:

```text
V2026_06_17_001__seed_case_status.sql
V2026_06_17_002__seed_case_permissions.sql
V2026_06_17_003__add_case_reopen_permission.sql
```

Kelebihan:

- audit jelas,
- tidak berubah setelah apply,
- cocok untuk production.

### 37.2 Flyway Repeatable Seed

Cocok secara terbatas untuk:

- regenerate static lookup yang full code-owned,
- small reference table tanpa production customization,
- derived view-like reference data.

Risiko:

- checksum berubah sedikit bisa rerun semua,
- bisa overwrite production config,
- ordering after versioned migrations harus dipahami,
- sering disalahgunakan sebagai mutable seed.

Rule:

```text
Untuk production-sensitive seed, prefer versioned migration.
Untuk static generated canonical data, repeatable boleh jika ownership jelas.
```

---

## 38. Liquibase and Seed Design

Liquibase changeset punya identity berupa kombinasi id, author, dan file path. Liquibase juga menyimpan checksum di `DATABASECHANGELOG`. Atribut seperti `runOnChange` membuat changeset dijalankan ulang saat checksum berubah, sedangkan `runAlways` menjalankan changeset setiap update.

### 38.1 Normal Changeset Seed

Cocok untuk versioned seed:

```yaml
databaseChangeLog:
  - changeSet:
      id: 2026-06-17-001-seed-role-admin
      author: platform-team
      changes:
        - sql:
            sql: |
              INSERT INTO role (code, name)
              SELECT 'ADMIN', 'Administrator'
              WHERE NOT EXISTS (
                  SELECT 1 FROM role WHERE code = 'ADMIN'
              );
```

### 38.2 `runOnChange`

Cocok untuk object definition atau seed yang memang canonical dan boleh rerun saat berubah.

Jangan pakai `runOnChange` untuk data yang bisa diedit production admin.

### 38.3 `runAlways`

Sangat hati-hati. Untuk seed, `runAlways` sering salah.

Cocok terbatas untuk:

- session setup,
- metadata update yang memang harus setiap run,
- report/logging command.

Tidak cocok untuk:

- role/permission mutation tanpa guard,
- template overwrite,
- feature flag overwrite,
- tenant config overwrite.

---

## 39. Seed Testing Levels

Seed harus dites di beberapa level.

### 39.1 Syntax Test

Apakah SQL valid?

```text
Run migration on empty real database container.
```

### 39.2 Idempotency Test

Jalankan seed dua kali.

```text
migrate
migrate again
assert no change / no failure
```

Untuk Flyway versioned migration, second run tidak menjalankan file yang sama. Maka idempotency test untuk SQL seed bisa dilakukan dengan test khusus atau repeatable loader.

### 39.3 Determinism Test

Buat dua database fresh, run migration, dump canonical seed, compare.

```text
DB_A after migrate == DB_B after migrate
```

### 39.4 Drift Test

Ubah row secara manual, lalu jalankan drift detector.

Expected:

- code-owned data: drift detected/fixed sesuai policy,
- operator-owned data: drift allowed/reported.

### 39.5 Application Contract Test

Start application setelah migration. Pastikan:

- enum tersedia,
- permission tersedia,
- workflow state tersedia,
- default config tersedia.

---

## 40. Testcontainers Pattern for Seed Validation

Untuk Java, Testcontainers sangat berguna agar seed dites di DB engine nyata.

Pseudo-structure:

```java
@Testcontainers
class MigrationSeedTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Test
    void migrationProducesExpectedSeedData() {
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .load();

        flyway.migrate();

        // assert seed data
    }
}
```

Untuk Java 8, pastikan versi Testcontainers dan driver kompatibel. Untuk Java 17/21/25, pastikan dependency stack modern.

Test harus menggunakan database production-like:

- PostgreSQL untuk PostgreSQL,
- Oracle XE/Free untuk Oracle jika memungkinkan,
- SQL Server container untuk SQL Server,
- MySQL container untuk MySQL.

Jangan puas dengan H2 jika migration production memakai Oracle/PostgreSQL-specific SQL.

---

## 41. Seed Review Checklist

Saat review PR seed, gunakan checklist ini.

### Identity

- Apakah seed punya natural key stabil?
- Apakah kode aplikasi bergantung pada natural key, bukan surrogate ID?
- Apakah FK seed di-resolve via natural key?

### Idempotency

- Apakah script aman dijalankan ulang?
- Apakah ada unique constraint yang mendukung idempotency?
- Apakah upsert conflict target benar?

### Determinism

- Apakah ada random UUID?
- Apakah ada timestamp runtime yang mempengaruhi contract?
- Apakah ordering deterministic?
- Apakah environment-specific input dikontrol?

### Ownership

- Apakah data code-owned, operator-owned, environment-owned, atau user-owned?
- Apakah script overwrite kolom yang seharusnya operator-owned?
- Apakah production customization bisa hilang?

### Security

- Apakah ada secret plaintext?
- Apakah ada default password?
- Apakah seed membuat privileged user?
- Apakah permission baru sudah direview?

### Auditability

- Apakah perubahan punya migration version?
- Apakah seed source jelas?
- Apakah rollback/roll-forward plan ada?
- Apakah drift bisa dideteksi?

### Runtime Safety

- Apakah seed menyentuh tabel besar?
- Apakah ada lock risk?
- Apakah ada FK/cascade risk?
- Apakah delete aman?

---

## 42. Practical Patterns

### 42.1 Static Lookup Upsert

```sql
INSERT INTO case_status (code, display_name, terminal)
VALUES
    ('DRAFT', 'Draft', false),
    ('SUBMITTED', 'Submitted', false),
    ('APPROVED', 'Approved', true),
    ('REJECTED', 'Rejected', true)
ON CONFLICT (code)
DO UPDATE SET
    display_name = EXCLUDED.display_name,
    terminal = EXCLUDED.terminal;
```

Cocok jika `display_name` dan `terminal` code-owned.

### 42.2 Bootstrap-Only Config

```sql
INSERT INTO system_parameter (param_key, param_value, description)
SELECT 'CASE_AUTO_ASSIGN_ENABLED', 'false', 'Enable automatic case assignment'
WHERE NOT EXISTS (
    SELECT 1 FROM system_parameter
    WHERE param_key = 'CASE_AUTO_ASSIGN_ENABLED'
);
```

Cocok jika operator boleh ubah nilai.

### 42.3 Partial Upsert for Feature Flag

```sql
INSERT INTO feature_flag (code, description, default_enabled, current_enabled)
VALUES ('NEW_CASE_DASHBOARD', 'New case dashboard UI', false, false)
ON CONFLICT (code)
DO UPDATE SET
    description = EXCLUDED.description,
    default_enabled = EXCLUDED.default_enabled;
```

`current_enabled` tidak dioverwrite.

### 42.4 Relationship Seed by Natural Key

```sql
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code = 'CASE_READ'
WHERE r.code = 'OFFICER'
AND NOT EXISTS (
    SELECT 1
    FROM role_permission rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
);
```

### 42.5 Deprecate Instead of Delete

```sql
UPDATE permission
SET active = false,
    deprecated = true,
    updated_by = 'MIGRATION_PIPELINE',
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'CASE_LEGACY_APPROVE';
```

---

## 43. Common Anti-Patterns

### 43.1 Editing Old Seed Migration

Jika migration sudah pernah applied di shared environment, jangan edit file lama.

Dampak:

- checksum mismatch,
- environment drift,
- audit rusak,
- deployment gagal.

Buat migration baru.

### 43.2 Seed Depends on Numeric ID

```sql
INSERT INTO role_permission VALUES (1, 2);
```

Ini rapuh. Resolve via natural key.

### 43.3 Seed Contains Production Secret

```sql
INSERT INTO config VALUES ('api-key', 'secret');
```

Jangan.

### 43.4 Seed Overwrites Admin Configuration

```sql
UPDATE system_parameter SET value = 'false';
```

Tanpa ownership check, ini berbahaya.

### 43.5 Test Data in Production Seed

```sql
INSERT INTO app_user (username) VALUES ('qa_test_user');
```

Test fixture tidak boleh ikut production migration.

### 43.6 Seed Without Unique Constraint

Idempotency butuh database constraint.

Buruk:

```sql
CREATE TABLE role (
    id BIGINT PRIMARY KEY,
    code VARCHAR(64)
);
```

Lebih baik:

```sql
CREATE TABLE role (
    id BIGINT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE
);
```

Application-level check saja tidak cukup.

---

## 44. Seed Rollback Thinking

Rollback seed tidak selalu berarti delete row.

Misalnya migration menambah permission:

```text
CASE_REOPEN
```

Rollback opsi:

1. Delete permission.
2. Disable permission.
3. Remove role mapping only.
4. Leave permission but app no longer uses it.
5. Roll forward with correction.

Jika permission sudah muncul di audit trail atau assigned ke role, delete bisa merusak history.

Untuk seed production, rollback yang lebih aman sering:

```sql
UPDATE permission
SET active = false
WHERE code = 'CASE_REOPEN';
```

Daripada:

```sql
DELETE FROM permission
WHERE code = 'CASE_REOPEN';
```

Seed rollback harus mempertahankan referential integrity dan audit meaning.

---

## 45. Applying This in Spring Boot

Spring Boot bisa menjalankan Flyway/Liquibase saat startup. Namun untuk production, pertimbangkan apakah seed/migration sebaiknya dijalankan:

- saat app startup,
- sebagai Kubernetes Job sebelum deployment,
- sebagai CI/CD pipeline step,
- secara manual controlled oleh DBA/release manager.

Spring Boot documentation menyarankan tidak mencampur basic SQL initialization (`schema.sql`/`data.sql`) dengan Flyway/Liquibase sebagai mekanisme utama database initialization. Ini penting karena seed yang tersebar di beberapa mekanisme membuat ordering dan ownership kabur.

Recommended serious setup:

```properties
spring.jpa.hibernate.ddl-auto=validate
spring.flyway.enabled=true
# or
spring.liquibase.enabled=true
```

Dan hindari:

```text
schema.sql + data.sql + Flyway + Hibernate ddl-auto update
```

Karena itu membuat banyak sumber perubahan database.

---

## 46. Production-Grade Seed Policy Template

Sebuah team sebaiknya punya policy eksplisit.

Contoh:

```text
1. Semua seed production harus berada di migration repository.
2. Seed harus memakai natural key stabil.
3. Kode aplikasi tidak boleh bergantung pada surrogate ID seed.
4. Seed code-owned boleh di-upsert dengan controlled columns.
5. Seed operator-owned hanya boleh insert-if-not-exists kecuali ada migration eksplisit.
6. Secret tidak boleh disimpan dalam seed.
7. Default password tidak boleh dibuat oleh migration.
8. Test fixture tidak boleh berada di production migration path.
9. Role/permission seed harus direview oleh security/domain owner.
10. Workflow seed harus mempertimbangkan in-flight records.
11. Existing applied migration tidak boleh diedit.
12. Drift untuk code-owned seed harus dideteksi.
13. Deletion seed harus melalui deprecation terlebih dahulu jika ada historical dependency.
14. Migration harus diuji terhadap database engine production-like.
```

Policy seperti ini mencegah seed menjadi area liar.

---

## 47. Advanced Design: Seed as State Reconciliation

Pada sistem besar, seed bisa dipandang sebagai reconciliation process:

```text
Desired state:
    canonical seed definition in repo

Current state:
    data in database

Reconciler:
    migration/loader/drift detector

Policy:
    add missing, update controlled, preserve operator-owned, flag unexpected
```

Ini mirip cara Kubernetes mengelola desired state, tetapi diterapkan ke data reference/config.

Pseudo-logic:

```text
for each canonical row:
    if missing:
        insert
    else:
        update controlled fields only

for each database row not in canonical:
    if code-owned table:
        flag or deactivate
    if operator-owned table:
        preserve
```

Ini lebih kuat daripada sekadar kumpulan `INSERT`.

Tetapi jangan langsung membuat framework besar. Mulai dari policy, natural key, idempotency, deterministic output, dan test.

---

## 48. Worked Example: Role and Permission Seed

### 48.1 Schema

```sql
CREATE TABLE role (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(500),
    active BOOLEAN NOT NULL,
    created_by VARCHAR(128) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_by VARCHAR(128) NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE permission (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    code VARCHAR(128) NOT NULL UNIQUE,
    description VARCHAR(500) NOT NULL,
    active BOOLEAN NOT NULL,
    created_by VARCHAR(128) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_by VARCHAR(128) NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE role_permission (
    role_id BIGINT NOT NULL REFERENCES role(id),
    permission_id BIGINT NOT NULL REFERENCES permission(id),
    PRIMARY KEY (role_id, permission_id)
);
```

### 48.2 Role Seed

```sql
INSERT INTO role (
    code,
    name,
    description,
    active,
    created_by,
    created_at,
    updated_by,
    updated_at
)
VALUES (
    'OFFICER',
    'Officer',
    'Case officer role',
    true,
    'MIGRATION_PIPELINE',
    TIMESTAMP '2026-01-01 00:00:00',
    'MIGRATION_PIPELINE',
    TIMESTAMP '2026-01-01 00:00:00'
)
ON CONFLICT (code)
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_by = 'MIGRATION_PIPELINE',
    updated_at = CURRENT_TIMESTAMP;
```

Note:

- `created_at` deterministic saat insert,
- `updated_at` runtime saat actual update,
- conflict berdasarkan `code`,
- controlled fields di-update.

### 48.3 Permission Seed

```sql
INSERT INTO permission (
    code,
    description,
    active,
    created_by,
    created_at,
    updated_by,
    updated_at
)
VALUES (
    'CASE_READ',
    'Read case information',
    true,
    'MIGRATION_PIPELINE',
    TIMESTAMP '2026-01-01 00:00:00',
    'MIGRATION_PIPELINE',
    TIMESTAMP '2026-01-01 00:00:00'
)
ON CONFLICT (code)
DO UPDATE SET
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_by = 'MIGRATION_PIPELINE',
    updated_at = CURRENT_TIMESTAMP;
```

### 48.4 Mapping Seed

```sql
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.code = 'CASE_READ'
WHERE r.code = 'OFFICER'
AND NOT EXISTS (
    SELECT 1
    FROM role_permission rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
);
```

### 48.5 Validation Query

```sql
SELECT r.code AS role_code, p.code AS permission_code
FROM role_permission rp
JOIN role r ON r.id = rp.role_id
JOIN permission p ON p.id = rp.permission_id
ORDER BY r.code, p.code;
```

Output harus bisa dibandingkan dengan canonical matrix.

---

## 49. Worked Example: Operator-Owned System Parameter

### 49.1 Schema

```sql
CREATE TABLE system_parameter (
    param_key VARCHAR(128) PRIMARY KEY,
    param_value VARCHAR(1000) NOT NULL,
    description VARCHAR(500) NOT NULL,
    editable BOOLEAN NOT NULL,
    created_by VARCHAR(128) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_by VARCHAR(128) NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

### 49.2 Bootstrap Seed

```sql
INSERT INTO system_parameter (
    param_key,
    param_value,
    description,
    editable,
    created_by,
    created_at,
    updated_by,
    updated_at
)
SELECT
    'CASE_AUTO_ASSIGN_ENABLED',
    'false',
    'Whether cases are automatically assigned to officers',
    true,
    'MIGRATION_PIPELINE',
    CURRENT_TIMESTAMP,
    'MIGRATION_PIPELINE',
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1
    FROM system_parameter
    WHERE param_key = 'CASE_AUTO_ASSIGN_ENABLED'
);
```

Kenapa bukan upsert?

Karena `param_value` editable oleh operator. Deployment berikutnya tidak boleh mengubahnya kembali ke `false` jika production sengaja mengaktifkan fitur.

Jika ingin mengubah default untuk environment baru, ubah seed bootstrap. Jika ingin mengubah production value existing, buat migration eksplisit dengan approval.

---

## 50. Worked Example: Feature Flag with Partial Ownership

```sql
CREATE TABLE feature_flag (
    code VARCHAR(128) PRIMARY KEY,
    description VARCHAR(500) NOT NULL,
    default_enabled BOOLEAN NOT NULL,
    current_enabled BOOLEAN NOT NULL,
    owner VARCHAR(128) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

Seed:

```sql
INSERT INTO feature_flag (
    code,
    description,
    default_enabled,
    current_enabled,
    owner,
    created_at,
    updated_at
)
VALUES (
    'BULK_CASE_ASSIGNMENT',
    'Allows supervisors to assign cases in bulk',
    false,
    false,
    'case-management-team',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (code)
DO UPDATE SET
    description = EXCLUDED.description,
    default_enabled = EXCLUDED.default_enabled,
    owner = EXCLUDED.owner,
    updated_at = CURRENT_TIMESTAMP;
```

`current_enabled` tidak di-update. Ini menjaga runtime decision tetap milik operator/product owner.

---

## 51. Seed Maturity Model

### Level 0 — Manual Data Setup

- DBA/admin memasukkan data manual.
- Tidak repeatable.
- Tidak jelas environment parity.

### Level 1 — Basic Insert Script

- Ada SQL seed.
- Tapi belum idempotent.
- Masih bergantung numeric ID.

### Level 2 — Idempotent Seed

- Aman dijalankan ulang.
- Ada unique key.
- Insert-if-not-exists/upsert digunakan.

### Level 3 — Deterministic Seed

- Stable natural key.
- Tidak random/time-dependent untuk contract.
- Output antar fresh environment sama.

### Level 4 — Ownership-Aware Seed

- Code-owned vs operator-owned jelas.
- Partial upsert diterapkan.
- Tidak overwrite production config sembarangan.

### Level 5 — Governed and Auditable Seed

- Drift detection.
- Review checklist.
- Security approval untuk permission.
- Seed tested in CI.
- Production runbook jelas.

Target top-tier engineer minimal Level 4, idealnya Level 5 untuk sistem enterprise/regulatory.

---

## 52. Ringkasan Prinsip Utama

Pegang prinsip berikut:

1. Seed adalah dependency runtime aplikasi.
2. Seed harus punya stable natural key.
3. Kode aplikasi tidak boleh bergantung pada numeric surrogate ID seed.
4. Idempotent berarti aman dijalankan ulang.
5. Deterministic berarti hasilnya stabil untuk input yang sama.
6. Upsert berguna, tetapi bisa berbahaya tanpa ownership model.
7. Insert-if-not-exists cocok untuk bootstrap data yang boleh dimodifikasi operator.
8. Delete-and-reinsert biasanya berbahaya untuk production.
9. Secret tidak boleh disimpan di seed.
10. Default password tidak boleh dibuat sembarangan lewat migration.
11. Role/permission seed adalah security-sensitive.
12. Workflow seed adalah domain-control-sensitive.
13. Test data bukan production seed.
14. Drift harus bisa dijelaskan: allowed, repaired, atau blocked.
15. Seed harus diuji terhadap database engine yang menyerupai production.

---

## 53. Referensi Resmi dan Catatan Tooling

- Flyway repeatable migration dijalankan ulang ketika checksum berubah; dokumentasi Redgate/Flyway menyebut repeatable migration cocok untuk object definition seperti view/procedure/function/package, dan juga bisa dipakai untuk bulk reference data reinserts jika memang dikelola dengan benar.
- Liquibase menyimpan checksum changeset di `DATABASECHANGELOG`; `runOnChange` menjalankan ulang changeset ketika checksum berubah, sehingga harus dipakai dengan hati-hati untuk seed yang bisa berubah.
- Oracle `MERGE` adalah statement deterministic untuk melakukan insert/update/delete berbasis match condition; Oracle menyatakan satu target row tidak boleh di-update beberapa kali dalam satu `MERGE` statement.
- PostgreSQL `INSERT ... ON CONFLICT` adalah mekanisme umum untuk upsert dan sangat berguna untuk seed berbasis natural key.

---

## 54. Latihan Mandiri

Ambil satu sistem yang Anda punya, lalu klasifikasikan seed berikut:

```text
role
permission
role_permission
status
workflow_state
workflow_transition
email_template
system_parameter
feature_flag
tenant_default_config
admin_user
country
currency
```

Untuk setiap tabel, jawab:

1. Apakah data ini code-owned, operator-owned, environment-owned, atau user-owned?
2. Apa natural key-nya?
3. Apakah boleh di-upsert?
4. Kolom mana yang boleh dioverwrite?
5. Kolom mana yang harus dipertahankan?
6. Apakah deletion boleh hard delete atau harus deprecate?
7. Bagaimana drift dideteksi?
8. Bagaimana test memastikan seed sesuai contract Java code?

Jika Anda bisa menjawab ini, Anda sudah berpikir di level yang jauh lebih matang daripada sekadar “buat `data.sql`”.

---

## 55. Penutup

Idempotent dan deterministic seed design adalah fondasi penting sebelum masuk ke data migration/backfill yang lebih berat.

Seed yang buruk membuat environment tidak bisa dipercaya. Seed yang baik membuat deployment lebih predictable, audit lebih kuat, debugging lebih cepat, dan production behaviour lebih defensible.

Pada bagian berikutnya kita akan masuk ke topik yang lebih berisiko: **data migration dan backfill engineering**. Di sana kita akan membahas bagaimana mengubah data existing dalam jumlah besar secara aman, chunked, observable, resumable, dan compatible dengan aplikasi yang sedang berjalan.

---

**Status seri:** belum selesai.  
**Bagian saat ini:** Part 18 dari 34.  
**Bagian berikutnya:** `19-data-migration-backfill-engineering.md`.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 17 — Seeding Strategy: Reference Data, Master Data, and Bootstrap Data](./17-seeding-reference-master-bootstrap-data.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Data Migration and Backfill Engineering](./19-data-migration-backfill-engineering.md)

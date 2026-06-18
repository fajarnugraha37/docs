# Part 17 — Seeding Strategy: Reference Data, Master Data, and Bootstrap Data

**Series:** `learn-java-database-migrations-seedings-flyway-liquibase`  
**File:** `17-seeding-reference-master-bootstrap-data.md`  
**Target:** Java 8–25, backend/enterprise systems, Flyway, Liquibase, Spring Boot, Jakarta EE, CI/CD, production-grade database change engineering.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membangun fondasi:

- database change sebagai disiplin engineering,
- taxonomy perubahan database,
- invariants dan failure model,
- versioning model,
- Flyway mental model,
- Liquibase mental model,
- setup kedua tool,
- desain migration,
- rollback,
- dan decision framework Flyway vs Liquibase.

Sekarang kita masuk ke area yang sering dianggap kecil, tetapi sering menjadi sumber bug production yang sangat sulit dilacak: **database seeding**.

Seeding adalah proses memasukkan data awal atau data referensi ke database agar aplikasi bisa berjalan dengan benar. Namun dalam sistem enterprise, seeding bukan sekadar:

```sql
INSERT INTO role VALUES (...);
INSERT INTO status VALUES (...);
INSERT INTO country VALUES (...);
```

Seeding adalah bagian dari **application contract**.

Jika schema adalah bentuk struktur data, maka seed data sering kali adalah **bahasa operasional sistem**:

- status apa saja yang valid,
- role apa saja yang ada,
- permission mana yang mengizinkan action tertentu,
- workflow state mana yang bisa muncul,
- template mana yang dipakai untuk notifikasi,
- konfigurasi awal apa yang menentukan behaviour modul,
- tenant baru harus punya data default apa,
- master data apa yang boleh berubah dan oleh siapa.

Part ini bertujuan membangun mental model yang kuat tentang:

1. apa itu seed data,
2. jenis-jenis seed data,
3. perbedaan reference data, master data, bootstrap data, test data, dan config data,
4. kapan seed harus dimigration-kan,
5. kapan seed tidak boleh dimigration-kan,
6. bagaimana strategi seed berbeda antara dev, test, UAT, dan production,
7. bagaimana Flyway dan Liquibase biasanya dipakai untuk seeding,
8. apa anti-pattern yang sering merusak sistem,
9. bagaimana membuat seed yang defensible, deterministic, auditable, dan maintainable.

---

## 2. Core Mental Model

### 2.1 Database seeding bukan hanya data awal

Definisi sederhana:

> Seeding adalah proses memasukkan data awal yang diperlukan agar sistem dapat beroperasi sesuai kontrak aplikasinya.

Tetapi definisi yang lebih matang:

> Seeding adalah mekanisme versioned, repeatable, auditable, dan deterministic untuk membentuk data non-transaksional yang menjadi bagian dari behavioural contract aplikasi.

Kata kuncinya adalah **behavioural contract**.

Contoh:

```text
CASE_STATUS = SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED
```

Ini bukan sekadar isi tabel. Ini mempengaruhi:

- validasi state transition,
- filter UI,
- report,
- SLA calculation,
- notification trigger,
- authorization decision,
- audit interpretation,
- migration state lama ke state baru.

Kalau status `UNDER_REVIEW` hilang dari database, aplikasi mungkin masih compile, test unit mungkin masih pass, tetapi sistem production bisa salah behaviour.

Maka seed data perlu diperlakukan hampir seperti source code.

---

### 2.2 Seed data adalah bagian dari release

Dalam sistem kecil, seed sering dibuat manual oleh developer atau DBA. Dalam sistem besar, ini berbahaya.

Misalnya release aplikasi menambahkan fitur:

```text
new permission: CASE_REOPEN
new role mapping: SENIOR_OFFICER has CASE_REOPEN
new status: REOPENED
new notification template: case_reopened_email
```

Jika code sudah deploy tetapi seed belum ada:

- endpoint bisa return 403,
- dropdown kosong,
- workflow transition gagal,
- template lookup gagal,
- user menganggap bug aplikasi,
- rollback code belum tentu menyelesaikan karena seed sudah partial.

Maka seed data yang menjadi dependency fitur harus dipromosikan bersama release.

Mental model:

```text
Application release = code artifact + database schema + seed/reference/config contract
```

Bukan:

```text
Application release = code artifact only
```

---

### 2.3 Tidak semua data awal adalah seed yang sama jenisnya

Kesalahan umum adalah menyebut semua data awal sebagai “seed”. Padahal strategi untuk tiap kategori berbeda.

Contoh kategori:

| Jenis Data | Contoh | Siapa Owner? | Bisa Berubah di Production? | Cocok di Migration? |
|---|---|---:|---:|---:|
| Reference data | country code, currency code, status code | engineering/domain | jarang | ya |
| Master data | agency, branch, product category | business/admin | ya | tergantung |
| Bootstrap data | initial admin role, system config | engineering/platform | sangat terbatas | ya |
| Test data | dummy users, fake cases | QA/dev | tidak di prod | tidak untuk prod |
| Demo data | sample customer, sample order | sales/training | tidak di prod | environment-specific |
| Runtime config | SLA threshold, feature toggle | ops/business | ya | sering lebih baik di config system |
| Transactional data | application case, order, payment | user/system runtime | ya | tidak |

Setiap kategori perlu decision rule yang berbeda.

---

## 3. Seed Data Taxonomy

Bagian ini adalah fondasi penting. Tanpa taxonomy, tim akan mencampur semua data ke satu folder `db/migration`, lalu beberapa bulan kemudian tidak jelas mana yang boleh diedit, mana yang harus immutable, mana yang hanya untuk local, dan mana yang critical di production.

---

## 4. Reference Data

### 4.1 Definisi

Reference data adalah data yang mendefinisikan nilai valid yang digunakan oleh aplikasi untuk interpretasi dan validasi.

Contoh:

- country code,
- currency code,
- document type,
- case status,
- application type,
- gender code,
- priority level,
- notification channel,
- payment status,
- workflow state,
- reason code,
- error code,
- module code.

Reference data biasanya:

- relatif stabil,
- punya natural key,
- digunakan oleh banyak modul,
- sering muncul di dropdown/report/logic,
- punya makna domain,
- lebih cocok versioned daripada diedit manual.

---

### 4.2 Reference data sebagai domain vocabulary

Misalnya:

```sql
CREATE TABLE case_status (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sort_order INTEGER NOT NULL,
    active BOOLEAN NOT NULL
);
```

Seed:

```sql
INSERT INTO case_status (code, name, sort_order, active)
VALUES
('DRAFT', 'Draft', 10, TRUE),
('SUBMITTED', 'Submitted', 20, TRUE),
('UNDER_REVIEW', 'Under Review', 30, TRUE),
('APPROVED', 'Approved', 40, TRUE),
('REJECTED', 'Rejected', 50, TRUE);
```

Kode `UNDER_REVIEW` adalah vocabulary domain. Jika aplikasi punya enum:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Maka database seed dan Java enum harus konsisten.

Tapi ini memunculkan pertanyaan arsitektural:

> Source of truth status ada di Java enum atau database table?

Jawabannya tergantung desain.

---

### 4.3 Java enum vs database reference table

#### Option A — Java enum as source of truth

Cocok jika:

- nilai sangat stabil,
- tidak perlu dikelola admin,
- semua behaviour compile-time,
- perubahan harus lewat release code,
- tidak perlu dynamic label/sort/order per environment.

Contoh:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Database bisa menyimpan string code:

```sql
case_status VARCHAR(50) NOT NULL
```

Kelebihan:

- type-safe,
- mudah direfactor,
- logic jelas,
- compile-time discoverable.

Kekurangan:

- dropdown label harus dari code atau mapping tambahan,
- report SQL perlu tahu daftar nilai,
- tidak fleksibel untuk admin,
- sulit disable value tanpa release.

#### Option B — Database reference table as source of truth

Cocok jika:

- nilai dipakai untuk UI dropdown,
- ada label/sort/order,
- ada active/inactive,
- report butuh join,
- data perlu audit,
- bisa berubah oleh business process,
- ada multi-language label.

Contoh:

```sql
CREATE TABLE case_status_ref (
    code VARCHAR(50) PRIMARY KEY,
    label_en VARCHAR(100) NOT NULL,
    label_id VARCHAR(100),
    sort_order INTEGER NOT NULL,
    active BOOLEAN NOT NULL,
    system_managed BOOLEAN NOT NULL
);
```

Kelebihan:

- mudah dipakai UI/report,
- bisa diberi metadata,
- bisa diaudit,
- bisa dipromosikan sebagai data contract.

Kekurangan:

- runtime lookup perlu cache,
- compile-time safety lebih lemah,
- bisa drift kalau diedit manual,
- migration/seed harus disiplin.

#### Option C — Hybrid

Ini sering paling realistis untuk enterprise Java.

- Java enum menyimpan core code yang dipakai logic.
- Database table menyimpan metadata display/config.
- Seed memastikan database berisi semua enum yang valid.
- Startup validator memastikan enum dan DB sinkron.

Contoh:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Startup validator:

```java
@Component
public class ReferenceDataValidator {

    private final JdbcTemplate jdbcTemplate;

    public ReferenceDataValidator(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @PostConstruct
    public void validateCaseStatuses() {
        Set<String> dbCodes = new HashSet<>(jdbcTemplate.queryForList(
            "select code from case_status_ref where system_managed = true",
            String.class
        ));

        Set<String> enumCodes = Arrays.stream(CaseStatus.values())
            .map(Enum::name)
            .collect(Collectors.toSet());

        if (!dbCodes.containsAll(enumCodes)) {
            throw new IllegalStateException(
                "Missing case status reference data. expected=" + enumCodes + ", actual=" + dbCodes
            );
        }
    }
}
```

Mental model:

```text
Enum protects code logic.
Reference table supports display/config/report.
Migration keeps them aligned.
Startup validation detects drift early.
```

---

## 5. Master Data

### 5.1 Definisi

Master data adalah data inti yang digunakan oleh operasi bisnis dan sering menjadi referensi oleh transactional data.

Contoh:

- agency,
- department,
- branch,
- product,
- service category,
- jurisdiction,
- office location,
- business unit,
- organization hierarchy,
- fee type,
- license type,
- inspection category.

Master data berbeda dari reference data karena biasanya:

- lebih besar,
- lebih business-owned,
- bisa berubah di production,
- punya lifecycle,
- butuh approval,
- mungkin dikelola dari UI admin,
- bisa punya effective date,
- bisa punya audit trail.

---

### 5.2 Master data tidak selalu cocok sebagai migration seed

Misalnya tabel `agency`:

```sql
CREATE TABLE agency (
    id BIGINT PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    active BOOLEAN NOT NULL
);
```

Apakah data agency harus di-seed lewat migration?

Jawabannya tergantung.

Cocok jika:

- daftar agency fixed untuk sistem,
- hanya berubah lewat release governance,
- tidak ada admin UI,
- dipakai untuk bootstrap environment,
- agency adalah bagian kontrak aplikasi.

Tidak cocok jika:

- business user bisa tambah/edit agency,
- data berubah sering,
- ada approval workflow,
- ada effective date,
- ada integrasi source-of-truth eksternal,
- data harus sinkron dari master data management system.

Rule:

> Seed via migration hanya untuk master data yang benar-benar release-controlled atau bootstrap-critical.

Jika master data adalah business-owned runtime data, jangan treat sebagai immutable migration. Gunakan admin module, MDM sync, import process, atau controlled operational script.

---

### 5.3 Master data dengan effective dating

Banyak sistem enterprise membutuhkan master data dengan masa berlaku.

Contoh:

```sql
CREATE TABLE fee_type (
    id BIGINT PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    active BOOLEAN NOT NULL,
    UNIQUE (code, valid_from)
);
```

Jangan update amount lama begitu saja jika historical transaction perlu interpretasi historis.

Buruk:

```sql
UPDATE fee_type
SET amount = 120.00
WHERE code = 'APPLICATION_FEE';
```

Lebih baik:

```sql
UPDATE fee_type
SET valid_to = DATE '2026-06-30', active = false
WHERE code = 'APPLICATION_FEE'
  AND valid_to IS NULL;

INSERT INTO fee_type (id, code, name, amount, valid_from, valid_to, active)
VALUES (nextval('fee_type_seq'), 'APPLICATION_FEE', 'Application Fee', 120.00, DATE '2026-07-01', NULL, true);
```

Mental model:

```text
If data explains past business events, never mutate history casually.
Create a new effective version.
```

---

## 6. Bootstrap Data

### 6.1 Definisi

Bootstrap data adalah data minimum yang dibutuhkan agar sistem dapat hidup pertama kali.

Contoh:

- system tenant,
- admin role,
- default permissions,
- first admin user placeholder,
- initial configuration,
- initial workflow definitions,
- default notification channels,
- default organization root,
- default feature flags,
- default scheduler/job definitions.

Bootstrap data biasanya dibuat saat:

- database pertama kali dibuat,
- environment baru dibuat,
- tenant baru dibuat,
- module baru diaktifkan,
- aplikasi baru diinstall.

---

### 6.2 Bootstrap data harus minimal

Kesalahan umum:

> Semua data yang enak untuk development dimasukkan ke bootstrap migration.

Akibatnya production memiliki dummy data, default password, sample tenant, fake users, dan konfigurasi yang tidak semestinya.

Bootstrap production harus minimal:

```text
Only data required to safely operate the system.
```

Bukan:

```text
All data useful for developer convenience.
```

Contoh bootstrap yang masuk akal:

```sql
INSERT INTO role (code, name, system_managed)
VALUES ('SYSTEM_ADMIN', 'System Administrator', true);
```

Contoh bootstrap yang berbahaya:

```sql
INSERT INTO user_account (username, password_hash, email)
VALUES ('admin', 'hardcoded-hash', 'admin@example.com');
```

Masalah:

- default credential risk,
- audit ambiguity,
- bisa lupa diganti,
- credential masuk Git,
- bertentangan dengan identity provider.

Solusi lebih baik:

- seed role dan permission,
- buat user via identity provider,
- lakukan first-admin binding via secure ops process,
- jangan seed password production.

---

### 6.3 Bootstrap tenant

Untuk multi-tenant system, tenant baru sering membutuhkan default data.

Contoh data tenant:

- default roles,
- default workflow,
- default templates,
- default settings,
- default folders,
- default counters,
- default SLA rules.

Jangan campur tenant bootstrap dengan global schema migration tanpa desain.

Buruk:

```sql
INSERT INTO tenant_config (tenant_id, key, value)
SELECT id, 'timezone', 'Asia/Jakarta'
FROM tenant;
```

Jika migration ini berjalan di production dengan ribuan tenant, efeknya besar dan sulit dikontrol.

Lebih baik punya service/process:

```text
Tenant onboarding pipeline:
1. create tenant record
2. create tenant schema/config scope
3. apply tenant seed version N
4. validate tenant baseline
5. mark tenant ACTIVE
```

Tenant bootstrap akan dibahas lebih dalam di Part 28.

---

## 7. Configuration Data

### 7.1 Config data sering disalahartikan sebagai seed

Contoh config data:

- maximum login attempt,
- SLA duration,
- notification retry count,
- external service endpoint,
- feature toggle,
- batch job cron,
- UI banner message,
- threshold approval amount.

Pertanyaannya:

> Apakah config ini harus di-seed lewat migration?

Tidak selalu.

Config data berada di spektrum:

```text
code constant < release-controlled DB config < admin-managed config < runtime dynamic config < external config service
```

---

### 7.2 Release-controlled config

Cocok untuk migration jika:

- config adalah bagian fitur baru,
- harus tersedia sebelum aplikasi start,
- jarang berubah,
- tidak environment-specific,
- tidak mengandung secret,
- perlu audit via deployment.

Contoh:

```sql
INSERT INTO app_config (config_key, config_value, value_type, system_managed)
VALUES ('case.reopen.enabled', 'false', 'BOOLEAN', true);
```

---

### 7.3 Runtime-managed config

Tidak cocok untuk migration jika:

- sering berubah tanpa release,
- diubah oleh business user,
- butuh approval UI,
- butuh effective date,
- environment-specific,
- secret,
- tergantung incident response.

Contoh yang sebaiknya tidak hardcoded di migration:

```sql
INSERT INTO app_config (config_key, config_value)
VALUES ('external.payment.secret', 'super-secret');
```

Secret harus berada di secret manager, bukan migration file.

---

## 8. Role and Permission Seeding

### 8.1 Permission seed adalah behavioural contract

Permission sering terlihat seperti data biasa, tetapi sebenarnya menentukan security model.

Contoh:

```sql
CREATE TABLE permission (
    code VARCHAR(100) PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    module_code VARCHAR(50) NOT NULL,
    system_managed BOOLEAN NOT NULL
);

CREATE TABLE role_permission (
    role_code VARCHAR(100) NOT NULL,
    permission_code VARCHAR(100) NOT NULL,
    PRIMARY KEY (role_code, permission_code)
);
```

Seed:

```sql
INSERT INTO permission (code, description, module_code, system_managed)
VALUES
('CASE_VIEW', 'View cases', 'CASE', true),
('CASE_CREATE', 'Create cases', 'CASE', true),
('CASE_APPROVE', 'Approve cases', 'CASE', true),
('CASE_REOPEN', 'Reopen closed cases', 'CASE', true);
```

Jika code aplikasi mengecek:

```java
@PreAuthorize("hasAuthority('CASE_REOPEN')")
public void reopenCase(Long caseId) {
    ...
}
```

maka permission seed adalah dependency release.

Tanpa seed, fitur bisa gagal meskipun code benar.

---

### 8.2 Role-permission mapping: hati-hati

Permission seed biasanya aman sebagai release-controlled seed. Role-permission mapping lebih sensitif.

Kenapa?

Karena role assignment bisa merupakan keputusan business/security, bukan engineering.

Contoh:

```sql
INSERT INTO role_permission (role_code, permission_code)
VALUES ('OFFICER', 'CASE_REOPEN');
```

Pertanyaan yang harus dijawab:

- Apakah semua officer memang boleh reopen case?
- Apakah ini harus diset oleh admin security?
- Apakah mapping ini berbeda per agency/tenant?
- Apakah ada approval governance?
- Apakah production security team harus review?

Strategy:

| Data | Biasanya Cocok di Migration? | Catatan |
|---|---:|---|
| Permission definition | Ya | bagian code contract |
| System role definition | Ya | jika role built-in |
| Default role-permission mapping | Tergantung | harus sesuai governance |
| User-role assignment | Umumnya tidak | runtime/security admin |
| Emergency role | Tidak sembarangan | perlu ops/security process |

---

### 8.3 Permission seed dengan Java enum

Pattern matang:

```java
public enum PermissionCode {
    CASE_VIEW,
    CASE_CREATE,
    CASE_APPROVE,
    CASE_REOPEN
}
```

Database seed memastikan table `permission` punya semua code.

Startup validator bisa memastikan tidak ada mismatch:

```java
public final class PermissionReferenceValidator {

    private final DataSource dataSource;

    public PermissionReferenceValidator(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public void validate() throws SQLException {
        Set<String> dbPermissions = new HashSet<>();

        try (Connection con = dataSource.getConnection();
             PreparedStatement ps = con.prepareStatement("select code from permission where system_managed = true");
             ResultSet rs = ps.executeQuery()) {

            while (rs.next()) {
                dbPermissions.add(rs.getString(1));
            }
        }

        Set<String> codePermissions = Arrays.stream(PermissionCode.values())
            .map(Enum::name)
            .collect(Collectors.toSet());

        if (!dbPermissions.containsAll(codePermissions)) {
            throw new IllegalStateException("Database permission seed is missing values: " + codePermissions);
        }
    }
}
```

Untuk Java 8, gunakan API standar seperti di atas. Untuk Java 17+, bisa lebih ringkas, tetapi principle sama.

---

## 9. Feature Flag Seed

### 9.1 Feature flag sebagai seed

Feature flag bisa menjadi seed jika aplikasi membaca flag dari database.

Contoh:

```sql
CREATE TABLE feature_flag (
    code VARCHAR(100) PRIMARY KEY,
    enabled BOOLEAN NOT NULL,
    description VARCHAR(255),
    system_managed BOOLEAN NOT NULL
);
```

Migration:

```sql
INSERT INTO feature_flag (code, enabled, description, system_managed)
VALUES ('CASE_REOPEN_FLOW', false, 'Enable case reopen flow', true);
```

Ini aman jika:

- default harus ada sebelum aplikasi start,
- flag tidak secret,
- value default sama lintas environment,
- perubahan value actual bisa dilakukan melalui admin/config process.

---

### 9.2 Jangan hardcode environment behaviour di seed umum

Buruk:

```sql
INSERT INTO feature_flag (code, enabled)
VALUES ('PAYMENT_INTEGRATION', true);
```

Di local/dev mungkin tidak boleh true. Di production mungkin harus controlled rollout.

Lebih baik:

- seed definisi flag,
- value default conservative,
- environment override lewat config service/admin UI,
- atau gunakan context/label Liquibase untuk environment-specific jika benar-benar perlu.

Contoh safe default:

```sql
INSERT INTO feature_flag (code, enabled, system_managed)
VALUES ('PAYMENT_INTEGRATION', false, true);
```

Lalu enable di production via explicit operational approval.

---

## 10. Template Seed

### 10.1 Notification/email template

Banyak aplikasi enterprise menyimpan template di database:

- email template,
- SMS template,
- letter template,
- document template,
- notification message,
- report template.

Contoh:

```sql
CREATE TABLE notification_template (
    code VARCHAR(100) PRIMARY KEY,
    subject VARCHAR(255),
    body CLOB NOT NULL,
    active BOOLEAN NOT NULL,
    version INTEGER NOT NULL,
    system_managed BOOLEAN NOT NULL
);
```

Seed:

```sql
INSERT INTO notification_template (
    code, subject, body, active, version, system_managed
) VALUES (
    'CASE_SUBMITTED_EMAIL',
    'Case submitted',
    'Your case ${caseNo} has been submitted.',
    true,
    1,
    true
);
```

---

### 10.2 Template adalah code-like artifact

Template sering dianggap data, tetapi sebenarnya mirip source code:

- punya placeholder contract,
- bisa menyebabkan runtime error,
- perlu review,
- perlu versioning,
- perlu test rendering,
- perlu backward compatibility.

Jika template memakai placeholder `${caseNo}`, maka Java code harus menyediakan `caseNo`.

Jika migration mengubah template menjadi `${applicationNo}` tetapi Java code masih mengirim `caseNo`, email rendering bisa gagal.

Maka template seed harus diuji.

Contoh validator sederhana:

```java
public final class TemplateContractValidator {

    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\$\\{([a-zA-Z0-9_]+)}");

    public Set<String> extractPlaceholders(String template) {
        Matcher matcher = PLACEHOLDER_PATTERN.matcher(template);
        Set<String> placeholders = new LinkedHashSet<>();
        while (matcher.find()) {
            placeholders.add(matcher.group(1));
        }
        return placeholders;
    }

    public void validate(String templateCode, String body, Set<String> allowedPlaceholders) {
        Set<String> actual = extractPlaceholders(body);
        if (!allowedPlaceholders.containsAll(actual)) {
            throw new IllegalStateException(
                "Template " + templateCode + " contains unsupported placeholders: " + actual
            );
        }
    }
}
```

---

## 11. Workflow Seed

### 11.1 Workflow/state machine seed

Dalam sistem case management, enforcement lifecycle, approval workflow, atau regulatory platform, workflow definition sering disimpan sebagai data.

Contoh:

```sql
CREATE TABLE workflow_state (
    code VARCHAR(100) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    terminal BOOLEAN NOT NULL
);

CREATE TABLE workflow_transition (
    from_state VARCHAR(100) NOT NULL,
    to_state VARCHAR(100) NOT NULL,
    action_code VARCHAR(100) NOT NULL,
    permission_code VARCHAR(100) NOT NULL,
    PRIMARY KEY (from_state, to_state, action_code)
);
```

Seed:

```sql
INSERT INTO workflow_state (code, label, terminal)
VALUES
('DRAFT', 'Draft', false),
('SUBMITTED', 'Submitted', false),
('UNDER_REVIEW', 'Under Review', false),
('APPROVED', 'Approved', true),
('REJECTED', 'Rejected', true);
```

Transition:

```sql
INSERT INTO workflow_transition (from_state, to_state, action_code, permission_code)
VALUES
('DRAFT', 'SUBMITTED', 'SUBMIT', 'CASE_SUBMIT'),
('SUBMITTED', 'UNDER_REVIEW', 'START_REVIEW', 'CASE_REVIEW'),
('UNDER_REVIEW', 'APPROVED', 'APPROVE', 'CASE_APPROVE'),
('UNDER_REVIEW', 'REJECTED', 'REJECT', 'CASE_REJECT');
```

---

### 11.2 Workflow seed harus divalidasi sebagai graph

Workflow seed bukan hanya row data. Itu graph.

Hal yang perlu divalidasi:

- semua `from_state` ada,
- semua `to_state` ada,
- tidak ada unreachable state,
- tidak ada dead-end non-terminal state,
- tidak ada transition duplicate,
- permission code valid,
- action code valid,
- terminal state tidak punya outgoing transition kecuali memang didesain,
- initial state jelas,
- state removal tidak merusak existing cases.

Mental model:

```text
Workflow seed = executable domain graph.
Treat it like code.
```

---

### 11.3 Jangan ubah workflow history sembarangan

Jika case lama punya state `UNDER_REVIEW`, lalu migration menghapus state itu, apa yang terjadi?

- old reports bisa rusak,
- old case tidak bisa dibuka,
- audit trail tidak bisa diinterpretasi,
- workflow engine gagal resolve transition,
- SLA calculation berubah.

Lebih aman:

- mark inactive,
- maintain compatibility mapping,
- migrate existing cases secara eksplisit,
- pisahkan display label dari historical code,
- jangan delete state code yang pernah dipakai transactional data.

Buruk:

```sql
DELETE FROM workflow_state WHERE code = 'UNDER_REVIEW';
```

Lebih aman:

```sql
UPDATE workflow_state
SET active = false
WHERE code = 'UNDER_REVIEW';
```

Jika perlu mengganti state:

```sql
UPDATE case_record
SET status = 'IN_ASSESSMENT'
WHERE status = 'UNDER_REVIEW';
```

Tetapi ini adalah data migration/backfill, bukan sekadar seed update. Harus punya validation, rollback/roll-forward plan, dan business approval.

---

## 12. Seed Data and Foreign Keys

Seed data sering memiliki dependency ordering.

Contoh:

```text
module -> permission -> role_permission
country -> state/province -> city
workflow_state -> workflow_transition
tenant -> tenant_config -> tenant_role
notification_channel -> notification_template
```

Jika migration tidak terurut, seed gagal.

### 12.1 Flyway ordering

Flyway versioned migrations bisa disusun:

```text
V20260617_001__create_security_tables.sql
V20260617_002__seed_roles.sql
V20260617_003__seed_permissions.sql
V20260617_004__seed_role_permissions.sql
```

Kelebihan:

- ordering eksplisit,
- mudah trace,
- failure jelas.

Kekurangan:

- banyak file,
- perlu naming discipline,
- conflict kalau banyak branch.

### 12.2 Liquibase ordering

Liquibase bisa menggunakan changelog hierarchy:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/security/001-create-security-tables.yaml
  - include:
      file: db/changelog/security/002-seed-roles.yaml
  - include:
      file: db/changelog/security/003-seed-permissions.yaml
  - include:
      file: db/changelog/security/004-seed-role-permissions.yaml
```

Kelebihan:

- struktur lebih eksplisit,
- contexts/labels/preconditions bisa membantu,
- changeset identity lebih granular.

Kekurangan:

- changelog bisa kompleks,
- includeAll ordering harus hati-hati,
- generated changelog sering sulit direview.

---

## 13. Seed Ownership

Pertanyaan penting:

> Siapa yang punya seed data?

Bukan semua seed milik developer.

| Seed Type | Owner Utama | Reviewer Tambahan |
|---|---|---|
| Permission definition | engineering/security architecture | security officer/domain lead |
| Role-permission default | business/security | engineering |
| Workflow state | domain/product/business process | engineering/QA |
| Lookup display label | business/domain | UX/QA |
| Country/currency ISO data | engineering/domain | QA |
| Feature flag definition | engineering/product | release manager |
| Template content | business/comms/legal | engineering |
| System config | engineering/ops | security/infra |
| Tenant bootstrap | platform/domain | ops/business |

Seed file ada di repository engineering, tetapi ownership semantic bisa lintas fungsi.

Dalam sistem regulasi, enforcement, government, finance, insurance, health, atau compliance-heavy system, seed data sering merupakan bukti behaviour sistem. Maka review-nya tidak boleh hanya teknis.

---

## 14. Seed Drift

### 14.1 Apa itu seed drift?

Seed drift terjadi ketika data seed antar environment berbeda tanpa alasan yang dikontrol.

Contoh:

```text
DEV:
CASE_REOPEN enabled = true

UAT:
CASE_REOPEN enabled = false

PROD:
CASE_REOPEN missing
```

Atau:

```text
DEV role OFFICER has CASE_APPROVE
UAT role OFFICER does not have CASE_APPROVE
PROD role OFFICER has CASE_APPROVE and CASE_DELETE
```

Seed drift membuat bug sulit direproduce.

---

### 14.2 Penyebab seed drift

Umumnya:

- manual update via SQL console,
- hotfix langsung di production,
- admin UI mengubah data system-managed,
- migration diedit setelah apply,
- seed tidak idempotent,
- environment-specific seed tidak terdokumentasi,
- data restore partial,
- DBA patch tanpa source control,
- release gagal di tengah,
- old migration tidak pernah dijalankan di environment tertentu,
- seed berada di document/email, bukan repository.

---

### 14.3 Drift detection

Minimal strategy:

- migration history table dicek,
- checksum migration dicek,
- seed critical dibandingkan dengan expected values,
- startup validator untuk reference data penting,
- scheduled drift report,
- CI test from empty DB,
- upgrade test from previous release DB.

Contoh query sederhana:

```sql
SELECT code
FROM permission
WHERE system_managed = true
ORDER BY code;
```

Bandingkan dengan expected permission list dari code atau artifact.

Untuk critical seed, bisa simpan fingerprint:

```text
permission seed fingerprint = sha256(sorted(permission_code + ':' + module_code))
```

Kemudian validator membandingkan fingerprint antar environment.

---

## 15. Seed Audit

### 15.1 Mengapa seed perlu audit?

Karena seed bisa mengubah behaviour production.

Contoh perubahan seed:

```sql
INSERT INTO role_permission (role_code, permission_code)
VALUES ('OFFICER', 'APPROVE_PAYMENT');
```

Ini bisa lebih berbahaya daripada perubahan code.

Audit harus bisa menjawab:

- siapa mengusulkan perubahan,
- siapa mereview,
- kapan diterapkan,
- migration file mana,
- release mana,
- environment mana,
- before/after data seperti apa,
- apakah perubahan sesuai approval,
- apakah ada manual correction.

---

### 15.2 Audit melalui migration history tidak selalu cukup

Flyway/Liquibase history menunjukkan migration dijalankan, tetapi tidak selalu cukup menjelaskan semantic change.

Misalnya:

```text
V20260617_004__update_reference_data.sql executed successfully
```

Apa yang berubah? Permission? Workflow? Template? Role mapping?

Migration file harus readable dan self-documenting.

Buruk:

```sql
UPDATE config SET value = 'true' WHERE key = 'x';
```

Lebih baik:

```sql
-- Enable the case reopen feature flag as disabled-by-default seed.
-- Actual production activation remains controlled by admin config.
INSERT INTO feature_flag (code, enabled, description, system_managed)
VALUES (
    'CASE_REOPEN_FLOW',
    false,
    'Defines the case reopen flow feature flag. Default is disabled.',
    true
);
```

---

## 16. Flyway Seeding Strategies

Flyway tidak punya konsep khusus “seed”. Seed biasanya dijalankan sebagai SQL versioned migration, repeatable migration, atau Java-based migration.

---

### 16.1 Versioned seed migration

Cocok untuk:

- permission definition,
- role definition,
- workflow state addition,
- new lookup value,
- new template version,
- bootstrap data.

Contoh:

```text
db/migration/
  V20260617_001__create_security_tables.sql
  V20260617_002__seed_security_roles.sql
  V20260617_003__seed_case_permissions.sql
```

Contoh SQL:

```sql
INSERT INTO permission (code, description, module_code, system_managed)
VALUES ('CASE_REOPEN', 'Reopen closed cases', 'CASE', true);
```

Kelebihan:

- immutable,
- audit-friendly,
- jelas kapan diperkenalkan,
- cocok untuk release.

Kekurangan:

- update data perlu migration baru,
- tidak cocok untuk data yang sering berubah.

---

### 16.2 Repeatable seed migration

Repeatable migration bisa dipakai untuk seed yang sifatnya “definition snapshot”, tetapi harus hati-hati.

Contoh:

```text
R__seed_country_codes.sql
```

Isi:

```sql
MERGE INTO country_ref c
USING (
    SELECT 'ID' AS code, 'Indonesia' AS name FROM dual
    UNION ALL SELECT 'SG', 'Singapore' FROM dual
) src
ON (c.code = src.code)
WHEN MATCHED THEN UPDATE SET c.name = src.name
WHEN NOT MATCHED THEN INSERT (code, name, active)
VALUES (src.code, src.name, true);
```

Masalah:

- setiap perubahan checksum membuat repeatable rerun,
- bisa overwrite perubahan production,
- sulit trace perubahan granular,
- delete/inactive handling harus eksplisit,
- jika data besar, repeatable menjadi mahal.

Rule:

> Gunakan repeatable seed hanya untuk reference snapshot yang benar-benar system-owned dan aman di-reconcile ulang.

Jangan gunakan repeatable migration untuk role-permission mapping yang bisa diubah admin/security tanpa governance yang jelas.

---

### 16.3 Java-based seed migration

Cocok jika seed perlu:

- parsing file CSV besar,
- transform data kompleks,
- hash/fingerprint,
- validation graph,
- chunking,
- cross-table consistency check.

Tetapi jangan jadikan Java migration sebagai mini aplikasi import.

Contoh Java migration sederhana:

```java
package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.PreparedStatement;

public class V20260617_005__seed_case_reopen_permission extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        try (PreparedStatement ps = context.getConnection().prepareStatement(
            "insert into permission (code, description, module_code, system_managed) values (?, ?, ?, ?)"
        )) {
            ps.setString(1, "CASE_REOPEN");
            ps.setString(2, "Reopen closed cases");
            ps.setString(3, "CASE");
            ps.setBoolean(4, true);
            ps.executeUpdate();
        }
    }
}
```

Namun untuk seed sederhana, SQL lebih reviewable daripada Java.

---

## 17. Liquibase Seeding Strategies

Liquibase memiliki beberapa mekanisme yang sering dipakai untuk seed:

- `insert`,
- `loadData`,
- `loadUpdateData`,
- raw SQL,
- contexts,
- labels,
- preconditions,
- rollback blocks.

---

### 17.1 Declarative insert

Contoh YAML:

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260617-001-seed-case-permission
      author: platform-team
      changes:
        - insert:
            tableName: permission
            columns:
              - column:
                  name: code
                  value: CASE_REOPEN
              - column:
                  name: description
                  value: Reopen closed cases
              - column:
                  name: module_code
                  value: CASE
              - column:
                  name: system_managed
                  valueBoolean: true
```

Kelebihan:

- portable,
- structured,
- mudah diberi rollback,
- bisa divalidasi Liquibase.

Kekurangan:

- verbose,
- kurang nyaman untuk banyak row,
- kadang kurang natural dibanding SQL.

---

### 17.2 Raw SQL changeset

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260617-002-seed-case-status
      author: platform-team
      changes:
        - sql:
            sql: |
              INSERT INTO case_status_ref (code, label_en, sort_order, active, system_managed)
              VALUES ('REOPENED', 'Reopened', 60, true, true);
```

Kelebihan:

- mudah dibaca SQL reviewer,
- cocok vendor-specific,
- natural untuk seed kompleks.

Kekurangan:

- portability lebih rendah,
- rollback manual,
- precondition perlu ditulis eksplisit.

---

### 17.3 `loadData` untuk CSV

Cocok untuk seed reference data banyak row.

File CSV:

```csv
code,name,active
ID,Indonesia,true
SG,Singapore,true
MY,Malaysia,true
```

Changelog:

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260617-003-load-country-ref
      author: platform-team
      changes:
        - loadData:
            tableName: country_ref
            file: db/changelog/data/country_ref.csv
            separator: ","
            columns:
              - column:
                  name: code
                  type: string
              - column:
                  name: name
                  type: string
              - column:
                  name: active
                  type: boolean
```

Kelebihan:

- data terpisah dari changelog,
- lebih mudah direview sebagai table,
- cocok untuk banyak row.

Kekurangan:

- update existing data perlu hati-hati,
- CSV diff bisa noisy,
- tidak ideal untuk data dengan dependency kompleks,
- tidak cocok untuk secret.

---

### 17.4 Contexts dan labels untuk seed

Liquibase contexts sering dipakai untuk environment targeting.

Contoh:

```yaml
databaseChangeLog:
  - changeSet:
      id: 20260617-004-seed-demo-user
      author: platform-team
      context: dev,test
      changes:
        - insert:
            tableName: demo_user
            columns:
              - column:
                  name: username
                  value: demo.officer
```

Ini bisa berguna, tetapi harus disiplin:

- production seed jangan bergantung pada context yang ambigu,
- dev/test seed harus jelas terpisah,
- jangan biarkan demo data masuk prod,
- pipeline harus eksplisit menjalankan context yang benar.

---

## 18. Production Seed vs Development Seed

### 18.1 Pisahkan secara tegas

Production seed:

- minimal,
- deterministic,
- auditable,
- no fake users,
- no dummy password,
- no sample cases,
- no demo transactions,
- no environment-only hacks.

Development seed:

- boleh lebih kaya,
- untuk local productivity,
- bisa punya dummy data,
- bisa direset,
- tidak boleh masuk production path.

---

### 18.2 Folder strategy

Flyway example:

```text
src/main/resources/db/migration/
  V20260617_001__create_tables.sql
  V20260617_002__seed_reference_data.sql

src/test/resources/db/testdata/
  V90000001__seed_test_users.sql
  V90000002__seed_test_cases.sql
```

Atau local-only path:

```text
src/dev/resources/db/devdata/
  V90000001__seed_local_demo_data.sql
```

Jangan campur:

```text
db/migration/V20260617_999__seed_dummy_users.sql
```

kecuali memang tidak pernah dipakai production dan pipeline menjaminnya.

---

### 18.3 Spring Boot data.sql trap

Spring Boot memiliki mekanisme `schema.sql` dan `data.sql`, tetapi dalam sistem serius yang memakai Flyway/Liquibase, jangan jadikan itu source utama schema/seed production.

Problem yang sering terjadi:

- `data.sql` berjalan di local tapi tidak di prod,
- urutan dengan JPA initialization membingungkan,
- migration tool punya history, `data.sql` tidak,
- data.sql bisa rerun tidak sengaja,
- environment behaviour beda.

Rule:

> Jika sudah memakai Flyway/Liquibase, jadikan seed production sebagai migration/changelog yang versioned dan auditable. Gunakan `data.sql` hanya untuk test/local convenience jika benar-benar dikontrol.

---

## 19. Idempotent Seed: Preview

Part berikutnya akan membahas idempotent dan deterministic seed secara mendalam. Namun di sini kita perlu preview.

Seed yang tidak idempotent:

```sql
INSERT INTO permission (code, description)
VALUES ('CASE_VIEW', 'View cases');
```

Jika dijalankan ulang, gagal karena duplicate key.

Seed idempotent:

PostgreSQL:

```sql
INSERT INTO permission (code, description)
VALUES ('CASE_VIEW', 'View cases')
ON CONFLICT (code)
DO UPDATE SET description = EXCLUDED.description;
```

Oracle:

```sql
MERGE INTO permission p
USING (
    SELECT 'CASE_VIEW' AS code, 'View cases' AS description FROM dual
) src
ON (p.code = src.code)
WHEN MATCHED THEN UPDATE SET p.description = src.description
WHEN NOT MATCHED THEN INSERT (code, description)
VALUES (src.code, src.description);
```

SQL Server:

```sql
IF NOT EXISTS (SELECT 1 FROM permission WHERE code = 'CASE_VIEW')
BEGIN
    INSERT INTO permission (code, description)
    VALUES ('CASE_VIEW', 'View cases');
END
ELSE
BEGIN
    UPDATE permission
    SET description = 'View cases'
    WHERE code = 'CASE_VIEW';
END
```

Tetapi idempotent bukan berarti selalu aman. `UPDATE` bisa overwrite perubahan production yang sah.

Pertanyaan penting:

> Apakah seed ini system-owned sehingga boleh direconcile oleh migration, atau business-owned sehingga tidak boleh dioverwrite?

---

## 20. Seed Mutability Model

Untuk setiap seed, tentukan mutability model.

| Model | Meaning | Example | Migration Behaviour |
|---|---|---|---|
| Immutable | Setelah dibuat tidak boleh berubah | historical status code | insert once, never update/delete |
| System-owned mutable | Engineering boleh update via release | permission description, template default | upsert/versioned migration |
| Business-owned mutable | Business boleh update | SLA threshold, template text tertentu | avoid overwrite, use admin/audit |
| Environment-owned | berbeda per env | endpoint toggle, test config | config/secrets/env-specific |
| Runtime-owned | berubah karena operasi | job state, counters | never seed via migration except init |

Setiap seed file harus jelas masuk kategori mana.

---

## 21. Seed Lifecycle

Seed data punya lifecycle seperti code.

### 21.1 Introduce

Menambah value baru.

```sql
INSERT INTO case_status_ref (code, label_en, sort_order, active, system_managed)
VALUES ('REOPENED', 'Reopened', 60, true, true);
```

### 21.2 Modify metadata

Mengubah label, sort order, description.

```sql
UPDATE case_status_ref
SET label_en = 'Re-opened'
WHERE code = 'REOPENED';
```

Harus tahu apakah historical display boleh berubah.

### 21.3 Deprecate

Menandai value tidak dipakai untuk data baru.

```sql
UPDATE case_status_ref
SET active = false
WHERE code = 'LEGACY_REVIEW';
```

### 21.4 Migrate usage

Mengubah transactional data yang memakai value lama.

```sql
UPDATE case_record
SET status = 'UNDER_REVIEW'
WHERE status = 'LEGACY_REVIEW';
```

Ini bukan lagi seed biasa, tetapi data migration/backfill.

### 21.5 Remove

Delete seed value jarang aman.

Sebelum delete:

```sql
SELECT COUNT(*) FROM case_record WHERE status = 'LEGACY_REVIEW';
```

Jika masih ada usage, jangan delete.

---

## 22. Seed and Application Startup

Aplikasi Java sering membutuhkan seed sebelum start.

Contoh failure:

```java
Permission permission = permissionRepository.findByCode("CASE_REOPEN")
    .orElseThrow(() -> new IllegalStateException("Missing permission"));
```

Jika migration belum run, aplikasi start gagal.

Ini baik atau buruk?

Tergantung.

Untuk critical seed, fail-fast lebih baik daripada silently wrong behaviour.

Pattern:

```text
Migration runs -> application starts -> startup validators verify critical reference data -> traffic enabled
```

Dalam Kubernetes:

```text
init job / pre-deploy job: run Flyway/Liquibase
app deployment: start app
readiness probe: only ready after validators pass
```

Jangan biarkan aplikasi menerima traffic sebelum contract database siap.

---

## 23. Seed in CI/CD

Seed harus menjadi bagian pipeline.

Minimal pipeline:

```text
1. compile app
2. run unit tests
3. create empty database
4. run all migrations including seed
5. start app against migrated DB
6. run integration tests
7. run seed validators
8. run upgrade test from previous release DB
9. generate migration report
10. package artifact
```

Untuk seed critical:

- test empty DB,
- test existing DB upgrade,
- test seed expected values,
- test no duplicate,
- test no missing permission,
- test no invalid foreign key,
- test template placeholder contract,
- test workflow graph consistency.

---

## 24. Seed Review Checklist

Sebelum merge seed migration, reviewer harus tanya:

1. Data ini termasuk kategori apa?
2. Apakah ini reference/master/bootstrap/config/test/demo/runtime data?
3. Apakah data ini boleh masuk production?
4. Apakah ada secret/default password?
5. Apakah ada environment-specific value?
6. Apakah ada owner business/security?
7. Apakah migration ini deterministic?
8. Apakah natural key jelas?
9. Apakah seed bisa dijalankan ulang atau tidak perlu?
10. Apakah update bisa overwrite production change yang sah?
11. Apakah ada FK dependency?
12. Apakah ada transactional data yang sudah memakai value lama?
13. Apakah delete/inactive aman?
14. Apakah perlu rollback atau roll-forward plan?
15. Apakah perlu startup validator?
16. Apakah perlu testcontainers/integration test?
17. Apakah seed readable sebagai audit document?
18. Apakah behaviour aplikasi berubah karena seed ini?
19. Apakah security impact sudah direview?
20. Apakah pipeline memastikan seed jalan sebelum app start?

---

## 25. Common Anti-Patterns

### 25.1 Dummy data masuk production migration

```sql
INSERT INTO user_account (username, email)
VALUES ('test-user', 'test@example.com');
```

Masalah:

- data palsu di prod,
- audit noise,
- security risk,
- report salah.

---

### 25.2 Default admin password

```sql
INSERT INTO users (username, password)
VALUES ('admin', 'admin123');
```

Ini critical security smell.

---

### 25.3 Manual seed di production

```text
Developer sends SQL in chat.
DBA runs manually.
No migration history.
No source control.
```

Akibat:

- drift,
- audit gap,
- cannot reproduce,
- rollback unclear.

---

### 25.4 Editing old seed migration

Flyway checksum mismatch atau Liquibase checksum mismatch bisa terjadi.

Jangan edit migration yang sudah apply di shared environment kecuali memang mengikuti controlled repair process.

Buat migration baru:

```text
V20260617_010__add_case_reopen_permission.sql
V20260620_003__correct_case_reopen_permission_description.sql
```

---

### 25.5 Delete-and-reinsert seed

Buruk:

```sql
DELETE FROM permission;
INSERT INTO permission (...);
```

Jika ada FK ke permission, gagal atau merusak mapping.

Lebih baik explicit upsert/inactive.

---

### 25.6 Sequence-generated IDs untuk reference data yang direferensi code

Buruk:

```sql
INSERT INTO case_status_ref (id, code)
VALUES (nextval('case_status_seq'), 'APPROVED');
```

Lalu Java code menyimpan asumsi `id=4`.

Jangan pernah membuat code bergantung pada generated ID reference data. Gunakan stable code/natural key.

---

### 25.7 Seed sebagai replacement admin UI

Jika business perlu sering mengubah SLA threshold, jangan tiap perubahan harus migration release. Buat admin config process dengan audit.

---

### 25.8 Overusing environment contexts

Liquibase contexts atau Flyway location berbeda bisa membantu, tetapi jika terlalu banyak branching:

```text
dev seed beda
sit seed beda
uat seed beda
prod seed beda
```

Maka behaviour sulit diprediksi.

Default strategy:

```text
Production seed is canonical.
Dev/test may add extra data on top, never alter core behaviour silently.
```

---

## 26. Recommended Repository Layout

### 26.1 Flyway

```text
src/main/resources/
  db/
    migration/
      V20260617_001__create_reference_tables.sql
      V20260617_002__seed_case_status_ref.sql
      V20260617_003__seed_permissions.sql
      V20260617_004__seed_workflow_states.sql
      V20260617_005__seed_workflow_transitions.sql
    repeatable/
      R__refresh_reporting_views.sql

src/test/resources/
  db/
    testdata/
      V90000001__seed_test_users.sql
      V90000002__seed_test_cases.sql
```

Or if using multiple Flyway locations:

```text
classpath:db/migration
classpath:db/seed/prod
classpath:db/seed/dev
classpath:db/testdata
```

But production pipeline should only include production-safe locations.

---

### 26.2 Liquibase

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  reference/
    001-create-reference-tables.yaml
    002-seed-case-status.yaml
  security/
    001-create-security-tables.yaml
    002-seed-permissions.yaml
    003-seed-system-roles.yaml
  workflow/
    001-create-workflow-tables.yaml
    002-seed-case-workflow.yaml
  data/
    country_ref.csv

src/test/resources/db/changelog-test/
  testdata-users.yaml
  testdata-cases.yaml
```

Master changelog:

```yaml
databaseChangeLog:
  - include:
      file: db/changelog/reference/001-create-reference-tables.yaml
  - include:
      file: db/changelog/reference/002-seed-case-status.yaml
  - include:
      file: db/changelog/security/001-create-security-tables.yaml
  - include:
      file: db/changelog/security/002-seed-permissions.yaml
  - include:
      file: db/changelog/security/003-seed-system-roles.yaml
  - include:
      file: db/changelog/workflow/001-create-workflow-tables.yaml
  - include:
      file: db/changelog/workflow/002-seed-case-workflow.yaml
```

---

## 27. Practical Decision Framework

Gunakan pertanyaan berikut untuk menentukan strategi seed.

### 27.1 Should this be in migration?

```text
Is this data required for application contract?
  no  -> not migration seed
  yes -> continue

Is this data safe and valid in production?
  no  -> dev/test seed only
  yes -> continue

Is this data controlled by release process?
  yes -> versioned migration/changelog
  no  -> admin/config/import process

Can this data be changed by business users?
  yes -> avoid overwriting with repeatable seed
  no  -> system-owned seed is okay

Does this data contain secret or credential?
  yes -> never put in migration
  no  -> continue
```

---

### 27.2 Versioned or repeatable?

```text
Is every change historically meaningful?
  yes -> versioned migration

Is it a full snapshot of system-owned reference data?
  maybe -> repeatable possible

Can production user/admin edit it?
  yes -> avoid repeatable overwrite

Does it have large volume?
  yes -> prefer versioned/chunked/import strategy
```

---

### 27.3 SQL, CSV, or Java?

```text
Few rows, clear dependency:
  SQL/changelog insert

Many tabular rows:
  CSV/loadData or SQL bulk insert

Complex transformation/validation:
  Java migration or controlled batch job

Business-owned import:
  admin/import process, not migration
```

---

## 28. Example: New Case Reopen Feature

Misalnya kita menambahkan fitur reopen case.

Dibutuhkan:

1. permission `CASE_REOPEN`,
2. status `REOPENED`,
3. workflow transition `APPROVED -> REOPENED`,
4. feature flag `CASE_REOPEN_FLOW`,
5. notification template `CASE_REOPENED_EMAIL`,
6. optional role-permission mapping.

### 28.1 Migration plan

```text
V20260617_001__seed_case_reopen_permission.sql
V20260617_002__seed_case_reopened_status.sql
V20260617_003__seed_case_reopen_feature_flag.sql
V20260617_004__seed_case_reopen_workflow_transition.sql
V20260617_005__seed_case_reopened_notification_template.sql
```

Role-permission mapping might be separate:

```text
V20260617_006__grant_case_reopen_to_senior_officer.sql
```

But only if approved by security/business.

---

### 28.2 Flyway SQL example

```sql
-- V20260617_001__seed_case_reopen_permission.sql
-- Introduces permission required by the Case Reopen feature.

INSERT INTO permission (code, description, module_code, system_managed)
VALUES ('CASE_REOPEN', 'Reopen closed cases', 'CASE', true);
```

```sql
-- V20260617_002__seed_case_reopened_status.sql
-- Introduces new case status used after a closed case is reopened.

INSERT INTO case_status_ref (code, label_en, sort_order, active, system_managed)
VALUES ('REOPENED', 'Reopened', 60, true, true);
```

```sql
-- V20260617_003__seed_case_reopen_feature_flag.sql
-- Defines feature flag as disabled by default.
-- Actual production enablement requires release approval.

INSERT INTO feature_flag (code, enabled, description, system_managed)
VALUES (
    'CASE_REOPEN_FLOW',
    false,
    'Enable case reopen workflow. Default disabled.',
    true
);
```

---

### 28.3 Validation queries

```sql
SELECT code FROM permission WHERE code = 'CASE_REOPEN';
SELECT code FROM case_status_ref WHERE code = 'REOPENED';
SELECT code, enabled FROM feature_flag WHERE code = 'CASE_REOPEN_FLOW';
SELECT * FROM workflow_transition WHERE action_code = 'REOPEN';
SELECT code FROM notification_template WHERE code = 'CASE_REOPENED_EMAIL';
```

---

## 29. Example: Bad Seed vs Good Seed

### 29.1 Bad

```sql
INSERT INTO app_config VALUES ('payment.url', 'https://dev-payment.example.com');
INSERT INTO users VALUES (1, 'admin', 'admin123');
INSERT INTO role_permission VALUES ('OFFICER', 'CASE_DELETE');
DELETE FROM case_status_ref;
INSERT INTO case_status_ref VALUES (1, 'DRAFT');
INSERT INTO case_status_ref VALUES (2, 'APPROVED');
```

Problems:

- environment-specific URL,
- default password,
- dangerous permission grant,
- delete-and-reinsert,
- generated numeric IDs,
- no comments,
- no audit intent,
- possible FK breakage.

### 29.2 Better

```sql
-- Defines the payment integration config key only.
-- Environment-specific value must be supplied by config management.
INSERT INTO app_config_definition (config_key, value_type, required, description)
VALUES (
    'payment.url',
    'URL',
    true,
    'Payment service endpoint. Value is environment-managed.'
);

-- Defines system permission only. Role grants require separate approval.
INSERT INTO permission (code, description, module_code, system_managed)
VALUES ('CASE_DELETE', 'Delete case record', 'CASE', true);

-- Adds new case status without deleting existing historical statuses.
INSERT INTO case_status_ref (code, label_en, sort_order, active, system_managed)
VALUES ('ARCHIVED', 'Archived', 90, true, true);
```

---

## 30. Practical Standards for Top-Tier Teams

A mature team usually has seed standards like these:

1. Every production seed is source-controlled.
2. Every production seed is migration-history-controlled.
3. Seed files are immutable after applied to shared environments.
4. Dev/test/demo seed is separated from production seed.
5. No credential, token, private key, or secret in seed.
6. No dummy user in production seed.
7. Stable natural keys are mandatory for reference data.
8. Code must not depend on generated numeric IDs.
9. System-owned and business-owned data are clearly marked.
10. Repeatable seed is only allowed for system-owned deterministic snapshots.
11. Role-permission mapping requires security/business review.
12. Workflow seed must be graph-validated.
13. Template seed must be placeholder-validated.
14. Seed change must include validation query or automated test.
15. Startup validators exist for critical reference data.
16. Migration pipeline tests empty DB and upgrade DB.
17. Manual production seed changes are prohibited or formally reconciled.
18. Seed drift is detectable.
19. Deletion of seed used by transactional data requires explicit impact analysis.
20. Seed is treated as behavioural contract, not convenience data.

---

## 31. Java-Specific Considerations

### 31.1 Java 8

In Java 8 projects:

- use simple enum validation,
- avoid relying on newer language features,
- use JDBC/JdbcTemplate for startup validators,
- ensure Flyway/Liquibase version supports Java 8,
- be careful with old build plugins.

### 31.2 Java 11

Java 11 is common for long-lived enterprise systems.

- good baseline for modern libraries,
- still may require older Liquibase/Flyway versions depending org constraints,
- Testcontainers usable but version should be aligned.

### 31.3 Java 17

Java 17 is a major enterprise baseline.

- works well with modern Spring Boot 3.x,
- better runtime support,
- Liquibase 5.x line targets Java 17+,
- easier to standardize modern pipeline.

### 31.4 Java 21

Java 21 LTS is a strong modern baseline.

- useful for new Spring Boot/Jakarta projects,
- virtual threads are not directly relevant to seed migration but can affect batch/backfill job design,
- keep migration execution deterministic and bounded.

### 31.5 Java 25

Java 25 is a newer LTS generation.

For migration/seeding, the principles remain the same:

- avoid tying migration logic to fancy runtime features,
- ensure build plugins and migration tools support the JDK,
- treat DB migration as deployment contract, not runtime optimization exercise.

---

## 32. Summary Mental Model

Seeding is not “initial data”.

Seeding is controlled creation and evolution of data that shapes application behaviour.

A strong engineer asks:

```text
What kind of data is this?
Who owns it?
Is it production-safe?
Is it release-controlled?
Can business users change it?
Can it be re-run?
Can it overwrite legitimate production changes?
Does code depend on it?
Does it need audit?
Does it need validation?
Does it affect security or workflow?
```

Good seeding strategy prevents:

- missing permission bugs,
- inconsistent workflow behaviour,
- environment drift,
- dummy production data,
- dangerous default admin users,
- broken dropdowns,
- failed startup,
- corrupted reference data,
- untraceable manual hotfixes,
- compliance audit gaps.

Top-tier engineering treats seed data as a first-class artifact of the release.

---

## 33. What You Should Be Able to Do After This Part

After this part, you should be able to:

1. distinguish reference data, master data, bootstrap data, config data, test data, demo data, and transactional data;
2. decide whether a data row belongs in migration or not;
3. design production-safe seed strategy;
4. separate production seed from dev/test data;
5. identify seed ownership and review responsibility;
6. avoid seed drift;
7. design permission, workflow, feature flag, and template seed safely;
8. choose Flyway or Liquibase seeding mechanisms appropriately;
9. recognize dangerous anti-patterns;
10. frame seed data as behavioural contract.

---

## 34. Connection to Next Part

Part ini membahas **kategori dan strategi seeding**.

Part berikutnya akan masuk lebih dalam ke:

# Part 18 — Idempotent and Deterministic Seed Design

Kita akan membahas:

- natural key vs surrogate key,
- stable identifiers,
- UUID vs sequence,
- upsert pattern,
- merge pattern,
- insert-if-not-exists pattern,
- delete-and-reinsert danger,
- mutating existing production config,
- seed checksum,
- environment overlay,
- avoiding generated password,
- seed testing,
- dan bagaimana menulis seed yang aman dijalankan ulang tanpa merusak production.

---

## Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - berikutnya
```

Total rencana: **34 part**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 16 — Flyway vs Liquibase: Decision Framework](./16-flyway-vs-liquibase-decision-framework.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Idempotent and Deterministic Seed Design](./18-idempotent-deterministic-seed-design.md)

# 29 — Security, Compliance, and Auditability in Database Migration

> Seri: `learn-java-database-migrations-seedings-flyway-liquibase`  
> Bagian: `29-security-compliance-auditability.md`  
> Fokus: bagaimana membuat database migration dan seeding aman, dapat diaudit, dapat dipertanggungjawabkan, dan layak untuk sistem enterprise/regulatory/production-critical.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- mental model database change;
- taxonomy perubahan;
- invariants dan failure model;
- Flyway dan Liquibase;
- seeding;
- backfill;
- expand/contract;
- locking dan online DDL;
- vendor-specific behavior;
- testing;
- Spring Boot / Jakarta EE / plain Java integration;
- CI/CD pipeline;
- multi-service dan multi-tenant migration.

Bagian ini menjawab pertanyaan yang lebih serius:

> Bagaimana memastikan database migration bukan hanya berhasil secara teknis, tetapi juga aman, terkontrol, traceable, dan bisa dipertanggungjawabkan saat audit, incident review, compliance review, atau regulatory investigation?

Untuk engineer biasa, migration adalah file SQL.

Untuk engineer matang, migration adalah **privileged operation against critical state**.

Artinya, migration harus diperlakukan seperti operasi sensitif:

- siapa boleh menjalankan;
- apa yang boleh diubah;
- kapan boleh dijalankan;
- bagaimana bukti approval disimpan;
- bagaimana perubahan diverifikasi;
- bagaimana data sensitif dilindungi;
- bagaimana incident bisa ditelusuri;
- bagaimana perubahan manual dicegah;
- bagaimana pipeline mencegah bypass.

---

## 2. Core Mental Model: Migration Is a Privileged State Mutation

Application code biasanya berjalan dengan hak akses terbatas:

- select data;
- insert transactional records;
- update business state;
- maybe delete within domain boundary.

Migration berbeda. Migration sering memiliki hak untuk:

- create table;
- alter table;
- drop column;
- create index;
- drop constraint;
- update millions of rows;
- modify roles/permissions seed;
- change reference data;
- create database objects;
- manipulate stored procedures;
- grant privileges;
- create schemas;
- sometimes access sensitive columns during transformation.

Karena itu, migration adalah operasi dengan blast radius besar.

Satu migration buruk dapat menyebabkan:

- data loss;
- privilege escalation;
- production outage;
- data corruption;
- regulatory breach;
- audit gap;
- unrecoverable schema drift;
- inconsistent tenant version;
- failed rollback;
- incident yang sulit direkonstruksi.

Jadi prinsip dasarnya:

> Database migration harus diperlakukan sebagai controlled, reviewed, immutable, observable, least-privilege, auditable state transition.

---

## 3. Threat Model untuk Database Migration

Sebelum bicara tool, kita perlu tahu ancamannya.

Threat model migration bukan hanya hacker eksternal. Banyak risiko berasal dari proses internal.

### 3.1 Accidental destructive migration

Contoh:

```sql
ALTER TABLE customer DROP COLUMN email;
```

Atau:

```sql
UPDATE user_account SET status = 'INACTIVE';
```

tanpa `WHERE`.

Risikonya:

- data hilang;
- aplikasi error;
- laporan salah;
- customer impact;
- sulit rollback.

### 3.2 Unauthorized manual production change

Contoh:

- developer login langsung ke production DB;
- DBA menjalankan hotfix manual;
- support mengubah lookup data;
- engineer memperbaiki checksum dengan edit history table;
- privilege table diubah tanpa review.

Risikonya:

- environment drift;
- audit gap;
- migration berikutnya gagal;
- history Flyway/Liquibase tidak merefleksikan real state;
- impossible root cause analysis.

### 3.3 Privilege escalation through seed data

Seed data dapat menjadi security vulnerability.

Contoh:

```sql
INSERT INTO role_permission(role_code, permission_code)
VALUES ('USER', 'ADMIN_DELETE_CASE');
```

Atau:

```sql
UPDATE user_role SET role_code = 'SUPER_ADMIN'
WHERE username = 'demo';
```

Risikonya:

- user biasa mendapat privilege tinggi;
- dormant account menjadi admin;
- test account masuk production;
- backdoor tidak sengaja atau sengaja tertanam.

### 3.4 Secret leakage in migration files

Contoh buruk:

```sql
INSERT INTO integration_config(code, api_key)
VALUES ('PAYMENT_GATEWAY', 'sk_live_xxx');
```

Atau:

```yaml
password: my-prod-password
```

Risiko:

- secret masuk Git;
- secret masuk CI log;
- secret masuk artifact;
- secret masuk backup;
- secret tersebar ke developer laptop.

### 3.5 PII exposure during data migration

Data migration sering membaca dan menulis data sensitif:

- name;
- email;
- phone;
- address;
- national id;
- birth date;
- case detail;
- financial data;
- health-related data;
- enforcement/regulatory records.

Risiko:

- log mencetak PII;
- migration report menyimpan sensitive rows;
- exception stack trace mengandung data;
- test dataset memakai production dump tanpa masking;
- temporary table tidak dibersihkan.

### 3.6 Tampered migration artifact

Contoh:

- file migration diubah setelah approval;
- migration artifact diganti sebelum deployment;
- script di environment UAT berbeda dari production;
- checksum mismatch di-repair tanpa review.

Risiko:

- production menjalankan script yang tidak pernah direview;
- audit evidence tidak valid;
- tidak ada chain of custody.

### 3.7 Compliance gap

Dalam sistem regulated, pertanyaan audit biasanya bukan:

> Apakah migration berhasil?

Tetapi:

- siapa yang mengusulkan perubahan?
- siapa yang mereview?
- siapa yang approve?
- kapan dijalankan?
- artifact mana yang dijalankan?
- hasilnya apa?
- apakah ada rollback plan?
- apakah ada evidence testing?
- apakah ada segregation of duties?
- apakah ada unauthorized production access?
- apakah data sensitif terlindungi?

Jika sistem tidak bisa menjawab pertanyaan ini, secara governance ia lemah, walaupun aplikasi berjalan.

---

## 4. Security Boundary: App User vs Migration User

Salah satu kesalahan paling umum:

> aplikasi runtime dan migration memakai database user yang sama.

Ini berbahaya.

### 4.1 Mengapa runtime app user tidak boleh terlalu powerful

Runtime app user seharusnya tidak bisa:

- drop table;
- alter table;
- create schema;
- grant privilege;
- truncate table;
- drop index;
- manipulate migration history;
- alter security-related object sembarangan.

Jika aplikasi punya hak DDL penuh, maka bug aplikasi, SQL injection, compromised container, atau leaked credential dapat menjadi full database compromise.

### 4.2 Ideal separation

Minimal ada dua principal:

| Principal | Dipakai oleh | Hak akses |
|---|---|---|
| Application user | aplikasi runtime | DML terbatas pada schema/domain yang dibutuhkan |
| Migration user | pipeline/deployment job | DDL/DML migration yang diperlukan |

Dalam sistem besar, bisa lebih detail:

| Principal | Fungsi |
|---|---|
| `app_rw` | runtime read/write transactional tables |
| `app_ro` | reporting/read-only queries |
| `migration_schema_owner` | create/alter/drop object |
| `migration_data_fixer` | controlled data correction |
| `seed_operator` | insert/update reference data |
| `audit_reader` | read audit/history only |
| `dba_admin` | emergency privileged operation |

### 4.3 Rule praktis

> Application runtime user should not be able to perform schema migration.

> Migration user should not be used by application runtime.

> Emergency DBA/admin access should be exceptional, logged, approved, and reconciled back into migration history.

---

## 5. Least Privilege for Migration User

Banyak tim berpikir migration user harus menjadi owner/superuser. Kadang memang praktis, tetapi bukan selalu perlu.

Prinsipnya:

> Beri hak minimum yang cukup untuk menjalankan migration yang disetujui.

Namun, implementasinya bergantung DBMS.

### 5.1 PostgreSQL example mental model

Runtime app user mungkin hanya perlu:

```sql
GRANT USAGE ON SCHEMA app TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_user;
```

Migration user mungkin butuh:

```sql
GRANT USAGE, CREATE ON SCHEMA app TO migration_user;
```

Namun untuk alter/drop object yang dimiliki role lain, ownership matters. Maka sering digunakan role ownership model:

- schema object dimiliki oleh dedicated owner role;
- migration job dapat assume/set role tertentu;
- app user diberi privilege, bukan ownership.

Mental model:

```text
owner_role owns objects
migration_user can deploy as owner_role
app_user only consumes objects
```

### 5.2 Oracle example mental model

Oracle sering berbasis schema user. Jika schema adalah user, maka migration biasanya dijalankan sebagai schema owner atau user dengan privilege object tertentu.

Yang perlu dijaga:

- runtime user jangan memakai schema owner jika tidak perlu;
- grant hanya object privilege yang dibutuhkan;
- hindari `DBA` role untuk migration normal;
- pisahkan user untuk DDL dan app runtime jika arsitektur memungkinkan;
- audit DDL operation.

Contoh konseptual:

```text
APP_OWNER      : owns tables/views/packages
APP_RUNTIME    : SELECT/INSERT/UPDATE/DELETE on necessary objects
MIGRATION_USER : controlled DDL path, possibly deploys as APP_OWNER or via pipeline credential
```

### 5.3 MySQL/MariaDB mental model

Runtime user sebaiknya tidak memiliki:

- `ALTER`;
- `DROP`;
- `CREATE`;
- `GRANT OPTION`;
- `SUPER`-like privilege;
- broad privileges on all databases.

Migration user dapat diberi DDL privilege pada database tertentu saja.

### 5.4 SQL Server mental model

Pisahkan:

- schema owner;
- application login/user;
- migration login/user;
- role membership.

Hindari aplikasi runtime sebagai `db_owner`.

---

## 6. Migration History Table as Security Evidence

Flyway dan Liquibase sama-sama menyimpan metadata eksekusi migration.

Flyway biasanya memakai schema history table.

Liquibase memakai `DATABASECHANGELOG` dan lock table `DATABASECHANGELOGLOCK`.

Tabel ini bukan sekadar teknis. Ia adalah evidence.

### 6.1 Apa yang biasanya dapat dibuktikan

Migration history bisa membantu menjawab:

- migration mana yang sudah dijalankan;
- urutannya;
- waktu eksekusi;
- checksum;
- status success/failure;
- siapa/apa yang menjalankan;
- versi script yang dianggap valid oleh tool.

### 6.2 Apa yang tidak otomatis dibuktikan

Migration history tidak otomatis menjawab:

- apakah migration sudah direview;
- apakah ticket-nya disetujui;
- apakah script yang sama dengan Git commit tertentu;
- apakah pipeline yang menjalankan punya approval;
- apakah ada manual DB change di luar tool;
- apakah data berubah setelah migration;
- apakah migration aman dari PII leakage;
- apakah rollback plan ada.

Karena itu, migration history harus dihubungkan dengan:

- Git commit;
- pull request;
- build artifact;
- CI/CD run id;
- deployment ticket;
- approval evidence;
- change request id;
- release version;
- production operation log.

### 6.3 Best practice: metadata correlation

Setiap migration deployment idealnya punya correlation metadata:

```text
release_version    = 2026.06.17.1
build_id           = ci-829193
commit_sha         = 9f2c0e...
change_request_id  = CR-2026-0812
pipeline_run_id    = github-actions-123456789
operator           = deployment-service-account
environment        = production
migration_tool     = flyway/liquibase
```

Tool belum tentu menyimpan semua ini di schema history. Maka pipeline log dan deployment record harus menyimpannya.

---

## 7. Immutable Migration Artifact

Prinsip penting:

> Production harus menjalankan artifact yang sama dengan yang diuji dan disetujui.

Bukan menjalankan file terbaru dari branch secara ad hoc.

### 7.1 Artifact yang immutable bisa berupa

- application jar yang berisi migration;
- dedicated migration jar;
- container image migration runner;
- tar/zip SQL artifact;
- Liquibase changelog artifact;
- Flyway migration bundle;
- pipeline artifact dengan checksum.

### 7.2 Anti-pattern

Buruk:

```text
prod deploy pulls latest main branch and runs migrations from workspace
```

Masalah:

- tidak jelas commit mana;
- branch bisa berubah;
- artifact tidak frozen;
- approval bisa tidak sinkron dengan script;
- reproducibility buruk.

Lebih baik:

```text
Build once -> test artifact -> approve artifact -> promote same artifact -> run in prod
```

### 7.3 Artifact chain

```text
Source code
   ↓
Pull request review
   ↓
CI build
   ↓
Migration artifact generated
   ↓
Artifact checksum recorded
   ↓
Test migration in lower environment
   ↓
Approval references artifact checksum
   ↓
Production pipeline runs same artifact
   ↓
Migration history + pipeline evidence recorded
```

---

## 8. Checksum Integrity

Flyway dan Liquibase memakai checksum untuk mendeteksi perubahan file/changelog yang sudah pernah dijalankan.

Checksum bukan fitur kecil. Ia adalah guardrail integrity.

### 8.1 Mengapa checksum penting

Tanpa checksum:

1. migration `V10__add_column.sql` dijalankan di UAT;
2. file yang sama diubah sebelum production;
3. production menjalankan isi berbeda dengan nama sama;
4. history terlihat sama secara nama, tetapi perubahan berbeda.

Checksum mencegah silent tampering.

### 8.2 Checksum mismatch bukan sekadar error teknis

Checksum mismatch berarti:

> Isi migration yang dianggap sudah final telah berubah.

Kemungkinan penyebab:

- developer mengedit migration lama;
- formatting change;
- line ending berubah;
- placeholder berubah;
- merge conflict resolution salah;
- artifact berbeda;
- script tampered;
- manual repair tidak terdokumentasi.

### 8.3 Response yang benar

Jangan langsung repair.

Langkah sehat:

1. identifikasi migration yang mismatch;
2. bandingkan file di Git dengan artifact yang pernah dijalankan;
3. cek environment mana yang sudah menjalankan versi lama;
4. tentukan apakah perubahan hanya komentar/format atau semantic change;
5. jika semantic, buat migration baru;
6. jika benar-benar non-semantic dan disetujui, lakukan repair dengan evidence;
7. simpan approval dan alasan.

### 8.4 Rule praktis

> Jangan edit migration versioned yang sudah pernah dijalankan di shared environment.

Jika perlu perubahan, buat migration baru.

---

## 9. Production Access Control

Migration aman bukan hanya soal script. Production access harus dikontrol.

### 9.1 Siapa boleh menjalankan migration?

Idealnya:

- bukan laptop developer;
- bukan manual DB console;
- bukan ad hoc SSH;
- bukan copy-paste SQL dari chat;
- bukan user personal.

Lebih baik:

- pipeline service account;
- limited migration role;
- environment-specific credential;
- approval gate;
- audit log;
- immutable artifact.

### 9.2 Personal account vs service account

Personal account berguna untuk accountability, tetapi tidak ideal untuk automated migration.

Service account berguna untuk automation, tetapi harus tetap bisa dikorelasikan ke approval dan actor manusia.

Pattern yang baik:

```text
Human approves change request
Pipeline records approver
Pipeline runs as migration service account
Database audit records service account
Pipeline audit links service account execution to human approval
```

### 9.3 Break-glass access

Emergency access kadang dibutuhkan.

Tetapi harus:

- time-bound;
- approved;
- logged;
- monitored;
- reviewed after use;
- reconciled into migration repository jika ada schema/data change.

Break-glass yang tidak direkonsiliasi akan menciptakan drift.

---

## 10. Manual Hotfix: Controlled Exception, Not Normal Workflow

Manual production hotfix bisa terjadi. Misalnya:

- production outage;
- broken migration lock;
- corrupt reference data;
- urgent data correction;
- blocking index issue;
- failed deployment window.

Tetapi manual hotfix harus dianggap **exception**, bukan workflow normal.

### 10.1 Manual hotfix checklist

Sebelum manual execution:

- apa problem-nya;
- apa scope data/schema;
- apakah ada backup/restore point;
- apakah ada exact SQL;
- siapa reviewer;
- siapa approver;
- kapan dijalankan;
- bagaimana verifikasi;
- bagaimana rollback/compensation;
- bagaimana direkonsiliasi ke Flyway/Liquibase.

### 10.2 Setelah manual hotfix

Harus dibuat follow-up migration:

- jika schema diubah manual, tambahkan migration yang merepresentasikan state final;
- jika data correction dilakukan, simpan evidence dan mungkin buat controlled data migration;
- jika migration history perlu repair, lakukan dengan approval;
- update runbook agar tidak terulang.

### 10.3 Anti-pattern

```text
Production fixed manually. Tidak perlu masuk repo karena sudah selesai.
```

Ini hampir selalu buruk.

Mengapa?

- environment lain tidak punya perubahan;
- next deployment gagal;
- audit trail terputus;
- root cause masa depan sulit;
- engineer baru tidak tahu real schema.

---

## 11. Approval Evidence and Segregation of Duties

Dalam sistem enterprise, terutama regulated, perubahan production tidak cukup “sudah di-merge”.

Perlu evidence.

### 11.1 Evidence minimum

Untuk migration penting, simpan:

- ticket/change request id;
- business justification;
- technical design summary;
- migration script link;
- risk assessment;
- test evidence;
- rollback/roll-forward plan;
- reviewer;
- approver;
- scheduled window;
- production execution log;
- post-deployment verification.

### 11.2 Segregation of duties

Prinsipnya:

> Orang yang membuat perubahan idealnya bukan satu-satunya orang yang menyetujui dan menjalankan production change.

Dalam tim kecil ini sering sulit, tetapi tetap bisa dibuat lightweight:

- author membuat migration;
- reviewer memeriksa;
- lead/PM/owner approve;
- pipeline menjalankan;
- post-check dilakukan oleh operator/reviewer berbeda jika memungkinkan.

### 11.3 Approval bukan formalitas

Reviewer harus memeriksa:

- apakah migration destructive;
- apakah ada lock risk;
- apakah ada PII risk;
- apakah seed memengaruhi permission;
- apakah script idempotent jika seeding;
- apakah rollback/roll-forward masuk akal;
- apakah old app dan new app compatible;
- apakah ada environment-specific assumption;
- apakah ada manual step tersembunyi.

---

## 12. Security Review Checklist for Migration Pull Request

Gunakan checklist seperti ini saat review PR migration.

### 12.1 General

- Apakah migration sudah diberi nama jelas?
- Apakah migration version tidak bentrok?
- Apakah migration sudah diuji dari database kosong?
- Apakah migration sudah diuji dari previous release state?
- Apakah migration mengubah object yang benar?
- Apakah ada dependency ke migration lain?
- Apakah script deterministic?

### 12.2 Destructive change

- Apakah ada `DROP`?
- Apakah ada `TRUNCATE`?
- Apakah ada delete massal?
- Apakah ada alter type berisiko?
- Apakah ada column rename/drop?
- Apakah ada constraint yang bisa gagal di production?
- Apakah ada backup atau compensation plan?

### 12.3 Security-sensitive data

- Apakah menyentuh user/role/permission?
- Apakah menyentuh authentication/authorization tables?
- Apakah membuat admin/default account?
- Apakah menyimpan password/token/secret?
- Apakah menyentuh encryption key metadata?
- Apakah ada PII di SQL literal?

### 12.4 Operational risk

- Apakah migration bisa long-running?
- Apakah akan lock table besar?
- Apakah ada index build besar?
- Apakah ada transaction besar?
- Apakah ada statement timeout?
- Apakah ada lock timeout?
- Apakah ada chunking?
- Apakah bisa resume?

### 12.5 Auditability

- Apakah ticket id dicantumkan?
- Apakah business reason jelas?
- Apakah expected effect bisa diverifikasi?
- Apakah ada query verifikasi?
- Apakah ada rollback/roll-forward note?
- Apakah artifact immutable?

---

## 13. Data Masking and Test Data Safety

Migration test sering butuh dataset realistis. Risiko muncul ketika production data dipakai untuk testing tanpa masking.

### 13.1 Production dump risk

Production dump dapat berisi:

- nama;
- email;
- nomor identitas;
- alamat;
- nomor telepon;
- dokumen;
- case notes;
- audit logs;
- business-sensitive records.

Jika dump dipakai di laptop/local dev:

- data tersebar;
- backup laptop bisa mengandung PII;
- logs test bisa mencetak data;
- developer tools bisa index data;
- legal/compliance risk besar.

### 13.2 Strategi aman

Gunakan:

- synthetic dataset;
- masked production-like dataset;
- sampled anonymized dataset;
- generated golden dataset;
- containerized test DB dengan data minim;
- dedicated performance dataset tanpa PII.

### 13.3 Masking harus menjaga distribusi teknis

Masking yang baik bukan sekadar mengganti semua nilai jadi `xxx`.

Untuk migration testing, dataset harus tetap menjaga:

- cardinality;
- null distribution;
- length distribution;
- duplicate patterns;
- foreign key relationship;
- edge cases;
- data volume;
- skew;
- date range.

Contoh buruk:

```text
Semua email diganti menjadi test@example.com
```

Efeknya:

- unique constraint test menjadi tidak realistis;
- dedup logic gagal;
- migration performance tidak valid.

Lebih baik:

```text
user_000001@example.test
user_000002@example.test
...
```

Dengan mapping deterministic dan non-reversible jika memungkinkan.

---

## 14. PII Handling in Migration Logs

Migration logs sering dianggap aman. Padahal bisa bocor.

### 14.1 Jangan log row-level sensitive value

Buruk:

```text
Migrating user: nric=S1234567A, email=john@example.com
```

Lebih baik:

```text
Migrating user batch: range_id=1000-1999, rows=1000
```

Atau:

```text
Failed record hash=sha256:ab12..., reason=invalid status mapping
```

### 14.2 Jangan print SQL dengan literal sensitif

Jika migration Java-based memakai prepared statement, hindari log yang menampilkan bound values sensitif.

### 14.3 Error handling

Exception sering mengandung data. Sanitasi:

- log technical cause;
- log record identifier yang aman;
- jangan log full payload;
- jangan dump object JSON;
- jangan log CLOB/BLOB content;
- pisahkan detailed secure diagnostic jika diperlukan.

---

## 15. Secrets Handling in Migration and Seeding

Rule keras:

> Secret tidak boleh disimpan di migration file.

Secret meliputi:

- password;
- API key;
- OAuth client secret;
- encryption key;
- private key;
- database credential;
- token;
- signing secret;
- SMTP password;
- integration credential.

### 15.1 Apa yang boleh disimpan?

Boleh menyimpan metadata non-secret:

```sql
INSERT INTO integration_config(code, endpoint_url, enabled)
VALUES ('ONEMAP', 'https://example.gov/api', true);
```

Tidak boleh:

```sql
INSERT INTO integration_config(code, api_key)
VALUES ('ONEMAP', 'real-secret-here');
```

### 15.2 Pattern yang lebih aman

Simpan secret di secret manager:

- AWS Secrets Manager;
- AWS SSM Parameter Store;
- HashiCorp Vault;
- Azure Key Vault;
- Google Secret Manager;
- Kubernetes Secret dengan kontrol ketat;
- platform secret store lain.

Database hanya menyimpan reference:

```sql
INSERT INTO integration_config(code, secret_ref, enabled)
VALUES ('PAYMENT', '/prod/app/payment/api-key', true);
```

### 15.3 Initial admin password

Jangan seed password default static.

Buruk:

```sql
INSERT INTO users(username, password_hash)
VALUES ('admin', '$2a$...known-password...');
```

Lebih aman:

- create admin melalui secure onboarding;
- force password reset;
- use identity provider;
- disable default account;
- one-time bootstrap token dari secret manager;
- environment-specific secure provisioning.

---

## 16. Authentication and Authorization Seed Risk

Seed untuk role/permission sangat sensitif.

### 16.1 Permission seed harus diperlakukan sebagai security change

Contoh:

```sql
INSERT INTO permission(code, description)
VALUES ('CASE_DELETE', 'Delete case');
```

Ini bukan sekadar lookup. Ini mengubah kemampuan sistem.

Yang harus direview:

- permission baru untuk apa;
- role mana yang mendapatkannya;
- apakah default role mendapat permission berlebih;
- apakah permission digunakan oleh code;
- apakah ada deny-by-default;
- apakah ada audit saat permission dipakai;
- apakah rollback menurunkan privilege dengan aman.

### 16.2 Role mapping seed

Mapping role-permission lebih berisiko daripada permission definition.

```sql
INSERT INTO role_permission(role_code, permission_code)
VALUES ('OFFICER', 'CASE_DELETE');
```

Pertanyaan review:

- apakah semua officer memang boleh delete case?
- apakah role ini dipakai external users?
- apakah ada tenant/agency boundary?
- apakah mapping berlaku production-wide?
- apakah harus feature-flagged?

### 16.3 External identity mapping

Jika seed menyentuh mapping IdP, group, realm, client, OAuth scope, ini masuk security-critical.

Contoh risiko:

- mapping group IdP ke role internal salah;
- scope terlalu luas;
- service account mendapat admin scope;
- default user masuk role privileged;
- test client aktif di production.

---

## 17. Audit Trail for Schema and Data Changes

Ada dua level audit:

1. tool-level audit;
2. database/platform-level audit.

### 17.1 Tool-level audit

Flyway/Liquibase history menjawab migration apa yang berjalan.

Keterbatasannya:

- tidak semua manual DB change tercatat;
- tidak mencatat semua row-level data change;
- tidak selalu mencatat actor manusia;
- bisa dimodifikasi jika privilege terlalu luas.

### 17.2 Database-level audit

DBMS dapat mencatat:

- DDL statement;
- login/logout;
- privilege changes;
- table access;
- selected DML;
- failed access;
- role changes.

Contoh konsep audit event:

```text
timestamp
actor/database user
client host
program/application name
statement type
object name
sql text/hash
success/failure
correlation id/session context
```

### 17.3 Application-level audit

Untuk seed/data migration yang mengubah business state, kadang perlu application audit juga.

Misalnya migration mengubah case status:

```text
Case A: status OLD -> NEW due to migration CR-1234
```

Kalau perubahan ini memengaruhi business lifecycle, maka hanya update DB tanpa audit domain bisa membuat history bisnis bolong.

### 17.4 Session context

Beberapa DBMS mendukung session/application context. Migration dapat set metadata session:

```text
module = database-migration
release = 2026.06.17.1
change_request = CR-1234
pipeline_run = ci-829193
```

Lalu database audit dapat merekam konteks ini.

Ini meningkatkan traceability.

---

## 18. Regulatory Defensibility

Regulatory defensibility berarti sistem perubahan bisa menjawab “mengapa, siapa, kapan, bagaimana, dan apa dampaknya” secara meyakinkan.

### 18.1 Defensible migration memiliki unsur ini

- documented intent;
- reviewed script;
- approved execution;
- tested path;
- known risk;
- known rollback/roll-forward strategy;
- immutable artifact;
- traceable execution;
- post-deployment verification;
- incident/reconciliation process.

### 18.2 Tidak defensible

```text
Developer A said migration is okay in chat.
DBA copied SQL manually.
No ticket.
No artifact checksum.
No before/after query.
No approval.
No evidence.
```

Walaupun berhasil, ini governance risk.

### 18.3 Defensible does not mean bureaucratic

Untuk tim engineering, goal-nya bukan membuat proses lambat.

Goal-nya:

- decision traceable;
- responsibility clear;
- rollback known;
- blast radius understood;
- unauthorized change hard;
- emergency change recoverable.

---

## 19. Compliance Control Model

Berikut control model praktis.

### 19.1 Preventive controls

Mencegah masalah sebelum terjadi:

- least privilege;
- no direct prod write access;
- migration only via pipeline;
- PR review mandatory;
- static checks/linting;
- destructive operation gate;
- secret scanning;
- PII scanning;
- approval gate;
- immutable artifact;
- migration dry-run.

### 19.2 Detective controls

Mendeteksi masalah:

- schema drift detection;
- checksum validation;
- DB audit logs;
- migration history review;
- failed migration alert;
- unexpected DDL alert;
- privilege change alert;
- production data correction report;
- comparison lower/prod schema.

### 19.3 Corrective controls

Memperbaiki masalah:

- roll-forward migration;
- restore plan;
- repair procedure;
- compensation script;
- incident runbook;
- post-incident reconciliation;
- access revocation;
- secret rotation;
- audit report.

---

## 20. Secure Pipeline Design for Migration

Pipeline harus menjadi enforcement point.

### 20.1 Pipeline stages

```text
1. Source checkout
2. Dependency verification
3. Secret scan
4. Migration lint
5. Flyway/Liquibase validate
6. Build immutable artifact
7. Fresh DB migration test
8. Previous-release upgrade test
9. Destructive change detection
10. Dry-run SQL generation where possible
11. Approval gate
12. Backup/restore point check
13. Production migration execution
14. Post-check queries
15. Evidence publication
```

### 20.2 Important security checks

- detect `DROP TABLE`;
- detect `TRUNCATE`;
- detect `DELETE FROM table` without `WHERE`;
- detect `UPDATE table SET` without `WHERE`;
- detect secret-like strings;
- detect production-only conditional logic;
- detect grant/admin role changes;
- detect password hash seed;
- detect test user seed in prod path;
- detect modification to old migration files.

### 20.3 Modification to old migration file

Pipeline can compare against main branch or release baseline.

Policy:

```text
If migration has already been applied to shared env, modification is blocked unless exception approved.
```

### 20.4 Environment-specific credentials

Pipeline should use different credentials per environment:

```text
DEV migration credential != UAT migration credential != PROD migration credential
```

Never reuse prod credentials in lower environment.

---

## 21. Secure Use of Flyway

### 21.1 Disable dangerous operations in production

Flyway `clean` can drop all objects in configured schemas.

Production policy:

```text
cleanDisabled=true
```

And ideally enforced by config and pipeline.

### 21.2 Baseline caution

`baselineOnMigrate` can be dangerous if accidentally pointed to wrong database.

Production use should be explicit and approved.

### 21.3 Repair governance

`repair` should be controlled.

Policy:

- no casual repair;
- require mismatch analysis;
- require approval;
- require evidence;
- prefer new migration for semantic change;
- record who/why/when.

### 21.4 Out-of-order migration

Out-of-order may be useful in branch/release scenarios, but can weaken predictability.

Use only with clear policy.

### 21.5 Placeholder risk

Flyway placeholders can inject environment-specific values.

Useful for:

- schema name;
- tablespace;
- role name;
- non-secret endpoint ref.

Dangerous for:

- secrets;
- business behavior that differs silently between environments;
- privilege mapping;
- destructive toggles.

---

## 22. Secure Use of Liquibase

### 22.1 Preconditions as guardrails

Liquibase preconditions can prevent unsafe execution:

- object must exist;
- object must not exist;
- row count expected;
- DBMS must match;
- user must match;
- SQL check must pass.

But jangan gunakan preconditions sebagai alasan untuk membuat changelog chaotic.

### 22.2 Contexts and labels

Contexts/labels powerful, tetapi bisa berbahaya.

Contoh:

```yaml
context: prod
```

Jika salah tagging, production bisa menjalankan changeset yang tidak dimaksudkan.

Policy:

- context naming standard;
- label naming standard;
- prod-only changes require explicit review;
- avoid hidden behavior differences;
- generate deployment plan before run.

### 22.3 Rollback block

Rollback block dapat membantu governance, tetapi rollback palsu berbahaya.

Jangan menulis rollback hanya agar checklist hijau.

Contoh rollback palsu:

```sql
-- rollback not needed
```

Padahal migration destructive.

Lebih baik jujur:

```text
Rollback is not lossless. Recovery requires restore or forward compensation.
```

### 22.4 Lock table

`DATABASECHANGELOGLOCK` mencegah concurrent Liquibase runs.

Jika lock stuck, jangan asal unlock tanpa memahami apakah migration masih berjalan atau gagal di tengah.

---

## 23. Seed Data Security Controls

Seed data butuh kontrol khusus.

### 23.1 Seed classification

Setiap seed harus diklasifikasikan:

| Seed type | Risk |
|---|---|
| Country/currency lookup | Low/medium |
| Status lifecycle | Medium/high |
| Role/permission | High |
| Admin/bootstrap user | Critical |
| Feature flag | Medium/high |
| Integration config | High if secret-related |
| Tenant config | High |
| Regulatory rule config | High |

### 23.2 Seed review questions

- Apakah seed berlaku semua environment?
- Apakah seed memengaruhi authorization?
- Apakah seed mengubah workflow state?
- Apakah seed dapat dijalankan ulang?
- Apakah seed akan overwrite manual config production?
- Apakah seed mengandung secret?
- Apakah seed mengandung PII?
- Apakah seed punya stable natural key?
- Apakah seed bisa di-audit?

### 23.3 Seed should not silently override production business config

Buruk:

```sql
UPDATE system_config SET value = 'true'
WHERE key = 'ALLOW_CASE_DELETION';
```

Tanpa approval jelas, ini bisa mengubah behavior production.

Lebih baik:

- versioned config migration;
- explicit CR/ticket;
- before/after evidence;
- feature flag governance;
- approval dari product/business owner jika behavior berubah.

---

## 24. Data Correction Governance

Data correction sering mirip migration, tetapi lebih sensitif karena mengubah business records.

### 24.1 Data correction harus punya scope jelas

Contoh buruk:

```sql
UPDATE application SET status = 'APPROVED'
WHERE status = 'PENDING';
```

Contoh lebih baik:

```sql
UPDATE application
SET status = 'APPROVED',
    updated_by = 'MIGRATION_CR_1234',
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (...approved list...)
  AND status = 'PENDING';
```

Tetapi untuk daftar besar, lebih baik pakai staging table:

```sql
CREATE TABLE correction_cr_1234_application_ids (
  application_id BIGINT PRIMARY KEY,
  reason VARCHAR(500) NOT NULL
);
```

Lalu update berdasarkan staging table.

### 24.2 Before/after snapshot

Untuk correction sensitif, simpan before snapshot:

```sql
CREATE TABLE correction_cr_1234_before AS
SELECT id, status, updated_at, updated_by
FROM application
WHERE id IN (...);
```

Tapi hati-hati: snapshot bisa mengandung PII. Kelola retention dan access-nya.

### 24.3 Business audit

Jika status lifecycle berubah, domain audit harus diperbarui.

Jangan hanya update main table jika sistem memiliki audit trail domain.

---

## 25. Encryption and Key Rotation Migration

Migration kadang terkait encryption:

- menambah encrypted column;
- re-encrypt data;
- rotate key id;
- migrate hashing algorithm;
- migrate password hash cost;
- tokenize PII;
- move secret from DB to vault.

### 25.1 Jangan simpan key di migration

Encryption key tidak boleh masuk SQL/script.

Migration harus mengacu pada key reference, bukan key material.

### 25.2 Re-encryption migration

Risiko:

- long-running;
- sensitive data exposure;
- partial encryption state;
- rollback sulit;
- old app tidak bisa baca new ciphertext;
- key version mismatch.

Pattern:

```text
1. Add key_version column if absent
2. App supports reading old and new encryption versions
3. Backfill/re-encrypt in chunks
4. Verify all rows migrated
5. Switch write path to new key
6. Retire old key only after safe period
```

### 25.3 Password hash migration

Password biasanya tidak bisa dimigrasi langsung karena plaintext tidak tersedia.

Pattern:

```text
on login:
  verify old hash
  if valid:
    rehash with new algorithm/cost
    store new hash
```

Jangan membuat migration yang mencoba “decrypt password”.

---

## 26. Database Audit vs Application Audit

Penting membedakan:

### 26.1 Database audit

Menjawab:

- siapa menjalankan SQL;
- object apa diubah;
- kapan;
- dari host mana;
- statement apa.

### 26.2 Application/domain audit

Menjawab:

- business entity apa berubah;
- status dari apa ke apa;
- alasan bisnis;
- actor domain;
- lifecycle event;
- user-facing history.

Migration yang mengubah business data bisa butuh keduanya.

Contoh:

```text
DB audit:
  migration_user updated CASE table at 2026-06-17

Domain audit:
  Case C-2026-001 status corrected from OPEN to CLOSED due to CR-1234
```

Tanpa domain audit, user/business auditor bisa melihat state berubah tanpa riwayat bisnis.

---

## 27. Environment Drift as Security and Compliance Risk

Drift bukan hanya masalah teknis.

Drift berarti environment production tidak lagi sesuai artifact resmi.

### 27.1 Jenis drift

- schema object beda;
- index beda;
- constraint beda;
- view/function/procedure beda;
- seed data beda;
- permission beda;
- migration history beda;
- manual hotfix tidak direkonsiliasi;
- tenant version beda.

### 27.2 Mengapa drift berbahaya

- migration berikutnya unpredictable;
- audit evidence tidak cocok dengan real DB;
- debugging sulit;
- rollback tidak valid;
- security permission bisa berbeda dari desain;
- production-only behavior muncul.

### 27.3 Drift detection

Gunakan kombinasi:

- Flyway validate;
- Liquibase status/diff;
- schema dump comparison;
- DB metadata query;
- permission comparison;
- seed data checksum;
- object definition hash;
- periodic audit.

---

## 28. Secure Migration for Multi-Tenant Systems

Multi-tenant migration menambah compliance risk.

### 28.1 Tenant isolation

Migration harus memastikan:

- tenant A tidak menerima data tenant B;
- tenant-specific seed tidak salah target;
- schema-per-tenant migration memakai credential/scope benar;
- failed tenant tidak membuat tenant lain corrupt;
- audit bisa menjawab tenant mana berubah.

### 28.2 Tenant migration evidence

Untuk setiap tenant:

```text
tenant_id
previous_version
target_version
migration_start
migration_end
status
rows_changed
error_code
operator/pipeline
artifact_version
```

### 28.3 Tenant-specific data correction

Jangan hanya:

```sql
UPDATE config SET value = 'X'
WHERE key = 'Y';
```

Harus ada tenant boundary:

```sql
UPDATE tenant_config
SET value = 'X'
WHERE tenant_id = :tenant_id
  AND key = 'Y';
```

Dan tenant id harus berasal dari controlled plan, bukan input bebas.

---

## 29. Java-Specific Security Considerations

### 29.1 Java migration code must not bypass controls

Java-based migration bisa membaca config, memanggil service, membuka koneksi tambahan, dan melakukan logic kompleks.

Risiko:

- memakai credential berbeda;
- log PII;
- call external API;
- nondeterministic behavior;
- dependency version berbeda;
- runtime classpath conflict;
- secret leak;
- hardcoded fallback.

### 29.2 Secure coding rules for Java migration

- use prepared statement;
- avoid dynamic SQL from untrusted input;
- avoid logging sensitive values;
- avoid external network calls;
- avoid using current time for business semantics unless intentional;
- avoid random UUID if deterministic key required;
- batch safely;
- set query timeout;
- handle partial progress;
- write verification query;
- expose metrics/logs without sensitive data.

### 29.3 Example: safer Java migration skeleton

```java
public final class V202606170900__BackfillCustomerSearchKey
        extends org.flywaydb.core.api.migration.BaseJavaMigration {

    @Override
    public void migrate(org.flywaydb.core.api.migration.Context context) throws Exception {
        var connection = context.getConnection();
        connection.setAutoCommit(false);

        final int batchSize = 1000;
        long lastId = 0L;

        while (true) {
            var rows = fetchBatch(connection, lastId, batchSize);
            if (rows.isEmpty()) {
                break;
            }

            updateBatch(connection, rows);
            lastId = rows.get(rows.size() - 1).id();
            connection.commit();

            // Log only safe metadata
            System.out.printf("Backfilled customer_search_key batch lastId=%d rows=%d%n", lastId, rows.size());
        }
    }
}
```

Catatan:

- jangan print nama/email/customer payload;
- commit per batch jika transaksi besar berisiko;
- gunakan stable ordering;
- gunakan resume/checkpoint jika migration sangat panjang;
- jangan call external service.

---

## 30. Secure Rollback and Roll-Forward Governance

Rollback bisa menjadi security issue.

### 30.1 Rollback dapat mengembalikan vulnerability

Misalnya migration memperbaiki permission terlalu luas.

Rollback otomatis bisa mengembalikan permission buruk.

### 30.2 Rollback dapat menghapus audit evidence

Rollback yang drop audit column/table bisa merusak traceability.

### 30.3 Rollback dapat mengekspos data

Contoh:

- rollback dari encrypted column ke plaintext;
- rollback dari tokenized data ke raw PII;
- rollback dari masked field ke original field.

### 30.4 Decision rule

Untuk perubahan security-sensitive, rollback harus direview sebagai security operation, bukan hanya operational recovery.

Kadang roll-forward lebih aman daripada rollback.

---

## 31. Example Governance Model for Enterprise Java Team

Berikut model praktis yang bisa diadaptasi.

### 31.1 Repository structure

```text
service-a/
  src/main/resources/db/migration/
    V202606170900__create_case_note_table.sql
    V202606171000__seed_case_permissions.sql
  docs/migration/
    CR-1234-risk-assessment.md
    CR-1234-verification.sql
```

Atau dedicated migration repository:

```text
database-migrations/
  modules/
    case/
    appeal/
    compliance/
  releases/
    2026.06.17/
  evidence/
    CR-1234/
```

### 31.2 Pull request template

```markdown
## Change Summary

## Related Ticket / CR

## Migration Type
- [ ] Schema
- [ ] Seed
- [ ] Data correction
- [ ] Backfill
- [ ] Permission/security
- [ ] Repeatable object

## Risk
- [ ] Destructive
- [ ] Long-running
- [ ] Locking risk
- [ ] PII involved
- [ ] Authorization impact
- [ ] Multi-tenant impact

## Compatibility
- Old app + new DB:
- New app + old DB:
- Rollback impact:

## Verification Query

## Roll-forward / Rollback Plan

## Evidence
```

### 31.3 Production deployment evidence

```text
CR: CR-1234
Release: 2026.06.17.1
Commit: 9f2c0e...
Artifact checksum: sha256:...
Migration tool: Flyway
Database: prod-app-db
Started: 2026-06-17T21:00:00+07:00
Completed: 2026-06-17T21:03:12+07:00
Executed migrations:
  V202606170900__create_case_note_table.sql success
  V202606171000__seed_case_permissions.sql success
Post-check: passed
Approver: release manager / product owner / tech lead
```

---

## 32. Red Flags That Indicate Weak Migration Governance

Waspadai tanda-tanda ini:

- aplikasi production memakai DB user owner/admin;
- developer sering menjalankan SQL manual di production;
- migration lama sering diedit;
- checksum mismatch dianggap normal;
- Flyway repair dilakukan tanpa evidence;
- Liquibase lock di-unlock tanpa investigasi;
- `clean` tidak disabled di production;
- seed file mengandung password/API key;
- role/permission seed tidak direview security;
- migration test hanya pakai H2;
- production schema berbeda dari Git;
- tidak ada approval untuk destructive changes;
- rollback plan selalu “restore backup” tanpa RTO/RPO jelas;
- pipeline menjalankan latest branch, bukan artifact immutable;
- tidak ada post-deployment verification;
- manual hotfix tidak pernah direkonsiliasi.

---

## 33. Green Flags of Mature Migration Practice

Tanda praktik matang:

- runtime app user tidak punya DDL privilege;
- migration hanya via pipeline;
- artifact immutable dan traceable;
- migration history divalidasi;
- old migration tidak diedit;
- destructive migration butuh approval khusus;
- seed data diklasifikasikan;
- permission seed direview security;
- secret tidak masuk SQL/changelog;
- PII tidak masuk log;
- production access time-bound;
- break-glass access direview;
- schema drift dimonitor;
- post-check query wajib;
- migration evidence tersimpan;
- data correction punya before/after evidence;
- rollback/roll-forward realistis;
- compliance review bisa dijawab dengan artefak, bukan ingatan.

---

## 34. Practical Checklist: Before Running Production Migration

Gunakan checklist berikut sebelum production migration.

### 34.1 Identity and access

- Migration dijalankan oleh pipeline/service account?
- Credential environment-specific?
- Runtime app user tidak punya DDL privilege?
- Break-glass tidak digunakan kecuali approved?

### 34.2 Artifact

- Artifact immutable?
- Commit SHA tercatat?
- Checksum artifact tercatat?
- Artifact sama dengan yang diuji?

### 34.3 Review

- PR reviewed?
- Destructive operation checked?
- Security-sensitive seed checked?
- PII/secret scan passed?
- Roll-forward/rollback plan reviewed?

### 34.4 Testing

- Fresh DB migration passed?
- Upgrade from previous release passed?
- Vendor-real DB tested?
- Data migration verified?
- Performance/lock risk assessed?

### 34.5 Operation

- Backup/restore point ready?
- Maintenance/deployment window confirmed?
- Lock timeout/statement timeout set?
- Monitoring ready?
- Post-check queries ready?
- Communication channel ready?

### 34.6 Evidence

- CR/ticket linked?
- Approval recorded?
- Pipeline run recorded?
- Migration history captured?
- Post-check result captured?

---

## 35. Practical Checklist: After Production Migration

Setelah migration:

- cek Flyway/Liquibase status;
- cek schema history/changelog table;
- jalankan post-check query;
- cek application startup;
- cek error logs;
- cek DB lock/deadlock/slow query;
- cek audit logs;
- cek security-sensitive seed result;
- cek data correction counts;
- simpan execution evidence;
- close CR/ticket dengan result;
- jika ada manual step, reconcile ke repo;
- jika ada deviation, buat incident/deviation record.

---

## 36. Mini Case Study 1: Permission Seed Gone Wrong

### Situation

Tim menambah fitur delete case. Migration menambahkan permission baru dan memasukkannya ke role `OFFICER`.

```sql
INSERT INTO permission(code, description)
VALUES ('CASE_DELETE', 'Delete case');

INSERT INTO role_permission(role_code, permission_code)
VALUES ('OFFICER', 'CASE_DELETE');
```

### Problem

Role `OFFICER` ternyata dipakai oleh banyak user frontline, bukan hanya supervisor. Setelah release, terlalu banyak user bisa delete case.

### Root cause

- permission seed diperlakukan sebagai lookup biasa;
- tidak ada security review;
- tidak ada role impact analysis;
- tidak ada feature flag;
- tidak ada post-check siapa saja affected.

### Better design

```sql
INSERT INTO permission(code, description)
VALUES ('CASE_DELETE', 'Delete case');

INSERT INTO role_permission(role_code, permission_code)
VALUES ('SUPERVISOR', 'CASE_DELETE');
```

Plus:

- review role matrix;
- query affected user count;
- approval business owner;
- post-check:

```sql
SELECT r.role_code, COUNT(DISTINCT ur.user_id) AS affected_users
FROM role_permission rp
JOIN role r ON r.role_code = rp.role_code
JOIN user_role ur ON ur.role_code = r.role_code
WHERE rp.permission_code = 'CASE_DELETE'
GROUP BY r.role_code;
```

---

## 37. Mini Case Study 2: Secret in Migration File

### Situation

Developer menambahkan integration config:

```sql
INSERT INTO integration_config(code, endpoint, api_key)
VALUES ('MAP_API', 'https://api.example.com', 'prod-secret-key');
```

### Problem

Secret masuk Git, CI artifact, logs, dan developer machines.

### Correct approach

```sql
INSERT INTO integration_config(code, endpoint, secret_ref)
VALUES ('MAP_API', 'https://api.example.com', '/prod/app/map-api/key');
```

Secret disimpan di secret manager dan diakses runtime melalui secure channel.

### Follow-up jika sudah bocor

- revoke/rotate secret;
- remove from active config;
- treat Git history as compromised;
- review logs/artifacts;
- add secret scanning;
- update PR checklist.

---

## 38. Mini Case Study 3: Checksum Mismatch Before Production

### Situation

Migration sudah dijalankan di UAT:

```text
V202606170900__add_case_priority.sql
```

Sebelum production, developer mengedit file yang sama untuk menambah index.

### Problem

Checksum mismatch.

### Bad response

```text
Run repair, then deploy.
```

### Good response

1. cek perubahan apa yang terjadi;
2. jika semantic change, revert file lama;
3. buat migration baru:

```text
V202606171030__add_case_priority_index.sql
```

4. jalankan validate ulang;
5. deploy artifact baru dengan evidence.

### Principle

> Applied migration is historical record. Do not rewrite history.

---

## 39. Mini Case Study 4: Manual Production Hotfix

### Situation

Production gagal karena lookup `CASE_STATUS` missing. DBA insert manual:

```sql
INSERT INTO case_status(code, label)
VALUES ('REOPENED', 'Reopened');
```

Aplikasi pulih.

### Hidden risk

- lower environment tidak punya seed;
- next migration mungkin mencoba insert duplicate;
- audit tidak tahu kenapa data ada;
- Git tidak merefleksikan production.

### Correct follow-up

Buat migration resmi:

```sql
INSERT INTO case_status(code, label)
SELECT 'REOPENED', 'Reopened'
WHERE NOT EXISTS (
  SELECT 1 FROM case_status WHERE code = 'REOPENED'
);
```

Catat:

- hotfix time;
- actor;
- approval;
- reason;
- reconciliation migration.

---

## 40. Mental Model Summary

Database migration yang mature harus memenuhi lima kualitas:

### 40.1 Controlled

Tidak semua orang bisa menjalankan. Tidak semua path boleh mengubah production.

### 40.2 Least-privilege

App runtime tidak punya hak migration. Migration user tidak dipakai aplikasi.

### 40.3 Immutable

Production menjalankan artifact yang sama dengan yang diuji dan disetujui.

### 40.4 Auditable

Bisa menjawab siapa, apa, kapan, mengapa, bagaimana, dan hasilnya.

### 40.5 Recoverable

Jika gagal, ada jalur recovery yang realistis: retry, repair, roll-forward, compensation, atau restore.

---

## 41. Hubungan dengan Bagian Berikutnya

Bagian ini membangun fondasi security dan compliance.

Bagian berikutnya akan membahas:

```text
30-observability-operational-runbooks.md
```

Di sana fokusnya akan bergeser dari governance ke operasi harian:

- migration logs;
- structured logging;
- metrics;
- alerting;
- lock wait monitoring;
- pre-flight checklist;
- during-flight checklist;
- post-flight verification;
- incident runbook;
- go/no-go criteria.

Security/compliance menjawab:

> Apakah migration boleh dan dapat dipertanggungjawabkan?

Observability/runbook menjawab:

> Saat migration berjalan atau gagal, bagaimana kita tahu, mengendalikan, dan memulihkannya?

---

## 42. Final Takeaways

1. Database migration adalah privileged state mutation, bukan file SQL biasa.
2. Runtime app user dan migration user harus dipisahkan.
3. Least privilege mengurangi blast radius jika credential bocor atau aplikasi compromised.
4. Migration history table adalah evidence, tetapi bukan evidence lengkap.
5. Artifact production harus immutable dan traceable ke commit, build, approval, dan pipeline run.
6. Checksum mismatch adalah integrity signal, bukan annoyance.
7. Secret tidak boleh masuk migration/changelog/seed.
8. Permission seed adalah security change.
9. Data correction yang mengubah business state harus punya audit dan evidence.
10. Manual hotfix harus direkonsiliasi ke migration repository.
11. Compliance bukan sekadar dokumen; ia adalah kemampuan membuktikan state transition secara konsisten.
12. Top-tier engineer mendesain migration bukan hanya agar berhasil, tetapi agar aman, terkontrol, diaudit, dan recoverable.

---

## 43. Status Seri

Bagian ini adalah:

```text
Part 29 dari 34
```

Seri belum selesai.

Bagian berikutnya:

```text
30-observability-operational-runbooks.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 28 — Multi-Tenant Database Migration](./28-multitenant-database-migration.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 30 — Observability and Operational Runbooks](./30-observability-operational-runbooks.md)

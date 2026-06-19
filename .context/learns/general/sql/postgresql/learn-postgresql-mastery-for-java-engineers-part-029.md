# learn-postgresql-mastery-for-java-engineers-part-029.md

# Part 029 — Security: Roles, Privileges, RLS, TLS, Secrets, dan Auditability

## Status Seri

- Seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `029` dari `034`
- Fokus: PostgreSQL security untuk aplikasi Java produksi
- Prasyarat konseptual:
  - Part 002: connection lifecycle dan pooling
  - Part 005: transaction isolation
  - Part 014: locking
  - Part 015: constraints as invariants
  - Part 025: observability
  - Part 026: backup/restore
  - Part 027–028: replication dan high availability

---

## 1. Tujuan Bagian Ini

Setelah bagian ini, kamu harus bisa melihat security PostgreSQL bukan sebagai satu fitur tunggal seperti “pakai password” atau “aktifkan TLS”, tetapi sebagai beberapa lapisan kontrol yang saling mengunci:

1. Siapa boleh konek ke server.
2. Dari mana koneksi boleh datang.
3. Bagaimana identitas dibuktikan.
4. Role apa yang dipakai setelah masuk.
5. Object database mana yang boleh disentuh.
6. Row mana yang boleh terlihat.
7. Secret bagaimana dikelola.
8. Query aplikasi bagaimana dicegah dari injection.
9. Aktivitas bagaimana diaudit.
10. Bagaimana security tetap benar ketika ada migration, failover, backup, restore, dan debugging production.

Untuk Java engineer, targetnya bukan menjadi DBA keamanan murni, tetapi mampu mendesain aplikasi yang tidak melemahkan database security model.

Security PostgreSQL yang baik biasanya tidak terlihat dramatis. Ia terlihat seperti:

- user aplikasi tidak bisa `DROP TABLE`;
- service read-only tidak bisa menulis;
- migration user tidak dipakai runtime;
- credential tidak bocor di log;
- tenant A tidak bisa membaca tenant B;
- query injection gagal karena parameter binding dan privilege minimum;
- audit bisa menjawab “siapa melakukan apa, kapan, dari mana, dengan efek apa”;
- restore backup tidak menciptakan environment bocor;
- failover tidak membuat aplikasi kembali memakai superuser credential.

---

## 2. Mental Model Security PostgreSQL

PostgreSQL security bisa dipikirkan sebagai pipeline:

```text
Network boundary
  -> pg_hba.conf
  -> authentication method
  -> role identity
  -> database/schema/object privileges
  -> row-level policy
  -> application query construction
  -> logging/audit/monitoring
  -> backup/restore/secrets lifecycle
```

Kesalahan umum adalah hanya mengamankan satu lapisan dan menganggap sistem aman.

Contoh:

```text
“Kami sudah pakai prepared statement.”
```

Itu membantu melawan SQL injection, tetapi tidak menyelesaikan:

- aplikasi memakai superuser;
- semua service berbagi credential;
- user read-only bisa update;
- RLS tidak aktif;
- backup tidak terenkripsi;
- logs menyimpan PII;
- migration tool punya privilege besar dan credential-nya tersedia di pod runtime;
- read replica terbuka ke network yang salah.

Security yang benar adalah defense-in-depth. Setiap lapisan harus mengurangi blast radius jika lapisan lain gagal.

---

## 3. Threat Model Minimum untuk PostgreSQL-backed Java Service

Sebelum memilih konfigurasi, definisikan threat model. Minimal untuk aplikasi produksi:

| Ancaman | Contoh | Kontrol utama |
|---|---|---|
| Unauthorized network access | Port PostgreSQL terbuka ke internet | network ACL, firewall, private subnet, `pg_hba.conf` |
| Credential leakage | Password DB bocor dari env/log | secret manager, rotation, least privilege |
| SQL injection | input user masuk ke dynamic SQL | parameter binding, query builder aman, least privilege |
| Privilege escalation | app user bisa DDL/drop | role separation, revoke public, no superuser |
| Cross-tenant data leak | tenant_id tidak difilter | RLS, tenant-bound query, constraints, tests |
| Insider misuse | DBA/app operator query data sensitif | audit logging, privilege separation, masking/pseudonymization |
| Backup leakage | dump production disalin ke laptop | encryption, access control, sanitization |
| Misconfigured migration | migration lock/destructive DDL | separate migration role, review, dry-run |
| Failover regression | new primary punya config berbeda | config management, HA runbook, tests |
| Observability leakage | SQL logs berisi token/PII | log policy, redaction, parameter hygiene |

Security bukan hanya confidentiality. Dalam database, security juga mencakup integrity dan availability.

```text
Confidentiality: data tidak bocor.
Integrity      : data tidak bisa diubah oleh aktor yang salah.
Availability   : kontrol keamanan tidak membuat sistem mudah mati atau tidak bisa dipulihkan.
```

---

## 4. Role, User, dan Group di PostgreSQL

Di PostgreSQL, “user” dan “group” pada dasarnya adalah role. Role bisa punya atribut login atau tidak.

Role dengan `LOGIN` bisa dipakai untuk koneksi:

```sql
CREATE ROLE app_runtime LOGIN PASSWORD '...';
```

Role tanpa `LOGIN` cocok sebagai group/permission container:

```sql
CREATE ROLE app_readonly;
CREATE ROLE app_writer;
CREATE ROLE app_migration;
```

Lalu role login diberi membership:

```sql
GRANT app_writer TO app_runtime;
```

Mental model yang disarankan:

```text
login role     = identitas teknis yang dipakai koneksi
permission role = kumpulan izin yang bisa diberikan/dicabut
owner role     = pemilik object schema/table/function
admin role     = operator terbatas, bukan superuser default
```

Jangan membuat semua object dimiliki oleh role runtime aplikasi. Kalau role runtime memiliki table, ia sering punya terlalu banyak kuasa terhadap table itu.

Lebih aman:

```sql
CREATE ROLE app_owner NOLOGIN;
CREATE ROLE app_runtime LOGIN;
CREATE ROLE app_migration LOGIN;

-- Object dimiliki app_owner.
-- Migration role boleh melakukan DDL melalui proses terkendali.
-- Runtime role hanya diberi DML minimum.
```

---

## 5. Superuser adalah Nuclear Capability

PostgreSQL superuser bisa melewati banyak mekanisme keamanan. Jangan gunakan superuser untuk:

- aplikasi Java;
- job scheduler;
- reporting dashboard;
- migration harian biasa;
- BI tool;
- developer local ke database shared;
- health check;
- replication consumer yang tidak perlu superuser.

Superuser harus diperlakukan seperti root di OS.

Anti-pattern:

```properties
spring.datasource.username=postgres
spring.datasource.password=production_password
```

Masalahnya bukan hanya `DROP TABLE`. Superuser dapat:

- membaca semua data;
- memodifikasi catalog;
- melewati RLS;
- membuat extension berbahaya;
- mengubah setting sensitif;
- mengakses fungsi/file tertentu tergantung konfigurasi;
- merusak audit trail.

Production-grade rule:

```text
No application runtime should connect as PostgreSQL superuser.
```

---

## 6. Authentication Boundary: `pg_hba.conf`

`pg_hba.conf` adalah host-based authentication file. Ia menentukan koneksi mana yang diterima dan metode auth apa yang dipakai.

Sebuah entry tipikal:

```text
# TYPE  DATABASE  USER        ADDRESS          METHOD
host    appdb     app_runtime 10.20.0.0/16     scram-sha-256
```

Mental model:

```text
connection attempt
  -> match first pg_hba.conf rule
  -> apply selected auth method
  -> if auth succeeds, session starts as requested role
```

Hal penting: rule dievaluasi berdasarkan urutan. Rule yang terlalu longgar di atas bisa membuat rule ketat di bawah tidak pernah dipakai.

Contoh buruk:

```text
host all all 0.0.0.0/0 md5
```

Contoh lebih baik:

```text
local   all     postgres                  peer
hostssl appdb   app_runtime 10.20.0.0/16  scram-sha-256
hostssl appdb   app_readonly 10.30.0.0/16 scram-sha-256
hostssl appdb   app_migration 10.40.1.5/32 scram-sha-256
```

Prinsip:

1. Batasi database.
2. Batasi user.
3. Batasi address.
4. Pakai `hostssl` bila koneksi harus TLS.
5. Hindari `trust` di environment tidak terisolasi.
6. Jangan gunakan rule global longgar kecuali benar-benar ada alasan kuat.

---

## 7. Authentication Method: SCRAM, MD5, Peer, Cert, OAuth

PostgreSQL mendukung beberapa metode authentication. Untuk aplikasi Java modern, pilihan umum adalah password-based authentication dengan SCRAM-SHA-256, atau integrasi eksternal seperti certificate/OAuth/Kerberos tergantung organisasi.

### 7.1 `trust`

`trust` menerima koneksi tanpa password jika rule cocok.

Cocok hanya untuk skenario sangat terbatas seperti lab lokal yang benar-benar isolated.

Tidak cocok untuk production.

### 7.2 `peer`

`peer` memetakan OS user lokal ke database role. Cocok untuk local administrative workflow di host database.

Contoh:

```text
local all postgres peer
```

### 7.3 password auth

Untuk production, gunakan SCRAM-SHA-256 bila memungkinkan.

```sql
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
```

Lalu set password role:

```sql
ALTER ROLE app_runtime PASSWORD 'new-secret';
```

Catatan: jangan menulis secret nyata di migration file, Git, atau ticket.

### 7.4 certificate auth

Certificate auth berguna bila organisasi sudah punya CA/internal PKI dan ingin mutual TLS. Ini lebih kuat, tetapi operational complexity lebih tinggi:

- certificate issuance;
- expiration;
- revocation;
- rotation;
- client identity mapping;
- driver truststore/keystore;
- failover endpoint consistency.

### 7.5 OAuth/GSSAPI/LDAP

Ini biasanya enterprise/infrastructure-driven. Untuk service-to-database internal, sering tetap dipadukan dengan network boundary dan role mapping yang ketat.

---

## 8. TLS: Encryption in Transit

TLS melindungi koneksi client-server dari sniffing dan certain man-in-the-middle risk.

Di PostgreSQL, server-side parameter utamanya:

```conf
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
ssl_ca_file = 'root.crt'
```

Di `pg_hba.conf`, gunakan `hostssl` untuk mensyaratkan koneksi SSL:

```text
hostssl appdb app_runtime 10.20.0.0/16 scram-sha-256
```

Dari Java JDBC, koneksi bisa mensyaratkan SSL mode, misalnya:

```properties
jdbc:postgresql://db.example.internal:5432/appdb?sslmode=verify-full
```

Mode penting:

| Mode | Makna sederhana |
|---|---|
| `disable` | tidak pakai SSL |
| `require` | SSL wajib, tetapi verifikasi identitas server belum sekuat `verify-full` |
| `verify-ca` | verifikasi CA |
| `verify-full` | verifikasi CA dan hostname |

Untuk production, targetkan `verify-full` bila certificate/hostname lifecycle memungkinkan.

Trap yang sering terjadi:

```text
ssl=true
```

dianggap “sudah aman”, padahal belum tentu memverifikasi hostname server. Tanpa verifikasi yang benar, koneksi terenkripsi tetapi masih bisa rentan terhadap endpoint spoofing dalam kondisi tertentu.

---

## 9. Database, Schema, dan Object Privileges

Privilege PostgreSQL bekerja di banyak level:

```text
database
  -> schema
    -> table/view/materialized view
    -> sequence
    -> function/procedure
    -> type
```

Contoh setup kasar:

```sql
CREATE DATABASE appdb OWNER app_owner;

\c appdb

CREATE SCHEMA app AUTHORIZATION app_owner;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA app TO app_runtime;
```

Catatan penting: grant pada existing objects tidak otomatis berlaku untuk future objects kecuali memakai default privileges.

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;
```

Jika kamu lupa default privileges, migration berikutnya bisa membuat table baru yang tidak bisa diakses runtime, atau sebaliknya dibuat oleh user yang salah dengan privilege kacau.

---

## 10. Revoke `PUBLIC` dengan Sengaja

`PUBLIC` berarti semua role. Banyak environment membiarkan default terlalu longgar.

Baseline yang sering disarankan:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE appdb FROM PUBLIC;
```

Kemudian grant eksplisit:

```sql
GRANT CONNECT ON DATABASE appdb TO app_runtime;
GRANT CONNECT ON DATABASE appdb TO app_readonly;
GRANT CONNECT ON DATABASE appdb TO app_migration;
```

Prinsipnya:

```text
Default deny, explicit allow.
```

Untuk sistem production, akses implisit sering menjadi sumber privilege creep.

---

## 11. Role Separation untuk Java Application

Minimal role yang sehat:

```text
app_owner      NOLOGIN, owner object
app_runtime    LOGIN, DML minimum untuk service utama
app_readonly   LOGIN, SELECT-only untuk dashboard/reporting aman
app_migration  LOGIN, DDL via pipeline migration
app_batch      LOGIN, privilege khusus batch bila berbeda
app_support    LOGIN, privilege terbatas untuk support tooling
```

Contoh:

```sql
CREATE ROLE app_owner NOLOGIN;
CREATE ROLE app_runtime LOGIN;
CREATE ROLE app_readonly LOGIN;
CREATE ROLE app_migration LOGIN;

GRANT CONNECT ON DATABASE appdb TO app_runtime, app_readonly, app_migration;
GRANT USAGE ON SCHEMA app TO app_runtime, app_readonly, app_migration;

GRANT SELECT ON ALL TABLES IN SCHEMA app TO app_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;
```

Jangan jadikan migration role sama dengan runtime role. Migration role biasanya perlu DDL, sedangkan runtime role tidak.

Kenapa penting?

Jika SQL injection terjadi pada runtime role:

```sql
DROP TABLE app.payment;
```

akan gagal bila runtime role tidak punya DDL privilege.

Jika runtime role hanya punya akses ke schema tertentu, injection tidak mudah menyentuh schema audit/internal.

Least privilege bukan menggantikan parameter binding, tetapi mengurangi blast radius ketika binding gagal.

---

## 12. Read-only Role Tidak Selalu Sederhana

Read-only role biasanya:

```sql
GRANT SELECT ON ALL TABLES IN SCHEMA app TO app_readonly;
```

Tapi perhatikan:

1. Function bisa punya side effect bila `VOLATILE`.
2. `SECURITY DEFINER` function bisa menjalankan privilege owner.
3. Temporary object bisa memenuhi disk.
4. Long-running reporting query bisa mengganggu vacuum atau IO.
5. Read-only query bisa mengambil lock ringan yang tetap relevan terhadap DDL.

Untuk reporting berat, pertimbangkan:

- read replica;
- statement timeout khusus;
- work_mem khusus;
- role khusus BI;
- view/projection khusus;
- masking data sensitif;
- limit pada koneksi.

Read-only tidak berarti zero-risk.

---

## 13. Row-Level Security: Kapan Perlu dan Bagaimana Berpikir

Row-Level Security atau RLS membatasi akses row berdasarkan policy.

Contoh multi-tenant sederhana:

```sql
ALTER TABLE app.case_file ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_case_file
ON app.case_file
USING (tenant_id = current_setting('app.tenant_id')::uuid)
WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

Aplikasi Java mengatur tenant context saat checkout connection atau awal transaksi:

```sql
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
```

Gunakan `SET LOCAL` di dalam transaksi agar nilai hilang saat transaksi selesai.

Mental model:

```text
USING      = row mana yang boleh terlihat/dimodifikasi
WITH CHECK = row baru/hasil update harus memenuhi kondisi apa
```

RLS sangat kuat untuk:

- multi-tenant isolation;
- regulatory data segmentation;
- delegated access;
- defense-in-depth saat aplikasi lupa filter tenant.

Namun RLS bukan gratis:

- policy harus ikut query planning;
- debugging query bisa lebih sulit;
- superuser/table owner dapat bypass kecuali dikonfigurasi ketat;
- connection pooling transaction mode bisa membuat session variable tricky;
- migration dan background job perlu policy yang jelas.

---

## 14. RLS dengan Java dan Connection Pooling

Masalah klasik:

```text
Request tenant A memakai connection X.
Session variable tenant_id diset ke A.
Connection dikembalikan ke pool.
Request tenant B memakai connection X.
Jika tenant_id tidak dibersihkan, B bisa berjalan dalam context A.
```

Solusi yang lebih aman:

1. Bungkus semua request DB dalam transaksi eksplisit.
2. Gunakan `SET LOCAL`, bukan `SET`, untuk tenant context.
3. Pastikan setiap operation yang memerlukan RLS berada dalam transaction boundary yang sama.
4. Jangan mengandalkan session variable global tanpa cleanup.
5. Test leakage antar request.

Spring pattern konseptual:

```java
@Transactional
public CaseFile loadCase(UUID tenantId, UUID caseId) {
    jdbcTemplate.update("select set_config('app.tenant_id', ?, true)", tenantId.toString());
    return repository.findById(caseId).orElseThrow();
}
```

Parameter ketiga `true` pada `set_config` membuat setting berlaku local terhadap transaksi.

Trap:

```java
repository.findById(caseId)
```

tanpa tenant context akan gagal atau mengembalikan kosong bila RLS benar. Itu lebih baik daripada bocor.

---

## 15. RLS Bukan Pengganti Data Model yang Benar

RLS tidak menyelamatkan model yang buruk.

Jika semua data tenant tercampur tanpa `tenant_id` konsisten, RLS sulit diterapkan.

Pastikan:

```sql
tenant_id uuid NOT NULL
```

ada di table tenant-scoped.

Gunakan composite uniqueness:

```sql
CREATE UNIQUE INDEX uq_case_tenant_case_number
ON app.case_file (tenant_id, case_number);
```

Foreign key tenant-aware:

```sql
ALTER TABLE app.case_note
ADD CONSTRAINT fk_case_note_case
FOREIGN KEY (tenant_id, case_id)
REFERENCES app.case_file (tenant_id, id);
```

Dengan begitu, RLS menjadi lapisan pertahanan tambahan di atas invariant fisik.

---

## 16. SQL Injection: Bukan Hanya String Concatenation

Prepared statement adalah baseline.

Buruk:

```java
String sql = "select * from app.case_file where case_number = '" + input + "'";
```

Baik:

```java
jdbcTemplate.query(
    "select * from app.case_file where case_number = ?",
    rowMapper,
    input
);
```

Namun injection juga muncul di area yang tidak bisa diparameterkan sebagai value:

- dynamic table name;
- dynamic column name;
- dynamic sort direction;
- dynamic SQL dalam PL/pgSQL;
- JSON path/string expression;
- full-text query construction;
- `LIKE` pattern semantics;
- raw `@Query` di Spring Data;
- `EntityManager.createNativeQuery`;
- jOOQ plain SQL string;
- MyBatis `${}` interpolation;
- report builder/filter builder.

Untuk dynamic identifier, gunakan allowlist, bukan escaping manual.

Contoh:

```java
enum SortField {
    CREATED_AT("created_at"),
    PRIORITY("priority"),
    STATUS("status");

    final String column;
}
```

Lalu bentuk SQL dari enum internal, bukan input bebas.

---

## 17. Privilege sebagai Mitigasi Injection

Anggap suatu hari ada injection. Pertanyaannya:

```text
Seberapa jauh damage-nya?
```

Jika runtime role punya privilege besar, injection bisa:

- baca seluruh table;
- update/delete data;
- create function;
- drop object;
- disable trigger;
- call unsafe function;
- access schema lain.

Jika runtime role minimal:

- injection terhadap read endpoint read-only tidak bisa write;
- injection tidak bisa DDL;
- injection tidak bisa akses schema audit internal;
- RLS membatasi tenant;
- timeout membatasi blast availability.

Security posture yang baik mengasumsikan bug aplikasi mungkin terjadi.

```text
Prepared statements reduce probability.
Least privilege reduces impact.
RLS reduces horizontal blast radius.
Audit improves detection and accountability.
```

---

## 18. Function Security: `SECURITY DEFINER` dan `search_path`

`SECURITY DEFINER` membuat function berjalan dengan privilege owner, bukan caller.

Ini berguna untuk memberikan capability terbatas:

```sql
CREATE FUNCTION app.close_case(p_case_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  UPDATE app.case_file
  SET status = 'CLOSED'
  WHERE id = p_case_id;
END;
$$;
```

Tetapi berbahaya jika:

- `search_path` tidak dikunci;
- function memakai dynamic SQL tidak aman;
- owner terlalu privileged;
- caller bisa membuat object shadowing di schema lain;
- function melakukan operasi terlalu luas.

Rule:

```text
Every SECURITY DEFINER function must explicitly set search_path.
```

Juga lakukan revoke default execute jika perlu:

```sql
REVOKE ALL ON FUNCTION app.close_case(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.close_case(uuid) TO app_runtime;
```

---

## 19. Sequence Privileges

Table privilege tidak otomatis cukup untuk sequence.

Jika table memakai sequence/identity dan role melakukan insert, role mungkin perlu:

```sql
GRANT USAGE, SELECT ON SEQUENCE app.case_file_id_seq TO app_runtime;
```

Atau untuk semua sequence:

```sql
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA app TO app_runtime;
```

Default privileges juga penting:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;
```

Failure mode umum setelah migration:

```text
permission denied for sequence ...
```

Ini sering terjadi karena table baru dibuat oleh migration role, tetapi default privileges belum benar.

---

## 20. Secrets Management

Database password tidak boleh dianggap config biasa.

Anti-pattern:

```yaml
env:
  POSTGRES_PASSWORD: supersecret
```

lalu:

- masuk Git;
- muncul di deployment diff;
- terbaca oleh semua operator cluster;
- bocor di crash dump;
- dipakai ulang antar environment.

Prinsip:

1. Secret disimpan di secret manager.
2. Secret berbeda per environment.
3. Secret berbeda per role/service.
4. Secret punya rotation plan.
5. Secret tidak dicetak di log.
6. Secret tidak masuk migration file.
7. Secret tidak dibagikan ke developer kecuali perlu.
8. Secret lama dicabut setelah rotation.

Untuk Java:

- gunakan externalized configuration;
- jangan log full JDBC URL bila berisi password;
- hati-hati Actuator/env endpoint;
- batasi thread dump/config dump;
- pastikan exception tidak mencetak credential.

---

## 21. Credential Rotation Tanpa Downtime

Rotation ideal:

```text
create/alter new credential
  -> deploy app with new credential
  -> observe all connections migrated
  -> revoke old credential
```

Karena PostgreSQL role hanya punya satu password aktif per role, strategi umum adalah memakai dua login role bergantian:

```text
app_runtime_a
app_runtime_b
```

Keduanya member dari permission role yang sama:

```sql
CREATE ROLE app_runtime_permissions NOLOGIN;
GRANT app_runtime_permissions TO app_runtime_a;
GRANT app_runtime_permissions TO app_runtime_b;
```

Rotation:

1. App memakai `app_runtime_a`.
2. Buat/aktifkan `app_runtime_b` dengan secret baru.
3. Deploy app ke `app_runtime_b`.
4. Pastikan tidak ada session aktif `app_runtime_a`.
5. Disable/drop/rotate `app_runtime_a`.

Ini lebih mudah daripada mengganti password role yang sedang dipakai semua pod.

---

## 22. Auditability: Apa yang Harus Bisa Dijawab

Audit database bukan hanya log semua query. Audit harus bisa menjawab pertanyaan domain dan teknis:

```text
Siapa mengubah status case ini?
Kapan data ini berubah?
Dari service mana perubahan datang?
Request/correlation id apa?
User bisnis mana yang memicu?
Role database apa yang dipakai?
Apakah perubahan melalui API resmi atau manual SQL?
Apakah ada perubahan privilege?
Apakah ada query yang membaca data sensitif secara masif?
```

Audit layer bisa terdiri dari:

1. Application audit table.
2. Database trigger audit untuk table kritis.
3. PostgreSQL logs.
4. Extension audit seperti pgaudit bila tersedia/diizinkan.
5. Cloud provider audit logs.
6. IAM/secret manager access logs.
7. Backup/restore logs.
8. Migration pipeline logs.

Jangan berharap satu layer menyelesaikan semua.

---

## 23. Application Audit vs Database Audit

Application audit tahu konteks bisnis:

- authenticated user;
- actor type;
- case id;
- workflow transition;
- reason code;
- approval id;
- request id.

Database audit tahu efek storage:

- row berubah;
- role database;
- SQL operation;
- timestamp database;
- old/new value jika trigger audit.

Untuk regulatory system, gabungkan keduanya.

Contoh audit table:

```sql
CREATE TABLE app.audit_event (
    id uuid PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid,
    actor_service text NOT NULL,
    request_id text,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    action text NOT NULL,
    reason_code text,
    before_state jsonb,
    after_state jsonb
);
```

Jangan menyimpan data sensitif tanpa pertimbangan. Audit log juga bisa menjadi sumber kebocoran.

---

## 24. Logging Security

PostgreSQL logging harus membantu diagnosis tanpa membocorkan data.

Parameter yang sering relevan:

```conf
log_connections = on
log_disconnections = on
log_lock_waits = on
log_min_duration_statement = '500ms'
log_line_prefix = '%m [%p] user=%u db=%d app=%a client=%h '
```

Hati-hati dengan:

```conf
log_statement = 'all'
```

Ini bisa mencatat semua query, termasuk literal sensitif jika aplikasi mengirim SQL dengan literal atau driver/log layer mengekspansi parameter.

Lebih baik gunakan:

- slow query logging;
- `pg_stat_statements` untuk fingerprint;
- application-level trace id;
- redaction policy;
- limited retention.

Untuk Java, set `application_name`:

```properties
jdbc:postgresql://db/appdb?ApplicationName=case-service
```

Atau melalui Hikari/JDBC property. Ini membantu menghubungkan `pg_stat_activity` dengan service.

---

## 25. Data Classification dan Column-level Thinking

Tidak semua data punya sensitivitas sama.

Klasifikasikan:

| Kelas | Contoh | Kontrol |
|---|---|---|
| Public/internal low | lookup code | normal privilege |
| Business confidential | case status, assignment | least privilege, audit |
| Personal data | name, email, ID number | masking, restricted access, retention |
| Highly sensitive | legal evidence, medical/financial data | encryption, stricter audit, separation |
| Secret | token, credential | jangan simpan plaintext, secret manager |

PostgreSQL tidak otomatis memahami klasifikasi ini. Model schema dan role harus mencerminkannya.

Pattern:

```text
app.case_file              normal business table
app.case_sensitive_detail  restricted table, FK to case_file
app.case_public_projection limited read projection
```

Dengan split table, role yang butuh case metadata tidak otomatis mendapat data sensitif.

---

## 26. Encryption at Rest: Database vs Disk vs Application

PostgreSQL core tradisional mengandalkan encryption at rest di level storage/filesystem/cloud provider. Managed PostgreSQL biasanya menyediakan disk encryption.

Tapi disk encryption tidak melindungi dari:

- SQL user yang punya SELECT;
- DBA superuser;
- query injection;
- dump/log leakage;
- application bug.

Application-level encryption bisa dipakai untuk field sangat sensitif, tetapi trade-off besar:

- query/filter sulit;
- index terbatas;
- rotation key kompleks;
- debugging susah;
- partial update sulit;
- backup restore harus sinkron dengan key.

Prinsip:

```text
Use storage encryption for baseline.
Use column/application encryption only for data that truly needs it.
Do not use encryption to compensate for bad privilege design.
```

---

## 27. Backup Security

Backup sering lebih berbahaya daripada database live karena:

- bentuknya file portable;
- bisa disalin;
- bisa dipulihkan di environment longgar;
- sering punya akses broad;
- kadang retention panjang.

Controls:

1. Encrypt backup.
2. Batasi siapa bisa read backup object storage.
3. Pisahkan permission backup write vs restore/read.
4. Audit akses backup.
5. Test restore ke isolated environment.
6. Sanitasi data jika restore ke dev/staging.
7. Lindungi WAL archive.
8. Lindungi key encryption.
9. Jangan menaruh dump production di laptop.

Untuk regulatory defensibility, backup access adalah bagian dari data access story.

---

## 28. Security dalam Migration Pipeline

Migration tool seperti Flyway/Liquibase sering butuh DDL privilege. Itu tidak berarti aplikasi runtime harus punya privilege yang sama.

Pattern:

```text
CI/CD migration job -> app_migration role
runtime service     -> app_runtime role
reporting service   -> app_readonly role
```

Migration risk:

- destructive DDL;
- privilege berubah tidak sengaja;
- object owner salah;
- default privileges lupa;
- RLS policy tidak ikut dibuat;
- function `SECURITY DEFINER` tanpa `search_path`;
- extension dibuat tanpa governance;
- migration file menyimpan secret.

Migration review checklist:

```text
Apakah migration mengubah privilege?
Apakah owner object benar?
Apakah default privilege masih benar?
Apakah RLS perlu policy baru?
Apakah table sensitif ikut audit?
Apakah role runtime mendapat izin lebih dari perlu?
Apakah rollback realistis?
```

---

## 29. Security di Read Replica dan HA

Read replica sering dianggap aman karena read-only. Itu keliru.

Replica tetap berisi data production.

Risiko:

- reporting user terlalu luas;
- replica dibuka ke network BI/vendor;
- data masking tidak ada;
- replica lag membuat policy/debugging membingungkan;
- failover membuat replica menjadi primary dengan konfigurasi berbeda;
- replication slot/WAL archive bocor.

Pastikan:

1. `pg_hba.conf` replica juga ketat.
2. TLS juga berlaku.
3. Role dan privilege konsisten.
4. Monitoring mencakup replica.
5. Read-only endpoint tidak memakai credential primary superuser.
6. Failover tidak mengganti security posture.

HA bukan hanya availability. HA harus mempertahankan security invariants saat topology berubah.

---

## 30. Multi-tenant Security Model

Ada tiga model umum:

```text
1. tenant_id column shared schema
2. schema per tenant
3. database per tenant
```

### 30.1 Shared schema + tenant_id

Kelebihan:

- sederhana operasional;
- efisien resource;
- mudah aggregate/reporting;
- migration lebih mudah.

Risiko:

- cross-tenant leak jika filter lupa;
- hot tenant;
- RLS perlu disiplin.

Kontrol:

- `tenant_id NOT NULL`;
- composite FK dengan `tenant_id`;
- composite unique index;
- RLS;
- test leakage;
- app context per transaction.

### 30.2 Schema per tenant

Kelebihan:

- isolasi object lebih jelas;
- backup/restore tenant bisa lebih mudah dalam beberapa skenario.

Risiko:

- migration ribuan schema;
- query lintas tenant sulit;
- connection/session `search_path` risk;
- privilege complexity.

### 30.3 Database per tenant

Kelebihan:

- isolasi kuat;
- restore/move tenant lebih jelas.

Risiko:

- connection pool explosion;
- migration orchestration;
- monitoring banyak database;
- cost operasional.

Tidak ada model universal. Pilih berdasarkan isolation requirement, tenant count, workload variance, compliance, dan operability.

---

## 31. Session State Security Trap

Session state PostgreSQL meliputi:

- `search_path`;
- custom GUC seperti `app.tenant_id`;
- temp table;
- prepared statement;
- role setting;
- advisory lock;
- transaction state.

Dengan connection pool, session state bisa bocor antar request jika tidak dibersihkan.

Contoh bahaya:

```sql
SET ROLE app_admin;
-- lupa RESET ROLE
```

atau:

```sql
SET search_path = tenant_a, public;
-- connection kembali ke pool
```

Rule:

1. Prefer `SET LOCAL` dalam transaksi.
2. Reset connection state saat return to pool jika perlu.
3. Jangan pakai session-level tenant context tanpa guardrail.
4. Hindari dynamic `search_path` untuk multi-tenant kecuali sangat disiplin.
5. Gunakan transaction boundary eksplisit.

---

## 32. Search Path Security

`search_path` menentukan schema lookup untuk object tanpa schema qualification.

Buruk:

```sql
SELECT do_sensitive_action();
```

Lebih aman:

```sql
SELECT app.do_sensitive_action();
```

Jika `search_path` bisa dimanipulasi, object shadowing bisa terjadi, terutama di function `SECURITY DEFINER`.

Baseline:

```sql
ALTER ROLE app_runtime SET search_path = app, pg_temp;
```

Untuk function sensitif:

```sql
CREATE FUNCTION app.some_function()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  -- schema-qualify object penting
END;
$$;
```

Jangan membiarkan schema writable oleh role tidak dipercaya berada lebih dulu di search path.

---

## 33. Timeout sebagai Security/Availability Control

Security juga tentang mencegah query merusak availability.

Set per role:

```sql
ALTER ROLE app_runtime SET statement_timeout = '5s';
ALTER ROLE app_runtime SET lock_timeout = '1s';
ALTER ROLE app_runtime SET idle_in_transaction_session_timeout = '30s';
```

Untuk reporting:

```sql
ALTER ROLE app_readonly SET statement_timeout = '60s';
ALTER ROLE app_readonly SET idle_in_transaction_session_timeout = '30s';
```

Manfaat:

- injection berat tidak berjalan selamanya;
- accidental Cartesian product dibatasi;
- lock wait tidak membuat thread pool habis;
- idle transaction tidak menahan vacuum terlalu lama.

Timeout bukan pengganti tuning, tetapi guardrail.

---

## 34. Security Testing

Security PostgreSQL harus diuji seperti behavior aplikasi lain.

Test cases:

1. Runtime role tidak bisa DDL.
2. Runtime role tidak bisa akses schema lain.
3. Readonly role tidak bisa insert/update/delete.
4. RLS mencegah tenant A membaca tenant B.
5. RLS mencegah insert row tenant lain.
6. Connection pool tidak membocorkan tenant context.
7. Function `SECURITY DEFINER` tidak bisa dieksploitasi via `search_path`.
8. Migration menciptakan object owner/privilege yang benar.
9. Backup restore ke staging tidak membawa credential production.
10. SQL injection payload tidak mengubah query semantics.

Contoh test konseptual:

```sql
SET ROLE app_readonly;
INSERT INTO app.case_file (...) VALUES (...);
-- expect permission denied
```

Untuk RLS:

```sql
BEGIN;
SELECT set_config('app.tenant_id', 'tenant-a-uuid', true);
SELECT * FROM app.case_file WHERE tenant_id = 'tenant-b-uuid';
-- expect zero rows
ROLLBACK;
```

---

## 35. Production Security Baseline Checklist

Gunakan checklist ini sebagai baseline review.

### Identity dan auth

- [ ] Runtime app tidak memakai superuser.
- [ ] Role login dipisah dari permission role.
- [ ] Migration role berbeda dari runtime role.
- [ ] Read-only role benar-benar read-only.
- [ ] SCRAM-SHA-256 atau auth method kuat digunakan.
- [ ] Password/secret tidak disimpan di Git.
- [ ] Credential rotation punya prosedur.

### Network dan TLS

- [ ] PostgreSQL tidak terbuka ke public internet kecuali ada desain khusus yang sangat kuat.
- [ ] `pg_hba.conf` membatasi database, user, dan CIDR.
- [ ] Rule `pg_hba.conf` tidak terlalu longgar di bagian atas.
- [ ] TLS aktif untuk koneksi remote production.
- [ ] Java client memverifikasi server bila memungkinkan.

### Privilege

- [ ] `PUBLIC` tidak punya privilege tidak perlu.
- [ ] Runtime role tidak punya DDL privilege.
- [ ] Schema privilege eksplisit.
- [ ] Sequence privilege benar.
- [ ] Default privileges benar untuk future objects.
- [ ] Function execute privilege direview.

### Data access

- [ ] Table tenant-scoped memiliki `tenant_id NOT NULL`.
- [ ] Cross-tenant FK/unique constraint tenant-aware bila perlu.
- [ ] RLS dipakai bila isolation requirement tinggi.
- [ ] Sensitive data dipisah/masked sesuai kebutuhan.
- [ ] BI/reporting tidak mendapat akses lebih dari perlu.

### Application safety

- [ ] Semua value user memakai parameter binding.
- [ ] Dynamic identifier memakai allowlist.
- [ ] Raw native SQL direview.
- [ ] ORM query logging tidak membocorkan PII/secret.
- [ ] Connection session state tidak bocor antar request.
- [ ] `application_name` diset.

### Audit dan operasi

- [ ] Slow query/connection/lock logging diset sesuai policy.
- [ ] Audit event domain tersedia untuk aksi penting.
- [ ] Privilege changes diaudit.
- [ ] Backup terenkripsi dan aksesnya diaudit.
- [ ] Restore drill mencakup security posture.
- [ ] Failover drill memvalidasi role/auth/TLS tetap benar.

---

## 36. Common Failure Modes

### 36.1 App memakai owner role

Gejala:

- aplikasi bisa drop/alter table;
- injection berbahaya;
- migration dan runtime tidak terpisah.

Perbaikan:

- buat owner role NOLOGIN;
- buat runtime role minimal;
- pindahkan ownership object;
- grant privilege eksplisit.

### 36.2 Default privileges lupa

Gejala:

```text
permission denied for table new_table
```

setelah deploy migration.

Perbaikan:

- set `ALTER DEFAULT PRIVILEGES` untuk owner/migration role yang benar;
- audit object owner;
- tambahkan test migration privilege.

### 36.3 Tenant context bocor di connection pool

Gejala:

- request tenant B mendapat data tenant A;
- bug sulit direproduksi;
- hanya muncul di traffic concurrent.

Perbaikan:

- pakai `SET LOCAL`;
- transaction boundary eksplisit;
- reset state;
- test tenant switching di pool yang sama.

### 36.4 `SECURITY DEFINER` tanpa `search_path`

Gejala:

- privilege escalation potensial;
- function memanggil object yang salah.

Perbaikan:

- set `search_path` eksplisit;
- schema-qualify object;
- revoke execute from public;
- review dynamic SQL.

### 36.5 Read replica terlalu terbuka

Gejala:

- data production bisa dibaca luas dari reporting endpoint;
- audit hanya fokus primary.

Perbaikan:

- samakan security baseline replica;
- buat role reporting terbatas;
- masking/projection;
- audit akses replica.

---

## 37. Java/Spring/Hibernate Security Notes

### 37.1 Spring Data `@Query`

Aman jika parameter binding benar:

```java
@Query("select c from CaseFile c where c.caseNumber = :caseNumber")
Optional<CaseFile> findByCaseNumber(@Param("caseNumber") String caseNumber);
```

Berbahaya jika string query dibangun manual dari input.

### 37.2 Native query

Native query sah, tetapi harus direview lebih ketat:

```java
entityManager.createNativeQuery(sql)
```

Pastikan:

- value diparameterkan;
- identifier dari allowlist;
- tidak ada concatenation input bebas;
- privilege DB membatasi damage.

### 37.3 Hibernate multi-tenancy

Jika memakai discriminator column tenant, pastikan:

- tenant filter tidak bisa lupa;
- repository internal tidak bypass;
- native query tetap tenant-aware;
- RLS dipertimbangkan sebagai defense-in-depth.

### 37.4 Connection leak dan security

Connection leak bukan hanya performance issue. Jika connection menyimpan session state seperti role/tenant/search_path, leak bisa menjadi security issue.

### 37.5 Error handling

Jangan mengembalikan raw DB error ke user eksternal.

Buruk:

```json
{
  "error": "permission denied for table app.case_sensitive_detail"
}
```

Lebih baik map ke error domain yang aman:

```json
{
  "error": "ACCESS_DENIED"
}
```

Log internal tetap cukup detail dengan correlation id.

---

## 38. Security Design untuk Regulatory Case Management

Untuk sistem enforcement/case management, data biasanya punya:

- case metadata;
- involved parties;
- evidence;
- internal notes;
- decisions;
- escalation history;
- audit trail;
- legal/regulatory deadlines.

Security model yang masuk akal:

```text
case_file                 tenant/agency scoped
case_assignment           user/team scoped
case_sensitive_detail     restricted role
case_evidence             stricter access + audit
case_note                 visibility level
case_transition_event     append-only audit
case_public_projection    limited view for broad read
```

Role:

```text
case_service_runtime
case_reporting_readonly
case_support_limited
case_evidence_processor
case_migration
```

Controls:

- RLS untuk tenant/agency;
- view untuk projection aman;
- table split untuk sensitive data;
- append-only transition event;
- trigger atau application audit untuk critical state change;
- least privilege per service;
- statement timeout untuk reporting;
- backup access audit.

Invariant penting:

```text
A user journey check in Java is not enough.
Database privilege and constraints must prevent impossible states and unauthorized writes where feasible.
```

---

## 39. Operational Runbook: Suspected Unauthorized Access

Saat ada dugaan akses tidak sah:

1. Jangan langsung restart semua kecuali perlu containment.
2. Identifikasi role/database/client/app:

```sql
SELECT pid, usename, datname, application_name, client_addr, state, query_start, query
FROM pg_stat_activity
ORDER BY query_start NULLS LAST;
```

3. Cek koneksi mencurigakan.
4. Revoke/disable credential jika perlu:

```sql
ALTER ROLE suspicious_role NOLOGIN;
```

5. Rotate secret service terkait.
6. Ambil snapshot log/audit sebelum retention hilang.
7. Cek privilege role:

```sql
SELECT * FROM information_schema.role_table_grants
WHERE grantee = 'suspicious_role';
```

8. Cek perubahan DDL/migration terbaru.
9. Cek backup/object storage access.
10. Cek apakah RLS/privilege berubah.
11. Buat incident timeline.
12. Setelah containment, lakukan root cause dan hardening.

---

## 40. Kesimpulan Part 029

Security PostgreSQL yang matang bukan satu konfigurasi, tetapi sistem kontrol berlapis.

Model utamanya:

```text
Network restricts who can reach PostgreSQL.
pg_hba.conf restricts who can attempt authentication.
Authentication proves identity.
Roles define database identity.
Privileges define object capability.
RLS defines row visibility/modifiability.
Constraints preserve integrity.
Prepared statements reduce injection risk.
Least privilege reduces injection impact.
TLS protects transport.
Secrets management protects credentials.
Audit makes actions accountable.
Backup security protects copied data.
Operational runbooks keep controls intact during incidents.
```

Untuk Java engineer, poin paling penting:

1. Jangan pakai superuser untuk aplikasi.
2. Pisahkan owner, migration, runtime, readonly, support role.
3. Gunakan least privilege.
4. Gunakan parameter binding dan allowlist untuk dynamic SQL.
5. Pahami session state bila memakai connection pool.
6. Gunakan RLS dengan hati-hati untuk multi-tenant/isolation requirement tinggi.
7. Jangan membiarkan backup/log menjadi jalur kebocoran.
8. Audit harus menjawab pertanyaan domain, bukan hanya query teknis.
9. Security harus diuji dan dibawa dalam migration/failover/restore lifecycle.

Jika Part 028 membahas bagaimana PostgreSQL tetap tersedia saat topology berubah, Part 029 memastikan perubahan topology, koneksi, role, dan aplikasi tidak merusak batas keamanan.

---

## 41. Checklist Pemahaman

Kamu siap lanjut jika bisa menjawab:

1. Apa beda login role, permission role, owner role, dan superuser?
2. Kenapa aplikasi tidak boleh memakai owner role?
3. Bagaimana `pg_hba.conf` menentukan rule authentication?
4. Apa bedanya TLS `require`, `verify-ca`, dan `verify-full` secara konseptual?
5. Kenapa `PUBLIC` perlu direview?
6. Kenapa default privileges penting untuk migration?
7. Bagaimana RLS bisa bocor jika tenant context disimpan sebagai session state?
8. Apa perbedaan `USING` dan `WITH CHECK` pada RLS policy?
9. Kenapa prepared statement tidak cukup sebagai satu-satunya kontrol injection?
10. Apa risiko `SECURITY DEFINER` tanpa `search_path` eksplisit?
11. Bagaimana mendesain role untuk runtime, migration, dan reporting?
12. Kenapa backup termasuk bagian security model?
13. Apa yang harus dilakukan saat credential DB diduga bocor?

---

## 42. Preview Part 030

Part berikutnya:

```text
Part 030 — Migration dan Zero-downtime Schema Change
```

Kita akan membahas:

- DDL locking;
- transactional DDL;
- expand-contract pattern;
- add column aman;
- backfill aman;
- `CREATE INDEX CONCURRENTLY`;
- `NOT VALID` constraint;
- migration role;
- Flyway/Liquibase strategy;
- backward/forward compatibility;
- rollback reality;
- zero-downtime checklist untuk Java services.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — High Availability Architecture: Patroni, pgBackRest, HAProxy, dan Cloud-managed PostgreSQL</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-030.md">Part 030 — Migration dan Zero-downtime Schema Change ➡️</a>
</div>

# learn-sql-mastery-for-java-engineers-part-024.md

# Part 24 — Security: Permissions, Row-Level Security, SQL Injection, and Data Protection

> Seri: SQL Mastery for Java Engineers  
> Bagian: 024 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-023.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-025.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas temporal data, auditability, dan historical truth. Sekarang kita membahas security dari sudut pandang SQL dan Java backend.

Banyak engineer menyederhanakan database security menjadi satu kalimat:

```text
Gunakan prepared statement supaya tidak SQL injection.
```

Itu benar, tetapi tidak cukup.

Database menyimpan aset paling bernilai:

- user identity
- PII
- regulatory case data
- evidence metadata
- financial records
- audit trails
- decision records
- internal risk score
- external payload
- business history
- read models
- report snapshots
- operational logs

Security database mencakup:

```text
authentication
authorization
least privilege
roles/grants
row-level security
SQL injection prevention
safe dynamic SQL
tenant isolation
data classification
masking
redaction
encryption
secret management
backup security
audit
monitoring
migration safety
```

Kalimat inti:

> Database security bukan hanya mencegah injection; ia adalah desain akses, privilege, data exposure, audit, dan failure containment agar bug aplikasi tidak otomatis menjadi data breach.

---

## 1. Threat Model Dasar

Sebelum bicara fitur, tentukan threat model.

Pertanyaan:

```text
Data apa yang dilindungi?
Siapa yang boleh melihat?
Siapa yang boleh mengubah?
Apa jalur serangan?
Apa dampak jika bocor?
Apa dampak jika diubah?
Apa dampak jika hilang?
```

Threat actor:

- external attacker
- malicious user
- compromised user account
- compromised application server
- compromised service credential
- insider misuse
- buggy app code
- mistaken migration
- BI/reporting user
- third-party integration
- leaked backup
- leaked logs

Threat category:

- unauthorized read
- unauthorized write
- SQL injection
- tenant data leakage
- privilege escalation
- data exfiltration
- audit tampering
- destructive delete
- ransomware
- backup exposure
- read model exposure
- stale redaction in search index

Security design harus mengurangi kemungkinan dan blast radius dari semua kategori ini.

---

## 2. CIA: Confidentiality, Integrity, Availability

### 2.1 Confidentiality

Mencegah data dilihat pihak tidak berwenang.

Contoh:

```text
Tenant A tidak boleh melihat data Tenant B.
Officer hanya melihat case yang assigned.
Support staff melihat data masked.
BI user tidak melihat sensitive columns.
```

### 2.2 Integrity

Mencegah perubahan tidak sah atau tidak valid.

Contoh:

```text
User tidak boleh approve request sendiri.
Case decision yang sudah issued tidak boleh overwrite.
Audit log tidak boleh diedit runtime app.
State transition harus valid.
```

### 2.3 Availability

Mencegah sistem tidak bisa dipakai.

Contoh:

```text
Runaway query diberi statement timeout.
Migration tidak boleh lock table terlalu lama.
App runtime tidak boleh punya DROP TABLE.
Connection pool tidak boleh habis karena long transaction.
```

Security bukan hanya kerahasiaan, tetapi juga integritas dan ketersediaan.

---

## 3. Authentication vs Authorization

Authentication:

```text
Siapa kamu?
```

Authorization:

```text
Apa yang boleh kamu lakukan?
```

Database authentication:

- username/password
- certificate
- IAM auth
- Kerberos/SSO
- service account credential

Application authentication:

- session
- JWT
- OAuth/OIDC
- mTLS
- service identity

Database authorization:

- roles
- grants
- schemas
- table privileges
- column privileges
- RLS policies
- procedure execute permission

Application authorization:

- tenant membership
- domain role
- workflow permission
- ownership
- supervisor relationship
- approval authority

Sistem matang memakai app-level authorization dan database least privilege.

---

## 4. Principle of Least Privilege

Least privilege:

```text
Principal hanya punya permission yang benar-benar dibutuhkan.
```

Anti-pattern:

```text
Aplikasi production connect sebagai superuser atau schema owner.
```

Risiko:

- SQL injection bisa drop schema
- bug bisa alter table
- compromised app punya full database control
- audit bisa dihapus
- RLS bisa bypass
- migration table bisa dimodifikasi
- blast radius sangat besar

Lebih baik:

```text
app_runtime_user: DML terbatas
app_migration_user: DDL saat deployment
reporting_user: SELECT pada reporting schema
audit_reader: SELECT audit saja
admin_user: controlled human admin
backup_user: backup privilege saja
```

Pisahkan fungsi, pisahkan credential.

---

## 5. Roles and Grants

Gunakan role untuk mengelompokkan privilege.

Contoh role:

```text
app_runtime_role
app_migration_role
app_readonly_role
reporting_role
support_role
audit_reader_role
security_admin_role
```

Contoh grant:

```sql
GRANT SELECT, INSERT, UPDATE ON cases TO app_runtime_role;
GRANT SELECT, INSERT ON case_status_transitions TO app_runtime_role;
GRANT SELECT ON case_work_queue_read_model TO app_runtime_role;

REVOKE DELETE ON audit_events FROM app_runtime_role;
REVOKE ALL ON party_sensitive_data FROM reporting_role;
```

Migration role:

```sql
GRANT CREATE, ALTER, DROP ON SCHEMA app TO app_migration_role;
```

Reporting role:

```sql
GRANT USAGE ON SCHEMA reporting TO reporting_role;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_role;
```

Grants adalah bagian dari schema. Simpan dalam migration, review seperti code.

---

## 6. Object Ownership

Object owner biasanya punya privilege khusus.

Pattern yang sehat:

```text
schema_owner owns objects
app_runtime_role has limited grants
```

Jangan biarkan runtime app connect sebagai owner.

Alasan:

- owner dapat drop/alter object
- owner mungkin bypass RLS tergantung database/config
- owner privilege sulit dibatasi
- app bug menjadi schema-level incident

Runtime role harus menjadi consumer, bukan owner.

---

## 7. Runtime User vs Migration User

### Runtime user

Dipakai aplikasi saat melayani traffic.

Harus punya:

- SELECT/INSERT/UPDATE/DELETE hanya pada table yang perlu
- EXECUTE pada function/procedure yang perlu
- no DDL
- no superuser
- no ownership
- restricted schemas
- sensible timeout
- connection limit jika perlu

### Migration user

Dipakai deployment pipeline.

Boleh punya:

- CREATE/ALTER/DROP
- CREATE INDEX
- ADD CONSTRAINT
- CREATE FUNCTION/TRIGGER
- GRANT/REVOKE

Credential migration user jangan ada di runtime app config.

---

## 8. Data Classification

Security harus dimulai dari klasifikasi data.

Contoh:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
PII
PHI
PCI
LEGAL_HOLD
SECRET
```

Contoh mapping:

```text
cases.case_number -> INTERNAL
cases.internal_risk_score -> CONFIDENTIAL
parties.national_id -> RESTRICTED PII
audit_events.ip_address -> PERSONAL DATA
documents.storage_uri -> CONFIDENTIAL
api_tokens.token_hash -> SECRET
```

Klasifikasi menentukan:

- siapa boleh SELECT
- apakah masuk log
- apakah masuk read model
- apakah perlu masking
- apakah perlu encryption
- retention policy
- redaction policy
- backup handling
- export approval

Tanpa klasifikasi, security menjadi kebetulan.

---

## 9. SQL Injection

SQL injection terjadi ketika input tidak terpercaya menjadi syntax SQL.

Bad Java:

```java
String sql = "SELECT * FROM users WHERE email = '" + email + "'";
```

Jika `email`:

```text
x' OR '1'='1
```

SQL menjadi:

```sql
SELECT * FROM users WHERE email = 'x' OR '1'='1';
```

Dampak:

- authentication bypass
- data leakage
- mass update/delete
- destructive DDL jika privilege memungkinkan
- stored procedure abuse
- time-based extraction
- second-order injection

SQL injection adalah query construction bug + privilege blast radius.

---

## 10. Parameter Binding

Gunakan bind parameter.

JDBC:

```java
PreparedStatement ps = connection.prepareStatement(
    "SELECT id, email FROM users WHERE email = ?"
);
ps.setString(1, email);
```

Spring JDBC:

```java
jdbcTemplate.query(
    "SELECT id, email FROM users WHERE email = ?",
    rowMapper,
    email
);
```

JPA:

```java
entityManager.createQuery(
    "select u from User u where u.email = :email", User.class
)
.setParameter("email", email);
```

Parameter binding memisahkan SQL text dan data value.

Input dianggap value, bukan executable syntax.

---

## 11. Parameter Binding Bukan Manual Escaping

Jangan menjadikan manual escaping sebagai defense utama.

Bad:

```java
String safe = input.replace("'", "''");
String sql = "SELECT * FROM users WHERE name = '" + safe + "'";
```

Masalah:

- escaping sering tidak lengkap
- encoding/collation edge cases
- database-specific syntax
- future edit bisa merusak
- identifier tidak bisa diselesaikan dengan escaping value
- second-order injection tetap mungkin

Gunakan bind parameter.

---

## 12. Dynamic Identifiers

Bind parameter tidak bisa menggantikan table/column name.

Tidak bisa:

```sql
SELECT * FROM ? WHERE id = ?
```

Untuk sorting dari request:

Bad:

```java
String sql = "SELECT * FROM cases ORDER BY " + request.sortBy();
```

Good:

```java
Map<String, String> allowedSorts = Map.of(
    "openedAt", "opened_at",
    "priority", "priority_rank",
    "caseNumber", "case_number"
);

String column = allowedSorts.get(request.sortBy());
if (column == null) {
    throw new BadRequestException("Unsupported sort");
}

String direction = request.desc() ? "DESC" : "ASC";

String sql =
    "SELECT id, case_number, priority " +
    "FROM cases " +
    "WHERE tenant_id = ? " +
    "ORDER BY " + column + " " + direction + ", id DESC " +
    "LIMIT ?";
```

Identifier harus allowlisted.

---

## 13. Dynamic IN Lists

Bad:

```java
String ids = request.ids().stream()
    .map(UUID::toString)
    .collect(Collectors.joining(","));

String sql = "SELECT * FROM cases WHERE id IN (" + ids + ")";
```

Safe options:

- generate placeholders
- bind array parameter
- temp table
- table-valued parameter
- staging table for large sets

Placeholder pattern:

```java
String placeholders = request.ids().stream()
    .map(id -> "?")
    .collect(Collectors.joining(","));

String sql =
    "SELECT id, case_number " +
    "FROM cases " +
    "WHERE id IN (" + placeholders + ")";
```

Bind each UUID with correct JDBC type.

---

## 14. LIKE Wildcards

Parameter binding mencegah SQL injection, tetapi wildcard tetap punya semantics.

```sql
WHERE name LIKE ?
```

Parameter `%` akan match semua row.

Jika input harus literal, escape wildcard:

- `%`
- `_`
- escape char

Example:

```sql
WHERE name LIKE :pattern ESCAPE '\'
```

App membuat:

```text
%escaped_user_input%
```

Tentukan apakah wildcard search memang boleh.

---

## 15. Second-Order Injection

Second-order injection:

1. input malicious disimpan sebagai data
2. nanti data itu dipakai untuk membangun SQL secara tidak aman

Contoh:

```text
report name = x'; DROP TABLE cases; --
```

Lalu job:

```java
String sql = "CREATE VIEW " + reportName + " AS SELECT ...";
```

Stored value berubah menjadi SQL syntax.

Prevention:

- jangan percaya stored data sebagai SQL
- allowlist identifiers
- quote identifiers with trusted API jika perlu
- batasi siapa bisa membuat SQL-like object
- hindari dynamic SQL dari user-controlled data

---

## 16. ORM Tidak Otomatis Aman

ORM aman jika pakai binding dengan benar.

Tetapi injection masih bisa terjadi pada:

```java
String jpql = "select u from User u where u.name = '" + name + "'";
```

Native query concatenation:

```java
String sql = "SELECT * FROM cases ORDER BY " + sort;
```

Raw query builder fragment:

```java
field("unsafe " + input)
```

Rule:

```text
ORM melindungi bound values, bukan arbitrary query string construction.
```

---

## 17. Stored Procedure Tidak Otomatis Aman

Procedure dengan parameter bisa aman:

```sql
CREATE PROCEDURE find_user(p_email TEXT)
AS ...
WHERE email = p_email;
```

Tapi dynamic SQL dalam procedure bisa vulnerable:

```sql
EXECUTE 'SELECT * FROM users WHERE email = ' || quote_literal(p_email);
```

Walau `quote_literal` membantu untuk value, dynamic SQL tetap rawan jika melibatkan identifier/operator/order/filter.

Gunakan:

- bind support di stored dynamic SQL
- allowlist identifier
- schema-qualify object
- avoid dynamic SQL jika tidak perlu

---

## 18. Search Path Attacks

Database dengan schema search path bisa diserang jika function/table resolution tidak aman.

Contoh:

```sql
SELECT do_sensitive_thing();
```

Jika attacker bisa membuat function dengan nama sama di schema lebih awal dalam search_path, function yang salah bisa dipanggil.

Mitigasi:

- set safe `search_path`
- schema-qualify object di SECURITY DEFINER functions
- revoke CREATE on public schema
- avoid untrusted schemas
- review security-definer code

Ini advanced, tetapi penting untuk high-security database code.

---

## 19. Row-Level Security

Row-Level Security (RLS) membuat database memfilter row berdasarkan policy.

PostgreSQL-style example:

```sql
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cases
ON cases
USING (
    tenant_id = current_setting('app.tenant_id')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
);
```

App sets context:

```sql
SELECT set_config('app.tenant_id', :tenant_id, true);
```

`USING` membatasi row yang terlihat.

`WITH CHECK` membatasi row yang boleh diinsert/update.

RLS berguna untuk defense-in-depth, terutama shared-schema multi-tenancy.

---

## 20. App Tenant Filter vs RLS

App-level filter:

```sql
WHERE tenant_id = :tenant_id
```

Pros:

- explicit
- portable
- mudah di-debug
- query planner jelas

Cons:

- developer bisa lupa
- raw SQL bisa bypass
- reporting user bisa salah query

RLS:

- enforced by database
- melindungi dari missing tenant filter
- berlaku untuk semua query role tertentu
- vendor-specific
- hidden
- butuh context discipline

Best practice untuk high-risk tenant systems:

```text
Gunakan explicit tenant filter untuk clarity + RLS untuk defense-in-depth.
```

---

## 21. RLS dan Connection Pool

Connection pool memakai ulang connection.

Jika tenant context diset di session dan tidak reset, tenant leakage bisa terjadi.

Gunakan transaction-local setting jika tersedia:

```sql
SELECT set_config('app.tenant_id', :tenant_id, true);
```

Requirements:

- set context di awal transaction/request
- context transaction-local
- reset/clear saat selesai
- test leakage
- hati-hati async/reactive
- jangan return dirty connection ke pool

RLS tanpa connection discipline bisa lebih berbahaya daripada tidak memakai RLS.

---

## 22. RLS Performance

Policy menambah predicate.

Jika policy:

```sql
tenant_id = current_setting('app.tenant_id')::uuid
```

Index harus mendukung tenant filter:

```sql
CREATE INDEX idx_cases_tenant_status
ON cases (tenant_id, status);
```

Test plan sebagai runtime role dengan RLS aktif.

Jangan test hanya sebagai superuser/owner karena bisa bypass policy.

---

## 23. Fine-Grained RLS

Policy bisa lebih kompleks:

```sql
USING (
    tenant_id = current_setting('app.tenant_id')::uuid
    AND (
        assigned_officer_id = current_setting('app.user_id')::uuid
        OR EXISTS (
            SELECT 1
            FROM user_case_permissions p
            WHERE p.case_id = cases.id
              AND p.user_id = current_setting('app.user_id')::uuid
        )
    )
)
```

Risiko:

- performance
- hidden denial
- recursive policy
- hard-to-test rules
- coupling to app context
- complex authorization in SQL

Sering lebih baik:

- RLS untuk coarse tenant boundary
- Java untuk workflow-specific authorization
- views/read models untuk support/reporting boundaries

---

## 24. Security Views

View bisa membatasi column/row.

```sql
CREATE VIEW support_case_view AS
SELECT
    id,
    tenant_id,
    case_number,
    status,
    opened_at
FROM cases;
```

Grant:

```sql
GRANT SELECT ON support_case_view TO support_role;
REVOKE ALL ON cases FROM support_role;
```

Gunakan view untuk:

- hide sensitive columns
- expose stable reporting contract
- mask values
- simplify row filtering

Tetapi view bukan security jika base table tetap bisa diakses.

---

## 25. Data Masking

Masking mengubah presentasi.

Example:

```text
national_id = 1234567890
masked = ******7890
```

Use cases:

- support UI
- reporting
- lower environments
- logs
- demos

Implementasi:

- app DTO
- database view
- database masking feature
- generated masked column
- tokenization

Masking bukan encryption. Jika user punya akses raw column, masking tidak membantu.

---

## 26. Redaction

Redaction menghapus/menyembunyikan data secara permanen atau semi-permanen.

Example:

```sql
UPDATE parties
SET
    national_id = NULL,
    national_id_redacted_at = now(),
    national_id_redaction_reason = :reason
WHERE id = :party_id;
```

Harus dipropagasi ke:

- read models
- search indexes
- materialized views
- exports
- caches
- downstream systems
- audit payload jika policy mengharuskan
- backups, sesuai legal/policy

Redaction adalah workflow, bukan hanya SQL update.

---

## 27. Encryption in Transit

Database connection harus memakai TLS jika melewati network.

Perhatikan:

- server certificate validation
- jangan disable validation
- CA management
- rotation
- mTLS jika perlu
- JDBC URL config
- cloud provider settings

Internal network bukan alasan untuk plaintext database credentials/data.

---

## 28. Encryption at Rest

Encryption at rest melindungi storage/backups dari offline compromise.

Options:

- disk encryption
- cloud volume encryption
- transparent data encryption
- tablespace encryption
- backup encryption

Tetapi tidak melindungi dari:

- compromised DB credential
- SQL injection
- app server compromise
- superuser SELECT
- over-broad reporting user

Perlu, tetapi bukan pengganti access control.

---

## 29. Application-Level Encryption

Encrypt sebelum data masuk DB.

Use when:

```text
DB/admin tidak boleh melihat plaintext
field sangat sensitif
crypto-shredding dibutuhkan
```

Pros:

- DB compromise tidak langsung melihat plaintext
- field-level protection
- key destruction bisa menghapus akses

Cons:

- query/filter/sort sulit
- index tidak usable untuk plaintext semantics
- key management berat
- rotation kompleks
- search hampir mustahil tanpa specialized design

Gunakan untuk field tertentu yang benar-benar perlu.

---

## 30. Key Management

Encryption hanya sekuat key management.

Rules:

- jangan simpan key bersama ciphertext di DB
- gunakan KMS/HSM/secret manager
- audit key access
- rotate keys
- envelope encryption
- separation of duties
- protect backup keys
- plan compromise response

Bad:

```text
encrypted_data column + encryption_key column in same table
```

---

## 31. Hashing vs Encryption

Hashing:

- one-way
- untuk password, token verification, fingerprint
- tidak reversible

Encryption:

- reversible with key
- untuk data yang perlu dibaca lagi

Password harus di-hash dengan slow salted password hash:

- Argon2
- bcrypt
- scrypt
- PBKDF2 jika required

Jangan hash password dengan simple SHA-256.

---

## 32. Secrets in Database

Hindari menyimpan secrets jika tidak perlu.

Secrets:

- API key
- OAuth refresh token
- private key
- service credential
- webhook secret

Jika harus:

- encrypt application-side/KMS
- restrict grants
- rotate
- audit access
- mask in UI
- separate table/schema
- store hash if only verification needed

Jangan taruh secrets di migration seed.

---

## 33. Logging Sensitive Data

SQL logs bisa leak:

- bind parameters
- PII
- tokens
- passwords
- national IDs
- emails
- document URLs
- JSON payload

Controls:

- disable sensitive bind logging in prod
- structured redaction
- log request ID not payload
- classify fields
- limit log access
- retention policy
- avoid full payload logging

Debug SQL parameter logs bisa menjadi data breach.

---

## 34. Error Messages

Internal database error jangan expose ke user.

Bad response:

```text
duplicate key value violates unique constraint uq_users_email_normalized
```

Good response:

```text
Email is already registered.
```

Internal log tetap menyimpan:

- constraint name
- SQL state
- request ID
- actor
- tenant
- stack trace if safe

Map errors:

- unique violation -> conflict/domain error
- FK violation -> invalid reference
- permission denied -> internal/security config issue
- RLS filtered row -> not found or forbidden depending policy
- lock timeout -> retry/conflict
- serialization failure -> retry

---

## 35. Backup Security

Backup berisi data production.

Protect:

- encryption
- access control
- restore audit
- retention
- secure transfer
- key management
- deletion lifecycle
- legal hold
- restore testing
- environment isolation

Banyak breach terjadi dari backup/export, bukan primary DB.

---

## 36. Lower Environment Data

Jangan restore production DB mentah ke laptop developer.

Risiko:

- PII leakage
- weak local controls
- unmanaged copies
- screenshots/logs
- malware
- regulatory violation

Gunakan:

- synthetic data
- anonymized data
- tokenized data
- masked subset
- controlled staging
- access approval

Performance testing butuh production-like distribution, bukan necessarily production-identifiable data.

---

## 37. Export Controls

CSV/report export sering menjadi jalur exfiltration.

Controls:

- authorization
- row/column filtering
- audit export event
- approval workflow
- rate limits
- expiration links
- encryption
- watermark
- DLP if available
- least privilege views

Export harus mengikuti security rule yang sama dengan UI/API.

---

## 38. Security Audit Events

Audit:

- login failure
- privilege changes
- grant/revoke
- data export
- sensitive record access
- redaction
- admin action
- failed authorization
- RLS policy change
- schema migration
- secret access

Correlate database audit and app audit with:

- request ID
- actor ID
- tenant ID
- source IP/service
- timestamp
- action

Audit table harus protected dari runtime modification.

---

## 39. Suspicious Access Detection

Signals:

- huge SELECT/export
- unusual tenant access
- after-hours access
- repeated permission denied
- support user reading many records
- SQL injection probe errors
- wildcard searches returning many rows
- mass update/delete
- new grants
- RLS disabled
- backup download

Security perlu monitoring, bukan hanya preventive controls.

---

## 40. Least Privilege Testing

Integration tests harus memakai runtime DB user.

Test cannot:

```sql
DROP TABLE cases;
ALTER TABLE cases ADD COLUMN x TEXT;
DELETE FROM audit_events;
SELECT national_id FROM party_sensitive_data;
UPDATE flyway_schema_history SET success = true;
```

Test can:

```sql
SELECT needed read models;
INSERT allowed business rows;
UPDATE allowed mutable fields;
EXECUTE allowed procedures;
```

Security config harus fail fast.

---

## 41. Multi-Tenant Data Isolation

Shared-schema multi-tenancy:

```sql
tenant_id UUID NOT NULL
```

Security requirements:

- every tenant-scoped table has `tenant_id`
- composite foreign keys include tenant_id
- unique constraints scoped by tenant
- indexes start with tenant_id for OLTP
- app filters tenant_id
- RLS optional defense-in-depth
- audit includes tenant_id
- read model includes tenant_id
- export/backup can be tenant-scoped

Composite FK:

```sql
FOREIGN KEY (tenant_id, case_id)
REFERENCES cases (tenant_id, id)
```

This prevents cross-tenant reference bugs.

---

## 42. Cross-Tenant Bug Example

Bad:

```sql
CREATE TABLE case_notes (
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    note_text TEXT NOT NULL
);
```

If app bug inserts:

```text
tenant_id = tenant A
case_id = case belonging to tenant B
```

FK passes if `cases.id` exists globally.

Better:

```sql
ALTER TABLE cases
ADD CONSTRAINT uq_cases_tenant_id UNIQUE (tenant_id, id);

ALTER TABLE case_notes
ADD CONSTRAINT fk_case_notes_cases
FOREIGN KEY (tenant_id, case_id)
REFERENCES cases (tenant_id, id);
```

Now database enforces tenant consistency.

---

## 43. Read Models and Security

Read models duplicate data.

If source has sensitive fields, derived table may leak them.

Checklist:

```text
Does read model include tenant_id?
Does it copy PII?
Does it copy confidential scores?
Does RLS apply?
Are grants limited?
Are redactions propagated?
Are deletes propagated?
Are search indexes updated?
Are materialized views refreshed after security change?
```

Read model is not “just cache”. It is data surface.

---

## 44. Column Separation for Sensitive Data

Separate sensitive columns.

```sql
CREATE TABLE parties (
    tenant_id UUID NOT NULL,
    id UUID NOT NULL,
    display_name TEXT NOT NULL,
    party_type TEXT NOT NULL,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE party_sensitive_data (
    tenant_id UUID NOT NULL,
    party_id UUID NOT NULL,
    national_id TEXT,
    date_of_birth DATE,
    encrypted_payload BYTEA,

    PRIMARY KEY (tenant_id, party_id),
    FOREIGN KEY (tenant_id, party_id)
        REFERENCES parties (tenant_id, id)
);
```

Benefits:

- limited grants
- smaller accidental exposure
- easier masking/redaction
- separate audit
- optional encryption
- less `SELECT *` risk

Trade-off:

- join complexity
- migration
- consistency

---

## 45. Avoid `SELECT *` for Security

`SELECT *` risks:

- new sensitive column exposed automatically
- unnecessary data transfer
- accidental logs
- JSON serialization leakage
- ORM entity loads hidden fields
- index-only scan harder

Use explicit columns/DTO projections.

Adding a new column should not silently change API response.

---

## 46. Data Minimization

Store and return only necessary data.

Questions:

```text
Do we need this field?
For how long?
Who can access it?
Can it be derived?
Can it be tokenized?
Can it be redacted?
Will it enter logs/read models/exports?
```

Less sensitive data means less breach impact.

---

## 47. Retention and Deletion

Security includes lifecycle.

Schema may need:

```sql
retention_until DATE
deleted_at TIMESTAMPTZ
redacted_at TIMESTAMPTZ
legal_hold BOOLEAN
```

Deletion must consider:

- source tables
- history/audit
- read models
- search indexes
- materialized views
- exports
- backups
- downstream systems

Deletion is distributed data management.

---

## 48. Stored Procedures as Security Boundary

Pattern:

```text
App role cannot update base tables directly.
App role can EXECUTE close_case procedure.
Procedure validates and updates.
```

Pros:

- narrow write API
- centralized permission
- controlled operation
- useful in DB-centric architectures

Cons:

- stored code complexity
- testing/deployment overhead
- vendor lock-in
- dynamic SQL risk
- versioning procedure contract

Useful for high-control systems, but not always necessary.

---

## 49. SECURITY DEFINER Checklist

If using security-definer function/procedure:

```text
[ ] schema-qualified object names
[ ] safe search_path
[ ] no unsafe dynamic SQL
[ ] minimal elevated privilege
[ ] input validation
[ ] stable error mapping
[ ] audit
[ ] limited EXECUTE grants
[ ] security review
```

Security definer is powerful and dangerous.

---

## 50. Application Authorization Still Required

Database controls do not replace domain authorization.

Java app must enforce:

- can user view this case?
- can user close it?
- can user approve it?
- can user assign officer?
- can support view masked/unmasked data?
- can export this report?

DB can enforce coarse boundaries. App still handles workflow, UX, and policy explanation.

Security is layered.

---

## 51. Defense in Depth

Layers:

```text
input validation
parameter binding
safe dynamic SQL allowlists
app authorization
tenant filter
RLS
least privilege role
constraints
audit
encryption
monitoring
backup protection
```

If one layer fails, another reduces blast radius.

Example:

```text
SQL injection exists, but app DB user has no DROP, RLS restricts tenant, and audit detects unusual query.
```

Defense in depth turns catastrophic breach into contained incident.

---

## 52. Security Review Checklist

```text
[ ] What sensitive data is read/written?
[ ] What DB role executes this query?
[ ] Are values bound?
[ ] Are dynamic identifiers allowlisted?
[ ] Is tenant_id enforced?
[ ] Are columns explicit?
[ ] Are grants least privilege?
[ ] Are new tables/views protected?
[ ] Are read models/search indexes reviewed?
[ ] Are secrets/PII logged?
[ ] Are errors mapped safely?
[ ] Are exports audited?
[ ] Are redaction/deletion paths covered?
[ ] Are backups/lower env considered?
[ ] Are migrations safe?
[ ] Are security events audited?
```

---

## 53. Common Security Anti-Patterns

```text
[ ] app connects as superuser/schema owner
[ ] runtime and migration use same credential
[ ] raw SQL string concatenation
[ ] unsafe ORDER BY from request
[ ] SELECT * in API
[ ] tenant filter missing in one query
[ ] FK missing tenant_id
[ ] read model without tenant_id
[ ] logs include bind values with PII
[ ] prod DB restored to dev without masking
[ ] backup unencrypted/broadly accessible
[ ] RLS context leaks in connection pool
[ ] audit table modifiable by app role
[ ] security definer function with unsafe search_path
[ ] sensitive fields copied to materialized view
[ ] export endpoint bypasses column security
```

---

## 54. Practical Exercises

### Exercise 1 — Fix Injection

Bad:

```java
String sql = "SELECT * FROM users WHERE email = '" + email + "'";
```

Good:

```java
PreparedStatement ps = connection.prepareStatement(
    "SELECT id, email FROM users WHERE email = ?"
);
ps.setString(1, email);
```

### Exercise 2 — Safe Sorting

Request supports:

```text
openedAt
priority
caseNumber
```

Map to allowlist:

```text
openedAt -> opened_at
priority -> priority_rank
caseNumber -> case_number
```

Reject unknown field.

### Exercise 3 — Tenant FK

Improve:

```sql
case_notes(case_id REFERENCES cases(id))
```

to:

```sql
FOREIGN KEY (tenant_id, case_id)
REFERENCES cases (tenant_id, id)
```

### Exercise 4 — Runtime Role

List privileges runtime user should not have:

```text
SUPERUSER
CREATE
ALTER
DROP
schema ownership
unrestricted audit delete
migration history update
```

### Exercise 5 — RLS Pool Context

Explain why tenant context must be transaction-local or reset after each use.

---

## 55. Koneksi ke Part Berikutnya

Part ini membahas SQL security and data protection.

Part berikutnya, `part-025`, akan membahas SQL dari Java secara langsung:

- JDBC
- DataSource
- HikariCP
- prepared statements
- resource safety
- transaction boundaries
- fetch size
- batch operations
- generated keys
- exception mapping
- time/type mapping
- connection pool behavior

Security memberi batas aman; Java database access memberi cara menjalankan query dengan benar di aplikasi.

---

## 56. Ringkasan Bagian Ini

Hal penting dari part 024:

1. Database security lebih luas dari SQL injection.
2. Least privilege mengurangi blast radius.
3. Runtime user dan migration user harus dipisah.
4. Roles/grants adalah bagian dari schema dan harus versioned.
5. Data classification menentukan access, masking, encryption, retention, and logging.
6. SQL injection dicegah dengan parameter binding, bukan manual escaping.
7. Dynamic identifiers harus allowlisted.
8. ORM/query builder tetap bisa vulnerable jika raw/dynamic query disalahgunakan.
9. Stored procedures can still have injection if dynamic SQL unsafe.
10. RLS memberi defense-in-depth untuk row filtering.
11. RLS dengan connection pool membutuhkan context discipline.
12. Security views and column separation reduce exposure.
13. Masking, redaction, hashing, and encryption solve different problems.
14. Encryption at rest tidak melindungi dari compromised DB credential.
15. Application-level encryption butuh key management serius dan membatasi query.
16. Logs/backups/exports are data leakage surfaces.
17. Composite tenant foreign keys prevent cross-tenant reference bugs.
18. Read models/search indexes/materialized views must be included in security review.
19. Security events should be audited and monitored.
20. Defense in depth membuat satu bug tidak otomatis menjadi breach besar.

Kalimat inti:

> SQL security yang matang menggabungkan safe query construction, least privilege, tenant isolation, data minimization, audit, encryption, and operational controls sehingga data tetap terlindungi bahkan ketika sebagian sistem gagal.

---

## 57. Referensi

1. OWASP — SQL Injection Prevention Cheat Sheet.  
   https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

2. OWASP — Query Parameterization Cheat Sheet.  
   https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html

3. OWASP — Password Storage Cheat Sheet.  
   https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

4. PostgreSQL Documentation — Database Roles.  
   https://www.postgresql.org/docs/current/user-manag.html

5. PostgreSQL Documentation — Privileges.  
   https://www.postgresql.org/docs/current/ddl-priv.html

6. PostgreSQL Documentation — Row Security Policies.  
   https://www.postgresql.org/docs/current/ddl-rowsecurity.html

7. PostgreSQL Documentation — Client Authentication.  
   https://www.postgresql.org/docs/current/client-authentication.html

8. MySQL 8.4 Reference Manual — Access Control and Account Management.  
   https://dev.mysql.com/doc/refman/8.4/en/access-control.html

9. SQL Server Documentation — Security Center.  
   https://learn.microsoft.com/en-us/sql/relational-databases/security/security-center-for-sql-server-database-engine-and-azure-sql-database

10. Oracle Database Security Guide.  
    https://docs.oracle.com/en/database/oracle/oracle-database/23/dbseg/

11. Spring Security Documentation.  
    https://docs.spring.io/spring-security/reference/

12. JDBC PreparedStatement Documentation.  
    https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/PreparedStatement.html

---

## 58. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`
- `learn-sql-mastery-for-java-engineers-part-005.md`
- `learn-sql-mastery-for-java-engineers-part-006.md`
- `learn-sql-mastery-for-java-engineers-part-007.md`
- `learn-sql-mastery-for-java-engineers-part-008.md`
- `learn-sql-mastery-for-java-engineers-part-009.md`
- `learn-sql-mastery-for-java-engineers-part-010.md`
- `learn-sql-mastery-for-java-engineers-part-011.md`
- `learn-sql-mastery-for-java-engineers-part-012.md`
- `learn-sql-mastery-for-java-engineers-part-013.md`
- `learn-sql-mastery-for-java-engineers-part-014.md`
- `learn-sql-mastery-for-java-engineers-part-015.md`
- `learn-sql-mastery-for-java-engineers-part-016.md`
- `learn-sql-mastery-for-java-engineers-part-017.md`
- `learn-sql-mastery-for-java-engineers-part-018.md`
- `learn-sql-mastery-for-java-engineers-part-019.md`
- `learn-sql-mastery-for-java-engineers-part-020.md`
- `learn-sql-mastery-for-java-engineers-part-021.md`
- `learn-sql-mastery-for-java-engineers-part-022.md`
- `learn-sql-mastery-for-java-engineers-part-023.md`
- `learn-sql-mastery-for-java-engineers-part-024.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-025.md` — SQL from Java: JDBC, Connection Pools, Transactions, and Resource Safety

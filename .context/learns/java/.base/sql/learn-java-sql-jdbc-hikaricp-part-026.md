# learn-java-sql-jdbc-hikaricp-part-026.md

# Part 026 — Security and Integrity at JDBC Boundary

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Bagian: `026 / 029`  
> Topik: `Java SQL Package, JDBC, and HikariCP`  
> Fokus: security, integrity, least privilege, SQL injection boundary, TLS, credentials, safe logging, auditability, dan multi-tenant isolation di lapisan JDBC.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita sudah membahas:

1. bagaimana JDBC bekerja sebagai boundary antara Java process dan database session;
2. bagaimana `Connection`, `Statement`, `PreparedStatement`, `ResultSet`, transaction, batch, metadata, LOB, HikariCP, timeout, observability, dan failure recovery bekerja;
3. bagaimana connection pool bukan sekadar optimization, tetapi boundary untuk concurrency, backpressure, dan operational safety.

Part ini membahas satu hal yang sering direduksi terlalu sederhana:

> “Pakai `PreparedStatement`, maka JDBC security selesai.”

Itu **salah secara operational**.

`PreparedStatement` memang salah satu pertahanan paling penting terhadap SQL injection, tetapi security di JDBC boundary jauh lebih luas:

- query structure vs parameter value;
- dynamic SQL identifiers;
- least privilege database user;
- schema ownership;
- TLS dan certificate verification;
- credential storage dan rotation;
- logging bind values secara aman;
- database auditability;
- row-level/tenant-level isolation;
- transaction integrity;
- application-level authorization yang tidak boleh hanya bergantung ke UI/API layer;
- safe failure behavior saat authorization, timeout, dan retry terjadi.

Dalam sistem enterprise/regulatory, JDBC boundary adalah titik di mana **intent aplikasi berubah menjadi mutation data permanen**. Karena itu security di lapisan ini bukan hanya tentang mencegah hacker, tetapi juga memastikan:

1. data tidak berubah tanpa otorisasi;
2. perubahan bisa diaudit;
3. error tidak membocorkan informasi sensitif;
4. log tidak menjadi data breach kedua;
5. service yang compromise tidak otomatis punya akses penuh ke seluruh database;
6. pool dan retry tidak memperbesar blast radius.

---

## 1. Mental Model: JDBC Boundary adalah Policy Enforcement Boundary Terakhir sebelum Database

Bayangkan request masuk ke aplikasi:

```text
HTTP / message / scheduler job
        |
        v
Controller / handler
        |
        v
Service / use case
        |
        v
Authorization / validation / workflow rule
        |
        v
Repository / DAO / SQL gateway
        |
        v
JDBC driver
        |
        v
Database session
        |
        v
Table / index / constraint / trigger / audit / storage
```

Banyak engineer hanya mengamankan bagian atas:

- endpoint pakai auth;
- DTO divalidasi;
- UI sembunyikan tombol;
- service cek role.

Itu perlu, tapi belum cukup.

Alasannya:

1. Tidak semua mutation berasal dari HTTP request.
   - scheduler;
   - batch job;
   - message consumer;
   - admin tool;
   - migration script;
   - data correction utility.

2. Service layer bisa punya bug.

3. Aplikasi bisa compromise.

4. Internal endpoint bisa disalahgunakan.

5. SQL query bisa dibangun secara dynamic.

6. Log/debug utility bisa membocorkan bind value.

7. Database user yang terlalu powerful bisa mengubah apa saja.

Karena itu JDBC boundary perlu dianggap sebagai **last application-controlled guardrail** sebelum database mengeksekusi operasi.

Prinsipnya:

```text
Security must not depend on one layer only.
JDBC boundary should enforce safe query construction, minimal privilege,
safe credentials, safe transport, safe logging, and auditable mutation.
```

---

## 2. Threat Model di JDBC Boundary

Sebelum bicara solusi, kita perlu tahu ancaman apa yang relevan.

### 2.1 SQL Injection

SQL injection terjadi ketika data yang seharusnya hanya menjadi nilai malah ikut menjadi bagian dari struktur SQL.

Contoh buruk:

```java
String sql = "SELECT * FROM users WHERE username = '" + username + "'";
Statement st = connection.createStatement();
ResultSet rs = st.executeQuery(sql);
```

Jika `username` berisi:

```sql
' OR '1' = '1
```

maka query berubah makna.

Masalah utamanya bukan karakter `'` saja. Masalah utamanya adalah **query structure dan untrusted data bercampur dalam satu string**.

### 2.2 Dynamic SQL Identifier Injection

Banyak developer tahu value harus pakai parameter, tetapi lupa bahwa `?` tidak bisa dipakai untuk identifier seperti:

- table name;
- column name;
- sort direction;
- schema name;
- index hint;
- SQL fragment;
- operator;
- function name.

Contoh salah:

```java
String sql = "SELECT * FROM case_file ORDER BY " + sortBy + " " + direction;
```

`PreparedStatement` tidak membantu jika struktur query tetap dibentuk dari input liar.

### 2.3 Excessive Database Privilege

Aplikasi sering memakai satu DB user yang bisa:

- create/drop table;
- alter schema;
- update semua table;
- delete semua data;
- read PII tanpa batas;
- execute procedure admin;
- akses schema lain.

Jika service compromise, seluruh database compromise.

Security yang baik mengasumsikan:

```text
Application compromise is possible.
Therefore DB privilege must limit blast radius.
```

### 2.4 Credential Leakage

Credential JDBC bisa bocor dari:

- `application.properties`;
- environment variable dump;
- Kubernetes Secret yang terlalu mudah dibaca;
- CI/CD logs;
- heap dump;
- thread dump;
- Hikari config log;
- exception message;
- connection URL yang mengandung password;
- support ticket;
- screenshot;
- APM span attribute.

### 2.5 Plaintext or Weakly Verified Network Transport

Jika koneksi DB tidak terenkripsi atau certificate tidak diverifikasi benar:

- credential bisa disadap saat handshake;
- query dan result bisa bocor;
- MITM bisa terjadi;
- compliance failure bisa muncul;
- internal network dianggap terlalu dipercaya.

Internal network bukan security boundary yang cukup.

### 2.6 Unsafe SQL Logging

Debugging SQL sering menghasilkan log seperti:

```text
SELECT * FROM person WHERE nric = 'S1234567A' AND dob = '1980-01-01'
```

Log ini mungkin disimpan lebih lama dari data source utama, dikirim ke vendor monitoring, bisa diakses lebih banyak orang, dan tidak selalu terenkripsi dengan lifecycle yang sama.

Log bisa menjadi **secondary data store** yang tidak sengaja.

### 2.7 Authorization Bypass via Repository Method

Contoh:

```java
CaseFile findById(long id)
```

Jika method ini tidak aware terhadap agency/tenant/role/scope, caller yang salah bisa mengambil case milik entitas lain.

Security tidak cukup dengan:

```text
Controller checks role ADMIN
```

Untuk data sensitif, query itu sendiri sering harus membawa scope:

```sql
WHERE id = ? AND agency_id = ?
```

### 2.8 Integrity Failure karena Retry, Timeout, dan Transaction Ambiguity

Security bukan hanya confidentiality. Integrity juga security.

Contoh masalah:

1. request timeout di aplikasi;
2. query sebenarnya sukses commit di DB;
3. aplikasi menganggap gagal;
4. retry menjalankan insert kedua;
5. duplicate business action terjadi.

Tanpa idempotency key, unique constraint, dan transaction boundary yang jelas, retry bisa merusak integritas data.

### 2.9 Data Exfiltration melalui Overbroad Query

Repository method yang terlalu luas:

```sql
SELECT * FROM audit_trail
```

bisa menyebabkan:

- PII bocor ke memory;
- log/debug accidentally dump object;
- API response accidentally expose field;
- memory dump berisi data sensitif;
- report menampilkan data lintas tenant.

Prinsipnya:

```text
Do not fetch sensitive data unless the use case genuinely needs it.
```

---

## 3. PreparedStatement: Pertahanan Penting, tetapi Bukan Silver Bullet

### 3.1 Apa yang Diselesaikan PreparedStatement

`PreparedStatement` memisahkan:

- SQL structure;
- parameter values.

Contoh benar:

```java
String sql = """
    SELECT id, username, status
    FROM app_user
    WHERE username = ?
    """;

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setString(1, username);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // map row
        }
    }
}
```

Dalam model ini, `username` tidak menjadi bagian dari SQL syntax. Ia dikirim sebagai bind value.

Efeknya:

1. data tidak diinterpretasikan sebagai SQL code;
2. escaping manual tidak diperlukan untuk value;
3. driver/database bisa memakai bind protocol;
4. plan reuse mungkin terjadi tergantung driver/database;
5. audit dan observability bisa memisahkan statement shape dari value.

### 3.2 Yang Tidak Bisa Diselesaikan PreparedStatement

`PreparedStatement` tidak bisa mem-parameterisasi semua bagian query.

Tidak valid:

```java
PreparedStatement ps = connection.prepareStatement(
    "SELECT ? FROM case_file WHERE id = ?"
);
ps.setString(1, "status");
```

Itu tidak berarti `status` menjadi nama kolom. Itu menjadi literal value.

Tidak valid untuk sort column:

```java
String sql = "SELECT * FROM case_file ORDER BY ?";
```

Database akan memperlakukan `?` sebagai value, bukan identifier.

Bagian yang biasanya tidak bisa dibind:

```text
table name
column name
schema name
sort direction
operator
SQL keyword
function name
index hint
JOIN fragment
WHERE clause fragment
LIMIT/OFFSET pada beberapa driver/database lama
```

Maka dynamic SQL tetap perlu desain khusus.

---

## 4. Dynamic SQL yang Aman

Dynamic SQL tidak selalu buruk. Banyak aplikasi butuh:

- filter optional;
- sorting;
- pagination;
- report builder;
- search screen;
- tenant-specific schema;
- feature-specific projection.

Yang berbahaya adalah dynamic SQL tanpa constraint.

### 4.1 Prinsip Safe Dynamic SQL

```text
Only values are free-form.
Query structure must come from code-owned allow-list.
```

Artinya:

- user boleh memilih `sortBy = "createdDate"`;
- aplikasi memetakan ke kolom yang dikenal;
- user tidak boleh langsung menentukan `ORDER BY <raw input>`.

### 4.2 Safe Sorting Example

Buruk:

```java
String sql = """
    SELECT id, case_no, status, created_at
    FROM case_file
    ORDER BY %s %s
    """.formatted(sortBy, direction);
```

Aman:

```java
enum CaseSortField {
    CASE_NO("case_no"),
    STATUS("status"),
    CREATED_AT("created_at");

    private final String column;

    CaseSortField(String column) {
        this.column = column;
    }

    String column() {
        return column;
    }
}

enum SortDirection {
    ASC,
    DESC
}

String sql = """
    SELECT id, case_no, status, created_at
    FROM case_file
    ORDER BY %s %s
    """.formatted(sortField.column(), direction.name());
```

Di sini string SQL memang dynamic, tetapi semua fragment berasal dari enum milik codebase, bukan raw user input.

### 4.3 Safe Optional Filters

Buruk:

```java
String where = "WHERE 1=1";

if (status != null) {
    where += " AND status = '" + status + "'";
}

if (keyword != null) {
    where += " AND title LIKE '%" + keyword + "%'";
}
```

Aman:

```java
StringBuilder sql = new StringBuilder("""
    SELECT id, case_no, status, title
    FROM case_file
    WHERE agency_id = ?
    """);

List<SqlBinder> binders = new ArrayList<>();
binders.add((ps, i) -> ps.setLong(i, agencyId));

if (status != null) {
    sql.append(" AND status = ?");
    binders.add((ps, i) -> ps.setString(i, status.name()));
}

if (keyword != null && !keyword.isBlank()) {
    sql.append(" AND LOWER(title) LIKE ?");
    binders.add((ps, i) -> ps.setString(i, "%" + keyword.toLowerCase(Locale.ROOT) + "%"));
}

sql.append(" ORDER BY created_at DESC");

try (PreparedStatement ps = connection.prepareStatement(sql.toString())) {
    for (int i = 0; i < binders.size(); i++) {
        binders.get(i).bind(ps, i + 1);
    }

    try (ResultSet rs = ps.executeQuery()) {
        // map
    }
}

@FunctionalInterface
interface SqlBinder {
    void bind(PreparedStatement ps, int index) throws SQLException;
}
```

Key point:

- SQL fragments untuk filter dikontrol oleh code;
- values tetap pakai bind parameter;
- tenant/agency scope selalu masuk base predicate.

### 4.4 Safe Dynamic Table Selection

Kadang report butuh memilih table berbeda.

Jangan:

```java
String sql = "SELECT COUNT(*) FROM " + tableName;
```

Gunakan mapping:

```java
enum ReportSource {
    CASE_FILE("case_file"),
    APPEAL("appeal"),
    AUDIT_TRAIL("audit_trail");

    private final String table;

    ReportSource(String table) {
        this.table = table;
    }

    String table() {
        return table;
    }
}

String sql = "SELECT COUNT(*) FROM " + source.table();
```

Tetap perhatikan privilege: aplikasi tidak seharusnya bisa query table yang tidak diperlukan.

---

## 5. Escaping Manual adalah Pertahanan Lemah

Banyak engineer mencoba:

```java
String safe = input.replace("'", "''");
```

Ini rapuh karena:

1. SQL dialect berbeda;
2. encoding/collation bisa punya edge case;
3. identifier quoting beda dengan literal quoting;
4. injection tidak selalu lewat quote;
5. dynamic fragments tetap tidak aman;
6. escaping sering lupa diterapkan di satu path;
7. stored procedure dynamic SQL bisa tetap rentan;
8. LIKE pattern punya wildcard `%` dan `_` yang maknanya berbeda.

Rule praktis:

```text
For values: use bind parameters.
For identifiers/fragments: use code-owned allow-list.
For LIKE wildcard semantics: escape wildcard intentionally if user input is literal search.
```

### 5.1 LIKE Search: Literal vs Pattern

Jika user mencari literal `%`, jangan otomatis memperlakukannya sebagai wildcard.

Contoh helper:

```java
static String escapeLikeLiteral(String input) {
    return input
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_");
}
```

Query:

```sql
WHERE LOWER(title) LIKE ? ESCAPE '\'
```

Bind:

```java
ps.setString(1, "%" + escapeLikeLiteral(keyword.toLowerCase(Locale.ROOT)) + "%");
```

Catatan: escape syntax dapat berbeda antar database. Test di database nyata.

---

## 6. SQL Injection Tidak Hanya SELECT

SQL injection sering dicontohkan dengan login bypass. Di sistem nyata, injection bisa terjadi di:

### 6.1 ORDER BY

```sql
ORDER BY <raw input>
```

### 6.2 LIMIT/OFFSET

```sql
LIMIT <raw input>
```

Beberapa database/driver mengizinkan bind untuk limit, beberapa punya caveat. Jika tidak yakin, validasi numeric range dengan tipe integer, bukan string.

### 6.3 IN Clause

Buruk:

```java
String ids = request.ids().stream()
    .map(String::valueOf)
    .collect(Collectors.joining(","));

String sql = "SELECT * FROM case_file WHERE id IN (" + ids + ")";
```

Lebih aman:

```java
List<Long> ids = request.ids();
if (ids.isEmpty()) {
    return List.of();
}

String placeholders = ids.stream()
    .map(x -> "?")
    .collect(Collectors.joining(", "));

String sql = "SELECT * FROM case_file WHERE id IN (" + placeholders + ")";

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    for (int i = 0; i < ids.size(); i++) {
        ps.setLong(i + 1, ids.get(i));
    }
}
```

Untuk list besar, pertimbangkan:

- temporary table;
- array parameter jika database mendukung;
- batch join table;
- table-valued parameter pada database tertentu.

### 6.4 JSON Path / XML Path / Full-text Query

SQL modern sering punya operator JSON, XML, full-text, dan expression language.

Contoh risiko:

```sql
json_value(payload, '<raw path>')
```

atau:

```sql
to_tsquery('<raw query>')
```

Walaupun bukan SQL syntax injection klasik, user input bisa menjadi bagian dari sub-language yang dieksekusi database.

Prinsip:

```text
Every embedded language inside SQL has its own injection model.
```

### 6.5 Stored Procedure Dynamic SQL

Java code bisa aman, tetapi procedure di DB membangun SQL string dari parameter.

Java:

```java
CallableStatement cs = connection.prepareCall("{call search_case(?)}");
cs.setString(1, userInput);
```

Stored procedure:

```sql
EXECUTE IMMEDIATE 'SELECT * FROM case_file WHERE title = ''' || input || '''';
```

Masih rentan.

Jadi boundary security melibatkan:

- Java SQL construction;
- stored procedure implementation;
- database privilege;
- audit;
- review.

---

## 7. Least Privilege Database User

### 7.1 Anti-pattern: App User sebagai Schema Owner

Buruk:

```text
app_user has:
- CREATE TABLE
- ALTER TABLE
- DROP TABLE
- CREATE USER
- GRANT ANY PRIVILEGE
- SELECT ANY TABLE
- UPDATE ANY TABLE
- DELETE ANY TABLE
```

Ini memudahkan development, tetapi buruk untuk production.

Jika aplikasi compromise, attacker bisa:

- drop schema;
- dump semua data;
- disable audit;
- modify reference table;
- create backdoor object;
- escalate privilege.

### 7.2 Pisahkan Owner, Migrator, Runtime User

Model yang lebih aman:

```text
schema_owner
  owns tables, indexes, procedures
  not used by application runtime

migration_user
  can alter schema during deployment window
  used by Flyway/Liquibase/DBA pipeline
  not used by application runtime

app_runtime_user
  only has required DML privileges
  cannot alter schema
  cannot grant privilege
  cannot access unrelated schema

reporting_user
  read-only
  perhaps restricted to views/materialized views

batch_user
  specific privileges for batch workload
  may have different pool and rate limit
```

### 7.3 Grant by Use Case, Not Convenience

Contoh:

```text
case-service runtime user:
- SELECT, INSERT, UPDATE on CASE_FILE
- INSERT on CASE_AUDIT
- SELECT on CASE_REFERENCE_VIEW
- no DELETE on CASE_FILE unless business requires
- no SELECT on USER_CREDENTIAL
- no DDL
```

Lebih bagus lagi:

- aplikasi menulis lewat stored procedure dengan controlled operation;
- aplikasi membaca lewat views yang sudah menyaring kolom sensitif;
- write privilege dipisah per module/service.

### 7.4 Deny Dangerous Privileges by Default

Runtime app user sebaiknya tidak punya:

```text
DROP
ALTER
TRUNCATE
CREATE USER
GRANT
SELECT ANY TABLE
UPDATE ANY TABLE
DELETE ANY TABLE
EXECUTE ANY PROCEDURE
DBA/admin role
access to system catalog beyond required metadata
```

### 7.5 Separate Credentials per Service

Dalam microservices, jangan semua service memakai DB user yang sama.

Buruk:

```text
all services use APP_DB_USER
```

Lebih baik:

```text
case_service_user
appeal_service_user
report_service_user
audit_writer_user
scheduler_user
```

Keuntungan:

1. blast radius lebih kecil;
2. audit database lebih jelas;
3. privilege review lebih mudah;
4. credential rotation bisa per service;
5. compromised service tidak otomatis membaca semua domain.

---

## 8. Views dan Stored Procedures sebagai Security Boundary

### 8.1 Security View

Daripada memberi akses table langsung:

```sql
SELECT * FROM citizen_profile
```

buat view:

```sql
CREATE VIEW case_profile_summary AS
SELECT
    id,
    masked_identifier,
    name,
    status
FROM citizen_profile;
```

Runtime user hanya diberi:

```sql
GRANT SELECT ON case_profile_summary TO case_service_user;
```

Keuntungan:

- kolom sensitif tidak pernah tersedia bagi service;
- accidental `SELECT *` lebih aman;
- audit dan review lebih mudah.

### 8.2 Stored Procedure untuk Controlled Mutation

Untuk mutation yang sangat sensitif, stored procedure bisa menjadi boundary:

```text
app cannot UPDATE table directly
app can only EXECUTE transition_case_status(...)
```

Keuntungan:

- invariant enforced dekat data;
- mutation path lebih terkontrol;
- audit bisa distandardisasi;
- privilege lebih kecil.

Risikonya:

- business logic tersembunyi di DB;
- versioning lebih rumit;
- testability bisa turun;
- coupling Java-DB meningkat;
- stored procedure sendiri bisa punya injection bug.

Rule praktis:

```text
Use stored procedures as security boundary only when lifecycle, testing,
versioning, audit, and ownership are clear.
```

---

## 9. Tenant, Agency, and Scope Isolation

Dalam sistem multi-tenant atau multi-agency, security bug paling umum adalah query tanpa scope.

### 9.1 Dangerous Repository Method

```java
Optional<CaseFile> findById(long id);
```

Jika `id` global, caller bisa mencoba ID lain.

Lebih aman:

```java
Optional<CaseFile> findByIdAndAgency(long id, long agencyId);
```

SQL:

```sql
SELECT id, case_no, status, agency_id
FROM case_file
WHERE id = ?
  AND agency_id = ?
```

### 9.2 Scope Must Be Structural

Jangan hanya:

```java
CaseFile c = repository.findById(id);
if (!c.agencyId().equals(currentAgencyId)) {
    throw new ForbiddenException();
}
```

Itu membaca data dulu baru menolak. Untuk data sensitif, query harus scoped sejak awal.

Lebih baik:

```sql
WHERE id = ? AND agency_id = ?
```

Manfaat:

- mengurangi data exposure;
- mengurangi timing side-channel;
- membuat authorization menjadi bagian dari access path;
- lebih mudah diaudit.

### 9.3 Tenant Context Jangan Hanya ThreadLocal

Banyak framework memakai `ThreadLocal` tenant context.

Risiko:

- async boundary;
- virtual thread/carrier confusion jika context propagation salah;
- thread reuse;
- background job lupa set tenant;
- test tidak menangkap.

Lebih aman:

```java
record DataAccessScope(
    long userId,
    long agencyId,
    Set<String> permissions,
    String correlationId
) {}
```

Lalu repository method menerima scope eksplisit untuk operasi sensitif:

```java
Optional<CaseFile> findVisibleCase(DataAccessScope scope, long caseId);
```

Tidak semua method harus begini, tapi untuk boundary sensitif, explicit scope mengurangi bug.

---

## 10. Row-Level Security dan Database-Enforced Policy

Beberapa database mendukung row-level security/policy.

Idenya:

```text
Even if query forgets WHERE tenant_id = ?, database policy prevents cross-tenant read/write.
```

Manfaat:

1. defense in depth;
2. protection terhadap bug query;
3. policy terpusat;
4. cocok untuk multi-tenant kuat.

Risiko:

1. lebih sulit didiagnosis;
2. performance plan bisa berubah;
3. policy context harus diset di session;
4. connection pool bisa membocorkan session variable jika tidak di-reset;
5. test harus real database.

Jika memakai session variable untuk tenant:

```sql
SET app.current_tenant = '...'
```

maka connection pool harus memastikan state tersebut:

- diset saat borrow;
- dipakai hanya dalam scope operasi;
- di-clear/reset sebelum return;
- tidak bocor ke request lain.

Ini mengikat langsung dengan Part 003 dan Part 023: `Connection` membawa session state.

---

## 11. Credential Storage

### 11.1 Jangan Hardcode Credential

Buruk:

```java
String url = "jdbc:postgresql://db/prod";
String username = "app";
String password = "P@ssw0rd";
```

Lebih buruk lagi:

```text
jdbc:postgresql://db/prod?user=app&password=P@ssw0rd
```

Masalah:

- masuk git history;
- masuk logs;
- masuk stack trace;
- masuk process args;
- masuk thread dump/config dump;
- susah rotate.

### 11.2 Source Credential yang Lebih Baik

Umumnya gunakan salah satu:

- cloud secret manager;
- Kubernetes Secret dengan RBAC ketat;
- HashiCorp Vault;
- AWS SSM Parameter Store / Secrets Manager;
- Azure Key Vault;
- GCP Secret Manager;
- platform-managed identity / IAM authentication jika database mendukung.

Prinsip:

```text
Credential should be injected at deployment/runtime,
not compiled into artifact.
```

### 11.3 Jangan Log HikariConfig Mentah

HikariCP memiliki konfigurasi username/password/data source properties. Jangan dump seluruh config tanpa masking.

Buat masker eksplisit:

```java
static String maskSecret(String value) {
    if (value == null || value.isBlank()) {
        return "<empty>";
    }
    return "****";
}
```

Jika perlu log config:

```text
poolName=case-service-pool
jdbcUrl=jdbc:postgresql://db:5432/case_prod
username=case_service_user
password=****
maximumPoolSize=12
```

Jangan log:

```text
password=plain-text
sslpassword=plain-text
trustStorePassword=plain-text
```

### 11.4 Environment Variable Caveat

Environment variable mudah digunakan tetapi bukan selalu paling aman:

- bisa muncul di diagnostic dump;
- bisa dibaca process lain tergantung OS/container config;
- sering masuk support bundle;
- rotation butuh restart kecuali ada agent.

Bukan berarti tidak boleh, tetapi pahami risikonya.

---

## 12. Credential Rotation dengan JDBC Pool

Credential rotation terlihat sederhana:

```text
change password in secret manager
```

Tapi dengan connection pool, ada koneksi lama yang masih hidup.

### 12.1 Masalah Runtime

Pool berisi physical connections yang dibuat memakai credential lama.

Jika password diganti:

- existing connections mungkin tetap valid sampai disconnect;
- new connections dengan old password gagal;
- new secret belum di-load aplikasi;
- pool bisa masuk kondisi mixed;
- failover/reconnect tiba-tiba gagal.

### 12.2 Pattern Rotation yang Aman

Idealnya:

1. database mendukung overlap credential atau dual user;
2. deploy app dengan credential baru;
3. biarkan pool lama retire;
4. revoke credential lama setelah semua instance pindah;
5. monitor connection creation failure;
6. test rollback.

Jika tidak ada dual password, gunakan rolling restart terkontrol:

```text
1. update secret
2. restart instance satu per satu
3. wait readiness
4. verify new connections
5. continue rollout
```

### 12.3 HikariCP Implication

HikariCP tidak otomatis tahu secret eksternal berubah. Aplikasi harus:

- recreate `HikariDataSource`; atau
- restart pod/process; atau
- memakai custom secret refresh mechanism yang benar-benar menutup pool lama.

Jangan hanya mengubah field password di object config dan berharap existing pool berubah aman.

### 12.4 Rotation Checklist

```text
[ ] Apakah DB mendukung dual password / staged credential?
[ ] Apakah pool akan dibuat ulang?
[ ] Apakah existing physical connections akan ditutup bertahap?
[ ] Apakah maxLifetime membantu retire connection lama?
[ ] Apakah readiness check memakai credential baru?
[ ] Apakah error login dimonitor?
[ ] Apakah rollback credential jelas?
[ ] Apakah log tidak membocorkan credential baru?
```

---

## 13. TLS dan JDBC

### 13.1 Kenapa TLS Penting untuk Database Connection

JDBC traffic bisa berisi:

- username/password/token;
- SQL text;
- bind values;
- PII;
- document metadata;
- audit detail;
- business secrets;
- result set.

Jika network dianggap internal tapi shared, compromised, atau misconfigured, data bisa bocor.

### 13.2 JDBC API Tidak Menstandarkan TLS Config

`java.sql` menyediakan API koneksi, tetapi detail TLS biasanya driver-specific:

- PostgreSQL JDBC memakai parameter seperti `ssl`, `sslmode`, certificate config;
- MySQL Connector/J memakai `sslMode`, trust store, certificate verification config;
- Oracle JDBC memakai TCPS, wallet/JKS, dan properti network security;
- SQL Server JDBC punya parameter encryption/trust server certificate/host name verification.

Jadi security config harus membaca dokumentasi driver, bukan hanya API JDBC.

### 13.3 Encryption Without Verification Tidak Cukup

Ada perbedaan antara:

```text
encrypted channel
```

dan:

```text
encrypted channel + verified server identity
```

Jika hanya encrypt tetapi trust semua certificate, MITM masih mungkin.

Anti-pattern:

```text
trustServerCertificate=true
sslmode=require tanpa verify-full pada environment yang butuh identity verification
custom TrustManager that accepts everything
```

### 13.4 Desired TLS Properties

Untuk production sensitif:

```text
[ ] TLS enabled
[ ] server certificate verified
[ ] hostname verified where supported
[ ] truststore/wallet managed securely
[ ] weak protocols disabled
[ ] mutual TLS if required
[ ] certificate rotation tested
[ ] connection failure mode understood
[ ] no "trust all" in production
```

### 13.5 TLS and Pooling

TLS handshake terjadi saat physical connection dibuat. Pooling mengurangi handshake frequency, tetapi tidak menghilangkan kebutuhan:

- max lifetime;
- certificate rotation;
- keepalive;
- reconnect behavior;
- truststore update process.

Jika certificate diganti, existing pooled connections mungkin masih hidup. New connections bisa gagal jika truststore belum update.

---

## 14. Safe SQL Logging

### 14.1 Apa yang Perlu Dilihat saat Debugging

Engineer butuh:

- query shape;
- latency;
- row count;
- SQLState;
- database error code;
- pool wait time;
- transaction id/correlation id;
- request/module/action;
- perhaps parameter type/count.

Engineer tidak selalu butuh raw bind values.

### 14.2 Jangan Log Sensitive Bind Values

Buruk:

```text
Executing SQL: SELECT * FROM applicant WHERE nric='S1234567A' AND email='x@y.com'
```

Lebih aman:

```text
sql.operation=ApplicantRepository.findByIdentifier
sql.shapeHash=9f27ab10
sql.params=[identifier:MASKED,email:MASKED]
sql.durationMs=42
sql.rows=1
```

### 14.3 SQL Shape Hash

Daripada log seluruh SQL panjang, bisa hash normalized SQL:

```java
static String shapeHash(String sql) {
    try {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] digest = md.digest(sql.replaceAll("\\s+", " ").trim().getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(digest).substring(0, 12);
    } catch (NoSuchAlgorithmException e) {
        throw new IllegalStateException(e);
    }
}
```

Log:

```text
queryName=CaseRepository.findVisibleCase
shapeHash=1f5e0cb3d42a
durationMs=18
rows=1
```

SQL text bisa tetap disimpan di source code dan mapping dokumentasi internal.

### 14.4 Safe Debug Logging Policy

Gunakan policy:

```text
Production:
- do not log raw bind values by default
- mask sensitive fields
- sample slow query logs carefully
- use query name/shape hash
- include SQLState/vendorCode for diagnosis

Lower env:
- raw bind logging allowed only if test data is non-sensitive
- never copy production data to lower env without masking
```

### 14.5 PII Classification at Repository Boundary

Repository method bisa mendefinisikan classification:

```java
enum Sensitivity {
    PUBLIC,
    INTERNAL,
    CONFIDENTIAL,
    PII,
    SECRET
}
```

Parameter descriptor:

```java
record SqlParam(String name, Object value, Sensitivity sensitivity) {}
```

Logger:

```java
static String render(SqlParam param) {
    return switch (param.sensitivity()) {
        case PUBLIC, INTERNAL -> String.valueOf(param.value());
        case CONFIDENTIAL, PII, SECRET -> "<masked>";
    };
}
```

Ini bukan pengganti secure design, tetapi membantu menghindari accidental leak.

---

## 15. Exception Message Hygiene

### 15.1 Jangan Bocorkan Detail Database ke Client

Buruk:

```json
{
  "error": "ORA-00001: unique constraint (CASE_SCHEMA.UK_CASE_NRIC) violated"
}
```

Atau:

```json
{
  "error": "relation citizen_profile does not exist"
}
```

Masalah:

- schema/table/constraint name bocor;
- attacker belajar struktur DB;
- internal implementation detail keluar;
- PII bisa muncul dalam exception tertentu.

### 15.2 Error Translation

Di boundary aplikasi:

```java
catch (SQLIntegrityConstraintViolationException e) {
    throw new ConflictException("Resource already exists", e);
}
catch (SQLTimeoutException e) {
    throw new ServiceUnavailableException("Database operation timed out", e);
}
catch (SQLException e) {
    throw new DataAccessException("Database operation failed", e);
}
```

Client menerima pesan aman. Log internal menyimpan:

- correlation id;
- query name;
- SQLState;
- vendor code;
- sanitized message;
- stack trace jika policy mengizinkan.

### 15.3 Jangan Telan Exception Security-Relevant

Buruk:

```java
catch (SQLException e) {
    return Optional.empty();
}
```

Ini bisa menyembunyikan:

- permission denied;
- connection failure;
- timeout;
- data corruption;
- serialization failure.

`Optional.empty()` hanya untuk “data tidak ditemukan”, bukan semua error.

---

## 16. Integrity at JDBC Boundary

Security juga berarti menjaga data tetap benar.

### 16.1 Gunakan Database Constraint sebagai Defense-in-Depth

Aplikasi boleh validasi, tetapi database harus enforce invariant penting:

- primary key;
- unique key;
- foreign key;
- check constraint;
- not null;
- exclusion constraint jika tersedia;
- domain/reference constraint;
- optimistic locking version;
- idempotency key unique constraint.

Contoh:

```sql
ALTER TABLE case_transition_request
ADD CONSTRAINT uk_case_transition_idempotency
UNIQUE (case_id, idempotency_key);
```

Aplikasi:

```java
try {
    insertTransitionRequest(...);
} catch (SQLIntegrityConstraintViolationException e) {
    return loadExistingByIdempotencyKey(...);
}
```

### 16.2 Retry Must Be Idempotent

Retry tanpa idempotency bisa menjadi data corruption.

Buruk:

```text
insert payment
connection timeout
retry insert payment
payment duplicated
```

Lebih aman:

```text
insert payment with idempotency_key
if duplicate key, load previous result
```

### 16.3 Optimistic Locking di JDBC

Pattern:

```sql
UPDATE case_file
SET status = ?, version = version + 1
WHERE id = ?
  AND version = ?
```

Java:

```java
int updated = ps.executeUpdate();
if (updated == 0) {
    throw new OptimisticLockFailureException("Case was modified by another transaction");
}
```

Ini mencegah lost update tanpa selalu memakai lock berat.

### 16.4 State Transition Integrity

Untuk regulatory workflow:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED / REJECTED
```

Jangan hanya:

```sql
UPDATE case_file SET status = ? WHERE id = ?
```

Lebih aman:

```sql
UPDATE case_file
SET status = ?, version = version + 1
WHERE id = ?
  AND status = ?
  AND version = ?
```

Dengan begitu invalid transition dan race condition tertangkap sebagai `updated == 0`.

### 16.5 Audit Insert in Same Transaction

Mutation penting harus menyimpan audit dalam transaction yang sama:

```text
BEGIN
  update case status
  insert audit trail
COMMIT
```

Jika audit insert di luar transaction, bisa terjadi:

- data berubah tanpa audit;
- audit ada padahal data gagal berubah;
- sequence event tidak konsisten.

Untuk event publishing, gunakan outbox pattern:

```text
BEGIN
  update domain table
  insert audit trail
  insert outbox_event
COMMIT

async publisher reads outbox_event
```

Ini menjaga integrity antara DB mutation dan event emission.

---

## 17. Safe Use of Admin and Maintenance SQL

Aplikasi sering punya endpoint internal/admin:

- reprocess case;
- unlock record;
- rebuild search index;
- trigger report;
- correct data;
- replay event.

Risikonya lebih tinggi daripada user endpoint biasa.

### 17.1 Jangan Buat Generic SQL Executor

Anti-pattern:

```java
@PostMapping("/admin/sql")
String runSql(@RequestBody String sql) {
    return jdbcTemplate.queryForList(sql).toString();
}
```

Bahkan jika endpoint internal, ini sangat berbahaya.

### 17.2 Buat Operation-Specific Admin Command

Lebih aman:

```java
record ReopenCaseCommand(
    long caseId,
    String reason,
    String approvedBy
) {}
```

SQL tetap controlled:

```sql
UPDATE case_file
SET status = 'REOPENED'
WHERE id = ?
  AND status IN ('CLOSED', 'REJECTED')
```

Audit wajib:

```sql
INSERT INTO admin_action_audit (...)
```

### 17.3 Two-Person Rule untuk High Impact Operation

Untuk operasi sensitif:

- data correction massal;
- delete/purge;
- override state;
- re-run financial calculation;
- export PII;

butuh:

```text
requester != approver
reason required
ticket reference required
audit immutable
row count limit
preview mode before execute
```

JDBC layer harus mendukung safe execution:

- bind parameters;
- max row guard;
- transaction boundary;
- rollback on unexpected count;
- audit.

---

## 18. Data Minimization di Query Design

### 18.1 Jangan `SELECT *`

Buruk:

```sql
SELECT * FROM applicant
```

Masalah:

- mengambil kolom sensitif tanpa perlu;
- schema change bisa expose field baru;
- mapping object bisa menyimpan data tidak perlu;
- log/trace/memory dump lebih berisiko;
- network cost meningkat.

Lebih baik:

```sql
SELECT id, name, masked_identifier, status
FROM applicant
WHERE id = ?
```

### 18.2 DTO Projection sebagai Security Boundary

Untuk screen listing:

```java
record CaseListItem(
    long id,
    String caseNo,
    String status,
    Instant createdAt
) {}
```

Jangan reuse entity penuh yang berisi:

- full NRIC;
- date of birth;
- address;
- internal remarks;
- risk score;
- attachment metadata.

### 18.3 Fetch Only What the Use Case Needs

Repository method harus merefleksikan use case:

```java
List<CaseListItem> findCasesForListing(...)
Optional<CaseDetail> findCaseDetail(...)
Optional<CaseSecretData> findCaseSecretDataForAuthorizedOfficer(...)
```

Jangan satu method `findCaseFull` untuk semua kebutuhan.

---

## 19. Secure HikariCP Configuration Considerations

HikariCP sendiri bukan security framework, tetapi konfigurasinya menyentuh security.

### 19.1 Credentials

Umumnya:

```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl(jdbcUrl);
config.setUsername(username);
config.setPassword(password);
```

Atau via `dataSourceProperties`.

Pastikan:

- password tidak dilog;
- URL tidak mengandung password;
- secret source aman;
- pool restart/refresh strategy jelas saat rotation;
- config dump dimasking.

### 19.2 `connectionInitSql`

`connectionInitSql` bisa dipakai untuk mengatur session state, misalnya application context.

Risiko:

- jika mengandung dynamic value, bisa injection;
- jika set tenant/global state, bisa bocor antar request;
- hanya dieksekusi saat physical connection creation, bukan setiap borrow.

Jangan gunakan `connectionInitSql` untuk request-specific tenant/user context.

### 19.3 `readOnly`

`readOnly=true` bisa membantu memberi hint dan guard tertentu, tetapi tidak boleh dianggap security boundary utama.

Jika ingin read-only benar-benar enforced, gunakan DB user read-only.

### 19.4 `autoCommit`

Security/integrity impact:

- `autoCommit=true` membuat setiap statement commit sendiri;
- multi-step invariant bisa setengah berhasil;
- audit + mutation bisa tidak atomic.

Untuk operasi sensitif, kontrol transaction secara eksplisit.

### 19.5 `leakDetectionThreshold`

Leak detection bukan security feature, tetapi membantu menemukan:

- connection ditahan terlalu lama;
- transaction terbuka;
- code path lupa close;
- potential denial-of-service via pool starvation.

### 19.6 JMX/MBeans

Jika `registerMbeans=true`, pastikan akses JMX diamankan. Pool metrics/action dapat menjadi operational control surface.

---

## 20. Secure Repository Design

### 20.1 Repository Method Harus Bernama Menurut Policy

Kurang jelas:

```java
CaseFile get(long id);
```

Lebih jelas:

```java
Optional<CaseFile> findVisibleCaseForAgency(long caseId, long agencyId);
Optional<CaseFile> findCaseForOfficer(long caseId, long officerId);
int transitionCaseStatus(long caseId, CaseStatus from, CaseStatus to, long actorId);
```

Nama method harus mengingatkan caller bahwa access scoped.

### 20.2 Jangan Expose Raw Connection ke Banyak Layer

Anti-pattern:

```java
public Connection getConnection() { ... }
```

Jika connection tersebar:

- transaction ownership kabur;
- security context bisa bypass;
- logging inconsistent;
- timeout inconsistent;
- leak risk naik.

Lebih baik:

- repository menerima connection dari transaction boundary internal;
- service memakai transaction template;
- raw connection hanya di infrastructure layer.

### 20.3 Query Object Pattern

Untuk query kompleks:

```java
record CaseSearchQuery(
    long agencyId,
    Optional<CaseStatus> status,
    Optional<String> keyword,
    CaseSortField sortField,
    SortDirection direction,
    int limit,
    int offset
) {}
```

Validasi:

```java
CaseSearchQuery {
    if (limit < 1 || limit > 100) {
        throw new IllegalArgumentException("limit out of range");
    }
    if (offset < 0) {
        throw new IllegalArgumentException("offset out of range");
    }
}
```

Ini lebih aman daripada menerima raw Map/string.

---

## 21. Secure Pagination and Limits

Tanpa limit, query bisa menjadi data exfiltration atau DoS.

### 21.1 Limit Harus Dibatasi

```java
int safeLimit = Math.min(Math.max(request.limit(), 1), 100);
```

Jangan percaya request:

```text
limit=1000000
```

### 21.2 Export Flow Harus Berbeda dari Listing Flow

Listing UI:

```text
limit <= 100
```

Export:

```text
requires permission
requires audit
runs async
has row count limit
has purpose/reason
stores file securely
expires file
```

Jangan jadikan endpoint listing sebagai export massal.

---

## 22. Bulk Operation Safety

Bulk update/delete sangat berbahaya.

### 22.1 Guard Row Count

```java
int updated = ps.executeUpdate();
if (updated > expectedMaxRows) {
    connection.rollback();
    throw new IllegalStateException("Unexpected row count: " + updated);
}
```

### 22.2 Require Scope

Buruk:

```sql
UPDATE case_file SET status = 'EXPIRED'
WHERE expiry_date < ?
```

Mungkin valid untuk batch global, tetapi harus jelas.

Untuk agency-specific operation:

```sql
UPDATE case_file
SET status = 'EXPIRED'
WHERE agency_id = ?
  AND expiry_date < ?
```

### 22.3 Preview Before Execute

Untuk admin action:

```sql
SELECT COUNT(*)
FROM case_file
WHERE ...
```

Lalu execute dengan condition yang sama dalam transaction jika feasible.

### 22.4 No Raw Delete without Archival Policy

Untuk regulatory/audit-heavy system, physical delete sering harus:

- soft delete;
- archival;
- retention policy;
- approval;
- immutable audit;
- legal hold check.

JDBC code tidak boleh asal `DELETE` tanpa domain policy.

---

## 23. Database Auditability

### 23.1 Application Audit vs Database Audit

Application audit:

- actor id;
- request id;
- use case;
- business reason;
- old/new value;
- module;
- timestamp;
- source IP/session;
- approval reference.

Database audit:

- DB user;
- session;
- SQL operation;
- object accessed;
- timestamp;
- client identifier/module if configured.

Keduanya saling melengkapi.

### 23.2 Set Client Context Where Supported

Beberapa database/driver mendukung session-level metadata:

- application name;
- module/action;
- client identifier;
- session variables.

Tujuannya agar DBA bisa melihat:

```text
which application request caused this DB session/query?
```

Hati-hati dengan pool:

- context harus diset saat borrow/request;
- di-clear saat return;
- jangan bocor antar request.

### 23.3 Audit Must Be Tamper-Resistant

Audit table harus:

- append-only jika mungkin;
- tidak bisa diupdate/delete oleh runtime user biasa;
- punya hash chain/signature jika compliance butuh;
- punya retention policy;
- tidak menyimpan PII berlebihan;
- bisa dikorelasikan dengan business event.

Jika runtime user bisa update/delete audit sesuka hati, audit kehilangan nilai pembuktian.

---

## 24. SQL Review Checklist untuk Code Review

Gunakan checklist berikut saat review JDBC code.

### 24.1 Query Construction

```text
[ ] Apakah semua values memakai bind parameter?
[ ] Apakah semua dynamic identifiers berasal dari enum/allow-list?
[ ] Apakah tidak ada raw string concatenation dari user input?
[ ] Apakah LIKE wildcard semantics disengaja?
[ ] Apakah IN clause dibuat dengan placeholder, bukan join raw input?
[ ] Apakah SQL fragment tidak berasal dari request Map/string bebas?
```

### 24.2 Authorization and Scope

```text
[ ] Apakah query membawa tenant/agency/user scope?
[ ] Apakah repository method name mencerminkan scope?
[ ] Apakah data sensitif tidak dibaca sebelum authorization?
[ ] Apakah admin/batch operation punya reason/audit/approval?
```

### 24.3 Privilege

```text
[ ] Apakah runtime DB user bukan schema owner?
[ ] Apakah privilege hanya sesuai use case?
[ ] Apakah read-only/reporting workload memakai user/pool terpisah?
[ ] Apakah migration user berbeda dari runtime user?
```

### 24.4 Data Minimization

```text
[ ] Tidak memakai SELECT * untuk path production?
[ ] Projection hanya mengambil field yang diperlukan?
[ ] PII tidak dibaca untuk listing/search ringan?
[ ] Export flow dipisah dari listing flow?
```

### 24.5 Logging

```text
[ ] Raw bind values tidak dilog di production?
[ ] Sensitive values dimask?
[ ] Error response tidak membocorkan schema/table/constraint detail?
[ ] SQLState/vendorCode tetap tersedia di internal log?
```

### 24.6 Integrity

```text
[ ] Mutation penting berada dalam transaction?
[ ] Audit ditulis dalam transaction yang sama?
[ ] Retry operation idempotent?
[ ] Unique constraint/idempotency key tersedia?
[ ] Optimistic locking atau transition guard digunakan?
[ ] Row count unexpected menyebabkan rollback?
```

### 24.7 Transport and Secrets

```text
[ ] TLS enabled untuk DB connection sesuai policy?
[ ] Server certificate diverifikasi?
[ ] Tidak ada trust-all di production?
[ ] Credential tidak hardcoded?
[ ] Rotation strategy jelas?
[ ] Config dump dimasking?
```

---

## 25. Secure JDBC Utility: Minimal Example

Berikut contoh kecil utility untuk query yang lebih aman. Ini bukan framework final, tetapi menunjukkan prinsip.

```java
public final class SafeSql {
    private SafeSql() {}

    public static String placeholders(int count) {
        if (count <= 0) {
            throw new IllegalArgumentException("count must be positive");
        }
        return IntStream.range(0, count)
            .mapToObj(i -> "?")
            .collect(Collectors.joining(", "));
    }

    public static int clampLimit(int requested, int max) {
        if (max < 1) {
            throw new IllegalArgumentException("max must be positive");
        }
        return Math.min(Math.max(requested, 1), max);
    }

    public static String escapeLikeLiteral(String input) {
        Objects.requireNonNull(input, "input");
        return input
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_");
    }
}
```

Usage:

```java
public List<CaseListItem> searchCases(Connection connection, CaseSearchQuery query)
        throws SQLException {

    int limit = SafeSql.clampLimit(query.limit(), 100);

    StringBuilder sql = new StringBuilder("""
        SELECT id, case_no, status, created_at
        FROM case_file
        WHERE agency_id = ?
        """);

    List<SqlBinder> binders = new ArrayList<>();
    binders.add((ps, i) -> ps.setLong(i, query.agencyId()));

    query.status().ifPresent(status -> {
        sql.append(" AND status = ?");
        binders.add((ps, i) -> ps.setString(i, status.name()));
    });

    query.keyword().filter(s -> !s.isBlank()).ifPresent(keyword -> {
        sql.append(" AND LOWER(title) LIKE ? ESCAPE '\\'");
        String pattern = "%" + SafeSql.escapeLikeLiteral(keyword.toLowerCase(Locale.ROOT)) + "%";
        binders.add((ps, i) -> ps.setString(i, pattern));
    });

    sql.append(" ORDER BY ")
        .append(query.sortField().column())
        .append(' ')
        .append(query.direction().name())
        .append(" LIMIT ? OFFSET ?");

    binders.add((ps, i) -> ps.setInt(i, limit));
    binders.add((ps, i) -> ps.setInt(i, query.offset()));

    try (PreparedStatement ps = connection.prepareStatement(sql.toString())) {
        for (int i = 0; i < binders.size(); i++) {
            binders.get(i).bind(ps, i + 1);
        }

        try (ResultSet rs = ps.executeQuery()) {
            List<CaseListItem> result = new ArrayList<>();
            while (rs.next()) {
                result.add(new CaseListItem(
                    rs.getLong("id"),
                    rs.getString("case_no"),
                    CaseStatus.valueOf(rs.getString("status")),
                    rs.getTimestamp("created_at").toInstant()
                ));
            }
            return result;
        }
    }
}
```

Security properties:

- agency scope required;
- status value is bound;
- keyword is bound and LIKE-escaped;
- sort field/direction from enum;
- limit clamped;
- projection explicit;
- no raw user SQL.

---

## 26. Case Study: Regulatory Case Transition

### 26.1 Problem

A regulatory system has case transition:

```text
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
```

Requirements:

- only assigned officer can approve;
- case must belong to officer's agency;
- transition must be atomic;
- audit must be written;
- duplicate submit must not duplicate audit/event;
- status race must be detected;
- event must publish only after commit.

### 26.2 Unsafe Design

```java
CaseFile c = repository.findById(caseId);
if (user.canApprove()) {
    repository.updateStatus(caseId, APPROVED);
    eventPublisher.publish(new CaseApproved(caseId));
}
```

Problems:

- `findById` not scoped;
- role check too broad;
- update does not guard current status/version;
- no idempotency;
- event may publish before commit;
- audit missing or non-atomic.

### 26.3 Safer JDBC Design

Transaction:

```text
BEGIN
  insert idempotency key
  update case_file
    where id=?
      and agency_id=?
      and assigned_officer_id=?
      and status='UNDER_REVIEW'
      and version=?
  insert audit_trail
  insert outbox_event
COMMIT
```

Update:

```sql
UPDATE case_file
SET status = ?,
    version = version + 1,
    updated_by = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND agency_id = ?
  AND assigned_officer_id = ?
  AND status = ?
  AND version = ?
```

Java checks:

```java
int updated = ps.executeUpdate();
if (updated == 0) {
    throw new ForbiddenOrConflictException(
        "Case is not approvable by this actor or has been modified"
    );
}
```

Audit insert:

```sql
INSERT INTO case_audit (
    case_id,
    actor_id,
    action,
    from_status,
    to_status,
    reason,
    correlation_id,
    created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
```

Outbox insert:

```sql
INSERT INTO outbox_event (
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key,
    created_at
) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
```

Security and integrity properties:

- authorization encoded into update predicate;
- tenant/agency scope encoded into update predicate;
- race detected by status/version guard;
- idempotency prevents duplicate action;
- audit atomic with mutation;
- event atomic through outbox;
- no raw SQL input;
- minimal privilege can restrict app to specific tables/procedures.

---

## 27. Common Anti-Patterns

### 27.1 “Internal Tool, So SQL Injection Does Not Matter”

Internal tools often have higher privilege and weaker monitoring. Injection in internal admin tool can be worse than public endpoint.

### 27.2 “DB Is Inside VPC, So TLS Is Optional”

VPC/internal network reduces exposure but does not eliminate:

- compromised workload;
- packet capture;
- misrouted traffic;
- insider threat;
- compliance requirement;
- shared infrastructure risk.

### 27.3 “App User Can Own Schema; It Is Easier”

It is easier until compromise, bug, or accidental script drops production table.

### 27.4 “We Mask API Response, So Query Can Fetch Everything”

Fetched data can still leak via:

- logs;
- heap dump;
- APM;
- exception;
- debug endpoint;
- serialization bug.

### 27.5 “We Use PreparedStatement Everywhere”

Check dynamic SQL fragments. `PreparedStatement` does not protect table names, column names, sort direction, or SQL fragments.

### 27.6 “ReadOnly Pool Means Secure Read Only”

`Connection.setReadOnly(true)` is not substitute for DB privilege. Use read-only DB user.

### 27.7 “We Can Retry All SQLException”

Retrying non-idempotent mutation can create duplicate or inconsistent data. Retry requires classification and idempotency.

---

## 28. Practical Production Baseline

For serious production systems, baseline should look like this:

```text
SQL construction
  values use PreparedStatement bind parameters
  identifiers/fragments use code-owned allow-lists
  no raw SQL from request

Privileges
  runtime user is not schema owner
  migration user separate
  read/report/batch users separated where useful
  least privilege reviewed periodically

Transport
  TLS enabled according to risk/compliance
  certificate verification enabled
  no trust-all in production

Secrets
  credentials from secret manager/K8s secret/Vault/cloud identity
  no hardcoded secrets
  config/log masking
  rotation tested

Authorization
  tenant/agency/scope in SQL predicates for sensitive access
  repository methods named around scope
  admin operations audited and bounded

Integrity
  constraints enforce invariants
  idempotency keys for retryable mutation
  optimistic locking/state transition guards
  audit/outbox in same transaction

Logging
  no raw sensitive bind values in production
  SQLState/vendor code logged internally
  safe client error messages

Operations
  leak detection used diagnostically
  pool metrics monitored
  DB session correlation available
  certificate/credential rotation rehearsed
```

---

## 29. Final Mental Model

Security di JDBC boundary bukan satu fitur. Ia adalah kombinasi dari beberapa pagar:

```text
Safe SQL construction
        +
Least privilege database user
        +
Scoped query predicates
        +
Transport encryption and verification
        +
Safe secret lifecycle
        +
Safe logging/error handling
        +
Database constraints
        +
Auditable transaction design
        +
Idempotent retry behavior
        +
Operational monitoring
```

Jika hanya memakai satu pagar, misalnya `PreparedStatement`, sistem masih bisa gagal lewat:

- dynamic ORDER BY injection;
- excessive DB privilege;
- PII leak in logs;
- connection URL password leak;
- unverified TLS;
- cross-tenant query;
- unsafe retry;
- missing audit;
- admin endpoint raw SQL;
- open transaction side effect.

Engineer level tinggi melihat JDBC sebagai **controlled mutation boundary**.

Pertanyaannya bukan hanya:

```text
Does this query run?
```

Tetapi:

```text
Can this query be abused?
Does it fetch only what is needed?
Does it enforce scope?
Does it preserve integrity under retry/race/timeout?
Can it be audited?
Does the DB user have only the privilege required?
Will logs and errors stay safe?
What happens if the connection/pool/credential/TLS layer fails?
```

Itulah cara berpikir yang membedakan “bisa memakai JDBC” dari “bisa mengoperasikan JDBC secara aman di production”.

---

## 30. Referensi

Referensi utama yang relevan untuk part ini:

1. Java SE `PreparedStatement` API — parameterized SQL statement contract.
2. Java SE `DriverManager` dan `DataSource` API — login timeout, log writer, dan connection acquisition boundary.
3. Oracle JDBC tutorial — prepared statement dan SQL injection explanation.
4. OWASP SQL Injection Prevention Cheat Sheet — prepared statements, allow-list validation, stored procedure caveats.
5. OWASP Injection Prevention Cheat Sheet — query parts where bind variables are not legal, such as table/column names and sort order.
6. HikariCP README — configuration, data source properties, username/password, pool behavior.
7. PostgreSQL JDBC SSL documentation — driver-specific TLS configuration.
8. MySQL Connector/J SSL/security documentation — SSL mode and encrypted connection behavior.
9. Oracle JDBC Client-Side Security Features — authentication, network encryption, integrity, wallet/TLS-related behavior.

---

## 31. Ringkasan Part 026

Di part ini kita membahas:

1. kenapa JDBC boundary adalah security dan integrity boundary;
2. threat model JDBC: injection, excessive privilege, credential leakage, unsafe logging, tenant bypass, retry corruption;
3. kekuatan dan batas `PreparedStatement`;
4. safe dynamic SQL dengan allow-list;
5. least privilege DB user;
6. pemisahan schema owner, migration user, runtime user, reporting user;
7. view/stored procedure sebagai security boundary;
8. tenant/agency/scope isolation;
9. row-level security dan session-state caveat dengan pool;
10. credential storage dan rotation;
11. TLS/certificate verification pada JDBC driver;
12. safe SQL logging dan exception hygiene;
13. database constraint, idempotency, optimistic locking, dan audit/outbox sebagai integrity mechanism;
14. secure admin/bulk operation;
15. production checklist untuk review JDBC security.

Part berikutnya:

```text
Part 027 — Testing JDBC Code Properly
```

Di part berikutnya kita akan membahas bagaimana menguji JDBC code dengan benar: unit vs integration test, Testcontainers, transaction rollback per test, isolation/race/deadlock test, pool exhaustion test, LOB/timezone test, SQLState assertion, dan performance regression test.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Failure Modes and Recovery Patterns](./learn-java-sql-jdbc-hikaricp-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 027 — Testing JDBC Code Properly](./learn-java-sql-jdbc-hikaricp-part-027.md)

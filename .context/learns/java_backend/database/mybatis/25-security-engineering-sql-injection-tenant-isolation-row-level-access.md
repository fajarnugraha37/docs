# Part 25 — Security Engineering: SQL Injection, Tenant Isolation, Row-Level Access

Series: `learn-java-mybatis-sql-mapper-persistence-engineering`  
Target file: `25-security-engineering-sql-injection-tenant-isolation-row-level-access.md`  
Scope: Java 8 sampai Java 25, MyBatis core, MyBatis-Spring, Spring Boot, XML mapper, annotation mapper, MyBatis Dynamic SQL, enterprise multi-module systems.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas statement mapping, parameter binding, result mapping, dynamic SQL, transaction, performance, observability, testing, dan migration. Bagian ini menyatukan semuanya dari sudut pandang security.

MyBatis memberi kita kontrol SQL yang sangat besar. Kontrol ini adalah kekuatan sekaligus sumber risiko. Jika JPA/Hibernate sering menyembunyikan SQL di balik abstraction, MyBatis justru membuat SQL eksplisit. Karena itu, security engineer dan backend engineer harus mampu membaca mapper sebagai security boundary.

Tujuan bagian ini:

1. memahami SQL injection boundary di MyBatis;
2. membedakan binding aman dan substitution berbahaya;
3. mendesain dynamic SQL yang aman;
4. mencegah tenant leakage;
5. mencegah row-level authorization bypass;
6. menjaga mapper tidak over-fetch data sensitif;
7. mengendalikan sorting/filtering/search user input;
8. mendesain update/delete yang scoped dan auditable;
9. membangun checklist review mapper untuk sistem enterprise besar;
10. memahami failure model security di production.

Security di MyBatis tidak cukup dengan mengatakan:

```text
Gunakan #{} dan jangan pakai ${}.
```

Itu benar, tapi belum cukup. Banyak kebocoran data tidak terjadi karena SQL injection klasik, tetapi karena:

- query tidak memasukkan `tenant_id`;
- query mengambil row milik agency lain;
- mapper internal dipakai oleh service publik;
- `ORDER BY ${sort}` tidak divalidasi;
- `LIKE` pattern tidak di-escape;
- result mapping mengembalikan field sensitif;
- update/delete tidak scoped;
- soft-delete filter lupa;
- authorization dicek setelah data sudah telanjur diambil;
- audit tidak mencatat actor dan reason;
- multi-datasource salah wiring;
- cache membocorkan data antar scope.

Top-tier engineer melihat mapper sebagai bagian dari threat model, bukan hanya bagian dari data access layer.

---

## 2. Security Mental Model untuk MyBatis

MyBatis security dapat dipahami dengan model berikut:

```text
User Input
  -> API DTO / Command / Criteria
  -> Validation / Normalization
  -> Authorization Context
  -> Mapper Parameter Object
  -> Dynamic SQL Assembly
  -> JDBC Binding
  -> Database Permission / Constraint
  -> Result Mapping
  -> Response DTO
```

Setiap panah adalah tempat security bisa gagal.

### 2.1 Mapper Bukan Hanya Query Function

Mapper method terlihat seperti function biasa:

```java
CaseDetail findCaseDetail(long caseId);
```

Tapi secara security, method ini punya pertanyaan tersembunyi:

- case milik tenant mana?
- actor boleh melihat case ini?
- apakah case soft-deleted?
- apakah module/agency actor sesuai?
- apakah field sensitif boleh keluar?
- apakah query mengembalikan satu row atau bisa duplicate?
- apakah query aman dari injection?
- apakah result di-cache dan bisa reuse di scope lain?

Method yang lebih aman biasanya membawa security scope eksplisit:

```java
CaseDetail findVisibleCaseDetail(CaseVisibilityQuery query);
```

Dengan parameter object:

```java
public final class CaseVisibilityQuery {
    private final long caseId;
    private final String tenantId;
    private final String agencyCode;
    private final long actorUserId;
    private final Set<String> allowedModuleCodes;

    // constructor/getters
}
```

Mapper yang membawa scope eksplisit lebih mudah direview daripada mapper yang hanya menerima `caseId`.

---

## 3. Threat Model Utama di MyBatis

Security risk utama MyBatis dapat dikelompokkan menjadi tujuh kategori.

### 3.1 SQL Injection

Terjadi ketika input user menjadi bagian dari SQL syntax, bukan hanya value.

Contoh berbahaya:

```xml
<select id="findByStatusUnsafe" resultMap="caseRowMap">
  SELECT id, case_no, status
  FROM cases
  WHERE status = '${status}'
</select>
```

Jika `status` berasal dari user, SQL dapat dimanipulasi.

Yang aman:

```xml
<select id="findByStatus" resultMap="caseRowMap">
  SELECT id, case_no, status
  FROM cases
  WHERE status = #{status}
</select>
```

`#{}` mengikat value melalui prepared statement. `${}` melakukan textual substitution.

### 3.2 Identifier Injection

Tidak semua input bisa dibind dengan prepared statement. Nama kolom, arah sorting, nama tabel, dan fragment SQL tidak bisa menjadi parameter value biasa.

Contoh berbahaya:

```xml
ORDER BY ${sortColumn} ${sortDirection}
```

Walaupun tidak ada string literal, ini tetap injection boundary.

### 3.3 Tenant Leakage

Query lupa memfilter tenant/agency/module.

```xml
SELECT id, case_no, status
FROM cases
WHERE id = #{caseId}
```

Jika `caseId` valid tapi milik tenant lain, data bocor.

Query yang lebih aman:

```xml
SELECT id, case_no, status
FROM cases
WHERE id = #{caseId}
  AND tenant_id = #{tenantId}
  AND agency_code = #{agencyCode}
```

### 3.4 Authorization Bypass

Service sudah punya authorization rule, tetapi mapper terlalu generic sehingga bisa dipakai dari jalur lain tanpa rule yang sama.

Contoh smell:

```java
CaseRecord findById(long id);
```

Jika method ini public di banyak service, siapa pun bisa mengambil case hanya dengan ID.

### 3.5 Over-Fetching Sensitive Data

Query mengambil data lebih banyak dari yang perlu.

```sql
SELECT * FROM users
```

Risiko:

- password hash ikut termap;
- token ikut keluar;
- national ID ikut masuk log;
- personal data ikut response karena mapper reused;
- audit payload terlalu sensitif.

### 3.6 Unsafe Update/Delete

Update/delete tanpa scope.

```xml
<update id="closeCase">
  UPDATE cases
  SET status = 'CLOSED'
  WHERE id = #{caseId}
</update>
```

Lebih aman:

```xml
<update id="closeVisibleCase">
  UPDATE cases
  SET status = 'CLOSED',
      updated_by = #{actorUserId},
      updated_at = CURRENT_TIMESTAMP
  WHERE id = #{caseId}
    AND tenant_id = #{tenantId}
    AND agency_code = #{agencyCode}
    AND status = 'APPROVED'
</update>
```

### 3.7 Cache Scope Leakage

MyBatis first-level cache biasanya session-scoped. Second-level cache berbasis namespace mapper. Jika query result tidak mempertimbangkan tenant/security scope dalam parameter, cache dapat mengembalikan data yang salah.

Rule sederhana:

```text
Jangan gunakan second-level cache untuk data user/tenant/authorization-sensitive kecuali cache key dan invalidation model benar-benar dipahami.
```

---

## 4. `#{}` vs `${}` sebagai Security Boundary

### 4.1 `#{}` adalah Value Binding

Contoh:

```xml
WHERE status = #{status}
```

Secara mental model, MyBatis membuat SQL seperti:

```sql
WHERE status = ?
```

Lalu value `status` dikirim ke JDBC driver sebagai parameter.

Keuntungan:

- value tidak menjadi SQL syntax;
- driver menangani quoting;
- lebih aman dari injection;
- query plan lebih stabil;
- tipe bisa di-handle oleh `TypeHandler`.

### 4.2 `${}` adalah Text Substitution

Contoh:

```xml
ORDER BY ${columnName}
```

MyBatis memasukkan string langsung ke SQL.

Jika `columnName = "created_at desc; drop table cases; --"`, maka SQL menjadi berbahaya.

`$ {}` bukan fitur yang harus dihapus total, tetapi harus diperlakukan sebagai **trusted SQL fragment only**.

### 4.3 Rule Praktis

```text
Gunakan #{} untuk semua value.
Gunakan ${} hanya untuk SQL fragment yang berasal dari whitelist internal, bukan input mentah user.
```

Contoh value:

- status;
- user id;
- tenant id;
- date range;
- keyword;
- amount;
- version;
- code;
- enum.

Gunakan `#{}`.

Contoh identifier/SQL fragment:

- column name;
- table name;
- schema name;
- sort direction;
- optimizer hint;
- partition name.

Tidak bisa pakai `#{}` sebagai identifier. Harus pakai whitelist, bukan input mentah.

---

## 5. Safe Dynamic Identifier Pattern

### 5.1 Jangan Kirim Nama Kolom Mentah dari Controller

Buruk:

```java
public Page<CaseRow> search(String sortColumn, String sortDirection) {
    return mapper.search(sortColumn, sortDirection);
}
```

XML:

```xml
ORDER BY ${sortColumn} ${sortDirection}
```

Ini injection boundary.

### 5.2 Gunakan Enum Whitelist

```java
public enum CaseSortField {
    CASE_NO("c.case_no"),
    STATUS("c.status"),
    CREATED_AT("c.created_at"),
    UPDATED_AT("c.updated_at");

    private final String sqlExpression;

    CaseSortField(String sqlExpression) {
        this.sqlExpression = sqlExpression;
    }

    public String sqlExpression() {
        return sqlExpression;
    }
}
```

Direction:

```java
public enum SortDirection {
    ASC("ASC"),
    DESC("DESC");

    private final String sql;

    SortDirection(String sql) {
        this.sql = sql;
    }

    public String sql() {
        return sql;
    }
}
```

Criteria:

```java
public final class CaseSearchCriteria {
    private String tenantId;
    private String agencyCode;
    private String keyword;
    private CaseSortField sortField;
    private SortDirection sortDirection;
    private int limit;
    private int offset;

    public String getSortExpression() {
        return sortField.sqlExpression();
    }

    public String getSortDirectionSql() {
        return sortDirection.sql();
    }
}
```

XML:

```xml
ORDER BY ${sortExpression} ${sortDirectionSql}, c.id DESC
```

Ini masih menggunakan `${}`, tetapi input-nya bukan string user mentah. Ia berasal dari enum internal.

### 5.3 Alternatif Lebih Ketat: `<choose>` di XML

```xml
<choose>
  <when test="sortField == 'CASE_NO'">
    ORDER BY c.case_no
  </when>
  <when test="sortField == 'STATUS'">
    ORDER BY c.status
  </when>
  <when test="sortField == 'UPDATED_AT'">
    ORDER BY c.updated_at
  </when>
  <otherwise>
    ORDER BY c.created_at
  </otherwise>
</choose>

<choose>
  <when test="sortDirection == 'ASC'">ASC</when>
  <otherwise>DESC</otherwise>
</choose>
```

Kelebihan:

- tidak ada `${}`;
- whitelist terlihat di XML;
- mudah direview.

Kekurangan:

- verbose;
- logic sorting menyebar di XML.

Untuk sistem sangat security-sensitive, verbosity ini sering layak.

---

## 6. Safe Search Keyword Pattern

Search keyword terlihat sederhana, tapi sering menjadi sumber bug.

### 6.1 Buruk: LIKE dengan `${}`

```xml
WHERE c.case_no LIKE '%${keyword}%'
```

Ini injection.

### 6.2 Lebih Aman: `#{}` dengan Prepared Binding

```xml
WHERE LOWER(c.case_no) LIKE #{keywordPattern}
```

Criteria membentuk pattern:

```java
public String getKeywordPattern() {
    if (keyword == null || keyword.isBlank()) {
        return null;
    }
    return "%" + keyword.toLowerCase(Locale.ROOT) + "%";
}
```

Tapi ini belum sempurna, karena `%` dan `_` di input user punya arti wildcard.

### 6.3 Escape Wildcard

```java
public final class SqlLikeEscaper {
    private SqlLikeEscaper() {}

    public static String containsPattern(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }

        String normalized = raw.trim().toLowerCase(Locale.ROOT);
        String escaped = normalized
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_");

        return "%" + escaped + "%";
    }
}
```

XML:

```xml
<if test="keywordPattern != null">
  AND (
    LOWER(c.case_no) LIKE #{keywordPattern} ESCAPE '\'
    OR LOWER(c.subject) LIKE #{keywordPattern} ESCAPE '\'
  )
</if>
```

### 6.4 Search Policy

Untuk keyword search, tetapkan policy:

- minimum length;
- maximum length;
- allowed fields;
- wildcard escaping;
- case normalization;
- indexing strategy;
- timeout;
- pagination limit;
- no search on sensitive fields unless authorized.

Security dan performance bertemu di sini. Search bebas tanpa batas dapat menjadi denial-of-service vector.

---

## 7. Tenant Isolation sebagai Invariant

Dalam sistem multi-tenant/multi-agency, tenant isolation harus menjadi invariant, bukan optional filter.

### 7.1 Invariant

```text
Setiap query terhadap tenant-owned table harus membawa tenant scope.
```

Bukan:

```sql
WHERE id = #{id}
```

Tetapi:

```sql
WHERE id = #{id}
  AND tenant_id = #{tenantId}
```

Untuk agency/module scoped system:

```sql
WHERE id = #{id}
  AND tenant_id = #{tenantId}
  AND agency_code = #{agencyCode}
  AND module_code IN (...)
```

### 7.2 Jangan Mengandalkan ID Global Saja

Walaupun `id` global unique, tenant scope tetap perlu karena:

- authorization defense-in-depth;
- query contract lebih jelas;
- audit lebih kuat;
- mencegah accidental cross-tenant access;
- memudahkan row-level security migration;
- query plan bisa memakai composite index `(tenant_id, id)`.

### 7.3 Mapper Method Naming

Kurang aman:

```java
CaseRecord findById(long caseId);
```

Lebih baik:

```java
CaseRecord findByIdWithinTenant(CaseKey key);
CaseRecord findVisibleCase(CaseVisibilityQuery query);
```

Nama method harus memaksa pembaca bertanya: “visible menurut siapa?”

### 7.4 Tenant Scope Object

```java
public final class TenantScope {
    private final String tenantId;
    private final String agencyCode;
    private final long actorUserId;

    public TenantScope(String tenantId, String agencyCode, long actorUserId) {
        this.tenantId = Objects.requireNonNull(tenantId);
        this.agencyCode = Objects.requireNonNull(agencyCode);
        this.actorUserId = actorUserId;
    }

    public String getTenantId() { return tenantId; }
    public String getAgencyCode() { return agencyCode; }
    public long getActorUserId() { return actorUserId; }
}
```

Use-case query:

```java
public final class CaseVisibilityQuery {
    private final long caseId;
    private final TenantScope scope;

    public long getCaseId() { return caseId; }
    public TenantScope getScope() { return scope; }
}
```

XML:

```xml
<select id="findVisibleCase" resultMap="caseDetailMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.subject,
    c.created_at
  FROM cases c
  WHERE c.id = #{caseId}
    AND c.tenant_id = #{scope.tenantId}
    AND c.agency_code = #{scope.agencyCode}
    AND c.deleted_at IS NULL
</select>
```

---

## 8. Row-Level Authorization

Tenant isolation menjawab: “row ini milik tenant/agency yang benar?”

Row-level authorization menjawab: “actor ini boleh melihat/memodifikasi row ini?”

Contoh aturan:

- case hanya boleh dilihat oleh assigned officer;
- supervisor boleh lihat case team-nya;
- legal officer hanya boleh lihat case status tertentu;
- external user hanya boleh lihat application miliknya;
- agency A tidak boleh lihat agency B;
- read permission berbeda dari update permission;
- confidential case butuh special clearance.

### 8.1 Authorization Bisa Diterapkan di Service atau SQL

#### Service-side authorization

```java
CaseRecord record = mapper.findByIdWithinTenant(key);
authorizationService.assertCanView(actor, record);
return record;
```

Kelebihan:

- rule bisa ekspresif;
- mudah reuse;
- tidak semua rule harus jadi SQL.

Kekurangan:

- data sudah diambil sebelum check;
- raw mapper bisa disalahgunakan;
- listing query tetap butuh filter SQL.

#### SQL-side authorization

```sql
WHERE c.tenant_id = #{tenantId}
  AND (
    c.assigned_user_id = #{actorUserId}
    OR EXISTS (
      SELECT 1
      FROM team_members tm
      WHERE tm.team_id = c.team_id
        AND tm.user_id = #{actorUserId}
        AND tm.role = 'SUPERVISOR'
    )
  )
```

Kelebihan:

- row tidak pernah keluar dari database jika tidak visible;
- cocok untuk listing/search;
- lebih kuat untuk row-level filtering.

Kekurangan:

- SQL lebih kompleks;
- rule tersebar;
- perlu test banyak kombinasi;
- performance harus dijaga.

### 8.2 Hybrid Pattern

Pattern paling realistis di enterprise:

```text
SQL enforces coarse-grained visibility.
Service enforces fine-grained action permission.
```

Contoh:

- SQL memastikan tenant, agency, assignment/team visibility;
- service memastikan apakah actor boleh approve, reject, reopen, export, etc.

### 8.3 Jangan Buat Mapper Generic Tanpa Scope

Buruk:

```java
List<CaseRow> search(CaseSearchCriteria criteria);
```

Lebih aman:

```java
List<CaseRow> searchVisibleCases(CaseSearchCriteria criteria);
```

Criteria wajib punya:

```java
private TenantScope scope;
private AuthorizationScope authorizationScope;
```

---

## 9. Secure DML: Update/Delete Harus Scoped

Select leakage berbahaya. Update/delete leakage bisa lebih berbahaya.

### 9.1 Update Harus Punya Guard

Buruk:

```xml
<update id="assignCase">
  UPDATE cases
  SET assigned_user_id = #{assigneeUserId}
  WHERE id = #{caseId}
</update>
```

Lebih aman:

```xml
<update id="assignCaseIfVisibleAndOpen">
  UPDATE cases
  SET assigned_user_id = #{assigneeUserId},
      updated_by = #{actorUserId},
      updated_at = CURRENT_TIMESTAMP,
      version = version + 1
  WHERE id = #{caseId}
    AND tenant_id = #{tenantId}
    AND agency_code = #{agencyCode}
    AND status IN ('NEW', 'IN_REVIEW')
    AND deleted_at IS NULL
    AND version = #{expectedVersion}
</update>
```

Return `int` rows affected harus dicek:

```java
int updated = mapper.assignCaseIfVisibleAndOpen(command);
if (updated == 0) {
    throw new ConcurrencyOrAuthorizationException("Case cannot be assigned");
}
```

Rows affected `0` dapat berarti:

- case tidak ada;
- bukan tenant/agency actor;
- status tidak valid;
- version stale;
- sudah soft-deleted.

Jangan langsung expose detail ke user jika detail itu bisa menjadi enumeration vector.

### 9.2 Delete Harus Lebih Ketat

Hard delete biasanya tidak boleh untuk business data penting.

Soft delete:

```xml
<update id="softDeleteCase">
  UPDATE cases
  SET deleted_at = CURRENT_TIMESTAMP,
      deleted_by = #{actorUserId},
      updated_at = CURRENT_TIMESTAMP,
      updated_by = #{actorUserId},
      version = version + 1
  WHERE id = #{caseId}
    AND tenant_id = #{tenantId}
    AND agency_code = #{agencyCode}
    AND deleted_at IS NULL
    AND status IN ('DRAFT', 'CANCELLED')
    AND version = #{expectedVersion}
</update>
```

### 9.3 Mass Update/Delete Harus Punya Safety Contract

Anti-pattern:

```xml
<delete id="deleteByStatus">
  DELETE FROM cases
  WHERE status = #{status}
</delete>
```

Lebih aman:

```xml
<update id="archiveOldClosedCases">
  UPDATE cases
  SET archived_at = CURRENT_TIMESTAMP,
      archived_by = #{actorUserId}
  WHERE tenant_id = #{tenantId}
    AND agency_code = #{agencyCode}
    AND status = 'CLOSED'
    AND closed_at &lt; #{closedBefore}
    AND archived_at IS NULL
</update>
```

Tambahkan guard di service:

- limit maksimal affected rows;
- dry-run count;
- approval workflow;
- audit reason;
- correlation id;
- transaction chunking;
- rollback/roll-forward strategy.

---

## 10. Over-Fetching dan Sensitive Field Governance

Security bukan hanya mencegah akses row salah, tetapi juga field salah.

### 10.1 Jangan `SELECT *`

Buruk:

```sql
SELECT * FROM users WHERE id = #{id}
```

Masalah:

- field baru otomatis ikut terbaca;
- password/token/secret bisa ikut termap;
- payload besar;
- logging risk;
- mapper contract tidak jelas.

Lebih baik:

```sql
SELECT
  u.id,
  u.username,
  u.display_name,
  u.email,
  u.status
FROM users u
WHERE u.id = #{userId}
  AND u.tenant_id = #{tenantId}
```

### 10.2 Pisahkan DTO Berdasarkan Use Case

Jangan satu `UserRecord` dipakai untuk semua.

Contoh DTO:

```java
public final class UserListRow {
    private Long id;
    private String username;
    private String displayName;
    private String status;
}

public final class UserSecurityRecord {
    private Long id;
    private String username;
    private String passwordHash;
    private String mfaSecretEncrypted;
    private String status;
}
```

`UserSecurityRecord` hanya boleh dipakai di authentication/security module, bukan controller umum.

### 10.3 Sensitive Column Classification

Buat kategori:

```text
Public-ish:
  display name, public code, public status

Internal:
  internal id, workflow status, assignment

Sensitive:
  email, phone, address, national id, birthdate

Secret:
  password hash, token, API key, mfa secret

Regulated/Audit-heavy:
  enforcement notes, investigation detail, legal opinion, evidence metadata
```

Mapper harus jelas mengambil kategori mana.

### 10.4 ResultMap Security Review

Review resultMap:

```xml
<resultMap id="userProfileMap" type="UserProfileDto">
  <id property="id" column="id"/>
  <result property="username" column="username"/>
  <result property="displayName" column="display_name"/>
  <result property="email" column="email"/>
</resultMap>
```

Pertanyaan:

- apakah `email` perlu?
- apakah API caller boleh melihat email?
- apakah DTO akan di-log?
- apakah DTO akan masuk cache?
- apakah DTO dipakai untuk export?

---

## 11. Mapper Boundary dan Service Boundary

### 11.1 Mapper Tidak Boleh Menjadi Authorization Oracle Tanpa Nama yang Jelas

Jika query melakukan visibility filtering, namanya harus jelas.

Buruk:

```java
CaseDetail findById(CaseQuery query);
```

Lebih baik:

```java
CaseDetail findVisibleDetailForActor(CaseVisibilityQuery query);
```

### 11.2 Service Tidak Boleh Memakai Mapper Internal Sembarangan

Pisahkan mapper:

```text
case/internal/CaseInternalMapper.java
case/query/CaseQueryMapper.java
case/command/CaseCommandMapper.java
case/security/CaseVisibilityMapper.java
```

Atau minimal pisahkan method:

```java
interface CaseMapper {
    CaseDetail findVisibleDetailForActor(CaseVisibilityQuery query);
    CaseRecord findInternalById(CaseInternalKey key); // package-private service only by convention
}
```

Java interface method tidak bisa package-private, jadi boundary harus melalui package/module governance.

### 11.3 Jangan Expose Mapper ke Controller

Controller -> Service -> Mapper.

Controller langsung mapper berarti:

- authorization gampang terlewat;
- transaction boundary kabur;
- mapper return bisa bocor ke response;
- audit/correlation policy terlewat.

---

## 12. SQL Injection Beyond WHERE Value

Injection sering muncul di tempat-tempat yang tidak dianggap value.

### 12.1 ORDER BY

Sudah dibahas: whitelist.

### 12.2 LIMIT/OFFSET

Walaupun numeric, tetap validasi.

Buruk:

```xml
LIMIT ${limit} OFFSET ${offset}
```

Lebih baik jika vendor mendukung binding:

```xml
LIMIT #{limit} OFFSET #{offset}
```

Tetap validasi di Java:

```java
int normalizedLimit = Math.min(Math.max(inputLimit, 1), 100);
int normalizedOffset = Math.max(inputOffset, 0);
```

### 12.3 IN Clause

Gunakan `foreach` dengan `#{}`:

```xml
<foreach collection="statuses" item="status" open="(" separator="," close=")">
  #{status}
</foreach>
```

Jangan:

```xml
status IN (${statusCsv})
```

### 12.4 Dynamic Table Name

Dynamic table name biasanya smell. Jika benar-benar perlu, pakai whitelist.

Contoh use case:

- partition table per year;
- archive table;
- staging table controlled by system.

Java:

```java
public enum CaseTableTarget {
    ACTIVE("cases"),
    ARCHIVE("cases_archive");

    private final String tableName;

    CaseTableTarget(String tableName) {
        this.tableName = tableName;
    }

    public String tableName() {
        return tableName;
    }
}
```

XML:

```xml
SELECT id, case_no, status
FROM ${tableName}
WHERE tenant_id = #{tenantId}
```

Only safe jika `tableName` berasal dari enum internal.

### 12.5 Dynamic Schema

Dynamic schema lebih berisiko. Prefer separate datasource atau database user search path yang dikontrol.

Jika harus:

- whitelist schema;
- tidak dari request langsung;
- validate format;
- audit usage;
- test SQL generation;
- jangan campur dengan privilege tinggi.

---

## 13. Security Scope dalam Parameter Object

Security scope sebaiknya bagian eksplisit dari parameter object, bukan implicit ThreadLocal yang diam-diam dipakai mapper.

### 13.1 Explicit Parameter Object

```java
public final class SecureCaseSearchCriteria {
    private final TenantScope tenantScope;
    private final AuthorizationScope authorizationScope;
    private final String keywordPattern;
    private final List<String> statuses;
    private final int limit;
    private final int offset;
}
```

Keuntungan:

- mapper method self-documenting;
- test mudah;
- cache key jelas;
- audit mudah;
- review mudah.

### 13.2 ThreadLocal Context

ThreadLocal kadang dipakai:

```java
SecurityContextHolder.getContext()
```

Jangan biarkan mapper langsung membaca context melalui interceptor kecuali benar-benar didesain. Hidden filter bisa membuat SQL susah dipahami.

Jika memakai interceptor untuk tenant filter, tetap pastikan:

- tidak mudah bypass;
- berlaku untuk semua statement yang wajib;
- statement exception list jelas;
- test coverage kuat;
- SQL mutation aman;
- observability menampilkan applied tenant scope;
- batch/background job punya context benar.

---

## 14. Database-Level Defense-in-Depth

Application-level filtering penting, tetapi database juga harus membantu.

### 14.1 Least Privilege Database User

Pisahkan user:

```text
app_rw_user:
  SELECT/INSERT/UPDATE terbatas pada schema aplikasi

app_ro_user:
  SELECT terbatas untuk reporting/query read-only

migration_user:
  DDL permission, tidak dipakai runtime aplikasi

admin_user:
  tidak dipakai aplikasi
```

Aplikasi tidak seharusnya memakai schema owner dengan permission luas.

### 14.2 Views untuk Security Boundary

Untuk data sensitif, view dapat membatasi kolom:

```sql
CREATE VIEW user_public_view AS
SELECT id, username, display_name, status
FROM users
WHERE deleted_at IS NULL;
```

Mapper membaca view:

```xml
SELECT id, username, display_name, status
FROM user_public_view
WHERE id = #{userId}
```

View bukan pengganti authorization, tapi bisa mengurangi over-fetching.

### 14.3 Row-Level Security

Beberapa database mendukung row-level security. Jika digunakan, MyBatis tetap harus eksplisit membawa context atau mengatur session variable secara aman.

Risiko:

- connection pool reuse;
- session variable lupa reset;
- background job context salah;
- observability sulit;
- test lebih kompleks.

Jika memakai session variable:

```text
Set context at transaction start.
Clear/reset context at transaction end.
Never rely on stale pooled connection state.
```

### 14.4 Constraints sebagai Security/Correctness Guard

Database constraint membantu mencegah state illegal:

- unique constraint untuk idempotency key;
- foreign key untuk tenant-owned relation;
- check constraint untuk status code;
- not-null untuk mandatory audit fields;
- composite unique untuk tenant scope.

Security yang hanya di aplikasi sering rapuh. Constraint membuat data model ikut menjaga invariant.

---

## 15. Cache dan Security

### 15.1 First-Level Cache

First-level cache berada dalam `SqlSession`. Dalam Spring transaction, session terkait transaction.

Risiko:

- object mutable dimodifikasi lalu dipakai lagi;
- query yang sama dengan parameter sama mengembalikan reference sama;
- authorization context berubah dalam transaction panjang.

Rule:

```text
Jangan memodifikasi result object MyBatis seolah-olah itu detached immutable snapshot kecuali memang didesain.
```

### 15.2 Second-Level Cache

Second-level cache berbasis mapper namespace.

Untuk data security-sensitive, default stance:

```text
Disable second-level cache.
```

Jika ingin aktif:

- pastikan cache key mencakup tenant/actor/scope;
- jangan cache result yang mengandung field sensitif;
- invalidation jelas;
- TTL sesuai;
- object immutable/serialized;
- test cross-tenant isolation;
- monitoring hit/miss dan stale issue.

### 15.3 Application Cache / Redis

Jika perlu caching user-specific/tenant-specific, lebih baik cache eksplisit di service layer:

```text
cache key = tenantId + actorId + permissionVersion + criteriaHash
```

Security cache harus punya key yang mencerminkan visibility.

---

## 16. Observability Security

Logging SQL berguna, tapi bisa membocorkan data.

### 16.1 Jangan Log Sensitive Parameter Mentah

Contoh sensitive:

- password;
- token;
- API key;
- national id;
- phone;
- email;
- address;
- free-text complaint;
- legal/investigation notes;
- serialized JSON payload.

### 16.2 Log Statement ID dan Shape

Lebih aman:

```text
mapper=CaseSearchMapper.searchVisibleCases
traceId=abc123
actor=12345
tenant=CEA
rows=20
durationMs=84
result=SUCCESS
```

Daripada:

```text
SELECT ... WHERE email = 'person@example.com' AND nric = 'S1234567A'
```

### 16.3 Audit vs Technical Log

Pisahkan:

```text
Technical log:
  debugging, latency, error, statement id, trace id

Audit log:
  actor, action, target, decision, reason, before/after where needed
```

Audit log harus intentional, bukan kebetulan dari SQL log.

---

## 17. MyBatis Interceptor untuk Security: Hati-Hati

Interceptor bisa memodifikasi SQL atau parameter. Use case:

- tenant filter injection;
- audit column injection;
- SQL logging/masking;
- query guard;
- read-only enforcement.

Namun security interceptor bisa berbahaya jika hidden.

### 17.1 Risiko Interceptor

- SQL mutation salah;
- tidak menangani subquery;
- tidak menangani alias;
- bypass pada statement tertentu;
- performance overhead;
- sulit debugging;
- test matrix besar;
- false sense of security.

### 17.2 Kapan Layak

Interceptor layak jika:

- rule sangat universal;
- SQL shape cukup predictable;
- ada test otomatis untuk semua mapper penting;
- ada observability applied/not-applied;
- ada fail-closed behavior.

### 17.3 Fail-Closed

Jika tenant context wajib tapi tidak ada, jangan lanjutkan query.

```java
if (requiresTenantScope(statementId) && TenantContext.current() == null) {
    throw new SecurityException("Missing tenant context for " + statementId);
}
```

Tapi lebih baik lagi: mapper parameter object eksplisit membawa tenant scope.

---

## 18. Secure Mapper Design Patterns

### 18.1 Query Object Carries Security Scope

```java
public final class CaseSearchQuery {
    private final TenantScope scope;
    private final Set<String> visibleStatuses;
    private final String keywordPattern;
    private final int limit;
    private final int offset;
    private final CaseSortField sortField;
    private final SortDirection sortDirection;
}
```

### 18.2 Mapper Method Names Encode Security Semantics

```java
List<CaseListRow> searchVisibleCases(CaseSearchQuery query);
CaseDetail findVisibleCaseDetail(CaseDetailQuery query);
int updateVisibleCaseStatus(CaseStatusTransitionCommand command);
int softDeleteDraftCase(SoftDeleteCaseCommand command);
```

### 18.3 Separate Internal Mapper from User-Facing Mapper

```text
CaseAdminMapper
  used by back-office admin service only

CaseExternalUserMapper
  always scoped by applicant user id

CaseReportingMapper
  read-only projection, no sensitive payload by default

CaseInternalMaintenanceMapper
  package/module-restricted, requires operational approval
```

### 18.4 Rows Affected Checked as Security/Consistency Signal

DML mapper returns `int`, never ignored.

```java
int affected = mapper.approveVisibleCase(command);
if (affected != 1) {
    throw new CannotApproveCaseException();
}
```

### 18.5 Explicit Result Projection

```xml
SELECT
  c.id,
  c.case_no,
  c.status,
  c.created_at
FROM cases c
```

No `SELECT *`.

### 18.6 Safe Dynamic SQL

- `#{}` for values;
- enum whitelist for identifiers;
- `<foreach>` for `IN`;
- no raw CSV;
- no raw where clause;
- no user-provided SQL fragment;
- safe LIKE escaping;
- bounded limit/offset.

---

## 19. Anti-Patterns

### 19.1 `Map<String, Object>` Everywhere

```java
List<Map<String, Object>> search(Map<String, Object> params);
```

Problems:

- no contract;
- no validation;
- no scope guarantee;
- typos silent;
- security review hard;
- result may contain sensitive fields.

### 19.2 Generic Mapper

```java
T findById(Long id);
List<T> findAll();
void deleteById(Long id);
```

This resembles repository convenience but can violate domain security.

### 19.3 Raw SQL Fragment Parameter

```java
List<CaseRow> search(String whereClause);
```

Never accept raw SQL from upper layer.

### 19.4 Authorization After Listing

Buruk:

```java
List<CaseRow> all = mapper.search(criteria);
return all.stream()
    .filter(row -> auth.canView(actor, row))
    .toList();
```

Ini bisa:

- bocor via timing/size;
- boros memory;
- salah pagination;
- data sudah terambil;
- audit tidak jelas.

Filter visibility di SQL untuk listing.

### 19.5 Ignoring DML Row Count

```java
mapper.updateStatus(command);
return success();
```

Jika affected rows `0`, bisa berarti unauthorized/stale/not found. Jangan diabaikan.

### 19.6 Shared ResultMap Berisi Field Sensitif

Shared `userMap` berisi password hash lalu dipakai query public.

Pisahkan resultMap per use case.

---

## 20. Testing Security Mapper

Security mapper harus diuji, bukan hanya direview manual.

### 20.1 SQL Injection Test

Untuk setiap dynamic input:

- keyword;
- sort field;
- sort direction;
- status list;
- table target;
- search field.

Test payload:

```text
' OR '1'='1
x%' OR 1=1 --
created_at desc; drop table cases; --
1) OR 1=1 --
```

Harapan:

- input ditolak di validation; atau
- treated as value, bukan SQL; atau
- mapped to safe default.

### 20.2 Tenant Isolation Test

Dataset:

```text
tenant A: case 100
tenant B: case 100 or 200
```

Test:

```java
CaseDetail result = mapper.findVisibleCaseDetail(queryForTenantA_caseFromTenantB);
assertNull(result);
```

Untuk update:

```java
int affected = mapper.closeCase(commandTenantA_targetTenantB);
assertEquals(0, affected);
```

### 20.3 Authorization Matrix Test

Matrix:

```text
actor owner      -> can view own case
actor non-owner  -> cannot view case
supervisor       -> can view team case
other agency     -> cannot view
admin            -> depends on admin scope
external user    -> only own submission
```

### 20.4 Over-Fetching Test

Pastikan DTO public tidak punya field secret.

```java
assertThat(UserListRow.class.getDeclaredFields())
    .extracting(Field::getName)
    .doesNotContain("passwordHash", "apiToken", "mfaSecret");
```

### 20.5 BoundSql Inspection

Untuk mapper dynamic:

- cek tidak ada raw payload masuk SQL text;
- cek parameter mapping berisi value;
- cek tenant condition ada.

Pseudo-test:

```java
MappedStatement ms = sqlSessionFactory
    .getConfiguration()
    .getMappedStatement("CaseMapper.searchVisibleCases");

BoundSql boundSql = ms.getBoundSql(criteria);
String sql = boundSql.getSql();

assertThat(sql).contains("tenant_id");
assertThat(sql).doesNotContain(criteria.getRawKeyword());
```

Hati-hati: untuk LIKE pattern, raw keyword mungkin memang menjadi parameter object, bukan SQL text.

---

## 21. Security Review Checklist untuk Mapper

Gunakan checklist ini saat review PR.

### 21.1 Input and Binding

- Apakah semua value memakai `#{}`?
- Apakah `${}` hanya menerima enum/whitelist internal?
- Apakah tidak ada raw SQL fragment dari request?
- Apakah `IN` clause memakai `foreach` dengan `#{}`?
- Apakah `LIKE` pattern di-escape?
- Apakah limit/offset dibatasi?
- Apakah sort column/direction di-whitelist?

### 21.2 Tenant and Authorization

- Apakah query tenant-owned table selalu memfilter `tenant_id`?
- Apakah agency/module scope masuk jika relevan?
- Apakah listing query menerapkan visibility di SQL?
- Apakah detail query scoped?
- Apakah update/delete scoped?
- Apakah mapper method name mencerminkan visibility?
- Apakah ada generic `findById` yang bisa disalahgunakan?

### 21.3 Data Exposure

- Apakah query tidak memakai `SELECT *`?
- Apakah resultMap hanya memuat field perlu?
- Apakah field sensitif tidak masuk DTO public?
- Apakah log tidak mencetak sensitive parameter?
- Apakah export/report punya authorization lebih kuat?

### 21.4 DML Safety

- Apakah DML return rows affected?
- Apakah caller mengecek affected rows?
- Apakah optimistic lock digunakan jika perlu?
- Apakah status transition guard ada?
- Apakah audit columns diisi?
- Apakah mass operation punya dry-run/count/limit?

### 21.5 Cache and Session

- Apakah second-level cache disabled untuk data sensitive?
- Apakah cache key mencakup tenant/scope jika cache aktif?
- Apakah object result tidak dimutasi berbahaya?

### 21.6 Testing

- Apakah ada test tenant isolation?
- Apakah ada test authorization matrix?
- Apakah ada test injection boundary?
- Apakah ada test DML zero rows?
- Apakah dynamic SQL branch diuji?
- Apakah migration tidak membuka field baru via `SELECT *`?

---

## 22. Mini Case Study: Secure Case Search Mapper

### 22.1 Requirement

Buat listing case untuk officer.

Rules:

- officer hanya melihat case tenant/agency-nya;
- officer melihat case assigned ke dirinya atau team-nya;
- soft-deleted case tidak muncul;
- keyword search pada case number dan subject;
- sorting hanya boleh `caseNo`, `status`, `createdAt`, `updatedAt`;
- max page size 100;
- result tidak boleh berisi confidential note;
- query harus auditable dan testable.

### 22.2 Criteria

```java
public final class OfficerCaseSearchQuery {
    private final String tenantId;
    private final String agencyCode;
    private final long actorUserId;
    private final Set<Long> actorTeamIds;
    private final String keywordPattern;
    private final Set<String> statuses;
    private final CaseSortField sortField;
    private final SortDirection sortDirection;
    private final int limit;
    private final int offset;

    public String getSortExpression() {
        return sortField.sqlExpression();
    }

    public String getSortDirectionSql() {
        return sortDirection.sql();
    }

    // getters
}
```

### 22.3 Mapper Interface

```java
public interface OfficerCaseQueryMapper {
    List<OfficerCaseListRow> searchVisibleCases(OfficerCaseSearchQuery query);
    int countVisibleCases(OfficerCaseSearchQuery query);
}
```

### 22.4 XML

```xml
<mapper namespace="com.example.casequery.OfficerCaseQueryMapper">

  <resultMap id="officerCaseListRowMap" type="com.example.casequery.OfficerCaseListRow">
    <id property="id" column="id"/>
    <result property="caseNo" column="case_no"/>
    <result property="status" column="status"/>
    <result property="subject" column="subject"/>
    <result property="assignedUserId" column="assigned_user_id"/>
    <result property="createdAt" column="created_at"/>
    <result property="updatedAt" column="updated_at"/>
  </resultMap>

  <sql id="visibleCaseWhere">
    c.tenant_id = #{tenantId}
    AND c.agency_code = #{agencyCode}
    AND c.deleted_at IS NULL
    AND (
      c.assigned_user_id = #{actorUserId}
      <if test="actorTeamIds != null and actorTeamIds.size() > 0">
        OR c.team_id IN
        <foreach collection="actorTeamIds" item="teamId" open="(" separator="," close=")">
          #{teamId}
        </foreach>
      </if>
    )

    <if test="statuses != null and statuses.size() > 0">
      AND c.status IN
      <foreach collection="statuses" item="status" open="(" separator="," close=")">
        #{status}
      </foreach>
    </if>

    <if test="keywordPattern != null">
      AND (
        LOWER(c.case_no) LIKE #{keywordPattern} ESCAPE '\'
        OR LOWER(c.subject) LIKE #{keywordPattern} ESCAPE '\'
      )
    </if>
  </sql>

  <select id="searchVisibleCases" resultMap="officerCaseListRowMap">
    SELECT
      c.id,
      c.case_no,
      c.status,
      c.subject,
      c.assigned_user_id,
      c.created_at,
      c.updated_at
    FROM cases c
    WHERE <include refid="visibleCaseWhere"/>
    ORDER BY ${sortExpression} ${sortDirectionSql}, c.id DESC
    LIMIT #{limit}
    OFFSET #{offset}
  </select>

  <select id="countVisibleCases" resultType="int">
    SELECT COUNT(1)
    FROM cases c
    WHERE <include refid="visibleCaseWhere"/>
  </select>

</mapper>
```

Security notes:

- `${sortExpression}` dan `${sortDirectionSql}` hanya aman jika berasal dari enum whitelist;
- tenant/agency mandatory;
- assigned/team visibility di SQL;
- no `SELECT *`;
- no confidential fields;
- keyword escaped;
- limit/offset validated in service;
- count query memakai where fragment yang sama.

### 22.5 Service Validation

```java
public Page<OfficerCaseListRow> search(OfficerCaseSearchRequest request, Actor actor) {
    int limit = Math.min(Math.max(request.limit(), 1), 100);
    int offset = Math.max(request.offset(), 0);

    CaseSortField sortField = CaseSortField.fromApiValueOrDefault(request.sortBy());
    SortDirection direction = SortDirection.fromApiValueOrDefault(request.direction());

    OfficerCaseSearchQuery query = new OfficerCaseSearchQuery(
        actor.tenantId(),
        actor.agencyCode(),
        actor.userId(),
        actor.teamIds(),
        SqlLikeEscaper.containsPattern(request.keyword()),
        normalizeStatuses(request.statuses()),
        sortField,
        direction,
        limit,
        offset
    );

    List<OfficerCaseListRow> rows = mapper.searchVisibleCases(query);
    int total = mapper.countVisibleCases(query);

    return new Page<>(rows, total, limit, offset);
}
```

---

## 23. Mini Case Study: Secure State Transition Update

### 23.1 Requirement

Officer approves a case.

Rules:

- case must belong to tenant/agency;
- actor must be assigned officer;
- current status must be `PENDING_APPROVAL`;
- version must match;
- audit fields updated;
- return conflict/forbidden generically if affected row is 0.

### 23.2 Command

```java
public final class ApproveCaseCommand {
    private final long caseId;
    private final String tenantId;
    private final String agencyCode;
    private final long actorUserId;
    private final long expectedVersion;
    private final String approvalReason;
}
```

### 23.3 Mapper

```xml
<update id="approveAssignedCase">
  UPDATE cases
  SET status = 'APPROVED',
      approved_by = #{actorUserId},
      approved_at = CURRENT_TIMESTAMP,
      approval_reason = #{approvalReason},
      updated_by = #{actorUserId},
      updated_at = CURRENT_TIMESTAMP,
      version = version + 1
  WHERE id = #{caseId}
    AND tenant_id = #{tenantId}
    AND agency_code = #{agencyCode}
    AND assigned_user_id = #{actorUserId}
    AND status = 'PENDING_APPROVAL'
    AND version = #{expectedVersion}
    AND deleted_at IS NULL
</update>
```

### 23.4 Service

```java
int affected = mapper.approveAssignedCase(command);
if (affected != 1) {
    throw new CaseTransitionRejectedException();
}
```

Do not reveal whether failure was because:

- not found;
- wrong tenant;
- wrong actor;
- stale version;
- invalid status.

For audit/internal troubleshooting, log safely with trace id and statement id.

---

## 24. Java 8 sampai Java 25 Considerations

### Java 8

- gunakan POJO immutable manual;
- no records;
- `Optional` boleh untuk service return, tapi hati-hati di DTO/mapper;
- validation manual atau Bean Validation;
- enum whitelist sangat penting.

### Java 11

- similar to Java 8;
- bisa gunakan `String.isBlank()`;
- HTTP/client layer lebih modern, tapi mapper sama.

### Java 17

- records bisa dipakai untuk criteria/DTO jika framework mapping cocok;
- sealed interfaces bisa untuk command hierarchy;
- switch expression berguna untuk whitelist translation;
- Spring Boot 3 baseline.

### Java 21

- virtual threads tidak menghapus kebutuhan connection pool;
- security context propagation harus jelas;
- jangan membuat query blocking tanpa pool control;
- structured concurrency bisa membantu orchestration, tapi mapper tetap transaction-bound.

### Java 25

- gunakan fitur modern secara bertahap;
- tetap jaga source compatibility jika library/module masih Java 8;
- security contract tidak bergantung pada fitur bahasa terbaru.

---

## 25. Production Failure Model

### 25.1 Symptom: User Melihat Data Tenant Lain

Kemungkinan:

- missing tenant filter;
- wrong tenant context;
- cache key tidak scoped;
- join ke table child tidak scoped;
- report query bypass mapper secure;
- admin mapper dipakai di endpoint user.

Immediate action:

- disable endpoint/report;
- inspect query by statement id;
- trace request actor/tenant;
- check cache;
- check recent mapper changes;
- create tenant isolation regression test.

### 25.2 Symptom: SQL Injection Finding dari Pentest

Kemungkinan:

- `${}` dari request;
- raw `orderBy`;
- raw CSV in `IN`;
- unsafe LIKE;
- dynamic table/schema;
- annotation mapper string concatenation.

Action:

- replace value with `#{}`;
- introduce enum whitelist;
- validate API input;
- add malicious payload tests;
- inspect all `${}` usages.

### 25.3 Symptom: Unauthorized Update Berhasil

Kemungkinan:

- update by ID only;
- service authorization bypass;
- mapper reused by another flow;
- missing status/version guard;
- background job using elevated mapper;
- transaction mixing stale auth state.

Action:

- patch DML WHERE clause;
- check affected rows;
- add audit;
- add authorization matrix tests;
- review all update/delete mapper methods.

### 25.4 Symptom: Sensitive Data in Logs

Kemungkinan:

- SQL parameter logging enabled;
- exception contains parameter object `toString()`;
- DTO `toString()` includes fields;
- debug logs in mapper/interceptor;
- audit log stores full object.

Action:

- disable raw SQL parameter logs in production;
- mask sensitive fields;
- remove sensitive fields from `toString()`;
- use structured safe log.

---

## 26. Top 1% Engineer Lens

Engineer biasa bertanya:

```text
Apakah query jalan?
```

Engineer senior bertanya:

```text
Apakah query aman untuk tenant, actor, data sensitivity, concurrency, audit, dan future schema change?
```

Top-tier engineer bertanya lebih jauh:

```text
Apa invariant security yang query ini jaga?
Apa yang terjadi jika mapper dipakai dari service lain?
Apa yang terjadi jika field baru ditambahkan ke table?
Apa yang terjadi jika user mengirim payload malicious?
Apa yang terjadi jika query di-cache?
Apa yang terjadi jika row count 0?
Apa yang terjadi saat rolling deployment?
Bagaimana kita membuktikan query ini tidak bocor antar tenant?
```

Dalam MyBatis, SQL adalah code. Mapper XML adalah code. ResultMap adalah code. SQL fragment adalah code. Semua harus direview dengan standar yang sama seperti Java business logic.

---

## 27. Ringkasan

Security engineering di MyBatis berarti:

1. `#{}` untuk value binding;
2. `${}` hanya untuk whitelist internal;
3. tenant/agency/security scope eksplisit di parameter object;
4. listing query memfilter visibility di SQL;
5. detail query tetap scoped;
6. update/delete wajib scoped dan guarded;
7. rows affected wajib dicek;
8. no `SELECT *`;
9. no raw SQL fragment dari user;
10. safe LIKE escaping;
11. bounded pagination;
12. result projection sesuai use case;
13. second-level cache sangat hati-hati untuk data sensitive;
14. logging harus masked;
15. test tenant isolation, authorization matrix, dan injection boundary;
16. database permission/constraint sebagai defense-in-depth;
17. mapper method naming harus menunjukkan security semantics.

MyBatis aman jika dipakai dengan disiplin. MyBatis berbahaya jika dipakai sebagai string templating engine tanpa governance.

---

## 28. Latihan

### Latihan 1 — Audit `${}` Usage

Ambil satu codebase MyBatis dan cari semua penggunaan `${}`.

Klasifikasikan:

```text
Safe:
  berasal dari enum/whitelist internal

Suspicious:
  berasal dari string service/controller

Unsafe:
  berasal dari request/user input langsung
```

Refactor minimal satu unsafe case.

### Latihan 2 — Tenant Isolation Test

Buat dataset dua tenant.

Test semua mapper detail/list/update penting:

- tenant A tidak bisa read tenant B;
- tenant A tidak bisa update tenant B;
- count query juga scoped;
- child join juga scoped.

### Latihan 3 — Secure Sort Refactor

Refactor endpoint yang menerima `sortBy` string mentah menjadi enum whitelist.

Pastikan payload berikut ditolak atau fallback:

```text
created_at desc; drop table cases; --
status, (select password from users)
1
```

### Latihan 4 — DML Guard Review

Cari semua update/delete mapper.

Pastikan ada:

- tenant/agency scope;
- actor/authorization guard jika perlu;
- status guard;
- version guard jika concurrent;
- audit columns;
- affected rows checked.

---

## 29. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
26-multitenancy-data-partitioning-agency-module-isolation.md
```

Bagian ini akan memperluas security scope menjadi desain multi-tenancy dan data partitioning yang lebih struktural:

- tenant column model;
- schema-per-tenant;
- database-per-tenant;
- agency/module isolation;
- partitioned table;
- tenant context propagation;
- cross-tenant reporting;
- migration dan testing tenant isolation.

Security di Part 25 menjawab: “bagaimana mapper tidak bocor?”  
Part 26 menjawab: “bagaimana desain data model dan persistence layer sejak awal agar isolation menjadi struktur, bukan tambalan?”


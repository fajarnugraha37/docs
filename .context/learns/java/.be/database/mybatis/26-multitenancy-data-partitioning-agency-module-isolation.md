# Part 26 — Multi-Tenancy, Data Partitioning, and Agency/Module Isolation

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `26-multitenancy-data-partitioning-agency-module-isolation.md`  
**Target:** Java 8–25, MyBatis 3.x, MyBatis-Spring, Spring Boot, enterprise multi-module systems

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya, kita sudah membahas:

- statement mapping;
- parameter binding;
- result mapping;
- dynamic SQL;
- transaction;
- performance;
- observability;
- testing;
- schema evolution;
- security engineering.

Part ini membahas satu masalah yang sering tampak seperti “hanya tambah `tenant_id` di `WHERE`”, padahal sebenarnya adalah masalah **data boundary correctness**:

> Bagaimana memastikan aplikasi MyBatis tidak pernah membaca, menulis, mengubah, menghapus, menghitung, meng-cache, mengekspor, atau menampilkan data milik tenant/agency/module yang salah.

Dalam sistem kecil, scope data sering sederhana:

```sql
WHERE tenant_id = #{tenantId}
```

Dalam sistem enterprise/regulatory/case-management, scope data bisa melibatkan:

- tenant;
- agency;
- department;
- branch;
- module;
- role;
- case ownership;
- workflow assignment;
- delegation;
- legal authority;
- effective date;
- data classification;
- record state;
- soft delete;
- archived partition;
- cross-agency reporting exception.

Jadi target part ini bukan sekadar “cara multi-tenancy dengan MyBatis”, tetapi bagaimana mendesain **isolation invariant** yang bisa dipertahankan di codebase besar.

---

## 1. Definisi Dasar

### 1.1 Tenant

Tenant adalah boundary kepemilikan data tertinggi dalam aplikasi multi-tenant.

Contoh:

- satu perusahaan dalam SaaS;
- satu agency dalam government platform;
- satu customer organization;
- satu business unit yang secara hukum harus terisolasi;
- satu region yang datanya tidak boleh tercampur.

Tenant bukan selalu sama dengan user organization. Dalam sistem regulatory, tenant bisa berupa:

```text
platform tenant
  -> agency
      -> department
          -> module jurisdiction
              -> case ownership
```

### 1.2 Agency

Agency biasanya lebih spesifik dari tenant.

Misalnya:

```text
Tenant: GOV
Agency: CEA
Agency: SLA
Agency: ROM
Agency: CPDS
```

Dalam sistem pemerintah, agency bisa punya:

- data sendiri;
- workflow sendiri;
- role sendiri;
- template sendiri;
- report sendiri;
- integration endpoint sendiri;
- retention policy sendiri.

### 1.3 Module Isolation

Module isolation adalah pemisahan data berdasarkan domain/module aplikasi.

Contoh:

```text
Application Management
Case Management
Appeal
Compliance
Correspondence
Exam
Feedback
Revenue
Survey
Audit Trail
```

Module isolation tidak selalu security boundary, tetapi sering menjadi **operational boundary** dan **query boundary**.

Contoh:

```sql
WHERE module_code = #{moduleCode}
```

atau:

```sql
WHERE module_id IN (...) -- modules user can access
```

### 1.4 Partitioning

Partitioning adalah strategi membagi data secara fisik/logis untuk performa, lifecycle, archival, atau manageability.

Partitioning bisa berdasarkan:

- tenant;
- agency;
- module;
- created date;
- status;
- region;
- hash key;
- archival period.

Partitioning tidak otomatis sama dengan security isolation.

> Partitioning membantu database mengelola data; isolation memastikan data boundary tidak dilanggar.

---

## 2. Core Mental Model

Dalam MyBatis, multi-tenancy bukan fitur otomatis bawaan yang “menyelesaikan semua”. MyBatis memberi kontrol penuh atas SQL. Konsekuensinya, isolation juga harus didesain secara eksplisit.

Modelnya:

```text
Request Context
  -> authenticated user
  -> selected tenant/agency/module
  -> authorization grants
  -> data scope

Service Layer
  -> validate operation intent
  -> build scoped command/criteria
  -> call scoped mapper method

Mapper Method
  -> receives tenant/agency/module scope explicitly
  -> statement must include scope predicate
  -> rows affected/result returned must be checked

Database
  -> constraints/indexes/views/RLS optionally reinforce boundary
```

Top-tier MyBatis engineer tidak berpikir:

```text
“Tambahkan tenant_id di WHERE.”
```

Tapi berpikir:

```text
“Di mana invariant tenant enforced?
Bagaimana membuktikan semua read/write/delete/count/export/cache respect tenant?
Bagaimana mencegah future developer lupa scope?
Bagaimana test-nya gagal kalau scope hilang?
Bagaimana observability-nya menunjukkan scope tanpa membocorkan data?”
```

---

## 3. Isolation Invariant

Invariant utama:

> Setiap operasi persistence harus memiliki scope data yang eksplisit, valid, dan tidak bisa di-bypass oleh caller biasa.

Invariant ini berlaku untuk:

- `SELECT`;
- `COUNT`;
- `EXISTS`;
- `INSERT`;
- `UPDATE`;
- `DELETE`;
- `BATCH`;
- `EXPORT`;
- `REPORT`;
- `AUDIT`;
- `CACHE`;
- `STORED PROCEDURE`;
- `MIGRATION/BACKFILL`.

Contoh invariant konkret:

```text
Case with agency_id = CEA must never be visible to SLA users.
Case update must affect only rows within caller agency scope.
Case count must not include hidden agency rows.
Case export must use the same filter semantics as listing query.
Cache key must include agency/tenant scope.
Batch worker must claim jobs only from allowed agency/module.
```

---

## 4. Multi-Tenancy Strategy Taxonomy

Ada beberapa model umum.

### 4.1 Shared Database, Shared Schema, Tenant Column

Semua tenant memakai database dan schema yang sama. Setiap table tenant-aware punya `tenant_id` atau `agency_id`.

```sql
CREATE TABLE case_file (
  id            BIGINT PRIMARY KEY,
  tenant_id     VARCHAR(50) NOT NULL,
  agency_id     VARCHAR(50) NOT NULL,
  case_no       VARCHAR(100) NOT NULL,
  status        VARCHAR(50) NOT NULL,
  created_at    TIMESTAMP NOT NULL
);
```

Query:

```sql
SELECT id, case_no, status
FROM case_file
WHERE tenant_id = #{tenantId}
  AND agency_id = #{agencyId}
  AND id = #{caseId}
```

Kelebihan:

- sederhana secara deployment;
- resource sharing tinggi;
- migration lebih mudah dibanding banyak database;
- cocok untuk banyak tenant kecil/menengah;
- reporting lintas tenant lebih mudah jika diizinkan.

Kekurangan:

- risiko data leakage jika predicate lupa;
- index harus dirancang dengan scope column;
- data besar bisa membuat table sangat besar;
- noisy neighbor lebih sulit dicegah;
- per-tenant backup/restore sulit;
- retention policy per tenant lebih kompleks.

Cocok ketika:

- tenant banyak;
- data per tenant tidak terlalu ekstrem;
- isolation hukum tidak menuntut physical separation;
- tim bisa menjaga SQL governance dengan disiplin.

### 4.2 Shared Database, Schema per Tenant

Satu database, banyak schema.

```text
DB: appdb
  schema cea
    case_file
    appeal
  schema sla
    case_file
    appeal
```

Kelebihan:

- logical separation lebih kuat;
- nama table sama per tenant;
- backup/restore per schema kadang lebih mudah;
- tenant-specific customization lebih mudah.

Kekurangan:

- migration harus jalan ke banyak schema;
- connection/search path/schema routing harus aman;
- dynamic schema name berisiko jika memakai `${}`;
- cross-tenant report lebih kompleks;
- jumlah schema besar menyulitkan operasi.

Cocok ketika:

- tenant tidak terlalu banyak;
- isolation butuh lebih kuat dari tenant column;
- ada per-tenant customization;
- database operation team siap mengelola banyak schema.

### 4.3 Database per Tenant

Setiap tenant punya database sendiri.

```text
cea_db
sla_db
rom_db
```

Kelebihan:

- isolation paling kuat;
- backup/restore per tenant jelas;
- noisy neighbor lebih terkendali;
- per-tenant scaling lebih mudah;
- regulatory isolation lebih kuat.

Kekurangan:

- migration rumit;
- connection pool per tenant bisa mahal;
- operational overhead tinggi;
- cross-tenant reporting sangat kompleks;
- onboarding tenant lebih berat.

Cocok ketika:

- tenant sedikit tetapi besar;
- ada regulatory/legal isolation tinggi;
- per-tenant scaling penting;
- operasi database matang.

### 4.4 Hybrid Model

Sering real system memakai hybrid:

```text
Small tenants       -> shared schema with tenant_id
Large tenant        -> dedicated schema/database
Archive/reporting   -> separate analytical store
Audit               -> central append-only table partitioned by tenant/date
```

Hybrid realistis, tetapi harus punya routing dan ownership rule yang sangat jelas.

---

## 5. Decision Matrix

| Criteria | Tenant Column | Schema per Tenant | Database per Tenant |
|---|---:|---:|---:|
| Deployment simplicity | High | Medium | Low |
| Runtime isolation | Medium | High | Very high |
| SQL leakage risk | High if undisciplined | Medium | Low per DB |
| Migration complexity | Low/Medium | High | Very high |
| Per-tenant backup | Hard | Medium | Easy |
| Cross-tenant reporting | Easy | Medium | Hard |
| Connection pool cost | Low | Medium | High |
| Operational overhead | Low | Medium/High | High |
| Tenant count scalability | High | Medium | Low/Medium |
| Regulatory separation | Medium | High | Very high |

Rule of thumb:

```text
Use tenant column when operational simplicity and shared platform efficiency matter.
Use schema per tenant when logical isolation and tenant customization matter.
Use database per tenant when legal/security/operational isolation dominates.
```

---

## 6. MyBatis Implication per Strategy

### 6.1 Tenant Column Strategy

Mapper must include tenant/agency predicate explicitly.

Bad:

```xml
<select id="findCaseById" resultMap="CaseMap">
  SELECT id, case_no, status, agency_id
  FROM case_file
  WHERE id = #{caseId}
</select>
```

Good:

```xml
<select id="findCaseById" resultMap="CaseMap">
  SELECT id, case_no, status, agency_id
  FROM case_file
  WHERE tenant_id = #{scope.tenantId}
    AND agency_id = #{scope.agencyId}
    AND id = #{caseId}
</select>
```

Better mapper API:

```java
Optional<CaseDetailRow> findCaseById(
    @Param("scope") DataScope scope,
    @Param("caseId") long caseId
);
```

The method name can also express scope:

```java
Optional<CaseDetailRow> findVisibleCaseById(...);
int updateVisibleCaseStatus(...);
boolean existsVisibleCase(...);
```

### 6.2 Schema per Tenant Strategy

Avoid direct user-controlled schema substitution.

Dangerous:

```xml
<select id="findCaseById" resultMap="CaseMap">
  SELECT id, case_no, status
  FROM ${schema}.case_file
  WHERE id = #{caseId}
</select>
```

This can be safe only if `schema` is not arbitrary user input and is resolved from a server-side whitelist.

Safer approach:

```java
public final class TenantSchemaResolver {
    private final Map<String, String> allowedSchemas = Map.of(
        "CEA", "cea_schema",
        "SLA", "sla_schema"
    );

    public String resolveSchema(String agencyId) {
        String schema = allowedSchemas.get(agencyId);
        if (schema == null) {
            throw new IllegalArgumentException("Unsupported agency");
        }
        return schema;
    }
}
```

Then only inject resolved internal schema identifier.

Even then, use review discipline:

```xml
FROM ${resolvedSchema}.case_file
```

`${}` should be rare, isolated, and wrapped in a strict whitelist mechanism.

Alternative:

- separate `SqlSessionFactory` per schema;
- database search path/session initialization;
- dedicated datasource per tenant group;
- views/synonyms.

### 6.3 Database per Tenant Strategy

Mapper SQL may not include tenant column because database routing already isolates tenant.

But service still must know routing context:

```text
TenantContext -> DataSourceRouter -> SqlSessionFactory/TransactionManager -> Mapper
```

Risks:

- wrong datasource routing;
- transaction opened before tenant context set;
- asynchronous execution loses tenant context;
- connection reused with wrong session state;
- migrations not applied consistently across tenant databases.

---

## 7. DataScope Object Pattern

For tenant-column systems, avoid passing many scalar parameters everywhere.

Bad:

```java
List<CaseRow> searchCases(
    @Param("tenantId") String tenantId,
    @Param("agencyId") String agencyId,
    @Param("moduleCode") String moduleCode,
    @Param("userId") String userId,
    @Param("status") String status,
    @Param("keyword") String keyword
);
```

Better:

```java
public final class DataScope {
    private final String tenantId;
    private final String agencyId;
    private final Set<String> moduleCodes;
    private final Set<String> accessibleBranchCodes;
    private final Set<String> accessibleCaseTypes;
    private final boolean crossAgencyReportAllowed;

    // constructor, getters
}
```

Criteria separated from scope:

```java
public final class CaseSearchCriteria {
    private final String keyword;
    private final Set<String> statuses;
    private final LocalDate fromDate;
    private final LocalDate toDateExclusive;
    private final PageRequest page;
    private final SortSpec sort;
}
```

Mapper:

```java
List<CaseRow> searchVisibleCases(
    @Param("scope") DataScope scope,
    @Param("criteria") CaseSearchCriteria criteria
);
```

Why this is better:

- scope is semantically separate from filter;
- easier to audit;
- easier to test;
- easier to enforce all mapper methods receive scope;
- easier to add new scope dimension later;
- prevents mixing user filter with authorization filter.

---

## 8. Scope Is Not Search Criteria

This is a critical distinction.

Search criteria is what user wants to filter.

```text
status = OPEN
createdDate >= 2026-01-01
keyword = "renewal"
```

Scope is what user is allowed to see.

```text
tenant = GOV
agency = CEA
modules = CASE, APPEAL
branches = CENTRAL, EAST
```

Bad mental model:

```text
Scope is just another filter.
```

Correct mental model:

```text
Scope is a mandatory security/correctness boundary.
Filter is optional user intent.
```

Therefore:

- criteria can be optional;
- scope must not be optional;
- missing criteria returns broader allowed data;
- missing scope must be a programming error.

---

## 9. Mapper Naming for Scoped Access

Names should expose scope semantics.

Weak names:

```java
findById(id)
search(criteria)
updateStatus(command)
delete(id)
count(criteria)
```

Stronger names:

```java
findVisibleById(scope, id)
searchVisibleCases(scope, criteria)
countVisibleCases(scope, criteria)
updateVisibleStatus(scope, command)
softDeleteVisibleCase(scope, command)
existsVisibleCase(scope, id)
claimNextVisibleJob(scope, workerId)
```

The word `Visible` is not magic, but it reminds reviewers that the method must enforce scope.

Other possible vocabulary:

```text
Scoped
Authorized
Accessible
Owned
WithinAgency
WithinTenant
ForCurrentAgency
```

Choose one vocabulary per codebase.

---

## 10. SQL Fragment Pattern for Scope Predicate

A shared SQL fragment can reduce accidental omission.

```xml
<sql id="TenantAgencyScopePredicate">
  tenant_id = #{scope.tenantId}
  AND agency_id = #{scope.agencyId}
</sql>
```

Usage:

```xml
<select id="findVisibleById" resultMap="CaseMap">
  SELECT id, case_no, status, agency_id
  FROM case_file
  WHERE <include refid="TenantAgencyScopePredicate" />
    AND id = #{caseId}
</select>
```

However, fragment reuse has limits.

Risks:

- alias mismatch;
- fragment becomes too generic;
- developers include wrong fragment;
- complex query needs table aliases;
- fragment hides important security semantics.

Better alias-aware fragment:

```xml
<sql id="CaseAliasScopePredicate">
  ${alias}.tenant_id = #{scope.tenantId}
  AND ${alias}.agency_id = #{scope.agencyId}
</sql>
```

But `${alias}` needs whitelist discipline. Since aliases are static inside mapper XML, safer is to create explicit fragments:

```xml
<sql id="CaseScopePredicate_c">
  c.tenant_id = #{scope.tenantId}
  AND c.agency_id = #{scope.agencyId}
</sql>

<sql id="CaseScopePredicate_cf">
  cf.tenant_id = #{scope.tenantId}
  AND cf.agency_id = #{scope.agencyId}
</sql>
```

This is repetitive but safer.

---

## 11. SELECT Isolation Pattern

### 11.1 Single-Row Read

Bad:

```xml
<select id="findById" resultMap="CaseMap">
  SELECT id, tenant_id, agency_id, case_no, status
  FROM case_file
  WHERE id = #{caseId}
</select>
```

Good:

```xml
<select id="findVisibleById" resultMap="CaseMap">
  SELECT id, tenant_id, agency_id, case_no, status
  FROM case_file
  WHERE tenant_id = #{scope.tenantId}
    AND agency_id = #{scope.agencyId}
    AND id = #{caseId}
</select>
```

Return:

```java
Optional<CaseDetailRow> findVisibleById(
    @Param("scope") DataScope scope,
    @Param("caseId") long caseId
);
```

If empty, caller should treat as either:

- not found;
- not visible;
- deleted;
- wrong tenant.

In external API, these often collapse into `404` to avoid information disclosure.

### 11.2 Listing Query

```xml
<select id="searchVisibleCases" resultMap="CaseListRowMap">
  SELECT
    c.id,
    c.case_no,
    c.status,
    c.case_type,
    c.created_at,
    c.assigned_officer_id
  FROM case_file c
  WHERE c.tenant_id = #{scope.tenantId}
    AND c.agency_id = #{scope.agencyId}
    AND c.deleted = 0

  <if test="scope.moduleCodes != null and scope.moduleCodes.size() > 0">
    AND c.module_code IN
    <foreach collection="scope.moduleCodes" item="module" open="(" separator="," close=")">
      #{module}
    </foreach>
  </if>

  <if test="criteria.statuses != null and criteria.statuses.size() > 0">
    AND c.status IN
    <foreach collection="criteria.statuses" item="status" open="(" separator="," close=")">
      #{status}
    </foreach>
  </if>

  ORDER BY c.created_at DESC, c.id DESC
  OFFSET #{criteria.page.offset} ROWS FETCH NEXT #{criteria.page.limit} ROWS ONLY
</select>
```

Important:

- scope predicates appear first;
- criteria predicates are optional;
- soft delete predicate is mandatory;
- ordering is deterministic;
- `moduleCodes` empty must be well-defined.

### 11.3 Empty Scope List Semantics

If a user has no accessible modules, what should query do?

Option A: service rejects before mapper.

```java
if (scope.getModuleCodes().isEmpty()) {
    return Page.empty();
}
```

Option B: mapper enforces impossible predicate.

```xml
<choose>
  <when test="scope.moduleCodes != null and scope.moduleCodes.size() > 0">
    AND c.module_code IN
    <foreach collection="scope.moduleCodes" item="module" open="(" separator="," close=")">
      #{module}
    </foreach>
  </when>
  <otherwise>
    AND 1 = 0
  </otherwise>
</choose>
```

For authorization scope, empty usually means **no access**, not “no filter”.

---

## 12. COUNT Isolation Pattern

Every listing query must have matching count semantics.

Bad:

```xml
<select id="countCases" resultType="long">
  SELECT COUNT(*)
  FROM case_file
  WHERE deleted = 0
</select>
```

This leaks total data volume across tenants.

Good:

```xml
<select id="countVisibleCases" resultType="long">
  SELECT COUNT(*)
  FROM case_file c
  WHERE c.tenant_id = #{scope.tenantId}
    AND c.agency_id = #{scope.agencyId}
    AND c.deleted = 0
  <if test="criteria.statuses != null and criteria.statuses.size() > 0">
    AND c.status IN
    <foreach collection="criteria.statuses" item="status" open="(" separator="," close=")">
      #{status}
    </foreach>
  </if>
</select>
```

Count leakage is still leakage.

Examples:

- user cannot see another agency’s cases but can infer they have 9,200 open cases;
- user can infer complaint volume;
- user can infer enforcement workload;
- user can infer existence of sensitive records.

---

## 13. UPDATE Isolation Pattern

Update must include scope predicates, not just id.

Bad:

```xml
<update id="updateStatus">
  UPDATE case_file
  SET status = #{status}, updated_at = #{updatedAt}
  WHERE id = #{caseId}
</update>
```

Good:

```xml
<update id="updateVisibleStatus">
  UPDATE case_file
  SET status = #{command.newStatus},
      updated_by = #{command.actorUserId},
      updated_at = #{command.now}
  WHERE tenant_id = #{scope.tenantId}
    AND agency_id = #{scope.agencyId}
    AND id = #{command.caseId}
    AND status = #{command.expectedCurrentStatus}
    AND version = #{command.expectedVersion}
    AND deleted = 0
</update>
```

Mapper:

```java
int updateVisibleStatus(
    @Param("scope") DataScope scope,
    @Param("command") ChangeCaseStatusCommand command
);
```

Service:

```java
int rows = caseMapper.updateVisibleStatus(scope, command);
if (rows == 0) {
    throw new CaseStateConflictOrNotVisibleException(command.getCaseId());
}
```

Rows affected is the correctness signal.

`0` can mean:

- not found;
- not in scope;
- deleted;
- wrong current status;
- stale version;
- concurrent update.

Externally, you may map these carefully depending on security policy.

---

## 14. DELETE Isolation Pattern

Hard delete:

```xml
<delete id="deleteVisibleCase">
  DELETE FROM case_file
  WHERE tenant_id = #{scope.tenantId}
    AND agency_id = #{scope.agencyId}
    AND id = #{caseId}
</delete>
```

Soft delete:

```xml
<update id="softDeleteVisibleCase">
  UPDATE case_file
  SET deleted = 1,
      deleted_by = #{command.actorUserId},
      deleted_at = #{command.now},
      updated_at = #{command.now}
  WHERE tenant_id = #{scope.tenantId}
    AND agency_id = #{scope.agencyId}
    AND id = #{command.caseId}
    AND deleted = 0
</update>
```

For most enterprise systems, soft delete is safer because:

- auditability;
- legal retention;
- recovery;
- investigation;
- referential integrity;
- workflow traceability.

But soft delete requires every read query to include visibility predicate:

```sql
AND deleted = 0
```

If some role can see deleted records, the predicate must be explicit and authorized.

---

## 15. INSERT Isolation Pattern

Insert must write correct tenant/agency/module, not trust arbitrary client input.

Bad:

```java
CreateCaseCommand command = request.toCommand();
caseMapper.insert(command); // command contains agencyId from request body
```

Good:

```java
CreateCaseCommand command = CreateCaseCommand.fromRequest(request, actor, scope);
caseMapper.insertCase(scope, command);
```

SQL:

```xml
<insert id="insertCase" useGeneratedKeys="true" keyProperty="command.id">
  INSERT INTO case_file (
    tenant_id,
    agency_id,
    module_code,
    case_no,
    status,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    #{scope.tenantId},
    #{scope.agencyId},
    #{command.moduleCode},
    #{command.caseNo},
    #{command.initialStatus},
    #{command.actorUserId},
    #{command.now},
    #{command.now}
  )
</insert>
```

Rule:

> Scope values should come from trusted context, not from client-provided filter/body unless separately validated.

---

## 16. Multi-Tenant Unique Constraints

In tenant-column systems, unique constraints must usually include tenant/agency.

Bad:

```sql
UNIQUE (case_no)
```

This prevents two agencies from using same case number format.

Better:

```sql
UNIQUE (tenant_id, agency_id, case_no)
```

For module-specific uniqueness:

```sql
UNIQUE (tenant_id, agency_id, module_code, business_reference_no)
```

For idempotency key:

```sql
UNIQUE (tenant_id, agency_id, external_system, external_event_id)
```

MyBatis insert:

```xml
<insert id="insertExternalEventIfAbsent">
  INSERT INTO external_event (
    tenant_id,
    agency_id,
    external_system,
    external_event_id,
    payload_hash,
    received_at
  ) VALUES (
    #{scope.tenantId},
    #{scope.agencyId},
    #{event.externalSystem},
    #{event.externalEventId},
    #{event.payloadHash},
    #{event.receivedAt}
  )
</insert>
```

The database constraint enforces concurrency correctness.

---

## 17. Index Design for Tenant-Aware Query

Tenant/agency predicates should influence index design.

Common query:

```sql
WHERE tenant_id = ?
  AND agency_id = ?
  AND status = ?
  AND created_at >= ?
ORDER BY created_at DESC, id DESC
```

Potential index:

```sql
CREATE INDEX idx_case_scope_status_created
ON case_file (tenant_id, agency_id, status, created_at DESC, id DESC);
```

But index order depends on actual workload.

Mental model:

```text
Equality predicates first
  -> tenant_id, agency_id, status
Range/order columns next
  -> created_at, id
Projected columns may be covered if vendor supports/include needed
```

Important:

- tenant/agency columns reduce search space;
- if one tenant is huge, tenant predicate alone is not selective enough;
- composite index must match frequent query shape;
- avoid creating one index per screen blindly;
- report queries may need separate strategy;
- partitioning may reduce scanned data but not replace indexing.

---

## 18. Physical Partitioning Strategy

Partitioning can help large tables.

### 18.1 Partition by Date

Useful for audit/history/event tables.

```text
AUDIT_TRAIL_2025_Q1
AUDIT_TRAIL_2025_Q2
AUDIT_TRAIL_2025_Q3
```

Benefits:

- retention purge easier;
- archival easier;
- query pruning for date range;
- less index maintenance per partition.

Risk:

- queries without date filter scan many partitions;
- recent hot partition can become bottleneck;
- tenant isolation still must be enforced.

### 18.2 Partition by Tenant/Agency

Useful if tenant/agency data distribution is large and predictable.

Benefits:

- query pruning by agency;
- tenant-specific maintenance;
- possible data movement.

Risk:

- too many partitions if agency count large;
- skewed tenants;
- operational complexity;
- cross-tenant report scans many partitions.

### 18.3 Composite Partitioning

Example:

```text
partition by agency
subpartition by month
```

Useful for large regulatory audit/case event workloads.

But complexity rises sharply.

Top-tier rule:

> Partition for lifecycle and predictable pruning, not because “table is big”.

---

## 19. Partitioning Is Not Authorization

This is a common dangerous assumption.

Partitioning helps database locate data. It does not automatically prove user may see it.

Even if table is partitioned by agency:

```sql
SELECT * FROM case_file WHERE id = ?
```

could still find a row from wrong agency unless:

- query includes agency predicate;
- database-level policy prevents it;
- connection/database is isolated;
- view restricts rows.

Therefore:

```text
Partition pruning is performance.
Scope predicate is correctness/security.
```

---

## 20. Row-Level Security and Database Defense-in-Depth

Some databases support row-level security/policies.

PostgreSQL has row security policies that can apply to commands and roles; policies can govern `SELECT`, `INSERT`, `UPDATE`, and `DELETE` behavior.

Potential pattern:

```sql
ALTER TABLE case_file ENABLE ROW LEVEL SECURITY;

CREATE POLICY case_file_agency_policy
ON case_file
USING (agency_id = current_setting('app.agency_id'));
```

Application sets session variable:

```sql
SET LOCAL app.agency_id = 'CEA';
```

With MyBatis/Spring, this must be carefully tied to transaction/connection lifecycle.

Risks:

- connection pool reuses connections;
- session variable not reset;
- transaction boundaries not aligned;
- batch/background jobs need explicit policy context;
- local cache/second-level cache may bypass mental expectation;
- policies can be hard to debug.

Defense-in-depth approach:

```text
Application mapper still includes scope predicate.
Database RLS acts as backstop.
```

Do not rely on invisible database policy as the only place where business visibility is modeled unless the whole organization has strong DB policy governance.

---

## 21. Views as Isolation Boundary

Instead of querying base table directly, mapper can query scoped views.

Example:

```sql
CREATE VIEW visible_case_file AS
SELECT *
FROM case_file
WHERE deleted = 0;
```

For tenant-specific DB user:

```sql
CREATE VIEW cea_case_file AS
SELECT *
FROM case_file
WHERE agency_id = 'CEA';
```

Benefits:

- reduces repeated predicates;
- hides sensitive columns;
- provides stable contract during schema migration;
- can enforce soft-delete visibility.

Risks:

- dynamic user-specific scope is harder;
- view can hide performance issues;
- optimizer behavior varies;
- updates through view may be restricted;
- too many views become governance burden.

Good use cases:

- read-only reporting projections;
- compatibility views during migration;
- sensitive column hiding;
- stable query contract for external reporting.

---

## 22. Module Isolation

Module isolation controls which records belong to which application area.

Example schema:

```sql
CREATE TABLE case_file (
  id BIGINT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  agency_id VARCHAR(50) NOT NULL,
  module_code VARCHAR(50) NOT NULL,
  case_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

Scope:

```java
public final class DataScope {
    private final String tenantId;
    private final String agencyId;
    private final Set<String> moduleCodes;
}
```

Mapper:

```xml
AND c.module_code IN
<foreach collection="scope.moduleCodes" item="module" open="(" separator="," close=")">
  #{module}
</foreach>
```

Important distinction:

- `module_code` can be data classification;
- role module access can be authorization;
- module ownership can drive workflow;
- module partitioning can drive operational routing.

Do not treat module as mere UI filter if it has security meaning.

---

## 23. Agency + Module + Role Matrix

Real visibility often requires a matrix:

| User Role | Agency | Module | Visibility |
|---|---|---|---|
| Case Officer | CEA | CASE | Assigned cases |
| Supervisor | CEA | CASE | Branch cases |
| Admin | CEA | CASE | Agency cases |
| Auditor | GOV | AUDIT | Cross-agency read-only |
| Report User | CEA | REPORT | Aggregated agency report |

This may produce different SQL predicates.

Assigned cases:

```sql
AND c.assigned_officer_id = #{scope.userId}
```

Branch cases:

```sql
AND c.branch_code IN (...)
```

Agency cases:

```sql
AND c.agency_id = #{scope.agencyId}
```

Cross-agency auditor:

```sql
AND c.tenant_id = #{scope.tenantId}
-- no agency_id predicate, only if explicitly allowed
```

This is why `DataScope` may need a richer model than just `tenantId`.

---

## 24. Scope Predicate Builder at Service Layer

Avoid building raw SQL in service.

But you can build semantic scope objects.

```java
public final class VisibilityScope {
    private final String tenantId;
    private final Optional<String> agencyId;
    private final Set<String> moduleCodes;
    private final Optional<String> assignedOfficerId;
    private final Set<String> branchCodes;
    private final boolean crossAgency;
}
```

Mapper XML:

```xml
WHERE c.tenant_id = #{scope.tenantId}

<choose>
  <when test="scope.crossAgency">
    <!-- allowed by service policy; no agency predicate -->
  </when>
  <otherwise>
    AND c.agency_id = #{scope.agencyId}
  </otherwise>
</choose>

<if test="scope.moduleCodes != null and scope.moduleCodes.size() > 0">
  AND c.module_code IN
  <foreach collection="scope.moduleCodes" item="module" open="(" separator="," close=")">
    #{module}
  </foreach>
</if>

<if test="scope.assignedOfficerId != null">
  AND c.assigned_officer_id = #{scope.assignedOfficerId}
</if>
```

Danger:

- if `crossAgency` can be set from request, critical vulnerability;
- if `agencyId` optional becomes missing accidentally, query may broaden;
- if empty module list means no filter, data leak.

Service must construct scope from trusted authorization context.

---

## 25. Do Not Use Generic Admin Bypass Casually

A common anti-pattern:

```xml
<if test="scope.admin == false">
  AND agency_id = #{scope.agencyId}
</if>
```

Problem:

- `admin` is too broad;
- reviewer cannot know which admin;
- accidental admin flag leak exposes everything;
- report/admin/export semantics differ.

Better:

```java
enum ScopeMode {
    AGENCY_ONLY,
    BRANCH_ONLY,
    ASSIGNED_ONLY,
    CROSS_AGENCY_REPORT_READ_ONLY,
    SYSTEM_MAINTENANCE
}
```

Mapper:

```xml
<choose>
  <when test="scope.mode.name() == 'AGENCY_ONLY'">
    AND c.agency_id = #{scope.agencyId}
  </when>
  <when test="scope.mode.name() == 'BRANCH_ONLY'">
    AND c.agency_id = #{scope.agencyId}
    AND c.branch_code IN
    <foreach collection="scope.branchCodes" item="branch" open="(" separator="," close=")">
      #{branch}
    </foreach>
  </when>
  <when test="scope.mode.name() == 'ASSIGNED_ONLY'">
    AND c.agency_id = #{scope.agencyId}
    AND c.assigned_officer_id = #{scope.userId}
  </when>
  <when test="scope.mode.name() == 'CROSS_AGENCY_REPORT_READ_ONLY'">
    AND c.tenant_id = #{scope.tenantId}
  </when>
  <otherwise>
    AND 1 = 0
  </otherwise>
</choose>
```

Even better: separate mapper methods for fundamentally different modes.

---

## 26. Separate Operational Scope From Reporting Scope

Operational screens and reporting screens often have different security rules.

Operational query:

```text
User can see cases they can act on.
```

Report query:

```text
User can see aggregated statistics for cases they may not individually access.
```

Do not reuse operational mapper blindly for reporting, or vice versa.

Example:

```java
List<CaseWorklistRow> searchActionableCases(OperationalScope scope, CaseSearchCriteria criteria);
CaseReportSummary summarizeCases(ReportingScope scope, ReportCriteria criteria);
```

Why:

- reporting may aggregate cross-agency;
- operational may require assignment ownership;
- report may hide PII;
- operational may expose detail fields;
- report may include archived data;
- operational usually excludes archived data.

---

## 27. Shared Lookup Tables

Not every table is tenant-scoped.

Examples:

```text
country_code
currency_code
system_config
module_dimension
status_dictionary
```

But some lookup tables appear shared while actually tenant-specific:

```text
template
email_template
case_type_config
fee_config
workflow_rule
notification_rule
```

Design taxonomy:

| Table Type | Scope | Example |
|---|---|---|
| Global static lookup | none | country, currency |
| Tenant configurable lookup | tenant/agency | case type, template |
| Module lookup | module | status per module |
| Effective-dated config | tenant/agency/date | fee schedule |
| Security config | tenant/role/module | permission matrix |

Mapper naming should reflect this:

```java
List<CountryCodeRow> listCountries();
List<CaseTypeRow> listVisibleCaseTypes(DataScope scope);
Optional<TemplateRow> findAgencyTemplate(DataScope scope, TemplateKey key);
```

---

## 28. Tenant Context Propagation

In synchronous request:

```text
HTTP Request
  -> Authentication
  -> Authorization
  -> DataScope
  -> Service
  -> Mapper
```

In async/background processing:

```text
Message/Event/Job
  -> explicit tenant/agency/module fields
  -> validate against known tenant registry
  -> build DataScope/SystemScope
  -> process
```

Do not rely only on thread-local tenant context for async jobs.

Bad:

```java
TenantContext.getCurrentTenant(); // maybe null or wrong in worker thread
```

Better:

```java
JobPayload {
    tenantId;
    agencyId;
    moduleCode;
    jobId;
}
```

Worker:

```java
DataScope scope = scopeFactory.forSystemJob(job.tenantId(), job.agencyId(), job.moduleCode());
jobMapper.claimVisibleJob(scope, job.id(), workerId);
```

ThreadLocal can be useful for logging/correlation, but explicit mapper parameter is safer for SQL correctness.

---

## 29. MyBatis Interceptor for Tenant Predicate?

Some teams try to implement tenant filter by interceptor that rewrites SQL.

Possible use cases:

- enforce tenant predicate automatically;
- reject SQL without tenant predicate;
- inject session variable;
- add metrics tags.

But SQL rewriting is dangerous.

Risks:

- parser cannot handle all vendor SQL;
- subqueries/CTEs/join aliases are hard;
- stored procedures not covered;
- dynamic SQL shape varies;
- batch update behavior unexpected;
- hard debugging;
- false sense of security.

Better use interceptor as guardrail, not primary enforcement.

Example guardrail:

```text
If mapper namespace is tenant-scoped and SQL lacks tenant_id/agency_id predicate, fail in test/non-prod.
```

This is safer than auto-rewriting.

Recommended hierarchy:

```text
1. Explicit mapper parameters and SQL predicates
2. Mapper method naming convention
3. Tests that verify scope predicates
4. Optional interceptor/static analysis as guardrail
5. Database RLS/views/permissions as defense-in-depth
```

---

## 30. Static Analysis and Mapper Governance

In large systems, manual review alone is not enough.

Potential checks:

```text
For every mapper under *.case.*:
  SELECT/UPDATE/DELETE must reference tenant_id and agency_id unless annotated as @GlobalLookupMapper.

For every method named searchVisible*:
  first parameter must be DataScope.

For every XML statement touching case_file:
  WHERE must include scope predicate fragment.

For every cache-enabled mapper:
  cache key must include tenant/agency scope.
```

Implementation options:

- code review checklist;
- grep/static script;
- XML parser test;
- MyBatis Configuration inspection;
- `BoundSql` inspection tests;
- ArchUnit rule for Java mapper interface;
- build plugin/custom lint.

Example test idea:

```java
@Test
void allCaseMapperSelectsContainTenantPredicate() {
    Configuration configuration = sqlSessionFactory.getConfiguration();

    for (MappedStatement ms : configuration.getMappedStatements()) {
        if (ms.getId().contains("CaseMapper") && ms.getSqlCommandType() != SqlCommandType.INSERT) {
            BoundSql boundSql = ms.getBoundSql(sampleParameterObject());
            String sql = normalize(boundSql.getSql());
            assertThat(sql).contains("tenant_id");
            assertThat(sql).contains("agency_id");
        }
    }
}
```

This test must be designed carefully because dynamic SQL may need sample parameter objects.

---

## 31. Cache Isolation

If using MyBatis second-level cache or application cache, tenant/agency/module must be part of cache key.

Dangerous cache key:

```text
case:id:123
```

Safe cache key:

```text
tenant:GOV:agency:CEA:case:id:123
```

But if primary key is globally unique, is tenant key still needed?

Often yes, because:

- it documents boundary;
- it prevents future migration bugs;
- it avoids collision if id generation changes;
- it separates visibility semantics;
- it prevents cross-scope cached projections.

For list cache:

```text
case-search:{tenantId}:{agencyId}:{moduleCodes}:{criteriaHash}:{page}:{sort}
```

But caching search results is risky because:

- invalidation is hard;
- scope can be complex;
- result may include sensitive fields;
- stale authorization data can leak;
- large key cardinality.

Prefer caching stable lookup/config data, not highly dynamic scoped worklists.

---

## 32. Audit Trail Isolation

Audit trail is tricky.

Audit records may need to be:

- scoped to tenant/agency for normal users;
- cross-agency for auditors;
- immutable;
- searchable;
- partitioned by date;
- linked to module;
- retention-aware;
- safe from PII leakage in logs.

Audit table example:

```sql
CREATE TABLE audit_trail (
  id BIGINT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  agency_id VARCHAR(50) NOT NULL,
  module_code VARCHAR(50) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  activity VARCHAR(100) NOT NULL,
  actor_user_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  metadata CLOB
);
```

Scoped query:

```xml
<select id="searchVisibleAuditTrail" resultMap="AuditRowMap">
  SELECT id, module_code, entity_type, entity_id, activity, actor_user_id, created_at
  FROM audit_trail a
  WHERE a.tenant_id = #{scope.tenantId}
    AND a.agency_id = #{scope.agencyId}
    AND a.created_at &gt;= #{criteria.from}
    AND a.created_at &lt; #{criteria.toExclusive}
  ORDER BY a.created_at DESC, a.id DESC
</select>
```

Cross-agency auditor query should be separate:

```java
List<AuditRow> searchCrossAgencyAudit(CrossAgencyAuditScope scope, AuditCriteria criteria);
```

Do not use `if admin then omit agency filter` hidden inside same method unless governance is very strong.

---

## 33. Cross-Tenant Reporting

Cross-tenant reporting is often legitimate.

But it must be designed as a distinct capability.

Questions:

- who is allowed?
- detail or aggregate only?
- are PII fields masked?
- can user drill down?
- does report include archived data?
- does report include deleted records?
- is agency dimension shown?
- does query need all tenants or selected tenants?
- how is audit logged?

Report scope example:

```java
public final class CrossAgencyReportScope {
    private final String tenantId;
    private final Set<String> agencyIds;
    private final boolean piiAllowed;
    private final String actorUserId;
}
```

Aggregate report SQL:

```xml
<select id="summarizeCasesByAgency" resultMap="AgencyCaseSummaryMap">
  SELECT
    c.agency_id,
    c.status,
    COUNT(*) AS case_count
  FROM case_file c
  WHERE c.tenant_id = #{scope.tenantId}
    AND c.agency_id IN
    <foreach collection="scope.agencyIds" item="agency" open="(" separator="," close=")">
      #{agency}
    </foreach>
    AND c.created_at &gt;= #{criteria.from}
    AND c.created_at &lt; #{criteria.toExclusive}
  GROUP BY c.agency_id, c.status
</select>
```

This is explicit and auditable.

---

## 34. Background Jobs and Worker Isolation

Worker jobs frequently cause isolation bugs because they bypass HTTP authorization path.

Bad worker query:

```xml
<select id="findPendingJobs" resultMap="JobMap">
  SELECT * FROM job_queue
  WHERE status = 'PENDING'
  ORDER BY created_at
</select>
```

Better:

```xml
<select id="findPendingJobsForAgency" resultMap="JobMap">
  SELECT id, tenant_id, agency_id, module_code, payload, status, created_at
  FROM job_queue
  WHERE tenant_id = #{scope.tenantId}
    AND agency_id = #{scope.agencyId}
    AND module_code = #{scope.moduleCode}
    AND status = 'PENDING'
  ORDER BY created_at
</select>
```

Claim pattern:

```xml
<update id="claimNextJob">
  UPDATE job_queue
  SET status = 'PROCESSING',
      worker_id = #{workerId},
      claimed_at = #{now}
  WHERE id = (
    SELECT id
    FROM job_queue
    WHERE tenant_id = #{scope.tenantId}
      AND agency_id = #{scope.agencyId}
      AND module_code = #{scope.moduleCode}
      AND status = 'PENDING'
    ORDER BY created_at
    FETCH FIRST 1 ROW ONLY
  )
</update>
```

Vendor-specific locking may be needed:

```sql
FOR UPDATE SKIP LOCKED
```

But scope predicate remains mandatory.

---

## 35. Multi-Datasource Routing

For schema/database per tenant, a router may choose datasource.

Spring pattern:

```java
public final class TenantRoutingDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        return TenantContext.currentTenantKey();
    }
}
```

Risks:

- tenant context set too late;
- `@Transactional` opens connection before context exists;
- async method loses context;
- scheduled job runs with default tenant;
- nested transactions use wrong datasource;
- connection pool metrics not tagged by tenant;
- too many pools cause resource exhaustion.

Safer for critical operations:

- explicit service entrypoint sets tenant context before transaction;
- no fallback default datasource for tenant-specific operations;
- fail fast if tenant context missing;
- separate transaction managers if needed;
- integration tests verify routing.

Example service boundary:

```java
public CaseDetail getCase(TenantKey tenantKey, long caseId) {
    return tenantContext.runWith(tenantKey, () -> transactionalCaseService.getCase(caseId));
}
```

Be careful: if transaction starts before `runWith`, routing may already be decided.

---

## 36. Multi-Tenant Migration Strategy

Tenant-column model:

```text
One migration path for shared schema.
```

Schema-per-tenant model:

```text
Run migration for every tenant schema.
Track version per schema.
Handle partial migration failure.
```

Database-per-tenant model:

```text
Run migration per database.
Need tenant registry.
Need retry/resume.
Need operational dashboard.
```

Important design:

```sql
tenant_registry (
  tenant_id,
  agency_id,
  schema_name,
  datasource_key,
  migration_status,
  current_schema_version,
  enabled
)
```

Migration failure model:

- tenant A migrated;
- tenant B failed;
- app version expects new column;
- tenant B requests fail.

Mitigation:

- expand-migrate-contract;
- feature flags per tenant;
- compatibility views;
- backward-compatible mapper;
- migration readiness check before enabling tenant.

---

## 37. Archival and Data Lifecycle

Multi-tenant systems often need different retention rules.

Example:

```text
CEA case: retain 7 years
SLA case: retain 10 years
Audit trail: retain 12 years
Survey: retain 3 years
```

Mapper implications:

- active table vs archive table;
- partitioned by created date;
- archived records may be hidden from operational screens;
- reports may include archive;
- case detail may need union active+archive;
- legal hold may block purge.

Example archive-aware query:

```xml
<select id="findVisibleCaseInActiveOrArchive" resultMap="CaseMap">
  SELECT id, case_no, status, created_at, 'ACTIVE' AS source_type
  FROM case_file
  WHERE tenant_id = #{scope.tenantId}
    AND agency_id = #{scope.agencyId}
    AND id = #{caseId}

  UNION ALL

  SELECT id, case_no, status, created_at, 'ARCHIVE' AS source_type
  FROM case_file_archive
  WHERE tenant_id = #{scope.tenantId}
    AND agency_id = #{scope.agencyId}
    AND id = #{caseId}
</select>
```

This must still respect scope.

---

## 38. Testing Tenant Isolation

Testing should prove leakage does not happen.

### 38.1 Seed Data

Create data for multiple tenants/agencies:

```text
GOV / CEA / case 1001
GOV / SLA / case 2001
GOV / ROM / case 3001
PRIVATE / ACME / case 4001
```

### 38.2 Read Test

```java
@Test
void ceaUserCannotReadSlaCase() {
    DataScope ceaScope = scope("GOV", "CEA");

    Optional<CaseDetailRow> row = mapper.findVisibleById(ceaScope, slaCaseId);

    assertThat(row).isEmpty();
}
```

### 38.3 Update Test

```java
@Test
void ceaUserCannotUpdateSlaCase() {
    DataScope ceaScope = scope("GOV", "CEA");
    ChangeCaseStatusCommand command = commandFor(slaCaseId);

    int rows = mapper.updateVisibleStatus(ceaScope, command);

    assertThat(rows).isZero();
    assertThat(mapper.findVisibleById(scope("GOV", "SLA"), slaCaseId))
        .hasValueSatisfying(row -> assertThat(row.status()).isEqualTo("OPEN"));
}
```

### 38.4 Count Test

```java
@Test
void countOnlyIncludesVisibleAgency() {
    long count = mapper.countVisibleCases(scope("GOV", "CEA"), emptyCriteria());

    assertThat(count).isEqualTo(numberOfCeaCasesOnly);
}
```

### 38.5 Export Test

Export queries are often forgotten.

```java
@Test
void exportOnlyIncludesVisibleRows() {
    List<CaseExportRow> rows = exportMapper.exportVisibleCases(scope("GOV", "CEA"), criteria);

    assertThat(rows).allMatch(row -> row.agencyId().equals("CEA"));
}
```

---

## 39. BoundSql-Based Predicate Tests

For dynamic SQL, test generated SQL.

```java
@Test
void searchVisibleCasesContainsScopePredicates() {
    MappedStatement ms = configuration.getMappedStatement(
        "com.example.case.CaseMapper.searchVisibleCases"
    );

    Map<String, Object> params = new HashMap<>();
    params.put("scope", sampleScope());
    params.put("criteria", sampleCriteria());

    BoundSql boundSql = ms.getBoundSql(params);
    String sql = normalize(boundSql.getSql());

    assertThat(sql).contains("tenant_id");
    assertThat(sql).contains("agency_id");
}
```

This does not replace data-level tests, but catches missing predicates earlier.

---

## 40. Production Observability for Isolation

Log safely:

```text
mapper=CaseMapper.searchVisibleCases
scope.tenant=GOV
scope.agency=CEA
scope.mode=AGENCY_ONLY
criteria.statusCount=3
rows=25
durationMs=41
correlationId=...
```

Do not log:

- raw PII;
- full free-text search;
- full SQL with sensitive parameters;
- entire payload CLOB;
- unmasked identifiers if policy forbids.

Metrics dimensions:

```text
mapper_id
scope_mode
agency? maybe controlled cardinality
module_code
result_count_bucket
duration_bucket
```

High-cardinality dimensions like user id, case id, full tenant id may be harmful in metrics systems.

---

## 41. Common Failure Modes

### 41.1 Missing Scope Predicate

Symptom:

- user sees wrong agency data;
- count mismatch;
- export leaks rows.

Cause:

- mapper query missing `agency_id`;
- shared fragment not included;
- admin query reused for normal user.

Prevention:

- scoped method naming;
- tests;
- SQL review;
- static checks.

### 41.2 Scope Predicate in SELECT but Missing in UPDATE

Symptom:

- user cannot view record but can update it if id guessed.

Cause:

- update by primary key only.

Prevention:

- every update/delete includes scope;
- rows affected check.

### 41.3 Count Query Leaks

Symptom:

- list shows 10 rows but total says 10,000.

Cause:

- count query missing tenant filter.

Prevention:

- pair listing/count tests.

### 41.4 Cache Leakage

Symptom:

- user sees cached projection from another agency.

Cause:

- cache key missing scope;
- second-level cache on scoped mapper;
- object reused/mutated.

Prevention:

- avoid MyBatis L2 cache for scoped data;
- include scope in app cache keys;
- test cache behavior.

### 41.5 Background Job Cross-Tenant Processing

Symptom:

- worker processes wrong agency jobs.

Cause:

- job query global;
- tenant context missing;
- default datasource fallback.

Prevention:

- tenant/agency in job payload;
- scoped claim query;
- no default fallback.

### 41.6 Cross-Agency Report Reused as Detail Query

Symptom:

- user drills into unauthorized details.

Cause:

- report aggregate scope reused for detail endpoint.

Prevention:

- separate reporting mapper/scope from operational mapper/scope.

### 41.7 Schema Routing Wrong

Symptom:

- request for tenant A reads tenant B schema.

Cause:

- tenant context set after transaction starts;
- thread-local not propagated;
- connection state not reset.

Prevention:

- explicit routing boundary;
- fail if context missing;
- integration tests.

---

## 42. Mini Case Study — Regulatory Case Management

### 42.1 Requirements

System has:

```text
Tenant: GOV
Agencies: CEA, SLA, ROM
Modules: CASE, APPEAL, COMPLIANCE, EXAM
Roles:
  - Officer: assigned cases only
  - Supervisor: branch cases
  - Agency Admin: all agency cases
  - Central Auditor: cross-agency audit read-only
```

### 42.2 Scope Model

```java
public enum CaseVisibilityMode {
    ASSIGNED_ONLY,
    BRANCH_ONLY,
    AGENCY_ONLY,
    CROSS_AGENCY_AUDIT_READ_ONLY
}
```

```java
public final class CaseVisibilityScope {
    private final String tenantId;
    private final String agencyId;
    private final Set<String> agencyIds;
    private final Set<String> moduleCodes;
    private final String userId;
    private final Set<String> branchCodes;
    private final CaseVisibilityMode mode;

    // constructors/getters
}
```

### 42.3 Mapper Method

```java
List<CaseListRow> searchVisibleCases(
    @Param("scope") CaseVisibilityScope scope,
    @Param("criteria") CaseSearchCriteria criteria
);

long countVisibleCases(
    @Param("scope") CaseVisibilityScope scope,
    @Param("criteria") CaseSearchCriteria criteria
);

int transitionVisibleCase(
    @Param("scope") CaseVisibilityScope scope,
    @Param("command") CaseTransitionCommand command
);
```

### 42.4 XML Scope Fragment

```xml
<sql id="CaseVisibilityPredicate">
  c.tenant_id = #{scope.tenantId}

  <choose>
    <when test="scope.mode.name() == 'ASSIGNED_ONLY'">
      AND c.agency_id = #{scope.agencyId}
      AND c.assigned_officer_id = #{scope.userId}
    </when>

    <when test="scope.mode.name() == 'BRANCH_ONLY'">
      AND c.agency_id = #{scope.agencyId}
      AND c.branch_code IN
      <foreach collection="scope.branchCodes" item="branch" open="(" separator="," close=")">
        #{branch}
      </foreach>
    </when>

    <when test="scope.mode.name() == 'AGENCY_ONLY'">
      AND c.agency_id = #{scope.agencyId}
    </when>

    <when test="scope.mode.name() == 'CROSS_AGENCY_AUDIT_READ_ONLY'">
      AND c.agency_id IN
      <foreach collection="scope.agencyIds" item="agency" open="(" separator="," close=")">
        #{agency}
      </foreach>
    </when>

    <otherwise>
      AND 1 = 0
    </otherwise>
  </choose>

  <choose>
    <when test="scope.moduleCodes != null and scope.moduleCodes.size() > 0">
      AND c.module_code IN
      <foreach collection="scope.moduleCodes" item="module" open="(" separator="," close=")">
        #{module}
      </foreach>
    </when>
    <otherwise>
      AND 1 = 0
    </otherwise>
  </choose>
</sql>
```

### 42.5 Search Query

```xml
<select id="searchVisibleCases" resultMap="CaseListRowMap">
  SELECT
    c.id,
    c.case_no,
    c.module_code,
    c.case_type,
    c.status,
    c.created_at,
    c.assigned_officer_id,
    c.branch_code
  FROM case_file c
  WHERE <include refid="CaseVisibilityPredicate" />
    AND c.deleted = 0

  <if test="criteria.statuses != null and criteria.statuses.size() > 0">
    AND c.status IN
    <foreach collection="criteria.statuses" item="status" open="(" separator="," close=")">
      #{status}
    </foreach>
  </if>

  <if test="criteria.createdFrom != null">
    AND c.created_at &gt;= #{criteria.createdFrom}
  </if>

  <if test="criteria.createdToExclusive != null">
    AND c.created_at &lt; #{criteria.createdToExclusive}
  </if>

  ORDER BY c.created_at DESC, c.id DESC
  OFFSET #{criteria.page.offset} ROWS FETCH NEXT #{criteria.page.limit} ROWS ONLY
</select>
```

### 42.6 State Transition Query

For write operation, do **not** allow cross-agency audit scope.

Use different `OperationalCaseScope`, or enforce in service.

```xml
<update id="transitionVisibleCase">
  UPDATE case_file c
  SET c.status = #{command.newStatus},
      c.version = c.version + 1,
      c.updated_by = #{command.actorUserId},
      c.updated_at = #{command.now}
  WHERE c.tenant_id = #{scope.tenantId}
    AND c.agency_id = #{scope.agencyId}
    AND c.id = #{command.caseId}
    AND c.status = #{command.expectedStatus}
    AND c.version = #{command.expectedVersion}
    AND c.deleted = 0
</update>
```

Notice:

- no cross-agency mode;
- no assigned/branch dynamic omitted unless operation allows it;
- write scope should be stricter than read scope.

---

## 43. MyBatis Dynamic SQL Consideration

With MyBatis Dynamic SQL, scope predicates can be composed in Java.

Pseudo-style:

```java
public WhereApplier visibleCaseScope(CaseVisibilityScope scope) {
    return where -> {
        where.and(tenantId, isEqualTo(scope.getTenantId()));

        switch (scope.getMode()) {
            case AGENCY_ONLY:
                where.and(agencyId, isEqualTo(scope.getAgencyId()));
                break;
            case BRANCH_ONLY:
                where.and(agencyId, isEqualTo(scope.getAgencyId()));
                where.and(branchCode, isIn(scope.getBranchCodes()));
                break;
            case ASSIGNED_ONLY:
                where.and(agencyId, isEqualTo(scope.getAgencyId()));
                where.and(assignedOfficerId, isEqualTo(scope.getUserId()));
                break;
            default:
                where.and(id, isEqualTo(-1L));
        }
    };
}
```

Advantages:

- compile-time column references;
- reusable Java predicate composition;
- easier unit testing of predicate builder;
- less XML branching.

Risks:

- SQL shape hidden in Java builder;
- complex scope logic can become hard to read;
- empty list semantics must be explicit;
- reviewers need Dynamic SQL fluency.

Use it where it improves correctness, not just because it is “type-safe”.

---

## 44. Java 8 to Java 25 Considerations

### Java 8

Use regular immutable classes:

```java
public final class DataScope {
    private final String tenantId;
    private final String agencyId;

    public DataScope(String tenantId, String agencyId) {
        this.tenantId = Objects.requireNonNull(tenantId);
        this.agencyId = Objects.requireNonNull(agencyId);
    }

    public String getTenantId() { return tenantId; }
    public String getAgencyId() { return agencyId; }
}
```

### Java 11

Still mostly POJO-style, but better standard library ergonomics.

### Java 17+

Records can express scope as value object:

```java
public record DataScope(
    String tenantId,
    String agencyId,
    Set<String> moduleCodes
) {
    public DataScope {
        Objects.requireNonNull(tenantId);
        Objects.requireNonNull(agencyId);
        moduleCodes = Set.copyOf(moduleCodes);
    }
}
```

Sealed types can model scope variants:

```java
public sealed interface CaseScope
    permits AssignedCaseScope, BranchCaseScope, AgencyCaseScope, CrossAgencyAuditScope {
    String tenantId();
}
```

### Java 21+

Virtual threads may increase concurrency. That means:

- more simultaneous queries;
- more pressure on DB connection pool;
- tenant context in ThreadLocal still works per virtual thread but must be intentionally propagated;
- do not confuse cheap Java threads with cheap database connections.

### Java 25

Prefer modern value objects and pattern matching where stable in your baseline, but keep mapper XML/SQL governance independent of language novelty.

---

## 45. Production Checklist

Before accepting a multi-tenant MyBatis mapper, ask:

### API Contract

- Does mapper method require scope object?
- Does method name indicate scoped/visible/authorized semantics?
- Are operational and reporting scopes separated?
- Are write methods stricter than read methods?

### SQL

- Does every read include tenant/agency/module scope where required?
- Does every count match listing scope?
- Does every update/delete include scope predicates?
- Does insert write scope values from trusted context?
- Are empty scope lists handled as no access?
- Is dynamic `${}` avoided or whitelisted?

### Security

- Can user infer hidden data via count/report/export?
- Are sensitive fields excluded/masked?
- Is cross-tenant/cross-agency reporting explicit?
- Are cache keys scope-aware?
- Are logs scope-aware but privacy-safe?

### Performance

- Are tenant/agency predicates supported by indexes?
- Does partitioning align with query predicates?
- Are large tenants handled?
- Are report queries separated from operational queries?
- Are archive queries bounded by date/scope?

### Testing

- Is there data from at least two tenants/agencies in tests?
- Does read test prove no cross-scope access?
- Does update test prove rows affected is `0` for wrong scope?
- Does count/export test prove no leakage?
- Are dynamic SQL branches tested?

### Operations

- Are tenant migrations tracked?
- Is datasource/schema routing fail-fast?
- Are background jobs tenant-aware?
- Are incidents diagnosable by mapper id and scope mode?
- Is there a governance rule for scoped tables?

---

## 46. Key Takeaways

1. Multi-tenancy is not just a database layout choice; it is a correctness and security invariant.
2. MyBatis gives explicit SQL control, so isolation must be explicit, tested, and reviewed.
3. Scope is not search criteria. Scope is mandatory authorization/correctness boundary.
4. Every `SELECT`, `COUNT`, `UPDATE`, `DELETE`, `EXPORT`, and background job query must be scoped.
5. `rows affected` is a critical signal for scoped writes.
6. Partitioning helps performance/lifecycle; it does not replace authorization.
7. Database RLS/views can provide defense-in-depth, but mapper-level clarity is still valuable.
8. Operational access and reporting access should use different scope models.
9. Cache, logs, metrics, and exports must respect the same isolation model as normal queries.
10. In large systems, isolation must be enforced by naming, API design, tests, static checks, and operational governance.

---

## 47. What Comes Next

Next part:

```text
27-large-object-large-result-clob-blob-streaming-cursor.md
```

Part 27 will focus on **large object and large result handling**:

- CLOB;
- BLOB;
- audit payload;
- streaming result;
- cursor;
- fetch size;
- export;
- large report;
- memory pressure;
- vendor-specific LOB behavior;
- how to avoid loading millions of rows or huge payload into JVM memory accidentally.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 25 — Security Engineering: SQL Injection, Tenant Isolation, Row-Level Access](./25-security-engineering-sql-injection-tenant-isolation-row-level-access.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 27 — Large Object and Large Result Handling: CLOB, BLOB, Streaming, Cursor](./27-large-object-large-result-clob-blob-streaming-cursor.md)

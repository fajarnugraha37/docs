# Part 32 — Refactoring Legacy MyBatis Systems

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `32-refactoring-legacy-mybatis-systems.md`  
**Target:** Java 8–25, MyBatis 3.x, MyBatis-Spring, Spring Boot integration  
**Prerequisite:** Part 0–31

---

## 1. Tujuan Bagian Ini

Bagian ini membahas cara merefactor sistem MyBatis legacy tanpa merusak production.

Legacy MyBatis biasanya bukan buruk karena MyBatis-nya. Ia memburuk karena kombinasi:

```text
SQL eksplisit
  + requirement berubah terus
  + banyak copy-paste
  + dynamic SQL tumbuh tanpa batas
  + tidak ada mapper test
  + tidak ada naming discipline
  + tidak ada ownership
  + tidak ada observability
  + schema evolution bertahun-tahun
```

Hasilnya:

- XML mapper ribuan baris;
- statement id tidak jelas;
- `SELECT *` tersebar;
- `Map<String,Object>` menjadi parameter dan return type;
- `${}` dipakai untuk sorting/filter;
- duplicate SQL berbeda sedikit;
- tenant filter kadang ada kadang tidak;
- resultMap dipakai lintas query tanpa contract jelas;
- performance bug tersembunyi;
- semua orang takut menyentuh mapper.

Tujuan refactoring bukan membuat kode terlihat modern. Tujuannya:

```text
membuat persistence layer lebih aman, testable, observable, modular, dan evolvable
sambil menjaga behavior production tetap terkendali.
```

---

## 2. Prinsip Utama: Jangan Rewrite Total Tanpa Safety Net

Refactoring legacy mapper tanpa test adalah operasi berisiko tinggi.

Bad approach:

```text
"Mapper ini jelek. Kita rewrite semua XML jadi Dynamic SQL/jOOQ/JPA."
```

Risiko:

- behavior berubah diam-diam;
- query edge case hilang;
- performance plan berubah;
- report angka berbeda;
- scope/security predicate terlewat;
- rollback sulit;
- delivery macet.

Better approach:

```text
1. Inventory
2. Characterization test
3. Observability
4. Risk classification
5. Small refactor with equivalence check
6. Deploy behind safe boundary
7. Monitor
8. Repeat
```

Legacy persistence refactoring harus diperlakukan seperti schema migration: bertahap, reversible, dan evidence-driven.

---

## 3. Apa Itu Characterization Test?

Characterization test adalah test yang menangkap behavior sistem saat ini sebelum kita mengubahnya.

Ia tidak selalu membuktikan behavior benar secara bisnis. Ia membuktikan:

```text
"Sebelum refactor, input X menghasilkan SQL/result Y.
Setelah refactor, behavior tetap sama kecuali perubahan yang memang disengaja."
```

Contoh:

```java
@Test
void legacySearchShouldReturnSameRowsForCommonCriteria() {
    CaseSearchCriteria criteria = new CaseSearchCriteria();
    criteria.setAgencyId("CEA");
    criteria.setStatus("PENDING");
    criteria.setKeyword("licence");

    List<LegacyCaseRow> legacy = legacyMapper.search(criteria);
    List<CaseSearchRow> modern = newMapper.search(criteria);

    assertThat(modern)
        .extracting(CaseSearchRow::caseId)
        .containsExactlyElementsOf(
            legacy.stream().map(LegacyCaseRow::getCaseId).toList()
        );
}
```

Untuk Java 8:

```java
List<Long> legacyIds = legacy.stream()
    .map(LegacyCaseRow::getCaseId)
    .collect(Collectors.toList());
```

---

## 4. Legacy Smell Taxonomy

### 4.1 Mapper XML Terlalu Besar

Smell:

```text
CaseMapper.xml = 5000 lines
contains search, workflow, report, audit, export, dropdown, admin maintenance
```

Masalah:

- ownership kabur;
- statement id sulit ditemukan;
- fragment reuse tidak terkendali;
- change kecil berisiko ke area lain;
- review tidak efektif.

Refactor direction:

```text
CaseCommandMapper
CaseQueryMapper
CaseSearchMapper
CaseReportMapper
CaseAuditMapper
CaseDropdownMapper
```

### 4.2 Generic CRUD Mapper

Smell:

```java
void update(Map<String, Object> params);
List<Map<String, Object>> find(Map<String, Object> params);
```

Masalah:

- contract tidak jelas;
- scope/security mudah hilang;
- type safety hilang;
- test sulit;
- refactor sulit;
- caller bisa memasukkan parameter arbitrary.

Refactor direction:

```java
int updateCaseStatus(UpdateCaseStatusCommand command);
List<CaseSearchRow> searchVisibleCases(CaseSearchCriteria criteria);
```

### 4.3 `Map<String,Object>` Sebagai Parameter

Smell:

```java
List<CaseRow> search(Map<String, Object> params);
```

XML:

```xml
<if test="status != null">
  AND status = #{status}
</if>
<if test="agency != null">
  AND agency_id = #{agency}
</if>
```

Masalah:

- tidak ada autocomplete;
- typo baru ketahuan runtime;
- property rename tidak aman;
- sulit validasi;
- tidak ada distinction required/optional;
- data scope bercampur dengan filter UI.

Refactor direction:

```java
public final class CaseSearchCriteria {
    private final DataScope scope;
    private final Set<CaseStatus> statuses;
    private final String keyword;
    private final LocalDate fromDate;
    private final LocalDate toDateExclusive;
    private final PageRequest page;
    private final CaseSort sort;

    // constructor/getters
}
```

### 4.4 `Map<String,Object>` Sebagai Return Type

Smell:

```java
List<Map<String, Object>> searchCases(CaseSearchCriteria criteria);
```

Masalah:

- caller tahu nama kolom string;
- cast runtime;
- alias berubah mematahkan caller;
- sensitive field bisa terbawa;
- tidak ada contract projection.

Refactor direction:

```java
public final class CaseSearchRow {
    private Long caseId;
    private String referenceNo;
    private CaseStatus status;
    private String agencyName;
    private LocalDateTime submittedAt;
}
```

Untuk Java 17+:

```java
public record CaseSearchRow(
    Long caseId,
    String referenceNo,
    CaseStatus status,
    String agencyName,
    LocalDateTime submittedAt
) {}
```

### 4.5 Unsafe `${}`

Smell:

```xml
ORDER BY ${sortColumn} ${sortDirection}
```

Atau:

```xml
AND ${columnName} = #{value}
```

Masalah:

- SQL injection;
- invalid SQL;
- optimizer plan chaos;
- hard to audit.

Refactor direction:

- enum whitelist;
- remove raw user string;
- use criteria object;
- centralize allowed identifiers.

### 4.6 `SELECT *`

Smell:

```sql
SELECT * FROM cases
```

Masalah:

- schema change memengaruhi result;
- over-fetching;
- column collision pada join;
- sensitive field ikut;
- resultMap tidak eksplisit;
- execution lebih berat.

Refactor direction:

```sql
SELECT
  c.case_id      AS case_id,
  c.reference_no AS reference_no,
  c.status_code  AS status_code
FROM cases c
```

### 4.7 ResultMap Dipakai Terlalu Luas

Smell:

```xml
<resultMap id="CaseMap" type="Case">
  ... 80 columns ...
</resultMap>
```

Dipakai oleh:

- detail;
- listing;
- export;
- report;
- dropdown;
- validation;
- audit.

Masalah:

- query listing harus select banyak kolom;
- perubahan detail memengaruhi report;
- mapping jadi berat;
- hidden coupling.

Refactor direction:

```text
CaseDetailMap
CaseSearchRowMap
CaseReportRowMap
CaseDropdownRowMap
CaseAuditRowMap
```

### 4.8 Dynamic SQL Terlalu Banyak Cabang

Smell:

```xml
<select id="search">
  SELECT ...
  <where>
    50+ <if> tags
    nested choose
    dynamic join
    dynamic group by
    dynamic having
  </where>
</select>
```

Masalah:

- kombinasi branch tidak teruji;
- SQL final sulit diprediksi;
- performance tidak stabil;
- query plan bervariasi ekstrem.

Refactor direction:

- pecah use-case;
- criteria object yang lebih spesifik;
- separate query untuk mode berbeda;
- Dynamic SQL DSL bila branch composition lebih natural di Java;
- reporting query sendiri.

### 4.9 Tenant/Scope Predicate Tidak Konsisten

Smell:

```sql
WHERE case_id = #{caseId}
```

di beberapa mapper, sementara yang lain:

```sql
WHERE case_id = #{caseId}
  AND agency_id = #{agencyId}
```

Masalah:

- data leakage;
- authorization bypass;
- security review sulit.

Refactor direction:

- `DataScope` wajib;
- method naming `findVisible...`;
- SQL fragment `VisibleCaseScopePredicate`;
- static scan;
- BoundSql test;
- optional interceptor guardrail.

### 4.10 No Rows Affected Check

Smell:

```java
mapper.updateStatus(command);
```

Return ignored.

Masalah:

- optimistic lock gagal tapi service menganggap sukses;
- status guard tidak cocok tapi audit/event tetap dikirim;
- tenant scope mismatch tidak terlihat;
- delete/update accidental luas tidak terdeteksi.

Refactor direction:

```java
int updated = mapper.updateStatus(command);
if (updated != 1) {
    throw new StateTransitionRejectedException(...);
}
```

---

## 5. Refactoring Strategy Overview

Urutan aman:

```text
1. Inventory mapper
2. Classify risk
3. Add observability
4. Add characterization tests
5. Introduce typed parameter/return object
6. Split mapper by use-case
7. Replace unsafe dynamic SQL
8. Make resultMap explicit
9. Add scope/security contract
10. Optimize performance-critical queries
11. Deprecate old mapper methods
12. Remove dead SQL
```

Jangan mulai dari estetika. Mulai dari risk.

---

## 6. Step 1 — Mapper Inventory

Buat inventory:

```text
Mapper file:
Namespace:
Number of statements:
Statement ids:
Statement type:
Caller service:
Endpoint/job:
Datasource:
Transaction boundary:
Table touched:
Uses ${}:
Uses SELECT *:
Uses Map param:
Uses Map return:
Has tenant/scope predicate:
Has tests:
Avg latency:
Error history:
Business criticality:
```

Contoh tabel:

| Mapper | Statement | Type | Risk | Reason |
|---|---|---:|---|---|
| CaseMapper | search | SELECT | High | huge dynamic SQL, tenant scope, slow |
| CaseMapper | approve | UPDATE | Critical | state transition, rows ignored |
| ReportMapper | export | SELECT | High | large result, timeout |
| DropdownMapper | listStatus | SELECT | Low | lookup only |

Inventory bisa dibuat manual dulu. Jangan tunggu tooling sempurna.

---

## 7. Step 2 — Risk Classification

Prioritaskan refactor berdasarkan risk, bukan ukuran file.

### Critical

- SQL injection risk;
- tenant/agency leakage;
- destructive update/delete;
- state transition tanpa guard;
- financial/regulatory decision data;
- audit/event consistency.

### High

- slow query high traffic;
- large export causing outage;
- batch job with partial failure;
- dynamic SQL huge branch;
- mapper without tests but frequent changes.

### Medium

- old naming;
- duplicate SQL;
- resultMap too broad;
- minor Map usage internal only.

### Low

- lookup mapper;
- static query;
- rarely changed admin query.

---

## 8. Step 3 — Add Observability Before Refactor

Sebelum mengubah query, pastikan bisa melihat dampaknya.

Minimum:

```text
[ ] statement id logged
[ ] execution time logged/metric
[ ] rows affected logged for important DML
[ ] query count per request available in lower env
[ ] slow SQL threshold configured
[ ] correlation id/MDC connected
```

Contoh metric tags:

```text
mybatis.statement.id = CaseSearchMapper.searchVisibleCases
mybatis.operation = SELECT
mybatis.module = case
mybatis.datasource = oraclePrimary
```

Jangan log parameter raw sensitive.

---

## 9. Step 4 — Characterization Test

### 9.1 Golden Dataset

Buat dataset kecil tapi representatif:

```text
Agency A case visible
Agency B case invisible
Soft-deleted case
Draft case
Pending approval case
Approved case
Case with documents
Case without documents
Case with same reference in different tenant
Case with edge date boundary
```

### 9.2 Test Result Equivalence

Jika membuat mapper baru, bandingkan old vs new:

```java
@Test
void newSearchShouldMatchLegacyForStandardCriteria() {
    CaseSearchCriteria criteria = standardCriteria();

    List<LegacyCaseRow> legacyRows = legacyMapper.search(criteria.toLegacyMap());
    List<CaseSearchRow> newRows = newMapper.searchVisibleCases(criteria);

    assertThat(ids(newRows)).containsExactlyElementsOf(idsFromLegacy(legacyRows));
}
```

### 9.3 Test SQL Shape

```java
@Test
void searchShouldAlwaysContainAgencyPredicate() {
    BoundSql sql = statement("CaseSearchMapper.searchVisibleCases")
        .getBoundSql(criteria);

    assertThat(normalize(sql.getSql()))
        .contains("agency_id = ?");
}
```

### 9.4 Test Negative Scope

```java
@Test
void shouldNotReturnOtherAgencyRows() {
    var criteria = criteriaForAgency("A");

    List<CaseSearchRow> rows = mapper.searchVisibleCases(criteria);

    assertThat(rows).allMatch(row -> row.agencyId().equals("A"));
}
```

---

## 10. Step 5 — Replace `Map<String,Object>` Parameter

### 10.1 Legacy

```java
List<Map<String, Object>> searchCases(Map<String, Object> params);
```

Caller:

```java
Map<String, Object> params = new HashMap<>();
params.put("agency", agencyId);
params.put("status", status);
params.put("keyword", keyword);
params.put("sort", sort);
```

### 10.2 Transitional Adapter

Jangan ubah semua caller sekaligus. Buat adapter.

```java
public final class CaseSearchCriteria {
    private final String agencyId;
    private final String status;
    private final String keyword;
    private final CaseSort sort;

    // constructor/getters

    public Map<String, Object> toLegacyMap() {
        Map<String, Object> map = new HashMap<>();
        map.put("agency", agencyId);
        map.put("status", status);
        map.put("keyword", keyword);
        map.put("sort", sort.legacyValue());
        return map;
    }
}
```

Step awal:

```java
legacyMapper.searchCases(criteria.toLegacyMap());
```

Step berikutnya:

```java
newMapper.searchVisibleCases(criteria);
```

### 10.3 Benefit

- caller mulai type-safe;
- validation masuk criteria;
- raw user sort bisa dihentikan;
- scope menjadi explicit;
- migration bisa bertahap.

---

## 11. Step 6 — Replace `Map<String,Object>` Return

### 11.1 Legacy

```java
List<Map<String, Object>> rows = mapper.searchCases(params);
String ref = (String) rows.get(0).get("REFERENCE_NO");
```

### 11.2 Introduce Projection DTO

Java 8:

```java
public final class CaseSearchRow {
    private Long caseId;
    private String referenceNo;
    private String statusCode;
    private LocalDateTime submittedAt;

    public Long getCaseId() { return caseId; }
    public void setCaseId(Long caseId) { this.caseId = caseId; }

    // getters/setters
}
```

Java 17+:

```java
public record CaseSearchRow(
    Long caseId,
    String referenceNo,
    CaseStatus status,
    LocalDateTime submittedAt
) {}
```

### 11.3 Explicit ResultMap

```xml
<resultMap id="CaseSearchRowMap" type="com.acme.caseapp.CaseSearchRow">
  <id property="caseId" column="case_id"/>
  <result property="referenceNo" column="reference_no"/>
  <result property="status" column="status_code" typeHandler="CaseStatusTypeHandler"/>
  <result property="submittedAt" column="submitted_at"/>
</resultMap>
```

### 11.4 Transitional Converter

Jika caller masih butuh Map:

```java
List<CaseSearchRow> rows = mapper.searchVisibleCases(criteria);
return rows.stream().map(this::toLegacyMap).collect(Collectors.toList());
```

Ini memberi waktu untuk migrasi caller.

---

## 12. Step 7 — Remove Unsafe `${}`

### 12.1 Find All `${}`

Static scan:

```bash
grep -R "\${" src/main/resources/mapper
```

Klasifikasikan:

```text
Allowed with whitelist:
  - order by column from enum
  - order direction from enum
  - database-specific known fragment internal only

Dangerous:
  - user-provided column
  - user-provided table
  - raw filter expression
  - raw search condition
```

### 12.2 Refactor Dynamic Sort

Legacy:

```xml
ORDER BY ${sortColumn} ${sortDirection}
```

Safer Java:

```java
public enum CaseSortColumn {
    CREATED_AT("c.created_at"),
    REFERENCE_NO("c.reference_no"),
    STATUS("c.status_code");

    private final String sql;
    CaseSortColumn(String sql) { this.sql = sql; }
    public String sql() { return sql; }
}

public enum SortDirection {
    ASC("ASC"), DESC("DESC");
    private final String sql;
    SortDirection(String sql) { this.sql = sql; }
    public String sql() { return sql; }
}
```

XML:

```xml
ORDER BY ${sort.column.sql} ${sort.direction.sql}, c.case_id DESC
```

Still `${}`, but controlled by internal enum, not request string.

### 12.3 Refactor Dynamic Filter Column

Bad:

```xml
AND ${filterColumn} = #{filterValue}
```

Better:

```xml
<choose>
  <when test="filterType == 'REFERENCE_NO'">
    AND c.reference_no = #{filterValue}
  </when>
  <when test="filterType == 'STATUS'">
    AND c.status_code = #{filterValue}
  </when>
  <otherwise>
    AND 1 = 0
  </otherwise>
</choose>
```

Better lagi: enum + dedicated typed field.

---

## 13. Step 8 — Replace `SELECT *`

### 13.1 Strategy

Jangan langsung ubah semua `SELECT *`. Mulai dari high-risk query:

- query join;
- query external API response;
- query sensitive table;
- high traffic listing;
- mapper dengan resultMap explicit.

### 13.2 Before

```xml
<select id="findDetail" resultMap="CaseDetailMap">
  SELECT *
  FROM cases c
  JOIN agencies a ON a.agency_id = c.agency_id
  WHERE c.case_id = #{caseId}
</select>
```

### 13.3 After

```xml
<select id="findDetail" resultMap="CaseDetailMap">
  SELECT
    c.case_id          AS case_id,
    c.reference_no     AS reference_no,
    c.status_code      AS status_code,
    c.submitted_at     AS submitted_at,
    a.agency_id        AS agency_id,
    a.name             AS agency_name
  FROM cases c
  JOIN agencies a ON a.agency_id = c.agency_id
  WHERE c.case_id = #{caseId}
</select>
```

### 13.4 Regression Test

```java
@Test
void findDetailShouldMapExpectedFields() {
    CaseDetailRow row = mapper.findDetail(scope, caseId).orElseThrow();

    assertThat(row.getCaseId()).isEqualTo(caseId);
    assertThat(row.getAgency().getAgencyId()).isEqualTo(scope.getAgencyId());
}
```

---

## 14. Step 9 — Split God Mapper

### 14.1 Before

```text
CaseMapper
  - findById
  - search
  - approve
  - reject
  - assign
  - export
  - dashboardStats
  - listDropdown
  - insertAudit
  - archiveOldCases
  - reportByAgency
```

### 14.2 After

```text
CaseCommandMapper
  - insertCase
  - updateCaseDraft
  - approveCase
  - rejectCase
  - assignOfficer

CaseQueryMapper
  - findVisibleCaseById
  - findCaseSummaryById

CaseSearchMapper
  - searchVisibleCases
  - countVisibleCases

CaseReportMapper
  - reportByAgency
  - exportCases

CaseAuditMapper
  - insertAuditEvent
  - findCaseTimeline

CaseLookupMapper
  - listCaseStatuses
  - listCaseTypes
```

### 14.3 Safe Split Technique

Do not move all at once.

1. Create new mapper interface/XML.
2. Copy one statement.
3. Add characterization test old vs new.
4. Change one service caller.
5. Deploy.
6. Mark old statement deprecated.
7. Remove old after no caller remains.

### 14.4 Deprecation Marker

```java
@Deprecated
List<LegacyCaseRow> search(Map<String, Object> params);
```

XML comment:

```xml
<!--
  DEPRECATED: use CaseSearchMapper.searchVisibleCases.
  Do not add new callers.
  Removal target: 2026-Q4.
-->
```

---

## 15. Step 10 — Make Scope Mandatory

### 15.1 Legacy

```java
CaseRow findById(Long caseId);
```

### 15.2 Transitional

```java
@Deprecated
CaseRow findById(Long caseId);

Optional<CaseRow> findVisibleCaseById(
    @Param("scope") DataScope scope,
    @Param("caseId") Long caseId
);
```

### 15.3 Better Command/Criteria Design

```java
public final class DataScope {
    private final String agencyId;
    private final Set<String> allowedModuleCodes;
    private final boolean crossAgencyAllowed;

    // constructor/getters
}
```

Use it everywhere visible data is queried.

### 15.4 SQL Fragment

```xml
<sql id="VisibleCaseScopePredicate">
  c.agency_id = #{scope.agencyId}
  <if test="scope.allowedModuleCodes != null and !scope.allowedModuleCodes.isEmpty()">
    AND c.module_code IN
    <foreach collection="scope.allowedModuleCodes" item="module" open="(" separator="," close=")">
      #{module}
    </foreach>
  </if>
</sql>
```

Use:

```xml
WHERE <include refid="VisibleCaseScopePredicate"/>
  AND c.case_id = #{caseId}
```

### 15.5 Guardrail Test

```java
@Test
void allCaseSearchStatementsShouldContainAgencyPredicate() {
    assertThat(sqlOf("CaseSearchMapper.searchVisibleCases"))
        .contains("agency_id");
}
```

This is not a full proof, but a useful guardrail.

---

## 16. Step 11 — Refactor Dynamic SQL Branches

### 16.1 Split by Query Mode

Legacy single method:

```java
List<CaseRow> search(Map<String, Object> params);
```

Handles:

- normal listing;
- advanced search;
- export;
- dashboard;
- admin cross-agency;
- report.

Refactor:

```java
List<CaseSearchRow> searchVisibleCases(CaseSearchCriteria criteria);
List<CaseExportRow> exportVisibleCases(CaseExportCriteria criteria);
List<CaseReportRow> reportCases(CaseReportCriteria criteria);
DashboardStats getDashboardStats(DashboardCriteria criteria);
```

Each query becomes smaller and testable.

### 16.2 Replace Flag-Driven SQL

Bad:

```xml
<if test="mode == 'DASHBOARD'">...</if>
<if test="mode == 'EXPORT'">...</if>
<if test="mode == 'ADMIN'">...</if>
```

Better:

```text
Different mode = different mapper method.
```

Dynamic SQL is for optional predicates, not for entirely different use-cases.

---

## 17. Step 12 — Introduce ResultMap Discipline

### 17.1 Name by Projection

Bad:

```xml
<resultMap id="BaseResultMap" ...>
```

Better:

```xml
<resultMap id="CaseSearchRowMap" ...>
<resultMap id="CaseDetailRowMap" ...>
<resultMap id="CaseExportRowMap" ...>
```

### 17.2 Column Alias Contract

Every selected column should have stable alias:

```sql
c.created_at AS case_created_at
u.full_name  AS officer_full_name
```

### 17.3 Avoid Over-Reuse

Reuse resultMap only when projection contract truly same.

If listing needs 8 columns and detail needs 60 columns, they are different contracts.

---

## 18. Step 13 — Add TypeHandler for Domain Semantics

Legacy:

```java
private String statusCode;
```

Business logic:

```java
if ("P".equals(row.getStatusCode())) { ... }
```

Refactor:

```java
private CaseStatus status;
```

TypeHandler:

```java
public final class CaseStatusTypeHandler extends BaseTypeHandler<CaseStatus> {
    @Override
    public void setNonNullParameter(
        PreparedStatement ps,
        int i,
        CaseStatus parameter,
        JdbcType jdbcType
    ) throws SQLException {
        ps.setString(i, parameter.code());
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String code = rs.getString(columnName);
        return code == null ? null : CaseStatus.fromCode(code);
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String code = rs.getString(columnIndex);
        return code == null ? null : CaseStatus.fromCode(code);
    }

    @Override
    public CaseStatus getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String code = cs.getString(columnIndex);
        return code == null ? null : CaseStatus.fromCode(code);
    }
}
```

This turns magic strings into domain contracts.

---

## 19. Step 14 — Stabilize DML Contracts

### 19.1 Legacy

```xml
<update id="updateCase">
  UPDATE cases
  SET status_code = #{status}
  WHERE case_id = #{caseId}
</update>
```

Problems:

- no agency scope;
- no state guard;
- no version guard;
- no audit fields;
- caller may ignore rows affected.

### 19.2 Refactored

```xml
<update id="approveCase">
  UPDATE cases
  SET status_code = 'APPROVED',
      version = version + 1,
      approved_by = #{actorUserId},
      approved_at = #{now},
      updated_by = #{actorUserId},
      updated_at = #{now}
  WHERE case_id = #{caseId}
    AND agency_id = #{agencyId}
    AND status_code = 'PENDING_APPROVAL'
    AND version = #{expectedVersion}
</update>
```

Service:

```java
int updated = mapper.approveCase(command);
if (updated != 1) {
    throw new CaseTransitionRejectedException(command.caseId());
}
```

---

## 20. Step 15 — Remove Dead SQL

Legacy systems often keep dead statements forever.

### 20.1 Detection

- code search statement id;
- mapper interface method usage;
- runtime statement metrics;
- access logs;
- coverage report;
- Git history;
- service endpoint mapping.

### 20.2 Safe Removal Process

```text
1. Mark deprecated.
2. Add metric/log warning if called.
3. Wait observation window.
4. Remove caller.
5. Remove mapper method.
6. Remove XML statement.
7. Remove resultMap/fragments if unused.
```

For critical systems, one deployment cycle with warning is safer than immediate deletion.

---

## 21. Step 16 — Performance Refactoring

### 21.1 Before Tuning

Get evidence:

```text
[ ] statement id
[ ] final SQL
[ ] bind parameter summary
[ ] execution plan
[ ] row count
[ ] result size
[ ] frequency
[ ] latency percentiles
[ ] index list
[ ] recent data growth
```

### 21.2 Common Refactors

#### Replace Offset Deep Pagination

Legacy:

```sql
ORDER BY created_at DESC
OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
```

For deep page, use keyset:

```sql
WHERE (created_at < #{lastCreatedAt}
   OR (created_at = #{lastCreatedAt} AND case_id < #{lastCaseId}))
ORDER BY created_at DESC, case_id DESC
FETCH NEXT #{limit} ROWS ONLY
```

#### Split Count Query

Legacy:

```text
same huge join for list and count
```

Better:

```text
list query returns page
count query uses minimal predicates and minimal joins
or use Slice when exact count not required
```

#### Replace Nested Select N+1

Use batch child fetch as discussed in Part 18.

#### Projection-First

Do not load full detail object for listing.

---

## 22. Step 17 — Testing Refactored Mapper

Minimum test categories:

```text
Wiring
[ ] mapper loads
[ ] statement exists
[ ] XML parses

Parameter
[ ] required fields validated
[ ] optional filters work
[ ] empty list semantics defined
[ ] unsafe sort rejected

Result mapping
[ ] all fields mapped
[ ] enum codes mapped
[ ] null columns handled
[ ] alias collision prevented

Security/scope
[ ] other tenant data not returned
[ ] unauthorized row not returned
[ ] update/delete scoped

DML correctness
[ ] rows affected 1 on success
[ ] rows affected 0 on stale version/wrong status
[ ] no accidental multi-row update

Performance shape
[ ] no SELECT *
[ ] no N+1 for listing
[ ] stable order in pagination

Migration compatibility
[ ] works with current schema
[ ] works with expanded schema if migration underway
```

---

## 23. Refactoring with Java 8–25 Compatibility

### 23.1 Java 8 Compatible Style

Use final classes, constructors, getters.

```java
public final class CaseId {
    private final Long value;

    public CaseId(Long value) {
        if (value == null) {
            throw new IllegalArgumentException("caseId is required");
        }
        this.value = value;
    }

    public Long getValue() {
        return value;
    }
}
```

### 23.2 Java 17+ Style

Use records where appropriate.

```java
public record CaseId(Long value) {
    public CaseId {
        if (value == null) {
            throw new IllegalArgumentException("caseId is required");
        }
    }
}
```

### 23.3 Compatibility Rule

If shared module must support Java 8, avoid records/sealed classes in mapper DTO module.

Use records only in Java 17+ services/apps where runtime and source compatibility allow.

### 23.4 Virtual Threads Note

Java 21 virtual threads can improve thread scalability for blocking JDBC workloads, but they do not fix:

- slow SQL;
- unbounded result;
- missing index;
- connection pool limit;
- lock contention;
- N+1 query.

Refactor query shape first.

---

## 24. Legacy XML Refactoring Pattern Example

### 24.1 Before

```xml
<select id="search" parameterType="map" resultType="map">
  SELECT *
  FROM CASES c
  LEFT JOIN USERS u ON u.USER_ID = c.OFFICER_ID
  WHERE 1=1
  <if test="agency != null">
    AND c.AGENCY_ID = #{agency}
  </if>
  <if test="status != null">
    AND c.STATUS_CODE = #{status}
  </if>
  <if test="keyword != null">
    AND (c.REFERENCE_NO LIKE '%${keyword}%' OR c.TITLE LIKE '%${keyword}%')
  </if>
  ORDER BY ${sort} ${dir}
</select>
```

Problems:

```text
[ ] resultType map
[ ] parameterType map
[ ] SELECT *
[ ] keyword injection via ${}
[ ] sort injection
[ ] status is raw string
[ ] agency optional even for normal user
[ ] no stable tie-breaker
[ ] possible over-fetching
```

### 24.2 After

Java criteria:

```java
public final class CaseSearchCriteria {
    private final DataScope scope;
    private final Set<CaseStatus> statuses;
    private final String keywordLike;
    private final CaseSort sort;
    private final int limit;
    private final int offset;

    // constructor/getters
}
```

Mapper:

```java
List<CaseSearchRow> searchVisibleCases(CaseSearchCriteria criteria);
```

XML:

```xml
<resultMap id="CaseSearchRowMap" type="com.acme.caseapp.CaseSearchRow">
  <id property="caseId" column="case_id"/>
  <result property="referenceNo" column="reference_no"/>
  <result property="title" column="title"/>
  <result property="status" column="status_code" typeHandler="CaseStatusTypeHandler"/>
  <result property="officerName" column="officer_name"/>
</resultMap>

<select id="searchVisibleCases" resultMap="CaseSearchRowMap">
  SELECT
    c.case_id      AS case_id,
    c.reference_no AS reference_no,
    c.title        AS title,
    c.status_code  AS status_code,
    u.full_name    AS officer_name
  FROM cases c
  LEFT JOIN users u ON u.user_id = c.officer_id
  <where>
    c.agency_id = #{scope.agencyId}

    <if test="statuses != null and !statuses.isEmpty()">
      AND c.status_code IN
      <foreach collection="statuses" item="status" open="(" separator="," close=")">
        #{status, typeHandler=com.acme.caseapp.CaseStatusTypeHandler}
      </foreach>
    </if>

    <if test="keywordLike != null">
      AND (
        LOWER(c.reference_no) LIKE #{keywordLike} ESCAPE '\\'
        OR LOWER(c.title) LIKE #{keywordLike} ESCAPE '\\'
      )
    </if>
  </where>
  ORDER BY ${sort.column.sql} ${sort.direction.sql}, c.case_id DESC
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

Caveat:

- `${sort.column.sql}` safe only if `sort` is enum-generated internally;
- keyword must be escaped in Java before becoming `keywordLike`;
- vendor pagination may differ.

---

## 25. Refactoring Dynamic SQL to MyBatis Dynamic SQL

Sometimes XML dynamic SQL is still best. Sometimes Java DSL helps.

Use MyBatis Dynamic SQL when:

- many optional predicates composed in Java;
- type-safe column references are valuable;
- query variants are built programmatically;
- XML is unreadable due to branching;
- team is comfortable with DSL.

Keep XML when:

- SQL is vendor-specific and easier to read as SQL;
- query uses complex CTE/window functions;
- DBA review expects raw SQL;
- dynamic part is small;
- resultMap complex nested mapping is easier in XML.

Hybrid is often best:

```text
XML for complex vendor SQL / resultMap
Dynamic SQL for composable search predicates / simple CRUD
```

---

## 26. Refactoring Without Breaking External Behavior

### 26.1 Dual-Read Comparison

For read queries, in non-prod or shadow mode:

```java
List<OldRow> oldRows = oldMapper.search(criteria.toLegacyMap());
List<NewRow> newRows = newMapper.searchVisibleCases(criteria);
compareIdsAndImportantFields(oldRows, newRows);
return newRows;
```

In production, be careful with double query overhead; use sampling if needed.

### 26.2 Feature Flag

```text
case.search.mapper.version = legacy | modern
```

Allows rollback without redeploy if behavior differs.

### 26.3 Shadow Logging

```text
legacy_count=10 modern_count=10 same_ids=true duration_old=80ms duration_new=35ms
```

Do not log sensitive row content.

---

## 27. Governance After Refactor

Refactoring is wasted if old behavior returns.

Add rules:

```text
[ ] New mapper methods require typed parameter or explicit @Param.
[ ] No resultType=map for production endpoint unless justified.
[ ] No SELECT *.
[ ] No raw ${} from request/user input.
[ ] DML must return int and service must check important rows affected.
[ ] Tenant/agency scoped tables require DataScope.
[ ] Dynamic SQL branch must have tests.
[ ] Listing query must have stable ORDER BY.
[ ] Large result query must use pagination/cursor/export job pattern.
[ ] Mapper statement id must be observable.
```

---

## 28. Pull Request Review Checklist

```text
Contract
[ ] Method name expresses cardinality/scope/use-case.
[ ] Parameter object is typed.
[ ] Return type is typed.
[ ] Optional/List/int semantics are correct.

SQL
[ ] No SELECT *.
[ ] Predicates are indexed where needed.
[ ] ORDER BY stable for pagination.
[ ] Empty list behavior defined.
[ ] Date range uses clear inclusive/exclusive semantics.

Security
[ ] No unsafe ${}.
[ ] Tenant/agency/authorization scope included.
[ ] Sensitive columns not over-fetched.
[ ] Logs safe.

Mapping
[ ] Explicit resultMap for joined/important query.
[ ] Column aliases stable.
[ ] Nullable columns mapped to wrapper types.
[ ] Enum/value object mapping explicit.

DML
[ ] WHERE includes key + scope + state/version guard if needed.
[ ] rows affected checked.
[ ] Audit columns handled.

Testing
[ ] Mapper slice/integration test exists.
[ ] Dynamic SQL branches tested.
[ ] Security negative case tested.
[ ] Migration compatibility considered.
```

---

## 29. Common Refactoring Mistakes

### 29.1 Refactoring SQL and Business Semantics Together

Bad:

```text
Change query structure + change status rules + change pagination + change DTO all in one PR.
```

Better:

```text
PR 1: add tests
PR 2: introduce DTO with same SQL
PR 3: replace unsafe sort
PR 4: split mapper
PR 5: optimize query
```

### 29.2 Removing Old Mapper Too Early

Keep fallback until new path is stable.

### 29.3 Ignoring Query Plan

A refactored query may be cleaner but slower.

Always compare execution plan for high-traffic query.

### 29.4 Replacing XML with DSL Just for Modernity

DSL is not automatically better. It changes readability, debugging style, and team workflow.

### 29.5 Trusting H2 Tests for Vendor-Specific SQL

If production is Oracle/PostgreSQL/MySQL/SQL Server, test important mapper against that vendor.

### 29.6 Breaking Report Numbers

Reporting query refactor needs careful equivalence test and business validation.

---

## 30. Mini Refactoring Roadmap for a 50+ Module System

### Phase 1 — Safety Baseline

```text
- mapper inventory
- statement id metrics
- slow query log
- grep unsafe ${}
- list SELECT *
- list resultType=map
- identify destructive DML
```

### Phase 2 — Critical Risk Fix

```text
- tenant/scope leakage candidates
- unsafe ORDER BY/filter
- update/delete without scope
- state transition rows affected ignored
```

### Phase 3 — Test Harness

```text
- @MybatisTest or integration test setup
- vendor-real Testcontainers if possible
- golden dataset
- BoundSql assertion utilities
```

### Phase 4 — Modularization

```text
- split god mapper by use-case
- introduce typed criteria/command/result rows
- deprecate legacy methods
```

### Phase 5 — Performance

```text
- top slow statements
- N+1 removal
- pagination strategy
- index alignment
- large result/export redesign
```

### Phase 6 — Governance

```text
- PR checklist
- static scan rules
- code ownership
- mapper style guide
- periodic dead SQL cleanup
```

---

## 31. Case Study: Refactoring Legacy Case Search

### Context

A regulatory case management system has a legacy `CaseMapper.search` used by:

- normal case listing;
- admin search;
- dashboard;
- Excel export;
- audit investigation;
- officer assignment screen.

Symptoms:

```text
- intermittent slow query
- users occasionally see unexpected rows
- mapper XML hard to understand
- search uses Map parameter
- sort uses raw ${}
- resultType=map
- no tests
```

### Step 1 — Inventory

Find callers:

```text
CaseController.search
AdminCaseController.search
DashboardService.loadCases
CaseExportJob.export
AuditInvestigationService.searchCases
AssignmentService.findAssignableCases
```

### Step 2 — Split Use-Cases

```text
CaseSearchMapper.searchVisibleCases
AdminCaseSearchMapper.searchCasesForAdmin
CaseDashboardMapper.findDashboardCases
CaseExportMapper.exportVisibleCases
AuditCaseSearchMapper.searchForInvestigation
AssignmentMapper.findAssignableCases
```

### Step 3 — Add DataScope

Normal search requires:

```text
agencyId
allowedModuleCodes
allowedCaseTypes
```

Admin search may have broader scope but must be explicit:

```java
AdminDataScope.crossAgency(...)
```

### Step 4 — Replace Sort

Raw request:

```text
sort=createdAt&dir=desc
```

Converted at boundary:

```java
CaseSort sort = CaseSort.fromRequest(sortField, direction);
```

Only enum reaches mapper.

### Step 5 — Typed Projection

```java
CaseSearchRow
CaseExportRow
DashboardCaseRow
```

Each query selects only needed columns.

### Step 6 — Regression Dataset

```text
Agency A visible rows
Agency B invisible rows
Soft-deleted rows
Rows with same created_at
Rows with same reference in different agency
Rows with null officer
Rows with documents
Rows without documents
```

### Step 7 — Equivalence Tests

For normal criteria, compare IDs old vs new.

For security criteria, assert new behavior intentionally stricter.

### Step 8 — Deploy with Feature Flag

```text
case.search.mapper=legacy|modern
```

Monitor:

```text
latency
row count
error rate
DB CPU
query count
support tickets
```

### Outcome

Good refactor outcome is not only cleaner code:

```text
- search scope explicit
- unsafe sort removed
- projection smaller
- result contract typed
- query testable
- slow query diagnosis easier
- old method deprecated
```

---

## 32. Refactoring Checklist

```text
Preparation
[ ] Mapper inventory completed.
[ ] Risk classification completed.
[ ] Statement metrics available.
[ ] Slow query evidence available.
[ ] Critical security risks identified.

Safety net
[ ] Characterization tests added.
[ ] Golden dataset created.
[ ] BoundSql utility available.
[ ] Vendor-real integration test available for critical SQL.

Contract improvement
[ ] Map parameters replaced or wrapped.
[ ] Map returns replaced or adapted.
[ ] DTO/projection names clear.
[ ] Scope object introduced where needed.

SQL improvement
[ ] SELECT * removed from critical query.
[ ] Unsafe ${} removed or whitelisted.
[ ] Dynamic SQL branches simplified.
[ ] Pagination order stable.
[ ] Count strategy reviewed.

DML improvement
[ ] rows affected returned.
[ ] rows affected checked.
[ ] state/version/scope guard added.
[ ] audit fields handled.

Operational safety
[ ] Feature flag or fallback exists for risky change.
[ ] Deployment plan defined.
[ ] Monitoring dashboard ready.
[ ] Rollback/roll-forward plan defined.

Cleanup
[ ] Old methods deprecated.
[ ] Dead SQL removed after observation.
[ ] Mapper ownership documented.
[ ] PR checklist adopted.
```

---

## 33. Ringkasan Mental Model

Legacy MyBatis refactoring bukan perlombaan mengubah XML menjadi sesuatu yang lebih modern. Ini adalah proses mengubah persistence layer dari:

```text
stringly typed SQL collection
```

menjadi:

```text
explicit, scoped, typed, testable, observable persistence contracts
```

Urutan aman:

```text
observe -> characterize -> isolate -> type -> scope -> test -> split -> optimize -> deprecate -> govern
```

Refactor terbaik biasanya bertahap:

```text
small change
clear invariant
strong regression test
safe deployment
measured outcome
```

Top-tier engineer tidak hanya bisa menulis mapper baru. Ia bisa mengambil mapper lama yang rapuh, memahami risiko tersembunyinya, memasang safety net, memperbaiki contract, dan membuat sistem lebih aman tanpa menghentikan delivery.

---

## 34. Apa yang Dilanjutkan di Part 33

Part 32 selesai membahas refactoring legacy MyBatis.

Part 33 adalah capstone terakhir seri ini:

```text
Designing a Production-Grade MyBatis Persistence Layer
```

Di sana kita akan menggabungkan semua bagian sebelumnya menjadi desain end-to-end:

- module boundary;
- mapper taxonomy;
- transaction model;
- criteria/command/result contracts;
- dynamic SQL rules;
- tenant/security scope;
- concurrency strategy;
- batch/export strategy;
- testing strategy;
- observability;
- migration safety;
- production readiness checklist.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 31 — Failure Modeling and Production Troubleshooting](./31-failure-modeling-production-troubleshooting.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 33 — Capstone: Designing a Production-Grade MyBatis Persistence Layer](./33-capstone-production-grade-mybatis-persistence-layer-design.md)

</div>
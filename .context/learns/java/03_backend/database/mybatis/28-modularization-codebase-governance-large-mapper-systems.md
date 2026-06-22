# Part 28 — Modularization and Codebase Governance for Large Mapper Systems

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `28-modularization-codebase-governance-large-mapper-systems.md`  
> Target: Java 8 sampai Java 25  
> Fokus: bagaimana mengelola MyBatis dalam codebase besar agar SQL tetap eksplisit, aman, mudah dicari, mudah diuji, dan tidak berubah menjadi kumpulan mapper liar yang sulit dipelihara.

---

## 1. Kenapa Governance Mapper Penting?

Pada aplikasi kecil, MyBatis biasanya terasa sederhana:

```text
UserMapper.selectById()
UserMapper.insert()
UserMapper.update()
```

Namun pada aplikasi enterprise, terutama sistem dengan banyak modul, tenant, audit trail, workflow, reporting, search screen, batch worker, dan integrasi eksternal, mapper bisa tumbuh menjadi ratusan file XML dan ribuan statement.

Masalahnya bukan lagi apakah MyBatis bisa menjalankan SQL. Masalahnya adalah:

```text
Apakah SQL masih bisa dikendalikan sebagai aset arsitektur?
```

Tanpa governance, MyBatis mudah berubah menjadi:

```text
SQL tersebar
  + mapper terlalu besar
  + resultMap copy-paste
  + fragment reuse sembarangan
  + statement naming tidak konsisten
  + parameter Map liar
  + tenant filter kadang ada kadang lupa
  + SELECT *
  + dynamic SQL sulit dites
  + query lambat tidak punya owner
  + mapper method lama tidak pernah dihapus
  = persistence layer menjadi sumber risiko produksi
```

MyBatis secara resmi memang memberi kebebasan besar lewat mapped statement, XML mapper, annotation mapper, result map, cache, include fragment, dan konfigurasi mapper. Kebebasan ini kuat, tetapi di codebase besar harus dikendalikan lewat standar desain, ownership, testing, review, dan observability. Dokumentasi MyBatis menekankan bahwa mapper XML berisi mapped statements seperti `select`, `insert`, `update`, `delete`, `resultMap`, `sql`, dan `cache`, sementara configuration memuat registry penting seperti settings, typeAliases, typeHandlers, plugins, environments, databaseIdProvider, dan mappers. Artinya, MyBatis bukan hanya “file query”; ia adalah konfigurasi runtime persistence yang perlu dikelola sebagai sistem.

---

## 2. Prinsip Dasar Governance MyBatis

Governance yang baik bukan berarti membuat MyBatis kaku. Governance berarti menciptakan batas agar kebebasan SQL tetap aman.

Prinsip utamanya:

```text
1. Mapper harus punya owner.
2. Mapper harus punya boundary module.
3. Mapper method harus punya contract jelas.
4. SQL harus eksplisit dan searchable.
5. Parameter dan result mapping harus typed.
6. Scope keamanan harus sulit dilupakan.
7. Reuse boleh, tapi jangan sampai menyembunyikan behavior.
8. Statement yang berubah harus bisa dites.
9. Query lambat harus bisa dikaitkan ke statement id.
10. Mapper lama harus bisa didepresiasi dan dihapus.
```

Mental model:

```text
Business capability
  -> module boundary
  -> use-case/application service
  -> mapper contract
  -> mapped SQL statement
  -> schema/index contract
  -> observable production behavior
```

Jika salah satu lapisan tidak punya nama dan owner, troubleshooting akan mahal.

---

## 3. Mapper sebagai Asset, Bukan Utility

Kesalahan umum adalah menganggap mapper seperti helper database:

```java
public interface CommonMapper {
    List<Map<String, Object>> query(String sql);
    int update(String sql);
}
```

Ini kelihatan fleksibel, tetapi menghancurkan governance:

- SQL tidak bisa direview lewat mapper XML.
- SQL injection boundary kabur.
- statement id hilang dari observability.
- result mapping tidak typed.
- tenant filter tidak bisa dipaksa.
- impact analysis schema change menjadi hampir mustahil.

Mapper yang baik adalah asset dengan contract:

```java
public interface CaseAssignmentMapper {
    Optional<CaseAssignmentRow> findActiveAssignmentByCaseId(CaseKey key);

    int assignOfficer(AssignOfficerCommand command);

    int releaseAssignment(ReleaseAssignmentCommand command);
}
```

Perbedaan mental model:

| Model | Dampak |
|---|---|
| Mapper sebagai DB helper | cepat di awal, mahal saat sistem besar |
| Mapper sebagai repository CRUD | cukup untuk domain sederhana, lemah untuk reporting/search/workflow |
| Mapper sebagai persistence contract | lebih eksplisit, lebih aman, lebih mudah dikelola |
| Mapper sebagai SQL governance unit | cocok untuk enterprise codebase besar |

---

## 4. Struktur Modul yang Direkomendasikan

Untuk codebase besar, struktur harus membantu engineer menemukan query berdasarkan module dan use case.

Contoh struktur Java:

```text
src/main/java/com/acme/caseflow/
  caseapplication/
    application/
      CaseApplicationService.java
    persistence/
      CaseApplicationMapper.java
      CaseApplicationReadMapper.java
      CaseApplicationWriteMapper.java
      CaseApplicationSearchCriteria.java
      CaseApplicationRow.java
      CaseApplicationDetailRow.java
      CaseApplicationCommand.java
  enforcement/
    application/
    persistence/
  audit/
    application/
    persistence/
  common/
    persistence/
      DataScope.java
      PageRequest.java
      SortSpec.java
      SqlFragments.java  <-- hati-hati, jangan jadi dumping ground
```

Contoh struktur resource:

```text
src/main/resources/mappers/
  caseapplication/
    CaseApplicationReadMapper.xml
    CaseApplicationWriteMapper.xml
    CaseApplicationSearchMapper.xml
  enforcement/
    EnforcementCaseMapper.xml
    EnforcementActionMapper.xml
  audit/
    AuditTrailMapper.xml
```

Prinsip:

```text
Java mapper interface dan XML mapper harus sejajar secara konseptual.
```

Jika interface ada di:

```text
com.acme.caseflow.caseapplication.persistence.CaseApplicationReadMapper
```

Maka XML namespace harus sama:

```xml
<mapper namespace="com.acme.caseflow.caseapplication.persistence.CaseApplicationReadMapper">
```

Ini penting karena namespace mapper XML adalah binding utama antara interface dan mapped statement.

---

## 5. Package by Module vs Package by Technical Layer

Ada dua gaya umum:

### 5.1 Package by Technical Layer

```text
controller/
service/
mapper/
dto/
model/
```

Kelebihan:

- mudah untuk aplikasi kecil.
- struktur familiar.

Kelemahan di sistem besar:

- mapper semua modul bercampur.
- ownership kabur.
- refactoring module sulit.
- cross-module dependency mudah menyebar.

### 5.2 Package by Module/Capability

```text
caseapplication/
  api/
  application/
  domain/
  persistence/
  dto/

enforcement/
  api/
  application/
  domain/
  persistence/
```

Kelebihan:

- ownership jelas.
- impact analysis lebih mudah.
- mapper terkait domain/use case dekat dengan service.
- module bisa berkembang mandiri.

Kelemahan:

- butuh disiplin boundary.
- common/shared code harus dikendalikan.

Rekomendasi untuk codebase enterprise:

```text
Gunakan package by module/capability.
Persistence adalah subfolder dari module, bukan folder global besar.
```

---

## 6. Granularitas Mapper

Granularitas mapper adalah keputusan arsitektur.

Terlalu kecil:

```text
CaseSelectByIdMapper
CaseInsertMapper
CaseUpdateStatusMapper
```

Masalah:

- terlalu banyak interface.
- sulit navigasi.
- overhead mental tinggi.

Terlalu besar:

```text
CaseMapper
  150 method
  4000 baris XML
```

Masalah:

- god mapper.
- conflict merge sering.
- ownership kabur.
- review sulit.
- resultMap fragment bercampur.

Granularitas sehat:

```text
CaseReadMapper
CaseWriteMapper
CaseSearchMapper
CaseWorkflowMapper
CaseReportMapper
```

Aturan praktis:

```text
Satu mapper sebaiknya punya satu alasan utama untuk berubah.
```

Contoh split:

| Mapper | Tanggung jawab |
|---|---|
| `CaseReadMapper` | lookup/detail bounded query |
| `CaseSearchMapper` | listing/search/pagination |
| `CaseWriteMapper` | insert/update/delete operational command |
| `CaseWorkflowMapper` | state transition dan lock-sensitive update |
| `CaseReportMapper` | reporting/projection-heavy query |
| `CaseAuditMapper` | audit/history write/read |

---

## 7. Read/Write Split Mapper

Di MyBatis, read/write split bukan wajib, tetapi sangat berguna di sistem besar.

Contoh:

```java
public interface CaseReadMapper {
    Optional<CaseDetailRow> findDetail(CaseKey key);
    Optional<CaseSummaryRow> findSummary(CaseKey key);
}
```

```java
public interface CaseWriteMapper {
    int insertCase(CreateCaseCommand command);
    int updateCaseMetadata(UpdateCaseMetadataCommand command);
    int softDeleteCase(SoftDeleteCaseCommand command);
}
```

Keuntungan:

- DML review lebih fokus.
- query reporting tidak bercampur dengan command update.
- cache policy lebih mudah.
- permission datasource read/write lebih mudah.
- mapper owner lebih jelas.

Risiko jika terlalu ekstrem:

- service harus inject banyak mapper.
- method kecil tersebar tanpa desain.

Rule:

```text
Split mapper jika perbedaan behavior-nya nyata: read, write, search, workflow, report, audit.
Jangan split hanya karena ingin terlihat rapi.
```

---

## 8. Naming Discipline

Nama adalah alat governance paling murah.

### 8.1 Nama Mapper

Gunakan nama yang menjawab:

```text
Module apa?
Operasi jenis apa?
Scope apa?
```

Contoh baik:

```text
CaseApplicationSearchMapper
CaseApplicationWorkflowMapper
AuditTrailExportMapper
OfficerAssignmentWriteMapper
AgencyConfigurationReadMapper
```

Contoh buruk:

```text
CommonMapper
BaseMapper
DataMapper
CaseMapper2
CaseNewMapper
QueryMapper
```

### 8.2 Nama Statement ID

Statement id harus sama dengan method interface.

```java
List<CaseSearchRow> searchCases(CaseSearchCriteria criteria);
```

```xml
<select id="searchCases" parameterType="CaseSearchCriteria" resultMap="CaseSearchRowMap">
```

Jangan membuat id abstrak:

```xml
<select id="query1">
<select id="getData">
<select id="selectList">
```

### 8.3 Nama ResultMap

Gunakan nama berdasarkan shape result, bukan tabel.

Baik:

```text
CaseSearchRowMap
CaseDetailRowMap
OfficerAssignmentRowMap
AuditTrailExportRowMap
```

Buruk:

```text
BaseResultMap
ResultMap
CaseMap
CommonMap
```

`BaseResultMap` sering menjadi awal masalah karena dipakai untuk semua kebutuhan, lalu setiap query mengambil kolom yang tidak perlu.

### 8.4 Nama SQL Fragment

SQL fragment harus punya nama yang menjelaskan fragment, bukan tempat dipakai.

Baik:

```xml
<sql id="CaseSearchColumns">
<sql id="CaseVisibilityPredicate">
<sql id="ActiveCasePredicate">
<sql id="CaseSearchOrderBy">
```

Buruk:

```xml
<sql id="CommonSql">
<sql id="WhereClause">
<sql id="Columns">
<sql id="Sql1">
```

---

## 9. SQL Fragment Reuse: Berguna tapi Berbahaya

MyBatis menyediakan `<sql>` dan `<include>` untuk reuse SQL fragment. Ini sangat berguna, tetapi bisa berbahaya jika reuse menyembunyikan behavior.

Contoh sehat:

```xml
<sql id="CaseSearchColumns">
  c.case_id,
  c.reference_no,
  c.status_code,
  c.created_at,
  c.updated_at
</sql>
```

```xml
<select id="searchCases" resultMap="CaseSearchRowMap">
  SELECT
    <include refid="CaseSearchColumns" />
  FROM case_application c
  WHERE c.tenant_id = #{scope.tenantId}
</select>
```

Contoh berbahaya:

```xml
<sql id="CommonWhere">
  WHERE deleted = 0
  <if test="tenantId != null">
    AND tenant_id = #{tenantId}
  </if>
</sql>
```

Masalah:

- tenant filter optional.
- fragment dipakai di banyak query dengan asumsi berbeda.
- security behavior tersembunyi.

Rule fragment:

```text
1. Fragment kolom boleh direuse jika shape result sama.
2. Fragment predicate boleh direuse jika invariant-nya sama.
3. Fragment security scope harus eksplisit dan tidak optional.
4. Jangan membuat fragment terlalu generic.
5. Jangan membuat fragment yang bergantung pada nama alias tidak jelas.
```

---

## 10. Alias Discipline dalam Fragment

Fragment SQL sering gagal karena alias tabel tidak konsisten.

Contoh buruk:

```xml
<sql id="ActiveCasePredicate">
  AND c.deleted = 0
</sql>
```

Fragment ini hanya bisa dipakai jika caller memakai alias `c`.

Ada dua pendekatan.

### 10.1 Fixed Alias Convention

Tetapkan alias standar per root table.

```text
case_application -> c
agency -> a
officer -> o
audit_trail -> at
```

Keuntungan:

- sederhana.
- mudah dicari.

Kelemahan:

- fragment sulit dipakai dalam query dengan multiple instance table yang sama.

### 10.2 Parameterized Include Property

MyBatis `<include>` dapat memakai property untuk substitusi fragment.

Contoh:

```xml
<sql id="ActiveCasePredicate">
  AND ${alias}.deleted = 0
</sql>

<include refid="ActiveCasePredicate">
  <property name="alias" value="c" />
</include>
```

Ini harus dipakai sangat hati-hati karena `${}` adalah substitution. Aman jika value property statis di XML, bukan input user.

Rule:

```text
Gunakan parameterized fragment hanya untuk alias statis yang dikontrol developer.
Jangan pernah mengalirkan input user ke `${}`.
```

---

## 11. ResultMap Reuse: Jangan Berlebihan

ResultMap reuse sering menggoda.

Contoh:

```xml
<resultMap id="CaseBaseMap" type="CaseRow">
  <id property="caseId" column="case_id" />
  <result property="referenceNo" column="reference_no" />
  <result property="status" column="status_code" />
  <result property="createdAt" column="created_at" />
</resultMap>
```

Reuse sehat jika query benar-benar mengembalikan shape yang sama.

Namun jangan memakai satu resultMap besar untuk semua query:

```xml
<resultMap id="CaseHugeMap" type="CaseEverythingRow">
  ... 80 columns ...
</resultMap>
```

Masalah:

- query dipaksa select kolom yang tidak perlu.
- payload membesar.
- mapping tidak relevan.
- security over-fetching.
- perubahan satu field berdampak luas.

Rule:

```text
ResultMap mengikuti use-case projection, bukan mengikuti tabel secara membabi buta.
```

Contoh result map yang sehat:

```text
CaseSearchRowMap       -> listing page
CaseDetailRowMap       -> detail page
CaseExportRowMap       -> export job
CaseWorkflowLockRowMap -> transition decision
```

---

## 12. TypeAlias Governance

MyBatis `typeAliases` membantu mengurangi fully qualified class name di XML.

Contoh:

```yaml
mybatis:
  type-aliases-package: com.acme.caseflow
```

Keuntungan:

- XML lebih pendek.
- readable.

Risiko:

- nama class sama di package berbeda bisa membingungkan.
- alias terlalu global bisa membuat XML tidak jelas.
- refactor class/package bisa diam-diam mempengaruhi mapper.

Rekomendasi:

```text
1. Pakai alias untuk DTO/criteria/command yang stabil.
2. Jangan gunakan nama class generik seperti Row, Command, Criteria.
3. Gunakan suffix module: CaseSearchCriteria, AuditExportRow.
4. Hindari alias global untuk seluruh domain jika codebase sangat besar.
5. Untuk mapper kritikal, fully qualified name kadang lebih aman.
```

---

## 13. TypeHandler Governance

TypeHandler adalah shared infrastructure. Jika semua module membuat handler sendiri untuk enum/status/JSON/date, behavior akan tidak konsisten.

Struktur yang sehat:

```text
common/persistence/typehandler/
  CodeEnumTypeHandler.java
  JsonClobTypeHandler.java
  UtcInstantTypeHandler.java
  BooleanYNTypeHandler.java
```

Rule:

```text
1. TypeHandler shared harus punya test kuat.
2. Handler domain-specific boleh di module terkait.
3. Jangan buat TypeHandler yang diam-diam mengubah business meaning.
4. Unknown enum code policy harus eksplisit.
5. JSON handler harus punya failure policy: fail-fast atau tolerant read.
```

Contoh policy enum:

```text
Unknown code dari database:
  Option A: throw exception -> cocok untuk invariant ketat
  Option B: map ke UNKNOWN -> cocok untuk backward-compatible read
  Option C: raw code preserved -> cocok untuk reporting/audit
```

Jangan biarkan tiap mapper memutuskan sendiri.

---

## 14. Ownership Model

Setiap mapper harus punya owner.

Owner bukan hanya orang, tetapi bisa module/team.

Contoh metadata internal:

```text
Mapper: CaseApplicationSearchMapper
Owner: Case Application Team
Schema dependency: case_application, agency, officer_assignment
Criticality: high
Security scope: tenant + agency + role
Performance SLO: p95 < 500ms for first page
```

Metadata ini bisa disimpan di:

- README module.
- ADR.
- code comment di XML header.
- internal catalog.
- generated mapper inventory.

Contoh XML header:

```xml
<!--
  Mapper: CaseApplicationSearchMapper
  Owner: Case Application Team
  Purpose: Search/listing queries for operational case screens.
  Scope invariant: tenant_id + agency_id must always be applied.
  Do not add export/reporting queries here. Use CaseApplicationReportMapper.
-->
<mapper namespace="com.acme.caseflow.caseapplication.persistence.CaseApplicationSearchMapper">
```

Ini bukan sekadar dokumentasi. Ini mencegah mapper menjadi tempat dumping.

---

## 15. Mapper Inventory

Untuk codebase besar, buat inventory otomatis.

Minimal data yang dikumpulkan:

```text
namespace
statement id
statement type
parameter type
result type/result map
file path
line number
referenced tables
uses ${}
uses foreach
uses include
uses resultMap
uses cache
uses databaseId
```

Output bisa berupa CSV/JSON/HTML.

Contoh inventory:

| Namespace | Statement | Type | Risk Flag |
|---|---|---|---|
| `CaseSearchMapper` | `searchCases` | SELECT | dynamic order by |
| `CaseWriteMapper` | `updateStatus` | UPDATE | state transition |
| `AuditExportMapper` | `streamExport` | SELECT | large result |
| `CommonMapper` | `query` | SELECT | raw sql forbidden |

Inventory membantu:

- impact analysis schema change.
- security review.
- performance review.
- dead mapper cleanup.
- migration Java/Spring/MyBatis.

---

## 16. Dead SQL Detection

Mapper yang tidak pernah dipakai menambah risiko.

Sumber deteksi:

```text
1. Static usage: mapper method referenced by Java code.
2. Runtime metrics: statement id observed in production logs/metrics.
3. Test coverage: statement executed by tests.
4. Git history: statement tidak berubah dan tidak terpakai lama.
```

Proses cleanup:

```text
Candidate dead statement
  -> check static usage
  -> check runtime usage window
  -> mark deprecated
  -> remove Java method + XML statement
  -> run mapper test suite
  -> deploy with monitoring
```

Jangan langsung hapus statement hanya karena IDE tidak menemukan reference. Bisa saja dipakai via dynamic proxy, reflection, batch job, atau modul yang berbeda.

---

## 17. Deprecation Strategy

Mapper method juga butuh lifecycle.

Contoh:

```java
/**
 * @deprecated Use searchCasesV2 with explicit DataScope and keyset pagination.
 */
@Deprecated
List<CaseSearchRow> searchCasesLegacy(Map<String, Object> params);
```

XML:

```xml
<!--
  Deprecated: use searchCasesV2.
  Removal target: 2026-Q4 after legacy screen migration.
-->
<select id="searchCasesLegacy" resultMap="CaseSearchRowMap">
```

Rule:

```text
1. Deprecated method harus punya pengganti.
2. Ada target removal.
3. Ada tracking issue.
4. Tidak boleh menambah caller baru.
5. Metrics membantu memastikan caller sudah nol.
```

---

## 18. Review Process untuk Mapper Change

MyBatis change harus direview bukan hanya sebagai Java code, tetapi sebagai database contract change.

Checklist review:

```text
SQL correctness:
  - Apakah query menghasilkan cardinality yang benar?
  - Apakah join tidak menggandakan root row secara tidak sengaja?
  - Apakah WHERE predicate lengkap?

Security:
  - Apakah tenant/agency/user scope wajib ada?
  - Apakah ada ${}? Jika ada, apakah whitelist/statis?
  - Apakah result over-fetching sensitive column?

Performance:
  - Apakah predicate index-aware?
  - Apakah ORDER BY stabil?
  - Apakah pagination bounded?
  - Apakah count query mahal?

Mapping:
  - Apakah resultMap explicit?
  - Apakah alias kolom tidak ambigu?
  - Apakah primitive/wrapper tepat?

Transaction/concurrency:
  - Apakah DML return rows affected dicek service?
  - Apakah optimistic lock/state guard ada?
  - Apakah lock query transaction-bound?

Operational:
  - Apakah statement id jelas untuk logging?
  - Apakah query punya timeout/fetchSize jika perlu?
  - Apakah test mencakup dynamic branch?
```

---

## 19. Mapper Change Classification

Tidak semua mapper change punya risiko sama.

| Change | Risk | Review Level |
|---|---:|---|
| tambah kolom projection non-sensitive | low | normal |
| ubah WHERE scope | high | security + domain review |
| tambah `${}` dynamic order | high | security review |
| ubah state transition update | high | concurrency review |
| tambah query export besar | medium/high | performance review |
| ubah resultMap shared | high | impact analysis |
| ubah TypeHandler shared | high | integration test wajib |
| tambah index-aware search predicate | medium | DB/performance review |
| ubah stored procedure mapper | high | DB + transaction review |

Gunakan classification agar review effort proporsional.

---

## 20. Generic CRUD Mapper: Kapan Boleh, Kapan Berbahaya

Generic CRUD mapper sering muncul:

```java
interface BaseMapper<T, ID> {
    T findById(ID id);
    int insert(T entity);
    int update(T entity);
    int delete(ID id);
}
```

Untuk MyBatis, ini biasanya kurang cocok jika dipakai luas.

Masalah:

- MyBatis kuat karena SQL eksplisit; generic CRUD mengaburkan SQL.
- update semua kolom bisa merusak null semantics.
- tenant/security scope sulit dipaksa.
- soft delete vs hard delete beda per entity.
- optimistic locking tidak universal.
- audit column tidak universal.

Boleh dipakai jika:

```text
1. Untuk internal lookup table sederhana.
2. Tidak ada tenant/security complexity.
3. Tidak ada workflow state machine.
4. Tidak ada audit/regulatory requirement.
5. Ada generated SQL yang tetap bisa direview.
```

Untuk enterprise module utama, lebih baik explicit mapper method.

---

## 21. Common Mapper sebagai Anti-Pattern

`CommonMapper` sering menjadi tempat semua query yang tidak jelas.

Contoh buruk:

```java
public interface CommonMapper {
    List<DropdownOption> getDropdown(String type);
    List<Map<String, Object>> getReport(Map<String, Object> params);
    int updateStatus(Map<String, Object> params);
    String getConfig(String key);
}
```

Masalah:

- ownership tidak jelas.
- query beda domain bercampur.
- security review sulit.
- test sulit.
- rename schema berdampak kabur.

Alternatif:

```text
ReferenceDataMapper
AgencyConfigReadMapper
CaseReportMapper
WorkflowStatusMapper
```

Rule:

```text
Common boleh untuk infrastructure primitive, bukan business query.
```

Contoh common yang masih wajar:

```text
DatabaseClockMapper.selectCurrentTimestamp()
SequenceMapper.nextCaseSequence()
HealthCheckMapper.ping()
```

---

## 22. Parameter Object Governance

Parameter object adalah contract. Jangan gunakan `Map<String,Object>` sebagai default.

Buruk:

```java
List<CaseSearchRow> searchCases(Map<String, Object> params);
```

Masalah:

- tidak ada compile-time contract.
- typo key baru ketahuan runtime.
- sulit grep usage.
- nullable semantics kabur.
- security scope bisa lupa.

Baik:

```java
public final class CaseSearchCriteria {
    private final DataScope scope;
    private final String keyword;
    private final CaseStatus status;
    private final Instant createdFromInclusive;
    private final Instant createdToExclusive;
    private final PageRequest page;
    private final CaseSort sort;
}
```

Rule:

```text
1. Query kompleks wajib pakai criteria object.
2. DML wajib pakai command object.
3. Security scope wajib explicit object, bukan scalar lepas.
4. Banyak parameter scalar hanya boleh untuk query kecil dan jelas.
```

---

## 23. Result Object Governance

Jangan memakai domain entity untuk semua query.

Tiga kategori result object:

```text
1. Domain persistence object
   - cocok untuk aggregate/domain mutation tertentu.

2. Read projection row
   - cocok untuk listing/search/detail/report.

3. Technical row
   - cocok untuk audit/export/batch/worker.
```

Contoh:

```java
public final class CaseSearchRow {
    private final Long caseId;
    private final String referenceNo;
    private final String statusLabel;
    private final String assignedOfficerName;
    private final Instant updatedAt;
}
```

Ini lebih baik daripada memuat `CaseEntity` penuh dengan puluhan field yang tidak dibutuhkan.

Rule:

```text
Result object mengikuti kebutuhan use-case, bukan struktur tabel mentah.
```

---

## 24. SQL Style Guide

SQL style guide membuat diff dan review lebih mudah.

Contoh standar:

```sql
SELECT
  c.case_id,
  c.reference_no,
  c.status_code,
  c.created_at,
  c.updated_at
FROM case_application c
WHERE c.tenant_id = #{scope.tenantId}
  AND c.deleted = 0
  AND c.status_code = #{status.code}
ORDER BY c.updated_at DESC, c.case_id DESC
```

Rekomendasi:

```text
1. Satu kolom per baris untuk SELECT besar.
2. Alias tabel pendek tapi konsisten.
3. Predicate scope/security di bagian atas WHERE.
4. Dynamic filter setelah invariant predicate.
5. ORDER BY selalu deterministic.
6. Hindari SELECT *.
7. Hindari function pada indexed column jika tidak punya function-based index.
8. Gunakan date range [from, to), bukan BETWEEN untuk timestamp.
9. Jangan mix formatting acak di XML.
```

---

## 25. XML Formatting Discipline

XML MyBatis rawan tidak terbaca jika dynamic SQL kompleks.

Buruk:

```xml
<select id="search" resultMap="x">select * from t where 1=1 <if test="a!=null">and a=#{a}</if><if test="b!=null">and b=#{b}</if></select>
```

Baik:

```xml
<select id="searchCases" parameterType="CaseSearchCriteria" resultMap="CaseSearchRowMap">
  SELECT
    c.case_id,
    c.reference_no,
    c.status_code,
    c.updated_at
  FROM case_application c
  <where>
    c.tenant_id = #{scope.tenantId}
    AND c.deleted = 0

    <if test="status != null">
      AND c.status_code = #{status.code}
    </if>

    <if test="keyword != null and keyword != ''">
      AND UPPER(c.reference_no) LIKE UPPER(#{keywordLike}) ESCAPE '\\'
    </if>
  </where>
  ORDER BY c.updated_at DESC, c.case_id DESC
</select>
```

Rule:

```text
Dynamic branch harus terlihat sebagai branch, bukan disembunyikan dalam satu baris.
```

---

## 26. BoundSql sebagai Tool Governance

`BoundSql` adalah bentuk SQL final setelah dynamic SQL dirender dan parameter mapping disusun.

Gunakan `BoundSql` untuk:

- testing dynamic SQL.
- memastikan predicate tenant selalu ada.
- mendeteksi `ORDER BY` tidak aman.
- snapshot SQL shape.
- debugging parameter mapping.

Contoh konsep test:

```java
MappedStatement ms = sqlSessionFactory
    .getConfiguration()
    .getMappedStatement("com.acme.CaseSearchMapper.searchCases");

BoundSql boundSql = ms.getBoundSql(criteria);

String sql = boundSql.getSql();

assertThat(sql).contains("tenant_id");
assertThat(sql).contains("deleted = 0");
assertThat(sql).doesNotContain("${");
```

Jangan terlalu rapuh dengan whitespace. Normalize SQL sebelum assertion.

---

## 27. Static Analysis untuk Mapper XML

Buat rule sederhana yang bisa dijalankan di CI.

Rule contoh:

```text
Forbidden:
  - SELECT *
  - ${} tanpa allowlist comment
  - resultType="map"
  - parameterType="map"
  - id mengandung query1/query2/temp/test
  - namespace tidak cocok dengan interface
  - mapper XML tanpa owner header

Warning:
  - statement > 150 lines
  - mapper XML > 1000 lines
  - foreach IN clause tanpa max size validation
  - select tanpa ORDER BY untuk pagination
  - update/delete tanpa tenant/scope predicate
```

Static analysis tidak sempurna, tetapi sangat efektif untuk mencegah anti-pattern dasar.

---

## 28. Mapper Metrics Governance

Setiap mapped statement harus bisa muncul sebagai metric/log key.

Metric minimal:

```text
mybatis.statement.duration
mybatis.statement.count
mybatis.statement.error.count
mybatis.statement.rows.returned
mybatis.statement.rows.affected
```

Tags:

```text
namespace
statementId
statementType
module
datasource
success/failure
```

Gunakan statement id sebagai identity:

```text
caseapplication.CaseSearchMapper.searchCases
```

Tanpa ini, query lambat di database sulit dikaitkan ke kode.

---

## 29. Performance Governance

Mapper besar butuh standard performance.

Contoh policy:

```text
1. Semua listing query harus bounded pagination.
2. Semua pagination harus punya deterministic ORDER BY.
3. Search query baru harus menyebut expected index.
4. Export query harus streaming/cursor/job-based, bukan selectList unbounded.
5. Query yang expected p95 > 1s harus punya observability dan timeout.
6. Count query besar harus dievaluasi: exact count, approximate count, atau Slice.
7. Query one-to-many tidak boleh dipaginasi langsung di joined row tanpa root-first strategy.
```

Review harus bertanya:

```text
Apakah query ini akan tetap masuk akal saat data 10x lebih besar?
```

---

## 30. Security Governance

Security governance mapper harus membuat unsafe path sulit dilakukan.

Policy:

```text
1. Semua mapper business query menerima DataScope.
2. Tidak boleh query tenant-scoped tanpa tenant predicate.
3. Tidak boleh dynamic identifier dari input mentah.
4. Tidak boleh SELECT sensitive columns di listing mapper.
5. Update/delete harus scoped by tenant/agency jika data scoped.
6. DML rows affected harus dicek service.
7. Cache harus mempertimbangkan tenant/security scope.
8. Log SQL parameter harus masking PII/secret.
```

Contoh DataScope:

```java
public final class DataScope {
    private final String tenantId;
    private final Set<String> agencyIds;
    private final String userId;
    private final Set<String> roles;
}
```

Mapper method:

```java
List<CaseSearchRow> searchCases(CaseSearchCriteria criteria);
```

Criteria harus punya `DataScope`, bukan `tenantId` scalar yang mudah lupa.

---

## 31. Schema Ownership dan Mapper Dependency

Mapper harus punya hubungan jelas dengan schema.

Untuk setiap module:

```text
Owned tables:
  - case_application
  - case_assignment

Read-only dependency:
  - agency
  - officer_profile

Shared lookup:
  - status_code
  - module_dimension
```

Jika mapper module A update tabel module B, itu red flag.

Tipe dependency:

| Dependency | Boleh? | Catatan |
|---|---|---|
| Own table read/write | ya | normal |
| Other module read | boleh terbatas | gunakan projection/read model jika sering |
| Other module write | hati-hati | biasanya lewat service/API/event |
| Shared lookup read | ya | governance lookup diperlukan |
| Reporting cross-module read | ya | pisah report mapper/read model |

---

## 32. Cross-Module Query

MyBatis memudahkan join lintas module, tetapi ini bisa merusak boundary.

Contoh:

```sql
SELECT ...
FROM case_application c
JOIN enforcement_action ea ON ea.case_id = c.case_id
JOIN payment p ON p.case_id = c.case_id
JOIN user_profile u ON u.user_id = c.assigned_user_id
```

Query seperti ini mungkin dibutuhkan untuk report/dashboard. Tetapi jangan diletakkan di mapper operational module sembarangan.

Rekomendasi:

```text
1. Untuk operational screen: query di module pemilik use case.
2. Untuk report/dashboard: gunakan ReportMapper atau read model khusus.
3. Untuk data lintas module yang sering dipakai: pertimbangkan denormalized read model/materialized view.
4. Jangan biarkan satu module diam-diam mengambil alih schema module lain.
```

---

## 33. Mapper untuk Reporting

Reporting query biasanya berbeda dari operational query:

- join lebih banyak.
- aggregation.
- date range besar.
- export.
- mungkin lintas module.
- butuh index/materialized view.
- tidak selalu cocok dengan domain entity.

Pisahkan:

```text
CaseSearchMapper      -> operational listing
CaseReportMapper      -> report/dashboard
CaseExportMapper      -> async export large result
```

Jangan masukkan report besar ke mapper operational hanya karena tabelnya sama.

---

## 34. Mapper untuk Workflow/State Machine

Workflow mapper harus lebih ketat daripada mapper biasa.

Contoh:

```java
int transitionCase(TransitionCaseCommand command);
```

SQL:

```xml
<update id="transitionCase" parameterType="TransitionCaseCommand">
  UPDATE case_application
  SET
    status_code = #{targetStatus.code},
    version = version + 1,
    updated_by = #{actorUserId},
    updated_at = #{now}
  WHERE tenant_id = #{scope.tenantId}
    AND case_id = #{caseId}
    AND status_code = #{expectedCurrentStatus.code}
    AND version = #{expectedVersion}
</update>
```

Governance rule:

```text
State transition update tidak boleh generic update.
Ia harus conditional, scoped, version-aware, dan rows affected wajib dicek.
```

---

## 35. Mapper untuk Audit Trail

Audit mapper punya karakteristik khusus:

- write-heavy.
- append-only.
- large payload.
- retention/archival.
- query berdasarkan actor/module/date.
- sering mengandung sensitive text.

Pisahkan audit mapper dari mapper business utama.

Contoh:

```text
AuditTrailWriteMapper
AuditTrailSearchMapper
AuditTrailExportMapper
```

Rule:

```text
1. Audit write sebaiknya append-only.
2. Jangan update audit row kecuali ada desain eksplisit.
3. Listing audit jangan select CLOB besar secara default.
4. Export audit harus streaming/job-based.
5. Audit query wajib scoped dan masked sesuai role.
```

---

## 36. Mapper Documentation yang Berguna

Dokumentasi mapper tidak perlu panjang, tetapi harus menjawab pertanyaan operasional.

Template:

```text
Purpose:
  Query apa dan untuk use-case apa?

Scope invariant:
  Tenant/agency/user/module filter apa yang wajib?

Cardinality:
  single row, list bounded, large result, aggregate?

Performance expectation:
  expected data size, index, timeout, pagination?

Transaction/concurrency:
  lock? optimistic update? rows affected?

Do not use for:
  use-case yang terlihat mirip tapi sebenarnya beda.
```

Contoh:

```xml
<!--
  Purpose: Search operational cases for officer dashboard.
  Scope: Always tenant + agency scoped.
  Cardinality: bounded page only, never export.
  Performance: expects IDX_CASE_SEARCH_TENANT_STATUS_UPDATED.
  Do not use for CSV export; use CaseExportMapper.
-->
<select id="searchOfficerDashboardCases" ...>
```

---

## 37. Version Control dan Merge Conflict

XML mapper besar sering menimbulkan merge conflict.

Mitigasi:

```text
1. Split mapper berdasarkan responsibility.
2. Urutkan statement secara stabil.
3. Jangan campur refactor format dengan logic change.
4. Satu PR fokus pada satu module/use-case.
5. Hindari mapper XML ribuan baris.
6. Gunakan SQL formatter konsisten.
```

Urutan statement bisa berdasarkan:

```text
1. resultMap
2. sql fragments
3. select
4. insert
5. update
6. delete
```

Atau berdasarkan use-case. Pilih satu standar.

---

## 38. Annotation Mapper Governance

Annotation mapper berguna untuk query kecil.

Contoh yang masih wajar:

```java
@Select("SELECT CURRENT_TIMESTAMP")
Instant currentTimestamp();
```

Namun annotation mapper sulit untuk SQL kompleks:

- formatting buruk.
- dynamic SQL lebih sulit dibaca.
- resultMap kompleks tidak nyaman.
- review SQL di Java string lebih susah.

Rule:

```text
Gunakan annotation mapper hanya untuk query kecil, stabil, dan tidak dynamic.
Gunakan XML mapper untuk query business kompleks, dynamic SQL, resultMap kompleks, dan vendor-specific SQL.
```

---

## 39. Multi-Datasource Governance

Pada sistem besar, mungkin ada:

- OLTP datasource.
- reporting replica.
- archival datasource.
- tenant-specific datasource.
- read/write datasource.

Governance:

```text
1. Mapper package harus jelas terikat ke datasource.
2. MapperScan harus memakai marker interface atau basePackageClasses.
3. Jangan biarkan mapper salah masuk SqlSessionFactory.
4. Transaction manager harus eksplisit.
5. Test wiring multi-datasource wajib ada.
```

Contoh marker:

```java
public interface OltpMapperMarker {}
public interface ReportingMapperMarker {}
```

Package:

```text
com.acme.persistence.oltp.mapper
com.acme.persistence.reporting.mapper
```

---

## 40. Cache Governance

Second-level cache di MyBatis berbasis mapper namespace. Ini berarti desain namespace menentukan boundary cache.

Rule:

```text
1. Jangan enable cache di mapper yang result-nya security/tenant-sensitive tanpa analisis.
2. Jangan cache large result.
3. Jangan cache mutable object yang kemudian dimodifikasi caller.
4. Pastikan DML invalidation sesuai namespace.
5. Hindari cache-ref lintas namespace jika ownership tidak jelas.
```

Untuk sistem multi-pod/multi-instance, second-level cache lokal JVM sering tidak cukup karena invalidation tidak otomatis lintas node. Untuk data shared yang butuh cache konsisten, biasanya lebih baik pakai application cache eksternal dengan desain key dan invalidation eksplisit.

---

## 41. Plugin/Interceptor Governance

Interceptor MyBatis dapat memodifikasi/observasi executor, statement handler, parameter handler, atau result set handler.

Gunakan untuk:

- metrics.
- logging.
- query count.
- tenant guard assertion.
- performance tracing.

Hati-hati untuk:

- auto-inject tenant predicate.
- auto-pagination.
- SQL rewrite kompleks.
- data masking otomatis di result handler.

Rule:

```text
Interceptor boleh menjadi guardrail, bukan tempat business rule tersembunyi.
```

Jika interceptor mengubah SQL secara signifikan, debugging bisa menjadi sulit karena SQL di XML bukan SQL yang benar-benar dieksekusi.

---

## 42. Code Generation Governance

MyBatis Generator atau generator internal bisa membantu, tetapi juga bisa menghasilkan banyak code yang tidak dipahami.

Gunakan generator untuk:

- table sederhana.
- bootstrap mapper.
- lookup/reference data.
- repetitive CRUD dengan aturan jelas.

Jangan gunakan generator sebagai alasan untuk tidak mendesain:

- state transition.
- tenant isolation.
- audit.
- reporting.
- complex search.
- security-sensitive update.

Rule:

```text
Generated mapper boleh menjadi starting point, bukan architecture boundary final.
```

---

## 43. Java 8 sampai Java 25: Governance Implications

### Java 8

- Gunakan POJO immutable manual.
- `Optional` boleh untuk service API, hati-hati mapper compatibility.
- Tidak ada record.
- Test dan static analysis menjadi lebih penting karena type model lebih verbose.

### Java 11

- Tidak banyak perubahan MyBatis-specific.
- Baseline runtime lebih modern.
- Masih umum di enterprise transitional stack.

### Java 17

- Baseline penting untuk Spring Boot 3.
- Record bisa dipakai untuk criteria/result DTO jika mapping constructor jelas.
- Sealed type bisa membantu model enum/status domain, tetapi mapper XML tetap butuh mapping eksplisit.

### Java 21

- Virtual threads membantu concurrency blocking I/O, tetapi tidak menghilangkan batas connection pool/database.
- Governance mapper harus tetap membatasi query unbounded.
- Lebih banyak concurrent request bisa memperbesar tekanan database.

### Java 25

- Perlakukan sebagai modern LTS-style environment tergantung adoption organisasi.
- Governance tetap sama: SQL shape, transaction, scope, index, mapping.
- Jangan memakai fitur bahasa modern jika membuat mapper XML semakin sulit dipahami tim Java 8/11.

Prinsip lintas versi:

```text
Persistence contract harus stabil lintas Java version.
Fitur bahasa boleh modern, tetapi SQL/mapping invariants tidak berubah.
```

---

## 44. Mini Case Study: Mapper Governance untuk Sistem Case Management

Bayangkan sistem enforcement/case management dengan modul:

```text
Application
Case
Appeal
Compliance
Correspondence
Audit
Report
Revenue
Profile
Document
```

Anti-pattern awal:

```text
CaseMapper.xml berisi:
  - case listing
  - case detail
  - case assignment
  - approval update
  - audit insert
  - report query
  - export query
  - dashboard query
  - dropdown query
```

Akibat:

- file 5000 baris.
- query report membuat merge conflict dengan bugfix assignment.
- resultMap `BaseCaseMap` dipakai di mana-mana.
- search query select CLOB tanpa perlu.
- tenant predicate ada di sebagian query.
- update status generic tanpa expected state.
- sulit tahu query mana lambat.

Refactor governance:

```text
case/persistence/
  CaseReadMapper
  CaseSearchMapper
  CaseWorkflowMapper
  CaseAssignmentMapper
  CaseAuditLinkMapper
  CaseExportMapper

report/persistence/
  CaseReportMapper

audit/persistence/
  AuditTrailWriteMapper
  AuditTrailSearchMapper
  AuditTrailExportMapper
```

Hasil:

```text
CaseSearchMapper:
  - hanya listing/search bounded
  - wajib DataScope
  - keyset/offset pagination jelas
  - no CLOB

CaseWorkflowMapper:
  - state transition conditional update
  - optimistic version
  - rows affected contract

CaseExportMapper:
  - cursor/streaming
  - no local cache long-lived
  - job checkpoint

AuditTrailMapper:
  - payload retrieval dipisah dari listing
```

Ini bukan sekadar rapi. Ini mengurangi risiko produksi.

---

## 45. Smell Catalog

### 45.1 God Mapper

Gejala:

```text
Mapper > 1000 baris XML
Method > 50
Banyak domain berbeda
```

Solusi:

```text
Split by read/write/search/workflow/report/audit.
```

### 45.2 ResultMap Monster

Gejala:

```text
Satu resultMap untuk semua query
SELECT kolom sangat banyak
```

Solusi:

```text
Projection-specific resultMap.
```

### 45.3 Generic Map Everywhere

Gejala:

```java
Map<String, Object> params
Map<String, Object> result
```

Solusi:

```text
Criteria/command/result DTO typed.
```

### 45.4 Optional Security Predicate

Gejala:

```xml
<if test="tenantId != null">
  AND tenant_id = #{tenantId}
</if>
```

Solusi:

```text
Tenant scope wajib, bukan optional.
```

### 45.5 Hidden Dynamic Identifier

Gejala:

```xml
ORDER BY ${sort}
```

Solusi:

```text
Enum whitelist atau choose branch.
```

### 45.6 Unbounded SelectList

Gejala:

```java
List<Row> findAll();
```

Solusi:

```text
Pagination, cursor, chunk, export job.
```

### 45.7 Report Query in Operational Mapper

Gejala:

```text
Search mapper berisi aggregate dashboard/report besar.
```

Solusi:

```text
Pisahkan report/read model mapper.
```

### 45.8 No Statement Metrics

Gejala:

```text
DB slow query tidak bisa dikaitkan ke mapper method.
```

Solusi:

```text
Log/metric namespace + statement id.
```

---

## 46. Production Readiness Checklist

Sebelum mapper dianggap production-ready:

```text
Design:
  [ ] Mapper berada di module yang benar.
  [ ] Namespace sesuai interface.
  [ ] Method name menjelaskan cardinality dan intent.
  [ ] Parameter object typed.
  [ ] Result object/projection tepat.

Security:
  [ ] Tenant/agency/user scope eksplisit.
  [ ] Tidak ada input user ke ${}.
  [ ] Sensitive column tidak over-fetched.
  [ ] Update/delete scoped.

Performance:
  [ ] Query bounded atau streaming.
  [ ] ORDER BY deterministic.
  [ ] Index expectation jelas.
  [ ] Count strategy jelas.
  [ ] Large result tidak pakai selectList unbounded.

Mapping:
  [ ] ResultMap explicit untuk join/complex result.
  [ ] Column alias tidak ambigu.
  [ ] Primitive/wrapper null-safe.
  [ ] TypeHandler sesuai.

Transaction/concurrency:
  [ ] DML rows affected dicek.
  [ ] State transition conditional.
  [ ] Optimistic/pessimistic strategy jelas jika perlu.

Testing:
  [ ] XML parse tested.
  [ ] Dynamic branch tested.
  [ ] Security scope tested.
  [ ] Pagination tested.
  [ ] Vendor-specific behavior tested jika ada.

Operations:
  [ ] Statement id muncul di log/metric.
  [ ] Timeout/fetchSize dipertimbangkan.
  [ ] Owner jelas.
  [ ] Dokumentasi singkat ada untuk query kritikal.
```

---

## 47. Latihan Praktis

### Latihan 1 — Split God Mapper

Diberikan mapper:

```text
CaseMapper
  findById
  search
  updateStatus
  assignOfficer
  insertAudit
  exportCsv
  dashboardSummary
  findDropdownStatus
  deleteDraft
  restoreDraft
```

Tugas:

1. Pecah menjadi mapper yang lebih sehat.
2. Tentukan owner tiap mapper.
3. Tentukan query mana yang butuh DataScope.
4. Tentukan query mana yang harus streaming.
5. Tentukan DML mana yang harus conditional rows affected.

Jawaban ideal mengarah ke:

```text
CaseReadMapper
CaseSearchMapper
CaseWorkflowMapper
CaseAssignmentMapper
CaseExportMapper
CaseDashboardMapper
ReferenceDataMapper
AuditTrailWriteMapper
```

### Latihan 2 — Review Fragment

Fragment:

```xml
<sql id="CommonWhere">
  <where>
    <if test="tenantId != null">
      tenant_id = #{tenantId}
    </if>
    <if test="status != null">
      AND status = #{status}
    </if>
  </where>
</sql>
```

Masalah:

- tenant optional.
- fragment terlalu generic.
- jika tenant null, query bisa cross-tenant.
- status type tidak jelas.

Perbaikan:

```xml
<sql id="CaseScopePredicate">
  c.tenant_id = #{scope.tenantId}
  AND c.agency_id IN
  <foreach collection="scope.agencyIds" item="agencyId" open="(" separator="," close=")">
    #{agencyId}
  </foreach>
</sql>
```

### Latihan 3 — Buat Static Analysis Rule

Buat rule CI sederhana:

```text
Fail build jika mapper XML mengandung:
  - SELECT *
  - parameterType="map"
  - resultType="map"
  - ORDER BY ${
  - id="query"
  - id="selectList"
```

Lalu tambahkan allowlist dengan comment khusus untuk kasus yang benar-benar sah.

---

## 48. Ringkasan Mental Model

MyBatis memberi kekuatan karena SQL eksplisit. Tetapi pada skala besar, eksplisit saja tidak cukup.

Yang dibutuhkan adalah:

```text
Explicit SQL
  + typed parameter/result contract
  + mapper ownership
  + module boundary
  + security scope invariant
  + performance policy
  + test coverage
  + observability
  + lifecycle cleanup
  = sustainable MyBatis codebase
```

Tanpa governance, MyBatis menjadi kumpulan string SQL. Dengan governance, MyBatis menjadi persistence layer yang sangat kuat, predictable, dan cocok untuk sistem enterprise yang membutuhkan kontrol tinggi terhadap SQL.

---

## 49. Checklist Pemahaman

Setelah bagian ini, kamu seharusnya bisa menjawab:

1. Kenapa mapper bukan sekadar utility database?
2. Kapan mapper harus di-split?
3. Kenapa `CommonMapper` sering menjadi anti-pattern?
4. Bagaimana menentukan owner mapper?
5. Apa beda resultMap reuse sehat dan monster resultMap?
6. Kenapa fragment SQL security-scope tidak boleh optional?
7. Bagaimana mendeteksi dead SQL?
8. Bagaimana membuat mapper inventory?
9. Apa saja review checklist untuk mapper change?
10. Bagaimana mengelola mapper untuk 50+ module tanpa chaos?

---

## 50. Apa yang Akan Dibahas di Part 29

Part berikutnya:

```text
29-plugin-interceptor-engineering.md
```

Kita akan membahas:

- plugin mechanism MyBatis.
- interceptor target.
- `Executor` interceptor.
- `StatementHandler` interceptor.
- `ParameterHandler` interceptor.
- `ResultSetHandler` interceptor.
- observability interceptor.
- tenant guard interceptor.
- pagination interceptor risk.
- SQL rewrite risk.
- testing interceptor.
- kapan interceptor membantu dan kapan justru membuat sistem sulit dipahami.

---

## Status Seri

```text
Progress: Part 0 sampai Part 28 selesai.
Seri belum selesai.
Next: Part 29 — Plugin and Interceptor Engineering.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./27-large-object-large-result-clob-blob-streaming-cursor.md">⬅️ Part 27 — Large Object and Large Result Handling: CLOB, BLOB, Streaming, Cursor</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./29-plugin-interceptor-engineering.md">Part 29 — Plugin and Interceptor Engineering ➡️</a>
</div>

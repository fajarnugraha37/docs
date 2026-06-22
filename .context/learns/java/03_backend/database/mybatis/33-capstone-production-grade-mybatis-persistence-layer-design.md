# Part 33 — Capstone: Designing a Production-Grade MyBatis Persistence Layer

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `33-capstone-production-grade-mybatis-persistence-layer-design.md`  
**Scope:** Java 8 sampai Java 25  
**Status:** Bagian terakhir dari seri MyBatis advance

---

## 0. Tujuan Bagian Ini

Bagian ini adalah capstone. Tujuannya bukan lagi menjelaskan satu fitur MyBatis, tetapi menyatukan seluruh seri menjadi satu rancangan nyata:

> Bagaimana mendesain persistence layer MyBatis yang eksplisit, aman, cepat, testable, observable, dan tetap bisa berevolusi di sistem enterprise besar.

Di tahap ini, MyBatis harus dilihat bukan hanya sebagai library untuk menjalankan SQL, tetapi sebagai **persistence control plane**.

Persistence layer yang baik harus menjawab pertanyaan berikut:

1. Apa kontrak setiap query?
2. Siapa pemilik transaction?
3. Bagaimana authorization/tenant scope dipaksa?
4. Bagaimana update mencegah lost update?
5. Bagaimana pagination tetap stabil?
6. Bagaimana query lambat bisa ditelusuri?
7. Bagaimana mapper tetap aman saat schema berubah?
8. Bagaimana sistem diuji agar SQL tidak hanya benar secara sintaks, tetapi benar secara bisnis?
9. Bagaimana codebase 50+ module tetap bisa dikendalikan?

Jika jawaban atas pertanyaan-pertanyaan ini kabur, maka MyBatis layer akan berubah menjadi kumpulan XML/annotation query yang sulit dikendalikan.

---

## 1. Prinsip Utama Production-Grade MyBatis

Production-grade MyBatis bukan berarti memakai semua fitur MyBatis. Justru sebaliknya: production-grade berarti tahu fitur mana yang harus dipakai, fitur mana yang harus dibatasi, dan fitur mana yang harus dihindari.

Prinsip dasarnya:

```text
Explicit SQL
  + explicit mapper contract
  + explicit transaction boundary
  + explicit data scope
  + explicit result shape
  + explicit failure handling
  + explicit observability
  = maintainable persistence layer
```

MyBatis memberi kebebasan tinggi. Kebebasan ini harus dibayar dengan discipline.

Tanpa discipline, MyBatis mudah rusak melalui:

- SQL copy-paste antar mapper.
- `SELECT *` yang merusak contract.
- dynamic SQL yang tidak bisa diuji.
- `${}` untuk sorting/filter yang rawan injection.
- mapper method yang tidak menjelaskan cardinality.
- update tanpa rows affected check.
- tenant predicate yang kadang ada kadang hilang.
- resultMap yang dipakai ulang secara berlebihan.
- cache yang membuat data stale.
- query besar yang diam-diam memuat jutaan row ke heap.

Top-tier engineer tidak hanya menulis mapper yang jalan. Mereka mendesain **invariant** supaya mapper sulit disalahgunakan.

---

## 2. Target Architecture

Arsitektur yang direkomendasikan:

```text
Controller / API Adapter
    |
    v
Application Service / Use Case Service
    |
    |-- validates command/query intent
    |-- owns transaction boundary
    |-- owns authorization decision orchestration
    |-- checks rows affected / concurrency result
    |
    v
Domain / Policy / Workflow Component
    |
    |-- state transition rules
    |-- business invariant
    |-- authorization policy abstraction
    |
    v
Persistence Port / Repository-like Adapter
    |
    |-- uses MyBatis mapper
    |-- composes multiple mapper calls if needed
    |-- translates database result into application result
    |
    v
MyBatis Mapper Interface
    |
    |-- narrow method contract
    |-- scoped parameter object
    |-- typed return object
    |
    v
Mapper XML / Dynamic SQL Provider
    |
    |-- explicit SQL
    |-- explicit resultMap
    |-- safe dynamic SQL
    |
    v
Database
```

Catatan penting:

- Controller tidak boleh memanggil mapper langsung.
- Mapper tidak boleh punya business logic.
- XML tidak boleh menjadi tempat menyembunyikan authorization rule yang tidak terlihat oleh service.
- Service harus tahu apakah operasi berhasil, gagal karena stale version, gagal karena forbidden, atau gagal karena not found.
- Mapper harus cukup eksplisit agar bisa direview sebagai database contract.

---

## 3. Layer Responsibility

### 3.1 Controller / API Adapter

Controller bertugas menerima request dan mengembalikan response. Ia tidak boleh tahu detail SQL.

Controller boleh tahu:

- request DTO;
- response DTO;
- HTTP status;
- user/session principal;
- validation format dasar.

Controller tidak boleh tahu:

- nama tabel;
- nama kolom;
- SQL fragment;
- transaction propagation;
- locking strategy;
- pagination SQL detail;
- tenant predicate detail.

Contoh buruk:

```java
@GetMapping("/cases")
public List<CaseRow> search(CaseSearchCriteria criteria) {
    return caseMapper.searchCases(criteria);
}
```

Masalah:

- Controller langsung memakai mapper.
- Tidak ada authorization orchestration.
- Tidak ada observability use-case level.
- Tidak ada boundary untuk default pagination.
- Mapper mudah disalahgunakan dari endpoint lain.

Contoh lebih baik:

```java
@GetMapping("/cases")
public PageResponse<CaseListItemResponse> search(
        CaseSearchRequest request,
        AuthenticatedUser user) {

    CaseSearchQuery query = request.toQuery(user);
    return caseSearchService.searchCases(query);
}
```

---

### 3.2 Application Service

Application service adalah tempat transaction boundary dan use-case orchestration.

Ia bertanggung jawab atas:

- `@Transactional`;
- authorization orchestration;
- state transition orchestration;
- idempotency;
- concurrency result interpretation;
- mapper call sequence;
- after-commit event/outbox;
- failure translation ke application error.

Contoh:

```java
@Service
public class CaseApprovalService {

    private final CaseCommandMapper caseCommandMapper;
    private final OutboxMapper outboxMapper;
    private final AuthorizationPolicy authorizationPolicy;

    @Transactional
    public ApproveCaseResult approve(ApproveCaseCommand command) {
        authorizationPolicy.requireCanApprove(command.actor(), command.caseId());

        int updated = caseCommandMapper.approveIfCurrentState(command);

        if (updated == 0) {
            return ApproveCaseResult.conflictOrNotFound();
        }

        outboxMapper.insertEvent(OutboxEvent.caseApproved(command.caseId(), command.actor().userId()));

        return ApproveCaseResult.approved();
    }
}
```

Service tidak harus tahu SQL detail, tetapi harus tahu semantic result.

---

### 3.3 Domain / Policy Layer

Domain/policy layer memegang aturan yang tidak boleh bocor ke SQL secara acak.

Contoh:

- status transition valid;
- role allowed to approve;
- agency ownership;
- case visibility;
- escalation rule;
- enforcement lifecycle invariant.

SQL boleh membantu enforcement melalui conditional update, tetapi rule-nya harus tetap dimodelkan secara jelas.

Contoh state transition rule:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED / REJECTED
```

Mapper update harus melindungi transition secara atomic:

```sql
UPDATE enforcement_case
SET status = 'APPROVED',
    version = version + 1,
    approved_by = #{actorUserId},
    approved_at = CURRENT_TIMESTAMP
WHERE case_id = #{caseId}
  AND status = 'UNDER_REVIEW'
  AND version = #{expectedVersion}
  AND agency_id = #{agencyId}
```

Ini bukan mengganti domain model. Ini adalah **database-side invariant guard**.

---

### 3.4 Persistence Adapter

Persistence adapter berguna jika mapper terlalu low-level untuk langsung dipakai service.

Contoh situasi yang cocok:

- perlu combine beberapa mapper call;
- perlu translate row menjadi domain snapshot;
- perlu hide vendor-specific mapper;
- perlu fallback query;
- perlu compose parent-child result secara manual;
- perlu normalize database exception.

Struktur:

```text
case/
  application/
    CaseApprovalService.java
    CaseSearchService.java
  domain/
    CaseStatus.java
    CasePolicy.java
  persistence/
    CaseCommandPersistence.java
    CaseQueryPersistence.java
    mapper/
      CaseCommandMapper.java
      CaseQueryMapper.java
      CaseReportMapper.java
    xml/
      CaseCommandMapper.xml
      CaseQueryMapper.xml
      CaseReportMapper.xml
```

Mapper tetap pure database contract. Persistence adapter boleh menjadi anti-corruption layer.

---

## 4. Mapper Taxonomy untuk Sistem Besar

Untuk sistem kecil, satu mapper per aggregate mungkin cukup. Untuk sistem besar, mapper perlu diklasifikasikan.

Rekomendasi taxonomy:

```text
CommandMapper
  Untuk insert/update/delete/state transition/lock/idempotency.

QueryMapper
  Untuk lookup, detail, search listing, projection biasa.

SearchMapper
  Untuk complex dynamic filter listing.

ReportMapper
  Untuk report/dashboard/export query.

AuditMapper
  Untuk append/read audit trail.

ReferenceMapper
  Untuk lookup/reference data.

WorkerMapper
  Untuk queue claim, retry, batch job, scheduled processing.
```

Contoh:

```java
public interface CaseCommandMapper {
    int submitCase(SubmitCaseCommand command);
    int approveIfUnderReview(ApproveCaseCommand command);
    int assignOfficer(AssignOfficerCommand command);
    int softDeleteCase(DeleteCaseCommand command);
}
```

```java
public interface CaseQueryMapper {
    Optional<CaseDetailRow> findCaseDetail(CaseDetailQuery query);
    List<CaseListItemRow> searchCases(CaseSearchCriteria criteria);
    long countCases(CaseSearchCriteria criteria);
}
```

```java
public interface CaseReportMapper {
    List<CaseMonthlyStatusSummaryRow> summarizeMonthlyStatus(CaseReportCriteria criteria);
}
```

Manfaat taxonomy:

- lebih mudah review;
- lebih jelas ownership;
- lebih mudah performance profiling;
- lebih mudah security audit;
- lebih mudah deprecate mapper method;
- lebih sedikit god mapper.

---

## 5. Mapper Method Contract Design

Mapper method harus menjawab minimal lima hal:

1. Cardinality: hasilnya satu, optional, list bounded, cursor, atau count?
2. Scope: apakah tenant/agency/module/user visibility sudah ada?
3. Consistency: apakah method ini read biasa, lock read, atau update atomic?
4. Failure: apa arti return `0`, `null`, empty list, atau exception?
5. Performance: apakah query bounded, paginated, streaming, atau report?

Contoh method buruk:

```java
List<Map<String, Object>> getData(Map<String, Object> params);
```

Masalah:

- tidak jelas data apa;
- tidak jelas scope;
- tidak jelas result shape;
- tidak jelas cardinality;
- tidak type-safe;
- sulit diuji;
- sulit direview security.

Contoh method lebih baik:

```java
List<CaseListItemRow> searchVisibleCases(CaseSearchCriteria criteria);
long countVisibleCases(CaseSearchCriteria criteria);
```

Untuk command:

```java
int approveIfCurrentStateAndVersion(ApproveCaseCommand command);
```

Nama method sengaja panjang karena mengandung contract:

- approve;
- only if current state;
- only if expected version;
- result `int` harus dicek.

---

## 6. Parameter Object Standard

Hindari mapper method dengan banyak parameter scalar.

Contoh buruk:

```java
List<CaseListItemRow> search(
    String keyword,
    String status,
    String agencyId,
    Long userId,
    Integer limit,
    Integer offset,
    String sortBy,
    String sortDirection
);
```

Masalah:

- mudah tertukar;
- dynamic SQL sulit dibaca;
- tidak ada invariant object;
- sulit menambah field;
- sulit validate.

Contoh lebih baik:

```java
public final class CaseSearchCriteria {
    private final DataScope scope;
    private final String keyword;
    private final CaseStatus status;
    private final Instant submittedFrom;
    private final Instant submittedToExclusive;
    private final PageRequest page;
    private final CaseSort sort;
}
```

Prinsip:

```text
DataScope != Search Filter
Pagination != Business Criteria
Sort != Raw SQL String
Command != Query
```

Contoh `DataScope`:

```java
public final class DataScope {
    private final String tenantId;
    private final String agencyId;
    private final String moduleCode;
    private final Long actorUserId;
    private final Set<String> visibilityRoles;
}
```

Dengan cara ini, scope menjadi object wajib, bukan optional predicate yang mudah lupa.

---

## 7. Result Object Standard

Gunakan result object yang eksplisit.

Jenis result object:

```text
Row object
  Merepresentasikan satu row atau projection hasil SQL.

Detail DTO
  Merepresentasikan detail read model.

List item DTO
  Merepresentasikan item listing.

Summary DTO
  Merepresentasikan aggregate/dashboard result.

Domain snapshot
  Merepresentasikan state minimum untuk domain decision.
```

Jangan gunakan satu entity/domain object untuk semua query.

Contoh buruk:

```java
CaseEntity findById(Long id);
List<CaseEntity> searchCases(CaseSearchCriteria criteria);
List<CaseEntity> reportCases(CaseReportCriteria criteria);
```

Masalah:

- detail/list/report punya shape berbeda;
- over-fetching;
- resultMap membengkak;
- perubahan satu field merusak banyak query;
- domain object jadi database DTO.

Contoh lebih baik:

```java
CaseDetailRow findCaseDetail(CaseDetailQuery query);
List<CaseListItemRow> searchCases(CaseSearchCriteria criteria);
List<CaseMonthlySummaryRow> summarizeMonthly(CaseReportCriteria criteria);
CaseDecisionSnapshot findDecisionSnapshot(CaseDecisionQuery query);
```

---

## 8. XML Mapper Structure Standard

Struktur XML yang direkomendasikan:

```xml
<mapper namespace="com.example.case.persistence.mapper.CaseQueryMapper">

  <!-- Result maps -->
  <resultMap id="CaseListItemMap" type="CaseListItemRow">
    ...
  </resultMap>

  <resultMap id="CaseDetailMap" type="CaseDetailRow">
    ...
  </resultMap>

  <!-- SQL fragments: only stable, local, non-magical fragments -->
  <sql id="VisibleCaseScopePredicate">
    c.tenant_id = #{scope.tenantId}
    AND c.agency_id = #{scope.agencyId}
  </sql>

  <!-- Statements -->
  <select id="searchVisibleCases" resultMap="CaseListItemMap">
    ...
  </select>

  <select id="countVisibleCases" resultType="long">
    ...
  </select>

</mapper>
```

Order dalam XML:

1. resultMap;
2. reusable SQL fragment lokal;
3. select statement;
4. insert statement;
5. update statement;
6. delete statement.

Untuk mapper besar, pecah mapper. Jangan membuat XML ribuan baris jika sebenarnya ada beberapa use-case berbeda.

---

## 9. SQL Style Standard

Gunakan SQL style yang konsisten.

Contoh:

```sql
SELECT
    c.case_id              AS case_id,
    c.case_no              AS case_no,
    c.status               AS status,
    c.priority             AS priority,
    c.submitted_at         AS submitted_at,
    officer.display_name   AS officer_name
FROM enforcement_case c
LEFT JOIN officer officer
    ON officer.officer_id = c.assigned_officer_id
WHERE c.tenant_id = #{scope.tenantId}
  AND c.agency_id = #{scope.agencyId}
  AND c.deleted = 0
ORDER BY c.submitted_at DESC, c.case_id DESC
FETCH FIRST #{page.limit} ROWS ONLY
```

Standar:

- Jangan `SELECT *`.
- Alias kolom harus eksplisit.
- Predicate scope harus terlihat jelas.
- Sorting harus deterministic.
- Pagination harus bounded.
- Join condition harus jelas.
- Dynamic condition jangan mengubah makna security predicate.
- Gunakan `#{}` untuk values.
- Gunakan `${}` hanya untuk identifier yang sudah whitelist.

---

## 10. Safe Dynamic SQL Standard

Dynamic SQL tidak boleh menjadi tempat mencampur semua kemungkinan UI filter tanpa batas.

Standard dynamic SQL:

```xml
<where>
  c.tenant_id = #{scope.tenantId}
  AND c.agency_id = #{scope.agencyId}
  AND c.deleted = 0

  <if test="keyword != null and keyword != ''">
    AND (
      UPPER(c.case_no) LIKE #{keywordLike}
      OR UPPER(c.subject) LIKE #{keywordLike}
    )
  </if>

  <if test="status != null">
    AND c.status = #{status}
  </if>

  <if test="submittedFrom != null">
    AND c.submitted_at &gt;= #{submittedFrom}
  </if>

  <if test="submittedToExclusive != null">
    AND c.submitted_at &lt; #{submittedToExclusive}
  </if>
</where>
```

Rule:

1. Scope predicate selalu paling atas.
2. Soft delete visibility selalu eksplisit.
3. Security predicate tidak boleh di dalam optional `<if>` kecuali invariant-nya jelas.
4. Dynamic sort harus lewat enum whitelist.
5. Empty list harus punya semantic eksplisit.
6. Large IN clause harus punya batas.
7. Complex search harus punya test per kombinasi penting.

---

## 11. Sorting Standard

Jangan pernah menerima raw sort field dari request lalu langsung disisipkan ke SQL.

Buruk:

```xml
ORDER BY ${sortBy} ${sortDirection}
```

Aman:

```java
public enum CaseSortColumn {
    SUBMITTED_AT("c.submitted_at"),
    CASE_NO("c.case_no"),
    PRIORITY("c.priority");

    private final String sqlExpression;
}
```

```xml
ORDER BY ${sort.sqlExpression} ${sort.directionSql}, c.case_id DESC
```

Syarat:

- `sort.sqlExpression` berasal dari enum internal;
- `directionSql` hanya `ASC` atau `DESC`;
- tidak pernah raw user input;
- selalu ada tie-breaker unik.

---

## 12. Pagination Standard

Gunakan tiga jenis pagination sesuai kebutuhan.

### 12.1 Offset Pagination

Cocok untuk:

- halaman kecil;
- admin UI;
- result size sedang;
- user butuh lompat halaman.

Risiko:

- lambat di page dalam;
- tidak stabil saat concurrent write;
- count bisa mahal.

### 12.2 Keyset Pagination

Cocok untuk:

- infinite scroll;
- feed;
- audit timeline;
- result besar;
- export incremental.

Contoh predicate:

```sql
AND (
    c.submitted_at < #{cursor.submittedAt}
    OR (
        c.submitted_at = #{cursor.submittedAt}
        AND c.case_id < #{cursor.caseId}
    )
)
ORDER BY c.submitted_at DESC, c.case_id DESC
FETCH FIRST #{limit} ROWS ONLY
```

### 12.3 Cursor / Streaming

Cocok untuk:

- export;
- ETL;
- background job;
- large read.

Tidak cocok untuk:

- response UI biasa;
- transaction panjang yang memblokir resource;
- nested select/lazy loading tidak terkendali.

---

## 13. Transaction Standard

Prinsip:

```text
Transaction belongs to use case, not mapper.
```

Rule:

1. `@Transactional` berada di service layer.
2. Mapper tidak commit/rollback.
3. External call tidak dilakukan di tengah transaction kecuali benar-benar perlu.
4. Long-running export tidak memakai transaction besar.
5. Batch memakai chunk transaction.
6. Update penting selalu cek rows affected.
7. Lock acquisition harus punya timeout/retry policy.
8. Outbox event ditulis dalam transaction yang sama dengan state change.

Contoh command service:

```java
@Transactional
public SubmitCaseResult submit(SubmitCaseCommand command) {
    int updated = caseCommandMapper.submitIfDraft(command);

    if (updated == 0) {
        return SubmitCaseResult.conflictOrNotFound();
    }

    outboxMapper.insertEvent(OutboxEvent.caseSubmitted(command.caseId()));
    return SubmitCaseResult.submitted();
}
```

---

## 14. Concurrency Standard

Gunakan database sebagai atomic guard.

### 14.1 Optimistic Locking

```sql
UPDATE enforcement_case
SET status = #{newStatus},
    version = version + 1,
    updated_by = #{actorUserId},
    updated_at = CURRENT_TIMESTAMP
WHERE case_id = #{caseId}
  AND tenant_id = #{scope.tenantId}
  AND agency_id = #{scope.agencyId}
  AND version = #{expectedVersion}
```

Return `0` berarti:

- not found;
- wrong tenant/agency;
- stale version;
- already updated.

Service perlu membedakan jika perlu, tapi jangan mengorbankan atomicity.

### 14.2 State Transition Guard

```sql
UPDATE enforcement_case
SET status = 'APPROVED',
    version = version + 1
WHERE case_id = #{caseId}
  AND status = 'UNDER_REVIEW'
  AND version = #{expectedVersion}
```

### 14.3 Worker Claim

```sql
UPDATE job_queue
SET status = 'PROCESSING',
    claimed_by = #{workerId},
    claimed_at = CURRENT_TIMESTAMP
WHERE job_id IN (
    SELECT job_id
    FROM job_queue
    WHERE status = 'READY'
    ORDER BY priority DESC, created_at ASC
    FETCH FIRST #{limit} ROWS ONLY
)
```

Vendor-specific syntax perlu disesuaikan untuk `SKIP LOCKED`, `NOWAIT`, atau lock hint.

---

## 15. Security Standard

Security di mapper tidak boleh bergantung pada niat baik developer.

Invariants:

```text
Every data access must be scoped.
Every mutation must be scoped.
Every dynamic identifier must be whitelisted.
Every sensitive projection must be intentional.
Every affected row count must be interpreted.
```

### 15.1 Scope Parameter Required

Semua query non-reference harus punya `DataScope`.

```java
public final class CaseDetailQuery {
    private final DataScope scope;
    private final long caseId;
}
```

### 15.2 Secure Detail Query

```sql
SELECT
    c.case_id AS case_id,
    c.case_no AS case_no,
    c.status AS status,
    c.subject AS subject
FROM enforcement_case c
WHERE c.case_id = #{caseId}
  AND c.tenant_id = #{scope.tenantId}
  AND c.agency_id = #{scope.agencyId}
  AND c.deleted = 0
```

### 15.3 Secure Update

```sql
UPDATE enforcement_case
SET assigned_officer_id = #{officerId}
WHERE case_id = #{caseId}
  AND tenant_id = #{scope.tenantId}
  AND agency_id = #{scope.agencyId}
  AND deleted = 0
```

If rows affected = 0, jangan langsung bilang “not found” tanpa mempertimbangkan forbidden/stale/deleted.

---

## 16. Observability Standard

Minimal observability untuk production:

1. statement id;
2. duration;
3. row count / affected rows;
4. exception type;
5. correlation id;
6. tenant/agency/module metadata, jika aman;
7. parameter shape, bukan raw sensitive value;
8. SQL shape hash untuk grouping;
9. slow query threshold;
10. query count per request.

Contoh log konseptual:

```json
{
  "event": "mybatis.sql.completed",
  "traceId": "abc123",
  "statementId": "CaseQueryMapper.searchVisibleCases",
  "durationMs": 184,
  "rowCount": 25,
  "tenantId": "T1",
  "agencyId": "CEA",
  "sqlShape": "case_search_v3",
  "slow": false
}
```

Jangan log:

- password;
- token;
- NRIC/ID sensitif;
- full free text;
- full CLOB/BLOB;
- raw payload besar;
- data pribadi yang tidak perlu.

---

## 17. Testing Standard

Testing MyBatis harus membuktikan contract, bukan hanya coverage.

Layer test:

```text
Mapper parse test
  XML valid, mapper scan valid, statement id valid.

Mapper integration test
  SQL berjalan di database nyata/vendor-real.

Dynamic SQL branch test
  Kombinasi filter penting menghasilkan SQL dan result benar.

Security test
  Tenant/agency/user scope tidak bocor.

Concurrency test
  Version/state guard bekerja.

Migration compatibility test
  Mapper tetap valid setelah schema migration.

Performance smoke test
  Query bounded, index path reasonable, no obvious N+1.
```

Checklist mapper test:

- zero row;
- one row;
- multiple row;
- duplicate unexpected row;
- null column;
- unknown enum code;
- deleted row;
- wrong tenant;
- unauthorized role;
- stale version;
- empty filter;
- empty list;
- large list;
- boundary date;
- special keyword;
- SQL injection attempt;
- pagination page 1/page 2;
- stable sort tie-breaker.

---

## 18. Migration Standard

Mapper dan schema harus berevolusi bersama.

Gunakan pattern:

```text
Expand
  Tambah schema baru secara backward-compatible.

Migrate
  Backfill data / dual write / read fallback.

Contract
  Hapus schema lama setelah semua aplikasi tidak lagi bergantung.
```

Contoh rename kolom aman:

```text
1. Add new column.
2. Deploy app writing old + new.
3. Backfill new from old.
4. Deploy app reading new.
5. Stop writing old.
6. Drop old column later.
```

Jangan langsung rename kolom yang masih dibaca mapper lama dalam deployment rolling.

---

## 19. Cache Standard

Default rekomendasi untuk sistem enterprise:

```text
First-level cache: pahami, jangan dilawan tanpa alasan.
Second-level cache: off by default, enable only with strong consistency reasoning.
Application/Redis cache: gunakan explicit service-level cache untuk use-case yang jelas.
```

Jangan cache:

- query tenant-sensitive tanpa key lengkap;
- result besar;
- LOB;
- mutable object graph;
- data yang sering berubah;
- authorization-dependent projection kecuali key mencakup authorization dimension.

---

## 20. Batch Standard

Batch harus dirancang sebagai workflow, bukan loop cepat.

Checklist:

- chunk size eksplisit;
- transaction per chunk;
- idempotency key;
- retry policy;
- partial failure handling;
- progress table;
- metrics;
- timeout;
- lock strategy;
- memory limit;
- audit trail;
- cancellation strategy.

Contoh batch architecture:

```text
BatchJobService
  -> claim next N rows
  -> process chunk
  -> write result/audit/outbox
  -> commit
  -> repeat
```

Jangan membuat satu transaction untuk ratusan ribu row kecuali alasan dan kapasitasnya sudah jelas.

---

## 21. Large Result / LOB Standard

Rule:

1. Listing tidak mengambil CLOB/BLOB.
2. Detail mengambil payload besar hanya jika dibutuhkan.
3. Export besar memakai async job.
4. Cursor/ResultHandler dipakai dengan lifecycle jelas.
5. `selectList` hanya untuk bounded result.
6. Local cache diperhatikan untuk large result.
7. Logging tidak mencetak LOB.
8. Pagination root-first untuk one-to-many.

Metadata-first query:

```sql
SELECT
    a.audit_id AS audit_id,
    a.module_code AS module_code,
    a.action AS action,
    a.created_at AS created_at
FROM audit_trail a
WHERE a.tenant_id = #{scope.tenantId}
ORDER BY a.created_at DESC, a.audit_id DESC
FETCH FIRST #{limit} ROWS ONLY
```

Payload query terpisah:

```sql
SELECT
    a.audit_id AS audit_id,
    a.full_text AS full_text
FROM audit_trail a
WHERE a.audit_id = #{auditId}
  AND a.tenant_id = #{scope.tenantId}
```

---

## 22. Plugin / Interceptor Standard

Interceptor boleh dipakai untuk cross-cutting concern, tetapi harus dibatasi.

Cocok untuk:

- metrics;
- query count;
- SQL shape tagging;
- dangerous DML guard;
- tenant predicate detection;
- statement timeout policy.

Berbahaya untuk:

- rewriting SQL kompleks;
- menyisipkan authorization rule tersembunyi;
- mengubah result object;
- mengubah parameter object;
- encryption/decryption tanpa contract jelas;
- pagination otomatis global tanpa kontrol.

Rule:

```text
Interceptor should observe or guard more often than mutate.
```

---

## 23. Example: Production-Grade Case Search

### 23.1 Criteria

```java
public final class CaseSearchCriteria {
    private final DataScope scope;
    private final String keywordLike;
    private final CaseStatus status;
    private final Instant submittedFrom;
    private final Instant submittedToExclusive;
    private final PageRequest page;
    private final CaseSort sort;
}
```

### 23.2 Mapper Interface

```java
public interface CaseSearchMapper {
    List<CaseListItemRow> searchVisibleCases(CaseSearchCriteria criteria);
    long countVisibleCases(CaseSearchCriteria criteria);
}
```

### 23.3 XML Mapper

```xml
<mapper namespace="com.example.case.persistence.mapper.CaseSearchMapper">

  <resultMap id="CaseListItemMap" type="com.example.case.persistence.row.CaseListItemRow">
    <id property="caseId" column="case_id"/>
    <result property="caseNo" column="case_no"/>
    <result property="status" column="status"/>
    <result property="priority" column="priority"/>
    <result property="submittedAt" column="submitted_at"/>
    <result property="officerName" column="officer_name"/>
  </resultMap>

  <sql id="VisibleCasePredicate">
    c.tenant_id = #{scope.tenantId}
    AND c.agency_id = #{scope.agencyId}
    AND c.deleted = 0
  </sql>

  <select id="searchVisibleCases" resultMap="CaseListItemMap">
    SELECT
        c.case_id            AS case_id,
        c.case_no            AS case_no,
        c.status             AS status,
        c.priority           AS priority,
        c.submitted_at       AS submitted_at,
        o.display_name       AS officer_name
    FROM enforcement_case c
    LEFT JOIN officer o
        ON o.officer_id = c.assigned_officer_id
    <where>
      <include refid="VisibleCasePredicate"/>

      <if test="keywordLike != null">
        AND (
          UPPER(c.case_no) LIKE #{keywordLike}
          OR UPPER(c.subject) LIKE #{keywordLike}
        )
      </if>

      <if test="status != null">
        AND c.status = #{status}
      </if>

      <if test="submittedFrom != null">
        AND c.submitted_at &gt;= #{submittedFrom}
      </if>

      <if test="submittedToExclusive != null">
        AND c.submitted_at &lt; #{submittedToExclusive}
      </if>
    </where>
    ORDER BY ${sort.sqlExpression} ${sort.directionSql}, c.case_id DESC
    OFFSET #{page.offset} ROWS FETCH NEXT #{page.limit} ROWS ONLY
  </select>

  <select id="countVisibleCases" resultType="long">
    SELECT COUNT(1)
    FROM enforcement_case c
    <where>
      <include refid="VisibleCasePredicate"/>

      <if test="keywordLike != null">
        AND (
          UPPER(c.case_no) LIKE #{keywordLike}
          OR UPPER(c.subject) LIKE #{keywordLike}
        )
      </if>

      <if test="status != null">
        AND c.status = #{status}
      </if>

      <if test="submittedFrom != null">
        AND c.submitted_at &gt;= #{submittedFrom}
      </if>

      <if test="submittedToExclusive != null">
        AND c.submitted_at &lt; #{submittedToExclusive}
      </if>
    </where>
  </select>
</mapper>
```

Important caveat:

```text
${sort.sqlExpression} dan ${sort.directionSql} hanya aman jika berasal dari enum whitelist internal.
Jika berasal dari request langsung, ini SQL injection vulnerability.
```

---

## 24. Example: Production-Grade State Transition

### 24.1 Command

```java
public final class ApproveCaseCommand {
    private final DataScope scope;
    private final long caseId;
    private final long expectedVersion;
    private final long actorUserId;
    private final String approvalComment;
}
```

### 24.2 Mapper

```java
public interface CaseCommandMapper {
    int approveIfUnderReviewAndVersionMatches(ApproveCaseCommand command);
}
```

### 24.3 XML

```xml
<update id="approveIfUnderReviewAndVersionMatches">
  UPDATE enforcement_case
  SET status = 'APPROVED',
      version = version + 1,
      approved_by = #{actorUserId},
      approved_at = CURRENT_TIMESTAMP,
      approval_comment = #{approvalComment},
      updated_by = #{actorUserId},
      updated_at = CURRENT_TIMESTAMP
  WHERE case_id = #{caseId}
    AND tenant_id = #{scope.tenantId}
    AND agency_id = #{scope.agencyId}
    AND status = 'UNDER_REVIEW'
    AND version = #{expectedVersion}
    AND deleted = 0
</update>
```

### 24.4 Service Interpretation

```java
@Transactional
public ApproveCaseResult approve(ApproveCaseCommand command) {
    authorizationPolicy.requireCanApprove(command);

    int updated = caseCommandMapper.approveIfUnderReviewAndVersionMatches(command);

    if (updated == 1) {
        outboxMapper.insertEvent(OutboxEvent.caseApproved(command.caseId()));
        return ApproveCaseResult.approved();
    }

    return ApproveCaseResult.notUpdatedDueToConflictOrVisibility();
}
```

Rows affected adalah bagian dari business correctness.

---

## 25. Example: Production-Grade Outbox Insert

```xml
<insert id="insertOutboxEvent">
  INSERT INTO outbox_event (
      event_id,
      aggregate_type,
      aggregate_id,
      event_type,
      payload_json,
      status,
      created_at
  ) VALUES (
      #{eventId},
      #{aggregateType},
      #{aggregateId},
      #{eventType},
      #{payloadJson,jdbcType=CLOB},
      'READY',
      CURRENT_TIMESTAMP
  )
</insert>
```

Outbox insert harus satu transaction dengan state change.

Jika event delivery gagal setelah commit, worker bisa retry.
Jika state change rollback, outbox event juga rollback.

---

## 26. Example: Worker Claim Pattern

Worker claim harus atomic agar dua worker tidak mengambil job yang sama.

Pseudo pattern:

```sql
UPDATE outbox_event
SET status = 'PROCESSING',
    claimed_by = #{workerId},
    claimed_at = CURRENT_TIMESTAMP
WHERE event_id IN (
    SELECT event_id
    FROM outbox_event
    WHERE status = 'READY'
      AND next_attempt_at <= CURRENT_TIMESTAMP
    ORDER BY created_at ASC
    FETCH FIRST #{limit} ROWS ONLY
)
```

Untuk database yang mendukung, gunakan `SKIP LOCKED` agar worker paralel tidak saling menunggu terlalu lama.

---

## 27. Java 8 sampai Java 25 Design Guidance

### 27.1 Java 8 Baseline

Gunakan:

- immutable class manual;
- builder pattern;
- `Optional` untuk service/repository boundary dengan hati-hati;
- explicit DTO class;
- XML mapper sebagai pilihan aman;
- MyBatis starter yang compatible dengan Spring Boot 2.x jika legacy.

Hindari:

- record;
- sealed class;
- virtual thread assumption;
- API modern yang tidak tersedia.

### 27.2 Java 11

Java 11 biasanya transitional. Fokus pada:

- dependency modernization;
- modular cleanup;
- testcontainers adoption;
- better JVM runtime;
- migration preparation ke Java 17.

### 27.3 Java 17

Java 17 adalah baseline kuat untuk modern Spring Boot 3.

Gunakan:

- records untuk simple read projection jika cocok;
- sealed hierarchy untuk result type jika codebase siap;
- stronger nullability discipline;
- modern switch expression;
- better observability stack.

### 27.4 Java 21+

Java 21 membawa virtual threads, tetapi MyBatis/JDBC tetap blocking I/O.

Rule:

```text
Virtual thread can improve thread scalability, but cannot fix slow SQL, bad index, lock contention, or connection pool exhaustion.
```

Perhatikan:

- connection pool tetap bottleneck;
- transaction tetap memegang connection;
- cursor tetap memegang resource;
- long blocking query tetap membebani database;
- concurrency limit tetap wajib.

### 27.5 Java 25

Untuk Java 25, prinsipnya sama:

- jangan gunakan fitur bahasa baru jika mematahkan kompatibilitas library/framework;
- pastikan Spring Boot/MyBatis/driver support;
- gunakan modern Java untuk expressiveness, bukan untuk menyembunyikan SQL contract.

---

## 28. Production Readiness Checklist

### 28.1 Design Checklist

- [ ] Mapper dibagi berdasarkan use-case/taxonomy.
- [ ] Controller tidak memanggil mapper langsung.
- [ ] Transaction boundary berada di service layer.
- [ ] Mapper method punya nama dan return type yang jelas.
- [ ] Parameter object typed, bukan raw map.
- [ ] Result object explicit, bukan generic map.
- [ ] Query list bounded atau streaming.
- [ ] Command update mengecek rows affected.
- [ ] State transition dilindungi predicate atomic.
- [ ] Authorization/tenant scope masuk ke semua query sensitif.

### 28.2 SQL Checklist

- [ ] Tidak ada `SELECT *`.
- [ ] Semua column alias eksplisit.
- [ ] Dynamic SQL punya test branch penting.
- [ ] `${}` hanya dari whitelist internal.
- [ ] Sorting deterministic.
- [ ] Pagination bounded.
- [ ] Count strategy jelas.
- [ ] Large result tidak memakai `selectList` unbounded.
- [ ] LOB tidak ikut listing.
- [ ] Query punya index strategy.

### 28.3 Security Checklist

- [ ] Tenant/agency/module scope required.
- [ ] Row-level visibility diuji.
- [ ] Update/delete scoped.
- [ ] Sensitive field projection intentional.
- [ ] SQL injection test ada.
- [ ] LIKE escaping aman.
- [ ] Dynamic identifier whitelist.
- [ ] Cache key mencakup security dimension jika cache dipakai.
- [ ] Logs tidak memuat PII/secret/raw payload.

### 28.4 Transaction/Concurrency Checklist

- [ ] `@Transactional` di service layer.
- [ ] No external long call inside DB transaction jika tidak perlu.
- [ ] Optimistic locking untuk collaborative update.
- [ ] Pessimistic lock hanya jika perlu.
- [ ] Deadlock retry boundary jelas.
- [ ] Lock order konsisten.
- [ ] Batch memakai chunk transaction.
- [ ] Outbox satu transaction dengan state change.

### 28.5 Observability Checklist

- [ ] Statement id muncul di log/metrics.
- [ ] Duration tercatat.
- [ ] Slow SQL threshold ada.
- [ ] Query count per request bisa diamati.
- [ ] N+1 bisa dideteksi.
- [ ] Correlation id/MDC aktif.
- [ ] Affected rows tercatat untuk command penting.
- [ ] Batch metrics tersedia.
- [ ] Error classification tersedia.

### 28.6 Testing Checklist

- [ ] Mapper XML parse test.
- [ ] Mapper integration test pakai DB vendor nyata untuk query kritikal.
- [ ] Dynamic SQL branch test.
- [ ] Result mapping test.
- [ ] Tenant isolation test.
- [ ] Authorization matrix test.
- [ ] Pagination stability test.
- [ ] Concurrency test.
- [ ] Migration compatibility test.
- [ ] Regression test untuk incident produksi.

### 28.7 Governance Checklist

- [ ] Mapper ownership jelas.
- [ ] Naming convention konsisten.
- [ ] Review checklist diterapkan.
- [ ] SQL fragment reuse dibatasi.
- [ ] God mapper dipecah.
- [ ] Dead mapper method dideteksi.
- [ ] Deprecated mapper method punya removal plan.
- [ ] Unsafe pattern discan otomatis.
- [ ] Performance/security/schema review wajib untuk mapper kritikal.

---

## 29. Common Design Failure and Corrective Action

| Failure | Root Cause | Corrective Action |
|---|---|---|
| Query lambat | SQL shape buruk, index tidak cocok, result terlalu besar | Plan review, index redesign, projection trim, keyset pagination |
| Tenant leakage | Scope predicate tidak mandatory | `DataScope` wajib, static analysis, interceptor guard, test matrix |
| SQL injection | `${}` dari user input | Enum whitelist, `#{}` binding, input normalization |
| Lost update | Update tanpa version/state guard | Optimistic locking, conditional update, rows affected check |
| Memory spike | `selectList` unbounded, LOB ikut query | Cursor, chunking, metadata-first, export async |
| Stale data | Misuse second-level cache | Disable cache, explicit cache strategy, invalidation review |
| Mapper sulit dirawat | God mapper, copy-paste SQL | Taxonomy, split mapper, shared standard, mapper inventory |
| Migration break | Destructive schema change | Expand-migrate-contract, compatibility tests |
| N+1 | Nested select/lazy loading tidak dikontrol | Projection, batch child fetch, query count metric |
| Debugging sulit | Tidak ada statement id/duration/correlation | Observability interceptor/logging standard |

---

## 30. Mental Model Akhir

Setelah menyelesaikan seri ini, mental model yang perlu melekat adalah:

```text
MyBatis is not an ORM magic layer.
MyBatis is an explicit SQL execution and mapping control layer.
```

Kekuatan MyBatis:

- SQL eksplisit;
- mapping fleksibel;
- vendor-specific optimization mudah;
- cocok untuk complex reporting/search;
- cocok untuk legacy database;
- cocok untuk controlled persistence boundary.

Kelemahannya:

- discipline harus datang dari tim;
- SQL bisa tersebar;
- dynamic SQL bisa sulit diuji;
- security scope bisa lupa;
- caching bisa menipu;
- mapper bisa menjadi god object;
- result mapping bug bisa diam-diam.

Top-tier engineer membangun guardrail agar kekuatan MyBatis bisa dipakai tanpa membiarkan kelemahannya merusak sistem.

---

## 31. Ringkasan Seluruh Seri

Seri ini bergerak dari fondasi ke production architecture:

```text
Part 0–3
  Posisi MyBatis, runtime, mapper design.

Part 4–10
  Statement, parameter, result mapping, dynamic SQL, mapper API.

Part 11–14
  Transaction, Spring Boot integration, TypeHandler, vendor awareness.

Part 15–22
  Pagination, batch, cache, object graph, procedure, concurrency,
  performance, observability.

Part 23–27
  Testing, migration, security, multi-tenancy, large result/LOB.

Part 28–33
  Governance, interceptor, advanced read architecture, troubleshooting,
  refactoring, and capstone production-grade design.
```

---

## 32. Final Practical Blueprint

Jika harus merancang MyBatis layer dari nol untuk sistem enterprise, gunakan blueprint berikut:

```text
1. Tetapkan module boundary.
2. Tetapkan mapper taxonomy: command/query/search/report/audit/worker.
3. Definisikan DataScope wajib.
4. Definisikan parameter object typed.
5. Definisikan result object per use-case.
6. Gunakan explicit resultMap untuk query penting.
7. Larang SELECT *.
8. Larang raw ${} kecuali enum whitelist.
9. Buat transaction boundary di service.
10. Gunakan rows affected sebagai correctness signal.
11. Gunakan optimistic/state predicate untuk update kritikal.
12. Pilih pagination berdasarkan use-case.
13. Pisahkan listing metadata dari LOB/detail payload.
14. Tambahkan observability sejak awal.
15. Test mapper dengan database vendor nyata untuk query kritikal.
16. Kelola schema migration dengan expand-migrate-contract.
17. Terapkan review checklist untuk mapper change.
18. Refactor legacy mapper bertahap dengan characterization test.
```

---

## 33. Penutup

MyBatis terlihat sederhana karena API-nya sederhana. Namun di sistem besar, kesulitannya bukan menjalankan SQL. Kesulitannya adalah menjaga agar SQL tetap:

- benar;
- aman;
- cepat;
- bisa diuji;
- bisa diamati;
- bisa berevolusi;
- bisa dipahami oleh engineer lain;
- tidak merusak invariant bisnis;
- tidak membocorkan data;
- tidak membuat incident produksi sulit ditangani.

Jika kamu bisa mendesain MyBatis layer dengan semua aspek di atas, kamu tidak hanya “bisa MyBatis”. Kamu memahami persistence engineering sebagai bagian inti dari software architecture.

---

# Status Seri

Seri `learn-java-mybatis-sql-mapper-persistence-engineering` **selesai**.

Total bagian: **34 part**, dari Part 0 sampai Part 33.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./32-refactoring-legacy-mybatis-systems.md">⬅️ Part 32 — Refactoring Legacy MyBatis Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<span></span>
</div>

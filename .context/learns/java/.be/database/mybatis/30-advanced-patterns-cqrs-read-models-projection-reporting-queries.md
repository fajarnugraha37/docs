# Part 30 — Advanced Patterns: CQRS Read Models, Projection Mapper, Reporting Queries

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `30-advanced-patterns-cqrs-read-models-projection-reporting-queries.md`  
> Target: Java 8 sampai Java 25  
> Level: Advanced / production architecture

---

## 0. Tujuan Part Ini

Sampai part sebelumnya, kita sudah membahas MyBatis dari sisi statement mapping, parameter binding, result mapping, dynamic SQL, transaction, vendor awareness, pagination, batch, cache, lazy loading, procedure, concurrency, performance, observability, testing, migration, security, multi-tenancy, large result, governance, dan plugin.

Part ini naik satu tingkat ke desain arsitektural:

> Bagaimana menggunakan MyBatis sebagai alat untuk membangun **read model**, **projection mapper**, **reporting query**, **dashboard query**, dan **CQRS-style persistence boundary** tanpa membuat sistem menjadi over-engineered.

Ini penting karena MyBatis sering sangat kuat di area yang ORM penuh seperti JPA/Hibernate kadang terasa berat:

- listing/search kompleks;
- dashboard aggregate;
- report lintas tabel;
- projection khusus UI;
- query vendor-specific;
- materialized view;
- read model denormalized;
- query yang harus predictable secara performance;
- sistem case-management/regulatory yang banyak membutuhkan listing dan audit view.

Namun kekuatan ini juga berbahaya. Kalau semua query bebas dibuat tanpa boundary, MyBatis bisa berubah menjadi kumpulan SQL liar yang melanggar domain, authorization, performance, dan maintainability.

Part ini membangun cara berpikir agar MyBatis dipakai sebagai **query architecture tool**, bukan sekadar “mapper yang bisa SQL bebas”.

---

## 1. Mental Model: MyBatis sebagai Read-Side Engineering Tool

MyBatis bukan hanya alat untuk CRUD. Dalam sistem enterprise, MyBatis sering paling bernilai saat digunakan untuk **query yang bentuknya tidak natural sebagai aggregate domain object**.

Contoh:

```text
Case Listing Page
  butuh:
    caseNo
    status
    agency
    assignedOfficerName
    lastActivityDate
    pendingTaskCount
    overdueFlag
    latestSubmissionDate
    applicantName
    riskScore
```

Data itu mungkin berasal dari banyak tabel:

```text
case
case_assignment
officer
agency
case_task
submission
applicant
risk_score
```

Kalau memakai domain aggregate penuh, kita berpotensi:

- memuat object graph terlalu besar;
- terkena N+1;
- melakukan mapping domain yang tidak dibutuhkan UI;
- mencampur read concern dengan write domain model;
- membuat query count/pagination tidak stabil.

Dengan MyBatis, kita bisa membuat projection langsung:

```java
public record CaseListingRow(
    Long caseId,
    String caseNo,
    String status,
    String agencyCode,
    String assignedOfficerName,
    Instant lastActivityAt,
    Integer pendingTaskCount,
    Boolean overdue
) {}
```

Dan mapper:

```java
public interface CaseListingMapper {
    List<CaseListingRow> search(CaseListingCriteria criteria);
    long count(CaseListingCriteria criteria);
}
```

Artinya:

> Untuk read-side kompleks, mapper bisa langsung mengembalikan bentuk data yang dibutuhkan consumer, selama security, tenant scope, pagination, dan performance tetap dijaga.

---

## 2. CQRS: Jangan Overclaim

CQRS adalah **Command Query Responsibility Segregation**: memisahkan model untuk update/command dari model untuk read/query. Esensinya adalah model baca dan model tulis boleh berbeda. Martin Fowler memperingatkan bahwa CQRS bisa bernilai pada situasi tertentu, tetapi pada banyak sistem ia menambah kompleksitas berisiko.

Dalam konteks MyBatis, kita tidak harus langsung membangun event sourcing, Kafka pipeline, atau database terpisah. CQRS bisa dimulai secara sederhana:

```text
Write Side
  Service command
  Domain invariant
  Transaction
  State transition
  Optimistic lock
  Audit/outbox

Read Side
  Listing mapper
  Detail projection mapper
  Dashboard mapper
  Report mapper
  Search mapper
```

Ini bisa berada di database yang sama. Yang dipisahkan pertama adalah **model dan contract**, bukan selalu infrastruktur.

### 2.1 CQRS Lite

CQRS lite cocok saat:

- write logic punya invariant kuat;
- read logic butuh banyak join/aggregate;
- UI membutuhkan shape data berbeda dari domain entity;
- performance read lebih penting daripada purity object model;
- query list/detail/report sering berubah;
- read model tidak harus digunakan untuk command decision.

Contoh struktur:

```text
case/
  application/
    command/
      ApproveCaseService.java
      RejectCaseService.java
    query/
      CaseListingQueryService.java
      CaseDashboardQueryService.java
  persistence/
    command/
      CaseCommandMapper.java
      CaseStateTransitionMapper.xml
    query/
      CaseListingMapper.java
      CaseListingMapper.xml
      CaseDashboardMapper.java
      CaseDashboardMapper.xml
```

### 2.2 CQRS Berat

CQRS berat biasanya melibatkan:

- read database terpisah;
- event-driven projection;
- eventual consistency;
- projection rebuild;
- replay event;
- operational complexity;
- dual-write/outbox concern;
- monitoring lag;
- data reconciliation.

Ini tidak boleh dipilih hanya karena “lebih advanced”. Untuk banyak sistem internal/regulatory, CQRS lite dengan projection mapper sudah memberi 80% manfaat dengan 20% kompleksitas.

---

## 3. Command Mapper vs Query Mapper

Salah satu pattern paling penting:

> Pisahkan mapper yang mengubah state dari mapper yang membaca projection.

### 3.1 Command Mapper

Command mapper fokus pada perubahan state dan invariant database-level.

Contoh:

```java
public interface CaseCommandMapper {
    int transitionStatus(CaseStatusTransitionCommand command);
    int assignOfficer(AssignOfficerCommand command);
    int insertAudit(CaseAuditInsertCommand command);
}
```

Karakteristik command mapper:

- method mengembalikan `int` rows affected;
- SQL cenderung `INSERT`, `UPDATE`, `DELETE`;
- punya guard condition;
- transaction dikendalikan service;
- tidak mengembalikan projection UI;
- nama method menggambarkan invariant;
- sering membutuhkan optimistic locking;
- harus tenant/security scoped.

Contoh:

```xml
<update id="transitionStatus">
  UPDATE case_header
  SET status = #{toStatus},
      version = version + 1,
      updated_by = #{actorUserId},
      updated_at = CURRENT_TIMESTAMP
  WHERE case_id = #{caseId}
    AND tenant_id = #{tenantId}
    AND status = #{fromStatus}
    AND version = #{expectedVersion}
</update>
```

Rows affected:

```text
1 => transition berhasil
0 => stale version / invalid state / unauthorized tenant / missing row
>1 => critical invariant violation
```

### 3.2 Query Mapper

Query mapper fokus pada data shape untuk consumer.

Contoh:

```java
public interface CaseListingMapper {
    List<CaseListingRow> search(CaseListingCriteria criteria);
    long count(CaseListingCriteria criteria);
}
```

Karakteristik query mapper:

- SQL bisa kompleks;
- return DTO/projection;
- tidak mengubah state;
- boleh join/aggregate;
- harus explicit select columns;
- harus pagination-aware;
- harus tenant/security scoped;
- tidak boleh digunakan sebagai source of truth untuk command invariant tanpa revalidation.

---

## 4. Projection Mapper

Projection mapper adalah mapper yang sengaja mengembalikan **bentuk baca tertentu**.

Bukan:

```java
CaseEntity findCaseWithEverything(Long caseId);
```

Lebih baik:

```java
CaseListingRow findListingRow(CaseListingKey key);
CaseDetailView findDetailView(CaseDetailKey key);
CaseAuditTimelineView findAuditTimeline(CaseAuditTimelineCriteria criteria);
CaseDashboardSummary findDashboardSummary(DashboardCriteria criteria);
```

### 4.1 Kenapa Projection Mapper Penting?

Karena model baca sering berbeda dari model tulis.

Write model:

```text
Case aggregate
  - status
  - assignment
  - documents
  - tasks
  - audit
  - correspondence
```

Read model untuk list:

```text
CaseListingRow
  - caseNo
  - statusLabel
  - officerName
  - ageInDays
  - overdueFlag
```

Read model untuk detail page:

```text
CaseDetailView
  - header
  - applicant
  - currentAssignment
  - visibleActions
  - latestSubmission
```

Read model untuk dashboard:

```text
DashboardSummary
  - openCount
  - overdueCount
  - dueSoonCount
  - closedThisMonthCount
```

Satu domain aggregate tidak perlu dipaksa memenuhi semua shape itu.

---

## 5. Projection DTO Design

### 5.1 Java 8 Compatible DTO

Untuk Java 8:

```java
public final class CaseListingRow {
    private final Long caseId;
    private final String caseNo;
    private final String status;
    private final String officerName;
    private final Integer pendingTaskCount;

    public CaseListingRow(
            Long caseId,
            String caseNo,
            String status,
            String officerName,
            Integer pendingTaskCount) {
        this.caseId = caseId;
        this.caseNo = caseNo;
        this.status = status;
        this.officerName = officerName;
        this.pendingTaskCount = pendingTaskCount;
    }

    public Long getCaseId() { return caseId; }
    public String getCaseNo() { return caseNo; }
    public String getStatus() { return status; }
    public String getOfficerName() { return officerName; }
    public Integer getPendingTaskCount() { return pendingTaskCount; }
}
```

Result map:

```xml
<resultMap id="CaseListingRowMap" type="com.acme.caseapp.query.CaseListingRow">
  <constructor>
    <idArg column="case_id" javaType="long"/>
    <arg column="case_no" javaType="string"/>
    <arg column="status" javaType="string"/>
    <arg column="officer_name" javaType="string"/>
    <arg column="pending_task_count" javaType="int"/>
  </constructor>
</resultMap>
```

### 5.2 Java 16+ Record DTO

Untuk Java modern:

```java
public record CaseListingRow(
    Long caseId,
    String caseNo,
    String status,
    String officerName,
    Integer pendingTaskCount
) {}
```

Record cocok untuk projection karena:

- immutable;
- ringkas;
- jelas sebagai data carrier;
- tidak punya behavior domain berat;
- mudah dipakai sebagai read response internal.

Namun perhatikan:

- constructor mapping harus cocok;
- nama column/arg harus disiplin;
- jangan menaruh business rule kompleks di record;
- jangan memakai projection sebagai command object.

---

## 6. Listing Mapper Pattern

Listing adalah salah satu use case paling sering dan paling berbahaya.

### 6.1 Contract

```java
public interface CaseListingMapper {
    List<CaseListingRow> search(CaseListingCriteria criteria);
    long count(CaseListingCriteria criteria);
}
```

Criteria:

```java
public final class CaseListingCriteria {
    private final String tenantId;
    private final Set<String> allowedAgencyCodes;
    private final String keyword;
    private final String status;
    private final Instant submittedFrom;
    private final Instant submittedToExclusive;
    private final CaseListingSort sort;
    private final int limit;
    private final int offset;

    // constructor/getters omitted
}
```

### 6.2 SQL

```xml
<select id="search" parameterType="CaseListingCriteria" resultMap="CaseListingRowMap">
  SELECT
      c.case_id             AS case_id,
      c.case_no             AS case_no,
      c.status              AS status,
      a.agency_code         AS agency_code,
      o.display_name        AS officer_name,
      COALESCE(t.pending_count, 0) AS pending_task_count,
      c.submitted_at        AS submitted_at
  FROM case_header c
  JOIN agency a
    ON a.agency_id = c.agency_id
  LEFT JOIN officer o
    ON o.officer_id = c.assigned_officer_id
  LEFT JOIN (
      SELECT case_id, COUNT(*) AS pending_count
      FROM case_task
      WHERE task_status = 'PENDING'
      GROUP BY case_id
  ) t
    ON t.case_id = c.case_id
  WHERE c.tenant_id = #{tenantId}
    AND c.deleted = 0

  <if test="allowedAgencyCodes != null and allowedAgencyCodes.size() > 0">
    AND a.agency_code IN
    <foreach collection="allowedAgencyCodes" item="agencyCode" open="(" separator="," close=")">
      #{agencyCode}
    </foreach>
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

  <if test="keyword != null and keyword != ''">
    AND (
      UPPER(c.case_no) LIKE UPPER(#{keywordLike}) ESCAPE '\\'
      OR UPPER(c.applicant_name) LIKE UPPER(#{keywordLike}) ESCAPE '\\'
    )
  </if>

  ORDER BY
  <choose>
    <when test="sort == 'SUBMITTED_ASC'">c.submitted_at ASC, c.case_id ASC</when>
    <when test="sort == 'CASE_NO_ASC'">c.case_no ASC, c.case_id ASC</when>
    <otherwise>c.submitted_at DESC, c.case_id DESC</otherwise>
  </choose>

  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

### 6.3 Kenapa Pattern Ini Baik?

Karena:

- projection eksplisit;
- filter security ada di SQL;
- `deleted = 0` eksplisit;
- sorting whitelist;
- pagination stabil dengan tie-breaker `case_id`;
- child aggregate dihitung lewat subquery terkontrol;
- result tidak memuat object graph penuh;
- query bisa di-review sebagai read contract.

---

## 7. Count Query Strategy untuk Projection Mapper

Count query tidak boleh otomatis copy-paste dari search query tanpa pikir.

Search query mungkin butuh:

- join officer untuk display name;
- join task aggregate untuk pending count;
- order by;
- projection columns.

Count query mungkin hanya butuh:

- root table;
- filter table yang memengaruhi eligibility;
- tenant/scope predicate;
- keyword predicate.

Contoh:

```xml
<select id="count" parameterType="CaseListingCriteria" resultType="long">
  SELECT COUNT(*)
  FROM case_header c
  JOIN agency a
    ON a.agency_id = c.agency_id
  WHERE c.tenant_id = #{tenantId}
    AND c.deleted = 0

  <if test="allowedAgencyCodes != null and allowedAgencyCodes.size() > 0">
    AND a.agency_code IN
    <foreach collection="allowedAgencyCodes" item="agencyCode" open="(" separator="," close=")">
      #{agencyCode}
    </foreach>
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

  <if test="keyword != null and keyword != ''">
    AND (
      UPPER(c.case_no) LIKE UPPER(#{keywordLike}) ESCAPE '\\'
      OR UPPER(c.applicant_name) LIKE UPPER(#{keywordLike}) ESCAPE '\\'
    )
  </if>
</select>
```

### 7.1 Count Anti-Patterns

```text
Anti-pattern 1:
  SELECT COUNT(*) FROM (huge query with ORDER BY)

Anti-pattern 2:
  Count joins all one-to-many tables, causing duplicate root count.

Anti-pattern 3:
  Count query omits tenant/security filter.

Anti-pattern 4:
  Count query has different eligibility semantics from search query.

Anti-pattern 5:
  Always count even when UI only needs "has next".
```

### 7.2 Page vs Slice

Untuk UI tertentu, count total tidak perlu.

```text
Page
  rows + totalCount
  cocok untuk pagination klasik

Slice
  rows + hasNext
  cocok untuk infinite scroll / queue

CursorSlice
  rows + nextCursor
  cocok untuk keyset pagination
```

Untuk dataset besar, `Slice` atau keyset sering lebih sehat daripada count penuh.

---

## 8. Dashboard Query Pattern

Dashboard query biasanya aggregate-heavy.

Contoh result:

```java
public record CaseDashboardSummary(
    long openCount,
    long overdueCount,
    long dueSoonCount,
    long closedThisMonthCount
) {}
```

Mapper:

```java
public interface CaseDashboardMapper {
    CaseDashboardSummary summarize(CaseDashboardCriteria criteria);
}
```

SQL:

```xml
<select id="summarize" parameterType="CaseDashboardCriteria" resultMap="CaseDashboardSummaryMap">
  SELECT
      SUM(CASE WHEN c.status IN ('OPEN', 'IN_REVIEW') THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN c.due_at &lt; CURRENT_TIMESTAMP AND c.status NOT IN ('CLOSED') THEN 1 ELSE 0 END) AS overdue_count,
      SUM(CASE WHEN c.due_at &gt;= CURRENT_TIMESTAMP
                AND c.due_at &lt; #{dueSoonThreshold}
                AND c.status NOT IN ('CLOSED') THEN 1 ELSE 0 END) AS due_soon_count,
      SUM(CASE WHEN c.closed_at &gt;= #{monthStart}
                AND c.closed_at &lt; #{nextMonthStart} THEN 1 ELSE 0 END) AS closed_this_month_count
  FROM case_header c
  WHERE c.tenant_id = #{tenantId}
    AND c.deleted = 0
    AND c.agency_code IN
    <foreach collection="agencyCodes" item="agencyCode" open="(" separator="," close=")">
      #{agencyCode}
    </foreach>
</select>
```

### 8.1 Dashboard Query Risks

Dashboard query bisa mahal karena:

- banyak aggregate scan;
- filter time window besar;
- tenant scope luas;
- CASE expression sulit memakai index tertentu;
- dashboard diakses sering;
- auto-refresh UI memperbanyak beban.

Strategi:

```text
Small/medium data:
  direct aggregate query may be acceptable.

Large data:
  summary table or materialized view.

Near-real-time requirement:
  incremental projection table.

Strict real-time requirement:
  optimize base table/index and accept cost.
```

---

## 9. Reporting Query Pattern

Reporting query berbeda dari listing query.

Listing:

```text
interaktif
latency rendah
limit kecil
security ketat
pagination stabil
```

Reporting:

```text
batch/export
latency bisa lebih lama
result besar
perlu snapshot semantics
butuh cancellation/progress
lebih sensitif memory
```

### 9.1 Report Mapper Contract

```java
public interface CaseReportMapper {
    Cursor<CaseReportRow> streamReport(CaseReportCriteria criteria);
}
```

Atau:

```java
public interface CaseReportMapper {
    void handleReportRows(CaseReportCriteria criteria, ResultHandler<CaseReportRow> handler);
}
```

### 9.2 Report Query Principles

- Jangan pakai `selectList` untuk ratusan ribu row.
- Gunakan cursor/result handler.
- Gunakan fetch size sesuai vendor driver.
- Gunakan async export job, bukan request-response langsung.
- Simpan progress/checkpoint.
- Log query metadata, bukan isi row sensitif.
- Batasi report scope.
- Gunakan snapshot parameter seperti `asOfTime`.
- Jangan campur report export dengan transaction write panjang.

---

## 10. Materialized View dan Projection Table

Saat query projection terlalu mahal, kita bisa membuat read model fisik.

### 10.1 Materialized View

Cocok ketika:

- data bisa sedikit stale;
- DB mendukung refresh materialized view;
- query report/dashboard berat;
- shape mostly relational;
- refresh schedule jelas.

Contoh mapper:

```java
public interface CaseDashboardReadModelMapper {
    CaseDashboardSummary summarizeFromMaterializedView(DashboardCriteria criteria);
}
```

SQL:

```xml
<select id="summarizeFromMaterializedView" resultMap="CaseDashboardSummaryMap">
  SELECT
      open_count,
      overdue_count,
      due_soon_count,
      closed_this_month_count
  FROM mv_case_dashboard_summary
  WHERE tenant_id = #{tenantId}
    AND agency_code = #{agencyCode}
</select>
```

### 10.2 Projection Table

Projection table biasanya diisi oleh application job/event handler.

Contoh:

```text
case_listing_read_model
  tenant_id
  case_id
  case_no
  status
  agency_code
  officer_name
  applicant_name
  pending_task_count
  last_activity_at
  overdue_flag
  search_text
  version
  rebuilt_at
```

Keuntungan:

- query listing cepat;
- filter/sort lebih mudah;
- bisa index sesuai read requirement;
- mengurangi join runtime.

Risiko:

- data stale;
- projection rebuild perlu strategi;
- dual-write risk;
- perlu reconciliation;
- perlu observability lag.

### 10.3 Projection Freshness Contract

Setiap read model fisik perlu freshness contract:

```text
strongly consistent
  projection updated in same transaction

near-real-time
  projection updated via outbox/event worker
  delay seconds/minutes acceptable

scheduled
  projection refreshed per schedule
  suitable for report/dashboard

manual rebuild
  suitable for archival/rare analytics
```

Tanpa freshness contract, user akan menganggap data selalu real-time dan tim akan sulit menjelaskan discrepancy.

---

## 11. MyBatis + JPA Pattern

Dalam satu sistem, tidak harus memilih hanya satu.

Pattern umum:

```text
JPA/Hibernate
  write aggregate
  domain relationship
  simple repository
  lifecycle/cascade when appropriate

MyBatis
  complex listing
  dashboard
  report
  projection query
  vendor-specific SQL
  batch operation eksplisit
```

### 11.1 Boundary yang Aman

```text
Do:
  Use JPA for aggregate command if model fits.
  Use MyBatis for read projection.
  Share transaction manager if same datasource.
  Revalidate command invariant on write side.

Don't:
  Load entity with JPA, mutate indirectly via MyBatis, then expect persistence context to know.
  Use MyBatis projection as managed entity.
  Mix cache assumptions.
  Let read projection decide command without rechecking state.
```

Contoh:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseEntity entity = caseRepository.findById(command.caseId())
        .orElseThrow(NotFoundException::new);

    entity.approve(command.actor());

    // optional explicit MyBatis audit insert, but beware persistence context ordering
    caseAuditMapper.insertApprovalAudit(...);
}
```

Lebih aman untuk state transition kritis:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    int updated = caseCommandMapper.approveIfCurrentState(command);
    if (updated != 1) {
        throw new ConcurrentStateChangeException();
    }
    caseAuditMapper.insertApprovalAudit(...);
}
```

---

## 12. MyBatis + jOOQ Pattern

jOOQ kuat untuk type-safe SQL DSL dengan model SQL yang sangat kaya. MyBatis kuat untuk mapper XML/SQL governance dan integrasi existing mapper.

Kombinasi masuk akal jika:

- MyBatis sudah menjadi standar codebase;
- ada area query baru yang butuh DSL lebih kuat;
- tim mau generated schema classes;
- query sangat dynamic dan type-safety SQL penting;
- vendor SQL kompleks.

Boundary:

```text
MyBatis
  stable mapper XML
  enterprise mapper governance
  existing SQL assets

jOOQ
  highly dynamic type-safe SQL
  advanced SQL composition
  generated schema metadata
```

Jangan campur dalam satu use case tanpa alasan kuat karena debugging, transaction, logging, dan style review menjadi lebih kompleks.

---

## 13. MyBatis + Spring JDBC Pattern

Spring JDBC/JdbcTemplate cocok untuk:

- raw streaming BLOB besar;
- very custom RowCallbackHandler;
- batch low-level tuning;
- query sederhana tanpa perlu mapper XML;
- operational scripts internal.

MyBatis tetap cocok untuk:

- mapper contract formal;
- resultMap kompleks;
- SQL governance;
- dynamic XML;
- mapper scanning;
- statement id observability.

Boundary yang sehat:

```text
Default persistence style: MyBatis
Exceptional low-level operation: JdbcTemplate
```

Jangan menjadikan JdbcTemplate escape hatch untuk melewati security/tenant mapper rule.

---

## 14. Read Model vs Domain Model

Kesalahan umum:

> Menganggap semua object hasil query harus domain object.

Padahal tidak.

### 14.1 Domain Model

Domain model cocok untuk:

- behavior;
- invariant;
- state transition;
- lifecycle;
- command decision;
- business rule.

### 14.2 Read Model

Read model cocok untuk:

- display;
- search;
- dashboard;
- report;
- export;
- timeline;
- audit view;
- API response projection.

### 14.3 Jangan Mencampur

Buruk:

```java
CaseEntity entity = caseListingMapper.findForListing(criteria);
```

Karena `CaseEntity` terlihat seperti domain object, padahal datanya partial, mungkin tidak lengkap, dan bisa misleading.

Lebih baik:

```java
CaseListingRow row = caseListingMapper.findRow(criteria);
```

Nama type harus jujur.

---

## 15. Read Service Layer

Mapper tidak harus langsung dipakai controller.

Pattern:

```text
Controller
  -> QueryService
      -> QueryPolicy / Authorization
      -> Mapper
      -> Response Assembler
```

Contoh:

```java
public final class CaseListingQueryService {
    private final CaseListingMapper mapper;
    private final CurrentUserProvider currentUserProvider;
    private final CaseListingPolicy policy;

    public Page<CaseListingRow> search(CaseListingRequest request) {
        CurrentUser user = currentUserProvider.currentUser();
        DataScope scope = policy.scopeFor(user);

        CaseListingCriteria criteria = CaseListingCriteria.from(request, scope);

        List<CaseListingRow> rows = mapper.search(criteria);
        long total = mapper.count(criteria);

        return Page.of(rows, total, request.limit(), request.offset());
    }
}
```

Keuntungan:

- authorization scope tidak diserahkan ke controller;
- criteria terkontrol;
- mapper tetap persistence-only;
- response transformation bisa dilakukan di service/assembler;
- query behavior lebih testable.

---

## 16. Search Criteria Object untuk Advanced Query

Criteria object harus menjadi contract eksplisit, bukan `Map<String,Object>`.

```java
public final class CaseSearchCriteria {
    private final String tenantId;
    private final Set<String> agencyCodes;
    private final Set<String> statuses;
    private final String keywordLike;
    private final Instant submittedFrom;
    private final Instant submittedToExclusive;
    private final Boolean overdueOnly;
    private final SortSpec sort;
    private final int limit;
    private final int offset;
}
```

### 16.1 Criteria Builder Layer

Raw request tidak langsung masuk mapper.

```text
HTTP request
  keyword = "abc%"
  sort = "submittedAt:desc"
  page = 2

QueryService converts to:
  keywordLike = "%abc\%%"
  sort = SUBMITTED_DESC
  limit = 50
  offset = 100
  tenantId = from authenticated user
  agencyCodes = from policy
```

Ini menjaga:

- SQL injection boundary;
- valid sorting;
- pagination limit;
- tenant scope;
- keyword escaping;
- date boundary.

---

## 17. Reporting Boundary dan Snapshot Semantics

Report harus jelas apakah datanya snapshot atau live.

### 17.1 Live Query

```text
Report reads current DB state while running.
Risk:
  long-running report may see data movement depending isolation.
```

### 17.2 Snapshot Parameter

```text
Report criteria includes asOfTime.
Query filters data using <= asOfTime or version snapshot.
```

### 17.3 Export Job Table

```text
export_job
  job_id
  requested_by
  tenant_id
  criteria_json
  status
  created_at
  started_at
  completed_at
  file_location
  error_message
```

Mapper:

```java
public interface ExportJobMapper {
    int insertJob(ExportJobInsertCommand command);
    int markRunning(JobStatusCommand command);
    int markCompleted(JobCompletedCommand command);
    int markFailed(JobFailedCommand command);
    Optional<ExportJobRecord> findById(ExportJobKey key);
}
```

Report mapper hanya membaca rows. Export job mapper mengelola lifecycle.

---

## 18. Timeline / Audit Projection Pattern

Audit timeline sering tidak cocok sebagai domain entity.

```java
public record CaseTimelineItem(
    Instant occurredAt,
    String eventType,
    String actorDisplayName,
    String description,
    String sourceModule,
    String correlationId
) {}
```

Mapper:

```java
public interface CaseTimelineMapper {
    List<CaseTimelineItem> findTimeline(CaseTimelineCriteria criteria);
}
```

SQL bisa union dari beberapa sumber:

```xml
<select id="findTimeline" resultMap="CaseTimelineItemMap">
  SELECT occurred_at, event_type, actor_name, description, source_module, correlation_id
  FROM case_audit_event
  WHERE tenant_id = #{tenantId}
    AND case_id = #{caseId}

  UNION ALL

  SELECT sent_at AS occurred_at,
         'CORRESPONDENCE_SENT' AS event_type,
         sent_by_name AS actor_name,
         subject AS description,
         'CORRESPONDENCE' AS source_module,
         correlation_id
  FROM correspondence
  WHERE tenant_id = #{tenantId}
    AND case_id = #{caseId}

  ORDER BY occurred_at DESC
</select>
```

Pattern ini baik selama:

- projection jelas;
- source event tidak dipakai untuk command invariant;
- tenant scope ada di semua branch;
- result ordering stabil;
- pagination/cursor dipikirkan jika timeline besar.

---

## 19. Query Object + Mapper Composition

Jangan membuat satu mapper method dengan puluhan flag untuk semua kebutuhan.

Buruk:

```java
List<Map<String, Object>> searchEverything(Map<String, Object> params);
```

Lebih baik:

```java
CaseListingMapper.search(CaseListingCriteria criteria)
CaseExportMapper.streamExport(CaseExportCriteria criteria)
CaseDashboardMapper.summarize(CaseDashboardCriteria criteria)
CaseTimelineMapper.findTimeline(CaseTimelineCriteria criteria)
```

Setiap query punya:

- consumer jelas;
- shape jelas;
- filter jelas;
- performance expectation jelas;
- index design jelas;
- test cases jelas.

---

## 20. Advanced Dynamic Query: XML vs Dynamic SQL DSL

Untuk projection query kompleks, pilihan utama:

```text
XML Mapper
  bagus untuk SQL yang ingin terlihat seperti SQL asli
  bagus untuk DBA review
  bagus untuk vendor-specific tuning
  bagus untuk report/dashboard static-ish query

MyBatis Dynamic SQL
  bagus untuk type-safe query composition
  bagus untuk banyak optional criteria
  bagus untuk reusable predicate builder
  bagus untuk Java-side query builder discipline
```

MyBatis Dynamic SQL menyediakan DSL untuk menghasilkan statement SQL dinamis, termasuk select, join, union, subquery support dalam beberapa area, dan rendering strategy untuk MyBatis3.

### 20.1 XML Lebih Baik Jika

- query sangat SQL-native;
- banyak CTE/window function/vendor hint;
- perlu dibaca DBA;
- query jarang berubah bentuk;
- resultMap XML kompleks;
- tim lebih nyaman SQL eksplisit.

### 20.2 Dynamic SQL DSL Lebih Baik Jika

- filter sangat composable;
- banyak reuse predicate;
- ingin column metadata type-safe;
- ingin menghindari stringly typed column references;
- query relatif standar;
- tim nyaman Java DSL.

### 20.3 Jangan Campur Tanpa Boundary

Boleh hybrid, tetapi harus jelas:

```text
Search mappers using Dynamic SQL DSL
Reporting mappers using XML SQL
Command mappers using XML explicit guarded update
```

---

## 21. Window Function Projection

Reporting/listing modern sering membutuhkan ranking, row number, latest child row, running total.

Contoh latest assignment:

```xml
<select id="searchWithLatestAssignment" resultMap="CaseListingRowMap">
  SELECT
      c.case_id,
      c.case_no,
      c.status,
      la.officer_name,
      la.assigned_at
  FROM case_header c
  LEFT JOIN (
      SELECT x.case_id, x.officer_name, x.assigned_at
      FROM (
          SELECT
              ca.case_id,
              o.display_name AS officer_name,
              ca.assigned_at,
              ROW_NUMBER() OVER (
                  PARTITION BY ca.case_id
                  ORDER BY ca.assigned_at DESC, ca.assignment_id DESC
              ) AS rn
          FROM case_assignment ca
          JOIN officer o ON o.officer_id = ca.officer_id
      ) x
      WHERE x.rn = 1
  ) la ON la.case_id = c.case_id
  WHERE c.tenant_id = #{tenantId}
</select>
```

Keuntungan:

- menghindari nested select N+1;
- mengambil latest child secara set-based;
- bisa di-index dengan benar;
- cocok untuk listing projection.

Risiko:

- vendor syntax differences;
- execution plan kompleks;
- index harus didesain;
- count query tidak boleh sembarang copy.

---

## 22. Read Model Denormalization

Denormalisasi bukan dosa jika dilakukan eksplisit.

Contoh:

```text
case_header
  case_id
  status
  assigned_officer_id

case_listing_read_model
  case_id
  status
  assigned_officer_name
  pending_task_count
  latest_activity_at
  overdue_flag
```

### 22.1 Kapan Denormalisasi Layak?

Layak jika:

- query join terlalu mahal;
- listing page critical;
- dashboard sering diakses;
- data source banyak;
- report membutuhkan shape tetap;
- freshness bisa didefinisikan.

Tidak layak jika:

- data kecil;
- query sederhana;
- requirement berubah sangat sering;
- tim belum punya observability projection lag;
- consistency harus selalu strong tetapi update projection sulit.

### 22.2 Update Projection Dalam Transaction yang Sama

```java
@Transactional
public void assignOfficer(AssignOfficerCommand command) {
    int updated = caseCommandMapper.assignOfficer(command);
    if (updated != 1) throw new ConcurrentStateChangeException();

    caseListingReadModelMapper.updateAssignedOfficer(command.toProjectionUpdate());
    auditMapper.insert(...);
}
```

Keuntungan:

- projection consistent setelah commit;
- simple mental model.

Risiko:

- write transaction makin berat;
- read model update failure menggagalkan command;
- coupling command dengan read representation.

### 22.3 Update Projection via Outbox

```text
Command transaction:
  update case
  insert outbox event

Worker:
  read outbox
  update projection table
  mark outbox processed
```

Keuntungan:

- decoupled;
- lebih scalable;
- bisa retry;
- cocok untuk banyak projection.

Risiko:

- eventual consistency;
- lag monitoring;
- duplicate event handling;
- projection rebuild complexity.

---

## 23. Projection Rebuild Strategy

Kalau memakai projection table, harus bisa rebuild.

### 23.1 Full Rebuild

```text
TRUNCATE read_model
INSERT SELECT from source tables
```

Cocok untuk:

- data kecil/medium;
- maintenance window;
- scheduled rebuild.

Risiko:

- downtime/read inconsistency;
- lock;
- long transaction;
- high redo/WAL.

### 23.2 Shadow Table Rebuild

```text
Build new table:
  case_listing_read_model_v2_build

Validate counts/checksum
Swap view/synonym/name
Drop old later
```

Lebih aman untuk large systems.

### 23.3 Incremental Rebuild

```text
Find changed source rows since last checkpoint
Recompute affected projection rows
Update projection
```

Butuh:

- source updated_at/version;
- checkpoint table;
- idempotent upsert;
- retry.

---

## 24. Regulatory / Case Management Example

Misalnya sistem enforcement lifecycle punya modul:

```text
Application
Case
Compliance
Appeal
Correspondence
Document
Audit
Revenue
Screening
```

Write side:

```text
CaseCommandMapper
  transition status
  assign officer
  submit review
  approve action
  close case
```

Read side:

```text
CaseListingMapper
  listing for officer inbox

CaseDashboardMapper
  dashboard for supervisor

CaseTimelineMapper
  audit timeline

CaseReportMapper
  monthly enforcement report

CaseWorkQueueMapper
  claimable tasks
```

Setiap mapper punya contract berbeda:

```text
CaseListingMapper
  latency target: < 500ms
  limit: 50/100
  index: tenant_id, status, assigned_officer_id, submitted_at

CaseReportMapper
  async export
  cursor/result handler
  no request thread streaming for huge files

CaseDashboardMapper
  aggregate or materialized view
  freshness <= 5 minutes acceptable

CaseWorkQueueMapper
  concurrency correctness critical
  SELECT FOR UPDATE SKIP LOCKED / conditional update
```

Ini jauh lebih jelas daripada satu `CaseMapper` raksasa.

---

## 25. Naming Patterns

Recommended suffix:

```text
*CommandMapper
  write/state transition

*LookupMapper
  small read-only lookup

*ListingMapper
  paginated list/search

*DetailViewMapper
  detail projection

*DashboardMapper
  aggregate summary

*ReportMapper
  export/report data

*TimelineMapper
  audit/activity timeline

*ReadModelMapper
  physical read model table

*ProjectionRebuildMapper
  rebuild/refresh projection
```

Avoid:

```text
CommonMapper
BaseMapper
GenericMapper
CaseMapper with 200 methods
SearchEverythingMapper
UtilityMapper
```

---

## 26. Failure Model

### 26.1 Stale Read Model

Symptom:

```text
Detail page shows updated status, listing still old.
```

Possible causes:

- projection async lag;
- outbox worker failed;
- projection update skipped;
- cache stale;
- materialized view not refreshed.

Mitigation:

- freshness contract;
- projection lag metric;
- rebuild tool;
- user-facing “last refreshed” if needed.

### 26.2 Authorization Leakage

Symptom:

```text
User sees case count or listing row from agency they should not access.
```

Possible causes:

- count query missing scope;
- one branch of `UNION` missing tenant filter;
- projection table missing agency field;
- cache key missing tenant/scope.

Mitigation:

- scope object mandatory;
- BoundSql test for predicates;
- static XML checks;
- integration tests with two tenants/agencies.

### 26.3 Dashboard Too Slow

Possible causes:

- aggregate scans large table;
- no partition pruning;
- CASE expression over too many rows;
- missing composite index;
- dashboard auto-refresh too frequent.

Mitigation:

- materialized view;
- summary table;
- time-window restriction;
- caching with clear staleness contract;
- index redesign.

### 26.4 Projection Table Drift

Possible causes:

- outbox event missing;
- worker partial failure;
- manual DB update bypass;
- schema change not reflected in projection builder;
- race condition in projection update.

Mitigation:

- reconciliation job;
- checksum/count comparison;
- idempotent rebuild;
- event deduplication;
- command path discipline.

### 26.5 Query Mapper Becomes Business Logic Dump

Symptom:

```text
One SQL query encodes complex business decision rules that write side does not share.
```

Mitigation:

- keep read-side derivations display-oriented;
- command decision must revalidate in write model;
- document derived fields;
- move invariant to command service/database constraint.

---

## 27. Testing Strategy

### 27.1 Projection Mapper Tests

Test:

- column mapping;
- null mapping;
- enum/status label;
- left join behavior;
- tenant scope;
- authorization scope;
- soft delete;
- pagination ordering;
- count consistency;
- keyword escaping;
- date boundary.

Example:

```java
@Test
void search_shouldNotReturnOtherAgencyRows() {
    CaseListingCriteria criteria = criteriaForAgency("AGENCY_A");

    List<CaseListingRow> rows = mapper.search(criteria);

    assertThat(rows)
        .extracting(CaseListingRow::agencyCode)
        .containsOnly("AGENCY_A");
}
```

### 27.2 Count/Search Consistency Test

```java
@Test
void count_shouldMatchSearchEligibilityIgnoringPagination() {
    CaseListingCriteria criteria = criteria.limit(10).offset(0);

    long count = mapper.count(criteria.withoutPagination());
    List<CaseListingRow> allRows = mapper.search(criteria.withLimitAndOffset(1000, 0));

    assertThat(count).isEqualTo(allRows.size());
}
```

For large datasets, use controlled fixtures instead of real full table.

### 27.3 Projection Freshness Test

For projection table:

```java
@Test
void command_shouldUpdateListingProjectionInSameTransaction() {
    service.assignOfficer(command);

    CaseListingRow row = listingMapper.findByCaseId(key);

    assertThat(row.officerName()).isEqualTo("New Officer");
}
```

For async projection:

```text
Test event handler idempotency:
  process same event twice
  projection remains correct
```

---

## 28. Observability Checklist

For advanced query mappers, log/metric by statement id:

```text
statement id
latency
row count
tenant id hash / safe scope label
criteria shape
pagination size
count query latency
DB wait/event if available
projection freshness timestamp
outbox lag if read model async
```

Do not log:

```text
PII names
full free text
document contents
raw SQL with sensitive parameters
large CLOB/BLOB
```

---

## 29. Performance Checklist

For each listing/dashboard/report mapper:

```text
[ ] Does query use explicit columns?
[ ] Is tenant/security filter mandatory?
[ ] Is ordering deterministic?
[ ] Is pagination strategy appropriate?
[ ] Is count query necessary?
[ ] Does count query match eligibility semantics?
[ ] Does query avoid one-to-many pagination duplicates?
[ ] Are joins indexed?
[ ] Are search predicates index-aware?
[ ] Is LIKE escaping handled?
[ ] Are date ranges half-open?
[ ] Is large export using cursor/result handler?
[ ] Is dashboard aggregate acceptable or should it be materialized?
[ ] Is projection freshness defined?
[ ] Is query tested with realistic row volume?
```

---

## 30. Java 8 sampai Java 25 Considerations

### Java 8

Use:

- final DTO classes;
- constructor result mapping;
- `Optional` carefully at service boundary;
- explicit criteria classes;
- no records.

### Java 11

Mostly same as Java 8, with better runtime/library ecosystem.

### Java 17

Use:

- records for projection DTO;
- sealed interfaces for query result variants if useful;
- modern Spring Boot 3 baseline;
- stronger immutable query object pattern.

### Java 21

Virtual threads can help request/thread scaling, but they do not fix:

- slow SQL;
- lock contention;
- connection pool exhaustion;
- large result memory pressure;
- unbounded exports.

### Java 25

Use modern language features if your baseline allows, but keep mapper contract explicit. Avoid making SQL architecture depend on language cleverness.

---

## 31. Decision Matrix

| Problem | Recommended Pattern |
|---|---|
| Simple CRUD aggregate | JPA/Spring Data/JDBC/MyBatis command mapper depending stack |
| Complex search listing | MyBatis listing projection mapper |
| Dashboard aggregate small data | Direct MyBatis aggregate query |
| Dashboard aggregate large data | Materialized view / summary read model |
| Large export | MyBatis cursor/result handler or JdbcTemplate streaming |
| UI detail with mixed data | Detail projection mapper |
| State transition | Command mapper with guarded update |
| Work queue claim | Conditional update / lock-aware mapper |
| Many optional filters | XML dynamic SQL or MyBatis Dynamic SQL DSL |
| Strong SQL type-safety DSL needed | Consider MyBatis Dynamic SQL or jOOQ |
| Projection must be near real-time | Outbox/event-driven projection table |
| Projection must be strongly consistent | Update read model in same transaction |

---

## 32. Common Anti-Patterns

### 32.1 One Mapper for Everything

```text
CaseMapper
  insertCase
  updateCase
  searchCase
  exportCase
  dashboard
  timeline
  approve
  reject
  claimTask
  rebuildProjection
```

This becomes impossible to govern.

### 32.2 Projection Named as Entity

Bad:

```java
CaseEntity findCaseListing(...)
```

Good:

```java
CaseListingRow search(...)
```

### 32.3 Read Query as Command Authority

Bad:

```text
Listing row says status=OPEN, so approve without rechecking.
```

Good:

```text
Command update checks WHERE status = 'OPEN' AND version = expectedVersion.
```

### 32.4 Count Query Missing Security Filter

This leaks existence/count even if rows are hidden.

### 32.5 Report via HTTP Request Thread with `selectList`

This risks heap exhaustion, timeout, and user-visible failures.

### 32.6 Materialized View Without Freshness Contract

Users will treat stale data as bug unless expectations are explicit.

---

## 33. Mini Capstone: Case Management Read Architecture

Recommended mapper layout:

```text
case/
  persistence/
    command/
      CaseCommandMapper.java
      CaseCommandMapper.xml
      CaseAuditCommandMapper.java
      CaseAuditCommandMapper.xml

    query/
      CaseListingMapper.java
      CaseListingMapper.xml
      CaseDetailViewMapper.java
      CaseDetailViewMapper.xml
      CaseTimelineMapper.java
      CaseTimelineMapper.xml
      CaseDashboardMapper.java
      CaseDashboardMapper.xml
      CaseReportMapper.java
      CaseReportMapper.xml

    readmodel/
      CaseListingReadModelMapper.java
      CaseListingReadModelMapper.xml
      CaseProjectionRebuildMapper.java
      CaseProjectionRebuildMapper.xml
```

Read services:

```text
CaseListingQueryService
CaseDashboardQueryService
CaseTimelineQueryService
CaseReportExportService
```

Command services:

```text
ApproveCaseService
AssignCaseService
CloseCaseService
```

Rules:

```text
1. Command services may not depend on listing mapper for invariant.
2. Query services may not perform writes.
3. Every query criteria includes DataScope.
4. Every listing query has deterministic order.
5. Every report query is cursor/export-job based if large.
6. Every projection table has freshness/rebuild strategy.
7. Every dashboard query has latency and staleness contract.
```

---

## 34. Summary

MyBatis shines when read-side requirements are more complex than domain aggregate retrieval:

- listing;
- search;
- dashboard;
- report;
- timeline;
- projection;
- materialized view;
- vendor-specific SQL;
- read model optimization.

The advanced engineer does not merely write complex SQL. The advanced engineer defines:

```text
query ownership
projection shape
security scope
pagination semantics
count semantics
freshness contract
performance expectation
observability signal
rebuild strategy
failure model
```

CQRS does not have to mean event sourcing or multiple databases. In many enterprise systems, the first valuable step is simply separating:

```text
Command model:
  protects invariant and state transition

Query model:
  serves optimized projection for readers
```

MyBatis is an excellent tool for the query side because it keeps SQL explicit and controllable. But that control only helps if the team also enforces boundaries, naming, testing, security, and performance governance.

---

## 35. What Comes Next

Part berikutnya:

```text
31-failure-modeling-production-troubleshooting.md
```

Kita akan membahas failure model dan troubleshooting produksi secara sistematis:

- mapper not found;
- statement not found;
- XML parse error;
- parameter not found;
- result mapping mismatch;
- too many results;
- null primitive error;
- invalid column;
- deadlock;
- lock timeout;
- connection timeout;
- slow query;
- memory spike;
- batch partial failure;
- stale cache;
- troubleshooting decision tree.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 29 — Plugin and Interceptor Engineering](./29-plugin-interceptor-engineering.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 31 — Failure Modeling and Production Troubleshooting](./31-failure-modeling-production-troubleshooting.md)

</div>
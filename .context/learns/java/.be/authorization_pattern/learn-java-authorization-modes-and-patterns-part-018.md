# learn-java-authorization-modes-and-patterns-part-018

# Part 18 — Data-Level Authorization and Query Scoping

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Fokus: **Java 8–25**, enterprise backend, Spring/Jakarta, persistence, search, report, export, multi-tenant, regulatory/case-management systems.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas authorization dari berbagai sudut:

- authorization mental model,
- vocabulary dan invariant,
- primitive Java platform,
- PEP/PDP/PAP/PIP,
- RBAC,
- permission/capability,
- ABAC,
- PBAC,
- ReBAC,
- ACL,
- ownership/tenancy,
- IDOR/BOLA,
- layered Java authorization,
- Spring request authorization,
- Spring method security,
- Spring domain authorization,
- Jakarta authorization,
- REST/GraphQL/gRPC/messaging.

Part ini masuk ke area yang sering menjadi pembeda antara engineer biasa dan engineer yang benar-benar matang:

> **Authorization tidak cukup dilakukan pada satu object setelah object diambil. Authorization untuk data-heavy system harus masuk ke query shape, query predicate, pagination, count, aggregation, search index, export, report, cache, dan data pipeline.**

Banyak sistem terlihat aman karena endpoint `GET /cases/{id}` sudah mengecek object-level access. Tetapi sistem yang sama bocor melalui:

```text
GET /cases?status=OPEN
GET /cases/search?q=...
GET /reports/case-summary
GET /exports/cases.csv
GET /dashboard/agency-counts
GET /documents/download/{id}
GET /audit-trails?module=...
```

Itulah sebabnya part ini disebut **Data-Level Authorization and Query Scoping**.

---

## 1. Mental Model Utama

### 1.1 Authorization bukan hanya “boleh akses object ini?”

Untuk single object:

```text
Can subject S perform action A on resource R under context C?
```

Contoh:

```text
Can officer-123 view case CASE-999 under agency CEA in UAT intranet context?
```

Tetapi untuk query/list/report/export:

```text
Which resources of type T may subject S see for action A under context C?
```

Contoh:

```text
Which cases may officer-123 list in the Case Management screen?
Which documents may officer-123 export?
Which audit rows may agency-admin-7 search?
Which rows may be counted in dashboard total?
```

Single-object authorization menghasilkan **boolean decision**.

Data-level authorization menghasilkan **authorized data scope**.

```text
Single object:
  canView(user, case) -> true/false

Query/list/report:
  authorizedCaseScope(user, context) -> predicate / scope / relation / dataset boundary
```

Top-level engineer tidak hanya bertanya:

```text
Apakah method ini sudah pakai @PreAuthorize?
```

Ia bertanya:

```text
Apakah query ini hanya mengambil data yang memang boleh dilihat user?
Apakah count-nya juga scoped?
Apakah export-nya juga scoped?
Apakah search index-nya juga scoped?
Apakah cache key-nya juga scoped?
Apakah aggregation tidak membocorkan keberadaan data terlarang?
```

---

## 2. Problem Dasar: Filter-After-Fetch Anti-Pattern

### 2.1 Contoh buruk

```java
public List<CaseDto> listCases(CurrentUser user, CaseSearchRequest request) {
    List<CaseEntity> cases = caseRepository.search(request);

    return cases.stream()
            .filter(c -> authorizationService.canViewCase(user, c))
            .map(caseMapper::toDto)
            .collect(Collectors.toList());
}
```

Sekilas terlihat aman karena ada filter authorization.

Tetapi ini berbahaya.

Masalahnya:

1. Data unauthorized sudah terambil dari database.
2. Pagination menjadi salah.
3. Count menjadi salah.
4. Sorting menjadi salah.
5. Performance buruk.
6. Bisa terjadi side-channel leakage.
7. Bisa bocor lewat log/debug/JPA session/cache.
8. Bisa gagal jika mapper berjalan sebelum filter.
9. Bisa gagal jika collection lazy relation ter-load sebelum filter.
10. Bisa gagal jika developer lupa filter pada endpoint lain.

### 2.2 Pagination rusak

Misal database punya 1000 case.

User hanya boleh melihat 20 case.

Request:

```text
GET /cases?page=0&size=10
```

Jika query mengambil page pertama dari semua case:

```sql
SELECT *
FROM cases
ORDER BY created_at DESC
LIMIT 10 OFFSET 0;
```

Lalu Java memfilter hasilnya:

```text
10 rows fetched
8 unauthorized
2 authorized
```

Maka user melihat 2 item saja, padahal mungkin ada 20 authorized rows di page lain.

Lebih buruk lagi, total count mungkin tetap menampilkan:

```json
{
  "totalElements": 1000,
  "content": [ ... 2 items ... ]
}
```

Ini membocorkan skala data yang tidak boleh diketahui user.

### 2.3 Correct mental model

Authorization predicate harus masuk ke query:

```sql
SELECT *
FROM cases c
WHERE c.agency_id = :currentAgencyId
  AND c.status IN (:allowedStatuses)
  AND EXISTS (
      SELECT 1
      FROM case_assignment ca
      WHERE ca.case_id = c.id
        AND ca.user_id = :currentUserId
  )
ORDER BY c.created_at DESC
LIMIT :limit OFFSET :offset;
```

Count juga harus pakai predicate yang sama:

```sql
SELECT COUNT(*)
FROM cases c
WHERE c.agency_id = :currentAgencyId
  AND c.status IN (:allowedStatuses)
  AND EXISTS (...);
```

Rule:

> **List authorization must be expressed as query scope, not as in-memory cleanup.**

---

## 3. Data-Level Authorization: Definisi Presisi

Data-level authorization adalah proses membatasi dataset yang dapat:

1. dibaca,
2. dicari,
3. dihitung,
4. diagregasi,
5. diekspor,
6. di-stream,
7. diindeks,
8. di-cache,
9. diproses background job,
10. dipakai sebagai input keputusan,

berdasarkan subject, action, resource type, resource attributes, relationship, tenant, dan context.

Data-level authorization biasanya menghasilkan salah satu dari bentuk berikut:

```text
1. Predicate
   agency_id = :agencyId AND assigned_user_id = :userId

2. Scope object
   CaseScope(agencyId, allowedCaseTypes, assignedOnly, allowedStatuses)

3. Relationship constraint
   EXISTS case_assignment(user_id = :userId)

4. SQL fragment / Criteria Predicate
   CriteriaBuilder.and(...)

5. Search filter
   agency_id:CEA AND allowed_user_ids:user-123

6. Row-level database policy
   USING (agency_id = current_setting('app.agency_id'))

7. Materialized authorized view
   authorized_case_visibility(user_id, case_id)
```

---

## 4. Why Top 1% Engineers Treat Query Scoping as First-Class

Authorization bugs in data access are subtle because they often do not look like security code.

They look like:

```java
findAllByStatus(status)
findByCreatedDateBetween(from, to)
searchByKeyword(keyword)
countByAgencyId(agencyId)
exportCases(filter)
getDashboardSummary()
```

But each is authorization-sensitive.

A mature engineer recognizes that any method returning more than one resource is asking:

```text
What is the authorized universe for this query?
```

The question is not:

```text
Can user access this endpoint?
```

The question is:

```text
Can user access every row, every field, every count, every aggregate, every link, every downloadable file, and every related object returned by this operation?
```

---

## 5. Data-Level Authorization Failure Taxonomy

### 5.1 Missing query predicate

```java
List<CaseEntity> findByStatus(CaseStatus status);
```

No tenant.
No assignment.
No organization boundary.
No confidentiality filter.

### 5.2 Predicate placed only in controller

```java
@PreAuthorize("hasAuthority('case.read')")
@GetMapping("/cases")
public Page<CaseDto> list(...) { ... }
```

This only checks function-level permission.
It does not scope rows.

### 5.3 User-controlled tenant ID

```text
GET /cases?agencyId=OTHER_AGENCY
```

Bad:

```java
caseRepository.findByAgencyId(request.getAgencyId());
```

Correct:

```java
AgencyId agencyId = currentUser.requiredAgencyId();
caseRepository.findByAgencyId(agencyId);
```

Or more accurately:

```java
CaseScope scope = caseAuthorizationScopes.forList(currentUser, context);
caseRepository.search(request, scope);
```

### 5.4 Filter-after-fetch

Discussed earlier.

### 5.5 Count leakage

```json
{
  "totalElements": 89321
}
```

Even if rows are filtered later, count can leak existence/volume.

### 5.6 Aggregation leakage

```text
Dashboard: 3 high-risk enforcement cases in department X
```

If user cannot view those cases, even aggregate may be sensitive.

### 5.7 Search index leakage

Database query is scoped, but OpenSearch query is not.

### 5.8 Export bypass

UI list is scoped, CSV export uses a different repository method and leaks all rows.

### 5.9 Background job bypass

Async export, email digest, notification generator, or scheduled report runs as system user and forgets recipient scope.

### 5.10 Cache leakage

```java
@Cacheable("caseSearch")
public Page<CaseDto> search(CaseSearchRequest request) { ... }
```

Cache key lacks user/tenant/scope.

User B receives User A's authorized result.

### 5.11 DTO relation leakage

Top-level case is authorized, but DTO includes unauthorized child objects:

```json
{
  "caseId": "CASE-1",
  "documents": [
    { "id": "DOC-SECRET", "title": "Legal opinion" }
  ]
}
```

### 5.12 Report layer bypass

BI/report SQL queries directly tables without applying app-level authorization rules.

### 5.13 Replica/lake bypass

Data lake or read replica has no row-level policy; Athena/warehouse query exposes unauthorized historical data.

### 5.14 Soft-delete/status leakage

User cannot see archived/withdrawn/deleted/draft records, but query forgets lifecycle condition.

### 5.15 Field-level leakage

User can see case row but not fields:

- identity number,
- confidential note,
- internal comment,
- enforcement strategy,
- legal advice,
- investigation detail.

---

## 6. The Authorized Query Triangle

Every data-returning operation must satisfy three constraints:

```text
                Business Filter
                    /\
                   /  \
                  /    \
                 /      \
                /        \
 Authorization /__________\ Data Shape
    Scope                    Projection
```

### 6.1 Business filter

What the user asked for:

```text
status = OPEN
createdDate between X and Y
keyword contains "renewal"
caseType = APPEAL
```

### 6.2 Authorization scope

What the user is allowed to see:

```text
agency = current user's agency
assigned to current user
case state visible to this role
not confidential unless clearance exists
```

### 6.3 Data shape/projection

What fields/relations the user is allowed to receive:

```text
basic case info only
hide internal notes
mask NRIC
include documents only if document-level authorization passes
```

A correct query is not just:

```text
business filter + pagination
```

It is:

```text
business filter
AND authorization scope
THEN authorized projection
THEN authorized count/aggregation/export/cache
```

---

## 7. The Core Design: Authorization Scope Object

A good Java design separates:

1. **authorization decision for one object**,
2. **authorization scope for many objects**.

### 7.1 Single-object decision

```java
public interface CaseAuthorizationService {
    PolicyDecision canViewCase(CurrentUser user, CaseEntity caseEntity, AuthorizationContext context);
}
```

### 7.2 Query-scope decision

```java
public interface CaseAuthorizationScopeService {
    CaseReadScope scopeForCaseSearch(CurrentUser user, AuthorizationContext context);
}
```

### 7.3 Scope object example — Java 8 compatible

```java
public final class CaseReadScope {
    private final TenantId tenantId;
    private final AgencyId agencyId;
    private final UserId userId;
    private final Set<CaseType> allowedCaseTypes;
    private final Set<CaseStatus> allowedStatuses;
    private final boolean assignedOnly;
    private final boolean includeConfidential;
    private final boolean includeArchived;

    public CaseReadScope(
            TenantId tenantId,
            AgencyId agencyId,
            UserId userId,
            Set<CaseType> allowedCaseTypes,
            Set<CaseStatus> allowedStatuses,
            boolean assignedOnly,
            boolean includeConfidential,
            boolean includeArchived
    ) {
        this.tenantId = Objects.requireNonNull(tenantId, "tenantId");
        this.agencyId = Objects.requireNonNull(agencyId, "agencyId");
        this.userId = Objects.requireNonNull(userId, "userId");
        this.allowedCaseTypes = Collections.unmodifiableSet(new LinkedHashSet<>(allowedCaseTypes));
        this.allowedStatuses = Collections.unmodifiableSet(new LinkedHashSet<>(allowedStatuses));
        this.assignedOnly = assignedOnly;
        this.includeConfidential = includeConfidential;
        this.includeArchived = includeArchived;
    }

    public TenantId tenantId() {
        return tenantId;
    }

    public AgencyId agencyId() {
        return agencyId;
    }

    public UserId userId() {
        return userId;
    }

    public Set<CaseType> allowedCaseTypes() {
        return allowedCaseTypes;
    }

    public Set<CaseStatus> allowedStatuses() {
        return allowedStatuses;
    }

    public boolean assignedOnly() {
        return assignedOnly;
    }

    public boolean includeConfidential() {
        return includeConfidential;
    }

    public boolean includeArchived() {
        return includeArchived;
    }
}
```

### 7.4 Java 17+ record version

```java
public record CaseReadScope(
        TenantId tenantId,
        AgencyId agencyId,
        UserId userId,
        Set<CaseType> allowedCaseTypes,
        Set<CaseStatus> allowedStatuses,
        boolean assignedOnly,
        boolean includeConfidential,
        boolean includeArchived
) {
    public CaseReadScope {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(agencyId, "agencyId");
        Objects.requireNonNull(userId, "userId");
        allowedCaseTypes = Set.copyOf(allowedCaseTypes);
        allowedStatuses = Set.copyOf(allowedStatuses);
    }
}
```

### 7.5 Why scope object matters

Without scope object, authorization logic is copied into repositories:

```java
findVisibleCasesForAgencyOfficer(...)
findVisibleCasesForAgencyAdmin(...)
findVisibleCasesForSupervisor(...)
findVisibleCasesForReviewer(...)
findVisibleCasesForSupportUser(...)
```

This creates drift.

With scope object:

```java
CaseReadScope scope = caseScopeService.scopeForCaseSearch(user, context);
Page<CaseSummary> page = caseQueryRepository.search(request, scope, pageable);
```

The repository does not decide who the user is.
It only translates a validated scope into query predicates.

---

## 8. Reference Architecture

```text
HTTP / gRPC / GraphQL / Job / Export
        |
        v
Application Service / Query Service
        |
        |-- build AuthorizationContext
        |-- ask AuthorizationScopeService
        v
Authorization Scope
        |
        v
Repository / Query Builder / Search Adapter
        |
        |-- business predicates
        |-- authorization predicates
        |-- projection rules
        v
Database / Search Index / Warehouse
        |
        v
Authorized Result / Count / Aggregation / Export
        |
        v
Audit + Observability
```

Important boundary:

```text
Scope service decides WHAT is allowed.
Repository decides HOW to express it efficiently.
```

---

## 9. Query Scoping With Spring Data JPA Specification

Spring Data JPA `Specification` is useful because it represents reusable predicates over entities. It maps well to data-level authorization when used carefully.

### 9.1 Repository

```java
public interface CaseRepository extends JpaRepository<CaseEntity, Long>,
        JpaSpecificationExecutor<CaseEntity> {
}
```

### 9.2 Business filter specification

```java
public final class CaseSearchSpecifications {

    private CaseSearchSpecifications() {
    }

    public static Specification<CaseEntity> matchesSearch(CaseSearchRequest request) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            if (request.status() != null) {
                predicates.add(cb.equal(root.get("status"), request.status()));
            }

            if (request.caseType() != null) {
                predicates.add(cb.equal(root.get("caseType"), request.caseType()));
            }

            if (request.createdFrom() != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), request.createdFrom()));
            }

            if (request.createdTo() != null) {
                predicates.add(cb.lessThan(root.get("createdAt"), request.createdTo()));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }
}
```

### 9.3 Authorization specification

```java
public final class CaseAuthorizationSpecifications {

    private CaseAuthorizationSpecifications() {
    }

    public static Specification<CaseEntity> readableBy(CaseReadScope scope) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            predicates.add(cb.equal(root.get("tenantId"), scope.tenantId().value()));
            predicates.add(cb.equal(root.get("agencyId"), scope.agencyId().value()));

            if (!scope.allowedCaseTypes().isEmpty()) {
                predicates.add(root.get("caseType").in(scope.allowedCaseTypes()));
            }

            if (!scope.allowedStatuses().isEmpty()) {
                predicates.add(root.get("status").in(scope.allowedStatuses()));
            }

            if (scope.assignedOnly()) {
                Subquery<Long> subquery = query.subquery(Long.class);
                Root<CaseAssignmentEntity> assignment = subquery.from(CaseAssignmentEntity.class);
                subquery.select(cb.literal(1L));
                subquery.where(
                        cb.equal(assignment.get("caseId"), root.get("id")),
                        cb.equal(assignment.get("userId"), scope.userId().value()),
                        cb.equal(assignment.get("active"), true)
                );
                predicates.add(cb.exists(subquery));
            }

            if (!scope.includeConfidential()) {
                predicates.add(cb.equal(root.get("confidential"), false));
            }

            if (!scope.includeArchived()) {
                predicates.add(cb.equal(root.get("archived"), false));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }
}
```

### 9.4 Query service

```java
@Service
public class CaseQueryService {
    private final CaseRepository caseRepository;
    private final CaseAuthorizationScopeService scopeService;
    private final CaseMapper caseMapper;

    public CaseQueryService(
            CaseRepository caseRepository,
            CaseAuthorizationScopeService scopeService,
            CaseMapper caseMapper
    ) {
        this.caseRepository = caseRepository;
        this.scopeService = scopeService;
        this.caseMapper = caseMapper;
    }

    @Transactional(readOnly = true)
    public Page<CaseSummaryDto> search(
            CurrentUser user,
            AuthorizationContext context,
            CaseSearchRequest request,
            Pageable pageable
    ) {
        CaseReadScope scope = scopeService.scopeForCaseSearch(user, context);

        Specification<CaseEntity> spec = Specification
                .where(CaseAuthorizationSpecifications.readableBy(scope))
                .and(CaseSearchSpecifications.matchesSearch(request));

        return caseRepository.findAll(spec, pageable)
                .map(caseMapper::toSummaryDto);
    }
}
```

### 9.5 Critical detail

Authorization spec comes first conceptually, but SQL optimizer can reorder predicates. That is fine. The important invariant is:

```text
The generated query must include authorization predicate and business predicate together.
```

---

## 10. Query Scoping With Criteria API Directly

For complex enterprise queries, `Specification` can become limiting. You may need custom repository implementation.

```java
@Repository
public class CaseQueryRepository {
    private final EntityManager entityManager;

    public CaseQueryRepository(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public Page<CaseSummaryRow> search(
            CaseSearchRequest request,
            CaseReadScope scope,
            Pageable pageable
    ) {
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();

        CriteriaQuery<CaseSummaryRow> cq = cb.createQuery(CaseSummaryRow.class);
        Root<CaseEntity> root = cq.from(CaseEntity.class);

        List<Predicate> predicates = new ArrayList<>();
        addAuthorizationPredicates(predicates, root, cq, cb, scope);
        addBusinessPredicates(predicates, root, cb, request);

        cq.select(cb.construct(
                CaseSummaryRow.class,
                root.get("id"),
                root.get("caseNo"),
                root.get("caseType"),
                root.get("status"),
                root.get("createdAt")
        ));
        cq.where(cb.and(predicates.toArray(new Predicate[0])));
        cq.orderBy(cb.desc(root.get("createdAt")));

        List<CaseSummaryRow> rows = entityManager.createQuery(cq)
                .setFirstResult((int) pageable.getOffset())
                .setMaxResults(pageable.getPageSize())
                .getResultList();

        long total = count(request, scope);

        return new PageImpl<>(rows, pageable, total);
    }

    private long count(CaseSearchRequest request, CaseReadScope scope) {
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<Long> cq = cb.createQuery(Long.class);
        Root<CaseEntity> root = cq.from(CaseEntity.class);

        List<Predicate> predicates = new ArrayList<>();
        addAuthorizationPredicates(predicates, root, cq, cb, scope);
        addBusinessPredicates(predicates, root, cb, request);

        cq.select(cb.count(root));
        cq.where(cb.and(predicates.toArray(new Predicate[0])));

        return entityManager.createQuery(cq).getSingleResult();
    }

    private void addAuthorizationPredicates(
            List<Predicate> predicates,
            Root<CaseEntity> root,
            CommonAbstractCriteria query,
            CriteriaBuilder cb,
            CaseReadScope scope
    ) {
        predicates.add(cb.equal(root.get("tenantId"), scope.tenantId().value()));
        predicates.add(cb.equal(root.get("agencyId"), scope.agencyId().value()));

        if (!scope.includeConfidential()) {
            predicates.add(cb.isFalse(root.get("confidential")));
        }
    }

    private void addBusinessPredicates(
            List<Predicate> predicates,
            Root<CaseEntity> root,
            CriteriaBuilder cb,
            CaseSearchRequest request
    ) {
        if (request.status() != null) {
            predicates.add(cb.equal(root.get("status"), request.status()));
        }
    }
}
```

The key is reusing predicate construction for both data query and count query.

---

## 11. Query Scoping With MyBatis

MyBatis is explicit SQL. This can be both safer and more dangerous.

Safer because SQL is visible.
Dangerous because every mapper query must remember scope.

### 11.1 Scope parameter

```java
public final class CaseSearchSqlParams {
    private final CaseSearchRequest request;
    private final CaseReadScope scope;
    private final int limit;
    private final int offset;

    // constructor/getters omitted
}
```

### 11.2 Mapper interface

```java
public interface CaseMapper {
    List<CaseSummaryRow> searchCases(CaseSearchSqlParams params);
    long countCases(CaseSearchSqlParams params);
}
```

### 11.3 XML mapper

```xml
<select id="searchCases" resultType="com.example.CaseSummaryRow">
  SELECT
    c.id,
    c.case_no,
    c.case_type,
    c.status,
    c.created_at
  FROM cases c
  WHERE c.tenant_id = #{scope.tenantId.value}
    AND c.agency_id = #{scope.agencyId.value}

    <if test="scope.includeConfidential == false">
      AND c.confidential = false
    </if>

    <if test="scope.includeArchived == false">
      AND c.archived = false
    </if>

    <if test="request.status != null">
      AND c.status = #{request.status}
    </if>

    <if test="scope.assignedOnly == true">
      AND EXISTS (
        SELECT 1
        FROM case_assignment ca
        WHERE ca.case_id = c.id
          AND ca.user_id = #{scope.userId.value}
          AND ca.active = true
      )
    </if>

  ORDER BY c.created_at DESC
  LIMIT #{limit}
  OFFSET #{offset}
</select>
```

### 11.4 MyBatis safety rule

Never expose mapper methods like this to application service:

```java
List<CaseSummaryRow> searchCases(CaseSearchRequest request);
```

Prefer requiring scope:

```java
List<CaseSummaryRow> searchCases(CaseSearchRequest request, CaseReadScope scope);
```

Even better: package-private adapter or query repository that always requires authorization scope.

---

## 12. Query Scoping With Plain JDBC

Plain JDBC remains useful in performance-sensitive reporting/export.

The danger: string-based SQL can drift.

Use explicit builders and mandatory scope.

```java
public final class CaseSqlBuilder {

    public SqlAndParams buildSearch(CaseSearchRequest request, CaseReadScope scope, int limit, int offset) {
        StringBuilder sql = new StringBuilder();
        List<Object> params = new ArrayList<>();

        sql.append("""
            SELECT c.id, c.case_no, c.case_type, c.status, c.created_at
            FROM cases c
            WHERE c.tenant_id = ?
              AND c.agency_id = ?
            """);
        params.add(scope.tenantId().value());
        params.add(scope.agencyId().value());

        if (!scope.includeConfidential()) {
            sql.append(" AND c.confidential = false");
        }

        if (!scope.includeArchived()) {
            sql.append(" AND c.archived = false");
        }

        if (request.status() != null) {
            sql.append(" AND c.status = ?");
            params.add(request.status().name());
        }

        if (scope.assignedOnly()) {
            sql.append("""
                AND EXISTS (
                    SELECT 1
                    FROM case_assignment ca
                    WHERE ca.case_id = c.id
                      AND ca.user_id = ?
                      AND ca.active = true
                )
                """);
            params.add(scope.userId().value());
        }

        sql.append(" ORDER BY c.created_at DESC LIMIT ? OFFSET ?");
        params.add(limit);
        params.add(offset);

        return new SqlAndParams(sql.toString(), params);
    }
}
```

Rule:

> **Any custom SQL that returns domain data must accept an explicit authorization scope or be provably system-internal and audited.**

---

## 13. Hibernate Filters: Useful but Dangerous if Misunderstood

Hibernate filters are named, parameterized filters enabled per Hibernate `Session`.

They can help with tenant or visibility rules.

Example:

```java
@Entity
@FilterDef(
        name = "tenantFilter",
        parameters = @ParamDef(name = "tenantId", type = String.class)
)
@Filter(
        name = "tenantFilter",
        condition = "tenant_id = :tenantId"
)
public class CaseEntity {
    // ...
}
```

Enable filter:

```java
Session session = entityManager.unwrap(Session.class);
session.enableFilter("tenantFilter")
        .setParameter("tenantId", currentTenantId.value());
```

### 13.1 Where filters help

They are useful for:

1. tenant isolation,
2. soft-delete,
3. simple visibility flags,
4. archive exclusion,
5. simple organization boundary.

### 13.2 Where filters are insufficient

They are not enough for:

1. complex relationship-based authorization,
2. action-specific authorization,
3. report/export native SQL that bypasses ORM,
4. search index authorization,
5. cross-entity policy decisions,
6. field-level masking,
7. explainable decision logging.

### 13.3 Main risk

Filter must be enabled for the current session.

If one code path forgets:

```java
session.enableFilter("tenantFilter")
```

then authorization boundary disappears.

Therefore filters should be used as **defense-in-depth**, not as the only source of truth unless your architecture strictly guarantees activation.

---

## 14. Database Row-Level Security

Database row-level security is a strong defense-in-depth mechanism.

For example, PostgreSQL RLS allows table policies that restrict which rows can be selected, inserted, updated, or deleted based on policy expressions.

### 14.1 Example concept

```sql
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY case_tenant_policy ON cases
USING (tenant_id = current_setting('app.tenant_id'));
```

Application sets context per connection/transaction:

```sql
SET LOCAL app.tenant_id = 'tenant-a';
```

Then normal query:

```sql
SELECT * FROM cases;
```

is transparently scoped by the database policy.

### 14.2 Why this matters

RLS can protect against:

1. missing predicate in app query,
2. ad-hoc query through same application role,
3. bug in repository method,
4. some report query mistakes,
5. accidental cross-tenant access.

### 14.3 Why this is not magic

RLS still requires discipline:

1. App must set correct DB session context.
2. Connection pooling must not leak context.
3. Admin/bypass roles must be controlled.
4. Policy must be tested.
5. Query performance must be evaluated.
6. Explainability must include DB policy state.
7. Not all databases support the same model.
8. Complex app-level state may be hard to encode in SQL policy.

### 14.4 Java connection pool concern

With connection pools, never rely on permanent session variables unless you reset them safely.

Prefer transaction-local setting where supported:

```sql
SET LOCAL app.tenant_id = ?
```

Within Java transaction:

```java
@Transactional(readOnly = true)
public Page<CaseSummaryDto> search(...) {
    dbSessionContext.setLocal("app.tenant_id", tenantId.value());
    return repository.search(...);
}
```

If using HikariCP or similar pools, remember:

```text
A physical DB connection is reused across logical requests.
Any session-level context can leak if not reset.
```

### 14.5 RLS as defense-in-depth

Recommended mental model:

```text
Application authorization decides and explains.
Database RLS constrains and protects.
```

Do not say:

```text
We use RLS, so application does not need authorization.
```

Better:

```text
We enforce business authorization in app/service/repository and use RLS as an additional hard boundary for tenant/resource isolation.
```

---

## 15. Query Scoping for Search Indexes

Search engines often become authorization bypasses.

Database query:

```sql
WHERE agency_id = :agencyId
```

Search query:

```json
{
  "query": {
    "match": {
      "fullText": "renewal"
    }
  }
}
```

This leaks across agencies if not scoped.

### 15.1 Correct search query shape

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "fullText": "renewal" } }
      ],
      "filter": [
        { "term": { "tenantId": "tenant-a" } },
        { "term": { "agencyId": "cea" } },
        { "terms": { "caseType": ["ENFORCEMENT", "APPEAL"] } },
        { "term": { "confidential": false } }
      ]
    }
  }
}
```

### 15.2 Search authorization patterns

#### Pattern A — Indexed authorization attributes

Store visibility attributes in each indexed document:

```json
{
  "caseId": "CASE-1",
  "tenantId": "tenant-a",
  "agencyId": "cea",
  "caseType": "ENFORCEMENT",
  "status": "OPEN",
  "confidential": false,
  "assignedUserIds": ["u1", "u2"],
  "allowedGroupIds": ["g-case-reviewers"]
}
```

Pros:

- fast filtering,
- simple query,
- works well for read-heavy search.

Cons:

- authorization state duplication,
- reindex needed on assignment/role/group changes,
- stale visibility risk.

#### Pattern B — Search IDs first, authorize in DB second

Search index returns candidate IDs only:

```text
[CASE-1, CASE-2, CASE-3, ...]
```

Database query applies authorization:

```sql
SELECT *
FROM cases
WHERE id IN (:candidateIds)
  AND agency_id = :agencyId
  AND EXISTS (...)
```

Pros:

- DB remains source of authorization truth,
- less duplicated visibility state.

Cons:

- pagination is hard,
- ranking may be distorted,
- candidate window must be large,
- can be slow.

#### Pattern C — Materialized visibility index

Maintain separate access index:

```text
case_visibility(user_id, case_id, action)
```

Search query joins or filters using materialized visibility.

Pros:

- fast per-user visibility,
- consistent for complex relationships if maintained well.

Cons:

- large storage,
- invalidation complexity,
- update lag.

### 15.3 Search side-channel

Even if results are filtered, search can leak via:

1. total hits,
2. autocomplete suggestions,
3. facets,
4. highlight snippets,
5. typo correction,
6. aggregations,
7. “did you mean” suggestions.

If user cannot view confidential cases, autocomplete should not suggest terms that only exist in confidential cases.

---

## 16. Count and Pagination Authorization

### 16.1 Count must use the same scope

Bad:

```java
long total = caseRepository.countByStatus(request.status());
List<CaseEntity> rows = caseRepository.findAuthorized(...);
```

Correct:

```java
long total = caseRepository.count(request, scope);
List<CaseEntity> rows = caseRepository.search(request, scope, pageable);
```

### 16.2 Offset pagination caveat

With complex authorization predicates, offset pagination can be expensive.

```sql
WHERE tenant_id = ?
  AND agency_id = ?
  AND EXISTS (...)
ORDER BY created_at DESC
LIMIT 50 OFFSET 50000
```

Large offset forces database to scan/skip many rows.

### 16.3 Keyset pagination

For large datasets, use keyset/cursor pagination:

```sql
WHERE tenant_id = ?
  AND agency_id = ?
  AND created_at < :lastSeenCreatedAt
ORDER BY created_at DESC
LIMIT 50
```

But cursor must include authorization-stable ordering keys.

Cursor should not encode unauthorized data.

Example cursor payload:

```json
{
  "createdAt": "2026-06-18T10:15:30Z",
  "caseId": "CASE-123"
}
```

Sign/encrypt cursor if it contains sensitive internals.

### 16.4 Pagination and changing authorization

Authorization can change between page 1 and page 2:

- assignment removed,
- role revoked,
- case becomes confidential,
- tenant switched,
- status changed.

Therefore cursor/session should not assume previous authorization remains valid.

Each page request must reapply scope.

---

## 17. Aggregation Authorization

Aggregation is not automatically safe.

Example:

```sql
SELECT status, COUNT(*)
FROM cases
GROUP BY status;
```

If unscoped, it leaks global system state.

Correct:

```sql
SELECT status, COUNT(*)
FROM cases
WHERE tenant_id = :tenantId
  AND agency_id = :agencyId
  AND ...authorization predicate...
GROUP BY status;
```

### 17.1 Aggregation leakage examples

1. Count of confidential cases.
2. Count of enforcement actions against a company.
3. Count of appeals for a person.
4. Average penalty amount.
5. Max/min sanction value.
6. Trend by month revealing investigation activity.

### 17.2 Small-count suppression

In some regulatory/statistical contexts, even scoped aggregate can identify individuals.

Example:

```text
Only one respondent in a category.
```

Mitigation:

```text
If count < threshold, suppress or bucket.
```

Example:

```java
public AggregationResult protectSmallCounts(AggregationResult result) {
    return result.mapBuckets(bucket -> {
        if (bucket.count() > 0 && bucket.count() < 5) {
            return bucket.suppressed();
        }
        return bucket;
    });
}
```

This is not always required, but top-level engineers ask the question.

---

## 18. Export Authorization

Export is one of the most common bypasses.

### 18.1 Why export is dangerous

Export often:

1. bypasses UI pagination,
2. runs asynchronously,
3. uses custom SQL,
4. includes more columns,
5. includes hidden fields,
6. runs as system user,
7. stores file in object storage,
8. sends download link by email,
9. persists after permission revocation.

### 18.2 Export must use same scope

```java
public ExportJobId requestCaseExport(
        CurrentUser user,
        AuthorizationContext context,
        CaseSearchRequest request
) {
    CaseReadScope scope = scopeService.scopeForCaseExport(user, context);

    ExportRequest exportRequest = ExportRequest.create(
            user.userId(),
            request,
            scope.snapshot(),
            Instant.now()
    );

    return exportJobRepository.save(exportRequest).jobId();
}
```

### 18.3 Scope snapshot vs recompute

There are two valid patterns.

#### Pattern A — Snapshot scope at request time

```text
User requested export at T1.
Export job uses authorization scope from T1.
```

Pros:

- reproducible,
- stable,
- audit-friendly.

Cons:

- if access is revoked at T2 before job runs, export may still include data.

#### Pattern B — Recompute scope at execution time

```text
User requested export at T1.
Export job recomputes authorization at T2.
```

Pros:

- respects revocation.

Cons:

- result may differ from what user saw,
- harder to explain.

#### Recommended for sensitive systems

Use both:

```text
1. Store request-time scope for audit.
2. Recompute execution-time scope for enforcement.
3. Use intersection of both scopes.
```

```java
CaseReadScope requestedScope = exportRequest.scopeSnapshot();
CaseReadScope currentScope = scopeService.scopeForCaseExport(user, context);
CaseReadScope effectiveScope = CaseReadScope.intersection(requestedScope, currentScope);
```

### 18.4 Export file authorization

Export generation is not the end.
Download also needs authorization.

```text
Can user download export file EXPORT-123 now?
```

Rules:

1. Export file belongs to requesting user or authorized delegate.
2. Export file expires.
3. Link is not globally accessible.
4. File object storage policy is private.
5. Download is audited.
6. Sensitive export may require step-up authorization.

---

## 19. Report Authorization

Reports are harder than normal queries because they often combine:

1. multiple tables,
2. historical snapshots,
3. denormalized views,
4. materialized aggregates,
5. BI tools,
6. cross-agency metrics,
7. scheduled distribution.

### 19.1 Report authorization questions

For every report:

```text
Who can run it?
What rows are included?
What columns are included?
What aggregation granularity is allowed?
Can the result be exported?
Can it be scheduled?
Who can receive it?
Can it cross tenant/agency boundary?
What historical permission model applies?
```

### 19.2 Report permission is not enough

Bad:

```text
User has report.view.case-summary.
Therefore show all case summary data.
```

Correct:

```text
User has permission to run this report.
Report data is scoped by tenant, agency, role, case type, confidentiality, and report-specific rules.
```

### 19.3 Scheduled report risk

A user schedules report while authorized.
Later access is revoked.
Scheduled report continues sending data.

Mitigation:

1. Re-evaluate authorization before each run.
2. Re-evaluate recipient authorization.
3. Store report policy version.
4. Audit each delivery.
5. Expire scheduled reports after role changes.

---

## 20. Field-Level Authorization and Projection

Row-level authorization answers:

```text
Can user see this row?
```

Field-level authorization answers:

```text
Which fields of this row can user see?
```

### 20.1 Common sensitive fields

1. NRIC/passport/identity numbers.
2. Phone/email/address.
3. Internal notes.
4. Legal advice.
5. Investigation strategy.
6. Risk score.
7. Financial amount.
8. Attachment metadata.
9. Audit actor identity.
10. System diagnostic fields.

### 20.2 Avoid entity-to-DTO overexposure

Bad:

```java
public CaseDto toDto(CaseEntity entity) {
    return new CaseDto(
            entity.getId(),
            entity.getCaseNo(),
            entity.getInternalNote(),
            entity.getRiskScore(),
            entity.getRespondentNric()
    );
}
```

Correct:

```java
public CaseDto toDto(CaseEntity entity, CaseProjectionPolicy projectionPolicy) {
    return new CaseDto(
            entity.getId(),
            entity.getCaseNo(),
            projectionPolicy.canViewInternalNote() ? entity.getInternalNote() : null,
            projectionPolicy.canViewRiskScore() ? entity.getRiskScore() : null,
            projectionPolicy.canViewIdentityNumber()
                    ? entity.getRespondentNric()
                    : maskIdentity(entity.getRespondentNric())
    );
}
```

### 20.3 Better: query projection

Do not fetch sensitive columns if not needed.

```java
public record CasePublicSummary(
        Long id,
        String caseNo,
        CaseStatus status,
        Instant createdAt
) {}
```

Versus:

```java
public record CaseInternalSummary(
        Long id,
        String caseNo,
        CaseStatus status,
        String internalNote,
        RiskScore riskScore,
        Instant createdAt
) {}
```

Select different projection based on policy.

### 20.4 Field masking is not always authorization

Masking is appropriate when:

```text
User may know the value exists, but may only see partial value.
```

Deny/hide is appropriate when:

```text
User must not know the field exists or has a value.
```

Example:

```text
Masked: S****123A
Hidden: null / omitted / not included
Denied: 403 for field-specific endpoint
```

---

## 21. Relation-Level Authorization

A parent row may be authorized while child relation is not.

Example:

```json
{
  "caseNo": "CASE-001",
  "documents": [...],
  "auditTrail": [...],
  "internalNotes": [...],
  "legalAdvice": [...]
}
```

Do not assume:

```text
Can view case => can view all child data.
```

### 21.1 Relation policy

```java
public final class CaseProjectionPolicy {
    private final boolean includeDocuments;
    private final boolean includeInternalNotes;
    private final boolean includeLegalAdvice;
    private final boolean includeAuditTrail;

    // constructor/getters omitted
}
```

### 21.2 Separate child queries

Instead of eager fetching everything:

```java
CaseDetailDto dto = caseMapper.toDetail(caseEntity);
```

Use scoped child repositories:

```java
List<DocumentDto> documents = documentQueryRepository.findVisibleDocuments(
        caseId,
        documentScopeService.scopeForCaseDocuments(user, context, caseId)
);

List<InternalNoteDto> notes = noteQueryRepository.findVisibleNotes(
        caseId,
        noteScopeService.scopeForCaseNotes(user, context, caseId)
);
```

This is more verbose, but much safer.

---

## 22. Cache and Data-Level Authorization

Caching authorized data is difficult because authorization scope is part of the cache key.

### 22.1 Bad cache key

```java
@Cacheable(cacheNames = "caseSearch", key = "#request.hashCode()")
public Page<CaseSummaryDto> search(CaseSearchRequest request) {
    ...
}
```

This ignores:

1. user,
2. tenant,
3. agency,
4. role/permission version,
5. assignment version,
6. confidentiality clearance,
7. policy version,
8. context.

### 22.2 Better cache key

```java
public final class AuthorizedQueryCacheKey {
    private final String tenantId;
    private final String userId;
    private final String scopeFingerprint;
    private final String requestFingerprint;
    private final String policyVersion;

    // constructor, equals, hashCode
}
```

### 22.3 Scope fingerprint

Instead of putting huge scope into key, compute fingerprint:

```java
public String fingerprint(CaseReadScope scope) {
    MessageDigest digest = sha256();
    update(digest, scope.tenantId().value());
    update(digest, scope.agencyId().value());
    update(digest, scope.userId().value());
    update(digest, scope.allowedCaseTypes().toString());
    update(digest, scope.allowedStatuses().toString());
    update(digest, Boolean.toString(scope.assignedOnly()));
    update(digest, Boolean.toString(scope.includeConfidential()));
    update(digest, Boolean.toString(scope.includeArchived()));
    return hex(digest.digest());
}
```

### 22.4 Safer approach

Often, do not cache final authorized result unless:

1. cache key is correct,
2. invalidation strategy exists,
3. sensitive data risk is low,
4. TTL is short,
5. tenant/user/scope isolation is proven.

Cache safer things:

- policy metadata,
- role permission mapping,
- org hierarchy,
- resource attributes,
- compiled query plan,
- non-sensitive reference data.

Be very careful caching:

- search result pages,
- export files,
- user-specific dashboards,
- document metadata,
- decision results involving volatile attributes.

---

## 23. Bulk Authorization and N+1 Avoidance

### 23.1 Naive pattern

```java
List<CaseEntity> cases = repository.findCandidates(request);
List<CaseDto> authorized = new ArrayList<>();

for (CaseEntity c : cases) {
    if (authorizationService.canViewCase(user, c).isAllowed()) {
        authorized.add(mapper.toDto(c));
    }
}
```

Problems:

1. N+1 policy calls.
2. N+1 DB calls for relationship/attribute lookup.
3. Pagination wrong.
4. Filtering after fetch.

### 23.2 Bulk decision API

For cases where predicate cannot fully express policy, use bulk decision carefully.

```java
Map<CaseId, PolicyDecision> decisions = authorizationService.canViewCases(
        user,
        candidateCaseIds,
        context
);
```

But remember:

```text
Bulk decision after fetching candidates is not a substitute for query scoping if the candidate set itself leaks or pagination/count matter.
```

### 23.3 Hybrid approach

1. Apply broad query scope in DB.
2. Fetch candidate rows.
3. Apply fine-grained bulk decision if needed.
4. Use cursor or over-fetch strategy if exact pagination is not required.
5. Never expose unscoped count.

Example:

```text
DB predicate:
  tenant + agency + case type + non-confidential

Bulk decision:
  dynamic conflict-of-interest + temporary delegation + special case lock
```

---

## 24. Materialized Visibility Tables

For complex data-level authorization, compute visibility ahead of time.

Example:

```sql
CREATE TABLE case_visibility (
    tenant_id       VARCHAR(64) NOT NULL,
    case_id         BIGINT NOT NULL,
    subject_id      VARCHAR(64) NOT NULL,
    action          VARCHAR(64) NOT NULL,
    source          VARCHAR(64) NOT NULL,
    valid_from      TIMESTAMP NOT NULL,
    valid_until     TIMESTAMP NULL,
    policy_version  VARCHAR(64) NOT NULL,
    PRIMARY KEY (tenant_id, case_id, subject_id, action)
);
```

Query:

```sql
SELECT c.*
FROM cases c
JOIN case_visibility v
  ON v.tenant_id = c.tenant_id
 AND v.case_id = c.id
WHERE v.subject_id = :userId
  AND v.action = 'case.read'
  AND v.valid_from <= CURRENT_TIMESTAMP
  AND (v.valid_until IS NULL OR v.valid_until > CURRENT_TIMESTAMP)
  AND c.status = :status
ORDER BY c.created_at DESC
LIMIT :limit OFFSET :offset;
```

### 24.1 When materialized visibility helps

1. Complex relationship graph.
2. Large search/list operations.
3. Stable visibility with high read volume.
4. Need fast count/aggregation.
5. Need permission review/reporting.

### 24.2 Costs

1. Huge table size.
2. Recompute on role/assignment/org changes.
3. Eventual consistency.
4. Revocation delay.
5. Complex audit.
6. Policy version migration.

### 24.3 Invalidating visibility

Visibility must be recomputed when:

1. user role changes,
2. user department changes,
3. case assignment changes,
4. case state changes,
5. case confidentiality changes,
6. org hierarchy changes,
7. delegation starts/ends,
8. policy version changes.

---

## 25. Data-Level Authorization in Event-Driven Systems

Events can leak data too.

Example event:

```json
{
  "eventType": "CaseUpdated",
  "caseId": "CASE-1",
  "caseNo": "E-2026-0001",
  "respondentName": "...",
  "internalNote": "...",
  "riskScore": "HIGH"
}
```

Who can consume this?

### 25.1 Topic-level authorization is coarse

Kafka/Rabbit/JMS topic authorization answers:

```text
Can consumer group read topic case-events?
```

It does not answer:

```text
Can this consuming service/user see this specific case payload?
```

### 25.2 Event payload minimization

Prefer minimal event:

```json
{
  "eventType": "CaseUpdated",
  "caseId": "CASE-1",
  "occurredAt": "2026-06-19T10:15:00Z",
  "changedFields": ["status"]
}
```

Consumer that needs detail must fetch via authorized API/query.

### 25.3 Audience-specific event

For sensitive systems, use separate event types or topics:

```text
case-public-events
case-internal-events
case-legal-events
case-audit-events
```

But do not overdo this until topology becomes unmanageable.

### 25.4 Event projection authorization

Read models built from events must preserve authorization attributes:

```text
case_search_index must include tenant_id/agency_id/confidential/visibility fields.
```

---

## 26. Data-Level Authorization in Background Jobs

Background jobs often run as system identity.

That is dangerous if job output is for a human user.

### 26.1 Distinguish job identity and beneficiary subject

```text
Executor identity:
  system/export-worker

Beneficiary subject:
  user-123 who requested export
```

Authorization should usually be based on beneficiary subject, not executor.

```java
public void executeExport(ExportJob job) {
    CurrentUser beneficiary = userDirectory.load(job.requestedBy());
    AuthorizationContext context = AuthorizationContext.forBackgroundJob(job.id());

    CaseReadScope scope = scopeService.scopeForCaseExport(beneficiary, context);
    exportRepository.streamCases(job.request(), scope, rowWriter);
}
```

### 26.2 Scheduled job with distribution list

Each recipient may need separate scope.

Bad:

```text
Generate one report as admin and send to all recipients.
```

Better:

```text
For each recipient, compute recipient-specific report or verify all recipients share same authorized scope.
```

---

## 27. Soft Delete, Lifecycle State, and Data Visibility

Soft delete is not only data retention. It affects authorization.

### 27.1 Common state flags

```text
DRAFT
SUBMITTED
IN_REVIEW
APPROVED
REJECTED
WITHDRAWN
ARCHIVED
DELETED
SEALED
CONFIDENTIAL
LEGAL_HOLD
```

### 27.2 State visibility matrix

| State | Creator | Assigned Officer | Supervisor | Agency Admin | External User |
|---|---:|---:|---:|---:|---:|
| Draft | Yes | No | Maybe | Maybe | Owner only |
| Submitted | Yes | Yes | Yes | Yes | Owner only |
| In Review | Maybe | Yes | Yes | Yes | Limited |
| Approved | Yes | Yes | Yes | Yes | Yes/limited |
| Withdrawn | Yes | Yes | Yes | Yes | Maybe |
| Archived | Maybe | Maybe | Yes | Yes | No |
| Sealed | No | Special | Special | Special | No |

This matrix should become query scope.

```java
scope.allowedStatuses()
```

not ad-hoc UI filtering.

---

## 28. Multi-Tenant Query Scoping

### 28.1 Mandatory tenant predicate

For multi-tenant systems, every tenant-owned table query should include:

```sql
WHERE tenant_id = :tenantId
```

But this is not enough.

Tenant may contain:

1. agencies,
2. departments,
3. teams,
4. case types,
5. projects,
6. assignments,
7. confidentiality domains.

### 28.2 Tenant ID source

Never use tenant from request body/query param unless explicitly validated.

Bad:

```java
TenantId tenantId = new TenantId(request.getTenantId());
```

Better:

```java
TenantId tenantId = currentSecurityContext.requiredTenantId();
```

Or if admin can switch tenant:

```java
TenantId requestedTenant = request.getTenantId();
PolicyDecision decision = tenantAuthorization.canActInTenant(user, requestedTenant, context);
if (decision.isDenied()) throw AccessDeniedException.from(decision);
```

### 28.3 Tenant-aware repository contract

Avoid repository methods without scope.

Bad:

```java
Optional<CaseEntity> findById(Long id);
```

Better:

```java
Optional<CaseEntity> findByIdAndTenantId(Long id, String tenantId);
```

Better still:

```java
Optional<CaseEntity> findOne(CaseId id, CaseReadScope scope);
```

---

## 29. Authorized Query Contract

For each data operation, define a contract.

Example:

```text
Operation: Search cases
Permission required: case.search
Row scope:
  - tenant = current tenant
  - agency = current user's agency unless cross-agency role
  - case type in role-bound allowed types
  - status in visible states
  - if assignedOnly then active assignment exists
  - confidential excluded unless clearance
Projection:
  - summary fields only
  - no internal note
  - no legal advice
Count:
  - scoped by same predicate
Export:
  - requires case.export
  - max rows enforced
  - recompute authorization at execution
Audit:
  - log subject, scope fingerprint, request filter, result count, policy version
```

This should exist as engineering documentation, test input, and review checklist.

---

## 30. Avoiding Authorization Predicate Drift

Predicate drift happens when different parts of system implement slightly different authorization logic.

Example:

```text
UI list excludes confidential.
Export includes confidential.
Count includes archived.
Search index excludes archived but includes sealed.
Dashboard counts all agencies.
```

### 30.1 Centralize scope derivation

```java
CaseReadScope scope = caseScopeService.scopeForSearch(user, context);
```

Do not compute scope separately in controller, repository, mapper, and export worker.

### 30.2 Reuse query predicate builders

```java
CaseAuthorizationPredicateBuilder.apply(scope, root, query, cb)
```

### 30.3 Golden tests

Same request/scope should produce consistent results across:

1. list,
2. count,
3. export,
4. report,
5. search,
6. dashboard.

---

## 31. Testing Data-Level Authorization

### 31.1 Test matrix

Create fixtures:

```text
Tenant A
  Agency A1
    User officer-a1
    Case visible-a1
    Case confidential-a1
    Case assigned-a1
    Case unassigned-a1
  Agency A2
    Case visible-a2
Tenant B
  Agency B1
    Case visible-b1
```

Test:

```text
officer-a1 search cases
  sees visible-a1
  sees assigned-a1 if assignedOnly rule allows
  does not see visible-a2
  does not see visible-b1
  does not see confidential-a1 without clearance
```

### 31.2 Count test

Assert count equals visible rows only.

```java
assertThat(page.getTotalElements()).isEqualTo(2);
```

Not global count.

### 31.3 Pagination test

Insert unauthorized rows before authorized rows in sort order.

```text
newest rows = unauthorized
older rows = authorized
```

If filter-after-fetch exists, page returns empty/partial.

Correct query returns authorized rows.

### 31.4 Export test

Assert export contains same authorized universe as list, subject to export-specific rules.

### 31.5 Search index test

Assert search total hits and facets are scoped.

### 31.6 Cache isolation test

1. User A searches.
2. User B searches same business filter.
3. Assert B does not receive A's result.

### 31.7 Mutation test idea

Remove authorization predicate and ensure tests fail.

Examples:

1. remove tenant predicate,
2. remove agency predicate,
3. remove confidential predicate,
4. remove assignment `EXISTS`,
5. remove status visibility predicate.

If tests still pass, coverage is inadequate.

---

## 32. Observability and Audit for Data-Level Authorization

Audit should not log every returned row for every list, but it should log enough to reconstruct intent and boundary.

### 32.1 Query audit event

```json
{
  "eventType": "AUTHORIZED_QUERY_EXECUTED",
  "subjectId": "user-123",
  "tenantId": "tenant-a",
  "operation": "case.search",
  "scopeFingerprint": "sha256:...",
  "policyVersion": "case-policy-v12",
  "businessFilterFingerprint": "sha256:...",
  "resultCount": 25,
  "totalCount": 240,
  "decision": "ALLOW_SCOPED",
  "correlationId": "...",
  "occurredAt": "2026-06-19T10:15:30Z"
}
```

### 32.2 Do not log sensitive predicate values carelessly

Search keywords may contain PII.

Prefer fingerprint or redacted values.

### 32.3 Metrics

Useful metrics:

```text
authorization.query.scope.created.count
authorization.query.denied.count
authorization.query.result.count
authorization.query.scope.cache.hit
authorization.query.scope.cache.miss
authorization.query.export.requested
authorization.query.export.denied
authorization.query.rls.context.missing
authorization.query.predicate.missing.detected
```

### 32.4 Detect suspicious patterns

1. User searches many IDs sequentially.
2. User repeatedly gets zero results across tenants.
3. User requests high-volume exports.
4. User probes predictable identifiers.
5. User changes filters to infer hidden records.

---

## 33. Java Version Considerations: Java 8–25

### 33.1 Java 8

Use:

- immutable classes,
- `Optional` carefully,
- `Collections.unmodifiableSet`,
- explicit value objects,
- no records/sealed types,
- no pattern matching.

### 33.2 Java 11

No major authorization-specific language change, but long-term runtime baseline in many enterprises.

### 33.3 Java 17

Useful for:

- records for scope/decision objects,
- sealed classes for decision outcomes,
- stronger switch expressions,
- better runtime baseline for Spring Boot 3.

Example:

```java
public sealed interface QueryScope permits CaseReadScope, DocumentReadScope {
    TenantId tenantId();
}
```

### 33.4 Java 21

Useful for:

- virtual threads for IO-heavy policy/scope/attribute loading,
- structured concurrency if using preview/incubator carefully,
- pattern matching improvements,
- better performance/runtime ergonomics.

Caution:

```text
Virtual threads do not fix authorization design.
They only reduce blocking cost.
```

### 33.5 Java 25

By Java 25, modern Java style can make scope/decision modeling cleaner, but the core invariant remains:

```text
Authorized data scope must be explicit and consistently applied.
```

Do not couple authorization correctness to a specific Java version.

---

## 34. Practical Design Templates

### 34.1 Query service template

```java
@Transactional(readOnly = true)
public Page<ResultDto> query(CurrentUser user, Request request, Pageable pageable) {
    AuthorizationContext context = authorizationContextFactory.fromCurrentRequest();

    PermissionDecision functionDecision = permissionService.check(
            user,
            Permission.of("resource.search"),
            context
    );

    if (functionDecision.isDenied()) {
        throw AccessDeniedException.from(functionDecision);
    }

    ResourceReadScope scope = scopeService.scopeForSearch(user, context);

    Page<ResultRow> rows = queryRepository.search(request, scope, pageable);

    return rows.map(row -> projectionMapper.toDto(row, projectionPolicyFor(user, context)));
}
```

### 34.2 Repository method template

```java
Page<ResultRow> search(SearchRequest request, ResourceReadScope scope, Pageable pageable);
long count(SearchRequest request, ResourceReadScope scope);
Stream<ResultRow> streamForExport(SearchRequest request, ResourceReadScope scope);
```

### 34.3 Forbidden repository method pattern

Avoid:

```java
List<Entity> findAll();
Page<Entity> search(SearchRequest request);
long count(SearchRequest request);
Stream<Entity> export(SearchRequest request);
```

Unless they are clearly internal, package-private, and guarded.

---

## 35. Production Checklist

Before approving a data-returning feature, verify:

### 35.1 Function-level

- [ ] Endpoint/action permission exists.
- [ ] Permission name is clear.
- [ ] Permission is not just `ADMIN` shortcut.

### 35.2 Row-level

- [ ] Query includes tenant boundary.
- [ ] Query includes organization/agency boundary.
- [ ] Query includes relationship/assignment boundary if required.
- [ ] Query includes lifecycle/status visibility.
- [ ] Query includes confidentiality/sealing rules.
- [ ] Query does not trust tenant/agency from request without validation.

### 35.3 Count/pagination

- [ ] Count query uses same authorization scope.
- [ ] Pagination works when unauthorized rows sort before authorized rows.
- [ ] Cursor does not leak sensitive internals.

### 35.4 Projection

- [ ] DTO does not expose unauthorized fields.
- [ ] Child relations have independent authorization if needed.
- [ ] Sensitive fields are masked/hidden/denied intentionally.

### 35.5 Search

- [ ] Search query includes authorization filter.
- [ ] Total hits are scoped.
- [ ] Facets/autocomplete/highlights are scoped.
- [ ] Index visibility attributes are updated correctly.

### 35.6 Export/report

- [ ] Export uses same or stricter scope.
- [ ] Export file download is authorized.
- [ ] Scheduled reports re-evaluate authorization.
- [ ] Report aggregation is scoped.
- [ ] Small-count leakage considered if relevant.

### 35.7 Cache

- [ ] Cache key includes tenant/user/scope/policy version where needed.
- [ ] Cache invalidation handles permission changes.
- [ ] Sensitive authorized result is not globally cached.

### 35.8 Audit/observability

- [ ] Scope fingerprint logged.
- [ ] Policy version logged.
- [ ] Export/report audited.
- [ ] Denials and unusual query patterns observable.

### 35.9 Tests

- [ ] Cross-tenant tests.
- [ ] Cross-agency tests.
- [ ] Assignment tests.
- [ ] Confidentiality tests.
- [ ] Count leakage tests.
- [ ] Pagination tests.
- [ ] Export tests.
- [ ] Search index tests.
- [ ] Cache isolation tests.

---

## 36. Top 1% Insight

The beginner asks:

```text
Is the endpoint protected?
```

The intermediate engineer asks:

```text
Is the service method protected?
```

The senior engineer asks:

```text
Is the object authorized?
```

The top-level engineer asks:

```text
What is the authorized data universe for this subject, action, resource type, and context?
Is that universe consistently applied to rows, fields, relationships, counts, pagination, search, aggregation, export, cache, reports, and background jobs?
Can we prove it with tests and reconstruct it with audit evidence?
```

Data-level authorization is not a minor implementation detail.
It is the difference between:

```text
A secure-looking application
```

and:

```text
A defensible authorization architecture.
```

---

## 37. References

- Spring Data JPA Reference — Specifications: https://docs.spring.io/spring-data/jpa/reference/jpa/specifications.html
- Hibernate ORM Documentation — Filtering Data: https://docs.hibernate.org/orm/4.1/manual/en-US/html/ch19.html
- PostgreSQL Documentation — Row Security Policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- OWASP API Security Top 10 2023 — API1 Broken Object Level Authorization: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP IDOR Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html
- Spring Security Reference — Authorization Architecture: https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html
- PostgreSQL Documentation — SET: https://www.postgresql.org/docs/current/sql-set.html

---

## 38. Status Seri

Selesai:

- Part 0 — Authorization Mental Model
- Part 1 — Authorization Vocabulary, Semantics, and Invariants
- Part 2 — Java Platform Authorization Primitives
- Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
- Part 4 — RBAC Done Properly
- Part 5 — Permission and Capability Modeling
- Part 6 — ABAC
- Part 7 — PBAC and Policy-as-Code
- Part 8 — ReBAC
- Part 9 — ACL and Domain Object Security
- Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
- Part 11 — IDOR, BOLA, and Object-Level Authorization
- Part 12 — Authorization in Layered Java Applications
- Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
- Part 14 — Spring Method Security: Service-Level Authorization
- Part 15 — Spring Domain Authorization Patterns
- Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization
- Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging
- Part 18 — Data-Level Authorization and Query Scoping

Belum selesai. Lanjut ke:

- Part 19 — Workflow, State Machine, and Case Management Authorization



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-017.md">⬅️ Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-019.md">Learn Java Authorization Modes and Patterns — Part 19 ➡️</a>
</div>

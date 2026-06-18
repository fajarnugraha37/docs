# Part 023 — Repository Patterns: DAO, Repository, Spring Data JPA, Jakarta Data

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-023.md`  
> Target pembaca: Java engineer yang sudah memahami Java, JDBC, JPA dasar, Hibernate, transaksi, query, mapping, locking, batching, caching, schema migration, dan ingin naik ke level desain persistence layer yang matang untuk sistem enterprise/production-grade.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **DAO**, **Repository**, **Spring Data JPA repository**, dan **Jakarta Data repository** secara konseptual maupun praktis.
2. Mendesain repository bukan sebagai “table wrapper”, tetapi sebagai **boundary data access yang sesuai dengan use case, aggregate, transaction, dan query model**.
3. Menentukan kapan repository sebaiknya mengembalikan entity, projection, DTO, page, stream, atau command result.
4. Menghindari generic repository anti-pattern yang membuat domain boundary kabur.
5. Memahami derived query, explicit query, specification, custom repository implementation, dan query object pattern.
6. Memahami posisi Jakarta Data sebagai standard repository abstraction di ekosistem Jakarta EE modern.
7. Menggunakan Spring Data JPA dengan sadar, bukan otomatis menaruh semua query dalam method name panjang.
8. Mendesain repository untuk sistem besar: case management, workflow, audit, regulatory review, assignment, search, reporting, dan integration outbox.
9. Menentukan boundary antara repository, service/application layer, domain model, transaction, database constraint, dan external integration.
10. Mengenali failure mode produksi yang sering muncul akibat repository design yang salah.

---

## 2. Mental Model Utama

Repository bukan sekadar object untuk “mengambil data dari database”.

Repository adalah **abstraction boundary** antara application/domain logic dengan persistence mechanism.

Namun abstraction yang baik tidak berarti menyembunyikan semua fakta database. Repository yang matang melakukan tiga hal sekaligus:

1. **Menyembunyikan detail teknis yang tidak perlu diketahui use case**  
   Contoh: apakah query memakai JPQL, Criteria API, native SQL, entity graph, atau projection.

2. **Mempertahankan semantic intent dari domain/use case**  
   Contoh: `findPendingCasesForOfficerReview()` lebih bermakna daripada `findByStatusAndAssignedOfficerIdAndDeletedFalseOrderBySubmittedAtAsc()` jika query itu adalah bagian dari policy assignment.

3. **Tidak berbohong tentang cost, consistency, dan transaction behavior**  
   Contoh: repository method yang terlihat sederhana tetapi memicu N+1 query, load 100.000 entity managed, atau melakukan bulk update tanpa version check adalah abstraction yang buruk.

Repository yang buruk menyembunyikan kompleksitas secara semu. Repository yang baik menyembunyikan detail implementasi sambil tetap menjaga correctness, performance, dan intent.

---

## 3. DAO vs Repository

### 3.1 DAO: Data Access Object

DAO biasanya berorientasi pada operasi teknis data access.

Contoh:

```java
public interface CaseDao {
    CaseEntity findById(Long id);
    void insert(CaseEntity entity);
    void update(CaseEntity entity);
    void delete(Long id);
    List<CaseEntity> findByStatus(String status);
}
```

Ciri umum DAO:

- fokus pada persistence operation,
- sering dekat dengan table/entity,
- method cenderung CRUD,
- bisa digunakan pada JDBC, MyBatis, JPA, stored procedure, atau native SQL,
- tidak selalu merepresentasikan domain aggregate.

DAO tidak salah. Untuk aplikasi dengan SQL-heavy, reporting-heavy, atau legacy integration, DAO bisa sangat tepat.

Masalah muncul ketika DAO dianggap sebagai domain abstraction padahal method-nya hanya table operation.

### 3.2 Repository

Repository dalam konteks Domain-Driven Design biasanya dipahami sebagai abstraction yang membuat aggregate terlihat seperti collection konseptual.

Contoh:

```java
public interface CaseRepository {
    Optional<Case> findByCaseNumber(CaseNumber caseNumber);
    void save(Case aggregate);
    boolean existsOpenCaseForApplicant(ApplicantId applicantId);
}
```

Ciri repository:

- berorientasi domain/aggregate,
- method menyatakan intent domain,
- menyembunyikan persistence mechanism,
- tidak harus expose semua operasi CRUD,
- tidak harus satu repository per table,
- tidak harus satu repository per entity kecil,
- tidak otomatis cocok untuk reporting query.

### 3.3 Perbedaan praktis

| Aspek | DAO | Repository |
|---|---|---|
| Orientasi | Data access teknis | Domain/use case/aggregate |
| Granularity | Table/entity/query | Aggregate boundary atau read model |
| Method | CRUD/query teknis | Intent-oriented |
| Cocok untuk | SQL-heavy, legacy, infrastructure | Domain/application boundary |
| Risiko | Terlalu database-centric | Terlalu abstrak dan menyembunyikan cost |

Dalam sistem enterprise nyata, DAO dan repository bisa coexist.

Contoh desain yang sehat:

```text
case-domain
  CaseRepository              // domain aggregate persistence

case-query
  CaseSearchRepository         // read model/search/projection
  CaseDashboardQueryDao        // reporting/dashboard SQL-heavy

case-infra-jpa
  JpaCaseRepository
  JpaCaseSearchRepository
  NativeCaseDashboardQueryDao
```

---

## 4. Repository Bukan Table Wrapper

Kesalahan klasik:

```java
interface ApplicationRepository extends JpaRepository<ApplicationEntity, Long> {}
interface CaseRepository extends JpaRepository<CaseEntity, Long> {}
interface OfficerRepository extends JpaRepository<OfficerEntity, Long> {}
interface AuditTrailRepository extends JpaRepository<AuditTrailEntity, Long> {}
interface DocumentRepository extends JpaRepository<DocumentEntity, Long> {}
```

Lalu semua service bebas memanggil semua repository tersebut.

Akibatnya:

- aggregate boundary hilang,
- transaction boundary menjadi ad hoc,
- invariant tersebar,
- service layer menjadi script besar,
- entity graph tidak terkontrol,
- query duplikat,
- authorization predicate tersebar,
- soft delete/tenant filter mudah lupa,
- update child entity bisa bypass parent invariant.

Repository yang baik tidak harus langsung expose `save()` untuk semua entity.

Misalnya `CaseNote`, `CaseAssignment`, dan `CaseDecision` mungkin tidak punya repository public sendiri. Mereka bisa dimanipulasi melalui `CaseRepository` atau application service yang menjaga invariant.

```java
public interface CaseRepository {
    Optional<CaseEntity> findForDecision(CaseId id);
    void save(CaseEntity caseEntity);
}
```

Application service:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseEntity caseEntity = caseRepository.findForDecision(command.caseId())
        .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

    caseEntity.approve(command.officerId(), command.reason());

    // Dirty checking persists changes.
    // Audit/outbox handled in same transaction.
}
```

Dalam desain ini, `approve()` bukan sekadar update status. Ia adalah state transition yang menjaga invariant.

---

## 5. Repository dan Aggregate Boundary

Repository idealnya berada di boundary aggregate.

Aggregate adalah cluster object yang harus konsisten sebagai satu unit.

Contoh aggregate `Case`:

```text
Case
 ├── CaseStatus
 ├── CaseAssignment
 ├── CaseNote
 ├── CaseDecision
 └── CaseDocumentReference
```

Mungkin semua tidak harus dimapping sebagai cascade child entity, tetapi secara domain mereka berada dalam boundary consistency yang sama.

Repository untuk aggregate:

```java
public interface CaseRepository {
    Optional<CaseEntity> findById(CaseId id);
    Optional<CaseEntity> findForUpdate(CaseId id);
    Optional<CaseEntity> findForDecision(CaseId id);
    boolean existsOpenCaseForApplicant(ApplicantId applicantId);
    void save(CaseEntity caseEntity);
}
```

Yang perlu diperhatikan:

1. Repository method `findForDecision()` bisa memakai fetch plan khusus.
2. Repository method `existsOpenCaseForApplicant()` bisa memakai query boolean ringan, bukan load entity.
3. Repository method `findForUpdate()` mungkin memakai optimistic/pessimistic lock.
4. Repository tidak perlu expose `findAll()` jika berbahaya.
5. Repository tidak perlu expose `delete()` jika deletion harus soft delete, archive, atau melalui workflow.

---

## 6. Command Repository vs Query Repository

Untuk sistem besar, satu repository sering terlalu banyak tanggung jawab.

Pisahkan mental model:

```text
Command side:
  - load aggregate untuk mutation
  - enforce invariant
  - participate in transaction
  - usually returns entity/aggregate

Query side:
  - search/list/dashboard/report
  - usually returns DTO/projection/read model
  - optimized for read use case
  - may use native SQL/view/materialized view
```

Contoh:

```java
public interface CaseRepository {
    Optional<CaseEntity> findForDecision(CaseId id);
    Optional<CaseEntity> findForAssignment(CaseId id);
    void save(CaseEntity caseEntity);
}
```

```java
public interface CaseSearchRepository {
    Page<CaseListItem> search(CaseSearchCriteria criteria, Pageable pageable);
    Optional<CaseDetailView> findDetailView(CaseId id, OfficerId viewerId);
}
```

```java
public interface CaseReportRepository {
    List<MonthlyCaseBacklogRow> findMonthlyBacklog(LocalDate from, LocalDate to);
}
```

Kenapa dipisah?

Karena command dan query punya kebutuhan berbeda:

| Aspek | Command Repository | Query Repository |
|---|---|---|
| Return type | Entity/aggregate | DTO/projection/report row |
| Fetching | aggregate-specific | use-case-specific |
| Transaction | read-write | read-only, sometimes outside main transaction |
| Correctness | invariant/state transition | authorization/filtering/consistency view |
| Optimization | lock/version/flush | index/projection/pagination |

Ini bukan harus CQRS penuh. Ini cukup “CQRS-light”: pisahkan model baca dan tulis ketika complexity menuntut.

---

## 7. Spring Data JPA Repository

Spring Data JPA menyediakan repository support untuk JPA. Ia dapat membuat implementation repository berdasarkan interface, method name, query annotation, specification, projection, paging, dan sorting.

Contoh sederhana:

```java
public interface CaseJpaRepository extends JpaRepository<CaseEntity, Long> {
    Optional<CaseEntity> findByCaseNumber(String caseNumber);

    Page<CaseEntity> findByStatus(CaseStatus status, Pageable pageable);
}
```

Spring Data JPA sangat produktif, tetapi mudah disalahgunakan.

### 7.1 Derived query method

Contoh:

```java
List<CaseEntity> findByStatusAndAssignedOfficerIdAndDeletedFalseOrderBySubmittedAtAsc(
    CaseStatus status,
    Long officerId
);
```

Kelebihan:

- cepat dibuat,
- type-safe pada property name sejauh compile/runtime validation mendukung,
- cocok untuk query sederhana.

Kekurangan:

- method name bisa menjadi terlalu panjang,
- intent domain kabur,
- query kompleks sulit dibaca,
- join/fetch/projection lebih terbatas,
- perubahan model bisa berdampak luas,
- raw query behavior kadang tidak terlihat oleh reviewer.

Gunakan derived query untuk query sederhana. Untuk query penting atau kompleks, gunakan nama domain yang jelas + `@Query`, specification, query object, atau custom implementation.

### 7.2 Explicit `@Query`

```java
public interface CaseJpaRepository extends JpaRepository<CaseEntity, Long> {

    @Query("""
        select c
        from CaseEntity c
        join fetch c.assignment a
        where c.id = :id
          and c.status in :allowedStatuses
        """)
    Optional<CaseEntity> findForDecision(
        @Param("id") Long id,
        @Param("allowedStatuses") Collection<CaseStatus> allowedStatuses
    );
}
```

Kelebihan:

- query explicit,
- intent lebih jelas,
- bisa mengontrol join/fetch/projection,
- lebih mudah review performance.

Risiko:

- string query tetap bisa rusak saat refactor,
- provider-specific behavior perlu dipahami,
- count query untuk pagination perlu diperiksa,
- fetch join + pagination bisa bermasalah.

### 7.3 Projection

Spring Data JPA mendukung projection interface/class/record untuk mengambil partial view.

Contoh:

```java
public interface CaseListItemProjection {
    Long getId();
    String getCaseNumber();
    CaseStatus getStatus();
    Instant getSubmittedAt();
}
```

Repository:

```java
Page<CaseListItemProjection> findByStatus(CaseStatus status, Pageable pageable);
```

Projection berguna untuk list/search/dashboard agar tidak load entity penuh.

Namun projection bukan pengganti domain model. Jangan melakukan mutation berdasarkan projection.

### 7.4 Specification

Spring Data JPA `Specification` membungkus JPA Criteria predicate agar reusable.

Contoh:

```java
public final class CaseSpecifications {

    public static Specification<CaseEntity> hasStatus(CaseStatus status) {
        return (root, query, cb) ->
            status == null ? cb.conjunction() : cb.equal(root.get("status"), status);
    }

    public static Specification<CaseEntity> submittedBetween(Instant from, Instant to) {
        return (root, query, cb) -> {
            if (from == null && to == null) {
                return cb.conjunction();
            }
            if (from != null && to != null) {
                return cb.between(root.get("submittedAt"), from, to);
            }
            if (from != null) {
                return cb.greaterThanOrEqualTo(root.get("submittedAt"), from);
            }
            return cb.lessThan(root.get("submittedAt"), to);
        };
    }
}
```

Usage:

```java
Specification<CaseEntity> spec = Specification
    .where(CaseSpecifications.hasStatus(criteria.status()))
    .and(CaseSpecifications.submittedBetween(criteria.from(), criteria.to()));
```

Specification cocok untuk dynamic filter yang kompleks tetapi masih entity-oriented.

Kelemahannya:

- mudah menjadi predicate soup,
- projection dan fetch plan tidak selalu elegant,
- count query bisa buruk,
- Criteria API verbose,
- domain intent bisa hilang jika semua hanya “spec kecil-kecil”.

---

## 8. Jakarta Data Repository

Jakarta Data adalah specification di Jakarta EE untuk menyederhanakan data access dengan repository interface. Tujuannya adalah menyediakan programming model data access yang familiar dan konsisten, sambil tetap mempertahankan karakteristik data store underlying.

Konsep dasarnya mirip repository abstraction:

```java
@Repository
public interface Cases extends BasicRepository<CaseEntity, Long> {

    Optional<CaseEntity> findByCaseNumber(String caseNumber);

    @Query("where status = :status order by submittedAt")
    List<CaseEntity> findPendingCases(CaseStatus status);
}
```

Catatan penting:

1. Jakarta Data bukan pengganti Jakarta Persistence sepenuhnya.
2. Jakarta Data dapat menggunakan entity yang dimapping dengan Jakarta Persistence.
3. Jakarta Data mendefinisikan repository abstraction, query method, dan query language subset/approach.
4. Provider dapat mendukung relational maupun non-relational store.
5. Hibernate Data Repositories adalah implementasi Jakarta Data yang backed by Hibernate ORM.

### 8.1 Perbedaan mental model Jakarta Persistence vs Jakarta Data

Jakarta Persistence/JPA berpusat pada:

- `EntityManager`,
- persistence context,
- entity lifecycle,
- JPQL/Criteria/native query,
- transaction-bound managed entity.

Jakarta Data berpusat pada:

- repository interface,
- data access method,
- query method,
- return type,
- provider-generated implementation.

Repository abstraction membuat data access lebih ringkas, tetapi tidak menghapus kebutuhan memahami transaction, query, lock, fetch, mapping, dan database behavior.

### 8.2 Jakarta Data cocok untuk apa?

Cocok untuk:

- CRUD sederhana,
- query repository standar,
- aplikasi Jakarta EE yang ingin standard repository abstraction,
- use case yang tidak butuh banyak provider-specific behavior,
- codebase yang ingin mengurangi boilerplate DAO.

Kurang cocok sebagai satu-satunya abstraction untuk:

- query reporting berat,
- workflow/state machine sangat kompleks,
- database-specific optimization,
- batch volume besar,
- multi-store integration yang punya semantics berbeda,
- use case yang butuh explicit persistence context control.

---

## 9. Generic Repository Anti-Pattern

Contoh generic repository yang sering terlihat:

```java
public interface GenericRepository<T, ID> {
    Optional<T> findById(ID id);
    List<T> findAll();
    T save(T entity);
    void deleteById(ID id);
}
```

Lalu semua entity punya repository:

```java
class GenericJpaRepository<T, ID> implements GenericRepository<T, ID> { ... }
```

Masalahnya bukan generic-nya. Masalahnya adalah ketika generic repository menjadi abstraction utama domain.

Risiko:

1. Semua entity terlihat punya lifecycle yang sama.
2. Semua entity terlihat boleh di-save langsung.
3. Aggregate boundary hilang.
4. Delete bisa bypass soft delete/audit/workflow.
5. `findAll()` bisa membunuh database.
6. Tidak ada domain intent.
7. Tidak ada fetch plan per use case.
8. Tidak ada authorization/tenant predicate default yang jelas.
9. Repository menjadi “CRUD vending machine”.

Generic base repository boleh dipakai untuk infrastructure internal, tetapi public application boundary sebaiknya tetap intent-oriented.

Contoh lebih baik:

```java
@NoRepositoryBean
public interface InternalJpaBaseRepository<T, ID> extends JpaRepository<T, ID> {
    // shared infrastructure only
}
```

Lalu public repository:

```java
public interface CaseRepository {
    Optional<CaseEntity> findForDecision(CaseId id);
    Optional<CaseEntity> findForAssignment(CaseId id);
    boolean existsOpenCaseForApplicant(ApplicantId applicantId);
}
```

---

## 10. Repository Return Type Design

Return type adalah bagian dari contract.

### 10.1 `Optional<Entity>`

Cocok untuk lookup by id/business key.

```java
Optional<CaseEntity> findByCaseNumber(String caseNumber);
```

Gunakan `Optional` untuk “mungkin tidak ada”. Jangan gunakan `null`.

### 10.2 `Entity`

Cocok jika tidak adanya data adalah exceptional dan method memang menjamin harus ada.

```java
CaseEntity getRequiredForDecision(CaseId id);
```

Namun hati-hati: repository sebaiknya tidak selalu throw domain exception jika exception butuh context use case. Kadang application service lebih tepat.

### 10.3 `List<T>`

Cocok untuk bounded result.

```java
List<CaseEntity> findRecentlySubmittedCases(int maxRows);
```

Jangan gunakan `List` untuk query yang tidak bounded.

### 10.4 `Page<T>`

Cocok jika user perlu total count.

```java
Page<CaseListItem> search(CaseSearchCriteria criteria, Pageable pageable);
```

Risiko: count query bisa mahal.

### 10.5 `Slice<T>`

Cocok jika hanya perlu “ada halaman berikutnya” tanpa total count.

```java
Slice<CaseListItem> findNextCases(CaseCursor cursor, Pageable pageable);
```

### 10.6 Cursor/keyset result

Cocok untuk high-volume listing.

```java
KeysetPage<CaseListItem> findAfter(CaseSearchCursor cursor, int limit);
```

### 10.7 `Stream<T>`

Cocok untuk streaming read, tetapi harus transaction/resource-safe.

```java
try (Stream<CaseEntity> stream = repository.streamForExport(criteria)) {
    stream.forEach(exporter::write);
}
```

Pastikan stream ditutup. Jangan return stream ke layer yang tidak mengerti transaction/resource boundary.

### 10.8 Projection/DTO

Cocok untuk read-only query.

```java
Optional<CaseDetailView> findDetailView(CaseId id, ViewerContext viewer);
```

### 10.9 Boolean/exists

Cocok untuk invariant check ringan.

```java
boolean existsOpenCaseForApplicant(ApplicantId applicantId);
```

Namun untuk concurrency correctness, `exists()` saja tidak cukup. Tetap butuh constraint/lock/conditional write bila race condition mungkin terjadi.

### 10.10 Count

Gunakan dengan hati-hati.

```java
long countPendingCases(OfficerId officerId);
```

Count pada table besar bisa mahal. Untuk dashboard, kadang perlu materialized view, summary table, approximate count, atau async aggregation.

---

## 11. Repository Method Naming

Nama method harus menyampaikan intent, bukan hanya struktur database.

Kurang baik:

```java
findByStatusAndAssignedOfficerIdAndDeletedFalseAndSubmittedAtLessThanOrderByPriorityDescSubmittedAtAsc(...)
```

Lebih baik:

```java
findReviewQueueForOfficer(OfficerId officerId, ReviewQueueCriteria criteria, Pageable pageable)
```

Kenapa?

Karena method pertama menjelaskan implementasi. Method kedua menjelaskan use case.

Namun jangan terlalu abstrak sampai cost-nya tersembunyi:

```java
findEverythingNeededForDashboard()
```

Nama seperti itu buruk karena tidak jelas scope, filter, ordering, cost, dan consistency expectation.

Nama baik biasanya menjawab:

1. Data untuk use case apa?
2. Batas result-nya apa?
3. Apakah untuk mutation atau read-only?
4. Apakah ada lock/fetch khusus?
5. Apakah authorization/tenant sudah diterapkan?

Contoh:

```java
findForDecision(CaseId id)
findForPessimisticAssignment(CaseId id)
searchVisibleCasesForOfficer(OfficerId officerId, CaseSearchCriteria criteria, Pageable pageable)
existsActiveAppealForCase(CaseId caseId)
findPendingOutboxEvents(int limit)
claimNextOutboxEvents(WorkerId workerId, int limit)
```

---

## 12. Repository dan Transaction Boundary

Repository biasanya tidak seharusnya menjadi pemilik transaction boundary utama.

Lebih umum:

```text
Controller / Message Listener / Scheduler
        ↓
Application Service  ← transaction boundary
        ↓
Repository
        ↓
EntityManager / DataSource / Database
```

Contoh:

```java
@Service
public class CaseDecisionService {

    private final CaseRepository caseRepository;
    private final OutboxRepository outboxRepository;

    @Transactional
    public void approve(ApproveCaseCommand command) {
        CaseEntity caseEntity = caseRepository.findForDecision(command.caseId())
            .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        caseEntity.approve(command.officerId(), command.reason());

        outboxRepository.append(CaseApprovedEvent.from(caseEntity));
    }
}
```

Repository ikut dalam transaction yang dibuka application service.

Jangan membuat setiap repository method selalu `@Transactional(REQUIRES_NEW)` kecuali memang ada alasan kuat. Itu bisa memecah atomicity dan menciptakan partial commit.

Repository-level `@Transactional(readOnly = true)` kadang dipakai untuk convenience, tetapi transaction semantics sebaiknya tetap dipahami dari use case boundary.

---

## 13. Repository dan Fetch Plan

Repository method yang return entity harus jelas fetch plan-nya.

Contoh buruk:

```java
Optional<CaseEntity> findById(Long id);
```

Lalu service berharap:

```java
caseEntity.getApplicant().getProfile().getAddress().getPostalCode();
caseEntity.getAssignments().size();
caseEntity.getDocuments().size();
```

Ini bisa memicu lazy loading tak terkontrol.

Lebih baik:

```java
Optional<CaseEntity> findForDecision(CaseId id);
Optional<CaseEntity> findForAssignment(CaseId id);
Optional<CaseDetailView> findDetailView(CaseId id, ViewerContext viewer);
```

Implementasi `findForDecision()` dapat memakai entity graph/fetch join/projection sesuai kebutuhan.

Spring Data JPA example:

```java
@EntityGraph(attributePaths = {
    "applicant",
    "assignment",
    "currentReview"
})
Optional<CaseEntity> findForDecisionById(Long id);
```

Tetapi hati-hati dengan entity graph terlalu besar. Fetch plan besar tidak selalu lebih baik. Ia bisa menciptakan cartesian explosion atau over-fetching.

---

## 14. Repository dan Authorization/Tenant Predicate

Dalam sistem multi-tenant/regulatory, repository tidak boleh melupakan visibility rule.

Buruk:

```java
Optional<CaseEntity> findById(Long id);
```

Lalu authorization dilakukan setelah entity loaded:

```java
CaseEntity c = repository.findById(id).orElseThrow();
if (!authz.canView(user, c)) throw new ForbiddenException();
```

Ini kadang acceptable untuk single lookup jika data leakage via timing/logging bukan isu besar. Tetapi untuk search/list, authorization harus masuk query.

Lebih baik:

```java
Optional<CaseDetailView> findVisibleDetail(CaseId id, ViewerContext viewer);

Page<CaseListItem> searchVisibleCases(
    ViewerContext viewer,
    CaseSearchCriteria criteria,
    Pageable pageable
);
```

Authorization predicate harus konsisten.

Untuk multi-tenant:

```java
where c.tenant_id = :tenantId
```

Untuk role/officer visibility:

```java
where c.tenant_id = :tenantId
  and (
       c.assigned_officer_id = :officerId
       or exists (... role/team visibility ...)
  )
```

Jangan mengandalkan “developer pasti ingat filter tenant” pada semua query manual. Buat abstraction, helper, specification, database row-level security, atau repository method yang sudah tenant-aware.

---

## 15. Custom Repository Implementation

Spring Data JPA memungkinkan custom fragment/implementation.

Interface domain-facing:

```java
public interface CaseSearchRepository {
    Page<CaseListItem> searchVisibleCases(
        ViewerContext viewer,
        CaseSearchCriteria criteria,
        Pageable pageable
    );
}
```

Implementation:

```java
@Repository
class JpaCaseSearchRepository implements CaseSearchRepository {

    @PersistenceContext
    private EntityManager entityManager;

    @Override
    public Page<CaseListItem> searchVisibleCases(
        ViewerContext viewer,
        CaseSearchCriteria criteria,
        Pageable pageable
    ) {
        // Build Criteria API / JPQL / native SQL intentionally.
        // Apply tenant, authorization, filter, sort whitelist, pagination.
        throw new UnsupportedOperationException("example");
    }
}
```

Custom implementation cocok ketika:

- query kompleks,
- dynamic filtering berat,
- projection perlu dikontrol,
- native SQL diperlukan,
- authorization predicate kompleks,
- count query harus custom,
- keyset pagination diperlukan,
- query perlu hint/timeout/comment.

Jangan memaksakan derived query method untuk semua hal.

---

## 16. Query Object Pattern

Query object membuat query menjadi object eksplisit.

```java
public record CaseSearchQuery(
    TenantId tenantId,
    ViewerId viewerId,
    Set<CaseStatus> statuses,
    LocalDate submittedFrom,
    LocalDate submittedTo,
    String applicantName,
    PageRequest pageRequest,
    SortOption sort
) {}
```

Repository:

```java
public interface CaseSearchRepository {
    Page<CaseListItem> search(CaseSearchQuery query);
}
```

Keuntungan:

- parameter tidak meledak,
- validasi query bisa terpusat,
- authorization/tenant context explicit,
- sort whitelist bisa dikontrol,
- mudah dites,
- mudah di-log sebagai structured metadata,
- memisahkan API request DTO dari persistence query contract.

Query object sangat berguna untuk sistem listing/search besar.

---

## 17. Repository untuk State Machine

Workflow/state machine butuh repository yang mendukung atomic transition.

Contoh entity method:

```java
public void submit(UserId actor, Instant now) {
    if (status != CaseStatus.DRAFT) {
        throw new InvalidTransitionException(status, CaseStatus.SUBMITTED);
    }
    this.status = CaseStatus.SUBMITTED;
    this.submittedAt = now;
    this.lastModifiedBy = actor;
}
```

Repository:

```java
Optional<CaseEntity> findForSubmission(CaseId id);
```

Untuk high-contention transition, bisa gunakan conditional update:

```java
@Modifying
@Query("""
    update CaseEntity c
       set c.status = :newStatus,
           c.version = c.version + 1,
           c.updatedAt = :now
     where c.id = :id
       and c.status = :expectedStatus
       and c.version = :expectedVersion
    """)
int transitionIfCurrent(
    Long id,
    CaseStatus expectedStatus,
    CaseStatus newStatus,
    long expectedVersion,
    Instant now
);
```

Return `int` adalah signal:

- `1`: transition berhasil,
- `0`: stale version, invalid state, atau record tidak ditemukan.

Repository untuk state machine tidak boleh hanya `save(entity)` tanpa version/state guard jika concurrency penting.

---

## 18. Repository untuk Outbox/Inbox

Outbox repository biasanya bukan domain aggregate repository biasa. Ia adalah integration persistence boundary.

```java
public interface OutboxRepository {
    void append(OutboxEvent event);
    List<OutboxEvent> claimNextBatch(WorkerId workerId, int limit);
    void markPublished(EventId eventId, Instant publishedAt);
    void markFailed(EventId eventId, String reason, Instant failedAt);
}
```

Ciri outbox repository:

- butuh idempotency,
- butuh status transition,
- sering butuh pessimistic locking/skip locked,
- sering butuh retry count,
- perlu index yang tepat,
- tidak cocok sebagai generic `JpaRepository<OutboxEvent, UUID>` saja.

Inbox repository:

```java
public interface InboxRepository {
    boolean alreadyProcessed(MessageId messageId, ConsumerName consumerName);
    void markProcessed(MessageId messageId, ConsumerName consumerName, Instant processedAt);
}
```

Untuk idempotency, database unique constraint biasanya lebih kuat daripada check-then-insert application logic.

---

## 19. Repository untuk Audit Trail

Audit repository punya karakteristik berbeda:

- append-only,
- volume besar,
- query by entity id/module/date/actor,
- jarang update,
- sering perlu partition/archive,
- perlu masking/security,
- tidak boleh mudah dihapus.

Contoh:

```java
public interface AuditTrailRepository {
    void append(AuditEntry entry);
    Page<AuditTimelineRow> findTimeline(AuditTimelineQuery query);
}
```

Jangan expose:

```java
void deleteById(Long id);
AuditEntry save(AuditEntry entry);
```

Karena audit trail bukan entity biasa. Ia adalah evidence log.

---

## 20. Repository untuk Reporting

Reporting query sering tidak cocok dengan aggregate repository.

Contoh buruk:

```java
List<CaseEntity> findAllBySubmittedAtBetween(...);
```

Lalu aplikasi menghitung grouping di memory.

Lebih baik:

```java
List<MonthlyCaseBacklogRow> findMonthlyBacklog(LocalDate from, LocalDate to);
```

Implementation bisa native SQL:

```sql
select
    trunc(submitted_at, 'MM') as month,
    status,
    count(*) as total
from cases
where submitted_at >= ?
  and submitted_at < ?
group by trunc(submitted_at, 'MM'), status
order by month, status
```

Repository reporting boleh database-specific jika memang itu cost yang benar.

Jangan memaksa ORM entity loading untuk report agregasi besar.

---

## 21. Repository dan Sorting/Pagination Safety

Repository search harus menjaga sorting.

Jangan langsung percaya sort field dari request:

```java
sort=someInternalColumn desc
```

Gunakan whitelist:

```java
public enum CaseSortOption {
    SUBMITTED_AT,
    PRIORITY,
    CASE_NUMBER,
    LAST_UPDATED_AT
}
```

Mapping:

```java
private String toOrderBy(CaseSortOption sort) {
    return switch (sort) {
        case SUBMITTED_AT -> "c.submittedAt";
        case PRIORITY -> "c.priority";
        case CASE_NUMBER -> "c.caseNumber";
        case LAST_UPDATED_AT -> "c.updatedAt";
    };
}
```

Pagination:

- offset pagination cocok untuk UI kecil-menengah,
- keyset pagination cocok untuk data besar/stable ordering,
- count query harus diperiksa,
- sort harus deterministic,
- tambahkan tie-breaker seperti `id`.

Contoh deterministic ordering:

```sql
order by submitted_at desc, id desc
```

---

## 22. Repository dan Soft Delete

Soft delete membuat repository lebih kompleks.

Jika entity punya `deleted_at`, maka semua query biasa harus exclude deleted row.

Risiko:

```java
findById(id)
```

mengembalikan deleted entity.

Solusi:

- method eksplisit: `findActiveById`,
- global filter/provider-specific filter,
- database view untuk active records,
- repository base yang meng-enforce predicate,
- partial unique index untuk active rows jika database mendukung.

Namun jangan sembunyikan terlalu jauh. Admin/audit use case mungkin perlu melihat deleted row.

Method harus jelas:

```java
Optional<CaseEntity> findActiveById(CaseId id);
Optional<CaseEntity> findIncludingDeletedById(CaseId id);
```

---

## 23. Repository dan Multi-Tenancy

Multi-tenant repository harus menjadikan tenant sebagai bagian dari contract.

Buruk:

```java
Optional<CaseEntity> findById(Long id);
```

Lebih baik:

```java
Optional<CaseEntity> findByTenantIdAndId(TenantId tenantId, CaseId id);
```

Atau jika tenant diambil dari context, tetap pastikan context propagation dan testing kuat.

Untuk query manual, tenant predicate harus selalu ada.

```java
where c.tenantId = :tenantId
```

Untuk unique constraint:

```sql
unique (tenant_id, case_number)
```

Untuk cache key:

```text
tenant:{tenantId}:case:{caseId}
```

Repository yang tidak tenant-aware adalah data leakage risk.

---

## 24. Repository dan Error Handling

Repository boleh melempar persistence exception, tetapi application layer harus mengklasifikasikan error.

Contoh error:

- duplicate key,
- foreign key violation,
- optimistic lock exception,
- pessimistic lock timeout,
- deadlock,
- connection timeout,
- query timeout,
- no result,
- non-unique result,
- data truncation.

Jangan semua error menjadi `RuntimeException` generic.

Mapping contoh:

```text
Unique constraint violation -> 409 Conflict / domain duplicate error
Optimistic lock exception   -> 409 Conflict / stale command
Lock timeout/deadlock       -> retry if idempotent, else 503/409 depending use case
Data truncation             -> 400 if input error, 500 if mapping/schema bug
SQL grammar                 -> 500 deployment bug
Connection exhausted        -> 503/system incident
```

Repository method sebaiknya punya semantic yang membuat mapping error lebih mudah.

Contoh:

```java
boolean existsActiveAppealForCase(CaseId caseId);
```

Tetapi create tetap harus mengandalkan unique constraint:

```sql
unique(case_id) where status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW')
```

---

## 25. Repository dan Testing

Repository harus dites dengan database nyata atau containerized database untuk query penting.

Mock repository hanya membuktikan service memanggil method, bukan query benar.

Test yang penting:

1. Query return row yang benar.
2. Tenant/authorization predicate benar.
3. Soft delete predicate benar.
4. Projection field mapping benar.
5. Pagination deterministic.
6. Count query benar.
7. Sorting whitelist benar.
8. Locking behavior benar.
9. Optimistic locking conflict benar.
10. Constraint violation ditangani benar.
11. Fetch plan tidak N+1 pada use case panas.
12. Native SQL kompatibel dengan database production.

Contoh test intent:

```java
@Test
void searchVisibleCases_doesNotReturnCasesFromOtherTenant() {
    // given two tenants and cases
    // when tenant A searches
    // then tenant B cases are not returned
}
```

Repository test bukan hanya “method bisa jalan”. Repository test membuktikan data boundary benar.

---

## 26. Design Pattern: Port + Adapter

Untuk aplikasi yang ingin menjaga domain tidak tergantung Spring Data/JPA langsung:

```java
// domain/application port
public interface CaseRepository {
    Optional<Case> findForDecision(CaseId id);
    void save(Case aggregate);
}
```

Infrastructure adapter:

```java
@Repository
class JpaCaseRepositoryAdapter implements CaseRepository {

    private final SpringDataCaseJpaRepository delegate;
    private final CaseMapper mapper;

    @Override
    public Optional<Case> findForDecision(CaseId id) {
        return delegate.findForDecisionById(id.value())
            .map(mapper::toDomain);
    }

    @Override
    public void save(Case aggregate) {
        delegate.save(mapper.toEntity(aggregate));
    }
}
```

Trade-off:

- domain lebih bersih,
- mapping cost bertambah,
- persistence context behavior lebih jauh dari domain,
- bisa menghindari entity leak,
- cocok jika domain model berbeda dari persistence model.

Tidak semua aplikasi perlu layer mapper tebal. Pilih berdasarkan complexity, bukan dogma.

---

## 27. Kapan Entity Boleh Langsung Dipakai Repository?

Entity boleh menjadi domain model jika:

- domain tidak terlalu kompleks,
- aggregate boundary sesuai mapping JPA,
- entity behavior tidak terganggu proxy/lazy loading,
- serialization tidak langsung expose entity,
- persistence annotation tidak mencemari logic berlebihan,
- team paham lifecycle managed/detached,
- tests menutup invariant penting.

Entity sebaiknya dipisah dari domain model jika:

- domain sangat kompleks,
- aggregate tidak cocok dengan relational shape,
- persistence concern mengganggu invariant,
- perlu support multiple persistence store,
- API model sering berubah,
- entity banyak field teknis/audit/filter,
- lazy loading membuat domain behavior tidak predictable.

Tidak ada jawaban universal. Yang penting: boundary jelas dan trade-off disadari.

---

## 28. Repository Review Checklist

Gunakan checklist berikut saat review repository di codebase enterprise.

### 28.1 Intent

- Apakah nama method menyampaikan use case?
- Apakah method terlalu table-centric?
- Apakah method terlalu generik?
- Apakah ada method `findAll()` yang tidak bounded?

### 28.2 Boundary

- Apakah repository merepresentasikan aggregate/read model yang tepat?
- Apakah child entity bisa diubah bypass parent invariant?
- Apakah delete/save exposed secara aman?

### 28.3 Transaction

- Apakah transaction boundary jelas di application service?
- Apakah repository memakai `REQUIRES_NEW` tanpa alasan kuat?
- Apakah external side effect terjadi di dalam transaction?

### 28.4 Query correctness

- Apakah tenant predicate selalu ada?
- Apakah authorization predicate diterapkan di query untuk listing/search?
- Apakah soft delete predicate konsisten?
- Apakah sorting whitelist?
- Apakah pagination deterministic?

### 28.5 Performance

- Apakah return type entity/projection sudah tepat?
- Apakah query raw count mahal?
- Apakah fetch plan jelas?
- Apakah N+1 diuji?
- Apakah query punya index yang sesuai?
- Apakah result bounded?

### 28.6 Concurrency

- Apakah update butuh `@Version`?
- Apakah state transition atomic?
- Apakah `exists()` check dilindungi constraint?
- Apakah deadlock/retry dipikirkan?

### 28.7 Error handling

- Apakah duplicate/lock/stale/timeout diklasifikasikan?
- Apakah repository error bisa dipetakan ke domain/API error?
- Apakah constraint name stabil untuk mapping error?

### 28.8 Operability

- Apakah query penting punya observability?
- Apakah slow query bisa dilacak ke repository method?
- Apakah query comment/tag digunakan untuk hot path?
- Apakah metrics tersedia untuk search/batch/outbox?

---

## 29. Anti-Pattern Umum

### 29.1 Semua entity punya public repository

Gejala:

```java
CaseNoteRepository.save(note);
CaseAssignmentRepository.save(assignment);
CaseStatusHistoryRepository.save(history);
```

Risiko: invariant aggregate bypass.

### 29.2 Repository method name terlalu panjang

Gejala:

```java
findByAAndBAndCAndDAndEAndFOrderByGDescHAsc(...)
```

Solusi: query object/custom repository.

### 29.3 Repository return entity untuk semua read

Risiko:

- over-fetching,
- dirty checking overhead,
- accidental update,
- JSON lazy loading,
- persistence context bloat.

Solusi: projection/read model.

### 29.4 `findAll()` di table besar

Solusi: bounded query, pagination, streaming, export job.

### 29.5 `save()` sebagai update semua hal

Risiko: stale overwrite, mass assignment, detached merge bug.

Solusi: load aggregate, call domain method, dirty checking, version check, command-specific update.

### 29.6 Native SQL tersebar tanpa ownership

Solusi: dedicated query repository/DAO, naming, tests, review, schema contract.

### 29.7 Repository menyembunyikan external side effect

Buruk:

```java
caseRepository.saveAndPublishEvent(caseEntity);
```

Lebih baik: service orchestrates transaction + outbox.

### 29.8 Repository terlalu abstrak

Buruk:

```java
DataAccessService.execute(QueryRequest request)
```

Jika abstraction terlalu generic, domain intent hilang dan safety rendah.

---

## 30. Production Failure Modes

### 30.1 N+1 dari repository list method

Method:

```java
List<CaseEntity> findByStatus(CaseStatus status);
```

Service:

```java
for (CaseEntity c : cases) {
    c.getApplicant().getName();
    c.getAssignment().getOfficer().getName();
}
```

Akibat:

- query count meledak,
- latency naik,
- connection pool penuh.

Solusi:

- projection,
- fetch join/entity graph,
- batch fetching,
- repository method khusus list view.

### 30.2 Authorization leak di search query

Search repository lupa `tenant_id` atau role predicate.

Akibat:

- data leakage,
- regulatory incident,
- audit finding.

Solusi:

- tenant-aware repository contract,
- shared predicate builder,
- database RLS jika sesuai,
- tests leakage.

### 30.3 `merge()` overwrite stale data

API menerima entity/DTO penuh lalu merge.

Akibat:

- field lama menimpa field baru,
- concurrent update hilang,
- audit misleading.

Solusi:

- command DTO,
- load managed entity,
- apply changes explicitly,
- `@Version`,
- conflict handling.

### 30.4 Derived query salah karena model berubah

Property rename/relationship change membuat method query gagal saat startup atau runtime.

Solusi:

- repository tests,
- explicit query untuk query penting,
- code review query plan.

### 30.5 Count query terlalu mahal

`Page<T>` menghasilkan count query yang scan table besar.

Solusi:

- `Slice<T>`,
- keyset pagination,
- approximate/summary count,
- custom count query,
- materialized view.

### 30.6 Outbox duplicate publish

Outbox repository tidak punya idempotency/claiming yang benar.

Akibat:

- duplicate event,
- inconsistent downstream,
- retry storm.

Solusi:

- claim with lock/skip locked,
- idempotent consumer,
- unique event id,
- state transition guarded.

---

## 31. Example: Case Management Repository Design

### 31.1 Command repositories

```java
public interface CaseRepository {
    Optional<CaseEntity> findForSubmission(CaseId id);
    Optional<CaseEntity> findForDecision(CaseId id);
    Optional<CaseEntity> findForAssignment(CaseId id);
    boolean existsOpenCaseForApplicant(ApplicantId applicantId);
}
```

```java
public interface AppealRepository {
    Optional<AppealEntity> findForSubmission(AppealId id);
    boolean existsActiveAppealForCase(CaseId caseId);
}
```

### 31.2 Query repositories

```java
public interface CaseSearchRepository {
    Page<CaseListItem> searchVisibleCases(
        ViewerContext viewer,
        CaseSearchCriteria criteria,
        Pageable pageable
    );

    Optional<CaseDetailView> findVisibleDetail(
        ViewerContext viewer,
        CaseId caseId
    );
}
```

### 31.3 Reporting repositories

```java
public interface CaseReportRepository {
    List<CaseBacklogByStatusRow> findBacklogByStatus(ReportPeriod period);
    List<OfficerWorkloadRow> findOfficerWorkload(ReportPeriod period);
}
```

### 31.4 Integration repositories

```java
public interface OutboxRepository {
    void append(DomainEvent event);
    List<OutboxEvent> claimNextBatch(WorkerId workerId, int limit);
    void markPublished(EventId eventId, Instant publishedAt);
}
```

### 31.5 Audit repositories

```java
public interface AuditTrailRepository {
    void append(AuditEntry entry);
    Page<AuditTimelineRow> findTimeline(AuditTimelineQuery query);
}
```

Dengan struktur ini, repository tidak lagi satu-per-table. Repository mengikuti responsibility.

---

## 32. Latihan

### Latihan 1 — Refactor generic repository

Diberikan codebase dengan repository berikut:

```java
interface GenericRepository<T, ID> {
    T save(T entity);
    Optional<T> findById(ID id);
    List<T> findAll();
    void deleteById(ID id);
}
```

Tugas:

1. Identifikasi entity mana yang seharusnya tidak punya public repository.
2. Kelompokkan repository berdasarkan aggregate.
3. Pisahkan command repository dan query repository.
4. Hapus `findAll()` dari table besar.
5. Tambahkan method intent-oriented.

### Latihan 2 — Search repository

Desain `CaseSearchRepository` untuk kebutuhan:

- filter by status,
- filter by submitted date,
- search applicant name,
- tenant-aware,
- role-aware,
- soft-delete aware,
- pagination,
- sort whitelist,
- projection list item.

Tentukan:

- query object,
- return type,
- index yang dibutuhkan,
- testing strategy.

### Latihan 3 — State transition repository

Desain method repository untuk transition:

```text
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
UNDER_REVIEW -> ESCALATED
```

Constraint:

- harus optimistic locking,
- stale command harus 409,
- audit harus atomic,
- event harus outbox,
- external notification tidak boleh di transaction utama.

### Latihan 4 — Outbox repository

Desain outbox repository dengan:

- claim batch,
- retry count,
- status transition,
- unique event id,
- worker id,
- lock timeout,
- idempotent publish.

---

## 33. Ringkasan

Repository adalah salah satu abstraction paling sering disalahpahami dalam aplikasi Java enterprise.

DAO berorientasi data access teknis. Repository berorientasi aggregate/use case/domain boundary. Spring Data JPA dan Jakarta Data menyediakan repository abstraction yang sangat produktif, tetapi productivity itu harus dipakai dengan pemahaman yang kuat terhadap transaction, query, mapping, lock, fetch, pagination, constraint, dan database behavior.

Repository yang matang:

- tidak sekadar table wrapper,
- tidak expose semua CRUD tanpa alasan,
- membedakan command dan query,
- memilih return type sesuai use case,
- mengontrol fetch plan,
- menjaga tenant/authorization/soft-delete predicate,
- tidak menyembunyikan cost query,
- tidak mengandalkan `exists()` untuk concurrency correctness,
- tidak memaksa ORM untuk reporting berat,
- mudah dites dengan database nyata,
- membantu observability dan debugging production.

Untuk sistem besar seperti regulatory/case management, repository sebaiknya didesain berdasarkan responsibility:

- aggregate command repository,
- search/read model repository,
- reporting repository,
- audit repository,
- outbox/inbox repository,
- archival/batch repository.

Dengan begitu persistence layer menjadi struktur yang bisa dipahami, diuji, dioptimalkan, dan dipertanggungjawabkan.

---

## 34. Status Seri

Seri belum selesai.

Saat ini selesai:

```text
Part 023 — Repository Patterns: DAO, Repository, Spring Data JPA, Jakarta Data
```

Berikutnya:

```text
Part 024 — Jakarta Data Deep Dive
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 022 — Multi-Tenancy, Multi-Schema, Multi-Database, and Data Partitioning](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-022.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 024 — Jakarta Data Deep Dive](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-024.md)

</div>
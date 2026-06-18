# Part 024 — Jakarta Data Deep Dive

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-024.md`  
> Status: Part 024 dari 032 — seri belum selesai

---

## 0. Orientasi Bagian Ini

Pada bagian sebelumnya, kita membahas repository pattern secara umum: DAO, repository domain-oriented, Spring Data JPA, Jakarta Data, generic repository anti-pattern, return type, transaction boundary, dan query ownership.

Bagian ini masuk lebih dalam ke **Jakarta Data** sebagai specification baru dalam ekosistem Jakarta EE modern.

Tujuannya bukan hanya memahami syntax repository Jakarta Data, tetapi memahami posisi arsitekturalnya:

- apa yang Jakarta Data standardisasi,
- apa yang sengaja tidak distandardisasi,
- bagaimana Jakarta Data berelasi dengan Jakarta Persistence,
- bagaimana provider seperti Hibernate Data Repositories mengimplementasikannya,
- kapan Jakarta Data cocok,
- kapan Jakarta Data tidak cukup,
- bagaimana menghindari mental model yang salah ketika datang dari Spring Data JPA,
- bagaimana mendesain repository Jakarta Data untuk sistem enterprise besar.

Jakarta Data 1.0 hadir sebagai specification repository/data access abstraction di Jakarta EE 11. Ia menyediakan model repository interface, annotation untuk lifecycle operation dan query, pagination/sorting, serta facility query by method name sebagai extension untuk membantu migrasi dari framework repository lain.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan apa itu Jakarta Data dan mengapa ia muncul di ekosistem Jakarta EE.
2. Membedakan Jakarta Data dari Jakarta Persistence/JPA.
3. Membedakan Jakarta Data dari Spring Data JPA.
4. Mendesain repository interface yang tidak sekadar menjadi table wrapper.
5. Memahami annotation utama seperti `@Repository`, `@Find`, `@Query`, `@Insert`, `@Update`, `@Delete`, dan lifecycle operation terkait.
6. Memahami derived query / query by method name sebagai convenience, bukan fondasi desain utama untuk query kompleks.
7. Memahami pagination, sorting, limit, ordering, projection, dan return type dalam repository.
8. Mengetahui batas specification vs provider-specific feature.
9. Mengintegrasikan Jakarta Data dengan transaction boundary Jakarta Transactions.
10. Mengetahui implikasi provider seperti Hibernate Data Repositories yang dapat memakai `StatelessSession` untuk operasi repository standard.
11. Menghindari anti-pattern repository yang membuat persistence layer sulit diuji, sulit diobservasi, dan sulit dikontrol performanya.
12. Mendesain migration strategy dari Spring Data JPA/EntityManager manual ke Jakarta Data.

---

## 2. Mental Model: Jakarta Data Bukan ORM

Mental model paling penting:

```text
Jakarta Persistence / JPA  = object-relational mapping + persistence context + entity lifecycle
Jakarta Data               = repository abstraction untuk operasi data access
Jakarta Transactions       = transaction coordination/demarcation
Hibernate ORM              = provider/implementation persistence
Hibernate Data Repositories= implementation Jakarta Data backed by Hibernate
```

Jakarta Data bukan pengganti langsung dari Jakarta Persistence. Ia berada satu level di atas:

```text
Application Service
        |
        v
Jakarta Data Repository Interface
        |
        v
Provider Implementation
        |
        v
Jakarta Persistence / Hibernate / Jakarta NoSQL / other store provider
        |
        v
Database / datastore
```

Jakarta Persistence menjawab:

> Bagaimana object Java dipetakan ke relational database dan bagaimana entity lifecycle dikelola?

Jakarta Data menjawab:

> Bagaimana aplikasi mendeklarasikan operasi data access melalui repository interface secara portable?

Jakarta Transactions menjawab:

> Bagaimana unit kerja dibuat atomic, commit/rollback, dan dikoordinasikan dengan resource manager?

Jadi, Jakarta Data adalah **abstraction untuk menulis repository**, bukan engine yang sendiri melakukan ORM.

---

## 3. Kenapa Jakarta Data Dibutuhkan?

Selama bertahun-tahun, ekosistem Java memiliki pola repository yang kuat, tetapi banyak yang framework-specific:

- Spring Data Repository,
- Micronaut Data,
- Quarkus Panache,
- DeltaSpike Data,
- custom DAO/repository,
- provider-specific Hibernate repository style.

Masalahnya:

1. Jakarta EE sendiri belum memiliki standard repository abstraction.
2. Developer sering langsung memakai `EntityManager` di banyak tempat.
3. Repository pattern sering menjadi custom convention per project.
4. Framework repository populer tidak portable antar Jakarta EE runtime.
5. Query method style, projection, sorting, pagination, dan lifecycle operation tidak punya standard Jakarta-level.

Jakarta Data mencoba mengisi ruang itu.

Ia memberikan standard untuk:

- mendeklarasikan repository sebagai interface,
- operasi lifecycle entity/data,
- query declaration,
- query by method name,
- pagination/sorting/limit,
- interoperability dengan provider yang berbeda,
- compile-time checking oleh provider/annotation processor jika tersedia.

Namun Jakarta Data tidak dimaksudkan untuk menghapus kebutuhan memahami SQL, transaction, ORM, database constraint, atau performance.

---

## 4. Posisi Jakarta Data dalam Stack Enterprise

Bayangkan aplikasi Jakarta/Spring-style modern:

```text
REST Resource / Controller
        |
        v
Application Service / Use Case
        |  owns transaction boundary
        v
Repository Port
        |
        v
Jakarta Data Repository / Custom Adapter
        |
        v
Jakarta Persistence Provider / Hibernate ORM
        |
        v
JDBC Driver / Connection Pool
        |
        v
Database
```

Repository interface tidak boleh mengambil alih tanggung jawab service layer.

Repository boleh tahu:

- cara menemukan data,
- cara menyimpan aggregate/entity,
- query projection untuk use case tertentu,
- sorting/paging,
- query predicate yang merupakan bagian data access.

Repository tidak seharusnya menjadi tempat:

- orchestration use case,
- authorization kompleks,
- external API call,
- transaction choreography kompleks,
- workflow transition rule utama,
- event publishing yang tidak dikontrol transaction boundary.

---

## 5. Jakarta Data vs Jakarta Persistence

### 5.1 Jakarta Persistence

Jakarta Persistence memberi API seperti:

```java
EntityManager em;

Customer customer = em.find(Customer.class, id);
em.persist(customer);
em.remove(customer);
em.createQuery("select c from Customer c where c.email = :email", Customer.class)
  .setParameter("email", email)
  .getSingleResult();
```

Karakteristik:

- explicit persistence context,
- entity lifecycle managed/detached/removed,
- JPQL/Criteria/native query,
- flush/dirty checking,
- entity graph/fetching,
- lock modes,
- provider-specific tuning.

### 5.2 Jakarta Data

Jakarta Data membuat operasi data access dideklarasikan sebagai interface:

```java
@Repository
public interface CustomerRepository {

    @Find
    Optional<Customer> findById(Long id);

    @Query("where email = :email")
    Optional<Customer> findByEmail(String email);

    @Insert
    Customer insert(Customer customer);

    @Update
    Customer update(Customer customer);

    @Delete
    void delete(Customer customer);
}
```

Karakteristik:

- declarative repository,
- method-based data operation,
- provider-generated implementation,
- less direct `EntityManager` usage,
- potential compile-time validation,
- portable abstraction across providers, within spec limits.

### 5.3 Perbedaan Inti

| Aspek | Jakarta Persistence | Jakarta Data |
|---|---|---|
| Level | ORM/persistence API | Repository/data access abstraction |
| Unit utama | `EntityManager`, entity, persistence context | repository interface + method |
| Query | JPQL, Criteria, native SQL | method annotation / derived query / provider query |
| Lifecycle | managed entity lifecycle | repository operation lifecycle |
| Control | lebih eksplisit | lebih deklaratif |
| Cocok untuk | kontrol penuh persistence | CRUD/query repository standard |
| Risiko | boilerplate, misuse persistence context | abstraction hiding query/performance |

---

## 6. Jakarta Data vs Spring Data JPA

Jakarta Data dan Spring Data JPA terlihat mirip, tetapi tidak identik.

Spring Data JPA adalah bagian dari ekosistem Spring Data dan sudah matang lebih lama. Ia menyediakan:

- `JpaRepository`,
- derived query,
- `@Query`,
- `Specification`,
- Query by Example,
- projection,
- auditing,
- paging/sorting,
- repository fragments,
- integration kuat dengan Spring transaction dan Spring Boot.

Jakarta Data adalah Jakarta specification yang bertujuan memberikan standard repository abstraction.

### 6.1 Perbedaan Filosofis

Spring Data JPA:

```text
Framework-specific, highly integrated, broad feature set.
```

Jakarta Data:

```text
Specification-level repository abstraction for Jakarta ecosystem and provider interoperability.
```

### 6.2 Query by Method Name

Spring Data sangat terkenal dengan derived query:

```java
List<Customer> findByStatusAndCreatedAtAfterOrderByCreatedAtDesc(
    CustomerStatus status,
    Instant createdAfter
);
```

Jakarta Data 1.0 juga menyediakan query by method name facility, tetapi ini sebaiknya dipahami sebagai **migration/convenience feature**, bukan lisensi untuk membuat method name sepanjang novel.

Untuk query penting dan kompleks, lebih baik eksplisit:

```java
@Query("""
       where status = :status
         and createdAt >= :createdAfter
       order by createdAt desc
       """)
List<Customer> findRecentByStatus(CustomerStatus status, Instant createdAfter);
```

### 6.3 Migration Mindset

Jika berasal dari Spring Data JPA, jangan otomatis memindahkan semua pola.

Yang bisa dibawa:

- repository interface,
- simple derived query,
- projection mindset,
- pagination/sorting mindset,
- custom repository untuk query kompleks.

Yang perlu hati-hati:

- Spring-specific annotation,
- `JpaRepository` semantics,
- transaction proxy behavior,
- `Specification` API Spring,
- repository fragment style,
- Spring Boot auto-configuration assumption,
- OpenEntityManagerInView defaults.

---

## 7. Repository Declaration

Jakarta Data repository umumnya berupa interface yang diberi `@Repository`.

Contoh sederhana:

```java
import jakarta.data.repository.Repository;
import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Update;
import jakarta.data.repository.Delete;

@Repository
public interface CustomerRepository {

    @Find
    Customer findById(long id);

    @Insert
    Customer insert(Customer customer);

    @Update
    Customer update(Customer customer);

    @Delete
    void delete(Customer customer);
}
```

Mental model:

```text
Repository interface = contract data operation
Provider             = generator/implementation
Application service  = transaction/use-case owner
```

Repository bukan class yang kamu implement manual untuk setiap method sederhana. Provider akan menghasilkan implementasinya.

Namun untuk query kompleks, custom adapter/manual implementation tetap valid.

---

## 8. Lifecycle Operation Annotation

Jakarta Data mendefinisikan annotation untuk operasi lifecycle. Nama dan ketersediaan detail bisa berkembang antar versi/spec, tetapi konsep utamanya:

- insert data baru,
- update data existing,
- save/upsert-like operation tergantung provider/spec semantics,
- delete data,
- find data,
- query data.

Contoh:

```java
@Repository
public interface ApplicationRepository {

    @Insert
    Application insert(Application application);

    @Update
    Application update(Application application);

    @Delete
    void delete(Application application);

    @Find
    Optional<Application> findById(ApplicationId id);
}
```

### 8.1 Insert vs Update

Jangan menganggap `insert` dan `update` sama.

Secara desain:

- `insert` berarti membuat record baru,
- `update` berarti mengubah record yang sudah ada,
- `save`/upsert-like semantics perlu dipahami secara provider-specific jika digunakan.

Kenapa penting?

Karena bug correctness sering muncul ketika aplikasi tidak membedakan create dan update.

Contoh buruk:

```java
repository.save(entityFromRequestBody);
```

Masalah:

- request body bisa menyisipkan id,
- entity existing bisa tertimpa,
- optimistic version bisa terlewati jika mapping keliru,
- audit create/update menjadi ambigu,
- authorization update bisa bypass create rule.

Contoh lebih defensible:

```java
@Transactional
public ApplicationId submit(SubmitApplicationCommand command) {
    Application application = Application.submitNew(
        command.applicantId(),
        command.formData(),
        clock.instant()
    );

    applicationRepository.insert(application);
    auditRepository.insert(AuditEntry.applicationSubmitted(application.id()));

    return application.id();
}
```

Untuk update:

```java
@Transactional
public void revise(ReviseApplicationCommand command) {
    Application application = applicationRepository
        .findById(command.applicationId())
        .orElseThrow(ApplicationNotFoundException::new);

    application.revise(command.expectedVersion(), command.revisionData());

    applicationRepository.update(application);
}
```

---

## 9. Find Operation

Find operation biasanya dipakai untuk mencari entity berdasarkan id atau key.

Contoh:

```java
@Repository
public interface CaseRepository {

    @Find
    Optional<CaseFile> findById(CaseId id);
}
```

Return type yang lebih aman:

```java
Optional<CaseFile>
```

Daripada:

```java
CaseFile findById(CaseId id);
```

Karena tidak semua id pasti ada.

Namun untuk internal invariant, kadang method eksplisit lebih baik:

```java
@Transactional
public CaseFile requireCase(CaseId id) {
    return caseRepository.findById(id)
        .orElseThrow(() -> new CaseNotFoundException(id));
}
```

Jangan menyembunyikan not-found behavior secara tidak eksplisit di repository method jika service layer perlu membedakan:

- not found,
- unauthorized,
- soft-deleted,
- wrong tenant,
- wrong state.

---

## 10. Query dengan `@Query`

`@Query` digunakan untuk query eksplisit.

Contoh:

```java
@Repository
public interface ApplicationListingRepository {

    @Query("""
           where status = :status
             and submittedAt >= :from
             and submittedAt < :to
           order by submittedAt desc
           """)
    List<ApplicationSummary> findSubmittedApplications(
        ApplicationStatus status,
        Instant from,
        Instant to
    );
}
```

Catatan penting:

1. Syntax query dapat dipengaruhi provider.
2. Untuk provider relational berbasis Hibernate, query dapat menggunakan JPQL/HQL-style tergantung implementation.
3. Jangan gunakan string concatenation untuk parameter.
4. Query harus punya ownership jelas.
5. Query listing/reporting sering sebaiknya return projection, bukan entity.

### 10.1 Query Partial vs Full JPQL

Beberapa Jakarta Data provider memungkinkan query fragment seperti:

```java
@Query("where email = :email")
Optional<Customer> findByEmail(String email);
```

Sementara query lengkap bisa terlihat seperti:

```java
@Query("select c from Customer c where c.email = :email")
Optional<Customer> findByEmail(String email);
```

Jangan asumsikan semua provider sama. Dalam sistem enterprise, sebaiknya pilih style dan tulis di coding standard.

---

## 11. Query by Method Name

Jakarta Data 1.0 menyediakan query by method name facility.

Contoh:

```java
List<Application> findByStatus(ApplicationStatus status);

List<Application> findByStatusAndSubmittedAtBetweenOrderBySubmittedAtDesc(
    ApplicationStatus status,
    Instant from,
    Instant to
);
```

### 11.1 Kapan Cocok

Cocok untuk:

- query sederhana,
- lookup by natural key,
- exists check,
- query test/prototype,
- repository internal yang sangat jelas.

Contoh baik:

```java
Optional<UserAccount> findByUsername(String username);

boolean existsByEmail(String email);

List<ReferenceData> findByActiveTrueOrderByDisplayOrderAsc();
```

### 11.2 Kapan Tidak Cocok

Tidak cocok untuk:

- query dengan banyak optional filter,
- query authorization kompleks,
- tenant-aware multi-join,
- reporting,
- aggregation,
- CTE/window function,
- vendor-specific optimizer hint,
- query yang perlu documented business semantics.

Contoh buruk:

```java
findByTenantIdAndStatusInAndSubmittedAtBetweenAndAssignedOfficerIdAndPriorityGreaterThanAndDeletedFalseOrderByPriorityDescSubmittedAtAsc(...)
```

Nama method terlalu panjang adalah smell bahwa query butuh object/predicate/query specification.

---

## 12. Pagination, Sorting, Limit, dan Windowing

Repository abstraction sering menyediakan pagination dan sorting.

Namun pagination bukan detail UI semata. Ia mempengaruhi:

- query plan,
- memory,
- response time,
- correctness saat data berubah,
- index design,
- API contract.

### 12.1 Offset Pagination

Offset pagination umum:

```text
page=10, size=50
```

SQL mental model:

```sql
order by submitted_at desc
offset 500 rows fetch next 50 rows only
```

Kelebihan:

- mudah untuk UI,
- bisa lompat halaman,
- sederhana.

Kekurangan:

- semakin dalam halaman semakin mahal,
- tidak stabil saat data berubah,
- count query bisa mahal,
- butuh deterministic order.

### 12.2 Keyset Pagination

Keyset pagination:

```text
after=(submittedAt,id)
limit=50
```

SQL mental model:

```sql
where (submitted_at, id) < (:lastSubmittedAt, :lastId)
order by submitted_at desc, id desc
fetch next 50 rows only
```

Kelebihan:

- stabil untuk infinite scroll,
- performa lebih baik untuk deep pagination,
- memanfaatkan index composite.

Kekurangan:

- tidak mudah lompat ke halaman arbitrary,
- butuh cursor/keyset contract,
- sorting harus deterministic.

### 12.3 Sorting Whitelist

Jangan izinkan client mengirim nama kolom/entity field bebas.

Buruk:

```text
?sort=someInjectedField
```

Lebih aman:

```java
public enum ApplicationSortKey {
    SUBMITTED_AT,
    PRIORITY,
    STATUS,
    UPDATED_AT
}
```

Mapping eksplisit:

```java
String orderBy = switch (sortKey) {
    case SUBMITTED_AT -> "submittedAt";
    case PRIORITY -> "priority";
    case STATUS -> "status";
    case UPDATED_AT -> "updatedAt";
};
```

Repository abstraction tidak menghapus kebutuhan sort whitelist.

---

## 13. Projection dalam Jakarta Data

Projection adalah cara mengembalikan bentuk data yang berbeda dari entity penuh.

Contoh entity:

```java
@Entity
public class Application {
    @Id
    private Long id;
    private String referenceNo;
    private ApplicationStatus status;
    private Instant submittedAt;
    @Lob
    private String fullPayload;
    // many associations...
}
```

Untuk listing, jangan return `Application` penuh.

Gunakan projection:

```java
public record ApplicationSummary(
    Long id,
    String referenceNo,
    ApplicationStatus status,
    Instant submittedAt
) {}
```

Repository:

```java
@Repository
public interface ApplicationQueryRepository {

    @Query("""
           select id, referenceNo, status, submittedAt
           where status = :status
           order by submittedAt desc
           """)
    List<ApplicationSummary> findSummariesByStatus(ApplicationStatus status);
}
```

Catatan:

- detail syntax projection tergantung provider,
- pastikan mapping projection diuji dengan database nyata,
- jangan expose field sensitif,
- jangan memakai entity hanya karena lebih mudah.

---

## 14. Return Type Design

Return type adalah bagian dari contract repository.

### 14.1 Single Result

```java
Optional<UserAccount> findByUsername(String username);
```

Baik untuk lookup yang mungkin tidak ada.

### 14.2 Required Result

```java
UserAccount getRequiredById(UserId id);
```

Hati-hati. Jika method ini melempar exception, pastikan behavior jelas.

Lebih sering, not-found mapping diletakkan di service:

```java
UserAccount user = repository.findById(id)
    .orElseThrow(() -> new UserNotFoundException(id));
```

### 14.3 Collection

```java
List<ApplicationSummary> findRecent(...);
```

Gunakan limit/pagination untuk query yang bisa tumbuh besar.

### 14.4 Stream

Jika provider mendukung streaming, perhatikan:

- transaction harus masih aktif,
- connection tetap tertahan,
- stream harus ditutup,
- tidak cocok untuk serialisasi HTTP langsung.

Contoh berisiko:

```java
Stream<Application> streamAll();
```

Lebih aman untuk batch:

```java
@Transactional
public void export() {
    try (Stream<ApplicationProjection> stream = repository.streamForExport()) {
        stream.forEach(writer::write);
    }
}
```

### 14.5 Boolean Exists

```java
boolean existsByReferenceNo(String referenceNo);
```

Bagus untuk UX pre-check, tetapi bukan correctness guarantee.

Tetap butuh unique constraint di database.

---

## 15. Transaction Boundary dengan Jakarta Data

Repository method biasanya dijalankan dalam transaction yang dideklarasikan di service layer.

Contoh:

```java
import jakarta.transaction.Transactional;

public class ApplicationService {

    private final ApplicationRepository applicationRepository;
    private final AuditRepository auditRepository;

    @Transactional
    public void approve(ApproveApplicationCommand command) {
        Application application = applicationRepository
            .findById(command.applicationId())
            .orElseThrow(ApplicationNotFoundException::new);

        application.approve(command.officerId(), command.expectedVersion());

        applicationRepository.update(application);
        auditRepository.insert(AuditEntry.approved(application.id(), command.officerId()));
    }
}
```

Transaction boundary sebaiknya bukan di repository untuk use case kompleks.

Kenapa?

Karena satu use case sering melibatkan:

- load aggregate,
- validate state,
- update aggregate,
- insert audit,
- insert outbox,
- update assignment,
- commit atomic.

Jika setiap repository method punya transaction sendiri, atomicity use case rusak.

Buruk:

```java
// masing-masing method membuat transaction sendiri
applicationRepository.update(application);
auditRepository.insert(audit);
outboxRepository.insert(event);
```

Jika audit insert gagal setelah application update commit, data menjadi tidak defensible.

Baik:

```java
@Transactional
public void approve(...) {
    applicationRepository.update(application);
    auditRepository.insert(audit);
    outboxRepository.insert(event);
}
```

---

## 16. Jakarta Data dan Persistence Context

Hal yang harus dipahami: repository abstraction dapat menyembunyikan detail persistence context.

Dalam JPA tradisional:

```java
Application app = em.find(Application.class, id);
app.approve();
// dirty checking saat flush/commit
```

Dalam repository abstraction:

```java
Application app = repository.findById(id).orElseThrow();
app.approve();
repository.update(app);
```

Provider bisa mengimplementasikan operasi ini dengan cara berbeda.

Contoh penting: Hibernate Data Repositories mendokumentasikan bahwa standard Jakarta Data repositories dapat mendelegasikan operasi ke Hibernate `StatelessSession`.

Implikasi konseptual:

- jangan selalu mengasumsikan behavior persistence context persis seperti `EntityManager` managed context,
- pahami provider implementation yang digunakan,
- test lifecycle behavior yang penting,
- jangan mengandalkan side effect implicit yang tidak ada di contract repository.

Untuk use case yang butuh kontrol penuh persistence context, fetch graph, flush mode, lock mode, batch tuning, atau provider-specific API, `EntityManager`/Hibernate Session manual masih bisa lebih tepat.

---

## 17. Locking dan Versioning dengan Repository

Jakarta Data repository tidak membebaskan kita dari concurrency control.

Entity tetap sebaiknya punya version:

```java
@Entity
public class Application {
    @Id
    private Long id;

    @Version
    private long version;

    private ApplicationStatus status;
}
```

Service command membawa expected version:

```java
public record ApproveApplicationCommand(
    Long applicationId,
    long expectedVersion,
    String officerId
) {}
```

Service:

```java
@Transactional
public void approve(ApproveApplicationCommand command) {
    Application application = repository
        .findById(command.applicationId())
        .orElseThrow(ApplicationNotFoundException::new);

    application.approve(command.expectedVersion(), command.officerId());

    repository.update(application);
}
```

Entity method:

```java
public void approve(long expectedVersion, String officerId) {
    if (this.version != expectedVersion) {
        throw new ConcurrentModificationDetectedException();
    }
    if (this.status != ApplicationStatus.UNDER_REVIEW) {
        throw new InvalidStateTransitionException();
    }
    this.status = ApplicationStatus.APPROVED;
    this.approvedBy = officerId;
    this.approvedAt = Instant.now();
}
```

Catatan:

- provider/database tetap perlu enforce optimistic version saat update,
- expected version di domain membantu error lebih eksplisit,
- jangan hanya mengandalkan last-write-wins repository update.

---

## 18. Query Method untuk State Machine

Untuk workflow system, repository method harus mencerminkan state transition requirement.

Contoh buruk:

```java
@Update
Application update(Application application);
```

Jika semua update lewat method generic, sulit mengetahui apakah update itu:

- submit,
- approve,
- reject,
- escalate,
- assign,
- reopen,
- archive.

Lebih defensible:

```java
@Repository
public interface ApplicationTransitionRepository {

    @Find
    Optional<Application> findById(Long id);

    @Update
    Application update(Application application);

    @Query("""
           update Application
              set status = :toStatus,
                  assignedOfficerId = :officerId,
                  version = version + 1
            where id = :id
              and status = :fromStatus
              and version = :expectedVersion
           """)
    int transitionIfCurrent(
        Long id,
        ApplicationStatus fromStatus,
        ApplicationStatus toStatus,
        long expectedVersion,
        String officerId
    );
}
```

Conditional update seperti ini berguna untuk high-contention workflow.

Namun, jangan sembarangan menaruh business rule di query. Gunakan jika:

- transition sederhana,
- concurrency sangat penting,
- performance butuh atomic update,
- service tetap melakukan intent validation,
- audit/outbox tetap atomic dalam transaction.

---

## 19. Query Ownership: Repository Method Naming as Design Signal

Nama method repository harus menjawab pertanyaan:

> Operasi data apa yang dibutuhkan use case ini?

Buruk:

```java
List<Application> findByStatus(ApplicationStatus status);
```

Mungkin terlalu generik.

Lebih baik:

```java
List<ApplicationSummary> findInboxForOfficer(
    String officerId,
    ApplicationStatus status,
    PageRequest page
);
```

Atau:

```java
List<ApplicationForAssignment> findAssignableApplications(AssignmentCriteria criteria);
```

Atau:

```java
List<OverdueCaseProjection> findOverdueCasesForEscalation(Instant cutoff, int limit);
```

Repository method yang baik membawa context use case tanpa menaruh orchestration business logic di repository.

---

## 20. Specification / Criteria-like Use Cases

Jakarta Data memiliki discussion/evolution terkait specification-style query. Pada praktik enterprise, dynamic filtering tetap sering diperlukan.

Contoh search screen:

- status optional,
- date range optional,
- assigned officer optional,
- priority optional,
- keyword optional,
- tenant mandatory,
- authorization scope mandatory.

Query by method name tidak cocok.

Gunakan salah satu:

1. `@Query` dengan parameter nullable secara hati-hati.
2. Query object + custom repository implementation.
3. Criteria API/EntityManager untuk dynamic predicate.
4. Provider-specific query DSL.
5. Read model/search index jika query terlalu kompleks.

Contoh query object:

```java
public record ApplicationSearchCriteria(
    TenantId tenantId,
    Set<ApplicationStatus> statuses,
    String assignedOfficerId,
    Instant submittedFrom,
    Instant submittedTo,
    String keyword,
    int limit,
    String afterCursor
) {}
```

Custom repository port:

```java
public interface ApplicationSearchRepository {
    SearchResult<ApplicationSummary> search(ApplicationSearchCriteria criteria);
}
```

Implementation dapat memakai EntityManager/native SQL.

Pelajaran penting:

```text
Jakarta Data repository untuk simple/standard access.
Custom query adapter untuk search/reporting kompleks.
```

---

## 21. Multi-Tenancy dengan Jakarta Data

Repository method harus selalu tenant-aware jika sistem multi-tenant.

Buruk:

```java
Optional<Application> findByReferenceNo(String referenceNo);
```

Jika `referenceNo` hanya unique per tenant, method ini berbahaya.

Lebih baik:

```java
Optional<Application> findByTenantIdAndReferenceNo(TenantId tenantId, String referenceNo);
```

Untuk repository yang always tenant-scoped:

```java
@Query("""
       where tenantId = :tenantId
         and referenceNo = :referenceNo
       """)
Optional<Application> findByReferenceNo(TenantId tenantId, String referenceNo);
```

Jangan hanya mengandalkan filter global tanpa test leakage.

Checklist multi-tenancy:

- semua query punya tenant predicate,
- unique constraint scoped by tenant,
- cache key include tenant,
- audit include tenant,
- outbox include tenant,
- logs/metrics include tenant secara aman,
- tests mencoba cross-tenant id/reference.

---

## 22. Soft Delete dengan Jakarta Data

Soft delete membuat repository lebih rumit.

Entity:

```java
@Entity
public class Application {
    @Id
    private Long id;
    private boolean deleted;
    private Instant deletedAt;
}
```

Query harus exclude deleted:

```java
@Query("where deleted = false and id = :id")
Optional<Application> findActiveById(Long id);
```

Masalah jika punya method generic:

```java
@Find
Optional<Application> findById(Long id);
```

Apakah ini harus return deleted record? Tergantung use case.

Solusi desain:

- pisahkan active repository vs admin/audit repository,
- buat naming eksplisit: `findActiveById`, `findIncludingDeletedById`,
- jangan biarkan soft delete menjadi behavior tersembunyi tanpa test,
- unique constraint harus memperhitungkan deleted status bila business mengizinkan reuse key.

---

## 23. Authorization dan Repository

Authorization bukan sekadar filter UI.

Buruk:

```java
Application app = repository.findById(id).orElseThrow();
if (!canAccess(user, app)) throw Forbidden;
```

Ini bisa bocor informasi:

- id valid tapi forbidden,
- timing difference,
- audit query unauthorized,
- lazy association terbuka.

Kadang lebih baik authorization predicate masuk query:

```java
@Query("""
       where id = :id
         and tenantId = :tenantId
         and assignedOfficerId = :officerId
         and deleted = false
       """)
Optional<Application> findAccessibleForOfficer(
    Long id,
    TenantId tenantId,
    String officerId
);
```

Namun jangan menaruh seluruh authorization engine di repository. Gunakan repository untuk enforce data scope, service/policy untuk rule lebih luas.

---

## 24. Validation Integration

Jakarta Data repository method dapat menerima entity atau parameter yang divalidasi oleh Jakarta Validation tergantung runtime/provider integration.

Contoh konseptual:

```java
@Repository
public interface UserRepository {

    @Insert
    UserAccount insert(@Valid UserAccount account);

    Optional<UserAccount> findByUsername(@NotBlank String username);
}
```

Tapi ingat:

- validation bukan database constraint,
- validation bukan authorization,
- validation bukan concurrency control,
- validation bukan audit trail.

Untuk uniqueness:

```java
boolean existsByEmail(String email);
```

Tetap butuh:

```sql
alter table user_account add constraint uk_user_email unique (email);
```

Application pre-check hanya untuk UX. Correctness ada di database constraint.

---

## 25. Provider-Specific Behavior: Hibernate Data Repositories

Hibernate Data Repositories adalah implementasi Jakarta Data yang backed by Hibernate ORM.

Beberapa karakter penting:

1. Entity tetap dimapping dengan Jakarta Persistence annotation.
2. Query dapat ditulis dengan HQL/JPQL-style tergantung dukungan.
3. Repository implementation bisa dihasilkan oleh annotation processing/provider.
4. Standard Jakarta Data repositories dapat menggunakan Hibernate `StatelessSession`.
5. Ada perbedaan programming model dari penggunaan langsung `EntityManager`.

Implikasi untuk engineer senior:

- baca dokumentasi provider, bukan hanya specification,
- jangan asumsikan semua Jakarta Data provider identik,
- test generated SQL,
- test transaction semantics,
- test versioning behavior,
- test lazy/fetch behavior,
- test caching behavior.

Provider abstraction membantu portabilitas, tetapi production correctness tetap harus dibuktikan pada provider/database yang dipakai.

---

## 26. Kapan Jakarta Data Cocok?

Jakarta Data cocok untuk:

1. CRUD sederhana.
2. Lookup by id/natural key.
3. Repository interface standard di Jakarta EE.
4. Aplikasi yang ingin mengurangi boilerplate `EntityManager`.
5. Query eksplisit sederhana.
6. Projection sederhana.
7. Repository yang bisa divalidasi oleh provider/compile-time tooling.
8. Tim yang ingin standard Jakarta-level, bukan Spring-specific API.
9. Modul reference data/master data.
10. Modul transactional data dengan query yang masih manageable.

Contoh:

```java
@Repository
public interface ReferenceDataRepository {

    List<ReferenceData> findByTypeAndActiveTrueOrderByDisplayOrderAsc(String type);

    Optional<ReferenceData> findByTypeAndCode(String type, String code);
}
```

---

## 27. Kapan Jakarta Data Tidak Cukup?

Jakarta Data mungkin tidak cukup untuk:

1. Query analytics/reporting berat.
2. Dynamic search screen dengan banyak optional filters.
3. Query yang butuh CTE/window function/optimizer hint.
4. Bulk update/delete besar.
5. Batch migration/backfill high-volume.
6. Fine-grained flush/fetch/lock control.
7. Multi-step persistence operation dengan provider-specific performance tuning.
8. Complex graph loading.
9. Database-specific feature seperti Oracle hierarchical query, PostgreSQL JSONB indexing, SQL Server query hints.
10. Query yang harus sangat dioptimalkan berdasarkan execution plan.

Untuk kasus ini, gunakan:

- custom repository implementation,
- EntityManager,
- Hibernate Session,
- native SQL,
- jOOQ,
- JDBC template,
- stored procedure,
- materialized view,
- search engine,
- dedicated reporting store.

Jangan memaksa Jakarta Data untuk semua hal hanya karena repository abstraction terlihat rapi.

---

## 28. Migration Strategy dari EntityManager Manual

Jika codebase lama banyak memakai `EntityManager`, migration ke Jakarta Data harus bertahap.

### 28.1 Klasifikasi Repository

Klasifikasikan method:

| Kategori | Strategi |
|---|---|
| simple find by id | Jakarta Data |
| simple lookup by unique key | Jakarta Data |
| simple insert/update/delete | Jakarta Data |
| listing sederhana | Jakarta Data + projection |
| dynamic search | custom adapter |
| reporting heavy | native SQL/read model |
| batch large volume | EntityManager/JDBC/batch framework |
| state transition high contention | conditional SQL/custom repository |

### 28.2 Migrasi Bertahap

1. Mulai dari reference/master data repository.
2. Pindahkan query simple lookup.
3. Tambahkan test integrasi per repository.
4. Monitor generated SQL.
5. Jangan migrasi query kompleks dulu.
6. Buat coding standard untuk query by method name length.
7. Buat policy untuk projection/listing.
8. Buat escape hatch custom repository.

### 28.3 Guardrail

Contoh guardrail:

```text
- Derived query maksimal 2 predicate + 1 order clause.
- Query listing wajib projection, bukan entity.
- Query multi-tenant wajib menerima TenantId eksplisit atau memakai tested tenant context.
- Query dengan pagination wajib deterministic order.
- Bulk operation tidak boleh memakai generic repository method.
- State transition update wajib pakai optimistic version atau conditional update.
```

---

## 29. Migration Strategy dari Spring Data JPA

Jika datang dari Spring Boot/Spring Data JPA:

### 29.1 Yang Mudah Dipindah

- repository interface concept,
- simple derived query,
- `@Query` mental model,
- projection DTO,
- pagination/sorting concept,
- transaction at service layer.

### 29.2 Yang Tidak Langsung Sama

- `JpaRepository<T, ID>`,
- `CrudRepository`,
- `PagingAndSortingRepository`,
- `Specification<T>` Spring,
- `ExampleMatcher`,
- repository fragments,
- Spring `@Transactional`,
- Spring `DataAccessException`,
- Boot autoconfig defaults,
- Spring auditing annotations,
- query lookup strategies.

### 29.3 Strategi

Jangan lakukan blind rename.

Lebih baik:

1. Tuliskan ulang repository contract berdasarkan use case.
2. Pindahkan hanya query yang sederhana.
3. Buat custom adapter untuk query kompleks.
4. Pastikan transaction annotation yang digunakan sesuai runtime.
5. Pastikan exception translation tetap ada.
6. Pastikan pagination/sorting semantics sama.
7. Pastikan test concurrency dan locking tetap valid.

---

## 30. Jakarta Data dalam Aplikasi Modular

Untuk aplikasi besar, pisahkan repository berdasarkan responsibility.

Contoh module `application-management`:

```text
application-management/
  domain/
    Application.java
    ApplicationStatus.java
    ApplicationTransitionPolicy.java
  persistence/
    ApplicationCommandRepository.java
    ApplicationQueryRepository.java
    ApplicationSearchRepository.java
    ApplicationAuditRepository.java
  service/
    SubmitApplicationService.java
    ApproveApplicationService.java
    ApplicationInboxService.java
```

Command repository:

```java
@Repository
public interface ApplicationCommandRepository {
    @Find
    Optional<Application> findById(Long id);

    @Insert
    Application insert(Application application);

    @Update
    Application update(Application application);
}
```

Query repository:

```java
@Repository
public interface ApplicationQueryRepository {

    @Query("""
           select id, referenceNo, status, submittedAt
           where tenantId = :tenantId
             and assignedOfficerId = :officerId
             and status = :status
           order by submittedAt desc, id desc
           """)
    List<ApplicationInboxItem> findInbox(
        TenantId tenantId,
        String officerId,
        ApplicationStatus status,
        int limit
    );
}
```

Search repository custom:

```java
public interface ApplicationSearchRepository {
    SearchResult<ApplicationSummary> search(ApplicationSearchCriteria criteria);
}
```

Audit repository:

```java
@Repository
public interface ApplicationAuditRepository {
    @Insert
    AuditEntry insert(AuditEntry entry);
}
```

Dengan ini, repository tidak menjadi satu interface raksasa.

---

## 31. Failure Modes Jakarta Data

### 31.1 Generated Query Tidak Sesuai Ekspektasi

Gejala:

- query lambat,
- index tidak terpakai,
- join terlalu banyak,
- sorting mahal,
- count query mahal.

Mitigasi:

- log SQL di test/integration environment,
- assert query count untuk hot path,
- review execution plan,
- gunakan explicit query/native SQL jika perlu.

### 31.2 Query by Method Name Terlalu Kompleks

Gejala:

- method name panjang,
- sulit dibaca,
- sulit diubah,
- bug filter optional,
- logic authorization tersembunyi.

Mitigasi:

- query object,
- explicit `@Query`,
- custom repository,
- read model.

### 31.3 Transaction Boundary Terlalu Kecil

Gejala:

- update sukses tapi audit gagal,
- outbox tidak konsisten,
- partial state change,
- duplicate side effect.

Mitigasi:

- transaction di service/use case,
- outbox pattern,
- idempotency key,
- integration test transaction boundary.

### 31.4 Entity Loading untuk Listing Besar

Gejala:

- N+1,
- memory naik,
- response lambat,
- lazy loading saat JSON serialization.

Mitigasi:

- projection,
- limit/pagination,
- fetch plan explicit,
- DTO query.

### 31.5 Tenant Leakage

Gejala:

- user tenant A bisa membaca data tenant B,
- cache cross-tenant,
- audit/search index bocor.

Mitigasi:

- tenant predicate explicit,
- tenant-scoped unique/index,
- tenant-aware cache key,
- cross-tenant tests.

### 31.6 Soft Delete Leakage

Gejala:

- deleted record muncul di listing,
- unique key tidak bisa dipakai ulang,
- admin query dan user query bercampur.

Mitigasi:

- repository method naming explicit,
- active vs admin repository,
- constraint design,
- tests untuk deleted state.

### 31.7 Provider Behavior Surprise

Gejala:

- lifecycle callback tidak seperti dugaan,
- dirty checking tidak terjadi seperti EntityManager style,
- cache behavior berbeda,
- update semantics berbeda.

Mitigasi:

- baca provider docs,
- test behavior penting,
- jangan mengandalkan implicit behavior di luar spec,
- gunakan EntityManager/manual adapter untuk use case yang butuh kontrol penuh.

---

## 32. Observability untuk Repository Layer

Repository abstraction tidak boleh membuat SQL invisible.

Minimal observability:

- SQL statement logging di non-prod,
- query count per request/use case,
- slow query log,
- query fingerprint,
- execution plan untuk hot query,
- row count returned,
- pagination size,
- transaction duration,
- lock wait/deadlock count,
- connection acquisition time,
- exception classification,
- optimistic lock conflict count,
- repository method latency.

Contoh metric naming:

```text
repository.method.latency{repository="ApplicationQueryRepository", method="findInbox"}
repository.method.error{exception="OptimisticLockException"}
db.query.count{usecase="application-inbox"}
db.lock.wait{module="application-management"}
```

Untuk sistem besar, correlation id harus menghubungkan:

```text
HTTP request -> service method -> repository method -> SQL -> DB session -> audit/outbox
```

---

## 33. Testing Jakarta Data Repository

Jangan hanya unit test mock repository.

Repository generated/provider behavior harus diuji dengan database nyata.

### 33.1 Test yang Dibutuhkan

1. Mapping test.
2. Query correctness test.
3. Projection mapping test.
4. Pagination/sorting test.
5. Tenant predicate test.
6. Soft delete test.
7. Constraint violation test.
8. Optimistic locking test.
9. Transaction boundary test.
10. Generated SQL/performance smoke test.

### 33.2 Testcontainers / Real DB

Gunakan database yang sama dengan production sedekat mungkin.

H2/in-memory database tidak cukup untuk:

- locking,
- isolation,
- JSON type,
- LOB behavior,
- sequence/identity behavior,
- index plan,
- SQL dialect,
- constraint timing.

### 33.3 Example Test Scenario

```java
@Test
void findInboxMustNotReturnOtherTenantData() {
    TenantId tenantA = tenant("A");
    TenantId tenantB = tenant("B");

    insertApplication(tenantA, "APP-A", "officer-1");
    insertApplication(tenantB, "APP-B", "officer-1");

    List<ApplicationInboxItem> inbox = repository.findInbox(
        tenantA,
        "officer-1",
        ApplicationStatus.UNDER_REVIEW,
        20
    );

    assertThat(inbox)
        .extracting(ApplicationInboxItem::referenceNo)
        .containsExactly("APP-A");
}
```

---

## 34. Coding Standard Rekomendasi

Untuk tim enterprise, buat standard eksplisit.

Contoh:

```text
1. Repository method simple lookup boleh memakai query by method name.
2. Query by method name maksimal 2-3 predicate.
3. Query listing wajib return projection, bukan entity, kecuali ada alasan eksplisit.
4. Semua query multi-tenant wajib punya tenant predicate atau tested tenant resolver.
5. Pagination wajib deterministic order.
6. Sorting dari client wajib whitelist.
7. Repository tidak boleh membuka transaction use case sendiri kecuali repository internal operation yang memang atomic dan isolated.
8. Service/application layer adalah owner transaction boundary.
9. Query yang menghasilkan lebih dari N row wajib pakai limit/page/stream dengan transaction handling jelas.
10. Query reporting besar tidak boleh dipaksa ke Jakarta Data jika native SQL/read model lebih tepat.
11. Generated SQL hot path wajib direview.
12. Repository tests wajib memakai database nyata untuk dialect production.
13. Method generic seperti `save()` harus dihindari untuk aggregate penting; gunakan `insert`, `update`, atau command-specific method.
14. Soft delete harus eksplisit dalam method name/contract.
15. Repository method yang bypass entity lifecycle harus diberi nama yang jelas seperti `transitionIfCurrent` atau `bulkArchiveBefore`.
```

---

## 35. End-to-End Example: Case Management

### 35.1 Domain

```java
@Entity
@Table(name = "case_file")
public class CaseFile {

    @Id
    private Long id;

    @Version
    private long version;

    @Column(nullable = false)
    private String tenantId;

    @Column(nullable = false, unique = false)
    private String referenceNo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CaseStatus status;

    @Column(nullable = false)
    private String assignedOfficerId;

    @Column(nullable = false)
    private Instant createdAt;

    private Instant updatedAt;

    public void escalate(long expectedVersion, String actorId, Instant now) {
        if (this.version != expectedVersion) {
            throw new ConcurrentModificationDetectedException();
        }
        if (this.status != CaseStatus.UNDER_REVIEW) {
            throw new InvalidCaseTransitionException();
        }
        this.status = CaseStatus.ESCALATED;
        this.updatedAt = now;
    }
}
```

Database constraint:

```sql
alter table case_file
  add constraint uk_case_file_tenant_reference unique (tenant_id, reference_no);
```

### 35.2 Command Repository

```java
@Repository
public interface CaseCommandRepository {

    @Find
    Optional<CaseFile> findById(Long id);

    @Insert
    CaseFile insert(CaseFile caseFile);

    @Update
    CaseFile update(CaseFile caseFile);
}
```

### 35.3 Query Repository

```java
public record CaseInboxItem(
    Long id,
    String referenceNo,
    CaseStatus status,
    Instant updatedAt
) {}

@Repository
public interface CaseInboxRepository {

    @Query("""
           select id, referenceNo, status, updatedAt
           where tenantId = :tenantId
             and assignedOfficerId = :officerId
             and status = :status
           order by updatedAt desc, id desc
           """)
    List<CaseInboxItem> findInbox(
        String tenantId,
        String officerId,
        CaseStatus status,
        int limit
    );
}
```

### 35.4 Audit Repository

```java
@Entity
@Table(name = "case_audit")
public class CaseAuditEntry {
    @Id
    private Long id;
    private Long caseId;
    private String action;
    private String actorId;
    private Instant createdAt;
    @Lob
    private String metadataJson;
}

@Repository
public interface CaseAuditRepository {
    @Insert
    CaseAuditEntry insert(CaseAuditEntry entry);
}
```

### 35.5 Service Boundary

```java
public class EscalateCaseService {

    private final CaseCommandRepository caseRepository;
    private final CaseAuditRepository auditRepository;
    private final OutboxRepository outboxRepository;
    private final Clock clock;

    @Transactional
    public void escalate(EscalateCaseCommand command) {
        CaseFile caseFile = caseRepository
            .findById(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

        caseFile.escalate(
            command.expectedVersion(),
            command.actorId(),
            clock.instant()
        );

        caseRepository.update(caseFile);

        auditRepository.insert(CaseAuditEntry.escalated(
            caseFile.id(),
            command.actorId(),
            clock.instant()
        ));

        outboxRepository.insert(OutboxEvent.caseEscalated(
            caseFile.id(),
            caseFile.referenceNo()
        ));
    }
}
```

Atomicity:

```text
case update + audit insert + outbox insert commit bersama
```

Jika commit gagal, semuanya rollback.
Jika commit sukses tapi message publish gagal, outbox publisher dapat retry.

---

## 36. Anti-Pattern

### Anti-Pattern 1 — Repository Raksasa

```java
@Repository
public interface ApplicationRepository {
    // 300 methods for command, query, reporting, batch, admin, audit...
}
```

Dampak:

- ownership kabur,
- sulit test,
- method generic dipakai sembarangan,
- query penting tersembunyi.

Solusi:

- pisah command/query/search/audit/batch repository.

### Anti-Pattern 2 — Semua Pakai Derived Query

```java
findByAAndBAndCAndDAndEAndFAndGOrderByHDesc(...)
```

Solusi:

- `@Query`, query object, custom repository.

### Anti-Pattern 3 — Entity untuk Semua Read

```java
List<Application> findAllByStatus(Status status);
```

Solusi:

- projection/read model untuk listing/report.

### Anti-Pattern 4 — Generic Save untuk Aggregate Penting

```java
repository.save(applicationFromRequestBody);
```

Solusi:

- load existing aggregate,
- call domain method,
- update explicitly,
- use version/expected version.

### Anti-Pattern 5 — Transaction di Repository untuk Use Case Kompleks

```java
@Transactional
repository.updateApplication(...);
@Transactional
repository.insertAudit(...);
```

Solusi:

- transaction di service.

### Anti-Pattern 6 — Tenant Predicate Implisit Tanpa Test

```java
findByReferenceNo(ref)
```

Solusi:

- tenant explicit atau tested tenant context.

### Anti-Pattern 7 — Menganggap Jakarta Data Sama dengan Spring Data

Solusi:

- pahami specification, provider docs, dan runtime integration.

---

## 37. Design Checklist

Sebelum membuat repository Jakarta Data, jawab pertanyaan ini:

1. Apakah repository ini command, query, search, audit, atau batch?
2. Apakah return entity atau projection?
3. Apakah query membutuhkan tenant predicate?
4. Apakah query harus exclude soft-deleted data?
5. Apakah query butuh authorization scope?
6. Apakah method ini boleh derived query atau harus explicit `@Query`?
7. Apakah query akan dipakai untuk listing besar?
8. Apakah pagination deterministic?
9. Apakah sorting user-controlled sudah whitelist?
10. Apakah update butuh optimistic version?
11. Apakah operasi ini bagian dari transaction use case lebih besar?
12. Apakah audit/outbox harus commit bersama?
13. Apakah generated SQL sudah direview?
14. Apakah test memakai database yang sama dengan production?
15. Apakah provider-specific behavior sudah dipahami?
16. Apakah repository method name mencerminkan use case?
17. Apakah ada constraint database untuk invariant penting?
18. Apakah exception mapping sudah jelas?
19. Apakah observability cukup untuk debugging production?
20. Apakah abstraction ini membantu, atau justru menyembunyikan kompleksitas yang harus explicit?

---

## 38. Latihan / Scenario

### Scenario 1 — Reference Data

Buat repository Jakarta Data untuk reference data:

- lookup by type + code,
- list active by type ordered by display order,
- tenant-independent,
- cacheable.

Pertanyaan:

- Return entity atau projection?
- Apakah perlu transaction read-only?
- Apakah cache key cukup type?

### Scenario 2 — Officer Inbox

Buat repository untuk inbox officer:

- tenant id,
- officer id,
- status,
- updated_at desc,
- pagination,
- projection.

Pertanyaan:

- Offset atau keyset?
- Index apa yang dibutuhkan?
- Bagaimana mencegah tenant leakage?

### Scenario 3 — Approval Transition

Buat service approve case:

- load case,
- expected version,
- validate state,
- update status,
- insert audit,
- insert outbox.

Pertanyaan:

- Transaction boundary di mana?
- Apa yang terjadi jika outbox insert gagal?
- Bagaimana handle optimistic conflict?

### Scenario 4 — Search Screen Kompleks

Search application dengan optional filters:

- tenant mandatory,
- status optional,
- date range optional,
- officer optional,
- keyword optional,
- priority optional.

Pertanyaan:

- Apakah query by method name cocok?
- Kapan pakai custom repository?
- Apakah butuh search index?

### Scenario 5 — Soft Delete

Entity `Document` memakai soft delete.

Pertanyaan:

- Method apa untuk user-facing read?
- Method apa untuk admin read?
- Bagaimana unique filename per case jika dokumen deleted?
- Bagaimana audit delete?

---

## 39. Ringkasan

Jakarta Data adalah langkah penting dalam ekosistem Jakarta karena menyediakan standard repository/data access abstraction. Namun, ia harus dipahami sebagai **abstraction layer**, bukan pengganti pemahaman persistence.

Kesimpulan utama:

1. Jakarta Data berada di atas Jakarta Persistence/Jakarta NoSQL/provider data store.
2. Jakarta Data bukan ORM dan bukan transaction manager.
3. Repository interface membantu mengurangi boilerplate, tetapi tidak menghapus kebutuhan desain query, transaction, constraint, dan observability.
4. Query by method name cocok untuk query sederhana, tetapi query kompleks harus explicit.
5. Listing/reporting sebaiknya memakai projection/read model, bukan entity penuh.
6. Transaction boundary tetap sebaiknya dimiliki application service/use case.
7. Multi-tenancy, soft delete, authorization, and audit harus terlihat dalam repository contract atau dijamin oleh mekanisme yang diuji.
8. Provider-specific behavior tetap penting, terutama pada Hibernate Data Repositories.
9. Untuk performance-critical, batch, reporting, dan vendor-specific query, custom repository/EntityManager/native SQL tetap valid.
10. Top engineer tidak memilih abstraction karena terlihat rapi, tetapi karena abstraction tersebut menjaga correctness, evolvability, performance, dan operability.

---

## 40. Koneksi ke Bagian Berikutnya

Part ini membahas Jakarta Data secara mendalam.

Bagian berikutnya akan masuk ke:

```text
Part 025 — Spring Transaction + JPA Integration Deep Dive
```

Bagian tersebut penting karena banyak sistem enterprise Java modern memakai Spring Framework/Spring Boot dengan JPA/Hibernate. Kita akan membedah:

- `JpaTransactionManager`,
- `DataSourceTransactionManager`,
- JTA transaction manager,
- Spring `@Transactional` vs Jakarta `@Transactional`,
- propagation,
- isolation,
- rollback rules,
- proxy/self-invocation,
- EntityManager binding to thread,
- OpenEntityManagerInView,
- async/virtual thread boundary.

Status seri: **belum selesai**. Part 024 dari 032 selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 023 — Repository Patterns: DAO, Repository, Spring Data JPA, Jakarta Data](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 025 — Spring Transaction + JPA Integration Deep Dive](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-025.md)

</div>
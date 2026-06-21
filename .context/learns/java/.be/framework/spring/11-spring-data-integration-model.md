# Part 11 — Spring Data Integration Model Without Repeating JPA

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `11-spring-data-integration-model.md`  
> Posisi: Part 11 dari 35  
> Status seri: belum selesai  
> Berikutnya: `12-spring-webmvc-runtime-internals.md`

---

## 0. Tujuan Part Ini

Part ini membahas **Spring Data sebagai integration model**, bukan sebagai tutorial JPA ulang.

Kita sudah punya fondasi sebelumnya:

- Java collection, stream, concurrency, memory, testing, IO.
- JDBC, SQL, HikariCP.
- JPA, Hibernate, EclipseLink, ORM engineering.
- Transaction management Spring.
- AOP/proxy Spring.
- Bean lifecycle dan auto-configuration Spring Boot.

Karena itu, fokus part ini adalah:

1. Apa sebenarnya abstraction yang diberikan Spring Data.
2. Bagaimana repository interface berubah menjadi runtime proxy.
3. Bagaimana Spring Data memilih implementasi method.
4. Kapan query method membantu dan kapan menjadi technical debt.
5. Bagaimana repository fragment bekerja.
6. Bagaimana auditing, domain event, exception translation, pagination, sorting, dan transaction boundary tersambung ke Spring runtime.
7. Bagaimana menggunakan Spring Data secara arsitektural tanpa kehilangan kontrol atas persistence model.
8. Bagaimana failure model Spring Data muncul di production.

Yang **tidak** akan diulang:

- Detail persistence context JPA.
- Hibernate dirty checking internal.
- Mapping entity dasar.
- SQL indexing dasar.
- Transaction isolation database secara teori.
- Redis/Mongo/Elasticsearch detail sebagai database.
- DDD teori umum.

Part ini harus memberi mental model: **Spring Data adalah repository proxy factory + query abstraction + store-specific adapter + Spring integration layer**.

---

## 1. Spring Data Bukan ORM

Kesalahan framing paling umum:

> “Spring Data JPA adalah Hibernate wrapper.”

Lebih tepat:

> Spring Data adalah framework untuk membuat repository abstraction yang konsisten di atas banyak persistence store, dengan integrasi ke Spring container, transaction, exception translation, query derivation, pagination, auditing, dan event publication.

Untuk JPA, Spring Data JPA memang memakai JPA provider seperti Hibernate/EclipseLink. Tetapi Spring Data sendiri bukan ORM. Ia tidak menggantikan JPA provider. Ia menyediakan:

- Repository interface model.
- Proxy generation.
- Query method parsing.
- Store abstraction.
- Query lookup strategy.
- Pagination/sorting abstraction.
- Auditing abstraction.
- Domain event publication hook.
- Custom repository fragment composition.
- Exception translation integration.
- Transaction integration.

Mental model:

```text
Application Service
      |
      v
Repository Interface
      |
      v
Spring Data Repository Proxy
      |
      +--> Query Method Implementation
      +--> Custom Fragment Implementation
      +--> Base Repository Implementation
      +--> Store-specific Adapter
                  |
                  v
          JPA / JDBC / Mongo / Redis / Elasticsearch / etc.
```

Spring Data bukan tempat ideal untuk semua domain logic. Ia adalah boundary untuk persistence interaction.

---

## 2. Repository Abstraction: Apa yang Diabstraksikan?

Repository abstraction Spring Data mengabstraksikan **pola akses data**, bukan semua detail storage.

Yang diabstraksikan:

- CRUD operation.
- Identifier lookup.
- Batch lookup.
- Count/existence.
- Paging.
- Sorting.
- Query by method name.
- Query by annotation.
- Custom repository composition.
- Store-specific extension point.

Yang tidak sepenuhnya diabstraksikan:

- Transaction semantics tiap store.
- Consistency model tiap store.
- Locking behavior.
- Query planner.
- Index strategy.
- Fetch strategy.
- Isolation level.
- Distributed transaction.
- Store-specific data modeling.
- Write amplification.
- Latency characteristics.

Karena itu, repository abstraction bagus untuk **programming model consistency**, tetapi buruk bila dipakai untuk berpura-pura bahwa semua database sama.

Contoh risiko:

```java
interface CustomerRepository extends CrudRepository<Customer, UUID> {
    List<Customer> findByStatus(CustomerStatus status);
}
```

Method di atas terlihat sederhana. Tetapi cost-nya bergantung pada:

- Apakah `status` indexed.
- Cardinality status.
- Apakah entity membawa relationship lazy/eager.
- Apakah query mengembalikan ribuan row.
- Apakah transaction read-only.
- Apakah ada tenant predicate.
- Apakah ada soft delete predicate.
- Apakah query perlu projection.

Spring Data menyederhanakan pemanggilan, bukan menghapus konsekuensi database.

---

## 3. Layering yang Sehat

Pattern sehat:

```text
Controller / Message Listener / Job Step
      |
      v
Application Service
      |
      v
Domain Service / Policy / State Machine
      |
      v
Repository Port
      |
      v
Spring Data Repository / Adapter
```

Untuk aplikasi besar, repository interface Spring Data sebaiknya tidak langsung menjadi API lintas module tanpa disiplin. Ada dua pendekatan:

### 3.1 Repository Langsung Digunakan Application Service

Cocok untuk aplikasi kecil-menengah atau bounded module sederhana.

```java
@Service
public class CaseAssignmentService {
    private final CaseRepository caseRepository;

    public CaseAssignmentService(CaseRepository caseRepository) {
        this.caseRepository = caseRepository;
    }

    @Transactional
    public void assign(CaseId caseId, OfficerId officerId) {
        CaseRecord record = caseRepository.findById(caseId.value())
            .orElseThrow(() -> new CaseNotFoundException(caseId));

        record.assignTo(officerId);
    }
}
```

Kelebihan:

- Ringkas.
- Produktif.
- Mudah dipahami.

Risiko:

- Repository interface membesar.
- Application service tahu terlalu banyak tentang persistence shape.
- Query method jadi bahasa domain palsu.

### 3.2 Repository Adapter di Belakang Port

Cocok untuk domain kompleks, multi-store, regulatory system, workflow engine, atau module yang butuh boundary kuat.

```java
public interface CaseLookupPort {
    Optional<CaseSnapshot> findSnapshot(CaseId caseId);
}

@Repository
class SpringDataCaseLookupAdapter implements CaseLookupPort {
    private final CaseJpaRepository repository;

    SpringDataCaseLookupAdapter(CaseJpaRepository repository) {
        this.repository = repository;
    }

    @Override
    public Optional<CaseSnapshot> findSnapshot(CaseId caseId) {
        return repository.findSnapshotById(caseId.value());
    }
}
```

Kelebihan:

- Domain/application layer tidak bocor ke Spring Data.
- Query model bisa berubah tanpa mengubah service.
- Lebih mudah enforce tenant/security/audit.
- Cocok untuk module boundary.

Risiko:

- Boilerplate lebih banyak.
- Kalau terlalu dogmatis, development melambat.

Heuristic:

```text
CRUD/simple module       -> Spring Data repository boleh langsung dipakai.
Regulatory/workflow core -> bungkus dengan port/adapter.
Cross-module API         -> jangan expose repository entity langsung.
```

---

## 4. Repository Interface Hierarchy

Spring Data menyediakan beberapa base interface. Yang umum:

```java
Repository<T, ID>
CrudRepository<T, ID>
PagingAndSortingRepository<T, ID>
ListCrudRepository<T, ID>
ListPagingAndSortingRepository<T, ID>
JpaRepository<T, ID>
```

Mental model:

- `Repository` adalah marker/fondasi.
- `CrudRepository` memberi operasi CRUD dasar.
- `PagingAndSortingRepository` memberi paging/sorting.
- `JpaRepository` memberi operasi JPA-specific seperti flush, batch delete, dan lain-lain.

Jangan otomatis memakai `JpaRepository` untuk semua repository.

Pertanyaan desain:

1. Apakah service benar-benar perlu `flush()`?
2. Apakah perlu batch delete?
3. Apakah ingin expose `findAll()`?
4. Apakah ingin mencegah full table read?
5. Apakah repository ini hanya read-side projection?

Untuk sistem besar, base interface custom sering lebih aman:

```java
@NoRepositoryBean
public interface DomainRepository<T, ID> extends Repository<T, ID> {
    Optional<T> findById(ID id);
    T save(T aggregate);
    boolean existsById(ID id);
}
```

Dengan ini, Anda tidak otomatis memberi semua module kemampuan `findAll()` atau `deleteAll()`.

---

## 5. Dari Interface Menjadi Proxy

Ketika Anda menulis:

```java
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);
}
```

Anda tidak menulis implementasi. Spring Data membuat proxy runtime.

Pipeline konseptual:

```text
@EnableJpaRepositories / Boot auto-config
      |
      v
Scan repository interfaces
      |
      v
Build RepositoryMetadata
      |
      v
Create RepositoryFactoryBean
      |
      v
Create RepositoryFactory
      |
      v
Resolve base implementation
      |
      v
Resolve query methods
      |
      v
Compose custom fragments
      |
      v
Create proxy
      |
      v
Register repository bean in ApplicationContext
```

Runtime repository bean adalah proxy yang melakukan dispatch method.

Saat method dipanggil:

```text
repository.findByEmail("a@example.com")
      |
      v
Repository Proxy
      |
      +-- Is this method from Object? toString/equals/hashCode
      +-- Is this default method?
      +-- Is this custom fragment method?
      +-- Is this base repository method?
      +-- Is this query method?
      |
      v
Execute resolved implementation
```

Konsekuensi:

- Repository juga bagian dari AOP/proxy world.
- Transaction annotation pada repository bisa ikut bekerja.
- Exception translation bisa dipasang via proxy.
- Custom implementation harus cocok dengan fragment composition rule.
- Method ambiguity dapat menghasilkan behavior yang tidak diharapkan.

---

## 6. Repository Factory dan Store-Specific Adapter

Spring Data Commons menyediakan fondasi umum. Masing-masing module store menyediakan factory khusus:

```text
Spring Data Commons
      |
      +-- Spring Data JPA
      +-- Spring Data JDBC
      +-- Spring Data MongoDB
      +-- Spring Data Redis
      +-- Spring Data Elasticsearch
      +-- Spring Data Cassandra
      +-- etc.
```

Untuk JPA, ada `JpaRepositoryFactory`.

Untuk Mongo, ada factory berbeda.

Untuk JDBC, ada factory berbeda.

Interface repository terlihat mirip, tetapi backend semantics berbeda.

Contoh:

```java
interface OrderRepository extends CrudRepository<Order, OrderId> {
    List<Order> findByStatus(OrderStatus status);
}
```

Di JPA:

- Entity managed dalam persistence context.
- Lazy loading mungkin terjadi.
- Dirty checking mungkin terjadi.
- Transaction boundary sangat penting.

Di JDBC:

- Tidak ada persistence context.
- Aggregate mapping lebih eksplisit.
- Tidak ada lazy loading ORM style.

Di Mongo:

- Query document-oriented.
- Transaction tidak sama dengan relational default.
- Schema flexibility berbeda.

Jadi abstraction-nya bukan berarti interchangeable tanpa konsekuensi.

---

## 7. Query Method Parsing

Spring Data dapat membangun query dari nama method.

Contoh:

```java
List<ApplicationRecord> findTop20ByStatusAndCreatedAtBeforeOrderByCreatedAtAsc(
    ApplicationStatus status,
    Instant cutoff
);
```

Method name dipecah menjadi:

```text
findTop20
By
Status
And
CreatedAt
Before
OrderBy
CreatedAt
Asc
```

Secara konseptual:

```text
Method Signature
      |
      v
PartTree Parser
      |
      v
Property Path Resolution
      |
      v
Query Derivation Strategy
      |
      v
Store-specific Query Creation
```

Kelebihan:

- Cepat untuk query sederhana.
- Mudah dibaca untuk 1–2 predicate.
- Mengurangi boilerplate.

Risiko:

- Nama method menjadi sangat panjang.
- Query tersembunyi di nama.
- Tidak semua optimization terlihat.
- Refactor property bisa berdampak runtime/startup.
- Query kompleks sulit dikontrol.
- Bisa menghasilkan query yang valid tapi buruk performanya.

Heuristic:

```text
findById                                  -> OK
findByEmail                               -> OK
findByStatusAndType                       -> OK
findTop20ByStatusOrderByCreatedAtDesc     -> OK
findByAAndBOrCAndDAndEOrderByX            -> mulai bau
findComplexWorkflowEligibility...         -> jangan; gunakan explicit query/specification/query object
```

---

## 8. Query Lookup Strategy

Spring Data mengenal beberapa pendekatan pencarian query:

1. Declared query.
2. Derived query.
3. Named query.
4. Store-specific query.

Secara konseptual:

```text
Repository method
      |
      +-- Ada declared query?
      |       -> pakai itu
      |
      +-- Ada named query?
      |       -> pakai itu
      |
      +-- Bisa derive dari method name?
              -> parse dan create query
```

Untuk JPA:

```java
@Query("""
    select c
    from CaseRecord c
    where c.status = :status
      and c.createdAt < :cutoff
    order by c.createdAt asc
""")
List<CaseRecord> findPendingBefore(
    @Param("status") CaseStatus status,
    @Param("cutoff") Instant cutoff
);
```

Gunakan explicit query saat:

- Query punya join penting.
- Query butuh projection.
- Query butuh fetch plan.
- Query punya business predicate kompleks.
- Query perlu dibaca oleh reviewer.
- Query performance critical.
- Query perlu hint/lock.
- Query harus stabil untuk audit/regulatory reasoning.

---

## 9. Property Path Resolution dan Ambiguity

Spring Data derived query perlu memetakan potongan nama method ke property entity.

Contoh:

```java
findByCustomerAddressPostalCode(String postalCode)
```

Bisa berarti:

```text
customer.address.postalCode
```

Tetapi kalau entity punya property ambigu, parsing bisa membingungkan.

Contoh model:

```java
class Order {
    Customer customer;
    String customerAddressPostalCode;
}
```

Method:

```java
findByCustomerAddressPostalCode(...)
```

Bisa ambigu secara konseptual. Spring Data punya rule parsing, tetapi desain model seperti ini rawan.

Guideline:

- Hindari nama property yang saling overlap terlalu panjang.
- Untuk nested path kompleks, pertimbangkan explicit `@Query`.
- Untuk query penting, jangan bergantung pada tebak-tebakan parser.
- Review generated query/log SQL.

---

## 10. Repository Method Return Types

Return type mempengaruhi semantic.

Contoh umum:

```java
Optional<User> findByEmail(String email);
List<User> findByStatus(Status status);
Page<User> findByStatus(Status status, Pageable pageable);
Slice<User> findByStatus(Status status, Pageable pageable);
Stream<User> streamByStatus(Status status);
boolean existsByEmail(String email);
long countByStatus(Status status);
```

### 10.1 `Optional<T>`

Cocok untuk single result yang boleh tidak ada.

```java
Optional<CaseRecord> findByReferenceNo(String referenceNo);
```

Tetapi hati-hati: kalau query ternyata mengembalikan lebih dari satu row, akan error. Untuk unique lookup, pastikan database constraint ada.

Rule:

```text
Optional<T> tanpa unique constraint = semantic bohong.
```

### 10.2 `List<T>`

Cocok untuk bounded result.

Jangan pakai `List<T>` untuk kemungkinan data besar tanpa limit/paging.

Buruk:

```java
List<AuditTrail> findByModule(String module);
```

Lebih aman:

```java
Page<AuditTrailSummary> findByModule(String module, Pageable pageable);
```

### 10.3 `Page<T>`

`Page` membawa total count. Ini biasanya memicu query count tambahan.

Cocok jika UI butuh total page.

### 10.4 `Slice<T>`

`Slice` hanya tahu apakah ada next page, tanpa total count penuh.

Cocok untuk infinite scroll atau batch scanning ringan.

### 10.5 `Stream<T>`

Bisa menghemat memory, tetapi harus dikelola dalam transaction/resource scope.

```java
@Transactional(readOnly = true)
public void export() {
    try (Stream<AuditTrail> stream = repository.streamByCreatedAtBefore(cutoff)) {
        stream.forEach(writer::write);
    }
}
```

Risiko:

- Connection terbuka selama stream.
- Transaction panjang.
- Lazy loading.
- Memory/resource leak kalau stream tidak ditutup.
- Tidak cocok untuk external slow sink tanpa backpressure.

---

## 11. Pagination and Sorting

Spring Data menyediakan:

```java
Pageable pageable = PageRequest.of(0, 50, Sort.by("createdAt").descending());
```

Repository:

```java
Page<CaseRecord> findByStatus(CaseStatus status, Pageable pageable);
```

Mental model:

```text
Page request
      |
      +-- content query with limit/offset
      +-- count query
      |
      v
Page object
```

Kritik penting:

Offset pagination tidak selalu cocok untuk data besar.

Masalah offset:

```text
page 10000, size 50
```

Database mungkin tetap harus melewati banyak row.

Untuk high-volume table, pertimbangkan keyset pagination:

```sql
where created_at < :lastSeenCreatedAt
order by created_at desc
limit 50
```

Spring Data tidak otomatis membuat semua pagination optimal. Ia hanya menyediakan abstraction.

Guideline:

- UI admin kecil: `Page` cukup.
- Audit trail besar: gunakan projection + keyset/cursor.
- Export besar: jangan pakai offset page naïf.
- Search result besar: pakai search engine atau dedicated read model.
- Jangan expose arbitrary sort field tanpa whitelist.

Security/correctness risk:

```java
Sort.by(userInput)
```

Kalau user bebas mengirim sort property, bisa:

- Membuka internal field.
- Membuat query mahal.
- Menghasilkan error property.
- Menjadi vector denial-of-service ringan.

Gunakan whitelist:

```java
enum CaseSortField {
    CREATED_AT("createdAt"),
    REFERENCE_NO("referenceNo");

    private final String property;
}
```

---

## 12. Projection

Projection membantu menghindari load entity penuh.

Jenis:

1. Interface projection.
2. Class/DTO projection.
3. Record projection.
4. Dynamic projection.
5. Open projection.

Contoh interface projection:

```java
public interface CaseSummaryView {
    UUID getId();
    String getReferenceNo();
    CaseStatus getStatus();
    Instant getCreatedAt();
}
```

Repository:

```java
Page<CaseSummaryView> findByStatus(CaseStatus status, Pageable pageable);
```

Kelebihan:

- Mengurangi data yang dibawa.
- Cocok untuk list view.
- Menghindari expose entity ke API.

Risiko:

- Projection nested bisa memicu query tambahan.
- Open projection dengan expression bisa lebih mahal.
- Projection interface bisa menyembunyikan query complexity.

DTO projection:

```java
public record CaseSummaryDto(
    UUID id,
    String referenceNo,
    CaseStatus status,
    Instant createdAt
) {}
```

Untuk sistem besar, projection sering lebih baik daripada entity di read-side.

Guideline:

```text
Command use case       -> aggregate/entity jika perlu behavior.
List/search/read model -> projection.
External API response  -> DTO, bukan entity.
```

---

## 13. Specifications, Query by Example, QueryDSL, Criteria

Spring Data menyediakan beberapa cara untuk dynamic query.

### 13.1 Specification

Specification cocok saat predicate perlu dikomposisi.

```java
public final class CaseSpecifications {
    public static Specification<CaseRecord> hasStatus(CaseStatus status) {
        return (root, query, cb) -> cb.equal(root.get("status"), status);
    }

    public static Specification<CaseRecord> createdBefore(Instant cutoff) {
        return (root, query, cb) -> cb.lessThan(root.get("createdAt"), cutoff);
    }
}
```

Pemakaian:

```java
Specification<CaseRecord> spec = Specification
    .where(hasStatus(PENDING))
    .and(createdBefore(cutoff));
```

Kelebihan:

- Predicate reusable.
- Cocok untuk filter UI.
- Lebih eksplisit daripada method name panjang.

Risiko:

- String property rawan refactor.
- Criteria API verbose.
- Mudah membuat query tidak optimal.
- Join/fetch/count query bisa tricky.

### 13.2 Query by Example

Cocok untuk simple matching.

Tidak cocok untuk query kompleks dengan range, OR kompleks, join, business predicate.

### 13.3 QueryDSL

Lebih type-safe, tetapi menambah build/codegen complexity.

### 13.4 Explicit Query Object

Untuk enterprise system, sering lebih maintainable membuat query object sendiri:

```java
public record CaseSearchCriteria(
    Optional<CaseStatus> status,
    Optional<OfficerId> assignedOfficer,
    Optional<Instant> createdFrom,
    Optional<Instant> createdTo,
    int pageSize
) {}
```

Lalu implementasi custom repository mengubah criteria menjadi query.

---

## 14. Custom Repository Fragments

Repository fragment adalah cara Spring Data menyusun repository dari beberapa implementasi.

Contoh:

```java
public interface CaseRepository
        extends JpaRepository<CaseRecord, UUID>,
                CaseSearchRepository,
                CaseLockingRepository {
}
```

Fragment interface:

```java
public interface CaseSearchRepository {
    Page<CaseSummaryView> search(CaseSearchCriteria criteria, Pageable pageable);
}
```

Implementasi:

```java
class CaseSearchRepositoryImpl implements CaseSearchRepository {
    private final EntityManager entityManager;

    CaseSearchRepositoryImpl(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Page<CaseSummaryView> search(CaseSearchCriteria criteria, Pageable pageable) {
        // custom query implementation
        throw new UnsupportedOperationException("Example only");
    }
}
```

Fragment berguna saat:

- Query terlalu kompleks untuk derived method.
- Butuh Criteria/QueryDSL/native SQL.
- Butuh locking.
- Butuh bulk update.
- Butuh tenant predicate enforcement.
- Butuh query optimized khusus.

Kelebihan fragment:

- Repository tetap cohesive.
- Custom logic bisa dipisah.
- Tidak semua harus masuk service.
- Bisa test lebih spesifik.

Risiko:

- Naming convention salah membuat fragment tidak terdeteksi.
- Fragment terlalu besar menjadi DAO lama.
- Fragment memanggil repository yang sama dan menyebabkan cycle.
- Fragment mencampur domain logic dan query logic.

Guideline:

```text
Fragment = persistence-specific custom operation.
Service  = orchestration/use-case/business boundary.
```

---

## 15. Default Methods in Repository Interface

Repository interface dapat punya default method:

```java
public interface CaseRepository extends JpaRepository<CaseRecord, UUID> {
    Optional<CaseRecord> findByReferenceNo(String referenceNo);

    default CaseRecord getRequiredByReferenceNo(String referenceNo) {
        return findByReferenceNo(referenceNo)
            .orElseThrow(() -> new CaseNotFoundException(referenceNo));
    }
}
```

Ini bisa berguna untuk helper kecil.

Tetapi jangan letakkan orchestration besar di default method.

Masalah default method:

- Tidak ideal untuk transaction boundary kompleks.
- Sulit inject dependency tambahan.
- Bisa menyembunyikan business logic di repository.
- Kurang jelas dalam architecture review.

Rule praktis:

```text
Default method kecil untuk convenience -> boleh.
Use-case logic / policy / workflow     -> jangan.
```

---

## 16. Transaction Semantics di Repository

Spring Data repository sering diberi transaction default.

Tetapi transaction boundary utama sebaiknya ada di application service.

Buruk:

```java
controller -> repository.save()
controller -> externalApi.call()
controller -> repository.save()
```

Lebih baik:

```java
@Service
public class ApplicationApprovalService {
    @Transactional
    public void approve(ApplicationId id) {
        Application app = repository.getRequired(id);
        app.approve();
        outbox.record(ApplicationApproved.of(id));
    }
}
```

Repository transaction cocok untuk:

- Simple CRUD operation.
- Read-only query default.
- Base repository method.

Application service transaction cocok untuk:

- Multi-step use case.
- Domain state transition.
- Multiple repository calls.
- Outbox creation.
- Consistency boundary.
- Authorization + mutation.

Key principle:

```text
Repository knows how to persist.
Service knows what must be consistent.
```

---

## 17. Read-Only Query Semantics

Read-only transaction tidak berarti database selalu mencegah write. Behavior tergantung transaction manager, database, provider.

Tetapi read-only berguna sebagai signal:

- Untuk Spring transaction infrastructure.
- Untuk provider optimization.
- Untuk reviewer.
- Untuk routing read replica, jika didesain.
- Untuk preventing accidental dirty checking flush dalam beberapa setup.

Pattern:

```java
@Transactional(readOnly = true)
public Page<CaseSummaryView> search(CaseSearchCriteria criteria, Pageable pageable) {
    return repository.search(criteria, pageable);
}
```

Jangan anggap `readOnly = true` sebagai security boundary. Ia bukan authorization.

---

## 18. Exception Translation

Spring punya hierarchy `DataAccessException` untuk menyatukan berbagai exception persistence.

`@Repository` bukan sekadar stereotype. Pada konfigurasi yang sesuai, Spring dapat menerapkan persistence exception translation ke bean repository/DAO.

Mental model:

```text
Native persistence exception
      |
      v
PersistenceExceptionTranslator
      |
      v
Spring DataAccessException
```

Contoh native:

- `jakarta.persistence.PersistenceException`
- Hibernate exception
- JDBC SQL exception
- Mongo exception
- Store-specific exception

Diterjemahkan menjadi kategori seperti:

- `DataIntegrityViolationException`
- `DuplicateKeyException`
- `OptimisticLockingFailureException`
- `CannotAcquireLockException`
- `QueryTimeoutException`
- `TransientDataAccessResourceException`

Kenapa penting?

Application service tidak perlu bergantung langsung pada exception provider tertentu.

Tetapi jangan asal menangkap `DataAccessException` dan mengubah semua menjadi HTTP 500.

Mapping harus semantic:

```text
Duplicate key                 -> conflict / duplicate business identity
Optimistic locking failure    -> conflict / stale version
Cannot acquire lock           -> retryable or conflict depending use case
Timeout                       -> retryable infrastructure failure
Data integrity violation      -> bug, invalid state, or concurrent write
```

Contoh handling:

```java
try {
    repository.save(record);
} catch (DataIntegrityViolationException ex) {
    throw new DuplicateReferenceNoException(record.referenceNo(), ex);
}
```

Yang buruk:

```java
catch (Exception ex) {
    throw new RuntimeException("DB error");
}
```

---

## 19. Auditing

Spring Data auditing memberi hook untuk field seperti:

- created by
- created date
- last modified by
- last modified date

Contoh:

```java
@Entity
@EntityListeners(AuditingEntityListener.class)
class CaseRecord {
    @CreatedDate
    private Instant createdAt;

    @LastModifiedDate
    private Instant updatedAt;

    @CreatedBy
    private String createdBy;

    @LastModifiedBy
    private String updatedBy;
}
```

Auditor provider:

```java
@Bean
AuditorAware<String> auditorAware() {
    return () -> Optional.ofNullable(SecurityContextHolder.getContext())
        .map(SecurityContext::getAuthentication)
        .filter(Authentication::isAuthenticated)
        .map(Authentication::getName);
}
```

Risiko auditing:

1. System job tidak punya user context.
2. Async thread kehilangan security context.
3. Message listener tidak punya HTTP request.
4. Batch migration harus menulis audit berbeda.
5. `createdBy` dari user input adalah security bug.
6. Time source tidak konsisten.
7. Audit field entity bukan pengganti audit trail.

Distinguish:

```text
Entity audit fields:
- createdAt
- updatedAt
- createdBy
- updatedBy

Audit trail:
- who did what
- old value/new value
- reason
- module
- channel
- correlation id
- request metadata
- regulatory evidence
```

Jangan menganggap auditing field cukup untuk sistem regulatory.

---

## 20. Domain Events in Spring Data

Spring Data mendukung publication domain event dari aggregate root.

Konsep:

```java
public class CaseRecord extends AbstractAggregateRoot<CaseRecord> {
    public void approve(OfficerId officerId) {
        this.status = CaseStatus.APPROVED;
        registerEvent(new CaseApprovedEvent(this.id, officerId));
    }
}
```

Ketika repository `save` dipanggil, event bisa dipublish melalui Spring application event mechanism.

Mental model:

```text
Aggregate mutates
      |
      v
Aggregate records domain event
      |
      v
Repository save
      |
      v
Spring Data detects domain events
      |
      v
ApplicationEventPublisher publishes event
      |
      v
Listener handles event
```

Important boundary:

- Domain event bukan otomatis integration event.
- Listener synchronous bisa ikut transaction call stack.
- Untuk side effect eksternal, gunakan transactional event listener atau outbox.
- Jangan call external API langsung dari domain event listener sebelum commit kalau hasilnya harus konsisten dengan DB.

Better:

```java
@Component
class CaseApprovedListener {
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(CaseApprovedEvent event) {
        // publish notification command, enqueue integration event, etc.
    }
}
```

Untuk reliability tinggi:

```text
Domain event -> Outbox row in same transaction -> publisher job -> broker
```

Spring Data domain event berguna, tetapi bukan message broker dan bukan durable event store.

---

## 21. Multiple Datastores

Spring Data memudahkan berbagai store, tetapi multi-store architecture harus disiplin.

Contoh:

```text
PostgreSQL/JPA     -> write model
Elasticsearch      -> search projection
Redis              -> cache/session/rate limit
MongoDB            -> document read model
```

Risiko:

- Repository interface mirip membuat engineer lupa semantic berbeda.
- Transaction tidak otomatis lintas store.
- Consistency eventual harus didesain.
- Error handling berbeda.
- Observability harus store-aware.
- Testing harus mencakup sync/lag/rebuild.

Boundary sehat:

```text
Write model repository   -> transactional source of truth
Read model repository    -> query optimization/projection
Cache repository         -> performance, not source of truth
Search repository        -> discoverability, not consistency authority
```

Anti-pattern:

```text
"Save to DB, save to Elasticsearch, save to Redis" in same service method
without outbox, retry, compensation, or reconciliation.
```

Lebih baik:

```text
DB transaction commits outbox event.
Projector updates search/cache/read model asynchronously.
Reconciliation job repairs drift.
```

---

## 22. Spring Data JDBC vs JPA as Architectural Choice

Tanpa mengulang JPA, kita perlu tahu posisi Spring Data JDBC.

Spring Data JPA cocok saat:

- Butuh ORM mature.
- Relationship kompleks.
- Persistence context berguna.
- Legacy JPA ecosystem.
- Query JPQL/Criteria dibutuhkan.
- Entity lifecycle callback sudah established.

Spring Data JDBC cocok saat:

- Aggregate lebih eksplisit.
- Tidak ingin persistence context.
- Query/load lebih langsung.
- Domain model sederhana-menengah.
- Ingin behavior lebih dekat ke SQL.
- Tidak butuh lazy loading ORM.

Trade-off:

```text
JPA:
+ rich ORM capability
+ mature ecosystem
+ lazy loading, dirty checking
- hidden query/fetch complexity
- persistence context mental overhead
- accidental N+1

JDBC:
+ simpler runtime model
+ explicit aggregate persistence
+ fewer ORM surprises
- less magic relationship handling
- more manual query design
- different aggregate constraints
```

Spring Data tidak menghapus kebutuhan memilih persistence model sesuai domain.

---

## 23. Reactive Repositories

Spring Data juga punya reactive repositories untuk store yang mendukung reactive driver.

Contoh:

```java
interface CaseReactiveRepository extends ReactiveCrudRepository<CaseDocument, String> {
    Flux<CaseDocument> findByStatus(CaseStatus status);
}
```

Jangan memakai reactive repository hanya karena “modern”.

Reactive stack cocok jika:

- Driver benar-benar non-blocking.
- End-to-end path reactive.
- Workload IO-bound high concurrency.
- Tim memahami Reactor/backpressure.
- Observability/context propagation siap.

Tidak cocok jika:

- Database driver blocking.
- Code banyak memanggil blocking library.
- Tim menulis `.block()` di mana-mana.
- Simpler MVC + virtual thread cukup.
- Transaction semantics reactive tidak dipahami.

Rule:

```text
Reactive repository in blocking MVC service is often complexity leak.
Blocking repository inside WebFlux event loop is production risk.
```

---

## 24. Repository as Boundary for Authorization and Tenancy

Salah satu risiko besar: repository query lupa tenant/security predicate.

Contoh buruk:

```java
Optional<CaseRecord> findById(UUID id);
```

Di multi-tenant system, ini rawan jika service lupa check tenant.

Lebih aman:

```java
Optional<CaseRecord> findByIdAndTenantId(UUID id, TenantId tenantId);
```

Atau di adapter:

```java
public Optional<CaseRecord> findVisibleCase(CaseId id, UserContext user) {
    return repository.findByIdAndTenantIdAndAgencyId(
        id.value(),
        user.tenantId().value(),
        user.agencyId().value()
    );
}
```

Untuk authorization kompleks:

```text
Do not rely only on "load then check".
Prefer:
- query-level restriction for list/search
- object-level check for detail/mutation
- database constraint / RLS when appropriate
- audit unauthorized attempts
```

Spring Data repository tidak otomatis tahu boundary authorization Anda.

---

## 25. Soft Delete

Soft delete sering muncul di enterprise app.

Naïve:

```java
record.setDeleted(true);
repository.save(record);
```

Risiko:

- Query lupa filter deleted.
- Unique constraint jadi rumit.
- Audit/history tidak jelas.
- Relationship ke deleted row.
- Restore behavior tidak jelas.
- Data retention/legal hold conflict.

Dengan Spring Data, Anda bisa membuat convention:

```java
interface ActiveCaseRepository extends Repository<CaseRecord, UUID> {
    Optional<CaseRecord> findByIdAndDeletedFalse(UUID id);
    Page<CaseRecord> findByDeletedFalse(Pageable pageable);
}
```

Tetapi untuk sistem besar, sebaiknya soft delete menjadi platform-level policy:

```text
- naming convention
- repository base class
- specifications
- database partial indexes
- service invariant
- test fixtures
- query review
```

Jangan menyebar `DeletedFalse` secara manual tanpa governance.

---

## 26. Optimistic Locking Integration

Spring Data akan melewatkan optimistic locking exception dari provider/store dan dapat menerjemahkannya menjadi Spring exception.

Pattern use case:

```java
@Transactional
public void approve(CaseId id, long expectedVersion) {
    CaseRecord record = repository.findById(id.value())
        .orElseThrow(() -> new CaseNotFoundException(id));

    record.assertVersion(expectedVersion);
    record.approve();
}
```

Atau gunakan version field di entity dan biarkan provider mendeteksi conflict.

API layer harus mengubah conflict menjadi semantic response:

```text
HTTP 409 Conflict
message: "Case was modified by another user. Please refresh."
```

Jangan treat optimistic lock sebagai random 500.

For workflow/case systems:

- Version conflict adalah domain-relevant.
- Bisa berarti stale screen.
- Bisa berarti concurrent officer action.
- Bisa berarti duplicated approval.
- Bisa berarti state transition race.

Repository exception harus diterjemahkan ke use-case error.

---

## 27. Bulk Operations

Spring Data menyediakan beberapa bulk operation, tetapi bulk operation sering melewati lifecycle normal.

Contoh risiko:

```java
@Modifying
@Query("update CaseRecord c set c.status = :status where c.expiredAt < :now")
int expireCases(@Param("status") CaseStatus status, @Param("now") Instant now);
```

Masalah potensial:

- Persistence context stale.
- Entity callback tidak terpanggil.
- Domain invariant dilewati.
- Audit field tidak otomatis.
- Domain event tidak muncul.
- Cache stale.
- Search/read model tidak update.
- Authorization/tenant predicate lupa.

Bulk operation boleh, tapi harus dianggap sebagai **data operation**, bukan domain operation biasa.

Checklist bulk update:

```text
[ ] Tenant predicate ada?
[ ] Soft delete predicate ada?
[ ] Audit requirement terpenuhi?
[ ] Entity callback tidak dibutuhkan?
[ ] Domain event/outbox perlu dibuat?
[ ] Cache invalidation?
[ ] Persistence context clear?
[ ] Row count expected?
[ ] Idempotent untuk retry?
[ ] Monitoring/reporting?
```

---

## 28. Repository Anti-Patterns

### 28.1 Fat Repository

```java
interface CaseRepository extends JpaRepository<CaseRecord, UUID> {
    // 200 methods
}
```

Gejala:

- Semua query dimasukkan ke satu interface.
- Naming method sangat panjang.
- Tidak ada ownership.
- Sulit review.
- Banyak module bergantung ke repository yang sama.

Solusi:

- Pisah read repository.
- Gunakan fragments.
- Gunakan query service.
- Bungkus dengan port/adapter.
- Buat module boundary.

### 28.2 Repository Mengandung Business Workflow

Buruk:

```java
void approveAndNotifyAndEscalate(UUID id);
```

Repository harus persist/query, bukan orchestrate workflow.

### 28.3 Entity Leakage ke API

Buruk:

```java
@GetMapping("/cases")
Page<CaseRecord> list() {
    return repository.findAll(pageable);
}
```

Risiko:

- Lazy loading.
- Sensitive field leak.
- API contract bergantung entity.
- Serialization cycle.
- Over-fetching.
- Breaking change saat schema berubah.

Gunakan DTO/projection.

### 28.4 Query Method Explosion

Banyak kombinasi filter dibuat method sendiri:

```java
findByStatus(...)
findByStatusAndOfficer(...)
findByStatusAndOfficerAndCreatedAtBetween(...)
findByStatusAndOfficerAndCreatedAtBetweenAndPriority(...)
```

Solusi:

- Specification.
- Criteria object.
- QueryDSL.
- Custom repository.
- Search service.

### 28.5 Repository sebagai Global Data Access Shortcut

Kalau semua service bisa inject semua repository, module boundary hilang.

Gunakan package visibility, ArchUnit, module API, atau Spring Modulith verification.

---

## 29. Designing Repository for Case Management / Regulatory System

Untuk sistem enforcement/case management, repository harus mendukung:

- State transition consistency.
- Officer assignment.
- Access control.
- Escalation.
- Auditability.
- SLA.
- Search/listing.
- Reporting.
- Immutable evidence.
- Document relationship.
- Event/outbox.
- Multi-agency/multi-role visibility.

Pisahkan repository berdasarkan use case:

```text
CaseCommandRepository
- findByIdForUpdate
- save

CaseQueryRepository
- search
- findSummary
- findTimeline

CaseAssignmentRepository
- findAssignableCases
- findByOfficer

CaseSlaRepository
- findBreachedSlaCandidates

CaseAuditRepository
- appendAuditEntry
- findAuditTrail
```

Tidak semua harus Spring Data interface langsung. Bisa berupa port dengan Spring Data adapter.

Contoh:

```java
public interface CaseCommandPort {
    Optional<CaseAggregate> findForDecision(CaseId id, DecisionActor actor);
    void save(CaseAggregate aggregate);
}
```

Adapter:

```java
@Repository
class SpringDataCaseCommandAdapter implements CaseCommandPort {
    private final CaseJpaRepository repository;

    @Override
    public Optional<CaseAggregate> findForDecision(CaseId id, DecisionActor actor) {
        return repository.findByIdAndTenantAndAllowedAgency(
            id.value(),
            actor.tenantId().value(),
            actor.agencyId().value()
        );
    }

    @Override
    public void save(CaseAggregate aggregate) {
        repository.save(aggregate);
    }
}
```

Ini membuat authorization/tenancy menjadi bagian dari persistence boundary, bukan optional check.

---

## 30. Testing Spring Data

Testing Spring Data harus sesuai risiko.

### 30.1 Repository Slice Test

```java
@DataJpaTest
class CaseRepositoryTest {
    @Autowired
    CaseRepository repository;

    @Test
    void finds_case_by_reference_no() {
        // arrange
        // act
        // assert
    }
}
```

Cocok untuk:

- Query method.
- `@Query`.
- Mapping.
- Constraint.
- Repository fragment.
- Auditing integration ringan.

### 30.2 Testcontainers

Untuk query yang bergantung pada database nyata, H2 sering tidak cukup.

Gunakan database yang sama dengan production jika:

- SQL dialect penting.
- JSON/array/fulltext digunakan.
- Locking behavior penting.
- Constraint/index behavior penting.
- Pagination performance penting.
- Native query penting.

### 30.3 ApplicationContextRunner untuk Auto-Config/Starter

Jika membuat internal starter repository, test auto-configuration.

### 30.4 Contract Test untuk Repository Port

Jika repository dibungkus port, test contract:

```text
Given existing case
When findVisibleCase called by same tenant
Then case returned

Given existing case from other tenant
When findVisibleCase called
Then empty
```

Testing repository bukan hanya “query returns data”, tetapi “boundary invariant enforced”.

---

## 31. Observability for Spring Data

Data access harus observable.

Minimal:

- Query latency.
- Slow query log.
- Connection pool metrics.
- Transaction duration.
- Error type.
- Repository operation name.
- Row count untuk batch.
- Retry count.
- Lock wait/timeout.
- Optimistic lock conflict count.
- Deadlock count.
- Cache hit/miss jika cache terlibat.

Di Spring Boot, sebagian metric bisa datang dari:

- DataSource metrics.
- HikariCP metrics.
- Hibernate metrics jika enabled.
- Micrometer.
- Custom timer around repository/service.

Jangan membuat metric dengan tag cardinality tinggi:

Buruk:

```text
repository_method=findByReferenceNo
reference_no=CASE-2026-000123
```

Baik:

```text
repository=case
operation=find_by_reference
result=found/not_found/error
```

Untuk audit/regulatory system, observability perlu menjawab:

```text
Apakah query lambat karena data volume?
Apakah connection pool exhausted?
Apakah lock conflict naik?
Apakah batch job menyebabkan pressure?
Apakah search endpoint melakukan full scan?
Apakah tenant tertentu menghasilkan load abnormal?
```

---

## 32. Performance Heuristics

Spring Data performance bukan hanya framework overhead. Biasanya bottleneck di:

- Query design.
- Index.
- Fetch plan.
- Serialization.
- Transaction duration.
- Connection pool.
- N+1.
- Large result set.
- Count query.
- Locking.
- Cache invalidation.
- Projection choice.

Checklist:

```text
[ ] Apakah query bounded?
[ ] Apakah ada index sesuai predicate + sort?
[ ] Apakah return entity atau projection?
[ ] Apakah Page count query mahal?
[ ] Apakah query list endpoint bisa keyset pagination?
[ ] Apakah relationship lazy/eager aman?
[ ] Apakah transaction terlalu panjang?
[ ] Apakah query dipanggil dalam loop?
[ ] Apakah repository dipanggil dari event listener sync?
[ ] Apakah external API dipanggil saat connection DB masih terbuka?
```

Common smell:

```java
for (UUID id : ids) {
    repository.findById(id);
}
```

Better:

```java
repository.findAllById(ids);
```

Tetapi `findAllById` juga perlu diperiksa order, size, dan DB parameter limit.

---

## 33. Java 8 sampai Java 25 Considerations

### 33.1 Java 8 Era

- Spring Framework 5.x / Boot 2.x masih relevan untuk legacy.
- `javax.persistence`.
- Tidak ada record.
- Optional sudah ada.
- Stream ada, tetapi hati-hati dengan repository stream resource.
- Lombok sering dipakai untuk DTO/entity.

### 33.2 Java 11–17 Transition

- Java 17 menjadi baseline penting untuk Spring Framework 6 / Boot 3.
- `jakarta.persistence`.
- Records mulai cocok untuk DTO/projection.
- Stronger encapsulation/module considerations.
- Dependency upgrade besar.

### 33.3 Java 21–25 Modern

- Virtual threads mengubah cost model blocking call, tetapi connection pool tetap bottleneck.
- Records sangat cocok untuk query DTO.
- Pattern matching bisa membantu mapper/service logic.
- Sequenced collections tidak langsung mengubah repository, tetapi dapat membantu API design.
- Structured concurrency bukan pengganti transaction boundary.
- Spring Boot 4/Spring Framework 7 berjalan di era Java 17+ dan mendukung Java 25.

Spring Data design tidak boleh hanya mengikuti fitur Java terbaru. Yang lebih penting:

```text
Use modern Java to make boundary clearer,
not to hide persistence semantics.
```

---

## 34. Review Rubric untuk Repository PR

Gunakan checklist ini saat review PR.

### 34.1 Correctness

```text
[ ] Query sesuai business invariant?
[ ] Unique lookup punya unique constraint?
[ ] Tenant/security predicate ada?
[ ] Soft delete predicate ada?
[ ] Transaction boundary di service benar?
[ ] Exception diterjemahkan ke domain/application error?
[ ] Optimistic lock conflict ditangani?
```

### 34.2 Performance

```text
[ ] Query bounded?
[ ] Pagination/keyset sesuai volume?
[ ] Projection dipakai untuk listing?
[ ] Count query tidak terlalu mahal?
[ ] Tidak ada repository call dalam loop?
[ ] Index mendukung predicate/sort?
[ ] Tidak expose arbitrary sort?
```

### 34.3 Architecture

```text
[ ] Repository tidak berisi workflow logic?
[ ] Entity tidak bocor ke API?
[ ] Fragment dipakai untuk query kompleks?
[ ] Module boundary tidak dilanggar?
[ ] Store-specific assumption tidak bocor sembarangan?
```

### 34.4 Operability

```text
[ ] Error bisa didiagnosis?
[ ] Slow query bisa diamati?
[ ] Batch operation punya row count/log?
[ ] Outbox/event consistency jelas?
[ ] Retry/idempotency jelas?
```

---

## 35. Mental Model Final

Spring Data adalah alat produktivitas yang sangat kuat, tetapi bukan pengganti pemikiran persistence.

Mental model yang harus dibawa:

```text
Repository interface is not implementation.
It is a contract consumed by a proxy factory.

Query method is not just a name.
It is a query generation instruction.

Projection is not just DTO convenience.
It is a performance and boundary tool.

Page is not just pagination.
It may include expensive count semantics.

Optional is not just null-safety.
It implies single-result semantic and should match constraints.

Repository is not a domain service.
It is persistence boundary.

Spring Data abstraction is not storage equivalence.
Each store keeps its own consistency, transaction, and performance model.
```

Engineer level biasa tahu:

```text
extends JpaRepository
findByX
@Query
Pageable
```

Engineer level kuat tahu:

```text
repository proxy composition
query lookup strategy
fragment dispatch
transaction boundary
exception translation
projection cost
tenant predicate enforcement
domain event/outbox boundary
pagination failure mode
test slice correctness
observability and production diagnostics
```

Top-tier Spring engineer tahu kapan Spring Data mempercepat delivery, dan kapan abstraction harus dibatasi agar sistem tetap benar.

---

## 36. Latihan Praktis

### Latihan 1 — Repository Boundary Review

Ambil satu repository existing. Klasifikasikan method-nya:

```text
CRUD
single lookup
list/search
bulk operation
workflow smell
authorization-sensitive query
tenant-sensitive query
performance-sensitive query
```

Lalu tandai mana yang harus:

- Tetap derived query.
- Jadi `@Query`.
- Jadi fragment.
- Jadi query service.
- Dipindah ke application service.
- Dibungkus port/adapter.

### Latihan 2 — Rewrite Query Method Explosion

Ubah kumpulan method:

```java
findByStatus(...)
findByStatusAndOfficer(...)
findByStatusAndOfficerAndPriority(...)
findByStatusAndOfficerAndPriorityAndCreatedAtBetween(...)
```

Menjadi:

```java
Page<CaseSummaryView> search(CaseSearchCriteria criteria, Pageable pageable);
```

Implementasikan via Specification atau custom fragment.

### Latihan 3 — Tenant-Safe Repository

Desain repository untuk:

```text
Case can only be visible if:
- same tenant
- same agency, or
- user has cross-agency role
- case not soft-deleted
```

Tentukan mana yang dilakukan di query, mana di authorization service.

### Latihan 4 — Domain Event Boundary

Buat flow:

```text
Case approved
      |
      v
Domain event
      |
      v
Outbox record after same transaction
      |
      v
Publisher sends notification event
```

Jelaskan kenapa tidak langsung call external notification API dari repository save.

### Latihan 5 — Repository Test Strategy

Untuk satu query penting, buat test matrix:

```text
found
not found
wrong tenant
soft deleted
duplicate data
pagination sort
large data
constraint violation
optimistic lock conflict
```

---

## 37. Referensi Resmi

- Spring Data Commons Reference — Repositories: https://docs.spring.io/spring-data/commons/reference/repositories.html
- Spring Data JPA Reference: https://docs.spring.io/spring-data/jpa/reference/
- Spring Data JPA Query Methods: https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html
- Spring Data JPA Custom Repository Implementations: https://docs.spring.io/spring-data/jpa/reference/repositories/custom-implementations.html
- Spring Framework `PersistenceExceptionTranslationPostProcessor`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/dao/annotation/PersistenceExceptionTranslationPostProcessor.html
- Spring Framework Transaction Management: https://docs.spring.io/spring-framework/reference/data-access/transaction.html

---

## 38. Ringkasan Eksekutif

Spring Data harus dilihat sebagai:

```text
Repository abstraction + runtime proxy + query method engine + store adapter + Spring integration.
```

Ia sangat produktif untuk query standar, tetapi bisa menjadi sumber technical debt jika:

- semua query dijadikan method name,
- repository menjadi service,
- entity bocor ke API,
- tenant/security predicate tidak distandarkan,
- pagination tidak disesuaikan volume,
- domain event dianggap durable message,
- exception persistence tidak diterjemahkan ke semantic application error,
- multi-store consistency tidak dirancang.

Part berikutnya akan masuk ke **Spring Web MVC Runtime Internals**, yaitu bagaimana HTTP request diproses oleh `DispatcherServlet`, `HandlerMapping`, `HandlerAdapter`, argument resolver, message converter, validation, exception resolver, dan response handling.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./10-spring-transaction-management-beyond-transactional.md">⬅️ Spring Transaction Management Beyond `@Transactional`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./12-spring-webmvc-runtime-internals.md">Part 12 — Spring Web MVC Runtime Internals ➡️</a>
</div>

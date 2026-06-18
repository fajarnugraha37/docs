# 19 — Repository, DAO, Data Mapper, Unit of Work, Query Object

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Topik: Java Design Pattern dan Anti-Pattern tingkat advance  
> Target: Java 8 sampai Java 25  
> Status: Part 19 dari 35

---

## 0. Peta Besar

Part ini membahas pola-pola desain di sekitar batas persistence:

1. **DAO** — objek yang mengisolasi akses data teknis.
2. **Repository** — koleksi konseptual objek domain.
3. **Data Mapper** — lapisan mapping yang menjaga domain object dan database tetap independen.
4. **Unit of Work** — pengelola perubahan dalam satu boundary konsistensi.
5. **Query Object** — objek eksplisit untuk merepresentasikan query yang kompleks, reusable, dan composable.

Ini bukan materi ulang JPA, Hibernate, MyBatis, JDBC, transaction, atau SQL tuning. Itu sudah dibahas di seri sebelumnya. Fokus di sini adalah pertanyaan desain:

```text
Di mana domain berhenti dan persistence mulai?
Siapa yang boleh tahu query?
Siapa yang boleh tahu schema?
Apakah abstraction ini melindungi domain atau justru menyembunyikan biaya database?
Apakah repository membuat code lebih bersih atau menutupi N+1, transaction leak, dan consistency bug?
```

Seorang engineer senior tidak memakai Repository/DAO karena “best practice”. Ia memakai pola ini karena memahami **boundary, ownership, failure mode, dan cost model**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan DAO, Repository, Data Mapper, Unit of Work, dan Query Object secara tajam.
2. Memutuskan kapan perlu membuat repository abstraction dan kapan cukup memakai ORM/query API langsung.
3. Mendesain persistence boundary yang tidak membocorkan detail database ke domain.
4. Menghindari anti-pattern seperti Generic Repository, leaky ORM abstraction, N+1 hidden behind repository, dan repository dumping ground.
5. Mendesain read model dan write model yang berbeda tanpa overengineering.
6. Menjaga transaction boundary tetap eksplisit.
7. Membuat query object yang composable, testable, dan tidak berubah menjadi “SQL string builder liar”.
8. Memahami relasi antara repository dan Unit of Work dalam konteks JPA/Hibernate, MyBatis, JDBC, dan Java modern.
9. Mendesain contract repository yang mendukung consistency, observability, performance, auditability, dan evolusi sistem.
10. Melakukan refactoring dari persistence layer kacau menuju boundary yang jelas secara bertahap.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan service enterprise seperti ini:

```java
@Service
public class CaseService {
    @Autowired EntityManager em;
    @Autowired JdbcTemplate jdbc;
    @Autowired ExternalApi api;

    @Transactional
    public void approve(Long caseId, String officerId) {
        CaseEntity entity = em.find(CaseEntity.class, caseId);

        List<Object[]> rows = em.createNativeQuery("select * from case_items where case_id = " + caseId)
                .getResultList();

        if (!entity.getStatus().equals("PENDING")) {
            throw new RuntimeException("Invalid status");
        }

        entity.setStatus("APPROVED");
        entity.setApprovedBy(officerId);
        entity.setApprovedAt(LocalDateTime.now());

        jdbc.update("insert into audit_log ...");
        api.notifyApproved(caseId);
    }
}
```

Masalahnya bukan hanya style.

Masalah strukturalnya:

1. Use case tahu terlalu banyak tentang database.
2. Domain logic bercampur dengan query, mutation, audit, dan integration.
3. Query native tidak punya ownership jelas.
4. Tidak jelas apakah `CaseEntity` adalah domain object atau persistence object.
5. Transaction boundary bercampur dengan external call.
6. Error database tidak diterjemahkan ke error domain/application.
7. Tidak ada tempat eksplisit untuk query business seperti “find pending cases nearing SLA breach”.
8. Optimasi query sulit karena semua tersebar.
9. Test menjadi berat karena harus menjalankan database untuk semua skenario.
10. Refactoring schema berisiko karena detail schema menyebar.

Pola-pola di part ini membantu menjawab:

```text
Bagaimana mengisolasi akses data tanpa membuat abstraction palsu?
Bagaimana membuat persistence layer cukup eksplisit sehingga performance dan consistency tetap terlihat?
```

---

## 3. Mental Model Utama

### 3.1 Persistence Boundary Bukan Sekadar “Folder repository”

Persistence boundary adalah kontrak antara:

```text
Application / domain model
        |
        v
Persistence abstraction
        |
        v
Mapping/query/ORM/JDBC/database
```

Boundary yang baik menjawab:

1. Objek apa yang boleh keluar dari persistence layer?
2. Apakah caller boleh tahu schema?
3. Apakah caller boleh tahu ORM lazy loading?
4. Apakah caller boleh menentukan fetch strategy?
5. Apakah caller boleh membuat query arbitrary?
6. Siapa yang mengontrol transaction?
7. Bagaimana error database diterjemahkan?
8. Bagaimana query performance terlihat?
9. Bagaimana authorization dan tenant filtering diterapkan?
10. Bagaimana auditability dijaga?

Folder `repository` tidak otomatis menciptakan boundary. Banyak codebase punya folder repository tetapi tetap bocor total.

---

### 3.2 Persistence Pattern Selalu Berurusan dengan Tiga Model

Biasanya ada tiga model berbeda:

```text
Domain model       : konsep bisnis dan invariant
Persistence model  : bentuk penyimpanan dan mapping database
Query/read model   : bentuk data yang optimal untuk membaca/menampilkan
```

Kadang ketiganya bisa memakai class yang sama. Kadang harus dipisah.

Keputusan senior bukan “selalu pisah” atau “selalu gabung”. Keputusan senior adalah:

```text
Pisahkan model ketika alasan perubahan, lifecycle, performa, dan constraint-nya berbeda.
Gabungkan model ketika pemisahan hanya menghasilkan ceremony tanpa manfaat nyata.
```

---

### 3.3 Repository Harus Terasa Seperti Collection, Bukan SQL Portal

Repository secara konseptual bukan “class tempat semua query ditaruh”. Repository adalah koleksi domain yang bisa ditanya dengan bahasa domain.

Contoh buruk:

```java
interface CaseRepository {
    List<CaseEntity> findByStatusAndCreatedAtLessThanAndOfficerIdAndTypeAndDeletedFalse(
            String status,
            LocalDateTime createdAt,
            String officerId,
            String type
    );
}
```

Contoh lebih baik:

```java
interface CaseRepository {
    Optional<Case> findById(CaseId id);

    List<Case> findCasesRequiringOfficerAttention(
            OfficerId officerId,
            AttentionWindow window
    );
}
```

Yang kedua memakai bahasa domain:

```text
cases requiring officer attention
```

bukan bahasa storage:

```text
status + createdAt + officerId + type + deleted flag
```

---

### 3.4 Query Cost Harus Tetap Terlihat

Abstraksi persistence yang buruk membuat query mahal terlihat murah.

Contoh:

```java
List<Case> cases = repository.findPendingCases();
for (Case c : cases) {
    System.out.println(c.officer().name()); // mungkin N+1
}
```

API tampak sederhana, tetapi bisa menghasilkan:

```text
1 query mengambil cases
N query mengambil officer per case
```

Top engineer tidak hanya bertanya:

```text
Apakah API-nya clean?
```

Tetapi juga:

```text
Apa SQL-nya?
Apa cardinality-nya?
Apa fetch plan-nya?
Apa index yang dipakai?
Apa batas jumlah row?
Apa transaction semantics-nya?
```

---

## 4. Pattern Anatomy

### 4.1 DAO

#### Intent

DAO atau Data Access Object mengisolasi operasi akses data teknis dari layer lain.

DAO biasanya dekat dengan:

1. Table.
2. SQL.
3. JDBC.
4. MyBatis mapper.
5. Stored procedure.
6. Raw persistence object.

#### Bentuk umum

```java
public interface CaseDao {
    CaseRow findById(long id);
    void updateStatus(long id, String status);
    List<CaseRow> findPendingRows(int limit);
}
```

#### Cocok ketika

1. Sistem memakai JDBC/MyBatis/raw SQL.
2. Query dekat dengan table/schema.
3. Kamu butuh kontrol SQL eksplisit.
4. Domain model tidak perlu “pure” atau belum matang.
5. Aplikasi lebih data-centric daripada domain-rich.

#### Risiko

1. DAO mudah menjadi table gateway mentah.
2. DAO sering membocorkan schema ke service.
3. DAO tidak otomatis melindungi domain invariant.
4. DAO bisa memicu transaction script besar.

---

### 4.2 Repository

#### Intent

Repository memediasi domain dan data mapping layer, bertindak seperti collection objek domain.

Repository tidak semata-mata “DAO yang namanya lebih modern”. Repository seharusnya berbicara dengan bahasa domain.

#### Bentuk umum

```java
public interface CaseRepository {
    Optional<Case> findById(CaseId id);
    void save(Case caseAggregate);
    List<Case> findPendingForOfficer(OfficerId officerId, int limit);
}
```

#### Cocok ketika

1. Kamu punya domain model/aggregate yang cukup jelas.
2. Use case sebaiknya tidak tahu schema database.
3. Persistence implementation bisa berubah atau ingin dibatasi.
4. Query perlu dinyatakan dalam bahasa domain.
5. Testing domain/application ingin dipisah dari database detail.

#### Risiko

1. Repository bisa berubah menjadi God Repository.
2. Generic Repository sering menyembunyikan domain intention.
3. Repository bisa membocorkan ORM lazy loading.
4. Repository bisa menutup mata terhadap query cost.
5. `save()` bisa ambigu: insert? update? merge? flush? cascade?

---

### 4.3 Data Mapper

#### Intent

Data Mapper memindahkan data antara object dan database sambil menjaga keduanya independen.

Dalam ORM seperti Hibernate/JPA, sebagian besar Data Mapper dilakukan framework. Dalam JDBC/MyBatis, mapping lebih eksplisit.

#### Bentuk manual sederhana

```java
final class CaseMapper {
    Case toDomain(CaseRow row, List<ViolationRow> violations) {
        return Case.rehydrate(
                new CaseId(row.id()),
                CaseStatus.valueOf(row.status()),
                violations.stream().map(this::toViolation).toList(),
                row.version()
        );
    }

    CaseRow toRow(Case domain) {
        return new CaseRow(
                domain.id().value(),
                domain.status().name(),
                domain.version()
        );
    }

    private Violation toViolation(ViolationRow row) {
        return new Violation(
                new ViolationId(row.id()),
                row.code(),
                row.description()
        );
    }
}
```

#### Cocok ketika

1. Domain model tidak boleh dipengaruhi annotation ORM.
2. Persistence schema berbeda dari domain shape.
3. Kamu memakai JDBC/MyBatis.
4. Kamu butuh read/write model berbeda.
5. Kamu butuh migration dari legacy schema.

#### Risiko

1. Mapper bisa menjadi tempat logic bisnis tersembunyi.
2. Mapping bisa membengkak dan membosankan.
3. Manual mapper rentan field lupa dipetakan.
4. Mapping duplicate bisa muncul di banyak tempat.

---

### 4.4 Unit of Work

#### Intent

Unit of Work melacak perubahan objek selama satu business transaction dan menulis perubahan tersebut ke database sebagai satu unit.

Dalam JPA/Hibernate, `EntityManager`/persistence context sudah memainkan peran mirip Unit of Work:

```java
@Transactional
public void approve(CaseId id) {
    CaseEntity entity = entityManager.find(CaseEntity.class, id.value());
    entity.approve();
    // dirty checking + flush dilakukan oleh persistence context/transaction boundary
}
```

#### Cocok ketika

1. Ada beberapa perubahan yang harus committed bersama.
2. Kamu butuh identity map dalam satu transaction.
3. Kamu ingin menunda write sampai boundary transaksi.
4. Kamu ingin optimistic locking dan dirty checking.

#### Risiko

1. Perubahan tersembunyi karena dirty checking.
2. Flush timing mengejutkan.
3. Transaction terlalu panjang.
4. Entity managed bocor ke luar transaction.
5. Lazy loading terjadi di luar boundary.

---

### 4.5 Query Object

#### Intent

Query Object merepresentasikan query sebagai objek eksplisit, bukan method name panjang atau string tersebar.

#### Bentuk sederhana

```java
public record CaseSearchCriteria(
        Optional<CaseStatus> status,
        Optional<OfficerId> officerId,
        Optional<LocalDate> submittedFrom,
        Optional<LocalDate> submittedTo,
        int page,
        int size
) {
    public CaseSearchCriteria {
        if (page < 0) throw new IllegalArgumentException("page must be >= 0");
        if (size < 1 || size > 500) throw new IllegalArgumentException("size must be 1..500");
    }
}
```

Repository:

```java
interface CaseQueryRepository {
    Page<CaseSummary> search(CaseSearchCriteria criteria);
}
```

#### Cocok ketika

1. Query memiliki banyak optional filter.
2. Query dipakai ulang.
3. Query butuh validation.
4. Query perlu audit/logging.
5. Query perlu pagination/sorting/authorization/tenant filter.
6. Method name repository sudah menjadi absurd.

#### Risiko

1. Query object berubah menjadi generic map.
2. Query builder tidak type-safe.
3. Sorting/filter bebas bisa membuka security/performance problem.
4. Query object domain dan API request tercampur.

---

## 5. DAO vs Repository

### 5.1 Perbedaan Utama

| Aspek | DAO | Repository |
|---|---|---|
| Orientasi | Data/table/query | Domain/aggregate/collection |
| Bahasa | SQL/schema oriented | Domain oriented |
| Return type | Row, entity, projection | Domain object/aggregate/projection domain |
| Level | Infrastructure/data access | Domain/application boundary |
| Cocok untuk | JDBC/MyBatis/data-centric | DDD/domain-rich/use case boundary |
| Risiko utama | schema leakage | fake abstraction/query cost hiding |

### 5.2 Contoh DAO

```java
public interface CaseJdbcDao {
    CaseRow selectById(long caseId);
    int updateStatus(long caseId, String status, long version);
    List<CaseRow> selectPendingRows(int limit);
}
```

DAO bicara database.

### 5.3 Contoh Repository

```java
public interface CaseRepository {
    Optional<Case> find(CaseId id);
    void save(Case aggregate);
    List<Case> findPendingAssignment(int limit);
}
```

Repository bicara domain.

### 5.4 Boleh Punya Keduanya?

Boleh.

Contoh struktur:

```text
case/
  domain/
    Case.java
    CaseRepository.java
  application/
    ApproveCaseHandler.java
  infrastructure/
    persistence/
      JdbcCaseRepository.java
      CaseJdbcDao.java
      CaseRow.java
      CaseMapper.java
```

Di sini:

1. Application bergantung pada `CaseRepository`.
2. `JdbcCaseRepository` mengimplementasikan repository.
3. `JdbcCaseRepository` memakai `CaseJdbcDao` untuk SQL detail.
4. `CaseMapper` menerjemahkan row ke domain.

Ini bukan overengineering jika domain memang penting dan schema tidak boleh bocor.

---

## 6. Repository Design yang Baik

### 6.1 Repository Harus Berbasis Aggregate Boundary

Jangan otomatis satu repository per table.

Buruk:

```text
CaseRepository
CaseItemRepository
CaseStatusRepository
CaseOfficerRepository
CaseAttachmentRepository
```

Jika `Case` adalah aggregate root, maka mutation terhadap child harus melalui aggregate root.

Lebih baik:

```java
interface CaseRepository {
    Optional<Case> find(CaseId id);
    void save(Case caseAggregate);
}
```

Child object tidak selalu butuh repository sendiri.

Rule:

```text
Repository biasanya untuk aggregate root, bukan setiap entity kecil.
```

---

### 6.2 Repository Method Harus Mewakili Use Case atau Domain Question

Buruk:

```java
List<CaseEntity> findByStatusAndDeletedFalseAndTypeInAndCreatedAtBefore(
        String status,
        List<String> types,
        LocalDateTime createdAt
);
```

Lebih baik:

```java
List<Case> findCasesEligibleForAutoClosure(AutoClosureCutoff cutoff, int limit);
```

Kenapa lebih baik?

Karena method ini menyimpan intention:

```text
eligible for auto closure
```

Detail status/type/date bisa berubah tanpa mengubah application layer.

---

### 6.3 Hindari Repository yang Terlalu Generic

Anti-pattern umum:

```java
public interface GenericRepository<T, ID> {
    Optional<T> findById(ID id);
    List<T> findAll();
    T save(T entity);
    void delete(T entity);
}
```

Lalu semua repository extend:

```java
interface CaseRepository extends GenericRepository<Case, Long> {}
interface OfficerRepository extends GenericRepository<Officer, Long> {}
```

Masalahnya:

1. Semua aggregate dianggap punya lifecycle sama.
2. `findAll()` bisa berbahaya untuk table besar.
3. `delete()` mungkin tidak valid secara domain.
4. `save()` terlalu ambigu.
5. Domain intention hilang.
6. Authorization dan tenant filtering sering terlupakan.
7. Caller terdorong melakukan filtering di memory.

Lebih baik buat contract eksplisit:

```java
interface CaseRepository {
    Optional<Case> find(CaseId id);
    void add(Case newCase);
    void update(Case existingCase);
    List<Case> findPendingReview(int limit);
}
```

Atau jika memakai JPA/Spring Data untuk CRUD sederhana, sadarilah bahwa itu adalah convenience, bukan domain abstraction sempurna.

---

### 6.4 Hati-Hati dengan `save()`

`save()` tampak sederhana, tetapi semantiknya bisa kacau:

```java
Case saved = repository.save(case);
```

Pertanyaan:

1. Apakah insert atau update?
2. Apakah langsung flush?
3. Apakah mengembalikan instance managed atau detached?
4. Apakah cascade children?
5. Apakah optimistic lock checked sekarang atau saat commit?
6. Apakah domain event dipublish?
7. Apakah audit dibuat?
8. Apakah generated ID dikembalikan?

Untuk use case kritikal, nama method eksplisit sering lebih aman:

```java
interface CaseRepository {
    void addNew(Case caseAggregate);
    void store(Case caseAggregate);
    boolean updateIfVersionMatches(Case caseAggregate, Version expectedVersion);
}
```

Atau tetap pakai `save()`, tetapi dokumentasikan contract-nya.

---

## 7. Data Mapper Design

### 7.1 Mapping Bukan Sekadar Copy Field

Mapping sering dianggap pekerjaan rendah. Di sistem enterprise, mapping adalah boundary translation.

Mapper harus menjawab:

1. Apakah nilai database valid untuk domain?
2. Bagaimana legacy code diterjemahkan?
3. Bagaimana null lama diterjemahkan ke value object modern?
4. Bagaimana enum database yang tidak dikenal ditangani?
5. Apakah timestamp memakai timezone benar?
6. Apakah money/quantity punya precision benar?
7. Apakah status database masih legal menurut state machine sekarang?

Contoh:

```java
final class CasePersistenceMapper {
    Case toDomain(CaseRecord record) {
        CaseStatus status = mapStatus(record.statusCode());

        return Case.rehydrate(
                new CaseId(record.caseId()),
                status,
                new OfficerId(record.assignedOfficerId()),
                Version.of(record.version())
        );
    }

    private CaseStatus mapStatus(String dbCode) {
        return switch (dbCode) {
            case "P" -> CaseStatus.PENDING;
            case "A" -> CaseStatus.APPROVED;
            case "R" -> CaseStatus.REJECTED;
            case "C" -> CaseStatus.CLOSED;
            default -> throw new PersistenceMappingException(
                    "Unknown case status code: " + dbCode
            );
        };
    }
}
```

Mapping failure harus eksplisit. Silent mapping ke `UNKNOWN` bisa berbahaya untuk decision system.

---

### 7.2 Domain Rehydration Harus Dibedakan dari Public Constructor

Domain object kadang punya invariant creation berbeda dari invariant rehydration.

```java
public final class Case {
    private final CaseId id;
    private CaseStatus status;
    private final Version version;

    private Case(CaseId id, CaseStatus status, Version version) {
        this.id = Objects.requireNonNull(id);
        this.status = Objects.requireNonNull(status);
        this.version = Objects.requireNonNull(version);
    }

    public static Case submit(NewCaseSubmission submission) {
        return new Case(
                CaseId.newId(),
                CaseStatus.PENDING_REVIEW,
                Version.initial()
        );
    }

    public static Case rehydrate(CaseId id, CaseStatus status, Version version) {
        return new Case(id, status, version);
    }
}
```

Kenapa penting?

1. `submit()` mewakili business creation.
2. `rehydrate()` mewakili load dari database.
3. Mapper tidak perlu melanggar constructor invariant.
4. Domain tetap mengontrol state legal.

---

### 7.3 Mapper Tidak Boleh Menjadi Domain Service Tersembunyi

Buruk:

```java
class CaseMapper {
    Case toDomain(CaseRow row) {
        Case c = new Case(...);
        if (row.deadline().isBefore(LocalDate.now())) {
            c.markOverdue();
        }
        return c;
    }
}
```

Masalah:

1. Mapping menjadi time-dependent.
2. Load object mengubah business state.
3. Test sulit.
4. Query biasa punya side effect konseptual.

Lebih baik:

```java
Case c = mapper.toDomain(row);
caseDeadlinePolicy.evaluate(c, clock.today());
```

Mapper menerjemahkan data. Policy mengevaluasi business condition.

---

## 8. Unit of Work dalam Java Persistence

### 8.1 Unit of Work Manual

Dalam JDBC manual, kamu bisa punya transaction boundary eksplisit:

```java
public final class JdbcUnitOfWork implements UnitOfWork {
    private final DataSource dataSource;

    public <T> T withinTransaction(TransactionCallback<T> callback) {
        try (Connection connection = dataSource.getConnection()) {
            boolean oldAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                T result = callback.execute(connection);
                connection.commit();
                return result;
            } catch (Exception e) {
                connection.rollback();
                throw e;
            } finally {
                connection.setAutoCommit(oldAutoCommit);
            }
        } catch (SQLException e) {
            throw new PersistenceException("Transaction failed", e);
        }
    }
}
```

Ini memberi kontrol eksplisit, tetapi juga banyak tanggung jawab.

---

### 8.2 Unit of Work di JPA/Hibernate

Dalam JPA/Hibernate, persistence context melakukan:

1. Identity map dalam satu context.
2. Dirty checking.
3. Change tracking.
4. Write-behind sampai flush/commit.
5. Cascade operation.
6. Lazy loading.

Maka menambahkan Unit of Work abstraction di atas JPA sering redundant jika hanya membungkus `EntityManager`.

Buruk:

```java
interface UnitOfWork {
    void begin();
    void commit();
    void rollback();
}
```

Lalu di Spring:

```java
@Transactional
public void approve(...) {
    unitOfWork.begin(); // redundant/confusing
    ...
    unitOfWork.commit();
}
```

Kalau transaction sudah dikelola Spring/Jakarta, abstraction tambahan bisa membingungkan.

---

### 8.3 Kapan Unit of Work Abstraction Masih Berguna?

Berguna ketika:

1. Kamu tidak memakai framework transaction declarative.
2. Kamu butuh orchestrate beberapa persistence backend secara eksplisit.
3. Kamu membuat library persistence sendiri.
4. Kamu butuh test harness eksplisit.
5. Kamu memakai event/outbox collection yang harus flush bersama aggregate.
6. Kamu perlu membedakan read-only transaction, write transaction, dan retryable transaction.

Contoh lebih masuk akal:

```java
public interface TransactionRunner {
    <T> T readOnly(Supplier<T> operation);
    <T> T write(Supplier<T> operation);
}
```

Atau:

```java
public interface CaseUnitOfWork {
    void commit(Case aggregate, List<DomainEvent> events);
}
```

Ini punya semantik domain/application lebih jelas daripada `begin/commit` generic.

---

## 9. Query Object Design

### 9.1 Masalah Method Name Explosion

Repository method bisa menjadi seperti ini:

```java
findByStatusInAndOfficerIdAndCreatedAtBetweenAndPriorityGreaterThanAndDeletedFalseOrderByCreatedAtDesc(...)
```

Ini buruk karena:

1. Nama method menyimpan query detail yang rapuh.
2. Optional filter sulit.
3. Pagination/sorting bercampur.
4. Authorization/tenant filter sering terpisah.
5. Reuse rendah.

Query Object menyelesaikan ini dengan menjadikan query sebagai konsep eksplisit.

---

### 9.2 Query Object sebagai Input Model Internal

```java
public record PendingCaseSearch(
        Optional<OfficerId> officerId,
        Optional<CasePriority> minimumPriority,
        Optional<SubmittedDateRange> submittedDateRange,
        PageRequest pageRequest
) {
    public PendingCaseSearch {
        Objects.requireNonNull(officerId);
        Objects.requireNonNull(minimumPriority);
        Objects.requireNonNull(submittedDateRange);
        Objects.requireNonNull(pageRequest);
    }
}
```

Repository:

```java
interface CaseReadRepository {
    Page<PendingCaseSummary> searchPendingCases(PendingCaseSearch search);
}
```

Implementation bisa memakai Criteria API, jOOQ, MyBatis dynamic SQL, QueryDSL, atau manual SQL builder.

---

### 9.3 Query Object Bukan API Request DTO

Buruk:

```java
public Page<CaseSummary> search(CaseSearchHttpRequest request) { ... }
```

Masalah:

1. HTTP concern masuk repository.
2. Query internal bergantung nama parameter API.
3. Security/validation boundary kabur.
4. API versioning memengaruhi persistence layer.

Lebih baik:

```java
@RestController
class CaseController {
    PageResponse<CaseSummaryResponse> search(CaseSearchRequest request) {
        PendingCaseSearch search = caseSearchAssembler.toQuery(request, currentUser());
        Page<PendingCaseSummary> result = caseReadRepository.searchPendingCases(search);
        return presenter.toResponse(result);
    }
}
```

Boundary jelas:

```text
HTTP request DTO -> Application/query object -> Repository -> Projection -> Response DTO
```

---

### 9.4 Query Object Harus Mengontrol Sorting

Jangan memberi user field bebas langsung ke SQL.

Buruk:

```java
String sortBy = request.getSortBy();
String sql = "select * from cases order by " + sortBy;
```

Lebih aman:

```java
public enum CaseSortField {
    SUBMITTED_AT,
    PRIORITY,
    SLA_DUE_AT
}

public record SortSpec(CaseSortField field, SortDirection direction) {}
```

Mapping:

```java
String column = switch (sort.field()) {
    case SUBMITTED_AT -> "c.submitted_at";
    case PRIORITY -> "c.priority";
    case SLA_DUE_AT -> "c.sla_due_at";
};
```

Ini menjaga:

1. Security.
2. Index awareness.
3. Compatibility.
4. Query performance.

---

## 10. Read Repository vs Write Repository

### 10.1 Jangan Paksa Satu Repository untuk Semua

Write model dan read model sering berbeda.

Write repository:

```java
interface CaseRepository {
    Optional<Case> find(CaseId id);
    void save(Case aggregate);
}
```

Read repository:

```java
interface CaseReadRepository {
    Page<CaseListItem> search(CaseSearchCriteria criteria);
    Optional<CaseDetailView> findDetail(CaseId id);
}
```

Kenapa dipisah?

1. Write butuh aggregate dan invariant.
2. Read butuh projection optimal.
3. Read sering join banyak table.
4. Write harus menjaga consistency.
5. Read harus cepat, paginated, filterable.

Memaksa semua lewat aggregate bisa mahal.

---

### 10.2 Jangan Load Aggregate untuk Semua Read

Buruk:

```java
List<Case> cases = caseRepository.findAllPending();
return cases.stream()
        .map(c -> new CaseListItem(c.id(), c.status(), c.assignedOfficer().name()))
        .toList();
```

Risiko:

1. Load data terlalu banyak.
2. N+1.
3. Lazy loading.
4. Memory pressure.
5. Domain object digunakan hanya sebagai DTO transit.

Lebih baik:

```java
interface CaseReadRepository {
    List<CaseListItem> findPendingListItems(int limit);
}
```

Query langsung mengambil projection yang dibutuhkan.

---

## 11. Pagination dan Cardinality

Repository method harus memperlihatkan cardinality.

Buruk:

```java
List<Case> findAll();
```

Lebih baik:

```java
Page<CaseSummary> search(CaseSearchCriteria criteria);
List<CaseId> findIdsEligibleForBatch(AutoClosureCriteria criteria, int limit);
Stream<CaseExportRow> streamForExport(ExportCriteria criteria);
```

Perhatikan tiga intent berbeda:

1. UI search: `Page`.
2. Batch processing: `limit` + cursor/checkpoint.
3. Export: streaming/cursor.

Jangan gunakan satu API untuk semua.

---

## 12. Transaction Boundary

### 12.1 Repository Tidak Selalu Harus Memulai Transaction

Umumnya transaction boundary berada di application service/use case handler:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    Case c = caseRepository.find(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

    c.approve(command.officerId(), clock.now());

    caseRepository.save(c);
    outboxRepository.addAll(c.releaseEvents());
}
```

Repository melakukan persistence operation, tetapi use case menentukan unit bisnisnya.

---

### 12.2 Repository yang Membuka Transaction Sendiri Bisa Berbahaya

Buruk:

```java
class CaseRepository {
    @Transactional
    void save(Case c) { ... }
}
```

Lalu application:

```java
public void approve(...) {
    caseRepository.save(case);
    auditRepository.save(audit);
    outboxRepository.save(event);
}
```

Jika masing-masing repository punya transaction sendiri, satu use case bisa terpecah menjadi beberapa commit.

Untuk write use case, transaction harus merepresentasikan business consistency boundary.

---

### 12.3 Read-Only Transaction Tetap Penting

Read-only transaction bisa berguna untuk:

1. Consistent read.
2. ORM session/persistence context lifecycle.
3. Lazy loading yang terkontrol.
4. Database optimization hint tergantung framework/database.

Namun read-only bukan izin untuk lazy loading sembarangan.

---

## 13. Error Translation

Persistence error jangan bocor mentah ke application/domain.

Buruk:

```java
catch (SQLException e) {
    throw new RuntimeException(e);
}
```

Lebih baik:

```java
catch (SQLIntegrityConstraintViolationException e) {
    throw new DuplicateCaseReferenceException(reference, e);
} catch (SQLTimeoutException e) {
    throw new PersistenceTimeoutException("Timed out loading case " + id, e);
} catch (SQLException e) {
    throw new CasePersistenceException("Failed to load case " + id, e);
}
```

Klasifikasi error penting:

| Error | Meaning | Caller action |
|---|---|---|
| Not found | Data tidak ada | return 404/domain error |
| Duplicate key | Conflict | reject/retry with new ID |
| Optimistic lock | Concurrent update | retry/reload/show conflict |
| Timeout | Infrastruktur lambat | retry if safe |
| Connection failure | Infrastruktur down | fail fast/circuit breaker |
| Mapping error | Data corrupt/unknown | escalate, alert |

---

## 14. Optimistic Locking dan Repository Contract

Repository method harus sadar concurrency.

Contoh domain:

```java
public record Version(long value) {
    public Version next() {
        return new Version(value + 1);
    }
}
```

Repository contract:

```java
interface CaseRepository {
    Optional<Case> find(CaseId id);
    void save(Case aggregate) throws OptimisticConflictException;
}
```

Atau lebih eksplisit:

```java
boolean saveIfVersionMatches(Case aggregate, Version expectedVersion);
```

Jangan menyembunyikan lost update.

Anti-pattern:

```java
update cases set status = ? where id = ?
```

Lebih aman:

```sql
update cases
set status = ?, version = version + 1
where id = ? and version = ?
```

Jika affected row = 0, ada conflict.

---

## 15. Persistence Ignorance: Ideal vs Realita

Persistence ignorance berarti domain model tidak bergantung pada detail persistence.

Contoh domain bersih:

```java
public final class Case {
    private final CaseId id;
    private CaseStatus status;

    public void approve(OfficerId officerId, Instant now) {
        if (status != CaseStatus.PENDING_REVIEW) {
            throw new IllegalTransitionException(status, CaseStatus.APPROVED);
        }
        status = CaseStatus.APPROVED;
    }
}
```

Tidak ada:

```java
@Entity
@Table
@Column
@OneToMany
```

Namun di dunia nyata, banyak tim memakai JPA entity sebagai domain model. Itu tidak otomatis salah, tetapi trade-off-nya harus sadar.

### 15.1 JPA Entity sebagai Domain Object

Kelebihan:

1. Sedikit mapping.
2. Cepat dibangun.
3. Natural untuk CRUD.
4. Dirty checking mudah.

Kekurangan:

1. Annotation persistence masuk domain.
2. Lazy loading memengaruhi behavior.
3. Constructor/proxy constraint.
4. Equality/hashCode tricky.
5. Bidirectional association complexity.
6. Unit test domain bisa bergantung pada JPA behavior.

### 15.2 Separate Domain dan Persistence Model

Kelebihan:

1. Domain lebih bersih.
2. Schema legacy tidak mengotori domain.
3. Mapping eksplisit.
4. Easier for non-JPA storage.
5. Better boundary for complex domain.

Kekurangan:

1. More code.
2. Mapping maintenance.
3. Possible performance overhead.
4. More design discipline required.

Keputusan praktis:

```text
Gunakan JPA entity sebagai domain jika domain sederhana dan mapping natural.
Pisahkan jika domain invariant kuat, schema legacy kompleks, atau persistence concern mulai mendistorsi model.
```

---

## 16. Anti-Pattern Catalog

### 16.1 Generic Repository Abuse

Gejala:

```java
repository.findAll();
repository.save(anything);
repository.delete(anything);
```

Dampak:

1. Domain lifecycle hilang.
2. Query tidak intention-revealing.
3. Caller filtering di memory.
4. Authorization sulit.
5. Performance risk.

Solusi:

1. Buat repository per aggregate/use case.
2. Hapus method generic berbahaya.
3. Ganti dengan query domain eksplisit.

---

### 16.2 Leaky ORM Abstraction

Gejala:

```java
caseRepository.find(id).getItems().size(); // lazy loading surprise
```

Atau:

```java
@Transactional(readOnly = true)
public Case getCase(...) { return entity; }
```

Lalu entity dipakai di luar transaction.

Dampak:

1. LazyInitializationException.
2. N+1.
3. Transaction boundary kabur.
4. API response accidentally triggers DB.

Solusi:

1. Return projection untuk read use case.
2. Define fetch plan eksplisit.
3. Jangan expose managed entity ke boundary luar.
4. Test query count.

---

### 16.3 Repository as Query Dumping Ground

Gejala:

```java
CaseRepository
  findByStatus
  findByStatusAndType
  findByStatusAndTypeAndOfficer
  findForReportA
  findForReportB
  findForDashboard
  findForExport
  findForEmailJob
  findForLegacySync
```

Dampak:

1. Repository kehilangan cohesion.
2. Query ownership tidak jelas.
3. Perubahan satu query berisiko ke banyak fitur.

Solusi:

Pisahkan:

```text
CaseRepository              -> aggregate write/load
CaseReadRepository          -> UI/read projection
CaseReportRepository        -> reporting projection
CaseExportRepository        -> export streaming
CaseBatchRepository         -> batch candidate selection
```

Pemisahan berdasarkan reason to change.

---

### 16.4 N+1 Hidden Behind Repository

Gejala:

```java
List<Case> cases = repository.findRecentCases();
for (Case c : cases) {
    c.assignedOfficer().name();
    c.violations().size();
}
```

Dampak:

1. Query count naik linear.
2. Latency naik drastis.
3. Database CPU/IO meningkat.
4. Production incident.

Solusi:

1. Projection query.
2. Fetch join/entity graph dengan sadar.
3. Batch loading.
4. Query count test.
5. Observability di repository.

---

### 16.5 Repository Returning IQueryable-Like Abstraction

Dalam Java, bentuknya bisa seperti expose `CriteriaBuilder`, `EntityManager`, atau custom query chain ke application.

Buruk:

```java
interface CaseRepository {
    EntityManager entityManager();
}
```

Atau:

```java
CriteriaBuilder criteriaBuilder();
```

Dampak:

1. Repository tidak lagi boundary.
2. Caller bisa membuat query apapun.
3. Authorization/tenant filters terlewat.
4. Persistence API bocor.

Solusi:

1. Query object eksplisit.
2. Specification terbatas.
3. Read repository khusus.
4. Internal query builder tetap di infrastructure.

---

### 16.6 In-Memory Filtering After FindAll

Buruk:

```java
repository.findAll().stream()
        .filter(c -> c.status() == PENDING)
        .filter(c -> c.submittedAt().isBefore(cutoff))
        .toList();
```

Dampak:

1. Load table besar.
2. Index tidak dipakai.
3. Memory tinggi.
4. Timeout.

Solusi:

Push predicate ke database:

```java
repository.findPendingSubmittedBefore(cutoff, limit);
```

Atau query object.

---

### 16.7 Transaction Hidden in Repository

Gejala:

```java
repository.saveA(); // commit
repository.saveB(); // commit
repository.saveC(); // commit
```

Dampak:

1. Partial commit.
2. Inconsistent use case.
3. Retry sulit.
4. Audit/outbox mismatch.

Solusi:

Transaction di application use case.

---

### 16.8 Data Mapper with Business Side Effect

Gejala:

Mapper mengubah status, publish event, call API, atau menghitung deadline dengan current time.

Dampak:

1. Load data punya side effect konseptual.
2. Mapping tidak deterministic.
3. Debug sulit.

Solusi:

Mapper hanya translation. Policy/service menangani keputusan.

---

## 17. Java 8–25 Perspective

### 17.1 Java 8

Java 8 membawa:

1. `Optional` untuk return not-found.
2. Lambda untuk mapper kecil.
3. Stream untuk transformation.
4. Functional interface untuk query specification.

Contoh:

```java
Optional<Case> find(CaseId id);
```

Namun jangan overuse stream untuk query besar di memory.

---

### 17.2 Java 10 `var`

`var` bisa memperbaiki readability lokal:

```java
var criteria = new PendingCaseSearch(...);
```

Tetapi di persistence code, type clarity sering penting. Jangan sembunyikan apakah object itu entity, domain, row, atau projection.

Buruk:

```java
var caseObj = repository.find(id).orElseThrow();
```

Lebih jelas:

```java
Case aggregate = repository.find(id).orElseThrow();
```

---

### 17.3 Records

Records cocok untuk:

1. Query criteria.
2. Projection.
3. Row object immutable.
4. Value object sederhana.
5. Sort/page spec.

Contoh:

```java
public record CaseSummary(
        CaseId id,
        CaseReference reference,
        CaseStatus status,
        Instant submittedAt
) {}
```

Hindari record sebagai entity mutable JPA utama.

---

### 17.4 Sealed Classes

Sealed classes berguna untuk query result/error/result type.

```java
public sealed interface LoadCaseResult {
    record Found(Case value) implements LoadCaseResult {}
    record NotFound(CaseId id) implements LoadCaseResult {}
    record AccessDenied(CaseId id) implements LoadCaseResult {}
}
```

Ini lebih eksplisit daripada `Optional` ketika not-found bukan satu-satunya hasil.

---

### 17.5 Pattern Matching Switch

Pattern matching switch memudahkan handling result:

```java
return switch (result) {
    case LoadCaseResult.Found found -> handle(found.value());
    case LoadCaseResult.NotFound nf -> throw new CaseNotFoundException(nf.id());
    case LoadCaseResult.AccessDenied denied -> throw new AccessDeniedException(...);
};
```

Bagus untuk result taxonomy.

---

### 17.6 Virtual Threads

Virtual threads membuat blocking JDBC lebih scalable dari sisi thread, tetapi tidak menghapus bottleneck database.

Kesalahan umum:

```text
Karena virtual threads murah, query database boleh sebanyak mungkin.
```

Salah.

Database connection tetap terbatas. Query tetap memakai CPU/IO/lock/index. Repository tetap perlu limit, timeout, pagination, dan query cost awareness.

---

### 17.7 Scoped Values dan Context

Scoped Values dapat menjadi alternatif lebih aman daripada ThreadLocal untuk request context di Java modern, terutama dengan virtual threads/structured concurrency.

Namun persistence layer sebaiknya tidak diam-diam mengambil tenant/officer dari global context tanpa contract jelas.

Lebih eksplisit:

```java
caseReadRepository.search(criteria, accessScope);
```

Daripada:

```java
caseReadRepository.search(criteria); // diam-diam baca ThreadLocal tenant
```

---

## 18. Implementation Step-by-Step

Kita akan desain persistence boundary untuk `Case`.

### 18.1 Domain Package

```java
package com.example.caseflow.casecore.domain;

public interface CaseRepository {
    Optional<Case> find(CaseId id);
    void save(Case aggregate);
}
```

Domain tidak tahu JPA/JDBC.

---

### 18.2 Domain Aggregate

```java
public final class Case {
    private final CaseId id;
    private CaseStatus status;
    private Version version;
    private final List<DomainEvent> events = new ArrayList<>();

    private Case(CaseId id, CaseStatus status, Version version) {
        this.id = Objects.requireNonNull(id);
        this.status = Objects.requireNonNull(status);
        this.version = Objects.requireNonNull(version);
    }

    public static Case rehydrate(CaseId id, CaseStatus status, Version version) {
        return new Case(id, status, version);
    }

    public void approve(OfficerId officerId, Instant now) {
        if (status != CaseStatus.PENDING_REVIEW) {
            throw new IllegalTransitionException(status, CaseStatus.APPROVED);
        }
        status = CaseStatus.APPROVED;
        events.add(new CaseApproved(id, officerId, now));
    }

    public List<DomainEvent> releaseEvents() {
        List<DomainEvent> copy = List.copyOf(events);
        events.clear();
        return copy;
    }
}
```

---

### 18.3 Persistence Row

```java
package com.example.caseflow.casecore.infrastructure.persistence;

record CaseRow(
        long id,
        String status,
        long version
) {}
```

Row mengikuti database shape.

---

### 18.4 DAO

```java
interface CaseJdbcDao {
    Optional<CaseRow> selectById(long id);
    int updateStatus(long id, String status, long expectedVersion);
}
```

DAO bicara SQL.

---

### 18.5 Mapper

```java
final class CasePersistenceMapper {
    Case toDomain(CaseRow row) {
        return Case.rehydrate(
                new CaseId(row.id()),
                CaseStatus.valueOf(row.status()),
                new Version(row.version())
        );
    }

    String toStatusCode(Case aggregate) {
        return aggregate.status().name();
    }
}
```

---

### 18.6 Repository Implementation

```java
final class JdbcCaseRepository implements CaseRepository {
    private final CaseJdbcDao dao;
    private final CasePersistenceMapper mapper;

    JdbcCaseRepository(CaseJdbcDao dao, CasePersistenceMapper mapper) {
        this.dao = dao;
        this.mapper = mapper;
    }

    @Override
    public Optional<Case> find(CaseId id) {
        return dao.selectById(id.value())
                .map(mapper::toDomain);
    }

    @Override
    public void save(Case aggregate) {
        int updated = dao.updateStatus(
                aggregate.id().value(),
                mapper.toStatusCode(aggregate),
                aggregate.version().value()
        );

        if (updated == 0) {
            throw new OptimisticConflictException(aggregate.id());
        }
    }
}
```

---

### 18.7 Application Service

```java
final class ApproveCaseHandler {
    private final CaseRepository caseRepository;
    private final OutboxRepository outboxRepository;
    private final Clock clock;

    @Transactional
    public void handle(ApproveCaseCommand command) {
        Case aggregate = caseRepository.find(command.caseId())
                .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        aggregate.approve(command.officerId(), clock.instant());

        caseRepository.save(aggregate);
        outboxRepository.addAll(aggregate.releaseEvents());
    }
}
```

Boundary:

```text
Application controls transaction.
Domain controls decision.
Repository controls persistence.
DAO controls SQL.
Mapper controls translation.
```

---

## 19. Testing Strategy

### 19.1 Domain Test

Tidak perlu database.

```java
@Test
void pendingCaseCanBeApproved() {
    Case c = Case.rehydrate(new CaseId(1), CaseStatus.PENDING_REVIEW, new Version(1));

    c.approve(new OfficerId("ofc-1"), Instant.parse("2026-01-01T00:00:00Z"));

    assertEquals(CaseStatus.APPROVED, c.status());
}
```

---

### 19.2 Mapper Test

Test mapping edge case.

```java
@Test
void mapsDatabaseStatusCodeToDomainStatus() {
    CaseRow row = new CaseRow(1, "APPROVED", 3);

    Case domain = mapper.toDomain(row);

    assertEquals(CaseStatus.APPROVED, domain.status());
}
```

Test unknown code.

---

### 19.3 Repository Integration Test

Gunakan real database/testcontainer jika memungkinkan.

Test:

1. Find existing.
2. Find missing.
3. Save success.
4. Optimistic conflict.
5. Mapping null/legacy code.
6. Transaction rollback.
7. Query count untuk read method kritikal.

---

### 19.4 Query Object Test

Test criteria validation:

```java
assertThrows(IllegalArgumentException.class,
        () -> new PageRequest(0, 10_000));
```

Test SQL generation jika manual builder.

Test security:

1. Sort field whitelist.
2. Tenant filter always applied.
3. Deleted records excluded if required.

---

## 20. Observability dan Debugging Angle

Persistence boundary harus observable.

Minimal logging structured:

```text
repository=CaseReadRepository
operation=searchPendingCases
criteriaHash=...
page=0
size=50
sort=SLA_DUE_AT_ASC
resultCount=50
durationMs=42
```

Jangan log PII/filter sensitif sembarangan.

Metrics:

1. Repository operation latency.
2. Query count per request.
3. Result count.
4. Timeout count.
5. Optimistic conflict count.
6. Mapping error count.
7. Deadlock/retry count.
8. Slow query count by operation name.

Trace attributes:

```text
db.operation.name=CaseReadRepository.searchPendingCases
case.criteria.page_size=50
case.result_count=50
```

Kunci observability:

```text
Jangan hanya tahu SQL lambat.
Harus tahu use case dan repository method yang menyebabkan SQL itu.
```

---

## 21. Security dan Multi-Tenancy

Persistence layer sering menjadi tempat terakhir untuk enforcement security.

Namun jangan menaruh authorization utama diam-diam di query tanpa domain/application tahu.

### 21.1 Access Scope Pattern

```java
public record AccessScope(
        UserId userId,
        Set<AgencyId> agencies,
        Set<Permission> permissions
) {}
```

Read repository:

```java
Page<CaseSummary> search(CaseSearchCriteria criteria, AccessScope scope);
```

Keuntungan:

1. Query bisa apply tenant/agency filter.
2. Contract eksplisit.
3. Test bisa memastikan scope diterapkan.
4. Audit bisa mencatat scope.

---

### 21.2 Jangan Percaya Filter dari Client

Buruk:

```java
criteria.agencyId() // dari request langsung dipercaya
```

Lebih aman:

```java
AgencyId agency = accessScope.requireSingleAgencyOrThrow();
```

Atau intersect:

```java
allowedAgencies = requestedAgencies ∩ scope.agencies()
```

---

## 22. Performance Consideration

### 22.1 Repository API Harus Memaksa Limit

Buruk:

```java
List<CaseSummary> findPending();
```

Lebih baik:

```java
List<CaseSummary> findPending(int limit);
```

Atau:

```java
Page<CaseSummary> search(CaseSearchCriteria criteria);
```

### 22.2 Projection untuk Read

Jangan load aggregate untuk dashboard.

```java
record CaseDashboardRow(
        CaseId id,
        String referenceNo,
        CaseStatus status,
        Instant slaDueAt
) {}
```

### 22.3 Batch Processing

Untuk batch:

1. Ambil ID dulu.
2. Process dalam chunk.
3. Gunakan checkpoint.
4. Hindari long transaction.
5. Hindari load ribuan aggregate sekaligus.

```java
List<CaseId> ids = batchRepository.findEligibleIds(cutoff, 500);
```

### 22.4 Streaming

Untuk export besar, gunakan streaming/cursor dengan hati-hati:

```java
try (Stream<CaseExportRow> rows = exportRepository.stream(criteria)) {
    rows.forEach(writer::write);
}
```

Contract harus jelas bahwa stream wajib ditutup.

---

## 23. Refactoring Path

### Step 1 — Inventaris Query Tersebar

Cari:

1. `EntityManager` di service.
2. `JdbcTemplate` di controller/service.
3. Native query string.
4. `findAll().stream().filter`.
5. Lazy loading di mapper/serializer.
6. Repository method nama panjang.
7. Transaction di repository.

---

### Step 2 — Kelompokkan Query Berdasarkan Reason to Change

Kelompok:

1. Aggregate load/save.
2. UI search.
3. Reporting.
4. Batch candidate selection.
5. Export.
6. Integration sync.
7. Audit lookup.

Jangan langsung buat satu repository besar.

---

### Step 3 — Buat Read Projection untuk Query Berat

Ganti:

```java
List<Case> cases = caseRepository.findForDashboard(...);
```

Menjadi:

```java
List<CaseDashboardRow> rows = caseDashboardRepository.findRows(...);
```

---

### Step 4 — Ekstrak Query Object

Dari parameter panjang:

```java
search(status, type, officer, from, to, page, size, sort)
```

Menjadi:

```java
search(CaseSearchCriteria criteria)
```

---

### Step 5 — Terjemahkan Error

Jangan biarkan `SQLException`, `PersistenceException`, atau vendor exception menyebar sembarangan.

---

### Step 6 — Tambahkan Query Count/Latency Test untuk Query Kritikal

Sebelum refactor besar, buat baseline.

---

### Step 7 — Pindahkan Transaction Boundary ke Application Use Case

Pastikan satu business operation = satu transaction boundary yang jelas.

---

### Step 8 — Pisahkan Domain dan Persistence Model Jika Sudah Perlu

Jangan dilakukan terlalu dini. Lakukan jika:

1. ORM annotation menghambat domain design.
2. Lazy loading menyebabkan bug.
3. Schema legacy tidak cocok dengan domain.
4. Query read/write makin berbeda.
5. Domain test sulit karena persistence constraint.

---

## 24. Design Review Checklist

Gunakan checklist ini saat review persistence design.

### Repository Contract

```text
[ ] Apakah repository mewakili aggregate/use case, bukan table mentah?
[ ] Apakah method memakai bahasa domain?
[ ] Apakah cardinality jelas?
[ ] Apakah method berbahaya seperti findAll/delete generic dihindari?
[ ] Apakah save semantics jelas?
[ ] Apakah optimistic locking/concurrency semantics jelas?
```

### Boundary

```text
[ ] Apakah domain tidak tahu schema jika memang harus persistence-ignorant?
[ ] Apakah ORM entity tidak bocor ke API response?
[ ] Apakah lazy loading tidak melewati transaction boundary?
[ ] Apakah external caller tidak bisa membangun query arbitrary?
```

### Query

```text
[ ] Apakah query berat memakai projection?
[ ] Apakah pagination/limit wajib?
[ ] Apakah sorting field di-whitelist?
[ ] Apakah tenant/access filter diterapkan?
[ ] Apakah query cost terlihat?
[ ] Apakah N+1 dicegah/tested?
```

### Transaction

```text
[ ] Apakah transaction boundary berada di use case yang benar?
[ ] Apakah repository tidak diam-diam commit sendiri untuk operasi yang harus atomic?
[ ] Apakah external call tidak dilakukan di dalam transaction panjang?
[ ] Apakah outbox/audit committed bersama mutation utama?
```

### Error

```text
[ ] Apakah persistence exception diterjemahkan?
[ ] Apakah duplicate/conflict/timeout/not-found dibedakan?
[ ] Apakah mapping error dianggap serius dan observable?
```

### Testability

```text
[ ] Apakah domain logic bisa dites tanpa database?
[ ] Apakah mapper punya edge-case tests?
[ ] Apakah repository punya integration tests?
[ ] Apakah query count/performance regression dipantau?
```

---

## 25. Staff-Level Discussion

### 25.1 “Apakah Repository Selalu Perlu?”

Tidak.

Repository perlu jika ia menciptakan boundary yang nyata:

1. Menyembunyikan schema dari domain/application.
2. Menyatakan query dalam bahasa domain.
3. Mengontrol aggregate lifecycle.
4. Mengisolasi persistence implementation.
5. Membantu testability.
6. Mengontrol consistency.

Repository tidak perlu jika ia hanya pass-through:

```java
repository.findById(id) -> entityManager.find(...)
repository.save(entity) -> entityManager.merge(...)
```

Tanpa semantic tambahan, itu hanya ceremony.

---

### 25.2 “Apakah Generic Repository Anti-Pattern?”

Tidak selalu, tetapi sering.

Generic repository bisa berguna untuk:

1. Internal framework code.
2. CRUD admin sederhana.
3. Prototype/internal tool kecil.
4. Entity yang benar-benar lifecycle-nya seragam.

Tetapi untuk domain enterprise penting, generic repository sering menghapus intention dan membuka operasi yang tidak valid.

---

### 25.3 “Apakah JPA Entity Boleh Jadi Domain Entity?”

Boleh jika trade-off sadar.

Pertanyaan review:

1. Apakah invariant tetap hidup di method entity?
2. Apakah setter publik tidak membuka invalid state?
3. Apakah lazy loading tidak masuk decision logic tanpa sadar?
4. Apakah equality/hashCode aman?
5. Apakah domain test tidak tergantung database?
6. Apakah persistence annotation tidak mengubah model secara aneh?

Jika jawabannya buruk, pisahkan model.

---

### 25.4 “DAO atau Repository untuk MyBatis?”

MyBatis lebih dekat ke SQL mapper/DAO. Kamu bisa tetap punya Repository di atasnya jika ingin domain boundary.

Struktur:

```text
Application -> Domain Repository Interface -> MyBatis Repository Implementation -> MyBatis Mapper/DAO -> SQL
```

Atau untuk aplikasi data-centric sederhana:

```text
Application -> MyBatis Mapper/DAO
```

Yang penting: jangan berpura-pura punya domain repository jika semua method tetap SQL/table oriented.

---

### 25.5 “Bagaimana Menghindari N+1 di Repository?”

1. Jangan return aggregate untuk read list besar.
2. Pakai projection.
3. Definisikan fetch plan per use case.
4. Test query count.
5. Log repository operation name.
6. Hindari serialization entity langsung.
7. Jangan expose lazy collection ke luar boundary.

---

## 26. Final Mental Model

Persistence pattern bukan tentang nama class.

DAO, Repository, Data Mapper, Unit of Work, dan Query Object adalah cara mengelola lima risiko:

```text
1. Domain contamination
2. Query cost invisibility
3. Consistency boundary confusion
4. Schema coupling
5. Data access sprawl
```

Ringkasnya:

```text
DAO:
  Isolasi akses data teknis.

Repository:
  Koleksi konseptual aggregate/domain object.

Data Mapper:
  Translation antara domain dan storage.

Unit of Work:
  Boundary perubahan yang committed bersama.

Query Object:
  Query sebagai konsep eksplisit, tervalidasi, composable, dan observable.
```

Keputusan paling penting:

```text
Jangan membuat abstraction untuk menyembunyikan database.
Buat abstraction untuk mengontrol dependency, intention, consistency, dan cost.
```

Database adalah bagian dari desain sistem, bukan detail yang bisa diabaikan. Persistence boundary yang baik tidak membuat database “hilang”; ia membuat hubungan antara domain dan database menjadi eksplisit, aman, dan bisa berevolusi.

---

## 27. Ringkasan

Di part ini kita mempelajari:

1. DAO sebagai data access abstraction teknis.
2. Repository sebagai domain collection abstraction.
3. Data Mapper sebagai translation boundary.
4. Unit of Work sebagai consistency boundary.
5. Query Object sebagai explicit query model.
6. Perbedaan DAO vs Repository.
7. Kenapa Generic Repository sering menjadi anti-pattern.
8. Kenapa read/write repository sering perlu dipisah.
9. Bagaimana query object mengatasi method explosion.
10. Bagaimana transaction boundary harus dikontrol application use case.
11. Bagaimana optimistic locking harus muncul dalam contract.
12. Bagaimana observability persistence harus didesain.
13. Bagaimana security dan access scope masuk query boundary.
14. Bagaimana melakukan refactoring bertahap dari persistence layer yang kacau.

Part berikutnya akan membahas:

```text
20-dto-mapper-assembler-presenter-view-model-boundary.md
```

Topik berikutnya akan memperdalam boundary model antar layer:

```text
DTO vs Command vs Event vs View Model
Mapper vs Assembler vs Presenter
Input model vs output model
Versioned DTO
Universal DTO anti-pattern
Entity exposed as API anti-pattern
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./18-service-layer-application-service-domain-service-transaction-script.md">⬅️ Part 18 — Service Layer, Application Service, Domain Service, Transaction Script</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./20-dto-mapper-assembler-presenter-view-model-boundary.md">Part 20 — DTO, Mapper, Assembler, Presenter, View Model Boundary ➡️</a>
</div>

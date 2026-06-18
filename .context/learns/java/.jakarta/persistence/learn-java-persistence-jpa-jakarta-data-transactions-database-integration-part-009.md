# Part 009 — Projection, DTO, Read Model, and Reporting Queries

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-009.md`  
> Status seri: **belum selesai** — ini **Part 009 dari 032**  
> Fokus: memisahkan entity loading dari read use case, mendesain projection/read model/reporting query yang benar, efisien, aman, dan maintainable.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan perbedaan antara **entity**, **DTO**, **projection**, **read model**, **reporting model**, dan **view model**.
2. Memutuskan kapan query harus mengembalikan entity dan kapan harus mengembalikan DTO/projection.
3. Mendesain query baca yang tidak menyebabkan over-fetching, N+1, accidental update, persistence context bloat, atau transaction boundary leak.
4. Menggunakan JPQL constructor expression, tuple, scalar result, record projection, interface projection, native query projection, dan `@SqlResultSetMapping` secara tepat.
5. Mendesain read model untuk listing, detail page, dashboard, export, reporting, search, dan audit/history screen.
6. Memahami kenapa reporting query sering tidak cocok dimodelkan sebagai graph entity.
7. Menentukan strategi pagination, sorting, filtering, count query, dan query ownership.
8. Menilai trade-off antara ORM query, native SQL, database view/materialized view, read replica, search engine, dan warehouse/reporting database.
9. Membuat checklist agar persistence read path tetap predictable di production.

---

## 2. Mental Model: Jangan Selalu Membaca Database Sebagai Entity Graph

Banyak developer memulai JPA dengan pola seperti ini:

```java
List<Case> cases = caseRepository.findAll();
```

Lalu UI butuh listing:

```text
Case No | Applicant Name | Status | Submitted Date | Assigned Officer | SLA Due Date
```

Kemudian developer memaksa entity graph `Case` membawa semuanya:

```java
@Entity
class Case {
    @ManyToOne Applicant applicant;
    @ManyToOne Officer assignedOfficer;
    @OneToMany List<CaseEvent> events;
    @OneToMany List<Document> documents;
    @OneToMany List<Correspondence> correspondences;
}
```

Masalahnya: **screen listing tidak membutuhkan seluruh aggregate**. Ia hanya butuh beberapa kolom hasil join/filter/sort. Jika kita selalu load entity, kita membayar biaya yang tidak perlu:

- lebih banyak row dibaca,
- lebih banyak column dibaca,
- lebih banyak object Java dibuat,
- lebih banyak association berpotensi lazy-load,
- persistence context membesar,
- dirty checking ikut bekerja,
- risiko entity berubah tanpa sengaja,
- serialization bisa menyentuh lazy association,
- query plan bisa memburuk,
- pagination bisa rusak jika fetch join collection.

Mental model yang benar:

```text
Write use case  -> butuh entity/aggregate untuk menjaga invariant.
Read use case   -> butuh shape data yang sesuai kebutuhan layar/proses.
Reporting query -> butuh analytical shape, bukan domain aggregate.
```

JPA entity adalah alat untuk **persistence state dan transactional consistency**, bukan format universal untuk semua output.

---

## 3. Vocabulary yang Harus Dibedakan

### 3.1 Entity

Entity adalah object yang punya persistence identity dan dikelola oleh persistence context.

Ciri utama:

- punya `@Id`,
- bisa berada dalam state transient/managed/detached/removed,
- bisa di-dirty-check,
- bisa menyebabkan SQL saat flush,
- bisa punya lazy association/proxy,
- digunakan untuk update state/invariant dalam transaction.

Entity cocok untuk:

- command/write use case,
- state transition,
- aggregate consistency,
- domain invariant,
- relationship lifecycle,
- audit/update behavior.

Entity tidak selalu cocok untuk:

- listing besar,
- dashboard,
- export,
- reporting,
- search result,
- API response langsung,
- cross-aggregate read model.

---

### 3.2 DTO

DTO adalah object pembawa data. Ia tidak dikelola persistence context.

Ciri utama:

- tidak punya lifecycle JPA,
- tidak di-dirty-check,
- tidak memiliki lazy loading,
- shape-nya bisa spesifik use case,
- aman untuk API boundary bila didesain eksplisit.

Contoh:

```java
public record CaseListItemDto(
        Long caseId,
        String caseNo,
        String applicantName,
        String status,
        Instant submittedAt,
        Instant slaDueAt
) {}
```

DTO cocok untuk:

- REST response,
- list item,
- detail read-only screen,
- export row,
- dashboard card,
- integration output,
- reporting result.

---

### 3.3 Projection

Projection adalah **hasil query yang hanya memilih subset data** atau bentuk data tertentu.

Projection bisa berbentuk:

- scalar values,
- `Object[]`,
- `Tuple`,
- DTO class,
- Java record,
- interface projection,
- nested projection,
- map-like result,
- native SQL result mapping.

Projection menjawab pertanyaan:

```text
Dari semua data yang ada, kolom/field apa yang benar-benar dibutuhkan use case ini?
```

---

### 3.4 Read Model

Read model adalah model yang sengaja didesain untuk membaca data sesuai kebutuhan query/UI/report tertentu.

Read model bisa berupa:

- DTO hasil query langsung,
- table denormalized,
- database view,
- materialized view,
- search index,
- Elasticsearch document,
- ClickHouse table,
- reporting schema,
- cached snapshot,
- read-side projection dari event/outbox/CDC.

Read model biasanya dipakai ketika:

- read shape sangat berbeda dari write model,
- query join terlalu mahal,
- dashboard butuh aggregation,
- report butuh historical snapshot,
- search/filter/sort kompleks,
- workload baca jauh lebih besar daripada tulis,
- data harus disajikan lintas aggregate.

---

### 3.5 View Model

View model adalah bentuk data yang cocok untuk UI tertentu.

Contoh:

```java
public record CaseDetailView(
        CaseHeader header,
        ApplicantSummary applicant,
        List<DocumentRow> documents,
        List<TimelineItem> timeline,
        List<ActionButton> allowedActions
) {}
```

View model bisa dibangun dari:

- satu query projection,
- beberapa query projection,
- entity + projection,
- read model table,
- service composition,
- cache.

View model bukan entity. Ia boleh sangat spesifik ke screen.

---

### 3.6 Reporting Model

Reporting model adalah model untuk analytical/read-heavy workload.

Ciri:

- sering join banyak table,
- sering aggregate `count`, `sum`, `avg`, `min`, `max`,
- sering group by status/date/officer/agency,
- sering filter by date range,
- sering export banyak row,
- sering tidak cocok dengan aggregate transactional.

Reporting model sebaiknya tidak dipaksa menjadi entity graph rumit.

---

## 4. Prinsip Utama: Entity untuk Mutasi, Projection untuk Membaca

Rule of thumb:

```text
Kalau tujuan query adalah mengubah state/invariant -> load entity/aggregate.
Kalau tujuan query adalah menampilkan/mengirim/melaporkan data -> gunakan projection/read model.
```

Contoh command use case:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseEntity c = caseRepository.findByIdForUpdate(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

    c.approve(command.officerId(), command.reason());

    auditTrail.recordApproval(c.id(), command.officerId(), command.reason());
}
```

Di sini entity masuk akal karena:

- butuh invariant status,
- butuh version/locking,
- butuh state transition,
- butuh dirty checking/update,
- butuh transaction boundary.

Contoh read use case:

```java
@Transactional(readOnly = true)
public Page<CaseListItemDto> searchCases(CaseSearchFilter filter, PageRequest page) {
    return caseQueryRepository.searchList(filter, page);
}
```

Di sini projection lebih cocok karena:

- tidak perlu mutasi,
- butuh sedikit kolom,
- butuh pagination,
- butuh sorting/filtering,
- tidak perlu persistence context besar.

---

## 5. Kenapa Mengembalikan Entity untuk Semua Query Itu Berbahaya

### 5.1 Over-fetching

Entity biasanya membawa lebih banyak field daripada yang dibutuhkan.

Screen hanya butuh:

```text
case_no, status, applicant_name
```

Tetapi entity bisa membawa:

```text
id, case_no, status, description, remarks, created_by, updated_by,
large_text, metadata_clob, applicant_id, assigned_officer_id, ...
```

Jika ada association, biayanya makin besar.

---

### 5.2 Accidental Lazy Loading

Entity yang dikirim ke mapper/serializer bisa menyentuh association:

```java
caseEntity.getApplicant().getName();
caseEntity.getDocuments().size();
```

Kalau masih dalam session, ini bisa menghasilkan N+1. Kalau session sudah tutup, bisa terjadi lazy loading exception.

---

### 5.3 Persistence Context Bloat

Jika query return 10.000 entity managed, persistence context menyimpan 10.000 managed instances plus snapshot untuk dirty checking.

Dampak:

- memory naik,
- GC pressure naik,
- flush makin mahal,
- risk OOM pada batch/export,
- transaction makin lama.

Projection tidak masuk persistence context sebagai managed entity.

---

### 5.4 Accidental Update

Jika service read-only mengambil managed entity lalu mapper/helper mengubah field, perubahan itu bisa ikut ter-flush.

Contoh buruk:

```java
@Transactional
public CaseDto getCase(Long id) {
    CaseEntity c = entityManager.find(CaseEntity.class, id);

    // Seharusnya hanya formatting untuk response,
    // tapi ini mengubah managed entity.
    c.setDisplayStatus(formatStatus(c.getStatus()));

    return mapper.toDto(c);
}
```

Jika transaction melakukan flush, update yang tidak disengaja bisa terjadi.

---

### 5.5 API Contract Menjadi Terikat Entity

Jika entity langsung jadi response, perubahan schema/domain bisa memecahkan API.

Masalah:

- field internal bocor,
- lazy association bocor,
- bidirectional relation menyebabkan recursion,
- sensitive field terekspos,
- entity annotation bercampur JSON annotation,
- API versioning sulit.

---

### 5.6 Query Plan Tidak Terkontrol

Entity fetch sering membuat developer fokus ke object graph, bukan SQL aktual.

Padahal database menjalankan:

- select column list,
- join,
- predicate,
- sort,
- group by,
- index scan,
- nested loop/hash join,
- row estimation,
- temporary sort,
- disk spill.

Projection memaksa kita mendesain query shape secara eksplisit.

---

## 6. Tipe Projection di JPA/Hibernate/Spring Data/Jakarta Data

## 6.1 Scalar Projection

Scalar projection memilih nilai sederhana.

```java
List<String> caseNumbers = entityManager.createQuery("""
        select c.caseNo
        from CaseEntity c
        where c.status = :status
        order by c.submittedAt desc
        """, String.class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .getResultList();
```

Cocok untuk:

- list id,
- list code,
- count,
- simple value lookup,
- existence check.

Kelemahan:

- tidak cocok untuk multi-column result kecuali dibungkus DTO/Tuple.

---

## 6.2 `Object[]` Projection

```java
List<Object[]> rows = entityManager.createQuery("""
        select c.id, c.caseNo, a.name
        from CaseEntity c
        join c.applicant a
        where c.status = :status
        """, Object[].class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .getResultList();

for (Object[] row : rows) {
    Long id = (Long) row[0];
    String caseNo = (String) row[1];
    String applicantName = (String) row[2];
}
```

Ini legal tetapi rapuh.

Problem:

- index-based,
- mudah salah urutan,
- refactor sulit,
- type safety rendah,
- readability buruk.

Gunakan hanya untuk quick internal query kecil, bukan code produksi besar.

---

## 6.3 `Tuple` Projection

```java
List<Tuple> rows = entityManager.createQuery("""
        select c.id as caseId,
               c.caseNo as caseNo,
               a.name as applicantName
        from CaseEntity c
        join c.applicant a
        where c.status = :status
        """, Tuple.class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .getResultList();

for (Tuple row : rows) {
    Long caseId = row.get("caseId", Long.class);
    String caseNo = row.get("caseNo", String.class);
    String applicantName = row.get("applicantName", String.class);
}
```

Lebih baik dari `Object[]`, tetapi masih kurang ideal untuk business-level code.

Cocok untuk:

- dynamic columns,
- internal query builder,
- report engine,
- generic export.

Kurang cocok untuk:

- stable use-case API,
- domain/application service yang butuh type-safe DTO.

---

## 6.4 JPQL Constructor Expression

JPQL mendukung constructor expression:

```java
public record CaseListItemDto(
        Long caseId,
        String caseNo,
        String applicantName,
        CaseStatus status,
        Instant submittedAt
) {}
```

```java
List<CaseListItemDto> rows = entityManager.createQuery("""
        select new com.example.caseapp.query.CaseListItemDto(
            c.id,
            c.caseNo,
            a.name,
            c.status,
            c.submittedAt
        )
        from CaseEntity c
        join c.applicant a
        where c.status = :status
        order by c.submittedAt desc
        """, CaseListItemDto.class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .getResultList();
```

Kelebihan:

- type-safe result,
- tidak managed,
- tidak dirty-checked,
- explicit column selection,
- cocok untuk list/detail read-only.

Kekurangan:

- class name harus fully qualified dalam JPQL,
- constructor signature harus cocok,
- query bisa verbose,
- nested collection DTO tidak natural,
- refactor package/class name harus hati-hati.

Gunakan untuk read use case yang shape-nya stabil.

---

## 6.5 Java Record sebagai DTO Projection

Java record sangat cocok untuk projection:

```java
public record OfficerWorkloadDto(
        Long officerId,
        String officerName,
        long openCaseCount,
        long overdueCaseCount
) {}
```

Query:

```java
List<OfficerWorkloadDto> result = entityManager.createQuery("""
        select new com.example.report.OfficerWorkloadDto(
            o.id,
            o.name,
            count(c.id),
            sum(case when c.slaDueAt < current_timestamp then 1 else 0 end)
        )
        from OfficerEntity o
        left join CaseEntity c on c.assignedOfficer = o
        group by o.id, o.name
        order by count(c.id) desc
        """, OfficerWorkloadDto.class)
    .getResultList();
```

Kenapa record bagus:

- immutable,
- concise,
- jelas sebagai data carrier,
- cocok untuk API/read model,
- tidak memberi ilusi entity.

Catatan penting:

- record bukan pilihan natural untuk entity JPA klasik karena entity biasanya perlu constructor no-arg, non-final class/field, proxying, dan lifecycle management.
- record sangat bagus sebagai DTO/projection.

---

## 6.6 Interface Projection pada Spring Data JPA

Spring Data JPA mendukung interface-based projection:

```java
public interface CaseListItemView {
    Long getCaseId();
    String getCaseNo();
    String getApplicantName();
    CaseStatus getStatus();
}
```

Repository:

```java
public interface CaseRepository extends JpaRepository<CaseEntity, Long> {

    @Query("""
            select c.id as caseId,
                   c.caseNo as caseNo,
                   a.name as applicantName,
                   c.status as status
            from CaseEntity c
            join c.applicant a
            where c.status = :status
            """)
    List<CaseListItemView> findListItemsByStatus(CaseStatus status);
}
```

Kelebihan:

- ringkas,
- nyaman untuk simple projection,
- bisa dipakai dengan derived query,
- tidak perlu constructor expression manual dalam beberapa kasus.

Risiko:

- magic by alias/name,
- nested projection bisa menyebabkan join/fetch tidak selalu obvious,
- mudah menjadi terlalu implicit,
- debugging SQL tetap wajib.

Gunakan untuk simple read. Untuk query kompleks, DTO/record projection eksplisit sering lebih mudah dirawat.

---

## 6.7 Class-Based Projection pada Spring Data JPA

```java
public record CaseSummaryDto(
        Long id,
        String caseNo,
        String applicantName
) {}
```

Repository:

```java
public interface CaseRepository extends JpaRepository<CaseEntity, Long> {

    @Query("""
            select new com.example.caseapp.CaseSummaryDto(
                c.id,
                c.caseNo,
                a.name
            )
            from CaseEntity c
            join c.applicant a
            where c.status = :status
            """)
    List<CaseSummaryDto> findSummaries(CaseStatus status);
}
```

Spring Data JPA juga punya dukungan DTO projection dari derived query pada kondisi tertentu, tetapi untuk query penting lebih baik eksplisit.

---

## 6.8 Dynamic Projection pada Spring Data JPA

```java
interface CaseRepository extends JpaRepository<CaseEntity, Long> {
    <T> List<T> findByStatus(CaseStatus status, Class<T> type);
}
```

Pemakaian:

```java
List<CaseListItemView> list = repo.findByStatus(SUBMITTED, CaseListItemView.class);
List<CaseEntity> entities = repo.findByStatus(SUBMITTED, CaseEntity.class);
```

Kelebihan:

- fleksibel.

Risiko:

- query ownership menjadi kabur,
- performance shape bisa berbeda antar caller,
- mudah dipakai sebagai generic shortcut berlebihan.

Gunakan dengan disiplin, bukan sebagai default.

---

## 6.9 Native Query Projection

Native SQL cocok saat:

- butuh window function,
- recursive CTE,
- vendor-specific function,
- complex reporting,
- optimizer hint,
- JSON operator,
- lateral join,
- analytical query,
- query lebih jelas dalam SQL daripada JPQL.

Contoh dengan Spring Data interface projection:

```java
public interface MonthlyCaseStatView {
    String getMonth();
    Long getSubmittedCount();
    Long getApprovedCount();
    Long getRejectedCount();
}
```

```java
@Query(value = """
        select to_char(c.submitted_at, 'YYYY-MM') as month,
               count(*) as submittedCount,
               sum(case when c.status = 'APPROVED' then 1 else 0 end) as approvedCount,
               sum(case when c.status = 'REJECTED' then 1 else 0 end) as rejectedCount
        from cases c
        where c.submitted_at >= :from
          and c.submitted_at < :to
        group by to_char(c.submitted_at, 'YYYY-MM')
        order by month
        """, nativeQuery = true)
List<MonthlyCaseStatView> monthlyStats(Instant from, Instant to);
```

Catatan:

- alias harus cocok dengan projection getter.
- SQL native tidak portable.
- Vendor-specific behavior harus disengaja dan didokumentasikan.

---

## 6.10 `@SqlResultSetMapping`

JPA menyediakan mapping native result ke DTO/entity/scalar dengan `@SqlResultSetMapping`.

Contoh konseptual:

```java
@SqlResultSetMapping(
    name = "CaseExportRowMapping",
    classes = @ConstructorResult(
        targetClass = CaseExportRow.class,
        columns = {
            @ColumnResult(name = "case_no", type = String.class),
            @ColumnResult(name = "applicant_name", type = String.class),
            @ColumnResult(name = "status", type = String.class),
            @ColumnResult(name = "submitted_at", type = Instant.class)
        }
    )
)
@Entity
class CaseEntity {
    @Id
    private Long id;
}
```

Query:

```java
List<CaseExportRow> rows = entityManager
    .createNativeQuery("""
        select c.case_no,
               a.name as applicant_name,
               c.status,
               c.submitted_at
        from cases c
        join applicants a on a.id = c.applicant_id
        where c.submitted_at >= ?
        """, "CaseExportRowMapping")
    .setParameter(1, from)
    .getResultList();
```

Kelebihan:

- standard JPA,
- eksplisit,
- cocok untuk native SQL stabil.

Kelemahan:

- verbose,
- mapping annotation sering terasa jauh dari query,
- refactor perlu hati-hati.

---

## 7. Entity Result vs DTO Result: Decision Matrix

| Use case | Return entity? | Return projection/DTO? | Reasoning |
|---|---:|---:|---|
| Approve case | Yes | Usually no | Butuh invariant, version, state transition |
| Edit draft form load | Maybe | Maybe | Jika form sangat dekat aggregate, entity bisa; jika API response, DTO tetap bagus |
| Listing cases | No | Yes | Butuh kolom terbatas, pagination, sorting |
| Dashboard count by status | No | Yes | Aggregation, bukan aggregate mutation |
| Export CSV 100k rows | No | Yes | Streaming/projection lebih hemat memory |
| Audit timeline | No/maybe | Yes | Biasanya read-only chronological view |
| Load aggregate for domain command | Yes | No | Butuh consistency boundary |
| Report monthly SLA | No | Yes | Analytical query |
| Search with many filters | No | Yes | Query/read model oriented |
| Internal admin repair tool | Maybe | Maybe | Tergantung apakah akan mutate state |

Rule sederhana:

```text
Entity adalah write model default.
Projection adalah read model default.
```

Tetapi jangan dogmatis. Kadang detail read yang kecil boleh load entity jika:

- entity sederhana,
- association terkendali,
- data sedikit,
- tidak terekspos keluar langsung,
- performance sudah diukur,
- risk accidental update rendah.

---

## 8. Designing Listing Query

Listing query adalah salah satu use case paling sering salah.

Contoh kebutuhan:

```text
Search Cases:
- caseNo contains
- applicantName contains
- status in list
- submittedAt from/to
- assignedOfficerId optional
- sort by submittedAt, status, SLA due date
- page size 20/50/100
```

Jangan mulai dari:

```java
Page<CaseEntity> findAll(Specification<CaseEntity> spec, Pageable pageable);
```

Lalu mapper menyentuh applicant/officer. Ini mudah menyebabkan N+1.

Lebih baik desain projection query:

```java
public record CaseSearchRow(
        Long id,
        String caseNo,
        String applicantName,
        CaseStatus status,
        String assignedOfficerName,
        Instant submittedAt,
        Instant slaDueAt
) {}
```

Query repository:

```java
public interface CaseQueryRepository {
    Page<CaseSearchRow> search(CaseSearchCriteria criteria, PageRequest pageRequest);
}
```

Implementation bisa memakai:

- JPQL dynamic string builder,
- Criteria API,
- QueryDSL,
- Blaze-Persistence,
- jOOQ,
- native SQL,
- Spring Data Specification with projection pattern,
- database view.

Yang penting: **query result shape eksplisit**.

---

## 9. Filtering: Jangan Membangun Query dengan String Concatenation Sembarangan

Buruk:

```java
String jpql = "select c from CaseEntity c where 1=1";

if (filter.caseNo() != null) {
    jpql += " and c.caseNo like '%" + filter.caseNo() + "%'";
}
```

Masalah:

- injection risk,
- escaping buruk,
- query plan cache buruk,
- sulit maintain,
- sulit test.

Lebih baik parameterized:

```java
StringBuilder jpql = new StringBuilder("""
        select new com.example.CaseSearchRow(
            c.id, c.caseNo, a.name, c.status, o.name, c.submittedAt, c.slaDueAt
        )
        from CaseEntity c
        join c.applicant a
        left join c.assignedOfficer o
        where 1 = 1
        """);

Map<String, Object> params = new HashMap<>();

if (filter.caseNo() != null && !filter.caseNo().isBlank()) {
    jpql.append(" and lower(c.caseNo) like :caseNo");
    params.put("caseNo", "%" + filter.caseNo().toLowerCase(Locale.ROOT) + "%");
}

if (!filter.statuses().isEmpty()) {
    jpql.append(" and c.status in :statuses");
    params.put("statuses", filter.statuses());
}
```

Untuk sistem besar, lebih baik gunakan query builder/specification abstraction agar:

- predicate reusable,
- sorting whitelist,
- testing lebih mudah,
- SQL/JPQL tetap parameterized.

---

## 10. Sorting: Jangan Percaya Field dari Request Secara Langsung

Buruk:

```java
jpql.append(" order by c." + request.sortField());
```

Ini membuka risiko:

- invalid field,
- injection-like abuse,
- sorting pada column tanpa index,
- sorting pada expression mahal,
- ambiguous business semantics.

Lebih baik whitelist:

```java
public enum CaseSortKey {
    CASE_NO,
    STATUS,
    SUBMITTED_AT,
    SLA_DUE_AT,
    APPLICANT_NAME
}
```

Mapping:

```java
String orderExpression = switch (sort.key()) {
    case CASE_NO -> "c.caseNo";
    case STATUS -> "c.status";
    case SUBMITTED_AT -> "c.submittedAt";
    case SLA_DUE_AT -> "c.slaDueAt";
    case APPLICANT_NAME -> "a.name";
};

jpql.append(" order by ").append(orderExpression)
    .append(sort.direction().isAscending() ? " asc" : " desc");
```

Untuk pagination stabil, tambahkan tie-breaker:

```sql
order by c.submitted_at desc, c.id desc
```

Tanpa tie-breaker, data bisa muncul di page berbeda ketika banyak row punya timestamp sama.

---

## 11. Pagination: Offset vs Keyset

### 11.1 Offset Pagination

Offset pagination umum:

```java
query.setFirstResult(page * size);
query.setMaxResults(size);
```

SQL biasanya:

```sql
limit 50 offset 1000
```

atau vendor equivalent.

Kelebihan:

- mudah,
- cocok untuk UI page number,
- didukung framework.

Kelemahan:

- makin dalam page, makin mahal,
- data bisa bergeser saat ada insert/delete,
- butuh count query jika ingin total pages.

Cocok untuk:

- listing kecil/menengah,
- admin UI,
- page awal yang paling sering diakses.

---

### 11.2 Keyset Pagination

Keyset pagination memakai posisi terakhir:

```sql
where (submitted_at, id) < (:lastSubmittedAt, :lastId)
order by submitted_at desc, id desc
fetch first 50 rows only
```

Atau JPQL equivalent dengan predicate compound:

```java
where c.submittedAt < :lastSubmittedAt
   or (c.submittedAt = :lastSubmittedAt and c.id < :lastId)
```

Kelebihan:

- stabil untuk infinite scroll,
- lebih efisien untuk deep pagination,
- tidak perlu offset besar.

Kelemahan:

- tidak cocok untuk random page number,
- butuh sort key unik/stabil,
- lebih kompleks.

Cocok untuk:

- activity feed,
- audit timeline,
- export chunk,
- high-volume list,
- infinite scroll.

---

## 12. Count Query Problem

Framework pagination sering menjalankan dua query:

1. content query,
2. count query.

Contoh:

```sql
select ... from cases ... where ... order by ... limit 50 offset 0;
select count(*) from cases ... where ...;
```

Pada query sederhana, ini OK. Pada query kompleks, count bisa lebih mahal dari content query.

Masalah umum:

- count dengan banyak join,
- count distinct karena to-many join,
- filter complex,
- permission/security predicate,
- table besar,
- date range luas,
- no selective index.

Strategi:

1. Gunakan `Slice` bukan `Page` jika total count tidak wajib.
2. Load `size + 1` untuk tahu ada next page.
3. Hitung count secara async/cache jika hanya untuk display kasar.
4. Batasi filter/report yang terlalu luas.
5. Gunakan materialized view/summary table untuk dashboard.
6. Gunakan approximate count bila acceptable.
7. Tulis count query khusus, jangan otomatis dari content query.

Contoh slice:

```java
List<CaseSearchRow> rows = query
    .setMaxResults(size + 1)
    .getResultList();

boolean hasNext = rows.size() > size;
if (hasNext) {
    rows = rows.subList(0, size);
}
```

---

## 13. Projection untuk Detail Page

Detail page sering lebih kompleks daripada listing.

Contoh Case Detail:

```text
Header:
- case no
- status
- submitted at
- SLA

Applicant:
- name
- id no masked
- contact

Documents:
- filename
- type
- uploaded at

Timeline:
- event type
- actor
- timestamp
- remarks

Allowed actions:
- approve
- reject
- request info
```

Jangan otomatis load `CaseEntity` dengan semua association. Pertimbangkan composition:

```java
public record CaseDetailView(
        CaseHeaderDto header,
        ApplicantSummaryDto applicant,
        List<DocumentRowDto> documents,
        List<TimelineItemDto> timeline,
        List<ActionDto> allowedActions
) {}
```

Service read:

```java
@Transactional(readOnly = true)
public CaseDetailView getDetail(Long caseId, UserContext user) {
    CaseHeaderDto header = caseQuery.findHeader(caseId, user);
    ApplicantSummaryDto applicant = caseQuery.findApplicantSummary(caseId);
    List<DocumentRowDto> documents = documentQuery.findRowsByCaseId(caseId);
    List<TimelineItemDto> timeline = timelineQuery.findByCaseId(caseId);
    List<ActionDto> actions = actionPolicy.allowedActions(header.status(), user);

    return new CaseDetailView(header, applicant, documents, timeline, actions);
}
```

Ini beberapa query, tetapi bisa lebih benar daripada satu mega-join.

Kenapa?

- Menghindari cartesian explosion.
- Setiap collection punya pagination/sorting sendiri jika perlu.
- Query lebih mudah dioptimasi.
- Data shape eksplisit.
- Tidak perlu fetch join banyak collection.

Jangan menganggap “satu query selalu lebih cepat”. Kadang 4 query kecil dengan index jelas lebih baik daripada 1 query monster.

---

## 14. Cartesian Explosion pada Join Banyak Collection

Misal:

```text
Case punya 5 documents
Case punya 10 timeline events
Case punya 3 correspondences
```

Jika query join semuanya:

```sql
case join documents join timeline join correspondences
```

Jumlah row bisa menjadi:

```text
1 * 5 * 10 * 3 = 150 rows
```

Padahal logical result hanya:

```text
1 case + 5 docs + 10 events + 3 correspondences
```

Ini disebut cartesian multiplication/explosion.

Solusi:

- query collection secara terpisah,
- gunakan DTO composition,
- gunakan batch fetching untuk entity graph tertentu,
- gunakan JSON aggregation native SQL bila cocok,
- gunakan read model denormalized,
- hindari fetch join banyak collection.

---

## 15. Reporting Queries: Jangan Paksa Masuk Entity Model

Reporting query sering membutuhkan bentuk data seperti:

```sql
select agency,
       status,
       count(*) as total,
       avg(processing_days) as avg_processing_days,
       percentile_cont(0.95) within group (order by processing_days) as p95
from case_report_view
where submitted_date between :from and :to
  and agency in (:agencies)
group by agency, status
order by agency, status;
```

Mencoba memodelkan ini sebagai entity graph akan menghasilkan desain buruk.

Reporting lebih cocok dengan:

- DTO projection,
- native SQL,
- database view,
- materialized view,
- reporting table,
- data warehouse,
- OLAP database,
- search/analytics engine.

JPA/Hibernate boleh tetap digunakan untuk menjalankan query, tetapi tidak semua query harus menjadi entity query.

---

## 16. Database View dan Materialized View sebagai Read Model

### 16.1 Database View

Database view cocok ketika:

- join logic sering dipakai,
- security/permission predicate bisa dipusatkan,
- query read stabil,
- ingin menyederhanakan application query.

Contoh:

```sql
create view case_listing_view as
select c.id,
       c.case_no,
       c.status,
       c.submitted_at,
       c.sla_due_at,
       a.name as applicant_name,
       o.name as assigned_officer_name
from cases c
join applicants a on a.id = c.applicant_id
left join officers o on o.id = c.assigned_officer_id;
```

Bisa dibaca via native query atau mapped read-only entity.

Read-only entity:

```java
@Entity
@Table(name = "case_listing_view")
@org.hibernate.annotations.Immutable
public class CaseListingViewEntity {
    @Id
    private Long id;

    private String caseNo;
    private String applicantName;
    private CaseStatus status;
    private Instant submittedAt;
    private Instant slaDueAt;
}
```

Catatan:

- `@Immutable` adalah Hibernate-specific.
- View entity jangan dipakai untuk write.
- Pastikan view punya stable unique key untuk `@Id`.

---

### 16.2 Materialized View

Materialized view cocok ketika:

- query mahal,
- data boleh sedikit stale,
- dashboard/report butuh cepat,
- aggregation besar,
- query source table terlalu berat.

Trade-off:

- refresh strategy,
- staleness,
- locking saat refresh,
- storage tambahan,
- monitoring freshness.

Untuk dashboard regulatory:

```text
Open cases by status per agency can tolerate 5-minute lag?
-> materialized/summary table acceptable.

Officer action screen must show current assignable case?
-> must query transactional source or strongly consistent read model.
```

---

## 17. Read Model Table / Denormalized Projection

Jika view/materialized view tidak cukup, buat table read model.

Contoh:

```sql
create table case_search_read_model (
    case_id bigint primary key,
    case_no varchar(50) not null,
    applicant_name varchar(200) not null,
    applicant_identifier_masked varchar(50),
    status varchar(50) not null,
    assigned_officer_name varchar(200),
    submitted_at timestamp,
    sla_due_at timestamp,
    searchable_text text,
    updated_at timestamp not null
);
```

Update read model bisa melalui:

- synchronous update dalam transaction yang sama,
- domain event handler,
- outbox + async projector,
- CDC pipeline,
- scheduled rebuild,
- batch backfill.

Pertanyaan penting:

```text
Apakah read model harus strongly consistent atau boleh eventually consistent?
```

Untuk operational screen yang memutuskan action, sering butuh fresh data. Untuk reporting/dashboard, eventual consistency biasanya acceptable jika jelas.

---

## 18. CQRS Ringan tanpa Overengineering

CQRS bukan berarti microservice/event sourcing wajib.

CQRS ringan cukup berarti:

```text
Command path dan query path boleh punya model berbeda.
```

Contoh struktur:

```text
case/
  command/
    ApproveCaseService.java
    SubmitCaseService.java
    CaseEntity.java
    CaseRepository.java
  query/
    CaseSearchQueryRepository.java
    CaseDetailQueryRepository.java
    CaseSearchRow.java
    CaseDetailView.java
```

Command path:

- entity,
- aggregate,
- transaction,
- invariant,
- lock/version.

Query path:

- projection,
- DTO,
- optimized SQL,
- pagination,
- sorting,
- read-only transaction.

Ini sering cukup untuk sistem enterprise besar tanpa langsung masuk event sourcing penuh.

---

## 19. DTO Mapping Strategy

Ada tiga pendekatan umum.

### 19.1 Query Directly to DTO

```java
select new com.example.CaseListItemDto(...)
```

Kelebihan:

- paling efisien untuk read,
- column eksplisit,
- no managed entity.

Kekurangan:

- query tied to DTO constructor,
- kurang fleksibel untuk logic mapping kompleks.

Cocok untuk:

- listing,
- report row,
- simple detail block,
- export.

---

### 19.2 Entity to DTO Mapping

```java
CaseEntity entity = repo.findById(id).orElseThrow();
return mapper.toDto(entity);
```

Kelebihan:

- mudah untuk detail kecil,
- reuse aggregate loading,
- mapping logic bisa di Java.

Kekurangan:

- risk lazy loading,
- over-fetching,
- accidental update,
- persistence context cost.

Cocok jika:

- entity memang dibutuhkan,
- graph kecil,
- fetch plan jelas,
- tidak untuk listing besar.

---

### 19.3 Hybrid Composition

```java
CaseHeaderDto header = query.findHeader(id);
List<DocumentRowDto> docs = query.findDocuments(id);
List<TimelineDto> timeline = query.findTimeline(id);
```

Kelebihan:

- avoids cartesian explosion,
- setiap bagian bisa dioptimasi,
- cocok untuk complex detail screen.

Kekurangan:

- lebih banyak query,
- composition logic perlu jelas,
- consistency snapshot perlu dipikirkan.

Jika consistency antar query penting, jalankan dalam read-only transaction dengan isolation sesuai database behavior.

---

## 20. Projection dan Transaction Boundary

Read-only projection tetap butuh transaction dalam banyak kasus.

Kenapa?

- konsistensi snapshot,
- connection lifecycle,
- lazy provider behavior tertentu,
- repeatable read requirement,
- streaming/cursor lifecycle,
- timeout management.

Contoh:

```java
@Transactional(readOnly = true)
public CaseDetailView getDetail(Long id) {
    CaseHeaderDto header = query.findHeader(id);
    List<DocumentRowDto> docs = query.findDocuments(id);
    List<TimelineItemDto> timeline = query.findTimeline(id);
    return new CaseDetailView(header, docs, timeline);
}
```

Tetapi read-only bukan magic performance switch universal.

Hal yang tetap harus dipikirkan:

- Apakah transaction terlalu lama?
- Apakah streaming keluar transaction?
- Apakah isolation cukup?
- Apakah query timeout diset?
- Apakah lock tidak sengaja diambil?

---

## 21. Projection dan Security/Authorization

Read query harus membawa authorization predicate.

Buruk:

```java
List<CaseSearchRow> rows = caseQuery.search(filter);
return rows.stream()
        .filter(row -> policy.canView(user, row))
        .toList();
```

Masalah:

- data unauthorized sudah keluar dari database,
- pagination salah,
- count salah,
- performance buruk,
- audit/security risk.

Lebih baik security predicate masuk query:

```sql
where c.agency_id in (:allowedAgencyIds)
  and c.security_level <= :userClearance
```

Atau join dengan permission table:

```sql
join officer_case_access access
  on access.case_id = c.id
 and access.officer_id = :officerId
```

Untuk sistem regulatory, ini critical. Projection bukan alasan untuk mengabaikan authorization.

---

## 22. Projection dan Sensitive Data

DTO harus eksplisit tentang field sensitif.

Buruk:

```java
public record ApplicantDto(
    String name,
    String nric,
    String email,
    String phone,
    String address
) {}
```

Jika screen hanya butuh masked identifier:

```java
public record ApplicantSummaryDto(
    String name,
    String maskedIdentifier
) {}
```

Masking bisa dilakukan:

- di query,
- di database function,
- di application mapper,
- di dedicated privacy service.

Pilih berdasarkan:

- auditability,
- consistency,
- data exposure risk,
- performance,
- regulatory requirement.

Prinsip:

```text
Jangan select sensitive column kalau use case tidak membutuhkannya.
```

Ini lebih kuat daripada select semua lalu masking belakangan.

---

## 23. Export Query dan Streaming

Export besar tidak boleh load semua entity atau semua DTO ke memory.

Buruk:

```java
List<CaseExportRow> rows = query.findAllForExport(filter);
return csvWriter.write(rows);
```

Untuk 1 juta row, ini bisa OOM.

Strategi:

1. Batasi maksimal export.
2. Gunakan streaming/cursor jika driver/database mendukung.
3. Gunakan pagination chunk/keyset.
4. Tulis langsung ke output/file per chunk.
5. Jalankan async job untuk export besar.
6. Simpan hasil export di object storage.
7. Audit siapa export apa dan kapan.
8. Masking data sensitif.

Chunked export:

```java
public void exportCases(CaseExportFilter filter, CsvSink sink) {
    ExportCursor cursor = ExportCursor.initial();

    while (true) {
        List<CaseExportRow> rows = caseExportQuery.fetchNext(filter, cursor, 1000);
        if (rows.isEmpty()) {
            break;
        }

        sink.write(rows);
        cursor = ExportCursor.fromLast(rows.get(rows.size() - 1));
    }
}
```

Untuk export, keyset pagination sering lebih stabil daripada offset.

---

## 24. Aggregation Query

Dashboard/report sering memakai aggregation.

Contoh DTO:

```java
public record CaseStatusCountDto(
        CaseStatus status,
        long total
) {}
```

JPQL:

```java
List<CaseStatusCountDto> rows = entityManager.createQuery("""
        select new com.example.CaseStatusCountDto(c.status, count(c.id))
        from CaseEntity c
        where c.submittedAt >= :from
          and c.submittedAt < :to
        group by c.status
        order by c.status
        """, CaseStatusCountDto.class)
    .setParameter("from", from)
    .setParameter("to", to)
    .getResultList();
```

Important details:

- `count` result biasanya `Long`, bukan `Integer`.
- Group by column harus sesuai query language/database.
- Filter date range gunakan half-open interval: `>= from` dan `< to`.
- Dashboard query harus punya index yang cocok.
- Jangan jalankan aggregation besar terlalu sering ke OLTP primary tanpa batas.

---

## 25. Window Function dan Native SQL

JPQL standard tidak selalu cukup untuk analytical query.

Contoh kebutuhan:

```text
Ambil latest event per case.
```

Native SQL dengan window function:

```sql
select *
from (
    select e.case_id,
           e.event_type,
           e.created_at,
           row_number() over (
               partition by e.case_id
               order by e.created_at desc, e.id desc
           ) as rn
    from case_events e
) x
where x.rn = 1;
```

Untuk query seperti ini, native SQL jauh lebih jelas daripada memaksa ORM association.

Prinsip:

```text
Gunakan JPQL untuk entity-oriented portable query.
Gunakan native SQL untuk database-native analytical/read model query jika manfaatnya jelas.
```

---

## 26. Projection dan Index Design

Projection bukan hanya tentang column list. Query tetap harus didukung index.

Contoh listing:

```sql
where status = ?
  and submitted_at >= ?
  and submitted_at < ?
order by submitted_at desc, id desc
limit 50
```

Index kandidat:

```sql
(status, submitted_at desc, id desc)
```

Tapi jika filter utama agency:

```sql
where agency_id = ?
  and status in (?, ?)
order by submitted_at desc, id desc
```

Index kandidat bisa berbeda:

```sql
(agency_id, status, submitted_at desc, id desc)
```

Mental model:

```text
DTO shape mengurangi data yang dikirim.
Index mengurangi data yang harus dicari/dibaca/disort database.
Keduanya berbeda dan sama-sama penting.
```

---

## 27. Avoiding N+1 with Projection

Projection sering menyelesaikan N+1 karena semua field yang dibutuhkan diambil dalam satu query eksplisit.

Entity approach buruk:

```java
List<CaseEntity> cases = repo.findByStatus(SUBMITTED);

return cases.stream()
    .map(c -> new CaseListItemDto(
        c.getId(),
        c.getCaseNo(),
        c.getApplicant().getName()
    ))
    .toList();
```

Jika `applicant` lazy, ini N+1.

Projection approach:

```java
select new com.example.CaseListItemDto(
    c.id,
    c.caseNo,
    a.name
)
from CaseEntity c
join c.applicant a
where c.status = :status
```

Satu query, shape jelas.

---

## 28. Projection dan Persistence Context

DTO result tidak managed, tetapi entity yang muncul dalam projection bisa tetap managed.

Contoh:

```java
select new com.example.CaseWithApplicantDto(c.id, a)
from CaseEntity c
join c.applicant a
```

Jika constructor menerima entity `a`, entity `ApplicantEntity` tersebut bisa managed. Ini membawa kembali risiko persistence context/lazy loading.

Lebih aman:

```java
select new com.example.CaseWithApplicantDto(c.id, a.id, a.name)
```

Rule:

```text
DTO projection sebaiknya berisi scalar/value, bukan managed entity, kecuali memang disengaja.
```

---

## 29. Nested DTO dan Collection Projection

JPQL constructor expression tidak natural untuk nested collection.

Misal ingin:

```json
{
  "caseNo": "C-001",
  "documents": [
    {"name":"a.pdf"},
    {"name":"b.pdf"}
  ]
}
```

Jangan memaksa satu JPQL constructor membuat nested list. Pilihan lebih baik:

### Option A — Multiple Queries + Compose

```java
CaseHeaderDto header = query.findHeader(caseId);
List<DocumentRowDto> docs = query.findDocuments(caseId);
return new CaseDetailDto(header, docs);
```

### Option B — Flat Rows + Group in Java

```java
public record CaseDocumentFlatRow(
    Long caseId,
    String caseNo,
    Long documentId,
    String documentName
) {}
```

Kemudian group by `caseId`.

Cocok untuk result kecil/menengah.

### Option C — Native SQL JSON Aggregation

Database modern bisa aggregate child rows ke JSON. Cocok untuk read API tertentu, tapi vendor-specific.

### Option D — Read Model

Precompute nested shape jika sering dipakai.

---

## 30. Query Ownership: Repository atau Query Repository?

Untuk aplikasi kecil, repository biasa cukup:

```java
interface CaseRepository extends JpaRepository<CaseEntity, Long> {
    List<CaseSummaryDto> findByStatus(CaseStatus status);
}
```

Untuk aplikasi besar, pisahkan:

```text
CaseRepository
- entity/aggregate persistence untuk command

CaseQueryRepository
- projection/read model/query use case
```

Contoh:

```java
public interface CaseRepository {
    Optional<CaseEntity> findById(Long id);
    void save(CaseEntity entity);
}

public interface CaseQueryRepository {
    Page<CaseSearchRow> search(CaseSearchCriteria criteria, PageRequest page);
    CaseDetailView findDetail(Long caseId);
    List<CaseStatusCountDto> countByStatus(Instant from, Instant to);
}
```

Manfaat:

- command/read responsibilities jelas,
- query kompleks tidak mencemari aggregate repository,
- return type tidak campur entity dan berbagai DTO berlebihan,
- lebih mudah optimasi.

---

## 31. Specification Pattern untuk Read Query

Specification sering dipakai untuk dynamic filtering.

Tetapi hati-hati: `Specification<CaseEntity>` biasanya entity-oriented.

Jika dipakai untuk listing projection, pastikan:

- predicate reusable,
- projection tetap eksplisit,
- join tidak menyebabkan duplicate row,
- count query benar,
- sorting whitelist,
- fetch join tidak masuk count query.

Alternatif yang sering lebih jelas:

```java
public final class CaseSearchCriteria {
    private String caseNo;
    private Set<CaseStatus> statuses;
    private Instant submittedFrom;
    private Instant submittedTo;
    private Long assignedOfficerId;
    private Long agencyId;
}
```

Lalu `CaseSearchQueryBuilder` membangun query projection.

Untuk sistem sangat query-heavy, pertimbangkan:

- QueryDSL,
- jOOQ,
- Blaze-Persistence,
- native SQL module,
- dedicated reporting schema.

---

## 32. DTO Versioning dan API Stability

Projection untuk API harus mempertimbangkan versioning.

Jangan ubah DTO publik sembarangan:

```java
public record CaseResponseV1(...)
public record CaseResponseV2(...)
```

Internal query DTO boleh berubah lebih bebas:

```java
record CaseListRowInternal(...)
```

Pisahkan:

```text
Query DTO -> internal application shape.
API DTO   -> external contract.
```

Kadang query DTO langsung menjadi API DTO acceptable, tetapi untuk public/partner API, pisahkan agar contract stabil.

---

## 33. Projection dan Validation

DTO projection biasanya read-only. Jangan campur dengan command validation.

Buruk:

```java
public class CaseDto {
    @NotBlank
    private String caseNo;
    private String status;
    private String applicantName;
}
```

Dipakai untuk:

- create request,
- update request,
- listing response,
- export row.

Ini membingungkan.

Lebih baik:

```java
public record CreateCaseRequest(...) {}
public record UpdateCaseRequest(...) {}
public record CaseListItemResponse(...) {}
public record CaseExportRow(...) {}
```

Input model dan output projection punya alasan desain berbeda.

---

## 34. Read-Only Entity: Kapan Boleh?

Read-only entity kadang berguna untuk database view atau lookup table.

Contoh lookup:

```java
@Entity
@Table(name = "module_dimension")
@Immutable
public class ModuleDimensionEntity {
    @Id
    private String code;
    private String displayName;
}
```

Cocok jika:

- data jarang berubah,
- table/view punya identity stabil,
- ingin association/query dengan JPA,
- tidak perlu update.

Tidak cocok jika:

- shape sangat spesifik report,
- no stable primary key,
- result aggregate/group by,
- query dynamic besar,
- data semestinya DTO.

---

## 35. Anti-Patterns

### Anti-Pattern 1 — Entity as API Response

```java
@GetMapping("/cases/{id}")
public CaseEntity get(@PathVariable Long id) {
    return repo.findById(id).orElseThrow();
}
```

Dampak:

- lazy loading issue,
- sensitive data leak,
- recursive JSON,
- API contract terikat schema,
- accidental over-fetching.

---

### Anti-Pattern 2 — Universal DTO

```java
class CaseDto {
    // 120 fields for every screen
}
```

Dampak:

- semua query berat,
- field semantics kabur,
- validation kacau,
- breaking change sering,
- maintenance buruk.

---

### Anti-Pattern 3 — Fetch Join Everything for Detail Page

```jpql
select c
from CaseEntity c
left join fetch c.documents
left join fetch c.timeline
left join fetch c.correspondences
left join fetch c.tasks
where c.id = :id
```

Dampak:

- cartesian explosion,
- duplicate root,
- memory besar,
- pagination impossible,
- SQL sulit dioptimasi.

---

### Anti-Pattern 4 — Reporting via Entity Iteration

```java
List<CaseEntity> cases = repo.findBySubmittedAtBetween(from, to);
Map<Status, Long> count = cases.stream()
    .collect(groupingBy(CaseEntity::getStatus, counting()));
```

Dampak:

- load ribuan/jutaan entity,
- aggregation seharusnya di database,
- memory/CPU app boros,
- lambat.

Lebih baik:

```sql
select status, count(*)
from cases
where submitted_at >= ? and submitted_at < ?
group by status;
```

---

### Anti-Pattern 5 — Filtering After Pagination

```java
Page<CaseEntity> page = repo.findAll(pageable);
List<CaseEntity> visible = page.stream()
    .filter(c -> canView(user, c))
    .toList();
```

Dampak:

- page kosong padahal data ada,
- total count salah,
- security risk,
- performance buruk.

Authorization/filter harus masuk query.

---

### Anti-Pattern 6 — Native SQL Everywhere Without Boundary

Native SQL bukan masalah. Yang buruk adalah native SQL menyebar tanpa ownership.

Dampak:

- duplicate query,
- inconsistent filter/security,
- vendor lock-in tidak terdokumentasi,
- migration sulit,
- test coverage lemah.

Solusi:

- query repository khusus,
- naming jelas,
- tests dengan real DB,
- comments untuk vendor-specific feature,
- explain plan untuk query kritikal.

---

## 36. Failure Modes Produksi

### 36.1 Listing Endpoint Lambat Setelah Data Membesar

Gejala:

- endpoint `/cases/search` makin lambat,
- DB CPU naik,
- response 5–30 detik,
- timeout 504.

Penyebab umum:

- return entity lalu mapper lazy-load applicant/officer,
- count query mahal,
- sorting tanpa index,
- filter tidak selective,
- offset pagination deep,
- query select terlalu banyak column.

Mitigasi:

- projection DTO,
- index sesuai predicate/order,
- keyset pagination untuk deep list,
- `Slice` jika count tidak wajib,
- query timeout,
- slow query monitoring.

---

### 36.2 Export Membuat Aplikasi OOM

Penyebab:

- load semua entity/DTO ke memory,
- persistence context menyimpan entity,
- LOB ikut kebaca,
- no chunking.

Mitigasi:

- projection row,
- chunk/keyset pagination,
- streaming output,
- async export job,
- limit maksimal,
- read-only transaction pendek per chunk.

---

### 36.3 Dashboard Mengganggu OLTP

Penyebab:

- dashboard menjalankan aggregation besar ke primary DB setiap refresh,
- no summary table,
- no materialized view,
- date range terlalu luas.

Mitigasi:

- cache dashboard,
- materialized view,
- summary table,
- read replica,
- reporting database,
- refresh interval,
- query guardrail.

---

### 36.4 Data Unauthorized Muncul di Page Berikutnya

Penyebab:

- authorization dilakukan setelah query/pagination.

Mitigasi:

- permission predicate masuk SQL/JPQL,
- test pagination + authorization,
- audit query policy.

---

### 36.5 DTO Query Mengembalikan Duplicate Rows

Penyebab:

- join ke to-many table,
- tidak group/distinct,
- tidak sadar cardinality.

Mitigasi:

- pahami cardinality,
- split query,
- aggregate child data,
- use `distinct` dengan hati-hati,
- grouping di Java jika result kecil.

---

## 37. Performance Model untuk Projection

Saat mendesain projection, pikirkan biaya berikut:

```text
Total cost = rows scanned
           + rows returned
           + columns returned
           + join cost
           + sort cost
           + aggregation cost
           + network transfer
           + object allocation
           + mapping cost
           + persistence context cost
```

Projection mengurangi:

- columns returned,
- network transfer,
- object allocation,
- persistence context cost.

Projection tidak otomatis mengurangi:

- rows scanned,
- join cost,
- sort cost,
- aggregation cost.

Untuk itu tetap perlu:

- index,
- predicate selective,
- query plan,
- pagination,
- summary/read model,
- database-specific optimization.

---

## 38. Production Checklist

Sebelum merge query read penting, cek:

### Shape

- [ ] Apakah use case ini benar-benar butuh entity?
- [ ] Apakah DTO/projection sudah hanya memilih field yang perlu?
- [ ] Apakah sensitive columns tidak ikut diselect jika tidak perlu?
- [ ] Apakah API DTO tidak langsung memakai entity?

### Query

- [ ] Predicate parameterized?
- [ ] Sorting memakai whitelist?
- [ ] Pagination stabil dengan tie-breaker?
- [ ] Count query diperlukan atau bisa `Slice`?
- [ ] Query to-many join tidak menyebabkan duplicate/cartesian explosion?
- [ ] Native SQL punya boundary dan test?

### Performance

- [ ] Query count terukur?
- [ ] SQL aktual dicek?
- [ ] Execution plan dicek untuk query kritikal?
- [ ] Index cocok dengan filter/order?
- [ ] Result size dibatasi?
- [ ] Export memakai chunk/streaming?

### Transaction

- [ ] Read-only transaction digunakan bila perlu?
- [ ] Tidak ada lazy loading keluar boundary?
- [ ] Query timeout dipertimbangkan?
- [ ] Streaming tidak melewati closed transaction?

### Security

- [ ] Authorization predicate masuk query?
- [ ] Pagination/count konsisten dengan authorization?
- [ ] Masking data sensitif dilakukan sebelum keluar boundary?
- [ ] Export diaudit?

### Maintainability

- [ ] Query ownership jelas?
- [ ] DTO naming spesifik use case?
- [ ] Tidak ada universal DTO?
- [ ] Tests menggunakan database realistis untuk query penting?

---

## 39. Scenario: Case Management Search

### Requirement

User ingin screen search case:

```text
Filter:
- case no contains
- applicant name contains
- status multi-select
- submitted date range
- assigned officer
- only cases user can access

Columns:
- case no
- applicant name
- status
- assigned officer
- submitted date
- SLA due date
- last action date
```

### Bad Design

```java
Page<CaseEntity> page = caseRepository.findAll(spec, pageable);
return page.map(caseMapper::toListItem);
```

Risiko:

- applicant/officer lazy-load,
- last action butuh query per case,
- authorization mungkin after-query,
- count query with fetch/join kacau,
- select terlalu banyak column.

### Better Design

DTO:

```java
public record CaseSearchRow(
        Long caseId,
        String caseNo,
        String applicantName,
        CaseStatus status,
        String assignedOfficerName,
        Instant submittedAt,
        Instant slaDueAt,
        Instant lastActionAt
) {}
```

Repository:

```java
public interface CaseSearchQueryRepository {
    Slice<CaseSearchRow> search(
            CaseSearchCriteria criteria,
            UserAccessScope accessScope,
            CaseSearchPage page
    );
}
```

Query design:

```sql
select c.id,
       c.case_no,
       a.name as applicant_name,
       c.status,
       o.name as assigned_officer_name,
       c.submitted_at,
       c.sla_due_at,
       le.last_action_at
from cases c
join applicants a on a.id = c.applicant_id
left join officers o on o.id = c.assigned_officer_id
left join case_last_event_view le on le.case_id = c.id
where c.agency_id in (:allowedAgencyIds)
  and (:caseNo is null or lower(c.case_no) like :caseNo)
  and (:applicantName is null or lower(a.name) like :applicantName)
  and c.status in (:statuses)
  and c.submitted_at >= :from
  and c.submitted_at < :to
order by c.submitted_at desc, c.id desc
fetch first :limit rows only;
```

Notes:

- `last_action_at` bisa dari view/materialized view/subquery tergantung DB dan volume.
- Authorization ada di query.
- Sorting stabil.
- Projection explicit.
- `Slice` menghindari count mahal jika total tidak wajib.

---

## 40. Scenario: Audit Timeline

Audit timeline biasanya high-volume dan chronological.

DTO:

```java
public record AuditTimelineItem(
        Long auditId,
        String module,
        String activity,
        String actorName,
        Instant createdAt,
        String summary
) {}
```

Query:

```java
List<AuditTimelineItem> findNextTimelinePage(
        Long caseId,
        Instant beforeCreatedAt,
        Long beforeAuditId,
        int size
);
```

Keyset predicate:

```sql
where audit.case_id = :caseId
  and (
      audit.created_at < :beforeCreatedAt
      or (audit.created_at = :beforeCreatedAt and audit.id < :beforeAuditId)
  )
order by audit.created_at desc, audit.id desc
fetch first :size rows only
```

Kenapa projection:

- audit row bisa mengandung CLOB/JSON besar,
- timeline hanya butuh summary,
- jangan load full audit entity kalau tidak perlu,
- pagination harus stabil.

---

## 41. Scenario: SLA Dashboard

Requirement:

```text
Show count of open cases grouped by SLA bucket:
- overdue
- due today
- due in 3 days
- due later
per agency and case type.
```

Jangan iterasi entity.

Gunakan aggregation DTO:

```java
public record SlaBucketStat(
        String agencyCode,
        String caseType,
        String bucket,
        long total
) {}
```

Jika query mahal dan dashboard sering refresh:

- summary table setiap 5 menit,
- materialized view,
- cache,
- read replica,
- precomputed bucket column.

Kunci desain:

```text
Dashboard is a read model problem, not an entity graph problem.
```

---

## 42. Latihan

### Latihan 1 — Refactor Entity Listing

Diberikan endpoint:

```java
@GetMapping("/cases")
public Page<CaseEntity> list(Pageable pageable) {
    return caseRepository.findAll(pageable);
}
```

Tugas:

1. Identifikasi minimal 8 risiko desain.
2. Buat DTO projection untuk listing.
3. Buat query yang mengambil applicant name dan officer name tanpa N+1.
4. Tambahkan sorting whitelist.
5. Tambahkan authorization predicate.

---

### Latihan 2 — Detail Page dengan Tiga Collection

Case detail butuh:

- header,
- applicant,
- documents,
- timeline,
- correspondence.

Tugas:

1. Jelaskan kenapa satu query fetch join semua collection buruk.
2. Desain `CaseDetailView`.
3. Tentukan query mana yang dipisah.
4. Tentukan transaction boundary.
5. Jelaskan consistency trade-off.

---

### Latihan 3 — Export 500.000 Rows

Tugas:

1. Jelaskan kenapa `List<CaseEntity>` buruk.
2. Desain `CaseExportRow`.
3. Pilih offset atau keyset pagination.
4. Tentukan chunk size awal.
5. Tentukan audit dan masking requirement.
6. Tentukan failure recovery jika export job gagal di tengah.

---

### Latihan 4 — Dashboard Query Membebani DB

Dashboard count by status/date range membuat DB CPU tinggi.

Tugas:

1. Identifikasi penyebab.
2. Usulkan 3 alternatif desain.
3. Tentukan kapan materialized view lebih tepat.
4. Tentukan freshness SLA.
5. Tentukan monitoring.

---

## 43. Ringkasan

Poin paling penting:

1. **Entity bukan default output untuk semua read use case.** Entity adalah persistence/write model.
2. **Projection adalah alat utama untuk read path yang efisien.** Ia mengurangi over-fetching, lazy loading, dirty checking, dan persistence context bloat.
3. **DTO/read model harus mengikuti kebutuhan use case.** Listing, detail, dashboard, export, dan report punya shape berbeda.
4. **Projection bukan pengganti index.** Projection mengurangi data yang dikirim/dimaterialisasi, tetapi query plan tetap harus benar.
5. **Reporting query sering lebih cocok native SQL/view/materialized view/read model.** Jangan memaksa semua hal menjadi entity graph.
6. **Pagination, sorting, filtering, count, authorization, dan masking adalah bagian dari query design.** Jangan dianggap detail kecil.
7. **Untuk sistem besar, pisahkan command repository dan query repository.** Command path menjaga invariant; query path mengoptimalkan pembacaan.
8. **Read model boleh denormalized.** Yang penting consistency expectation-nya jelas.
9. **Security predicate harus masuk query.** Filtering setelah pagination adalah bug correctness dan security.
10. **Satu query tidak selalu lebih baik.** Beberapa query projection kecil sering lebih baik daripada satu mega fetch join yang menghasilkan cartesian explosion.

---

## 44. Referensi Utama

- Jakarta Persistence 3.2 Specification — query language, constructor expressions, result types, native query mapping, Criteria API.
- Jakarta EE Tutorial — Jakarta Persistence Query Language overview.
- Hibernate ORM User Guide — query result handling, projections, HQL, DTO instantiation, native query support.
- Spring Data JPA Reference — projections, interface-based projections, DTO projections, query rewriting.
- Jakarta Data 1.0 Specification — repository abstraction and data access model in Jakarta EE.

---

## 45. Apa Berikutnya

Part berikutnya:

```text
Part 010 — Transaction Fundamentals: ACID, Local Transactions, JTA, Resource Managers
```

Di Part 010 kita akan masuk ke fondasi transaksi: bukan hanya `@Transactional`, tetapi transaction sebagai boundary consistency, hubungan antara database transaction, JPA transaction, JDBC transaction, JTA/Jakarta Transactions, resource manager, transaction manager, rollback rules, timeout, dan synchronization.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 008 — Query Model: JPQL, HQL, Criteria, Native SQL, QuerySpecification](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 010 — Transaction Fundamentals: ACID, Local Transactions, JTA, Resource Managers](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-010.md)

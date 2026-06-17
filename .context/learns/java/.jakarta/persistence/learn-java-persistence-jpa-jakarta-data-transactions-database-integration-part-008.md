# Part 008 — Query Model: JPQL, HQL, Criteria, Native SQL, QuerySpecification

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: 8 sampai 25  
> Fokus: Java/Jakarta Persistence, JPA, Hibernate, Jakarta Data, Transactions, dan Database Integration  
> Status seri: Part 008 dari 032 — belum selesai

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membedakan **JPQL**, **HQL**, **Criteria API**, **native SQL**, dan pattern seperti **Specification/Query Object** secara konseptual dan praktis.
2. Menentukan query style yang tepat berdasarkan kebutuhan use case, portability, kompleksitas filter, performance, dan maintainability.
3. Memahami bahwa query di ORM bukan sekadar string, tetapi bagian dari **contract antara object model, relational model, transaction boundary, dan execution plan database**.
4. Menghindari anti-pattern umum seperti string concatenation, repository method explosion, entity over-fetching, query tersebar tanpa ownership, dan native SQL liar tanpa boundary.
5. Mendesain query layer yang scalable untuk aplikasi besar: listing, search, report, dashboard, approval queue, export, batch processing, dan complex workflow.
6. Membaca query bukan hanya dari sisi API, tetapi dari sisi **SQL yang dihasilkan**, **index yang dipakai**, **jumlah row yang dibaca**, dan **failure mode produksi**.

Bagian ini tidak mengulang JDBC dasar atau SQL dasar. Fokusnya adalah bagaimana query hidup dalam ekosistem JPA/Hibernate/Jakarta Persistence.

---

## 2. Mental Model: Query adalah Translation Boundary

Query dalam JPA/Hibernate berada di antara dua dunia:

```text
Java object model
    |
    | JPQL / HQL / Criteria / Repository Method / Specification
    v
Provider query model
    |
    | SQL rendering + binding + dialect translation
    v
Database SQL engine
    |
    | parse, optimize, execute, lock, fetch rows
    v
Result hydration / projection / entity management
```

Kesalahan umum adalah menganggap JPQL/HQL sebagai “SQL tapi pakai nama entity”. Itu terlalu dangkal.

Query ORM sebenarnya menyentuh banyak mekanisme:

- entity metadata,
- association mapping,
- fetch strategy,
- persistence context,
- dirty checking,
- flush mode,
- transaction boundary,
- JDBC prepared statement,
- database dialect,
- result hydration,
- second-level/query cache jika aktif,
- database optimizer,
- index,
- lock,
- isolation level,
- timeout,
- pagination,
- memory footprint.

Jadi query bukan hanya “cara mengambil data”. Query adalah **desain akses data**.

---

## 3. Taxonomy Query di Ekosistem JPA/Hibernate

Secara praktis, query dapat dikelompokkan seperti ini:

| Query Style | Level | Cocok Untuk | Risiko Utama |
|---|---:|---|---|
| `find()` by id | EntityManager API | Lookup primary key | Overuse untuk use case yang perlu projection |
| JPQL | Standard JPA/Jakarta Persistence | Query portable berbasis entity model | String-based, tidak semua SQL feature tersedia |
| HQL | Hibernate-specific | Query ORM advanced dengan fitur lebih kaya | Provider lock-in |
| Criteria API | Standard type-ish query builder | Dynamic query kompleks | Verbose, sulit dibaca jika tidak dibungkus pattern |
| Hibernate Criteria extensions | Provider-specific | Dynamic query dengan fitur HQL modern | Provider lock-in |
| Named Query | Static predefined query | Query stabil dan reusable | Bisa menumpuk dan sulit discover jika tidak rapi |
| Native SQL | Database SQL langsung | Report, performance hotspot, vendor-specific feature | Mapping manual, portability rendah, bypass beberapa abstraksi ORM |
| Repository method query | Spring Data/Jakarta Data style | CRUD/simple filter | Method explosion, query tersembunyi |
| Specification/Query Object | Application pattern | Search/filter dinamis | Bisa jadi abstraksi bocor jika tidak disiplin |
| Projection Query | Read model | Listing/report/API response | Mapping dan lifecycle berbeda dari entity |
| Bulk JPQL/SQL | Mass update/delete | Batch operation | Bypass persistence context, stale entity risk |

Tidak ada satu query style yang selalu benar. Yang benar adalah **memilih query style berdasarkan bentuk masalah**.

---

## 4. JPQL: Object-Oriented Query Standard

### 4.1 Apa itu JPQL?

JPQL atau Jakarta Persistence Query Language adalah query language standard dari JPA/Jakarta Persistence. Ia bekerja terhadap **entity model**, bukan langsung terhadap table dan column.

Contoh:

```java
List<CaseFile> cases = entityManager
    .createQuery("""
        select c
        from CaseFile c
        where c.status = :status
        order by c.submittedAt desc
        """, CaseFile.class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .setMaxResults(50)
    .getResultList();
```

Yang dirujuk:

- `CaseFile` = entity name/class,
- `c.status` = Java property mapped ke column,
- `c.submittedAt` = Java property,
- `CaseStatus.SUBMITTED` akan dibind sesuai mapping enum/ converter.

Bukan:

```sql
select * from case_file where status = ?
```

Walaupun pada akhirnya provider akan menghasilkan SQL seperti itu.

### 4.2 JPQL bekerja terhadap mapping

Misalnya entity:

```java
@Entity
@Table(name = "case_file")
public class CaseFile {
    @Id
    private Long id;

    @Column(name = "case_no", nullable = false, unique = true)
    private String caseNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private CaseStatus status;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assigned_officer_id")
    private Officer assignedOfficer;

    @Column(name = "submitted_at")
    private Instant submittedAt;
}
```

JPQL:

```java
select c
from CaseFile c
where c.assignedOfficer.id = :officerId
  and c.status in :statuses
order by c.submittedAt desc
```

Provider menerjemahkan path `c.assignedOfficer.id` menjadi join/foreign key access sesuai mapping.

### 4.3 JPQL bukan SQL

Perbedaan penting:

| Aspek | SQL | JPQL |
|---|---|---|
| Target | Table/column | Entity/property |
| Result | Row/scalar | Entity/object/projection |
| Join | Table join | Association/path join |
| Dialect | Database-specific | Standardized, provider translates |
| Function | DB function | Standard JPQL function + provider extension |
| Insert-select | SQL native | Terbatas/provider-specific |
| CTE/window function | Native SQL | Tidak portable di JPQL standard lama; provider bisa extend |

Contoh salah mental model:

```java
// Salah: pakai nama table/column di JPQL
select * from case_file where case_no = :caseNo
```

JPQL yang benar:

```java
select c from CaseFile c where c.caseNo = :caseNo
```

### 4.4 JPQL select entity

```java
Optional<CaseFile> findSubmittedCase(String caseNo) {
    List<CaseFile> result = entityManager
        .createQuery("""
            select c
            from CaseFile c
            where c.caseNo = :caseNo
              and c.status = :status
            """, CaseFile.class)
        .setParameter("caseNo", caseNo)
        .setParameter("status", CaseStatus.SUBMITTED)
        .getResultList();

    return result.stream().findFirst();
}
```

Entity result menjadi **managed** jika query dijalankan dalam persistence context aktif. Artinya perubahan pada entity bisa ikut dirty-checked.

Ini kuat, tetapi juga berbahaya jika query sebenarnya hanya butuh read-only projection.

### 4.5 JPQL select projection

Untuk listing, sering lebih benar memakai projection:

```java
public record CaseListingRow(
    Long id,
    String caseNo,
    CaseStatus status,
    Instant submittedAt,
    String assignedOfficerName
) {}
```

```java
List<CaseListingRow> rows = entityManager
    .createQuery("""
        select new com.example.caseapp.CaseListingRow(
            c.id,
            c.caseNo,
            c.status,
            c.submittedAt,
            o.displayName
        )
        from CaseFile c
        left join c.assignedOfficer o
        where c.status in :statuses
        order by c.submittedAt desc
        """, CaseListingRow.class)
    .setParameter("statuses", statuses)
    .setMaxResults(100)
    .getResultList();
```

Keuntungan:

- tidak hydrate seluruh entity,
- tidak memenuhi persistence context dengan object yang tidak perlu,
- tidak menyebabkan accidental dirty checking,
- lebih jelas kolom apa yang dibutuhkan use case,
- cocok untuk API listing/search.

### 4.6 JPQL join

Ada dua bentuk join yang sering disalahpahami.

#### Regular join

```java
select c
from CaseFile c
join c.assignedOfficer o
where o.departmentCode = :departmentCode
```

Join dipakai untuk filter, belum tentu association `assignedOfficer` di-fetch penuh.

#### Fetch join

```java
select c
from CaseFile c
join fetch c.assignedOfficer
where c.status = :status
```

Fetch join mengubah fetch plan. Association `assignedOfficer` ikut dimuat.

Perbedaannya fundamental:

```text
regular join = untuk query condition/result shaping
fetch join   = untuk loading association ke entity graph hasil
```

### 4.7 JPQL aggregate

```java
List<CaseStatusCount> counts = entityManager
    .createQuery("""
        select new com.example.caseapp.CaseStatusCount(c.status, count(c))
        from CaseFile c
        where c.createdAt >= :from
        group by c.status
        order by count(c) desc
        """, CaseStatusCount.class)
    .setParameter("from", from)
    .getResultList();
```

Aggregate query sebaiknya hampir selalu return projection, bukan entity.

### 4.8 JPQL update/delete bulk

```java
int updated = entityManager
    .createQuery("""
        update CaseFile c
        set c.status = :expiredStatus
        where c.status = :draftStatus
          and c.createdAt < :cutoff
        """)
    .setParameter("expiredStatus", CaseStatus.EXPIRED)
    .setParameter("draftStatus", CaseStatus.DRAFT)
    .setParameter("cutoff", cutoff)
    .executeUpdate();
```

Bulk update/delete penting untuk batch, tetapi memiliki risiko besar:

- bypass entity lifecycle callback,
- bypass dirty checking,
- entity managed yang sudah ada di persistence context bisa stale,
- version column mungkin tidak otomatis berubah sesuai harapan kecuali query mengaturnya,
- audit entity listener tidak terpanggil.

Praktik aman setelah bulk operation:

```java
int updated = entityManager.createQuery(...).executeUpdate();
entityManager.clear();
```

Atau jalankan bulk query dalam transaction khusus yang tidak mencampur managed entity yang sama.

---

## 5. HQL: Hibernate Query Language

### 5.1 Apa itu HQL?

HQL adalah query language Hibernate. Ia mirip JPQL dan bekerja pada entity model, tetapi biasanya memiliki fitur lebih luas daripada JPQL standard.

Mental model:

```text
JPQL = portable standard subset
HQL  = Hibernate's richer object query language
```

Dalam banyak kasus, JPQL valid juga valid sebagai HQL. Tetapi HQL bisa memiliki fitur yang tidak portable ke provider lain.

### 5.2 Kapan memakai HQL?

Gunakan HQL saat:

- aplikasi memang standardize pada Hibernate,
- butuh fitur query yang tidak tersedia di JPQL standard,
- ingin memakai function/expression yang didukung Hibernate dialect,
- ingin query lebih powerful tetapi masih berbasis entity model,
- tim menerima provider lock-in secara sadar.

Jangan memakai HQL provider-specific hanya karena “lebih keren”. Pakai ketika trade-off-nya jelas.

### 5.3 Contoh HQL dengan function

```java
List<CaseListingRow> rows = session
    .createQuery("""
        select new com.example.caseapp.CaseListingRow(
            c.id,
            c.caseNo,
            c.status,
            c.submittedAt,
            upper(o.displayName)
        )
        from CaseFile c
        left join c.assignedOfficer o
        where lower(c.caseNo) like lower(:keyword)
        order by c.submittedAt desc nulls last
        """, CaseListingRow.class)
    .setParameter("keyword", "%" + keyword + "%")
    .setMaxResults(50)
    .getResultList();
```

Catatan penting: `lower(column) like ...` bisa mengganggu index biasa. Untuk production, pertimbangkan:

- normalized search column,
- function-based index,
- full-text search,
- external search engine,
- case-insensitive collation jika DB mendukung.

### 5.4 HQL bukan alasan untuk mengabaikan SQL

Walaupun HQL powerful, kamu tetap wajib tahu SQL yang dihasilkan.

Checklist minimal:

- Berapa query yang dieksekusi?
- SQL final seperti apa?
- Apakah join sesuai ekspektasi?
- Apakah parameter dibind, bukan di-concat?
- Apakah index dipakai?
- Apakah pagination dilakukan di database?
- Apakah result set terlalu besar?
- Apakah query menyebabkan lock wait?

---

## 6. Criteria API: Dynamic Query as Object Tree

### 6.1 Apa itu Criteria API?

Criteria API adalah API standard JPA untuk membangun query secara programmatic.

JPQL:

```java
select c from CaseFile c where c.status = :status order by c.submittedAt desc
```

Criteria:

```java
CriteriaBuilder cb = entityManager.getCriteriaBuilder();
CriteriaQuery<CaseFile> cq = cb.createQuery(CaseFile.class);
Root<CaseFile> c = cq.from(CaseFile.class);

cq.select(c)
  .where(cb.equal(c.get("status"), CaseStatus.SUBMITTED))
  .orderBy(cb.desc(c.get("submittedAt")));

List<CaseFile> result = entityManager.createQuery(cq).getResultList();
```

Criteria API membangun query sebagai tree:

```text
CriteriaQuery
  select: Root<CaseFile>
  from: CaseFile c
  where: equal(c.status, SUBMITTED)
  order: desc(c.submittedAt)
```

### 6.2 Kelebihan Criteria API

Criteria cocok untuk:

- filter dinamis,
- query builder reusable,
- search screen dengan banyak optional filters,
- composition of predicates,
- type-ish safety,
- menghindari string concatenation,
- membangun query dari policy/rule object.

Contoh use case:

```text
Search Case:
- status optional
- assigned officer optional
- submitted date range optional
- module optional
- keyword optional
- overdue only optional
- escalation level optional
- agency optional
```

Membangun JPQL string manual untuk semua kombinasi ini rawan kacau.

### 6.3 Kelemahan Criteria API

Criteria API bisa sangat verbose dan sulit dibaca:

```java
Predicate p = cb.and(
    cb.equal(root.get("status"), status),
    cb.greaterThanOrEqualTo(root.get("submittedAt"), from),
    cb.lessThan(root.get("submittedAt"), to)
);
```

Risiko:

- query intent tidak terlihat jelas,
- string property tetap bisa salah jika tidak memakai metamodel,
- abstraction helper bisa menjadi terlalu generic,
- developer menulis query builder framework internal yang sulit dirawat.

### 6.4 Criteria untuk dynamic filter

```java
public List<CaseListingRow> search(CaseSearchCriteria criteria, int limit) {
    CriteriaBuilder cb = entityManager.getCriteriaBuilder();
    CriteriaQuery<CaseListingRow> cq = cb.createQuery(CaseListingRow.class);

    Root<CaseFile> c = cq.from(CaseFile.class);
    Join<CaseFile, Officer> officer = c.join("assignedOfficer", JoinType.LEFT);

    List<Predicate> predicates = new ArrayList<>();

    if (criteria.statuses() != null && !criteria.statuses().isEmpty()) {
        predicates.add(c.get("status").in(criteria.statuses()));
    }

    if (criteria.assignedOfficerId() != null) {
        predicates.add(cb.equal(officer.get("id"), criteria.assignedOfficerId()));
    }

    if (criteria.submittedFrom() != null) {
        predicates.add(cb.greaterThanOrEqualTo(c.get("submittedAt"), criteria.submittedFrom()));
    }

    if (criteria.submittedTo() != null) {
        predicates.add(cb.lessThan(c.get("submittedAt"), criteria.submittedTo()));
    }

    if (criteria.keyword() != null && !criteria.keyword().isBlank()) {
        String keyword = "%" + criteria.keyword().toLowerCase(Locale.ROOT) + "%";
        predicates.add(cb.or(
            cb.like(cb.lower(c.get("caseNo")), keyword),
            cb.like(cb.lower(c.get("applicantName")), keyword)
        ));
    }

    cq.select(cb.construct(
            CaseListingRow.class,
            c.get("id"),
            c.get("caseNo"),
            c.get("status"),
            c.get("submittedAt"),
            officer.get("displayName")
        ))
      .where(predicates.toArray(Predicate[]::new))
      .orderBy(cb.desc(c.get("submittedAt")));

    return entityManager.createQuery(cq)
        .setMaxResults(limit)
        .getResultList();
}
```

Ini masuk akal untuk dynamic search, tetapi jangan memaksakan Criteria untuk query sederhana.

### 6.5 Criteria dengan static metamodel

JPA pernah umum memakai generated static metamodel:

```java
c.get(CaseFile_.status)
```

Daripada:

```java
c.get("status")
```

Keuntungan:

- compile-time property reference,
- refactor lebih aman,
- mengurangi typo.

Namun di ekosistem modern, banyak tim lebih memilih:

- QueryDSL,
- jOOQ untuk SQL-heavy query,
- Spring Data Specification,
- custom query object,
- atau explicit JPQL untuk readability.

### 6.6 Kapan Criteria API tidak cocok?

Criteria kurang cocok jika:

- query statis sederhana,
- query report SQL-heavy,
- query butuh window function/CTE/vendor-specific feature,
- readability lebih penting daripada dynamic composition,
- tim tidak familiar dan helper abstraction belum matang.

---

## 7. Native SQL: Ketika ORM Query Bukan Alat yang Tepat

### 7.1 Native SQL bukan dosa

Native SQL sering diperlakukan seperti “failure” dalam proyek ORM. Ini salah.

Native SQL adalah alat yang tepat saat:

- query sangat database-specific,
- butuh CTE/window function/recursive query,
- butuh optimizer hint,
- butuh materialized view,
- butuh full-text search DB-native,
- query report kompleks,
- batch update besar,
- exploit index/partition tertentu,
- ORM-generated SQL tidak cukup optimal,
- butuh operasi yang bukan entity-centric.

ORM tidak membatalkan kebutuhan berpikir sebagai database engineer.

### 7.2 Contoh native SQL projection

```java
public record OfficerWorkloadRow(
    Long officerId,
    String officerName,
    long pendingCount,
    long overdueCount
) {}
```

```java
@SuppressWarnings("unchecked")
public List<OfficerWorkloadRow> findOfficerWorkload() {
    List<Object[]> rows = entityManager
        .createNativeQuery("""
            select
                o.id as officer_id,
                o.display_name as officer_name,
                count(*) as pending_count,
                sum(case when c.due_at < current_timestamp then 1 else 0 end) as overdue_count
            from case_file c
            join officer o on o.id = c.assigned_officer_id
            where c.status in ('SUBMITTED', 'UNDER_REVIEW', 'ESCALATED')
            group by o.id, o.display_name
            order by overdue_count desc, pending_count desc
            """)
        .getResultList();

    return rows.stream()
        .map(row -> new OfficerWorkloadRow(
            ((Number) row[0]).longValue(),
            (String) row[1],
            ((Number) row[2]).longValue(),
            ((Number) row[3]).longValue()
        ))
        .toList();
}
```

Ini verbose, tetapi jelas dan powerful.

Untuk mapping yang lebih rapi, bisa gunakan:

- `@SqlResultSetMapping`,
- provider-specific result transformer,
- Spring `JdbcTemplate`,
- jOOQ,
- dedicated reporting adapter.

### 7.3 Native SQL boundary

Native SQL harus punya boundary jelas.

Jangan:

```text
- native SQL tersebar di service layer
- string SQL di-concat di controller
- column name literal berserakan
- query report update entity managed yang sama tanpa clear
- SQL vendor-specific tanpa test database asli
```

Lebih baik:

```text
infrastructure.persistence.report
    CaseReportQueryRepository
    OfficerWorkloadNativeQuery
    MonthlyComplianceDashboardQuery
```

Atau:

```text
infrastructure.persistence.sql
    sql/
      case-workload.sql
      overdue-dashboard.sql
```

### 7.4 Native SQL dan persistence context

Native SQL bisa mengembalikan entity:

```java
List<CaseFile> cases = entityManager
    .createNativeQuery("select * from case_file where status = ?", CaseFile.class)
    .setParameter(1, "SUBMITTED")
    .getResultList();
```

Tetapi hati-hati:

- harus select column yang cukup untuk mapping entity,
- result entity menjadi managed,
- association tetap mengikuti mapping/fetching,
- query update native bisa membuat managed entity stale,
- portability rendah.

Untuk read/report, projection biasanya lebih aman daripada entity.

---

## 8. Query Parameter Binding dan SQL Injection Safety

### 8.1 Selalu bind parameter

Benar:

```java
entityManager.createQuery("""
    select c from CaseFile c
    where c.caseNo = :caseNo
    """, CaseFile.class)
.setParameter("caseNo", caseNo);
```

Salah:

```java
entityManager.createQuery(
    "select c from CaseFile c where c.caseNo = '" + caseNo + "'",
    CaseFile.class
);
```

String concatenation untuk value adalah red flag.

### 8.2 Parameter untuk `IN`

```java
List<CaseFile> cases = entityManager
    .createQuery("""
        select c from CaseFile c
        where c.status in :statuses
        """, CaseFile.class)
    .setParameter("statuses", statuses)
    .getResultList();
```

Edge case:

- empty list bisa menghasilkan SQL invalid atau return semua tergantung builder.
- harus handle explicit.

```java
if (statuses == null || statuses.isEmpty()) {
    return List.of();
}
```

### 8.3 Dynamic order by tidak bisa dibind seperti value

Ini tidak bisa:

```java
order by :sortColumn
```

Column/property untuk sorting harus dipilih dari whitelist.

```java
private static final Map<String, String> SORT_FIELDS = Map.of(
    "submittedAt", "c.submittedAt",
    "caseNo", "c.caseNo",
    "status", "c.status"
);

String sortExpression = SORT_FIELDS.getOrDefault(request.sortBy(), "c.submittedAt");
String direction = request.descending() ? "desc" : "asc";

String jpql = """
    select c
    from CaseFile c
    where c.status = :status
    order by %s %s
    """.formatted(sortExpression, direction);
```

Yang boleh dinamis hanya dari controlled whitelist, bukan raw user input.

### 8.4 Like escaping

Untuk keyword search:

```java
where lower(c.caseNo) like :keyword
```

Perlu escape wildcard jika user input boleh mengandung `%` atau `_`.

```java
static String escapeLike(String input) {
    return input
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_");
}
```

JPQL:

```java
where lower(c.caseNo) like :keyword escape '\\'
```

Parameter:

```java
.setParameter("keyword", "%" + escapeLike(keyword.toLowerCase(Locale.ROOT)) + "%")
```

---

## 9. Query Result Semantics

### 9.1 `getSingleResult()` problem

```java
CaseFile c = entityManager
    .createQuery("select c from CaseFile c where c.caseNo = :caseNo", CaseFile.class)
    .setParameter("caseNo", caseNo)
    .getSingleResult();
```

Risiko:

- `NoResultException`,
- `NonUniqueResultException`,
- awkward control flow.

Sering lebih aman:

```java
public Optional<CaseFile> findByCaseNo(String caseNo) {
    return entityManager
        .createQuery("""
            select c from CaseFile c
            where c.caseNo = :caseNo
            """, CaseFile.class)
        .setParameter("caseNo", caseNo)
        .setMaxResults(2)
        .getResultStream()
        .findFirst();
}
```

Namun jika uniqueness adalah invariant, enforce di database dengan unique constraint. Query code bukan pengganti constraint.

### 9.2 `getResultList()` untuk optional lookup

Untuk lookup optional:

```java
List<CaseFile> result = query.getResultList();
return result.isEmpty() ? Optional.empty() : Optional.of(result.get(0));
```

Tambahkan `setMaxResults(2)` jika ingin mendeteksi data corruption:

```java
List<CaseFile> result = query.setMaxResults(2).getResultList();
if (result.size() > 1) {
    throw new IllegalStateException("Duplicate caseNo detected: " + caseNo);
}
return result.stream().findFirst();
```

### 9.3 Entity result vs DTO result

Entity result:

```text
+ managed
+ bisa diubah dan flush
+ association bisa lazy
- memory lebih besar
- dirty checking
- accidental update risk
- serialization risk
```

DTO/projection result:

```text
+ ringan
+ explicit shape
+ aman untuk read-only
+ cocok API/report/listing
- tidak bisa update langsung
- mapping constructor perlu dijaga
```

Rule praktis:

```text
Command use case yang mengubah aggregate -> load entity
Read/list/report use case -> projection/read model
```

---

## 10. Named Query

Named query adalah query yang didefinisikan dengan nama stabil.

```java
@Entity
@NamedQuery(
    name = "CaseFile.findSubmittedByOfficer",
    query = """
        select c
        from CaseFile c
        where c.status = com.example.CaseStatus.SUBMITTED
          and c.assignedOfficer.id = :officerId
        order by c.submittedAt desc
        """
)
public class CaseFile {
    // ...
}
```

Pemakaian:

```java
List<CaseFile> cases = entityManager
    .createNamedQuery("CaseFile.findSubmittedByOfficer", CaseFile.class)
    .setParameter("officerId", officerId)
    .getResultList();
```

Kapan cocok:

- query stabil,
- query dipakai banyak tempat,
- ingin validasi query saat startup/provider bootstrap,
- ingin memberi nama eksplisit pada query penting.

Kapan tidak cocok:

- query sangat spesifik use case,
- query dinamis,
- entity menjadi penuh puluhan query unrelated,
- query ownership lebih cocok di repository/query class.

Pattern yang lebih scalable:

```text
CaseFileQueries.SUBMITTED_BY_OFFICER = "CaseFile.findSubmittedByOfficer"
```

Atau letakkan query di repository adapter, bukan entity, jika entity mulai menjadi “query dumping ground”.

---

## 11. Query Hints, Timeout, Lock, and Comments

### 11.1 Query timeout

Query timeout penting untuk mencegah request menggantung terlalu lama.

```java
entityManager
    .createQuery("select c from CaseFile c where c.status = :status", CaseFile.class)
    .setParameter("status", status)
    .setHint("jakarta.persistence.query.timeout", 3000)
    .getResultList();
```

Timeout harus dipahami sebagai bagian dari reliability:

- query listing API mungkin 1–3 detik,
- report/export mungkin lebih panjang tapi asynchronous,
- background batch punya timeout sendiri,
- jangan semua query diberi timeout sama.

### 11.2 Lock mode pada query

```java
CaseFile c = entityManager
    .createQuery("""
        select c from CaseFile c
        where c.id = :id
        """, CaseFile.class)
    .setParameter("id", id)
    .setLockMode(LockModeType.OPTIMISTIC)
    .getSingleResult();
```

Atau pessimistic:

```java
.setLockMode(LockModeType.PESSIMISTIC_WRITE)
```

Lock di query bukan sekadar opsi teknis. Ia adalah desain concurrency invariant.

### 11.3 Query comments

Hibernate dapat menambahkan SQL comments untuk observability.

```java
entityManager
    .createQuery("select c from CaseFile c where c.status = :status", CaseFile.class)
    .setParameter("status", status)
    .setHint("org.hibernate.comment", "CaseQueueRepository.findPendingQueue")
    .getResultList();
```

Di database slow query log, comment membantu menghubungkan SQL dengan use case.

### 11.4 Fetch size

Untuk query besar:

```java
query.setHint("org.hibernate.fetchSize", 500);
```

Atau pakai provider/JDBC-specific configuration.

Fetch size tidak otomatis membuat query aman. Masih perlu:

- pagination/chunking,
- transaction boundary,
- memory control,
- streaming/cursor support database,
- clear persistence context jika entity loaded.

---

## 12. Pagination: Offset, Keyset, Count Query

### 12.1 Offset pagination

```java
List<CaseListingRow> rows = entityManager
    .createQuery("""
        select new com.example.CaseListingRow(c.id, c.caseNo, c.status, c.submittedAt)
        from CaseFile c
        where c.status = :status
        order by c.submittedAt desc, c.id desc
        """, CaseListingRow.class)
    .setParameter("status", status)
    .setFirstResult(page * size)
    .setMaxResults(size)
    .getResultList();
```

Offset pagination mudah, tetapi pada page jauh bisa mahal:

```text
page 10000 size 50 -> DB tetap harus melewati banyak row
```

### 12.2 Stable ordering wajib

Jangan hanya:

```sql
order by submitted_at desc
```

Jika banyak row punya timestamp sama, hasil bisa tidak stabil antar request.

Lebih baik:

```sql
order by submitted_at desc, id desc
```

### 12.3 Keyset pagination

Untuk high-volume listing:

```java
select new com.example.CaseListingRow(c.id, c.caseNo, c.status, c.submittedAt)
from CaseFile c
where c.status = :status
  and (
        c.submittedAt < :lastSubmittedAt
        or (c.submittedAt = :lastSubmittedAt and c.id < :lastId)
      )
order by c.submittedAt desc, c.id desc
```

Keyset lebih scalable untuk infinite scroll/queue, tetapi tidak cocok jika user butuh lompat ke page arbitrary.

### 12.4 Count query problem

Banyak framework otomatis membuat count query untuk pagination. Ini bisa mahal.

```java
select count(c)
from CaseFile c
where c.status = :status
```

Untuk screen tertentu, mungkin cukup:

- slice: tahu ada next page tanpa total count,
- approximate count,
- cached count,
- asynchronous count,
- no count for large export.

Jangan otomatis menganggap semua listing perlu total row akurat.

---

## 13. Specification dan Query Object Pattern

### 13.1 Kenapa perlu pattern?

Dalam aplikasi besar, query sering tumbuh dari:

```java
findByStatus()
findByStatusAndOfficer()
findByStatusAndOfficerAndDateRange()
findByStatusAndOfficerAndDateRangeAndKeyword()
findByStatusAndOfficerAndDateRangeAndKeywordAndModule()
```

Ini menjadi repository method explosion.

Lebih baik buat query object:

```java
public record CaseSearchQuery(
    Set<CaseStatus> statuses,
    Long assignedOfficerId,
    Instant submittedFrom,
    Instant submittedTo,
    String keyword,
    Boolean overdueOnly,
    String moduleCode,
    int limit
) {}
```

Repository:

```java
List<CaseListingRow> search(CaseSearchQuery query);
```

### 13.2 Specification sebagai predicate composition

Specification pada dasarnya adalah predicate yang bisa dikomposisi.

Pseudo-interface:

```java
@FunctionalInterface
public interface CaseSpecification {
    Predicate toPredicate(
        Root<CaseFile> root,
        CriteriaQuery<?> query,
        CriteriaBuilder cb
    );
}
```

Contoh:

```java
static CaseSpecification hasStatus(Set<CaseStatus> statuses) {
    return (root, query, cb) -> root.get("status").in(statuses);
}

static CaseSpecification assignedTo(Long officerId) {
    return (root, query, cb) -> cb.equal(root.get("assignedOfficer").get("id"), officerId);
}
```

Composition:

```java
Predicate predicate = cb.and(
    hasStatus(statuses).toPredicate(root, cq, cb),
    assignedTo(officerId).toPredicate(root, cq, cb)
);
```

### 13.3 Jangan terlalu generic

Generic abstraction yang terlalu jauh sering memburuk:

```java
Filter(field="status", op="IN", value=[...])
Filter(field="assignedOfficer.department.code", op="EQ", value="X")
```

Risiko:

- security: user bisa filter field yang tidak boleh,
- performance: user bisa trigger join mahal,
- correctness: domain invariant tidak terlihat,
- maintainability: query logic menjadi mini-language buruk.

Lebih aman:

```java
CaseSearchQuery adalah contract use case.
Bukan general-purpose database query language.
```

---

## 14. Query Ownership: Di Mana Query Seharusnya Tinggal?

### 14.1 Jangan taruh query sembarangan

Anti-pattern:

```text
Controller -> EntityManager -> JPQL string
Service    -> Native SQL
Entity     -> puluhan NamedQuery unrelated
Repository -> semua query semua modul
```

Query harus punya ownership berdasarkan use case dan bounded context.

### 14.2 Command repository vs query repository

Command repository:

```java
interface CaseRepository {
    Optional<CaseFile> findById(CaseId id);
    Optional<CaseFile> findByCaseNo(CaseNo caseNo);
    void save(CaseFile caseFile);
}
```

Query repository:

```java
interface CaseQueueQueryRepository {
    List<CaseQueueRow> findPendingQueue(CaseQueueFilter filter, PageRequest page);
}

interface CaseReportQueryRepository {
    List<OfficerWorkloadRow> findOfficerWorkload(WorkloadReportFilter filter);
}
```

Command repository return entity/aggregate. Query repository return projection/read model.

Ini menjaga mental model:

```text
write side = invariant, lifecycle, transaction
read side  = shape, performance, filtering, reporting
```

### 14.3 Repository method name bukan desain query layer

Spring Data/Jakarta Data style derived method berguna:

```java
findByStatusOrderBySubmittedAtDesc
```

Tetapi untuk sistem besar, method name panjang menjadi buruk:

```java
findByStatusInAndAssignedOfficerIdAndSubmittedAtBetweenAndModuleCodeAndEscalationLevelOrderBySubmittedAtDesc
```

Pada titik itu, gunakan query object atau explicit query.

---

## 15. Query and Transaction Interaction

### 15.1 Query bisa trigger flush

Dengan flush mode default, query dapat menyebabkan flush sebelum query dieksekusi agar hasil query konsisten dengan perubahan managed entity.

Contoh:

```java
caseFile.changeStatus(CaseStatus.SUBMITTED);

List<CaseFile> submitted = entityManager
    .createQuery("select c from CaseFile c where c.status = :status", CaseFile.class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .getResultList();
```

Provider mungkin flush update status sebelum select.

Implikasi:

- constraint violation bisa muncul saat query, bukan saat commit,
- SQL write bisa terjadi lebih awal dari yang developer bayangkan,
- query di tengah command transaction bisa memicu efek samping.

### 15.2 Read query dalam transaction write

Hati-hati dengan pola:

```java
@Transactional
public void submitCase(SubmitCaseCommand command) {
    CaseFile c = repository.findById(command.caseId()).orElseThrow();
    c.submit();

    List<Officer> officers = officerQuery.findAvailableOfficers();
    // query ini bisa trigger flush CaseFile

    assignmentService.assign(c, officers);
}
```

Ini belum tentu salah, tetapi harus disadari.

### 15.3 Read-only query

Read-only transaction/hint dapat membantu, tetapi jangan dianggap magic.

Untuk high-volume read:

- gunakan projection,
- hindari managed entity jika tidak perlu,
- pertimbangkan read-only hint provider-specific,
- jangan mutate entity hasil read-only flow,
- pisahkan query repository dari command repository.

---

## 16. Query and Persistence Context

### 16.1 Entity query menggunakan first-level cache

Jika entity dengan id tertentu sudah managed, query yang menghasilkan entity yang sama akan mengembalikan instance Java yang sama dari persistence context.

```java
CaseFile a = entityManager.find(CaseFile.class, id);
CaseFile b = entityManager
    .createQuery("select c from CaseFile c where c.id = :id", CaseFile.class)
    .setParameter("id", id)
    .getSingleResult();

assert a == b;
```

Ini identity map behavior.

### 16.2 Query tidak selalu refresh entity

Jika entity sudah managed dan database berubah di luar persistence context, query entity bisa tetap mengembalikan instance managed yang sudah ada, bukan otomatis refresh semua field.

Gunakan:

```java
entityManager.refresh(entity);
```

Atau clear persistence context jika memang butuh baca ulang.

### 16.3 Bulk query membuat stale context

```java
CaseFile c = entityManager.find(CaseFile.class, id);

entityManager.createQuery("""
    update CaseFile c
    set c.status = :status
    where c.id = :id
    """)
.setParameter("status", CaseStatus.EXPIRED)
.setParameter("id", id)
.executeUpdate();

// c.status di memory belum tentu berubah
```

Solusi:

```java
entityManager.clear();
```

Atau jangan campur bulk update dengan managed entity yang sama.

---

## 17. Query Performance Model

Ketika melihat query, jangan hanya bertanya “apakah return datanya benar?”

Tanyakan:

```text
1. Berapa SQL statement yang dieksekusi?
2. Berapa roundtrip ke DB?
3. Berapa row yang dibaca DB?
4. Berapa row yang dikirim ke aplikasi?
5. Berapa column yang dikirim?
6. Apakah index dipakai?
7. Apakah sort menggunakan index atau temp sort?
8. Apakah join cardinality meledak?
9. Apakah persistence context dipenuhi entity tidak perlu?
10. Apakah query memicu flush?
11. Apakah query menahan lock?
12. Apakah query punya timeout?
13. Apakah pagination stabil?
14. Apakah count query mahal?
15. Apakah filter user bisa menyebabkan full scan?
```

### 17.1 Query count

N+1 bukan satu-satunya masalah, tetapi query count tetap indikator penting.

```text
1 request listing 50 cases
Expected:
  1 query projection
Bad:
  1 query cases
  50 query assigned officer
  50 query applicant
  50 query latest task
```

### 17.2 Row explosion karena join

Fetch join collection bisa menggandakan row:

```text
Case 1 punya 10 documents
Case 2 punya 20 documents
Query 2 case dengan join fetch documents -> 30 SQL rows
```

Jika join fetch beberapa collection, row bisa meledak secara Cartesian.

### 17.3 Column over-fetching

Entity query:

```java
select c from CaseFile c
```

Mungkin mengambil:

- id,
- case_no,
- applicant_name,
- status,
- description CLOB,
- metadata CLOB,
- created_by,
- updated_by,
- timestamps,
- flags,
- etc.

Untuk listing, mungkin hanya butuh 6 kolom. Projection bisa jauh lebih murah.

### 17.4 Hydration cost

ORM harus:

- membaca ResultSet,
- convert JDBC type ke Java type,
- instantiate entity/DTO,
- populate field,
- register entity ke persistence context,
- create snapshot untuk dirty checking,
- initialize collection/proxy metadata.

Ini bukan gratis.

---

## 18. Query Design by Use Case

### 18.1 Lookup by id untuk command

```java
public CaseFile loadForSubmission(CaseId id) {
    return entityManager.find(CaseFile.class, id.value());
}
```

Cocok untuk command yang akan mengubah aggregate.

### 18.2 Lookup by business key

```java
public Optional<CaseFile> findByCaseNo(CaseNo caseNo) {
    return entityManager
        .createQuery("""
            select c
            from CaseFile c
            where c.caseNo = :caseNo
            """, CaseFile.class)
        .setParameter("caseNo", caseNo.value())
        .setMaxResults(2)
        .getResultStream()
        .findFirst();
}
```

Harus didukung unique constraint.

### 18.3 Listing API

Projection:

```java
select new CaseListingRow(c.id, c.caseNo, c.status, c.submittedAt, o.displayName)
from CaseFile c
left join c.assignedOfficer o
where c.status in :statuses
order by c.submittedAt desc, c.id desc
```

### 18.4 Detail page

Bisa entity graph/fetch join/projection tergantung kebutuhan.

```java
select c
from CaseFile c
left join fetch c.applicant
left join fetch c.assignedOfficer
where c.id = :id
```

Jika detail banyak section/tab, jangan selalu load semua sekaligus. Bisa split per section.

### 18.5 Dashboard/report

Native SQL/materialized view/read model sering lebih tepat.

```text
Dashboard query bukan aggregate command model.
Ia read model/reporting concern.
```

### 18.6 Export besar

Jangan:

```java
List<Entity> all = query.getResultList();
```

Gunakan:

- streaming/cursor,
- pagination/chunk,
- projection,
- transaction chunking,
- backpressure,
- async job,
- dedicated report SQL.

---

## 19. Query Version Differences: Java 8 hingga 25, JPA ke Jakarta

### 19.1 Java version impact

Java 8:

- no text blocks,
- DTO class manual,
- `javax.persistence`,
- older Hibernate 5 common,
- stream support terbatas tergantung provider.

Java 15+:

- text blocks membuat JPQL/SQL lebih readable.

Java 16+:

- records cocok untuk projection DTO.

Java 17+:

- baseline umum untuk Spring Boot 3/Jakarta era,
- Hibernate 6/7 lebih relevan.

Java 21/25:

- virtual threads tidak otomatis membuat query lebih cepat,
- blocking JDBC tetap memakai connection pool sebagai bottleneck,
- query timeout, pool sizing, transaction duration tetap penting.

### 19.2 `javax.persistence` vs `jakarta.persistence`

Era lama:

```java
import javax.persistence.EntityManager;
import javax.persistence.TypedQuery;
```

Era baru:

```java
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
```

Konsep query sebagian besar sama, tetapi versi provider dan namespace berbeda.

### 19.3 Hibernate 5 vs 6/7

Poin praktis:

- Hibernate 6 memperbarui query engine secara besar,
- HQL modern lebih powerful,
- type system berubah,
- beberapa API lama deprecated/berubah,
- Hibernate 7 bergerak lebih dekat ke Jakarta Persistence 3.2/Jakarta Data era.

Jangan asal copy StackOverflow lama untuk Hibernate 6/7. Banyak jawaban era Hibernate 3/4/5 tidak lagi ideal.

---

## 20. Query in Spring Data JPA dan Jakarta Data

### 20.1 Derived query method

Spring Data/Jakarta Data style:

```java
List<CaseFile> findByStatusOrderBySubmittedAtDesc(CaseStatus status);
```

Kelebihan:

- cepat untuk simple query,
- convention-based,
- minim boilerplate.

Kelemahan:

- query intent tersembunyi,
- method name bisa panjang,
- sulit untuk query kompleks,
- mudah return entity untuk use case yang harusnya projection,
- tidak selalu jelas SQL yang dihasilkan.

### 20.2 Explicit query annotation

```java
@Query("""
    select new com.example.CaseListingRow(c.id, c.caseNo, c.status, c.submittedAt)
    from CaseFile c
    where c.status in :statuses
    order by c.submittedAt desc, c.id desc
    """)
List<CaseListingRow> findListingRows(Set<CaseStatus> statuses);
```

Lebih explicit dan cocok untuk query use case.

### 20.3 Repository abstraction bukan pengganti desain query

Baik Spring Data maupun Jakarta Data mengurangi boilerplate, tetapi tidak menggantikan keputusan:

- entity atau projection?
- fetch join atau DTO?
- offset atau keyset?
- count atau slice?
- transaction read-only?
- index apa yang dibutuhkan?
- apakah query ini command-side atau read-side?

Framework membantu eksekusi, bukan menggantikan reasoning.

---

## 21. Anti-Pattern Query yang Sering Terjadi

### 21.1 Semua query return entity

```java
List<CaseFile> findAllByStatus(CaseStatus status);
```

Untuk listing, ini sering salah. Return projection.

### 21.2 Query tersebar di service

```java
@Service
class CaseService {
    @PersistenceContext EntityManager em;

    public List<?> search(...) {
        return em.createQuery("...").getResultList();
    }
}
```

Service menjadi persistence adapter. Sulit dites, sulit maintain, query ownership kabur.

### 21.3 String concatenation

```java
"where c.status = '" + status + "'"
```

Security dan correctness risk.

### 21.4 Dynamic filter terlalu generic

```json
{
  "field": "assignedOfficer.department.parent.parent.code",
  "operator": "like",
  "value": "%"
}
```

Ini seperti memberi user mini SQL engine tanpa governance.

### 21.5 Native SQL tanpa boundary

Native SQL boleh, tetapi harus dikurasi, dites, dan dimiliki oleh adapter yang jelas.

### 21.6 Fetch join semua association

```java
select c from CaseFile c
left join fetch c.documents
left join fetch c.comments
left join fetch c.auditTrails
left join fetch c.tasks
```

Ini bisa menghasilkan row explosion dan memory pressure.

### 21.7 Pagination dengan collection fetch join

Sering menghasilkan warning, wrong result, atau in-memory pagination tergantung provider/config.

### 21.8 Count query otomatis untuk query berat

Framework pagination sering generate count query yang mahal. Untuk queue/listing besar, pertimbangkan slice/keyset.

### 21.9 Query tidak punya timeout

Query lambat bisa menahan connection pool dan menyebabkan cascading failure.

### 21.10 Tidak pernah melihat execution plan

ORM bukan alasan untuk buta terhadap query plan database.

---

## 22. Failure Modes Produksi

### 22.1 N+1 query storm

Gejala:

- endpoint lambat hanya saat data banyak,
- DB connection active tinggi,
- log menunjukkan ratusan query kecil,
- CPU aplikasi naik karena hydration.

Mitigasi:

- projection,
- fetch join to-one,
- batch fetching,
- entity graph,
- query redesign.

### 22.2 Full table scan karena filter fleksibel

Gejala:

- search endpoint lambat,
- DB CPU/I/O naik,
- explain plan menunjukkan full scan,
- keyword search pakai `lower(column) like '%x%'`.

Mitigasi:

- search index,
- normalized column,
- full-text search,
- limit filter allowed,
- require selective filter,
- async report.

### 22.3 Query timeout menyebabkan transaction rollback

Gejala:

- query timeout exception,
- transaction marked rollback-only,
- subsequent operation gagal,
- error muncul di commit bukan di query awal.

Mitigasi:

- classify exception,
- jangan lanjutkan transaction setelah persistence exception serius,
- design retry boundary.

### 22.4 Bulk update membuat stale entity

Gejala:

- data di database berubah,
- object di memory masih old value,
- response salah,
- commit berikutnya overwrite hasil bulk.

Mitigasi:

- clear persistence context,
- isolate bulk transaction,
- avoid mixing entity mutation and bulk query.

### 22.5 Pagination tidak stabil

Gejala:

- data duplicate antar page,
- data hilang antar page,
- user melihat urutan berubah.

Mitigasi:

- stable order with tie-breaker,
- keyset pagination,
- consistent snapshot jika perlu.

### 22.6 Report query menghabiskan pool

Gejala:

- export/report lambat,
- semua request ikut lambat,
- Hikari active=max,
- request timeout massal.

Mitigasi:

- separate pool/job worker,
- async export,
- read replica,
- timeout,
- streaming,
- query limit,
- materialized view.

---

## 23. Design Checklist untuk Query Layer

Sebelum merge query baru, tanyakan:

### Correctness

- Apakah query mengembalikan data sesuai use case?
- Apakah filter mandatory sudah ada?
- Apakah tenant/agency/security scope diterapkan?
- Apakah soft delete/status visibility diterapkan?
- Apakah ordering deterministic?
- Apakah uniqueness diasumsikan tapi tidak ada constraint?

### Security

- Apakah semua value dibind sebagai parameter?
- Apakah dynamic sort/filter pakai whitelist?
- Apakah user bisa mengakses field/tenant yang tidak boleh?
- Apakah native SQL bebas dari injection?

### Performance

- Apakah result entity atau projection?
- Apakah query count masuk akal?
- Apakah SQL final sudah dicek?
- Apakah index mendukung where/order/join?
- Apakah pagination aman?
- Apakah count query mahal?
- Apakah query punya timeout?

### Transaction

- Apakah query bisa trigger flush?
- Apakah query dijalankan dalam transaction yang tepat?
- Apakah read-only flow benar-benar read-only?
- Apakah bulk query mencampur managed entity?

### Maintainability

- Apakah query punya owner class yang jelas?
- Apakah query string readable?
- Apakah query dinamis terlalu generic?
- Apakah repository method name masih manusiawi?
- Apakah provider-specific feature didokumentasikan?

### Observability

- Apakah query bisa dilacak dari slow query log ke use case?
- Apakah ada metric untuk latency/count?
- Apakah parameter sensitif tidak bocor ke log?
- Apakah failure diklasifikasikan?

---

## 24. Scenario: Case Queue Query Design

### Problem

Buat query untuk halaman queue officer:

- menampilkan case yang `SUBMITTED`, `UNDER_REVIEW`, atau `ESCALATED`,
- hanya untuk agency officer,
- optional assigned officer,
- optional overdue only,
- optional keyword case number/applicant name,
- sort by priority desc, due date asc, id asc,
- page size 50,
- tidak butuh full entity,
- harus cepat di production.

### Model yang buruk

```java
List<CaseFile> findByStatusIn(Set<CaseStatus> statuses);
```

Lalu filter di Java:

```java
cases.stream()
    .filter(...)
    .sorted(...)
    .limit(50)
```

Ini buruk karena:

- mengambil terlalu banyak row,
- sorting/filtering di aplikasi,
- entity over-fetch,
- N+1 risk,
- pagination salah.

### Model lebih baik

```java
public record CaseQueueQuery(
    String agencyCode,
    Set<CaseStatus> statuses,
    Long assignedOfficerId,
    boolean overdueOnly,
    String keyword,
    int limit
) {}
```

Projection:

```java
public record CaseQueueRow(
    Long id,
    String caseNo,
    String applicantName,
    CaseStatus status,
    int priority,
    Instant dueAt,
    String assignedOfficerName
) {}
```

JPQL/Criteria:

```java
select new com.example.CaseQueueRow(
    c.id,
    c.caseNo,
    c.applicantName,
    c.status,
    c.priority,
    c.dueAt,
    o.displayName
)
from CaseFile c
left join c.assignedOfficer o
where c.agencyCode = :agencyCode
  and c.status in :statuses
  and (:assignedOfficerId is null or o.id = :assignedOfficerId)
  and (:overdueOnly = false or c.dueAt < :now)
  and (
      :keyword is null
      or lower(c.caseNo) like :keyword escape '\\'
      or lower(c.applicantName) like :keyword escape '\\'
  )
order by c.priority desc, c.dueAt asc, c.id asc
```

Namun `:assignedOfficerId is null or ...` dan `:keyword is null or ...` bisa mengganggu optimizer pada beberapa database. Untuk performa tinggi, dynamic Criteria yang hanya menambahkan predicate saat parameter ada sering lebih baik.

### Index thinking

Candidate index:

```sql
agency_code, status, priority desc, due_at asc, id asc
```

Untuk keyword search, index biasa mungkin tidak cukup jika pakai `%keyword%`. Butuh strategi search khusus.

---

## 25. Latihan

### Latihan 1 — Query style selection

Untuk tiap use case, pilih JPQL, Criteria, native SQL, repository derived query, atau projection query:

1. Find case by id untuk submit command.
2. Search case dengan 12 optional filters.
3. Dashboard monthly compliance count dengan grouping kompleks.
4. Find officer by email.
5. Export 2 juta audit rows.
6. Update all expired draft cases nightly.
7. Detail page yang butuh applicant dan assigned officer.
8. Queue page dengan keyset pagination.

Jelaskan alasan dan failure mode masing-masing.

### Latihan 2 — Refactor method explosion

Refactor repository berikut:

```java
findByStatus(...)
findByStatusAndAgencyCode(...)
findByStatusAndAgencyCodeAndAssignedOfficerId(...)
findByStatusAndAgencyCodeAndAssignedOfficerIdAndSubmittedAtBetween(...)
findByStatusAndAgencyCodeAndAssignedOfficerIdAndSubmittedAtBetweenAndKeyword(...)
```

Menjadi query object dan implementation yang maintainable.

### Latihan 3 — Debug performance

Endpoint `/cases/search` lambat. Observasi:

```text
- request p95 12s
- DB CPU tinggi
- SQL count 1 per request
- tidak ada N+1
- explain plan full table scan
- query pakai lower(applicant_name) like '%keyword%'
```

Rancang solusi jangka pendek dan jangka panjang.

### Latihan 4 — Bulk update safety

Dalam satu transaction:

```java
CaseFile c = em.find(CaseFile.class, id);
em.createQuery("update CaseFile c set c.status = 'EXPIRED' where c.id = :id")
  .setParameter("id", id)
  .executeUpdate();
return c.getStatus();
```

Prediksi hasil dan jelaskan cara memperbaiki.

---

## 26. Ringkasan

Query model di JPA/Hibernate adalah lapisan penting yang menghubungkan object model dengan database execution model.

Prinsip utama:

1. **JPQL** adalah standard object query language. Gunakan untuk query portable berbasis entity.
2. **HQL** adalah Hibernate query language yang lebih powerful, tetapi provider-specific.
3. **Criteria API** cocok untuk dynamic query, tetapi harus dibungkus pattern agar tidak menjadi verbose chaos.
4. **Native SQL** valid dan sering tepat untuk report/performance/vendor-specific query, tetapi harus diberi boundary jelas.
5. **Projection** adalah default yang sehat untuk read/list/report use case.
6. **Entity query** cocok untuk command use case yang benar-benar butuh aggregate managed.
7. **Parameter binding** wajib; dynamic sort/filter harus whitelist.
8. **Query bisa memicu flush**, memengaruhi transaction behavior, dan membuat error muncul lebih awal.
9. **Bulk update/delete bypass persistence context**, sehingga stale entity adalah risiko nyata.
10. **Pagination harus stable**, dan count query tidak selalu gratis.
11. **Query performance harus dilihat dari SQL final dan execution plan**, bukan dari cantiknya JPQL.
12. **Repository abstraction tidak menggantikan desain query**.

Mental model paling penting:

```text
A query is not just a way to get data.
A query is a use-case-specific contract between domain needs, persistence mapping,
transaction consistency, database execution, and operational reliability.
```

---

## 27. Referensi Resmi dan Bacaan Lanjutan

- Jakarta Persistence 3.2 Specification — query language, criteria API, native query, persistence model.
- Jakarta Persistence API docs — `EntityManager`, `Query`, `TypedQuery`, `CriteriaBuilder`, `CriteriaQuery`.
- Hibernate ORM documentation — HQL, query language, criteria extensions, fetching, SQL rendering, query hints.
- Hibernate ORM 7 documentation — modern Hibernate query behavior and Jakarta-era ORM model.
- Jakarta Data Specification — repository abstraction and query method model.
- Database vendor documentation — execution plan, index, locking, optimizer behavior.


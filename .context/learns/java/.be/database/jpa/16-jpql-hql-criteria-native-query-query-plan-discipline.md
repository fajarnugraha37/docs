# Part 16 — JPQL, HQL, Criteria, Native Query, and Query Plan Discipline

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `16-jpql-hql-criteria-native-query-query-plan-discipline.md`  
> Scope Java: 8 sampai 25  
> Scope API: JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`  
> Scope Provider: Hibernate ORM 5/6/7, EclipseLink 2/3/4

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membahas fetch plan, N+1, cartesian explosion, dan strategi materialisasi graph. Part ini melanjutkan dari sisi **query language dan query execution discipline**.

Di level dasar, developer biasanya melihat query ORM sebagai pilihan sintaks:

- JPQL kalau ingin portable.
- HQL kalau pakai Hibernate.
- Criteria kalau query dinamis.
- Native SQL kalau query kompleks.

Tetapi di level advanced, query ORM harus dipahami sebagai **kontrak eksekusi** antara:

1. model entity,
2. persistence context,
3. provider query parser,
4. SQL generator,
5. database optimizer,
6. transaction boundary,
7. cache dan query plan cache,
8. API contract di atasnya.

Query yang salah bukan hanya menghasilkan hasil yang salah. Ia bisa:

- memicu flush tidak terduga,
- mengubah lock behavior,
- menimbulkan N+1 secara tidak langsung,
- membypass first-level cache expectation,
- membypass lifecycle callback,
- merusak pagination,
- menghasilkan query plan cache churn,
- membuat memory naik karena hydration terlalu besar,
- menghasilkan hasil berbeda antar provider,
- gagal setelah migrasi Hibernate 5 ke 6/7 atau `javax` ke `jakarta`.

Part ini bukan tutorial “cara menulis JPQL select”. Fokusnya adalah **bagaimana memilih, membentuk, membaca, dan mengendalikan query agar correctness dan performance production bisa dipertahankan**.

---

## 1. Why This Matters

Dalam aplikasi enterprise, sebagian besar bottleneck persistence bukan berada di annotation entity, tetapi di query shape.

Mapping menentukan **kemungkinan** SQL yang bisa dibuat provider. Query menentukan **SQL konkret** yang dijalankan.

Contoh kecil:

```java
List<CaseFile> cases = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
    order by c.createdAt desc
""", CaseFile.class)
.setParameter("status", CaseStatus.OPEN)
.setMaxResults(50)
.getResultList();
```

Di permukaan terlihat sederhana. Tetapi pertanyaan advanced-nya:

1. Apakah query ini memicu flush sebelum select?
2. Apakah `status` dibind sebagai string, ordinal, custom type, atau converted value?
3. Apakah `createdAt` timezone-safe?
4. Apakah index database cocok dengan predicate dan ordering?
5. Apakah provider melakukan SQL pagination yang benar untuk Oracle/PostgreSQL/MySQL?
6. Apakah hasil entity masuk persistence context?
7. Apakah lazy association setelah query akan menyebabkan N+1?
8. Apakah query ini masuk query plan cache provider?
9. Apakah query ini portable antara Hibernate dan EclipseLink?
10. Apakah query ini aman untuk endpoint public dengan filter tenant/security?

Engineer top-tier tidak berhenti di “query jalan”. Ia menghubungkan query ke:

- object graph,
- SQL plan,
- memory footprint,
- transaction semantics,
- versioning,
- locking,
- cache correctness,
- migration risk.

---

## 2. Mental Model: ORM Query Is a Translation Pipeline

Query ORM melewati pipeline kira-kira seperti ini:

```text
Application intent
    |
    v
JPQL / HQL / Criteria / Native SQL
    |
    v
Provider query parser / builder
    |
    v
Semantic model
    |
    v
Entity metadata + type mapping + association metadata
    |
    v
SQL AST / SQL expression model / provider query object
    |
    v
Dialect-specific SQL rendering
    |
    v
JDBC PreparedStatement
    |
    v
Database parse/optimize/execute
    |
    v
ResultSet
    |
    v
Hydration / projection / scalar extraction
    |
    v
Persistence context coordination
    |
    v
Application result
```

Native SQL memotong sebagian pipeline, tetapi tidak sepenuhnya keluar dari ORM jika hasilnya dimapping ke entity.

```text
Native SQL string
    |
    v
JDBC PreparedStatement
    |
    v
Database execution
    |
    v
ResultSet
    |
    v
Scalar / DTO / entity mapping
    |
    v
Optional persistence context coordination
```

Implikasinya:

- JPQL/HQL/Criteria bukan SQL langsung.
- Native SQL bukan otomatis lebih cepat.
- Criteria bukan otomatis type-safe secara domain penuh.
- Query projection bukan otomatis bebas dari ORM cost.
- Query entity selalu berinteraksi dengan persistence context.
- Query bulk update/delete punya semantics berbeda dari entity update.

---

## 3. Query Options: When Each One Makes Sense

### 3.1 JPQL

JPQL adalah query language standar JPA/Jakarta Persistence. Ia berbasis **entity model**, bukan table model.

Contoh:

```java
List<CaseFile> result = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
""", CaseFile.class)
.setParameter("status", CaseStatus.OPEN)
.getResultList();
```

Yang ditulis:

```text
CaseFile.status
```

Bukan:

```text
CASE_FILE.STATUS_CODE
```

JPQL cocok untuk:

- query entity portable,
- query umum yang tidak butuh syntax database khusus,
- filtering by association/entity attribute,
- DTO constructor projection sederhana,
- aggregate query standar,
- aplikasi yang ingin meminimalkan provider/database lock-in.

JPQL kurang cocok untuk:

- window function kompleks,
- recursive query,
- database-specific optimizer hint,
- CTE kompleks di provider lama,
- JSON operator khusus database,
- full-text search native database,
- query reporting berat,
- query yang butuh exact SQL control.

### 3.2 HQL

HQL adalah query language Hibernate. Secara historis ia super-set dari JPQL. Di Hibernate modern, HQL jauh lebih expressive dibanding JPQL standar.

Contoh HQL:

```java
List<CaseSummary> result = session.createQuery("""
    select new com.acme.CaseSummary(c.id, c.referenceNo, c.status)
    from CaseFile c
    where c.status in :statuses
    order by lower(c.referenceNo)
""", CaseSummary.class)
.setParameter("statuses", List.of(CaseStatus.OPEN, CaseStatus.PENDING_REVIEW))
.getResultList();
```

HQL cocok untuk:

- aplikasi Hibernate-first,
- query entity yang butuh fitur lebih kaya dari JPQL,
- expression/function support lebih luas,
- integrasi dengan Hibernate-specific type system,
- query yang tetap ingin entity-aware tetapi tidak harus provider-portable.

Trade-off:

- lebih kuat,
- tetapi portability turun,
- migration antar versi Hibernate perlu regression test query.

### 3.3 Criteria API

Criteria API adalah API programmatic untuk membangun query.

Contoh:

```java
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery<CaseFile> cq = cb.createQuery(CaseFile.class);
Root<CaseFile> root = cq.from(CaseFile.class);

List<Predicate> predicates = new ArrayList<>();
predicates.add(cb.equal(root.get("status"), CaseStatus.OPEN));
predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), fromDate));

cq.select(root)
  .where(predicates.toArray(Predicate[]::new))
  .orderBy(cb.desc(root.get("createdAt")));

List<CaseFile> result = em.createQuery(cq).getResultList();
```

Criteria cocok untuk:

- dynamic query composition,
- search screen dengan optional filters,
- reusable predicate builder,
- query generated dari UI/filter object,
- menghindari string concatenation query.

Criteria kurang cocok untuk:

- query sederhana yang menjadi terlalu verbose,
- developer team yang tidak punya discipline abstraction,
- query kompleks yang lebih mudah dibaca sebagai JPQL/native SQL,
- query DSL internal yang tidak diuji SQL output-nya.

Kelemahan terbesar Criteria bukan performa, tetapi **readability dan accidental complexity**.

### 3.4 Native SQL

Native SQL adalah SQL langsung ke database.

```java
List<Object[]> rows = em.createNativeQuery("""
    select c.status, count(*)
    from case_file c
    where c.created_at >= ?
    group by c.status
""")
.setParameter(1, fromDate)
.getResultList();
```

Native SQL cocok untuk:

- reporting query berat,
- database-specific features,
- recursive CTE,
- window function,
- JSON/XML operator database,
- materialized view,
- optimizer hints,
- performance-critical read model,
- migration/maintenance operation,
- query yang memang relational-first, bukan object-graph-first.

Native SQL berisiko saat:

- dimapping ke entity tanpa lengkap column mapping,
- bypass tenant/security filter ORM,
- tidak portable antar database,
- tidak otomatis sinkron dengan entity rename/naming strategy,
- hasil scalar raw `Object[]` tidak type-safe,
- pagination/locking manual menjadi tanggung jawab developer.

### 3.5 Named Query

Named query didefinisikan di metadata:

```java
@NamedQuery(
    name = "CaseFile.findOpenByAgency",
    query = """
        select c
        from CaseFile c
        where c.agency.id = :agencyId
          and c.status = com.acme.CaseStatus.OPEN
        order by c.createdAt desc
    """
)
@Entity
public class CaseFile {
    // ...
}
```

Kelebihan:

- query centralization,
- bisa divalidasi lebih awal oleh provider,
- nama query menjadi contract,
- cocok untuk query penting yang stabil.

Kekurangan:

- annotation entity bisa penuh query,
- query dekat dengan entity tetapi mungkin jauh dari use case,
- refactor nama query harus hati-hati.

Untuk sistem besar, named query lebih cocok untuk query yang:

- reusable,
- stabil,
- mission-critical,
- dipakai banyak tempat,
- perlu lifecycle validation.

Untuk query use-case-specific, query di repository/application query object sering lebih jelas.

---

## 4. JPQL Is Entity-Oriented, Not Table-Oriented

JPQL bekerja dengan konsep:

- entity name,
- persistent field/property,
- association path,
- embeddable path,
- enum/value type,
- constructor projection,
- aggregate expression.

Contoh entity:

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {
    @Id
    private Long id;

    @Column(name = "REFERENCE_NO")
    private String referenceNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "STATUS")
    private CaseStatus status;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "AGENCY_ID")
    private Agency agency;
}
```

JPQL:

```java
select c
from CaseFile c
where c.agency.code = :agencyCode
```

Provider harus menerjemahkan:

```text
c.agency.code
```

menjadi join ke table agency.

Potensi SQL:

```sql
select c.*
from CASE_FILE c
join AGENCY a on a.ID = c.AGENCY_ID
where a.CODE = ?
```

Point penting: association path dalam JPQL bisa menghasilkan join implisit.

```java
where c.agency.code = :agencyCode
```

Sering terlihat ringan, tetapi secara SQL ia membutuhkan join.

Rule:

> Setiap path navigation melintasi association harus dianggap sebagai potensi join, potensi row multiplication, dan potensi perubahan execution plan.

---

## 5. Implicit Join vs Explicit Join

### 5.1 Implicit Join

```java
select c
from CaseFile c
where c.agency.code = :code
```

Lebih ringkas, tetapi join tersembunyi.

### 5.2 Explicit Join

```java
select c
from CaseFile c
join c.agency a
where a.code = :code
```

Lebih eksplisit.

Untuk query production yang penting, explicit join biasanya lebih baik karena:

- join terlihat jelas,
- alias bisa dipakai ulang,
- lebih mudah dibaca,
- lebih mudah dikontrol saat query berkembang,
- mengurangi kejutan implicit join tambahan.

### 5.3 Join Is Not Fetch Join

```java
select c
from CaseFile c
join c.agency a
where a.code = :code
```

Join di atas dipakai untuk filtering. Ia tidak selalu membuat `c.agency` ter-load sebagai initialized association.

Fetch join:

```java
select c
from CaseFile c
join fetch c.agency a
where a.code = :code
```

Fetch join mengubah materialisasi graph.

Mental model:

```text
join       = relational operation for filtering/ordering
join fetch = relational operation + object graph materialization instruction
```

Jangan memakai fetch join hanya karena butuh filter. Pakai fetch join karena caller memang membutuhkan association tersebut dalam object graph.

---

## 6. Select Entity vs Projection vs Scalar

### 6.1 Entity Query

```java
List<CaseFile> cases = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
""", CaseFile.class)
.setParameter("status", CaseStatus.OPEN)
.getResultList();
```

Hasil:

- entity managed,
- masuk persistence context,
- identity map berlaku,
- dirty checking berlaku,
- lazy association tetap lazy,
- memory cost lebih tinggi daripada scalar/DTO.

Entity query cocok untuk command/use case yang akan memodifikasi entity.

### 6.2 DTO Constructor Projection

```java
List<CaseListItem> items = em.createQuery("""
    select new com.acme.CaseListItem(
        c.id,
        c.referenceNo,
        c.status,
        c.createdAt,
        a.name
    )
    from CaseFile c
    join c.agency a
    where c.status = :status
    order by c.createdAt desc
""", CaseListItem.class)
.setParameter("status", CaseStatus.OPEN)
.setMaxResults(50)
.getResultList();
```

Hasil:

- bukan managed entity,
- tidak dirty checked,
- lebih kecil memory footprint,
- cocok untuk read-only API/listing/reporting,
- mengurangi risiko LazyInitializationException.

Projection cocok untuk:

- list page,
- search result,
- dashboard,
- report ringan,
- API response read-only.

### 6.3 Scalar Query

```java
List<Object[]> rows = em.createQuery("""
    select c.status, count(c)
    from CaseFile c
    group by c.status
""", Object[].class)
.getResultList();
```

Kelemahan:

- raw `Object[]`,
- raw cast,
- mudah salah index,
- tidak self-documenting.

Lebih baik gunakan DTO projection kalau memungkinkan.

### 6.4 Tuple Query

```java
List<Tuple> rows = em.createQuery("""
    select c.status as status, count(c) as total
    from CaseFile c
    group by c.status
""", Tuple.class)
.getResultList();

for (Tuple row : rows) {
    CaseStatus status = row.get("status", CaseStatus.class);
    Long total = row.get("total", Long.class);
}
```

Tuple lebih aman dari `Object[]`, tetapi masih lebih lemah daripada DTO yang punya semantic name dan constructor contract.

---

## 7. Query and Persistence Context Interaction

Entity query tidak hanya mengambil data. Ia juga berkoordinasi dengan persistence context.

### 7.1 Identity Map Reuse

```java
CaseFile a = em.find(CaseFile.class, 10L);

CaseFile b = em.createQuery("""
    select c from CaseFile c where c.id = :id
""", CaseFile.class)
.setParameter("id", 10L)
.getSingleResult();

assert a == b;
```

Dalam persistence context yang sama, row yang sama harus direpresentasikan oleh object managed yang sama.

### 7.2 Query Result May Reuse Existing Managed State

Jika entity sudah ada di persistence context, provider tidak selalu overwrite semua field dari result query begitu saja. Persistence context adalah source of truth untuk managed identity dalam unit-of-work.

Situasi:

```java
CaseFile c = em.find(CaseFile.class, 10L);
c.setStatus(CaseStatus.PENDING_REVIEW);

CaseFile q = em.createQuery("""
    select c from CaseFile c where c.id = :id
""", CaseFile.class)
.setParameter("id", 10L)
.getSingleResult();
```

Jika flush belum terjadi, query bisa memicu flush sebelum select tergantung flush mode. Tetapi yang penting:

- entity result tetap mengacu ke managed object yang sama,
- perubahan in-memory tetap bagian dari persistence context,
- query bukan mekanisme reset state.

Gunakan `refresh()` jika benar-benar ingin reload dari database.

```java
em.refresh(c);
```

### 7.3 Projection Does Not Populate Entity Graph

Query DTO:

```java
select new CaseListItem(c.id, c.referenceNo)
from CaseFile c
```

Tidak membuat `CaseFile` managed entity, kecuali provider perlu memuat entity karena bentuk query tertentu. Biasanya projection scalar/DTO lebih ringan.

Rule:

> Untuk read-only listing, pilih projection. Untuk command yang akan mengubah aggregate, pilih entity query.

---

## 8. Flush Before Query

Salah satu kejutan besar ORM: query bisa memicu flush.

```java
caseFile.setStatus(CaseStatus.APPROVED);

List<CaseFile> openCases = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
""", CaseFile.class)
.setParameter("status", CaseStatus.OPEN)
.getResultList();
```

Dengan flush mode AUTO, provider dapat melakukan flush sebelum query agar query melihat state terbaru yang relevan.

```text
managed entity changed
    |
    v
query execution requested
    |
    v
provider decides flush needed
    |
    v
UPDATE CASE_FILE SET STATUS = ? WHERE ID = ?
    |
    v
SELECT ... WHERE STATUS = ?
```

Akibat:

- constraint violation bisa muncul saat select,
- update bisa terjadi lebih awal dari commit,
- SQL log terlihat “aneh” karena read endpoint mengirim update,
- dirty state dari entity lain bisa ikut flush.

Design rule:

> Jangan taruh perubahan entity dan query validasi/read kompleks secara sembarangan dalam persistence context yang sama tanpa memahami flush timing.

Mitigasi:

- kecilkan transaction boundary,
- gunakan DTO/native read di transaction berbeda jika perlu,
- gunakan flush eksplisit di titik yang jelas,
- gunakan flush mode COMMIT dengan hati-hati,
- jangan treat flush mode sebagai fix universal.

---

## 9. Parameter Binding Discipline

### 9.1 Jangan Concatenate Input Ke Query

Buruk:

```java
String jpql = "select c from CaseFile c where c.referenceNo = '" + input + "'";
```

Risiko:

- injection,
- broken escaping,
- query plan cache churn,
- bug pada karakter khusus,
- logging sulit.

Benar:

```java
em.createQuery("""
    select c
    from CaseFile c
    where c.referenceNo = :referenceNo
""", CaseFile.class)
.setParameter("referenceNo", input)
.getResultList();
```

### 9.2 Named Parameter vs Positional Parameter

Named parameter:

```java
where c.status = :status
```

Positional parameter:

```java
where c.status = ?1
```

Untuk query application code, named parameter lebih maintainable.

Positional parameter bisa diterima untuk native SQL sederhana atau legacy code, tetapi mudah salah saat query berubah.

### 9.3 Collection Parameter

```java
where c.status in :statuses
```

```java
.setParameter("statuses", List.of(CaseStatus.OPEN, CaseStatus.PENDING_REVIEW))
```

Perhatikan edge case: empty list.

```java
List<CaseStatus> statuses = filter.statuses();

if (statuses == null || statuses.isEmpty()) {
    return List.of();
}
```

Jangan mengandalkan provider/database menerima:

```sql
where status in ()
```

Karena banyak database tidak valid.

### 9.4 Temporal Parameter

Untuk Java 8+ time API:

```java
.setParameter("from", OffsetDateTime.parse("2026-01-01T00:00:00+08:00"))
```

Pastikan mapping column dan timezone policy jelas.

Untuk legacy JPA/Java 8 dengan `Date`:

```java
.setParameter("from", date, TemporalType.TIMESTAMP)
```

Bug umum:

- date-only dibanding timestamp,
- server timezone berbeda dari DB timezone,
- inclusive/exclusive boundary salah,
- precision truncation.

Gunakan half-open interval:

```java
where c.createdAt >= :from
  and c.createdAt < :to
```

Bukan:

```java
where date(c.createdAt) = :date
```

karena function pada column sering merusak index usage.

---

## 10. Query Plan Cache Discipline

Provider ORM biasanya punya query plan cache untuk query JPQL/HQL/Criteria yang telah diparse/ditranslasikan. Database juga punya mekanisme plan/cache sendiri untuk SQL/PreparedStatement.

Ada dua level berbeda:

```text
ORM query plan cache
    caches parsed/semantic/translation plan of JPQL/HQL/Criteria

Database SQL plan cache
    caches database execution plan for SQL text + bind metadata
```

### 10.1 Kenapa Query Plan Cache Penting

Jika aplikasi membangun query string unik terus-menerus, provider dan database harus parse/compile ulang.

Buruk:

```java
String jpql = """
    select c
    from CaseFile c
    where c.createdAt >= '%s'
""".formatted(fromDate);
```

Setiap date menghasilkan query string berbeda.

Benar:

```java
String jpql = """
    select c
    from CaseFile c
    where c.createdAt >= :fromDate
""";
```

Tanggal menjadi bind parameter, query string stabil.

### 10.2 Dynamic Query Explosion

Search screen sering punya banyak optional filter.

Naive dynamic JPQL:

```java
StringBuilder jpql = new StringBuilder("select c from CaseFile c where 1=1");

if (filter.status() != null) {
    jpql.append(" and c.status = :status");
}
if (filter.agencyId() != null) {
    jpql.append(" and c.agency.id = :agencyId");
}
if (filter.from() != null) {
    jpql.append(" and c.createdAt >= :from");
}
if (filter.to() != null) {
    jpql.append(" and c.createdAt < :to");
}
```

Ini menghasilkan kombinasi query shape berbeda. Tidak selalu salah. Tetapi untuk screen dengan puluhan filter, kombinasi bisa sangat banyak.

Alternatif:

1. Accept dynamic plan count kalau jumlah kombinasi wajar.
2. Gunakan Criteria/Specification builder dengan query shape terkendali.
3. Pisahkan query untuk use case utama.
4. Gunakan search index/read model untuk pencarian sangat dinamis.
5. Hindari membuat literal value masuk ke query string.

### 10.3 Query Shape Stability

Query shape stabil:

```java
where c.status = :status
```

Query shape tidak stabil:

```java
where c.status = 'OPEN'
where c.status = 'CLOSED'
where c.status = 'PENDING'
```

Query shape stabil lebih baik untuk:

- ORM query plan cache,
- database plan cache,
- SQL observability,
- metric grouping,
- log analysis.

### 10.4 Jangan Over-Optimize Terlalu Awal

Query plan cache bukan alasan untuk membuat query sulit dibaca. Prinsipnya:

- bind value sebagai parameter,
- hindari string concatenation dari literal,
- batasi jumlah dynamic shape yang tidak perlu,
- ukur plan cache miss/churn jika ada gejala memory/performance.

---

## 11. Criteria API: Power and Trap

Criteria API sering dipakai untuk dynamic filtering.

### 11.1 Basic Pattern

```java
public List<CaseListItem> search(CaseSearchFilter filter) {
    CriteriaBuilder cb = em.getCriteriaBuilder();
    CriteriaQuery<CaseListItem> cq = cb.createQuery(CaseListItem.class);

    Root<CaseFile> c = cq.from(CaseFile.class);
    Join<CaseFile, Agency> a = c.join("agency", JoinType.INNER);

    List<Predicate> predicates = new ArrayList<>();

    if (filter.status() != null) {
        predicates.add(cb.equal(c.get("status"), filter.status()));
    }
    if (filter.agencyCode() != null) {
        predicates.add(cb.equal(a.get("code"), filter.agencyCode()));
    }
    if (filter.createdFrom() != null) {
        predicates.add(cb.greaterThanOrEqualTo(c.get("createdAt"), filter.createdFrom()));
    }
    if (filter.createdTo() != null) {
        predicates.add(cb.lessThan(c.get("createdAt"), filter.createdTo()));
    }

    cq.select(cb.construct(
            CaseListItem.class,
            c.get("id"),
            c.get("referenceNo"),
            c.get("status"),
            c.get("createdAt"),
            a.get("name")
    ));

    cq.where(predicates.toArray(Predicate[]::new));
    cq.orderBy(cb.desc(c.get("createdAt")));

    return em.createQuery(cq)
            .setMaxResults(100)
            .getResultList();
}
```

### 11.2 Problems With String-Based Path

```java
c.get("createdAt")
```

Refactor field name tidak selalu compile-error.

Alternatif:

- JPA static metamodel,
- QueryDSL-like library,
- custom DSL dengan test kuat,
- minimalisasi Criteria usage untuk query yang memang dynamic.

Static metamodel example:

```java
c.get(CaseFile_.createdAt)
```

### 11.3 Criteria Should Not Become an Unbounded Query Generator

Bahaya Criteria adalah developer merasa aman karena “type-safe”, padahal:

- join bisa tetap explosion,
- predicate bisa tidak index-friendly,
- generated SQL bisa buruk,
- query shape bisa terlalu banyak,
- fetch plan bisa salah,
- pagination bisa rusak.

Rule:

> Criteria membuat query composition lebih aman secara syntactic, bukan otomatis aman secara semantic atau performant.

---

## 12. Sorting and Pagination Discipline

### 12.1 Always Use Deterministic Ordering

Buruk:

```java
select c from CaseFile c where c.status = :status
```

Lalu:

```java
setFirstResult(0)
setMaxResults(50)
```

Tanpa `order by`, pagination tidak stabil.

Benar:

```java
order by c.createdAt desc, c.id desc
```

Tambahkan tie-breaker unik seperti `id`.

### 12.2 Offset Pagination

```java
query.setFirstResult(page * size);
query.setMaxResults(size);
```

Kelebihan:

- sederhana,
- cocok untuk page kecil,
- cocok untuk UI umum.

Kelemahan:

- offset besar makin mahal,
- data berubah saat user paging bisa duplikat/hilang,
- butuh count query.

### 12.3 Keyset Pagination

```text
first page:
where status = :status
order by createdAt desc, id desc
limit 50

next page:
where status = :status
  and (
       createdAt < :lastCreatedAt
       or (createdAt = :lastCreatedAt and id < :lastId)
  )
order by createdAt desc, id desc
limit 50
```

JPQL:

```java
select c
from CaseFile c
where c.status = :status
  and (
       c.createdAt < :lastCreatedAt
       or (c.createdAt = :lastCreatedAt and c.id < :lastId)
  )
order by c.createdAt desc, c.id desc
```

Kelebihan:

- stabil,
- scalable untuk deep paging,
- cocok untuk timeline/infinite scroll.

Kekurangan:

- tidak langsung lompat ke page N,
- query lebih kompleks,
- perlu cursor semantics.

### 12.4 Count Query Should Be Designed Separately

Jangan otomatis count dari query fetch kompleks.

Data query:

```java
select c
from CaseFile c
join fetch c.agency
where c.status = :status
order by c.createdAt desc
```

Count query:

```java
select count(c)
from CaseFile c
where c.status = :status
```

Count tidak perlu fetch join.

### 12.5 Pagination With Fetch Join Collection

Bahaya:

```java
select c
from CaseFile c
join fetch c.documents
order by c.createdAt desc
```

Dengan pagination, row-level pagination bisa memotong collection rows, bukan root entity secara benar. Provider bisa menolak, warn, atau melakukan in-memory pagination tergantung versi/provider/config.

Rule:

> Jangan pagination langsung pada query yang fetch join collection. Ambil root IDs dulu, lalu fetch graph pada query kedua.

Pattern:

```java
List<Long> ids = em.createQuery("""
    select c.id
    from CaseFile c
    where c.status = :status
    order by c.createdAt desc, c.id desc
""", Long.class)
.setParameter("status", status)
.setMaxResults(50)
.getResultList();

List<CaseFile> cases = em.createQuery("""
    select distinct c
    from CaseFile c
    left join fetch c.documents
    where c.id in :ids
""", CaseFile.class)
.setParameter("ids", ids)
.getResultList();
```

Lalu reorder di memory sesuai order `ids` jika database `IN` tidak preserve order.

---

## 13. JPQL Functions and Database Functions

JPQL mendukung fungsi standar seperti:

- `concat`,
- `substring`,
- `trim`,
- `lower`,
- `upper`,
- `length`,
- `locate`,
- `abs`,
- `sqrt`,
- date/time functions,
- aggregate functions.

Jakarta Persistence modern memperbaiki/menambah beberapa ekspresi JPQL dibanding versi lama, tetapi provider tetap punya variasi.

Function example:

```java
select c
from CaseFile c
where lower(c.referenceNo) like lower(:keyword)
```

Masalah:

- function pada column bisa membuat index biasa tidak dipakai,
- case-insensitive search lebih baik pakai normalized column atau functional index,
- `like '%keyword%'` tidak scalable untuk dataset besar.

Database function via JPQL:

```java
select function('json_value', c.metadata, '$.riskLevel')
from CaseFile c
```

Trade-off:

- tetap bisa lewat JPQL,
- tetapi portability turun,
- return type bisa perlu casting/provider handling,
- testing per dialect wajib.

Rule:

> Begitu query memakai `function('...')`, treat query sebagai database-specific walaupun ditulis dalam JPQL.

---

## 14. Query Hints

Query hints memberi instruksi tambahan ke provider.

Contoh standard-ish / common:

```java
query.setHint("jakarta.persistence.query.timeout", 5000);
```

Hibernate-specific examples:

```java
query.setHint("org.hibernate.readOnly", true);
query.setHint("org.hibernate.fetchSize", 100);
query.setHint("org.hibernate.comment", "Case search listing");
```

EclipseLink-specific examples biasanya berada di `org.eclipse.persistence.config.QueryHints`, misalnya untuk cache usage, batch, fetch group, query type, dan optimisasi provider-specific.

Gunakan query hints untuk:

- timeout,
- read-only hint,
- fetch size,
- cache behavior,
- provider fetch/batch instruction,
- comment/correlation,
- lock timeout.

Jangan gunakan query hints untuk menyembunyikan desain query buruk.

Bad smell:

- semua query diberi hint tanpa alasan,
- hint provider-specific tersebar di seluruh application layer,
- hint dipakai tapi tidak ada test SQL/performance,
- hint dianggap portable padahal tidak.

Design rule:

> Query hint adalah surgical tool. Dokumentasikan alasan, provider target, dan expected effect.

---

## 15. Native Query Mapping Discipline

### 15.1 Scalar Native Query

```java
List<Object[]> rows = em.createNativeQuery("""
    select status, count(*) as total
    from case_file
    group by status
""").getResultList();
```

Risiko:

- column type depends on JDBC driver,
- count bisa `BigInteger`, `Long`, `BigDecimal` tergantung provider/database,
- raw `Object[]` mudah salah.

### 15.2 Native Query To Entity

```java
List<CaseFile> cases = em.createNativeQuery("""
    select *
    from case_file
    where status = ?
""", CaseFile.class)
.setParameter(1, "OPEN")
.getResultList();
```

Risiko:

- harus select column yang cukup untuk entity mapping,
- alias harus cocok jika join kompleks,
- association tidak otomatis fetch sesuai join kecuali mapping jelas,
- entity masuk persistence context,
- partial column entity mapping berbahaya.

Jangan lakukan:

```sql
select id, reference_no from case_file
```

dimapping ke full entity `CaseFile.class` jika entity punya banyak field wajib. Ini bisa menyebabkan field null/undefined/provider-specific behavior.

### 15.3 Native Query To DTO

JPA standar tidak sekuat framework modern untuk DTO native mapping. Pilihan:

- `@SqlResultSetMapping`,
- provider-specific transformer/result mapping,
- manual mapping dari `Tuple`/`Object[]`,
- gunakan JDBC/jOOQ/MyBatis untuk query reporting tertentu,
- gunakan Spring JDBC untuk read model.

Advanced rule:

> Native SQL read-heavy/reporting sering lebih bersih jika keluar dari entity mapping dan masuk ke read model/DTO mapping eksplisit.

### 15.4 Native Query and Security Filters

ORM-level filters seperti tenant filter, soft delete filter, atau security predicate tidak otomatis berlaku pada native SQL.

Buruk:

```java
em.createNativeQuery("select * from case_file", CaseFile.class)
```

Jika sistem multi-tenant, query ini bisa bypass tenant isolation.

Benar:

```sql
select *
from case_file
where tenant_id = ?
  and deleted = false
```

Atau lebih kuat: pakai database Row-Level Security jika security boundary harus defensible.

---

## 16. Stored Procedure Queries

JPA/Jakarta Persistence menyediakan `StoredProcedureQuery`.

Example:

```java
StoredProcedureQuery query = em.createStoredProcedureQuery("RECALCULATE_CASE_SCORE");
query.registerStoredProcedureParameter("P_CASE_ID", Long.class, ParameterMode.IN);
query.registerStoredProcedureParameter("P_SCORE", Integer.class, ParameterMode.OUT);

query.setParameter("P_CASE_ID", caseId);
query.execute();

Integer score = (Integer) query.getOutputParameterValue("P_SCORE");
```

Stored procedure cocok untuk:

- legacy database logic,
- heavy database-side operation,
- operation yang sudah distandardisasi oleh DBA/platform,
- bulk processing dekat data,
- package/procedure yang menjadi integration contract.

Risiko:

- sulit unit test tanpa database,
- portability rendah,
- transaction behavior harus jelas,
- side effect bisa tidak terlihat ORM,
- persistence context bisa stale setelah procedure update data.

Jika procedure mengubah data yang entity-nya sedang managed:

```java
CaseFile c = em.find(CaseFile.class, caseId);

callProcedureThatUpdatesCaseStatus(caseId);

// c.status mungkin stale
```

Mitigasi:

```java
em.refresh(c);
```

atau:

```java
em.clear();
```

tergantung scope.

Rule:

> Stored procedure mutation harus diperlakukan seperti bulk/native mutation: ia bisa membypass dirty checking dan membuat persistence context stale.

---

## 17. Bulk Update and Delete: Preview Before Part 17

Part 17 akan membahas bulk mutation lebih dalam, tetapi di sini penting memahami query semantics-nya.

JPQL bulk update:

```java
int updated = em.createQuery("""
    update CaseFile c
    set c.status = :newStatus
    where c.status = :oldStatus
""")
.setParameter("newStatus", CaseStatus.EXPIRED)
.setParameter("oldStatus", CaseStatus.PENDING)
.executeUpdate();
```

Bulk update:

- tidak memanggil setter entity,
- tidak menjalankan dirty checking per entity,
- tidak otomatis update managed object yang sudah ada,
- bisa melewati lifecycle callback entity,
- bisa melewati optimistic version increment kecuali query eksplisit mengubah version/provider-specific support,
- bisa membuat persistence context stale.

Pattern aman:

```java
int updated = em.createQuery("... bulk update ...").executeUpdate();
em.clear();
```

Atau lakukan bulk di transaction terpisah dari unit-of-work entity biasa.

---

## 18. Locking in Queries

Optimistic locking biasanya lewat `@Version`, tetapi query bisa menentukan lock mode.

```java
CaseFile c = em.createQuery("""
    select c
    from CaseFile c
    where c.id = :id
""", CaseFile.class)
.setParameter("id", id)
.setLockMode(LockModeType.OPTIMISTIC)
.getSingleResult();
```

Pessimistic:

```java
CaseFile c = em.createQuery("""
    select c
    from CaseFile c
    where c.id = :id
""", CaseFile.class)
.setParameter("id", id)
.setLockMode(LockModeType.PESSIMISTIC_WRITE)
.getSingleResult();
```

Provider/dialect menerjemahkan ke SQL lock syntax seperti `for update`, `with lock`, atau variasi lain.

Risiko:

- lock query dengan join bisa mengunci lebih banyak row dari ekspektasi,
- lock timeout berbeda per database/provider,
- pagination + lock bisa kompleks,
- deadlock jika lock order tidak konsisten,
- native query lock harus manual.

Rule:

> Lock query harus didesain bersama transaction boundary dan access pattern, bukan ditempel di repository method sebagai afterthought.

---

## 19. Read-Only Query and Dirty Checking Cost

Untuk query read-only entity besar, provider-specific read-only hint bisa mengurangi overhead.

Hibernate example:

```java
List<CaseFile> cases = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
""", CaseFile.class)
.setParameter("status", CaseStatus.CLOSED)
.setHint("org.hibernate.readOnly", true)
.getResultList();
```

Tetapi read-only hint bukan pengganti projection.

Jika hanya butuh 5 fields dari 40 fields:

```java
select new CaseListItem(c.id, c.referenceNo, c.status, c.createdAt, a.name)
```

lebih tepat daripada load entity read-only penuh.

Rule:

```text
Need to modify aggregate?       -> entity query
Need read-only list/detail DTO? -> projection
Need report/analytics?          -> native/read model often better
Need huge stream?               -> fetch size + streaming + clear discipline
```

---

## 20. Streaming and Large Result Sets

JPA 2.2 memperkenalkan stream result API, tetapi provider/database behavior harus dipahami.

```java
try (Stream<CaseFile> stream = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
""", CaseFile.class)
.setParameter("status", CaseStatus.CLOSED)
.getResultStream()) {

    stream.forEach(c -> process(c));
}
```

Risiko:

- seluruh result bisa tetap di-buffer tergantung provider/driver,
- entity masuk persistence context,
- memory naik jika tidak clear,
- transaction harus tetap terbuka,
- connection tertahan selama stream.

Untuk batch processing entity:

```java
int count = 0;

try (Stream<CaseFile> stream = query.getResultStream()) {
    Iterator<CaseFile> it = stream.iterator();
    while (it.hasNext()) {
        CaseFile c = it.next();
        process(c);

        if (++count % 100 == 0) {
            em.flush();
            em.clear();
        }
    }
}
```

Untuk read-only export besar, pertimbangkan:

- native SQL + JDBC streaming,
- projection DTO,
- fetch size,
- stateless provider API,
- cursor/keyset loop,
- read replica/reporting DB.

Rule:

> Streaming entity managed tanpa clear discipline adalah memory leak yang lambat.

---

## 21. Aggregation Queries

Aggregation query:

```java
List<StatusCount> result = em.createQuery("""
    select new com.acme.StatusCount(c.status, count(c))
    from CaseFile c
    where c.createdAt >= :from
    group by c.status
""", StatusCount.class)
.setParameter("from", from)
.getResultList();
```

Perhatikan:

- `count` return type biasanya `Long`,
- group by harus sesuai expression yang dipilih,
- enum mapping memengaruhi DB representation,
- filter harus index-friendly,
- aggregation besar mungkin lebih cocok materialized view/read model.

Avoid:

```java
List<CaseFile> all = findAll();
Map<CaseStatus, Long> counts = all.stream()...
```

Jika counting bisa dilakukan database, lakukan di database.

Tetapi jangan memaksa ORM entity query untuk analytics berat. Untuk dashboard kompleks:

- native SQL,
- materialized view,
- read-side table,
- OLAP/search engine,
- scheduled aggregation.

---

## 22. `getSingleResult()` Discipline

```java
CaseFile c = em.createQuery("""
    select c
    from CaseFile c
    where c.referenceNo = :ref
""", CaseFile.class)
.setParameter("ref", ref)
.getSingleResult();
```

`getSingleResult()` bisa throw:

- `NoResultException`,
- `NonUniqueResultException`.

Untuk optional result:

```java
List<CaseFile> result = em.createQuery("""
    select c
    from CaseFile c
    where c.referenceNo = :ref
""", CaseFile.class)
.setParameter("ref", ref)
.setMaxResults(2)
.getResultList();

if (result.isEmpty()) {
    return Optional.empty();
}
if (result.size() > 1) {
    throw new IllegalStateException("Duplicate case reference: " + ref);
}
return Optional.of(result.get(0));
```

Kenapa `setMaxResults(2)`?

Karena kita ingin mendeteksi data corruption/non-unique result tanpa mengambil semua row.

Design rule:

> Query yang secara domain harus unique harus didukung unique constraint di database, bukan hanya asumsi service layer.

---

## 23. Dynamic Filtering: Better Query Object Design

Untuk aplikasi case management/regulatory, search screen biasanya punya filter banyak:

- reference number,
- applicant name,
- agency,
- status,
- stage,
- assigned officer,
- created date,
- submitted date,
- due date,
- risk level,
- escalation flag,
- document completeness,
- appeal indicator.

Jangan biarkan controller membangun query langsung.

Pattern:

```text
Controller
    -> parses request
    -> creates SearchCommand / Filter object
    -> Application service validates permissions
    -> Query service builds query
    -> Repository executes query
    -> DTO result returned
```

Filter object:

```java
public record CaseSearchFilter(
    String referenceNo,
    CaseStatus status,
    Long agencyId,
    Long assignedOfficerId,
    Instant submittedFrom,
    Instant submittedTo,
    Boolean escalated,
    int limit,
    String cursor
) {}
```

Query service owns:

- default sorting,
- max limit,
- tenant/security predicate,
- allowed status visibility,
- projection shape,
- query strategy.

Rule:

> Search query adalah business-facing read contract. Jangan jadikan sekadar `findByWhatever` repository method yang tumbuh liar.

---

## 24. Provider Differences That Matter

### 24.1 Hibernate

Hibernate query stack modern menggunakan semantic query model dan SQL AST. Hibernate HQL memiliki kemampuan lebih luas daripada JPQL standar. Hibernate juga punya banyak hint/extension:

- read-only query,
- fetch size,
- comments,
- cacheable query,
- query timeout,
- filters,
- entity graphs,
- fetch profiles,
- custom functions,
- custom types.

Yang harus diperhatikan:

- HQL extension tidak portable,
- Hibernate 5 ke 6 mengubah query/type/dialect behavior cukup signifikan,
- Hibernate 6/7 lebih strict di beberapa area query typing,
- query yang dulu “kebetulan jalan” bisa gagal setelah upgrade.

### 24.2 EclipseLink

EclipseLink memiliki query system yang terkait dengan descriptors, sessions, expressions, query hints, batch reading, join fetching, fetch groups, dan shared cache.

Yang harus diperhatikan:

- weaving/fetch group behavior bisa berbeda dari Hibernate,
- cache interaction bisa berbeda,
- query hints berbeda,
- JPQL parsing/translation bisa berbeda,
- native query/entity mapping behavior perlu diuji.

### 24.3 Portability Rule

Query portable hanya jika:

- memakai JPQL standar,
- tidak memakai provider-specific function/hint,
- tidak bergantung pada generated SQL shape tertentu,
- tidak bergantung pada lazy/proxy side effect tertentu,
- diuji di provider target.

Kalau aplikasi production standardized di Hibernate, tidak salah memakai Hibernate feature. Yang salah adalah memakai feature Hibernate tetapi mengira code masih provider-portable.

---

## 25. Query and Cache

Ada beberapa cache yang sering tercampur:

```text
First-level cache / persistence context
    per EntityManager/Session

Second-level cache
    shared across sessions, provider/cache-provider dependent

Query cache
    caches query result identifiers/scalars, provider-specific

Database plan cache
    database execution plan cache

ORM query plan cache
    parsed/compiled JPQL/HQL/Criteria representation
```

Query cache bukan magic performance fix.

Query cache cocok jika:

- result sering sama,
- table jarang berubah,
- invalidation cost rendah,
- query result kecil/stabil,
- correctness terhadap stale data acceptable/managed.

Query cache buruk jika:

- table sering berubah,
- filter sangat bervariasi,
- result besar,
- user-specific/tenant-specific predicate kompleks,
- invalidation sering terjadi,
- data harus strongly fresh.

Untuk regulatory/case management system, banyak query bersifat user-specific, permission-specific, dan status frequently updated. Query cache harus sangat hati-hati.

Rule:

> Cache query result hanya jika freshness model dan invalidation model jelas.

---

## 26. Query Security: Tenant, Permission, and Data Leakage

Query bukan sekadar data access. Query adalah security boundary.

Minimal predicate untuk sistem multi-tenant/agency-scoped:

```java
where c.agency.id in :allowedAgencyIds
```

Atau:

```java
where c.tenantId = :tenantId
```

Bahaya:

- satu repository method lupa tenant predicate,
- native SQL bypass filter,
- count query lupa permission predicate,
- export query berbeda dari listing query,
- admin query dipakai endpoint biasa,
- cache result tidak include tenant/security key,
- async job kehilangan security context.

Pattern:

```text
Every query must declare its visibility model:

1. public/global reference data
2. tenant-scoped data
3. agency-scoped data
4. officer-assigned data
5. role-based confidential data
6. system/internal maintenance data
```

Untuk query penting, review bukan hanya:

- apakah SQL cepat?

Tetapi juga:

- apakah SQL membatasi data sesuai authority?
- apakah count dan data query punya predicate yang sama?
- apakah native query bypass ORM filter?
- apakah cache key include tenant/user/scope?

---

## 27. Query Observability

Query production harus bisa diinvestigasi.

### 27.1 SQL Logging

Development:

```properties
hibernate.show_sql=false
hibernate.format_sql=true
```

Lebih baik pakai logger kategori provider, bukan `show_sql`, karena logger bisa dikontrol.

Yang dibutuhkan:

- SQL text,
- bind values di environment aman,
- elapsed time,
- row count,
- request/correlation ID,
- repository/use case name,
- transaction ID kalau ada,
- tenant/agency context tanpa PII berlebih.

### 27.2 Query Comment

Hibernate mendukung query comment melalui hint/provider API.

Contoh intent:

```java
query.setHint("org.hibernate.comment", "CaseSearchQuery.listOpenCasesForOfficer");
```

Tujuan:

- SQL log bisa dikaitkan ke use case,
- DBA bisa mengenali query source,
- slow query analysis lebih cepat.

### 27.3 Metrics

Metric penting:

- query count per request,
- slow query count,
- p95/p99 query latency,
- rows returned,
- entity load count,
- collection fetch count,
- flush count,
- connection acquisition time,
- statement prepare count,
- second-level cache hit/miss,
- query plan cache hit/miss jika tersedia.

Rule:

> Query optimization tanpa observability adalah tebak-tebakan.

---

## 28. Query Testing Strategy

### 28.1 Test Generated Semantics, Not Just Result

Test repository umum:

```java
@Test
void findsOpenCases() {
    List<CaseFile> result = repository.findOpenCases();
    assertThat(result).hasSize(2);
}
```

Ini belum cukup.

Tambahkan:

- SQL count assertion untuk mencegah N+1,
- pagination stability test,
- permission predicate test,
- empty filter test,
- boundary date test,
- duplicate/unique test,
- provider/database integration test,
- execution plan review untuk query kritis.

### 28.2 H2 Trap

Query JPQL mungkin jalan di H2 tetapi gagal di Oracle/PostgreSQL/MySQL karena:

- function berbeda,
- reserved word berbeda,
- pagination berbeda,
- timestamp precision berbeda,
- lock syntax berbeda,
- SQL dialect berbeda,
- case sensitivity berbeda.

Untuk query provider/dialect-sensitive, gunakan database target via Testcontainers atau integration DB.

### 28.3 Test Count Query Separately

Jika repository punya pagination:

```text
findPage(filter)
count(filter)
```

Test bahwa:

- count predicate sama dengan data predicate,
- security filter sama,
- count tidak duplicate karena join,
- count tidak memakai fetch join,
- count performance acceptable.

---

## 29. Query Anti-Patterns

### 29.1 Entity Query for Every Read

```java
List<CaseFile> cases = repository.findAll();
return cases.stream().map(CaseDto::from).toList();
```

Masalah:

- over-fetching,
- lazy loading storm,
- memory besar,
- serialization risk,
- persistence context bloat.

### 29.2 Native SQL for Everything

Masalah:

- kehilangan entity abstraction,
- duplicated mapping logic,
- tenant/security filter manual,
- portability rendah,
- refactor entity tidak sinkron.

Native SQL adalah alat kuat, bukan default untuk semua query.

### 29.3 Criteria API Without Boundaries

Masalah:

- query builder jadi monster,
- generated SQL tidak pernah dibaca,
- join/fetch tersembunyi,
- dynamic combinations tidak terkendali.

### 29.4 Fetch Join as Universal N+1 Fix

Masalah:

- cartesian explosion,
- broken pagination,
- duplicate root,
- memory spike.

### 29.5 String Concatenation Query

Masalah:

- injection,
- plan cache churn,
- escaping bug,
- observability buruk.

### 29.6 Missing Order in Paginated Query

Masalah:

- page tidak stabil,
- duplicate/missing item,
- bug sulit direproduksi.

### 29.7 Query Method Explosion

```java
findByStatusAndAgencyAndCreatedAtBetweenAndAssignedOfficerAndEscalatedAndRiskLevel...
```

Masalah:

- repository interface menjadi unreadable,
- business query tersebar,
- sulit enforce security predicate,
- sulit observability.

Gunakan query object/service untuk use case search kompleks.

---

## 30. Decision Matrix

| Need | Recommended Query Style | Notes |
|---|---|---|
| Load aggregate for command/update | JPQL/HQL entity query or `find` | Keep transaction boundary small |
| Simple portable entity read | JPQL | Avoid provider extensions |
| Hibernate-specific expressive query | HQL | Document provider dependency |
| Dynamic search filters | Criteria/query builder | Test generated SQL and count query |
| Read-only listing API | DTO projection | Avoid entity hydration |
| Dashboard aggregation | JPQL projection or native SQL | Use DB aggregation |
| Complex reporting | Native SQL/read model | Avoid forcing ORM graph |
| Recursive/tree query | Native SQL/CTE | Provider support varies |
| JSON operator/search | Native SQL or provider function | Treat as database-specific |
| Bulk mutation | JPQL bulk/native | Clear persistence context after |
| Streaming/export huge data | Projection/native/JDBC streaming | Control fetch size and memory |
| Stored procedure integration | `StoredProcedureQuery` | Refresh/clear stale context |
| Security-sensitive query | Explicit scoped predicate/RLS | Native must include security manually |

---

## 31. Production Failure Modes

### 31.1 Slow Endpoint After “Small” Query Change

Symptom:

- endpoint p95 naik dari 200ms ke 5s,
- DB CPU naik,
- query count sama.

Possible cause:

- added implicit join,
- order by unindexed expression,
- function on indexed column,
- fetch join collection,
- projection changed to entity query.

Diagnosis:

- compare SQL before/after,
- check execution plan,
- check rows scanned/returned,
- check entity load count,
- check memory allocation.

### 31.2 N+1 Hidden Behind DTO Mapper

Symptom:

- query list 50 cases,
- then 50 agency queries or 50 document queries.

Cause:

- entity query followed by mapper accessing lazy associations.

Fix:

- DTO projection,
- entity graph,
- batch fetch,
- explicit fetch plan.

### 31.3 Pagination Duplicate/Missing Results

Cause:

- no deterministic order,
- order by non-unique column only,
- data changed between page requests,
- fetch join collection with pagination.

Fix:

- stable order with id tie-breaker,
- keyset pagination,
- two-step ID pagination.

### 31.4 Constraint Violation During Select

Cause:

- AUTO flush before query,
- dirty entity invalid,
- query triggers flush.

Fix:

- validate before query,
- explicit flush at controlled point,
- split transaction/use case,
- clear invalid state.

### 31.5 Query Plan Cache Memory Growth

Cause:

- dynamic query strings with literal values,
- too many generated query shapes,
- query builder creates unique aliases/comments/literals.

Fix:

- parameter binding,
- limit dynamic shape,
- reuse named query/criteria structure,
- monitor provider query plan cache.

### 31.6 Stale Data After Native/Bulk/Procedure Update

Cause:

- persistence context still contains old managed entity.

Fix:

- `em.clear()`,
- `em.refresh(entity)`,
- separate transaction,
- avoid mixing bulk/native mutation with managed graph changes.

### 31.7 Data Leakage From Native Query

Cause:

- missing tenant/security predicate,
- ORM filter not applied,
- cache key not scoped.

Fix:

- explicit predicate,
- DB Row-Level Security for strong boundary,
- query review checklist,
- test cross-tenant access.

---

## 32. Design Rules

1. Query by intent, not by convenience.
2. Entity query is for managed aggregate work; projection query is for read response.
3. Every paginated query needs deterministic order.
4. Every security-scoped query must declare its visibility predicate.
5. Every native query must be reviewed for tenant/security/filter bypass.
6. Every dynamic query builder must control query shape explosion.
7. Every query that crosses association must be read as potential join.
8. Join is not fetch join.
9. Fetch join is not universal N+1 cure.
10. Bulk/native/procedure mutation can stale the persistence context.
11. Parameter binding is mandatory for external values.
12. Function on column is a possible index killer.
13. DTO projection is often the right default for API listing.
14. Count query is a separate query, not a mechanical copy.
15. Query hints must be documented as provider-specific behavior.
16. Query performance must be tested on target database dialect.
17. `getSingleResult()` requires explicit handling of no result and duplicate result.
18. Query observability must connect SQL to use case.
19. Provider portability is a design choice, not an accidental property.
20. If the query is fundamentally relational/reporting-oriented, do not force it into object graph loading.

---

## 33. Practical Checklist Before Shipping a Query

For every important query, ask:

### Semantics

- What business question does this query answer?
- Does it return entity, DTO, scalar, or aggregate?
- Does the caller intend to modify returned data?
- Does it require fresh data?
- Does it interact with pending changes in persistence context?

### Security

- Is it tenant-scoped?
- Is it agency/user/role scoped?
- Does count query have same scope?
- Does native SQL bypass ORM filters?
- Is cache key scope-safe?

### Performance

- What SQL is generated?
- What indexes support predicates and ordering?
- How many rows are scanned?
- How many rows are returned?
- How many objects are hydrated?
- Does it trigger N+1?
- Does it create cartesian product?
- Does it paginate correctly?
- Does it use stable bind parameters?

### Provider/Dialect

- Is it JPQL-standard, HQL-specific, EclipseLink-specific, or native SQL?
- Does it use database function?
- Does it rely on dialect-specific pagination/lock/function?
- Is it tested on target database?
- Will migration Hibernate 5→6/7 or EclipseLink 2→4 affect it?

### Operational

- Can we identify this query in logs?
- Do we have slow query metrics?
- Is bind value logging safe in environment?
- Is timeout configured for risky query?
- Is max result bounded?

---

## 34. Example: Case Search Query Done Properly

### 34.1 Use Case

Officer wants to search case files visible to their agency, filtered by status and submitted date range, displayed in a paginated list.

### 34.2 Bad Implementation

```java
public List<CaseFile> search(String status, String from, String to) {
    return em.createQuery("""
        select c
        from CaseFile c
        where c.status = '""" + status + """'
          and c.submittedAt >= '""" + from + """'
          and c.submittedAt <= '""" + to + """'
        order by c.submittedAt desc
    """, CaseFile.class)
    .setMaxResults(50)
    .getResultList();
}
```

Problems:

- string concatenation,
- injection risk,
- plan cache churn,
- entity over-fetching,
- no agency visibility predicate,
- inclusive timestamp boundary risk,
- no tie-breaker order,
- DTO mapper may trigger N+1,
- no max limit validation,
- no count query design.

### 34.3 Better DTO Projection

```java
public PageSlice<CaseListItem> search(CaseSearchFilter filter, UserScope scope) {
    int limit = Math.min(filter.limit(), 100);

    List<CaseListItem> items = em.createQuery("""
        select new com.acme.caseapp.CaseListItem(
            c.id,
            c.referenceNo,
            c.status,
            c.submittedAt,
            a.name,
            assignee.displayName
        )
        from CaseFile c
        join c.agency a
        left join c.assignedOfficer assignee
        where a.id in :allowedAgencyIds
          and (:status is null or c.status = :status)
          and (:from is null or c.submittedAt >= :from)
          and (:to is null or c.submittedAt < :to)
        order by c.submittedAt desc, c.id desc
    """, CaseListItem.class)
    .setParameter("allowedAgencyIds", scope.allowedAgencyIds())
    .setParameter("status", filter.status())
    .setParameter("from", filter.submittedFrom())
    .setParameter("to", filter.submittedTo())
    .setMaxResults(limit + 1)
    .getResultList();

    boolean hasNext = items.size() > limit;
    if (hasNext) {
        items = items.subList(0, limit);
    }

    return new PageSlice<>(items, hasNext);
}
```

Notes:

- DTO projection avoids entity hydration.
- Security scope is explicit.
- Date range uses half-open interval.
- Sorting has stable tie-breaker.
- Limit is bounded.
- Associations are joined for projection, not lazy-loaded later.

Potential issue:

```java
(:status is null or c.status = :status)
```

This keeps query shape stable, but some databases may optimize worse than generating predicate only when non-null. Measure on target database. For highly critical query, dynamic predicate can be better.

### 34.4 Criteria Version For Dynamic Predicates

```java
public PageSlice<CaseListItem> search(CaseSearchFilter filter, UserScope scope) {
    CriteriaBuilder cb = em.getCriteriaBuilder();
    CriteriaQuery<CaseListItem> cq = cb.createQuery(CaseListItem.class);

    Root<CaseFile> c = cq.from(CaseFile.class);
    Join<CaseFile, Agency> a = c.join("agency");
    Join<CaseFile, Officer> assignee = c.join("assignedOfficer", JoinType.LEFT);

    List<Predicate> predicates = new ArrayList<>();
    predicates.add(a.get("id").in(scope.allowedAgencyIds()));

    if (filter.status() != null) {
        predicates.add(cb.equal(c.get("status"), filter.status()));
    }
    if (filter.submittedFrom() != null) {
        predicates.add(cb.greaterThanOrEqualTo(c.get("submittedAt"), filter.submittedFrom()));
    }
    if (filter.submittedTo() != null) {
        predicates.add(cb.lessThan(c.get("submittedAt"), filter.submittedTo()));
    }

    cq.select(cb.construct(
            CaseListItem.class,
            c.get("id"),
            c.get("referenceNo"),
            c.get("status"),
            c.get("submittedAt"),
            a.get("name"),
            assignee.get("displayName")
    ));

    cq.where(predicates.toArray(Predicate[]::new));
    cq.orderBy(cb.desc(c.get("submittedAt")), cb.desc(c.get("id")));

    int limit = Math.min(filter.limit(), 100);

    List<CaseListItem> items = em.createQuery(cq)
            .setMaxResults(limit + 1)
            .getResultList();

    boolean hasNext = items.size() > limit;
    if (hasNext) {
        items = items.subList(0, limit);
    }

    return new PageSlice<>(items, hasNext);
}
```

Trade-off:

- more verbose,
- fewer awkward `:param is null` predicates,
- dynamic query shape,
- easier to add optional filters safely if builder is disciplined.

---

## 35. Java 8–25 Compatibility Notes

### Java 8

- JPA 2.x commonly uses `javax.persistence`.
- Java Time API exists, but provider support depends on JPA/provider version.
- Hibernate 5.x and EclipseLink 2.x are common legacy lines.
- Criteria API available but verbose.
- Stream query support depends on JPA 2.2/provider.

### Java 11/17

- Common migration target for Jakarta EE 9/10 era.
- `jakarta.persistence` namespace appears in Jakarta Persistence 3.x.
- Hibernate 6 and EclipseLink 3/4 become relevant depending framework.
- Stronger module/classpath awareness.

### Java 21

- Strong modern LTS baseline.
- Hibernate 6/7 and modern Spring/Jakarta stacks commonly align here.
- Records can be useful for DTO projection classes, though JPQL constructor projection requires compatible constructor.

Example record DTO:

```java
public record CaseListItem(
    Long id,
    String referenceNo,
    CaseStatus status,
    Instant submittedAt,
    String agencyName
) {}
```

JPQL:

```java
select new com.acme.CaseListItem(c.id, c.referenceNo, c.status, c.submittedAt, a.name)
from CaseFile c
join c.agency a
```

### Java 25

- Treat as modern runtime target.
- ORM query discipline remains the same.
- Main concern is provider/framework compatibility, not query language semantics itself.
- Verify bytecode enhancement/weaving/tooling compatibility with Java 25.

---

## 36. References

Primary references to verify specification/provider context:

1. Jakarta Persistence 3.2 Specification — official specification for Jakarta Persistence query language, Criteria API, native query, stored procedure query, and query semantics.  
   `https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2`

2. Jakarta Persistence API Docs — official API reference including `Query`, `TypedQuery`, `CriteriaBuilder`, `StoredProcedureQuery`, and related contracts.  
   `https://jakarta.ee/specifications/persistence/3.2/apidocs/`

3. Hibernate ORM Documentation — official Hibernate ORM user guide and query/HQL/provider behavior reference.  
   `https://docs.hibernate.org/orm/`

4. Hibernate ORM Releases — official release line context for Hibernate ORM versions.  
   `https://hibernate.org/orm/releases/`

5. EclipseLink Documentation — official EclipseLink documentation for JPQL, native SQL, query hints, batch reading, fetch groups, cache, and provider extensions.  
   `https://eclipse.dev/eclipselink/documentation/`

6. EclipseLink Query Hints API/Docs — provider-specific query hint reference.  
   `https://eclipse.dev/eclipselink/api/`

---

## 37. Summary

Query in JPA provider engineering is not merely syntax. It is the point where domain intent becomes database work.

The core mental model:

```text
JPQL/HQL/Criteria/native SQL
    -> provider semantic interpretation
    -> SQL generation or direct SQL execution
    -> database execution plan
    -> result hydration/projection
    -> persistence context/cache interaction
    -> application behavior
```

Key takeaways:

- JPQL is entity-oriented, not table-oriented.
- HQL is powerful but Hibernate-specific.
- Criteria is useful for dynamic query composition but can become unreadable and uncontrolled.
- Native SQL is essential for certain problems but must be treated as manual security/performance responsibility.
- Entity query and DTO projection serve different use cases.
- Pagination requires deterministic ordering.
- Fetch join and pagination over collections are dangerous together.
- Parameter binding protects security and plan stability.
- Query plan discipline matters for provider and database performance.
- Bulk/native/procedure mutations can stale persistence context.
- Security predicates must be explicit and tested.
- Query observability is mandatory for production debugging.

A top-tier persistence engineer does not ask only:

> “Does this query return the expected data?”

They ask:

> “What SQL is generated, what data is visible, what graph is materialized, what state is cached, what transaction is affected, what plan is reused, what failure mode appears under production volume, and what changes after provider/database migration?”

That is the difference between writing ORM queries and engineering a persistence layer.

---

# End of Part 16

Next part:

`17-bulk-operations-batching-stateless-sessions-high-volume-mutation.md`

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./15-n-plus-one-cartesian-explosion-fetch-plan-engineering.md">⬅️ Part 15 — N+1, Cartesian Explosion, and Fetch Plan Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./17-bulk-operations-batching-stateless-sessions-high-volume-mutation.md">Part 17 — Bulk Operations, Batching, Stateless Sessions, and High-Volume Data Mutation ➡️</a>
</div>

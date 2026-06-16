# Part 007 — Fetching Strategy: Lazy, Eager, N+1, Entity Graph, Fetch Join

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Part: `007 / 032`  
> Scope Java: Java 8 hingga Java 25  
> Scope API: JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, Spring Data JPA, Jakarta Data context  
> Fokus: fetch planning, lazy/eager loading, N+1, join fetch, entity graph, batch fetching, subselect fetching, projection, pagination, dan operational failure mode.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa **fetching bukan detail kecil ORM**, melainkan bagian dari desain use case.
2. Membedakan:
   - mapping-time fetch strategy,
   - query-time fetch plan,
   - runtime lazy loading,
   - projection/read model.
3. Menjelaskan kenapa `FetchType.EAGER` sering menjadi sumber performa buruk.
4. Menjelaskan kenapa `FetchType.LAZY` bukan solusi otomatis kalau boundary transaksi salah.
5. Mendeteksi dan memperbaiki **N+1 query problem**.
6. Menggunakan:
   - `JOIN FETCH`,
   - `EntityGraph`,
   - batch fetching,
   - subselect fetching,
   - DTO projection,
   - keyset pagination,
   - read model query.
7. Memahami batasan fetch join dengan pagination dan multiple collections.
8. Membuat keputusan fetch berdasarkan:
   - use case,
   - cardinality,
   - transaction boundary,
   - row explosion risk,
   - memory pressure,
   - database round trip,
   - query plan.
9. Mendesain fetch strategy untuk sistem besar seperti case management, regulatory workflow, audit trail, compliance, correspondence, document management, dan reporting.

---

## 2. Mental Model Utama

### 2.1 Fetching adalah rencana membawa graph data dari database ke memory

Entity di Java bisa punya object graph seperti ini:

```text
Case
 ├── applicant
 ├── assignedOfficer
 ├── status
 ├── submissions[]
 ├── documents[]
 ├── auditTrails[]
 ├── correspondences[]
 └── tasks[]
```

Tetapi database menyimpannya sebagai tabel dan foreign key:

```text
case
applicant
user/officer
submission
document
audit_trail
correspondence
task
```

Ketika aplikasi menjalankan:

```java
CaseEntity c = entityManager.find(CaseEntity.class, caseId);
```

pertanyaan pentingnya bukan hanya:

> “Apakah case ditemukan?”

Tetapi juga:

> “Bagian graph mana yang ikut dimuat sekarang, bagian mana yang dimuat nanti, bagian mana yang tidak boleh dimuat sama sekali, dan bagian mana yang seharusnya tidak dimodelkan sebagai entity read?”

Itulah inti fetch strategy.

---

### 2.2 ORM tidak bisa menebak kebutuhan use case

ORM tahu mapping, tetapi ORM tidak tahu intent bisnis.

Contoh:

```java
@Entity
class CaseEntity {
    @OneToMany(mappedBy = "caseEntity")
    private List<AuditTrailEntity> auditTrails;
}
```

Untuk use case **case detail internal**, mungkin perlu:

- applicant,
- status,
- assigned officer,
- latest tasks,
- latest documents.

Untuk use case **case listing**, mungkin hanya perlu:

- case number,
- applicant name,
- status,
- submitted date,
- SLA due date.

Untuk use case **audit report**, mungkin perlu audit trail tetapi tidak perlu document binary.

Untuk use case **export regulatory evidence**, mungkin perlu audit trail lengkap, correspondence, document metadata, tetapi bukan seluruh object graph dalam satu query.

Jadi fetch plan seharusnya melekat ke **use case**, bukan sekadar annotation pada entity.

---

### 2.3 Fetching selalu trade-off antara query count, row width, row depth, memory, dan correctness

Tidak ada fetch strategy yang selalu benar.

| Strategy | Kelebihan | Risiko |
|---|---|---|
| Lazy select | initial query ringan | N+1 jika akses association dalam loop |
| Eager mapping | data tersedia langsung | over-fetching, hidden joins, sulit dikontrol |
| Join fetch | mengurangi round trip | row explosion, duplicate root, pagination rusak |
| Entity graph | fetch plan lebih deklaratif | provider behavior, tetap bisa over-fetch |
| Batch fetching | mitigasi N+1 | masih query tambahan, batch size harus dituning |
| Subselect fetching | bagus untuk collection dari result set tertentu | bisa berat jika parent result besar |
| DTO projection | presisi untuk read use case | tidak managed, tidak cocok untuk update entity |
| Native SQL | kontrol penuh | portability turun, mapping manual |

Senior engineer tidak bertanya:

> “Lazy atau eager?”

Tetapi:

> “Untuk use case ini, berapa row, berapa association, cardinality-nya apa, apakah perlu update, apakah dipaginate, apakah data stale acceptable, dan bagaimana query plan-nya?”

---

## 3. Vocabulary Penting

### 3.1 FetchType

`FetchType` adalah hint pada mapping association atau basic attribute.

```java
@ManyToOne(fetch = FetchType.LAZY)
private OfficerEntity assignedOfficer;

@OneToMany(mappedBy = "caseEntity", fetch = FetchType.LAZY)
private List<DocumentEntity> documents;
```

Ada dua nilai:

```java
FetchType.LAZY
FetchType.EAGER
```

Secara praktis:

- `LAZY`: provider boleh menunda loading sampai attribute diakses.
- `EAGER`: provider harus memastikan data tersedia saat entity dimuat.

Catatan penting:

- `LAZY` secara specification sering berupa hint; provider butuh proxy/enhancement untuk merealisasikannya.
- Pada Hibernate modern, lazy untuk association umum dipakai luas.
- Untuk basic field tertentu, lazy membutuhkan bytecode enhancement/provider support.

---

### 3.2 Default fetch type JPA/Jakarta Persistence

Default yang sering menjebak:

```text
@ManyToOne  -> EAGER by default
@OneToOne   -> EAGER by default
@OneToMany  -> LAZY by default
@ManyToMany -> LAZY by default
@ElementCollection -> LAZY by default
```

Implikasi:

```java
@ManyToOne
private OfficerEntity assignedOfficer;
```

secara default adalah eager.

Untuk sistem besar, sebaiknya tulis eksplisit:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "assigned_officer_id", nullable = false)
private OfficerEntity assignedOfficer;
```

Alasannya:

1. Membaca entity langsung jelas.
2. Reviewer tidak perlu mengingat default JPA.
3. Mencegah accidental eager association.
4. Membuat fetch plan lebih dikendalikan di query/use case.

---

### 3.3 Fetch plan

Fetch plan adalah keputusan aktual tentang attribute/association mana yang dimuat untuk sebuah operasi.

Fetch plan bisa berasal dari:

1. Mapping annotation:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

2. Query `JOIN FETCH`:

```java
select c
from CaseEntity c
join fetch c.applicant
where c.id = :id
```

3. Entity graph:

```java
@NamedEntityGraph(
    name = "Case.detail",
    attributeNodes = {
        @NamedAttributeNode("applicant"),
        @NamedAttributeNode("assignedOfficer"),
        @NamedAttributeNode("status")
    }
)
```

4. Provider-specific option:

```java
@BatchSize(size = 50)
@Fetch(FetchMode.SUBSELECT)
```

5. DTO projection:

```java
select new com.example.CaseListItem(c.id, c.caseNo, a.name, c.status)
from CaseEntity c
join c.applicant a
```

6. Native SQL/read model.

---

### 3.4 Lazy loading

Lazy loading artinya association belum dimuat saat entity root dimuat. ORM biasanya menyimpan proxy atau persistent collection wrapper.

Contoh:

```java
CaseEntity c = entityManager.find(CaseEntity.class, id);

// applicant mungkin belum benar-benar di-load
String name = c.getApplicant().getName();
```

Saat `getName()` dipanggil, Hibernate bisa menjalankan SQL tambahan.

Mental model:

```text
managed entity + open persistence context + uninitialized proxy
        │
        ├── accessed inside transaction -> SQL tambahan mungkin dijalankan
        └── accessed outside transaction -> LazyInitializationException / failure
```

---

### 3.5 Eager loading

Eager loading berarti provider harus memuat association tersebut ketika entity dimuat.

Masalahnya: eager tidak selalu berarti satu SQL join. Provider bisa memakai:

- join,
- secondary select,
- multiple selects,
- batch select,
- internal fetch plan lain.

Jadi `EAGER` bukan jaminan efisien.

Lebih buruk lagi, eager association menjadi “sticky”. Query sederhana bisa diam-diam membawa graph yang tidak diminta.

---

### 3.6 N+1 query problem

N+1 terjadi saat:

1. Aplikasi mengambil N parent dengan 1 query.
2. Lalu mengakses association tiap parent.
3. ORM menjalankan 1 query tambahan per parent.

Contoh:

```java
List<CaseEntity> cases = entityManager.createQuery(
    "select c from CaseEntity c where c.status = :status",
    CaseEntity.class
).setParameter("status", CaseStatus.SUBMITTED)
 .getResultList();

for (CaseEntity c : cases) {
    System.out.println(c.getApplicant().getName());
}
```

SQL konseptual:

```sql
select * from case where status = 'SUBMITTED'; -- 1 query
select * from applicant where id = ?;          -- repeated N times
select * from applicant where id = ?;
select * from applicant where id = ?;
...
```

Jika `cases.size() == 500`, maka total bisa menjadi 501 query.

N+1 bukan hanya lambat. Ia juga:

- membebani connection pool,
- meningkatkan DB CPU,
- menambah network round trip,
- memperpanjang transaction duration,
- memperbesar risiko timeout,
- membuat performa bergantung jumlah row,
- sulit terlihat di local environment dengan data kecil.

---

## 4. Kenapa Fetching Sulit di Sistem Nyata

### 4.1 Object graph cenderung dalam, relational query cenderung flat

Object graph:

```text
Case -> Applicant -> Address -> Country
     -> Documents -> UploadedBy -> Department
     -> Tasks -> AssignedOfficer -> Role
     -> AuditTrails -> Actor
```

SQL result set berbentuk tabular.

Jika semua di-join, hasilnya bisa meledak:

```text
1 Case
10 Documents
8 Tasks
100 AuditTrails
```

Jika join semua collection:

```text
1 x 10 x 8 x 100 = 8,000 rows untuk 1 case
```

Padahal logical root hanya satu case.

Ini disebut **cartesian product / row explosion**.

---

### 4.2 Association cardinality menentukan fetch strategy

Fetch strategy tidak boleh dipilih tanpa cardinality.

| Association | Cardinality umum | Strategy umum |
|---|---:|---|
| Case -> Applicant | 1 | join fetch/entity graph aman |
| Case -> AssignedOfficer | 1 | join fetch/entity graph aman |
| Case -> Status | 1 | join fetch atau lookup cache |
| Case -> Documents | 0..puluhan | tergantung use case |
| Case -> AuditTrails | 0..ribuan/jutaan | jangan eager, projection/pagination |
| Case -> Correspondences | 0..ratusan | separate query/pagination |
| Case -> Tasks | 0..puluhan/ratusan | separate query atau limited read model |

Rule sederhana:

```text
To-one association biasanya aman untuk join fetch.
To-many association harus diperlakukan sangat hati-hati.
High-cardinality collection hampir tidak pernah layak eager.
```

---

### 4.3 Fetch plan untuk detail page berbeda dari listing page

Kesalahan umum:

```java
List<CaseEntity> cases = caseRepository.findAllSubmitted();
```

Lalu entity yang sama digunakan untuk:

- listing,
- detail,
- export,
- edit,
- approval,
- audit review.

Ini buruk karena setiap use case punya kebutuhan data berbeda.

Lebih benar:

```java
List<CaseListItem> findSubmittedCaseList(...);

CaseDetailView findCaseDetail(...);

CaseEntity findCaseForTransition(...);

List<AuditTrailItem> findAuditTrailPage(...);
```

Entity update model dan read model tidak harus sama.

---

## 5. Mapping-Time Fetch: LAZY sebagai Default Aman

### 5.1 Prinsip umum

Untuk aplikasi enterprise besar, default praktis:

```text
Semua association dibuat LAZY kecuali ada alasan kuat.
Fetch kebutuhan spesifik di query/use case.
```

Contoh:

```java
@Entity
@Table(name = "case_file")
public class CaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_seq")
    private Long id;

    @Column(name = "case_no", nullable = false, unique = true, length = 40)
    private String caseNo;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "applicant_id", nullable = false)
    private ApplicantEntity applicant;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assigned_officer_id")
    private OfficerEntity assignedOfficer;

    @OneToMany(mappedBy = "caseEntity", fetch = FetchType.LAZY)
    private List<DocumentEntity> documents = new ArrayList<>();

    @OneToMany(mappedBy = "caseEntity", fetch = FetchType.LAZY)
    private List<AuditTrailEntity> auditTrails = new ArrayList<>();
}
```

---

### 5.2 Kenapa LAZY tidak otomatis aman

`LAZY` hanya aman jika:

1. akses association terjadi dalam persistence context aktif, atau
2. association sudah difetch eksplisit sebelum keluar transaction, atau
3. data dikonversi ke DTO/projection sebelum boundary keluar, atau
4. association tidak diakses.

Contoh buruk:

```java
@Transactional
public CaseEntity getCase(Long id) {
    return caseRepository.findById(id).orElseThrow();
}

// Controller/serializer mengakses applicant setelah transaction selesai
```

Risiko:

- `LazyInitializationException`, atau
- OSIV membuat query tambahan saat rendering response, atau
- JSON serialization memicu graph traversal tak terkendali.

Lebih benar:

```java
@Transactional(readOnly = true)
public CaseDetailResponse getCaseDetail(Long id) {
    CaseEntity c = caseRepository.findDetailById(id).orElseThrow();

    return new CaseDetailResponse(
        c.getId(),
        c.getCaseNo(),
        c.getApplicant().getName(),
        c.getAssignedOfficer() == null ? null : c.getAssignedOfficer().getName()
    );
}
```

Boundary keluar membawa DTO, bukan lazy entity.

---

### 5.3 Kenapa EAGER sering buruk

Contoh:

```java
@ManyToOne(fetch = FetchType.EAGER)
private ApplicantEntity applicant;

@OneToMany(fetch = FetchType.EAGER, mappedBy = "caseEntity")
private List<DocumentEntity> documents;
```

Masalah:

1. Setiap load case membawa applicant dan documents walau tidak diperlukan.
2. Query listing bisa menjadi berat.
3. Eager to-many bisa menciptakan row explosion.
4. Sulit menonaktifkan eager untuk use case tertentu.
5. Entity graph/query tidak selalu bisa “menghapus” eager dengan portable behavior penuh.
6. JSON serialization bisa membawa graph besar.
7. Eager chain bisa memuat entity lain yang juga eager.

Rule:

```text
EAGER pada to-many collection hampir selalu red flag.
EAGER pada to-one perlu alasan kuat.
```

---

## 6. Query-Time Fetch dengan JOIN FETCH

### 6.1 Regular join vs fetch join

Regular join:

```java
select c
from CaseEntity c
join c.applicant a
where a.identityNo = :identityNo
```

Regular join dipakai untuk filtering/sorting, tetapi tidak menjamin association `applicant` dimuat ke entity graph.

Fetch join:

```java
select c
from CaseEntity c
join fetch c.applicant a
where a.identityNo = :identityNo
```

Fetch join menginstruksikan provider untuk memuat association sebagai bagian dari result entity.

---

### 6.2 Fetch join untuk to-one association

Sangat umum dan relatif aman:

```java
public Optional<CaseEntity> findDetailHeader(Long id) {
    return entityManager.createQuery("""
        select c
        from CaseEntity c
        join fetch c.applicant
        left join fetch c.assignedOfficer
        join fetch c.status
        where c.id = :id
        """, CaseEntity.class)
        .setParameter("id", id)
        .getResultStream()
        .findFirst();
}
```

Untuk detail header, join fetch to-one bagus karena:

- tidak menambah row multiplication signifikan,
- menghindari N+1,
- data memang dibutuhkan,
- association cardinality kecil.

---

### 6.3 Fetch join untuk to-many association

Contoh:

```java
select c
from CaseEntity c
left join fetch c.documents
where c.id = :id
```

Untuk satu case dan documents terbatas, ini bisa acceptable.

Tetapi untuk list:

```java
select c
from CaseEntity c
left join fetch c.documents
where c.status = :status
```

Jika 100 case masing-masing 20 documents:

```text
logical result: 100 cases
SQL result: up to 2,000 rows
```

Hibernate akan melakukan de-duplication root entity di persistence context, tetapi database, network, driver, dan memory tetap memproses row yang besar.

---

### 6.4 `distinct` dengan fetch join

JPQL:

```java
select distinct c
from CaseEntity c
left join fetch c.documents
where c.id = :id
```

`distinct` di JPQL memiliki dua aspek:

1. SQL-level distinct.
2. Object-level de-duplication root entity.

Masalah:

- SQL distinct terhadap banyak kolom hasil join belum tentu mengurangi row.
- `distinct` tidak menghilangkan row explosion secara fundamental.
- Untuk collection besar, solusi yang lebih baik sering projection/separate query.

---

### 6.5 Fetch join tidak boleh dipakai sembarangan dengan pagination

Contoh berbahaya:

```java
select c
from CaseEntity c
left join fetch c.documents
where c.status = :status
order by c.submittedAt desc
```

lalu:

```java
query.setFirstResult(0);
query.setMaxResults(20);
```

Masalah:

Pagination terjadi terhadap row SQL, bukan logical parent entity, atau provider melakukan in-memory pagination setelah fetch join collection.

Dampak:

- page berisi jumlah parent tidak konsisten,
- collection terpotong,
- query berat,
- warning Hibernate,
- memory spike.

Prinsip:

```text
Jangan pagination langsung pada query yang fetch join to-many collection.
```

Solusi umum:

1. Page id parent dulu.
2. Fetch detail berdasarkan id.
3. Gunakan batch fetching.
4. Gunakan DTO projection.
5. Gunakan two-step query.

Contoh two-step:

```java
List<Long> ids = entityManager.createQuery("""
    select c.id
    from CaseEntity c
    where c.status = :status
    order by c.submittedAt desc
    """, Long.class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .setFirstResult(page * size)
    .setMaxResults(size)
    .getResultList();

List<CaseEntity> cases = entityManager.createQuery("""
    select distinct c
    from CaseEntity c
    left join fetch c.applicant
    left join fetch c.assignedOfficer
    where c.id in :ids
    """, CaseEntity.class)
    .setParameter("ids", ids)
    .getResultList();
```

Kemudian order perlu dikembalikan sesuai urutan `ids` jika database tidak menjamin order `IN`.

---

### 6.6 Multiple collection fetch join

Contoh:

```java
select c
from CaseEntity c
left join fetch c.documents
left join fetch c.tasks
where c.id = :id
```

Jika:

```text
10 documents
8 tasks
```

SQL result bisa menjadi:

```text
10 x 8 = 80 rows
```

Jika tambah audit trail:

```text
10 documents x 8 tasks x 100 audit trails = 8,000 rows
```

Hibernate juga memiliki constraint khusus terkait multiple bag fetching pada mapping tertentu karena hasil cartesian product tidak bisa direkonstruksi secara aman/efisien untuk beberapa `List`/bag.

Prinsip:

```text
Fetch join satu collection kecil mungkin acceptable.
Fetch join banyak collection hampir selalu salah.
```

---

## 7. Entity Graph

### 7.1 Apa itu EntityGraph

EntityGraph adalah cara JPA/Jakarta Persistence mendeklarasikan fetch plan secara lebih terstruktur daripada menulis `JOIN FETCH` di setiap query.

Contoh:

```java
@NamedEntityGraph(
    name = "Case.detailHeader",
    attributeNodes = {
        @NamedAttributeNode("applicant"),
        @NamedAttributeNode("assignedOfficer"),
        @NamedAttributeNode("status")
    }
)
@Entity
@Table(name = "case_file")
public class CaseEntity {
    // ...
}
```

Penggunaan:

```java
EntityGraph<?> graph = entityManager.getEntityGraph("Case.detailHeader");

CaseEntity c = entityManager.find(
    CaseEntity.class,
    id,
    Map.of("jakarta.persistence.fetchgraph", graph)
);
```

Untuk JPA lama:

```java
Map.of("javax.persistence.fetchgraph", graph)
```

Untuk Jakarta:

```java
Map.of("jakarta.persistence.fetchgraph", graph)
```

---

### 7.2 Fetch graph vs load graph

Ada dua mode utama.

#### Fetch graph

```java
"jakarta.persistence.fetchgraph"
```

Mental model:

```text
Attribute yang ada di graph -> diperlakukan eager.
Attribute yang tidak ada di graph -> diperlakukan lazy.
```

Ini berguna ketika kamu ingin fetch plan eksplisit.

#### Load graph

```java
"jakarta.persistence.loadgraph"
```

Mental model:

```text
Attribute yang ada di graph -> diperlakukan eager.
Attribute lain mengikuti mapping default/eager yang sudah ada.
```

Ini lebih “menambah” kebutuhan fetch daripada “membatasi”.

Praktis:

- Gunakan `fetchgraph` jika ingin fetch plan lebih eksplisit.
- Gunakan `loadgraph` jika ingin mempertahankan mapping eager yang ada sambil menambah beberapa association.

---

### 7.3 Dynamic entity graph

Tidak semua graph harus annotation.

```java
EntityGraph<CaseEntity> graph = entityManager.createEntityGraph(CaseEntity.class);
graph.addAttributeNodes("applicant", "assignedOfficer", "status");

CaseEntity c = entityManager.find(
    CaseEntity.class,
    id,
    Map.of("jakarta.persistence.fetchgraph", graph)
);
```

Subgraph:

```java
EntityGraph<CaseEntity> graph = entityManager.createEntityGraph(CaseEntity.class);
graph.addAttributeNodes("applicant", "assignedOfficer");

Subgraph<DocumentEntity> documentGraph = graph.addSubgraph("documents");
documentGraph.addAttributeNodes("type", "uploadedBy");
```

Tetapi hati-hati: subgraph collection tetap bisa menyebabkan row explosion jika provider memilih join atau memuat terlalu banyak.

---

### 7.4 EntityGraph dalam Spring Data JPA

Contoh:

```java
public interface CaseRepository extends JpaRepository<CaseEntity, Long> {

    @EntityGraph(attributePaths = {"applicant", "assignedOfficer", "status"})
    Optional<CaseEntity> findWithHeaderById(Long id);
}
```

Atau named graph:

```java
@EntityGraph(value = "Case.detailHeader", type = EntityGraph.EntityGraphType.FETCH)
Optional<CaseEntity> findById(Long id);
```

Kelebihan:

- repository method lebih deklaratif,
- query method tetap ringkas,
- fetch plan terlihat di boundary repository.

Risiko:

- method name terlihat sederhana tetapi SQL bisa berat,
- fetch graph bisa sulit dilihat jika terlalu banyak annotation,
- tidak menggantikan query review dan SQL monitoring.

---

### 7.5 EntityGraph vs Join Fetch

| Aspek | Join Fetch | Entity Graph |
|---|---|---|
| Ditulis di query | Ya | Tidak selalu |
| Cocok untuk query custom | Sangat cocok | Cocok untuk reusable fetch plan |
| Mudah lihat SQL intention | Relatif jelas | Tergantung provider/log |
| Bisa dipakai dengan `find` | Tidak langsung | Ya |
| Portable JPA | Ya | Ya |
| Kontrol join/filter | Lebih kuat | Lebih deklaratif |
| Risiko over-fetch | Ada | Ada |

Rule praktis:

```text
Gunakan join fetch untuk query use-case-specific yang jelas.
Gunakan entity graph untuk fetch plan reusable pada find/query sederhana.
Gunakan projection untuk listing/reporting yang tidak butuh managed entity.
```

---

## 8. Batch Fetching

### 8.1 Problem yang diselesaikan

N+1:

```text
1 query parent + 100 query applicant
```

Batch fetching mencoba mengubahnya menjadi:

```text
1 query parent + beberapa query applicant batch
```

Contoh konseptual:

```sql
select * from case where status = 'SUBMITTED';

select * from applicant where id in (?, ?, ?, ..., ?); -- batch 50
select * from applicant where id in (?, ?, ?, ..., ?); -- batch 50
```

---

### 8.2 Hibernate `@BatchSize`

```java
@ManyToOne(fetch = FetchType.LAZY)
@BatchSize(size = 50)
@JoinColumn(name = "applicant_id")
private ApplicantEntity applicant;
```

Atau pada entity target:

```java
@Entity
@BatchSize(size = 50)
public class ApplicantEntity {
    // ...
}
```

Untuk collection:

```java
@OneToMany(mappedBy = "caseEntity", fetch = FetchType.LAZY)
@BatchSize(size = 20)
private List<DocumentEntity> documents = new ArrayList<>();
```

Konfigurasi global Hibernate juga tersedia, misalnya default batch fetch size.

---

### 8.3 Kapan batch fetching cocok

Cocok ketika:

1. Association lazy diakses untuk banyak parent.
2. To-one association sering diakses setelah query parent.
3. Collection kecil-menengah diakses untuk beberapa parent.
4. Kamu tidak ingin join fetch karena pagination atau row explosion.
5. Access pattern cukup predictable.

Contoh listing internal:

```java
List<CaseEntity> cases = findPageOfCases();

for (CaseEntity c : cases) {
    // applicant di-load batch, bukan satu-satu
    row(c.getCaseNo(), c.getApplicant().getName());
}
```

Tetapi untuk listing, projection biasanya lebih presisi.

---

### 8.4 Risiko batch fetching

Batch fetching bukan magic.

Risiko:

- tetap menghasilkan query tambahan,
- batch size terlalu kecil -> masih banyak query,
- batch size terlalu besar -> SQL `IN` besar, plan buruk,
- sulit diprediksi jika graph traversal acak,
- bisa menyembunyikan desain read model yang salah.

Rule:

```text
Batch fetching adalah mitigasi N+1, bukan alasan untuk tidak mendesain query.
```

---

## 9. Subselect Fetching

### 9.1 Konsep

Subselect fetching memuat collection untuk semua parent dari result set sebelumnya dengan query berbasis subselect.

Konseptual:

```sql
select *
from case
where status = 'SUBMITTED';

select *
from document
where case_id in (
    select id
    from case
    where status = 'SUBMITTED'
);
```

Hibernate menyediakan `FetchMode.SUBSELECT` sebagai provider-specific feature.

```java
@OneToMany(mappedBy = "caseEntity", fetch = FetchType.LAZY)
@Fetch(FetchMode.SUBSELECT)
private List<DocumentEntity> documents = new ArrayList<>();
```

---

### 9.2 Kapan berguna

Berguna ketika:

- parent result set relatif terbatas,
- collection perlu diakses untuk semua parent,
- ingin menghindari N+1,
- join fetch akan menghasilkan row duplication besar,
- pagination sudah dilakukan dengan hati-hati.

---

### 9.3 Risiko

Risiko:

- jika parent result besar, subselect menjadi berat,
- query bisa tidak cocok dengan semua database/query plan,
- provider-specific,
- bisa sulit diprediksi oleh developer baru,
- tidak selalu cocok untuk multi-tenant/filter kompleks.

Rule:

```text
Subselect fetching adalah optimasi spesifik. Gunakan setelah memahami result set dan query plan.
```

---

## 10. Projection sebagai Fetch Strategy Paling Presisi untuk Read Use Case

### 10.1 Kenapa projection penting

Untuk listing, search, dashboard, report, dan autocomplete, sering kali entity adalah bentuk data yang salah.

Contoh listing case:

```text
Case No | Applicant Name | Status | Submitted At | Assigned Officer | SLA Due
```

Tidak perlu managed `CaseEntity` lengkap.

Gunakan DTO/record:

```java
public record CaseListItem(
    Long id,
    String caseNo,
    String applicantName,
    String status,
    Instant submittedAt,
    Instant slaDueAt
) {}
```

Query:

```java
List<CaseListItem> rows = entityManager.createQuery("""
    select new com.example.CaseListItem(
        c.id,
        c.caseNo,
        a.name,
        c.status,
        c.submittedAt,
        c.slaDueAt
    )
    from CaseEntity c
    join c.applicant a
    where c.status = :status
    order by c.submittedAt desc
    """, CaseListItem.class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .setFirstResult(offset)
    .setMaxResults(limit)
    .getResultList();
```

Kelebihan:

- hanya select kolom yang perlu,
- tidak masuk persistence context sebagai managed graph,
- tidak dirty checked,
- aman untuk response API,
- pagination lebih jelas,
- menghindari accidental lazy loading,
- cocok untuk read-heavy system.

---

### 10.2 Projection bukan pengganti entity untuk command

Untuk command/update:

```text
Approve Case
Reject Case
Assign Officer
Escalate Case
```

Biasanya perlu entity managed karena:

- invariant state transition,
- optimistic lock,
- dirty checking,
- domain method,
- audit hook,
- transaction consistency.

Contoh:

```java
@Transactional
public void approveCase(Long caseId, long expectedVersion, UserId actor) {
    CaseEntity c = caseRepository.findForTransition(caseId)
        .orElseThrow();

    c.assertVersion(expectedVersion);
    c.approve(actor, clock.instant());
    auditTrail.recordApproval(c, actor);
}
```

Read projection dan command entity punya kebutuhan berbeda.

---

### 10.3 Projection di Spring Data JPA

Interface projection:

```java
public interface CaseListProjection {
    Long getId();
    String getCaseNo();
    String getApplicantName();
    String getStatus();
}
```

Query:

```java
@Query("""
    select c.id as id,
           c.caseNo as caseNo,
           a.name as applicantName,
           c.status as status
    from CaseEntity c
    join c.applicant a
    where c.status = :status
    """)
List<CaseListProjection> findCaseList(@Param("status") CaseStatus status);
```

DTO projection:

```java
@Query("""
    select new com.example.CaseListItem(c.id, c.caseNo, a.name, c.status)
    from CaseEntity c
    join c.applicant a
    where c.status = :status
    """)
List<CaseListItem> findCaseList(@Param("status") CaseStatus status);
```

---

## 11. Open Session in View / Open EntityManager in View

### 11.1 Konsep

Open Session in View atau Open EntityManager in View membuka persistence context sepanjang request web, sehingga lazy loading masih bisa terjadi saat view rendering/serialization.

Alur:

```text
HTTP request
  -> controller
  -> service transaction
  -> repository
  -> transaction selesai
  -> JSON serialization masih bisa lazy load
HTTP response
```

Ini nyaman karena mengurangi `LazyInitializationException`.

---

### 11.2 Kenapa berbahaya

Masalah:

1. Query bisa terjadi di layer presentation.
2. Jumlah query tergantung serialization.
3. N+1 bisa muncul saat JSON rendering.
4. Transaction mungkin sudah selesai, sehingga consistency snapshot membingungkan.
5. Controller/view tidak eksplisit menentukan data yang dibutuhkan.
6. Performance bug tersembunyi.
7. Entity bocor ke API.

Contoh buruk:

```java
@GetMapping("/cases/{id}")
public CaseEntity get(@PathVariable Long id) {
    return caseService.getCase(id);
}
```

Serializer bisa menelusuri:

```text
case.applicant.address.country
case.documents.uploadedBy.department
case.auditTrails.actor.roles
```

Ini berbahaya.

---

### 11.3 Kapan masih acceptable

Dalam sistem sederhana, admin internal kecil, atau monolith lama, OSIV kadang dipakai pragmatis.

Tetapi untuk sistem besar, regulated, performance-sensitive, atau API-heavy, sebaiknya:

```text
Disable OSIV.
Service/repository harus eksplisit memuat data.
Return DTO/projection.
```

---

## 12. LazyInitializationException sebagai Signal Desain

`LazyInitializationException` sering diperlakukan sebagai error teknis.

Tetapi secara desain, ia memberi sinyal:

```text
Ada code yang mencoba membaca association di luar persistence context yang mendukungnya.
```

Solusi buruk:

```java
fetch = FetchType.EAGER
```

Solusi buruk lain:

```java
@Transactional di controller semua
```

Solusi lebih benar:

1. Tentukan response/use case butuh data apa.
2. Buat repository query/fetch plan eksplisit.
3. Mapping ke DTO dalam transaction read-only.
4. Jangan return entity ke boundary luar.

Contoh:

```java
@Transactional(readOnly = true)
public CaseDetailResponse getDetail(Long id) {
    CaseEntity c = caseRepository.findDetailHeader(id)
        .orElseThrow(() -> new NotFoundException("Case not found"));

    List<DocumentItem> docs = documentRepository.findItemsByCaseId(id);

    return CaseDetailResponse.from(c, docs);
}
```

---

## 13. Fetching dan Transaction Boundary

### 13.1 Fetching harus selesai sebelum keluar transaction

Jika response membutuhkan applicant name, maka applicant harus:

- difetch join,
- ada di entity graph,
- diproject langsung,
- atau diquery terpisah,

sebelum transaction/persistence context selesai.

```java
@Transactional(readOnly = true)
public CaseDetailResponse getCaseDetail(Long id) {
    CaseEntity c = caseRepository.findWithApplicantAndOfficer(id).orElseThrow();
    return mapper.toDetail(c);
}
```

---

### 13.2 Jangan memperpanjang transaction demi lazy loading

Kesalahan:

```text
Lazy error muncul -> perpanjang transaction sampai view
```

Ini menyelesaikan symptom, bukan cause.

Risiko:

- lock lebih lama,
- connection ditahan lebih lama,
- DB resource lebih lama,
- throughput turun,
- timeout meningkat.

Rule:

```text
Transaction duration harus mengikuti consistency need, bukan kenyamanan lazy loading.
```

---

## 14. Fetching dan Pagination

### 14.1 Offset pagination dengan projection

Untuk listing umum:

```java
select new com.example.CaseListItem(...)
from CaseEntity c
join c.applicant a
where c.status = :status
order by c.submittedAt desc, c.id desc
```

Dengan:

```java
setFirstResult(offset)
setMaxResults(limit)
```

Ini acceptable untuk banyak kasus, tetapi offset besar bisa lambat.

---

### 14.2 Keyset pagination

Untuk dataset besar:

```sql
where (submitted_at, id) < (?, ?)
order by submitted_at desc, id desc
limit 50
```

JPQL konseptual:

```java
select new com.example.CaseListItem(...)
from CaseEntity c
join c.applicant a
where c.status = :status
  and (
      c.submittedAt < :lastSubmittedAt
      or (c.submittedAt = :lastSubmittedAt and c.id < :lastId)
  )
order by c.submittedAt desc, c.id desc
```

Keuntungan:

- tidak scan/skip offset besar,
- lebih stabil untuk infinite scroll,
- cocok untuk audit trail/timeline.

---

### 14.3 Pagination + collection fetch join anti-pattern

Jangan:

```java
@Query("""
    select c
    from CaseEntity c
    left join fetch c.documents
    where c.status = :status
    order by c.submittedAt desc
    """)
Page<CaseEntity> findPageWithDocuments(CaseStatus status, Pageable pageable);
```

Lebih baik:

1. Query page case header projection.
2. Query documents untuk case ids di page.
3. Gabungkan di application layer.

Contoh:

```java
List<CaseListItem> cases = caseQuery.findPage(...);
List<Long> caseIds = cases.stream().map(CaseListItem::id).toList();
List<DocumentSummary> documents = documentQuery.findSummariesByCaseIds(caseIds);
```

---

## 15. Fetching dan JSON Serialization

### 15.1 Entity sebagai response API adalah sumber masalah

Jika entity langsung dijadikan JSON:

```java
return caseEntity;
```

Masalah:

- lazy loading saat serialization,
- infinite recursion bidirectional association,
- data sensitive bocor,
- response berubah ketika mapping berubah,
- over-fetching,
- N+1,
- circular graph,
- stack overflow,
- security issue.

Annotation seperti:

```java
@JsonIgnore
@JsonManagedReference
@JsonBackReference
```

bisa membantu symptom, tetapi bukan desain utama.

Lebih benar:

```java
public record CaseDetailResponse(
    Long id,
    String caseNo,
    String applicantName,
    String status,
    List<DocumentItem> documents
) {}
```

---

### 15.2 DTO sebagai contract API

DTO membuat boundary eksplisit:

```text
Entity graph internal != API response contract
```

Keuntungan:

- data yang keluar eksplisit,
- security lebih terkontrol,
- lazy loading selesai di service,
- versioning API lebih mudah,
- persistence model bebas berevolusi.

---

## 16. Fetching dan Cache

### 16.1 First-level cache

Persistence context adalah first-level cache.

Jika entity yang sama dimuat dua kali dalam persistence context yang sama:

```java
ApplicantEntity a1 = entityManager.find(ApplicantEntity.class, 1L);
ApplicantEntity a2 = entityManager.find(ApplicantEntity.class, 1L);
```

Maka `a1 == a2` biasanya true.

Ini bisa mengurangi query duplikat dalam satu transaction, tetapi tidak menyelesaikan N+1 untuk association berbeda yang belum dimuat.

---

### 16.2 Second-level cache

Second-level cache bisa mengurangi query antar transaction untuk entity/collection tertentu.

Tetapi jangan gunakan cache untuk menutupi fetch plan buruk.

Jika query melakukan N+1 sebanyak 1000 query, cache mungkin membuatnya lebih cepat saat warm, tetapi:

- cold cache tetap buruk,
- invalidation kompleks,
- consistency risk,
- memory pressure,
- cache stampede,
- hidden dependency.

Rule:

```text
Perbaiki query shape dulu, baru pertimbangkan cache.
```

---

## 17. Fetching dan Database Index

Fetch plan memengaruhi query shape. Query shape menentukan index need.

Contoh:

```java
select c
from CaseEntity c
join fetch c.applicant
where c.status = :status
order by c.submittedAt desc
```

Index mungkin perlu:

```sql
create index idx_case_status_submitted_id
on case_file(status, submitted_at desc, id desc);
```

Untuk foreign key join:

```sql
create index idx_case_applicant_id
on case_file(applicant_id);
```

Untuk child collection:

```sql
create index idx_document_case_id_created_at
on document(case_id, created_at desc);
```

Tanpa index, fetch plan yang tampak benar di Java bisa menyebabkan full scan, nested loop mahal, lock wait, atau DB CPU spike.

---

## 18. Fetch Strategy by Use Case

### 18.1 Case listing

Kebutuhan:

- case number,
- applicant name,
- status,
- submitted date,
- SLA due,
- assigned officer.

Rekomendasi:

```text
DTO projection, not entity.
```

Contoh:

```java
select new com.example.CaseListItem(
    c.id,
    c.caseNo,
    a.name,
    c.status,
    o.displayName,
    c.submittedAt,
    c.slaDueAt
)
from CaseEntity c
join c.applicant a
left join c.assignedOfficer o
where c.status = :status
order by c.submittedAt desc, c.id desc
```

---

### 18.2 Case detail header

Kebutuhan:

- case core,
- applicant,
- assigned officer,
- status,
- maybe latest submission.

Rekomendasi:

```text
Entity with join fetch/entity graph for to-one association, plus separate projections for collections.
```

---

### 18.3 Case documents tab

Kebutuhan:

- documents page,
- metadata,
- uploaded by,
- file size,
- document type,
- created time.

Rekomendasi:

```text
Separate paginated DTO query by case id.
```

Jangan load `case.documents` kalau dokumen banyak.

---

### 18.4 Audit trail tab

Kebutuhan:

- chronological audit entries,
- actor,
- action,
- timestamp,
- before/after summary,
- maybe metadata CLOB.

Rekomendasi:

```text
Keyset pagination / projection / separate query. Jangan entity graph dari case ke auditTrails.
```

Audit trail bisa sangat besar. Treat as timeline/read model, bukan child collection biasa.

---

### 18.5 Approval transition

Kebutuhan:

- managed case entity,
- version,
- current status,
- required guards,
- maybe assigned officer/current user.

Rekomendasi:

```text
Entity query minimal, with optimistic/pessimistic lock if needed.
```

Tidak perlu fetch documents/audit trail kecuali guard membutuhkan.

---

### 18.6 Export evidence bundle

Kebutuhan:

- case core,
- applicant,
- submissions,
- documents metadata,
- audit trails,
- correspondences.

Rekomendasi:

```text
Multiple explicit queries, streaming/chunking for large collections, not one giant fetch join.
```

---

## 19. Anti-Pattern Fetching

### 19.1 Semua association eager

```java
@OneToMany(fetch = FetchType.EAGER)
private List<AuditTrailEntity> auditTrails;
```

Dampak:

- listing lambat,
- detail page berat,
- memory spike,
- serialization meledak,
- query tidak predictable.

---

### 19.2 Return entity langsung ke API

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable Long id) { ... }
```

Dampak:

- entity leak,
- lazy loading di serializer,
- data sensitive bocor,
- circular references.

---

### 19.3 Join fetch semua hal

```java
select c
from CaseEntity c
left join fetch c.documents
left join fetch c.tasks
left join fetch c.auditTrails
left join fetch c.correspondences
where c.id = :id
```

Dampak:

- cartesian product,
- duplicate data transfer,
- high memory,
- slow hydration,
- timeout.

---

### 19.4 Pagination dengan collection fetch join

```java
Page<CaseEntity> findAllWithDocuments(Pageable pageable);
```

Dampak:

- pagination incorrect/in-memory,
- result inconsistent,
- heavy query.

---

### 19.5 Memakai `@BatchSize` untuk menutupi read model yang salah

`@BatchSize` membantu, tetapi jika use case adalah listing projection, jangan load entity graph hanya karena batch fetching tersedia.

---

### 19.6 Mengandalkan OSIV

OSIV membuat bug performa muncul di presentation layer.

---

### 19.7 Entity graph raksasa

```java
@NamedEntityGraph(
    name = "Case.everything",
    attributeNodes = {
        @NamedAttributeNode("applicant"),
        @NamedAttributeNode("documents"),
        @NamedAttributeNode("tasks"),
        @NamedAttributeNode("auditTrails"),
        @NamedAttributeNode("correspondences")
    }
)
```

Ini sama buruknya dengan eager graph raksasa.

---

## 20. Failure Modes Produksi

### 20.1 N+1 hanya muncul di UAT/Production

Di local:

```text
10 cases -> 11 queries, masih cepat
```

Di production:

```text
5,000 cases -> 5,001 queries, timeout
```

Mitigasi:

- SQL count test,
- integration test dengan dataset realistis,
- Hibernate statistics,
- datasource proxy,
- slow query dashboard,
- query fingerprint.

---

### 20.2 Connection pool exhaustion akibat query kecil banyak

N+1 tidak hanya satu request lambat. Banyak request paralel bisa membuat connection pool habis.

Gejala:

- request 504,
- connection acquisition timeout,
- DB CPU naik,
- thread blocked waiting connection,
- API latency naik serentak.

---

### 20.3 Memory spike akibat row explosion

Fetch join banyak collection bisa membuat result set sangat besar.

Gejala:

- heap naik,
- GC sering,
- response lambat,
- OOM,
- DB network throughput naik,
- application CPU tinggi karena hydration.

---

### 20.4 Lazy loading setelah transaction selesai

Gejala:

```text
LazyInitializationException: could not initialize proxy - no Session
```

Root cause:

- entity keluar service boundary,
- DTO mapping terjadi terlambat,
- transaction scope salah,
- repository query tidak memuat data yang diperlukan.

---

### 20.5 Inconsistent response akibat OSIV

Jika lazy loading terjadi setelah service transaction selesai, data yang dimuat belakangan bisa berasal dari snapshot berbeda tergantung isolation dan database behavior.

Untuk regulatory system, ini bisa menyulitkan audit/debugging.

---

### 20.6 Count query berat pada pagination

Spring Data `Page` biasanya butuh count query.

Untuk query kompleks, count bisa lebih mahal daripada data query.

Alternatif:

- `Slice`,
- keyset pagination,
- approximate count,
- materialized read model,
- async report.

---

## 21. Observability Fetching

### 21.1 Apa yang harus dilihat

Minimal observability:

1. SQL statement count per request/use case.
2. Query latency.
3. Rows returned.
4. Slow query log.
5. Connection pool usage.
6. Hibernate entity load count.
7. Hibernate collection fetch count.
8. Hibernate query execution count.
9. Transaction duration.
10. Endpoint latency correlation.

---

### 21.2 Hibernate statistics

Hibernate menyediakan statistics yang bisa membantu melihat:

- entity load count,
- entity fetch count,
- collection load count,
- collection fetch count,
- query execution count,
- second-level cache hit/miss,
- flush count.

Konfigurasi perlu hati-hati di production karena overhead dan volume metric.

---

### 21.3 SQL logging

SQL logging full di production biasanya berbahaya.

Gunakan:

- sampling,
- slow query log,
- datasource proxy di non-prod,
- SQL comments dengan use case name,
- APM trace,
- query fingerprint.

Contoh SQL comment Hibernate:

```java
query.setHint("org.hibernate.comment", "CaseListQuery.findSubmitted");
```

Atau provider-specific setting untuk comments.

---

## 22. Review Checklist Fetch Strategy

Untuk setiap repository/query, tanyakan:

1. Use case apa yang dilayani?
2. Apakah query ini command/update atau read-only?
3. Apakah benar perlu entity managed?
4. Apakah projection lebih tepat?
5. Association apa yang pasti dibutuhkan?
6. Association mana yang high-cardinality?
7. Apakah ada to-many fetch join?
8. Apakah query dipaginate?
9. Apakah ada count query?
10. Apakah query bisa menghasilkan N+1?
11. Apakah entity keluar service boundary?
12. Apakah JSON serializer bisa memicu lazy loading?
13. Apakah index mendukung filter/order/join?
14. Apakah result size bounded?
15. Apakah sudah dites dengan dataset realistis?
16. Apakah ada metric query count/latency?
17. Apakah query plan sudah dicek untuk hot path?
18. Apakah transaction duration reasonable?
19. Apakah OSIV aktif?
20. Apakah fetch plan terdokumentasi dalam nama repository method?

---

## 23. Design Pattern Fetching untuk Aplikasi Besar

### 23.1 Pisahkan command repository dan query repository

Command repository:

```java
public interface CaseCommandRepository {
    Optional<CaseEntity> findForTransition(Long id);
    void save(CaseEntity caseEntity);
}
```

Query repository:

```java
public interface CaseQueryRepository {
    Page<CaseListItem> findCaseList(CaseSearchCriteria criteria, Pageable pageable);
    CaseDetailView findCaseDetail(Long id);
    List<DocumentItem> findDocuments(Long caseId, PageRequest page);
    List<AuditTrailItem> findAuditTrail(AuditTrailCriteria criteria, Cursor cursor);
}
```

Keuntungan:

- command path menjaga invariant,
- query path optimal untuk read,
- fetch strategy tidak dipaksa satu model,
- lebih mudah tune hot path.

---

### 23.2 Repository method name harus mengandung fetch intention

Kurang jelas:

```java
findById(Long id)
```

Lebih jelas:

```java
findHeaderById(Long id)
findDetailHeaderById(Long id)
findForTransitionById(Long id)
findWithApplicantAndOfficerById(Long id)
findAuditTimelineByCaseId(Long id, Cursor cursor)
```

Nama bukan hanya estetika. Nama membantu reviewer mengetahui fetch expectation.

---

### 23.3 Bounded graph

Untuk detail page, jangan “load everything”.

Gunakan bounded graph:

```text
Case detail header:
- case core
- applicant summary
- assigned officer summary
- status

Documents tab:
- document page

Audit tab:
- audit page

Correspondence tab:
- correspondence page
```

UI tab/section sering sebaiknya menjadi query boundary.

---

### 23.4 Explicit read model untuk high-cardinality relation

Jangan:

```java
case.getAuditTrails()
```

Lebih baik:

```java
AuditTrailPage page = auditTrailQuery.findByCaseId(caseId, cursor, limit);
```

---

## 24. Example End-to-End

### 24.1 Entity mapping

```java
@Entity
@Table(name = "case_file")
@NamedEntityGraph(
    name = "Case.detailHeader",
    attributeNodes = {
        @NamedAttributeNode("applicant"),
        @NamedAttributeNode("assignedOfficer"),
        @NamedAttributeNode("status")
    }
)
public class CaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_seq")
    private Long id;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "case_no", nullable = false, unique = true, length = 40)
    private String caseNo;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "applicant_id", nullable = false)
    private ApplicantEntity applicant;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assigned_officer_id")
    private OfficerEntity assignedOfficer;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "status_id", nullable = false)
    private CaseStatusEntity status;

    @OneToMany(mappedBy = "caseEntity", fetch = FetchType.LAZY)
    private List<DocumentEntity> documents = new ArrayList<>();

    @OneToMany(mappedBy = "caseEntity", fetch = FetchType.LAZY)
    private List<AuditTrailEntity> auditTrails = new ArrayList<>();
}
```

---

### 24.2 Detail header query dengan entity graph

```java
@Transactional(readOnly = true)
public CaseDetailHeader getDetailHeader(Long id) {
    EntityGraph<?> graph = entityManager.getEntityGraph("Case.detailHeader");

    CaseEntity c = entityManager.find(
        CaseEntity.class,
        id,
        Map.of("jakarta.persistence.fetchgraph", graph)
    );

    if (c == null) {
        throw new NotFoundException("Case not found");
    }

    return new CaseDetailHeader(
        c.getId(),
        c.getCaseNo(),
        c.getApplicant().getName(),
        c.getAssignedOfficer() == null ? null : c.getAssignedOfficer().getDisplayName(),
        c.getStatus().getCode(),
        c.getVersion()
    );
}
```

---

### 24.3 Listing query dengan projection

```java
@Transactional(readOnly = true)
public List<CaseListItem> findSubmittedCases(int limit, Instant beforeSubmittedAt, Long beforeId) {
    return entityManager.createQuery("""
        select new com.example.caseapp.CaseListItem(
            c.id,
            c.caseNo,
            a.name,
            s.code,
            o.displayName,
            c.submittedAt,
            c.slaDueAt
        )
        from CaseEntity c
        join c.applicant a
        join c.status s
        left join c.assignedOfficer o
        where s.code = :status
          and (
              :beforeSubmittedAt is null
              or c.submittedAt < :beforeSubmittedAt
              or (c.submittedAt = :beforeSubmittedAt and c.id < :beforeId)
          )
        order by c.submittedAt desc, c.id desc
        """, CaseListItem.class)
        .setParameter("status", "SUBMITTED")
        .setParameter("beforeSubmittedAt", beforeSubmittedAt)
        .setParameter("beforeId", beforeId)
        .setMaxResults(limit)
        .getResultList();
}
```

---

### 24.4 Documents tab query

```java
@Transactional(readOnly = true)
public List<DocumentItem> findDocumentItems(Long caseId, int offset, int limit) {
    return entityManager.createQuery("""
        select new com.example.caseapp.DocumentItem(
            d.id,
            d.documentNo,
            d.fileName,
            d.contentType,
            d.fileSize,
            u.displayName,
            d.createdAt
        )
        from DocumentEntity d
        join d.uploadedBy u
        where d.caseEntity.id = :caseId
        order by d.createdAt desc, d.id desc
        """, DocumentItem.class)
        .setParameter("caseId", caseId)
        .setFirstResult(offset)
        .setMaxResults(limit)
        .getResultList();
}
```

---

### 24.5 Transition query

```java
@Transactional
public void assignOfficer(Long caseId, Long officerId, long expectedVersion, UserId actor) {
    CaseEntity c = entityManager.createQuery("""
        select c
        from CaseEntity c
        join fetch c.status
        where c.id = :id
        """, CaseEntity.class)
        .setParameter("id", caseId)
        .getSingleResult();

    if (c.getVersion() != expectedVersion) {
        throw new ConflictException("Case was modified by another transaction");
    }

    OfficerEntity officerRef = entityManager.getReference(OfficerEntity.class, officerId);
    c.assignOfficer(officerRef, actor, clock.instant());
}
```

Perhatikan bahwa transition tidak fetch documents/audit trails karena tidak dibutuhkan untuk invariant tersebut.

---

## 25. Testing Fetch Strategy

### 25.1 Test query count untuk N+1

Di integration test, gunakan datasource proxy atau Hibernate statistics.

Pseudo:

```java
@Test
void caseListShouldNotHaveNPlusOne() {
    // given dataset: 50 cases, each has applicant and officer

    statistics.clear();

    List<CaseListItem> result = caseQuery.findSubmittedCases(...);

    assertThat(result).hasSize(50);
    assertThat(statistics.getQueryExecutionCount()).isLessThanOrEqualTo(2);
}
```

Tujuan bukan angka absolut di semua provider, tetapi mencegah query count tumbuh linear terhadap jumlah row.

---

### 25.2 Test LazyInitialization boundary

```java
@Test
void serviceShouldReturnDtoNotEntityWithLazyProxy() {
    CaseDetailResponse response = caseService.getDetail(caseId);

    assertThat(response.applicantName()).isNotBlank();
}
```

Lebih penting: arsitektur mencegah entity keluar API boundary.

---

### 25.3 Dataset realistis

Jangan hanya test:

```text
1 case, 1 document, 1 audit trail
```

Test minimal:

```text
50 cases
50 applicants
10 documents per case
100 audit trails per case
several officers
several statuses
```

Dengan dataset kecil, N+1 sering tidak terasa.

---

## 26. Decision Matrix

### 26.1 Untuk to-one association

| Use case | Recommended |
|---|---|
| Detail page butuh applicant/officer/status | join fetch/entity graph |
| Listing butuh beberapa kolom association | DTO projection |
| Command butuh status guard | join fetch status only |
| Association jarang diakses | lazy + batch fetch optional |

---

### 26.2 Untuk to-many collection

| Use case | Recommended |
|---|---|
| Single parent, small collection | fetch join possible |
| Parent page + collection count | projection with aggregate/count |
| Parent page + child summary | two-step query |
| Large audit trail | separate paginated query/keyset |
| Export large data | streaming/chunked queries |
| Multiple collections | separate queries, not multiple fetch join |

---

### 26.3 Untuk API response

| Need | Recommended |
|---|---|
| Stable response contract | DTO |
| High-performance listing | projection |
| Internal command mutation | managed entity |
| Large nested data | sectioned API / separate endpoints |
| Audit timeline | cursor/keyset projection |

---

## 27. Performance Reasoning Formula

Saat melihat query, hitung kasar:

```text
Cost ≈ round trips + rows returned + columns returned + hydration cost + dirty checking cost + lock duration + memory retention
```

Contoh A:

```text
1 query root + 100 lazy applicant query
```

- Round trip tinggi.
- Rows kecil per query.
- Total latency buruk.

Contoh B:

```text
1 giant join case x documents x audit
```

- Round trip rendah.
- Rows sangat besar.
- Memory/hydration buruk.

Contoh C:

```text
1 projection query untuk listing
```

- Round trip rendah.
- Rows bounded.
- Columns minimal.
- Hydration ringan.

Biasanya C paling baik untuk listing.

---

## 28. Advanced Notes Java 8–25

### 28.1 Java 8

- DTO projection biasanya class biasa.
- `javax.persistence` umum.
- Hibernate 5 umum.
- Java Time sudah tersedia sejak Java 8, tetapi provider support tergantung versi.

### 28.2 Java 11/17

- Migration ke Jakarta mulai relevan.
- Spring Boot 3 baseline Java 17 dan memakai `jakarta.*`.
- Hibernate 6 umum.

### 28.3 Java 21/25

- Record cocok untuk immutable projection.
- Pattern matching membantu mapping logic tetapi jangan overdo di persistence layer.
- Virtual threads tidak menghapus biaya query/DB bottleneck.
- Fetch strategy tetap penting walau thread lebih murah.

Contoh record projection:

```java
public record CaseListItem(
    Long id,
    String caseNo,
    String applicantName,
    String status
) {}
```

---

## 29. Latihan Scenario

### Scenario 1 — N+1 di case listing

Ada endpoint:

```text
GET /cases?status=SUBMITTED
```

Implementation:

```java
List<CaseEntity> cases = caseRepository.findByStatus(SUBMITTED);
return cases.stream()
    .map(c -> new CaseListItem(
        c.getId(),
        c.getCaseNo(),
        c.getApplicant().getName(),
        c.getAssignedOfficer().getDisplayName()
    ))
    .toList();
```

Dataset:

```text
500 cases
500 applicants
300 officers
```

Pertanyaan:

1. Di mana N+1 muncul?
2. Apakah join fetch solusi terbaik?
3. Bagaimana projection query yang lebih tepat?
4. Index apa yang dibutuhkan?
5. Bagaimana test query count-nya?

Jawaban arah:

- N+1 pada applicant/officer jika lazy dan tidak difetch.
- Untuk listing, projection lebih baik daripada entity.
- Query join applicant/officer select kolom yang diperlukan.
- Index pada status/order column dan FK.
- Test memastikan query count tidak linear terhadap jumlah cases.

---

### Scenario 2 — Detail page lambat setelah tambah audit trail

Sebelumnya detail page fetch:

```java
select c
from CaseEntity c
left join fetch c.documents
where c.id = :id
```

Lalu developer menambah:

```java
left join fetch c.auditTrails
```

Setelah production, endpoint timeout.

Pertanyaan:

1. Apa root cause?
2. Kenapa `distinct` tidak cukup?
3. Desain query ulang seperti apa?
4. Bagaimana UI/API boundary sebaiknya dibuat?

Jawaban arah:

- Row explosion documents x auditTrails.
- `distinct` tidak menghapus biaya transfer row besar.
- Header, documents, audit trail dipisah.
- Audit trail dipaginate/keyset.

---

### Scenario 3 — LazyInitializationException di response

Service:

```java
@Transactional(readOnly = true)
public CaseEntity getCase(Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Controller return entity.

Pertanyaan:

1. Kenapa error muncul?
2. Kenapa mengganti semua association menjadi eager bukan solusi?
3. Bagaimana perbaikannya?

Jawaban arah:

- Entity keluar transaction, lazy association diakses serializer.
- Eager menyebabkan over-fetching dan hidden graph.
- Return DTO dan fetch data eksplisit di service.

---

## 30. Ringkasan

Fetching adalah salah satu skill paling menentukan dalam penggunaan JPA/Hibernate secara profesional.

Prinsip utama:

1. Fetch plan harus mengikuti use case.
2. Mapping association sebaiknya default `LAZY`, terutama di sistem besar.
3. `EAGER` bukan solusi performa; sering justru sumber over-fetching.
4. N+1 adalah failure mode query count linear terhadap jumlah row.
5. `JOIN FETCH` bagus untuk to-one dan collection kecil terkontrol, tetapi berbahaya untuk banyak collection dan pagination.
6. `EntityGraph` membantu membuat fetch plan deklaratif, tetapi tidak menghapus kebutuhan memahami query shape.
7. Batch fetching dan subselect fetching adalah optimasi, bukan pengganti desain query.
8. Projection adalah pilihan terbaik untuk banyak read use case seperti listing, search, dashboard, dan report.
9. Jangan return entity langsung ke API boundary.
10. OSIV menyembunyikan masalah desain dan bisa memunculkan query di presentation layer.
11. Fetching harus diamati dengan SQL logs, statistics, query count test, slow query logs, dan metric production.
12. High-cardinality relation seperti audit trail harus diperlakukan sebagai read model/paginated timeline, bukan collection yang difetch dari root entity.

Mental model final:

```text
Entity mapping mendefinisikan kemungkinan navigasi object graph.
Fetch plan mendefinisikan data yang dibawa untuk use case tertentu.
Read projection mendefinisikan response/query shape yang presisi.
Transaction boundary mendefinisikan kapan loading harus selesai.
Database index/query plan menentukan apakah fetch plan benar-benar scalable.
```

---

## 31. Referensi Resmi dan Bacaan Lanjutan

- Jakarta Persistence 3.2 Specification — entity, relationship, fetch, entity graph, query, persistence context.
- Jakarta Persistence API Documentation — `EntityManager`, `EntityGraph`, `NamedEntityGraph`, `FetchType`, association annotations.
- Jakarta EE Tutorial — Creating Fetch Plans with Entity Graphs.
- Hibernate ORM User Guide 6.x/7.x — fetching strategies, dynamic fetching, entity graphs, batch fetching, subselect fetching, HQL fetch join, multiple bag fetch behavior, statistics.
- Spring Data JPA Documentation — `@EntityGraph`, projections, repository query methods, pagination behavior.

---

## 32. Status Seri

Seri belum selesai.

Bagian ini adalah:

```text
Part 007 / 032 — Fetching Strategy: Lazy, Eager, N+1, Entity Graph, Fetch Join
```

Bagian berikutnya:

```text
Part 008 — Query Model: JPQL, HQL, Criteria, Native SQL, QuerySpecification
```

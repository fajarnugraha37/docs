# Part 31 — Persistence Mapping Pitfalls: JPA Entities, Lazy Loading, Proxies, Cycles

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> Level: Advanced / Staff+ Engineering  
> Scope Java: Java 8 sampai Java 25  
> Fokus: bagaimana mapping layer berinteraksi dengan JPA/Hibernate persistence model tanpa menyebabkan data leak, N+1 query, lazy loading exception, object cycle, accidental update, audit corruption, atau kontrak API yang rapuh.

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas mapping dari sisi object model, DTO, Jackson, MapStruct, Lombok, validation, diagnostics, testing, dan performance. Sekarang kita masuk ke area yang sering menjadi sumber bug production paling mahal: **mapping yang menyentuh persistence layer**.

Pada aplikasi enterprise Java, object yang terlihat seperti object biasa sering sebenarnya bukan object biasa:

- entity JPA berada dalam persistence context;
- association bisa lazy;
- field bisa proxy;
- collection bisa persistent collection;
- getter bisa memicu query;
- equality bisa dipengaruhi identifier database;
- setter bisa mengubah dirty state;
- serialization bisa membuka seluruh graph;
- mapper bisa memicu ratusan query tanpa terlihat di code mapper.

Mental model utama bagian ini:

> Entity adalah persistence object, bukan transport object. Mapper yang memperlakukan entity sebagai DTO akan mencampur database lifecycle dengan API lifecycle.

Target pemahaman setelah bagian ini:

1. Memahami kenapa entity tidak boleh langsung diekspos sebagai JSON response.
2. Memahami bagaimana lazy loading, proxy, persistent collection, dan bidirectional relationship memengaruhi mapper.
3. Bisa mendesain fetch plan sebelum mapping, bukan membiarkan mapper menentukan query secara tidak sengaja.
4. Bisa membedakan entity mapping, DTO projection, command mapping, dan update mapping.
5. Bisa menghindari `LazyInitializationException`, N+1 query, recursive serialization, accidental overwrite, dan detached entity merge bug.
6. Bisa membuat checklist review mapping untuk persistence-heavy system.

---

## 2. Problem Dasar: Entity Bukan DTO

Secara visual, entity sering tampak seperti class Java biasa:

```java
@Entity
@Table(name = "cases")
public class CaseEntity {

    @Id
    private Long id;

    private String caseNo;

    private String status;

    @ManyToOne(fetch = FetchType.LAZY)
    private OfficerEntity assignedOfficer;

    @OneToMany(mappedBy = "caseEntity", fetch = FetchType.LAZY)
    private List<CaseDocumentEntity> documents = new ArrayList<>();

    // getters/setters
}
```

Lalu terlihat menggoda untuk langsung return dari controller:

```java
@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Ini salah secara arsitektural, walaupun sering “berhasil” di development.

Masalahnya:

1. API shape ikut struktur database.
2. Field internal mudah bocor.
3. Lazy association bisa gagal saat serialization.
4. Jackson bisa memicu query tak terkontrol.
5. Bidirectional relationship bisa recursive.
6. Perubahan schema database menjadi breaking API change.
7. API consumer bisa melihat field yang tidak seharusnya.
8. Entity lifecycle tercampur dengan HTTP lifecycle.
9. Security boundary menjadi kabur.
10. Audit/version/internal metadata bisa keluar.

Entity punya tujuan: mewakili state persistent dan aturan ORM. DTO punya tujuan: mewakili kontrak boundary.

Keduanya boleh mirip secara field, tetapi **tidak sama secara semantik**.

---

## 3. Mental Model: Persistence Mapping adalah 3-Layer Problem

Saat membaca data dari database untuk API response, sebenarnya ada tiga keputusan berbeda:

```text
Database rows
   ↓
Fetch plan / query shape
   ↓
Entity/projection shape
   ↓
DTO/API shape
```

Banyak engineer langsung berpikir dari entity ke DTO:

```text
Entity → DTO
```

Padahal keputusan paling penting ada sebelumnya:

```text
Query/fetch plan → Loaded graph → Mapping output
```

Mapper tidak boleh diam-diam menjadi pengendali fetch plan. Kalau mapper mengakses `entity.getDocuments()` dan itu memicu query, maka mapping layer sudah mengambil keputusan persistence tanpa eksplisit.

Rule:

> Fetch what you intend to map. Map only what you fetched intentionally.

---

## 4. Persistence Context: Object yang Hidup di Unit of Work

JPA/Hibernate bekerja dengan persistence context, yaitu unit of work yang melacak entity managed.

Siklus sederhana:

```text
Query / find
   ↓
Managed entity in persistence context
   ↓
Change fields
   ↓
Dirty checking
   ↓
Flush SQL update
```

Contoh:

```java
@Transactional
public void updateTitle(Long id, String newTitle) {
    CaseEntity entity = caseRepository.findById(id).orElseThrow();
    entity.setTitle(newTitle);
    // no explicit save needed in many JPA setups
    // flush may issue SQL update
}
```

Mapping menjadi berbahaya saat mapper memodifikasi managed entity tanpa sadar.

Contoh buruk:

```java
@Transactional
public CaseResponse getCase(Long id) {
    CaseEntity entity = caseRepository.findById(id).orElseThrow();

    normalizeBeforeResponse(entity); // mutates entity

    return mapper.toResponse(entity);
}
```

Jika `normalizeBeforeResponse` mengubah field managed entity, perubahan itu bisa dianggap update database.

Lebih aman:

```java
@Transactional(readOnly = true)
public CaseResponse getCase(Long id) {
    CaseEntity entity = caseRepository.findById(id).orElseThrow();
    return mapper.toResponse(entity);
}
```

Dan normalization response dilakukan di DTO, bukan entity:

```java
public CaseResponse toResponse(CaseEntity entity) {
    return new CaseResponse(
        entity.getId(),
        normalizeDisplayTitle(entity.getTitle()),
        entity.getStatus()
    );
}
```

Prinsip:

> Jangan mutate entity saat melakukan read-side mapping kecuali memang sedang menjalankan command/update use case.

---

## 5. Lazy Loading: Getter Bisa Menjadi Query

Lazy loading membuat association tidak langsung diambil saat entity utama diambil.

Contoh:

```java
@ManyToOne(fetch = FetchType.LAZY)
private OfficerEntity assignedOfficer;

@OneToMany(mappedBy = "caseEntity", fetch = FetchType.LAZY)
private List<CaseDocumentEntity> documents;
```

Saat code ini dijalankan:

```java
CaseEntity entity = caseRepository.findById(id).orElseThrow();
String officerName = entity.getAssignedOfficer().getName();
```

`getAssignedOfficer()` atau `getName()` bisa memicu SQL tambahan.

Saat mapping collection:

```java
List<DocumentResponse> docs = entity.getDocuments()
    .stream()
    .map(documentMapper::toResponse)
    .toList();
```

`getDocuments()` bisa memicu query tambahan.

Masalah bukan lazy loading itu sendiri. Masalahnya adalah **lazy loading yang tidak terlihat**.

Mapper yang tampak seperti pure Java code:

```java
public CaseResponse toResponse(CaseEntity entity) {
    return new CaseResponse(
        entity.getId(),
        entity.getCaseNo(),
        entity.getAssignedOfficer().getName(),
        entity.getDocuments().stream()
            .map(doc -> doc.getFileName())
            .toList()
    );
}
```

bisa sebenarnya menjalankan banyak query.

Mental model:

> Getter pada entity JPA bukan selalu O(1) memory access. Getter bisa menjadi database access.

---

## 6. N+1 Query dari Mapper

N+1 biasanya dijelaskan sebagai query problem. Dalam praktik, N+1 sering dipicu oleh mapper.

Contoh:

```java
@Transactional(readOnly = true)
public List<CaseListItemResponse> listCases() {
    List<CaseEntity> cases = caseRepository.findLatestCases();
    return cases.stream()
        .map(caseMapper::toListItem)
        .toList();
}
```

Mapper:

```java
public CaseListItemResponse toListItem(CaseEntity entity) {
    return new CaseListItemResponse(
        entity.getId(),
        entity.getCaseNo(),
        entity.getAssignedOfficer().getDisplayName()
    );
}
```

Jika `findLatestCases()` mengambil 100 cases tanpa officer, lalu mapper mengakses officer per row, hasilnya:

```text
1 query  : select cases
100 query: select officer for each case
```

Itulah N+1.

Solusi bukan “jangan pakai mapper”. Solusinya adalah fetch plan sesuai DTO.

Opsi 1: fetch join.

```java
@Query("""
    select c
    from CaseEntity c
    join fetch c.assignedOfficer o
    order by c.createdAt desc
""")
List<CaseEntity> findLatestCasesWithOfficer();
```

Opsi 2: entity graph.

```java
@EntityGraph(attributePaths = {"assignedOfficer"})
@Query("select c from CaseEntity c order by c.createdAt desc")
List<CaseEntity> findLatestCasesWithOfficerGraph();
```

Opsi 3: DTO projection langsung dari query.

```java
@Query("""
    select new com.example.caseapp.api.CaseListItemResponse(
        c.id,
        c.caseNo,
        o.displayName
    )
    from CaseEntity c
    join c.assignedOfficer o
    order by c.createdAt desc
""")
List<CaseListItemResponse> findLatestCaseItems();
```

Opsi 4: two-step batch fetch untuk to-many data.

```text
1. Fetch cases page.
2. Fetch documents for case ids in one query.
3. Group documents by case id.
4. Assemble DTO.
```

Rule:

> Untuk list endpoint, jangan biarkan mapper melakukan traversal graph yang tidak di-plan.

---

## 7. LazyInitializationException: Mapping Setelah Session Tertutup

Error umum:

```text
org.hibernate.LazyInitializationException: could not initialize proxy - no Session
```

Biasanya terjadi saat entity keluar dari transaksi, lalu mapper/serializer mengakses lazy association.

Contoh buruk:

```java
public CaseEntity findCase(Long id) {
    return caseRepository.findById(id).orElseThrow();
}

@GetMapping("/cases/{id}")
public CaseEntity getCase(@PathVariable Long id) {
    return caseService.findCase(id); // transaction ended
    // Jackson serializes entity here
}
```

Saat Jackson menyentuh lazy field setelah transaction/session tertutup, exception terjadi.

Ada beberapa respons yang sering ditemui:

1. Aktifkan Open Session in View.
2. Pakai eager loading.
3. Pakai Jackson Hibernate module.
4. Tambahkan `@JsonIgnore` di association.
5. Map DTO di dalam transaksi.

Yang paling sehat sebagai default enterprise:

```java
@Transactional(readOnly = true)
public CaseResponse getCase(Long id) {
    CaseEntity entity = repository.findDetailById(id)
        .orElseThrow(CaseNotFoundException::new);
    return mapper.toDetailResponse(entity);
}
```

Dengan repository yang eksplisit fetch graph-nya:

```java
@EntityGraph(attributePaths = {
    "assignedOfficer",
    "documents",
    "documents.uploadedBy"
})
Optional<CaseEntity> findDetailById(Long id);
```

Prinsip:

> Mapping entity ke DTO sebaiknya terjadi di dalam transactional read boundary dengan fetch plan eksplisit.

---

## 8. Open Session in View: Convenience yang Membuat API Tidak Terprediksi

Open Session in View / Open EntityManager in View membuat session tetap terbuka sampai view/serialization selesai.

Akibatnya, Jackson serialization bisa memicu lazy load setelah service method selesai.

Secara sekilas ini “memperbaiki” LazyInitializationException. Tapi trade-off-nya besar:

- query bisa terjadi saat serialization;
- controller response shape bisa menentukan database load;
- N+1 menjadi sulit terlihat;
- transaction boundary menjadi mental model palsu;
- performance endpoint menjadi sulit diprediksi;
- error database bisa muncul saat response rendering;
- DTO mapping discipline melemah.

Untuk sistem enterprise yang butuh predictability, lebih baik:

```text
Service transaction
   ↓
Fetch planned data
   ↓
Map to DTO
   ↓
Return detached DTO
   ↓
Serialize DTO only
```

Bukan:

```text
Return entity
   ↓
Jackson traverses graph
   ↓
Lazy load while rendering response
```

---

## 9. Bidirectional Relationship dan Recursive Serialization

Entity relationship sering bidirectional:

```java
@Entity
public class CaseEntity {
    @OneToMany(mappedBy = "caseEntity")
    private List<CaseDocumentEntity> documents;
}

@Entity
public class CaseDocumentEntity {
    @ManyToOne
    private CaseEntity caseEntity;
}
```

Jika entity langsung diserialize:

```text
Case
 └── documents
      └── case
           └── documents
                └── case
                     └── ...
```

Hasilnya bisa:

- infinite recursion;
- stack overflow;
- payload sangat besar;
- circular reference handling yang tidak sesuai API contract.

Jackson punya annotation seperti:

```java
@JsonManagedReference
@JsonBackReference
```

atau:

```java
@JsonIdentityInfo(...)
```

Tetapi ini sering hanya menambal gejala. Masalah dasarnya tetap: entity graph bukan API graph.

DTO sebaiknya mendefinisikan arah graph secara eksplisit:

```java
public record CaseDetailResponse(
    Long id,
    String caseNo,
    List<DocumentSummaryResponse> documents
) {}

public record DocumentSummaryResponse(
    Long id,
    String fileName,
    String uploadedByName
) {}
```

DTO document tidak perlu membawa full `CaseDetailResponse` balik.

Rule:

> API graph harus didesain sebagai tree/projection yang intentional, bukan mengikuti relationship graph ORM.

---

## 10. Entity Exposure dan Field Leakage

Entity sering memiliki field yang tidak boleh keluar:

```java
@Entity
public class UserEntity {
    private Long id;
    private String username;
    private String passwordHash;
    private String mfaSecret;
    private boolean locked;
    private String internalNote;
    private Instant lastLoginAt;
    private Long version;
}
```

Jika entity diserialize langsung, risiko leakage tinggi.

Menambahkan `@JsonIgnore` pada entity:

```java
@JsonIgnore
private String passwordHash;
```

lebih baik daripada tidak ada apa-apa, tetapi tetap desain yang rapuh:

- annotation JSON masuk ke persistence model;
- field baru bisa lupa diberi ignore;
- response admin vs public butuh bentuk berbeda;
- internal usage bisa bentrok dengan external contract;
- entity menjadi campuran ORM + API contract.

Lebih aman:

```java
public record PublicUserResponse(
    Long id,
    String username
) {}

public record AdminUserResponse(
    Long id,
    String username,
    boolean locked,
    Instant lastLoginAt
) {}
```

Mapping eksplisit:

```java
public PublicUserResponse toPublicResponse(UserEntity user) {
    return new PublicUserResponse(
        user.getId(),
        user.getUsername()
    );
}
```

Security principle:

> DTO response harus allow-list, bukan entity plus deny-list.

---

## 11. JPA Proxy: Object yang Bukan Class Aslinya

Hibernate dapat memakai proxy class untuk lazy entity.

Misalnya:

```java
OfficerEntity officer = caseEntity.getAssignedOfficer();
```

Runtime class-nya mungkin bukan:

```text
OfficerEntity
```

melainkan proxy subclass/bytecode-enhanced object.

Dampaknya:

### 11.1 `getClass()` vs `instanceof`

Jika equals memakai `getClass()` secara naif, proxy bisa menyebabkan equality gagal.

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;
    OfficerEntity that = (OfficerEntity) o;
    return Objects.equals(id, that.id);
}
```

Proxy subclass dapat membuat `getClass() != o.getClass()`.

### 11.2 Jackson melihat proxy property

Jackson dapat melihat property internal proxy atau gagal menserialize proxy tertentu.

### 11.3 MapStruct mapping memanggil getter

MapStruct generated mapper akan memanggil getter seperti Java biasa. Kalau getter menginisialisasi proxy, query terjadi.

Generated code tidak “tahu” bahwa getter adalah database access.

Prinsip:

> Proxy membuat entity bukan sekadar data object. Jangan jadikan proxy sebagai boundary object.

---

## 12. Jackson Hibernate Module: Tool, Bukan Arsitektur

Jackson punya module untuk integrasi dengan Hibernate, misalnya varian `jackson-datatype-hibernate5`, `hibernate6`, atau sejenis sesuai stack.

Module seperti ini bisa membantu:

- menghindari error saat serialisasi proxy;
- memilih apakah lazy object dipaksa load atau ditulis null;
- serialize identifier untuk proxy yang belum di-load;
- mengurangi noise property proxy.

Tetapi ini bukan pengganti DTO.

Jika konfigurasi memaksa lazy loading:

```text
serialization → lazy load → query storm
```

Jika konfigurasi menulis lazy field sebagai null:

```json
{
  "id": 10,
  "assignedOfficer": null
}
```

consumer bisa salah mengira officer memang tidak ada, padahal hanya belum di-load.

Jika serialize identifier:

```json
{
  "assignedOfficer": 99
}
```

shape API menjadi tidak konsisten jika kadang object, kadang id.

Kesimpulan:

> Jackson Hibernate module berguna untuk internal/admin/debug/legacy mitigation, tetapi API contract yang sehat tetap DTO/projection eksplisit.

---

## 13. FetchType.EAGER Bukan Solusi Universal

Saat mengalami LazyInitializationException, banyak engineer mengubah:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

menjadi:

```java
@ManyToOne(fetch = FetchType.EAGER)
```

Ini sering memperbaiki satu endpoint dan merusak sepuluh endpoint lain.

Masalah EAGER:

- association selalu diambil meskipun tidak dibutuhkan;
- list endpoint menjadi berat;
- graph bisa melebar tanpa sadar;
- sulit mengontrol query shape per use case;
- bisa menyebabkan cartesian product saat join besar;
- default global menggantikan kebutuhan lokal.

Lebih baik gunakan fetch plan per query/use case:

```java
@EntityGraph(attributePaths = {"assignedOfficer"})
Optional<CaseEntity> findSummaryById(Long id);

@EntityGraph(attributePaths = {"assignedOfficer", "documents", "documents.uploadedBy"})
Optional<CaseEntity> findDetailById(Long id);
```

Atau query projection:

```java
@Query("""
    select new com.example.CaseSummaryResponse(
        c.id,
        c.caseNo,
        o.displayName
    )
    from CaseEntity c
    join c.assignedOfficer o
    where c.id = :id
""")
Optional<CaseSummaryResponse> findSummaryResponseById(Long id);
```

Rule:

> Fetch strategy di mapping entity harus default konservatif. Fetch need sebaiknya diekspresikan di query, bukan annotation global.

---

## 14. Fetch Plan Harus Mengikuti DTO Shape

DTO shape:

```java
public record CaseDetailResponse(
    Long id,
    String caseNo,
    String assignedOfficerName,
    List<DocumentResponse> documents
) {}
```

Butuh data:

```text
case.id
case.caseNo
officer.displayName
documents.id
documents.fileName
```

Maka query/fetch plan harus menjawab data tersebut.

Pendekatan 1: entity graph.

```java
@EntityGraph(attributePaths = {
    "assignedOfficer",
    "documents"
})
Optional<CaseEntity> findById(Long id);
```

Pendekatan 2: fetch join.

```java
@Query("""
    select distinct c
    from CaseEntity c
    join fetch c.assignedOfficer
    left join fetch c.documents
    where c.id = :id
""")
Optional<CaseEntity> findDetailById(Long id);
```

Pendekatan 3: split query untuk to-many agar tidak cartesian explosion.

```java
CaseHeaderRow header = caseQueryRepository.findHeader(id);
List<DocumentRow> documents = documentQueryRepository.findByCaseId(id);
return assembler.toDetailResponse(header, documents);
```

Untuk detail single record, fetch join to-many bisa acceptable. Untuk paginated list, fetch join to-many sering berbahaya.

Checklist:

```text
DTO punya to-one association?  → fetch join/entity graph/projection join.
DTO punya to-many association? → hati-hati pagination, duplicate rows, memory, cartesian product.
DTO list endpoint?            → projection atau two-step batch biasanya lebih aman.
DTO detail endpoint?          → entity graph/fetch join bisa masuk akal.
```

---

## 15. Pagination + To-Many Fetch Join Trap

Contoh:

```java
@Query("""
    select c
    from CaseEntity c
    left join fetch c.documents
    order by c.createdAt desc
""")
Page<CaseEntity> findPageWithDocuments(Pageable pageable);
```

Ini berisiko karena satu case bisa punya banyak documents. Result SQL menjadi row-per-case-document, bukan row-per-case.

Misal:

```text
Case A: 10 documents
Case B: 1 document
Case C: 0 document
```

Database pagination bekerja di row SQL, bukan object graph. Akibatnya:

- page size bisa tidak sesuai jumlah root entity;
- duplicate root entity;
- Hibernate harus deduplicate di memory;
- performance buruk;
- result bisa tidak stabil.

Pendekatan lebih aman:

```text
1. Query page case ids.
2. Query case headers for ids.
3. Query documents for ids.
4. Group documents by case id.
5. Assemble response.
```

Contoh:

```java
@Transactional(readOnly = true)
public Page<CaseListItemResponse> listCases(Pageable pageable) {
    Page<Long> caseIdPage = caseRepository.findLatestCaseIds(pageable);

    List<CaseHeaderRow> headers = caseRepository.findHeadersByIds(caseIdPage.getContent());
    List<DocumentCountRow> counts = documentRepository.countDocumentsByCaseIds(caseIdPage.getContent());

    Map<Long, Long> countByCaseId = counts.stream()
        .collect(Collectors.toMap(DocumentCountRow::caseId, DocumentCountRow::count));

    List<CaseListItemResponse> items = headers.stream()
        .map(h -> new CaseListItemResponse(
            h.id(),
            h.caseNo(),
            h.status(),
            countByCaseId.getOrDefault(h.id(), 0L)
        ))
        .toList();

    return new PageImpl<>(items, pageable, caseIdPage.getTotalElements());
}
```

This is more code, but it is explicit and predictable.

---

## 16. DTO Projection vs Entity Mapping

Ada dua pendekatan umum untuk read model:

### 16.1 Entity mapping

```text
Query entity → MapStruct/manual mapper → DTO
```

Cocok jika:

- use case butuh domain/entity behavior;
- detail endpoint butuh graph yang wajar;
- entity sudah dibutuhkan untuk authorization/domain decision;
- mapping kompleks tetapi masih dalam bounded context yang sama.

### 16.2 DTO projection

```text
Query selected columns → DTO/row projection
```

Cocok jika:

- endpoint read-only;
- list/reporting/search;
- hanya perlu subset column;
- graph besar;
- butuh performa tinggi;
- ingin menghindari lazy/proxy entirely.

Contoh projection record:

```java
public record CaseListRow(
    Long id,
    String caseNo,
    String status,
    String assignedOfficerName,
    Instant createdAt
) {}
```

Query:

```java
@Query("""
    select new com.example.caseapp.query.CaseListRow(
        c.id,
        c.caseNo,
        c.status,
        o.displayName,
        c.createdAt
    )
    from CaseEntity c
    left join c.assignedOfficer o
    where c.status = :status
    order by c.createdAt desc
""")
List<CaseListRow> findCaseListRows(String status);
```

Mapping row to API response:

```java
public CaseListItemResponse toResponse(CaseListRow row) {
    return new CaseListItemResponse(
        row.id(),
        row.caseNo(),
        displayStatus(row.status()),
        row.assignedOfficerName(),
        row.createdAt()
    );
}
```

Top-level heuristic:

```text
Command/write use case → entity/aggregate mapping.
Query/list/report use case → projection-first often better.
```

---

## 17. Domain Entity vs JPA Entity

Di many enterprise systems, “entity” berarti JPA entity sekaligus domain entity. Ini bisa works, tapi punya konsekuensi.

Ada tiga style:

### 17.1 Anemic JPA entity as persistence model

```text
JPA Entity ≈ DB row object
Domain rules in service/application layer
```

Pros:

- simple;
- common in CRUD enterprise;
- easy with JPA repositories;
- mapping straightforward.

Cons:

- domain invariant mudah tersebar;
- entity bisa jadi god object;
- update logic rentan over-write;
- rule enforcement perlu discipline.

### 17.2 Rich JPA entity as domain aggregate

```text
JPA Entity = domain aggregate root
Methods enforce invariant
```

Pros:

- invariant dekat dengan state;
- command behavior lebih jelas;
- DDD-friendly.

Cons:

- ORM constraint memengaruhi domain design;
- lazy loading dalam domain method bisa tricky;
- serialization harus sangat dihindari;
- testing kadang lebih berat.

### 17.3 Separate domain model and persistence model

```text
Domain object separate from JPA entity
Mapper between them
```

Pros:

- domain bersih dari ORM;
- persistence detail terisolasi;
- cocok untuk complex domain.

Cons:

- mapper lebih banyak;
- identity/lifecycle lebih kompleks;
- performance perlu hati-hati;
- sering overkill untuk CRUD sederhana.

Tidak ada satu jawaban universal. Tetapi untuk mapping boundary, satu hal tetap:

> Jangan expose persistence entity sebagai external DTO, apa pun style domain yang dipilih.

---

## 18. Update Mapping: DTO ke Entity Bukan Sekadar Copy

Read mapping:

```text
Entity → DTO
```

Write mapping:

```text
Request DTO → Command → Entity mutation
```

Bug paling berbahaya muncul saat request DTO langsung di-copy ke entity.

Contoh buruk:

```java
@Mapper
public interface UserMapper {
    void updateEntity(UserUpdateRequest request, @MappingTarget UserEntity entity);
}
```

Jika request punya field:

```java
public class UserUpdateRequest {
    public String displayName;
    public String role;
    public Boolean locked;
}
```

Client bisa mengubah field yang seharusnya admin-only.

Lebih aman pisahkan DTO per use case:

```java
public record UserSelfUpdateRequest(
    String displayName
) {}

public record AdminUserUpdateRequest(
    String displayName,
    String role,
    Boolean locked
) {}
```

Dan mapping policy beda:

```java
public void applySelfUpdate(UserSelfUpdateRequest request, UserEntity entity) {
    entity.changeDisplayName(request.displayName());
}

public void applyAdminUpdate(AdminUserUpdateRequest request, UserEntity entity) {
    entity.changeDisplayName(request.displayName());
    entity.changeRole(Role.valueOf(request.role()));
    entity.setLocked(request.locked());
}
```

Even with MapStruct, command mutation needs policy.

```java
@Mapper
public interface UserAdminMapper {

    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "displayName", source = "displayName")
    @Mapping(target = "locked", source = "locked")
    void updateAdminFields(AdminUserUpdateRequest request, @MappingTarget UserEntity entity);
}
```

`ignoreByDefault = true` creates allow-list mapping.

---

## 19. Detached Entity Merge Danger

Salah satu anti-pattern paling berbahaya:

```java
@PostMapping("/users/{id}")
public UserEntity update(@PathVariable Long id, @RequestBody UserEntity incoming) {
    incoming.setId(id);
    return userRepository.save(incoming);
}
```

Ini membuka banyak risiko:

- client menentukan entity shape;
- field missing menjadi null;
- relation bisa diganti;
- version/audit field bisa rusak;
- over-posting sangat mudah;
- detached entity merge bisa overwrite state yang tidak dimaksud.

Lebih aman:

```java
@Transactional
public UserResponse updateUser(Long id, UserUpdateRequest request) {
    UserEntity entity = userRepository.findById(id).orElseThrow();

    entity.changeDisplayName(request.displayName());

    return mapper.toResponse(entity);
}
```

Pattern:

```text
Load managed entity
   ↓
Authorize
   ↓
Validate command
   ↓
Apply specific mutation
   ↓
Flush via dirty checking
   ↓
Map managed final state to DTO
```

Bukan:

```text
Deserialize entity from client
   ↓
Merge/save detached object
```

Rule:

> Never trust client payload to reconstruct persistence entity.

---

## 20. Audit Fields dan Version Fields

Entity sering punya field:

```java
@CreatedDate
private Instant createdAt;

@CreatedBy
private String createdBy;

@LastModifiedDate
private Instant updatedAt;

@LastModifiedBy
private String updatedBy;

@Version
private Long version;
```

Field ini punya aturan khusus.

Bahaya jika mapping request ke entity menyentuh field ini:

```java
entity.setCreatedAt(request.createdAt());
entity.setUpdatedBy(request.updatedBy());
entity.setVersion(request.version());
```

Audit/version harus dimiliki persistence/application infrastructure, bukan client.

DTO response boleh expose sebagian:

```java
public record CaseResponse(
    Long id,
    String caseNo,
    String status,
    Instant createdAt,
    Instant updatedAt,
    Long version
) {}
```

Tetapi request DTO jangan menerima field tersebut kecuali memang concurrency token:

```java
public record UpdateCaseRequest(
    String title,
    Long expectedVersion
) {}
```

Bahkan untuk optimistic concurrency, lebih baik field diberi nama semantic:

```text
expectedVersion
```

bukan langsung:

```text
version
```

agar jelas bahwa client tidak “mengatur” version, hanya menyatakan version yang ia lihat.

---

## 21. Entity Identity vs DTO Identity

Entity identity biasanya database primary key.

DTO identity bisa bermacam-macam:

- database id;
- public id;
- UUID;
- case number;
- external reference number;
- composite natural key;
- opaque token.

Jangan otomatis expose `entity.id` hanya karena ada.

Contoh:

```java
@Entity
public class CaseEntity {
    @Id
    private Long id;          // internal DB id
    private String caseNo;    // business/public id
}
```

Public API mungkin seharusnya:

```java
public record CaseResponse(
    String caseNo,
    String status
) {}
```

Admin/internal API mungkin boleh:

```java
public record InternalCaseResponse(
    Long id,
    String caseNo,
    String status
) {}
```

Mapper adalah tempat policy identity boundary:

```java
public CaseResponse toPublicResponse(CaseEntity entity) {
    return new CaseResponse(
        entity.getCaseNo(),
        entity.getStatus()
    );
}
```

Prinsip:

> Identifier persistence tidak otomatis menjadi identifier contract.

---

## 22. Mapping Relationship: ID Reference vs Embedded Object

Request update relationship sering salah dimodelkan.

Buruk:

```json
{
  "assignedOfficer": {
    "id": 42,
    "name": "Alice"
  }
}
```

Jika client hanya ingin assign officer, payload seharusnya:

```json
{
  "assignedOfficerId": 42
}
```

Lalu service resolve reference:

```java
@Transactional
public void assignOfficer(Long caseId, AssignOfficerRequest request) {
    CaseEntity caseEntity = caseRepository.findById(caseId).orElseThrow();
    OfficerEntity officer = officerRepository.getReferenceById(request.assignedOfficerId());

    caseEntity.assignOfficer(officer);
}
```

Kenapa tidak map nested officer dari payload?

Karena nested object payload bisa ambigu:

- apakah update officer?
- apakah hanya reference?
- apakah create officer baru?
- apakah name harus dipercaya?
- bagaimana jika id dan name tidak cocok?

Relationship mutation harus explicit command:

```java
public record AssignOfficerRequest(Long assignedOfficerId) {}
public record RemoveOfficerRequest(String reason) {}
public record TransferCaseRequest(Long fromOfficerId, Long toOfficerId, String reason) {}
```

Rule:

> Untuk write-side relationship, prefer id/reference command dibanding nested entity graph.

---

## 23. Orphan Update dan Collection Replacement Trap

Mapping collection dari request ke entity sangat berbahaya.

Contoh:

```java
public class UpdateCaseRequest {
    private List<DocumentRequest> documents;
}
```

Mapper:

```java
void update(UpdateCaseRequest request, @MappingTarget CaseEntity entity);
```

Jika mapper melakukan:

```java
entity.setDocuments(mappedDocuments);
```

Risiko:

- existing collection replaced;
- orphan removal menghapus data;
- order berubah;
- audit trail hilang;
- child entity id mismatch;
- detached child merge;
- concurrent update overwritten.

Lebih baik command spesifik:

```text
POST /cases/{id}/documents       add document
DELETE /cases/{id}/documents/{d} remove document
PATCH /cases/{id}/documents/{d}  update metadata
PUT /cases/{id}/document-order   reorder documents
```

Atau kalau bulk update memang dibutuhkan, explicit diff:

```java
@Transactional
public void updateDocuments(Long caseId, UpdateDocumentsRequest request) {
    CaseEntity caseEntity = caseRepository.findByIdWithDocuments(caseId)
        .orElseThrow();

    DocumentDiff diff = documentDiffService.diff(
        caseEntity.getDocuments(),
        request.documents()
    );

    diff.removed().forEach(caseEntity::removeDocument);
    diff.added().forEach(caseEntity::addDocument);
    diff.modified().forEach(change -> caseEntity.updateDocument(change));
}
```

Rule:

> Collection update is not mapping. Collection update is reconciliation.

---

## 24. MapStruct and JPA: Good Fit, With Boundaries

MapStruct works well for:

```text
Entity → DTO
DTO → Entity for simple create
DTO → existing entity for controlled update
Projection row → DTO
Entity → event payload
```

But MapStruct does not solve:

- fetch plan;
- authorization;
- relationship resolution;
- collection reconciliation;
- domain invariant;
- transaction boundary;
- lazy loading policy;
- detached merge semantics.

Example safe usage:

```java
@Mapper(componentModel = "spring")
public interface CaseReadMapper {

    @Mapping(target = "assignedOfficerName", source = "assignedOfficer.displayName")
    CaseDetailResponse toDetailResponse(CaseEntity entity);
}
```

But repository must fetch `assignedOfficer` intentionally.

```java
@EntityGraph(attributePaths = {"assignedOfficer"})
Optional<CaseEntity> findDetailById(Long id);
```

MapStruct generated code will call:

```java
entity.getAssignedOfficer().getDisplayName()
```

It will not know whether that causes SQL.

Therefore use convention:

```java
// Mapper assumes required associations are already loaded.
// Repository/service must satisfy fetch contract.
```

Better: encode mapper expectation in method name:

```java
CaseDetailResponse toDetailResponseFromFetchedDetail(CaseEntity entity);
```

Or documentation:

```java
/**
 * Requires: assignedOfficer and documents are loaded.
 */
CaseDetailResponse toDetailResponse(CaseEntity entity);
```

---

## 25. Detecting Accidental Lazy Loads in Tests

Mapping tests should detect unexpected queries.

At minimum, integration test can assert query count.

Pseudo-example:

```java
@Test
void listCases_shouldNotTriggerNPlusOneDuringMapping() {
    queryCounter.clear();

    List<CaseListItemResponse> result = service.listCases();

    assertThat(result).hasSize(20);
    assertThat(queryCounter.count()).isLessThanOrEqualTo(3);
}
```

You can implement query counting through:

- datasource proxy;
- Hibernate statistics;
- SQL logging assertion;
- integration test extension;
- p6spy-like tooling;
- custom datasource wrapper.

Also test mapping outside session intentionally:

```java
@Test
void mapper_shouldNotNeedLazyAssociationForSummary() {
    CaseEntity entity = repository.findById(id).orElseThrow();
    entityManager.detach(entity);

    CaseSummaryResponse response = mapper.toSummaryResponse(entity);

    assertThat(response.caseNo()).isEqualTo("CASE-001");
}
```

This test verifies summary mapper does not touch lazy association.

For detail mapper, test opposite:

```java
@Test
void detailMapper_requiresFetchedAssociations() {
    CaseEntity entity = repository.findDetailById(id).orElseThrow();

    CaseDetailResponse response = mapper.toDetailResponse(entity);

    assertThat(response.documents()).isNotEmpty();
}
```

---

## 26. JPA Entity and Lombok Pitfalls

Lombok with JPA must be used carefully.

Dangerous:

```java
@Data
@Entity
public class CaseEntity {
    @Id
    private Long id;

    @OneToMany(mappedBy = "caseEntity")
    private List<CaseDocumentEntity> documents;
}
```

`@Data` generates:

- getters;
- setters;
- `equals`;
- `hashCode`;
- `toString`;
- required constructor.

Problems:

1. `toString()` may traverse lazy collection.
2. `equals/hashCode` may include mutable fields or lazy associations.
3. Setter for all fields allows uncontrolled mutation.
4. Bidirectional relationship can recurse in `toString`.
5. Hash-based collection behavior can break when id changes after persist.

Safer baseline:

```java
@Getter
@Setter(AccessLevel.PROTECTED)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
public class CaseEntity {

    @Id
    @GeneratedValue
    private Long id;

    private String caseNo;

    @OneToMany(mappedBy = "caseEntity")
    @ToString.Exclude
    private List<CaseDocumentEntity> documents = new ArrayList<>();

    protected CaseEntity() {}

    public static CaseEntity create(String caseNo) {
        CaseEntity entity = new CaseEntity();
        entity.caseNo = caseNo;
        return entity;
    }

    public void changeCaseNo(String caseNo) {
        this.caseNo = caseNo;
    }
}
```

For entities, avoid default `@Data` unless you have a very strong reason.

---

## 27. Equals and HashCode for Entities

Entity equality is notoriously tricky.

Bad approach:

```java
@EqualsAndHashCode
@Entity
public class CaseEntity {
    @Id
    @GeneratedValue
    private Long id;

    private String caseNo;

    @OneToMany(mappedBy = "caseEntity")
    private List<CaseDocumentEntity> documents;
}
```

This may include mutable fields and associations.

Common approaches:

### 27.1 Business key equality

If stable natural key exists:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof CaseEntity that)) return false;
    return Objects.equals(caseNo, that.caseNo);
}

@Override
public int hashCode() {
    return Objects.hash(caseNo);
}
```

Only if `caseNo` is immutable and globally unique.

### 27.2 Identifier equality after persistence

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof CaseEntity that)) return false;
    return id != null && Objects.equals(id, that.id);
}

@Override
public int hashCode() {
    return getClass().hashCode();
}
```

This pattern avoids changing hash code after id assignment, but has proxy subtleties.

Key lesson:

> Do not let Lombok generate entity equality without deliberate design.

---

## 28. Serialization of JPA Entity as Audit/Event Payload

Sometimes teams use entity directly as audit/event payload:

```java
String json = objectMapper.writeValueAsString(entity);
```

This is dangerous:

- lazy fields may not be loaded;
- proxy fields may appear;
- audit payload changes when entity changes;
- sensitive fields can leak;
- bidirectional graph can recurse;
- event consumers become coupled to persistence model;
- schema evolution becomes uncontrolled.

Better:

```java
public record CaseUpdatedEvent(
    String eventId,
    String caseNo,
    String oldStatus,
    String newStatus,
    Instant occurredAt,
    String actorId
) {}
```

Mapper:

```java
public CaseUpdatedEvent toEvent(CaseEntity entity, Status oldStatus, Actor actor) {
    return new CaseUpdatedEvent(
        UUID.randomUUID().toString(),
        entity.getCaseNo(),
        oldStatus.name(),
        entity.getStatus().name(),
        clock.instant(),
        actor.id()
    );
}
```

For audit snapshot, define audit DTO:

```java
public record CaseAuditSnapshot(
    String caseNo,
    String status,
    String assignedOfficerId,
    List<String> documentIds
) {}
```

Audit/event payload should be versioned contract, not entity dump.

---

## 29. DTO Projection for Reporting and Search

Search/report endpoint should often avoid entity mapping entirely.

Example reporting need:

```text
Case No | Status | Officer | Document Count | Last Updated
```

Entity graph approach may load too much.

Projection approach:

```java
public record CaseReportRow(
    String caseNo,
    String status,
    String officerName,
    long documentCount,
    Instant lastUpdatedAt
) {}
```

Query:

```java
@Query("""
    select new com.example.report.CaseReportRow(
        c.caseNo,
        c.status,
        o.displayName,
        count(d.id),
        c.updatedAt
    )
    from CaseEntity c
    left join c.assignedOfficer o
    left join c.documents d
    where c.createdAt between :from and :to
    group by c.caseNo, c.status, o.displayName, c.updatedAt
""")
List<CaseReportRow> report(Instant from, Instant to);
```

Benefits:

- no lazy proxy;
- no dirty checking overhead for entity graph;
- selected columns only;
- shape aligns with report;
- less memory pressure;
- contract clearer.

Trade-off:

- query becomes coupled to output;
- complex projection can be hard to maintain;
- to-many nested projection may need manual aggregation;
- not reusable for command use case.

Rule:

> For read-heavy/reporting endpoints, projection is often the right mapping layer.

---

## 30. Mapping and Transaction Boundary Patterns

### Pattern A: Transactional entity-to-DTO mapping

```java
@Transactional(readOnly = true)
public CaseDetailResponse getDetail(Long id) {
    CaseEntity entity = repository.findDetailById(id).orElseThrow();
    return mapper.toDetailResponse(entity);
}
```

Use when:

- detail endpoint;
- domain decision needed;
- graph size controlled;
- fetch plan explicit.

### Pattern B: Query projection

```java
@Transactional(readOnly = true)
public List<CaseListItemResponse> listCases(SearchCriteria criteria) {
    return repository.searchCaseListItems(criteria);
}
```

Use when:

- list/search/report;
- high throughput;
- small subset fields;
- avoid entity graph.

### Pattern C: Command mutation

```java
@Transactional
public CaseResponse updateCase(Long id, UpdateCaseRequest request) {
    CaseEntity entity = repository.findById(id).orElseThrow();
    entity.changeTitle(request.title());
    entity.changePriority(Priority.from(request.priority()));
    return mapper.toResponse(entity);
}
```

Use when:

- write use case;
- invariant enforcement;
- dirty checking desired.

### Pattern D: Anti-corruption import

```java
@Transactional
public void importExternalCase(ExternalCasePayload payload) {
    ExternalCaseCommand command = externalMapper.toCommand(payload);
    caseImportService.apply(command);
}
```

Use when:

- external/legacy system;
- normalization needed;
- external payload not trusted as entity.

---

## 31. Case Study: Case Management Detail Endpoint

Requirement:

```text
GET /cases/{caseNo}
returns:
- caseNo
- title
- status
- assigned officer name
- applicant name
- latest 5 documents
- timeline summary
```

Bad implementation:

```java
@GetMapping("/cases/{caseNo}")
public CaseEntity get(@PathVariable String caseNo) {
    return repository.findByCaseNo(caseNo).orElseThrow();
}
```

Better design:

```java
public record CaseDetailResponse(
    String caseNo,
    String title,
    String status,
    String assignedOfficerName,
    String applicantName,
    List<DocumentSummaryResponse> latestDocuments,
    TimelineSummaryResponse timeline
) {}
```

Data access:

```java
@Transactional(readOnly = true)
public CaseDetailResponse getDetail(String caseNo) {
    CaseHeaderRow header = caseQueryRepository.findHeader(caseNo)
        .orElseThrow(CaseNotFoundException::new);

    List<DocumentSummaryRow> documents = documentQueryRepository.findLatest5ByCaseNo(caseNo);
    TimelineSummaryRow timeline = timelineQueryRepository.findSummaryByCaseNo(caseNo);

    return assembler.toDetailResponse(header, documents, timeline);
}
```

Why split query?

- latest 5 documents is not same as all documents;
- timeline summary may require aggregation;
- no need to load full entity graph;
- response is read model, not aggregate mutation;
- avoids lazy surprises.

Assembler:

```java
@Component
public class CaseDetailAssembler {

    public CaseDetailResponse toDetailResponse(
        CaseHeaderRow header,
        List<DocumentSummaryRow> documents,
        TimelineSummaryRow timeline
    ) {
        return new CaseDetailResponse(
            header.caseNo(),
            header.title(),
            header.status(),
            header.assignedOfficerName(),
            header.applicantName(),
            documents.stream()
                .map(this::toDocument)
                .toList(),
            toTimeline(timeline)
        );
    }

    private DocumentSummaryResponse toDocument(DocumentSummaryRow row) {
        return new DocumentSummaryResponse(row.id(), row.fileName(), row.uploadedAt());
    }

    private TimelineSummaryResponse toTimeline(TimelineSummaryRow row) {
        return new TimelineSummaryResponse(row.lastActivityAt(), row.activityCount());
    }
}
```

This is not “less pure” than MapStruct. It is more explicit for a read model composed from multiple query shapes.

---

## 32. Case Study: Update Case Status

Requirement:

```text
PATCH /cases/{caseNo}/status
body:
{
  "targetStatus": "APPROVED",
  "reason": "All requirements satisfied",
  "expectedVersion": 7
}
```

Bad DTO-to-entity mapping:

```java
void update(UpdateCaseStatusRequest request, @MappingTarget CaseEntity entity);
```

This hides domain rules.

Better:

```java
@Transactional
public CaseResponse updateStatus(String caseNo, UpdateCaseStatusRequest request, Actor actor) {
    CaseEntity entity = repository.findByCaseNo(caseNo)
        .orElseThrow(CaseNotFoundException::new);

    if (!Objects.equals(entity.getVersion(), request.expectedVersion())) {
        throw new OptimisticConflictException();
    }

    entity.transitionTo(
        CaseStatus.from(request.targetStatus()),
        request.reason(),
        actor
    );

    eventPublisher.publish(caseEventMapper.toStatusChangedEvent(entity, actor));

    return caseMapper.toResponse(entity);
}
```

Here mapping is used for:

- request deserialization;
- status enum conversion;
- response DTO;
- event payload.

But domain transition is not delegated to mapper.

Rule:

> Mapper transforms representation. Domain method changes business state.

---

## 33. Checklist: Should This Endpoint Use Entity Mapping or Projection?

Ask these questions:

1. Is the endpoint read-only?
2. Is it a list/search/report endpoint?
3. Does it need only a subset of columns?
4. Does it include aggregated fields?
5. Does it include count/latest/top-N child data?
6. Is pagination involved?
7. Does it include to-many associations?
8. Is performance critical?
9. Does mapping trigger lazy loads?
10. Does the endpoint need domain behavior/invariant evaluation?

Heuristic:

```text
Mostly yes for 1-8 and no for 10 → projection/row assembler.
Yes for 10 → entity/aggregate loading with explicit fetch plan.
```

---

## 34. Persistence Mapping Review Checklist

Use this during code review.

### 34.1 Entity exposure

- [ ] Controller never returns JPA entity directly.
- [ ] Request body is never bound directly to JPA entity.
- [ ] Entity is not used as event/audit external contract.
- [ ] DTO is allow-list based.

### 34.2 Lazy loading

- [ ] Mapper assumptions about loaded associations are explicit.
- [ ] Service maps entity inside transaction when needed.
- [ ] Serialization does not trigger lazy loading.
- [ ] Open Session in View is not relied upon for correctness.

### 34.3 Query shape

- [ ] Fetch plan matches DTO shape.
- [ ] List endpoint avoids hidden to-many fetch join pagination problem.
- [ ] Query count is tested for important endpoints.
- [ ] Projection considered for read-heavy endpoint.

### 34.4 Security

- [ ] Sensitive fields never appear in response DTO.
- [ ] Internal ids are exposed only intentionally.
- [ ] Admin/public response DTOs are separate.
- [ ] Request DTO cannot update forbidden fields.

### 34.5 Update semantics

- [ ] Update loads managed entity first.
- [ ] No detached entity merge from client payload.
- [ ] Patch semantics distinguish absent vs null.
- [ ] Collection update is modeled as diff/reconciliation.
- [ ] Relationship update uses explicit reference/command.

### 34.6 Entity design

- [ ] No careless Lombok `@Data` on JPA entity.
- [ ] `equals/hashCode` designed intentionally.
- [ ] `toString` does not traverse lazy graph.
- [ ] Bidirectional helper methods preserve both sides.

### 34.7 Audit/version

- [ ] Audit fields are not writable from request DTO.
- [ ] Version field is handled as concurrency token, not client-controlled field.
- [ ] Event/audit payload is versioned DTO, not entity dump.

---

## 35. Common Anti-Patterns and Better Alternatives

| Anti-pattern | Why dangerous | Better alternative |
|---|---|---|
| Return JPA entity from controller | Leaks schema, lazy issues, cycles | Response DTO |
| Bind request body to entity | Over-posting, detached merge | Request DTO + command mutation |
| Add `FetchType.EAGER` to fix lazy error | Global performance damage | Query-specific fetch plan |
| Rely on OSIV for API serialization | Hidden queries during response | Map DTO inside transaction |
| Use `@JsonIgnore` everywhere on entity | API contract mixed into persistence model | Separate DTOs |
| Use `@Data` on entity | bad equals/toString/setters | explicit Lombok usage or manual methods |
| Replace entity collection from request | orphan delete/overwrite risk | explicit add/remove/diff commands |
| Serialize entity for event | schema drift/leakage | versioned event DTO |
| Map relation from nested object request | ambiguous semantics | id/reference command |
| Ignore query count in mapper tests | hidden N+1 | query count regression tests |

---

## 36. Design Principles for Top 1% Persistence Mapping

### Principle 1: Entity is not the contract

Even when entity and DTO have identical fields today, they have different reasons to change.

### Principle 2: Fetch plan belongs before mapping

Mapping should not accidentally decide database load.

### Principle 3: DTO shape should drive query shape

Especially for read-side endpoints.

### Principle 4: Write mapping should be command-oriented

Do not reconstruct entity from client payload.

### Principle 5: Relationship update is behavior, not field assignment

Assign, remove, transfer, reorder, replace, and reconcile are different operations.

### Principle 6: Generated mapper is not magic

MapStruct generates method calls. Method calls on entity can trigger lazy loading.

### Principle 7: Serialization should happen after persistence boundary is resolved

Serialize DTOs, not live persistence objects.

### Principle 8: Audit/event payloads are contracts

They need versioning and allow-list design just like APIs.

---

## 37. Practical Architecture Template

Recommended package structure:

```text
com.example.caseapp
  casecore
    domain
      Case.java / CaseEntity.java
      CaseStatus.java
    persistence
      CaseRepository.java
      CaseEntity.java
      CaseQueryRepository.java
      row
        CaseHeaderRow.java
        CaseListRow.java
    application
      CaseCommandService.java
      CaseQueryService.java
    api
      CaseController.java
      dto
        CaseResponse.java
        CaseDetailResponse.java
        UpdateCaseStatusRequest.java
      mapper
        CaseResponseMapper.java
        CaseDetailAssembler.java
    event
      CaseUpdatedEvent.java
      CaseEventMapper.java
```

Alternative for stricter layering:

```text
adapter.in.web.dto
adapter.in.web.mapper
adapter.out.persistence.entity
adapter.out.persistence.mapper
application.command
application.query
application.port
application.service
domain.model
domain.event
```

Key idea:

```text
Persistence entity should not flow freely upward to controller.
External DTO should not flow downward into repository.
Application service coordinates mapping between boundaries.
```

---

## 38. Mini Exercise

Given this entity:

```java
@Entity
public class ApplicationEntity {
    @Id
    private Long id;

    private String applicationNo;
    private String status;

    @ManyToOne(fetch = FetchType.LAZY)
    private ApplicantEntity applicant;

    @OneToMany(mappedBy = "application", fetch = FetchType.LAZY)
    private List<ApplicationDocumentEntity> documents;

    @CreatedDate
    private Instant createdAt;

    @LastModifiedDate
    private Instant updatedAt;

    @Version
    private Long version;
}
```

Design:

1. `ApplicationListItemResponse`
2. `ApplicationDetailResponse`
3. `UpdateApplicationStatusRequest`
4. repository/fetch strategy for list endpoint
5. repository/fetch strategy for detail endpoint
6. service flow for status update

Expected reasoning:

- list endpoint should probably use projection;
- detail endpoint may use fetch plan or split query;
- status update should load managed entity;
- request should include semantic fields, not entity dump;
- version should be expected version/concurrency token;
- documents should not be blindly replaced;
- applicant should be represented as summary DTO, not full entity.

---

## 39. Summary

Persistence mapping is dangerous because persistence objects are alive. They are not inert bags of fields.

A JPA entity may:

- belong to a persistence context;
- trigger SQL from getter;
- be a proxy;
- hold lazy collections;
- participate in dirty checking;
- contain bidirectional cycles;
- expose internal fields;
- behave differently inside/outside transaction.

Therefore, production-grade mapping must coordinate:

```text
Use case intent
   ↓
DTO/API contract
   ↓
Query/fetch plan
   ↓
Entity/projection loading
   ↓
Mapping/assembly
   ↓
Serialization
```

The senior-level leap is this:

> Mapping persistence data is not only about converting object A to object B. It is about controlling data shape, lifecycle, query behavior, security exposure, and state mutation boundaries.

---

## 40. References

- Jakarta Persistence 3.2 Specification — persistence API and ORM contract for Jakarta EE / Java SE.
- Jakarta Persistence Entity Graph documentation — fetch plan modelling for persistence operations and queries.
- Hibernate ORM User Guide — fetching strategies, lazy loading, proxies, batch/select/join fetching.
- Hibernate ORM 7 documentation — persistence context, proxies and lazy fetching, entity graphs, detached state.
- Jackson datatype Hibernate module documentation — handling Hibernate proxies/lazy-loaded values during serialization.
- MapStruct Reference Guide — generated mapper behavior and plain Java method invocation.
- OWASP Mass Assignment Cheat Sheet — security risk when binding request payloads directly into internal objects.

---

## 41. Status Seri

Progress saat ini:

```text
Part 31 dari 35 selesai.
```

Seri belum selesai.

Berikutnya:

```text
Part 32 — Integration Mapping: External API, Legacy Payload, Anti-Corruption Layer
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 30 — Performance and Memory Engineering for Mapping Layers](./30-performance-memory-engineering-mapping-layers.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 32 — Integration Mapping: External API, Legacy Payload, Anti-Corruption Layer](./32-integration-mapping-external-api-legacy-payload-anti-corruption-layer.md)

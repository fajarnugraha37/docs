# Part 14 — Fetching Mental Model: Lazy, Eager, Proxies, Enhancement, and Load Plans

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Bagian: 14 dari 34  
> Target: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4  
> Fokus: memahami fetching sebagai proses materialisasi graph, bukan sekadar pilihan `LAZY` atau `EAGER`.

---

## 0. Executive Summary

Fetching adalah salah satu sumber bug dan performa buruk paling umum dalam aplikasi JPA/Hibernate/EclipseLink.

Banyak developer memahami fetching seperti ini:

```java
@ManyToOne(fetch = FetchType.LAZY)
private Customer customer;
```

Lalu berpikir:

> “Relasi ini pasti tidak akan diload sampai dipakai.”

Itu mental model yang terlalu lemah.

Mental model yang lebih benar:

> Fetching adalah keputusan provider tentang **kapan**, **bagaimana**, **dengan SQL apa**, **dengan mekanisme object apa**, dan **dalam scope persistence context mana** sebagian object graph dimaterialisasi dari database ke memory.

Dengan kata lain, fetching bukan sekadar annotation. Fetching melibatkan:

1. **Default fetch policy** dari specification.
2. **Provider implementation**: proxy, collection wrapper, bytecode enhancement, weaving, fetch group.
3. **Query-time override**: join fetch, entity graph, fetch profile, provider hints.
4. **Persistence context state**: apakah entity sudah ada di first-level cache.
5. **Transaction boundary**: apakah lazy access masih punya session/entity manager aktif.
6. **Serialization/API boundary**: apakah object graph keluar ke JSON, logging, equals, debugger, template engine.
7. **SQL shape**: join, select per row, batch select, subselect, secondary select.
8. **Memory shape**: object hydration, duplicate row collapse, collection initialization.

Part ini membangun fondasi untuk Part 15 tentang N+1 dan fetch plan engineering.

---

## 1. Why This Matters

Fetching adalah titik pertemuan antara dunia object-oriented dan relational.

Di kode Java, kita melihat object graph:

```text
Case
 ├── applicant
 ├── documents
 ├── assignedOfficer
 ├── auditEntries
 └── correspondenceItems
```

Di database, data tersebut tersebar di banyak table:

```text
case
applicant
case_document
user_account
case_audit_entry
correspondence
```

Masalahnya: object graph terasa natural untuk dinavigasi, tetapi relational data harus diambil dengan query eksplisit.

ORM mencoba menjembatani ini dengan strategi fetching.

Tanpa pemahaman fetching, aplikasi enterprise akan sering mengalami:

- N+1 query.
- Cartesian explosion.
- `LazyInitializationException`.
- API endpoint tiba-tiba lambat.
- JSON serialization memicu ratusan query.
- EAGER association membuat semua query berat.
- Pagination rusak karena collection fetch join.
- Memory spike karena graph terlalu besar dimaterialisasi.
- SQL berbeda antara Hibernate dan EclipseLink walau mapping sama.
- Bug production yang sulit direproduksi karena tergantung transaction boundary.

Top-tier engineer tidak berpikir “pakai lazy supaya aman”.

Top-tier engineer bertanya:

1. Use case ini butuh graph sebesar apa?
2. Kapan graph itu dibutuhkan?
3. Query mana yang menjadi owner fetch decision?
4. Apakah association ini selalu, kadang, atau jarang dibutuhkan?
5. Apakah graph ini akan keluar dari transaction boundary?
6. Apakah loading dilakukan untuk command/write use case atau read/reporting use case?
7. Apakah object hydration lebih murah daripada DTO projection?
8. Apa SQL yang benar-benar dihasilkan provider?

---

## 2. Core Mental Model

### 2.1 Fetching Is Graph Materialization

Fetching adalah proses mengubah row relational menjadi object graph.

Misalnya:

```sql
select c.*
from cases c
where c.id = ?
```

Hasilnya hanya row `cases`.

Tetapi entity Java mungkin punya association:

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    private Applicant applicant;

    @OneToMany(mappedBy = "caseFile", fetch = FetchType.LAZY)
    private List<CaseDocument> documents = new ArrayList<>();
}
```

Pertanyaan penting:

> Ketika `CaseFile` diload, apakah `applicant` dan `documents` ikut dimaterialisasi?

Jawabannya tergantung:

- mapping default,
- query,
- entity graph,
- provider,
- enhancement/weaving,
- cache,
- persistence context,
- transaction/session state.

---

### 2.2 Fetching Has Two Separate Dimensions

Jangan campur dua hal ini:

| Dimension | Pertanyaan | Contoh |
|---|---|---|
| Fetch timing | Kapan data dimuat? | eager saat load root, lazy saat field diakses |
| Fetch method | Dengan SQL/teknik apa data dimuat? | join, secondary select, batch select, subselect |

Kesalahan umum:

> “EAGER berarti join.”

Tidak selalu.

`EAGER` berarti provider harus memastikan data tersedia. Provider bisa mengambilnya dengan:

- join SQL,
- secondary select,
- batch select,
- cache lookup,
- kombinasi strategi.

Kesalahan lain:

> “LAZY berarti tidak ada SQL tambahan.”

Tidak juga.

`LAZY` biasanya berarti SQL tambahan ditunda sampai access. Jika access terjadi dalam loop, hasilnya bisa N+1.

---

### 2.3 Fetching Is Not Owned by Entity Alone

Annotation pada entity adalah default global.

Namun keputusan fetch yang benar biasanya milik **use case/query**.

Contoh buruk:

```java
@Entity
public class CaseFile {
    @OneToMany(mappedBy = "caseFile", fetch = FetchType.EAGER)
    private List<AuditEntry> auditEntries;
}
```

Kenapa buruk?

Karena setiap kali `CaseFile` diambil, audit entries ikut wajib diambil, bahkan untuk use case yang tidak butuh audit.

Lebih baik:

```java
@OneToMany(mappedBy = "caseFile", fetch = FetchType.LAZY)
private List<AuditEntry> auditEntries;
```

Lalu use case yang butuh audit menentukan fetch plan:

```java
select c
from CaseFile c
left join fetch c.auditEntries
where c.id = :id
```

Atau memakai entity graph.

Rule:

> Entity mapping mendefinisikan possible graph. Query/use case mendefinisikan required graph.

---

## 3. Specification-Level Concept

### 3.1 `FetchType.EAGER` vs `FetchType.LAZY`

Jakarta Persistence mendefinisikan `FetchType` sebagai strategi untuk fetching data.

Makna pentingnya:

- `EAGER` adalah requirement. Provider runtime wajib eagerly fetch data.
- `LAZY` adalah hint. Provider boleh lazy, tetapi juga boleh eager jika tidak bisa/ingin melakukan lazy.

Artinya:

```java
@Basic(fetch = FetchType.LAZY)
private String largeText;
```

Tidak otomatis menjamin `largeText` benar-benar lazy pada semua provider/config.

Konsekuensi engineering:

> Jangan menulis desain kritikal yang bergantung pada `LAZY` sebagai guarantee lintas provider tanpa membuktikan SQL dan runtime behavior.

---

### 3.2 Default Fetch Type by Association

Default JPA/Jakarta Persistence yang sering menjebak:

| Mapping | Default fetch |
|---|---:|
| `@Basic` | EAGER |
| `@ManyToOne` | EAGER |
| `@OneToOne` | EAGER |
| `@OneToMany` | LAZY |
| `@ManyToMany` | LAZY |
| `@ElementCollection` | LAZY |

Default ini historis dan tidak selalu ideal untuk aplikasi modern.

Rekomendasi praktis:

```java
@ManyToOne(fetch = FetchType.LAZY)
private Customer customer;

@OneToOne(fetch = FetchType.LAZY)
private Profile profile;
```

Kenapa?

Karena `ManyToOne` dan `OneToOne` default EAGER bisa membuat graph melebar diam-diam.

Namun ada caveat:

- `ManyToOne LAZY` biasanya mudah diimplementasikan dengan proxy.
- `OneToOne LAZY`, terutama inverse side, sering membutuhkan bytecode enhancement/weaving atau provider-specific support.
- Basic field lazy membutuhkan enhancement/weaving.

---

### 3.3 Entity Graph

Entity graph adalah cara specification-level untuk menentukan fetch plan secara deklaratif pada query/find.

Contoh:

```java
@NamedEntityGraph(
    name = "CaseFile.detail",
    attributeNodes = {
        @NamedAttributeNode("applicant"),
        @NamedAttributeNode("documents")
    }
)
@Entity
public class CaseFile {
    @Id
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    private Applicant applicant;

    @OneToMany(mappedBy = "caseFile", fetch = FetchType.LAZY)
    private List<CaseDocument> documents = new ArrayList<>();
}
```

Pemakaian:

```java
EntityGraph<?> graph = entityManager.getEntityGraph("CaseFile.detail");

CaseFile caseFile = entityManager.find(
    CaseFile.class,
    id,
    Map.of("jakarta.persistence.fetchgraph", graph)
);
```

Ada dua hint penting:

| Hint | Makna umum |
|---|---|
| `fetchgraph` | Attribute dalam graph diperlakukan eager; attribute lain diperlakukan sesuai graph/lebih restriktif |
| `loadgraph` | Attribute dalam graph diperlakukan eager; attribute lain mengikuti mapping default |

Entity graph berguna saat:

- ingin menghindari EAGER global,
- ingin fetch plan per use case,
- ingin tetap berada di standard JPA/Jakarta,
- ingin mengurangi string query `join fetch` yang terlalu banyak.

Tetapi entity graph bukan silver bullet. Provider tetap menentukan SQL aktual.

---

## 4. Provider Mechanisms

Fetching bisa dilakukan dengan beberapa mekanisme internal.

### 4.1 Proxy

Proxy adalah object pengganti yang merepresentasikan entity yang belum diload penuh.

Contoh:

```java
CaseFile caseFile = entityManager.find(CaseFile.class, 10L);
Applicant applicant = caseFile.getApplicant();
```

Jika `applicant` lazy, provider bisa memasukkan proxy:

```text
caseFile.applicant -> Applicant$HibernateProxy(id=5, initialized=false)
```

Saat method selain identifier diakses:

```java
String name = applicant.getName();
```

Provider menjalankan SQL:

```sql
select a.*
from applicant a
where a.id = ?
```

Lalu proxy diinisialisasi.

#### Kelebihan proxy

- Murah saat root entity dimuat.
- Cocok untuk `ManyToOne` karena FK sudah ada di row owner.
- Bisa menunda query sampai benar-benar dibutuhkan.

#### Kekurangan proxy

- Butuh session/entity manager aktif untuk initialize.
- Bisa menyebabkan `LazyInitializationException` di Hibernate.
- Membingungkan `getClass()`, `equals`, serialization, debugger.
- Tidak cocok untuk semua kasus inheritance/polymorphism.
- Tidak selalu cocok dengan final class/method.

---

### 4.2 Collection Wrapper

Untuk collection lazy, provider tidak menaruh `ArrayList` biasa.

Hibernate misalnya memakai persistent collection wrapper seperti konsep:

```text
PersistentBag
PersistentSet
PersistentList
PersistentMap
```

EclipseLink memakai mekanisme indirection/transparent indirection.

Contoh:

```java
List<CaseDocument> documents = caseFile.getDocuments();
```

Awalnya collection bisa belum initialized.

Saat dipakai:

```java
int size = documents.size();
```

Provider bisa menjalankan:

```sql
select d.*
from case_document d
where d.case_id = ?
```

Collection wrapper juga penting untuk dirty checking:

```java
caseFile.getDocuments().add(document);
```

Provider perlu tahu bahwa collection berubah.

---

### 4.3 Bytecode Enhancement

Bytecode enhancement berarti class entity dimodifikasi agar punya kemampuan tambahan.

Hibernate enhancement dapat membantu:

- lazy attribute loading,
- enhanced dirty tracking,
- association management,
- interception pada field access.

Tanpa enhancement, lazy basic field biasanya tidak efektif.

Contoh:

```java
@Lob
@Basic(fetch = FetchType.LAZY)
private String fullText;
```

Di banyak setup, ini tetap bisa ikut diload jika enhancement tidak aktif.

Dengan enhancement, provider bisa intercept access ke field:

```java
caseFile.getFullText(); // baru load column/group tertentu
```

---

### 4.4 EclipseLink Weaving

EclipseLink memakai konsep weaving.

Weaving dapat aktif secara:

- dynamic weaving,
- static weaving.

Weaving mendukung:

- lazy loading,
- change tracking,
- fetch groups,
- internal optimization.

Khusus EclipseLink, lazy `OneToOne` dan `ManyToOne` sangat terkait dengan weaving/value holder indirection.

Jika weaving tidak aktif, behavior lazy tertentu bisa tidak berjalan seperti yang diharapkan.

---

### 4.5 Fetch Group

Fetch group adalah konsep penting terutama di EclipseLink, dan secara konseptual mirip dengan ide bahwa tidak semua attribute entity harus dimuat sekaligus.

Misalnya untuk entity besar:

```java
@Entity
public class DocumentRecord {
    @Id
    private Long id;

    private String title;

    private String mimeType;

    @Lob
    private byte[] content;
}
```

Use case listing hanya butuh:

```text
id, title, mimeType
```

Use case download butuh:

```text
content
```

Fetch group/attribute-level lazy dapat menghindari materialisasi field besar.

Namun harus diuji karena behavior sangat provider/config-dependent.

---

## 5. Hibernate Behavior

### 5.1 Session and Persistence Context

Dalam Hibernate, `EntityManager` biasanya membungkus `Session`.

Fetching lazy membutuhkan session aktif dan persistence context yang mampu menyelesaikan proxy/collection wrapper.

```java
@Transactional
public CaseDto getCase(Long id) {
    CaseFile caseFile = entityManager.find(CaseFile.class, id);
    return mapper.toDto(caseFile); // lazy access aman jika masih dalam transaction/session
}
```

Jika entity keluar dari transaction:

```java
CaseFile caseFile = service.findCase(id); // transaction selesai
caseFile.getDocuments().size();           // lazy access di luar session
```

Hibernate umumnya menghasilkan:

```text
LazyInitializationException
```

Makna sebenarnya:

> Object graph mencoba dimaterialisasi, tetapi loader/session yang dibutuhkan sudah tidak tersedia.

Ini bukan sekadar error teknis. Ini tanda bahwa boundary graph tidak didefinisikan dengan benar.

---

### 5.2 Hibernate Proxy Behavior

Hibernate proxy sering memengaruhi code seperti:

```java
Applicant applicant = caseFile.getApplicant();
System.out.println(applicant.getClass());
```

Yang terlihat mungkin bukan:

```text
class Applicant
```

Tetapi proxy subclass/runtime type.

Karena itu, entity equality harus hati-hati.

Contoh rawan:

```java
@Override
public boolean equals(Object o) {
    if (o == null || getClass() != o.getClass()) return false;
    Applicant that = (Applicant) o;
    return Objects.equals(id, that.id);
}
```

Dengan proxy, `getClass()` dapat berbeda.

Alternatif yang lebih aman perlu mempertimbangkan provider/proxy behavior. Untuk entity, equality sudah dibahas di Part 3, tetapi kaitannya dengan fetching adalah:

> Proxy bukan implementation detail yang selalu invisible; ia bisa bocor ke equality, serialization, logging, dan debugging.

---

### 5.3 Hibernate `getReference`

```java
Applicant applicantRef = entityManager.getReference(Applicant.class, applicantId);

CaseFile caseFile = new CaseFile();
caseFile.setApplicant(applicantRef);
entityManager.persist(caseFile);
```

`getReference` dapat mengembalikan proxy tanpa query awal.

Ini berguna saat kita hanya butuh FK reference untuk association.

Tetapi jika attribute non-id diakses:

```java
applicantRef.getName();
```

Baru provider perlu load entity.

Use case yang baik:

- assign relationship by ID,
- avoid select before insert/update,
- command handler yang hanya butuh referential link.

Risiko:

- jika ID tidak valid, exception bisa muncul terlambat ketika proxy diinitialize atau saat FK constraint flush/commit.

---

### 5.4 Hibernate Lazy Basic Fields

Hibernate dapat mendukung lazy basic attribute dengan bytecode enhancement.

Contoh:

```java
@Lob
@Basic(fetch = FetchType.LAZY)
private String serializedPayload;
```

Tetapi jangan mengandalkan annotation ini tanpa memastikan:

1. Enhancement aktif di build/test/runtime.
2. SQL root load tidak mengambil column besar.
3. Access field memang memicu secondary select yang terkontrol.
4. Serialization tidak membaca field tersebut diam-diam.

Praktik yang sering lebih tegas:

Pisahkan table besar:

```text
case_audit_entry
- id
- case_id
- activity
- created_at

case_audit_payload
- audit_entry_id
- serialized_payload
- full_text
```

Lalu mapping sebagai association lazy atau query khusus.

Kenapa?

Karena desain table terpisah lebih eksplisit dibanding berharap lazy basic field selalu bekerja sempurna di semua provider/config.

---

### 5.5 Hibernate Load Plan

Load plan adalah rencana internal provider tentang graph mana yang akan dimuat dan bagaimana.

Load plan dipengaruhi oleh:

- mapping fetch type,
- query join fetch,
- entity graph,
- fetch profile,
- batch size,
- subselect fetch,
- second-level cache,
- already-managed entities.

Misalnya query:

```java
select c
from CaseFile c
join fetch c.applicant
where c.id = :id
```

Provider harus memuat `CaseFile` dan `Applicant` dalam satu query.

Namun untuk `documents`, jika tidak disebutkan, association tetap mengikuti mapping/default/hints lain.

---

## 6. EclipseLink Behavior

### 6.1 Indirection

EclipseLink memakai konsep indirection untuk lazy relationship.

Untuk collection, lazy loading menggunakan transparent indirection.

Untuk `OneToOne` dan `ManyToOne`, lazy behavior sering membutuhkan weaving.

Mental model:

```text
Entity field -> value holder / indirection object -> actual target loaded when needed
```

Artinya, seperti Hibernate proxy, ada object/mekanisme perantara.

---

### 6.2 Weaving Requirement

Jika memakai EclipseLink di Java SE atau setup non-container tertentu, weaving harus dikonfigurasi dengan benar.

Jika weaving tidak aktif:

- lazy `ManyToOne` bisa tidak lazy,
- lazy `OneToOne` bisa tidak lazy,
- fetch group/change tracking optimization bisa tidak aktif,
- behavior berbeda antara local test dan app server.

Ini salah satu alasan kenapa provider comparison harus diuji dengan SQL actual, bukan asumsi annotation.

---

### 6.3 Shared Cache Interaction

EclipseLink punya shared cache yang kuat sebagai bagian dari arsitekturnya.

Lazy access bisa berinteraksi dengan shared cache. Dalam beberapa konfigurasi, object yang sudah ada di cache dapat membuat lazy access terasa “tidak query”.

Ini bisa bagus untuk performance, tetapi berbahaya untuk mental model:

> “Tidak ada SQL di test” bukan berarti fetch plan benar; bisa jadi data datang dari cache.

Saat mendiagnosis fetching, pisahkan:

- first-level cache,
- shared/second-level cache,
- database query.

---

### 6.4 Fetch Groups

EclipseLink fetch group memungkinkan subset attributes dimuat.

Ini kuat untuk entity besar, tetapi juga meningkatkan complexity:

- attribute mana yang loaded?
- apakah access attribute memicu lazy load?
- apakah entity partial aman untuk update?
- apakah serialization mengakses attribute yang belum loaded?

Rule:

> Partial entity loading harus dipakai dengan disiplin use case yang jelas, bukan default random optimization.

---

## 7. Fetching Patterns

### 7.1 Pattern: Default Lazy, Explicit Fetch Per Use Case

Mapping:

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Applicant applicant;

    @OneToMany(mappedBy = "caseFile", fetch = FetchType.LAZY)
    private List<CaseDocument> documents = new ArrayList<>();
}
```

Query untuk detail screen:

```java
select c
from CaseFile c
join fetch c.applicant
where c.id = :id
```

Query untuk document tab:

```java
select d
from CaseDocument d
where d.caseFile.id = :caseId
order by d.createdAt desc
```

Kenapa document tidak selalu fetch join dari `CaseFile`?

Karena tab document mungkin punya pagination/filter/security check sendiri.

---

### 7.2 Pattern: DTO Projection for Read-Heavy Listing

Listing case biasanya tidak perlu entity graph penuh.

Buruk:

```java
List<CaseFile> cases = entityManager.createQuery("""
    select c
    from CaseFile c
    order by c.createdAt desc
""", CaseFile.class).getResultList();

return cases.stream()
    .map(c -> new CaseListItem(
        c.getId(),
        c.getReferenceNo(),
        c.getApplicant().getName(),
        c.getStatus()
    ))
    .toList();
```

Potensi N+1 pada `applicant`.

Lebih tegas:

```java
List<CaseListItem> result = entityManager.createQuery("""
    select new com.example.CaseListItem(
        c.id,
        c.referenceNo,
        a.name,
        c.status
    )
    from CaseFile c
    join c.applicant a
    order by c.createdAt desc
""", CaseListItem.class).getResultList();
```

Untuk read model/listing, DTO projection sering lebih baik daripada entity fetching.

---

### 7.3 Pattern: `getReference` for Command Association

Command:

```java
public void assignOfficer(Long caseId, Long officerId) {
    CaseFile caseFile = entityManager.find(CaseFile.class, caseId);
    Officer officer = entityManager.getReference(Officer.class, officerId);
    caseFile.assignTo(officer);
}
```

Jika business rule tidak butuh load detail officer, `getReference` menghindari select officer.

Namun jika perlu validasi officer aktif:

```java
Officer officer = entityManager.find(Officer.class, officerId);
if (!officer.isActive()) {
    throw new IllegalStateException("Officer is inactive");
}
caseFile.assignTo(officer);
```

Rule:

> Pakai `getReference` saat hanya butuh identity/FK. Pakai `find`/query saat butuh state untuk rule.

---

### 7.4 Pattern: Split Heavy Content from Metadata

Buruk:

```java
@Entity
public class AuditEntry {
    @Id
    private Long id;

    private String activity;

    @Lob
    private String serializedChanges;

    @Lob
    private String fullText;
}
```

Jika listing audit sering mengambil entity ini, field LOB bisa membebani load.

Lebih eksplisit:

```java
@Entity
public class AuditEntry {
    @Id
    private Long id;

    private String activity;

    private Instant createdAt;

    @OneToOne(mappedBy = "auditEntry", fetch = FetchType.LAZY)
    private AuditEntryPayload payload;
}

@Entity
public class AuditEntryPayload {
    @Id
    private Long id;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY)
    private AuditEntry auditEntry;

    @Lob
    private String serializedChanges;

    @Lob
    private String fullText;
}
```

Ini membuat fetch boundary lebih jelas.

---

## 8. Anti-Patterns

### 8.1 EAGER Everywhere

```java
@ManyToOne(fetch = FetchType.EAGER)
private Applicant applicant;

@OneToMany(fetch = FetchType.EAGER)
private List<Document> documents;
```

Masalah:

- semua use case membayar cost graph terbesar,
- query sulit diprediksi,
- provider bisa menghasilkan banyak secondary select,
- pagination rentan rusak,
- memory membengkak,
- circular eager graph bisa sangat berat.

Rule:

> EAGER pada association harus dianggap sebagai global coupling. Gunakan hanya jika association benar-benar bagian intrinsic dan selalu dibutuhkan.

---

### 8.2 Returning Entities Directly from API

```java
@GetMapping("/cases/{id}")
public CaseFile getCase(@PathVariable Long id) {
    return service.findCase(id);
}
```

Masalah:

- JSON serializer bisa access lazy fields.
- Bidirectional association bisa infinite recursion.
- Lazy access bisa terjadi setelah transaction selesai.
- Internal persistence model bocor ke API contract.
- Security/mass exposure risk.

Lebih aman:

```java
@GetMapping("/cases/{id}")
public CaseDetailResponse getCase(@PathVariable Long id) {
    return service.getCaseDetail(id);
}
```

Service menentukan fetch plan dan mapping DTO.

---

### 8.3 Open Session in View as Permanent Crutch

Open Session in View memungkinkan lazy loading selama rendering view/API serialization.

Ini sering “memperbaiki” `LazyInitializationException`, tetapi sebenarnya memindahkan query decision ke layer terluar secara implicit.

Risiko:

- query terjadi saat JSON serialization,
- transaction sudah selesai tetapi session masih terbuka,
- N+1 tersembunyi,
- endpoint performance tidak stabil,
- database access terjadi di luar service boundary.

OSIV bisa diterima untuk aplikasi sederhana/admin internal tertentu, tetapi berbahaya sebagai default enterprise API.

Rule:

> Jangan jadikan OSIV sebagai pengganti fetch plan design.

---

### 8.4 Using `toString`, Logging, or Debugger That Touches Lazy Graph

Buruk:

```java
@Override
public String toString() {
    return "CaseFile{" +
        "id=" + id +
        ", applicant=" + applicant +
        ", documents=" + documents +
        '}';
}
```

Masalah:

- logging dapat memicu lazy load,
- debugger watch dapat initialize association,
- Lombok `@ToString` bisa sangat berbahaya,
- recursive graph bisa stack overflow.

Lebih aman:

```java
@Override
public String toString() {
    return "CaseFile{id=" + id + ", referenceNo='" + referenceNo + "'}";
}
```

---

### 8.5 Business Logic That Accidentally Traverses Huge Graph

```java
public boolean hasPendingDocument() {
    return documents.stream().anyMatch(Document::isPending);
}
```

Jika `documents` lazy dan jumlahnya besar, method domain sederhana ini bisa memicu full collection load.

Alternatif untuk large collection:

```java
select count(d)
from Document d
where d.caseFile.id = :caseId
and d.status = :pending
```

Rule:

> Domain method yang menavigasi collection harus sadar cardinality.

---

## 9. SQL Shape Examples

### 9.1 Lazy `ManyToOne`

Entity:

```java
@ManyToOne(fetch = FetchType.LAZY)
private Applicant applicant;
```

Root load:

```sql
select c.id, c.applicant_id, c.status
from case_file c
where c.id = ?
```

Access applicant:

```java
caseFile.getApplicant().getName();
```

SQL tambahan:

```sql
select a.id, a.name
from applicant a
where a.id = ?
```

---

### 9.2 Join Fetch

```java
select c
from CaseFile c
join fetch c.applicant
where c.id = :id
```

SQL konseptual:

```sql
select c.*, a.*
from case_file c
join applicant a on a.id = c.applicant_id
where c.id = ?
```

Hasil:

- `CaseFile` initialized.
- `Applicant` initialized.
- Tidak perlu lazy select untuk applicant.

---

### 9.3 Lazy Collection

Root load:

```sql
select c.*
from case_file c
where c.id = ?
```

Access documents:

```java
caseFile.getDocuments().size();
```

SQL:

```sql
select d.*
from case_document d
where d.case_id = ?
```

Jika dilakukan untuk 100 case dalam loop, bisa menjadi 101 query.

---

### 9.4 Collection Join Fetch

```java
select distinct c
from CaseFile c
left join fetch c.documents
where c.id = :id
```

SQL konseptual:

```sql
select c.*, d.*
from case_file c
left join case_document d on d.case_id = c.id
where c.id = ?
```

Jika case punya 50 documents, result set punya 50 rows untuk 1 root entity. Provider collapse rows menjadi 1 `CaseFile` dengan 50 documents.

Ini bagus untuk satu root detail, tetapi berbahaya untuk banyak root + pagination.

---

## 10. Fetching and Pagination

Pagination + collection fetch join adalah kombinasi berbahaya.

Contoh:

```java
select c
from CaseFile c
left join fetch c.documents
order by c.createdAt desc
```

Lalu:

```java
query.setFirstResult(0);
query.setMaxResults(20);
```

Masalah:

Database melakukan pagination pada row result, bukan root entity logical.

Jika satu case punya 30 documents, 20 row pertama bisa hanya mewakili satu case.

Provider mungkin:

- menolak,
- memberi warning,
- melakukan pagination in-memory,
- menghasilkan hasil yang tidak sesuai ekspektasi.

Strategi aman:

1. Query page root IDs.
2. Fetch graph untuk IDs tersebut.

Contoh tahap 1:

```java
List<Long> ids = entityManager.createQuery("""
    select c.id
    from CaseFile c
    order by c.createdAt desc
""", Long.class)
.setFirstResult(offset)
.setMaxResults(limit)
.getResultList();
```

Tahap 2:

```java
List<CaseFile> cases = entityManager.createQuery("""
    select distinct c
    from CaseFile c
    left join fetch c.documents
    where c.id in :ids
""", CaseFile.class)
.setParameter("ids", ids)
.getResultList();
```

Lalu reorder di memory sesuai urutan IDs jika perlu.

---

## 11. Fetching and Transaction Boundary

Lazy loading membutuhkan provider context.

Dalam service boundary:

```java
@Transactional
public CaseDetailResponse getDetail(Long id) {
    CaseFile c = repository.findDetail(id);
    return mapper.toResponse(c);
}
```

Ini aman jika `findDetail` mengambil semua data yang mapper butuhkan.

Tidak aman:

```java
public CaseFile getCase(Long id) {
    return repository.findById(id);
}

// Controller/serializer later accesses lazy fields
```

Rule:

> Jangan mengembalikan entity managed/detached sebagai kontrak keluar service jika graph belum didefinisikan.

Boundary yang sehat:

```text
Controller
  -> Service transaction starts
     -> Query with explicit fetch plan
     -> Entity used inside transaction
     -> DTO created inside transaction
  -> Service transaction ends
Controller returns DTO
```

---

## 12. Fetching and Serialization

JSON serialization dapat menyentuh getter.

Contoh:

```java
public class CaseFile {
    public Applicant getApplicant() { return applicant; }
    public List<Document> getDocuments() { return documents; }
}
```

Serializer bisa memanggil semua getter yang visible.

Akibat:

- lazy association initialized,
- N+1 saat serialize list,
- recursive graph,
- exposure data sensitif,
- exception di luar transaction.

Solusi:

- pakai DTO response,
- `@JsonIgnore` hanya sebagai guard, bukan arsitektur utama,
- hindari entity sebagai API schema,
- mapping DTO dilakukan di transaction boundary dengan fetch plan jelas.

---

## 13. Fetching and Domain Modeling

Association di entity bukan berarti harus selalu dinavigasi.

Untuk aggregate kecil:

```java
caseFile.getDecision().approve(...)
```

Mungkin wajar.

Untuk aggregate besar:

```java
caseFile.getAllAuditEntries().stream()...
```

Mungkin salah desain.

Prinsip:

1. Association navigability harus mengikuti aggregate boundary.
2. Large historical data jangan dijadikan collection yang sering dinavigasi dari root.
3. Query model bisa lebih cocok daripada object graph untuk read-heavy use case.
4. Command model dan read model tidak harus memakai fetch shape yang sama.

Dalam regulatory/case management system, association seperti ini perlu hati-hati:

- case → audit trail,
- case → correspondence,
- case → documents,
- case → assignment history,
- case → state transition history,
- application → screening results,
- officer → all assigned cases.

Semua ini berpotensi high-cardinality.

High-cardinality association sebaiknya jarang dijadikan collection yang otomatis di-fetch dari aggregate root.

---

## 14. Provider-Specific Notes Across Java 8–25

### 14.1 Java 8 Line

Umum ditemukan:

- JPA 2.1/2.2,
- `javax.persistence`,
- Hibernate 5.x,
- EclipseLink 2.x,
- Java EE/Jakarta transition belum terjadi.

Risiko:

- legacy default EAGER banyak tersebar,
- old Hibernate proxy behavior,
- old bytecode enhancement setup,
- old app server weaving behavior,
- migration ke `jakarta.persistence` belum dilakukan.

---

### 14.2 Java 11/17 Line

Umum ditemukan:

- Spring Boot 2.x/3.x transition,
- Hibernate 5.6 → 6.x,
- javax → jakarta migration,
- modularity/classpath issues mulai terasa.

Perhatikan:

- dependency campur `javax` dan `jakarta`,
- query behavior berubah di Hibernate 6,
- dialect changes,
- bytecode enhancement plugin version.

---

### 14.3 Java 21/25 Line

Modern baseline:

- Jakarta Persistence 3.x,
- Hibernate 6/7,
- EclipseLink 4.x,
- Java records/virtual threads/context propagation mungkin hadir di aplikasi, tetapi entity tetap class mutable normal pada umumnya.

Perhatikan:

- jangan menjadikan entity sebagai record,
- lazy loading tetap butuh context/session,
- virtual threads tidak memperbaiki N+1,
- structured concurrency tidak mengganti transaction boundary,
- AOT/native image dapat memengaruhi proxy/enhancement/reflection.

Rule:

> Runtime Java modern tidak menghapus biaya ORM. Ia hanya mengubah platform tempat biaya itu terjadi.

---

## 15. Diagnostic Checklist

Saat ada masalah fetching, jawab pertanyaan ini:

### 15.1 Mapping

- Association mana yang `EAGER`?
- Association mana yang `LAZY` tapi ternyata tetap diload?
- Apakah `ManyToOne`/`OneToOne` sudah eksplisit `LAZY`?
- Apakah lazy basic field butuh enhancement/weaving?
- Apakah high-cardinality collection dimodelkan sebagai navigable collection?

### 15.2 Query

- Query root entity apa?
- Apakah ada `join fetch`?
- Apakah ada entity graph?
- Apakah fetch plan berbeda antara list dan detail?
- Apakah pagination digabung dengan collection fetch join?

### 15.3 Runtime

- Apakah persistence context masih aktif saat lazy access?
- Apakah OSIV aktif?
- Apakah serializer menyentuh getter?
- Apakah cache membuat SQL tidak terlihat?
- Apakah test dan production punya enhancement/weaving sama?

### 15.4 SQL

- Berapa jumlah query untuk satu request?
- Apakah ada select per row?
- Apakah join menghasilkan row explosion?
- Apakah column LOB ikut terambil?
- Apakah query plan memakai index yang benar?

### 15.5 Memory

- Berapa entity yang dihydrate?
- Berapa collection yang initialized?
- Apakah persistence context membesar selama request/job?
- Apakah DTO projection bisa mengurangi object graph?

---

## 16. Design Rules

1. Default-kan association ke `LAZY`, terutama `ManyToOne` dan `OneToOne`, kecuali ada alasan kuat.
2. Jangan memakai EAGER untuk “menghindari LazyInitializationException”. Itu biasanya menukar exception jelas dengan performa buruk tersembunyi.
3. Fetch plan harus dimiliki oleh use case/query, bukan dibiarkan global di entity mapping.
4. Jangan return entity langsung dari API.
5. Jangan mengandalkan OSIV sebagai arsitektur fetch plan.
6. Untuk listing/read-heavy screen, pertimbangkan DTO projection.
7. Untuk detail screen satu aggregate kecil, join fetch/entity graph bisa tepat.
8. Untuk high-cardinality child, query child secara eksplisit dengan pagination/filter.
9. Untuk field besar/LOB, pertimbangkan table split daripada hanya `@Basic(LAZY)`.
10. Selalu lihat SQL aktual.
11. Selalu test jumlah query untuk endpoint penting.
12. Selalu bedakan root entity count dan result row count.
13. Jangan percaya behavior lazy lintas provider tanpa verifikasi.
14. Enhancement/weaving harus konsisten antara test, local, CI, dan production.
15. Proxy behavior harus dipertimbangkan dalam equality, serialization, logging, dan debugging.

---

## 17. Practice Scenarios

### Scenario 1 — Case Listing Lambat

Endpoint:

```text
GET /cases?page=0&size=20
```

DTO butuh:

- case id,
- reference no,
- applicant name,
- status,
- created date.

Entity:

```java
@ManyToOne(fetch = FetchType.LAZY)
private Applicant applicant;
```

Mapper:

```java
new CaseListItem(
    c.getId(),
    c.getReferenceNo(),
    c.getApplicant().getName(),
    c.getStatus(),
    c.getCreatedAt()
)
```

Problem:

- 1 query load 20 cases.
- 20 query load applicants.

Better:

- DTO projection join applicant.
- Or join fetch applicant if returning entity to mapper inside transaction.

Preferred for listing:

```java
select new CaseListItem(c.id, c.referenceNo, a.name, c.status, c.createdAt)
from CaseFile c
join c.applicant a
order by c.createdAt desc
```

---

### Scenario 2 — Detail Screen Butuh Applicant dan Documents

Use case detail butuh:

- case,
- applicant,
- documents.

Approach:

```java
select distinct c
from CaseFile c
join fetch c.applicant
left join fetch c.documents
where c.id = :id
```

Ini bisa wajar karena root hanya satu case.

Tetapi jika documents sangat banyak, lebih baik:

1. Load case + applicant.
2. Load documents dengan pagination/tab query.

---

### Scenario 3 — LazyInitializationException di Controller

Service:

```java
@Transactional
public CaseFile findCase(Long id) {
    return entityManager.find(CaseFile.class, id);
}
```

Controller:

```java
return service.findCase(id);
```

Serializer access `documents` setelah transaction selesai.

Solusi sehat:

```java
@Transactional
public CaseDetailResponse getCaseDetail(Long id) {
    CaseFile c = repository.findDetail(id);
    return mapper.toDetailResponse(c);
}
```

Return DTO, bukan entity.

---

### Scenario 4 — LOB Field Ikut Terambil Saat Listing

Entity:

```java
@Lob
@Basic(fetch = FetchType.LAZY)
private String fullText;
```

SQL ternyata tetap select `full_text`.

Kemungkinan:

- enhancement tidak aktif,
- provider tidak mendukung lazy basic sesuai setup,
- query projection mengambil entity penuh.

Solusi:

- aktifkan/test enhancement,
- gunakan DTO projection listing,
- split LOB ke table lain,
- query explicit columns.

---

### Scenario 5 — Debug Logging Memicu Query

Lombok:

```java
@Data
@Entity
public class CaseFile {
    @OneToMany(mappedBy = "caseFile")
    private List<Document> documents;
}
```

`@Data` menghasilkan `toString`, `equals`, `hashCode` yang bisa menyentuh association.

Solusi:

- jangan pakai `@Data` pada entity,
- exclude association dari `toString`,
- implement equality secara hati-hati,
- logging hanya identifier/stable scalar.

---

## 18. Top 1% Mental Model

Engineer biasa bertanya:

> “Ini harus LAZY atau EAGER?”

Engineer kuat bertanya:

> “Use case ini membutuhkan graph apa, pada boundary apa, dengan SQL shape apa, dan bagaimana saya membuktikan bahwa provider benar-benar mengambil data sesuai rencana?”

Engineer biasa melihat annotation.

Engineer kuat melihat:

- mapping,
- query,
- provider mechanism,
- persistence context,
- transaction boundary,
- SQL count,
- row count,
- object allocation,
- serialization path,
- cache interaction,
- production observability.

Fetching bukan optimisasi kecil. Fetching adalah desain kontrak antara use case dan database work.

---

## 19. Summary

Fetching adalah proses materialisasi object graph dari relational data. `LAZY` dan `EAGER` hanya permukaan. Di bawahnya ada proxy, collection wrapper, bytecode enhancement, weaving, entity graph, join fetch, fetch group, load plan, cache, dan transaction boundary.

Poin paling penting:

1. `EAGER` adalah requirement; `LAZY` adalah hint.
2. Default `ManyToOne` dan `OneToOne` adalah EAGER, tetapi sering sebaiknya dibuat explicit LAZY.
3. Lazy loading membutuhkan provider context aktif.
4. Proxy dan wrapper dapat bocor ke equality, logging, debugging, dan serialization.
5. Entity graph dan join fetch adalah cara menentukan fetch plan per use case.
6. Collection fetch join berbahaya dengan pagination.
7. DTO projection sering lebih tepat untuk listing/read-heavy endpoint.
8. High-cardinality association perlu query eksplisit, bukan navigasi graph sembarangan.
9. Lazy basic/LOB membutuhkan enhancement/weaving dan tetap harus diverifikasi.
10. SQL aktual adalah sumber kebenaran, bukan annotation.

Part berikutnya akan membahas N+1, cartesian explosion, dan fetch plan engineering secara lebih taktis dan mendalam.

---

## 20. References

- Jakarta Persistence 3.2 Specification — persistence and object/relational mapping standard.
- Jakarta Persistence `FetchType` API documentation — defines `EAGER` as requirement and `LAZY` as hint.
- Jakarta EE Tutorial — Entity Graphs and fetch plan usage.
- Hibernate ORM User Guide — fetching, proxies, lazy loading, bytecode enhancement, entity graphs.
- Hibernate ORM 7 Introduction — proxies, lazy fetching, entity graphs, eager fetching.
- EclipseLink Documentation — weaving, indirection, fetch groups, lazy relationship behavior.
- EclipseLink 4.0 Solutions and JPA Extensions documentation — weaving and advanced provider capabilities.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 13 — Embeddables, Value Objects, Attribute Converters, and Type Systems](./13-embeddables-value-objects-converters-type-systems.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 15 — N+1, Cartesian Explosion, and Fetch Plan Engineering](./15-n-plus-one-cartesian-explosion-fetch-plan-engineering.md)

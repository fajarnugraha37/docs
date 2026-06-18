# Part 15 — N+1, Cartesian Explosion, and Fetch Plan Engineering

> Series: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `15-n-plus-one-cartesian-explosion-fetch-plan-engineering.md`  
> Scope: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4  
> Goal: membangun kemampuan engineering untuk mendesain fetch plan yang benar, stabil, dan performant; bukan sekadar menghafal `JOIN FETCH`.

---

## 0. Executive Summary

N+1 bukan sekadar “Hibernate lambat”. N+1 adalah gejala bahwa **object graph yang dibutuhkan oleh use case tidak sama dengan graph yang dimaterialisasi oleh fetch plan**.

Cartesian explosion bukan sekadar “join fetch terlalu banyak”. Cartesian explosion adalah gejala bahwa kita mencoba memuat beberapa relasi multiplicative dalam satu result set relational, lalu berharap ORM bisa mengubahnya menjadi object graph tanpa biaya besar.

Keduanya adalah dua sisi dari masalah yang sama:

```text
N+1 problem:
  terlalu sedikit data dibawa per round trip
  -> banyak query kecil
  -> latency + connection pressure + DB parse/execute overhead

Cartesian explosion:
  terlalu banyak graph dibawa dalam satu joined rowset
  -> row multiplication
  -> memory pressure + network payload + duplicate hydration + broken pagination
```

Top-tier persistence engineer tidak bertanya:

> “Harus LAZY atau EAGER?”

Tetapi bertanya:

> “Untuk use case ini, graph apa yang benar-benar dibutuhkan, berapa cardinality setiap edge, bagaimana query shape-nya, bagaimana pagination-nya, bagaimana concurrency/data freshness-nya, dan bagaimana kita membuktikan SQL count + row count + memory cost-nya?”

---

## 1. Why This Matters

ORM memungkinkan kita berpikir dalam object graph:

```java
caseFile.getApplicant().getName();
caseFile.getDocuments().size();
caseFile.getTasks().forEach(...);
```

Database bekerja dengan relational set:

```sql
select ... from case_file where ...;
select ... from applicant where id = ?;
select ... from document where case_file_id = ?;
select ... from task where case_file_id = ?;
```

Fetch plan adalah jembatan antara keduanya.

Kalau fetch plan buruk, aplikasi enterprise bisa gagal walaupun:

- entity mapping terlihat benar,
- transaction boundary terlihat benar,
- index database sudah ada,
- repository method sederhana,
- unit test lulus,
- endpoint hanya mengambil 20 row.

Contoh production symptom:

```text
Endpoint: GET /cases?status=PENDING&page=0&size=20
Expected:
  1 query count
  1 query page cases
  maybe 1–3 queries for supporting data

Actual:
  1 query cases
  20 queries applicant
  20 queries assignedOfficer
  20 queries currentTask
  20 queries latestDecision
  20 queries documents
  20 queries tags
  total: 141 queries
```

Atau kebalikannya:

```text
Developer melihat 141 queries, lalu “memperbaiki” dengan join fetch semua.

Actual SQL rowset:
  20 cases
  each case has 10 documents
  each case has 5 tasks
  each case has 4 notes

Joined rows:
  20 * 10 * 5 * 4 = 4,000 rows

Kalau ada relasi lain:
  20 * 10 * 5 * 4 * 6 = 24,000 rows
```

Endpoint masih lambat, tetapi penyebabnya berubah dari **too many queries** menjadi **too many rows**.

---

## 2. Core Mental Model: Fetch Plan Is a Query Shape Contract

Fetch plan menentukan:

1. Entity root apa yang dimuat.
2. Association mana yang dimuat bersama root.
3. Association mana yang dibiarkan lazy.
4. Association mana yang akan dimuat dengan query tambahan secara batch.
5. Berapa banyak SQL round trip yang terjadi.
6. Berapa banyak row relational yang dikirim database.
7. Berapa banyak object Java yang dihydrate.
8. Berapa besar persistence context setelah operasi selesai.
9. Apakah pagination masih benar.
10. Apakah hasil query stabil terhadap pertumbuhan cardinality.

Fetch plan bukan annotation semata.

Fetch plan bisa berasal dari:

- static mapping: `fetch = FetchType.LAZY/EAGER`,
- JPQL/HQL `join fetch`,
- Criteria fetch,
- entity graph,
- provider hints,
- Hibernate `@BatchSize`, `@Fetch`, fetch profile,
- EclipseLink `@BatchFetch`, `@JoinFetch`, fetch group,
- explicit DTO query,
- native SQL,
- application-layer preloading strategy.

Mental model:

```text
Use case
  -> required read model
  -> root query
  -> edge cardinality
  -> fetch strategy per edge
  -> SQL count + row count + memory estimate
  -> test/observe
```

Jangan mulai dari annotation. Mulai dari use case.

---

## 3. N+1 Problem: Definition and Mechanics

N+1 terjadi ketika:

1. Aplikasi mengambil N parent row.
2. Untuk setiap parent, aplikasi mengakses association lazy.
3. Provider menjalankan satu query tambahan per parent atau per association access.

Contoh model:

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    private String referenceNo;

    @ManyToOne(fetch = FetchType.LAZY)
    private Applicant applicant;

    @OneToMany(mappedBy = "caseFile", fetch = FetchType.LAZY)
    private List<Document> documents = new ArrayList<>();
}
```

Kode:

```java
List<CaseFile> cases = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
    order by c.createdAt desc
    """, CaseFile.class)
    .setParameter("status", CaseStatus.PENDING)
    .setMaxResults(20)
    .getResultList();

for (CaseFile c : cases) {
    System.out.println(c.getApplicant().getName());
}
```

SQL shape umum:

```sql
-- 1 query
select c.*
from case_file c
where c.status = ?
order by c.created_at desc
fetch first 20 rows only;

-- N queries
select a.* from applicant a where a.id = ?;
select a.* from applicant a where a.id = ?;
select a.* from applicant a where a.id = ?;
...
```

Kalau 20 parent, ini 21 query. Kalau ada 5 lazy association diakses, bisa menjadi 101 query atau lebih.

### 3.1 N+1 tidak selalu terlihat di unit test

N+1 sering lolos karena:

- test hanya memakai 1 parent row,
- test berjalan di H2/in-memory DB,
- test memakai transaction yang sama sehingga lazy loading masih berhasil,
- logging SQL tidak aktif,
- assertion hanya memeriksa data benar, bukan query count,
- dataset kecil sehingga latency tidak terlihat,
- local DB tidak punya network latency seperti production.

### 3.2 N+1 bukan hanya collection problem

N+1 bisa terjadi pada:

- `@ManyToOne`,
- `@OneToOne`,
- `@OneToMany`,
- `@ManyToMany`,
- `@ElementCollection`,
- lazy basic attribute dengan enhancement,
- secondary table,
- entity graph yang kurang lengkap,
- mapper DTO yang menyentuh lazy association.

Banyak developer mengira N+1 hanya muncul pada `@OneToMany`. Ini salah. Bahkan `@ManyToOne` bisa menjadi sumber N+1 yang paling sering di listing page.

---

## 4. Cartesian Explosion: Definition and Mechanics

Cartesian explosion terjadi ketika query join memuat beberapa relasi dengan cardinality lebih dari satu, menyebabkan jumlah row hasil menjadi perkalian kombinasi child.

Model:

```text
CaseFile 1 --- N Document
CaseFile 1 --- N Task
CaseFile 1 --- N Note
```

Query:

```java
select distinct c
from CaseFile c
left join fetch c.documents
left join fetch c.tasks
left join fetch c.notes
where c.status = :status
```

Kalau satu case punya:

```text
10 documents
5 tasks
4 notes
```

Satu `CaseFile` bisa menghasilkan:

```text
10 * 5 * 4 = 200 rows
```

Untuk 20 cases:

```text
20 * 200 = 4,000 rows
```

Padahal object graph akhirnya mungkin hanya:

```text
20 CaseFile
200 Document
100 Task
80 Note
```

Masalahnya, database harus mengirim row kombinasi. Provider harus membaca duplicate root, duplicate document, duplicate task, duplicate note, lalu deduplicate ke persistence context/collection.

### 4.1 `distinct` tidak menghilangkan biaya utama

JPQL `select distinct c` membantu menghilangkan duplicate root entity di hasil Java. Tetapi rowset SQL tetap bisa besar.

Pada sebagian provider/version/config, `distinct` bisa diteruskan ke SQL. Pada sebagian kasus, deduplication terjadi di memory. Bahkan kalau SQL `distinct` dipakai, row berbeda karena kolom child berbeda tetap tidak hilang.

Jangan mengira `distinct` menyelesaikan cartesian explosion.

### 4.2 Cartesian explosion sering lebih buruk daripada N+1

N+1 buruk karena banyak round trip.

Cartesian explosion buruk karena:

- row count membengkak,
- network payload besar,
- DB sort/hash/join cost naik,
- app memory naik,
- GC pressure naik,
- persistence context membesar,
- pagination rusak,
- result deduplication mahal,
- DB CPU bisa melonjak.

Kadang 100 query kecil lebih murah daripada 1 query join yang menghasilkan jutaan row. Kadang sebaliknya. Engineer harus mengukur dan memperkirakan cardinality.

---

## 5. Fetch Strategy Taxonomy

Tidak ada satu strategi fetch yang selalu benar. Pilihan utama:

1. Lazy default.
2. Join fetch.
3. Batch fetch.
4. Subselect fetch.
5. Entity graph.
6. Fetch profile/provider-specific plan.
7. DTO projection.
8. Two-step query.
9. Native/read-model query.
10. Explicit application loading.

---

## 6. Strategy 1 — Lazy Default

Lazy default berarti association tidak dimuat sampai diakses.

Untuk JPA/Jakarta Persistence:

```java
@ManyToOne(fetch = FetchType.LAZY)
private Applicant applicant;

@OneToMany(mappedBy = "caseFile", fetch = FetchType.LAZY)
private List<Document> documents;
```

Penting:

- `@OneToMany` dan `@ManyToMany` default-nya LAZY.
- `@ManyToOne` dan `@OneToOne` default-nya EAGER menurut JPA.
- Dalam praktik enterprise, banyak tim menetapkan semua association sebagai LAZY secara eksplisit lalu fetch per use case.

Contoh:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "applicant_id", nullable = false)
private Applicant applicant;
```

### 6.1 Kelebihan lazy default

- Menghindari global over-fetching.
- Mapping tidak memaksakan graph untuk semua use case.
- Lebih mudah membuat fetch plan spesifik query.
- Mengurangi risiko loading graph besar tanpa sadar.

### 6.2 Risiko lazy default

- N+1 kalau lazy association diakses dalam loop.
- `LazyInitializationException` kalau persistence context sudah tertutup.
- Serialization trap kalau entity langsung dikembalikan sebagai JSON.
- Mapper bisa diam-diam memicu query.
- Debugger/toString/logging bisa memicu lazy loading.

### 6.3 Rule

Lazy default adalah baseline yang baik, tetapi bukan solusi lengkap. Ia harus dipasangkan dengan fetch plan eksplisit di query use case.

---

## 7. Strategy 2 — Join Fetch

Join fetch memuat association dalam SQL query yang sama.

JPQL:

```java
select c
from CaseFile c
join fetch c.applicant
where c.status = :status
order by c.createdAt desc
```

SQL shape:

```sql
select c.*, a.*
from case_file c
join applicant a on a.id = c.applicant_id
where c.status = ?
order by c.created_at desc;
```

### 7.1 Join fetch ideal untuk to-one

Join fetch sangat cocok untuk:

- `@ManyToOne`,
- `@OneToOne`,
- small mandatory reference,
- lookup/reference data,
- parent-to-current-state association,
- association yang hampir selalu dibutuhkan di use case itu.

Kenapa?

Karena to-one tidak mengalikan row root secara signifikan.

```text
20 cases + applicant
=> tetap sekitar 20 rows
```

Contoh listing case:

```java
select c
from CaseFile c
join fetch c.applicant a
left join fetch c.assignedOfficer o
where c.status = :status
order by c.createdAt desc
```

Ini biasanya masuk akal karena `applicant` dan `assignedOfficer` adalah to-one.

### 7.2 Join fetch berbahaya untuk multiple to-many

Join fetch satu small collection kadang masih masuk akal.

Join fetch beberapa collection biasanya bahaya.

```java
select distinct c
from CaseFile c
left join fetch c.documents
left join fetch c.tasks
left join fetch c.notes
where c.id in :ids
```

Problem:

```text
rows = cases * avg(documents) * avg(tasks) * avg(notes)
```

### 7.3 Pagination with collection join fetch

Pagination + collection join fetch adalah perangkap klasik.

Query:

```java
select c
from CaseFile c
left join fetch c.documents
order by c.createdAt desc
```

Dengan:

```java
setFirstResult(0)
setMaxResults(20)
```

Masalah:

- pagination relational bekerja di rowset hasil join,
- root entity bisa duplicate,
- 20 rows SQL belum tentu 20 root cases,
- provider bisa melakukan in-memory pagination,
- hasil bisa tidak stabil.

Praktik lebih aman:

1. Query root IDs dengan pagination.
2. Fetch graph untuk ID tersebut dengan query kedua.

```java
List<Long> ids = em.createQuery("""
    select c.id
    from CaseFile c
    where c.status = :status
    order by c.createdAt desc, c.id desc
    """, Long.class)
    .setParameter("status", status)
    .setFirstResult(offset)
    .setMaxResults(limit)
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

Lalu reorder di memory sesuai urutan `ids`.

### 7.4 Join fetch and filtering child rows

Hati-hati saat melakukan fetch join dengan predicate pada child:

```java
select c
from CaseFile c
left join fetch c.documents d
where d.type = :type
```

Ini bisa berarti collection `documents` pada `CaseFile` dianggap terisi hanya dengan subset `type`, bukan seluruh documents. Provider behavior dan cache interaction bisa berbahaya.

Untuk partial child data, sering lebih aman memakai DTO projection daripada memuat entity collection sebagian.

---

## 8. Strategy 3 — Batch Fetch

Batch fetch mengurangi N+1 dengan memuat lazy association untuk beberapa parent sekaligus.

Misal:

```text
Load 20 CaseFile.
Access applicant for first CaseFile.
Provider loads applicants for multiple CaseFile in one IN query.
```

SQL:

```sql
select a.*
from applicant a
where a.id in (?, ?, ?, ?, ...);
```

Hibernate:

```java
@Entity
public class CaseFile {
    @ManyToOne(fetch = FetchType.LAZY)
    @BatchSize(size = 50)
    private Applicant applicant;
}
```

Atau untuk collection:

```java
@OneToMany(mappedBy = "caseFile")
@BatchSize(size = 50)
private List<Document> documents;
```

Global Hibernate property:

```properties
hibernate.default_batch_fetch_size=50
```

EclipseLink memiliki batch fetch melalui annotation/hint seperti `@BatchFetch` dan query hints dengan tipe seperti `JOIN`, `EXISTS`, dan `IN`.

### 8.1 Kapan batch fetch cocok

Batch fetch cocok ketika:

- root sudah dipagination,
- association lazy sering diakses untuk banyak parent,
- cardinality child sedang,
- join fetch akan menyebabkan row multiplication,
- query tambahan masih dapat diterima,
- `IN` list size tidak terlalu besar.

Contoh:

```text
20 cases
need documents for all cases
avg documents = 5

Batch fetch:
  1 query cases
  1 query documents where case_file_id in (...20 ids...)
  total 2 queries
  rows: 20 + 100

Join fetch:
  1 query joined
  rows: 100

Keduanya mungkin baik.

Kalau ada tasks juga:
  batch fetch: 3 queries, rows 20 + documents + tasks
  join fetch documents + tasks: rows 20 * documents * tasks
```

Batch fetch sering lebih stabil untuk multiple collections.

### 8.2 Batch size tuning

Batch size terlalu kecil:

```text
20 parents, batch size 5 -> 4 additional queries
```

Batch size terlalu besar:

```text
IN clause panjang
query plan kurang stabil
DB parameter limit bisa kena
lebih banyak data dari yang dibutuhkan
```

Practical starting point:

```text
To-one references: 32–100
Collections: 16–50
High-latency DB: larger may help
Strict DB parameter limit: smaller
Large child cardinality: smaller and test carefully
```

### 8.3 Batch fetch is not deterministic API contract

Batch fetch adalah optimization. Jangan membuat business logic bergantung pada jumlah query persis tanpa memahami provider/version/config.

Test query count boleh, tetapi test harus realistis:

- assert upper bound,
- verify no N+1 shape,
- do not rely on exact internal batch grouping across provider versions.

---

## 9. Strategy 4 — Subselect Fetch

Subselect fetch memuat collection untuk semua parent hasil query sebelumnya menggunakan subquery yang merepresentasikan root query.

Konsep:

```sql
select d.*
from document d
where d.case_file_id in (
    select c.id
    from case_file c
    where c.status = ?
)
```

Hibernate menyediakan `FetchMode.SUBSELECT` untuk collection dalam extension-nya.

```java
@OneToMany(mappedBy = "caseFile")
@Fetch(FetchMode.SUBSELECT)
private List<Document> documents;
```

### 9.1 Kapan subselect cocok

Subselect cocok ketika:

- parent didapat dari query yang jelas,
- collection yang sama akan diakses untuk banyak parent,
- ingin menghindari banyak batch `IN`,
- result parent tidak terlalu besar,
- root query cukup stabil dan tidak terlalu kompleks.

### 9.2 Risiko subselect

- Bisa memuat collection untuk parent lebih banyak dari yang diharapkan tergantung scope/session.
- Subquery bisa mahal.
- Tidak selalu cocok dengan pagination kompleks.
- Bisa sulit diprediksi saat query root sangat kompleks.
- Provider-specific, tidak portable JPA murni.

Subselect adalah alat kuat, tetapi bukan default universal.

---

## 10. Strategy 5 — Entity Graph

Entity graph adalah cara standard JPA/Jakarta Persistence untuk menyatakan graph yang ingin dimuat pada query/find.

Contoh named graph:

```java
@NamedEntityGraph(
    name = "CaseFile.summary",
    attributeNodes = {
        @NamedAttributeNode("applicant"),
        @NamedAttributeNode("assignedOfficer")
    }
)
@Entity
public class CaseFile {
    @Id
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    private Applicant applicant;

    @ManyToOne(fetch = FetchType.LAZY)
    private Officer assignedOfficer;
}
```

Use:

```java
EntityGraph<?> graph = em.getEntityGraph("CaseFile.summary");

List<CaseFile> cases = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
    order by c.createdAt desc
    """, CaseFile.class)
    .setParameter("status", status)
    .setHint("jakarta.persistence.fetchgraph", graph)
    .getResultList();
```

Untuk JPA 2.x legacy:

```java
.setHint("javax.persistence.fetchgraph", graph)
```

### 10.1 `fetchgraph` vs `loadgraph`

Secara konsep:

- `fetchgraph`: attribute dalam graph diperlakukan sebagai yang harus difetch; attribute lain mengikuti semantics graph yang lebih ketat.
- `loadgraph`: attribute dalam graph diperlakukan sebagai tambahan yang perlu dimuat; attribute lain mengikuti mapping default.

Detail provider behavior harus diuji, terutama saat mapping default punya EAGER association.

### 10.2 Kapan entity graph cocok

Entity graph cocok ketika:

- ingin fetch plan per use case tanpa menulis join fetch di setiap JPQL,
- ingin graph reusable,
- ingin standard API,
- ingin menghindari mapping EAGER global,
- association mostly to-one atau limited graph.

### 10.3 Batas entity graph

Entity graph tidak otomatis menyelesaikan:

- pagination + collection fetch,
- cartesian explosion,
- DTO projection needs,
- filtering child collection,
- provider-specific batch/subselect optimization.

Entity graph adalah cara menyatakan graph, bukan jaminan query shape paling optimal.

---

## 11. Strategy 6 — DTO Projection

DTO projection mengambil data yang dibutuhkan langsung ke read model, bukan entity graph.

JPQL constructor expression:

```java
select new com.example.CaseSummaryDto(
    c.id,
    c.referenceNo,
    a.name,
    o.displayName,
    c.status,
    c.createdAt
)
from CaseFile c
join c.applicant a
left join c.assignedOfficer o
where c.status = :status
order by c.createdAt desc
```

DTO:

```java
public record CaseSummaryDto(
    Long id,
    String referenceNo,
    String applicantName,
    String officerName,
    CaseStatus status,
    Instant createdAt
) {}
```

Untuk Java 8:

```java
public class CaseSummaryDto {
    private final Long id;
    private final String referenceNo;
    private final String applicantName;
    private final String officerName;
    private final CaseStatus status;
    private final Instant createdAt;

    public CaseSummaryDto(Long id, String referenceNo, String applicantName,
                          String officerName, CaseStatus status, Instant createdAt) {
        this.id = id;
        this.referenceNo = referenceNo;
        this.applicantName = applicantName;
        this.officerName = officerName;
        this.status = status;
        this.createdAt = createdAt;
    }
}
```

### 11.1 DTO projection is often the best listing strategy

Untuk listing/search page, DTO sering lebih baik daripada entity karena:

- tidak butuh managed state,
- tidak butuh dirty checking,
- tidak memperbesar persistence context,
- query shape eksplisit,
- mencegah lazy loading di serializer,
- pagination lebih aman,
- kolom bisa dipilih minimal.

### 11.2 Kapan DTO bukan pilihan utama

DTO kurang cocok ketika:

- use case perlu mutate aggregate,
- business invariant dijalankan lewat entity behavior,
- graph akan dimodifikasi lalu disimpan,
- lifecycle callback/cascade diperlukan,
- optimistic locking entity diperlukan langsung.

Rule:

```text
Read-only listing/detail projection -> DTO/read model.
Command/update use case -> entity aggregate dengan fetch plan minimal yang diperlukan.
```

---

## 12. Strategy 7 — Two-Step Query Pattern

Two-step query adalah pattern sangat penting untuk pagination + association loading.

Step 1: pilih root IDs dengan pagination stabil.

```java
List<Long> ids = em.createQuery("""
    select c.id
    from CaseFile c
    where c.status = :status
    order by c.createdAt desc, c.id desc
    """, Long.class)
    .setParameter("status", status)
    .setFirstResult(page * size)
    .setMaxResults(size)
    .getResultList();
```

Step 2: load graph untuk IDs tersebut.

```java
List<CaseFile> loaded = em.createQuery("""
    select distinct c
    from CaseFile c
    join fetch c.applicant
    left join fetch c.assignedOfficer
    where c.id in :ids
    """, CaseFile.class)
    .setParameter("ids", ids)
    .getResultList();
```

Step 3: reorder.

```java
Map<Long, CaseFile> byId = loaded.stream()
    .collect(Collectors.toMap(CaseFile::getId, Function.identity()));

List<CaseFile> ordered = ids.stream()
    .map(byId::get)
    .filter(Objects::nonNull)
    .toList();
```

Java 8:

```java
List<CaseFile> ordered = ids.stream()
    .map(byId::get)
    .filter(Objects::nonNull)
    .collect(Collectors.toList());
```

### 12.1 Why this works

Pagination dilakukan pada root table/query, bukan pada multiplied join rowset.

Graph loading dilakukan hanya untuk page root IDs.

Ini memberi kontrol:

```text
Query 1: stable page IDs
Query 2: load to-one graph
Query 3: optionally batch/subselect collections
```

### 12.2 Caveat

- `IN :ids` tidak menjaga urutan, perlu reorder.
- Large page size bisa menghasilkan large `IN`.
- Kalau data berubah antara query 1 dan 2, bisa ada missing rows; biasanya acceptable untuk read listing, atau gunakan transaction/isolation sesuai kebutuhan.
- Count query tetap harus didesain terpisah.

---

## 13. Strategy 8 — Explicit Application Loading

Kadang strategi paling jelas adalah explicit loading manual:

```java
List<CaseFile> cases = loadCasePage(status, page, size);
List<Long> caseIds = extractIds(cases);

Map<Long, List<Document>> documentsByCase = loadDocumentsByCaseIds(caseIds);
Map<Long, CurrentTask> taskByCase = loadCurrentTasksByCaseIds(caseIds);

return assembleDto(cases, documentsByCase, taskByCase);
```

Ini terlihat lebih manual, tetapi untuk high-volume read path sering paling predictable.

Keuntungan:

- query shape eksplisit,
- tidak tergantung lazy loading,
- tidak ada accidental persistence context graph,
- mudah optimize SQL/index,
- mudah cache per read model,
- cocok untuk complex listing/reporting.

Kekurangan:

- lebih banyak kode,
- mapping manual,
- harus menjaga consistency sendiri,
- bukan entity graph mutation.

---

## 14. Provider Behavior: Hibernate

Hibernate menawarkan beberapa mekanisme fetch:

- JPA `FetchType`,
- JPQL/HQL `join fetch`,
- Criteria fetch,
- entity graph,
- `@BatchSize`,
- `hibernate.default_batch_fetch_size`,
- `@Fetch(FetchMode.JOIN)`,
- `@Fetch(FetchMode.SELECT)`,
- `@Fetch(FetchMode.SUBSELECT)`,
- fetch profiles,
- bytecode enhancement for lazy attributes,
- second-level cache interaction.

### 14.1 Hibernate and multiple bags

Hibernate memiliki konsep bag untuk collection list tanpa index/order column yang tidak punya key deduplication natural.

Contoh berisiko:

```java
@OneToMany(mappedBy = "caseFile")
private List<Document> documents = new ArrayList<>();

@OneToMany(mappedBy = "caseFile")
private List<Note> notes = new ArrayList<>();
```

Query:

```java
select c
from CaseFile c
left join fetch c.documents
left join fetch c.notes
where c.id = :id
```

Hibernate dapat menolak dengan multiple bag fetch exception karena hasil join tidak bisa direkonstruksi secara aman tanpa ambiguity/duplication untuk multiple bag.

Solusi bukan asal mengganti semua menjadi `Set`.

Pilihan lebih sehat:

1. Jangan fetch multiple collections dalam satu query.
2. Fetch root + satu collection, batch fetch collection lain.
3. Gunakan DTO/read query.
4. Tambahkan `@OrderColumn` kalau list benar-benar punya index persistent.
5. Gunakan `Set` hanya jika domain semantics memang set.
6. Pisahkan use case.

### 14.2 Hibernate batch fetch

Global:

```properties
hibernate.default_batch_fetch_size=50
```

Per association/entity:

```java
@BatchSize(size = 50)
```

Batch fetch bisa berlaku untuk lazy to-one atau collection, tergantung mapping dan access pattern.

### 14.3 Hibernate subselect fetch

```java
@Fetch(FetchMode.SUBSELECT)
```

Umumnya untuk collection. Bagus untuk memuat collection dari parent result set, tetapi harus diuji untuk query kompleks dan pagination.

### 14.4 Hibernate statistics

Untuk diagnosis, enable statistics di environment non-production atau controlled production:

```properties
hibernate.generate_statistics=true
```

Monitor:

- entity load count,
- collection fetch count,
- query execution count,
- second-level cache hit/miss,
- flush count,
- prepare statement count.

---

## 15. Provider Behavior: EclipseLink

EclipseLink menawarkan mekanisme:

- JPA `FetchType`,
- JPQL join fetch,
- entity graph/fetch graph support,
- `@JoinFetch`,
- `@BatchFetch`,
- query hints seperti `eclipselink.join-fetch`, `eclipselink.batch`, `eclipselink.batch.type`,
- fetch groups,
- weaving/indirection,
- shared cache behavior.

### 15.1 EclipseLink batch fetch types

EclipseLink batch fetch memiliki tipe seperti:

- `JOIN`,
- `EXISTS`,
- `IN`.

Konsep:

```text
JOIN:
  batch query menggabungkan selection criteria root dengan target association.

EXISTS:
  memakai EXISTS/subselect.

IN:
  memakai IN clause dengan IDs parent/source.
```

Setiap tipe punya trade-off terhadap optimizer database.

### 15.2 EclipseLink join fetch extension

`@JoinFetch` atau hint join-fetch memungkinkan join read association. Ini mirip join fetch tetapi sebagai provider extension. Hati-hati karena portability turun.

### 15.3 EclipseLink fetch groups

Fetch group memungkinkan sebagian attribute dimuat, termasuk strategi untuk mengurangi column/attribute loading. Ini bisa kuat tetapi harus dipahami bersama weaving dan lazy behavior.

### 15.4 Shared cache interaction

EclipseLink shared cache bisa mengubah persepsi performance/freshness. Query mungkin terlihat cepat karena cache, tetapi:

- stale data risk,
- tenant leakage risk kalau salah konfigurasi,
- partial object/fetch group correctness harus diperhatikan,
- batch/fetch behavior bisa berbeda saat object sudah ada di cache.

---

## 16. Decision Matrix: Which Fetch Strategy Should You Use?

### 16.1 To-one association needed in detail/listing

```text
Use: join fetch or entity graph
Avoid: leaving lazy if accessed in loop without batch
```

Example:

```java
select c
from CaseFile c
join fetch c.applicant
left join fetch c.assignedOfficer
where c.id = :id
```

### 16.2 One small collection needed for one detail page

```text
Use: join fetch may be acceptable
Watch: duplicate root, row count
```

Example:

```java
select distinct c
from CaseFile c
left join fetch c.documents
where c.id = :id
```

### 16.3 Multiple collections needed for detail page

```text
Prefer:
  root + to-one join fetch
  then batch/subselect/explicit load collections separately
Avoid:
  join fetch all collections at once
```

### 16.4 Listing/search page

```text
Prefer:
  DTO projection
  or root ID pagination + second-step fetch
Avoid:
  entity graph with large collections
  collection join fetch + pagination
```

### 16.5 Command/update use case

```text
Prefer:
  load aggregate root + minimal associations required to enforce invariant
Avoid:
  huge graph fetch
  DTO update directly into detached entity graph
```

### 16.6 Reporting/export

```text
Prefer:
  DTO/native/read model query
  streaming/scrolled result where appropriate
Avoid:
  loading managed entities for large export
```

### 16.7 Batch job

```text
Prefer:
  page IDs
  process chunk
  flush/clear
  batch fetch required associations
  consider stateless/session or native SQL when entity lifecycle not needed
Avoid:
  one huge persistence context
```

---

## 17. Cost Model

A fetch plan should be evaluated with a cost model.

### 17.1 Query count

```text
query_count = root_queries + association_queries + count_queries + lazy_queries
```

High query count hurts when:

- DB latency is non-trivial,
- connection pool is busy,
- queries require parse/plan,
- DB CPU is high,
- transaction holds locks longer.

### 17.2 Row count

For join fetch:

```text
rows ≈ root_count
       * avg(collection_A_size)
       * avg(collection_B_size)
       * avg(collection_C_size)
```

For batch fetch:

```text
rows ≈ root_count
       + total(collection_A_rows)
       + total(collection_B_rows)
       + total(collection_C_rows)
```

This is why multiple collection join fetch can explode.

### 17.3 Column count

Even row count is not enough.

```text
payload ≈ rows * selected_columns * average_column_size
```

Join fetch selects columns of root and all joined associations. DTO projection can select only required columns.

### 17.4 Object hydration cost

ORM must:

- read JDBC row,
- resolve entity key,
- check persistence context,
- instantiate entity if absent,
- set fields,
- initialize collection wrapper,
- deduplicate associations,
- create snapshots,
- maybe interact with second-level cache.

Hydration cost is real Java CPU and memory.

### 17.5 Persistence context size

Managed entities remain in first-level cache until detach/clear/close.

```text
managed_objects = roots + associated_entities + collection_entries + snapshots
```

For read-only listing, loading entity graph may waste memory because objects become managed even if you never update them.

### 17.6 DB optimizer cost

Join fetch can change optimizer plan:

- different join order,
- large sort,
- hash join memory,
- bad cardinality estimate,
- index not used,
- temp segment usage,
- lock impact under pessimistic lock.

Fetch plan engineering must include database execution plan for critical query.

---

## 18. The “Fix N+1” Anti-Pattern

Bad pattern:

```text
Problem: N+1 detected.
Solution: add join fetch to every association.
Result: cartesian explosion, broken pagination, memory spike.
```

Better pattern:

```text
1. Identify use case.
2. Identify exact fields/graph needed.
3. Identify cardinality of every association.
4. Separate to-one from to-many.
5. For listing, prefer DTO or two-step query.
6. For detail, join fetch limited graph and batch/subselect collections.
7. Add SQL count tests.
8. Add realistic dataset tests.
9. Observe in staging with production-like data.
```

---

## 19. Practical Design Patterns

### 19.1 Listing summary pattern

Use DTO projection.

```java
public List<CaseSummaryDto> findCaseSummaries(CaseStatus status, int offset, int limit) {
    return em.createQuery("""
        select new com.example.CaseSummaryDto(
            c.id,
            c.referenceNo,
            a.name,
            o.displayName,
            c.status,
            c.createdAt
        )
        from CaseFile c
        join c.applicant a
        left join c.assignedOfficer o
        where c.status = :status
        order by c.createdAt desc, c.id desc
        """, CaseSummaryDto.class)
        .setParameter("status", status)
        .setFirstResult(offset)
        .setMaxResults(limit)
        .getResultList();
}
```

Characteristics:

```text
No managed graph.
No lazy loading.
Stable pagination.
Minimal columns.
Good for API/search/listing.
```

### 19.2 Detail aggregate pattern

Load root + to-one with join fetch. Load collections deliberately.

```java
CaseFile caseFile = em.createQuery("""
    select c
    from CaseFile c
    join fetch c.applicant
    left join fetch c.assignedOfficer
    where c.id = :id
    """, CaseFile.class)
    .setParameter("id", id)
    .getSingleResult();
```

Then load one or more collections:

```java
List<Document> documents = em.createQuery("""
    select d
    from Document d
    where d.caseFile.id = :caseId
    order by d.createdAt desc
    """, Document.class)
    .setParameter("caseId", id)
    .getResultList();
```

This is sometimes better than forcing all collections into the `CaseFile` entity graph.

### 19.3 Page IDs then graph pattern

Use for paginated entity result where entity behavior is still needed.

```java
List<Long> ids = findPageIds(filter, page, size);
List<CaseFile> cases = fetchCasesForIds(ids);
return reorder(ids, cases);
```

### 19.4 One query per collection type pattern

Instead of:

```text
1 query root
N query documents
N query tasks
N query notes
```

Use:

```text
1 query root
1 query documents where case_id in (...)
1 query tasks where case_id in (...)
1 query notes where case_id in (...)
```

This is often optimal for complex screens.

### 19.5 Read-model table/materialized view pattern

For high-volume dashboards:

```text
case_search_view
  case_id
  reference_no
  applicant_name
  status
  current_task_name
  assigned_officer_name
  latest_decision_date
  document_count
```

Then query directly to DTO.

This avoids ORM graph traversal for screens that are not aggregate mutation use cases.

---

## 20. Common Failure Modes and Root Causes

### 20.1 N+1 from mapper

Code:

```java
return cases.stream()
    .map(c -> new CaseDto(
        c.getId(),
        c.getApplicant().getName(),
        c.getDocuments().size()
    ))
    .toList();
```

Root cause:

```text
Mapper touches lazy associations after root query.
```

Fix:

```text
Use DTO query, entity graph, batch fetch, or explicit collection query.
```

### 20.2 N+1 from JSON serialization

Code:

```java
@GetMapping("/cases")
public List<CaseFile> cases() {
    return repository.findAll();
}
```

Root cause:

```text
Serializer traverses entity associations.
```

Fix:

```text
Do not expose entities directly.
Use DTO/read models.
Disable dangerous serialization paths.
```

### 20.3 N+1 hidden by Open Session in View

OSIV keeps persistence context open during view serialization.

Symptom:

```text
No LazyInitializationException.
But endpoint fires hundreds of queries during serialization.
```

Fix:

```text
Design service-layer fetch plan.
Return DTO.
Disable/limit OSIV where appropriate.
```

### 20.4 Cartesian explosion from multiple collection join fetch

Root cause:

```text
Multiple to-many joins in one SQL query.
```

Fix:

```text
Fetch at most one collection via join, use batch/subselect/separate query for others.
```

### 20.5 Broken pagination

Root cause:

```text
Pagination applied to joined rowset, not root entities.
```

Fix:

```text
Two-step ID pagination.
DTO projection.
Avoid collection fetch join with pageable query.
```

### 20.6 Duplicate roots

Root cause:

```text
Join fetch collection creates duplicate root rows.
```

Fix:

```text
Use select distinct for entity roots, but still inspect row count.
```

### 20.7 Huge memory usage

Root cause:

```text
Large graph loaded as managed entities.
Snapshots + collections retained in persistence context.
```

Fix:

```text
DTO projection.
Read-only query hints.
Flush/clear in batch.
Limit graph.
```

### 20.8 Slow count query

Root cause:

```text
Count query accidentally includes joins/fetch-like structure or distinct root over joined collection.
```

Fix:

```text
Design separate count query.
Avoid unnecessary joins in count.
Use exists when filtering by child.
```

---

## 21. SQL Shape Examples

### 21.1 Bad N+1

JPQL:

```java
select c from CaseFile c where c.status = :status
```

Loop:

```java
c.getApplicant().getName();
c.getCurrentTask().getName();
```

SQL:

```sql
select * from case_file where status = ?;

select * from applicant where id = ?;
select * from task where id = ?;

select * from applicant where id = ?;
select * from task where id = ?;
...
```

### 21.2 Good to-one join fetch

JPQL:

```java
select c
from CaseFile c
join fetch c.applicant
left join fetch c.currentTask
where c.status = :status
```

SQL:

```sql
select c.*, a.*, t.*
from case_file c
join applicant a on a.id = c.applicant_id
left join task t on t.id = c.current_task_id
where c.status = ?;
```

### 21.3 Bad multiple collection join fetch

JPQL:

```java
select distinct c
from CaseFile c
left join fetch c.documents
left join fetch c.notes
left join fetch c.tasks
where c.id in :ids
```

SQL row multiplication:

```text
case 1: 7 documents * 3 notes * 4 tasks = 84 rows
case 2: 10 documents * 5 notes * 2 tasks = 100 rows
...
```

### 21.4 Better separate collection loads

```sql
select c.*, a.*
from case_file c
join applicant a on a.id = c.applicant_id
where c.id in (...);

select d.*
from document d
where d.case_file_id in (...)
order by d.case_file_id, d.created_at desc;

select n.*
from note n
where n.case_file_id in (...)
order by n.case_file_id, n.created_at desc;

select t.*
from task t
where t.case_file_id in (...)
order by t.case_file_id, t.created_at desc;
```

This has more queries but far fewer rows.

---

## 22. Java 8–25 Compatibility Notes

### 22.1 Java 8 line

Typical stack:

```text
Java 8
JPA 2.1/2.2
javax.persistence
Hibernate 5.x
EclipseLink 2.x
```

Constraints:

- no records,
- older Hibernate type/query behavior,
- older bytecode enhancement setup,
- `javax.persistence.fetchgraph/loadgraph` hints,
- older Criteria API ergonomics,
- Spring Boot 2.x era if using Spring.

DTO class must be regular class, not record.

### 22.2 Java 11/17/21/25 modern line

Typical stack:

```text
Java 17/21/25
Jakarta Persistence 3.x
jakarta.persistence
Hibernate 6/7
EclipseLink 3/4
```

Notes:

- package namespace changes from `javax.persistence` to `jakarta.persistence`,
- query engine/type system changes in Hibernate 6+,
- records can be useful for DTO projection outside entity model,
- module path/classpath issues may appear,
- bytecode enhancement/weaving must be aligned with build/runtime,
- newer dialect behavior can change SQL shape.

### 22.3 Avoid writing version-agnostic assumptions

Do not assume:

- same JPQL creates identical SQL across provider versions,
- entity graph behaves identically across providers,
- batch fetch grouping remains identical,
- pagination + fetch join warnings/errors are the same,
- `distinct` pass-through behavior is identical.

Always validate with actual provider/version/database.

---

## 23. Testing Fetch Plans

### 23.1 Test with realistic cardinality

Do not test only:

```text
1 case
1 applicant
1 document
```

Use dataset:

```text
30 cases
some cases with 0 documents
some with 1
some with 5
some with 50
multiple tasks/notes
shared references
```

### 23.2 Assert query count

Use tooling:

- Hibernate statistics,
- datasource proxy,
- p6spy,
- custom StatementInspector,
- integration test SQL counter,
- database query logs.

Example expectation:

```text
Case summary listing should execute <= 2 SQL statements.
Case detail should execute <= 5 SQL statements.
No query count growth proportional to number of root rows.
```

The most important property:

```text
query_count should be O(1), not O(N)
```

For a paginated page size of 20, going from 20 to 40 rows should not double query count unexpectedly.

### 23.3 Assert row count / payload for critical screens

Query count alone is insufficient.

A single SQL query can return too many rows.

For critical endpoints, capture:

- rows returned,
- execution time,
- DB plan,
- network payload if available,
- heap allocation if severe,
- number of hydrated entities.

### 23.4 Test pagination correctness

Test:

- page size exactly respected,
- stable order,
- no missing root,
- no duplicate root,
- second page does not overlap first,
- sorting includes tie-breaker such as ID.

### 23.5 Test serialization boundary

Ensure API DTO mapping does not trigger SQL after repository/service fetch phase.

Pattern:

```text
Arrange: load data
Act: service returns DTO
Assert: no SQL during JSON serialization
```

---

## 24. Observability Checklist

For production/staging diagnosis, capture:

```text
Per request:
  request ID / correlation ID
  endpoint/use case
  SQL statement count
  slow SQL list
  bind-safe query shape
  rows returned if possible
  transaction duration
  connection acquisition time
  Hibernate/EclipseLink metrics
  cache hit/miss
```

Log examples:

```text
GET /cases?status=PENDING&page=0&size=20
sql.count=3
entity.load.count=40
collection.fetch.count=1
max.sql.ms=48
connection.wait.ms=2
```

Suspicious:

```text
sql.count=141 for page size 20
```

Also suspicious:

```text
sql.count=1 but response time 12s and DB returns 500k rows
```

---

## 25. Design Rules

### Rule 1 — Default to LAZY, fetch per use case

Static EAGER mapping is a global decision. Most use cases do not need the same graph.

### Rule 2 — Join fetch to-one freely, to-many carefully

To-one join fetch usually preserves root cardinality. To-many join fetch multiplies rows.

### Rule 3 — Never blindly join fetch multiple collections

Multiple to-many joins are the fastest path to cartesian explosion.

### Rule 4 — Do not paginate over collection fetch join

Use two-step ID pagination or DTO projection.

### Rule 5 — Listing endpoints should usually be DTO/read model

Entity graphs are often unnecessary for read-only list screens.

### Rule 6 — Query count and row count both matter

N+1 is query-count failure. Cartesian explosion is row-count failure.

### Rule 7 — Fetch plan belongs to application use case, not entity mapping alone

Entity mapping describes possible relationships. Use case fetch plan describes required materialization.

### Rule 8 — Test with production-like cardinality

Fetch bugs are cardinality bugs. Small test datasets lie.

### Rule 9 — Keep serializers away from entities

JSON serialization should not be allowed to discover graph shape at runtime.

### Rule 10 — Provider-specific optimization is acceptable when isolated

Hibernate/EclipseLink extensions are fine when:

- documented,
- tested,
- isolated,
- not confused with JPA guarantee,
- covered by migration checklist.

---

## 26. Anti-Patterns

### 26.1 `FetchType.EAGER` everywhere

Looks convenient. Creates global over-fetching and hard-to-control SQL.

### 26.2 `JOIN FETCH` everything

Fixes N+1 but creates cartesian explosion.

### 26.3 Returning entities directly from REST API

Lets serializer define fetch plan accidentally.

### 26.4 Repository method hides graph requirement

```java
findByStatus(status)
```

This says nothing about graph. Prefer use-case-specific method:

```java
findCaseSummaryPage(status, page)
findCaseDetailForReview(caseId)
findCaseForDecisionCommand(caseId)
```

### 26.5 One entity model for every read use case

Complex systems need read models. ORM entity graph is not always the right shape.

### 26.6 Assuming local performance predicts production

N+1 may be invisible locally and catastrophic with network latency + real data.

---

## 27. Diagnostic Flow

When endpoint is slow:

```text
1. Count SQL statements per request.
2. If SQL count grows with number of root rows -> N+1.
3. If SQL count is low but response slow -> inspect row count and execution plan.
4. Check if query joins multiple collections.
5. Check pagination + fetch join.
6. Check JSON mapper/serializer lazy access.
7. Check persistence context size and entity load count.
8. Check batch fetch config and actual behavior.
9. Check DB indexes for root and association queries.
10. Decide: DTO, join fetch, batch fetch, subselect, two-step, or explicit loading.
```

---

## 28. Practice Scenario 1 — Case Listing

Requirement:

```text
Show 20 pending cases:
  reference number
  applicant name
  assigned officer
  status
  created date
  document count
```

Bad approach:

```java
List<CaseFile> cases = repository.findByStatus(PENDING);
return cases.stream().map(CaseDto::fromEntity).toList();
```

Potential N+1:

- applicant,
- assigned officer,
- documents count.

Better approach:

```java
select new CaseSummaryDto(
    c.id,
    c.referenceNo,
    a.name,
    o.displayName,
    c.status,
    c.createdAt,
    count(d.id)
)
from CaseFile c
join c.applicant a
left join c.assignedOfficer o
left join c.documents d
where c.status = :status
group by c.id, c.referenceNo, a.name, o.displayName, c.status, c.createdAt
order by c.createdAt desc, c.id desc
```

Or use separate document count read model if document table is large.

---

## 29. Practice Scenario 2 — Case Detail Review

Requirement:

```text
Show one case with:
  applicant
  assigned officer
  current task
  documents
  latest notes
  decision history
```

Bad approach:

```java
select distinct c
from CaseFile c
left join fetch c.applicant
left join fetch c.assignedOfficer
left join fetch c.currentTask
left join fetch c.documents
left join fetch c.notes
left join fetch c.decisionHistory
where c.id = :id
```

Potential explosion:

```text
documents * notes * decisionHistory
```

Better:

```text
Query 1: case + to-one associations
Query 2: documents ordered
Query 3: latest notes limited
Query 4: decision history ordered
Assemble DTO/detail view
```

For command use case, load only associations needed to enforce invariant.

---

## 30. Practice Scenario 3 — Batch Job

Requirement:

```text
For 50,000 cases, recalculate SLA status using applicant type and active task.
```

Bad approach:

```java
List<CaseFile> all = repository.findAll();
for (CaseFile c : all) {
    c.recalculateSla();
}
```

Problems:

- huge persistence context,
- N+1 applicant/task,
- slow flush,
- memory pressure.

Better:

```text
Process IDs in chunks of 500.
For each chunk:
  load cases + required to-one associations with join fetch or batch fetch
  apply recalculation
  flush
  clear
```

Pseudo-code:

```java
while (true) {
    List<Long> ids = findNextIds(lastId, 500);
    if (ids.isEmpty()) break;

    List<CaseFile> cases = fetchForSlaRecalculation(ids);

    for (CaseFile c : cases) {
        c.recalculateSla(clock);
    }

    em.flush();
    em.clear();

    lastId = ids.get(ids.size() - 1);
}
```

---

## 31. Top 1% Heuristics

A strong engineer can estimate fetch plan cost before running it.

Ask:

```text
What is the root cardinality?
What are the max/avg child cardinalities?
How many to-many joins exist?
Does pagination apply to root or rowset?
Will serializer touch lazy fields?
Is the use case read-only or mutation?
Do we need managed entities?
Can a DTO projection solve this more cleanly?
What is the expected SQL count?
What is the expected row count?
How will this behave when data grows 10x?
How will this behave with DB latency?
How do we test this?
How do we observe this in production?
```

---

## 32. Summary

N+1 and cartesian explosion are not isolated bugs. They are signs of fetch plan mismatch.

The deep model:

```text
Entity mapping defines possible graph.
Use case defines required graph.
Fetch plan materializes graph.
SQL shape executes graph.
Database returns rows.
Provider hydrates objects.
Persistence context retains state.
Serializer/mapper may trigger more graph.
```

Correct engineering means controlling every step.

Key conclusions:

1. Default LAZY is usually right, but incomplete.
2. Join fetch is excellent for to-one and dangerous for multiple to-many.
3. Batch fetch and subselect fetch are essential tools for collections.
4. Entity graph is a useful standard fetch-plan mechanism, not a magic optimizer.
5. DTO projection is often the best solution for listing/search/reporting.
6. Pagination plus collection fetch join is a serious smell.
7. Query count and row count must both be measured.
8. Provider-specific behavior matters and must be tested with actual Hibernate/EclipseLink versions.
9. Production-like cardinality is required to expose real problems.
10. The best fetch plan is use-case-specific, measurable, and stable under data growth.

---

## 33. References and Further Reading

Primary references:

- Jakarta Persistence 3.2 Specification: https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Jakarta EE Tutorial — Entity Graphs: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/persist/persistence-entitygraphs/persistence-entitygraphs.html
- Hibernate ORM documentation: https://hibernate.org/orm/documentation/
- Hibernate ORM releases: https://hibernate.org/orm/releases/
- EclipseLink documentation: https://eclipse.dev/eclipselink/documentation/
- EclipseLink `@BatchFetch` / query hints documentation: https://eclipse.dev/eclipselink/documentation/

Suggested experiments:

1. Create 20 parent rows with 5 child rows each and compare lazy, join fetch, and batch fetch.
2. Add second and third collections, observe row multiplication.
3. Add pagination and inspect whether root count remains correct.
4. Enable SQL logging/statistics and compare query count.
5. Convert listing endpoint from entity mapping to DTO projection and compare persistence context size.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 14 — Fetching Mental Model: Lazy, Eager, Proxies, Enhancement, and Load Plans](./14-fetching-mental-model-lazy-eager-proxies-enhancement-load-plans.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 16 — JPQL, HQL, Criteria, Native Query, and Query Plan Discipline](./16-jpql-hql-criteria-native-query-query-plan-discipline.md)

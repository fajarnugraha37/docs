# Part 10 — Collection Mapping: Bags, Lists, Sets, Maps, Ordering, and Hidden Costs

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `10-collection-mapping-bags-lists-sets-maps-ordering-hidden-costs.md`  
> Target: Java 8–25, JPA 2.1/2.2 `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4  
> Fokus: collection mapping sebagai kontrak persistence, bukan sekadar pilihan tipe Java.

---

## 0. Executive Summary

Collection mapping adalah salah satu area ORM yang paling sering terlihat sederhana di kode Java, tetapi menghasilkan konsekuensi SQL yang sangat besar.

```java
@OneToMany(mappedBy = "caseFile")
private List<Document> documents = new ArrayList<>();
```

Kode di atas tampak hanya berarti: “satu case punya banyak document”. Tetapi bagi JPA provider, collection itu juga menjawab banyak pertanyaan tersembunyi:

- Apakah urutan collection punya arti bisnis?
- Apakah duplicate element boleh?
- Apakah perubahan posisi element harus disimpan di database?
- Apakah collection table punya primary key yang stabil?
- Apakah provider bisa mendeteksi remove satu row secara efisien?
- Apakah collection boleh di-join fetch bersama collection lain?
- Apakah collection harus dihapus semua lalu diinsert ulang ketika berubah?
- Apakah collection ini bagian dari aggregate atau hanya read navigation?
- Apakah collection aman untuk batch loading?
- Apakah collection ini akan menyebabkan cartesian product ketika query production berjalan?

Mental model utama part ini:

> Di ORM, collection bukan hanya `List`, `Set`, atau `Map`. Collection adalah **relational mutation contract** dan **fetch-plan liability**.

Kesalahan memilih collection mapping dapat menghasilkan:

- N+1 queries,
- cartesian explosion,
- duplicate rows,
- unexpected delete-insert cycles,
- unstable ordering,
- slow flush,
- high memory hydration,
- optimistic locking conflict yang tidak perlu,
- `MultipleBagFetchException` pada Hibernate,
- stale collection cache,
- dan data model yang sulit dimigrasikan.

---

## 1. Why This Matters

Banyak engineer belajar association mapping dengan urutan seperti ini:

1. `@OneToMany`
2. `@ManyToOne`
3. `@ManyToMany`
4. `@ElementCollection`
5. `List`, `Set`, `Map`

Masalahnya, urutan belajar itu membuat collection terasa seperti “container object biasa”. Padahal dalam ORM, collection adalah salah satu struktur paling mahal karena provider harus menjaga sinkronisasi antara:

```text
Java collection state
        ↓
Persistence context snapshot
        ↓
Collection action queue
        ↓
Foreign key / join table / collection table rows
        ↓
Database constraints, indexes, locks, and transaction isolation
```

Collection juga menjadi salah satu penyebab terbesar perbedaan antara kode yang tampak bersih dan SQL yang buruk.

Contoh sederhana:

```java
CaseFile caseFile = entityManager.find(CaseFile.class, id);
caseFile.getDocuments().remove(0);
```

Pertanyaan yang harus dijawab provider:

- Apakah ini list berurutan dengan `@OrderColumn`?
- Kalau ya, apakah semua row setelah index 0 perlu di-update index-nya?
- Kalau bukan, apakah ini bag tanpa identifier row?
- Apakah provider bisa tahu row mana yang dihapus?
- Apakah harus delete semua rows lalu insert ulang sisanya?
- Apakah child entity harus dihapus atau hanya unlink FK?
- Apakah orphan removal aktif?
- Apakah collection initialized?
- Apakah collection snapshot tersedia?
- Apakah perubahan ini menaikkan version parent?

Dalam sistem enterprise/regulatory, collection sering merepresentasikan hal penting:

- daftar supporting documents,
- daftar compliance checks,
- daftar approval steps,
- daftar correspondence recipients,
- daftar case officers,
- daftar audit changes,
- daftar workflow tasks,
- daftar screening results,
- daftar remarks/comments.

Kesalahan mapping collection di domain seperti ini bukan hanya performance issue; bisa menjadi correctness issue dan auditability issue.

---

## 2. Core Mental Model

### 2.1 Collection Mapping = 4 Contracts

Setiap collection mapping membawa empat kontrak:

```text
1. Semantic contract
   Apa arti collection di domain?

2. Relational contract
   Bagaimana collection direpresentasikan di table, FK, join table, index column?

3. Mutation contract
   Bagaimana add/remove/reorder diterjemahkan ke SQL?

4. Fetch contract
   Bagaimana collection dimaterialisasi ketika dibaca?
```

Contoh:

```java
@OneToMany(mappedBy = "caseFile")
@OrderBy("uploadedAt DESC")
private List<Document> documents;
```

Kontraknya:

- Semantic: case punya banyak document, ditampilkan berdasarkan upload time.
- Relational: FK ada di `document.case_file_id`.
- Mutation: order tidak disimpan sebagai posisi list; order berasal dari data `uploaded_at`.
- Fetch: provider menambahkan `ORDER BY uploaded_at DESC` saat collection diload.

Bandingkan dengan:

```java
@OneToMany
@OrderColumn(name = "position_no")
private List<ApprovalStep> steps;
```

Kontraknya:

- Semantic: posisi step adalah state bisnis.
- Relational: order disimpan sebagai column integral.
- Mutation: reorder berarti update `position_no`.
- Fetch: collection diload dengan order berdasarkan column posisi.

Dua-duanya memakai `List`, tetapi konsekuensi relational dan mutation-nya sangat berbeda.

---

### 2.2 Collection State Bukan Entity State Biasa

Entity state biasanya berbasis row:

```text
Entity object ↔ table row
```

Collection state berbasis sekumpulan row:

```text
Collection wrapper ↔ multiple rows
```

Provider harus tahu:

- collection owner,
- collection role,
- snapshot lama,
- current elements,
- added elements,
- removed elements,
- order/index/key changes,
- orphan handling,
- cache region,
- initialization state.

Hibernate memakai persistent collection wrapper seperti `PersistentBag`, `PersistentSet`, `PersistentList`, `PersistentMap`. EclipseLink memakai indirection/weaving dan collection policy/change tracking untuk mencapai tujuan serupa.

Implikasi penting:

> Mengganti instance collection sering berbeda dengan memodifikasi isi collection.

Buruk:

```java
caseFile.setDocuments(new ArrayList<>(incomingDocuments));
```

Lebih aman:

```java
caseFile.clearDocuments();
for (Document document : incomingDocuments) {
    caseFile.addDocument(document);
}
```

Tetapi “lebih aman” pun tergantung cascade, orphan removal, ownership, dan aggregate boundary.

---

## 3. Specification-Level Concept

### 3.1 Collection-Valued Relationship

JPA/Jakarta Persistence mengenal relationship collection seperti:

```java
@OneToMany
private List<Document> documents;

@ManyToMany
private Set<Role> roles;
```

Relasi collection bisa:

- unidirectional,
- bidirectional,
- join column-based,
- join table-based,
- ordered,
- mapped as `List`, `Set`, `Collection`, atau `Map`.

Specification memberikan model portabel, tetapi banyak detail behavior tetap provider-specific, terutama:

- dirty checking collection,
- SQL operation ordering,
- lazy implementation,
- batch fetching,
- extra-lazy/lazy group,
- multiple collection fetching,
- collection cache behavior,
- optimization delete vs recreate.

---

### 3.2 Element Collection

`@ElementCollection` digunakan untuk collection berisi basic type atau embeddable, bukan entity.

```java
@ElementCollection
@CollectionTable(
    name = "case_tags",
    joinColumns = @JoinColumn(name = "case_id")
)
@Column(name = "tag")
private Set<String> tags = new HashSet<>();
```

Atau:

```java
@ElementCollection
@CollectionTable(
    name = "case_contact",
    joinColumns = @JoinColumn(name = "case_id")
)
private List<ContactSnapshot> contactSnapshots = new ArrayList<>();
```

Mental model:

```text
Entity collection:
  child has identity and lifecycle as entity

Element collection:
  element has no independent identity
  element exists as part of owner state
```

Element collection cocok untuk:

- small value objects,
- stable bounded collection,
- no independent lifecycle,
- no need to query element independently often,
- no audit/history per element row.

Element collection tidak cocok untuk:

- large collection,
- frequently updated collection,
- independently queried data,
- independently versioned data,
- data requiring row identity,
- data requiring detailed audit trail.

---

### 3.3 `@OrderBy` vs `@OrderColumn`

Ini salah satu perbedaan paling penting.

#### `@OrderBy`

```java
@OneToMany(mappedBy = "caseFile")
@OrderBy("uploadedAt DESC")
private List<Document> documents;
```

Artinya:

```text
Urutan ditentukan saat SELECT menggunakan ORDER BY.
Urutan tidak disimpan sebagai posisi collection.
```

Biasanya SQL:

```sql
select d.*
from document d
where d.case_file_id = ?
order by d.uploaded_at desc
```

Gunakan `@OrderBy` jika:

- urutan berasal dari atribut domain,
- tidak perlu drag-and-drop custom order,
- order bisa dihitung dari column yang sudah ada,
- perubahan posisi tidak perlu disimpan.

#### `@OrderColumn`

```java
@OneToMany
@OrderColumn(name = "step_position")
private List<ApprovalStep> steps;
```

Artinya:

```text
Posisi list adalah state persistence.
Provider harus menjaga index column tetap konsisten.
```

Kemungkinan SQL ketika reorder:

```sql
update approval_step set step_position = ? where id = ?;
update approval_step set step_position = ? where id = ?;
update approval_step set step_position = ? where id = ?;
```

Gunakan `@OrderColumn` jika:

- posisi adalah fakta bisnis,
- user bisa menyusun urutan manual,
- order tidak bisa diturunkan dari atribut lain,
- collection size relatif kecil atau reorder jarang.

Hindari `@OrderColumn` untuk:

- collection besar,
- high-frequency mutation,
- log/audit entries,
- append-only history,
- collection yang sering remove dari tengah.

---

## 4. Java Collection Type vs Persistence Semantics

### 4.1 `Collection<T>`

```java
@OneToMany(mappedBy = "caseFile")
private Collection<Document> documents = new ArrayList<>();
```

`Collection` adalah tipe paling umum. Ia tidak menyatakan ordering, uniqueness, atau index. Provider bebas memilih representasi internal.

Gunakan jika:

- API domain tidak butuh operasi index,
- tidak butuh uniqueness dari Java collection,
- hanya butuh iterate/add/remove.

Tetapi dalam praktik, `Collection` sering kurang komunikatif. `Set` atau `List` biasanya lebih jelas.

---

### 4.2 `List<T>` Without `@OrderColumn`: Bag-Like Semantics

```java
@OneToMany(mappedBy = "caseFile")
private List<Document> documents = new ArrayList<>();
```

Di Hibernate, `List` tanpa `@OrderColumn` sering diperlakukan sebagai **bag**: collection yang boleh duplicate dan tidak punya persistent index.

Karakteristik bag:

- duplicate allowed,
- no persistent order column,
- Java iteration order mungkin ada, tetapi bukan durable database contract,
- sulit membedakan duplicate row jika tidak ada row identity yang jelas,
- multiple bag fetch bisa bermasalah di Hibernate.

Bag cocok untuk:

- simple child collection,
- duplicate secara teoritis boleh,
- order tidak penting,
- collection tidak sering di-join fetch bersama collection lain.

Tetapi untuk production system, bag sering menjadi sumber masalah karena semantiknya lemah.

---

### 4.3 `List<T>` With `@OrderColumn`: Persistent List

```java
@OneToMany(mappedBy = "caseFile")
@OrderColumn(name = "line_no")
private List<ChecklistItem> items = new ArrayList<>();
```

Ini adalah list dengan persistent index.

Karakteristik:

- index tersimpan di database,
- posisi pertama biasanya 0 menurut JPA contract,
- provider harus menjaga index contiguous/non-sparse,
- remove dari tengah dapat menyebabkan update banyak row,
- reorder adalah mutation database.

Cost model:

```text
Remove from end:
  cheap

Remove from middle:
  delete 1 row + update index many rows

Insert in middle:
  insert 1 row + update index many rows

Full reorder:
  update many rows
```

Gunakan untuk:

- workflow steps manual,
- ordered checklist,
- ordered form sections,
- priority list kecil.

Jangan gunakan untuk:

- audit log,
- comments besar,
- document list besar,
- high-write event table.

---

### 4.4 `Set<T>`

```java
@OneToMany(mappedBy = "caseFile")
private Set<Document> documents = new HashSet<>();
```

`Set` menyatakan uniqueness di Java object model.

Karakteristik:

- tidak ada duplicate menurut `equals/hashCode`,
- tidak ada index,
- provider biasanya dapat membandingkan snapshot collection sebagai set,
- lebih aman dari duplicate object reference,
- tetapi sangat bergantung pada correctness `equals/hashCode`.

Risiko besar:

```java
@Entity
public class Document {
    @Id
    @GeneratedValue
    private Long id;

    @Override
    public boolean equals(Object o) {
        return id != null && id.equals(((Document) o).id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

Jika entity dimasukkan ke `HashSet` sebelum ID generated, lalu ID berubah setelah persist, hash bucket bisa rusak.

Lebih aman:

- gunakan immutable natural key jika benar-benar stabil,
- gunakan carefully designed equals/hashCode,
- jangan expose mutable set sembarangan,
- atau gunakan `List` plus database unique constraint jika uniqueness adalah database invariant.

Penting:

> `Set` di Java tidak otomatis membuat unique constraint di database.

Jika uniqueness penting, tambahkan constraint:

```java
@Table(
    name = "case_document",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_case_document_case_file_name",
        columnNames = {"case_id", "file_name"}
    )
)
```

---

### 4.5 `SortedSet<T>` and Provider-Specific Sorting

```java
@OneToMany(mappedBy = "caseFile")
@OrderBy("uploadedAt ASC")
private SortedSet<Document> documents = new TreeSet<>();
```

Ada dua jenis ordering:

```text
Database ordering:
  ORDER BY in SQL

In-memory sorting:
  Comparator / Comparable after data loaded
```

Jangan samakan keduanya.

Jika collection besar, sorting di memory berarti:

- semua row harus diload,
- object harus dihydrate,
- baru disort.

Untuk query list screen, lebih baik pakai query eksplisit dengan pagination daripada persistent collection sorted besar.

---

### 4.6 `Map<K,V>`

```java
@OneToMany(mappedBy = "caseFile")
@MapKey(name = "documentType")
private Map<DocumentType, Document> documentByType = new HashMap<>();
```

Map menyatakan lookup berdasarkan key.

Ada beberapa model:

#### Key dari atribut entity value

```java
@OneToMany(mappedBy = "caseFile")
@MapKey(name = "code")
private Map<String, ChecklistItem> itemsByCode;
```

Key berasal dari column milik child entity.

#### Key basic di collection table / join table

```java
@ElementCollection
@CollectionTable(name = "case_metadata")
@MapKeyColumn(name = "meta_key")
@Column(name = "meta_value")
private Map<String, String> metadata;
```

Key disimpan sebagai column terpisah di collection table.

#### Key entity

```java
@ManyToMany
@MapKeyJoinColumn(name = "role_id")
private Map<Role, PermissionGrant> grants;
```

Gunakan map jika:

- lookup by key adalah operasi domain utama,
- key stabil,
- key uniqueness adalah invariant,
- database constraint bisa mendukung key uniqueness.

Hindari map jika:

- hanya untuk convenience read,
- key mutable,
- key tidak unik secara database,
- collection besar dan sering dimuat hanya untuk lookup satu item.

Untuk lookup satu item dari collection besar, query repository sering lebih baik:

```java
Optional<Document> findByCaseIdAndDocumentType(Long caseId, DocumentType type);
```

---

## 5. Relational Shapes of Collection Mapping

### 5.1 FK-Based One-To-Many

Relational shape:

```text
case_file
---------
id PK

case_document
-------------
id PK
case_file_id FK -> case_file.id
```

Java:

```java
@Entity
public class CaseFile {
    @OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CaseDocument> documents = new ArrayList<>();
}

@Entity
public class CaseDocument {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "case_file_id", nullable = false)
    private CaseFile caseFile;
}
```

Ini biasanya bentuk terbaik untuk child entity yang punya lifecycle dan identity.

Kelebihan:

- child row punya PK,
- FK jelas,
- update/delete row spesifik efisien,
- mudah diberi audit,
- mudah query child langsung,
- mudah index child.

Kekurangan:

- bidirectional invariant harus dijaga,
- parent collection besar bisa mahal jika selalu dimuat,
- cascade harus dibatasi aggregate boundary.

---

### 5.2 Join Table One-To-Many

Relational shape:

```text
case_file
---------
id PK

case_document
-------------
id PK

case_file_document
------------------
case_file_id FK
case_document_id FK
```

Java:

```java
@OneToMany
@JoinTable(
    name = "case_file_document",
    joinColumns = @JoinColumn(name = "case_file_id"),
    inverseJoinColumns = @JoinColumn(name = "document_id")
)
private List<CaseDocument> documents = new ArrayList<>();
```

Ini jarang menjadi pilihan terbaik untuk true parent-child. Join table cocok jika:

- child tidak boleh punya FK ke parent,
- association punya lifecycle berbeda,
- schema legacy sudah begitu,
- association itself butuh metadata, tetapi kalau butuh metadata sebaiknya jadikan entity association.

Jika join table butuh metadata:

```text
case_file_document
------------------
id PK
case_file_id FK
case_document_id FK
linked_at
linked_by
link_reason
```

Lebih baik mapping sebagai entity:

```java
@Entity
public class CaseDocumentLink {
    @ManyToOne(fetch = LAZY)
    private CaseFile caseFile;

    @ManyToOne(fetch = LAZY)
    private CaseDocument document;

    private Instant linkedAt;
    private String linkedBy;
}
```

Rule:

> Jika join table punya business meaning, jangan sembunyikan sebagai `@ManyToMany` atau collection biasa. Jadikan entity.

---

### 5.3 Many-To-Many

```java
@ManyToMany
@JoinTable(
    name = "user_role",
    joinColumns = @JoinColumn(name = "user_id"),
    inverseJoinColumns = @JoinColumn(name = "role_id")
)
private Set<Role> roles = new HashSet<>();
```

Many-to-many sering terlihat praktis, tetapi production design sering lebih baik memakai association entity.

Problem many-to-many:

- join row tidak punya identity domain,
- sulit audit siapa menambahkan role,
- sulit validasi status grant,
- sulit soft delete grant,
- sulit versioning association,
- cascade remove berbahaya,
- collection mutation bisa mahal.

Lebih baik:

```java
@Entity
public class UserRoleGrant {
    @ManyToOne(fetch = LAZY)
    private User user;

    @ManyToOne(fetch = LAZY)
    private Role role;

    private Instant grantedAt;
    private String grantedBy;
    private GrantStatus status;
}
```

Rule:

> Use direct `@ManyToMany` only for simple, stable, metadata-free associations. In enterprise systems, association entity is usually safer.

---

### 5.4 Element Collection Table

Relational shape:

```text
case_file
---------
id PK

case_tag
--------
case_file_id FK
value
```

Java:

```java
@ElementCollection
@CollectionTable(name = "case_tag", joinColumns = @JoinColumn(name = "case_file_id"))
@Column(name = "tag_value")
private Set<String> tags = new HashSet<>();
```

Element collection does not have entity identity.

Implication:

- provider treats element rows as part of owner state,
- mutation can become delete/reinsert depending provider and mapping,
- no independent repository identity,
- no lifecycle callback per element entity,
- no optimistic lock per element row.

Use it for small value collection.

Avoid it for operationally important rows.

---

## 6. Hibernate Behavior: Bags, Persistent Collections, and Multiple Bag Fetch

### 6.1 Persistent Collection Wrappers

Hibernate does not simply persist your `ArrayList` or `HashSet`. Once managed, collections are wrapped in Hibernate persistent collection implementations.

Conceptual model:

```text
Your field:
  List<Document>

Runtime managed value:
  PersistentBag / PersistentList / PersistentSet / PersistentMap
```

The wrapper knows:

- owner entity,
- collection role,
- session,
- initialized/uninitialized state,
- snapshot,
- queued operations,
- dirty flag,
- orphan detection.

This is why replacing collection instances can confuse persistence semantics.

Bad:

```java
public void setDocuments(List<Document> documents) {
    this.documents = documents;
}
```

Better:

```java
public void replaceDocuments(Collection<Document> newDocuments) {
    this.documents.clear();
    for (Document document : newDocuments) {
        addDocument(document);
    }
}
```

Even better: do not provide arbitrary setter for aggregate collection.

---

### 6.2 Bag Semantics

A Hibernate bag is unordered and may contain duplicates.

Common accidental bag:

```java
@OneToMany(mappedBy = "caseFile")
private List<Document> documents;
```

No `@OrderColumn`, no unique set semantics.

Problem:

```java
select cf.*,
       d.*,
       n.*
from case_file cf
left join document d on d.case_file_id = cf.id
left join note n on n.case_file_id = cf.id
where cf.id = ?
```

If case has:

- 10 documents,
- 20 notes,

result rows become:

```text
10 × 20 = 200 rows
```

Hibernate cannot reliably reconstruct multiple bag collections from a single cartesian result without ambiguity. This is why multiple bag fetch is restricted.

---

### 6.3 MultipleBagFetchException

A classic Hibernate error:

```text
org.hibernate.loader.MultipleBagFetchException:
cannot simultaneously fetch multiple bags
```

This usually happens when trying to join fetch multiple bag-like `List` collections.

Example:

```java
select cf
from CaseFile cf
left join fetch cf.documents
left join fetch cf.notes
where cf.id = :id
```

If both `documents` and `notes` are bags, Hibernate may reject this fetch plan.

Do not blindly fix by changing all `List` to `Set`.

Better options:

1. Fetch one collection with join fetch, another with batch/subselect.
2. Use DTO projection.
3. Split query intentionally.
4. Use entity graph carefully.
5. Use `@OrderColumn` only if persistent order is real.
6. Use `Set` only if uniqueness semantics are correct.

---

### 6.4 Hibernate Collection Mutation Cost

Hibernate dirty-checks collections by comparing current state with snapshot.

Cost depends on:

- collection size,
- collection type,
- element equality/hash,
- identifier availability,
- orphan removal,
- order column,
- inverse vs owning side,
- initialized state.

Example collection remove:

```java
caseFile.getDocuments().remove(document);
```

Possible SQL patterns:

```sql
-- FK unlink
update case_document
set case_file_id = null
where id = ?;
```

```sql
-- orphan removal
Delete from case_document
where id = ?;
```

```sql
-- join table unlink
Delete from case_file_document
where case_file_id = ? and document_id = ?;
```

```sql
-- element collection recreation
Delete from case_tag
where case_file_id = ?;

insert into case_tag(case_file_id, tag_value) values (?, ?);
insert into case_tag(case_file_id, tag_value) values (?, ?);
```

One Java operation can become many different SQL shapes.

---

## 7. EclipseLink Behavior: Indirection, Weaving, Change Tracking, and Collections

EclipseLink approaches collection persistence with concepts such as:

- indirection/lazy loading,
- weaving,
- descriptors,
- UnitOfWork,
- change tracking policies,
- relationship mappings,
- collection mappings,
- batch reading and join fetching.

Where Hibernate often exposes terms like `PersistentBag` and `PersistentSet`, EclipseLink often emphasizes descriptor metadata and weaving-based indirection.

Key practical implications:

1. Weaving matters for lazy and change tracking behavior.
2. Change tracking may be attribute/object/deferred depending configuration.
3. Shared cache behavior can affect relationship reads.
4. Batch reading strategy can avoid N+1 without join-fetching every collection.
5. Provider-specific annotations/extensions may be useful but reduce portability.

EclipseLink does not always fail in the same way as Hibernate. That does not mean the fetch plan is safe. A provider may allow a query but still produce cartesian explosion or excessive hydration.

Rule:

> Absence of Hibernate's `MultipleBagFetchException` does not mean multiple collection join fetch is good design.

---

## 8. Ordering Semantics in Depth

### 8.1 Three Kinds of Order

```text
1. No order
   Collection has no durable order contract.

2. Query order
   Order determined when loading using ORDER BY.

3. Persistent position order
   Order stored as index/position column.
```

Mapping examples:

```java
// 1. No durable order
@OneToMany(mappedBy = "caseFile")
private Set<Document> documents;

// 2. Query order
@OneToMany(mappedBy = "caseFile")
@OrderBy("uploadedAt DESC")
private List<Document> documents;

// 3. Persistent position order
@OneToMany(mappedBy = "caseFile")
@OrderColumn(name = "step_order")
private List<ApprovalStep> steps;
```

---

### 8.2 `@OrderBy` Uses Entity Attributes

`@OrderBy` references persistent fields/properties.

```java
@OrderBy("createdAt DESC, id ASC")
private List<Comment> comments;
```

Pros:

- no extra order column,
- stable if sorted by immutable fields,
- efficient with correct index,
- no reorder mutation.

Cons:

- not suitable for manual custom ordering,
- order may change if field changes,
- database sort cost if no index,
- not necessarily deterministic without tie breaker.

Good practice:

```java
@OrderBy("createdAt DESC, id DESC")
private List<CaseNote> notes;
```

Use tie-breaker to avoid unstable order when timestamps equal.

---

### 8.3 `@OrderColumn` Stores Position

```java
@OrderColumn(name = "position_no")
private List<ApprovalStep> steps;
```

The provider maintains position values. JPA expects contiguous integral positions, with first element normally position 0.

Cost example:

Initial:

```text
A: 0
B: 1
C: 2
D: 3
```

Remove B:

```text
A: 0
C: 1
D: 2
```

SQL might require:

```sql
delete from approval_step where id = :B;
update approval_step set position_no = 1 where id = :C;
update approval_step set position_no = 2 where id = :D;
```

For 5 elements, fine. For 50,000 elements, disastrous.

---

### 8.4 Business Rule for Ordering

Ask:

```text
If I reload this aggregate tomorrow, must the exact order be the same even if no sortable field changes?
```

If yes:

- use explicit position column,
- keep collection bounded,
- protect reorder operation transactionally,
- add unique constraint `(parent_id, position)` if possible,
- consider gap-based ordering for large lists outside standard `@OrderColumn`.

If no:

- prefer `@OrderBy` or query-level `ORDER BY`,
- avoid persistent index.

For complex reorder use case, sometimes ORM `@OrderColumn` is too naive. A custom `position` field on child entity may give more control:

```java
@Entity
class ApprovalStep {
    @ManyToOne(fetch = LAZY)
    private ApprovalFlow flow;

    @Column(name = "position_no", nullable = false)
    private int position;
}
```

Then order through query:

```java
@OrderBy("position ASC")
private List<ApprovalStep> steps;
```

This makes position an explicit domain field instead of hidden collection index.

---

## 9. Element Collection Deep Dive

### 9.1 Basic Value Collection

```java
@ElementCollection
@CollectionTable(name = "case_tag", joinColumns = @JoinColumn(name = "case_id"))
@Column(name = "tag")
private Set<String> tags = new HashSet<>();
```

Good for:

- small tags,
- labels,
- flags,
- simple value list,
- no independent lifecycle.

But beware:

- no entity ID,
- no lifecycle callback,
- limited auditability,
- mutation may be coarse-grained,
- hard to reference one element row.

---

### 9.2 Embeddable Value Collection

```java
@Embeddable
public class ContactSnapshot {
    private String name;
    private String email;
    private String phone;
}

@ElementCollection
@CollectionTable(name = "case_contact_snapshot", joinColumns = @JoinColumn(name = "case_id"))
private List<ContactSnapshot> contacts = new ArrayList<>();
```

This models value snapshots.

Good if:

- contact snapshot belongs only to case,
- no independent identity,
- size bounded,
- update frequency low.

Bad if:

- contact can be edited independently,
- contact row needs approval status,
- contact row needs audit lifecycle,
- collection can become large,
- queries often filter by contact.

When element starts having lifecycle, promote it to entity.

---

### 9.3 Element Collection Mutation Problem

Suppose:

```java
caseFile.getTags().remove("urgent");
caseFile.getTags().add("priority");
```

Depending provider and mapping, SQL may be:

```sql
delete from case_tag
where case_id = ? and tag = ?;

insert into case_tag(case_id, tag)
values (?, ?);
```

Or less granular:

```sql
delete from case_tag
where case_id = ?;

insert into case_tag(case_id, tag) values (?, ?);
insert into case_tag(case_id, tag) values (?, ?);
insert into case_tag(case_id, tag) values (?, ?);
```

For small collection, acceptable. For large collection, dangerous.

Rule:

> Element collection is best for small, bounded, value-like data. If row-level mutation efficiency matters, use entity.

---

## 10. Collection Encapsulation and Domain Methods

Expose collection carefully.

Bad:

```java
public List<Document> getDocuments() {
    return documents;
}

public void setDocuments(List<Document> documents) {
    this.documents = documents;
}
```

This allows any caller to:

- replace provider wrapper,
- break bidirectional association,
- bypass validation,
- create orphan leaks,
- add child from wrong aggregate,
- mutate collection outside transaction.

Better:

```java
public List<Document> getDocumentsView() {
    return Collections.unmodifiableList(documents);
}

public void addDocument(Document document) {
    Objects.requireNonNull(document, "document");

    if (document.getCaseFile() != null && document.getCaseFile() != this) {
        throw new IllegalArgumentException("Document already belongs to another case file");
    }

    documents.add(document);
    document.attachTo(this);
}

public void removeDocument(Document document) {
    if (documents.remove(document)) {
        document.detachFromCaseFile();
    }
}
```

For bidirectional association:

```java
@Entity
public class CaseFile {
    @OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Document> documents = new ArrayList<>();

    public void addDocument(Document document) {
        documents.add(document);
        document.setCaseFile(this);
    }

    public void removeDocument(Document document) {
        documents.remove(document);
        document.setCaseFile(null);
    }
}
```

But if `caseFile` should never be null because `optional = false`, use domain method that transitions document to removed/deleted rather than setting invalid state outside flush.

---

## 11. Fetching Collections Without Destroying Performance

### 11.1 Lazy by Default

Collection relationships should generally be lazy.

```java
@OneToMany(mappedBy = "caseFile", fetch = FetchType.LAZY)
private List<Document> documents;
```

For `@OneToMany` and `@ManyToMany`, JPA default is lazy. Keep it that way unless there is a very strong reason.

Avoid:

```java
@OneToMany(fetch = FetchType.EAGER)
private List<Document> documents;
```

EAGER collection creates global cost:

- every load of parent may load child,
- hard to override,
- can create huge query graph,
- can cause multiple collection fetch issue,
- can overload list endpoints.

---

### 11.2 Join Fetch One Collection Carefully

```java
select cf
from CaseFile cf
left join fetch cf.documents
where cf.id = :id
```

Good for:

- loading one aggregate detail,
- collection bounded,
- one collection only,
- no pagination root issue.

Bad for:

- list screen,
- multiple large collections,
- pagination,
- reporting.

If parent has many children, join fetch duplicates parent row in result set.

---

### 11.3 Batch Fetch

Batch fetching loads collections/entities in groups.

Concept:

```text
Instead of:
  select docs where case_id = 1
  select docs where case_id = 2
  select docs where case_id = 3

Use:
  select docs where case_id in (1, 2, 3, ...)
```

Hibernate has batch fetch configuration. EclipseLink has batch reading. Both aim to reduce N+1 while avoiding huge cartesian join.

Use for:

- list page displaying small child summary,
- many parents with one collection each,
- avoiding multiple join fetch.

---

### 11.4 Subselect Fetch

Subselect fetch concept:

```sql
select *
from document
where case_file_id in (
    select id
    from case_file
    where status = 'OPEN'
)
```

Useful when loading collection for many parents returned by previous query.

Risks:

- subselect may be large,
- depends on provider behavior,
- can surprise if parent query broad.

---

### 11.5 DTO Projection Instead of Persistent Collection

For screens, reports, and APIs, often better:

```java
select new CaseDocumentRow(
    d.id,
    d.fileName,
    d.uploadedAt,
    d.status
)
from Document d
where d.caseFile.id = :caseId
order by d.uploadedAt desc
```

Benefits:

- no collection initialization,
- no dirty checking overhead,
- no accidental cascade mutation,
- precise columns,
- pagination friendly.

Rule:

> Persistent collections are for aggregate behavior. DTO queries are for read use cases.

---

## 12. Mutation Patterns and SQL Consequences

### 12.1 Add Child to FK-Based One-To-Many

Java:

```java
caseFile.addDocument(document);
```

SQL:

```sql
insert into case_document(id, case_file_id, file_name, uploaded_at)
values (?, ?, ?, ?);
```

If child already exists:

```sql
update case_document
set case_file_id = ?
where id = ?;
```

Risk:

- moving child between aggregate may violate business invariant,
- FK update may be unexpected,
- child can accidentally be stolen from another parent.

Domain guard:

```java
if (document.hasCaseFile() && !document.belongsTo(this)) {
    throw new IllegalStateException("Cannot move document between case files");
}
```

---

### 12.2 Remove Child with Orphan Removal

Java:

```java
caseFile.removeDocument(document);
```

Mapping:

```java
@OneToMany(mappedBy = "caseFile", orphanRemoval = true)
private List<Document> documents;
```

SQL:

```sql
delete from case_document
where id = ?;
```

Good if child lifecycle truly belongs to parent.

Dangerous if child is shared or historically important.

For regulatory systems, physical delete may be wrong. Consider:

- status transition to `REMOVED`,
- soft delete with `removed_at`,
- audit event,
- historical table,
- immutable document version rows.

---

### 12.3 Remove Child Without Orphan Removal

SQL may be:

```sql
update case_document
set case_file_id = null
where id = ?;
```

If FK nullable false:

```text
Constraint violation at flush
```

This often surprises developers because Java remove looked valid until flush.

Rule:

> Collection remove must match database FK nullability and lifecycle semantics.

---

### 12.4 Replacing Entire Collection

Java:

```java
caseFile.setDocuments(newDocuments);
```

Potential effects:

- provider wrapper replaced,
- old elements orphaned,
- delete all old rows,
- insert new rows,
- missing bidirectional links,
- optimistic lock conflict,
- high SQL volume.

Use explicit reconciliation instead:

```java
public void reconcileDocuments(Collection<DocumentCommand> commands) {
    // 1. index existing by stable identity
    // 2. update existing
    // 3. add new
    // 4. remove missing according to business rule
}
```

For API update, never blindly map request DTO collection into entity collection.

---

## 13. Collection Mapping Anti-Patterns

### 13.1 `@ManyToMany` for Business Relationship with Metadata

Bad:

```java
@ManyToMany
private Set<User> assignedOfficers;
```

When assignment needs:

- assigned date,
- assigned by,
- active/inactive,
- reason,
- workload state,
- audit.

Better:

```java
@OneToMany(mappedBy = "caseFile")
private Set<CaseOfficerAssignment> assignments;
```

---

### 13.2 Huge Persistent Collection

Bad:

```java
@OneToMany(mappedBy = "caseFile")
private List<AuditTrail> auditTrails;
```

If case can have 100,000 audit rows, do not model operational access as persistent collection.

Better:

```java
interface AuditTrailRepository {
    Page<AuditTrailRow> findByCaseId(Long caseId, Pageable pageable);
}
```

Entity may still have no collection field at all.

Rule:

> Not every FK deserves a Java collection.

---

### 13.3 EAGER Collection

Bad:

```java
@OneToMany(fetch = FetchType.EAGER)
private List<CaseNote> notes;
```

Problem:

- global read tax,
- hidden SQL,
- impossible to load parent cheaply,
- multiple eager collections explode.

Use query-specific fetch plan instead.

---

### 13.4 Public Mutable Collection Setter

Bad:

```java
public void setItems(List<Item> items) {
    this.items = items;
}
```

This breaks aggregate invariant.

Better:

```java
public void addItem(Item item)
public void removeItem(Item item)
public void reorderItems(List<ItemId> orderedIds)
```

Expose domain operations, not storage.

---

### 13.5 `Set` to Hide Duplicate Result Problem

Changing `List` to `Set` only to avoid duplicate root results or multiple bag fetch can be misleading.

Question first:

```text
Is uniqueness part of domain semantics?
```

If no, fix fetch plan, not collection type.

---

### 13.6 `@ElementCollection` for Important Rows

Bad:

```java
@ElementCollection
private List<ComplianceCheckResult> checkResults;
```

If each result has:

- status,
- reviewer,
- timestamp,
- correction lifecycle,
- audit,
- re-run history,

then it should be entity.

---

## 14. Choosing the Right Collection Type

### 14.1 Decision Table

| Need | Prefer | Avoid |
|---|---|---|
| Child has identity/lifecycle | `@OneToMany` to entity | `@ElementCollection` |
| Small value collection | `@ElementCollection` | Entity overengineering |
| Unique elements in domain | `Set` + DB unique constraint | `List` only |
| Durable manual order | `List` + explicit position / `@OrderColumn` | `@OrderBy` only |
| Sorted by existing field | `@OrderBy` or query order | `@OrderColumn` |
| Large child list | Repository query/page | Persistent collection load |
| Association has metadata | Association entity | `@ManyToMany` |
| Multiple child collections in detail view | Split fetch / batch / DTO | multiple join fetch bags |
| API partial update | Command reconciliation | direct DTO-to-entity collection replace |

---

### 14.2 Heuristic

Use this mental checklist:

```text
1. Does each element have identity?
   yes → entity
   no  → maybe embeddable/basic element

2. Can the collection become large?
   yes → avoid loading as persistent collection for read screens

3. Is order business state?
   yes → explicit position
   no  → query order

4. Is uniqueness business state?
   yes → Set maybe, but DB unique constraint mandatory

5. Does association have metadata?
   yes → association entity

6. Will we frequently fetch multiple collections together?
   yes → design fetch plan intentionally

7. Will external API replace this collection?
   yes → use reconciliation command, not direct assignment
```

---

## 15. Production Failure Modes

### 15.1 Cartesian Explosion

Symptom:

- endpoint suddenly returns slowly,
- SQL row count huge,
- DB CPU high,
- app memory high,
- duplicate root objects internally deduplicated.

Cause:

```java
left join fetch cf.documents
left join fetch cf.notes
left join fetch cf.assignments
```

If counts are:

```text
documents: 10
notes: 20
assignments: 5
```

Rows:

```text
10 × 20 × 5 = 1000 rows for one parent
```

Fix:

- fetch one collection at most via join,
- batch fetch others,
- split queries,
- use DTO projections,
- design read model.

---

### 15.2 Delete-All-Insert-All Storm

Symptom:

- small UI change causes many deletes/inserts,
- audit shows many row changes,
- optimistic lock conflicts,
- DB redo/undo high.

Cause:

- element collection mutation,
- bag without row identity,
- replacing collection instance,
- poor reconciliation.

Fix:

- promote element to entity,
- use stable row identity,
- mutate incrementally,
- avoid collection replacement,
- introduce association entity.

---

### 15.3 Unstable Ordering

Symptom:

- same data appears in different order between page refreshes,
- tests flaky,
- approval steps reorder unexpectedly.

Cause:

- no `ORDER BY`,
- `@OrderBy` without tie-breaker,
- relying on DB natural order,
- using `HashSet` where order matters.

Fix:

- explicit query order,
- `@OrderBy("createdAt ASC, id ASC")`,
- explicit position field,
- deterministic comparator for in-memory only.

---

### 15.4 Duplicate Child Rows

Symptom:

- join table has duplicate rows,
- UI shows same role/permission twice,
- remove removes one but duplicate remains.

Cause:

- no unique constraint,
- broken `equals/hashCode`,
- bag allows duplicate,
- add method lacks guard.

Fix:

- DB unique constraint,
- domain guard,
- correct collection type,
- correct equality strategy.

---

### 15.5 Lazy Initialization Exception

Symptom:

```text
failed to lazily initialize a collection of role ... no Session
```

Cause:

- collection accessed outside persistence context,
- DTO mapping after transaction,
- serialization touches lazy field,
- OSIV disabled without explicit fetch plan.

Fix:

- query-specific fetch plan,
- DTO inside transaction,
- avoid exposing entity to API layer,
- avoid relying on OSIV.

---

### 15.6 Huge Persistence Context

Symptom:

- batch job memory grows,
- flush slow,
- GC pressure,
- OOM.

Cause:

```java
List<CaseFile> cases = findAll();
for (CaseFile c : cases) {
    c.getDocuments().size();
}
```

Or:

```java
for (...) {
    entityManager.persist(entity);
}
// no flush/clear
```

Fix:

- pagination/streaming,
- DTO queries,
- batch flush/clear,
- stateless session/provider-specific bulk strategy,
- avoid loading huge collection.

---

## 16. Design Patterns for Enterprise/Regulatory Systems

### 16.1 Document Collection

Documents often look like child collection:

```java
@OneToMany(mappedBy = "caseFile")
private List<Document> documents;
```

But ask:

- can document be replaced?
- do we need versions?
- do we need deletion audit?
- can one document belong to multiple case records?
- is order meaningful?
- are documents queried independently?

Often better:

```java
@Entity
class CaseDocument {
    @ManyToOne(fetch = LAZY)
    private CaseFile caseFile;

    private String fileName;
    private String storageKey;
    private DocumentStatus status;
    private Instant uploadedAt;
    private String uploadedBy;
    private boolean removed;
}
```

Access with repository query for large list.

---

### 16.2 Approval Steps

Approval steps have order and state.

Do not hide position as pure `@OrderColumn` if position has business meaning.

Prefer:

```java
@Entity
class ApprovalStep {
    @ManyToOne(fetch = LAZY)
    private ApprovalFlow flow;

    @Column(nullable = false)
    private int position;

    @Enumerated(EnumType.STRING)
    private ApprovalStepStatus status;
}
```

Then:

```java
@OneToMany(mappedBy = "flow", cascade = ALL, orphanRemoval = true)
@OrderBy("position ASC")
private List<ApprovalStep> steps;
```

Now position is explicit, queryable, auditable, and controllable.

---

### 16.3 Audit Trail

Do not map huge audit trail as normal aggregate collection.

Bad:

```java
@OneToMany(mappedBy = "caseFile")
private List<AuditTrail> auditTrails;
```

Better:

```java
class AuditTrailRepository {
    Page<AuditTrailRow> findByCaseId(Long caseId, AuditTrailFilter filter, Pageable pageable);
}
```

Audit trail is usually append-only read model, not aggregate child manipulated through parent.

---

### 16.4 Assignment History

Assignment should often be association entity:

```java
@Entity
class CaseAssignment {
    @ManyToOne(fetch = LAZY)
    private CaseFile caseFile;

    @ManyToOne(fetch = LAZY)
    private Officer officer;

    private Instant assignedAt;
    private Instant unassignedAt;
    private String assignedBy;
    private AssignmentReason reason;
}
```

Avoid:

```java
@ManyToMany
private Set<Officer> officers;
```

Because assignment has lifecycle and audit meaning.

---

## 17. Java 8–25 Compatibility Notes

### 17.1 Java Collection APIs

Java 8 baseline still uses mutable collections commonly:

```java
new ArrayList<>()
new HashSet<>()
```

Modern Java offers:

```java
List.of(...)
Set.of(...)
Map.of(...)
```

Do not use immutable collection factories as entity collection fields:

```java
private List<Document> documents = List.of(); // bad for ORM mutation
```

Provider needs mutable collection for managed association.

Use:

```java
private List<Document> documents = new ArrayList<>();
```

Expose immutable view externally:

```java
public List<Document> documents() {
    return Collections.unmodifiableList(documents);
}
```

Or in Java 10+:

```java
return List.copyOf(documents);
```

Be careful: `List.copyOf` creates copy; it is fine for read view, not for managed field.

---

### 17.2 Records Are Not Entity Collections

Java records are attractive for DTOs and value carriers.

Good:

```java
public record DocumentRow(Long id, String fileName, Instant uploadedAt) {}
```

Avoid treating records as JPA entities in normal mutable ORM design. JPA entities need identity, lifecycle, proxy/enhancement compatibility, and mutable persistence state depending provider.

Records can be useful for:

- DTO projection,
- query result models,
- immutable command/read objects.

---

### 17.3 Sequenced Collections

Modern Java added sequenced collection APIs. Do not assume ORM providers interpret these APIs as persistent order semantics.

Persistent order remains determined by mapping:

- `@OrderBy`,
- `@OrderColumn`,
- provider-specific sorting,
- query `ORDER BY`.

Java collection API order is not enough.

---

## 18. Testing Collection Mapping Correctness

### 18.1 Test SQL Count

For fetch plans, assert query counts.

Scenario:

```text
Load 20 case files and display document count.
```

Bad:

```text
1 query for cases
20 queries for documents
```

Better:

```text
1 query for cases
1 query for documents batch
```

Use SQL logging/statistics in integration tests.

---

### 18.2 Test Mutation SQL Shape

Test:

- add child,
- remove child,
- reorder child,
- replace incoming collection,
- remove orphan,
- duplicate add.

Verify:

- expected rows exist,
- no duplicate join rows,
- FK nullability not violated,
- version behavior expected,
- SQL volume acceptable.

---

### 18.3 Test Provider-Specific Edge Cases

For Hibernate:

- multiple bag fetch,
- `PersistentSet` equality,
- orphan removal with collection replacement,
- order column reorder.

For EclipseLink:

- weaving enabled/disabled,
- lazy relationship behavior,
- shared cache relationship staleness,
- batch reading strategy.

---

### 18.4 Avoid H2-Only Confidence

Collection mapping bugs often depend on:

- FK enforcement,
- unique constraints,
- lock behavior,
- timestamp precision,
- SQL dialect,
- pagination/fetch join behavior.

Use Testcontainers or real database for provider-level correctness.

---

## 19. Diagnostic Checklist

When collection behavior is suspicious, ask:

### Mapping

- Is this entity collection or element collection?
- Is owner side correct?
- Is FK nullable consistent with remove behavior?
- Is orphan removal correct?
- Is cascade crossing aggregate boundary?
- Is many-to-many hiding association metadata?

### Semantics

- Does order matter?
- Does uniqueness matter?
- Does element have independent lifecycle?
- Can collection become large?
- Is collection part of aggregate or only navigation?

### SQL

- How many SQL statements for add/remove/reorder?
- Does remove cause delete or FK null update?
- Does reorder update many rows?
- Does fetch create cartesian product?
- Is pagination applied safely?

### Runtime

- Is collection initialized unexpectedly?
- Is lazy collection accessed outside transaction?
- Is persistence context retaining too many children?
- Is second-level cache involved?
- Is collection wrapper replaced?

### Provider

- Hibernate: is this a bag?
- Hibernate: are multiple bags join-fetched?
- EclipseLink: is weaving active?
- EclipseLink: is shared cache returning stale relationship?
- Are provider-specific optimizations configured and tested?

---

## 20. Design Rules

1. **Do not map every FK as a collection.**  
   A Java collection is a behavioral and performance commitment.

2. **Use `@ManyToOne` as the relational anchor.**  
   Parent collection is often optional navigation.

3. **Prefer association entity over `@ManyToMany` when relationship has metadata.**

4. **Use `@ElementCollection` only for small, bounded value collections.**

5. **Do not use EAGER collections by default.**

6. **Do not expose mutable collection setters.**

7. **Use domain methods to maintain bidirectional invariants.**

8. **Do not use `Set` unless uniqueness is truly part of the domain.**

9. **Back Java uniqueness with database unique constraints.**

10. **Use `@OrderBy` for derived order, `@OrderColumn` or explicit position for persistent order.**

11. **Avoid multiple collection join fetches.**

12. **Use DTO/read queries for large read screens.**

13. **Test collection mutation behavior with the real database dialect.**

14. **Treat collection replacement from API DTO as dangerous.**

15. **Make collection size assumptions explicit.**

---

## 21. Practice Scenarios

### Scenario 1 — Case Documents

Requirement:

- case can have many documents,
- documents can be uploaded, removed, restored,
- document list sorted by upload time,
- removed documents still auditable.

Recommended:

- `Document` as entity,
- FK to `CaseFile`,
- no physical orphan removal for business remove,
- `removedAt`, `removedBy`, status,
- query-level pagination,
- no eager collection,
- maybe no parent collection for audit-heavy access.

---

### Scenario 2 — Approval Flow Steps

Requirement:

- approval flow has ordered steps,
- user can reorder pending steps,
- each step has status and reviewer.

Recommended:

- `ApprovalStep` entity,
- explicit `position` column,
- unique constraint `(flow_id, position)` if feasible,
- `@OrderBy("position ASC")`,
- domain method `reorderSteps`,
- optimistic lock on flow or step group.

---

### Scenario 3 — Case Tags

Requirement:

- small set of tags,
- tags are strings,
- no independent lifecycle,
- rarely updated.

Recommended:

- `@ElementCollection Set<String>`,
- collection table with unique constraint `(case_id, tag)`,
- avoid huge tag collection,
- query carefully if filtering by tag often.

If tag filtering becomes core feature, consider tag entity/read index.

---

### Scenario 4 — User Roles

Requirement:

- user has roles,
- role grant has grantedBy, grantedAt, expiryDate, status.

Recommended:

- `UserRoleGrant` association entity,
- not direct `@ManyToMany`,
- unique active grant constraint,
- audit fields,
- status transitions.

---

### Scenario 5 — Audit Trail

Requirement:

- case has audit trail,
- thousands or millions of rows,
- viewed paginated,
- append-only.

Recommended:

- no parent persistent collection,
- repository query by case ID,
- index `(case_id, created_at)`,
- DTO projection,
- archive strategy,
- no cascade from case.

---

## 22. Summary

Collection mapping is deceptively simple because Java makes collections easy. ORM makes them hard because each collection is also a database synchronization problem.

The top-level lesson:

```text
Choose collection mapping based on domain semantics, relational shape, mutation behavior, and fetch strategy — not based on Java API convenience.
```

Key takeaways:

- `List` without persistent order may behave like a bag in Hibernate.
- `Set` requires correct equality and database constraints.
- `Map` is useful only when key-based lookup is real domain behavior.
- `@OrderBy` sorts on load; `@OrderColumn` stores position.
- `@ElementCollection` is for small value collections, not important lifecycle rows.
- `@ManyToMany` is often too weak for enterprise relationships.
- Large collections should be queried, paged, and projected, not blindly loaded through parent entity.
- Multiple collection join fetches can create cartesian explosion.
- Collection replacement from DTOs is dangerous.
- Provider behavior matters: Hibernate bags and EclipseLink weaving/change tracking can produce different operational outcomes.

A strong ORM engineer does not ask only:

```text
Should I use List or Set?
```

They ask:

```text
What invariant does this collection represent?
What rows exist because of it?
What SQL occurs when it changes?
What happens when it grows 100x?
What breaks under concurrent update?
What does the provider actually do?
```

That is the mindset that separates annotation-level JPA usage from production-grade persistence engineering.

---

## 23. References

- Jakarta Persistence 3.2 Specification and API Documentation
- Jakarta Persistence `@ElementCollection`, `@CollectionTable`, `@OrderBy`, `@OrderColumn`, `@MapKeyColumn` API contracts
- Hibernate ORM User Guide — Collections, Associations, Fetching, Batch Fetching, Persistent Collections
- Hibernate ORM documentation and community guidance on bags and multiple bag fetching
- EclipseLink Documentation — JPA relationships, collection mappings, weaving, sessions, cache, batch reading

---

## 24. Status Seri

Selesai: Part 10 dari 34.  
Berikutnya: `11-cascades-orphan-removal-lifecycle-aggregate-boundaries.md`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./09-association-mapping-ownership-foreign-keys-join-tables.md">⬅️ Part 9 — Association Mapping: Ownership, Foreign Keys, Join Tables, and Graph Mutation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./11-cascades-orphan-removal-lifecycle-aggregate-boundaries.md">Part 11 — Cascades, Orphan Removal, Lifecycle Propagation, and Aggregate Boundaries ➡️</a>
</div>

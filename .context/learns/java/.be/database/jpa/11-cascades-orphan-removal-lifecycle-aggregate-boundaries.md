# Part 11 — Cascades, Orphan Removal, Lifecycle Propagation, and Aggregate Boundaries

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `11-cascades-orphan-removal-lifecycle-aggregate-boundaries.md`  
> Scope Java: Java 8 sampai Java 25  
> Scope API: JPA 2.x `javax.persistence` dan Jakarta Persistence 3.x `jakarta.persistence`  
> Provider focus: Hibernate ORM dan EclipseLink

---

## 0. Posisi Bagian Ini Dalam Seri

Bagian sebelumnya membahas association mapping: ownership, foreign key, join table, dan cara graph object diterjemahkan menjadi relasi database. Bagian ini masuk ke lapisan yang lebih berbahaya: **lifecycle propagation**.

Association menjawab pertanyaan:

> “Entity A berhubungan dengan entity B lewat struktur relasional apa?”

Cascade menjawab pertanyaan lain:

> “Jika operasi lifecycle terjadi pada entity A, apakah operasi itu harus ikut terjadi pada entity B?”

Orphan removal menjawab pertanyaan yang lebih spesifik:

> “Jika child dilepas dari parent, apakah child itu masih boleh hidup sendiri?”

Aggregate boundary menjawab pertanyaan desain:

> “Apakah B benar-benar bagian dari lifecycle A, atau hanya entity lain yang kebetulan direferensikan A?”

Kesalahan di bagian ini bisa menghasilkan bug yang jauh lebih serius daripada N+1. N+1 biasanya memperlambat sistem. Cascade yang salah bisa **menghapus data produksi yang valid**.

---

## 1. Why This Matters

Cascade dan orphan removal sering terlihat seperti fitur convenience:

```java
@OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
private List<OrderLine> lines = new ArrayList<>();
```

Di permukaan, ini tampak sederhana:

- simpan `Order`, line ikut tersimpan;
- hapus `Order`, line ikut terhapus;
- buang line dari list, line ikut dihapus.

Tetapi secara engineering, annotation tersebut menyatakan kontrak besar:

> `OrderLine` tidak punya lifecycle independen dari `Order`.

Artinya:

- `OrderLine` tidak boleh dipakai bersama oleh beberapa `Order`;
- `OrderLine` tidak boleh tetap hidup tanpa `Order`;
- operasi persist/merge/remove pada `Order` boleh menjalar ke `OrderLine`;
- perubahan collection pada `Order` bisa menyebabkan `DELETE` fisik ke table `order_line`.

Untuk sistem enterprise, regulatory, case management, approval workflow, correspondence, audit trail, document registry, dan compliance lifecycle, ini sangat penting.

Contoh kesalahan fatal:

```java
@ManyToOne(cascade = CascadeType.REMOVE)
private User assignedOfficer;
```

Jika `Case` dihapus dan cascade remove menjalar ke `User`, maka user yang masih dipakai case lain bisa ikut terhapus. Ini bukan bug kecil. Ini data-loss bug.

---

## 2. Core Mental Model

### 2.1 Cascade Bukan Relationship

Relationship:

```java
@ManyToOne
private Customer customer;
```

berarti:

> `Order` mereferensikan `Customer`.

Cascade:

```java
@ManyToOne(cascade = CascadeType.PERSIST)
private Customer customer;
```

berarti:

> Ketika `Order` dipersist, provider boleh ikut mem-persist `Customer`.

Relationship adalah **structural link**. Cascade adalah **operation propagation rule**.

Jangan mencampur keduanya.

---

### 2.2 Cascade Bukan Database Cascade

ORM cascade terjadi di level provider:

```text
EntityManager.remove(parent)
        |
        v
provider traverses object graph
        |
        v
provider schedules child delete actions
        |
        v
SQL DELETE child, DELETE parent
```

Database cascade terjadi di level constraint:

```sql
foreign key (parent_id) references parent(id) on delete cascade
```

Flow-nya:

```text
DELETE FROM parent WHERE id = ?
        |
        v
Database automatically deletes child rows
```

Perbedaannya besar:

| Aspek | ORM Cascade | DB `ON DELETE CASCADE` |
|---|---|---|
| Dilakukan oleh | JPA provider | Database engine |
| Butuh object graph loaded? | Kadang ya, tergantung operasi/provider | Tidak |
| Entity listener terpanggil? | Biasanya ya untuk entity yang dikelola provider | Tidak untuk row yang dihapus database secara otomatis |
| Persistence context tahu child hilang? | Ya jika provider yang menghapus | Tidak otomatis jika DB yang cascade |
| Cocok untuk audit listener? | Lebih cocok | Tidak cukup jika audit di application layer |
| Cocok untuk massive delete? | Bisa mahal | Lebih efisien |
| Risiko stale persistence context | Lebih rendah | Lebih tinggi jika entity child sudah managed |

Kesimpulan desain:

> ORM cascade adalah lifecycle modeling. Database cascade adalah referential action optimization dan integrity rule.

Keduanya bisa dipakai bersama, tetapi harus sadar konsekuensinya.

---

### 2.3 Orphan Removal Bukan Cascade Remove

`CascadeType.REMOVE`:

> Jika parent dihapus, child ikut dihapus.

`orphanRemoval = true`:

> Jika child tidak lagi direferensikan oleh parent relationship, child dianggap yatim dan dihapus.

Contoh:

```java
Order order = em.find(Order.class, id);
OrderLine line = order.getLines().get(0);
order.getLines().remove(line);
line.setOrder(null);
```

Dengan `orphanRemoval = true`, provider akan menjadwalkan:

```sql
DELETE FROM order_line WHERE id = ?
```

Tanpa `orphanRemoval`, provider mungkin hanya melakukan:

```sql
UPDATE order_line SET order_id = NULL WHERE id = ?
```

atau gagal jika FK `NOT NULL`.

Jadi:

```text
Cascade REMOVE = parent dies, child dies.
Orphan removal = relationship removed, child dies.
```

---

### 2.4 Aggregate Boundary Adalah Dasar Cascade Yang Sehat

Cascade yang sehat biasanya mengikuti aggregate boundary.

Aggregate adalah boundary lifecycle dan consistency. Parent aggregate root mengontrol child internal.

Contoh baik:

```text
Order
 ├── OrderLine
 ├── ShippingInstruction
 └── PaymentAllocation
```

`OrderLine` biasanya tidak bermakna tanpa `Order`. Maka cascade persist/remove dan orphan removal mungkin masuk akal.

Contoh buruk:

```text
Case
 ├── assignedOfficer: User
 ├── agency: Agency
 ├── documentType: ReferenceCode
 └── relatedCase: Case
```

`User`, `Agency`, `ReferenceCode`, dan `Case` lain punya lifecycle sendiri. Cascade remove ke entity ini hampir pasti salah.

Rule awal:

> Cascade hanya aman jika target entity secara lifecycle dimiliki oleh source entity.

---

## 3. Cascade Types: Semantics, Not Decoration

JPA/Jakarta Persistence menyediakan cascade types:

```java
CascadeType.PERSIST
CascadeType.MERGE
CascadeType.REMOVE
CascadeType.REFRESH
CascadeType.DETACH
CascadeType.ALL
```

`ALL` berarti semua operasi di atas.

---

## 4. `CascadeType.PERSIST`

### 4.1 Semantics

`PERSIST` berarti:

> Saat parent baru dipersist, child baru yang reachable dari association juga ikut dipersist.

Contoh:

```java
Order order = new Order("ORD-001");
order.addLine(new OrderLine("SKU-1", 2));
order.addLine(new OrderLine("SKU-2", 1));

em.persist(order);
```

Mapping:

```java
@Entity
class Order {
    @Id
    @GeneratedValue
    private Long id;

    @OneToMany(mappedBy = "order", cascade = CascadeType.PERSIST)
    private List<OrderLine> lines = new ArrayList<>();

    public void addLine(OrderLine line) {
        lines.add(line);
        line.setOrder(this);
    }
}
```

Provider akan menjadwalkan insert untuk `Order` dan `OrderLine`.

---

### 4.2 Kapan Masuk Akal

Gunakan `PERSIST` jika:

- child dibuat bersama parent;
- child tidak dipakai oleh parent lain;
- child tidak punya lifecycle independen;
- child valid hanya jika parent valid;
- use case umum adalah membuat aggregate lengkap.

Contoh:

- `Order -> OrderLine`
- `Invoice -> InvoiceLine`
- `Survey -> SurveyQuestion`
- `CaseDraft -> CaseDraftAttachmentMetadata`

---

### 4.3 Kapan Berbahaya

Berbahaya pada association ke reference/master entity:

```java
@ManyToOne(cascade = CascadeType.PERSIST)
private Country country;
```

Jika request membuat `Address` membawa object `Country` baru dengan ID kosong, provider bisa mencoba insert country baru.

Bug umum:

```java
Address address = new Address();
address.setCountry(new Country("SG"));
em.persist(address);
```

Jika cascade persist aktif, sistem bisa insert duplicate country, atau gagal constraint.

Rule:

> Jangan cascade persist ke lookup/master/reference/shared entity.

---

## 5. `CascadeType.MERGE`

### 5.1 Semantics

`MERGE` berarti:

> Saat detached parent di-merge, state child reachable juga ikut disalin ke managed instance.

Penting:

```java
Order managed = em.merge(detachedOrder);
```

`merge()` tidak membuat `detachedOrder` menjadi managed. Ia membuat atau menemukan managed copy, lalu menyalin state dari detached graph.

---

### 5.2 Kenapa `MERGE` Lebih Berbahaya Dari Kelihatannya

Misalnya API menerima JSON:

```json
{
  "id": 10,
  "status": "SUBMITTED",
  "lines": []
}
```

Lalu code melakukan:

```java
Order detached = mapper.toEntity(request);
em.merge(detached);
```

Jika `Order.lines` punya cascade merge dan orphan removal, list kosong bisa diinterpretasikan sebagai:

> Semua line lama dihapus.

Ini bisa menyebabkan delete massal child row.

---

### 5.3 Merge Storm

`CascadeType.MERGE` pada graph besar bisa menyebabkan provider menelusuri banyak association.

Contoh buruk:

```java
@Entity
class CaseRecord {
    @ManyToOne(cascade = CascadeType.MERGE)
    private User assignedOfficer;

    @ManyToOne(cascade = CascadeType.MERGE)
    private Agency agency;

    @OneToMany(cascade = CascadeType.MERGE)
    private List<Document> documents;

    @OneToMany(cascade = CascadeType.MERGE)
    private List<CaseTask> tasks;
}
```

Jika detached `CaseRecord` di-merge, provider bisa mencoba merge banyak object yang sebenarnya bukan bagian dari update command.

Risiko:

- query tambahan untuk mencari managed copy;
- update field yang tidak dimaksud;
- overwrite stale data;
- optimistic locking conflict yang sulit dijelaskan;
- collection replacement;
- security mass assignment.

Rule:

> Untuk API boundary, lebih aman load managed aggregate lalu apply command secara eksplisit daripada merge detached graph mentah.

Pattern:

```java
@Transactional
public void changeCaseOfficer(Long caseId, Long officerId, long expectedVersion) {
    CaseRecord record = em.find(CaseRecord.class, caseId, LockModeType.OPTIMISTIC);

    if (record.getVersion() != expectedVersion) {
        throw new StaleCommandException();
    }

    User officerRef = em.getReference(User.class, officerId);
    record.assignOfficer(officerRef);
}
```

Bukan:

```java
em.merge(requestBodyMappedToEntity);
```

---

## 6. `CascadeType.REMOVE`

### 6.1 Semantics

`REMOVE` berarti:

> Saat parent dihapus dengan `EntityManager.remove(parent)`, remove operation menjalar ke child.

Contoh:

```java
Order order = em.find(Order.class, id);
em.remove(order);
```

Jika mapping:

```java
@OneToMany(mappedBy = "order", cascade = CascadeType.REMOVE)
private List<OrderLine> lines;
```

maka `OrderLine` ikut dihapus.

---

### 6.2 Kapan Masuk Akal

Masuk akal jika:

- child tidak boleh hidup tanpa parent;
- child tidak direferensikan parent lain;
- child bukan audit/history mandatory;
- delete parent memang domain operation valid.

Contoh:

- hapus draft dan draft line;
- hapus temporary import batch dan row staging;
- hapus unsent notification dan recipient rows.

---

### 6.3 Kapan Berbahaya

Jangan gunakan `REMOVE` dari child/transactional entity ke shared parent/reference.

Buruk:

```java
@ManyToOne(cascade = CascadeType.REMOVE)
private Customer customer;
```

Menghapus satu `Order` bisa mencoba menghapus `Customer`.

Buruk:

```java
@ManyToMany(cascade = CascadeType.REMOVE)
private Set<Role> roles;
```

Menghapus `User` bisa mencoba menghapus `Role`, padahal role dipakai user lain.

Rule keras:

> Hampir tidak pernah cascade remove dari `@ManyToOne` atau `@ManyToMany` ke entity target.

Kenapa “hampir”? Karena ada special case model private ownership yang sangat terkendali. Tetapi sebagai default engineering rule, hindari.

---

## 7. `CascadeType.REFRESH`

### 7.1 Semantics

`REFRESH` berarti:

> Saat parent di-refresh dari database, associated child juga ikut di-refresh.

Contoh:

```java
em.refresh(order);
```

Dengan cascade refresh, provider bisa reload child state juga.

---

### 7.2 Use Case

Jarang dipakai, tetapi bisa relevan ketika:

- database trigger mengubah beberapa table terkait;
- external process memperbarui child state;
- application perlu membuang local in-memory modifications dan reload graph.

---

### 7.3 Risiko

Risiko:

- local modification hilang;
- graph besar direload;
- unexpected SELECT storm;
- refresh child yang sebenarnya tidak dibutuhkan.

Rule:

> `REFRESH` cascade sebaiknya eksplisit dan jarang. Jangan masukkan ke `ALL` tanpa sadar.

---

## 8. `CascadeType.DETACH`

### 8.1 Semantics

`DETACH` berarti:

> Saat parent dilepas dari persistence context, associated child juga ikut detached.

Contoh:

```java
em.detach(order);
```

Jika cascade detach aktif, child juga tidak lagi managed.

---

### 8.2 Use Case

- Membangun read-only graph lalu detach untuk layer luar.
- Menghindari accidental flush setelah graph selesai dipakai.
- Long-running processing yang ingin mengontrol memory.

---

### 8.3 Risiko

- lazy association tidak bisa diload setelah detach;
- update ke child tidak tersimpan;
- developer salah mengira object masih managed;
- detached graph kemudian di-merge mentah dan menyebabkan merge storm.

Rule:

> Detach adalah boundary operation. Gunakan sebagai keputusan lifecycle persistence context, bukan convenience umum.

---

## 9. `CascadeType.ALL`

### 9.1 Apa Artinya

`ALL` adalah shorthand untuk:

```java
PERSIST + MERGE + REMOVE + REFRESH + DETACH
```

Ini bukan “semua yang bagus”. Ini “semua operasi lifecycle akan menjalar”.

---

### 9.2 Kapan `ALL` Masuk Akal

Masuk akal untuk private child entity:

```java
@Entity
class Order {
    @OneToMany(
        mappedBy = "order",
        cascade = CascadeType.ALL,
        orphanRemoval = true
    )
    private List<OrderLine> lines = new ArrayList<>();
}
```

Syaratnya:

- child owned secara lifecycle;
- child tidak shared;
- child tidak punya identity bisnis independen;
- child diubah hanya lewat aggregate root;
- menghapus parent boleh menghapus child;
- melepas child dari collection boleh menghapus child.

---

### 9.3 Kapan `ALL` Adalah Smell

Smell jika digunakan pada:

```java
@ManyToOne(cascade = CascadeType.ALL)
private User user;
```

```java
@ManyToMany(cascade = CascadeType.ALL)
private Set<Role> roles;
```

```java
@ManyToOne(cascade = CascadeType.ALL)
private ReferenceCode statusCode;
```

```java
@OneToMany(cascade = CascadeType.ALL)
private List<AuditTrail> auditTrails;
```

Audit trail biasanya tidak boleh dihapus hanya karena parent dihapus. Ia punya policy retensi sendiri.

Rule:

> `CascadeType.ALL` harus diperlakukan seperti `rm -rf` pada object graph: valid hanya jika boundary-nya sangat jelas.

---

## 10. Orphan Removal Deep Dive

### 10.1 Konsep

`orphanRemoval = true` menyatakan:

> Child yang dilepas dari relationship parent tidak boleh tetap ada di database.

Mapping:

```java
@OneToMany(
    mappedBy = "order",
    cascade = CascadeType.ALL,
    orphanRemoval = true
)
private List<OrderLine> lines = new ArrayList<>();
```

Operation:

```java
order.removeLine(line);
```

Helper:

```java
public void removeLine(OrderLine line) {
    lines.remove(line);
    line.setOrder(null);
}
```

SQL expected:

```sql
DELETE FROM order_line WHERE id = ?
```

---

### 10.2 Orphan Removal Pada `@OneToOne`

Contoh:

```java
@Entity
class UserProfile {
    @OneToOne(mappedBy = "profile", cascade = CascadeType.ALL, orphanRemoval = true)
    private UserAvatar avatar;
}
```

Jika:

```java
profile.setAvatar(null);
```

maka old avatar bisa dihapus.

Cocok jika avatar metadata tidak bermakna tanpa profile.

Tidak cocok jika avatar adalah shared file/document entity.

---

### 10.3 Orphan Removal Pada `@OneToMany`

Paling umum pada parent-child private ownership.

```java
Invoice invoice = em.find(Invoice.class, id);
invoice.removeLine(lineId);
```

Domain meaning:

> Line yang dilepas dari invoice tidak lagi valid.

---

### 10.4 Orphan Removal Bukan Untuk `@ManyToMany`

Pada many-to-many, target biasanya shared.

Contoh:

```java
User -> Role
```

Jika user kehilangan role, yang harus dihapus biasanya row join table:

```sql
DELETE FROM user_role WHERE user_id = ? AND role_id = ?
```

Bukan:

```sql
DELETE FROM role WHERE id = ?
```

Maka orphan removal ke target `Role` tidak sesuai secara lifecycle.

---

## 11. Parent-Child Invariants

Jika memakai cascade/orphan removal, association helper method wajib menjaga kedua sisi graph.

Buruk:

```java
order.getLines().add(line);
```

Jika bidirectional, `line.order` belum diset.

Baik:

```java
public void addLine(OrderLine line) {
    requireNonNull(line);
    lines.add(line);
    line.setOrder(this);
}

public void removeLine(OrderLine line) {
    if (lines.remove(line)) {
        line.setOrder(null);
    }
}
```

Invariants:

```text
line in order.lines  <=>  line.order == order
```

Jika invariant ini rusak, cascade/orphan behavior bisa tidak sesuai.

---

## 12. Delete Ordering

Ketika provider menghapus graph, SQL harus menghormati foreign key.

Misalnya:

```text
order
  └── order_line(order_id not null)
```

Delete parent dulu:

```sql
DELETE FROM orders WHERE id = ?;
DELETE FROM order_line WHERE order_id = ?;
```

akan gagal karena child masih mereferensikan parent.

Urutan aman:

```sql
DELETE FROM order_line WHERE order_id = ?;
DELETE FROM orders WHERE id = ?;
```

Provider biasanya menjadwalkan delete child sebelum parent berdasarkan metadata association.

Tetapi masalah bisa muncul pada:

- circular foreign key;
- nullable FK yang perlu di-null-kan dulu;
- join table;
- database cascade bercampur ORM cascade;
- bulk delete yang bypass persistence context;
- custom native SQL delete;
- constraint deferrable/non-deferrable.

---

## 13. ORM Cascade vs FK `ON DELETE CASCADE`

### 13.1 Pure ORM Cascade

Mapping:

```java
@OneToMany(mappedBy = "order", cascade = CascadeType.REMOVE)
private List<OrderLine> lines;
```

Operation:

```java
em.remove(order);
```

Provider emits:

```sql
DELETE FROM order_line WHERE id = ?;
DELETE FROM orders WHERE id = ?;
```

Good:

- entity callbacks/listeners can run;
- provider knows what it deleted;
- audit through ORM listener possible.

Bad:

- may require loading children;
- many SQL statements;
- slower for massive graph.

---

### 13.2 Pure Database Cascade

DDL:

```sql
alter table order_line
add constraint fk_order_line_order
foreign key (order_id)
references orders(id)
on delete cascade;
```

Operation:

```sql
DELETE FROM orders WHERE id = ?
```

Good:

- efficient;
- database-enforced;
- independent from ORM graph loading.

Bad:

- ORM entity listeners for child do not run;
- persistence context may contain stale child entities;
- application-level audit may miss child deletes;
- behavior hidden from Java code unless documented.

---

### 13.3 Mixed Strategy

Mixed can be valid but must be explicit.

Use DB cascade when:

- child table is purely dependent;
- delete volume can be high;
- no per-child listener/audit needed;
- database is source of integrity truth;
- persistence context is cleared after operation.

Use ORM cascade when:

- child lifecycle events matter;
- audit listener must run;
- provider cache must stay coherent;
- graph is small enough;
- deletion is domain operation, not housekeeping.

For regulatory systems, be careful: if retention/audit must capture every logical deletion, pure DB cascade may bypass application-layer audit.

---

## 14. Hibernate Behavior Notes

Hibernate treats cascade as part of entity state transition propagation. A parent-side one-to-many is the typical place where cascade makes sense because the parent controls child lifecycle.

Important Hibernate-specific concerns:

### 14.1 `CascadeType.ALL` Includes Remove

This is obvious but often forgotten. If `ALL` is placed on a shared association, delete can propagate dangerously.

### 14.2 Orphan Removal and Collection Replacement

This is risky:

```java
order.setLines(new ArrayList<>());
```

Instead of mutating the existing managed collection wrapper, replacing collection reference can confuse provider tracking or trigger delete/reinsert behavior depending on context.

Prefer:

```java
order.getLines().clear();
order.addLine(...);
```

Even that may delete all old children if orphan removal is true. For PATCH semantics, do diff deliberately.

---

### 14.3 Hibernate Collection Wrappers Matter

Managed collection is not just `ArrayList`. Hibernate uses persistent collection wrappers to track changes.

If you replace it casually:

```java
this.lines = incomingLines;
```

provider can lose expected mutation semantics or interpret it as whole collection replacement.

Defensive setter:

```java
public void replaceLines(List<OrderLine> newLines) {
    this.lines.clear();
    for (OrderLine line : newLines) {
        addLine(line);
    }
}
```

But do not use this for partial update unless intended.

---

### 14.4 Hibernate `@OnDelete`

Hibernate has provider-specific support to express database-level cascade delete using `@OnDelete`. This is not the same as JPA cascade remove. It delegates cascade behavior to the database.

Use with caution because persistence context and listeners may not observe database-cascaded child deletion the same way.

---

## 15. EclipseLink Behavior Notes

EclipseLink uses UnitOfWork, descriptors, relationship mappings, and change tracking/weaving to determine lifecycle propagation.

Important EclipseLink concerns:

### 15.1 Private Ownership Concept

EclipseLink has a long-standing concept of private-owned relationships. This aligns with the idea that child lifecycle belongs to parent lifecycle.

Conceptually:

```text
Private owned child = cannot exist independently of parent.
```

This matches when orphan removal is semantically appropriate.

---

### 15.2 `@CascadeOnDelete`

EclipseLink provides `@CascadeOnDelete` as an extension to indicate database-level cascade delete behavior for related tables. This is provider-specific and must be treated differently from ORM cascade.

Good for performance-sensitive delete of dependent rows.

Risky if the application expects child lifecycle callbacks or application audit.

---

### 15.3 Shared Cache Interaction

If database-level cascade deletes rows behind the provider’s back, shared cache coherence must be considered. Stale cached child objects can become a real issue if cache invalidation is not configured carefully.

---

## 16. Java 8–25 Compatibility Notes

### 16.1 API Package Split

Java 8 legacy stack often uses:

```java
import javax.persistence.CascadeType;
```

Modern Jakarta stack uses:

```java
import jakarta.persistence.CascadeType;
```

The semantics are conceptually similar, but dependencies are not binary-compatible.

Do not mix:

- `javax.persistence.Entity` with Jakarta provider expecting `jakarta.persistence.Entity`;
- old Hibernate 5 stack with Jakarta-only application server;
- EclipseLink 2.x API with Jakarta EE 10 runtime.

---

### 16.2 Provider Version Differences

General baseline:

| Runtime era | Common API | Common provider line |
|---|---|---|
| Java 8 legacy | JPA 2.1/2.2 `javax.persistence` | Hibernate 5.x, EclipseLink 2.x |
| Java 11/17 transition | mixed depending stack | Hibernate 5.6/6.x, EclipseLink 3.x |
| Java 17/21 modern | Jakarta Persistence 3.x | Hibernate 6.x/7.x, EclipseLink 4.x |
| Java 25 modern/future | Jakarta Persistence 3.x+ | Hibernate 7.x stable, newer development lines carefully validated |

Cascade concepts remain stable. Edge behavior around bytecode enhancement, collection tracking, merge, SQL generation, and provider extensions can differ.

---

## 17. Aggregate Boundary Design

### 17.1 Aggregate Root Rule

A good cascade mapping usually follows this rule:

> Only aggregate root should cascade lifecycle operations to aggregate-internal child entities.

Example:

```text
Application
 ├── ApplicantSnapshot
 ├── SubmittedAnswer
 ├── UploadedDocumentLink
 └── Declaration
```

If these child records are valid only under one application draft/submission, cascade persist may be valid.

But for:

```text
Application
 ├── ApplicantProfile
 ├── Agency
 ├── ProductType
 └── OfficerUser
```

these are not owned children. They are references.

---

### 17.2 Ownership Checklist

Before adding cascade, ask:

1. Can target entity exist without source entity?
2. Can target entity be referenced by another aggregate?
3. Does target entity have independent lifecycle workflow?
4. Does target entity have independent audit/retention policy?
5. Is deleting source supposed to delete target?
6. Is removing target from collection supposed to delete target row?
7. Can target be created separately before source?
8. Can target be updated by another use case independently?
9. Would cascade merge risk overwriting fields not present in request?
10. Would cascade remove surprise another module?

If answer to any of 1–4 is “yes”, cascade remove/orphan removal is probably wrong.

---

## 18. Regulatory/Case Management Modeling Examples

### 18.1 Case and Tasks

```text
CaseRecord
 └── CaseTask
```

Should `CaseTask` be cascade removed when `CaseRecord` is removed?

Depends.

If cases are never physically deleted, no.

If task records are audit-relevant, no physical orphan delete.

If task is a draft-only temporary child, maybe.

Better for regulatory workflow:

```java
caseRecord.cancel(reason);
caseTask.markCancelled(reason);
```

than physical cascading delete.

---

### 18.2 Case and Audit Trail

```java
@OneToMany(mappedBy = "caseRecord", cascade = CascadeType.ALL, orphanRemoval = true)
private List<AuditTrail> auditTrails;
```

This is usually wrong.

Audit trail should not disappear because parent aggregate is removed or reconstructed.

Better:

```java
@OneToMany(mappedBy = "caseRecord")
private List<AuditTrail> auditTrails;
```

or even no entity association for write model; query audit separately by case ID.

---

### 18.3 Application Draft and Draft Answers

```java
@Entity
class ApplicationDraft {
    @OneToMany(mappedBy = "draft", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<DraftAnswer> answers = new ArrayList<>();
}
```

This can be valid if:

- answers belong only to draft;
- replacing draft answer means old answer row is invalid;
- physical deletion is allowed before submission;
- submitted immutable answers are stored separately.

---

### 18.4 Submitted Application and Historical Answers

After submission, physical deletion may be wrong.

Better:

```text
SubmittedApplication
 └── SubmittedAnswer immutable rows
```

No orphan removal from normal business update. Correction should create new revision or correction event.

---

## 19. Soft Delete Complications

Cascade remove and orphan removal imply remove operation. But many enterprise systems need soft delete:

```text
deleted = true
```

or:

```text
status = CANCELLED
```

If `orphanRemoval = true`, removing child from collection may physically delete row unless provider-specific soft delete is configured.

Risks:

- audit loss;
- FK history break;
- external reference invalid;
- legal retention violation;
- reporting mismatch.

For soft delete domain, prefer explicit method:

```java
public void removeLine(Long lineId, User actor, String reason) {
    OrderLine line = findLine(lineId);
    line.cancel(actor, reason);
}
```

instead of:

```java
lines.remove(line);
```

because removing from collection hides domain meaning.

---

## 20. DTO/API Boundary and Cascade

### 20.1 Full Replacement vs Partial Update

Request:

```json
{
  "lines": [
    { "id": 1, "quantity": 10 }
  ]
}
```

Does it mean:

1. Replace all lines with exactly this one line?
2. Update only line 1 and leave others unchanged?
3. Remove omitted lines?
4. Client only sent partial data due to UI optimization?

With cascade merge + orphan removal, omission can become deletion.

Rule:

> Never let JSON omission directly drive orphan removal unless endpoint semantics explicitly says full replacement.

---

### 20.2 Safer Command Pattern

Instead of merging entity graph:

```java
em.merge(mapper.toEntity(request));
```

Use command operations:

```java
@Transactional
public void updateLineQuantity(Long orderId, Long lineId, int quantity) {
    Order order = orderRepository.getForUpdate(orderId);
    order.changeLineQuantity(lineId, quantity);
}
```

For remove:

```java
@Transactional
public void removeLine(Long orderId, Long lineId) {
    Order order = orderRepository.getForUpdate(orderId);
    order.removeLineById(lineId);
}
```

This makes delete intent explicit.

---

## 21. SQL Patterns

### 21.1 Cascade Persist

Java:

```java
Order order = new Order();
order.addLine(new OrderLine("SKU-1"));
em.persist(order);
```

Possible SQL:

```sql
insert into orders (id, ...) values (?, ...);
insert into order_line (id, order_id, sku, ...) values (?, ?, ?, ...);
```

---

### 21.2 Cascade Remove

Java:

```java
em.remove(order);
```

Possible SQL:

```sql
delete from order_line where id = ?;
delete from orders where id = ?;
```

or:

```sql
delete from order_line where order_id = ?;
delete from orders where id = ?;
```

Provider and mapping dependent.

---

### 21.3 Orphan Removal

Java:

```java
order.removeLine(line);
```

Possible SQL:

```sql
delete from order_line where id = ?;
```

Without orphan removal and nullable FK:

```sql
update order_line set order_id = null where id = ?;
```

Without orphan removal and non-null FK:

```text
constraint violation possible
```

---

## 22. Performance Model

Cascade and orphan removal affect performance through:

1. Graph traversal cost.
2. Managed entity count.
3. Collection initialization.
4. SQL statement count.
5. Delete ordering complexity.
6. Batchability.
7. Listener/callback overhead.
8. Dirty checking cost.
9. Cache invalidation cost.
10. Lock/constraint timing.

### 22.1 Small Aggregate

```text
Order -> 5 OrderLines
```

Cascade is usually fine.

### 22.2 Large Aggregate

```text
Case -> 20,000 CaseEvents
```

Cascade remove/update through object graph may be disastrous.

Better:

- do not model huge append-only history as cascade child collection in write aggregate;
- query history separately;
- use bulk archival/deletion strategy;
- avoid loading entire collection.

---

## 23. Failure Mode Catalogue

### 23.1 Accidental Delete of Shared Entity

Mapping:

```java
@ManyToOne(cascade = CascadeType.REMOVE)
private User assignedOfficer;
```

Symptom:

- deleting one case deletes officer user or causes constraint violation.

Root cause:

- cascade remove applied opposite of ownership.

Fix:

- remove cascade;
- use FK association only;
- delete user through user lifecycle service only.

---

### 23.2 Orphan Leak

Mapping:

```java
@OneToMany(mappedBy = "order")
private List<OrderLine> lines;
```

Operation:

```java
order.getLines().remove(line);
```

Symptom:

- line remains in database with `order_id = null`, or update fails due to not-null FK.

Root cause:

- child lifecycle expected private ownership, but orphan removal not configured or association not maintained.

Fix:

- add `orphanRemoval = true` if semantically valid;
- make FK non-null;
- maintain both sides.

---

### 23.3 Merge Deletes Children

Symptom:

- PATCH request accidentally deletes child rows.

Root cause:

- detached entity graph merged with empty/missing collection;
- orphan removal interprets missing children as removed.

Fix:

- avoid merge at API boundary;
- load managed aggregate;
- apply explicit command/diff;
- separate full-replace endpoint from partial-update endpoint.

---

### 23.4 Cascade Persist Inserts Duplicate Master Data

Mapping:

```java
@ManyToOne(cascade = CascadeType.PERSIST)
private ReferenceCode status;
```

Symptom:

- duplicate `ReferenceCode`, constraint violation, or wrong master row.

Root cause:

- reference entity treated as owned child.

Fix:

- remove cascade;
- use `getReference()` or find existing reference;
- enforce master lifecycle separately.

---

### 23.5 Delete Storm

Symptom:

- deleting parent causes thousands/millions of SQL deletes.

Root cause:

- cascade remove through large graph;
- no bulk strategy;
- provider loads child entities.

Fix:

- evaluate DB cascade or bulk delete;
- archive instead of delete;
- chunk operation;
- clear persistence context;
- avoid mapping huge history as cascade child collection.

---

### 23.6 Constraint Violation On Delete

Symptom:

- provider deletes/updates in order that violates FK.

Root causes:

- wrong owning side;
- circular FK;
- missing cascade on dependent child;
- DB cascade conflicts with ORM expectation;
- nullable/non-null mismatch;
- bulk delete bypassed child cleanup.

Fix:

- inspect generated SQL order;
- align mapping with FK ownership;
- use explicit delete order;
- consider deferrable constraints where supported;
- avoid circular mandatory FK.

---

### 23.7 Shared Cache Stale Data After DB Cascade

Symptom:

- child object appears in application after database cascaded delete.

Root cause:

- database deleted child behind provider/cache awareness.

Fix:

- evict cache regions;
- clear persistence context;
- avoid DB cascade for cached child entities unless cache strategy handles it;
- prefer ORM delete where cache coherence matters.

---

## 24. Design Rules

### Rule 1 — Cascade follows lifecycle ownership, not navigation convenience

If A references B, it does not mean A owns B.

---

### Rule 2 — Avoid cascade remove on `@ManyToOne`

Most `@ManyToOne` targets are parent/reference/shared entities.

---

### Rule 3 — Avoid cascade remove on `@ManyToMany`

Removing association should remove join row, not target entity.

---

### Rule 4 — Use orphan removal only for private child entities

Orphan removal means relationship removal equals child death.

---

### Rule 5 — Do not merge request body directly into entity graph

Especially dangerous with cascade merge and orphan removal.

---

### Rule 6 — Do not use `CascadeType.ALL` as default

Choose cascade types deliberately.

---

### Rule 7 — Large historical collections should not be cascade-owned casually

Audit, event, log, and history tables usually have independent retention policy.

---

### Rule 8 — Collection helper methods are part of persistence correctness

They maintain graph invariants provider depends on.

---

### Rule 9 — Physical delete and business removal are not the same

Regulatory systems often need cancellation, supersession, archival, or revision instead of delete.

---

### Rule 10 — DB cascade is an infrastructure decision, not a domain cascade substitute

Use it when performance/integrity needs justify it and cache/audit implications are handled.

---

## 25. Anti-Patterns

### 25.1 Cascade Everything Everywhere

```java
@ManyToOne(cascade = CascadeType.ALL)
private User createdBy;
```

Wrong because user is not owned.

---

### 25.2 Entity Graph As API Payload

```java
@PostMapping
public void update(@RequestBody Order order) {
    em.merge(order);
}
```

Wrong because client controls graph lifecycle accidentally.

---

### 25.3 Orphan Removal On Auditable History

```java
@OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
private List<AuditTrail> auditTrails;
```

Wrong if audit must be retained.

---

### 25.4 Shared Child With Orphan Removal

```text
ProductCategory shared by multiple Product
```

If removing category from one product deletes category, other products break.

---

### 25.5 Replacing Managed Collections Blindly

```java
public void setLines(List<OrderLine> lines) {
    this.lines = lines;
}
```

Wrong because provider collection wrapper and orphan diff can be bypassed or misinterpreted.

---

## 26. Diagnostic Checklist

When cascade/orphan bug occurs, ask:

1. Which operation triggered the issue: persist, merge, remove, refresh, detach, flush?
2. Which entity was the aggregate root?
3. Which associations have cascade configured?
4. Which associations have orphan removal?
5. Is target entity shared by other aggregates?
6. Was this a managed entity update or detached merge?
7. Was collection mutated or replaced?
8. Was owning side updated?
9. Was FK nullable or non-null?
10. Was DB `ON DELETE CASCADE` involved?
11. Were entity listeners expected?
12. Was second-level/shared cache enabled?
13. Did generated SQL delete, update FK to null, or delete join row?
14. Was endpoint PATCH or full replacement?
15. Does domain require physical delete or logical cancel?

---

## 27. Code Pattern: Safe Aggregate Child Management

```java
@Entity
@Table(name = "orders")
public class Order {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Version
    private long version;

    @OneToMany(
        mappedBy = "order",
        cascade = CascadeType.ALL,
        orphanRemoval = true
    )
    private final List<OrderLine> lines = new ArrayList<>();

    protected Order() {
    }

    public Order(String orderNo) {
        // validate orderNo
    }

    public void addLine(String sku, int quantity) {
        OrderLine line = new OrderLine(this, sku, quantity);
        lines.add(line);
    }

    public void changeLineQuantity(Long lineId, int quantity) {
        OrderLine line = findLine(lineId);
        line.changeQuantity(quantity);
    }

    public void removeLine(Long lineId) {
        OrderLine line = findLine(lineId);
        lines.remove(line);
        line.detachFromOrder();
    }

    private OrderLine findLine(Long lineId) {
        return lines.stream()
            .filter(line -> Objects.equals(line.getId(), lineId))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Line not found"));
    }

    public List<OrderLine> getLines() {
        return Collections.unmodifiableList(lines);
    }
}
```

Child:

```java
@Entity
@Table(name = "order_line")
public class OrderLine {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @Column(nullable = false)
    private String sku;

    @Column(nullable = false)
    private int quantity;

    protected OrderLine() {
    }

    OrderLine(Order order, String sku, int quantity) {
        this.order = Objects.requireNonNull(order);
        this.sku = validateSku(sku);
        this.quantity = validateQuantity(quantity);
    }

    public void changeQuantity(int quantity) {
        this.quantity = validateQuantity(quantity);
    }

    void detachFromOrder() {
        this.order = null;
    }

    public Long getId() {
        return id;
    }

    private static String validateSku(String sku) {
        if (sku == null || sku.isBlank()) {
            throw new IllegalArgumentException("SKU is required");
        }
        return sku;
    }

    private static int validateQuantity(int quantity) {
        if (quantity <= 0) {
            throw new IllegalArgumentException("Quantity must be positive");
        }
        return quantity;
    }
}
```

Note:

- external code cannot replace collection;
- child constructor package-private;
- parent controls child lifecycle;
- orphan removal is semantically valid;
- update operations are explicit.

---

## 28. Code Pattern: Shared Reference Without Cascade

```java
@Entity
class CaseRecord {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "assigned_officer_id", nullable = false)
    private User assignedOfficer;

    public void assignOfficer(User officer) {
        this.assignedOfficer = Objects.requireNonNull(officer);
    }
}
```

Service:

```java
@Transactional
public void assignOfficer(Long caseId, Long officerId) {
    CaseRecord caseRecord = em.find(CaseRecord.class, caseId);
    User officer = em.getReference(User.class, officerId);
    caseRecord.assignOfficer(officer);
}
```

No cascade.

Reason:

- case does not own user;
- user lifecycle belongs to identity/user-management module;
- deleting case must not delete user;
- assigning officer must not create new user.

---

## 29. Code Pattern: Full Replacement With Explicit Diff

If endpoint really means full replacement:

```java
@Transactional
public void replaceLines(Long orderId, List<LineCommand> commands) {
    Order order = orderRepository.findForUpdate(orderId);
    order.replaceLines(commands);
}
```

Inside aggregate:

```java
public void replaceLines(List<LineCommand> commands) {
    Map<Long, OrderLine> existingById = lines.stream()
        .filter(line -> line.getId() != null)
        .collect(Collectors.toMap(OrderLine::getId, Function.identity()));

    Set<Long> incomingIds = commands.stream()
        .map(LineCommand::id)
        .filter(Objects::nonNull)
        .collect(Collectors.toSet());

    // remove omitted existing lines deliberately
    Iterator<OrderLine> iterator = lines.iterator();
    while (iterator.hasNext()) {
        OrderLine line = iterator.next();
        if (line.getId() != null && !incomingIds.contains(line.getId())) {
            iterator.remove();
            line.detachFromOrder();
        }
    }

    // update or add
    for (LineCommand command : commands) {
        if (command.id() == null) {
            addLine(command.sku(), command.quantity());
        } else {
            OrderLine line = existingById.get(command.id());
            if (line == null) {
                throw new IllegalArgumentException("Unknown line id: " + command.id());
            }
            line.changeQuantity(command.quantity());
        }
    }
}
```

This is much safer than blind `merge()` because deletion is explicit.

---

## 30. Practice Scenarios

### Scenario 1

You have:

```text
Application -> ApplicantProfile
```

Applicant profile can be reused across multiple applications.

Should cascade remove be enabled?

Answer:

No. Application does not own applicant profile lifecycle.

---

### Scenario 2

You have:

```text
DraftApplication -> DraftAnswer
```

Draft answer has no meaning without draft.

Should `orphanRemoval = true` be enabled?

Answer:

Likely yes, if physical deletion of draft answers is acceptable.

---

### Scenario 3

You have:

```text
CaseRecord -> AuditTrail
```

Audit trail must be retained even if case is withdrawn.

Should cascade remove/orphan removal be enabled?

Answer:

No. Audit lifecycle is independent and retention-driven.

---

### Scenario 4

You have `User -> Role` many-to-many.

Should `CascadeType.REMOVE` be used?

Answer:

No. Removing a user should remove join rows, not role records.

---

### Scenario 5

A PATCH endpoint sends only changed child rows. Existing children are omitted. Entity is built from request and merged.

Risk?

Answer:

Omitted children may be interpreted as removed if cascade merge and orphan removal are active. Use managed aggregate + explicit command application.

---

## 31. Summary

Cascade and orphan removal are not annotation shortcuts. They encode lifecycle semantics.

The central distinction:

```text
Association = can navigate/reference.
Cascade = lifecycle operation propagates.
Orphan removal = relationship removal means child deletion.
Aggregate boundary = where lifecycle propagation is valid.
```

Safe default rules:

- cascade from aggregate root to private children;
- avoid cascade remove on many-to-one;
- avoid cascade remove on many-to-many;
- avoid blind `CascadeType.ALL`;
- do not merge API request graphs directly;
- use orphan removal only when child cannot live independently;
- distinguish physical delete from business cancellation;
- treat DB cascade separately from ORM cascade;
- design collection helper methods as part of correctness.

In top-level engineering terms:

> Cascade is not about saving keystrokes. Cascade is about declaring who owns whose lifecycle.

If that ownership model is wrong, ORM will faithfully automate the wrong thing.

---

## 32. References

- Jakarta Persistence 3.2 API — `@OneToMany`, cascade and orphan removal semantics.
- Jakarta Persistence 3.2 Specification.
- Hibernate ORM User Guide — associations, cascades, orphan removal, entity state transitions.
- EclipseLink JPA Extensions — `@CascadeOnDelete` and provider-specific relationship behavior.
- EclipseLink Concepts — UnitOfWork, private ownership, shared cache, descriptors.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 10 — Collection Mapping: Bags, Lists, Sets, Maps, Ordering, and Hidden Costs](./10-collection-mapping-bags-lists-sets-maps-ordering-hidden-costs.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 12 — Inheritance Mapping: Object Hierarchy vs Relational Shape](./12-inheritance-mapping-object-hierarchy-relational-shape.md)

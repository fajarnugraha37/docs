# Part 5 — Dirty Checking Internals and Change Detection

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `05-dirty-checking-internals-change-detection.md`  
> Level: Advanced / Provider Engineering  
> Target Java: 8 sampai 25  
> Fokus provider: Hibernate ORM 5/6/7, EclipseLink 2/3/4, Jakarta Persistence/JPA

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas **persistence context** sebagai:

- identity map,
- first-level cache,
- unit of work,
- transactional object memory,
- tempat entity managed hidup sebelum disinkronkan ke database.

Part ini membahas mekanisme yang membuat persistence context bisa bekerja sebagai **state synchronization engine**: **dirty checking**.

Dirty checking adalah proses provider ORM mendeteksi bahwa object Java yang sedang managed berubah, lalu pada saat flush provider menerjemahkan perubahan itu menjadi SQL `UPDATE`, perubahan collection, atau operasi lain yang diperlukan.

Yang sering salah dipahami:

> Dirty checking bukan fitur kecil yang membuat kita tidak perlu menulis `update()`. Dirty checking adalah mekanisme inti yang menentukan apakah state Java dianggap berbeda dari state database, kapan SQL dibuat, field mana yang dikirim, collection mana yang dianggap berubah, dan berapa mahal biaya flush.

Kalau persistence context adalah “ruang kerja transactional”, dirty checking adalah “sistem inspeksi perubahan” di dalam ruang kerja itu.

---

## 1. Why This Matters

Banyak bug ORM production terlihat seperti masalah acak:

- kenapa ada `UPDATE` padahal saya hanya membaca data?
- kenapa perubahan object tidak masuk ke database?
- kenapa Hibernate update semua kolom, bukan hanya kolom yang berubah?
- kenapa flush lambat sekali saat ada ribuan entity managed?
- kenapa child collection dihapus lalu diinsert ulang?
- kenapa audit trail mencatat update padahal value terlihat sama?
- kenapa optimistic lock version naik meskipun perubahan tidak signifikan?
- kenapa entity immutable tetap berubah?
- kenapa perubahan lewat reflection tidak terdeteksi?
- kenapa update muncul setelah query select?

Akar dari banyak pertanyaan itu adalah dirty checking.

Untuk engineer level biasa, dirty checking adalah:

> “JPA otomatis detect perubahan entity.”

Untuk engineer level advanced, dirty checking adalah:

> “Provider membandingkan atau melacak perubahan pada managed entity berdasarkan strategi tertentu, menyimpan snapshot atau change record, mengevaluasi state pada flush, membangun dirty attribute set, memasukkan update action ke action queue/unit of work, lalu menghasilkan SQL sesuai mapping, flush mode, enhancement/weaving, mutable type semantics, collection wrapper, versioning, dynamic update setting, dan provider-specific optimization.”

Itu sebabnya part ini penting.

---

## 2. Core Mental Model

### 2.1 Dirty Checking Adalah Perbandingan Antara Dua State

Secara konseptual, provider butuh menjawab pertanyaan:

> “Untuk entity managed ini, apakah state sekarang berbeda dari state yang terakhir dianggap sinkron dengan database?”

Ada dua state utama:

```text
Loaded / Baseline State
        |
        | user code mutates managed object
        v
Current Java Object State
        |
        | flush dirty checking
        v
SQL Mutation Plan
```

Baseline state bisa berupa:

- snapshot array,
- backup object,
- field-level dirty flag,
- change record,
- property change event,
- provider-specific tracker.

Provider lalu membandingkan atau membaca tracker tersebut untuk menentukan:

```text
Entity dirty? yes/no
Which attributes dirty?
Does version need increment?
Which SQL update is needed?
Do collection tables need mutation?
Are lifecycle callbacks/listeners needed?
```

### 2.2 Dirty Checking Hanya Berlaku Untuk Managed Entity

Entity hanya otomatis dideteksi perubahannya jika berada dalam persistence context sebagai **managed entity**.

```java
Customer customer = entityManager.find(Customer.class, id);
customer.setName("New Name");
// no entityManager.update(customer)
// perubahan akan diproses saat flush/commit
```

Tetapi ini tidak berlaku untuk detached entity:

```java
Customer customer = entityManager.find(Customer.class, id);
entityManager.detach(customer);

customer.setName("New Name");
// Tidak otomatis terdeteksi karena object sudah detached.
```

Perubahan detached entity baru berpengaruh jika:

- dilakukan `merge()`,
- atau state-nya disalin manual ke managed entity,
- atau dipakai dalam mekanisme update lain.

### 2.3 Dirty Checking Bukan Commit

Dirty checking biasanya berjalan saat **flush**, bukan saat method setter dipanggil.

```text
setter called
    does not necessarily execute SQL
flush triggered
    provider checks dirty state
    SQL generated/executed
commit
    database transaction committed
```

Flush bisa terjadi:

- sebelum transaction commit,
- sebelum query tertentu,
- saat explicit `flush()`,
- tergantung flush mode,
- tergantung provider/framework integration.

Jadi ketika kita melihat SQL `UPDATE` terjadi sebelum commit, itu belum berarti transaction sudah commit. Itu berarti persistence context sedang disinkronkan ke database transaction.

---

## 3. Specification-Level Concept

Jakarta Persistence mendefinisikan model entity managed dan sinkronisasi persistence context dengan database, tetapi specification tidak memaksa provider memakai satu algoritma dirty checking tertentu.

Specification memberi kontrak tingkat tinggi:

- entity managed berada di persistence context,
- perubahan pada entity managed dapat disinkronkan ke database,
- flush menyinkronkan persistence context ke database,
- transaction commit melakukan flush secara normal,
- entity lifecycle callbacks dapat dipanggil dalam operasi persistence tertentu,
- provider mengelola state entity berdasarkan mapping metadata.

Tetapi specification tidak mendikte detail seperti:

- apakah provider memakai snapshot diff atau field-level dirty flags,
- apakah provider update semua kolom atau kolom yang berubah saja,
- kapan tepatnya provider melakukan comparison internal,
- bagaimana mutable custom type dibandingkan,
- bagaimana collection wrapper melacak perubahan internal,
- apakah lazy basic field memerlukan bytecode enhancement,
- apakah perubahan via reflection harus terdeteksi dalam semua mode provider,
- urutan internal action queue.

Inilah batas penting:

> JPA memberi semantic contract. Hibernate dan EclipseLink memberi operational behavior.

Untuk production engineering, operational behavior sering lebih menentukan daripada sekadar specification.

---

## 4. The Naive Mental Model and Why It Fails

Mental model pemula biasanya seperti ini:

```text
entity.setName("A")
    -> ORM langsung tahu field name berubah
    -> ORM update kolom name
```

Ini terlalu sederhana.

Realitasnya bisa seperti ini:

```text
Entity loaded
    -> provider stores loaded snapshot
User changes field
    -> maybe no immediate provider event
Flush begins
    -> provider iterates managed entities
    -> compares current values against snapshot
    -> determines dirty properties
    -> handles mutable values and collections
    -> schedules update action
    -> generates SQL
    -> executes SQL
    -> updates snapshot/version state
```

Atau, jika bytecode enhancement/change tracking aktif:

```text
Entity loaded
    -> enhanced setter/interceptor installed
User changes field
    -> dirty flag marked immediately
Flush begins
    -> provider reads dirty flag
    -> avoids full snapshot comparison for some cases
    -> schedules update action
```

Atau, jika EclipseLink attribute change tracking aktif:

```text
Entity woven
    -> property change listener/change tracker available
User changes attribute
    -> change recorded
Commit/flush
    -> provider uses recorded changes
```

Konsekuensinya:

- setter belum tentu langsung trigger SQL,
- direct field mutation bisa berbeda dampaknya tergantung access mode/enhancement,
- provider bisa tetap perlu snapshot untuk mutable types,
- collection mutation punya mekanisme berbeda dari scalar field,
- update SQL bisa berisi semua kolom atau subset kolom,
- dirty checking cost bisa mahal pada persistence context besar.

---

## 5. Hibernate Dirty Checking Deep Dive

### 5.1 Snapshot-Based Dirty Checking

Secara historis dan konseptual, Hibernate menggunakan snapshot-based dirty checking.

Ketika entity dimuat:

```java
Customer customer = entityManager.find(Customer.class, 10L);
```

Hibernate menyimpan:

```text
Managed object reference:
    Customer#10 object

Loaded state snapshot:
    id          = 10
    name        = "Alice"
    status      = "ACTIVE"
    email       = "alice@example.com"
    version     = 3
```

Lalu application code mengubah object:

```java
customer.setEmail("alice.new@example.com");
```

Pada flush, Hibernate membandingkan current state dengan loaded snapshot:

```text
name:
    snapshot = "Alice"
    current  = "Alice"
    dirty?   no

status:
    snapshot = "ACTIVE"
    current  = "ACTIVE"
    dirty?   no

email:
    snapshot = "alice@example.com"
    current  = "alice.new@example.com"
    dirty?   yes
```

Jika dirty, Hibernate menjadwalkan update.

Default SQL bisa berupa:

```sql
update customer
set email = ?, name = ?, status = ?, version = ?
where id = ? and version = ?
```

Atau dengan dynamic update:

```sql
update customer
set email = ?, version = ?
where id = ? and version = ?
```

Detail ini tergantung mapping dan configuration.

### 5.2 Snapshot Cost Model

Snapshot-based dirty checking punya cost:

```text
flush cost roughly proportional to:
number of managed entities
x number of persistent attributes
x cost of equality/deep comparison
+ collection dirty checking cost
+ cascading/flush action ordering cost
```

Jika satu request memuat 50 entity, cost kecil.

Jika batch job memuat 100.000 entity ke persistence context tanpa `clear()`, cost bisa sangat besar:

```text
Managed entities: 100,000
Attributes/entity: 40
Potential comparisons: 4,000,000 per flush
```

Belum termasuk collection dan association.

Inilah alasan batch processing dengan ORM sering memakai pola:

```java
for (int i = 0; i < items.size(); i++) {
    process(items.get(i));

    if (i % 100 == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

Tujuannya bukan hanya mengirim SQL per batch, tetapi juga membatasi ukuran persistence context dan snapshot yang perlu diperiksa.

### 5.3 Hibernate Bytecode Enhancement and Inline Dirty Tracking

Hibernate mendukung bytecode enhancement untuk beberapa kemampuan, termasuk lazy attribute loading, dirty tracking, association management, dan optimisasi internal. Dokumentasi Hibernate menjelaskan bahwa historically Hibernate melakukan diff-based dirty calculation, dan bytecode enhancement menyediakan model inline dirty tracking di mana entity bisa melacak attribute yang berubah secara lebih langsung.

Dengan enhancement, class entity bisa dimodifikasi pada build-time atau runtime sehingga provider dapat memasukkan interceptor/tracker.

Secara konseptual:

```java
customer.setEmail("new@example.com");
```

Dapat menjadi seperti:

```java
public void setEmail(String email) {
    this.$$_hibernate_trackChange("email");
    this.email = email;
}
```

Ini bukan kode literal yang harus diandalkan, tetapi mental modelnya benar: perubahan bisa ditandai saat terjadi, bukan baru ditemukan lewat full diff saat flush.

Manfaat:

- mengurangi cost dirty checking pada entity besar,
- mendukung lazy basic attribute tertentu,
- membantu provider tahu atribut mana yang berubah,
- bisa mengurangi work saat flush.

Tetapi enhancement bukan magic.

Masih ada batas:

- mutable object internal tetap tricky,
- collection tracking punya wrapper sendiri,
- direct reflection/unsafe mutation bisa melewati mekanisme tertentu,
- build/test/runtime harus konsisten,
- provider version behavior bisa berubah,
- tidak semua optimization cocok untuk semua project.

### 5.4 Enhanced Dirty Tracking vs Dynamic Update

Dua konsep ini sering tertukar.

**Dirty tracking** menjawab:

> Field mana yang berubah?

**Dynamic update** menjawab:

> SQL update harus menyertakan semua kolom atau hanya kolom yang berubah?

Tanpa dynamic update, provider bisa tahu hanya `email` yang berubah tetapi tetap menghasilkan SQL yang mengirim banyak kolom karena alasan statement shape, caching, atau default behavior.

Contoh tanpa dynamic update:

```sql
update customer
set name = ?, email = ?, status = ?, updated_at = ?, version = ?
where id = ? and version = ?
```

Dengan dynamic update:

```sql
update customer
set email = ?, version = ?
where id = ? and version = ?
```

Dynamic update punya trade-off:

Keuntungan:

- mengurangi kolom yang dikirim,
- membantu menghindari update kolom yang tidak perlu,
- bisa berguna untuk table sangat lebar.

Biaya:

- variasi SQL lebih banyak,
- statement cache/database plan cache bisa kurang stabil,
- audit/trigger behavior perlu diperiksa,
- tidak selalu menaikkan performance jika table kecil.

Rule praktis:

> Gunakan dynamic update berdasarkan bukti: table sangat lebar, update partial dominan, trigger/replication cost besar, atau ada kolom besar/sensitif yang tidak ingin disentuh. Jangan jadikan default buta untuk semua entity.

### 5.5 Hibernate Dirty Checking and Mutable Types

Dirty checking sederhana untuk immutable value:

```java
String oldName = "Alice";
String newName = "Alice Updated";
```

Tetapi lebih rumit untuk mutable object:

```java
Money balance = account.getBalance();
balance.setCents(15_000);
```

Application tidak memanggil:

```java
account.setBalance(new Money(...));
```

Tetapi internal object berubah.

Jika provider/type system tahu value tersebut mutable dan punya mekanisme deep copy/comparison yang benar, perubahan dapat terdeteksi. Jika tidak, perubahan bisa:

- tidak terdeteksi,
- selalu dianggap dirty,
- menyebabkan snapshot ikut termutasi,
- menghasilkan update berlebihan,
- menyebabkan cache corruption.

Untuk custom type, rule penting:

> Kalau value type mutable, provider harus bisa membuat snapshot/deep copy yang tidak ikut berubah saat current object berubah.

Jika snapshot dan current mengarah ke object mutable yang sama, dirty checking bisa gagal.

Contoh bug mental:

```text
snapshot.address -> Address object X
current.address  -> Address object X

application mutates X.city

snapshot.city also appears changed because same object reference
provider compares snapshot vs current
looks equal
no update
```

Maka untuk value object domain, desain terbaik sering:

```java
@Embeddable
public class Money {
    private BigDecimal amount;
    private String currency;

    protected Money() {}

    public Money(BigDecimal amount, String currency) {
        this.amount = amount;
        this.currency = currency;
    }

    public Money withAmount(BigDecimal newAmount) {
        return new Money(newAmount, this.currency);
    }
}
```

Alih-alih mutate internal state, buat value object immutable.

### 5.6 Hibernate Dirty Checking and Collections

Collection punya mekanisme dirty checking berbeda dari scalar field.

Hibernate biasanya membungkus collection persistent dengan wrapper seperti persistent collection.

Contoh:

```java
Order order = entityManager.find(Order.class, id);
order.getLines().add(new OrderLine(...));
```

Yang berubah bukan hanya field `lines`, tetapi isi collection.

Provider perlu tahu:

- apakah collection diinisialisasi,
- apakah ada element ditambah,
- apakah ada element dihapus,
- apakah ordering berubah,
- apakah collection table perlu update,
- apakah orphan removal aktif,
- apakah cascade persist/remove aktif,
- apakah collection adalah bag/list/set/map.

Mutation collection ini bisa menghasilkan SQL berbeda:

```sql
insert into order_line (...)
values (...)
```

atau:

```sql
delete from order_line where order_id = ?
insert into order_line (...)
insert into order_line (...)
```

atau:

```sql
update order_line set order_index = ? where id = ?
```

Tergantung mapping.

Kesalahan umum:

```java
order.setLines(new ArrayList<>());
```

Mengganti collection wrapper provider dengan collection biasa dapat membuat provider kehilangan tracking atau menginterpretasikan sebagai replacement besar.

Lebih aman:

```java
order.getLines().clear();
order.addLine(newLine);
```

Dengan helper method yang menjaga kedua sisi association.

---

## 6. EclipseLink Change Tracking Deep Dive

EclipseLink punya konsep change tracking policies yang lebih eksplisit. Secara umum, EclipseLink dapat menggunakan beberapa strategi seperti deferred change tracking, object change tracking, dan attribute change tracking.

### 6.1 Deferred Change Tracking

Deferred change tracking mirip snapshot comparison.

Alurnya:

```text
Object registered in UnitOfWork
    -> backup copy/snapshot kept
Application mutates object
    -> no immediate change event required
Commit/flush
    -> current object compared with backup
    -> changes calculated
```

Kelebihan:

- tidak membutuhkan weaving khusus untuk deteksi perubahan dasar,
- perubahan lewat field direct/reflection lebih mungkin terdeteksi karena dibandingkan saat commit,
- mental model lebih sederhana.

Biaya:

- comparison dilakukan kemudian,
- butuh backup copy,
- commit/flush cost meningkat seiring jumlah object/attribute.

### 6.2 Attribute Change Tracking

Attribute change tracking menggunakan weaving untuk melacak perubahan attribute saat setter/field berubah.

Alur:

```text
Entity woven
    -> change listener/tracker installed
Application mutates attribute
    -> changed attribute recorded
Commit/flush
    -> recorded changes used
```

Kelebihan:

- commit/flush bisa lebih efisien untuk object tertentu,
- provider tahu attribute mana yang berubah,
- cocok jika weaving aktif dan mutation path normal.

Batas penting:

- perubahan lewat reflection bisa tidak terdeteksi pada mode tertentu,
- weaving harus aktif/konsisten,
- direct field manipulation di luar mekanisme yang didukung dapat mengganggu tracking.

### 6.3 Object Change Tracking

Object change tracking melacak bahwa object berubah, tetapi tidak selalu granular per attribute seperti attribute tracking.

Mental model:

```text
Object changed? yes/no
Which attributes? provider may need additional handling
```

Strategi ini bisa berguna dalam kondisi tertentu, tetapi perlu dipahami konsekuensi SQL dan change record-nya.

### 6.4 EclipseLink Weaving Dependency

EclipseLink banyak mengandalkan weaving untuk fitur advanced seperti:

- lazy relationships tertentu,
- change tracking tertentu,
- fetch groups,
- performance optimizations.

Weaving dapat dilakukan:

- dynamic weaving,
- static weaving.

Masalah production yang sering muncul:

```text
DEV/test:
    weaving aktif
PROD:
    weaving tidak aktif karena classloader/app server/module path berbeda

Akibat:
    lazy loading berbeda
    change tracking berbeda
    performance berbeda
    bug sulit direproduksi
```

Rule:

> Untuk EclipseLink, jangan treat weaving sebagai detail deployment kecil. Weaving adalah bagian dari runtime semantics.

---

## 7. Dirty Checking Lifecycle Step by Step

Mari gunakan contoh sederhana.

```java
@Entity
@Table(name = "customer")
public class Customer {
    @Id
    private Long id;

    private String name;

    private String email;

    @Enumerated(EnumType.STRING)
    private CustomerStatus status;

    @Version
    private long version;

    protected Customer() {}

    public void changeEmail(String newEmail) {
        if (newEmail == null || newEmail.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        this.email = newEmail;
    }
}
```

Application code:

```java
@Transactional
public void changeEmail(long customerId, String newEmail) {
    Customer customer = entityManager.find(Customer.class, customerId);
    customer.changeEmail(newEmail);
}
```

Lifecycle:

```text
1. Transaction starts
2. EntityManager participates in transaction
3. find() loads row or returns managed instance from persistence context
4. Provider creates managed entity
5. Provider stores loaded state/snapshot/change tracking baseline
6. Domain method mutates email
7. No explicit save/update needed
8. Transaction commit triggers flush
9. Provider dirty checks managed entities
10. Customer email differs from baseline
11. Provider schedules entity update
12. Version increment prepared
13. SQL UPDATE executed
14. Database row locked/updated according to isolation/locking
15. Transaction commits
16. Persistence context closes or remains depending on scope
```

Potential SQL:

```sql
select
    c.id,
    c.name,
    c.email,
    c.status,
    c.version
from customer c
where c.id = ?;

update customer
set email = ?, name = ?, status = ?, version = ?
where id = ? and version = ?;
```

Or with dynamic update:

```sql
update customer
set email = ?, version = ?
where id = ? and version = ?;
```

---

## 8. Access Type and Dirty Checking

JPA supports field access and property access.

### 8.1 Field Access

```java
@Entity
public class Customer {
    @Id
    private Long id;

    private String name;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
```

Because `@Id` is on field, provider uses field access.

Provider reads/writes fields directly for persistence state.

### 8.2 Property Access

```java
@Entity
public class Customer {
    private Long id;
    private String name;

    @Id
    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
```

Because `@Id` is on getter, provider uses property access.

### 8.3 Why Access Type Matters

Dirty checking depends on what provider considers persistent state.

Bug example:

```java
@Entity
public class Invoice {
    @Id
    private Long id;

    private BigDecimal amount;

    private BigDecimal cachedTax; // accidentally persistent if field access
}
```

If field access, `cachedTax` is persistent unless marked:

```java
@Transient
private BigDecimal cachedTax;
```

Another bug:

```java
public BigDecimal getTotal() {
    return amount.add(tax);
}
```

If property access and getter is accidentally considered persistent, provider may try mapping derived state.

Rule:

> Choose field access or property access deliberately. Do not mix casually. Dirty checking only makes sense when persistent state boundary is explicit.

---

## 9. Entity Mutability Patterns

### 9.1 Fully Mutable Entity

```java
customer.setName("Alice");
customer.setEmail("a@example.com");
customer.setStatus(ACTIVE);
```

Simple, but dangerous for domain invariants.

Problems:

- any code can mutate state,
- invalid transitions possible,
- dirty checking may persist accidental mutation,
- harder to audit intent.

### 9.2 Domain Method Mutation

```java
customer.changeEmail(newEmail);
customer.suspend(reason);
customer.reactivate(actor);
```

Better because mutation expresses intent.

Dirty checking still persists field mutation, but application controls mutation through domain method.

### 9.3 Immutable Value Objects Inside Mutable Entity

```java
customer.changeAddress(customer.getAddress().withPostalCode("123456"));
```

Better for dirty checking because object reference changes and value equality is stable.

### 9.4 Immutable Entity

Pure immutable entity is difficult with JPA because provider needs construction and state population. Hibernate supports more advanced patterns, but standard JPA entity usually needs:

- no-arg constructor,
- non-final persistent fields in many cases,
- provider access to state.

For read-only reference data, provider-specific immutability can be used carefully.

---

## 10. Dirty Checking and `equals()` / `hashCode()`

Dirty checking normally does not use entity `equals()` to detect whether the entity itself changed. Provider uses mapped persistent attributes and type comparison.

But `equals/hashCode` matters for:

- `Set` collections,
- map keys,
- duplicate child detection,
- collection dirty checking,
- application-level identity bugs.

Bad pattern:

```java
@Entity
public class OrderLine {
    @Id
    @GeneratedValue
    private Long id;

    private String sku;

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof OrderLine other)) return false;
        return Objects.equals(id, other.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

If entity is added to `HashSet` before ID assigned:

```java
OrderLine line = new OrderLine("SKU-1");
order.getLines().add(line); // hashCode based on null id
entityManager.persist(order); // id assigned later
```

After ID assignment, hash code changes.

This can corrupt set semantics in application memory.

Better strategies depend on model:

- stable natural key if truly immutable and unique,
- class hash + ID equality only when ID non-null,
- avoid using mutable entities as hash keys,
- use `List` where set semantics are not required,
- manage child uniqueness through database constraint and domain method.

Connection to dirty checking:

> Broken equality can make provider/application believe collection changed incorrectly or fail to find existing element during remove.

---

## 11. Dirty Checking and Collections: Detailed Failure Scenarios

### 11.1 Replacing Collection Reference

Bad:

```java
order.setLines(dto.lines().stream()
    .map(this::toEntity)
    .toList());
```

Potential effects:

- provider wrapper replaced,
- all existing lines treated as removed,
- new lines treated as added,
- orphan removal deletes rows,
- batch update becomes delete/insert storm,
- detached child entities conflict with managed ones.

Better:

```java
public void replaceLines(List<OrderLineCommand> commands) {
    this.lines.clear();
    for (OrderLineCommand command : commands) {
        this.addLine(new OrderLine(command.sku(), command.quantity()));
    }
}
```

Even better for large collections:

```java
public void reconcileLines(List<OrderLineCommand> commands) {
    // calculate add/update/remove by stable business key
    // avoid wholesale replacement when possible
}
```

### 11.2 Mutating Inverse Side Only

```java
child.setParent(parent);
// but parent.getChildren().add(child) not called
```

or:

```java
parent.getChildren().add(child);
// but child.setParent(parent) not called
```

Depending on owning side, database FK may not update.

Dirty checking sees object graph mutation, but SQL is generated from owning side mapping.

Rule:

> Dirty checking does not fix inconsistent bidirectional association. You must maintain both sides.

### 11.3 Removing Child Without Orphan Removal

```java
order.getLines().remove(line);
```

If orphan removal is false, provider may only null FK or remove join row depending mapping. It may not delete child row.

If orphan removal true:

```java
@OneToMany(mappedBy = "order", orphanRemoval = true)
private List<OrderLine> lines = new ArrayList<>();
```

Removal from collection means child entity should be removed.

This is not just dirty checking; this is lifecycle propagation semantics.

---

## 12. Dirty Checking and Flush Timing

Dirty checking is evaluated during flush.

Example:

```java
@Transactional
public List<Customer> updateThenQuery(long id) {
    Customer c = entityManager.find(Customer.class, id);
    c.changeEmail("new@example.com");

    return entityManager.createQuery("select c from Customer c", Customer.class)
        .getResultList();
}
```

With flush mode AUTO, provider may flush before executing the query to keep query result consistent with pending changes.

Sequence:

```text
find customer
change email
execute query
    -> flush before query
        -> dirty checking
        -> update SQL
    -> select query
commit transaction
```

This explains why update SQL can appear in logs before method end.

It also explains failures like:

```text
ConstraintViolationException thrown during SELECT query
```

Because the query triggered flush, and flush attempted invalid update/insert.

Rule:

> When debugging dirty checking, ask: “What triggered flush?” not only “Where did I call save?”

---

## 13. Dirty Checking and Versioning

With optimistic locking:

```java
@Version
private long version;
```

Dirty entity update usually increments version.

Example:

```sql
update customer
set email = ?, version = ?
where id = ? and version = ?
```

If row count is zero, provider throws optimistic lock exception.

Important implications:

- if entity is considered dirty accidentally, version may increment accidentally,
- if change is not detected, version may not increment,
- bulk JPQL update may bypass version unless explicitly handled/provider-specific features used,
- collection changes may or may not version parent depending mapping/provider/settings.

Example accidental dirty:

```java
customer.setUpdatedAt(Instant.now());
```

Even if business data did not change, version changes.

This can create false optimistic lock conflicts.

Design question:

> Should technical timestamp updates count as business version changes?

In regulatory/case management systems, this matters because version often represents legal/business consistency, not merely row modification.

---

## 14. Dirty Checking and Lifecycle Callbacks

JPA lifecycle callbacks:

```java
@PreUpdate
public void preUpdate() {
    this.updatedAt = Instant.now();
}
```

Subtleties:

- `@PreUpdate` is called when provider has determined update is needed.
- If no dirty property exists, provider may not call `@PreUpdate`.
- Changing a field inside callback affects SQL depending provider timing and enhancement behavior.
- Audit code inside entity callback can accidentally cause extra dirty state.

Bad pattern:

```java
@PostLoad
public void calculateDerivedFields() {
    this.normalizedName = normalize(name); // mapped field accidentally changed after load
}
```

This can make entity dirty immediately after loading.

Better:

```java
@Transient
private String normalizedName;
```

or compute lazily without storing mapped state.

Rule:

> Lifecycle callbacks must not mutate mapped persistent fields casually. They participate in dirty checking and can create invisible writes.

---

## 15. Dirty Checking and DTO Mapping

A common enterprise bug:

```java
@Transactional
public void updateCustomer(Long id, CustomerDto dto) {
    Customer customer = entityManager.find(Customer.class, id);
    mapper.updateEntity(dto, customer);
}
```

If mapper copies all fields:

```java
customer.setName(dto.name());
customer.setEmail(dto.email());
customer.setStatus(dto.status());
customer.setRiskScore(dto.riskScore());
customer.setCreatedAt(dto.createdAt());
```

Dirty checking will persist all differences, including fields the API should not control.

This creates:

- mass assignment vulnerability,
- accidental null overwrite,
- illegal state transition,
- audit confusion,
- version conflict,
- collection replacement bug.

Safer:

```java
@Transactional
public void changeCustomerEmail(Long id, ChangeEmailCommand command) {
    Customer customer = entityManager.find(Customer.class, id);
    customer.changeEmail(command.newEmail());
}
```

For partial update:

```java
if (patch.emailProvided()) {
    customer.changeEmail(patch.email());
}

if (patch.phoneProvided()) {
    customer.changePhone(patch.phone());
}
```

Rule:

> Dirty checking persists object mutation. Therefore the real security boundary is not repository save; it is controlling which mutations are allowed on managed entities.

---

## 16. Dirty Checking and Read-Only Transactions

Read-only transaction does not universally mean “provider cannot dirty check”.

Depending on framework/provider settings, read-only may:

- set flush mode to manual/commit,
- skip snapshot for read-only entities in provider-specific ways,
- avoid dirty checking for marked read-only entities,
- or merely signal intent without hard enforcement.

Hibernate has provider-specific read-only session/query/entity concepts. EclipseLink also has read-only/query hint/cache strategies.

Danger:

```java
@Transactional(readOnly = true)
public CustomerDto getCustomer(Long id) {
    Customer c = entityManager.find(Customer.class, id);
    c.setLastViewedAt(Instant.now());
    return toDto(c);
}
```

Depending configuration, mutation may:

- not flush,
- flush unexpectedly later,
- leave managed state inconsistent with expectation,
- be hidden during tests.

Rule:

> Treat read-only transaction as performance/intent hint, not as your primary correctness guard. Correctness guard is: do not mutate managed entities in read paths.

---

## 17. Dirty Checking and Read Models

For high-volume reads, loading managed entities has hidden cost:

- object hydration,
- persistence context registration,
- snapshot/change tracking baseline,
- dirty checking consideration at flush,
- possible lazy proxy setup.

If endpoint only needs read DTO:

```java
select new com.example.CustomerListItem(c.id, c.name, c.status)
from Customer c
where c.status = :status
```

or native projection can avoid managed entity overhead.

Rule:

> Do not load managed entities for read use cases that do not need mutation, invariants, or lifecycle behavior.

This is especially important for:

- listing screens,
- reports,
- exports,
- dashboards,
- search endpoints,
- audit trail views.

---

## 18. Java 8–25 Compatibility Notes

### 18.1 Java 8 Legacy Stack

Typical stack:

```text
Java 8
JPA 2.1/2.2
javax.persistence.*
Hibernate 5.x
EclipseLink 2.x
```

Concerns:

- older bytecode enhancement plugins,
- javax namespace,
- older Java Time support depending provider version,
- older dirty tracking behavior,
- app server classloader issues,
- less AOT/module concern.

### 18.2 Java 11/17 Modern Transition

Typical stack:

```text
Java 11/17
Jakarta Persistence 3.x or JPA 2.2 depending framework
Hibernate 5.6 / 6.x
EclipseLink 3.x / 4.x
```

Concerns:

- transition from `javax.persistence` to `jakarta.persistence`,
- stronger module/classpath hygiene,
- provider upgrade changes,
- build-time enhancement consistency,
- framework alignment such as Spring Boot 2.x vs 3.x.

### 18.3 Java 21/25 Modern Runtime

Typical stack:

```text
Java 21/25
Jakarta Persistence 3.x
Hibernate 6/7
EclipseLink 4.x
```

Concerns:

- virtual threads do not remove transaction/persistence context constraints,
- faster runtime does not fix bad fetch/dirty checking model,
- bytecode enhancement/weaving must be compatible with build and runtime,
- AOT/native image may constrain reflection/proxy/enhancement,
- provider version alignment matters more than Java version alone.

Important mental model:

> Java 25 may improve language/runtime possibilities, but dirty checking semantics remain provider/persistence-context semantics. Do not assume new Java automatically makes ORM state management safer.

---

## 19. Performance Model

Dirty checking cost appears in several places:

### 19.1 Entity Count Cost

```text
More managed entities = more potential dirty checking work
```

This is why long transactions and OSIV can degrade performance.

### 19.2 Attribute Count Cost

```text
More persistent attributes = larger snapshot and comparison work
```

Wide entity with 80 columns costs more than small entity with 8 columns.

### 19.3 Mutable Type Cost

```text
Mutable values require deep copy/comparison semantics
```

LOB, JSON, XML, serialized fields, mutable embeddables, and custom types can be expensive.

### 19.4 Collection Cost

```text
Collection dirty checking can dominate scalar field dirty checking
```

Especially for:

- large `@OneToMany`,
- many-to-many join tables,
- ordered lists,
- element collections,
- orphan removal,
- replacing collections wholesale.

### 19.5 SQL Shape Cost

Dirty checking produces update actions, but SQL shape determines DB cost.

Important dimensions:

- all columns vs changed columns,
- version column,
- indexes affected,
- triggers fired,
- replication/logging cost,
- row lock duration,
- batchability,
- statement cache reuse.

---

## 20. Correctness Risks

### 20.1 Accidental Mutation

Managed entity is live. Any mutation can become database update.

```java
private void enrich(Customer customer) {
    customer.setDisplayName(calculateDisplayName(customer)); // mapped field?
}
```

If `displayName` is mapped, this is a write.

### 20.2 Missed Mutation

Mutation may not be detected if:

- entity is detached,
- field is not mapped,
- access type mismatch,
- mutable custom type snapshot is broken,
- enhancement/weaving assumption fails,
- update occurs outside transaction and never merged.

### 20.3 Over-Mutation

Provider may update more than expected if:

- all-column update default,
- converter returns unequal value repeatedly,
- lifecycle callback changes timestamp,
- mapper writes same semantic value in different representation,
- collection wrapper sees replacement.

### 20.4 Semantic Dirty vs Technical Dirty

Example:

```java
customer.setName(" Alice ");
customer.normalizeName(); // becomes "Alice"
```

Is that business change?

Dirty checking sees technical state difference. It does not understand business meaning unless domain model encodes it.

---

## 21. Production Failure Modes

### Failure Mode 1 — Unexpected UPDATE During Read Endpoint

Symptom:

```text
GET /customers/10 emits update customer set ...
```

Likely causes:

- read endpoint mutates managed entity,
- `@PostLoad` changes mapped field,
- DTO mapper enriches entity instead of DTO,
- lazy initialization triggers bidirectional helper incorrectly,
- audit timestamp updated in getter.

Diagnosis:

- check SQL logs with call correlation,
- inspect lifecycle callbacks,
- inspect getters for side effects,
- check mapper update methods,
- mark query/entity read-only and compare behavior.

Fix:

- remove mutation from read path,
- use DTO projection,
- mark derived fields `@Transient`,
- move enrichment to DTO.

### Failure Mode 2 — Change Not Persisted

Symptom:

```text
setter called but database row unchanged
```

Likely causes:

- entity detached,
- no transaction/flush,
- wrong persistence context,
- field not mapped,
- mutable type tracking broken,
- rollback occurred,
- read-only mode suppressing flush,
- update made to inverse association side only.

Diagnosis:

- check entity managed status,
- check transaction active,
- check flush logs,
- check mapping access type,
- check owning side,
- check rollback-only status.

Fix:

- update managed entity inside transaction,
- use domain method on owning side,
- fix mapping,
- avoid detached mutation or merge carefully,
- explicit flush only for diagnosis, not as blind fix.

### Failure Mode 3 — Flush Takes Seconds

Symptom:

```text
Business method fast, commit slow
```

Likely causes:

- huge persistence context,
- many managed read entities,
- large collection dirty checking,
- expensive custom type equality,
- cascade graph traversal,
- flush before query repeatedly,
- batch job without clear.

Diagnosis:

- count managed entities if provider stats available,
- enable Hibernate statistics,
- profile commit/flush,
- inspect SQL count,
- inspect collection sizes,
- check batch loop.

Fix:

- use DTO projections for reads,
- split transaction,
- flush/clear batches,
- reduce graph loading,
- use stateless/bulk operation where appropriate,
- optimize custom type mutability.

### Failure Mode 4 — Version Conflict Too Frequent

Symptom:

```text
OptimisticLockException occurs even when users edit different fields
```

Likely causes:

- entity too large as aggregate,
- version increments on technical updates,
- all changes share one root version,
- background job updates same row,
- read path mutates timestamp,
- audit fields in same table cause version churn.

Fix:

- split aggregate/table where appropriate,
- avoid technical writes to business aggregate row,
- move view counters/last viewed data elsewhere,
- use command-specific update strategy,
- evaluate optimistic lock granularity.

### Failure Mode 5 — Collection Delete/Insert Storm

Symptom:

```sql
delete from order_line where order_id = ?
insert into order_line ...
insert into order_line ...
...
```

Likely causes:

- replacing collection reference,
- unidirectional one-to-many join table,
- bag/list mapping with no stable key,
- `equals/hashCode` broken,
- mapper replacing children wholesale.

Fix:

- reconcile collection by stable child identity,
- use helper methods,
- avoid wholesale replacement for large collections,
- choose collection mapping deliberately,
- add database unique constraints.

---

## 22. Design Rules

### Rule 1 — Treat Managed Entity as Live Database-Backed State

If an entity is managed, mutation is not “local object change only”. It is pending database change.

### Rule 2 — Keep Persistence Context Small and Purposeful

Do not load thousands of managed entities if you only need read projection.

### Rule 3 — Avoid Mutation in Read Paths

Read code should not call mutating entity methods. DTO enrichment should happen on DTO, not entity.

### Rule 4 — Use Domain Methods Instead of Blind Setters

Dirty checking persists whatever changed. Domain methods control what is allowed to change.

### Rule 5 — Prefer Immutable Value Objects

Immutable embeddables/value objects make dirty checking safer and equality more stable.

### Rule 6 — Do Not Replace Provider-Managed Collections Casually

Mutate through collection helper methods and preserve bidirectional invariants.

### Rule 7 — Understand Provider Enhancement/Weaving

If your performance/correctness depends on bytecode enhancement or weaving, verify it in build, test, and production.

### Rule 8 — Dynamic Update Is a Trade-Off, Not a Universal Optimization

Use when SQL column reduction matters more than statement shape stability.

### Rule 9 — Dirty Checking Is Not Business Intent

Provider knows state difference, not whether the difference is legally/business meaningful.

### Rule 10 — Test SQL Behavior, Not Just Java State

For important aggregate operations, assert expected SQL count/shape or at least observe it during integration tests.

---

## 23. Anti-Patterns

### Anti-Pattern 1 — “Repository Save Everywhere” Mental Model

```java
customer.setEmail(email);
repository.save(customer);
```

In JPA, if customer is managed, `save` is often unnecessary and may hide misunderstanding. The update comes from dirty checking at flush.

### Anti-Pattern 2 — Entity as API Request Body

```java
@PostMapping("/customers/{id}")
public void update(@RequestBody Customer customer) { ... }
```

This invites detached graph merge bugs, mass assignment, null overwrite, and collection replacement.

### Anti-Pattern 3 — Getters With Side Effects

```java
public String getDisplayName() {
    this.displayName = firstName + " " + lastName;
    return displayName;
}
```

Getter can dirty the entity during serialization.

### Anti-Pattern 4 — `@PostLoad` Mutating Mapped Fields

```java
@PostLoad
void init() {
    this.normalizedName = normalize(name);
}
```

If `normalizedName` is mapped, every load may become update.

### Anti-Pattern 5 — Long Transaction With Large Graph

```java
@Transactional
public void processEverything() {
    List<Order> orders = repository.findAll();
    for (Order order : orders) {
        process(order);
    }
}
```

Can create huge persistence context and expensive flush.

### Anti-Pattern 6 — Blind Collection Replacement From DTO

```java
order.setLines(dto.toLines());
```

Can create delete/insert storm and orphan bugs.

### Anti-Pattern 7 — Mutable Custom Type Without Deep Copy Discipline

Custom type holds mutable internal state but provider snapshot does not isolate it.

Result:

- missed updates,
- excessive updates,
- cache corruption.

---

## 24. Diagnostic Checklist

When update happens unexpectedly:

```text
1. Is the entity managed?
2. What code path mutated it?
3. Did getter/lifecycle callback mutate mapped field?
4. Did mapper write to entity during read?
5. Was flush triggered by query?
6. Which fields are dirty according to provider logs/statistics?
7. Is dynamic update enabled/disabled?
8. Are audit timestamp/version fields changing?
```

When update does not happen:

```text
1. Is entity managed or detached?
2. Is transaction active?
3. Did flush/commit happen?
4. Was transaction rolled back?
5. Is the field mapped?
6. Is access type correct?
7. Is mutation on owning association side?
8. Is custom mutable type correctly tracked?
9. Is read-only mode suppressing flush?
```

When flush is slow:

```text
1. How many entities are managed?
2. How many collections are initialized?
3. How many attributes per entity?
4. Are large mutable values involved?
5. Is batch job clearing persistence context?
6. Are queries triggering repeated auto flush?
7. Is cascade graph too large?
8. Are provider statistics enabled?
```

When collection SQL is excessive:

```text
1. Was collection reference replaced?
2. Is it bag/list/set/map?
3. Is ordering column involved?
4. Is orphan removal enabled?
5. Is owning side maintained?
6. Is equals/hashCode stable?
7. Is child identity stable?
8. Is mapper reconciling or replacing?
```

---

## 25. Practice Scenarios

### Scenario 1 — Read Endpoint Writes Data

You see this SQL during a GET endpoint:

```sql
update application
set display_name = ?, version = ?
where id = ? and version = ?
```

Questions:

1. Which lifecycle callbacks should you inspect?
2. Are any getters mutating mapped fields?
3. Does DTO mapping write back into entity?
4. Is `display_name` derived and should be `@Transient`?
5. Does read endpoint load managed entity unnecessarily?

Expected direction:

- move derived display name to DTO/read model,
- remove mapped field mutation from read path,
- consider projection query.

### Scenario 2 — Batch Job Slows Down Over Time

```java
@Transactional
public void importRows(List<Row> rows) {
    for (Row row : rows) {
        entityManager.persist(toEntity(row));
    }
}
```

At 1,000 rows it is fine. At 200,000 rows it stalls.

Questions:

1. How large is persistence context?
2. How many snapshots are retained?
3. Is JDBC batching enabled?
4. Does ID strategy allow batching?
5. Should `flush()`/`clear()` be used?
6. Should StatelessSession/bulk loader be considered?

Expected direction:

```java
for (int i = 0; i < rows.size(); i++) {
    entityManager.persist(toEntity(rows.get(i)));

    if (i % 500 == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

### Scenario 3 — Patch API Clears Fields Accidentally

DTO:

```json
{
  "email": "new@example.com"
}
```

Mapper sets missing fields to null:

```java
customer.setPhone(dto.phone());
customer.setAddress(dto.address());
```

Dirty checking persists nulls.

Questions:

1. Is null “clear value” or “not provided”?
2. Is mapper patch-aware?
3. Are domain methods command-specific?
4. Are protected fields being exposed to API?

Expected direction:

- use patch command with explicit presence tracking,
- avoid blind entity mapping,
- call domain methods only for provided fields.

### Scenario 4 — Collection Replacement Deletes Rows

```java
order.setLines(request.lines().stream().map(mapper::toEntity).toList());
```

Symptoms:

```sql
delete from order_line where order_id = ?
insert into order_line ...
insert into order_line ...
```

Questions:

1. Is collection wrapper replaced?
2. Is orphan removal active?
3. Is child identity stable?
4. Can we reconcile by line ID/SKU?
5. Is `equals/hashCode` correct?

Expected direction:

- implement `order.reconcileLines(command.lines())`,
- update existing children in place,
- remove only missing children,
- add only new children.

---

## 26. Provider Comparison Summary

| Concern | Hibernate | EclipseLink |
|---|---|---|
| Default mental model | Persistence context with loaded state snapshot and dirty checking on flush | UnitOfWork with backup/change tracking policies |
| Enhancement mechanism | Bytecode enhancement for lazy attributes, inline dirty tracking, association management, optimizations | Weaving for lazy, change tracking, fetch groups, optimization |
| Dirty tracking optimization | Inline dirty tracking via enhancement | Attribute/object change tracking via weaving |
| Fallback/simple mode | Diff-based dirty calculation | Deferred change tracking backup comparison |
| Collection tracking | Persistent collection wrappers | Indirection/proxy/weaving/unit-of-work mechanisms |
| Risk area | large persistence context, mutable types, collection replacement, enhancement mismatch | weaving mismatch, change tracking policy mismatch, shared cache interaction |
| Engineering rule | Understand Session/PersistenceContext/action queue | Understand UnitOfWork/descriptors/weaving/cache |

---

## 27. Top 1% Engineer Mental Model

A strong persistence engineer does not ask only:

> “Did I call save?”

They ask:

```text
1. Is this object managed?
2. What is the baseline state?
3. What mutation occurred?
4. How does provider detect it?
5. When will flush run?
6. What SQL action will be scheduled?
7. Which columns/collections will be affected?
8. Will version increment?
9. What locks/indexes/triggers will database touch?
10. Is this mutation business-valid?
11. Is this mutation observable/auditable?
12. Is this persistence context too large?
13. Is provider enhancement/weaving active as expected?
```

That is the difference between using ORM and engineering with ORM.

---

## 28. Summary

Dirty checking is the mechanism by which ORM providers detect changes to managed entity state and synchronize them to the database during flush.

Key conclusions:

- Dirty checking only applies to managed entities.
- Dirty checking usually runs during flush, not immediately on setter call.
- Hibernate commonly uses snapshot-based diffing, with bytecode enhancement available for inline dirty tracking and related optimizations.
- EclipseLink exposes change tracking policies such as deferred, object, and attribute tracking, with weaving playing an important role.
- Scalar field dirty checking and collection dirty checking are different mechanisms.
- Mutable value types are dangerous unless snapshot/deep-copy semantics are correct.
- Dirty checking detects state difference, not business intent.
- Read endpoints can accidentally write if they mutate managed entities.
- Large persistence contexts make dirty checking expensive.
- DTO mapping and collection replacement are common sources of production bugs.
- Provider-specific behavior matters for correctness and performance.

The central mental model:

```text
Managed entity mutation
    -> provider tracks or later compares state
    -> flush evaluates dirty state
    -> SQL mutation plan produced
    -> database state synchronized
```

Once you internalize that, Hibernate/EclipseLink behavior becomes much less mysterious.

---

## 29. References

- Jakarta Persistence 3.2 Specification — persistence context, entity lifecycle, flush semantics, and persistence model.
- Hibernate ORM User Guide — persistence context, dirty checking, mutable values, bytecode enhancement, inline dirty tracking.
- Hibernate ORM Bytecode Enhancement documentation — lazy attribute loading, inline dirty tracking, bidirectional association management, optimization behavior.
- Hibernate ORM 7.1 Migration Guide — notes on bytecode enhancement option deprecations and recommended direct association management.
- EclipseLink Documentation — `@ChangeTracking`, deferred/object/attribute change tracking, weaving requirements.
- EclipseLink FAQ/JPA — explanation of attribute change tracking and deferred change tracking behavior.

---

# Seri Progress

```text
[x] Part 0  — Orientation: ORM as State Synchronization Engine, Not Just Mapping
[x] Part 1  — JPA Specification vs Provider Reality
[x] Part 2  — Persistence Unit, Bootstrap, Metadata, and Provider Initialization
[x] Part 3  — Entity Identity: Java Object Identity, Database Identity, Persistence Context Identity
[x] Part 4  — Persistence Context Deep Dive: Unit of Work, First-Level Cache, and Object Graph Scope
[x] Part 5  — Dirty Checking Internals and Change Detection Strategies
[ ] Part 6  — Flush Semantics: The Most Misunderstood Part of ORM
[ ] Part 7  — SQL Generation Pipeline and Dialect Behavior
[ ] Part 8  — Mapping Strategy Beyond Annotation Memorization
[ ] Part 9  — Association Mapping: Ownership, Foreign Keys, Join Tables, and Graph Mutation
[ ] Part 10 — Collection Mapping: Bags, Lists, Sets, Maps, Ordering, and Hidden Costs
[ ] Part 11 — Cascades, Orphan Removal, Lifecycle Propagation, and Aggregate Boundaries
[ ] Part 12 — Inheritance Mapping: Object Hierarchy vs Relational Shape
[ ] Part 13 — Embeddables, Value Objects, Attribute Converters, and Type Systems
[ ] Part 14 — Fetching Mental Model: Lazy, Eager, Proxies, Enhancement, and Load Plans
[ ] Part 15 — N+1, Cartesian Explosion, and Fetch Plan Engineering
[ ] Part 16 — JPQL, HQL, Criteria, Native Query, and Query Plan Discipline
[ ] Part 17 — Bulk Operations, Batching, Stateless Sessions, and High-Volume Data Mutation
[ ] Part 18 — Transaction Integration: Resource Local, JTA, Spring, Jakarta EE, and Boundary Design
[ ] Part 19 — Concurrency Control: Optimistic Locking, Pessimistic Locking, and Lost Updates
[ ] Part 20 — Merge, Detach, DTO Mapping, and API Boundary Safety
[ ] Part 21 — Second-Level Cache, Query Cache, Natural ID Cache, and Cache Correctness
[ ] Part 22 — Schema Generation, Validation, Migration, and DDL Discipline
[ ] Part 23 — Provider Enhancement and Weaving: Bytecode, Proxies, Lazy Fields, and Build Pipelines
[ ] Part 24 — Hibernate ORM Deep Dive: Architecture, Session, Event System, Interceptors, and Extensions
[ ] Part 25 — EclipseLink Deep Dive: Sessions, Descriptors, Weaving, Cache, and Advanced Mappings
[ ] Part 26 — Hibernate vs EclipseLink: Behavioral Differences That Matter
[ ] Part 27 — Observability: SQL Logging, Statistics, Metrics, Tracing, and Production Diagnosis
[ ] Part 28 — Performance Engineering: Cost Model from Object Graph to Database Work
[ ] Part 29 — Domain Modeling with ORM: Aggregates, Invariants, State Machines, and Regulatory Workflows
[ ] Part 30 — Multi-Tenancy, Security, Filters, Row-Level Isolation, and Data Leakage Prevention
[ ] Part 31 — Testing ORM Correctness: Beyond Repository Happy Path
[ ] Part 32 — Migration Engineering: Javax to Jakarta, Hibernate 5 to 6/7, EclipseLink 2 to 4
[ ] Part 33 — Production Failure Playbook: Symptoms, Root Causes, and Fix Patterns
[ ] Part 34 — Capstone: Designing a Production-Grade Persistence Layer for Complex Case Management
```

Seri belum selesai. Part berikutnya: `06-flush-semantics-action-queue-sql-ordering.md`.

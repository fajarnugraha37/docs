# Part 6 — Flush Semantics: Action Queue and SQL Ordering

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Bagian: `06`  
> Fokus: memahami `flush` sebagai mekanisme sinkronisasi state object graph ke database operations, bukan sebagai `commit`.

---

## 0. Posisi Materi Ini Dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi:

1. ORM bukan sekadar mapper, tetapi engine sinkronisasi state.
2. JPA specification memberi kontrak minimum, provider memberi real behavior.
3. Entity identity menentukan apakah object dianggap sama, baru, managed, detached, atau removed.
4. Persistence context bertindak sebagai identity map, first-level cache, dan unit of work.
5. Dirty checking mendeteksi perubahan managed entity.

Bagian ini masuk ke pertanyaan berikutnya:

> Setelah provider tahu ada entity baru, entity berubah, entity dihapus, atau collection berubah, kapan dan bagaimana perubahan itu benar-benar menjadi SQL?

Jawabannya adalah: **flush**.

Flush adalah salah satu mekanisme paling penting dalam ORM dan juga salah satu yang paling sering disalahpahami.

Banyak developer mengira:

```text
persist/update/remove = langsung SQL
commit = baru SQL
flush = sama dengan commit
```

Mental model itu berbahaya. Model yang lebih tepat:

```text
Application mutates managed objects
        ↓
Persistence context records state
        ↓
Dirty checking detects changes
        ↓
Flush translates object state changes into SQL actions
        ↓
SQL is executed against database connection
        ↓
Transaction commit decides durability/visibility according to DB rules
```

Flush bukan commit. Flush adalah **database synchronization step inside an active transaction**.

---

## 1. Why This Matters

Flush menentukan banyak hal yang terlihat “aneh” dalam aplikasi production:

- Kenapa query `SELECT` tiba-tiba mengeksekusi `INSERT` atau `UPDATE` lebih dulu?
- Kenapa constraint violation muncul sebelum `commit()`?
- Kenapa data yang baru diubah bisa terbaca oleh query dalam transaksi yang sama?
- Kenapa `remove()` tidak langsung menghapus row?
- Kenapa urutan insert/update/delete tidak sama dengan urutan kode Java?
- Kenapa batch insert tidak aktif walaupun sudah konfigurasi JDBC batching?
- Kenapa query read-only lambat karena session berisi banyak managed entity?
- Kenapa validation logic membaca database state yang belum sinkron?
- Kenapa bulk update membuat persistence context menjadi stale?

Dalam sistem enterprise, regulatory workflow, case management, approval lifecycle, dan audit trail, flush semantics bisa menjadi sumber bug correctness yang serius.

Contoh sederhana:

```java
caseEntity.setStatus(CaseStatus.APPROVED);

boolean alreadyHasActiveApproval = approvalRepository.existsActiveApproval(caseEntity.getId());
```

Kelihatannya hanya update status lalu query validasi. Namun query kedua dapat memicu flush otomatis. Artinya update status mungkin sudah dikirim ke database sebelum validasi selesai. Jika validasi gagal dan exception di-handle secara keliru, state database dan object graph bisa menjadi sumber kebingungan.

Flush adalah batas antara:

```text
in-memory object world
```

dan:

```text
database constraint, lock, trigger, index, FK, unique constraint, version check, audit trigger world
```

Top engineer tidak hanya tahu `flush()` ada. Ia tahu **kapan provider melakukan flush, apa yang ikut di-flush, bagaimana SQL diurutkan, dan failure mode apa yang mungkin muncul**.

---

## 2. Core Mental Model

### 2.1 Flush sebagai sinkronisasi, bukan transaksi akhir

Flush melakukan sinkronisasi perubahan persistence context ke database melalui SQL.

Commit menyelesaikan transaksi database.

Perbedaannya:

| Aspek | Flush | Commit |
|---|---|---|
| Tujuan | Mengirim perubahan ke database connection | Menutup transaksi dan membuat perubahan durable |
| Bisa rollback setelahnya? | Ya, selama transaksi belum commit | Tidak, setelah commit berhasil |
| Menjalankan SQL? | Ya | Bisa memicu flush lalu commit |
| Mengecek constraint database? | Ya, jika SQL menyentuh constraint | Ya, untuk constraint deferred / commit-time behavior |
| Mengakhiri persistence context? | Tidak selalu | Tergantung scope/context |
| Membuat data visible ke transaksi lain? | Umumnya tidak sebelum commit | Ya, tergantung isolation level |

Mental model:

```text
flush  = "database, please apply these changes inside my current transaction"
commit = "database, make this transaction final"
```

Flush dapat terjadi berkali-kali dalam satu transaksi.

```text
begin transaction
  persist A
  flush  → INSERT A
  update A
  flush  → UPDATE A
  remove A
  flush  → DELETE A
commit
```

Semua SQL tersebut masih dapat di-rollback jika transaksi belum commit.

---

### 2.2 Flush sebagai fase Unit of Work

Persistence context mengumpulkan perubahan. Flush adalah fase ketika unit of work diterjemahkan menjadi operasi database.

```text
Managed entities
Collections
Entity snapshots
Entity state transitions
        ↓
Dirty checking
        ↓
Action queue / change set
        ↓
SQL generation
        ↓
JDBC execution
```

Provider tidak wajib mengeksekusi SQL tepat saat Anda memanggil:

```java
entityManager.persist(entity);
entity.setName("New Name");
entityManager.remove(entity);
```

Operasi tersebut lebih tepat dibaca sebagai:

```text
register new object
mark object dirty
mark object removed
```

SQL-nya biasanya baru keluar pada flush.

---

### 2.3 Flush mengubah database transaction state, bukan necessarily committed state

Setelah flush berhasil, database sudah menerima SQL. Ini berarti:

- row bisa terkunci,
- sequence bisa sudah terpakai,
- trigger bisa sudah jalan,
- FK bisa sudah dicek,
- unique constraint bisa sudah dicek,
- version column bisa sudah berubah di database transaction,
- generated column/default bisa tersedia jika provider mengambilnya.

Tetapi transaksi lain belum tentu melihat perubahan tersebut.

```text
Transaction T1:
  UPDATE case SET status = 'APPROVED' WHERE id = 10
  -- flushed, not committed

Transaction T2:
  SELECT status FROM case WHERE id = 10
  -- usually still sees old value under READ COMMITTED
```

Jadi flush bukan visibility guarantee untuk transaksi lain. Flush adalah synchronization guarantee untuk transaksi saat ini.

---

## 3. Specification-Level Concept

### 3.1 JPA/Jakarta Persistence view

Dalam JPA, `EntityManager.flush()` menyinkronkan persistence context ke underlying database.

Kontrak penting:

- Flush berlaku pada persistence context aktif.
- Flush membutuhkan transaksi aktif untuk operasi write normal.
- Flush dapat terjadi otomatis tergantung flush mode.
- Provider boleh melakukan SQL ordering untuk menjaga referential integrity.
- Exception saat flush biasanya menyebabkan transaksi perlu di-rollback.

Contoh:

```java
entityManager.persist(application);
entityManager.flush();
```

Setelah `flush()`, provider harus mengirim perubahan yang diperlukan ke database. Namun transaksi belum selesai.

---

### 3.2 Flush mode menurut JPA

JPA mendefinisikan `FlushModeType` utama:

```java
FlushModeType.AUTO
FlushModeType.COMMIT
```

#### AUTO

Provider boleh melakukan flush sebelum query jika query tersebut mungkin membutuhkan data terbaru dari persistence context.

Secara praktis, `AUTO` berarti:

```text
Flush before commit.
Flush before some queries when needed to keep query results consistent.
```

#### COMMIT

Provider menunda flush sampai commit sejauh mungkin.

Secara praktis:

```text
Flush at transaction commit.
Query before commit may not see in-memory changes unless provider chooses to flush.
```

Namun jangan mengira `COMMIT` berarti flush tidak akan pernah terjadi sebelum commit. Provider masih dapat flush dalam situasi tertentu, misalnya karena kebutuhan ID, constraint, explicit flush, atau provider-specific behavior.

---

### 3.3 JPA tidak menjamin semua detail internal

Specification tidak menjelaskan semua detail seperti:

- urutan internal action queue provider,
- kapan persis dirty checking dilakukan,
- algoritma batching,
- optimasi query space,
- native SQL synchronization behavior,
- provider-specific flush mode,
- exact SQL order untuk semua mapping kompleks,
- interaction dengan second-level cache secara detail.

Inilah kenapa engineer perlu memahami provider behavior, khususnya Hibernate dan EclipseLink.

---

## 4. Provider Mental Model: Hibernate vs EclipseLink

### 4.1 Hibernate mental model

Hibernate memiliki konsep internal yang sangat penting:

```text
Session
  PersistenceContext
  ActionQueue
```

Secara sederhana:

```text
Entity operations and dirty checking produce actions
        ↓
Actions are stored in ActionQueue
        ↓
Flush processes ActionQueue and dirty entities
        ↓
SQL is executed in an ordered sequence
```

Action dapat berupa:

- entity insert,
- entity update,
- entity delete,
- collection recreate,
- collection remove,
- collection update,
- orphan removal,
- queued collection operation.

Saat flush, Hibernate tidak sekadar “loop entity lalu update”. Ia melakukan proses lebih kompleks:

1. Detect dirty entities.
2. Detect dirty collections.
3. Schedule entity/collection actions.
4. Sort actions jika konfigurasi ordering aktif.
5. Execute SQL through JDBC coordinator.
6. Update snapshots / persistence context state.
7. Handle generated values/version.

Konseptual:

```text
flush()
  ├─ pre-flush event
  ├─ dirty checking
  ├─ cascade processing
  ├─ action queue preparation
  ├─ SQL execution
  │   ├─ inserts
  │   ├─ updates
  │   ├─ collection deletes
  │   ├─ collection inserts
  │   └─ deletes
  ├─ post-flush event
  └─ snapshot synchronization
```

Detail persis dapat berubah antar versi Hibernate, tetapi mental model action queue tetap sangat berguna.

---

### 4.2 EclipseLink mental model

EclipseLink memakai konsep `UnitOfWork` dan change sets.

Secara konseptual:

```text
UnitOfWork
  registered objects
  clones / working copies
  change sets
  commit manager
```

Ketika flush/commit unit of work terjadi:

1. EclipseLink menentukan object changes.
2. Membentuk change sets.
3. Menghitung dependency antar object.
4. Mengurutkan database operations.
5. Menjalankan SQL.
6. Mengintegrasikan perubahan kembali ke shared/session cache sesuai konfigurasi.

EclipseLink sangat kuat pada konsep descriptor, weaving, change tracking, dan shared cache. Karena itu flush behavior dapat dipengaruhi oleh:

- change tracking policy,
- weaving active atau tidak,
- descriptor customization,
- cache isolation,
- relationship mapping,
- batch writing configuration.

---

## 5. Flush Triggers

Flush bisa terjadi karena beberapa pemicu.

### 5.1 Transaction commit

Pemicu paling umum:

```java
@Transactional
public void approve(Long id) {
    Case c = entityManager.find(Case.class, id);
    c.approve();
}
```

Tidak ada `save()`, tidak ada `flush()`. Namun saat transaksi commit, provider flush perubahan:

```sql
update cases set status = 'APPROVED', version = version + 1 where id = ? and version = ?
```

Pada managed entity, assignment Java cukup untuk membuat dirty state. Flush saat commit mengirim SQL.

---

### 5.2 Explicit `flush()`

```java
entityManager.persist(caseEntity);
entityManager.flush();
```

Dipakai ketika Anda sengaja ingin:

- memaksa SQL keluar sekarang,
- mendapatkan constraint violation lebih awal,
- mendapatkan generated value yang baru tersedia setelah insert,
- membatasi batch memory dengan `flush/clear`,
- memastikan subsequent native query melihat perubahan,
- menguji mapping/SQL secara eksplisit.

Namun explicit flush bukan hal yang harus dipakai sembarangan. Terlalu banyak flush bisa:

- menambah round trip,
- memecah JDBC batch,
- meningkatkan lock duration,
- menyebabkan constraint dicek terlalu awal,
- membuat transaction flow sulit dipahami.

---

### 5.3 Query execution under AUTO flush

Contoh:

```java
Case c = entityManager.find(Case.class, 10L);
c.setStatus(CaseStatus.APPROVED);

List<Case> approvedCases = entityManager.createQuery("""
    select c from Case c where c.status = :status
""", Case.class)
.setParameter("status", CaseStatus.APPROVED)
.getResultList();
```

Dengan flush mode `AUTO`, provider dapat melakukan flush sebelum query supaya query result konsisten dengan perubahan in-memory.

Urutan aktual bisa menjadi:

```text
find case 10
mutate status in memory
query approved cases
  → auto flush
    → update case 10 set status = 'APPROVED'
  → execute select approved cases
```

Ini masuk akal karena jika tidak flush, query database tidak akan tahu status case 10 sudah berubah di memory.

---

### 5.4 Native query execution

Native query lebih tricky karena provider tidak selalu tahu tabel mana yang disentuh query.

```java
entityManager.createNativeQuery("select count(*) from cases").getSingleResult();
```

Provider mungkin melakukan flush karena native SQL bisa membaca tabel yang sedang memiliki pending changes.

Hibernate menyediakan mekanisme synchronization query spaces untuk native query, tetapi detailnya provider-specific.

Prinsip aman:

> Jika native query harus membaca state terbaru dari pending managed changes, lakukan explicit flush atau gunakan API synchronization provider-specific dengan disiplin.

---

### 5.5 ID generation strategy

Beberapa ID strategy memaksa SQL lebih awal.

Contoh `IDENTITY`:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Database menghasilkan ID saat insert. Provider sering perlu melakukan insert segera untuk mendapatkan ID.

```java
Order order = new Order();
entityManager.persist(order);
Long id = order.getId();
```

Dengan IDENTITY, insert bisa terjadi lebih awal dibanding SEQUENCE, karena provider butuh database-generated identity value.

Dampaknya:

- batching insert lebih sulit,
- SQL bisa keluar saat persist atau sebelum flush normal,
- ordering behavior berbeda.

Dengan SEQUENCE:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE)
private Long id;
```

Provider bisa mengambil sequence value lebih dulu:

```sql
select nextval('order_seq')
```

lalu menunda insert sampai flush.

---

### 5.6 Relationship/cascade processing

Flush dapat memicu cascade processing lanjutan.

```java
Order order = new Order();
OrderLine line = new OrderLine();
order.addLine(line);

entityManager.persist(order);
```

Jika cascade persist ada:

```java
@OneToMany(mappedBy = "order", cascade = CascadeType.PERSIST)
private List<OrderLine> lines;
```

Saat flush, provider memastikan child ikut dipersist dan FK diatur.

---

## 6. Flush Mode Deep Dive

### 6.1 AUTO

`AUTO` adalah default umum.

```java
entityManager.setFlushMode(FlushModeType.AUTO);
```

Maknanya:

- flush saat commit,
- flush sebelum query jika diperlukan/ditentukan provider,
- menjaga query result lebih konsisten dengan persistence context.

Cocok untuk sebagian besar aplikasi transactional command.

Risiko:

- query read dapat memicu write SQL,
- constraint violation muncul di tengah method,
- performance read query bisa terganggu karena dirty checking.

Contoh surprise:

```java
@Transactional
public void validateThenApprove(Long id) {
    Case c = em.find(Case.class, id);
    c.setStatus(APPROVED);

    // Looks like validation query, but may trigger flush first.
    boolean exists = em.createQuery("""
        select count(a) > 0 from Approval a where a.caseId = :id
    """, Boolean.class)
    .setParameter("id", id)
    .getSingleResult();

    if (!exists) {
        throw new IllegalStateException("Approval missing");
    }
}
```

Jika query memicu flush, update status dikirim sebelum validasi selesai. Rollback masih bisa membatalkan, tetapi side effect seperti trigger, lock, dan constraint check dapat terjadi lebih awal.

---

### 6.2 COMMIT

```java
entityManager.setFlushMode(FlushModeType.COMMIT);
```

Makna umum:

- tunda flush sampai commit,
- query sebelum commit mungkin tidak melihat perubahan pending,
- dapat mengurangi flush frequency pada transaction read-heavy.

Namun ini bukan silver bullet.

Contoh:

```java
Case c = em.find(Case.class, id);
c.setStatus(APPROVED);

Long count = em.createQuery("""
    select count(c) from Case c where c.status = :status
""", Long.class)
.setParameter("status", APPROVED)
.getSingleResult();
```

Dengan COMMIT, query count mungkin tidak menghitung perubahan `c` yang masih pending di memory.

Jadi COMMIT bisa membuat query result tidak sinkron dengan object graph saat ini.

Gunakan jika Anda benar-benar paham konsekuensinya.

---

### 6.3 Hibernate-specific flush modes

Hibernate memiliki flush mode tambahan, tergantung versi/API:

- `AUTO`,
- `COMMIT`,
- `MANUAL`,
- historically `ALWAYS` dalam konteks tertentu.

`MANUAL` berarti Hibernate tidak flush otomatis kecuali dipanggil manual.

Ini sering dipakai untuk read-only processing atau batch read besar.

Namun bahaya:

```java
session.setHibernateFlushMode(FlushMode.MANUAL);
entity.setName("Changed");
transaction.commit();
```

Jika tidak ada explicit flush, perubahan bisa tidak terkirim.

Gunakan `MANUAL` hanya untuk scope yang sangat jelas.

---

### 6.4 Read-only transaction dan flush mode

Dalam Spring, `@Transactional(readOnly = true)` dapat mengubah behavior provider/framework, misalnya flush mode lebih conservative atau dirty checking optimization pada beberapa konfigurasi.

Namun prinsip penting:

> `readOnly = true` bukan security boundary dan bukan guarantee database tidak akan berubah.

Jika code melakukan write di dalam read-only transaction, hasilnya tergantung:

- framework,
- provider,
- transaction manager,
- database,
- connection read-only enforcement,
- flush mode.

Jangan jadikan `readOnly = true` sebagai satu-satunya pelindung dari mutation.

---

## 7. Action Queue and SQL Ordering

### 7.1 Kenapa SQL tidak selalu mengikuti urutan kode Java

Contoh:

```java
Department dept = new Department("Compliance");
Employee emp = new Employee("Alice");

emp.setDepartment(dept);

entityManager.persist(emp);
entityManager.persist(dept);
```

Kode memanggil persist employee dulu, lalu department. Tetapi jika `employee.department_id` FK ke department, database butuh department row ada dulu.

SQL yang benar:

```sql
insert into department (...);
insert into employee (..., department_id);
```

Provider dapat mengurutkan SQL berdasarkan dependency, bukan urutan kode.

---

### 7.2 Insert ordering

Insert ordering perlu mempertimbangkan:

- FK dependency,
- nullable vs non-nullable FK,
- cascade persist,
- identifier availability,
- joined inheritance,
- secondary table,
- batch grouping.

Contoh aggregate:

```text
Case
 ├─ CaseParty
 ├─ CaseDocument
 └─ CaseTask
```

SQL ideal:

```sql
insert into cases (...);
insert into case_party (... case_id ...);
insert into case_document (... case_id ...);
insert into case_task (... case_id ...);
```

Jika ID parent belum tersedia, provider harus mendapatkannya dulu.

---

### 7.3 Update ordering

Update ordering penting untuk:

- avoiding unique constraint violation,
- maintaining FK constraints,
- batching by entity type,
- version update.

Contoh swap ordering problem:

```text
user A has username 'x'
user B has username 'y'

swap:
A.username = 'y'
B.username = 'x'
```

Jika `username` unique, simple flush dapat gagal:

```sql
update users set username = 'y' where id = A; -- violates because B still has y
update users set username = 'x' where id = B;
```

ORM tidak otomatis memahami semantic swap. Anda perlu strategi domain/database:

- temporary value,
- deferrable constraint jika database mendukung,
- explicit SQL ordering,
- separate transaction,
- different model.

---

### 7.4 Delete ordering

Delete ordering biasanya child dulu, parent kemudian.

```text
Case
 └─ CaseDocument
```

Jika FK `case_document.case_id` mengarah ke `case.id`, delete parent dulu akan gagal.

SQL yang benar:

```sql
delete from case_document where case_id = ?;
delete from cases where id = ?;
```

Namun cascade configuration, orphan removal, database `ON DELETE CASCADE`, dan soft delete dapat mengubah behavior.

---

### 7.5 Collection operation ordering

Collection mapping bisa menghasilkan SQL yang tidak intuitif.

Contoh unidirectional `@OneToMany` dengan join table:

```java
@OneToMany
@JoinTable(name = "case_documents")
private List<Document> documents;
```

Menghapus satu document dari list bisa menghasilkan:

```sql
delete from case_documents where case_id = ?;
insert into case_documents(case_id, document_id) values (?, ?);
insert into case_documents(case_id, document_id) values (?, ?);
```

Provider dapat menghapus semua row join table lalu insert ulang, tergantung mapping dan provider.

Ini bukan bug provider semata; sering kali mapping-nya tidak membawa cukup identity/ownership semantics untuk update minimal.

---

## 8. Flush Lifecycle Step by Step

Misal kita punya model:

```java
@Entity
@Table(name = "cases")
public class CaseEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    @OneToMany(mappedBy = "caseEntity", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CaseTask> tasks = new ArrayList<>();

    public void approve(String approver) {
        if (status != CaseStatus.PENDING_REVIEW) {
            throw new IllegalStateException("Only pending case can be approved");
        }
        status = CaseStatus.APPROVED;
        tasks.add(new CaseTask(this, "Notify applicant", approver));
    }
}
```

Service:

```java
@Transactional
public void approveCase(Long caseId, String approver) {
    CaseEntity c = em.find(CaseEntity.class, caseId);
    c.approve(approver);
}
```

### Step 1 — Load entity

```sql
select c.id, c.version, c.status
from cases c
where c.id = ?;
```

Provider stores:

```text
managed object: CaseEntity#10
snapshot: status=PENDING_REVIEW, version=3
```

### Step 2 — Mutate object

```java
status = APPROVED;
tasks.add(new CaseTask(...));
```

No SQL yet.

### Step 3 — Commit triggers flush

Flush starts.

Provider detects:

```text
CaseEntity#10 dirty: status changed
CaseTask new: must insert
Collection tasks changed
```

### Step 4 — Action queue/change set

Actions:

```text
UPDATE cases SET status=?, version=? WHERE id=? AND version=?
INSERT case_task (...)
```

### Step 5 — SQL execution

Possible SQL:

```sql
update cases
set status = 'APPROVED', version = 4
where id = 10 and version = 3;

insert into case_task(id, case_id, title, assignee)
values (?, 10, 'Notify applicant', ?);
```

### Step 6 — Version check

If update count is 0:

```text
OptimisticLockException / StaleObjectStateException
```

Meaning another transaction modified the row.

### Step 7 — Snapshot update

If flush succeeds, provider updates internal snapshot:

```text
status=APPROVED, version=4
```

### Step 8 — Commit

Database transaction commits. Changes become durable.

---

## 9. Flush and Constraint Timing

### 9.1 Constraint violation can happen at flush

```java
User user = new User();
user.setEmail("existing@example.com");
em.persist(user);

em.flush();
```

If email unique:

```sql
insert into users(email) values ('existing@example.com')
```

Database throws unique constraint violation at flush.

If no explicit flush, violation likely appears at transaction commit because commit triggers flush.

Important:

> The line that throws exception may not be the line where the invalid state was created.

Invalid state can be created earlier in object graph. Flush only reveals it.

---

### 9.2 FK violation

```java
OrderLine line = new OrderLine();
line.setOrder(nonManagedOrderWithInvalidId);
em.persist(line);
em.flush();
```

Flush may fail:

```text
foreign key constraint violation
```

The real bug might be:

- detached object used incorrectly,
- missing cascade persist,
- wrong owning side,
- assigned invalid FK,
- deleted parent.

---

### 9.3 Not-null violation

```java
CaseTask task = new CaseTask();
em.persist(task);
em.flush();
```

If `case_id` is non-null:

```text
not-null property references a null or transient value
```

Hibernate may catch some nullability issues before database. Others appear from database.

---

### 9.4 Deferred constraints

Some databases support deferrable constraints. In that case, certain constraint checks can happen at commit rather than each statement.

Do not assume all databases behave the same.

For portability, design ORM operations so normal immediate constraints pass without relying heavily on deferred constraint semantics unless your database standard explicitly allows it.

---

## 10. Flush and Query Consistency

### 10.1 Query must reconcile object world and database world

Persistence context may have changes not yet in database.

```text
Persistence context:
  Case#10 status = APPROVED

Database before flush:
  Case#10 status = PENDING_REVIEW
```

If you execute:

```java
select c from Case c where c.status = APPROVED
```

Should `Case#10` be included?

If provider wants query result consistent with in-memory changes, it must flush first.

---

### 10.2 Query space optimization

Hibernate can reason about query spaces/tables in some cases.

Example:

```java
caseEntity.setStatus(APPROVED);

em.createQuery("select p from Product p", Product.class).getResultList();
```

If pending changes touch `cases` table and query reads `product` table, flush may be skipped.

But this is provider behavior. Do not build fragile correctness logic that depends on exact flush skip.

---

### 10.3 Native query ambiguity

Native SQL can be opaque:

```java
em.createNativeQuery("select * from reporting_case_summary(?)")
```

Provider may not know what tables function reads.

If correctness depends on pending changes being visible:

```java
em.flush();
Object result = em.createNativeQuery(...).getSingleResult();
```

Make the synchronization boundary explicit.

---

## 11. Flush and ID Generation

### 11.1 SEQUENCE supports delayed insert better

With sequence:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_seq")
private Long id;
```

Provider can get ID before insert:

```sql
select nextval('case_seq')
```

Then object has ID, but insert can wait until flush.

Benefits:

- better batching,
- clearer unit of work,
- insert ordering flexibility.

---

### 11.2 IDENTITY often forces earlier insert

With identity:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Database assigns ID during insert.

Provider often must execute insert to obtain ID:

```sql
insert into cases (...) values (...)
```

Then retrieve generated key.

Dampak:

- batching inserts can be limited,
- insert may happen earlier than expected,
- object can become persistent with database row before broader object graph is complete.

---

### 11.3 UUID assigned in application

With UUID generated in Java:

```java
@Id
private UUID id = UUID.randomUUID();
```

Provider does not need DB round trip for ID.

Pros:

- batching-friendly,
- object identity available early,
- distributed creation possible.

Cons:

- index locality concerns depending UUID version/storage,
- larger key,
- DB-specific UUID type behavior.

Flush interaction is usually simpler than identity.

---

## 12. Flush and Optimistic Locking

### 12.1 Version check happens during SQL update/delete

```java
@Version
private long version;
```

Flush generates:

```sql
update cases
set status = ?, version = ?
where id = ? and version = ?;
```

If another transaction already updated row version, row count becomes 0.

Provider throws optimistic locking exception.

This can occur at:

- explicit flush,
- query-triggered flush,
- commit-triggered flush.

So optimistic lock exception does not always appear only at commit.

---

### 12.2 Force increment

Some flows need version increment even if only child state changes or if you need aggregate-level conflict detection.

Example:

```java
em.lock(caseEntity, LockModeType.OPTIMISTIC_FORCE_INCREMENT);
```

Flush may issue version increment SQL.

Use case:

- approval workflow,
- task assignment,
- aggregate-level update conflict,
- ensuring concurrent changes to related rows conflict at aggregate root.

Be careful: forced version updates increase contention.

---

## 13. Flush and Pessimistic Locking

If you acquire a lock:

```java
CaseEntity c = em.find(
    CaseEntity.class,
    id,
    LockModeType.PESSIMISTIC_WRITE
);
```

Provider may issue:

```sql
select ... from cases where id = ? for update
```

Pending changes before a lock query may trigger flush first, depending provider and flush mode.

Reason: database lock/query result should reflect consistent state.

Failure modes:

- deadlock if flush updates table A then lock query locks table B while another transaction does opposite,
- lock wait timeout,
- broader lock duration because flush happened early,
- unexpected writes before lock acquisition.

Design rule:

> For pessimistic workflows, acquire locks early and mutate after lock acquisition when possible.

---

## 14. Flush and Cascades

### 14.1 Cascade is often resolved during flush

```java
Order order = new Order();
OrderLine line = new OrderLine();
order.addLine(line);

em.persist(order);
```

With:

```java
@OneToMany(mappedBy = "order", cascade = CascadeType.ALL)
private List<OrderLine> lines;
```

Flush discovers/schedules child inserts.

If cascade missing:

```text
object references an unsaved transient instance
```

or FK null/constraint violation.

---

### 14.2 Orphan removal timing

```java
caseEntity.getTasks().remove(task);
```

With orphan removal:

```java
@OneToMany(mappedBy = "caseEntity", orphanRemoval = true)
private List<CaseTask> tasks;
```

The delete usually happens at flush:

```sql
delete from case_task where id = ?;
```

Before flush, object may still exist in database.

This matters if subsequent query checks database state.

---

### 14.3 Cascade remove danger

```java
@ManyToOne(cascade = CascadeType.REMOVE)
private User assignedUser;
```

This is usually dangerous.

If task is removed, cascade remove may delete shared user.

Flush is when the damage becomes SQL:

```sql
delete from users where id = ?;
```

Design rule:

> Cascade remove should usually stay inside strict aggregate ownership boundary.

---

## 15. Flush and Collection Mutation

### 15.1 Collection wrappers track changes

Providers replace normal collections with managed wrappers.

```java
caseEntity.getTasks().add(task);
caseEntity.getTasks().remove(oldTask);
```

The wrapper tracks collection dirty state.

Flush processes collection operations.

---

### 15.2 List with order column

```java
@OneToMany
@OrderColumn(name = "position")
private List<Task> tasks;
```

Removing first item may update positions for many rows:

```sql
update task set position = 0 where id = ?;
update task set position = 1 where id = ?;
update task set position = 2 where id = ?;
```

Flush cost can be O(n) for list reorder.

---

### 15.3 Many-to-many collection mutation

```java
@ManyToMany
private Set<Role> roles;
```

Adding/removing role modifies join table:

```sql
insert into user_role(user_id, role_id) values (?, ?);
delete from user_role where user_id = ? and role_id = ?;
```

But depending mapping and collection type, provider may delete/reinsert more than expected.

Many-to-many should be used carefully in enterprise systems because relationship often has attributes:

- assignedBy,
- assignedAt,
- effectiveFrom,
- effectiveTo,
- status,
- source.

If relationship has lifecycle, model it as entity.

---

## 16. Flush and Bulk Operations

Bulk JPQL update/delete bypass persistence context.

```java
em.createQuery("""
    update CaseEntity c
    set c.status = :closed
    where c.lastUpdated < :cutoff
""")
.setParameter("closed", CLOSED)
.setParameter("cutoff", cutoff)
.executeUpdate();
```

This SQL updates database directly.

Existing managed entities are not automatically updated in memory.

```java
CaseEntity c = em.find(CaseEntity.class, id); // status OPEN

em.createQuery("update CaseEntity c set c.status = CLOSED").executeUpdate();

c.getStatus(); // still OPEN in memory
```

After bulk operation, common strategy:

```java
em.clear();
```

or avoid mixing bulk updates with managed entity logic in same persistence context.

Flush interaction:

- provider may flush pending changes before bulk query,
- bulk update then bypasses context,
- context becomes stale.

Design rule:

> Treat bulk operations as direct SQL operations. Isolate them from normal entity graph workflows.

---

## 17. Flush and JDBC Batching

### 17.1 Batching needs compatible SQL grouping

JDBC batching groups similar prepared statements:

```sql
insert into task(id, case_id, title) values (?, ?, ?)
insert into task(id, case_id, title) values (?, ?, ?)
insert into task(id, case_id, title) values (?, ?, ?)
```

Flush determines when batch is executed.

Batching can be affected by:

- IDENTITY generator,
- interleaved entity types,
- explicit flush too often,
- cascade ordering,
- versioned data batching setting,
- statement ordering configuration,
- batch size,
- driver/database support.

---

### 17.2 Example: batch insert loop

Bad:

```java
for (Record r : records) {
    em.persist(r);
}
```

If records are huge, persistence context grows.

Better:

```java
int batchSize = 50;
for (int i = 0; i < records.size(); i++) {
    em.persist(records.get(i));

    if (i > 0 && i % batchSize == 0) {
        em.flush();
        em.clear();
    }
}
```

Why:

- `flush()` sends SQL batch,
- `clear()` detaches objects and releases first-level cache memory.

But be careful: after `clear()`, previously managed objects become detached.

---

### 17.3 Explicit flush can hurt batching

Bad:

```java
for (Record r : records) {
    em.persist(r);
    em.flush();
}
```

This executes one flush per row, reducing batching benefit.

Better flush every N rows.

---

## 18. Flush and Transaction Boundaries

### 18.1 Transaction-scoped persistence context

Common pattern:

```java
@Transactional
public void process() {
    // persistence context starts/join transaction
    // mutations happen
    // flush at commit
}
```

At method exit:

```text
flush → commit → close/cleanup persistence context
```

---

### 18.2 Exception during flush

If flush fails:

```java
try {
    em.flush();
} catch (PersistenceException e) {
    // transaction is usually no longer reliable
}
```

After a flush exception, do not continue as if persistence context is clean.

Best practice:

- mark transaction rollback-only,
- exit transaction boundary,
- start new transaction if needed,
- do not keep using same EntityManager for normal work.

---

### 18.3 Partial SQL before rollback

Flush may execute several SQL statements before one fails.

Example:

```text
INSERT parent succeeds
INSERT child succeeds
INSERT audit fails unique constraint
```

The transaction should be rolled back. But inside database transaction, some statements already ran.

This matters for:

- triggers,
- locks,
- sequence consumption,
- temporary tables,
- external side effects if triggered outside DB transaction.

Never do irreversible external side effects inside entity listeners assuming flush always commits.

---

## 19. Flush and Entity Listeners / Auditing

Entity lifecycle callbacks can run around persist/update/remove operations.

Examples:

```java
@PrePersist
void prePersist() {
    createdAt = Instant.now();
}

@PreUpdate
void preUpdate() {
    updatedAt = Instant.now();
}
```

Important:

- callbacks may run during flush,
- dirty checking and callback interaction can be subtle,
- changing relationships in callbacks can be dangerous,
- external calls in callbacks are a serious anti-pattern.

Bad:

```java
@PreUpdate
void notifyExternalSystem() {
    httpClient.post(...); // dangerous
}
```

Why dangerous:

- flush can occur before commit,
- transaction may later rollback,
- callback can run multiple times depending lifecycle,
- callback failure can poison persistence context,
- it mixes DB transaction with external side effect.

Better:

- use domain events collected during transaction,
- publish after commit,
- use outbox pattern for reliable integration.

---

## 20. Flush and Database Triggers / Generated Columns

Flush can invoke database triggers.

Example:

```sql
create trigger audit_case_update
before update on cases
for each row
...
```

When ORM flushes update, trigger runs.

Potential issue:

- ORM snapshot may not know trigger-modified columns,
- generated columns may need refresh,
- audit trigger may rely on session variables not set,
- trigger side effects happen before commit.

If database changes values, consider:

- generated column mapping,
- `@Generated` provider-specific annotation,
- refresh after flush,
- avoid having both ORM and trigger fight over same column.

---

## 21. Flush and Validation

### 21.1 Bean Validation before SQL

JPA integrates with Bean Validation. Validation can happen before insert/update.

```java
@NotNull
private String title;
```

Flush may trigger validation before SQL.

Failure:

```text
ConstraintViolationException
```

This is application-level validation, not database constraint exception.

---

### 21.2 Domain validation vs flush-time validation

Better:

```java
caseEntity.approve(); // enforces domain invariant before state mutation
```

Than relying only on flush-time failure.

Flush-time validation is a safety net, not the only business rule mechanism.

---

### 21.3 Validation query and auto flush trap

```java
caseEntity.setReferenceNo(referenceNo);

boolean duplicate = repository.existsByReferenceNo(referenceNo);
if (duplicate) throw ...
```

The `exists` query may flush first, causing unique constraint violation before your custom duplicate handling.

Better patterns:

- validate before mutation,
- use separate query before setting state,
- catch DB unique violation as final guard,
- design idempotent command flow.

---

## 22. Flush in Spring Data JPA

Spring Data JPA exposes methods such as:

```java
save(entity)
saveAndFlush(entity)
flush()
delete(entity)
```

Important:

- `save()` does not necessarily execute SQL immediately.
- `saveAndFlush()` forces flush after save.
- Managed entity mutation does not require `save()`.
- `delete()` usually schedules removal; SQL at flush.

### 22.1 Managed entity does not need save

```java
@Transactional
public void changeName(Long id, String name) {
    User user = repository.findById(id).orElseThrow();
    user.setName(name);
    // no repository.save(user) required for managed entity
}
```

Flush at commit sends update.

### 22.2 `saveAndFlush` is often overused

Bad habit:

```java
repository.saveAndFlush(entity);
```

Often done because developer wants “make sure saved”. But it can:

- force early SQL,
- break batching,
- expose constraint violation in middle of workflow,
- increase transaction lock time,
- hide weak transaction design.

Use only when explicit synchronization is required.

---

## 23. Advanced Scenario: Approval Workflow Flush Trap

Consider:

```java
@Transactional
public void approve(Long caseId, String approver) {
    CaseEntity c = caseRepository.getReferenceById(caseId);
    c.approve(approver);

    if (appealRepository.existsPendingAppeal(caseId)) {
        throw new IllegalStateException("Cannot approve case with pending appeal");
    }

    auditService.recordApproval(caseId, approver);
}
```

Potential sequence:

```text
getReferenceById returns proxy
c.approve triggers initialization or mutation
existsPendingAppeal query triggers auto flush
  update case status to APPROVED
  insert task maybe
query appeal
if pending appeal exists → exception
transaction rollback
```

Data is rolled back, but the flow has problems:

- validation happens after mutation,
- query causes write flush,
- audit service may create more entities,
- if audit service publishes external event, event may be inconsistent,
- if exception handled internally and transaction still commits, invalid approval may persist.

Better:

```java
@Transactional
public void approve(Long caseId, String approver) {
    if (appealRepository.existsPendingAppeal(caseId)) {
        throw new IllegalStateException("Cannot approve case with pending appeal");
    }

    CaseEntity c = caseRepository.findForUpdateOrVersioned(caseId)
        .orElseThrow();

    c.approve(approver);
    auditLog.recordApproval(c, approver);
}
```

Rules:

- validate external database facts before mutating managed state if query may flush,
- or use explicit flush boundaries intentionally,
- keep external side effects after commit via outbox/event.

---

## 24. Advanced Scenario: Unique Constraint Swap

Entity:

```java
@Entity
class QueueItem {
    @Column(unique = true)
    private int position;
}
```

Code:

```java
QueueItem a = em.find(QueueItem.class, 1L); // position 1
QueueItem b = em.find(QueueItem.class, 2L); // position 2

a.setPosition(2);
b.setPosition(1);
```

Flush may execute:

```sql
update queue_item set position = 2 where id = 1;
-- fails because id=2 still has position=2
```

ORM cannot infer safe semantic swap.

Possible solutions:

1. Use temporary value:

```text
A: 1 → -1
B: 2 → 1
A: -1 → 2
```

2. Use deferrable unique constraint if supported and approved.
3. Use dedicated reorder algorithm.
4. Store ordering in separate relation with business operation.
5. Avoid unique position if gaps/rank values suffice.

Lesson:

> Flush ordering solves dependency ordering, not arbitrary business constraint choreography.

---

## 25. Advanced Scenario: Orphan Removal and Query Surprise

```java
@Transactional
public void removeTask(Long caseId, Long taskId) {
    CaseEntity c = em.find(CaseEntity.class, caseId);
    c.removeTask(taskId);

    long taskCount = em.createQuery("""
        select count(t) from CaseTask t where t.caseEntity.id = :caseId
    """, Long.class)
    .setParameter("caseId", caseId)
    .getSingleResult();
}
```

With AUTO flush, count query may trigger:

```sql
delete from case_task where id = ?;
select count(*) from case_task where case_id = ?;
```

So count sees post-removal DB state.

With COMMIT flush mode, count may see pre-removal database state.

Correct design depends on desired semantics:

- count object collection size if you want in-memory aggregate state:

```java
int count = c.getTasks().size();
```

- flush explicitly if you need database query to see mutation:

```java
em.flush();
long count = queryCount(caseId);
```

- avoid switching between object graph truth and database query truth without explicit boundary.

---

## 26. Common Misconceptions

### Misconception 1 — `save()` means SQL executed

Not necessarily. It may only make entity managed or call merge.

### Misconception 2 — `flush()` commits transaction

False. Flush sends SQL inside transaction. Commit finalizes transaction.

### Misconception 3 — Constraint violation always happens at commit

False. It often happens at flush, including auto flush before query.

### Misconception 4 — Query is always read-only

False. Query execution can trigger auto flush, which performs writes before the read.

### Misconception 5 — SQL order follows Java code order

False. Provider orders SQL based on dependency/action rules.

### Misconception 6 — `readOnly = true` guarantees no writes

False. It is framework/provider/database dependent and should not be used as sole protection.

### Misconception 7 — After bulk update, managed entities are updated

False. Bulk update bypasses persistence context.

### Misconception 8 — Explicit flush is always safer

False. It can make workflow more fragile and reduce performance if used without reason.

---

## 27. Design Rules

### Rule 1 — Treat flush as a synchronization boundary

When code calls `flush()`, it crosses from object world into database world.

Ask:

```text
Do I want database constraints, triggers, locks, generated values, and SQL execution now?
```

If not, avoid explicit flush.

---

### Rule 2 — Validate before mutation when validation query may overlap dirty state

Risky:

```java
entity.mutate();
repository.existsSomething(); // may flush mutation
```

Safer:

```java
validateDatabaseFacts();
entity.mutate();
```

---

### Rule 3 — Do not depend on accidental flush skip

Provider may skip flush for unrelated query spaces, but do not make correctness depend on it.

---

### Rule 4 — Use explicit flush for intentional early failure

Useful when:

- you want DB constraint error now,
- you need generated DB value now,
- native query must read pending changes,
- batch loop must release memory,
- test must assert SQL behavior.

---

### Rule 5 — After flush failure, rollback

Do not continue normal persistence work after flush exception.

---

### Rule 6 — Separate bulk operations from entity graph operations

Bulk update/delete bypass persistence context. Use separate transaction or clear context.

---

### Rule 7 — Avoid external side effects during flush lifecycle

Entity listeners should not call external systems.

Use outbox/after-commit mechanism.

---

### Rule 8 — Choose ID generation with flush/batching in mind

For high-volume insert, prefer sequence/pooled/UUID-style strategies over identity when database/platform allows.

---

### Rule 9 — Keep persistence context bounded in batch jobs

Use:

```java
flush();
clear();
```

at controlled intervals.

---

### Rule 10 — Observe flush cost in production

Slow endpoint may not be slow because of a query. It may be slow because commit triggers huge dirty checking and flush.

---

## 28. Anti-Patterns

### Anti-Pattern 1 — `saveAndFlush()` everywhere

Usually indicates weak mental model.

Better:

- rely on transaction commit flush,
- explicit flush only when needed.

---

### Anti-Pattern 2 — Mutate then validate with overlapping query

```java
entity.changeState();
if (repository.existsConflict(...)) throw ...;
```

Can trigger auto flush before validation.

---

### Anti-Pattern 3 — Entity listener publishes external event

```java
@PostPersist
void publish() { kafka.send(...); }
```

Flush may happen before commit. Transaction may rollback.

Use outbox.

---

### Anti-Pattern 4 — Bulk update mixed with managed entity assumptions

```java
User u = em.find(User.class, id);
bulkDeactivateUsers();
u.isActive(); // stale
```

Clear or isolate.

---

### Anti-Pattern 5 — Batch import without clear

```java
for (...) em.persist(item);
```

Persistence context grows until memory pressure.

---

### Anti-Pattern 6 — Assuming COMMIT flush mode fixes performance globally

It can create stale query semantics and hidden correctness bugs.

---

### Anti-Pattern 7 — Relying on ORM to solve business ordering constraints

Unique swaps, ordering transitions, temporal constraints often need explicit algorithm.

---

## 29. Diagnostic Checklist

When debugging flush-related issue, ask:

### 29.1 What triggered flush?

- commit?
- explicit `flush()`?
- JPQL/HQL query?
- Criteria query?
- native query?
- ID generation?
- lock query?
- framework method like `saveAndFlush()`?

### 29.2 What was dirty?

- entity field?
- collection?
- embeddable?
- relationship owning side?
- orphan removal?
- cascade discovered new object?

### 29.3 What SQL was executed?

Enable SQL logging/statistics in safe environment.

Look for:

- unexpected update,
- unexpected insert,
- collection delete/reinsert,
- version update,
- flush before select.

### 29.4 Was persistence context stale?

Especially after:

- bulk update,
- native SQL,
- trigger update,
- external DB update,
- second-level cache interaction.

### 29.5 Did exception happen at flush or commit?

Stack trace often shows:

- auto flush before query,
- transaction commit flush,
- explicit flush line,
- entity listener callback.

### 29.6 Did flush order violate business expectation?

Check:

- FK dependency,
- unique constraints,
- nullability,
- cascade remove,
- collection mapping.

### 29.7 Is batching working?

Check:

- ID generator,
- batch size,
- SQL grouping,
- flush frequency,
- `order_inserts`, `order_updates` equivalent,
- driver support.

---

## 30. Practical Coding Patterns

### 30.1 Command transaction pattern

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    ensureNoPendingAppeal(command.caseId());

    CaseEntity c = caseRepository.findById(command.caseId())
        .orElseThrow(CaseNotFoundException::new);

    c.approve(command.actorId(), command.reason());

    auditTrail.recordDomainEvent(
        AuditEvent.caseApproved(c.getId(), command.actorId())
    );
}
```

Properties:

- validate database facts before mutation,
- mutate aggregate inside transaction,
- no unnecessary flush,
- audit persisted as entity/outbox, not external call,
- commit flush is sufficient.

---

### 30.2 Intentional early constraint check

```java
@Transactional
public Long createUniqueReference(CreateReferenceCommand command) {
    Reference ref = new Reference(command.value());
    em.persist(ref);

    try {
        em.flush(); // intentionally detect unique violation here
    } catch (PersistenceException e) {
        throw translateUniqueViolation(e);
    }

    return ref.getId();
}
```

Use when you want error translation near command boundary.

But after catching flush exception, usually transaction should be rolled back. In Spring, throw translated runtime exception.

---

### 30.3 Batch import pattern

```java
@Transactional
public void importRows(List<ImportRow> rows) {
    int batchSize = 100;

    for (int i = 0; i < rows.size(); i++) {
        em.persist(toEntity(rows.get(i)));

        if (i > 0 && i % batchSize == 0) {
            em.flush();
            em.clear();
        }
    }
}
```

Need care if later rows depend on earlier managed objects. After `clear()`, objects are detached.

---

### 30.4 Native query requiring latest state

```java
@Transactional
public ReportSummary generateSummary(Long caseId) {
    CaseEntity c = em.find(CaseEntity.class, caseId);
    c.recalculateDerivedFields();

    em.flush(); // native query must see recalculated fields

    Object[] row = (Object[]) em.createNativeQuery("""
        select * from generate_case_summary(:caseId)
    """)
    .setParameter("caseId", caseId)
    .getSingleResult();

    return map(row);
}
```

Here explicit flush is justified.

---

### 30.5 Bulk operation isolation

```java
@Transactional
public int closeExpiredCases(Instant cutoff) {
    int updated = em.createQuery("""
        update CaseEntity c
        set c.status = :closed
        where c.status = :open
          and c.lastActivityAt < :cutoff
    """)
    .setParameter("closed", CLOSED)
    .setParameter("open", OPEN)
    .setParameter("cutoff", cutoff)
    .executeUpdate();

    em.clear();
    return updated;
}
```

Clear because managed state may be stale.

---

## 31. Provider-Specific Notes

### 31.1 Hibernate notes

Important concepts:

- `Session` is Hibernate's provider-level persistence context API.
- `ActionQueue` schedules entity and collection actions.
- Flush events drive dirty checking and SQL execution.
- `FlushMode.MANUAL` can disable automatic flush in Hibernate-specific use.
- `hibernate.order_inserts` and `hibernate.order_updates` can improve batching but may affect SQL ordering expectations.
- `hibernate.jdbc.batch_size` enables batching when other conditions allow.
- IDENTITY generation can limit insert batching.
- Query spaces can influence auto flush behavior.

Important Hibernate debugging tools:

- SQL logging,
- bind parameter logging carefully,
- Hibernate statistics,
- statement inspector,
- flush event listener for advanced diagnostics,
- slow query/logging integration.

---

### 31.2 EclipseLink notes

Important concepts:

- `UnitOfWork` tracks changes.
- Change sets represent modifications.
- Weaving can optimize change tracking.
- Batch writing can group SQL operations.
- Shared cache can interact with committed changes.
- Descriptor configuration influences mapping and SQL behavior.

Important EclipseLink debugging tools:

- logging level configuration,
- SQL logging,
- session/customizer hooks,
- query hints,
- cache coordination diagnostics,
- weaving diagnostics.

---

## 32. Java 8–25 Compatibility Notes

### 32.1 Java 8 legacy stack

Typical stack:

```text
Java 8
javax.persistence 2.1/2.2
Hibernate 5.x or EclipseLink 2.x
Spring Boot 2.x / Java EE / older Jakarta transition stack
```

Flush concepts are the same, but API package is `javax.persistence`.

Common issues:

- older Hibernate flush behavior/dialect differences,
- older bytecode enhancement setup,
- older transaction integration,
- less modern Java time mapping support depending provider/version.

---

### 32.2 Java 11/17/21 modern stack

Typical stack:

```text
Java 11/17/21
jakarta.persistence 3.x
Hibernate 6.x/7.x or EclipseLink 4.x
Spring Boot 3.x / Jakarta EE 10/11 aligned stack
```

Package changes:

```java
import jakarta.persistence.EntityManager;
import jakarta.persistence.FlushModeType;
```

instead of:

```java
import javax.persistence.EntityManager;
import javax.persistence.FlushModeType;
```

Flush concept remains, provider internals evolve.

---

### 32.3 Java 25 and forward line

Java 25 as modern LTS runtime does not fundamentally change JPA flush semantics. But it affects ecosystem constraints:

- provider version compatibility,
- bytecode enhancement compatibility,
- build plugin compatibility,
- app server support,
- testing runtime support,
- observability agents.

When using newest Java, verify:

- Hibernate/EclipseLink version supports runtime,
- enhancer/weaver works,
- framework stack supports Java 25,
- instrumentation agent supports bytecode version,
- CI/CD uses same JDK line.

---

## 33. Failure Modes and Root Cause Mapping

| Symptom | Likely Flush-Related Root Cause | Fix Direction |
|---|---|---|
| `SELECT` causes `UPDATE` before it | AUTO flush before query | Reorder validation/mutation, use explicit boundary, tune flush mode carefully |
| Constraint violation appears on query line | Query triggered flush | Inspect pending dirty state before query |
| Slow commit | Large persistence context dirty checking/flush | Reduce context size, batch flush/clear, optimize mappings |
| Missing update | Entity detached or flush mode manual/no transaction | Ensure managed state and transaction boundary |
| Unexpected delete | Cascade remove/orphan removal processed at flush | Review ownership and cascade config |
| Duplicate join rows | Wrong collection mapping/equals/hashCode/owning side | Fix association invariants |
| Batch insert not batching | IDENTITY, frequent flush, interleaved SQL | Use sequence/pooled, batch size, ordered inserts |
| Stale entity after bulk update | Bulk bypassed persistence context | `clear()` or isolate transaction |
| Optimistic lock exception before commit | Auto/explicit flush ran update | Handle at service boundary, retry if safe |
| Deadlock | Flush SQL order and lock acquisition conflict | Standardize lock order, reduce transaction scope |

---

## 34. Deep Mental Model: Flush as Consistency Negotiation

Flush is where four worlds meet:

```text
Java object graph
JPA provider internal model
SQL relational database
Transaction isolation/constraints
```

Each world has different rules.

### Java object graph

- references,
- identity,
- mutation,
- collection behavior,
- equals/hashCode,
- lifecycle methods.

### Provider internal model

- persistence context,
- snapshots,
- action queue/change sets,
- dirty checking,
- cascades,
- collection wrappers,
- flush modes.

### SQL database

- FK constraints,
- unique constraints,
- nullability,
- indexes,
- triggers,
- generated columns,
- row locks.

### Transaction system

- commit/rollback,
- isolation level,
- lock wait,
- deadlock,
- rollback-only state,
- JTA/Spring transaction behavior.

Flush is the negotiation point where provider says:

> “Given this object graph and these mappings, I will produce this ordered set of SQL statements inside this transaction.”

A top-level engineer asks:

- Is this SQL shape expected?
- Is this flush point expected?
- Are constraints checked at the right time?
- Is lock duration acceptable?
- Is batching preserved?
- Is persistence context clean after failure?
- Is query result reading object truth or database truth?

---

## 35. Practice Scenarios

### Scenario 1 — Query triggers flush

You have:

```java
@Transactional
public void updateAndCheck(Long id) {
    User u = em.find(User.class, id);
    u.setEmail("duplicate@example.com");

    boolean exists = userRepository.existsByUsername(u.getUsername());
}
```

Question:

- Why can unique email constraint violation happen during `existsByUsername`?
- How would you redesign flow?

Expected reasoning:

- `existsByUsername` query may trigger AUTO flush.
- Dirty email update is flushed before query.
- Unique constraint fails.
- Validate before mutation or isolate checks.

---

### Scenario 2 — Bulk update stale state

```java
@Transactional
public void closeAll() {
    CaseEntity c = em.find(CaseEntity.class, 1L);

    em.createQuery("update CaseEntity c set c.status = CLOSED")
      .executeUpdate();

    System.out.println(c.getStatus());
}
```

Question:

- Why can printed status be old?
- What should happen after bulk update?

Expected reasoning:

- Bulk update bypasses persistence context.
- Managed entity remains stale.
- Use `em.clear()` or avoid mixing.

---

### Scenario 3 — Batch import memory bloat

```java
@Transactional
public void importAll(List<Row> rows) {
    for (Row row : rows) {
        em.persist(map(row));
    }
}
```

Question:

- Why can memory grow?
- Why is flush alone insufficient?

Expected reasoning:

- Persistence context retains managed entities.
- Flush sends SQL but entities remain managed.
- Need `flush()` and `clear()` periodically.

---

### Scenario 4 — Delete parent before child?

```java
em.remove(parent);
```

Question:

- Why does provider often delete children first?
- When can this still fail?

Expected reasoning:

- FK constraints require child delete/update before parent delete.
- Fails if cascade/orphan config wrong, DB restricts, shared child exists, join table not cleaned, soft delete logic conflicts.

---

### Scenario 5 — `saveAndFlush` overuse

A codebase calls `saveAndFlush` in every repository operation.

Question:

- Why is this suspicious?
- What risks does it create?

Expected reasoning:

- It forces SQL early without need.
- Breaks batching.
- Increases lock duration.
- Makes transaction flow harder.
- Indicates misunderstanding of managed entity and commit flush.

---

## 36. Summary

Flush is the mechanism that converts managed object state changes into SQL operations inside an active transaction.

Key points:

1. Flush is not commit.
2. Flush can happen explicitly, at commit, or before queries.
3. Query execution can cause writes through AUTO flush.
4. Provider orders SQL based on mapping dependencies, not Java code order.
5. Constraint violations often happen at flush.
6. ID generation strategy affects flush timing and batching.
7. Bulk operations bypass persistence context and can make managed objects stale.
8. Flush failure usually means transaction should be rolled back.
9. Explicit flush is powerful but should be intentional.
10. Top engineers reason about flush as a synchronization boundary between object graph and relational database.

The practical mental model:

```text
Mutation does not mean SQL now.
Dirty checking detects what changed.
Flush decides when object state becomes SQL.
Commit decides whether SQL becomes durable.
```

If you master flush semantics, many “ORM mysteries” become predictable engineering consequences.

---

## 37. What Comes Next

Next part:

```text
07-sql-generation-pipeline-dialect-behavior.md
```

The next topic continues naturally from flush:

> Once flush decides SQL must be executed, how does provider generate SQL, choose dialect behavior, handle pagination/locking/LOB/timestamp/identifier differences, and why can the same JPQL produce different SQL across databases and provider versions?


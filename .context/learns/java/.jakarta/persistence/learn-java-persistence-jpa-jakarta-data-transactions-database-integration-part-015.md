# Part 015 — Flush, Dirty Checking, Write-Behind, and SQL Generation

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-015.md`  
> Scope: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, Spring Data JPA, Jakarta EE/Spring transaction integration.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu seharusnya tidak lagi melihat JPA/Hibernate sebagai “saya ubah object lalu otomatis update database”. Mental model itu terlalu dangkal dan berbahaya.

Target utama bagian ini:

1. Memahami **flush** sebagai proses sinkronisasi state persistence context ke database, bukan commit transaction.
2. Memahami **dirty checking** sebagai mekanisme deteksi perubahan pada managed entity.
3. Memahami **write-behind** sebagai strategi ORM menunda SQL sampai waktu tertentu.
4. Bisa menjelaskan kenapa SQL bisa muncul sebelum commit.
5. Bisa menjelaskan kenapa constraint violation bisa muncul pada query, bukan hanya pada commit.
6. Bisa membedakan:
   - managed entity change,
   - explicit repository save,
   - flush,
   - commit,
   - rollback,
   - clear,
   - detach,
   - refresh.
7. Bisa mendesain use case update agar tidak bergantung pada perilaku implisit yang sulit diaudit.
8. Bisa menghindari bug umum seperti:
   - accidental update,
   - stale persistence context after bulk update,
   - flush-before-query surprise,
   - memory bloat pada batch job,
   - wrong ordering insert/update/delete,
   - unexpected SQL generation.
9. Bisa membaca dan men-debug SQL yang dihasilkan ORM secara sistematis.
10. Bisa memilih kapan JPA managed state cocok, dan kapan harus memakai JPQL bulk/native SQL/JDBC.

---

## 2. Mental Model Besar

### 2.1 Persistence Context Adalah Workspace Transaksional

Ketika entity berada dalam state **managed**, entity tersebut bukan object Java biasa lagi dari sudut pandang ORM. Ia berada di dalam workspace bernama **persistence context**.

Persistence context menyimpan beberapa hal:

1. Entity instance yang sedang managed.
2. Identity map: satu database row identity direpresentasikan oleh satu object instance dalam context yang sama.
3. Snapshot state awal untuk dirty checking.
4. Queue operasi insert/update/delete.
5. Informasi association, collection, proxy, dan lazy loading.
6. Informasi version/lock bila relevan.

Secara konseptual:

```text
Database row
    ↓ load
Managed entity in persistence context
    ↓ mutate fields
Dirty entity detected
    ↓ flush
SQL INSERT/UPDATE/DELETE sent to database
    ↓ commit
Transaction becomes durable
```

Hal penting: **mutasi entity tidak langsung berarti SQL dikirim saat itu juga**.

---

### 2.2 Flush Bukan Commit

Flush adalah:

```text
synchronize in-memory persistence context state → database transaction
```

Commit adalah:

```text
make database transaction permanent/durable
```

Maka urutannya bisa begini:

```text
begin transaction
load entity
change entity field
flush
    -> SQL UPDATE dikirim ke DB
    -> row mungkin sudah terkunci/terubah dalam transaction saat ini
rollback
    -> perubahan dibatalkan
```

Jadi setelah flush, perubahan **belum tentu committed**.

Flush hanya membuat database mengetahui perubahan dalam transaction aktif. Transaction lain biasanya belum bisa melihat perubahan tersebut, tergantung isolation level dan database behavior.

---

### 2.3 Dirty Checking Bukan Magic, Tapi Konsekuensi Managed State

Pada managed entity:

```java
Application app = entityManager.find(Application.class, id);
app.setStatus(ApplicationStatus.SUBMITTED);
```

Kamu tidak selalu perlu memanggil:

```java
entityManager.merge(app);
entityManager.persist(app);
repository.save(app);
```

Karena `app` sudah managed. Pada flush, provider membandingkan state saat ini dengan snapshot sebelumnya. Jika berbeda, SQL update akan dihasilkan.

Mental model:

```text
Managed entity = tracked object
Detached entity = untracked object
Transient entity = unknown object
Removed entity = scheduled for delete
```

Dirty checking hanya berlaku untuk managed entity.

---

### 2.4 Write-Behind: ORM Menunda SQL

JPA/Hibernate sering tidak langsung mengirim SQL ketika `persist()`, `remove()`, atau field entity diubah.

ORM dapat menunda SQL untuk:

1. Mengurutkan operasi.
2. Menggabungkan perubahan.
3. Melakukan batching.
4. Menghindari update yang tidak perlu.
5. Memastikan referential integrity ordering.
6. Mengurangi roundtrip.

Contoh:

```java
Order order = new Order();
order.setCustomer(customer);

entityManager.persist(order);

// Belum tentu INSERT langsung dikirim sekarang.
// SQL dapat ditunda sampai flush/commit/query tertentu.
```

Tetapi ada pengecualian penting. Misalnya `GenerationType.IDENTITY` pada banyak database sering membutuhkan insert segera untuk memperoleh generated id. Ini memengaruhi batching dan timing SQL.

---

## 3. Lifecycle Revisited: Kenapa Flush Terkait Entity State

Kita sudah membahas lifecycle pada Part 004, tetapi di sini kita lihat dari sisi flush.

### 3.1 Transient Entity

```java
Application app = new Application();
app.setReferenceNo("APP-001");
```

State:

```text
Java object exists
Persistence context does not know it
No insert scheduled
Dirty checking does not apply
```

Jika transaction commit tanpa `persist()` atau cascade persist, tidak ada SQL.

---

### 3.2 Managed Entity

```java
Application app = entityManager.find(Application.class, id);
app.setStatus(ApplicationStatus.SUBMITTED);
```

State:

```text
Entity tracked by persistence context
Snapshot exists
Dirty checking applies
Update may be generated on flush
```

---

### 3.3 Detached Entity

```java
Application app = entityManager.find(Application.class, id);
entityManager.detach(app);
app.setStatus(ApplicationStatus.SUBMITTED);
```

State:

```text
Entity no longer tracked
Dirty checking does not apply
No automatic update
```

A detached entity must be reattached or merged if changes are intended to be persisted.

---

### 3.4 Removed Entity

```java
Application app = entityManager.find(Application.class, id);
entityManager.remove(app);
```

State:

```text
Entity scheduled for deletion
DELETE generated on flush
```

Delete may fail at flush due to foreign key constraints.

---

## 4. What Exactly Happens During Flush?

Flush is not a single “write everything” operation. Secara konseptual, provider melakukan beberapa tahap.

### 4.1 Detect Dirty Entities

Provider memeriksa managed entities:

```text
current state vs loaded snapshot
```

Jika berbeda, entity dianggap dirty.

Contoh:

```java
Application app = em.find(Application.class, id);
app.setRemarks("new remarks");
```

Jika `remarks` berubah dari snapshot, update dapat dihasilkan.

---

### 4.2 Detect Dirty Collections

Collection association juga bisa dirty.

```java
application.getDocuments().add(document);
```

Provider perlu menentukan apakah ini menyebabkan:

1. insert row baru pada child table,
2. update foreign key,
3. insert join table row,
4. delete orphan,
5. reorder index column,
6. update collection table.

Collection dirty checking sering lebih mahal daripada scalar field dirty checking.

---

### 4.3 Compute Action Queue

Provider menyusun operasi:

```text
EntityInsertAction
EntityUpdateAction
EntityDeleteAction
CollectionUpdateAction
CollectionRemoveAction
CollectionRecreateAction
```

Nama internal bisa berbeda antar provider/versi, tapi mental model-nya sama: operasi persistence dikumpulkan dalam queue.

---

### 4.4 Order SQL Statements

ORM perlu mengirim SQL dalam urutan yang tidak melanggar constraint.

Contoh parent-child:

```text
INSERT parent
INSERT child with parent_id
```

Delete biasanya kebalikannya:

```text
DELETE child
DELETE parent
```

Jika relationship/cascade/orphan removal tidak didesain benar, flush bisa menghasilkan constraint violation.

---

### 4.5 Execute SQL

Provider mengirim SQL ke database melalui JDBC connection dalam transaction aktif.

Contoh generated SQL:

```sql
update application
set status = ?, updated_at = ?, version = ?
where id = ? and version = ?
```

Untuk optimistic locking, affected row count diperiksa. Jika `0`, provider dapat melempar optimistic lock exception.

---

### 4.6 Synchronize Version and Generated Values

Setelah SQL dieksekusi, provider bisa memperbarui state di memory:

1. generated id,
2. generated version,
3. generated timestamp,
4. database-generated column jika dikonfigurasi.

---

## 5. Flush Trigger: Kapan Flush Terjadi?

Flush dapat terjadi pada beberapa waktu.

### 5.1 Explicit Flush

```java
entityManager.flush();
```

Ini memaksa sinkronisasi saat itu juga.

Gunakan ketika kamu benar-benar butuh:

1. constraint violation muncul lebih awal,
2. generated value tersedia lebih awal,
3. database trigger/procedure side-effect perlu terlihat dalam transaction yang sama,
4. chunk batch processing,
5. mengontrol timing lock/SQL.

Jangan gunakan `flush()` sebagai “ritual save”. Banyak kode memanggil `saveAndFlush()` tanpa alasan, lalu performa dan lock duration memburuk.

---

### 5.2 Flush at Transaction Commit

Umumnya, sebelum commit, provider akan flush perubahan.

```java
@Transactional
public void submit(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.submit();
} // flush before commit
```

SQL update bisa muncul saat method selesai, bukan saat `app.submit()` dipanggil.

---

### 5.3 Flush Before Query

Ini salah satu sumber surprise terbesar.

Dalam flush mode default `AUTO`, provider harus memastikan perubahan yang mungkin memengaruhi hasil query terlihat oleh query.

Contoh:

```java
@Transactional
public void createAndCount() {
    Application app = new Application("APP-001");
    entityManager.persist(app);

    Long count = entityManager.createQuery(
        "select count(a) from Application a", Long.class
    ).getSingleResult();
}
```

Agar count benar, provider bisa flush insert sebelum menjalankan query.

Jadi constraint violation bisa muncul saat `getSingleResult()`, bukan saat commit.

---

### 5.4 Flush Before Native Query

Native query behavior bisa lebih kompleks karena provider tidak selalu tahu table mana yang disentuh oleh SQL native.

Contoh:

```java
em.persist(app);

List<?> rows = em.createNativeQuery("select * from application").getResultList();
```

Provider mungkin flush agar native query melihat perubahan. Hibernate memiliki detail behavior tertentu tergantung API dan synchronization metadata.

---

### 5.5 Flush on Batch Chunk

Pada batch job:

```java
for (int i = 0; i < rows.size(); i++) {
    em.persist(toEntity(rows.get(i)));

    if (i % 100 == 0) {
        em.flush();
        em.clear();
    }
}
```

Flush mengirim SQL. Clear melepas managed entity agar memory tidak membesar.

---

## 6. Flush Mode

### 6.1 `FlushModeType.AUTO`

Default JPA flush mode.

Maknanya:

```text
Provider boleh flush sebelum query jika perubahan dalam persistence context dapat memengaruhi hasil query.
Provider flush sebelum transaction commit.
```

Ini mode paling aman secara correctness karena query dalam transaction melihat perubahan yang sudah dibuat dalam persistence context.

Trade-off:

1. Query read bisa memicu write SQL.
2. Constraint violation bisa muncul lebih awal.
3. Lock bisa diperoleh lebih awal.
4. Debugging kadang mengejutkan.

---

### 6.2 `FlushModeType.COMMIT`

```java
entityManager.setFlushMode(FlushModeType.COMMIT);
```

Maknanya secara konseptual:

```text
Flush terutama dilakukan saat commit.
Query tidak selalu memaksa flush.
```

Gunakan hati-hati. Query yang dijalankan setelah perubahan in-memory bisa tidak mencerminkan perubahan tersebut.

Contoh risiko:

```java
app.setStatus(SUBMITTED);

boolean exists = repository.existsSubmittedByUser(userId);
```

Jika flush tidak terjadi sebelum query, query mungkin membaca database lama, bukan state baru dalam persistence context.

---

### 6.3 Provider-Specific Flush Mode

Hibernate memiliki flush mode tambahan di luar standard JPA, seperti `MANUAL` pada konteks tertentu.

Gunakan hanya bila kamu benar-benar mengontrol konsekuensinya, misalnya read-only workload atau batch tertentu.

Dalam aplikasi bisnis biasa, provider-specific manual flush dapat menimbulkan bug correctness bila developer lain menganggap query akan melihat perubahan.

---

## 7. Dirty Checking Deep Dive

### 7.1 Snapshot-Based Dirty Checking

Saat entity diload:

```text
Database row -> entity object
Provider stores loaded state snapshot
```

Ketika flush:

```text
Compare current entity fields with snapshot
If different -> SQL update
```

Contoh:

```java
Application app = em.find(Application.class, id);
// snapshot: status=DRAFT, remarks=null

app.setStatus(SUBMITTED);
// current: status=SUBMITTED, remarks=null

// flush -> status changed -> update
```

---

### 7.2 Enhanced Dirty Tracking

Hibernate dapat menggunakan bytecode enhancement untuk dirty tracking yang lebih efisien.

Alih-alih membandingkan semua field saat flush, enhanced entity dapat menandai field mana yang berubah ketika setter/field access terjadi.

Manfaat:

1. Mengurangi cost flush pada persistence context besar.
2. Membantu partial update/dynamic behavior tertentu.
3. Mendukung lazy attribute loading pada skenario tertentu.

Trade-off:

1. Butuh build-time/runtime enhancement setup.
2. Debugging lebih teknis.
3. Tidak boleh dipahami sebagai pengganti desain persistence context yang kecil.

---

### 7.3 Dirty Checking and Mutable Types

Mutable type bisa berbahaya.

Contoh:

```java
app.getTags().add("urgent");
```

atau:

```java
app.getMetadata().put("risk", "high");
```

Jika field adalah mutable object, provider harus tahu bagaimana mendeteksi perubahan. Untuk basic mutable custom type, converter, JSON, array, atau custom Hibernate type, dirty checking bisa bergantung pada:

1. equality implementation,
2. mutability plan,
3. deep copy support,
4. provider-specific type mapping.

Desain aman:

1. gunakan immutable value object bila bisa,
2. replace object daripada mutate internal map/list sembarangan,
3. test dirty checking untuk custom type,
4. jangan anggap semua nested mutation otomatis terdeteksi.

---

### 7.4 Accidental Dirty Checking

Bug umum:

```java
@Transactional
public ApplicationDetail getDetail(Long id) {
    Application app = repository.findById(id).orElseThrow();

    app.setLastViewedAt(Instant.now()); // maybe intended? maybe accidental?

    return mapper.toDetail(app);
}
```

Karena method transaction aktif dan entity managed, perubahan `lastViewedAt` akan diflush.

Lebih buruk:

```java
@Transactional
public ApplicationDetail getDetail(Long id) {
    Application app = repository.findById(id).orElseThrow();
    normalizeForDisplay(app); // accidentally mutates entity
    return mapper.toDetail(app);
}
```

Jika `normalizeForDisplay()` mengubah field entity untuk kebutuhan UI, database bisa ikut berubah.

Prinsip:

```text
Jangan mutasi managed entity untuk kebutuhan presentasi.
Gunakan DTO/projection/copy.
```

---

## 8. Write-Behind and SQL Ordering

### 8.1 Why Write-Behind Exists

Tanpa write-behind:

```java
app.setStatus(SUBMITTED); // update immediately?
app.setSubmittedAt(now);  // update again?
app.setUpdatedBy(user);   // update again?
```

Ini buruk. Dengan write-behind, tiga perubahan bisa menjadi satu SQL update pada flush.

```sql
update application
set status=?, submitted_at=?, updated_by=?, version=?
where id=? and version=?
```

---

### 8.2 Insert Ordering

Contoh:

```java
Application app = new Application();
Document doc = new Document();
app.addDocument(doc);

em.persist(app);
```

Jika cascade persist benar, flush dapat menghasilkan:

```sql
insert into application (...)
values (...)

insert into document (..., application_id)
values (..., ?)
```

Jika id parent belum tersedia karena identity generation, insert parent bisa perlu dieksekusi lebih awal.

---

### 8.3 Update Ordering

Update ordering bisa penting untuk deadlock prevention.

Jika banyak transaction mengupdate entity dalam urutan berbeda, deadlock bisa muncul.

Contoh buruk:

```text
Transaction A updates Application 1 then Application 2
Transaction B updates Application 2 then Application 1
```

ORM ordering tertentu bisa membantu, tetapi jangan bergantung buta. Untuk high contention, desain explicit ordering di application/query level.

---

### 8.4 Delete Ordering

Delete parent-child:

```text
child references parent
```

Maka delete parent lebih dulu akan gagal:

```sql
delete from application where id=?
-- FK violation if document still exists
```

ORM perlu delete child dulu, atau database cascade harus dikonfigurasi.

Desain harus jelas:

1. apakah child lifecycle dimiliki parent?
2. pakai orphan removal?
3. pakai DB `ON DELETE CASCADE`?
4. audit/history perlu dipertahankan?
5. soft delete lebih cocok?

---

## 9. SQL Generation: Dari Entity Change ke SQL

### 9.1 Update All Columns vs Dynamic Update

Banyak provider secara default menghasilkan update untuk sekumpulan column yang dianggap relevan. Hibernate dapat dikonfigurasi dengan `@DynamicUpdate` untuk hanya update changed columns.

Default style:

```sql
update application
set reference_no=?, status=?, remarks=?, updated_at=?, version=?
where id=? and version=?
```

Dynamic update style:

```sql
update application
set remarks=?, version=?
where id=? and version=?
```

Trade-off `@DynamicUpdate`:

Keuntungan:

1. Mengurangi column write.
2. Berguna untuk wide table.
3. Mengurangi trigger/logical replication noise pada beberapa database.

Kerugian:

1. SQL shape menjadi lebih banyak variasinya.
2. Statement cache/query plan cache bisa kurang optimal.
3. Tidak menggantikan desain table yang terlalu lebar.
4. Bisa menyembunyikan fakta aggregate terlalu besar.

Gunakan secara selektif, bukan default global.

---

### 9.2 Insert SQL and Null Columns

Insert behavior dipengaruhi oleh:

1. nullable column,
2. database default,
3. generated column,
4. dynamic insert/provider-specific setting,
5. id generation strategy.

Jika Java mengirim `NULL`, database default mungkin tidak dipakai.

Contoh:

```sql
insert into application (status, created_at)
values (null, ?)
```

Berbeda dengan:

```sql
insert into application (created_at)
values (?)
```

Jika ingin database default bekerja, pastikan ORM tidak mengirim column tersebut, atau mapping-nya memang read-only/generated sesuai kebutuhan.

---

### 9.3 Versioned Update SQL

Dengan optimistic locking:

```sql
update application
set status=?, version=?
where id=? and version=?
```

Jika row count `0`, artinya:

1. row tidak ada, atau
2. version sudah berubah, atau
3. condition tidak terpenuhi.

Provider kemudian dapat melempar optimistic lock exception.

Ini sebabnya version column bukan sekadar metadata. Ia bagian dari concurrency contract.

---

### 9.4 Association SQL

Untuk `@ManyToOne`:

```java
app.setAssignedOfficer(officer);
```

SQL biasanya:

```sql
update application
set assigned_officer_id=?
where id=?
```

Untuk join table:

```java
user.getRoles().add(role);
```

SQL bisa:

```sql
insert into user_role (user_id, role_id) values (?, ?)
```

Untuk collection reorder:

```java
application.getSteps().add(0, newStep);
```

Jika memakai ordered list dengan order column, ini bisa menghasilkan banyak update index.

---

## 10. Flush vs Save vs SaveAndFlush

### 10.1 JPA `persist()`

```java
em.persist(entity);
```

Makna:

```text
Make transient entity managed and schedule insert.
```

Tidak selalu langsung insert.

---

### 10.2 JPA `merge()`

```java
Entity managedCopy = em.merge(detachedEntity);
```

Makna:

```text
Copy detached state into a managed instance.
Return managed instance.
Detached instance remains detached.
```

`merge()` bukan “update this object”. Ini copy operation.

Bahaya:

1. Bisa menimpa field dengan null dari request body.
2. Bisa cascade merge graph terlalu besar.
3. Bisa menghidupkan accidental update.
4. Bisa sulit diaudit.

---

### 10.3 Spring Data `save()`

Dalam Spring Data JPA, `save()` biasanya memilih antara `persist()` atau `merge()` berdasarkan apakah entity dianggap baru.

Untuk managed entity, sering kali `save()` tidak perlu.

Contoh redundant:

```java
@Transactional
public void submit(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.submit();
    repository.save(app); // usually unnecessary if app is managed
}
```

Lebih bersih:

```java
@Transactional
public void submit(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.submit();
}
```

Namun, tim harus punya convention jelas agar tidak membingungkan junior developer. Kadang explicit `save()` dipakai untuk readability, tetapi jangan salah memahami mekanismenya.

---

### 10.4 Spring Data `saveAndFlush()`

`saveAndFlush()` memaksa flush setelah save.

Gunakan hanya jika butuh timing SQL saat itu.

Contoh valid:

```java
Application app = repository.saveAndFlush(newApp);
// Need constraint violation now before doing next DB-dependent operation
```

Contoh buruk:

```java
repository.saveAndFlush(app); // called everywhere for no reason
```

Dampak buruk:

1. Mengurangi batching.
2. Memperpanjang lock duration lebih awal.
3. Memunculkan constraint exception di tengah use case.
4. Membuat transaction lebih chatty.
5. Menyulitkan reasoning ordering.

---

## 11. Bulk Update/Delete and Stale Persistence Context

Bulk JPQL/native update berbeda dari managed entity dirty checking.

### 11.1 Bulk Update Bypass Persistence Context

Contoh:

```java
Application app = em.find(Application.class, id);

em.createQuery("""
    update Application a
    set a.status = :status
    where a.id = :id
""")
.setParameter("status", ApplicationStatus.CLOSED)
.setParameter("id", id)
.executeUpdate();

System.out.println(app.getStatus());
```

`app.getStatus()` bisa masih status lama karena entity managed di persistence context tidak otomatis disinkronkan dengan bulk update.

---

### 11.2 Clear After Bulk Update

Biasanya setelah bulk update/delete:

```java
em.flush();
em.clear();
```

atau gunakan transaction terpisah untuk bulk operation.

Spring Data JPA menyediakan opsi seperti `clearAutomatically` pada modifying query, tetapi tetap harus dipahami konsekuensinya.

---

### 11.3 Bulk Update and Versioning

Bulk update bisa bypass optimistic locking/version increment kecuali query secara eksplisit mengupdate version.

Buruk:

```java
update Application a
set a.status = CLOSED
where a.status = EXPIRED
```

Lebih aman untuk versioned entity bila memang perlu:

```java
update Application a
set a.status = CLOSED,
    a.version = a.version + 1
where a.status = EXPIRED
```

Tetapi behavior tergantung provider/database/type. Untuk critical state transition, conditional update dengan expected state/version lebih aman.

---

## 12. Constraint Violation Timing

Constraint violation dapat muncul pada:

1. explicit flush,
2. query yang memicu flush,
3. transaction commit,
4. database trigger/procedure execution,
5. batch execution boundary.

Contoh:

```java
@Transactional
public void createDuplicate() {
    em.persist(new Application("APP-001"));
    em.persist(new Application("APP-001"));

    // This query may trigger flush.
    repository.count();
}
```

Unique constraint violation bisa muncul di `count()`, bukan di akhir method.

Implikasi:

1. Jangan assume error hanya muncul saat `save()`.
2. Exception handling harus meliputi seluruh transaction boundary.
3. Untuk user-friendly validation, database constraint tetap perlu diterjemahkan.
4. Jangan letakkan side effect irreversible sebelum database constraint utama sudah aman.

---

## 13. Flush and Transaction Rollback

Jika flush sukses lalu terjadi rollback:

```text
SQL executed
DB transaction rolled back
No durable change
```

Contoh:

```java
@Transactional
public void submit(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.submit();

    em.flush(); // update sent

    callExternalSystem(); // throws
} // rollback
```

Database update dibatalkan, tetapi external call mungkin sudah terjadi jika dipanggil sebelum exception.

Inilah alasan external side effect tidak boleh sembarangan berada di dalam transaction tanpa outbox/compensation design.

---

## 14. Flush, Locking, and Concurrency

### 14.1 Flush Acquires Locks Earlier

Ketika update SQL dikirim, database dapat mengambil row lock.

```java
app.setStatus(PROCESSING);
em.flush();

// Long computation here
```

Jika computation lama, lock ditahan lebih lama sampai commit/rollback.

Buruk:

```java
@Transactional
public void process(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.markProcessing();
    em.flush();

    slowExternalCall();

    app.markDone();
}
```

Lebih baik:

1. split transaction,
2. use outbox/job status carefully,
3. avoid holding DB lock across remote call,
4. model state transition idempotently.

---

### 14.2 Optimistic Lock Checked at Flush

Optimistic lock conflict sering terdeteksi pada flush, bukan saat field diubah.

```java
app.approve();

// no exception yet

em.flush();
// OptimisticLockException may happen here
```

Jadi conflict handling harus di transaction boundary.

---

### 14.3 Deadlock Can Happen at Flush

Deadlock terjadi saat SQL dieksekusi. Jika SQL ditunda sampai flush/commit, deadlock juga mungkin muncul di sana.

Gejala:

1. method tampak sukses sampai akhir,
2. commit melempar exception,
3. stack trace menunjuk transaction commit, bukan business line.

Observability harus menangkap:

1. use case name,
2. entity ids,
3. generated SQL,
4. database deadlock report,
5. transaction correlation id.

---

## 15. Flush and Read-Only Use Cases

### 15.1 Problem: Read Method Mutates Entity

```java
@Transactional(readOnly = true)
public ApplicationDetail detail(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.calculateDisplayStatus(); // mutates field accidentally
    return mapper.toDto(app);
}
```

`readOnly=true` bukan lisensi untuk mutasi aman. Behavior tergantung framework/provider. Spring dapat mengoptimasi flush mode atau hint, tetapi jangan jadikan itu correctness boundary.

Prinsip:

```text
Read use case should not mutate managed entities.
```

Jika perlu computed value, gunakan:

1. DTO field,
2. projection,
3. pure method tanpa state mutation,
4. database expression,
5. read model.

---

### 15.2 Immutable Entity / Read-Only Entity

Untuk reference data atau view:

1. entity dapat dibuat immutable/provider-specific,
2. session/query bisa diberi read-only hint,
3. projection sering lebih sederhana.

Tetapi jangan overuse. Banyak “read-only entity” berubah menjadi kebutuhan update di kemudian hari.

---

## 16. Flush and Batch Processing

### 16.1 Naive Batch Problem

```java
@Transactional
public void importRows(List<Row> rows) {
    for (Row row : rows) {
        em.persist(toEntity(row));
    }
}
```

Jika `rows` berjumlah 500.000:

1. persistence context menyimpan semua entity,
2. snapshot/collection metadata membesar,
3. heap naik,
4. flush di akhir sangat berat,
5. transaction terlalu panjang,
6. lock/undo/redo membesar,
7. rollback mahal.

---

### 16.2 Flush/Clear Loop

```java
@Transactional
public void importRows(List<Row> rows) {
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

Ini mengontrol memory persistence context.

Namun satu transaction besar tetap bisa bermasalah. Untuk produksi, lebih baik chunk transaction:

```text
Chunk 1: 1000 rows -> commit
Chunk 2: 1000 rows -> commit
Chunk 3: 1000 rows -> commit
```

Dengan idempotency dan restartability.

---

### 16.3 JDBC Batching

Hibernate dapat mengirim JDBC batch untuk insert/update jika dikonfigurasi.

Tetapi batching dipengaruhi oleh:

1. id generation strategy,
2. SQL shape,
3. flush frequency,
4. ordering insert/update,
5. driver support,
6. database constraints/triggers,
7. versioned updates config.

`GenerationType.IDENTITY` sering menghambat insert batching karena id harus diperoleh setelah insert.

Sequence/pooled optimizer biasanya lebih batch-friendly.

---

## 17. Flush and Generated Values

Generated value bisa berasal dari:

1. database identity,
2. database sequence,
3. table generator,
4. UUID generated by app/provider,
5. database default,
6. trigger,
7. computed/generated column.

### 17.1 IDENTITY Timing

Dengan identity column:

```java
em.persist(app);
Long id = app.getId();
```

Provider mungkin perlu insert lebih awal untuk mendapatkan id.

Implikasi:

1. insert timing berubah,
2. batching bisa terganggu,
3. constraint violation bisa muncul lebih cepat,
4. generated id tersedia setelah insert.

---

### 17.2 SEQUENCE Timing

Dengan sequence:

```text
select nextval / sequence call
entity id known before insert
insert can be delayed/batched
```

Untuk Oracle/PostgreSQL, sequence strategy sering lebih cocok untuk high-throughput insert.

---

### 17.3 Database Trigger Generated Column

Jika database trigger mengisi column:

```text
insert row
trigger sets audit_no
```

Entity di memory tidak otomatis tahu nilai tersebut kecuali mapping/provider dikonfigurasi untuk refresh/generated column.

Kadang perlu:

```java
em.flush();
em.refresh(entity);
```

Tetapi ini mahal. Untuk hot path, desain id/generator yang bisa diketahui application sering lebih baik.

---

## 18. Flush and Entity Callbacks

Entity callback:

```java
@PrePersist
void prePersist() {}

@PreUpdate
void preUpdate() {}
```

Callback sering dijalankan saat flush karena saat itulah insert/update benar-benar diproses.

Contoh audit timestamp:

```java
@PreUpdate
void onUpdate() {
    this.updatedAt = Instant.now();
}
```

Catatan:

1. Callback sebaiknya ringan.
2. Jangan panggil repository/entity manager dari callback secara sembarangan.
3. Jangan lakukan external API call dari callback.
4. Jangan isi business logic kompleks di callback.
5. Callback timing bisa mengejutkan karena terjadi saat flush.

Untuk audit kompleks, lebih baik gunakan service-level audit atau event/outbox yang eksplisit.

---

## 19. Flush and Cascade

Cascade memengaruhi action queue.

```java
app.addDocument(doc);
em.persist(app);
```

Jika relationship:

```java
@OneToMany(mappedBy = "application", cascade = CascadeType.PERSIST)
private List<Document> documents;
```

Maka persist app dapat menjadwalkan persist document.

Flush akan menghasilkan insert untuk keduanya.

Risiko cascade:

1. Cascade graph terlalu luas.
2. Merge cascade menimpa banyak data.
3. Remove cascade menghapus data yang masih dibutuhkan.
4. Flush menjadi berat karena graph besar.
5. SQL sulit diprediksi.

Prinsip:

```text
Cascade should follow lifecycle ownership, not convenience.
```

---

## 20. Flush and Orphan Removal

Orphan removal:

```java
@OneToMany(mappedBy = "application", orphanRemoval = true)
private List<Document> documents;
```

Jika:

```java
application.getDocuments().remove(document);
```

Flush dapat menghasilkan:

```sql
delete from document where id=?
```

Bukan hanya update FK menjadi null.

Gunakan orphan removal hanya jika child benar-benar tidak punya lifecycle di luar parent.

Untuk audit/regulatory system, penghapusan child sering tidak boleh hard delete. Soft delete/history mungkin lebih tepat.

---

## 21. Refresh, Clear, Detach, and Flush Interaction

### 21.1 `refresh()`

```java
em.refresh(entity);
```

Makna:

```text
Reload entity state from database, overwriting in-memory changes.
```

Jika entity punya unflushed changes, perubahan bisa hilang.

Gunakan untuk:

1. reload database-generated value,
2. discard local modifications,
3. sync after external database operation.

Jangan gunakan sebagai generic “fix stale data” tanpa memahami transaction isolation.

---

### 21.2 `clear()`

```java
em.clear();
```

Makna:

```text
Detach all managed entities from persistence context.
```

Jika ada unflushed changes, perubahan bisa hilang.

Aman jika dilakukan setelah:

```java
em.flush();
em.clear();
```

pada batch processing.

---

### 21.3 `detach(entity)`

```java
em.detach(entity);
```

Makna:

```text
Detach one entity.
```

Perubahan setelah detach tidak dirty checked.

---

### 21.4 `evict` / Provider-Specific APIs

Hibernate memiliki API tambahan seperti evict/session-level controls. Gunakan hanya jika kamu sadar sedang keluar dari portability JPA.

---

## 22. Practical Use Case Patterns

### 22.1 Simple Command Update

```java
@Transactional
public void updateRemarks(UpdateRemarksCommand command) {
    Application app = applicationRepository.findById(command.applicationId())
        .orElseThrow(ApplicationNotFoundException::new);

    app.changeRemarks(command.remarks(), command.actor());
}
```

Tidak perlu `save()` jika entity managed.

Flush terjadi sebelum commit.

---

### 22.2 Update Then Need Constraint Error Early

```java
@Transactional
public void createReference(CreateApplicationCommand command) {
    Application app = Application.create(command.referenceNo());
    em.persist(app);

    em.flush();

    // Only proceed after unique/reference constraints are known to pass.
    auditService.recordCreated(app.id());
}
```

Tetapi jika `auditService` menulis ke DB dalam transaction yang sama, flush manual belum tentu perlu. Jika side effect external, lebih baik outbox.

---

### 22.3 Bulk Expire Applications

```java
@Transactional
public int expireApplications(Instant cutoff) {
    int updated = em.createQuery("""
        update Application a
        set a.status = :expired,
            a.version = a.version + 1
        where a.status = :submitted
          and a.submittedAt < :cutoff
    """)
    .setParameter("expired", ApplicationStatus.EXPIRED)
    .setParameter("submitted", ApplicationStatus.SUBMITTED)
    .setParameter("cutoff", cutoff)
    .executeUpdate();

    em.clear();
    return updated;
}
```

Bulk update lebih efisien daripada load ribuan entity, tetapi bypass lifecycle callback dan persistence context state.

---

### 22.4 State Transition with Optimistic Lock

```java
@Transactional
public void approve(ApproveCommand command) {
    Application app = applicationRepository.findById(command.applicationId())
        .orElseThrow(ApplicationNotFoundException::new);

    if (!app.version().equals(command.expectedVersion())) {
        throw new ConflictException("Application has changed");
    }

    app.approve(command.actor(), command.reason());
}
```

At flush:

```sql
update application
set status=?, version=?
where id=? and version=?
```

Jika row count `0`, conflict terjadi.

---

### 22.5 Avoid Accidental Update in Read Path

Buruk:

```java
@Transactional
public ApplicationDetail detail(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.setDisplayLabel(computeLabel(app));
    return mapper.toDetail(app);
}
```

Baik:

```java
@Transactional(readOnly = true)
public ApplicationDetail detail(Long id) {
    Application app = repository.findById(id).orElseThrow();
    return ApplicationDetail.from(app, computeLabel(app));
}
```

Lebih baik untuk hot read path:

```java
@Query("""
    select new com.acme.ApplicationDetail(
        a.id, a.referenceNo, a.status, applicant.name
    )
    from Application a
    join a.applicant applicant
    where a.id = :id
""")
Optional<ApplicationDetail> findDetail(Long id);
```

---

## 23. Debugging Generated SQL

### 23.1 Enable SQL Logging Carefully

Di development/test:

```properties
hibernate.show_sql=false
hibernate.format_sql=true
hibernate.highlight_sql=true
```

Lebih baik pakai logging framework:

```properties
logging.level.org.hibernate.SQL=DEBUG
logging.level.org.hibernate.orm.jdbc.bind=TRACE
```

Catatan: nama logger bisa berbeda antar versi Hibernate. Jangan aktifkan bind parameter TRACE di production tanpa kontrol karena bisa mengekspos PII/secret dan membebani aplikasi.

---

### 23.2 Add SQL Comments

Hibernate mendukung SQL comment untuk membantu korelasi query.

Contoh konsep:

```java
query.setHint("org.hibernate.comment", "ApplicationRepository.findListing");
```

Atau konfigurasi provider/framework.

Tujuannya:

```sql
/* ApplicationRepository.findListing */ select ...
```

Ini membantu saat melihat slow query log/database session.

---

### 23.3 Use Hibernate Statistics

Metrics penting:

1. entity load count,
2. entity fetch count,
3. entity insert/update/delete count,
4. flush count,
5. query execution count,
6. second-level cache hit/miss,
7. collection fetch count,
8. optimistic failure count.

Jangan hanya melihat “query lambat”. Lihat juga jumlah query dan jumlah entity hydrated.

---

### 23.4 Observe Flush Count

Jika endpoint read-only menyebabkan flush count naik, ada kemungkinan:

1. method read memutasi managed entity,
2. flush mode tidak sesuai,
3. callback mengubah state,
4. mapper punya side effect,
5. entity getter melakukan mutation/lazy initialization aneh.

Getter entity sebaiknya tidak punya side effect.

---

## 24. Performance Implications

### 24.1 Dirty Checking Cost

Cost dirty checking dipengaruhi oleh:

1. jumlah managed entity,
2. jumlah field per entity,
3. collection size,
4. custom/mutable type,
5. bytecode enhancement,
6. flush frequency.

Persistence context besar membuat flush mahal walaupun hanya sedikit entity berubah.

Prinsip:

```text
Keep persistence context aligned with use case size.
```

---

### 24.2 SQL Shape Variability

Dynamic update menghasilkan banyak variasi SQL:

```sql
update application set remarks=? where id=?
update application set status=? where id=?
update application set remarks=?, status=? where id=?
```

Banyak SQL shape dapat mengurangi efektivitas statement cache/plan cache.

---

### 24.3 Flush Frequency

Terlalu jarang flush:

1. memory bloat,
2. huge action queue,
3. late failure,
4. huge rollback.

Terlalu sering flush:

1. batching rusak,
2. lebih banyak roundtrip,
3. lock diambil lebih awal,
4. throughput turun.

Cari titik seimbang berdasarkan workload.

---

### 24.4 Entity Graph Size

Semakin besar graph yang managed, semakin besar risiko:

1. accidental dirty checking,
2. cascade storm,
3. memory pressure,
4. flush latency,
5. unexpected SQL.

Untuk read-heavy listing/report, gunakan projection.

---

## 25. Failure Modes

### 25.1 Constraint Violation at Unexpected Location

Gejala:

```text
Exception thrown during query, not save.
```

Penyebab:

```text
AUTO flush before query.
```

Solusi:

1. pahami flush trigger,
2. catch exception at transaction boundary,
3. jangan taruh external side effect sebelum DB consistency known,
4. gunakan explicit flush jika memang ingin fail early.

---

### 25.2 Accidental Update from Mapper

Gejala:

```text
GET endpoint updates database.
```

Penyebab:

1. mapper memutasi entity,
2. normalizer memanggil setter,
3. getter side effect,
4. read method transactional dengan managed entity.

Solusi:

1. projection untuk read,
2. DTO copy,
3. pure mapper,
4. test no-flush/no-update pada read use case.

---

### 25.3 Stale Data After Bulk Update

Gejala:

```text
Bulk update succeeded, but subsequent entity object still has old value.
```

Penyebab:

```text
Bulk update bypassed persistence context.
```

Solusi:

```java
em.flush();
em.clear();
```

atau isolate bulk operation in separate transaction.

---

### 25.4 Batch Import OutOfMemory

Gejala:

```text
Heap grows until OOM during import.
```

Penyebab:

```text
Persistence context holds all managed entities.
```

Solusi:

1. chunk transaction,
2. flush/clear loop,
3. JDBC batching,
4. stateless/bulk API if appropriate,
5. avoid loading unnecessary associations.

---

### 25.5 Deadlock at Commit

Gejala:

```text
Business method completes, commit fails with deadlock.
```

Penyebab:

```text
SQL executed at flush/commit, lock order conflict.
```

Solusi:

1. deterministic update order,
2. shorter transactions,
3. avoid remote calls in transaction,
4. bounded retry for safe operations,
5. analyze DB deadlock graph.

---

### 25.6 Unexpected Insert Due to Cascade

Gejala:

```text
Saving parent inserts unrelated child graph.
```

Penyebab:

```text
Cascade too broad.
```

Solusi:

1. limit cascade to lifecycle-owned child,
2. avoid cascade merge on huge aggregate,
3. explicit repository operation for independent aggregate.

---

### 25.7 Lost Changes Due to Clear/Refresh

Gejala:

```text
Entity changes disappear.
```

Penyebab:

1. `clear()` before flush,
2. `refresh()` overwrote unflushed changes,
3. detach then modify.

Solusi:

1. flush before clear when intended,
2. avoid refresh unless deliberate,
3. make transaction code explicit.

---

## 26. Design Rules for Staff-Level Persistence Code

### Rule 1 — Treat Flush as a First-Class Concept

Do not hide flush behind vague language like “save”. Be able to answer:

```text
When will SQL be sent?
What can trigger flush?
What happens if flush fails?
What side effects already happened?
```

---

### Rule 2 — Mutate Managed Entities Only in Command Use Cases

Read paths should not mutate managed entities.

Use:

1. projection,
2. DTO,
3. read-only transaction,
4. immutable view object.

---

### Rule 3 — Do Not Use `saveAndFlush()` by Default

Use it only for explicit timing needs.

Default should be:

```text
modify managed aggregate -> flush at transaction commit
```

---

### Rule 4 — Bulk Operations Must Clear or Isolate Context

After JPQL/native bulk update/delete, assume persistence context may be stale.

---

### Rule 5 — Keep Persistence Context Small

A transaction should not accidentally manage thousands of entities unless it is a controlled batch.

---

### Rule 6 — Use Explicit State Transition Methods

Instead of:

```java
app.setStatus(APPROVED);
```

Prefer:

```java
app.approve(actor, reason, now);
```

This reduces accidental dirty update and centralizes invariant.

---

### Rule 7 — External Side Effects Must Not Depend on Uncommitted Flush

Flush is not commit. Do not send irreversible email/message/file operation just because flush succeeded.

Use outbox/event after commit design.

---

### Rule 8 — Test Generated SQL for Critical Paths

For hot or critical use cases, test/inspect:

1. query count,
2. update count,
3. flush count,
4. affected rows,
5. version condition,
6. cascade behavior.

---

## 27. Code Examples

### 27.1 Managed Update Without Save

```java
@Service
public class ApplicationService {

    private final ApplicationRepository repository;

    public ApplicationService(ApplicationRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public void submit(long applicationId, UserId actor) {
        Application application = repository.findById(applicationId)
            .orElseThrow(() -> new ApplicationNotFoundException(applicationId));

        application.submit(actor, Instant.now());

        // No save needed if entity is managed.
        // Flush happens before commit.
    }
}
```

Entity:

```java
@Entity
@Table(name = "application")
public class Application {

    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private ApplicationStatus status;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "submitted_by")
    private String submittedBy;

    protected Application() {
    }

    public void submit(UserId actor, Instant now) {
        if (status != ApplicationStatus.DRAFT) {
            throw new InvalidStateTransitionException(status, ApplicationStatus.SUBMITTED);
        }
        this.status = ApplicationStatus.SUBMITTED;
        this.submittedAt = now;
        this.submittedBy = actor.value();
    }
}
```

---

### 27.2 Explicit Flush for Fail-Fast Constraint

```java
@Transactional
public ApplicationId create(CreateApplicationCommand command) {
    Application application = Application.create(
        command.referenceNo(),
        command.applicantId(),
        clock.instant()
    );

    entityManager.persist(application);

    try {
        entityManager.flush();
    } catch (PersistenceException ex) {
        throw constraintTranslator.translate(ex);
    }

    return new ApplicationId(application.id());
}
```

Use case ini valid jika kamu memang ingin unique/reference constraint terdeteksi sebelum lanjut.

---

### 27.3 Bulk Update with Clear

```java
@Repository
public class ApplicationExpiryRepository {

    @PersistenceContext
    private EntityManager em;

    @Transactional
    public int expireSubmittedBefore(Instant cutoff) {
        em.flush();

        int updated = em.createQuery("""
            update Application a
            set a.status = :expired,
                a.version = a.version + 1
            where a.status = :submitted
              and a.submittedAt < :cutoff
        """)
        .setParameter("expired", ApplicationStatus.EXPIRED)
        .setParameter("submitted", ApplicationStatus.SUBMITTED)
        .setParameter("cutoff", cutoff)
        .executeUpdate();

        em.clear();
        return updated;
    }
}
```

---

### 27.4 Batch Insert with Flush/Clear

```java
@Transactional
public ImportResult importRows(List<ApplicationImportRow> rows) {
    int batchSize = 100;
    int inserted = 0;

    for (int i = 0; i < rows.size(); i++) {
        Application application = map(rows.get(i));
        entityManager.persist(application);
        inserted++;

        if (inserted % batchSize == 0) {
            entityManager.flush();
            entityManager.clear();
        }
    }

    entityManager.flush();
    entityManager.clear();

    return new ImportResult(inserted);
}
```

Untuk produksi besar, pertimbangkan chunk transaction agar restartable.

---

### 27.5 Detect Accidental Flush in Read Test

Contoh konsep test dengan Hibernate statistics:

```java
@Test
void detailQueryShouldNotFlushOrUpdate() {
    Statistics statistics = sessionFactory.getStatistics();
    statistics.clear();

    service.getDetail(applicationId);

    assertThat(statistics.getFlushCount()).isZero();
    assertThat(statistics.getEntityUpdateCount()).isZero();
}
```

Ini bukan selalu test wajib untuk semua method, tetapi sangat berguna untuk hot read paths.

---

## 28. Operational Observability

Untuk production-grade persistence, monitor minimal:

1. flush count per request/use case,
2. entity insert/update/delete count,
3. query count,
4. transaction duration,
5. connection checkout time,
6. lock wait time,
7. deadlock count,
8. optimistic lock failure count,
9. batch size effectiveness,
10. slow SQL with correlation id,
11. rows affected,
12. rollback count.

Correlation context yang berguna:

```text
requestId
userId/actorId if safe
useCase
entity type
entity id/reference
transaction name
SQL comment/query name
```

Jangan log PII/secret di SQL bind parameter production.

---

## 29. Checklist

### 29.1 Flush Reasoning Checklist

Sebelum menulis use case update, jawab:

- [ ] Entity mana yang managed?
- [ ] Entity mana yang detached/transient?
- [ ] Perubahan mana yang diharapkan dirty checked?
- [ ] Kapan flush terjadi?
- [ ] Apakah query di tengah transaction bisa memicu flush?
- [ ] Apakah constraint violation bisa muncul sebelum commit?
- [ ] Apakah ada external side effect sebelum commit?
- [ ] Apakah perlu explicit flush?
- [ ] Apakah explicit flush memperpanjang lock duration?
- [ ] Apakah rollback setelah flush masih aman?

---

### 29.2 Dirty Checking Checklist

- [ ] Apakah read path memutasi entity?
- [ ] Apakah mapper punya side effect?
- [ ] Apakah getter entity memutasi state?
- [ ] Apakah custom mutable type dirty checked dengan benar?
- [ ] Apakah persistence context terlalu besar?
- [ ] Apakah entity graph terlalu luas?
- [ ] Apakah `merge()` dipakai secara aman?
- [ ] Apakah update method explicit melalui domain behavior?

---

### 29.3 Bulk Operation Checklist

- [ ] Apakah bulk update/delete bypass persistence context?
- [ ] Apakah ada managed entity yang menjadi stale?
- [ ] Apakah perlu `flush()` sebelum bulk operation?
- [ ] Apakah perlu `clear()` setelah bulk operation?
- [ ] Apakah version column harus diincrement?
- [ ] Apakah audit/callback/outbox ikut terlewat?
- [ ] Apakah operation restartable/idempotent?

---

### 29.4 Batch Checklist

- [ ] Apakah transaction terlalu besar?
- [ ] Apakah flush/clear dilakukan berkala?
- [ ] Apakah chunk commit diperlukan?
- [ ] Apakah id generation mendukung batching?
- [ ] Apakah JDBC batch aktif dan efektif?
- [ ] Apakah error handling bisa melanjutkan/retry?
- [ ] Apakah duplicate/idempotency ditangani?
- [ ] Apakah memory persistence context terkontrol?

---

## 30. Latihan / Scenario

### Scenario 1 — Constraint Violation Muncul Saat Query

Kode:

```java
@Transactional
public void createThenSearch() {
    em.persist(new Application("APP-001"));
    em.persist(new Application("APP-001"));

    repository.findByStatus(ApplicationStatus.DRAFT);
}
```

Pertanyaan:

1. Kenapa unique constraint bisa muncul saat `findByStatus`?
2. Apakah itu bug provider?
3. Bagaimana membuat error muncul lebih eksplisit?
4. Apakah external side effect aman diletakkan sebelum query?

---

### Scenario 2 — GET Endpoint Mengupdate Database

Kode:

```java
@Transactional
public Detail detail(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.setDisplayStatus(calculateDisplayStatus(app));
    return mapper.toDetail(app);
}
```

Pertanyaan:

1. Mengapa database bisa terupdate?
2. Bagaimana memperbaiki tanpa menghapus transaction?
3. Bagaimana test yang membuktikan read path tidak update?
4. Apakah `readOnly=true` cukup sebagai correctness guard?

---

### Scenario 3 — Bulk Update Tapi Entity Masih Lama

Kode:

```java
Application app = em.find(Application.class, id);

em.createQuery("update Application a set a.status = CLOSED where a.id = :id")
  .setParameter("id", id)
  .executeUpdate();

assert app.getStatus() == CLOSED;
```

Pertanyaan:

1. Mengapa assertion bisa gagal?
2. Apa perbedaan bulk update dengan dirty checking?
3. Apa strategi aman setelah bulk update?
4. Bagaimana efeknya terhadap versioning dan audit?

---

### Scenario 4 — Batch Import OOM

Kode:

```java
@Transactional
public void importAll(List<Row> rows) {
    rows.forEach(row -> em.persist(map(row)));
}
```

Pertanyaan:

1. Kenapa memory naik?
2. Apakah JDBC batch otomatis menyelesaikan problem?
3. Bagaimana desain flush/clear?
4. Kapan perlu chunk transaction?
5. Kapan JPA bukan tool terbaik?

---

### Scenario 5 — Deadlock Saat Commit

Dua transaction mengubah dua application dalam urutan berbeda. Exception muncul pada commit.

Pertanyaan:

1. Kenapa stack trace menunjuk commit?
2. Bagaimana flush timing memengaruhi deadlock?
3. Bagaimana mendesain deterministic lock/update order?
4. Retry seperti apa yang aman?

---

## 31. Ringkasan

Inti bagian ini:

1. **Flush bukan commit.** Flush mengirim SQL ke database transaction, commit membuat perubahan durable.
2. **Dirty checking hanya berlaku untuk managed entity.** Detached entity tidak otomatis disimpan.
3. **Write-behind menunda SQL.** Ini membantu batching dan ordering, tapi membuat timing error/lock lebih sulit dipahami.
4. **Query bisa memicu flush.** Dalam `AUTO` flush mode, provider dapat flush sebelum query agar hasil query konsisten.
5. **Constraint violation bisa muncul di query/flush/commit.** Jangan hanya menangani error di sekitar `save()`.
6. **Bulk update/delete bypass persistence context.** Setelah bulk operation, context bisa stale.
7. **Read path tidak boleh memutasi managed entity.** Jika perlu read model, gunakan projection/DTO.
8. **Batch job butuh flush/clear/chunking.** JPA naive batch mudah menyebabkan OOM dan long transaction.
9. **`saveAndFlush()` bukan default.** Gunakan hanya untuk kebutuhan timing eksplisit.
10. **Generated SQL adalah bagian dari desain.** Staff-level engineer harus bisa menjelaskan SQL apa yang akan keluar, kapan, dan mengapa.

Mental model akhirnya:

```text
Entity mutation is not database mutation.
Dirty checking is not commit.
Flush is not durability.
Commit is not side-effect coordination.
```

Persistence correctness muncul ketika kamu bisa mengontrol keempat hal itu secara sadar.

---

## 32. Koneksi ke Part Berikutnya

Part ini menjelaskan bagaimana persistence context menghasilkan SQL melalui flush, dirty checking, dan write-behind.

Part berikutnya akan membahas:

```text
Part 016 — Batch Processing and High-Volume Persistence
```

Di sana kita akan memperdalam batch workload secara khusus:

1. batch insert/update/delete,
2. chunk transaction,
3. JDBC batching,
4. cursor/stream processing,
5. stateless session,
6. bulk JPQL/native SQL,
7. restartability,
8. idempotency,
9. backfill/migration strategy,
10. kapan JPA harus diganti dengan JDBC/ETL approach.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-014.md">⬅️ Part 014 — Pessimistic Locking, Deadlocks, and High-Contention Workloads</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-016.md">Part 016 — Batch Processing and High-Volume Persistence ➡️</a>
</div>

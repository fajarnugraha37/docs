# Part 17 — Bulk Operations, Batching, Stateless Sessions, and High-Volume Data Mutation

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Scope: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4  
> Fokus: operasi mutasi volume besar, batch writing, bulk JPQL/Criteria, persistence context bypass, stateless/session-level trade-off, dan failure mode production.

---

## 1. Why This Matters

Pada aplikasi enterprise, terutama case management, compliance, audit, billing, notification, migration, archival, dan reconciliation, kita sering perlu memutasi data dalam jumlah besar:

- menutup ribuan case yang expired,
- mengubah status task setelah SLA breach,
- mengarsipkan data lama,
- mengisi kolom baru saat migration,
- reprocess failed correspondence,
- mark notification as sent,
- import master data,
- sync external reference data,
- rebuild denormalized read model,
- purge temporary rows,
- recalculate derived state.

Masalahnya: ORM entity operation biasa didesain untuk **object graph consistency**, bukan untuk memproses jutaan row secara naif.

Kode seperti ini terlihat benar:

```java
List<CaseFile> cases = em.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
""", CaseFile.class)
.setParameter("status", CaseStatus.EXPIRED)
.getResultList();

for (CaseFile c : cases) {
    c.closeExpired();
}
```

Tapi secara runtime ini berarti:

1. Load seluruh row menjadi object.
2. Simpan semua managed entity di persistence context.
3. Simpan snapshot untuk dirty checking.
4. Jalankan dirty checking saat flush.
5. Generate update per entity.
6. Mungkin trigger listener/callback.
7. Mungkin update association/cascade.
8. Mungkin menyebabkan memory spike.
9. Mungkin menyebabkan flush menjadi sangat lambat.
10. Mungkin menahan lock lebih lama dari perlu.

Untuk 100 row, pendekatan ini nyaman.  
Untuk 10.000 row, mulai berbahaya.  
Untuk 1.000.000 row, ini bisa menjadi incident.

Bagian ini membahas cara berpikir yang benar:

> High-volume mutation bukan sekadar “loop entity lebih cepat”, tetapi memilih mekanisme mutasi yang tepat sesuai invariant, side effect, consistency, memory, locking, dan observability.

---

## 2. Core Mental Model: Three Mutation Modes

Dalam ORM, ada tiga keluarga besar mutasi data.

```text
┌────────────────────────────────────────────────────────────────┐
│                    ORM Mutation Strategies                      │
├────────────────────────────────────────────────────────────────┤
│ 1. Entity Mutation                                               │
│    Load entity -> modify object -> dirty checking -> SQL         │
│                                                                │
│ 2. Bulk SQL-like Mutation                                        │
│    JPQL/Criteria/native update/delete -> database rows directly │
│                                                                │
│ 3. Streaming / Stateless / Batched Row Processing                │
│    Process many rows with controlled memory and batching         │
└────────────────────────────────────────────────────────────────┘
```

Masing-masing punya konsekuensi.

| Mode | Cara Kerja | Cocok Untuk | Risiko Utama |
|---|---|---|---|
| Entity mutation | Entity diload, dimanage, dimutasi | domain invariant kompleks | memory, dirty checking, N+1, lambat |
| JPQL/Criteria bulk | SQL update/delete langsung | update/delete massal sederhana | bypass persistence context, listener, optimistic lock |
| Native SQL | SQL spesifik database | operasi set-based kompleks | portability, cache sync, mapping bypass |
| JDBC batching via ORM | banyak statement entity dipaketkan | banyak insert/update entity | tetap ada persistence context cost |
| Hibernate StatelessSession | direct row operation tanpa PC penuh | ETL/import volume besar | no first-level cache, no cascade normal, semantic berbeda |
| EclipseLink batch writing | grouping write statements | volume write | perlu config dan validasi driver |

Mental model praktisnya:

> Semakin dekat ke entity model, semakin tinggi correctness domain otomatis tetapi semakin mahal. Semakin dekat ke SQL set operation, semakin cepat tetapi semakin banyak invariant yang harus dijaga manual.

---

## 3. Entity Mutation vs Bulk Mutation

### 3.1 Entity Mutation

Entity mutation berarti kita bekerja lewat managed entity.

```java
@Transactional
public void closeExpiredCases(Instant now) {
    List<CaseFile> cases = em.createQuery("""
        select c
        from CaseFile c
        where c.status = :status
          and c.expiryAt < :now
    """, CaseFile.class)
    .setParameter("status", CaseStatus.ACTIVE)
    .setParameter("now", now)
    .getResultList();

    for (CaseFile c : cases) {
        c.expire(now);
    }
}
```

Keuntungannya:

- domain method berjalan,
- validation object bisa terjadi,
- listener/callback bisa berjalan,
- optimistic locking bisa dipakai,
- persistence context menjaga identity,
- dirty checking menentukan update,
- cascade bisa bekerja,
- audit berbasis listener mungkin tertrigger.

Biayanya:

- semua entity diload,
- memory naik,
- snapshot dibuat,
- dirty checking mahal,
- flush panjang,
- association lazy bisa menyebabkan N+1,
- transaction bisa terlalu lama,
- locking window melebar.

### 3.2 Bulk Mutation

Bulk mutation memakai JPQL/Criteria/native SQL untuk update/delete langsung di database.

```java
int updated = em.createQuery("""
    update CaseFile c
    set c.status = :expired,
        c.expiredAt = :now
    where c.status = :active
      and c.expiryAt < :now
""")
.setParameter("expired", CaseStatus.EXPIRED)
.setParameter("active", CaseStatus.ACTIVE)
.setParameter("now", now)
.executeUpdate();
```

Keuntungannya:

- satu SQL statement,
- tidak hydrate object,
- tidak memenuhi persistence context,
- jauh lebih cepat untuk operasi sederhana,
- database optimizer bisa bekerja set-based.

Risikonya:

- persistence context tidak otomatis sinkron,
- lifecycle callback biasanya tidak berjalan,
- entity listener tidak berjalan seperti entity mutation,
- optimistic locking dapat dibypass,
- version column tidak otomatis aman secara portable,
- second-level cache/query cache perlu perhatian,
- domain invariant harus dijaga manual,
- audit berbasis entity listener bisa terlewat.

Jakarta Persistence secara eksplisit memperlakukan bulk update/delete sebagai operasi langsung ke database dan memperingatkan bahwa persistence context tidak disinkronkan dengan hasil bulk operation. Specification juga menyatakan bulk update mem-bypass optimistic locking checks; aplikasi portable harus mengelola version column sendiri bila diperlukan.

---

## 4. The Most Important Rule: Bulk Operation Bypasses Persistence Context

Misalnya:

```java
CaseFile c = em.find(CaseFile.class, id);

em.createQuery("""
    update CaseFile c
    set c.status = :closed
    where c.id = :id
""")
.setParameter("closed", CaseStatus.CLOSED)
.setParameter("id", id)
.executeUpdate();

System.out.println(c.getStatus());
```

Banyak engineer berharap `c.getStatus()` sekarang `CLOSED`.

Tidak selalu. Bahkan secara mental model, harus diasumsikan **tidak berubah**.

Karena object `c` sudah ada di persistence context. Bulk update berjalan langsung di database. Persistence context tidak tahu row itu berubah.

```text
Before bulk update:

Persistence Context
  CaseFile#10 status=ACTIVE

Database
  case_file id=10 status=ACTIVE

After bulk update:

Persistence Context
  CaseFile#10 status=ACTIVE   <-- stale

Database
  case_file id=10 status=CLOSED
```

Lebih buruk lagi:

```java
CaseFile c = em.find(CaseFile.class, id);

em.createQuery("""
    update CaseFile c
    set c.status = :closed
    where c.id = :id
""")
.setParameter("closed", CaseStatus.CLOSED)
.setParameter("id", id)
.executeUpdate();

c.setTitle("Updated title");
em.flush();
```

Jika provider mengirim update entity dari snapshot stale, status bisa tetap dianggap lama di object. Bergantung dynamic update, dirty checking, dan SQL generated, Anda bisa mendapat behavior membingungkan.

Design rule:

```java
em.flush();
em.clear();

int updated = em.createQuery(/* bulk update */).executeUpdate();

em.clear();
```

Pola umum:

1. Flush perubahan entity yang pending.
2. Clear persistence context agar tidak ada stale managed entity.
3. Execute bulk operation.
4. Clear lagi atau jangan pakai managed entity lama.
5. Reload data bila perlu.

---

## 5. Bulk Update Semantics

JPQL bulk update format umum:

```java
int affected = em.createQuery("""
    update Notification n
    set n.status = :sent,
        n.sentAt = :sentAt
    where n.status = :pending
      and n.providerMessageId is not null
""")
.setParameter("sent", NotificationStatus.SENT)
.setParameter("sentAt", Instant.now())
.setParameter("pending", NotificationStatus.PENDING)
.executeUpdate();
```

Karakteristik:

- target satu entity root,
- dapat memakai `where`,
- tidak dapat melakukan arbitrary join update seperti native SQL database tertentu,
- hasil `executeUpdate()` adalah jumlah row/entity terdampak menurut provider/database,
- tidak membuat entity managed,
- tidak menjalankan dirty checking.

### 5.1 Version Column Problem

Misalnya entity punya optimistic lock:

```java
@Entity
class CaseFile {
    @Id
    Long id;

    @Version
    long version;

    @Enumerated(EnumType.STRING)
    CaseStatus status;
}
```

Bulk update ini berbahaya:

```java
em.createQuery("""
    update CaseFile c
    set c.status = :closed
    where c.status = :active
""")
.setParameter("closed", CaseStatus.CLOSED)
.setParameter("active", CaseStatus.ACTIVE)
.executeUpdate();
```

Kenapa?

Karena version bisa tidak naik. Entity lain yang sudah load data lama bisa melakukan update berikutnya tanpa menyadari row sudah berubah secara bulk.

Lebih aman:

```java
int updated = em.createQuery("""
    update CaseFile c
    set c.status = :closed,
        c.version = c.version + 1
    where c.status = :active
""")
.setParameter("closed", CaseStatus.CLOSED)
.setParameter("active", CaseStatus.ACTIVE)
.executeUpdate();
```

Namun perlu hati-hati:

- tipe version harus mendukung increment expression,
- timestamp version punya pendekatan berbeda,
- provider/database expression harus valid,
- semua update path harus konsisten.

Untuk sistem kritikal, bulk update pada versioned entity harus melalui review eksplisit.

---

## 6. Bulk Delete Semantics

Contoh:

```java
int deleted = em.createQuery("""
    delete from TemporaryImportRow r
    where r.batchId = :batchId
      and r.status = :processed
""")
.setParameter("batchId", batchId)
.setParameter("processed", ImportStatus.PROCESSED)
.executeUpdate();
```

Bulk delete cocok untuk:

- temporary table,
- staging rows,
- expired tokens,
- idempotency records lama,
- outbox/archive cleanup setelah aman,
- data yang lifecycle-nya tidak butuh entity callbacks.

Tidak cocok secara default untuk:

- aggregate root dengan child complex,
- entity dengan audit listener wajib,
- entity dengan business invariant deletion,
- entity yang punya cache region aktif,
- entity yang dipakai di persistence context aktif.

### 6.1 Database FK and Bulk Delete

Bulk delete tidak otomatis mengikuti cascade ORM.

Jika ada:

```java
@OneToMany(mappedBy = "caseFile", cascade = CascadeType.REMOVE, orphanRemoval = true)
private List<CaseNote> notes;
```

Lalu menjalankan:

```java
delete from CaseFile c where c.status = :draft
```

Jangan berharap Hibernate/EclipseLink akan load `CaseNote` lalu remove satu-satu. Bulk delete langsung ke database. Jika FK tidak punya `ON DELETE CASCADE`, bisa gagal constraint. Jika FK punya `ON DELETE CASCADE`, child hilang di database tetapi listener ORM child tidak berjalan.

Design rule:

> Bulk delete harus didesain bersama FK strategy, audit strategy, dan cache invalidation strategy.

---

## 7. CriteriaUpdate and CriteriaDelete

Untuk query dinamis, Criteria API menyediakan bulk update/delete.

```java
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaUpdate<CaseFile> update = cb.createCriteriaUpdate(CaseFile.class);
Root<CaseFile> root = update.from(CaseFile.class);

update.set(root.get("status"), CaseStatus.EXPIRED);
update.set(root.get("expiredAt"), now);
update.where(
    cb.and(
        cb.equal(root.get("status"), CaseStatus.ACTIVE),
        cb.lessThan(root.get("expiryAt"), now)
    )
);

int affected = em.createQuery(update).executeUpdate();
```

Kelebihan:

- type-assisted query construction,
- cocok untuk predicate dinamis,
- menghindari string concatenation,
- bisa reuse predicate builder.

Kekurangan:

- verbosity tinggi,
- masih bypass persistence context,
- masih bukan entity mutation,
- masih punya version/cache/callback caveat.

CriteriaDelete:

```java
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaDelete<TemporaryImportRow> delete = cb.createCriteriaDelete(TemporaryImportRow.class);
Root<TemporaryImportRow> root = delete.from(TemporaryImportRow.class);

 delete.where(
    cb.and(
        cb.equal(root.get("batchId"), batchId),
        cb.equal(root.get("status"), ImportStatus.PROCESSED)
    )
);

int deleted = em.createQuery(delete).executeUpdate();
```

Catatan: bulk criteria tetap map langsung ke database update/delete operation dan persistence context tetap tidak synchronized.

---

## 8. Native SQL Bulk Operations

Native SQL diperlukan ketika:

- butuh database-specific join update,
- butuh CTE,
- butuh window function,
- butuh partition operation,
- butuh optimizer hint,
- butuh `MERGE`, `UPSERT`, `ON CONFLICT`, `INSERT INTO SELECT`,
- butuh direct operation terhadap table yang bukan entity.

Contoh PostgreSQL-style:

```java
int updated = em.createNativeQuery("""
    update case_file c
    set status = 'EXPIRED',
        expired_at = current_timestamp,
        version = version + 1
    from sla_policy p
    where c.policy_id = p.id
      and c.status = 'ACTIVE'
      and c.created_at + (p.expiry_days * interval '1 day') < current_timestamp
""").executeUpdate();
```

Contoh Oracle-style `MERGE`:

```java
int merged = em.createNativeQuery("""
    merge into case_summary s
    using (
        select c.id as case_id, count(t.id) as open_task_count
        from case_file c
        left join case_task t
          on t.case_id = c.id
         and t.status = 'OPEN'
        group by c.id
    ) x
    on (s.case_id = x.case_id)
    when matched then update set
        s.open_task_count = x.open_task_count,
        s.updated_at = systimestamp
""").executeUpdate();
```

Native SQL trade-off:

| Aspek | Dampak |
|---|---|
| Portability | turun |
| Performance | bisa naik drastis |
| Provider awareness | rendah |
| Cache sync | manual |
| Version handling | manual |
| Audit listener | bypass |
| SQL control | tinggi |

Design rule:

> Native SQL bukan anti-pattern. Native SQL menjadi masalah jika disisipkan tanpa ownership, testing, migration discipline, dan observability.

---

## 9. JDBC Batching Through ORM

Batching berbeda dari bulk operation.

Bulk operation:

```sql
update case_file set status = 'EXPIRED' where expiry_at < ?
```

Satu statement, banyak row.

Batching:

```sql
update case_file set status = ?, version = ? where id = ? and version = ?
update case_file set status = ?, version = ? where id = ? and version = ?
update case_file set status = ?, version = ? where id = ? and version = ?
```

Banyak statement serupa dikirim dalam batch ke JDBC driver/database.

### 9.1 Hibernate JDBC Batching

Hibernate umum dikonfigurasi:

```properties
hibernate.jdbc.batch_size=50
hibernate.order_inserts=true
hibernate.order_updates=true
hibernate.jdbc.batch_versioned_data=true
```

Makna umum:

- `hibernate.jdbc.batch_size`: jumlah statement yang dikelompokkan.
- `hibernate.order_inserts`: reorder insert agar statement sejenis berdekatan.
- `hibernate.order_updates`: reorder update agar batching lebih efektif.
- `hibernate.jdbc.batch_versioned_data`: memungkinkan batching entity versioned jika driver row count reliable.

Contoh batch insert entity:

```java
@Transactional
public void importRows(List<ImportRowCommand> commands) {
    int batchSize = 50;

    for (int i = 0; i < commands.size(); i++) {
        ImportRow row = ImportRow.from(commands.get(i));
        em.persist(row);

        if (i > 0 && i % batchSize == 0) {
            em.flush();
            em.clear();
        }
    }
}
```

Tanpa `flush()`/`clear()`, persistence context tetap membesar.

### 9.2 Why IDENTITY Can Disable Insert Batching

Jika memakai identity column:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Provider sering perlu execute insert segera untuk mendapat generated ID. Ini bisa menghambat batching insert.

Sequence-based generator biasanya lebih batch-friendly:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_seq")
@SequenceGenerator(
    name = "case_seq",
    sequenceName = "case_seq",
    allocationSize = 50
)
private Long id;
```

Design rule:

> Jika sistem butuh high-volume insert, ID generation strategy adalah performance decision, bukan hanya mapping detail.

---

## 10. Persistence Context Memory Management in Batch Loops

Naive loop:

```java
for (ImportRowCommand command : commands) {
    em.persist(ImportRow.from(command));
}
```

Masalah:

- semua entity tetap managed sampai transaction selesai,
- snapshot/metadata menumpuk,
- flush makin mahal,
- memory naik,
- GC pressure naik.

Lebih aman:

```java
int batchSize = 50;

for (int i = 0; i < commands.size(); i++) {
    em.persist(ImportRow.from(commands.get(i)));

    if ((i + 1) % batchSize == 0) {
        em.flush();
        em.clear();
    }
}
```

Namun `clear()` punya konsekuensi:

- semua managed entity detached,
- reference ke entity sebelumnya tidak lagi managed,
- lazy association setelah clear bisa gagal,
- cascading ke object yang sudah detached bisa berubah behavior,
- perlu hati-hati dengan aggregate graph.

Pola lebih aman untuk import:

```java
@Transactional
public ImportResult importBatch(List<ImportRowCommand> commands) {
    int inserted = 0;
    int batchSize = 100;

    for (ImportRowCommand command : commands) {
        ImportRow row = new ImportRow(
            command.batchId(),
            command.lineNumber(),
            command.payload(),
            ImportStatus.PENDING
        );

        em.persist(row);
        inserted++;

        if (inserted % batchSize == 0) {
            em.flush();
            em.clear();
        }
    }

    return new ImportResult(inserted);
}
```

Rule of thumb:

- Batch size 20–100 umum untuk ORM entity batching.
- Batch size terlalu kecil: round trip masih banyak.
- Batch size terlalu besar: memory/lock/driver buffer naik.
- Ukur dengan real database.

---

## 11. Streaming Large Reads for Mutation

Untuk update berbasis entity tetapi volume besar, jangan load semua row sekaligus.

### 11.1 Pagination Trap

Offset pagination untuk mutation bisa berbahaya:

```java
int page = 0;
int size = 100;

while (true) {
    List<CaseFile> cases = em.createQuery("""
        select c from CaseFile c
        where c.status = :active
        order by c.id
    """, CaseFile.class)
    .setParameter("active", CaseStatus.ACTIVE)
    .setFirstResult(page * size)
    .setMaxResults(size)
    .getResultList();

    if (cases.isEmpty()) break;

    for (CaseFile c : cases) {
        c.expire(now);
    }

    em.flush();
    em.clear();
    page++;
}
```

Jika update mengubah predicate (`status = ACTIVE` menjadi `EXPIRED`), offset bisa skip row.

Lebih aman pakai keyset/window:

```java
Long lastId = 0L;
int size = 100;

while (true) {
    List<CaseFile> cases = em.createQuery("""
        select c
        from CaseFile c
        where c.status = :active
          and c.id > :lastId
        order by c.id
    """, CaseFile.class)
    .setParameter("active", CaseStatus.ACTIVE)
    .setParameter("lastId", lastId)
    .setMaxResults(size)
    .getResultList();

    if (cases.isEmpty()) break;

    for (CaseFile c : cases) {
        c.expire(now);
        lastId = c.getId();
    }

    em.flush();
    em.clear();
}
```

### 11.2 Hibernate Scroll/Stream

Hibernate mendukung scroll/stream pattern, tetapi harus hati-hati dengan transaction, fetch size, dan clear.

Contoh konseptual:

```java
Session session = em.unwrap(Session.class);

try (ScrollableResults<CaseFile> scroll = session
        .createQuery("""
            select c
            from CaseFile c
            where c.status = :active
            order by c.id
        """, CaseFile.class)
        .setParameter("active", CaseStatus.ACTIVE)
        .setFetchSize(100)
        .scroll(ScrollMode.FORWARD_ONLY)) {

    int count = 0;

    while (scroll.next()) {
        CaseFile c = scroll.get();
        c.expire(now);

        if (++count % 100 == 0) {
            session.flush();
            session.clear();
        }
    }
}
```

Perhatikan:

- stream/scroll harus ditutup,
- transaction harus aktif,
- driver harus support fetch size dengan benar,
- jangan join fetch huge graph,
- clear bisa detach object yang masih dipakai.

---

## 12. Hibernate StatelessSession

`StatelessSession` adalah API Hibernate untuk operasi row-level lebih ringan.

Mental model:

```text
Stateful Session / EntityManager:
  - first-level cache
  - persistence context identity
  - dirty checking
  - write-behind
  - cascades normal
  - lifecycle event semantics normal

StatelessSession:
  - no first-level cache
  - no persistence context identity map
  - no automatic dirty checking
  - operations execute more directly
  - lower memory overhead
  - different semantics
```

Contoh:

```java
SessionFactory sf = em.getEntityManagerFactory()
    .unwrap(SessionFactory.class);

try (StatelessSession session = sf.openStatelessSession()) {
    Transaction tx = session.beginTransaction();

    for (ImportRowCommand command : commands) {
        ImportRow row = ImportRow.from(command);
        session.insert(row);
    }

    tx.commit();
}
```

Kapan berguna:

- ETL,
- import besar,
- export/process row besar,
- migration utility,
- operation yang tidak butuh identity map,
- operation yang tidak butuh domain graph cascade.

Kapan berbahaya:

- aggregate invariant kompleks,
- butuh cascade otomatis,
- butuh dirty checking,
- butuh first-level cache identity guarantee,
- butuh listener/callback behavior yang sama seperti EntityManager,
- object graph saling referensi.

Design rule:

> StatelessSession adalah alat untuk data pipeline, bukan default persistence layer untuk domain transaction.

---

## 13. EclipseLink Batch Writing

EclipseLink menyediakan batch writing untuk mengirim beberapa INSERT/UPDATE/DELETE dalam batch.

Konfigurasi umum:

```xml
<property name="eclipselink.jdbc.batch-writing" value="JDBC"/>
<property name="eclipselink.jdbc.batch-writing.size" value="100"/>
```

Untuk Oracle, ada mode khusus:

```xml
<property name="eclipselink.jdbc.batch-writing" value="Oracle-JDBC"/>
<property name="eclipselink.jdbc.batch-writing.size" value="150"/>
```

Makna:

- EclipseLink mengelompokkan statement write,
- efektivitas bergantung provider, driver, dan database,
- perlu diuji dengan SQL logging/DB metrics,
- tidak otomatis menyelesaikan memory persistence context.

Seperti Hibernate, Anda tetap perlu mempertimbangkan:

- flush interval,
- clear/detach,
- transaction size,
- generated ID strategy,
- association cascade,
- lock duration,
- exception recovery.

---

## 14. Insert Strategies: Entity Persist vs Bulk Insert vs Native Insert-Select

JPA/JPQL standar tidak menyediakan `insert into ... select ...` portable untuk entity seperti SQL.

Pilihan:

### 14.1 Entity Persist

```java
for (Command cmd : commands) {
    em.persist(Entity.from(cmd));
    if (++count % batchSize == 0) {
        em.flush();
        em.clear();
    }
}
```

Cocok jika:

- perlu entity lifecycle,
- perlu converter/listener,
- jumlah menengah,
- source data dari application memory.

### 14.2 Native Insert Select

```java
em.createNativeQuery("""
    insert into case_summary (case_id, open_task_count, updated_at)
    select c.id, count(t.id), current_timestamp
    from case_file c
    left join case_task t on t.case_id = c.id and t.status = 'OPEN'
    group by c.id
""").executeUpdate();
```

Cocok jika:

- data source sudah di database,
- operasi set-based,
- volume besar,
- lifecycle ORM tidak diperlukan.

### 14.3 Staging Table + Merge

Untuk import kompleks:

1. Load CSV/external data ke staging table.
2. Validate staging rows set-based.
3. Merge into target tables.
4. Mark errors.
5. Archive staging batch.

```text
External File/API
      │
      ▼
Staging Table
      │ validate set-based
      ▼
Error Table / Valid Rows
      │
      ▼
MERGE / INSERT SELECT target tables
      │
      ▼
Audit / Summary / Reconciliation
```

Untuk volume besar, staging-table design sering lebih baik daripada memaksa semua lewat entity object.

---

## 15. Update Strategies

### 15.1 Entity Update

Gunakan jika:

- business rule kompleks,
- invariant ada di domain method,
- perlu optimistic locking per aggregate,
- perlu listener/audit per entity,
- update jumlah kecil-menengah.

### 15.2 Bulk JPQL Update

Gunakan jika:

- update sederhana,
- predicate jelas,
- tidak perlu per-entity callback,
- version handling bisa dijaga,
- persistence context bisa dikosongkan.

### 15.3 Native Update

Gunakan jika:

- butuh join update kompleks,
- butuh CTE/window function,
- butuh database-specific feature,
- operasi data correction/migration besar.

### 15.4 Chunked Entity Update

Gunakan jika:

- perlu domain logic,
- volume cukup besar,
- masih harus lewat entity,
- bisa diproses per chunk.

```java
while (true) {
    List<Long> ids = em.createQuery("""
        select c.id
        from CaseFile c
        where c.status = :pending
        order by c.id
    """, Long.class)
    .setParameter("pending", CaseStatus.PENDING_REVIEW)
    .setMaxResults(100)
    .getResultList();

    if (ids.isEmpty()) break;

    List<CaseFile> cases = em.createQuery("""
        select c
        from CaseFile c
        where c.id in :ids
    """, CaseFile.class)
    .setParameter("ids", ids)
    .getResultList();

    for (CaseFile c : cases) {
        c.recalculateReviewState();
    }

    em.flush();
    em.clear();
}
```

Catatan: jika predicate berubah, query `top N pending` berulang bisa aman karena setiap chunk mengubah row keluar dari predicate. Pastikan ada ordering dan no starvation.

---

## 16. Delete Strategies

Delete adalah operasi paling berbahaya.

### 16.1 Entity Remove

```java
CaseFile c = em.find(CaseFile.class, id);
em.remove(c);
```

Cocok jika:

- aggregate kecil,
- cascade/orphan removal perlu berjalan,
- audit listener perlu berjalan,
- delete business-sensitive.

### 16.2 Bulk Delete

```java
em.createQuery("""
    delete from TemporaryToken t
    where t.expiresAt < :now
""")
.setParameter("now", now)
.executeUpdate();
```

Cocok jika:

- data disposable,
- tidak ada child complex,
- FK aman,
- tidak perlu listener.

### 16.3 Soft Delete Bulk Update

```java
em.createQuery("""
    update CaseFile c
    set c.deleted = true,
        c.deletedAt = :now,
        c.version = c.version + 1
    where c.status = :draft
      and c.createdAt < :cutoff
""")
.setParameter("now", now)
.setParameter("draft", CaseStatus.DRAFT)
.setParameter("cutoff", cutoff)
.executeUpdate();
```

Lebih aman daripada physical delete untuk regulatory systems, tetapi menambah risiko:

- semua query harus filter deleted,
- unique constraint perlu partial/function-based index strategy,
- cache/filter harus benar,
- native query bisa bocor.

### 16.4 Archive Then Delete

Untuk regulatory/case management:

```text
1. Select candidate rows
2. Write archive records / export to archive store
3. Verify count/checksum
4. Delete or mark archived
5. Record operation audit
6. Reconcile after commit
```

Delete tanpa reconciliation adalah risiko audit.

---

## 17. Optimistic Locking in Bulk and Batch Processing

Entity update normal:

```sql
update case_file
set status = ?, version = ?
where id = ? and version = ?
```

Jika row count 0, provider bisa throw optimistic lock exception.

Bulk update biasa:

```sql
update case_file
set status = 'CLOSED'
where status = 'ACTIVE'
```

Tidak ada `version = ?` per entity.

Bulk update aman untuk optimistic locking harus mendefinisikan expected state:

```java
int updated = em.createQuery("""
    update CaseFile c
    set c.status = :closed,
        c.version = c.version + 1
    where c.id = :id
      and c.version = :expectedVersion
      and c.status = :active
""")
.setParameter("closed", CaseStatus.CLOSED)
.setParameter("id", id)
.setParameter("expectedVersion", expectedVersion)
.setParameter("active", CaseStatus.ACTIVE)
.executeUpdate();

if (updated != 1) {
    throw new OptimisticConflictException();
}
```

Untuk mass update:

```java
int updated = em.createQuery("""
    update CaseFile c
    set c.status = :expired,
        c.version = c.version + 1
    where c.status = :active
      and c.expiryAt < :now
""")
.setParameter("expired", CaseStatus.EXPIRED)
.setParameter("active", CaseStatus.ACTIVE)
.setParameter("now", now)
.executeUpdate();
```

Ini tidak mendeteksi conflict per user, tetapi setidaknya menaikkan version agar stale managed copies gagal saat update berikutnya.

---

## 18. Lifecycle Callback and Audit Implications

Entity mutation bisa trigger:

```java
@PreUpdate
void beforeUpdate() {
    this.updatedAt = Instant.now();
}
```

Bulk update tidak boleh diasumsikan menjalankan callback ini.

Jika sistem bergantung pada listener:

```java
@EntityListeners(AuditListener.class)
class CaseFile { ... }
```

Maka bulk operation bisa melewati audit.

Solusi:

### 18.1 Explicit Audit Insert

```java
int updated = em.createQuery(/* bulk update */).executeUpdate();

em.createNativeQuery("""
    insert into audit_job_log(job_name, affected_count, executed_at, executed_by)
    values (?, ?, current_timestamp, ?)
""")
.setParameter(1, "expire-cases")
.setParameter(2, updated)
.setParameter(3, actor)
.executeUpdate();
```

### 18.2 Audit Detail Table via Insert Select

```java
em.createNativeQuery("""
    insert into case_audit_event(case_id, event_type, created_at, actor)
    select id, 'EXPIRED_BY_JOB', current_timestamp, ?
    from case_file
    where status = 'ACTIVE'
      and expiry_at < current_timestamp
""")
.setParameter(1, actor)
.executeUpdate();

em.createNativeQuery("""
    update case_file
    set status = 'EXPIRED', version = version + 1
    where status = 'ACTIVE'
      and expiry_at < current_timestamp
""").executeUpdate();
```

Urutan penting. Jika insert audit dan update predicate tidak identik, audit bisa tidak match. Dalam high-integrity system, gunakan temporary table/materialized candidate set:

```text
candidate_case_ids
  job_id
  case_id
  selected_at
```

Lalu audit dan update memakai candidate set yang sama.

---

## 19. Cache Implications

Bulk operations dapat membuat cache stale.

### 19.1 First-Level Cache

Sudah dibahas: harus `clear()` atau reload.

### 19.2 Second-Level Cache

Provider bisa melakukan invalidation tertentu, tetapi jangan membangun correctness dengan asumsi samar.

Jika entity cache aktif:

```text
L2 cache:
  CaseFile#10 status=ACTIVE

Database after bulk:
  CaseFile#10 status=CLOSED
```

Solusi umum:

- evict affected entity region,
- evict query cache region,
- disable cache untuk entity yang sering bulk updated,
- isolate bulk operation window,
- use version increment,
- verify provider behavior.

Hibernate example:

```java
SessionFactory sf = em.getEntityManagerFactory()
    .unwrap(SessionFactory.class);

sf.getCache().evictEntityData(CaseFile.class);
sf.getCache().evictQueryRegions();
```

JPA standard cache API:

```java
Cache cache = em.getEntityManagerFactory().getCache();
cache.evict(CaseFile.class);
```

Design rule:

> Bulk mutation and second-level cache must be designed together. If not, disable cache first.

---

## 20. Transaction Size, Locking, and Failure Recovery

High-volume mutation transaction terlalu besar dapat menyebabkan:

- lock panjang,
- undo/redo log besar,
- replication lag,
- deadlock probability naik,
- rollback mahal,
- connection lama tertahan,
- app timeout,
- DB transaction log pressure.

### 20.1 One Huge Transaction

```text
BEGIN
  update 5,000,000 rows
COMMIT
```

Keuntungan:

- atomic all-or-nothing.

Risiko:

- lock panjang,
- rollback katastrofik,
- blocking besar,
- operational risk tinggi.

### 20.2 Chunked Transactions

```text
BEGIN chunk 1 update 10,000 rows COMMIT
BEGIN chunk 2 update 10,000 rows COMMIT
BEGIN chunk 3 update 10,000 rows COMMIT
```

Keuntungan:

- lock lebih pendek,
- recovery lebih mudah,
- progress bisa dicatat,
- operationally safer.

Risiko:

- bukan all-or-nothing,
- perlu idempotency,
- perlu checkpoint,
- partial completion harus diterima/design.

Untuk production job, chunked transaction sering lebih realistis.

### 20.3 Checkpoint Table

```sql
create table job_checkpoint (
    job_name varchar(100) primary key,
    last_processed_id bigint,
    status varchar(30),
    updated_at timestamp
);
```

Flow:

```text
1. Read checkpoint
2. Process id > checkpoint up to limit
3. Commit data mutation
4. Update checkpoint
5. Repeat
```

Hati-hati: update checkpoint harus atomik dengan chunk mutation atau punya recovery logic.

---

## 21. Idempotency for High-Volume Mutation Jobs

Batch job production harus bisa retry.

Buruk:

```java
// every retry adds another audit row with no uniqueness
insertAudit(caseId, "EXPIRED");
expireCase(caseId);
```

Lebih aman:

```sql
insert into case_audit_event(case_id, event_type, job_id, created_at)
values (?, 'EXPIRED', ?, current_timestamp)
on conflict do nothing;
```

Atau dengan unique constraint:

```sql
unique(case_id, event_type, job_id)
```

Idempotency patterns:

| Pattern | Kegunaan |
|---|---|
| natural target state | update only where status = old state |
| job id | audit/reconciliation uniqueness |
| checkpoint | resume large scan |
| candidate table | stable set of rows |
| processed flag | staging/import pipeline |
| version predicate | conflict detection |

Design rule:

> High-volume mutation yang tidak idempotent adalah incident yang tertunda.

---

## 22. Exception Handling in Batch Processing

Batch failure sulit karena satu bad row bisa menggagalkan batch.

Contoh failure:

- constraint violation,
- duplicate key,
- data truncation,
- FK missing,
- lock timeout,
- deadlock,
- optimistic conflict,
- serialization failure.

Strategi:

### 22.1 Fail Fast

Cocok untuk:

- migration internal,
- data harus konsisten semua,
- failure harus menghentikan job.

### 22.2 Skip Bad Row

Cocok untuk:

- import external data,
- sebagian data boleh error,
- error dicatat ke error table.

### 22.3 Chunk Retry

Cocok untuk:

- transient DB issue,
- deadlock,
- lock timeout,
- network blip.

### 22.4 Binary Search Bad Row

Jika batch 100 gagal dan ingin temukan row buruk:

```text
process 100 -> fail
process first 50 -> ok
process second 50 -> fail
process second 25 -> fail
...
find bad row
```

Ini sering dipakai untuk import pipeline, bukan untuk request transaction biasa.

---

## 23. Choosing the Right Strategy

Decision table:

| Requirement | Recommended Strategy |
|---|---|
| Per-entity domain invariant wajib | chunked entity mutation |
| Update sederhana banyak row | JPQL/Criteria bulk update |
| Delete temporary rows | JPQL bulk delete/native delete |
| Complex set-based transformation | native SQL / staging table |
| Huge import from external file | staging table or batched persist |
| Need Hibernate-specific low-memory row ops | StatelessSession |
| Need provider portability | JPQL/Criteria + conservative behavior |
| Need maximum DB performance | native SQL with tests |
| Need listener/audit callback | entity mutation or explicit audit design |
| Need optimistic locking per row | entity mutation or manual version predicate |
| Need retry/resume | chunked job with checkpoint/idempotency |

Simplified heuristic:

```text
Is mutation business-sensitive per aggregate?
  yes -> entity mutation in chunks
  no  -> set-based bulk operation

Does operation need database-specific capability?
  yes -> native SQL with ownership and tests
  no  -> JPQL/Criteria bulk

Is volume huge and data pipeline-like?
  yes -> staging table / StatelessSession / JDBC batch
  no  -> normal ORM is fine
```

---

## 24. Production Patterns

### 24.1 Expire Cases by SLA

Bad:

```java
List<CaseFile> cases = findAllActiveExpired();
for (CaseFile c : cases) {
    c.expire(now);
}
```

Good if simple:

```java
em.flush();
em.clear();

int affected = em.createQuery("""
    update CaseFile c
    set c.status = :expired,
        c.expiredAt = :now,
        c.version = c.version + 1
    where c.status = :active
      and c.expiryAt < :now
""")
.setParameter("expired", CaseStatus.EXPIRED)
.setParameter("active", CaseStatus.ACTIVE)
.setParameter("now", now)
.executeUpdate();

em.clear();
```

Good if audit detail required:

```text
1. Insert candidate IDs into job_candidate table
2. Insert audit rows from candidate IDs
3. Update case_file from candidate IDs
4. Record affected counts
5. Evict cache/reload if needed
```

### 24.2 Rebuild Case Summary Read Model

Prefer native set-based:

```sql
merge into case_summary s
using (... aggregate query ...) x
on (...)
when matched then update ...
when not matched then insert ...
```

Do not load every case and count tasks in Java unless volume small.

### 24.3 Import External Reference Data

Options:

- Small file: batched `persist()` with flush/clear.
- Large file: load to staging table, validate, merge.
- Complex row-level transformation: StatelessSession or plain JDBC pipeline.

### 24.4 Purge Temporary Data

```java
int deleted = em.createQuery("""
    delete from IdempotencyRecord r
    where r.createdAt < :cutoff
      and r.status in :terminalStatuses
""")
.setParameter("cutoff", cutoff)
.setParameter("terminalStatuses", List.of(SUCCESS, FAILED_TERMINAL))
.executeUpdate();
```

Make sure indexes support predicate:

```sql
create index idx_idempotency_cleanup
on idempotency_record(status, created_at);
```

---

## 25. Observability for High-Volume Mutation

Minimum logs:

```text
job=expire-cases started cutoff=2026-06-17T00:00:00Z
job=expire-cases chunk=1 selected=10000 updated=10000 durationMs=842 lastId=10000
job=expire-cases chunk=2 selected=10000 updated=9998 durationMs=901 lastId=20000
job=expire-cases completed selected=20000 updated=19998 durationMs=1810
```

Metrics:

- selected rows,
- affected rows,
- rows/sec,
- chunk duration,
- DB wait/lock timeout,
- retry count,
- deadlock count,
- flush duration,
- persistence context size proxy metric,
- memory usage,
- connection hold time.

SQL-level observability:

- SQL text normalized,
- bind values redacted/sampled,
- execution plan for large update/delete,
- row count estimate vs actual,
- index usage,
- lock wait.

Design rule:

> Bulk job without affected count logging is operationally blind.

---

## 26. Testing Bulk and Batch Operations

Test categories:

### 26.1 Persistence Context Staleness Test

```java
@Test
void bulkUpdateDoesNotUpdateManagedEntityAutomatically() {
    CaseFile c = em.find(CaseFile.class, id);

    em.createQuery("""
        update CaseFile c
        set c.status = :closed
        where c.id = :id
    """)
    .setParameter("closed", CaseStatus.CLOSED)
    .setParameter("id", id)
    .executeUpdate();

    assertThat(c.getStatus()).isEqualTo(CaseStatus.ACTIVE);

    em.clear();
    CaseFile reloaded = em.find(CaseFile.class, id);
    assertThat(reloaded.getStatus()).isEqualTo(CaseStatus.CLOSED);
}
```

### 26.2 Version Increment Test

Verify version changes if bulk update expected to protect optimistic locking.

### 26.3 Callback Bypass Test

Verify audit listener is not silently assumed.

### 26.4 Batch Insert SQL Count Test

Use SQL counter/integration logging to confirm batching actually occurs.

### 26.5 Real Database Test

H2 is often misleading for:

- sequence behavior,
- identity batching,
- timestamp precision,
- locking,
- deadlock,
- bulk SQL syntax,
- driver batching.

Use Testcontainers or real integration DB for critical batch/bulk behavior.

---

## 27. Anti-Patterns

### 27.1 Load Everything Then Loop

```java
findAll().forEach(entity -> entity.update());
```

Fine for small tables. Dangerous for unknown volume.

### 27.2 Bulk Update While Managed Entities Exist

```java
CaseFile c = em.find(CaseFile.class, id);
bulkUpdateCase(id);
return mapper.toDto(c); // stale
```

### 27.3 Bulk Update Versioned Entity Without Version Strategy

```java
update CaseFile c set c.status = :x where ...
```

No version increment, stale writers may survive.

### 27.4 Assuming Entity Listeners Run

Bulk operations bypass normal entity lifecycle semantics.

### 27.5 Batch Size as Magic Fix

Increasing `hibernate.jdbc.batch_size` does not fix:

- bad query predicate,
- missing index,
- huge persistence context,
- identity generator issue,
- lock contention,
- transaction too large.

### 27.6 Offset Pagination While Mutating Predicate

Can skip rows.

### 27.7 One Huge Transaction for Operational Job

Rollback and lock risk can be worse than slower chunking.

### 27.8 Native SQL Without Cache/Version/Audit Plan

Fast but correctness-blind.

---

## 28. Diagnostic Checklist

When high-volume mutation is slow or unsafe, ask:

1. Are we loading entities when a set-based update would work?
2. Are we mutating business-sensitive aggregates that require domain logic?
3. Is persistence context growing unbounded?
4. Do we call `flush()`/`clear()` in batch loops?
5. Is JDBC batching actually enabled and effective?
6. Does ID generation strategy block insert batching?
7. Are we using offset pagination while changing the result set?
8. Does bulk update bypass optimistic locking?
9. Do we manually increment version where needed?
10. Do lifecycle callbacks/audit listeners need replacement?
11. Is second-level/query cache stale after bulk operation?
12. Is the transaction too large?
13. Is the job idempotent?
14. Can it resume after failure?
15. Are affected row counts logged?
16. Are indexes aligned with bulk predicates?
17. Are lock timeouts/deadlocks monitored?
18. Is testing done on real target DB behavior?

---

## 29. Design Rules

1. **Use entity mutation for invariant-rich behavior.**
2. **Use bulk mutation for simple set-based change.**
3. **Never mix bulk update with managed stale entities casually.**
4. **Flush and clear around bulk operations intentionally.**
5. **Treat version column manually in bulk updates.**
6. **Assume callbacks/listeners are bypassed unless proven otherwise.**
7. **Batching reduces round trips, not persistence context cost.**
8. **Use flush/clear loops for high-volume entity persist/update.**
9. **Prefer sequence allocation over identity for high-volume inserts when possible.**
10. **Use keyset/chunking instead of offset pagination for mutable scans.**
11. **For huge transformations, consider staging table and native SQL.**
12. **For data pipelines, Hibernate StatelessSession can be appropriate.**
13. **For EclipseLink, configure and verify batch writing explicitly.**
14. **Design audit explicitly for bulk jobs.**
15. **Design cache invalidation explicitly for bulk jobs.**
16. **Make long-running mutation jobs idempotent and resumable.**
17. **Log affected row counts and chunk progress.**
18. **Test with the real database dialect and driver.**

---

## 30. Practice Scenarios

### Scenario 1 — Expire Old Draft Applications

You have 2 million draft applications older than 90 days. They have no child rows requiring callback. Need mark `EXPIRED`.

Recommended:

- JPQL/Criteria bulk update,
- increment version,
- clear persistence context,
- log affected count,
- ensure index on `(status, created_at)`,
- evict cache if enabled.

### Scenario 2 — Close Cases with Complex Escalation Rules

Each case closure must:

- validate no open legal hold,
- create audit event,
- close open task,
- send notification,
- update aggregate version.

Recommended:

- chunked entity mutation,
- domain method,
- transactional outbox for notification,
- flush/clear per chunk,
- checkpoint job progress,
- avoid one huge transaction.

### Scenario 3 — Rebuild Reporting Table

Need recompute summary for all cases nightly.

Recommended:

- native SQL `MERGE`/`INSERT SELECT`,
- staging summary table if needed,
- swap/merge,
- no entity hydration,
- plan/index validation.

### Scenario 4 — Import 5 Million Postal Codes

Recommended:

- staging table load,
- set-based validation,
- merge into master table,
- error table,
- reconciliation counts.

Alternative:

- StatelessSession if transformation in Java is necessary.

### Scenario 5 — Delete Temporary Tokens

Recommended:

- JPQL bulk delete,
- predicate indexed by expiry,
- chunk if database lock/log pressure high,
- no entity remove loop.

---

## 31. Summary

High-volume mutation forces us to stop thinking of ORM as just a convenient CRUD abstraction.

There are two competing forces:

```text
Domain correctness through entity lifecycle
        vs
Set-based efficiency through direct database mutation
```

Entity mutation gives rich behavior but has memory, flush, dirty checking, and round-trip cost. Bulk mutation gives speed but bypasses persistence context, lifecycle callbacks, optimistic lock checks, and sometimes cache correctness. JDBC batching reduces round trips but does not remove persistence context cost. StatelessSession and provider-specific batch writing can be powerful, but only when their semantics are understood.

The top-level engineering principle:

> Choose the mutation mechanism based on invariants, not habit.

If the operation is business-sensitive, preserve domain semantics and process in chunks. If the operation is simple and set-based, push it to the database. If the operation is huge, make it resumable, observable, idempotent, and tested on the real database.

---

## 32. What Comes Next

Part 18 akan membahas:

```text
18-transaction-integration-resource-local-jta-spring-jakarta-ee-boundary.md
```

Fokus berikutnya:

- resource-local transaction,
- JTA,
- Spring transaction integration,
- Jakarta EE container-managed transaction,
- transaction-scoped persistence context,
- propagation behavior,
- rollback-only surprise,
- read-only transaction myth,
- boundary design untuk correctness dan performance.


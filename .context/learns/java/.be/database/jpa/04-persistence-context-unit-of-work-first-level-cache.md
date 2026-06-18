# Part 4 — Persistence Context, Unit of Work, and First-Level Cache

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `04-persistence-context-unit-of-work-first-level-cache.md`  
> Level: Advanced / Production Engineering  
> Target: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4

---

## 0. Tujuan Pembelajaran

Bagian ini membahas salah satu konsep paling penting dalam ORM: **persistence context**.

Banyak developer mengenal persistence context secara dangkal sebagai “first-level cache”. Itu tidak salah, tetapi tidak cukup. Untuk engineer level senior/top-tier, persistence context harus dipahami sebagai:

1. **identity map** — menjamin satu row database direpresentasikan oleh satu object instance dalam scope tertentu.
2. **unit of work** — mengumpulkan perubahan object lalu menerjemahkannya menjadi SQL pada waktu flush.
3. **transactional object memory** — area memori tempat object graph dianggap sebagai representasi sementara dari state database.
4. **change tracking scope** — area tempat provider membandingkan state awal dan state akhir entity.
5. **write-behind buffer** — perubahan Java object tidak selalu langsung menjadi SQL.
6. **consistency boundary** — batas di mana “object yang sama” tetap sama, lazy loading masih valid, dan dirty checking masih aktif.

Setelah bagian ini, target pemahaman Anda:

- bisa menjelaskan bedanya `EntityManager`, persistence context, Hibernate `Session`, EclipseLink `UnitOfWork`, dan first-level cache;
- bisa memprediksi kapan object menjadi managed, detached, stale, atau memory-heavy;
- bisa menjelaskan mengapa query kedua kadang tidak hit database tetapi tetap mengembalikan object lama;
- bisa mendesain transaction boundary yang tidak bocor ke API/view layer;
- bisa mendiagnosis bug seperti stale state, hidden update, unexpected flush, memory leak batch job, dan `LazyInitializationException`;
- bisa membedakan kapan perlu `clear()`, `detach()`, `refresh()`, atau persistence context baru.

---

## 1. Core Mental Model

### 1.1 Persistence context bukan sekadar cache

Kalimat yang sering didengar:

> “JPA punya first-level cache.”

Kalimat itu benar, tetapi terlalu sempit.

Persistence context bukan hanya cache untuk menghindari query ulang. Persistence context adalah **ruang kerja object-relational** yang dipakai provider untuk menghubungkan dunia object dan dunia relational.

Dalam satu persistence context, provider menyimpan:

- entity managed;
- key identity entity;
- snapshot awal entity;
- collection wrapper;
- association state;
- proxy/lazy placeholder;
- pending insert/update/delete action;
- informasi dirty checking;
- status lifecycle entity;
- informasi lock/version;
- metadata internal provider.

Jadi, persistence context bukan “map sederhana dari ID ke object”. Ia lebih mirip **workspace transaksional**.

Analogi mental:

```text
Database table
    ↓ load
Persistence Context
    ↓ expose as Java object graph
Application code mutates object
    ↓ dirty checking / action queue
Flush
    ↓ SQL INSERT/UPDATE/DELETE
Database
```

Yang penting:

```text
Object berubah ≠ database langsung berubah
Database berubah ≠ managed object otomatis berubah
Commit ≠ satu-satunya waktu SQL dikirim
Query ≠ selalu membaca fresh dari database
```

---

### 1.2 Persistence context adalah “state synchronization engine”

ORM menyinkronkan dua model state yang berbeda.

Object model:

```java
caseFile.assignOfficer(officer);
caseFile.markUnderReview();
caseFile.addAuditEntry(entry);
```

Relational model:

```sql
UPDATE case_file
SET assigned_officer_id = ?, status = ?
WHERE id = ? AND version = ?;

INSERT INTO case_audit_entry (...)
VALUES (...);
```

Persistence context adalah tempat provider menjawab:

- object mana yang sedang tracked?
- row database mana yang direpresentasikan object ini?
- field mana yang berubah?
- SQL apa yang perlu dikirim?
- urutan SQL apa yang aman terhadap constraint?
- object mana yang sudah ada di memory dan tidak perlu dibuat ulang?
- object mana yang stale?
- object mana yang boleh lazy load?

Tanpa persistence context, ORM tidak bisa memberi ilusi bahwa Anda sedang bekerja dengan object graph yang hidup.

---

## 2. Specification-Level Concept

### 2.1 Definisi dari perspektif Jakarta Persistence

Di level specification, `EntityManager` adalah API utama untuk melakukan operasi yang memengaruhi persistence context dan lifecycle entity. Dokumentasi Jakarta Persistence menyatakan bahwa `EntityManager` digunakan untuk operasi pada state persistence context, termasuk `persist`, `remove`, `find`, dan query terhadap entity type. Referensi: Jakarta Persistence EntityManager API.

Secara sederhana:

```text
EntityManager = interface operasi
Persistence Context = state internal yang dikelola
EntityManagerFactory = factory untuk EntityManager
```

Contoh Java SE:

```java
EntityManagerFactory emf = Persistence.createEntityManagerFactory("appPU");
EntityManager em = emf.createEntityManager();

em.getTransaction().begin();
CaseFile caseFile = em.find(CaseFile.class, 100L);
caseFile.markUnderReview();
em.getTransaction().commit();

em.close();
emf.close();
```

Di sini:

- `emf` mahal dibuat, thread-safe, biasanya application-scoped.
- `em` murah dibuat, tidak thread-safe, biasanya request/transaction-scoped.
- persistence context melekat pada `em`.
- `caseFile` menjadi managed selama masih berada dalam persistence context.

---

### 2.2 Transaction-scoped vs extended persistence context

Dalam Jakarta EE/container-managed context, default-nya adalah persistence context bertipe **transaction-scoped**. Specification menjelaskan bahwa secara default lifetime persistence context container-managed entity manager mengikuti scope transaction. Extended persistence context bisa hidup sejak `EntityManager` dibuat sampai ditutup, dan dapat melintasi beberapa transaction.

Model umum:

```text
Transaction-scoped PC:
Request/service method starts transaction
    PC created or joined
    entities managed
Transaction commits/rollbacks
    PC ends
entities become detached
```

```text
Extended PC:
Stateful component/session starts
    PC created
Transaction 1 uses same PC
Transaction 2 uses same PC
Transaction 3 uses same PC
Component/session ends
    PC closes
```

Transaction-scoped persistence context cocok untuk mayoritas backend service karena:

- scope pendek;
- memory lebih terkontrol;
- stale state lebih kecil;
- transaction boundary lebih jelas.

Extended persistence context bisa berguna untuk conversational state, wizard UI, atau stateful workflow panjang, tetapi risikonya tinggi:

- entity bisa stale;
- memory menumpuk;
- conflict terlambat terlihat;
- object graph lama tetap hidup;
- user interaction panjang bisa membawa state yang sudah tidak valid.

---

### 2.3 Synchronized vs unsynchronized persistence context

Jakarta Persistence mendukung persistence context yang synchronized atau unsynchronized terhadap transaction.

Default-nya adalah synchronized: persistence context otomatis join transaction aktif.

Unsynchronized berarti persistence context tidak otomatis enlisted ke transaction sampai `joinTransaction()` dipanggil.

Mental model:

```text
SYNCHRONIZED:
transaction active -> EntityManager joins automatically -> flush can occur

UNSYNCHRONIZED:
transaction active -> EntityManager does not join automatically
                  -> must call joinTransaction()
```

Use case unsynchronized jarang, tetapi bisa muncul pada conversation panjang, form accumulation, atau workflow yang ingin mengumpulkan perubahan object tanpa langsung ikut transaction.

Risikonya:

- developer mengira perubahan akan flush, padahal belum join transaction;
- lifecycle entity terlihat managed tetapi perubahan belum masuk ke database;
- boundary semakin sulit dibaca.

---

## 3. Provider Vocabulary

### 3.1 JPA/Jakarta Persistence terms

| Term | Makna |
|---|---|
| `EntityManagerFactory` | Factory untuk `EntityManager`; mahal dibuat; biasanya application-scoped |
| `EntityManager` | API operasi persistence; tidak thread-safe |
| Persistence context | Set entity managed dan state tracking-nya |
| Managed entity | Entity yang sedang dilacak persistence context |
| Detached entity | Entity pernah managed, tetapi persistence context-nya sudah tidak mengelola |
| Flush | Sinkronisasi perubahan managed entity ke database lewat SQL |
| Clear | Menghapus semua managed entity dari persistence context |
| Detach | Mengeluarkan satu entity dari persistence context |
| Refresh | Mengambil ulang state entity dari database |

---

### 3.2 Hibernate terms

Dalam Hibernate, padanan `EntityManager` adalah `Session`. Hibernate User Guide mendeskripsikan `Session` sebagai object single-threaded, short-lived, yang secara konseptual memodelkan **Unit of Work**, dan dalam istilah Jakarta Persistence direpresentasikan oleh `EntityManager`. `Session` juga menjaga persistence context/first-level cache dari domain model aplikasi.

Mapping mental:

```text
JPA EntityManager ≈ Hibernate Session
JPA EntityManagerFactory ≈ Hibernate SessionFactory
JPA Persistence Context ≈ Hibernate PersistenceContext / Session-level cache
```

Hibernate internals yang relevan:

- `SessionFactory`
- `Session`
- `PersistenceContext`
- `EntityEntry`
- `CollectionEntry`
- `ActionQueue`
- snapshots
- proxies
- persistent collections
- flush event listeners

Hibernate sering memakai istilah:

```text
Session = unit of work facade
PersistenceContext = internal state map
ActionQueue = queued SQL work
First-level cache = entity identity map inside Session
```

---

### 3.3 EclipseLink terms

EclipseLink punya vocabulary historis yang berbeda. Ia berbicara tentang:

- `Session`
- `ServerSession`
- `ClientSession`
- `UnitOfWork`
- descriptors
- identity map
- shared cache
- isolated cache

Dalam EclipseLink, `UnitOfWork` adalah konsep penting untuk tracking perubahan object. Dokumentasi EclipseLink API menyebut active session dalam transaction sebagai active `UnitOfWork`.

Mapping mental:

```text
JPA EntityManager ≈ EclipseLink JpaEntityManager facade
Persistence Context ≈ UnitOfWork-level managed state
EclipseLink shared cache ≠ persistence context
IdentityMap ≈ object identity/cache infrastructure
```

Perbedaan penting:

- Hibernate cenderung menjelaskan persistence context lewat `Session`.
- EclipseLink sering menjelaskan state management lewat `UnitOfWork`, descriptors, dan identity map.
- Keduanya memenuhi kontrak JPA, tetapi internal model dan optimization path berbeda.

---

## 4. Lifecycle: Dari Entity Load sampai Flush

### 4.1 Basic flow

Contoh:

```java
@Transactional
public void submitCase(Long caseId) {
    CaseFile caseFile = entityManager.find(CaseFile.class, caseId);
    caseFile.submit();
}
```

Secara konseptual:

```text
1. Transaction starts
2. EntityManager/persistence context active
3. find(CaseFile, caseId)
4. Provider checks first-level cache
5. If missing, provider queries database
6. Row hydrated into CaseFile object
7. Object registered as managed
8. Snapshot captured
9. Application mutates object
10. Flush happens before commit
11. Provider compares current state vs snapshot
12. SQL UPDATE generated
13. Commit completes
14. Persistence context closes
15. caseFile becomes detached
```

Yang sering tidak disadari:

```java
caseFile.submit();
```

baris ini sendiri tidak menjalankan SQL.

SQL biasanya terjadi saat:

- flush before commit;
- flush before query;
- explicit `em.flush()`;
- provider-specific trigger.

---

### 4.2 First-level cache lookup

Contoh:

```java
CaseFile a = em.find(CaseFile.class, 100L);
CaseFile b = em.find(CaseFile.class, 100L);

System.out.println(a == b); // true within same persistence context
```

Dalam satu persistence context:

```text
(CaseFile, 100) -> Java object instance #A
```

Saat lookup kedua:

```text
Provider checks identity map
    found -> return same object
    no SQL required
```

Ini bukan hanya optimization. Ini correctness invariant.

Kalau provider mengembalikan dua object berbeda untuk row yang sama dalam satu persistence context, maka perubahan object mana yang harus menang?

```java
CaseFile a = em.find(CaseFile.class, 100L);
CaseFile b = em.find(CaseFile.class, 100L);

a.setStatus(APPROVED);
b.setStatus(REJECTED);
```

Jika `a` dan `b` berbeda object, persistence context akan ambigu. Karena itu identity map menjaga:

```text
same entity type + same primary key + same persistence context = same Java object instance
```

---

### 4.3 Query result juga memakai persistence context

Contoh:

```java
CaseFile a = em.find(CaseFile.class, 100L);

List<CaseFile> results = em.createQuery("""
    select c from CaseFile c
    where c.id = :id
""", CaseFile.class)
.setParameter("id", 100L)
.getResultList();

CaseFile b = results.get(0);

System.out.println(a == b); // true
```

Query boleh hit database untuk menemukan row, tetapi ketika row itu sudah ada di persistence context, provider harus mengembalikan managed instance yang sama.

Konsekuensi penting:

- query bukan selalu berarti object state diganti dari database;
- jika entity sudah managed dan stale, query bisa tetap mengembalikan object stale;
- untuk memaksa reload, gunakan `refresh()`, clear persistence context, atau query hint/provider-specific refresh.

---

## 5. Persistence Context as Identity Map

### 5.1 Identity map invariant

Invariant utama:

```text
Within one persistence context:
(entity class, primary key) uniquely identifies one managed object instance.
```

Contoh:

```java
CaseFile c1 = em.find(CaseFile.class, 1L);
CaseFile c2 = em.getReference(CaseFile.class, 1L);
CaseFile c3 = em.createQuery("select c from CaseFile c where c.id = 1", CaseFile.class)
                .getSingleResult();

assert c1 == c2;
assert c2 == c3;
```

Provider mungkin memakai proxy, subclass, enhanced class, atau wrapper, tetapi secara persistence identity, object harus konsisten.

---

### 5.2 Identity map bukan equals/hashCode

Persistence context tidak bergantung pada `equals()` Anda untuk melacak entity. Ia memakai entity key internal:

```text
EntityKey = entityName + identifier + tenant/discriminator context if relevant
```

Tetapi `equals/hashCode` tetap penting untuk Java collection dan domain logic.

Bug umum:

```java
Set<CaseFile> set = new HashSet<>();

CaseFile c = new CaseFile();
set.add(c);

em.persist(c); // ID assigned after persist/flush

set.contains(c); // may be false if hashCode changed
```

Persistence context masih tahu entity itu managed, tetapi Java `HashSet` bisa rusak.

Rule:

```text
Persistence context identity ≠ Java collection equality
```

---

### 5.3 Same row in different persistence contexts

Contoh:

```java
EntityManager em1 = emf.createEntityManager();
EntityManager em2 = emf.createEntityManager();

CaseFile a = em1.find(CaseFile.class, 100L);
CaseFile b = em2.find(CaseFile.class, 100L);

System.out.println(a == b); // false
System.out.println(a.getId().equals(b.getId())); // true
```

Dua persistence context berbeda berarti dua identity map berbeda.

Ini penting untuk:

- concurrent requests;
- background jobs;
- tests;
- async processing;
- detached entity handling;
- second-level cache behavior.

---

## 6. Persistence Context as Unit of Work

### 6.1 Unit of Work pattern

Unit of Work adalah pattern dari enterprise application architecture: kumpulkan perubahan selama business transaction, lalu commit sebagai satu unit.

Dalam ORM:

```text
Begin transaction
    load objects
    mutate objects
    create objects
    delete objects
    evaluate business rules
Flush
Commit
```

Application code bekerja dengan object:

```java
caseFile.assignTo(officer);
caseFile.addTimeline("Assigned to officer");
caseFile.markPendingReview();
```

Provider nanti menyusun database work:

```sql
UPDATE case_file SET assigned_officer_id = ?, status = ?, version = ? WHERE id = ? AND version = ?;
INSERT INTO case_timeline (...);
```

---

### 6.2 Write-behind

Write-behind berarti perubahan object ditahan dulu di persistence context, lalu dikirim ke database saat flush.

Contoh:

```java
CaseFile c = em.find(CaseFile.class, 1L);
c.setStatus(Status.UNDER_REVIEW);

// no SQL update yet, usually

c.setPriority(Priority.HIGH);

// still no SQL update yet, usually

em.flush();
// now provider sends UPDATE
```

Manfaat:

- provider bisa menggabungkan beberapa perubahan menjadi satu update;
- SQL bisa diurutkan agar constraint aman;
- batching lebih mungkin;
- business method bisa bekerja dengan object tanpa micro-managing SQL.

Risiko:

- error constraint muncul terlambat;
- developer salah mengira database sudah berubah;
- query bisa trigger flush di tengah method;
- side effect eksternal bisa terjadi sebelum DB write benar-benar berhasil.

---

### 6.3 Unit of work bukan transaction saja

Persistence context dan database transaction sering berjalan bersama, tetapi bukan hal yang sama.

```text
Database transaction:
    ACID boundary at DB connection/resource level

Persistence context:
    managed object state boundary at ORM level
```

Mereka biasanya align:

```text
@Transactional method
    one DB transaction
    one persistence context
```

Tetapi bisa tidak align:

- extended persistence context across multiple transactions;
- application-managed `EntityManager` hidup lebih lama dari transaction;
- unsynchronized persistence context;
- Open Session in View;
- manual transaction management;
- nested service calls dengan propagation berbeda.

Rule:

```text
Transaction answers: when does DB commit/rollback?
Persistence context answers: which objects are tracked and synchronized?
```

---

## 7. Managed State and Snapshot

### 7.1 Managed entity

Entity disebut managed jika:

- berada dalam persistence context;
- provider melacak lifecycle dan state-nya;
- perubahan field dapat terdeteksi saat flush;
- lazy association/basic field masih bisa di-load selama context valid;
- identity-nya terdaftar di first-level cache.

Cara umum menjadi managed:

```java
em.find(CaseFile.class, id);      // loaded managed
em.persist(newCaseFile);          // new entity becomes managed
em.merge(detachedCaseFile);       // returns managed copy
query.getResultList();            // returned entities are managed
em.getReference(CaseFile.class,id); // proxy/reference managed
```

---

### 7.2 Snapshot-based dirty checking

Provider perlu tahu apakah entity berubah.

Model umum:

```text
Load entity from DB:
    current object state = {status=DRAFT, priority=NORMAL}
    snapshot stored      = {status=DRAFT, priority=NORMAL}

Application mutates:
    current object state = {status=SUBMITTED, priority=HIGH}
    snapshot remains     = {status=DRAFT, priority=NORMAL}

Flush:
    compare current vs snapshot
    detect dirty fields: status, priority
    generate UPDATE
```

Pseudo-internal:

```text
PersistenceContext
  EntityEntry(CaseFile#100)
    status: MANAGED
    loadedState: [DRAFT, NORMAL, ...]
    currentState: read from object at flush
```

Bytecode enhancement can optimize this by tracking dirty attributes as they are modified, but conceptually provider still needs a way to know what changed.

---

### 7.3 Snapshot cost

Persistence context has cost proportional to:

```text
number of managed entities
× number of persistent attributes
× complexity of collection/association state
```

If one transaction loads 50,000 entities, provider may hold:

- 50,000 entity instances;
- 50,000 snapshots;
- collection wrappers;
- association references;
- action queue entries;
- metadata entries.

That is why batch processing must not keep one persistence context forever.

Bad:

```java
@Transactional
public void processAll() {
    List<CaseFile> cases = em.createQuery("select c from CaseFile c", CaseFile.class)
                             .getResultList();

    for (CaseFile c : cases) {
        c.recalculateRiskScore();
    }
}
```

Better:

```java
public void processAllInChunks() {
    int page = 0;
    int size = 500;

    while (true) {
        List<Long> ids = loadNextIds(page, size);
        if (ids.isEmpty()) break;

        processChunk(ids);
        page++;
    }
}

@Transactional
public void processChunk(List<Long> ids) {
    List<CaseFile> cases = em.createQuery("""
        select c from CaseFile c
        where c.id in :ids
    """, CaseFile.class)
    .setParameter("ids", ids)
    .getResultList();

    for (CaseFile c : cases) {
        c.recalculateRiskScore();
    }
}
```

Alternative inside one transaction, with care:

```java
int count = 0;
for (CaseFile c : stream) {
    c.recalculateRiskScore();

    if (++count % 500 == 0) {
        em.flush();
        em.clear();
    }
}
```

But after `clear()`, all entities become detached. You must not continue mutating old references expecting automatic persistence.

---

## 8. First-Level Cache Behavior

### 8.1 What first-level cache does

First-level cache ensures:

1. identity consistency;
2. reduced duplicate database reads;
3. repeatable object access within one context;
4. basis for dirty checking;
5. association resolution;
6. lifecycle coordination.

Example:

```java
CaseFile c1 = em.find(CaseFile.class, 10L); // SQL SELECT
CaseFile c2 = em.find(CaseFile.class, 10L); // no SQL usually
```

---

### 8.2 What first-level cache does not do

It does not guarantee:

- data is globally fresh;
- another transaction’s committed changes are visible automatically;
- memory remains small;
- query result set is cached like a query cache;
- object is safe to use after context closes;
- detached object will auto-save changes.

Important distinction:

```text
First-level cache = per persistence context, mandatory behavior
Second-level cache = provider-level/shared optional cache
Query cache = provider-specific optional cache of query result keys
```

---

### 8.3 Stale state example

Transaction A:

```java
CaseFile c = em.find(CaseFile.class, 1L); // status = DRAFT
```

Transaction B commits:

```sql
UPDATE case_file SET status = 'SUBMITTED' WHERE id = 1;
```

Transaction A later:

```java
CaseFile again = em.find(CaseFile.class, 1L);
System.out.println(again.getStatus()); // may still be DRAFT
```

Because within the same persistence context, provider returns existing managed object.

To reload:

```java
em.refresh(c);
```

or:

```java
em.clear();
CaseFile fresh = em.find(CaseFile.class, 1L);
```

But `clear()` detaches all managed entities.

---

## 9. Clear, Detach, Refresh, Contains

### 9.1 `contains()`

```java
boolean managed = em.contains(caseFile);
```

Returns whether entity instance is currently managed by this persistence context.

Useful for debugging boundary issues:

```java
if (!em.contains(caseFile)) {
    throw new IllegalStateException("CaseFile is detached");
}
```

But do not overuse in business logic. If your code often needs to ask “is this managed?”, boundary design may already be unclear.

---

### 9.2 `detach(entity)`

```java
CaseFile c = em.find(CaseFile.class, 1L);
em.detach(c);

c.setStatus(Status.APPROVED); // not tracked
```

`detach()` removes one entity from persistence context.

Use cases:

- prevent accidental update;
- reduce memory for one object graph;
- isolate read-only object;
- avoid serialization triggering lazy load;
- advanced boundary control.

Risks:

- detached object changes are not flushed;
- lazy associations may fail if accessed later;
- merging later can overwrite state unexpectedly.

---

### 9.3 `clear()`

```java
em.clear();
```

Clears entire persistence context.

All managed entities become detached.

Use cases:

- batch processing;
- avoid stale state;
- recover from bulk update/delete;
- release memory;
- force next lookup to hit database.

Danger:

```java
CaseFile c = em.find(CaseFile.class, 1L);
em.clear();
c.setStatus(APPROVED);
// no update, because c is detached
```

---

### 9.4 `refresh(entity)`

```java
CaseFile c = em.find(CaseFile.class, 1L);
em.refresh(c);
```

`refresh()` reloads entity state from database and overwrites local changes.

Danger:

```java
CaseFile c = em.find(CaseFile.class, 1L);
c.setStatus(APPROVED);

em.refresh(c); // local change lost
```

Use cases:

- database trigger/generated columns;
- external process changed row;
- pessimistic lock reload;
- recover from stale first-level state;
- after native SQL update.

Rule:

```text
refresh() is destructive to unflushed local state.
```

---

## 10. Open Session in View / Open EntityManager in View

### 10.1 What OSIV does

Open Session in View keeps persistence context open beyond service transaction, often until web response rendering finishes.

Typical flow:

```text
HTTP request starts
    EntityManager/Session opened
Service transaction starts
    load entity
Service transaction commits
Controller/view/serializer still has open session
    lazy association can load
HTTP response ends
    session closes
```

It solves one symptom:

```text
LazyInitializationException during JSON serialization/view rendering
```

But it introduces hidden costs.

---

### 10.2 Why OSIV is dangerous in backend APIs

Problem 1: hidden queries outside service boundary.

```java
@GetMapping("/cases/{id}")
public CaseFile getCase(@PathVariable Long id) {
    return caseService.getCase(id);
}
```

Serializer accesses:

```java
caseFile.getTasks()
caseFile.getDocuments()
caseFile.getAssignedOfficer()
caseFile.getAuditEntries()
```

If OSIV is enabled, these accesses may trigger SQL after service method completed.

The service method no longer fully defines database work.

Problem 2: transaction already committed.

Lazy loads after commit may run in auto-commit mode or separate transactions depending stack/provider/framework.

Problem 3: performance becomes API-shape-dependent.

Adding one field to JSON can add many SQL queries.

Problem 4: boundary is misleading.

Service method looks cheap, response rendering is expensive.

Problem 5: accidental data exposure.

Lazy association that should not be exposed may be serialized.

---

### 10.3 Better alternatives

Prefer explicit read models:

```java
public CaseDetailDto getCaseDetail(Long id) {
    CaseFile c = caseRepository.findCaseDetail(id);
    return mapper.toDetailDto(c);
}
```

Use one of:

- DTO projection;
- fetch join intentionally;
- entity graph intentionally;
- query model/read model;
- separate endpoint for heavy subresources;
- pagination for collections;
- explicit service transaction boundary.

Principle:

```text
The service/query layer should own the fetch plan.
The serializer/view layer should not accidentally design database access.
```

---

## 11. Extended Persistence Context

### 11.1 When it makes sense

Extended persistence context can make sense when an application has true conversational state:

```text
User opens wizard
    step 1 edits applicant
    step 2 edits address
    step 3 edits documents
    step 4 confirms
Final submit persists all changes
```

In old-style stateful Jakarta EE applications, this could map to stateful session beans.

---

### 11.2 Why it is risky

Long-lived persistence context accumulates managed entities.

Risks:

- stale data;
- memory growth;
- conflict detection delayed;
- hidden dirty changes from earlier step;
- rollback semantics confusing;
- serialization/session replication cost;
- difficulty debugging.

Example:

```text
Step 1: User loads Case #100, status=DRAFT
Step 2: Another officer submits Case #100
Step 3: User still sees DRAFT in extended PC
Step 4: User saves old object state
```

Without optimistic locking and careful refresh strategy, extended PC can produce stale overwrite.

---

### 11.3 Modern recommendation

For web APIs and microservices:

```text
Prefer short-lived transaction-scoped persistence contexts.
Represent conversation state explicitly in database or client-side draft model.
Use optimistic locking to protect updates.
Use command DTOs instead of holding managed entity across requests.
```

Extended PC is not wrong, but it is a deliberate architectural decision, not a default convenience.

---

## 12. Read-Your-Writes and Query Interaction

### 12.1 Read-your-writes inside persistence context

Example:

```java
CaseFile c = em.find(CaseFile.class, 1L);
c.setStatus(Status.SUBMITTED);

CaseFile again = em.find(CaseFile.class, 1L);
System.out.println(again.getStatus()); // SUBMITTED
```

This works even before flush because both references point to the same managed object.

---

### 12.2 Query may flush first

Example:

```java
CaseFile c = em.find(CaseFile.class, 1L);
c.setReferenceNo("ABC-001");

Long count = em.createQuery("""
    select count(c) from CaseFile c
    where c.referenceNo = :ref
""", Long.class)
.setParameter("ref", "ABC-001")
.getSingleResult();
```

Provider may flush before query so that query result sees pending changes.

This is correct but surprising.

Consequence:

- constraint violation can happen during query;
- update SQL can happen in read-looking method;
- slow flush can be attributed to unrelated query;
- test may fail earlier than commit.

Flush behavior depends on flush mode and provider rules, but AUTO flush before relevant queries is common.

---

## 13. Persistence Context and Lazy Loading

### 13.1 Lazy loading needs context

Lazy association often needs an active persistence context.

```java
CaseFile c = caseService.findCase(id);

// outside transaction/context
c.getDocuments().size(); // may throw LazyInitializationException in Hibernate
```

Why?

The lazy collection is not just a normal list. It is a provider wrapper that knows:

- owner entity;
- association metadata;
- persistence context/session;
- initialization status;
- query needed to load data.

If context is closed, the wrapper no longer has a valid channel to database.

---

### 13.2 Lazy loading is not merely loading later

Lazy loading is a deferred database operation tied to a live persistence context.

That means:

```text
lazy = database access capability postponed
not lazy = pure in-memory placeholder
```

Design implication:

```text
Never let arbitrary outer layers decide when lazy loading occurs.
```

Lazy loading should be triggered deliberately inside service/query boundary, or avoided by DTO projection/read model.

---

## 14. Persistence Context Memory Model

### 14.1 What occupies memory

A managed entity costs more than its Java object fields.

For each managed entity, provider may hold:

- entity instance;
- entity key;
- loaded snapshot;
- status entry;
- lock mode/version info;
- dirty flags;
- collection entries;
- proxy references;
- loaded association state;
- pending actions.

For large collection:

- collection wrapper;
- collection snapshot;
- element keys;
- orphan detection structure;
- queued collection actions.

---

### 14.2 Memory leak pattern in batch jobs

Bad pattern:

```java
@Transactional
public void migrate() {
    for (int i = 0; i < 1_000_000; i++) {
        LegacyRecord r = load(i);
        NewEntity e = transform(r);
        em.persist(e);
    }
}
```

Even if JDBC batching is enabled, persistence context keeps every persisted entity managed until clear/transaction end.

Better:

```java
@Transactional
public void migrateChunk(List<LegacyRecord> records) {
    int i = 0;
    for (LegacyRecord r : records) {
        NewEntity e = transform(r);
        em.persist(e);

        if (++i % 500 == 0) {
            em.flush();
            em.clear();
        }
    }
}
```

But be careful:

- after `clear()`, all references are detached;
- cascades may not continue as expected;
- parent-child relationships across chunks need explicit design;
- generated IDs may need to be captured before clear;
- errors become harder to map to individual record unless logged.

---

## 15. Persistence Context and Native SQL / Bulk Update

### 15.1 Native SQL can bypass managed state

Example:

```java
CaseFile c = em.find(CaseFile.class, 1L);

em.createNativeQuery("""
    update case_file
    set status = 'CLOSED'
    where id = 1
""").executeUpdate();

System.out.println(c.getStatus()); // may still be old value
```

The database row changed, but managed object did not automatically update.

Fix options:

```java
em.refresh(c);
```

or:

```java
em.clear();
CaseFile fresh = em.find(CaseFile.class, 1L);
```

---

### 15.2 JPQL bulk update also bypasses entity state

Example:

```java
CaseFile c = em.find(CaseFile.class, 1L);

em.createQuery("""
    update CaseFile c
    set c.status = :closed
    where c.id = :id
""")
.setParameter("closed", Status.CLOSED)
.setParameter("id", 1L)
.executeUpdate();

System.out.println(c.getStatus()); // may still be old value
```

Bulk operations operate directly on database rows. They do not mutate each managed Java object one by one.

Rule:

```text
After bulk update/delete, clear or refresh affected managed entities.
```

---

## 16. Hibernate Behavior Deep Dive

### 16.1 Session as Unit of Work

Hibernate `Session` is short-lived and single-threaded. Its persistence context provides first-level cache and generally repeatable-read-like object access for loaded domain model objects within that session.

Important internal pieces:

```text
Session
  ├── PersistenceContext
  │     ├── entitiesByKey
  │     ├── entityEntries
  │     ├── collectionsByKey
  │     └── collectionEntries
  ├── ActionQueue
  │     ├── insertions
  │     ├── updates
  │     ├── deletions
  │     └── collection actions
  └── JDBC coordinator / transaction coordinator
```

---

### 16.2 Hibernate first-level cache

Hibernate first-level cache is always associated with a `Session`/`EntityManager`.

It contains managed entities. It is not optional in normal Hibernate ORM operation.

Example:

```java
Session session = entityManager.unwrap(Session.class);
CaseFile c = session.find(CaseFile.class, 1L);
```

Same persistence context rules apply.

---

### 16.3 Hibernate ActionQueue

Hibernate queues work before flush:

```java
em.persist(newCase);
existingCase.setStatus(APPROVED);
em.remove(oldCase);
```

Internally this may become:

```text
ActionQueue
  insert: newCase
  update: existingCase
  delete: oldCase
```

At flush, Hibernate orders actions according to rules involving:

- entity dependencies;
- cascades;
- collection changes;
- batching settings;
- foreign key constraints;
- insert/update ordering configuration.

This explains why SQL order may not match Java method order.

---

### 16.4 Hibernate repeatable object read, not necessarily DB isolation repeatable read

Hibernate first-level cache can make it feel like repeatable read:

```java
CaseFile c1 = em.find(CaseFile.class, 1L);
CaseFile c2 = em.find(CaseFile.class, 1L);
// same state because same object
```

But this is not the same as database isolation level `REPEATABLE READ`.

If you clear the persistence context, use native query, refresh, or open another transaction, database isolation rules matter again.

Rule:

```text
Persistence context repeatability is object identity repeatability.
Database repeatability is isolation-level behavior.
Do not confuse them.
```

---

## 17. EclipseLink Behavior Deep Dive

### 17.1 UnitOfWork concept

EclipseLink’s historical core abstraction is `UnitOfWork`.

It tracks object changes and commits them to the database. Under JPA, this is exposed through `EntityManager`, but understanding `UnitOfWork` helps explain provider-specific behavior.

Conceptual flow:

```text
Read object through session
Register/clone object in UnitOfWork
Track changes
Commit UnitOfWork
Merge changes into cache/database
```

---

### 17.2 EclipseLink cache layers

EclipseLink has strong cache concepts:

```text
Persistence context / UnitOfWork cache
    per EntityManager / active unit of work

Shared/session cache
    broader provider-level cache
```

Do not confuse EclipseLink shared cache with JPA first-level cache.

The first-level context is about active managed state. Shared cache is broader and can survive beyond one persistence context.

---

### 17.3 EclipseLink weaving and change tracking

EclipseLink can use weaving to enhance entity classes for:

- lazy loading;
- change tracking;
- fetch groups;
- internal optimization.

If weaving is disabled or not applied, behavior/performance may differ.

Typical production issue:

```text
Works in app server with dynamic weaving
Fails or behaves differently in unit test without weaving
```

This is why provider enhancement/weaving must be treated as part of runtime architecture, not a minor build detail.

---

## 18. Scope Design Patterns

### 18.1 One transaction, one persistence context

Most service methods should follow:

```text
API request
  -> service method
       -> transaction starts
       -> persistence context active
       -> load/mutate/query
       -> flush/commit
       -> persistence context closes
  -> map to response DTO
```

In Spring-like service:

```java
@Transactional
public CaseDetailDto approve(Long caseId, ApproveCommand command) {
    CaseFile c = caseRepository.getRequired(caseId);
    c.approve(command.officerId(), command.reason());
    return mapper.toDetailDto(c);
}
```

Mapping to DTO happens inside transaction if lazy data needed. Or query should already fetch necessary data.

---

### 18.2 Read-only query service

```java
@Transactional(readOnly = true)
public CaseDetailDto getDetail(Long id) {
    return caseQueries.findDetailDto(id);
}
```

But beware:

- `readOnly=true` is framework/provider optimization hint, not absolute guarantee in all stacks;
- if you mutate managed entity inside read-only transaction, behavior may vary by provider/framework configuration;
- database may not enforce read-only unless transaction truly marked read-only at connection/database level.

Better rule:

```text
For read use cases, avoid managed entity mutation path entirely.
Use DTO projection or explicitly immutable read model.
```

---

### 18.3 Command boundary

For write use cases:

```java
@Transactional
public void changeStatus(ChangeStatusCommand command) {
    CaseFile c = em.find(CaseFile.class, command.caseId());
    c.changeStatus(command.targetStatus(), command.reason());
}
```

The command object should not be an entity.

Bad:

```java
@PostMapping("/cases")
public void update(@RequestBody CaseFile entity) {
    caseService.save(entity);
}
```

This invites:

- detached graph merge bug;
- mass assignment vulnerability;
- null overwrite;
- collection replacement;
- cascade explosion;
- version conflict mishandling.

---

## 19. Failure Modes

### 19.1 Stale managed entity

Symptom:

- query returns old value even though database changed.

Root cause:

- entity already exists in persistence context;
- provider returns same managed object;
- no refresh/clear.

Fix:

- shorten transaction/context;
- use `refresh()`;
- clear after external/native/bulk update;
- use optimistic locking;
- avoid long-lived persistence context.

---

### 19.2 Accidental update

Symptom:

- database row updated even though repository `save()` was not called.

Root cause:

- managed entity mutated;
- dirty checking flushed changes automatically.

Example:

```java
@Transactional
public void viewCase(Long id) {
    CaseFile c = em.find(CaseFile.class, id);
    c.setLastViewedAt(Instant.now()); // this will be persisted
}
```

Fix:

- avoid mutating managed entity in read path;
- map to DTO;
- detach read-only entity if needed;
- provider read-only hint/session mode;
- separate command and query models.

---

### 19.3 Memory bloat in batch job

Symptom:

- heap grows during long import/update;
- GC pressure;
- OOM;
- flush becomes slower over time.

Root cause:

- persistence context retains all managed entities and snapshots.

Fix:

- chunk transactions;
- periodic `flush()` + `clear()`;
- use stateless session/provider bulk operation where suitable;
- process IDs instead of entire entity graph;
- avoid loading huge collections.

---

### 19.4 LazyInitializationException

Symptom:

- accessing lazy association outside session/context fails.

Root cause:

- persistence context closed;
- lazy wrapper/proxy cannot load data.

Bad fix:

- enable OSIV globally without understanding consequences.

Better fix:

- define fetch plan;
- DTO projection;
- fetch join/entity graph;
- service method maps required data inside transaction;
- redesign API boundaries.

---

### 19.5 Hidden query storm

Symptom:

- endpoint seems simple but executes hundreds/thousands of SQL queries.

Root cause:

- lazy loading triggered in loop or serializer;
- OSIV hides boundary;
- fetch plan absent.

Fix:

- SQL count tests;
- fetch plan engineering;
- batch fetch/subselect/entity graph;
- DTO projection;
- disable OSIV for API services.

---

### 19.6 Bulk update mismatch

Symptom:

- bulk update succeeds, but application still returns old data in same transaction.

Root cause:

- bulk update bypasses managed entity state.

Fix:

- `em.clear()` after bulk update;
- `em.refresh(entity)` for specific object;
- avoid mixing entity mutation and bulk SQL in same context;
- isolate bulk operation in separate transaction.

---

### 19.7 Detached object mistaken as managed

Symptom:

- code mutates object but no update occurs.

Root cause:

- entity is detached after transaction/context closed.

Example:

```java
CaseFile c = service.loadCase(id); // returns detached entity
c.setStatus(APPROVED);            // no persistence context tracking
```

Fix:

- perform mutation inside transaction;
- use command method;
- re-load managed entity by ID;
- avoid returning entity for later mutation.

---

## 20. Diagnostic Checklist

When debugging persistence context issues, ask:

### Scope

- Where is the `EntityManager`/`Session` opened?
- Where is it closed?
- Is it transaction-scoped, extended, application-managed, or OSIV?
- Is there one persistence context or multiple?

### Managed state

- Is this entity managed now?
- Was it loaded in this transaction or passed from outside?
- Was `clear()` or `detach()` called?
- Was it returned from `merge()` or is it the detached argument?

### Flush

- Did SQL execute at commit or before query?
- Is flush mode AUTO/COMMIT/MANUAL/provider-specific?
- Is a read query triggering flush?
- Is constraint violation happening before commit?

### Stale data

- Was row updated by another transaction?
- Was native/bulk SQL used?
- Is first-level cache returning existing object?
- Is second-level/shared cache involved?
- Was `refresh()` needed?

### Memory

- How many entities are managed?
- How many collections are initialized?
- Is this a long transaction?
- Does batch job call `flush()`/`clear()`?
- Are snapshots accumulating?

### Lazy loading

- Is lazy access happening inside transaction?
- Is serializer triggering lazy loads?
- Is OSIV enabled?
- Is fetch plan explicit?

---

## 21. Design Rules

### Rule 1 — Treat persistence context as a boundary

Bad mental model:

```text
Entity is just a POJO with annotations.
```

Better mental model:

```text
Managed entity is a live object attached to a persistence context.
```

That means mutating it has persistence consequences.

---

### Rule 2 — Do not let entity escape as write model

Do not let API/controller/client mutate detached entity later.

Prefer:

```text
Controller receives command DTO
Service loads managed aggregate
Domain method mutates aggregate
Transaction commits
Response DTO returned
```

---

### Rule 3 — Keep persistence context short for request/response systems

Default recommendation:

```text
one service transaction = one persistence context = one clear unit of work
```

Long-lived context requires explicit reason.

---

### Rule 4 — Clear deliberately in batch jobs

If processing many rows:

```text
flush periodically
clear periodically
or split into chunked transactions
```

---

### Rule 5 — After bulk/native update, distrust managed state

```text
native SQL / JPQL bulk update bypasses object state
```

Then:

```text
refresh affected entities or clear context
```

---

### Rule 6 — Fetch plan belongs to query/service layer

Do not let view/serializer accidentally load graph.

```text
Explicit query shape beats accidental lazy traversal.
```

---

### Rule 7 — Debug with identity and scope first

When ORM behavior seems “magic”, ask:

```text
Which persistence context owns this object?
Is the object managed or detached?
When will flush happen?
What is already in first-level cache?
```

These questions solve many ORM mysteries.

---

## 22. Anti-Patterns

### 22.1 Repository returns entity for later mutation

Bad:

```java
CaseFile c = caseRepository.find(id);
// transaction ended
c.approve();
caseRepository.save(c);
```

Better:

```java
@Transactional
public void approve(Long id) {
    CaseFile c = caseRepository.getRequired(id);
    c.approve();
}
```

---

### 22.2 JSON serialization of entity graph

Bad:

```java
return caseRepository.findById(id).orElseThrow();
```

Risk:

- lazy loading storm;
- circular reference;
- accidental data exposure;
- dependency on OSIV;
- unstable API response.

Better:

```java
return caseQueryService.getCaseDetailDto(id);
```

---

### 22.3 One giant transaction for import

Bad:

```java
@Transactional
public void importAll(List<Record> records) {
    records.forEach(r -> em.persist(map(r)));
}
```

Better:

```text
chunk input
transaction per chunk
flush/clear inside chunk when needed
record progress
support retry/idempotency
```

---

### 22.4 Mixing bulk SQL and managed entity without clear/refresh

Bad:

```java
CaseFile c = em.find(CaseFile.class, id);
bulkCloseCase(id);
return c.getStatus(); // stale
```

Better:

```java
bulkCloseCase(id);
em.clear();
return em.find(CaseFile.class, id).getStatus();
```

or isolate bulk operation separately.

---

### 22.5 Using OSIV as architecture

OSIV can be a tactical convenience, but if the architecture relies on it, database access boundary becomes invisible.

Better:

```text
explicit fetch plan
explicit DTO
explicit transaction boundary
observable SQL count
```

---

## 23. Practice Scenarios

### Scenario 1 — Stale state after native SQL

Code:

```java
@Transactional
public CaseDto closeAndReturn(Long id) {
    CaseFile c = em.find(CaseFile.class, id);

    em.createNativeQuery("update case_file set status='CLOSED' where id=?")
      .setParameter(1, id)
      .executeUpdate();

    return mapper.toDto(c);
}
```

Question:

- Why might DTO still show old status?
- What are two safe fixes?

Expected reasoning:

- `c` is already managed in first-level cache.
- Native SQL changed DB row but not Java object.
- Use `em.refresh(c)` or `em.clear()` and reload.
- Better: do not mix native bulk update and managed entity read in same context unless deliberate.

---

### Scenario 2 — Accidental update in read method

Code:

```java
@Transactional(readOnly = true)
public CaseDto get(Long id) {
    CaseFile c = em.find(CaseFile.class, id);
    c.normalizeDisplayName();
    return mapper.toDto(c);
}
```

Question:

- Can this update database?
- Why is this dangerous?

Expected reasoning:

- If entity is managed and provider/framework still flushes dirty state, mutation may persist.
- `readOnly=true` is not a domain guarantee.
- Do normalization in DTO mapping or query projection, not by mutating entity.

---

### Scenario 3 — Batch OOM

Code:

```java
@Transactional
public void recalculate() {
    List<CaseFile> all = em.createQuery("select c from CaseFile c", CaseFile.class)
                           .getResultList();
    all.forEach(CaseFile::recalculate);
}
```

Question:

- Why does memory grow?
- How would you redesign?

Expected reasoning:

- all entities and snapshots stay managed.
- use chunked IDs;
- transaction per chunk;
- periodic flush/clear;
- projection/bulk update if possible.

---

### Scenario 4 — Lazy load after service

Code:

```java
public CaseFile getCase(Long id) {
    return txTemplate.execute(tx -> em.find(CaseFile.class, id));
}

CaseFile c = service.getCase(id);
c.getDocuments().size();
```

Question:

- Why can this fail?
- What is the better design?

Expected reasoning:

- returned entity is detached after transaction.
- lazy collection cannot initialize.
- service should return DTO with documents loaded intentionally, or expose separate document query.

---

## 24. Java 8–25 Compatibility Notes

### 24.1 Java 8 legacy stack

Typical stack:

```text
Java 8
JPA 2.1/2.2
javax.persistence.*
Hibernate 5.x or EclipseLink 2.x
Java EE / Spring Framework / Spring Boot 2.x era
```

Key concerns:

- `javax.persistence` package;
- older Hibernate type system;
- older bytecode enhancement tooling;
- older app server integration;
- Java Time support depends on JPA/provider version;
- limited module system concerns because Java 8 has no JPMS.

---

### 24.2 Java 11/17/21/25 modern stack

Typical stack:

```text
Java 11/17/21/25
Jakarta Persistence 3.x
jakarta.persistence.*
Hibernate 6/7 or EclipseLink 3/4
Jakarta EE 10/11 or Spring Boot 3.x era
```

Key concerns:

- namespace migration from `javax` to `jakarta`;
- stronger encapsulation/module path issues;
- bytecode enhancement/weaving with newer JDKs;
- records are useful for DTOs, not JPA entities in the normal mutable managed-entity model;
- virtual threads may affect request concurrency but do not make `EntityManager` thread-safe;
- modern GC can help memory pressure but cannot fix huge persistence context design.

---

### 24.3 EntityManager is still not thread-safe

Even with Java 21/25 virtual threads:

```text
Do not share one EntityManager across concurrent threads.
```

Persistence context contains mutable internal state. Treat it as single-unit-of-work state.

Bad:

```java
parallelStream.forEach(item -> {
    em.persist(map(item)); // unsafe shared EntityManager
});
```

Better:

```text
partition work
separate transaction/entity manager per worker
or use bulk database operation
or use queue/job chunking
```

---

## 25. Summary

Persistence context is the heart of JPA provider behavior.

It is:

- identity map;
- first-level cache;
- unit of work;
- dirty checking scope;
- write-behind buffer;
- lazy loading boundary;
- object consistency boundary;
- memory pressure source.

The most important mental shift:

```text
A managed entity is not just a Java object.
It is a tracked object inside a persistence context.
```

Therefore:

- mutating it can update the database;
- loading it twice can return the same object;
- querying can return stale managed state;
- flush can happen before commit;
- native/bulk SQL can desynchronize object and database state;
- long-lived context can become memory and correctness risk;
- lazy loading requires a live boundary;
- batch jobs must control context size.

If Part 3 taught identity, Part 4 teaches the **scope that makes identity meaningful**.

The next part goes deeper into **dirty checking internals and change detection strategies**, because after understanding what persistence context holds, we need to understand how providers decide what changed.

---

## References

- Jakarta Persistence 3.2 Specification: https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Jakarta Persistence EntityManager API: https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager
- Jakarta Persistence 3.1 Specification sections on transaction-scoped and extended persistence contexts: https://jakarta.ee/specifications/persistence/3.1/jakarta-persistence-spec-3.1.html
- Hibernate ORM User Guide, stable: https://docs.hibernate.org/stable/orm/userguide/html_single/
- Hibernate ORM 5.3 User Guide, caching and first-level cache discussion: https://docs.hibernate.org/orm/5.3/userguide/html_single/
- EclipseLink 4.0 Concepts Documentation: https://eclipse.dev/eclipselink/documentation/4.0/concepts/concepts.html
- EclipseLink JPA Extensions Reference: https://eclipse.dev/eclipselink/documentation/4.0/jpa/extensions/jpa-extensions.html
- EclipseLink JpaEntityManager API: https://eclipse.dev/eclipselink/api/2.6/org/eclipse/persistence/jpa/JpaEntityManager.html
- EclipseLink Cache Concepts / historical ELUG: https://wiki.eclipse.org/Introduction_to_Cache_%28ELUG%29

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 3 — Entity Identity: Java Object Identity, Database Identity, Persistence Context Identity](./03-entity-identity-java-database-persistence-context.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 5 — Dirty Checking Internals and Change Detection](./05-dirty-checking-internals-change-detection.md)

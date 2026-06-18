# Part 0 — Orientation: ORM as State Synchronization Engine, Not Just Mapping

> Series: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `00-orientation-orm-as-state-synchronization-engine.md`  
> Scope: Java 8–25, JPA/Jakarta Persistence, Hibernate ORM, EclipseLink, enterprise-grade persistence engineering.

---

## 0. Why This Part Exists

Kebanyakan developer mengenal ORM melalui pengalaman seperti ini:

```java
@Entity
class User {
    @Id
    private Long id;

    private String name;
}
```

Lalu memakai repository:

```java
userRepository.save(user);
```

Dari luar terlihat sederhana: object disimpan ke table. Tetapi di balik itu, provider ORM seperti Hibernate ORM atau EclipseLink melakukan jauh lebih banyak hal:

- menentukan apakah object adalah object baru atau sudah ada di database;
- menjaga satu representasi object untuk satu row dalam satu persistence context;
- melakukan dirty checking;
- menunda SQL sampai flush;
- mengurutkan insert/update/delete agar foreign key tidak rusak;
- menerjemahkan JPQL/HQL/Criteria menjadi SQL spesifik database;
- memilih kapan association diload;
- mengelola proxy, bytecode enhancement, atau weaving;
- mengoordinasikan transaction dengan connection dan database;
- mengelola first-level cache dan optional second-level/shared cache;
- menerapkan optimistic/pessimistic locking;
- menyembunyikan sebagian kompleksitas relational database, tetapi juga dapat menyembunyikan failure mode.

Bagian 0 ini adalah fondasi. Tujuannya bukan menghafal anotasi, tetapi membangun mental model yang benar: **ORM adalah state synchronization engine antara object graph di memory dan relational state di database**.

Jika mental model ini salah, developer biasanya jatuh ke bug klasik:

- N+1 query;
- `LazyInitializationException`;
- update tidak tersimpan;
- update yang tidak diharapkan;
- duplicate child row;
- delete cascade tidak sengaja;
- stale data;
- lost update;
- deadlock;
- slow flush;
- memory leak dalam batch job;
- query pagination rusak karena fetch join;
- cache menampilkan data tenant lain;
- migration Hibernate 5 ke 6 gagal karena asumsi lama tidak valid.

Seri ini akan membangun kemampuan untuk memahami dan mengendalikan hal-hal tersebut.

---

## 1. Core Thesis: ORM Is Not a Mapper, It Is a State Machine Coordinator

Istilah ORM berarti Object-Relational Mapping. Nama ini benar, tetapi terlalu sempit. Dalam sistem real, provider ORM tidak hanya memetakan class ke table. Ia mengelola perubahan state.

Lebih akuratnya:

> ORM provider adalah runtime yang menjaga hubungan antara object graph Java, persistence context, transaction, SQL statement, database constraints, cache, dan lifecycle event.

Dengan kata lain, ORM adalah coordinator dari beberapa state machine sekaligus:

| Layer | State yang Dikelola |
|---|---|
| Java object | transient, managed, detached, removed |
| Persistence context | identity map, snapshots, pending actions |
| Transaction | active, rollback-only, committed, rolled back |
| Database row | inserted, updated, deleted, locked, visible/invisible by isolation |
| Association graph | initialized, uninitialized, dirty, orphaned |
| Cache | fresh, stale, invalidated, evicted |
| Query plan | parsed, compiled, parameterized, cached |

Developer top-tier tidak melihat ORM sebagai magic. Mereka melihatnya sebagai **state synchronization protocol**.

### 1.1 Mental Model Minimal

Setiap kali entity di-load, provider membuat hubungan seperti ini:

```text
Database Row
    ↓ materialization
Managed Entity Object
    ↓ registered inside
Persistence Context / Unit of Work
    ↓ detects changes
Action Queue / Change Set
    ↓ flush
SQL Statements
    ↓ execute through JDBC
Database Transaction
```

Saat code Java mengubah field:

```java
order.setStatus(OrderStatus.APPROVED);
```

Tidak selalu langsung terjadi SQL. Yang terjadi biasanya:

```text
Java object berubah
Persistence context masih menyimpan object itu
Provider membandingkan state lama dan state baru saat flush
Provider membuat SQL UPDATE
SQL dieksekusi sebelum commit atau sebelum query tertentu
Commit database mengakhiri transaction
```

Ini alasan kenapa pertanyaan seperti “kenapa belum update?” atau “kenapa tiba-tiba update?” tidak bisa dijawab hanya dari method `save()`. Kita harus melihat:

- apakah object managed?
- apakah transaction aktif?
- apakah flush terjadi?
- apakah dirty checking mendeteksi perubahan?
- apakah update dibatalkan rollback?
- apakah query membaca dari persistence context atau database?
- apakah cache menyimpan state lama?

---

## 2. Object Graph vs Relational Model: Two Different Worlds

ORM berada di antara dua dunia yang punya aturan berbeda.

### 2.1 Object World

Object world cenderung punya karakteristik:

- identity by reference (`==`);
- inheritance;
- encapsulation;
- method behavior;
- object graph traversal;
- collection semantics (`List`, `Set`, `Map`);
- lifecycle dikontrol JVM dan garbage collector;
- consistency sering dijaga oleh method domain;
- object dapat mutable dan saling mereferensikan.

Contoh:

```java
order.approve(byOfficer);
order.addHistory("Approved by officer");
order.assignNextTask(supervisor);
```

Ini terlihat natural dalam object model. Tetapi database tidak menyimpan method, object reference, atau behavior. Database menyimpan rows.

### 2.2 Relational World

Relational world punya karakteristik:

- identity by key;
- constraints;
- foreign key;
- indexes;
- normalization;
- transaction isolation;
- set-based query;
- row lock;
- join;
- query optimizer;
- physical storage;
- schema evolution.

Contoh relational:

```sql
UPDATE case_application
SET status = 'APPROVED', version = version + 1
WHERE id = ? AND version = ?;

INSERT INTO case_history(case_id, action, created_by, created_at)
VALUES (?, ?, ?, ?);

INSERT INTO task_assignment(case_id, assignee_id, task_type, status)
VALUES (?, ?, ?, ?);
```

### 2.3 The Impedance Mismatch Is Real

ORM tidak menghapus object-relational impedance mismatch. ORM hanya memberi abstraction layer untuk mengelolanya.

Perbedaan penting:

| Concern | Object Model | Relational Model |
|---|---|---|
| Identity | reference/object identity | primary key |
| Relationship | pointer/reference | foreign key/join table |
| Collection | in-memory collection | child rows or join rows |
| Inheritance | language feature | table strategy compromise |
| Mutation | field assignment | SQL update/delete/insert |
| Consistency | object method/invariant | constraints/transaction/isolation |
| Navigation | `a.getB().getC()` | join/select |
| Lifetime | GC-managed | durable storage |

A powerful ORM engineer knows which world is currently dominant.

Misalnya:

```java
caseEntity.getDocuments().size();
```

Di Java terlihat seperti operasi memory. Dalam ORM, bisa menjadi:

```sql
SELECT * FROM document WHERE case_id = ?;
```

Atau:

```sql
SELECT COUNT(*) FROM document WHERE case_id = ?;
```

Atau tidak melakukan SQL sama sekali jika collection sudah initialized. Ini tergantung provider, mapping, fetch strategy, enhancement, transaction, dan state persistence context.

---

## 3. What JPA/Jakarta Persistence Actually Is

JPA, sekarang Jakarta Persistence, adalah specification. Ia mendefinisikan API dan semantic contract umum untuk persistence dan object/relational mapping di Java SE dan Jakarta EE. Jakarta Persistence 3.2 adalah final release yang dipublikasikan pada 10 April 2024 dan mendefinisikan standard object/relational mapping facility untuk Java domain model dan relational database. Referensi resmi: Jakarta Persistence 3.2 specification.

Specification memberikan bahasa bersama:

- `EntityManager`;
- `EntityManagerFactory`;
- `PersistenceContext`;
- entity lifecycle;
- mapping annotations;
- JPQL;
- Criteria API;
- transaction integration;
- locking;
- callbacks;
- schema generation contracts;
- standard hints tertentu;
- behavior portable minimum.

Namun specification bukan implementation.

### 3.1 Specification Does Not Execute Your Query

Saat kita menulis:

```java
entityManager.find(CaseEntity.class, id);
```

JPA specification menjelaskan contract-nya, tetapi yang benar-benar melakukan pekerjaan adalah provider:

- Hibernate ORM;
- EclipseLink;
- OpenJPA;
- DataNucleus;
- provider lain.

Provider-lah yang:

- membaca metadata;
- membuat proxy;
- membangun SQL;
- mengatur cache;
- melakukan dirty checking;
- berinteraksi dengan JDBC;
- mengoptimalkan fetch;
- memproses event;
- menerapkan extension.

### 3.2 Spec-Level Knowledge Is Necessary but Not Sufficient

Spec memberi portability dan baseline correctness. Tetapi production engineering membutuhkan provider knowledge.

Contoh:

```java
@ManyToOne(fetch = FetchType.LAZY)
private Officer assignedOfficer;
```

Secara JPA, `@ManyToOne` default adalah EAGER. Kita bisa set LAZY. Tetapi apakah benar-benar lazy? Itu bergantung pada provider dan mekanisme proxy/enhancement/weaving.

Contoh lain:

```java
@OneToMany(mappedBy = "caseEntity")
private List<Document> documents;
```

JPA menjelaskan relationship. Tetapi cost model-nya bergantung pada provider:

- apakah collection berupa bag?
- apakah bisa batch fetch?
- apakah join fetch menghasilkan duplicate root?
- apakah multiple collection fetch diperbolehkan?
- apakah pagination aman?

Jadi, engineer yang kuat memisahkan tiga level:

```text
Specification: what is promised generally
Provider: how promise is implemented
Database: what actually happens physically
```

---

## 4. Provider Reality: Hibernate ORM vs EclipseLink

Seri ini fokus pada dua provider besar:

1. **Hibernate ORM**
2. **EclipseLink**

Keduanya mengimplementasikan JPA/Jakarta Persistence, tetapi punya arsitektur, default behavior, extension, dan failure mode yang berbeda.

### 4.1 Hibernate ORM

Hibernate adalah ORM paling populer di ekosistem Java enterprise dan menjadi default provider dalam banyak stack seperti Spring Boot. Situs resmi Hibernate ORM menunjukkan seri terbaru bergerak di 7.x stable/latest dan seri 8.0 sebagai development line dengan Jakarta Persistence 4.0. Hibernate 8.0 sendiri dinyatakan masih development dan fitur dapat berubah sebelum stable release.

Karakter Hibernate:

- sangat luas dipakai;
- punya extension kuat di luar JPA;
- integrasi kuat dengan Spring ecosystem;
- memiliki Session/SessionFactory sebagai native API;
- punya dirty checking, action queue, SQL AST modern;
- punya second-level cache integration;
- punya Envers, filters, interceptors, event system;
- sangat sensitif terhadap fetch plan dan mapping collection.

Hibernate sering menjadi pilihan default, tetapi bukan berarti aman tanpa pemahaman. Banyak production bug ORM di dunia Java berasal dari penggunaan Hibernate dengan mental model repository CRUD saja.

### 4.2 EclipseLink

EclipseLink adalah reference implementation historis untuk JPA dan bagian dari ekosistem Eclipse/Jakarta EE. EclipseLink 4.0 berfokus pada dukungan Jakarta EE 10 API serta Java 11 dan Java 17. EclipseLink punya konsep internal seperti Session, UnitOfWork, Descriptor, weaving, shared cache, fetch groups, dan advanced mappings.

Karakter EclipseLink:

- kuat di Jakarta EE ecosystem;
- memiliki weaving model;
- punya descriptor customization;
- mendukung advanced mapping tertentu;
- punya shared cache behavior yang perlu dipahami;
- sering muncul di application server/Jakarta EE stack;
- dapat berbeda perilaku dari Hibernate meskipun memakai anotasi JPA yang sama.

### 4.3 Same Annotation, Different Runtime Consequence

Contoh mapping:

```java
@OneToMany(mappedBy = "caseEntity", cascade = CascadeType.ALL, orphanRemoval = true)
private List<CaseDocument> documents = new ArrayList<>();
```

Di atas terlihat portable. Tetapi detail seperti:

- kapan collection dianggap dirty;
- apakah delete orphan langsung terjadi saat flush;
- bagaimana SQL ordering;
- bagaimana batch delete/insert;
- bagaimana lazy collection diinstrumentasi;
- bagaimana cache invalidation dilakukan;
- bagaimana provider menangani detached graph;

bisa berbeda.

Top-tier engineer tidak berhenti di “JPA standard”. Mereka bertanya:

> Provider apa? Versi berapa? Database apa? Transaction manager apa? Fetch plan apa? Enhancement/weaving aktif atau tidak? Cache aktif atau tidak? Test environment sama dengan production atau tidak?

---

## 5. Version Landscape: Java 8–25, `javax` to `jakarta`, Provider Lines

Seri ini mencakup Java 8 hingga Java 25. Ini penting karena dunia persistence Java mengalami perubahan besar:

1. Java 8 adalah baseline legacy enterprise yang masih banyak hidup.
2. Java 11/17/21 menjadi baseline modern enterprise.
3. Java 25 sudah general availability pada 16 September 2025 dan diposisikan sebagai LTS oleh OpenJDK/Oracle ecosystem.
4. Package namespace berubah dari `javax.persistence` ke `jakarta.persistence`.
5. Hibernate 5 ke 6/7 membawa perubahan besar pada query engine, type system, dialect, dan bootstrapping.
6. EclipseLink 2.x ke 3/4 bergerak dari Java EE/JPA lama ke Jakarta EE/Jakarta Persistence.

### 5.1 Practical Compatibility Map

| Era | Java | API Namespace | Typical Spec | Provider Line | Notes |
|---|---:|---|---|---|---|
| Legacy enterprise | 8 | `javax.persistence` | JPA 2.1/2.2 | Hibernate 5.x, EclipseLink 2.x | Banyak app lama masih di sini |
| Transitional | 11 | mixed depending stack | JPA 2.2 / Jakarta 2.x/3.x | Hibernate 5.6/6.x, EclipseLink 3.x | Risiko dependency campur |
| Modern Jakarta | 17 | `jakarta.persistence` | Jakarta Persistence 3.x | Hibernate 6.x/7.x, EclipseLink 4.x | Banyak framework modern baseline di sini |
| Current modern | 21/25 | `jakarta.persistence` | Jakarta Persistence 3.2 stable | Hibernate 7.x, EclipseLink 4.x | Cocok untuk platform baru |
| Future/development | 25+ | `jakarta.persistence` | Jakarta Persistence 4.0 milestone/dev | Hibernate 8.0 dev | Jangan dianggap stable baseline |

### 5.2 The `javax` to `jakarta` Boundary

Ini bukan perubahan kosmetik. Package rename dapat memecah dependency graph.

Legacy:

```java
import javax.persistence.Entity;
import javax.persistence.Id;
```

Modern:

```java
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
```

Masalah umum saat migration:

- entity memakai `jakarta.persistence`, tetapi library lama masih expect `javax.persistence`;
- application server membawa API lama;
- provider version tidak cocok dengan API;
- Spring Boot version tidak align dengan Hibernate version;
- annotation processor/metamodel generator masih versi lama;
- dependency transitive membawa dua API sekaligus;
- test classpath berbeda dari runtime classpath.

Rule penting:

> Dalam satu runtime persistence stack, jangan campur `javax.persistence` dan `jakarta.persistence` kecuali benar-benar tahu boundary-nya dan ada adapter/migration strategy yang jelas.

---

## 6. The ORM Runtime Components

Untuk memahami ORM, kita perlu melihat komponen runtime-nya.

### 6.1 Entity

Entity adalah object yang punya identity persistent.

```java
@Entity
@Table(name = "case_application")
public class CaseApplication {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Version
    private long version;

    private String referenceNo;
    private CaseStatus status;
}
```

Entity bukan sekadar DTO. Entity punya lifecycle dalam persistence context.

### 6.2 EntityManager / Session

JPA API memakai `EntityManager`.

```java
CaseApplication app = entityManager.find(CaseApplication.class, id);
```

Hibernate native API memakai `Session`.

```java
Session session = entityManager.unwrap(Session.class);
```

Secara praktis, `EntityManager` adalah API standard. Native provider API dibutuhkan saat memakai fitur provider-specific.

### 6.3 EntityManagerFactory / SessionFactory

`EntityManagerFactory` atau `SessionFactory` adalah object berat yang dibuat sekali per persistence unit. Ia menyimpan metadata, mapping, service, cache configuration, dan connection integration.

Rule:

- factory dibuat sekali saat application startup;
- jangan dibuat per request;
- satu factory biasanya untuk satu persistence unit/database configuration;
- factory adalah expensive object;
- entity manager/session adalah unit kerja yang lebih pendek umurnya.

### 6.4 Persistence Context

Persistence context adalah ruang memory tempat provider melacak entity managed.

Ia menyimpan:

- identity map;
- entity instance;
- snapshot state;
- collection wrapper;
- pending actions;
- loaded association state;
- status entity;
- sometimes proxies.

Dalam Hibernate, konsep ini dekat dengan `Session` persistence context. Dalam EclipseLink, konsep UnitOfWork berperan penting.

### 6.5 Transaction

Transaction menentukan atomicity dan visibility. ORM biasanya tidak boleh dipikirkan terpisah dari transaction.

Contoh salah:

```java
CaseApplication app = repository.findById(id).orElseThrow();
app.approve();
// tidak jelas transaction aktif atau tidak
```

Pertanyaan yang harus dijawab:

- apakah method ini berjalan dalam transaction?
- apakah `app` managed?
- kapan flush terjadi?
- apakah exception menyebabkan rollback?
- apakah update memakai optimistic locking?

### 6.6 JDBC Connection

ORM tetap memakai JDBC di bawahnya. Tidak ada magic yang menghapus connection pool.

```text
Entity operation
  -> provider SQL generation
  -> JDBC PreparedStatement
  -> connection from pool
  -> database execution
```

Jadi masalah ORM sering muncul sebagai masalah database atau pool:

- connection pool exhausted;
- slow query;
- lock wait;
- deadlock;
- network latency;
- transaction terlalu lama;
- too many round trips.

### 6.7 Database Dialect

Dialect adalah pengetahuan provider tentang database tertentu.

Dialect memengaruhi:

- pagination SQL;
- sequence syntax;
- identity column;
- locking syntax;
- timestamp handling;
- boolean mapping;
- LOB handling;
- limit/offset;
- function support;
- generated DDL.

Salah dialect dapat menghasilkan SQL valid tetapi tidak optimal, atau SQL yang gagal.

---

## 7. Lifecycle Mental Model

Entity lifecycle adalah pondasi semua pembahasan ORM.

```text
Transient/New
    | persist()
    v
Managed
    | detach()/clear()/close()/serialization boundary
    v
Detached
    | merge()
    v
Managed copy

Managed
    | remove()
    v
Removed
    | flush
    v
Deleted row
```

### 7.1 Transient

Object baru yang belum dikenal persistence context.

```java
CaseApplication app = new CaseApplication();
app.setReferenceNo("CASE-001");
```

Belum ada row. Belum managed.

### 7.2 Managed

Object sudah terdaftar dalam persistence context.

```java
entityManager.persist(app);
```

atau:

```java
CaseApplication app = entityManager.find(CaseApplication.class, id);
```

Jika managed object berubah, provider dapat mendeteksi perubahan saat flush.

### 7.3 Detached

Object pernah managed, tetapi persistence context yang mengelolanya sudah berakhir atau object didetach.

```java
CaseApplication app = entityManager.find(CaseApplication.class, id);
entityManager.close();
app.setStatus(APPROVED); // detached mutation
```

Perubahan ini tidak otomatis tersimpan.

### 7.4 Removed

Object managed yang dijadwalkan untuk delete.

```java
entityManager.remove(app);
```

SQL delete biasanya terjadi saat flush.

### 7.5 Why Lifecycle Matters

Bug umum:

```java
CaseApplication app = service.find(id); // returns detached entity
app.approve();
// developer kira otomatis update, padahal tidak
```

Atau:

```java
CaseApplication detached = request.toEntity();
entityManager.merge(detached);
```

Ini bisa overwrite field lain dengan null jika object request tidak lengkap.

Top-tier rule:

> Jangan pernah membahas entity mutation tanpa menyebut lifecycle state-nya.

---

## 8. Persistence Context as Identity Map

Persistence context menjamin bahwa dalam satu context, satu database row direpresentasikan oleh satu object instance.

Contoh:

```java
CaseApplication a = entityManager.find(CaseApplication.class, 10L);
CaseApplication b = entityManager.find(CaseApplication.class, 10L);

System.out.println(a == b); // biasanya true dalam persistence context yang sama
```

Mental model:

```text
Persistence Context
  Key: (CaseApplication, 10)
  Value: Java object reference 0xABC
```

Ini disebut identity map.

### 8.1 Why Identity Map Exists

Tanpa identity map:

```java
CaseApplication a = find(10);
CaseApplication b = find(10);

a.setStatus(APPROVED);
b.setStatus(REJECTED);
```

Provider akan bingung: state mana yang benar untuk row yang sama?

Identity map menjaga invariant:

> Dalam satu persistence context, satu persistent identity harus punya satu managed instance.

### 8.2 Identity Map Is Not Second-Level Cache

First-level cache/persistence context:

- selalu ada;
- scoped pada entity manager/session;
- menjamin identity;
- menyimpan state managed;
- ikut transaction/unit of work.

Second-level cache:

- optional;
- scoped lebih luas;
- menyimpan data antar session;
- perlu invalidation strategy;
- dapat stale;
- provider/cache-provider specific.

Jangan menyebut persistence context sebagai “cache” saja, karena fungsi utamanya bukan sekadar mengurangi query. Fungsi utamanya menjaga unit of work.

---

## 9. Dirty Checking: Change Detection, Not Explicit Save

Dalam ORM, update sering terjadi bukan karena kita memanggil `save`, tetapi karena managed entity berubah.

```java
@Transactional
public void approve(Long id) {
    CaseApplication app = entityManager.find(CaseApplication.class, id);
    app.approve();
}
```

Tidak ada `save()`. Tetapi saat transaction commit, provider dapat melakukan:

```sql
UPDATE case_application
SET status = ?, version = ?
WHERE id = ? AND version = ?;
```

### 9.1 How Dirty Checking Works Conceptually

Saat entity diload:

```text
Loaded state snapshot:
  status = PENDING
  assignedOfficer = null
```

Saat code mengubah object:

```text
Current object state:
  status = APPROVED
  assignedOfficer = 3001
```

Saat flush:

```text
Compare snapshot vs current
  status changed
  assignedOfficer changed
Generate UPDATE
```

Provider implementation bisa snapshot-based, attribute-tracking via enhancement/weaving, atau kombinasi.

### 9.2 Why Dirty Checking Can Be Expensive

Flush cost dapat meningkat karena:

- banyak managed entity dalam persistence context;
- entity punya banyak field;
- collection besar;
- snapshot comparison mahal;
- dirty checking terjadi sebelum query;
- batch job tidak pernah `clear()`;
- domain object graph terlalu besar.

Batch job yang buruk:

```java
@Transactional
public void processAll(List<Long> ids) {
    for (Long id : ids) {
        CaseApplication app = entityManager.find(CaseApplication.class, id);
        app.recalculateScore();
    }
}
```

Jika `ids` berisi 200.000, persistence context dapat membengkak.

Lebih aman:

```java
for (int i = 0; i < ids.size(); i++) {
    CaseApplication app = entityManager.find(CaseApplication.class, ids.get(i));
    app.recalculateScore();

    if (i % 100 == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

Namun ini juga punya konsekuensi: setelah `clear()`, semua entity menjadi detached.

---

## 10. Flush: The Boundary Between Memory State and SQL State

Flush adalah proses sinkronisasi persistence context ke database melalui SQL. Flush bukan commit.

```text
Java field mutation
    ↓
Managed entity dirty
    ↓
Flush
    ↓
SQL executed
    ↓
Commit
    ↓
Transaction durable
```

### 10.1 Flush Can Happen Before Commit

Flush dapat terjadi:

- saat transaction commit;
- sebelum query tertentu;
- saat manual `entityManager.flush()`;
- karena provider/framework behavior;
- karena flush mode.

Contoh mengejutkan:

```java
app.setStatus(APPROVED);

List<CaseApplication> pending = entityManager
    .createQuery("select c from CaseApplication c where c.status = :status", CaseApplication.class)
    .setParameter("status", PENDING)
    .getResultList();
```

Provider bisa flush update `APPROVED` sebelum menjalankan query agar query konsisten dengan state yang sudah berubah dalam persistence context.

### 10.2 Flush Is Not Commit

Jika flush berhasil lalu transaction rollback, perubahan tetap tidak committed.

```java
entityManager.flush();
throw new RuntimeException("rollback");
```

SQL mungkin sudah dieksekusi ke database dalam transaction, tetapi rollback membatalkan.

### 10.3 Why Flush Is Central to Failure Modes

Banyak bug ORM sebenarnya bug flush:

- constraint violation muncul di query, bukan di commit;
- update terjadi saat endpoint hanya terlihat membaca;
- delete orphan terjadi sebelum validasi selesai;
- SQL order membuat foreign key error;
- batch insert tidak jalan karena flush terlalu sering;
- long persistence context membuat flush lambat.

Rule:

> Jika ada behavior ORM yang terasa “tiba-tiba”, cari kapan flush terjadi.

---

## 11. Action Queue and SQL Ordering

Provider tidak selalu mengeksekusi SQL saat method dipanggil. Ia mengumpulkan action.

Contoh:

```java
entityManager.persist(parent);
entityManager.persist(child);
parent.addChild(child);
```

Provider menyusun action:

```text
Insert Parent
Insert Child
Update FK or Insert join row
```

Dalam Hibernate, konsep action queue sangat penting. Action queue mengelompokkan insert, update, delete, collection actions, dan mengurutkannya untuk mengurangi constraint violation serta mendukung batching.

### 11.1 Why Ordering Matters

Misalnya:

```text
parent table
child table with FK parent_id NOT NULL
```

SQL harus:

```sql
INSERT INTO parent ...;
INSERT INTO child(parent_id, ...) ...;
```

Bukan sebaliknya.

Untuk delete:

```sql
DELETE FROM child WHERE parent_id = ?;
DELETE FROM parent WHERE id = ?;
```

Jika salah urutan, foreign key violation.

### 11.2 Why Mapping Affects SQL Shape

Mapping ini:

```java
@OneToMany
@JoinColumn(name = "case_id")
private List<Document> documents;
```

berbeda dari:

```java
@OneToMany(mappedBy = "caseApplication")
private List<Document> documents;
```

dan berbeda dari:

```java
@ManyToMany
@JoinTable(name = "case_document_link")
private Set<Document> documents;
```

Anotasi bukan dekorasi. Anotasi menentukan ownership, SQL shape, constraints, dan lifecycle mutation.

---

## 12. Fetching Is Graph Materialization Strategy

Fetching adalah salah satu sumber bug dan performance issue terbesar.

Object code:

```java
caseApplication.getApplicant().getAddress().getPostalCode();
```

Database work bisa menjadi:

```sql
SELECT * FROM case_application WHERE id = ?;
SELECT * FROM applicant WHERE id = ?;
SELECT * FROM address WHERE id = ?;
```

Atau satu join besar:

```sql
SELECT ...
FROM case_application c
JOIN applicant a ON a.id = c.applicant_id
JOIN address ad ON ad.id = a.address_id
WHERE c.id = ?;
```

Atau sebagian dari second-level cache.

### 12.1 Lazy vs Eager Is Not Enough

Basic rule:

- LAZY means provider may delay loading;
- EAGER means provider must load association eagerly, but exact SQL shape can vary;
- LAZY does not mean zero risk;
- EAGER often creates hidden global cost.

`FetchType.EAGER` adalah keputusan global. Setiap query entity tersebut membawa beban association eager, kecuali provider melakukan optimasi tertentu.

### 12.2 N+1

N+1 terjadi saat satu query mengambil N parent, lalu akses association memicu satu query tambahan per parent.

```java
List<CaseApplication> apps = repository.findPendingCases();

for (CaseApplication app : apps) {
    System.out.println(app.getApplicant().getName());
}
```

Mungkin menghasilkan:

```text
1 query for cases
N queries for applicants
```

Solusi bukan selalu join fetch. Join fetch bisa menyebabkan cartesian explosion jika mengambil banyak collection.

### 12.3 Cartesian Explosion

Jika satu case punya 10 documents dan 20 histories, join fetch keduanya bisa menghasilkan 200 row untuk satu case.

```text
case × documents × histories
1 × 10 × 20 = 200 rows
```

Untuk 100 cases:

```text
100 × 10 × 20 = 20,000 rows
```

Padahal logical root hanya 100 cases.

Rule:

> Fetch plan harus didesain per use case, bukan diserahkan pada default mapping.

---

## 13. Transaction Boundary Is Persistence Boundary

ORM harus dibaca bersama transaction boundary.

### 13.1 Bad Boundary

```java
public CaseApplication getCase(Long id) {
    return repository.findById(id).orElseThrow();
}
```

Lalu controller:

```java
CaseApplication app = service.getCase(id);
return app.getDocuments().size();
```

Jika transaction sudah selesai dan `documents` lazy, akses bisa gagal.

### 13.2 Open Session in View

Beberapa stack membuka persistence context sepanjang request web. Ini membuat lazy loading di view/controller mungkin berhasil.

Manfaat:

- mengurangi `LazyInitializationException`;
- developer lebih mudah navigasi object graph.

Risiko:

- query tersembunyi di serialization layer;
- transaction boundary kabur;
- API response dapat memicu DB storm;
- debugging sulit;
- performance tidak predictable.

Top-tier stance:

> Open Session in View bukan dosa mutlak, tetapi harus dipahami sebagai architectural trade-off, bukan solusi default untuk semua lazy loading problem.

### 13.3 Read Use Case vs Write Use Case

Read use case sering lebih baik memakai projection/DTO query:

```java
select new CaseSummaryDto(c.id, c.referenceNo, a.name, c.status)
from CaseApplication c
join c.applicant a
where c.status = :status
```

Write use case sering lebih baik memakai managed aggregate:

```java
CaseApplication app = entityManager.find(CaseApplication.class, id);
app.approve(command.officerId(), command.reason());
```

Jangan memaksa satu model untuk semua kebutuhan.

---

## 14. ORM and Domain Modeling

ORM sering disalahgunakan sebagai data structure generator. Entity dibuat mengikuti table, lalu service berisi semua logic.

```java
caseEntity.setStatus(APPROVED);
caseEntity.setApprovedBy(officerId);
caseEntity.setApprovedAt(now);
historyRepository.save(...);
taskRepository.save(...);
```

Ini bisa bekerja, tetapi invariant tersebar.

Lebih baik, untuk domain yang kaya:

```java
caseApplication.approve(officer, clock);
```

Di dalamnya:

```java
public void approve(Officer officer, Clock clock) {
    if (this.status != CaseStatus.PENDING_REVIEW) {
        throw new IllegalStateException("Only pending review case can be approved");
    }

    this.status = CaseStatus.APPROVED;
    this.approvedBy = officer;
    this.approvedAt = Instant.now(clock);
    this.history.add(CaseHistory.approvedBy(officer, this.approvedAt));
}
```

Namun domain-rich entity harus tetap sadar ORM:

- jangan load huge collection tanpa sadar;
- jangan akses lazy association dalam `toString()`;
- jangan pakai Lombok `@Data` sembarangan;
- jangan buat equals/hashCode yang traversal association;
- jangan panggil external service dari entity lifecycle callback;
- jangan menyimpan state transient yang membuat persistence behavior ambigu.

### 14.1 Entity Is Not Always Aggregate Root

Tidak semua `@Entity` adalah aggregate root.

Contoh:

```text
CaseApplication = aggregate root
CaseDocument = child entity
CaseHistory = append-only history entity
Officer = reference entity / separate aggregate
```

Cascade dari CaseApplication ke CaseDocument mungkin masuk akal. Cascade remove dari CaseApplication ke Officer jelas berbahaya.

Rule:

> Cascade harus mengikuti lifecycle ownership, bukan mengikuti kenyamanan navigasi object.

---

## 15. Mapping Is a Contract, Not Decoration

Annotation mapping menentukan contract antara Java dan database.

```java
@Column(nullable = false, length = 50)
private String referenceNo;
```

Ini tidak hanya dokumentasi. Ia memengaruhi:

- DDL generation/validation;
- runtime nullability checking provider tertentu;
- SQL binding;
- schema expectation;
- migration risk.

### 15.1 Dangerous Mapping Defaults

Beberapa default sering berbahaya:

#### `@ManyToOne` default EAGER

```java
@ManyToOne
private Applicant applicant;
```

Default JPA untuk to-one association adalah EAGER. Ini sering tidak diinginkan untuk high-throughput system.

Biasakan eksplisit:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "applicant_id", nullable = false)
private Applicant applicant;
```

#### Enum ordinal

```java
@Enumerated(EnumType.ORDINAL)
private CaseStatus status;
```

Jika enum order berubah, data rusak secara silent.

Lebih aman:

```java
@Enumerated(EnumType.STRING)
@Column(length = 30, nullable = false)
private CaseStatus status;
```

Namun string enum juga punya migration risk jika enum name diubah. Untuk domain stabil, kadang custom converter dengan explicit code lebih baik.

#### Lombok `@Data`

```java
@Data
@Entity
class CaseApplication { ... }
```

Berbahaya karena auto-generated `equals`, `hashCode`, dan `toString` bisa menyentuh association lazy atau mutable fields.

Lebih aman gunakan getter/setter terkontrol dan equals/hashCode eksplisit.

---

## 16. Provider Extensions: When Non-Portable Is Correct

Banyak tim terlalu takut pada provider-specific extension. Padahal untuk production system, extension sering diperlukan.

Hibernate examples:

- `@BatchSize`;
- `@Fetch(FetchMode.SUBSELECT)`;
- filters;
- `@NaturalId`;
- custom types;
- `StatementInspector`;
- Envers;
- `StatelessSession`;
- bytecode enhancement;
- second-level cache region tuning.

EclipseLink examples:

- weaving;
- batch reading;
- fetch groups;
- descriptor customizer;
- shared cache controls;
- transformation mappings;
- query hints.

### 16.1 Portability vs Operational Correctness

Portability bernilai jika:

- library harus mendukung banyak provider;
- app server bisa berubah;
- domain sederhana;
- performance requirement sedang;
- provider switch realistis.

Provider-specific extension bernilai jika:

- production performance membutuhkan kontrol;
- failure mode provider-specific;
- database/provider sudah menjadi platform decision;
- observability butuh hook tertentu;
- migration cost lebih kecil daripada operational risk.

Rule:

> Jangan pakai extension karena malas memahami standard. Pakai extension ketika standard tidak cukup untuk correctness, performance, atau operability.

---

## 17. ORM in Layered Architecture

Dalam enterprise app, ORM biasanya berada di persistence layer. Tetapi efeknya merambat ke service, API, transaction, cache, dan database.

```text
Controller / API
    ↓ DTO / Command
Application Service
    ↓ transaction boundary
Domain Model / Entity Aggregate
    ↓ managed by
Repository / EntityManager
    ↓ provider
Hibernate/EclipseLink
    ↓ JDBC
Database
```

### 17.1 Repository Is Not the ORM

Repository adalah abstraction aplikasi. ORM provider adalah engine.

Spring Data JPA repository:

```java
interface CaseRepository extends JpaRepository<CaseApplication, Long> {
    List<CaseApplication> findByStatus(CaseStatus status);
}
```

Ini tidak menggantikan pemahaman:

- query generation;
- fetch plan;
- transaction;
- flush;
- locking;
- persistence context;
- cache;
- SQL shape.

Repository dapat menyembunyikan masalah, tetapi tidak menghapusnya.

### 17.2 Service Boundary Should Own Transaction Boundary

Idealnya:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseApplication app = caseRepository.findByIdForUpdate(command.caseId())
        .orElseThrow();

    app.approve(command.officerId(), command.reason(), clock);
}
```

Di sini:

- command masuk sebagai DTO;
- entity diload dalam transaction;
- mutation terjadi pada managed aggregate;
- dirty checking menyimpan perubahan;
- optimistic/pessimistic lock bisa diterapkan;
- transaction boundary jelas.

---

## 18. Read Model vs Write Model

ORM sering kuat untuk write model yang menjaga invariant aggregate. Tetapi untuk read model kompleks, ORM entity graph belum tentu ideal.

### 18.1 Write Model

Write model concern:

- invariant;
- lifecycle;
- validation;
- concurrency;
- audit;
- state transition;
- cascade within aggregate.

Entity cocok jika aggregate jelas.

### 18.2 Read Model

Read model concern:

- filtering;
- sorting;
- pagination;
- projection;
- search;
- report;
- joins across many aggregates;
- low-latency response.

DTO/projection/native query/materialized view kadang lebih cocok.

Contoh read query:

```java
@Query("""
    select new CaseListingRow(
        c.id,
        c.referenceNo,
        c.status,
        a.name,
        c.submittedAt,
        count(d.id)
    )
    from CaseApplication c
    join c.applicant a
    left join c.documents d
    where c.status in :statuses
    group by c.id, c.referenceNo, c.status, a.name, c.submittedAt
""")
Page<CaseListingRow> searchListing(...);
```

Ini lebih predictable daripada load entity graph penuh lalu mapping di Java.

### 18.3 The Top-Tier Rule

> Use entities for consistency boundaries. Use projections for query boundaries.

---

## 19. The Cost Model of ORM

ORM cost tidak hanya SQL time. Cost-nya tersebar.

| Cost Type | Source |
|---|---|
| DB round trip | lazy loading, N+1, flush |
| DB CPU | joins, sorting, scans, locks |
| Network | row volume, LOB transfer |
| JVM allocation | entity hydration, collection creation |
| Dirty checking | managed entity count |
| Flush ordering | action queue size |
| GC pressure | large persistence context |
| Lock wait | transaction duration, pessimistic lock |
| Cache overhead | invalidation, serialization, stale checks |

### 19.1 Example: Small Code, Huge Work

```java
List<CaseApplication> cases = caseRepository.findAllOpenCases();
return cases.stream()
    .map(c -> new CaseDto(
        c.getReferenceNo(),
        c.getApplicant().getName(),
        c.getDocuments().size(),
        c.getLatestHistory().getAction()
    ))
    .toList();
```

Hidden work:

- load open cases;
- for each case load applicant;
- for each case load documents;
- for each case load latest history;
- allocate all entities;
- maybe initialize collections;
- maybe trigger flush before query;
- maybe hold large graph until request ends.

Better read model:

```sql
SELECT c.reference_no,
       a.name,
       d.document_count,
       h.latest_action
FROM case_application c
JOIN applicant a ON a.id = c.applicant_id
LEFT JOIN ...
WHERE c.status = 'OPEN'
ORDER BY c.submitted_at DESC
FETCH FIRST ? ROWS ONLY;
```

Or JPQL/native projection.

### 19.2 Performance Rule

> Performance is not “use lazy” or “use eager”. Performance is matching query shape to use case.

---

## 20. Correctness Model: ORM Can Lose Data If Used Carelessly

ORM bugs are not only performance bugs. They can be correctness bugs.

### 20.1 Lost Update

Two users load same case:

```text
T1 loads version 5
T2 loads version 5
T1 approves -> version 6
T2 rejects -> overwrites approval if no version check
```

Solution:

```java
@Version
private long version;
```

SQL:

```sql
UPDATE case_application
SET status = ?, version = version + 1
WHERE id = ? AND version = ?;
```

If row count is 0, optimistic lock exception.

### 20.2 Detached Overwrite

API receives partial JSON:

```json
{
  "id": 10,
  "status": "APPROVED"
}
```

Bad approach:

```java
CaseApplication detached = mapper.toEntity(request);
entityManager.merge(detached);
```

Fields not present in request may become null and overwrite DB.

Better:

```java
CaseApplication managed = entityManager.find(CaseApplication.class, request.id());
managed.approve(currentOfficer, clock);
```

### 20.3 Cascade Delete Accident

```java
@ManyToOne(cascade = CascadeType.ALL)
private Officer officer;
```

If case deleted, officer may be deleted too. Usually catastrophic.

Rule:

> Cascade from child/reference to shared parent is almost always wrong.

---

## 21. Cache Correctness: Faster Wrong Data Is Worse

ORM cache can improve performance, but cache is correctness-sensitive.

### 21.1 First-Level Cache

Within one persistence context:

```java
CaseApplication a = find(10);
externalJdbcUpdateStatus(10, "REJECTED");
CaseApplication b = find(10);
```

`b` may still show old state because persistence context already has entity 10.

Use `refresh()` if needed:

```java
entityManager.refresh(a);
```

### 21.2 Second-Level Cache / Shared Cache

Second-level cache stores data beyond one persistence context. Risk:

- stale data;
- invalidation delay;
- cluster inconsistency;
- tenant leakage;
- query cache misuse;
- external update not visible.

Rule:

> Cache entities that are read-mostly and have clear invalidation semantics. Do not cache high-churn regulatory workflow state casually.

---

## 22. Schema and Migration Discipline

ORM can generate schema, but production schema migration should be disciplined.

Dangerous:

```properties
hibernate.hbm2ddl.auto=update
```

In production, automatic update can:

- create unexpected columns;
- fail halfway;
- not create correct index;
- not handle data backfill;
- not enforce zero-downtime order;
- produce provider-specific DDL drift.

Better approach:

- use ORM validation in runtime;
- manage DDL through Flyway/Liquibase/manual migration pipeline;
- review generated SQL if used as draft;
- maintain expand/backfill/switch/contract pattern;
- test migration on production-like database;
- compare ORM metadata expectation with schema.

---

## 23. Testing ORM Is Not Repository Happy Path

A repository test that only checks `save` and `findById` is not enough.

ORM tests should cover:

- mapping correctness;
- generated SQL count;
- fetch plan;
- lazy loading boundary;
- transaction rollback;
- optimistic locking;
- cascade behavior;
- orphan removal;
- bulk update stale context;
- database-specific dialect behavior;
- migration scripts;
- performance regression.

### 23.1 H2 Trap

H2 is useful for fast tests, but can hide production issues:

- SQL dialect differs;
- locking differs;
- sequence behavior differs;
- timestamp precision differs;
- constraint behavior differs;
- pagination differs;
- JSON/LOB behavior differs.

For serious persistence layer, use Testcontainers or real integration DB for critical tests.

---

## 24. Observability: You Cannot Tune What You Cannot See

ORM production diagnosis needs visibility from Java method to SQL execution.

Minimum observability:

- SQL logging in lower environment;
- bind parameter strategy without leaking sensitive data;
- query count per request;
- slow query log;
- Hibernate statistics or equivalent metrics;
- connection pool metrics;
- transaction duration;
- flush duration if possible;
- cache hit/miss;
- correlation ID in SQL comments or statement inspector;
- DB execution plan for critical query.

### 24.1 Bad Observability

```properties
spring.jpa.show-sql=true
```

This alone is not enough.

Problems:

- formatting poor;
- no bind values;
- no request correlation;
- no timing;
- unsafe if logs contain PII;
- too noisy in production.

### 24.2 Better Strategy

Use structured approach:

```text
Request ID: REQ-123
Service method: approveCase
Transaction duration: 180ms
SQL count: 4
Flush time: 30ms
Slowest SQL: update case_application ... 22ms
Rows loaded: 3 entities, 1 collection
Cache: 0 L2 hits, 0 query cache hits
```

This makes diagnosis possible.

---

## 25. Common Misleading Beliefs

### 25.1 “Calling save is required to update”

Not necessarily. Managed entity changes are flushed automatically.

### 25.2 “Lazy always improves performance”

Lazy can reduce initial load, but can create N+1 and unpredictable SQL.

### 25.3 “Eager prevents LazyInitializationException, so it is safer”

Eager can create global over-fetching and query explosion.

### 25.4 “JPA means provider behavior is portable”

Only within spec-defined boundaries. Many important production behaviors are provider-specific.

### 25.5 “Repository hides persistence complexity”

Repository hides API details, not runtime behavior.

### 25.6 “Second-level cache is always good”

Cache can make stale/wrong data faster.

### 25.7 “ORM is bad; just use SQL”

ORM is bad when used with wrong mental model. SQL is also bad when duplicated everywhere without boundary discipline. Strong engineers can use both.

---

## 26. When ORM Is a Good Fit

ORM fits well when:

- domain has aggregate lifecycle;
- write operations mutate coherent object graph;
- consistency boundary is clear;
- transaction per use case is manageable;
- relational model maps reasonably to object model;
- team understands fetch plan;
- generated SQL is observable;
- provider-specific tuning is acceptable;
- schema migration is disciplined.

Examples:

- case application aggregate;
- order aggregate;
- user profile with owned addresses;
- approval workflow state;
- configuration entities;
- moderate-complexity transactional modules.

---

## 27. When ORM Is Not the Best Tool

ORM may be poor fit for:

- huge analytical reports;
- complex ad-hoc search;
- high-volume append-only event ingestion;
- ETL jobs;
- bulk update across millions of rows;
- graph traversal with many-to-many explosion;
- heavily denormalized read model;
- database-specific optimization-heavy query;
- streaming large LOBs;
- cross-aggregate reporting.

Better tools may include:

- native SQL;
- jOOQ;
- JDBC template;
- stored procedures;
- materialized views;
- search index;
- event store;
- batch processing framework;
- CQRS read model.

Top-tier engineer does not force ORM everywhere.

---

## 28. Decision Framework: Entity, DTO, Projection, Native SQL, or Separate Read Model?

Use this decision tree.

### 28.1 Need to enforce aggregate invariant?

Use managed entity.

```text
Approve case
Reject case
Assign officer
Add document within case aggregate
```

### 28.2 Need listing/search/report?

Use projection/query model.

```text
Case listing page
Dashboard counts
Aging report
Officer workload summary
```

### 28.3 Need database-specific feature?

Use native SQL or provider extension.

```text
Oracle analytic function
PostgreSQL JSONB query
Recursive CTE
Window function pagination
```

### 28.4 Need massive bulk processing?

Use bulk query, stateless session, JDBC batch, or dedicated batch pipeline.

```text
Archive old audit rows
Recalculate millions of scores
Backfill new column
```

### 28.5 Need external API contract?

Use DTO/command object, not entity directly.

```text
REST request
GraphQL response
Kafka message
public API payload
```

---

## 29. Provider Knowledge Roadmap

This series will build from conceptual to operational.

```text
Part 0–6:
  ORM mental model, persistence context, identity, dirty checking, flush

Part 7–16:
  SQL generation, mapping, association, collection, cascade, inheritance, fetch, query

Part 17–23:
  bulk mutation, transaction, concurrency, merge/detach, cache, schema, enhancement

Part 24–26:
  Hibernate deep dive, EclipseLink deep dive, provider differences

Part 27–34:
  observability, performance, domain modeling, multi-tenancy, testing, migration, failure playbook, capstone
```

---

## 30. Practical Baseline Setup for Learning

Untuk mengikuti seri ini secara efektif, idealnya punya beberapa baseline project.

### 30.1 Legacy Baseline

- Java 8
- `javax.persistence`
- Hibernate 5.x or EclipseLink 2.x
- JPA 2.2
- Maven/Gradle
- PostgreSQL/Oracle/MySQL depending target

Tujuan:

- memahami legacy constraints;
- memahami migration pain;
- melihat behavior lama.

### 30.2 Modern Baseline

- Java 17/21/25
- `jakarta.persistence`
- Hibernate 6/7 or EclipseLink 4
- Jakarta Persistence 3.2
- Testcontainers
- real database dialect

Tujuan:

- memahami modern provider behavior;
- memahami Jakarta namespace;
- memakai observability dan performance test.

### 30.3 Avoid Single-Database Illusion

Jika production pakai Oracle, test critical behavior di Oracle-compatible setup. Jika production pakai PostgreSQL, test di PostgreSQL. H2 tidak cukup untuk locking, sequence, dialect, LOB, timestamp, dan optimizer behavior.

---

## 31. The Enterprise/Regulatory Persistence Lens

Untuk sistem regulatory/case-management, persistence bukan hanya CRUD. Persistence adalah bagian dari defensibility.

Key concerns:

- audit trail;
- legal state transition;
- approval history;
- document integrity;
- officer assignment;
- SLA/escalation;
- role-based visibility;
- historical reconstruction;
- correction vs deletion;
- data retention;
- archival;
- multi-agency boundary;
- tenant/agency isolation;
- report reproducibility.

ORM design harus mempertimbangkan:

- mana state sekarang;
- mana history immutable;
- mana derived read model;
- mana aggregate boundary;
- mana transaction boundary;
- mana data tidak boleh physical delete;
- mana association tidak boleh cascade remove;
- mana query harus auditable;
- mana cache tidak boleh dipakai.

### 31.1 Example: Case Approval

Naive model:

```java
case.setStatus(APPROVED);
case.setRemarks("ok");
```

Better model:

```java
case.approve(new ApprovalDecision(officerId, reason, decisionTime));
```

Persistence effect:

```text
case_application.status = APPROVED
case_application.version += 1
case_approval row inserted
case_history row inserted
task_assignment updated/closed
next task optionally created
```

This is not a simple update. It is a state transition with audit consequences.

---

## 32. Failure Mode Map

This map will be reused throughout the series.

| Symptom | Likely ORM Area |
|---|---|
| Endpoint slow with many small queries | fetch plan / N+1 |
| Endpoint returns duplicate root rows | join fetch / collection join |
| Memory grows during batch | persistence context not cleared |
| Update not saved | entity detached / no transaction / dirty checking issue |
| Unexpected update during read | flush before query |
| Delete removes too much | cascade/remove/orphan boundary wrong |
| Constraint violation before commit | flush timing / SQL ordering |
| Stale data shown | first-level cache / second-level cache / transaction isolation |
| Lost update | missing `@Version` / bad merge |
| Deadlock | lock ordering / transaction scope / batch update order |
| Pagination wrong | fetch join collection / duplicate rows |
| LazyInitializationException | transaction/persistence context boundary |
| Cache shows tenant data | L2 cache key/tenant filter issue |
| Migration breaks queries | provider version/type/dialect query engine change |
| Production differs from test | H2/dialect mismatch |

---

## 33. Top 1% ORM Engineer Habits

### 33.1 Always Ask: “What SQL Will This Produce?”

Before trusting code:

```java
case.getDocuments().stream()
    .filter(Document::isActive)
    .toList();
```

Ask:

- are documents already loaded?
- will this load all documents?
- should filtering be in SQL?
- how many rows?
- is this inside transaction?
- is this endpoint paginated?

### 33.2 Always Know Entity State

For any entity variable, ask:

```text
transient, managed, detached, or removed?
```

### 33.3 Always Design Fetch Plan per Use Case

Do not let entity mapping decide every query.

### 33.4 Always Separate API DTO from Entity

Entity is persistence/domain state, not public contract.

### 33.5 Always Use Versioning for Concurrent Updates

Most mutable aggregate roots should have `@Version`.

### 33.6 Always Test with Real Dialect for Critical Paths

Especially for:

- locking;
- pagination;
- sequence;
- timestamp;
- LOB;
- bulk update;
- constraint behavior.

### 33.7 Always Observe SQL Count and Shape

A passing functional test can still hide 1000 SQL statements.

### 33.8 Always Treat Cache as Correctness Feature

Cache is not just performance. Cache changes data visibility semantics.

### 33.9 Always Document Provider-Specific Decisions

If you use Hibernate `@BatchSize`, write why. If you use EclipseLink fetch group, write why. Future maintainers need operational intent.

### 33.10 Always Have a Rollback/Migration Strategy

ORM mapping changes are schema changes. Schema changes are production risk.

---

## 34. Working Vocabulary

| Term | Meaning |
|---|---|
| Entity | Persistent object with identity |
| Persistence Context | Runtime context tracking managed entities |
| Unit of Work | Pattern for collecting changes and flushing them atomically |
| Identity Map | Ensures one object per persistent identity inside context |
| Dirty Checking | Detecting changed managed entity state |
| Flush | Synchronizing pending changes to database via SQL |
| Commit | Finalizing database transaction |
| Detached Entity | Entity object no longer managed |
| Merge | Copying detached state into managed instance |
| Proxy | Placeholder object used for lazy loading |
| Weaving/Enhancement | Bytecode modification to support lazy loading, dirty tracking, etc. |
| Fetch Plan | Strategy for what data graph to load and how |
| N+1 | One initial query plus one query per row/association |
| Cartesian Explosion | Join multiplication from fetching multiple collections |
| Second-Level Cache | Cache shared beyond one persistence context |
| Dialect | Provider’s database-specific SQL behavior layer |
| Optimistic Locking | Conflict detection using version/timestamp |
| Pessimistic Locking | Database lock acquisition to block conflicting updates |

---

## 35. Mini Case Study: Why “Simple CRUD” Fails in Real Systems

Imagine a regulatory case system.

Requirements:

1. Officer can approve or reject case.
2. Every decision must be auditable.
3. Documents can be attached.
4. A case can be reassigned.
5. SLA timer depends on status.
6. Dashboard shows pending cases.
7. Search page filters by applicant, officer, status, date, and agency.
8. Multiple officers may open same case.
9. Admin can correct metadata but not rewrite decision history.
10. Old audit data must be archived.

Naive CRUD model:

```java
caseRepository.save(case);
```

This hides too much.

A robust persistence design asks:

- Is `CaseApplication` an aggregate root?
- Are `CaseDocument` rows owned by case?
- Is `Officer` a separate aggregate?
- Should `CaseHistory` be append-only?
- Should approval be represented as current status plus immutable decision row?
- Which queries need projections?
- Which associations are lazy?
- Which use cases need optimistic lock?
- Which update requires pessimistic lock?
- Which data can be cached?
- Which data must never be cached?
- Which delete is physical vs soft delete?
- Which table grows unbounded?
- Which query must be paginated by keyset?
- Which batch job must clear persistence context?
- Which mapping change requires migration script?

This is the difference between “can use ORM” and “can engineer persistence layer”.

---

## 36. Practice: Questions to Ask Before Writing an Entity

Before creating an entity mapping, answer:

1. What is the table’s lifecycle?
2. Is this an aggregate root or child entity?
3. Who owns the foreign key?
4. Can this entity be deleted physically?
5. Is it shared by multiple aggregates?
6. Does it need optimistic locking?
7. Which fields are immutable after creation?
8. Which fields are audit-sensitive?
9. Which associations should never cascade remove?
10. Which collection can grow unbounded?
11. Which fields are used for search/filter/sort?
12. Which queries need projection instead of entity load?
13. Which use cases need lazy loading?
14. Which use cases need explicit fetch join/entity graph?
15. Which operations are bulk operations?
16. Which operations can conflict concurrently?
17. Which database constraints enforce invariants?
18. Which invariants must be enforced in domain code?
19. Which provider-specific extension is justified?
20. How will we test generated SQL and failure modes?

---

## 37. Design Rules From Part 0

1. ORM is a state synchronization engine, not only a mapper.
2. Always distinguish specification, provider, and database behavior.
3. Entity lifecycle state determines whether changes are tracked.
4. Persistence context is a unit of work and identity map.
5. Dirty checking means update can happen without explicit save.
6. Flush is not commit.
7. Fetch plan must be designed per use case.
8. Mapping determines SQL shape and lifecycle behavior.
9. Cascade must follow ownership, not convenience.
10. API DTOs should not be treated as detached entities.
11. Projections are often better for read models.
12. `@Version` is essential for mutable concurrent aggregates.
13. Cache must be designed for correctness, not only speed.
14. Schema migration belongs to a disciplined migration pipeline.
15. Provider-specific extension is acceptable when justified.
16. Real database testing is necessary for critical ORM behavior.
17. Observability must connect Java request to SQL shape.
18. ORM should be used where it strengthens consistency, not where it hides expensive query workloads.

---

## 38. What Comes Next

Part 1 will go deeper into:

```text
JPA Specification vs Provider Reality
```

We will examine:

- what the spec guarantees;
- what it intentionally leaves open;
- how Hibernate and EclipseLink diverge;
- portability myths;
- why provider-specific behavior matters;
- how to build a safe compatibility mental model for Java 8–25.

---

## 39. References

- Jakarta Persistence 3.2 Specification, Final Release, April 10, 2024: https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Jakarta Persistence project repository and current release notes: https://github.com/jakartaee/persistence
- Hibernate ORM releases: https://hibernate.org/orm/releases/
- Hibernate ORM 8.0 development line notice: https://hibernate.org/orm/releases/8.0/
- EclipseLink 4.0 release notes: https://eclipse.dev/eclipselink/releases/4.0.html
- EclipseLink 4.0 documentation: https://eclipse.dev/eclipselink/documentation/4.0/solutions/solutions.html
- OpenJDK JDK 25 project page: https://openjdk.org/projects/jdk/25/
- Oracle JDK 25 release note: https://docs.oracle.com/iaas/releasenotes/java-management/jdk-25-release-note.htm

---

## 40. Status Seri

Seri belum selesai. Ini adalah bagian 0 dari 34 bagian.

Bagian berikutnya:

```text
01-jpa-specification-vs-provider-reality.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](../../cammunda/learn-java-bpmn-camunda-part-30-capstone-end-to-end-regulatory-case-management-java-camunda.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 1 — JPA Specification vs Provider Reality](./01-jpa-specification-vs-provider-reality.md)

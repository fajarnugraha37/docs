# Part 3 — Entity Identity: Java Object Identity, Database Identity, Persistence Context Identity

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Bagian: `03-entity-identity-java-database-persistence-context.md`  
> Target: Java 8–25, JPA 2.1/2.2 `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4.

---

## 0. Executive Summary

Entity identity adalah salah satu konsep paling penting dalam ORM, tetapi sering dianggap remeh karena terlihat sederhana: “entity punya primary key”. Pada level production, kalimat itu tidak cukup.

Dalam sistem JPA provider seperti Hibernate ORM atau EclipseLink, minimal ada beberapa bentuk identity yang harus dipisahkan dengan jelas:

1. **Java object identity** — apakah dua reference menunjuk object instance yang sama, diuji dengan `==`.
2. **Java logical equality** — apakah dua object dianggap sama menurut `equals()` dan `hashCode()`.
3. **Database identity** — apakah dua row memiliki primary key yang sama.
4. **Persistent entity identity** — identity entity menurut JPA provider dalam satu persistence context.
5. **Business/natural identity** — identity dari domain, misalnya license number, email, case number, application reference number.
6. **Detached identity** — object di luar persistence context yang masih membawa database identifier.
7. **Proxy identity** — entity reference yang belum fully initialized tetapi mewakili row tertentu.

Jakarta Persistence specification menyatakan bahwa setiap entity harus memiliki primary key, dan primary key value mengidentifikasi entity instance secara unik di dalam persistence context dan operasi `EntityManager`. Specification juga mendefinisikan persistence context sebagai sekumpulan managed entity instances di mana untuk setiap persistent entity identity hanya ada satu entity instance unik. Konsep ini menjadi dasar identity map dan unit of work. Referensi: Jakarta Persistence 3.2 specification tentang primary key dan entity identity, serta Jakarta Persistence 3.1 definition persistence context. [^jakarta-identity] [^jakarta-pc]

Hibernate documentation modern juga menekankan bahwa `equals()`/`hashCode()` pada entity perlu dipikirkan hati-hati, terutama ketika identifier di-generate setelah persist; Hibernate menyarankan natural id sebagai kandidat implementasi equality jika tersedia. [^hibernate-equals]

EclipseLink documentation menjelaskan object identity melalui identity map/cache: multiple retrievals terhadap object yang sama dapat menghasilkan reference ke object instance yang sama dalam konteks cache tertentu, dan EclipseLink memiliki beberapa identity map untuk mempertahankan object identity berbasis primary key. [^eclipselink-identity]

Inti part ini:

> ORM identity bukan hanya soal “ada kolom id”. Identity adalah invariant yang menjaga agar object graph, persistence context, SQL operation, cache, dan transaction tetap konsisten.

Jika identity salah, bug yang muncul biasanya bukan compile error. Ia muncul sebagai:

- duplicate insert,
- unexpected update,
- lost update,
- `NonUniqueObjectException`,
- entity hilang dari `HashSet`,
- lazy proxy equality error,
- merge overwrite,
- stale detached object,
- cascade ke object yang salah,
- collection orphan tidak terhapus,
- cache inconsistent,
- authorization/data leakage karena entity dianggap sama padahal tenant berbeda.

---

## 1. Why This Matters

ORM bekerja dengan object. Database bekerja dengan row. Java collection bekerja dengan `equals()` dan `hashCode()`. Transaction bekerja dengan snapshot dan isolation. Cache bekerja dengan key. API bekerja dengan DTO. Semua layer itu memerlukan jawaban atas pertanyaan yang tampak sederhana:

> “Dua benda ini sama atau tidak?”

Masalahnya, jawaban “sama” berbeda tergantung layer.

Contoh sederhana:

```java
Application a1 = entityManager.find(Application.class, 10L);
Application a2 = entityManager.find(Application.class, 10L);

System.out.println(a1 == a2);      // biasanya true dalam persistence context yang sama
System.out.println(a1.equals(a2)); // tergantung implementasi equals
```

Dalam satu persistence context, JPA provider wajib menjaga bahwa persistent identity yang sama direpresentasikan oleh satu managed entity instance. Maka `a1 == a2` biasanya benar jika entity class dan primary key sama.

Tetapi jika diambil dari dua transaction berbeda:

```java
Application a1 = serviceA.load(10L); // transaction 1
Application a2 = serviceB.load(10L); // transaction 2

System.out.println(a1 == a2);       // false
System.out.println(a1.getId().equals(a2.getId())); // true
```

Database identity sama, object identity berbeda.

Jika entity masuk ke `HashSet`, dikirim ke API, di-merge kembali, dibandingkan dengan proxy, atau dipakai dalam bidirectional association, perbedaan ini menjadi sumber bug.

### 1.1 Kenapa engineer senior tetap sering salah di sini?

Karena identity sering disederhanakan menjadi salah satu dari dua ekstrem:

1. **“Pakai ID saja di equals/hashCode.”**  
   Ini bermasalah untuk entity baru yang belum punya generated ID.

2. **“Jangan override equals/hashCode sama sekali.”**  
   Ini aman di beberapa kasus, tetapi bermasalah ketika entity dipakai lintas persistence context, dalam `Set`, di DTO mapping, atau dalam domain model yang butuh logical equality.

Jawaban benar bukan satu template global. Jawaban benar bergantung pada:

- apakah entity punya immutable natural key,
- apakah ID generated atau assigned,
- apakah object pernah masuk collection sebelum persisted,
- apakah entity digunakan sebagai aggregate root atau child,
- apakah entity sering detached,
- apakah ada proxy/lazy loading,
- apakah ada multi-tenancy,
- apakah equality dibutuhkan di domain layer atau hanya persistence layer.

---

## 2. Core Mental Model: Identity Is a Contract, Not a Field

Jangan mulai dari annotation. Mulai dari invariant.

### 2.1 Identity invariant utama dalam ORM

Sebuah ORM provider harus menjaga beberapa invariant:

```text
Dalam satu persistence context:

(entity class, primary key) -> tepat satu managed Java object instance
```

Artinya, jika persistence context sudah memiliki `Application#10`, lalu query lain mengembalikan row `Application#10`, provider tidak membuat managed object baru yang berbeda. Provider mengembalikan instance yang sudah ada atau menggabungkan hasil query ke instance tersebut.

Ini disebut **identity map**.

```text
Database row identity:
  APPLICATION.ID = 10

Persistence context identity:
  EntityKey(Application.class, 10) -> Java object reference X

Java heap:
  reference a1 -> X
  reference a2 -> X
```

Dalam persistence context lain:

```text
Persistence Context A:
  EntityKey(Application.class, 10) -> Java object reference X

Persistence Context B:
  EntityKey(Application.class, 10) -> Java object reference Y

X != Y
X.id == Y.id
```

### 2.2 Identity tidak selalu sama dengan equality

`equals()` adalah kontrak Java. Ia tidak otomatis sama dengan database identity.

```java
application1 == application2
```

menjawab:

> Apakah dua reference menunjuk object instance yang sama?

```java
application1.equals(application2)
```

menjawab:

> Apakah domain/class menganggap dua object ini sama?

```java
application1.getId().equals(application2.getId())
```

menjawab:

> Apakah dua object memiliki database identifier yang sama?

```java
application1.getReferenceNo().equals(application2.getReferenceNo())
```

menjawab:

> Apakah dua object memiliki business/natural identity yang sama?

Tidak semua pertanyaan itu harus punya jawaban sama.

---

## 3. The Identity Layers

Mari bedah satu per satu.

---

## 3.1 Java Object Identity

Java object identity adalah identity level heap.

```java
User u1 = new User();
User u2 = new User();

u1 == u2; // false
```

Walaupun semua field sama, `u1` dan `u2` adalah object instance berbeda.

```java
User u3 = u1;

u1 == u3; // true
```

Object identity penting karena persistence context menyimpan managed entity instance. Dalam satu persistence context, provider memastikan persistent identity yang sama hanya punya satu object instance.

### 3.1.1 Kenapa object identity penting untuk dirty checking?

Dirty checking bekerja terhadap managed object instance.

```java
Application app = entityManager.find(Application.class, 10L);
app.setStatus(Status.APPROVED);
```

Provider tidak membutuhkan `save(app)` di JPA murni karena `app` adalah managed object. Saat flush, provider melihat managed instance berubah.

Jika Anda membuat object lain dengan ID sama:

```java
Application detachedLike = new Application();
detachedLike.setId(10L);
detachedLike.setStatus(Status.REJECTED);
```

Object ini bukan managed hanya karena ID-nya sama. Provider tidak otomatis tracking object tersebut.

### 3.1.2 Mental model

```text
ID sama tidak membuat object menjadi managed.
Object reference yang managed-lah yang ditrack.
```

---

## 3.2 Java Logical Equality

Java logical equality ditentukan oleh `equals()` dan `hashCode()`.

Default dari `Object`:

```java
public boolean equals(Object obj) {
    return this == obj;
}

public int hashCode() {
    return identityBasedHash;
}
```

Jika entity tidak override `equals()` dan `hashCode()`, equality sama dengan object identity.

Ini aman untuk banyak persistence operation sederhana, tetapi bisa bermasalah jika entity:

- dipakai dalam `Set`,
- dibandingkan lintas persistence context,
- menjadi child collection dengan `orphanRemoval`,
- dikirim detached lalu dibandingkan kembali,
- dipakai dalam domain logic yang butuh business equality.

### 3.2.1 Equality harus stabil

Java collection seperti `HashSet` mengasumsikan hash code object stabil selama object berada di dalam collection.

Masalah klasik:

```java
@Entity
public class Applicant {
    @Id
    @GeneratedValue
    private Long id;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Applicant other)) return false;
        return Objects.equals(id, other.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

Lalu:

```java
Set<Applicant> set = new HashSet<>();
Applicant applicant = new Applicant();

set.add(applicant);       // hash based on id=null
entityManager.persist(applicant);
entityManager.flush();    // id becomes 100

set.contains(applicant);  // may be false
```

Kenapa? Karena `hashCode()` berubah setelah ID assigned.

### 3.2.2 Generated ID membuat equality sulit

Dengan generated ID, sebelum persist:

```text
new entity -> id = null
```

Setelah flush/persist tergantung generation strategy:

```text
managed entity -> id = generated value
```

Jika `equals/hashCode` hanya memakai ID, object berubah identity secara logical di tengah lifecycle.

### 3.2.3 Tidak override juga bukan selalu solusi

Jika tidak override:

```java
Application a1 = tx1.find(Application.class, 10L); // detached after tx
Application a2 = tx2.find(Application.class, 10L); // detached after tx

Set<Application> apps = new HashSet<>();
apps.add(a1);
apps.add(a2);

apps.size(); // 2, walaupun database row sama
```

Ini mungkin benar atau salah tergantung kebutuhan domain.

---

## 3.3 Database Identity

Database identity biasanya primary key.

```sql
CREATE TABLE application (
    id BIGINT PRIMARY KEY,
    reference_no VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(30) NOT NULL
);
```

JPA specification mensyaratkan setiap entity memiliki primary key. Primary key value mengidentifikasi entity instance secara unik dalam persistence context dan operasi `EntityManager`. [^jakarta-identity]

Database identity punya karakteristik:

- unik di table,
- stabil setelah assigned,
- menjadi target foreign key,
- digunakan provider untuk identity map,
- digunakan second-level cache sebagai key,
- digunakan delete/update SQL.

### 3.3.1 Primary key bukan selalu business identity

Contoh:

```text
id = 12345
reference_no = APP-2026-000001
```

`id` adalah surrogate key. `reference_no` adalah business key.

Untuk database dan foreign key, `id` lebih efisien dan stabil. Untuk domain, `reference_no` mungkin lebih bermakna.

### 3.3.2 Surrogate ID vs Natural ID

#### Surrogate ID

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE)
private Long id;
```

Kelebihan:

- kecil,
- efisien untuk index dan FK,
- tidak berubah karena perubahan bisnis,
- tidak mengekspos business data.

Kekurangan:

- belum tersedia sebelum persist jika generated,
- tidak punya makna domain,
- equality perlu hati-hati.

#### Natural ID

Contoh:

```java
@Column(nullable = false, unique = true, updatable = false)
private String referenceNo;
```

Kelebihan:

- meaningful,
- bisa tersedia sebelum persist,
- dapat dipakai equality jika immutable.

Kekurangan:

- bisnis sering berubah pikiran,
- bisa panjang,
- bisa memiliki format migration,
- bisa tenant-scoped, bukan globally unique.

### 3.3.3 Assigned ID

Assigned ID dibuat aplikasi sebelum persist.

```java
Application app = new Application();
app.setId(UUID.randomUUID());
entityManager.persist(app);
```

Keuntungan:

- ID tersedia sejak object dibuat,
- lebih mudah untuk equality berbasis ID,
- cocok untuk distributed system,
- bisa menghindari dependency pada sequence/identity untuk ID awal.

Risiko:

- collision jika generator buruk,
- ID semantic leak,
- ukuran index lebih besar jika UUID textual,
- ordering/randomness berdampak ke B-tree index,
- application bug bisa meng-insert duplicate.

---

## 3.4 Persistence Context Identity

Persistence context adalah unit identity paling penting dalam JPA runtime.

Specification mendefinisikan persistence context sebagai set of managed entity instances di mana untuk setiap persistent entity identity ada unique entity instance. [^jakarta-pc]

Mental model:

```text
PersistenceContext
  Map<EntityKey, ManagedEntity>

EntityKey = (entityName/entityClass, primaryKey)
```

Contoh:

```java
Application a1 = em.find(Application.class, 10L);
Application a2 = em.createQuery("select a from Application a where a.id = :id", Application.class)
    .setParameter("id", 10L)
    .getSingleResult();

assert a1 == a2;
```

Keduanya menunjuk managed instance yang sama.

### 3.4.1 Identity map prevents split brain inside one transaction

Tanpa identity map:

```text
Object A: Application#10 status=PENDING
Object B: Application#10 status=APPROVED
```

Dalam transaction yang sama, provider tidak tahu mana yang benar.

Dengan identity map:

```text
Application#10 -> one object
```

Semua query, association navigation, dan `find()` mengarah ke object yang sama.

### 3.4.2 Query result tidak selalu fresh dari DB secara object state

Jika persistence context sudah punya entity:

```java
Application app = em.find(Application.class, 10L);
app.setStatus(Status.APPROVED);

Application again = em.createQuery(
    "select a from Application a where a.id = :id", Application.class)
    .setParameter("id", 10L)
    .getSingleResult();
```

`again` adalah object yang sama dengan `app`. Query tidak berarti semua field diganti dari DB. Provider harus menjaga identity context.

Jika ingin reload dari database:

```java
em.refresh(app);
```

Atau clear context:

```java
em.clear();
Application fresh = em.find(Application.class, 10L);
```

Tetapi keduanya punya konsekuensi besar.

---

## 3.5 Business or Natural Identity

Business identity adalah identity menurut domain.

Contoh:

- `caseNumber`,
- `applicationReferenceNo`,
- `licenseNumber`,
- `email`,
- `nationalId`,
- `tenantId + externalReferenceNo`,
- `countryCode + registrationNo`.

Business identity bisa dipakai untuk:

- uniqueness constraint,
- idempotency,
- external integration,
- audit lookup,
- user-facing reference,
- equality jika immutable dan benar-benar unique.

Namun business identity harus dianalisis ketat.

### 3.5.1 Natural identity harus immutable jika dipakai equality

Jika `referenceNo` bisa berubah, jangan pakai untuk `equals/hashCode`.

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Application other)) return false;
    return Objects.equals(referenceNo, other.referenceNo);
}

@Override
public int hashCode() {
    return Objects.hash(referenceNo);
}
```

Ini hanya aman jika:

```java
@Column(nullable = false, unique = true, updatable = false)
private String referenceNo;
```

Dan value assigned sebelum object masuk collection.

### 3.5.2 Natural identity sering tenant-scoped

Contoh:

```text
tenant_id = A, reference_no = APP-001
tenant_id = B, reference_no = APP-001
```

Jika equality hanya pakai `referenceNo`, data tenant bisa tercampur.

Lebih benar:

```java
return Objects.equals(tenantId, other.tenantId)
    && Objects.equals(referenceNo, other.referenceNo);
```

Atau jangan pakai equality natural key jika tenant context tidak selalu tersedia.

---

## 4. Entity Lifecycle and Identity Timing

Identity tidak statis sepanjang lifecycle.

JPA entity states:

```text
transient/new -> managed -> detached
                managed -> removed
```

### 4.1 Transient/New Entity

```java
Application app = new Application();
app.setReferenceNo("APP-2026-0001");
```

Belum dikenal persistence context.

```text
Java object exists.
Database row does not exist.
Persistence context does not track it.
Generated ID may be null.
```

### 4.2 Managed Entity

```java
em.persist(app);
```

Sekarang entity managed. Tetapi ID timing tergantung generation strategy.

#### SEQUENCE

Provider bisa mengambil sequence value sebelum insert.

```text
persist() -> select nextval -> id assigned -> insert later at flush
```

#### IDENTITY

Database menghasilkan ID saat insert.

```text
persist() -> insert may happen early -> id assigned after insert
```

Hibernate sering perlu execute insert lebih awal untuk IDENTITY karena ID baru diketahui setelah database insert.

#### UUID assigned by application

```text
constructor/factory -> id assigned before persist
```

### 4.3 Detached Entity

Detached entity punya ID tetapi tidak lagi managed.

```java
Application app = service.load(10L); // transaction ends
app.setStatus(Status.APPROVED);      // no automatic dirty checking
```

Perubahan tidak otomatis persisted.

Untuk menyimpan:

```java
Application managed = em.merge(app);
```

Penting:

> `merge()` tidak membuat object detached menjadi managed. `merge()` menyalin state detached object ke managed instance dan mengembalikan managed instance.

```java
Application detached = ...;
Application managed = em.merge(detached);

detached == managed; // false, generally
```

### 4.4 Removed Entity

```java
Application app = em.find(Application.class, 10L);
em.remove(app);
```

Entity marked removed. Dalam persistence context, object masih ada sampai flush/commit, tetapi lifecycle-nya removed.

### 4.5 Lifecycle identity table

| State | Java object exists | DB row exists | Managed by PC | Generated ID available | Dirty checked |
|---|---:|---:|---:|---:|---:|
| transient/new | yes | no | no | maybe no | no |
| managed | yes | maybe/yes | yes | usually yes | yes |
| detached | yes | yes/maybe | no | yes | no |
| removed | yes | yes until delete flush | yes | yes | special |

---

## 5. Primary Key Strategy and Identity Consequences

Primary key strategy affects:

- equality,
- batching,
- insert timing,
- object construction,
- distributed ID generation,
- foreign key assignment,
- audit trail,
- migration,
- replication,
- sharding/multi-tenancy.

---

## 5.1 `GenerationType.IDENTITY`

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Database generates ID on insert.

### Pros

- simple,
- common in MySQL/PostgreSQL serial/identity style,
- no sequence object needed.

### Cons

- ID unknown until insert,
- insert may need to happen earlier,
- can reduce JDBC batching effectiveness,
- equality based on ID unstable before persist,
- parent-child graph may require careful insert ordering.

### Production concern

For high-volume insert workloads, IDENTITY can become limiting because provider cannot freely delay all inserts and batch them the same way as sequence-based IDs.

---

## 5.2 `GenerationType.SEQUENCE`

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "application_seq")
@SequenceGenerator(
    name = "application_seq",
    sequenceName = "application_seq",
    allocationSize = 50
)
private Long id;
```

### Pros

- ID can be known before insert,
- better batching potential,
- allocation/pooling can reduce DB sequence calls,
- good for Oracle/PostgreSQL.

### Cons

- sequence config must match DB,
- allocation size mismatch can surprise teams,
- gaps are normal,
- migration can break if sequence behind table max ID.

### Mental model

```text
Sequence ID is not proof row exists.
It is a reserved identity candidate.
```

Object may have ID before insert. That does not mean database row already exists.

---

## 5.3 `GenerationType.TABLE`

```java
@Id
@GeneratedValue(strategy = GenerationType.TABLE)
private Long id;
```

Usually avoided in serious production unless there is a strong reason.

Risks:

- contention on generator table,
- worse scalability,
- additional transaction complexity,
- operational overhead.

---

## 5.4 `GenerationType.AUTO`

```java
@Id
@GeneratedValue(strategy = GenerationType.AUTO)
private Long id;
```

Provider chooses strategy based on dialect/provider defaults.

Risk:

- behavior changes across provider/dialect/version,
- migration from Hibernate 5 to 6/7 can alter defaults,
- hard to reason about batching and insert timing.

For advanced engineering, prefer explicit strategy.

---

## 5.5 UUID Primary Key

Common options:

```java
@Id
private UUID id;
```

Assigned in app:

```java
public Application() {
    this.id = UUID.randomUUID();
}
```

Or provider-generated if supported by provider/version.

### Pros

- ID available before persist,
- distributed-friendly,
- no sequence round trip,
- easier idempotency in APIs,
- can create child references before DB insert.

### Cons

- larger index,
- random UUID can fragment B-tree,
- textual UUID is worse than binary/native UUID,
- not naturally ordered,
- accidental ID exposure may reveal less than sequence but still needs policy.

### Advanced note

UUID v7/time-ordered identifiers are often better for index locality than v4 random UUID, but support varies across stack and database. Treat this as architecture decision, not annotation trivia.

---

## 6. Composite Identity

Composite identity means primary key consists of more than one column.

Common examples:

```text
tenant_id + reference_no
country_code + registration_no
application_id + document_seq
case_id + task_id
```

JPA supports:

- `@EmbeddedId`,
- `@IdClass`.

---

## 6.1 `@EmbeddedId`

```java
@Embeddable
public class ApplicationId implements Serializable {
    private String tenantId;
    private String referenceNo;

    protected ApplicationId() {}

    public ApplicationId(String tenantId, String referenceNo) {
        this.tenantId = Objects.requireNonNull(tenantId);
        this.referenceNo = Objects.requireNonNull(referenceNo);
    }

    public String getTenantId() {
        return tenantId;
    }

    public String getReferenceNo() {
        return referenceNo;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ApplicationId other)) return false;
        return Objects.equals(tenantId, other.tenantId)
            && Objects.equals(referenceNo, other.referenceNo);
    }

    @Override
    public int hashCode() {
        return Objects.hash(tenantId, referenceNo);
    }
}
```

```java
@Entity
public class Application {
    @EmbeddedId
    private ApplicationId id;

    protected Application() {}

    public Application(ApplicationId id) {
        this.id = Objects.requireNonNull(id);
    }
}
```

### Pros

- identity object explicit,
- good domain modeling,
- equality concentrated in ID class,
- safer for tenant-scoped natural keys.

### Cons

- queries more verbose,
- relationships with `@MapsId` more complex,
- DTO mapping needs care,
- ID object must be immutable or treated as immutable.

---

## 6.2 `@IdClass`

```java
public class ApplicationId implements Serializable {
    private String tenantId;
    private String referenceNo;

    public ApplicationId() {}

    // equals/hashCode required
}
```

```java
@Entity
@IdClass(ApplicationId.class)
public class Application {
    @Id
    private String tenantId;

    @Id
    private String referenceNo;
}
```

### Pros

- entity fields directly accessible,
- sometimes simpler JPQL,
- aligns with legacy models.

### Cons

- duplicate field declaration conceptually,
- ID class must mirror entity fields exactly,
- easier to make mistakes,
- weaker encapsulation.

---

## 6.3 Composite key rule

Composite key is not wrong. But it must be chosen because it expresses a real invariant, not because “we don’t want surrogate ID”.

Good use cases:

- join entity with meaningful composite identity,
- tenant-scoped external key,
- immutable reference key,
- legacy schema.

Bad use cases:

- mutable business fields,
- very wide keys repeated in many foreign keys,
- uncertain future business rules,
- frequent key migration.

---

## 7. Equality Patterns for Entities

There is no one-size-fits-all equality pattern. But there are safe families of patterns.

---

## 7.1 Pattern A — Do Not Override `equals/hashCode`

```java
@Entity
public class AuditTrail {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    // no equals/hashCode override
}
```

### Good for

- entities not compared across persistence contexts,
- append-only audit/event rows,
- technical records,
- entities not stored in `Set`,
- entity identity is purely persistence identity.

### Pros

- no hash mutation bug,
- proxy complexity reduced,
- simple.

### Cons

- two detached objects for same row are not equal,
- `Set` may contain duplicates for same DB row,
- domain equality unavailable.

### Rule

This is often safer than bad equality. But not always sufficient.

---

## 7.2 Pattern B — Immutable Natural Key Equality

```java
@Entity
public class Application {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Column(nullable = false, unique = true, updatable = false)
    private String referenceNo;

    protected Application() {}

    public Application(String referenceNo) {
        this.referenceNo = Objects.requireNonNull(referenceNo);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Application other)) return false;
        return Objects.equals(referenceNo, other.referenceNo);
    }

    @Override
    public int hashCode() {
        return Objects.hash(referenceNo);
    }
}
```

### Good for

- immutable business key exists,
- key assigned before persist,
- globally unique or scoped correctly,
- domain equality needed.

### Pros

- stable before and after persist,
- works across persistence contexts,
- aligns with domain.

### Cons

- dangerous if business key later becomes mutable,
- dangerous if uniqueness is tenant-scoped but tenant omitted,
- string normalization/case-sensitivity issues.

### Rule

Natural key equality is excellent only when natural key is truly immutable and unique in the same scope as equality.

---

## 7.3 Pattern C — Assigned ID Equality

```java
@Entity
public class Document {
    @Id
    private UUID id;

    protected Document() {}

    public Document(UUID id) {
        this.id = Objects.requireNonNull(id);
    }

    public static Document createNew() {
        return new Document(UUID.randomUUID());
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Document other)) return false;
        return Objects.equals(id, other.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

### Good for

- UUID assigned at construction,
- distributed systems,
- entity may be compared before persist,
- ID is immutable.

### Pros

- stable equality,
- database identity and Java equality align,
- works detached.

### Cons

- requires robust ID assignment discipline,
- not ideal with DB-generated numeric ID,
- index/storage considerations.

---

## 7.4 Pattern D — Generated ID With Constant Hash Code

Some teams use a pattern like:

```java
@Entity
public class Application {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Application other)) return false;
        return id != null && Objects.equals(id, other.id);
    }

    @Override
    public int hashCode() {
        return getClass().hashCode();
    }
}
```

### Rationale

- If ID null, entity only equals itself.
- If ID non-null, compare by ID.
- Constant hash avoids hash mutation after ID assignment.

### Pros

- avoids `HashSet` bucket movement after persist,
- handles generated ID better than `hashCode = Objects.hash(id)`.

### Cons

- hash distribution poor for large sets of same entity type,
- proxy class issue if using `getClass()` naively,
- still not domain equality,
- can be surprising.

### Rule

This pattern is usable but must be intentional. Do not apply blindly across all entities.

---

## 7.5 Pattern E — Business Method Equality Instead of `equals()`

Sometimes the safest option is not overriding `equals()`, but adding explicit comparison:

```java
public boolean sameBusinessIdentity(Application other) {
    return other != null
        && Objects.equals(this.tenantId, other.tenantId)
        && Objects.equals(this.referenceNo, other.referenceNo);
}
```

### Good for

- domain comparison needed only in specific places,
- entity equality too risky,
- generated IDs,
- mixed lifecycle states.

### Pros

- explicit semantics,
- avoids global equality contract pitfalls,
- supports multiple comparison meanings.

### Cons

- Java collections still use reference equality,
- developers must remember to call the right method.

---

## 8. Proxy-Safe Equality

ORM providers often use proxies for lazy loading.

```java
Application app = em.getReference(Application.class, 10L);
```

`app` may be a proxy subclass rather than actual entity class.

### 8.1 `getClass()` problem

```java
if (getClass() != o.getClass()) return false;
```

Can fail if one object is a proxy subclass.

```text
Application.class != Application$HibernateProxy.class
```

### 8.2 `instanceof` problem

```java
if (!(o instanceof Application)) return false;
```

Usually proxy-friendly, but may become too permissive in inheritance hierarchies.

### 8.3 Practical rule

For entity hierarchies and proxies, equality strategy must be tested with:

- actual entity loaded via `find`,
- proxy loaded via `getReference`,
- detached entity,
- subclass entity if inheritance exists.

Example test:

```java
@Test
void equalityShouldWorkWithProxy() {
    Application found = em.find(Application.class, id);
    Application proxy = em.getReference(Application.class, id);

    assertThat(found).isEqualTo(proxy);
    assertThat(proxy).isEqualTo(found);
}
```

Do not assume equality works just because unit test with `new Application()` passes.

---

## 9. Hibernate Behavior

Hibernate represents persistence context identity internally using entity keys. The exact internal classes vary by version, but the concept remains:

```text
EntityKey(entityPersister, identifier) -> entity instance
```

### 9.1 Same ID, same Session, one instance

```java
Session session = entityManager.unwrap(Session.class);

Application a1 = session.get(Application.class, 10L);
Application a2 = session.get(Application.class, 10L);

assert a1 == a2;
```

### 9.2 NonUniqueObjectException scenario

Classic problem:

```java
Application managed = em.find(Application.class, 10L);

Application another = new Application();
another.setId(10L);

em.persist(another); // or session.update(another) in native Hibernate style
```

Hibernate cannot have two different object instances representing the same persistent identity in one session.

Conceptually:

```text
PersistenceContext already has:
  Application#10 -> object A

You try to associate:
  Application#10 -> object B

This violates identity map.
```

### 9.3 `merge()` resolves by copying

```java
Application detached = new Application();
detached.setId(10L);
detached.setStatus(Status.APPROVED);

Application managed = em.merge(detached);
```

Hibernate finds or creates managed instance for `Application#10`, then copies state from detached object.

Danger:

```java
detached.setStatus(Status.APPROVED);
Application managed = em.merge(detached);

detached.setStatus(Status.REJECTED); // not tracked
```

Only `managed` is tracked.

### 9.4 Hibernate natural id

Hibernate has provider-specific support for natural IDs via `@NaturalId`. This can improve lookup and caching of immutable natural identity. But `@NaturalId` is not the same as Java `equals()`. It is a Hibernate mapping/query/cache feature.

Mental rule:

```text
Natural ID mapping can support identity lookup.
It does not automatically solve Java equality.
```

### 9.5 Hibernate equals/hashCode guidance

Hibernate modern guide recommends caution with generated identifiers and suggests natural id attributes for equality when appropriate. [^hibernate-equals]

Practical translation:

- do not blindly use generated ID in hashCode if entity enters hash collections before ID assigned,
- prefer immutable natural key if available,
- otherwise consider reference equality or carefully designed generated ID equality.

---

## 10. EclipseLink Behavior

EclipseLink has a strong identity map/cache model. Documentation describes that object identity means each object in memory is represented by one object instance, and multiple retrievals of the same object can return references to the same object instance. EclipseLink supports multiple identity maps, including composite primary keys. [^eclipselink-identity]

### 10.1 UnitOfWork and clones

EclipseLink internally has a UnitOfWork model. Advanced API documentation describes UnitOfWork operating on its own object space, with clones of original objects used for editing. [^eclipselink-uow]

In JPA usage, this is abstracted behind `EntityManager`, but understanding the model helps:

```text
Shared cache object may exist.
UnitOfWork/PersistenceContext works with managed working copies.
Commit merges changes back.
```

### 10.2 Shared cache implication

EclipseLink has historically emphasized shared object cache. Documentation notes EclipseLink can cache objects based on class and primary key values, and its `@Cache` extension configures object cache. [^eclipselink-cache]

This means identity and caching require careful thinking:

- persistence context identity,
- shared cache identity,
- detached object identity,
- stale object risk.

### 10.3 EclipseLink-specific caution

If you move between Hibernate and EclipseLink, do not assume:

- same lazy loading mechanics,
- same weaving/enhancement behavior,
- same cache defaults,
- same object identity behavior across shared cache boundaries,
- same merge behavior edge cases.

The JPA contract is shared; provider internals are not identical.

---

## 11. Detached Entity Identity

Detached entity is the most dangerous state for identity bugs.

```java
Application app = service.loadApplication(10L); // returned after transaction
```

Now:

```text
app.id = 10
app is not managed
app may be stale
app may be modified outside transaction
app may lack lazy fields
app may be sent to UI/API
```

### 11.1 Detached object is not a row lock

Having detached object does not mean row is reserved or current.

```text
T1 loads Application#10 status=PENDING
T1 returns detached object
T2 approves Application#10
T1 modifies detached object and merges
```

Without optimistic locking, T1 may overwrite T2.

### 11.2 Detached identity plus stale state

Detached object carries identity and old field values. Merge copies state.

```java
Application detached = apiRequestToEntity(request);
detached.setId(10L);

em.merge(detached);
```

If request did not include all fields, missing fields may become `null` and overwrite database state.

This is not strictly identity bug, but identity enables the overwrite.

### 11.3 Safer update pattern

Instead of merge detached request entity:

```java
@Transactional
public void approve(Long id, ApproveCommand command) {
    Application app = em.find(Application.class, id);
    app.approve(command.getApproverId(), command.getReason());
}
```

This ensures:

- managed entity loaded in current transaction,
- provider tracks exact managed object,
- domain method enforces invariant,
- optimistic lock can detect conflict,
- no detached graph overwrite.

---

## 12. Identity and Collections

Entity identity directly affects collection semantics.

### 12.1 `List` vs `Set`

```java
@OneToMany(mappedBy = "application")
private Set<Document> documents = new HashSet<>();
```

`Set` relies on `equals/hashCode`.

If child entity has generated ID and bad hashCode:

```java
Document doc = new Document();
application.getDocuments().add(doc);
entityManager.persist(application);
entityManager.flush(); // doc.id changes from null to generated

application.getDocuments().contains(doc); // may fail
```

### 12.2 Child equality should often be parent-scoped

Suppose document sequence is unique only inside application:

```text
Application#1 Document#1
Application#2 Document#1
```

Natural equality for `Document` may be:

```text
application identity + document number
```

But if `application` is a proxy or transient, equality gets complex.

Often safer:

- use `List` for aggregate child collection,
- enforce uniqueness in domain method and database constraint,
- avoid relying on child entity `Set` equality unless identity is stable.

### 12.3 Collection remove depends on equality

```java
application.getDocuments().remove(documentFromRequest);
```

If `documentFromRequest` is detached or newly constructed with same ID but equality is reference-based, remove may fail.

Better:

```java
application.removeDocumentById(documentId);
```

```java
public void removeDocumentById(Long documentId) {
    documents.removeIf(d -> Objects.equals(d.getId(), documentId));
}
```

This makes comparison explicit.

---

## 13. Identity and Inheritance

Inheritance complicates equality.

```java
@Entity
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
public abstract class Party {
    @Id
    private Long id;
}

@Entity
public class Person extends Party {}

@Entity
public class Company extends Party {}
```

Question:

```text
Can Person#10 equal Company#10?
```

Database likely prevents this because one row has one discriminator. But Java equality must consider class semantics.

### 13.1 `instanceof` can be too broad

```java
if (!(o instanceof Party other)) return false;
return Objects.equals(id, other.id);
```

This may allow equality across subclasses.

### 13.2 `getClass()` can break proxies

```java
if (getClass() != o.getClass()) return false;
```

Can break lazy proxies.

### 13.3 Rule

For inheritance-heavy entity models, equality should be designed and tested at hierarchy level. Do not use generic Lombok-generated equality.

---

## 14. Lombok and Entity Identity

Lombok can be dangerous with JPA entities.

### 14.1 `@Data` is usually wrong for entities

```java
@Data
@Entity
public class Application {
    @Id
    @GeneratedValue
    private Long id;

    @OneToMany(mappedBy = "application")
    private List<Document> documents;
}
```

`@Data` generates:

- getters,
- setters,
- `toString`,
- `equals`,
- `hashCode`,
- required args constructor.

Risks:

- `equals/hashCode` includes mutable fields,
- association traversal triggers lazy loading,
- bidirectional association causes recursion,
- `toString()` triggers lazy load or stack overflow,
- hashCode changes when fields change,
- generated constructor may conflict with JPA needs.

### 14.2 Safer Lombok usage

If using Lombok, be explicit:

```java
@Getter
@Setter(AccessLevel.PROTECTED)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
public class Application {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Column(nullable = false, unique = true, updatable = false)
    private String referenceNo;

    @ToString.Exclude
    @OneToMany(mappedBy = "application")
    private List<Document> documents = new ArrayList<>();
}
```

For equality, write manually or use Lombok only with strict `onlyExplicitlyIncluded`, and still test proxies.

---

## 15. Identity and API Boundaries

Never let external payload define entity identity carelessly.

### 15.1 Dangerous pattern

```java
@PostMapping("/applications/{id}/approve")
public void approve(@PathVariable Long id, @RequestBody Application app) {
    app.setId(id);
    applicationRepository.save(app);
}
```

Problems:

- request body becomes entity,
- detached merge semantics may overwrite fields,
- client can manipulate nested IDs,
- missing fields become null,
- authorization may validate path ID but nested entity IDs can differ,
- optimistic version may be absent.

### 15.2 Safer pattern

```java
public record ApproveApplicationCommand(
    String reason,
    Long expectedVersion
) {}
```

```java
@Transactional
public void approve(Long applicationId, ApproveApplicationCommand command) {
    Application app = em.find(Application.class, applicationId);

    if (!Objects.equals(app.getVersion(), command.expectedVersion())) {
        throw new ConcurrentModificationException();
    }

    app.approve(command.reason());
}
```

Identity is taken from trusted route/context, not blindly from body.

---

## 16. Identity and Multi-Tenancy

In multi-tenant systems, ID alone may not be enough at the security boundary.

### 16.1 Global surrogate ID

```text
application.id = 10
application.tenant_id = A
```

If ID is globally unique, database identity is `id`, but authorization identity is:

```text
tenant_id + id
```

Query must include tenant predicate:

```java
select a from Application a
where a.id = :id
and a.tenantId = :tenantId
```

### 16.2 Tenant-scoped natural key

```text
tenant_id + reference_no
```

Equality based only on `referenceNo` is wrong.

### 16.3 Cache key warning

If provider second-level cache or application cache keys only by entity ID but data isolation is tenant-scoped incorrectly, tenant leakage can happen.

Rule:

```text
Persistence identity may be entity ID.
Security identity often includes tenant, user, role, and policy scope.
Do not confuse them.
```

---

## 17. Identity and Optimistic Locking

Identity tells provider which row to update. Version tells provider whether row state is still current.

```java
@Version
private long version;
```

Update SQL often becomes conceptually:

```sql
UPDATE application
SET status = ?, version = version + 1
WHERE id = ?
  AND version = ?;
```

Without version:

```sql
UPDATE application
SET status = ?
WHERE id = ?;
```

Identity alone cannot prevent lost update.

### 17.1 Detached object risk

```text
Detached Application#10 version=5
Database Application#10 version=6
merge detached object
```

With version, provider can detect stale update.

Without version, stale detached object may overwrite newer state.

---

## 18. ID Exposure and Security

Identity design is also API/security design.

### 18.1 Sequential IDs

```text
/applications/1001
/applications/1002
/applications/1003
```

Risks:

- enumeration,
- scraping,
- business volume inference,
- authorization bypass if access check weak.

Sequential ID is not inherently insecure, but it requires strong authorization.

### 18.2 Public reference vs internal ID

Common pattern:

```text
internal_id: numeric surrogate PK
public_ref: random/structured external reference
```

API uses:

```text
/applications/APP-2026-X7K9
```

Database uses:

```text
id = 123456
```

### 18.3 Regulatory/case system rule

For case management or enforcement lifecycle systems, distinguish:

- internal technical ID,
- public case/application reference,
- external agency reference,
- audit event ID,
- document ID,
- workflow task ID.

Do not collapse all into one identity concept.

---

## 19. Common Failure Modes

### 19.1 Entity disappears from `HashSet`

Cause:

- `hashCode()` based on generated ID,
- ID null when added,
- ID assigned later.

Fix:

- avoid `Set`,
- use immutable natural key,
- assigned ID,
- constant hash pattern,
- add to set after ID assigned.

---

### 19.2 Duplicate detached objects for same row

Cause:

- two transactions load same row,
- no equality override,
- added to set/list as separate objects.

Fix:

- compare by ID explicitly,
- use identity map within transaction,
- avoid cross-context entity collection,
- use DTO/read model for cross-transaction aggregation.

---

### 19.3 `NonUniqueObjectException` / duplicate identity in session

Cause:

- persistence context already has entity ID,
- another object with same ID is associated.

Fix:

- use managed instance,
- use `merge()` carefully,
- avoid constructing entity with ID for update,
- load then mutate.

---

### 19.4 Merge overwrites data

Cause:

- detached object has stale/missing fields,
- merge copies state into managed object.

Fix:

- command DTO,
- load managed entity,
- apply explicit changes,
- use optimistic locking.

---

### 19.5 Proxy equality fails

Cause:

- `getClass()` comparison with proxy subclass,
- equality touches lazy association,
- final class/method prevents proxying.

Fix:

- proxy-safe equality,
- test with `getReference`,
- avoid lazy association in equality.

---

### 19.6 Tenant identity leak

Cause:

- equality/cache/query only uses business key without tenant,
- tenant-scoped identifier treated globally.

Fix:

- include tenant in uniqueness and lookup,
- database composite unique constraint,
- tenant-aware cache key,
- authorization predicate mandatory.

---

### 19.7 Composite ID mutation

Cause:

- embedded ID object mutable,
- ID fields changed after persist.

Fix:

- treat IDs immutable,
- no setters for ID object,
- use constructor/factory,
- never mutate primary key; create new row if identity changes.

---

## 20. Design Rules

### Rule 1 — Separate identity concepts explicitly

When designing entity, answer:

```text
What is the database primary key?
What is the business reference?
What is the public identifier?
What is the equality semantics?
What is the security/tenant scope?
What is immutable?
```

Do not let `id` become the answer to all questions by accident.

---

### Rule 2 — Do not use mutable fields in `equals/hashCode`

Bad:

```java
return Objects.equals(status, other.status)
    && Objects.equals(updatedAt, other.updatedAt);
```

Entity status changes. Updated time changes. These are not identity.

---

### Rule 3 — Avoid associations in `equals/hashCode`

Bad:

```java
return Objects.equals(application, other.application)
    && Objects.equals(fileName, other.fileName);
```

Association equality can:

- trigger lazy loading,
- recurse infinitely,
- depend on proxy behavior,
- become slow.

Prefer scalar immutable key fields.

---

### Rule 4 — Generated ID equality requires lifecycle awareness

If ID is generated after persist, do not write:

```java
hashCode() = Objects.hash(id)
```

unless you guarantee entity never enters hash collections before ID assignment.

---

### Rule 5 — Prefer load-and-mutate over merge-detached for commands

Command handling should usually be:

```text
load managed aggregate -> call domain method -> flush
```

Not:

```text
convert request body to entity -> set id -> merge
```

---

### Rule 6 — Composite identity should be immutable

Composite ID classes should behave like value objects.

Use:

- final-like semantics,
- constructor assignment,
- no public setters if possible,
- stable `equals/hashCode`,
- serializable.

---

### Rule 7 — Equality strategy is part of architecture standard

Do not let every entity author invent equality strategy. Define team conventions:

- aggregate root equality,
- child entity equality,
- audit entity equality,
- join entity equality,
- natural key rule,
- generated ID rule,
- Lombok rule,
- proxy testing rule.

---

## 21. Practical Decision Matrix

| Entity type | Recommended equality | Notes |
|---|---|---|
| Audit/event append-only row | default reference equality | Usually no domain equality needed |
| Aggregate root with immutable reference number | natural key equality | Ensure unique + updatable=false |
| Aggregate root with generated numeric ID only | default or careful generated-ID pattern | Avoid hash mutation |
| Entity with assigned UUID | ID equality | ID must be assigned at construction |
| Child entity with parent-scoped natural key | explicit method or composite natural equality | Beware association/proxy |
| Join entity with composite key | embedded ID equality | ID object immutable |
| Multi-tenant entity | include tenant in natural equality if used | Security identity != persistence identity |
| Inheritance hierarchy entity | hierarchy-aware equality | Test proxy/subclass cases |

---

## 22. Code Example: Safer Aggregate Root

```java
@Entity
@Table(
    name = "application",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_application_reference_no", columnNames = "reference_no")
    }
)
public class Application {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "application_seq")
    @SequenceGenerator(
        name = "application_seq",
        sequenceName = "application_seq",
        allocationSize = 50
    )
    private Long id;

    @Column(name = "reference_no", nullable = false, updatable = false, length = 50)
    private String referenceNo;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private ApplicationStatus status;

    protected Application() {
        // JPA
    }

    public Application(String referenceNo) {
        this.referenceNo = requireValidReference(referenceNo);
        this.status = ApplicationStatus.DRAFT;
    }

    public Long getId() {
        return id;
    }

    public String getReferenceNo() {
        return referenceNo;
    }

    public long getVersion() {
        return version;
    }

    public ApplicationStatus getStatus() {
        return status;
    }

    public void submit() {
        if (status != ApplicationStatus.DRAFT) {
            throw new IllegalStateException("Only draft application can be submitted");
        }
        this.status = ApplicationStatus.SUBMITTED;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Application other)) return false;
        return Objects.equals(referenceNo, other.referenceNo);
    }

    @Override
    public int hashCode() {
        return Objects.hash(referenceNo);
    }

    private static String requireValidReference(String referenceNo) {
        if (referenceNo == null || referenceNo.isBlank()) {
            throw new IllegalArgumentException("referenceNo is required");
        }
        return referenceNo;
    }
}
```

This is safe only because:

- `referenceNo` is assigned in constructor,
- non-null,
- unique,
- immutable at database mapping level,
- business treats it as stable identity.

If any of those conditions fail, do not use this pattern.

---

## 23. Code Example: Safer Command Update

```java
public record SubmitApplicationCommand(
    long expectedVersion
) {}
```

```java
@Transactional
public void submit(Long applicationId, SubmitApplicationCommand command) {
    Application app = entityManager.find(Application.class, applicationId);

    if (app == null) {
        throw new NotFoundException("Application not found: " + applicationId);
    }

    if (app.getVersion() != command.expectedVersion()) {
        throw new OptimisticLockException("Application was modified by another transaction");
    }

    app.submit();
}
```

No detached entity merge. No request body entity. Identity is resolved inside transaction.

---

## 24. Code Example: Composite Tenant-Scoped Identity

```java
@Embeddable
public class TenantApplicationId implements Serializable {

    @Column(name = "tenant_id", nullable = false, length = 40)
    private String tenantId;

    @Column(name = "reference_no", nullable = false, length = 50)
    private String referenceNo;

    protected TenantApplicationId() {}

    public TenantApplicationId(String tenantId, String referenceNo) {
        this.tenantId = requireText(tenantId, "tenantId");
        this.referenceNo = requireText(referenceNo, "referenceNo");
    }

    public String tenantId() {
        return tenantId;
    }

    public String referenceNo() {
        return referenceNo;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof TenantApplicationId other)) return false;
        return Objects.equals(tenantId, other.tenantId)
            && Objects.equals(referenceNo, other.referenceNo);
    }

    @Override
    public int hashCode() {
        return Objects.hash(tenantId, referenceNo);
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value;
    }
}
```

```java
@Entity
@Table(name = "tenant_application")
public class TenantApplication {

    @EmbeddedId
    private TenantApplicationId id;

    @Version
    private long version;

    protected TenantApplication() {}

    public TenantApplication(TenantApplicationId id) {
        this.id = Objects.requireNonNull(id);
    }

    public TenantApplicationId getId() {
        return id;
    }
}
```

This makes identity scope explicit.

---

## 25. Diagnostic Checklist

When debugging entity identity bug, ask:

1. Are the two objects in the same persistence context?
2. Do they have the same Java reference?
3. Do they have the same database ID?
4. Is one of them detached?
5. Is one of them a proxy?
6. Does `equals()` use generated ID?
7. Does `hashCode()` change after persist?
8. Does equality include mutable fields?
9. Does equality include lazy associations?
10. Is the entity inside `HashSet`/`HashMap`?
11. Is the ID assigned by DB or application?
12. Is there a natural key? Is it immutable?
13. Is uniqueness global or tenant-scoped?
14. Is `merge()` copying stale state?
15. Is optimistic version present?
16. Is provider using shared/second-level cache?
17. Is there inheritance/proxy class mismatch?
18. Is Lombok generating equality or toString?
19. Is an API request body being converted directly to entity?
20. Is a manually constructed entity with ID being associated with the current context?

---

## 26. Practice Scenarios

### Scenario 1 — Generated ID and HashSet

You create `OrderLine` with generated ID and add it to `HashSet` before persist. After flush, `contains()` returns false.

Explain:

- what changed,
- why HashSet cannot find it,
- three possible fixes.

---

### Scenario 2 — Same Row, Different Object

Two services load `Application#10` in different transactions. The returned objects are added to a `Set`. Size becomes 2.

Explain:

- why this happens,
- whether it is wrong,
- how to design equality or comparison explicitly.

---

### Scenario 3 — Merge Overwrite

A UI sends partial JSON payload:

```json
{
  "id": 10,
  "status": "APPROVED"
}
```

Backend maps it to entity and calls `merge()`. Other fields become null.

Explain:

- why identity enabled the update,
- why merge is dangerous here,
- safer command-based update design.

---

### Scenario 4 — Tenant Reference Collision

Tenant A and Tenant B both have `referenceNo = APP-001`. Entity equality uses only `referenceNo`.

Explain:

- bug risk,
- cache risk,
- authorization risk,
- corrected identity model.

---

### Scenario 5 — Proxy Equality

`em.find(Application.class, id)` and `em.getReference(Application.class, id)` represent the same row but `equals()` returns false.

Explain:

- proxy class problem,
- `getClass()` vs `instanceof`,
- test strategy.

---

## 27. Summary

Entity identity is not a single thing. It is a layered contract across Java heap, Java equality, database primary key, persistence context, provider cache, detached objects, proxies, API boundaries, and security scope.

The most important invariants:

```text
1. Within one persistence context, one persistent identity maps to one managed object instance.
2. A database ID does not make an object managed.
3. A detached object can be stale even if its ID is valid.
4. equals/hashCode must be stable and must not accidentally traverse mutable/lazy object graphs.
5. Generated IDs complicate equality before persist.
6. Natural keys are only safe for equality if immutable, unique, and correctly scoped.
7. merge() copies state; it does not reattach the same object.
8. Tenant/security identity may be wider than database identity.
```

A top-level persistence engineer does not ask only:

> “What annotation should I use?”

They ask:

> “What identity invariant must hold across transaction, object graph, database, cache, API, and security boundary?”

That question prevents a large class of ORM bugs before they enter production.

---

## 28. References

[^jakarta-identity]: Jakarta Persistence 3.2 Specification, section “Primary Keys and Entity Identity”, states that every entity must have a primary key and that the primary key value uniquely identifies an entity instance within a persistence context and to `EntityManager` operations. https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2

[^jakarta-pc]: Jakarta Persistence 3.1 Specification describes a persistence context as a set of managed entity instances where, for any persistent entity identity, there is a unique entity instance. https://jakarta.ee/specifications/persistence/3.1/jakarta-persistence-spec-3.1.html

[^hibernate-equals]: Hibernate ORM 7 introduction discusses entity equality and recommends considering natural id attributes for `equals()` and `hashCode()` when appropriate, especially because generated identifiers may not be assigned until persistence. https://docs.hibernate.org/orm/7.0/introduction/html_single/

[^eclipselink-identity]: EclipseLink documentation on persisting objects explains object identity preservation and identity maps, including composite primary keys. https://eclipse.dev/eclipselink/documentation/2.7/concepts/app_dev003.htm

[^eclipselink-cache]: EclipseLink JPA extension documentation for `@Cache` explains EclipseLink object cache behavior and per-class cache configuration. https://eclipse.dev/eclipselink/documentation/2.4/jpa/extensions/a_cache.htm

[^eclipselink-uow]: EclipseLink UnitOfWork API documentation describes UnitOfWork operating on its own object space and using clones for editing. https://eclipse.dev/eclipselink/api/4.0/org.eclipse.persistence.core/org/eclipse/persistence/internal/sessions/UnitOfWorkImpl.html

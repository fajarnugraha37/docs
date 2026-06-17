# Part 24 — Hibernate ORM Deep Dive: Architecture, Session, Event System, Interceptors, and Extensions

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Bagian: 24 dari 34  
> Target Java: 8 sampai 25  
> Target provider: Hibernate ORM 5.x, 6.x, 7.x, dengan catatan untuk 8.x development line  
> Fokus: memahami Hibernate sebagai runtime persistence engine, bukan sekadar implementasi JPA

---

## 0. Posisi Bagian Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membangun fondasi besar:

- persistence context sebagai unit of work;
- identity map;
- dirty checking;
- flush/action queue;
- SQL generation;
- mapping;
- association;
- fetching;
- query discipline;
- bulk operations;
- transaction integration;
- concurrency;
- merge/detach safety;
- cache;
- schema migration;
- enhancement/weaving.

Bagian ini naik satu lapis lebih dalam: **bagaimana Hibernate sendiri disusun secara internal sebagai provider**.

Tujuan bagian ini bukan membuat kita menghafal semua class internal Hibernate. Tujuannya adalah membentuk mental model yang cukup kuat sehingga ketika melihat masalah seperti:

- kenapa entity listener terpanggil dua kali;
- kenapa `merge()` memicu select banyak sekali;
- kenapa SQL muncul sebelum commit;
- kenapa filter tenant tidak aktif di query tertentu;
- kenapa soft delete tidak konsisten;
- kenapa custom interceptor mengubah data secara tidak terduga;
- kenapa audit listener menghasilkan recursion;
- kenapa `StatementInspector` tidak boleh dipakai untuk business logic;
- kenapa native query bisa bypass beberapa mekanisme provider;
- kenapa multi-tenancy dapat bocor kalau context propagation salah;

kita bisa menelusuri jalurnya dengan benar.

---

## 1. Core Mental Model: Hibernate Is a Persistence Runtime

Hibernate sering dipahami terlalu sederhana sebagai:

```text
@Entity + Repository -> SQL
```

Itu mental model pemula.

Mental model yang lebih tepat:

```text
Application code
    |
    v
Hibernate Session / EntityManager
    |
    v
Persistence Context
    |-- identity map
    |-- entity entries
    |-- snapshots
    |-- collection entries
    |-- proxies / enhanced entities
    |
    v
Event System
    |-- load events
    |-- persist events
    |-- merge events
    |-- delete events
    |-- flush events
    |-- dirty check events
    |
    v
Action Queue
    |-- inserts
    |-- updates
    |-- deletes
    |-- collection operations
    |
    v
SQL AST / SQL generation / Dialect
    |
    v
JDBC / Connection / Transaction
    |
    v
Database
```

Hibernate bukan hanya mapper. Hibernate adalah **runtime state machine** yang menghubungkan object graph Java dengan relational database melalui event, state transition, SQL generation, cache, dan transaction coordination.

### 1.1 Hibernate sebagai Engine, Bukan Library Pasif

Library pasif biasanya hanya melakukan sesuatu saat dipanggil langsung:

```java
mapper.toDto(entity);
```

Hibernate tidak seperti itu. Hibernate menyimpan state, mengamati perubahan, menunda operasi, mengurutkan SQL, melakukan lazy loading, mengelola identity, dan memutuskan kapan SQL harus dieksekusi.

Artinya, ketika kita menulis:

```java
order.setStatus(OrderStatus.APPROVED);
```

Hibernate mungkin belum mengirim SQL saat itu. Tetapi object tersebut sudah menjadi kandidat update jika managed dalam persistence context.

Kemudian saat flush:

```sql
update orders set status = ? where id = ? and version = ?
```

SQL tersebut muncul bukan karena kita memanggil `update()`, tetapi karena Hibernate mendeteksi state managed object berubah.

---

## 2. Hibernate API Layers: JPA Facade vs Native Hibernate

Hibernate menyediakan dua wajah utama:

1. **JPA/Jakarta Persistence facade**:
   - `EntityManagerFactory`
   - `EntityManager`
   - `EntityTransaction`
   - `Query`
   - `TypedQuery`
   - `CriteriaBuilder`

2. **Native Hibernate API**:
   - `SessionFactory`
   - `Session`
   - `StatelessSession`
   - `Transaction`
   - `SelectionQuery`
   - `MutationQuery`
   - event listeners
   - interceptors
   - filters
   - custom types
   - multi-tenancy services
   - integrators

JPA memberi standard contract. Native Hibernate memberi control lebih dalam.

### 2.1 Unwrapping

Di aplikasi JPA, kita bisa mengambil native API:

```java
Session session = entityManager.unwrap(Session.class);
SessionFactory sessionFactory = entityManagerFactory.unwrap(SessionFactory.class);
```

Ini bukan anti-pattern otomatis. Ini benar bila:

- kita butuh Hibernate-specific feature;
- portability bukan target utama;
- behavior diuji dengan provider version yang dipakai;
- penggunaan isolated dan terdokumentasi.

Yang berbahaya adalah memakai native API tanpa sadar konsekuensi portability dan lifecycle-nya.

### 2.2 Mapping Lapisan Konsep

| JPA/Jakarta Persistence | Hibernate Native | Makna Runtime |
|---|---|---|
| `EntityManagerFactory` | `SessionFactory` | factory heavyweight, immutable setelah bootstrap |
| `EntityManager` | `Session` | persistence context + unit of work boundary |
| `EntityTransaction` | `Transaction` | transaction facade |
| persistence context | persistence context | identity map dan managed state |
| JPQL | HQL | query object model, HQL lebih kaya |
| `LockModeType` | Hibernate lock options | locking semantics provider-specific |
| entity graph | entity graph/fetch profiles | load plan control |

---

## 3. SessionFactory: The Heavyweight Immutable Runtime

`SessionFactory` adalah inti Hibernate runtime untuk satu mapping universe.

Secara konseptual ia berisi:

- metadata entity;
- mapping table/column;
- identifier generator;
- type system;
- SQL generation services;
- dialect;
- cache regions;
- event listener registry;
- service registry;
- named queries;
- fetch profiles;
- filters;
- statistics;
- connection/provider integration.

`SessionFactory` mahal dibuat. Ia seharusnya dibuat sekali per application persistence unit dan dipakai ulang.

### 3.1 Lifecycle

```text
Application startup
    -> build StandardServiceRegistry
    -> read mapping metadata
    -> validate model
    -> build Metadata
    -> build SessionFactory
    -> application serves requests
    -> open Session per unit of work/request/transaction
    -> close SessionFactory at shutdown
```

Dalam Spring Boot, proses ini banyak disembunyikan oleh auto-configuration. Namun engine-nya tetap ada.

### 3.2 Kenapa SessionFactory Harus Immutable?

Kalau metadata mapping berubah saat runtime, semua hal ini bisa rusak:

- SQL generation;
- cache key structure;
- entity persister;
- collection persister;
- query plan;
- dirty checking layout;
- association resolution.

Karena itu mapping Hibernate diperlakukan sebagai runtime contract yang dibekukan saat bootstrap.

### 3.3 Kesalahan Umum

#### Membuat SessionFactory Berulang Kali

```java
SessionFactory sf = new Configuration().configure().buildSessionFactory();
```

di banyak tempat adalah kesalahan besar.

Dampaknya:

- memory besar;
- connection pool ganda;
- cache region ganda;
- metadata duplicated;
- startup lambat;
- behavior sulit diprediksi.

#### Menganggap SessionFactory Sama dengan Connection

`SessionFactory` bukan connection. Ia adalah factory dan metadata runtime. Connection biasanya didapat saat `Session` perlu database access.

---

## 4. Session: Unit of Work Runtime

`Session` adalah implementasi utama persistence context dalam Hibernate.

Ia biasanya:

- ringan dibanding `SessionFactory`;
- tidak thread-safe;
- berumur pendek;
- mewakili satu unit of work;
- mengandung first-level cache;
- mengatur dirty checking dan flush;
- menjadi pintu operasi CRUD/query.

### 4.1 Session Bukan DAO

`Session` bukan DAO object yang boleh disimpan sebagai singleton.

Salah:

```java
@Component
public class BadRepository {
    private final Session session; // berbahaya jika singleton
}
```

Benar secara konsep:

```java
@Transactional
public void approve(Long id) {
    Order order = entityManager.find(Order.class, id);
    order.approve();
}
```

Session/persistence context dibuka dan ditutup sesuai boundary transaksi/request oleh framework/container.

### 4.2 Session Tidak Thread-Safe

Satu `Session` tidak boleh dipakai paralel oleh banyak thread.

Salah:

```java
Session session = entityManager.unwrap(Session.class);
items.parallelStream().forEach(item -> {
    session.persist(item); // tidak aman
});
```

Kenapa?

Karena `Session` punya mutable internal state:

- persistence context;
- action queue;
- transaction state;
- loading context;
- collection entries;
- batch state.

Concurrent mutation bisa menghasilkan:

- inconsistent persistence context;
- duplicate entity entry;
- race condition saat flush;
- exception acak;
- data corruption subtle.

### 4.3 Session sebagai Identity Scope

Dalam satu session:

```java
Order a = session.find(Order.class, 10L);
Order b = session.find(Order.class, 10L);

assert a == b;
```

Selama entity masih managed dalam persistence context yang sama, Hibernate menjaga satu row database direpresentasikan oleh satu object Java.

Itulah identity map invariant.

---

## 5. Persistence Context Internal View

Persistence context tidak hanya menyimpan `Map<Id, Entity>`.

Secara konseptual ia menyimpan:

```text
PersistenceContext
    |
    |-- EntityKey -> entity instance
    |-- entity instance -> EntityEntry
    |-- CollectionKey -> PersistentCollection
    |-- PersistentCollection -> CollectionEntry
    |-- proxies
    |-- batch fetch queues
    |-- natural id resolutions
```

### 5.1 EntityKey

Entity key kira-kira terdiri dari:

```text
(entity name, identifier, tenant identifier if applicable)
```

Bukan hanya primary key value.

Dalam multi-tenancy discriminator/schema/database model, tenant dimension menjadi penting untuk mencegah identity collision.

### 5.2 EntityEntry

Entity entry menyimpan state seperti:

- status entity:
  - managed;
  - read-only;
  - deleted;
  - loading;
  - gone;
- loaded state snapshot;
- version;
- lock mode;
- persister reference;
- dirty checking support.

Jika ada bug dirty checking atau unexpected flush, biasanya penyebabnya dapat dijelaskan melalui entity entry dan snapshot.

### 5.3 CollectionEntry

Collection mapping punya state tersendiri.

Hibernate perlu tahu:

- collection owner;
- collection role;
- snapshot collection saat load;
- apakah collection initialized;
- apakah dirty;
- apakah perlu recreate/remove/update rows.

Itulah mengapa mengganti reference collection bisa berbeda konsekuensi dari memodifikasi isi collection.

```java
// Bisa memicu replacement semantics
order.setLines(new ArrayList<>());

// Biasanya lebih aman jika helper method menjaga invariant
order.clearLines();
```

---

## 6. Entity Persister and Collection Persister

Hibernate tidak menjalankan mapping annotation langsung setiap operasi. Saat bootstrap, metadata annotation/XML diproses menjadi runtime persister.

### 6.1 EntityPersister

Entity persister bertanggung jawab atas:

- table mapping;
- property mapping;
- identifier mapping;
- discriminator/inheritance;
- SQL insert/update/delete/select;
- version handling;
- lazy property metadata;
- second-level cache interaction;
- dirty property resolution.

Ketika Hibernate perlu insert entity, ia tidak “membaca annotation dari class” setiap saat. Ia memakai persister yang sudah dibangun.

### 6.2 CollectionPersister

Collection persister bertanggung jawab atas:

- one-to-many;
- many-to-many;
- element collection;
- join table;
- collection table;
- collection key;
- index/order column;
- delete/recreate/update collection row;
- collection cache.

Banyak performance issue collection berasal dari collection persister behavior, bukan dari database semata.

---

## 7. Service Registry: Internal Dependency System

Hibernate memakai service registry untuk menyusun layanan internal.

Secara konseptual:

```text
BootstrapServiceRegistry
    -> StandardServiceRegistry
        -> JdbcServices
        -> TransactionCoordinatorBuilder
        -> JtaPlatform
        -> ConnectionProvider
        -> Dialect
        -> RegionFactory
        -> StrategySelector
        -> EventListenerRegistry
        -> TypeConfiguration
```

Kita tidak harus menghafal semua. Tapi penting memahami bahwa Hibernate adalah modular runtime dengan banyak service.

### 7.1 Kenapa Ini Penting?

Karena extension tingkat lanjut sering masuk melalui service:

- custom dialect;
- custom type contributor;
- custom integrator;
- custom event listener;
- multi-tenant connection provider;
- custom cache region factory;
- custom statement inspector.

Jika extension salah level, hasilnya rapuh.

Contoh kesalahan:

- business audit ditaruh di `StatementInspector`;
- tenant isolation ditaruh hanya di repository method;
- soft delete ditaruh hanya di service layer;
- encryption ditaruh di entity getter/setter tanpa converter/type jelas.

---

## 8. Event System: Hibernate's Internal State Transition Bus

Hibernate sangat event-driven.

Ketika kita memanggil:

```java
session.persist(order);
```

Hibernate tidak langsung “insert”. Ia memproses persist event.

Ketika kita memanggil:

```java
session.find(Order.class, id);
```

Hibernate memproses load event.

Ketika transaksi akan disinkronkan:

```java
session.flush();
```

Hibernate memproses flush event.

### 8.1 Jenis Event Penting

Secara konseptual:

| Event | Kapan Terjadi | Contoh Use Case |
|---|---|---|
| load | entity diload | custom load validation, audit read sangat hati-hati |
| persist/save | entity baru dipersist | set metadata create |
| merge | detached state digabung | audit merge, validation khusus |
| delete | entity dihapus | soft-delete extension, audit delete |
| flush | session disinkronkan | final dirty checking, action queue generation |
| pre-insert | sebelum insert SQL | set createdBy/createdAt |
| post-insert | setelah insert SQL | domain event/outbox candidate |
| pre-update | sebelum update SQL | set updatedBy/updatedAt |
| post-update | setelah update SQL | audit/logging candidate |
| pre-delete | sebelum delete SQL | delete guard |
| post-delete | setelah delete SQL | cleanup/outbox candidate |

### 8.2 Event Listener vs JPA Entity Listener

JPA entity listener:

```java
@PrePersist
@PreUpdate
@PostLoad
```

Hibernate event listener:

```java
PreInsertEventListener
PreUpdateEventListener
PostInsertEventListener
PostUpdateEventListener
```

Perbedaannya:

| Aspek | JPA Entity Listener | Hibernate Event Listener |
|---|---|---|
| Standard | Ya | Tidak, provider-specific |
| Portability | Lebih portable | Hibernate-only |
| Access internal state | Terbatas | Lebih dalam |
| Registration | annotation/XML | registry/integrator/config |
| Cocok untuk | lifecycle callback sederhana | cross-cutting provider extension |
| Risiko | callback side effect | coupling ke internal behavior |

### 8.3 Prinsip Penting Event Listener

Event listener harus dianggap sebagai **low-level infrastructure hook**, bukan tempat business workflow utama.

Buruk:

```java
public class ApprovalListener implements PreUpdateEventListener {
    @Override
    public boolean onPreUpdate(PreUpdateEvent event) {
        // mengirim email approval
        // membuat task workflow
        // memanggil service lain
        // query database lain
        return false;
    }
}
```

Kenapa buruk?

Karena listener berjalan di tengah mekanisme flush. Side effect berat bisa menyebabkan:

- recursion;
- re-entrant flush;
- transaction state kacau;
- email terkirim padahal transaction rollback;
- ordering tidak jelas;
- test sulit;
- hidden behavior.

Lebih baik:

- listener hanya mencatat outbox event;
- outbox diproses setelah commit;
- business transition tetap eksplisit di domain/service layer.

---

## 9. Lifecycle Callback: Useful but Dangerous

JPA callback sering terlihat sederhana:

```java
@PrePersist
void prePersist() {
    this.createdAt = Instant.now();
}

@PreUpdate
void preUpdate() {
    this.updatedAt = Instant.now();
}
```

Ini wajar untuk metadata teknis sederhana.

Namun callback menjadi berbahaya jika:

- melakukan query;
- memanggil repository;
- mengubah association besar;
- mengirim network call;
- memutuskan workflow business;
- bergantung pada security context yang tidak selalu tersedia;
- mengubah field yang dipakai dirty checking secara tidak hati-hati.

### 9.1 Safe Callback Use Cases

Relatif aman:

- set `createdAt`;
- set `updatedAt`;
- set audit user jika context tersedia jelas;
- normalize value sederhana;
- validate invariant lokal ringan.

Contoh:

```java
@MappedSuperclass
public abstract class AuditedEntity {
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = Instant.now();
    }
}
```

### 9.2 Unsafe Callback Use Cases

Berbahaya:

```java
@PreUpdate
void preUpdate() {
    notificationService.sendEmail(...); // jangan
}
```

```java
@PostPersist
void postPersist() {
    repository.save(new AuditTrail(...)); // rawan recursion dan dependency injection problem
}
```

Untuk audit trail kompleks, lebih baik memakai:

- domain event;
- outbox pattern;
- Hibernate event listener yang didesain hati-hati;
- Envers jika cocok;
- database trigger untuk audit tertentu;
- application service eksplisit.

---

## 10. Interceptor: Session-Level or Factory-Level Hook

Hibernate `Interceptor` memberi callback untuk menginspeksi atau memodifikasi operasi persistence.

Konsepnya:

```text
Session operation
    -> Interceptor callback
    -> Hibernate event processing
    -> action queue / SQL
```

Interceptor bisa digunakan untuk:

- audit metadata;
- dirty property inspection;
- entity name resolution;
- SQL statement preparation in older APIs;
- custom cross-cutting hooks.

Namun banyak use case modern lebih baik memakai:

- event listener;
- `StatementInspector`;
- JPA callback;
- converter/type;
- Spring Data auditing;
- Envers;
- outbox.

### 10.1 Kapan Interceptor Masuk Akal?

Interceptor masih masuk akal bila kita butuh hook yang:

- berlaku untuk session tertentu;
- ingin inspect entity state sebelum save/update;
- tidak perlu portability;
- bisa diuji secara eksplisit;
- tidak berisi business workflow besar.

### 10.2 Risiko Interceptor

Interceptor rawan menjadi “global magic”.

Masalah umum:

- sulit tahu kapan terpanggil;
- tergantung urutan event internal;
- perubahan provider version bisa memengaruhi behavior;
- side effect tersembunyi;
- thread-local context tidak selalu tersedia;
- membuat unit test tampak hijau tapi integration test gagal.

---

## 11. StatementInspector: SQL Boundary Hook

`StatementInspector` adalah hook untuk melihat atau memodifikasi SQL string sebelum dikirim ke JDBC.

Contoh penggunaan aman:

- menambahkan comment/correlation id;
- observability;
- SQL tagging;
- debugging selective;
- policy guard sederhana dalam test.

Contoh:

```java
public class CorrelationStatementInspector implements StatementInspector {
    @Override
    public String inspect(String sql) {
        String correlationId = CorrelationContext.getOrNull();
        if (correlationId == null) {
            return sql;
        }
        return "/* correlationId=" + sanitize(correlationId) + " */ " + sql;
    }
}
```

### 11.1 StatementInspector Bukan Tempat Business Logic

Jangan menggunakan `StatementInspector` untuk:

- inject tenant predicate secara string manipulation;
- enforce authorization;
- rewrite semua query kompleks;
- masking data;
- audit semantic operation;
- mengubah DML secara fragile.

Buruk:

```java
@Override
public String inspect(String sql) {
    return sql.replace("where", "where tenant_id = '" + tenant + "' and ");
}
```

Kenapa buruk?

- SQL bisa punya subquery;
- `where` bisa muncul di string literal/comment;
- native SQL berbeda bentuk;
- join predicate bisa salah;
- update/delete butuh treatment berbeda;
- cache dan query plan bisa kacau;
- tenant leakage bisa terjadi.

Untuk tenant isolation, gunakan mekanisme yang memang didesain untuk itu:

- Hibernate multi-tenancy;
- filters;
- discriminator strategy yang konsisten;
- database row-level security;
- schema/database per tenant;
- mandatory predicate di query builder yang diuji;
- defense-in-depth di DB.

### 11.2 SQL Commenting untuk Observability

SQL comment dapat membantu menghubungkan endpoint ke query:

```sql
/* service=CaseService operation=approveCase correlationId=abc123 */
select c.id, c.status
from cases c
where c.id = ?
```

Namun hati-hati:

- jangan masukkan PII;
- jangan masukkan token/session;
- jangan masukkan full user input;
- pastikan comment tidak merusak database plan cache pada DB tertentu;
- batasi panjang comment.

---

## 12. Integrator: Registering Deep Hibernate Extensions

`Integrator` adalah mekanisme untuk menyambungkan extension ke Hibernate saat bootstrap.

Use case:

- register event listener;
- register custom service;
- integrate module custom;
- configure metadata behavior.

Konsep:

```text
SessionFactory bootstrap
    -> Integrator invoked
    -> access service registry / metadata
    -> register listeners/extensions
```

### 12.1 Contoh Konseptual Integrator

```java
public class AuditIntegrator implements Integrator {
    @Override
    public void integrate(
            Metadata metadata,
            BootstrapContext bootstrapContext,
            SessionFactoryImplementor sessionFactory) {

        EventListenerRegistry registry = sessionFactory
                .getServiceRegistry()
                .getService(EventListenerRegistry.class);

        registry.appendListeners(
                EventType.POST_INSERT,
                new AuditPostInsertListener()
        );
    }

    @Override
    public void disintegrate(
            SessionFactoryImplementor sessionFactory,
            SessionFactoryServiceRegistry serviceRegistry) {
        // cleanup if needed
    }
}
```

API detail bisa berbeda antar major version, jadi selalu kunci pada versi Hibernate yang dipakai.

### 12.2 Risiko Integrator

Integrator adalah extension point powerful. Karena itu risikonya juga besar:

- coupling ke Hibernate internal SPI;
- migration antar major version lebih berat;
- ordering listener bisa memengaruhi behavior;
- sulit dimengerti developer baru;
- bisa aktif global tanpa terlihat di code path business.

Gunakan integrator untuk infrastructure concern yang benar-benar cross-cutting dan butuh Hibernate-level hook.

---

## 13. Event Listener Design for Audit Trail

Audit adalah use case paling umum untuk event listener, tetapi juga paling sering salah.

### 13.1 Dua Jenis Audit

#### Technical Audit

Menjawab:

- kapan row dibuat;
- siapa yang membuat;
- kapan diubah;
- siapa yang mengubah;
- field apa berubah.

Cocok untuk:

- entity callback;
- event listener;
- Envers;
- database trigger.

#### Business Audit

Menjawab:

- kenapa case disetujui;
- approval level berapa;
- siapa reviewer;
- rule apa yang dipakai;
- dokumen apa yang menjadi dasar;
- state transition dari mana ke mana;
- apakah SLA/escalation terpenuhi.

Cocok untuk:

- explicit domain event;
- workflow event table;
- outbox;
- application service;
- state machine transition log.

Jangan mencampur keduanya secara buta.

### 13.2 Problem Jika Audit Mengandalkan Dirty Checking Saja

Misalnya entity:

```java
caseRecord.setStatus(APPROVED);
caseRecord.setAssignedOfficer(null);
caseRecord.setApprovalReason("OK");
```

Dirty checking bisa tahu field berubah. Tetapi ia tidak tahu:

- apakah ini approval manual;
- apakah auto-approval;
- apakah override;
- apakah escalation;
- apakah correction;
- apakah rollback;
- apakah migration script.

Business meaning harus datang dari application/domain layer, bukan hanya dari field diff.

### 13.3 Recommended Audit Layering

```text
Domain/Application Service
    -> validates command
    -> calls aggregate behavior
    -> records explicit business event
    -> persists entity changes
    -> writes outbox/audit event

Hibernate Listener
    -> optional technical diff
    -> metadata timestamps/user
    -> no external side effect

Database
    -> optional immutable low-level audit/safety net
```

---

## 14. Filters: Dynamic Query Constraints

Hibernate filters memungkinkan constraint dinamis pada entity/collection.

Use cases:

- tenant filter;
- soft delete;
- effective date;
- organization scope;
- data partition;
- security-ish filtering dengan batasan.

Contoh konseptual:

```java
@FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = String.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
@Entity
class CaseRecord {
    @Id
    private Long id;

    private String tenantId;
}
```

Aktivasi:

```java
Session session = entityManager.unwrap(Session.class);
session.enableFilter("tenantFilter")
       .setParameter("tenantId", currentTenantId);
```

### 14.1 Filter Bukan Security Boundary Sempurna

Filter membantu, tetapi jangan diperlakukan sebagai satu-satunya security boundary.

Kenapa?

- filter harus di-enable;
- native query bisa bypass;
- bulk operation punya behavior yang harus diuji;
- cache interaction harus dipahami;
- admin flow mungkin butuh bypass;
- async/job context bisa lupa set tenant;
- direct JDBC tidak terkena filter;
- report query khusus mungkin tidak lewat entity path.

Untuk sistem regulasi/enterprise, gunakan defense-in-depth:

```text
Application authorization
    + Hibernate filter / query predicate
    + database constraint / RLS / schema separation where appropriate
    + audit
    + test that proves isolation
```

### 14.2 Filter Enablement Pattern

Jangan enable filter secara manual tersebar di repository.

Buruk:

```java
public List<CaseRecord> findCases() {
    session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
    return query.getResultList();
}
```

Masalah:

- mudah lupa;
- inconsistent;
- sulit audit;
- native query lolos.

Lebih baik:

- enable filter di request/transaction boundary;
- pakai aspect/interceptor framework;
- validasi tenant context wajib ada;
- test semua repository penting;
- fail closed jika tenant tidak tersedia.

---

## 15. Soft Delete in Hibernate

Soft delete tampak sederhana:

```text
deleted = true
```

Tetapi di ORM, soft delete menyentuh banyak aspek:

- delete operation;
- query filtering;
- unique constraint;
- association;
- collection;
- cache;
- audit;
- restore;
- admin view;
- bulk delete;
- foreign key semantics.

### 15.1 Naive Soft Delete

```java
entity.setDeleted(true);
```

Lalu semua query harus menambahkan:

```sql
where deleted = false
```

Masalah:

- query bisa lupa predicate;
- association masih menunjuk deleted entity;
- unique constraint masih menahan value lama;
- delete cascade tidak berlaku seperti hard delete;
- count/report bisa salah;
- cache bisa menyimpan entity deleted;
- admin view butuh include deleted.

### 15.2 Hibernate-Level Soft Delete

Hibernate versi modern menyediakan dukungan soft delete yang lebih eksplisit dibanding pendekatan lama `@SQLDelete` + `@Where`. Namun desain tetap harus memperhatikan:

- apakah delete operation harus menjadi update;
- apakah query otomatis exclude deleted;
- apakah association harus tetap resolve;
- apakah restore diizinkan;
- apakah deleted row masih harus unik;
- bagaimana audit/history;
- bagaimana migration dari hard delete.

### 15.3 Soft Delete Design Rules

1. Jangan soft delete semua hal secara default.
2. Untuk audit/history, kadang append-only history lebih tepat daripada soft delete.
3. Untuk reference/master data, soft delete bisa masuk akal.
4. Untuk high-volume transactional data, soft delete bisa membuat table bloat.
5. Untuk regulatory record, hard delete mungkin dilarang, tetapi soft delete bukan pengganti archival policy.
6. Unique constraint harus didesain ulang.
7. Report query harus punya semantic jelas: include deleted atau tidak.

---

## 16. Multi-Tenancy Extension Points

Hibernate mendukung beberapa model multi-tenancy:

- database per tenant;
- schema per tenant;
- discriminator/partition column pattern;
- custom strategy tergantung versi/provider.

### 16.1 Database/Schema Multi-Tenancy

Konsep:

```text
Tenant A -> connection/schema A
Tenant B -> connection/schema B
```

Komponen penting:

- tenant identifier resolver;
- multi-tenant connection provider;
- transaction boundary;
- connection release mode;
- migration per tenant;
- monitoring per tenant.

Risiko:

- wrong tenant context;
- connection reused with wrong schema;
- migration drift antar tenant;
- background job tanpa tenant;
- cache key tenant mismatch.

### 16.2 Discriminator Tenant

Konsep:

```sql
select * from cases where tenant_id = ?
```

Biasanya melibatkan:

- tenant column di table;
- filter/predicate otomatis;
- unique key include tenant;
- cache isolation;
- authorization check;
- test leakage.

Risiko:

- native query lupa tenant predicate;
- bulk update lintas tenant;
- second-level cache leakage;
- report query salah;
- admin bypass tidak diaudit.

### 16.3 Tenant Context Propagation

Dalam aplikasi modern, tenant context bisa hilang di:

- async method;
- scheduled job;
- reactive pipeline;
- message consumer;
- parallel stream;
- thread pool;
- retry executor.

Jangan bergantung buta pada `ThreadLocal` tanpa propagation policy.

Better pattern:

```text
Request/message receives tenant
    -> validate tenant
    -> create explicit TenantContext scope
    -> open transaction/session
    -> enable tenant mechanism
    -> execute use case
    -> clear context in finally
```

---

## 17. Custom Types and Type Contributors

Walaupun type system sudah dibahas pada part sebelumnya, di Hibernate architecture type system adalah bagian penting.

Hibernate perlu tahu cara:

- membaca nilai dari JDBC;
- menulis nilai ke JDBC;
- membandingkan nilai untuk dirty checking;
- deep copy value;
- menyimpan value di cache;
- menentukan mutability;
- render literal/query binding.

### 17.1 AttributeConverter vs Hibernate Custom Type

| Aspek | AttributeConverter | Hibernate Custom Type |
|---|---|---|
| Standard JPA | Ya | Tidak |
| Portability | Tinggi | Hibernate-specific |
| Simple conversion | Cocok | Bisa tapi overkill |
| JDBC-level control | Terbatas | Lebih kuat |
| Mutability plan | Terbatas | Lebih eksplisit |
| JSON/array/custom DB type | Kadang kurang | Lebih cocok |
| Migration cost | Rendah | Lebih tinggi |

### 17.2 Mutability Is Critical

Misalnya field value object mutable:

```java
private Money amount;
```

Jika Hibernate tidak tahu cara deep copy/membandingkan, dirty checking dan cache bisa salah.

Rule:

- value object sebaiknya immutable;
- custom type harus menjelaskan mutability;
- cacheable value harus safe untuk shared cache;
- converter jangan menyembunyikan mutable object tanpa policy.

---

## 18. Query Engine Architecture: HQL to SQL

Pada Hibernate modern, query bukan sekadar string langsung diubah menjadi SQL. Secara konseptual pipeline-nya:

```text
HQL/JPQL string
    -> parse
    -> semantic model
    -> parameter/type resolution
    -> SQL AST
    -> dialect rendering
    -> JDBC statement
    -> result set processing
    -> entity hydration/projection
```

### 18.1 Kenapa Ini Penting?

Karena error query bisa muncul di beberapa level:

| Level | Contoh Error |
|---|---|
| parse | syntax salah |
| semantic | property tidak ada, join salah |
| type resolution | parameter type mismatch |
| SQL generation | dialect limitation |
| database | invalid column/table, plan buruk |
| hydration | DTO constructor mismatch, duplicate alias |

Top engineer tidak berhenti di “query error”. Ia mengidentifikasi di tahap pipeline mana error terjadi.

### 18.2 HQL Lebih Kaya dari JPQL

HQL adalah superset/provider language. Ia dapat menawarkan fitur yang tidak portable.

Gunakan HQL-specific feature jika:

- target provider memang Hibernate;
- value-nya signifikan;
- migration risk diterima;
- test integration ada;
- query terdokumentasi sebagai Hibernate-specific.

---

## 19. Flush Pipeline and ActionQueue Revisited from Hibernate View

Dari sisi Hibernate architecture:

```text
managed entity changed
    -> dirty checking detects change
    -> entity update action queued
    -> collection changes queued
    -> actions sorted/ordered
    -> JDBC batching applied if possible
    -> SQL executed
```

### 19.1 ActionQueue Categories

Secara konseptual action queue menyimpan:

- entity insert actions;
- entity update actions;
- entity delete actions;
- collection remove actions;
- collection update actions;
- collection recreate actions;
- orphan removal actions;
- queued after-transaction processes.

### 19.2 Why Ordering Matters

Contoh:

```text
Parent insert must happen before Child insert if Child FK points to Parent.
Child delete may need to happen before Parent delete.
Join table delete may need to happen before entity delete.
```

Hibernate berusaha mengurutkan SQL, tetapi mapping yang buruk tetap bisa membuat constraint conflict.

Contoh failure:

- circular FK mandatory;
- bidirectional one-to-one salah ownership;
- delete parent dengan child masih reference;
- unique constraint conflict saat mengganti child;
- `orphanRemoval` dan reassignment ambigu.

---

## 20. StatelessSession: Bypassing the Normal Engine

`StatelessSession` adalah API Hibernate untuk operasi yang tidak memakai persistence context normal.

Karakteristik:

- tidak ada first-level cache seperti `Session` biasa;
- tidak ada dirty checking otomatis;
- tidak ada cascade normal;
- operasi lebih dekat ke row-level command;
- cocok untuk batch tertentu;
- tidak cocok untuk domain aggregate mutation biasa.

### 20.1 Use Cases

Cocok untuk:

- ETL sederhana;
- batch import;
- bulk export read;
- high-volume row transformation;
- migration data teknis.

Tidak cocok untuk:

- aggregate business operation;
- workflow transition;
- graph persistence;
- operation yang bergantung cascade/orphan removal;
- operation yang butuh entity listener normal.

### 20.2 Design Warning

Jika kita memakai `StatelessSession`, kita sengaja keluar dari banyak safety net ORM.

Artinya kita harus mengganti safety net itu dengan:

- explicit validation;
- explicit ordering;
- explicit version handling jika perlu;
- explicit audit;
- explicit batching;
- careful transaction slicing.

---

## 21. Extension Decision Matrix

Saat butuh custom behavior, jangan langsung memilih hook paling dalam.

Gunakan matrix ini.

| Kebutuhan | Pilihan Pertama | Alternatif | Hindari |
|---|---|---|---|
| set createdAt/updatedAt | JPA callback / Spring auditing | Hibernate listener | service tersebar manual |
| business workflow event | domain event/outbox | app service explicit audit | entity listener kirim email |
| SQL correlation id | StatementInspector | datasource proxy | string rewrite business logic |
| tenant isolation | multi-tenancy/filter/DB RLS | query predicate framework | manual `where tenant` tersebar |
| soft delete | provider soft delete/filter/design schema | `@SQLDelete` + filter | hanya boolean tanpa policy |
| custom DB type | Hibernate custom type | AttributeConverter | getter/setter string hack |
| field-level audit diff | Envers / listener | DB trigger | dirty checking diff sebagai business audit penuh |
| cross-provider portability | JPA callback/spec feature | abstraction layer | Hibernate SPI |
| high-volume batch | bulk SQL/StatelessSession | batched Session | huge managed persistence context |

---

## 22. Production Failure Mode: Listener Recursion

### 22.1 Scenario

Aplikasi punya listener:

```java
public class AuditListener implements PostUpdateEventListener {
    @Override
    public void onPostUpdate(PostUpdateEvent event) {
        AuditTrail audit = AuditTrail.from(event);
        event.getSession().persist(audit);
    }
}
```

Masalah:

- `persist(audit)` terjadi saat flush;
- persist bisa menambah action baru;
- audit entity bisa memicu listener juga;
- flush ordering menjadi kompleks;
- kalau audit entity punya association, bisa cascade;
- jika exception terjadi, seluruh transaction rollback.

### 22.2 Safer Pattern

- Jangan audit `AuditTrail` entity itu sendiri.
- Gunakan outbox buffer yang diproses setelah flush/commit.
- Atau tulis audit secara eksplisit di service layer.
- Atau gunakan database trigger untuk low-level audit.
- Atau gunakan Envers jika model cocok.

Konsep:

```text
Pre/Post event listener
    -> collect lightweight audit record
    -> register after-transaction process / transaction synchronization
    -> write after commit or in same transaction with strict guard
```

Tetap harus hati-hati: after commit berarti audit bisa gagal setelah business commit jika tidak memakai outbox transactional.

Untuk regulatory system, biasanya lebih baik:

```text
business transaction
    -> write business change
    -> write audit/outbox in same DB transaction
commit
    -> async publisher sends external event
```

---

## 23. Production Failure Mode: Filter Not Enabled

### 23.1 Scenario

Tenant filter hanya di-enable di web request interceptor.

Kemudian ada scheduled job:

```java
@Scheduled
public void closeExpiredCases() {
    repository.findExpiredCases().forEach(CaseRecord::close);
}
```

Job tidak punya request context, filter tidak aktif.

Akibat:

- job membaca semua tenant;
- update lintas tenant;
- audit kacau;
- incident data leakage.

### 23.2 Fix Pattern

- Scheduled job harus eksplisit memilih tenant scope.
- Jangan menjalankan tenant-sensitive repository tanpa tenant context.
- Buat guard:

```java
if (!TenantContext.exists()) {
    throw new IllegalStateException("Tenant context is required for tenant-scoped session");
}
```

- Untuk job cross-tenant, iterate tenant satu per satu:

```java
for (Tenant tenant : tenants) {
    tenantScope.run(tenant.id(), () -> closeExpiredCasesForCurrentTenant());
}
```

- Tambahkan integration test yang membuktikan tidak ada cross-tenant update.

---

## 24. Production Failure Mode: StatementInspector Abuse

### 24.1 Scenario

Tim mencoba menambahkan security predicate dengan SQL rewrite:

```java
return sql + " and agency_id = " + currentAgency;
```

Masalah langsung:

- SQL belum tentu punya `where`;
- SQL bisa `insert`, `update`, `delete`;
- query bisa punya `order by`;
- query bisa punya subquery;
- alias table tidak diketahui;
- parameter binding rusak;
- SQL injection risk;
- query plan kacau.

### 24.2 Correct Direction

Untuk authorization:

- cek permission di service/application layer;
- pakai query predicate eksplisit untuk data scope;
- pakai Hibernate filter jika cocok;
- pakai database row-level security untuk hard boundary;
- audit bypass/admin access.

`StatementInspector` cukup untuk observability, bukan enforcement utama.

---

## 25. Production Failure Mode: Entity Callback Uses Injected Service

### 25.1 Scenario

```java
@Entity
class CaseRecord {
    @PreUpdate
    void onUpdate() {
        ApplicationContextProvider.getBean(NotificationService.class)
            .sendStatusChangedEmail(this);
    }
}
```

Akibat:

- entity tergantung Spring/container;
- callback bisa terpanggil saat flush tak terduga;
- email terkirim sebelum commit;
- rollback tidak membatalkan email;
- serialization/test makin rumit;
- entity tidak lagi pure domain/persistence model.

### 25.2 Correct Pattern

Business side effect keluar dari entity lifecycle callback.

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseRecord caseRecord = caseRepository.get(command.caseId());
    caseRecord.approve(command.reason(), currentUser());

    outboxRepository.save(EventMessage.caseApproved(caseRecord.id()));
}
```

Lalu publisher memproses outbox setelah commit.

---

## 26. Hibernate Extension and Spring Boot

Dalam Spring Boot, banyak Hibernate extension dikonfigurasi lewat property atau bean.

Contoh konseptual property:

```properties
spring.jpa.properties.hibernate.session_factory.statement_inspector=com.example.CorrelationStatementInspector
spring.jpa.properties.hibernate.generate_statistics=true
```

Atau dengan customizer:

```java
@Bean
HibernatePropertiesCustomizer hibernateCustomizer(StatementInspector inspector) {
    return properties -> properties.put(
        "hibernate.session_factory.statement_inspector",
        inspector
    );
}
```

### 26.1 Design Rule

Jika memakai Spring Boot:

- jangan campur konfigurasi Hibernate manual dan auto-config tanpa alasan;
- pastikan extension aktif di test dan runtime sama;
- test dengan database nyata jika behavior SQL penting;
- dokumentasikan provider-specific property;
- jangan mengandalkan default yang berubah antar versi Boot/Hibernate.

---

## 27. Hibernate Version Lines: Java 8–25 Practical View

### 27.1 Legacy Line: Java 8

Umumnya bertemu:

- Hibernate 5.x;
- `javax.persistence`;
- JPA 2.1/2.2;
- older Spring Boot 2.x;
- older app server;
- older bytecode/enhancement setup.

Perhatikan:

- API package `javax.persistence`;
- old dialect class names;
- old type system;
- older query behavior;
- limited modern Java type support;
- migration ke Jakarta butuh dependency cleanup.

### 27.2 Modern Line: Java 17/21/25

Umumnya bertemu:

- Hibernate 6.x/7.x;
- `jakarta.persistence`;
- Spring Boot 3.x/4.x ecosystem;
- Jakarta EE 10/11 alignment;
- stronger SQL AST/type system behavior;
- modern Java records/support tertentu tergantung versi;
- better support untuk database feature tertentu.

Perhatikan:

- migration query bisa break;
- custom type SPI berubah;
- dialect behavior berubah;
- package namespace berubah;
- enhancement plugin version harus align;
- integration tests wajib.

### 27.3 Development Line Warning

Hibernate 8.x development line harus diperlakukan sebagai non-baseline untuk production sampai stabil dalam konteks organisasi. Ia penting untuk awareness, bukan default target enterprise.

---

## 28. Advanced Design Rule: Keep Business Semantics Above Provider Hooks

Salah satu kesalahan engineer berpengalaman adalah terlalu cepat menggunakan provider hook untuk business rule.

Contoh business rule:

> Case tidak boleh di-approve jika outstanding compliance check masih open.

Jangan taruh ini di `PreUpdateEventListener`.

Lebih tepat:

```java
public void approve(ApprovalCommand command) {
    if (hasOpenComplianceCheck()) {
        throw new DomainException("Cannot approve case with open compliance check");
    }
    this.status = APPROVED;
    this.approvedBy = command.officerId();
    this.approvedAt = command.now();
}
```

Provider hook boleh membantu technical consistency, bukan menggantikan domain model.

### 28.1 Layering yang Sehat

```text
Controller/API
    -> parse request, auth principal
Application Service
    -> transaction boundary, authorization, orchestration
Domain Model
    -> invariant, state transition, business semantics
Repository/ORM
    -> persistence mechanics
Hibernate Hook
    -> technical cross-cutting concern
Database
    -> constraints, durability, isolation
```

Kalau business invariant hanya hidup di Hibernate listener, maka:

- bulk update bisa bypass;
- native query bisa bypass;
- test domain tanpa Hibernate tidak menangkap;
- developer sulit menemukan rule;
- migration provider menjadi berbahaya.

---

## 29. Reading Hibernate Stack Traces

Hibernate stack trace sering panjang. Cara membacanya:

### 29.1 Identifikasi Layer

Cari apakah error muncul saat:

- bootstrap;
- query parsing;
- query execution;
- entity loading;
- dirty checking;
- flush;
- JDBC execution;
- transaction commit;
- cache access;
- event listener callback.

### 29.2 Clue Umum

| Clue | Kemungkinan Area |
|---|---|
| `MappingException` | metadata/mapping/bootstrap |
| `QueryException` / semantic exception | HQL/JPQL parsing/semantic |
| `LazyInitializationException` | session boundary/lazy loading |
| `TransientObjectException` | association/cascade missing |
| `NonUniqueObjectException` | identity conflict in session |
| `StaleObjectStateException` | optimistic locking |
| `ConstraintViolationException` | DB constraint during flush |
| `PropertyValueException` | nullability/transient reference |
| `MultipleBagFetchException` | fetch plan collection issue |
| SQL grammar exception | dialect/native SQL/schema mismatch |

Top engineer bertanya:

```text
Apa operasi application-level yang memicu flush/load/query?
Entity apa yang managed saat itu?
Mapping mana yang ikut cascade/fetch?
SQL apa yang dihasilkan?
Constraint/cache/lock mana yang terlibat?
```

---

## 30. Diagnostic Checklist for Hibernate Internals

Saat debugging issue Hibernate, gunakan checklist ini.

### 30.1 Scope

- Session/persistence context dibuat di mana?
- Ditutup di mana?
- Apakah melewati thread boundary?
- Apakah transaction active?
- Apakah OSIV aktif?

### 30.2 State

- Entity managed atau detached?
- Ada duplicate instance dengan ID sama?
- Collection initialized atau lazy?
- Entity read-only atau mutable?
- Snapshot berubah atau tidak?

### 30.3 Flush

- Flush terjadi karena commit atau query?
- Flush mode apa?
- Action queue berisi apa?
- SQL ordering bermasalah?
- Constraint mana yang gagal?

### 30.4 Extension

- Ada entity listener?
- Ada Hibernate event listener?
- Ada interceptor?
- Ada StatementInspector?
- Ada filter aktif?
- Ada custom type/converter?
- Ada multi-tenancy resolver?

### 30.5 Query

- JPQL/HQL/native?
- Fetch join?
- Entity graph?
- Filter apply atau tidak?
- Pagination aman?
- Query plan cache issue?

### 30.6 Cache

- L1 cache stale?
- L2 cache aktif?
- Query cache aktif?
- Tenant-safe cache key?
- Cache invalidated setelah update?

---

## 31. Mini Case Study: Regulatory Case Approval with Hibernate Hooks

### 31.1 Requirement

Sistem case management butuh:

- case approval;
- audit trail;
- officer attribution;
- tenant isolation;
- notification;
- SLA event;
- regulatory defensibility.

### 31.2 Bad Design

```text
@PreUpdate on CaseRecord
    -> detect status changed to APPROVED
    -> insert audit trail
    -> send email
    -> close tasks
    -> calculate SLA
    -> notify external system
```

Masalah:

- callback terlalu banyak tanggung jawab;
- status change bisa terjadi karena migration/bulk update;
- email bisa terkirim sebelum commit;
- task close hidden;
- audit semantic lemah;
- retry sulit;
- rollback behavior salah;
- listener recursion risk.

### 31.3 Better Design

```text
Application Service: ApproveCaseUseCase
    -> load Case aggregate with needed checks
    -> authorize officer
    -> validate state transition
    -> call case.approve(...)
    -> close relevant tasks explicitly
    -> write CaseApproved business event to outbox
    -> write audit trail row with command context
    -> commit transaction

Hibernate callback/listener
    -> set updatedAt/updatedBy
    -> optionally capture technical field diff

Outbox worker
    -> send notification
    -> publish integration event
    -> update delivery status
```

### 31.4 Why Better?

Karena business meaning eksplisit.

Provider hook hanya mendukung technical persistence concern. Workflow tetap bisa dibaca, dites, diaudit, dan dijelaskan ke stakeholder/regulator.

---

## 32. Anti-Patterns

### 32.1 Global Magic Listener

Listener global mengubah entity tanpa terlihat di service/domain code.

Gejala:

- developer bingung kenapa field berubah;
- test perlu Hibernate untuk semua domain rule;
- migration provider sulit;
- side effect muncul saat flush tak terduga.

### 32.2 Entity as Service Locator

Entity mengambil Spring bean/container service.

Gejala:

- entity tidak bisa dites murni;
- lifecycle callback unpredictable;
- side effect sebelum commit;
- coupling tinggi.

### 32.3 SQL String Rewriting for Security

Memakai `StatementInspector` untuk inject authorization predicate.

Gejala:

- bypass native query;
- SQL rusak;
- tenant leakage;
- false sense of security.

### 32.4 Filter Without Fail-Closed Guard

Filter tenant/soft delete aktif hanya jika developer ingat enable.

Gejala:

- background job leak;
- admin query salah;
- test tidak menangkap;
- incident data exposure.

### 32.5 Audit by Field Diff Only

Menganggap field diff cukup sebagai business audit.

Gejala:

- tidak tahu alasan perubahan;
- tidak tahu command/action asal;
- tidak bisa rekonstruksi decision path;
- regulatory explanation lemah.

---

## 33. Design Rules for Top-Level Engineering

1. Treat Hibernate as a state synchronization runtime, not a CRUD helper.
2. Keep `SessionFactory` singleton per persistence unit.
3. Keep `Session` short-lived and thread-confined.
4. Do not put business workflow inside entity lifecycle callbacks.
5. Use provider hooks for infrastructure concern, not domain meaning.
6. Prefer explicit application service orchestration for workflow.
7. Use event listeners only when JPA callbacks are insufficient.
8. Use `StatementInspector` for observability, not authorization.
9. Use filters/multi-tenancy with fail-closed activation.
10. Treat native query and bulk operation as possible bypass paths.
11. Design audit as business event plus technical diff, not diff only.
12. Never send external side effect before transaction commit unless intentionally compensated.
13. Version-lock and test any Hibernate SPI extension.
14. Keep extension registration visible and documented.
15. Always test provider-specific behavior with the actual provider/database version.

---

## 34. Practice Scenarios

### Scenario 1 — Unexpected Email Sent on Rollback

A `@PostUpdate` callback sends an email when `status = APPROVED`. Later transaction fails due to constraint violation.

Questions:

1. Why was email sent even though DB rollback happened?
2. Which layer should own notification?
3. How would outbox fix this?
4. What should Hibernate listener still be allowed to do?

Expected reasoning:

- lifecycle callback runs during flush before final commit guarantee;
- external side effect is not transactional with DB;
- outbox writes message in same transaction;
- async worker sends after commit.

### Scenario 2 — Tenant Leakage in Scheduled Job

Web request enables tenant filter. Scheduled job does not.

Questions:

1. Why did repository tests pass?
2. Why did job update all tenants?
3. How to design fail-closed tenant context?
4. Should DB RLS be considered?

Expected reasoning:

- tests likely ran inside request-like setup;
- filter activation is contextual;
- tenant-sensitive session should fail if tenant missing;
- DB defense-in-depth helps.

### Scenario 3 — Audit Listener Recursion

Post-update listener persists `AuditTrail`, but `AuditTrail` is also audited.

Questions:

1. Why recursion happens?
2. How to exclude audit entity?
3. Is same-transaction audit required?
4. Would database trigger be simpler?

Expected reasoning:

- audit entity operation triggers same listener;
- listener must guard entity type;
- regulatory audit often same transaction;
- DB trigger can be safety net but lacks business context.

### Scenario 4 — StatementInspector Rewrites SQL

Team injects `agency_id` predicate through string replacement.

Questions:

1. What SQL shapes break?
2. Why is this not safe authorization?
3. What are better alternatives?
4. How to test bypass paths?

Expected reasoning:

- subquery/update/delete/native/pagination break;
- enforcement at SQL string layer is fragile;
- filters/query predicates/RLS/application auth;
- test native, bulk, admin, async paths.

---

## 35. Summary

Hibernate adalah persistence runtime yang jauh lebih kompleks daripada sekadar implementasi JPA.

Komponen kunci yang harus dipahami:

- `SessionFactory` sebagai immutable heavyweight runtime;
- `Session` sebagai unit-of-work dan persistence context;
- persistence context sebagai identity map plus state tracker;
- persister sebagai compiled mapping representation;
- service registry sebagai internal dependency system;
- event system sebagai state transition bus;
- interceptor/listener/statement inspector sebagai extension hooks;
- filters dan multi-tenancy sebagai dynamic constraint mechanism;
- custom type system sebagai bridge antara Java value dan JDBC/database representation.

Namun pelajaran terpentingnya bukan hanya teknis.

Pelajaran terpenting:

> Jangan menaruh business meaning terlalu dalam di provider hook.

Provider hook kuat untuk infrastructure concern:

- timestamps;
- technical audit;
- SQL correlation;
- custom type;
- soft delete mechanics;
- tenant filter;
- low-level event observation.

Tetapi workflow, authorization, state transition, approval, escalation, notification, dan regulatory explanation harus tetap eksplisit di application/domain layer.

Engineer level tinggi bukan hanya tahu cara memakai extension Hibernate. Ia tahu **kapan tidak memakainya**.

---

## 36. Referensi Utama

- Hibernate ORM Documentation: https://hibernate.org/orm/documentation/
- Hibernate ORM Releases: https://hibernate.org/orm/releases/
- Hibernate ORM User Guide: https://docs.hibernate.org/stable/orm/userguide/html_single/
- Jakarta Persistence Specification: https://jakarta.ee/specifications/persistence/
- Hibernate ORM 8.0 Development Line Notice: https://hibernate.org/orm/releases/8.0/

---

## 37. Status Seri

Bagian ini adalah **Part 24 dari 34**.

Seri **belum selesai**.

Bagian berikutnya:

```text
25-eclipselink-sessions-descriptors-weaving-cache-advanced-mappings.md
```

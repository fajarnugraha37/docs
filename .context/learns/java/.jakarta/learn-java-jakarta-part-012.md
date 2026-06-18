# learn-java-jakarta-part-012.md

# Bagian 12 — Jakarta Persistence (`jakarta.persistence`) / JPA

> Target pembaca: Java engineer yang ingin memahami Jakarta Persistence bukan hanya sebagai kumpulan annotation seperti `@Entity`, `@Id`, `@OneToMany`, tetapi sebagai **unit-of-work + identity map + object/relational mapping + query model + transaction integration** yang punya konsekuensi besar terhadap correctness, performance, concurrency, dan desain domain.
>
> Fokus bagian ini: mental model persistence context, entity lifecycle, `EntityManager`, transaction boundary, dirty checking, flush, mapping, relationship, cascade, locking, query, Criteria, converter, inheritance, provider boundary, performance failure modes, dan cara memakai Jakarta Persistence secara production-grade.

---

## Daftar Isi

1. [Orientasi: Jakarta Persistence Itu Apa?](#1-orientasi-jakarta-persistence-itu-apa)
2. [Mental Model Besar: ORM Bukan Sekadar Mapping Table ke Class](#2-mental-model-besar-orm-bukan-sekadar-mapping-table-ke-class)
3. [Jakarta Persistence 3.2 dalam Jakarta EE 11](#3-jakarta-persistence-32-dalam-jakarta-ee-11)
4. [Dependency, API, Provider, dan Runtime](#4-dependency-api-provider-dan-runtime)
5. [Entity, Persistence Unit, EntityManager, Persistence Context](#5-entity-persistence-unit-entitymanager-persistence-context)
6. [Persistence Context sebagai Identity Map dan Unit of Work](#6-persistence-context-sebagai-identity-map-dan-unit-of-work)
7. [Entity Lifecycle: New, Managed, Detached, Removed](#7-entity-lifecycle-new-managed-detached-removed)
8. [`EntityManager`: Operasi Inti](#8-entitymanager-operasi-inti)
9. [Container-Managed vs Application-Managed EntityManager](#9-container-managed-vs-application-managed-entitymanager)
10. [Transaction-Scoped vs Extended Persistence Context](#10-transaction-scoped-vs-extended-persistence-context)
11. [Transaction Integration dan `@Transactional`](#11-transaction-integration-dan-transactional)
12. [Dirty Checking dan Flush](#12-dirty-checking-dan-flush)
13. [ID, Entity Identity, Equality, dan HashCode](#13-id-entity-identity-equality-dan-hashcode)
14. [Basic Mapping: `@Entity`, `@Table`, `@Column`, `@Id`](#14-basic-mapping-entity-table-column-id)
15. [Embeddable dan Value Object](#15-embeddable-dan-value-object)
16. [Java Record sebagai Embeddable](#16-java-record-sebagai-embeddable)
17. [Relationship Mapping: One-to-One, Many-to-One, One-to-Many, Many-to-Many](#17-relationship-mapping-one-to-one-many-to-one-one-to-many-many-to-many)
18. [Owning Side, Inverse Side, dan Join Column](#18-owning-side-inverse-side-dan-join-column)
19. [Cascade dan Orphan Removal](#19-cascade-dan-orphan-removal)
20. [Fetch Strategy: Lazy vs Eager](#20-fetch-strategy-lazy-vs-eager)
21. [JPQL dan TypedQuery](#21-jpql-dan-typedquery)
22. [Criteria API](#22-criteria-api)
23. [Native Query dan Stored Procedure](#23-native-query-dan-stored-procedure)
24. [Converters dan Custom Type Mapping](#24-converters-dan-custom-type-mapping)
25. [Enum Mapping dan `@EnumeratedValue`](#25-enum-mapping-dan-enumeratedvalue)
26. [Date/Time Mapping](#26-datetime-mapping)
27. [Optimistic Locking dan `@Version`](#27-optimistic-locking-dan-version)
28. [Pessimistic Locking](#28-pessimistic-locking)
29. [Inheritance Mapping](#29-inheritance-mapping)
30. [Validation, Constraint, dan Database Constraint](#30-validation-constraint-dan-database-constraint)
31. [Domain Model vs Persistence Model](#31-domain-model-vs-persistence-model)
32. [Repository Pattern dan Transaction Boundary](#32-repository-pattern-dan-transaction-boundary)
33. [Provider Boundary: Standard JPA vs Hibernate/EclipseLink Extension](#33-provider-boundary-standard-jpa-vs-hibernateeclipselink-extension)
34. [Performance Engineering](#34-performance-engineering)
35. [Common Failure Modes](#35-common-failure-modes)
36. [Testing Strategy](#36-testing-strategy)
37. [Production Checklist](#37-production-checklist)
38. [Latihan Bertahap](#38-latihan-bertahap)
39. [Mini Project: Jakarta Persistence Case Management Lab](#39-mini-project-jakarta-persistence-case-management-lab)
40. [Referensi Resmi](#40-referensi-resmi)

---

# 1. Orientasi: Jakarta Persistence Itu Apa?

Jakarta Persistence adalah standard API untuk mengelola persistence dan object/relational mapping di Java.

Dalam praktik, ia sering disebut JPA.

JPA membantu kamu memetakan object Java ke relational database:

```java
@Entity
@Table(name = "cases")
public class EnforcementCase {
    @Id
    private UUID id;

    @Column(nullable = false)
    private String caseNumber;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;
}
```

Tetapi kalau kamu hanya melihat annotation di atas, kamu akan salah memahami JPA.

JPA bukan hanya:

```text
class → table
field → column
object → row
```

JPA juga mencakup:

- persistence context;
- entity lifecycle;
- identity map;
- unit of work;
- dirty checking;
- flush;
- transaction integration;
- query language;
- criteria API;
- relationship management;
- cascade;
- locking;
- mapping metadata;
- provider behavior;
- first-level cache;
- object identity;
- lazy loading;
- optimistic concurrency.

## 1.1 Kenapa JPA sering disalahpahami?

Karena API-nya terlihat sederhana:

```java
entityManager.persist(caseEntity);
```

Tetapi di baliknya ada banyak behavior:

```text
Is entity new or managed?
Which persistence context owns it?
Is transaction active?
When will SQL be executed?
Will ID be generated immediately?
Will relationships cascade?
Will flush happen before query?
Will optimistic lock version change?
Will lazy relation initialize?
```

Banyak bug production JPA terjadi bukan karena engineer tidak tahu annotation, tetapi karena tidak paham lifecycle.

## 1.2 Jakarta Persistence bukan database abstraction universal

JPA dirancang terutama untuk object/relational mapping dengan relational database.

Ia bukan pengganti:

- SQL literacy;
- schema design;
- index design;
- transaction design;
- query tuning;
- database constraint;
- migration tooling;
- observability DB;
- data lifecycle design;
- concurrency control.

Engineer top-tier memakai JPA dengan tetap memahami database.

## 1.3 Prinsip utama

> JPA membuat object graph dan relational model bisa bekerja sama, tetapi mismatch antara keduanya tidak hilang. Ia hanya dikelola.

Mismatch tersebut disebut **object-relational impedance mismatch**.

Contoh mismatch:

| Object World | Relational World |
|---|---|
| identity object | primary key |
| reference | foreign key |
| collection | join / child table |
| inheritance | table strategy |
| object graph traversal | SQL joins |
| lifecycle object | row lifecycle |
| encapsulation | columns/constraints |
| equality | key equality |
| in-memory mutation | transactional update |

---

# 2. Mental Model Besar: ORM Bukan Sekadar Mapping Table ke Class

## 2.1 ORM sebagai translator

ORM menerjemahkan:

```text
Java object operations
  ↓
SQL operations
```

Contoh:

```java
caseEntity.setStatus(CaseStatus.APPROVED);
```

bisa menjadi:

```sql
update cases set status = 'APPROVED', version = version + 1 where id = ? and version = ?
```

Tetapi SQL tersebut biasanya tidak dikirim tepat saat setter dipanggil.

SQL bisa dikirim saat:

- flush;
- query execution;
- transaction commit;
- explicit `entityManager.flush()`.

## 2.2 ORM sebagai unit of work

JPA mengumpulkan perubahan entity managed dalam persistence context.

```text
load entity
  ↓
change fields
  ↓
dirty checking detects changes
  ↓
flush generates SQL
  ↓
transaction commit
```

## 2.3 ORM sebagai identity map

Dalam persistence context yang sama:

```java
Case a = em.find(Case.class, id);
Case b = em.find(Case.class, id);
```

Biasanya:

```java
a == b
```

Karena persistence context menjaga satu managed instance per persistent identity.

## 2.4 ORM sebagai lazy object graph

Relationship bisa lazy.

```java
caseEntity.getDocuments().size();
```

Mungkin memicu query tambahan.

Jika dilakukan dalam loop, bisa menjadi N+1 query.

## 2.5 ORM sebagai transaction participant

JPA provider bekerja dengan transaction manager.

JPA harus tahu:

- kapan join transaction;
- kapan flush;
- kapan rollback;
- kapan entity detached;
- resource/datasource mana yang dipakai.

## 2.6 ORM sebagai abstraction yang bocor

JPA abstraction bocor saat:

- query lambat;
- lazy loading error;
- N+1;
- lock timeout;
- deadlock;
- detached entity;
- stale update;
- wrong cascade deletes;
- generated SQL tidak sesuai harapan.

Karena itu engineer harus bisa membaca SQL yang dihasilkan provider.

---

# 3. Jakarta Persistence 3.2 dalam Jakarta EE 11

Jakarta Persistence 3.2 adalah release untuk Jakarta EE 11.

## 3.1 Fitur dan enhancement penting

Jakarta Persistence 3.2 membawa sejumlah improvement, antara lain:

- support Java record types as embeddable classes;
- support tambahan untuk `java.time.Instant` dan `java.time.Year`;
- klarifikasi JDBC mapping untuk basic types;
- tambahan operasi set seperti `union`, `intersect`, `except` di JPQL/Criteria;
- tambahan function/operator seperti `cast`, `left`, `right`, `replace`, `||`, `id`, `version`;
- peningkatan Criteria API seperti `CriteriaSelect`, `subquery(EntityType)`, dan joins on `EntityType`;
- enum mapping improvement seperti `@EnumeratedValue`.

## 3.2 Kenapa ini penting?

Karena JPA modern makin dekat dengan Java modern:

- Java records untuk value object/embeddable;
- `java.time` lebih natural;
- query language lebih ekspresif;
- criteria API lebih kuat;
- enum mapping lebih eksplisit.

## 3.3 Jakarta Persistence 4.0

Halaman Jakarta Persistence juga mencatat Jakarta Persistence 4.0 under development untuk Jakarta EE 12.

Untuk production sekarang, targetkan versi yang didukung runtime kamu, misalnya Jakarta Persistence 3.2 di Jakarta EE 11.

---

# 4. Dependency, API, Provider, dan Runtime

## 4.1 API dependency

Individual API:

```xml
<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
  <version>3.2.0</version>
</dependency>
```

Dalam Jakarta EE runtime, biasanya dependency ini tercakup oleh profile/platform API:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

atau full Platform:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 4.2 API jar bukan provider

`jakarta.persistence-api` hanya berisi API:

- `EntityManager`;
- `EntityManagerFactory`;
- annotations;
- query interfaces;
- criteria interfaces;
- mapping enums;
- exceptions.

Ia tidak berisi ORM engine.

Untuk behavior, kamu butuh provider:

- Hibernate ORM;
- EclipseLink;
- provider lain.

## 4.3 Runtime/container

Dalam Jakarta EE runtime:

```text
Application uses jakarta.persistence API
  ↓
Runtime provides provider integration
  ↓
Provider talks to database via DataSource/JDBC
```

Runtime juga mengintegrasikan:

- JTA transaction;
- container-managed persistence context;
- datasource;
- injection;
- deployment;
- persistence unit.

## 4.4 Plain Java SE

Jika aplikasi Java SE standalone:

```text
You own EntityManagerFactory lifecycle.
You configure provider.
You manage transactions if resource-local.
You close resources.
```

Example conceptual:

```java
EntityManagerFactory emf = Persistence.createEntityManagerFactory("app");
EntityManager em = emf.createEntityManager();
try {
    em.getTransaction().begin();
    em.persist(entity);
    em.getTransaction().commit();
} finally {
    em.close();
    emf.close();
}
```

## 4.5 Jakarta EE environment

In Jakarta EE:

```java
@PersistenceContext
EntityManager em;
```

Container can manage lifecycle and transaction association.

## 4.6 Common mistake

Menambahkan:

```xml
jakarta.persistence-api
```

lalu berharap ORM jalan.

Tidak cukup. Harus ada provider dan konfigurasi persistence unit/runtime.

---

# 5. Entity, Persistence Unit, EntityManager, Persistence Context

Empat istilah ini wajib dikuasai.

## 5.1 Entity

Entity adalah class Java yang persistent identity-nya dipetakan ke database.

```java
@Entity
@Table(name = "cases")
public class EnforcementCase {
    @Id
    private UUID id;
}
```

Entity memiliki:

- identity;
- persistent state;
- lifecycle;
- mapping metadata.

## 5.2 Persistence Unit

Persistence unit adalah konfigurasi set entity dan provider/database config.

Biasanya didefinisikan di:

```text
META-INF/persistence.xml
```

atau melalui runtime config/framework.

Persistence unit menjawab:

- entity mana yang dikelola;
- provider apa yang digunakan;
- datasource apa;
- transaction type;
- properties provider;
- mapping files;
- schema generation settings.

## 5.3 EntityManager

`EntityManager` adalah API utama untuk berinteraksi dengan persistence context.

Ia dipakai untuk:

- `persist`;
- `find`;
- `merge`;
- `remove`;
- `flush`;
- `clear`;
- `detach`;
- create query;
- lock;
- refresh;
- get reference.

## 5.4 Persistence Context

Persistence context adalah set entity instances yang managed.

Dalam satu persistence context, untuk satu persistent identity, ada satu managed instance.

Ini penting.

```text
persistence context
  Case#1 -> object A
  Case#2 -> object B
```

## 5.5 EntityManager vs Persistence Context

`EntityManager` adalah interface/API.

Persistence context adalah state internal/konseptual yang dikelola.

Satu EntityManager associated dengan persistence context tertentu.

## 5.6 First-level cache

Persistence context sering disebut first-level cache.

Tetapi jangan pikir seperti cache umum.

Ia adalah identity map/unit-of-work context yang hidup sesuai scope.

---

# 6. Persistence Context sebagai Identity Map dan Unit of Work

## 6.1 Identity map

Jika entity dengan ID sama di-load dua kali dalam persistence context yang sama:

```java
EnforcementCase c1 = em.find(EnforcementCase.class, id);
EnforcementCase c2 = em.find(EnforcementCase.class, id);
```

Biasanya:

```java
c1 == c2
```

Manfaat:

- consistency in memory;
- no duplicate managed object for same row;
- change tracking lebih mudah;
- relationship identity stabil.

## 6.2 Unit of work

Persistence context mengumpulkan perubahan.

```java
caseEntity.approve(actor, now);
caseEntity.assignTo(supervisor);
```

Tidak langsung berarti dua SQL update saat itu juga.

Provider bisa flush perubahan sekaligus.

## 6.3 Dirty checking

Provider membandingkan state entity managed dengan snapshot/track changes.

Jika berubah, SQL update dihasilkan saat flush.

## 6.4 Scope matters

Jika persistence context terlalu pendek:

- entity cepat detached;
- lazy loading error;
- merge banyak.

Jika terlalu panjang:

- memory membesar;
- stale data;
- unexpected flush;
- transaction boundary kabur.

## 6.5 Clear mental model

```text
Managed entity mutation is not database mutation immediately.
Database mutation happens when persistence context is flushed in transaction.
```

---

# 7. Entity Lifecycle: New, Managed, Detached, Removed

## 7.1 New / Transient

Object baru, belum persistent.

```java
EnforcementCase c = new EnforcementCase(id);
```

State:

```text
new/transient
not in persistence context
not represented as managed row yet
```

## 7.2 Managed

Entity berada dalam persistence context.

```java
em.persist(c);
```

atau:

```java
EnforcementCase c = em.find(EnforcementCase.class, id);
```

State:

```text
managed
tracked by persistence context
dirty checking applies
```

## 7.3 Detached

Entity pernah managed, tetapi tidak lagi associated dengan active persistence context.

Penyebab:

- transaction-scoped context ended;
- `em.detach(entity)`;
- `em.clear()`;
- `em.close()`;
- serialization across layers;
- returning entity outside transaction.

Detached entity changes are not automatically persisted.

## 7.4 Removed

Entity marked for deletion.

```java
em.remove(c);
```

SQL delete happens at flush/commit.

## 7.5 Lifecycle diagram

```text
new
  | persist
  v
managed
  | detach/clear/close/context end
  v
 detached

managed
  | remove
  v
removed
  | flush/commit
  v
deleted row

 detached
  | merge
  v
managed copy
```

## 7.6 `merge` confusion

`merge(detached)` does not reattach the same object in the way many beginners imagine.

It returns a managed instance/copy.

```java
EnforcementCase managed = em.merge(detached);
```

After merge:

```text
detached object may still be detached
managed return value should be used
```

Bad:

```java
em.merge(detached);
detached.approve(...); // still detached, changes may not persist
```

Better:

```java
EnforcementCase managed = em.merge(detached);
managed.approve(...);
```

## 7.7 Lifecycle rule

> Always know whether your entity is new, managed, detached, or removed.

---

# 8. `EntityManager`: Operasi Inti

## 8.1 `persist`

Makes new entity managed and scheduled for insert.

```java
em.persist(caseEntity);
```

Use for new entity.

## 8.2 `find`

Find by primary key.

```java
EnforcementCase c = em.find(EnforcementCase.class, id);
```

Returns managed entity if found.

## 8.3 `getReference`

Returns reference/proxy to entity.

```java
EnforcementCase c = em.getReference(EnforcementCase.class, id);
```

May avoid immediate DB hit but can fail later if entity not found.

Use carefully.

## 8.4 `merge`

Copies state from detached entity into managed instance.

```java
EnforcementCase managed = em.merge(detached);
```

## 8.5 `remove`

Marks managed entity for deletion.

```java
em.remove(c);
```

If detached, usually need find/merge first depending case.

## 8.6 `flush`

Synchronizes persistence context changes to database within transaction.

```java
em.flush();
```

Flush does not necessarily commit transaction.

## 8.7 `clear`

Detaches all managed entities.

```java
em.clear();
```

Useful in batch loops to avoid memory growth.

## 8.8 `detach`

Detach one entity.

```java
em.detach(c);
```

## 8.9 `refresh`

Reload entity state from database.

```java
em.refresh(c);
```

Can overwrite local changes.

## 8.10 `contains`

Check if entity is managed in current persistence context.

```java
boolean managed = em.contains(c);
```

## 8.11 `createQuery`

```java
TypedQuery<EnforcementCase> q = em.createQuery(
    "select c from EnforcementCase c where c.status = :status",
    EnforcementCase.class
);
```

## 8.12 `lock`

Apply lock mode.

```java
em.lock(c, LockModeType.OPTIMISTIC_FORCE_INCREMENT);
```

---

# 9. Container-Managed vs Application-Managed EntityManager

## 9.1 Container-managed

In Jakarta EE:

```java
@PersistenceContext
EntityManager em;
```

Container manages:

- EntityManager lifecycle;
- persistence context association;
- transaction integration;
- injection.

## 9.2 Application-managed

Application creates EntityManager from factory:

```java
EntityManagerFactory emf = ...;
EntityManager em = emf.createEntityManager();
```

Application manages:

- open/close;
- lifecycle;
- transaction if resource-local;
- error cleanup.

## 9.3 Jakarta EE use

For typical Jakarta EE app, prefer container-managed persistence context.

## 9.4 Java SE use

For command-line, batch standalone, test, or non-container app, use application-managed EntityManager.

## 9.5 Common bug

Application-managed `EntityManager` not closed:

```java
EntityManager em = emf.createEntityManager();
// no close
```

Can leak resources.

## 9.6 Rule

Container-managed:

```text
container owns lifecycle
```

Application-managed:

```text
you own lifecycle
```

---

# 10. Transaction-Scoped vs Extended Persistence Context

## 10.1 Transaction-scoped persistence context

Default for container-managed EntityManager is typically transaction-scoped.

Lifetime corresponds to transaction.

```text
transaction begins
  ↓
persistence context associated
  ↓
business method
  ↓
flush/commit
  ↓
context ends, entities detached
```

## 10.2 Extended persistence context

Extended persistence context can span multiple transactions.

Useful historically in stateful conversational workflows.

## 10.3 Modern caution

Extended persistence context can cause:

- stale data;
- memory growth;
- complex concurrency;
- unclear flush behavior;
- hard-to-debug state.

Use sparingly.

## 10.4 Stateless service guideline

For stateless REST services:

```text
transaction-scoped persistence context is usually better
```

## 10.5 Detached DTO boundary

When request ends, convert managed entity to DTO.

Do not return managed entity graph to UI/API layer and hope context remains.

---

# 11. Transaction Integration dan `@Transactional`

## 11.1 Transaction boundary

Best placed at application service/use case boundary.

```java
@ApplicationScoped
public class ApproveCaseUseCase {

    @PersistenceContext
    EntityManager em;

    @Transactional
    public ApproveCaseResult handle(ApproveCase command) {
        EnforcementCase c = em.find(EnforcementCase.class, command.caseId());
        c.approve(command.actor(), command.reason());
        return ApproveCaseResult.from(c);
    }
}
```

## 11.2 Entity mutation inside transaction

Entity is managed.

Setter/domain method changes are tracked.

No explicit `save` needed for managed entity in many cases.

## 11.3 When to call `persist`

For new entity:

```java
EnforcementCase c = EnforcementCase.open(...);
em.persist(c);
```

## 11.4 When not to call `merge`

Do not use `merge` on managed entity unnecessarily.

Bad:

```java
EnforcementCase c = em.find(...);
c.approve(...);
em.merge(c); // unnecessary
```

## 11.5 Transaction pitfalls

- no transaction active;
- self-invocation bypasses `@Transactional`;
- external HTTP call inside transaction;
- transaction too long;
- lazy loading outside transaction;
- swallowed exception causes commit;
- batch loop in one huge transaction;
- wrong rollback rules.

## 11.6 External calls inside transaction

Bad:

```java
@Transactional
public void approve(...) {
    c.approve();
    externalClient.notify(...); // slow/uncertain
}
```

Risk:

- transaction holds DB locks while waiting network;
- timeout;
- partial failure;
- retry ambiguity.

Better:

- commit DB state;
- publish outbox event;
- async notification worker.

---

# 12. Dirty Checking dan Flush

## 12.1 Dirty checking

Managed entity changes are detected automatically.

```java
@Transactional
public void rename(UUID id, String name) {
    Customer c = em.find(Customer.class, id);
    c.rename(name);
}
```

No explicit update call required.

At flush:

```sql
update customers set name = ? where id = ?
```

## 12.2 Flush

Flush synchronizes persistence context to DB.

Flush can happen:

- before transaction commit;
- before query execution depending flush mode;
- when `em.flush()` called.

## 12.3 Flush is not commit

Flush sends SQL to DB, but transaction may still rollback.

```text
flush → SQL executed
commit → transaction made durable
rollback → SQL undone
```

## 12.4 Why flush matters

Flush determines when DB constraints are checked.

Example:

```java
em.persist(entityWithDuplicateUniqueKey);
// no error yet
em.flush();
// unique constraint violation here
```

## 12.5 Explicit flush use cases

- fail early before external step;
- force constraint check;
- batch chunk control;
- ensure generated DB values available;
- reduce memory with clear in batch.

## 12.6 Avoid flush everywhere

Calling flush after every change can destroy batching and performance.

## 12.7 Batch loop pattern

```java
for (int i = 0; i < items.size(); i++) {
    em.persist(toEntity(items.get(i)));

    if (i % batchSize == 0) {
        em.flush();
        em.clear();
    }
}
```

## 12.8 Flush mode

JPA has flush mode concepts.

Understand provider/default behavior especially before queries.

---

# 13. ID, Entity Identity, Equality, dan HashCode

Entity equality is tricky.

## 13.1 Database identity

Database identity is primary key.

```java
@Id
private UUID id;
```

## 13.2 Java object identity

Java identity:

```java
a == b
```

Within same persistence context, same row usually same instance.

Across contexts, same row can be different object instances.

## 13.3 equals/hashCode challenge

If ID generated by database after persist, entity has no ID before persist.

Bad equality can break `Set`.

## 13.4 UUID assigned ID

For domain-driven design, assigned UUID at creation can simplify identity.

```java
public EnforcementCase(UUID id, ...) {
    this.id = id;
}
```

## 13.5 Equality strategy

Common approaches:

1. use immutable assigned business/technical ID;
2. use database ID only after assigned with care;
3. avoid putting mutable/transient entities in hash-based collections;
4. use business key only if truly immutable and unique.

## 13.6 Dangerous business key

```java
caseNumber
```

If it can change, do not use as hashCode basis.

## 13.7 Top-tier rule

> Entity identity is not just Java equality. It is a contract across persistence context, database, and collections.

---

# 14. Basic Mapping: `@Entity`, `@Table`, `@Column`, `@Id`

## 14.1 Entity

```java
@Entity
@Table(name = "cases")
public class EnforcementCase {
    @Id
    @Column(name = "id", nullable = false)
    private UUID id;
}
```

## 14.2 Table

`@Table` maps entity to database table.

```java
@Table(name = "cases", schema = "enforcement")
```

Be careful with schema portability.

## 14.3 Column

```java
@Column(name = "case_number", nullable = false, length = 50, unique = true)
private String caseNumber;
```

Annotation metadata can help schema generation, but production schema should usually be managed by migration tool.

## 14.4 Access type

JPA can use field or property access.

If annotation is on field:

```java
@Id
private UUID id;
```

field access.

If annotation is on getter:

```java
@Id
public UUID getId() { ... }
```

property access.

Do not mix unintentionally.

## 14.5 No-arg constructor

Entities generally need no-arg constructor for provider.

Use protected constructor:

```java
protected EnforcementCase() {
    // for JPA
}
```

## 14.6 Encapsulation

Avoid public setters for everything if domain invariants matter.

Bad:

```java
case.setStatus(APPROVED);
```

Better:

```java
case.approve(actor, reason, now);
```

## 14.7 Entity should protect invariants

```java
public void approve(Actor actor, String reason, Instant now) {
    if (status != CaseStatus.PENDING_REVIEW) {
        throw new InvalidCaseStateException(...);
    }
    this.status = CaseStatus.APPROVED;
    this.approvedBy = actor.id();
    this.approvedAt = now;
}
```

---

# 15. Embeddable dan Value Object

## 15.1 Embeddable

Embeddable maps value object into owning entity table.

```java
@Embeddable
public class Address {
    private String line1;
    private String postalCode;
}
```

Use:

```java
@Embedded
private Address address;
```

## 15.2 Value object semantics

Embeddable usually has no identity of its own.

It is part of owner.

```text
Case has CaseReference
CaseReference is not independent entity
```

## 15.3 Good embeddable candidates

- Address;
- Money;
- CaseNumber;
- DateRange;
- PersonName;
- GeoCoordinate;
- ContactInfo;
- AuditActor.

## 15.4 Attribute override

If embedding same type multiple times:

```java
@AttributeOverrides({
    @AttributeOverride(name = "line1", column = @Column(name = "billing_line1"))
})
private Address billingAddress;
```

## 15.5 Avoid over-entity modeling

Not every concept needs separate table/entity.

If lifecycle is owned by parent and no independent identity, embeddable may be better.

## 15.6 Immutable embeddable

Prefer immutable value objects where provider supports practical mapping.

---

# 16. Java Record sebagai Embeddable

Jakarta Persistence 3.2 adds support for Java record types as embeddable classes.

## 16.1 Why records are attractive

Records are concise immutable data carriers:

```java
@Embeddable
public record Money(BigDecimal amount, String currency) {}
```

## 16.2 Good use case

Value objects:

- Money;
- CaseNumber;
- DateRange;
- Coordinates;
- Measurement;
- PersonName.

## 16.3 Caution

Records are not a universal replacement for entities.

Entities need:

- identity;
- lifecycle;
- mutation under persistence context;
- lazy/proxy support;
- provider instantiation rules.

Record as entity is generally not the same as record as embeddable.

## 16.4 Design guideline

Use records for immutable value objects/DTOs/embeddables where supported.

Use normal classes for aggregate roots/entities with lifecycle/invariants.

---

# 17. Relationship Mapping: One-to-One, Many-to-One, One-to-Many, Many-to-Many

Relationship mapping is where many JPA projects go wrong.

## 17.1 Many-to-One

Most common and usually simplest.

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "case_id", nullable = false)
private EnforcementCase enforcementCase;
```

Many child rows reference one parent.

## 17.2 One-to-Many

```java
@OneToMany(mappedBy = "enforcementCase", cascade = CascadeType.ALL, orphanRemoval = true)
private List<CaseDocument> documents = new ArrayList<>();
```

Parent has collection of children.

## 17.3 One-to-One

```java
@OneToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "profile_id")
private Profile profile;
```

Use carefully. Often one-to-one can be same table/embeddable depending lifecycle.

## 17.4 Many-to-Many

```java
@ManyToMany
@JoinTable(
    name = "case_tags",
    joinColumns = @JoinColumn(name = "case_id"),
    inverseJoinColumns = @JoinColumn(name = "tag_id")
)
private Set<Tag> tags = new HashSet<>();
```

Many-to-many is often oversimplified.

If join table has attributes, model it as entity.

Example:

```text
case_user_assignment
  case_id
  user_id
  assigned_at
  assigned_by
  role
```

This is not pure many-to-many. It is an assignment entity.

## 17.5 Relationship direction

Unidirectional may be simpler.

Bidirectional requires helper methods to keep both sides consistent.

## 17.6 Helper methods

```java
public void addDocument(CaseDocument document) {
    documents.add(document);
    document.setCase(this);
}

public void removeDocument(CaseDocument document) {
    documents.remove(document);
    document.setCase(null);
}
```

## 17.7 Relationship design questions

- Who owns lifecycle?
- Is child meaningful without parent?
- Is relationship navigated in both directions?
- Is collection size bounded?
- Does relationship need ordering?
- Does join table have attributes?
- What is fetch strategy?
- What is cascade behavior?

---

# 18. Owning Side, Inverse Side, dan Join Column

## 18.1 Owning side

Owning side controls database relationship update.

Usually side with foreign key.

Example:

```java
@ManyToOne
@JoinColumn(name = "case_id")
private EnforcementCase enforcementCase;
```

`CaseDocument` owns relationship via `case_id` column.

## 18.2 Inverse side

Inverse side uses `mappedBy`.

```java
@OneToMany(mappedBy = "enforcementCase")
private List<CaseDocument> documents;
```

This says:

```text
relationship is mapped by enforcementCase field in CaseDocument
```

## 18.3 Common bug

Only updating inverse side:

```java
case.getDocuments().add(document);
```

but not setting:

```java
document.setCase(case);
```

DB foreign key may not update.

## 18.4 Helper method solves consistency

```java
case.addDocument(document);
```

updates both sides.

## 18.5 Unidirectional relationship

Can avoid bidirectional sync complexity.

But query/navigation trade-off differs.

## 18.6 Rule

> In bidirectional relationship, object graph consistency is your responsibility.

---

# 19. Cascade dan Orphan Removal

## 19.1 Cascade

Cascade propagates entity manager operation from parent to child.

Example:

```java
@OneToMany(mappedBy = "case", cascade = CascadeType.ALL)
private List<CaseDocument> documents;
```

If parent persisted, children persisted.

## 19.2 Cascade types

Common:

- `PERSIST`;
- `MERGE`;
- `REMOVE`;
- `REFRESH`;
- `DETACH`;
- `ALL`.

## 19.3 Orphan removal

```java
orphanRemoval = true
```

If child removed from parent collection, child row deleted.

## 19.4 Good use case

Aggregate composition:

```text
Case owns CaseDocumentMetadata
Case owns CaseChecklistItem
```

If child cannot exist without parent, cascade/orphan removal may make sense.

## 19.5 Dangerous cascade remove

Do not cascade remove across shared references.

Bad:

```text
Case -> Officer with CascadeType.REMOVE
```

Deleting case could delete officer.

## 19.6 Many-to-many cascade caution

Cascade remove on many-to-many can be disastrous.

## 19.7 Rule

> Cascade only across ownership/lifecycle boundary, not arbitrary navigation boundary.

---

# 20. Fetch Strategy: Lazy vs Eager

## 20.1 Lazy

Lazy means related data loaded when accessed.

Pros:

- avoids loading unused graph;
- good for large relationships;
- flexible.

Cons:

- N+1 query;
- lazy loading outside context;
- hidden queries;
- serialization traps.

## 20.2 Eager

Eager means loaded immediately.

Pros:

- fewer lazy errors;
- explicit availability.

Cons:

- over-fetching;
- huge joins;
- cartesian explosion;
- unpredictable performance;
- hard to override.

## 20.3 Default fetch trap

Some relationships default eager in JPA.

Many-to-one and one-to-one default eager historically.

Production guidance often prefers explicitly setting lazy where supported:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

## 20.4 N+1 example

```java
List<CaseDocument> docs = query.getResultList();
for (CaseDocument doc : docs) {
    System.out.println(doc.getCase().getCaseNumber());
}
```

Could execute:

```text
1 query for docs
N queries for cases
```

## 20.5 Fixes

- fetch join;
- entity graph;
- DTO projection;
- batch fetching provider feature;
- query redesign;
- avoid looping lazy relation.

## 20.6 API response warning

Do not directly serialize entity graph.

It can trigger lazy loading recursively and leak internal schema.

Use DTO/projection.

---

# 21. JPQL dan TypedQuery

## 21.1 JPQL is entity-oriented

JPQL queries entity model, not table names.

```java
TypedQuery<EnforcementCase> q = em.createQuery(
    "select c from EnforcementCase c where c.status = :status",
    EnforcementCase.class
);
q.setParameter("status", CaseStatus.OPEN);
List<EnforcementCase> result = q.getResultList();
```

## 21.2 Entity name, not table name

Use:

```text
EnforcementCase
```

not:

```text
cases
```

unless entity name changed.

## 21.3 TypedQuery

Prefer `TypedQuery<T>` over raw `Query`.

```java
TypedQuery<CaseSummary> q = ...;
```

## 21.4 Constructor expression

DTO projection:

```java
select new com.example.CaseSummary(c.id, c.caseNumber, c.status)
from EnforcementCase c
```

## 21.5 Parameters

Use parameters, not string concatenation.

Bad:

```java
"where c.caseNumber = '" + input + "'"
```

Good:

```java
where c.caseNumber = :caseNumber
```

## 21.6 Pagination

```java
query.setFirstResult(offset);
query.setMaxResults(limit);
```

For large data, prefer keyset pagination where possible.

## 21.7 Jakarta Persistence 3.2 query improvements

3.2 adds set operations/functions that make JPQL more expressive.

Still, for complex reporting, SQL/native query/read model may be better.

---

# 22. Criteria API

Criteria API builds queries programmatically.

## 22.1 Basic example

```java
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery<EnforcementCase> cq = cb.createQuery(EnforcementCase.class);
Root<EnforcementCase> root = cq.from(EnforcementCase.class);

cq.select(root)
  .where(cb.equal(root.get("status"), CaseStatus.OPEN));

List<EnforcementCase> cases = em.createQuery(cq).getResultList();
```

## 22.2 When useful

- dynamic filters;
- type-safe-ish query construction;
- reusable predicates;
- query builders;
- admin search screens.

## 22.3 Downsides

- verbose;
- harder to read than JPQL;
- string field names unless metamodel used;
- complex joins become noisy.

## 22.4 Alternative

For complex search, consider:

- Criteria API;
- Specification pattern;
- QueryDSL-like library;
- provider extension;
- native SQL;
- dedicated search engine/read model.

## 22.5 Top-tier rule

Use the query tool that makes the query most correct and maintainable.

Do not force Criteria API for every query.

---

# 23. Native Query dan Stored Procedure

## 23.1 Native query

```java
Query q = em.createNativeQuery(
    "select * from cases where status = ?",
    EnforcementCase.class
);
```

## 23.2 When useful

- database-specific feature;
- complex reporting;
- performance-critical query;
- CTE/window functions;
- full-text search;
- bulk operations;
- vendor-specific hints.

## 23.3 Risk

- portability lower;
- mapping manual;
- SQL injection risk if concatenated;
- schema coupling;
- provider differences.

## 23.4 Stored procedure

JPA supports stored procedure query API.

Use when:

- DB owns business logic legacy;
- batch/reporting routines;
- enterprise integration;
- performance tuned DB procedure.

## 23.5 Design principle

Native query is not failure. It is an explicit trade-off.

Document why standard JPQL/Criteria is insufficient.

---

# 24. Converters dan Custom Type Mapping

## 24.1 AttributeConverter

Converts entity attribute to database column type.

```java
@Converter(autoApply = true)
public class CaseNumberConverter implements AttributeConverter<CaseNumber, String> {
    @Override
    public String convertToDatabaseColumn(CaseNumber attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public CaseNumber convertToEntityAttribute(String dbData) {
        return dbData == null ? null : new CaseNumber(dbData);
    }
}
```

## 24.2 Good use cases

- value object wrapper;
- strongly typed ID;
- encrypted column abstraction;
- enum custom code;
- JSON string column mapping for simple use;
- domain-specific primitive replacement.

## 24.3 Avoid heavy converter

Converters run often.

Avoid:

- remote calls;
- database queries;
- heavy parsing;
- non-deterministic behavior;
- context-dependent logic.

## 24.4 Auto apply caution

`autoApply = true` applies widely.

Good for type-specific value object.

Dangerous for common type like `String`.

## 24.5 Converter and query

Understand how converted values behave in JPQL parameters and predicates.

Test.

---

# 25. Enum Mapping dan `@EnumeratedValue`

## 25.1 Old options

```java
@Enumerated(EnumType.STRING)
private CaseStatus status;
```

or:

```java
@Enumerated(EnumType.ORDINAL)
```

## 25.2 Avoid ordinal

Ordinal is fragile.

If enum order changes, database meaning changes.

Bad:

```java
PENDING = 0
APPROVED = 1
REJECTED = 2
```

Insert new enum in middle and old data breaks.

## 25.3 Prefer string or explicit code

String:

```java
PENDING_REVIEW
APPROVED
REJECTED
```

Explicit code with converter or Jakarta Persistence 3.2 `@EnumeratedValue` can be useful.

## 25.4 `@EnumeratedValue`

Jakarta Persistence 3.2 introduces `@EnumeratedValue` to customize mapping between enum values and database encodings.

Example concept:

```java
public enum CaseStatus {
    OPEN("O"), CLOSED("C");

    @EnumeratedValue
    private final String dbCode;

    CaseStatus(String dbCode) {
        this.dbCode = dbCode;
    }
}
```

Check provider support and test.

## 25.5 Production rule

Enum mapping is data contract.

Treat changes like schema migration.

---

# 26. Date/Time Mapping

## 26.1 Prefer `java.time`

Use modern Java time types:

- `Instant` for machine timestamp;
- `LocalDate` for date without time zone;
- `LocalDateTime` carefully;
- `OffsetDateTime` when offset matters;
- `Year` supported in Jakarta Persistence 3.2;
- avoid legacy `Date`/`Calendar` unless needed.

## 26.2 Instant

Good for audit timestamp:

```java
private Instant createdAt;
```

## 26.3 LocalDate

Good for birth date, due date, license expiry date if business date not instant.

## 26.4 Timezone rule

Be explicit:

```text
Instant for events.
LocalDate for business dates.
Do not store ambiguous local timestamp unless business requires it.
```

## 26.5 DB column type

Know how provider maps Java type to DB type.

Test precision/time zone behavior.

## 26.6 Production bug

Deadline stored as `LocalDateTime` in server timezone can shift meaning across environments.

Use explicit model.

---

# 27. Optimistic Locking dan `@Version`

## 27.1 Purpose

Optimistic locking prevents lost update.

```java
@Version
private long version;
```

Update SQL includes version check:

```sql
update cases
set status = ?, version = version + 1
where id = ? and version = ?
```

If no row updated, someone else modified it.

## 27.2 Use case

Two users open same case.

User A approves.

User B rejects based on stale state.

`@Version` detects conflict.

## 27.3 Handling conflict

Catch optimistic lock exception and return proper error.

Possible API response:

```text
409 Conflict
```

with message:

```text
Case was modified by another transaction. Please reload.
```

## 27.4 Version as domain signal

Version can be useful for:

- concurrency control;
- event ordering;
- read model update guard;
- conditional update.

## 27.5 Force increment

Sometimes you need to increment version even if no field changed.

Use lock mode carefully.

## 27.6 Rule

Every aggregate root that can be concurrently modified should seriously consider `@Version`.

---

# 28. Pessimistic Locking

## 28.1 Purpose

Pessimistic locking obtains database lock to prevent concurrent modification.

```java
em.find(EnforcementCase.class, id, LockModeType.PESSIMISTIC_WRITE);
```

## 28.2 Use cases

- high-contention updates;
- sequence allocation;
- limited resource booking;
- financial balance update;
- workflow transition where optimistic retry too costly.

## 28.3 Risks

- lock waits;
- deadlocks;
- reduced throughput;
- transaction timeout;
- DB-specific behavior;
- operational incidents under load.

## 28.4 Keep transaction short

Never hold pessimistic lock while calling external service.

## 28.5 Timeout

Configure lock timeout where possible.

## 28.6 Rule

Use optimistic locking by default for many business workflows. Use pessimistic locking only when contention/consistency requirement justifies it.

---

# 29. Inheritance Mapping

JPA supports inheritance mapping strategies.

## 29.1 Single table

All subclasses in one table with discriminator.

Pros:

- simple query;
- no joins;
- good performance.

Cons:

- many nullable columns;
- weak constraints for subtype-specific fields.

## 29.2 Joined

Base table plus subclass table.

Pros:

- normalized;
- subtype fields separate.

Cons:

- joins;
- more complex queries.

## 29.3 Table per class

Separate table per concrete class.

Pros/cons depend heavily on query needs.

## 29.4 Use inheritance carefully

Database inheritance mapping often becomes painful.

Consider composition instead.

## 29.5 Domain polymorphism vs persistence polymorphism

Domain may have polymorphism, but persistence model might not need inheritance.

Example:

```text
PaymentMethod entity with type + embedded details
```

may be simpler than class hierarchy.

---

# 30. Validation, Constraint, dan Database Constraint

## 30.1 Bean Validation

Entity can have validation annotations:

```java
@NotBlank
@Column(nullable = false)
private String caseNumber;
```

## 30.2 Application validation vs DB constraint

Application validation improves error messages.

DB constraints guarantee integrity.

Use both where appropriate.

## 30.3 Do not rely only on validation

Concurrent writes can bypass application-level assumptions.

Unique constraint must exist in DB.

## 30.4 Constraint naming

Name constraints in migration scripts for readable errors.

## 30.5 Validation groups

Can be useful, but overuse makes model hard to reason.

## 30.6 Entity validation caution

Not all business rules belong as annotation.

Complex rule should be explicit method/domain policy.

---

# 31. Domain Model vs Persistence Model

## 31.1 Same class approach

Entity class is also domain model.

Pros:

- less mapping;
- simpler CRUD;
- direct dirty checking;
- fewer objects.

Cons:

- persistence annotations in domain;
- lazy loading leaks into domain;
- provider constraints affect design;
- hard to keep pure model.

## 31.2 Separate model approach

Domain model separate from persistence entity.

Pros:

- pure domain;
- persistence independent;
- easier test;
- explicit mapping.

Cons:

- more code;
- mapping overhead;
- identity sync complexity;
- possible duplication.

## 31.3 Pragmatic approach

For many enterprise systems:

- aggregate root can be JPA entity if discipline strong;
- use DTO for API;
- avoid exposing entity outside application boundary;
- keep domain methods on entity;
- avoid anemic setters;
- isolate provider-specific features.

## 31.4 When separate is better

- complex domain;
- multiple persistence stores;
- event-sourced model;
- external schema not aligned;
- legacy DB with ugly schema;
- high testability/purity requirement.

## 31.5 Top-tier principle

> Do not blindly choose pure domain or JPA entity domain. Choose based on complexity, team skill, schema control, and lifecycle risk.

---

# 32. Repository Pattern dan Transaction Boundary

## 32.1 Repository interface

```java
public interface CaseRepository {
    Optional<EnforcementCase> findById(CaseId id);
    void add(EnforcementCase c);
}
```

## 32.2 JPA implementation

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {

    @PersistenceContext
    EntityManager em;

    @Override
    public Optional<EnforcementCase> findById(CaseId id) {
        return Optional.ofNullable(em.find(EnforcementCase.class, id.value()));
    }

    @Override
    public void add(EnforcementCase c) {
        em.persist(c);
    }
}
```

## 32.3 Transaction in use case

```java
@Transactional
public ApproveCaseResult handle(ApproveCase command) {
    EnforcementCase c = repository.findById(command.caseId())
        .orElseThrow(...);
    c.approve(...);
    return ...;
}
```

## 32.4 Repository should not commit

Avoid transaction commit inside repository.

Repository should be persistence abstraction, not transaction orchestrator.

## 32.5 Save method debate

In JPA, managed entity changes auto-flush.

`repository.save(entity)` can be misleading if entity is managed.

Use:

- `add` for new aggregate;
- `find` returns managed aggregate in transaction;
- no-op `save` may be avoided;
- explicit `remove`.

## 32.6 Query repository

Separate command repository from query/read repository if needed.

For read-heavy projections, DTO queries/read model may be better than entity graph.

---

# 33. Provider Boundary: Standard JPA vs Hibernate/EclipseLink Extension

## 33.1 Standard JPA

Portable:

```java
jakarta.persistence.EntityManager
jakarta.persistence.Query
jakarta.persistence.Entity
```

## 33.2 Provider extensions

Examples:

- Hibernate-specific annotations;
- EclipseLink-specific features;
- batch fetching;
- second-level cache config;
- query hints;
- custom types;
- filters;
- soft delete annotations;
- multi-tenancy;
- bytecode enhancement.

## 33.3 Extension is not evil

Provider extension can be valuable.

But document:

- why needed;
- portability impact;
- alternative;
- test coverage;
- migration risk.

## 33.4 Avoid accidental lock-in

Bad:

```java
Provider-specific annotations spread everywhere without ADR.
```

Better:

```text
Use provider extension only in infrastructure layer or explicitly accepted entity mapping.
```

## 33.5 Test generated SQL

Provider behavior matters. Test SQL/performance on actual provider and database.

---

# 34. Performance Engineering

## 34.1 N+1 query

Most common ORM performance bug.

Detect via SQL logs/metrics.

Fix via:

- fetch join;
- entity graph;
- DTO projection;
- batch fetching;
- query redesign.

## 34.2 Over-fetching

Loading huge entity graph for small API response.

Fix with projection.

## 34.3 Under-fetching

Lazy load one-by-one in loop.

Fix query.

## 34.4 Large persistence context

Batch processing with thousands of managed entities causes memory growth.

Use flush/clear chunks.

## 34.5 Bulk operations

JPQL bulk update/delete bypass persistence context state.

After bulk operation, clear/refresh may be needed.

## 34.6 Pagination

Offset pagination can be slow for deep pages.

Consider keyset pagination.

## 34.7 Count query

Pagination count can be expensive.

Optimize separately.

## 34.8 Index design

JPA query performance depends on database indexes.

Always review query plan.

## 34.9 SQL logging in production

Do not enable full SQL parameter logging in production unless controlled.

It can leak PII and hurt performance.

## 34.10 Metrics

Track:

- query count/request;
- slow query;
- connection pool active/wait;
- transaction duration;
- optimistic lock failures;
- deadlocks;
- entity load count;
- second-level cache hit/miss if used.

---

# 35. Common Failure Modes

## 35.1 `LazyInitializationException` / lazy load outside context

Cause:

- entity detached;
- persistence context closed;
- serialization accesses lazy relation.

Fix:

- DTO projection;
- fetch join;
- transaction boundary;
- avoid entity serialization.

## 35.2 N+1 query

Cause:

- looping lazy relation.

Fix:

- fetch join/projection/batch.

## 35.3 Detached entity passed to persist

Cause:

- using `persist` on detached object.

Fix:

- find managed entity;
- use merge carefully;
- design DTO boundary.

## 35.4 `No Persistence provider`

Cause:

- API jar only;
- provider missing;
- persistence.xml not found;
- wrong classpath.

## 35.5 Transaction required

Cause:

- write outside transaction.

Fix:

- add proper transaction boundary.

## 35.6 Constraint violation at commit

Cause:

- DB constraint checked on flush/commit.

Fix:

- validate earlier;
- flush intentionally;
- handle exception; 
- maintain DB constraints.

## 35.7 Optimistic lock exception

Cause:

- concurrent update conflict.

Fix:

- return 409;
- retry if safe;
- reload;
- user conflict flow.

## 35.8 Deadlock/lock timeout

Cause:

- inconsistent update order;
- long transaction;
- pessimistic lock;
- missing index.

Fix:

- shorten transaction;
- consistent lock order;
- tune query/index;
- retry safe transaction.

## 35.9 Wrong cascade delete

Cause:

- cascade remove across shared entity.

Fix:

- remove cascade;
- model ownership correctly.

## 35.10 Entity equality bug

Cause:

- mutable business key in `hashCode`;
- generated ID before assigned;
- detached/managed identity confusion.

---

# 36. Testing Strategy

## 36.1 Unit tests

Domain methods can be tested without JPA if model allows.

```java
case.approve(actor, reason, now);
assertThat(case.status()).isEqualTo(APPROVED);
```

## 36.2 Repository integration tests

Use real database via Testcontainers or equivalent.

Test:

- mapping;
- constraints;
- queries;
- transaction;
- locking;
- cascade;
- orphan removal;
- migration scripts.

## 36.3 Avoid only H2 if production DB differs

H2 is not PostgreSQL/Oracle/MySQL.

Dialect differences matter.

## 36.4 SQL assertion

For critical query, assert:

- result correctness;
- query count;
- no N+1;
- execution plan if possible.

## 36.5 Concurrency tests

Test optimistic lock:

```text
transaction A loads version 1
transaction B updates to version 2
transaction A tries update
expect optimistic lock exception
```

## 36.6 Migration tests

Schema migration must be tested with real DB.

## 36.7 Test data builder

Use builders to create valid aggregate/entity state.

Avoid random invalid object graph.

---

# 37. Production Checklist

## 37.1 Mapping

- [ ] Entity has clear identity.
- [ ] Access type consistent.
- [ ] No public setters that break invariants unless intentionally anemic.
- [ ] Relationships have clear ownership.
- [ ] Cascade only across lifecycle ownership.
- [ ] Fetch strategy explicit.
- [ ] Enum mapping stable.
- [ ] Time mapping explicit.

## 37.2 Transaction

- [ ] Transaction boundary at use case level.
- [ ] No slow external calls inside transaction.
- [ ] Timeout configured.
- [ ] Rollback rules understood.
- [ ] Optimistic locking for concurrent aggregate.

## 37.3 Query

- [ ] Query uses parameters.
- [ ] N+1 tested.
- [ ] Pagination strategy chosen.
- [ ] Indexes support queries.
- [ ] DTO projection used for read API where appropriate.

## 37.4 Performance

- [ ] SQL logging available in lower env.
- [ ] Slow query monitoring.
- [ ] Connection pool metrics.
- [ ] Transaction duration metrics.
- [ ] Batch uses flush/clear.

## 37.5 Provider

- [ ] Standard vs provider extension documented.
- [ ] Runtime/provider version aligned.
- [ ] Dialect correct.
- [ ] Generated SQL reviewed for critical paths.

## 37.6 Testing

- [ ] Repository tests with real DB.
- [ ] Locking tests.
- [ ] Cascade/orphan tests.
- [ ] Migration tests.
- [ ] Query count tests for hot endpoints.

---

# 38. Latihan Bertahap

## Latihan 1 — Entity lifecycle

Buat entity `EnforcementCase`.

Amati state:

- new;
- managed after persist;
- detached after clear;
- removed after remove.

Gunakan `em.contains(entity)`.

## Latihan 2 — Dirty checking

Load entity, ubah field, jangan panggil merge/save.

Commit transaction.

Buktikan SQL update terjadi.

## Latihan 3 — Merge confusion

Detach entity, modify, call merge, modify detached again.

Amati perubahan mana yang tersimpan.

## Latihan 4 — N+1

Buat parent-child relation.

Loop lazy relation.

Hitung query.

Fix dengan fetch join/projection.

## Latihan 5 — Cascade/orphan removal

Buat aggregate parent-child.

Remove child dari collection.

Amati delete behavior dengan `orphanRemoval=true`.

## Latihan 6 — Optimistic lock

Simulasikan dua transaction update entity sama.

Expect conflict.

## Latihan 7 — Enum mapping

Bandingkan ordinal vs string vs explicit code.

Tulis migration risk.

## Latihan 8 — Batch flush/clear

Persist 100k rows.

Bandingkan memory dengan/without flush-clear chunk.

## Latihan 9 — DTO projection

Buat endpoint list cases.

Bandingkan entity graph response vs DTO projection.

## Latihan 10 — Provider extension ADR

Pilih satu provider-specific feature.

Tulis ADR: why, risk, mitigation.

---

# 39. Mini Project: Jakarta Persistence Case Management Lab

## 39.1 Goal

Buat project:

```text
jakarta-persistence-case-lab/
```

## 39.2 Domain

Regulatory case management:

```text
Case
  id
  caseNumber
  status
  assignedOfficer
  documents
  checklistItems
  version
  createdAt
  updatedAt
```

## 39.3 Modules

```text
api/
application/
domain/
infrastructure-jpa/
test-support/
docs/
```

## 39.4 Features

- create case;
- assign officer;
- approve/reject case;
- attach document metadata;
- list case summary;
- query by status/officer/date;
- optimistic locking;
- audit fields;
- DTO projection;
- relationship mapping;
- cascade/orphan removal;
- batch import.

## 39.5 Required experiments

1. Entity lifecycle demo.
2. Dirty checking demo.
3. N+1 detection.
4. Fetch join fix.
5. DTO projection.
6. Optimistic lock conflict.
7. Batch flush/clear.
8. Constraint violation handling.
9. Provider extension ADR.
10. Migration script test.

## 39.6 Documentation deliverables

```text
README.md
PERSISTENCE-MODEL.md
ENTITY-LIFECYCLE.md
QUERY-STRATEGY.md
TRANSACTION-BOUNDARY.md
LOCKING-STRATEGY.md
PERFORMANCE-REPORT.md
FAILURE-MODES.md
PROVIDER-EXTENSIONS.md
```

## 39.7 Evaluation questions

1. Which entity is aggregate root?
2. Which relationships own lifecycle?
3. Which fetch strategy is chosen and why?
4. Where is transaction boundary?
5. Which queries use DTO projection?
6. How is optimistic locking surfaced to API?
7. How do you avoid N+1?
8. How do you batch import without memory blowup?
9. Which provider extensions are used?
10. What is standard Jakarta Persistence vs provider-specific?

---

# 40. Referensi Resmi

Referensi utama:

1. Jakarta Persistence 3.2  
   https://jakarta.ee/specifications/persistence/3.2/

2. Jakarta Persistence 3.2 Specification  
   https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2

3. Jakarta Persistence 3.2 API — `EntityManager`  
   https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager

4. Jakarta Persistence Project  
   https://jakarta.ee/specifications/persistence/

5. Jakarta EE Tutorial — Introduction to Jakarta Persistence  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/persist/persistence-intro/persistence-intro.html

6. Jakarta EE Tutorial — Managing Entities  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/persist/persistence-intro/persistence-intro004.html

7. Jakarta EE Tutorial — Running the Persistence Examples  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/persist/persistence-basicexamples/persistence-basicexamples.html

8. Jakarta Persistence 3.2 Release Page — Eclipse Projects  
   https://projects.eclipse.org/projects/ee4j.jpa/releases/3.2

---

# Penutup

Jakarta Persistence adalah salah satu spesifikasi Jakarta yang paling kuat sekaligus paling sering menimbulkan bug production.

Bukan karena JPA buruk, tetapi karena JPA punya mental model yang harus dipahami:

```text
EntityManager manages persistence context.
Persistence context is identity map + unit of work.
Managed entity changes are tracked.
Flush sends SQL.
Commit makes transaction durable.
Detached entity is not automatically tracked.
Relationship ownership matters.
Cascade follows lifecycle ownership.
Lazy loading can hide queries.
Locking is a concurrency contract.
```

Jika kamu hanya hafal annotation, kamu akan membuat aplikasi yang tampak jalan tetapi rapuh.

Jika kamu memahami lifecycle, transaction, query, dan database behavior, JPA menjadi alat yang sangat produktif.

Prinsip utama:

> Treat Jakarta Persistence as a persistence engine with lifecycle, identity, transaction, and query semantics—not as a magic object saver.

Bagian berikutnya akan membahas **Jakarta Data**, yaitu repository abstraction standard di Jakarta EE 11 yang berada di atas persistence/data access layer dan perlu dipahami relasinya dengan JPA, repository pattern, dan Spring Data-style programming.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 11 — Jakarta JSON Binding (`jakarta.json.bind` / JSON-B)](./learn-java-jakarta-part-011.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 13 — Jakarta Data: Repository Abstraction Standar](./learn-java-jakarta-part-013.md)

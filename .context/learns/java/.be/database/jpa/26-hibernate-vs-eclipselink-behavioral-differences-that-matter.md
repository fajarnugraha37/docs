# Part 26 — Hibernate vs EclipseLink: Behavioral Differences That Matter

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `26-hibernate-vs-eclipselink-behavioral-differences-that-matter.md`  
> Scope: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4/5  
> Fokus: perbedaan perilaku provider yang memengaruhi correctness, performance, migration, dan operasional production.

---

## 0. Posisi Bagian Ini Dalam Seri

Bagian sebelumnya sudah membahas dua provider secara terpisah:

- Part 24 membedah arsitektur Hibernate: `SessionFactory`, `Session`, persistence context, action queue, event system, interceptors, filters, dan extension points.
- Part 25 membedah arsitektur EclipseLink: sessions, descriptors, UnitOfWork, weaving, shared cache, fetch groups, batch reading, dan advanced mappings.

Bagian ini bukan mengulang dua part tersebut. Fokusnya adalah **membandingkan behavioral difference yang benar-benar matters** ketika kita:

1. Menulis aplikasi enterprise yang harus stabil lama.
2. Migrasi dari satu provider ke provider lain.
3. Meng-upgrade Java/Jakarta/Hibernate/EclipseLink version.
4. Melakukan performance tuning.
5. Mendiagnosis bug production yang hanya muncul di provider tertentu.
6. Menentukan kapan portability layak dikejar dan kapan provider-specific contract lebih aman.

Di level junior, perbandingan provider sering berhenti di:

> “Keduanya implementasi JPA.”

Di level senior/top-tier, perbandingannya berubah menjadi:

> “JPA memberi kontrak minimum; provider menentukan runtime semantics, SQL shape, lazy mechanism, cache visibility, flush behavior, extension points, diagnostic surface, dan operational risk.”

Itu perbedaan besar.

---

## 1. Core Thesis: Same Annotation Does Not Mean Same Runtime

Dua aplikasi bisa memakai annotation yang sama:

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    @OneToMany(mappedBy = "caseFile", fetch = FetchType.LAZY)
    private List<CaseTask> tasks = new ArrayList<>();
}
```

Tetapi runtime behavior-nya dapat berbeda dalam aspek:

- kapan collection benar-benar di-load,
- bentuk proxy/wrapper yang digunakan,
- kapan perubahan dianggap dirty,
- kapan flush terjadi,
- bagaimana join/fetch SQL dibentuk,
- bagaimana batch fetch dilakukan,
- apakah cache shared provider ikut terlibat,
- bagaimana weaving/enhancement aktif atau tidak,
- apa yang terjadi ketika entity detached lalu di-merge,
- bagaimana optimistic lock checked,
- bagaimana query hint ditafsirkan,
- bagaimana schema DDL dihasilkan,
- bagaimana logging/metrics tersedia.

JPA/Jakarta Persistence specification sengaja tidak mengunci semua detail ini, karena provider perlu ruang untuk optimasi dan database adaptation.

Maka mental model yang benar:

```text
Annotation / JPQL / Entity operation
        |
        v
JPA specification contract
        |
        v
Provider interpretation
        |
        v
Provider runtime machinery
        |
        v
Dialect / database SQL behavior
        |
        v
Observed production behavior
```

Ketika ada masalah production, root cause sering berada di layer “provider interpretation” atau “provider runtime machinery”, bukan di annotation-nya saja.

---

## 2. Version Landscape: Kenapa Perbandingan Harus Selalu Versi-Spesifik

Perbandingan “Hibernate vs EclipseLink” tidak valid tanpa versi.

Contoh:

- Hibernate 5 berbeda cukup besar dari Hibernate 6.
- Hibernate 6 berbeda lagi dari Hibernate 7, terutama karena Hibernate 7 baseline Java 17 dan Jakarta Persistence 3.2.
- EclipseLink 2.x berada di era `javax.persistence`.
- EclipseLink 3.x/4.x/5.x berada di era `jakarta.persistence`.
- Java 8 deployment memiliki constraint berbeda dari Java 17/21/25 deployment.

## 2.1 Practical version map

| Era | Java baseline umum | API namespace | Hibernate line | EclipseLink line | Catatan |
|---|---:|---|---|---|---|
| Legacy enterprise | Java 8 | `javax.persistence` | Hibernate 5.x | EclipseLink 2.x | Masih banyak di app server lama |
| Transition | Java 11/17 | mulai migrasi ke `jakarta.persistence` | Hibernate 5.6/6.x | EclipseLink 3.x | Banyak pain point namespace migration |
| Modern Jakarta | Java 17+ | `jakarta.persistence` | Hibernate 6.x/7.x | EclipseLink 4.x/5.x | Cocok untuk Spring Boot 3+/Jakarta EE 10/11 line |
| Forward-looking | Java 21/25+ | Jakarta Persistence 3.2/4.0 future | Hibernate 7.x/8.x dev | EclipseLink 5.x+ | Harus pisahkan stable vs milestone/dev |

Pada 2026, Jakarta Persistence stabil terbaru adalah 3.2; Jakarta Persistence 4.0 masih under development dengan target late 2026. Hibernate release page menampilkan 7.4 sebagai latest stable dan 8.0 sebagai development line. EclipseLink download page menampilkan EclipseLink 5.0.0 release pada 23 Maret 2026, dan EclipseLink project tetap menempatkan dirinya sebagai persistence solution untuk relational, XML, dan database web services.

Implikasi praktis:

- Untuk production modern, jangan hanya bertanya “Hibernate atau EclipseLink?”
- Tanya versi spesifik:
  - Hibernate 5.6? 6.6? 7.4?
  - EclipseLink 2.7? 3.0? 4.0? 5.0?
  - Java 8? 17? 21? 25?
  - `javax` atau `jakarta`?
  - Spring Boot? Jakarta EE server? Standalone SE?

---

## 3. High-Level Philosophy Difference

## 3.1 Hibernate philosophy

Hibernate historically menjadi provider ORM paling dominan di ekosistem Java, terutama di Spring ecosystem. Karakternya:

- kuat di ORM-centric programming model,
- banyak extension non-JPA,
- HQL lebih ekspresif dari JPQL standar,
- ecosystem luas: Envers, Hibernate Search, Validator integration, Reactive line, tooling,
- dokumentasi dan komunitas besar,
- banyak optimization knob,
- behavior bisa sangat powerful tetapi juga bisa kompleks.

Hibernate cocok ketika:

- aplikasi memakai Spring Boot/Spring Data JPA,
- butuh banyak extension provider,
- tim butuh ecosystem luas,
- perlu diagnostic dan tuning surface besar,
- domain butuh fitur seperti filters, soft delete support, natural id, custom type, event listener, interceptor, statement inspector.

## 3.2 EclipseLink philosophy

EclipseLink berasal dari TopLink heritage dan menjadi reference implementation historis untuk JPA. Karakternya:

- kuat di descriptor/session model,
- weaving/change tracking/fetch group support matang,
- shared cache kuat secara default-oriented,
- advanced mapping luas,
- MOXy/XML binding heritage,
- sering cocok di Jakarta EE/app server environments,
- provider extension cukup kaya tetapi berbeda gaya dari Hibernate.

EclipseLink cocok ketika:

- aplikasi berada di Jakarta EE container yang historically mengintegrasikan EclipseLink,
- tim sudah memahami descriptors, sessions, weaving, shared cache,
- kebutuhan mapping lebih dekat ke enterprise data-source integration,
- butuh fitur EclipseLink-specific seperti fetch groups, descriptor customizer, `@BatchFetch`, `@JoinFetch`, `@PrivateOwned`, `@CascadeOnDelete`, advanced converter/mapping.

## 3.3 Salah framing yang umum

Salah:

```text
Kami pilih provider yang paling JPA compliant supaya aman.
```

Lebih tepat:

```text
Kami pilih provider yang behavior, extension, diagnostics, upgrade path, dan operational model-nya paling cocok dengan sistem kami. Kami tetap menjaga boundary portability untuk bagian yang memang perlu portable.
```

Portability itu target desain, bukan efek otomatis dari memakai annotation standar.

---

## 4. Comparison Matrix: Apa yang Benar-Benar Berbeda

| Area | Hibernate | EclipseLink | Kenapa matters |
|---|---|---|---|
| Internal unit of work | PersistenceContext + ActionQueue | UnitOfWork + descriptors/sessions | Memengaruhi dirty checking, flush, lifecycle |
| Lazy mechanism | Proxy, collection wrapper, bytecode enhancement | Indirection, ValueHolder, weaving, fetch groups | Memengaruhi class behavior, serialization, testing |
| Change tracking | Snapshot-based by default, enhancement optional | Deferred/change tracking policies, weaving-aware | Memengaruhi cost dan correctness mutation |
| Fetch tuning | join fetch, batch size, subselect, profiles, entity graphs | batch fetch, join fetch, fetch groups, indirection | Memengaruhi N+1 dan cartesian explosion |
| Cache | L2 cache opt-in/configurable; query cache explicit | shared cache central concept; often more visible | Memengaruhi stale data dan cluster correctness |
| Query language | HQL superset over JPQL | JPQL + EclipseLink extensions/hints | Memengaruhi portability query |
| SQL generation | dialect-heavy, SQL AST modern line | platform/descriptors/expression framework | Memengaruhi SQL shape dan migration |
| Extension model | events, interceptors, integrators, types, filters | descriptors, customizers, sessions, policies | Memengaruhi custom behavior location |
| Soft delete/filter | strong Hibernate-specific options | extensions/custom descriptors/query filters | Security/data visibility implications |
| Schema tooling | widely used through Spring Boot `ddl-auto` | DDL generation supported but less Spring-centric | Migration discipline differs |
| Ecosystem | huge Spring ecosystem dominance | strong Jakarta EE/reference heritage | Hiring, docs, production examples |
| Migration risk | major shifts 5→6→7 | namespace/platform/weaving/cache concerns | Upgrade plan must be provider-specific |

---

## 5. Difference #1 — Persistence Context vs UnitOfWork Vocabulary

JPA uses `EntityManager` and persistence context vocabulary.

Hibernate exposes `Session` as native API.

EclipseLink exposes session/unit-of-work/descriptor concepts more visibly.

Conceptually both perform unit-of-work behavior:

```text
Load entities
Track identity
Track changes
Order operations
Generate SQL
Flush to database
Coordinate cache
```

But internal mental model differs.

## 5.1 Hibernate mental model

Hibernate typical path:

```text
SessionFactory
   -> Session / EntityManager
       -> PersistenceContext
           -> EntityEntry snapshots
           -> CollectionEntry snapshots
       -> ActionQueue
           -> insert actions
           -> update actions
           -> delete actions
           -> collection actions
```

Hibernate’s action queue is central when reasoning about flush ordering.

When something feels wrong in Hibernate, ask:

- Is the entity managed in this Session?
- What snapshot does Hibernate hold?
- Which action is queued?
- Has flush occurred?
- Did a query trigger auto-flush?
- Did the same persistence context already contain stale state?

## 5.2 EclipseLink mental model

EclipseLink typical path:

```text
ServerSession / Session
   -> ClientSession / UnitOfWork
       -> descriptors
       -> clone/original comparison or change tracking
       -> cache coordination
       -> database platform
```

EclipseLink’s descriptor and UnitOfWork concepts are central.

When something feels wrong in EclipseLink, ask:

- Which descriptor maps this entity?
- Is weaving enabled?
- Which change tracking policy is active?
- Is shared cache serving stale object?
- Is this object clone/original managed by UnitOfWork?
- Are query hints overriding default read/cache behavior?

## 5.3 Practical consequence

Same conceptual bug can have different debugging path.

Example symptom:

> User updates child collection, but database does not change.

Hibernate investigation:

- Is owning side changed?
- Is collection wrapper initialized?
- Did dirty checking detect collection change?
- Is action queued?
- Did flush happen?

EclipseLink investigation:

- Is relationship maintained on owning side?
- Is weaving/change tracking active?
- Is UnitOfWork aware of the relationship mutation?
- Did descriptor mapping treat relationship as privately owned or not?
- Is cache masking reload result?

---

## 6. Difference #2 — Lazy Loading Mechanism

Lazy loading is one of the most provider-sensitive areas.

## 6.1 Hibernate lazy loading

Hibernate commonly uses:

- entity proxies for lazy many-to-one/one-to-one,
- persistent collection wrappers for lazy collections,
- bytecode enhancement for advanced lazy attribute loading and dirty tracking,
- `Hibernate.initialize(...)` and native APIs for explicit handling.

Common Hibernate lazy behavior:

```java
Order order = entityManager.find(Order.class, id);
Customer customer = order.getCustomer(); // may be proxy
String name = customer.getName();         // may trigger SELECT
```

Risks:

- `LazyInitializationException` outside session,
- proxy class surprises in `equals()` or serialization,
- accidental database access from JSON serialization,
- hidden query in view/template layer,
- final class/method interfering with proxying/enhancement patterns.

## 6.2 EclipseLink lazy loading

EclipseLink commonly uses:

- indirection,
- `ValueHolder`-style lazy references,
- weaving to inject lazy behavior,
- fetch groups for partial attribute loading,
- batch and join fetch hints/extensions.

Risks:

- lazy behavior differs depending on weaving availability,
- static/dynamic weaving not active in test but active in app server, or vice versa,
- fetch group partial object surprises,
- shared cache interaction with lazy-loaded attributes,
- serialization of woven/indirection fields.

## 6.3 Same annotation, different failure

```java
@ManyToOne(fetch = FetchType.LAZY)
private Agency agency;
```

With Hibernate:

- likely proxy unless bytecode enhancement or special cases change behavior.
- accessing property outside session tends to produce `LazyInitializationException`.

With EclipseLink:

- lazy many-to-one often depends heavily on weaving/indirection.
- if weaving is not active, behavior can silently become eager or behave differently from expectation depending on configuration/version.

Design rule:

> Treat lazy loading as provider-runtime behavior. Test it with the real provider, real build pipeline, and real execution mode.

Do not assume a unit test with H2 and different enhancement/weaving settings proves production lazy behavior.

---

## 7. Difference #3 — Dirty Checking and Change Tracking

## 7.1 Hibernate default style

Hibernate commonly relies on snapshot comparison:

```text
Entity loaded
   -> snapshot stored
Entity mutated
   -> flush compares current state vs snapshot
   -> dirty properties detected
   -> SQL update generated
```

With bytecode enhancement, Hibernate can optimize dirty tracking by marking changed attributes.

Implications:

- Dirty checking cost scales with managed entities and fields.
- Mutable fields are risky if provider cannot detect internal mutation cleanly.
- Collections have separate tracking via collection wrappers.
- Access strategy mismatch can cause surprising behavior.

## 7.2 EclipseLink style

EclipseLink supports several change tracking approaches, including deferred change detection and weaving-assisted attribute change tracking.

Implications:

- Weaving can materially affect performance and behavior.
- Descriptor-level configuration matters.
- Change tracking policy can differ between environments.
- EclipseLink may avoid some full-snapshot costs when optimized tracking is active.

## 7.3 Practical example: mutable value object

```java
@Embeddable
public class Money {
    private BigDecimal amount;
    private String currency;

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }
}
```

```java
invoice.getTotal().setAmount(new BigDecimal("100.00"));
```

Question:

- Did provider detect mutation inside embeddable?
- Is embeddable snapshot compared deeply?
- Is enhanced tracking active?
- Is object mutable but not replaced?

Portable safer pattern:

```java
invoice.changeTotal(new Money(new BigDecimal("100.00"), "SGD"));
```

Prefer immutable value object replacement for high correctness.

## 7.4 Design rule

> If state mutation must be reliable across providers, prefer explicit entity methods that replace value objects or mutate owning relationship consistently.

Avoid relying on subtle provider detection for deeply mutable object graphs.

---

## 8. Difference #4 — Flush Ordering and SQL Timing

JPA defines flush concept, but provider internals determine exact SQL ordering and timing details within allowed behavior.

## 8.1 Hibernate

Hibernate’s `ActionQueue` makes flush behavior easier to reason about if you know it exists.

At flush, Hibernate coordinates:

- entity inserts,
- entity updates,
- entity deletes,
- collection removals,
- collection updates,
- collection recreations,
- orphan removals,
- cascaded actions.

Flush may happen before query execution under `AUTO` flush mode.

## 8.2 EclipseLink

EclipseLink UnitOfWork calculates changes and commits them through its database session/platform machinery.

The details are descriptor/platform/change-set oriented.

## 8.3 Difference that matters

Imagine this operation:

```java
caseFile.removeTask(oldTask);
caseFile.addTask(newTaskWithSameBusinessKey);

querySomething(); // may trigger flush
```

Potential issues:

- unique constraint violation because insert happens before delete,
- FK violation because child update order differs,
- query sees flushed partial changes earlier than expected,
- provider reorders operations for batching,
- collection table delete/insert strategy differs.

A provider migration can expose bugs that were hidden because previous SQL ordering happened to work.

Design rule:

> Never rely on accidental SQL ordering. If business operation requires replace semantics under unique constraints, design the DB constraint, transaction sequence, and explicit flush points intentionally.

Example explicit sequence:

```java
caseFile.removeTask(oldTask);
entityManager.flush();

caseFile.addTask(newTask);
entityManager.flush();
```

Use explicit flush sparingly, but when constraint sequencing matters, it is better than relying on provider coincidence.

---

## 9. Difference #5 — Association Ownership and Relationship Maintenance

JPA ownership rules are standard, but provider conveniences differ.

The portable invariant remains:

> The owning side controls the database foreign key or join table row.

Example:

```java
@Entity
class CaseFile {
    @OneToMany(mappedBy = "caseFile")
    private List<CaseTask> tasks = new ArrayList<>();
}

@Entity
class CaseTask {
    @ManyToOne
    @JoinColumn(name = "case_file_id")
    private CaseFile caseFile;
}
```

The owning side is `CaseTask.caseFile`.

Wrong:

```java
caseFile.getTasks().add(task);
```

Safer:

```java
caseFile.addTask(task);
```

```java
public void addTask(CaseTask task) {
    tasks.add(task);
    task.setCaseFile(this);
}
```

Hibernate and EclipseLink may differ in how early/late they detect inconsistency, but both require the model to be consistent.

Design rule:

> Maintain bidirectional relationships inside aggregate methods. Never let application service manipulate both sides casually.

---

## 10. Difference #6 — Collection Semantics

Collection behavior is one of the most non-portable areas in practice.

## 10.1 Hibernate bag/list/set behavior

Hibernate has a strong internal distinction between:

- bag,
- id bag,
- list,
- set,
- map,
- ordered collection,
- sorted collection.

A Java `List` without order column can behave like a bag.

This matters for:

- duplicate handling,
- delete/reinsert strategy,
- multiple bag fetch restrictions,
- collection dirty checking,
- row explosion under fetch join.

## 10.2 EclipseLink collection behavior

EclipseLink maps collections through descriptors/indirection and provides extensions like batch fetching/join fetching, privately owned relationships, and ordering features.

The exact behavior differs in how collection change sets are calculated and how indirection/weaving interacts with mutation.

## 10.3 Provider portability trap

```java
@OneToMany(mappedBy = "caseFile")
private List<CaseTask> tasks;

@OneToMany(mappedBy = "caseFile")
private List<CaseNote> notes;
```

Hibernate may complain or perform badly when fetching multiple bag-like collections together.

EclipseLink may allow a different query shape but still can create row multiplication.

The database problem is universal:

```text
CaseFile x tasks x notes
```

If one case has 20 tasks and 30 notes, join fetching both can produce 600 rows for one aggregate root.

Design rule:

> Do not model large child collections as always-fetchable object graph fields. Design query-specific read models and fetch plans.

---

## 11. Difference #7 — Query Language and Query Interpretation

## 11.1 JPQL portability

JPQL is the portable baseline.

```java
select c
from CaseFile c
where c.status = :status
order by c.createdAt desc
```

This should be portable in concept.

But differences appear in:

- generated joins,
- implicit join behavior,
- function support,
- pagination SQL,
- parameter type inference,
- enum handling,
- temporal precision,
- null comparison,
- distinct handling with fetch join,
- query hint support.

## 11.2 Hibernate HQL

Hibernate HQL is a superset and may support features beyond JPQL.

Useful, but less portable.

Examples of Hibernate-specific thinking:

- advanced functions,
- filters,
- soft delete integration,
- query features in newer Hibernate lines,
- native type handling,
- tuple/list transformations depending on version.

## 11.3 EclipseLink JPQL extensions and hints

EclipseLink also has provider-specific query features and hints.

Examples:

- batch fetch hints,
- join fetch hints,
- cache usage hints,
- fetch group hints,
- query redirectors/customization.

## 11.4 Design rule

Separate queries into three categories:

```text
1. Portable core JPQL
   - simple domain queries
   - low provider dependency

2. Provider-tuned JPQL/HQL/hints
   - performance-sensitive queries
   - documented provider dependency

3. Native/read-model SQL
   - reporting/search/listing/export
   - explicit SQL ownership
```

Do not pretend category 2 or 3 is portable.

Document it.

---

## 12. Difference #8 — Entity Graphs, Fetch Profiles, Fetch Groups

## 12.1 JPA entity graph

Entity graph is standardized.

```java
@EntityGraph(attributePaths = {"applicant", "currentTask"})
```

But provider behavior still differs around:

- graph merging with default fetch annotations,
- subgraph handling,
- collection loading,
- pagination interaction,
- SQL join strategy,
- cache interaction.

## 12.2 Hibernate fetch profiles

Hibernate has fetch profiles and provider-specific fetch tuning.

Useful when you want named provider-level fetch behavior.

## 12.3 EclipseLink fetch groups

EclipseLink fetch groups can partially load attributes and are stronger/different than simple entity graphs.

This can be powerful but introduces partial object risk.

## 12.4 Partial object risk

When only part of an entity is loaded:

```text
Loaded: id, status, createdAt
Not loaded: largeDescription, internalNotes, metadata
```

Questions:

- What happens when an unloaded property is accessed?
- Does it lazy load?
- Does it return null?
- Does serialization trigger DB access?
- Does merge overwrite unloaded attributes?
- Does cache store partial or full object?

Design rule:

> Use partial entity loading only when the team deeply understands provider semantics. For API/listing/reporting, DTO projection is often safer.

---

## 13. Difference #9 — Caching Defaults and Correctness Model

## 13.1 Hibernate cache model

Hibernate first-level cache is always there per persistence context.

Second-level cache is provider-integrated but typically configured explicitly by region and strategy.

Query cache is separate and must be used carefully.

Natural ID cache is Hibernate-specific strength.

Mental model:

```text
L1 cache: mandatory, transactional context
L2 cache: optional shared entity/collection cache
Query cache: caches identifiers/results, not magic full query truth
Natural ID cache: maps natural key to primary key
```

## 13.2 EclipseLink shared cache model

EclipseLink has a strong shared cache concept. Depending on configuration and environment, shared cache can be more central/visible.

Mental model:

```text
Session cache / shared cache
   -> can serve objects across units of work
   -> cache isolation and invalidation matter deeply
```

## 13.3 Difference that matters

If an external system updates the database directly:

```text
Application A using ORM cache
Application B updates same table directly
Application A reads again
```

Questions differ:

- Does provider hit cache first?
- Does query bypass cache?
- Is cache invalidated?
- Is refresh needed?
- Is cache coordination configured?
- Does transaction isolation hide or reveal new value?

## 13.4 Design rule

> In systems where database can be updated outside the current JVM/provider, default shared cache assumptions must be treated as unsafe until proven.

Safer options:

- disable shared cache for volatile entities,
- use cache only for reference data,
- define explicit TTL/invalidation,
- call `refresh()` only in narrow cases,
- avoid query cache for frequently changing data,
- isolate tenant-specific cache regions.

---

## 14. Difference #10 — Locking Behavior

JPA lock modes are standard, but provider/database interaction differs.

## 14.1 Optimistic locking

Standard:

```java
@Version
private long version;
```

Hibernate and EclipseLink both support optimistic locking, but differences can appear in:

- when version increments,
- forced increment behavior,
- relationship-change versioning,
- excluded fields/provider extensions,
- bulk update bypass,
- merge of detached stale graph.

## 14.2 Pessimistic locking

Standard lock modes include:

- `PESSIMISTIC_READ`,
- `PESSIMISTIC_WRITE`,
- `PESSIMISTIC_FORCE_INCREMENT`.

Generated SQL may differ by provider and dialect/platform:

```sql
select ... for update
```

or database-specific variants.

Lock timeout hints may also be interpreted differently.

## 14.3 Design rule

> Treat pessimistic locking as a three-party contract: JPA provider + database dialect/platform + transaction isolation.

You must test real database behavior.

Do not assert pessimistic lock semantics from H2 or mock tests.

---

## 15. Difference #11 — Merge Semantics and Detached Graph Risk

JPA defines `merge`, but provider behavior around graph traversal, cascade, existence checking, and collection replacement can differ.

Portable baseline:

```text
merge(detached) copies detached state into a managed instance.
It does not make the detached instance managed.
```

Dangerous pattern:

```java
@PostMapping("/cases/{id}")
public CaseFile update(@RequestBody CaseFile incoming) {
    return entityManager.merge(incoming);
}
```

Risks:

- null overwrites,
- stale version conflict or missed version if not modeled,
- child collection replacement,
- mass assignment,
- security privilege field update,
- provider-specific cascade traversal cost,
- accidental insert/update due to existence checking.

Hibernate and EclipseLink both can hurt you here, but with different trace/log surface.

Design rule:

> Do not expose entity graphs as API write model. Use command DTOs and mutate managed aggregates explicitly.

Example safer pattern:

```java
@Transactional
public void changeCasePriority(Long caseId, ChangePriorityCommand command) {
    CaseFile caseFile = entityManager.find(CaseFile.class, caseId, LockModeType.OPTIMISTIC);
    caseFile.changePriority(command.priority(), command.reason(), command.actor());
}
```

---

## 16. Difference #12 — Schema Generation and DDL

Schema generation is not a migration strategy.

Hibernate and EclipseLink both support schema generation, but generated DDL can differ substantially:

- type names,
- sequence names,
- constraint names,
- index support,
- FK generation,
- quoted identifiers,
- LOB types,
- timestamp precision,
- enum mapping,
- default values,
- join table names.

Example:

```java
@Column(length = 4000)
private String description;
```

On Oracle, PostgreSQL, MySQL, and SQL Server, generated type and constraint behavior can differ.

Provider differences make this worse.

Design rule:

> Use provider DDL generation for development feedback and validation, not as authoritative production migration.

Production should use reviewed migrations:

- Flyway,
- Liquibase,
- manually reviewed SQL,
- expand-contract deployment,
- rollback plan,
- production-like migration test.

---

## 17. Difference #13 — Bytecode Enhancement vs Weaving Operational Risk

## 17.1 Hibernate enhancement

Hibernate bytecode enhancement can enable/optimize:

- dirty tracking,
- lazy attributes,
- association management,
- performance improvements.

Can be build-time or runtime depending on setup.

Operational risk:

- tests not enhanced but production enhanced,
- production not enhanced but code assumes enhancement,
- final classes/methods interfere,
- plugin version mismatch,
- Java version/classfile mismatch.

## 17.2 EclipseLink weaving

EclipseLink weaving can enable:

- lazy loading for relationships,
- change tracking,
- fetch groups,
- indirection behavior,
- performance optimization.

Operational risk:

- weaving disabled in Java SE test,
- app server classloader difference,
- static weaving not part of CI build,
- dynamic weaving blocked by module/security/classloader constraints,
- native image/AOT constraints.

## 17.3 Design rule

> Enhancement/weaving must be treated as build/runtime contract, not incidental optimization.

Checklist:

- Is it active in unit tests?
- Is it active in integration tests?
- Is it active in packaged artifact?
- Is it active in app server/container?
- Is it active under Java 17/21/25?
- Is CI verifying expected lazy behavior?

---

## 18. Difference #14 — Event/Interceptor/Descriptor Customization

## 18.1 Hibernate extension style

Hibernate extensions often use:

- event listeners,
- interceptors,
- statement inspector,
- integrators,
- custom types,
- filters,
- annotations,
- service registry customization.

Example use cases:

- audit field population,
- tenant enforcement,
- SQL comment/correlation ID,
- soft delete,
- data masking,
- custom JSON type,
- domain event collection.

## 18.2 EclipseLink extension style

EclipseLink extensions often use:

- descriptor customizers,
- session customizers,
- event listeners,
- query redirectors,
- conversion manager,
- cache policies,
- mapping policies.

Example use cases:

- descriptor-level mapping customization,
- cache isolation,
- advanced converter,
- tenant/discriminator customization,
- fetch group behavior,
- custom SQL behavior.

## 18.3 Migration impact

Provider-specific customization is usually the hardest part of migration.

Portable annotation mapping may move.

Custom behavior rarely moves cleanly.

Design rule:

> Put provider-specific customization behind explicit infrastructure modules, not scattered across domain entities and repositories.

Example package boundary:

```text
com.company.case.persistence.jpa          // mostly portable mapping/repository
com.company.case.persistence.hibernate    // Hibernate-specific filters/types/events
com.company.case.persistence.eclipselink  // EclipseLink-specific descriptors/session customizers
```

Even if you only use one provider, the boundary makes future upgrade/debug easier.

---

## 19. Difference #15 — Multi-Tenancy and Filter Semantics

Tenant isolation is a correctness/security concern, not just query convenience.

## 19.1 Hibernate

Hibernate has strong provider-specific support for:

- multi-tenancy strategies,
- filters,
- tenant identifiers,
- discriminator-like filtering,
- soft delete/filter interactions.

But filters can be bypassed by:

- native queries,
- disabled filter sessions,
- cache region misconfiguration,
- async thread missing tenant context,
- admin/reporting code path.

## 19.2 EclipseLink

EclipseLink supports tenant isolation features and descriptor/session-level approaches, including multi-tenant style extensions depending on version/configuration.

But similar bypass risks exist:

- native queries,
- shared cache leakage,
- descriptor misconfiguration,
- query hints bypassing expected filtering,
- external SQL/reporting code.

## 19.3 Design rule

> ORM tenant filters are defense-in-depth, not the only boundary, when leakage impact is high.

For regulated systems, consider:

- database row-level security,
- schema/database isolation,
- explicit tenant column constraints,
- mandatory tenant predicate tests,
- cache region separation,
- integration tests that assert cross-tenant invisibility,
- native query review.

---

## 20. Difference #16 — Diagnostics and Production Observability

## 20.1 Hibernate diagnostics

Common tools/surfaces:

- SQL logging,
- bind parameter logging,
- Hibernate statistics,
- `StatementInspector`,
- slow query correlation,
- Micrometer/Spring integration,
- event listeners,
- query plan cache metrics depending on version/integration,
- L2 cache statistics.

## 20.2 EclipseLink diagnostics

Common tools/surfaces:

- EclipseLink logging categories,
- SQL logging,
- query monitor/profiler options,
- session logs,
- cache logs,
- descriptor/session-level diagnostics,
- weaving indicators,
- performance profiler features.

## 20.3 Difference that matters

Your team’s ability to debug production often matters more than theoretical provider feature set.

Ask:

- Can we correlate request ID to SQL?
- Can we count SQL per endpoint?
- Can we detect N+1 automatically?
- Can we see flush time?
- Can we see entity load count?
- Can we see cache hit/miss?
- Can we see bind values safely in non-prod?
- Can we disable PII-heavy logging in prod?
- Can we trace database wait time vs object hydration time?

Design rule:

> Choose and configure provider diagnostics before the incident, not during it.

---

## 21. Side-by-Side Example: Case Listing Endpoint

Imagine endpoint:

```text
GET /cases?status=OPEN&page=0&size=20
```

Needs response:

```json
{
  "id": 1001,
  "caseNo": "CASE-2026-0001",
  "status": "OPEN",
  "agencyName": "CEA",
  "currentTaskName": "Review Application",
  "lastUpdatedAt": "2026-06-17T10:15:30Z"
}
```

## 21.1 Bad provider-neutral-looking approach

```java
List<CaseFile> cases = entityManager.createQuery("""
    select c
    from CaseFile c
    where c.status = :status
    order by c.lastUpdatedAt desc
""", CaseFile.class)
.setParameter("status", CaseStatus.OPEN)
.setFirstResult(page * size)
.setMaxResults(size)
.getResultList();

return cases.stream()
    .map(c -> new CaseSummaryDto(
        c.getId(),
        c.getCaseNo(),
        c.getStatus(),
        c.getAgency().getName(),
        c.getCurrentTask().getName(),
        c.getLastUpdatedAt()
    ))
    .toList();
```

Looks portable.

Potential behavior:

- base query loads 20 cases,
- each `getAgency()` triggers lazy select,
- each `getCurrentTask()` triggers lazy select,
- total 41 queries,
- provider-specific lazy mechanism decides exact timing,
- serialization or mapper can add more queries.

## 21.2 Safer read-model query

```java
List<CaseSummaryDto> result = entityManager.createQuery("""
    select new com.example.CaseSummaryDto(
        c.id,
        c.caseNo,
        c.status,
        a.name,
        t.name,
        c.lastUpdatedAt
    )
    from CaseFile c
    join c.agency a
    left join c.currentTask t
    where c.status = :status
    order by c.lastUpdatedAt desc
""", CaseSummaryDto.class)
.setParameter("status", CaseStatus.OPEN)
.setFirstResult(page * size)
.setMaxResults(size)
.getResultList();
```

This reduces dependency on provider lazy behavior.

Still must test:

- generated SQL,
- pagination SQL,
- order-by index,
- join cardinality,
- enum binding,
- null current task,
- DTO constructor compatibility.

## 21.3 Top-tier lesson

For listing/read endpoints, provider differences are minimized when query intent is explicit.

Entity graph loading is not always the best abstraction for read models.

---

## 22. Side-by-Side Example: Case Aggregate Update

Operation:

```text
Officer assigns a case to reviewer.
```

## 22.1 Bad detached graph approach

```java
entityManager.merge(incomingCaseFile);
```

Provider-sensitive risks:

- child collection cascade merge storm,
- stale task overwritten,
- null fields copied,
- assigned user changed without authorization,
- version conflict appears late,
- association replacement behavior differs.

## 22.2 Safer managed aggregate mutation

```java
@Transactional
public void assignCase(Long caseId, Long reviewerId, Actor actor) {
    CaseFile caseFile = entityManager.find(
        CaseFile.class,
        caseId,
        LockModeType.OPTIMISTIC
    );

    Reviewer reviewer = entityManager.getReference(Reviewer.class, reviewerId);

    caseFile.assignTo(reviewer, actor, clock.instant());
}
```

Entity method:

```java
public void assignTo(Reviewer reviewer, Actor actor, Instant now) {
    if (!this.status.canBeAssigned()) {
        throw new IllegalStateException("Case cannot be assigned from status " + status);
    }

    this.currentReviewer = reviewer;
    this.status = CaseStatus.ASSIGNED;
    this.lastUpdatedBy = actor.userId();
    this.lastUpdatedAt = now;

    this.auditEntries.add(CaseAudit.assignment(this, reviewer, actor, now));
}
```

Provider differences still exist, but correctness is anchored in managed state and aggregate invariant.

---

## 23. Migration Checklist: Hibernate to EclipseLink

A migration from Hibernate to EclipseLink is not a dependency swap.

## 23.1 Inventory Hibernate-specific usage

Search for:

```text
org.hibernate
@Type
@Filter
@Where
@SQLDelete
@NaturalId
@BatchSize
@Fetch
@FetchProfile
@Subselect
@Formula
@CreationTimestamp
@UpdateTimestamp
Hibernate.initialize
Session
StatelessSession
Interceptor
StatementInspector
Integrator
UserType
BasicType
```

For each usage, classify:

| Usage | Business critical? | Equivalent in EclipseLink? | Replacement strategy |
|---|---:|---|---|
| `@Filter` tenant filter | Yes | possible via EclipseLink tenant/descriptor/query approach | redesign boundary and tests |
| `@BatchSize` | Performance | `@BatchFetch`/query hint | benchmark query shape |
| `@NaturalId` | Lookup/cache | custom unique query/cache | validate concurrency/cache |
| `@SQLDelete` soft delete | Correctness/security | descriptor/query customization | maybe DB view/RLS better |
| `StatementInspector` | Observability | session/query logging/customizer | rebuild correlation strategy |

## 23.2 Test behavior, not just compilation

Required tests:

- lazy loading tests,
- relationship mutation tests,
- orphan removal tests,
- cascade delete tests,
- merge detached graph tests,
- batch insert/update tests,
- optimistic lock tests,
- pessimistic lock tests on real DB,
- query result equivalence tests,
- SQL count tests,
- cache visibility tests,
- DDL diff tests.

## 23.3 Red flags

Migration is risky if codebase has:

- entities returned directly from API,
- provider-specific annotations everywhere,
- OSIV relied upon heavily,
- no SQL count tests,
- no integration tests on real DB,
- heavy `merge()` usage,
- large bidirectional graphs,
- implicit lazy loads in mappers,
- shared cache without clear policy,
- native queries mixed with ORM cache.

---

## 24. Migration Checklist: EclipseLink to Hibernate

## 24.1 Inventory EclipseLink-specific usage

Search for:

```text
org.eclipse.persistence
@BatchFetch
@JoinFetch
@PrivateOwned
@CascadeOnDelete
@Converter
@ObjectTypeConverter
@TypeConverter
@Struct
@Transformation
@Multitenant
DescriptorCustomizer
SessionCustomizer
FetchGroup
QueryHints
eclipselink.
```

Classify:

| Usage | Business critical? | Equivalent in Hibernate? | Replacement strategy |
|---|---:|---|---|
| `@BatchFetch` | Performance | `@BatchSize`, default batch fetch, query plan | benchmark |
| `@PrivateOwned` | Lifecycle | orphanRemoval/cascade remove | validate delete semantics |
| `@CascadeOnDelete` | DDL/delete behavior | DB FK cascade + Hibernate config/annotation alternatives | verify SQL/delete ordering |
| FetchGroup | Partial loading | DTO projection/entity graph/enhancement | avoid partial entity surprise |
| DescriptorCustomizer | Mapping extension | Hibernate type/event/integrator | rewrite extension |
| Shared cache policy | Correctness/performance | L2 cache regions | redefine cache contract |

## 24.2 Watch for Hibernate-specific constraints

Potential surprises:

- multiple bag fetch issue,
- stricter HQL/Criteria behavior in newer Hibernate,
- dialect class/config changes,
- sequence allocation behavior,
- flush action ordering differences,
- proxy class/equality behavior,
- different default naming strategy in framework integration,
- L2 cache disabled unless configured.

---

## 25. Provider Choice Decision Framework

## 25.1 Choose Hibernate when...

Hibernate is often better fit when:

- your app is Spring Boot/Spring Data centered,
- team already knows Hibernate internals,
- you need broad ecosystem/community support,
- you need HQL/provider-specific query power,
- you use Envers/Search/Validator ecosystem,
- you need filters, custom types, statement inspection,
- you want commonly available production knowledge and examples,
- hiring/training favors Hibernate experience.

## 25.2 Choose EclipseLink when...

EclipseLink can be better fit when:

- your app is Jakarta EE/container centered,
- team already knows EclipseLink sessions/descriptors,
- you need EclipseLink-specific mapping/weaving/fetch group features,
- you benefit from its shared cache model and can manage it correctly,
- you integrate with legacy TopLink/EclipseLink patterns,
- you need MOXy/advanced mapping ecosystem,
- your app server/platform standardizes around EclipseLink.

## 25.3 Do not choose provider by benchmark alone

Benchmarks are often misleading because performance depends on:

- mapping design,
- fetch plan,
- cache configuration,
- batch size,
- transaction scope,
- database/dialect,
- object graph size,
- connection pool,
- SQL plan,
- JVM allocation rate,
- observability overhead.

A bad fetch plan in either provider will destroy performance.

A well-designed read model in either provider can perform well.

---

## 26. Portability Strategy: The Three-Layer Model

A mature persistence layer separates portability levels.

```text
Layer 1: Portable domain persistence
  - standard JPA mappings where possible
  - simple JPQL
  - clear aggregate methods
  - standard optimistic locking

Layer 2: Provider-tuned infrastructure
  - batch fetching
  - filters
  - cache regions
  - custom types/converters
  - SQL inspection
  - event listeners/descriptors

Layer 3: Database-native optimization
  - native queries
  - materialized views
  - window functions
  - JSON/search-specific indexes
  - partitioning
  - archival queries
```

The mistake is mixing all three randomly.

Bad:

```text
Entity has provider annotations, API serialization annotations, validation rules,
security assumptions, cache hints, reporting SQL assumptions, and workflow logic all together.
```

Better:

```text
Domain entity: aggregate invariant and stable mapping
Repository/query layer: query intent
Provider infrastructure: provider-specific tuning
Migration layer: schema changes
Observability layer: SQL tracing/statistics
```

---

## 27. Behavioral Test Suite for Provider Migration

A top-tier team does not ask:

> “Does it compile after changing provider?”

It asks:

> “Which observable behaviors must remain stable?”

## 27.1 Test categories

### 27.1.1 Identity and lifecycle

Test:

- same row returns same object inside one persistence context,
- detach/merge behavior,
- remove then re-persist semantics,
- generated ID assignment timing.

### 27.1.2 Association mutation

Test:

- owning side update,
- inverse side consistency,
- orphan removal,
- join table mutation,
- bidirectional helper methods.

### 27.1.3 Dirty checking

Test:

- scalar update,
- embeddable replacement,
- mutable embeddable mutation,
- collection add/remove,
- no-op update should not emit SQL if expected.

### 27.1.4 Fetch plan

Test:

- SQL count per endpoint,
- no N+1,
- pagination correctness,
- no cartesian explosion,
- lazy access outside transaction fails/behaves as expected.

### 27.1.5 Transaction and flush

Test:

- query-triggered flush,
- constraint timing,
- rollback clears DB changes,
- explicit flush sequence.

### 27.1.6 Locking

Test:

- optimistic conflict,
- pessimistic lock wait/timeout,
- deadlock prevention order,
- bulk update bypass version warning.

### 27.1.7 Cache

Test:

- repeated read cache behavior,
- external update visibility,
- tenant isolation,
- cache eviction.

### 27.1.8 Schema

Test:

- generated DDL diff,
- validation against real schema,
- migration compatibility,
- sequence allocation.

## 27.2 SQL count assertion pattern

Pseudo-test:

```java
@Test
void caseListingShouldNotHaveNPlusOne() {
    sqlCounter.reset();

    caseQueryService.listOpenCases(PageRequest.of(0, 20));

    assertThat(sqlCounter.selectCount()).isLessThanOrEqualTo(2);
}
```

This catches provider migration regression better than visual code review.

---

## 28. Provider Differences in Java 8–25 Context

## 28.1 Java 8 era

Common stack:

- JPA 2.1/2.2,
- `javax.persistence`,
- Hibernate 5.x,
- EclipseLink 2.x,
- older app servers,
- older bytecode/classloader assumptions.

Risks:

- migration to `jakarta` is non-trivial,
- old Hibernate/EclipseLink versions may lack modern Java Time support or have older behavior,
- app server provider bundled version may conflict with application dependency,
- Java 8 bytecode cannot use modern provider baselines requiring Java 11/17.

## 28.2 Java 17/21/25 era

Common stack:

- `jakarta.persistence`,
- Jakarta Persistence 3.x,
- Hibernate 6/7,
- EclipseLink 4/5,
- Spring Boot 3+/Jakarta EE 10/11,
- records/Java Time improvements,
- stricter modules/classloading/AOT concerns.

Jakarta Persistence 3.2 includes modern improvements such as support around Java records as embeddables/IdClass and built-in mappings for `Instant`/`Year`, while deprecating older date/time temporal usage in favor of `java.time` in the Jakarta EE 11 context.

Risks:

- Java baseline changed; Hibernate 7 requires Java 17+.
- Criteria API generics changed in Jakarta Persistence 3.2/Hibernate 7 migration context.
- Older provider-specific APIs may be removed or changed.
- Build-time enhancement/weaving must support newer classfile versions.
- `javax` and `jakarta` dependencies cannot be mixed casually.

## 28.3 Design rule

> For Java 8–25 coverage, define two lanes: legacy maintenance lane and modern development lane.

Example:

```text
Legacy lane:
  Java 8 + javax.persistence + Hibernate 5.x/EclipseLink 2.x

Modern lane:
  Java 17/21/25 + jakarta.persistence + Hibernate 6/7 or EclipseLink 4/5
```

Do not design one dependency set that pretends to cover both cleanly.

---

## 29. Production Failure Modes by Provider Difference

## 29.1 Lazy loading failure

Symptom:

```text
Endpoint works locally but fails in production with lazy loading exception or missing data.
```

Possible root causes:

- Hibernate proxy accessed outside session.
- EclipseLink weaving not active in one environment.
- OSIV differs across profiles.
- Serializer touches lazy field.
- Entity graph not applied as expected.

Fix patterns:

- use DTO projection for endpoint,
- define transaction boundary explicitly,
- test lazy behavior in packaged app,
- remove entity serialization,
- verify enhancement/weaving.

## 29.2 Stale data failure

Symptom:

```text
User sees old status after another process updated DB.
```

Possible root causes:

- L1 persistence context reused too long,
- EclipseLink shared cache returns stale object,
- Hibernate L2/query cache stale configuration,
- external DB updates bypass provider cache,
- transaction isolation expected incorrectly.

Fix patterns:

- shorten persistence context scope,
- disable cache for volatile entity,
- explicit refresh in rare controlled cases,
- event-based invalidation,
- avoid query cache for mutable workflows.

## 29.3 Query explosion after migration

Symptom:

```text
Same endpoint goes from 5 SQL statements to 300 after provider migration.
```

Possible root causes:

- provider-specific batch fetch annotation lost,
- entity graph interpreted differently,
- lazy strategy changed,
- query hints ignored,
- collection fetch plan changed.

Fix patterns:

- SQL count regression tests,
- explicit DTO query,
- provider-equivalent batch fetch config,
- endpoint-level fetch plan inventory.

## 29.4 Constraint violation after provider migration

Symptom:

```text
Replacing child entity fails with unique constraint violation.
```

Possible root causes:

- flush ordering changed,
- delete/insert action order differs,
- collection recreation strategy differs,
- database FK cascade expectation differs,
- orphan removal timing differs.

Fix patterns:

- explicit remove/flush/add where necessary,
- redesign unique constraint to include status/effective date,
- avoid replacing with same business key in one ambiguous graph operation,
- integration test on real DB.

## 29.5 Cache tenant leakage

Symptom:

```text
Tenant A sees data from Tenant B.
```

Possible root causes:

- provider cache region not tenant-isolated,
- filter missing from native query,
- tenant context lost in async thread,
- shared cache key lacks tenant dimension,
- admin query reused in tenant endpoint.

Fix patterns:

- DB-level tenant enforcement,
- cache region separation,
- mandatory tenant predicate tests,
- disable cache for tenant-sensitive entities,
- native query review.

---

## 30. Anti-Patterns

## 30.1 “It is JPA, so it is portable”

Wrong because JPA does not define all runtime behavior.

Better:

```text
This part is portable JPA.
This part is provider-specific and tested/documented as such.
```

## 30.2 Provider annotations scattered everywhere

Bad:

```java
@Entity
@Where(...)
@Filter(...)
@BatchSize(...)
@SQLDelete(...)
public class CaseFile { ... }
```

Sometimes necessary, but dangerous if unmanaged.

Better:

- isolate provider annotations where possible,
- document why each exists,
- add migration notes,
- add behavior tests.

## 30.3 Entity as API contract

Bad for both providers.

Leads to:

- lazy loading exposure,
- mass assignment,
- detached graph merge risk,
- serialization recursion,
- provider proxy leakage.

## 30.4 H2 as proof of provider behavior

H2 can be useful for fast tests, but not proof for:

- locking,
- dialect SQL,
- pagination,
- timestamp precision,
- sequence allocation,
- LOB handling,
- execution plan,
- constraint timing.

## 30.5 Cache before correctness

Caching a badly understood entity graph creates stale and inconsistent behavior faster.

Cache only after defining:

- mutability,
- invalidation,
- transaction visibility,
- tenant isolation,
- external writer behavior,
- monitoring.

---

## 31. Design Rules

## Rule 1 — Classify every persistence feature by portability

```text
Portable JPA
Provider-specific
Database-specific
Framework-specific
```

Never leave it ambiguous.

## Rule 2 — Optimize query intent, not provider hope

For read endpoints, use DTO/query models when the result is not an aggregate mutation use case.

## Rule 3 — Use managed aggregate mutation for writes

Avoid detached graph merge as the default update strategy.

## Rule 4 — Test SQL shape as behavior

SQL count and SQL shape are part of correctness for performance-sensitive systems.

## Rule 5 — Treat enhancement/weaving as deployment contract

Do not allow test/prod mismatch.

## Rule 6 — Make cache policy explicit per entity

Do not let defaults decide correctness.

## Rule 7 — Keep provider-specific code behind boundaries

Provider-specific is fine. Hidden provider-specific is dangerous.

## Rule 8 — Migration is behavior migration

Compilation is the first 20%. Runtime equivalence is the remaining 80%.

## Rule 9 — Prefer DB-native enforcement for high-risk security boundaries

ORM filters help, but database constraints/RLS/schema isolation may be required for regulated data.

## Rule 10 — Pick provider for operational fit, not ideology

The best provider is the one your team can operate, debug, upgrade, and defend.

---

## 32. Decision Table: Hibernate vs EclipseLink

| Question | If answer is yes | Lean |
|---|---|---|
| Is the app Spring Boot/Spring Data-heavy? | Yes | Hibernate |
| Is the app Jakarta EE server-centered with EclipseLink support? | Yes | EclipseLink |
| Does team already have deep Hibernate production experience? | Yes | Hibernate |
| Does team already have deep EclipseLink descriptor/weaving/cache experience? | Yes | EclipseLink |
| Do you need Hibernate Envers/Search/NaturalId/filter ecosystem? | Yes | Hibernate |
| Do you need EclipseLink fetch groups/descriptors/MOXy/advanced mappings? | Yes | EclipseLink |
| Is provider portability a contractual requirement? | Yes | Use strict JPA subset + behavior tests; provider choice still matters |
| Is performance dominated by custom reporting/listing queries? | Yes | Provider less important than read-model SQL discipline |
| Is tenant/security isolation critical? | Yes | Provider filters insufficient alone; design DB-level guardrails |
| Is migration likely in future? | Yes | Isolate provider-specific code now |

---

## 33. Practice Scenarios

## Scenario 1 — Provider migration causes N+1

You migrate from EclipseLink to Hibernate. A case listing endpoint becomes slow. SQL logs show 1 query for cases and 2 additional queries per case.

Questions:

1. Which fetch hints or batch fetch settings were EclipseLink-specific?
2. Did Hibernate ignore those hints?
3. Is this endpoint better served by DTO projection?
4. What SQL count test should be added?
5. Which provider-specific replacement is acceptable?

Expected direction:

- Do not solve blindly with join fetch all collections.
- First define endpoint read shape.
- Use DTO projection or explicit fetch plan.
- Add SQL count regression test.

## Scenario 2 — EclipseLink shared cache shows stale status

An external batch job updates `CASE_FILE.STATUS`. The web app still shows old status.

Questions:

1. Is shared cache enabled for `CaseFile`?
2. Is the object already in a long persistence context?
3. Does the query bypass cache?
4. Should this entity be cacheable?
5. Is external update pattern compatible with ORM cache?

Expected direction:

- Disable shared cache for volatile workflow entities or add invalidation.
- Avoid query cache/shared cache for mutable case status.
- Use explicit refresh only as tactical fix.

## Scenario 3 — Hibernate multiple bag fetch issue

A query fetches `case.tasks` and `case.notes` together. It fails or produces huge row duplication.

Questions:

1. Are both list collections bag-like?
2. Is the endpoint actually requiring full entity graph?
3. Can one collection be batch fetched instead?
4. Can query be split?
5. Is DTO projection better?

Expected direction:

- Avoid fetching multiple large collections together.
- Use read-model query or split query.
- Preserve aggregate write model separately.

## Scenario 4 — Lazy behavior differs between test and production

Tests pass, but production fails when accessing lazy relationship.

Questions:

1. Is Hibernate enhancement/EclipseLink weaving active in both environments?
2. Is OSIV enabled locally but disabled in production?
3. Is serialization touching lazy field?
4. Are tests using same provider and packaging mode?
5. Are entities leaking outside transaction boundary?

Expected direction:

- Make test packaging closer to production.
- Stop returning entities from API.
- Use DTO projection/fetch plan.

---

## 34. Production Readiness Checklist

Before committing to provider behavior, verify:

```text
[ ] Provider version is explicit and documented.
[ ] Java baseline is explicit.
[ ] javax/jakarta namespace is not mixed accidentally.
[ ] Provider-specific annotations are inventoried.
[ ] Provider-specific query hints are inventoried.
[ ] Enhancement/weaving is verified in CI and packaged runtime.
[ ] SQL logging can be enabled safely.
[ ] SQL count tests exist for critical endpoints.
[ ] Fetch plans are documented for critical endpoints.
[ ] Cache policy is explicit per entity/region.
[ ] Tenant/security filtering is tested against bypass paths.
[ ] Native queries are reviewed for tenant/soft-delete predicates.
[ ] Optimistic locking tests exist for concurrent updates.
[ ] Pessimistic locking tests run on real DB.
[ ] Schema migration is controlled outside provider auto-update.
[ ] Provider migration suite checks behavior, not just compilation.
```

---

## 35. Summary

Hibernate and EclipseLink are both serious JPA/Jakarta Persistence providers, but they are not interchangeable black boxes.

The specification gives a common vocabulary:

- entity,
- persistence context,
- relationship mapping,
- JPQL,
- lock mode,
- cache mode,
- transaction integration.

The provider determines much of the runtime reality:

- lazy mechanism,
- dirty tracking,
- SQL generation,
- flush internals,
- cache semantics,
- extension model,
- diagnostics,
- migration risk,
- performance tuning surface.

The top-tier mindset is not:

```text
Avoid provider-specific behavior at all costs.
```

The better mindset is:

```text
Use the portable subset where it is enough.
Use provider-specific features where they create real value.
Make those dependencies explicit, tested, observable, and isolated.
```

For complex enterprise/regulatory systems, this distinction is critical. Persistence bugs are rarely just “ORM bugs.” They are usually mismatches between domain invariants, object graph scope, provider behavior, SQL shape, transaction boundary, and operational assumptions.

Mastering Hibernate vs EclipseLink means knowing not only what annotation to write, but also what runtime contract you are accepting.

---

## 36. References

- Jakarta Persistence 3.2 Specification and API documentation.
- Jakarta Persistence 4.0 development page for future-version context.
- Hibernate ORM release and documentation pages.
- Hibernate ORM migration guides, especially modern Java/Jakarta Persistence baseline changes.
- EclipseLink project, downloads, and JPA extensions documentation.
- EclipseLink documentation for sessions, descriptors, weaving, cache, query hints, batch fetch, and advanced mappings.


# learn-sql-mastery-for-java-engineers-part-026.md

# Part 26 — ORM and Query Builders: Hibernate, JPA, jOOQ, MyBatis

> Seri: SQL Mastery for Java Engineers  
> Bagian: 026 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-025.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-027.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas SQL dari Java melalui JDBC:

- `DataSource`
- connection pool
- `PreparedStatement`
- resource safety
- transaction boundary
- batching
- fetch size
- generated keys
- exception mapping
- timeout
- Testcontainers

Sekarang kita membahas abstraction di atas JDBC:

```text
Hibernate
JPA
jOOQ
MyBatis
query builders
```

Banyak Java backend engineer hidup di ORM setiap hari, tetapi tidak memahami SQL yang dihasilkan. Ini berbahaya.

ORM bisa sangat produktif untuk:

- CRUD sederhana
- aggregate persistence
- identity map
- dirty checking
- optimistic locking
- relationship mapping
- domain object lifecycle
- transaction integration

Namun ORM juga bisa menghasilkan:

- N+1 queries
- join explosion
- unexpected eager loading
- lazy loading during serialization
- broken pagination with fetch join
- over-fetching
- inefficient updates
- persistence context memory bloat
- stale entity state after bulk DML
- hidden SQL under innocuous method call
- accidental transaction boundary issues
- schema design distorted by object model

Bagian ini tidak anti-ORM.

Tujuannya adalah membuat kamu mampu memakai ORM dan query builder secara sadar, bukan dogmatis.

Kalimat inti:

> ORM adalah tool untuk mengelola object persistence; ia bukan pengganti pemahaman relational model, SQL semantics, indexing, transactions, dan execution plans.

---

## 1. Apa Itu ORM?

ORM = Object-Relational Mapping.

Ia memetakan:

```text
Java object/class <-> relational table/row
object reference <-> foreign key relationship
object lifecycle <-> insert/update/delete
collection <-> one-to-many/many-to-many
```

Contoh JPA entity:

```java
@Entity
@Table(name = "cases")
public class CaseEntity {
    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "case_number", nullable = false)
    private String caseNumber;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    @Version
    private long version;
}
```

ORM membuat Java code bisa bekerja dengan object:

```java
CaseEntity c = entityManager.find(CaseEntity.class, id);
c.setStatus(CaseStatus.CLOSED);
```

Lalu Hibernate menghasilkan SQL update saat flush.

---

## 2. JPA vs Hibernate

JPA adalah specification.

Hibernate adalah implementation yang paling populer.

JPA mendefinisikan:

- entity
- persistence context
- entity manager
- JPQL
- relationships
- lifecycle callbacks
- optimistic locking
- transaction integration

Hibernate menambahkan:

- implementation behavior
- extensions
- caching
- batching settings
- fetch strategies
- filters
- custom types
- dirty checking implementation
- SQL generation details

Ketika orang bilang “JPA”, sering yang dimaksud adalah “Hibernate via JPA annotations”.

Sebagai engineer, kamu perlu tahu mana specification dan mana vendor behavior.

---

## 3. ORM Mental Model

Core Hibernate/JPA concepts:

```text
Entity
EntityManager / Session
Persistence Context
Identity Map
Dirty Checking
Flush
Transaction
Lazy Proxy
Fetch Strategy
Cascade
Detached Entity
Merge
Optimistic Locking
```

Kesalahan umum adalah menganggap repository method langsung sama dengan SQL statement tertentu.

ORM punya lifecycle dan context.

---

## 4. Persistence Context

Persistence context adalah unit-of-work cache di dalam transaction/session.

Dalam satu persistence context:

```java
CaseEntity a = em.find(CaseEntity.class, id);
CaseEntity b = em.find(CaseEntity.class, id);

a == b // true
```

ORM memastikan satu entity instance per identity.

Benefits:

- identity map
- change tracking
- relationship consistency
- delayed flush

Risks:

- memory grows if loading many entities
- stale state after bulk SQL
- hidden writes at flush
- long transaction holds many managed objects
- entity changes accidentally persisted

---

## 5. Dirty Checking

Hibernate tracks changes to managed entities.

```java
@Transactional
public void closeCase(UUID id) {
    CaseEntity c = em.find(CaseEntity.class, id);
    c.setStatus(CLOSED);
}
```

Even without explicit `save`, Hibernate may flush:

```sql
UPDATE cases
SET status = ?, version = ?
WHERE id = ? AND version = ?
```

This is convenient.

But:

- every managed entity can be dirty-checked
- accidental setter call persists
- flush timing matters
- update shape depends on mapping/settings
- bulk operations can be inefficient
- entity lifecycle hidden from SQL review

Know when flush happens.

---

## 6. Flush

Flush synchronizes persistence context changes to database.

Flush can happen:

- before transaction commit
- before query execution, depending flush mode
- explicitly via `em.flush()`

Example:

```java
caseEntity.setStatus(CLOSED);

List<CaseEntity> openCases = queryOpenCases();
```

Hibernate may flush update before running query to keep query consistent.

Flush does not necessarily commit. It sends SQL within current transaction.

Error during flush means transaction should rollback.

---

## 7. Entity State

JPA entity states:

```text
transient
managed
detached
removed
```

### 7.1 Transient

New object not associated with persistence context.

### 7.2 Managed

Tracked by persistence context.

### 7.3 Detached

Was managed, now outside persistence context.

### 7.4 Removed

Scheduled for delete.

Detached/merge bugs are common.

`merge` does not simply “update this object”; it copies state into a managed instance. Misuse can overwrite fields.

---

## 8. Lazy Loading

Lazy relationship loads when accessed.

```java
CaseEntity c = caseRepository.findById(id);
List<EvidenceEntity> evidences = c.getEvidences(); // triggers SQL
```

Benefits:

- avoid loading relationship when not needed

Risks:

- N+1 queries
- LazyInitializationException outside transaction/session
- SQL during JSON serialization
- hidden database access in getters
- unpredictable performance

Lazy loading is useful inside controlled transaction boundaries, dangerous in API serialization.

---

## 9. N+1 Query Problem

Code:

```java
List<CaseEntity> cases = caseRepository.findOpenCases();

for (CaseEntity c : cases) {
    c.getEvidences().size();
}
```

SQL:

```text
1 query for cases
N queries for evidences
```

If N = 50, maybe okay sometimes. If N = 500, bad. If nested, catastrophic.

Symptoms:

- many similar queries
- endpoint latency grows with result size
- DB query count high
- each query individually fast
- connection pool pressure

Fixes:

- join fetch carefully
- batch fetch
- entity graph
- DTO projection
- explicit second query with `WHERE case_id IN (...)`
- read model
- aggregation query

---

## 10. Fetch Join

JPQL:

```java
select c
from CaseEntity c
left join fetch c.evidences
where c.tenantId = :tenantId
```

This loads cases and evidences in one SQL.

Good for:

- small bounded relationship
- detail page
- avoiding N+1 for one collection

Risks:

- row multiplication
- duplicate parent rows
- pagination broken
- multiple collection fetch join explosion
- huge result sets
- memory bloat

Fetch join is not universal N+1 cure.

---

## 11. Pagination with Fetch Join

Bad:

```java
select c
from CaseEntity c
left join fetch c.evidences
where c.status = :status
order by c.openedAt desc
```

with pagination.

SQL result rows are parent × child.

`LIMIT 50` may limit joined rows, not 50 parent cases, or Hibernate may paginate in memory depending situation.

Better:

1. page parent IDs first
2. fetch relationships for those IDs

Example:

```java
List<UUID> ids = queryCaseIdsPage(...);

List<CaseEntity> cases = queryCasesWithEvidences(ids);
```

Or use DTO/read model.

---

## 12. Batch Fetching

Hibernate can batch lazy loads.

Instead of:

```text
SELECT evidences WHERE case_id = ?
SELECT evidences WHERE case_id = ?
...
```

It can do:

```sql
SELECT *
FROM case_evidences
WHERE case_id IN (?, ?, ?, ...)
```

Settings/features:

- `@BatchSize`
- `hibernate.default_batch_fetch_size`

This helps N+1 without giant join.

But still know query shape and batch size.

---

## 13. Entity Graph

JPA entity graph defines what associations to fetch.

```java
@EntityGraph(attributePaths = {"primaryAssignment", "primaryAssignment.officer"})
Optional<CaseEntity> findById(UUID id);
```

Useful for:

- use-case-specific fetch plan
- avoid global eager mapping
- reduce N+1

Caveats:

- generated SQL still must be inspected
- collection graphs can multiply rows
- pagination issues remain
- not replacement for DTO/read model

---

## 14. EAGER Fetch Is Dangerous

Many beginners set:

```java
@OneToMany(fetch = FetchType.EAGER)
```

This often causes:

- unexpected joins
- loading huge graphs
- recursive loading
- performance unpredictability
- memory bloat
- query explosion
- impossible-to-control fetch plan

Default to lazy for associations.

Fetch explicitly per use case.

---

## 15. DTO Projection

For API list:

```java
record CaseQueueItem(
    UUID id,
    String caseNumber,
    String status,
    String priority,
    Instant openedAt
) {}
```

JPQL projection:

```java
select new com.example.CaseQueueItem(
    c.id,
    c.caseNumber,
    c.status,
    c.priority,
    c.openedAt
)
from CaseEntity c
where c.tenantId = :tenantId
  and c.status = :status
order by c.openedAt desc
```

Benefits:

- fewer columns
- no persistence context dirty checking
- no lazy loading
- stable read model shape
- easier pagination
- less memory

For read-heavy endpoints, DTO projection is often better than entity loading.

---

## 16. Entity for Writes, DTO for Reads

Good heuristic:

```text
Use entities for transactional aggregate modification.
Use DTO/query/read model for read endpoints.
```

Entity is useful when:

- loading aggregate for command
- applying domain behavior
- optimistic locking
- cascades make sense
- persistence lifecycle matters

DTO/query is useful when:

- list page
- dashboard
- report
- search result
- export
- joining many tables
- aggregation
- read-only response

Do not force every read through entity graph.

---

## 17. ORM and Aggregate Boundaries

In DDD-style design, entity aggregate is consistency boundary.

If `Case` aggregate includes status and assignment command rules, entity can help.

But relational database may contain many related tables not all part of same aggregate.

Do not map whole database as one object graph.

Avoid:

```text
Case -> evidences -> documents -> parties -> notes -> approvals -> officers -> departments
```

as always-navigable object graph.

Large object graphs create performance and consistency confusion.

---

## 18. Cascade

JPA cascade:

```java
@OneToMany(mappedBy = "case", cascade = CascadeType.ALL)
private List<CaseNoteEntity> notes;
```

Means operations on parent cascade to children.

Useful for true aggregate-owned children.

Dangerous for:

- shared references
- large child collections
- accidental deletes
- many-to-many
- entities with independent lifecycle

Be especially careful with:

```java
CascadeType.REMOVE
orphanRemoval = true
```

A collection modification can delete rows.

---

## 19. Many-to-Many Mapping

Direct many-to-many:

```java
@ManyToMany
Set<TagEntity> tags;
```

Works for simple join table.

But if relationship has attributes:

```text
created_at
created_by
confidence
source
ended_at
```

then model join table as entity:

```java
CaseTagEntity
```

Relational thinking:

```text
relationship can be fact with attributes
```

ORM direct many-to-many often hides important relationship semantics.

---

## 20. Enum Mapping

Avoid ordinal enum mapping.

Bad:

```java
@Enumerated(EnumType.ORDINAL)
```

If enum order changes, data meaning changes.

Good:

```java
@Enumerated(EnumType.STRING)
```

or explicit converter with stable codes.

Database:

```sql
status TEXT NOT NULL
```

with check/reference table.

For stable domain values, reference table may be better than Java enum alone.

---

## 21. Optimistic Locking with `@Version`

Entity:

```java
@Version
private long version;
```

Hibernate update:

```sql
UPDATE cases
SET status = ?, version = ?
WHERE id = ?
  AND version = ?
```

If affected rows = 0, optimistic lock exception.

Benefits:

- lost update detection
- simple aggregate concurrency control

Caveats:

- bulk JPQL updates bypass normal version handling unless explicitly managed
- detached merge can still be tricky
- conflicts need domain/user handling
- not enough for all cross-row invariants

---

## 22. Pessimistic Locking

JPA:

```java
entityManager.find(
    CaseEntity.class,
    id,
    LockModeType.PESSIMISTIC_WRITE
);
```

or query:

```java
query.setLockMode(LockModeType.PESSIMISTIC_WRITE);
```

Generated SQL may use:

```sql
FOR UPDATE
```

Use when:

- high contention
- must inspect current state before write
- command must serialize per entity

Caveats:

- lock waits
- deadlocks
- transaction must be short
- lock scope may include joined rows depending query
- timeout configuration matters

Inspect generated SQL.

---

## 23. Bulk JPQL Update

JPQL bulk:

```java
int updated = entityManager.createQuery("""
    update CaseEntity c
    set c.status = :closed
    where c.tenantId = :tenantId
      and c.status = :oldStatus
""")
.setParameter("closed", CLOSED)
.setParameter("oldStatus", UNDER_REVIEW)
.executeUpdate();
```

Bulk updates bypass:

- entity lifecycle callbacks
- dirty checking
- persistence context state
- optimistic version checks unless included
- cascades

After bulk update, managed entities may be stale.

Often call:

```java
entityManager.clear();
```

or avoid mixing bulk update with managed entities.

---

## 24. Native SQL in JPA

Native query:

```java
entityManager.createNativeQuery("""
    SELECT id, case_number
    FROM cases
    WHERE tenant_id = :tenantId
""")
.setParameter("tenantId", tenantId);
```

Use for:

- vendor-specific SQL
- window functions
- CTEs
- advanced indexes/operator
- performance-critical queries
- projections

Caveats:

- result mapping manual/fragile
- portability reduced
- persistence context not automatically aware
- SQL injection risk if concatenating fragments
- harder to refactor with entity fields

Native SQL is fine if treated as first-class code.

---

## 25. Hibernate Filters and Multi-Tenancy

Hibernate has filters and multi-tenancy support.

Example tenant filter:

```java
@FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = UUID.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
```

Risks:

- filter not enabled in some context
- native queries bypass
- admin jobs
- performance
- tests missing
- false sense of safety

For high-risk tenant isolation, combine:

- explicit tenant predicates
- database constraints/composite FKs
- optional RLS defense-in-depth
- tests

---

## 26. Soft Delete with ORM

Hibernate supports patterns like:

```java
@SQLDelete(sql = "UPDATE cases SET deleted_at = now() WHERE id = ?")
@Where(clause = "deleted_at IS NULL")
```

Caveats:

- `@Where` is hidden filter
- native queries bypass
- unique constraints need partial indexes
- admin queries may need deleted rows
- relationships may behave unexpectedly
- hard deletes still possible
- read models/search indexes need deletion propagation

Soft delete is data lifecycle design, not annotation only.

---

## 27. jOOQ

jOOQ is SQL-first, type-safe query builder.

It generates Java classes from database schema.

Example:

```java
ctx.select(CASES.ID, CASES.CASE_NUMBER)
   .from(CASES)
   .where(CASES.TENANT_ID.eq(tenantId))
   .and(CASES.STATUS.eq("OPEN"))
   .orderBy(CASES.OPENED_AT.desc(), CASES.ID.desc())
   .limit(50)
   .fetchInto(CaseQueueItem.class);
```

Strengths:

- SQL expressiveness
- type-safe schema references
- supports advanced SQL
- less ORM hidden loading
- good for projections/reporting
- explicit query shape
- vendor dialect support

Trade-offs:

- less object lifecycle management
- more SQL thinking required
- generated code workflow
- not a domain aggregate persistence tool in same way as ORM

jOOQ is excellent when you want SQL power with Java type safety.

---

## 28. jOOQ vs JPA

JPA/Hibernate optimizes for:

```text
object persistence and entity lifecycle
```

jOOQ optimizes for:

```text
type-safe SQL construction and result mapping
```

Use JPA when:

- aggregate persistence is central
- CRUD/domain entity lifecycle
- optimistic locking on entities
- object graph small and controlled

Use jOOQ when:

- queries are complex
- SQL features matter
- read models/projections/reporting
- performance-critical SQL
- CTE/window/upsert/vendor syntax
- you want explicit query shape

Many mature systems use both:

```text
JPA for writes/simple aggregate persistence
jOOQ for complex reads/reporting/bulk operations
```

---

## 29. MyBatis

MyBatis maps SQL to Java methods/objects.

Example mapper:

```java
@Select("""
    SELECT id, case_number, status
    FROM cases
    WHERE tenant_id = #{tenantId}
      AND status = #{status}
    ORDER BY opened_at DESC, id DESC
    LIMIT #{limit}
""")
List<CaseQueueItem> findOpenCases(...);
```

Strengths:

- SQL explicit
- lightweight
- good for hand-written SQL
- dynamic SQL support
- predictable query shape
- less magic than ORM

Trade-offs:

- mapping boilerplate
- no full entity lifecycle/dirty checking
- dynamic SQL can be unsafe if `${}` used incorrectly
- refactoring columns manual
- less type-safe than jOOQ

Important MyBatis distinction:

```text
#{param} -> bind parameter
${param} -> string substitution, dangerous unless allowlisted
```

---

## 30. MyBatis Dynamic SQL Safety

Safe:

```sql
WHERE status = #{status}
```

Dangerous:

```sql
ORDER BY ${sortColumn}
```

If using `${}`, value becomes raw SQL.

Only use with allowlisted values.

Example:

```java
String sortColumn = switch (request.sort()) {
    case "openedAt" -> "opened_at";
    case "priority" -> "priority_rank";
    default -> throw new BadRequestException();
};
```

Then pass controlled value.

---

## 31. Query Builders and Criteria API

JPA Criteria API is type-ish-safe but verbose.

Useful for dynamic filters.

Downside:

- hard to read
- generated SQL can be non-obvious
- easy to build poor OR predicates
- joins/fetches complex
- not as SQL-expressive as jOOQ

QueryDSL and other builders can improve ergonomics.

But principle remains:

```text
Query builder does not eliminate need to understand SQL plan.
```

---

## 32. Choosing Tool by Use Case

### 32.1 Simple CRUD

JPA repository can be fine.

### 32.2 Command Updating Aggregate

JPA with optimistic locking can be good.

### 32.3 Complex Search Page

jOOQ/MyBatis/native SQL/read model often better.

### 32.4 Reporting/Aggregation

SQL-first tool better.

### 32.5 Bulk Import/Update

JDBC/jOOQ/native SQL better than entity loop.

### 32.6 Vendor-Specific Features

jOOQ/native SQL.

### 32.7 High-Volume List Endpoint

DTO projection/read model.

### 32.8 Rich Object Graph Editing

JPA can help if aggregate boundary controlled.

---

## 33. Entity Loop Anti-Pattern

Bad:

```java
List<CaseEntity> cases = repository.findByStatus(OPEN);
for (CaseEntity c : cases) {
    c.setPriority(HIGH);
}
```

For 100k rows, this:

- loads 100k entities
- stores in persistence context
- dirty checks
- issues many updates/batches
- memory heavy
- long transaction

Better:

```sql
UPDATE cases
SET priority = 'HIGH'
WHERE status = 'OPEN'
  AND risk_score >= 80;
```

or batched bulk update.

Use ORM entity loop for small aggregate operations, not mass data processing.

---

## 34. `save()` Misconception

Spring Data `save(entity)` may:

- persist new entity
- merge detached entity
- trigger select
- overwrite fields
- return managed instance
- behave differently based on ID/version

Do not treat `save` as simple SQL `INSERT` or `UPDATE`.

For command updates, sometimes explicit SQL update is safer:

```sql
UPDATE cases
SET status = ?
WHERE id = ?
  AND status = ?
```

Especially for guarded transitions.

---

## 35. Repository Method Name Queries

Spring Data derived query:

```java
findByTenantIdAndStatusOrderByOpenedAtDesc(...)
```

Convenient, but:

- SQL shape hidden
- joins from nested property can surprise
- method names become huge
- optional filters awkward
- complex queries hard to optimize
- indexes still required
- count query for pagination can be expensive

Use for simple queries. Use explicit query for important ones.

---

## 36. Page vs Slice

Spring Data `Page` often executes count query.

```java
Page<CaseEntity> page = repository.findByStatus(status, pageable);
```

It may run:

```sql
SELECT ... LIMIT ...
SELECT COUNT(*) ...
```

Count can be expensive.

If you only need “has next”, use `Slice` or keyset pagination.

For huge datasets, avoid automatic count unless needed.

---

## 37. Count Query Pitfalls

Count with joins:

```sql
SELECT COUNT(*)
FROM cases c
LEFT JOIN evidences e ON ...
WHERE ...
```

Can be slow and semantically wrong due to multiplication.

Use:

```sql
COUNT(DISTINCT c.id)
```

if needed, but can be expensive.

Alternative:

- approximate count
- limited count
- no total count
- materialized summary
- separate optimized count query
- keyset pagination

---

## 38. Open Session in View

Open Session in View keeps persistence context open through web rendering.

Pros:

- avoids LazyInitializationException

Cons:

- lazy loading during serialization
- hidden SQL after service layer
- N+1 in JSON response
- connection may be held longer
- transaction boundary unclear
- performance unpredictable

For serious APIs, prefer:

- service-layer transaction
- DTO projection
- explicit fetch plan
- OSIV disabled or carefully controlled

---

## 39. JSON Serialization of Entities

Do not expose entities directly as JSON.

Problems:

- lazy loading
- infinite recursion
- sensitive fields exposed
- persistence annotations leak API design
- accidental column exposure
- bidirectional relationships
- performance unpredictable

Use DTOs.

Entity is persistence model, not API contract.

---

## 40. Caching in ORM

Hibernate caches:

- first-level cache: persistence context, always on
- second-level cache: optional shared cache
- query cache: optional

Second-level cache can help for reference data.

Risks:

- stale data
- invalidation complexity
- memory
- cluster consistency
- hides query problems
- wrong for high-churn data

Do not enable broad caching blindly.

Cache reference tables, not volatile case workflow data, unless carefully designed.

---

## 41. Dirty Checking Cost

Persistence context with many managed entities increases flush cost.

If processing many rows:

```java
for (...) {
    em.persist(entity);
}
```

Use batch pattern:

```java
if (i % batchSize == 0) {
    em.flush();
    em.clear();
}
```

Or use JDBC batch/bulk load.

Avoid long-lived persistence contexts with thousands of entities.

---

## 42. JDBC Batching with Hibernate

Hibernate can batch DML if configured:

```properties
hibernate.jdbc.batch_size=50
hibernate.order_inserts=true
hibernate.order_updates=true
```

Caveats:

- ID generation strategy can disable batching
- versioned updates need setting in some versions
- flush/clear required for large batch
- cascading can create unexpected order
- measure generated SQL

For huge bulk, JDBC/COPY/staging may still be better.

---

## 43. ID Generation Strategy

ORM ID generation impacts performance.

Common:

- database identity/auto increment
- sequence
- UUID generated by app
- pooled sequence optimizer
- hi/lo
- time-ordered UUID

Identity columns can require insert immediately to get ID, hurting batching in some ORM setups.

Sequence with allocation size can improve batching.

UUID random affects index locality depending DB.

Choose intentionally.

---

## 44. Equality and HashCode for Entities

Entity `equals/hashCode` is tricky.

Problems:

- ID null before persist
- proxy classes
- mutable business keys
- collection behavior
- detached entities

Bad equality can cause subtle bugs in sets/maps and relationships.

Use recommended patterns carefully.

Do not casually generate equals/hashCode over all fields/relationships.

---

## 45. Lazy Proxies and `getClass()`

Hibernate may use proxy subclass.

`entity.getClass()` may not equal actual class you expect.

This affects equals implementation.

Use framework-recommended approaches.

This is not SQL, but it affects persistence correctness.

---

## 46. Mapping Value Objects

Embeddables:

```java
@Embeddable
public class Money {
    BigDecimal amount;
    String currency;
}
```

Maps to columns:

```sql
amount NUMERIC(19,2)
currency CHAR(3)
```

Good for domain modelling.

But constraints still belong in DB too:

```sql
CHECK (amount >= 0)
FOREIGN KEY (currency) REFERENCES currencies(code)
```

Java validation is not enough.

---

## 47. Database Constraints Still Matter

Do not rely only on JPA annotations.

```java
@Column(nullable = false)
```

is not enough unless DB column is actually `NOT NULL`.

Bean validation:

```java
@NotNull
@Size(max = 100)
```

helps UX/app validation but does not protect database from:

- other writers
- bugs
- migrations
- direct SQL
- concurrent race

Always enforce critical invariants in database.

---

## 48. Schema Generation by ORM

Hibernate can generate schema:

```properties
hibernate.hbm2ddl.auto=update
```

Dangerous in production.

Prefer:

- Flyway
- Liquibase
- reviewed SQL migrations
- explicit constraints/indexes
- expand-contract changes

ORM-generated DDL often misses:

- partial indexes
- advanced constraints
- naming conventions
- data migrations
- online migration safety
- grants/RLS
- comments/documentation
- vendor-specific operations

Use ORM schema validation, not uncontrolled production mutation.

---

## 49. Migrations and ORM Mapping Drift

Mapping and schema must stay aligned.

Problems:

- column nullable in Java but NOT NULL in DB
- enum values mismatch
- column length mismatch
- relationship optional mismatch
- index missing for repository query
- generated column not mapped correctly
- trigger-updated column stale
- version column missing

Use integration tests and schema validation.

---

## 50. Query Plan Visibility

Always be able to see generated SQL.

Configure logs carefully:

- SQL text logging in dev/test
- bind values only if safe
- slow query logs in DB
- query comments
- Hibernate statistics
- datasource proxy tools
- APM instrumentation

Never optimize ORM query without seeing actual SQL and plan.

---

## 51. Hibernate Statistics

Hibernate can report:

- entity load count
- query execution count
- collection fetch count
- second-level cache hits/misses
- flush count

Useful for detecting N+1.

But DB slow query logs and execution plans still needed.

App-level stats show query count; DB-level stats show cost.

---

## 52. Tool Selection Matrix

| Use Case | JPA/Hibernate | jOOQ | MyBatis | JDBC |
|---|---:|---:|---:|---:|
| Simple CRUD | Good | Good | Good | Verbose |
| Aggregate command | Good | Possible | Possible | Verbose |
| Complex SQL | Weak/Native | Excellent | Good | Good |
| Dynamic search | Medium | Excellent | Good | Manual |
| Reporting | Weak | Excellent | Good | Good |
| Bulk import | Weak | Good | Good | Excellent |
| Vendor features | Native needed | Strong | Strong | Strong |
| Object lifecycle | Strong | Weak | Weak | Weak |
| Type-safe SQL | Weak | Strong | Medium | Weak |
| Full control | Medium | Strong | Strong | Strong |

No tool is best for all.

---

## 53. Recommended Hybrid Architecture

For complex Java systems:

```text
JPA/Hibernate:
  - aggregate writes
  - simple CRUD
  - optimistic locking
  - small object graphs

jOOQ/MyBatis/JDBC:
  - complex reads
  - reporting
  - bulk operations
  - performance-critical SQL
  - vendor-specific features

Flyway/Liquibase:
  - schema migrations
  - indexes
  - constraints
  - grants
  - database-side logic
```

The best teams are pragmatic.

---

## 54. Code Review Checklist for ORM Query

```text
[ ] What SQL is generated?
[ ] How many queries execute?
[ ] Any N+1?
[ ] Any unbounded collection?
[ ] Any eager relationship?
[ ] Is pagination applied correctly?
[ ] Does count query run?
[ ] Are selected columns minimal?
[ ] Is tenant filter present?
[ ] Are indexes supporting predicates/order?
[ ] Is transaction boundary short?
[ ] Are entities exposed to JSON?
[ ] Are bulk updates clearing persistence context?
[ ] Are constraints enforced in DB?
[ ] Are native fragments parameterized?
```

---

## 55. Practical Exercises

### Exercise 1 — Detect N+1

Given:

```java
List<CaseEntity> cases = repo.findOpenCases();
cases.forEach(c -> c.getNotes().size());
```

Explain generated SQL and propose:

- batch fetch
- DTO count query
- read model

### Exercise 2 — Fix Pagination with Fetch Join

Explain why fetch joining collection with pageable is risky and propose parent-ID page first.

### Exercise 3 — Choose Tool

For dashboard aggregation with window functions, choose jOOQ/native SQL over entity query.

### Exercise 4 — Bulk Update

Replace entity loop over 100k rows with SQL bulk update and explain persistence context caveat.

### Exercise 5 — Soft Delete

Explain why `@Where(deleted_at IS NULL)` is not enough without partial unique indexes and native query discipline.

---

## 56. Koneksi ke Part Berikutnya

Part ini membahas ORM and query builders.

Part berikutnya, `part-027`, akan membahas migrations and database change management:

- Flyway
- Liquibase
- schema versioning
- expand-contract
- zero-downtime migration
- backfill
- online index creation
- constraint validation
- rollback vs fix-forward
- data migration safety
- coordinating app and DB deploy

Setelah memahami Java data access abstraction, kita perlu memahami bagaimana schema berubah dengan aman.

---

## 57. Ringkasan Bagian Ini

Hal penting dari part 026:

1. ORM memetakan object lifecycle ke relational persistence, tetapi tidak menggantikan SQL.
2. JPA adalah specification; Hibernate adalah implementation.
3. Persistence context adalah identity map/unit of work.
4. Dirty checking membuat update implicit saat flush.
5. Lazy loading dapat menyebabkan N+1 dan hidden SQL.
6. Fetch join berguna tetapi berbahaya untuk collection pagination.
7. EAGER fetch default adalah anti-pattern untuk kebanyakan association.
8. DTO projection sering lebih baik untuk read/list API.
9. Entity cocok untuk aggregate writes; SQL projection/read model cocok untuk reads.
10. Cascade harus mengikuti ownership/lifecycle, bukan convenience.
11. `@Version` memberi optimistic locking.
12. Bulk JPQL bypass persistence context and lifecycle behavior.
13. Native SQL is valid if treated as first-class code.
14. jOOQ cocok untuk type-safe SQL-first development.
15. MyBatis cocok untuk explicit hand-written SQL mapping.
16. Query builders tetap membutuhkan SQL plan understanding.
17. ORM entity loop buruk untuk large bulk operations.
18. ORM-generated schema should not mutate production automatically.
19. Database constraints tetap wajib.
20. Mature systems often combine JPA for writes and SQL-first tools for complex reads/bulk/reporting.

Kalimat inti:

> Abstraction yang baik bukan menyembunyikan SQL dari engineer; abstraction yang baik membuat SQL yang benar, aman, dan terukur lebih mudah ditulis tanpa menghilangkan kemampuan membaca apa yang benar-benar terjadi.

---

## 58. Referensi

1. Jakarta Persistence Specification.  
   https://jakarta.ee/specifications/persistence/

2. Hibernate ORM Documentation.  
   https://hibernate.org/orm/documentation/

3. Hibernate User Guide.  
   https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html

4. Spring Data JPA Documentation.  
   https://docs.spring.io/spring-data/jpa/reference/

5. jOOQ Manual.  
   https://www.jooq.org/doc/latest/manual/

6. MyBatis Documentation.  
   https://mybatis.org/mybatis-3/

7. Vlad Mihalcea — High-Performance Java Persistence.  
   https://vladmihalcea.com/books/high-performance-java-persistence/

8. HikariCP Documentation.  
   https://github.com/brettwooldridge/HikariCP

9. Testcontainers Java Documentation.  
   https://java.testcontainers.org/

---

## 59. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`
- `learn-sql-mastery-for-java-engineers-part-005.md`
- `learn-sql-mastery-for-java-engineers-part-006.md`
- `learn-sql-mastery-for-java-engineers-part-007.md`
- `learn-sql-mastery-for-java-engineers-part-008.md`
- `learn-sql-mastery-for-java-engineers-part-009.md`
- `learn-sql-mastery-for-java-engineers-part-010.md`
- `learn-sql-mastery-for-java-engineers-part-011.md`
- `learn-sql-mastery-for-java-engineers-part-012.md`
- `learn-sql-mastery-for-java-engineers-part-013.md`
- `learn-sql-mastery-for-java-engineers-part-014.md`
- `learn-sql-mastery-for-java-engineers-part-015.md`
- `learn-sql-mastery-for-java-engineers-part-016.md`
- `learn-sql-mastery-for-java-engineers-part-017.md`
- `learn-sql-mastery-for-java-engineers-part-018.md`
- `learn-sql-mastery-for-java-engineers-part-019.md`
- `learn-sql-mastery-for-java-engineers-part-020.md`
- `learn-sql-mastery-for-java-engineers-part-021.md`
- `learn-sql-mastery-for-java-engineers-part-022.md`
- `learn-sql-mastery-for-java-engineers-part-023.md`
- `learn-sql-mastery-for-java-engineers-part-024.md`
- `learn-sql-mastery-for-java-engineers-part-025.md`
- `learn-sql-mastery-for-java-engineers-part-026.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-027.md` — Migrations and Database Change Management


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-025.md">⬅️ Part 25 — SQL from Java: JDBC, Connection Pools, Transactions, and Resource Safety</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-027.md">Part 27 — Migrations and Database Change Management ➡️</a>
</div>

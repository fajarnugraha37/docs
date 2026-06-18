# Part 33 — Production Failure Playbook: Symptoms, Root Causes, and Fix Patterns

> Series: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `33-production-failure-playbook-symptoms-root-causes-fix-patterns.md`  
> Scope: Java 8–25, JPA/Jakarta Persistence, Hibernate ORM, EclipseLink  
> Level: Advanced / production engineering

---

## 0. What This Part Is About

This part is a **production failure playbook** for systems that use JPA providers such as Hibernate ORM and EclipseLink.

The goal is not to memorize random ORM errors. The goal is to build an operational mental model:

```text
Symptom
  -> what is the system showing?

Evidence
  -> what facts must be collected?

ORM mechanism
  -> which persistence mechanism can create this symptom?

Root cause hypothesis
  -> what is likely wrong?

Safe mitigation
  -> what can reduce production impact now?

Permanent fix
  -> what design/code/data/schema change prevents recurrence?

Regression guard
  -> what test/metric/check ensures it does not come back?
```

A top-level engineer does not debug ORM by guessing annotations. They debug by connecting:

```text
API request
  -> transaction boundary
  -> persistence context scope
  -> entity graph loaded
  -> query plan/fetch plan
  -> flush behavior
  -> SQL shape
  -> database locks/indexes/constraints
  -> cache visibility
  -> observable symptom
```

---

## 1. Core Mental Model: ORM Failure Is Usually a State Synchronization Failure

Most production ORM issues are not “Hibernate bugs” or “JPA bugs”. They are failures in synchronizing state across several layers:

```text
HTTP/API state
  -> DTO/command state
  -> managed entity state
  -> persistence context snapshot
  -> SQL action queue
  -> database rows
  -> database indexes/constraints/locks
  -> second-level/shared cache
  -> other application nodes
  -> client-visible response
```

Each layer may contain a different version of “the truth”. Production failures happen when engineers assume these layers are always synchronized.

They are not.

### 1.1 The four dangerous assumptions

#### Assumption 1: “The Java object is the database row.”

False.

A managed entity is an in-memory representation of a database row inside a specific persistence context. It may be:

- not flushed yet,
- flushed but not committed,
- stale relative to another transaction,
- detached,
- partially initialized,
- loaded from second-level cache,
- modified but not detected,
- already scheduled for deletion.

#### Assumption 2: “Commit is when SQL happens.”

False.

SQL can happen before commit because of flush. With `FlushModeType.AUTO`, queries may trigger flush before execution if the result could be affected by pending changes.

```text
entity.setStatus(APPROVED)

execute query
  -> provider may flush pending update before query

commit later
```

So a read-looking code path can emit writes.

#### Assumption 3: “Cache improves correctness because data is reused.”

False.

Cache improves performance only when cache boundaries and invalidation semantics are correct. Otherwise, cache becomes a stale-data distribution system.

#### Assumption 4: “Repository methods are isolated.”

False.

Repositories are not isolated units when they run inside the same persistence context and transaction. One repository method can accidentally flush changes made by another earlier method in the same transaction.

---

## 2. The Minimum Evidence Package for Any ORM Production Incident

Before deciding the fix, collect evidence. Without evidence, you will likely “fix” the wrong layer.

### 2.1 Request-level evidence

Capture:

- endpoint/job name,
- correlation ID,
- user/tenant/agency context,
- request size,
- response time,
- response code,
- retry count,
- concurrent request volume,
- deployment version,
- feature flag state.

### 2.2 Transaction-level evidence

Capture:

- transaction boundary,
- transaction propagation,
- isolation level,
- read-only flag,
- timeout,
- number of database statements,
- commit/rollback result,
- rollback-only markers,
- connection acquisition time.

### 2.3 ORM-level evidence

Capture:

- generated SQL,
- bind parameter shape, with sensitive values redacted,
- number of entity loads,
- number of collection loads,
- flush count,
- dirty entity count,
- second-level cache hits/misses/puts,
- query cache hits/misses if enabled,
- batch size actually used,
- fetch strategy used,
- entity graph or query hints used,
- persistence context size if measurable.

### 2.4 Database-level evidence

Capture:

- execution plan,
- rows scanned,
- rows returned,
- index usage,
- wait events,
- lock waits,
- deadlock graph,
- active session history if available,
- top SQL by CPU/elapsed time,
- connection count,
- database CPU/memory/IO,
- undo/temp usage for Oracle-like systems,
- table/index/LOB segment growth if relevant.

### 2.5 Deployment/config evidence

Capture:

- provider version,
- database dialect,
- JDBC driver version,
- connection pool config,
- batch config,
- cache config,
- SQL logging config,
- schema migration version,
- recently changed mappings,
- recently changed query hints,
- recently changed indexes.

---

## 3. Failure Taxonomy

A useful taxonomy maps symptoms to ORM mechanisms.

```text
Performance failures
  - N+1
  - cartesian explosion
  - slow flush
  - excessive hydration
  - no batching
  - wrong pagination
  - connection starvation

Correctness failures
  - stale data
  - lost update
  - missing update
  - unexpected update
  - unexpected delete
  - duplicate rows
  - wrong tenant data
  - soft-deleted data visible

Availability failures
  - deadlock
  - lock timeout
  - transaction timeout
  - connection pool exhaustion
  - memory pressure / OOM
  - cache storm

Migration failures
  - provider behavior changed
  - dialect changed
  - namespace mismatch
  - query type mismatch
  - schema validation failure
  - batching/fetching regression
```

---

## 4. Symptom: Endpoint Is Slow

### 4.1 Typical signs

- P95/P99 latency increases.
- Database CPU may or may not increase.
- Application CPU may increase.
- Logs show many SQL statements for one request.
- Connection held for a long time.
- GC activity increases because many entities are hydrated.

### 4.2 First split: DB-bound or app-bound?

Ask:

```text
Is time spent mostly waiting for DB, or mostly inside the JVM?
```

#### DB-bound slow endpoint

Likely causes:

- missing index,
- bad query plan,
- too many round trips,
- lock wait,
- cartesian explosion,
- large sort/hash join,
- unbounded result set.

#### App-bound slow endpoint

Likely causes:

- huge hydration cost,
- dirty checking over large persistence context,
- JSON serialization triggers lazy loading,
- mapper walks large graph,
- second-level cache deserialization cost,
- equality/hashCode on large graph,
- excessive entity listeners.

### 4.3 ORM-specific root causes

#### Root cause A: N+1 query pattern

Pattern:

```java
List<CaseRecord> cases = em.createQuery("select c from CaseRecord c", CaseRecord.class)
    .getResultList();

for (CaseRecord c : cases) {
    c.getApplicant().getName(); // triggers one query per case
}
```

Observed SQL:

```sql
select * from case_record;
select * from applicant where id = ?;
select * from applicant where id = ?;
select * from applicant where id = ?;
...
```

Safe mitigation:

- Use targeted DTO projection for the endpoint.
- Add a join fetch for one-to-one/many-to-one relations if row multiplication is controlled.
- Use batch fetching for repeated lazy association loading.
- Use entity graph if provider behavior is tested.

Permanent fix:

- Define fetch plans per use case.
- Avoid returning managed entities directly to API serialization.
- Add SQL-count tests for critical reads.

Regression guard:

```text
For endpoint X with 50 cases:
  expected statement count <= 3
  expected rows hydrated <= bounded threshold
```

#### Root cause B: Cartesian explosion

Pattern:

```java
select c
from CaseRecord c
join fetch c.documents
join fetch c.comments
join fetch c.tasks
```

If one case has:

```text
10 documents
20 comments
5 tasks
```

The SQL may produce:

```text
10 × 20 × 5 = 1000 rows for one root case
```

Safe mitigation:

- Remove multiple collection join fetches.
- Fetch root IDs first.
- Fetch collections in separate bounded queries.
- Use batch/subselect fetching.
- Use DTO projection designed for the screen.

Permanent fix:

- Do not design “load whole aggregate for every screen”.
- Separate summary read models from editing aggregate models.

#### Root cause C: Persistence context too large

Pattern:

```java
@Transactional
public void processAll() {
    List<CaseRecord> all = repo.findAll();
    for (CaseRecord c : all) {
        c.recalculateRisk();
    }
}
```

Problems:

- All entities remain managed.
- Dirty checking scans many entities.
- Flush becomes expensive.
- Memory grows.

Safe mitigation:

```java
int count = 0;
for (CaseRecord c : streamOrPage()) {
    c.recalculateRisk();
    if (++count % 500 == 0) {
        em.flush();
        em.clear();
    }
}
```

Permanent fix:

- Use paged processing.
- Use bulk update where entity lifecycle is not needed.
- Use provider stateless/batch APIs where appropriate.
- Separate OLTP persistence context from batch mutation pipeline.

---

## 5. Symptom: Database CPU Is High

### 5.1 Typical signs

- DB CPU near saturation.
- Application may look “normal”.
- Top SQL shows many similar statements.
- Query count increases with row count.
- Execution plans show repeated index lookups or full scans.

### 5.2 ORM root causes

#### Root cause A: Query-per-row

This is the N+1 variant from the database perspective.

Evidence:

```text
same SQL executed thousands of times per minute
bind value differs
```

Fix:

- Batch fetch.
- Join fetch controlled associations.
- Use `where id in (...)` strategy.
- Preload reference data.
- Cache immutable reference data safely.

#### Root cause B: Implicit joins in JPQL/HQL

Example:

```jpql
select c
from CaseRecord c
where c.applicant.address.postalCode = :postalCode
```

This may generate joins across applicant and address tables. If not indexed properly, DB CPU increases.

Fix:

- Inspect generated SQL.
- Add indexes matching actual generated predicates.
- Consider explicit join for readability.
- Consider denormalized read model for common search screens.

#### Root cause C: Unbounded query through repository abstraction

Example:

```java
List<AuditTrail> findByModuleId(Long moduleId);
```

If `moduleId` has millions of rows, this is a production incident waiting to happen.

Fix:

- Enforce pagination.
- Add hard limits.
- Use keyset pagination for deep scroll.
- Use projection rather than entity hydration.

#### Root cause D: Dirty flush before query

A read query triggers flush. DB CPU is attributed to a read endpoint, but the actual work is update/delete/insert.

Evidence:

```text
Endpoint: GET /cases/search
SQL observed before SELECT:
  update case_record set ...
  insert into audit_trail ...
```

Fix:

- Separate read transaction from mutation transaction.
- Avoid mutating managed entities in read paths.
- Use read-only queries where provider supports optimization.
- Use DTO queries.
- Move side-effectful enrichment out of read path.

---

## 6. Symptom: Application CPU Is High

### 6.1 Typical signs

- DB not saturated.
- JVM CPU high.
- GC may increase.
- Thread dumps show serialization, mapping, dirty checking, entity listeners, or proxy initialization.

### 6.2 ORM root causes

#### Root cause A: Hydration flood

A query returns too many rows/entities.

Example:

```java
select c from CaseRecord c join fetch c.documents
```

Each database row becomes:

- entity lookup in persistence context,
- object allocation if not already loaded,
- collection wrapper operation,
- snapshot creation,
- association fix-up.

Fix:

- Use DTO projection for read-only screens.
- Limit result size.
- Fetch only required columns.
- Avoid entity loading for export/report where lifecycle is irrelevant.

#### Root cause B: Dirty checking scans too much

Dirty checking cost is roughly affected by:

```text
managed entity count × mapped property count × mutable collection complexity
```

Fix:

- Keep persistence context small.
- Flush and clear during batch jobs.
- Use read-only query/session hints where safe.
- Use bytecode enhancement/attribute tracking if it fits provider strategy.

#### Root cause C: Serialization triggers lazy loading

Example:

```java
return caseRepository.findById(id).orElseThrow();
```

JSON serializer accesses getters:

```text
case.applicant
case.documents
case.comments
case.tasks
case.auditTrail
```

Fix:

- Do not expose entities directly as API response.
- Map to DTO inside transaction with explicit fetch plan.
- Disable dangerous serializer behavior that walks lazy associations.
- Add tests for API response SQL count.

---

## 7. Symptom: Memory Pressure or OutOfMemoryError

### 7.1 Typical signs

- Heap grows during batch job/export/report.
- GC pauses increase.
- Persistence context contains many managed entities.
- Collections or LOB fields consume memory.
- Endpoint with large result set causes OOM.

### 7.2 ORM root causes

#### Root cause A: Large persistence context

Every managed entity may have:

- entity instance,
- snapshot state,
- collection wrappers,
- association references,
- proxy references,
- provider metadata overhead.

Fix:

```java
for (int page = 0; ; page++) {
    List<CaseRecord> batch = findPage(page, 500);
    if (batch.isEmpty()) break;

    for (CaseRecord c : batch) {
        process(c);
    }

    em.flush();
    em.clear();
}
```

For read-only export:

- prefer streaming/scrolled query if supported,
- use DTO/tuple/native query,
- avoid managed entity graph hydration,
- use fetch size carefully.

#### Root cause B: LOB loaded into memory

Mapping CLOB/BLOB as `String` or `byte[]` may load entire content into heap.

Fix:

- Do not include LOB field in common entity fetch if not needed.
- Split LOB into separate table/entity.
- Use projection excluding LOB.
- Stream LOB with JDBC/native approach when necessary.

#### Root cause C: Bidirectional graph retained accidentally

A parent references children and children reference parent. Loading one root can retain a huge graph.

Fix:

- Design smaller aggregate boundaries.
- Do not use entity graph as API graph.
- Use DTO boundary.
- Clear persistence context after batch.

---

## 8. Symptom: Connection Pool Exhausted

### 8.1 Typical signs

- Threads wait for database connections.
- Pool active count equals max.
- Database session count high.
- Slow queries may be present but not always.
- Requests time out while waiting for connection.

### 8.2 ORM root causes

#### Root cause A: Long transaction holds connection

The persistence context may be open longer than necessary. Depending on provider/framework and connection handling mode, a connection may be held while app code does non-DB work.

Bad pattern:

```java
@Transactional
public void approveCase(Long id) {
    CaseRecord c = repo.findById(id).orElseThrow();
    externalSystem.call();       // slow network call inside transaction
    c.approve();
}
```

Fix:

- Do not call external systems inside DB transaction unless absolutely necessary.
- Use outbox pattern.
- Split transaction:
  - load/validate,
  - call external system outside transaction if safe,
  - persist result in short transaction,
  - or persist intent then async dispatch.

#### Root cause B: OSIV keeps session open across web rendering/serialization

Open Session in View can defer lazy loading into response serialization. This can extend persistence access beyond service boundary.

Fix:

- Disable OSIV for APIs where possible.
- Use DTOs and explicit fetch plans.
- Make service layer own all persistence access.

#### Root cause C: Too many small queries

Even if each query is fast, thousands of round trips hold connections long enough to saturate pool.

Fix:

- Fix N+1.
- Reduce round trips.
- Batch fetch.
- Use projection.

#### Root cause D: Transaction timeout longer than pool timeout

Long DB waits accumulate.

Fix:

- Align transaction timeout, query timeout, pool timeout, and web request timeout.
- Add fail-fast limits.
- Set query timeout for risky operations.

---

## 9. Symptom: Deadlock or Lock Timeout

### 9.1 Typical signs

- Database reports deadlock graph.
- Some transactions rollback unexpectedly.
- Same tables appear repeatedly.
- Incident appears only under concurrency.

### 9.2 ORM-specific causes

#### Root cause A: Inconsistent update order

Two transactions update the same tables in different orders.

```text
Transaction A:
  update case_record
  update task_assignment

Transaction B:
  update task_assignment
  update case_record
```

Fix:

- Standardize lock/update order.
- Load and lock aggregate roots first.
- Configure provider ordering for inserts/updates where useful.
- Reduce transaction scope.

#### Root cause B: Cascade delete touches many rows

A delete of parent cascades through many associations. Different transactions delete/update related rows concurrently.

Fix:

- Avoid large synchronous cascade delete.
- Use soft delete plus async purge.
- Delete in deterministic batches.
- Use database-level cascade only when semantics and locks are understood.

#### Root cause C: Pessimistic locks used too broadly

Example:

```java
em.find(CaseRecord.class, id, LockModeType.PESSIMISTIC_WRITE);
```

Then code performs slow validation, remote call, or user-dependent operation.

Fix:

- Use optimistic locking by default for user workflows.
- Use pessimistic lock only for short critical sections.
- Add lock timeout.
- Avoid remote call while holding DB lock.

#### Root cause D: Flush timing creates unexpected lock acquisition

A query triggers flush and acquires locks earlier than expected.

Fix:

- Explicitly flush at controlled point if required.
- Separate mutation and read queries.
- Understand `AUTO` flush behavior.

---

## 10. Symptom: Stale Data Returned

### 10.1 Typical signs

- User updates data but sees old value.
- One node sees new value, another node sees old value.
- Data correct in DB but wrong in API response.
- Bug disappears after restart or cache clear.

### 10.2 Root causes

#### Root cause A: First-level cache stale inside long persistence context

If an entity is already managed, `find()` returns the existing managed instance, not necessarily the latest DB row.

Fix:

- Keep transaction/persistence context short.
- Use `refresh()` when truly needed.
- Avoid long extended persistence context for volatile data.

#### Root cause B: Second-level/shared cache stale

Cache region may return old entity state.

Fix:

- Disable cache for volatile entities.
- Use correct cache concurrency strategy.
- Evict region after bulk/native mutation.
- Validate cluster cache invalidation.

#### Root cause C: Bulk update bypassed persistence context/cache

JPQL bulk update/delete operates directly against the database and bypasses managed entity state.

Example:

```java
em.createQuery("update CaseRecord c set c.status = 'CLOSED' where c.expired = true")
  .executeUpdate();
```

Managed entities in the same persistence context may still show old values.

Fix:

```java
int updated = query.executeUpdate();
em.clear();
```

Also evict second-level cache regions if needed.

#### Root cause D: Read replica lag

Not strictly ORM, but often blamed on ORM.

Fix:

- Route read-after-write to primary.
- Use consistency token/version check.
- Avoid showing stale critical state from replica.

---

## 11. Symptom: Lost Update or Stale Overwrite

### 11.1 Typical signs

- User A changes field X.
- User B changes field Y.
- User A's field is reverted or overwritten.
- No exception is thrown.

### 11.2 Root causes

#### Root cause A: Missing `@Version`

Without optimistic versioning, last commit often wins.

Fix:

```java
@Version
private long version;
```

Then handle optimistic conflict explicitly.

#### Root cause B: Detached entity merge from stale screen

Bad pattern:

```java
@PostMapping("/cases/{id}")
@Transactional
public void update(@RequestBody CaseRecord entity) {
    em.merge(entity);
}
```

This copies stale detached state into a managed instance.

Fix:

```java
@Transactional
public void updateCase(UpdateCaseCommand cmd) {
    CaseRecord managed = em.find(CaseRecord.class, cmd.id(), LockModeType.OPTIMISTIC);
    managed.changeSummary(cmd.summary());
    managed.changePriority(cmd.priority());
}
```

Permanent fix:

- Use DTO/command input.
- Load managed aggregate.
- Apply explicit domain operation.
- Use version in request.
- Reject stale version.

#### Root cause C: Bulk update ignores version

Bulk update may not increment/check entity version unless explicitly handled provider-specifically.

Fix:

- Avoid bulk update for versioned business-critical rows unless version policy is explicit.
- Add version predicate/increment manually where appropriate.
- Clear persistence context/cache after bulk operation.

---

## 12. Symptom: Missing Update

### 12.1 Typical signs

- Java object was changed.
- No SQL update emitted.
- Transaction committed successfully.
- Database value unchanged.

### 12.2 Root causes

#### Root cause A: Entity is detached

Changing detached entity does nothing unless merged or reloaded and changed while managed.

Bad pattern:

```java
CaseRecord c = service.loadCase(id); // transaction ended, detached
c.approve();                         // no active persistence context
```

Fix:

```java
@Transactional
public void approve(Long id) {
    CaseRecord c = em.find(CaseRecord.class, id);
    c.approve();
}
```

#### Root cause B: Wrong side of bidirectional association updated

Only owning side controls FK/join table.

Bad pattern:

```java
caseRecord.getDocuments().add(doc); // inverse side only, if mappedBy owns elsewhere
```

Fix:

```java
public void addDocument(Document doc) {
    documents.add(doc);
    doc.setCaseRecord(this); // owning side
}
```

#### Root cause C: Access strategy mismatch

Annotations on fields vs getters define provider access. If mixed incorrectly, provider may not see expected state.

Fix:

- Use consistent field or property access.
- Avoid accidental annotation on getter in field-access entity.
- Add mapping tests.

#### Root cause D: Mutable object mutation not detected

Example: custom mutable value type or poorly mapped converter.

Fix:

- Use immutable value objects.
- Replace value object instead of mutating internals.
- Implement provider-specific mutability plan/custom type correctly if needed.

---

## 13. Symptom: Unexpected Update

### 13.1 Typical signs

- SQL update emitted although business code “only read”.
- Update sets same values.
- Audit fields change unexpectedly.
- Version increments unexpectedly.

### 13.2 Root causes

#### Root cause A: Setter normalizes value during read path

Example:

```java
public String getName() {
    if (name != null) {
        name = name.trim(); // mutation inside getter: dangerous
    }
    return name;
}
```

Fix:

- Getters must not mutate persistent state.
- Normalize at write boundary.
- Use converter carefully if normalization is persistence-level concern.

#### Root cause B: Audit listener updates fields on flush

Example:

```java
@PreUpdate
void preUpdate() {
    updatedAt = Instant.now();
}
```

This is correct only if entity is truly dirty. But broken dirty detection or accidental mutation can trigger it.

Fix:

- Identify original dirty trigger.
- Avoid broad mutation in listeners.
- Add SQL diff logs in staging.

#### Root cause C: Collection wrapper marked dirty

Replacing a managed collection instance can cause delete/reinsert or unexpected update.

Bad pattern:

```java
entity.setChildren(new ArrayList<>(incomingChildren));
```

Fix:

```java
entity.syncChildren(incomingChildren); // add/remove targeted changes
```

#### Root cause D: BigDecimal scale/date precision mismatch

Provider compares Java value with snapshot. Database normalizes value differently.

Example:

```text
Java: 10.0
DB:   10.00
```

Fix:

- Normalize scale before persistence.
- Use correct column precision/scale.
- Avoid repeatedly setting semantically equal but structurally different values.

---

## 14. Symptom: Unexpected Delete

### 14.1 Typical signs

- Child rows disappear.
- Join table rows disappear.
- Shared reference data deleted.
- Delete occurs after collection replacement.

### 14.2 Root causes

#### Root cause A: `CascadeType.REMOVE` across shared entity

Bad pattern:

```java
@ManyToOne(cascade = CascadeType.REMOVE)
private Agency agency;
```

Deleting one case may delete shared agency.

Fix:

- Do not cascade remove across aggregate boundary.
- Cascade remove only to privately owned children.

#### Root cause B: `orphanRemoval = true` with collection replacement

If child is removed from collection, ORM schedules delete.

Fix:

- Use explicit domain methods.
- Differentiate “remove association” from “delete entity”.
- Avoid blindly replacing collection from DTO.

#### Root cause C: Merge of partial detached graph

Incoming JSON lacks children. Merge interprets missing collection as empty/null depending on mapping and state.

Fix:

- Never merge API entity graph directly.
- Use command DTO and managed aggregate.
- Apply targeted changes.

---

## 15. Symptom: Duplicate Rows

### 15.1 Typical signs

- Duplicate child rows.
- Duplicate join table rows.
- Same business object inserted twice.
- Unique constraint violation under concurrency.

### 15.2 Root causes

#### Root cause A: Bad `equals/hashCode` in `Set`

If entity equality changes after ID assignment, `Set` behavior breaks.

Fix:

- Use stable natural key only if truly immutable and unique.
- Or use conservative equality based on non-null ID with care.
- Avoid relying on Set to enforce database uniqueness.
- Add database unique constraint.

#### Root cause B: No unique constraint for business key

ORM cannot protect uniqueness under concurrency without DB constraint.

Fix:

```sql
alter table case_assignment
add constraint uk_case_user_role unique (case_id, user_id, role_code);
```

Then handle constraint violation or use application-level optimistic locking.

#### Root cause C: Both sides of association manipulated inconsistently

Fix:

- Create helper methods.
- Make association mutation one-directional in domain API.
- Hide raw collection setters.

#### Root cause D: Retry after unknown commit result

If request times out after DB commit but before client response, retry may insert again.

Fix:

- Use idempotency key.
- Use natural unique request reference.
- Make create operation idempotent.

---

## 16. Symptom: Constraint Violation at Unexpected Time

### 16.1 Typical signs

- Constraint violation happens during query, not commit.
- Stack trace points to `getResultList()`.
- Developer says “but I was only reading”.

### 16.2 Root cause: Auto flush before query

Provider flushes pending changes before query execution.

Example:

```java
caseRecord.setStatus(null); // invalid

// This query may trigger flush first
List<Task> tasks = em.createQuery("select t from Task t", Task.class).getResultList();
```

Fix:

- Maintain valid entity state inside transaction.
- Do not temporarily put managed entities into invalid states.
- Use local variables/command objects for intermediate invalid state.
- Flush intentionally at known checkpoints.

---

## 17. Symptom: LazyInitializationException / Detached Lazy Loading Failure

### 17.1 Typical signs

- Works inside service, fails in controller/serializer.
- Happens after transaction ended.
- Common with Hibernate proxies and lazy collections.

### 17.2 Root causes

#### Root cause A: Access lazy association outside persistence context

Fix:

- Fetch required data inside service transaction.
- Return DTO, not entity.
- Use entity graph/join fetch/batch fetch intentionally.

#### Root cause B: OSIV disabled without DTO discipline

Disabling OSIV is often correct, but code must stop relying on lazy loading in web layer.

Fix:

- Make service return response model already materialized.
- Add tests that controller serialization does not touch DB.

---

## 18. Symptom: Query Pagination Is Wrong or Slow

### 18.1 Typical signs

- Duplicate root rows.
- Missing rows between pages.
- Slow deep pages.
- Warning about pagination with collection fetch.

### 18.2 Root causes

#### Root cause A: Pagination over collection join fetch

SQL pagination applies to rows, not logical root entities.

Fix:

Two-phase pagination:

```text
1. select root IDs with pagination
2. fetch required graph for those IDs
3. preserve order in application or SQL
```

#### Root cause B: Offset pagination for deep pages

Database scans/skips many rows.

Fix:

- Use keyset pagination.
- Use stable ordering with indexed columns.
- Avoid arbitrary deep page access for operational screens.

#### Root cause C: Non-deterministic order

Pagination without stable order is incorrect.

Fix:

```sql
order by created_at desc, id desc
```

---

## 19. Symptom: Batch Job Is Too Slow

### 19.1 Typical signs

- Millions of individual inserts/updates.
- JDBC batching not happening.
- Memory grows.
- Flush takes longer over time.

### 19.2 Root causes

#### Root cause A: IDENTITY generation disables or reduces insert batching

Depending on provider/database behavior, identity key generation may require immediate insert to get generated key.

Fix:

- Use sequence-based identifiers where supported.
- Use pooled sequence optimizer/provider strategy.
- Benchmark actual generated SQL.

#### Root cause B: No flush/clear loop

Fix:

```java
for (int i = 0; i < items.size(); i++) {
    em.persist(items.get(i));

    if (i % 500 == 0) {
        em.flush();
        em.clear();
    }
}
```

#### Root cause C: Entity lifecycle used where bulk SQL is enough

Fix:

- Use JPQL bulk update/delete for simple set-based mutation.
- Use native SQL for complex high-volume transformation.
- Use provider stateless/batch API where appropriate.
- Remember bulk operations bypass persistence context/listeners/version unless explicitly handled.

---

## 20. Symptom: Cache Stampede or Cache-Induced Incident

### 20.1 Typical signs

- Cache hit ratio drops suddenly.
- DB load spikes after deployment/restart/eviction.
- Many nodes reload same reference data.
- Stale data appears after bulk/native update.

### 20.2 Root causes

#### Root cause A: Caching volatile data

Fix:

- Cache only stable, read-mostly data.
- Avoid L2 cache for frequently updated workflow entities.
- Use short TTL or no cache where correctness is critical.

#### Root cause B: Query cache misuse

Query cache can cache result identifiers, but entity state still interacts with entity regions. Invalidations can become expensive.

Fix:

- Use query cache only for stable queries.
- Prefer application-specific cache for reference lookup if semantics are clearer.
- Monitor hit/miss/put/eviction.

#### Root cause C: Native/bulk update bypasses cache invalidation

Fix:

- Evict affected entity/collection regions after bulk/native mutation.
- Avoid mixing cached entity state with external table updates without an invalidation plan.

---

## 21. Symptom: Wrong Tenant or Unauthorized Data Visible

### 21.1 Typical signs

- User sees another tenant/agency/customer data.
- Only happens on some endpoints.
- Native query/report/export bypasses filter.
- Cache returns entity loaded under another tenant.

### 21.2 Root causes

#### Root cause A: Tenant filter not applied consistently

Fix:

- Enforce tenant predicate at repository/query infrastructure level.
- Add integration tests for every query type:
  - JPQL,
  - Criteria,
  - native,
  - projections,
  - count queries,
  - export queries.

#### Root cause B: L2 cache key not tenant-safe

Fix:

- Validate provider cache behavior under tenant mode.
- Disable shared cache for tenant-scoped mutable entities if unsure.
- Include tenant in natural IDs/business keys.

#### Root cause C: Soft delete filter bypassed

Fix:

- Prefer database view/RLS for hard security boundaries.
- Treat ORM filters as convenience, not sole enforcement.
- Test native queries separately.

---

## 22. Symptom: Production Works Until Provider Upgrade

### 22.1 Typical signs

- Same code behaves differently after Hibernate/EclipseLink upgrade.
- Generated SQL changes.
- Query fails parsing/type validation.
- Dialect behavior changes.
- Cache/fetch/batch behavior changes.

### 22.2 Root causes

#### Root cause A: Depending on provider-specific behavior accidentally

Fix:

- Inventory provider extensions.
- Add generated SQL snapshot tests for critical queries.
- Add performance regression tests.
- Read migration guide before upgrade.

#### Root cause B: `javax`/`jakarta` mixed dependency graph

Fix:

- Use dependency tree enforcement.
- Ban old APIs with build rules.
- Align framework, provider, application server, and API versions.

#### Root cause C: Dialect changed

Fix:

- Explicitly validate dialect selection.
- Compare SQL before/after migration.
- Run DB-specific integration tests.

---

## 23. Symptom-to-Root-Cause Matrix

| Symptom | Likely ORM Mechanism | Evidence | Safe Mitigation | Permanent Fix |
|---|---|---|---|---|
| Slow endpoint | N+1 | many repeated selects | join/batch fetch | use-case fetch plan + SQL count tests |
| Slow endpoint | cartesian explosion | huge row count, duplicate roots | split fetch | DTO/read model |
| DB CPU high | query-per-row | top SQL repeated | batch fetch | query/fetch redesign |
| App CPU high | hydration flood | many entities loaded | projection | read model boundary |
| Memory high | large persistence context | heap grows with rows | flush/clear | batch architecture |
| Connection exhausted | long transaction | connections held long | reduce transaction scope | outbox/short transaction design |
| Deadlock | inconsistent update order | deadlock graph | retry + reduce scope | deterministic lock order |
| Stale data | L1/L2 cache | DB correct, app old | refresh/evict | cache policy redesign |
| Lost update | missing version | no optimistic exception | add version | command-based update |
| Missing update | detached mutation | no SQL update | mutate managed entity | service boundary discipline |
| Unexpected update | accidental mutation | update in read path | remove mutation | immutable/read-only model |
| Unexpected delete | cascade/orphan | delete SQL after merge | disable dangerous cascade | aggregate boundary fix |
| Duplicate rows | no unique constraint | duplicate business key | add constraint | idempotency + invariant |
| Wrong tenant data | filter/cache leak | tenant predicate missing | disable cache/filter endpoint | DB RLS/tenant enforcement |

---

## 24. Production Triage Flow

### 24.1 Slow endpoint flow

```text
1. Identify endpoint/job/correlation ID.
2. Count SQL statements per request.
3. Identify top repeated SQL.
4. Check row count returned vs expected root objects.
5. Check flush before query.
6. Check transaction duration and connection hold time.
7. Check persistence context size.
8. Check DB execution plan.
9. Apply smallest safe mitigation.
10. Add regression test/metric.
```

### 24.2 Stale data flow

```text
1. Verify DB value directly.
2. Check if entity already managed in persistence context.
3. Check transaction/persistence context length.
4. Check L2/shared cache region.
5. Check bulk/native update bypass.
6. Check replica lag.
7. Evict/refresh only as mitigation.
8. Redesign cache/transaction boundary permanently.
```

### 24.3 Deadlock flow

```text
1. Get database deadlock graph.
2. Map SQL statements to Java call path.
3. Identify entity/table update order.
4. Identify cascade-induced statements.
5. Check flush trigger timing.
6. Reduce transaction scope.
7. Standardize lock order.
8. Add retry only for safe idempotent operations.
```

### 24.4 Missing/unexpected update flow

```text
1. Was entity managed at mutation time?
2. Did dirty checking detect change?
3. Is access strategy correct?
4. Was mutation on owning side?
5. Did flush happen?
6. Did transaction commit?
7. Was update overwritten later?
8. Add integration test around SQL emitted.
```

---

## 25. Safe Mitigation vs Permanent Fix

Production incident response must separate mitigation from fix.

### 25.1 Safe mitigation examples

| Incident | Safe mitigation |
|---|---|
| N+1 overload | add targeted fetch/batch config for hot endpoint |
| cache stale | evict cache region or disable cache temporarily |
| connection exhaustion | reduce timeout, disable expensive endpoint, scale pool carefully |
| deadlock | add retry for idempotent transaction, reduce concurrency temporarily |
| batch OOM | reduce page size, add flush/clear, pause job |
| wrong tenant risk | disable endpoint/export until predicate verified |

### 25.2 Dangerous “fixes”

| Dangerous fix | Why dangerous |
|---|---|
| Increase connection pool blindly | can overload DB harder |
| Add EAGER fetching | global performance tax |
| Add join fetch everywhere | cartesian explosion |
| Enable second-level cache broadly | stale/cross-tenant risk |
| Use `merge()` for API updates | stale overwrite/mass assignment |
| Turn on `ddl-auto=update` in prod | uncontrolled schema drift |
| Add pessimistic locks broadly | deadlock/throughput collapse |
| Catch and ignore optimistic lock exception | hides lost update |

---

## 26. Incident Postmortem Template for ORM Failures

```md
# ORM Incident Postmortem

## 1. Summary
- Incident date/time:
- Affected service/module:
- User-visible impact:
- Duration:
- Severity:

## 2. Trigger
- Deployment/config/data change:
- Traffic pattern:
- Batch/job:
- External dependency:

## 3. Symptoms
- API latency:
- Error rate:
- DB CPU/IO:
- Connection pool:
- Memory/GC:
- Lock/deadlock:

## 4. Evidence
- Correlation IDs:
- Generated SQL:
- Statement counts:
- Execution plan:
- ORM statistics:
- Cache stats:
- Thread dumps:
- DB wait events:

## 5. Root Cause
- ORM mechanism:
- Mapping/query/fetch/transaction/cache issue:
- Why existing tests did not catch it:

## 6. Mitigation Applied
- What was changed immediately:
- Risk of mitigation:
- Validation performed:

## 7. Permanent Fix
- Code change:
- Mapping change:
- Query/fetch plan change:
- Schema/index change:
- Cache/transaction change:

## 8. Regression Guards
- Integration test:
- SQL count test:
- Concurrency test:
- Performance test:
- Dashboard/alert:

## 9. Lessons
- Design rule added:
- Review checklist updated:
- Documentation updated:
```

---

## 27. Provider-Specific Diagnostic Hooks

### 27.1 Hibernate-oriented hooks

Useful capabilities:

- SQL logging,
- bind parameter logging with redaction discipline,
- Hibernate statistics,
- statement inspection,
- slow query logging through DB or datasource/proxy,
- second-level cache stats,
- session metrics,
- generated SQL comparison before/after upgrade.

Common Hibernate-specific failure hints:

```text
LazyInitializationException
  -> lazy association accessed outside session

MultipleBagFetchException
  -> multiple bag collections join-fetched

NonUniqueObjectException
  -> two objects with same entity identity in same session

StaleObjectStateException / OptimisticLockException
  -> optimistic concurrency conflict

TransientObjectException
  -> unsaved transient association referenced
```

### 27.2 EclipseLink-oriented hooks

Useful capabilities:

- EclipseLink logging levels,
- query hints,
- performance profiler,
- shared cache controls,
- weaving diagnostics,
- descriptor/session customization review,
- fetch group/batch reading inspection.

Common EclipseLink-specific failure hints:

```text
Weaving disabled unexpectedly
  -> lazy/basic/change tracking/fetch group behavior may differ

Shared cache stale data
  -> descriptor/cache isolation policy issue

Descriptor customization bug
  -> provider mapping differs from annotation expectation

Existence checking surprise
  -> merge/persist behavior differs from Hibernate assumptions
```

---

## 28. Design Rules for Production-Grade ORM Systems

### Rule 1: Every critical read endpoint needs an explicit fetch plan

Do not let serializer, UI shape, or random lazy access define database workload.

### Rule 2: Every critical write endpoint needs an explicit mutation model

Do not merge API request bodies into entities.

### Rule 3: Every mutable business aggregate needs a version strategy

Use optimistic locking unless you have a strong reason not to.

### Rule 4: Every batch job must control persistence context size

No unbounded managed entity accumulation.

### Rule 5: Every cache region must have a correctness story

If you cannot explain invalidation, do not cache it.

### Rule 6: Every provider upgrade must compare generated SQL

Compilation success is not migration success.

### Rule 7: Every multi-tenant/soft-delete rule must be tested against native queries

ORM filters do not automatically protect every SQL path.

### Rule 8: Every production incident must produce a regression guard

A fix without a guard is just a temporary hope.

---

## 29. Practice Scenarios

### Scenario 1: Slow case listing

A case listing endpoint returns 50 cases. It now takes 8 seconds. Logs show 1 query for cases and 150 queries for applicant, task, and latest comment.

Questions:

1. What is the symptom category?
2. What evidence confirms the root cause?
3. Should you use join fetch for all associations?
4. What is the safest fix?
5. What regression test should be added?

Expected direction:

- N+1.
- Use DTO/listing projection or controlled fetch plan.
- Avoid fetching multiple collections in one query.
- Add SQL count test.

### Scenario 2: User update overwrites another field

Two users edit the same case. User A changes priority. User B changes remarks from an old screen. Priority reverts.

Expected direction:

- Lost update/stale overwrite.
- Add `@Version`.
- Stop merging detached request body.
- Use command DTO and managed aggregate mutation.

### Scenario 3: Batch job OOM

Nightly recalculation loads 2 million rows using `findAll()` and updates each entity.

Expected direction:

- Large persistence context.
- Page/stream in chunks.
- Flush/clear.
- Consider bulk SQL/stateless processing.
- Add memory and flush-time metrics.

### Scenario 4: Wrong tenant data in export

Normal UI is fine, but CSV export includes rows from another tenant.

Expected direction:

- Native query/filter bypass.
- Add tenant predicate to native SQL.
- Consider DB row-level security.
- Add cross-tenant integration tests.

### Scenario 5: Constraint violation during search

A GET search endpoint fails with not-null constraint violation. Stack trace points to query execution.

Expected direction:

- Auto flush before query.
- Read endpoint mutated managed entity earlier.
- Separate mutation from read.
- Maintain valid state inside persistence context.

---

## 30. Checklist Before Declaring an ORM Incident Resolved

```text
[ ] We identified the exact generated SQL involved.
[ ] We mapped SQL to Java call path.
[ ] We know whether flush happened and why.
[ ] We know persistence context size/scope.
[ ] We checked transaction boundary and connection hold time.
[ ] We checked fetch plan and row multiplication.
[ ] We checked cache involvement.
[ ] We checked locking/deadlock evidence if concurrency-related.
[ ] We checked native/bulk query bypass if stale/security-related.
[ ] We applied a safe mitigation.
[ ] We implemented permanent fix.
[ ] We added regression guard.
[ ] We documented the design rule learned.
```

---

## 31. Summary

Production ORM failures are rarely isolated annotation mistakes. They are usually caused by a mismatch between:

- the object graph the application thinks it is using,
- the SQL workload the provider actually emits,
- the transaction boundary where state becomes durable,
- the cache boundary where state may become stale,
- the database constraints/locks/indexes that enforce reality.

The advanced engineer debugs ORM through evidence:

```text
symptom -> SQL -> persistence context -> transaction -> mapping/fetch/cache -> root cause
```

The strongest production habits are:

1. Keep persistence contexts bounded.
2. Make fetch plans explicit.
3. Use DTO/command boundaries.
4. Use optimistic versioning for mutable aggregates.
5. Treat cache as a correctness risk first, performance tool second.
6. Never trust provider upgrades without SQL/performance regression tests.
7. Turn every incident into a test, metric, or design rule.

At this stage of the series, you should be able to diagnose most ORM production failures not by guessing, but by tracing the synchronization path from Java object state to database state.

---

## 32. References

Primary references for further reading:

- Jakarta Persistence 3.2 specification and API documentation.
- Hibernate ORM official User Guide and Hibernate ORM documentation page.
- Hibernate ORM 7 short guide and migration documentation.
- EclipseLink official JPA extensions, weaving, query hints, cache, and profiler documentation.
- Database vendor documentation for locks, execution plans, wait events, indexing, and transaction isolation.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 32 — Migration Engineering: Javax to Jakarta, Hibernate 5 to 6/7, EclipseLink 2 to 4/5](./32-migration-engineering-javax-jakarta-hibernate-eclipselink.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 34 — Capstone: Designing a Production-Grade Persistence Layer for Complex Case Management](./34-capstone-production-grade-persistence-layer-complex-case-management.md)

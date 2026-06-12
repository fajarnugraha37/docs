# learn-jaxrs-advanced-part-032.md

# Bagian 032 — Transactions, Persistence, and REST Boundary: JPA Entity vs DTO, Service-Layer Transaction, Lazy Loading, Optimistic Locking, Outbox, Pagination Query, Streaming/Export, and Consistency Patterns

> Target pembaca: Java/Jakarta engineer yang ingin memahami **batas antara REST API dan persistence/transaction layer** secara production-grade. Fokus bagian ini bukan sekadar “pakai `@Transactional`”, tetapi bagaimana mendesain boundary: resource method tipis, service layer transactional, DTO mapping, JPA entity exposure, lazy loading, optimistic locking, ETag, pagination query, outbox, transaction isolation, idempotency, streaming/export, long-running operation, dan error mapping.
>
> Namespace utama: `jakarta.transaction.Transactional`, `jakarta.persistence.EntityManager`, `jakarta.persistence.Entity`, `jakarta.persistence.Version`, `jakarta.persistence.OptimisticLockException`, `jakarta.ws.rs.core.Response`, `jakarta.ws.rs.core.EntityTag`, `jakarta.ws.rs.core.Request`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: REST Boundary Bukan Persistence Boundary](#2-mental-model-rest-boundary-bukan-persistence-boundary)
3. [Layering: Resource → Application Service → Domain/Persistence](#3-layering-resource--application-service--domainpersistence)
4. [Kenapa Resource Method Sebaiknya Tipis](#4-kenapa-resource-method-sebaiknya-tipis)
5. [`@Transactional`: Transaction Boundary Declarative](#5-transactional-transaction-boundary-declarative)
6. [Transaction di Resource vs Service Layer](#6-transaction-di-resource-vs-service-layer)
7. [EntityManager and Persistence Context](#7-entitymanager-and-persistence-context)
8. [Managed Entity, Detached Entity, Dirty Checking](#8-managed-entity-detached-entity-dirty-checking)
9. [JPA Entity Bukan REST DTO](#9-jpa-entity-bukan-rest-dto)
10. [Bahaya Exposing Entity Langsung](#10-bahaya-exposing-entity-langsung)
11. [DTO Boundary](#11-dto-boundary)
12. [Request DTO vs Command Object](#12-request-dto-vs-command-object)
13. [Response DTO vs Read Model](#13-response-dto-vs-read-model)
14. [Mapping Strategy](#14-mapping-strategy)
15. [Lazy Loading Problem](#15-lazy-loading-problem)
16. [N+1 Query Problem](#16-n1-query-problem)
17. [Fetch Join, Entity Graph, Projection](#17-fetch-join-entity-graph-projection)
18. [Open Session in View Anti-Pattern](#18-open-session-in-view-anti-pattern)
19. [Transaction Isolation](#19-transaction-isolation)
20. [Lost Update](#20-lost-update)
21. [Optimistic Locking dengan `@Version`](#21-optimistic-locking-dengan-version)
22. [ETag and `@Version`](#22-etag-and-version)
23. [`If-Match` to Version Check](#23-if-match-to-version-check)
24. [Mapping Optimistic Lock Failure](#24-mapping-optimistic-lock-failure)
25. [Pessimistic Locking](#25-pessimistic-locking)
26. [Idempotency and Transactions](#26-idempotency-and-transactions)
27. [Transactional Outbox](#27-transactional-outbox)
28. [Why Not Publish Event Before Commit](#28-why-not-publish-event-before-commit)
29. [After-Commit Side Effects](#29-after-commit-side-effects)
30. [External Calls Inside Transaction](#30-external-calls-inside-transaction)
31. [Saga / Process Manager](#31-saga--process-manager)
32. [Read-After-Write Consistency](#32-read-after-write-consistency)
33. [CQRS Read Model and REST](#33-cqrs-read-model-and-rest)
34. [Pagination Query and Transactions](#34-pagination-query-and-transactions)
35. [Cursor Pagination and Stable Ordering](#35-cursor-pagination-and-stable-ordering)
36. [Filtering/Sorting and Index-Aware Query](#36-filteringsorting-and-index-aware-query)
37. [Streaming/Export and Transaction Boundary](#37-streamingexport-and-transaction-boundary)
38. [Long-Running Operations](#38-long-running-operations)
39. [File Upload Metadata Transactions](#39-file-upload-metadata-transactions)
40. [Delete Semantics: Soft Delete vs Hard Delete](#40-delete-semantics-soft-delete-vs-hard-delete)
41. [HTTP Status Mapping for Persistence Errors](#41-http-status-mapping-for-persistence-errors)
42. [Problem Details Error Taxonomy](#42-problem-details-error-taxonomy)
43. [Validation vs Domain Invariant vs DB Constraint](#43-validation-vs-domain-invariant-vs-db-constraint)
44. [Database Constraint Violations](#44-database-constraint-violations)
45. [Multi-Tenancy in Queries](#45-multi-tenancy-in-queries)
46. [Security: Object-Level Authorization Before Persistence Mutation](#46-security-object-level-authorization-before-persistence-mutation)
47. [Audit Fields and Audit Trail](#47-audit-fields-and-audit-trail)
48. [Observability](#48-observability)
49. [Metrics](#49-metrics)
50. [Tracing](#50-tracing)
51. [Logging](#51-logging)
52. [Testing Transactional REST Boundary](#52-testing-transactional-rest-boundary)
53. [Integration Tests](#53-integration-tests)
54. [Concurrency Tests](#54-concurrency-tests)
55. [Runtime Differences: Jakarta EE, Quarkus, Spring, Hibernate](#55-runtime-differences-jakarta-ee-quarkus-spring-hibernate)
56. [Common Failure Modes](#56-common-failure-modes)
57. [Best Practices](#57-best-practices)
58. [Anti-Patterns](#58-anti-patterns)
59. [Production Checklist](#59-production-checklist)
60. [Latihan](#60-latihan)
61. [Referensi Resmi](#61-referensi-resmi)
62. [Penutup](#62-penutup)

---

# 1. Tujuan Part Ini

REST API sering tampak seperti thin wrapper atas database.

Contoh yang sering ditemukan:

```java
@GET
@Path("/{id}")
public CustomerEntity get(@PathParam("id") Long id) {
    return entityManager.find(CustomerEntity.class, id);
}
```

Atau:

```java
@POST
public CustomerEntity create(CustomerEntity entity) {
    entityManager.persist(entity);
    return entity;
}
```

Ini sederhana, tetapi sangat berbahaya untuk aplikasi enterprise.

Masalahnya:

- JPA entity bocor sebagai API contract;
- lazy loading terjadi saat serialization;
- field internal ikut terekspos;
- client bisa mengirim field yang tidak boleh diubah;
- transaction boundary tidak jelas;
- optimistic locking tidak terhubung ke HTTP ETag;
- domain invariant bocor ke DB constraint;
- event dikirim sebelum commit;
- external call dilakukan di dalam transaction;
- pagination query tidak stabil;
- export menahan transaksi terlalu lama;
- multi-tenancy filter bisa terlewat.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- menentukan transaction boundary yang benar;
- memisahkan REST DTO dari JPA entity;
- menghindari lazy-loading serialization;
- memilih query strategy untuk response;
- memakai optimistic locking dan ETag;
- memetakan persistence errors ke HTTP status;
- memakai transactional outbox;
- menghindari external call inside transaction;
- mendesain pagination/export yang transaction-safe;
- menulis concurrency tests.

## 1.2 Prinsip utama

```text
REST API exposes resource contracts.
Persistence layer stores state.
Application service coordinates transaction and domain operation.
Do not collapse all three into one class.
```

---

# 2. Mental Model: REST Boundary Bukan Persistence Boundary

REST boundary menerima dan mengembalikan representation.

Persistence boundary menyimpan entity/state.

Keduanya tidak harus identik.

## 2.1 REST representation

```json
{
  "id": "C001",
  "displayName": "Fajar",
  "status": "ACTIVE",
  "_links": {
    "self": { "href": "/customers/C001" }
  }
}
```

## 2.2 Persistence entity

```java
@Entity
@Table(name = "customers")
public class CustomerEntity {
    @Id
    private UUID id;

    @Column(name = "legal_name")
    private String legalName;

    @Column(name = "display_name")
    private String displayName;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Version
    private long version;

    @OneToMany(mappedBy = "customer", fetch = FetchType.LAZY)
    private List<AddressEntity> addresses;
}
```

## 2.3 Differences

REST may:

- hide internal fields;
- rename fields;
- include links;
- include derived state;
- merge data from multiple tables/services;
- version representation separately;
- apply authorization redaction.

Persistence entity may:

- contain audit fields;
- contain tenant ID;
- contain technical version;
- contain relational associations;
- reflect database normalization.

## 2.4 Top-tier rule

```text
The API contract should evolve by product/domain needs, not by accidental database shape.
```

---

# 3. Layering: Resource → Application Service → Domain/Persistence

Recommended flow:

```text
JAX-RS Resource
  ↓
Application Service / Use Case
  ↓
Domain Model / Repository / EntityManager
  ↓
Database
```

## 3.1 Resource responsibility

- HTTP mapping;
- path/query/header extraction;
- content negotiation;
- request DTO validation trigger;
- call application service;
- map service result to HTTP response;
- no DB transaction orchestration details if possible.

## 3.2 Application service responsibility

- transaction boundary;
- authorization decision orchestration;
- load aggregate/entity;
- enforce use case;
- call domain methods;
- persist;
- create outbox/audit;
- return DTO/read model.

## 3.3 Repository responsibility

- persistence query;
- tenant-safe lookup;
- data access;
- locking;
- projection.

## 3.4 Rule

Resource handles HTTP; service handles use case; repository handles persistence.

---

# 4. Kenapa Resource Method Sebaiknya Tipis

## 4.1 Thin resource

```java
@POST
@Path("/customers")
public Response create(CreateCustomerRequest request, @Context UriInfo uriInfo) {
    CustomerResponse created = customerService.create(request.toCommand());

    URI location = uriInfo.getBaseUriBuilder()
        .path(CustomerResource.class)
        .path(CustomerResource.class, "get")
        .build(created.id());

    return Response.created(location)
        .entity(created)
        .tag(created.etag())
        .build();
}
```

## 4.2 Why thin?

Thin resource is easier to:

- test;
- secure;
- document;
- version;
- keep transaction out of HTTP-specific logic;
- maintain service-level invariants;
- reuse use case from non-HTTP entry point.

## 4.3 Resource can still build HTTP response

That is okay.

But resource should not contain SQL, entity mutation workflow, or external side effects.

## 4.4 Rule

If resource method is doing persistence orchestration, it probably belongs in application service.

---

# 5. `@Transactional`: Transaction Boundary Declarative

`jakarta.transaction.Transactional` allows declarative transaction demarcation on CDI managed beans.

## 5.1 Example

```java
@ApplicationScoped
public class CustomerService {

    @Transactional
    public CustomerResponse create(CreateCustomerCommand command) {
        CustomerEntity entity = CustomerEntity.create(...);
        entityManager.persist(entity);

        outboxRepository.add(CustomerCreated.from(entity));

        return mapper.toResponse(entity);
    }
}
```

## 5.2 Semantics

`@Transactional` is interceptor-based in Jakarta EE/CDI environment.

It can begin/commit/rollback transaction according to rules.

## 5.3 Exceptions

Runtime exceptions generally mark rollback; checked exception behavior depends annotation configuration and transaction rules.

## 5.4 Rule

Place `@Transactional` where use case atomicity is defined.

---

# 6. Transaction di Resource vs Service Layer

## 6.1 Resource transaction

```java
@POST
@Transactional
public Response create(...) { ... }
```

Works but couples HTTP boundary with transaction.

## 6.2 Service transaction

```java
@POST
public Response create(...) {
    CustomerResponse response = service.create(...);
    return Response.created(...).entity(response).build();
}
```

```java
@Transactional
public CustomerResponse create(...) { ... }
```

Preferred.

## 6.3 Why

Service method is business operation.

Transaction should wrap business operation, not response construction.

## 6.4 Caveat

Mapping DTO inside transaction may be needed if it reads lazy fields.

But avoid lazy field surprises by query/fetch design.

## 6.5 Rule

Use service-layer transaction by default.

---

# 7. EntityManager and Persistence Context

`EntityManager` manages persistence context.

Persistence context is set of managed entity instances.

## 7.1 Managed entity

Loaded or persisted inside active context.

Changes can be detected by dirty checking.

## 7.2 Persistence context lifecycle

Container-managed persistence context often scoped to transaction or extended context depending config.

## 7.3 Flush

Changes are synchronized to DB on flush/commit.

## 7.4 Rule

Entity state changes inside persistence context are not just plain object changes; they are persistence operations.

---

# 8. Managed Entity, Detached Entity, Dirty Checking

## 8.1 Managed

```java
CustomerEntity customer = em.find(CustomerEntity.class, id);
customer.changeName("New");
```

At commit, JPA dirty checking updates DB.

## 8.2 Detached

Entity outside persistence context.

Changes not automatically saved unless merged.

## 8.3 Merge caution

`merge()` copies state from detached object to managed entity.

Dangerous with client-provided entity because it can overwrite fields.

## 8.4 Rule

Do not `merge()` client-submitted entity as update shortcut.

---

# 9. JPA Entity Bukan REST DTO

JPA entity has persistence concerns:

- table/column mapping;
- relationships;
- lazy loading;
- version;
- audit fields;
- tenant ID;
- internal flags;
- lifecycle callbacks.

REST DTO has API concerns:

- field names;
- validation contract;
- links;
- redaction;
- representation version;
- consumer compatibility.

## 9.1 Rule

Entity and DTO may look similar today, but they evolve for different reasons.

---

# 10. Bahaya Exposing Entity Langsung

## 10.1 Data leak

```java
return customerEntity;
```

May expose:

- tenant ID;
- internal notes;
- deleted flag;
- risk score;
- audit fields;
- relationships.

## 10.2 Lazy loading during serialization

Serializer touches `customer.addresses`.

Transaction already closed.

Result:

```text
LazyInitializationException
```

or extra queries.

## 10.3 Cycles

Bidirectional relationship can cause infinite JSON recursion.

## 10.4 Mass assignment

Client submits entity with fields they should not control.

## 10.5 Coupling

DB refactor breaks API.

## 10.6 Rule

Never expose JPA entities as public REST contract in serious APIs.

---

# 11. DTO Boundary

## 11.1 Request DTO

```java
public record CreateCustomerRequest(
    @NotBlank String displayName,
    @Email String email
) {
    CreateCustomerCommand toCommand() {
        return new CreateCustomerCommand(displayName, email);
    }
}
```

## 11.2 Response DTO

```java
public record CustomerResponse(
    String id,
    String displayName,
    String status,
    String etag,
    Map<String, LinkDto> links
) {}
```

## 11.3 Benefits

- explicit API contract;
- validation clear;
- no persistence leakage;
- versioning easier;
- security redaction easier;
- testing easier.

## 11.4 Rule

Use DTOs at REST boundary.

---

# 12. Request DTO vs Command Object

Request DTO is HTTP wire contract.

Command object is application use case input.

## 12.1 Request DTO

```java
public record SubmitApplicationRequest(
    @NotBlank String declaration,
    String comment
) {}
```

## 12.2 Command

```java
public record SubmitApplicationCommand(
    ApplicationId applicationId,
    CurrentActor actor,
    String declaration,
    String comment
) {}
```

## 12.3 Why separate?

Command includes server-derived context:

- actor;
- tenant;
- path ID;
- idempotency key;
- version;
- request time.

## 12.4 Rule

Do not let client provide fields that server must derive.

---

# 13. Response DTO vs Read Model

For complex reads, response may be projection/read model.

## 13.1 Entity mapping

```java
CustomerResponse mapper.toResponse(CustomerEntity entity)
```

Good for simple detail.

## 13.2 Query projection

```java
SELECT new CustomerListItem(...)
```

Good for list/search.

## 13.3 Read model table

Good for CQRS/complex aggregation.

## 13.4 Rule

Use projection/read model when response does not need full aggregate mutation.

---

# 14. Mapping Strategy

## 14.1 Manual mapping

Pros:

- explicit;
- safe;
- easy to handle security/links.

Cons:

- boilerplate.

## 14.2 Mapper library

MapStruct, etc.

Pros:

- less boilerplate.

Cons:

- can accidentally map fields;
- needs review for security.

## 14.3 Rule

Mapping is security-sensitive. Do not blindly map all fields.

---

# 15. Lazy Loading Problem

Lazy loading means associated data loads when accessed.

## 15.1 Example

```java
@OneToMany(fetch = FetchType.LAZY)
private List<AddressEntity> addresses;
```

Serialization accesses addresses after transaction.

Failure or N+1.

## 15.2 Bad fix

Enable Open Session in View so serialization can lazy-load.

This hides query planning and leaks persistence into view/REST layer.

## 15.3 Better

Fetch required data in service/query before mapping.

## 15.4 Rule

A REST response shape should determine query/fetch plan explicitly.

---

# 16. N+1 Query Problem

## 16.1 Scenario

List 100 customers.

For each customer, serializer accesses addresses.

Result:

```text
1 query customers
100 queries addresses
```

## 16.2 Detection

SQL logs, metrics, integration tests.

## 16.3 Fix

- fetch join;
- entity graph;
- projection query;
- batch fetching;
- separate endpoint;
- read model.

## 16.4 Rule

List endpoints should be designed with query count in mind.

---

# 17. Fetch Join, Entity Graph, Projection

## 17.1 Fetch join

```jpql
select c from Customer c
left join fetch c.addresses
where c.id = :id
```

Good for detail but can multiply rows.

## 17.2 Entity graph

Declarative fetch plan.

Good for reusable read shapes.

## 17.3 Projection

```jpql
select new CustomerListItem(c.id, c.displayName, c.status)
from Customer c
where ...
```

Good for list APIs.

## 17.4 Rule

Use projection for list/search; controlled fetch for detail.

---

# 18. Open Session in View Anti-Pattern

Open Session in View keeps persistence context open during serialization.

## 18.1 Why tempting

Avoids LazyInitializationException.

## 18.2 Why dangerous

- hidden queries during serialization;
- transaction/resource leakage;
- N+1 surprises;
- response shape controls DB access accidentally;
- harder performance predictability.

## 18.3 Better

Map DTO inside service with explicit query plan.

## 18.4 Rule

Avoid Open Session in View for REST APIs that need predictable performance/security.

---

# 19. Transaction Isolation

Transaction isolation affects concurrent reads/writes.

Common phenomena:

- dirty read;
- non-repeatable read;
- phantom read;
- lost update.

## 19.1 Database default

Databases differ.

PostgreSQL, MySQL, Oracle have different defaults/behaviors.

## 19.2 Application design

Do not rely on vague “transactional” meaning.

Know isolation for critical workflows.

## 19.3 Rule

For concurrency-sensitive operations, design locking/versioning explicitly.

---

# 20. Lost Update

Lost update occurs when two clients update same resource based on stale state.

## 20.1 Scenario

Client A reads v1.

Client B reads v1.

A updates phone → v2.

B updates email using stale v1 but overwrites phone or version incorrectly.

## 20.2 Prevention

- optimistic locking `@Version`;
- HTTP ETag/If-Match;
- database conditional update;
- domain conflict checks.

## 20.3 Rule

REST update endpoints need lost update strategy.

---

# 21. Optimistic Locking dengan `@Version`

Jakarta Persistence supports version fields/properties for optimistic locking.

## 21.1 Entity

```java
@Entity
public class CustomerEntity {
    @Id
    private UUID id;

    @Version
    private long version;
}
```

## 21.2 Update

JPA includes version check in update.

If version changed, optimistic lock failure occurs.

## 21.3 Exception

`OptimisticLockException` or provider-specific wrapped exception.

## 21.4 Rule

Use `@Version` for mutable aggregates.

---

# 22. ETag and `@Version`

Expose version as opaque ETag.

## 22.1 Response

```http
ETag: "customer-C001-v7"
```

## 22.2 Client update

```http
If-Match: "customer-C001-v7"
```

## 22.3 Service

Decode expected version from ETag or lookup current and compare opaque token.

## 22.4 Security

Do not expose raw version if sensitive; sign/hash if needed.

## 22.5 Rule

HTTP ETag bridges client concurrency with persistence version.

---

# 23. `If-Match` to Version Check

## 23.1 Resource

```java
@PATCH
@Path("/{id}")
public Response patch(
    @PathParam("id") CustomerId id,
    JsonObject patch,
    @HeaderParam(HttpHeaders.IF_MATCH) String ifMatch
) {
    if (ifMatch == null) throw new PreconditionRequiredException();

    CustomerResponse updated = service.patch(id, patch, EntityTag.valueOf(ifMatch));
    return Response.ok(updated)
        .tag(updated.entityTag())
        .build();
}
```

## 23.2 Service

```java
@Transactional
public CustomerResponse patch(CustomerId id, JsonObject patch, EntityTag expected) {
    CustomerEntity customer = repository.getByIdForTenant(id, tenant);

    if (!etagService.matches(customer, expected)) {
        throw new PreconditionFailedException();
    }

    patcher.apply(customer, patch);
    return mapper.toResponse(customer);
}
```

## 23.3 Race

Even with pre-check, JPA `@Version` is still needed because another transaction can update before commit.

## 23.4 Rule

Use both HTTP precondition and DB optimistic lock.

---

# 24. Mapping Optimistic Lock Failure

## 24.1 If request had `If-Match`

Map stale version to:

```http
412 Precondition Failed
```

## 24.2 If no precondition but conflict detected

Could be:

```http
409 Conflict
```

or `428 Precondition Required` if API mandates precondition.

## 24.3 Problem Details

```json
{
  "code": "PRECONDITION_FAILED",
  "status": 412,
  "detail": "The resource has changed since it was retrieved."
}
```

## 24.4 Rule

Use 412 for failed HTTP precondition, not generic 500.

---

# 25. Pessimistic Locking

Pessimistic locking locks DB rows.

## 25.1 Use cases

- high-conflict critical workflow;
- allocating scarce resource;
- preventing concurrent transition;
- financial ledger step with strict ordering.

## 25.2 JPA

```java
em.find(OrderEntity.class, id, LockModeType.PESSIMISTIC_WRITE);
```

## 25.3 Risks

- deadlock;
- lock wait timeout;
- reduced concurrency;
- long transaction harm.

## 25.4 Rule

Prefer optimistic locking unless conflict rate/business need justifies pessimistic locks.

---

# 26. Idempotency and Transactions

## 26.1 POST retry problem

Client sends create request.

Timeout occurs.

Client retries.

Without idempotency, duplicate resource may be created.

## 26.2 Idempotency table

Store:

- idempotency key;
- actor/tenant;
- request hash;
- response/result reference;
- status;
- expiry.

## 26.3 Transaction

Within same transaction:

```text
insert idempotency record
perform operation
store result
commit
```

## 26.4 Rule

Idempotency must be transactional with side effect.

---

# 27. Transactional Outbox

Transactional outbox solves DB update + event publish consistency.

## 27.1 Problem

```text
update DB
publish Kafka event
commit DB
```

If publish succeeds but DB commit fails, event lies.

If DB commit succeeds but publish fails, event missing.

## 27.2 Pattern

Inside DB transaction:

```text
update aggregate
insert outbox row
commit
```

Separate relay publishes outbox rows.

## 27.3 Outbox row

```text
id
aggregate_type
aggregate_id
event_type
payload
created_at
published_at
```

## 27.4 Rule

For reliable events from REST writes, use transactional outbox.

---

# 28. Why Not Publish Event Before Commit

## 28.1 False event

Client receives `CustomerCreated`.

Then transaction rolls back.

Downstream sees non-existent customer.

## 28.2 Race

Event consumer reads DB before commit and cannot find row.

## 28.3 Rule

Publish committed facts, not tentative changes.

---

# 29. After-Commit Side Effects

Some side effects should happen after commit:

- email sending;
- notification;
- search indexing;
- cache invalidation;
- SSE broadcast;
- external API call.

## 29.1 Better

Persist event/outbox; separate worker handles side effect.

## 29.2 If local after-commit hook

Still consider retry/durability.

## 29.3 Rule

Do not make external side effects part of DB transaction unless you truly have distributed transaction design.

---

# 30. External Calls Inside Transaction

## 30.1 Bad

```java
@Transactional
public void createOrder(...) {
    repository.save(order);
    paymentClient.charge(...); // external HTTP while DB tx open
}
```

Risks:

- long locks;
- timeout;
- partial failure;
- retry ambiguity;
- DB resources held during network wait.

## 30.2 Better

- reserve/prepare state;
- commit;
- call external via saga/process;
- update state based on callback/result.

## 30.3 Exception

Short local reliable calls? Still review carefully.

## 30.4 Rule

Avoid outbound HTTP calls inside DB transactions.

---

# 31. Saga / Process Manager

Use saga when operation spans multiple transactional resources/services.

## 31.1 Example

Order creation:

```text
create order pending
reserve inventory
authorize payment
confirm order
```

Each step commits locally.

Failures trigger compensation.

## 31.2 REST role

REST endpoint starts process and returns:

```http
202 Accepted
Location: /orders/{id}
```

or created pending resource.

## 31.3 Rule

Cross-service workflow is not one database transaction; model it as process.

---

# 32. Read-After-Write Consistency

After write, client expects to read updated state.

## 32.1 Same service/DB

Return updated representation from transaction result.

## 32.2 Read model lag

If GET reads projection updated asynchronously, it may lag.

## 32.3 Strategies

- return updated representation from write;
- read from write model for immediate GET;
- include operation status;
- document eventual consistency;
- use version in response.

## 32.4 Rule

Be explicit about consistency after writes.

---

# 33. CQRS Read Model and REST

CQRS separates write model and read model.

## 33.1 Write endpoint

```http
POST /applications
```

updates write model.

## 33.2 Read endpoint

```http
GET /applications/{id}
```

may read projection.

## 33.3 Eventual consistency

Projection may lag.

## 33.4 API design

Return:

- operation/resource status;
- version;
- `202 Accepted` if not immediately visible;
- links to status.

## 33.5 Rule

CQRS needs API-level consistency contract.

---

# 34. Pagination Query and Transactions

Pagination should not require long transaction.

## 34.1 Offset

```sql
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 1000
```

Can be unstable with concurrent writes.

## 34.2 Cursor/keyset

```sql
WHERE (created_at, id) < (:lastCreatedAt, :lastId)
ORDER BY created_at DESC, id DESC
LIMIT 20
```

More stable and efficient.

## 34.3 Count query

`totalCount` can be expensive and inconsistent.

## 34.4 Rule

List endpoints need query strategy, not transaction over entire browsing session.

---

# 35. Cursor Pagination and Stable Ordering

## 35.1 Stable order

Always include deterministic tie-breaker.

```text
createdAt desc, id desc
```

## 35.2 Cursor contains last seen sort keys

```json
{
  "createdAt": "2026-06-12T10:00:00Z",
  "id": "C001"
}
```

Encoded/opaque.

## 35.3 Transaction isolation

Each page may see changes.

If snapshot consistency required, use snapshot token/read model.

## 35.4 Rule

Cursor pagination is a query contract and consistency contract.

---

# 36. Filtering/Sorting and Index-Aware Query

## 36.1 Allowlist

Only allow indexed/supported fields.

## 36.2 No arbitrary JPQL from client

Bad:

```text
filter=anything
sort=anyColumn
```

## 36.3 Query object

Convert request to validated query object.

```java
CustomerSearchQuery query = CustomerSearchQuery.of(filters, sort, page);
```

## 36.4 Rule

REST query contract must be persistence-aware but not persistence-leaking.

---

# 37. Streaming/Export and Transaction Boundary

## 37.1 Bad

```java
@Transactional
public StreamingOutput export() {
    Stream<Row> rows = repository.streamAll();
    return output -> rows.forEach(...); // transaction probably closed or held badly
}
```

## 37.2 Problems

- transaction closed before stream consumed;
- or transaction held during client download;
- DB cursor tied to slow client;
- error after commit.

## 37.3 Better

For large exports:

```text
POST /exports → create export job
worker reads DB and writes file/object storage
GET /exports/{id}/download
```

## 37.4 For small direct export

Query data in bounded chunks and avoid unbounded transaction.

## 37.5 Rule

Do not couple DB transaction lifetime to HTTP streaming lifetime.

---

# 38. Long-Running Operations

Long operations should not hold transaction or request.

## 38.1 Pattern

```http
POST /reports
202 Accepted
Location: /operations/OP123
```

Worker:

```text
transaction per step/chunk
write status
write result
```

## 38.2 Transaction granularity

Use small transactions per durable step.

## 38.3 Rule

Long-running operation is process state, not one huge transaction.

---

# 39. File Upload Metadata Transactions

Upload bytes and DB metadata are different resources.

## 39.1 App upload flow

```text
stream file to quarantine object
compute checksum
begin transaction
insert document metadata status=SCAN_PENDING
insert outbox scan event
commit
```

## 39.2 Failure cleanup

If DB fails after object stored, cleanup orphan object.

If object fails before DB, no metadata.

## 39.3 Rule

Model upload as state machine with cleanup, not one fake distributed transaction.

---

# 40. Delete Semantics: Soft Delete vs Hard Delete

## 40.1 Hard delete

Row removed.

```http
204 No Content
```

## 40.2 Soft delete

Mark deleted.

Useful for audit/recovery.

## 40.3 REST visibility

After delete, GET may return:

- 404;
- 410 Gone;
- 403 if hidden.

## 40.4 Constraints

Soft-deleted unique fields need careful indexing.

## 40.5 Rule

Delete semantics are domain + persistence + API contract.

---

# 41. HTTP Status Mapping for Persistence Errors

## 41.1 Not found

```http
404 Not Found
```

## 41.2 Unique constraint conflict

```http
409 Conflict
```

if business uniqueness.

## 41.3 Validation failure

```http
400 or 422
```

depending policy.

## 41.4 Optimistic lock

```http
412
```

if `If-Match` failed.

## 41.5 Lock timeout/deadlock

```http
409 or 503
```

depending whether business conflict or transient infrastructure.

## 41.6 DB unavailable

```http
503 Service Unavailable
```

## 41.7 Rule

Do not leak SQL exceptions as 500 with stack trace.

---

# 42. Problem Details Error Taxonomy

Suggested codes:

```text
RESOURCE_NOT_FOUND
RESOURCE_ALREADY_EXISTS
UNIQUE_CONSTRAINT_VIOLATION
PRECONDITION_REQUIRED
PRECONDITION_FAILED
OPTIMISTIC_LOCK_FAILED
PERSISTENCE_CONFLICT
DATABASE_UNAVAILABLE
TRANSACTION_TIMEOUT
DEADLOCK_RETRY_EXHAUSTED
TENANT_ACCESS_DENIED
DOMAIN_INVARIANT_VIOLATED
```

## 42.1 Example

```json
{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "code": "PRECONDITION_FAILED",
  "detail": "The resource has changed. Fetch the latest representation and retry.",
  "correlationId": "..."
}
```

## 42.2 Rule

Persistence errors should become stable API errors.

---

# 43. Validation vs Domain Invariant vs DB Constraint

## 43.1 Validation

Request shape:

```text
email format
not blank
max length
```

## 43.2 Domain invariant

Business truth:

```text
cannot submit expired application
cannot approve own request
```

## 43.3 DB constraint

Last line of defense:

```text
unique email per tenant
foreign key exists
not null
```

## 43.4 Rule

Do not rely only on DB constraints for user-friendly API errors.

---

# 44. Database Constraint Violations

## 44.1 Unique constraint

Map to 409 if business conflict.

## 44.2 Foreign key

Could mean invalid reference or internal bug.

## 44.3 Not null

Usually validation bug if request allowed null.

## 44.4 Race

Even if you pre-check uniqueness, DB constraint can still fail due to race.

## 44.5 Rule

Pre-validate for UX, but handle DB constraints for correctness.

---

# 45. Multi-Tenancy in Queries

## 45.1 Every query tenant-safe

```sql
WHERE tenant_id = :tenantId
```

## 45.2 Repository method

```java
Optional<CustomerEntity> findByTenantAndId(TenantId tenant, CustomerId id);
```

## 45.3 Do not load then check tenant

Bad:

```java
Customer c = findById(id);
if (!c.tenantId.equals(actor.tenantId)) throw forbidden;
```

This can leak existence and risks accidental use.

## 45.4 Rule

Tenant filter belongs in persistence query.

---

# 46. Security: Object-Level Authorization Before Persistence Mutation

## 46.1 Load tenant-safe

First, load resource within allowed tenant/scope.

## 46.2 Check permission

Then check action permission.

## 46.3 Mutate

Only after authorization.

## 46.4 Example

```java
@Transactional
public CaseResponse assign(AssignCommand command) {
    CaseEntity caseEntity = repository.getForTenant(command.tenant(), command.caseId());
    authorization.checkCanAssign(command.actor(), caseEntity);
    caseEntity.assignTo(command.assignee());
    return mapper.toResponse(caseEntity);
}
```

## 46.5 Rule

Never mutate then authorize.

---

# 47. Audit Fields and Audit Trail

## 47.1 Technical audit fields

- createdAt;
- createdBy;
- updatedAt;
- updatedBy;
- version.

## 47.2 Business audit trail

- action;
- actor;
- before/after;
- reason;
- IP/correlation;
- domain event.

## 47.3 Transaction

Audit entry should be written in same transaction as state change if it is evidence of that change.

## 47.4 Rule

Audit must reflect committed changes.

---

# 48. Observability

Track transaction and persistence behavior from REST endpoints.

## 48.1 Need visibility

- DB query latency;
- transaction duration;
- lock waits;
- optimistic lock failures;
- constraint violations;
- N+1 query count;
- outbox lag;
- export job duration.

## 48.2 Rule

Persistence issues usually show up as API latency/errors; correlate them.

---

# 49. Metrics

Suggested metrics:

```text
rest_transaction_duration_seconds{operation}
persistence_queries_total{operation}
persistence_query_duration_seconds{repository,query}
optimistic_lock_failures_total{resource}
db_constraint_violations_total{constraint_type}
outbox_pending_total
outbox_publish_lag_seconds
transaction_rollbacks_total{reason}
export_jobs_total{status}
```

## 49.1 Avoid high cardinality

Do not label by:

- entity ID;
- user ID;
- raw SQL;
- tenant ID if many.

## 49.2 Rule

Use operation/query names, not raw values.

---

# 50. Tracing

## 50.1 Spans

- resource method;
- service transaction;
- repository query;
- outbox insert;
- external call if outside transaction.

## 50.2 Attributes

- operation name;
- status;
- lock mode;
- row count;
- retry count.

## 50.3 Rule

Tracing should reveal where transaction time is spent.

---

# 51. Logging

## 51.1 Log

- transaction rollback reason;
- optimistic lock conflict;
- deadlock/timeout;
- constraint violation mapped to API code;
- outbox relay failures.

## 51.2 Do not log

- raw SQL with PII;
- entity dumps;
- full request bodies with secrets;
- stack trace for expected conflicts at error level.

## 51.3 Rule

Logs should aid incident response without leaking data.

---

# 52. Testing Transactional REST Boundary

## 52.1 Test types

- resource tests;
- service transaction tests;
- repository tests;
- integration tests with real DB;
- concurrency tests.

## 52.2 Avoid only mocking repository

Mocks miss transaction/lazy/loading/constraint behavior.

## 52.3 Rule

Persistence boundary needs integration tests.

---

# 53. Integration Tests

Test:

- entity not exposed;
- DTO mapping;
- lazy fields loaded correctly;
- no N+1 for list;
- unique constraint mapped;
- transaction rollback;
- outbox inserted with state change;
- multi-tenancy query prevents access.

## 53.1 Use real DB if possible

H2 may not match PostgreSQL/Oracle/MySQL behavior.

## 53.2 Rule

Database behavior is part of contract.

---

# 54. Concurrency Tests

Test:

- two clients update same resource with same ETag;
- one succeeds, one gets 412;
- duplicate create with same unique key;
- idempotency key concurrent requests;
- pessimistic lock timeout;
- deadlock retry policy if any.

## 54.1 Rule

Concurrency bugs require concurrent tests.

---

# 55. Runtime Differences: Jakarta EE, Quarkus, Spring, Hibernate

## 55.1 `@Transactional`

Jakarta, Quarkus, Spring can all support `jakarta.transaction.Transactional`, but behavior/integration may differ.

## 55.2 Persistence provider

Hibernate, EclipseLink, etc. differ in lazy loading, flush timing, SQL, lock behavior.

## 55.3 Runtime defaults

Open Session in View, transaction interceptors, CDI proxy, exception wrapping can differ.

## 55.4 Rule

Treat persistence/runtime behavior as environment-specific; test target stack.

---

# 56. Common Failure Modes

## 56.1 Returning JPA entity as REST response

Leak/lazy/coupling.

## 56.2 Accepting JPA entity as request

Mass assignment.

## 56.3 Transaction in resource with large response serialization

Long transaction.

## 56.4 Lazy loading during JSON serialization

N+1 or failure.

## 56.5 External HTTP call inside transaction

Resource held and partial failure.

## 56.6 Event published before commit

False event.

## 56.7 No optimistic locking

Lost update.

## 56.8 DB constraint leaked as 500

Poor API contract.

## 56.9 Multi-tenant filter forgotten

Data breach.

## 56.10 Streaming export from open DB cursor to slow client

DB exhaustion.

## 56.11 Idempotency key not transactional

Duplicate operation.

## 56.12 Tests use fake DB only

Production-specific bug missed.

---

# 57. Best Practices

## 57.1 Keep resource thin

HTTP boundary only.

## 57.2 Put transaction in service/use case

`@Transactional` on application service.

## 57.3 Use DTOs

No entity exposure.

## 57.4 Explicit fetch/projection

Avoid lazy serialization.

## 57.5 Use optimistic locking

`@Version` + ETag/If-Match.

## 57.6 Map persistence errors

Problem Details.

## 57.7 Use outbox for events

Publish committed facts.

## 57.8 Avoid external calls in transaction

Use process/outbox/saga.

## 57.9 Tenant-safe repository methods

Filter in query.

## 57.10 Test with real DB and concurrency

Critical.

---

# 58. Anti-Patterns

## 58.1 CRUD controller directly uses EntityManager

Tight coupling.

## 58.2 `BeanUtils.copyProperties(request, entity)`

Mass assignment.

## 58.3 `em.merge(clientEntity)`

Overwrites unintended fields.

## 58.4 `@Transactional` on streaming endpoint

Transaction held too long.

## 58.5 OSIV to “fix” lazy loading

Hides query bugs.

## 58.6 Publish Kafka/SSE before commit

False events.

## 58.7 Catch all persistence exceptions and return 500

Bad API.

## 58.8 No ETag on mutable resources

Lost updates.

## 58.9 DB transaction spans remote HTTP calls

Cascading failures.

## 58.10 Pagination without stable ordering

Duplicate/missing rows.

---

# 59. Production Checklist

## 59.1 Boundary

- [ ] Resource method thin.
- [ ] Service layer owns transaction.
- [ ] DTOs used for request/response.
- [ ] Command object includes server-derived context.
- [ ] Entity never exposed directly.
- [ ] Mapper reviewed for field leakage.

## 59.2 Persistence

- [ ] Fetch plan explicit.
- [ ] List endpoints use projection/read model.
- [ ] N+1 tests/logs exist.
- [ ] Lazy loading not triggered during serialization.
- [ ] Tenant filters in queries.
- [ ] DB constraints mapped.

## 59.3 Concurrency

- [ ] `@Version` on mutable aggregates.
- [ ] ETag returned.
- [ ] `If-Match` required for critical updates.
- [ ] Optimistic lock mapped to 412/409 appropriately.
- [ ] Concurrent update tests exist.
- [ ] Idempotency records transactional.

## 59.4 Side effects

- [ ] No external HTTP inside DB transaction unless justified.
- [ ] Outbox used for integration events.
- [ ] Events published after commit.
- [ ] Audit written transactionally.
- [ ] Upload/export modeled with state machine if needed.

## 59.5 Operations

- [ ] Transaction duration metric.
- [ ] Query duration metric.
- [ ] Lock/constraint metrics.
- [ ] Outbox lag metric.
- [ ] Real DB integration tests.
- [ ] Streaming/export does not hold DB transaction to client speed.

---

# 60. Latihan

## Latihan 1 — Entity to DTO Refactor

Ambil endpoint yang return entity.

Refactor menjadi:

```text
Resource → Service → Mapper → DTO
```

Pastikan internal fields tidak muncul.

## Latihan 2 — Lazy Loading Test

Buat entity Customer dengan Address LAZY.

Endpoint detail harus return addresses.

Implement query/fetch plan agar tidak terjadi LazyInitializationException dan tidak N+1.

## Latihan 3 — Optimistic Lock + ETag

Tambahkan `@Version`.

GET return ETag.

PATCH require If-Match.

Dua concurrent PATCH: satu sukses, satu 412.

## Latihan 4 — Unique Constraint

Create customer email unique per tenant.

Dua request concurrent dengan email sama.

Satu sukses, satu 409 Problem Details.

## Latihan 5 — Outbox

Pada create order:

- insert order;
- insert outbox row;
- commit.

Worker publish outbox later.

Simulate publish failure; row tetap pending.

## Latihan 6 — External Call Refactor

Ambil service yang call HTTP di dalam transaction.

Refactor menjadi saga/job/outbox flow.

## Latihan 7 — Cursor Pagination

Implement list endpoint dengan stable cursor:

```text
createdAt desc, id desc
```

Test concurrent insert tidak membuat duplicate item.

## Latihan 8 — Export Job

Refactor streaming DB cursor export menjadi export job:

```text
POST /exports
GET /exports/{id}
GET /exports/{id}/download
```

## Latihan 9 — Multi-Tenant Query

Pastikan repository method selalu menerima TenantId.

Test user tenant A tidak bisa akses resource tenant B dan response tidak leak existence.

---

# 61. Referensi Resmi

Referensi utama:

1. Jakarta Transactions 2.0 Specification  
   https://jakarta.ee/specifications/transactions/2.0/jakarta-transactions-spec-2.0.html

2. Jakarta Transactions — Tutorial  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/transactions/transactions.html

3. Jakarta Persistence 3.2 Specification  
   https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2

4. Jakarta Persistence 3.2 — `EntityManager` API Docs  
   https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager

5. Jakarta Persistence 3.2 — `@Version` API Docs  
   https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/version

6. Jakarta EE Tutorial — Persistence Locking  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/persist/persistence-locking/persistence-locking.html

7. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

8. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

---

# 62. Penutup

REST API dan database sama-sama menyimpan/menyajikan state, tetapi keduanya bukan layer yang sama.

Mental model final:

```text
HTTP request
  ↓
Resource maps HTTP to command/query
  ↓
Application service opens transaction
  ↓
Repository loads tenant-safe state
  ↓
Domain operation mutates aggregate
  ↓
Persistence flushes with version/constraints
  ↓
Outbox/audit inserted
  ↓
Commit
  ↓
DTO returned with ETag/links
```

Prinsip final:

```text
Resource is not repository.
Entity is not DTO.
Transaction is not HTTP request lifetime.
Serialization is not query planning.
Event publication is not safe before commit.
```

Top-tier JAX-RS engineer memastikan:

- resource method tipis;
- transaction boundary ada di service layer;
- JPA entity tidak bocor;
- fetch plan eksplisit;
- optimistic locking terhubung ke ETag;
- persistence errors menjadi Problem Details;
- tenant filter masuk query;
- outbox menjaga event consistency;
- external calls tidak menggantung transaksi;
- export/upload/long job punya state machine;
- concurrency dan real database behavior diuji.

Part berikutnya:

```text
Bagian 033 — API Versioning Strategy
```

Kita akan membahas versioning API secara mendalam: URI versioning, media type versioning, header versioning, compatibility rules, deprecation policy, migration windows, representation evolution, and consumer contract management.

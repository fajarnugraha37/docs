# Strict Coding Standards — Java EclipseLink

> **Purpose**: This document defines strict rules for LLM code agents and human reviewers when implementing Java persistence with **EclipseLink** as the JPA / Jakarta Persistence provider.
>
> This is an **overlay standard**. It must be used together with:
>
> - `strict-coding-standards__java11.md`, `java17.md`, `java21.md`, or `java25.md`
> - `strict-coding-standards__jpa.md`
> - `strict-coding-standards__jdbc.md`
> - `strict-coding-standards__java_validation.md`
> - `strict-coding-standards__java_logging.md`
> - `strict-coding-standards__java_security.md`
>
> The JPA standard defines the portable contract. This document defines what is additionally allowed, restricted, and forbidden when EclipseLink-specific behavior is introduced.

---

## 1. Core Principles

EclipseLink must be used as a persistence provider, not as a place to hide domain, transaction, or integration logic.

The agent must preserve the following invariants:

1. **Persistence logic is explicit.**
   - Entity mapping is intentional.
   - Fetch strategy is intentional.
   - Transaction boundary is intentional.
   - Cache behavior is intentional.
   - Provider-specific hints are justified.

2. **JPA portability is the default.**
   - Prefer standard Jakarta Persistence APIs.
   - Use EclipseLink extensions only when there is a clear benefit.
   - Every EclipseLink-specific feature must be documented.

3. **Namespace must not be mixed.**
   - Legacy Java EE projects use `javax.persistence.*`.
   - Jakarta EE projects use `jakarta.persistence.*`.
   - Never mix both in the same module.

4. **Provider-specific behavior must be testable.**
   - Query hints require tests.
   - Weaving/lazy loading assumptions require tests.
   - Cache behavior requires tests.
   - Batch/fetch behavior requires tests or profiling evidence.

5. **Do not use EclipseLink features to bypass architecture.**
   - Do not put business rules in entity callbacks if they belong in domain/application services.
   - Do not rely on lazy loading across REST serialization.
   - Do not rely on shared cache to hide inefficient query design.
   - Do not use provider hints as a substitute for indexes, pagination, or correct data modelling.

---

## 2. Version and Namespace Policy

### 2.1 Version Alignment Matrix

| Project Type | Namespace | Persistence API | EclipseLink Line | Status |
|---|---:|---:|---:|---|
| Java EE / JPA 2.x legacy | `javax.persistence` | JPA 2.1/2.2 | EclipseLink 2.x | Legacy only |
| Jakarta EE 9 | `jakarta.persistence` | Jakarta Persistence 3.0 | EclipseLink 3.x | Migration baseline |
| Jakarta EE 10 | `jakarta.persistence` | Jakarta Persistence 3.1 | EclipseLink 4.x | Stable baseline |
| Jakarta EE 11 | `jakarta.persistence` | Jakarta Persistence 3.2 | EclipseLink 5.x | Modern baseline; verify ecosystem support |
| Jakarta EE 12+ | `jakarta.persistence` | Jakarta Persistence 4.x | Future/provider-specific | Forbidden without explicit approval |

### 2.2 Strict Rules

**MUST**:

- Pin EclipseLink version explicitly through Maven `dependencyManagement`, Gradle version catalog, or platform/BOM.
- Ensure the persistence API version matches the provider version.
- Ensure application server provided libraries do not conflict with application-packaged EclipseLink.
- Keep provider-specific imports under `org.eclipse.persistence.*` isolated from domain code.
- Record the selected EclipseLink version and Persistence API version in architecture/build documentation.

**FORBIDDEN**:

- Mixing `javax.persistence.*` and `jakarta.persistence.*` in the same module.
- Adding both Hibernate and EclipseLink as active JPA providers unless explicitly building compatibility tests.
- Depending on transitive persistence API versions accidentally pulled by frameworks.
- Upgrading EclipseLink without running persistence integration tests.
- Using preview/milestone EclipseLink release for production without explicit approval.

### 2.3 Dependency Examples

#### Maven — Jakarta Persistence / EclipseLink 4.x style

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.eclipse.persistence</groupId>
      <artifactId>eclipselink</artifactId>
      <version>${eclipselink.version}</version>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>org.eclipse.persistence</groupId>
    <artifactId>eclipselink</artifactId>
  </dependency>
</dependencies>
```

#### Gradle

```kotlin
dependencies {
    implementation("org.eclipse.persistence:eclipselink:$eclipselinkVersion")
}
```

**MUST NOT** add provider dependency blindly. The agent must inspect whether the runtime container already provides the persistence provider.

---

## 3. Persistence Unit Configuration

### 3.1 Provider Declaration

For explicit provider selection:

```xml
<persistence-unit name="app-pu" transaction-type="JTA">
  <provider>org.eclipse.persistence.jpa.PersistenceProvider</provider>
  <jta-data-source>jdbc/AppDataSource</jta-data-source>
</persistence-unit>
```

**MUST**:

- Declare provider explicitly when multiple providers may exist.
- Use JTA transaction type in Jakarta EE/server-managed applications.
- Use `RESOURCE_LOCAL` only for standalone applications, tests, CLIs, or explicitly non-container-managed contexts.
- Keep persistence unit names stable and meaningful.

**FORBIDDEN**:

- Relying on ambiguous provider auto-discovery in multi-provider environments.
- Hardcoding JDBC credentials in `persistence.xml` for production.
- Creating an `EntityManagerFactory` per request.
- Creating an `EntityManager` as a singleton/shared mutable object.

### 3.2 Environment-Specific Properties

**MUST** externalize:

- JDBC URL
- credentials
- logging level
- DDL policy
- cache policy
- weaving policy
- batch/fetch tuning

**FORBIDDEN**:

- Embedding production credentials in `persistence.xml`.
- Using `drop-and-create-tables` in production.
- Using production database connection values in tests.
- Enabling detailed SQL bind logging in production without redaction policy.

---

## 4. Entity Mapping Rules

All rules in `strict-coding-standards__jpa.md` still apply.

### 4.1 Entity Class Rules

**MUST**:

- Use explicit `@Entity`.
- Use explicit `@Table` when table name is not trivially obvious or schema matters.
- Use explicit primary key mapping.
- Use explicit column names for long-lived schemas.
- Use protected/public no-arg constructor.
- Keep entity fields private/protected.
- Avoid exposing mutable collection internals.

**FORBIDDEN**:

- Entity as REST response DTO.
- Entity as command/request object.
- Entity as generic map of properties.
- `@Data`-style Lombok on entities.
- `equals/hashCode` using mutable fields.
- Blind bidirectional relationship generation.

### 4.2 EclipseLink-Specific Mapping Extensions

EclipseLink-specific annotations are **restricted**.

Examples:

- `@Cache`
- `@ReadOnly`
- `@PrivateOwned`
- `@JoinFetch`
- `@BatchFetch`
- `@Multitenant`
- `@Customizer`
- `@Converter`
- `@Mutable`
- `@ChangeTracking`

**MUST** document every EclipseLink annotation with:

```java
// EclipseLink-specific: required because <reason>.
// Portability impact: <impact>.
// Tested by: <test class / integration test>.
```

**FORBIDDEN**:

- Adding EclipseLink-specific mapping because it “looks useful”.
- Using provider-specific annotations in shared domain modules expected to run with another provider.
- Using provider extensions without integration tests.

---

## 5. Weaving Policy

EclipseLink can use weaving to enhance entity classes for lazy loading, change tracking, fetch groups, and other optimizations.

### 5.1 Allowed Modes

| Mode | Status | Rule |
|---|---:|---|
| Dynamic weaving | Restricted | Allowed only when runtime supports Java instrumentation/class transformation |
| Static weaving | Restricted | Allowed for controlled build pipelines and environments where dynamic weaving is unavailable |
| No weaving | Allowed | Must understand lazy loading/change tracking impact |

### 5.2 Strict Rules

**MUST**:

- Decide weaving mode explicitly for production.
- Test lazy loading behavior under the same weaving mode used in production.
- Verify behavior in containers, application servers, tests, and native/packaged runtimes separately.
- Document if static weaving is part of the build.

**FORBIDDEN**:

- Assuming LAZY relationship behavior works without verifying weaving.
- Changing weaving mode as a hidden performance fix.
- Adding JVM agent options without documenting deployment impact.
- Silently disabling weaving to make tests pass.

### 5.3 Persistence Property Example

```xml
<property name="eclipselink.weaving" value="true"/>
```

or for static weaving:

```xml
<property name="eclipselink.weaving" value="static"/>
```

**REVIEW REQUIREMENT**: If weaving is changed, reviewer must run lazy-loading and change-tracking tests.

---

## 6. Transaction and EntityManager Rules

### 6.1 EntityManager Lifecycle

**MUST**:

- Treat `EntityManager` as unit-of-work scoped.
- Use container-managed `EntityManager` where available.
- Use application-managed `EntityManager` only with explicit open/close lifecycle.
- Roll back failed transactions.
- Never share `EntityManager` across threads.

**FORBIDDEN**:

- Static/global `EntityManager`.
- EntityManager stored in singleton service state.
- EntityManager used across async thread boundaries.
- Lazy loading after response serialization starts.
- Starting transaction inside random repository methods without application-level transaction design.

### 6.2 RESOURCE_LOCAL Pattern

```java
EntityTransaction tx = entityManager.getTransaction();
try {
    tx.begin();
    // work
    tx.commit();
} catch (RuntimeException ex) {
    if (tx.isActive()) {
        tx.rollback();
    }
    throw ex;
}
```

**MUST NOT** swallow rollback exceptions silently. If rollback fails, log with correlation ID and rethrow meaningful exception.

---

## 7. Fetch Strategy Rules

### 7.1 Default Rules

**MUST**:

- Design fetch plan per use case.
- Use pagination for list endpoints.
- Avoid accidental N+1 queries.
- Prefer explicit JPQL with fetch joins/entity graphs/hints when needed.
- Validate generated SQL for important queries.

**FORBIDDEN**:

- `FetchType.EAGER` as a generic fix.
- Serializing lazy entity graphs to JSON.
- Returning entities from REST APIs and relying on lazy loading during serialization.
- Using provider-specific join/batch fetch without evidence.

### 7.2 EclipseLink Query Hints

EclipseLink query hints are restricted.

Allowed only when:

1. The performance/correctness issue is identified.
2. The query is covered by integration tests.
3. The hint is documented.
4. The generated SQL/result cardinality is reviewed.

Example:

```java
TypedQuery<Order> query = entityManager.createQuery(
    "select o from Order o where o.customerId = :customerId order by o.createdAt desc",
    Order.class
);
query.setParameter("customerId", customerId);
query.setHint("eclipselink.batch", "o.lines");
query.setMaxResults(limit);
```

**MUST** prefer constants if available:

```java
query.setHint(org.eclipse.persistence.config.QueryHints.BATCH, "o.lines");
```

**FORBIDDEN**:

- Magic hint strings scattered through code.
- Hints in controllers/resources.
- Hints without tests.
- Hints used to compensate for missing indexes or unbounded queries.

---

## 8. Cache Rules

EclipseLink has first-level persistence context cache and shared cache behavior. Cache can improve performance but can also create stale-read and consistency problems.

### 8.1 Shared Cache Policy

**MUST**:

- Decide shared cache policy per entity category.
- Disable or carefully isolate cache for volatile or security-sensitive data.
- Document invalidation strategy.
- Test stale data behavior.
- Avoid caching entities whose visibility depends on tenant/user authorization.

**RESTRICTED**:

- `@Cache`
- query result cache
- cache usage query hints
- isolated/protected cache modes

**FORBIDDEN**:

- Enabling broad shared cache because “it improves performance”.
- Caching authorization decisions inside normal entity cache.
- Assuming DB updates made outside EclipseLink are immediately visible.
- Using cache to hide bad query design.

### 8.2 Cache Usage Decision

Before enabling EclipseLink shared cache, the agent must answer:

```text
Entity:
Read/write ratio:
Staleness tolerance:
External writers:
Tenant/user visibility constraints:
Invalidation mechanism:
Expected memory impact:
Tests proving correctness:
```

If this cannot be answered, do not enable provider-specific shared cache behavior.

---

## 9. Query Rules

### 9.1 JPQL and Criteria

**MUST**:

- Use bind parameters.
- Use typed queries.
- Use pagination for list queries.
- Keep query ownership in repository/query object layer.
- Test query behavior against real database dialect where practical.

**FORBIDDEN**:

- String concatenation with untrusted input.
- Building JPQL order-by/field names without allow-list.
- `getSingleResult()` without no-result/non-unique handling policy.
- Returning unbounded result lists.

### 9.2 Native Query

Native SQL is restricted.

Allowed only when:

- JPQL/Criteria cannot express the required query safely or efficiently.
- Database-specific behavior is intentional.
- Result mapping is explicit.
- SQL injection risk is reviewed.
- Integration tests exist.

**FORBIDDEN**:

- Native query for simple CRUD.
- Native query built from raw request strings.
- Native query returning `Object[]` across application boundary.
- Native query without pagination for list operations.

### 9.3 Bulk Updates and Deletes

**MUST**:

- Treat bulk JPQL/native updates as bypassing normal entity lifecycle expectations.
- Clear or synchronize persistence context after bulk operations.
- Document cache invalidation impact.
- Test stale entity behavior.

**FORBIDDEN**:

- Bulk update followed by use of already-managed stale entity without refresh/clear.
- Bulk delete without ownership/foreign-key/cascade analysis.

---

## 10. DDL and Schema Generation

### 10.1 Production Rule

**FORBIDDEN IN PRODUCTION**:

- `drop-and-create-tables`
- automatic destructive schema generation
- provider-driven schema evolution without migration review

**MUST**:

- Use Flyway, Liquibase, or equivalent migration tool for production schema.
- Keep DDL migration explicit, reviewed, and rollback-aware.
- Validate mappings against schema in CI/test.

### 10.2 Acceptable Test Rule

Provider schema generation may be used in isolated tests only when:

- test database is disposable,
- schema is recreated per test suite,
- test does not claim to validate production migration behavior.

---

## 11. Locking and Concurrency

### 11.1 Optimistic Locking

**MUST**:

- Use `@Version` for mutable aggregates/entities that can be concurrently updated.
- Convert optimistic lock failure into domain/application conflict.
- Never blindly retry write conflicts without re-reading business state.

Example:

```java
@Version
@Column(name = "version", nullable = false)
private long version;
```

### 11.2 Pessimistic Locking

Pessimistic locks are restricted.

Allowed only when:

- contention behavior is understood,
- lock timeout is configured,
- deadlock handling exists,
- transaction boundary is short,
- integration test covers lock behavior.

**FORBIDDEN**:

- Long-running transaction holding pessimistic locks.
- Pessimistic lock around remote calls.
- Pessimistic lock without timeout.

---

## 12. Multitenancy

EclipseLink has provider-specific multitenancy features. These are restricted.

**MUST**:

- Define tenant isolation model explicitly:
  - database per tenant,
  - schema per tenant,
  - discriminator column,
  - application-level policy.
- Ensure every query is tenant-safe.
- Ensure cache is tenant-safe.
- Ensure background jobs are tenant-safe.
- Test tenant isolation with at least two tenants.

**FORBIDDEN**:

- Relying only on UI/frontend filtering.
- Storing tenant ID in mutable thread-local without lifecycle cleanup.
- Caching tenant-sensitive entities in shared cache without isolation.
- Native query bypassing tenant filter.

---

## 13. Converters and Custom Types

### 13.1 Standard JPA Converter First

Prefer standard `AttributeConverter` before provider-specific converter.

```java
@Converter(autoApply = true)
public final class EmailAddressConverter implements AttributeConverter<EmailAddress, String> {
    @Override
    public String convertToDatabaseColumn(EmailAddress attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public EmailAddress convertToEntityAttribute(String dbData) {
        return dbData == null ? null : EmailAddress.of(dbData);
    }
}
```

**MUST**:

- Test null conversion.
- Test invalid DB data behavior.
- Keep conversion deterministic.
- Avoid I/O or service calls in converters.

**FORBIDDEN**:

- Calling repositories/services from converters.
- Hiding encryption/decryption in converter without key/version/rotation policy.
- Parsing locale-dependent values without explicit locale/format.

---

## 14. Entity Callbacks and Listeners

Entity callbacks are restricted.

Allowed for:

- audit timestamps,
- simple invariant normalization,
- technical metadata.

Restricted/usually forbidden for:

- business workflow transitions,
- remote calls,
- database queries,
- publishing messages,
- security decisions.

**MUST**:

- Keep callbacks deterministic and side-effect-light.
- Avoid dependency injection inside entity listeners unless framework integration is explicit and tested.
- Test callback behavior during persist/update/merge.

---

## 15. Logging and SQL Visibility

### 15.1 SQL Logging

**MUST**:

- Keep SQL logging configurable by environment.
- Disable verbose SQL/bind logging by default in production.
- Redact sensitive values.
- Use correlation ID in application logs around DB operations.

**FORBIDDEN**:

- Logging secrets, tokens, passwords, full PII payloads, or credentials.
- Enabling bind parameter logging in production without risk approval.
- Using SQL logs as a substitute for metrics/tracing.

### 15.2 Performance Evidence

For important queries, the agent must provide:

```text
Query purpose:
Expected cardinality:
Parameters:
Pagination:
Indexes expected:
Fetch plan:
Generated SQL reviewed: yes/no
Integration test: yes/no
Performance evidence: explain plan / benchmark / profiling
```

---

## 16. Error Handling

**MUST**:

- Translate persistence exceptions at application boundary.
- Preserve original exception as cause.
- Avoid leaking table/column/internal SQL details to API clients.
- Distinguish validation error, conflict, not found, transient DB failure, and system failure.

**FORBIDDEN**:

- Catching `Exception` and returning empty result.
- Swallowing `PersistenceException`.
- Retrying all persistence failures blindly.
- Mapping all DB errors to HTTP 500 without classification.

---

## 17. Testing Standards

### 17.1 Required Tests

Any EclipseLink-backed repository/query change must include tests for:

- persist
- update
- delete or soft-delete
- query filtering
- pagination
- sorting
- relationship fetch behavior
- transaction rollback
- optimistic lock if entity is mutable/concurrent
- provider-specific hint behavior if used

### 17.2 Integration Database

**MUST**:

- Prefer real database via Testcontainers or equivalent for dialect-sensitive queries.
- Avoid H2-only tests for production Oracle/PostgreSQL/MySQL-specific behavior.
- Validate generated schema only as a supplement, not as production migration proof.

### 17.3 Provider-Specific Tests

If using EclipseLink-specific features, test must assert:

- feature is actually active,
- behavior differs as expected,
- fallback/failure mode is understood.

Examples:

- weaving enabled/disabled behavior,
- query hint generated SQL,
- cache invalidation/staleness,
- batch fetch count,
- multitenant filter behavior.

---

## 18. Performance Rules

**MUST**:

- Use pagination.
- Avoid N+1 queries.
- Review generated SQL.
- Use indexes aligned to query predicates/sort order.
- Use batch writes carefully for large imports.
- Keep transaction scope bounded.
- Measure before adding provider hints.

**RESTRICTED**:

- query cache
- shared cache
- batch fetch hints
- join fetch hints
- fetch groups
- native SQL optimization
- statically woven optimization

**FORBIDDEN**:

- Claiming performance improvement without benchmark/profile/query evidence.
- Loading huge result sets into memory.
- Using `findAll()`-style repository methods in production paths without pagination.
- Performing remote calls inside transaction loops.

---

## 19. Security Rules

**MUST**:

- Bind parameters in JPQL/native SQL.
- Use allow-list for dynamic identifiers.
- Enforce tenant/security filters server-side.
- Avoid sensitive data in SQL logs.
- Restrict native queries.
- Avoid exposing entity graphs to API clients.

**FORBIDDEN**:

- Dynamic JPQL/SQL concatenation from request parameters.
- Using entity cache for tenant/user-specific authorization state without isolation.
- Logging bind values containing secrets/PII.
- Native query bypassing access control rules.
- Deserializing arbitrary DB content into executable/dynamic classes.

---

## 20. Migration Rules

### 20.1 Hibernate to EclipseLink

**MUST NOT** assume Hibernate behavior carries over.

Review:

- lazy loading behavior,
- proxy behavior,
- DDL generation,
- JPQL interpretation,
- flush timing,
- cascade/orphan behavior,
- identifier generation,
- enum mapping,
- second-level cache,
- custom types,
- lifecycle callbacks,
- exception types.

### 20.2 EclipseLink 2.x to 3.x/4.x/5.x

**MUST**:

- Migrate namespace intentionally from `javax.*` to `jakarta.*`.
- Review container/application server compatibility.
- Re-run integration tests.
- Re-check weaving and module-access behavior.
- Re-check provider properties removed/changed across versions.

**FORBIDDEN**:

- Mechanical import rewrite without runtime tests.
- Mixing old JPA API dependency with newer EclipseLink provider.
- Keeping old `javax.persistence.Persistence` bootstrapping in Jakarta modules.

---

## 21. Anti-Patterns

The agent must reject these patterns:

### 21.1 Entity as API Contract

```java
@Path("/orders")
public class OrderResource {
    @GET
    public List<OrderEntity> list() { // forbidden
        return repository.findAll();
    }
}
```

Why forbidden:

- leaks persistence model,
- triggers lazy-loading serialization bugs,
- exposes internal fields,
- creates versioning problem.

### 21.2 Provider Hint Soup

```java
query.setHint("eclipselink.join-fetch", "o.customer");
query.setHint("eclipselink.batch", "o.lines");
query.setHint("eclipselink.cache-usage", "CheckCacheThenDatabase");
```

Why restricted:

- hard to reason about,
- provider-specific,
- may hide missing indexes/fetch-plan errors,
- requires evidence.

### 21.3 Blind Merge from Request

```java
entityManager.merge(requestBodyEntity); // forbidden
```

Why forbidden:

- mass assignment risk,
- lost update risk,
- bypasses command validation,
- unclear ownership.

### 21.4 Transaction Around Remote Calls

```java
transaction.begin();
entityManager.persist(entity);
httpClient.send(request); // forbidden inside DB transaction
transaction.commit();
```

Why forbidden:

- long locks,
- partial failure,
- retry ambiguity,
- poor scalability.

### 21.5 Lazy Loading in JSON Serialization

```java
return Response.ok(orderEntity).build(); // forbidden
```

Why forbidden:

- non-deterministic DB access,
- persistence context lifecycle leak,
- overexposure,
- N+1 at serialization time.

---

## 22. Approved Patterns

### 22.1 Repository with Explicit Query Method

```java
public final class OrderRepository {
    private final EntityManager entityManager;

    public OrderRepository(EntityManager entityManager) {
        this.entityManager = Objects.requireNonNull(entityManager, "entityManager");
    }

    public List<OrderEntity> findRecentByCustomer(CustomerId customerId, int limit) {
        return entityManager.createQuery(
                """
                select o
                from OrderEntity o
                where o.customerId = :customerId
                order by o.createdAt desc
                """,
                OrderEntity.class)
            .setParameter("customerId", customerId.value())
            .setMaxResults(limit)
            .getResultList();
    }
}
```

### 22.2 Application Service Owns Transaction

```java
public final class PlaceOrderService {
    private final OrderRepository orderRepository;

    public OrderResult placeOrder(PlaceOrderCommand command) {
        // transaction boundary handled by container/framework
        Order order = Order.place(command);
        orderRepository.save(OrderEntity.from(order));
        return OrderResult.from(order);
    }
}
```

### 22.3 DTO Projection

```java
public record OrderSummaryDto(
    String id,
    String status,
    Instant createdAt
) {}
```

Use DTOs for API boundary. Do not expose entities.

---

## 23. LLM Implementation Protocol

Before adding or modifying EclipseLink code, the LLM must answer internally and encode relevant decisions in code/comments/tests:

```text
1. Is this standard JPA or EclipseLink-specific?
2. Which namespace is used: javax.persistence or jakarta.persistence?
3. Which EclipseLink version line is active?
4. Is the persistence provider supplied by the runtime container or packaged by the app?
5. What is the transaction boundary?
6. What is the EntityManager lifecycle?
7. What is the fetch plan?
8. Does the query require pagination?
9. Is cache behavior relevant?
10. Does weaving affect behavior?
11. Are there tenant/security filters?
12. Are provider-specific hints used? Why?
13. What tests prove correctness?
14. What performance evidence justifies tuning?
```

If any answer is unknown, the agent must choose the conservative portable JPA path and avoid EclipseLink-specific features.

---

## 24. Reviewer Checklist

A reviewer must verify:

### Version and Build

- [ ] EclipseLink version is pinned.
- [ ] Persistence API version matches provider line.
- [ ] `javax.*` and `jakarta.*` are not mixed.
- [ ] Runtime/container provider conflict is checked.

### Entity Mapping

- [ ] Entity mapping follows JPA standards.
- [ ] Provider-specific annotations are justified.
- [ ] `equals/hashCode` is safe.
- [ ] Relationships are intentional.
- [ ] No entity is returned directly from API.

### Transactions

- [ ] Transaction boundary is explicit.
- [ ] EntityManager lifecycle is correct.
- [ ] No EntityManager shared across threads.
- [ ] Rollback behavior exists.

### Queries

- [ ] Bind parameters are used.
- [ ] Pagination exists for list queries.
- [ ] Dynamic identifiers are allow-listed.
- [ ] Generated SQL is reviewed for important queries.
- [ ] Native query has justification.

### EclipseLink Features

- [ ] Weaving behavior is understood and tested.
- [ ] Query hints are documented and tested.
- [ ] Cache behavior is documented and tested.
- [ ] Multitenancy, if used, is tested for isolation.

### Security

- [ ] No SQL injection via JPQL/native SQL.
- [ ] No sensitive SQL/bind logging.
- [ ] Tenant/user isolation is enforced server-side.
- [ ] Native query does not bypass authorization.

### Operations

- [ ] DDL generation is safe for environment.
- [ ] SQL logging level is environment-specific.
- [ ] Metrics/tracing/logging exist for DB operations.
- [ ] Performance claims have evidence.

---

## 25. Prompt Contract for LLM Code Agent

Use this prompt snippet when asking an LLM to implement EclipseLink-backed persistence:

```text
You are implementing Java persistence using EclipseLink.

You must follow:
- strict-coding-standards__jpa.md
- strict-coding-standards__java_eclipse_link.md
- strict-coding-standards__jdbc.md
- strict-coding-standards__java_security.md
- strict-coding-standards__java_testing.md

Rules:
1. Do not mix javax.persistence and jakarta.persistence.
2. Prefer standard JPA/Jakarta Persistence APIs.
3. Use EclipseLink-specific annotations/properties/hints only with explicit justification.
4. Do not expose entities as API DTOs.
5. Do not use blind merge from request bodies.
6. Do not build JPQL/native SQL with string-concatenated request input.
7. Every list query must have pagination or documented bounded cardinality.
8. Every provider-specific hint/cache/weaving assumption must have a test.
9. Do not enable destructive DDL generation for production.
10. Do not claim performance improvement without evidence.

Before coding, identify:
- persistence API namespace,
- EclipseLink version,
- transaction boundary,
- entity manager lifecycle,
- fetch plan,
- cache/weaving assumptions,
- test coverage.
```

---

## 26. Source References

Use official/current provider and specification documentation when modifying this standard:

- EclipseLink downloads and release lines: `https://eclipse.dev/eclipselink/downloads/`
- EclipseLink 4.0 release notes: `https://eclipse.dev/eclipselink/releases/4.0.html`
- EclipseLink 4.0 documentation: `https://eclipse.dev/eclipselink/documentation/4.0/`
- EclipseLink JPA extensions reference: `https://eclipse.dev/eclipselink/documentation/4.0/jpa/extensions/jpa-extensions.html`
- EclipseLink project releases: `https://github.com/eclipse-ee4j/eclipselink/releases`
- Jakarta Persistence specifications: `https://jakarta.ee/specifications/persistence/`
- Jakarta Persistence 3.2: `https://jakarta.ee/specifications/persistence/3.2/`

---

## 27. Final Rule

When in doubt, choose portable JPA, explicit transactions, explicit fetch plans, explicit tests, and no provider-specific optimization.

EclipseLink-specific behavior is allowed only when it is:

1. necessary,
2. documented,
3. tested,
4. operationally understood,
5. reviewed.


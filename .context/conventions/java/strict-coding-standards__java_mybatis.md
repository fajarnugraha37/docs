# Strict Coding Standards — Java MyBatis

> **Purpose**: This document defines mandatory coding standards for LLM-assisted implementation using **MyBatis 3**, **MyBatis-Spring**, and optional **MyBatis Dynamic SQL** in Java services.
>
> **Primary goal**: keep SQL explicit and reviewable while preventing SQL injection, hidden transaction bugs, accidental N+1 queries, unsafe dynamic SQL, weak result mapping, and unbounded database access.
>
> **This document is an overlay standard.** It must be used together with the project Java baseline standard (`java11`, `java17`, `java21`, or `java25`), `strict-coding-standards__jdbc.md`, `strict-coding-standards__java_security.md`, `strict-coding-standards__java_testing.md`, and the project architecture rules.

---

## 1. Scope

This standard applies to code that uses:

- MyBatis core (`org.apache.ibatis.*`)
- Mapper XML files
- Annotated mapper interfaces
- MyBatis-Spring (`org.mybatis.spring.*`)
- MyBatis-Spring-Boot integration
- MyBatis Dynamic SQL (`org.mybatis.dynamic.sql.*`)
- Custom `TypeHandler`
- MyBatis plugins/interceptors
- Stored procedure mappings through MyBatis
- SQL fragments and dynamic SQL tags

This standard does **not** replace SQL/database standards. SQL design, indexes, constraints, locking, migration, and execution plan review still belong to database standards.

---

## 2. Compatibility and dependency policy

### 2.1 Version policy

LLM agents must not invent dependency versions.

Before changing MyBatis dependencies, the agent must identify:

- Java baseline.
- Spring/Spring Boot baseline if used.
- MyBatis core version.
- MyBatis-Spring version.
- MyBatis-Spring-Boot-Starter version if used.
- JDBC driver version.
- Database vendor and version.
- Whether project uses `javax.*` era libraries, Jakarta EE libraries, or plain Java/Spring.

### 2.2 Dependency rules

**MUST**:

- Pin MyBatis versions through Maven `dependencyManagement`, Gradle version catalog, or platform/BOM when available.
- Keep MyBatis core and MyBatis-Spring versions compatible.
- Keep JDBC driver version explicit and governed by build standard.
- Use the project dependency governance standard before adding plugins, starters, or extensions.

**MUST NOT**:

- Add both incompatible MyBatis integration libraries for the same framework layer.
- Add MyBatis-Plus, jOOQ, Hibernate, JPA, QueryDSL, or custom SQL builders as a shortcut without architecture approval.
- Upgrade MyBatis major versions as part of unrelated feature work.
- Mix multiple persistence approaches in one repository method unless the design explicitly documents transaction and consistency boundaries.

---

## 3. Architectural positioning

### 3.1 What MyBatis is for

MyBatis is appropriate when:

- SQL must be explicit and reviewable.
- Queries are complex, vendor-specific, or reporting-heavy.
- The application prefers mapper-based persistence over ORM state management.
- DTO/projection mapping is more important than entity lifecycle tracking.
- Stored procedures or hand-tuned SQL are required.

MyBatis is not an ORM state machine. It does not automatically provide:

- Dirty checking.
- Persistence context identity map semantics equivalent to JPA.
- Automatic relationship synchronization.
- Automatic optimistic locking unless implemented in SQL.
- Automatic N+1 prevention.
- Automatic domain invariants.

### 3.2 Layering rules

**MUST**:

- Place MyBatis mapper interfaces in infrastructure/persistence packages.
- Keep business decisions in service/domain layer, not SQL XML.
- Keep REST/gRPC DTOs separate from persistence DTOs unless the object is intentionally stable as an API contract.
- Keep SQL statement names aligned with business use case or repository method.
- Use repositories/gateways to hide mapper details from domain/application services when the project architecture requires it.

**MUST NOT**:

- Inject MyBatis mapper directly into controllers/resources.
- Let mapper XML become a hidden business workflow engine.
- Put authorization logic only inside SQL predicates without application-layer authorization checks.
- Return mutable internal persistence objects directly to untrusted API callers.

---

## 4. Mapper design contract

### 4.1 Mapper interface rules

**MUST**:

- Define mapper as an interface.
- Keep mapper methods small and intention-revealing.
- Use one mapper namespace per aggregate/table/reporting area unless a clear alternative exists.
- Use explicit method parameter names with `@Param` for multiple parameters.
- Prefer parameter objects/criteria objects when a query has more than two inputs.
- Return precise types: `Optional<T>`, `List<T>`, `int`, domain-specific DTO, or paging wrapper.
- Document whether `int` return from update/delete means affected rows and whether zero rows is valid.

**MUST NOT**:

- Expose `Map<String, Object>` as normal repository output unless the query is intentionally dynamic/reporting-oriented.
- Use mapper method names like `query`, `getData`, `process`, `execute`, or `doSql`.
- Return `null` collections. Return empty list.
- Return `Object` or raw generic types.
- Use overloaded mapper methods with the same statement id semantics.

### 4.2 XML vs annotation policy

**Default**:

- XML mapper is preferred for non-trivial SQL.
- Annotations are allowed for simple, stable SQL only.
- MyBatis Dynamic SQL is restricted and must be justified.

**Annotations are allowed only when**:

- SQL is short and readable.
- No complex dynamic SQL is required.
- No large result mapping is required.
- SQL does not require vendor-specific syntax that becomes unreadable in Java strings.

**XML is required when**:

- SQL spans multiple joins.
- Query has dynamic filters.
- Query has nested result mapping.
- Query has reusable SQL fragments.
- Query needs vendor-specific hints.
- Query has stored procedure mapping.

**MUST NOT**:

- Put large SQL strings inside Java annotations.
- Concatenate annotation SQL strings manually with unsafe dynamic pieces.
- Duplicate the same query in annotation and XML.

---

## 5. SQL parameter safety

### 5.1 `#{}` is the default

**MUST** use `#{}` for runtime values.

Correct:

```xml
<select id="findById" resultMap="userResultMap">
  select id, username, status
  from users
  where id = #{id,jdbcType=BIGINT}
</select>
```

`#{}` binds values through prepared statement parameters.

### 5.2 `${}` is dangerous and restricted

`${}` performs direct string substitution.

**FORBIDDEN BY DEFAULT** for user-controlled values.

`${}` is allowed only for controlled SQL identifiers such as column names, sort directions, table partitions, or SQL fragments when all of these are true:

1. The value is not directly supplied by the user.
2. The value comes from a closed enum/allow-list.
3. The mapper method documents the allowed values.
4. There is a test proving disallowed values are rejected.
5. The SQL cannot be expressed with `#{}`.

Correct restricted pattern:

```java
public enum UserSortColumn {
    USERNAME("username"),
    CREATED_AT("created_at");

    private final String sql;

    UserSortColumn(String sql) {
        this.sql = sql;
    }

    public String sql() {
        return sql;
    }
}
```

```xml
<select id="searchUsers" resultMap="userResultMap">
  select id, username, created_at
  from users
  order by ${sortColumn} ${sortDirection}
</select>
```

The mapper caller must supply only values derived from enums, never raw request strings.

Forbidden:

```xml
where username = '${username}'
order by ${request.sort}
select * from ${request.tableName}
```

### 5.3 Dynamic identifiers

Dynamic table, schema, column, direction, and function names are **identifier substitution**, not value binding.

**MUST**:

- Use allow-list enums.
- Reject unknown values before mapper call.
- Avoid exposing schema/table names in API request models.
- Log rejected identifier attempts as security-relevant events without logging raw payload if sensitive.

**MUST NOT**:

- Escape identifiers manually and assume safety.
- Accept arbitrary `orderBy`, `groupBy`, `where`, `select`, `join`, or `having` text from user input.
- Accept custom SQL snippets from API clients.

---

## 6. Dynamic SQL XML rules

### 6.1 Allowed dynamic tags

Allowed with review:

- `<if>`
- `<choose>`, `<when>`, `<otherwise>`
- `<where>`
- `<trim>`
- `<set>`
- `<foreach>`
- `<bind>` only with strict review
- `<include>` only for stable reusable SQL fragments

### 6.2 Dynamic SQL standards

**MUST**:

- Keep conditions deterministic.
- Avoid business rules hidden in OGNL expressions.
- Keep SQL readable after dynamic expansion.
- Validate criteria before mapper call.
- Test at least minimal, maximal, and empty criteria combinations.
- Ensure dynamic queries still use appropriate indexes.
- Add pagination or explicit bound for list queries.

**MUST NOT**:

- Build arbitrary WHERE clauses from client input.
- Use nested dynamic tags so complex that final SQL cannot be reviewed.
- Use dynamic SQL to bypass service-layer authorization.
- Use `<foreach>` to create unbounded `IN` clauses.
- Use `<bind>` to assemble raw SQL text from user input.

### 6.3 `foreach` rules

**MUST**:

- Validate collection size before mapper call.
- Define max batch size or max `IN` size.
- Handle empty collections explicitly.
- Prefer temporary table/bulk table approach for very large sets.

Example:

```xml
<select id="findByIds" resultMap="userResultMap">
  select id, username, status
  from users
  where id in
  <foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id,jdbcType=BIGINT}
  </foreach>
</select>
```

Service must reject empty or oversized `ids` before this mapper call.

---

## 7. Result mapping rules

### 7.1 Use `resultMap` for non-trivial mapping

**MUST** use `resultMap` when:

- Column names differ from property names.
- Result includes joins.
- Result includes nested objects.
- Result includes collections.
- TypeHandler is needed.
- Constructor mapping is needed.
- Mapping requires aliasing.

**MUST NOT** rely on `resultType` for complex join output.

### 7.2 Explicit column aliases

For joins, every selected column must have a stable alias.

Correct:

```sql
select
  u.id          as user_id,
  u.username    as user_username,
  r.id          as role_id,
  r.name        as role_name
from users u
left join user_roles ur on ur.user_id = u.id
left join roles r on r.id = ur.role_id
where u.id = #{id}
```

Forbidden:

```sql
select *
from users u
join roles r on ...
```

### 7.3 `select *` policy

`select *` is **forbidden by default**.

Allowed only for:

- Temporary debugging, never committed.
- Internal migration scripts, not application mapper.
- Database-specific metadata queries where columns are defined by the database API.

### 7.4 ID mapping in nested results

Nested result maps **MUST** include `<id>` elements for parent and child identity when mapping joined rows.

```xml
<resultMap id="userWithRolesResultMap" type="UserWithRoles">
  <id property="id" column="user_id" />
  <result property="username" column="user_username" />
  <collection property="roles" ofType="RoleDto">
    <id property="id" column="role_id" />
    <result property="name" column="role_name" />
  </collection>
</resultMap>
```

### 7.5 Auto-mapping policy

**Default**:

- `autoMappingBehavior=PARTIAL` or stricter.
- `FULL` auto-mapping is forbidden by default.

**MUST**:

- Disable auto-mapping for complex join result maps unless intentionally reviewed.
- Prefer explicit aliases and mappings.
- Use `mapUnderscoreToCamelCase` only as a project-wide convention, not a local surprise.

**MUST NOT**:

- Trust auto-mapping for joined objects with overlapping column names.
- Use `Map<String,Object>` to avoid designing result DTOs.

---

## 8. DTO and domain mapping

### 8.1 Persistence model rules

**MUST**:

- Use immutable DTOs where practical.
- Keep persistence DTOs separate from API DTOs when contracts differ.
- Keep mapper result classes simple.
- Avoid embedding behavior-heavy domain objects directly in MyBatis result mapping unless constructor/invariant policy is clear.

**MUST NOT**:

- Map directly into JPA entities managed by another persistence context.
- Let MyBatis populate partially invalid domain objects.
- Use public mutable DTOs for sensitive values without redaction policy.

### 8.2 Records

Java records are allowed for MyBatis result DTOs only when:

- The Java baseline supports records.
- Constructor mapping is explicit or verified.
- Nullability and default values are understood.
- The record is not a mutable persistence entity.

Records are good for projections, not for lifecycle-heavy domain objects.

---

## 9. TypeHandler standards

### 9.1 When to use custom TypeHandler

Use a custom `TypeHandler` for:

- Value objects stored as scalar database values.
- JSON columns when approved.
- Encrypted/tokenized fields when approved by security standard.
- Vendor-specific types.
- Enum mapping where default behavior is not acceptable.

### 9.2 TypeHandler rules

**MUST**:

- Be deterministic and side-effect-free.
- Handle null explicitly.
- Define supported Java type and JDBC type.
- Be tested with representative database values.
- Fail loudly on unknown enum/string values unless backward compatibility requires tolerant parsing.
- Avoid logging raw sensitive values.

**MUST NOT**:

- Perform database calls.
- Perform network calls.
- Hide encryption/key-management complexity inside a mapper without design review.
- Swallow conversion exceptions and return null.

---

## 10. Transaction boundary

### 10.1 Spring-managed MyBatis

When MyBatis-Spring is used:

**MUST**:

- Use Spring transaction management at service/application boundary.
- Ensure the `DataSource` used by the transaction manager is the same one used by `SqlSessionFactory`.
- Keep mapper methods free of manual commit/rollback.
- Treat mapper calls outside a transaction as auto-commit unless framework behavior is explicitly known.

**MUST NOT**:

- Call `SqlSession.commit()` on Spring-managed sessions.
- Call `SqlSession.rollback()` on Spring-managed sessions.
- Call `SqlSession.close()` on Spring-managed sessions.
- Start transactions inside mapper code.

### 10.2 Non-Spring MyBatis

When using raw MyBatis API:

**MUST**:

- Use `try-with-resources` for `SqlSession`.
- Commit only after all statements in the unit of work succeed.
- Roll back on failure.
- Keep transaction scope explicit and small.
- Document autocommit behavior.

Example:

```java
try (SqlSession session = sqlSessionFactory.openSession(false)) {
    UserMapper mapper = session.getMapper(UserMapper.class);
    mapper.insertUser(user);
    mapper.insertAudit(audit);
    session.commit();
} catch (RuntimeException ex) {
    // session close triggers cleanup; rollback policy must be explicit if needed
    throw ex;
}
```

### 10.3 Transaction anti-patterns

**FORBIDDEN**:

- Mapper method performs partial business workflow with hidden transaction semantics.
- Multiple mapper calls requiring atomicity are made outside a transaction.
- External HTTP/Kafka/RabbitMQ side effects are performed inside database transaction without outbox/saga design.
- Retrying non-idempotent transaction blocks without idempotency key.

---

## 11. Insert/update/delete standards

### 11.1 Write result handling

**MUST**:

- Check affected row count for update/delete where correctness depends on it.
- Treat zero rows as a domain condition when updating by ID/version.
- Implement optimistic locking explicitly with version condition when needed.
- Make generated key retrieval explicit.

Example optimistic update:

```xml
<update id="updateStatus">
  update cases
  set status = #{newStatus}, version = version + 1
  where id = #{id}
    and version = #{expectedVersion}
</update>
```

Service must require affected rows = 1.

### 11.2 Generated keys

**MUST**:

- Use `useGeneratedKeys`/`keyProperty` only where supported and tested by the database/driver.
- Use database sequence/selectKey explicitly when required by vendor.
- Avoid relying on generated key behavior without integration test.

### 11.3 Partial update policy

**MUST**:

- Distinguish between “field absent”, “field present with null”, and “field present with value”.
- Avoid accidental `null` overwrites in dynamic update.
- Validate update command before mapper call.

**MUST NOT**:

- Build update from raw request map without allow-list.
- Use dynamic update to silently ignore unknown fields.

---

## 12. Select/query standards

### 12.1 Query contract

Every query method must define:

- Expected cardinality: zero/one, exactly one, many, page, stream/cursor.
- Ordering guarantee.
- Pagination or bound.
- Locking behavior if applicable.
- Transaction requirement if result is used for later write.
- Error behavior for duplicate rows.

### 12.2 Single-row query

**MUST**:

- Use a method contract that distinguishes no row from one row.
- Decide whether duplicate row is data corruption.
- Prefer `Optional<T>` at repository boundary where no row is valid.

**MUST NOT**:

- Return `null` without documented convention.
- Catch duplicate result exceptions and silently choose first row.

### 12.3 Pagination

**MUST**:

- Use stable deterministic ordering.
- Apply limit/page size max.
- Prefer keyset pagination for high-volume scrolling.
- Avoid offset pagination for deep pages unless explicitly acceptable.

**MUST NOT**:

- Return unbounded lists for API requests.
- Depend on database default ordering.

### 12.4 Streaming/cursor

Allowed only when:

- Dataset is large.
- Transaction/session lifecycle is controlled.
- Caller consumes and closes resource predictably.
- Memory budget and fetch size are configured/tested.

**MUST NOT** expose cursor/stream beyond transaction/session lifetime.

---

## 13. N+1 and relationship loading

### 13.1 Nested select policy

Nested selects are **restricted**.

Allowed when:

- Parent cardinality is known small.
- Lazy behavior is intentional.
- Query count is tested or bounded.
- The design documents why join mapping is not used.

**MUST NOT** use nested selects for list endpoints unless query count is bounded and accepted.

### 13.2 Nested result/join mapping policy

Prefer joined SQL + nested result mapping when:

- Query returns aggregate projection.
- Parent list has child collections.
- API requires complete graph.
- N+1 risk exists.

**MUST**:

- Alias every column.
- Include `<id>` in nested result maps.
- Verify duplicate parent collapse behavior.
- Test one parent/no child, one parent/multiple children, multiple parents/multiple children.

---

## 14. Cache policy

### 14.1 Local session cache

Understand MyBatis local session cache behavior before relying on repeated reads.

**MUST**:

- Avoid assuming cache is a cross-request cache.
- Keep transaction/session scope controlled.
- Be careful when reading after external updates.

### 14.2 Second-level cache

MyBatis second-level cache (`<cache/>`) is **forbidden by default**.

Allowed only with explicit design approval covering:

- Data volatility.
- Invalidation model.
- Memory budget.
- Serialization behavior.
- Stale-read acceptability.
- Cluster behavior.
- Security/tenant isolation.

**MUST NOT** enable `<cache/>` casually because it is one line.

---

## 15. Batch operations

### 15.1 Batch insert/update/delete

**MUST**:

- Define batch size.
- Use transaction boundary around batch.
- Validate input size.
- Handle partial failure semantics.
- Consider driver/database batch behavior.
- Use generated keys in batch only if supported and tested.

### 15.2 ExecutorType.BATCH

`ExecutorType.BATCH` is **restricted**.

Allowed when:

- Batch behavior is tested with actual database/driver.
- Flush points are explicit.
- Memory pressure is bounded.
- Errors are mapped into actionable failure response.

**MUST NOT** use batch executor to hide slow design or unbounded loops.

---

## 16. Stored procedures

Stored procedure mapping is **restricted**.

Allowed when:

- Stored procedure is part of database contract.
- Parameter modes are explicit.
- Cursor/result mapping is tested.
- Transaction behavior is documented.
- Procedure side effects are known.

**MUST NOT**:

- Hide business workflow in stored procedure without application-level documentation.
- Call procedure from mapper without timeout.
- Ignore OUT/INOUT null handling.

---

## 17. Timeout and resource control

Every production statement must have an intentional timeout policy.

**MUST**:

- Configure default statement timeout at MyBatis/JDBC/pool level where appropriate.
- Override timeout for known long-running reports only with explicit approval.
- Apply API timeout shorter or equal to downstream budget.
- Avoid unbounded result sets.
- Define fetch size for large reads when supported by the driver.

**MUST NOT**:

- Let slow SQL run indefinitely.
- Use large fetch size without memory testing.
- Use streaming queries without session lifecycle control.

---

## 18. Error handling

### 18.1 Exception translation

With Spring integration, mapper exceptions should be translated to Spring `DataAccessException` where configured.

**MUST**:

- Map persistence exceptions at service/application boundary.
- Avoid leaking SQL/driver details to API responses.
- Preserve root cause in logs.
- Include correlation ID in logs.
- Convert unique constraint/foreign key/version conflict into domain/API errors intentionally.

**MUST NOT**:

- Catch `Exception` in mapper/repository and return null/false.
- Log full SQL parameters when they may contain secrets/PII.
- Expose raw database error messages to clients.

---

## 19. Security standards

### 19.1 SQL injection

**MUST**:

- Use `#{}` for values.
- Use allow-list for identifiers.
- Reject raw SQL snippets from users.
- Test dynamic queries with malicious input.
- Review all `${}` usage.

**FORBIDDEN**:

- User-controlled `${}`.
- User-controlled `ORDER BY` text.
- User-controlled `WHERE` text.
- User-controlled table/schema names.
- Raw SQL in API request payload.

### 19.2 Authorization and tenant isolation

**MUST**:

- Enforce authorization in application layer.
- Add tenant/organization/user scope predicates for tenant-bound data.
- Test tenant isolation at mapper/repository level.
- Avoid optional tenant predicates that disappear when parameter is null.

Forbidden:

```xml
<if test="tenantId != null">
  and tenant_id = #{tenantId}
</if>
```

For tenant-bound queries, missing tenant must fail before mapper call.

### 19.3 Sensitive data

**MUST**:

- Avoid selecting secrets unless required.
- Avoid returning password hashes, tokens, keys, or encrypted blobs to normal DTOs.
- Redact sensitive columns in logs.
- Keep audit/security logs separate from normal debug logs.

---

## 20. Logging and observability

### 20.1 SQL logging

**MUST**:

- Use project-approved logging framework.
- Avoid logging bind values for sensitive queries.
- Keep SQL logging configurable per environment.
- Never enable verbose SQL logging by default in production.

### 20.2 Metrics/tracing

Persistence operations should emit or participate in telemetry:

- Query latency.
- Error count by mapper/operation.
- Timeout count.
- Rows returned/affected when useful.
- Connection pool wait time from pool metrics.
- Transaction duration.

**MUST NOT**:

- Use high-cardinality SQL text as metric label.
- Put raw IDs, usernames, emails, or SQL parameters into metric labels.

---

## 21. Interceptors/plugins

MyBatis plugins/interceptors are **restricted**.

Allowed only for cross-cutting infrastructure concerns such as:

- Observability.
- Tenant enforcement with strong tests.
- Query timeout enforcement.
- Auditing metadata.

**MUST**:

- Document interception point.
- Prove no SQL injection is introduced.
- Prove compatibility with batch/cursor/dynamic SQL.
- Keep plugin deterministic.
- Add integration tests.

**MUST NOT**:

- Rewrite SQL text with regex in production.
- Hide authorization inside plugin without visible service contract.
- Mutate parameters unpredictably.
- Add plugin to “fix” bad mapper design.

---

## 22. Configuration standards

### 22.1 MyBatis config

**MUST** review these settings before change:

- `mapUnderscoreToCamelCase`
- `autoMappingBehavior`
- `autoMappingUnknownColumnBehavior`
- `lazyLoadingEnabled`
- `aggressiveLazyLoading`
- `defaultStatementTimeout`
- `defaultFetchSize`
- `localCacheScope`
- `cacheEnabled`
- `jdbcTypeForNull`
- `callSettersOnNulls`
- `returnInstanceForEmptyRow`
- `logImpl`

### 22.2 Forbidden casual changes

**MUST NOT** casually change global settings to make one mapper pass.

Examples:

- Enabling `FULL` auto-mapping globally.
- Enabling global lazy loading without reviewing N+1 behavior.
- Enabling second-level cache globally.
- Changing null handling globally to match one DTO.

---

## 23. XML mapper structure

### 23.1 Ordering

Mapper XML should be ordered consistently:

1. Namespace declaration.
2. Cache configuration only if approved.
3. Result maps.
4. Reusable SQL fragments.
5. Select statements.
6. Insert/update/delete statements.
7. Stored procedure statements.

### 23.2 Naming

**MUST**:

- Use statement IDs matching mapper method names.
- Use result map names ending in `ResultMap`.
- Use reusable SQL fragments ending in `Columns`, `Where`, or specific intent.
- Keep aliases consistent.

Example:

```xml
<mapper namespace="com.example.user.persistence.UserMapper">
  <resultMap id="UserSummaryResultMap" type="com.example.user.persistence.UserSummaryRow">
    <id property="id" column="user_id" />
    <result property="username" column="user_username" />
  </resultMap>

  <sql id="UserSummaryColumns">
    u.id as user_id,
    u.username as user_username
  </sql>

  <select id="findSummaryById" resultMap="UserSummaryResultMap">
    select <include refid="UserSummaryColumns" />
    from users u
    where u.id = #{id,jdbcType=BIGINT}
  </select>
</mapper>
```

---

## 24. Annotation mapper standards

Annotation mappers are allowed only for simple SQL.

**MUST**:

- Use `@Param` for named parameters.
- Keep SQL readable.
- Move to XML when query grows.
- Avoid provider annotations unless dynamic SQL design is reviewed.

**MUST NOT**:

- Use annotation SQL with complex string concatenation.
- Use `${}` with request input.
- Put multiline business query in Java annotation if XML would be clearer.

---

## 25. MyBatis Dynamic SQL policy

MyBatis Dynamic SQL is **restricted**, not default.

Allowed when:

- It reduces unsafe manual dynamic SQL.
- Query construction is type-safe/readable.
- SQL remains reviewable.
- Provider methods are not exposed to arbitrary user input.
- Generated SQL and parameters are tested.

**MUST**:

- Keep DSL models close to database table definitions.
- Use allow-listed sort/filter fields.
- Test generated SQL for common paths.
- Avoid hiding SQL shape from reviewers.

**MUST NOT**:

- Use Dynamic SQL to accept arbitrary client filters.
- Use generated DSL when static XML is simpler.
- Mix Dynamic SQL and XML for the same statement without reason.

---

## 26. Concurrency and thread safety

**MUST**:

- Treat mapper interfaces injected by MyBatis-Spring as thread-safe proxies only within framework-managed lifecycle.
- Treat raw `SqlSession` as not shareable across threads.
- Keep transaction/session scoped to one thread unless framework explicitly supports propagation.
- Avoid parallel streams over mapper calls.
- Avoid asynchronous mapper calls inside the same transaction unless context propagation is explicitly designed.

**MUST NOT**:

- Store `SqlSession` in static field.
- Reuse raw `SqlSession` across requests.
- Pass mapper/session into background thread casually.
- Use `ThreadLocal` to hide database session ownership.

---

## 27. Performance rules

### 27.1 Query performance

**MUST**:

- Review execution plan for new complex queries.
- Add/confirm indexes for predicates and ordering.
- Avoid selecting unused columns.
- Avoid unbounded result sets.
- Avoid N+1 nested selects.
- Use batch operations deliberately.
- Measure before claiming performance improvement.

### 27.2 Mapper performance anti-patterns

**FORBIDDEN**:

- Loop over rows and call another mapper for each row unless cardinality is tiny and documented.
- `select *` for large tables.
- Large `IN` lists without limit/chunking.
- Application-side filtering after loading too much data.
- Sorting large result sets in Java when database should sort.
- Dynamic SQL that prevents index usage without review.

---

## 28. Testing standards

### 28.1 Required tests

For every non-trivial mapper, provide tests for:

- SQL syntax against actual database or compatible container.
- Result mapping.
- Null handling.
- Empty result.
- Multiple rows.
- Duplicate row where not expected.
- Pagination and ordering.
- Dynamic SQL branch combinations.
- Injection attempt for dynamic identifiers.
- Tenant/security predicates.
- Update/delete affected row count.
- Optimistic locking if used.

### 28.2 Test database policy

**MUST**:

- Prefer Testcontainers or project-approved integration database for SQL behavior.
- Avoid relying only on H2 if production database is PostgreSQL, Oracle, SQL Server, or MySQL and SQL is vendor-specific.
- Seed minimal deterministic test data.
- Verify result mapping against exact expected DTO.

**MUST NOT**:

- Mock mapper XML behavior as the only test.
- Use production-like large fixtures for all tests.
- Make mapper tests depend on wall-clock time without injectable clock/test data.

### 28.3 SQL injection tests

Any mapper using `${}` must have tests showing:

- Allowed identifiers work.
- Disallowed identifiers are rejected before mapper call.
- Malicious strings are not substituted.
- Sort direction cannot be injected.

---

## 29. Migration standards

### 29.1 JDBC to MyBatis

When replacing JDBC with MyBatis:

**MUST**:

- Preserve transaction boundary.
- Preserve timeout/fetch size behavior.
- Preserve generated key behavior.
- Preserve batch behavior.
- Preserve exception mapping.
- Add integration tests proving equivalent SQL behavior.

### 29.2 JPA/Hibernate to MyBatis

When replacing ORM with MyBatis:

**MUST**:

- Recreate optimistic locking manually.
- Recreate cascade/relationship behavior manually or remove it intentionally.
- Recreate audit behavior.
- Recreate tenant predicates.
- Recreate soft-delete filters.
- Recreate lifecycle callbacks explicitly if needed.

**MUST NOT** assume MyBatis provides ORM lifecycle semantics.

### 29.3 MyBatis version migration

**MUST**:

- Read official migration/release notes.
- Run mapper integration tests.
- Verify behavior of dynamic SQL, type handlers, plugin interceptors, cache, and Spring integration.
- Verify Java/Spring compatibility.

---

## 30. Forbidden patterns

The following are forbidden unless explicit architecture/security approval exists:

- User-controlled `${}` substitution.
- `select *` in application mappers.
- Unbounded list queries exposed to API.
- Direct mapper injection into controllers/resources.
- Dynamic raw SQL from request payload.
- Silent exception swallowing in repository/mapper layer.
- Returning `Map<String,Object>` as default API/persistence shape.
- Enabling second-level cache casually.
- Global `FULL` auto-mapping.
- Raw `SqlSession` shared across threads.
- Manual commit/rollback on Spring-managed sessions.
- Nested selects for large list queries.
- SQL text rewrite plugin without security review.
- Sensitive data in SQL logs.
- Test suite that does not execute mapper SQL against a real/compatible database.

---

## 31. Restricted patterns

Allowed only with design note and tests:

- `${}` for identifiers.
- MyBatis Dynamic SQL.
- Provider annotations.
- Stored procedures.
- Custom TypeHandler.
- MyBatis plugins/interceptors.
- Second-level cache.
- Lazy loading.
- Nested select relationship loading.
- `ExecutorType.BATCH`.
- Cursor/streaming results.
- Database-specific SQL hints.
- Multi-datasource mapper configuration.

---

## 32. Required design note for non-trivial mapper

For any new non-trivial mapper/query, LLM agents must produce or update a design note containing:

```markdown
## MyBatis Mapper Design Note

### Mapper
- Interface:
- XML file:
- Statement IDs:

### Purpose
- Business use case:
- Read/write/reporting:

### SQL shape
- Tables/views/procedures:
- Joins:
- Predicates:
- Ordering:
- Pagination/bounds:

### Parameter safety
- Runtime values use `#{}`:
- Any `${}` usage:
- Identifier allow-list:

### Result mapping
- resultMap/resultType:
- Column aliases:
- Nested mapping:
- Cardinality:

### Transaction
- Required transaction boundary:
- Isolation/locking:
- Expected affected rows:

### Performance
- Expected cardinality:
- Index assumptions:
- N+1 risk:
- Fetch size/batch size:

### Security
- Tenant predicates:
- Authorization assumptions:
- Sensitive columns:

### Tests
- Integration tests:
- Dynamic SQL branch tests:
- Injection tests:
- Mapping tests:
```

---

## 33. Code review checklist

Reviewer must reject the change if any answer is unclear:

### Mapper/API

- [ ] Is mapper interface small and intention-revealing?
- [ ] Are method names aligned with statement IDs?
- [ ] Are multiple parameters named with `@Param` or wrapped in parameter object?
- [ ] Are return types precise and null-safe?

### SQL safety

- [ ] Are all values bound with `#{}`?
- [ ] Is every `${}` justified and allow-listed?
- [ ] Are dynamic identifiers not user-controlled?
- [ ] Are dynamic SQL branches tested?

### Result mapping

- [ ] Is `select *` absent?
- [ ] Are join columns explicitly aliased?
- [ ] Are complex mappings using `resultMap`?
- [ ] Do nested results include `<id>`?
- [ ] Is auto-mapping not hiding join bugs?

### Transaction/correctness

- [ ] Is transaction boundary explicit?
- [ ] Are update/delete affected rows checked where needed?
- [ ] Is optimistic locking implemented where needed?
- [ ] Are generated keys tested with actual database/driver?

### Performance

- [ ] Is query bounded/paginated?
- [ ] Is ordering deterministic?
- [ ] Is N+1 avoided or justified?
- [ ] Are indexes/execution plans considered?
- [ ] Is batch/fetch size bounded?

### Security

- [ ] Are tenant predicates mandatory where needed?
- [ ] Is authorization not hidden only in SQL?
- [ ] Are sensitive values not logged?
- [ ] Are SQL injection tests present for restricted dynamic SQL?

### Testing

- [ ] Does integration test execute real mapper SQL?
- [ ] Are null/empty/duplicate/cardinality cases tested?
- [ ] Are database-specific features tested on compatible database?
- [ ] Are failure paths tested?

---

## 34. LLM implementation contract

When generating or modifying MyBatis code, the LLM agent must follow this contract:

```text
You are implementing Java persistence using MyBatis.

Mandatory rules:
1. Do not use `${}` for runtime values.
2. Use `#{}` for all bind values.
3. If SQL identifiers must be dynamic, use enum/allow-list and document it.
4. Do not use `select *`.
5. Use explicit resultMap for joins or non-trivial mapping.
6. Alias every joined column.
7. Do not inject mappers into controllers/resources.
8. Keep transaction boundary in service/application layer.
9. Do not manually commit/rollback Spring-managed SqlSession.
10. Do not enable second-level cache unless explicitly approved.
11. Avoid nested select N+1; prefer joined result mapping or bounded query.
12. Add integration tests that execute mapper SQL against compatible database.
13. For every mapper change, explain cardinality, transaction behavior, security predicates, and performance risk.
14. If unsure whether a query is safe, choose the simpler static SQL and ask for explicit approval only in the design note, not by silently adding dynamic SQL.
```

---

## 35. Minimal approved examples

### 35.1 Simple mapper interface

```java
public interface UserMapper {
    Optional<UserRow> findById(@Param("id") long id);

    List<UserSummaryRow> search(
            @Param("status") String status,
            @Param("limit") int limit,
            @Param("offset") int offset);

    int updateStatus(
            @Param("id") long id,
            @Param("expectedVersion") long expectedVersion,
            @Param("status") String status);
}
```

### 35.2 Safe XML mapper

```xml
<mapper namespace="com.example.user.persistence.UserMapper">
  <resultMap id="UserRowResultMap" type="com.example.user.persistence.UserRow">
    <id property="id" column="user_id" />
    <result property="username" column="user_username" />
    <result property="status" column="user_status" />
    <result property="version" column="user_version" />
  </resultMap>

  <select id="findById" resultMap="UserRowResultMap">
    select
      u.id as user_id,
      u.username as user_username,
      u.status as user_status,
      u.version as user_version
    from users u
    where u.id = #{id,jdbcType=BIGINT}
  </select>

  <select id="search" resultMap="UserRowResultMap">
    select
      u.id as user_id,
      u.username as user_username,
      u.status as user_status,
      u.version as user_version
    from users u
    where u.status = #{status,jdbcType=VARCHAR}
    order by u.id asc
    limit #{limit,jdbcType=INTEGER}
    offset #{offset,jdbcType=INTEGER}
  </select>

  <update id="updateStatus">
    update users
    set status = #{status,jdbcType=VARCHAR},
        version = version + 1
    where id = #{id,jdbcType=BIGINT}
      and version = #{expectedVersion,jdbcType=BIGINT}
  </update>
</mapper>
```

### 35.3 Service boundary

```java
public final class UserService {
    private final UserMapper userMapper;

    public UserService(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    @Transactional
    public void changeStatus(long userId, long expectedVersion, UserStatus newStatus) {
        int affected = userMapper.updateStatus(userId, expectedVersion, newStatus.name());
        if (affected != 1) {
            throw new OptimisticUpdateFailedException("User was modified by another transaction");
        }
    }
}
```

---

## 36. References

Use these as primary references when updating this standard:

- MyBatis 3 Reference Documentation: https://mybatis.org/mybatis-3/
- MyBatis 3 Mapper XML Files: https://mybatis.org/mybatis-3/sqlmap-xml.html
- MyBatis 3 Java API: https://mybatis.org/mybatis-3/java-api.html
- MyBatis-Spring Reference Documentation: https://mybatis.org/spring/
- MyBatis-Spring Transactions: https://mybatis.org/spring/transactions.html
- MyBatis Dynamic SQL Documentation: https://mybatis.org/mybatis-dynamic-sql/docs/howItWorks.html
- OWASP SQL Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- Java JDBC standards in this repository: `strict-coding-standards__jdbc.md`
- Java Security standards in this repository: `strict-coding-standards__java_security.md`

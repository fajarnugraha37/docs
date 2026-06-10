# Strict Coding Standards: Java + PostgreSQL

> **Document status:** mandatory standard for LLM-assisted Java implementation that interacts with PostgreSQL.
>
> **Applies to:** Java 11/17/21/25 services using PostgreSQL through JDBC, JPA/Hibernate/EclipseLink, MyBatis, jOOQ, Spring JDBC, R2DBC, Flyway/Liquibase, batch jobs, and migration tooling.
>
> **Depends on:**
>
> - `strict-coding-standards__jdbc.md`
> - `strict-coding-standards__jpa.md`
> - `strict-coding-standards__java_hibernate_orm.md`
> - `strict-coding-standards__java_mybatis.md`
> - `strict-coding-standards__java_security.md`
> - `strict-coding-standards__java_testing.md`
> - `strict-coding-standards__java_benchmarking.md`
>
> **Core principle:** PostgreSQL-specific behavior must be explicit. Do not assume generic SQL/JDBC behavior is enough for transaction semantics, locking, indexing, JSONB, time zones, UUIDs, batch writes, pagination, or operational correctness.

---

## 1. Scope

This standard governs how Java code may interact with PostgreSQL.

It covers:

- PostgreSQL version and driver compatibility
- pgJDBC usage
- connection pool configuration
- transaction isolation
- locking and concurrency
- prepared statements
- SQL parameter binding
- schema migration
- type mapping
- UUIDs
- timestamps and time zones
- JSON/JSONB
- arrays and enums
- pagination
- indexing expectations
- bulk operations
- retry and idempotency
- advisory locks
- listen/notify
- observability
- testing
- performance evidence

This file does **not** replace general SQL, JDBC, ORM, or security standards. It adds PostgreSQL-specific rules.

---

## 2. Non-negotiable rules for LLM code agents

LLM agents **MUST NOT** write Java/PostgreSQL code until they can answer these questions:

1. Which PostgreSQL major version is targeted?
2. Which Java baseline is targeted?
3. Which access layer is used: JDBC, Spring JDBC, MyBatis, JPA/Hibernate, EclipseLink, jOOQ, R2DBC, or another library?
4. Who owns transaction boundaries?
5. Is the operation read-only, write, idempotent write, bulk write, or migration?
6. What is the expected row count/cardinality?
7. What indexes support the query?
8. What happens under retry, timeout, duplicate request, and concurrent update?
9. What data type mapping is expected between Java and PostgreSQL?
10. What evidence proves the query is safe and performant?

If any answer is unknown, the agent must either inspect the codebase/migrations/configuration or state the assumption explicitly in the implementation notes.

---

## 3. Version and compatibility policy

### 3.1 PostgreSQL version

Every project must declare a supported PostgreSQL major version range.

Examples:

```text
Supported PostgreSQL: 15.x - 18.x
Production PostgreSQL: 16.x
Development PostgreSQL: 16.x via Testcontainers
```

Rules:

- Do not use syntax/features from a newer PostgreSQL version unless the project version range allows it.
- Do not rely on current PostgreSQL behavior without checking the target version docs.
- Do not introduce feature-specific SQL without migration notes.
- Do not assume managed PostgreSQL services expose all extensions or superuser-level features.

### 3.2 pgJDBC version

Rules:

- The PostgreSQL JDBC driver version must be pinned through Maven/Gradle dependency management.
- Do not rely on transitive pgJDBC version from framework starters.
- The driver version must be compatible with the Java baseline.
- Driver configuration must be reviewed as part of database behavior, not as infrastructure trivia.

Recommended dependency declaration:

```xml
<dependency>
  <groupId>org.postgresql</groupId>
  <artifactId>postgresql</artifactId>
  <version>${postgresql.jdbc.version}</version>
</dependency>
```

```kotlin
dependencies {
    implementation("org.postgresql:postgresql:${libs.versions.postgresql.jdbc.get()}")
}
```

Forbidden:

```xml
<!-- Forbidden: unpinned version through accidental transitive dependency -->
```

---

## 4. Access-layer decision matrix

| Use case                           | Preferred tool                                        | Avoid                                |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| Simple CRUD with rich domain model | JPA/Hibernate with explicit fetch plans               | Entity-as-API response               |
| SQL-first service                  | MyBatis, jOOQ, Spring JDBC                            | Hidden dynamic SQL concatenation     |
| Complex reporting query            | SQL/jOOQ/MyBatis with DTO projection                  | ORM entity graph abuse               |
| Bulk import/export                 | JDBC `COPY`, batch, staged tables                     | Row-by-row ORM persist               |
| Event outbox polling               | JDBC/SQL with `FOR UPDATE SKIP LOCKED` when justified | Unbounded select + update race       |
| PostgreSQL-specific types          | jOOQ, JDBC, custom TypeHandler/UserType               | Generic object mapping without tests |
| Schema migration                   | Flyway/Liquibase                                      | Runtime ORM schema update            |

Rules:

- Use the least magical layer that still preserves correctness and maintainability.
- PostgreSQL-specific SQL is allowed, but it must be explicit and tested.
- ORM is not a replacement for understanding PostgreSQL query plans.
- Raw SQL is not a replacement for validation, parameter binding, transaction design, and migration discipline.

---

## 5. Connection and pool standards

### 5.1 DataSource only

Application code must use `DataSource`, not `DriverManager`.

Allowed:

```java
public final class AccountRepository {
    private final DataSource dataSource;

    public AccountRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }
}
```

Forbidden:

```java
Connection connection = DriverManager.getConnection(url, user, password);
```

Exceptions:

- tiny CLI migration/debug tool with explicit lifecycle
- test-only code
- one-off admin script with approval

### 5.2 Pool sizing must be justified

Connection pools must be sized based on:

- PostgreSQL `max_connections`
- application replica count
- workload concurrency
- transaction duration
- database CPU/IO capacity
- connection proxy/pooler usage such as PgBouncer

Forbidden:

```properties
maximumPoolSize=100
```

without evidence.

Required notes:

```text
Pool size rationale:
- service replicas: 6
- max pool per replica: 8
- max application connections: 48
- DB max_connections: 200
- reserved admin/background capacity: 40
- transaction p95: 45 ms
```

### 5.3 Connection lifetime

Rules:

- Connections must not be stored in fields.
- Connections must not cross request/job boundaries.
- Connections must be closed by `try-with-resources` or framework transaction management.
- Long-running transactions must be treated as production risk.
- Connection leak detection should be enabled in non-production or during diagnosis.

Forbidden:

```java
private Connection connection;
```

---

## 6. URL and connection properties

### 6.1 URL must be externalized

Database URL, username, password, and SSL mode must come from configuration/secrets.

Forbidden:

```java
String url = "jdbc:postgresql://prod-db:5432/main";
```

Allowed:

```java
@ConfigurationProperties(prefix = "app.datasource")
public record DatabaseProperties(
        URI endpoint,
        String database,
        String username,
        String password,
        String sslMode
) {}
```

### 6.2 SSL mode must be explicit

Production database connections must define SSL requirements explicitly.

Examples:

```text
sslmode=verify-full
sslrootcert=/etc/ssl/postgresql/root.crt
```

Rules:

- Do not disable certificate validation in production.
- Do not use `sslmode=disable` unless local-only and documented.
- Do not store client cert/key material in source code or image layers.

### 6.3 Application name

Connections should set `ApplicationName` or equivalent pool property.

Purpose:

- identify workload in `pg_stat_activity`
- correlate database activity to service/module
- simplify incident response

Example:

```properties
spring.datasource.hikari.data-source-properties.ApplicationName=order-service
```

---

## 7. Prepared statement and parameter binding rules

### 7.1 Runtime values must be bound

All runtime values must use bind parameters.

Allowed:

```java
String sql = """
        select id, status, created_at
        from orders
        where customer_id = ?
          and status = ?
        order by created_at desc
        limit ?
        """;

try (PreparedStatement statement = connection.prepareStatement(sql)) {
    statement.setObject(1, customerId);
    statement.setString(2, status.name());
    statement.setInt(3, limit);
}
```

Forbidden:

```java
String sql = "select * from orders where customer_id = '" + customerId + "'";
```

### 7.2 Dynamic identifiers require allow-lists

Bind parameters cannot bind identifiers such as table names, column names, or sort direction. These must use allow-lists.

Allowed:

```java
enum OrderSortField {
    CREATED_AT("created_at"),
    UPDATED_AT("updated_at"),
    TOTAL_AMOUNT("total_amount");

    private final String columnName;

    OrderSortField(String columnName) {
        this.columnName = columnName;
    }

    String columnName() {
        return columnName;
    }
}
```

Forbidden:

```java
String sql = "order by " + request.sortBy();
```

### 7.3 Server-side prepare is not an injection control

Prepared statements are required for SQL injection defense. Server-side prepare is a driver/database performance behavior and must not be confused with security.

Rules:

- Do not tune `prepareThreshold` without performance evidence.
- Be aware of generic vs custom plan behavior for parameter-sensitive queries.
- Investigate prepared statement behavior if performance changes after repeated executions.

---

## 8. Transaction standards

### 8.1 Transaction ownership must be explicit

Every write path must identify who owns the transaction:

- Spring `@Transactional`
- Jakarta transaction manager
- manual JDBC transaction
- batch framework
- message listener container
- test transaction

Forbidden:

```java
// Hidden transaction boundary; unclear commit/rollback semantics.
repository.save(entity);
eventPublisher.publish(event);
```

Allowed design note:

```text
Transaction boundary:
- Owner: OrderApplicationService.placeOrder()
- Begins before inventory reservation insert
- Commits after outbox event insert
- External event publication is outside transaction via outbox poller
```

### 8.2 Manual JDBC transactions

Manual JDBC transaction code must follow this structure:

```java
boolean previousAutoCommit = connection.getAutoCommit();
connection.setAutoCommit(false);
try {
    // write operations
    connection.commit();
} catch (SQLException e) {
    try {
        connection.rollback();
    } catch (SQLException rollbackFailure) {
        e.addSuppressed(rollbackFailure);
    }
    throw e;
} finally {
    connection.setAutoCommit(previousAutoCommit);
}
```

Rules:

- Always rollback on failure.
- Preserve suppressed rollback failure.
- Restore auto-commit if the connection returns to a pool.
- Do not perform remote network calls inside DB transaction unless explicitly justified.

### 8.3 Read-only transactions

Read-only database operations should use read-only transaction hints when supported by framework/pool.

Rules:

- Do not assume read-only flag enforces all safety at application level.
- Do not use read-only transactions for code that writes temp tables, advisory locks, or audit entries unless tested.

---

## 9. PostgreSQL isolation and concurrency policy

### 9.1 Isolation levels

Default isolation must be documented.

PostgreSQL commonly uses `READ COMMITTED` as default. Higher isolation levels must be chosen for correctness, not as generic “safer” setting.

Rules:

- Do not raise isolation globally without concurrency/performance review.
- Use optimistic locking or explicit locking for known conflict points.
- Treat serialization failures as retryable only when the whole transaction is idempotent.

### 9.2 Lost update protection

For update paths that depend on current state, use one of:

- optimistic version column
- `where version = ?`
- `select ... for update`
- atomic conditional update
- unique constraint as concurrency guard
- serializable transaction with retry policy

Allowed:

```sql
update cases
set status = ?, version = version + 1, updated_at = now()
where id = ?
  and version = ?
```

Forbidden:

```java
CaseEntity entity = repository.findById(id);
entity.setStatus(APPROVED);
repository.save(entity);
```

when concurrent updates are possible and no version check exists.

### 9.3 Locking must be intentional

`FOR UPDATE`, `FOR SHARE`, `SKIP LOCKED`, `NOWAIT`, and advisory locks are restricted tools.

Required before using locks:

- state what is protected
- state lock scope
- state transaction duration
- state deadlock risk
- state retry behavior
- state monitoring signal

---

## 10. Advisory lock policy

Advisory locks are allowed only when row/table locks cannot represent the domain lock.

Allowed cases:

- distributed job singleton per tenant
- coarse-grained maintenance lock
- migration coordination
- external resource synchronization

Restricted:

```sql
select pg_try_advisory_xact_lock(?);
```

Rules:

- Prefer transaction-level advisory locks over session-level locks.
- Never hold advisory locks across user interaction or remote calls.
- Lock key derivation must be deterministic and collision-conscious.
- Failure to acquire lock must have explicit behavior.

Forbidden:

```sql
select pg_advisory_lock(?);
```

without clear release and timeout strategy.

---

## 11. Schema migration policy

### 11.1 Production DDL must be migration-managed

Production schema changes must be done through Flyway, Liquibase, or approved migration tooling.

Forbidden:

```properties
spring.jpa.hibernate.ddl-auto=update
hibernate.hbm2ddl.auto=update
```

Allowed:

```text
V20260610_001__add_order_status_index.sql
```

### 11.2 Migration scripts must be forward-safe

Migration rules:

- Use explicit names for constraints and indexes.
- Avoid long blocking table rewrites.
- Use `create index concurrently` when appropriate.
- Split destructive changes into expand/migrate/contract steps.
- Backfill in bounded batches for large tables.
- Never assume table is small unless checked.
- Include rollback or mitigation note.

### 11.3 Expand/migrate/contract pattern

Preferred production-safe flow:

1. Add nullable/new column or table.
2. Deploy app writing both old and new paths if needed.
3. Backfill in batches.
4. Add constraints/indexes safely.
5. Switch reads.
6. Remove old column in later release.

---

## 12. Naming standards

### 12.1 Database object names

Rules:

- Use lowercase snake_case for PostgreSQL objects.
- Avoid quoted identifiers.
- Use explicit constraint/index names.
- Names must be stable across environments.

Allowed:

```sql
create table order_items (
    id uuid primary key,
    order_id uuid not null,
    product_id uuid not null,
    quantity integer not null,
    constraint fk_order_items_order
        foreign key (order_id) references orders(id)
);
```

Forbidden:

```sql
create table "OrderItems" (...);
```

### 12.2 Index names

Recommended format:

```text
idx_<table>__<columns_or_expression>
uidx_<table>__<columns>
fk_<table>__<referenced_table>
chk_<table>__<business_rule>
```

Examples:

```sql
create index idx_orders__customer_id_created_at
    on orders (customer_id, created_at desc);

create unique index uidx_users__tenant_id_email_lower
    on users (tenant_id, lower(email));
```

---

## 13. Type mapping standards

### 13.1 UUID

Prefer PostgreSQL `uuid` and Java `java.util.UUID` for technical identifiers when UUID is required.

Rules:

- Do not store UUID as `varchar` without compatibility reason.
- Do not generate UUID in multiple inconsistent formats.
- For insertion-order-sensitive workloads, evaluate UUIDv7/ULID/time-ordered IDs when target PostgreSQL/application stack supports it.

Allowed:

```java
statement.setObject(1, orderId);
UUID id = resultSet.getObject("id", UUID.class);
```

### 13.2 Numeric and money

Rules:

- Use `numeric(p, s)` for exact decimal values.
- Use `BigDecimal` in Java for exact decimal/money.
- Do not use `double`/`float` for money.
- Rounding must be explicit.
- Database precision/scale must match Java validation.

Allowed:

```sql
amount numeric(19, 4) not null
```

```java
BigDecimal amount = resultSet.getBigDecimal("amount");
```

### 13.3 Text

Rules:

- Prefer `text` or bounded `varchar(n)` based on domain constraint.
- `varchar(n)` should represent real business max length, not arbitrary DB habit.
- Validate length in Java and database when it is part of API/domain contract.
- Be explicit about case-insensitive uniqueness.

### 13.4 Boolean

Use PostgreSQL `boolean` and Java `boolean`/`Boolean` based on nullability.

Rules:

- Avoid `Y/N`, `0/1`, or string flags for new schema.
- Nullable boolean must be justified because it creates three-valued logic.

### 13.5 Date and time

Rules:

- Use `timestamptz` for event/audit timestamps.
- Use `timestamp without time zone` only for local wall-clock values where timezone is intentionally absent.
- Use `date` for date-only business values.
- Use `Instant` or `OffsetDateTime` for `timestamptz` boundary depending on project convention.
- Do not store Java `LocalDateTime` as global event time.
- Do not depend on database/session timezone implicitly.

Recommended:

```sql
created_at timestamptz not null default now()
```

```java
Instant createdAt = resultSet.getObject("created_at", OffsetDateTime.class).toInstant();
```

### 13.6 JSONB

Use `jsonb` only when relational modeling is intentionally insufficient or flexibility is required.

Allowed cases:

- external webhook payload snapshot
- audit/event metadata
- semi-structured extension field
- sparse attributes not used as core relational dimensions

Forbidden by default:

- replacing normal relational schema with JSONB
- storing core searchable fields only inside JSONB
- storing user-facing workflow state exclusively in JSONB
- writing JSONB queries without index strategy

### 13.7 Arrays

PostgreSQL arrays are restricted.

Allowed cases:

- small, bounded, non-relational values
- query patterns that are explicitly supported by indexes/operators
- compatibility with existing schema

Avoid arrays when:

- values need foreign keys
- values need audit/history
- values need separate lifecycle
- collection can grow unbounded
- ordering has domain meaning

### 13.8 Enums

PostgreSQL enum types are restricted.

Allowed:

- stable, slow-changing values with strong DB-level constraints

Prefer lookup tables or text + check constraint when:

- values change frequently
- values need localization
- values need metadata
- values need soft deprecation
- multi-tenant customization exists

Java mapping rules:

- Do not persist enum ordinal.
- Persist stable string/code value.
- Unknown DB values must have clear failure behavior.

---

## 14. JSONB standards

### 14.1 JSONB is not a schema escape hatch

Every JSONB column must have a design note:

```text
JSONB column: metadata
Purpose: external provider attributes not controlled by our schema
Query pattern: only provider_type and request_id are queried
Index strategy: expression index on (metadata->>'requestId') for support lookup
Validation: DTO schema validation before persistence
Retention: same as parent row
```

### 14.2 JSONB query rules

Rules:

- Query operators must match index strategy.
- Known scalar paths should usually use expression indexes.
- Containment/path existence queries may use GIN indexes when justified.
- Do not cast JSON values inside hot queries without expression index.
- Do not query large JSONB blobs in high-volume endpoints without benchmark.

Example:

```sql
create index idx_events__metadata_request_id
    on events ((metadata->>'requestId'));
```

### 14.3 JSONB mutation rules

Rules:

- Avoid partial JSONB updates for domain state unless concurrency behavior is clear.
- Prefer replacing validated whole JSON value for API-owned documents.
- For partial update, use optimistic locking/version check.

Forbidden:

```sql
update cases
set payload = jsonb_set(payload, '{status}', '"APPROVED"')
where id = ?
```

without version/concurrency rule.

---

## 15. Query design standards

### 15.1 Every non-trivial query must document cardinality

For each query, specify expected cardinality:

- exactly one
- zero or one
- bounded list
- paginated list
- unbounded stream
- aggregate
- batch update

Forbidden:

```java
List<Order> orders = jdbcTemplate.query("select * from orders", mapper);
```

unless intentionally bounded by environment/test fixture.

### 15.2 SELECT columns explicitly

Forbidden:

```sql
select * from orders
```

Allowed:

```sql
select id, customer_id, status, created_at, updated_at
from orders
where id = ?
```

Exceptions:

- ad-hoc debugging
- migration scripts where all columns are intentionally copied and reviewed
- test-only assertions where acceptable

### 15.3 LIMIT requires deterministic ordering

Forbidden:

```sql
select id from orders limit 100
```

Allowed:

```sql
select id
from orders
where status = 'PENDING'
order by created_at asc, id asc
limit 100
```

### 15.4 Pagination policy

Offset pagination is allowed only for small/admin pages.

For high-cardinality or user-facing infinite-scroll queries, prefer keyset pagination.

Allowed keyset pattern:

```sql
select id, created_at, status
from orders
where customer_id = ?
  and (created_at, id) < (?, ?)
order by created_at desc, id desc
limit ?
```

Rules:

- Pagination order must be stable and unique.
- Pagination query must be backed by a matching index.
- Do not expose raw database IDs as cursors without signing/encoding if security-sensitive.

### 15.5 Counting policy

`count(*)` on large filtered datasets may be expensive.

Rules:

- Do not add exact total count to high-volume endpoints by default.
- Consider approximate count, capped count, or no count.
- If exact count is required, add query plan evidence.

---

## 16. Indexing standards

### 16.1 Index must match query

Every hot query must have index evidence.

Evidence should include:

```text
Query: find pending orders by customer sorted by created_at
Index: idx_orders__customer_status_created_at_id
SQL:
  create index idx_orders__customer_status_created_at_id
      on orders (customer_id, status, created_at desc, id desc);
Plan evidence:
  EXPLAIN (ANALYZE, BUFFERS) on production-like data
```

### 16.2 Indexes are not free

Rules:

- Do not add indexes without query/use case.
- Consider write overhead.
- Consider index bloat.
- Consider selectivity.
- Consider partial indexes for common filtered subsets.
- Consider expression indexes for computed lookup.

### 16.3 Partial index policy

Allowed:

```sql
create index idx_jobs__pending_created_at
    on jobs (created_at, id)
    where status = 'PENDING';
```

Rules:

- Predicate must match query condition.
- Query code must keep predicate stable.
- Do not use partial index if business state values change too frequently without evidence.

### 16.4 Expression index policy

Allowed:

```sql
create unique index uidx_users__tenant_email_lower
    on users (tenant_id, lower(email));
```

Rules:

- Java normalization and database expression must be aligned.
- Collation/locale rules must be reviewed.
- Do not use expression indexes to hide poor input normalization.

### 16.5 Concurrent index creation

For large production tables, prefer:

```sql
create index concurrently idx_orders__customer_id_created_at
    on orders (customer_id, created_at desc);
```

Rules:

- `create index concurrently` cannot run inside a transaction block.
- Migration tooling must support non-transactional migration for this step.
- Failure cleanup must be documented.

---

## 17. Bulk write and import standards

### 17.1 Batch insert/update

Rules:

- Use JDBC batch or database-native bulk loading for large volumes.
- Batch size must be bounded and evidence-based.
- Disable auto-commit for batch units.
- Handle partial failure deterministically.
- Do not perform one transaction per row unless required.

Allowed:

```java
try (PreparedStatement statement = connection.prepareStatement(sql)) {
    int count = 0;
    for (OrderRow row : rows) {
        bind(statement, row);
        statement.addBatch();
        if (++count % batchSize == 0) {
            statement.executeBatch();
        }
    }
    statement.executeBatch();
}
```

### 17.2 COPY protocol

Use PostgreSQL `COPY` for very large import/export when appropriate.

Rules:

- Validate file format before import.
- Use staging tables for untrusted/dirty data.
- Do not directly copy unvalidated external data into core tables.
- Capture rejected rows/errors where business requires audit.

### 17.3 Upsert policy

`INSERT ... ON CONFLICT` is allowed with explicit conflict target.

Allowed:

```sql
insert into idempotency_keys (key, request_hash, created_at)
values (?, ?, now())
on conflict (key) do nothing
```

Rules:

- Conflict target must match unique constraint.
- Update branch must be concurrency-safe.
- Do not silently overwrite business state.

Forbidden:

```sql
on conflict do update set payload = excluded.payload
```

without explaining why overwrite is valid.

---

## 18. Retry standards

### 18.1 Retry only known transient failures

Potentially retryable categories:

- serialization failure
- deadlock detected
- connection acquisition failure
- transient network failure
- failover/restart window

Rules:

- Retry must be bounded.
- Retry must use backoff/jitter.
- Retry must preserve idempotency.
- Retry must not re-run irreversible external side effects.
- SQLSTATE mapping should be explicit where used.

### 18.2 Transaction retry must wrap the whole transaction

Forbidden:

```java
try {
    repository.updateBalance(accountId, delta);
} catch (DeadlockException e) {
    repository.updateBalance(accountId, delta);
}
```

Allowed concept:

```java
retryPolicy.execute(() -> transactionTemplate.execute(status -> {
    debit(source, amount);
    credit(target, amount);
    insertLedgerEntry(...);
    return null;
}));
```

---

## 19. Constraint-first correctness

Database constraints are mandatory for invariant enforcement that must survive concurrency and multiple application instances.

Required where applicable:

- primary key
- foreign key
- unique constraint
- check constraint
- not-null constraint
- exclusion constraint

Allowed:

```sql
alter table orders
add constraint chk_orders__total_amount_non_negative
check (total_amount >= 0);
```

Rules:

- Java validation improves UX; database constraints preserve integrity.
- Do not rely only on Java validation for uniqueness or concurrency-sensitive rules.
- Constraint violation must be mapped to domain/API error when user-facing.

---

## 20. Foreign key and cascade policy

Rules:

- Foreign keys are default required for relational integrity.
- `ON DELETE CASCADE` is restricted and must be domain-justified.
- Avoid cascade delete across audit/regulatory/history data.
- Use soft delete only with clear uniqueness/index strategy.

Forbidden:

```sql
on delete cascade
```

without deletion impact analysis.

Required deletion design note:

```text
Delete behavior:
- Parent: customer_profile
- Child: customer_address
- Cascade allowed because address has no independent lifecycle
- Audit rows are not cascaded
- Delete endpoint is admin-only and audited
```

---

## 21. Soft delete policy

Soft delete must be implemented consistently.

Rules:

- Use `deleted_at` or `is_deleted`, not both unless legacy.
- Every read query must define whether deleted rows are included.
- Unique indexes must account for active-only uniqueness.
- Soft-deleted rows must not accidentally reappear in joins.
- Purge/retention policy must exist.

Example:

```sql
create unique index uidx_users__tenant_email_active
    on users (tenant_id, lower(email))
    where deleted_at is null;
```

---

## 22. Outbox and event integration

When PostgreSQL is source of truth and events must be emitted, prefer transactional outbox.

Rules:

- Insert domain state and outbox row in the same transaction.
- Outbox row must have stable event ID.
- Consumer/publisher must be idempotent.
- Polling must be bounded and lock-aware.
- Failed events must have retry/DLQ/parking strategy.

Allowed polling pattern:

```sql
select id, aggregate_id, event_type, payload
from outbox_events
where status = 'PENDING'
order by created_at asc, id asc
limit ?
for update skip locked
```

Rules:

- `SKIP LOCKED` must be used only with clear fairness/starvation consideration.
- Do not delete outbox rows immediately unless audit/retention allows it.

---

## 23. LISTEN/NOTIFY policy

`LISTEN/NOTIFY` is restricted.

Allowed cases:

- lightweight wake-up signal
- cache invalidation hint
- internal coordination signal

Forbidden cases:

- durable event delivery
- business-critical message queue
- large payload transport
- cross-region guaranteed messaging

Rules:

- Treat notifications as hints, not durable events.
- Payload must be small.
- Receiver must recover by querying durable state.

---

## 24. Large result streaming

### 24.1 Do not load unbounded results

Forbidden:

```java
List<Row> rows = jdbcTemplate.query("select * from huge_table", mapper);
```

Allowed:

- keyset pagination
- cursor/fetch-size streaming
- batch processing by primary key ranges
- server-side export/COPY

### 24.2 pgJDBC cursor behavior

When using JDBC streaming/fetch size, confirm driver requirements.

Typical PostgreSQL JDBC considerations:

- auto-commit must be disabled for cursor-based fetching
- result set should be forward-only
- fetch size must be positive
- transaction stays open while consuming rows

Rules:

- Streaming result sets must be consumed and closed promptly.
- Do not stream inside long user request without timeout/cancellation.
- Do not combine streaming with slow remote calls per row.

---

## 25. Timeout standards

Application-level database operations must define timeouts.

Timeout types:

- connection acquisition timeout
- socket/connect timeout
- query timeout
- transaction timeout
- lock timeout
- statement timeout
- idle-in-transaction timeout

Rules:

- Do not rely solely on HTTP request timeout.
- Write operations must avoid indefinite lock waits.
- Admin/batch jobs must have separate timeout policy.

Example session setup:

```sql
set local statement_timeout = '5s';
set local lock_timeout = '1s';
```

Use carefully through framework support, transaction hooks, or migration tooling.

---

## 26. Security standards

### 26.1 SQL injection

Rules:

- Bind all runtime values.
- Allow-list identifiers.
- Do not concatenate user input into SQL.
- Do not expose raw SQL fragments in API request models.
- Do not use ORM/native query string construction without review.

### 26.2 Least privilege

Application database user must have only required privileges.

Rules:

- Runtime app user should not own schema.
- Migration user may have elevated DDL privileges but must not be used by runtime service.
- Read-only reporting user should be distinct when possible.
- Avoid superuser permissions.

### 26.3 Secrets

Rules:

- No database credentials in source code.
- No credentials in Docker image layers.
- No credentials in logs.
- Rotate credentials according to platform policy.
- Use secret manager/Kubernetes secrets/cloud IAM where available.

### 26.4 Row-level security

PostgreSQL Row Level Security is restricted and must be carefully reviewed.

Allowed only when:

- policy is tested at database level
- application tenant context is reliably set
- bypass roles are understood
- admin/maintenance behavior is documented

Do not add RLS casually to fix missing tenant filters in application code.

---

## 27. Observability standards

### 27.1 Query logging

Rules:

- Do not log SQL with raw sensitive parameter values.
- Log query identity, duration, row count, and error category where possible.
- Slow query logs must be enabled at database/platform level when appropriate.
- Application logs must include correlation/request ID.

Allowed log fields:

```json
{
  "event": "db.query.completed",
  "queryName": "OrderRepository.findPendingByCustomer",
  "durationMs": 18,
  "rowCount": 25,
  "database": "orders",
  "success": true
}
```

Forbidden:

```text
select * from users where email='alice@example.com' and password='...'
```

### 27.2 Metrics

Required metrics:

- connection pool active/idle/pending
- connection acquisition latency
- query latency by query name/category
- transaction duration
- rollback count
- deadlock/serialization failure count
- timeout count
- retry count
- migration duration

### 27.3 Tracing

Rules:

- Trace database spans by logical query name, not full SQL with sensitive values.
- Include database system tag as PostgreSQL when using OpenTelemetry conventions.
- Avoid high-cardinality labels.

### 27.4 Database-side diagnostics

During performance review, use:

- `EXPLAIN`
- `EXPLAIN (ANALYZE, BUFFERS)` on safe/prod-like data
- `pg_stat_activity`
- `pg_stat_statements` where available
- slow query logs
- connection pool metrics

---

## 28. Performance standards

### 28.1 No performance claims without evidence

Forbidden statements in PRs:

```text
This query is fast.
This index improves performance.
Batching should be enough.
Postgres will optimize it.
```

Required evidence:

```text
Evidence:
- Data volume: 10M orders, 100k customers
- Query p95 before: 430 ms
- Query p95 after: 32 ms
- Plan: index scan on idx_orders__customer_status_created_at_id
- Buffers: reduced from 18k shared reads to 120 hits/reads
```

### 28.2 Use EXPLAIN correctly

Rules:

- `EXPLAIN` shows plan estimate.
- `EXPLAIN ANALYZE` executes the query.
- Do not run mutating `EXPLAIN ANALYZE` on production unless wrapped safely and approved.
- Include realistic parameter values.
- Include enough data to expose bad plans.

### 28.3 Avoid N+1

N+1 can happen in:

- Hibernate lazy associations
- MyBatis nested selects
- manual repository loops
- REST layer enrichment

Forbidden:

```java
for (Order order : orders) {
    order.setItems(itemRepository.findByOrderId(order.id()));
}
```

Allowed:

```sql
select oi.*
from order_items oi
where oi.order_id = any (?::uuid[])
```

or one well-designed join/projection query.

---

## 29. ORM-specific PostgreSQL rules

### 29.1 Hibernate dialect

Rules:

- Hibernate dialect/version must match PostgreSQL target.
- Do not force old dialect unless migration requires it.
- Native PostgreSQL features through Hibernate must be tested with actual PostgreSQL.

### 29.2 Entity IDs

Rules:

- UUID IDs must map to PostgreSQL `uuid`.
- Sequence strategy must be tuned for batch inserts if using numeric IDs.
- Avoid `GenerationType.IDENTITY` when it blocks batching and high write throughput matters.

### 29.3 Native query mapping

Rules:

- Native queries must return DTO/projection unless entity hydration is intentional.
- Native queries must use bind parameters.
- Native query result columns must be explicit and aliased.

---

## 30. MyBatis-specific PostgreSQL rules

Rules:

- Use `#{}` for values.
- Use allow-listed `${}` only for identifiers/sort direction.
- PostgreSQL casts must not become injection vectors.
- `resultMap` must be explicit for joins.
- Dynamic SQL must be tested for all branches.

Allowed:

```xml
<select id="findByIds" resultMap="OrderResultMap">
  select id, customer_id, status, created_at
  from orders
  where id = any(#{ids, typeHandler=com.example.UuidArrayTypeHandler})
</select>
```

---

## 31. Testing standards

### 31.1 Use real PostgreSQL for integration tests

Do not use H2 as a PostgreSQL substitute for PostgreSQL-specific behavior.

Required for PostgreSQL-specific code:

- Testcontainers PostgreSQL or managed ephemeral PostgreSQL
- migrations applied from real migration scripts
- target extension setup if used
- realistic transaction behavior tests

### 31.2 Required tests

For repository/data-access changes, include tests for:

- successful read/write
- empty result
- duplicate/constraint violation
- transaction rollback
- concurrent update if state transition is sensitive
- pagination stability
- JSONB/array/enum mapping if used
- timezone behavior if timestamps are used
- migration applies cleanly

### 31.3 Concurrency tests

Use concurrency tests for:

- optimistic locking
- `FOR UPDATE` flows
- `SKIP LOCKED` pollers
- advisory lock coordination
- idempotency keys
- unique constraint race

Rules:

- Tests must avoid sleeps as synchronization mechanism where possible.
- Use latches/barriers/test transactions.
- Assert final database state, not only exception occurrence.

---

## 32. Migration checklist for LLM changes

Before changing PostgreSQL-related code, the agent must inspect:

- migration files
- datasource configuration
- pool configuration
- ORM dialect/configuration
- transaction annotations/configuration
- existing repository patterns
- existing error mapping
- existing testcontainers setup
- existing index naming convention
- production-like query patterns if available

If unavailable, the agent must write assumptions explicitly.

---

## 33. Forbidden patterns

The following are forbidden by default:

- Runtime `DriverManager` in application code
- string-concatenated SQL values
- raw user-controlled `ORDER BY`, table, or column names
- `select *` in application queries
- unbounded `select` returning list
- `LIMIT` without deterministic `ORDER BY`
- offset pagination for large/hot datasets without justification
- production ORM schema auto-update
- entity-as-API-response for lazy ORM entity
- row-by-row remote call inside DB transaction
- row-by-row insert for large import
- `ON DELETE CASCADE` without impact analysis
- JSONB as schema escape hatch
- PostgreSQL arrays for relational child data
- nullable boolean without domain explanation
- `LocalDateTime` for global event timestamp
- application DB user with schema owner/superuser privileges
- SQL logs with sensitive values
- performance claims without plan/benchmark evidence

---

## 34. Restricted patterns

The following require explicit justification:

- `FOR UPDATE SKIP LOCKED`
- advisory locks
- serializable isolation
- `create index concurrently`
- JSONB GIN index
- expression/partial indexes
- stored procedures/functions
- triggers
- RLS
- LISTEN/NOTIFY
- `COPY`
- temporary/unlogged tables
- materialized views
- custom PostgreSQL types
- extension usage
- PostgreSQL-specific SQL in portable modules
- native queries in ORM repositories

---

## 35. Review checklist

A PostgreSQL-related PR is not acceptable until the reviewer can answer:

### Compatibility

- [ ] PostgreSQL target version is compatible with the SQL/features used.
- [ ] pgJDBC version is pinned.
- [ ] Java baseline is compatible.
- [ ] Access layer choice is consistent with the project.

### SQL safety

- [ ] Runtime values use bind parameters.
- [ ] Dynamic identifiers are allow-listed.
- [ ] No unbounded query result is loaded into memory.
- [ ] `select *` is not used in application hot paths.

### Transaction correctness

- [ ] Transaction boundary is explicit.
- [ ] Retry behavior is idempotent and bounded.
- [ ] Concurrency-sensitive writes are protected.
- [ ] External side effects are not performed inside DB transaction unless justified.

### Schema/data integrity

- [ ] Migration is explicit and production-safe.
- [ ] Constraints enforce core invariants.
- [ ] Indexes match query patterns.
- [ ] Deletion/cascade/soft-delete behavior is reviewed.

### Type mapping

- [ ] UUID, numeric, timestamp, JSONB, enum, and array mappings are tested where used.
- [ ] Money/exact decimals use `BigDecimal`/`numeric`.
- [ ] Timezone semantics are explicit.

### Performance

- [ ] Hot queries have plan evidence.
- [ ] Batch operations are bounded.
- [ ] Pagination is stable.
- [ ] N+1 risks are tested.

### Observability/security

- [ ] Query/log/metric signals exist.
- [ ] Sensitive parameters are not logged.
- [ ] Runtime DB user is least-privileged.
- [ ] Pool and database failure modes are observable.

---

## 36. Prompt contract for LLM code agents

Use this contract when asking an LLM to implement Java code that touches PostgreSQL:

```text
You are modifying Java code that interacts with PostgreSQL.

You must follow:
- strict-coding-standards__java_postgresql.md
- strict-coding-standards__jdbc.md
- strict-coding-standards__java_security.md
- the project-specific Java baseline standard
- the selected data access standard: JPA/Hibernate/MyBatis/jOOQ/JDBC/etc.

Before writing code:
1. Identify PostgreSQL version assumptions.
2. Identify access layer and transaction owner.
3. Identify data cardinality and query plan/index expectations.
4. Identify concurrency and retry behavior.
5. Identify Java/PostgreSQL type mappings.

While writing code:
- Use bind parameters for all runtime values.
- Use allow-lists for dynamic identifiers.
- Keep transactions short.
- Avoid unbounded queries.
- Use deterministic ordering for pagination.
- Do not introduce schema changes without migration files.
- Do not use JSONB/arrays/enums/PostgreSQL-specific features without justification.
- Add integration tests using real PostgreSQL for PostgreSQL-specific behavior.

After writing code, provide:
- changed files
- migration impact
- transaction boundary
- query/index rationale
- concurrency behavior
- test evidence
- assumptions and unresolved risks
```

---

## 37. Minimal implementation note template

Every non-trivial repository/query change should include this in PR notes:

```text
PostgreSQL implementation note

Access layer:
Transaction owner:
Target PostgreSQL version:
Query cardinality:
Indexes used/added:
Isolation/locking:
Retry behavior:
Java/PostgreSQL type mapping:
Migration required:
Performance evidence:
Test evidence:
Assumptions:
Risks:
```

---

## 38. Source anchors

This standard is based on these primary/reference source categories:

- PostgreSQL official documentation and release notes
- pgJDBC official documentation
- Java JDBC standards
- PostgreSQL transaction isolation and locking documentation
- PostgreSQL JSONB/indexing documentation
- PostgreSQL `EXPLAIN` documentation
- OWASP SQL injection guidance
- Project-specific Java standards in this repository

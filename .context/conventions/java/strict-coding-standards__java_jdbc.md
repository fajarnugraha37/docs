# Strict Coding Standards — JDBC

> **Target:** Java database access implemented directly with JDBC (`java.sql` / `javax.sql`)  
> **Scope:** `DataSource`, connection pools, `Connection`, `PreparedStatement`, `CallableStatement`, `ResultSet`, transactions, SQL construction, batching, generated keys, streaming reads, timeouts, retries, mapping, testing, and LLM implementation rules  
> **Audience:** LLM code agents, human reviewers, maintainers, tech leads  
> **Purpose:** prevent JDBC code that compiles but is unsafe in production: leaked connections, string-concatenated SQL, missing rollback, pool exhaustion, accidental full-table reads, silent `NULL` mistakes, driver-specific fetch behavior, unbounded batches, vague exception handling, and untestable data-access code.

---

## 0. Non-negotiable operating rule for LLM agents

When implementing JDBC code, an LLM agent **MUST** treat JDBC as an explicit resource, transaction, and protocol boundary.

The agent **MUST NOT** implement JDBC by merely opening a connection, concatenating SQL, executing a query, and mapping whatever fields compile.

Every JDBC change **MUST** make these decisions explicit:

1. Which database operation is being performed.
2. Which SQL statement or statements are executed.
3. Which values are bound as parameters.
4. Which identifiers, if any, are dynamic and how they are allow-listed.
5. Which connection owner is responsible for closing the connection.
6. Which code starts, commits, and rolls back the transaction.
7. Which timeout protects the operation.
8. Which result size is expected and bounded.
9. Which fetch size or pagination strategy applies.
10. Which batch size applies for bulk writes.
11. Which isolation, locking, or optimistic concurrency rule protects concurrent updates.
12. Which checked database failures are recoverable, retryable, or terminal.
13. Which metrics/logs are emitted without leaking sensitive values.
14. Which tests prove SQL correctness, mapping correctness, transaction behavior, and error behavior.

If any of these are unclear, the agent **MUST** choose the most conservative implementation and document the uncertainty in the implementation notes or PR summary.

---

## 1. JDBC mental model

JDBC is not an ORM and not a repository pattern by itself.

JDBC is a low-level API where the application explicitly controls:

- connection acquisition;
- connection release;
- transaction mode;
- statement creation;
- parameter binding;
- result-set traversal;
- row mapping;
- generated-key retrieval;
- timeout configuration;
- vendor behavior;
- error classification.

Therefore, JDBC code **MUST** be written as infrastructure code with strict boundaries.

A correct JDBC implementation has this shape:

```text
Application/service use case
    -> repository/gateway method
        -> acquire Connection from DataSource or existing transaction context
        -> create PreparedStatement
        -> bind parameters explicitly
        -> execute
        -> map ResultSet rows into domain/DTO objects
        -> close ResultSet/Statement/Connection at the correct ownership boundary
        -> convert SQLException into domain/infrastructure exception
```

A broken JDBC implementation usually has this shape:

```text
controller/resource
    -> DriverManager.getConnection(...)
    -> SQL string concatenation
    -> execute
    -> return ResultSet/entity/map directly
```

That shape is **forbidden** in production code.

---

## 2. Version and platform model

### 2.1 JDBC API packages

JDBC is primarily provided through:

```java
java.sql.*
javax.sql.*
```

The `java.sql` package contains core JDBC types such as `Connection`, `Statement`, `PreparedStatement`, `CallableStatement`, `ResultSet`, `SQLException`, `SQLDataException`, and `SQLTimeoutException`.

The `javax.sql` package contains important server-side and data-source abstractions such as `DataSource`, `ConnectionPoolDataSource`, and related interfaces.

### 2.2 JDBC 4.3 baseline

For Java 11+ projects, the effective JDBC API baseline is normally **JDBC 4.3**, because Java SE 11 includes JDBC 4.3 and incorporates earlier JDBC versions.

Rules:

1. The agent **MUST** use only APIs available in the configured Java baseline.
2. For Java 11, 17, 21, and 25 projects, JDBC 4.3 APIs are allowed unless the target runtime or driver explicitly rejects them.
3. The agent **MUST NOT** assume every JDBC driver fully supports every optional feature.
4. If a feature can throw `SQLFeatureNotSupportedException`, code **MUST** either avoid it or handle it explicitly.
5. Driver behavior **MUST** be verified in integration tests against the actual database and driver version.

### 2.3 Driver-specific behavior rule

The JDBC API is portable at the interface level, but many important behaviors are driver-specific:

- fetch size behavior;
- generated key retrieval;
- batch rewrite behavior;
- timeout enforcement;
- cursor behavior;
- `setObject` type inference;
- timezone handling;
- isolation support;
- stored procedure syntax;
- large object streaming;
- cancellation behavior;
- SQLState/vendor error codes.

The agent **MUST** treat driver behavior as evidence-based. It **MUST NOT** assume PostgreSQL, Oracle, SQL Server, MySQL, MariaDB, DB2, H2, or SQLite behave identically.

---

## 3. Architectural boundary rules

### 3.1 JDBC belongs in infrastructure/persistence layer

JDBC code **MUST** live in a repository, gateway, adapter, DAO, or infrastructure package.

Allowed examples:

```text
com.example.user.infrastructure.jdbc
com.example.user.repository.jdbc
com.example.casework.adapter.out.jdbc
com.example.audit.persistence.jdbc
```

Forbidden examples:

```text
com.example.user.web
com.example.user.controller
com.example.user.resource
com.example.user.dto
```

Controllers, REST resources, message consumers, jobs, and UI adapters **MUST NOT** contain raw JDBC code.

### 3.2 SQL ownership rule

Every SQL statement **MUST** have a clear owner.

Good ownership models:

- SQL lives beside the repository method that owns it.
- Large SQL lives in a named `.sql` resource loaded by a small SQL loader.
- Generated SQL is produced by a vetted query builder with bind parameters.

Forbidden ownership models:

- SQL fragments scattered across unrelated classes.
- SQL built in controllers.
- SQL stored in constants shared globally without a use-case owner.
- SQL constructed through arbitrary string concatenation.

### 3.3 No framework-shaped leakage

A JDBC repository **MUST NOT** expose:

```java
Connection
PreparedStatement
CallableStatement
ResultSet
SQLException
```

to application/domain layers.

Allowed repository signatures:

```java
Optional<Customer> findById(CustomerId id);
List<CustomerSummary> search(CustomerSearchCriteria criteria, PageRequest page);
long insert(CustomerDraft draft);
boolean updateStatus(CustomerId id, CustomerStatus expectedCurrent, CustomerStatus next);
```

Forbidden repository signatures:

```java
ResultSet findById(long id);              // FORBIDDEN
Connection getConnection();              // FORBIDDEN
void save(Customer c) throws SQLException; // FORBIDDEN at application boundary
```

---

## 4. DataSource and connection acquisition rules

### 4.1 Prefer DataSource over DriverManager

Production code **MUST** acquire connections from `DataSource`.

```java
private final DataSource dataSource;

public CustomerJdbcRepository(DataSource dataSource) {
    this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
}
```

`DriverManager.getConnection(...)` is **forbidden** in production request/job paths.

Allowed exceptions:

1. Tiny standalone diagnostic CLI tools.
2. Local throwaway examples.
3. Test harness code where no container/pool exists.
4. Migration utilities with explicit lifecycle ownership.

Even in those exceptions, credentials **MUST NOT** be hard-coded.

### 4.2 Connection pool is mandatory for services

Long-running services **MUST** use a real connection pool or container-managed `DataSource`.

A service **MUST NOT** open a new physical database connection per request.

Minimum pool configuration evidence:

1. `maximumPoolSize` or equivalent.
2. connection acquisition timeout.
3. validation/keepalive strategy.
4. max lifetime lower than database/network idle lifetime when applicable.
5. leak detection enabled in non-production or controlled diagnostic environments.
6. pool metrics exported.
7. database max connections considered across all service instances.

### 4.3 Pool sizing rule

The agent **MUST NOT** choose pool size by guesswork.

A pool size proposal **MUST** consider:

```text
effective_db_connection_budget
/ number_of_application_instances
/ number_of_distinct_pools_per_instance
```

Then adjust based on:

- expected concurrent JDBC operations;
- average query duration;
- transaction duration;
- database CPU/I/O capacity;
- lock contention;
- external thread pool size;
- virtual thread usage, if Java 21+ is used;
- batch jobs sharing the same database.

Rules:

1. A larger pool is not automatically faster.
2. A pool **MUST NOT** exceed the database budget.
3. HTTP worker threads or virtual threads **MUST NOT** be allowed to overwhelm a small database pool silently.
4. If virtual threads are used, external concurrency limits **MUST** protect the database.
5. Pool starvation **MUST** fail fast with observable errors, not hang indefinitely.

### 4.4 HikariCP-specific guardrails

If HikariCP is used:

1. Time values **MUST** be configured in milliseconds.
2. The application host **MUST** have accurate time synchronization.
3. `connectionTimeout` **MUST** be intentionally configured for service behavior.
4. `maximumPoolSize` **MUST** be justified.
5. `maxLifetime` **SHOULD** be lower than database/network idle connection kill time.
6. `leakDetectionThreshold` **SHOULD** be enabled in staging/diagnostics, not blindly in all production paths.
7. `minimumIdle` **SHOULD NOT** be set unless there is a specific reason; fixed-size pool behavior is often simpler.
8. Metrics **MUST** be exported.

---

## 5. Resource lifecycle rules

### 5.1 Every JDBC resource must have an owner

Every `Connection`, `Statement`, `PreparedStatement`, `CallableStatement`, and `ResultSet` **MUST** have exactly one owner responsible for closing it.

The default ownership rule:

```text
method that opens it closes it
```

Allowed exception:

- transaction manager opens/closes connection outside the repository;
- repository receives a transaction-scoped connection from a local unit-of-work abstraction;
- container-managed code controls lifecycle.

### 5.2 Use try-with-resources by default

For non-transactional single operation:

```java
public Optional<Customer> findById(long id) {
    final String sql = """
            SELECT id, name, status
            FROM customers
            WHERE id = ?
            """;

    try (Connection connection = dataSource.getConnection();
         PreparedStatement statement = connection.prepareStatement(sql)) {

        statement.setLong(1, id);
        statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);

        try (ResultSet rs = statement.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }
            return Optional.of(mapCustomer(rs));
        }
    } catch (SQLException e) {
        throw DatabaseAccessException.from("find customer by id", e);
    }
}
```

### 5.3 Never return ResultSet

`ResultSet` **MUST NOT** escape the method that owns the statement/connection.

Forbidden:

```java
public ResultSet findAll() throws SQLException {
    Connection connection = dataSource.getConnection();
    Statement statement = connection.createStatement();
    return statement.executeQuery("SELECT * FROM customers");
}
```

Reason: this leaks connection lifecycle to callers and usually causes pool exhaustion.

### 5.4 Close order

When not using try-with-resources, close in reverse acquisition order:

```text
ResultSet -> Statement -> Connection
```

But manual close code is **discouraged** unless there is a strong reason.

### 5.5 Do not cache JDBC objects

The agent **MUST NOT** store these as fields:

```java
Connection
Statement
PreparedStatement
CallableStatement
ResultSet
```

Forbidden:

```java
private Connection connection;             // FORBIDDEN
private PreparedStatement findByIdStatement; // FORBIDDEN
```

Allowed field:

```java
private final DataSource dataSource;
```

Prepared statement caching, if needed, **MUST** be handled by the driver/pool configuration or a carefully reviewed infrastructure component.

---

## 6. Transaction boundary rules

### 6.1 Transaction owner must be explicit

Every write operation **MUST** be clear about who owns the transaction.

Allowed ownership models:

1. Framework-managed transaction, for example Spring `@Transactional`.
2. Jakarta/JTA-managed transaction.
3. Local JDBC transaction inside one repository/use-case method.
4. Explicit unit-of-work abstraction.

Forbidden:

- hidden auto-commit assumptions in multi-statement writes;
- commit in repository while service assumes a larger transaction;
- rollback swallowed silently;
- transaction spanning remote API calls without explicit justification.

### 6.2 Auto-commit rule

Single-statement read-only queries may use default auto-commit if the driver and pool behavior are understood.

Multi-statement write operations **MUST** disable auto-commit and explicitly commit or rollback.

```java
public void transfer(long fromAccountId, long toAccountId, BigDecimal amount) {
    try (Connection connection = dataSource.getConnection()) {
        connection.setAutoCommit(false);
        try {
            debit(connection, fromAccountId, amount);
            credit(connection, toAccountId, amount);
            connection.commit();
        } catch (SQLException | RuntimeException e) {
            rollbackQuietly(connection, "transfer");
            throw e;
        }
    } catch (SQLException e) {
        throw DatabaseAccessException.from("transfer", e);
    }
}
```

### 6.3 Rollback is mandatory on failure

If the code disables auto-commit, every failure path **MUST** attempt rollback before the connection is returned to the pool.

```java
private static void rollbackQuietly(Connection connection, String operation) {
    try {
        connection.rollback();
    } catch (SQLException rollbackFailure) {
        // Log operation + SQLState/vendor code, never sensitive bind values.
    }
}
```

### 6.4 Do not mix local JDBC transaction and external transaction manager

If a framework transaction manager owns the connection, repository code **MUST NOT** call:

```java
connection.setAutoCommit(false);
connection.commit();
connection.rollback();
```

unless the local unit-of-work contract explicitly permits it.

### 6.5 Transaction duration rule

A transaction **MUST NOT** include:

- outbound HTTP calls;
- message publishing without outbox/transactional integration;
- user think time;
- file upload/download streaming;
- long CPU processing;
- waiting for distributed locks;
- retry loops around non-idempotent operations.

A transaction should cover only the minimum database consistency window.

### 6.6 Savepoint rule

`Savepoint` is **restricted**.

Allowed only when:

1. The database supports it.
2. The operation genuinely needs partial rollback inside one transaction.
3. The code names the savepoint meaningfully.
4. The code releases or rolls back the savepoint explicitly.
5. Tests cover both success and partial failure.

Do not use savepoints to hide unclear transaction boundaries.

---

## 7. SQL construction and injection safety

### 7.1 PreparedStatement is mandatory for values

All runtime values **MUST** be bound through `PreparedStatement` or `CallableStatement` parameters.

Allowed:

```java
String sql = """
        SELECT id, name, status
        FROM customers
        WHERE status = ?
        AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT ?
        """;

try (PreparedStatement statement = connection.prepareStatement(sql)) {
    statement.setString(1, status.name());
    statement.setObject(2, createdFrom);
    statement.setInt(3, limit);
}
```

Forbidden:

```java
String sql = "SELECT * FROM customers WHERE name = '" + name + "'"; // FORBIDDEN
```

### 7.2 Statement is restricted

`Statement` is **restricted**.

Allowed only for:

1. Static SQL with no user input and no dynamic values.
2. Database metadata checks in controlled code.
3. Migration/test setup utilities.
4. DDL scripts where values are not runtime user input.

Even with `Statement`, SQL **MUST NOT** be built from untrusted strings.

### 7.3 Dynamic identifiers require allow-listing

Bind parameters cannot be used for table names, column names, sort directions, or SQL keywords.

Therefore, dynamic identifiers **MUST** be mapped from an allow-list.

Allowed:

```java
enum CustomerSortField {
    CREATED_AT("created_at"),
    NAME("name"),
    STATUS("status");

    private final String columnName;

    CustomerSortField(String columnName) {
        this.columnName = columnName;
    }

    String columnName() {
        return columnName;
    }
}

String orderBy = criteria.sortField().columnName();
String direction = criteria.ascending() ? "ASC" : "DESC";
String sql = """
        SELECT id, name, status
        FROM customers
        ORDER BY %s %s
        LIMIT ? OFFSET ?
        """.formatted(orderBy, direction);
```

Forbidden:

```java
String sql = "SELECT * FROM customers ORDER BY " + request.getParameter("sort"); // FORBIDDEN
```

### 7.4 No generic SQL sanitizer illusion

The agent **MUST NOT** create generic functions such as:

```java
sanitizeSql(String value)
escapeSql(String value)
cleanQuery(String value)
```

as the primary defense.

Correct defense order:

1. bind values;
2. allow-list identifiers;
3. minimize database privileges;
4. validate input type/shape;
5. log safely;
6. test malicious input.

Escaping user input is **strongly discouraged** as a primary control.

### 7.5 SQL comments rule

SQL comments are allowed only if they are static and safe.

Allowed:

```sql
/* repository=CustomerJdbcRepository method=findActiveCustomers */
SELECT id, name
FROM customers
WHERE status = ?
```

Forbidden:

```java
String sql = "/* user=" + username + " */ SELECT ..."; // FORBIDDEN
```

---

## 8. Parameter binding rules

### 8.1 Bind all parameters explicitly

Every `?` placeholder **MUST** be bound exactly once before execution.

The agent **SHOULD** use helper methods for complex binding, but the final mapping must remain obvious.

```java
private static void bindCustomerSearch(
        PreparedStatement statement,
        CustomerSearchCriteria criteria,
        PageRequest page
) throws SQLException {
    int index = 1;
    statement.setString(index++, criteria.status().name());
    statement.setObject(index++, criteria.createdFrom());
    statement.setInt(index++, page.limit());
    statement.setInt(index, page.offset());
}
```

### 8.2 Parameter index discipline

For SQL with many parameters, use an incrementing `index` variable.

Allowed:

```java
int index = 1;
statement.setLong(index++, customerId);
statement.setString(index++, status.name());
statement.setObject(index, updatedAt);
```

Forbidden in long statements:

```java
statement.setLong(1, customerId);
statement.setString(7, status.name());
statement.setObject(4, updatedAt);
```

### 8.3 Null binding rule

`NULL` values **MUST** be bound with explicit SQL type unless the driver behavior is known and tested.

Allowed:

```java
if (customer.middleName() == null) {
    statement.setNull(index++, Types.VARCHAR);
} else {
    statement.setString(index++, customer.middleName());
}
```

Restricted:

```java
statement.setObject(index++, null); // RESTRICTED: driver-specific ambiguity
```

### 8.4 Temporal binding rule

For Java 8+ time types, prefer `setObject` / `getObject` with explicit target Java type when supported and tested.

Allowed:

```java
statement.setObject(index++, OffsetDateTime.now(clock));
OffsetDateTime createdAt = rs.getObject("created_at", OffsetDateTime.class);
```

Rules:

1. The project **MUST** define whether timestamps are stored in UTC, local database timezone, or timezone-aware columns.
2. Do not silently use system default timezone.
3. Integration tests **MUST** verify round-trip behavior for the actual database.
4. Avoid legacy `java.sql.Date`, `java.sql.Time`, and `java.sql.Timestamp` unless required by driver/database constraints.

### 8.5 BigDecimal rule

Money, rates, fees, penalties, tax, and regulatory amounts **MUST** use `BigDecimal`, not `double` or `float`.

Rules:

1. Scale and rounding **MUST** be explicit at domain boundary.
2. SQL column precision/scale **MUST** match business constraints.
3. Tests **MUST** cover rounding and boundary values.

### 8.6 Enum binding rule

Enums **MUST** be persisted as stable strings or explicit codes, not ordinal numbers.

Allowed:

```java
statement.setString(index++, status.name());
```

Better for externally stable database contracts:

```java
statement.setString(index++, status.databaseCode());
```

Forbidden:

```java
statement.setInt(index++, status.ordinal()); // FORBIDDEN
```

---

## 9. ResultSet mapping rules

### 9.1 ResultSet must be mapped immediately

`ResultSet` rows **MUST** be mapped inside the owning method or a dedicated row mapper.

Allowed:

```java
private static Customer mapCustomer(ResultSet rs) throws SQLException {
    return new Customer(
            rs.getLong("id"),
            rs.getString("name"),
            CustomerStatus.valueOf(rs.getString("status"))
    );
}
```

### 9.2 Prefer column labels over indexes

Use column labels for maintainability.

Allowed:

```java
rs.getLong("customer_id");
rs.getString("customer_name");
```

Restricted:

```java
rs.getLong(1); // RESTRICTED: only allowed in tiny hot-path mappers with tests
```

### 9.3 Always alias computed or duplicate columns

If two columns have the same name or an expression is used, alias it.

Allowed:

```sql
SELECT
    c.id AS customer_id,
    c.name AS customer_name,
    COUNT(o.id) AS order_count
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
```

### 9.4 No `SELECT *`

Production code **MUST NOT** use `SELECT *`.

Reasons:

- breaks mapping stability;
- transfers unnecessary data;
- hides schema changes;
- increases accidental sensitive data exposure;
- makes index-only plans harder;
- makes review weaker.

Allowed only in throwaway diagnostics or migration exploration scripts.

### 9.5 Primitive getter null rule

Primitive getters such as `getInt`, `getLong`, `getBoolean`, and `getDouble` cannot represent SQL `NULL` directly.

If a nullable column is read through a primitive getter, code **MUST** call `wasNull()` immediately.

Allowed:

```java
long parentIdValue = rs.getLong("parent_id");
Long parentId = rs.wasNull() ? null : parentIdValue;
```

Preferred when supported:

```java
Long parentId = rs.getObject("parent_id", Long.class);
```

Forbidden:

```java
long parentId = rs.getLong("parent_id"); // FORBIDDEN if column is nullable
```

### 9.6 Result size rule

Every query returning multiple rows **MUST** have a bounded result strategy:

1. pagination;
2. keyset pagination;
3. fetch size streaming;
4. explicit maximum row limit;
5. server-side cursor;
6. export/job-specific streaming pipeline.

Unbounded `List<T>` loading is **forbidden** for tables that can grow.

Forbidden:

```java
SELECT id, name FROM audit_events
```

Allowed:

```java
SELECT id, name
FROM audit_events
WHERE created_at >= ?
ORDER BY created_at, id
FETCH FIRST ? ROWS ONLY
```

or vendor equivalent.

### 9.7 Single row rule

When expecting one row:

- zero rows must be handled;
- more than one row must be handled if uniqueness is not guaranteed by the database.

Allowed:

```java
if (!rs.next()) {
    return Optional.empty();
}
Customer customer = mapCustomer(rs);
if (rs.next()) {
    throw new DataIntegrityViolationException("Expected one customer row but found multiple");
}
return Optional.of(customer);
```

If the database has a unique constraint guaranteeing one row, the second `rs.next()` check may be skipped with a comment or test evidence.

---

## 10. Batch write rules

### 10.1 Use PreparedStatement batch for repeated writes

For repeated insert/update/delete with the same SQL shape, use `PreparedStatement.addBatch()` and `executeBatch()` or `executeLargeBatch()`.

Allowed:

```java
String sql = """
        INSERT INTO audit_events(id, event_type, payload, created_at)
        VALUES (?, ?, ?, ?)
        """;

try (Connection connection = dataSource.getConnection();
     PreparedStatement statement = connection.prepareStatement(sql)) {

    connection.setAutoCommit(false);
    int count = 0;

    for (AuditEvent event : events) {
        int index = 1;
        statement.setObject(index++, event.id());
        statement.setString(index++, event.type());
        statement.setString(index++, event.payloadJson());
        statement.setObject(index, event.createdAt());
        statement.addBatch();

        if (++count % BATCH_SIZE == 0) {
            statement.executeBatch();
            statement.clearBatch();
        }
    }

    statement.executeBatch();
    connection.commit();
} catch (SQLException e) {
    throw DatabaseAccessException.from("insert audit events", e);
}
```

### 10.2 Batch size must be bounded

Batch size **MUST** be a named constant/configuration, not an unbounded collection size.

Allowed starting points:

```java
private static final int BATCH_SIZE = 500;
```

But the actual value **MUST** be validated with the target database/driver and payload size.

### 10.3 Disable auto-commit for batch writes

Batch writes **MUST** run with auto-commit disabled unless a framework transaction manager owns the transaction.

Reason: partial success and rollback behavior must be controlled.

### 10.4 Handle BatchUpdateException

Batch failures **MUST** expose enough information for diagnostics while avoiding sensitive bind values.

Rules:

1. Capture SQLState.
2. Capture vendor error code.
3. Capture operation name.
4. Capture batch size.
5. Capture failing logical item identifier if safe.
6. Do not log full payloads or secrets.

### 10.5 Do not mix unrelated SQL in one batch

A batch **SHOULD** contain repeated executions of the same prepared statement.

Using `Statement.addBatch(String sql)` with multiple unrelated SQL strings is **restricted** to migrations/admin utilities and requires review.

---

## 11. Generated key rules

### 11.1 Generated keys must be requested explicitly

Allowed:

```java
try (PreparedStatement statement = connection.prepareStatement(
        sql,
        Statement.RETURN_GENERATED_KEYS
)) {
    // bind + executeUpdate
    int updated = statement.executeUpdate();
    if (updated != 1) {
        throw new DataIntegrityViolationException("Expected one inserted row, got " + updated);
    }

    try (ResultSet keys = statement.getGeneratedKeys()) {
        if (!keys.next()) {
            throw new DataIntegrityViolationException("Insert did not return generated key");
        }
        return keys.getLong(1);
    }
}
```

### 11.2 Prefer database-generated identifiers only when appropriate

Allowed identifier strategies:

- database identity/sequence;
- application-generated UUID/ULID;
- externally provided business key with unique constraint.

Rules:

1. Identifier strategy **MUST** match system integration needs.
2. Generated keys **MUST** be tested against the real driver.
3. Batch insert + generated keys is driver-specific and must have integration tests.

---

## 12. Large result set and streaming rules

### 12.1 Unbounded loading is forbidden

The agent **MUST NOT** read a large table fully into memory unless the operation is an explicit export/job and has streaming controls.

Forbidden:

```java
List<Row> rows = new ArrayList<>();
while (rs.next()) {
    rows.add(mapRow(rs));
}
```

for unbounded data.

Allowed streaming shape:

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement statement = connection.prepareStatement(sql)) {

    connection.setAutoCommit(false); // required by some drivers for cursor streaming
    statement.setFetchSize(500);

    try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
            sink.accept(mapRow(rs));
        }
    }
}
```

### 12.2 Fetch size is a hint and driver-specific

`setFetchSize` **MUST** be treated as a driver hint, not a portable guarantee.

Rules:

1. Set fetch size before executing the query.
2. Use forward-only/read-only result sets for streaming unless there is a justified exception.
3. Verify behavior with integration tests and memory observations.
4. PostgreSQL cursor streaming requires auto-commit off and forward-only result set.
5. Oracle row fetch size changes round-trip behavior and defaults differ from other databases.
6. SQL Server, MySQL, and other drivers have their own rules.

### 12.3 ResultSet type rule

Default allowed type:

```java
ResultSet.TYPE_FORWARD_ONLY
ResultSet.CONCUR_READ_ONLY
```

Restricted:

```java
ResultSet.TYPE_SCROLL_INSENSITIVE
ResultSet.TYPE_SCROLL_SENSITIVE
ResultSet.CONCUR_UPDATABLE
```

Scrollable/updatable result sets are **forbidden by default** in service code because they are memory-heavy, driver-specific, and easy to misuse.

### 12.4 Updatable ResultSet is forbidden by default

Do not update rows through `ResultSet.updateXxx()` in application code.

Use explicit `UPDATE ... WHERE ...` statements with concurrency checks.

Forbidden:

```java
rs.updateString("status", "APPROVED");
rs.updateRow();
```

Allowed:

```java
UPDATE applications
SET status = ?, updated_at = ?, version = version + 1
WHERE id = ? AND version = ?
```

---

## 13. Pagination rules

### 13.1 Offset pagination is allowed only with constraints

Offset pagination is acceptable for small/medium result sets and admin screens.

Requirements:

1. deterministic `ORDER BY`;
2. stable tie-breaker column;
3. max page size;
4. index support;
5. tests for boundary pages.

Allowed:

```sql
SELECT id, name, created_at
FROM customers
WHERE status = ?
ORDER BY created_at DESC, id DESC
OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
```

### 13.2 Keyset pagination is preferred for large changing data

For large tables, use keyset pagination where possible.

Example:

```sql
SELECT id, created_at, event_type
FROM audit_events
WHERE (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
FETCH FIRST ? ROWS ONLY
```

Vendor syntax may differ. The agent **MUST** adapt syntax to the actual database.

### 13.3 Page size must be capped

Every externally controlled page size **MUST** have a maximum.

Allowed:

```java
int limit = Math.min(requestedLimit, MAX_PAGE_SIZE);
```

Forbidden:

```java
int limit = Integer.parseInt(request.getParameter("limit")); // FORBIDDEN without cap/validation
```

---

## 14. Timeout and cancellation rules

### 14.1 Every production query must have timeout protection

Timeout can be enforced at one or more layers:

1. pool connection acquisition timeout;
2. JDBC `Statement.setQueryTimeout(seconds)`;
3. database statement timeout/session setting;
4. transaction timeout;
5. application request deadline;
6. job deadline/cancellation token.

At least one meaningful timeout **MUST** exist. Critical paths **SHOULD** have layered timeouts.

### 14.2 Query timeout rule

For direct JDBC code, set query timeout unless a framework consistently applies it.

```java
statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
```

Rules:

1. Timeout values **MUST** be named constants or config.
2. Timeout must reflect operation type.
3. Timeout exception handling **MUST** preserve SQLState/vendor code.
4. Do not set arbitrary extremely high timeout to hide slow queries.

### 14.3 Cancellation rule

`Statement.cancel()` is **restricted**.

Allowed only when:

- the driver supports meaningful cancellation;
- cancellation path is tested;
- caller handles partial work correctly;
- transaction is rolled back if needed.

---

## 15. Isolation, locking, and concurrency rules

### 15.1 Do not assume default isolation is enough

Every state-changing operation **MUST** define its concurrency protection.

Possible mechanisms:

- unique constraints;
- optimistic locking through version column;
- compare-and-set update predicate;
- pessimistic locking (`SELECT ... FOR UPDATE` or vendor equivalent);
- serializable transaction where justified;
- idempotency key;
- transactional outbox.

### 15.2 Prefer compare-and-set updates for state transitions

For lifecycle/state-machine updates, prefer guarded updates.

Allowed:

```sql
UPDATE cases
SET status = ?, updated_at = ?, version = version + 1
WHERE id = ?
  AND status = ?
  AND version = ?
```

Then verify affected rows:

```java
int updated = statement.executeUpdate();
if (updated == 0) {
    throw new ConcurrentModificationException("Case state changed before update");
}
if (updated != 1) {
    throw new DataIntegrityViolationException("Expected one row update, got " + updated);
}
```

### 15.3 `SELECT then UPDATE` requires protection

Forbidden:

```text
SELECT current status
if status is PENDING
UPDATE status to APPROVED
```

without a lock or guarded predicate.

Allowed:

```text
UPDATE ... WHERE id = ? AND status = 'PENDING'
```

or:

```text
SELECT ... FOR UPDATE
UPDATE ...
```

inside one transaction.

### 15.4 Pessimistic lock rule

Pessimistic locks are **restricted**.

Allowed when:

1. optimistic conflict rate is high;
2. critical section is short;
3. lock order is deterministic;
4. timeout is configured;
5. deadlock handling is tested;
6. no outbound network calls occur inside the lock.

### 15.5 Isolation level rule

Changing isolation level is **restricted**.

If code calls:

```java
connection.setTransactionIsolation(...)
```

it **MUST** document:

- reason;
- database support;
- expected anomaly being prevented;
- performance/locking trade-off;
- reset behavior when using pooled connections;
- integration test.

---

## 16. Retry and idempotency rules

### 16.1 Retry only classified transient failures

The agent **MUST NOT** blindly retry every `SQLException`.

Potentially retryable examples:

- deadlock victim;
- serialization failure;
- connection acquisition failure;
- transient network interruption;
- database failover;
- timeout when operation is idempotent or safely retryable.

Never blindly retry:

- duplicate key;
- foreign key violation;
- check constraint violation;
- syntax error;
- permission error;
- data truncation;
- non-idempotent insert without idempotency key.

### 16.2 Preserve SQLException details

Exception conversion **MUST** preserve:

- SQLState;
- vendor code;
- exception class;
- operation name;
- safe correlation id;
- cause chain.

Example:

```java
public final class DatabaseAccessException extends RuntimeException {
    private final String operation;
    private final String sqlState;
    private final int vendorCode;

    private DatabaseAccessException(String operation, SQLException cause) {
        super("Database operation failed: " + operation
                + " [sqlState=" + cause.getSQLState()
                + ", vendorCode=" + cause.getErrorCode() + "]", cause);
        this.operation = operation;
        this.sqlState = cause.getSQLState();
        this.vendorCode = cause.getErrorCode();
    }

    public static DatabaseAccessException from(String operation, SQLException cause) {
        return new DatabaseAccessException(operation, cause);
    }
}
```

### 16.3 Retry must be outside transaction unless carefully designed

A retry loop **SHOULD** retry the whole transaction, not only the failed statement, unless the failure mode is explicitly local and safe.

Forbidden:

```java
try {
    statement.executeUpdate();
} catch (SQLException e) {
    statement.executeUpdate(); // FORBIDDEN blind retry inside uncertain transaction
}
```

---

## 17. Stored procedure and CallableStatement rules

### 17.1 CallableStatement is restricted

`CallableStatement` is allowed only when the database contract intentionally exposes stored procedures/functions.

Required evidence:

1. procedure name;
2. schema/package name;
3. parameter list;
4. IN/OUT/INOUT mode;
5. transaction behavior;
6. timeout;
7. error mapping;
8. integration test;
9. migration/versioning strategy.

### 17.2 No hidden business logic surprise

If stored procedures contain business logic, repository code **MUST** document that the behavior lives in the database.

The agent **MUST NOT** duplicate the same logic in Java unless the consistency model is explicit.

### 17.3 OUT parameter mapping

OUT parameters **MUST** be registered with explicit SQL types.

```java
try (CallableStatement call = connection.prepareCall("{ call approve_case(?, ?, ?) }")) {
    call.setLong(1, caseId);
    call.setString(2, actorId);
    call.registerOutParameter(3, Types.VARCHAR);
    call.execute();
    String resultCode = call.getString(3);
}
```

---

## 18. Large object and streaming payload rules

### 18.1 Do not load large objects accidentally

BLOB/CLOB/JSON/XML payloads **MUST NOT** be selected unless needed.

Forbidden:

```sql
SELECT id, metadata, large_payload_blob
FROM documents
WHERE owner_id = ?
```

for list screens.

Allowed:

```sql
SELECT id, filename, content_type, size_bytes, created_at
FROM documents
WHERE owner_id = ?
```

### 18.2 Stream LOBs deliberately

When reading/writing large objects:

1. use stream APIs where supported;
2. define max size;
3. avoid logging content;
4. ensure connection stays open only for the streaming window;
5. do not stream across long external calls;
6. test memory usage.

### 18.3 JSON/XML database columns

JSON/XML values **MUST** be validated before writing and parsed into typed structures where possible.

Rules:

1. Do not build JSON by string concatenation.
2. Do not query JSON fields without indexes for growing tables.
3. Do not return raw database JSON if API contract is typed.
4. Do not log full JSON if it may contain sensitive data.

---

## 19. SQL dialect and portability rules

### 19.1 Dialect must be explicit

If SQL uses vendor-specific syntax, the repository or SQL file **MUST** state the dialect.

Examples of vendor-specific areas:

- pagination syntax;
- upsert syntax;
- locking syntax;
- JSON operators;
- date arithmetic;
- generated key retrieval;
- merge statements;
- recursive CTEs;
- array parameters;
- bulk copy APIs.

### 19.2 No fake portability

The agent **MUST NOT** claim SQL is portable unless it has been tested on all target databases.

When only one production database is supported, prefer clear dialect-specific SQL over awkward generic SQL that is slower or wrong.

### 19.3 H2/test database compatibility warning

H2, HSQLDB, Derby, SQLite, and embedded databases **MUST NOT** be treated as proof of production database behavior.

Allowed use:

- fast unit-like tests for simple mappings;
- local smoke tests;
- SQL syntax approximation.

Required for important persistence logic:

- integration tests against the actual database engine/version using Testcontainers or equivalent.

---

## 20. Schema and migration rules

### 20.1 JDBC code must match migration scripts

Every SQL change requiring schema support **MUST** include migration artifacts.

Examples:

- new table;
- new column;
- changed column type;
- new index;
- new unique constraint;
- new foreign key;
- new check constraint;
- new sequence;
- stored procedure change.

### 20.2 Application must not auto-create schema in production

Production schema changes **MUST** be applied through controlled migrations such as Flyway, Liquibase, or platform-approved scripts.

JDBC code **MUST NOT** execute ad hoc DDL at startup unless the component is explicitly a migration tool.

### 20.3 Constraint-first rule

Business invariants that must survive concurrency **MUST** be enforced in the database where appropriate.

Examples:

- unique business keys;
- foreign keys;
- not-null constraints;
- check constraints;
- exclusion constraints where available;
- version columns for optimistic concurrency.

Java validation is not a substitute for database constraints.

---

## 21. Logging, metrics, and observability rules

### 21.1 Log operation, not secrets

Logs may include:

- operation name;
- repository method;
- SQL identifier/name;
- duration;
- row count;
- update count;
- SQLState;
- vendor code;
- correlation id;
- safe aggregate id.

Logs **MUST NOT** include:

- passwords;
- tokens;
- secrets;
- full SQL with sensitive literal values;
- full bind payloads;
- PII unless explicitly allowed and masked;
- large JSON/XML/BLOB content.

### 21.2 SQL text logging rule

SQL text may be logged only if:

1. it contains placeholders, not literal sensitive values;
2. it is safe under organizational policy;
3. it is useful for diagnostics;
4. it does not expose table/column details beyond allowed operational logs.

### 21.3 Metrics required for production services

Production JDBC usage **SHOULD** expose:

- pool active connections;
- pool idle connections;
- pool pending/acquire wait count;
- pool acquire latency;
- connection timeout count;
- query duration by operation name;
- row count distribution;
- update count distribution;
- batch size distribution;
- deadlock/serialization failure count;
- SQL timeout count;
- rollback count;
- slow query count.

### 21.4 Trace boundaries

Database spans/traces **SHOULD** include operation names and sanitized statement identifiers.

Do not attach full sensitive parameter values to traces.

---

## 22. Security rules

### 22.1 Least privilege database user

Application database users **MUST** have only required permissions.

Examples:

- read-only service uses read-only credentials;
- application user cannot drop schema;
- migration user is separate from runtime user;
- reporting user cannot mutate transactional tables;
- stored procedure execution grants are minimal.

### 22.2 Secrets rule

Database credentials **MUST NOT** be hard-coded in source code, tests committed to repository, logs, or documentation examples.

Allowed sources:

- secret manager;
- environment variables managed by deployment platform;
- Kubernetes secret mounted securely;
- cloud IAM/token-based mechanism;
- local developer config excluded from version control.

### 22.3 SQL injection tests

For every repository method with dynamic filters/sorting, tests **SHOULD** include malicious-looking input.

Examples:

```text
' OR '1'='1
x'; DROP TABLE customers; --
name desc; delete from users
```

Expected behavior:

- values are treated as values;
- invalid identifiers are rejected before SQL execution;
- no additional statements are executed.

### 22.4 Multi-statement execution rule

Multi-statement SQL strings are **forbidden by default** in application code.

Forbidden:

```java
statement.execute("UPDATE a SET x = 1; DELETE FROM b;");
```

Allowed exceptions:

- migration scripts;
- admin utilities;
- stored procedure deployment;
- explicit vendor-specific batch scripts.

### 22.5 Row-level authorization

JDBC repository methods **MUST NOT** assume caller authorization is correct if the query can enforce tenant/user scope.

For multi-tenant systems, every query **MUST** include tenant boundary unless intentionally cross-tenant.

Allowed:

```sql
SELECT id, name
FROM cases
WHERE tenant_id = ?
  AND id = ?
```

Forbidden:

```sql
SELECT id, name
FROM cases
WHERE id = ?
```

in tenant-scoped service code.

---

## 23. Performance rules

### 23.1 Index-aware SQL required

Any query on a growing table **MUST** have an index strategy.

The agent **MUST** identify:

1. filter columns;
2. join columns;
3. order-by columns;
4. pagination strategy;
5. expected cardinality;
6. necessary composite index;
7. whether the query can use an index-only plan.

### 23.2 No accidental N+1 with JDBC

Even without ORM, N+1 queries can happen.

Forbidden:

```java
List<Customer> customers = findCustomers();
for (Customer customer : customers) {
    List<Order> orders = findOrdersByCustomerId(customer.id()); // FORBIDDEN N+1
}
```

Allowed:

- join query;
- second query using bounded `IN` chunks;
- batch load by ids;
- precomputed summary table;
- explicit pagination per aggregate.

### 23.3 IN-list rule

Dynamic `IN` lists are **restricted**.

Rules:

1. List size **MUST** be capped.
2. Empty list behavior **MUST** be explicit.
3. Placeholders **MUST** be generated safely.
4. Very large lists **SHOULD** use temp table, array parameter, table-valued parameter, or staging table depending on database.

Allowed:

```java
if (ids.isEmpty()) {
    return List.of();
}
if (ids.size() > MAX_IN_LIST_SIZE) {
    throw new IllegalArgumentException("Too many ids: " + ids.size());
}
String placeholders = ids.stream()
        .map(ignored -> "?")
        .collect(Collectors.joining(", "));
String sql = "SELECT id, name FROM customers WHERE id IN (" + placeholders + ")";
```

The placeholder string is generated from collection size only, not user-provided SQL.

### 23.4 Avoid per-row commits

Per-row commit in bulk jobs is **forbidden by default**.

Allowed only when:

- each row is intentionally independent;
- failure isolation is more important than throughput;
- idempotency exists;
- metrics show acceptable performance.

### 23.5 Explain plan requirement

For complex or high-traffic SQL, the PR **MUST** include an execution-plan note or evidence.

At minimum:

- expected index;
- expected row count/cardinality;
- expected join strategy if important;
- impact on hot tables;
- regression risk.

---

## 24. Framework integration rules

### 24.1 Spring JdbcTemplate rule

If using Spring `JdbcTemplate`, this document still applies.

`JdbcTemplate` helps with resource closing, but does not eliminate responsibility for:

- SQL safety;
- transaction boundary;
- row mapping correctness;
- result size;
- timeout;
- batch size;
- exception classification;
- driver-specific behavior.

### 24.2 Jdbi/MyBatis/jOOQ rule

If using Jdbi, MyBatis, jOOQ, or another SQL library, this document still applies at the SQL boundary.

Rules:

1. Generated/built SQL **MUST** be inspected.
2. Bind values **MUST** remain bind values.
3. Dynamic identifiers **MUST** be allow-listed.
4. Transaction owner **MUST** be explicit.
5. Tests **MUST** run against actual database dialect for important behavior.

### 24.3 Do not mix JPA EntityManager and raw JDBC casually

Mixing JPA and JDBC in the same transaction is **restricted**.

If raw JDBC updates tables managed by JPA in the same persistence context, the agent **MUST** handle cache/persistence-context consistency.

Required evidence:

- flush order;
- clear/refresh strategy;
- transaction boundary;
- stale entity risk;
- test coverage.

---

## 25. Testing rules

### 25.1 Minimum test coverage

Every JDBC repository **MUST** have tests covering:

1. successful query/write;
2. no-row result;
3. duplicate/multiple row behavior if applicable;
4. nullable column mapping;
5. enum/code mapping;
6. temporal mapping;
7. generated key behavior if used;
8. transaction rollback on failure;
9. SQL injection resistance for dynamic input;
10. pagination boundary;
11. batch partial failure when relevant;
12. timeout/deadlock behavior for critical paths when feasible.

### 25.2 Test against production dialect

Important SQL **MUST** be tested against the actual production database engine/version, not only an in-memory substitute.

Preferred:

- Testcontainers;
- ephemeral database schema in CI;
- containerized local database;
- dedicated integration-test database.

### 25.3 Row mapper unit tests

Complex row mappers **SHOULD** be tested with controlled result sets or integration fixtures.

Do not rely only on happy-path repository tests for complex mapping.

### 25.4 Migration tests

Schema migration tests **SHOULD** verify:

- fresh schema creation;
- upgrade from previous schema;
- rollback strategy if supported;
- indexes/constraints exist;
- repository SQL works after migration.

---

## 26. Naming and code style rules

### 26.1 Repository method names must describe database intent

Allowed:

```java
findActiveCustomers
findByIdForUpdate
insertAuditEvent
updateStatusIfCurrentVersion
markOutboxEventPublished
```

Forbidden:

```java
doQuery
runSql
processData
handle
execute
```

unless inside tiny infrastructure helper.

### 26.2 SQL constants naming

Allowed:

```java
private static final String FIND_BY_ID_SQL = """
        SELECT id, name, status
        FROM customers
        WHERE id = ?
        """;
```

Forbidden:

```java
private static final String QUERY = "...";
```

in classes with multiple statements.

### 26.3 Operation names for diagnostics

Each repository method **SHOULD** define a safe operation name.

```java
private static final String OP_FIND_BY_ID = "customer.findById";
```

Use operation names in logs, metrics, traces, and exception wrapping.

---

## 27. Strict examples

### 27.1 Safe read repository

```java
public final class CustomerJdbcRepository {
    private static final int QUERY_TIMEOUT_SECONDS = 5;

    private static final String FIND_BY_ID_SQL = """
            SELECT id, name, status, created_at
            FROM customers
            WHERE id = ?
            """;

    private final DataSource dataSource;

    public CustomerJdbcRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }

    public Optional<Customer> findById(long id) {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(FIND_BY_ID_SQL)) {

            statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
            statement.setLong(1, id);

            try (ResultSet rs = statement.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                Customer customer = mapCustomer(rs);
                if (rs.next()) {
                    throw new DataIntegrityViolationException("Expected unique customer id: " + id);
                }
                return Optional.of(customer);
            }
        } catch (SQLException e) {
            throw DatabaseAccessException.from("customer.findById", e);
        }
    }

    private static Customer mapCustomer(ResultSet rs) throws SQLException {
        return new Customer(
                rs.getLong("id"),
                rs.getString("name"),
                CustomerStatus.valueOf(rs.getString("status")),
                rs.getObject("created_at", OffsetDateTime.class)
        );
    }
}
```

### 27.2 Safe guarded update

```java
public boolean updateStatus(
        long customerId,
        CustomerStatus expectedStatus,
        CustomerStatus nextStatus,
        long expectedVersion,
        OffsetDateTime now
) {
    final String sql = """
            UPDATE customers
            SET status = ?, version = version + 1, updated_at = ?
            WHERE id = ?
              AND status = ?
              AND version = ?
            """;

    try (Connection connection = dataSource.getConnection();
         PreparedStatement statement = connection.prepareStatement(sql)) {

        statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
        int index = 1;
        statement.setString(index++, nextStatus.name());
        statement.setObject(index++, now);
        statement.setLong(index++, customerId);
        statement.setString(index++, expectedStatus.name());
        statement.setLong(index, expectedVersion);

        int updated = statement.executeUpdate();
        if (updated == 0) {
            return false;
        }
        if (updated != 1) {
            throw new DataIntegrityViolationException("Expected one customer update, got " + updated);
        }
        return true;
    } catch (SQLException e) {
        throw DatabaseAccessException.from("customer.updateStatus", e);
    }
}
```

### 27.3 Safe dynamic sort

```java
public List<CustomerSummary> search(CustomerSearchCriteria criteria, PageRequest page) {
    CustomerSortField sortField = criteria.sortField();
    String direction = criteria.ascending() ? "ASC" : "DESC";

    String sql = """
            SELECT id, name, status, created_at
            FROM customers
            WHERE status = ?
            ORDER BY %s %s, id %s
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            """.formatted(sortField.columnName(), direction, direction);

    try (Connection connection = dataSource.getConnection();
         PreparedStatement statement = connection.prepareStatement(sql)) {

        statement.setString(1, criteria.status().name());
        statement.setInt(2, page.offset());
        statement.setInt(3, page.limitCappedAt(MAX_PAGE_SIZE));

        try (ResultSet rs = statement.executeQuery()) {
            List<CustomerSummary> results = new ArrayList<>();
            while (rs.next()) {
                results.add(mapSummary(rs));
            }
            return List.copyOf(results);
        }
    } catch (SQLException e) {
        throw DatabaseAccessException.from("customer.search", e);
    }
}
```

---

## 28. Forbidden anti-patterns

### 28.1 SQL string concatenation with user input

```java
String sql = "SELECT * FROM users WHERE username = '" + username + "'";
```

**Forbidden.** Use bind parameters.

### 28.2 Connection leak through missing close

```java
Connection connection = dataSource.getConnection();
PreparedStatement statement = connection.prepareStatement(sql);
ResultSet rs = statement.executeQuery();
```

without closing resources is **forbidden**.

### 28.3 Swallowing SQLException

```java
catch (SQLException e) {
    return List.of();
}
```

**Forbidden.** This hides data loss and operational failure.

### 28.4 Blind update without affected row check

```java
statement.executeUpdate();
return true;
```

**Forbidden** for business updates. Check update count.

### 28.5 `SELECT *`

```sql
SELECT * FROM customers
```

**Forbidden** in production application code.

### 28.6 Returning mutable maps as domain model

```java
List<Map<String, Object>> rows
```

**Restricted.** Allowed only for generic admin/reporting infrastructure with schema metadata handling. Business repositories must return typed objects.

### 28.7 Creating a connection per row

```java
for (Item item : items) {
    try (Connection c = dataSource.getConnection()) {
        insert(c, item);
    }
}
```

**Forbidden** for bulk work. Use one transaction/batch where appropriate.

### 28.8 Hard-coded credentials

```java
DriverManager.getConnection("jdbc:...", "admin", "password");
```

**Forbidden.**

### 28.9 No timeout

Long-running production queries without timeout/deadline are **forbidden**.

### 28.10 Catch-all retry

```java
catch (SQLException e) {
    retry();
}
```

**Forbidden.** Retry only classified transient errors and idempotent operations.

---

## 29. LLM implementation protocol

Before writing JDBC code, the LLM agent **MUST** answer internally and reflect in code/PR notes where relevant:

1. What operation is this?
2. Is this read-only, write, bulk write, export, or state transition?
3. What exact SQL is needed?
4. Which database dialect is targeted?
5. Are all values bind parameters?
6. Are any SQL identifiers dynamic? If yes, where is the allow-list?
7. Who owns the connection lifecycle?
8. Who owns the transaction?
9. What timeout applies?
10. What result size is expected?
11. Is pagination or streaming needed?
12. What index supports the query?
13. What happens on zero rows?
14. What happens on multiple rows?
15. What happens on duplicate key / FK violation / timeout / deadlock?
16. Is the operation idempotent?
17. Is retry safe?
18. Which tests prove the behavior?

The agent **MUST NOT** produce final code until these questions are resolved enough to avoid unsafe defaults.

---

## 30. LLM prompt contract snippet

Use this snippet inside coding-agent instructions:

```markdown
When writing JDBC code:

- Use `DataSource`, not `DriverManager`, in production code.
- Never concatenate user-controlled values into SQL.
- Use `PreparedStatement` for all values.
- Allow-list dynamic identifiers such as column names, table names, and sort directions.
- Use try-with-resources for `Connection`, `PreparedStatement`, `CallableStatement`, and `ResultSet` unless an external transaction manager owns them.
- Never return `ResultSet`, `Connection`, or `SQLException` across application boundaries.
- Explicitly define transaction owner; do not mix local commit/rollback with framework-managed transactions.
- If auto-commit is disabled, rollback on every failure path.
- Set query timeout or rely on a documented framework/database timeout.
- Bound every multi-row query using pagination, max limit, fetch size streaming, or cursor strategy.
- Do not use `SELECT *` in production code.
- Map nullable primitive columns using `getObject(..., Type.class)` or `wasNull()` immediately.
- Check affected row count for writes.
- Batch repeated writes with bounded batch size and auto-commit disabled.
- Preserve SQLState/vendor error code when wrapping `SQLException`.
- Do not blindly retry `SQLException`; retry only classified transient failures and idempotent operations.
- Write integration tests against the actual database dialect for important SQL behavior.
```

---

## 31. Reviewer checklist

A JDBC PR is not acceptable unless the reviewer can answer **yes** to the relevant items:

### Boundary

- [ ] JDBC code is isolated to repository/gateway/infrastructure layer.
- [ ] No JDBC type leaks to controller/application/domain boundary.
- [ ] SQL owner is clear.
- [ ] Database dialect is clear.

### Connection lifecycle

- [ ] Connections come from `DataSource` or transaction context.
- [ ] No production `DriverManager` usage.
- [ ] Every opened resource is closed.
- [ ] No `Connection`, `Statement`, or `ResultSet` cached in fields.
- [ ] Pool configuration is documented and observable.

### Transaction

- [ ] Transaction owner is explicit.
- [ ] Multi-statement writes are not using accidental auto-commit.
- [ ] Rollback occurs on failure.
- [ ] No outbound network calls inside database transaction.
- [ ] Isolation/locking choice is justified.

### SQL safety

- [ ] Runtime values are bind parameters.
- [ ] Dynamic identifiers are allow-listed.
- [ ] No generic SQL sanitizer is used as primary defense.
- [ ] No unsafe multi-statement execution.
- [ ] Tenant/user scope is enforced where required.

### Mapping

- [ ] No production `SELECT *`.
- [ ] Column aliases are explicit for joins/computed columns.
- [ ] Nullable primitives are handled correctly.
- [ ] Temporal and decimal values are mapped deliberately.
- [ ] ResultSet does not escape.

### Result size and performance

- [ ] Multi-row queries are bounded.
- [ ] Pagination or streaming strategy is explicit.
- [ ] Fetch size behavior is tested for the driver if used.
- [ ] Index strategy is identified.
- [ ] No N+1 query pattern introduced.

### Writes and batch

- [ ] Affected row count is checked.
- [ ] State transitions use guarded updates or locks.
- [ ] Batch size is bounded.
- [ ] Batch failures preserve diagnostic metadata.
- [ ] Generated keys are retrieved and tested if used.

### Failure handling

- [ ] `SQLException` is not swallowed.
- [ ] SQLState/vendor code is preserved.
- [ ] Timeout behavior is defined.
- [ ] Retry policy is explicit and safe.
- [ ] Logs do not leak sensitive values.

### Tests

- [ ] Repository tests cover success and failure paths.
- [ ] Injection resistance is tested for dynamic input.
- [ ] Transaction rollback is tested.
- [ ] Important SQL is tested against production database dialect.
- [ ] Migration/schema support exists.

---

## 32. Source anchors

This standard is based on the following source anchors and operational constraints:

1. Java SE JDBC API: `java.sql` and `javax.sql` define the JDBC core and data-source APIs. Java SE 11 documents JDBC 4.3 as incorporating previous JDBC versions.  
   Source: https://docs.oracle.com/en/java/javase/11/docs/api/java.sql/java/sql/package-summary.html

2. JSR 221 JDBC API Specification 4.3 Maintenance Release 3 is the formal JDBC 4.3 specification line.  
   Source: https://jcp.org/aboutJava/communityprocess/mrel/jsr221/index3.html

3. `DriverManager` documentation states that `DataSource` is the preferred means of connecting to a data source.  
   Source: https://docs.oracle.com/javase/8/docs/api/java/sql/DriverManager.html

4. `PreparedStatement` represents a precompiled SQL statement and can be executed efficiently multiple times.  
   Source: https://docs.oracle.com/javase/8/docs/api/java/sql/PreparedStatement.html

5. `Connection.prepareStatement` supports parameterized SQL statements and explicit result-set type/concurrency/holdability variants.  
   Source: https://docs.oracle.com/javase/8/docs/api/java/sql/Connection.html

6. `Statement.setFetchSize` is specified as a hint to the JDBC driver for rows fetched when more rows are needed.  
   Source: https://docs.oracle.com/javase/8/docs/api/java/sql/Statement.html

7. `ResultSet` represents table data returned by query execution and is `AutoCloseable`.  
   Source: https://docs.oracle.com/javase/8/docs/api/java/sql/ResultSet.html

8. OWASP SQL Injection Prevention guidance recommends stopping dynamic query concatenation and using safer techniques such as parameterized queries and allow-list validation.  
   Source: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

9. PostgreSQL JDBC documentation states cursor-style fetching requires auto-commit off, forward-only result set, and a single statement; `setFetchSize(0)` returns to caching all rows.  
   Source: https://jdbc.postgresql.org/documentation/query/

10. Oracle JDBC documentation describes update batching through `addBatch`/`executeBatch`, recommends disabling auto-commit for batching, and warns very large batches can cause memory/performance issues.  
    Source: https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/performance-extensions.html

11. Oracle JDBC result-set documentation describes row fetch size behavior and notes that changing statement fetch size after a result set is produced has no effect on that result set.  
    Source: https://docs.oracle.com/en/database/oracle/oracle-database/21/jjdbc/resultset.html

12. HikariCP documentation describes configuration essentials, millisecond time values, and the importance of accurate timers/time synchronization.  
    Source: https://github.com/brettwooldridge/HikariCP

---

## 33. Final enforcement rule

JDBC code is acceptable only when it is:

1. safe against SQL injection;
2. explicit about transaction ownership;
3. safe in resource lifecycle;
4. bounded in result size;
5. observable in production;
6. tested against the actual database behavior;
7. clear about failure modes;
8. reviewable by humans without guessing hidden JDBC behavior.

If the agent cannot satisfy these conditions, it **MUST NOT** generate a “best effort” JDBC implementation that merely compiles.

# learn-sql-mastery-for-java-engineers-part-025.md

# Part 25 — SQL from Java: JDBC, Connection Pools, Transactions, and Resource Safety

> Seri: SQL Mastery for Java Engineers  
> Bagian: 025 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-024.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-026.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas security: permissions, RLS, SQL injection, tenant isolation, data protection, dan least privilege.

Sekarang kita masuk ke boundary paling praktis untuk Java engineer:

```text
Bagaimana SQL benar-benar dijalankan dari aplikasi Java?
```

Kamu bisa memahami SQL, indexes, transactions, locking, dan security dengan baik, tetapi tetap membuat sistem buruk jika Java database access salah:

- connection leak
- transaction terlalu panjang
- prepared statement salah pakai
- parameter type salah
- fetch semua rows ke memory
- batch insert tidak benar
- exception database tidak dimapping
- connection pool salah sizing
- N+1 query dari ORM/repository
- SQL timeout tidak diset
- autocommit behavior tidak dipahami
- generated key handling salah
- time zone/type mapping salah
- retry dilakukan di level yang salah
- query logging membocorkan PII

Bagian ini membahas:

- JDBC mental model
- `DriverManager` vs `DataSource`
- connection pool
- HikariCP
- resource lifecycle
- `try-with-resources`
- `PreparedStatement`
- parameter binding
- result set mapping
- transactions
- autocommit
- savepoints
- batching
- fetch size
- generated keys
- timeout
- exception handling
- SQLState/vendor codes
- Spring JDBC / TransactionTemplate / `@Transactional`
- connection pool sizing
- observability
- testing with real DB

Kalimat inti:

> SQL dari Java bukan sekadar memanggil repository; ia adalah pengelolaan connection, transaction, statement, result set, timeout, type mapping, dan error semantics secara eksplisit dan aman.

---

## 1. JDBC Mental Model

JDBC adalah API standar Java untuk berinteraksi dengan relational database.

Core objects:

```text
DataSource
Connection
PreparedStatement
ResultSet
SQLException
```

Mental model:

```text
DataSource gives Connection.
Connection owns transaction context.
PreparedStatement represents SQL + bind parameters.
ResultSet streams/holds returned rows.
SQLException represents database/driver errors.
```

Flow:

```java
try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement("""
         SELECT id, case_number
         FROM cases
         WHERE tenant_id = ?
           AND status = ?
         ORDER BY opened_at DESC
         LIMIT ?
     """)) {

    ps.setObject(1, tenantId);
    ps.setString(2, "OPEN");
    ps.setInt(3, 50);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            UUID id = rs.getObject("id", UUID.class);
            String caseNumber = rs.getString("case_number");
        }
    }
}
```

Key rule:

> Connection, Statement, and ResultSet are resources. Close them deterministically.

---

## 2. DriverManager vs DataSource

### 2.1 DriverManager

Simple:

```java
Connection conn = DriverManager.getConnection(url, user, password);
```

But in production, creating physical DB connection per request is expensive.

### 2.2 DataSource

Production apps use `DataSource`.

Usually backed by connection pool:

```text
HikariCP
Tomcat JDBC pool
Agroal
application server pool
```

Spring Boot commonly auto-configures HikariCP.

Use:

```java
Connection conn = dataSource.getConnection();
```

This usually borrows connection from pool, not create new physical connection every time.

---

## 3. Connection Pool

Database connection is expensive:

- TCP connection
- TLS handshake
- authentication
- session initialization
- backend process/thread/resource
- memory
- server connection slot

Connection pool keeps reusable connections.

Request flow:

```text
borrow connection
use it
return to pool
```

Important:

```text
close() on pooled connection returns it to pool.
```

It does not necessarily close physical connection.

If you forget close, connection leak happens.

---

## 4. HikariCP Mental Model

HikariCP is a popular high-performance JDBC connection pool.

Important settings:

```text
maximumPoolSize
minimumIdle
connectionTimeout
idleTimeout
maxLifetime
leakDetectionThreshold
validationTimeout
keepaliveTime
```

Common mistake:

```text
increase pool size to fix slow DB
```

If queries are slow, larger pool can overload DB more.

Pool size controls concurrency against DB.

Too small:

- requests wait for connection

Too large:

- DB overwhelmed
- context switching
- lock contention
- memory pressure
- worse latency

Connection pool tuning requires DB capacity + workload understanding.

---

## 5. Connection Pool Metrics

Monitor:

```text
active connections
idle connections
pending threads waiting
connection acquisition time
timeout count
max pool size
connection lifetime
leak detection logs
```

Endpoint slow could be:

```text
waiting 2s for connection
query executes 50ms
```

Then SQL is not the only issue; pool saturation is.

Always separate:

```text
connection acquisition latency
query execution latency
row fetching/mapping latency
```

---

## 6. Resource Safety

Bad:

```java
Connection conn = dataSource.getConnection();
PreparedStatement ps = conn.prepareStatement(sql);
ResultSet rs = ps.executeQuery();
// exception happens, resources not closed
```

Good:

```java
try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    ...
}
```

But because `ResultSet` is obtained after binding/execution, common pattern:

```java
try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement(sql)) {

    bind(ps);

    try (ResultSet rs = ps.executeQuery()) {
        map(rs);
    }
}
```

In Spring JDBC, templates manage resources for you.

But you still must design transaction/query correctly.

---

## 7. PreparedStatement

PreparedStatement separates SQL structure from values.

```java
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM users WHERE email = ?"
);
ps.setString(1, email);
```

Benefits:

- SQL injection prevention for values
- database can parse/plan efficiently depending driver/server
- correct type binding
- cleaner code
- possible statement caching

PreparedStatement does not solve:

- unsafe dynamic column/table names
- unsafe ORDER BY
- unsafe raw SQL fragments
- over-broad privileges
- business authorization

---

## 8. Parameter Type Binding

Bind correct types.

Examples:

```java
ps.setObject(1, uuid);        // UUID if driver supports
ps.setLong(2, amountCents);
ps.setBigDecimal(3, amount);
ps.setObject(4, instant);     // driver-dependent
ps.setString(5, status);
```

Bad:

```java
ps.setString(1, uuid.toString());
```

if database then casts column:

```sql
WHERE id::text = ?
```

This can prevent index usage.

Good SQL:

```sql
WHERE id = ?
```

with UUID parameter type.

Parameter type affects performance and correctness.

---

## 9. NULL Binding

Binding null needs type.

Bad:

```java
ps.setObject(1, null);
```

May work, may be ambiguous.

Better:

```java
ps.setNull(1, Types.VARCHAR);
ps.setNull(2, Types.TIMESTAMP_WITH_TIMEZONE);
```

or with modern APIs/driver support:

```java
ps.setObject(1, null, JDBCType.VARCHAR);
```

SQL NULL logic still applies. Binding null to `=` predicate:

```sql
WHERE closed_at = ?
```

with null will not match rows.

Need:

```sql
WHERE closed_at IS NULL
```

or dynamic SQL.

---

## 10. Dynamic SQL for Optional Filters

Bad generic query:

```sql
WHERE tenant_id = ?
  AND (? IS NULL OR status = ?)
  AND (? IS NULL OR priority = ?)
```

Problems:

- poor plan
- OR predicates
- parameter-sensitive selectivity
- indexes harder to use

Better: build SQL with only active predicates while still binding values.

Example:

```java
StringBuilder sql = new StringBuilder("""
    SELECT id, case_number, status
    FROM cases
    WHERE tenant_id = ?
""");

List<SqlBinder> binders = new ArrayList<>();
binders.add(ps -> ps.setObject(nextIndex(), tenantId));

if (status != null) {
    sql.append(" AND status = ?");
    binders.add(ps -> ps.setString(nextIndex(), status));
}

sql.append(" ORDER BY opened_at DESC, id DESC LIMIT ?");
```

Use libraries if needed:

- jOOQ
- QueryDSL
- Spring NamedParameterJdbcTemplate
- MyBatis dynamic SQL
- Criteria API, carefully

Dynamic SQL is fine if values are bound and identifiers are allowlisted.

---

## 11. ResultSet Mapping

Mapping should be explicit.

```java
record CaseSummary(
    UUID id,
    String caseNumber,
    String status,
    Instant openedAt
) {}

CaseSummary map(ResultSet rs) throws SQLException {
    return new CaseSummary(
        rs.getObject("id", UUID.class),
        rs.getString("case_number"),
        rs.getString("status"),
        rs.getObject("opened_at", OffsetDateTime.class).toInstant()
    );
}
```

Avoid:

- relying on column index for complex queries
- `SELECT *`
- mapping huge entity when DTO enough
- hidden lazy loading
- reading nullable primitive without checking

For nullable numeric:

```java
int value = rs.getInt("maybe_count");
if (rs.wasNull()) {
    ...
}
```

Better use boxed type:

```java
Integer value = (Integer) rs.getObject("maybe_count");
```

Driver support varies.

---

## 12. Time Mapping

Use Java `java.time`.

Common:

```text
TIMESTAMPTZ -> OffsetDateTime or Instant
TIMESTAMP WITHOUT TIME ZONE -> LocalDateTime
DATE -> LocalDate
TIME -> LocalTime
```

Be careful:

- database timezone
- session timezone
- driver conversion
- JSON serialization
- `LocalDateTime` is not an instant
- DST
- precision differences

For actual moments, prefer `Instant` in domain/application and `TIMESTAMPTZ` in database where appropriate.

Example:

```java
OffsetDateTime odt = rs.getObject("occurred_at", OffsetDateTime.class);
Instant occurredAt = odt.toInstant();
```

---

## 13. BigDecimal and Money

Avoid double for money.

Bad:

```java
double amount;
```

Good:

```java
BigDecimal amount;
```

or integer minor units:

```java
long amountCents;
```

Database:

```sql
NUMERIC(19, 4)
```

or:

```sql
amount_cents BIGINT
currency_code CHAR(3)
```

Define rounding rules explicitly.

`BigDecimal.equals` considers scale; `compareTo` does not. Be careful in tests/domain equality.

---

## 14. Transaction from JDBC

Manual JDBC transaction:

```java
try (Connection conn = dataSource.getConnection()) {
    boolean oldAutoCommit = conn.getAutoCommit();
    conn.setAutoCommit(false);

    try {
        // statements
        conn.commit();
    } catch (Exception e) {
        conn.rollback();
        throw e;
    } finally {
        conn.setAutoCommit(oldAutoCommit);
    }
}
```

Important:

- transaction belongs to connection
- all statements in transaction must use same connection
- rollback on error
- restore connection state before returning to pool
- pool may reset state, but do not rely blindly

Frameworks manage this better.

---

## 15. Autocommit

Default JDBC connection often has autocommit true.

Autocommit true:

```text
each statement commits automatically
```

For multi-step operation:

```sql
UPDATE cases ...
INSERT INTO case_status_transitions ...
INSERT INTO outbox_events ...
```

Autocommit would commit each separately.

Need transaction boundary.

In Spring:

```java
@Transactional
public void closeCase(...) {
    ...
}
```

But know proxy/rollback semantics from previous parts.

---

## 16. Transaction Boundary in Java

Transaction should cover exactly one business atomic operation.

Good:

```text
validate command input outside transaction if possible
open transaction
read/lock minimal data
write state/history/outbox
commit
external side effects after commit via outbox
```

Bad:

```text
open transaction
call external HTTP
do heavy computation
wait for user input
write DB
commit
```

Transactions hold connection and locks.

Keep them short.

---

## 17. Spring Transaction Management

Spring binds connection to thread during transaction.

Inside `@Transactional`, repository/JdbcTemplate calls use same transaction-bound connection.

```java
@Transactional
public void closeCase(UUID caseId) {
    caseRepository.lockCase(caseId);
    caseRepository.updateStatus(caseId, "CLOSED");
    outboxRepository.insert(...);
}
```

Pitfalls:

- self-invocation bypasses proxy
- private methods not proxied
- checked exceptions may not rollback by default
- async/new thread not same transaction
- multiple data sources need correct transaction manager
- `REQUIRES_NEW` commits independently
- readOnly does not guarantee snapshot consistency

---

## 18. TransactionTemplate

For explicit control:

```java
transactionTemplate.execute(status -> {
    caseRepository.updateStatus(caseId, "CLOSED");
    outboxRepository.insert(event);
    return null;
});
```

Benefits:

- explicit boundary
- easier around lambdas
- avoids proxy self-invocation issue
- can set propagation/isolation/timeout on template

Good for service code where annotation behavior is ambiguous.

---

## 19. Savepoints in JDBC

Savepoint:

```java
Savepoint sp = conn.setSavepoint();
try {
    insertRow();
} catch (SQLException e) {
    conn.rollback(sp);
}
```

Use cases:

- batch import partial failure
- recoverable sub-operation

But do not overuse.

Savepoints add complexity and may not behave the same across DB/driver/framework.

---

## 20. Generated Keys

Insert and get generated key.

```java
try (PreparedStatement ps = conn.prepareStatement(
        "INSERT INTO cases (tenant_id, case_number) VALUES (?, ?)",
        Statement.RETURN_GENERATED_KEYS)) {

    ps.setObject(1, tenantId);
    ps.setString(2, caseNumber);
    ps.executeUpdate();

    try (ResultSet keys = ps.getGeneratedKeys()) {
        if (keys.next()) {
            long id = keys.getLong(1);
        }
    }
}
```

Many PostgreSQL apps prefer `RETURNING`:

```sql
INSERT INTO cases (id, tenant_id, case_number)
VALUES (?, ?, ?)
RETURNING id, created_at;
```

Advantages:

- returns generated/default columns
- explicit
- works with UUID supplied by app
- can return computed/generated fields

Vendor support varies.

---

## 21. Affected Row Count

DML returns affected rows.

```java
int updated = ps.executeUpdate();
```

Use it.

Guarded update:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = ?
  AND status = 'UNDER_REVIEW'
```

Java:

```java
int updated = ps.executeUpdate();
if (updated == 0) {
    throw new InvalidStateOrNotFoundException();
}
if (updated > 1) {
    throw new IllegalStateException("Expected at most one row");
}
```

Affected rows are domain signal.

---

## 22. Batch Operations

JDBC batch:

```java
try (PreparedStatement ps = conn.prepareStatement("""
    INSERT INTO case_notes (id, case_id, note_text)
    VALUES (?, ?, ?)
""")) {
    for (Note note : notes) {
        ps.setObject(1, note.id());
        ps.setObject(2, note.caseId());
        ps.setString(3, note.text());
        ps.addBatch();
    }

    int[] counts = ps.executeBatch();
}
```

Benefits:

- fewer round trips
- better throughput

Caveats:

- transaction size
- error handling
- generated keys
- driver rewrite settings
- memory
- lock duration
- replication/WAL volume
- batch size tuning

Batch 100–1000 often safer than giant batch, but measure.

---

## 23. Bulk Insert Alternatives

For very large import:

- JDBC batch
- database COPY/load command
- staging table
- temporary table
- vendor bulk API
- file import
- ETL pipeline

Pattern:

```text
load into staging
validate
deduplicate
insert/select into target
record import batch
reconcile counts
```

Do not insert millions row one by one through ORM.

---

## 24. Fetch Size

Large result set:

```java
ps.setFetchSize(1000);
```

Fetch size controls how many rows driver fetches per round trip/cursor batch, depending driver/database.

Use for:

- streaming exports
- batch processing
- large reports

Caveats:

- driver-specific behavior
- autocommit may need false for cursor streaming in some DBs
- transaction remains open while streaming
- connection held
- locks/snapshots may be held
- client must consume/close result set

For huge exports, consider async job writing file rather than HTTP streaming from OLTP transaction.

---

## 25. Query Timeout

Set query timeout:

```java
ps.setQueryTimeout(30); // seconds
```

Or via framework/pool/database settings.

Use timeouts to prevent runaway queries.

Types:

- connection acquisition timeout
- query/statement timeout
- transaction timeout
- lock timeout
- socket timeout
- app request timeout

Timeouts should be aligned. Example:

```text
HTTP timeout 30s
DB statement timeout 25s
connection timeout 2s
```

If HTTP times out but DB query keeps running, system can degrade.

---

## 26. Lock Timeout

Lock timeout prevents indefinite waiting.

Set per transaction/session if supported:

```sql
SET LOCAL lock_timeout = '2s';
```

Then run DML.

In Java transaction, execute setting after transaction begins.

Behavior vendor-specific.

Map lock timeout differently from validation error.

---

## 27. SQLException

`SQLException` contains:

- message
- SQLState
- vendor error code
- chained exceptions

```java
catch (SQLException e) {
    String sqlState = e.getSQLState();
    int vendorCode = e.getErrorCode();
}
```

Do not expose raw message to users.

Map known database errors:

- unique violation
- foreign key violation
- check violation
- not null violation
- deadlock
- serialization failure
- lock timeout
- connection failure

Spring translates many to `DataAccessException`.

---

## 28. SQLState Classes

SQLState is standardized-ish.

Examples:

```text
23xxx integrity constraint violation
40001 serialization failure
40P01 deadlock detected in PostgreSQL
23505 unique violation in PostgreSQL
23503 foreign key violation in PostgreSQL
```

Vendor details differ.

For domain mapping, prefer:

- SQLState
- constraint name
- vendor code
- driver-specific exception fields

Avoid parsing localized message text.

---

## 29. Constraint Name Mapping

Constraint:

```sql
CONSTRAINT uq_users_email_normalized UNIQUE (email_normalized)
```

Java maps:

```text
uq_users_email_normalized -> EmailAlreadyExistsException
```

This is robust if names are stable.

Design constraint names intentionally:

```text
uq_<table>_<meaning>
fk_<table>_<referenced>
ck_<table>_<rule>
```

Good names improve error mapping and operations.

---

## 30. Retry Semantics

Retry only when safe.

Retryable:

- serialization failure
- deadlock victim
- transient connection failure, carefully
- lock timeout, depending command
- failover transient

Not blindly retryable:

- unique violation from duplicate user input
- check violation
- FK violation
- invalid state transition
- authentication/authorization failure
- syntax error

Retry whole transaction, not half.

Ensure idempotency for commands that may have committed before client saw response.

---

## 31. Idempotency from Java

API command:

```text
POST /cases/{id}/close
Idempotency-Key: abc
```

Transaction:

```sql
INSERT INTO processed_commands (tenant_id, command_id, request_hash, status)
VALUES (?, ?, ?, 'PROCESSING')
ON CONFLICT DO NOTHING;
```

If insert succeeds, process command.

If conflict:

- same request hash -> return stored result or current state
- different hash -> reject key reuse

Java must treat ambiguous timeout carefully.

Idempotency is part of database design and application protocol.

---

## 32. Outbox from Java

Inside transaction:

```java
@Transactional
public void closeCase(...) {
    caseRepository.close(...);
    transitionRepository.insert(...);
    outboxRepository.insert(new CaseClosedEvent(...));
}
```

After commit, separate publisher sends events.

Do not:

```java
@Transactional
public void closeCase(...) {
    caseRepository.close(...);
    kafka.send(...);
}
```

External side effects are not rolled back with DB.

Use outbox.

---

## 33. Fetching One Row

Utility pattern:

```java
Optional<CaseSummary> findById(UUID tenantId, UUID caseId) {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement("""
             SELECT id, case_number, status
             FROM cases
             WHERE tenant_id = ?
               AND id = ?
         """)) {

        ps.setObject(1, tenantId);
        ps.setObject(2, caseId);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }

            CaseSummary result = mapCaseSummary(rs);

            if (rs.next()) {
                throw new IllegalStateException("Expected one row");
            }

            return Optional.of(result);
        }
    }
}
```

If query should return at most one row, enforce/check it.

---

## 34. Fetching Lists

Always think about bounds.

Bad:

```sql
SELECT * FROM cases WHERE tenant_id = ?
```

Good:

```sql
SELECT id, case_number, status, opened_at
FROM cases
WHERE tenant_id = ?
  AND status = ?
ORDER BY opened_at DESC, id DESC
LIMIT ?
```

Java should enforce max limit:

```java
int limit = Math.min(request.limit(), 100);
```

Unbounded result sets are availability risk.

---

## 35. Keyset Pagination from Java

SQL:

```sql
SELECT id, case_number, opened_at
FROM cases
WHERE tenant_id = ?
  AND status = 'OPEN'
  AND (
      ? IS NULL
      OR opened_at < ?
      OR (opened_at = ? AND id < ?)
  )
ORDER BY opened_at DESC, id DESC
LIMIT ?
```

Better often build separate first-page and next-page SQL to avoid OR/generic plan.

Cursor contains:

```text
last_opened_at
last_id
```

Do not use deep offset for large tables.

---

## 36. Named Parameters

JDBC uses positional `?`, which can be error-prone.

Spring `NamedParameterJdbcTemplate`:

```java
String sql = """
    SELECT id, case_number
    FROM cases
    WHERE tenant_id = :tenantId
      AND status = :status
""";

MapSqlParameterSource params = new MapSqlParameterSource()
    .addValue("tenantId", tenantId)
    .addValue("status", status);
```

Named parameters improve readability for long SQL.

---

## 37. SQL Organization in Java Code

Options:

- inline SQL text blocks
- repository constants
- `.sql` resource files
- jOOQ generated DSL
- MyBatis mapper XML/annotations
- query objects

For complex SQL, `.sql` files can improve readability and review.

But ensure:

- tested
- formatted
- parameters clear
- no string concatenation injection
- owner documented
- plan understood

---

## 38. Query Observability

Log/measure:

- query fingerprint/name
- duration
- rows returned
- affected rows
- timeout
- exception SQLState
- connection acquisition time
- transaction duration
- retry count
- tenant size/case if safe
- request ID

Do not log sensitive bind values.

Use query names:

```java
/* query: CaseRepository.findOpenQueue */
SELECT ...
```

SQL comments can help identify queries in DB stats, but avoid injecting user data in comments.

---

## 39. Statement Comments

Example:

```sql
/* app=case-service query=find-open-queue */
SELECT ...
```

Benefits:

- easier slow query analysis
- trace query ownership
- production debugging

Caveats:

- comments may affect query fingerprinting depending DB/tool
- do not include PII/user input
- keep stable

---

## 40. Connection State Hygiene

Connection has state:

- autocommit
- isolation level
- read-only flag
- schema/search_path
- session variables
- time zone
- lock timeout
- statement timeout
- role
- temp tables

In a pool, state must be reset before reuse.

Framework/pool usually helps, but if you set session state manually, be careful.

Use transaction-local settings where possible:

```sql
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
```

---

## 41. Isolation Level from Java

JDBC:

```java
conn.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
```

Spring:

```java
@Transactional(isolation = Isolation.SERIALIZABLE)
```

Use intentionally.

Higher isolation can cause:

- blocking
- serialization failures
- retries
- lower throughput

Do not set serializable globally to avoid thinking.

---

## 42. Read-Only Transactions

JDBC:

```java
conn.setReadOnly(true);
```

Spring:

```java
@Transactional(readOnly = true)
```

Benefits:

- documents intent
- ORM may skip dirty checking/flush
- DB/driver may optimize or enforce
- can route to read replica in infrastructure

Caveats:

- not always enforced
- read-only does not imply repeatable snapshot
- replica lag still matters

---

## 43. Large Object / BLOB Handling

Avoid loading huge blob into memory if not needed.

Options:

- store file in object storage, metadata in DB
- stream from DB if DB owns blob
- use `InputStream`
- set size limits
- avoid logging
- transaction duration considerations

Regulatory evidence often:

```text
metadata + storage URI + hash in DB
blob in object storage
```

DB stores integrity and chain-of-custody metadata.

---

## 44. Spring JdbcTemplate

JdbcTemplate manages:

- connection borrowing
- statement creation
- resource closing
- exception translation

Example:

```java
List<CaseSummary> cases = jdbcTemplate.query("""
    SELECT id, case_number, status
    FROM cases
    WHERE tenant_id = ?
      AND status = ?
    ORDER BY opened_at DESC, id DESC
    LIMIT ?
""", caseSummaryRowMapper, tenantId, "OPEN", limit);
```

Still your responsibility:

- SQL correctness
- indexes
- transaction boundary
- row mapper correctness
- limit enforcement
- error semantics
- security

---

## 45. Spring Exception Translation

Spring maps SQLExceptions to `DataAccessException`.

Examples:

```text
DuplicateKeyException
DataIntegrityViolationException
CannotAcquireLockException
DeadlockLoserDataAccessException
QueryTimeoutException
TransientDataAccessException
```

Use this to implement:

- domain conflict mapping
- retry for transient errors
- user-friendly errors

But for precise domain mapping, inspect constraint name/vendor details when needed.

---

## 46. Testing with Real Database

Do not rely only on H2 if production is PostgreSQL/MySQL/SQL Server/Oracle.

Reasons:

- SQL dialect differs
- isolation differs
- locking differs
- generated keys differ
- JSON/index support differs
- timestamp behavior differs
- constraint errors differ
- query plans differ
- migration behavior differs

Use Testcontainers or real integration DB.

H2 can be useful for simple tests, but not for SQL mastery-level correctness.

---

## 47. Testcontainers

Testcontainers lets Java tests run real database in Docker.

Benefits:

- real dialect
- real constraints
- real transactions
- migration scripts tested
- repository tests realistic
- CI reproducibility

Test:

- SQL queries
- migrations
- constraint violations
- transaction rollback
- deadlock/retry if possible
- timestamp mapping
- JSON mapping
- RLS if used
- grants with runtime user

---

## 48. Repository Integration Test Example

Test duplicate business key:

```java
@Test
void duplicateCaseNumberFails() {
    repository.insertCase(tenantId, "CASE-001");

    assertThatThrownBy(() ->
        repository.insertCase(tenantId, "case 001")
    ).isInstanceOf(DuplicateCaseNumberException.class);
}
```

This tests:

- normalization
- unique constraint
- exception mapping
- real database behavior

---

## 49. Testing Transactions

Test rollback:

```java
@Test
void closeCaseRollsBackOnOutboxFailure() {
    assertThatThrownBy(() -> service.closeCaseWithInjectedFailure(caseId))
        .isInstanceOf(RuntimeException.class);

    assertThat(repository.findStatus(caseId)).isEqualTo("UNDER_REVIEW");
    assertThat(outboxRepository.findByCase(caseId)).isEmpty();
}
```

Test concurrency with multiple connections/threads for:

- optimistic lock
- one active assignment
- idempotency
- deadlock retry
- lock timeout

---

## 50. Common Java SQL Anti-Patterns

```text
[ ] DriverManager connection per request
[ ] connection/resultset leak
[ ] app connects as superuser
[ ] no query timeout
[ ] no transaction timeout
[ ] transaction wraps external API call
[ ] raw string concatenation
[ ] unsafe ORDER BY parameter
[ ] setString for UUID/date leading to casts
[ ] SELECT * into entity for list endpoint
[ ] unbounded result set
[ ] deep OFFSET pagination
[ ] no affected row count check
[ ] catching SQLException and returning generic success
[ ] retrying non-idempotent command blindly
[ ] logging bind values with PII
[ ] testing PostgreSQL SQL only on H2
[ ] using ORM lazy loading in JSON serialization
[ ] batch size too huge
[ ] not monitoring pool wait time
```

---

## 51. Design Checklist for Java SQL Access

```text
[ ] Is SQL parameterized?
[ ] Are dynamic identifiers allowlisted?
[ ] Are parameter types correct?
[ ] Is result set bounded?
[ ] Are selected columns explicit?
[ ] Is transaction boundary correct?
[ ] Are external calls outside transaction?
[ ] Are affected rows checked?
[ ] Are constraints mapped to domain errors?
[ ] Are retryable errors retried safely?
[ ] Are query/lock/timeouts set?
[ ] Are resources closed?
[ ] Is connection pool monitored?
[ ] Are sensitive params not logged?
[ ] Is query tested on real DB?
[ ] Is performance plan understood?
```

---

## 52. Mini Case Study: Safe Close Case Repository

SQL:

```sql
UPDATE cases
SET
    status = 'CLOSED',
    closed_at = ?,
    version = version + 1
WHERE tenant_id = ?
  AND id = ?
  AND status IN ('UNDER_REVIEW', 'PENDING_DECISION')
```

Java:

```java
int updated = jdbcTemplate.update("""
    UPDATE cases
    SET status = 'CLOSED',
        closed_at = ?,
        version = version + 1
    WHERE tenant_id = ?
      AND id = ?
      AND status IN ('UNDER_REVIEW', 'PENDING_DECISION')
""", Timestamp.from(closedAt), tenantId, caseId);

if (updated == 0) {
    throw new InvalidCaseStateException(caseId);
}
```

Then insert transition and outbox in same transaction.

---

## 53. Mini Case Study: Constraint Mapping

Database:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Java:

```java
try {
    assignmentRepository.insertPrimary(...);
} catch (DuplicateKeyException e) {
    if (constraintName(e).equals("uq_case_assignments_one_active_primary")) {
        throw new CaseAlreadyHasPrimaryOfficerException(caseId);
    }
    throw e;
}
```

Stable constraint names enable clean domain errors.

---

## 54. Mini Case Study: Streaming Export

For large export:

```java
@Transactional(readOnly = true)
public void exportCases(OutputStream out) {
    jdbcTemplate.query(con -> {
        PreparedStatement ps = con.prepareStatement("""
            SELECT id, case_number, status
            FROM cases
            WHERE tenant_id = ?
            ORDER BY id
        """);
        ps.setObject(1, tenantId);
        ps.setFetchSize(1000);
        return ps;
    }, rs -> {
        writeCsvRow(out, rs);
    });
}
```

Caveats:

- transaction/connection held while streaming
- client disconnect handling
- timeout
- read replica?
- snapshot consistency
- memory
- export audit
- sensitive data controls

For very large exports, async job to file storage is often better.

---

## 55. Koneksi ke Part Berikutnya

Part ini membahas SQL from Java melalui JDBC, pools, transactions, resource safety, batching, and exceptions.

Part berikutnya, `part-026`, akan membahas higher-level data access tools:

- Hibernate
- JPA
- jOOQ
- MyBatis
- query builders
- ORM trade-offs
- N+1
- fetch join
- dirty checking
- persistence context
- optimistic locking
- when to use SQL-first tools

JDBC adalah fondasi. ORM/query builder adalah abstraction di atas fondasi itu.

---

## 56. Ringkasan Bagian Ini

Hal penting dari part 025:

1. JDBC core objects adalah `DataSource`, `Connection`, `PreparedStatement`, `ResultSet`, dan `SQLException`.
2. Production apps memakai `DataSource` dengan connection pool, bukan membuat connection per request.
3. `close()` pada pooled connection mengembalikan connection ke pool.
4. Resource safety wajib; gunakan try-with-resources atau framework template.
5. PreparedStatement mencegah SQL injection untuk values.
6. Dynamic identifiers tetap harus allowlisted.
7. Parameter type binding memengaruhi index usage dan correctness.
8. NULL binding butuh type dan SQL NULL semantics harus dipahami.
9. Transaction belongs to connection.
10. Autocommit tidak cocok untuk multi-step business operation.
11. Spring transaction binds connection to thread, tetapi punya proxy/rollback caveats.
12. Affected row count adalah domain signal.
13. Batch operations mengurangi round trips tetapi perlu batch size/transaction strategy.
14. Fetch size membantu large reads tetapi connection/transaction tetap held.
15. Query, lock, connection, and transaction timeouts harus aligned.
16. SQLException harus dimapping berdasarkan SQLState/vendor/constraint, bukan raw message.
17. Retry hanya untuk error yang benar-benar retryable dan idempotent.
18. Outbox harus ditulis dalam transaksi DB, external publish setelah commit.
19. Test SQL dengan real database, bukan hanya in-memory dialect.
20. Observability harus mencakup query duration, pool wait, rows, errors, and transaction time.

Kalimat inti:

> Java database access yang baik membuat SQL correctness tidak rusak di boundary aplikasi: connection dikelola, transaksi tepat, parameter aman, result bounded, error bermakna, dan resource selalu ditutup.

---

## 57. Referensi

1. JDBC API — `java.sql` package.  
   https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/package-summary.html

2. JDBC `PreparedStatement`.  
   https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/PreparedStatement.html

3. JDBC `Connection`.  
   https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/Connection.html

4. HikariCP Documentation.  
   https://github.com/brettwooldridge/HikariCP

5. HikariCP Pool Sizing Guide.  
   https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing

6. Spring Framework — JDBC Core.  
   https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html

7. Spring Framework — Transaction Management.  
   https://docs.spring.io/spring-framework/reference/data-access/transaction.html

8. PostgreSQL JDBC Driver Documentation.  
   https://jdbc.postgresql.org/documentation/

9. MySQL Connector/J Developer Guide.  
   https://dev.mysql.com/doc/connector-j/en/

10. Testcontainers Java Documentation.  
    https://java.testcontainers.org/

---

## 58. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-026.md` — ORM and Query Builders: Hibernate, JPA, jOOQ, MyBatis


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-024.md">⬅️ Part 24 — Security: Permissions, Row-Level Security, SQL Injection, and Data Protection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-026.md">Part 26 — ORM and Query Builders: Hibernate, JPA, jOOQ, MyBatis ➡️</a>
</div>

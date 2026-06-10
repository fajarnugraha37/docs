# Strict Coding Standards — Java + ScyllaDB

> **Document status:** strict implementation standard for LLM code agents and human reviewers.  
> **Scope:** Java services that read/write ScyllaDB through CQL-compatible drivers, especially the ScyllaDB Java Driver 4.x.  
> **Applies with:** `strict-coding-standards__java.md`, `java_best_practices.md`, `java_anti_pattern.md`, `java_security.md`, `java_concurrency.md`, `java_testing.md`, `java_telemetry.md`, `java_docker.md`, `java_kubernetes.md`, plus JDBC/framework-specific standards where relevant.

---

## 1. Core Intent

ScyllaDB is not a relational database, not a document store, and not a cache. Treat it as a distributed wide-column database optimized for high-throughput, low-latency, partition-key-oriented workloads.

The LLM must not generate ScyllaDB code by mechanically translating SQL/JPA patterns into CQL. Correct ScyllaDB implementation starts from access patterns and data modeling, not from normalized entity relationships.

A valid ScyllaDB implementation must explicitly answer:

1. What query pattern is this table optimized for?
2. What is the partition key?
3. What is the clustering key/order?
4. What is the expected partition cardinality and size?
5. What consistency level is required?
6. Is the operation idempotent?
7. What is the retry behavior?
8. What is the TTL/tombstone behavior?
9. How is schema migration controlled?
10. How is operational health measured?

If those questions are not answered, the LLM must not introduce or modify a ScyllaDB table/query.

---

## 2. Source-of-Truth References

Use these sources when updating this file or reviewing LLM-generated code:

- ScyllaDB Java Driver docs: <https://java-driver.docs.scylladb.com/stable/>
- ScyllaDB driver support matrix: <https://docs.scylladb.com/stable/versioning/driver-support.html>
- ScyllaDB drivers overview: <https://www.scylladb.com/product/scylla-drivers/>
- ScyllaDB Cassandra compatibility: <https://docs.scylladb.com/manual/stable/using-scylla/cassandra-compatibility.html>
- ScyllaDB Java Driver prepared statements: <https://java-driver.docs.scylladb.com/stable/manual/core/statements/prepared/>
- ScyllaDB Java Driver retries: <https://java-driver.docs.scylladb.com/stable/manual/core/retries/>
- ScyllaDB Java Driver paging: <https://java-driver.docs.scylladb.com/stable/manual/core/paging/>
- ScyllaDB Java Driver Maven Central artifact: <https://central.sonatype.com/artifact/com.scylladb/java-driver-core>

---

## 3. Supported Baseline

### 3.1 Default Driver Policy

For new Java code, use the **ScyllaDB Java Driver 4.x** unless the module is explicitly legacy.

```xml
<dependency>
  <groupId>com.scylladb</groupId>
  <artifactId>java-driver-core</artifactId>
  <version>${scylladb-java-driver.version}</version>
</dependency>
```

The Java package names remain mostly `com.datastax.oss.driver.*` in the 4.x API lineage, so import names alone do not prove the dependency is the DataStax driver. Review the Maven/Gradle coordinates.

### 3.2 Supported Driver Versions

As of this standard, ScyllaDB documents Java Driver 4.x supported versions around the 4.19/4.18 lines and Java Driver 3.x around 3.11/3.10. The latest Maven Central artifact observed for `com.scylladb:java-driver-core` is in the `4.19.0.x` line.

Rules:

1. **MUST** pin an exact driver version.
2. **MUST NOT** use dynamic versions such as `latest.release`, `+`, or open ranges.
3. **MUST** use ScyllaDB's supported driver matrix when choosing versions.
4. **MUST** document why a legacy 3.x driver is still used.
5. **MUST NOT** mix ScyllaDB Java Driver 3.x and 4.x APIs in the same module.
6. **MUST NOT** silently replace ScyllaDB's shard-aware driver with a generic Cassandra driver.

### 3.3 Java Baseline

The ScyllaDB Java Driver 4.x supports Java 8+, but project code must follow the project Java baseline:

- Java 11 standard → use Java 11 language/API only.
- Java 17 standard → use Java 17 language/API only.
- Java 21 standard → virtual-thread use must follow the Java concurrency standard.
- Java 25 standard → do not use preview/incubator features unless explicitly allowed.

Driver compatibility is not permission to lower code quality or bypass the Java baseline.

---

## 4. Architecture Rules

### 4.1 ScyllaDB is an Adapter Boundary

ScyllaDB code belongs in infrastructure/adapters, repositories, gateways, or persistence components. It must not leak into domain model code.

Allowed:

```text
application service -> repository interface -> scylla repository implementation -> CqlSession
```

Forbidden:

```text
domain entity -> CqlSession
controller -> raw CQL string
business rule -> driver-specific Row/BoundStatement
```

### 4.2 Domain Model Separation

Do not expose ScyllaDB driver types across application boundaries.

Forbidden outside adapter layer:

- `CqlSession`
- `Row`
- `ResultSet`
- `AsyncResultSet`
- `BoundStatement`
- `PreparedStatement`
- `SimpleStatement`
- `UdtValue`
- `TupleValue`

Repository methods must return domain objects, DTOs, projections, or explicit result wrappers.

```java
interface UserSessionRepository {
    Optional<UserSession> findByUserIdAndSessionId(UserId userId, SessionId sessionId);
    void save(UserSession session);
}
```

Not:

```java
ResultSet find(String cql);
```

---

## 5. Client and Session Lifecycle

### 5.1 `CqlSession` Ownership

`CqlSession` is expensive and should be treated as a long-lived application component.

Rules:

1. **MUST** create one lifecycle-managed `CqlSession` per cluster/application context unless there is a strong multi-cluster reason.
2. **MUST NOT** create a session per request, per repository call, per message, or per batch item.
3. **MUST** close the session during application shutdown.
4. **MUST** configure contact points and local datacenter explicitly.
5. **MUST** expose driver metrics/health where the runtime framework supports it.
6. **MUST NOT** hide session creation inside low-level methods.

Good:

```java
public final class ScyllaSessionProvider implements AutoCloseable {
    private final CqlSession session;

    public ScyllaSessionProvider(CqlSession session) {
        this.session = Objects.requireNonNull(session, "session");
    }

    public CqlSession session() {
        return session;
    }

    @Override
    public void close() {
        session.close();
    }
}
```

Bad:

```java
public User find(String id) {
    try (CqlSession session = CqlSession.builder().build()) {
        return ...;
    }
}
```

### 5.2 Contact Points and Local Datacenter

A production session must not rely on implicit local datacenter discovery.

Required configuration:

- contact points
- local datacenter
- keyspace policy
- auth provider if enabled
- TLS if enabled
- request timeout
- page size
- metrics
- retry policy
- load balancing behavior

Example:

```java
CqlSession session = CqlSession.builder()
    .addContactPoint(new InetSocketAddress("scylla-1.internal", 9042))
    .addContactPoint(new InetSocketAddress("scylla-2.internal", 9042))
    .withLocalDatacenter("dc1")
    .withKeyspace("app")
    .build();
```

Do not generate hardcoded production hosts in source code. Use typed configuration.

---

## 6. Shard-Aware Driver Rule

ScyllaDB's official drivers are shard-aware. This is not a minor optimization; it affects latency and request routing.

Rules:

1. **MUST** prefer ScyllaDB shard-aware drivers over generic third-party Cassandra drivers for ScyllaDB production services.
2. **MUST** preserve token-aware/shard-aware routing.
3. **MUST** bind partition-key values in prepared statements so the driver can compute routing keys.
4. **MUST NOT** hide partition-key values inside string-concatenated CQL.
5. **MUST NOT** use query patterns that prevent routing awareness unless explicitly justified.

Bad:

```java
SimpleStatement.newInstance("SELECT * FROM events WHERE tenant_id = '" + tenantId + "'");
```

Good:

```java
BoundStatement statement = preparedFindByTenantAndEvent
    .bind(tenantId.value(), eventId.value())
    .setIdempotent(true);
```

---

## 7. Schema and Data Modeling Rules

### 7.1 Query-First Modeling

Every table must be designed for specific queries.

Table design document must include:

```text
Table: user_sessions_by_user
Purpose: Find active sessions by user.
Primary query: SELECT ... WHERE tenant_id=? AND user_id=?
Partition key: (tenant_id, user_id)
Clustering key: created_at DESC, session_id
Expected partition size: bounded by session TTL and max sessions per user
TTL policy: session rows expire after configured lifetime
Consistency: LOCAL_QUORUM for writes, LOCAL_QUORUM for reads
Idempotency: write uses deterministic session_id
```

The LLM must not create a table without this information.

### 7.2 Primary Key Rules

Rules:

1. **MUST** choose partition key from the dominant access pattern.
2. **MUST** avoid low-cardinality partition keys.
3. **MUST** avoid unbounded high-growth partitions.
4. **MUST** choose clustering columns to support the required sort/range query.
5. **MUST NOT** treat primary key like a relational surrogate ID by default.
6. **MUST NOT** use a table to support arbitrary ad hoc queries.

Bad:

```sql
CREATE TABLE orders (
  id uuid PRIMARY KEY,
  tenant_id text,
  user_id text,
  status text,
  created_at timestamp
);
```

This supports lookup by `id`, but not common queries by tenant/user/status/time without more tables or indexes.

Better:

```sql
CREATE TABLE orders_by_user_day (
  tenant_id text,
  user_id text,
  order_day date,
  created_at timestamp,
  order_id uuid,
  status text,
  total_amount decimal,
  PRIMARY KEY ((tenant_id, user_id, order_day), created_at, order_id)
) WITH CLUSTERING ORDER BY (created_at DESC, order_id ASC);
```

### 7.3 Denormalization is Expected

ScyllaDB tables are commonly denormalized by query. This is allowed only when write/update fanout is explicit.

Rules:

1. **MUST** document all tables updated by one logical write.
2. **MUST** ensure idempotent writes across denormalized tables.
3. **MUST** define repair/backfill strategy for partial fanout failure.
4. **MUST** avoid multi-table transactional assumptions.
5. **MUST** use outbox/event-driven repair if cross-table consistency must recover asynchronously.

### 7.4 Secondary Index and Materialized View Policy

Secondary indexes and materialized views are restricted.

Allowed only with explicit review:

- low-cardinality, controlled query pattern where ScyllaDB docs/version support is verified
- bounded result size
- operational plan for backfill/rebuild
- load test evidence

Forbidden by default:

- using secondary index to emulate relational ad hoc search
- adding index because a query was rejected by the primary key model
- materialized view without understanding write amplification and consistency implications
- indexing high-cardinality fields without evidence

Prefer query-specific tables.

---

## 8. CQL Query Rules

### 8.1 Prepared Statements by Default

Repeated queries must use prepared statements.

Rules:

1. **MUST** prepare query strings once and reuse prepared statements.
2. **MUST** bind runtime values; never concatenate user-controlled values.
3. **MUST** keep prepared statement ownership centralized in repository/DAO initialization.
4. **MUST** bind partition-key values as actual bound values.
5. **MUST NOT** prepare dynamically generated query strings with unbounded variation.

Good:

```java
public final class UserSessionScyllaRepository implements UserSessionRepository {
    private final CqlSession session;
    private final PreparedStatement findById;
    private final PreparedStatement insert;

    public UserSessionScyllaRepository(CqlSession session) {
        this.session = Objects.requireNonNull(session, "session");
        this.findById = session.prepare("""
            SELECT tenant_id, user_id, session_id, expires_at
            FROM user_sessions_by_user
            WHERE tenant_id = ? AND user_id = ? AND session_id = ?
            """);
        this.insert = session.prepare("""
            INSERT INTO user_sessions_by_user
                (tenant_id, user_id, session_id, expires_at)
            VALUES (?, ?, ?, ?)
            USING TTL ?
            """);
    }
}
```

### 8.2 Simple Statements

`SimpleStatement` is allowed only for:

- one-off admin code
- schema migration tooling
- tests
- truly dynamic CQL with strictly allow-listed identifiers

It is forbidden for repeated business queries.

### 8.3 `SELECT *` Policy

`SELECT *` is forbidden in production business code.

Required:

- list only required columns
- update mapper when schema changes
- test projection mapping

Bad:

```sql
SELECT * FROM user_sessions_by_user WHERE tenant_id=? AND user_id=?;
```

Good:

```sql
SELECT tenant_id, user_id, session_id, expires_at
FROM user_sessions_by_user
WHERE tenant_id=? AND user_id=?;
```

### 8.4 `ALLOW FILTERING`

`ALLOW FILTERING` is forbidden by default.

Allowed only for:

- controlled admin tooling
- one-off migration/backfill with bounded dataset
- explicit production incident procedure

Every `ALLOW FILTERING` in source code must be treated as a blocker unless justified in a design note.

### 8.5 Dynamic Identifiers

CQL bind parameters are for values, not table/column names.

If table, column, sort direction, keyspace, or consistency profile is dynamic:

1. use allow-list enum
2. map enum to literal identifier
3. reject unknown values
4. test injection attempts

Bad:

```java
String cql = "SELECT " + column + " FROM " + table + " WHERE id=?";
```

Good:

```java
enum UserColumn {
    EMAIL("email"), STATUS("status");

    private final String cqlName;

    UserColumn(String cqlName) {
        this.cqlName = cqlName;
    }

    String cqlName() {
        return cqlName;
    }
}
```

---

## 9. Consistency Rules

### 9.1 Consistency Level Must Be Explicit

Every repository method must have an intentional consistency policy.

Allowed default for many multi-DC ScyllaDB applications:

- writes: `LOCAL_QUORUM`
- reads requiring read-your-write: `LOCAL_QUORUM`
- reads accepting stale data: `LOCAL_ONE` only if documented

Rules:

1. **MUST** document consistency level per repository category.
2. **MUST NOT** change consistency to fix timeout without understanding availability/latency/correctness trade-off.
3. **MUST NOT** use `ANY`, `ONE`, or `LOCAL_ONE` for critical correctness flows without approval.
4. **MUST** test behavior under node failure where correctness matters.

Example:

```java
BoundStatement statement = prepared.bind(tenantId.value(), userId.value())
    .setConsistencyLevel(DefaultConsistencyLevel.LOCAL_QUORUM)
    .setIdempotent(true);
```

### 9.2 Serial Consistency and LWT

Lightweight transactions are restricted.

Allowed use cases:

- uniqueness claim
- compare-and-set state transition
- exactly-once claim marker
- small contention control table

Forbidden use cases:

- every write
- high-throughput hot path
- replacing proper idempotency design
- cross-row/cross-table transaction emulation

LWT must include:

```text
LWT reason:
Contention expectation:
Fallback if not applied:
Latency budget:
Metrics:
Load test evidence:
```

---

## 10. Idempotency and Retry Rules

### 10.1 Idempotency Must Be Declared

The driver retry policy treats idempotent and non-idempotent statements differently. The LLM must set idempotency intentionally.

Rules:

1. **MUST** mark statements idempotent only when repeated execution is safe.
2. **MUST NOT** mark counters, non-deterministic appends, or generated-ID writes idempotent unless specifically designed.
3. **MUST** use deterministic IDs for retried inserts.
4. **MUST** make message/event consumers idempotent before enabling aggressive retry.

Safe idempotent examples:

```sql
INSERT INTO users_by_id (tenant_id, user_id, name)
VALUES (?, ?, ?);
```

Safe if `user_id` is deterministic.

Non-idempotent examples:

```sql
UPDATE counters SET value = value + 1 WHERE tenant_id=? AND counter_id=?;
```

### 10.2 Retry Policy

Rules:

1. **MUST** use bounded retries.
2. **MUST** classify retryable vs non-retryable errors.
3. **MUST** avoid retry storms under cluster pressure.
4. **MUST** add jitter/backoff at application layer for high-level retries.
5. **MUST NOT** retry non-idempotent writes automatically.
6. **MUST** expose retry count metrics.

---

## 11. Paging and Result Handling

### 11.1 Page Size

Every query returning multiple rows must have a page-size policy.

Rules:

1. **MUST** configure default page size.
2. **MUST** use smaller page size for latency-sensitive APIs.
3. **MUST** avoid materializing unbounded results into memory.
4. **MUST** propagate paging state carefully if exposing cursor APIs.
5. **MUST NOT** expose raw driver paging state if it leaks internal query information or is not protected.

Bad:

```java
List<Row> rows = session.execute(statement).all();
```

Good:

```java
ResultSet resultSet = session.execute(statement.setPageSize(500));
for (Row row : resultSet) {
    consume(row);
}
```

For public APIs, wrap cursor state:

```text
cursor = signed/base64url({queryName, tenantId, pagingState, expiresAt})
```

### 11.2 Async Result Handling

Async code must not block event loops or common pools.

Rules:

1. **MUST** compose `CompletionStage` non-blockingly.
2. **MUST** avoid `.get()` or `.join()` in request/event-loop threads.
3. **MUST** bound concurrent in-flight operations.
4. **MUST** propagate cancellation/timeouts.
5. **MUST** preserve trace/context metadata.

Bad:

```java
return session.executeAsync(statement).toCompletableFuture().join();
```

Good:

```java
return session.executeAsync(statement)
    .thenApply(this::mapAsyncResult);
```

---

## 12. Batch Statement Rules

Batch statements are frequently misused. In ScyllaDB/Cassandra-style databases, batches are not a generic performance mechanism.

Allowed:

- multiple mutations for the same partition
- small atomicity-like grouping within carefully understood limitations
- controlled denormalized fanout with explicit reason

Forbidden by default:

- large multi-partition batches
- using batch to speed up bulk load
- batching unrelated writes
- unbounded batch size
- batch inside loop without size limit

Required for every batch:

```text
Batch purpose:
Partition scope:
Max statements:
Logged/unlogged reason:
Idempotency:
Retry behavior:
Load test evidence:
```

Bad:

```java
BatchStatementBuilder batch = BatchStatement.builder(DefaultBatchType.LOGGED);
for (User user : users) {
    batch.addStatement(insertUser.bind(...));
}
session.execute(batch.build());
```

Better for ingestion:

- use independent prepared writes with bounded concurrency
- group only by same partition if needed
- use backpressure
- measure p99 and server load

---

## 13. TTL, Deletes, and Tombstones

TTL and delete behavior must be treated as data lifecycle design, not a convenience cleanup feature.

Rules:

1. **MUST** document TTL per table/column.
2. **MUST** avoid high-churn TTL that creates excessive tombstones.
3. **MUST** avoid deleting large partitions in hot paths.
4. **MUST** use time-bucketed tables for expiring time-series/event data where appropriate.
5. **MUST** monitor tombstones, read latency, compaction pressure, and storage amplification.
6. **MUST NOT** use TTL for regulatory retention unless lifecycle semantics are approved.

Allowed:

```sql
INSERT INTO user_sessions_by_user (...)
VALUES (...)
USING TTL ?;
```

Only when session expiration is true business behavior and partition growth is bounded.

Forbidden:

```sql
DELETE FROM huge_events_by_tenant WHERE tenant_id=?;
```

without a controlled backfill/deletion plan.

---

## 14. Counter Rules

Counters are restricted.

Allowed only when:

- approximate/eventual counter semantics are acceptable
- replay/retry impact is handled
- idempotency is explicitly impossible or replaced by dedup layer
- no strict financial/legal correctness depends on it

Forbidden:

- money/account balance
- regulatory counts requiring exact auditability
- quota enforcement without compensating checks
- retryable message handler increment without dedup

Prefer:

- event log + aggregation
- idempotent daily/hourly rollup table
- external stream processor
- LWT claim + deterministic aggregation only where justified

---

## 15. Time-Series and Event Modeling

For event/time-series data:

1. **MUST** use time bucket in partition key when data volume can grow unbounded.
2. **MUST** choose bucket size from write rate, query range, retention, and partition size target.
3. **MUST** include deterministic event ID for idempotency.
4. **MUST** define retention/TTL/compaction behavior.
5. **MUST** avoid querying across unbounded buckets synchronously.

Example:

```sql
CREATE TABLE events_by_tenant_day (
  tenant_id text,
  event_day date,
  event_time timestamp,
  event_id uuid,
  event_type text,
  payload text,
  PRIMARY KEY ((tenant_id, event_day), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC);
```

Repository query:

```text
findRecentEvents(tenantId, day, limit)
```

Not:

```text
findAllEventsForTenantForever(tenantId)
```

---

## 16. Multi-Tenancy Rules

Rules:

1. **MUST** include tenant isolation in partition key or query boundary where applicable.
2. **MUST** enforce tenant ID before constructing statements.
3. **MUST NOT** trust tenant ID from request body if authenticated tenant context exists.
4. **MUST** test cross-tenant access attempts.
5. **MUST** ensure operational tooling cannot accidentally scan all tenants.

Good partition key:

```sql
PRIMARY KEY ((tenant_id, user_id), created_at, session_id)
```

Risky:

```sql
PRIMARY KEY ((user_id), created_at, session_id)
```

if `user_id` is not globally tenant-scoped.

---

## 17. Type Mapping Rules

### 17.1 UUID

Rules:

1. Use UUID when globally unique identity is needed.
2. Prefer deterministic IDs for idempotent writes.
3. Do not generate random IDs inside repository if caller needs idempotency.
4. Avoid timeuuid unless ordering/time semantics are actually required.

### 17.2 Timestamp

Rules:

1. Use `Instant` for absolute event time in Java.
2. Do not use local system timezone for persistence.
3. Do not store business date-only values as timestamp.
4. Define precision expectation and serialization format.

### 17.3 Decimal

Rules:

1. Use `BigDecimal` for exact decimal values.
2. Define precision/scale in domain policy.
3. Do not use floating-point for money/legal measurements.

### 17.4 Collections

CQL collection types are restricted.

Allowed:

- small bounded metadata lists/sets/maps
- immutable-ish attributes read with parent row

Forbidden:

- unbounded append-only list
- large mutable collection as a mini-table
- collection update in hot path with high contention

Prefer separate table when collection can grow independently.

### 17.5 UDT and Tuple

UDT/tuple usage is restricted.

Allowed:

- stable embedded value with low change frequency
- not independently queried
- versioning/migration impact understood

Forbidden:

- hiding relational sub-entities inside UDT
- using UDT to avoid proper table design
- API directly exposing driver UDT types

---

## 18. Mapper Rules

Manual mapping from `Row` must be explicit and tested.

Rules:

1. **MUST** map by column name, not by fragile index, unless performance evidence demands index mapping.
2. **MUST** handle nullability intentionally.
3. **MUST** avoid passing `Row` outside mapper/repository layer.
4. **MUST** test missing/null/unexpected values.
5. **MUST** avoid reflection-heavy generic mappers unless approved.

Example:

```java
private UserSession mapSession(Row row) {
    return new UserSession(
        new TenantId(row.getString("tenant_id")),
        new UserId(row.getString("user_id")),
        new SessionId(row.getUuid("session_id")),
        row.getInstant("expires_at")
    );
}
```

---

## 19. Schema Migration Rules

ScyllaDB schema migration must be deliberate and operationally safe.

Rules:

1. **MUST** manage schema through migration files/tooling, not ad hoc application startup code.
2. **MUST** make table additions backward compatible.
3. **MUST** avoid destructive schema changes without rollout plan.
4. **MUST** coordinate schema agreement and deployment order.
5. **MUST** avoid renaming columns/tables as a simple change; treat as create-backfill-cutover-drop.
6. **MUST** separate schema migration from high-throughput data backfill.

Migration plan template:

```text
Change:
Affected tables:
Backward compatible: yes/no
Write path impact:
Read path impact:
Backfill required: yes/no
Rollback/roll-forward:
Operational check:
Metrics to watch:
```

---

## 20. Bulk Ingestion Rules

For high-volume writes:

1. **MUST** use prepared statements.
2. **MUST** bound concurrency.
3. **MUST** avoid giant batches.
4. **MUST** use deterministic keys for retries.
5. **MUST** measure p50/p95/p99 latency and server-side metrics.
6. **MUST** expose backpressure to upstream.
7. **MUST** avoid loading entire source dataset into memory.

Ingestion skeleton:

```java
Semaphore permits = new Semaphore(maxInFlight);
List<CompletionStage<Void>> inFlight = new ArrayList<>();

for (Event event : events) {
    permits.acquire();
    BoundStatement statement = insertEvent.bind(...)
        .setIdempotent(true);

    CompletionStage<Void> write = session.executeAsync(statement)
        .thenAccept(ignored -> {})
        .whenComplete((ignored, failure) -> permits.release());

    inFlight.add(write);
}
```

Do not use this exact skeleton blindly; production code must handle cancellation, errors, and bounded memory.

---

## 21. Reactive/Async Integration

ScyllaDB async driver APIs can integrate with Reactor, Mutiny, or `CompletableFuture`.

Rules:

1. **MUST** not block event loop threads.
2. **MUST** convert async results at adapter boundary.
3. **MUST** preserve backpressure for multi-row/multi-query flows.
4. **MUST** limit concurrent queries per request/message.
5. **MUST** define timeout at request and driver layer.

Bad:

```java
Mono.fromCallable(() -> session.execute(statement))
```

This blocks a worker thread unless explicitly isolated.

Better:

```java
Mono.fromCompletionStage(() -> session.executeAsync(statement))
    .map(this::mapResult);
```

---

## 22. Security Rules

### 22.1 CQL Injection

Although CQL is not SQL, injection rules still apply.

Rules:

1. **MUST** bind all runtime values.
2. **MUST** allow-list dynamic identifiers.
3. **MUST NOT** concatenate user input into CQL.
4. **MUST** validate tenant/resource ownership before query execution.

### 22.2 Credentials and TLS

Rules:

1. **MUST** load credentials from secret manager or secure runtime config.
2. **MUST NOT** hardcode username/password in source code.
3. **MUST** use TLS when required by deployment/security policy.
4. **MUST NOT** disable certificate validation in production.
5. **MUST** redact credentials/contact points if logs may leak topology.

### 22.3 Data Sensitivity

Rules:

1. **MUST** classify sensitive fields before persistence.
2. **MUST** encrypt/tokenize sensitive data at application or platform layer according to data policy.
3. **MUST** avoid logging raw CQL values for PII/secrets.
4. **MUST** avoid storing secrets in ScyllaDB unless explicitly designed.

---

## 23. Observability Rules

Every ScyllaDB integration must expose:

- request count by operation/table
- latency histogram by operation/table
- error count by operation/table/error class
- timeout count
- retry count
- unavailable/overloaded errors
- in-flight requests
- page count/rows returned for read operations
- result size warnings
- tombstone/read latency indicators where available
- connection/session health

Log fields:

```text
operation
keyspace
table
consistency
idempotent
pageSize
rowsReturned
latencyMs
attempt
failureClass
traceId
```

Do not log raw partition keys if they contain PII. Hash or classify them.

---

## 24. Kubernetes and Runtime Rules

For Java services using ScyllaDB:

1. **MUST** coordinate pod replica count with ScyllaDB capacity.
2. **MUST** avoid startup thundering herd against ScyllaDB.
3. **MUST** configure request timeout lower than upstream timeout budget.
4. **MUST** expose readiness based on ability to query required keyspace/table only if safe.
5. **MUST** avoid liveness checks that kill pods during transient DB pressure.
6. **MUST** define graceful shutdown to stop accepting traffic before closing session.

Readiness check must be lightweight. Do not perform wide scans or writes.

---

## 25. Testing Rules

### 25.1 Unit Tests

Repository mapping tests must cover:

- null field handling
- missing optional field
- enum/status mapping
- timestamp mapping
- CQL statement builder/value binding
- idempotency flag
- consistency level

### 25.2 Integration Tests

Use containerized ScyllaDB or approved test cluster for integration tests.

Integration tests must cover:

- schema migration
- prepared read/write
- paging
- TTL behavior when relevant
- idempotent retry scenario where possible
- tenant isolation
- query by expected partition key

### 25.3 Load/Performance Tests

Required when adding or changing:

- table primary key
- high-throughput write path
- multi-partition query
- LWT
- batch usage
- TTL-heavy table
- secondary index/materialized view
- fanout write

Performance evidence must include:

```text
Data shape:
Partition size:
Rows:
Read/write ratio:
Concurrency:
Consistency:
p50/p95/p99 latency:
Timeouts:
Retries:
Server CPU/disk/network:
Tombstone/compaction indicators:
```

---

## 26. Anti-Patterns

The LLM must reject these patterns:

1. Creating `CqlSession` per request.
2. Building CQL with string concatenated user input.
3. Using ScyllaDB like relational database with arbitrary WHERE clauses.
4. Creating one generic table for many unrelated queries.
5. Adding `ALLOW FILTERING` to make query pass.
6. Using secondary indexes as default query mechanism.
7. Creating large logged batches for performance.
8. Using batch across unrelated partitions.
9. Using LWT for all writes.
10. Using counters for money or exact legal values.
11. Returning driver `Row`/`ResultSet` from repository API.
12. Exposing driver paging state directly to public clients without protection.
13. Using `SELECT *` in production business code.
14. Creating unbounded partitions.
15. Ignoring TTL/tombstone side effects.
16. Blindly marking all statements idempotent.
17. Retrying non-idempotent writes.
18. Hiding multi-table fanout failure.
19. Creating schema at app startup in production.
20. Treating consistency level as a performance knob only.

---

## 27. Required Repository Checklist

Before accepting ScyllaDB repository code, reviewer must verify:

- [ ] ScyllaDB driver dependency is pinned and version-supported.
- [ ] ScyllaDB shard-aware driver is used unless justified.
- [ ] `CqlSession` is lifecycle-managed and reused.
- [ ] Contact points/local datacenter/config are externalized.
- [ ] Queries use prepared statements for repeated operations.
- [ ] Runtime values are bound, not concatenated.
- [ ] Dynamic identifiers are allow-listed.
- [ ] Every query matches table primary-key design.
- [ ] No production `ALLOW FILTERING`.
- [ ] No production `SELECT *`.
- [ ] Page size/result bounds are explicit.
- [ ] Consistency level is intentional.
- [ ] Idempotency flag is correct.
- [ ] Retry behavior is bounded and safe.
- [ ] LWT/batch/counter/TTL usage is justified.
- [ ] Partition size/growth is bounded.
- [ ] Mapper does not leak driver types.
- [ ] Security/tenant checks are done before query.
- [ ] Tests cover mapping, paging, and key access path.
- [ ] Observability labels are low-cardinality.

---

## 28. LLM Implementation Protocol

When asked to implement ScyllaDB code, the LLM must follow this protocol:

1. Identify the access pattern.
2. Propose the table shape only if needed.
3. State partition key and clustering key.
4. State partition growth bound.
5. State consistency level.
6. State idempotency and retry policy.
7. Use prepared statements.
8. Use lifecycle-managed `CqlSession`.
9. Keep driver types inside infrastructure adapter.
10. Add tests for mapping and query behavior.

The LLM must not generate ScyllaDB code if the access pattern is unknown.

---

## 29. LLM Prompt Contract

Use this as a system/developer instruction for code agents:

```text
When modifying Java code that uses ScyllaDB:

- Use the ScyllaDB Java Driver 4.x unless the module is explicitly legacy.
- Do not create CqlSession per request; use lifecycle-managed session.
- Use prepared statements for repeated queries.
- Bind runtime values; never concatenate user input into CQL.
- Do not use ALLOW FILTERING, SELECT *, secondary indexes, materialized views, LWT, counters, TTL, or batch statements unless explicitly justified.
- Every table/query must be query-first and partition-key-oriented.
- Declare consistency level, idempotency, retry behavior, page size, and partition growth assumptions.
- Keep Row/ResultSet/BoundStatement/CqlSession inside infrastructure layer.
- Do not expose raw driver paging state to public API without signing/expiry.
- Add tests for query mapping, null handling, paging, and tenant isolation.
- If a change requires schema modification, provide migration and rollout notes.
```

---

## 30. Minimal Example

### 30.1 Table

```sql
CREATE TABLE user_sessions_by_user (
  tenant_id text,
  user_id text,
  session_id uuid,
  created_at timestamp,
  expires_at timestamp,
  status text,
  PRIMARY KEY ((tenant_id, user_id), created_at, session_id)
) WITH CLUSTERING ORDER BY (created_at DESC, session_id ASC);
```

### 30.2 Repository

```java
public final class UserSessionScyllaRepository implements UserSessionRepository {
    private final CqlSession session;
    private final PreparedStatement findRecent;
    private final PreparedStatement insert;

    public UserSessionScyllaRepository(CqlSession session) {
        this.session = Objects.requireNonNull(session, "session");
        this.findRecent = session.prepare("""
            SELECT tenant_id, user_id, session_id, created_at, expires_at, status
            FROM user_sessions_by_user
            WHERE tenant_id = ? AND user_id = ?
            LIMIT ?
            """);
        this.insert = session.prepare("""
            INSERT INTO user_sessions_by_user
                (tenant_id, user_id, session_id, created_at, expires_at, status)
            VALUES (?, ?, ?, ?, ?, ?)
            USING TTL ?
            """);
    }

    @Override
    public List<UserSession> findRecent(TenantId tenantId, UserId userId, int limit) {
        int boundedLimit = Math.min(Math.max(limit, 1), 100);
        BoundStatement statement = findRecent.bind(
                tenantId.value(),
                userId.value(),
                boundedLimit
            )
            .setConsistencyLevel(DefaultConsistencyLevel.LOCAL_QUORUM)
            .setPageSize(100)
            .setIdempotent(true);

        List<UserSession> sessions = new ArrayList<>();
        for (Row row : session.execute(statement)) {
            sessions.add(map(row));
        }
        return List.copyOf(sessions);
    }

    @Override
    public void save(UserSession userSession) {
        int ttlSeconds = Math.toIntExact(userSession.ttl().toSeconds());
        BoundStatement statement = insert.bind(
                userSession.tenantId().value(),
                userSession.userId().value(),
                userSession.sessionId().value(),
                userSession.createdAt(),
                userSession.expiresAt(),
                userSession.status().name(),
                ttlSeconds
            )
            .setConsistencyLevel(DefaultConsistencyLevel.LOCAL_QUORUM)
            .setIdempotent(true);

        session.execute(statement);
    }

    private static UserSession map(Row row) {
        return new UserSession(
            new TenantId(row.getString("tenant_id")),
            new UserId(row.getString("user_id")),
            new SessionId(row.getUuid("session_id")),
            row.getInstant("created_at"),
            row.getInstant("expires_at"),
            UserSessionStatus.valueOf(row.getString("status"))
        );
    }
}
```

This example is acceptable only because:

- query is partition-key based
- result is bounded
- page size is explicit
- TTL is intentional
- statement is idempotent because `session_id` is deterministic/stable for the saved session
- driver types stay inside repository implementation

---

## 31. Change Review Template

```text
ScyllaDB Change Review

1. What access pattern is being added/changed?
2. Which table(s) are affected?
3. What is the partition key and why?
4. What is the clustering key/order and why?
5. Expected rows per partition:
6. Expected read/write QPS:
7. Consistency level:
8. Idempotency/retry behavior:
9. TTL/delete/tombstone impact:
10. LWT/batch/counter/index/MV usage: yes/no; justify if yes.
11. Migration/backfill required:
12. Tests added:
13. Metrics/logs/traces added:
14. Rollback/roll-forward plan:
```

---

## 32. Final Rule

ScyllaDB performance comes from correct data modeling and routing. If the LLM cannot explain why a query is efficient from the partition key to the driver routing behavior, it must not generate the code.

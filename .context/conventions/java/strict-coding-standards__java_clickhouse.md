# Strict Coding Standards: Java + ClickHouse

> Purpose: enforce safe, predictable, and high-performance Java integration with ClickHouse.
>
> This document is an overlay standard. It must be used together with:
>
> - `strict-coding-standards__java.md` / Java baseline file (`java11`, `java17`, `java21`, `java25`)
> - `strict-coding-standards__jdbc.md`
> - `strict-coding-standards__java_http.md`
> - `strict-coding-standards__java_json.md`
> - `strict-coding-standards__java_security.md`
> - `strict-coding-standards__java_testing.md`
> - `strict-coding-standards__java_telemetry.md`
>
> This standard is written for LLM code agents. The agent must treat every rule below as a contract, not as optional advice.

---

## 1. Scope

This standard applies to Java code that interacts with ClickHouse through:

- official ClickHouse Java Client
- official ClickHouse JDBC driver
- connection pools such as HikariCP when JDBC is used
- Spring Boot / Quarkus / plain Java integration
- analytics ingestion pipelines
- query/reporting APIs
- observability/event analytics storage
- CDC/event sink into ClickHouse
- batch ETL or streaming ingestion workloads

This standard does **not** make ClickHouse a general-purpose OLTP database. ClickHouse must be treated as an analytical, column-oriented database optimized for large scans, aggregation, and append-heavy ingestion.

---

## 2. Non-Negotiable Rules

### 2.1 Client selection

1. New Java code must prefer the **official ClickHouse Java client** when performance, streaming insert, direct control over formats, or advanced ClickHouse behavior matters.
2. JDBC is allowed when the module needs JDBC ecosystem integration, Spring JDBC compatibility, BI-like query tooling, or simple SQL access.
3. Legacy/unofficial drivers are forbidden unless the owning module is explicitly legacy and migration is out of scope.
4. Do not mix multiple ClickHouse client libraries in the same module without an architecture note.
5. Do not hide ClickHouse behind a generic relational repository abstraction that assumes OLTP semantics.

### 2.2 Workload model

1. ClickHouse tables must be designed for analytical read patterns and append-oriented writes.
2. Frequent single-row update/delete behavior is forbidden by default.
3. High-volume update/delete mutation is forbidden unless a data correction plan, mutation monitoring plan, and operational approval exist.
4. Do not implement transactional business workflows using ClickHouse as the source of truth.
5. If strong consistency, referential integrity, row-level transactional updates, or frequent point writes are required, use an OLTP database and replicate/aggregate into ClickHouse.

### 2.3 SQL safety

1. Runtime values must be bound parameters where the client/driver supports it.
2. Dynamic table, database, column, direction, format, or setting names must be selected from allow-lists.
3. User-controlled SQL fragments are forbidden.
4. Query generation must be reviewed like code generation.
5. `FORMAT`, `SETTINGS`, `LIMIT`, `ORDER BY`, and identifier fragments must not be concatenated from raw request input.

### 2.4 Ingestion

1. Insert batching is mandatory for production ingestion.
2. One-row-per-insert is forbidden except for tests, admin utilities, or rare low-volume control data.
3. Batch size must be bounded by row count, byte size, and latency budget.
4. Insert code must handle partial failure, retry safety, and idempotency strategy.
5. Async insert may be used only with explicit durability/visibility semantics and monitoring.

### 2.5 Query limits

Every externally triggered query must define:

- maximum time or deadline
- row/byte limit
- pagination strategy
- allowed filters
- allowed sort fields
- maximum aggregation cardinality if relevant
- memory/concurrency risk control

Unbounded user-driven analytical queries are forbidden.

---

## 3. Version and Dependency Governance

### 3.1 Recommended baseline

Use these defaults unless the project has a stronger platform decision:

```xml
<dependency>
  <groupId>com.clickhouse</groupId>
  <artifactId>clickhouse-client</artifactId>
  <version>${clickhouse-java.version}</version>
</dependency>

<dependency>
  <groupId>com.clickhouse</groupId>
  <artifactId>clickhouse-jdbc</artifactId>
  <version>${clickhouse-java.version}</version>
</dependency>
```

Rules:

1. Pin the client version through Maven dependency management or Gradle version catalog.
2. Do not use dynamic versions such as `latest.release`, `+`, or version ranges.
3. Java client and JDBC driver versions must be aligned.
4. Server version compatibility must be documented in the module README or ADR.
5. Driver upgrades require integration tests against the target server version.

### 3.2 Official client family

Allowed:

- `com.clickhouse:clickhouse-client`
- `com.clickhouse:clickhouse-jdbc`

Restricted:

- legacy v1 JDBC behavior
- shaded/relocated HTTP clients
- third-party wrappers
- ORM-style abstractions over ClickHouse

Forbidden:

- abandoned `ru.yandex.clickhouse` dependencies for new code
- hardcoded transitive dependency overrides without reason
- silent downgrade to older driver because a test fails

### 3.3 Java baseline

1. Follow the project Java baseline file.
2. If the service uses Java 17+, prefer modern `java.time`, records for DTO-only values, and explicit immutable request objects.
3. Do not use preview/incubator Java features in ClickHouse integration unless the Java baseline standard allows it.

---

## 4. Architecture Boundary

### 4.1 Package structure

Use explicit adapter boundaries:

```text
com.example.analytics.clickhouse
  ClickHouseClientConfig.java
  ClickHouseQueryTimeouts.java
  ClickHouseQuerySettings.java

com.example.analytics.clickhouse.ingest
  EventAnalyticsSink.java
  ClickHouseEventInserter.java
  ClickHouseInsertBatch.java
  ClickHouseInsertResult.java

com.example.analytics.clickhouse.query
  AnalyticsQueryGateway.java
  ClickHouseAnalyticsQueryGateway.java
  AnalyticsQueryRequest.java
  AnalyticsQueryResult.java

com.example.analytics.clickhouse.mapping
  ClickHouseTypeMapper.java
  ClickHouseRowMapper.java
```

Rules:

1. ClickHouse-specific SQL must stay inside ClickHouse adapter packages.
2. Business services must depend on gateway interfaces, not raw client/connection objects.
3. DTOs exposed to API callers must not expose ClickHouse driver-specific classes.
4. Query settings must be centralized; do not scatter settings strings across repositories.

### 4.2 Naming

Use names that reveal analytical semantics:

Allowed:

- `EventAnalyticsSink`
- `AuditLogClickHouseWriter`
- `SearchAnalyticsQueryGateway`
- `ClickHouseDailySummaryReader`
- `ClickHouseBulkInserter`

Avoid:

- `ClickHouseRepository` for everything
- `DatabaseService`
- `DataDao`
- `GenericQueryExecutor`
- `ReportHelper`

---

## 5. Client Lifecycle

### 5.1 Client reuse

1. ClickHouse client objects must be lifecycle-managed and reused.
2. Do not create a new client per request, per insert batch, or per query.
3. Client startup/shutdown must be tied to application lifecycle.
4. Client configuration must include host, port, protocol, credentials, database, timeouts, compression, and TLS policy where relevant.

### 5.2 JDBC connection lifecycle

When JDBC is used:

1. Use `DataSource`; do not use `DriverManager` directly in application code.
2. Use HikariCP or framework-managed pool.
3. Use `try-with-resources` for `Connection`, `Statement`, `PreparedStatement`, and `ResultSet`.
4. Set query timeout or equivalent per query class.
5. Do not leak `ResultSet` or stream rows outside the resource scope.

Example:

```java
public List<DailyCount> findDailyCounts(LocalDate from, LocalDate to) throws SQLException {
    String sql = """
            SELECT event_date, count() AS total
            FROM analytics.events
            WHERE event_date >= ? AND event_date < ?
            GROUP BY event_date
            ORDER BY event_date
            LIMIT 366
            """;

    try (Connection connection = dataSource.getConnection();
         PreparedStatement ps = connection.prepareStatement(sql)) {
        ps.setObject(1, from);
        ps.setObject(2, to);
        ps.setQueryTimeout(10);

        try (ResultSet rs = ps.executeQuery()) {
            List<DailyCount> result = new ArrayList<>();
            while (rs.next()) {
                result.add(new DailyCount(
                        rs.getObject("event_date", LocalDate.class),
                        rs.getLong("total")
                ));
            }
            return List.copyOf(result);
        }
    }
}
```

---

## 6. Connection Pooling

### 6.1 Pool sizing

ClickHouse JDBC pools must be sized for analytical workload behavior.

Rules:

1. Do not copy OLTP database pool sizing defaults.
2. Query pools and ingestion pools should be separated if they have different workload profiles.
3. Total concurrency must be bounded across replicas.
4. Pool size must be validated with server CPU, memory, query concurrency, and workload tests.
5. For long-running analytical queries, smaller pools are often safer than large pools.

### 6.2 HikariCP example

```properties
spring.datasource.clickhouse.jdbc-url=jdbc:clickhouse:https://clickhouse.example.com:8443/analytics
spring.datasource.clickhouse.username=${CLICKHOUSE_USERNAME}
spring.datasource.clickhouse.password=${CLICKHOUSE_PASSWORD}
spring.datasource.clickhouse.hikari.pool-name=clickhouse-analytics
spring.datasource.clickhouse.hikari.maximum-pool-size=8
spring.datasource.clickhouse.hikari.minimum-idle=0
spring.datasource.clickhouse.hikari.connection-timeout=3000
spring.datasource.clickhouse.hikari.validation-timeout=1000
spring.datasource.clickhouse.hikari.idle-timeout=30000
spring.datasource.clickhouse.hikari.max-lifetime=300000
```

Rules:

1. `maximumPoolSize` must not be increased to hide slow queries.
2. Query timeout must be enforced separately from connection acquisition timeout.
3. Dashboards must show active, idle, pending, timeout, and error metrics.

---

## 7. Security

### 7.1 Credentials

1. Credentials must come from a secret manager or platform secret provider.
2. Do not hardcode ClickHouse usernames, passwords, tokens, URLs with credentials, or certificates.
3. Do not log JDBC URLs if they may contain secrets.
4. Use least-privilege database users per application role.
5. Separate write-only ingestion users from read/reporting users.

### 7.2 TLS

1. Production traffic must use TLS unless protected by an explicitly approved private transport boundary.
2. Trust-all TLS is forbidden.
3. Disabled hostname verification is forbidden.
4. Custom truststore configuration must be reviewed by security/platform owners.

### 7.3 Query injection

Forbidden:

```java
String sql = "SELECT * FROM events WHERE user_id = '" + userInput + "'";
```

Allowed with bind values:

```java
String sql = "SELECT count() FROM events WHERE user_id = ?";
```

Allowed dynamic identifier pattern:

```java
private static final Map<String, String> SORT_COLUMNS = Map.of(
        "time", "event_time",
        "tenant", "tenant_id",
        "type", "event_type"
);

String orderBy = SORT_COLUMNS.get(request.sortBy());
if (orderBy == null) {
    throw new IllegalArgumentException("Unsupported sort field");
}

String sql = """
        SELECT event_type, count() AS total
        FROM analytics.events
        WHERE tenant_id = ?
        GROUP BY event_type
        ORDER BY %s DESC
        LIMIT ?
        """.formatted(orderBy);
```

### 7.4 Tenant isolation

1. Tenant filters must be mandatory for multi-tenant data.
2. Tenant identifier must come from trusted authentication/authorization context, not request body alone.
3. Query gateways must not expose a method that allows bypassing tenant filters unless it is an admin/system path with explicit authorization.
4. Tests must prove cross-tenant data is not returned.

---

## 8. Schema Design Rules

### 8.1 Engine choice

Default: `MergeTree` family.

Allowed with justification:

- `MergeTree`
- `ReplacingMergeTree`
- `SummingMergeTree`
- `AggregatingMergeTree`
- `ReplicatedMergeTree` variants
- materialized views for derived tables

Restricted:

- `ReplacingMergeTree` as a general update substitute
- `CollapsingMergeTree` without strict sign/version semantics
- distributed tables without cluster/shard key review
- memory/log/tiny engines for production durable data

Forbidden:

- engine choice without query/ingestion/access pattern evidence
- using `ReplacingMergeTree` while assuming immediate deduplication
- using ClickHouse table engines as hidden business state machines

### 8.2 `ORDER BY` / sorting key

Rules:

1. Every MergeTree table must have an intentional `ORDER BY` clause.
2. `ORDER BY tuple()` is forbidden for production analytical tables unless the table is truly tiny/control-only.
3. Sorting key must be based on dominant query filters and access patterns.
4. Sorting key must consider cardinality, compression, and data skipping.
5. Changing sorting key requires migration/rebuild plan.

Example:

```sql
CREATE TABLE analytics.events
(
    tenant_id LowCardinality(String),
    event_date Date,
    event_time DateTime64(3, 'UTC'),
    event_id UUID,
    event_type LowCardinality(String),
    actor_id String,
    payload_json String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type, event_time, event_id);
```

### 8.3 `PRIMARY KEY`

Rules:

1. If omitted, ClickHouse derives primary key from `ORDER BY`; this must be intentional.
2. If explicitly defined separately from `ORDER BY`, document why.
3. Do not assume ClickHouse primary key enforces uniqueness.
4. Do not use primary key terminology as if it were an OLTP relational primary key.

### 8.4 Partitioning

Rules:

1. Partitioning must be low-to-moderate cardinality.
2. Time-based partitioning is common, but granularity must match retention, deletion, and query patterns.
3. Over-partitioning is forbidden.
4. Do not partition by high-cardinality identifiers such as user ID, event ID, request ID, UUID, or session ID.
5. Partition key change requires table rebuild plan.

Good examples:

```sql
PARTITION BY toYYYYMM(event_date)
PARTITION BY toYYYYMMDD(event_date) -- only for very high volume and lifecycle justification
```

Bad examples:

```sql
PARTITION BY user_id
PARTITION BY event_id
PARTITION BY request_id
```

### 8.5 Data types

Rules:

1. Use `Date` for date-only values.
2. Use `DateTime64` for millisecond/microsecond event timestamps.
3. Store timestamps in UTC unless there is a strong reason otherwise.
4. Use `UUID` for UUID values, not `String`, unless compatibility requires `String`.
5. Use `LowCardinality(String)` for repeated categorical strings after cardinality review.
6. Do not use `Nullable` by default; nullable columns have semantic and performance costs.
7. Do not store arbitrary JSON when typed columns are known and frequently queried.
8. Use `Decimal` for exact monetary/decimal values.
9. Do not use `Float`/`Double` for money.

---

## 9. Ingestion Standards

### 9.1 Insert model

Allowed insert models:

1. bounded synchronous batch insert
2. bounded async insert
3. Kafka/stream sink into ClickHouse
4. staging table + materialized view
5. object storage ingestion for large batch loads

Forbidden:

1. insert per HTTP request without batching for high-volume paths
2. insert in a business transaction expecting rollback with OLTP state
3. retry insert without idempotency semantics
4. unbounded in-memory batch accumulation
5. assuming insert visibility is immediate when async insert/refresh behavior says otherwise

### 9.2 Batch sizing

Batch policy must define:

- max rows
- max bytes
- max wait time
- max retry attempts
- failure handling
- idempotency key/dedup approach
- flush on shutdown behavior

Example policy:

```java
public record ClickHouseInsertBatchPolicy(
        int maxRows,
        int maxBytes,
        Duration maxDelay,
        int maxRetryAttempts,
        Duration retryBackoff
) {
    public ClickHouseInsertBatchPolicy {
        if (maxRows <= 0 || maxBytes <= 0 || maxDelay.isNegative() || maxDelay.isZero()) {
            throw new IllegalArgumentException("Invalid ClickHouse batch policy");
        }
    }
}
```

### 9.3 Async insert

Async insert is allowed when:

1. data is append-only or replayable
2. application accepts delayed server-side flush
3. failure visibility is monitored
4. query-read-after-write is not required
5. batch size/flush thresholds are configured and tested

Async insert is forbidden when:

1. caller requires immediate query visibility
2. caller needs synchronous acknowledgment of durable row persistence
3. batch failure cannot be replayed
4. duplicate handling is undefined

### 9.4 Idempotency

ClickHouse ingestion must define duplicate behavior.

Allowed strategies:

- upstream exactly-once + append-only fact table
- deterministic event ID + dedup query layer
- `ReplacingMergeTree` with version column for eventual replacement
- staging table + materialized view with dedup logic
- external idempotency ledger in OLTP store

Forbidden:

- claiming exactly-once without explaining retry boundaries
- using `ReplacingMergeTree` while expecting immediate uniqueness
- using `SELECT count()` after insert as idempotency proof under concurrency

### 9.5 Shutdown behavior

Batch inserters must:

1. stop accepting new events
2. flush bounded pending batches
3. respect shutdown timeout
4. expose flush failure
5. not block JVM shutdown forever

---

## 10. Query Standards

### 10.1 Query gateway contract

Every query method must state:

- expected row volume
- required filters
- default time window
- maximum time window
- maximum result size
- sorting rule
- tenant rule
- timeout
- error behavior

Example:

```java
public interface AnalyticsQueryGateway {
    List<EventTypeCount> countByEventType(
            TenantId tenantId,
            Instant fromInclusive,
            Instant toExclusive,
            int limit
    );
}
```

### 10.2 Time windows

1. User-facing queries must require bounded time windows unless the dataset is tiny.
2. Default time windows must be safe.
3. Maximum time windows must be enforced in code.
4. Querying all historical data from an API path is forbidden unless it is an offline/admin export path.

### 10.3 Pagination

Allowed:

- bounded `LIMIT`
- keyset-style pagination using stable sort values
- server-side export/job pattern for huge result sets

Restricted:

- `OFFSET` for small/admin pages only
- deep pagination

Forbidden:

- unbounded `SELECT *`
- arbitrary client-supplied `LIMIT 100000000`
- returning entire analytical datasets from synchronous HTTP request

### 10.4 Query settings

ClickHouse query settings must be explicit for risky paths.

Examples:

- `max_execution_time`
- `max_result_rows`
- `max_result_bytes`
- `max_memory_usage`
- `readonly`
- `send_progress_in_http_headers` only when used intentionally

Rules:

1. Settings must not be built from raw request input.
2. Per-query settings must be reviewed like part of API contract.
3. Do not set global server settings from application code.

### 10.5 Aggregation cardinality

1. Group-by keys must be reviewed for cardinality.
2. High-cardinality group-by on user-controlled dimensions is restricted.
3. Query APIs must have allow-listed dimensions.
4. Approximate aggregation functions may be allowed with explicit accuracy semantics.

---

## 11. Updates, Deletes, and Corrections

### 11.1 Mutation policy

ClickHouse mutations are restricted.

Allowed only with approval:

```sql
ALTER TABLE analytics.events DELETE WHERE event_date < '2025-01-01'
ALTER TABLE analytics.events UPDATE field = 'x' WHERE ...
```

Rules:

1. Prefer partition drop/truncate for lifecycle deletes.
2. Prefer append correction events or replacing/collapsing table engines for correction semantics.
3. Monitor `system.mutations` for long-running mutations.
4. Large mutation must have rollback/mitigation plan.
5. Do not run mutation from synchronous user request path.

### 11.2 Deletion/privacy request handling

For privacy deletion/redaction:

1. Prefer data minimization before ingestion.
2. Avoid storing personal data in ClickHouse unless required.
3. If deletion is required, design partitioning/lifecycle strategy early.
4. If row-level deletion is required, document mutation cost and SLA.
5. Do not promise immediate physical erasure without operational proof.

---

## 12. Materialized Views and Derived Tables

### 12.1 Allowed usage

Materialized views are allowed for:

- pre-aggregation
- denormalized analytical projection
- ingestion transformation
- rollup tables
- retention-friendly derived datasets

### 12.2 Rules

1. Source table, target table, and view ownership must be documented.
2. Materialized view transformation must be deterministic.
3. Backfill/replay behavior must be documented.
4. View changes require migration plan.
5. Query code must know whether it reads raw or derived table.

### 12.3 Forbidden

1. Hidden business logic only in materialized view SQL.
2. Materialized view without target table retention policy.
3. Backfill scripts that bypass validation.
4. Changing view SQL without considering historical data.

---

## 13. Error Handling and Retry

### 13.1 Classification

Errors must be classified as:

- configuration error
- authentication/authorization error
- network/transient error
- timeout
- server overload
- invalid query
- schema/type mismatch
- duplicate/replay case
- partial insert failure
- query cancelled

### 13.2 Retry rules

Allowed retry:

- transient network failure
- server overload if bounded and backoff-based
- insert batch replay with idempotency strategy
- read query retry if side-effect-free and caller still within deadline

Forbidden retry:

- invalid SQL
- authentication failure
- authorization failure
- schema mismatch
- mutation failure without operator review
- unbounded retry loop

Example:

```java
private boolean isRetryable(Throwable error) {
    return error instanceof SocketTimeoutException
            || error instanceof ConnectException
            || error instanceof SQLTransientException;
}
```

### 13.3 Deadlines

1. Retries must respect caller deadline.
2. Query timeout must be lower than HTTP/gRPC request timeout.
3. Batch insert retry must not exceed shutdown timeout.
4. Background retry queues must be bounded and observable.

---

## 14. Type Mapping

### 14.1 Time

Rules:

1. Use `Instant` for event timestamps.
2. Use `LocalDate` for ClickHouse `Date`.
3. Use `OffsetDateTime`/`ZonedDateTime` only at external API boundary when offset/zone is part of contract.
4. Normalize to UTC before persistence.
5. Do not use `java.util.Date`/`Calendar` in new code.

### 14.2 Decimal

1. Use `BigDecimal` for ClickHouse `Decimal`.
2. Rounding must be explicit.
3. Do not convert exact decimal to `double`.

### 14.3 UUID

1. Use `UUID` in Java and ClickHouse `UUID` where possible.
2. Do not store UUID as arbitrary string unless compatibility requires it.

### 14.4 Nullable

1. Map nullable ClickHouse columns to explicit Java nullable policy.
2. Do not use `Optional` as field type in DTO/entity-like models.
3. Prefer non-null schema with sentinel/domain status when possible.

### 14.5 Arrays, maps, nested

1. Complex ClickHouse types require explicit mapper tests.
2. Do not expose ClickHouse nested data structures directly to API clients without DTO conversion.
3. Avoid deeply nested ad-hoc schemas if query patterns are known.

---

## 15. Observability

### 15.1 Metrics

ClickHouse integration must expose:

- query count by operation name
- query duration histogram
- query timeout count
- query error count by class/category
- insert batch rows
- insert batch bytes
- insert batch latency
- insert retry count
- pool active/idle/pending metrics if JDBC pool is used
- result row count for major queries

Do not tag metrics with raw SQL, user ID, tenant ID, request ID, or high-cardinality filter values.

### 15.2 Logs

Logs must include:

- operation name
- safe query name/hash
- duration
- rows/bytes where available
- error category
- retry attempt
- batch size
- tenant only if allowed by logging policy

Logs must not include:

- raw SQL with secrets/user input
- credentials
- API tokens
- full query payload with personal data
- full result rows

### 15.3 Tracing

1. Add spans around major query/insert operations.
2. Span names must be low-cardinality, for example `ClickHouse.insertEvents`.
3. Do not use full SQL as span name.
4. Store sanitized query name/hash as attribute if needed.

---

## 16. Testing Standards

### 16.1 Required tests

Every ClickHouse adapter must have:

1. SQL generation tests for dynamic allow-lists.
2. Type mapping tests.
3. Query limit tests.
4. Tenant isolation tests if multi-tenant.
5. Insert batch flush tests.
6. Retry/idempotency tests.
7. Integration tests against real ClickHouse using Testcontainers or approved test environment.
8. Migration/schema compatibility tests.

### 16.2 Testcontainers

Use real ClickHouse for integration behavior. Do not rely only on mocks for SQL correctness.

Example pattern:

```java
@Testcontainers
class ClickHouseAnalyticsGatewayIT {
    @Container
    static final GenericContainer<?> clickHouse = new GenericContainer<>("clickhouse/clickhouse-server:latest")
            .withExposedPorts(8123);

    @Test
    void countByEventTypeReturnsOnlyRequestedTenant() {
        // arrange real schema + fixtures
        // act
        // assert tenant isolation and aggregation correctness
    }
}
```

Rules:

1. Pin container image version in stable CI.
2. Do not use `latest` in CI unless this is an explicit compatibility canary.
3. Seed realistic row volumes for important query tests.
4. Use golden SQL fixtures for critical query contracts.

### 16.3 Performance tests

For ingestion/query performance:

1. Use realistic row width.
2. Use realistic compression and network path if possible.
3. Measure rows/sec, bytes/sec, p95 latency, memory, CPU, and server-side metrics.
4. Include cold/warm scenario where relevant.
5. Do not claim performance based on one local run.

---

## 17. Migration Standards

### 17.1 Schema migrations

Rules:

1. Use Flyway/Liquibase or approved migration tooling for DDL ownership.
2. Applied migrations must not be edited.
3. Large table rebuilds need migration plan and operational window.
4. Adding columns should define defaults/nullability intentionally.
5. Renaming/dropping columns requires compatibility window.
6. Materialized view changes require backfill plan.

### 17.2 Backward compatibility

When app and schema deploy separately:

1. Additive schema changes first.
2. Deploy app supporting old and new schema when needed.
3. Backfill.
4. Switch reads/writes.
5. Remove old columns only after safety period.

### 17.3 Table rebuild

A table rebuild plan must include:

- new table DDL
- data copy strategy
- validation query
- alias/view switch strategy
- rollback/roll-forward path
- expected duration
- resource impact

---

## 18. Framework Integration

### 18.1 Spring Boot

Rules:

1. Use a separate ClickHouse `DataSource` bean; do not mix with OLTP datasource accidentally.
2. Do not let JPA/Hibernate manage ClickHouse schema.
3. Use named beans/qualifiers for ClickHouse clients/templates.
4. Health checks must be cheap and bounded.
5. Do not run heavy analytical test query as readiness probe.

Example:

```java
@Configuration
class ClickHouseDataSourceConfig {
    @Bean
    @ConfigurationProperties("app.clickhouse.datasource")
    HikariConfig clickHouseHikariConfig() {
        return new HikariConfig();
    }

    @Bean(destroyMethod = "close")
    DataSource clickHouseDataSource(
            @Qualifier("clickHouseHikariConfig") HikariConfig config
    ) {
        return new HikariDataSource(config);
    }
}
```

### 18.2 Quarkus

Rules:

1. Keep ClickHouse datasource separate from transactional OLTP datasource.
2. Use reactive/non-blocking client only if the rest of pipeline is non-blocking.
3. Do not block event loop with JDBC operations.
4. Health/readiness queries must be bounded.

### 18.3 Batch jobs

Rules:

1. Batch job must checkpoint progress.
2. Batch job must be restartable.
3. Batch job must avoid duplicate ingestion or define dedup behavior.
4. Batch job must expose progress metrics.

---

## 19. Anti-Patterns

Forbidden by default:

1. Treating ClickHouse like PostgreSQL/MySQL OLTP.
2. Single-row insert in a high-volume path.
3. `SELECT *` in API query code.
4. Unbounded user-controlled query.
5. User-provided raw SQL.
6. Dynamic table/column names without allow-list.
7. Using ClickHouse as source of truth for transactional workflow.
8. Frequent `ALTER TABLE ... UPDATE/DELETE` as normal business operation.
9. `ReplacingMergeTree` while expecting immediate uniqueness.
10. Over-partitioning by high-cardinality IDs.
11. No explicit `ORDER BY` strategy.
12. No query timeout.
13. No insert retry/idempotency policy.
14. Raw credentials in config files.
15. Logging full SQL with user input or secrets.
16. Creating client/connection per request.
17. ORM over ClickHouse entities.
18. Heavy query in health check.
19. Deep pagination with huge `OFFSET`.
20. Metrics tagged by raw SQL/user/tenant/request ID.

---

## 20. Required Design Note for New ClickHouse Integration

Every new ClickHouse integration must include this note in PR or architecture docs:

```markdown
## ClickHouse Integration Design Note

### Purpose

- What analytical problem is solved?
- Why ClickHouse instead of OLTP/search/cache?

### Workload

- Ingestion rate:
- Query rate:
- Expected row count:
- Expected retention:
- Expected row width:

### Schema

- Database/table:
- Engine:
- PARTITION BY:
- ORDER BY:
- Primary query filters:
- Retention/TTL:

### Ingestion

- Client:
- Batch size:
- Flush interval:
- Retry policy:
- Idempotency/duplicate policy:
- Async insert yes/no and why:

### Query

- Query methods:
- Mandatory filters:
- Time window limit:
- Result limit:
- Timeout:
- Tenant isolation:

### Operations

- Metrics:
- Logs:
- Alerts:
- Failure/retry behavior:
- Backfill/rebuild plan:

### Security

- Credentials source:
- TLS:
- Least privilege user:
- Data sensitivity:
```

---

## 21. LLM Implementation Protocol

Before generating Java + ClickHouse code, the LLM must answer internally:

1. Is this workload analytical, append-heavy, and query-oriented?
2. Is ClickHouse appropriate, or is the request actually OLTP/search/cache?
3. Which client is used: Java client or JDBC?
4. What is the query/insert contract?
5. What are timeouts and limits?
6. What is the idempotency/duplicate strategy?
7. What is the tenant/security boundary?
8. What schema/table assumptions are being made?
9. What failure mode will happen on timeout/retry/partial insert?
10. What tests are required?

The LLM must not generate ClickHouse code if these are unknown and material to correctness. It must either infer a conservative default and state it in comments/design note, or ask for clarification when interactive clarification is allowed.

---

## 22. Reviewer Checklist

A reviewer must reject the change if any answer is “no”:

### Client and lifecycle

- [ ] Uses official ClickHouse client/JDBC driver.
- [ ] Client/DataSource is reused and lifecycle-managed.
- [ ] No client/connection per request.
- [ ] Version is pinned.

### Security

- [ ] Credentials are externalized.
- [ ] TLS policy is explicit.
- [ ] No trust-all TLS.
- [ ] SQL values are bound or allow-listed.
- [ ] Tenant filtering is enforced where relevant.

### Schema

- [ ] Engine is justified.
- [ ] `ORDER BY` is intentional.
- [ ] `PARTITION BY` is not high-cardinality.
- [ ] Data types are correct.
- [ ] Nullable usage is justified.

### Ingestion

- [ ] Inserts are batched.
- [ ] Batch size is bounded.
- [ ] Retry policy is bounded.
- [ ] Duplicate/idempotency behavior is defined.
- [ ] Async insert semantics are understood if used.

### Query

- [ ] Query has mandatory filters.
- [ ] Query has timeout/deadline.
- [ ] Query has result limits.
- [ ] No unbounded `SELECT *`.
- [ ] Pagination strategy is safe.

### Operations

- [ ] Metrics/logs/traces are present.
- [ ] Logs do not expose sensitive data.
- [ ] Health checks are cheap.
- [ ] Large mutations/backfills have plan.

### Testing

- [ ] Integration tests use real ClickHouse or approved environment.
- [ ] Type mapping is tested.
- [ ] SQL generation is tested.
- [ ] Tenant isolation is tested.
- [ ] Retry/idempotency behavior is tested.

---

## 23. Sources

This standard is anchored to:

- ClickHouse Java Client documentation
- ClickHouse JDBC Driver documentation
- ClickHouse insert strategy and asynchronous insert documentation
- ClickHouse MergeTree, primary key, partitioning, and sparse index documentation
- ClickHouse mutation/update/delete documentation
- ClickHouse pagination and query best-practice documentation
- Java JDBC, security, testing, and telemetry standards used in this repository

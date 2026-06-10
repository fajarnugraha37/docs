# Strict Coding Standards: Java HikariCP

> Purpose: define non-negotiable rules for LLM-assisted implementation, review, and maintenance of Java applications that use HikariCP as a JDBC connection pool.
>
> This document is an overlay standard. It must be used together with:
>
> - `strict-coding-standards__jdbc.md`
> - `strict-coding-standards__java_postgresql.md` or the relevant database-specific standard
> - `strict-coding-standards__java_hibernate_orm.md`, `strict-coding-standards__jpa.md`, or `strict-coding-standards__java_mybatis.md` when applicable
> - `strict-coding-standards__java_kubernetes.md` when deployed on Kubernetes
> - `strict-coding-standards__java_telemetry.md` and `strict-coding-standards__java_logging.md`

---

## 1. Core Principle

HikariCP is not a performance magic switch. It is a bounded resource governor between application concurrency and database capacity.

The LLM must treat the pool as a **backpressure boundary**, not as an infinite connection factory.

A HikariCP configuration is acceptable only when it explicitly answers:

1. How many concurrent database operations may this service perform?
2. How many connections can the database safely accept from all replicas combined?
3. What happens when the pool is exhausted?
4. How are stale, leaked, dead, or long-held connections detected?
5. How are pool metrics observed in production?
6. How does the pool behave during startup, shutdown, failover, and network partition?

---

## 2. Version and Baseline Policy

### 2.1 Dependency Rule

For new Java 11+ code, use the normal artifact:

```xml
<dependency>
  <groupId>com.zaxxer</groupId>
  <artifactId>HikariCP</artifactId>
</dependency>
```

The version must be controlled through one of:

- Maven `dependencyManagement`
- Gradle version catalog
- framework BOM, such as Spring Boot dependency management

Do not hardcode random versions inside leaf modules.

### 2.2 Java Compatibility Rule

| Project Java Baseline | HikariCP Rule |
|---|---|
| Java 8 | legacy line only if project is explicitly Java 8 |
| Java 11+ | use current supported HikariCP line compatible with Java 11+ |
| Java 17/21/25 | use framework-managed or centrally pinned HikariCP version |

### 2.3 Forbidden Version Practices

The LLM must not:

- mix multiple HikariCP versions in one runtime
- override a framework BOM version without evidence
- use abandoned forks or random wrappers
- copy configuration from blog posts without checking official HikariCP properties
- upgrade HikariCP together with database driver/framework blindly in one change unless the migration plan is explicit

---

## 3. HikariCP Ownership Model

### 3.1 One Pool Represents One Database Access Contract

One `HikariDataSource` must represent one logical database access profile:

- same database endpoint
- same credentials or role
- same workload type
- same transaction expectation
- same latency/timeout profile

Separate pools are allowed only when workload isolation is real, for example:

- OLTP request path vs long-running reporting job
- read-write primary vs read-only replica
- tenant-isolated datasource
- batch job pool vs API pool

### 3.2 Forbidden Ownership Patterns

Do not create:

- one pool per request
- one pool per repository
- one pool per DAO
- one pool per tenant unless tenant count is bounded and capacity is proven
- one pool per thread
- one pool hidden inside utility classes
- unmanaged static `HikariDataSource` created outside application lifecycle

### 3.3 Lifecycle Rule

A Hikari pool must be:

- initialized during application startup
- health-checked before serving traffic, if the application requires database availability
- closed during shutdown
- observable via metrics/JMX/logs

Example:

```java
public final class DataSourceFactory {
    public HikariDataSource create(DatabaseSettings settings) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(settings.jdbcUrl());
        config.setUsername(settings.username());
        config.setPassword(settings.password());
        config.setPoolName(settings.poolName());
        config.setMaximumPoolSize(settings.maximumPoolSize());
        config.setConnectionTimeout(settings.connectionTimeout().toMillis());
        config.setValidationTimeout(settings.validationTimeout().toMillis());
        config.setMaxLifetime(settings.maxLifetime().toMillis());
        config.setKeepaliveTime(settings.keepaliveTime().toMillis());
        return new HikariDataSource(config);
    }
}
```

The factory must not hide environment-dependent values.

---

## 4. Configuration Classification

### 4.1 Required Properties

Every production pool must explicitly configure:

| Property | Rule |
|---|---|
| `poolName` | mandatory, stable, service-specific |
| `jdbcUrl` or `dataSource` | mandatory |
| credentials | from secret manager/environment, never hardcoded |
| `maximumPoolSize` | mandatory, justified by capacity model |
| `connectionTimeout` | mandatory, bounded wait behavior |
| `validationTimeout` | mandatory, less than `connectionTimeout` |
| `maxLifetime` | mandatory, shorter than DB/network lifetime |
| `keepaliveTime` | mandatory if infrastructure may close idle connections |
| `autoCommit` | explicit based on transaction model |
| metrics/JMX integration | mandatory for production |

### 4.2 Restricted Properties

These are allowed only with justification:

| Property | Reason |
|---|---|
| `minimumIdle` | Hikari recommends not setting it for maximum performance/responsiveness unless dynamic-idle behavior is required |
| `connectionTestQuery` | should not be used with JDBC4-compliant drivers; prefer `Connection.isValid()` |
| `transactionIsolation` | changes default behavior for all borrowed connections |
| `readOnly` | only if all connections from the pool have same read-only purpose |
| `connectionInitSql` | can add startup failure and hidden session state |
| `allowPoolSuspension` | can block connection acquisition indefinitely when suspended |
| `leakDetectionThreshold` | useful for debugging/diagnosis, not a substitute for fixing lifecycle bugs |
| custom `threadFactory` / `scheduledExecutor` | only in containers with explicit thread ownership rules |
| `exceptionOverride` | only for driver/database-specific behavior with tests |

### 4.3 Forbidden Defaults

The LLM must not leave these implicit in production:

- unnamed pool
- default max pool size with no capacity reasoning
- no timeout strategy
- no metrics
- no database driver timeout/socket behavior review
- no shutdown path
- no test for exhausted pool behavior

---

## 5. Pool Sizing Standard

### 5.1 Pool Size Is a Database Capacity Decision

`maximumPoolSize` must be derived from database capacity, not from application thread count.

Naive rule forbidden:

```text
maximumPoolSize = number of incoming HTTP threads
```

Naive rule forbidden:

```text
maximumPoolSize = 100 because production is busy
```

### 5.2 Required Capacity Model

Every service must document:

```text
pool_budget_per_database = database_max_connections - reserved_admin_connections - non_application_connections
service_pool_budget = pool_budget_per_database allocated to this service
per_replica_pool_size = floor(service_pool_budget / max_replicas)
```

For Kubernetes:

```text
total_service_connections = replicas * maximumPoolSize
```

This total must fit the database budget.

### 5.3 Starting Formula

For initial sizing, use small pools and validate with load testing.

A known starting point from HikariCP pool sizing guidance is:

```text
connections ≈ (database_core_count * 2) + effective_spindle_count
```

But this is only a starting point. Real workloads must be validated using:

- application load test
- database CPU/IO wait
- active vs idle connections
- pool wait time
- query latency
- lock wait
- transaction duration

### 5.4 Saturation Is Expected

A healthy service may have application threads waiting briefly for a connection. The pool should protect the database from overload.

Bad reaction:

```text
Connection timeout occurred -> immediately increase maximumPoolSize
```

Required investigation:

1. Are connections leaked?
2. Are transactions too long?
3. Are queries slow?
4. Is there N+1 query behavior?
5. Are application threads holding connections during remote I/O?
6. Are replicas multiplied beyond DB capacity?
7. Is `connectionTimeout` too low for expected burst behavior?
8. Is database max connection budget too small?

### 5.5 Pool-Locking Rule

If one execution path can borrow more than one connection at the same time, the design is suspect.

The LLM must first redesign to use one connection per transaction before increasing the pool.

If unavoidable, document:

```text
minimum_pool_to_avoid_deadlock = thread_count * (max_connections_per_thread - 1) + 1
```

Then still validate with load tests.

### 5.6 Long-Running Workload Rule

Long-running jobs must not starve request-path queries.

Allowed approaches:

- separate pool for batch/reporting
- bounded job executor aligned with pool size
- queue-based processing
- database read replica for reports
- pagination/keyset iteration

Forbidden:

- long export/report holds OLTP pool connections for minutes
- scheduled batch uses same pool as synchronous API with no concurrency cap
- streaming response holds connection while client slowly downloads

---

## 6. Timeout Policy

### 6.1 Timeout Layers

A complete timeout design includes:

| Layer | Example |
|---|---|
| Pool acquisition timeout | `connectionTimeout` |
| Connection validation timeout | `validationTimeout` |
| Driver socket/connect timeout | JDBC driver property |
| Statement/query timeout | `Statement.setQueryTimeout`, ORM/query setting, or DB-side statement timeout |
| Transaction timeout | framework transaction manager |
| HTTP/gRPC request timeout | outer boundary |
| Kubernetes termination grace | shutdown boundary |

Do not configure only Hikari timeout and call the system safe.

### 6.2 `connectionTimeout`

Rule:

- must be explicit
- must be shorter than the outer request timeout
- must be long enough for normal burst behavior
- must be short enough to fail predictably under pool starvation

Forbidden:

```properties
spring.datasource.hikari.connection-timeout=0
```

unless there is a documented reason to wait indefinitely, which is almost never acceptable in server applications.

### 6.3 `validationTimeout`

Rule:

- must be less than `connectionTimeout`
- must not hide network stalls
- must align with driver socket timeout

### 6.4 `maxLifetime`

Rule:

- must be several seconds shorter than any database, proxy, NAT, firewall, or load balancer connection lifetime
- must not exceed infrastructure idle/lifetime limits
- must not be set to infinite in normal production service

Example:

```properties
# Example only. Must match real DB/proxy policy.
spring.datasource.hikari.max-lifetime=1740000
```

### 6.5 `keepaliveTime`

Rule:

- must be less than `maxLifetime`
- should be used when network/database/proxy silently closes idle connections
- must not be treated as a fix for broken transaction/query behavior

### 6.6 Statement Timeout Required

HikariCP does not enforce query runtime by itself.

Every production system must enforce statement/query timeout through one or more of:

- JDBC statement timeout
- ORM query timeout
- database session setting
- database role default
- transaction manager timeout

Forbidden:

```text
Pool timeout exists, therefore queries are bounded.
```

Pool timeout bounds waiting for a connection, not the runtime of SQL after a connection is borrowed.

---

## 7. Transaction and Auto-Commit Policy

### 7.1 Transaction Boundary Rule

Connection acquisition must happen inside a clear transaction or unit-of-work boundary.

Forbidden:

- borrow connection in controller and pass it across layers
- hold connection while doing remote HTTP calls
- hold connection while waiting for user input
- hold connection while writing large files to client
- hold connection across asynchronous thread boundary unless explicitly designed

### 7.2 `autoCommit`

The setting must match the transaction model.

| Architecture | Rule |
|---|---|
| Raw JDBC manual transactions | explicit `setAutoCommit(false)` per transaction or pool default with reset guarantees |
| Spring/JTA transactions | let transaction manager control transaction lifecycle |
| Read-only simple queries | auto-commit may be true if each statement is independent |

Do not toggle auto-commit casually in helper methods.

### 7.3 Connection State Reset

Any code that mutates connection/session state must restore it or isolate it.

Examples of dangerous state:

- schema/search path
- isolation level
- read-only flag
- auto-commit
- session variables
- time zone
- role
- lock timeout
- statement timeout
- application name

Preferred:

- configure stable state centrally
- use transaction manager/session management
- avoid per-query hidden session mutation

---

## 8. Connection Lifecycle in Application Code

### 8.1 Always Close Borrowed Connections

In JDBC code, every borrowed connection must be returned via `close()` in `try-with-resources`.

Correct:

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement statement = connection.prepareStatement(sql)) {
    statement.setLong(1, id);
    try (ResultSet rs = statement.executeQuery()) {
        // map rows
    }
}
```

`Connection.close()` returns the connection to the pool. It must not be skipped.

### 8.2 ORM Integration

For JPA/Hibernate/MyBatis-Spring, application code must not manually close framework-managed connections.

Rules:

- repository code should not call `dataSource.getConnection()` when ORM session is expected to manage it
- do not mix raw JDBC and ORM in the same transaction unless transaction synchronization is clear
- do not unwrap Hibernate `Session`/JDBC `Connection` unless necessary and documented

### 8.3 No Connection Across Threads

A JDBC `Connection` must not be shared across threads.

Forbidden:

```java
Connection c = dataSource.getConnection();
CompletableFuture.runAsync(() -> use(c));
```

Each thread/task must acquire its own connection inside its own unit of work, with bounded concurrency.

---

## 9. Leak Detection Policy

### 9.1 Leak Detection Is Diagnostic, Not Design

`leakDetectionThreshold` may be enabled in staging or temporarily in production diagnosis.

Rules:

- threshold must be higher than normal query/transaction time
- threshold must not be used to mask slow queries
- logs must be actionable
- after leak is fixed, threshold may be disabled or raised depending on environment policy

### 9.2 Required Leak Investigation

When leak detection fires, inspect:

- missing `try-with-resources`
- transaction opened but not closed
- streaming result set kept open
- slow client download while connection is held
- async callback keeping repository operation open
- nested queries or N+1 behavior
- framework-managed session not closed
- deadlock/lock wait causing long connection hold

### 9.3 Forbidden Response

Do not fix leak warning by only increasing:

- `leakDetectionThreshold`
- `maximumPoolSize`
- `connectionTimeout`

unless root cause is documented and accepted.

---

## 10. Validation and Health Check Policy

### 10.1 Prefer JDBC4 Validation

If the driver supports JDBC4 validation, do not set `connectionTestQuery`.

HikariCP can use `Connection.isValid()` for aliveness checks.

### 10.2 Health Check Must Match Service Readiness

Application readiness should answer:

```text
Can this service perform its required DB work now?
```

A simple process-alive check is not enough for DB-dependent services.

### 10.3 Liveness Must Not Kill During Temporary DB Failure

Kubernetes liveness probes must not restart the app just because the database is temporarily unavailable.

Recommended separation:

| Probe | Meaning |
|---|---|
| startup | application initialized enough to start |
| readiness | can serve traffic; DB may be required |
| liveness | JVM/process is not deadlocked/unrecoverable |

Database connectivity should usually affect readiness, not liveness.

---

## 11. Startup and Fail-Fast Policy

### 11.1 `initializationFailTimeout`

The service must decide explicitly whether DB availability is required at startup.

| Service Type | Rule |
|---|---|
| DB-critical API | fail fast if DB unavailable |
| async worker with delayed dependency | may start and retry, but readiness must stay false |
| local development | may relax startup behavior |

### 11.2 Forbidden Ambiguity

Do not leave startup behavior unclear.

Required design note:

```text
Startup dependency policy:
- Database is required before readiness: yes/no
- Hikari initialization behavior:
- Readiness behavior when DB unavailable:
- Retry/backoff behavior:
```

---

## 12. Kubernetes and Autoscaling Rules

### 12.1 Replica-Aware Pool Size

Every Hikari pool in Kubernetes must account for replica count.

```text
max_database_connections_consumed = max_replicas * maximumPoolSize
```

This must include:

- API pods
- worker pods
- batch pods
- migration jobs
- admin tools
- read replica pools

### 12.2 HPA Rule

If HPA can increase replicas, the DB connection budget must be recalculated using `maxReplicas`, not current replicas.

Forbidden:

```text
current replicas = 3, pool = 20, DB can handle 80, therefore safe
```

If HPA max replicas is 10, actual maximum is 200 connections.

### 12.3 Rolling Deployment Spike

During rolling deployments, old and new pods may overlap.

Capacity must consider:

```text
max_connections_during_rollout = (old_replicas + surge_replicas) * maximumPoolSize
```

### 12.4 Graceful Shutdown

On shutdown:

1. readiness must become false
2. incoming traffic must drain
3. active requests/transactions should complete within grace period
4. Hikari pool must close
5. no new DB work should start after shutdown begins

---

## 13. Observability Rules

### 13.1 Required Metrics

Expose at minimum:

- active connections
- idle connections
- total connections
- pending threads waiting for connection
- connection acquisition time
- connection timeout count
- connection creation/error count if available
- pool max/min configuration

### 13.2 Required Alerts

Recommended alert conditions:

```text
pending_threads > 0 for sustained period
active_connections / maximumPoolSize > 0.9 for sustained period
connection acquisition p95/p99 above threshold
connection timeout count > 0
idle connections near 0 under normal traffic
pool total unexpectedly 0
database connection error spike
```

### 13.3 Logging Rules

Log pool startup configuration without secrets:

Allowed:

```text
poolName, maximumPoolSize, minimumIdle, connectionTimeout, validationTimeout, maxLifetime, keepaliveTime
```

Forbidden:

```text
password, full JDBC URL with credential/token, secret manager output
```

### 13.4 Correlation Rule

Database acquisition timeout errors must include:

- pool name
- operation name
- request/correlation ID
- route/job name
- tenant if applicable and allowed
- elapsed wait time

Do not log raw SQL with sensitive bind values.

---

## 14. Security Rules

### 14.1 Credential Handling

Database credentials must come from:

- secret manager
- Kubernetes Secret mounted/env with proper controls
- workload identity/token provider
- environment-specific secure config

Forbidden:

- hardcoded username/password
- committed `.properties` with password
- printing `HikariConfig` if it includes secret fields
- logging JDBC URLs containing credentials

### 14.2 TLS and Driver Properties

For networked databases, TLS policy must be explicit.

Rules:

- do not disable certificate validation
- do not use trust-all SSL factory
- define server certificate/truststore behavior if required
- align JDBC driver SSL settings with platform security standard

### 14.3 Least Privilege

Each pool credential must have minimum database privileges needed for that workload.

Separate credentials may be required for:

- read-only queries
- write operations
- migrations
- reporting
- maintenance jobs

Do not run application pools with schema-owner/migration credentials.

---

## 15. Framework Integration Rules

### 15.1 Spring Boot

When using Spring Boot:

- prefer framework-managed `DataSource`
- configure via `spring.datasource.hikari.*`
- avoid declaring a second unmanaged `HikariDataSource`
- ensure metrics are bound to Micrometer/Actuator
- ensure transaction manager uses the intended datasource

Forbidden:

```java
@Bean
DataSource dataSource() {
    return new HikariDataSource(); // no externalized config, no pool name, no timeout
}
```

### 15.2 Hibernate/JPA

When using Hibernate/JPA:

- Hikari should be configured at the DataSource layer or framework layer
- do not let Hibernate create uncontrolled pools when the application already has one
- transaction boundary must be managed by framework
- beware Open Session In View holding connections longer than expected
- lazy loading during serialization can hold/request connections unexpectedly

### 15.3 MyBatis

When using MyBatis-Spring:

- use Spring-managed datasource
- transaction lifecycle must be managed by Spring
- do not manually commit/rollback/close Spring-managed `SqlSession`

### 15.4 Raw JDBC

When using raw JDBC:

- acquire late, release early
- use `try-with-resources`
- explicitly manage transactions
- set statement/query timeout
- avoid holding connection across non-database work

---

## 16. Database-Specific Rules

### 16.1 PostgreSQL

Recommended considerations:

- set pgJDBC socket/connect timeout properties intentionally
- consider `tcpKeepAlive=true` if infrastructure requires it
- align `maxLifetime` with database/proxy/network connection lifetime
- avoid excessive pool size relative to PostgreSQL `max_connections`
- prefer external pooler such as PgBouncer only with clear transaction/session pooling semantics
- do not use session state patterns incompatible with transaction pooling

### 16.2 Oracle

Recommended considerations:

- validate whether HikariCP is appropriate vs Oracle UCP for RAC/FAN/FCF/Data Guard requirements
- align connection lifetime with firewall/load balancer/DB profile
- configure statement timeout and network timeout as supported
- avoid schema-owner application credentials

### 16.3 MySQL/MariaDB

Recommended considerations:

- align `maxLifetime` below `wait_timeout`/proxy timeout
- review driver reconnect behavior explicitly
- use TLS validation where required
- validate server time zone/session settings

### 16.4 SQL Server

Recommended considerations:

- align login/query/socket timeout behavior
- configure TLS/certificate validation explicitly
- validate transaction isolation semantics, especially snapshot isolation if used

---

## 17. Failure Mode Rules

### 17.1 Database Down

Expected behavior:

- new connection creation fails fast or retries according to startup/runtime policy
- readiness becomes false
- connection acquisition errors are bounded by `connectionTimeout`
- application does not spawn uncontrolled retries
- logs/metrics show database dependency failure

Forbidden:

- infinite retry loop per request
- pool recreated repeatedly per failed operation
- liveness restart storm caused by DB unavailability

### 17.2 Network Partition / Half-Open Connection

Rules:

- driver socket timeout/TCP keepalive must be considered
- Hikari keepalive may help with idle connections but does not solve all network stalls
- statement timeout is still required
- app retry must respect idempotency

### 17.3 Pool Exhaustion

Pool exhaustion is a signal.

Required response:

1. inspect active connection count
2. inspect pending waiters
3. inspect long transactions
4. inspect slow queries
5. inspect leak logs
6. inspect thread dump
7. inspect DB locks
8. inspect traffic spike/autoscaling state

### 17.4 Database Max Connections Reached

If the database reports too many connections:

- reduce per-replica pool size
- reduce max replicas or add connection budget
- separate workloads
- use external pooling if appropriate
- fix connection leaks
- remove unmanaged pools

Do not merely increase database `max_connections` without memory/process impact review.

---

## 18. Anti-Patterns

### 18.1 Oversized Pool

Bad:

```properties
spring.datasource.hikari.maximum-pool-size=200
```

without DB capacity calculation.

Risk:

- DB CPU context switching
- memory pressure
- lock contention
- slower query throughput
- higher tail latency

### 18.2 Pool Per DAO

Bad:

```java
class UserDao {
    private final HikariDataSource ds = new HikariDataSource();
}
```

Risk:

- connection explosion
- no central metrics
- no consistent lifecycle
- leaked pools

### 18.3 Holding Connection During Remote I/O

Bad:

```java
@Transactional
public void process() {
    repository.updateStatus(...);
    externalClient.callRemoteService();
    repository.updateResult(...);
}
```

Risk:

- long transaction
- lock wait
- connection starvation

Preferred:

- split transaction boundaries
- use outbox/event workflow
- store intent, call remote, reconcile later

### 18.4 No Statement Timeout

Bad:

```text
Hikari connectionTimeout = 30s, therefore SQL cannot run longer than 30s.
```

Wrong. SQL may run indefinitely after the connection is acquired unless bounded elsewhere.

### 18.5 Increasing Pool Size to Hide N+1

Bad:

```text
N+1 causes slow endpoint -> increase pool size
```

Correct:

- fix query plan
- use fetch join/entity graph/projection
- batch query
- add index
- reduce transaction scope

---

## 19. Recommended Configuration Template

### 19.1 Spring Boot YAML Example

```yaml
spring:
  datasource:
    url: ${DB_JDBC_URL}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      pool-name: ${SERVICE_NAME}-main-db
      maximum-pool-size: 10
      minimum-idle: 10
      connection-timeout: 2000
      validation-timeout: 1000
      idle-timeout: 600000
      max-lifetime: 1740000
      keepalive-time: 120000
      auto-commit: false
      register-mbeans: true
```

This is an example, not a universal recommendation. Values must be adjusted per database, workload, driver, and deployment.

### 19.2 Raw Java Example

```java
public final class HikariDataSourceFactory {
    public HikariDataSource create(DatabasePoolSettings s) {
        HikariConfig config = new HikariConfig();
        config.setPoolName(s.poolName());
        config.setJdbcUrl(s.jdbcUrl());
        config.setUsername(s.username());
        config.setPassword(s.password());
        config.setMaximumPoolSize(s.maximumPoolSize());
        config.setMinimumIdle(s.minimumIdle());
        config.setConnectionTimeout(s.connectionTimeout().toMillis());
        config.setValidationTimeout(s.validationTimeout().toMillis());
        config.setIdleTimeout(s.idleTimeout().toMillis());
        config.setMaxLifetime(s.maxLifetime().toMillis());
        config.setKeepaliveTime(s.keepaliveTime().toMillis());
        config.setAutoCommit(s.autoCommit());
        config.setRegisterMbeans(s.registerMbeans());
        s.driverProperties().forEach(config::addDataSourceProperty);
        return new HikariDataSource(config);
    }
}
```

---

## 20. Testing Requirements

### 20.1 Unit Tests

Test config mapping:

- pool name is set
- max size from config is applied
- timeout values are applied
- secrets are not logged
- invalid config fails early

### 20.2 Integration Tests

Use a real database container or test database.

Required scenarios:

- acquire and release connection
- transaction commit/rollback
- pool exhaustion with small pool
- connection acquisition timeout
- DB restart or connection invalidation if feasible
- statement timeout behavior
- framework transaction integration

### 20.3 Load Tests

Before changing `maximumPoolSize`, run load tests that capture:

- throughput
- p50/p95/p99 latency
- pool active/idle/pending
- DB CPU
- DB IO wait
- DB lock wait
- query latency
- timeout count
- error rate

### 20.4 Failure Injection Tests

Where feasible:

- database unavailable at startup
- database unavailable after startup
- network interruption
- slow query
- lock wait
- exhausted pool
- pod termination during active request

---

## 21. Reviewer Checklist

A reviewer must reject the change if any answer is missing:

### Pool Ownership

- [ ] Is there exactly one intended pool per logical datasource/workload?
- [ ] Is lifecycle managed by application/framework?
- [ ] Is `close()` called on shutdown?
- [ ] Are unmanaged/static pools absent?

### Sizing

- [ ] Is `maximumPoolSize` explicitly set?
- [ ] Is pool size justified by DB capacity and replica count?
- [ ] Is HPA/rolling deployment surge included?
- [ ] Are batch/report workloads isolated or bounded?

### Timeout

- [ ] Is `connectionTimeout` explicit?
- [ ] Is `validationTimeout < connectionTimeout`?
- [ ] Is `maxLifetime` below infrastructure limit?
- [ ] Is `keepaliveTime < maxLifetime` if used?
- [ ] Is statement/query timeout configured elsewhere?

### Transaction/Lifecycle

- [ ] Are connections acquired late and released early?
- [ ] Is there no connection held during remote I/O?
- [ ] Are transaction boundaries clear?
- [ ] Are raw JDBC and ORM integration safe?

### Observability

- [ ] Are pool metrics exported?
- [ ] Is `poolName` stable and meaningful?
- [ ] Are alerts defined for pending waiters/timeouts/high usage?
- [ ] Are secrets excluded from logs?

### Security

- [ ] Are credentials externalized?
- [ ] Is TLS policy explicit where needed?
- [ ] Does the pool use least-privilege credentials?
- [ ] Are migration/admin credentials separated from app credentials?

### Failure Behavior

- [ ] Is startup DB dependency policy explicit?
- [ ] Does readiness reflect DB dependency?
- [ ] Does liveness avoid DB restart storms?
- [ ] Is pool exhaustion behavior tested?

---

## 22. LLM Prompt Contract

When implementing or modifying HikariCP usage, the LLM must produce this design note before code:

```text
HikariCP Design Note

1. Datasource purpose:
2. Framework integration: raw JDBC / Spring / Hibernate / MyBatis / other
3. Database and driver:
4. Pool ownership and lifecycle:
5. maximumPoolSize calculation:
   - DB max connections:
   - reserved connections:
   - service budget:
   - max replicas:
   - rollout surge:
   - final per-pod pool size:
6. Timeout policy:
   - connectionTimeout:
   - validationTimeout:
   - maxLifetime:
   - keepaliveTime:
   - statement/query timeout location:
7. Transaction boundary:
8. Startup behavior:
9. Readiness/liveness behavior:
10. Metrics and alerts:
11. Security/credentials/TLS:
12. Failure modes tested:
```

If the LLM cannot fill this note, it must not change HikariCP pool size or lifecycle code.

---

## 23. Strict Forbidden List

The LLM must not:

- create a `HikariDataSource` per request
- create a pool inside DAO/repository constructors
- increase `maximumPoolSize` without DB capacity calculation
- hold JDBC connections during HTTP/gRPC calls
- hold JDBC connections during file/network streaming to clients
- treat `connectionTimeout` as SQL query timeout
- use migration/admin DB credentials for application pool
- log DB password or secret-bearing JDBC URL
- rely on default pool name in production
- rely on default pool size in production
- ignore replica count in Kubernetes
- use DB-dependent liveness check that causes restart storm
- enable `connectionTestQuery` with a JDBC4-compliant driver without justification
- hide Hikari config inside static utility code
- disable TLS validation for database connections
- use leak detection as a permanent substitute for correct connection lifecycle

---

## 24. References

- HikariCP GitHub README: https://github.com/brettwooldridge/HikariCP
- HikariCP Pool Sizing Wiki: https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing
- HikariCP Wiki Home: https://github.com/brettwooldridge/HikariCP/wiki
- JDBC API: https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/package-summary.html
- Kubernetes Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Kubernetes Resources: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/

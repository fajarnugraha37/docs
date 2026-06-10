# Strict Coding Standards: Java + MySQL

> Purpose: mandatory implementation rules for LLM code agents and reviewers when writing Java code that talks to MySQL.
>
> Scope: JDBC, HikariCP, Spring JDBC, JPA/Hibernate, MyBatis, Flyway/Liquibase, read/write splitting, and MySQL-specific SQL behavior.
>
> This file is an overlay. Apply it together with:
>
> - `strict-coding-standards__java*.md`
> - `strict-coding-standards__jdbc.md`
> - `strict-coding-standards__java_hikari_cp.md`
> - `strict-coding-standards__jpa.md`
> - `strict-coding-standards__java_hibernate_orm.md`
> - `strict-coding-standards__java_mybatis.md`
> - `strict-coding-standards__java_flyaway.md` or `strict-coding-standards__java_liquibase.md`
> - `strict-coding-standards__java_security.md`

---

## 1. Non-negotiable rules

### 1.1 MySQL is relational OLTP by default

Treat MySQL as a transactional relational database.

Do not use MySQL as:

- a cache replacement;
- an event broker;
- an unbounded document store;
- a full-text/search engine replacement unless explicitly designed;
- an analytics warehouse for massive scans;
- a distributed lock service without strict lock semantics and timeout.

### 1.2 Every database decision must declare the target MySQL family

Before changing schema, SQL, or driver configuration, identify:

```text
mysql_target:
  engine: MySQL | Aurora MySQL | Percona Server | MariaDB
  server_major: "8.0" | "8.4 LTS" | "9.x Innovation" | other
  connector: "MySQL Connector/J"
  connector_version: "pinned version"
  java_baseline: 11 | 17 | 21 | 25
  access_stack: JDBC | Spring JDBC | JPA/Hibernate | MyBatis | jOOQ | mixed
```

Rules:

- Do not assume MariaDB and MySQL are interchangeable.
- Do not use MySQL-specific syntax without target-version confirmation.
- Do not use MySQL 9.x-only behavior in a MySQL 8.0/8.4 project.
- Do not use vendor-specific Aurora/Percona/MariaDB behavior unless the project explicitly targets it.

### 1.3 Use official Connector/J for MySQL projects

Default dependency:

```xml
<dependency>
  <groupId>com.mysql</groupId>
  <artifactId>mysql-connector-j</artifactId>
  <version>${mysql.connector.version}</version>
</dependency>
```

Rules:

- Pin exact connector version.
- Do not use deprecated legacy artifact coordinates such as `mysql:mysql-connector-java` for new code.
- Do not mix MySQL Connector/J and MariaDB Connector/J unless explicitly approved and tested.
- Do not rely on transitive database driver dependency from framework starters.
- Do not let LLM upgrade the driver silently.

### 1.4 Use `DataSource`, not `DriverManager`, in application code

Allowed:

- HikariCP `DataSource`.
- Container-managed `DataSource`.
- Framework-managed `DataSource`.

Forbidden in production application code:

```java
DriverManager.getConnection(...)
```

Allowed only in:

- small CLI diagnostics;
- migration tool internals;
- test utilities;
- explicit throwaway examples.

### 1.5 Runtime values must use bind parameters

Mandatory:

```java
try (PreparedStatement ps = connection.prepareStatement("select * from user_account where id = ?")) {
    ps.setLong(1, id);
    try (ResultSet rs = ps.executeQuery()) {
        ...
    }
}
```

Forbidden:

```java
String sql = "select * from user_account where id = " + id;
```

Dynamic identifiers must be allow-listed:

```java
String sortColumn = switch (request.sort()) {
    case CREATED_AT -> "created_at";
    case EMAIL -> "email";
    case STATUS -> "status";
};
```

Never bind identifiers with `?`; SQL bind parameters are for values, not table/column names.

---

## 2. Driver and connection configuration

### 2.1 Connector/J version policy

Rules:

- Use the current project-approved Connector/J line.
- For modern MySQL Server 8.0+ projects, use Connector/J 9.x only after verifying server/framework compatibility.
- For legacy MySQL 5.7 projects, do not upgrade blindly to Connector/J 9.x.
- Driver upgrade PR must include release-note review, test result, and rollback plan.

Required dependency note:

```text
Connector/J version:
Reason for version:
Compatible MySQL Server versions:
Tested Java versions:
Framework integration tested:
```

### 2.2 JDBC URL rules

Preferred structure:

```text
jdbc:mysql://host:3306/database
  ?useUnicode=true
  &characterEncoding=utf8
  &connectionTimeZone=UTC
  &preserveInstants=true
  &sslMode=VERIFY_IDENTITY
```

Rules:

- Credentials must not be embedded in JDBC URL.
- Host, database name, username, and password must come from config/secrets.
- TLS mode must be explicit for production.
- Time zone behavior must be explicit.
- Connection pool owns connection lifetime.
- Do not place secret values in logs, exception messages, actuator output, or metric tags.

### 2.3 TLS/SSL rules

Production must use one of:

- `sslMode=VERIFY_IDENTITY`; or
- platform-approved equivalent with hostname verification.

Forbidden:

```text
sslMode=DISABLED
sslMode=PREFERRED   # for production-sensitive data
trustServerCertificate=true
```

unless the environment is explicitly local/dev-only.

### 2.4 Timeout rules

Every pool/client must define:

```text
connect timeout
socket/read timeout
pool acquisition timeout
transaction timeout where supported
query timeout for risky operations
migration timeout / lock timeout where applicable
```

Forbidden:

- infinite socket timeout;
- missing query timeout for batch jobs;
- missing pool timeout;
- relying on database default lock wait timeout without application-level handling.

### 2.5 Time zone and temporal configuration

Mandatory:

- Use UTC for persisted instants.
- Prefer `Instant`/`OffsetDateTime` at Java boundary where instant matters.
- Use `LocalDate` only for date-only business concepts.
- Use `LocalDateTime` only when the value is intentionally timezone-free.
- Define Connector/J temporal behavior explicitly.

Recommended connection properties for instant preservation:

```text
connectionTimeZone=UTC
preserveInstants=true
```

Forbidden:

- relying on JVM default timezone;
- relying on database session timezone;
- mixing server timezone and app timezone without tests;
- storing audit timestamps as ambiguous local time.

### 2.6 Character set and collation

Rules:

- Use `utf8mb4`, not MySQL legacy `utf8`/`utf8mb3`, for user text.
- Collation must be deliberate and documented.
- Case-insensitive search must not be assumed from Java string behavior.
- Unique constraints involving text must be reviewed against collation semantics.
- Binary identifiers/tokens must use binary-safe columns, not text columns.

Example:

```sql
email varchar(320) character set utf8mb4 collate utf8mb4_0900_ai_ci not null
```

But if case-sensitive semantics are required, use a case-sensitive collation or normalized companion column.

---

## 3. SQL mode and session state

### 3.1 Strict SQL mode is mandatory

Production must use strict SQL behavior. Required review:

```sql
select @@sql_mode;
```

Forbidden assumptions:

- silent truncation is acceptable;
- invalid dates may be coerced;
- zero date is valid business data;
- non-deterministic `GROUP BY` is acceptable.

Application code must not depend on permissive SQL mode.

### 3.2 Session state must be controlled

If the application sets session state, document it:

```sql
set time_zone = '+00:00';
set transaction isolation level read committed;
```

Rules:

- Do not change session state casually in pooled connections.
- If session variables are changed, restore them or ensure pool resets them.
- Do not rely on session variables hidden in SQL snippets.
- Do not use `SET` statements generated by LLM without review.

---

## 4. Schema design rules

### 4.1 Engine policy

Default table engine:

```sql
ENGINE=InnoDB
```

Forbidden for application tables unless explicitly approved:

- MyISAM;
- MEMORY for durable state;
- CSV/Archive as application storage;
- engine omitted in generated DDL.

### 4.2 Primary key policy

Every table must have a primary key.

Rules:

- Prefer stable, immutable primary keys.
- Do not use mutable business fields as primary key.
- If using UUID, define storage policy: `binary(16)` vs `char(36)`.
- If using auto-increment, understand insert hotspot and replication behavior.
- Do not expose sequential IDs as authorization proof.

### 4.3 Foreign key policy

Rules:

- Use foreign keys for core relational integrity unless project architecture explicitly rejects them.
- If foreign keys are omitted for performance/operational reasons, the application must document compensating checks.
- Cascading delete/update must be intentional.
- Do not use `ON DELETE CASCADE` for domain-critical data without explicit approval.

### 4.4 Nullability policy

Rules:

- Columns must be `NOT NULL` unless absence is meaningful.
- Boolean flags must be `NOT NULL` with explicit default only if default is business-correct.
- Nullable foreign keys must define lifecycle semantics.
- Do not use empty string, `0`, or sentinel date as fake null.

### 4.5 Default value policy

Rules:

- Defaults must reflect domain truth, not convenience.
- Do not use `CURRENT_TIMESTAMP` for all time columns blindly.
- `created_at` may be database-generated if all writers agree.
- `updated_at` must be controlled consistently by database trigger, ORM, or application; not mixed.

### 4.6 JSON columns

`JSON` is allowed only for:

- external raw payload snapshot;
- sparse optional metadata;
- append-only event payload;
- low-query flexibility field.

Restricted:

- core relational state in JSON;
- query-heavy JSON fields without generated-column/function-index strategy;
- unbounded JSON document growth;
- JSON used to avoid migrations.

Required for queryable JSON:

```sql
alter table order_event
  add column customer_id_generated varchar(64)
    generated always as (json_unquote(json_extract(payload, '$.customerId'))) stored,
  add index idx_order_event_customer_id (customer_id_generated);
```

### 4.7 Enum policy

MySQL `ENUM` is restricted.

Allowed only if:

- values are stable and rarely changed;
- migration impact is accepted;
- Java enum mapping is tested;
- sorting semantics are not dependent on enum ordinal.

Preferred for evolving values:

- lookup table;
- constrained string with application validation;
- check constraint where supported and policy-approved.

### 4.8 Money and decimal policy

Use `decimal(p, s)` for exact decimal values.

Rules:

- Java type must be `BigDecimal`.
- Scale and rounding must be explicit in application service.
- Do not use `double`/`float` for money.
- Do not use MySQL `FLOAT`/`DOUBLE` for financial values.
- Document currency handling separately from numeric amount.

### 4.9 Temporal column policy

Recommended mapping:

| Use case                 | MySQL type                                          | Java type                     |
| ------------------------ | --------------------------------------------------- | ----------------------------- |
| audit/event instant      | `timestamp(6)` or `datetime(6)` with UTC discipline | `Instant` / `OffsetDateTime`  |
| date-only business value | `date`                                              | `LocalDate`                   |
| local wall time          | `time` / `datetime(6)`                              | `LocalTime` / `LocalDateTime` |
| duration                 | numeric seconds/millis or ISO string                | `Duration`                    |

Rules:

- Use microsecond precision intentionally: `timestamp(6)`/`datetime(6)`.
- Do not compare Java nanosecond timestamps against MySQL microsecond values without truncation policy.
- Do not use `timestamp` vs `datetime` without understanding timezone conversion behavior.

---

## 5. Indexing and query design

### 5.1 Query-first index design

Every new index must specify:

```text
Index name:
Table:
Query/queries served:
Predicate columns:
Join columns:
Sort columns:
Cardinality/selectivity assumption:
Expected row count:
Write overhead accepted:
Plan evidence:
```

Forbidden:

- adding index because a column “looks searchable”;
- adding many redundant indexes;
- indexing every foreign key without verifying query pattern;
- ignoring write overhead;
- shipping query-critical change without `EXPLAIN` evidence.

### 5.2 Composite index order

Rules:

- Equality predicates usually come before range predicates.
- Sort requirements must be considered in index order.
- Index prefix must match query access pattern.
- Avoid low-cardinality leading columns unless combined with selective columns.
- Do not assume database can use arbitrary index suffix efficiently.

### 5.3 Functional/generated-column indexes

Allowed for:

- normalized email/lowercase lookup;
- JSON scalar extraction;
- date bucketing;
- computed search key.

Rules:

- Expression must be deterministic.
- Application must not duplicate inconsistent computation.
- Migration must backfill/validate generated values.
- Query must use expression/indexable form.

### 5.4 Pagination

Preferred:

```sql
where (created_at, id) < (?, ?)
order by created_at desc, id desc
limit ?
```

Restricted:

```sql
limit ? offset ?
```

`OFFSET` pagination is allowed only for:

- small admin tables;
- explicit UX requirement;
- bounded page depth;
- evidence that scan cost is acceptable.

Forbidden:

- unbounded deep offset pagination in public API;
- pagination without deterministic order;
- ordering only by non-unique column when duplicate values exist.

### 5.5 `SELECT *` policy

Forbidden in production application queries except:

- migration diagnostics;
- test-only queries;
- explicitly internal ad-hoc tooling.

Required:

- select only columns needed by the use case;
- preserve DTO projection boundary;
- avoid accidental LOB/JSON fetch.

### 5.6 `EXPLAIN` policy

For any query that is:

- called frequently;
- scans large tables;
- joins large tables;
- uses JSON/generated columns;
- uses sorting/grouping;
- powers public API;
- part of batch job;

provide plan evidence:

```sql
EXPLAIN FORMAT=TREE ...;
EXPLAIN ANALYZE ...; -- only in safe environment
```

Do not run `EXPLAIN ANALYZE` against production write statements casually.

---

## 6. Transaction and locking rules

### 6.1 Transaction boundary

Rules:

- Transaction boundary belongs in application service/use-case layer, not repository helper.
- Do not open transaction inside low-level DAO without explicit reason.
- Keep transactions short.
- Do not perform external network calls inside database transaction unless unavoidable and documented.
- Do not wait for user input or remote API while holding locks.

### 6.2 Isolation level

Default must be project-defined.

Common policy:

```text
READ COMMITTED for reducing gap-lock surprises when acceptable.
REPEATABLE READ if snapshot behavior is required and team understands InnoDB semantics.
SERIALIZABLE only with explicit contention/performance review.
```

Rules:

- Do not change isolation level as a guess.
- Do not use `SERIALIZABLE` as a generic race-condition fix.
- Add concurrency tests for read-modify-write flows.

### 6.3 Read-modify-write

Unsafe:

```sql
select balance from account where id = ?;
-- app computes new value
update account set balance = ? where id = ?;
```

Safer options:

```sql
update account
set balance = balance - ?
where id = ? and balance >= ?;
```

or:

```sql
select balance from account where id = ? for update;
```

Rules:

- Prefer atomic update with condition where possible.
- If using `SELECT ... FOR UPDATE`, ensure index supports target row lookup.
- Handle zero-row update as business conflict.
- Add concurrency test.

### 6.4 Locking reads

Rules:

- `SELECT ... FOR UPDATE` must be inside transaction.
- Locking query must be selective and indexed.
- Lock wait behavior must be considered.
- `NOWAIT`/`SKIP LOCKED` may be used only for specific contention patterns.

`SKIP LOCKED` is restricted because it intentionally allows inconsistent view suitable for queue-like processing, not general correctness.

### 6.5 Deadlock and lock timeout handling

Rules:

- Deadlocks are possible and must be handled.
- Retry only idempotent transaction blocks or blocks with idempotency key.
- Use bounded retry with jitter.
- Log SQL state/error code safely.
- Do not retry blindly around non-idempotent external side effects.

Required retry note:

```text
Retried operation:
Idempotency guarantee:
Max attempts:
Backoff:
Conflict/deadlock SQL states handled:
External side effects inside transaction: yes/no
```

---

## 7. Write path rules

### 7.1 Insert batching

Rules:

- Batch size must be bounded.
- Use prepared statement batch.
- Disable autocommit for multi-row batch transaction where appropriate.
- Handle partial failure and duplicate-key behavior explicitly.
- For Connector/J, `rewriteBatchedStatements` may be used only with tests and understanding of generated keys/SQL shape.

Example:

```java
try (PreparedStatement ps = connection.prepareStatement("""
        insert into audit_event(id, occurred_at, type, payload)
        values (?, ?, ?, cast(? as json))
        """)) {
    for (AuditEvent event : events) {
        ps.setString(1, event.id());
        ps.setTimestamp(2, Timestamp.from(event.occurredAt()));
        ps.setString(3, event.type());
        ps.setString(4, event.payloadJson());
        ps.addBatch();
    }
    ps.executeBatch();
}
```

### 7.2 Upsert policy

MySQL upsert:

```sql
insert into table_name(id, value, version)
values (?, ?, ?)
on duplicate key update
  value = values(value),
  version = version + 1;
```

Rules:

- Upsert must define conflict key.
- Upsert must define whether update is idempotent.
- Do not use upsert to hide duplicate business commands.
- Track affected rows behavior if business logic depends on insert vs update.

### 7.3 Generated keys

Rules:

- Use `RETURN_GENERATED_KEYS` only when primary key is database-generated.
- Do not mix generated keys and application-generated IDs without reason.
- Batch generated-key behavior must be tested with Connector/J settings.

### 7.4 Large object handling

Rules:

- Avoid storing large binary files in MySQL unless required.
- Prefer object storage for large files and store metadata/reference in MySQL.
- If storing BLOB/TEXT, stream it and set size limits.
- Do not fetch LOB columns by default.

---

## 8. Read path rules

### 8.1 Streaming large result sets

Rules:

- Do not load unbounded result sets into memory.
- Use pagination or streaming cursor behavior.
- Verify Connector/J streaming behavior for chosen driver version/settings.
- Keep transaction and connection lifetime visible.
- Do not stream result set outside transaction/session lifecycle.

### 8.2 Read replica policy

If using replicas:

- Read-after-write consistency must be defined.
- Transactional read-your-write must use primary or causal strategy.
- Lag metric must be observed.
- Queries must be routeable by consistency requirement.

Forbidden:

- sending all reads to replica without considering lag;
- authorization checks on stale replica after recent permission change;
- workflow state transition checks on stale replica.

### 8.3 Query timeout

Every user-facing query must have bounded execution behavior via one or more of:

- JDBC query timeout;
- database statement timeout policy;
- connection/socket timeout;
- service-level timeout.

Do not rely only on HTTP timeout while database query keeps running.

---

## 9. ORM and framework integration

### 9.1 Hibernate/JPA rules for MySQL

Rules:

- Dialect must match MySQL major/version family.
- Do not use ORM auto-DDL in production.
- Avoid `GenerationType.AUTO` without verifying generated strategy.
- Validate enum mapping (`STRING`, not ordinal).
- Review `LocalDateTime`/`Instant` mapping explicitly.
- Avoid entity graph/fetch join pagination pitfalls.
- Avoid `FetchType.EAGER` by default.
- Do not expose entity as API DTO.

### 9.2 MyBatis rules for MySQL

Rules:

- Use `#{}` for values.
- `${}` only for allow-listed SQL fragments.
- XML mapper SQL must be reviewed like production SQL.
- Dynamic SQL must not construct unsafe `ORDER BY`, table names, or raw predicates.
- Large mapper queries require `EXPLAIN` evidence.

### 9.3 Spring rules

Rules:

- `@Transactional` belongs on use-case/service boundary.
- Self-invocation does not trigger Spring proxy transaction behavior.
- Do not mix manual JDBC transaction and Spring-managed transaction unless intentionally bridged.
- Use typed configuration properties for database settings.
- Do not log JDBC URLs with credentials.

### 9.4 Flyway/Liquibase rules

Rules:

- Schema migration is the only production schema-change path.
- Applied migration must not be edited.
- Destructive migration requires backup/rollback/roll-forward plan.
- Online DDL impact must be reviewed for large tables.
- Backfills must be chunked and restartable.

---

## 10. Security rules

### 10.1 SQL injection

Mandatory:

- bind parameters for values;
- allow-list for identifiers;
- no raw user predicate fragments;
- no dynamic SQL from request body;
- tests for unsafe sorting/filtering inputs.

Forbidden:

```java
"where name like '%" + input + "%'"
```

Allowed:

```sql
where name like concat('%', ?, '%')
```

with escaping policy for literal `%`/`_` if needed.

### 10.2 Least privilege

Application database user must have only required permissions.

Rules:

- Runtime app user must not own schema migrations unless architecture explicitly uses same principal.
- Migration user and runtime user should be separate.
- Read-only workers should use read-only DB user.
- Avoid global privileges.

### 10.3 Secrets

Rules:

- Database password must come from secret manager/vault/Kubernetes Secret with proper access policy.
- Do not put credentials in repository, Docker image, logs, stack traces, metrics, or actuator endpoints.
- Rotation strategy must be supported by pool/restart behavior.

### 10.4 Row-level/tenant isolation

Rules:

- Tenant filter must be enforced at repository/query boundary.
- Do not trust tenant ID from request body.
- For composite tenant-scoped tables, indexes must include tenant key where query requires it.
- Authorization query must not use stale read replica unless acceptable.

---

## 11. Observability and diagnostics

### 11.1 Required metrics

Track:

```text
pool active connections
pool idle connections
pool pending acquisition
connection acquisition latency
query latency by operation name
transaction duration
deadlock count
lock timeout count
duplicate-key conflict count
rows returned/affected for critical queries
replica lag when applicable
migration duration/status
```

### 11.2 Logging rules

Allowed:

```text
operation name
query name/id
duration
row count
SQL state/error code
sanitized table name
correlation id
```

Forbidden:

- logging full SQL with user data in production;
- logging credentials/JDBC URL password;
- logging PII values in SQL parameters;
- logging huge JSON payloads.

### 11.3 Slow query diagnostics

For slow query investigation, capture:

```text
operation name
sanitized SQL template
bound parameter shape, not values
EXPLAIN plan
row estimate vs actual if available
index used
lock wait time if known
pool acquisition time
network latency if known
```

---

## 12. Testing standards

### 12.1 Integration test database

Rules:

- Use real MySQL-compatible database for integration tests.
- Do not rely only on H2 for MySQL behavior.
- Test with same SQL mode, charset, collation, timezone, and isolation policy as production.
- Migration must run in test startup.

### 12.2 Required test cases

For DB changes, include:

- migration up test;
- repository happy path;
- not found path;
- duplicate key/conflict path;
- null/constraint violation path;
- transaction rollback path;
- timezone/precision test for temporal fields;
- collation/case-sensitivity test for text uniqueness/search;
- pagination deterministic order test;
- concurrency test for read-modify-write if applicable;
- large payload/batch boundary test if applicable.

### 12.3 Concurrency tests

Required when code uses:

- `SELECT ... FOR UPDATE`;
- optimistic locking/version column;
- unique-key idempotency;
- queue-like table with `SKIP LOCKED`;
- inventory/balance/counter update;
- status transition.

---

## 13. Migration and operations

### 13.1 Online DDL policy

Before altering large table:

```text
Table size:
Write rate:
Read criticality:
Lock behavior:
Algorithm requested:
Rollback/roll-forward:
Backfill needed:
Replica impact:
Backup available:
```

Rules:

- Do not assume `ALTER TABLE` is harmless.
- Prefer additive migrations before code switch.
- Split migration into expand/backfill/contract phases for risky changes.
- Backfill must be chunked, throttled, and resumable.

### 13.2 Expand-contract pattern

Preferred for breaking schema changes:

1. Add nullable/new column/table.
2. Deploy dual-write or compatibility code.
3. Backfill safely.
4. Verify consistency.
5. Switch reads.
6. Stop old writes.
7. Drop old column/table later.

### 13.3 Data cleanup

Rules:

- Delete in bounded batches.
- Avoid massive single transaction delete.
- Consider archive table/object storage for audit data.
- Measure index/table bloat and purge impact.

---

## 14. Common anti-patterns

Forbidden unless explicitly approved:

- `SELECT *` in repository/API query.
- Deep `OFFSET` pagination for large tables.
- String-concatenated SQL with request input.
- JSON column used as schema avoidance.
- Missing primary key.
- Missing index for high-frequency foreign-key lookup.
- Changing isolation level randomly.
- Long transaction with remote HTTP call inside.
- ORM auto-DDL in production.
- Enum ordinal persistence.
- `LocalDateTime.now()` persisted as audit instant.
- Storing money as `double`.
- Storing user text as `utf8mb3`.
- Using read replica for authorization-critical fresh read.
- Blind retry of non-idempotent transaction.
- Unlimited connection pool size.
- Pool size multiplied across Kubernetes replicas without DB capacity check.
- Storing large files in MySQL by default.
- Logging SQL parameters containing PII/secrets.

---

## 15. LLM implementation protocol

Before generating Java/MySQL code, the LLM must state:

```text
1. Access stack: JDBC / Spring JDBC / JPA / Hibernate / MyBatis / other
2. MySQL target version/family
3. Driver version assumption
4. Transaction boundary
5. Query shape and indexes needed
6. Temporal/timezone policy
7. Charset/collation impact
8. Retry/idempotency behavior
9. Migration required: yes/no
10. Tests to add
```

If any item is unknown, the LLM must choose the safest conservative default and mark the assumption.

---

## 16. Reviewer checklist

A reviewer must reject code if any answer is unsafe:

### Driver/config

- [ ] Connector/J version is pinned.
- [ ] Runtime uses `DataSource`/pool, not raw `DriverManager`.
- [ ] Timezone behavior is explicit.
- [ ] TLS is explicit for production.
- [ ] Timeouts are explicit.
- [ ] Pool sizing accounts for replicas and DB capacity.

### SQL/schema

- [ ] SQL uses bind parameters for values.
- [ ] Dynamic identifiers are allow-listed.
- [ ] Tables have primary keys.
- [ ] Charset/collation are intentional.
- [ ] JSON column usage is justified.
- [ ] Indexes match query patterns.
- [ ] Query-critical changes have plan evidence.

### Transactions

- [ ] Transaction boundary is at use-case layer.
- [ ] Isolation level is intentional.
- [ ] Read-modify-write is safe.
- [ ] Locking reads are indexed and bounded.
- [ ] Deadlock/timeout behavior is handled.
- [ ] Retry is idempotent or guarded by idempotency key.

### Data correctness

- [ ] Money uses `BigDecimal`/`decimal`.
- [ ] Temporal precision/timezone is tested.
- [ ] Enum/string values are stable and validated.
- [ ] Nullability/defaults reflect domain truth.
- [ ] Read replica consistency is handled.

### Security/observability

- [ ] No credential leakage.
- [ ] No SQL injection path.
- [ ] Least privilege considered.
- [ ] Tenant isolation enforced.
- [ ] Logs are sanitized.
- [ ] Metrics include pool/query/transaction signals.

### Testing

- [ ] Integration tests use real MySQL-compatible database.
- [ ] Migrations are tested.
- [ ] Constraint/conflict paths are tested.
- [ ] Concurrency paths are tested where relevant.
- [ ] Timezone/collation behavior is tested where relevant.

---

## 17. Prompt contract for LLM code agents

Use this instruction when asking an LLM to implement Java + MySQL code:

```text
Follow strict-coding-standards__java_mysql.md.
Do not generate unsafe raw SQL concatenation.
Use bind parameters for values and allow-list dynamic identifiers.
Use DataSource/pool-managed connections.
Make transaction boundary explicit.
Do not assume ORM auto-DDL is allowed.
Do not expose entities as API DTOs.
Make timezone, charset, collation, timeout, and retry/idempotency behavior explicit.
For schema/query changes, explain indexes and migration impact.
For critical queries, provide EXPLAIN plan expectation and required tests.
If target MySQL version or access stack is unknown, choose conservative MySQL 8.0+/8.4-compatible syntax and state assumptions.
```

---

## 18. Minimal safe examples

### 18.1 Spring JDBC repository method

```java
@Repository
public class UserAccountJdbcRepository {
    private final JdbcTemplate jdbcTemplate;

    public UserAccountJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<UserAccountRow> findById(long id) {
        String sql = """
            select id, email, status, created_at
            from user_account
            where id = ?
            """;

        List<UserAccountRow> rows = jdbcTemplate.query(sql, (rs, rowNum) -> new UserAccountRow(
                rs.getLong("id"),
                rs.getString("email"),
                rs.getString("status"),
                rs.getTimestamp("created_at").toInstant()
        ), id);

        return rows.stream().findFirst();
    }
}
```

### 18.2 Atomic status transition

```sql
update case_record
set status = ?, updated_at = current_timestamp(6), version = version + 1
where id = ?
  and status = ?
  and version = ?;
```

Rules:

- Check affected row count.
- If zero, return conflict/not-found according to business semantics.
- Do not read state, decide, then update without lock/version/condition.

### 18.3 Keyset pagination

```sql
select id, created_at, title
from case_record
where tenant_id = ?
  and (created_at < ? or (created_at = ? and id < ?))
order by created_at desc, id desc
limit ?;
```

Required index:

```sql
create index idx_case_record_tenant_created_id
on case_record (tenant_id, created_at desc, id desc);
```

---

## 19. Final rule

Java + MySQL code is acceptable only if it makes the following explicit:

```text
schema contract
query contract
transaction contract
connection/pool contract
timezone/charset contract
retry/idempotency contract
migration contract
test evidence
```

If the code hides any of these behind defaults, framework magic, or vague assumptions, reject it.

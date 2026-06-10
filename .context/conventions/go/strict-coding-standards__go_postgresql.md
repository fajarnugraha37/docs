# Strict Coding Standards — Go PostgreSQL

Status: Mandatory  
Scope: Go services that access PostgreSQL using `pgx`, `pgxpool`, `database/sql`, migration tools, repository/store packages, transactional workflows, read models, event outbox, notification consumers, and bulk import/export code.  
Audience: LLM code agents, developers, reviewers, maintainers, and platform engineers.  
Baseline: Go 1.24+; compatible with Go 1.25/1.26 standards in this repository.

---

## 1. Purpose

PostgreSQL code is not just persistence glue. It is usually where correctness, data integrity, consistency, auditability, performance, and operational safety meet.

An LLM MUST NOT generate PostgreSQL code that only passes happy-path local tests. PostgreSQL implementation must preserve transaction boundaries, avoid SQL injection, respect context cancellation, handle driver-specific error codes, protect tenant boundaries, avoid connection leaks, and keep query behavior observable.

This standard governs:

- PostgreSQL driver selection.
- DSN/configuration and connection pooling.
- Transaction boundaries and isolation.
- SQL parameterization and dynamic SQL rules.
- `pgx` and `database/sql` usage.
- Row scanning, null handling, arrays, JSONB, and custom types.
- Locking, concurrency, idempotency, and optimistic versioning.
- Pagination and query shape.
- COPY, LISTEN/NOTIFY, advisory locks, and outbox patterns.
- Error taxonomy and retryability.
- Testing, benchmarking, telemetry, and security gates.

---

## 2. Source authority

When this document conflicts with project-specific architecture docs, the stricter rule wins.

Primary references:

- Go package `database/sql`.
- Go database tutorials for prepared statements, transactions, cancellation, and connection management.
- `github.com/jackc/pgx/v5` and `pgxpool` documentation.
- PostgreSQL official documentation for transactions, isolation, constraints, locks, indexes, JSON/JSONB, arrays, COPY, LISTEN/NOTIFY, advisory locks, and `EXPLAIN`.
- Project standards for Go context, error handling, data mapper, security, telemetry, validation, JSON, time/date, migration, and database SQL.

---

## 3. Non-negotiable rules

The agent MUST:

1. Use `pgx/v5` or `database/sql` with an approved PostgreSQL driver only.
2. Use context-aware calls for every operation: `Query`, `QueryRow`, `Exec`, `Begin`, `CopyFrom`, `Acquire`, and health checks.
3. Use parameterized SQL for all values.
4. Use PostgreSQL placeholder syntax `$1`, `$2`, ... when using native PostgreSQL SQL.
5. Never concatenate user-controlled values into SQL.
6. Never build dynamic identifiers without allowlisting table, schema, column, direction, and operator names.
7. Close every row/result resource owned by the function.
8. Check row iteration errors.
9. Treat `pgx.ErrNoRows` / `sql.ErrNoRows` as domain absence, not infrastructure failure.
10. Map PostgreSQL SQLSTATE codes to domain/infrastructure error categories explicitly.
11. Keep transactions short, explicit, and owned by the use-case/application layer.
12. Never mix non-transactional DB calls inside a transaction workflow unless explicitly documented as intentionally outside the transaction.
13. Never run unbounded `SELECT *`, unbounded export, unbounded `COPY`, or unbounded `jsonb` scan in request path.
14. Never log DSNs, passwords, tokens, row payloads with PII, or query arguments that contain secrets/regulatory data.
15. Never disable TLS verification for production PostgreSQL connections.
16. Never assume PostgreSQL row order without `ORDER BY`.
17. Never assume `now()`/database timezone semantics without an explicit project time policy.
18. Never hide `Commit` errors.
19. Never ignore rollback errors when they affect diagnostics.
20. Never introduce schema-dependent code without migration/version compatibility analysis.

---

## 4. Driver and interface selection

### 4.1 Preferred default

For PostgreSQL-only services, prefer native `pgx/v5` with `pgxpool`.

Required reasons:

- PostgreSQL-specific type handling.
- Better access to PostgreSQL features such as `COPY`, `LISTEN/NOTIFY`, batch queries, arrays, JSONB, and notices.
- Explicit connection pool configuration through `pgxpool.Config`.
- Easier mapping of PostgreSQL error codes through `pgconn.PgError`.

Allowed:

```go
import (
    "context"

    "github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
    pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
    if pool == nil {
        panic("nil pgx pool")
    }
    return &Store{pool: pool}
}

func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
    cfg, err := pgxpool.ParseConfig(dsn)
    if err != nil {
        return nil, fmt.Errorf("parse postgres config: %w", err)
    }

    cfg.MinConns = 1
    cfg.MaxConns = 16
    cfg.HealthCheckPeriod = 30 * time.Second

    pool, err := pgxpool.NewWithConfig(ctx, cfg)
    if err != nil {
        return nil, fmt.Errorf("create postgres pool: %w", err)
    }
    return pool, nil
}
```

### 4.2 When `database/sql` is allowed

`database/sql` is allowed when:

- The project uses libraries that require `*sql.DB`.
- Multiple database engines must be supported by the same abstraction.
- The code intentionally avoids PostgreSQL-specific behavior.

The agent MUST NOT pretend `database/sql` is database portable when SQL syntax, placeholder format, isolation, upsert syntax, JSON operators, locking, or error codes are PostgreSQL-specific.

### 4.3 Forbidden driver behavior

Forbidden:

```go
// FORBIDDEN: using background context in repository code.
row := pool.QueryRow(context.Background(), "select id from users where id=$1", id)
```

Preferred:

```go
func (s *Store) FindUser(ctx context.Context, id UserID) (User, error) {
    row := s.pool.QueryRow(ctx, `
        select id, email, status, version, created_at
        from users
        where id = $1
    `, id)
    // scan...
}
```

---

## 5. Connection configuration

### 5.1 DSN and credential rules

The agent MUST:

- Load DSN from secret/config provider, not hardcoded source.
- Redact DSN in logs.
- Use TLS mode according to environment policy.
- Explicitly define application name when supported.
- Prefer structured config over opaque string mutation.
- Avoid logging full connection strings.

Forbidden:

```go
const dsn = "postgres://app:password@db:5432/prod?sslmode=disable"
```

Preferred:

```go
type PostgresConfig struct {
    URL             string
    MaxConns        int32
    MinConns        int32
    HealthCheck     time.Duration
    StatementTimeout time.Duration
}
```

### 5.2 Pool sizing

The agent MUST NOT set arbitrary pool sizes.

Pool sizing must consider:

- PostgreSQL `max_connections`.
- Number of application replicas.
- PgBouncer or RDS Proxy presence.
- Expected request concurrency.
- Slow query behavior.
- Background workers.
- Migration/backfill jobs.

Required:

```go
if cfg.MaxConns <= 0 {
    return nil, errors.New("postgres max conns must be configured")
}
```

Forbidden:

```go
cfg.MaxConns = 1000 // FORBIDDEN: arbitrary, likely dangerous.
```

### 5.3 Startup and shutdown

Required:

- Validate with `Ping` or equivalent startup check.
- Close pool during graceful shutdown.
- Do not create pools per request/job.
- Treat failed startup connectivity as explicit startup failure unless service supports degraded mode.

---

## 6. SQL construction

### 6.1 Parameterized values

Required:

```go
const q = `
    select id, email
    from users
    where tenant_id = $1 and email = $2
`
row := s.pool.QueryRow(ctx, q, tenantID, email)
```

Forbidden:

```go
// FORBIDDEN: injection-prone.
q := "select id from users where email = '" + email + "'"
```

### 6.2 Dynamic identifiers

PostgreSQL parameters cannot bind identifiers such as table names, column names, or sort directions. Any dynamic identifier MUST use allowlists.

Preferred:

```go
func orderByClause(sort string) (string, error) {
    switch sort {
    case "created_at_desc":
        return "created_at desc, id desc", nil
    case "created_at_asc":
        return "created_at asc, id asc", nil
    default:
        return "", ErrInvalidSort
    }
}
```

Forbidden:

```go
// FORBIDDEN: user-controlled SQL identifier/direction.
q := "select * from cases order by " + r.URL.Query().Get("sort")
```

### 6.3 SQL readability

Required:

- Use multiline raw string constants for non-trivial SQL.
- Name selected columns explicitly.
- Keep repository query close to scan order.
- Document unusual locks, hints, CTE materialization behavior, or isolation assumptions.

Forbidden:

```go
select * from users
```

Preferred:

```sql
select
    id,
    tenant_id,
    email,
    status,
    version,
    created_at,
    updated_at
from users
where tenant_id = $1 and id = $2
```

---

## 7. Row scanning and type mapping

### 7.1 Explicit scan order

The agent MUST keep selected column order and scan order synchronized.

Preferred:

```go
var u UserRow
err := row.Scan(
    &u.ID,
    &u.TenantID,
    &u.Email,
    &u.Status,
    &u.Version,
    &u.CreatedAt,
    &u.UpdatedAt,
)
```

Forbidden:

```go
// FORBIDDEN: fragile when SELECT * changes.
row.Scan(&u.ID, &u.Email)
```

### 7.2 Nullability

Required:

- Represent nullable DB fields explicitly.
- Convert DB nullability at mapper boundary.
- Never overload Go zero values as database NULL unless the domain explicitly defines that equivalence.

Allowed representations:

- `pgtype.*` types for pgx-specific mapping.
- `sql.Null*` when using `database/sql`.
- Pointers in persistence rows only when the null semantics are clear.
- Domain-specific optional types when the project defines them.

Forbidden:

```go
// FORBIDDEN: cannot distinguish empty string from NULL.
var middleName string
```

### 7.3 Time mapping

Required:

- Prefer `timestamptz` for instants.
- Normalize instants to UTC in domain and APIs unless project explicitly requires location-aware rendering.
- Use `date` for date-only values; do not model date-only values as midnight instant without explicit boundary contract.
- Avoid `timestamp without time zone` unless the domain intentionally stores local civil time.

### 7.4 Numeric and money mapping

Required:

- Never map monetary `numeric` to `float64`.
- Use integer minor units, decimal library, `pgtype.Numeric`, or string-preserving mapper based on project policy.
- Explicitly validate precision and scale.

Forbidden:

```go
var amount float64 // FORBIDDEN for money/decimal financial amount.
```

### 7.5 JSONB mapping

Required:

- Decode JSONB into versioned DTOs or `json.RawMessage` at boundary.
- Validate schema/version before using JSONB payload.
- Avoid querying arbitrary unindexed JSONB paths in high-volume request paths.
- Add GIN/expression indexes only with evidence and migration plan.

Forbidden:

```go
var payload map[string]any // FORBIDDEN for domain-critical payload without schema validation.
```

### 7.6 Arrays

Required:

- Prefer normalized relation tables when array elements are queryable, permission-relevant, or updated independently.
- Use PostgreSQL arrays only when they are bounded, semantically atomic, and indexing/query patterns are known.
- Define empty vs null array semantics explicitly.

---

## 8. Query execution lifecycle

### 8.1 Query rows

Required:

```go
rows, err := s.pool.Query(ctx, q, tenantID)
if err != nil {
    return nil, mapPgError(err)
}
defer rows.Close()

items := make([]Item, 0)
for rows.Next() {
    var item ItemRow
    if err := rows.Scan(&item.ID, &item.Name); err != nil {
        return nil, fmt.Errorf("scan items: %w", err)
    }
    items = append(items, mapItem(item))
}
if err := rows.Err(); err != nil {
    return nil, fmt.Errorf("iterate items: %w", err)
}
return items, nil
```

### 8.2 Query one

Required:

```go
err := s.pool.QueryRow(ctx, q, id).Scan(&row.ID, &row.Email)
if err != nil {
    if errors.Is(err, pgx.ErrNoRows) {
        return User{}, ErrUserNotFound
    }
    return User{}, fmt.Errorf("select user: %w", mapPgError(err))
}
```

### 8.3 Command execution

Required:

- Check affected row count for update/delete commands where existence or optimistic locking matters.
- Treat zero rows as domain conflict/not-found when applicable.

Preferred:

```go
tag, err := exec.Exec(ctx, `
    update cases
    set status = $1, version = version + 1, updated_at = now()
    where tenant_id = $2 and id = $3 and version = $4
`, nextStatus, tenantID, caseID, expectedVersion)
if err != nil {
    return fmt.Errorf("update case status: %w", mapPgError(err))
}
if tag.RowsAffected() != 1 {
    return ErrConcurrentModification
}
```

---

## 9. Transactions

### 9.1 Transaction ownership

The application use case owns the transaction if multiple repository operations must be atomic.

Required:

```go
tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
if err != nil {
    return fmt.Errorf("begin transaction: %w", err)
}
defer func() {
    if err != nil {
        _ = tx.Rollback(ctx)
    }
}()

if err = repo.InsertCase(ctx, tx, c); err != nil {
    return err
}
if err = repo.InsertOutbox(ctx, tx, event); err != nil {
    return err
}

if err = tx.Commit(ctx); err != nil {
    return fmt.Errorf("commit transaction: %w", err)
}
return nil
```

### 9.2 Executor interface

Preferred:

```go
type PgExecutor interface {
    Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
    Query(context.Context, string, ...any) (pgx.Rows, error)
    QueryRow(context.Context, string, ...any) pgx.Row
}
```

Repositories that can operate inside or outside a transaction MAY accept this interface. They MUST NOT start hidden transactions unless their operation is entirely self-contained.

### 9.3 Isolation level

The agent MUST document non-default isolation decisions.

Required decision points:

- `Read Committed` is not enough for some read-modify-write invariants.
- `Repeatable Read` and `Serializable` can require retry handling.
- Locking reads such as `FOR UPDATE` can block and must respect context/deadline.
- `SKIP LOCKED` is allowed for worker queues only with duplicate/lost-work semantics defined.

### 9.4 Savepoints

Savepoints MAY be used for partial failure handling inside a transaction, but MUST NOT hide inconsistent domain state.

---

## 10. PostgreSQL error handling

### 10.1 SQLSTATE mapping

The agent MUST map known SQLSTATE codes to typed project errors.

Common categories:

| SQLSTATE | Meaning               | Required mapping                                                  |
| -------- | --------------------- | ----------------------------------------------------------------- |
| `23505`  | unique violation      | conflict / duplicate                                              |
| `23503`  | foreign key violation | invalid reference / conflict                                      |
| `23502`  | not-null violation    | invariant/persistence bug unless input boundary missed validation |
| `23514`  | check violation       | domain invariant violation or persistence bug                     |
| `40001`  | serialization failure | retryable transaction conflict                                    |
| `40P01`  | deadlock detected     | retryable if operation is idempotent                              |
| `55P03`  | lock not available    | retryable/temporary conflict                                      |
| `57014`  | query canceled        | cancellation/timeout                                              |
| `08006`  | connection failure    | infrastructure failure                                            |
| `53300`  | too many connections  | infrastructure capacity failure                                   |

Preferred:

```go
func mapPgError(err error) error {
    var pgErr *pgconn.PgError
    if !errors.As(err, &pgErr) {
        return err
    }

    switch pgErr.Code {
    case "23505":
        return fmt.Errorf("postgres unique violation: %w", ErrConflict)
    case "40001", "40P01":
        return fmt.Errorf("postgres retryable transaction error: %w", ErrRetryable)
    default:
        return err
    }
}
```

### 10.2 External API mapping

Forbidden:

```go
http.Error(w, err.Error(), http.StatusInternalServerError) // FORBIDDEN.
```

Required:

- Map database errors to domain/application errors.
- Preserve machine-checkable cause internally.
- Return sanitized user-facing messages externally.
- Log only safe metadata: operation, SQLSTATE, table/constraint name if safe, trace ID.

---

## 11. Concurrency and consistency

### 11.1 Optimistic locking

Stateful domain entities MUST use a concurrency control strategy.

Preferred:

```sql
update enforcement_case
set status = $1,
    version = version + 1,
    updated_at = now()
where tenant_id = $2
  and id = $3
  and version = $4
```

The agent MUST check affected rows.

### 11.2 Pessimistic locking

Allowed only with explicit purpose:

- Prevent concurrent transition.
- Claim jobs.
- Coordinate scarce resource allocation.
- Protect invariant that cannot be enforced by a unique/constraint/index alone.

Required:

- Context timeout.
- Lock order documented.
- Deadlock retry decision.
- Telemetry for lock wait duration.

### 11.3 Advisory locks

Advisory locks are allowed only when:

- Lock key is deterministic and documented.
- Transaction/session scope is explicit.
- Failure-to-release behavior is understood.
- They do not replace proper constraints.

Forbidden:

```go
// FORBIDDEN: magic advisory lock without key semantics.
select pg_advisory_lock(123)
```

---

## 12. Pagination and query shape

### 12.1 Offset pagination

Offset pagination is allowed only for small/admin/reporting views where performance and consistency risks are accepted.

Forbidden for high-volume feeds:

```sql
select id from events order by created_at desc limit 100 offset 100000
```

### 12.2 Keyset pagination

Preferred:

```sql
select id, created_at, subject
from cases
where tenant_id = $1
  and (created_at, id) < ($2, $3)
order by created_at desc, id desc
limit $4
```

Required:

- Stable deterministic ordering.
- Cursor fields included in index.
- Cursor encoded/signed if exposed externally.
- Tenant filters included before pagination.

### 12.3 Query plan gate

For non-trivial query changes, the agent MUST request or include:

- Expected cardinality.
- Index usage assumption.
- `EXPLAIN`/`EXPLAIN ANALYZE` evidence for performance-sensitive paths.
- Before/after plan for production-impacting changes.

---

## 13. Bulk operations

### 13.1 COPY

`COPY` is allowed for bulk insert/export only with bounded inputs and transactional behavior.

Required:

- Use context.
- Validate row count and byte limits before/while streaming.
- Run inside explicit transaction when bulk load must be atomic.
- Map row-level validation errors before loading when possible.
- Do not use `COPY` to bypass domain invariants.

### 13.2 Batch queries

Batch queries are allowed for round-trip reduction, but MUST NOT hide partial failure semantics.

Required:

- Define ordering of batch results.
- Close batch results.
- Preserve per-command error context.

---

## 14. LISTEN / NOTIFY

Allowed only for lightweight invalidation or wake-up signals.

The agent MUST NOT use PostgreSQL notifications as a durable event bus.

Required:

- Reconnect loop with context cancellation.
- Bounded handler work.
- Backfill/reconciliation path for missed notifications.
- No business-critical message delivery guarantee assumption.

Preferred use:

- Cache invalidation.
- Worker wake-up to poll durable outbox/job table.

Forbidden:

- Delivering regulatory audit events only via `NOTIFY`.
- Sending large payloads.
- Assuming exactly-once delivery.

---

## 15. Outbox and event publishing

For durable event publishing from PostgreSQL-backed workflows, the agent MUST prefer transactional outbox.

Required outbox fields:

- Stable event ID.
- Aggregate type and ID.
- Event type/version.
- Payload JSONB or structured columns.
- Occurred time.
- Publish status/attempt metadata.
- Idempotency key if externally relevant.

Required:

- Insert domain state and outbox record in the same transaction.
- Publisher must be idempotent.
- Use `FOR UPDATE SKIP LOCKED` only with duplicate-safe publishing and retry/DLQ policy.
- Maintain audit trail for publish failures.

---

## 16. Tenant and security boundaries

The agent MUST:

- Include tenant/account/organization filter in every tenant-scoped query.
- Never rely on client-provided ID alone.
- Prefer composite unique constraints that include tenant scope.
- Avoid leaking row existence across tenants.
- Redact query parameters in logs.
- Use least-privilege database user.
- Avoid superuser-required features in application code.

Forbidden:

```sql
select id, tenant_id, subject from cases where id = $1
```

Preferred:

```sql
select id, tenant_id, subject
from cases
where tenant_id = $1 and id = $2
```

---

## 17. Schema and migration compatibility

The agent MUST coordinate PostgreSQL code changes with migrations.

Required:

- Expand/contract approach for rolling deploys.
- New nullable column before required write path, unless downtime is approved.
- Backfill plan for existing rows.
- Constraint validation strategy for large tables.
- Index creation strategy appropriate to production size.
- Version-compatible read/write code during deployment window.

Forbidden:

- Removing a column used by current binary.
- Changing enum/check semantics without mapping old values.
- Adding blocking index/constraint on large production table without operation plan.

---

## 18. Testing standards

The agent MUST include tests for:

- Not found.
- Duplicate key.
- Foreign key violation.
- Transaction rollback.
- Commit failure path where testable.
- Context cancellation/timeout.
- Tenant isolation.
- Optimistic locking conflict.
- Null and zero-value mapping.
- Timezone/date behavior.
- JSONB payload validation.
- Pagination cursor correctness.
- SQLSTATE mapping.

Preferred:

- Integration tests with real PostgreSQL container for SQL behavior.
- Unit tests only for mapper/error logic.
- No mock-only confidence for SQL syntax or PostgreSQL features.

---

## 19. Benchmarking and performance

The agent MUST NOT claim query performance without evidence.

Required evidence for performance-sensitive query:

- Dataset shape and cardinality.
- Indexes present.
- Query plan.
- Latency distribution.
- Pool settings.
- Contention/lock behavior where relevant.

Forbidden:

- Microbenchmarking repository code while using an in-memory fake and claiming PostgreSQL performance.
- Adding indexes without measuring write overhead or migration cost.

---

## 20. Observability

Required telemetry:

- Query operation name, not raw SQL.
- Duration histogram.
- Rows affected or rows returned when safe.
- SQLSTATE for errors.
- Pool stats.
- Transaction duration.
- Lock wait/retry count where implemented.
- Outbox lag and retry count.

Forbidden:

- High-cardinality labels such as raw SQL text, IDs, emails, tokens, tenant-specific secrets.
- Logging full payloads from JSONB events without redaction.

---

## 21. LLM implementation checklist

Before emitting PostgreSQL code, the agent MUST verify:

- [ ] Driver/interface choice is justified: `pgx`/`pgxpool` or `database/sql`.
- [ ] Context is passed from caller; no hidden background context.
- [ ] SQL values are parameterized.
- [ ] Dynamic identifiers are allowlisted.
- [ ] Columns are explicit; scan order matches select order.
- [ ] Rows are closed and iteration errors checked.
- [ ] No-row behavior maps to domain absence.
- [ ] SQLSTATE errors are mapped where relevant.
- [ ] Transaction ownership is explicit.
- [ ] Commit and rollback paths are handled.
- [ ] Tenant boundary is enforced.
- [ ] Time, decimal, JSONB, nullable, and array semantics are explicit.
- [ ] Query has deterministic ordering where order matters.
- [ ] Pagination is keyset for high-volume paths.
- [ ] Locking/isolation behavior is documented.
- [ ] Migration compatibility is considered.
- [ ] Tests cover negative, conflict, cancellation, and isolation paths.
- [ ] Telemetry is present without sensitive labels.

---

## 22. Hard rejection examples

The reviewer MUST reject code that:

- Opens a new PostgreSQL pool per request.
- Uses `context.Background()` inside repository methods.
- Concatenates user input into SQL.
- Uses `SELECT *` in application persistence code.
- Assumes row order without `ORDER BY`.
- Ignores `rows.Err()`.
- Ignores affected row count for concurrency-sensitive updates.
- Treats `pgx.ErrNoRows` as internal server error.
- Logs DSN or SQL parameters with secrets/PII.
- Uses `LISTEN/NOTIFY` as durable event delivery.
- Uses `float64` for financial `numeric` values.
- Adds long-running locks/migrations without operational plan.

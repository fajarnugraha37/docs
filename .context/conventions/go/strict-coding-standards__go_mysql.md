# Strict Coding Standards — Go MySQL

Status: Mandatory  
Scope: Go services using MySQL or MySQL-compatible engines through `database/sql`, `github.com/go-sql-driver/mysql`, repository/store packages, transactional workflows, read models, migration runners, queue/outbox tables, and reporting queries.  
Audience: LLM code agents, developers, reviewers, maintainers, and platform engineers.  
Baseline: Go 1.24+; compatible with Go 1.25/1.26 standards in this repository.

---

## 1. Purpose

MySQL code must be treated as a correctness and operations boundary, not a convenient persistence detail. MySQL has engine-specific behavior around time values, transaction isolation, affected rows, connection state, character sets, collations, auto-increment, locking, deadlocks, and replication/failover.

An LLM MUST NOT generate MySQL code that only works on a local empty database. It must preserve transactional invariants, avoid SQL injection, respect context cancellation, configure driver timeouts, map MySQL error numbers, protect tenant boundaries, and make query behavior observable.

This standard governs:

- `database/sql` usage with MySQL.
- `go-sql-driver/mysql` configuration.
- DSN construction and security.
- Transactions, isolation, locking, and deadlocks.
- Query construction and dynamic SQL.
- Row scanning and null/time/decimal mapping.
- Affected rows and optimistic locking.
- Pagination, indexing, and query shape.
- Bulk operations and `LOAD DATA` restrictions.
- Error mapping, retryability, testing, and telemetry.

---

## 2. Source authority

When this document conflicts with project-specific architecture docs, the stricter rule wins.

Primary references:

- Go package `database/sql`.
- Go database tutorials for querying, prepared statements, transactions, cancellation, and connection management.
- `github.com/go-sql-driver/mysql` documentation.
- MySQL official documentation for transactions, isolation, InnoDB locking, replication/failover, SQL modes, character sets/collations, time zone handling, and error codes.
- Project standards for Go context, error handling, data mapper, security, telemetry, validation, JSON, time/date, migration, and database SQL.

---

## 3. Non-negotiable rules

The agent MUST:

1. Use `database/sql` with an approved MySQL driver, normally `github.com/go-sql-driver/mysql`.
2. Use context-aware methods: `QueryContext`, `QueryRowContext`, `ExecContext`, `BeginTx`, `PrepareContext`, `PingContext`.
3. Use parameterized SQL for all untrusted values.
4. Use `?` placeholders for MySQL driver queries unless a project-approved query builder rewrites placeholders safely.
5. Never concatenate user-controlled values into SQL.
6. Never build dynamic identifiers without allowlisting table, column, sort direction, index hint, and operator names.
7. Close every `*sql.Rows` and `*sql.Stmt` it owns.
8. Check `rows.Err()` after iteration.
9. Treat `sql.ErrNoRows` as domain absence, not generic internal failure.
10. Map MySQL driver errors by error number and SQLSTATE where relevant.
11. Configure dial/read/write timeouts in DSN or connector config.
12. Set explicit pool limits; do not rely on accidental defaults.
13. Use `parseTime=true` only with an explicit time/location policy.
14. Never enable `multiStatements=true` by default.
15. Never enable `allowAllFiles`, `allowCleartextPasswords`, `allowOldPasswords`, or fallback-to-plaintext behavior in production.
16. Never disable TLS for production over untrusted networks.
17. Never assume row order without `ORDER BY`.
18. Never assume affected rows semantics without checking `clientFoundRows` policy.
19. Never hide `Commit` errors.
20. Never expose raw MySQL errors directly to external API clients.

---

## 4. Driver and connection model

### 4.1 Approved driver

Preferred import:

```go
import (
    "database/sql"

    _ "github.com/go-sql-driver/mysql"
)
```

The agent MUST use `database/sql` as the primary abstraction unless the project has explicitly approved direct driver-level usage.

### 4.2 `*sql.DB` lifecycle

`*sql.DB` is a connection pool handle. It must be long-lived and shared.

Forbidden:

```go
// FORBIDDEN: opening a database per request.
func handler(w http.ResponseWriter, r *http.Request) {
    db, _ := sql.Open("mysql", dsn)
    defer db.Close()
}
```

Preferred:

```go
type Store struct {
    db *sql.DB
}

func NewStore(db *sql.DB) *Store {
    if db == nil {
        panic("nil *sql.DB")
    }
    return &Store{db: db}
}
```

### 4.3 Connector-based configuration

Prefer typed config over hand-concatenated DSNs when possible.

```go
func OpenMySQL(ctx context.Context, cfg MySQLConfig) (*sql.DB, error) {
    mc := mysql.NewConfig()
    mc.User = cfg.User
    mc.Passwd = cfg.Password
    mc.Net = "tcp"
    mc.Addr = cfg.Address
    mc.DBName = cfg.Database
    mc.ParseTime = true
    mc.Loc = time.UTC
    mc.Timeout = cfg.DialTimeout
    mc.ReadTimeout = cfg.ReadTimeout
    mc.WriteTimeout = cfg.WriteTimeout
    mc.MultiStatements = false
    mc.AllowCleartextPasswords = false
    mc.AllowOldPasswords = false
    mc.AllowFallbackToPlaintext = false

    connector, err := mysql.NewConnector(mc)
    if err != nil {
        return nil, fmt.Errorf("create mysql connector: %w", err)
    }

    db := sql.OpenDB(connector)
    db.SetMaxOpenConns(cfg.MaxOpenConns)
    db.SetMaxIdleConns(cfg.MaxIdleConns)
    db.SetConnMaxLifetime(cfg.ConnMaxLifetime)
    db.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)

    if err := db.PingContext(ctx); err != nil {
        _ = db.Close()
        return nil, fmt.Errorf("ping mysql: %w", err)
    }
    return db, nil
}
```

---

## 5. DSN and security configuration

### 5.1 Required DSN policy

The agent MUST configure or verify:

- `timeout` for dial/connect timeout.
- `readTimeout` for socket read operations.
- `writeTimeout` for socket write operations.
- `parseTime=true` when scanning temporal types into `time.Time`.
- `loc=UTC` or explicit project-approved location.
- `multiStatements=false` unless migration/admin code has explicit approval.
- `allowCleartextPasswords=false` unless explicitly required and protected by TLS/private network with security approval.
- `allowOldPasswords=false`.
- `allowAllFiles=false`.
- TLS policy appropriate to environment.

Forbidden:

```go
// FORBIDDEN: no timeout, no TLS policy, opaque hardcoded secret.
db, err := sql.Open("mysql", "root:password@tcp(localhost:3306)/app")
```

Preferred DSN style if typed connector is not used:

```text
user:REDACTED@tcp(db.example.internal:3306)/app?parseTime=true&loc=UTC&timeout=5s&readTimeout=10s&writeTimeout=10s&multiStatements=false
```

### 5.2 DSN logging

Forbidden:

```go
logger.Info("mysql connect", "dsn", dsn)
```

Required:

```go
logger.Info("mysql connect", "addr", cfg.Address, "database", cfg.Database, "user", cfg.User)
```

Never log password, TLS material, token, DSN query string containing secrets, or full endpoint if the endpoint itself is sensitive.

---

## 6. SQL construction

### 6.1 Parameterized values

Required:

```go
const q = `
    select id, email, status, version
    from users
    where tenant_id = ? and email = ?
`
row := s.db.QueryRowContext(ctx, q, tenantID, email)
```

Forbidden:

```go
// FORBIDDEN: injection-prone.
q := "select id from users where email = '" + email + "'"
```

### 6.2 Dynamic identifiers

MySQL placeholders do not bind identifiers. Any dynamic identifier MUST be allowlisted.

Preferred:

```go
func userOrderClause(sort string) (string, error) {
    switch sort {
    case "created_desc":
        return "created_at desc, id desc", nil
    case "created_asc":
        return "created_at asc, id asc", nil
    default:
        return "", ErrInvalidSort
    }
}
```

Forbidden:

```go
q := "select id from users order by " + r.URL.Query().Get("sort") // FORBIDDEN.
```

### 6.3 `multiStatements`

`multiStatements=true` is forbidden in application runtime by default.

Allowed only for:

- Controlled migration runner code.
- Internal admin script with no user-controlled SQL.
- Explicit review documenting parameter limitations and failure semantics.

The agent MUST NOT use `multiStatements` to reduce round trips in normal request code.

### 6.4 `interpolateParams`

`interpolateParams=true` is allowed only with explicit security review and charset compatibility. It is forbidden as an LLM default.

Required when considered:

- Document why server-side prepared statements are not used.
- Confirm rejected unsafe multibyte encodings are not used.
- Add integration tests for special characters and injection payloads.

---

## 7. Query lifecycle

### 7.1 Query rows

Required:

```go
rows, err := s.db.QueryContext(ctx, q, tenantID)
if err != nil {
    return nil, mapMySQLError(err)
}
defer rows.Close()

items := make([]Item, 0)
for rows.Next() {
    var row ItemRow
    if err := rows.Scan(&row.ID, &row.Name); err != nil {
        return nil, fmt.Errorf("scan items: %w", err)
    }
    items = append(items, mapItem(row))
}
if err := rows.Err(); err != nil {
    return nil, fmt.Errorf("iterate items: %w", err)
}
return items, nil
```

### 7.2 Query one

Required:

```go
err := s.db.QueryRowContext(ctx, q, tenantID, id).Scan(&row.ID, &row.Email)
if err != nil {
    if errors.Is(err, sql.ErrNoRows) {
        return User{}, ErrUserNotFound
    }
    return User{}, fmt.Errorf("select user: %w", mapMySQLError(err))
}
```

### 7.3 Command execution and affected rows

The agent MUST check affected rows for:

- Optimistic locking.
- Idempotency updates.
- State transitions.
- Delete/update by ID.
- Compare-and-set style operations.

Preferred:

```go
res, err := exec.ExecContext(ctx, `
    update cases
    set status = ?, version = version + 1, updated_at = utc_timestamp(6)
    where tenant_id = ? and id = ? and version = ?
`, nextStatus, tenantID, caseID, expectedVersion)
if err != nil {
    return fmt.Errorf("update case status: %w", mapMySQLError(err))
}

n, err := res.RowsAffected()
if err != nil {
    return fmt.Errorf("read affected rows: %w", err)
}
if n != 1 {
    return ErrConcurrentModification
}
```

The project MUST define whether `clientFoundRows=true` is used. This changes affected-row semantics for updates.

---

## 8. Row scanning and data mapping

### 8.1 Explicit column order

Required:

- Explicit column lists.
- Scan order exactly matches selected columns.
- Mapper separates persistence row from domain model.

Forbidden:

```go
select * from account
```

### 8.2 Nullability

The agent MUST represent nullable fields explicitly:

- `sql.NullString`, `sql.NullInt64`, `sql.NullTime`, etc.
- Pointers in persistence DTO only when clearly documented.
- Domain optional type if project defines one.

Forbidden:

```go
var deletedAt time.Time // FORBIDDEN if column is nullable.
```

### 8.3 Time and date

MySQL temporal behavior is a common production bug source.

Required:

- Use `parseTime=true` when scanning `DATE`, `DATETIME`, or `TIMESTAMP` into `time.Time`.
- Use explicit `loc=UTC` or project-approved location.
- Distinguish date-only values from instants.
- Document MySQL session `time_zone` policy.
- Avoid `0000-00-00` unless legacy compatibility requires explicit handling.
- Use microsecond precision policy consistently: `datetime(6)` / `timestamp(6)` when precision matters.

Forbidden:

```go
// FORBIDDEN: comparing local-time strings as instants without location policy.
where created_at > ? // arg built from local formatted string
```

### 8.4 Decimal and money

Required:

- Never scan monetary `DECIMAL` into `float64`.
- Use integer minor units, decimal library, string-preserving mapper, or project-approved numeric type.
- Validate scale/precision at boundary.

Forbidden:

```go
var price float64 // FORBIDDEN for DECIMAL money.
```

### 8.5 JSON columns

Required:

- Decode JSON into versioned DTOs or `json.RawMessage` at boundary.
- Validate payload schema/version before domain use.
- Avoid unindexed JSON path filtering in hot queries.
- Treat JSON columns as wire/document contracts, not untyped domain maps.

---

## 9. Transactions

### 9.1 Ownership

The use-case/application layer owns multi-step transaction boundaries.

Required:

```go
tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
if err != nil {
    return fmt.Errorf("begin transaction: %w", err)
}
committed := false
defer func() {
    if !committed {
        _ = tx.Rollback()
    }
}()

if err := repo.InsertCase(ctx, tx, c); err != nil {
    return err
}
if err := repo.InsertOutbox(ctx, tx, event); err != nil {
    return err
}
if err := tx.Commit(); err != nil {
    return fmt.Errorf("commit transaction: %w", err)
}
committed = true
return nil
```

### 9.2 Executor interface

Preferred:

```go
type SQLExecutor interface {
    ExecContext(context.Context, string, ...any) (sql.Result, error)
    QueryContext(context.Context, string, ...any) (*sql.Rows, error)
    QueryRowContext(context.Context, string, ...any) *sql.Row
}
```

Repositories MAY accept this interface so the same method works with `*sql.DB` or `*sql.Tx`.

### 9.3 Isolation and retry

The agent MUST document isolation choices.

Important MySQL/InnoDB realities:

- Default isolation is often `REPEATABLE READ`, depending on server configuration.
- Deadlocks can occur under normal concurrent workloads.
- Lock wait timeouts and deadlocks must be classified separately.
- Retrying is allowed only for idempotent operations or operations protected by idempotency keys.

### 9.4 Forbidden transaction behavior

Forbidden:

- Starting transactions deep inside helper functions without caller awareness.
- Mixing `db.ExecContext` and `tx.ExecContext` for the same atomic workflow.
- Holding transactions open across network calls, user think time, long file I/O, or message publish calls.
- Ignoring commit errors.

---

## 10. MySQL error handling

### 10.1 Error number mapping

The agent MUST map known `*mysql.MySQLError` numbers to project errors.

Common mappings:

| Number | Meaning                            | Required mapping                                    |
| -----: | ---------------------------------- | --------------------------------------------------- |
| `1062` | duplicate entry                    | conflict / duplicate                                |
| `1451` | cannot delete/update parent due FK | conflict / referenced resource                      |
| `1452` | cannot add/update child due FK     | invalid reference / conflict                        |
| `1048` | column cannot be null              | validation/invariant failure                        |
| `1264` | out of range                       | validation/numeric boundary failure                 |
| `1406` | data too long                      | validation/size boundary failure                    |
| `1213` | deadlock found                     | retryable if operation is idempotent                |
| `1205` | lock wait timeout                  | retryable/temporary conflict depending on operation |
| `1040` | too many connections               | infrastructure capacity failure                     |
| `2006` | server has gone away               | infrastructure/transient connection failure         |
| `2013` | lost connection during query       | infrastructure/transient connection failure         |

Preferred:

```go
func mapMySQLError(err error) error {
    var myErr *mysql.MySQLError
    if !errors.As(err, &myErr) {
        return err
    }

    switch myErr.Number {
    case 1062:
        return fmt.Errorf("mysql duplicate: %w", ErrConflict)
    case 1213, 1205:
        return fmt.Errorf("mysql retryable transaction error: %w", ErrRetryable)
    default:
        return err
    }
}
```

### 10.2 External error responses

Forbidden:

```go
http.Error(w, err.Error(), http.StatusInternalServerError)
```

Required:

- Convert database errors to domain/application errors.
- Preserve cause internally via wrapping.
- Return sanitized messages externally.
- Log safe metadata only: operation, MySQL error number, SQLSTATE, trace ID.

---

## 11. Locking and concurrency

### 11.1 Optimistic locking

Required for mutable stateful entities unless another concurrency control is documented.

Preferred:

```sql
update enforcement_case
set status = ?, version = version + 1, updated_at = utc_timestamp(6)
where tenant_id = ?
  and id = ?
  and version = ?
```

The agent MUST check `RowsAffected`.

### 11.2 Pessimistic locking

Allowed only with explicit invariant and bounded transaction.

Allowed examples:

```sql
select id, status, version
from enforcement_case
where tenant_id = ? and id = ?
for update
```

Required:

- Context timeout.
- Documented lock order.
- Deadlock/lock-timeout handling.
- No external calls while lock is held.
- Telemetry for transaction duration and retry count.

### 11.3 Queue claiming with `SKIP LOCKED`

Allowed only for worker queues/outbox publishers where duplicate processing is safe.

Required:

- Idempotency key.
- Attempt count.
- Visibility/lease timestamp.
- Dead-letter or parked state.
- Reaper for abandoned leases.

---

## 12. Pagination and query shape

### 12.1 Deterministic order

The agent MUST add `ORDER BY` when result order matters.

Forbidden:

```sql
select id from cases limit 100
```

Preferred:

```sql
select id, created_at
from cases
where tenant_id = ?
order by created_at desc, id desc
limit ?
```

### 12.2 Offset pagination

Offset pagination is allowed only for small/admin/reporting views with accepted cost.

High-volume paths MUST use keyset pagination.

Preferred:

```sql
select id, created_at, subject
from cases
where tenant_id = ?
  and (created_at < ? or (created_at = ? and id < ?))
order by created_at desc, id desc
limit ?
```

### 12.3 Query plan gate

For performance-sensitive query changes, the agent MUST include or request:

- Expected cardinality.
- Index definition.
- Query plan evidence.
- Read/write tradeoff.
- Production data-size assumption.

---

## 13. Index and schema assumptions

Application code must not silently depend on missing indexes.

Required:

- Every hot lookup must have a matching index.
- Composite indexes must align with tenant filter, equality predicates, range predicates, and order-by fields.
- Unique constraints must encode business uniqueness.
- Foreign keys must reflect consistency requirements unless deliberately omitted for operational reasons.
- Migration must be compatible with rolling deploys.

Example:

```sql
create unique index uq_user_tenant_email on users (tenant_id, email);
```

---

## 14. Character set and collation

The agent MUST treat charset/collation as data-contract decisions.

Required:

- Prefer `utf8mb4` for Unicode text.
- Define case-sensitivity/case-insensitivity explicitly.
- Avoid relying on default server collation.
- Validate length in characters vs bytes according to domain needs.
- Test sorting/equality behavior for user-visible names, identifiers, and email-like fields.

Forbidden:

- Assuming `varchar(255)` means 255 bytes in all contexts.
- Assuming case sensitivity without checking collation.
- Mixing collations accidentally across compared columns.

---

## 15. Auto-increment and identity

Allowed:

- Auto-increment primary keys for internal row identity.

Required:

- External IDs should be opaque and non-enumerable if exposed outside trust boundary.
- Do not infer creation order or business meaning from auto-increment values.
- Avoid using `LAST_INSERT_ID()` outside the connection/transaction context that performed insert.
- Prefer `sql.Result.LastInsertId()` only when driver/table semantics are clear.

---

## 16. Bulk operations

### 16.1 `LOAD DATA LOCAL INFILE`

Forbidden by default in application runtime.

Allowed only with explicit approval and controls:

- `allowAllFiles=false`.
- Registered local file/reader allowlist only.
- Size and row limits.
- Schema validation.
- Transaction strategy.
- Audit logging.
- No user-controlled local file path.

### 16.2 Batch insert

Allowed when:

- Maximum batch size is bounded.
- Packet size is considered.
- Error behavior is defined.
- Deadlock/retry policy is defined for concurrent writers.

Forbidden:

```go
// FORBIDDEN: unbounded VALUES string generated from arbitrary input size.
```

---

## 17. Outbox and message publication

For durable integration events from MySQL-backed workflows, use transactional outbox.

Required:

- Insert domain change and outbox record in same transaction.
- Publisher must be idempotent.
- Use claim/lease pattern for outbox processing.
- Handle deadlocks and duplicate publish attempts.
- Record attempts, last error, next retry time, and terminal failure state.

Forbidden:

- Publishing to external broker before transaction commit.
- Assuming external publish and DB commit are atomic without outbox or distributed transaction design.

---

## 18. Read replica and failover behavior

The agent MUST NOT route reads to replicas without consistency policy.

Required decisions:

- Which reads may be stale.
- Read-your-writes requirement.
- Lag measurement and fallback.
- Primary-only operations.
- Failover detection.
- `rejectReadOnly=true` consideration where automatic failover may connect to read-only replica.

Forbidden:

- Using a read replica for authorization-critical or just-written reads unless explicitly safe.

---

## 19. Testing standards

The agent MUST include tests for:

- Not found.
- Duplicate key.
- Foreign key violation.
- Transaction rollback.
- Context timeout/cancellation.
- Deadlock/retry classification where feasible.
- Lock wait timeout classification where feasible.
- Tenant isolation.
- Optimistic locking conflict.
- Null and zero-value mapping.
- `parseTime` behavior.
- Date-only vs instant mapping.
- Decimal precision.
- Pagination cursor correctness.
- Affected rows semantics.
- MySQL error mapping.

Preferred:

- Integration tests with real MySQL or approved MySQL-compatible engine container.
- Unit tests for mappers and error mapping.
- Avoid mock-only confidence for SQL syntax, lock behavior, or MySQL-specific semantics.

---

## 20. Observability

Required telemetry:

- Operation name, not raw SQL text.
- Query duration histogram.
- Rows affected/returned where safe.
- MySQL error number / SQLSTATE for errors.
- Pool stats.
- Transaction duration.
- Deadlock/retry counters.
- Outbox lag and attempts.

Forbidden:

- Raw SQL with PII/secrets.
- High-cardinality metrics labels: user ID, email, token, tenant ID unless explicitly approved as controlled cardinality.
- Logging full row payloads.

---

## 21. LLM implementation checklist

Before emitting MySQL code, the agent MUST verify:

- [ ] `database/sql` and approved MySQL driver are used.
- [ ] Context is propagated; no hidden background context.
- [ ] DSN/config includes timeout policy.
- [ ] Unsafe DSN options are disabled by default.
- [ ] TLS and credential handling are environment-appropriate.
- [ ] Values are parameterized with `?` placeholders.
- [ ] Dynamic identifiers are allowlisted.
- [ ] `multiStatements` is disabled unless approved.
- [ ] Explicit columns are selected.
- [ ] Rows are closed and `rows.Err()` is checked.
- [ ] `sql.ErrNoRows` maps to domain absence.
- [ ] MySQL error numbers are mapped for known cases.
- [ ] Transactions are short and explicit.
- [ ] Affected rows are checked for updates/deletes where required.
- [ ] Tenant boundary is enforced in SQL.
- [ ] Time, decimal, JSON, nullability, and collation semantics are explicit.
- [ ] Query ordering is deterministic where order matters.
- [ ] High-volume pagination uses keyset pagination.
- [ ] Migration/index compatibility is considered.
- [ ] Integration tests cover real MySQL behavior.
- [ ] Telemetry is present and safe.

---

## 22. Hard rejection examples

The reviewer MUST reject code that:

- Opens a MySQL connection per request.
- Uses `context.Background()` inside repository methods.
- Concatenates user input into SQL.
- Enables `multiStatements=true` without explicit approval.
- Enables insecure password or local file options without explicit security approval.
- Uses `SELECT *` in persistence code.
- Assumes row order without `ORDER BY`.
- Ignores `rows.Err()`.
- Ignores affected row count for state transitions.
- Treats `sql.ErrNoRows` as internal server error.
- Logs DSN or query parameters containing secrets/PII.
- Scans money/decimal into `float64`.
- Holds transactions across network calls.
- Routes authorization-critical reads to eventually consistent replicas without policy.

# Strict Coding Standards — Go Database SQL

Status: Mandatory  
Scope: Go services using SQL databases through `database/sql`, driver-specific SQL libraries, repository/store code, transactional workflows, read models, reporting queries, and persistence adapters.  
Audience: LLM code agents, developers, reviewers, and maintainers.  
Baseline: Go 1.24+; must remain compatible with Go 1.25/1.26 standards in this repository.

---

## 1. Purpose

Database code is one of the highest-risk parts of a Go service because it sits at the boundary of correctness, security, consistency, latency, and operational cost.

An LLM MUST NOT generate database code that merely “works locally”. It must preserve transactional invariants, avoid leaks, respect context cancellation, protect against injection, handle no-row/conflict/deadlock errors explicitly, and make query behavior observable.

This standard governs:

- `database/sql` usage.
- SQL repository/store patterns.
- Transaction boundaries.
- Query parameterization.
- Row scanning and null handling.
- Connection pooling and lifecycle.
- Context, timeout, and cancellation behavior.
- Error taxonomy and retryability.
- Data mapper boundaries.
- Observability and tests.

---

## 2. Source authority

When this document conflicts with project-specific architecture docs, the project-specific docs win only if they are stricter.

Primary references:

- Go package `database/sql`.
- Go database tutorials for querying, transactions, prepared statements, cancellation, and connection management.
- Go `context` package.
- Go `errors` package.
- Go security documentation.
- The project standards for context, error handling, data mapper, validation, telemetry, security, and time/date.

---

## 3. Non-negotiable rules

The agent MUST:

1. Use parameterized SQL for all untrusted values.
2. Use context-aware methods: `QueryContext`, `QueryRowContext`, `ExecContext`, `BeginTx`, `PrepareContext`.
3. Close every `*sql.Rows` and `*sql.Stmt` it owns.
4. Check `rows.Err()` after iteration.
5. Treat `sql.ErrNoRows` as a domain-specific absence case, not as a generic internal error.
6. Wrap database errors with operation context while preserving machine-checkable causes.
7. Keep transactions short, explicit, and owned by the application use case layer.
8. Never mix `*sql.DB` calls into a transaction workflow after `*sql.Tx` has started unless deliberately documented and safe.
9. Never use string concatenation to insert user-controlled SQL values.
10. Never hide transaction commit errors.
11. Never ignore rollback errors when rollback failure changes diagnostics.
12. Never log SQL parameters containing secrets, credentials, tokens, PII, or regulated data.
13. Never expose raw database errors directly to external API clients.
14. Never let repository methods create uncontrolled background contexts.
15. Never assume database driver placeholder syntax is portable.

---

## 4. Mental model

### 4.1 `*sql.DB` is not a single connection

`*sql.DB` is a concurrency-safe database handle and connection pool. It is intended to be long-lived and shared.

Required:

- Open once during application startup.
- Validate with `PingContext` during startup or health checks.
- Close during application shutdown.
- Tune pool settings based on database capacity, app concurrency, and request latency.

Forbidden:

```go
// FORBIDDEN: opening DB per request.
func handler(w http.ResponseWriter, r *http.Request) {
    db, _ := sql.Open("postgres", dsn)
    defer db.Close()
    // ...
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

### 4.2 `*sql.Tx` is a single transactional context

A transaction groups operations that must succeed or fail together. It normally binds operations to a single connection.

Required:

- Begin at use-case boundary, not deep in helper code unless the helper clearly owns the whole operation.
- Pass transaction explicitly to helper functions through a small executor interface.
- Commit once.
- Roll back on every non-commit exit path.

Forbidden:

```go
// FORBIDDEN: BEGIN/COMMIT as raw SQL through db.Exec.
db.ExecContext(ctx, "BEGIN")
db.ExecContext(ctx, "UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, from)
db.ExecContext(ctx, "COMMIT")
```

Preferred:

```go
tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
if err != nil {
    return fmt.Errorf("begin transfer tx: %w", err)
}
defer func() {
    if err != nil {
        _ = tx.Rollback()
    }
}()

if _, err = tx.ExecContext(ctx, debitSQL, amount, fromID); err != nil {
    return fmt.Errorf("debit account: %w", err)
}
if _, err = tx.ExecContext(ctx, creditSQL, amount, toID); err != nil {
    return fmt.Errorf("credit account: %w", err)
}
if err = tx.Commit(); err != nil {
    return fmt.Errorf("commit transfer tx: %w", err)
}
return nil
```

---

## 5. Package and layer rules

### 5.1 Persistence code location

Persistence code MUST live in infrastructure/persistence packages, not domain packages.

Allowed examples:

```text
internal/customer/postgres
internal/customer/sqlstore
internal/platform/database
internal/infrastructure/postgres
```

Forbidden examples:

```text
internal/customer/domain/sql.go
internal/customer/entity/customer_repository_impl.go
```

### 5.2 Repository interface ownership

Interfaces MUST be owned by the consumer side, usually the application/use-case layer.

Forbidden:

```go
// FORBIDDEN: provider package invents broad interface.
package postgres

type CustomerRepository interface {
    Create(ctx context.Context, c Customer) error
    Update(ctx context.Context, c Customer) error
    Delete(ctx context.Context, id string) error
    FindAll(ctx context.Context) ([]Customer, error)
}
```

Preferred:

```go
package application

type CustomerStore interface {
    FindByID(ctx context.Context, id CustomerID) (Customer, error)
    Save(ctx context.Context, customer Customer) error
}
```

### 5.3 Domain model isolation

Repository code MUST NOT leak SQL rows, nullable DB-specific types, raw driver errors, or table schemas into domain code.

Forbidden:

```go
type Customer struct {
    ID        int64
    Email     sql.NullString // forbidden in domain
    CreatedAt time.Time
}
```

Preferred:

```go
type customerRow struct {
    id        int64
    email     sql.NullString
    createdAt time.Time
}

func (r customerRow) toDomain() (Customer, error) {
    if !r.email.Valid {
        return Customer{}, ErrInvalidStoredCustomer
    }
    return NewCustomer(CustomerID(r.id), Email(r.email.String), r.createdAt)
}
```

---

## 6. Context and deadline rules

### 6.1 Every DB operation MUST accept context

Repository/store methods MUST accept `context.Context` as first parameter.

Forbidden:

```go
func (s *Store) FindUser(id int64) (User, error) {
    return s.find(context.Background(), id)
}
```

Preferred:

```go
func (s *Store) FindUser(ctx context.Context, id UserID) (User, error) {
    row := s.db.QueryRowContext(ctx, findUserSQL, int64(id))
    // ...
}
```

### 6.2 Repository MUST NOT create top-level deadlines blindly

Repository code MUST NOT decide business deadlines unless explicitly configured as infrastructure budget.

Allowed:

```go
type Store struct {
    db           *sql.DB
    queryTimeout time.Duration
}

func (s *Store) Health(ctx context.Context) error {
    ctx, cancel := context.WithTimeout(ctx, s.queryTimeout)
    defer cancel()
    return s.db.PingContext(ctx)
}
```

Forbidden:

```go
func (s *Store) Save(ctx context.Context, c Customer) error {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second) // loses caller cancellation
    defer cancel()
    // ...
}
```

### 6.3 Cancellation errors must be preserved

When DB operation fails due to context cancellation/deadline, return an error preserving `context.Canceled` or `context.DeadlineExceeded` when possible.

```go
if err := row.Scan(&id); err != nil {
    if errors.Is(ctx.Err(), context.DeadlineExceeded) {
        return Customer{}, fmt.Errorf("find customer timed out: %w", ctx.Err())
    }
    return Customer{}, mapDBError(err)
}
```

---

## 7. Query construction rules

### 7.1 Parameterization is mandatory

Every external value MUST be passed as a query parameter.

Forbidden:

```go
query := "SELECT * FROM users WHERE email = '" + email + "'"
rows, err := db.QueryContext(ctx, query)
```

Preferred:

```go
row := db.QueryRowContext(ctx, `
    SELECT id, email, status
    FROM users
    WHERE email = $1
`, email)
```

### 7.2 Dynamic identifiers require allowlist

SQL parameters do not bind identifiers such as table names, column names, direction, or index hints. If dynamic identifiers are unavoidable, use a closed allowlist.

Forbidden:

```go
query := fmt.Sprintf("ORDER BY %s %s", sortField, direction)
```

Preferred:

```go
func orderByClause(field SortField, direction SortDirection) (string, error) {
    fields := map[SortField]string{
        SortByCreatedAt: "created_at",
        SortByName:      "name",
    }
    directions := map[SortDirection]string{
        SortAsc:  "ASC",
        SortDesc: "DESC",
    }

    f, ok := fields[field]
    if !ok {
        return "", ErrInvalidSortField
    }
    d, ok := directions[direction]
    if !ok {
        return "", ErrInvalidSortDirection
    }
    return " ORDER BY " + f + " " + d, nil
}
```

### 7.3 Query constants should be named

Non-trivial SQL MUST be stored as named constants close to the store method or in a query file generation system.

Required:

```go
const findCaseForUpdateSQL = `
SELECT id, status, version, assigned_officer_id
FROM enforcement_case
WHERE id = $1
FOR UPDATE
`
```

### 7.4 SQL formatting

SQL MUST be readable:

- Uppercase SQL keywords for non-trivial queries.
- One selected column per line for queries with more than three columns.
- Explicit column list; no `SELECT *` in production code.
- Explicit table aliases only when useful.
- No hidden side-effect CTE unless documented.

Forbidden:

```go
const q = `select * from users where id=$1`
```

Preferred:

```go
const findUserSQL = `
SELECT
    id,
    email,
    status,
    created_at,
    updated_at
FROM users
WHERE id = $1
`
```

---

## 8. Prepared statement rules

Prepared statements MAY be used for repeated queries, but MUST be closed when owned locally.

Required:

- Prefer direct `QueryContext`/`ExecContext` for simple operations.
- Use `PrepareContext` for hot repeated statements only when driver/database benefits are understood.
- Close local statements with `defer stmt.Close()`.
- Do not share transaction-specific statements outside the transaction.
- Remember that the context passed to `PrepareContext` controls preparation, not future executions.

Forbidden:

```go
stmt, _ := db.PrepareContext(ctx, insertSQL) // leaked
for _, item := range items {
    _, _ = stmt.ExecContext(ctx, item.ID)
}
```

Preferred:

```go
stmt, err := tx.PrepareContext(ctx, insertItemSQL)
if err != nil {
    return fmt.Errorf("prepare insert item: %w", err)
}
defer stmt.Close()

for _, item := range items {
    if _, err := stmt.ExecContext(ctx, item.ID, item.Name); err != nil {
        return fmt.Errorf("insert item %s: %w", item.ID, err)
    }
}
```

---

## 9. Row scanning rules

### 9.1 Always scan explicit columns

Scan order MUST match selected column order exactly.

Preferred:

```go
const findUserSQL = `
SELECT id, email, status, created_at
FROM users
WHERE id = $1
`

func scanUser(row scanner) (userRow, error) {
    var r userRow
    if err := row.Scan(&r.id, &r.email, &r.status, &r.createdAt); err != nil {
        return userRow{}, err
    }
    return r, nil
}
```

### 9.2 Use local row structs

Complex scans MUST scan into persistence-local row structs before converting to domain.

Forbidden:

```go
var user domain.User
err := row.Scan(&user.ID, &user.Email, &user.Status)
```

Preferred:

```go
type userRow struct {
    id     int64
    email  string
    status string
}
```

### 9.3 Null handling must be explicit

Use one of:

- `sql.NullString`, `sql.NullInt64`, `sql.NullTime`, etc. at persistence boundary.
- Project-specific optional value types.
- Pointer fields only when pointer semantics are truly needed.

Forbidden:

```go
var nickname string
err := row.Scan(&nickname) // fails or loses null semantics if column nullable
```

Preferred:

```go
var nickname sql.NullString
if err := row.Scan(&nickname); err != nil {
    return err
}
```

### 9.4 Check `rows.Err()`

Forbidden:

```go
for rows.Next() {
    // scan
}
return result, nil
```

Preferred:

```go
for rows.Next() {
    var r userRow
    if err := rows.Scan(&r.id, &r.email); err != nil {
        return nil, fmt.Errorf("scan user row: %w", err)
    }
    result = append(result, r)
}
if err := rows.Err(); err != nil {
    return nil, fmt.Errorf("iterate user rows: %w", err)
}
return result, nil
```

### 9.5 `QueryRowContext` defers errors until `Scan`

Always call `Scan` and handle its result. Do not assume `QueryRowContext` itself returns errors.

---

## 10. Result handling rules

### 10.1 Check affected rows only when meaningful

For update/delete operations that require exactly one row, check `RowsAffected`.

```go
res, err := s.db.ExecContext(ctx, updateUserSQL, email, id, version)
if err != nil {
    return fmt.Errorf("update user: %w", mapDBError(err))
}

n, err := res.RowsAffected()
if err != nil {
    return fmt.Errorf("read update user rows affected: %w", err)
}
if n == 0 {
    return ErrUserNotFoundOrVersionConflict
}
if n > 1 {
    return fmt.Errorf("update user affected %d rows: %w", n, ErrDataIntegrityViolation)
}
```

### 10.2 Do not rely on `LastInsertId` unless driver supports it

Prefer database-specific `RETURNING` semantics when supported.

Preferred PostgreSQL example:

```go
err := s.db.QueryRowContext(ctx, `
    INSERT INTO users (email, status)
    VALUES ($1, $2)
    RETURNING id
`, email, status).Scan(&id)
```

---

## 11. Transaction rules

### 11.1 Transaction ownership must be explicit

Application/use-case layer should decide transaction boundaries.

Preferred pattern:

```go
type Execer interface {
    ExecContext(context.Context, string, ...any) (sql.Result, error)
    QueryContext(context.Context, string, ...any) (*sql.Rows, error)
    QueryRowContext(context.Context, string, ...any) *sql.Row
}
```

Repository helper accepts `Execer`:

```go
func insertAuditEvent(ctx context.Context, exec Execer, e auditEventRow) error {
    _, err := exec.ExecContext(ctx, insertAuditEventSQL, e.ID, e.Type, e.Payload)
    if err != nil {
        return fmt.Errorf("insert audit event: %w", err)
    }
    return nil
}
```

### 11.2 Use `BeginTx`, not `Begin`

Forbidden:

```go
tx, err := db.Begin()
```

Preferred:

```go
tx, err := db.BeginTx(ctx, &sql.TxOptions{
    Isolation: sql.LevelReadCommitted,
    ReadOnly:  false,
})
```

### 11.3 Isolation must be deliberate

Default isolation is acceptable only when explicitly documented as sufficient.

Must document when handling:

- Money/account balance.
- Inventory decrement.
- Case assignment.
- Regulatory deadline state transition.
- One-time token use.
- Idempotency key creation.
- Outbox insert.

### 11.4 Commit error is authoritative

If `Commit` fails, the application MUST NOT assume writes succeeded.

```go
if err := tx.Commit(); err != nil {
    return fmt.Errorf("commit create case tx: %w", mapDBError(err))
}
```

### 11.5 Rollback must be safe

Use deferred rollback, but do not let it overwrite the primary error unless needed.

```go
tx, err := db.BeginTx(ctx, nil)
if err != nil {
    return err
}
committed := false
defer func() {
    if !committed {
        _ = tx.Rollback()
    }
}()

// operations...

if err := tx.Commit(); err != nil {
    return err
}
committed = true
return nil
```

### 11.6 Do not perform remote calls inside DB transactions

Forbidden inside transaction unless explicitly approved:

- HTTP calls.
- gRPC calls.
- SMTP sends.
- Kafka publish without outbox.
- File upload to object storage.
- Long CPU-bound processing.

Preferred:

- Write DB state + outbox event in the transaction.
- Commit.
- Async publisher delivers the side effect.

---

## 12. Connection pool rules

### 12.1 Pool settings must be configured

Production code MUST configure pool settings deliberately.

```go
db.SetMaxOpenConns(cfg.MaxOpenConns)
db.SetMaxIdleConns(cfg.MaxIdleConns)
db.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)
db.SetConnMaxLifetime(cfg.ConnMaxLifetime)
```

Rules:

- `MaxOpenConns` must respect DB server capacity and app replica count.
- `MaxIdleConns` must not exceed `MaxOpenConns`.
- Connection lifetime should account for load balancers, proxies, server-side idle timeouts, failover behavior, and credential rotation.
- Defaults must be explicit in config.

### 12.2 Do not reserve `*sql.Conn` unless needed

`*sql.Conn` binds work to one connection. Use it only for:

- Session-scoped database settings.
- Driver-specific features requiring one connection.
- Advisory locks with connection semantics.

Always close it.

```go
conn, err := db.Conn(ctx)
if err != nil {
    return err
}
defer conn.Close()
```

---

## 13. Error handling rules

### 13.1 Map database errors at boundary

Persistence errors MUST be mapped to application/domain errors before leaving infrastructure boundary where meaningful.

Examples:

- no row → `ErrNotFound`.
- unique violation → `ErrAlreadyExists` or `ErrDuplicate`.
- foreign key violation → `ErrInvalidReference`.
- optimistic lock zero rows → `ErrVersionConflict`.
- deadlock/serialization failure → retryable infrastructure error.
- context deadline → timeout error preserving context cause.

### 13.2 `sql.ErrNoRows`

Use `errors.Is`.

```go
if err := row.Scan(&r.id, &r.email); err != nil {
    if errors.Is(err, sql.ErrNoRows) {
        return User{}, ErrUserNotFound
    }
    return User{}, fmt.Errorf("scan user: %w", mapDBError(err))
}
```

### 13.3 Preserve driver-specific errors carefully

If using PostgreSQL/MySQL/SQLite driver errors, isolate driver-specific code in mapping functions.

```go
func mapDBError(err error) error {
    if err == nil {
        return nil
    }
    // driver-specific mapping here
    return err
}
```

Forbidden:

```go
// FORBIDDEN: leaking driver package checks everywhere in app layer.
if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "23505" { ... }
```

### 13.4 Do not retry blindly

Only retry errors classified as transient and safe for the operation.

Retry requires:

- context deadline budget.
- max attempts.
- backoff with jitter.
- idempotency guarantee.
- logging/metrics.

Forbidden:

```go
for {
    if _, err := db.ExecContext(ctx, query); err == nil {
        break
    }
}
```

---

## 14. Security rules

### 14.1 SQL injection prevention

Required:

- Parameterized values.
- Identifier allowlists.
- Least-privilege DB users.
- Read/write role separation when useful.
- No dynamic SQL from raw request values.

### 14.2 Sensitive data

Do not log:

- Password hashes.
- Tokens.
- Session IDs.
- API keys.
- OTPs.
- Full PII values unless approved by audit policy.
- Raw SQL parameter arrays containing user data.

### 14.3 Tenant and authorization constraints

Every multi-tenant query MUST include tenant boundary conditions unless enforced by verified row-level security.

Forbidden:

```sql
SELECT id, status FROM cases WHERE id = $1
```

Preferred:

```sql
SELECT id, status
FROM cases
WHERE id = $1
  AND tenant_id = $2
```

### 14.4 Avoid privilege escalation through repository helpers

Repository helpers MUST NOT silently bypass authorization filters, status filters, tenant filters, or soft-delete filters.

---

## 15. Data consistency and state-machine rules

### 15.1 Optimistic locking

For mutable aggregate roots, use version checks unless pessimistic locking is explicitly chosen.

```sql
UPDATE cases
SET status = $1,
    version = version + 1,
    updated_at = $2
WHERE id = $3
  AND version = $4
```

Zero affected rows means not found or version conflict; distinguish if required by business behavior.

### 15.2 Pessimistic locking

Use `FOR UPDATE` only when necessary, and document:

- lock scope.
- expected duration.
- deadlock risk.
- retry behavior.
- ordering of locks.

### 15.3 State transition updates must be guarded

Forbidden:

```sql
UPDATE enforcement_case SET status = $1 WHERE id = $2
```

Preferred:

```sql
UPDATE enforcement_case
SET status = $1,
    version = version + 1,
    updated_at = $2
WHERE id = $3
  AND status = $4
  AND version = $5
```

### 15.4 Outbox pattern

When database state change must produce an event, write state change and outbox record in the same transaction.

```go
if err := updateCase(ctx, tx, c); err != nil { return err }
if err := insertOutbox(ctx, tx, outboxEvent); err != nil { return err }
```

---

## 16. Pagination and query cost rules

### 16.1 Offset pagination is not default for large datasets

For large or mutable datasets, prefer keyset pagination.

Forbidden for large tables:

```sql
SELECT id, created_at FROM cases ORDER BY created_at DESC OFFSET $1 LIMIT $2
```

Preferred:

```sql
SELECT id, created_at
FROM cases
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT $3
```

### 16.2 Every list query must have explicit limit

Repository list methods MUST require limit and enforce maximum.

### 16.3 Avoid N+1 queries

The agent MUST identify possible N+1 behavior and prefer:

- joins,
- batched lookup,
- CTE,
- preloaded map,
- database-side aggregation when appropriate.

---

## 17. Time/date rules

Required:

- Store timestamps as UTC unless DB/domain has explicit timezone requirements.
- Do not compare formatted time strings.
- Do not use local time implicitly in persistence code.
- Use consistent precision policy across DB and Go.
- Separate date-only from timestamp.

Forbidden:

```go
createdAt := time.Now() // hidden timezone and testing issue
```

Preferred:

```go
createdAt := clock.Now().UTC()
```

---

## 18. JSON/database rules

When storing JSON:

- Validate schema at application boundary.
- Use `json.RawMessage` carefully and clone if ownership matters.
- Do not use arbitrary `map[string]any` as durable data unless schema-less storage is a deliberate decision.
- Version JSON payloads for events/config/snapshots.
- Avoid querying JSON fields without indexes and cost analysis.

---

## 19. Observability rules

### 19.1 Metrics

Record at least:

- operation name,
- success/failure,
- duration histogram,
- affected rows where meaningful,
- retry count,
- timeout count,
- pool stats if relevant.

Do not record high-cardinality raw SQL or IDs as metric labels.

### 19.2 Tracing

Trace DB operations with sanitized attributes:

- system/database type,
- logical operation,
- table/entity name,
- row count when safe,
- error classification.

### 19.3 Logging

Log DB errors at boundary with:

- operation,
- entity type,
- safe identifiers,
- error class,
- retryable flag,
- correlation/request ID from context.

Do not log raw SQL with secrets.

---

## 20. Testing rules

### 20.1 Unit tests

Repository logic that maps rows/errors MUST be unit tested with:

- no row,
- duplicate,
- version conflict,
- null values,
- scan error,
- iteration error,
- context cancellation.

### 20.2 Integration tests

SQL queries MUST be tested against the target database or a compatible container when behavior depends on:

- isolation,
- lock semantics,
- constraint error codes,
- date/time precision,
- JSON behavior,
- generated columns,
- CTE/update semantics,
- transaction rollback.

### 20.3 Migration + repository compatibility

When changing SQL or schema, tests MUST prove:

- new code works with migrated schema,
- old code compatibility is considered for rolling deploys,
- null/default/backfill assumptions are correct.

### 20.4 Race and leak tests

Concurrent repository usage MUST be tested under `go test -race` when shared stores, caches, prepared statements, or transaction helpers are involved.

---

## 21. Benchmark rules

Benchmark hot queries at application boundary only when results will influence design.

Required benchmark context:

- dataset size,
- index state,
- database version,
- network locality,
- connection pool settings,
- concurrency level,
- p50/p95/p99 if measuring latency.

Do not benchmark SQL performance using empty tables and present results as production evidence.

---

## 22. LLM implementation checklist

Before producing Go SQL code, the agent MUST answer:

1. What transaction boundary owns this operation?
2. Does every DB call receive caller context?
3. Are all untrusted values parameterized?
4. Are dynamic identifiers allowlisted?
5. Are rows/statements closed?
6. Is `rows.Err()` checked?
7. Is `sql.ErrNoRows` mapped correctly?
8. Are DB-specific errors mapped at the persistence boundary?
9. Are tenant/authorization/status constraints present?
10. Are pagination and limits bounded?
11. Is time handled in UTC or an explicit location?
12. Are secrets/PII excluded from logs and metrics?
13. Does the test cover failure and rollback cases?
14. Does the migration support this query/index/constraint?
15. Is the query compatible with rolling deploys?

---

## 23. Review rejection triggers

Reject code if it contains:

- `fmt.Sprintf` SQL with untrusted values.
- `context.Background()` inside repository methods.
- `db.Query`/`db.Exec` instead of context-aware variants in request paths.
- Missing `rows.Close()`.
- Missing `rows.Err()`.
- Ignored `Commit` error.
- Raw transaction SQL `BEGIN`/`COMMIT` in application code.
- `SELECT *` in production repository code.
- Unbounded list query.
- Missing tenant boundary in multi-tenant data.
- Repository returning SQL-specific types to domain layer.
- Logging raw SQL args that may contain sensitive data.
- Remote calls inside transaction without approved outbox/side-effect design.

---

## 24. Minimal safe repository example

```go
package postgres

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "time"
)

var ErrCaseNotFound = errors.New("case not found")
var ErrCaseVersionConflict = errors.New("case version conflict")

const findCaseSQL = `
SELECT
    id,
    tenant_id,
    status,
    version,
    created_at,
    updated_at
FROM enforcement_case
WHERE id = $1
  AND tenant_id = $2
`

const updateCaseStatusSQL = `
UPDATE enforcement_case
SET status = $1,
    version = version + 1,
    updated_at = $2
WHERE id = $3
  AND tenant_id = $4
  AND status = $5
  AND version = $6
`

type Store struct {
    db *sql.DB
}

type caseRow struct {
    id        string
    tenantID  string
    status    string
    version   int64
    createdAt time.Time
    updatedAt time.Time
}

func NewStore(db *sql.DB) *Store {
    if db == nil {
        panic("nil *sql.DB")
    }
    return &Store{db: db}
}

func (s *Store) FindCase(ctx context.Context, tenantID, caseID string) (caseRow, error) {
    var r caseRow
    err := s.db.QueryRowContext(ctx, findCaseSQL, caseID, tenantID).Scan(
        &r.id,
        &r.tenantID,
        &r.status,
        &r.version,
        &r.createdAt,
        &r.updatedAt,
    )
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return caseRow{}, ErrCaseNotFound
        }
        return caseRow{}, fmt.Errorf("find case: %w", err)
    }
    return r, nil
}

func (s *Store) UpdateCaseStatus(ctx context.Context, tenantID, caseID, fromStatus, toStatus string, version int64, now time.Time) error {
    res, err := s.db.ExecContext(ctx, updateCaseStatusSQL, toStatus, now.UTC(), caseID, tenantID, fromStatus, version)
    if err != nil {
        return fmt.Errorf("update case status: %w", err)
    }
    affected, err := res.RowsAffected()
    if err != nil {
        return fmt.Errorf("read update case affected rows: %w", err)
    }
    if affected == 0 {
        return ErrCaseVersionConflict
    }
    if affected != 1 {
        return fmt.Errorf("update case status affected %d rows", affected)
    }
    return nil
}
```

---

## 25. Final rule

Database code is not acceptable until it proves correctness across success, absence, conflict, timeout, rollback, duplicate, authorization boundary, and operational observability paths.

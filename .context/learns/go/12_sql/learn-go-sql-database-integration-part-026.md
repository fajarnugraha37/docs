# learn-go-sql-database-integration-part-026.md

# Database-Specific Integration: PostgreSQL

> Seri: `learn-go-sql-database-integration`  
> Part: `026`  
> Topik: `PostgreSQL Integration in Go, pgx, database/sql, DSN, Pooling, Types, RETURNING, ON CONFLICT, COPY, LISTEN/NOTIFY, Advisory Locks, SQLSTATE, EXPLAIN, and Production Operations`  
> Target pembaca: Java software engineer yang ingin memahami Go database integration sampai level production architecture  
> Target Go: Go 1.26.x  
> Status seri: **belum selesai**

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi generic SQL integration:

- `database/sql` mental model;
- `*sql.DB`, `*sql.Tx`, `*sql.Rows`, `*sql.Stmt`;
- connection pool;
- rows lifecycle;
- scan/type mapping;
- nullable handling;
- parameter binding;
- prepared statement;
- transaction;
- isolation;
- locking;
- retry/idempotency;
- error taxonomy;
- repository boundary;
- query composition;
- pagination/listing;
- bulk write;
- read path performance.

Mulai part ini, kita masuk ke **database-specific integration**.

Part ini membahas PostgreSQL.

Kenapa database-specific penting?

Karena walaupun Go menyediakan `database/sql`, sistem production yang serius tidak bisa hanya berpikir:

```text
SQL itu sama di semua database.
```

PostgreSQL punya fitur dan behavior yang sangat spesifik:

- `$1`, `$2` placeholders;
- `RETURNING`;
- `ON CONFLICT`;
- `COPY`;
- MVCC;
- Serializable Snapshot Isolation;
- `FOR UPDATE SKIP LOCKED`;
- advisory lock;
- JSONB;
- arrays;
- UUID;
- range types;
- partial index;
- expression index;
- `EXPLAIN`;
- SQLSTATE;
- `LISTEN`/`NOTIFY`;
- `search_path`;
- `statement_timeout`;
- `lock_timeout`;
- `idle_in_transaction_session_timeout`;
- `application_name`;
- `sslmode`;
- libpq-style connection string;
- driver choices seperti `pgx` dan `lib/pq`.

Jika kamu memakai PostgreSQL dari Go, kamu harus paham di mana abstraction `database/sql` cukup, dan di mana PostgreSQL-specific feature lebih tepat.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. menjelaskan pilihan driver PostgreSQL di Go, terutama `pgx` native vs `pgx/stdlib` via `database/sql`;
2. membuat DSN/config PostgreSQL yang production-grade;
3. memahami placeholder `$1`, `$2`, ... dan implikasinya untuk dynamic SQL;
4. memakai `RETURNING` sebagai pengganti asumsi `LastInsertId`;
5. memakai `ON CONFLICT` dengan semantik bisnis yang benar;
6. memahami type mapping penting: `timestamp`, `timestamptz`, `numeric`, `uuid`, `jsonb`, array, enum, range;
7. memahami NULL dan zero-value boundary untuk PostgreSQL;
8. mengelola transaction isolation di PostgreSQL;
9. memakai row lock, `SKIP LOCKED`, dan advisory lock dengan benar;
10. memahami SQLSTATE dan error classification PostgreSQL;
11. memilih bulk-write path: multi-row insert, `COPY`, staging table;
12. memahami `LISTEN`/`NOTIFY` dan batasannya;
13. memakai session settings seperti `statement_timeout`, `lock_timeout`, `search_path`, dan `application_name`;
14. membaca `EXPLAIN`/`EXPLAIN ANALYZE` untuk query performance;
15. memahami index PostgreSQL: B-tree, partial, expression, GIN, BRIN;
16. merancang observability/runbook untuk PostgreSQL-backed Go service;
17. menghindari anti-pattern PostgreSQL integration di Go.

---

## 2. Fakta Dasar Dari Sumber Resmi

Beberapa fakta penting:

1. Go `database/sql` menyediakan abstraction generic untuk SQL database, dengan method seperti `QueryContext`, `ExecContext`, `BeginTx`, dan `PrepareContext`.
2. Dokumentasi Go menekankan bahwa placeholder parameter berbeda antar DBMS/driver; contoh untuk PostgreSQL driver seperti `pq` memakai `$1` alih-alih `?`.
3. `pgx` adalah PostgreSQL driver/toolkit untuk Go; dokumentasi `pgx` menyebut bahwa ia menyediakan low-level high-performance interface dan fitur PostgreSQL-specific seperti `LISTEN`/`NOTIFY` dan `COPY`, serta adapter untuk standard `database/sql`.
4. Package `github.com/jackc/pgx/v5/stdlib` adalah compatibility layer dari `pgx` ke `database/sql`.
5. Dokumentasi PostgreSQL menjelaskan `COPY` sebagai command untuk menyalin data antara file/stdin/stdout dan table.
6. Dokumentasi PostgreSQL menjelaskan `INSERT ... ON CONFLICT` untuk menentukan aksi alternatif ketika terjadi unique/exclusion constraint conflict.
7. Dokumentasi PostgreSQL menyediakan daftar SQLSTATE error codes seperti `23505` unique violation, `23503` foreign key violation, `40001` serialization failure, dan `40P01` deadlock detected.
8. Dokumentasi PostgreSQL menjelaskan transaction isolation dan explicit locking sebagai bagian dari concurrency control.

Referensi utama:

- Go `database/sql`: <https://pkg.go.dev/database/sql>
- Go — Querying for data: <https://go.dev/doc/database/querying>
- Go — Avoiding SQL injection risk: <https://go.dev/doc/database/sql-injection>
- Go — Executing transactions: <https://go.dev/doc/database/execute-transactions>
- pgx package: <https://pkg.go.dev/github.com/jackc/pgx/v5>
- pgx stdlib: <https://pkg.go.dev/github.com/jackc/pgx/v5/stdlib>
- PostgreSQL — libpq connection strings: <https://www.postgresql.org/docs/current/libpq-connect.html>
- PostgreSQL — INSERT: <https://www.postgresql.org/docs/current/sql-insert.html>
- PostgreSQL — COPY: <https://www.postgresql.org/docs/current/sql-copy.html>
- PostgreSQL — Transaction Isolation: <https://www.postgresql.org/docs/current/transaction-iso.html>
- PostgreSQL — Explicit Locking: <https://www.postgresql.org/docs/current/explicit-locking.html>
- PostgreSQL — Error Codes: <https://www.postgresql.org/docs/current/errcodes-appendix.html>
- PostgreSQL — EXPLAIN: <https://www.postgresql.org/docs/current/sql-explain.html>
- PostgreSQL — Indexes: <https://www.postgresql.org/docs/current/indexes.html>

---

## 3. Mental Model Utama

### 3.1 `database/sql` Memberi Abstraction, PostgreSQL Memberi Semantics

Di Go kamu bisa menulis:

```go
db.QueryContext(ctx, query, args...)
```

Tapi behavior sebenarnya ditentukan oleh:

- PostgreSQL server;
- driver;
- connection/session settings;
- transaction isolation;
- SQL syntax;
- type mapping;
- indexes;
- query planner;
- network/proxy;
- pool configuration.

`database/sql` tidak menghilangkan kebutuhan memahami PostgreSQL.

### 3.2 PostgreSQL Integration Punya Dua Jalur Besar

```text
A. database/sql path
   sql.Open("pgx", dsn) via pgx/stdlib
   atau sql.Open("postgres", dsn) dengan driver lain

B. pgx native path
   pgx.Conn / pgxpool.Pool
```

`database/sql` path cocok jika:

- kamu ingin interface generic;
- repository pattern sudah memakai `DBTX`;
- tidak butuh banyak fitur PostgreSQL-specific;
- tim familiar dengan `database/sql`;
- ingin konsisten dengan seri ini.

`pgx native` path cocok jika:

- kamu butuh PostgreSQL-specific feature;
- butuh COPY;
- butuh LISTEN/NOTIFY;
- butuh better type support;
- ingin memakai pgx pool dan API native;
- ingin statement cache pgx native;
- tidak perlu portability `database/sql`.

### 3.3 PostgreSQL Feature Harus Dipakai Dengan Semantik Bisnis

Fitur seperti:

```text
ON CONFLICT
SKIP LOCKED
advisory lock
RETURNING
COPY
JSONB
partial index
```

bukan sekadar trik performance.

Masing-masing mengubah:

- correctness;
- error handling;
- retry behavior;
- auditability;
- indexing;
- migration;
- observability.

---

## 4. Diagram: Go + PostgreSQL Integration Choices

```mermaid
flowchart TD
    A[Go Application] --> B{Driver/API choice}

    B -->|database/sql| C[pgx/stdlib or another database/sql driver]
    B -->|pgx native| D[pgx.Conn / pgxpool.Pool]

    C --> E[Generic DBTX Repository]
    D --> F[PostgreSQL-specific Repository]

    E --> G[Query/Exec/Tx/Rows]
    F --> H[Query/Exec/Tx/COPY/LISTEN/Type codecs]

    G --> I[(PostgreSQL)]
    H --> I

    I --> J[MVCC, SQLSTATE, Locks, Indexes, COPY, JSONB]
```

---

## 5. Driver Choice: `pgx` Native vs `database/sql`

### 5.1 `pgx` Native

`pgx` native gives access to PostgreSQL-specific features more directly.

Strengths:

- PostgreSQL-specific type support;
- COPY support;
- LISTEN/NOTIFY;
- native pool via `pgxpool`;
- statement cache;
- good performance;
- lower-level control.

Trade-offs:

- repository depends on pgx API;
- less portable;
- different interface than `database/sql`;
- you need pgx-specific error/type handling.

### 5.2 `pgx/stdlib` With `database/sql`

`pgx/stdlib` lets you use pgx through `database/sql`.

Example from docs style:

```go
db, err := sql.Open("pgx", "postgres://user:pass@localhost:5432/dbname?sslmode=disable")
```

Strengths:

- compatible with `database/sql`;
- works with `DBTX` pattern;
- easier to reuse generic SQL layer;
- can still use pgx driver under the hood.

Trade-offs:

- not all pgx native features exposed through `database/sql`;
- COPY/LISTEN may require pgx native;
- type mapping may be less direct;
- statement cache/driver behavior requires understanding.

### 5.3 Legacy `lib/pq`

`lib/pq` historically common.

But for new Go PostgreSQL projects, many teams prefer `pgx` because it is actively developed and offers native PostgreSQL features.

If maintaining legacy code, understand existing driver behavior before changing.

---

## 6. Recommended Default

For this series:

```text
Default: database/sql + pgx/stdlib for normal repositories.
Use pgx native for PostgreSQL-specific paths like COPY, LISTEN/NOTIFY, or specialized type handling.
```

This gives balance:

- repository boundary stays generic;
- PostgreSQL power still available where needed;
- migration path is clear.

Architecture:

```text
/internal/data/...         uses database/sql DBTX
/internal/postgres/bulk    may use pgx native COPY
/internal/postgres/listen  may use pgx native LISTEN/NOTIFY
```

---

## 7. Opening PostgreSQL Handle With `database/sql`

```go
import (
	"context"
	"database/sql"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func OpenPostgres(ctx context.Context, dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(40)
	db.SetMaxIdleConns(20)
	db.SetConnMaxIdleTime(5 * time.Minute)
	db.SetConnMaxLifetime(30 * time.Minute)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, err
	}

	return db, nil
}
```

Notes:

- `sql.Open` validates arguments but may not create a network connection immediately.
- `PingContext` validates connectivity.
- pool settings are part of production config.
- import driver for side-effect registration.

---

## 8. DSN and Connection String

PostgreSQL accepts URI-style and keyword/value style connection strings in libpq ecosystem.

URI style:

```text
postgres://user:password@host:5432/dbname?sslmode=require&application_name=my-service
```

Keyword/value style:

```text
host=db.example.com port=5432 user=app password=secret dbname=appdb sslmode=require application_name=my-service
```

Production config should include:

- host;
- port;
- dbname;
- user;
- password/secret reference;
- sslmode;
- connect timeout;
- application name;
- timezone policy if needed;
- statement/session settings if driver supports runtime params.

Do not log DSN with password.

---

## 9. DSN Hygiene

Bad:

```go
log.Printf("connecting to %s", dsn)
```

Good:

```go
log.Printf("connecting to postgres host=%s db=%s user=%s sslmode=%s", host, dbName, user, sslMode)
```

Redact password.

Config struct:

```go
type PostgresConfig struct {
	Host            string
	Port            int
	Database        string
	User            string
	Password        string
	SSLMode         string
	ApplicationName string
	ConnectTimeout time.Duration
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxIdleTime time.Duration
	ConnMaxLifetime time.Duration
}
```

Validate config before opening.

---

## 10. TLS and `sslmode`

Common `sslmode` values include:

```text
disable
allow
prefer
require
verify-ca
verify-full
```

Production recommendation:

```text
verify-full
```

where possible, because it validates certificate chain and hostname.

`require` encrypts but may not verify identity fully depending configuration.

Choose based on environment, CA management, cloud provider, and security requirement.

Do not use `sslmode=disable` in production unless explicitly justified by trusted network/tunnel and policy.

---

## 11. `application_name`

Set `application_name`.

Why?

- visible in `pg_stat_activity`;
- helps DBA/ops identify connections;
- helps incident investigation;
- helps query attribution.

Example DSN:

```text
application_name=aceas-api
```

If multiple services:

```text
aceas-api
aceas-worker
aceas-report
```

If multiple pools:

```text
aceas-api-oltp
aceas-api-batch
```

---

## 12. `search_path`

PostgreSQL resolves unqualified table names via `search_path`.

Risk:

```sql
SELECT * FROM users
```

could refer to different schema depending session.

Recommendations:

1. use explicit schema in SQL for critical systems:
   ```sql
   SELECT * FROM app.users
   ```
2. or set stable `search_path` at connection/session startup;
3. avoid per-request dynamic search_path unless deeply controlled;
4. beware session state leak in pooled connections.

For multi-tenant schema-per-tenant, dynamic `search_path` is dangerous with pooling unless carefully reset.

---

## 13. Session State and Pooling

A `database/sql` pool reuses connections.

If you do:

```sql
SET search_path = tenant_a;
```

and return connection to pool, next request may inherit it unless reset by driver/pool behavior or transaction-local setting.

Safer:

```sql
SET LOCAL search_path = ...
```

inside transaction, where supported.

Or avoid session state and qualify schema.

Session state to watch:

- `search_path`;
- timezone;
- role;
- statement timeout;
- lock timeout;
- application name;
- prepared statements;
- temporary tables;
- advisory locks;
- LISTEN subscriptions.

---

## 14. Timezone

PostgreSQL has `timestamp` and `timestamptz`.

Practical advice:

- store instants as `timestamptz`;
- use UTC in application;
- parse user date ranges in user timezone before DB query;
- avoid mixing local time and DB session timezone accidentally;
- prefer explicit timestamp semantics in schema.

Go uses `time.Time`.

Be clear:

```text
timestamp without time zone = local/wall-clock value
timestamp with time zone = instant normalized by PostgreSQL semantics
```

For event timestamps, usually use `timestamptz`.

---

## 15. Placeholders: `$1`, `$2`, ...

PostgreSQL-style:

```sql
SELECT id, email
FROM users
WHERE tenant_id = $1
  AND status = $2;
```

In Go:

```go
rows, err := db.QueryContext(ctx, query, tenantID, status)
```

Dynamic SQL needs placeholder generator:

```go
type Placeholder struct {
	n int
}

func (p *Placeholder) Next() string {
	p.n++
	return fmt.Sprintf("$%d", p.n)
}
```

Do not use `?` unless your driver translates it. With pgx/stdlib and PostgreSQL SQL, `$n` is the safe default.

---

## 16. `RETURNING`

PostgreSQL supports `RETURNING` on `INSERT`, `UPDATE`, `DELETE`, and `MERGE`.

Use it to get generated IDs or changed rows.

Insert:

```go
var id int64
err := db.QueryRowContext(ctx, `
	INSERT INTO users (email, name)
	VALUES ($1, $2)
	RETURNING id
`, email, name).Scan(&id)
```

Update:

```go
var updatedAt time.Time
err := db.QueryRowContext(ctx, `
	UPDATE cases
	SET status = $1,
	    updated_at = CURRENT_TIMESTAMP
	WHERE id = $2
	  AND status = $3
	RETURNING updated_at
`, to, caseID, from).Scan(&updatedAt)
```

If no row updated, `Scan` returns `sql.ErrNoRows`.

This can replace `RowsAffected` in some patterns.

---

## 17. `RETURNING` vs `RowsAffected`

Conditional update with `RowsAffected`:

```go
result, err := tx.ExecContext(ctx, `
	UPDATE cases
	SET status = $1
	WHERE id = $2
	  AND status = $3
`, to, id, from)
```

Conditional update with `RETURNING`:

```go
var newVersion int64
err := tx.QueryRowContext(ctx, `
	UPDATE cases
	SET status = $1,
	    version = version + 1
	WHERE id = $2
	  AND status = $3
	RETURNING version
`, to, id, from).Scan(&newVersion)
```

If no row:

```go
if errors.Is(err, sql.ErrNoRows) {
	return ErrInvalidStateTransition
}
```

`RETURNING` is excellent when you need updated values.

---

## 18. `LastInsertId` Caveat

Do not rely on `sql.Result.LastInsertId` for PostgreSQL.

Use:

```sql
RETURNING id
```

This is idiomatic PostgreSQL.

For multi-row insert needing IDs:

```sql
INSERT ...
RETURNING id, business_key
```

Scan rows.

---

## 19. `ON CONFLICT DO NOTHING`

Example idempotent insert:

```sql
INSERT INTO inbox_messages (message_id, source, status, received_at)
VALUES ($1, $2, 'STARTED', CURRENT_TIMESTAMP)
ON CONFLICT (message_id) DO NOTHING;
```

In Go:

```go
result, err := db.ExecContext(ctx, query, messageID, source)
if err != nil {
	return err
}

affected, err := result.RowsAffected()
if err != nil {
	return err
}

if affected == 0 {
	return ErrDuplicateMessage
}
```

Use when duplicate means already processed/in-progress.

---

## 20. `ON CONFLICT DO UPDATE`

Example:

```sql
INSERT INTO external_profiles (source_id, source_version, email, name)
VALUES ($1, $2, $3, $4)
ON CONFLICT (source_id)
DO UPDATE SET
    source_version = EXCLUDED.source_version,
    email = EXCLUDED.email,
    name = EXCLUDED.name
WHERE external_profiles.source_version < EXCLUDED.source_version;
```

This prevents stale source version from overwriting newer data.

`ON CONFLICT DO UPDATE` is not just performance. It is business semantics.

---

## 21. Partial Unique Index

PostgreSQL supports partial indexes.

Example:

```sql
CREATE UNIQUE INDEX uq_active_license_per_user
ON licenses(user_id)
WHERE active = true;
```

Useful for invariants:

```text
only one active license per user
only one active assignment per case
only one active appeal per case
```

Application code still handles unique violation.

Partial unique index can be stronger and simpler than application pre-check.

---

## 22. Expression Index

Example:

```sql
CREATE UNIQUE INDEX uq_users_lower_email
ON users (lower(email));
```

Then query:

```sql
WHERE lower(email) = lower($1)
```

Need expression index for performance.

Use carefully:

- function must match query expression;
- collation matters;
- run analyze/statistics.

---

## 23. JSONB

PostgreSQL `jsonb` is powerful for semi-structured data.

Use cases:

- event payload;
- audit metadata;
- external raw response;
- flexible attributes;
- outbox payload.

Go options:

- scan into `[]byte`;
- scan into `json.RawMessage`;
- unmarshal into struct;
- use pgx native types if desired.

Example:

```go
var raw json.RawMessage

err := row.Scan(&raw)
```

Insert:

```go
payloadBytes, err := json.Marshal(payload)
_, err = db.ExecContext(ctx, `
	INSERT INTO outbox_events (id, payload)
	VALUES ($1, $2::jsonb)
`, id, payloadBytes)
```

Caution:

- JSONB is not replacement for relational schema;
- indexing JSONB needs explicit design;
- avoid querying arbitrary deep JSON in hot OLTP path without indexes.

---

## 24. UUID

PostgreSQL has `uuid` type.

In Go:

- use string;
- use `[16]byte`;
- use third-party UUID type;
- use pgx/pgtype;
- map consistently.

If avoiding external dependency in domain, use string with validation at boundary, or internal UUID type.

DB can generate UUID if extension/function available, but app-generated IDs can simplify idempotency and bulk insert.

---

## 25. Numeric / Decimal

PostgreSQL `numeric` is exact arbitrary precision.

Go `float64` is not exact decimal.

For money:

- avoid `float64`;
- use integer minor units if possible;
- or decimal library;
- or scan numeric as string and parse;
- define precision/scale in schema.

Example schema:

```sql
amount_cents BIGINT NOT NULL
```

is often simpler than `numeric` for currency.

For regulatory/financial systems, decimal semantics must be explicit.

---

## 26. Arrays

PostgreSQL supports array types.

Use cases:

- small tag list;
- query with `= ANY($1)`;
- internal metadata.

Caution:

- arrays are not always normalized design;
- querying/indexing arrays needs GIN or specific operators;
- driver support differs.

For `IN` equivalent, PostgreSQL can use:

```sql
WHERE id = ANY($1)
```

with array parameter if driver supports it.

With pgx native, array handling is strong. With `database/sql`, check driver behavior.

Fallback: expand placeholders.

---

## 27. Enum Types

PostgreSQL enum type:

```sql
CREATE TYPE case_status AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED');
```

Pros:

- DB-level validation;
- compact;
- clear.

Cons:

- changing enum requires migration;
- cross-service/version rollout can be tricky;
- app must handle unknown future value if rolling deploy.

Alternative:

- `TEXT` + `CHECK`;
- lookup table.

For many app workflows, `TEXT` + `CHECK` is easier to evolve.

---

## 28. Range Types and Exclusion Constraints

PostgreSQL supports range types and exclusion constraints.

Use case:

```text
no overlapping appointment for same resource
```

Example concept:

```sql
EXCLUDE USING gist (
    resource_id WITH =,
    time_range WITH &&
)
```

This is PostgreSQL-specific and powerful.

If your domain has interval-overlap invariant, consider it.

But it needs careful migration, indexing, and error mapping.

---

## 29. Error Classification With SQLSTATE

PostgreSQL error code examples:

| SQLSTATE | Meaning | Typical App Class |
|---|---|---|
| `23505` | unique_violation | conflict/idempotency duplicate |
| `23503` | foreign_key_violation | invalid reference |
| `23502` | not_null_violation | invalid data/app bug |
| `23514` | check_violation | invariant violation |
| `23P01` | exclusion_violation | range conflict |
| `40001` | serialization_failure | retry whole tx |
| `40P01` | deadlock_detected | retry whole tx |
| `55P03` | lock_not_available | lock timeout/nowait |
| `57014` | query_canceled | statement timeout/cancel |
| `42501` | insufficient_privilege | permission/config |
| `42P01` | undefined_table | schema drift |
| `42703` | undefined_column | schema drift |
| `42601` | syntax_error | query bug |

Driver-specific error extraction depends on driver.

With pgx, common type is `*pgconn.PgError`.

---

## 30. PostgreSQL Classifier Example

Conceptual:

```go
func ClassifyPostgres(err error) Classification {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return Classification{Class: ClassUnknown}
	}

	switch pgErr.Code {
	case "23505":
		return Classification{
			Class:      ClassUniqueViolation,
			Constraint: pgErr.ConstraintName,
		}
	case "23503":
		return Classification{
			Class:      ClassForeignKeyViolation,
			Constraint: pgErr.ConstraintName,
		}
	case "23514":
		return Classification{
			Class:      ClassCheckViolation,
			Constraint: pgErr.ConstraintName,
		}
	case "40001":
		return Classification{Class: ClassSerializationFailure, Retryable: true}
	case "40P01":
		return Classification{Class: ClassDeadlock, Retryable: true}
	case "55P03":
		return Classification{Class: ClassLockTimeout, Retryable: true}
	case "57014":
		return Classification{Class: ClassStatementTimeout}
	case "42501":
		return Classification{Class: ClassPermissionDenied}
	case "42P01", "42703", "42601":
		return Classification{Class: ClassSyntaxOrSchema}
	default:
		return Classification{Class: ClassUnknown}
	}
}
```

This belongs in infrastructure/data layer, not domain.

---

## 31. Transaction Isolation in PostgreSQL

PostgreSQL supports:

- Read Committed;
- Repeatable Read;
- Serializable.

PostgreSQL treats Read Uncommitted as Read Committed.

Default is usually Read Committed.

In Go:

```go
tx, err := db.BeginTx(ctx, &sql.TxOptions{
	Isolation: sql.LevelSerializable,
	ReadOnly:  false,
})
```

If using Serializable:

- expect SQLSTATE `40001`;
- retry whole transaction;
- avoid external side effects inside transaction;
- keep transaction short.

---

## 32. Read Committed in PostgreSQL

Read Committed behavior:

- each statement sees a snapshot of committed data as of statement start;
- repeated SELECTs in same transaction can see different committed data;
- good default for many OLTP operations.

Use with:

- conditional update;
- unique constraints;
- row locks;
- idempotency;
- rows affected checks.

Do not assume multi-statement read view is stable under Read Committed.

---

## 33. Repeatable Read

Repeatable Read gives stable transaction snapshot for reads.

Use for:

- coherent multi-query read;
- report snapshot;
- avoiding read skew.

Caution:

- long transaction creates MVCC pressure;
- still not always best for write-heavy invariant;
- conflicts can occur.

---

## 34. Serializable

Serializable provides strongest isolation via PostgreSQL's mechanism.

Use for:

- complex predicate invariant;
- hard-to-lock cross-row logic;
- correctness more important than throughput.

Requires:

- SQLSTATE `40001` retry;
- bounded retry;
- short transaction;
- no external side effects.

---

## 35. Row Locks

PostgreSQL locking clauses include:

- `FOR UPDATE`;
- `FOR NO KEY UPDATE`;
- `FOR SHARE`;
- `FOR KEY SHARE`.

Common use:

```sql
SELECT id, status
FROM cases
WHERE id = $1
FOR UPDATE;
```

Use when:

- inspect row then update;
- coordinate multiple writes;
- prevent concurrent modifications;
- queue claim with `SKIP LOCKED`.

Prefer conditional update when enough.

---

## 36. `FOR UPDATE SKIP LOCKED`

Queue worker pattern:

```sql
SELECT id
FROM outbox_events
WHERE status = 'PENDING'
  AND next_attempt_at <= CURRENT_TIMESTAMP
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT $1;
```

Then update claimed rows in same transaction.

Use for:

- outbox;
- background jobs;
- task queues.

Caution:

- skipped locked rows may starve;
- need visibility timeout/reclaim;
- DB-specific;
- indexes matter;
- keep transaction short.

---

## 37. `NOWAIT`

PostgreSQL supports lock `NOWAIT` pattern.

Example:

```sql
SELECT id
FROM cases
WHERE id = $1
FOR UPDATE NOWAIT;
```

If row locked, fail immediately with lock-not-available style error.

Use for:

- user-facing “resource busy”;
- admin tools;
- avoiding long wait.

Map to conflict/busy response.

---

## 38. Advisory Locks

PostgreSQL advisory locks are application-defined locks.

Transaction-scoped example concept:

```sql
SELECT pg_advisory_xact_lock($1);
```

Use cases:

- serialize by tenant/case/quota key;
- coarse aggregate lock;
- singleton job;
- migration guard.

Prefer transaction-scoped advisory locks over session-scoped in pooled apps.

Caution:

- not tied to row visibility;
- key collisions if poor hash;
- deadlocks possible if multiple locks;
- invisible to constraints;
- do not replace unique constraints.

---

## 39. Hashing Advisory Lock Key

If locking by string:

```go
func AdvisoryKey(s string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	return int64(h.Sum64())
}
```

Collision possible.

For critical locks, use two-int advisory lock forms or carefully allocated numeric keyspace if available.

Document key scheme.

---

## 40. Statement Timeout

PostgreSQL `statement_timeout` aborts statements that run too long.

Use for:

- preventing runaway query;
- controlling request budget;
- limiting report damage.

Can be set at:

- database/user level;
- session level;
- transaction-local level.

In app transaction:

```sql
SET LOCAL statement_timeout = '500ms';
```

Then run statements.

Caution:

- setting session-level timeout in pooled connection can leak;
- prefer `SET LOCAL` inside transaction where appropriate;
- app context timeout still needed.

---

## 41. Lock Timeout

`lock_timeout` limits how long statement waits for a lock.

Example:

```sql
SET LOCAL lock_timeout = '100ms';
```

Use for:

- user-facing updates that should not wait long;
- avoiding pool saturation behind locks;
- batch job politeness.

If lock timeout occurs, classify and decide retry/conflict.

---

## 42. Idle In Transaction Timeout

`idle_in_transaction_session_timeout` can terminate sessions that sit idle inside transaction.

This protects DB from:

- forgotten transactions;
- locks held while app waits;
- MVCC bloat.

Application should also avoid idle transaction by design.

Do not rely only on DB timeout.

---

## 43. Setting Local Timeouts in Transaction

```go
func setLocalTimeouts(ctx context.Context, tx *sql.Tx, statementTimeout string, lockTimeout string) error {
	if _, err := tx.ExecContext(ctx, `SET LOCAL statement_timeout = $1`, statementTimeout); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `SET LOCAL lock_timeout = $1`, lockTimeout); err != nil {
		return err
	}
	return nil
}
```

However, not all PostgreSQL settings accept parameters in all contexts the same way. If parameter binding is not accepted for a SET form in your driver/server combo, use allowlisted literals.

Safer with allowlist:

```go
var allowedStatementTimeout = map[string]string{
	"500ms": "500ms",
	"2s":    "2s",
}
```

Never concatenate raw user timeout.

---

## 44. Transaction Manager With PostgreSQL Local Settings

```go
type PgTxOptions struct {
	SQLTxOptions     *sql.TxOptions
	StatementTimeout string
	LockTimeout      string
}

func (m TxManager) WithinPostgres(
	ctx context.Context,
	operation string,
	opts PgTxOptions,
	fn func(context.Context, *sql.Tx) error,
) error {
	tx, err := m.DB.BeginTx(ctx, opts.SQLTxOptions)
	if err != nil {
		return fmt.Errorf("begin tx %s: %w", operation, err)
	}
	defer tx.Rollback()

	if opts.StatementTimeout != "" || opts.LockTimeout != "" {
		if err := setLocalTimeouts(ctx, tx, opts.StatementTimeout, opts.LockTimeout); err != nil {
			return fmt.Errorf("set local timeouts %s: %w", operation, err)
		}
	}

	if err := fn(ctx, tx); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx %s: %w", operation, err)
	}

	return nil
}
```

Be careful with timeout value validation.

---

## 45. Prepared Statements and pgx Statement Cache

`database/sql` prepared statement behavior was covered earlier.

For pgx native, docs mention automatic statement cache by default for normal query methods.

Implications:

- with pgx native, manual prepare often unnecessary;
- statement cache can interact with proxies/poolers;
- prepared statements are per connection;
- schema changes can invalidate statements;
- dynamic SQL high-cardinality can cause cache churn.

If using PgBouncer in transaction pooling mode, prepared statements require special attention depending pooler/version/configuration.

---

## 46. PostgreSQL and External Poolers

External poolers like PgBouncer may sit between app and PostgreSQL.

Consider:

- session pooling vs transaction pooling;
- prepared statement behavior;
- session state (`SET`, `LISTEN`, temp tables);
- advisory locks;
- `search_path`;
- application-side pool + pooler interaction;
- max server connections.

If using transaction pooling, avoid relying on session state.

`database/sql` pool and PgBouncer pool are different layers. Configure both intentionally.

---

## 47. `COPY` With pgx Native

For high-throughput load, use pgx native COPY support.

Conceptual pgx native style:

```go
rows := [][]any{
	{1, "a@example.com"},
	{2, "b@example.com"},
}

count, err := conn.CopyFrom(
	ctx,
	pgx.Identifier{"users"},
	[]string{"id", "email"},
	pgx.CopyFromRows(rows),
)
```

Exact API depends on pgx version.

Use COPY for:

- large imports;
- staging table load;
- high-throughput ingestion.

Do not force everything through `database/sql` if COPY is the right PostgreSQL tool.

---

## 48. COPY vs Multi-Row Insert

| Aspect | Multi-row INSERT | COPY |
|---|---|---|
| portability | better | PostgreSQL-specific |
| simplicity | simple | driver-specific |
| throughput | good | excellent |
| per-row error handling | statement fails | often use staging |
| returning IDs | possible with RETURNING | not direct same way |
| upsert | direct ON CONFLICT | usually staging + merge |
| best use | medium batch | large load |

For huge imports, COPY into staging then merge is often robust.

---

## 49. LISTEN / NOTIFY

PostgreSQL supports async notification:

```sql
LISTEN channel;
NOTIFY channel, 'payload';
```

Use cases:

- wake up worker;
- cache invalidation signal;
- low-volume coordination.

Limitations:

- not durable message queue;
- notifications can be lost if listener disconnected;
- payload limited;
- not replacement for outbox/Kafka/RabbitMQ;
- listener requires dedicated connection/session.

Use as optimization, not source of truth.

Pattern:

```text
DB transaction inserts outbox event
after commit NOTIFY wakes worker
worker reads outbox table
```

If NOTIFY missed, worker polling still catches pending outbox.

---

## 50. Dedicated Connection for LISTEN

LISTEN is session state.

Do not run it on random pooled connection used by requests.

Use dedicated pgx native connection:

```text
listener connection:
  LISTEN outbox_wakeup
  wait for notifications
```

If connection drops:

- reconnect;
- re-LISTEN;
- fall back to polling;
- observe reconnect count.

---

## 51. PostgreSQL Types and Go Scanning

Common mappings:

| PostgreSQL | Go |
|---|---|
| `bigint` | `int64` |
| `integer` | `int32`/`int` |
| `text` | `string` |
| `boolean` | `bool` |
| `timestamptz` | `time.Time` |
| `bytea` | `[]byte` |
| `jsonb` | `[]byte` / `json.RawMessage` / struct |
| `uuid` | string / UUID type |
| `numeric` | string / decimal / integer minor unit |
| nullable | `sql.Null*` / pointer / custom nullable |
| array | driver-specific array support |
| enum | string/domain type |

Always test with actual driver.

---

## 52. Timestamps

PostgreSQL timestamp types:

```text
timestamp without time zone
timestamp with time zone / timestamptz
```

For event time:

```text
timestamptz
```

In SQL:

```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

In Go:

```go
var createdAt time.Time
```

Ensure:

- UTC policy;
- date range normalized;
- no local timezone surprises;
- JSON response format consistent.

---

## 53. `now()` vs App Clock

Using DB time:

```sql
updated_at = now()
```

Pros:

- consistent within DB transaction;
- no app clock skew;
- simple.

Using app time:

```go
now := clock.Now()
_, err := tx.ExecContext(ctx, query, now)
```

Pros:

- testable;
- same timestamp can be used across DB and events;
- app controls clock semantics.

Choose convention.

For audit/outbox, consistent operation timestamp is useful.

---

## 54. Bytea and Large Objects

`bytea` can store binary data but avoid storing large files in OLTP table unless justified.

For documents/files:

- object storage often better;
- DB stores metadata and checksum;
- transaction includes metadata/outbox;
- file upload workflow handles consistency.

If using bytea:

- avoid listing bytea columns;
- stream carefully;
- watch memory.

---

## 55. JSONB Indexing

PostgreSQL JSONB supports indexing via GIN and expression indexes.

Example:

```sql
CREATE INDEX idx_events_payload_gin
ON events
USING gin (payload);
```

Expression:

```sql
CREATE INDEX idx_events_payload_type
ON events ((payload->>'type'));
```

Use only for known query patterns.

Do not store arbitrary JSON and then expect fast arbitrary search.

---

## 56. GIN Index

GIN useful for:

- JSONB containment;
- arrays;
- full-text.

Trade-offs:

- write overhead;
- storage;
- maintenance;
- query pattern specificity.

Measure.

---

## 57. BRIN Index

BRIN useful for very large naturally ordered tables, such as append-only logs by timestamp.

Use cases:

- audit log;
- event table;
- time-series-ish data;
- archival scans.

Trade-offs:

- approximate/block-range;
- not for highly random access.

---

## 58. Partial Index

Example:

```sql
CREATE INDEX idx_outbox_pending
ON outbox_events (next_attempt_at, created_at)
WHERE status = 'PENDING';
```

Excellent for queues.

Query must match predicate:

```sql
WHERE status = 'PENDING'
  AND next_attempt_at <= now()
ORDER BY created_at
```

Partial indexes reduce size and improve performance for hot subset.

---

## 59. Expression Index

Example case-insensitive email lookup:

```sql
CREATE UNIQUE INDEX uq_users_email_lower
ON users (lower(email));
```

Query:

```sql
SELECT id
FROM users
WHERE lower(email) = lower($1);
```

Better: normalize email to canonical column if business semantics allow.

---

## 60. EXPLAIN and EXPLAIN ANALYZE

Use `EXPLAIN` to inspect query plan.

Use `EXPLAIN ANALYZE` to execute and show actual runtime.

Caution:

```text
EXPLAIN ANALYZE executes the query.
```

For writes, wrap in rollback if testing:

```sql
BEGIN;
EXPLAIN ANALYZE UPDATE ...
ROLLBACK;
```

Look at:

- sequential scan vs index scan;
- estimated rows vs actual rows;
- sort;
- nested loop;
- hash join;
- buffers if enabled;
- planning time;
- execution time.

---

## 61. Query Plan and Statistics

PostgreSQL planner relies on statistics.

After large load/backfill:

```sql
ANALYZE table_name;
```

Autovacuum/analyze may eventually run, but performance may be poor until stats updated.

For expression indexes, statistics matter too.

---

## 62. MVCC and Vacuum

PostgreSQL MVCC creates row versions.

Updates/deletes create dead tuples.

Long-running transactions can prevent cleanup.

Bulk updates/deletes can cause:

- table bloat;
- index bloat;
- vacuum pressure;
- slower scans;
- storage growth.

Design:

- chunk large updates;
- monitor vacuum;
- avoid long idle transactions;
- coordinate with DBA for heavy jobs.

---

## 63. Autovacuum Awareness

Do not disable autovacuum casually.

Bulk load/update/delete can require:

- manual `VACUUM`/`ANALYZE` plan;
- table-specific autovacuum tuning;
- partitioning;
- batch size control.

Application engineers should understand that write patterns affect PostgreSQL maintenance.

---

## 64. Partitioning

PostgreSQL partitioning can help:

- time-based audit/event tables;
- tenant partitioning;
- archival/drop old partitions;
- large data management.

Benefits:

- drop partition instead of huge delete;
- query pruning;
- maintenance isolation.

Costs:

- schema complexity;
- indexes per partition;
- query planner considerations;
- migration complexity.

Use when data volume/lifecycle justifies it.

---

## 65. Outbox Table PostgreSQL Design

Schema sketch:

```sql
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_by TEXT,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);
```

Indexes:

```sql
CREATE INDEX idx_outbox_pending
ON outbox_events (next_attempt_at, created_at)
WHERE status = 'PENDING';
```

Claim:

```sql
SELECT id
FROM outbox_events
WHERE status = 'PENDING'
  AND next_attempt_at <= now()
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT $1;
```

---

## 66. Inbox Table PostgreSQL Design

```sql
CREATE TABLE inbox_messages (
    message_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    last_error TEXT
);
```

Consumer:

```sql
INSERT INTO inbox_messages (message_id, source, status)
VALUES ($1, $2, 'STARTED')
ON CONFLICT (message_id) DO NOTHING;
```

Check affected rows.

---

## 67. Idempotency Table PostgreSQL Design

```sql
CREATE TABLE idempotency_records (
    scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    response_code INTEGER,
    result_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,

    PRIMARY KEY (scope, idempotency_key)
);
```

Optional partial index for cleanup:

```sql
CREATE INDEX idx_idempotency_created
ON idempotency_records (created_at);
```

---

## 68. Audit Table PostgreSQL Design

For high-volume audit:

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    metadata JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Indexes based on query:

```sql
CREATE INDEX idx_audit_tenant_created
ON audit_events (tenant_id, created_at DESC, id DESC);
```

For huge audit table, consider partitioning by time.

---

## 69. Advisory Lock Example in Go

```go
func WithCaseAdvisoryLock(ctx context.Context, tx *sql.Tx, caseID int64) error {
	_, err := tx.ExecContext(ctx, `
		SELECT pg_advisory_xact_lock($1)
	`, caseID)
	return err
}
```

Use inside transaction.

Caution:

- this locks by numeric key globally;
- avoid collisions with other advisory lock use;
- document key namespace.

Better key scheme may combine namespace and ID using two-int function if available.

---

## 70. Case Transition With RETURNING

```go
func (r CaseRepository) Approve(
	ctx context.Context,
	q DBTX,
	caseID int64,
) (int64, error) {
	var version int64

	err := q.QueryRowContext(ctx, `
		UPDATE cases
		SET status = 'APPROVED',
		    version = version + 1,
		    updated_at = now()
		WHERE id = $1
		  AND status = 'UNDER_REVIEW'
		RETURNING version
	`, caseID).Scan(&version)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrInvalidStateTransition
		}
		return 0, fmt.Errorf("case.approve: %w", err)
	}

	return version, nil
}
```

This is idiomatic PostgreSQL.

---

## 71. Insert Outbox With JSONB

```go
func (r OutboxRepository) Insert(ctx context.Context, q DBTX, e OutboxEvent) error {
	payload, err := json.Marshal(e.Payload)
	if err != nil {
		return fmt.Errorf("marshal outbox payload: %w", err)
	}

	_, err = q.ExecContext(ctx, `
		INSERT INTO outbox_events (
			id, event_type, aggregate_type, aggregate_id, payload, status
		)
		VALUES ($1, $2, $3, $4, $5::jsonb, 'PENDING')
	`, e.ID, e.EventType, e.AggregateType, e.AggregateID, payload)

	if err != nil {
		return fmt.Errorf("outbox.insert: %w", err)
	}

	return nil
}
```

Use stable event ID for idempotency.

---

## 72. Claim Outbox With SKIP LOCKED

```go
func (r OutboxRepository) Claim(
	ctx context.Context,
	tx *sql.Tx,
	workerID string,
	limit int,
) ([]uuid.UUID, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM outbox_events
		WHERE status = 'PENDING'
		  AND next_attempt_at <= now()
		ORDER BY created_at, id
		FOR UPDATE SKIP LOCKED
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("outbox.claim select: %w", err)
	}
	defer rows.Close()

	ids := make([]uuid.UUID, 0, limit)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("outbox.claim scan: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("outbox.claim rows: %w", err)
	}

	for _, id := range ids {
		_, err := tx.ExecContext(ctx, `
			UPDATE outbox_events
			SET status = 'PROCESSING',
			    claimed_by = $1,
			    claimed_at = now(),
			    updated_at = now()
			WHERE id = $2
			  AND status = 'PENDING'
		`, workerID, id)
		if err != nil {
			return nil, fmt.Errorf("outbox.claim update: %w", err)
		}
	}

	return ids, nil
}
```

This is simplified. Real code should check rows affected for update.

---

## 73. PostgreSQL Upsert for Idempotency

```go
func (r IdempotencyRepository) InsertStarted(
	ctx context.Context,
	q DBTX,
	scope string,
	key string,
	op string,
	hash string,
) (bool, error) {
	result, err := q.ExecContext(ctx, `
		INSERT INTO idempotency_records (
			scope, idempotency_key, operation_type, request_hash, status
		)
		VALUES ($1, $2, $3, $4, 'STARTED')
		ON CONFLICT (scope, idempotency_key) DO NOTHING
	`, scope, key, op, hash)
	if err != nil {
		return false, fmt.Errorf("idempotency.insert_started: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("idempotency.insert_started rows: %w", err)
	}

	return affected == 1, nil
}
```

If false, load existing record.

---

## 74. Bulk Insert With ON CONFLICT

```go
func InsertEvents(ctx context.Context, q DBTX, events []Event) error {
	if len(events) == 0 {
		return nil
	}

	var ph Placeholder
	var sb strings.Builder
	args := make([]any, 0, len(events)*3)

	sb.WriteString(`
		INSERT INTO events (id, aggregate_id, payload)
		VALUES
	`)

	for i, e := range events {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString("(")
		sb.WriteString(ph.Next())
		sb.WriteString(", ")
		sb.WriteString(ph.Next())
		sb.WriteString(", ")
		sb.WriteString(ph.Next())
		sb.WriteString("::jsonb)")

		payload, err := json.Marshal(e.Payload)
		if err != nil {
			return err
		}

		args = append(args, e.ID, e.AggregateID, payload)
	}

	sb.WriteString(`
		ON CONFLICT (id) DO NOTHING
	`)

	_, err := q.ExecContext(ctx, sb.String(), args...)
	return err
}
```

Batch size still needed.

---

## 75. PostgreSQL Full-Text Search

For text search, PostgreSQL has full-text search.

Basic concept:

```sql
to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', $1)
```

Use when:

- keyword search is core;
- LIKE is too slow/weak;
- ranking needed.

Needs:

- GIN index on tsvector expression or generated column;
- language/stemming decision;
- query syntax/UX design.

Do not improvise full-text in hot endpoint without plan.

---

## 76. Case-Insensitive Search

Options:

1. `ILIKE`;
2. `lower(column) = lower($1)` with expression index;
3. `citext` extension if appropriate;
4. normalized lowercase column.

For email, canonical normalized column is often best.

---

## 77. Pagination in PostgreSQL

Offset:

```sql
ORDER BY updated_at DESC, id DESC
LIMIT $1 OFFSET $2
```

Keyset:

```sql
WHERE tenant_id = $1
  AND (
      updated_at < $2
      OR (updated_at = $3 AND id < $4)
  )
ORDER BY updated_at DESC, id DESC
LIMIT $5
```

Index:

```sql
CREATE INDEX idx_cases_tenant_updated_id
ON cases (tenant_id, updated_at DESC, id DESC);
```

Include status if common filter:

```sql
CREATE INDEX idx_cases_tenant_status_updated_id
ON cases (tenant_id, status, updated_at DESC, id DESC);
```

---

## 78. Avoiding `SELECT *`

PostgreSQL row width affects IO and memory.

List endpoint:

```sql
SELECT id, reference_no, status, updated_at
```

not:

```sql
SELECT *
```

Especially avoid selecting:

- JSONB payload;
- bytea;
- large text;
- internal metadata;
- PII not needed.

---

## 79. `EXISTS` for Existence Check

Instead of:

```sql
SELECT COUNT(*)
FROM users
WHERE email = $1;
```

Use:

```sql
SELECT EXISTS (
    SELECT 1
    FROM users
    WHERE email = $1
);
```

Go:

```go
var exists bool
err := db.QueryRowContext(ctx, `
	SELECT EXISTS (
		SELECT 1 FROM users WHERE email = $1
	)
`, email).Scan(&exists)
```

Faster when you only need boolean.

---

## 80. Count Query

PostgreSQL `COUNT(*)` on large filtered datasets can be expensive.

For listing:

- use `limit+1` for hasNext;
- avoid exact count if not required;
- use approximate count/materialized summary for dashboards;
- use separate report path for expensive count.

---

## 81. Query Plan Stability

PostgreSQL planner chooses plan based on statistics and parameters.

Potential issues:

- stale statistics after bulk load;
- generic vs custom plan behavior;
- skewed data distribution;
- optional filters;
- parameterized queries.

If performance unstable:

- inspect `EXPLAIN (ANALYZE, BUFFERS)`;
- check statistics;
- consider extended statistics;
- rewrite query;
- split query paths;
- add partial indexes.

---

## 82. `ANALYZE` After Bulk Load

After loading many rows:

```sql
ANALYZE table_name;
```

This helps planner make better decisions.

In production, coordinate with DBA/autovacuum.

---

## 83. Migrations and PostgreSQL

PostgreSQL migrations need care:

- adding column with default;
- creating index concurrently;
- adding not null;
- validating constraints;
- enum changes;
- large table rewrites;
- lock levels.

Use expand/contract.

For large indexes:

```sql
CREATE INDEX CONCURRENTLY ...
```

But note:

- cannot run inside regular transaction block;
- migration tool must support it;
- failure leaves invalid index needing cleanup.

---

## 84. Constraints With NOT VALID

PostgreSQL can add some constraints as `NOT VALID` then validate later.

Pattern:

```sql
ALTER TABLE child
ADD CONSTRAINT fk_child_parent
FOREIGN KEY (parent_id) REFERENCES parent(id)
NOT VALID;

ALTER TABLE child
VALIDATE CONSTRAINT fk_child_parent;
```

Useful for large tables to reduce lock impact.

Know exact lock behavior before production migration.

---

## 85. UUID Generation

Options:

- app-generated UUID/ULID;
- PostgreSQL-generated UUID via functions/extensions;
- sequence/bigserial identity.

App-generated IDs often help:

- idempotency;
- bulk insert parent/child;
- outbox event ID;
- offline command creation.

DB-generated IDs are simple for many CRUD systems.

---

## 86. Sequences and Gaps

PostgreSQL sequences are not transactional in the intuitive “no gaps” sense.

Gaps can happen due to rollback/cache.

Do not use sequence number if legal/business requires gapless numbering unless you design special serialized number allocation with all trade-offs.

For display reference numbers, use dedicated design.

---

## 87. Gapless Numbering Warning

Gapless numbers cause contention.

If regulation requires gapless:

- allocate at final commit stage;
- serialize by scope;
- audit canceled/void numbers;
- consider legal acceptance of voided gaps;
- coordinate with business/compliance.

Do not assume `SERIAL`/sequence gives gapless numbers.

---

## 88. PostgreSQL and Generated Columns

Generated columns can help:

- normalized email;
- searchable field;
- active key;
- derived status order.

Example:

```sql
email_norm TEXT GENERATED ALWAYS AS (lower(email)) STORED
```

Then unique index on `email_norm`.

Check PostgreSQL version/features before use.

---

## 89. PostgreSQL and Row-Level Security

RLS can enforce tenant/security at DB level.

Pros:

- defense-in-depth;
- central policy;
- reduces accidental leak.

Cons:

- session variables/search_path issues;
- performance/policy complexity;
- connection pool session state;
- harder debugging;
- app must still handle auth.

If using RLS, design how app sets current tenant/user safely per transaction.

---

## 90. Connection Pool Sizing for PostgreSQL

PostgreSQL process-per-connection model means too many connections hurt memory/context switching.

Application pools across pods can exceed DB capacity.

Formula:

```text
total_connections = pods * pools_per_pod * max_open_conns
```

Reserve for:

- DBA/admin;
- migrations;
- monitoring;
- workers;
- replicas;
- failover.

Use external pooler if needed, but understand session-state/prepared-statement implications.

---

## 91. PostgreSQL Health Check

Readiness check:

```go
ctx, cancel := context.WithTimeout(ctx, 1*time.Second)
defer cancel()

err := db.PingContext(ctx)
```

Better app-level readiness may include:

```sql
SELECT 1
```

but do not run expensive queries.

Do not use health check to validate every table.

Classify errors:

- auth/config;
- timeout;
- connection refused;
- too many connections;
- TLS/cert.

---

## 92. Observability: PostgreSQL App Metrics

Metrics:

- db operation duration by operation;
- error class SQLSTATE category;
- rows returned/affected;
- transaction duration;
- pool stats;
- retry count;
- serialization failure count;
- deadlock count;
- lock timeout count;
- statement timeout count;
- outbox pending age;
- replication lag if visible.

Use stable low-cardinality labels.

---

## 93. Observability: PostgreSQL Server Views

Common views/tools:

- `pg_stat_activity`;
- `pg_stat_statements` extension;
- `pg_locks`;
- `pg_stat_user_tables`;
- `pg_stat_user_indexes`;
- `pg_stat_database`;
- `pg_stat_replication`;
- `EXPLAIN (ANALYZE, BUFFERS)`.

Your application should set `application_name` and operation comments/traces to aid diagnosis.

---

## 94. `pg_stat_activity`

Useful fields:

- pid;
- application_name;
- state;
- wait_event_type;
- wait_event;
- query;
- query_start;
- xact_start;
- backend_start;
- client_addr.

Runbook questions:

- any idle in transaction?
- which query is blocking?
- which app connection?
- how old is transaction?
- wait event lock or IO?

---

## 95. `pg_locks`

Use to diagnose blocking/locks.

Ask:

- who blocks whom?
- lock mode?
- relation?
- transaction age?
- application_name?

In app runbook, know how to escalate to DBA.

---

## 96. `pg_stat_statements`

If enabled, helps find:

- top total time queries;
- high mean time;
- high calls;
- rows returned;
- shared buffers hit/read;
- query fingerprint.

This is invaluable for read path tuning.

Do not rely only on app logs.

---

## 97. Deadlock Runbook

When SQLSTATE `40P01` spikes:

1. identify operation;
2. inspect logs/traces;
3. inspect DB deadlock logs if enabled;
4. check lock order;
5. check new deployment;
6. check batch jobs;
7. check missing indexes;
8. reduce concurrency;
9. retry whole transaction if safe;
10. fix root cause.

---

## 98. Serialization Failure Runbook

When SQLSTATE `40001` spikes:

1. confirm serializable transactions;
2. measure retry success;
3. inspect transaction duration;
4. inspect read/write set;
5. add indexes;
6. reduce contention;
7. use targeted locks/constraints if cheaper;
8. cap retry.

Serialization failure is not automatically outage if retry succeeds.

---

## 99. Lock Timeout Runbook

When lock timeout/`55P03` spikes:

1. find blockers;
2. inspect `pg_stat_activity`;
3. check idle-in-transaction;
4. check batch/migration;
5. check row hot spot;
6. check missing index;
7. reduce worker concurrency;
8. return conflict/retry-later if expected.

---

## 100. Statement Timeout Runbook

When query canceled/statement timeout spikes:

1. identify operation;
2. inspect plan;
3. check missing/stale stats;
4. check large offset/count/search;
5. check locks vs CPU/IO;
6. check recent data growth;
7. tune query/index;
8. adjust timeout only after understanding.

---

## 101. Connection Error Runbook

PostgreSQL connection errors can come from:

- DB down/restart/failover;
- network;
- DNS;
- TLS/cert;
- auth/secret rotation;
- too many connections;
- pooler issue.

Actions:

- classify error;
- reduce reconnect storm;
- backoff;
- pause workers;
- check pool stats;
- check DB max connections;
- verify credentials/certs.

---

## 102. Schema Drift Runbook

Errors:

- `42P01` undefined table;
- `42703` undefined column;
- `42601` syntax error.

Actions:

- stop rollout;
- verify migration version;
- rollback or apply migration;
- feature flag off;
- run integration migration tests;
- add startup schema compatibility check if needed.

Do not retry.

---

## 103. Testing PostgreSQL Integration

Use real PostgreSQL for repository tests.

Test:

- placeholder syntax;
- `RETURNING`;
- `ON CONFLICT`;
- SQLSTATE mapping;
- nullable/type scanning;
- JSONB;
- arrays if used;
- transaction rollback;
- lock behavior;
- serialization retry;
- deadlock classification;
- migration compatibility.

Mocks cannot prove PostgreSQL behavior.

---

## 104. Testcontainers / Docker

For integration tests:

- run PostgreSQL container;
- apply migrations;
- run repository tests;
- isolate schema/database per test package if needed;
- cleanup data;
- use timeouts.

Avoid tests depending on developer local DB state.

---

## 105. SQLSTATE Test: Unique Violation

```go
func TestClassifyUniqueViolation(t *testing.T) {
	ctx := context.Background()

	_, err := db.ExecContext(ctx, `
		INSERT INTO users (email) VALUES ($1)
	`, "a@example.com")
	if err != nil {
		t.Fatal(err)
	}

	_, err = db.ExecContext(ctx, `
		INSERT INTO users (email) VALUES ($1)
	`, "a@example.com")
	if err == nil {
		t.Fatal("expected duplicate")
	}

	class := classifier.Classify(err)
	if class.Class != ClassUniqueViolation {
		t.Fatalf("class=%s err=%v", class.Class, err)
	}
}
```

---

## 106. Test `ON CONFLICT DO NOTHING`

```go
func TestInsertIdempotencyStarted(t *testing.T) {
	ctx := context.Background()

	ok, err := repo.InsertStarted(ctx, db, "scope", "key", "op", "hash")
	if err != nil || !ok {
		t.Fatalf("first ok=%v err=%v", ok, err)
	}

	ok, err = repo.InsertStarted(ctx, db, "scope", "key", "op", "hash")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("second insert should not insert")
	}
}
```

---

## 107. Test Transaction Rollback

```go
func TestRollbackAuditOutbox(t *testing.T) {
	ctx := context.Background()

	err := txManager.Within(ctx, "case.approve", nil, func(ctx context.Context, tx *sql.Tx) error {
		if err := cases.Approve(ctx, tx, caseID); err != nil {
			return err
		}
		return errors.New("force rollback")
	})
	if err == nil {
		t.Fatal("expected error")
	}

	assertCaseNotApproved(t, db, caseID)
	assertNoAudit(t, db, caseID)
}
```

---

## 108. Test SKIP LOCKED

Use two transactions:

1. tx1 locks row with `FOR UPDATE`;
2. tx2 selects pending rows `FOR UPDATE SKIP LOCKED`;
3. assert locked row skipped.

Use timeouts to avoid hanging.

This must be integration test against PostgreSQL.

---

## 109. Test Serializable Retry

Create concurrent transactions causing serialization failure.

Assert:

- SQLSTATE `40001` classified;
- retry wrapper retries;
- final invariant holds.

Keep test deterministic with barriers where possible.

---

## 110. Migrations Test

Pipeline:

```text
start PostgreSQL
apply all migrations
run repository tests
rollback/forward migration if tool supports
```

Add tests for:

- constraints;
- indexes existence;
- enum/check allowed values;
- partial unique indexes;
- FK behavior;
- default timestamps.

---

## 111. PostgreSQL Anti-Patterns in Go

| Anti-pattern | Problem |
|---|---|
| using `?` placeholders accidentally | syntax/driver mismatch |
| relying on `LastInsertId` | not idiomatic PostgreSQL |
| no `application_name` | poor ops visibility |
| logging DSN password | secret leak |
| dynamic `search_path` in pool | cross-tenant/session leak |
| session-level settings not reset | surprising behavior |
| long idle transaction | bloat/locks |
| serializable without retry | random failures |
| `ON CONFLICT DO UPDATE` without semantics | silent overwrite |
| JSONB for everything | weak schema/performance |
| no SQLSTATE classifier | wrong retry/error mapping |
| `LISTEN/NOTIFY` as durable queue | lost messages |
| huge deletes instead of partition/drop/chunk | bloat/locks |
| no ANALYZE after large load | bad plans |
| too many app connections | DB memory/context switching |
| no integration tests | false confidence |

---

## 112. Production Checklist

### 112.1 Connection

- [ ] DSN built from validated config.
- [ ] Password redacted in logs.
- [ ] TLS/sslmode production-appropriate.
- [ ] `application_name` set.
- [ ] `connect_timeout` configured.
- [ ] Pool size budgeted across pods.
- [ ] Connection lifetime/idle time set.
- [ ] Ping/readiness has timeout.

### 112.2 SQL

- [ ] `$n` placeholders used correctly.
- [ ] Values bound, identifiers allowlisted.
- [ ] `RETURNING` used for generated IDs.
- [ ] `Rows.Close` and `Rows.Err` handled.
- [ ] `RowsAffected`/`ErrNoRows` mapped.
- [ ] No `SELECT *` in hot paths.
- [ ] Query names observable.

### 112.3 Transactions

- [ ] Service owns transaction boundary.
- [ ] Serializable transactions retry `40001`.
- [ ] Deadlock `40P01` retry safe.
- [ ] Local statement/lock timeout used where needed.
- [ ] No external side effect inside transaction.
- [ ] Idle transaction avoided.

### 112.4 Types

- [ ] `timestamptz` semantics clear.
- [ ] Numeric/money avoids `float64`.
- [ ] JSONB usage intentional.
- [ ] UUID strategy chosen.
- [ ] Enum/check evolution planned.
- [ ] Nullable mapping explicit.

### 112.5 Performance

- [ ] Indexes match query patterns.
- [ ] Partial/expression indexes used where helpful.
- [ ] `EXPLAIN` reviewed for hot queries.
- [ ] Large offset avoided/capped.
- [ ] Count strategy reviewed.
- [ ] Bulk load uses COPY/staging where appropriate.
- [ ] ANALYZE plan after bulk load.

### 112.6 Operations

- [ ] SQLSTATE classifier implemented.
- [ ] pg_stat_activity usable via application_name.
- [ ] pg_stat_statements enabled/available if possible.
- [ ] Lock/deadlock/timeout metrics.
- [ ] Vacuum/bloat awareness.
- [ ] Migration lock strategy.
- [ ] Runbooks for deadlock, lock timeout, schema drift, connection outage.

---

## 113. Mini Case Study: Case Approval in PostgreSQL

Requirement:

```text
Approve case only from UNDER_REVIEW.
Return new version.
Insert audit and outbox.
Retry safe with idempotency.
```

Design:

```text
BEGIN
INSERT idempotency ... ON CONFLICT DO NOTHING
if duplicate -> load existing result
UPDATE cases ... WHERE status='UNDER_REVIEW' RETURNING version
INSERT audit
INSERT outbox JSONB payload
UPDATE idempotency success
COMMIT
```

PostgreSQL features:

- `ON CONFLICT DO NOTHING`;
- `RETURNING`;
- JSONB;
- SQLSTATE classifier;
- transaction;
- unique constraints.

---

## 114. Mini Case Study: Outbox Worker

Requirement:

```text
Many workers publish pending outbox events safely.
```

Design:

```text
BEGIN
SELECT id FROM outbox
WHERE status='PENDING' AND next_attempt_at <= now()
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 100
UPDATE selected rows to PROCESSING
COMMIT
publish outside tx
mark SENT or FAILED
```

PostgreSQL features:

- partial index on pending;
- `FOR UPDATE SKIP LOCKED`;
- JSONB payload;
- transaction;
- optional LISTEN/NOTIFY wakeup.

---

## 115. Mini Case Study: User Import

Requirement:

```text
Import millions of users from CSV.
Deduplicate by source_id.
Reject invalid rows.
```

Design:

```text
COPY CSV into staging
validate staging
mark rejects
INSERT INTO users SELECT ... FROM staging
ON CONFLICT (source_id) DO UPDATE ...
ANALYZE if needed
record import stats
```

PostgreSQL features:

- COPY;
- staging table;
- ON CONFLICT;
- SQL validation queries;
- indexes;
- ANALYZE.

---

## 116. Mini Case Study: Active Assignment Constraint

Requirement:

```text
Only one active officer assignment per case.
```

PostgreSQL design:

```sql
CREATE UNIQUE INDEX uq_active_assignment_per_case
ON case_assignments(case_id)
WHERE status = 'ACTIVE';
```

App:

```sql
INSERT INTO case_assignments(...)
VALUES (...)
```

If SQLSTATE `23505` on `uq_active_assignment_per_case`:

```text
ErrCaseAlreadyAssigned
```

This is stronger than application pre-check.

---

## 117. Mini Case Study: Audit Log Listing

Requirement:

```text
List audit events newest first with cursor.
```

Query:

```sql
SELECT id, action, actor_id, created_at
FROM audit_events
WHERE tenant_id = $1
  AND (
      created_at < $2
      OR (created_at = $3 AND id < $4)
  )
ORDER BY created_at DESC, id DESC
LIMIT $5;
```

Index:

```sql
CREATE INDEX idx_audit_tenant_created_id
ON audit_events (tenant_id, created_at DESC, id DESC);
```

For huge table, consider time partitioning.

---

## 118. Efficient Learning Summary

PostgreSQL is not “just another SQL database”.

For Go engineers, excellent PostgreSQL integration means:

```text
database/sql discipline
+ pgx knowledge
+ PostgreSQL SQL features
+ SQLSTATE classification
+ transaction/isolation awareness
+ index/query planner literacy
+ operational maturity
```

Best default rules:

1. Use `pgx/stdlib` with `database/sql` for generic repository paths.
2. Use pgx native for COPY/LISTEN/specialized PostgreSQL paths.
3. Use `$1`, `$2` placeholders.
4. Use `RETURNING` instead of `LastInsertId`.
5. Use constraints/partial indexes for invariants.
6. Use `ON CONFLICT` only with clear business semantics.
7. Classify SQLSTATE structurally.
8. Use `FOR UPDATE SKIP LOCKED` for queue claims carefully.
9. Prefer transaction-scoped advisory locks if needed.
10. Set `application_name`.
11. Avoid session state leaks in pooled connections.
12. Read `EXPLAIN` for hot queries.
13. Design bulk load with COPY/staging when needed.
14. Treat LISTEN/NOTIFY as wakeup, not durable queue.
15. Test against real PostgreSQL.

If you remember one sentence:

> `database/sql` gives you the pipe; PostgreSQL-specific engineering is knowing what flows through that pipe and how the server actually behaves.

---

## 119. Latihan

### Exercise 1 — Generated ID

You insert a user and need the generated ID.

Question:

- Why should you not rely on `LastInsertId`?
- What PostgreSQL feature should you use?

### Exercise 2 — Duplicate Active Assignment

Requirement:

```text
Only one ACTIVE assignment per case.
```

Question:

- How can PostgreSQL enforce this?
- What error class should app map?

### Exercise 3 — Outbox Worker

Multiple workers claim outbox rows.

Question:

- What PostgreSQL locking feature helps?
- What index would you consider?

### Exercise 4 — Bulk Import

Import 5 million rows.

Question:

- Why might COPY + staging be better than multi-row INSERT?
- What does staging give you?

### Exercise 5 — Serializable

A serializable transaction fails with SQLSTATE `40001`.

Question:

- What should the app do?
- What must transaction body avoid?

### Exercise 6 — LISTEN/NOTIFY

You want reliable event delivery.

Question:

- Why is LISTEN/NOTIFY insufficient as durable queue?
- What pattern should be source of truth?

---

## 120. Jawaban Singkat Latihan

### Exercise 1

`LastInsertId` is not the idiomatic/portable PostgreSQL approach and may not be supported by the driver. Use:

```sql
INSERT ... RETURNING id
```

and `QueryRowContext(...).Scan(&id)`.

### Exercise 2

Use partial unique index:

```sql
CREATE UNIQUE INDEX uq_active_assignment_per_case
ON case_assignments(case_id)
WHERE status = 'ACTIVE';
```

Map SQLSTATE `23505` on that constraint to domain conflict such as `ErrCaseAlreadyAssigned`.

### Exercise 3

Use:

```sql
FOR UPDATE SKIP LOCKED
```

Consider partial index:

```sql
CREATE INDEX idx_outbox_pending
ON outbox_events (next_attempt_at, created_at)
WHERE status = 'PENDING';
```

### Exercise 4

COPY has much lower bulk load overhead. Staging allows validation, reject reporting, deduplication, transformation, and controlled merge/upsert into target.

### Exercise 5

Retry the whole transaction with bounded backoff. Transaction body must avoid external side effects and must be safe to rerun.

### Exercise 6

LISTEN/NOTIFY is not durable; notifications can be missed if listener disconnects and payload is limited. Use outbox table as source of truth; NOTIFY can wake workers that then read outbox.

---

## 121. Ringkasan

PostgreSQL gives Go engineers a very rich database platform.

To use it well:

- keep Go boundaries clean;
- use `database/sql` where it fits;
- use pgx native where PostgreSQL-specific feature matters;
- model errors with SQLSTATE;
- use PostgreSQL constraints and indexes to enforce correctness;
- use `RETURNING`, `ON CONFLICT`, `COPY`, `SKIP LOCKED`, advisory locks, and JSONB intentionally;
- understand MVCC, vacuum, isolation, and query plans;
- build operational visibility with `application_name`, metrics, traces, and PostgreSQL views.

This is the point where a Go engineer stops treating database as a black box and starts using PostgreSQL as a powerful part of system design.

---

## 122. Referensi

- Go package documentation — `database/sql`: <https://pkg.go.dev/database/sql>
- Go documentation — Querying for data: <https://go.dev/doc/database/querying>
- Go documentation — Avoiding SQL injection risk: <https://go.dev/doc/database/sql-injection>
- Go documentation — Executing transactions: <https://go.dev/doc/database/execute-transactions>
- pgx package documentation: <https://pkg.go.dev/github.com/jackc/pgx/v5>
- pgx stdlib documentation: <https://pkg.go.dev/github.com/jackc/pgx/v5/stdlib>
- PostgreSQL documentation — libpq connection strings: <https://www.postgresql.org/docs/current/libpq-connect.html>
- PostgreSQL documentation — INSERT: <https://www.postgresql.org/docs/current/sql-insert.html>
- PostgreSQL documentation — COPY: <https://www.postgresql.org/docs/current/sql-copy.html>
- PostgreSQL documentation — Transaction Isolation: <https://www.postgresql.org/docs/current/transaction-iso.html>
- PostgreSQL documentation — Explicit Locking: <https://www.postgresql.org/docs/current/explicit-locking.html>
- PostgreSQL documentation — Error Codes: <https://www.postgresql.org/docs/current/errcodes-appendix.html>
- PostgreSQL documentation — EXPLAIN: <https://www.postgresql.org/docs/current/sql-explain.html>
- PostgreSQL documentation — Indexes: <https://www.postgresql.org/docs/current/indexes.html>

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-sql-database-integration-part-025.md">⬅️ Read Path Performance and Query Efficiency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-sql-database-integration-part-027.md">Specific Integration: MySQL / MariaDB ➡️</a>
</div>

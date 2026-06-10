# Strict Coding Standards — Go + ClickHouse

> **Scope**: Mandatory implementation standards for Go code that writes to or reads from ClickHouse. This file is a merge gate for LLM/code-agent generated implementation.
>
> **Primary client baseline**: `github.com/ClickHouse/clickhouse-go/v2` unless the project explicitly chooses another driver through an architecture decision record.
>
> **Core model**: ClickHouse is an analytical, column-oriented database optimized for append-heavy ingestion and large analytical scans. Treat it as OLAP/time-series/analytics storage, not as a transactional OLTP source of truth.

---

## 1. Source Authority

The agent MUST prefer these authorities, in this order:

1. Existing project conventions and architecture decision records.
2. Official ClickHouse documentation.
3. Official `clickhouse-go/v2` package documentation and examples.
4. Go `context`, `database/sql`, `time`, `net`, and telemetry package documentation.
5. Project-specific database/platform standards.

The agent MUST NOT invent behavior for ClickHouse engines, replication, deduplication, partitioning, TTL, or consistency. If a behavior is engine-specific, the generated code or design note MUST say so explicitly.

---

## 2. Non-Negotiable Rules

1. Go code MUST treat ClickHouse operations as bounded, context-aware I/O.
2. Every query, insert, ping, batch preparation, and connection operation MUST receive `context.Context` from caller.
3. The code MUST NOT use ClickHouse as the authority for business transactions unless the system design explicitly approves that use.
4. Insert paths MUST be batch-oriented by default. Per-row inserts are forbidden for production ingestion unless the use case is explicitly low volume.
5. Query paths MUST be projection-explicit; `SELECT *` is forbidden in application code.
6. The code MUST close rows, release batches by send/fail path, and handle all returned errors.
7. Schema, engine, partitioning, ordering, TTL, and materialized view choices MUST live in migrations/infrastructure code, not hidden in repository methods.
8. Dynamic SQL identifiers MUST come from allowlisted constants, never raw user input.
9. The code MUST distinguish ingestion retry safety from query retry safety.
10. All high-cardinality labels, raw SQL, secrets, credentials, tokens, and PII MUST be redacted from logs and traces.

---

## 3. Client Selection

### 3.1 Preferred client

Use `clickhouse-go/v2` native API for performance-sensitive ingestion and ClickHouse-specific features.

```go
import clickhouse "github.com/ClickHouse/clickhouse-go/v2"
```

### 3.2 `database/sql` compatibility

`database/sql` MAY be used when:

- the project needs generic SQL abstraction,
- the code path is not ingestion-heavy,
- ClickHouse-specific features are not required,
- the team accepts the performance/feature trade-off.

The agent MUST NOT default to `database/sql` simply because it is familiar.

### 3.3 Forbidden client behavior

The agent MUST NOT:

- create a new client per request,
- hide client construction inside repository methods,
- use global mutable clients without explicit lifecycle,
- mix multiple ClickHouse clients in one package without a documented reason,
- bypass project TLS/auth/observability configuration.

---

## 4. Configuration

ClickHouse configuration MUST be explicit and injected.

Required config fields:

```go
type ClickHouseConfig struct {
    Addr              []string
    Database          string
    Username          string
    Password          string
    TLS               TLSConfig
    MaxOpenConns      int
    MaxIdleConns      int
    ConnMaxLifetime   time.Duration
    DialTimeout       time.Duration
    QueryTimeout      time.Duration
    InsertTimeout     time.Duration
    Compression       string
    ApplicationName   string
}
```

Configuration MUST NOT be read directly inside domain/application services.

---

## 5. Connection Lifecycle

Client initialization MUST happen in composition/bootstrap code.

```go
func NewClickHouseConn(cfg ClickHouseConfig) (clickhouse.Conn, error) {
    opts := &clickhouse.Options{
        Addr: cfg.Addr,
        Auth: clickhouse.Auth{
            Database: cfg.Database,
            Username: cfg.Username,
            Password: cfg.Password,
        },
        DialTimeout: cfg.DialTimeout,
        MaxOpenConns: cfg.MaxOpenConns,
        MaxIdleConns: cfg.MaxIdleConns,
        ConnMaxLifetime: cfg.ConnMaxLifetime,
        ClientInfo: clickhouse.ClientInfo{
            Products: []struct {
                Name    string
                Version string
            }{{Name: cfg.ApplicationName, Version: "unknown"}},
        },
    }

    conn, err := clickhouse.Open(opts)
    if err != nil {
        return nil, fmt.Errorf("open clickhouse: %w", err)
    }
    return conn, nil
}
```

A startup health check MAY use `Ping(ctx)`, but MUST have a bounded timeout.

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
if err := conn.Ping(ctx); err != nil {
    return fmt.Errorf("ping clickhouse: %w", err)
}
```

---

## 6. Context and Timeout Rules

Each public method MUST accept `context.Context` as first parameter.

```go
func (r *EventRepository) InsertEvents(ctx context.Context, events []Event) error
```

The repository MUST NOT create broad background contexts. Timeout ownership belongs to the caller/application layer unless repository has a specific lower-level defensive cap.

Forbidden:

```go
ctx := context.Background()
err := r.conn.Exec(ctx, query)
```

Allowed:

```go
ctx, cancel := context.WithTimeout(ctx, r.insertTimeout)
defer cancel()
```

Only use local timeout wrapping if it narrows a caller-provided context. It MUST NOT detach from caller cancellation.

---

## 7. Ingestion Rules

### 7.1 Batch insert by default

Production insert paths MUST use batch insertion for multiple rows.

```go
func (r *MetricWriter) Insert(ctx context.Context, rows []MetricRow) error {
    if len(rows) == 0 {
        return nil
    }

    batch, err := r.conn.PrepareBatch(ctx, `
        INSERT INTO metric_events
        (tenant_id, event_time, metric_name, value, labels_json)
    `)
    if err != nil {
        return fmt.Errorf("prepare clickhouse batch metric_events: %w", err)
    }

    for i := range rows {
        row := rows[i]
        if err := batch.Append(
            row.TenantID,
            row.EventTime.UTC(),
            row.MetricName,
            row.Value,
            row.LabelsJSON,
        ); err != nil {
            return fmt.Errorf("append clickhouse batch metric_events row=%d: %w", i, err)
        }
    }

    if err := batch.Send(); err != nil {
        return fmt.Errorf("send clickhouse batch metric_events rows=%d: %w", len(rows), err)
    }
    return nil
}
```

### 7.2 Batch size

The agent MUST define batch size based on:

- row width,
- latency budget,
- memory budget,
- retry cost,
- ClickHouse cluster capacity,
- downstream deduplication/idempotency strategy.

The agent MUST NOT hardcode arbitrary large batches without config.

### 7.3 Retry safety

Insert retry is safe only if the write path is idempotent or duplicate-tolerant.

The agent MUST document one of:

- unique event ID + deduplication strategy,
- `ReplacingMergeTree`/engine-specific dedup semantics,
- idempotent aggregation design,
- exactly-once upstream outbox semantics,
- explicit acceptance of duplicates.

If none exists, the agent MUST NOT silently retry writes after ambiguous failures.

---

## 8. Query Rules

### 8.1 Projection explicitness

Forbidden:

```sql
SELECT * FROM audit_events WHERE tenant_id = $1
```

Required:

```sql
SELECT event_time, actor_id, action, resource_id, outcome
FROM audit_events
WHERE tenant_id = ? AND event_time >= ? AND event_time < ?
ORDER BY event_time DESC
LIMIT ?
```

### 8.2 Bounded query

Every user/API-facing query MUST have a bound:

- tenant filter,
- time range,
- limit,
- pagination/cursor,
- aggregation window,
- or administrative approval for full scan.

### 8.3 Query API shape

Repository methods MUST express query intent through typed parameters.

```go
type AuditEventQuery struct {
    TenantID string
    From     time.Time
    To       time.Time
    Limit    int
    Cursor   *AuditCursor
}
```

Do not pass raw SQL fragments from handlers.

---

## 9. SQL Construction

Values MUST be bound parameters.

Dynamic identifiers MUST use allowlists.

```go
type SortField string

const (
    SortByEventTime SortField = "event_time"
    SortByActorID   SortField = "actor_id"
)

func sortColumn(field SortField) (string, error) {
    switch field {
    case SortByEventTime:
        return "event_time", nil
    case SortByActorID:
        return "actor_id", nil
    default:
        return "", fmt.Errorf("unsupported sort field: %q", field)
    }
}
```

Forbidden:

```go
query := "SELECT " + userSelectedColumns + " FROM " + userTable
```

---

## 10. Data Type Mapping

The code MUST define explicit mapping rules for:

- `DateTime` / `DateTime64` ↔ `time.Time`,
- `Date` ↔ domain date-only type,
- `Decimal` ↔ integer minor unit or decimal library,
- `Nullable(T)` ↔ pointer/nullable wrapper,
- `Array(T)` ↔ slice with nil/empty semantics documented,
- `Map`/`JSON`/`Object` ↔ explicit DTO/value object,
- `LowCardinality(String)` ↔ string at API boundary,
- `UUID` ↔ explicit UUID type,
- `Enum` ↔ named Go type with validation.

The agent MUST NOT map money to `float64`.

The agent MUST NOT map unknown nullable values to zero values without preserving null semantics.

---

## 11. Time and Time Zone Rules

1. Event timestamps MUST be stored in UTC unless the schema explicitly requires local time.
2. Application code MUST call `t.UTC()` before inserts when timestamp is an instant.
3. Date-only values MUST NOT be represented as midnight in local time without a domain type.
4. Query windows MUST use half-open intervals: `[from, to)`.
5. User time-zone conversion MUST happen at the boundary, not inside repository methods.

Required:

```sql
WHERE event_time >= ? AND event_time < ?
```

Avoid:

```sql
WHERE toDate(event_time) = ?
```

unless the partition/query design explicitly requires it and performance is verified.

---

## 12. Schema and Engine Awareness

The agent MUST NOT create ClickHouse tables casually from application code.

DDL belongs in migrations/infrastructure.

Every table design MUST document:

- engine,
- partition key,
- order key,
- primary key semantics,
- TTL policy,
- replication/distributed table behavior,
- materialized views,
- deduplication expectations,
- retention and deletion strategy,
- expected query patterns.

Application code MUST be aware that ClickHouse primary key/order key semantics are not the same as OLTP unique constraints.

---

## 13. Mutations, Deletes, and Updates

The agent MUST treat ClickHouse updates/deletes/mutations as operationally expensive unless the project has measured and approved them.

Forbidden by default:

- per-request update-as-business-transaction,
- delete-per-row from API handler,
- mutation for normal state transitions,
- using ClickHouse as mutable workflow state store.

Preferred:

- append new facts/events,
- correct via compensating rows,
- use source-of-truth OLTP store for mutable state,
- rebuild projections/materialized views when necessary.

---

## 14. Error Handling

Every ClickHouse error MUST be wrapped with operation and table/query intent.

```go
return fmt.Errorf("query clickhouse audit_events by tenant/time: %w", err)
```

Do not include:

- full DSN,
- password,
- raw unredacted SQL with secrets,
- PII values,
- full payload rows.

The code SHOULD classify:

- context cancellation/deadline,
- connection errors,
- authentication/authorization errors,
- syntax/schema mismatch,
- type conversion errors,
- timeout/resource errors,
- ambiguous insert errors.

---

## 15. Observability

Each operation SHOULD emit:

- operation name,
- table name or logical dataset,
- row count for insert,
- result count for query,
- duration,
- error class,
- retry count,
- timeout/cancel signal,
- tenant only if cardinality policy allows it.

Metrics MUST NOT label by raw SQL, user ID, object ID, event ID, or arbitrary query text.

Trace spans MUST redact query values. Use parameterized query metadata, not payload dumps.

---

## 16. Security Rules

1. Credentials MUST come from secret manager/config provider, never source code.
2. TLS MUST be enabled for non-local environments.
3. SQL identifiers MUST be allowlisted.
4. User input MUST NOT control database, table, column, function, format, or cluster name.
5. Row-level tenancy MUST be enforced in query construction or database design.
6. Logs MUST NOT include full rows when rows may contain PII/secrets.
7. Export/download queries MUST have authorization, size, and time bounds.

---

## 17. Repository Design

ClickHouse repositories MUST be named by read/write intent.

Good:

```go
type MetricEventWriter struct { conn clickhouse.Conn }
type AuditEventReader struct { conn clickhouse.Conn }
```

Avoid:

```go
type ClickHouseRepository struct{}
type AnalyticsServiceImpl struct{}
```

Repository methods MUST return domain/read-model types, not driver-specific structs.

---

## 18. Testing Rules

Unit tests MUST cover:

- query parameter validation,
- identifier allowlist,
- time range normalization,
- DTO-to-row mapping,
- nullable/zero/empty mapping,
- error wrapping,
- retry classification.

Integration tests SHOULD cover:

- real ClickHouse container/ephemeral instance,
- batch insert and query back,
- nullable/array/decimal/time types,
- context cancellation/timeout,
- schema mismatch failure,
- duplicate/retry behavior,
- large batch memory behavior.

The agent MUST NOT mock ClickHouse so heavily that SQL and type mappings are never exercised.

---

## 19. Benchmarking Rules

Benchmarks MUST declare:

- row width,
- batch size,
- compression setting,
- client protocol,
- number of concurrent writers,
- ClickHouse version/environment,
- table engine/schema,
- measured throughput and latency percentiles.

The agent MUST NOT claim performance improvement without benchmark evidence.

---

## 20. Anti-Patterns

Forbidden unless explicitly approved:

```go
// Per-row insert in production ingestion loop.
for _, row := range rows {
    _ = conn.Exec(ctx, "INSERT INTO events VALUES (?, ?)", row.A, row.B)
}
```

```go
// Unbounded query from API request.
rows, _ := conn.Query(ctx, "SELECT * FROM events")
```

```go
// Raw user SQL.
rows, _ := conn.Query(ctx, r.URL.Query().Get("sql"))
```

```go
// ClickHouse as mutable workflow state machine.
UPDATE cases SET status = 'APPROVED' WHERE id = ?
```

```go
// Silent insert retry without idempotency.
for i := 0; i < 3; i++ {
    if err := batch.Send(); err == nil { return nil }
}
```

---

## 21. LLM Merge Checklist

Before producing or modifying Go + ClickHouse code, the agent MUST verify:

- [ ] Context is propagated and bounded.
- [ ] Client is injected, not constructed per operation.
- [ ] Insert path uses batch when row count can exceed one.
- [ ] Retry semantics are documented and idempotent/duplicate-tolerant.
- [ ] Query has explicit projection and bounded filter.
- [ ] No `SELECT *` in application code.
- [ ] Dynamic identifiers use allowlists.
- [ ] Time values are normalized and interval semantics are clear.
- [ ] Nullable/decimal/array/JSON mappings preserve semantics.
- [ ] Rows are closed and `rows.Err()` is checked.
- [ ] Errors are wrapped without leaking secrets/PII.
- [ ] Metrics/traces/logs have bounded cardinality.
- [ ] Tests cover mapping, timeout, error, and integration behavior.
- [ ] Performance claims include benchmark evidence.

# Strict Coding Standards — Go QuestDB

Status: Mandatory  
Scope: Go services writing to or querying QuestDB for time-series, telemetry, market data, audit timeline, metrics-like facts, operational events, and analytical workloads.  
Audience: LLM code agents, developers, reviewers, data engineers, observability engineers, and platform maintainers.  
Baseline: Go 1.24+; compatible with Go 1.25/1.26 standards in this repository.

---

## 1. Purpose

QuestDB is optimized for high-throughput time-series ingestion and analytical SQL over time-indexed data. Go code that writes to QuestDB must not treat it like an OLTP database, a generic PostgreSQL clone, or a transactional source of truth.

This standard governs:

- QuestDB Go ingestion client usage.
- InfluxDB Line Protocol (ILP) ingestion behavior.
- PGWire querying via Go PostgreSQL-compatible drivers.
- Schema, timestamp, partition, symbol, and column modelling.
- Batch, flush, retry, and backpressure policy.
- Query semantics, time bounds, and large-result handling.
- Security, observability, and testing.

---

## 2. Source authority

Primary references:

- QuestDB Go client documentation.
- QuestDB ILP ingestion overview.
- QuestDB PGWire overview and Go PGWire guidance.
- QuestDB SQL/data-type documentation.
- Go standards in this repository for context, time/date, database SQL, telemetry, JSON, validation, I/O, and error handling.

Important baseline from QuestDB docs:

- The official Go client is designed for high-performance insert-only ingestion.
- ILP is an ingestion-only protocol, not a query protocol.
- QuestDB recommends PostgreSQL-compatible clients such as `pgx` for querying via PGWire.
- PGWire `INSERT` is suitable only for lower-volume ingestion; high-throughput ingestion should use QuestDB clients/ILP.

---

## 3. Non-negotiable rules

1. MUST NOT use QuestDB as an OLTP source of truth unless the architecture explicitly accepts its time-series/analytical semantics.
2. MUST NOT use PGWire `INSERT` for high-throughput ingestion when the official ILP Go client is appropriate.
3. MUST NOT query through the ILP ingestion client; use PGWire or HTTP query endpoint.
4. MUST NOT write events without a clear timestamp policy.
5. MUST NOT allow unbounded cardinality in symbol/tag-like columns.
6. MUST NOT perform unbounded queries without time range, limit, or streaming/export policy.
7. MUST NOT hide failed flush/write errors; ingestion loss must be observable.
8. MUST NOT treat automatic table/column creation as a substitute for schema governance in production.
9. MUST NOT store secrets or sensitive payloads in raw time-series columns without project approval.
10. MUST NOT use QuestDB for workflow correctness, authorization decisions, or transactional invariants.
11. MUST NOT assume full PostgreSQL feature compatibility; QuestDB supports PGWire for client connectivity but has different storage and SQL behavior.

---

## 4. Client selection

Use separate adapters for ingestion and query.

Required:

```go
type TimeSeriesWriter interface {
    WriteCaseEvent(ctx context.Context, event CaseTimelineEvent) error
    Flush(ctx context.Context) error
    Close() error
}

type TimeSeriesQuery interface {
    QueryCaseTimeline(ctx context.Context, q CaseTimelineQuery) ([]CaseTimelineRow, error)
}
```

Rules:

- Ingestion adapter uses QuestDB Go ILP client.
- Query adapter uses `pgx`, `database/sql` PostgreSQL-compatible driver, or approved HTTP query client.
- Application/domain code MUST NOT depend on QuestDB client structs.
- Ingestion and query clients MUST have independent timeout, pool, and retry policy.

---

## 5. Configuration

Required ingestion config:

- Protocol/transport: ILP over HTTP or TCP according to project decision.
- Endpoint(s).
- Authentication/token/TLS settings.
- Flush interval or batch size.
- Retry policy.
- Health check policy.
- Max buffered rows/bytes.
- Backpressure behavior.
- Default timestamp behavior.

Required query config:

- PGWire DSN or HTTP endpoint.
- TLS and auth settings.
- Query timeout.
- Max rows / streaming threshold.
- Pool config where using PGWire.

Secrets MUST be loaded via secret management and never printed.

---

## 6. Data modelling

Every table MUST have an explicit modelling decision.

Required table contract:

- Table name.
- Timestamp column name.
- Timestamp unit/source.
- Partition strategy.
- Symbol columns and allowed cardinality.
- Numeric precision policy.
- Text column limits.
- Retention policy.
- Deduplication/upsert expectations, if any.
- Consumer/query patterns.

Time-series modelling rules:

- Use timestamp as event time unless ingestion time is intentionally required.
- Use UTC instants for cross-system events.
- Keep high-cardinality identifiers out of symbol columns unless approved.
- Keep large JSON blobs out of hot analytical tables.
- Model domain events as append-only facts.
- Do not update/delete rows as part of normal OLTP behavior.

---

## 7. Timestamp rules

Timestamp handling is critical.

The LLM MUST define:

- Event time vs ingestion time.
- Source clock.
- Timezone policy.
- Precision: ns/us/ms/s.
- Behavior for missing timestamp.
- Behavior for future timestamp.
- Behavior for out-of-order timestamp.

Required:

```go
type QuestTimestamp struct {
    Time   time.Time
    Source string // event_time, observed_at, ingested_at
}
```

Forbidden:

```go
time.Now() // hidden inside mapper without explicit policy
```

Allowed only when the table contract says ingestion time is the source of truth.

---

## 8. Ingestion rules

ILP ingestion MUST be append-oriented and bounded.

Rules:

- Use the official Go ingestion client for high-throughput writes.
- Batch writes according to latency and memory budget.
- Flush on shutdown.
- Capture and surface flush errors.
- Use bounded channel/buffer if wrapping ingestion asynchronously.
- Apply backpressure rather than unbounded memory growth.
- Validate table/column names before writing.
- Sanitize dynamic identifiers; never use raw user input as table or column name.
- Use typed mapper from domain event to ILP row.

Forbidden:

```go
func WriteAny(table string, fields map[string]any) error
```

Preferred:

```go
func (w *Writer) WriteInspectionMetric(ctx context.Context, e InspectionMetric) error {
    if err := e.Validate(); err != nil {
        return err
    }
    row := mapInspectionMetric(e)
    return w.writeRow(ctx, row)
}
```

---

## 9. Backpressure and failure policy

Ingestion code MUST define what happens when QuestDB is unavailable.

Allowed strategies:

- Fail caller immediately.
- Buffer bounded in memory and fail on overflow.
- Persist to durable local/outbox queue.
- Send to Kafka/SQS for later ingestion.
- Drop only for explicitly lossy telemetry with drop metrics.

Forbidden:

- Infinite retry loop.
- Unbounded goroutine/channel buffering.
- Silent drop.
- Logging-only failure handling.

Retry rules:

- Retry only retryable connection/server errors.
- Use context deadline.
- Use jittered backoff.
- Preserve row ordering only if the query semantics require it.
- Emit dropped/retried/failed metrics.

---

## 10. Schema governance

QuestDB supports convenient schema behavior, but production code MUST still govern schema.

Rules:

- New tables require schema contract review.
- New columns require compatibility review.
- Type changes require migration/backfill plan.
- Symbol cardinality must be reviewed.
- Table names and column names must be constants or generated from allowlists.
- Automatic table/column creation may be enabled only when environment policy allows it.

Forbidden:

- Arbitrary tenant ID as table name.
- Arbitrary metric name as column name.
- Dynamic column explosion from JSON keys.

---

## 11. Query rules via PGWire

QuestDB PGWire queries MUST follow the Go PostgreSQL standard plus QuestDB-specific restrictions.

Rules:

- Use context-aware queries.
- Parameterize values.
- Never string-concatenate untrusted SQL.
- Apply time range in WHERE for time-series tables.
- Use limit/windowing for user-facing queries.
- Stream large result sets.
- Check `rows.Err()`.
- Close rows.
- Map rows into typed read models.
- Avoid assuming PostgreSQL-only features unless tested on QuestDB.

Preferred:

```go
rows, err := q.pool.Query(ctx, `
    SELECT ts, case_id, event_type, duration_ms
    FROM case_timeline
    WHERE ts >= $1 AND ts < $2 AND case_id = $3
    ORDER BY ts ASC
    LIMIT $4
`, from, to, caseID, limit)
```

---

## 12. Precision and data types

Rules:

- Use integer minor units for money.
- Use `int64` for durations and counts where range matters.
- Use float only for measurements where approximation is acceptable.
- Use UTC `time.Time` for timestamps.
- Do not use string for numeric fields unless required by source contract.
- Validate NaN/Inf before writing floats.
- Define null/missing semantics explicitly.

---

## 13. Security

Rules:

- TLS/auth must follow environment policy.
- Credentials must come from secret management.
- Table/column names must be allowlisted.
- Queries must be parameterized.
- Sensitive event payloads must be minimized/redacted/tokenized.
- Tenant filters must be enforced in query adapter if table is multi-tenant.
- Do not expose arbitrary SQL endpoint to users.

---

## 14. Observability

Required ingestion metrics:

- Rows attempted/written/failed/dropped.
- Flush count and duration.
- Buffer depth.
- Retry count.
- Backpressure count.
- Write error classification.

Required query metrics:

- Query count by named query and outcome.
- Query latency.
- Rows returned.
- Timeout/cancellation count.

Logs must include:

- `questdb.operation`.
- `questdb.table`.
- `questdb.transport`.
- `outcome`.
- `error.kind`.

Never log full row payload by default.

---

## 15. Testing requirements

Required tests:

- Mapper tests from domain event to row.
- Timestamp unit/source tests.
- NaN/Inf rejection tests.
- Symbol cardinality validation tests.
- Flush failure test.
- Shutdown flush test.
- Backpressure overflow test.
- Query parameterization tests.
- Query time-range requirement test.
- Integration test against QuestDB container for ingestion and PGWire query.

Performance tests are required for high-throughput ingestion code.

---

## 16. Anti-patterns

Forbidden:

- QuestDB as transactionally authoritative case store.
- PGWire inserts for high-volume telemetry.
- ILP client used for querying.
- `map[string]any` metrics writer.
- Dynamic columns from arbitrary JSON.
- High-cardinality symbol misuse.
- No flush on shutdown.
- Silent ingestion drops.
- Unbounded analytical query.
- PostgreSQL compatibility assumptions not tested on QuestDB.

---

## 17. Review checklist

Before merge, the LLM MUST verify:

- [ ] QuestDB role is analytical/time-series, not hidden OLTP.
- [ ] Ingestion and query adapters are separated.
- [ ] ILP is used for high-throughput ingestion.
- [ ] PGWire/query client is used for reads.
- [ ] Table contract exists.
- [ ] Timestamp source/unit/timezone is explicit.
- [ ] Symbol cardinality is reviewed.
- [ ] Dynamic identifiers are allowlisted.
- [ ] Backpressure/failure policy is documented.
- [ ] Flush errors are surfaced.
- [ ] Queries are bounded and parameterized.
- [ ] Telemetry covers rows, flush, retry, drop, and query latency.
- [ ] Integration tests cover real QuestDB behavior.

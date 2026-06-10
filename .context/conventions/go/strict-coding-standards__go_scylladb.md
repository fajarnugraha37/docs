# Strict Coding Standards — Go + ScyllaDB

> **Scope**: Mandatory implementation standards for Go code that uses ScyllaDB/CQL for high-throughput low-latency storage, query-serving tables, event/state materialization, time-series-like access patterns, or Cassandra-compatible data access.
>
> **Primary client baseline**: ScyllaDB GoCQL fork via `github.com/gocql/gocql` import path with `replace github.com/gocql/gocql => github.com/scylladb/gocql <pinned-version>`, and optionally `github.com/scylladb/gocqlx/v2` for struct binding/query helpers.
>
> **Core model**: ScyllaDB is a distributed wide-column database. Model tables around queries, partitions, clustering order, consistency, TTL, compaction, and idempotent access. Do not treat it like relational SQL or a generic key-value cache.

---

## 1. Source Authority

The agent MUST prefer these authorities, in order:

1. Existing project architecture decisions and repository conventions.
2. Official ScyllaDB documentation.
3. Official ScyllaDB Go driver / ScyllaDB GoCQL fork docs.
4. `gocqlx/v2` docs if the project uses GocqlX.
5. Apache Cassandra CQL semantics only where ScyllaDB docs confirm compatibility.
6. Go standard library docs for `context`, `time`, testing, logging, telemetry, and concurrency.

The agent MUST NOT invent ScyllaDB behavior for consistency, token/shard awareness, paging, TTL, tombstones, batches, lightweight transactions, materialized views, secondary indexes, or compaction.

---

## 2. Non-Negotiable Rules

1. Data model MUST start from query/access patterns, not from normalized entity models.
2. Every query MUST include the full partition key unless explicitly approved.
3. `ALLOW FILTERING` is forbidden in production paths unless a written exception exists.
4. Secondary indexes/materialized views are not default solutions; they require explicit decision.
5. Each table MUST document partition key, clustering key, expected partition size, sort order, TTL policy, and query patterns.
6. All Go calls MUST be context-aware where driver API supports context.
7. Session/cluster setup MUST happen in bootstrap/composition code and be injected.
8. Token-aware/shard-aware behavior MUST be enabled and verified for ScyllaDB deployments.
9. Consistency level MUST be explicit by operation category.
10. Idempotency MUST be explicit before enabling retries for writes.
11. Logs/traces MUST NOT include credentials, raw CQL with secrets, or high-cardinality labels.

---

## 3. Client Selection and Module Rules

Baseline dependency policy:

```go
require github.com/gocql/gocql vX.Y.Z

replace github.com/gocql/gocql => github.com/scylladb/gocql vX.Y.Z
```

Rules:

1. The ScyllaDB fork MUST be pinned to a concrete version.
2. `latest` MUST NOT remain in committed `go.mod`.
3. Driver version must be compatible with ScyllaDB server version.
4. `gocqlx/v2` MAY be used for mapping/query helpers, but it MUST NOT hide table/query design.
5. Raw CQL and generated query builders must be reviewed for partition key correctness.

Allowed imports:

```go
import "github.com/gocql/gocql"
import "github.com/scylladb/gocqlx/v2"
```

Do not import the ScyllaDB fork path directly unless project standard says so.

---

## 4. Cluster and Session Initialization

Cluster setup MUST be centralized:

```go
type ScyllaConfig struct {
    Hosts       []string
    Keyspace    string
    Username    string
    Password    string
    LocalDC     string
    Timeout     time.Duration
    ConnectTimeout time.Duration
}

func NewScyllaSession(cfg ScyllaConfig) (*gocql.Session, error) {
    if len(cfg.Hosts) == 0 {
        return nil, errors.New("scylla hosts are required")
    }
    if cfg.Keyspace == "" {
        return nil, errors.New("scylla keyspace is required")
    }

    cluster := gocql.NewCluster(cfg.Hosts...)
    cluster.Keyspace = cfg.Keyspace
    cluster.Timeout = cfg.Timeout
    cluster.ConnectTimeout = cfg.ConnectTimeout
    cluster.Consistency = gocql.LocalQuorum
    cluster.PoolConfig.HostSelectionPolicy = gocql.TokenAwareHostPolicy(
        gocql.DCAwareRoundRobinPolicy(cfg.LocalDC),
    )

    if cfg.Username != "" {
        cluster.Authenticator = gocql.PasswordAuthenticator{
            Username: cfg.Username,
            Password: cfg.Password,
        }
    }

    session, err := cluster.CreateSession()
    if err != nil {
        return nil, fmt.Errorf("create scylla session: %w", err)
    }
    return session, nil
}
```

Rules:

1. Do not create sessions inside request handlers or repositories.
2. Session must be closed during shutdown.
3. Hosts should use the shard-aware port when deployment policy supports it.
4. Token-aware host selection must be enabled.
5. Local datacenter must be explicit for multi-DC deployments.
6. Credentials/TLS must be read from secure config.
7. Timeouts must be explicit.
8. Reconnection/retry policy must be project-defined, not default-by-accident.

---

## 5. Data Modelling Rules

ScyllaDB tables MUST be modelled by query.

For each table, document:

```text
Table: case_events_by_case
Purpose: read ordered events for a case
Partition key: (tenant_id, case_id)
Clustering key: event_time DESC, event_id
Expected partition size: <= N rows / <= M MB
TTL: none / X days
Consistency: LOCAL_QUORUM writes, LOCAL_QUORUM reads
Query patterns:
  - get latest N events by case
  - page older events by case + event_time
Forbidden:
  - search by actor_id
  - search across tenant without analytics store
```

Rules:

1. A table without a documented query pattern is forbidden.
2. Entity-normalized tables copied from SQL are forbidden.
3. Cross-partition joins are forbidden.
4. Cross-partition scans are forbidden for request path.
5. Denormalization is allowed only with explicit write/update fanout plan.
6. Duplicate data must have reconciliation or source-of-truth policy.
7. Large partitions must be prevented by bucketing or table redesign.
8. Hot partitions must be detected by key design review.
9. Tombstone risk must be evaluated for deletes, TTL, collection columns, and frequent updates.

---

## 6. Key Design

Partition key design MUST balance:

- queryability,
- partition size,
- write distribution,
- hot-key risk,
- ordering requirement,
- tenant isolation,
- TTL/delete behavior.

Rules:

1. Tenant-aware data SHOULD include tenant in partition key unless global table is approved.
2. Time-series/high-volume data MUST use bucketing when a natural key can grow unbounded.
3. Do not use monotonically increasing partition keys that create hot spots.
4. Clustering order MUST match read order.
5. Avoid collection columns for unbounded lists/maps/sets.
6. Use synthetic bucket keys for high-write streams where required.

Example:

```sql
CREATE TABLE case_events_by_case_day (
    tenant_id text,
    case_id uuid,
    bucket_date date,
    event_time timestamp,
    event_id timeuuid,
    event_type text,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, bucket_date), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC, event_id DESC);
```

---

## 7. CQL Construction

CQL statements MUST be constants or generated from allowlisted builders.

Preferred:

```go
const selectCaseEvents = `
SELECT event_time, event_id, event_type, payload
FROM case_events_by_case_day
WHERE tenant_id = ? AND case_id = ? AND bucket_date = ?
LIMIT ?`
```

Forbidden:

```go
stmt := "SELECT * FROM " + userTable + " WHERE " + userFilter
```

Rules:

1. Bind values with placeholders.
2. Table/column names must be constants or allowlisted.
3. Never concatenate request input into CQL.
4. Avoid `SELECT *` in application code.
5. LIMIT must be explicit for list queries.
6. Query must include partition key.
7. Query must avoid `ALLOW FILTERING`.
8. Query comments may include logical query name for tracing if safe.

---

## 8. Repository Boundary

Repository methods MUST express table/query intent.

Preferred:

```go
type CaseEventStore interface {
    AppendEvent(ctx context.Context, event CaseEventRecord) error
    ListByCaseDay(ctx context.Context, tenant TenantID, caseID CaseID, day civil.Date, limit int) ([]CaseEventRecord, PageState, error)
}
```

Forbidden:

```go
type ScyllaRepository interface {
    Query(ctx context.Context, cql string, args ...any) ([]map[string]any, error)
}
```

Rules:

1. Do not expose generic query access to application layer.
2. Do not leak CQL row structs to domain layer.
3. Keep table-specific logic near repository implementation.
4. Denormalized table writes must be orchestrated in application layer or unit-of-work-like component with explicit failure handling.

---

## 9. Context and Timeout Rules

Use context-aware query execution when available:

```go
err := s.session.Query(insertCQL, args...).WithContext(ctx).Exec()
```

Rules:

1. Repository methods must accept `context.Context` first.
2. Request-path operations must have bounded context/deadline.
3. Do not use `context.Background()` inside repository methods.
4. Shutdown operations may use bounded background context if documented.
5. Driver timeout and context timeout must be coherent.
6. Long-running administrative/background scans must use explicit job context and progress tracking.

---

## 10. Consistency Policy

Consistency MUST be explicit by use case.

Recommended defaults:

- user-facing critical read/write: `LOCAL_QUORUM`,
- idempotent telemetry/event append where eventual consistency is acceptable: documented lower consistency only by decision,
- multi-DC local request path: local consistency levels,
- serial/LWT operations: explicit serial consistency.

Rules:

1. Do not set global consistency casually and forget per-operation semantics.
2. Do not use `ANY` or `ONE` for critical business state without explicit approval.
3. Read-after-write requirements must be documented.
4. Cross-DC consistency must be architecture-approved.
5. LWT/Paxos must be rare and justified.

```go
q := s.session.Query(stmt, args...).WithContext(ctx).Consistency(gocql.LocalQuorum)
```

---

## 11. Retry and Idempotency

Retries are dangerous unless write semantics are idempotent.

Rules:

1. Before retrying a write, define idempotency key or deterministic primary key.
2. Inserts with generated timestamps/UUIDs inside retry loop can duplicate data.
3. Logged batches are not general transaction substitutes.
4. Retry policy must distinguish timeout, unavailable, overloaded, and application conflict.
5. Use backoff with jitter.
6. Do not retry non-idempotent updates blindly.
7. Consumer-driven writes must deduplicate message/event IDs.

Preferred idempotent insert:

```sql
INSERT INTO processed_events_by_id (tenant_id, event_id, processed_at)
VALUES (?, ?, ?)
IF NOT EXISTS
```

But LWT cost must be approved; for high-volume idempotency prefer deterministic table design or external dedupe strategy.

---

## 12. Batches

CQL batches MUST NOT be used for bulk loading or performance by default.

Allowed:

1. Small atomic update across rows in the same partition when justified.
2. Coordinated denormalized writes with explicit consistency/failure semantics.

Forbidden:

1. Large batches.
2. Cross-partition batches for throughput.
3. Batches as a replacement for transactions.
4. Batching unbounded lists from request input.

Rules:

1. Batch size must be bounded.
2. Batch partition count must be bounded.
3. Failure behavior must be documented.
4. Bulk ingestion should use concurrent prepared statements/load pipeline instead of CQL batch misuse.

---

## 13. Paging

List queries MUST use driver paging and application page tokens deliberately.

Rules:

1. Page size must be explicit.
2. Page state/token must be opaque to API clients or protected/signed.
3. Do not expose raw page state if it leaks topology/query internals.
4. Pagination must preserve partition/query constraints.
5. Do not implement offset pagination over ScyllaDB.
6. Guard maximum page size.

```go
q := s.session.Query(stmt, args...).WithContext(ctx).PageSize(100)
iter := q.Iter()
defer iter.Close()
```

Always close/check iterators.

---

## 14. Iteration and Scanning

Rules:

1. Always close iterators and check close error.
2. Do not load unbounded rows into memory.
3. Decode into explicit row structs.
4. Handle `ErrNotFound` separately.
5. Do not use reflection-heavy generic scanning in hot paths without benchmark.

```go
iter := q.Iter()
defer func() {
    if err := iter.Close(); err != nil && retErr == nil {
        retErr = fmt.Errorf("close scylla iterator: %w", err)
    }
}()

for iter.Scan(&row.FieldA, &row.FieldB) {
    // append bounded results
}
```

---

## 15. TTL, Delete, and Tombstone Rules

Tombstone-aware design is mandatory.

Rules:

1. TTL must be a table/design decision, not ad hoc per write.
2. Frequent delete/update patterns must be reviewed for tombstone accumulation.
3. Avoid TTL on huge partitions without compaction/tombstone analysis.
4. Avoid deleting individual elements from large collections.
5. Do not model queues by insert/delete churn without tombstone strategy.
6. Expiry semantics must consider legal/audit retention.
7. Use time-bucketed tables for lifecycle deletion when possible.
8. Do not use ScyllaDB as a temporary cache without TTL/read-pattern analysis.

---

## 16. Lightweight Transactions

LWT (`IF`, `IF NOT EXISTS`) provides conditional semantics but is expensive.

Rules:

1. LWT requires explicit decision.
2. Use LWT only for low-volume correctness-critical uniqueness/compare-and-set cases.
3. Do not use LWT as general transaction mechanism.
4. Always inspect the applied result.
5. Serial consistency must be explicit where required.
6. Benchmark LWT under realistic contention.

---

## 17. Secondary Indexes and Materialized Views

Secondary indexes and materialized views are not default design tools.

Rules:

1. Prefer query-specific tables over secondary indexes for request paths.
2. Secondary indexes require cardinality/selectivity review.
3. Materialized views require consistency, backfill, and operational review.
4. Do not add index/view to avoid proper data modelling.
5. Filtering/search workloads may belong in Elasticsearch/OpenSearch/analytics store instead.

---

## 18. Schema Migration

Schema changes MUST be managed as operations.

Rules:

1. CQL schema changes are not hidden inside app startup hot path unless explicitly approved.
2. Migrations must be idempotent.
3. Additive schema changes should precede code usage.
4. Backfills must be bounded, resumable, and observable.
5. Dropping columns/tables requires retention/rollback approval.
6. Table option changes require performance review.
7. Materialized views/indexes require build/backfill monitoring.

---

## 19. Security Rules

1. Use TLS and authentication in production.
2. Credentials must come from secret manager/config provider.
3. Do not log credentials or full connection strings.
4. CQL identifiers from user input are forbidden.
5. Authorization must be enforced at application/service layer unless database-level model is explicitly designed.
6. Tenant boundary must be part of primary key/query where tenant-scoped.
7. PII fields must have retention and access policy.

---

## 20. Observability

Each ScyllaDB operation SHOULD emit:

- logical operation name,
- table logical name,
- consistency level,
- duration,
- timeout/cancel/retry classification,
- rows returned/affected if safe,
- page size,
- page count,
- error class,
- LWT applied/not-applied count if used.

Rules:

1. Do not tag metrics with raw partition keys, user IDs, case IDs, or event IDs.
2. Log logical query name, not raw CQL with values.
3. Monitor driver errors, timeouts, retries, coordinator latency, and overload signals.
4. Hot partition/tombstone warnings must feed review process.

---

## 21. Testing Standards

Required tests:

1. Table query includes full partition key.
2. Missing record maps to not-found.
3. Timeout/cancellation path.
4. Tenant boundary enforcement.
5. Page size and page token behavior.
6. Idempotent retry behavior.
7. LWT applied/not-applied handling if used.
8. TTL/delete semantics where relevant.
9. Denormalized write partial failure path.
10. Serialization/scanning of all row fields.

Integration tests SHOULD use a real ScyllaDB container/cluster because fakes rarely reproduce consistency, paging, CQL validation, TTL, tombstones, or driver behavior.

---

## 22. Benchmarking Standards

Benchmark realistic access patterns:

- single-partition point lookup,
- partition range read,
- high-throughput insert,
- fanout denormalized write,
- paginated reads,
- LWT under contention,
- retry behavior under timeout/overload.

Rules:

1. Dataset cardinality and partition size must be realistic.
2. Consistency level must match production.
3. Driver config must be reported.
4. Shard-aware/token-aware behavior must be enabled.
5. Benchmark must separate client CPU, network, server latency, and serialization where possible.
6. Do not extrapolate from single-node localhost to cluster production.

---

## 23. Workflow and Regulatory System Rules

For case/workflow/state systems:

1. State transition writes must be idempotent.
2. Event append tables must use deterministic event IDs.
3. Current-state table and event-history table updates must have reconciliation strategy.
4. Ordering must be defined by clustering key or monotonic domain version, not wall-clock alone.
5. Audit/event records must be immutable.
6. Retention must be explicit.
7. Rebuild/replay path must be tested.
8. Cross-entity impact should use event/outbox/read-model pipeline, not cross-partition Scylla joins.

---

## 24. Anti-Patterns

Forbidden unless explicitly approved:

1. SQL-normalized schema copied into ScyllaDB.
2. Generic `FindAll` table scans.
3. `ALLOW FILTERING` in request path.
4. Secondary index as first solution.
5. Materialized view without operational plan.
6. Large unbounded partitions.
7. Queue-like delete churn without tombstone strategy.
8. Blind retry of non-idempotent writes.
9. Large cross-partition batches.
10. Offset pagination.
11. `SELECT *` in production path.
12. Creating sessions per request.
13. Ignoring iterator close errors.
14. Hiding consistency level in defaults.
15. Treating ScyllaDB as relational database with joins.

---

## 25. LLM Implementation Checklist

Before submitting Go + ScyllaDB code, the agent MUST verify:

- [ ] ScyllaDB GoCQL fork is pinned and configured.
- [ ] Session is injected, not created in hot path.
- [ ] Token-aware/shard-aware policy is configured.
- [ ] Context-aware calls are used.
- [ ] Table query pattern is documented.
- [ ] Full partition key is present in request-path queries.
- [ ] No `ALLOW FILTERING` is used.
- [ ] Consistency level is explicit.
- [ ] Page size is bounded.
- [ ] Iterators are closed and checked.
- [ ] Writes are idempotent if retried.
- [ ] TTL/delete/tombstone impact is considered.
- [ ] Secondary index/MV/LWT usage is justified.
- [ ] Tenant boundary is encoded in key/query where relevant.
- [ ] Tests cover timeout, not-found, pagination, idempotency, and consistency-sensitive paths.

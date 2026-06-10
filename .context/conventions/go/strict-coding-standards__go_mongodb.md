# Strict Coding Standards — Go + MongoDB

> **Scope**: Mandatory implementation standards for Go code that connects to MongoDB, reads/writes BSON documents, manages indexes, runs aggregations, uses transactions, consumes change streams, or exposes MongoDB-backed APIs.
>
> **Primary client baseline**: Official MongoDB Go Driver v2: `go.mongodb.org/mongo-driver/v2/mongo`.
>
> **Core model**: MongoDB is a document database. Treat collections as explicit document contracts with indexes, validation, lifecycle, and operational semantics. Do not treat MongoDB as a schemaless dumping ground.

---

## 1. Source Authority

The agent MUST prefer these authorities, in order:

1. Existing project architecture decisions and repository conventions.
2. Official MongoDB documentation.
3. Official MongoDB Go Driver v2 documentation and `pkg.go.dev` API docs.
4. Project-specific collection/index/schema/runbook documents.
5. Go standard library documentation for `context`, `time`, `encoding/json`, testing, logging, and telemetry.

The agent MUST NOT invent MongoDB behavior for read concern, write concern, retryable writes, transactions, aggregation, ObjectID, BSON conversion, index use, or change stream semantics.

---

## 2. Non-Negotiable Rules

1. All MongoDB operations MUST accept and propagate `context.Context`.
2. `mongo.Client` MUST be constructed once in bootstrap/composition code and injected into repositories/stores.
3. A repository MUST own exactly one bounded persistence concern; it MUST NOT expose raw `*mongo.Collection` to application/domain layers.
4. Collection names, database names, index names, field names, and aggregation stage choices MUST be constants or allowlisted values.
5. User input MUST NOT become raw BSON operator, field name, projection, sort key, collection name, database name, JavaScript expression, or aggregation stage without validation.
6. Every production query path MUST have an explicit index plan or an explicit approved exception.
7. Decoding MUST target persistence document structs, not domain structs, unless the project has explicitly made the domain model persistence-owned.
8. `bson.M` MUST NOT be used where key order matters; use `bson.D` for ordered command/query/aggregation structures.
9. Cursors MUST be closed and checked for errors.
10. Logs/traces MUST NOT include raw documents, credentials, connection strings, tokens, or PII-heavy filters.

---

## 3. Client Initialization

Use the v2 driver import path:

```go
import (
    "go.mongodb.org/mongo-driver/v2/mongo"
    "go.mongodb.org/mongo-driver/v2/mongo/options"
)
```

Client setup MUST be centralized:

```go
type MongoConfig struct {
    URI            string
    Database       string
    ConnectTimeout time.Duration
    OperationTimeout time.Duration
    AppName        string
}

func NewMongoClient(ctx context.Context, cfg MongoConfig) (*mongo.Client, error) {
    if cfg.URI == "" {
        return nil, errors.New("mongo uri is required")
    }

    connectCtx, cancel := context.WithTimeout(ctx, cfg.ConnectTimeout)
    defer cancel()

    opts := options.Client().
        ApplyURI(cfg.URI).
        SetAppName(cfg.AppName)

    // Client-level timeout may be used only by project decision because driver CSOT semantics
    // must be understood and tested for the project.
    if cfg.OperationTimeout > 0 {
        opts.SetTimeout(cfg.OperationTimeout)
    }

    client, err := mongo.Connect(opts)
    if err != nil {
        return nil, fmt.Errorf("connect mongo: %w", err)
    }

    if err := client.Ping(connectCtx, nil); err != nil {
        _ = client.Disconnect(context.Background())
        return nil, fmt.Errorf("ping mongo: %w", err)
    }

    return client, nil
}
```

Forbidden:

```go
func FindUser(id string) (*User, error) {
    client, _ := mongo.Connect(options.Client().ApplyURI(os.Getenv("MONGO_URI")))
    // ...
}
```

Why:

- hidden pools,
- leaked monitoring goroutines,
- unbounded config drift,
- hard-to-test behavior,
- repeated connection establishment,
- inconsistent timeout/security policy.

---

## 4. Configuration Contract

MongoDB configuration MUST include:

- URI source,
- database name,
- app name,
- connect timeout,
- operation timeout/deadline policy,
- server selection timeout if overridden,
- TLS/auth policy,
- retry/read/write concern policy where required,
- max pool size/min pool size/max idle time if customized,
- observability hooks if used.

Rules:

1. Connection strings MUST be treated as secrets.
2. Full connection strings MUST NOT be logged.
3. Database/collection names MUST NOT be derived from user input.
4. Per-environment config MUST be validated at startup.
5. Production config MUST fail fast on missing URI/database.
6. Test config MUST be isolated by database/collection prefix.

---

## 5. Context, Timeout, and Cancellation

Every operation MUST receive caller context:

```go
func (s *UserStore) FindByID(ctx context.Context, id UserID) (UserRecord, error) {
    ctx, cancel := context.WithTimeout(ctx, s.queryTimeout)
    defer cancel()

    var doc userDocument
    err := s.collection.FindOne(ctx, bson.D{{Key: "_id", Value: id.String()}}).Decode(&doc)
    if err != nil {
        return UserRecord{}, mapMongoError(err)
    }
    return doc.toRecord(), nil
}
```

Rules:

1. Repository methods MUST accept `ctx context.Context` as first parameter.
2. Do not pass `context.Background()` inside repository methods except for shutdown cleanup explicitly documented.
3. Do not use no-timeout contexts for externally triggered operations.
4. Always call cancel for derived contexts.
5. Timeout budget MUST be owned by the caller/application layer unless repository-specific guardrails are approved.
6. Client-level operation timeout MAY be configured, but must be documented because it applies across server selection, connection checkout, and server-side execution.
7. `Disconnect(ctx)` MUST use bounded shutdown context.

Forbidden:

```go
collection.FindOne(context.TODO(), filter)
```

---

## 6. Repository Boundary

A repository/store method MUST express business intent:

Preferred:

```go
type UserStore interface {
    FindActiveByEmail(ctx context.Context, email Email) (UserRecord, error)
    SaveProfileSnapshot(ctx context.Context, snapshot ProfileSnapshotRecord) error
}
```

Forbidden:

```go
type UserRepository interface {
    Find(ctx context.Context, filter any) ([]any, error)
    Update(ctx context.Context, filter any, update any) error
}
```

Rules:

1. Do not expose arbitrary filter/update maps from application layer.
2. Do not let handlers build persistence filters directly.
3. Do not return driver cursor to application/domain layer.
4. Do not let domain services know MongoDB field names.
5. Repository package owns mapping between domain/application records and BSON documents.

---

## 7. Document Modelling

Use explicit persistence structs:

```go
type userDocument struct {
    ID        string    `bson:"_id"`
    Email     string    `bson:"email"`
    Status    string    `bson:"status"`
    Version   int64     `bson:"version"`
    CreatedAt time.Time `bson:"created_at"`
    UpdatedAt time.Time `bson:"updated_at"`
}
```

Rules:

1. Every persisted field MUST have a `bson` tag.
2. Do not rely on default lowercase field mapping.
3. Use `omitempty` only when omission is semantically different from zero value.
4. Prefer explicit optional wrappers or pointers for nullable/optional fields.
5. Do not persist transport DTOs directly.
6. Do not persist domain aggregates directly if they contain behavior-only fields, caches, locks, channels, contexts, or transient state.
7. Embedded documents MUST have bounded size and lifecycle.
8. Large unbounded arrays MUST be modelled as separate collections or event/history collections.
9. Document size growth MUST be considered before appending to arrays.

---

## 8. BSON Construction

Use `bson.D` for ordered structures:

```go
filter := bson.D{
    {Key: "tenant_id", Value: tenantID.String()},
    {Key: "status", Value: "ACTIVE"},
}
```

Use `bson.M` only when order is irrelevant and keys are controlled constants.

Rules:

1. Aggregation pipelines MUST use ordered documents.
2. `$sort`, command documents, compound index definitions, and pipeline stages MUST use `bson.D`.
3. User-provided operator names are forbidden.
4. User-provided field names MUST be allowlisted.
5. `$where` and server-side JavaScript MUST NOT be used.
6. Regex filters MUST be bounded and escaped unless explicitly intended.
7. Dynamic query builders MUST return a validated internal query object, not raw map mutation.

Forbidden:

```go
filter := bson.M{userField: bson.M{"$regex": userPattern}}
```

Preferred:

```go
field, ok := allowedSearchField(userField)
if !ok {
    return nil, ErrInvalidSearchField
}
filter := bson.D{{Key: field, Value: primitive.Regex{Pattern: regexp.QuoteMeta(term), Options: "i"}}}
```

---

## 9. Identifier Rules

ObjectID policy MUST be explicit.

Allowed options:

1. MongoDB `primitive.ObjectID` as persistence ID.
2. Domain-generated UUID/ULID/string ID stored in `_id`.
3. Composite natural key only with architecture decision.

Rules:

1. Domain ID type MUST not leak driver-specific types unless approved.
2. Parse ObjectID at API boundary, not deep in repository.
3. Invalid ObjectID must map to validation error, not not-found.
4. `_id` MUST be immutable.
5. Unique domain keys MUST have unique indexes.

---

## 10. Index Contract

Every repository query MUST document its intended index.

```go
// Query: tenant_id + email unique lookup.
// Index: uq_users_tenant_email { tenant_id: 1, email_norm: 1 }, unique.
```

Rules:

1. Create indexes through migration/bootstrap process, not ad hoc inside hot paths.
2. Compound indexes MUST match equality/filter/sort patterns.
3. Sort fields MUST be backed by matching or inverted index order.
4. Unindexed collection scans are forbidden in production paths.
5. Text indexes, partial indexes, TTL indexes, sparse indexes, wildcard indexes, and vector/search indexes require explicit decision.
6. Unique indexes are mandatory for application-level uniqueness guarantees.
7. Index creation must be idempotent and observable.
8. Removing/changing indexes requires rollout plan.

Anti-pattern:

```go
// Adding a filter because the endpoint needs it, without adding/validating index support.
filter := bson.D{{"tenant_id", t}, {"status", s}, {"created_at", bson.D{{"$gte", from}}}}
```

---

## 11. Query Rules

Find operations MUST define:

- filter,
- projection,
- sort if order matters,
- limit,
- timeout,
- index expectation,
- pagination strategy,
- error mapping.

Rules:

1. Use projection for list/read-model endpoints.
2. Always bound list queries with `Limit`.
3. Do not use skip/limit pagination for large offsets unless explicitly accepted.
4. Prefer keyset pagination for large collections.
5. Do not sort on unindexed high-cardinality fields without index support.
6. Do not return unbounded arrays.
7. Always close cursors.
8. Always check cursor error after iteration.

```go
cur, err := s.collection.Find(ctx, filter, options.Find().SetLimit(100).SetSort(sort).SetProjection(proj))
if err != nil {
    return nil, mapMongoError(err)
}
defer cur.Close(ctx)

var out []userListDocument
for cur.Next(ctx) {
    var doc userListDocument
    if err := cur.Decode(&doc); err != nil {
        return nil, fmt.Errorf("decode user list document: %w", err)
    }
    out = append(out, doc)
}
if err := cur.Err(); err != nil {
    return nil, fmt.Errorf("iterate user list cursor: %w", err)
}
```

---

## 12. Write Rules

Writes MUST define:

- target identity,
- tenant boundary,
- idempotency behavior,
- version/concurrency behavior,
- write concern if relevant,
- event/outbox side effect if relevant.

Rules:

1. Use `$set`, `$unset`, `$inc`, `$push`, `$addToSet` deliberately; do not replace whole documents accidentally.
2. Replacement updates require explicit justification.
3. Upsert must be idempotent and unique-index protected.
4. Check `MatchedCount`, `ModifiedCount`, and `UpsertedID` as appropriate.
5. Optimistic locking MUST use version match and version increment.
6. Do not ignore duplicate key errors.
7. Multi-document consistency must use transaction or redesign.

Preferred optimistic update:

```go
filter := bson.D{
    {Key: "_id", Value: id.String()},
    {Key: "tenant_id", Value: tenantID.String()},
    {Key: "version", Value: expectedVersion},
}
update := bson.D{{Key: "$set", Value: bson.D{
    {Key: "status", Value: nextStatus},
    {Key: "updated_at", Value: now.UTC()},
}}, {Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}}}
```

---

## 13. Transactions and Sessions

Use MongoDB transactions only when single-document atomicity is insufficient.

Rules:

1. Transaction usage MUST be justified in code comments or architecture decision.
2. Keep transactions short.
3. Do not perform network calls, external API calls, file I/O, or user interaction inside transaction function.
4. All operations inside transaction MUST use the session context.
5. Retriable transaction errors MUST follow driver/project guidance.
6. Transaction boundaries MUST map to application use case, not generic repository internals.
7. Do not use transactions to compensate for poor aggregate/document design without review.

Preferred shape:

```go
sess, err := client.StartSession()
if err != nil { return err }
defer sess.EndSession(ctx)

_, err = sess.WithTransaction(ctx, func(sc mongo.SessionContext) (any, error) {
    if err := storeA.write(sc, a); err != nil { return nil, err }
    if err := storeB.write(sc, b); err != nil { return nil, err }
    return nil, nil
})
```

---

## 14. Aggregation Rules

Aggregation pipelines MUST be treated as query programs.

Rules:

1. Pipelines MUST be built from allowlisted stages.
2. `$match` should be as early as possible and index-supported.
3. `$project` should reduce payload early when possible.
4. `$lookup` requires explicit performance and consistency review.
5. `$group` and `$sort` on large collections require bound/filter/index strategy.
6. Aggregation output MUST decode to explicit structs.
7. Explain plans SHOULD be captured for complex or high-volume pipelines.
8. Aggregation pipelines MUST have timeout and result limits.

Forbidden:

```go
pipeline := mongo.Pipeline{bson.D{{Key: userStage, Value: userPayload}}}
```

---

## 15. Change Streams

Change streams are integration/replication mechanisms, not magic triggers.

Rules:

1. Consumers MUST be restartable.
2. Resume tokens MUST be persisted after successful processing.
3. Processing MUST be idempotent.
4. Full-document lookup MUST be intentional because it changes load/cost.
5. Backpressure and batch size must be controlled.
6. Watch loops MUST respect context cancellation.
7. Errors must be classified as retryable/non-retryable where possible.
8. Change streams MUST emit telemetry: lag, reconnects, resume count, processed count, failure count.

---

## 16. Error Handling

Map driver errors to project errors at repository boundary.

Rules:

1. `mongo.ErrNoDocuments` maps to domain/application not-found.
2. Duplicate key maps to conflict/duplicate.
3. Timeout/cancellation maps to timeout/canceled, not generic internal error.
4. Decode errors map to data corruption or internal persistence contract error.
5. Write concern errors must not be hidden.
6. Bulk write per-item errors must be inspected.
7. Do not compare error strings.

Example:

```go
func mapMongoError(err error) error {
    switch {
    case err == nil:
        return nil
    case errors.Is(err, mongo.ErrNoDocuments):
        return ErrNotFound
    case mongo.IsDuplicateKeyError(err):
        return ErrConflict
    case errors.Is(err, context.Canceled):
        return ErrCanceled
    case errors.Is(err, context.DeadlineExceeded):
        return ErrTimeout
    default:
        return fmt.Errorf("mongo operation: %w", err)
    }
}
```

---

## 17. Multi-Tenancy Rules

If the application is tenant-aware:

1. Every collection document MUST include tenant key unless collection is explicitly global.
2. Every query/update/delete MUST include tenant key in filter.
3. Tenant key MUST be part of unique indexes where uniqueness is tenant-scoped.
4. Tenant key MUST be part of shard key if sharding and access pattern require it.
5. Do not store tenant in context-only without explicit method parameter or typed actor.
6. Cross-tenant admin operations require separate methods and audit logs.

Forbidden:

```go
s.collection.DeleteOne(ctx, bson.D{{"_id", id}}) // missing tenant boundary
```

---

## 18. Sharding and Partitioning Awareness

If using sharded MongoDB:

1. Shard key choice MUST be architecture-approved.
2. Upserts on sharded collections MUST include shard key where required.
3. Hot shard risk MUST be considered for monotonic keys.
4. Cross-shard scatter-gather queries are forbidden unless approved.
5. Queries MUST include shard key when access pattern supports it.
6. Shard key migration/refinement requires rollout plan.

---

## 19. Data Lifecycle

Document lifecycle MUST be explicit:

- created/updated timestamps,
- logical deletion vs physical deletion,
- TTL expiration,
- archival,
- retention compliance,
- legal/audit holds,
- migration/version field if document shape evolves.

Rules:

1. TTL indexes must not be used for records requiring legal/audit retention without review.
2. Soft delete queries must consistently filter deleted state.
3. Physical delete must be approved for regulated data.
4. Document schema version must be considered for long-lived collections.

---

## 20. Security Rules

1. Use TLS and authenticated connection strings in production.
2. Least-privilege database users are mandatory.
3. Do not log URI, username, password, raw documents, or unredacted filters.
4. Do not use server-side JavaScript.
5. Do not allow dynamic collection/database names from request input.
6. Do not store secrets in ordinary application documents unless encrypted and approved.
7. Client-side field-level encryption requires dedicated design and key-management review.
8. Query endpoints must bound regex, aggregation, sort, projection, and result size.

---

## 21. Observability

MongoDB operations SHOULD emit structured telemetry:

- operation name,
- collection logical name,
- query type,
- duration,
- matched/modified/inserted/deleted count,
- timeout/cancel/conflict/duplicate classification,
- retry count where available,
- cursor result count if safe,
- index/migration operation result.

Rules:

1. Do not include raw filter values by default.
2. Avoid high-cardinality labels such as document IDs.
3. Trace spans must not include secrets or PII-heavy fields.
4. Slow query logs should include logical query name, not raw query payload.

---

## 22. Testing Standards

Required tests:

1. Repository happy path.
2. Not-found mapping.
3. Duplicate key mapping.
4. Timeout/cancellation behavior.
5. Cursor decode failure when applicable.
6. Tenant boundary enforcement.
7. Optimistic locking conflict.
8. Upsert idempotency.
9. Index creation/migration idempotency.
10. BSON optional/null/zero semantics.

Integration tests SHOULD use a real MongoDB instance unless the project has a verified fake with equivalent behavior. Do not mock MongoDB semantics for transactions, indexes, cursor behavior, or duplicate-key errors unless the goal is only unit-level branch coverage.

---

## 23. Benchmarking Standards

Benchmark only meaningful workloads:

- query by indexed key,
- list pagination,
- batch insert,
- aggregation pipeline,
- transaction path,
- change-stream processing.

Rules:

1. Benchmark dataset must resemble production cardinality and document shape.
2. Indexes must match production.
3. Benchmark must record timeout, pool, write concern, read preference, and server version.
4. Do not claim performance from localhost toy datasets.
5. Use load tests for end-to-end behavior.

---

## 24. Anti-Patterns

Forbidden unless explicitly approved:

1. Raw `bson.M` filters built in HTTP handlers.
2. Generic repository with `Find(filter any)` exposed to application layer.
3. Storing domain aggregate directly as BSON.
4. Missing context timeout.
5. Ignoring `cursor.Err()`.
6. Not closing cursor.
7. Collection scan in production path.
8. Regex search without bounds/index/search design.
9. Transaction for every write by default.
10. Upsert without unique index.
11. Dynamic collection names from tenant/user.
12. Logging raw documents.
13. Relying on MongoDB as schema-less free-form storage.
14. Appending unbounded arrays into one document.
15. Using skip pagination for large page numbers.

---

## 25. LLM Implementation Checklist

Before submitting Go + MongoDB code, the agent MUST verify:

- [ ] Official v2 driver import path is used.
- [ ] Client is injected, not constructed in hot path.
- [ ] All operations use context.
- [ ] Timeouts are explicit or inherited by documented project config.
- [ ] Repository methods expose intent, not raw filters.
- [ ] Persistence structs have explicit `bson` tags.
- [ ] Queries are indexed or explicitly approved.
- [ ] Lists are bounded and projected.
- [ ] Cursors are closed and checked.
- [ ] Writes check result counts.
- [ ] Duplicate/not-found/timeout errors are mapped.
- [ ] Tenant boundary is enforced where relevant.
- [ ] No raw user field/operator/stage names are accepted.
- [ ] Secrets/PII are redacted from logs/traces.
- [ ] Tests cover error, boundary, and BSON semantics.

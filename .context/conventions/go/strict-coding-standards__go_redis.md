# Strict Coding Standards — Go Redis

Status: Mandatory  
Scope: Go services using Redis for cache, distributed coordination, locks, rate limiting, sessions, counters, queues, streams, pub/sub, feature flags, or transient state.  
Audience: LLM code agents, developers, reviewers, maintainers, platform engineers, SREs, and security reviewers.  
Baseline: Go 1.24+; compatible with Go 1.25/1.26 standards in this repository.

---

## 1. Purpose

Redis code looks simple because commands are simple. Production Redis code fails when an LLM treats Redis as a magic map with no expiry, consistency, memory, cluster, retry, persistence, or failure semantics.

This standard ensures Redis usage is explicit about:

- Data ownership and durability expectations.
- Cache-aside vs write-through vs session vs lock vs stream semantics.
- TTL and eviction behavior.
- Redis Cluster/Sentinel topology.
- Context timeouts and command cancellation.
- Atomicity, Lua scripts, transactions, and optimistic locking.
- Idempotency, retry safety, and duplicate processing.
- Telemetry, key cardinality, and security.

---

## 2. Source authority

Primary references:

- Redis official Go client documentation for `go-redis`.
- Redis `go-redis` GitHub repository and package docs.
- Redis command semantics documentation.
- Go standards in this repository for context, concurrency, telemetry, security, cryptography, JSON, time/date, and error handling.

`go-redis` is the default approved Go Redis client unless a project decision selects another client such as `rueidis` for a specific performance or client-side caching reason. The official Redis docs describe `go-redis` as a type-safe client supporting Redis Cluster, Sentinel, streams, pipelining, pub/sub, connection pooling, and context integration.

---

## 3. Non-negotiable rules

1. MUST NOT use Redis as the source of truth unless the architecture explicitly accepts Redis durability and recovery semantics.
2. MUST NOT create keys without an ownership prefix, schema/version convention, and TTL decision.
3. MUST NOT store secrets, credentials, raw tokens, or sensitive payloads without approved encryption/tokenization and retention policy.
4. MUST NOT use unbounded key scans in request path.
5. MUST NOT use `KEYS` in production code.
6. MUST NOT perform Redis commands without `context.Context` deadline on request/worker paths.
7. MUST NOT use `SETNX` lock without TTL, token ownership, and safe release logic.
8. MUST NOT implement distributed locks for correctness-critical mutual exclusion without a project-approved algorithm and failure model.
9. MUST NOT assume Redis commands are part of the same transaction unless `MULTI/EXEC`, Lua, or another atomic mechanism is explicitly used.
10. MUST NOT use Pub/Sub for durable work queues.
11. MUST NOT use Redis Streams without consumer group, ack, pending, retry, and dead-letter policy.
12. MUST NOT ignore `redis.Nil`; it is a not-found result, not a generic infrastructure failure.
13. MUST NOT log full key values when keys contain user IDs, tokens, or business identifiers; use redacted/hashed forms where needed.

---

## 4. Client setup

Redis client setup MUST be centralized and injected.

Required:

```go
type RedisConfig struct {
    Mode         string // single, sentinel, cluster, ring
    Addrs        []string
    Username     string
    Password     SecretRef
    DB           int
    TLS          bool
    Protocol     int
    DialTimeout  time.Duration
    ReadTimeout  time.Duration
    WriteTimeout time.Duration
    PoolSize     int
}
```

Rules:

- Use one long-lived client per Redis role/topology.
- Close clients during application shutdown.
- Do not create a Redis client per request.
- Use TLS for managed/cloud/shared networks.
- Validate DB selection; Redis Cluster does not support arbitrary DB selection in the same way as standalone deployments.
- Credentials MUST come from secret management.
- RESP protocol version MUST be explicit when relying on RESP3/module-specific behavior.

Example:

```go
rdb := redis.NewClient(&redis.Options{
    Addr:         cfg.Addr,
    Username:     cfg.Username,
    Password:     secret.Value(),
    DB:           cfg.DB,
    TLSConfig:    tlsCfg,
    DialTimeout:  cfg.DialTimeout,
    ReadTimeout:  cfg.ReadTimeout,
    WriteTimeout: cfg.WriteTimeout,
    PoolSize:     cfg.PoolSize,
    Protocol:     3,
})
```

---

## 5. Context and timeout policy

Every operation MUST accept context from caller.

Forbidden:

```go
var ctx = context.Background()
rdb.Get(ctx, key)
```

Required:

```go
func (s *Store) GetSession(ctx context.Context, sid SessionID) (Session, error) {
    ctx, cancel := context.WithTimeout(ctx, s.timeout)
    defer cancel()
    return s.getSession(ctx, sid)
}
```

Rules:

- Request path Redis calls MUST have bounded timeout.
- Batch/worker Redis calls MUST have bounded timeout.
- Startup health checks may use short independent timeout.
- Cancellation must stop downstream Redis calls and avoid goroutine leaks.

---

## 6. Key design and namespace

Every key MUST follow a documented naming convention.

Recommended format:

```text
<app>:<env>:<bounded-domain>:<entity>:<version>:<id>[:<field>]
```

Example:

```text
enforcement:prod:case:summary:v1:CASE-123
```

Rules:

- Key prefix MUST identify owner and environment.
- Key schema version MUST exist for values that may change.
- Key cardinality MUST be bounded or documented.
- Key must not contain raw secret/token values.
- Hashing identifiers is required when keys may be visible to operators and contain sensitive IDs.
- LLM MUST document TTL and eviction expectation for each key family.

---

## 7. TTL and eviction policy

Every Redis write MUST answer:

- Does this key expire?
- What happens when it expires early due to eviction?
- Can the system recover from cache miss?
- Is stale data acceptable?
- What is the invalidation trigger?

Forbidden:

```go
rdb.Set(ctx, key, value, 0) // no TTL by accident
```

Allowed only when:

- It is a deliberate persistent Redis data structure.
- The architecture accepts persistence/backup semantics.
- Memory growth is bounded.

Preferred:

```go
err := rdb.Set(ctx, key, encoded, 15*time.Minute).Err()
```

TTL rules:

- Cache keys should almost always have TTL.
- Lock keys MUST have TTL.
- Idempotency keys MUST have TTL based on duplicate window.
- Rate-limit keys MUST have TTL.
- Session TTL must align with security/session policy.

---

## 8. Value encoding

Value encoding MUST be explicit.

Allowed:

- UTF-8 string for simple scalar values.
- JSON for portable human-debuggable DTOs.
- MessagePack/Protobuf only with schema/version decision.
- Redis native structures for counters, sets, sorted sets, streams, or hashes when semantics match.

Rules:

- Include schema version for structured values.
- Validate decoded values.
- Avoid `map[string]any` at boundaries.
- Avoid storing enormous JSON blobs.
- Compress only with size threshold, content type metadata, and decompression bomb limits.

---

## 9. Cache patterns

### 9.1 Cache-aside

Cache-aside MUST handle:

- Miss.
- Corrupt value.
- Stale value.
- Stampede.
- Negative cache.
- Timeout fallback.

A cache miss MUST NOT be logged as error.

`redis.Nil` MUST map to domain not-found/cache-miss, not infrastructure error.

```go
val, err := rdb.Get(ctx, key).Bytes()
if errors.Is(err, redis.Nil) {
    return Value{}, ErrCacheMiss
}
if err != nil {
    return Value{}, fmt.Errorf("get redis key family case-summary: %w", err)
}
```

### 9.2 Negative cache

Negative cache entries MUST have short TTL and distinct value encoding.

### 9.3 Stampede protection

For expensive recomputation, use one of:

- Local singleflight.
- Distributed lock with explicit failure model.
- Probabilistic early refresh.
- Stale-while-revalidate policy.

---

## 10. Atomicity and transactions

When multiple Redis operations must be atomic, the LLM MUST use an appropriate mechanism.

Options:

- Single Redis command.
- Lua script.
- `MULTI/EXEC` transaction.
- `WATCH` optimistic locking.

Pipelining is NOT atomic.

Forbidden:

```go
pipe := rdb.Pipeline()
pipe.Get(ctx, a)
pipe.Set(ctx, b, v, ttl)
_, err := pipe.Exec(ctx) // batching only, not atomic business transaction
```

Lua rules:

- Script must be deterministic.
- Script must declare all keys in `KEYS`, all values in `ARGV`.
- Script must be small and reviewed.
- Long-running scripts are forbidden.
- Script result must be typed and tested.

---

## 11. Distributed locks

Distributed locks are dangerous. The LLM MUST prefer database constraints, idempotency keys, or single-writer architecture where possible.

If Redis lock is approved:

Required:

- `SET key token NX PX ttl` or equivalent.
- Unique random token per lock acquisition.
- Safe release that deletes only if token matches.
- TTL shorter than failure recovery objective but longer than expected critical section.
- Critical section must be idempotent or compensatable.
- Renewal/extension policy if work can exceed TTL.
- Metrics for acquisition, contention, timeout, and release failure.

Forbidden:

```go
rdb.SetNX(ctx, lockKey, "1", 0)
rdb.Del(ctx, lockKey)
```

---

## 12. Rate limiting and counters

Counters/rate limits MUST use atomic Redis operations and TTL.

Rules:

- Use `INCR` + `EXPIRE` atomically via Lua or transaction where needed.
- Use sorted sets only when sliding-window semantics are required and bounded cleanup exists.
- Counter overflow and type parsing must be handled.
- Rate limit decisions must emit telemetry, but not high-cardinality labels for user IDs.

---

## 13. Redis Streams

Redis Streams may be used for durable-ish local/event processing only with explicit consumer-group policy.

Required:

- Stream name convention.
- Consumer group name convention.
- Message ID handling.
- `XACK` only after successful processing.
- Pending message inspection/reclaim policy.
- Retry counter.
- Dead-letter stream or operational incident path.
- Idempotent message handler.
- Max stream length or retention policy.

Forbidden:

- Treating streams as exactly-once.
- Acknowledging before durable side effects.
- Infinite pending entries with no owner/reclaimer.

---

## 14. Pub/Sub

Redis Pub/Sub MUST only be used for ephemeral notifications.

Allowed:

- Cache invalidation hints.
- Best-effort local refresh notifications.
- Non-critical UI/live updates.

Forbidden:

- Payment commands.
- Workflow state transitions.
- Audit events.
- Any message requiring durable delivery or replay.

---

## 15. Cluster and Sentinel

If using Redis Cluster:

- Key design must consider hash slots.
- Multi-key operations must use hash tags only when intentional.
- Cross-slot errors must be tested.
- MOVED/ASK behavior must be handled by client/topology.

If using Sentinel:

- Failover client config must be used.
- Read/write role assumptions must be explicit.
- Connection recovery must be tested.

---

## 16. Error handling

Classify Redis errors into:

- Not found: `redis.Nil`.
- Timeout/canceled: context errors.
- Retryable infra: loading, try-again, connection reset, cluster move.
- Non-retryable command/config error.
- Data corruption/decode error.

Rules:

- Wrap infra errors with operation and key family, not raw sensitive key.
- Do not retry non-idempotent scripts blindly.
- Do not hide Redis outage by returning empty values unless stale/cache-fallback policy exists.

---

## 17. Observability

Required metrics:

- Operation count by command family and outcome.
- Latency histogram by command family.
- Cache hit/miss/stale/corrupt count.
- Lock acquire success/failure/contention count.
- Stream pending/reclaimed/DLQ count.
- Pool stats where available.

OpenTelemetry integration SHOULD use approved instrumentation. The official `go-redis` repository documents tracing/metrics instrumentation via `redisotel`; project adoption must follow the telemetry standard.

Log fields:

- `redis.operation`.
- `redis.key_family`, not raw key.
- `cache.outcome` where applicable.
- `retryable`.
- `duration_ms`.

---

## 18. Testing requirements

Required tests:

- Key builder tests.
- TTL tests.
- `redis.Nil` miss handling.
- Corrupt value decode test.
- Timeout/cancellation test.
- Lock token release test.
- Idempotency duplicate processing test.
- Streams pending/retry/DLQ tests if streams are used.
- Cluster cross-slot tests if cluster is used.
- Integration tests against Redis container for scripts and transactions.

Mock-only tests are insufficient for Lua scripts, stream behavior, cluster behavior, or lock release logic.

---

## 19. Anti-patterns

Forbidden:

- `KEYS *` in production.
- Raw business object stored forever with no TTL.
- Redis as primary DB without explicit architecture decision.
- Distributed lock without TTL/token/safe release.
- Pub/Sub as durable queue.
- Pipeline mistaken for transaction.
- Lua script that embeds dynamic user code.
- Logging raw keys/values.
- Ignoring `redis.Nil` semantics.
- Creating client per request.
- Unbounded `HGETALL`/`SMEMBERS`/`LRANGE 0 -1` on unbounded keys.

---

## 20. Review checklist

Before merge, the LLM MUST verify:

- [ ] Redis purpose is explicit: cache, lock, session, stream, counter, etc.
- [ ] Key namespace/version/TTL is documented.
- [ ] Client is injected and closed on shutdown.
- [ ] Context deadlines exist.
- [ ] `redis.Nil` is handled semantically.
- [ ] No `KEYS` or unbounded scans in request path.
- [ ] Locks, if any, use token + TTL + safe release.
- [ ] Streams, if any, have consumer group, ack, retry, pending, and DLQ policy.
- [ ] Values are versioned and validated.
- [ ] Secrets/PII are not logged.
- [ ] Metrics/traces/logs use bounded-cardinality labels.
- [ ] Integration tests cover real Redis behavior for scripts/transactions/streams.

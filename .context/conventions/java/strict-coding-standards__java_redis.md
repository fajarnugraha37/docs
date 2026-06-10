# Strict Coding Standards: Java + Redis

> **Purpose**: This document defines strict, enforceable coding standards for Java applications using Redis. It is designed for LLM coding agents, reviewers, and human engineers who need Redis integration that is explicit, bounded, observable, secure, and operationally safe.

> **Scope**: Java services using Redis through Jedis, Lettuce, Spring Data Redis, Redisson, Micrometer, OpenTelemetry, or direct Redis protocol clients. This standard applies to cache, session store, rate limiter, distributed lock, idempotency store, queue-like usage, Redis Streams, Pub/Sub, Lua scripting, Cluster, Sentinel, and managed Redis services.

> **Relationship to other standards**:
>
> - Use with `strict-coding-standards__java_network.md` for timeout/TLS/retry rules.
> - Use with `strict-coding-standards__java_security.md` for secrets, injection, and sensitive data.
> - Use with `strict-coding-standards__java_json.md` for JSON serialization.
> - Use with `strict-coding-standards__java_concurrency.md` for blocking/reactive/threading behavior.
> - Use with `strict-coding-standards__java_telemetry.md` for metrics, logs, traces, and alerts.

---

## 1. Non-Negotiable Rules

An LLM agent **MUST NOT** write Redis code until it has identified:

1. The use case: cache, lock, rate limit, session, event stream, queue, pub/sub, deduplication, idempotency, coordination, or data store.
2. The client/library: Jedis, Lettuce, Spring Data Redis, Redisson, or another approved client.
3. The deployment mode: standalone, Sentinel, Cluster, managed Redis, Redis-compatible service, or local test instance.
4. The durability expectation: ephemeral cache, recoverable cache, best-effort event stream, durable-ish stream, or persistent data store.
5. The failure behavior: fail-open, fail-closed, fallback, degraded response, retry, circuit breaker, or request failure.
6. The timeout and retry policy.
7. The key naming, TTL, eviction, and memory policy.
8. The serialization format and versioning policy.
9. The security boundary: TLS, ACL/user, password/secret handling, tenant separation, and sensitive data classification.
10. The observability requirements: command latency, pool metrics, timeouts, errors, cache hit/miss, key cardinality, memory pressure, stream lag, and lock contention.

If any of these are unknown, the agent must either infer conservatively and document the assumption or stop and request explicit design input.

---

## 2. Redis Is Not Just a HashMap

Redis is an in-memory data structure server with persistence, replication, Lua scripting, transactions, eviction, high availability, clustering, and multiple data types. It provides strings, hashes, lists, sets, sorted sets, streams, geospatial indexes, bitmaps, HyperLogLog, and more.

### 2.1 Mandatory Mental Model

Redis code must be designed around these properties:

- Commands are usually fast, but network, serialization, cluster redirection, failover, and slow commands can dominate latency.
- Data may disappear due to TTL, eviction, flush, failover, persistence configuration, or operational mistakes.
- Redis is single-threaded for command execution in many core paths, so one bad command can affect all clients.
- Redis commands are atomic per command, but multi-command workflows are not atomic unless explicitly protected by Lua, transactions, locks, or optimistic concurrency.
- Redis persistence is not equivalent to relational transactional durability.
- Redis replication is asynchronous in common configurations; acknowledged writes may still be lost during failover depending on setup.
- Redis Cluster changes key routing semantics; multi-key commands require keys in the same hash slot.
- Pub/Sub is not durable; Redis Streams are replayable append-log-like structures.

### 2.2 Forbidden Mental Models

The agent must not assume:

- “Redis is always available because it is fast.”
- “Redis is a database replacement by default.”
- “TTL guarantees exact deletion time.”
- “A Redis lock is automatically safe.”
- “A transaction behaves like SQL transaction.”
- “Pub/Sub is a reliable queue.”
- “Cache invalidation can be guessed later.”
- “Serialization can change without migration.”
- “Cluster is transparent for all commands.”

---

## 3. Client Selection Policy

### 3.1 Approved Client Categories

| Client                | Default Use                                                                            | Notes                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Lettuce**           | Async/reactive/high-concurrency Java services                                          | Supports sync, async, reactive, cluster, Sentinel; Netty-based; connection sharing has specific rules.       |
| **Jedis**             | Simple synchronous applications                                                        | Straightforward synchronous API; use pooled/client lifecycle correctly.                                      |
| **Spring Data Redis** | Spring applications needing templates, repositories, cache abstraction, or integration | Must configure serializers explicitly; do not hide Redis semantics behind ambiguous repository abstractions. |
| **Redisson**          | Higher-level distributed objects/locks where approved                                  | Restricted; must understand semantics and failure model.                                                     |

### 3.2 Selection Rules

**MUST**:

- Pick the simplest client that satisfies the concurrency and deployment model.
- Use Spring Data Redis when the application is Spring-managed and Redis access must integrate with Spring configuration, caching, transactions, or templates.
- Use Lettuce when asynchronous, reactive, cluster-aware, or high-concurrency access is needed.
- Use Jedis for simple synchronous access when blocking behavior is acceptable and pooling is configured.
- Pin versions via Maven/Gradle dependency management.
- Align transitive versions with the framework baseline, especially Spring Boot/Spring Data versions.

**MUST NOT**:

- Mix multiple Redis clients in the same module without a design note.
- Use raw socket/protocol implementation in application code.
- Let the LLM introduce Redis OM, Redisson, Spring Cache, or reactive Redis merely because it is convenient.
- Change client library to “fix” a bug without proving the lifecycle/failure behavior difference.

---

## 4. Connection and Lifecycle Standards

### 4.1 General Rules

**MUST**:

- Create Redis clients/connections through dependency injection or application lifecycle configuration.
- Reuse clients according to the selected client’s documented thread-safety/lifecycle contract.
- Close clients, pools, and connections on application shutdown.
- Configure connect timeout, command timeout, socket timeout/read timeout, and shutdown timeout explicitly.
- Configure TLS where required by environment policy.
- Configure authentication through secret management, not hardcoded strings.
- Expose client health without running destructive commands.

**MUST NOT**:

- Create a new Redis client per request.
- Create a new physical connection per command unless using a managed pool intentionally.
- Ignore connection close/shutdown.
- Use default 60-second timeout blindly.
- Block event-loop threads with synchronous calls.
- Share stateful non-thread-safe connection/session objects across threads unless the client explicitly allows it.

### 4.2 Lettuce Rules

**Allowed**:

- `RedisClient` / `RedisClusterClient` as long-lived application beans.
- Stateful connection reuse when client documentation permits and workload is compatible.
- Async/reactive APIs when backpressure and timeouts are explicit.

**Restricted**:

- Connection pooling with Lettuce; use only if connection-per-operation semantics are required or blocking sync workloads need isolation.
- Auto-reconnect and disconnected command buffering; must define whether commands may queue while disconnected.
- `setAutoFlushCommands(false)`; only for controlled batching with `try/finally` restoration.

**Forbidden**:

- Using reactive Redis without backpressure/cancellation awareness.
- Running blocking Redis calls on Netty/event-loop/reactor scheduler threads.
- Infinite command buffering during outage.

Example:

```java
public final class RedisConfig {
    private static final Duration COMMAND_TIMEOUT = Duration.ofMillis(250);
    private static final Duration CONNECT_TIMEOUT = Duration.ofMillis(500);

    public RedisClient redisClient(RedisUri redisUri) {
        RedisClient client = RedisClient.create(redisUri);
        client.setOptions(ClientOptions.builder()
                .autoReconnect(true)
                .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
                .timeoutOptions(TimeoutOptions.enabled(COMMAND_TIMEOUT))
                .build());
        return client;
    }
}
```

### 4.3 Jedis Rules

**Allowed**:

- `JedisPooled`/pooled client for synchronous request/response applications.
- `UnifiedJedis` where the modern Jedis API is appropriate.
- `JedisCluster` for cluster deployments with explicit timeout and pool settings.

**Restricted**:

- Raw `Jedis` resource usage; must be inside `try-with-resources` if borrowed from pool.
- Pipeline usage; must be bounded and error-aware.
- Transactions; must not be treated as SQL transactions.

**Forbidden**:

- Creating `new Jedis(...)` per operation without pooling/lifecycle management.
- Sharing a non-thread-safe Jedis connection across threads.
- Unbounded pipeline accumulation.

Example:

```java
public final class TokenCache {
    private static final String PREFIX = "auth:token:";
    private final JedisPooled jedis;

    public TokenCache(JedisPooled jedis) {
        this.jedis = Objects.requireNonNull(jedis, "jedis");
    }

    public Optional<String> find(String tokenId) {
        String key = PREFIX + requireSafeTokenId(tokenId);
        return Optional.ofNullable(jedis.get(key));
    }

    public void put(String tokenId, String value, Duration ttl) {
        if (ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("ttl must be positive");
        }
        jedis.setex(PREFIX + requireSafeTokenId(tokenId), ttl.toSeconds(), value);
    }
}
```

### 4.4 Spring Data Redis Rules

**MUST**:

- Configure `RedisConnectionFactory` explicitly.
- Configure `RedisTemplate` serializers explicitly.
- Avoid Java native serialization for Redis values.
- Prefer `StringRedisTemplate` for simple string keys/values.
- Use `RedisCacheManager` only when cache policy is explicit.

**MUST NOT**:

- Rely on default JDK serialization.
- Store arbitrary domain entities without explicit versioned DTOs.
- Hide critical Redis behavior behind Spring Cache without TTL, key policy, and invalidation rules.

Example:

```java
@Bean
RedisTemplate<String, SessionValue> sessionRedisTemplate(
        RedisConnectionFactory connectionFactory,
        ObjectMapper objectMapper) {
    RedisTemplate<String, SessionValue> template = new RedisTemplate<>();
    template.setConnectionFactory(connectionFactory);
    template.setKeySerializer(new StringRedisSerializer());
    template.setHashKeySerializer(new StringRedisSerializer());
    template.setValueSerializer(new GenericJackson2JsonRedisSerializer(objectMapper));
    template.setHashValueSerializer(new GenericJackson2JsonRedisSerializer(objectMapper));
    template.afterPropertiesSet();
    return template;
}
```

---

## 5. Timeout, Retry, and Circuit Breaker Policy

### 5.1 Timeout Rules

Every Redis operation must have bounded latency.

**MUST define**:

- Connection timeout.
- Command timeout.
- Pool borrow timeout, if pooling is used.
- Shutdown timeout.
- Max wait time for lock acquisition.
- Max retry duration for transient failures.

**MUST NOT**:

- Use infinite timeouts.
- Use default timeout values without justification.
- Retry long-running Redis commands blindly.
- Let Redis outages consume all application threads.

### 5.2 Retry Rules

Redis retry is dangerous because commands may have already executed.

**Allowed retries**:

- Idempotent reads.
- Idempotent writes using deterministic values and safe overwrite semantics.
- Writes protected by idempotency key or compare-and-set semantics.
- Connection redirects in Cluster handled by the client.

**Restricted retries**:

- `INCR`, `DECR`, `LPUSH`, `RPUSH`, `XADD`, `ZINCRBY`, `SADD`, `SETNX`, lock acquisition, or any non-idempotent mutation.
- Lua scripts with side effects.
- Multi-command workflows.

**Forbidden retries**:

- Blind retry on timeout for non-idempotent commands.
- Retry storms during Redis outage.
- Retrying lock release after ownership token has changed.

### 5.3 Circuit Breaker Rules

Redis calls on request path must be protected when outage can cascade.

**MUST**:

- Define fail-open/fail-closed behavior per use case.
- Add circuit breaker/bulkhead where Redis is optional or degraded response is acceptable.
- Separate Redis thread pool/scheduler from request processing if blocking calls can pile up.

---

## 6. Key Design Standards

### 6.1 Key Naming

All keys must follow a documented naming pattern.

Recommended format:

```text
<service>:<environment>:<domain>:<entity-or-use-case>:<stable-id>[:<field>]
```

Example:

```text
licensing:prod:case:status:CASE-2026-0001
licensing:prod:auth:session:7f4c4a8e
licensing:prod:rate-limit:user:12345:login
```

**MUST**:

- Use stable, bounded-length identifiers.
- Include tenant/environment boundary if shared Redis is used.
- Define collision policy.
- Define character policy for user-controlled IDs.
- Avoid keys containing raw PII unless approved.
- Avoid unbounded key names.

**MUST NOT**:

- Use raw user input directly as key without normalization/validation.
- Use ambiguous prefixes like `cache:` without ownership.
- Use timestamp-only keys if uniqueness matters.
- Use sequential sensitive IDs if key scanning/logging may expose them.

### 6.2 Key Hash Tags for Cluster

For Redis Cluster, multi-key operations require keys in the same slot.

**MUST**:

- Use hash tags deliberately when multi-key operation is required.
- Keep hash tag cardinality high enough to avoid hot slot.
- Document why colocating keys is needed.

Example:

```text
case:{CASE-2026-0001}:metadata
case:{CASE-2026-0001}:events
case:{CASE-2026-0001}:lock
```

**MUST NOT**:

- Put all keys in one hash tag such as `{global}`.
- Use multi-key commands in Cluster without slot compatibility.
- Assume client will fix cross-slot command design.

---

## 7. TTL, Expiration, and Eviction

### 7.1 TTL Rules

Every cache/session/rate-limit/temp/idempotency key must define TTL.

**MUST define**:

- TTL duration.
- Whether TTL is absolute, sliding, or refreshed on read/write.
- Whether expired value is safe to recompute.
- Whether stale value may be served.
- Whether TTL jitter is required.

**MUST NOT**:

- Create cache keys without TTL unless explicitly permanent.
- Use Redis as permanent storage accidentally.
- Refresh TTL on every read without considering hot-key persistence.
- Assume expiration is exact to the millisecond under load.

### 7.2 TTL Jitter

To avoid stampedes, frequently generated keys should use TTL jitter.

```java
static Duration withJitter(Duration base, double jitterRatio, RandomGenerator random) {
    long baseMillis = base.toMillis();
    long jitterMillis = Math.round(baseMillis * jitterRatio);
    long delta = random.nextLong(-jitterMillis, jitterMillis + 1);
    return Duration.ofMillis(Math.max(1L, baseMillis + delta));
}
```

**MUST**:

- Use bounded jitter for high-cardinality cache keys.
- Avoid synchronized expiration of thousands/millions of keys.

### 7.3 Eviction Rules

**MUST**:

- Know Redis `maxmemory` and eviction policy.
- Treat cache data as evictable unless policy says otherwise.
- Avoid storing critical lock/session/idempotency data in an instance where eviction can delete correctness keys, unless risk is explicitly accepted.
- Monitor evicted keys and memory fragmentation.

**MUST NOT**:

- Store correctness-critical state in an eviction-enabled cache without fallback.
- Assume “no TTL” means “safe forever.”

---

## 8. Serialization and Data Format

### 8.1 Serialization Rules

**MUST**:

- Define serialization format per value type.
- Version serialized values when schema may evolve.
- Set max payload size.
- Compress only when measured and justified.
- Validate deserialized payload.
- Avoid native Java serialization.

**Allowed formats**:

- UTF-8 string for simple values.
- JSON for human-readable DTOs with explicit schema/version.
- MessagePack/CBOR/Protobuf/Avro where approved and versioned.
- Redis Hash for partial field access when field semantics are stable.

**Forbidden**:

- Java native serialization for untrusted or long-lived Redis data.
- Storing framework proxies/entities directly.
- Storing passwords/secrets/tokens unless protected and explicitly approved.
- Storing huge objects without size limit and memory budget.

### 8.2 JSON Rules

**MUST**:

- Use DTOs, not JPA entities/domain aggregates.
- Include schema version if long-lived.
- Use explicit date/time format.
- Use exact numeric handling for money/decimal.
- Define unknown-field policy.

Example:

```json
{
  "schemaVersion": 1,
  "caseId": "CASE-2026-0001",
  "status": "UNDER_REVIEW",
  "updatedAt": "2026-06-10T09:15:30Z"
}
```

---

## 9. Cache Patterns

### 9.1 Cache-Aside Standard

Cache-aside is the default application-level pattern.

```java
public UserProfile getProfile(UserId userId) {
    String key = keys.profile(userId);
    return cache.get(key)
            .map(serializer::decodeProfile)
            .orElseGet(() -> {
                UserProfile profile = repository.findProfile(userId)
                        .orElseThrow(() -> new NotFoundException("profile not found"));
                cache.set(key, serializer.encodeProfile(profile), ttl.profileTtl());
                return profile;
            });
}
```

**MUST**:

- Define cache key, TTL, and invalidation.
- Treat cache miss as normal.
- Protect backend from stampede where recomputation is expensive.
- Make serialization/deserialization failures observable.
- Avoid caching authorization decisions unless invalidation is proven.

**MUST NOT**:

- Cache mutable security-sensitive state without invalidation.
- Cache `null` values unless negative-cache TTL is short and explicit.
- Assume cache value is valid without version/type checks.

### 9.2 Write-Through / Write-Behind

**Restricted**:

- Write-through cache is allowed only when write ordering and source of truth are clear.
- Write-behind is forbidden by default for critical data unless durable queue/outbox and replay strategy exist.

### 9.3 Stampede Protection

For expensive recomputation, use one or more:

- Short local in-process lock.
- Single-flight deduplication.
- Soft TTL + background refresh.
- Stale-while-revalidate.
- Bounded Redis lock with ownership token.

**MUST NOT**:

- Let thousands of requests recompute the same missing key.
- Use unbounded blocking lock wait on request path.

---

## 10. Atomicity, Transactions, Lua, and CAS

### 10.1 Single Command Atomicity

Redis commands are atomic individually.

**MUST prefer**:

- Single atomic command if it expresses the operation.
- `SET key value NX EX seconds` for simple lock acquisition.
- `INCR` with TTL carefully initialized for counters/rate limits.
- `HSET`/`HINCRBY` for hash field operations.

### 10.2 MULTI/EXEC Rules

Redis transactions are not SQL transactions.

**Allowed**:

- Grouping commands for atomic execution when no branching is needed.
- Optimistic concurrency with `WATCH` for compare-and-set.

**Restricted**:

- Complex workflows inside MULTI/EXEC.
- Transactions combined with network retries.

**Forbidden**:

- Assuming rollback semantics after a command-level error.
- Using Redis transactions as substitute for relational transaction spanning DB + Redis.

### 10.3 Lua Script Rules

Lua scripts are allowed only when they reduce race conditions or round trips with bounded logic.

**MUST**:

- Keep scripts small and deterministic.
- Pass keys through `KEYS[]` and values through `ARGV[]`.
- Define Cluster slot compatibility.
- Version script content.
- Unit/integration test scripts.
- Bound runtime and avoid unbounded loops.

**MUST NOT**:

- Build Lua scripts with string concatenated user input.
- Run slow scripts on hot production Redis.
- Use Lua as general business logic engine.

Example: safe lock release:

```lua
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
```

---

## 11. Distributed Locks

Distributed locks are **restricted** because correctness depends on time, ownership, failure, and deployment semantics.

### 11.1 Lock Acquisition Rules

**MUST**:

- Use unique random ownership token.
- Use atomic acquire with TTL, such as `SET key token NX PX ttlMillis`.
- Use bounded wait time.
- Use TTL shorter than business timeout but long enough for protected critical section.
- Release only if token matches.
- Make critical section idempotent if possible.
- Record metrics for contention, acquisition failure, and held duration.

**MUST NOT**:

- Use `SETNX` followed by separate `EXPIRE` as two commands.
- Release lock using plain `DEL` without ownership check.
- Use locks to protect long-running or external irreversible operations without fencing token/idempotency.
- Assume lock is safe under clock pause, GC pause, failover, or network partition.

### 11.2 Fencing Token Rule

For correctness-critical external side effects, a Redis lock alone is not enough.

**MUST use one of**:

- Database row version/check constraint.
- Monotonic fencing token accepted by downstream system.
- Idempotency key and compare-and-set.
- Transactional source of truth.

### 11.3 Redlock Policy

Redlock or multi-node distributed locks are allowed only after architecture approval.

**MUST document**:

- Number of Redis masters.
- Quorum policy.
- Clock drift assumption.
- Timeout and retry policy.
- Failure model.
- Why database/queue/leader election alternative is insufficient.

---

## 12. Rate Limiting

### 12.1 Allowed Patterns

- Fixed window counter with TTL for approximate/simple limits.
- Sliding window log only for small cardinality/low volume.
- Sliding window counter using sorted sets or Lua with memory budget.
- Token bucket/leaky bucket via Lua or approved library.

### 12.2 Rules

**MUST**:

- Include subject and action in key.
- Define TTL and cleanup.
- Avoid unbounded sorted set growth.
- Return remaining quota/reset time when API contract requires it.
- Decide fail-open/fail-closed behavior.

**MUST NOT**:

- Use per-IP only where user identity is available and abuse model requires user scoping.
- Use Redis rate limit without command timeout and fallback policy.
- Let rate-limit key cardinality explode without TTL.

---

## 13. Idempotency and Deduplication

### 13.1 Idempotency Store

**MUST**:

- Use a stable idempotency key generated by caller or application.
- Store processing state: `IN_PROGRESS`, `COMPLETED`, `FAILED_RETRYABLE`, etc.
- Store response hash or result reference if replay must return same response.
- Use TTL based on business replay window.
- Use atomic state transition.

**MUST NOT**:

- Treat Redis idempotency as durable financial ledger.
- Delete idempotency keys immediately after success if client retry window remains.
- Store huge responses directly.

### 13.2 Deduplication

**Allowed**:

- `SET key marker NX EX ttl` for simple deduplication.
- Bloom/filter modules only if approved by platform.
- Redis Stream consumer group pending-entry handling for stream events.

**Restricted**:

- Deduplication for correctness-critical payment/case-state transition without durable source of truth.

---

## 14. Pub/Sub and Messaging

### 14.1 Pub/Sub Rules

Redis Pub/Sub is fire-and-forget and non-durable.

**Allowed**:

- Local cache invalidation.
- Best-effort notifications.
- Non-critical real-time UI hints.

**Forbidden**:

- Critical business events.
- Work queues requiring retry/replay.
- Compliance/audit events.

### 14.2 Queue-Like Usage

Lists can be used for simple queues only with explicit failure behavior.

**Restricted**:

- `LPUSH`/`BRPOP` simple work queue.
- Reliable queue pattern with processing list.

**Prefer**:

- Kafka/RabbitMQ for durable asynchronous workflows.
- Redis Streams when Redis-native replayable log is sufficient.

---

## 15. Redis Streams

Redis Streams are append-only-log-like data structures with consumer groups and replay capabilities.

### 15.1 Allowed Use Cases

- Lightweight event stream with bounded retention.
- Internal async workflow where Redis operational durability is acceptable.
- Consumer group processing with pending-entry recovery.
- Change fan-out where Kafka/RabbitMQ is not required.

### 15.2 Stream Rules

**MUST**:

- Define stream key naming.
- Define retention policy using `MAXLEN` or trimming process.
- Define consumer group name.
- Define consumer naming strategy.
- Handle pending entries with `XPENDING`, `XCLAIM`, or `XAUTOCLAIM` where supported.
- Define poison-message policy.
- Define idempotency for message processing.
- Track lag and pending-entry count.

**MUST NOT**:

- Use Streams without trimming/retention.
- Assume consumer group ack equals business transaction commit unless coordinated.
- `XACK` before irreversible side effect completes.
- Store huge payloads directly in stream entries.

### 15.3 Stream Processing Flow

Recommended flow:

1. `XREADGROUP` with bounded count and block time.
2. Validate and deserialize event.
3. Process idempotently.
4. Persist durable side effect.
5. `XACK` after successful processing.
6. Send poison event to DLQ/parking stream after bounded attempts.

---

## 16. Cluster and Sentinel

### 16.1 Redis Cluster Rules

**MUST**:

- Use cluster-aware client.
- Understand hash slots and cross-slot limitations.
- Avoid multi-key commands unless keys share hash tag.
- Configure topology refresh/redirect handling.
- Monitor moved/ask redirects and hot slots.
- Test failover/res harding behavior.

**MUST NOT**:

- Use non-cluster client against Cluster.
- Use `KEYS` in production cluster.
- Use global locks or counters with single hot key unless capacity is proven.

### 16.2 Sentinel Rules

**MUST**:

- Use Sentinel-aware client configuration.
- Configure master name, Sentinel endpoints, timeouts, and authentication correctly.
- Test master failover with client reconnect.
- Define behavior for stale reads from replicas.

---

## 17. Security Standards

### 17.1 Transport and Authentication

**MUST**:

- Use TLS in production unless an explicit network security exception exists.
- Use ACL/user credentials, not shared default credentials, where available.
- Load credentials from secret manager/environment, not code.
- Rotate credentials according to platform policy.
- Avoid logging Redis URLs with password.

**MUST NOT**:

- Hardcode Redis password.
- Disable certificate validation.
- Send credentials in logs, traces, exception messages, or metrics labels.
- Expose Redis directly to public internet.

### 17.2 Data Security

**MUST**:

- Classify values stored in Redis.
- Avoid storing raw PII/PHI/secrets unless approved.
- Apply TTL to sensitive cache/session/idempotency values.
- Encrypt sensitive values at application level if infrastructure encryption is insufficient.
- Redact Redis key/value logs.

**MUST NOT**:

- Store plaintext access tokens unless required and protected.
- Store password hashes in Redis unless Redis is part of approved identity architecture.
- Store compliance/audit source-of-truth only in Redis.

### 17.3 Command Injection

Redis commands are not SQL, but unsafe dynamic command/key construction can still cause security issues.

**MUST**:

- Validate key components.
- Use typed APIs, not raw command strings, where possible.
- Allow-list dynamic command names if raw command execution is required.
- Treat Lua script args as data, not code.

**MUST NOT**:

- Concatenate user input into Lua script source.
- Expose generic Redis command endpoint.
- Let users choose Redis key prefix or command name.

---

## 18. Performance Standards

### 18.1 Command Choice

**MUST**:

- Check command complexity for hot-path commands.
- Avoid blocking/slow commands in request path.
- Prefer batch/pipeline for many independent commands when latency dominates.
- Prefer single multi-field command over many small round trips where safe.
- Measure with realistic key/value size and network latency.

**Forbidden in production request path by default**:

- `KEYS`
- `FLUSHALL`
- `FLUSHDB`
- `MONITOR`
- Unbounded `LRANGE`, `ZRANGE`, `HGETALL`, `SMEMBERS`
- Large `SCAN` in request path
- Slow Lua scripts

### 18.2 Pipelining Rules

**Allowed**:

- Bounded batch reads/writes where commands are independent.
- Bulk cache warmup with backpressure.

**MUST**:

- Bound pipeline size.
- Handle partial failures/command errors.
- Avoid unlimited memory accumulation.
- Record latency and batch size.

**MUST NOT**:

- Use pipeline to hide N+1 design without bounding.
- Pipeline non-idempotent writes with blind retry.

### 18.3 Hot Key Rules

**MUST**:

- Identify potential hot keys.
- Shard counters/sets if throughput requires it.
- Use local caching carefully for read-heavy stable data.
- Monitor command/key distribution if platform supports it.

**MUST NOT**:

- Put all tenants/users into one global key without capacity review.
- Store huge collections under one key if unbounded growth is possible.

---

## 19. Memory and Data Growth

### 19.1 Mandatory Memory Budget

Every Redis data model must define:

- Expected number of keys.
- Average and max value size.
- TTL/retention.
- Growth rate.
- Eviction behavior.
- Cleanup strategy.

### 19.2 Collection Growth Rules

**MUST**:

- Bound list/set/sorted-set/hash/stream growth.
- Use trimming, TTL, or cleanup job.
- Avoid `HGETALL`/`SMEMBERS` for unbounded collections.
- Page/range through large collections.

**MUST NOT**:

- Store unbounded per-user history without retention.
- Use Redis as document/blob store.
- Store multi-MB values without explicit approval.

---

## 20. Observability Standards

### 20.1 Required Metrics

**Client/application metrics**:

- Redis command latency.
- Timeout count.
- Error count by category.
- Pool active/idle/wait time.
- Cache hit/miss ratio by cache name.
- Serialization/deserialization failures.
- Circuit breaker state.
- Retry count.
- Lock acquisition latency/failure.
- Stream lag and pending entries.

**Server/platform metrics**:

- Memory used/maxmemory.
- Evicted keys.
- Expired keys.
- Connected clients.
- Blocked clients.
- Commandstats/slowlog.
- Replication lag.
- Cluster slot health.
- CPU usage.

### 20.2 Logging Rules

**MUST log**:

- Redis unavailable/degraded transitions.
- Serialization incompatibility.
- Lock contention above threshold.
- Stream poison message after bounded retries.
- Unexpected command timeout spikes.

**MUST NOT log**:

- Raw values.
- Secrets or passwords in connection URI.
- Full sensitive keys if key includes PII.
- High-cardinality key names as metric labels.

### 20.3 Tracing Rules

**MUST**:

- Trace Redis dependency calls if tracing is used in service.
- Use low-cardinality operation names.
- Do not attach full key/value as span attributes.
- Include Redis role/deployment name where safe.

---

## 21. Testing Standards

### 21.1 Unit Tests

Unit tests must cover:

- Key construction.
- TTL calculation and jitter bounds.
- Serialization/deserialization.
- Validation of user-controlled key parts.
- Lock token matching logic.
- Cache fallback behavior.
- Rate-limit edge cases.

### 21.2 Integration Tests

Integration tests must use real Redis-compatible service via Testcontainers or approved local infrastructure.

**MUST cover**:

- Connection and authentication.
- Timeout behavior.
- TTL expiration.
- Serializer compatibility.
- Atomic scripts.
- Lock acquire/release/failure.
- Pipeline/transaction behavior if used.
- Stream consumer group ack/reclaim if used.
- Cluster/Sentinel behavior where applicable.

### 21.3 Failure Tests

Where Redis is in critical request path, test:

- Redis down.
- Timeout.
- Slow response.
- Serialization error.
- Connection pool exhaustion.
- Failover/reconnect.
- Eviction/missing key.
- Duplicate command retry.
- Partial processing before crash.

---

## 22. Migration and Compatibility

### 22.1 Client Migration

When upgrading Redis client:

**MUST review**:

- Default timeout changes.
- Serialization changes.
- Cluster/Sentinel behavior.
- Pool behavior.
- Exception hierarchy.
- Reactive scheduler behavior.
- TLS/auth changes.
- Deprecated APIs.

### 22.2 Redis Server Migration

When upgrading Redis/server-compatible backend:

**MUST review**:

- Command availability.
- ACL behavior.
- Eviction/persistence defaults.
- Stream command behavior.
- Cluster failover behavior.
- Managed service limitations.
- Module compatibility.

### 22.3 Data Format Migration

**MUST**:

- Support old and new serialized versions during migration.
- Use versioned keys or versioned payloads.
- Avoid destructive mass rewrite without rollback.
- Have cleanup plan for old keys.

---

## 23. LLM Implementation Protocol

Before writing Redis code, the agent must produce a Redis design note:

```md
## Redis Design Note

- Use case:
- Client/library:
- Deployment mode:
- Source of truth:
- Failure behavior:
- Key pattern:
- Value format:
- TTL/retention:
- Atomicity requirement:
- Retry policy:
- Timeout policy:
- Security classification:
- Observability:
- Test coverage:
```

The agent must not implement Redis access until this note is satisfied by code, configuration, and tests.

---

## 24. Allowed / Restricted / Forbidden Summary

### 24.1 Allowed by Default

- Cache-aside with explicit TTL and serializer.
- Jedis pooled synchronous access for simple blocking applications.
- Lettuce managed client for async/reactive/high-concurrency applications.
- Spring Data Redis with explicit serializers.
- `SET key value NX EX/PX` for simple bounded lock acquisition.
- Redis Streams for bounded, replayable, Redis-native event use cases.
- Pub/Sub for best-effort notifications.
- Lua scripts for small atomic operations.

### 24.2 Restricted

- Distributed locks.
- Redlock.
- Redis as primary data store.
- Spring Cache abstraction.
- Redisson distributed objects.
- Transactions with `MULTI/EXEC`.
- Pipelining large batches.
- Redis Cluster multi-key operations.
- Stream processing for critical workflows.
- Storing PII/security-sensitive data.
- Lua scripts.
- `SCAN` jobs.

### 24.3 Forbidden by Default

- New client per request.
- No timeout.
- Blind retry of non-idempotent commands.
- Java native serialization.
- Hardcoded Redis credentials.
- Trust-all TLS.
- `KEYS` in production request path.
- `FLUSHALL`/`FLUSHDB` in application code.
- Plain `DEL` lock release without ownership token.
- `SETNX` then separate `EXPIRE` for locks.
- Pub/Sub for critical business events.
- Unbounded streams/lists/sets/hashes.
- Full key/value logging.
- High-cardinality metric labels from raw keys.

---

## 25. Review Checklist

A Redis change is not reviewable unless the PR answers these questions:

### Design

- [ ] What is Redis used for?
- [ ] Is Redis source of truth or cache?
- [ ] What happens if Redis is unavailable?
- [ ] What happens if Redis loses the key?
- [ ] What happens if Redis command times out after executing?
- [ ] What is the max key/value cardinality?

### Client and Config

- [ ] Is client lifecycle managed?
- [ ] Are timeouts explicit?
- [ ] Are retries bounded and idempotency-aware?
- [ ] Is TLS/auth configured securely?
- [ ] Are connection pools sized and monitored?

### Data

- [ ] Is key naming documented?
- [ ] Are user-controlled key parts validated?
- [ ] Is TTL/retention explicit?
- [ ] Is serialization explicit and versioned?
- [ ] Is sensitive data avoided or protected?

### Correctness

- [ ] Is atomicity requirement satisfied?
- [ ] Are multi-command workflows race-safe?
- [ ] Are locks ownership-token based?
- [ ] Are stream messages acked only after successful processing?
- [ ] Are retries safe?

### Performance

- [ ] Are command complexities acceptable?
- [ ] Are large collections bounded/paged?
- [ ] Are pipelines bounded?
- [ ] Are hot keys considered?
- [ ] Are memory limits and eviction behavior considered?

### Observability

- [ ] Are latency, errors, timeouts, hit/miss, and pool metrics emitted?
- [ ] Are logs redacted?
- [ ] Are traces low-cardinality?
- [ ] Are alerts defined for outage/memory/eviction/stream lag?

### Tests

- [ ] Are key/serializer/TTL unit tests present?
- [ ] Are integration tests run against real Redis?
- [ ] Are failure paths tested?
- [ ] Are lock/script/stream behaviors tested if used?

---

## 26. Agent Prompt Contract

Use this prompt contract when asking an LLM to implement Redis code:

```text
You are modifying Java code that uses Redis.

Follow strict-coding-standards__java_redis.md.

Before writing code:
1. Identify whether Redis is cache, coordination, lock, rate limit, idempotency store, stream, pub/sub, or data store.
2. State source-of-truth and failure behavior.
3. Define key pattern, value format, TTL/retention, timeout, retry, and observability.
4. Do not create Redis clients per request.
5. Do not use Java native serialization.
6. Do not use Redis without explicit timeout.
7. Do not use distributed locks unless ownership token, TTL, bounded wait, and safe release are implemented.
8. Do not use Pub/Sub for critical events.
9. Do not log raw keys/values/secrets.
10. Add tests for key construction, TTL, serialization, failure behavior, and Redis integration.

If any Redis semantics are uncertain, stop and produce a design note instead of guessing.
```

---

## 27. Source Anchors

- Redis data types, commands, expiration, eviction, transactions, Lua scripting, Streams, Cluster, Sentinel, and distributed lock documentation.
- Redis Java client documentation for Jedis and Lettuce.
- Spring Data Redis reference documentation.
- OWASP guidance for secrets, injection, TLS, and logging.
- Java networking, concurrency, JSON, security, logging, and telemetry standards in this repository.

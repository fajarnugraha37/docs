# Strict General Standards: Redis

> Mandatory conventions for LLMs, code agents, and engineers when designing, implementing, reviewing, or modifying Redis-based systems.

---

## 0. Purpose

Redis must be treated as a high-performance in-memory data structure server with optional durability, not as a generic replacement for the primary database, not as a magic distributed lock manager, not as an invisible global variable, and not as a free cache with infinite memory.

This standard exists to force every LLM-generated Redis implementation to preserve:

- explicit use-case fit;
- key ownership;
- memory safety;
- expiry semantics;
- cache consistency strategy;
- data structure correctness;
- atomicity boundaries;
- cluster-slot awareness;
- security boundaries;
- durability assumptions;
- failover behavior;
- observability;
- operational recoverability.

Redis code is only acceptable when the generated implementation explicitly handles key naming, TTL, serialization, memory limits, connection behavior, failure behavior, eviction consequences, security, and testability.

---

## 1. Core Mental Model

Redis is not one thing. It can be used as several different primitives, each with different correctness rules.

```text
Application -> Redis Client -> Redis Command -> Keyspace -> Data Structure -> Memory Policy -> Replication/Persistence/Cluster
```

Every Redis usage must be classified before implementation:

| Usage                     |                     Primary goal | Correctness risk                           |
| ------------------------- | -------------------------------: | ------------------------------------------ |
| Cache                     |              Reduce latency/load | stale data, stampede, eviction surprise    |
| Session store             |       Low-latency session lookup | logout invalidation, expiry, hijack impact |
| Rate limiter              |     Bound request/resource usage | race conditions, bypass, bad key scope     |
| Idempotency store         |           Deduplicate operations | TTL too short, non-atomic write/check      |
| Lock/lease                | Coordinate temporary exclusivity | split brain, clock/drift, unsafe release   |
| Queue/stream              |                 Async processing | ack/retry/loss/ordering semantics          |
| Counter                   |                 Fast aggregation | overflow, approximate vs exact semantics   |
| Leaderboard               |                   Sorted ranking | score precision, memory growth             |
| Feature flag/config cache |                      Fast lookup | stale or inconsistent rollout              |
| Pub/Sub                   |                Ephemeral fan-out | lost messages for disconnected subscribers |

The LLM must not generate Redis code until it has identified which of these models applies.

---

## 2. Scope

This standard applies to:

- Redis Open Source;
- Redis Enterprise/Cloud-compatible designs;
- application Redis clients;
- cache-aside flows;
- write-through/write-behind/read-through cache abstractions;
- session storage;
- distributed rate limiting;
- idempotency keys;
- Redis Streams;
- Redis Pub/Sub;
- Redis transactions;
- Lua scripts / Redis Functions;
- distributed lock/lease patterns;
- Redis Cluster key design;
- Redis ACL/security configuration;
- observability and operational dashboards.

This standard does not replace the OLTP database design standard, event design standard, Kafka/RabbitMQ standards, or security design standard.

---

## 3. Version and Product Policy

### 3.1 Version Must Be Explicit

The LLM must not assume a Redis version silently.

Every Redis-related implementation must state one of:

```text
Redis minimum version: <version>
Redis deployment mode: standalone | sentinel | cluster | managed cloud | enterprise
Redis durability mode: none | RDB | AOF | RDB+AOF | managed
Redis client library: <name + version>
```

### 3.2 Redis 8+ Feature Guardrail

Redis 8 integrates features that were previously separate Redis Stack modules, including search, JSON, time series, probabilistic structures, and vector-related capabilities.

LLMs must not generate Redis Search, JSON, TimeSeries, Bloom/Cuckoo, TopK, t-digest, or vector-set usage unless:

- the target Redis version supports the command;
- the deployment has those features enabled;
- ACL categories allow those commands;
- memory and persistence impact are documented;
- fallback behavior is defined.

### 3.3 Do Not Confuse Redis With Valkey or Other Forks

Redis-compatible systems may not support the same commands, modules, licenses, performance characteristics, clustering behavior, or managed-service features.

The LLM must not write:

```text
Redis-compatible means identical.
```

It must write:

```text
Compatibility must be validated against the target server and client library.
```

---

## 4. Non-Negotiable Rules

### 4.1 Redis Must Not Be Used Without a Fit Justification

Acceptable Redis reasons include:

- low-latency repeated reads;
- bounded ephemeral state;
- TTL-based state lifecycle;
- atomic counters;
- short-lived idempotency markers;
- rate-limiting state;
- sorted ranking;
- stream processing with Redis Streams semantics;
- temporary coordination where lease loss is safe;
- reducing load on a slower primary system.

Unacceptable reasons include:

- "Redis is fast";
- "microservices need cache";
- "we do not want to model the database properly";
- "we need a global variable";
- "we need distributed transactions";
- "we need a durable event log like Kafka";
- "we need a reliable task queue" without ack/retry/redelivery design.

### 4.2 Redis Must Have a Key Ownership Model

Every key pattern must have an owning service or component.

Required key definition:

```text
Key pattern: <namespace>:<domain>:<id>:<field>
Owner: <service/component>
Data type: string | hash | set | zset | list | stream | json | etc.
TTL: required | forbidden | optional; duration and reason
Cardinality: expected number of keys
Value size: expected p50/p95/max
Mutation path: create/update/delete
Invalidation path: TTL | explicit delete | versioned key | event-driven
PII/secrets: yes/no
```

No generated Redis key may be anonymous, ad hoc, or globally shared without ownership.

### 4.3 Expiry Must Be Explicit

For every key, TTL must be one of:

- **required**: key must expire;
- **forbidden**: key must not expire because it represents persistent state;
- **optional**: key may expire but correctness does not depend on expiry.

The LLM must not create cache/session/idempotency/rate-limit keys without TTL unless it justifies why no TTL is safe.

### 4.4 Memory Limit and Eviction Policy Must Be Declared

Redis is memory-bound.

Any Redis design must specify:

```text
maxmemory: <value or managed policy>
maxmemory-policy: noeviction | allkeys-lru | allkeys-lfu | volatile-lru | volatile-lfu | etc.
OOM behavior: reject write | evict cache | degrade feature | fallback to DB
Monitoring: used_memory, maxmemory, evicted_keys, keyspace_hits, keyspace_misses
```

If eviction can break correctness, the key must not live in an evictable Redis database.

### 4.5 Do Not Store Irreplaceable System of Record Data in Redis by Accident

Redis may be used as a primary data store only when explicitly designed as such, with persistence, backup, recovery, replication/failover, and loss tolerance documented.

Default assumption:

```text
Redis data is ephemeral unless explicitly proven durable.
```

### 4.6 Redis Failures Must Be Handled Explicitly

Every Redis call must be classified as:

| Dependency type            | Failure behavior                                                    |
| -------------------------- | ------------------------------------------------------------------- |
| Optional cache             | bypass Redis, call source of truth                                  |
| Required session store     | fail closed or require re-authentication                            |
| Required rate limiter      | fail closed for sensitive APIs, fail open only with risk acceptance |
| Required idempotency store | fail safely; do not double-submit irreversible operations           |
| Required lock              | abort guarded operation                                             |
| Stream/queue               | retry with backoff and preserve idempotency                         |

The LLM must not generate Redis code where a timeout or connection failure produces undefined behavior.

### 4.7 Serialization Must Be Stable and Versioned

Serialized values must declare:

- format: JSON, MessagePack, protobuf, plain string, integer, etc.;
- schema version;
- encoding;
- compatibility policy;
- maximum size;
- compression rule if any;
- backward/forward compatibility requirements.

Do not store arbitrary language-native serialized objects unless the tradeoff is explicitly accepted.

Forbidden by default:

- Java native serialization;
- Python pickle;
- framework-specific binary session blobs without versioning;
- values that cannot be decoded by other services if cross-service access is expected.

### 4.8 One Redis Database Must Not Become a Shared Mutable Dump

Different use cases with different eviction, durability, security, and blast-radius requirements should use separate Redis logical databases, clusters, namespaces, or managed databases.

Do not mix:

- cache and idempotency correctness state;
- sessions and public cache;
- rate limiter state and durable business state;
- hot volatile cache and long-lived streams;
- tenant-isolated secrets and shared public lookup keys.

### 4.9 Redis Is Not a Universal Message Broker

Redis Pub/Sub is ephemeral. It is not durable delivery.

Redis Streams can support consumer groups and replay-like behavior, but they are not Kafka and must be designed with stream length, pending entries, ack behavior, retry/claiming, trimming, and memory in mind.

Use Kafka/RabbitMQ when the requirements are better aligned with those systems.

### 4.10 Distributed Locks Must Be Treated as Leases

Redis locks are time-bound leases, not permanent ownership and not a replacement for database constraints.

A Redis-based lock is acceptable only when:

- the operation is safe if the lock expires while work continues;
- lock value is random and unique per owner;
- release is compare-and-delete, not blind delete;
- TTL is always set atomically;
- operation has timeout shorter than lease or explicit extension protocol;
- retry/backoff exists;
- correctness does not depend on perfect mutual exclusion under all partitions unless a consensus system is used.

For correctness-critical mutual exclusion, use database constraints/transactions or a consensus-backed system.

---

## 5. Key Naming Standard

### 5.1 Required Key Format

Use colon-separated names:

```text
<env>:<service>:<domain>:<entity-id>:<purpose>[:<sub-key>]
```

Examples:

```text
prod:case-service:case:CASE-123:snapshot
prod:auth-service:session:SID-abc123
prod:api-gateway:rate-limit:user:U-123:/v1/cases
prod:notification:idempotency:request:REQ-789
prod:leaderboard:campaign:CMP-456:scores
```

For Redis Cluster, use hash tags when multi-key operations must target the same slot:

```text
prod:case-service:case:{CASE-123}:snapshot
prod:case-service:case:{CASE-123}:lock
prod:case-service:case:{CASE-123}:events
```

### 5.2 Key Naming Rules

LLMs must follow these rules:

- key names must include service/domain ownership;
- do not use raw user-controlled input without normalization;
- do not include secrets, emails, tokens, or PII in key names;
- key names must be bounded in length;
- high-cardinality key families must be documented;
- key prefixes must support safe scanning by namespace;
- cluster hash tags must be intentional and documented.

### 5.3 Forbidden Key Patterns

Forbidden:

```text
user:<email>
token:<raw-token>
session
cache:<full-url-with-querystring>
lock:<unbounded-user-input>
tmp:<random-with-no-ttl>
```

Required alternatives:

```text
prod:auth:user:<user-id>:profile-cache
prod:auth:token:<sha256-token-prefix>:metadata
prod:auth:session:<session-id>
prod:web:cache:<stable-route-hash>
prod:workflow:lock:<workflow-id>
prod:service:tmp:<uuid>  # with TTL
```

---

## 6. Data Type Selection Rules

### 6.1 Strings

Use strings for:

- simple scalar values;
- small serialized documents;
- counters with `INCR`/`DECR`;
- idempotency markers;
- lock tokens.

Rules:

- define maximum value size;
- use `SET key value EX <ttl> NX` for create-if-absent TTL markers;
- use `GETDEL` or compare-and-delete scripts when ownership matters;
- avoid large JSON blobs when partial field access is required.

### 6.2 Hashes

Use hashes for:

- small field-addressable objects;
- object cache where partial updates are useful;
- compact storage of many fields under one key.

Rules:

- do not create unbounded hashes;
- field names must be stable;
- object-level TTL applies to the key, not individual fields unless Redis version/commands support field expiry and the behavior is validated;
- do not use hashes as a replacement for relational tables.

### 6.3 Sets

Use sets for:

- membership checks;
- deduplication;
- small-to-medium tag/group membership.

Rules:

- estimate cardinality;
- define cleanup/expiry strategy;
- avoid storing huge tenant-wide sets without sharding or memory model.

### 6.4 Sorted Sets

Use sorted sets for:

- leaderboards;
- priority ranking;
- time-ordered small queues;
- sliding-window rate limiting.

Rules:

- define score semantics;
- define score precision and tie behavior;
- trim old entries;
- document expected cardinality;
- do not use zsets as a durable task queue without retry/ack semantics.

### 6.5 Lists

Use lists only for simple FIFO/LIFO patterns where reliability semantics are understood.

Prefer Redis Streams for multi-consumer processing, pending entries, replay-ish behavior, and consumer groups.

### 6.6 Streams

Use streams for:

- append-only event-like records;
- consumer groups;
- basic Redis-native streaming;
- short-to-medium retention event processing.

Rules:

- every stream must define retention/trimming policy;
- every consumer group must define ack and retry/claim behavior;
- pending entries must be monitored;
- stream record IDs must not be treated as business IDs;
- consumers must be idempotent;
- stream processing must survive duplicate delivery.

### 6.7 Pub/Sub

Use Pub/Sub only for ephemeral notifications.

Acceptable:

- cache invalidation hints;
- live UI notifications where loss is acceptable;
- local fan-out where subscribers can reconnect and recover elsewhere.

Forbidden:

- payment processing;
- audit events;
- durable business workflow;
- required notification delivery;
- commands that must execute exactly once.

### 6.8 JSON / Search / Vector / Time Series / Probabilistic Structures

These Redis 8+ integrated data structures/features may be used only when:

- version compatibility is declared;
- command availability is tested;
- ACL categories are configured;
- query/index memory cost is estimated;
- fallback/degradation path exists;
- schema evolution is defined.

Do not use them merely because they are available.

---

## 7. Cache Design Standard

### 7.1 Default Pattern: Cache-Aside

Default cache pattern:

```text
1. read cache
2. if hit: return cached value
3. if miss: read source of truth
4. write cache with TTL
5. return value
```

This is acceptable only when:

- stale data is tolerable for the TTL duration;
- cache stampede is controlled;
- serialization is versioned;
- source-of-truth fallback is available;
- negative caching is carefully bounded.

### 7.2 TTL Rules

Each cache key must define:

```text
TTL: <duration>
Jitter: <percentage or duration>
Staleness tolerance: <duration>
Invalidation: TTL-only | explicit delete | event-driven | versioned keys
Negative cache TTL: <duration or forbidden>
```

Apply TTL jitter for high-volume keys to avoid synchronized expiry.

### 7.3 Cache Stampede Protection

For expensive cache misses, use one or more:

- request coalescing;
- short lease/mutex with fallback;
- stale-while-revalidate pattern;
- probabilistic early refresh;
- background refresh;
- per-key rate limiting.

LLMs must not generate naive high-traffic cache-aside logic for hot keys.

### 7.4 Negative Caching

Negative caching may be used for `not found` or known invalid lookups only if:

- TTL is short;
- value distinguishes negative result from Redis miss;
- authorization/tenant context is included in the key if relevant;
- creation-after-negative-cache is considered.

Forbidden:

```text
cache "user does not exist" for 1 day without invalidation.
```

### 7.5 Write Invalidation

For mutable source-of-truth data, cache invalidation strategy must be explicit:

| Strategy                  | Acceptable when                         |
| ------------------------- | --------------------------------------- |
| TTL-only                  | stale data is acceptable                |
| Delete-on-write           | writes go through known service path    |
| Versioned key             | stale old value can expire naturally    |
| Event-driven invalidation | multiple writers/readers exist          |
| Write-through             | cache must update with write path       |
| Write-behind              | only when loss/reorder risk is accepted |

Do not generate write-behind cache for correctness-critical state without a durable queue and replay strategy.

---

## 8. Session Store Standard

Redis may be used for session storage if:

- session IDs are high entropy;
- session values do not contain raw passwords, tokens, or unnecessary PII;
- session TTL and idle timeout are explicit;
- logout deletes/invalidate session key;
- session fixation is prevented;
- session rotation after privilege elevation is supported;
- failover behavior is defined;
- session store is not mixed with public cache keys.

Required key example:

```text
prod:auth-service:session:<session-id>
```

Required metadata:

```json
{
  "userId": "U-123",
  "createdAt": "2026-06-10T10:00:00Z",
  "lastSeenAt": "2026-06-10T10:05:00Z",
  "authLevel": "mfa",
  "schemaVersion": 1
}
```

Do not use Redis sessions as authorization source-of-truth unless permission revocation and cache invalidation are designed.

---

## 9. Rate Limiting Standard

### 9.1 Required Dimensions

Every rate limiter must define:

```text
Subject: user | tenant | IP | API key | service account | composite
Resource: route | endpoint group | operation | global
Window: fixed | sliding | token bucket | leaky bucket
Limit: <number>/<duration>
Burst: <number>
Response: HTTP 429 or domain-specific rejection
Headers: Retry-After and rate limit metadata if applicable
Fail mode: open | closed | degraded; with justification
```

### 9.2 Atomicity

Rate limit increments and expiry must be atomic.

Acceptable:

- Lua script;
- Redis Function;
- single-command atomic structure;
- transaction with `WATCH` where appropriate;
- sorted-set sliding window with atomic script.

Forbidden:

```text
GET count
if count < limit:
  SET count + 1
```

### 9.3 Key Scope

Rate-limit keys must include the security boundary.

Examples:

```text
prod:gateway:rl:tenant:<tenant-id>:route:<route-id>
prod:gateway:rl:user:<user-id>:operation:create-case
prod:gateway:rl:ip:<ip-hash>:login
```

Never use a global rate-limit key when per-user or per-tenant isolation is required.

---

## 10. Idempotency Standard

Redis may be used for idempotency keys only when the operation can tolerate Redis availability and TTL assumptions.

Required fields:

```text
Idempotency key source: client-provided | server-generated
Scope: tenant + actor + operation + request fingerprint
TTL: <duration>
Stored value: in-progress | completed result reference | failure state
Atomic create: SET NX EX or script
Replay behavior: return prior result | reject duplicate | wait/retry
```

Required pattern:

```text
SET idemKey in-progress NX EX <ttl>
if not set:
  read existing state
  decide duplicate behavior
perform operation
store completed state/result reference with TTL
```

Do not use idempotency keys without including tenant/actor/operation scope.

---

## 11. Lock and Lease Standard

### 11.1 Single-Instance Lock Pattern

For non-critical coordination where best-effort mutual exclusion is acceptable:

```text
SET lockKey randomValue NX PX leaseMillis
```

Release with compare-and-delete:

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
```

### 11.2 Lock Rules

Mandatory:

- lock value must be random and unique;
- lock must have TTL;
- release must verify ownership;
- lock acquisition must have timeout and bounded retries;
- guarded work must be idempotent or compensatable;
- lock expiration during work must be handled;
- metrics must track contention and timeout.

Forbidden:

```text
SET lockKey "locked"
DEL lockKey
```

### 11.3 Correctness-Critical Lock Warning

For financial correctness, legal enforcement state transitions, inventory correctness, or irreversible side effects, Redis locks alone are usually not enough.

Use:

- database unique constraints;
- optimistic locking;
- serializable transaction;
- advisory lock in the same database as the data;
- workflow engine with state transition guards;
- consensus-backed coordination system.

---

## 12. Transactions, Lua, and Functions

### 12.1 Redis Transactions

Redis transactions with `MULTI`/`EXEC` queue commands and execute them as a unit. They are not equivalent to relational database transactions with rollback semantics.

Use transactions for:

- grouped atomic updates;
- optimistic concurrency with `WATCH`;
- simple multi-command consistency.

Do not use Redis transactions as a replacement for OLTP transaction boundaries.

### 12.2 WATCH

Use `WATCH` for optimistic concurrency only when:

- watched keys are few and known;
- retry count is bounded;
- operation is idempotent;
- cluster slot behavior is understood.

### 12.3 Lua Scripts / Redis Functions

Lua scripts or Redis Functions may be used for atomic multi-step logic.

Rules:

- keep scripts small and deterministic;
- pass keys in `KEYS[]`, not hidden inside `ARGV[]`;
- avoid long-running scripts;
- avoid unbounded loops;
- include script versioning;
- include tests for edge cases;
- consider cluster key-slot constraints;
- avoid embedding business policy that belongs in application/domain code.

Forbidden:

```text
Redis Lua script as hidden domain service.
```

---

## 13. Redis Streams Standard

### 13.1 Stream Definition

Every stream must define:

```text
Stream key: <key>
Producer owner: <service>
Consumer groups: <groups>
Message schema: <versioned schema>
Retention: maxlen/time/manual trim
Ordering scope: per stream key
Ack behavior: XACK after side effect or before side effect; justify
Retry: XPENDING/XCLAIM/XAUTOCLAIM strategy
DLQ: yes/no and format
Idempotency: consumer-side key or sink-side constraint
```

### 13.2 Consumer Group Rules

Consumers must:

- process with manual acknowledgement;
- monitor pending entries;
- reclaim abandoned messages;
- handle duplicates;
- bound concurrency;
- apply backpressure;
- expose lag metrics;
- define poison-message behavior.

### 13.3 Stream Trimming

Stream trimming must not delete entries required by slow consumers unless loss is acceptable.

Required:

```text
XADD key MAXLEN ~ <limit> ...
```

or an explicit retention job with consumer lag awareness.

### 13.4 When Not to Use Redis Streams

Do not use Redis Streams when:

- long-term replay is required;
- many independent consumer groups need durable history;
- event log retention is measured in months/years;
- schema governance and stream processing are central requirements;
- cross-region event durability is required.

Use Kafka or another event streaming system instead.

---

## 14. Pub/Sub Standard

Redis Pub/Sub must be treated as ephemeral message delivery.

Allowed:

- cache invalidation hints;
- best-effort UI notifications;
- local coordination where loss is acceptable.

Required documentation:

```text
Message loss acceptable: yes/no
Subscriber reconnect behavior: <behavior>
Recovery source: <source of truth if message missed>
Channel naming: <namespace>
Payload schema: <format>
```

If missed messages are not acceptable, do not use Pub/Sub.

---

## 15. Redis Cluster Standard

### 15.1 Cluster Slot Awareness

Redis Cluster partitions keys into hash slots. Multi-key operations require keys to be in the same slot.

When multi-key operations are required, use hash tags intentionally:

```text
prod:case:{CASE-123}:snapshot
prod:case:{CASE-123}:lock
prod:case:{CASE-123}:metadata
```

### 15.2 Cluster Rules

LLMs must:

- avoid cross-slot multi-key operations;
- use cluster-aware clients;
- handle `MOVED`/`ASK` redirections through client library;
- define key hash tags only for real co-location needs;
- avoid hot hash tags that overload a single shard;
- test cluster mode separately from standalone mode.

### 15.3 Hot Key Prevention

Every design must identify hot-key risk.

Hot key examples:

```text
global:config
leaderboard:global
rate-limit:all-users
cache:homepage
```

Mitigations:

- local in-process cache;
- sharded keys;
- request coalescing;
- TTL jitter;
- fan-out on write;
- separate read replicas if safe;
- reduce update frequency.

---

## 16. Persistence, Replication, and HA

### 16.1 Persistence Policy

Every Redis deployment must declare persistence:

| Mode               | Use case                  | Risk                           |
| ------------------ | ------------------------- | ------------------------------ |
| No persistence     | pure cache                | all data lost on restart       |
| RDB                | snapshots/backups         | recent writes may be lost      |
| AOF                | better write durability   | disk growth/rewrite cost       |
| RDB + AOF          | stronger recovery posture | operational complexity         |
| Managed durability | provider-specific         | must understand SLA and config |

### 16.2 Replication Policy

Redis replication improves availability and read scaling but does not make every write synchronously durable by default.

Rules:

- document async replication risk;
- know failover behavior;
- do not assume read-after-write from replicas unless guaranteed;
- avoid using replicas for correctness-sensitive reads;
- monitor replication lag;
- define backup/restore procedure.

### 16.3 Sentinel / Cluster / Managed HA

Deployment mode must be explicit:

```text
standalone: dev/test or low-criticality only
sentinel: HA for primary-replica topology
cluster: horizontal sharding with hash slots
managed cloud: provider-specific HA and operational controls
```

LLMs must not generate production Redis deployment without HA, persistence/loss-tolerance, backup, and monitoring decisions.

---

## 17. Security Standard

### 17.1 Network Exposure

Redis must not be exposed directly to the public internet.

Required:

- private network placement;
- security group/firewall restriction;
- TLS when crossing untrusted networks;
- authenticated clients;
- least-privilege ACL users;
- admin commands restricted;
- no shared default credentials;
- protected mode not disabled casually.

### 17.2 ACL Rules

Use separate Redis users per application/service.

Required ACL principles:

- allow only needed commands/categories;
- restrict key patterns by prefix;
- disable dangerous/admin commands for application users;
- rotate credentials;
- separate read-only from write users when useful;
- validate Redis 8 ACL category changes before upgrade.

Example intent:

```text
user case-service: can read/write prod:case-service:*; cannot FLUSHDB, CONFIG, EVAL unless justified
user reporting-service: can read prod:case-service:read-model:* only
```

### 17.3 Secrets and PII

Forbidden:

- raw credentials in Redis values;
- long-lived secrets in Redis cache;
- PII in key names;
- access tokens without encryption/TTL/risk review;
- debug dumps containing Redis values.

If sensitive data must be cached:

- minimize fields;
- encrypt at application level where required;
- use short TTL;
- use strict ACL;
- redact logs;
- document retention.

---

## 18. Client Usage Standard

### 18.1 Connection Management

LLMs must use production-grade clients with:

- pooling or multiplexing appropriate to the library;
- timeouts;
- retry policy with backoff;
- circuit breaker where Redis is not optional;
- cluster/sentinel support when deployed that way;
- TLS/auth support;
- metrics instrumentation.

Forbidden:

```text
new Redis connection per request
infinite timeout
infinite retry
blocking Redis command on request thread without timeout
```

### 18.2 Timeout Policy

Required timeouts:

```text
connect timeout
command timeout
pool acquisition timeout
retry budget
circuit breaker threshold
```

Cache calls should usually have low timeouts and graceful fallback.

### 18.3 Pipelining

Use pipelining for many independent commands when latency matters.

Rules:

- do not pipeline unbounded batches;
- handle partial failure semantics;
- preserve result ordering assumptions;
- avoid making single requests too large;
- benchmark under realistic network conditions.

### 18.4 Blocking Commands

Blocking commands (`BLPOP`, `BRPOP`, `XREAD BLOCK`, etc.) must specify:

- maximum block duration;
- shutdown/cancellation behavior;
- connection pool isolation;
- retry behavior;
- backpressure behavior.

Do not let blocking consumers starve normal request Redis connections.

---

## 19. Observability Standard

### 19.1 Required Metrics

Every Redis deployment or client integration must expose:

- availability;
- command latency;
- command error rate;
- timeout rate;
- connection pool usage;
- used memory;
- memory fragmentation;
- maxmemory percentage;
- evicted keys;
- expired keys;
- keyspace hits/misses;
- connected clients;
- rejected connections;
- slowlog count;
- replication lag;
- stream length;
- consumer group lag;
- pending stream entries;
- lock contention;
- rate limiter rejections.

### 19.2 Required Logs

Application logs must include:

- Redis operation category, not raw full key if it contains sensitive identifiers;
- timeout/failure reason;
- fallback path;
- correlation ID / trace ID;
- cache hit/miss where useful;
- rate-limit decision;
- lock acquisition/release failure.

Do not log raw values or secrets.

### 19.3 Required Alerts

Minimum alerts:

- Redis unavailable;
- high command latency;
- high timeout/error rate;
- memory near maxmemory;
- unexpected eviction for correctness-critical DB;
- high fragmentation;
- replication lag;
- stream pending entries growing;
- consumer group stalled;
- connection saturation;
- blocked clients;
- persistence failure;
- backup failure.

---

## 20. Testing Standard

### 20.1 Unit Tests

Unit tests must cover:

- key generation;
- serialization/deserialization;
- TTL assignment;
- cache hit/miss behavior;
- negative caching;
- idempotency duplicate handling;
- rate limiter boundaries;
- lock release ownership;
- stream consumer duplicate handling.

### 20.2 Integration Tests

Integration tests must use a real Redis-compatible server, not only mocks.

Test:

- Redis unavailable;
- timeout;
- OOM/noeviction behavior where feasible;
- eviction simulation;
- TTL expiration;
- concurrent access;
- cluster key slot behavior if using cluster;
- stream pending/reclaim behavior;
- ACL permission denial;
- script/function behavior.

### 20.3 Load Tests

Load tests must measure:

- p50/p95/p99 command latency;
- hit ratio;
- memory growth;
- hot key behavior;
- connection pool saturation;
- eviction rate;
- CPU/network throughput;
- failover impact.

---

## 21. Deployment and Configuration Standard

### 21.1 Configuration Must Be Externalized

Required configuration:

```text
REDIS_URL or host/port
REDIS_USERNAME
REDIS_PASSWORD source
REDIS_TLS_ENABLED
REDIS_CONNECT_TIMEOUT
REDIS_COMMAND_TIMEOUT
REDIS_POOL_SIZE
REDIS_MAX_RETRIES
REDIS_KEY_PREFIX
REDIS_CLUSTER_ENABLED
REDIS_SENTINEL_ENABLED
```

Do not hardcode Redis host, password, database number, key prefix, TTL, or timeout.

### 21.2 Environment Separation

Redis keys must include environment or be isolated by environment-level database/cluster.

Do not allow dev/test/staging/prod to share the same Redis keyspace unless intentionally designed for shared test infrastructure.

### 21.3 Infrastructure-as-Code

Production Redis infrastructure must be managed as code.

Required IaC aspects:

- version/family;
- node size;
- persistence;
- backup;
- replication/HA;
- TLS/auth;
- ACL/users/secrets;
- network isolation;
- memory policy;
- metrics/logging;
- maintenance windows;
- tags/ownership.

---

## 22. Anti-Patterns

### 22.1 Redis as Primary Database by Accident

Bad:

```text
Store business records only in Redis because it is fast.
```

Good:

```text
Use OLTP database as source of truth; use Redis as cache/read accelerator.
```

Redis can be a primary data store only with explicit durability and recovery design.

### 22.2 No TTL on Ephemeral Keys

Bad:

```text
SET tmp:<uuid> value
```

Good:

```text
SET prod:service:tmp:<uuid> value EX 300
```

### 22.3 Blind Distributed Lock

Bad:

```text
SETNX lock order-123
DEL lock
```

Good:

```text
SET lockKey randomValue NX PX 30000
release only if value matches randomValue
```

### 22.4 Cache Without Invalidation Policy

Bad:

```text
Cache user permissions for 24h with no revocation path.
```

Good:

```text
Cache permissions for short TTL, include permission version, invalidate on role changes.
```

### 22.5 Redis Pub/Sub for Durable Workflow

Bad:

```text
Publish payment command over Redis Pub/Sub.
```

Good:

```text
Use durable broker/workflow/event log with idempotent consumers.
```

### 22.6 One Giant Shared Redis

Bad:

```text
All services share one Redis with default user and arbitrary keys.
```

Good:

```text
Separate databases/namespaces/ACLs by use case, owner, and blast radius.
```

### 22.7 Unbounded Keys and Values

Bad:

```text
Keep appending every user event into one list forever.
```

Good:

```text
Use bounded stream retention, OLAP/event log for long-term history, and explicit archival.
```

### 22.8 Treating Eviction as Harmless

Bad:

```text
Use allkeys-lru for sessions/idempotency/locks.
```

Good:

```text
Use noeviction or separate Redis for correctness-critical state; volatile cache can use eviction.
```

### 22.9 Using KEYS in Production Request Path

Bad:

```text
KEYS prod:service:*
```

Good:

```text
Maintain indexes explicitly or use SCAN in controlled background/admin paths.
```

### 22.10 Business Logic Hidden in Lua

Bad:

```text
Put full approval workflow rules inside a Redis script.
```

Good:

```text
Keep domain policy in application/domain layer; use Lua only for atomic Redis state transitions.
```

---

## 23. LLM Implementation Algorithm

Before generating Redis code, the LLM must complete this reasoning sequence:

```text
1. Identify Redis use case.
2. Identify owner service/component.
3. Decide whether Redis is optional or required.
4. Define key pattern and data type.
5. Define TTL/expiry rule.
6. Define memory and eviction consequence.
7. Define serialization format and version.
8. Define atomicity requirement.
9. Define failure behavior.
10. Define security/ACL boundary.
11. Define observability.
12. Define tests.
13. Generate code/config.
14. Re-check anti-patterns.
```

The LLM must not skip directly to client calls.

---

## 24. Required Design Template

For every Redis feature, include:

```md
## Redis Usage: <name>

### Purpose

<cache/session/rate-limit/idempotency/stream/etc.>

### Owner

<service/component>

### Dependency Criticality

<optional|required> and fail-open/fail-closed behavior.

### Key Model

- Pattern:
- Data type:
- TTL:
- Cardinality:
- Value size:
- Cluster hash tag:

### Value Schema

- Format:
- Schema version:
- Sensitive fields:

### Consistency Model

- Source of truth:
- Staleness tolerance:
- Invalidation:
- Atomicity:

### Memory Policy

- maxmemory assumption:
- eviction policy:
- consequence of eviction:

### Security

- ACL user:
- Key prefix access:
- TLS:
- Secrets handling:

### Failure Behavior

- Redis unavailable:
- Redis timeout:
- OOM/noeviction:
- failover:

### Observability

- Metrics:
- Logs:
- Alerts:

### Tests

- Unit:
- Integration:
- Concurrency/failure:
```

---

## 25. Review Checklist

A Redis implementation is acceptable only if all applicable items pass.

### Use-Case Fit

- [ ] Redis usage type is explicitly classified.
- [ ] Redis is justified over database/local cache/Kafka/RabbitMQ.
- [ ] Redis criticality is declared.
- [ ] Fallback/failure behavior is defined.

### Key and Data Model

- [ ] Key pattern is documented.
- [ ] Key owner is documented.
- [ ] Key names do not contain secrets or PII.
- [ ] Data type is appropriate.
- [ ] Cardinality and value size are estimated.
- [ ] Serialization is stable and versioned.

### TTL and Memory

- [ ] TTL is explicit.
- [ ] Expiry behavior is tested.
- [ ] `maxmemory` assumption is documented.
- [ ] Eviction policy is compatible with correctness.
- [ ] Hot-key risk is addressed.

### Correctness

- [ ] Cache invalidation is defined.
- [ ] Rate limiter operations are atomic.
- [ ] Idempotency operations are atomic.
- [ ] Lock release checks ownership.
- [ ] Stream consumers are idempotent.
- [ ] Pub/Sub is not used for durable workflow.

### Cluster and HA

- [ ] Deployment mode is explicit.
- [ ] Cluster slot behavior is understood.
- [ ] Multi-key operations are slot-safe.
- [ ] Replication/failover assumptions are documented.
- [ ] Backup/restore is defined if Redis stores important data.

### Security

- [ ] Redis is not publicly exposed.
- [ ] TLS/auth is configured where required.
- [ ] ACL users are least-privilege.
- [ ] Dangerous commands are restricted.
- [ ] Sensitive values are minimized/redacted.

### Observability and Operations

- [ ] Redis metrics are exported.
- [ ] Client latency/errors/timeouts are tracked.
- [ ] Memory/eviction alerts exist.
- [ ] Slowlog/blocked clients are monitored.
- [ ] Stream lag/pending entries are monitored.

### Testing

- [ ] Unit tests cover key generation and TTL.
- [ ] Integration tests use real Redis.
- [ ] Concurrency tests cover atomic flows.
- [ ] Failure tests cover Redis unavailable/timeouts.
- [ ] Cluster tests exist if using Redis Cluster.

---

## 26. Acceptance Criteria

A Redis implementation is production-ready only when:

1. Redis use case is explicitly justified.
2. Key model and TTL are documented.
3. Memory and eviction behavior are safe for the use case.
4. Redis is not accidental source of truth.
5. Serialization is versioned.
6. Failure behavior is deterministic.
7. Security and ACL are least-privilege.
8. Metrics, logs, and alerts exist.
9. Tests cover expiry, concurrency, and failure.
10. Anti-patterns in this document are not present.

---

## 27. Enforcement Snippet for LLMs

Use this instruction when asking an LLM/code agent to write Redis-related code:

```text
You must follow strict-general-standards__redis.md.
Before writing Redis code, classify the Redis use case, define key pattern, owner, data type, TTL, memory/eviction behavior, serialization format, consistency model, failure behavior, security/ACL boundary, and observability. Do not use Redis as an accidental primary database, do not create keys without TTL when ephemeral, do not use Pub/Sub for durable workflow, do not use unsafe distributed locks, and do not ignore cluster/memory/failover behavior. If the requirement needs durable event streaming, use Kafka/RabbitMQ standards instead. If the requirement needs transactional source-of-truth state, use OLTP database standards instead.
```

---

## 28. References

- Redis documentation: https://redis.io/docs/latest/
- Redis Open Source 8 release notes: https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.0-release-notes/
- Redis persistence: https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/
- Redis key eviction: https://redis.io/docs/latest/develop/reference/eviction/
- Redis transactions: https://redis.io/docs/latest/develop/using-commands/transactions/
- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
- Redis Pub/Sub: https://redis.io/docs/latest/develop/pubsub/
- Redis Cluster specification: https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/
- Redis distributed locks: https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/
- Martin Kleppmann, distributed locking critique: https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html

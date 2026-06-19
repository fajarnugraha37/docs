# learn-redis-mastery-for-java-engineers-part-031.md

# Part 031 — Redis Design Patterns for Backend Systems

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: pola desain Redis yang benar-benar dipakai dalam backend production, beserta kontrak, batas, failure mode, dan decision matrix.

---

## 0. Posisi Bagian Ini dalam Seri

Sampai part sebelumnya, kita sudah membongkar Redis dari bawah ke atas:

- command execution model
- keyspace dan data types
- TTL, expiration, eviction
- caching dan consistency
- rate limiting
- idempotency
- distributed locks
- Lua/functions
- Pub/Sub dan Streams
- persistence, replication, Sentinel, Cluster
- memory, latency, client Java
- transaction model
- security, observability, operations, testing

Bagian ini menyatukan semua itu menjadi **design patterns**.

Namun istilah “pattern” di sini tidak berarti template copy-paste. Pattern Redis yang matang harus menjawab:

1. **Data apa yang disimpan?**
2. **Apakah Redis source of truth atau derived state?**
3. **Apa lifecycle key-nya?**
4. **Apa semantics ketika key hilang?**
5. **Apa yang terjadi saat Redis lambat/down/failover?**
6. **Apakah data boleh stale?**
7. **Apakah kehilangan data dapat diterima?**
8. **Apakah pola ini aman di Redis Cluster?**
9. **Apa observability signal-nya?**
10. **Apa runbook saat failure?**

Redis yang dipakai secara mature bukan “tambahkan Redis supaya cepat”. Redis yang dipakai secara mature adalah **explicit state design**.

---

## 1. Mental Model: Redis sebagai Backend Pattern Engine

Redis sering masuk ke backend karena satu dari lima alasan:

1. **Reduce latency**  
   Contoh: cache profile, config, feature eligibility.

2. **Reduce load**  
   Contoh: melindungi database dari read-heavy traffic.

3. **Coordinate distributed workers**  
   Contoh: lock, idempotency, rate limit, dedupe.

4. **Represent transient state**  
   Contoh: session, OTP token, temporary workflow state.

5. **Power real-time behavior**  
   Contoh: presence, fanout signal, leaderboard, delay queue.

Tetapi setiap alasan punya risiko berbeda.

| Motivasi | Bias desain | Risiko utama |
|---|---|---|
| Latency | cache-aside/local+remote cache | stale read, stampede |
| Load reduction | TTL/invalidation | database overload saat cache miss storm |
| Coordination | atomic commands/Lua | false safety, lock misuse |
| Transient state | TTL-first modeling | data hilang lebih cepat/lambat dari ekspektasi |
| Real-time | Pub/Sub/Streams/Sorted Set | lost message, backlog, duplicate processing |

Rule penting:

> Redis pattern yang baik harus bisa dijelaskan tanpa menyebut library dulu.

Kalau desain hanya bisa dijelaskan sebagai “pakai RedisTemplate opsForValue set/get”, berarti desainnya belum matang.

---

## 2. Pattern Taxonomy

Dalam backend systems, Redis pattern bisa dikelompokkan menjadi delapan kategori besar:

1. **Cache patterns**
2. **Session and token patterns**
3. **Idempotency and deduplication patterns**
4. **Rate limiting and quota patterns**
5. **Coordination patterns**
6. **Queue/scheduling patterns**
7. **Real-time state patterns**
8. **Workflow transient-state patterns**

Kita akan bahas masing-masing dengan format:

- problem
- Redis model
- key schema
- lifecycle
- correctness contract
- Java implementation shape
- failure modes
- when not to use

---

# Pattern 1 — Cache-Aside

## 3. Problem

Aplikasi Java sering membaca data yang relatif mahal dari database atau external service:

- customer profile
- product catalog
- authorization/eligibility result
- configuration
- reference data
- computed dashboard summary

Tanpa cache:

```text
request -> Java service -> database/external dependency -> response
```

Dengan cache-aside:

```text
request -> Java service -> Redis
                   | cache hit  -> response
                   | cache miss -> source of truth -> Redis -> response
```

Redis tidak otomatis tahu database berubah. Aplikasi yang mengatur cache.

---

## 4. Redis Model

Biasanya memakai Redis String atau Hash:

```text
GET cache:customer:{customerId}:profile:v1
SET cache:customer:{customerId}:profile:v1 <json> EX 300
```

Atau Hash jika partial field access memang dibutuhkan:

```text
HGETALL cache:customer:{customerId}:profile:v1
HSET cache:customer:{customerId}:profile:v1 name "Ayu" riskTier "LOW"
EXPIRE cache:customer:{customerId}:profile:v1 300
```

Namun untuk cache-aside, JSON blob sering lebih sederhana karena:

- single fetch
- single invalidation
- DTO versioning jelas
- tidak memberi ilusi bahwa Redis adalah database object utama

---

## 5. Key Schema

Contoh key:

```text
cache:customer:{customerId}:profile:v1
cache:case:{caseId}:summary:v3
cache:tenant:{tenantId}:feature-flags:v2
```

Prinsip:

1. Prefix `cache:` untuk membedakan derived state.
2. Domain jelas: `customer`, `case`, `tenant`.
3. Identifier eksplisit.
4. Version suffix untuk schema evolution.
5. Gunakan hash tag `{...}` jika beberapa key perlu satu slot di Redis Cluster.

Jangan:

```text
customer-123
profile_123
userData
123
```

Karena key seperti itu tidak punya ownership, lifecycle, atau schema version.

---

## 6. Correctness Contract

Cache-aside harus punya kontrak eksplisit:

```text
Redis value is derived from database.
Redis may be missing.
Redis may be stale up to TTL or invalidation delay.
Database remains source of truth.
If Redis fails, service may either degrade or bypass cache depending on endpoint criticality.
```

Untuk sistem regulatori atau enforcement lifecycle, ini penting. Cache tidak boleh diam-diam menjadi sumber keputusan final jika audit mengharuskan data authoritative.

---

## 7. Java Shape

Pseudo-code:

```java
public CustomerProfile getProfile(CustomerId id) {
    String key = "cache:customer:%s:profile:v1".formatted(id.value());

    String cached = redis.get(key);
    if (cached != null) {
        metrics.cacheHit("customer-profile");
        return json.decode(cached, CustomerProfile.class);
    }

    metrics.cacheMiss("customer-profile");

    CustomerProfile profile = customerRepository.findProfile(id);

    redis.setex(key, Duration.ofMinutes(5), json.encode(profile));

    return profile;
}
```

Production version harus menambah:

- timeout Redis pendek
- fallback policy
- negative cache
- stampede protection
- serialization version
- metrics hit/miss/fill/error

---

## 8. Failure Modes

| Failure | Dampak | Mitigasi |
|---|---|---|
| Redis down | semua request miss | fallback ke DB dengan circuit breaker |
| Redis slow | service latency naik | short timeout, fail-open untuk non-critical cache |
| Hot key expired | DB spike | TTL jitter, lock/coalescing, refresh-ahead |
| Cache stale | keputusan salah | invalidation on write, shorter TTL, source recheck untuk critical action |
| Large payload | network/memory pressure | split model, compress cautiously, avoid giant cache blob |
| Serialization drift | decode error | versioned keys, backward-compatible DTO |

---

## 9. When Not To Use Cache-Aside

Hindari cache-aside jika:

1. Data berubah sangat sering dan stale read tidak boleh terjadi.
2. Source query sudah murah dan tidak menjadi bottleneck.
3. Tim tidak punya observability cache.
4. Cache invalidation tidak dapat didefinisikan.
5. Data perlu strict read-your-write di semua path.

Cache-aside bukan default. Cache-aside adalah trade-off.

---

# Pattern 2 — Negative Caching

## 10. Problem

Kadang cache miss bukan karena data belum dicache, tapi karena data memang tidak ada.

Contoh:

```text
GET customer id=999999
```

Jika banyak request untuk ID yang tidak ada, semua request bisa menembak database.

---

## 11. Redis Model

Simpan marker “not found” dengan TTL pendek:

```text
SET cache:customer:{id}:profile:v1 "__NULL__" EX 30
```

Atau value JSON eksplisit:

```json
{
  "status": "NOT_FOUND",
  "cachedAt": "2026-06-20T10:15:30Z"
}
```

---

## 12. Correctness Contract

Negative cache harus lebih pendek dari positive cache karena data yang sebelumnya tidak ada bisa dibuat kemudian.

Contoh:

| Data | TTL |
|---|---:|
| customer profile exists | 5 menit |
| customer not found | 15–60 detik |
| permission denied result | sangat hati-hati, tergantung risk |

---

## 13. Failure Mode

Negative cache bisa menyebabkan user baru tidak terlihat sementara.

Misalnya:

```text
T0: GET customer 123 -> DB not found -> cache NOT_FOUND 60s
T1: customer 123 dibuat
T2: GET customer 123 -> Redis NOT_FOUND -> salah sampai TTL habis
```

Mitigasi:

- invalidate saat create
- TTL pendek
- jangan negative-cache data yang creation/read path-nya sangat dekat
- jangan cache deny/eligibility decision tanpa model risiko

---

# Pattern 3 — Session Store

## 14. Problem

Aplikasi perlu menyimpan state session lintas instance:

- login session
- web session
- device session
- temporary authentication context
- risk challenge state

Jika session disimpan in-memory JVM, instance restart atau load balancing akan bermasalah.

Redis sering dipakai sebagai centralized session store.

---

## 15. Redis Model

Contoh key:

```text
session:web:{sessionId}:v1
session:user:{userId}:device:{deviceId}:v1
```

Value:

```json
{
  "userId": "u-123",
  "tenantId": "t-9",
  "roles": ["case-reviewer"],
  "createdAt": "2026-06-20T10:00:00Z",
  "lastSeenAt": "2026-06-20T10:10:00Z",
  "authLevel": "MFA_VERIFIED"
}
```

TTL:

```text
EX 1800
```

---

## 16. Session Lifecycle

Ada dua jenis expiry:

1. **Absolute expiry**  
   Session harus mati setelah waktu maksimum.

2. **Idle expiry**  
   Session diperpanjang saat user aktif.

Redis TTL natural untuk idle expiry, tapi absolute expiry harus disimpan di payload juga.

Contoh:

```json
{
  "createdAt": "2026-06-20T10:00:00Z",
  "absoluteExpiresAt": "2026-06-20T18:00:00Z",
  "idleTimeoutSeconds": 1800
}
```

Saat request:

```text
if now > absoluteExpiresAt -> reject and delete
else refresh TTL to idleTimeout
```

---

## 17. Correctness Contract

Session store contract:

```text
If session key is missing, user is not authenticated.
Session data is authoritative for runtime authentication state, but long-lived identity and authorization model remain in source-of-truth identity system.
Session keys must always have TTL.
Session key deletion is valid logout/revocation behavior.
```

---

## 18. Failure Modes

| Failure | Dampak | Mitigasi |
|---|---|---|
| Redis down | login/session validation gagal | fail-closed for auth |
| Redis eviction | user ter-logout | `noeviction` or separate Redis for session |
| TTL not refreshed | unexpected logout | sliding TTL tests |
| TTL refreshed forever | no absolute expiry | store absolute expiry in payload |
| Session payload too large | memory pressure | store minimal claims only |
| Shared Redis with cache | eviction from cache affects sessions | isolate workloads |

Important:

> Session Redis sebaiknya tidak dicampur sembarangan dengan volatile cache ber-eviction agresif.

---

# Pattern 4 — Idempotency Key Store

## 19. Problem

API atau consumer event bisa menerima request/event yang sama lebih dari sekali:

- client retry
- network timeout
- payment callback duplicate
- message broker redelivery
- frontend double submit

Tanpa idempotency, operasi bisa terjadi ganda.

---

## 20. Redis Model

Minimal:

```text
SET idem:payment:{tenantId}:{idempotencyKey} "STARTED" NX EX 86400
```

Lebih matang:

```json
{
  "state": "COMPLETED",
  "requestHash": "sha256:...",
  "responseCode": 201,
  "responseBodyRef": "payment:p-123",
  "createdAt": "2026-06-20T10:00:00Z",
  "completedAt": "2026-06-20T10:00:02Z"
}
```

State machine:

```text
ABSENT -> STARTED -> COMPLETED
               |-> FAILED_RETRYABLE
               |-> FAILED_FINAL
               |-> EXPIRED
```

---

## 21. Correctness Contract

Idempotency contract:

```text
Same idempotency key + same request fingerprint returns same semantic result.
Same idempotency key + different request fingerprint is rejected.
Idempotency retention window is finite and explicit.
Redis loss may reduce deduplication guarantee unless result is also backed by authoritative store.
```

---

## 22. Java Shape

```java
public PaymentResponse createPayment(CreatePaymentCommand command, String idemKey) {
    String key = "idem:payment:%s:%s".formatted(command.tenantId(), idemKey);
    String requestHash = hash(command.normalizedPayload());

    IdemRecord started = IdemRecord.started(requestHash);

    boolean acquired = redis.setNxEx(key, json.encode(started), Duration.ofHours(24));

    if (!acquired) {
        IdemRecord existing = json.decode(redis.get(key), IdemRecord.class);
        return handleExistingRecord(existing, requestHash);
    }

    try {
        Payment payment = paymentService.create(command);
        IdemRecord completed = IdemRecord.completed(requestHash, payment.id());
        redis.setex(key, Duration.ofHours(24), json.encode(completed));
        return PaymentResponse.created(payment.id());
    } catch (Exception e) {
        redis.setex(key, Duration.ofMinutes(10), json.encode(IdemRecord.failedRetryable(requestHash)));
        throw e;
    }
}
```

Production version should consider Lua compare-and-transition to avoid blind overwrite.

---

## 23. Failure Modes

| Failure | Dampak | Mitigasi |
|---|---|---|
| Redis write STARTED succeeds, business operation fails before FAILED set | stuck STARTED until TTL | short STARTED TTL, recovery policy |
| Business operation succeeds, Redis COMPLETED update fails | retry may repeat operation | authoritative uniqueness in DB |
| Different payload same idem key | unsafe replay | request fingerprint check |
| TTL too short | duplicate allowed too soon | align with retry window/business risk |
| Redis persistence loss | dedupe window lost | DB unique constraint for critical operation |

Rule:

> Redis idempotency improves retry safety, but for financial/regulatory irreversible operations, it should complement an authoritative uniqueness guarantee, not replace it.

---

# Pattern 5 — Deduplication Window

## 24. Problem

You need to remember “I have seen this thing recently”.

Examples:

- processed event ID
- webhook delivery ID
- notification ID
- case transition request ID
- external correlation ID

---

## 25. Redis Model

Simple String:

```text
SET dedupe:webhook:{provider}:{deliveryId} "1" NX EX 604800
```

Set per bucket:

```text
SADD dedupe:webhook:{provider}:2026-06-20 deliveryId
EXPIRE dedupe:webhook:{provider}:2026-06-20 604800
```

String-per-ID is usually easier for TTL and distribution.

---

## 26. Correctness Contract

```text
Deduplication is only guaranteed inside retention window.
A missing dedupe key means either unseen or expired/evicted/lost.
Critical dedupe must also be enforced by durable store.
```

---

# Pattern 6 — Rate Limiter

## 27. Problem

Need to protect system or enforce quota:

- per user
- per tenant
- per IP
- per API key
- per endpoint
- per workflow action

Redis is useful because many application instances can share counters/state.

---

## 28. Redis Models

### Fixed Window

```text
INCR rl:{tenantId}:api:/cases:202606201010
EXPIRE rl:{tenantId}:api:/cases:202606201010 120
```

Pros:

- simple
- fast
- memory predictable

Cons:

- boundary burst

### Sliding Window with Sorted Set

```text
ZADD rl:{tenantId}:api:/cases <timestampMs> <requestId>
ZREMRANGEBYSCORE rl:{tenantId}:api:/cases -inf <now-window>
ZCARD rl:{tenantId}:api:/cases
EXPIRE rl:{tenantId}:api:/cases 120
```

Pros:

- more precise

Cons:

- more memory
- more commands unless Lua

### Token Bucket

Store:

```json
{
  "tokens": 73,
  "lastRefillAtMs": 1781920000000
}
```

Use Lua to refill and consume atomically.

---

## 29. Correctness Contract

```text
Rate limiter is an enforcement approximation bounded by algorithm, clock model, and Redis availability.
Limit key dimensions must match abuse model.
Fail-open or fail-closed must be explicitly chosen per endpoint.
```

Example:

| Endpoint | Failure policy |
|---|---|
| public login | fail-closed or degraded challenge |
| internal dashboard read | fail-open |
| payment creation | fail-closed/strict |
| expensive export | fail-closed |

---

## 30. Multi-Dimensional Key Design

Bad:

```text
rl:user:123
```

Better:

```text
rl:{tenantId}:user:{userId}:endpoint:{endpointGroup}:window:{yyyyMMddHHmm}
rl:{tenantId}:apikey:{apiKeyId}:action:create-case:v1
rl:{tenantId}:ip:{ipHash}:auth-login:v1
```

For Redis Cluster, use hash tag around the entity whose counters must be atomically updated together:

```text
rl:{tenant:t-1:user:u-9}:login:minute
rl:{tenant:t-1:user:u-9}:login:hour
```

---

# Pattern 7 — Distributed Lock with Fencing

## 31. Problem

Multiple workers may attempt same critical operation:

- regenerate report
- refresh expensive cache
- execute singleton job
- migrate tenant config
- process case transition

Redis lock can reduce concurrent execution.

But Redis lock is not a magic correctness boundary.

---

## 32. Redis Model

Acquire:

```text
SET lock:report:{reportId} <randomToken> NX PX 30000
```

Release with compare-and-delete Lua:

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
```

Fencing token:

```text
INCR fence:report:{reportId}
```

The downstream resource rejects stale fencing token.

---

## 33. Correctness Contract

```text
The Redis lock is a lease, not ownership forever.
The holder may lose the lock due to TTL expiry while still executing.
Critical writes must be protected by fencing token or authoritative compare-and-set.
```

---

## 34. When Lock Is Appropriate

Good:

- avoid duplicate expensive refresh
- best-effort singleton job
- reduce contention
- protect non-critical maintenance task

Dangerous:

- financial double-spend prevention
- legal state transition with no DB constraint
- cross-system transaction
- exactly-once processing claim

For critical workflows, lock should be paired with:

- durable state machine
- version check
- optimistic concurrency
- fencing
- idempotency

---

# Pattern 8 — Delay Queue with Sorted Set

## 35. Problem

Need to schedule work at a future time:

- retry after delay
- send notification later
- timeout workflow step
- release reservation
- recheck pending case

---

## 36. Redis Model

Sorted Set:

```text
ZADD delay:case-recheck:v1 <dueTimestampMs> <jobId>
```

Worker polls due items:

```text
ZRANGEBYSCORE delay:case-recheck:v1 -inf <nowMs> LIMIT 0 100
```

Claim atomically with Lua:

```lua
local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
for _, item in ipairs(items) do
  redis.call('ZREM', KEYS[1], item)
  redis.call('RPUSH', KEYS[2], item)
end
return items
```

Alternative:

- use Streams if you need consumer group semantics
- use real scheduler/job system if strict scheduling/durability required

---

## 37. Correctness Contract

```text
Delay queue provides approximate due-time dispatch.
It is not a durable scheduling system unless backed by persistence and recovery process.
Jobs may be delayed, duplicated, or lost depending on design.
```

---

## 38. Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| Worker crashes after `ZREM` before processing | lost job | move to processing list atomically, recovery scan |
| Redis loses data | scheduled jobs lost | persist job in DB, Redis only index |
| Clock skew | early/late dispatch | centralize timestamp source |
| Poll too frequent | Redis load | batch and sleep/backoff |
| Large backlog | slow scans | shard by domain/time bucket |

Best architecture for critical jobs:

```text
PostgreSQL job table = authoritative
Redis Sorted Set = fast due-time index
Worker claims Redis item -> verifies DB state -> processes -> updates DB
```

---

# Pattern 9 — Real-Time Presence

## 39. Problem

Need to know who/what is currently active:

- online users
- active agents
- live case reviewers
- connected devices
- active browser tabs

Presence is naturally ephemeral.

---

## 40. Redis Model

String per session/device:

```text
SET presence:user:{userId}:device:{deviceId} "online" EX 60
```

Set per tenant/team:

```text
SADD presence:tenant:{tenantId}:users {userId}
```

But set membership can become stale if not cleaned.

Better pattern:

- String keys with TTL are authoritative for online status.
- Sets are optional index, cleaned periodically or validated on read.

Alternative Sorted Set:

```text
ZADD presence:tenant:{tenantId}:users <lastSeenMs> <userId>
ZREMRANGEBYSCORE presence:tenant:{tenantId}:users -inf <now-ttl>
```

---

## 41. Correctness Contract

```text
Presence is approximate.
Online means heartbeat seen within window.
Offline means no heartbeat within window, not necessarily explicit logout.
```

This distinction matters. A user can lose network and appear online until TTL expires.

---

# Pattern 10 — Feature Flag / Configuration Cache

## 42. Problem

Services need low-latency access to configuration:

- feature flags
- tenant policy
- routing config
- limit settings
- risk thresholds

Redis can reduce repeated database/config-service reads.

---

## 43. Redis Model

```text
cache:tenant:{tenantId}:config:v5
cache:tenant:{tenantId}:features:v3
```

Value:

```json
{
  "version": 42,
  "flags": {
    "newCaseRouting": true,
    "strictDeduplication": false
  },
  "loadedAt": "2026-06-20T10:00:00Z"
}
```

Optional Pub/Sub invalidation:

```text
PUBLISH invalidation:tenant-config tenant:t-1:v43
```

---

## 44. Correctness Contract

```text
Redis config cache may be stale up to invalidation delay or TTL.
Critical policy decisions must define maximum staleness explicitly.
```

For regulatory systems, some config may be low-risk stale, while enforcement thresholds may need strict versioning.

Example:

| Config | Max staleness |
|---|---:|
| UI feature visibility | 5 minutes |
| case routing weights | 1 minute |
| enforcement threshold | 0–few seconds or version-gated |
| legal jurisdiction rule | source-of-truth check or signed version |

---

# Pattern 11 — Workflow Transient State

## 45. Problem

Longer business workflows often need temporary state:

- OTP challenge
- draft wizard state
- case intake temporary context
- verification attempt
- export preparation token
- temporary upload metadata

Redis is suitable when state is:

- transient
- reconstructible or safely expirable
- small
- TTL-bound
- not primary audit record

---

## 46. Redis Model

```text
wf:case-intake:{tenantId}:{draftId}:v1
wf:otp:{tenantId}:{challengeId}:v1
wf:export:{tenantId}:{exportId}:token:v1
```

Value:

```json
{
  "state": "AWAITING_APPROVAL",
  "caseId": "c-123",
  "actorId": "u-99",
  "attempts": 1,
  "createdAt": "2026-06-20T10:00:00Z",
  "expiresAt": "2026-06-20T10:10:00Z"
}
```

---

## 47. Correctness Contract

```text
Workflow transient state may expire.
Expiration must lead to an explicit business outcome.
Redis transient state must not be the only audit trail for regulated decisions.
```

Bad:

```text
If Redis key disappears, no one knows whether the user accepted terms.
```

Good:

```text
If Redis key disappears, the challenge is expired and user must retry.
Accepted terms are stored in durable audit table.
```

---

# Pattern 12 — Pub/Sub Invalidation Signal

## 48. Problem

Multiple service instances keep local in-memory caches. When data changes, all instances should drop stale local copy.

---

## 49. Redis Model

Local JVM cache:

```text
Caffeine local cache per instance
```

Redis Pub/Sub channel:

```text
invalidation:customer-profile
```

Message:

```json
{
  "key": "cache:customer:c-123:profile:v1",
  "reason": "CUSTOMER_UPDATED",
  "version": 17,
  "publishedAt": "2026-06-20T10:00:00Z"
}
```

---

## 50. Correctness Contract

```text
Pub/Sub invalidation is best-effort.
Subscribers may miss messages while disconnected.
Local cache must also have TTL.
```

Do not rely only on Pub/Sub for correctness.

Correct design:

```text
Local cache TTL short/moderate
Redis Pub/Sub invalidation accelerates freshness
Redis/server-side cache or DB remains fallback
```

---

# Pattern 13 — Streams for Lightweight Work Dispatch

## 51. Problem

Need lightweight event processing inside a bounded system:

- background enrichment
- notification dispatch
- cache warmup
- async secondary action

Redis Streams can be appropriate when Kafka/RabbitMQ would be too heavy and durability requirements are modest/understood.

---

## 52. Redis Model

```text
XADD stream:notification-dispatch:v1 * tenantId t-1 notificationId n-123 type EMAIL
XGROUP CREATE stream:notification-dispatch:v1 workers $ MKSTREAM
XREADGROUP GROUP workers worker-1 COUNT 10 BLOCK 5000 STREAMS stream:notification-dispatch:v1 >
XACK stream:notification-dispatch:v1 workers <messageId>
```

---

## 53. Correctness Contract

```text
Redis Streams provide persisted stream entries and consumer group pending tracking, but system correctness still requires idempotent consumers, retention policy, pending recovery, and operational monitoring.
```

Use when:

- modest event volume
- short/medium retention
- simple operational boundary
- consumer idempotency exists

Avoid when:

- long audit retention
- high-throughput event backbone
- replay across many teams
- strict ordering/durability semantics beyond Redis operational envelope

---

# Pattern 14 — Leaderboard / Ranking / Priority Index

## 54. Problem

Need ordered access by score:

- leaderboard
- risk score ranking
- priority queue
- oldest pending case
- most recent activity
- top N hot entities

Sorted Set is natural.

---

## 55. Redis Model

```text
ZADD rank:case-priority:{tenantId}:v1 9812 case-123
ZREVRANGE rank:case-priority:{tenantId}:v1 0 99 WITHSCORES
```

For time index:

```text
ZADD idx:case-last-updated:{tenantId}:v1 <epochMs> case-123
```

---

## 56. Correctness Contract

```text
Sorted Set is an index, not necessarily source of truth.
Before acting on a ranked item, verify authoritative state.
```

This is essential when ranking drives business action.

Example:

```text
Redis says case-123 is high priority.
Before assignment, service loads case from DB and verifies status is still ASSIGNABLE.
```

---

# Pattern 15 — Request Coalescing / Single Flight

## 57. Problem

Many concurrent requests ask for same missing/expired data.

Without coalescing:

```text
100 requests miss -> 100 database calls
```

With coalescing:

```text
100 requests miss -> 1 database call -> all use result
```

---

## 58. Redis Model

Use short lock:

```text
SET lock:fill:cache:customer:{id}:profile:v1 <token> NX PX 5000
```

Winner fills cache.

Losers:

- wait briefly and retry cache
- return stale value if available
- degrade gracefully

---

## 59. Correctness Contract

```text
Coalescing lock protects dependency load, not business correctness.
If lock fails, service should still behave safely.
```

---

## 60. Java Strategy

A robust Java strategy often uses two layers:

1. JVM-local single-flight per instance
2. Redis short lock across instances

Pseudo-flow:

```text
check local cache
check Redis cache
if miss:
  acquire local single-flight
    check Redis again
    acquire Redis fill lock
      load DB
      set Redis
      set local
```

Do not make every request block indefinitely behind Redis lock.

---

# Pattern 16 — Soft TTL + Hard TTL

## 61. Problem

Cache should avoid stampede and keep latency predictable.

Hard TTL only:

```text
key exists -> use
key missing -> recompute synchronously
```

At expiry, traffic spikes.

Soft/hard TTL pattern:

```json
{
  "payload": { ... },
  "softExpiresAt": "2026-06-20T10:05:00Z",
  "hardExpiresAt": "2026-06-20T10:10:00Z"
}
```

Redis key TTL follows hard expiry.

---

## 62. Behavior

```text
if now < softExpiresAt:
    serve cached
else if now < hardExpiresAt:
    serve stale and trigger refresh
else:
    block and reload or fail according to endpoint policy
```

This pattern is valuable for:

- dashboards
- reference data
- recommendations
- low-risk derived summaries

Do not use blindly for security-sensitive decisions.

---

# Pattern 17 — Local Cache + Redis Cache

## 63. Problem

Redis network round trip is still costlier than local memory. For ultra-hot read paths, local cache can reduce Redis load.

Architecture:

```text
Java service local cache -> Redis -> DB
```

---

## 64. Correctness Contract

```text
Local cache is the stalest layer.
Redis is shared derived layer.
Database is source of truth.
Invalidation must consider both local and Redis cache.
```

Use:

- local TTL
- max size
- Redis Pub/Sub invalidation signal
- versioned payload
- fallback when invalidation missed

---

## 65. Failure Mode

Local cache can hide Redis/database changes.

Mitigation:

- short local TTL
- explicit invalidation
- store version in payload
- verify on critical mutation

---

# Pattern 18 — Redis as Read Model / Materialized View

## 66. Problem

Some read models are expensive to compute from normalized source:

- dashboard counts
- case queue summary
- tenant metrics snapshot
- current assignment view

Redis can hold materialized read state.

---

## 67. Redis Model

Possible structures:

```text
Hash    -> summary fields
ZSet    -> ranked queue
Set     -> membership
String  -> serialized view
Stream  -> update events
```

Example:

```text
HSET view:tenant:{tenantId}:case-dashboard:v1 open 120 overdue 8 escalated 3
ZADD view:tenant:{tenantId}:case-priority:v1 9912 case-123
```

---

## 68. Correctness Contract

This is dangerous if not explicit.

```text
Redis read model is derived and rebuildable.
Source of truth is durable database/event log.
Read model may lag.
Consumers must tolerate rebuild or missing view.
```

If Redis read model cannot be rebuilt, Redis has become a primary database. Then durability, backup, persistence, and recovery must be treated accordingly.

---

# Pattern 19 — Tenant-Level Workload Isolation

## 69. Problem

Multi-tenant systems may have noisy tenants.

Redis can accidentally let one tenant harm others:

- hot keys
- huge keys
- excessive rate counters
- large streams
- runaway sessions

---

## 70. Redis Model

Key schema must include tenant:

```text
cache:tenant:{tenantId}:...
rl:tenant:{tenantId}:...
stream:tenant:{tenantId}:...
presence:tenant:{tenantId}:...
```

But prefix alone is not enough.

Need:

- per-tenant memory estimate
- per-tenant key cardinality
- per-tenant rate limits
- per-tenant operational dashboard
- optional physical isolation for high-risk tenants

---

## 71. Correctness Contract

```text
Tenant isolation is not achieved by key prefix alone.
Noisy tenant protection requires quotas, observability, and possibly separate Redis databases/clusters.
```

---

# Pattern 20 — Redis as Safety Valve

## 72. Problem

Sometimes Redis is used to protect weaker systems:

- rate limit before database
- dedupe before expensive operation
- cache before external dependency
- queue before slow processor

This is valid, but Redis becomes critical path.

---

## 73. Design Rule

For every safety-valve pattern, define failure policy:

| Redis unavailable | Policy |
|---|---|
| API rate limiter | fail-open or fail-closed based on endpoint risk |
| login brute force limiter | fail-closed/degraded challenge |
| idempotency for payment | fail-closed or DB uniqueness fallback |
| cache for product listing | fail-open to DB with circuit breaker |
| delay queue | pause processing and alert |
| session store | fail-closed |

Do not let this be implicit.

---

# 74. Decision Matrix: Which Pattern Should I Use?

| Problem | Primary Redis structure | Pattern | Must-have safeguard |
|---|---|---|---|
| Expensive read | String/Hash | Cache-aside | TTL, invalidation, fallback |
| Missing records hammered | String | Negative cache | short TTL, create invalidation |
| Login session | String/Hash | Session store | TTL, fail-closed, isolated memory |
| Duplicate API retry | String/Hash + Lua | Idempotency | request hash, durable uniqueness if critical |
| Recent duplicate event | String per id | Dedupe window | explicit retention, DB fallback if critical |
| API abuse | String/ZSet/Lua | Rate limiter | fail policy, dimensional key |
| Singleton work | String + token | Lock | TTL, safe unlock, fencing if critical |
| Future work | ZSet | Delay queue | recovery, DB authority for critical jobs |
| Online status | String/ZSet | Presence | heartbeat TTL, approximate semantics |
| Local cache invalidation | Pub/Sub | Invalidation signal | local TTL, missed-message tolerance |
| Lightweight worker queue | Streams | Work dispatch | idempotent consumer, PEL monitoring |
| Top N/ranking | ZSet | Leaderboard/index | verify source before action |
| Stampede | String lock | Request coalescing | short lease, fallback |
| Expensive derived view | Hash/ZSet/String | Read model | rebuild path, lag semantics |

---

# 75. Pattern Selection Questions

Before proposing Redis, answer these questions.

## 75.1 Source of Truth

```text
Is Redis the source of truth?
If yes, why is Redis durability sufficient?
If no, where is authoritative state stored?
```

## 75.2 Missing Key Semantics

```text
What does missing key mean?
- never existed?
- expired?
- evicted?
- lost during failover?
- not yet populated?
```

## 75.3 Staleness

```text
How stale can the value be?
What user/business harm happens if stale?
```

## 75.4 Lifecycle

```text
Who creates the key?
Who updates it?
Who deletes it?
Does it always have TTL?
What is maximum cardinality?
```

## 75.5 Cluster

```text
Does the pattern require multi-key atomicity?
Are all related keys in the same hash slot?
```

## 75.6 Failure Policy

```text
If Redis is unavailable, does the operation:
- fail open?
- fail closed?
- degrade?
- retry?
- enqueue?
- bypass Redis?
```

## 75.7 Observability

```text
Which metrics prove this pattern is healthy?
Which alert fires before users complain?
```

---

# 76. Redis Pattern Design Template

Use this template in architecture documents.

```markdown
## Redis Pattern: <name>

### Business Problem
<what problem is solved>

### Redis Role
<cache / derived state / coordination / transient state / primary state>

### Source of Truth
<database / external service / Redis / none>

### Key Schema
<exact key patterns>

### Data Structure
<String / Hash / Set / ZSet / Stream / JSON / etc>

### Value Schema
<JSON or field schema, versioned>

### Lifecycle
- created by:
- updated by:
- deleted by:
- TTL:
- max cardinality:

### Consistency Contract
<staleness, missing key meaning, duplicate behavior>

### Failure Policy
- Redis timeout:
- Redis unavailable:
- Redis failover:
- Redis data loss:

### Cluster Consideration
<hash tag / cross-slot / no multi-key atomicity>

### Security
<ACL user, key prefix restriction, data sensitivity>

### Observability
- metrics:
- logs:
- traces:
- dashboards:
- alerts:

### Test Plan
- TTL test:
- concurrency test:
- failure injection:
- serialization compatibility:

### Runbook
<manual operational steps during incident>
```

---

# 77. Java Implementation Guidelines Across Patterns

## 77.1 Hide Redis Behind Domain-Specific Ports

Bad:

```java
class CaseService {
    private final RedisTemplate<String, Object> redisTemplate;
}
```

Better:

```java
interface CasePriorityIndex {
    void upsertPriority(CaseId caseId, int priorityScore);
    List<CaseId> topAssignableCases(TenantId tenantId, int limit);
    void remove(CaseId caseId);
}
```

Implementation can use Redis, but domain does not leak Redis command details everywhere.

---

## 77.2 Key Builders Must Be Centralized

Bad:

```java
String key = "case:" + id + ":summary";
```

Scattered across codebase, impossible to migrate safely.

Better:

```java
final class RedisKeys {
    static String caseSummary(TenantId tenantId, CaseId caseId) {
        return "cache:case:{tenant:%s}:summary:%s:v2"
            .formatted(tenantId.value(), caseId.value());
    }
}
```

Central key builders allow:

- schema versioning
- cluster hash tag consistency
- test validation
- migration planning
- ownership clarity

---

## 77.3 Never Use Java Native Serialization for Shared Redis Values

Prefer:

- JSON for readability and compatibility
- MessagePack/CBOR/Protobuf only with strong schema discipline
- String for simple counters/tokens

Avoid Java native serialization because it is:

- opaque
- brittle across class changes
- language-locked
- risky for security
- hard to debug in Redis CLI

---

## 77.4 Timeouts Must Be Pattern-Specific

Not all Redis operations deserve same timeout.

Example:

| Pattern | Suggested behavior |
|---|---|
| non-critical cache read | short timeout, fail-open |
| session validation | short timeout, fail-closed |
| rate limiter | short timeout, fail policy by endpoint |
| idempotency key creation | fail-closed for critical mutations |
| background leaderboard update | retry async / drop if derived |

One global 60-second timeout is usually too dangerous for web request paths.

---

## 77.5 Retries Need Idempotency

Retrying Redis commands blindly can create subtle bugs.

Safe-ish retries:

- `GET`
- `TTL`
- idempotent `SET key value` when overwriting is safe

Dangerous retries:

- `INCR`
- `LPUSH`
- `XADD`
- `ZADD` with unique member maybe safe, with generated member dangerous
- lock acquire without understanding result
- side-effecting Lua script

Rule:

> If the command mutates state and the client does not know whether Redis executed it, retry semantics must be designed explicitly.

---

# 78. Failure Modeling by Pattern

## 78.1 Redis Timeout

Ask:

```text
Did command execute but response lost?
Or did command never reach Redis?
```

Client often cannot know.

For mutation patterns, this uncertainty matters.

Example:

```text
INCR quota counter -> timeout
retry INCR -> quota consumed twice
```

Solution:

- use idempotent request IDs
- use Lua with request ID tracking
- avoid retries for non-idempotent commands
- design compensate path

---

## 78.2 Redis Failover

During failover:

- writes may be rejected
- clients reconnect
- topology changes
- recently acknowledged writes may be missing on promoted replica if replication lag existed

Pattern impact:

| Pattern | Risk during failover |
|---|---|
| cache | acceptable miss/stale usually |
| session | possible logout/session inconsistency |
| idempotency | duplicate risk |
| lock | false ownership risk |
| rate limiter | temporary quota bypass/double count |
| streams | pending recovery needed |
| delay queue | delayed or duplicated jobs |

---

## 78.3 Eviction

If Redis has `maxmemory` with eviction policy, any pattern storing important state must consider eviction.

Safe to evict:

- cache
- derived read model if rebuildable
- presence

Dangerous to evict:

- session
- idempotency records for critical operation
- rate limit counters for abuse control
- locks during critical section
- workflow challenge state if no business expiry handling

Better: separate Redis deployments/logical databases by workload criticality.

---

# 79. Architecture Review Checklist

Use this during design review.

## 79.1 General

- [ ] Redis role is explicitly stated.
- [ ] Source of truth is identified.
- [ ] Missing key semantics are defined.
- [ ] TTL policy is defined.
- [ ] Max cardinality is estimated.
- [ ] Memory budget is estimated.
- [ ] Hot key risk is analyzed.
- [ ] Big key risk is analyzed.
- [ ] Cluster slot requirements are known.
- [ ] Failure policy is explicit.
- [ ] Observability exists.
- [ ] Test plan includes failure cases.

## 79.2 Cache Patterns

- [ ] Cache key includes version.
- [ ] Positive and negative TTL are separate.
- [ ] Stampede mitigation exists.
- [ ] Invalidation path is documented.
- [ ] Source fallback has circuit breaker.
- [ ] Staleness is acceptable.

## 79.3 Coordination Patterns

- [ ] Atomicity boundary is known.
- [ ] Lua/transaction choice is justified.
- [ ] Lock has random token.
- [ ] Unlock is compare-and-delete.
- [ ] Lease duration is justified.
- [ ] Fencing exists if stale holder can cause harm.

## 79.4 Stream/Queue Patterns

- [ ] Delivery semantics are accepted.
- [ ] Consumer is idempotent.
- [ ] Pending messages are monitored.
- [ ] Retention/trimming policy exists.
- [ ] Recovery process is tested.

## 79.5 Security

- [ ] Redis is not publicly exposed.
- [ ] TLS/auth/ACL are configured where appropriate.
- [ ] Dangerous commands restricted.
- [ ] Sensitive payloads are minimized or encrypted.
- [ ] Key prefixes align with ACL strategy.

---

# 80. Example: Applying the Template to a Regulatory Case System

## 80.1 Scenario

A case management platform needs:

1. Fast case summary reads.
2. Idempotent case transition API.
3. Rate limit on case export.
4. Presence of reviewers.
5. Delayed recheck for pending external verification.

---

## 80.2 Pattern Mapping

| Requirement | Redis pattern | Source of truth |
|---|---|---|
| Fast case summary | Cache-aside/read model | PostgreSQL case tables |
| Idempotent transition | Idempotency key store | PostgreSQL transition table unique constraint |
| Export limit | Token bucket/fixed window | Redis enforcement + audit log in DB |
| Reviewer presence | Presence TTL | Redis approximate only |
| Delayed verification recheck | ZSet delay index | DB verification job table |

---

## 80.3 Key Schema

```text
cache:case:{tenant:t-1}:summary:case:c-123:v3
idem:case-transition:{tenant:t-1}:key:k-abc:v1
rl:export:{tenant:t-1}:user:u-9:day:20260620:v1
presence:reviewer:{tenant:t-1}:user:u-9:device:d-1:v1
idx:verification-recheck:{tenant:t-1}:v1
```

Notice the cluster hash tag:

```text
{tenant:t-1}
```

This may help keep tenant-scoped multi-key operations in the same slot. But this can also create hot slots if a tenant is huge. Architecture must choose intentionally.

---

## 80.4 Critical Boundary

The case transition must not depend only on Redis idempotency.

Correct flow:

```text
1. Redis idempotency key prevents duplicate concurrent/retry processing.
2. PostgreSQL transition table has unique constraint on transition request id.
3. Case aggregate version is checked.
4. Audit event is persisted durably.
5. Redis cache/read model invalidated after commit.
```

Redis improves safety and performance, but durable correctness remains in the system of record.

---

# 81. Common Pattern Misclassifications

## 81.1 “We Need Redis for Queue”

Maybe.

Ask:

- Do you need durability?
- Consumer groups?
- retries?
- dead letter queue?
- ordering?
- replay?
- monitoring?
- retention?

If answer is yes to many, Redis List may be too weak. Redis Streams may help, but Kafka/RabbitMQ may still be better depending on requirements.

---

## 81.2 “We Need Redis for Distributed Lock”

Maybe.

Ask:

- What resource is protected?
- What happens if lock expires early?
- What happens if lock holder pauses?
- Is there fencing?
- Can DB optimistic locking solve this better?

Often, DB compare-and-set is more correct than Redis lock.

---

## 81.3 “We Need Redis for Speed”

Maybe.

Ask:

- What is current bottleneck?
- Is DB missing index?
- Is query badly shaped?
- Is N+1 causing slowness?
- Is serialization bigger than query?
- What is expected hit ratio?
- What stale window is acceptable?

Redis should not hide bad data modeling without understanding the new correctness cost.

---

# 82. Pattern Maturity Levels

## Level 0 — Ad Hoc Redis

Symptoms:

- random key names
- no TTL discipline
- no metrics
- no failure policy
- direct RedisTemplate everywhere
- `KEYS *` debugging in production

Dangerous.

---

## Level 1 — Basic Redis

Symptoms:

- key prefixes exist
- simple TTL
- cache hit/miss metrics
- basic client config

Usable for simple cache.

---

## Level 2 — Production Redis

Symptoms:

- pattern contracts documented
- memory budget
- latency budget
- alerts
- integration tests
- Redis failure path tested
- cluster-aware key design

Good for production.

---

## Level 3 — Architecture-Grade Redis

Symptoms:

- Redis usage separated by workload criticality
- source-of-truth boundaries explicit
- runbooks and DR tested
- client behavior understood during failover
- Lua/functions versioned and reviewed
- security/ACL integrated
- pattern-specific SLOs

This is the target for senior/tech lead level.

---

# 83. Mini Labs

## Lab 1 — Design a Cache Contract

Pick one existing read endpoint.

Write:

```text
source of truth:
cache key:
value schema:
positive TTL:
negative TTL:
invalidation trigger:
stampede mitigation:
fallback behavior:
metrics:
```

Then decide whether Redis is still justified.

---

## Lab 2 — Idempotency State Machine

Design idempotency for:

```text
POST /cases/{caseId}/transitions
```

Include:

- idempotency key
- request hash
- STARTED TTL
- COMPLETED TTL
- DB unique constraint
- replay behavior
- mismatched payload behavior

---

## Lab 3 — Delay Queue Safety

Design delayed recheck for external verification:

```text
verificationId should be rechecked after 10 minutes
```

Compare:

1. Redis ZSet only
2. PostgreSQL job table only
3. PostgreSQL job table + Redis ZSet index

Explain failure modes.

---

## Lab 4 — Pattern Failure Policy

For each Redis pattern in your system, fill this table:

| Pattern | Redis timeout | Redis down | Redis data loss | Redis failover |
|---|---|---|---|---|
| cache | | | | |
| session | | | | |
| idempotency | | | | |
| rate limit | | | | |
| lock | | | | |

If the team cannot fill it, the Redis design is incomplete.

---

# 84. Key Takeaways

1. Redis design patterns are not command recipes. They are **state contracts**.
2. Every Redis key needs owner, schema, lifecycle, TTL policy, and failure semantics.
3. Redis is excellent for derived state, transient state, compact coordination, rate limiting, presence, ranking, and low-latency shared state.
4. Redis becomes dangerous when used as hidden source of truth without durability, audit, memory, and recovery discipline.
5. For critical business workflows, Redis should usually complement durable constraints, not replace them.
6. Java services should hide Redis behind domain-specific ports and central key builders.
7. Pattern-specific timeout, retry, and fail-open/fail-closed behavior matter more than generic Redis client setup.
8. Redis Cluster, failover, eviction, and serialization must be considered at design time, not after production incident.

---

# 85. What Comes Next

Next part:

```text
learn-redis-mastery-for-java-engineers-part-032.md
```

Title:

```text
Redis Anti-Patterns and Failure Case Studies
```

Part 032 will intentionally focus on what goes wrong:

- Redis as accidental primary database
- missing TTL
- hot key
- big key
- `KEYS` in production
- retry storm
- blind Spring Cache usage
- shared Redis across unrelated bounded contexts
- no failover test
- root-cause style case studies

This current part gave the positive pattern catalog. The next part will train incident-oriented judgment.

---

## References

- Redis Docs — Cache-aside with Lettuce: https://redis.io/docs/latest/develop/use-cases/cache-aside/java-lettuce/
- Redis Docs — Distributed Locks: https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/
- Redis Docs — Pub/Sub: https://redis.io/docs/latest/develop/pubsub/
- Redis Docs — Lua scripting: https://redis.io/docs/latest/develop/programmability/eval-intro/
- Redis Docs — Rate limiter with Java/Jedis: https://redis.io/docs/latest/develop/use-cases/rate-limiter/java-jedis/
- Redis Docs — Lettuce guide: https://redis.io/docs/latest/develop/clients/lettuce/
- Redis Docs — Client-side caching: https://redis.io/docs/latest/develop/clients/client-side-caching/
- Redis Docs — Redis anti-patterns: https://redis.io/tutorials/redis-anti-patterns-every-developer-should-avoid/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Testing Redis-Backed Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-032.md">Part 032 — Redis Anti-Patterns and Failure Case Studies ➡️</a>
</div>

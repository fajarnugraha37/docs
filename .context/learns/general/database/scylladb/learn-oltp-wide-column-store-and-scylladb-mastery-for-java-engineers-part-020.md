# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-020.md

# Part 020 — Java Client Engineering II: Timeouts, Retries, Paging, Backpressure, Observability, dan Production Hardening

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `020`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memperdalam Java client engineering untuk production: timeout budget, retry policy, idempotence, speculative execution, paging, cursor, bounded concurrency, backpressure, bulk async writes, error taxonomy, driver metrics, slow query logging, chaos testing, dan hardening repository layer.

---

## 0. Posisi Part Ini dalam Seri

Part 019 membangun fondasi Java client engineering:

```text
driver architecture
session lifecycle
prepared statements
token-aware routing
shard-aware routing
execution profiles
repository design
async basics
```

Part ini membahas apa yang terjadi setelah service masuk production:

```text
traffic naik
node lambat
request timeout
retry terjadi
fanout membesar
paging salah
client overload
projection lag
backfill menekan cluster
p99 naik
```

Di ScyllaDB, banyak incident bukan karena CQL syntax salah, tetapi karena Java client:

- retry non-idempotent write,
- async unbounded,
- page size terlalu besar,
- timeout salah,
- speculative execution salah,
- fanout tidak dibatasi,
- mapper menulis null,
- repository menyembunyikan query shape,
- driver metrics tidak dimonitor,
- backfill tanpa throttle,
- error taxonomy terlalu kasar.

Part ini membuat client layer tahan failure.

---

## 1. Production Client Mindset

Java client bukan hanya “mengirim query”.

Ia adalah controller beban ke cluster.

Ia menentukan:

```text
how many requests in flight
which requests are retried
which timeout is acceptable
which errors are exposed
which operations are throttled
which fanout is allowed
which query is paged
which rows are mapped
which metrics exist
```

Mental model:

```text
A ScyllaDB client must be a polite distributed-systems participant.
```

Bukan:

```text
fire unlimited async requests and hope cluster handles it.
```

---

## 2. Timeout Budget

Timeout harus dirancang dari end-to-end latency budget.

Example endpoint:

```text
GET /cases/{caseId}
SLO p99 = 300 ms
```

Operations:

```text
read current case
read latest events
read tasks
maybe read attachments metadata
```

If each DB request timeout = 2 seconds, endpoint cannot meet 300 ms.

### 2.1 Budget Decomposition

```text
HTTP request budget: 300 ms

application overhead: 30 ms
serialization: 20 ms
DB budget total: 200 ms
margin: 50 ms
```

If fanout 4 parallel DB calls:

```text
each timeout maybe 150-180 ms
overall deadline 220 ms
```

Timeout should be tied to endpoint deadline.

---

## 3. Driver Request Timeout vs Application Deadline

Driver request timeout:

```text
how long driver waits for DB request
```

Application deadline:

```text
how long endpoint/workflow can continue
```

These must align.

Bad:

```text
HTTP timeout = 300 ms
DB timeout = 5 sec
```

This leaves in-flight DB work after caller gone.

Good:

```text
HTTP deadline propagated
DB request timeout <= remaining budget
fanout respects deadline
```

### 3.1 Deadline Propagation

Pseudo:

```java
record Deadline(Instant expiresAt) {
    Duration remaining() {
        return Duration.between(Instant.now(), expiresAt);
    }

    boolean expired() {
        return !remaining().isPositive();
    }
}
```

Repository can accept operation context:

```java
CompletionStage<CaseCurrent> findAuthoritative(
    TenantId tenantId,
    CaseId caseId,
    RequestContext ctx
);
```

But avoid making every repository API too noisy. A service-level query executor can apply timeout.

---

## 4. Timeout Selection by Operation

Different operations need different timeout.

| Operation | Typical Timeout Direction |
|---|---|
| fast derived read | short |
| authoritative read | moderate |
| source write | moderate |
| LWT | longer |
| range page read | moderate/longer |
| batch export page | longer but throttled |
| backfill write | moderate with retry/backoff |
| admin query | longer, not user-facing |

Do not use one global timeout for all.

---

## 5. Timeout Is a Signal, Not Just Error

Timeout can mean:

- node overloaded,
- partition hot,
- compaction pressure,
- network issue,
- CL too high for current failure,
- query too broad,
- page too large,
- client overloaded,
- retry storm,
- GC pause,
- driver queueing,
- wrong local DC.

On write/LWT, timeout also means:

```text
outcome unknown
```

Client must classify:

```text
read timeout
idempotent write timeout
non-idempotent write timeout
LWT timeout
counter timeout
fanout partial timeout
```

---

## 6. Retry Policy: Core Principle

Retry only when:

```text
1. operation is safe to retry
2. retry has chance to succeed
3. retry stays within deadline
4. retry does not amplify overload
5. retry uses same idempotency key/primary key
```

Bad retry:

```text
retry all exceptions 3 times
```

Good retry:

```text
retry selected idempotent read/write failures with bounded budget, backoff, jitter, and metrics
```

---

## 7. Idempotency Classification

Before enabling retries, classify every statement.

| Operation | Idempotent? | Notes |
|---|---|---|
| SELECT by key | yes | safe with bounded retry |
| INSERT event with stable full PK | yes-ish | retry same key |
| INSERT notification with new random id per attempt | no | stable id needed |
| UPDATE set deterministic value | maybe | if same values and no side effects |
| UPDATE counter +1 | no | can double count |
| list append | no | can duplicate |
| LWT IF NOT EXISTS | conditional | retry via read-after-timeout |
| DELETE by full key | yes-ish | if delete key stable |
| external side effect | no | needs idempotency protocol |

Driver idempotence flag should match this classification.

---

## 8. Safe Retry Pattern for Reads

Read retry is usually safer but still bounded.

Pseudo:

```java
CompletionStage<T> retryRead(Supplier<CompletionStage<T>> op, RetryBudget budget) {
    return op.get().handle((result, error) -> {
        if (error == null) {
            return completed(result);
        }

        if (!budget.canRetry(error)) {
            return failed(error);
        }

        return delayWithJitter(budget.nextDelay())
            .thenCompose(ignored -> retryRead(op, budget.next()));
    }).thenCompose(identity());
}
```

Rules:

- max attempts small,
- respect deadline,
- backoff/jitter,
- classify exception,
- avoid retrying huge fanout all at once,
- emit retry metrics.

---

## 9. Safe Retry Pattern for Idempotent Writes

Example event append:

```text
event_id generated once before first attempt
primary key stable
```

Retry same bound statement.

Bad:

```java
EventId eventId = EventId.random(); // inside retry lambda
```

Good:

```java
EventId eventId = EventId.random(); // outside retry lambda
BoundStatement stmt = append.bind(..., eventId.value(), ...);
retryIdempotentWrite(() -> session.executeAsync(stmt));
```

If generated per retry, duplicate rows.

---

## 10. LWT Retry Pattern

LWT timeout outcome unknown.

For idempotency reserve:

```text
1. INSERT IF NOT EXISTS times out
2. read reservation row by command_id
3. if row exists and belongs to command -> continue
4. if absent -> retry same command_id
5. if exists with different owner -> conflict
```

For expected-version transition:

```text
1. UPDATE ... IF version=? times out
2. read current row
3. if version/event_id matches desired -> success
4. if old version -> maybe retry
5. if different version -> conflict/unknown resolution
```

Do not blindly retry LWT as if it failed.

---

## 11. Retry Storm

Retry storm occurs when failures cause clients to send more traffic to already overloaded cluster.

Example:

```text
normal QPS = 10k
timeout rate = 20%
each timeout retried 3 times
effective QPS rises dramatically
cluster worsens
```

Mitigations:

- retry budget,
- circuit breaker,
- adaptive throttling,
- backoff/jitter,
- deadline,
- per-key rate limit,
- load shedding,
- distinguish overload from transient network failure.

---

## 12. Backoff and Jitter

Use jitter to avoid synchronized retry.

Bad:

```text
retry after exactly 100ms
```

Good:

```text
retry after random 50-150ms
```

Common patterns:

- full jitter,
- equal jitter,
- decorrelated jitter.

For low-latency OLTP, retries must fit endpoint budget; sometimes no retry is better.

---

## 13. Speculative Execution

Speculative execution sends a second copy of request before first fails, if first is slow.

Goal:

```text
reduce tail latency for idempotent operations
```

Danger:

```text
increases load
duplicates non-idempotent mutations
can worsen overload
```

Use for:

- idempotent reads,
- maybe idempotent writes only with care,
- low-latency profile,
- strict cap on extra requests.

Avoid for:

- counters,
- list append,
- random-id inserts,
- LWT unless deeply validated,
- overloaded cluster.

Monitor:

```text
speculative executions started
speculative wins
extra load
latency improvement
```

---

## 14. Hedging vs Retrying

Retry happens after failure/timeout.

Speculative execution happens before failure when request is slow.

Both can amplify load.

Use only with:

```text
idempotence
budget
metrics
caps
```

If p99 problem is hot partition or bad query, speculative execution may hide symptoms and increase load.

Fix root cause.

---

## 15. Bounded Concurrency

Async without bound is overload.

Bad:

```java
List<CompletionStage<Void>> writes = events.stream()
    .map(event -> session.executeAsync(insert.bind(...)))
    .toList();
```

If `events` has 1 million rows:

```text
1 million in-flight requests
```

Good:

```text
max in-flight = 128/512/etc based on benchmark
```

### 15.1 Semaphore Pattern

```java
final Semaphore permits = new Semaphore(maxInFlight);

CompletionStage<AsyncResultSet> executeBounded(BoundStatement stmt) {
    try {
        permits.acquire();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return CompletableFuture.failedFuture(e);
    }

    return session.executeAsync(stmt)
        .whenComplete((rs, ex) -> permits.release());
}
```

For non-blocking permit acquisition, use async semaphore or reactive operator.

---

## 16. Backpressure

Backpressure means upstream slows when downstream cannot keep up.

Without backpressure:

```text
HTTP/message consumer accepts unlimited work
driver queue grows
latency rises
timeouts rise
retries rise
cluster worsens
```

Backpressure mechanisms:

- max in-flight DB requests,
- bounded queue,
- reject/429/load shed,
- message consumer pause,
- Kafka max poll/in-flight limits,
- per-tenant quota,
- bulk job throttle,
- adaptive concurrency.

---

## 17. Bulk Async Writes

For backfill/bulk writes:

```text
do not batch across many partitions with LOGGED BATCH
```

Use:

```text
prepared statement
idempotent keys
bounded concurrency
throttle
progress checkpoint
retry budget
metrics
```

Pseudo:

```java
BulkWriter writer = new BulkWriter(
    maxInFlight = 256,
    maxPerTenantInFlight = 32,
    targetQps = 5000
);
```

Each write:

```text
same primary key on retry
operation profile bulk-write
timeout moderate
backoff on overload
```

---

## 18. Bulk Write Ordering

For independent rows:

```text
parallel writes okay
```

For same entity versioned state:

```text
ordering matters
```

Do not parallelize commands for same case if order must be preserved.

Use:

- partition by aggregate ID,
- per-key serial executor,
- event version,
- LWT expected version,
- stream partitioning.

---

## 19. Per-Key Concurrency Limit

Hot key can overwhelm one partition.

Use per-key limit:

```text
max 1 transition command per case
max N reads per hot case
max M writes per tenant
```

Example:

```java
KeyedLimiter<CaseId> caseTransitionLimiter = new KeyedLimiter<>(1);
```

This prevents local service from creating LWT contention storm.

---

## 20. Per-Tenant Backpressure

Multi-tenant service should isolate tenants.

Without per-tenant limits:

```text
one mega tenant/backfill can starve others
```

Implement:

- per-tenant in-flight limit,
- per-tenant QPS limit,
- per-tenant bulk job quotas,
- prioritized queues,
- separate keyspace/cluster for extreme tenants if needed.

---

## 21. Paging: Correct Mental Model

Paging is not just UI page.

There are layers:

```text
CQL LIMIT
driver page size
API cursor/page size
bucket fanout cursor
internal backfill checkpoint
```

You must design each.

### 21.1 CQL LIMIT

Maximum rows query returns.

### 21.2 Driver Page Size

How many rows per network page.

### 21.3 API Cursor

Client-visible continuation token.

### 21.4 Backfill Checkpoint

Durable progress marker.

---

## 22. Page Size Selection

Large page size:

- fewer round trips,
- more memory,
- longer single request,
- larger failure cost,
- p99 risk.

Small page size:

- more round trips,
- lower memory,
- better responsiveness,
- overhead per page.

Typical interactive reads:

```text
50-500 rows
```

Bulk/backfill:

```text
hundreds/thousands carefully
```

Measure.

Do not default to huge page size.

---

## 23. API Cursor Design

Do not expose raw driver paging state unless you accept:

- opacity,
- security concerns,
- query coupling,
- invalidation risk.

Better domain cursor:

For table:

```text
PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
```

Cursor:

```json
{
  "versionBucket": 42,
  "lastEventVersion": 421337,
  "lastEventId": "..."
}
```

For bucketed fanout:

```json
{
  "bucketDay": "2026-06-21",
  "bucketPositions": {
    "0": {"lastDueAt": "...", "lastCaseId": "..."},
    "1": {"lastDueAt": "...", "lastCaseId": "..."}
  }
}
```

---

## 24. Cursor Security

Cursor may reveal internal IDs/timestamps.

Options:

- sign cursor,
- encrypt cursor,
- base64 encode JSON with HMAC,
- include tenant/user scope,
- expire cursor.

Do not trust client-provided cursor blindly.

Validate:

```text
tenant matches auth context
limit within max
bucket range allowed
signature valid
not expired
```

---

## 25. Fanout Reads

Example:

```text
open cases by assignee day bucket_count=8
```

Read flow:

```text
query 8 buckets
merge by due_at
return top 50
```

Rules:

- hard max bucket count,
- bounded parallelism,
- per-subquery timeout,
- overall deadline,
- overfetch limit,
- partial failure policy,
- cursor with bucket positions,
- metrics per fanout.

---

## 26. Fanout Partial Failure

If one bucket times out:

Options:

1. fail entire request,
2. retry bucket once,
3. return partial with warning,
4. degrade to cached result,
5. reduce bucket fanout by design.

For operational queue, fail might be safer.

For feed, partial may be acceptable.

Define per API.

---

## 27. Overfetch and Merge

If final limit=50 and bucket_count=8:

```text
fetch 50 from each -> 400 rows
return 50
```

Maybe acceptable.

If bucket_count=128:

```text
6400 rows fetched
```

Bad.

Overfetch should be:

```text
bounded and measured
```

Metrics:

```text
rows_fetched
rows_returned
stale_filtered
fanout_count
merge_latency
```

---

## 28. Stale Filtering in Java

Derived view may have stale rows.

Read candidates:

```text
open_cases_by_assignee
```

Validate:

```text
case_current_by_id
```

Pattern:

```text
candidate limit = display limit * factor
validate source
return valid rows
```

Danger:

- N+1 reads,
- extra fanout,
- stale ratio high,
- p99 spikes.

Optimization:

- include source_version/status in derived row,
- batch/parallel validate with concurrency limit,
- reconcile stale table,
- adjust overfetch.

---

## 29. Error Taxonomy

Define domain-level DB errors.

Example:

```java
sealed interface ScyllaOperationResult<T> {
    record Success<T>(T value) implements ScyllaOperationResult<T> {}
    record NotFound<T>() implements ScyllaOperationResult<T> {}
    record Conflict<T>(Object current) implements ScyllaOperationResult<T> {}
    record TimeoutUnknown<T>() implements ScyllaOperationResult<T> {}
    record Unavailable<T>() implements ScyllaOperationResult<T> {}
    record Overloaded<T>() implements ScyllaOperationResult<T> {}
    record InvalidQuery<T>(String message) implements ScyllaOperationResult<T> {}
}
```

You may not implement exactly this, but application should distinguish cases.

---

## 30. Exception Categories

Map driver exceptions into categories:

```text
read timeout
write timeout
unavailable
overloaded
read failure/write failure
all nodes failed
no node available
invalid query
unauthorized/auth error
codec error
schema disagreement/schema error
connection/init error
```

Each has different handling.

Do not catch `Exception` and return 500 blindly.

---

## 31. HTTP Mapping

Examples:

| DB Outcome | API Mapping |
|---|---|
| not found | 404 |
| LWT conflict | 409 |
| duplicate idempotent command completed | 200/201 same result |
| timeout unknown for command | 202 pending or 503 with retry token |
| read timeout | 503/504 maybe |
| unavailable | 503 |
| invalid query/schema bug | 500 |
| validation range too large | 400 |

For command writes, `202 Accepted/PENDING` can be more honest than false failure.

---

## 32. Circuit Breaker

Circuit breaker stops sending requests when downstream is clearly failing.

Use per operation/table/cluster if possible.

States:

```text
closed
open
half-open
```

But be careful:

- too aggressive breaker causes outage,
- too lax breaker allows overload,
- breaker should respect idempotency,
- health checks must be meaningful.

Circuit breaker complements, not replaces, backpressure.

---

## 33. Load Shedding

When overloaded, reject early.

Examples:

```text
HTTP 429 for tenant over quota
HTTP 503 for service overloaded
pause Kafka consumer
reject bulk job
skip non-critical refresh
```

Better to fail fast than accept work that will time out and retry.

---

## 34. Adaptive Concurrency

Adaptive concurrency adjusts in-flight limit based on observed latency/error.

Simpler starting point:

```text
static max in-flight per operation
```

Advanced:

```text
reduce concurrency when p99/timeout rises
increase slowly when healthy
```

Be cautious; test thoroughly.

---

## 35. Driver Metrics

Enable and export driver metrics.

Useful metrics:

```text
pool open connections
in-flight requests
request latency
request timeouts
request errors by type
retry count
speculative execution count
bytes sent/received
nodes up/down
connection errors
throttling queue size if enabled
```

Correlate with ScyllaDB server metrics.

---

## 36. Application Metrics

Per repository operation:

```text
operation_name
table
profile
CL
success count
error count by category
latency histogram
rows returned
page count
fanout count
retry attempts
timeout unknown count
LWT applied false
payload bytes
stale filtered count
```

Avoid high-cardinality labels like raw case_id/user_id.

Use sampled logs for hot keys.

---

## 37. Slow Query Log

Application slow query record:

```text
timestamp
operation
table
profile
duration_ms
attempts
consistency
page_size
rows_returned
fanout_count
bucket
partition_key_hash
exception_category
```

For LWT:

```text
applied true/false
contention key hash
```

For backfill:

```text
job_id
checkpoint
tenant
batch size
```

---

## 38. Tracing

Use distributed tracing:

```text
HTTP span
service method span
Scylla repository span
fanout subspans
projection span
```

Attributes:

```text
db.system=scylla/cassandra
db.operation
db.table
consistency_level
execution_profile
page_size
rows
```

Do not include PII/raw query parameters.

---

## 39. Logging Data Safety

ScyllaDB keys may contain:

- tenant IDs,
- user IDs,
- email,
- case reference,
- legal identifiers.

Logging raw keys can violate privacy/security.

Use:

```text
tenant_id if allowed
hashed key
redacted fields
sampling
secure logs
```

---

## 40. Bulk Job Hardening

Backfill/export jobs must include:

```text
checkpoint
resume
throttle
max in-flight
max per tenant
retry budget
dead letter
progress metrics
pause/resume
kill switch
dry run
validation
```

Never run ad-hoc unbounded script against production ScyllaDB.

---

## 41. Export Reads

Large export should not use online endpoint path.

Use:

- async job,
- bounded token/bucket scans,
- low-priority execution profile,
- page size tuned,
- object storage output,
- progress table,
- throttling,
- cluster health checks.

If cluster unhealthy, pause export.

---

## 42. Projection Writer Hardening

Derived view projector:

```text
at-least-once processing
idempotent writes
checkpoint after successful write
dead letter on poison event
projection lag metrics
bounded concurrency
per-entity ordering if needed
```

Projection timeouts:

```text
retry idempotently
do not advance checkpoint before success
```

---

## 43. Handling Hot Partitions in Client

When hot key detected:

- per-key concurrency limit,
- request coalescing,
- short TTL cache if safe,
- rate limit client polling,
- degrade non-critical reads,
- alert product/SRE,
- maybe special-case hot tenant.

Request coalescing example:

```text
100 identical current-case reads within 10ms -> one DB read shared
```

Only if freshness semantics allow.

---

## 44. Request Coalescing

Useful for read-heavy hot keys.

Pseudo concept:

```java
ConcurrentHashMap<Key, CompletionStage<Value>> inFlightReads;

CompletionStage<Value> coalescedRead(Key key) {
    return inFlightReads.computeIfAbsent(key, k ->
        actualRead(k).whenComplete((v, e) -> inFlightReads.remove(k))
    );
}
```

Caution:

- memory leak if not removed,
- key cardinality,
- error propagation,
- staleness,
- cancellation,
- fairness.

---

## 45. Cache Interaction

Cache can reduce DB load but adds consistency risk.

Use for:

- derived/stale-tolerant reads,
- reference data,
- hot read-only-ish rows.

Avoid for:

- command guard,
- LWT decision,
- authorization unless carefully invalidated,
- financial/legal state.

Cache metrics:

```text
hit rate
stale rate
evictions
invalidation lag
```

---

## 46. Testing Failure Modes

Test with:

```text
node down
node slow
network latency
timeouts
unavailable errors
read/write timeout
LWT unknown
driver local DC misconfig
cluster overloaded
hot partition
backfill running
schema migration rolling
```

Use Testcontainers for integration basics, but also staging/chaos for distributed failure.

---

## 47. Repository Unit Tests

Unit test:

- statement profile chosen,
- idempotence flag,
- parameter binding,
- mapping,
- error mapping,
- LWT applied false,
- bucket function,
- limit validation,
- cursor encode/decode.

---

## 48. Integration Tests

Integration test with ScyllaDB:

```text
create schema
prepare statements
insert/read current
append events
page through events
LWT conflict
TTL expiry if needed
null/collection behavior
fanout read
```

Use real driver and CQL.

Mocks cannot catch CQL/routing/schema mistakes.

---

## 49. Load Tests

Load test should include:

- realistic key distribution,
- hot tenants,
- realistic row size,
- mixed read/write,
- compaction active,
- paging,
- TTL/delete churn,
- LWT contention,
- async in-flight limits,
- retry behavior,
- backfill/projection background load.

Uniform random write-only benchmark is insufficient.

---

## 50. Chaos Tests

Scenarios:

```text
kill one node
slow one node
drop network to one DC
increase latency
fill disk warning
pause compaction? with ops guidance
restart service during in-flight writes
kill projector before checkpoint
timeout LWT
```

Verify:

- no duplicate command,
- retry budget respected,
- service degrades,
- metrics alert,
- no retry storm,
- unknown outcomes resolved.

---

## 51. Production Runbook Hooks

Client layer should expose:

- health endpoint,
- readiness based on session connectivity,
- metrics,
- config dump redacted,
- active execution profiles,
- circuit breaker state,
- in-flight counts,
- backfill job controls,
- projection lag,
- last successful DB operation time.

Readiness should not be too strict; one transient DB blip should not restart all pods and worsen outage.

---

## 52. Kubernetes/Container Considerations

For Java service:

- graceful shutdown waits for in-flight or cancels safely,
- stop accepting new traffic before closing session,
- message consumers pause on shutdown,
- connection warm-up before readiness,
- memory sized for async result buffers,
- CPU enough for callbacks/mapping,
- avoid high GC from huge row allocations.

Shutdown flow:

```text
mark not ready
stop consumers
wait bounded in-flight
close session
exit
```

---

## 53. Graceful Shutdown

If service exits with in-flight writes:

- idempotent writes can be retried by upstream,
- non-idempotent writes may be unknown,
- command state table helps.

Graceful shutdown should:

```text
drain or mark pending
not accept new commands
preserve checkpoints
not advance projection checkpoint prematurely
```

---

## 54. Configuration Review

Config items:

```text
local datacenter
contact points
keyspace
auth/TLS
execution profiles
timeouts
retry policy
speculative execution
pool sizes
request throttler
metrics
heartbeat
schema metadata settings
```

Version config with code.

Review config in PR, not only infrastructure ticket.

---

## 55. Common Anti-Patterns

### 55.1 Retry Everything

Causes duplicate writes and overload.

### 55.2 Unlimited CompletableFuture Fanout

Client self-DOS.

### 55.3 Massive Page Size

Memory/p99 risk.

### 55.4 Raw Driver Paging State as Public Cursor

Security/coupling risk.

### 55.5 Backfill Without Throttle

Cluster incident.

### 55.6 No Distinction Between Timeout and Conflict

Wrong user/API behavior.

### 55.7 Non-Idempotent Speculative Execution

Data corruption.

### 55.8 No Metrics by Operation

Cannot debug.

### 55.9 One Timeout for Everything

Either false failures or slow outage.

### 55.10 Ignore Driver Metrics

Blind client layer.

---

## 56. Production Hardening Checklist

```text
[ ] Operation-specific execution profiles.
[ ] Explicit retry policy by idempotency.
[ ] Driver idempotence flags reviewed.
[ ] Speculative execution only for safe profiles.
[ ] Bounded async concurrency.
[ ] Per-tenant/per-key limits where needed.
[ ] Backpressure/load shedding.
[ ] Paging and API cursor designed.
[ ] Fanout max and partial failure policy.
[ ] Bulk jobs throttled and checkpointed.
[ ] Error taxonomy implemented.
[ ] LWT unknown outcome resolution.
[ ] Metrics per repository operation.
[ ] Slow query logging with safe key hashes.
[ ] Driver metrics exported.
[ ] Integration/load/chaos tests.
[ ] Graceful shutdown.
[ ] Runbook and alerts.
```

---

## 57. Common Misconceptions

### Misconception 1: “More retries improve reliability.”

Only if retry is safe and downstream can recover. Otherwise retries amplify failure.

### Misconception 2: “Async removes capacity limits.”

Async removes blocking, not physics.

### Misconception 3: “Speculative execution is free p99 improvement.”

It adds extra load and can duplicate unsafe operations.

### Misconception 4: “Timeout means user operation failed.”

For writes/LWT, outcome may be unknown.

### Misconception 5: “Page size can be large because memory is cheap.”

Large pages hurt p99, GC, network, and failure recovery.

### Misconception 6: “Backfill is just a loop.”

Backfill is production workload requiring throttle/checkpoint/observability.

### Misconception 7: “Driver metrics are optional.”

Without them, you cannot distinguish DB issue from client misuse.

---

## 58. Mental Model Compression

Remember:

```text
Timeouts protect latency.
Retries spend extra capacity.
Backpressure protects the database.
Idempotency protects correctness.
Paging protects memory.
Metrics protect operators.
```

A production ScyllaDB Java client is a control system.

It continuously controls:

```text
load
latency
failure
correctness
observability
```

---

## 59. Summary

Java client production hardening is essential for ScyllaDB success.

Key lessons:

1. Timeout budget must align with endpoint SLO.
2. Driver timeout and application deadline are different but related.
3. Retry only safe/idempotent operations.
4. Write timeout outcome may be unknown.
5. LWT timeout requires read-after-timeout logic.
6. Retry storms can take down a cluster.
7. Speculative execution is only for carefully chosen idempotent operations.
8. Async must be bounded.
9. Backpressure/load shedding are required.
10. Bulk writes need throttle/checkpoint.
11. Per-key/per-tenant limits prevent hot partition amplification.
12. Paging has multiple layers: CQL LIMIT, driver page size, API cursor.
13. Fanout reads need hard bounds and partial failure policy.
14. Error taxonomy must distinguish conflict, timeout, unavailable, unknown.
15. Metrics must be per operation/table/profile.
16. Slow query logs need safe key hashes.
17. Backfill/projection/export are production workloads.
18. Integration/load/chaos tests must include failure and skew.
19. Graceful shutdown protects in-flight work.
20. Driver configuration is production code.

---

## 60. Review Questions

1. Apa beda driver request timeout dan application deadline?
2. Kenapa retry semua error berbahaya?
3. Bagaimana mengklasifikasikan idempotency statement?
4. Apa safe retry pattern untuk event append?
5. Bagaimana menangani LWT timeout?
6. Apa itu retry storm?
7. Kenapa jitter penting?
8. Kapan speculative execution cocok?
9. Mengapa async harus bounded?
10. Apa backpressure?
11. Bagaimana per-tenant limit membantu multi-tenant isolation?
12. Apa beda CQL LIMIT, driver page size, dan API cursor?
13. Kenapa raw driver paging state berisiko sebagai public cursor?
14. Bagaimana menangani fanout partial failure?
15. Apa itu stale filtering?
16. Apa error taxonomy minimal untuk repository?
17. Bagaimana mapping timeout unknown ke API?
18. Metrik apa yang wajib per repository operation?
19. Kenapa backfill perlu checkpoint?
20. Apa yang harus diuji dalam chaos test?

---

## 61. Practical Exercise

Ambil service regulatory case management.

Desain production-hardening untuk operasi:

```text
1. read case detail
2. transition case state with LWT
3. append audit event
4. read assignee queue with 8 buckets
5. write notification feed
6. backfill open_cases_by_assignee view
7. export case audit history
8. process projection event stream
```

Untuk setiap operasi, tulis:

```text
execution profile
timeout
retry policy
idempotency classification
speculative execution yes/no
max in-flight
per-key/tenant limit
page size
cursor strategy
error taxonomy
API mapping
metrics
slow log fields
chaos tests
```

---

## 62. Preview Part 021

Part berikutnya membahas:

```text
Query Execution and Performance:
coordinator path,
replica path,
read path,
write path,
paging,
ALLOW FILTERING,
IN queries,
large partition reads,
short reads,
read repair/reconciliation,
server/client metrics,
and p99 performance debugging.
```

Part 020 menyelesaikan Java client hardening.

Part 021 akan kembali ke query execution dan performance dari ujung ke ujung.

---

# End of Part 020


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Java Client Engineering I: Driver Architecture, Session Lifecycle, Prepared Statements, Routing, dan Async Basics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-021.md">Part 021 — Query Execution and Performance: Coordinator Path, Replica Path, Paging, ALLOW FILTERING, IN Queries, dan p99 Debugging ➡️</a>
</div>

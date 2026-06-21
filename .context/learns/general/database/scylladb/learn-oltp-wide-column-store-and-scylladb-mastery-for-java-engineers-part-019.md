# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-019.md

# Part 019 — Java Client Engineering I: Driver Architecture, Session Lifecycle, Prepared Statements, Routing, dan Async Basics

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `019`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: membangun fondasi Java client engineering: driver architecture, session lifecycle, prepared statements, bound statements, token-aware/shard-aware routing, load balancing, execution profiles, consistency/timeout per operasi, async basics, repository design, dan anti-pattern implementasi.

---

## 0. Posisi Part Ini dalam Seri

Sampai part 018 kita sudah membahas database dari sisi:

```text
data model
primary key
query-first design
partition sizing
consistency level
LWT
tombstone
compaction
indexes/MV
counters/collections/UDT
```

Sekarang kita berpindah ke sisi aplikasi Java.

Pertanyaan utama:

> Bagaimana menerapkan semua prinsip ScyllaDB dalam Java service production-grade?

ScyllaDB tidak hanya butuh schema yang benar. Aplikasi Java juga harus benar dalam:

- membuat dan mengelola session,
- memakai prepared statement,
- mengikat partition key sebagai bound value,
- memilih consistency level per operasi,
- mengatur timeout dan retry,
- memakai async API tanpa overload,
- menjaga routing token/shard-aware,
- membatasi concurrency,
- membaca result set dengan paging,
- tidak membuat repository CRUD generik,
- menjaga idempotency dan statement semantics.

Part ini adalah fondasi.

Part berikutnya akan lanjut ke Java client engineering II: backpressure, retries, paging, observability, error taxonomy, testing, dan production hardening.

---

## 1. Driver Is Part of the Distributed System

Java driver bukan sekadar JDBC wrapper.

Driver berperan dalam:

```text
cluster discovery
connection pooling
load balancing
token-aware routing
shard-aware routing
prepared statement metadata
request timeout
retry policy
speculative execution
paging
metrics
schema metadata
execution profiles
```

Jika driver dikonfigurasi buruk:

- request ke node salah,
- cross-shard forwarding meningkat,
- latency naik,
- timeout salah,
- retry storm,
- local DC salah,
- consistency semantics rusak,
- prepared statement cache buruk,
- connection pool overload,
- p99 memburuk walau schema benar.

ScyllaDB Java driver documentation describes the Scylla Java Driver as shard-aware and supporting sync/async APIs, simple/prepared/batch statements, asynchronous IO, parallel execution, request pipelining, and connection pooling.

---

## 2. ScyllaDB Java Driver vs Cassandra Java Driver

ScyllaDB kompatibel dengan Cassandra CQL protocol dan driver ecosystem.

Tetapi ScyllaDB punya optimasi khusus:

```text
shard-aware drivers
```

ScyllaDB docs state that Scylla drivers are shard-aware and include extensions for token-aware host policies so the driver can select a connection to the relevant shard based on token, reducing latency by avoiding cross-shard forwarding.

Practical rule:

```text
Use ScyllaDB-provided Java driver when possible for ScyllaDB workloads.
```

Cassandra drivers may work, but Scylla-specific shard awareness can matter for latency.

---

## 3. Session Lifecycle

Driver session is expensive and should be long-lived.

Bad:

```java
public Case find(CaseId id) {
    CqlSession session = CqlSession.builder().build();
    try {
        return ...
    } finally {
        session.close();
    }
}
```

This is terrible.

Good:

```text
one CqlSession per application process/service
created at startup
closed at shutdown
shared by repositories
```

### 3.1 Why Session Is Long-Lived

Session manages:

- cluster metadata,
- connection pools,
- prepared statement cache,
- load balancing state,
- token metadata,
- schema metadata,
- metrics,
- request execution.

Creating per request causes:

- connection churn,
- authentication overhead,
- metadata refresh,
- prepared statement loss,
- latency spikes,
- resource leaks.

---

## 4. Service Startup

Typical startup flow:

```text
1. load config
2. build CqlSession
3. verify connectivity
4. prepare statements
5. initialize repositories
6. start HTTP/message consumers
```

Do not start accepting traffic before critical prepared statements are ready.

Example structure:

```java
public final class ScyllaClientModule implements AutoCloseable {
    private final CqlSession session;
    private final CaseCurrentRepository caseCurrentRepository;

    public ScyllaClientModule(AppConfig config) {
        this.session = CqlSession.builder()
            .withKeyspace(config.keyspace())
            .build();

        this.caseCurrentRepository = new CaseCurrentRepository(session);
    }

    public CaseCurrentRepository caseCurrentRepository() {
        return caseCurrentRepository;
    }

    @Override
    public void close() {
        session.close();
    }
}
```

Exact builder options depend on driver version and deployment.

---

## 5. Local Datacenter

For LOCAL_ONE/LOCAL_QUORUM routing, driver must know local DC.

Misconfigured local DC can cause:

- cross-region traffic,
- wrong LOCAL_QUORUM assumptions,
- high latency,
- failed requests,
- poor failover behavior.

Configuration should explicitly set local DC, not rely on accident.

Example conceptual config:

```hocon
datastax-java-driver {
  basic.load-balancing-policy {
    local-datacenter = "dc_jakarta"
  }
}
```

Use your real DC name exactly as ScyllaDB reports it.

---

## 6. Contact Points

Contact points are seed nodes for discovery, not the only nodes used forever.

Good:

```text
multiple contact points
same local DC
stable DNS/service discovery
```

Bad:

```text
single node IP
load balancer hiding topology
wrong DC contact points
```

A generic TCP load balancer in front of ScyllaDB can break topology-aware behavior unless specifically supported/designed.

Driver wants to know actual cluster nodes.

---

## 7. Prepared Statements

Prepared statements are mandatory for hot paths.

ScyllaDB Java driver docs say prepared statements should be used for queries executed multiple times; prepare once, then bind values to produce executable bound statements. The session has a built-in cache, and it is acceptable to prepare the same string twice.

Prepared statement benefits:

- server parses query once,
- driver knows variable metadata,
- driver can compute routing key,
- token-aware routing works,
- less string building,
- safer binding,
- better performance,
- stable query shape.

Bad:

```java
String cql = "SELECT * FROM case_current_by_id WHERE tenant_id = "
    + tenantId + " AND case_id = " + caseId;
session.execute(cql);
```

Good:

```java
PreparedStatement ps = session.prepare(
    "SELECT status, version, assignee_id, updated_at " +
    "FROM case_current_by_id " +
    "WHERE tenant_id = ? AND case_id = ?"
);

BoundStatement bs = ps.bind(tenantId, caseId);
session.execute(bs);
```

---

## 8. Prepare Once, Reuse Many Times

Do not prepare inside hot request path.

Bad:

```java
public CompletionStage<Optional<CaseCurrent>> find(TenantId tenantId, CaseId caseId) {
    PreparedStatement ps = session.prepare("SELECT ...");
    return session.executeAsync(ps.bind(...));
}
```

Good:

```java
final class CaseCurrentRepository {
    private final CqlSession session;
    private final PreparedStatement findById;

    CaseCurrentRepository(CqlSession session) {
        this.session = session;
        this.findById = session.prepare(
            "SELECT status, version, assignee_id, updated_at " +
            "FROM case_current_by_id " +
            "WHERE tenant_id = ? AND case_id = ?"
        );
    }

    CompletionStage<Optional<CaseCurrent>> findById(TenantId tenantId, CaseId caseId) {
        BoundStatement stmt = findById.bind(tenantId.value(), caseId.value());
        return session.executeAsync(stmt).thenApply(this::mapOne);
    }
}
```

---

## 9. Bound Values Must Include Partition Key

Prepared statements help token-aware routing only if partition key values are bound.

If you write:

```sql
SELECT *
FROM events_by_case
WHERE tenant_id = ?
  AND case_id = ?
  AND bucket_month = ?
```

and bind all partition key components, driver can compute routing key.

If you use string interpolation or omit key components, routing suffers.

ScyllaDB driver docs for prepared statements emphasize performance and reuse; ScyllaDB driver docs also describe token/shard-aware routing. Related ScyllaDB driver docs warn that partition key values should be passed as bound values so the driver can hash them to compute the partition key.

Rule:

```text
Always bind full partition key values for hot-path queries.
```

---

## 10. Token-Aware Routing

Token-aware routing means driver sends request to a replica owning the partition key token.

Without token-aware routing:

```text
client -> random coordinator -> owning replica
```

May cause extra hop.

With token-aware routing:

```text
client -> owning replica/coordinator
```

Benefits:

- lower latency,
- less cross-node traffic,
- better coordinator locality,
- better load distribution.

Requires:

- prepared/bound statements or routing key,
- valid token metadata,
- complete partition key,
- load balancing policy support.

---

## 11. Shard-Aware Routing

ScyllaDB node is shard-per-core.

Token-aware sends to correct node.

Shard-aware sends to correct shard/core connection where possible.

ScyllaDB C++ driver docs explain shard awareness as token awareness taken further: token-aware drivers select node where data belongs; shard-aware drivers open separate connections to CPU shards and use the right connection for the shard owning data.

ScyllaDB Java driver docs state Scylla drivers are shard-aware.

Benefit:

```text
avoid cross-shard forwarding inside node
lower latency
less CPU overhead
better p99
```

Application requirement:

```text
use Scylla-aware driver and bound partition keys
```

---

## 12. Routing Anti-Patterns

### 12.1 SimpleStatement String Concatenation

Bad for routing and security.

### 12.2 Missing Partition Key

Query cannot route to correct token.

### 12.3 Generic Repository Query Builder

Generates arbitrary WHERE clauses; routing unpredictable.

### 12.4 Load Balancer Hides Nodes

Driver cannot maintain topology awareness.

### 12.5 Wrong Local DC

Requests cross regions.

### 12.6 Per-Request Session

Loses metadata/pool/cache.

---

## 13. Execution Profiles

Execution profile is a named group of settings for a query workload.

DataStax/driver docs describe execution profiles as configuration options applied to individual queries so one session can run different workloads with different settings.

Profiles can include:

- consistency level,
- serial consistency,
- timeout,
- retry policy,
- speculative execution,
- load balancing options,
- page size.

Conceptual profiles:

```text
source-write
authoritative-read
derived-read-fast
lwt-guard
batch-export
```

This matches part 013 consistency design.

---

## 14. Example Execution Profiles

Conceptual config:

```hocon
datastax-java-driver {
  profiles {
    source-write {
      basic.request.consistency = LOCAL_QUORUM
      basic.request.timeout = 500 milliseconds
    }

    authoritative-read {
      basic.request.consistency = LOCAL_QUORUM
      basic.request.timeout = 300 milliseconds
    }

    derived-read-fast {
      basic.request.consistency = LOCAL_ONE
      basic.request.timeout = 150 milliseconds
    }

    lwt-guard {
      basic.request.consistency = LOCAL_QUORUM
      basic.request.serial-consistency = LOCAL_SERIAL
      basic.request.timeout = 1500 milliseconds
    }
  }
}
```

Repository:

```java
BoundStatement stmt = findById.bind(tenantId, caseId)
    .setExecutionProfileName("authoritative-read");
```

The exact config keys depend on driver version, but the design principle is stable:

```text
operation semantics -> execution profile
```

---

## 15. Statement-Level Settings

You can set options per statement:

```java
BoundStatement stmt = ps.bind(...)
    .setConsistencyLevel(DefaultConsistencyLevel.LOCAL_QUORUM)
    .setPageSize(100)
    .setTimeout(Duration.ofMillis(300));
```

But prefer profiles for consistency.

Use direct statement overrides when:

- rare special case,
- test,
- migration/batch job,
- explicit one-off behavior.

Avoid scattering magic timeouts/CL in code.

---

## 16. Repository Design: Access-Pattern Specific

Bad:

```java
interface GenericRepository<T, ID> {
    T save(T entity);
    Optional<T> findById(ID id);
    List<T> findBy(Map<String, Object> filters);
}
```

ScyllaDB repository must mirror CQL access pattern.

Good:

```java
interface CaseCurrentRepository {
    CompletionStage<Optional<CaseCurrent>> findAuthoritativeByTenantAndCase(
        TenantId tenantId,
        CaseId caseId
    );

    CompletionStage<TransitionResult> transitionIfVersionMatches(
        TenantId tenantId,
        CaseId caseId,
        long expectedVersion,
        CaseStatus expectedStatus,
        CaseStatus newStatus,
        EventId eventId
    );
}
```

Good:

```java
interface OpenCaseAssigneeViewRepository {
    CompletionStage<List<OpenCaseRow>> findByAssigneeDayBucket(
        TenantId tenantId,
        AssigneeId assigneeId,
        LocalDate bucketDay,
        int bucketId,
        int limit
    );
}
```

Method name reveals:

- table,
- partition key,
- consistency/freshness,
- bucket,
- limit.

---

## 17. Mapping Domain IDs

Avoid passing raw `UUID` everywhere if domain has distinct IDs.

Use value objects:

```java
record TenantId(UUID value) {}
record CaseId(UUID value) {}
record AssigneeId(UUID value) {}
record EventId(UUID value) {}
```

Benefits:

- prevents parameter order bugs,
- clarifies repository API,
- supports validation,
- improves logging redaction.

Binding:

```java
findById.bind(tenantId.value(), caseId.value());
```

Be careful not to over-engineer allocation on ultra-hot paths, but correctness usually wins.

---

## 18. Parameter Order Bugs

Prepared statements with positional parameters are easy to misuse.

CQL:

```sql
WHERE tenant_id = ?
  AND case_id = ?
```

Bug:

```java
ps.bind(caseId.value(), tenantId.value());
```

Types both UUID, compile passes, query returns wrong/no data.

Mitigations:

- named bind markers if supported,
- bound statement builder with names,
- repository tests,
- value object wrappers,
- code review,
- generated query layer.

Named markers:

```sql
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
```

Then bind by name if driver supports.

---

## 19. SimpleStatement Use Cases

Simple statements are okay for:

- schema migrations,
- ad-hoc admin,
- one-time query,
- dynamic DDL,
- controlled tooling.

Not okay for hot OLTP path.

If query runs often, prepare it.

---

## 20. Batch Statements

Batch statements exist, but do not use as JDBC batch replacement.

Use batch only when semantics justify it.

Bad Java pattern:

```java
BatchStatementBuilder batch = BatchStatement.builder(DefaultBatchType.LOGGED);

for (Event e : manyEventsAcrossPartitions) {
    batch.addStatement(insertEvent.bind(...));
}

session.execute(batch.build());
```

This can overload coordinator and create cross-partition batch cost.

Better:

- async individual idempotent writes with bounded concurrency,
- bulk loader for bulk ingestion,
- same-partition small batch if needed.

---

## 21. Async API Basics

ScyllaDB/Cassandra Java drivers support async execution.

Async is essential for high-throughput services, but dangerous if unbounded.

Bad:

```java
for (Command cmd : commands) {
    session.executeAsync(write.bind(...));
}
```

without limiting in-flight.

Good:

```text
bounded concurrency
deadline
backpressure
retry budget
metrics
```

Part 020 goes deep into backpressure.

Here we establish:

```text
Async is not unlimited parallelism.
```

---

## 22. CompletionStage Mapping

Typical async repository:

```java
CompletionStage<Optional<CaseCurrent>> findById(TenantId tenantId, CaseId caseId) {
    BoundStatement stmt = findById.bind(tenantId.value(), caseId.value())
        .setExecutionProfileName("authoritative-read");

    return session.executeAsync(stmt)
        .thenApply(rs -> {
            Row row = rs.one();
            if (row == null) {
                return Optional.empty();
            }
            return Optional.of(mapCaseCurrent(row));
        });
}
```

Keep mapping small and non-blocking.

Do not block inside completion stage.

Bad:

```java
.thenApply(rs -> {
    externalService.callBlocking();
    return ...
})
```

---

## 23. Async Threading

Driver uses its own event loops/internal threads.

Do not block driver threads.

If heavy CPU mapping needed:

```text
offload to application executor
```

But normal row mapping should be light.

Avoid:

- blocking HTTP calls,
- file IO,
- sleeps,
- synchronized hot locks,
- large JSON parsing,
- huge allocations,

inside driver completion callbacks.

---

## 24. Synchronous API

Sync API is simpler and may be fine for low-QPS admin tools.

For high-QPS service:

```text
async + bounded concurrency
```

usually better.

But async code must be disciplined.

A synchronous service with properly sized thread pool may work at moderate load, but thread-per-request can waste resources under high latency/fanout.

---

## 25. Request Timeout

Driver request timeout is total time driver waits for request completion, including internal retries in many driver configs. DataStax driver reference docs describe basic request timeout as a global limit on duration of a session.execute call including internal retries.

Timeout must be per operation profile.

Examples:

```text
fast derived read: 150 ms
authoritative read: 300 ms
source write: 500 ms
LWT: 1500 ms
batch export page: 5 sec maybe
```

Too low:

- false timeout,
- unknown writes,
- retry storms.

Too high:

- resource buildup,
- slow failure,
- poor user experience.

---

## 26. Timeout Is Not Business Failure

From part 013/014:

```text
write timeout outcome unknown
LWT timeout outcome unknown
```

Java repository must not simply convert all timeout to “failed”.

For idempotent writes:

```text
retry with same key or read-after-timeout
```

For non-idempotent writes:

```text
do not blindly retry
```

Repository method should return domain result that can express unknown/pending if needed.

---

## 27. Retry Policy Basics

Driver retry policy can retry certain failures.

But application must classify operations:

```text
read idempotent
idempotent write
non-idempotent write
LWT
counter
external side effect
```

Do not set aggressive retry globally.

Examples:

```text
read timeout -> maybe retry once
idempotent insert by stable key -> retry maybe
counter increment -> no blind retry
LWT timeout -> read outcome
```

Part 020 deep dives.

---

## 28. Statement Idempotence

Some drivers support marking statement idempotent.

Correct:

```text
SELECT by key -> idempotent
INSERT event with stable primary key -> idempotent
UPDATE current set same values by key -> maybe idempotent if same version
counter increment -> not idempotent
list append -> not idempotent
random UUID generated per attempt -> not idempotent
```

If driver uses idempotence for retries/speculative execution, wrong flag can corrupt data.

---

## 29. Speculative Execution

Speculative execution sends duplicate request when first attempt is slow.

Can improve p99 for idempotent reads.

Dangerous for non-idempotent writes.

Use with care:

- mostly reads,
- idempotent statements,
- tight thresholds,
- monitor extra load,
- not for LWT/counters/non-idempotent mutations unless proven safe.

---

## 30. Paging Basics

SELECT can return multiple pages.

Driver handles paging with page size.

Do not call:

```text
read entire partition into memory
```

Set page size and limit.

Example:

```java
BoundStatement stmt = findEvents.bind(...)
    .setPageSize(100);
```

CQL:

```sql
SELECT ...
FROM case_events_by_case_version_bucket
WHERE tenant_id = ?
  AND case_id = ?
  AND version_bucket = ?
LIMIT 100;
```

CQL `LIMIT` and driver page size are different:

```text
LIMIT = max rows query returns
page size = rows fetched per network page
```

---

## 31. ResultSet Mapping

For single-row lookup:

```java
Row row = rs.one();
```

For multi-row:

```java
for (Row row : rs.currentPage()) {
    ...
}
```

Async paging requires fetching next page if needed.

Do not convert huge result to list blindly.

Good:

- enforce limit,
- stream/page,
- cursor,
- bounded memory.

---

## 32. Page Cursor and API Cursor

Driver paging state is not always suitable as public API cursor because:

- may encode internal state,
- may be tied to query/driver/protocol,
- may have security concerns,
- can become invalid after schema/query change.

For external APIs, prefer domain cursor:

```text
last clustering key
bucket
bucket_id
direction
```

Use driver paging state internally if appropriate and protected.

Part 020 goes deeper.

---

## 33. Consistency Profiles in Repositories

Example:

```java
final class CaseCurrentRepository {
    private final PreparedStatement readAuthoritative;
    private final PreparedStatement transitionLwt;

    CompletionStage<Optional<CaseCurrent>> findAuthoritative(...) {
        return session.executeAsync(
            readAuthoritative.bind(...)
                .setExecutionProfileName("authoritative-read")
        ).thenApply(...);
    }

    CompletionStage<TransitionResult> transitionIfVersionMatches(...) {
        return session.executeAsync(
            transitionLwt.bind(...)
                .setExecutionProfileName("lwt-guard")
        ).thenApply(...);
    }
}
```

Do not let callers pass arbitrary CL unless there is strong reason.

Expose semantic methods.

---

## 34. Handling LWT Result in Java

CQL:

```sql
UPDATE case_current_by_id
SET status = ?, version = ?, updated_at = ?
WHERE tenant_id = ? AND case_id = ?
IF status = ? AND version = ?;
```

Java:

```java
CompletionStage<TransitionResult> transition(...) {
    BoundStatement stmt = transition.bind(...).setExecutionProfileName("lwt-guard");

    return session.executeAsync(stmt).thenCompose(rs -> {
        Row row = rs.one();
        boolean applied = row.getBoolean("[applied]");

        if (applied) {
            return CompletableFuture.completedFuture(TransitionResult.applied());
        }

        CaseStatus actualStatus = CaseStatus.valueOf(row.getString("status"));
        long actualVersion = row.getLong("version");

        return CompletableFuture.completedFuture(
            TransitionResult.conflict(actualStatus, actualVersion)
        );
    }).exceptionallyCompose(ex -> resolveUnknownTransitionOutcome(..., ex));
}
```

Key:

```text
not-applied is not exception
timeout is unknown outcome
```

---

## 35. Mapping Rows to Domain

Keep row mapping explicit.

Example:

```java
private CaseCurrent mapCaseCurrent(Row row) {
    return new CaseCurrent(
        new TenantId(row.getUuid("tenant_id")),
        new CaseId(row.getUuid("case_id")),
        CaseStatus.valueOf(row.getString("status")),
        row.getLong("version"),
        new AssigneeId(row.getUuid("assignee_id")),
        row.getInstant("updated_at")
    );
}
```

Avoid magical reflection mappers for core tables unless you know how they handle:

- null,
- unset,
- collections,
- UDT,
- enum changes,
- missing columns,
- schema evolution.

---

## 36. Null vs Unset in Java

From part 018:

```text
null can mean delete/tombstone
unset means do not modify
```

Java update statements should be command-specific.

Bad:

```java
UPDATE case_current_by_id
SET status = ?, assignee_id = ?, priority = ?, due_at = ?
WHERE ...
```

binding null for unchanged fields.

Good:

```java
UPDATE case_current_by_id
SET assignee_id = ?, updated_at = ?
WHERE ...
```

only for assign command.

Or use unset explicitly if driver supports it, but command-specific CQL is clearer.

---

## 37. Avoid Generic Save

Bad:

```java
caseRepository.save(caseObject);
```

This hides:

- which columns changed,
- whether null means delete,
- which CL used,
- whether LWT needed,
- whether derived views updated,
- idempotency,
- retry safety.

Prefer command methods:

```java
assignCase(...)
transitionCase(...)
updateDueDate(...)
appendEvent(...)
insertNotification(...)
```

Each maps to specific CQL and consistency profile.

---

## 38. Query Shape in Method Signature

Method should force full partition key.

Bad:

```java
List<Event> findEvents(EventFilter filter);
```

Good:

```java
CompletionStage<Page<CaseEvent>> findEventsByCaseVersionBucket(
    TenantId tenantId,
    CaseId caseId,
    long versionBucket,
    long fromVersion,
    int limit,
    PageCursor cursor
);
```

This prevents accidental unbounded query.

---

## 39. Bucket Computation in Java

Bucket function must be deterministic.

Example:

```java
long versionBucket(long eventVersion) {
    return eventVersion / 10_000L;
}
```

Time bucket:

```java
LocalDate bucketDayUtc(Instant instant) {
    return instant.atZone(ZoneOffset.UTC).toLocalDate();
}
```

Hash bucket:

```java
int bucketId(UUID id, int bucketCount) {
    return Math.floorMod(id.hashCode(), bucketCount);
}
```

For production, use stable hash function, not one whose output may change across languages/versions if cross-service.

---

## 40. Bucket Function as Contract

If bucket function changes, reads/deletes/retries break.

Do not scatter bucket calculation across codebase.

Use shared component:

```java
final class CaseBucketPolicy {
    long versionBucket(long version) { ... }
    int assigneeBucket(CaseId caseId) { ... }
}
```

Version it if needed.

---

## 41. Large Payload Discipline

Before binding payload:

```text
validate size
compress? maybe
store externally? maybe
```

Do not allow API request to write multi-MB blob into ScyllaDB row unintentionally.

Repository should enforce:

```java
if (payload.sizeBytes() > MAX_EVENT_PAYLOAD_BYTES) {
    throw new PayloadTooLargeException();
}
```

Large payload affects:

- latency,
- memory,
- compaction,
- repair,
- backup,
- network.

---

## 42. Observability in Java Client

Collect:

```text
operation name
table
execution profile
CL
latency
timeout count
unavailable count
retry count
result rows
page count
payload bytes
partition/bucket metadata sampled
LWT applied false
in-flight requests
driver metrics
```

Do not log raw PII or full keys if sensitive.

Use redacted key hash:

```text
tenant_id
table
partition_key_hash
bucket_day
bucket_id
```

---

## 43. Slow Query Logging

Application-side slow query log should include:

```text
operation
table
profile
duration
consistency
page size
rows returned
attempt count
timeout?
partition key hash
bucket info
```

Example:

```text
slow_scylla_query operation=findOpenCasesByAssigneeDayBucket
table=open_cases_by_assignee_day_bucket
profile=derived-read-fast
duration_ms=182
rows=50
tenant=...
assignee_hash=...
bucket_day=2026-06-21
bucket_id=7
```

This helps diagnose hot partitions/buckets.

---

## 44. Error Taxonomy Preview

Repository should distinguish:

```text
not found
conflict/applied=false
timeout unknown
unavailable
overloaded
invalid query
schema mismatch
codec/mapping error
authentication/authorization
connection issue
```

Do not collapse all into:

```java
RuntimeException("Database error")
```

Part 020 goes deeper.

---

## 45. Testing Repositories

Test:

```text
1. CQL statement has correct WHERE partition key.
2. prepared statements created at startup.
3. parameter order correct.
4. execution profile correct.
5. LWT applied=true/false handling.
6. timeout handling path.
7. null vs unset behavior.
8. collection size validation.
9. bucket calculation.
10. mapping missing optional column.
```

Use integration tests with real ScyllaDB/Testcontainers where possible.

---

## 46. Schema Migration Coordination

Prepared statements depend on schema.

If migration drops/renames columns while old app runs:

- prepared statements fail,
- mapping fails,
- query invalid.

Safe migration pattern:

```text
1. add new nullable column/table
2. deploy code writing both
3. backfill
4. switch reads
5. stop old writes
6. drop old column/table later
```

Part 023 covers schema evolution deeply.

Java app must tolerate rolling deploys.

---

## 47. Configuration as Code

Driver config should be versioned with application.

Include:

- contact points,
- local DC,
- keyspace,
- auth/TLS,
- execution profiles,
- timeouts,
- retry policy,
- speculative execution,
- metrics,
- request throttling if driver supports,
- pooling.

Do not leave production behavior to default unknowns.

---

## 48. Secure Connectivity

Production client should consider:

- TLS,
- authentication,
- authorization,
- certificate rotation,
- secrets management,
- network policy,
- least privilege role.

Security deep dive later, but Java driver setup must support it.

---

## 49. Common Anti-Patterns

### 49.1 Session Per Request

Kills performance.

### 49.2 Prepare Per Request

Wastes CPU/round-trips.

### 49.3 String Concatenated CQL

Bad routing, injection risk, parsing overhead.

### 49.4 Generic CRUD Repository

Hides access pattern and CL.

### 49.5 Unbounded Async

Creates client-side overload and DB overload.

### 49.6 Global Retry Policy

Retries non-idempotent writes.

### 49.7 Wrong Local DC

Cross-region latency/semantics bug.

### 49.8 Logging Full Partition Keys

PII/security risk.

### 49.9 Returning Huge Lists

Memory/p99 risk.

### 49.10 Treating Timeout as Failure

Unknown outcome bug.

---

## 50. Production Readiness Checklist

For Java client layer:

```text
[ ] One long-lived session per service process.
[ ] Local datacenter explicitly configured.
[ ] Contact points are real cluster nodes/service discovery, not topology-hiding LB.
[ ] All hot queries are prepared at startup.
[ ] Full partition key bound as values.
[ ] Execution profiles defined per operation type.
[ ] Repository methods are access-pattern-specific.
[ ] No generic save/findByFilter for ScyllaDB tables.
[ ] Async concurrency bounded.
[ ] Timeouts chosen per operation.
[ ] Retry policy respects idempotency.
[ ] LWT result handling checks [applied].
[ ] Timeout unknown outcome handled.
[ ] Page size and LIMIT enforced.
[ ] Bucket function centralized and tested.
[ ] Null vs unset semantics tested.
[ ] Metrics and slow query logging enabled.
[ ] Integration tests use real ScyllaDB-compatible environment.
```

---

## 51. Common Misconceptions

### Misconception 1: “ScyllaDB driver is like JDBC.”

No. It is distributed-system client with routing, pooling, metadata, and consistency behavior.

### Misconception 2: “Prepared statements are optional optimization.”

For hot paths, they are mandatory.

### Misconception 3: “Async means faster automatically.”

Unbounded async causes overload.

### Misconception 4: “CL can be global config.”

CL should follow operation semantics.

### Misconception 5: “Timeout means operation failed.”

Write/LWT timeout means unknown.

### Misconception 6: “Repository can hide database details.”

In ScyllaDB, repository must encode access pattern.

### Misconception 7: “Driver paging state is always safe as public cursor.”

Often better to use domain cursor.

### Misconception 8: “Load balancer in front of DB is harmless.”

It can break topology/token/shard awareness.

---

## 52. Mental Model Compression

Remember:

```text
Schema decides physical access path.
Driver decides whether request reaches that path efficiently.
Repository decides whether application preserves query semantics.
```

Java client engineering is not boilerplate.

It is part of ScyllaDB performance and correctness model.

---

## 53. Summary

Java client engineering is where ScyllaDB data modeling becomes production behavior.

Key lessons:

1. Use one long-lived session per process.
2. Configure local datacenter explicitly.
3. Use Scylla-aware/shard-aware driver when possible.
4. Prepare hot-path statements once.
5. Bind full partition key values.
6. Token/shard-aware routing depends on query shape and bound values.
7. Execution profiles should encode CL/timeout per operation.
8. Repository methods must mirror access patterns.
9. Avoid generic CRUD/save/filter APIs.
10. Async must be bounded.
11. Timeout does not always mean failure.
12. Retry depends on idempotency.
13. LWT must check `[applied]`.
14. Null vs unset matters.
15. Bucket functions are schema contracts.
16. Java mapper behavior can create tombstones or races.
17. Observability must include operation/profile/table/fanout/rows.
18. Driver config is production code.

---

## 54. Review Questions

1. Mengapa session harus long-lived?
2. Mengapa prepare per request buruk?
3. Apa benefit prepared statement?
4. Bagaimana token-aware routing bekerja?
5. Apa perbedaan token-aware dan shard-aware routing?
6. Kenapa full partition key harus dibind?
7. Apa risiko generic load balancer di depan ScyllaDB?
8. Apa fungsi local datacenter config?
9. Apa itu execution profile?
10. Mengapa CL sebaiknya per operation profile?
11. Mengapa generic CRUD repository buruk?
12. Bagaimana method signature memaksa query shape?
13. Apa risiko unbounded async?
14. Apa beda CQL LIMIT dan page size?
15. Kenapa driver paging state belum tentu public API cursor?
16. Bagaimana handle LWT `[applied]=false`?
17. Kenapa timeout write outcome unknown?
18. Apa perbedaan null dan unset?
19. Mengapa bucket function harus terpusat?
20. Metrik apa yang harus dicatat di Java client layer?

---

## 55. Practical Exercise

Buat Java repository design untuk table berikut:

```text
case_current_by_id
case_events_by_case_version_bucket
open_cases_by_assignee_day_bucket
command_idempotency_by_id
notifications_by_user_day
```

Untuk setiap repository, tulis:

```text
1. prepared statements
2. method signatures
3. execution profile per method
4. consistency level
5. timeout
6. idempotency classification
7. LWT handling if any
8. page size and limit
9. bucket calculation
10. row mapping
11. error taxonomy
12. metrics emitted
13. slow query log fields
14. tests
```

---

## 56. Preview Part 020

Part berikutnya melanjutkan Java client engineering:

```text
Java Client Engineering II:
timeouts,
retry policies,
speculative execution,
idempotence,
paging,
backpressure,
bounded concurrency,
bulk async writes,
error taxonomy,
observability,
and production hardening.
```

Part 019 membangun fondasi driver/session/prepared/routing/profile.

Part 020 akan membuatnya tahan beban dan failure.

---

# End of Part 019

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Counters, Atomicity Boundaries, Static Columns, Collections, dan UDT</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-020.md">Part 020 — Java Client Engineering II: Timeouts, Retries, Paging, Backpressure, Observability, dan Production Hardening ➡️</a>
</div>

# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-022.md

# Part 022 — Batching, Bulk Loading, Backfill, dan High-Volume Write Pipelines

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `022`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: membedakan CQL BATCH vs application batching, merancang high-volume write pipeline, backfill, dual-write migration, bulk loading, checkpointing, idempotency, throttling, retry, write amplification, dan operational safety.

---

## 0. Posisi Part Ini dalam Seri

Part 021 membahas query execution and performance:

```text
coordinator path
replica path
read/write path
ALLOW FILTERING
IN queries
large partitions
p99 debugging
```

Part ini membahas workload yang sering memicu incident production:

```text
large write volume
backfill
migration
bulk ingest
dual-write
projection rebuild
data repair job
historical import
```

Contoh:

```text
backfill open_cases_by_assignee from case_current_by_id
rebuild notifications_by_user_day
import 2B device telemetry rows
migrate legacy Cassandra/Postgres data to ScyllaDB
dual-write new derived table
recompute dashboard aggregates
restore from object storage
```

High-volume write pipeline bukan hanya loop:

```java
for (row : rows) {
    session.execute(insert.bind(row));
}
```

Ia adalah distributed workflow yang harus punya:

- idempotency,
- throttle,
- checkpoint,
- retry,
- dead letter,
- consistency profile,
- operational visibility,
- rollback plan,
- compaction awareness,
- repair/validation plan,
- tenant isolation,
- kill switch.

---

## 1. Batching Has Two Meanings

Kata “batching” sering ambigu.

Ada dua arti berbeda:

### 1.1 CQL BATCH

CQL statement:

```sql
BEGIN BATCH
  INSERT ...
  UPDATE ...
APPLY BATCH;
```

Ini fitur database-level batch.

### 1.2 Application Batching

Application mengelompokkan pekerjaan untuk efisiensi:

```text
read 1000 rows from source
write them concurrently with max in-flight 256
checkpoint after success
```

Ini bukan CQL BATCH.

Kesalahan umum:

```text
mengira CQL BATCH adalah cara umum untuk meningkatkan throughput bulk write
```

Sering salah.

---

## 2. CQL BATCH Mental Model

CQL BATCH bukan JDBC batch.

Di JDBC/SQL, batch sering berarti:

```text
send many statements efficiently
```

Di Cassandra/ScyllaDB-style systems, CQL BATCH punya semantic dan cost khusus.

Use case yang relatif masuk akal:

```text
small number of mutations
same partition
logically related
atomic-ish within partition semantics
```

Bad use case:

```text
thousands of inserts across many unrelated partition keys
```

Ini membebani coordinator.

---

## 3. Logged vs Unlogged Batch

CQL supports batch types conceptually:

```text
LOGGED
UNLOGGED
COUNTER
```

### 3.1 Logged Batch

Logged batch uses batch log for durability of batch application.

But it is not a general multi-partition SQL transaction replacement.

Cost increases if batch spans many partitions.

### 3.2 Unlogged Batch

Unlogged batch skips batch log but still sends mutations.

Can be useful for same-partition grouping.

Dangerous if used to hide cross-partition bulk write.

### 3.3 Counter Batch

Counter batches have special restrictions/semantics.

Avoid unless you deeply understand counter behavior.

---

## 4. CQL BATCH Anti-Pattern

Bad:

```java
BatchStatementBuilder batch = BatchStatement.builder(DefaultBatchType.LOGGED);

for (Event event : events) {
    batch.addStatement(insertEvent.bind(...));
}

session.execute(batch.build());
```

If events have different partition keys:

```text
one coordinator receives huge batch
coordinator fans out to many replicas
large batch log
large memory pressure
timeout risk
partial/unknown outcome
```

Better:

```text
individual prepared statements
bounded async concurrency
idempotent keys
application-level progress
```

---

## 5. When CQL BATCH Is Acceptable

Use cautiously when:

```text
[ ] batch is small
[ ] mutations are same partition or very few partitions
[ ] logical semantics need grouping
[ ] size is bounded
[ ] timeout handling is defined
[ ] retries are idempotent
```

Example:

```text
insert event row and partition metadata row in same partition
```

Even then, evaluate if normal individual writes are clearer.

---

## 6. Application Batching

Application batching means processing data in chunks without using CQL BATCH.

Example:

```text
read 1000 source rows
transform
write with max 256 in-flight
wait for completion
checkpoint
repeat
```

Benefits:

- bounded memory,
- bounded DB load,
- retry per row,
- progress tracking,
- partial failure handling,
- backpressure,
- tenant isolation,
- metrics.

This is the default approach for high-volume writes.

---

## 7. High-Volume Write Pipeline Shape

A robust pipeline:

```text
source reader
  -> transformer/validator
  -> partitioner/throttler
  -> async writer
  -> retry/dead letter
  -> checkpoint
  -> validation
```

Each stage has bounded queue.

No stage should be unbounded.

Pipeline must answer:

```text
How much work is in flight?
Where is progress recorded?
Can it resume after crash?
Can it stop safely?
Can it throttle when cluster unhealthy?
What happens to bad records?
```

---

## 8. Idempotency First

Backfill/bulk writes must be idempotent.

Good:

```text
same source row -> same target primary key
same retry -> same mutation
```

Bad:

```text
retry generates new UUID
retry appends duplicate list item
retry increments counter
```

For backfill:

```text
target primary key deterministic from source data
```

Example:

```text
case_id + version_bucket + event_version + event_id
```

or:

```text
tenant_id + assignee_id + bucket_day + bucket_id + due_at + case_id
```

---

## 9. Checkpointing

Checkpoint records progress durably.

Without checkpoint, crash means:

```text
restart from beginning
or skip unknown range
```

Checkpoint types:

- source offset,
- token range position,
- tenant ID + last key,
- timestamp bucket,
- Kafka offset,
- file position,
- page cursor,
- job shard progress.

Example table:

```sql
CREATE TABLE backfill_progress_by_job (
    job_id uuid,
    shard_id int,
    status text,
    checkpoint text,
    rows_read bigint,
    rows_written bigint,
    rows_failed bigint,
    updated_at timestamp,
    PRIMARY KEY ((job_id), shard_id)
);
```

Checkpoint after writes are safely completed.

---

## 10. At-Least-Once Processing

Most backfill/projection pipelines are at-least-once.

Meaning:

```text
a source record may be processed more than once
```

Therefore target writes must be idempotent.

Exactly-once across source, DB, and external systems is difficult.

Use:

```text
at-least-once + idempotent writes + reconciliation
```

This is production-friendly.

---

## 11. Retry Strategy for Bulk Writes

Retry:

- transient timeout,
- unavailable if cluster recovers,
- overloaded with backoff,
- network errors.

Do not retry:

- invalid query,
- schema mismatch,
- serialization/codec bug,
- validation error,
- permanent constraint/business error.

Retry must be:

```text
bounded
jittered
deadline-aware
idempotent
observable
```

For large job, retry budget per row and per job.

---

## 12. Dead Letter

Bad records should not block entire job forever.

Dead letter table/file:

```sql
CREATE TABLE backfill_failures_by_job (
    job_id uuid,
    shard_id int,
    failed_at timestamp,
    source_key text,
    error_code text,
    error_message text,
    payload text,
    PRIMARY KEY ((job_id, shard_id), failed_at, source_key)
);
```

Use DLQ for:

- bad payload,
- validation failure,
- repeated retry exhaustion,
- missing source dependency,
- unknown schema version.

Do not silently drop.

---

## 13. Throttling

Backfill must not compete equally with user traffic.

Throttles:

```text
max QPS
max in-flight
max per tenant
max per node? indirectly via driver
max per table
pause on error rate
pause on compaction backlog
pause on p99 spike
```

Simple throttle:

```text
targetWritesPerSecond = 5000
maxInFlight = 256
```

Adaptive throttle reduces throughput when:

- timeout rate high,
- p99 high,
- ScyllaDB compaction backlog high,
- disk usage high,
- CPU high.

---

## 14. Bounded Async Writer

Pseudo:

```java
final class BoundedScyllaWriter {
    private final Semaphore permits;
    private final CqlSession session;

    CompletionStage<AsyncResultSet> write(BoundStatement stmt) {
        return acquirePermit()
            .thenCompose(permit ->
                session.executeAsync(stmt)
                    .whenComplete((rs, ex) -> permit.release())
            );
    }
}
```

Production concerns:

- non-blocking permit acquisition,
- cancellation,
- timeout,
- retry,
- metrics,
- graceful shutdown.

---

## 15. Chunk Size vs In-Flight

Chunk size:

```text
how many source records read/processed at once
```

In-flight:

```text
how many DB requests currently running
```

They are different.

Example:

```text
source chunk = 10,000
max in-flight writes = 256
```

Chunk too large:

- memory high,
- checkpoint coarse,
- failure replay large.

Chunk too small:

- overhead high.

Tune based on memory and source.

---

## 16. Bulk Loading Options

High-volume ingestion options:

1. normal CQL writes through driver,
2. bounded async application pipeline,
3. ScyllaDB bulk loader tools,
4. SSTable-based import,
5. streaming/CDC pipeline,
6. connector ecosystem.

Choose based on:

- data volume,
- downtime allowed,
- transformation complexity,
- idempotency,
- cluster load,
- source format,
- validation needs,
- operational tooling.

For online migration/backfill, application-level pipeline is often safest.

For huge offline import, bulk loader may be better.

---

## 17. Normal Driver Writes vs Bulk Loader

### Driver Writes

Pros:

- simple,
- uses normal write path,
- easy transformation,
- easy validation,
- online friendly,
- respects app idempotency.

Cons:

- slower for massive imports,
- competes with foreground traffic,
- creates memtable/commitlog/compaction load.

### Bulk Loader

Pros:

- high throughput,
- optimized for large data,
- may avoid some client overhead.

Cons:

- operational complexity,
- format/schema constraints,
- compaction/repair considerations,
- validation needed,
- less flexible transformation.

---

## 18. Backfill Use Cases

Common backfills:

```text
populate new derived table
add new column value
recompute bucket id
fix bad projection
migrate table v1 -> v2
rebuild aggregate
repair missing notifications
copy data from legacy system
```

Each requires:

- source of truth,
- target schema,
- deterministic mapping,
- progress,
- validation,
- cutover plan.

---

## 19. Dual-Write Migration

Pattern:

```text
1. create new table
2. deploy code dual-writing old + new
3. backfill historical data to new
4. validate new vs old/source
5. switch reads to new
6. stop old writes
7. retire old table later
```

Risks:

- dual-write partial failure,
- backfill race with live writes,
- source version mismatch,
- read cutover before complete,
- rollback complexity.

Mitigations:

- source_version in target rows,
- idempotent target upsert,
- replay recent changes after backfill,
- feature flags,
- compare counts/samples,
- rollback to old read path.

---

## 20. Backfill Race with Live Writes

Problem:

```text
backfill reads old state version 10
live write updates to version 11 and writes new table
backfill later writes version 10 to new table
```

Target now stale.

Solutions:

1. include `source_version` and write only if newer via LWT.
2. backfill from immutable event log in order.
3. dual-write live changes and replay recent window after backfill.
4. make projection idempotent and version-aware.
5. validate after cutover.

LWT per backfill row may be expensive; often use replay/validation instead.

---

## 21. Source Version in Backfill

Target row:

```sql
source_version bigint,
backfilled_at timestamp,
projection_version int
```

Backfill writes:

```text
source_version = current.version
```

Live projection writes newer version.

Reader can detect stale:

```text
if derived.source_version < current.version:
  validate or refresh
```

Reconciliation can repair.

---

## 22. Validation

Backfill is not complete until validated.

Validation types:

### 22.1 Count Validation

```text
source count by tenant/bucket
target count by tenant/bucket
```

Fast but not enough.

### 22.2 Sample Validation

Random sample source rows and verify target.

### 22.3 Checksum Validation

Compute hash/checksum over deterministic fields per shard.

### 22.4 Semantic Validation

Run real query and compare expected behavior.

### 22.5 Drift Monitoring

After cutover, monitor mismatches.

---

## 23. Reconciliation

Reconciliation repairs target from source.

For derived table:

```text
source current/events
compute expected target row(s)
upsert missing/current
delete stale if safe
```

Reconciliation can be:

- one-time after backfill,
- continuous background,
- scheduled,
- triggered by stale read,
- operator job.

Backfill without reconciliation plan is risky.

---

## 24. Delete Handling in Backfill

Backfill often ignores deletes accidentally.

Scenarios:

```text
source row deleted during backfill
target row already written
```

Need:

- source tombstone/event log,
- live dual-write delete projection,
- validation to find stale target,
- cleanup pass,
- TTL alignment,
- soft delete state.

If source is current snapshot only, historical deletes may be invisible.

---

## 25. Backfill from Event Log vs Current Snapshot

### Event Log Source

Pros:

- replayable,
- captures deletes/transitions,
- audit-friendly,
- deterministic temporal rebuild.

Cons:

- large volume,
- ordering complexity,
- schema evolution.

### Current Snapshot Source

Pros:

- smaller,
- faster for current views,
- simple.

Cons:

- misses history,
- cannot reconstruct deleted rows,
- if snapshot corrupted, target inherits corruption.

Choose based on target semantics.

---

## 26. Token Range Backfill

For ScyllaDB source table, backfill can scan by token ranges.

Process:

```text
split token ring/tablet ranges
assign job shards
scan page by page
write target
checkpoint token/page
```

Cautions:

- token scans are heavy,
- throttle,
- avoid user peak,
- page size sane,
- handle topology changes,
- validate.

Token range scans are for batch, not online endpoint.

---

## 27. Tenant/Bucket Backfill

If data model has tenant/time buckets, backfill by tenant/bucket may be simpler.

Example:

```text
for tenant in tenants:
  for day in dateRange:
    scan source bucket
    write target
    checkpoint tenant/day
```

Benefits:

- aligns with business progress,
- easier pause per tenant,
- easier validation,
- per-tenant throttling.

Risk:

- tenant size skew,
- one mega tenant long-running.

---

## 28. Kafka/Stream Projection Backfill

Pattern:

```text
1. start projector from current stream offset for live changes
2. backfill historical source
3. replay stream from saved offset
4. switch reads
```

This avoids missing live changes during backfill.

Need:

- idempotent projection,
- source version/order,
- stream retention enough,
- checkpoint,
- duplicate handling.

---

## 29. CDC-Based Pipelines

CDC can propagate table changes to projection/search/warehouse.

Use cases:

- external index update,
- async derived table,
- audit integration,
- cache invalidation.

Requirements:

- understand CDC ordering,
- retention,
- duplicates,
- schema changes,
- checkpoint,
- replay,
- idempotency.

CDC is propagation mechanism, not data model replacement.

---

## 30. Outbox Pattern

Outbox table/message captures change event.

Common flow:

```text
write source change
write outbox event
publisher reads outbox
publishes to stream/projector
```

In ScyllaDB, cross-table atomicity is not free.

Possible designs:

- event log itself is outbox,
- command state table tracks progress,
- CDC on source table,
- application publishes after successful source write with reconciliation,
- stream is source of truth and Scylla is projection.

Choose based on correctness.

---

## 31. High-Volume Writes and Compaction

Bulk writes create:

- commitlog pressure,
- memtable flushes,
- many SSTables,
- compaction backlog,
- disk usage growth,
- cache churn.

Throttle based on:

```text
pending compactions
disk utilization
write latency
read p99
SSTable count
CPU/IO
```

Backfill should slow down when cluster has compaction debt.

---

## 32. High-Volume Writes and Tombstones

Backfill can create tombstones if:

- overwriting nulls,
- deleting stale rows,
- updating collections,
- TTL rows expire quickly,
- derived cleanup emits deletes.

Avoid:

- unnecessary deletes,
- full collection replacement,
- null writes,
- short TTL during huge load unless designed.

---

## 33. High-Volume Writes and Repair

After bulk loading/import, repair/validation may be needed depending method and consistency.

If using normal CL writes with RF, data is replicated according to CL and eventual mechanisms, but repair still part of cluster hygiene.

If using SSTable/bulk loading mechanisms, follow official operational guidance for repair/cleanup/validation.

Application engineer takeaway:

```text
bulk load plan must involve DB operations.
```

---

## 34. High-Volume Writes and Consistency Level

For backfill derived table:

```text
write CL LOCAL_ONE
```

may be acceptable if rebuildable and validation follows.

For source-of-truth import:

```text
LOCAL_QUORUM
```

may be required.

Trade-off:

- higher CL = stronger acknowledgement, lower throughput/availability,
- lower CL = faster, more reconciliation needed.

Use authority matrix.

---

## 35. High-Volume Writes and Multi-DC

Multi-DC backfill questions:

```text
write in one DC or each DC?
LOCAL_QUORUM or EACH_QUORUM?
replication traffic impact?
remote DC lag?
network bandwidth?
read cutover per region?
```

Usually:

```text
write locally with LOCAL_QUORUM
let replication handle remote
monitor remote lag/repair
```

But requirements vary.

Avoid massive cross-DC synchronous backfill unless necessary.

---

## 36. Payload Size Control

Backfill can accidentally import huge payloads.

Validate:

```text
max row size
max payload bytes
max collection size
max string length
```

Reject or externalize large data.

Large rows harm:

- write latency,
- read latency,
- compaction,
- repair,
- backup,
- Java heap.

---

## 37. Schema Versioning in Pipeline

Source records may have schema versions.

Pipeline must handle:

```text
old payload format
new payload format
missing fields
renamed enum
deprecated columns
```

Approach:

- versioned decoder,
- validation,
- DLQ for unknown version,
- explicit defaulting,
- migration tests.

Do not let one old record crash job forever.

---

## 38. Backfill Job State Machine

Job states:

```text
CREATED
RUNNING
PAUSED
DRAINING
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
CANCELLED
VALIDATING
CUTOVER_READY
```

State table:

```sql
CREATE TABLE backfill_job_by_id (
    job_id uuid PRIMARY KEY,
    job_type text,
    status text,
    created_at timestamp,
    updated_at timestamp,
    config text,
    error_code text,
    error_message text
);
```

Shard progress table tracks per-shard checkpoint.

---

## 39. Pause/Resume/Kill Switch

Production backfill must support:

- pause new reads from source,
- stop scheduling writes,
- drain in-flight,
- persist checkpoint,
- resume later,
- kill job safely.

Operator should not need to kill pod and hope.

---

## 40. Rate Limit by Cluster Health

Backfill controller can poll metrics:

```text
if read p99 > threshold -> reduce rate
if timeout rate > threshold -> reduce rate
if compaction pending high -> pause
if disk > threshold -> pause
```

Start simple:

```text
manual throttle + dashboards
```

Then adaptive if needed.

---

## 41. Data Ordering

Backfill order matters if:

- source has versions,
- target needs latest state,
- projection depends on old/new transitions,
- deletes must apply after inserts.

If order matters, process per entity in order.

If order does not matter and writes are idempotent upserts, parallelize.

---

## 42. Exactly-Once Myth

Many teams aim for exactly-once and end up with fragile design.

Practical robust model:

```text
at-least-once source read
idempotent target write
checkpoint after success
reconciliation/validation
```

Exactly-once can be approximated within constrained systems, but across DB + stream + external index it is expensive.

---

## 43. Duplicate Handling

Duplicates can come from:

- source duplicated,
- retry,
- job restart,
- stream replay,
- checkpoint rollback,
- operator rerun.

Target should tolerate duplicates.

Use deterministic key:

```text
source_id -> target primary key
```

For projection events:

```text
event_id
source_version
aggregate_id
```

---

## 44. Partial Failure Examples

### 44.1 Target Write Timeout

Outcome unknown.

If idempotent upsert:

```text
retry same statement
```

### 44.2 Job Crashes After Writes Before Checkpoint

On restart, same records processed again.

Idempotent writes make safe.

### 44.3 Checkpoint Advanced Before Writes Complete

Data loss.

Never checkpoint before all writes for checkpoint range are confirmed or safely recoverable.

### 44.4 Source Record Invalid

Send DLQ and continue depending policy.

### 44.5 Cluster Overloaded

Pause/throttle; do not retry storm.

---

## 45. Cutover Strategy

When switching reads to new table:

```text
feature flag
tenant-by-tenant rollout
shadow read compare
canary users
fallback to old table
monitor p99/errors/mismatch
```

Shadow read:

```text
serve old result
also query new table
compare asynchronously
record mismatch
```

This validates without user impact.

---

## 46. Rollback Strategy

Before cutover, define rollback.

Rollback options:

- switch read flag back,
- continue dual-write,
- stop new table writes,
- rebuild again,
- drop new table later.

If old table stops receiving writes too soon, rollback impossible.

Keep old path until confidence.

---

## 47. Cleanup After Migration

After cutover:

```text
monitor
stop old reads
stop old writes
archive old table
drop old table later
remove code
remove metrics
update docs
```

Do not leave permanent dual-write accidentally.

Dual-write doubles cost.

---

## 48. Write Amplification Awareness

If command writes:

```text
source table
current table
3 derived tables
2 indexes/MVs
outbox
```

Backfill may multiply this.

When bulk loading, consider disabling unnecessary derived projections if rebuilding separately, but only with correctness plan.

Write amplification affects:

- throughput,
- compaction,
- disk,
- network,
- repair.

---

## 49. Testing Backfill

Test with:

```text
small dataset
large dataset
skewed tenant
bad records
timeout injection
job crash
resume
duplicate source records
live writes during backfill
schema version mix
validation mismatch
cutover rollback
```

Do not test only happy path.

---

## 50. Load Testing Backfill

Measure:

- rows/sec,
- writes/sec,
- p50/p99 write latency,
- timeout rate,
- compaction backlog,
- disk growth,
- foreground API p99 impact,
- CPU/IO,
- network,
- validation mismatch,
- DLQ rate.

Run with representative cluster/data.

---

## 51. Operational Dashboard

Backfill dashboard:

```text
job status
progress %
rows read
rows written
rows failed
current checkpoint
write QPS
in-flight
retry rate
DLQ count
latency p99
cluster read/write p99
compaction pending
disk usage
estimated time remaining
pause state
```

Without dashboard, backfill is blind.

---

## 52. Alerting

Alert on:

```text
job stuck
DLQ spike
timeout rate high
retry exhaustion
compaction backlog high
disk usage high
foreground p99 degraded
validation mismatch
checkpoint not advancing
projection lag high
```

Backfill should be observable like production traffic.

---

## 53. Java Implementation Sketch

Components:

```text
SourceReader
RecordTransformer
TargetWriter
RetryPolicy
CheckpointStore
FailureSink
ThrottleController
JobCoordinator
Validator
```

Do not put all logic in one main method.

Each component testable.

---

## 54. SourceReader

Responsibilities:

- read bounded chunk/page,
- resume from checkpoint,
- handle source errors,
- preserve ordering if needed,
- expose progress.

Source can be:

- ScyllaDB token/bucket scan,
- Postgres cursor,
- Kafka topic,
- file/object storage,
- API.

---

## 55. TargetWriter

Responsibilities:

- prepare statements,
- bind deterministic keys,
- enforce payload limits,
- execute with bounded concurrency,
- classify errors,
- retry idempotently,
- emit metrics.

No business mapping hidden here.

---

## 56. CheckpointStore

Responsibilities:

- save progress after safe writes,
- read progress on resume,
- support shard-level checkpoints,
- update heartbeat,
- support pause/cancel.

Checkpoint write itself should be reliable and not too frequent.

---

## 57. FailureSink

Responsibilities:

- record failed source record,
- include error code/message,
- include source key and job ID,
- avoid PII leakage if logs external,
- support replay after fix.

---

## 58. ThrottleController

Responsibilities:

- fixed QPS/in-flight cap,
- manual pause,
- adaptive reduce/increase,
- per-tenant fairness,
- cluster health integration.

Start fixed/manual; add adaptive later.

---

## 59. Common Anti-Patterns

### 59.1 CQL Batch for Bulk Import

Wrong abstraction.

### 59.2 No Checkpoint

Crash loses progress or duplicates unbounded.

### 59.3 Random IDs in Backfill

Retries create duplicates.

### 59.4 Checkpoint Before Write Completion

Data loss.

### 59.5 No Throttle

Cluster incident.

### 59.6 No DLQ

One poison record stops job.

### 59.7 No Validation

Silent corruption.

### 59.8 Cutover All Tenants at Once

Blast radius too large.

### 59.9 Permanent Dual-Write

Cost and complexity never removed.

### 59.10 Ignoring Compaction

Backfill looks fine then cluster suffers later.

---

## 60. Design Checklist

Before running high-volume write job:

```text
[ ] Source of truth identified.
[ ] Target schema reviewed.
[ ] Mapping deterministic.
[ ] Target primary key deterministic.
[ ] Writes idempotent.
[ ] Retry policy safe.
[ ] Checkpoint defined.
[ ] DLQ defined.
[ ] Throttle configured.
[ ] Max in-flight configured.
[ ] Per-tenant fairness considered.
[ ] Payload limits enforced.
[ ] Schema versions handled.
[ ] Validation plan defined.
[ ] Cutover plan defined.
[ ] Rollback plan defined.
[ ] Metrics/dashboard ready.
[ ] Kill switch ready.
[ ] SRE/DBA aware.
[ ] Load test completed.
```

---

## 61. Common Misconceptions

### Misconception 1: “CQL BATCH improves bulk write throughput.”

Often false; bounded async individual writes are usually better.

### Misconception 2: “Backfill can be rerun safely by default.”

Only if writes are idempotent.

### Misconception 3: “Checkpointing is optional.”

Without checkpoint, resume semantics are unsafe.

### Misconception 4: “LOCAL_ONE is always fine for derived table backfill.”

Maybe, but validation/reconciliation must match.

### Misconception 5: “Cutover is just changing one config.”

Cutover requires validation, monitoring, and rollback.

### Misconception 6: “Backfill is offline, so it does not affect production.”

It shares cluster resources and compaction.

### Misconception 7: “DLQ means data loss.”

DLQ is controlled failure capture, better than silent drop or stuck job.

### Misconception 8: “Exactly-once is required.”

At-least-once + idempotency + validation is often more robust.

---

## 62. Mental Model Compression

Remember:

```text
CQL BATCH groups mutations with database semantics.
Application batching controls workload.
Bulk pipeline is a distributed workflow.
Backfill correctness = idempotency + checkpoint + validation.
Backfill safety = throttle + observability + rollback.
```

---

## 63. Summary

High-volume writes require pipeline engineering, not just faster loops.

Key lessons:

1. CQL BATCH is not JDBC batch.
2. Avoid large cross-partition CQL batches.
3. Application batching with bounded async writes is the normal pattern.
4. Backfill writes must be idempotent.
5. Checkpoint after safe completion, not before.
6. At-least-once processing is expected; target must tolerate duplicates.
7. Retry must be bounded and safe.
8. DLQ prevents poison records from blocking jobs.
9. Throttling protects foreground traffic and compaction.
10. Dual-write migration needs validation and rollback.
11. Backfill races with live writes require source_version/replay/validation.
12. Token range scans are batch workflows, not online query paths.
13. CDC/outbox are propagation mechanisms, not magic correctness.
14. Bulk writes create compaction and disk pressure.
15. Multi-DC backfill requires replication/network planning.
16. Payload size must be validated.
17. Cutover should be canary/feature-flagged.
18. Operational dashboards and kill switches are mandatory.

---

## 64. Review Questions

1. Apa beda CQL BATCH dan application batching?
2. Kenapa CQL BATCH bukan JDBC batch?
3. Kapan CQL BATCH masih acceptable?
4. Apa komponen high-volume write pipeline?
5. Kenapa idempotency penting untuk backfill?
6. Apa itu checkpoint dan kapan ditulis?
7. Apa arti at-least-once processing?
8. Kapan retry aman?
9. Apa fungsi DLQ?
10. Bagaimana throttle melindungi cluster?
11. Apa risiko dual-write migration?
12. Bagaimana backfill race dengan live writes terjadi?
13. Apa fungsi source_version?
14. Bagaimana validasi backfill dilakukan?
15. Kapan backfill dari event log lebih baik?
16. Apa risiko token range backfill?
17. Bagaimana CDC/outbox dipakai?
18. Bagaimana compaction terdampak bulk write?
19. Apa strategi cutover yang aman?
20. Apa anti-pattern terbesar dalam bulk import?

---

## 65. Practical Exercise

Desain backfill untuk membuat table baru:

```text
open_cases_by_assignee_day_bucket_v2
```

dari source:

```text
case_current_by_id
```

Requirement:

```text
- service tetap online
- live writes terus berjalan
- tenant besar tidak boleh mengganggu tenant kecil
- target row punya source_version
- cutover tenant-by-tenant
- rollback harus bisa
```

Tulis desain:

```text
1. source reader strategy
2. target schema
3. deterministic target key
4. execution profile
5. max in-flight
6. per-tenant throttle
7. checkpoint table
8. DLQ table
9. retry policy
10. handling live write race
11. validation method
12. shadow read compare
13. cutover plan
14. rollback plan
15. dashboard metrics
16. alerts
17. kill switch
18. cleanup after migration
```

---

## 66. Preview Part 023

Part berikutnya membahas:

```text
Schema Evolution:
DDL safety,
rolling deploy,
adding/removing columns,
new tables,
dual writes,
backfills,
compatibility,
schema agreement,
versioned projections,
and migration playbooks.
```

Part 022 membahas pipeline write/backfill.

Part 023 akan memperdalam evolusi schema dan deployment compatibility.

---

# End of Part 022

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Query Execution and Performance: Coordinator Path, Replica Path, Paging, ALLOW FILTERING, IN Queries, dan p99 Debugging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-023.md">Part 023 — Schema Evolution: DDL Safety, Rolling Deploy, Compatibility, Dual-Write, Backfill, dan Migration Playbooks ➡️</a>
</div>

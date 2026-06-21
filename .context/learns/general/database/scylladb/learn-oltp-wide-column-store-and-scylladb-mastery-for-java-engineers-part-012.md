# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-012.md

# Part 012 — Multi-Access-Pattern Design: Duplicate Tables, Fanout, dan Derived Views

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `012`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: mendesain banyak access pattern tanpa SQL join/index tradisional: duplicate tables, derived views, fanout writes, application-maintained indexes, materialized views, source-of-truth, projection, reconciliation, backfill, dan failure handling.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membangun fondasi:

```text
Part 008: Primary key design
Part 009: Query-first data modeling
Part 010: Partition sizing, hot partition, bucketing
Part 011: Time-series modeling
```

Part ini menjawab problem nyata yang hampir selalu muncul setelah kita paham primary key:

> Bagaimana jika satu entity harus dibaca dengan banyak cara?

Contoh `case` dalam regulatory platform:

```text
read case by id
list open cases by assignee
list cases due today by team
show latest events by case
search by reference
show dashboard count by status
show notifications by user
export audit history
```

Di SQL, kita mungkin berpikir:

```text
one normalized cases table
+
indexes
+
joins
+
ORDER BY
+
WHERE
```

Di ScyllaDB, kita berpikir:

```text
one access pattern = one physical read path
```

Artinya kita sering membuat beberapa table yang menyimpan data yang sama atau data turunan.

Ini bukan “dirty denormalization”. Ini adalah core design model wide-column store.

Tetapi duplication bukan gratis. Ia menciptakan:

- write amplification,
- consistency gap,
- partial failure,
- derived table drift,
- backfill complexity,
- cleanup/tombstone cost,
- Java workflow complexity.

Part ini membahas cara melakukannya secara benar.

---

## 1. Kenapa Duplicate Tables Dibutuhkan?

ScyllaDB table dioptimalkan untuk primary key tertentu.

Table:

```sql
case_current_by_id
PRIMARY KEY ((tenant_id, case_id))
```

melayani:

```text
read current case by ID
```

Tidak otomatis melayani:

```text
list open cases by assignee sorted by due date
```

Untuk itu perlu table lain:

```sql
open_cases_by_assignee_day_bucket
PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
```

Data `case_id`, `status`, `title`, `priority`, `due_at` mungkin diduplikasi.

Tujuan:

```text
avoid cluster scan
avoid ALLOW FILTERING
avoid unpredictable p99
serve query by known partition key
```

ScyllaDB documentation explicitly recommends query-first modeling: design data model around queries it needs to execute, and schema design follows those constraints. That naturally leads to denormalized/duplicated access-path tables for important queries.

---

## 2. Duplication Is a Read Optimization Paid by Writes

Setiap duplicate table adalah trade-off.

```text
faster reads
more writes
more storage
more consistency work
```

Example command:

```text
assign case to reviewer
```

May update:

```text
case_current_by_id
case_events_by_case_version_bucket
open_cases_by_assignee_day_bucket
due_cases_by_team_day_bucket
notifications_by_user_day
case_counts_by_status_day
```

This is write fanout.

If one logical command writes 6 tables:

```text
write amplification = at least 6 application-level writes
```

plus:

- RF replication,
- commitlog,
- memtable,
- SSTable,
- compaction,
- repair,
- backup.

Therefore duplicate only when access pattern justifies it.

---

## 3. Source-of-Truth vs Derived View

This distinction is non-negotiable.

### 3.1 Source-of-Truth Table

A table whose data is authoritative.

Example:

```text
case_events_by_case_version_bucket
```

Properties:

- must be durable,
- must be correct,
- must be backed up,
- must not silently lose data,
- must be protected from unsafe TTL/delete,
- used for reconciliation/rebuild.

### 3.2 Authoritative Snapshot

A current-state table may be authoritative for online command processing.

Example:

```text
case_current_by_id
```

It may be rebuildable from event log, but operationally authoritative for reads/transitions.

### 3.3 Derived View

A table maintained to serve a read access pattern.

Example:

```text
open_cases_by_assignee_day_bucket
```

Properties:

- can lag,
- can drift,
- should be rebuildable,
- should have source reference/version,
- should have reconciliation plan,
- may use lower consistency depending business tolerance.

### 3.4 Cache-Like Table

A derived table with explicit staleness tolerance.

Example:

```text
case_counts_by_status_day
notification_badge_by_user
```

Must not be used for strict enforcement decisions unless correctness is designed.

---

## 4. Authority Matrix

Create this for every domain.

| Table | Type | Rebuildable? | Source |
|---|---|---|---|
| case_events_by_case_version_bucket | source event log | no / critical restore | itself |
| case_current_by_id | authoritative snapshot | yes, from events | events |
| open_cases_by_assignee_day_bucket | derived view | yes | current/events |
| due_cases_by_team_day_bucket | derived view | yes | current/events |
| notifications_by_user_day | derived feed | yes/expire | events/commands |
| command_idempotency_by_id | guard/source | TTL-limited | command |
| case_counts_by_status_day | aggregate derived | yes | events/current |
| case_search_index | external derived | yes | events/current |

If two tables disagree, this matrix tells which one wins.

Without authority matrix, incidents become arguments.

---

## 5. Access Pattern Families

Common multi-access-pattern families:

### 5.1 Lookup Table

```text
by id
by natural key
by external reference
```

### 5.2 Timeline Table

```text
by entity/time
latest events
history
```

### 5.3 Queue/List View

```text
by assignee
by team
by status
by due date
```

### 5.4 Feed/Inbox View

```text
by user/time
read/unread
```

### 5.5 Guard Table

```text
idempotency
reservation
uniqueness
```

### 5.6 Aggregate Table

```text
counts
rollups
summaries
```

### 5.7 Search/Analytics Projection

```text
external search or OLAP
```

Each family has different update and consistency semantics.

---

## 6. Table Duplication Example

Domain entity:

```text
Case
- tenant_id
- case_id
- status
- assignee_id
- team_id
- priority
- due_at
- title
- updated_at
```

Access patterns:

```text
read by case_id
list open by assignee
list due by team
list by status/day
search by reference/text
```

Tables:

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    status text,
    assignee_id uuid,
    team_id uuid,
    priority int,
    due_at timestamp,
    title text,
    updated_at timestamp,
    version bigint,
    PRIMARY KEY ((tenant_id, case_id))
);
```

```sql
CREATE TABLE open_cases_by_assignee_day_bucket (
    tenant_id uuid,
    assignee_id uuid,
    bucket_day date,
    bucket_id int,
    due_at timestamp,
    case_id uuid,
    priority int,
    status text,
    title text,
    source_version bigint,
    PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
);
```

```sql
CREATE TABLE due_cases_by_team_day_bucket (
    tenant_id uuid,
    team_id uuid,
    bucket_day date,
    bucket_id int,
    due_at timestamp,
    case_id uuid,
    assignee_id uuid,
    priority int,
    title text,
    source_version bigint,
    PRIMARY KEY ((tenant_id, team_id, bucket_day, bucket_id), due_at, case_id)
);
```

The same fields appear multiple times.

That is expected.

---

## 7. Data Duplication Granularity

Do not duplicate everything blindly.

Derived table should contain fields needed to serve query/result.

Example queue row:

```text
case_id
due_at
priority
title
status
source_version
```

Maybe not:

```text
full case payload
full audit history
large JSON details
all comments
all attachments
```

Keep derived rows small.

For UI list:

```text
enough fields to render list
link to case detail for full data
```

If field changes frequently, duplicating it widely increases update burden.

---

## 8. Write Fanout

Write fanout means one logical command writes multiple physical tables.

Example command:

```text
Approve case
```

Potential writes:

```text
1. command_idempotency_by_id
2. case_events_by_case_version_bucket
3. case_current_by_id
4. open_cases_by_assignee_day_bucket delete
5. due_cases_by_team_day_bucket delete/update
6. notification_by_user_day insert
7. case_counts_by_status_day update/project
8. search index update
```

Fanout may be:

- synchronous,
- asynchronous,
- hybrid.

Fanout design must specify:

```text
which writes must happen before command success?
which writes can lag?
which writes can be rebuilt?
what happens if one write times out?
```

---

## 9. Synchronous Fanout

Application writes multiple tables in command path before responding.

### 9.1 Pros

- read views fresh immediately,
- simpler mental model for UI,
- fewer moving parts than async projector,
- no projection lag for chosen tables.

### 9.2 Cons

- higher latency,
- more failure points,
- partial success possible,
- no general multi-table transaction,
- timeout ambiguity multiplied,
- retries more complex,
- write spikes larger.

### 9.3 Use When

- view must be immediately fresh,
- fanout small,
- writes idempotent,
- derived inconsistency handled,
- command latency budget allows.

Example:

```text
current state + event append sync
non-critical notifications async
```

---

## 10. Asynchronous Projection

Application writes source event/current state, then async projector updates derived tables.

### 10.1 Pros

- lower command latency,
- clearer source-of-truth,
- derived views rebuildable,
- retries isolated,
- backpressure on projection pipeline,
- easier to add new views later.

### 10.2 Cons

- view lag,
- projector infrastructure,
- ordering/idempotency challenges,
- operational monitoring required,
- users may not immediately see change.

### 10.3 Sources for Projection

- application outbox table,
- Kafka/RabbitMQ stream,
- ScyllaDB CDC,
- command/event log,
- scheduled scanner.

Pick based on throughput, ordering, reliability, operational expertise.

---

## 11. Hybrid Projection

Common production design:

```text
strict source/current writes synchronously
derived user-facing views asynchronously
some critical small views synchronously
analytics/search asynchronously
```

Example case transition:

```text
Synchronous:
- idempotency reserve
- append event
- update current state

Asynchronous:
- open queue
- due queue
- notification feed
- aggregate count
- search index
```

If UI needs queue update instantly, maybe sync that one derived table too.

But document it.

---

## 12. Multi-Table Atomicity Gap

ScyllaDB/Cassandra-compatible systems do not offer general SQL-style transaction across arbitrary tables.

If you write:

```text
table A success
table B timeout
table C success
```

the command state is ambiguous.

Strategies:

1. make one table authoritative,
2. make all steps idempotent,
3. track command progress,
4. reconcile derived tables,
5. expose pending state if needed,
6. avoid business invariants spanning many partitions/tables,
7. use LWT only for bounded conditional needs,
8. use workflow/outbox pattern.

Do not pretend multi-table fanout is atomic.

---

## 13. CQL BATCH Is Not a Magic Transaction

CQL `BATCH` is often misunderstood.

ScyllaDB docs note that batches can save network round trips, updates for a given partition key are atomic, and logged batches ensure mutations eventually complete or none will; but batches are not a general performance tool for many unrelated partitions.

Good use:

```text
small batch
same partition
logically related mutation
```

Dangerous use:

```text
large batch across many partition keys
trying to improve throughput
hiding massive fanout
```

Rule:

```text
Do not use CQL BATCH as JDBC batch replacement.
```

For application-level fanout, explicit idempotent writes + workflow/reconciliation are usually clearer.

---

## 14. Application-Maintained Indexes

A derived table is often an application-maintained index.

Example:

```text
case_current_by_id is source
open_cases_by_assignee_day_bucket is index/view
```

Application maintains:

```text
insert new index row
delete old index row
reconcile if drift
```

This is like maintaining secondary index manually, but with explicit primary key and control.

### 14.1 Why Manual Index?

Benefits:

- exact query shape,
- controlled partition key,
- bucketing,
- custom payload,
- custom consistency,
- custom reconciliation,
- business semantics.

Costs:

- more code,
- partial failure,
- drift,
- backfill.

---

## 15. Derived View Row Design

A derived row should include:

```text
1. view primary key fields
2. display/result fields
3. source identity
4. source version
5. projection timestamp
6. optional projection version
```

Example:

```sql
CREATE TABLE open_cases_by_assignee_day_bucket (
    tenant_id uuid,
    assignee_id uuid,
    bucket_day date,
    bucket_id int,
    due_at timestamp,
    case_id uuid,
    priority int,
    title text,
    status text,
    source_version bigint,
    source_event_id uuid,
    projected_at timestamp,
    projection_version int,
    PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
);
```

Why include `source_version`?

- detect stale row,
- reconcile,
- debug incidents,
- avoid showing row older than current state,
- support idempotent projection.

---

## 16. Derived View Key Determinism

Derived primary key should be deterministic from source state.

Example:

```text
bucket_day = due_at in tenant/business timezone
bucket_id = hash(case_id) % bucket_count
```

If key is random, cleanup/rebuild becomes hard.

Deterministic key enables:

- retry,
- delete old row,
- rebuild,
- reconciliation,
- compare source vs view.

If bucket_count changes, include config version/epoch or store derived key.

---

## 17. Updating Derived Views

State change:

```text
old:
assignee_id = A
due_at = 2026-06-21
status = OPEN

new:
assignee_id = B
due_at = 2026-06-22
status = OPEN
```

Derived update:

```text
DELETE old row from A/day21/bucket
INSERT new row into B/day22/bucket
```

You need old key.

Where to get it?

- current state before update,
- event contains previous state,
- command handler has old state,
- derived key stored in current row,
- reconciliation later.

Best practice:

```text
event includes enough previous/new state to project deterministically
```

---

## 18. Delete Tombstone Cost in Derived Views

Derived updates often delete old rows.

High-churn views can become tombstone-heavy.

Examples:

- queue ordered by due_at where due_at changes frequently,
- status view where status flips often,
- assignment view where cases move between agents,
- read/unread notification status in same feed table.

Mitigations:

1. avoid derived view for high-churn dimension,
2. bucket by time/status to bound tombstones,
3. use validation-on-read instead of deleting immediately,
4. periodic rebuild table,
5. use short-lived buckets,
6. keep current state authoritative and tolerate stale derived rows,
7. use external search/index if update pattern fits better.

---

## 19. Stale Rows and Validation-on-Read

Instead of aggressively deleting every stale derived row, some designs tolerate stale rows and validate against source.

Example queue read:

```text
read candidate cases from open_cases_by_assignee
for each row, optionally check case_current_by_id
filter if status no longer OPEN
```

Pros:

- fewer deletes,
- easier projection,
- eventual cleanup,
- handles drift.

Cons:

- extra reads,
- fanout,
- possible stale UI,
- more application logic.

Use when:

- derived view can contain stale candidates,
- final decision checks source,
- result limit overfetch handles filtering,
- latency budget allows.

This is common for search/queue-like candidate lists.

---

## 20. Overfetch for Stale Filtering

If derived view may contain stale rows, fetch more than display limit.

Example:

```text
display limit = 50
overfetch = 200
validate against current
return first 50 valid
```

If stale ratio grows, query becomes inefficient.

Monitor:

```text
candidate_rows_fetched
valid_rows_returned
stale_rows_filtered
```

If stale ratio high, reconciliation/cleanup needed.

---

## 21. Reconciliation

Reconciliation is process to correct derived views from source.

Types:

### 21.1 Forward Reconciliation

Read source, compute expected derived row, upsert missing/outdated.

### 21.2 Reverse Reconciliation

Read derived view, check source, delete stale rows.

### 21.3 Event Replay

Replay source events to rebuild projections.

### 21.4 Full Rebuild

Create new table, backfill all current/source data, switch reads.

Each has different cost.

---

## 22. Reconciliation Design Requirements

For each derived table:

```text
source table:
source version:
deterministic derived key:
idempotent upsert:
delete stale method:
scan strategy:
progress tracking:
throttle:
metrics:
safety cutoff:
rollback:
```

Example progress table:

```sql
CREATE TABLE projection_rebuild_progress_by_job (
    job_id uuid,
    shard_id int,
    checkpoint text,
    updated_at timestamp,
    status text,
    PRIMARY KEY (job_id, shard_id)
);
```

Progress can be by:

- token range,
- tenant,
- time bucket,
- source event offset,
- page cursor.

---

## 23. Backfill

Backfill is one-time or periodic population of new table.

Use case:

```text
new access pattern: cases by priority
```

Steps:

```text
1. Create new table.
2. Deploy code that writes new table for new changes.
3. Backfill historical/current data.
4. Validate.
5. Switch reads.
6. Monitor.
7. Remove old path if needed.
```

Backfill must be:

- idempotent,
- resumable,
- throttled,
- observable,
- safe under concurrent writes,
- compatible with schema versions.

Never run unbounded backfill as ad-hoc script without throttle/progress.

---

## 24. Dual-Write Migration Pattern

When adding new derived table:

```text
old read path -> old table
new table created
writer dual-writes old + new
backfill new
validate
switch reads to new
stop old writes
drop old table later
```

Risks:

- dual-write partial failure,
- inconsistent old/new,
- backfill race with live writes,
- version mismatch.

Mitigation:

- source version in rows,
- idempotent upserts,
- compare counts/samples,
- replay recent events after backfill,
- feature flags,
- rollback plan.

---

## 25. Idempotent Projection

Projection should be safe to apply multiple times.

Event:

```text
event_id = E123
source_version = 42
```

Derived row key deterministic.

Upsert:

```text
same event -> same derived row
```

If projector retries, no duplicate logical row.

For deletes:

```text
same delete key -> delete again safe
```

But be careful with out-of-order events.

If event version 41 arrives after 42, it should not overwrite projection version 42.

Use:

- source_version checks,
- current-state projection,
- idempotent latest-wins by version,
- event ordering per entity,
- LWT if necessary and low volume.

---

## 26. Ordering in Projection

If projection updates derived view based on event stream, ordering matters.

Example:

```text
event 10: assignee A
event 11: assignee B
```

If processed out of order:

```text
event 11 inserts B row
event 10 later inserts A row
```

Now stale A row exists.

Mitigations:

1. process per entity in order,
2. include source_version and validate,
3. read current state before projecting,
4. tolerate stale row and reconciliation,
5. use LWT conditional on version for projection metadata,
6. event stream partitioned by entity key.

For critical derived views, ordering strategy must be explicit.

---

## 27. Event-Carried State vs Source Lookup

Projection can use event payload or source lookup.

### 27.1 Event-Carried State

Event includes all fields needed:

```text
case_id
new_status
old_status
new_assignee
old_assignee
new_due_at
old_due_at
priority
title
source_version
```

Pros:

- projector does not read source,
- deterministic,
- easier replay.

Cons:

- larger events,
- schema evolution,
- risk event missing field.

### 27.2 Source Lookup

Projector reads `case_current_by_id`.

Pros:

- event smaller,
- projection uses latest state.

Cons:

- extra read,
- possible race,
- projection may skip intermediate states,
- source read consistency matters.

Often good design:

```text
event carries enough old/new key fields for cleanup;
source table carries latest display fields if needed.
```

---

## 28. Materialized Views

ScyllaDB supports materialized views, which automate maintaining separate tables for alternate queries. Documentation describes a materialized view as a set of rows corresponding to base table rows, with updates to base table causing corresponding view updates.

Materialized views can reduce application-side denormalization code.

But they are not magic.

You must understand:

- view primary key,
- base table relationship,
- build/backfill,
- consistency behavior,
- write amplification,
- operational limits,
- failure modes,
- whether view query shape is suitable.

### 28.1 When MV May Help

- simple alternate lookup,
- view derives directly from one base table,
- workload fits MV limitations,
- operational team understands MV behavior,
- lower application complexity is worth server-side maintenance.

### 28.2 When Manual Derived Table Is Better

- custom bucketing,
- complex projection,
- multiple source tables,
- conditional inclusion logic,
- custom cleanup/reconciliation,
- source version fields,
- external side effects,
- non-trivial staleness policy,
- need explicit operational control.

For top-tier engineering, materialized views are a tool, not default.

---

## 29. Secondary Indexes vs Derived Tables

Secondary indexes can help some queries, but they do not replace query-first table design for high-scale access patterns.

Questions before index:

```text
Is indexed column high/low cardinality?
Is query bounded by partition?
What is expected selectivity?
What is write amplification?
What is p99 target?
Can dedicated table do better?
Is this online high-QPS path?
```

For critical high-QPS queries, explicit table often gives better predictability.

Part 017 will go deep into indexes/MV.

For now:

```text
Do not use secondary index as escape hatch for unmodeled access pattern.
```

---

## 30. Fanout Reads

Multi-access-pattern design often introduces fanout reads.

Example:

```text
open cases by assignee day bucket with 8 buckets
```

Read:

```text
query 8 partitions
merge by due_at
```

Fanout read must be:

- bounded,
- parallelism-controlled,
- timeout-aware,
- observable,
- cursor-aware,
- retry-limited.

Java anti-pattern:

```java
for (int b = 0; b < bucketCount; b++) {
    futures.add(repo.queryBucket(...));
}
return allOf(futures);
```

without limit and deadline.

Better:

```text
max bucket count
max concurrency
overall deadline
overfetch limit
partial failure policy
metrics
```

---

## 31. Fanout Writes

Fanout writes are writes to multiple tables.

Rules:

```text
1. Every write must be idempotent or have clear retry protocol.
2. Derived writes must include source version.
3. Partial failure must be detectable.
4. Reconciliation must exist.
5. Fanout size must be bounded.
6. Non-critical fanout should be async.
7. Avoid giant CQL batches across partitions.
```

Track:

```text
writes_per_command
fanout_latency
partial_failure_count
projection_lag
reconciliation_repairs
```

---

## 32. Command State Machine

For complex commands, model progress.

Table:

```sql
CREATE TABLE command_execution_by_id (
    tenant_id uuid,
    command_id uuid,
    entity_id uuid,
    command_type text,
    status text,
    current_step text,
    created_at timestamp,
    updated_at timestamp,
    error_code text,
    result_ref text,
    PRIMARY KEY ((tenant_id, command_id))
) WITH default_time_to_live = 604800;
```

States:

```text
RECEIVED
RESERVED
SOURCE_WRITTEN
CURRENT_UPDATED
PROJECTION_QUEUED
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
```

This helps handle:

- timeout,
- retry,
- partial fanout,
- user-visible pending state,
- operator debugging.

Do not overuse for simple commands, but for high-correctness workflows it is valuable.

---

## 33. Outbox Pattern

Outbox pattern:

```text
write source state
write outbox event
projector reads outbox and updates derived/external systems
```

In SQL, outbox can be transactional with source row. In ScyllaDB, cross-table atomicity still needs careful design.

Possible ScyllaDB outbox table:

```sql
CREATE TABLE outbox_events_by_tenant_day (
    tenant_id uuid,
    bucket_day date,
    bucket_id int,
    event_time timestamp,
    event_id uuid,
    aggregate_id uuid,
    event_type text,
    payload text,
    status text,
    PRIMARY KEY ((tenant_id, bucket_day, bucket_id), event_time, event_id)
);
```

But processing queues from ScyllaDB tables can create tombstones/polling problems.

Often better:

- publish to Kafka/RabbitMQ after source write,
- use CDC if available and appropriate,
- use event log as source and projector with checkpoints,
- use robust retry/reconciliation.

---

## 34. CDC as Projection Source

Change Data Capture can be useful for projections/integrations.

Potential uses:

- update search index,
- feed analytics pipeline,
- project derived tables,
- audit integration.

Questions:

```text
Is CDC enabled for table?
What is ordering guarantee?
What is retention?
How are retries handled?
How are duplicates handled?
How is lag monitored?
What happens during schema change?
```

CDC is not a replacement for data modeling; it is a propagation mechanism.

---

## 35. Projection Lag

Derived views may lag.

Measure:

```text
source_event_time -> projected_at
source_version_current - source_version_projected
outbox/checkpoint lag
queue depth
oldest unprocessed event age
```

Expose lag to:

- metrics,
- dashboards,
- SLOs,
- maybe API if user needs freshness.

Example:

```text
Assignee queue may lag up to 5 seconds.
Search may lag up to 60 seconds.
Dashboard counts may lag up to 5 minutes.
```

Document these as product semantics.

---

## 36. Read-Your-Write with Derived Views

User submits command then expects queue/list updated.

Options:

### 36.1 Synchronous Derived Write

Return after derived table updated.

### 36.2 Read from Source After Command

Case detail page reads current state, not queue.

### 36.3 Client-Side Optimistic Update

UI updates local view temporarily.

### 36.4 Command Result Contains New State

API response includes updated case.

### 36.5 Poll Until Projection Catches Up

Use source_version/projection_version.

### 36.6 Stronger Projection Path for Specific Views

Critical view sync, others async.

Do not promise read-your-write on async derived table unless designed.

---

## 37. Consistency Levels for Derived Tables

Different tables can use different CL.

Example:

```text
source event write: LOCAL_QUORUM
current state read/write: LOCAL_QUORUM
derived queue write: LOCAL_ONE or LOCAL_QUORUM
derived queue read: LOCAL_ONE
```

If derived table is rebuildable and stale acceptable, lower CL may be okay.

But if derived table drives operational assignment decisions, maybe stronger CL/read validation needed.

CL is per operation and per semantic authority.

---

## 38. Partial Failure Scenarios

### Scenario A

```text
event append succeeds
current update fails
```

Possible outcome:

- event log says state changed,
- current state old.

Mitigation:

- command handler order,
- LWT/transactional pattern per aggregate,
- event as source and projector updates current,
- reconciliation from event log.

### Scenario B

```text
current update succeeds
event append timeout
```

Possible outcome:

- current state advanced,
- audit event maybe missing or unknown.

For audit-critical systems, this is dangerous.

Maybe append event first then update current, or use event as command source.

### Scenario C

```text
derived queue insert succeeds
old derived queue delete fails
```

Possible outcome:

- case appears in two assignee queues.

Mitigation:

- validation-on-read,
- reconciliation,
- idempotent delete retry,
- source_version row.

### Scenario D

```text
notification insert fails
```

Maybe acceptable if notification is derived and can be replayed.

---

## 39. Choosing Source Write Order

There is no universal answer.

For event-sourced design:

```text
1. reserve command
2. append event
3. project current and views
```

For current-state authoritative design:

```text
1. reserve command
2. conditional update current
3. append audit event
4. project views
```

Audit-critical systems often want event and current strongly tied.

If ScyllaDB cannot provide desired atomicity alone, use:

- single partition design if possible,
- LWT carefully,
- command state machine,
- external workflow,
- reconciliation,
- or consider relational DB for that invariant.

Top engineer chooses architecture based on invariant, not fashion.

---

## 40. One Partition Multi-Row Atomicity

CQL batches for same partition can provide atomicity within a partition according to documented semantics.

This can be useful if multiple rows in one partition must be updated together.

Example:

```text
case_id partition contains current marker row + event row
```

But mixing current state and event rows in one wide partition can have modeling trade-offs.

Be careful:

- partition can grow large,
- query shapes differ,
- LWT/conditional constraints may still be needed,
- multi-partition views still not atomic.

---

## 41. Derived Table Versioning

Projection schema evolves.

Add column:

```text
risk_score
```

Old rows lack it.

Options:

- tolerate null,
- backfill,
- projection_version column,
- new table version,
- dual-write.

Example:

```sql
projection_version int
```

Reader:

```text
if projection_version < 2, fetch source or ignore risk_score
```

Schema evolution is easier when derived tables are rebuildable.

---

## 42. Table Versioning Strategy

Sometimes create new table:

```text
open_cases_by_assignee_day_bucket_v2
```

Why:

- primary key changes,
- bucket strategy changes,
- clustering order changes,
- payload shape changes drastically,
- need backfill and cutover.

Avoid changing table semantics invisibly.

Versioned table migration:

```text
create v2
dual-write
backfill
validate
switch reads
decommission v1
```

---

## 43. Rebuild from Event Log vs Current Snapshot

Derived views can rebuild from:

### 43.1 Event Log

Pros:

- full history,
- auditable,
- can reconstruct temporal state,
- can rebuild aggregates over time.

Cons:

- replay expensive,
- event schema evolution,
- must handle ordering.

### 43.2 Current Snapshot

Pros:

- faster for current views,
- simpler,
- one row per entity.

Cons:

- cannot reconstruct history,
- if current corrupted, derived rebuild inherits corruption,
- source of truth ambiguity.

For current queues, current snapshot may be enough.

For audit/analytics, event log better.

---

## 44. External Projections

Not every derived view should be in ScyllaDB.

### Search

Use OpenSearch/Elasticsearch/etc for:

- text search,
- many filters,
- relevance ranking,
- partial matching.

### OLAP

Use ClickHouse/warehouse for:

- aggregation,
- reporting,
- large scans,
- dashboards over millions/billions rows.

### Stream Processing

Use Kafka/Flink/etc for:

- real-time aggregates,
- enrichment,
- routing,
- cross-system projection.

ScyllaDB remains OLTP serving store for partitioned access.

---

## 45. Data Contract Between Systems

When projecting from ScyllaDB to search/OLAP, define contract:

```text
event schema
source table
primary key
source version
delete semantics
retry/idempotency
ordering
backfill
replay
schema evolution
lag SLO
dead letter handling
```

Without contract, external index divergence becomes silent.

---

## 46. Duplicate Table Payload Strategy

Decide what to duplicate.

### Minimal Row

```text
case_id
sort keys
status
title
source_version
```

Pros:

- small,
- fast,
- less update amplification.

Cons:

- detail page needs source lookup.

### Rich Row

```text
case_id
title
summary
assignee
priority
sla
tags
display fields
```

Pros:

- list page one read.

Cons:

- more duplicate updates,
- stale field risk,
- larger storage/network.

Rule:

```text
Duplicate enough to serve the access pattern, not the entire entity by habit.
```

---

## 47. Handling Field Updates

If `title` changes and title is duplicated into 5 derived tables, update fanout grows.

Options:

1. Update all derived tables synchronously.
2. Update via async projection.
3. Do not duplicate title; fetch from current table.
4. Accept stale title in list until reconciliation.
5. Store immutable display snapshot.
6. Use version field and lazy refresh.

Choose per UX/correctness.

---

## 48. Derived Rows and Authorization

Multi-tenant/security-sensitive views must include tenant scope.

Bad:

```sql
PRIMARY KEY ((assignee_id, bucket_day), due_at, case_id)
```

If assignee_id not globally unique or access control tenant-scoped, use:

```sql
PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
```

Also ensure Java repository requires tenant from authenticated context.

Derived table should not become authorization bypass.

---

## 49. Derived Views and Privacy Deletion

If user invokes deletion/privacy request, duplicate data must be removed or anonymized from all derived tables/external projections.

Need data inventory:

```text
Which tables contain user email/name/IP?
Which derived views duplicate title/payload?
Which external indexes contain PII?
What is delete/anonymize workflow?
```

Source-of-truth deletion is insufficient if derived copies remain.

This is compliance-critical.

---

## 50. Idempotency Across Fanout

Each fanout write should have stable key.

Examples:

```text
case event row key = tenant_id + case_id + version_bucket + event_version + event_id
queue row key = tenant_id + assignee_id + bucket_day + bucket_id + due_at + case_id
notification row key = tenant_id + user_id + bucket_day + notification_time + notification_id
```

If retry same command creates new notification_id, duplicate notification.

Use command-derived IDs where appropriate:

```text
notification_id = UUIDv5(command_id + recipient_id + notification_type)
```

or store mapping.

---

## 51. Fanout Retry Strategy

Classify writes:

| Write Type | Retry Safe? | Requirement |
|---|---|---|
| deterministic upsert | yes | same primary key |
| deterministic delete | yes | old key known |
| LWT insert-if-absent | careful | handle unknown outcome |
| counter increment | unsafe | avoid or dedupe |
| random append | unsafe | stable event ID needed |
| external side effect | unsafe | idempotency key |

Implement retry policies per write type.

Do not globally retry all timeouts.

---

## 52. Projection Checkpoints

Projector needs checkpoint.

Examples:

- Kafka offset,
- event_version per aggregate,
- token range + paging state,
- outbox event time/id,
- CDC stream position.

Checkpoint table:

```sql
CREATE TABLE projection_checkpoint_by_name (
    projection_name text,
    partition_id text,
    checkpoint_value text,
    updated_at timestamp,
    lag_millis bigint,
    PRIMARY KEY (projection_name, partition_id)
);
```

Checkpoint updates should be idempotent and reflect processed source.

If checkpoint advances before derived write succeeds, data loss.

If checkpoint advances after, duplicate processing possible but okay if idempotent.

Prefer at-least-once + idempotent projection.

---

## 53. At-Least-Once Projection

Most projection systems are at-least-once.

Meaning:

```text
same source event may be processed more than once
```

Therefore projection must be idempotent.

Exactly-once across database and external systems is usually not practical without heavy protocol.

Design for:

```text
duplicates happen
events can be retried
projection can crash after write before checkpoint
```

Stable keys and source_version solve many issues.

---

## 54. Dead Letter Queue

Projection may fail due to:

- bad payload,
- schema mismatch,
- missing source,
- invalid transition,
- poison event,
- downstream unavailable.

Use DLQ or failed-event table:

```sql
CREATE TABLE projection_failures_by_day (
    projection_name text,
    bucket_day date,
    failed_at timestamp,
    event_id uuid,
    source_ref text,
    error_code text,
    error_message text,
    payload text,
    PRIMARY KEY ((projection_name, bucket_day), failed_at, event_id)
);
```

Do not let one poison event block all projection forever without visibility.

---

## 55. Monitoring Derived Views

Metrics:

```text
projection_lag_seconds
projection_events_processed
projection_failures
projection_retries
dead_letter_count
derived_rows_written
derived_rows_deleted
stale_rows_filtered
reconciliation_repairs
backfill_progress
fanout_write_count
fanout_latency
partial_failure_count
```

Per table:

```text
read/write latency
tombstone warnings
partition size
hot keys
compaction backlog
```

Derived view health is application-level and database-level.

---

## 56. Testing Multi-Table Designs

Test scenarios:

```text
1. duplicate command retry
2. write timeout after source write
3. derived write fails
4. projector processes event twice
5. projector processes events out of order
6. old derived delete missing
7. backfill interrupted and resumed
8. schema version mixed
9. stale derived row read
10. reconciliation fixes drift
11. bucket_count changes
12. external search lag
```

Unit tests alone are not enough.

Use integration/failure tests.

---

## 57. Java Service Structure

Good structure:

```text
CommandHandler
  -> IdempotencyService
  -> DomainTransitionValidator
  -> SourceRepository
  -> CurrentStateRepository
  -> ProjectionPublisher
  -> DerivedViewWriter/Projector
```

Avoid:

```text
Controller directly writes 5 repositories randomly.
```

Centralize workflow semantics.

Example:

```java
public CompletionStage<CommandResult> submitForReview(SubmitCommand cmd) {
    return idempotency.reserve(cmd)
        .thenCompose(reserved -> transitionService.apply(cmd))
        .thenCompose(result -> projectionPublisher.publish(result.event()))
        .thenCompose(ignored -> idempotency.complete(cmd, result));
}
```

Actual implementation must handle timeouts and unknown outcomes carefully.

---

## 58. Repository Naming

Names should encode authority.

Good:

```java
CaseEventStore
CaseCurrentRepository
OpenCaseAssigneeViewRepository
DueCaseTeamViewRepository
CommandIdempotencyRepository
NotificationFeedViewRepository
```

Bad:

```java
CaseRepository
CaseIndexRepository
DataRepository
GenericScyllaRepository
```

For derived table methods:

```java
upsertProjectedOpenCase(...)
deleteProjectedOpenCase(...)
findCandidatesByAssigneeDayBucket(...)
```

Language matters. It prevents misuse.

---

## 59. API Semantics for Derived Data

API should state staleness if relevant.

Example:

```json
{
  "items": [...],
  "viewAsOf": "2026-06-21T10:15:00Z",
  "projectionLagMs": 1200
}
```

Or documentation:

```text
Assignee queue is eventually consistent and may lag by up to a few seconds.
Case detail current state is authoritative.
Search results may lag up to one minute.
Dashboard counts are approximate.
```

Do not silently use stale derived data for strict decisions.

---

## 60. Decision Framework

When a new access pattern appears:

```text
1. Is it high-QPS/latency-sensitive?
2. Is query shape bounded and known?
3. Can primary key serve it?
4. Is data source authoritative or derived?
5. Does it require duplicate table?
6. Can duplicate row be updated idempotently?
7. What happens on partial failure?
8. Can it be rebuilt?
9. Is staleness acceptable?
10. Is search/OLAP better?
```

Only create a new ScyllaDB table if answers justify it.

---

## 61. Common Misconceptions

### Misconception 1: “Denormalization is bad.”

In ScyllaDB, denormalization is normal. Unplanned denormalization is bad.

### Misconception 2: “Duplicate tables are automatically inconsistent.”

They can drift, but with source/version/idempotency/reconciliation they are manageable.

### Misconception 3: “BATCH makes multi-table writes safe like SQL transaction.”

No. Use batches only with correct semantics and small scope.

### Misconception 4: “Materialized views remove all projection complexity.”

They automate some maintenance but still have cost/limits/failure modes.

### Misconception 5: “Derived views can be fixed manually later.”

Without deterministic keys/source versions/rebuild plan, later is painful.

### Misconception 6: “Async projection is eventually consistent, so no correctness needed.”

Eventual consistency still needs idempotency, ordering, lag monitoring, and reconciliation.

### Misconception 7: “Search index can be source of truth.”

Usually no. Search is derived. Source remains database/event log.

---

## 62. Mental Model Compression

Remember:

```text
ScyllaDB tables are physical answers to queries.
Multiple questions often require multiple tables.
Multiple tables require explicit authority, propagation, and repair.
```

Design loop:

```text
source of truth
  -> events/current state
  -> derived views
  -> external projections
  -> reconciliation/backfill
```

The hard part is not creating duplicate tables.

The hard part is maintaining them safely under failure.

---

## 63. Summary

Multi-access-pattern design is the practical core of ScyllaDB application architecture.

Key lessons:

1. Duplicate tables are normal in query-first modeling.
2. Duplication trades read performance for write/storage/consistency cost.
3. Every table must be classified as source, snapshot, derived, cache-like, or external projection.
4. Derived rows should include source identity/version/projection metadata.
5. Derived primary keys must be deterministic.
6. Fanout writes can be synchronous, async, or hybrid.
7. ScyllaDB does not provide general multi-table SQL transactions.
8. CQL BATCH is not a general performance or transaction substitute.
9. Application-maintained indexes give control but require reconciliation.
10. Materialized views are useful but not magic.
11. Derived table updates require old key values.
12. High-churn derived views can create tombstone problems.
13. Stale rows can be tolerated only with validation/reconciliation.
14. Backfill and dual-write migration must be idempotent and resumable.
15. Projection systems are usually at-least-once; design idempotently.
16. Projection lag is a product and operational metric.
17. Java repository names should encode authority and access pattern.
18. API semantics must distinguish authoritative and eventual data.
19. Search/OLAP projections should not become source of truth.
20. Failure-mode testing is mandatory.

---

## 64. Review Questions

1. Mengapa duplicate tables normal di ScyllaDB?
2. Apa biaya dari denormalization?
3. Apa beda source-of-truth dan derived view?
4. Kenapa authority matrix penting?
5. Apa itu write fanout?
6. Kapan fanout sebaiknya synchronous?
7. Kapan projection sebaiknya asynchronous?
8. Kenapa multi-table writes tidak boleh dianggap atomic?
9. Apa batasan mental model CQL BATCH?
10. Apa itu application-maintained index?
11. Mengapa derived row perlu source_version?
12. Kenapa derived primary key harus deterministic?
13. Apa yang terjadi jika old derived key tidak diketahui?
14. Bagaimana stale rows bisa ditangani?
15. Apa itu reconciliation?
16. Apa langkah dual-write migration?
17. Kapan materialized view cocok?
18. Kenapa projection harus idempotent?
19. Apa itu projection lag?
20. Bagaimana Java repository naming membantu correctness?

---

## 65. Practical Exercise

Gunakan domain regulatory case management.

Requirement:

```text
- read current case by id
- append audit event
- list open cases by assignee
- list due cases by team
- notify reviewer
- dashboard count by status
- search by reference/text
```

Buat desain:

```text
1. Authority matrix.
2. Table list.
3. Source tables.
4. Derived tables.
5. External projections.
6. Write fanout per command: submit, assign, approve, close.
7. Which writes are synchronous?
8. Which writes are async?
9. Derived row key for each view.
10. Source_version strategy.
11. Old-key cleanup strategy.
12. Stale-row validation strategy.
13. Reconciliation job design.
14. Backfill plan for new table.
15. Java repository interfaces.
16. API staleness semantics.
17. Projection lag metrics.
18. Failure tests.
19. Tombstone risk analysis.
20. Red flags and unresolved trade-offs.
```

---

## 66. Preview Part 013

Part berikutnya membahas consistency levels secara mendalam:

```text
ONE
QUORUM
LOCAL_QUORUM
ALL
ANY
SERIAL / LOCAL_SERIAL
read/write CL combinations
RF math
multi-DC implications
read-your-write
stale reads
availability trade-offs
Java driver configuration
```

Part 012 membahas banyak table dan derived views.

Part 013 akan menjelaskan bagaimana memilih consistency level untuk tiap operasi dan table berdasarkan authority/freshness/correctness.

---

# End of Part 012

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Time-Series Modeling di ScyllaDB</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-013.md">Part 013 — Consistency Levels: ONE, QUORUM, LOCAL_QUORUM, ALL, SERIAL, dan Trade-off Praktis ➡️</a>
</div>

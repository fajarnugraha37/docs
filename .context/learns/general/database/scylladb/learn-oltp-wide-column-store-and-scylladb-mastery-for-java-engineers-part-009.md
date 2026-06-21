# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-009.md

# Part 009 — Query-First Data Modeling: Dari User Journey ke Table Design

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `009`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: membangun metodologi desain data model ScyllaDB dari user journey, access pattern, cardinality, heat, correctness, retention, dan failure mode menuju CQL table design dan Java repository contract.

---

## 0. Posisi Part Ini dalam Seri

Part 008 membahas primary key design secara detail:

```text
partition key
clustering key
query validity
hot partition
large partition
bucketing
pagination
derived table cleanup
```

Sekarang kita masuk ke proses desain end-to-end.

Pertanyaan utama part ini:

> Bagaimana kita mengambil requirement aplikasi nyata, lalu menurunkannya menjadi table ScyllaDB yang benar?

Dalam SQL relational modeling, proses desain sering dimulai dari:

```text
entities -> relationships -> normalization -> indexes -> queries
```

Dalam ScyllaDB/wide-column store, proses desain harus dimulai dari:

```text
user journey -> access patterns -> query shapes -> primary keys -> table design -> operational model
```

Ini disebut query-first data modeling.

Kalimat penting:

```text
In ScyllaDB, table design follows query design.
```

Bukan:

```text
create entity table first, then query anything later.
```

---

## 1. Kenapa Query-First?

ScyllaDB tidak punya general-purpose relational optimizer yang bisa mengubah arbitrary query menjadi plan efisien melalui join/index kompleks seperti RDBMS.

ScyllaDB mengandalkan desain yang eksplisit:

```text
known query
known partition key
known clustering order
known result bound
known consistency
known failure behavior
```

Query-first modeling memberi manfaat:

- latency lebih predictable,
- p99 lebih mudah dijaga,
- partition size bisa dihitung,
- hot key risk bisa diprediksi,
- denormalization menjadi sadar biaya,
- Java repository lebih eksplisit,
- failure mode lebih mudah dimodelkan,
- migration/backfill lebih terarah,
- observability bisa ditentukan sejak awal.

Tanpa query-first, tim biasanya jatuh ke anti-pattern:

```text
one table per entity
generic CRUD repository
ALLOW FILTERING
unbounded scan
secondary index by hope
large partition
unsafe retries
unclear source of truth
```

---

## 2. Query-First Bukan “Membuat Table untuk Setiap Endpoint Secara Buta”

Query-first sering disalahpahami sebagai:

```text
setiap endpoint = satu table
```

Lebih tepat:

```text
setiap access pattern penting membutuhkan physical access path yang jelas.
```

Satu table bisa melayani beberapa query jika query shape kompatibel.

Contoh table:

```sql
CREATE TABLE case_events_by_case_month (
    case_id uuid,
    bucket_month text,
    event_version bigint,
    event_id uuid,
    event_time timestamp,
    event_type text,
    payload text,
    PRIMARY KEY ((case_id, bucket_month), event_version, event_id)
) WITH CLUSTERING ORDER BY (event_version DESC, event_id ASC);
```

Bisa melayani:

```text
read latest events by case/month
read event range by version
append event idempotently
```

Tapi tidak cocok untuk:

```text
find all events by actor
find all APPROVED events globally
search payload text
aggregate events per month
```

Untuk access pattern berbeda, perlu table lain, search system, OLAP system, atau stream projection.

---

## 3. Overall Workflow

Gunakan workflow berikut:

```text
1. Capture user journeys.
2. Extract access patterns.
3. Classify source-of-truth vs derived views.
4. Define correctness invariants.
5. Define freshness requirements.
6. Define cardinality and heat.
7. Define retention and delete behavior.
8. Define query shapes.
9. Design primary keys.
10. Estimate partition size and QPS.
11. Decide bucketing.
12. Decide consistency levels.
13. Decide write propagation strategy.
14. Define Java repository contract.
15. Define reconciliation/backfill.
16. Define observability.
17. Review failure modes.
```

Ini bukan waterfall rigid. Biasanya iteratif.

Tetapi jangan langsung mulai dari:

```sql
CREATE TABLE ...
```

Mulai dari access pattern dan constraints.

---

## 4. Running Case Study: Regulatory Case Management

Kita akan memakai domain contoh:

```text
Regulatory enforcement lifecycle platform
```

Core concepts:

- case,
- case event,
- current case state,
- assignee/reviewer,
- due date/SLA,
- command/idempotency,
- audit trail,
- derived work queues,
- notification feed,
- tenant/regulator organization.

Important business characteristics:

- auditability penting,
- state transition harus defensible,
- duplicate command harus dicegah,
- some queries are operational and latency-sensitive,
- some queries are reporting/analytics and should not be served by ScyllaDB OLTP tables,
- data retention/legal hold matters,
- derived tables can lag if not authoritative,
- Java services must handle timeout ambiguity.

---

## 5. Step 1 — Capture User Journeys

Mulai dari aktivitas nyata, bukan entity list.

Example journeys:

```text
J1. Officer opens a case detail page.
J2. Officer submits a case for review.
J3. Reviewer approves or rejects case.
J4. Supervisor opens queue of open cases assigned to team.
J5. System appends audit event for every lifecycle transition.
J6. User sees latest notifications.
J7. Background worker retries command after timeout.
J8. Compliance auditor exports complete case history.
J9. Dashboard shows count of cases by status.
J10. Search page finds cases by text, party name, or reference.
```

ScyllaDB may fit some, not all.

Classification:

| Journey | ScyllaDB Fit? | Reason |
|---|---|---|
| Case detail current state | Good | lookup by case_id |
| Append audit event | Good | partitioned append |
| Latest case events | Good | bounded partition/range |
| Assigned open queue | Good if modeled | derived table by assignee/bucket |
| Notification feed | Good if bucketed | user/time access |
| Command idempotency | Good | key lookup/LWT |
| Complete case export | Maybe batch path | not interactive unbounded |
| Dashboard counts | Maybe derived aggregate | not ad-hoc scan |
| Full-text search | Poor | use search system |
| Analytics/reporting | Poor | use OLAP/ClickHouse |

Top engineer separates:

```text
OLTP serving path
batch/export path
search path
analytics path
```

---

## 6. Step 2 — Extract Access Patterns

Access pattern is not vague like:

```text
manage cases
```

It must be concrete:

```text
read current case by case_id
append event by case_id
read latest 100 events by case_id
list open cases for assignee due today
deduplicate command_id
```

### 6.1 Access Pattern Template

For each access pattern, capture:

```text
Name:
Actor:
Trigger:
Inputs:
Filter:
Sort:
Limit:
Pagination:
Frequency:
Freshness:
Correctness:
Source/Derived:
Expected rows:
Expected bytes:
Expected hot keys:
Retention:
Failure behavior:
```

Example:

```text
Name: Read current case
Actor: Officer UI / internal service
Inputs: tenant_id, case_id
Filter: exact case_id
Sort: none
Limit: 1
Frequency: high
Freshness: strong-ish/read-your-write desired
Correctness: must not show regressed state
Source/Derived: current snapshot, authoritative enough for UI
Expected rows: 1
Hot keys: high-profile case may be hot
Retention: case lifetime
Failure: fail endpoint or degrade partial page
```

---

## 7. Access Pattern Matrix

Create a matrix before schema.

| ID | Access Pattern | Inputs | Sort | Limit | Frequency | Freshness | Authority |
|---|---|---|---|---:|---|---|---|
| AP1 | Read current case | tenant_id, case_id | none | 1 | high | strong-ish | authoritative snapshot |
| AP2 | Append case event | tenant_id, case_id, event_id | n/a | write | high | durable | source of truth |
| AP3 | Read latest case events | tenant_id, case_id | newest first | 100 | high | strong-ish | source |
| AP4 | Read events by date range | tenant_id, case_id, month/range | time | page | medium | eventual ok | source |
| AP5 | List open cases by assignee | tenant_id, assignee_id, day/bucket | due_at | 50 | high | eventual acceptable? | derived |
| AP6 | List due cases by team/day | tenant_id, team_id, day/bucket | due_at | 100 | medium | eventual acceptable? | derived |
| AP7 | Deduplicate command | command_id | none | 1 | high | strict | guard/source |
| AP8 | Notification feed | user_id, day | created_at desc | 50 | high | eventual ok | derived |
| AP9 | Dashboard counts by status | tenant_id, status | n/a | few | medium | eventual ok | aggregate |
| AP10 | Full-text search cases | text terms | relevance | page | medium | eventual ok | external search |

This table immediately tells us:

```text
AP10 should not become ALLOW FILTERING over case_current_by_id.
```

---

## 8. Step 3 — Authority Classification

Not all tables are equal.

Classify:

| Data/Table | Authority | Rebuildable? | Notes |
|---|---|---|---|
| case_events_by_case_month | source of truth | no/critical backup | immutable audit/event source |
| case_current_by_id | authoritative snapshot | maybe from events | used by UI/commands |
| open_cases_by_assignee_day_bucket | derived serving view | yes | may lag/reconcile |
| due_cases_by_team_day_bucket | derived serving view | yes | queue/list |
| command_idempotency_by_id | guard/source | maybe TTL | strict duplicate control |
| notifications_by_user_day | derived/feed | yes/expire | eventual |
| case_counts_by_status | aggregate derived | yes | dashboard |
| search index | external derived | yes | not ScyllaDB source |

Authority determines:

- consistency level,
- write path,
- retry behavior,
- backup priority,
- alert severity,
- reconciliation strategy,
- whether stale data is acceptable.

---

## 9. Step 4 — Correctness Invariants

Before table design, define invariants.

Example invariants:

```text
I1. A command must not be applied twice.
I2. A case lifecycle transition must follow allowed state machine.
I3. A terminal case cannot return to active state without explicit reopen command.
I4. Every state transition must have an audit event.
I5. Current state version must be monotonic per case.
I6. Derived queues may lag but must eventually converge.
I7. Audit event must be immutable once committed.
I8. Regulatory retention may prevent TTL/delete on source audit events.
```

These invariants drive design.

For example:

```text
I1 -> command idempotency table, maybe LWT
I2/I5 -> LWT or command serialization or expected version
I4/I7 -> append-only event table with durable writes
I6 -> reconciliation job
I8 -> no TTL on authoritative event table
```

Do not start from “what columns do we need?” Start from invariants.

---

## 10. Step 5 — Freshness Requirements

Freshness is not binary.

Classify each access pattern.

| Pattern | Freshness Need | Possible Design |
|---|---|---|
| command dedupe | strict | LWT/CAS |
| current case after update | read-your-write | LOCAL_QUORUM, versioning |
| audit event append | durable | LOCAL_QUORUM |
| assignee queue | seconds lag acceptable? | derived async/sync write |
| notification feed | eventual | derived |
| dashboard count | eventual | aggregate projection |
| search | eventual | search index |
| export | consistent enough snapshot/batch | batch path |

Do not overpay for consistency where eventual is correct.

Do not underpay where legal/business correctness requires stronger behavior.

---

## 11. Step 6 — Cardinality Matrix

Cardinality tells whether partition key spreads.

Example dimensions:

| Dimension | Cardinality | Skew Risk | Notes |
|---|---:|---|---|
| tenant_id | 100–10,000 | high | large tenants dominate |
| case_id | millions | medium | some high-profile hot cases |
| assignee_id | thousands | high | team queues can be huge |
| team_id | hundreds | high | low cardinality |
| status | 5–20 | very high | low cardinality, never alone |
| bucket_day | 365/year | medium | date-only is hot |
| bucket_id | configurable | controlled | hash distribution |
| command_id | huge | low | good lookup key |
| user_id | millions | medium | celebrity/admin hot users |

Rule:

```text
Low cardinality dimensions should not be partition key alone for high-volume tables.
```

---

## 12. Step 7 — Heat Matrix

Cardinality is number of possible keys. Heat is traffic distribution.

Example:

| Key Type | Average QPS | Hottest QPS | Risk |
|---|---:|---:|---|
| case_id normal | 0.01 | 10 | low |
| case_id high-profile | 1 | 5,000 | high |
| tenant_id small | 10 | 100 | low |
| tenant_id large | 1,000 | 80,000 | extreme |
| assignee_id individual | 1 | 500 | medium |
| assignee_id team queue | 100 | 20,000 | high |
| status OPEN | 10,000 | 100,000 | extreme |
| command_id | 1 | 2 | low |

Heat matrix prevents false safety.

A key can be high-cardinality globally but still hot locally.

Example:

```text
case_id cardinality is high,
but one case can become hot during major enforcement action.
```

Mitigation may be:

- cache current state,
- throttle per case,
- event bucketing,
- command serialization,
- derived read model,
- special handling for high-profile cases.

---

## 13. Step 8 — Retention and Delete Matrix

Retention affects TTL/tombstones/compaction.

| Data | Retention | Delete Behavior | TTL? | Notes |
|---|---|---|---|---|
| audit case events | years/legal hold | rarely delete | no | source of truth |
| current case | case lifetime + archive | update/delete maybe | no | snapshot |
| idempotency key | 24h–30d | expire | yes | TTL suitable |
| notification feed | 30–90d | expire/read | yes maybe | bucket/TTL |
| derived open queue | until closed/reassigned | delete old row | no/short? | tombstone risk |
| dashboard counts | recomputable | overwrite | maybe | derived |
| sessions | minutes/hours | expire | yes | TTL suitable |

Do not put short TTL and permanent audit rows in same table casually.

---

## 14. Step 9 — Query Shape Design

For each access pattern, design physical query shape.

### AP1 — Read Current Case

Query:

```sql
SELECT status, version, assignee_id, priority, updated_at
FROM case_current_by_id
WHERE tenant_id = ?
  AND case_id = ?;
```

Potential table:

```sql
PRIMARY KEY ((tenant_id, case_id))
```

Could also use:

```sql
PRIMARY KEY (case_id)
```

if case_id globally unique and tenant check is regular column.

But for multi-tenant safety, including tenant_id in partition key helps ensure all access is tenant-scoped.

Caution:

```text
composite partition key (tenant_id, case_id) still high cardinality because case_id included.
```

---

### AP2/AP3 — Append/Read Case Events

Potential table:

```sql
PRIMARY KEY ((tenant_id, case_id, bucket_month), event_version, event_id)
```

Clustering order:

```text
event_version DESC
```

But if writes need spread for huge cases:

```sql
PRIMARY KEY ((tenant_id, case_id, bucket_month, bucket_id), event_version, event_id)
```

Trade-off:

- no bucket: simpler reads, possible hot/large partition,
- bucket: better distribution, harder latest reads.

---

### AP5 — Open Cases by Assignee

Potential table:

```sql
PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
```

Why:

- tenant scoped,
- assignee scoped,
- day scoped,
- bucket controls hot queue,
- due_at sorted,
- case_id tie-breaker.

Read:

```text
query today’s bucket(s)
merge by due_at
limit 50
```

---

### AP7 — Command Idempotency

Potential table:

```sql
PRIMARY KEY ((tenant_id, command_id))
```

If command_id globally unique:

```sql
PRIMARY KEY (command_id)
```

But tenant_id can support tenancy/security and avoid accidental cross-tenant command collision.

Use:

```sql
INSERT ... IF NOT EXISTS
```

if strict.

---

## 15. Step 10 — Primary Key Drafts

### 15.1 Current Case

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    status text,
    version bigint,
    assignee_id uuid,
    team_id uuid,
    priority int,
    due_at timestamp,
    updated_at timestamp,
    last_event_id uuid,
    title text,
    PRIMARY KEY ((tenant_id, case_id))
);
```

Query:

```sql
SELECT status, version, assignee_id, team_id, priority, due_at, updated_at, title
FROM case_current_by_id
WHERE tenant_id = ?
  AND case_id = ?;
```

Properties:

```text
single partition
one row
tenant-scoped
high cardinality
```

---

### 15.2 Case Events

```sql
CREATE TABLE case_events_by_case_month (
    tenant_id uuid,
    case_id uuid,
    bucket_month text,
    event_version bigint,
    event_id uuid,
    event_time timestamp,
    event_type text,
    actor_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, bucket_month), event_version, event_id)
) WITH CLUSTERING ORDER BY (event_version DESC, event_id ASC);
```

Properties:

```text
partition bounded by case/month
latest reads by version desc
event_id tie-breaker
```

If huge/hot cases require spread:

```sql
CREATE TABLE case_events_by_case_month_bucket (
    tenant_id uuid,
    case_id uuid,
    bucket_month text,
    bucket_id int,
    event_version bigint,
    event_id uuid,
    event_time timestamp,
    event_type text,
    actor_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, bucket_month, bucket_id), event_version, event_id)
) WITH CLUSTERING ORDER BY (event_version DESC, event_id ASC);
```

But this complicates read latest 100.

---

### 15.3 Open Cases by Assignee

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
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
) WITH CLUSTERING ORDER BY (due_at ASC, case_id ASC);
```

Properties:

```text
derived
sorted by due date
bounded by day/bucket
needs cleanup on close/reassign/due_at change
```

---

### 15.4 Due Cases by Team

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
    PRIMARY KEY ((tenant_id, team_id, bucket_day, bucket_id), due_at, case_id)
) WITH CLUSTERING ORDER BY (due_at ASC, case_id ASC);
```

Derived from current state/events.

---

### 15.5 Command Idempotency

```sql
CREATE TABLE command_idempotency_by_id (
    tenant_id uuid,
    command_id uuid,
    entity_id uuid,
    command_type text,
    created_at timestamp,
    result_status text,
    result_ref text,
    PRIMARY KEY ((tenant_id, command_id))
) WITH default_time_to_live = 86400;
```

Strict insert:

```sql
INSERT INTO command_idempotency_by_id (
    tenant_id,
    command_id,
    entity_id,
    command_type,
    created_at,
    result_status
) VALUES (?, ?, ?, ?, ?, ?)
IF NOT EXISTS;
```

---

### 15.6 Notifications

```sql
CREATE TABLE notifications_by_user_day (
    tenant_id uuid,
    user_id uuid,
    bucket_day date,
    notification_time timestamp,
    notification_id uuid,
    notification_type text,
    title text,
    body text,
    read_at timestamp,
    PRIMARY KEY ((tenant_id, user_id, bucket_day), notification_time, notification_id)
) WITH CLUSTERING ORDER BY (notification_time DESC, notification_id ASC);
```

If user feed can be hot:

```text
add bucket_id to partition key
```

---

## 16. Step 11 — Partition Size Estimation

For each table, estimate.

### Case Events

Assume:

```text
average event row = 2 KB
normal case events/month = 500
large case events/month = 200,000
```

Normal partition:

```text
500 * 2 KB = 1 MB
```

Large partition:

```text
200,000 * 2 KB = 400 MB
```

Potentially high but maybe acceptable depending read pattern; if more extreme:

```text
2,000,000 * 2 KB = 4 GB
```

Need bucket.

### Open Cases by Assignee

Assume team queue:

```text
open cases due per day = 100,000
row size = 512 B
bucket_count = 16
```

Per bucket:

```text
100,000 / 16 * 512 B
≈ 3.2 MB
```

Good by size.

But QPS may still matter.

### Notification Feed

Assume:

```text
notifications per user/day = 100 normal
admin/system user = 100,000
row size = 1 KB
```

Normal:

```text
100 KB/day
```

Hot user:

```text
100 MB/day
```

Maybe still manageable by size but hot by QPS. Need heat estimate.

---

## 17. Step 12 — Heat Estimation

For each table:

```text
partition_write_qps
partition_read_qps
hottest key
```

Example current case:

```text
normal case read qps = 0.01
hot case read qps = 1000
```

If current case is one row:

- read hotness can be cached,
- consistency requirements matter,
- replica/shard can still be hot.

Mitigation:

- app cache for low-risk reads,
- rate limit repeated UI polling,
- event-driven UI updates,
- read CL adjustment if acceptable,
- derived read replica/cache.

Example open queue:

```text
team queue read qps = 500
writes = 200/sec
```

With 16 buckets:

```text
write qps/bucket ~12.5
read fanout 16 per request if reading all buckets
```

Read path may dominate.

Maybe bucket by due date/day and only query few buckets.

---

## 18. Step 13 — Bucketing Decisions

Bucketing should be justified by math.

### Time Bucket

Use if data grows with time.

Examples:

```text
case events by month
notifications by day
tenant events by hour/day
login attempts by day
```

### Hash Bucket

Use if write heat per logical key too high.

Examples:

```text
large tenant events
team queue
celebrity user feed
global status table
```

### No Bucket

Use if:

- partition naturally small,
- exact lookup,
- high cardinality,
- no wide clustering rows,
- no hot key risk.

Example:

```text
case_current_by_id
command_idempotency_by_id
```

### Adaptive Bucket

Use only if skew is large and stable enough to justify complexity.

---

## 19. Step 14 — Denormalization Plan

List writes per command.

Command:

```text
Submit case for review
```

Potential writes:

1. idempotency reservation,
2. append event,
3. update current state,
4. insert/update open_cases_by_assignee,
5. insert due_cases_by_team,
6. notification feed,
7. maybe aggregate counters.

Do not pretend these are one transaction unless designed.

Classify:

| Write | Authority | Must Succeed with Command? | Rebuildable? |
|---|---|---|---|
| idempotency reservation | guard | yes | TTL maybe |
| event append | source | yes | no |
| current state | authoritative snapshot | yes | can rebuild but operationally important |
| assignee view | derived | maybe sync or async | yes |
| due team view | derived | maybe async | yes |
| notification | derived | async acceptable | yes |
| aggregate count | derived | async | yes |

This classification drives write path.

---

## 20. Step 15 — Write Propagation Strategy

Options:

### 20.1 Synchronous Multi-Table Write

Application writes all tables before returning success.

Pros:

- views fresh,
- simple user experience.

Cons:

- no atomicity across tables,
- partial failure possible,
- higher latency,
- more timeout ambiguity,
- complicated rollback/repair.

### 20.2 Source First, Async Projection

Application writes authoritative source/current state, then async projector updates derived tables.

Pros:

- clearer authority,
- derived views rebuildable,
- better latency for command,
- easier eventual consistency model.

Cons:

- derived views lag,
- projector complexity,
- queue/stream/retry needed,
- user may not immediately see queue update.

### 20.3 Hybrid

Critical views sync, non-critical async.

Example:

```text
event + current state sync
assignee queue async
notification async
aggregate async
```

For regulatory systems, this is often good.

---

## 21. Step 16 — Consistency Level Selection

Pick CL per table/use case.

Example:

| Operation | Suggested CL | Reason |
|---|---|---|
| append audit event | LOCAL_QUORUM | durable authoritative write |
| read current case | LOCAL_QUORUM | avoid stale state if important |
| update current case | LOCAL_QUORUM + LWT/guard if needed | correctness |
| insert idempotency key | LOCAL_QUORUM + SERIAL/LOCAL_SERIAL | strict dedupe |
| read assignee queue | LOCAL_ONE/LOCAL_QUORUM depending UX | derived |
| write derived queue | LOCAL_ONE/LOCAL_QUORUM depending loss tolerance | rebuildable |
| notification feed | LOCAL_ONE or LOCAL_QUORUM | depends UX |
| dashboard aggregate | LOCAL_ONE | eventual |

These are candidates, not universal rules.

Ask:

```text
What happens if read stale?
What happens if write acknowledged by only one replica?
Can table be rebuilt?
Is this source of truth?
```

---

## 22. Step 17 — Timeout and Retry Semantics

For each write, define behavior if timeout.

### Event Append

If event_id stable:

```text
retry safe
```

Because same primary key.

### Current State Update

If normal upsert with version:

```text
retry may be safe if same version/event_id
but concurrent transition risk remains
```

If LWT:

```text
retry behavior depends on outcome;
must read/check command status
```

### Derived Queue Write

If deterministic primary key:

```text
retry insert safe
delete old row safe if old key known
```

### Counter Increment

```text
unsafe retry unless special handling
```

Document in repository contract.

---

## 23. Step 18 — Reconciliation Design

Derived tables need reconciliation.

Example:

```text
open_cases_by_assignee_day_bucket
```

Reconciliation job:

```text
1. scan/source current cases by controlled partition/batch path
2. compute expected derived key
3. compare/write missing derived rows
4. remove stale derived rows if detectable
5. record progress
6. throttle
7. metric divergence count
```

But scanning `case_current_by_id` by all cases may not be efficient for online path. Reconciliation can be batch/offline, maybe token-range scan or stream from event log.

Important:

```text
If table is derived, define rebuild source and deterministic key generation.
```

Without this, derived table corruption becomes permanent operational debt.

---

## 24. Step 19 — Backfill Strategy

When adding new derived table:

```text
new table: cases_by_priority_day_bucket
```

Backfill plan:

```text
1. Create table.
2. Deploy dual-write/projector for new changes.
3. Backfill historical data from source.
4. Validate counts/samples.
5. Switch reads.
6. Monitor divergence.
7. Remove old path later.
```

Backfill safety:

- idempotent writes,
- deterministic primary key,
- resumable progress,
- throttled concurrency,
- per-tenant/bucket partitioning,
- metrics,
- rollback.

---

## 25. Step 20 — Java Repository Contract

Do not expose generic repositories.

Define access-pattern-specific interfaces.

Example:

```java
interface CaseCurrentRepository {
    CompletionStage<Optional<CaseCurrent>> findByTenantAndCase(
        TenantId tenantId,
        CaseId caseId,
        ConsistencyProfile consistency
    );

    CompletionStage<TransitionResult> transitionIfVersionMatches(
        TenantId tenantId,
        CaseId caseId,
        long expectedVersion,
        CaseStatus newStatus,
        EventId eventId
    );
}
```

Event store:

```java
interface CaseEventStore {
    CompletionStage<Void> appendEvent(
        TenantId tenantId,
        CaseId caseId,
        YearMonth bucketMonth,
        CaseEvent event
    );

    CompletionStage<Page<CaseEvent>> findLatestEvents(
        TenantId tenantId,
        CaseId caseId,
        YearMonth bucketMonth,
        int limit,
        PageCursor cursor
    );
}
```

Derived queue:

```java
interface OpenCaseQueueView {
    CompletionStage<List<OpenCaseRow>> findOpenCasesByAssigneeDayBucket(
        TenantId tenantId,
        AssigneeId assigneeId,
        LocalDate bucketDay,
        int bucketId,
        int limit
    );

    CompletionStage<Void> upsertOpenCaseRow(OpenCaseRow row);

    CompletionStage<Void> deleteOpenCaseRow(OpenCaseDerivedKey oldKey);
}
```

Repository contract should reveal:

- partition key,
- bucket,
- limit,
- cursor,
- source/derived semantics,
- consistency profile,
- idempotency.

---

## 26. Step 21 — API Contract Alignment

Do not expose API that contradicts storage model.

Bad:

```http
GET /cases?tenantId=T&status=OPEN&assignee=A&from=2020&to=2026&sort=priority&limit=100
```

This invites arbitrary query.

Better:

```http
GET /tenants/{tenantId}/assignees/{assigneeId}/open-cases?day=2026-06-21&cursor=...&limit=50
```

For advanced search:

```http
GET /cases/search?q=...
```

served by search system.

For analytics:

```http
GET /reports/case-status-summary
```

served by OLAP/aggregate projection.

API design and data model must co-evolve.

---

## 27. Step 22 — Cursor Design

For ScyllaDB, cursor should encode primary key progress.

Example for:

```sql
PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
```

Cursor might contain:

```json
{
  "bucketDay": "2026-06-21",
  "bucketId": 3,
  "lastDueAt": "2026-06-21T10:15:00Z",
  "lastCaseId": "..."
}
```

For multi-bucket merge, cursor may need:

```text
per-bucket last key
global merge watermark
```

This is more complex than SQL offset but much more scalable.

Avoid:

```text
offset=10000
```

Offset means skip work.

---

## 28. Step 23 — Observability From Data Model

For every table, define metrics.

Example `case_events_by_case_month`:

- read latency by table,
- write latency by table,
- partition size warnings,
- large case IDs,
- events per case/month,
- tombstone warnings,
- compaction backlog,
- p99 latest-events query,
- timeout rate,
- retry rate.

Example `open_cases_by_assignee_day_bucket`:

- read fanout count,
- per-bucket row count,
- stale derived row count,
- queue divergence,
- delete/tombstone rate,
- hottest assignee/team,
- p99 by assignee type.

Observability should be designed with table.

---

## 29. Step 24 — Failure Mode Review

For each access pattern, write failure scenarios.

### AP2 Append Event

Failure:

```text
write timeout
```

Question:

```text
Did event commit?
```

Mitigation:

```text
stable event_id, retry idempotently, command status check
```

### AP5 Derived Queue Update

Failure:

```text
event/current updated, queue projection failed
```

Mitigation:

```text
projector retry, reconciliation, source-of-truth current table
```

### AP7 Idempotency LWT Timeout

Failure:

```text
IF NOT EXISTS result unknown
```

Mitigation:

```text
read idempotency row by command_id, decide command status, retry carefully
```

### AP3 Latest Events

Failure:

```text
current month query returns not enough events
```

Mitigation:

```text
query previous month bucket, bounded loop, cursor
```

### Open Queue Read

Failure:

```text
one bucket query timeout
```

Mitigation options:

- fail whole request,
- return partial with warning,
- retry one bucket,
- degrade based on business criticality.

Define this explicitly.

---

## 30. Full Example: From Journey to Tables

### Journey

```text
Officer submits case for review.
```

Command fields:

```text
tenant_id
case_id
command_id
actor_id
expected_version
target_status = SUBMITTED
payload
```

Invariants:

```text
command not duplicate
current version matches
transition DRAFT -> SUBMITTED allowed
audit event appended
current state updated
derived queues eventually updated
```

Write plan:

1. reserve command idempotency row with LWT,
2. transition current state with LWT or serialized command handler,
3. append event with deterministic event_id/version,
4. publish/project derived updates,
5. update idempotency result.

Tables:

```text
command_idempotency_by_id
case_current_by_id
case_events_by_case_month
open_cases_by_assignee_day_bucket
notifications_by_user_day
```

If step 4 fails:

```text
command still applied if source/current committed
projector/reconciliation repairs derived views
```

This is a state machine, not blind multi-table write.

---

## 31. Full Example: Read Case Detail Page

UI needs:

- current state,
- latest 20 events,
- assignee info,
- open tasks maybe,
- attachments metadata.

Potential reads:

```text
case_current_by_id
case_events_by_case_month
case_attachments_by_case
case_tasks_by_case_status
```

Avoid serial waterfall if p99 matters.

Design:

- bounded parallel reads,
- current state authoritative,
- events latest 20 from current month then previous if needed,
- attachments metadata paged,
- tasks bounded by status/bucket,
- page-level timeout budget.

Java service:

```text
issue 3-4 bounded async queries
use per-query timeout
do not fanout unbounded
return partial only if allowed
```

---

## 32. Full Example: Open Queue Page

UI:

```text
Supervisor opens open cases by assignee/team due today.
```

Access pattern:

```text
tenant_id
assignee_id or team_id
bucket_day
sort by due_at
limit 50
```

Table:

```text
open_cases_by_assignee_day_bucket
```

If bucket_count=8:

```text
query 8 buckets
merge by due_at
take 50
```

Concurrency:

```text
max 8 in-flight DB requests
```

If bucket_count=64:

```text
querying all buckets may be too expensive
```

Need:

- smaller per-view bucket count,
- hierarchical buckets,
- precomputed top-N,
- split by due-hour,
- product/API changes.

Query-first modeling exposes this before production.

---

## 33. Full Example: Dashboard Counts

Requirement:

```text
show count of open cases by status/team
```

Bad:

```sql
SELECT count(*) FROM case_current_by_id WHERE status = 'OPEN';
```

Better:

```text
derived aggregate table
```

Example:

```sql
CREATE TABLE case_counts_by_tenant_status_day (
    tenant_id uuid,
    bucket_day date,
    status text,
    team_id uuid,
    count_value bigint,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, bucket_day), status, team_id)
);
```

But exact distributed counters may be hard.

Options:

- event-derived aggregate updated async,
- approximate count,
- periodic batch recompute,
- OLAP/ClickHouse for reporting,
- dashboard tolerates lag.

Do not use ScyllaDB OLTP table for ad-hoc count scan.

---

## 34. Common Design Branches

### Branch A — Source Event Log + Projection

Use when:

- audit important,
- state changes need trace,
- derived views rebuildable,
- eventual views acceptable.

Pattern:

```text
append event
update current
project views
```

### Branch B — Current State Only

Use when:

- no audit/event history needed,
- simple lookup/update,
- low complexity.

Risk:

- weak auditability,
- harder rebuild,
- overwrite history lost.

### Branch C — External Search/Analytics

Use when:

- arbitrary search,
- full text,
- aggregation,
- reporting,
- many filters/sorts.

Pattern:

```text
ScyllaDB source/current -> stream/project -> search/OLAP
```

### Branch D — LWT Guarded Row

Use when:

- uniqueness,
- compare-and-set,
- low/moderate contention,
- correctness > latency.

---

## 35. Decision: Table vs Index vs External System

For new query, ask:

```text
Is this a high-QPS bounded OLTP access pattern?
```

If yes:

```text
dedicated ScyllaDB table
```

If query is low-QPS and bounded, maybe secondary index acceptable depending constraints.

If query is:

- arbitrary,
- text,
- analytical,
- aggregation-heavy,
- many filters,

use external/search/OLAP.

ScyllaDB is not the only data system in architecture.

---

## 36. Design Review: Red Flags

Red flags in requirement/design:

```text
“filter by any field”
“sort by any column”
“export all matching records online”
“count all rows where...”
“we will add index later”
“just use ALLOW FILTERING for now”
“tenant_id is partition key; tenants are roughly equal”
“status as partition key”
“we can retry all writes”
“batch will make it faster”
“derived table will always be consistent”
“we don’t need reconciliation”
“timeout means failed”
“we can change primary key later”
```

Each red flag needs explicit redesign or risk acceptance.

---

## 37. Query Matrix to Table Mapping

Example mapping:

| Access Pattern | Table | Primary Key |
|---|---|---|
| Read current case | case_current_by_id | ((tenant_id, case_id)) |
| Append/read case events | case_events_by_case_month | ((tenant_id, case_id, bucket_month), event_version, event_id) |
| Open cases by assignee | open_cases_by_assignee_day_bucket | ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id) |
| Due cases by team | due_cases_by_team_day_bucket | ((tenant_id, team_id, bucket_day, bucket_id), due_at, case_id) |
| Command dedupe | command_idempotency_by_id | ((tenant_id, command_id)) |
| Notifications | notifications_by_user_day | ((tenant_id, user_id, bucket_day), notification_time, notification_id) |
| Dashboard status counts | case_counts_by_tenant_status_day | ((tenant_id, bucket_day), status, team_id) |
| Full-text case search | external search | not ScyllaDB CQL table |

This mapping is the core output of query-first modeling.

---

## 38. Write Path Mapping

For command “assign case to reviewer”:

| Step | Table | Operation | Idempotent? | Authority |
|---|---|---|---|---|
| 1 | command_idempotency_by_id | INSERT IF NOT EXISTS | yes by command_id | guard |
| 2 | case_current_by_id | UPDATE IF version/status | yes if event/version stable | authoritative snapshot |
| 3 | case_events_by_case_month | INSERT event | yes by event_id/version | source |
| 4 | open_cases_by_assignee_day_bucket | DELETE old + INSERT new | yes if keys known | derived |
| 5 | notifications_by_user_day | INSERT notification | yes by notification_id | derived |

Questions:

```text
Are steps 2 and 3 ordered?
What if step 3 succeeds and step 2 fails?
What if step 2 succeeds and step 3 times out?
What is command result state?
What reconciles derived views?
```

This is where workflow/state-machine thinking matters.

---

## 39. Handling Multi-Table Atomicity Gap

ScyllaDB does not give general multi-table transaction.

Strategies:

### 39.1 Make One Table Authoritative

Example:

```text
case_events_by_case_month is authoritative
case_current_by_id is projection
```

Then if projection fails, rebuild.

### 39.2 Use Command State Machine

Track command progress:

```text
RESERVED
EVENT_APPENDED
CURRENT_UPDATED
PROJECTED
COMPLETED
FAILED_RETRYABLE
```

### 39.3 Idempotent Steps

Each step can retry safely.

### 39.4 Reconciliation

Periodic repair from authoritative source.

### 39.5 Avoid Cross-Entity Invariant

Keep invariants within one partition/entity where possible.

---

## 40. Modeling State Machines

For lifecycle systems, model state explicitly.

Example states:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
CLOSED
REOPENED
```

Allowed transitions:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
APPROVED -> CLOSED
REJECTED -> CLOSED
CLOSED -> REOPENED
```

Storage design:

- current state row includes `status`, `version`,
- event log includes transition events,
- command handler validates transition,
- LWT/expected version prevents concurrent invalid update,
- derived views update based on transition.

Do not let arbitrary update write any status.

Bad:

```java
caseRepository.updateStatus(caseId, status);
```

Good:

```java
caseWorkflow.transition(commandId, caseId, expectedVersion, SubmitForReviewCommand);
```

---

## 41. Modeling Regulatory Audit

Audit requirements:

```text
who
what
when
from_state
to_state
why
evidence reference
command_id
correlation_id
source IP/system
```

Table:

```sql
CREATE TABLE case_events_by_case_month (
    tenant_id uuid,
    case_id uuid,
    bucket_month text,
    event_version bigint,
    event_id uuid,
    event_time timestamp,
    event_type text,
    actor_id uuid,
    command_id uuid,
    correlation_id text,
    from_status text,
    to_status text,
    reason text,
    payload text,
    PRIMARY KEY ((tenant_id, case_id, bucket_month), event_version, event_id)
) WITH CLUSTERING ORDER BY (event_version DESC, event_id ASC);
```

For full audit export, online latest-event table may not be enough. Use batch/export process by month buckets.

Legal hold:

```text
no TTL on audit source
careful delete process
backup/restore tested
```

---

## 42. Modeling Rebuildable Views

Derived table must have:

```text
source table
deterministic key
projection version
rebuild job
staleness metric
cleanup strategy
```

Example row includes:

```text
projection_version
source_event_id
source_version
updated_at
```

This helps detect stale rows.

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
    source_event_id uuid,
    projected_at timestamp,
    PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
);
```

Now UI/service can detect suspicious stale row:

```text
status not open
source_version behind
```

---

## 43. Modeling Cleanup

When source state changes:

```text
old assignee: A
new assignee: B
old due_at: D1
new due_at: D2
```

Need:

```text
DELETE old derived row by old full primary key
INSERT new derived row by new full primary key
```

Therefore command handler/projection needs previous state.

Options:

- read previous current state,
- include previous values in event,
- derive from event log,
- store old derived keys,
- reconciliation later.

For correctness:

```text
old key must be known exactly
```

Hash bucket must be deterministic:

```text
bucket_id = hash(case_id) % bucket_count
```

or stored.

---

## 44. Modeling Deletions and Tombstone Budget

Derived queue has delete on close/reassign.

If high churn:

```text
many deletes -> tombstones
```

Alternatives:

1. Use time-bucketed partitions so tombstones age out.
2. Keep status as regular column and tolerate stale rows after bounded read.
3. Use append-only view with latest marker and reconciliation.
4. Use shorter-lived buckets.
5. Use external queue/search if semantics better.
6. Reduce update frequency.

Design question:

```text
How many deletes per partition per day?
```

If answer is huge, redesign.

---

## 45. Modeling Counts

Counts are deceptively hard.

Requirement:

```text
count open cases by status/team
```

Options:

### 45.1 Exact Counter Table

CQL counters can increment/decrement.

Risks:

- retry ambiguity,
- counter limitations,
- high contention,
- operational complexity.

### 45.2 Event-Derived Aggregate

Project from state transition events.

Pros:

- rebuildable,
- auditable,
- less retry ambiguity if idempotent by event.

Cons:

- eventual,
- projector complexity.

### 45.3 Periodic Batch Recompute

Good for dashboards that tolerate lag.

### 45.4 OLAP

Use ClickHouse or similar for analytical counts.

For regulatory dashboards, define whether count is operational estimate or legally authoritative.

---

## 46. Modeling Search

Requirement:

```text
search cases by party name, free text, reference, status, date range
```

Do not force into ScyllaDB primary key unless access pattern is narrow and known.

Use:

```text
ScyllaDB source/current
  -> CDC/event stream/projector
  -> search index
```

Search result returns IDs.

Then fetch current state by case IDs from ScyllaDB if needed, bounded.

Avoid:

```text
ALLOW FILTERING over case_current_by_id
```

---

## 47. Modeling Export

Requirement:

```text
export complete case history
```

This may scan many buckets.

Do not run as online request directly.

Use:

- async export job,
- bounded token/bucket scanning,
- progress table,
- object storage output,
- throttling,
- retry,
- audit log,
- rate limits.

ScyllaDB table can support export if bucketed:

```text
case_id + bucket_month
```

Export loops months in order.

But endpoint should be asynchronous.

---

## 48. Data Modeling Deliverables

A mature ScyllaDB design review should produce:

```text
1. User journeys.
2. Access pattern matrix.
3. Authority matrix.
4. Correctness invariant list.
5. Freshness matrix.
6. Cardinality matrix.
7. Heat matrix.
8. Retention/delete matrix.
9. Table schemas.
10. Query list per table.
11. Partition size estimates.
12. Hot key estimates.
13. Bucketing rationale.
14. Consistency level choices.
15. Write propagation plan.
16. Retry/idempotency plan.
17. Reconciliation/backfill plan.
18. Java repository contracts.
19. API contract constraints.
20. Observability plan.
21. Failure mode review.
```

Without these, schema is guesswork.

---

## 49. Common Anti-Patterns in Modeling Process

### 49.1 Entity-First Modeling

```text
Create cases table with every field.
Then try to query everything from it.
```

### 49.2 ORM-Style Repository

```text
findByAnyField
findAll
save
delete
```

### 49.3 Hidden Fanout

```text
repository method looks like one query but loops 1000 partitions.
```

### 49.4 “Temporary” ALLOW FILTERING

Temporary production hacks become permanent incidents.

### 49.5 No Source-of-Truth Decision

Team cannot tell which table wins when data diverges.

### 49.6 No Rebuild Path

Derived table corruption requires manual surgery.

### 49.7 No Heat Estimate

Design assumes uniform traffic.

### 49.8 No Timeout Semantics

Retries duplicate effects or lose user command state.

---

## 50. Practical Design Review Checklist

Use this checklist before approving schema.

### Access Pattern

```text
[ ] Every production query is listed.
[ ] Each query has exact inputs.
[ ] Each query has sort/limit/page behavior.
[ ] No arbitrary filter hidden in API.
```

### Table Design

```text
[ ] Each table maps to access pattern.
[ ] Partition key is complete in query.
[ ] Clustering order matches sort/range.
[ ] Partition size estimated.
[ ] Hot partition risk estimated.
[ ] Bucketing justified.
```

### Correctness

```text
[ ] Source-of-truth table identified.
[ ] Derived views identified.
[ ] Invariants listed.
[ ] LWT/serialization/versioning chosen where needed.
[ ] Idempotency keys stable.
```

### Operations

```text
[ ] Retention/TTL/delete modeled.
[ ] Tombstone risk assessed.
[ ] Reconciliation exists for derived tables.
[ ] Backfill plan exists.
[ ] Metrics/alerts defined.
```

### Java/API

```text
[ ] Repository methods are access-pattern-specific.
[ ] Page limits required.
[ ] Consistency level explicit.
[ ] Retry policy based on idempotency.
[ ] API does not expose unsupported query shapes.
```

---

## 51. Mental Model Compression

Query-first modeling can be compressed to:

```text
Do not ask:
  What entities do I have?

Ask:
  What questions must the system answer,
  under what latency,
  with what correctness,
  at what scale,
  and how will failures be repaired?
```

Then:

```text
Each ScyllaDB table is a precomputed physical answer path.
```

---

## 52. Summary

Query-first data modeling is the core methodology for ScyllaDB.

Key lessons:

1. Start from user journeys, not entity tables.
2. Extract precise access patterns.
3. Classify source-of-truth vs derived data.
4. Define correctness invariants before schema.
5. Define freshness per access pattern.
6. Estimate cardinality and heat.
7. Model retention, TTL, and delete behavior.
8. Design physical query shapes.
9. Choose primary keys based on locality and distribution.
10. Estimate partition size and hot key QPS.
11. Use bucketing only with clear trade-off.
12. Plan denormalized writes explicitly.
13. Choose consistency level per operation.
14. Define timeout/retry semantics.
15. Build reconciliation/backfill for derived tables.
16. Align Java repository methods with partition keys.
17. Align API design with scalable access patterns.
18. Use search/OLAP systems for workloads that do not fit ScyllaDB.
19. Treat observability as part of data model.
20. Review failure modes before production.

---

## 53. Review Questions

1. Mengapa ScyllaDB data modeling harus query-first?
2. Apa beda user journey dan access pattern?
3. Kenapa source-of-truth classification penting?
4. Apa contoh derived table?
5. Apa yang terjadi jika derived table tidak punya rebuild path?
6. Apa itu freshness matrix?
7. Mengapa cardinality tidak sama dengan heat?
8. Kenapa tenant_id saja sering buruk sebagai partition key?
9. Apa peran retention matrix?
10. Bagaimana access pattern berubah menjadi primary key?
11. Kapan time bucket dibutuhkan?
12. Kapan hash bucket dibutuhkan?
13. Apa trade-off bucket terhadap read path?
14. Mengapa write propagation strategy harus eksplisit?
15. Kenapa multi-table write bukan transaksi umum?
16. Bagaimana timeout ambiguity memengaruhi retry?
17. Apa isi Java repository contract yang baik?
18. Kenapa API arbitrary filter buruk?
19. Kapan query harus dipindahkan ke search/OLAP?
20. Apa deliverables desain ScyllaDB yang matang?

---

## 54. Practical Exercise

Gunakan domain pilihanmu atau domain regulatory case management berikut:

```text
System:
- Tenants have enforcement cases.
- Cases have lifecycle events.
- Officers and reviewers work from queues.
- Case state transitions must be auditable.
- Notifications are shown to users.
- Dashboard shows operational counts.
- Search supports text/reference lookup.
```

Buat deliverables:

```text
1. 10 user journeys.
2. Access pattern matrix.
3. Authority matrix.
4. Correctness invariants.
5. Freshness matrix.
6. Cardinality matrix.
7. Heat matrix.
8. Retention/delete matrix.
9. Candidate CQL tables.
10. Query per table.
11. Partition size estimates.
12. Bucketing rationale.
13. Consistency level per operation.
14. Write propagation plan.
15. Reconciliation plan.
16. Java repository interfaces.
17. API constraints.
18. Observability metrics.
19. Failure mode review.
20. Red flags and open questions.
```

Do this before writing production schema.

---

## 55. Preview Part 010

Part berikutnya akan memperdalam topik yang paling sering menyebabkan production incident:

```text
Partition Sizing, Cardinality, Hot Partition, dan Bucketing
```

Kita akan membahas estimasi ukuran partition, rows per partition, QPS per key, tenant skew, celebrity/hot entity problem, adaptive bucketing, read fanout, and mitigation strategies.

Part 009 memberi metodologi desain.

Part 010 akan memberi quantitative tools untuk sizing dan hot-spot prevention.

---

# End of Part 009

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Primary Key Design: Partition Key, Clustering Key, dan Physical Query Shape</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-010.md">Part 010 — Partition Sizing, Cardinality, Hot Partition, dan Bucketing ➡️</a>
</div>

# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-010.md

# Part 010 — Partition Sizing, Cardinality, Hot Partition, dan Bucketing

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `010`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: menguasai sizing partition, membaca cardinality dan skew, mendeteksi hot partition, memilih strategi bucketing, menghitung trade-off read fanout, dan mendesain mitigasi sebelum production incident.

---

## 0. Posisi Part Ini dalam Seri

Di part 009 kita membangun metodologi query-first data modeling:

```text
user journey -> access pattern -> authority -> correctness -> cardinality/heat -> table design
```

Part ini memperdalam area yang paling sering menjadi akar incident ScyllaDB/Cassandra-style systems:

```text
partition sizing and hot partition
```

Kesalahan umum:

```text
primary key terlihat benar secara query,
tetapi partition terlalu besar atau terlalu hot.
```

Contoh:

```sql
PRIMARY KEY (tenant_id, event_time)
```

Query:

```sql
WHERE tenant_id = ?
```

terlihat “sesuai access pattern”, tetapi jika tenant besar:

```text
one tenant = one partition = one hot path
```

Part ini membahas cara berpikir kuantitatif supaya desain tidak hanya “valid CQL”, tetapi juga sehat di production.

---

## 1. Core Mental Model

ScyllaDB mendistribusikan data berdasarkan partition key.

Pipeline:

```text
partition key
  -> token
  -> tablet/token range
  -> replica nodes
  -> shard/core
  -> storage engine partition
```

Jika partition key terlalu sempit:

```text
too few partitions
```

maka cluster tidak bisa menyebarkan workload.

Jika partition terlalu besar:

```text
too much data under one key
```

maka reads, compaction, repair, cache, tombstone handling, and pagination menjadi mahal.

Jika partition terlalu hot:

```text
too much traffic to one key
```

maka satu replica set/shard bisa overload walaupun cluster average tampak sehat.

Prinsip:

```text
ScyllaDB scales by many well-distributed bounded partitions.
```

Bukan:

```text
one giant partition per business aggregate forever.
```

---

## 2. Three Independent Risks

Jangan campur tiga risiko ini.

### 2.1 Low Cardinality

Terlalu sedikit partition key values.

Example:

```text
status = OPEN/CLOSED/PENDING
```

Jika partition key = status, hanya sedikit partitions.

### 2.2 Large Partition

Satu partition berisi terlalu banyak rows/bytes.

Example:

```text
tenant_id = BIG_BANK
events forever
```

### 2.3 Hot Partition

Satu partition menerima terlalu banyak read/write QPS.

Example:

```text
celebrity user feed
system-wide queue
high-profile investigation case
top merchant payment events
```

Ketiganya bisa overlap, tetapi tidak sama.

| Risk | What is high? | Example |
|---|---|---|
| Low cardinality | few keys | status |
| Large partition | bytes/rows per key | tenant events forever |
| Hot partition | QPS per key | one viral user |
| Hot tablet/shard | load concentration after mapping | many hot keys in same range/shard |

Desain harus mengecek semua.

---

## 3. Why Cluster Size Does Not Save Bad Partitioning

Misal cluster 30 node, RF=3.

Jika table:

```sql
CREATE TABLE tenant_events (
    tenant_id text,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY (tenant_id, event_time, event_id)
);
```

Untuk tenant:

```text
tenant_id = MEGA_TENANT
writes = 100,000/sec
```

Semua write punya partition key sama:

```text
MEGA_TENANT
```

Maka:

```text
one partition key -> one token -> one tablet/range path -> one replica set
```

RF=3 berarti hanya tiga replica node menyimpan data tersebut.

Di dalam node, shard ownership juga terbatas.

30 node tidak berarti satu partition dapat menggunakan 30 node.

Kesimpulan:

```text
Scale-out helps if workload has many distributed partition keys.
Scale-out does not automatically split one logical hot partition.
```

---

## 4. Partition Size: Apa yang Diukur?

Partition size bisa dipahami dalam beberapa ukuran:

```text
rows per partition
cells per partition
bytes per partition
tombstones per partition/range
read rows per query
write QPS per partition
read QPS per partition
```

Bytes saja tidak cukup.

Satu partition 100 MB dengan sedikit rows besar punya karakter berbeda dari 100 MB dengan jutaan tiny rows dan tombstones.

### 4.1 Rows Per Partition

Formula:

```text
rows_per_partition = write_rate_per_partition * retention_window
```

Example:

```text
device writes = 50 events/sec
bucket = 1 day

rows = 50 * 86,400 = 4,320,000 rows/day/device
```

Ini mungkin terlalu besar.

### 4.2 Bytes Per Partition

Formula:

```text
bytes_per_partition = rows_per_partition * average_row_size
```

If:

```text
rows = 4,320,000
avg row = 500 bytes
```

Then:

```text
~2.16 GB per partition
```

Potentially problematic.

### 4.3 QPS Per Partition

Formula:

```text
partition_qps = total_qps * fraction_for_partition_key
```

Example:

```text
total writes = 100,000/sec
largest tenant = 40%
partition key = tenant_id

partition_write_qps = 40,000/sec
```

Even if partition size is currently small, this is hot.

---

## 5. Sizing Worksheet

For every candidate partition key, fill:

```text
Table:
Partition key:
Average row size:
Rows per logical entity per time:
Retention per partition:
Average partition size:
P95 partition size:
P99 partition size:
Maximum expected partition size:
Average write QPS per partition:
P99 write QPS per partition:
Maximum write QPS per partition:
Average read QPS per partition:
P99 read QPS per partition:
Read rows per query:
Read bytes per query:
Tombstone rate:
TTL/delete pattern:
```

If you cannot estimate, use conservative assumptions and design observability to validate.

Production data distribution is rarely uniform.

---

## 6. Cardinality

Cardinality = number of distinct values.

High cardinality candidate:

```text
case_id
user_id
command_id
event_id
session_token
device_id
```

Low cardinality candidate:

```text
status
country
region
boolean flag
day
hour
event_type
priority
team_id in small org
```

But high cardinality alone is not enough.

Example:

```text
user_id has millions of values,
but one admin/system user receives 50% traffic.
```

High cardinality can still be hot due to skew.

---

## 7. Cardinality vs Selectivity vs Heat

SQL engineers often think in selectivity.

In ScyllaDB, we care about cardinality and heat.

### 7.1 Cardinality

```text
How many distinct keys exist?
```

### 7.2 Selectivity

```text
How many rows match a predicate?
```

### 7.3 Heat

```text
How much traffic hits a key/range?
```

A column can have high cardinality but bad heat.

Example:

```text
tenant_id cardinality = 10,000
largest tenant = 60% traffic
```

A column can have low cardinality but acceptable heat if table tiny/admin-only.

Context matters.

---

## 8. Skew

Real workloads are skewed.

Common patterns:

```text
top 1% tenants produce 80% traffic
top 0.1% users produce 30% notifications
one status OPEN dominates rows
one team queue dominates operations
one event type dominates writes
one current day dominates time-series writes
```

Uniform assumption is dangerous.

Use distribution thinking:

```text
average is not design input
p95/p99/max are design inputs
```

### 8.1 Zipf-Like Workloads

Many real workloads follow a heavy-tail distribution.

Meaning:

```text
few keys are extremely hot
many keys are cold
```

Designing for average key is meaningless.

If largest tenant is 1000x average, bucket based on largest/expected hot tenant, not average.

---

## 9. Hot Partition Symptoms

Application symptoms:

- p99 spikes for subset of users/tenants/cases,
- timeouts for specific keys,
- retries concentrated on specific endpoint,
- queue page slow for one assignee/team,
- dashboard average looks fine.

Database symptoms:

- one shard CPU high,
- one node/replica set hotter,
- per-table p99 high,
- increased coordinator/replica latency for one table,
- cross-shard forwarding amplified,
- compaction localized,
- large partition warnings,
- cache churn.

Danger:

```text
cluster average CPU can look safe.
```

Always inspect distribution.

---

## 10. Large Partition Symptoms

Large partition often appears as:

- slow reads for old/high-volume entity,
- high memory usage during query,
- tombstone warnings,
- read timeout despite primary key query,
- compaction debt,
- repair slow,
- paging unstable/slow,
- node/shard local pressure,
- storage diagnostics show large partition.

Large partition may not be hot now, but can be operationally dangerous later.

Example:

```text
case with 10 million audit events
rarely read interactively
but repair/export becomes expensive
```

---

## 11. Query Shape and Partition Size

A large partition is less harmful if queries read tiny bounded slices efficiently, but still not free.

Example:

```text
partition = case_id
rows = 1 million events
query latest 10
clustering order DESC
```

Read latest 10 may be okay if no tombstone/compaction issue.

But risks remain:

- full history export expensive,
- repair expensive,
- compaction expensive,
- tombstones can hurt,
- old range queries expensive,
- memory/index metadata pressure,
- future query may accidentally scan.

Bounded partition design is safer than relying on “we only read latest 10”.

---

## 12. Time Bucketing Deep Dive

Time bucketing limits partition growth by time window.

Patterns:

```text
entity_id + day
entity_id + hour
entity_id + month
tenant_id + day
tenant_id + hour + bucket_id
```

### 12.1 Choose Time Bucket by Write Rate

Formula:

```text
partition_rows = writes_per_second_per_entity * seconds_per_bucket
```

Example:

```text
writes/sec/entity = 10
bucket = day

rows = 10 * 86400 = 864,000
```

If row 1 KB:

```text
~864 MB/day/entity
```

Maybe too high.

Bucket hour:

```text
10 * 3600 = 36,000 rows
~36 MB/hour/entity
```

Better.

### 12.2 Choose Time Bucket by Read Pattern

If common query:

```text
read last 24 hours
```

hour buckets require 24 partition reads.

Day bucket requires 1 partition read.

Trade-off:

```text
smaller bucket = smaller partition, more fanout
larger bucket = bigger partition, less fanout
```

### 12.3 Bucket by Business Time or Write Time?

Options:

```text
event_time
write_time
business_effective_date
created_at
```

Late-arriving events matter.

If bucket by event_time:

- late events go to old buckets,
- historical buckets receive writes,
- compaction/TTL implications.

If bucket by write_time:

- ingestion smooth,
- query by event time may need more logic.

Choose based on query and retention.

---

## 13. Hash Bucketing Deep Dive

Hash bucketing spreads one logical group across multiple partitions.

Table:

```sql
CREATE TABLE tenant_events_by_hour_bucket (
    tenant_id uuid,
    bucket_hour timestamp,
    bucket_id int,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, bucket_hour, bucket_id), event_time, event_id)
);
```

Write:

```text
bucket_id = hash(event_id) % bucket_count
```

Read tenant/hour:

```text
query bucket_id = 0..bucket_count-1
merge results
```

### 13.1 Stable Hashing

Bucket assignment must be stable.

Bad:

```text
bucket_id = random()
```

unless stored and never needed for deterministic lookup.

Good:

```text
bucket_id = hash(event_id) % N
```

or:

```text
bucket_id = hash(command_id) % N
```

### 13.2 Bucket Count Changes

Changing N is hard.

If old rows used N=16 and new rows N=64:

```text
reader must know which N applies to which time/range/entity
```

Options:

1. never change N for table,
2. include bucket_epoch/config_version,
3. change only at time boundary,
4. create new table,
5. adaptive tenant bucket config.

---

## 14. Bucket Count Calculation

Use both QPS and size constraints.

Inputs:

```text
total_write_qps_for_logical_key
target_write_qps_per_partition
rows_per_time_window
target_rows_per_partition
bytes_per_time_window
target_bytes_per_partition
```

Bucket count candidates:

```text
buckets_by_qps = ceil(total_write_qps / target_write_qps_per_partition)
buckets_by_rows = ceil(rows_per_window / target_rows_per_partition)
buckets_by_bytes = ceil(bytes_per_window / target_bytes_per_partition)
bucket_count = max(buckets_by_qps, buckets_by_rows, buckets_by_bytes)
```

Then round to convenient number:

```text
power of two: 4, 8, 16, 32, 64
```

because modulo/hash distribution and config are simple.

### 14.1 Example

Tenant events:

```text
write_qps = 80,000/sec
target_qps_per_partition = 1,000/sec
row_size = 800 bytes
window = 1 hour
target_partition_size = 1 GB
```

QPS buckets:

```text
ceil(80,000 / 1,000) = 80
```

Rows per hour:

```text
80,000 * 3600 = 288,000,000
```

Bytes per hour:

```text
288,000,000 * 800 ≈ 230 GB
```

Size buckets:

```text
ceil(230 / 1) = 230
```

Bucket count:

```text
max(80, 230) = 230
round to 256
```

But reading 256 buckets per hour is expensive.

This reveals the workload may need:

- smaller time bucket,
- different product query,
- pre-aggregation,
- stream processing,
- separate hot tenant architecture,
- maybe not one interactive ScyllaDB query over all events.

---

## 15. Read Fanout Cost

If bucket_count = N, read may require N partition queries.

Total latency is not simply average latency.

If queries run in parallel:

```text
overall latency ≈ max(latency of N queries) + merge cost
```

As N grows, probability one query hits tail grows.

If one query p99 = 20 ms, fanout 64 increases chance of slow tail.

Approx:

```text
P(no p99 event across N) = 0.99^N
P(at least one p99 event) = 1 - 0.99^N
```

For N=64:

```text
1 - 0.99^64 ≈ 47%
```

Nearly half requests may hit at least one p99-ish subquery.

This is why large fanout hurts p99.

---

## 16. Bounded Fanout Patterns

Fanout can be okay if bounded.

Examples:

```text
4 buckets
8 buckets
12 hourly buckets
current day + previous day
```

Dangerous:

```text
fanout proportional to tenant size
fanout proportional to date range chosen by user
fanout across all days in retention
fanout over thousands of IDs
```

Rule:

```text
Online fanout must have a hard upper bound.
```

For larger scans, use batch/export path.

---

## 17. Merge Cost

Hash-bucketed reads often require merge.

Example:

```text
8 buckets each return top 50 by due_at
merge sorted lists
take final top 50
```

Cost:

- DB queries,
- network,
- Java heap,
- CPU merge,
- cursor complexity,
- duplicate/stale row filtering,
- retry handling.

### 17.1 Overfetch

If final limit=50 and 8 buckets, naive fetch 50 from each:

```text
400 rows fetched
50 returned
```

Acceptable maybe.

With 256 buckets:

```text
12,800 rows fetched for 50 returned
```

Not acceptable for interactive API.

Need smarter design.

---

## 18. Cursor with Buckets

Cursor for bucketed merge is complex.

For table:

```text
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, event_id)
```

Cursor may need:

```json
{
  "bucketDay": "2026-06-21",
  "bucketPositions": {
    "0": {"createdAt": "...", "eventId": "..."},
    "1": {"createdAt": "...", "eventId": "..."},
    "2": {"createdAt": "...", "eventId": "..."}
  }
}
```

or use simpler strategy:

```text
query fixed time windows
return next window cursor
```

Do not hide this complexity. It is a direct consequence of bucketing.

---

## 19. Tenant Bucketing

Multi-tenant systems commonly have tenant skew.

### 19.1 Bad

```sql
PRIMARY KEY (tenant_id, created_at, event_id)
```

For huge tenant:

```text
one tenant partition
```

### 19.2 Better

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, event_id)
```

### 19.3 Tenant-Specific Bucket Count

Small tenants do not need 64 buckets.

Large tenants may need 64+.

Adaptive tenant config:

```sql
CREATE TABLE tenant_partitioning_config_by_id (
    tenant_id uuid PRIMARY KEY,
    event_bucket_count int,
    effective_from timestamp,
    version int,
    updated_at timestamp
);
```

Write path:

```text
bucket_count = config.event_bucket_count
bucket_id = hash(event_id) % bucket_count
```

Risk:

- config cache staleness,
- changing bucket count,
- old/new bucket epochs,
- read path must know config history.

Use only when needed.

---

## 20. Celebrity User Problem

User-based systems often have celebrity/admin/system accounts.

Bad notification table:

```sql
PRIMARY KEY (user_id, notification_time, notification_id)
```

If one user receives huge notifications:

```text
hot/large partition
```

Better:

```sql
PRIMARY KEY ((user_id, bucket_day), notification_time, notification_id)
```

If still hot:

```sql
PRIMARY KEY ((user_id, bucket_day, bucket_id), notification_time, notification_id)
```

But read latest notifications by user now needs bucket merge.

Alternative:

- cap notification fanout,
- batch digest notifications,
- use per-topic feeds,
- precompute latest top-N,
- avoid writing every event to every follower/user.

Sometimes data model problem is actually product architecture problem.

---

## 21. Status Partition Problem

Bad:

```sql
CREATE TABLE cases_by_status (
    status text,
    updated_at timestamp,
    case_id uuid,
    PRIMARY KEY (status, updated_at, case_id)
);
```

Because:

```text
status cardinality low
OPEN huge
CLOSED huge
```

Better:

```sql
CREATE TABLE cases_by_status_day_bucket (
    tenant_id uuid,
    status text,
    bucket_day date,
    bucket_id int,
    updated_at timestamp,
    case_id uuid,
    PRIMARY KEY ((tenant_id, status, bucket_day, bucket_id), updated_at, case_id)
);
```

But ask:

```text
Do we need global status list?
For what time range?
Sorted how?
Limit?
Tenant scoped?
Is this dashboard/search/OLTP?
```

If only counts needed, do not store huge list just to count.

---

## 22. Queue-Like Partition Problem

Bad:

```sql
CREATE TABLE work_queue (
    queue_name text,
    created_at timestamp,
    task_id uuid,
    payload text,
    PRIMARY KEY (queue_name, created_at, task_id)
);
```

Problems:

- one queue partition hot,
- deleting processed tasks creates tombstones,
- competing consumers not natural,
- queue semantics need visibility timeout/ack/retry,
- hot head of partition.

ScyllaDB can store work items or inbox views, but RabbitMQ/Kafka-like queue semantics should not be forced.

If you need queue, use queue/stream system.

If you need queryable worklist, use bucketed derived view and accept tombstone/reconciliation design.

---

## 23. Time-Series High-Write Problem

Device telemetry:

Bad:

```sql
PRIMARY KEY (device_id, timestamp)
```

If device writes 1000/sec, day partition huge.

Better:

```sql
PRIMARY KEY ((device_id, bucket_hour), timestamp, event_id)
```

If still hot:

```sql
PRIMARY KEY ((device_id, bucket_minute, bucket_id), timestamp, event_id)
```

But if read query is “last 24h by device”, smaller buckets mean 24 or 1440 queries.

Maybe ScyllaDB table supports latest few minutes only, while long analytics goes to OLAP.

Architecture split:

```text
ScyllaDB: recent operational lookup
Kafka/object storage/ClickHouse: long-term analytics
```

---

## 24. Regulatory Case Event Problem

Case events are usually moderate, but exceptional cases can be huge.

Potential design:

```sql
PRIMARY KEY ((tenant_id, case_id, bucket_month), event_version, event_id)
```

Works if:

- case/month events bounded,
- read latest/current month common,
- full history export batch.

If exceptional case/month can be huge:

```sql
PRIMARY KEY ((tenant_id, case_id, bucket_month, bucket_id), event_version, event_id)
```

But event_version ordering across buckets becomes complex.

Alternative:

- use bucket by event_version range:

```text
version_bucket = floor(event_version / 10000)
```

Then order/range is easier.

Table:

```sql
PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
```

This keeps chronological sequence in bucket and deterministic range.

This may be better than random hash bucket for event history.

---

## 25. Version-Range Bucketing

Useful for append-only ordered event logs.

Define:

```text
version_bucket = event_version / bucket_size
```

Example:

```text
bucket_size = 10,000 events
```

Primary key:

```sql
PRIMARY KEY ((tenant_id, case_id, version_bucket), event_version, event_id)
```

Pros:

- partition size bounded by row count,
- latest bucket computable from current version,
- range by version natural,
- no random merge across buckets.

Cons:

- needs event_version assignment,
- latest read needs know current version/current bucket,
- backfill/out-of-order version handling,
- LWT/sequence/state machine may be needed.

For lifecycle/audit logs with versioned commands, this can be excellent.

---

## 26. Bucket by Time vs Bucket by Version

| Aspect | Time Bucket | Version Bucket |
|---|---|---|
| Natural for time range | yes | indirect |
| Natural for event sequence | maybe | yes |
| Late events | old bucket writes | version determines |
| Latest read | current time bucket | current version bucket |
| Retention by time | easier | needs mapping |
| Legal audit sequence | maybe | strong |
| Requires sequence | no | yes |

For regulatory state transitions, version bucket may align with audit sequence better.

For telemetry, time bucket is usually better.

---

## 27. Dynamic Hot Key Mitigation

What if hot key appears unexpectedly?

Short-term mitigations:

- rate limit offending tenant/key,
- reduce client polling,
- cache reads if safe,
- lower consistency for derived reads if acceptable,
- increase capacity if cluster-wide pressure,
- isolate tenant/workload,
- disable expensive endpoint temporarily,
- backpressure/retry budget.

Medium-term:

- add bucketed table,
- dual-write,
- backfill,
- switch reads,
- deprecate old table.

Long-term:

- adaptive bucketing,
- product/API redesign,
- architecture split,
- tenant-specific capacity controls.

Adding nodes may help if pressure is distributed, but not if one partition remains hot.

---

## 28. Detecting Hot Keys in Application

Database metrics may show hot shard, but app can identify key distribution earlier.

Instrument:

```text
top tenant IDs by request count
top case IDs by read/write
top assignee queues by read
top partition keys by timeout
top partition keys by latency
fanout count per request
rows returned per request
bytes returned per request
```

Use sampling/hashing to avoid high cardinality metric explosion.

Example:

```text
log slow query with tenant_id, table, partition key hash, row count, page size
```

Be careful with PII/regulatory data in logs.

---

## 29. Detecting Large Partitions

Approaches:

- database large partition warnings/tools,
- table statistics,
- compaction/log warnings,
- offline scanning,
- application-side counters,
- estimated rows per entity,
- ingestion metrics.

Application can maintain approximate counters:

```text
events_per_case_month
events_per_tenant_day
notifications_per_user_day
```

These are not necessarily authoritative, but useful for alerting.

---

## 30. Hot Tablet and Hot Shard

Even if no single partition is huge, many hot partitions can map to same tablet/shard by chance or due to distribution.

ScyllaDB tablets and balancing help, but observability must distinguish:

```text
hot partition: one key
hot tablet: one distribution unit
hot shard: one core
hot node: one instance
hot cluster: global overload
```

Mitigation differs:

| Hot Level | Possible Fix |
|---|---|
| Hot partition | bucket/remodel/cache/rate limit |
| Hot tablet | rebalance/tablet movement/capacity |
| Hot shard | shard-aware routing, data distribution, hot key |
| Hot node | rebalance/add capacity/check ownership |
| Hot cluster | add capacity/reduce load/tune queries |

Do not fix every hot shard by changing bucket count blindly; identify cause.

---

## 31. Bucketing and Consistency

Bucketing can affect correctness.

Example:

```text
events for case spread across bucket_id by hash(event_id)
```

If business needs strict latest event order, reading one bucket is insufficient.

Need:

- query all buckets and merge,
- separate current state table,
- sequence table,
- version bucket,
- command handler.

For “current state”:

```text
do not scatter current state across buckets
```

Use one row per entity, with guard/consistency.

For high-write event log:

```text
bucket append path if needed
```

Separate source/event history from current state.

---

## 32. Bucketing and Idempotency

Bucket key must be stable across retry.

Bad:

```text
bucket_id = randomInt()
```

Retry writes different partition.

Good:

```text
bucket_id = hash(command_id) % N
```

or:

```text
bucket_id = hash(event_id) % N
```

If N changes:

```text
same command_id may map differently
```

unless bucket epoch/version fixed.

Therefore idempotency requires:

```text
stable primary key components
```

including bucket fields.

---

## 33. Bucketing and Deletes

Derived table cleanup requires old bucket.

If bucket is deterministic:

```text
bucket_id = hash(case_id) % N
```

delete can recompute.

If bucket depends on old due_at day:

```text
old bucket_day must be known
```

If bucket_count changed:

```text
old bucket_count/epoch must be known
```

Store old derived key or include enough data in event.

---

## 34. Bucketing and Reconciliation

Reconciliation needs to compute target derived partition.

For each source row:

```text
tenant_id
assignee_id
bucket_day = due_at.toLocalDate()
bucket_id = hash(case_id) % bucket_count
due_at
case_id
```

If bucket_count configurable by tenant/time, reconciliation must use correct config version.

Make config historical:

```sql
tenant_bucket_config_history_by_tenant (
    tenant_id,
    effective_from,
    bucket_count,
    version,
    PRIMARY KEY (tenant_id, effective_from)
);
```

or avoid dynamic bucket count unless necessary.

---

## 35. Over-Bucketing

Over-bucketing causes:

- too many partition reads,
- complicated cursor,
- more metadata,
- more small partitions,
- lower cache efficiency,
- more client merge CPU,
- worse p99 due to fanout.

Example:

```text
bucket_count = 256
UI needs latest 50
```

If query all buckets, too expensive.

Maybe better:

- bucket by time then small hash bucket,
- per-hot-tenant special table,
- precomputed top-N,
- use version buckets,
- reduce fanout by hierarchical query.

---

## 36. Under-Bucketing

Under-bucketing causes:

- partition too large,
- write QPS too high,
- hot shard,
- p99 spikes,
- repair/compaction pain.

Example:

```text
bucket_count = 4
tenant writes 80k/sec
20k/sec per bucket
```

Too hot.

Need more buckets or different architecture.

---

## 37. Hierarchical Bucketing

Sometimes combine dimensions:

```text
tenant_id + day + hour + bucket_id
```

or:

```text
tenant_id + category + day + bucket_id
```

Goal:

- keep each partition bounded,
- keep read fanout tied to query window,
- avoid global fanout.

Example:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_hour, bucket_id), event_time, event_id)
```

If query is last hour, fanout is bucket_count.

If query is last day, fanout is 24 * bucket_count.

Maybe acceptable for batch, not online.

Design API accordingly.

---

## 38. Split Online and Offline Access

One table may not satisfy both:

```text
latest 50 interactive
export last 12 months
```

Use separate paths:

### Online Table

```text
recent_events_by_entity_hour_bucket
```

small windows, low latency.

### Archive/Export Path

```text
object storage / batch scan / OLAP / monthly table
```

or same ScyllaDB source but accessed by async job.

Do not optimize one table for all contradictory access patterns.

---

## 39. Partition Sizing for Current State Tables

Current state table:

```sql
PRIMARY KEY ((tenant_id, case_id))
```

Partition usually one row.

Risks:

- hot reads for one case,
- hot updates for one case,
- LWT contention,
- current row wide/large payload,
- too many columns updated independently.

Mitigation:

- keep row small,
- separate large payload,
- cache safe reads,
- avoid frequent unnecessary writes,
- command serialization for hot aggregate,
- use event log for history.

Partition size is fine, but heat can still be problem.

---

## 40. Partition Sizing for Event Tables

Event table risks:

- rows accumulate,
- late events,
- large payload,
- large/hot cases,
- retention long,
- export needs full history.

Strategy:

- time bucket,
- version bucket,
- hash bucket for extreme write heat,
- separate payload to object storage if large,
- keep event row compact,
- source vs derived clear.

Choose bucket based on:

```text
events per entity per bucket
bytes per event
read latest/range pattern
retention/legal hold
```

---

## 41. Partition Sizing for Feed Tables

Feeds:

```text
notifications_by_user_day
timeline_by_user_day
inbox_by_user_day
```

Risks:

- celebrity/system user,
- fanout-on-write explosion,
- unread status updates/deletes,
- read receipts causing writes,
- TTL/tombstones.

Strategies:

- day bucket,
- hash bucket for hot users,
- cap fanout,
- digest/batch notifications,
- separate read status table,
- TTL aligned with day buckets,
- avoid giant collection.

---

## 42. Partition Sizing for Work Queues/Views

Work queue-like views:

```text
open_cases_by_assignee_day_bucket
```

Risks:

- team queues huge,
- deletes on close/reassign,
- priority/due date updates,
- hot head,
- many consumers polling.

Strategies:

- bucket by day/team/assignee,
- hash bucket if needed,
- rate limit polling,
- push notifications instead of polling,
- reconciliation,
- tolerate stale rows with validation against current state,
- avoid using ScyllaDB as broker.

---

## 43. Partition Sizing for Idempotency Tables

Idempotency:

```sql
PRIMARY KEY ((tenant_id, command_id))
WITH default_time_to_live = ...
```

Usually:

- high cardinality,
- small partitions,
- one row,
- TTL okay.

Risks:

- command_id not random/stable,
- hot command due to buggy retry loop,
- TTL too short,
- LWT contention if same command hammered,
- storing huge result payload.

Mitigation:

- command_id UUID/ULID generated once,
- retry budget,
- store compact result ref,
- monitor LWT contention/timeouts.

---

## 44. Choosing Partition Key: Decision Tree

Ask:

```text
1. What exact query?
2. What data must be read together?
3. Is the candidate key high-cardinality?
4. Can one key become huge?
5. Can one key become hot?
6. Is time dimension needed to bound growth?
7. Is hash bucket needed to spread heat?
8. What is read fanout after bucketing?
9. Can cursor handle buckets?
10. Are primary key components stable for retry?
11. Can derived row be deleted/rebuilt?
12. Does this still fit ScyllaDB?
```

If answer to 4 or 5 is yes, add bounding/bucketing or redesign.

---

## 45. Quantitative Design Example: Tenant Events

Requirement:

```text
store tenant operational events
read latest 100 by tenant
read events by tenant for one hour
largest tenant 50k writes/sec
row 1 KB
retention 30 days
```

### Option A

```sql
PRIMARY KEY (tenant_id, event_time, event_id)
```

Largest tenant per day:

```text
50k * 86400 = 4.32B rows/day
~4.32 TB/day
```

Impossible as one partition.

### Option B

```sql
PRIMARY KEY ((tenant_id, bucket_hour), event_time, event_id)
```

Per hour:

```text
50k * 3600 = 180M rows
~180 GB/hour
```

Still too large/hot.

### Option C

```sql
PRIMARY KEY ((tenant_id, bucket_hour, bucket_id), event_time, event_id)
```

Need target partition ~1 GB and 1000 writes/sec.

Size bucket count:

```text
180 GB/hour / 1 GB = 180
```

QPS bucket count:

```text
50k / 1000 = 50
```

Choose:

```text
bucket_count = 256
```

But latest 100 by tenant/hour needs 256 bucket fanout.

Conclusion:

```text
ScyllaDB can ingest if bucketed,
but interactive latest query needs special design.
```

Alternative:

- maintain separate `tenant_latest_events_by_tenant` top-N table,
- stream to OLAP/object storage for large range,
- tenant-specific architecture,
- product limits.

---

## 46. Quantitative Design Example: Case Events

Requirement:

```text
largest case = 2M events/year
row = 2 KB
read latest 100
read by month
```

### Month Bucket

Average worst month:

```text
2M / 12 ≈ 166k events/month
166k * 2 KB ≈ 332 MB
```

Potentially manageable if reads bounded and no huge tombstones.

If case burst:

```text
1M events in one month = 2 GB
```

Maybe too large.

### Version Bucket

Bucket size:

```text
50,000 events
```

Partition size:

```text
50k * 2 KB = 100 MB
```

Number buckets/year:

```text
2M / 50k = 40
```

Latest read:

```text
current version tells current bucket
query current bucket LIMIT 100
```

This may be better than time bucket for strict lifecycle event sequence.

---

## 47. Quantitative Design Example: Assignee Queue

Requirement:

```text
team queue has 200k open cases due today
row = 500 bytes
read top 50 by due_at
writes/updates = 500/sec
```

No hash bucket:

```text
partition size = 100 MB
write qps = 500/sec
```

Maybe size acceptable, QPS maybe okay, but read polling could be hot.

If 100 supervisors poll every 2 sec:

```text
50 read qps to same partition
```

Maybe acceptable. But if 10,000 agents:

```text
5,000 read qps
```

Need:

- cache top-N,
- push updates,
- bucket by team/assignee/day,
- reduce polling,
- hash bucket with merge,
- separate queue service.

Bucketing decision depends on read heat, not just row count.

---

## 48. Practical Bucket Count Guidelines

No universal numbers, but practical thinking:

```text
1-4 buckets:
  simple, low fanout, modest heat

8-16 buckets:
  common sweet spot for moderate hot keys

32-64 buckets:
  serious skew, read fanout complexity

128+ buckets:
  extreme ingestion; online reads need special design
```

If you need 256 buckets for one interactive query, step back:

```text
Should query be served from a different derived table?
Should latest top-N be precomputed?
Should this be stream/OLAP/object storage?
Is product query too broad?
```

---

## 49. Bucketing Pattern Catalog

### 49.1 Time Bucket

```text
(entity_id, bucket_day)
```

Use for bounded timeline.

### 49.2 Time + Hash Bucket

```text
(tenant_id, bucket_hour, bucket_id)
```

Use for high-write tenant events.

### 49.3 Version Bucket

```text
(case_id, version_bucket)
```

Use for ordered event log with sequence.

### 49.4 Semantic Bucket

```text
(team_id, due_day)
```

Use when query naturally includes dimension.

### 49.5 Tenant Adaptive Bucket

```text
(tenant_id, bucket_day, bucket_id)
```

with per-tenant bucket_count.

Use for severe skew.

### 49.6 Sharded Counter/Aggregate Bucket

```text
(counter_key, shard_id)
```

Use for distributed aggregate approximation/rollup, with read-sum fanout.

Be careful with exactness.

---

## 50. When Not to Bucket

Do not bucket when:

- table is one-row lookup,
- partition naturally bounded,
- write/read QPS per key low,
- read path requires single-key simplicity,
- bucket fanout would dominate latency,
- correctness/order would become too complex,
- external system better fits.

Example:

```text
case_current_by_id
command_idempotency_by_id
user_profile_by_id
```

These usually do not need bucket.

---

## 51. Adaptive Bucketing Architecture

If using adaptive bucketing:

### Config Table

```sql
CREATE TABLE tenant_bucket_config_by_id (
    tenant_id uuid PRIMARY KEY,
    event_bucket_count int,
    config_version int,
    effective_from timestamp,
    updated_at timestamp
);
```

### Write

```text
config = get config for tenant
bucket_id = hash(event_id) % config.event_bucket_count
write with config_version if needed
```

### Read

```text
determine config(s) for time range
query all buckets for relevant config versions
merge
```

### Problems

- config cache consistency,
- config changes at boundary,
- historical reads,
- idempotency if config changes mid-retry,
- operational complexity.

Safer:

```text
change bucket count only at time boundary
include bucket_epoch/time bucket
```

---

## 52. Monitoring Bucket Health

For bucketed table, monitor:

```text
rows per bucket
bytes per bucket
write QPS per bucket
read QPS per bucket
p99 per bucket group
fanout per request
merge rows fetched vs returned
timeouts by bucket
hottest tenant/bucket
bucket imbalance
```

If hash is good, buckets should be roughly even. If not:

- hash input skewed,
- bucket_id bug,
- bad modulo/config,
- semantic bucket skew,
- hot time window.

---

## 53. Application Backpressure for Hot Keys

Even perfect schema can face unexpected hot key.

Java service should include:

- per-tenant rate limit,
- per-key concurrency limit,
- bounded DB in-flight,
- retry budget,
- circuit breaker,
- request coalescing for same hot read,
- cache with explicit freshness,
- slow consumer protection.

Example:

```text
case_current_by_id for high-profile case
```

Use request coalescing:

```text
100 concurrent identical reads -> 1 DB read + shared result
```

if consistency requirements allow.

---

## 54. Read Cache and Hot Partitions

Caching can mitigate hot reads, not hot writes.

Use when:

- data read-heavy,
- freshness tolerance known,
- invalidation/update model clear,
- cache key includes tenant/security,
- stale data acceptable or version checked.

Do not use cache to hide wrong authoritative write model.

For current state:

```text
cache case_current for 1-5 seconds
or event-driven invalidate
```

if business accepts.

For regulatory transitions, command handler should still use authoritative read/write path.

---

## 55. Write Coalescing

For high-frequency updates to same logical entity:

Bad:

```text
update current counter/state 10,000/sec
```

Alternative:

- append events,
- aggregate asynchronously,
- coalesce updates in memory/stream,
- periodic snapshot,
- sharded counters,
- external stream processor.

ScyllaDB can write fast, but same partition/cell update at extreme rate is still problematic.

---

## 56. Large Payload Multiplier

Partition sizing must include payload.

If payload 20 KB instead of 1 KB, all estimates multiply.

Bad:

```text
store full JSON evidence/event body in every derived table
```

Better:

- keep source payload in event table if bounded,
- derived tables store summary fields only,
- large documents in object storage,
- store hash/reference.

Denormalization multiplies payload cost.

---

## 57. Tombstone Multiplier

Deletes/TTL increase effective read cost.

Partition with:

```text
100 live rows
1,000,000 tombstones
```

can be worse than partition with:

```text
100,000 live rows
few tombstones
```

Sizing should include:

```text
tombstones_per_partition_per_window
delete_rate
TTL expiry clustering
```

Work queues and derived status views are especially vulnerable.

---

## 58. Capacity Planning Relationship

Partition design affects:

- storage per node,
- write amplification,
- read amplification,
- compaction,
- repair,
- cache,
- tablet movement,
- shard balance.

Cluster capacity estimate without partition distribution is incomplete.

Need:

```text
total data
RF
compression
space amplification
plus distribution: hottest partitions/tablets/shards
```

---

## 59. Design Review Checklist

For each table:

```text
[ ] Partition key cardinality estimated.
[ ] Largest partition estimated.
[ ] Hottest partition QPS estimated.
[ ] Rows per partition estimated.
[ ] Bytes per partition estimated.
[ ] Tombstone rate estimated.
[ ] Time bucket size justified.
[ ] Hash bucket count justified.
[ ] Read fanout bounded.
[ ] Cursor design supports fanout.
[ ] Bucket key stable across retry.
[ ] Old bucket key available for delete.
[ ] Bucket count change strategy exists.
[ ] Per-bucket metrics planned.
[ ] Hot key mitigation exists.
[ ] Table still fits ScyllaDB access model.
```

---

## 60. Common Misconceptions

### Misconception 1: “High cardinality means safe.”

No. High-cardinality key can still be hot due to skew.

### Misconception 2: “Large cluster fixes hot partition.”

No. One partition maps to limited replica/shard path.

### Misconception 3: “Bucketing is always good.”

No. Bucketing increases read fanout, merge cost, cursor complexity.

### Misconception 4: “LIMIT protects from large partition.”

Not fully. Query may still scan tombstones/ranges/SSTables.

### Misconception 5: “Time bucket by day is always right.”

Depends on write rate and read window.

### Misconception 6: “Random bucket is fine.”

Only if bucket id is stable/recoverable for retry/read/delete.

### Misconception 7: “Average partition size matters most.”

P99/max partition size and hottest QPS matter more.

### Misconception 8: “Balanced disk means balanced traffic.”

No. Heat distribution can differ from size distribution.

---

## 61. Mental Model Compression

Remember:

```text
Good partition key =
  enough locality for reads
  enough distribution for writes
  bounded size over retention
  bounded heat under skew
```

Bucketing is the controlled act of trading:

```text
write distribution and bounded partitions
```

for:

```text
read fanout and merge complexity
```

Do this deliberately, with math.

---

## 62. Summary

Partition sizing and hot partition prevention are central to production ScyllaDB design.

Key lessons:

1. Cardinality, partition size, and heat are separate risks.
2. Cluster scale does not fix one hot partition.
3. Estimate rows, bytes, and QPS per partition.
4. Design for p99/max keys, not average.
5. Time bucketing bounds growth by time.
6. Hash bucketing spreads hot logical keys.
7. Bucket count must satisfy both size and QPS constraints.
8. Large bucket counts create read fanout and p99 risk.
9. Version bucketing can be better for ordered event logs.
10. Adaptive bucketing handles skew but adds complexity.
11. Bucket keys must be stable for idempotency.
12. Derived table cleanup requires old bucket keys.
13. Large payloads and tombstones multiply cost.
14. Hot partition, hot tablet, hot shard, and hot node are different.
15. Java services need per-key backpressure and fanout control.
16. Some queries belong to search/OLAP/batch systems, not ScyllaDB OLTP tables.

---

## 63. Review Questions

1. Apa beda cardinality, partition size, dan heat?
2. Kenapa high cardinality tidak selalu aman?
3. Kenapa cluster besar tidak memperbaiki hot partition?
4. Bagaimana menghitung rows per partition?
5. Bagaimana menghitung bytes per partition?
6. Bagaimana menghitung QPS per partition?
7. Kapan time bucket dibutuhkan?
8. Kapan hash bucket dibutuhkan?
9. Apa trade-off bucket_count besar?
10. Kenapa read fanout menaikkan p99?
11. Apa formula kasar probabilitas fanout terkena tail latency?
12. Apa risiko changing bucket_count?
13. Kenapa bucket_id harus stable?
14. Apa bedanya hot partition dan hot shard?
15. Bagaimana mendeteksi hot key di aplikasi?
16. Kenapa status sebagai partition key buruk?
17. Kapan version bucket lebih baik dari time bucket?
18. Bagaimana tombstone memengaruhi partition sizing?
19. Bagaimana derived table cleanup terkait bucket?
20. Kapan workload sebaiknya dipindah ke search/OLAP/batch?

---

## 64. Practical Exercise

Ambil tiga workload berikut dan desain partition/bucketing:

### Workload A — Case Events

```text
largest case: 5M events/year
row size: 1.5 KB
read latest 100
read by month
audit order important
```

Tentukan:

```text
time bucket or version bucket?
partition key?
clustering key?
expected partition size?
read fanout?
```

### Workload B — Tenant Events

```text
largest tenant: 80k writes/sec
row size: 800 bytes
read latest 100 for tenant
read last hour for export
```

Tentukan:

```text
time bucket?
hash bucket count?
online read design?
should top-N table exist?
```

### Workload C — Open Case Queue

```text
largest team: 300k open cases due today
row size: 600 bytes
1000 users poll every 5 seconds
sort by due_at
case close/reassign creates deletes
```

Tentukan:

```text
partition key?
bucket count?
read fanout?
cache/push strategy?
tombstone mitigation?
reconciliation strategy?
```

---

## 65. Preview Part 011

Part berikutnya membahas time-series modeling di ScyllaDB:

```text
time buckets
event time vs write time
latest-N reads
range reads
TTL-heavy workloads
late arrivals
out-of-order writes
retention
TWCS/compaction implications
device/user/tenant timelines
```

Part 010 memberi quantitative tools untuk partition sizing.

Part 011 menerapkan tools ini pada time-series dan timeline workloads secara mendalam.

---

# End of Part 010


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Query-First Data Modeling: Dari User Journey ke Table Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-011.md">Part 011 — Time-Series Modeling di ScyllaDB ➡️</a>
</div>

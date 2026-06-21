# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-008.md

# Part 008 — Primary Key Design: Partition Key, Clustering Key, dan Physical Query Shape

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `008`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: menguasai desain primary key sebagai kontrak distribusi, locality, ordering, query shape, partition sizing, dan latency.

---

## 0. Posisi Part Ini dalam Seri

Di part 007 kita membahas CQL:

```text
keyspace
table
types
primary key syntax
INSERT/UPDATE/DELETE/SELECT
TTL
timestamp
schema agreement
```

Part ini memperdalam satu topik paling penting:

```text
PRIMARY KEY
```

Di SQL, primary key sering dipahami sebagai:

```text
unique identifier row
```

Di ScyllaDB/Cassandra-style wide-column store, primary key adalah jauh lebih penting:

```text
PRIMARY KEY =
  distribution contract
  locality contract
  ordering contract
  query contract
  scalability contract
  failure blast-radius contract
```

Jika primary key salah, hampir semua hal lain ikut salah:

- query tidak bisa dijalankan efisien,
- partition terlalu besar,
- shard/node panas,
- read path mahal,
- tombstone scan meningkat,
- repair/compaction berat,
- Java repository jadi penuh workaround,
- `ALLOW FILTERING` muncul,
- fanout tidak terkendali,
- sistem terlihat “ScyllaDB lambat” padahal data model salah.

Part ini adalah fondasi untuk part 009 query-first data modeling.

---

## 1. Primary Key Bukan Sekadar Uniqueness

Contoh:

```sql
CREATE TABLE case_events_by_case_month (
    case_id uuid,
    bucket_month text,
    event_time timestamp,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
);
```

Primary key terdiri dari:

```text
partition key = (case_id, bucket_month)
clustering key = (event_time, event_id)
```

Primary key menentukan:

```text
1. data disimpan di partition mana
2. partition dipetakan ke token mana
3. token dipetakan ke tablet/range mana
4. replica node mana yang menyimpan data
5. shard mana yang melayani data
6. urutan rows di dalam partition
7. query mana yang valid dan efisien
8. uniqueness row dalam partition
```

Jadi:

```text
Primary key is a physical design decision.
```

---

## 2. Anatomy of CQL Primary Key

Ada tiga bentuk dasar.

### 2.1 Simple Primary Key

```sql
CREATE TABLE users_by_id (
    user_id uuid PRIMARY KEY,
    email text,
    display_name text
);
```

Makna:

```text
partition key = user_id
clustering key = none
```

Satu partition biasanya satu row.

Cocok:

```text
lookup by id
```

Tidak cocok:

```text
lookup by email
list users by role
list users by signup date
```

Untuk itu butuh table lain/index/model lain.

---

### 2.2 Composite Primary Key

```sql
CREATE TABLE events_by_case (
    case_id uuid,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY (case_id, event_time, event_id)
);
```

Makna:

```text
partition key = case_id
clustering key = event_time, event_id
```

Karena hanya elemen pertama yang menjadi partition key jika tidak ada double parentheses.

Semua event untuk satu case berada dalam satu partition.

Ini bagus jika:

```text
case event count bounded
case traffic tidak terlalu hot
read events by case
```

Buruk jika:

```text
case bisa memiliki jutaan event
case bisa sangat hot
retention panjang
query hanya latest N tapi partition membengkak tanpa batas
```

---

### 2.3 Composite Partition Key

```sql
CREATE TABLE events_by_case_month (
    case_id uuid,
    bucket_month text,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
);
```

Makna:

```text
partition key = case_id + bucket_month
clustering key = event_time + event_id
```

Double parentheses sangat penting.

Tujuan:

```text
split one logical case timeline into monthly partitions
```

Trade-off:

```text
read one month = one partition
read latest across months = maybe query current month then previous month
read full history = fanout over months
```

---

## 3. Parentheses Rule

Ini kesalahan paling mahal.

```sql
PRIMARY KEY (tenant_id, bucket_day, created_at)
```

Makna sebenarnya:

```text
partition key = tenant_id
clustering key = bucket_day, created_at
```

Jika tenant besar:

```text
one tenant -> one huge partition
```

Yang mungkin kamu maksud:

```sql
PRIMARY KEY ((tenant_id, bucket_day), created_at)
```

Makna:

```text
partition key = tenant_id + bucket_day
clustering key = created_at
```

Atau jika tenant sangat hot:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, event_id)
```

Makna:

```text
partition key = tenant_id + bucket_day + bucket_id
clustering key = created_at + event_id
```

Rule:

```text
No parentheses around multiple columns:
  first column only = partition key

Double parentheses:
  all columns inside inner parentheses = composite partition key
```

---

## 4. Partition Key: Distribution and Locality

Partition key menentukan distribusi fisik.

Pipeline:

```text
partition key values
  -> serialized routing key
  -> hash/token
  -> tablet/token range
  -> replica nodes
  -> shard/core
```

Good partition key harus menyeimbangkan dua kebutuhan yang sering bertentangan:

```text
locality:
  data yang dibaca bersama sebaiknya berada bersama

distribution:
  data/traffic harus tersebar agar cluster/shards tidak hot
```

Contoh locality bagus tapi distribution buruk:

```sql
PRIMARY KEY (tenant_id, created_at)
```

Semua data tenant bersama. Tapi tenant besar hot.

Contoh distribution bagus tapi locality buruk:

```sql
PRIMARY KEY (random_uuid, created_at)
```

Data tersebar. Tapi query by tenant/case/user sulit.

Desain yang baik biasanya kompromi:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, event_id)
```

Locality:

```text
tenant + day + bucket
```

Distribution:

```text
many buckets and days
```

Cost:

```text
read by tenant/day must query N buckets and merge
```

---

## 5. Clustering Key: Ordering Inside Partition

Clustering key menentukan urutan row di dalam partition.

Example:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC);
```

Rows inside partition sorted by:

```text
event_time DESC
event_id ASC
```

This supports:

```sql
SELECT *
FROM case_events_by_case_month
WHERE case_id = ?
  AND bucket_month = ?
LIMIT 100;
```

Latest 100 can be efficient because latest rows are at beginning of clustering order.

### 5.1 Clustering Key Is Not Distribution

Changing clustering key does not distribute data across nodes.

```text
partition key controls distribution
clustering key controls order within partition
```

Bad assumption:

```text
Adding timestamp clustering key will distribute writes.
```

No. If partition key is `tenant_id`, all writes for same tenant still target same partition path.

---

## 6. Primary Key and Uniqueness

Full primary key uniquely identifies row.

Given:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
```

Uniqueness boundary:

```text
case_id + bucket_month + event_time + event_id
```

Rows with same full primary key overwrite/update same logical row.

This is useful for idempotency.

If retry uses same full primary key, repeated mutation targets same row.

Bad event append:

```text
event_id generated newly on every retry
```

Good event append:

```text
event_id derived from command_id or stable event identity
```

---

## 7. Primary Key and Idempotency

A primary key can make writes idempotent.

Example:

```sql
CREATE TABLE case_events_by_case_month (
    case_id uuid,
    bucket_month text,
    event_id uuid,
    event_time timestamp,
    event_type text,
    payload text,
    PRIMARY KEY ((case_id, bucket_month), event_id)
);
```

If `event_id` is stable, retry writes same row.

But if ordering by event_time is needed, use:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
```

Then event_time must also be stable across retry, or full key changes.

Better for strict event sequence:

```sql
PRIMARY KEY ((case_id, bucket_month), event_version, event_id)
```

Where `event_version` comes from a state transition protocol.

Design question:

```text
Which fields are stable across retry?
```

If a key component changes on retry, idempotency breaks.

---

## 8. Query Validity Rule: Full Partition Key First

Efficient query must specify full partition key.

Given:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, event_id)
```

Good:

```sql
WHERE tenant_id = ?
  AND bucket_day = ?
  AND bucket_id = ?
```

Bad:

```sql
WHERE tenant_id = ?
  AND bucket_day = ?
```

because partition key incomplete.

Why?

Because token is computed from full composite partition key.

```text
hash(tenant_id, bucket_day, bucket_id)
```

Without `bucket_id`, database cannot identify one partition/token. It would need many partitions.

---

## 9. Query Validity Rule: Clustering Columns in Order

Given:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
```

Good:

```sql
WHERE case_id = ?
  AND bucket_month = ?
  AND event_time = ?
```

Good range:

```sql
WHERE case_id = ?
  AND bucket_month = ?
  AND event_time >= ?
  AND event_time < ?
```

Bad:

```sql
WHERE case_id = ?
  AND bucket_month = ?
  AND event_id = ?
```

because it skips `event_time`.

Clustering columns are like ordered path:

```text
event_time -> event_id
```

You cannot efficiently jump to second clustering component without constraining earlier one.

---

## 10. Equality Before Range

Given:

```sql
PRIMARY KEY ((entity_id, bucket_day), category, created_at, event_id)
```

Valid:

```sql
WHERE entity_id = ?
  AND bucket_day = ?
  AND category = ?
  AND created_at >= ?
  AND created_at < ?
```

Here:

```text
category equality
created_at range
```

After range on `created_at`, you generally cannot further restrict later clustering columns arbitrarily unless specific rules allow.

Bad expectation:

```sql
WHERE entity_id = ?
  AND bucket_day = ?
  AND created_at >= ?
  AND event_id = ?
```

because it skips `category`.

Rule:

```text
clustering restrictions follow declared order;
equality restrictions first;
range usually ends efficient narrowing.
```

---

## 11. Physical Query Shape

Every query has physical shape.

Example:

```sql
SELECT *
FROM events_by_case_month
WHERE case_id = ?
  AND bucket_month = ?
  AND event_time >= ?
  AND event_time < ?
LIMIT 100;
```

Physical shape:

```text
one partition
bounded clustering range
limited rows
ordered read
```

Good.

Example:

```sql
SELECT *
FROM events_by_case_month
WHERE case_id = ?
  AND event_time >= ?
```

Physical shape:

```text
missing bucket_month
cannot identify partition
invalid or requires bad filtering/model
```

Example:

```sql
SELECT *
FROM open_cases_by_assignee_day_bucket
WHERE assignee_id = ?
  AND bucket_day = ?
  AND bucket_id = ?
LIMIT 50;
```

Physical shape:

```text
one assignee/day/bucket partition
first 50 rows by clustering order
```

If application queries all buckets:

```text
N partition reads
client-side merge
bounded fanout if N small and explicit
```

---

## 12. Single-Partition Query

Single-partition query is the ideal OLTP query shape.

```text
full partition key equality
optional clustering restrictions
bounded result
```

Examples:

```sql
SELECT status, version
FROM case_current_by_id
WHERE case_id = ?;
```

```sql
SELECT *
FROM notifications_by_user_day
WHERE user_id = ?
  AND bucket_day = ?
LIMIT 50;
```

Benefits:

- known token,
- known replica set,
- token/shard-aware routing,
- predictable latency,
- bounded storage work if partition healthy.

But:

```text
single partition is not automatically cheap if partition huge/tombstone-heavy.
```

---

## 13. Multi-Partition Query

Multi-partition query means application intentionally queries several partition keys.

Example bucketed read:

```text
bucket_id in [0..15]
```

Application issues 16 queries:

```sql
WHERE tenant_id = ?
  AND bucket_day = ?
  AND bucket_id = ?
```

Then merges results.

This can be acceptable if:

- fanout is bounded,
- each partition read is small,
- concurrency is controlled,
- final result limit exists,
- p99 budget accounts for fanout,
- retry/backpressure safe.

Danger:

```text
dynamic/unbounded fanout based on user input
```

Bad:

```text
for each case in 10,000 cases:
  query events_by_case
```

This creates database amplification.

---

## 14. IN Queries

CQL supports `IN` in some contexts.

Example:

```sql
WHERE case_id IN (?, ?, ?)
```

or clustering `IN` depending schema.

But `IN` can become hidden fanout.

Small bounded `IN` may be fine:

```text
3 known keys
```

Large `IN` is dangerous:

```text
5000 keys
```

Prefer explicit bounded concurrency and observability in Java rather than hiding large fanout inside one query.

Rule:

```text
IN is not a join.
IN is not a bulk query strategy for large sets.
```

---

## 15. Token Queries

CQL can query token ranges in some cases:

```sql
WHERE token(partition_key) > ?
```

This is usually for:

- administrative scan,
- analytics/export,
- repair-like tooling,
- controlled batch jobs.

Do not use token range queries for online API unless you deeply understand impact.

Online APIs should usually be access-pattern/partition-key based.

---

## 16. Partition Size

Partition size is one of the most important design constraints.

Partition too small?

- many tiny partitions,
- overhead per partition,
- maybe less locality,
- more queries for range.

Partition too large?

- read amplification,
- repair cost,
- compaction cost,
- tombstone cost,
- hot shard,
- cache inefficiency,
- pagination pain.

Healthy partition size depends on workload, but principle:

```text
bounded and predictable beats unbounded.
```

### 16.1 Estimate Partition Size

Formula:

```text
partition_size ≈ rows_per_partition * average_row_size
```

Example:

```text
case events:
average event row = 2 KB
events per case per month = 10,000

partition size ≈ 20 MB
```

Maybe okay depending read pattern.

But:

```text
large investigation:
events per case per month = 2,000,000
row = 2 KB

partition size ≈ 4 GB
```

Likely bad.

Need additional bucket:

```text
case_id + bucket_month + bucket_id
```

---

## 17. Rows Per Partition

Rows per partition matters, not only bytes.

A partition with millions of tiny rows can still hurt:

- indexes,
- tombstones,
- clustering scan,
- pagination,
- repair,
- memory during reads.

Estimate:

```text
rows_per_partition =
  write_rate_per_partition * retention_window
```

Example:

```text
device events:
100 events/sec/device
bucket = 1 day

rows = 100 * 86400 = 8,640,000 rows/day/device
```

Too many.

Use smaller bucket:

```text
device_id + bucket_hour
```

Rows:

```text
100 * 3600 = 360,000 rows/hour/device
```

Maybe still large depending row size/read.

Maybe use:

```text
device_id + bucket_hour + bucket_id
```

if writes are hot.

---

## 18. Hot Partition

Hot partition means high QPS for one partition key.

Even if partition is small, it can be hot.

Example:

```text
session_by_user where user_id = celebrity
notification feed for one huge group
tenant_id = largest customer
global queue partition
```

Hot partition causes:

- one token/tablet path hot,
- one replica set hot,
- one shard hot,
- p99 spikes for affected key,
- cluster average may look fine.

### 18.1 Hot Partition Estimate

Estimate:

```text
partition_qps = total_qps * fraction_for_key
```

If total QPS 100k and one tenant receives 40%:

```text
tenant partition QPS = 40k
```

If partition key is tenant_id, bad.

If bucketed into 40 buckets:

```text
~1k QPS per bucket
```

Assuming distribution is even.

---

## 19. Low Cardinality Partition Key

Bad partition key:

```text
status
```

Values:

```text
OPEN
CLOSED
PENDING
REJECTED
```

Only a few partitions.

Bad:

```sql
CREATE TABLE cases_by_status (
    status text,
    updated_at timestamp,
    case_id uuid,
    PRIMARY KEY (status, updated_at, case_id)
);
```

`OPEN` may become huge/hot.

Better:

```sql
CREATE TABLE cases_by_status_day_bucket (
    status text,
    bucket_day date,
    bucket_id int,
    updated_at timestamp,
    case_id uuid,
    PRIMARY KEY ((status, bucket_day, bucket_id), updated_at, case_id)
);
```

Now partition key cardinality:

```text
status * days * bucket_count
```

Still must manage read fanout.

---

## 20. Time Bucketing

Time bucketing splits data by time window.

Examples:

```text
user_id + day
device_id + hour
case_id + month
tenant_id + day
```

Good for:

- time-series,
- event logs,
- retention,
- latest/range reads,
- TTL alignment,
- compaction strategy.

Bucket size trade-off:

| Bucket Too Large | Bucket Too Small |
|---|---|
| large partitions | many queries for range |
| hot partitions | more metadata |
| tombstone-heavy windows | more fanout |
| slow repair/compaction | harder pagination |

Choose based on:

- write rate,
- read range,
- retention,
- partition size target,
- latest query behavior,
- tenant skew.

---

## 21. Hash Bucketing

Hash bucketing splits hot logical key into multiple partitions.

Example:

```text
bucket_id = hash(event_id) % N
```

Table:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, event_id)
```

Write:

```text
choose bucket_id by stable hash
```

Read tenant/day:

```text
query all bucket_id 0..N-1
merge
```

Good:

- spreads writes,
- reduces hot partition,
- distributes across tokens/shards.

Cost:

- read fanout,
- merge/sort complexity,
- pagination complexity,
- changing N is hard,
- per-bucket ordering not global.

---

## 22. Semantic Bucketing

Instead of random hash, bucket by domain dimension.

Examples:

```text
tenant_id + region + day
assignee_id + team_id + day
case_id + event_type + month
merchant_id + payment_method + hour
```

Good if queries naturally include bucket dimension.

Danger if bucket dimension has skew:

```text
event_type = COMMON
region = JAKARTA
team_id = DEFAULT
```

Semantic bucket must be evaluated for cardinality and heat.

---

## 23. Adaptive Bucketing

Some systems need variable bucket count per tenant/entity.

Example:

```text
small tenant: bucket_count = 1
medium tenant: bucket_count = 8
large tenant: bucket_count = 64
```

This reduces read fanout for small tenants and spreads load for large tenants.

Requires metadata:

```sql
tenant_bucket_config_by_id (
    tenant_id,
    bucket_count,
    updated_at
)
```

Write path:

```text
bucket_id = hash(event_id) % bucket_count
```

Read path:

```text
read bucket_count from config
query all buckets
```

Challenges:

- changing bucket_count over time,
- historical data with old count,
- config consistency,
- deployment coordination,
- read fanout grows for hot tenants,
- pagination across changing buckets.

A robust design may include bucket version:

```text
tenant_id + bucket_epoch + bucket_day + bucket_id
```

But complexity rises.

---

## 24. Clustering Key Order Design

Clustering order should match query order.

### 24.1 Latest First

Use:

```sql
WITH CLUSTERING ORDER BY (created_at DESC, event_id ASC)
```

For:

```text
latest N
```

### 24.2 Oldest First

Use default ASC for:

```text
process from oldest to newest
audit chronological display
replay event log
```

### 24.3 Priority Queue-Like View

```sql
PRIMARY KEY ((assignee_id, bucket_day, bucket_id), priority, due_at, case_id)
WITH CLUSTERING ORDER BY (priority DESC, due_at ASC, case_id ASC)
```

Caution:

```text
ScyllaDB is not a queue engine.
Frequent delete/update from ordered head can create tombstones.
```

Use for serving view, not high-churn queue semantics without design.

---

## 25. Tie-Breaker Columns

Always include tie-breaker if clustering value can collide.

Bad:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time)
```

If two events share same timestamp, they overwrite/conflict.

Better:

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
```

or:

```sql
PRIMARY KEY ((case_id, bucket_month), event_version)
```

Tie-breaker options:

- UUID,
- timeuuid,
- sequence/version,
- command_id,
- monotonic counter from command handler.

For strict order, do not rely only on millisecond timestamp.

---

## 26. Timestamp as Clustering Key

Timestamp clustering is common.

Pros:

- natural time range query,
- latest-N query,
- retention/bucket alignment,
- intuitive.

Cons:

- collision risk,
- clock skew,
- out-of-order arrivals,
- event time vs write time ambiguity,
- late events inserted into old range,
- strict ordering not guaranteed.

If business sequence matters:

```text
use event_version or sequence
```

If display order matters:

```text
event_time + event_id may be fine
```

---

## 27. UUID and TimeUUID as Clustering

`timeuuid` can encode time and uniqueness.

Useful for:

- event streams,
- ordering by generation time,
- uniqueness.

But:

- generation clock matters,
- not same as business version,
- late/replayed events may be tricky,
- cross-service ordering still not absolute.

A common safe pattern:

```sql
event_time timestamp,
event_id uuid
```

or:

```sql
event_version bigint,
event_id uuid
```

Choose based on whether ordering is business-logical or observational.

---

## 28. Primary Key and Pagination

Pagination within partition follows clustering order.

Good:

```text
partition key fixed
clustering order stable
page through clustering rows
```

Problems:

- concurrent writes can appear between pages,
- deletes/tombstones can affect page work,
- large partitions make deep pagination expensive,
- bucketed reads require multi-partition pagination.

For interactive APIs:

```text
prefer cursor based on last seen clustering key
```

Example cursor:

```text
last_event_time
last_event_id
bucket_month
```

Avoid offset pagination.

Offset pagination requires skipping rows and is bad in distributed storage.

---

## 29. Primary Key and Sorting

ScyllaDB sorting is pre-modeled.

If UI needs:

```text
sort by due_at
```

then clustering key should include `due_at`.

If UI also needs:

```text
sort by priority
```

you may need a separate table:

```text
cases_by_assignee_due_date
cases_by_assignee_priority
```

or choose one primary sort and handle secondary sort in bounded result.

Do not expect arbitrary runtime `ORDER BY` like SQL.

---

## 30. Primary Key and Filtering

If a column is not part of primary key/index/view, filtering by it is not efficient.

Example:

```sql
CREATE TABLE cases_by_assignee (
    assignee_id uuid,
    due_at timestamp,
    case_id uuid,
    status text,
    priority int,
    PRIMARY KEY (assignee_id, due_at, case_id)
);
```

Query:

```sql
WHERE assignee_id = ?
  AND status = 'OPEN'
```

Not naturally efficient because `status` is regular column.

Options:

1. Include status in partition key:

```sql
PRIMARY KEY ((assignee_id, status, bucket_day), due_at, case_id)
```

2. Include status as clustering before due_at:

```sql
PRIMARY KEY (assignee_id, status, due_at, case_id)
```

But partition key remains assignee only unless parentheses adjusted.

3. Create separate table:

```text
open_cases_by_assignee_day_bucket
```

4. Use index if appropriate and bounded.

Each option changes physical query shape.

---

## 31. Primary Key and State Changes

Derived tables with state in primary key require delete/insert on state change.

Example:

```sql
open_cases_by_assignee_day_bucket
```

When case closes:

```text
delete old open view row
update current table
append event
```

Delete creates tombstone.

If cases change status often, derived status tables can become tombstone-heavy.

Design mitigation:

- keep current-state table authoritative,
- use derived view only where needed,
- bucket partitions,
- use reconciliation job,
- avoid high-churn queue-like deletes,
- maybe include status as regular column and tolerate stale rows filtered after bounded read, if safe.

---

## 32. Primary Key and TTL

TTL-heavy table should align key with expiration pattern.

Good:

```text
sessions_by_token
short TTL
read by token
small rows
```

Good time bucket:

```text
login_attempts_by_user_day
TTL 7 days
partition by user/day
```

Bad:

```text
large mixed table where some rows expire randomly and queries scan across expired rows
```

TTL creates tombstones, so primary key should avoid scanning expired/tombstoned ranges.

---

## 33. Primary Key and Repair/Compaction

Bad primary key can worsen operational cost.

Large partition:

- expensive repair,
- expensive compaction,
- difficult streaming,
- cache poor.

Hot partition:

- uneven compaction,
- hot shard,
- localized pressure.

Tombstone-heavy clustering range:

- read latency,
- compaction backlog.

Good primary key helps operations, not only queries.

---

## 34. Primary Key and Multi-DC

In multi-DC, partition key also determines which replicas in each DC own data.

If active-active writes occur to same partition from multiple DCs, conflict risk rises.

Design questions:

```text
Can same partition be written from multiple regions?
Is there an owner region?
Is partition key including region/tenant ownership?
Are reads local?
What consistency level?
What conflict resolution?
```

Example:

```text
case_id assigned to home_region
writes routed to home_region
replicated to others for read
```

You may include region/tenant in partition key only if query model supports it.

---

## 35. Primary Key and Authorization/Tenancy

Multi-tenant tables often include tenant_id.

Question:

```text
Should tenant_id be in partition key?
```

Often yes for isolation/query locality.

But tenant_id alone may be hot.

Pattern:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, entity_id)
```

Authorization concern:

```text
Every query must include tenant_id from authenticated context,
not from user-controlled arbitrary input.
```

Java repository should enforce tenant-aware access:

```java
findEvents(TenantId tenantId, LocalDate day, int bucketId, ...)
```

not:

```java
findEvents(Filter filter)
```

---

## 36. Primary Key and Data Residency

If certain tenants/data must stay in certain region, partitioning alone is not enough. Placement is controlled by keyspace replication/topology and deployment. But key design can help route writes/reads by ownership.

Example:

```text
tenant_home_region_by_id
```

Application:

```text
route tenant writes to home region
use local keyspace/DC policy
```

Do not assume adding `region` to partition key enforces physical residency by itself.

Residency is architecture + topology + routing + policy.

---

## 37. Primary Key and Java Repository Design

Repository methods should mirror primary key shape.

Table:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, event_id)
```

Good method:

```java
List<TenantEvent> findEventsByTenantDayBucket(
    TenantId tenantId,
    LocalDate bucketDay,
    int bucketId,
    Instant from,
    Instant to,
    int limit
);
```

Bad method:

```java
List<TenantEvent> searchEvents(EventSearchFilter filter);
```

The bad method hides whether partition key is complete.

Repository naming should reveal:

- partition key,
- clustering range,
- limit,
- consistency,
- source/derived semantics.

---

## 38. Primary Key and Service API Design

Sometimes product API must change to fit scalable data model.

Bad API:

```http
GET /events?tenantId=T&from=2026-01-01&to=2026-12-31&sort=any&filter=any
```

This invites unbounded scan.

Better:

```http
GET /tenants/{tenantId}/events?day=2026-01-01&cursor=...&limit=100
```

or for export:

```http
POST /exports/tenant-events
```

as async job with batch path.

Not every UI filter should be online OLTP query.

---

## 39. Primary Key and Access Pattern Matrix

Before table design, create matrix.

Example:

| Access Pattern | Partition Key | Clustering | Limit | Source/Derived |
|---|---|---|---:|---|
| Read case current | case_id | none | 1 | source/snapshot |
| Append event | case_id + month | event_version | 1 write | source |
| Latest events | case_id + month | event_version DESC | 100 | source |
| Open cases by assignee | assignee + day + bucket | due_at | 50 | derived |
| Idempotency key | command_id | none | 1 | source/guard |

This matrix exposes whether table primary keys match queries.

---

## 40. Physical Design Worksheet

For every table, fill:

```text
Table name:
Access pattern:
Source or derived:
Partition key:
Clustering key:
Clustering order:
Expected rows per partition:
Expected bytes per row:
Expected partition size:
Expected write QPS per partition:
Expected read QPS per partition:
Expected hottest key:
TTL/delete behavior:
Read CL:
Write CL:
Retry safety:
Fanout count:
Page size:
Rebuild path:
Monitoring:
```

If you cannot fill this, the table is not ready.

---

## 41. Example: Event Log Design Iterations

Requirement:

```text
append case events
read latest 100 events by case
read events for a time range
cases can be normal or huge investigations
```

### 41.1 Version 1

```sql
PRIMARY KEY (case_id, event_time, event_id)
```

Pros:

- simple,
- read by case,
- ordered by time.

Cons:

- unbounded partition,
- huge investigations bad,
- retention hard.

### 41.2 Version 2

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
```

Pros:

- bounded by month,
- time range easier,
- latest query can check current month then previous.

Cons:

- huge case within one month still large/hot,
- latest across months needs logic.

### 41.3 Version 3

```sql
PRIMARY KEY ((case_id, bucket_month, bucket_id), event_time, event_id)
```

Pros:

- spreads huge case writes,
- controls hot partitions.

Cons:

- latest 100 needs query multiple buckets and merge,
- pagination harder,
- ordering global across buckets is app responsibility.

### 41.4 Decision

If huge investigation cases are rare but extreme, maybe use adaptive strategy:

- normal cases: no hash bucket,
- huge cases: bucketed table or bucket config,
- or always bucket with small N.

But complexity must be justified.

---

## 42. Example: Current State Design

Requirement:

```text
read current case by id
update state transition
```

Table:

```sql
CREATE TABLE case_current_by_id (
    case_id uuid PRIMARY KEY,
    status text,
    version bigint,
    assignee_id uuid,
    updated_at timestamp,
    last_event_id uuid
);
```

Primary key:

```text
case_id
```

Good:

- one row lookup,
- small row,
- high cardinality.

Risk:

- frequent updates to same case hot if case has many concurrent workflows,
- correctness race if state transition not guarded.

For transition correctness:

```sql
UPDATE case_current_by_id
SET status = ?, version = ?, updated_at = ?, last_event_id = ?
WHERE case_id = ?
IF status = ? AND version = ?;
```

Primary key supports locality, but LWT/application protocol supports invariant.

---

## 43. Example: Open Cases by Assignee

Requirement:

```text
list open cases assigned to user/team sorted by due date
```

Naive:

```sql
PRIMARY KEY (assignee_id, due_at, case_id)
```

If assignee can have huge queue:

```text
large/hot partition
```

Better:

```sql
PRIMARY KEY ((assignee_id, bucket_day, bucket_id), due_at, case_id)
```

But query all open cases for assignee:

```text
needs day/bucket fanout
```

Maybe product actually needs:

```text
open cases due today/this week
```

Then bucket_day is natural.

If product needs global unbounded assignee backlog, use pagination by day windows and/or search/index platform depending query needs.

---

## 44. Example: Idempotency Key

Requirement:

```text
check command_id duplicate
```

Table:

```sql
CREATE TABLE command_idempotency_by_id (
    command_id uuid PRIMARY KEY,
    entity_id uuid,
    command_type text,
    created_at timestamp,
    result_status text
) WITH default_time_to_live = 86400;
```

Primary key:

```text
command_id
```

Good:

- high cardinality,
- one lookup/insert,
- small row,
- TTL bounded.

Strict first insert:

```sql
INSERT ... IF NOT EXISTS;
```

Risk:

- LWT cost,
- command_id reuse after TTL,
- timeout ambiguity,
- hot command unlikely unless buggy client.

---

## 45. Example: Notification Feed

Requirement:

```text
read latest notifications by user
write notification events
some users can be very active
```

Version 1:

```sql
PRIMARY KEY (user_id, created_at, notification_id)
```

Good for normal users.

Risk:

```text
celebrity/admin/system user hot
unbounded partition
```

Version 2:

```sql
PRIMARY KEY ((user_id, bucket_day), created_at, notification_id)
WITH CLUSTERING ORDER BY (created_at DESC, notification_id ASC)
```

Better bounded by day.

If still hot:

```sql
PRIMARY KEY ((user_id, bucket_day, bucket_id), created_at, notification_id)
```

Read latest:

```text
query today's buckets
merge
if not enough, query previous day
```

Need cursor that includes:

```text
bucket_day
bucket_id progress
created_at
notification_id
```

---

## 46. Choosing Bucket Granularity

Use estimate.

Inputs:

```text
write_rate_per_entity
row_size
retention_per_partition
target_max_partition_size
target_max_partition_qps
read_window
```

Example:

```text
tenant events:
write rate = 20,000/sec
row size = 1 KB
target partition write qps = 1,000/sec
target partition size = 1 GB
read window = day
```

QPS buckets:

```text
20,000 / 1,000 = 20 buckets
```

Size per day without buckets:

```text
20,000 * 86400 * 1 KB
≈ 1.7 TB/day
```

If 20 buckets:

```text
~86 GB/bucket/day
```

Still too large.

Need smaller time bucket or more buckets.

If bucket hour:

```text
20,000 * 3600 * 1 KB
≈ 72 GB/hour total
```

With 20 buckets:

```text
3.6 GB/bucket/hour
```

Maybe still large depending workload.

With 64 buckets:

```text
~1.1 GB/bucket/hour
```

This is more plausible.

But read fanout 64 per hour is high for interactive query. Maybe split hot tenant path, pre-aggregate, or change product query.

---

## 47. When Primary Key Design Reveals Wrong Database Fit

Sometimes requirements are:

```text
arbitrary filters
global sorting
ad-hoc search
multi-dimensional query
full-text search
large analytical scan
complex joins
interactive aggregation
```

ScyllaDB primary key modeling may reveal mismatch.

Possible answer:

- use PostgreSQL for relational transaction/query,
- use Elasticsearch/OpenSearch for search,
- use ClickHouse for analytics,
- use Redis for ephemeral cache,
- use Kafka for stream transport,
- use ScyllaDB for high-throughput partitioned OLTP state/event access.

Top engineer does not force every query into ScyllaDB.

They place each workload where physical model fits.

---

## 48. Primary Key Smell Catalog

### 48.1 Low Cardinality First Component

```sql
PRIMARY KEY (status, updated_at)
```

Smell:

```text
few partitions, hot/large
```

### 48.2 Missing Bucket on High-Volume Entity

```sql
PRIMARY KEY (tenant_id, created_at)
```

for huge tenants.

### 48.3 Timestamp as Partition Key Alone

```sql
PRIMARY KEY (bucket_day, event_id)
```

All writes for a day target limited partitions.

### 48.4 Random Key with Required Range Query

```sql
PRIMARY KEY (event_id)
```

but need query by tenant/day.

### 48.5 Over-Bucketing

```text
1024 buckets for small tenant
```

Read fanout too high.

### 48.6 Clustering Columns in Wrong Order

Need query:

```text
by category then time
```

but primary key:

```sql
PRIMARY KEY (entity_id, created_at, category)
```

Cannot efficiently filter category after time range.

### 48.7 No Tie-Breaker

```sql
PRIMARY KEY (case_id, event_time)
```

Collisions/overwrites.

### 48.8 Derived Table Without Cleanup Key

Table supports insert, but no easy way to delete old row when state changes because old primary key components not stored.

Always store enough old key data to clean derived rows.

---

## 49. Derived Table Cleanup and Primary Key

Suppose:

```sql
CREATE TABLE cases_by_assignee_due (
    assignee_id uuid,
    due_at timestamp,
    case_id uuid,
    status text,
    PRIMARY KEY (assignee_id, due_at, case_id)
);
```

If case changes assignee or due date, you need delete old row:

```sql
DELETE FROM cases_by_assignee_due
WHERE assignee_id = old_assignee
  AND due_at = old_due_at
  AND case_id = case_id;
```

Application must know old primary key values.

Therefore current table should store:

```text
assignee_id
due_at
```

or event handler must know previous state.

If not, stale derived rows accumulate.

This is a primary key design issue, not just cleanup job issue.

---

## 50. Primary Key and Reconciliation

Derived tables can diverge.

Design reconciliation requires primary keys.

Example source:

```text
case_current_by_id
```

Derived:

```text
open_cases_by_assignee_day_bucket
```

Reconciliation needs to compute expected derived primary key:

```text
assignee_id
bucket_day
bucket_id
due_at
case_id
```

If bucket_id is hash(case_id) % N, deterministic.

Good.

If bucket_id was random at write time and not stored, bad.

Primary key components should be reproducible or stored.

---

## 51. Primary Key and Backfill

Backfill creates derived table from source.

Backfill questions:

```text
Can source be scanned safely?
Can derived primary key be computed?
Is write idempotent?
Can backfill be resumed?
Can old/stale derived rows be removed?
Can backfill throttle by token range/bucket?
```

Primary key design affects all of these.

Use deterministic keys to make backfill retry-safe.

---

## 52. Primary Key Decision Framework

For each access pattern:

### Step 1: Define Query

```text
What exact WHERE clause?
What sort?
What limit?
What freshness?
```

### Step 2: Define Locality

```text
What data must be read together?
```

### Step 3: Define Distribution

```text
Will this key be hot?
Is cardinality high enough?
Need bucket?
```

### Step 4: Define Ordering

```text
Which clustering order supports query?
Need range?
Need latest?
Need priority?
```

### Step 5: Define Bounds

```text
Max rows/bytes per partition?
Max QPS per partition?
Retention?
```

### Step 6: Define Mutation Lifecycle

```text
Insert-only?
Update?
Delete?
TTL?
Derived cleanup?
```

### Step 7: Define Operational Effects

```text
Compaction?
Repair?
Tombstones?
Backup?
Scale-out?
```

### Step 8: Define Java Contract

```text
Repository method
Consistency level
Idempotency
Timeout behavior
Page/cursor
```

---

## 53. Design Review Checklist

For every primary key:

```text
[ ] Does it match one specific access pattern?
[ ] Is full partition key available in query?
[ ] Is partition key high-cardinality?
[ ] Is partition size bounded?
[ ] Is hot partition risk estimated?
[ ] Is bucketing needed?
[ ] Is bucket count justified?
[ ] Is read fanout bounded?
[ ] Are clustering columns in query order?
[ ] Is clustering order aligned with sort?
[ ] Is there a tie-breaker?
[ ] Are retry key components stable?
[ ] Are old derived key values available for cleanup?
[ ] Is TTL/delete behavior compatible?
[ ] Is pagination cursor possible?
[ ] Is Java repository method explicit?
[ ] Is this table source or derived?
[ ] Can table be rebuilt/backfilled?
[ ] Are operational metrics defined?
```

---

## 54. Common Misconceptions

### Misconception 1: “Primary key is just unique id.”

No. It is physical distribution and query contract.

### Misconception 2: “Timestamp clustering distributes writes.”

No. Partition key distributes writes. Clustering only orders within partition.

### Misconception 3: “Composite key means all columns are partition key.”

No. Only columns inside double parentheses are composite partition key.

### Misconception 4: “More buckets always better.”

No. Buckets reduce hot partitions but increase read fanout and merge complexity.

### Misconception 5: “Single-partition query is always fast.”

No. Huge/tombstone-heavy partitions can be slow.

### Misconception 6: “LIMIT makes query safe.”

No. Query may still scan tombstones/large ranges before returning limited rows.

### Misconception 7: “Derived table cleanup is easy later.”

Only if old primary key components are known/reproducible.

### Misconception 8: “Adding nodes fixes bad partition key.”

No. Hot logical partition remains hot.

---

## 55. Mental Model Compression

Remember:

```text
Partition key answers:
  Where does data live?

Clustering key answers:
  How is data ordered inside that location?

Full primary key answers:
  Which row/cell is uniquely addressed?
```

And:

```text
Good ScyllaDB schema design is primary-key design.
```

The table exists to serve a query.

The primary key is the physical shape of that query.

---

## 56. Summary

Primary key design is the core ScyllaDB skill.

Key lessons:

1. Primary key is physical design, not just uniqueness.
2. Partition key controls distribution, replica placement, and hot partition risk.
3. Clustering key controls ordering and range access inside partition.
4. Composite partition key requires double parentheses.
5. Efficient queries supply full partition key.
6. Clustering restrictions must follow declared order.
7. Equality restrictions should precede range restrictions.
8. Partition size must be bounded and estimated.
9. Hot partitions require bucketing or different model.
10. Time bucketing controls partition growth.
11. Hash bucketing controls write heat but increases read fanout.
12. Tie-breakers prevent accidental overwrite.
13. Pagination should use clustering cursor, not offset.
14. Derived tables require cleanup/reconciliation keys.
15. Java repositories should mirror primary key shape.
16. Primary key design reveals whether ScyllaDB fits the workload.
17. Operational health depends heavily on key design.

---

## 57. Review Questions

1. Apa fungsi partition key?
2. Apa fungsi clustering key?
3. Apa arti `PRIMARY KEY (a, b, c)`?
4. Apa arti `PRIMARY KEY ((a, b), c)`?
5. Kenapa double parentheses penting?
6. Kenapa timestamp clustering tidak mendistribusikan write?
7. Apa itu single-partition query?
8. Apa risiko multi-partition fanout?
9. Kenapa `IN` bisa berbahaya?
10. Apa itu hot partition?
11. Apa itu large partition?
12. Bagaimana menghitung estimasi partition size?
13. Kapan time bucketing cocok?
14. Kapan hash bucketing cocok?
15. Apa trade-off bucket terhadap read?
16. Kenapa tie-breaker clustering column penting?
17. Kenapa offset pagination buruk?
18. Apa hubungan primary key dengan derived table cleanup?
19. Kenapa old primary key values harus diketahui saat update derived view?
20. Bagaimana repository Java harus mencerminkan primary key?

---

## 58. Practical Exercise

Design primary key untuk use case berikut:

```text
Regulatory enforcement platform:
1. Append event by case.
2. Read latest 100 events by case.
3. Read events by case within date range.
4. Read current case state by case_id.
5. List open cases by assignee sorted by due date.
6. List cases due today by team.
7. Store idempotency command key for 24 hours.
8. Store notification feed by user.
```

Untuk setiap use case, tulis:

```text
1. Table name.
2. Partition key.
3. Clustering key.
4. Clustering order.
5. Expected partition size.
6. Expected hot key.
7. Need time bucket?
8. Need hash bucket?
9. Read fanout count.
10. Tie-breaker.
11. TTL/delete behavior.
12. Source or derived.
13. Cleanup/reconciliation strategy.
14. Java repository method signature.
15. Consistency level candidate.
```

---

## 59. Preview Part 009

Part berikutnya membangun metodologi lengkap:

```text
Query-First Data Modeling:
Dari user journey ke table design
```

Kita akan mengambil requirement aplikasi, memecahnya menjadi access pattern, membuat query matrix, cardinality matrix, heat matrix, failure matrix, lalu menurunkannya menjadi CQL table design.

Part 008 memberi skill desain primary key.

Part 009 akan memberi proses desain end-to-end.

---

# End of Part 008

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — CQL Deep Dive I: Keyspace, Table, Types, DDL, DML</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-009.md">Part 009 — Query-First Data Modeling: Dari User Journey ke Table Design ➡️</a>
</div>

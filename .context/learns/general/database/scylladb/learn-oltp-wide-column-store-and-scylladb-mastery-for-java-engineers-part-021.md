# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-021.md

# Part 021 — Query Execution and Performance: Coordinator Path, Replica Path, Paging, ALLOW FILTERING, IN Queries, dan p99 Debugging

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `021`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami bagaimana query CQL dieksekusi dari Java client ke coordinator, replica, shard, storage engine; bagaimana read/write path memengaruhi latency; mengapa `ALLOW FILTERING`, `IN`, large partitions, tombstones, paging, fanout, dan retry bisa merusak p99; serta bagaimana melakukan performance debugging production-grade.

---

## 0. Posisi Part Ini dalam Seri

Part 019 dan 020 membahas Java client engineering:

```text
session
prepared statements
token/shard-aware routing
execution profiles
timeouts
retries
paging
backpressure
observability
```

Part ini kembali ke database execution path:

```text
client request
  -> coordinator
  -> replica/shard
  -> memtable/SSTable/cache
  -> result merge/reconciliation
  -> paging/result back to client
```

Tujuannya:

> Saat sebuah endpoint lambat, kamu bisa menjelaskan *di mana* biaya terjadi, bukan hanya “database slow”.

Pertanyaan utama:

```text
1. Query ini single-partition atau multi-partition?
2. Coordinator harus menghubungi berapa replica?
3. Apakah request token/shard-aware?
4. Berapa rows/tombstones yang discan?
5. Berapa SSTable yang disentuh?
6. Apakah page size/limit benar?
7. Apakah query fanout?
8. Apakah CL menambah latency?
9. Apakah retry/speculative execution menambah load?
10. Apakah p99 berasal dari hot partition, compaction, network, atau client?
```

---

## 1. Performance Is Query Shape + Data Shape + Runtime State

Performance ScyllaDB bukan hanya “query syntax”.

Ia hasil dari:

```text
query shape
+ partition key
+ clustering range
+ partition size
+ row size
+ tombstones
+ compaction state
+ cache state
+ CL
+ replica health
+ coordinator routing
+ client timeout/retry
+ load/skew
```

Query yang sama bisa cepat atau lambat tergantung data shape.

Example:

```sql
SELECT *
FROM case_events_by_case_month
WHERE tenant_id = ?
  AND case_id = ?
  AND bucket_month = ?
LIMIT 100;
```

Cepat jika:

```text
partition bounded
latest rows live
few tombstones
clustering order matches query
cache/SSTables healthy
```

Lambat jika:

```text
partition huge
many tombstones at head
payload large
many SSTables
compaction backlog
hot case
```

---

## 2. Request Path High-Level

Simplified read path from Java:

```text
Java Driver
  -> chosen coordinator node
  -> coordinator shard/core
  -> replica nodes/shards
  -> storage engine read
  -> merge/reconcile responses
  -> return page/result
```

Write path:

```text
Java Driver
  -> coordinator
  -> replica nodes/shards
  -> commitlog/memtable
  -> ack based on CL
  -> later flush/compaction
```

Important:

```text
Coordinator is not necessarily data owner unless token-aware routing works.
```

With token/shard-aware driver, coordinator selection can be closer to owning replica/shard.

---

## 3. Coordinator Role

Coordinator receives client request and orchestrates:

- routing to replicas,
- consistency level enforcement,
- read digest/data requests,
- merging/reconciliation,
- paging,
- error/timeout response.

Coordinator work increases with:

- multi-partition query,
- high CL,
- large result sets,
- `IN` fanout,
- secondary index query,
- read repair/reconciliation,
- tombstone-heavy scans,
- speculative/retry duplication.

A bad query can overload coordinator even if replicas are okay.

---

## 4. Replica Role

Replica owns copy of partition data.

Replica performs:

- memtable lookup,
- cache lookup,
- SSTable lookup,
- bloom filter/index checks,
- row filtering within partition,
- tombstone handling,
- result serialization.

Replica cost increases with:

- many SSTables,
- large partition,
- wide clustering range,
- tombstones,
- large row payload,
- cold cache,
- compaction backlog,
- disk pressure.

---

## 5. Shard Role

ScyllaDB is shard-per-core.

A partition belongs to a shard based on token/routing.

If request reaches wrong shard on node:

```text
cross-shard forwarding
```

adds overhead.

Shard-aware driver helps choose the right connection.

Performance symptoms of poor shard awareness:

- higher p50/p99 latency,
- more internal forwarding,
- uneven shard load,
- CPU overhead.

But shard awareness cannot fix bad partition key or hot key.

---

## 6. Read Path: Point Lookup

Example:

```sql
SELECT status, version
FROM case_current_by_id
WHERE tenant_id = ?
  AND case_id = ?;
```

Primary key:

```sql
PRIMARY KEY ((tenant_id, case_id))
```

This is ideal:

```text
single partition
one row
bounded result
routing key known
```

Read path:

```text
coordinator contacts replica(s) based on CL
replica checks memtable/cache/SSTables
returns row/digest
coordinator returns result
```

If p99 slow, likely causes:

- hot key,
- replica/node overload,
- CL waiting for slow replica,
- compaction/disk,
- client routing/timeout,
- cache miss plus many SSTables,
- network.

---

## 7. Read Path: Partition Range

Example:

```sql
SELECT *
FROM case_events_by_case_version_bucket
WHERE tenant_id = ?
  AND case_id = ?
  AND version_bucket = ?
  AND event_version >= ?
  AND event_version < ?
LIMIT 100;
```

Good if:

- full partition key specified,
- clustering range bounded,
- clustering order matches access,
- limit reasonable,
- partition not tombstone-heavy.

Cost depends on:

```text
rows scanned
tombstones scanned
SSTables touched
payload bytes returned
```

Not only rows returned.

---

## 8. Read Path: Multi-Partition Fanout

Example:

```text
read open cases by assignee across bucket_id 0..7
```

Application issues 8 partition queries.

Cost:

```text
8 coordinator requests
8 replica read paths
merge in Java
tail latency max of subqueries
```

If each subquery p99=20ms, overall request p99 can be much worse.

Fanout performance requires:

- bounded bucket count,
- bounded concurrency,
- overfetch control,
- merge cost control,
- per-subquery timeout,
- overall deadline,
- metrics.

---

## 9. Write Path: Normal Mutation

Example:

```sql
INSERT INTO case_events_by_case_version_bucket (...)
VALUES (...);
```

Write path:

```text
client -> coordinator
coordinator -> replicas
replica writes commitlog
replica updates memtable
replica ack
coordinator waits for CL
client receives success
later memtable flush -> SSTable
later compaction
```

Write latency is mostly:

- coordinator/replica network,
- commitlog/fsync behavior,
- replica load,
- CL required acks,
- backpressure/overload,
- mutation size,
- LWT if conditional.

Compaction is not usually in foreground write path, but compaction debt affects cluster resources.

---

## 10. Write Path: LWT Mutation

LWT path adds conditional coordination.

Example:

```sql
UPDATE case_current_by_id
SET status = ?, version = ?
WHERE tenant_id = ? AND case_id = ?
IF version = ?;
```

Additional costs:

- serial phase,
- read current condition,
- proposal/commit coordination,
- contention handling,
- higher p99.

Use LWT only when invariant needs it.

If p99 issue isolated to LWT operations, check:

- contention on same key,
- applied=false rate,
- serial consistency,
- timeout too low,
- retry storm,
- same row hotness.

---

## 11. Consistency Level and Performance

CL affects how many replicas must respond.

RF=3:

```text
LOCAL_ONE -> one local replica
LOCAL_QUORUM -> two local replicas
ALL -> three local replicas
```

Latency at higher CL often follows slower required replica.

If one replica slow:

- LOCAL_ONE may avoid it,
- LOCAL_QUORUM may wait for it if needed,
- ALL definitely waits/fails.

Trade-off:

```text
freshness/durability vs latency/availability
```

Do not set LOCAL_QUORUM everywhere blindly if derived view can be stale.

Do not set LOCAL_ONE on authoritative decisions without understanding stale risk.

---

## 12. Result Size

Returned bytes matter.

Rows are not equal.

Example:

```text
100 rows * 200 bytes = 20 KB
100 rows * 50 KB = 5 MB
```

Large payload affects:

- network,
- serialization,
- Java heap,
- GC,
- page latency,
- coordinator memory,
- client memory.

Avoid duplicating huge payload into derived tables.

Use object storage for large documents/evidence.

---

## 13. LIMIT Does Not Mean Cheap

Query:

```sql
SELECT *
FROM queue_by_assignee
WHERE assignee_id = ?
LIMIT 50;
```

May be expensive if:

- partition begins with many tombstones,
- clustering order does not match live data,
- SSTables contain old deleted rows,
- filter applied after scan,
- row payload huge.

`LIMIT` limits returned live rows, not necessarily storage work.

---

## 14. Page Size Does Not Fix Bad Query

Small page size can reduce memory and per-page latency.

But if each page scans many tombstones, query still bad.

Page size is flow-control, not data-model repair.

Bad:

```text
partition has 10M tombstones
page_size=10
```

Still can be slow.

Fix:

- avoid tombstone-heavy partition,
- rebuild table,
- bucket,
- validate-on-read/reconciliation,
- TTL/compaction redesign.

---

## 15. ALLOW FILTERING

`ALLOW FILTERING` tells database to execute query that may require filtering rows after reading more data than returned.

Example:

```sql
SELECT *
FROM case_current_by_id
WHERE status = 'OPEN'
ALLOW FILTERING;
```

This is usually a production red flag.

Why dangerous:

- may scan many partitions/rows,
- unpredictable latency,
- load grows with data size,
- p99 degrades silently,
- bypasses query-first model.

Use only for:

- tiny tables,
- admin/debug,
- offline tool,
- controlled migration,
- explicitly bounded dataset.

Never as hot API path.

---

## 16. Filtering Within Partition

Not all filtering is equally bad.

If full partition key is specified and partition small/bounded:

```sql
SELECT *
FROM case_events_by_case_month
WHERE tenant_id = ?
  AND case_id = ?
  AND bucket_month = ?
  AND event_type = ?
ALLOW FILTERING;
```

Still must scan within partition.

May be acceptable if partition is small and QPS low.

But if partition can be large, model access path:

```text
events_by_case_event_type_month
```

or local secondary index if suitable.

---

## 17. IN Queries

CQL `IN` can query multiple partition/clustering values.

Example:

```sql
SELECT *
FROM case_current_by_id
WHERE tenant_id = ?
  AND case_id IN (?, ?, ?, ...);
```

This is fanout.

Danger:

- large `IN` list,
- unbounded client input,
- coordinator fanout,
- result merge,
- timeout,
- per-key hotness,
- read amplification.

Small bounded `IN` may be okay.

Rule:

```text
IN list size must have hard limit.
```

For many IDs, use:

- application fanout with bounded concurrency,
- batch job,
- explicit table matching query,
- search/OLAP.

---

## 18. IN on Clustering Key

If partition key fixed:

```sql
WHERE tenant_id = ?
  AND case_id = ?
  AND bucket_month = ?
  AND event_type IN ('A', 'B')
```

This can still create multiple clustering lookups/ranges.

Acceptability depends on partition and result size.

Do not assume `IN` is free.

---

## 19. Token Range Queries

Token range scans are used for:

- backfill,
- repair-like workflows,
- migration,
- export,
- analytics-ish scan.

They are not normal online query path.

Example conceptual:

```sql
SELECT *
FROM table
WHERE token(pk) > ?
  AND token(pk) <= ?;
```

Use for batch with:

- throttling,
- checkpoint,
- page size,
- low-priority profile,
- cluster health awareness.

Not for user request.

---

## 20. Secondary Index/MV Query Performance

Index/MV query may involve:

- query index/view structure,
- fetch base rows,
- merge/filter,
- additional storage read,
- potential hot index partition.

Index on low-cardinality column is often worse than explicit table.

If index query p99 bad, inspect:

- indexed value cardinality,
- result size,
- base fetch count,
- tombstones in index,
- index build state,
- write churn on indexed column.

---

## 21. Large Partition Reads

Large partition issues:

- many rows/cells,
- large indexes,
- high memory during query,
- long scans,
- tombstone accumulation,
- repair/compaction pain.

Symptoms:

- queries by valid primary key still slow,
- p99 bad for specific entity,
- large partition warnings,
- high row count/bytes per key.

Fix:

- time/version bucket,
- hash bucket,
- split entity,
- archive old data,
- reduce payload,
- rebuild table.

---

## 22. Hot Partition Reads/Writes

Hot partition = too much QPS to one key.

Symptoms:

- specific tenant/case/user slow,
- one shard/node hot,
- cluster average okay,
- p99 only for subset,
- retry storms on same key.

Fix:

- cache/coalesce reads,
- rate limit,
- bucket writes,
- single-writer for hot aggregate,
- product polling reduction,
- isolate tenant,
- redesign table.

Adding nodes may not help one hot partition.

---

## 23. Short Reads

A short read occurs when replica returns fewer live rows than coordinator needs due to tombstones/expired rows/limits, causing additional work to satisfy result.

In tombstone-heavy partitions, queries with LIMIT may require multiple internal reads to gather live rows.

Symptoms:

- LIMIT query unexpectedly slow,
- tombstone warnings,
- many stale/deleted rows before live rows.

Fix data layout/tombstones.

---

## 24. Tombstone-Heavy Reads

From part 015:

```text
tombstones are deletion markers
reads must respect them
```

Tombstone-heavy query can be slow even if returns few rows.

Common causes:

- queue delete pattern,
- TTL table queried beyond live window,
- collection overwrites,
- derived view churn,
- range deletes.

Performance fix is usually lifecycle/data model change.

---

## 25. Cache Effects

Caches can improve reads:

- row/cache,
- key/cache-like structures,
- OS page cache,
- application cache.

But cache hit rate depends on:

- working set,
- hot keys,
- payload size,
- compaction,
- memory pressure,
- read pattern.

Do not benchmark only warm cache unless production is warm.

If p99 spikes during cache miss, inspect SSTable/disk path.

---

## 26. Bloom Filters and SSTables

Read path uses structures like Bloom filters and indexes to avoid unnecessary SSTable reads.

But if many SSTables exist, even checking metadata can add cost.

Compaction strategy affects number/overlap of SSTables.

High SSTable count can increase read amplification.

This is why compaction backlog affects read performance.

---

## 27. Compaction Impact

Compaction competes for CPU/IO.

When compaction backlog high:

- SSTable count grows,
- read amplification rises,
- disk usage rises,
- p99 may worsen,
- tombstones remain longer.

If p99 worsens after heavy writes/backfill/TTL expiry, check compaction metrics.

---

## 28. Paging and Coordinator State

Large query results are paged.

Each page is a separate request/continuation.

Performance issues:

- page size too large,
- page size too small causing many round trips,
- client pauses between pages,
- data changes between pages,
- driver paging state misuse,
- API cursor not stable.

For interactive APIs:

```text
limit small
page size aligned
domain cursor preferred
```

For exports:

```text
checkpoint and throttle
```

---

## 29. Client-Side Merge Cost

Bucketed/fanout query often merges results in Java.

Cost includes:

- heap allocation,
- priority queue merge,
- JSON serialization,
- stale validation,
- sorting,
- overfetch.

p99 may be in application, not database.

Measure:

```text
DB subquery latency
merge latency
serialization latency
rows fetched vs returned
```

---

## 30. Java GC and Row Mapping

Large result sets create Java objects.

Bad:

```text
fetch 10,000 rows
map to domain objects
sort
serialize
```

Can cause GC and p99 spikes.

Use:

- smaller page/limit,
- streaming,
- lightweight DTO,
- avoid unnecessary allocations,
- avoid large payload,
- backpressure.

---

## 31. Query Tracing

Tracing can help understand query path, but can be expensive.

Use carefully in:

- staging,
- sampled production debugging,
- specific request/key.

Do not enable tracing globally for hot path.

Application-level tracing plus server metrics usually first.

---

## 32. Performance Debugging Workflow

When query p99 is high:

```text
1. Identify operation/table/profile.
2. Confirm query shape and CQL.
3. Check if full partition key bound.
4. Check result rows/bytes/page count.
5. Check fanout count.
6. Check timeout/retry/speculative count.
7. Check key skew/hot partitions.
8. Check tombstone warnings.
9. Check partition size.
10. Check SSTable/compaction metrics.
11. Check CL and slow replicas.
12. Check client merge/serialization/GC.
13. Check recent deploy/backfill/schema change.
```

Do not jump directly to “add nodes”.

---

## 33. Operation-Level Metrics

For each repository operation:

```text
latency histogram
success/error count
timeout count
unavailable count
retry count
speculative count
rows returned
bytes estimated
pages fetched
fanout count
stale filtered
LWT applied false
partition key hash sampled
bucket info
```

These metrics let you correlate p99 to query shape.

---

## 34. Server Metrics to Correlate

Look at:

```text
read/write latency per table
timeouts
unavailable errors
SSTable count
compaction pending
CPU per shard
disk IO latency
cache hit ratio
tombstone warnings
large partition warnings
repair/streaming activity
network errors
```

Application and server metrics together identify bottleneck.

---

## 35. p50 vs p99

p50 tells typical case.

p99 tells tail.

Distributed DB performance engineering is p99-driven because:

- fanout amplifies tail,
- one slow replica matters,
- one hot partition matters,
- one tombstone-heavy partition matters,
- one GC pause matters.

Do not optimize only average latency.

---

## 36. Tail Amplification in Fanout

If request has 16 parallel subqueries, overall latency follows slowest subquery.

Even if each subquery is “usually fast”, combined p99 worsens.

Mitigate:

- reduce fanout,
- cap buckets,
- precompute top-N,
- use cache,
- accept partial only if semantics allow,
- improve per-bucket performance.

---

## 37. Tail Amplification in CL

LOCAL_QUORUM waits for enough replicas.

If one replica slow, query may wait for slower path.

CL ONE may have lower p99 but weaker freshness.

Choose CL based on table authority.

Performance and correctness are coupled.

---

## 38. Tail Amplification in Retries

Retry adds latency.

If first attempt times out at 300ms and retry takes 100ms:

```text
operation latency >400ms
```

Retries can improve success rate but hurt tail.

Use retry only where endpoint budget allows.

---

## 39. Query Smells

Red flags:

```text
ALLOW FILTERING
large IN list
SELECT *
unbounded range
missing LIMIT
partition key not fully specified
filter by low-cardinality field
query by tenant only
query by status only
query old TTL range
read all pages synchronously
generic findByFilter
page size 10000
driver timeout 5s on user endpoint
```

Each requires review.

---

## 40. SELECT * Smell

`SELECT *` returns all columns.

Problems:

- payload grows when schema adds column,
- large blobs/collections returned accidentally,
- network/heap cost,
- backwards compatibility risk.

Prefer explicit columns:

```sql
SELECT status, version, assignee_id, due_at
FROM case_current_by_id
WHERE ...
```

Use `SELECT *` only for admin/debug or when all columns intentionally needed.

---

## 41. Missing LIMIT

Range query without limit:

```sql
SELECT *
FROM events_by_case
WHERE case_id = ?;
```

If partition grows, query grows.

Always limit interactive query.

For exports, use batch path.

---

## 42. Unbounded Date Range

Bad:

```http
GET /events?from=2020-01-01&to=2026-06-21
```

on online endpoint.

Enforce:

```text
max online range
max rows
async export for large range
```

---

## 43. Large IN List

Bad:

```text
case_id IN 10,000 IDs
```

Better:

- bounded concurrency individual reads,
- batch job,
- explicit table by grouping dimension,
- search/OLAP.

If API receives list of IDs, enforce max.

---

## 44. Query by Tenant Only

Common multi-tenant mistake:

```sql
WHERE tenant_id = ?
```

If tenant big, huge partition or scan.

Tenant must be combined with more selective dimension:

```text
tenant_id + case_id
tenant_id + day + bucket
tenant_id + assignee + day
```

---

## 45. Query by Status Only

Status low cardinality.

Bad:

```text
status=OPEN
```

Better:

```text
tenant + status + day + bucket
```

or aggregate/search.

---

## 46. Performance Review Checklist

For every query:

```text
[ ] What table?
[ ] What access pattern?
[ ] Full partition key specified?
[ ] Clustering range bounded?
[ ] LIMIT set?
[ ] Page size set?
[ ] SELECT columns explicit?
[ ] Expected rows returned?
[ ] Expected rows scanned?
[ ] Expected tombstones scanned?
[ ] Expected payload bytes?
[ ] CL justified?
[ ] Fanout count bounded?
[ ] Retry/speculative safe?
[ ] Hot key risk?
[ ] Large partition risk?
[ ] Metrics exist?
```

---

## 47. Example Debug: Slow Case Detail

Endpoint:

```text
GET /cases/{caseId}
```

Operations:

```text
read current case
read latest 100 events
read open tasks
read attachments metadata
```

p99 high.

Investigation:

```text
current read fast
events read slow only for high-profile case
events partition has 2M rows and many tombstones
latest query scans old tombstones due wrong clustering order
```

Fix:

- version bucket,
- clustering DESC for latest,
- rebuild event table,
- no range delete,
- archive old data.

---

## 48. Example Debug: Slow Assignee Queue

Query:

```text
8 bucket fanout
```

p99 high.

Metrics:

```text
rows fetched=400
rows returned=50
stale filtered=320
one bucket timeout
```

Root cause:

```text
derived rows not cleaned/reconciled
stale ratio high
tombstones in hot bucket
```

Fix:

- reconciliation job,
- reduce stale rows,
- validate source only after better projection,
- maybe precompute top-N,
- limit polling.

---

## 49. Example Debug: Write Timeout Spike

Operation:

```text
append notification
```

Metrics:

```text
timeouts increased
payload bytes increased 20x after new rich notification body
compaction backlog high
```

Root cause:

```text
large payload duplication
```

Fix:

- store body summary only,
- full body in object/content service,
- payload validation,
- backfill cleanup if needed.

---

## 50. Example Debug: LWT p99 Spike

Operation:

```text
transition case state
```

Metrics:

```text
LWT applied=false spike
same case_id hot
retries immediate
```

Root cause:

```text
many clients updating same case concurrently
```

Fix:

- per-case command serialization,
- backoff,
- UI prevents duplicate submit,
- command idempotency,
- refresh version on conflict.

---

## 51. Example Debug: ALLOW FILTERING Incident

Temporary query:

```sql
SELECT *
FROM case_current_by_id
WHERE tenant_id = ?
  AND status = 'OPEN'
ALLOW FILTERING;
```

Works in staging.

Production:

```text
large tenant has 20M cases
query scans huge data
timeouts
cluster load rises
```

Fix:

- disable endpoint,
- create explicit bucketed derived table,
- backfill live data with throttle,
- switch endpoint,
- add query linting/code review.

---

## 52. Query Linting

Automated checks can catch:

- ALLOW FILTERING,
- SELECT *,
- missing LIMIT on range query,
- large page size,
- unbounded IN,
- non-prepared hot query,
- wrong execution profile,
- missing partition key.

Implement in:

- code review checklist,
- repository tests,
- static CQL registry,
- integration tests.

---

## 53. CQL Registry

Maintain registry:

```text
operation name
CQL
table
partition key fields
clustering filters
execution profile
limit/page size
idempotency
expected cardinality
```

This becomes living performance documentation.

---

## 54. Benchmarking Queries

Benchmark with:

- realistic data volume,
- realistic skew,
- cold/warm cache,
- compaction running,
- tombstones,
- realistic row size,
- same CL,
- same driver config,
- p99/p999,
- fanout.

Do not benchmark empty table/small dataset and extrapolate.

---

## 55. Load Test Query Mix

Production mix matters.

Example:

```text
70% current reads
20% queue reads
5% event appends
3% LWT transitions
2% exports/backfill
```

Testing only writes misses read p99.

Testing only uniform keys misses hot partitions.

Testing no background compaction misses real behavior.

---

## 56. Common Misconceptions

### Misconception 1: “Primary key query is always fast.”

Not if partition huge/tombstone-heavy/hot.

### Misconception 2: “LIMIT makes query cheap.”

Not if storage scans many tombstones/rows.

### Misconception 3: “ALLOW FILTERING is okay with LIMIT.”

Filtering may scan far more than LIMIT.

### Misconception 4: “IN is one query, so cheap.”

It is fanout.

### Misconception 5: “p50 good means system healthy.”

p99 matters.

### Misconception 6: “Add nodes fixes slow key.”

Not for one hot partition.

### Misconception 7: “Page size solves bad data model.”

It only controls fetch size.

### Misconception 8: “Database latency is always server-side.”

Client merge, GC, retries, and fanout can dominate.

---

## 57. Mental Model Compression

Remember:

```text
Fast ScyllaDB query =
  known partition key
  bounded clustering range
  bounded rows/bytes
  low tombstones
  good routing
  appropriate CL
  bounded fanout
  controlled client behavior
```

And:

```text
p99 is where bad assumptions hide.
```

---

## 58. Summary

Query execution performance depends on both database internals and Java client behavior.

Key lessons:

1. Coordinator orchestrates replica reads/writes and CL.
2. Replica cost depends on memtable/SSTable/cache/tombstone/partition shape.
3. Token/shard-aware routing reduces unnecessary hops.
4. Single-partition point lookup is ideal but can still be hot.
5. Partition range query must be bounded by clustering and LIMIT.
6. Fanout reads amplify tail latency.
7. CL increases required replica responses and affects p99.
8. Result bytes matter, not just row count.
9. LIMIT does not prevent tombstone scan.
10. Page size controls flow, not data model.
11. `ALLOW FILTERING` is production red flag.
12. `IN` is fanout and must be bounded.
13. Large partitions and hot partitions are different problems.
14. Tombstones and short reads can make valid primary-key queries slow.
15. Compaction backlog increases read amplification.
16. Client merge/GC/serialization can dominate p99.
17. Performance debugging needs operation/table/profile metrics.
18. Query linting and CQL registry help prevent incidents.

---

## 59. Review Questions

1. Apa peran coordinator?
2. Apa peran replica?
3. Bagaimana shard-aware routing membantu?
4. Kenapa point lookup bisa tetap lambat?
5. Apa yang menentukan biaya partition range read?
6. Mengapa fanout memperburuk p99?
7. Bagaimana CL memengaruhi latency?
8. Kenapa result bytes penting?
9. Kenapa LIMIT tidak selalu murah?
10. Kenapa page size tidak memperbaiki data model buruk?
11. Kapan `ALLOW FILTERING` acceptable?
12. Apa risiko `IN` query?
13. Apa itu token range query dan kapan dipakai?
14. Bagaimana index/MV query bisa lambat?
15. Apa gejala large partition read?
16. Apa gejala hot partition?
17. Apa itu short read?
18. Bagaimana compaction backlog memengaruhi read?
19. Apa metrik operation-level yang wajib?
20. Bagaimana workflow debugging p99?

---

## 60. Practical Exercise

Ambil query berikut dan analisis execution/performance:

```text
1. read current case by tenant_id+case_id
2. read latest 100 case events
3. read open queue by assignee with 16 hash buckets
4. read notification feed latest 50
5. transition case state with LWT
6. export all events for tenant for 1 year
7. query cases by status using ALLOW FILTERING
8. read 500 case IDs with IN
9. search by external reference
10. read dashboard count by status
```

Untuk tiap query, tulis:

```text
single partition or fanout?
coordinator work
replica work
CL impact
rows returned
rows scanned risk
tombstone risk
partition/hot key risk
page size/LIMIT
client merge cost
metrics to inspect
red flags
better design if needed
```

---

## 61. Preview Part 022

Part berikutnya membahas:

```text
Batching, Bulk Loading, Backfill, and High-Volume Write Pipelines
```

Kita akan memperdalam:

- CQL batch vs application batching,
- async bounded writes,
- bulk loading,
- backfill design,
- dual-write migration,
- CDC/outbox pipelines,
- idempotency and checkpointing,
- write amplification,
- operational safety.

Part 021 membahas query execution and performance.

Part 022 akan membahas high-volume write workflows secara production-grade.

---

# End of Part 021


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Java Client Engineering II: Timeouts, Retries, Paging, Backpressure, Observability, dan Production Hardening</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-022.md">Part 022 — Batching, Bulk Loading, Backfill, dan High-Volume Write Pipelines ➡️</a>
</div>

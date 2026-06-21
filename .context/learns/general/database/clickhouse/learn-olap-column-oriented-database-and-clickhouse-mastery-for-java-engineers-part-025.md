# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-025.md

# Part 025 — Performance Engineering III: CPU, Memory, Disk, Network, and Concurrency

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **025 / 034**  
> Fokus: memahami performa ClickHouse dari level resource: CPU, memory, disk, network, concurrency, spill, workload isolation, query limits, dan capacity planning.

---

## 0. Posisi Part Ini Dalam Seri

Part 023 membahas cara membaca bukti performa:

- `EXPLAIN`;
- `system.query_log`;
- `system.query_thread_log`;
- `system.parts`;
- `system.merges`;
- `system.mutations`;
- distributed health.

Part 024 membahas pola optimasi query:

- reduce scan;
- align predicate;
- optimize aggregation;
- optimize join;
- rollup;
- projection;
- skipping index;
- async export;
- Java API guardrails.

Part 025 ini membahas lapisan lebih bawah:

```text
Ketika query berjalan, resource apa yang sebenarnya habis?
```

ClickHouse query bisa lambat karena:

- CPU habis decompress/filter/aggregate;
- memory habis karena hash aggregation/join/sort;
- disk bandwidth habis karena scan/merge/mutation;
- network habis karena distributed fan-in/fan-out;
- object storage/cache miss;
- concurrency terlalu tinggi;
- background merges bersaing dengan query;
- result serialization besar;
- Java service/client tidak streaming;
- cluster coordinator overload.

Seorang engineer top-tier tidak cukup berkata:

```text
query lambat
```

Ia harus bisa mengklasifikasikan:

```text
query ini CPU-bound
query ini memory-bound
query ini I/O-bound
query ini network-bound
query ini coordinator-bound
query ini concurrency-amplified
query ini bukan query problem, tapi ingestion/merge debt problem
```

---

## 1. Tujuan Part Ini

Setelah part ini, kamu diharapkan mampu:

1. membedakan CPU-bound, memory-bound, disk-bound, network-bound, and concurrency-bound workloads;
2. memahami resource model ClickHouse query execution;
3. membaca tanda resource bottleneck dari query logs/system tables;
4. memahami memory usage pada aggregation, joins, sorting, `FINAL`, and result handling;
5. memahami disk I/O untuk scans, merges, mutations, TTL, and spills;
6. memahami network cost dalam distributed query, replication, and client result transfer;
7. mendesain query limits, user profiles, and workload isolation;
8. memahami external aggregation/sort/spill trade-offs;
9. membuat capacity planning kasar untuk ClickHouse;
10. mendesain Java API agar tidak membuat resource amplification;
11. membangun incident runbook saat cluster overload;
12. memutuskan kapan scale-up, scale-out, rollup, redesign schema, or throttle workload.

---

## 2. Mental Model Utama: Performance = Work / Capacity Under Contention

Query cost bukan hanya:

```text
berapa besar data?
```

Tetapi:

```text
workload = rows × columns × expressions × aggregation cardinality × joins × sorting × result size
capacity = CPU + memory + disk + network + cache + concurrency slots
contention = query concurrency + merges + mutations + inserts + replication + backfills
```

ClickHouse bisa sangat cepat untuk scan besar jika:

- scan sequential;
- columns sedikit;
- compression bagus;
- filters simple;
- aggregation kecil;
- memory cukup;
- disk/cache cepat;
- concurrency terkendali.

ClickHouse bisa lambat untuk data lebih kecil jika:

- group cardinality sangat tinggi;
- join right side besar;
- result besar;
- `FINAL` mahal;
- sorting raw rows;
- object storage cold;
- part count tinggi;
- network fan-in besar;
- cluster sedang merge/mutation/backfill.

Optimization harus menjawab:

```text
resource mana yang menjadi batas?
```

---

## 3. Resource Bottleneck Taxonomy

### 3.1 CPU-Bound

CPU habis untuk:

- decompression;
- expression evaluation;
- filtering;
- JSON parsing;
- hashing;
- aggregation;
- join probing;
- sorting comparisons;
- serialization;
- encryption/compression over network.

Symptoms:

- CPU utilization high;
- disk not saturated;
- query read bytes moderate;
- expressions complex;
- JSON functions heavy;
- many concurrent CPU-heavy queries.

### 3.2 Memory-Bound

Memory habis untuk:

- aggregation states;
- hash tables;
- joins;
- sorting;
- distinct;
- `FINAL`;
- large result buffering;
- distributed final merge.

Symptoms:

- query fails memory limit;
- high `memory_usage`;
- OOM risk;
- external aggregation/sort triggered;
- coordinator memory high.

### 3.3 Disk I/O-Bound

Disk bandwidth/IOPS habis untuk:

- scanning columns;
- merges;
- mutations;
- TTL moves/deletes;
- external sort/aggregation spill;
- part fetch/write;
- backfills.

Symptoms:

- high read/write disk utilization;
- CPU not fully used;
- query waits;
- merges slow;
- part count rising;
- insert latency rising.

### 3.4 Network-Bound

Network habis untuk:

- distributed query partial results;
- remote reads;
- replication part fetch;
- object storage access;
- client result transfer;
- distributed joins;
- backups/restores.

Symptoms:

- distributed query slow despite local shards fast;
- coordinator waits;
- high network throughput;
- result_bytes huge;
- replication queue delayed;
- object storage latency.

### 3.5 Concurrency-Bound

Workload too many simultaneous queries/jobs.

Symptoms:

- individual query fine alone;
- slow under load;
- queueing;
- CPU/memory/disk saturated;
- p95/p99 much worse than p50;
- dashboard storm;
- BI tool parallel query fanout;
- Java service retry storm.

### 3.6 Metadata/Parts-Bound

Too many parts/partitions.

Symptoms:

- query overhead high even for moderate data;
- `system.parts` shows many active parts;
- merges can't keep up;
- insert errors;
- replication queue grows.

### 3.7 Coordinator-Bound

Distributed query coordinator overloaded.

Symptoms:

- remote shards finish quickly;
- coordinator memory/CPU high;
- high-cardinality final aggregation;
- large result merge;
- all API traffic hits one node.

---

## 4. CPU Cost Model

### 4.1 Where CPU Goes

In ClickHouse, CPU can be spent on:

```text
read compressed data
→ decompress
→ decode columns
→ evaluate filters
→ compute expressions
→ hash/group
→ join
→ sort
→ serialize result
```

### 4.2 Cheap CPU Work

Usually cheap:

- filtering numeric/LowCardinality columns;
- simple comparisons;
- summing numeric values;
- count;
- grouping low-cardinality dimensions;
- reading compressed sequential data.

### 4.3 Expensive CPU Work

Often expensive:

- JSON extraction at query time;
- regex;
- string parsing;
- high-cardinality hashing;
- exact distinct;
- complex joins;
- sorting large rows;
- decompression of huge string columns;
- repeated function calls on billions of rows;
- heavy compression codecs on hot query path.

### 4.4 CPU Optimization Patterns

- promote JSON fields;
- materialize frequent expressions;
- use proper data types;
- use LowCardinality for suitable strings;
- reduce selected columns;
- reduce rows with better pruning;
- pre-aggregate;
- avoid regex on raw high-volume table;
- use dictionaries carefully;
- avoid exact aggregate unless needed;
- use rollups for repeated CPU-heavy metrics.

### 4.5 Example: Runtime JSON CPU

Bad:

```sql
SELECT
    JSONExtractString(payload, 'country') AS country,
    count()
FROM events
WHERE JSONExtractString(payload, 'event_type') = 'purchase'
GROUP BY country;
```

CPU does JSON parsing repeatedly.

Better:

```sql
SELECT
    country,
    count()
FROM events
WHERE event_type = 'purchase'
GROUP BY country;
```

with `event_type` and `country` as physical columns.

---

## 5. Memory Cost Model

### 5.1 What Consumes Memory

Memory usage rises from:

- aggregation hash maps;
- distinct states;
- join hash tables;
- sort buffers;
- `FINAL` processing;
- result buffering;
- decompressed blocks;
- distributed coordinator merge;
- materialized view processing;
- large arrays/maps/string columns.

### 5.2 Aggregation Memory

Query:

```sql
SELECT
    user_id,
    session_id,
    count()
FROM events
GROUP BY
    user_id,
    session_id;
```

Memory roughly grows with:

```text
number of groups × size per group state
```

Group count can be much larger than result shown if `LIMIT` is applied after aggregation.

### 5.3 Distinct Memory

Exact distinct:

```sql
uniqExact(user_id)
```

requires keeping exact set-like state.

Approximate distinct:

```sql
uniq(user_id)
```

uses bounded/probabilistic state depending function.

### 5.4 Join Memory

Hash join memory roughly depends on:

```text
right_side_rows × key_size × payload_columns × overhead × duplicates
```

If right side duplicate:

```text
one key → many rows
```

memory and output can explode.

### 5.5 Sort Memory

Sort memory depends on:

```text
rows to sort × columns carried × sort key size
```

Sorting after aggregation is cheaper than sorting raw rows.

### 5.6 `FINAL` Memory

`FINAL` may need to resolve multiple versions/collapsed rows and can increase memory/CPU.

### 5.7 Memory Optimization Patterns

- reduce group-by dimensions;
- pre-aggregate;
- use approximate aggregates;
- reduce right side join;
- use dictionaries;
- denormalize;
- avoid `FINAL`;
- sort smaller result;
- limit selected columns carried through sort;
- use rollups;
- set memory limits;
- allow external aggregation/sort when appropriate.

---

## 6. External Aggregation and External Sort

### 6.1 What Is Spill?

When memory threshold is exceeded, ClickHouse can spill intermediate data to disk for certain operations like aggregation/sort, depending settings.

This avoids query failure but costs disk I/O and time.

### 6.2 External Aggregation

Useful when:

- aggregation state too large for memory;
- query is batch/export;
- slower result acceptable;
- disk has capacity.

Not ideal for low-latency dashboard.

### 6.3 External Sort

Useful when:

- sort result large;
- memory bounded;
- batch/export.

### 6.4 Trade-Off

| Approach | Benefit | Cost |
|---|---|---|
| fail on memory limit | protects cluster | query fails |
| raise memory limit | query may finish | cluster risk |
| spill to disk | query may finish safely | slower, disk pressure |
| redesign query | best long-term | engineering work |

### 6.5 Rule

For interactive endpoints, prefer redesign/pre-aggregation over spill.

For offline exports, spill may be acceptable.

---

## 7. Disk I/O Cost Model

### 7.1 Read I/O

Reads come from:

- table scans;
- index/mark reads;
- column reads;
- cold cache reads;
- object storage reads;
- projection reads.

### 7.2 Write I/O

Writes come from:

- inserts;
- part creation;
- merges;
- mutations;
- TTL moves/deletes;
- materialized view target inserts;
- replication fetches;
- external sort/aggregation spill.

### 7.3 Merge I/O

Merge reads multiple parts and writes a new part:

```text
read old parts
decompress/merge/compress
write new part
remove old parts later
```

Merges can compete with queries.

### 7.4 Mutation I/O

Mutations can rewrite affected parts and are often write-heavy.

### 7.5 Disk Optimization Patterns

- batch inserts;
- avoid too many parts;
- avoid over-partitioning;
- reduce mutations;
- use TTL/drop partition for retention;
- avoid unnecessary projections/MVs;
- size disk with merge headroom;
- monitor disk queue/utilization;
- separate hot/cold workloads if needed.

### 7.6 Object Storage

If using S3/object storage, disk model includes:

- remote read latency;
- object request cost;
- cache hit/miss;
- local cache disk;
- network throughput;
- merge writes to object storage.

---

## 8. Network Cost Model

### 8.1 Network Consumers

Network is used for:

- distributed query fragments;
- partial aggregate transfer;
- distributed joins;
- replication part fetch;
- distributed inserts;
- object storage;
- client result transfer;
- backups/restores;
- inter-AZ traffic.

### 8.2 Distributed Query Network

Query:

```sql
SELECT
    user_id,
    count()
FROM events
GROUP BY user_id;
```

If high-cardinality, each shard sends many groups to coordinator.

Network + coordinator memory become bottleneck.

### 8.3 Client Result Transfer

Query:

```sql
SELECT *
FROM events
WHERE event_time >= ...
```

with millions of rows can make Java service/client bottleneck.

### 8.4 Replication Network

Backfills and many parts can saturate replication traffic.

### 8.5 Network Optimization Patterns

- aggregate on shards before transfer;
- reduce result rows;
- use rollups;
- avoid high-cardinality distributed group-by;
- compress client/server traffic;
- colocate compute/storage;
- avoid cross-region queries;
- use async export to object storage;
- isolate backfill traffic;
- load-balance coordinators.

---

## 9. Concurrency Model

### 9.1 One Query Can Use Many Threads

ClickHouse parallelizes within a query.

So concurrency cost:

```text
N concurrent queries × threads per query
```

can exceed CPU quickly.

### 9.2 Fan-Out Multiplies Work

In distributed cluster:

```text
100 concurrent dashboard queries
× 8 shards
× multiple threads per shard
```

can create huge actual execution concurrency.

### 9.3 Dashboard Storm

Common pattern:

```text
dashboard page loads
→ 20 widgets
→ each widget sends query
→ 50 users open dashboard at 9 AM
→ 1000 queries
```

Even if each query is “fast alone”, cluster collapses under concurrency.

### 9.4 BI Tool Storm

BI tools may:

- auto-refresh;
- run multiple queries per chart;
- run preview queries;
- issue count queries;
- run unbounded distincts;
- retry on timeout.

### 9.5 Retry Storm

Java service timeout at 10s, query continues on server, client retries, now duplicate queries run.

Need cancellation/query_id/timeout discipline.

### 9.6 Concurrency Optimization Patterns

- cache dashboard results;
- combine queries;
- use rollups;
- set max concurrent queries per user/profile;
- set max execution time;
- limit BI users;
- async exports;
- queue heavy jobs;
- use separate compute group/cluster;
- set query priorities;
- propagate cancellation.

---

## 10. Workload Classes

Classify workloads.

### 10.1 Interactive Dashboard

Characteristics:

- low latency;
- repeated query families;
- bounded dimensions;
- high concurrency;
- freshness requirement.

Strategy:

- rollups;
- serving tables;
- cache;
- strict limits;
- no arbitrary joins;
- no huge exports.

### 10.2 Drilldown

Characteristics:

- narrower filter;
- moderate result;
- user-driven.

Strategy:

- keyset pagination;
- alternate projection/table;
- selected columns;
- time/tenant/entity filters.

### 10.3 Ad-Hoc Exploration

Characteristics:

- unpredictable;
- can be expensive;
- used by analysts.

Strategy:

- separate user/profile;
- lower priority;
- query limits;
- sample/rollups;
- maybe separate compute.

### 10.4 Export

Characteristics:

- large result;
- not low-latency;
- can be async.

Strategy:

- job queue;
- object storage output;
- throttling;
- off-peak execution;
- separate compute.

### 10.5 Backfill/Rebuild

Characteristics:

- heavy read/write;
- can affect merges/cache;
- operational.

Strategy:

- schedule;
- isolate;
- partition-based;
- monitor;
- pause/throttle if cluster unhealthy.

### 10.6 Official Report

Characteristics:

- correctness/reproducibility > latency.

Strategy:

- snapshot/version;
- validation;
- controlled source watermark;
- async generation.

---

## 11. Query Limits and Guardrails

### 11.1 Why Limits Matter

Limits protect cluster from:

- accidental full scan;
- BI misuse;
- API bug;
- malicious query;
- runaway join;
- high-cardinality aggregation;
- huge result.

### 11.2 Common Limit Areas

- max execution time;
- max memory usage;
- max result rows/bytes;
- max read rows/bytes;
- max concurrent queries;
- max threads;
- max temporary data on disk;
- join limits;
- distributed query settings.

Exact setting names and behavior should be checked for your version.

### 11.3 Limits Per User/Profile

Different users:

```text
dashboard_user:
  strict low-latency limits

bi_user:
  moderate limits

export_user:
  longer execution, output controlled

admin_user:
  high but audited

ingestion_user:
  insert-focused
```

### 11.4 API-Level Limits

Database limits are last line of defense. Java service should enforce earlier:

- date range;
- dimension count;
- allowed filters;
- result limit;
- export threshold;
- tenant scope;
- query family routing.

### 11.5 Fail Fast

Better:

```text
Reject query: date range too large for interactive endpoint.
```

than:

```text
Run huge query, timeout, retry, overload cluster.
```

---

## 12. Workload Isolation

### 12.1 Isolation Dimensions

You can isolate by:

- user/profile;
- database/table;
- cluster;
- replica/compute group;
- queue/job type;
- time schedule;
- resource settings;
- network endpoint;
- materialized serving tables.

### 12.2 Same Cluster, Different Profiles

Use for moderate isolation.

Example:

```text
dashboard profile:
  short timeout
  low memory
  high priority

export profile:
  longer timeout
  lower concurrency
  lower priority
```

### 12.3 Separate Compute Group/Cluster

Use when:

- backfills affect dashboards;
- BI users unpredictable;
- exports large;
- regulatory report generation must not disturb operations;
- cloud compute groups available.

### 12.4 Separate Tables

Serving tables isolate query workload from raw table scans.

```text
raw_events → heavy storage
daily_rollups → dashboard
official_snapshots → reports
```

### 12.5 Workload Isolation for Java Systems

Route by endpoint:

```text
/dashboard/* → dashboard compute/profile
/export/* → export queue/profile
/admin/backfill → offline compute/profile
/report/official → report compute/profile
```

---

## 13. Capacity Planning

### 13.1 Start with Workload Inventory

List:

```text
ingestion rows/sec
compressed bytes/day
retention
dashboard QPS
ad-hoc users
exports/day
backfill size
peak concurrency
freshness SLA
latency SLA
replication factor
```

### 13.2 Storage Estimate

Raw estimate:

```text
daily compressed data × retention days × replicas × overhead
```

Add:

- merge headroom;
- temporary disk;
- projections;
- materialized views;
- rollups;
- backups;
- object storage archive.

Example:

```text
500 GB/day compressed raw
retention 180 days
replication factor 2
raw = 500 × 180 × 2 = 180 TB
plus 30% headroom = 234 TB
plus rollups/projections
```

### 13.3 Compute Estimate

Estimate:

```text
peak query scan bytes/sec
aggregation CPU
concurrent queries
ingestion CPU
merge CPU
background workload
```

Benchmarks on realistic data are required. Formula only guides initial sizing.

### 13.4 Memory Estimate

Memory for:

- high-cardinality aggregations;
- joins;
- concurrent queries;
- caches;
- background merges;
- OS/page cache;
- query result buffers.

If query peak memory = 8GB and 20 concurrent queries possible:

```text
160GB just for those queries
```

not counting other overhead.

### 13.5 Disk I/O Estimate

Include:

- query scans;
- inserts;
- merges;
- mutations;
- replication;
- backfills;
- spill.

Merges can roughly multiply write/read I/O beyond raw ingestion.

### 13.6 Network Estimate

Include:

- distributed query partials;
- replication factor;
- object storage traffic;
- client exports;
- cross-AZ costs.

### 13.7 Capacity Planning Rule

Plan for:

```text
steady state + peak + failure mode + backfill + growth
```

Not just average daily ingestion.

---

## 14. Scale-Up vs Scale-Out vs Redesign

### 14.1 Scale-Up

Add bigger node:

- more CPU;
- more RAM;
- faster disk;
- larger disk.

Good if:

- single-node bottleneck;
- simpler ops desired;
- query not distributed-friendly;
- coordinator memory issue.

Limitations:

- hardware ceiling;
- cost;
- no horizontal fault isolation.

### 14.2 Scale-Out

Add shards/replicas.

Good if:

- data volume too large;
- scan workload parallelizable;
- ingestion too high;
- HA needed;
- storage beyond one node.

Risks:

- network overhead;
- sharding skew;
- distributed joins;
- coordinator bottleneck;
- operational complexity.

### 14.3 Redesign

Often best:

- new sorting key;
- rollup;
- materialized view;
- denormalization;
- projection;
- query guardrail;
- async export;
- separate workload.

### 14.4 Decision Rule

If query reads 100x more data than needed, scale won't fix the waste elegantly.

Fix design first.

---

## 15. CPU-Bound Runbook

Symptoms:

- high CPU utilization;
- query durations high;
- read_bytes not extreme;
- disk not saturated;
- many expression-heavy queries.

Check:

```sql
system.query_log
ProfileEvents
EXPLAIN PIPELINE
top queries by CPU-related events if available
```

Common causes:

- JSON parsing;
- regex;
- string transformations;
- high-cardinality hashing;
- exact aggregates;
- many concurrent dashboards;
- compression/decompression heavy columns.

Actions:

1. Promote/materialize hot fields.
2. Reduce selected columns.
3. Use rollups.
4. Use approximate aggregate if allowed.
5. Reduce concurrency.
6. Cache dashboard results.
7. Scale CPU if design already good.

---

## 16. Memory-Bound Runbook

Symptoms:

- memory limit exceptions;
- OOM risk;
- high query memory;
- coordinator memory high.

Check:

```sql
SELECT
    query_id,
    query_duration_ms,
    read_rows,
    result_rows,
    formatReadableSize(memory_usage),
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY memory_usage DESC
LIMIT 20;
```

Common causes:

- high-cardinality GROUP BY;
- `uniqExact`;
- big join;
- sort;
- `FINAL`;
- distributed final aggregation;
- huge result.

Actions:

1. Reduce cardinality.
2. Pre-aggregate/rollup.
3. Use approximate.
4. Reduce join right side.
5. Use dictionary/denormalization.
6. Sort smaller data.
7. Avoid `FINAL`.
8. Use external aggregation/sort for offline jobs.
9. Set per-user memory limits.
10. Isolate heavy users.

---

## 17. Disk-Bound Runbook

Symptoms:

- high disk utilization;
- query scan slow;
- merges slow;
- inserts slow;
- parts accumulating.

Check:

```sql
system.parts
system.merges
system.mutations
system.query_log read_bytes
disk metrics from OS/cloud
```

Common causes:

- full scans;
- too many parts;
- background merges;
- mutations;
- TTL moves;
- backfill;
- cold cache;
- insufficient disk bandwidth.

Actions:

1. Reduce scan via query/schema.
2. Fix ingestion batching.
3. Reduce partition fragmentation.
4. Schedule backfills.
5. Avoid mutation storm.
6. Add disk bandwidth.
7. Separate hot/cold workloads.
8. Use rollups.

---

## 18. Network-Bound Runbook

Symptoms:

- distributed query slow;
- high network throughput;
- coordinator waits;
- replication lag;
- object storage reads slow;
- huge result transfer.

Check:

```sql
result_bytes in query_log
query_thread_log across cluster
system.replication_queue
system.distribution_queue
cloud/network metrics
```

Common causes:

- high-cardinality distributed aggregation;
- distributed joins;
- huge exports;
- replication during backfill;
- cross-AZ traffic;
- cold object storage scan;
- all app traffic through one node.

Actions:

1. Pre-aggregate.
2. Reduce result size.
3. Async export.
4. Colocate joins.
5. Denormalize.
6. Use dictionaries.
7. Load-balance coordinators.
8. Avoid cross-region query path.
9. Isolate backfills.

---

## 19. Concurrency-Bound Runbook

Symptoms:

- p50 okay, p99 bad;
- query fine alone;
- cluster slow during peak;
- many similar queries;
- timeouts/retries.

Check:

```sql
system.processes
system.query_log grouped by time/query family/user
application logs
dashboard traffic
BI activity
```

Query:

```sql
SELECT
    toStartOfMinute(event_time) AS minute,
    user,
    count() AS queries,
    quantile(0.95)(query_duration_ms) AS p95_ms,
    sum(read_rows) AS read_rows
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 1 HOUR
GROUP BY
    minute,
    user
ORDER BY minute;
```

Actions:

1. Add API caching.
2. Combine dashboard queries.
3. Use rollups.
4. Limit concurrency per user.
5. Queue exports.
6. Set timeouts.
7. Prevent retry storms.
8. Use workload isolation.
9. Scale compute if workload is valid.

---

## 20. Coordinator-Bound Runbook

Symptoms:

- distributed query coordinator high CPU/memory;
- remote shards finish but query slow;
- high-cardinality group by;
- huge final merge;
- all clients hit same node.

Check:

- query_thread_log per host;
- query_log initial vs remote fragments;
- host resource metrics;
- load balancer distribution.

Actions:

1. Balance client queries across nodes.
2. Reduce fan-in.
3. Pre-aggregate on shards.
4. Use rollups.
5. Avoid high-cardinality distributed group by.
6. Increase coordinator memory if needed.
7. Use separate coordinator/compute groups if available.

---

## 21. Result Handling and Java Client Bottlenecks

### 21.1 Result Size Can Dominate

If ClickHouse produces result quickly but Java service slowly reads/transforms/serializes it, bottleneck is client side.

Symptoms:

- query log duration maybe high due to sending result;
- result_bytes large;
- Java memory high;
- HTTP timeout;
- GC pressure;
- frontend slow.

### 21.2 Java Anti-Patterns

- loading entire result into memory;
- converting huge result to list before streaming;
- JSON serializing millions of rows synchronously;
- no backpressure;
- no max result row;
- retrying export request;
- returning CSV through app server instead of object storage.

### 21.3 Better Patterns

- stream result;
- page/keyset for small result;
- aggregate server-side;
- async export;
- write export to object storage;
- compress response;
- enforce result limit;
- use binary formats where appropriate;
- avoid mapping every row into heavy object if not needed.

### 21.4 Query Output Formats

ClickHouse supports multiple formats. For Java services:

- JSON convenient but heavier;
- RowBinary/Native can be faster for internal pipelines;
- CSV/Parquet useful for exports depending path.

Choose based on use case.

---

## 22. Query Cache / Application Cache

### 22.1 Caching Can Help

Dashboards often repeat same query.

Cache candidates:

- dashboard summary;
- top-N lists;
- recent rollup results;
- metadata/dictionaries;
- official report snapshots.

### 22.2 Cache Risks

- stale data;
- tenant security leak;
- wrong cache key;
- high-cardinality cache explosion;
- invalidation complexity;
- hiding slow query root cause.

### 22.3 Better Cache Key

Include:

- tenant;
- user access scope;
- query family;
- dimensions;
- filters;
- time bucket;
- freshness watermark;
- version.

### 22.4 Cache + Freshness

Cache by data watermark:

```text
cache key includes max_ingest_bucket
```

This avoids serving stale data unexpectedly.

---

## 23. Backpressure and Load Shedding

### 23.1 Why Needed

When ClickHouse is overloaded, Java services should not keep adding load blindly.

### 23.2 Signals

- query timeout rate;
- memory limit exceeded;
- too many concurrent queries;
- replication lag;
- distribution queue backlog;
- CPU/disk saturation;
- error rate.

### 23.3 Strategies

- reject heavy interactive query;
- degrade dashboard to cached data;
- disable expensive dimensions temporarily;
- queue export;
- reduce refresh rate;
- backoff retries;
- circuit breaker;
- priority routing;
- show freshness warning.

### 23.4 Better UX

Instead of failing randomly:

```text
Data is delayed. Showing cached data from 10:25.
```

or:

```text
Export has been queued.
```

---

## 24. Incident Scenario: Dashboard Storm

### 24.1 Scenario

At 9 AM:

- 500 users open dashboard;
- each dashboard runs 15 queries;
- queries hit raw events;
- p99 jumps from 1s to 45s;
- Java service retries on 10s timeout;
- ClickHouse CPU/memory saturated.

### 24.2 Immediate Actions

1. Disable retries for timed-out long queries or ensure cancellation.
2. Reduce dashboard refresh rate.
3. Enable cached responses.
4. Kill runaway queries if needed.
5. Apply per-user/per-endpoint concurrency limits.
6. Route heavy widgets to rollups or temporarily disable.
7. Monitor system.processes and query_log.

### 24.3 Long-Term Fix

- combine widget queries;
- create serving rollups;
- dashboard cache;
- query family limits;
- separate dashboard compute;
- p95/p99 monitoring;
- load test dashboard open storm.

---

## 25. Incident Scenario: Backfill Kills Cluster

### 25.1 Scenario

Backfill job loads 2 years data:

- creates many small parts;
- triggers merges;
- replication queue grows;
- dashboards slow;
- disks near full.

### 25.2 Immediate Actions

1. Pause/throttle backfill.
2. Check part count.
3. Check merges/replication queue.
4. Ensure disk headroom.
5. Prioritize production queries.
6. Avoid `OPTIMIZE FINAL` panic.
7. Resume in partition-sized batches.

### 25.3 Long-Term Fix

- batch larger;
- load by partition;
- shadow table + swap;
- run off-peak;
- use separate compute/cluster;
- pre-sort data if useful;
- monitor ingestion batch metrics.

---

## 26. Incident Scenario: Memory OOM from BI Query

### 26.1 Scenario

Analyst runs:

```sql
SELECT
    user_id,
    session_id,
    trace_id,
    uniqExact(request_id)
FROM logs
WHERE timestamp >= now() - INTERVAL 180 DAY
GROUP BY
    user_id,
    session_id,
    trace_id;
```

### 26.2 Immediate Actions

- kill query if cluster at risk;
- apply BI profile memory/time limits;
- move query to offline/export flow;
- explain safe query dimensions.

### 26.3 Long-Term Fix

- semantic layer;
- BI dataset over rollups;
- approximate metrics;
- max group-by dimensions;
- async job system;
- separate BI compute.

---

## 27. Capacity Planning Example: Product Events

### 27.1 Inputs

```text
Events: 5 billion/day
Compressed raw: 1 TB/day
Retention raw: 90 days
Rollups: 10% of raw
Replication factor: 2
Peak dashboard QPS: 200
Average query reads from rollup: 200 MB
Ad-hoc users: 20
Exports: 5/day, each 100 GB result
```

### 27.2 Storage

Raw:

```text
1 TB/day × 90 × 2 = 180 TB
```

Rollups:

```text
0.1 TB/day × 365 × 2 = 73 TB
```

Headroom:

```text
+30-50% for merges/backfill/temp
```

### 27.3 Query Capacity

Dashboard:

```text
200 QPS × 200 MB = 40 GB/s read demand
```

If cached/rollup query actually hits less due to cache, okay. If raw, impossible/expensive.

### 27.4 Export Capacity

100 GB result × 5/day should be async and isolated. Do not serve through synchronous API.

### 27.5 Conclusion

Need:

- rollups;
- dashboard cache;
- async exports;
- workload isolation;
- sufficient disk/network;
- strict BI limits.

---

## 28. Capacity Planning Example: Regulatory Case Management

### 28.1 Inputs

```text
Case events: 100 million/day
Compressed raw: 80 GB/day
Retention raw: 7 years
Official monthly reports
Dashboard current backlog every minute
Ad-hoc audit queries
Replication factor: 2
```

### 28.2 Storage

Raw:

```text
80 GB × 365 × 7 × 2 ≈ 409 TB
```

This suggests:

- hot/cold storage;
- object storage archive;
- rollups;
- snapshots.

### 28.3 Query Strategy

- current backlog from current_state table;
- monthly report from rollup/snapshot;
- audit drilldown by case_id from case-optimized table/projection;
- cold historical export async.

### 28.4 Resource Strategy

- dashboard compute separate from report/backfill if possible;
- official report snapshot generated after watermark;
- raw 7-year scan not used for normal dashboard.

---

## 29. Observability Queries for Resource Analysis

### 29.1 Top CPU-ish Query Families

If query family encoded in query_id or comment, group by it.

```sql
SELECT
    extract(query_id, '^[^/]+/([^/]+)') AS family,
    count() AS queries,
    quantile(0.95)(query_duration_ms) AS p95_ms,
    sum(read_rows) AS total_read_rows,
    formatReadableSize(sum(read_bytes)) AS total_read_bytes,
    formatReadableSize(max(memory_usage)) AS max_memory
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 1 HOUR
GROUP BY family
ORDER BY total_read_bytes DESC;
```

Adapt regex to your query_id convention.

### 29.2 Concurrency Over Time

```sql
SELECT
    toStartOfMinute(event_time) AS minute,
    count() AS finished_queries,
    quantile(0.95)(query_duration_ms) AS p95_ms,
    sum(read_rows) AS rows_read,
    formatReadableSize(sum(read_bytes)) AS bytes_read
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 6 HOUR
GROUP BY minute
ORDER BY minute;
```

### 29.3 Top Memory Queries

```sql
SELECT
    event_time,
    query_id,
    user,
    formatReadableSize(memory_usage) AS memory,
    query_duration_ms,
    read_rows,
    result_rows,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY memory_usage DESC
LIMIT 50;
```

### 29.4 Big Result Queries

```sql
SELECT
    event_time,
    query_id,
    user,
    result_rows,
    formatReadableSize(result_bytes) AS result_bytes,
    query_duration_ms,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
ORDER BY result_bytes DESC
LIMIT 50;
```

### 29.5 Background Pressure

```sql
SELECT *
FROM system.merges
ORDER BY elapsed DESC;
```

```sql
SELECT
    database,
    table,
    mutation_id,
    is_done,
    parts_to_do,
    latest_fail_reason
FROM system.mutations
WHERE is_done = 0;
```

---

## 30. Java API Resource Guardrails

### 30.1 Required Guardrails

For each endpoint:

- max time range;
- max dimensions;
- max result rows;
- required tenant/scope;
- allowed metric functions;
- exact vs approximate policy;
- sync vs async threshold;
- timeout;
- memory settings if needed;
- query id;
- cancellation on client disconnect;
- retry policy.

### 30.2 Query Cost Estimation

Before running, estimate:

```text
table
time range
tenant size
dimension cardinality
expected result rows
raw vs rollup
sync vs async
```

### 30.3 Reject or Reroute

If too expensive:

```text
reject with explanation
or queue as export
or use approximate
or use rollup
or reduce dimensions
```

### 30.4 Prevent Retry Storm

If query times out:

- cancel server query;
- do not blindly retry expensive queries;
- use idempotency for inserts;
- exponential backoff;
- circuit breaker.

### 30.5 Streaming Results

For large but allowed results:

- stream from ClickHouse;
- stream to object storage;
- avoid materializing full result in Java heap;
- apply backpressure;
- monitor client disconnect.

---

## 31. Decision Matrix: What To Do When Resource Is Exhausted

| Bottleneck | First Fix | Second Fix | Last Resort |
|---|---|---|---|
| CPU | reduce expressions/JSON, rollup | materialize fields, cache | add CPU |
| Memory aggregation | reduce cardinality, rollup | approximate/spill offline | add RAM |
| Memory join | reduce right side | dictionary/denormalize | add RAM |
| Disk scan | reduce read bytes | better sorting/projection | faster disks |
| Disk merge | fix inserts/parts | schedule backfill | add disk/IO |
| Network distributed | reduce fan-in/result | pre-aggregate/shard better | faster network |
| Coordinator | reduce high-cardinality merge | balance coordinators | bigger coordinator |
| Concurrency | cache/limits | workload isolation | add compute |
| Result transfer | aggregate/limit | async export | scale app/network |
| Replica lag | fix parts/network/disk | throttle ingestion | add replicas/resources |

---

## 32. Common Anti-Patterns

### 32.1 Increasing Limits Instead of Reducing Work

Raising memory/time limits can hide bad queries until cluster fails.

### 32.2 Treating All Queries Equally

Dashboard, export, BI, backfill, and report generation need different controls.

### 32.3 No Query Family Observability

Without query family metrics, every incident is rediscovery.

### 32.4 All Traffic to One Node

Coordinator bottleneck.

### 32.5 Synchronous Exports

Large result through API server causes timeouts and memory pressure.

### 32.6 Unlimited BI Access

Analyst query can harm production dashboard.

### 32.7 No Backpressure

Timeouts trigger retries and amplify load.

### 32.8 Ignoring Background Work

Merges/mutations/backfills are resource consumers.

### 32.9 Planning for Average

Peak and failure modes matter.

### 32.10 Scaling Before Modeling

Adding nodes to a bad query may increase distributed overhead without fixing root cause.

---

## 33. Production Checklist

### Resource Diagnosis

- [ ] Bottleneck classified: CPU/memory/disk/network/concurrency/coordinator.
- [ ] Query log metrics captured.
- [ ] Thread/distributed logs checked.
- [ ] Background work checked.
- [ ] Part count checked.
- [ ] Result size checked.
- [ ] Client/app bottleneck considered.

### Limits

- [ ] User profiles exist.
- [ ] Dashboard limits strict.
- [ ] BI limits separate.
- [ ] Export workload async.
- [ ] Memory/time/result limits configured.
- [ ] Retry/cancellation behavior defined.

### Workload Isolation

- [ ] Dashboards use rollups/serving tables.
- [ ] Backfills scheduled/throttled.
- [ ] Exports queued.
- [ ] BI isolated.
- [ ] Official reports snapshotted.
- [ ] Compute groups/clusters separated if needed.

### Capacity

- [ ] Storage growth forecasted.
- [ ] Merge headroom included.
- [ ] Query concurrency forecasted.
- [ ] Network and replication considered.
- [ ] Peak workload tested.
- [ ] Failure mode tested.

### Java/API

- [ ] Query IDs propagated.
- [ ] Max time range enforced.
- [ ] Max dimensions enforced.
- [ ] Result streaming used when needed.
- [ ] Async export threshold exists.
- [ ] Circuit breaker/backpressure implemented.
- [ ] Query family metrics collected.

---

## 34. Exercises

### Exercise 1: Classify Bottleneck

Query reads 20 GB, CPU at 95%, disk not saturated, uses JSONExtract on 2 billion rows.

Question:

```text
What bottleneck?
What fix?
```

Expected:

```text
CPU-bound due to runtime JSON parsing.
Promote/materialize JSON fields, reduce rows, rollup.
```

### Exercise 2: Memory OOM

Query groups by `user_id, session_id` over 180 days.

Expected:

```text
Memory-bound aggregation.
Reduce cardinality, use rollup, async export, approximate/topK if acceptable.
```

### Exercise 3: Disk Saturated

Cluster has many small parts and merges constantly running.

Expected:

```text
Disk/merge-bound due to ingestion/part problem.
Fix batch size, partitioning, backfill behavior; don't blindly OPTIMIZE FINAL.
```

### Exercise 4: Network Bottleneck

Distributed query groups by `trace_id` across all shards and returns huge partials.

Expected:

```text
Network/coordinator-bound.
Reduce fan-in, use trace-specific lookup table, async export, better sharding/projection.
```

### Exercise 5: Dashboard Storm

100 users open dashboard, each sends 20 queries.

Expected:

```text
Concurrency-bound.
Cache/combine queries, rollups, limits, workload isolation, prevent retry storm.
```

---

## 35. Summary

Performance engineering at resource level means understanding what the query consumes.

Core principles:

1. CPU is spent on decompression, expressions, hashing, joins, sorting, serialization.
2. Memory is spent on aggregation states, joins, sorts, distinct, `FINAL`, and coordinator merge.
3. Disk is consumed by scans, merges, mutations, inserts, spills, and backfills.
4. Network is consumed by distributed fan-in/fan-out, replication, object storage, and result transfer.
5. Concurrency multiplies every cost.
6. Background work is part of capacity.
7. Limits protect the cluster but do not replace good design.
8. Workload classes need different resource policies.
9. Java API must enforce guardrails before ClickHouse is overloaded.
10. Capacity planning must include peak, growth, backfill, and failure modes.

Practical sentence:

> A ClickHouse system is fast when query shape, physical layout, workload class, and resource limits agree with each other.

---

## 36. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi ClickHouse sesuai versi yang kamu pakai:

1. ClickHouse Docs — Query optimization.
2. ClickHouse Docs — Memory overcommit and memory limits.
3. ClickHouse Docs — Settings.
4. ClickHouse Docs — External aggregation.
5. ClickHouse Docs — External sorting.
6. ClickHouse Docs — system.query_log.
7. ClickHouse Docs — system.query_thread_log.
8. ClickHouse Docs — system.processes.
9. ClickHouse Docs — system.merges.
10. ClickHouse Docs — system.mutations.
11. ClickHouse Docs — Distributed table engine.
12. ClickHouse Docs — Workload scheduling / resource management if available in your version.
13. ClickHouse Docs — Performance best practices.
14. ClickHouse Docs — Cloud scaling and compute groups if using ClickHouse Cloud.

---

## 37. Status Seri

Part ini adalah:

```text
Part 025 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 026 — Data Modeling Patterns: Events, Metrics, Logs, Traces, Audits, and Case Lifecycles
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Performance Engineering II: Query Optimization Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-026.md">Part 026 — Data Modeling Patterns: Events, Metrics, Logs, Traces, Audits, and Case Lifecycles ➡️</a>
</div>

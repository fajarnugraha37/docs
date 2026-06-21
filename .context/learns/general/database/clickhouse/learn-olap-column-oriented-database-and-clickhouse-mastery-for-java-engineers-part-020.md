# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-020.md

# Part 020 — Distributed ClickHouse I: Shards, Replicas, Distributed Tables, and Query Routing

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **020 / 034**  
> Fokus: memahami arsitektur distributed ClickHouse dari first principles: shard, replica, local table, distributed table, query fan-out, insert routing, sharding key, cluster topology, dan production trade-offs.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah melewati fondasi penting:

- OLAP workload anatomy.
- Columnar storage.
- MergeTree internals.
- Sorting key.
- Partitioning.
- Compression.
- Ingestion architecture.
- Query execution.
- Aggregation.
- Materialized views.
- Projections dan skipping indexes.
- Joins.
- Table engines.
- Updates/deletes/deduplication/mutable analytics.

Sekarang kita mulai masuk ke distributed ClickHouse.

Distributed ClickHouse sering terlihat sederhana dari luar:

```text
tambah node → data lebih besar → query lebih cepat
```

Tapi kenyataannya lebih halus:

- scale-out bisa mempercepat scan besar;
- scale-out juga bisa menambah network cost;
- shard key bisa membuat query lokal atau fan-out;
- replica meningkatkan availability tetapi bukan pengganti shard;
- distributed table tidak menyimpan data;
- coordinator bisa menjadi bottleneck;
- join dan aggregation bisa berubah cost model-nya;
- insert routing bisa menentukan data balance;
- small insert problem bisa berlipat di cluster;
- operational failure mode jauh lebih banyak.

Part ini membangun mental model distributed ClickHouse tahap pertama. Part berikutnya akan memperdalam consistency, failover, ClickHouse Keeper, replication queue, dan operational realities.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu diharapkan mampu:

1. menjelaskan perbedaan shard dan replica;
2. memahami local table vs distributed table;
3. mendesain cluster topology dasar;
4. memilih sharding key berdasarkan query, tenant, write distribution, dan skew;
5. memahami insert routing ke distributed table;
6. memahami query routing, fan-out, partial aggregation, dan coordinator merge;
7. membaca kapan query distributed akan cepat atau lambat;
8. memahami replication sebagai table-level design;
9. mengenali distributed join anti-pattern;
10. merancang pola akses Java service ke ClickHouse cluster;
11. membangun checklist sebelum scale-out;
12. menghindari asumsi “cluster otomatis menyelesaikan semua bottleneck”.

---

## 2. Mental Model Utama: Cluster Bukan Satu Mesin Besar yang Sempurna

ClickHouse cluster sering dipakai seolah-olah satu database besar. Secara logical, kita ingin:

```text
SELECT ... FROM events
```

berjalan seolah data ada di satu tempat.

Secara physical, data tersebar:

```text
Shard 1: sebagian data
Shard 2: sebagian data
Shard 3: sebagian data
...
Replica A/B untuk availability
Coordinator menerima query
Coordinator mengirim query ke shards
Shards membaca local data
Shards mengirim partial result
Coordinator merge/finalize result
```

Jadi distributed query bukan magic.

Distributed query adalah:

```text
query decomposition
+ remote execution
+ network transfer
+ partial aggregation
+ result merging
+ failure handling
```

Scale-out membantu jika pekerjaan bisa dibagi dengan baik dan hasil partial relatif kecil.  
Scale-out bisa buruk jika pekerjaan tidak bisa dibagi, data skew, network besar, join tidak colocated, atau coordinator harus menggabungkan terlalu banyak data.

---

## 3. Single Node vs Cluster

### 3.1 Single Node

Single node ClickHouse sering sangat kuat.

Keuntungan:

- arsitektur sederhana;
- tidak ada network shuffle antar shard;
- tidak ada replication coordination complexity;
- debugging lebih mudah;
- biaya operasional rendah;
- latency predictable untuk banyak workload.

Keterbatasan:

- storage terbatas satu mesin;
- CPU/memory/disk bandwidth terbatas satu mesin;
- no high availability jika tidak ada replication external;
- maintenance/restart berdampak langsung;
- scale-up punya limit.

### 3.2 Cluster

Cluster membantu untuk:

- data volume lebih besar dari satu node;
- high availability;
- parallel scan across shards;
- higher ingestion throughput;
- workload isolation;
- horizontal scale.

Tetapi cluster menambah:

- network cost;
- topology design;
- distributed query planning;
- replica lag;
- operational monitoring;
- failure scenarios;
- schema consistency concerns;
- sharding/rebalancing complexity.

### 3.3 Rule of Thumb

Jangan scale-out hanya karena “big data”.  
Scale-out jika kamu punya alasan jelas:

1. satu node tidak cukup storage;
2. satu node tidak cukup CPU/scan throughput;
3. ingestion terlalu tinggi untuk satu node;
4. availability requirement butuh replicas;
5. query concurrency butuh workload spread;
6. operational maintenance butuh rolling behavior.

Jika bottleneck utamanya salah `ORDER BY`, too many parts, bad schema, atau join explosion, cluster tidak otomatis memperbaiki. Ia bisa memperbesar masalah.

---

## 4. Shard dan Replica

### 4.1 Shard

Shard adalah subset data.

Jika data 3 shards:

```text
Shard 1: user_id hash 0..33%
Shard 2: user_id hash 34..66%
Shard 3: user_id hash 67..99%
```

Atau tenant-based:

```text
Shard 1: tenant A, B, C
Shard 2: tenant D, E, F
Shard 3: tenant G, H, I
```

Tujuan shard:

- membagi storage;
- membagi scan;
- membagi ingestion;
- meningkatkan parallelism;
- mengurangi data per node.

### 4.2 Replica

Replica adalah salinan data shard yang sama.

```text
Shard 1 Replica A
Shard 1 Replica B

Shard 2 Replica A
Shard 2 Replica B

Shard 3 Replica A
Shard 3 Replica B
```

Tujuan replica:

- availability;
- failover;
- read scaling dalam beberapa pola;
- durability;
- rolling maintenance.

### 4.3 Shard vs Replica

| Konsep | Shard | Replica |
|---|---|---|
| Menyimpan data berbeda? | Ya | Tidak, salinan data shard yang sama |
| Menambah kapasitas storage? | Ya | Tidak secara logical; menambah copy |
| Menambah availability? | Tidak sendiri | Ya |
| Menambah query parallelism data partition? | Ya | Bisa untuk read load, bukan membagi data |
| Risiko utama | skew, bad shard key | lag, consistency, replication queue |
| Contoh | 4 shards | 2 replicas per shard |

### 4.4 Topology Common

```text
3 shards × 2 replicas = 6 ClickHouse servers
```

Data logical dibagi 3. Tiap bagian punya 2 copy.

---

## 5. Local Table dan Distributed Table

### 5.1 Local Table

Local table menyimpan data pada node tertentu.

Contoh:

```sql
CREATE TABLE events_local
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_name LowCardinality(String),
    user_id UInt64
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/events_local',
    '{replica}'
)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_name, user_id);
```

`events_local` ada di setiap node, tetapi data di masing-masing shard berbeda.

### 5.2 Distributed Table

Distributed table adalah façade.

```sql
CREATE TABLE events
AS events_local
ENGINE = Distributed(
    my_cluster,
    analytics,
    events_local,
    cityHash64(tenant_id, user_id)
);
```

Distributed table tidak menyimpan data utama. Ia mengarahkan query/insert ke local tables di cluster.

### 5.3 Query ke Distributed Table

```sql
SELECT
    toDate(event_time) AS day,
    event_name,
    count()
FROM events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY
    day,
    event_name;
```

Secara physical:

```text
client → node/coordinator
coordinator → remote shards
each shard reads events_local
each shard computes partial aggregation
coordinator merges partial results
client receives final result
```

### 5.4 Query ke Local Table

```sql
SELECT count()
FROM events_local;
```

Ini hanya membaca data di node tersebut.

Useful untuk:

- debugging shard;
- local health checks;
- part inspection;
- verifying data distribution;
- comparing replicas.

### 5.5 Common Mistake

Engineer sering mengira:

```text
events = table yang menyimpan data
```

Padahal:

```text
events = Distributed façade
events_local = actual persisted storage
```

---

## 6. Replicated Local Tables + Distributed Façade Pattern

Pattern umum production self-managed:

```text
events_local:
  ReplicatedMergeTree on every node

events:
  Distributed over events_local
```

DDL concept:

```sql
CREATE TABLE events_local ON CLUSTER my_cluster
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_name LowCardinality(String),
    user_id UInt64
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/events_local',
    '{replica}'
)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_name, user_id);
```

```sql
CREATE TABLE events ON CLUSTER my_cluster
AS events_local
ENGINE = Distributed(
    my_cluster,
    analytics,
    events_local,
    cityHash64(tenant_id, user_id)
);
```

Benefits:

- data stored locally with replication;
- app queries one logical table;
- app can insert into distributed table;
- cluster can route by sharding key;
- replicas provide availability.

Risks:

- bad sharding key causes imbalance;
- distributed queries can fan out;
- insert failures can be asynchronous depending settings;
- local/distributed schema must stay aligned;
- `ON CLUSTER` requires coordination.

---

## 7. Cluster Configuration Mental Model

ClickHouse cluster is configured with:

- cluster name;
- shards;
- replicas;
- host/port;
- macros like `{shard}`, `{replica}`;
- Keeper/ZooKeeper for replicated engines;
- user/security/network settings.

Conceptual config:

```xml
<remote_servers>
  <my_cluster>
    <shard>
      <replica>
        <host>ch-01</host>
        <port>9000</port>
      </replica>
      <replica>
        <host>ch-02</host>
        <port>9000</port>
      </replica>
    </shard>
    <shard>
      <replica>
        <host>ch-03</host>
        <port>9000</port>
      </replica>
      <replica>
        <host>ch-04</host>
        <port>9000</port>
      </replica>
    </shard>
  </my_cluster>
</remote_servers>
```

Macros:

```xml
<macros>
  <shard>01</shard>
  <replica>ch-01</replica>
</macros>
```

These macros allow replicated table paths to be unique and consistent.

Important:

- cluster config must be consistent;
- wrong shard/replica macros can cause data placement issues;
- replicated table path must be designed carefully;
- production automation should own config generation.

---

## 8. Query Execution in a Distributed Table

### 8.1 Simple Count

```sql
SELECT count()
FROM events;
```

Execution:

```text
Coordinator sends count query to every shard.
Each shard counts local rows.
Coordinator sums counts.
```

Efficient if network returns only partial counts.

### 8.2 Group By Query

```sql
SELECT
    event_name,
    count()
FROM events
WHERE event_time >= today() - 7
GROUP BY event_name;
```

Execution:

```text
Each shard:
  reads local data
  filters by event_time
  groups by event_name
  returns partial counts

Coordinator:
  merges partial counts by event_name
```

Efficient if group cardinality is small/medium.

### 8.3 High Cardinality Group By

```sql
SELECT
    user_id,
    count()
FROM events
GROUP BY user_id;
```

If `user_id` high cardinality, each shard returns many groups. Coordinator must merge huge partial result.

Bottleneck may shift from scan to:

- network transfer;
- coordinator memory;
- final aggregation;
- result serialization.

### 8.4 Distributed ORDER BY

```sql
SELECT *
FROM events
ORDER BY event_time DESC
LIMIT 100;
```

Each shard may produce local top rows, coordinator merges.

Could be efficient with proper order and limit. But if sort key doesn't help, each shard may scan/sort large data.

### 8.5 Distributed JOIN

If join tables are not colocated, network cost can explode.

We covered this in Part 017, but in distributed context it is often the major failure mode.

---

## 9. Fan-Out and Fan-In

### 9.1 Fan-Out

A query against Distributed table may be sent to all shards.

```text
1 client query
→ 8 shard queries
→ each shard may use many threads
```

High concurrency means fan-out multiplies workload.

Example:

```text
100 concurrent API queries
× 8 shards
= 800 remote shard query fragments
```

### 9.2 Fan-In

Partial results come back to coordinator.

If partial results are small:

```text
fast
```

If partial results are huge:

```text
coordinator memory/network bottleneck
```

### 9.3 Fan-Out Is Not Always Bad

Fan-out is useful when:

- each shard scans independent data;
- filters are selective;
- partial aggregation reduces result;
- network returns compact result;
- coordinator merge is small.

### 9.4 Fan-Out Is Dangerous When

- query scans all shards for small tenant;
- high-cardinality groups return huge partials;
- distributed join broadcasts data;
- no time filter;
- result row count large;
- coordinator has limited memory;
- many concurrent dashboard queries.

---

## 10. Sharding Key

### 10.1 What Is Sharding Key?

In Distributed engine:

```sql
ENGINE = Distributed(
    cluster,
    database,
    local_table,
    sharding_key_expression
)
```

Example:

```sql
cityHash64(tenant_id, user_id)
```

This expression determines which shard receives inserted rows when inserting through Distributed table.

### 10.2 Goals of Sharding Key

A good sharding key balances:

1. data distribution;
2. query locality;
3. write distribution;
4. join locality;
5. tenant isolation;
6. skew resistance;
7. future scalability;
8. operational simplicity.

There is no universal best sharding key.

### 10.3 Common Sharding Keys

#### Random/Hash by Entity

```sql
cityHash64(user_id)
```

Pros:

- good distribution if user_id high cardinality;
- avoids hot shards;
- good for user-level queries.

Cons:

- tenant-level query may fan out;
- joins by tenant not local;
- large tenant spread across shards.

#### Tenant-Based

```sql
tenant_id
```

Pros:

- tenant query can be routed/local if optimized;
- tenant isolation simpler;
- tenant export/delete easier.

Cons:

- hot tenant can dominate one shard;
- uneven tenant sizes;
- rebalancing hard;
- one huge tenant breaks distribution.

#### Tenant + Entity Hash

```sql
cityHash64(tenant_id, user_id)
```

Pros:

- better distribution;
- keeps key deterministic;
- reduces pure tenant skew;
- good for multi-tenant event analytics.

Cons:

- tenant query still often fans out;
- tenant-local operations spread across shards.

#### Time-Based

```sql
toYYYYMM(event_time)
```

Usually bad as sharding key.

Pros:

- data by time chunk.

Cons:

- hot current time shard;
- poor parallelism for recent ingest;
- severe skew;
- old shards idle.

Use time for partitioning, not usually sharding.

#### Composite Business Key

```sql
cityHash64(tenant_id, case_id)
```

Good for case lifecycle analytics where case-related events should colocate.

Pros:

- case-level queries local;
- distributed by cases;
- tenant+case deterministic.

Cons:

- tenant-wide reports fan out;
- hot case rare but possible.

---

## 11. Sharding Key Design Framework

### Step 1: Identify Most Common Query Scope

Examples:

```text
tenant_id + time range
service + time range
case_id drilldown
user_id drilldown
global dashboard by day
```

### Step 2: Identify Largest Scan Queries

If most expensive query is tenant-wide monthly report, sharding by user may fan out but parallelize. That may be fine.

### Step 3: Identify Locality Needs

Locality matters for:

- joins;
- drilldowns;
- updates/deletes by entity;
- exports;
- tenant isolation;
- debugging.

### Step 4: Identify Skew

Ask:

- Are tenants similar size?
- Are some users extremely active?
- Are some services huge?
- Are event types skewed?
- Is one tenant 70% of data?

### Step 5: Identify Write Pattern

If all writes go to current month, time sharding creates hot shard.

If writes by tenant uneven, tenant sharding creates hot shard.

### Step 6: Consider Future Growth

A key that works for 2 shards may fail at 16 shards.

### Step 7: Simulate

Before choosing, simulate distribution:

```sql
SELECT
    cityHash64(tenant_id, user_id) % 8 AS shard,
    count()
FROM sample_events
GROUP BY shard
ORDER BY shard;
```

For tenant:

```sql
SELECT
    tenant_id % 8 AS shard,
    count()
FROM sample_events
GROUP BY shard
ORDER BY shard;
```

Distribution should be measured, not guessed.

---

## 12. Sharding and Sorting Key Are Different

This is critical.

### 12.1 Sorting Key

`ORDER BY` controls physical order within each local table.

```sql
ORDER BY (tenant_id, event_type, event_time, user_id)
```

Helps:

- sparse primary index;
- data skipping;
- compression;
- query scan reduction.

### 12.2 Sharding Key

Distributed engine key controls which shard receives rows.

```sql
cityHash64(tenant_id, user_id)
```

Helps:

- distribute data;
- route inserts;
- colocate related data;
- parallelize workload.

### 12.3 They Can Differ

Example:

```sql
ENGINE = Distributed(..., cityHash64(tenant_id, case_id))
```

Local table:

```sql
ORDER BY (tenant_id, event_type, event_time, case_id)
```

Sharding by case distributes cases. Sorting by tenant/event/time optimizes queries.

### 12.4 Anti-Pattern

Assuming sharding key accelerates local filtering like index.

It does not, unless query routing can prune shards or data locality reduces scanned shards.

---

## 13. Insert Routing

### 13.1 Insert Into Local Table

If app inserts directly into `events_local` on one node:

```sql
INSERT INTO events_local VALUES ...
```

Data goes to that node's local table.

Bad if app always connects to one node: all data lands on one shard.

### 13.2 Insert Into Distributed Table

```sql
INSERT INTO events VALUES ...
```

Distributed table computes sharding key and routes rows to shards.

Benefits:

- simpler app;
- automatic shard distribution;
- one logical endpoint.

Risks:

- insert buffering/queue behavior;
- remote shard failures;
- async insert behavior;
- harder to reason if not monitored;
- small inserts still bad.

### 13.3 Application-Side Routing

Java ingestion service can compute shard and insert directly to local shard.

Benefits:

- explicit control;
- better retry semantics sometimes;
- avoid extra hop;
- custom routing;
- easier per-shard batching.

Risks:

- app must know topology;
- rebalancing harder;
- failover logic needed;
- config complexity.

### 13.4 Managed Routing / Load Balancer

Use:

- ClickHouse Cloud endpoint;
- cluster proxy;
- load balancer;
- ingestion gateway.

Important: load balancing client connections is not the same as sharding rows correctly.

### 13.5 Insert Batching in Cluster

Batching still matters.

Bad:

```text
100 events/insert × 8 shards
```

Can create small parts per shard.

Good:

```text
large batches grouped by shard/partition
```

If inserting to Distributed table, it may split batch across shards. Ensure final per-shard batch remains sufficiently large.

---

## 14. Insert Failure Modes

### 14.1 Partial Insert Across Shards

If distributed insert routes rows to multiple shards and one shard fails, behavior depends on settings and mode.

You must understand:

- whether insert is synchronous;
- whether data is queued;
- whether retry duplicates;
- whether failure is visible to app;
- whether idempotency exists.

### 14.2 Retry Duplicates

Same as Part 019, but cluster makes it more complex.

Use:

- stable batch id;
- event id;
- dedup token where applicable;
- source offset tracking;
- reconciliation.

### 14.3 Distributed Insert Queue

Distributed table can queue data for remote shards. This can create:

- delayed delivery;
- local disk usage;
- backlog;
- surprises after remote shard recovers;
- duplicate concerns on retry.

Monitor distributed queues where relevant.

### 14.4 Replica Insert Path

With replicated local tables, insert to one replica gets replicated to others. Do not insert same rows independently to multiple replicas unless dedup/idempotency is designed.

### 14.5 Write Amplification

In cluster:

```text
insert batch
→ split by shard
→ local part creation
→ replication copies parts
→ background merges per replica
```

Small insert mistakes multiply by shards and replicas.

---

## 15. Query Routing and Shard Pruning

### 15.1 Can ClickHouse Avoid Some Shards?

Shard pruning depends on whether query predicate relates to sharding key and whether ClickHouse can infer target shard.

If sharding key is:

```sql
cityHash64(tenant_id)
```

and query:

```sql
WHERE tenant_id = 10
```

engine may be able to route/prune depending config/settings and expression.

If sharding key is:

```sql
cityHash64(tenant_id, user_id)
```

and query only has:

```sql
WHERE tenant_id = 10
```

it likely still needs all shards because user_id varies.

### 15.2 Practical View

Do not assume shard pruning. Measure.

Use system logs and query plans.

### 15.3 Tenant Query Example

If sharded by tenant:

```sql
Distributed(..., tenant_id)
```

A tenant-specific query can potentially hit one shard.

Good for:

- tenant isolation;
- per-tenant dashboards;
- exports;
- deletes.

Bad if tenants skew.

### 15.4 Hash Tenant+User

If sharded by `(tenant_id, user_id)`, tenant-specific query likely fans out but parallelizes.

Good for large tenants.

Trade-off:

```text
locality vs balance
```

---

## 16. Distributed Aggregation

### 16.1 Two-Stage Aggregation

Query:

```sql
SELECT
    event_name,
    count()
FROM events
GROUP BY event_name;
```

Execution:

```text
Shard 1: event_name counts
Shard 2: event_name counts
Shard 3: event_name counts
Coordinator: sum counts by event_name
```

This is efficient.

### 16.2 High Cardinality Aggregation

Query:

```sql
SELECT
    user_id,
    count()
FROM events
GROUP BY user_id;
```

Each shard may send many `user_id` groups.

Coordinator merges huge partials.

### 16.3 Optimization

Options:

- restrict time range;
- reduce dimensions;
- pre-aggregate;
- use rollup tables;
- route query to sharded by user table if beneficial;
- avoid interactive API for high-cardinality group by;
- use `LIMIT` carefully, not as scan reducer;
- use approximate functions where acceptable.

### 16.4 Distributed Distinct

`uniq(user_id)` can be distributed-friendly if using mergeable aggregate states.

Exact distinct across shards can be memory-heavy.

For rollups, `AggregatingMergeTree` with `uniqState/uniqMerge` can help.

---

## 17. Distributed Joins

### 17.1 Local Join

Good case:

```text
events and users both sharded by user_id
```

Each shard joins local events with local users.

### 17.2 Broadcast/Global Join

If right table is small, broadcasting can be acceptable.

Example dimension:

```text
country code mapping
event type labels
small tenant config
```

### 17.3 Bad Case

Large fact table joined with large dimension table sharded differently.

Cost:

- data exchange;
- large hash tables;
- network bottleneck;
- duplicate computation;
- coordinator pressure.

### 17.4 Strategy

Use:

- denormalization;
- dictionaries;
- colocated sharding;
- pre-joined serving table;
- materialized view;
- small filtered right side;
- pre-aggregation before join.

---

## 18. Distributed ORDER BY and LIMIT

### 18.1 LIMIT Alone Is Not Enough

```sql
SELECT *
FROM events
WHERE event_time >= today() - 30
LIMIT 100;
```

This may still query many shards. It may stop early in some cases but do not rely on it for cost control.

### 18.2 ORDER BY LIMIT

```sql
SELECT *
FROM events
ORDER BY event_time DESC
LIMIT 100;
```

Each shard may need to find its local top rows; coordinator merges.

If local sorting key helps, this can be efficient. If not, it may require large read/sort.

### 18.3 Top-N by Metric

```sql
SELECT
    user_id,
    count() AS c
FROM events
GROUP BY user_id
ORDER BY c DESC
LIMIT 100;
```

Requires aggregation first, then top-N. Can be heavy if user cardinality huge.

Pre-aggregation often better.

---

## 19. Data Skew

### 19.1 What Is Skew?

Skew means data or workload is unevenly distributed.

Example:

```text
Shard 1: 70% data
Shard 2: 10%
Shard 3: 10%
Shard 4: 10%
```

or:

```text
one tenant generates 90% queries
```

### 19.2 Why Skew Hurts

Distributed query latency often bounded by slowest shard.

```text
total latency ≈ max(shard latency) + coordination overhead
```

If one shard is huge/hot, cluster performs like the slow shard.

### 19.3 Skew Sources

- tenant size;
- time-based sharding;
- user/activity power law;
- service skew;
- region skew;
- bad hash key;
- data migration;
- backfill concentrated on one shard;
- hot partition.

### 19.4 Detecting Skew

Rows by shard:

```sql
SELECT
    hostName() AS host,
    count()
FROM clusterAllReplicas('my_cluster', analytics, events_local)
GROUP BY host
ORDER BY count() DESC;
```

Bytes by shard from `system.parts`:

```sql
SELECT
    hostName() AS host,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM clusterAllReplicas('my_cluster', system, parts)
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active
GROUP BY host
ORDER BY sum(rows) DESC;
```

Tenant skew:

```sql
SELECT
    tenant_id,
    count() AS rows
FROM events
GROUP BY tenant_id
ORDER BY rows DESC
LIMIT 20;
```

### 19.5 Handling Skew

Options:

- use hash composite key;
- split large tenant;
- dedicated shard for huge tenant;
- re-shard;
- use separate table for huge tenant;
- pre-aggregate hot workloads;
- workload isolate;
- throttle backfill;
- route tenant to cluster.

---

## 20. Multi-Tenant ClickHouse

### 20.1 Common Models

#### Shared Table, Shared Cluster

```text
all tenants in one events table
tenant_id column
```

Pros:

- simple;
- efficient for many small tenants;
- shared resources;
- easier schema management.

Cons:

- noisy neighbor;
- access control complexity;
- big tenant skew;
- deletion/export per tenant can be expensive.

#### Separate Tables Per Tenant

Pros:

- isolation;
- lifecycle per tenant;
- simpler tenant delete/export.

Cons:

- table explosion;
- schema migration complexity;
- many small parts;
- operational overhead.

#### Separate Database Per Tenant

Similar trade-offs; more isolation, more metadata overhead.

#### Separate Cluster Per Large Tenant

Pros:

- strong isolation;
- custom sizing;
- enterprise requirement.

Cons:

- cost;
- operations.

### 20.2 Sharding in Multi-Tenant Analytics

Option A:

```sql
Distributed(..., tenant_id)
```

Good for small/medium tenants and tenant-local query. Bad for skew.

Option B:

```sql
Distributed(..., cityHash64(tenant_id, user_id))
```

Better balance. Tenant query fans out.

Option C:

```sql
Distributed(..., cityHash64(tenant_id, case_id))
```

Good for case lifecycle systems.

Option D:

```text
hybrid:
- small tenants shared
- huge tenants isolated
```

Often best in real SaaS.

### 20.3 Query Guardrails

For multi-tenant Java API:

- always require tenant_id;
- enforce row-level access;
- limit time range;
- limit high-cardinality group by;
- isolate heavy export;
- pre-aggregate dashboard queries;
- monitor per-tenant resource usage.

---

## 21. Replication and Read Scaling

### 21.1 Can Replicas Serve Reads?

Yes, replicas can be used for read availability/load distribution depending query routing/settings.

But remember:

- replicas contain same shard data;
- replicas do not reduce data per shard;
- replica lag can matter;
- query consistency settings matter;
- load balancing across replicas must be understood.

### 21.2 Read From One Replica Per Shard

Typical distributed query selects one replica per shard.

```text
Shard 1 replica A
Shard 2 replica B
Shard 3 replica A
```

### 21.3 Read From Multiple Replicas?

For some patterns, replicas can help distribute concurrent queries. But one query generally needs one copy of each shard's data unless parallel replicas feature/settings are used.

### 21.4 Availability

If one replica down, query can use another replica.

If all replicas for a shard down, cluster cannot read that shard.

---

## 22. Schema Management with ON CLUSTER

### 22.1 Why ON CLUSTER

DDL must be applied consistently to all nodes.

```sql
CREATE TABLE events_local ON CLUSTER my_cluster ...
```

```sql
ALTER TABLE events_local ON CLUSTER my_cluster ADD COLUMN ...
```

### 22.2 Risks

- partial DDL failure;
- schema drift;
- old replicas with different columns;
- materialized view dependency;
- migration order issues;
- application deploying before DDL completes.

### 22.3 Migration Strategy

For Java/backend teams:

1. add nullable/defaulted column first;
2. deploy producer writing old+new compatible payload;
3. backfill if needed;
4. update query layer;
5. remove old fields only after consumers stop using;
6. use `ON CLUSTER`;
7. verify schema across cluster.

### 22.4 Schema Verification

```sql
SELECT
    hostName() AS host,
    name,
    type,
    default_kind,
    default_expression
FROM clusterAllReplicas('my_cluster', system, columns)
WHERE database = 'analytics'
  AND table = 'events_local'
ORDER BY host, position;
```

---

## 23. Observability for Distributed Tables

### 23.1 Key System Tables

Important:

- `system.clusters`
- `system.parts`
- `system.replicas`
- `system.replication_queue`
- `system.distribution_queue`
- `system.query_log`
- `system.query_thread_log`
- `system.merges`
- `system.mutations`
- `system.errors`
- `system.asynchronous_metrics`

### 23.2 Cluster Layout

```sql
SELECT *
FROM system.clusters
WHERE cluster = 'my_cluster';
```

### 23.3 Local Part Health

```sql
SELECT
    hostName() AS host,
    partition,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM clusterAllReplicas('my_cluster', system, parts)
WHERE database = 'analytics'
  AND table = 'events_local'
  AND active
GROUP BY
    host,
    partition
ORDER BY
    partition,
    host;
```

### 23.4 Query Log by Initial Query

Distributed query fragments can appear across nodes.

Useful fields:

- `initial_query_id`;
- `query_id`;
- `is_initial_query`;
- `read_rows`;
- `read_bytes`;
- `memory_usage`;
- `query_duration_ms`;
- `ProfileEvents`;
- `hostname`.

Example concept:

```sql
SELECT
    hostName() AS host,
    is_initial_query,
    query_duration_ms,
    read_rows,
    read_bytes,
    memory_usage,
    query
FROM clusterAllReplicas('my_cluster', system, query_log)
WHERE initial_query_id = '...'
ORDER BY event_time;
```

### 23.5 Distribution Queue

If using Distributed inserts:

```sql
SELECT *
FROM system.distribution_queue;
```

Look for:

- pending files;
- errors;
- delay;
- remote shard issues.

---

## 24. Capacity Planning for Distributed ClickHouse

### 24.1 Capacity Dimensions

You need to size:

- storage per shard;
- replicas;
- CPU;
- memory;
- disk bandwidth;
- network bandwidth;
- ingestion rate;
- merge capacity;
- query concurrency;
- coordinator resources.

### 24.2 Storage Formula

Rough:

```text
logical_data_size_compressed
× replicas
× overhead for merges
× safety margin
```

If 20 TB compressed logical data and replication factor 2:

```text
storage raw copy = 40 TB
+ merge headroom
+ temporary disk
+ future growth
```

### 24.3 Merge Headroom

Background merges need disk space. Do not fill disks near 100%.

### 24.4 Network

Distributed query and replication both use network.

Network consumers:

- insert forwarding;
- part replication;
- distributed query results;
- distributed joins;
- backups/restores;
- backfills.

### 24.5 Coordinator

Any node receiving distributed query can act as coordinator. If all app queries hit one node, that node can become bottleneck.

Use load balancing carefully.

---

## 25. Workload Isolation

### 25.1 Problem

Same cluster may handle:

- ingestion;
- dashboards;
- heavy ad-hoc analytics;
- exports;
- backfills;
- materialized view builds;
- mutation repair.

These workloads conflict.

### 25.2 Isolation Strategies

- separate user profiles/settings;
- query limits;
- memory limits;
- max execution time;
- separate clusters for heavy/offline workloads;
- separate tables/rollups for dashboards;
- route exports asynchronously;
- schedule backfills;
- use replicas/nodes for specific workload if architecture supports.

### 25.3 Java API Strategy

Interactive API should hit serving tables, not raw multi-billion-row fact tables for every request.

Pattern:

```text
frontend dashboard
→ Java analytics API
→ pre-aggregated/distributed serving tables
→ strict query guardrails
```

Heavy export:

```text
request export
→ enqueue job
→ offline query
→ write result to object storage
→ notify user
```

---

## 26. When Distributed ClickHouse Makes Query Slower

Distributed can be slower if:

1. query is tiny but fans out to all shards;
2. result cardinality high;
3. coordinator merges huge partials;
4. network latency dominates;
5. shard pruning not possible;
6. data skew means one shard dominates;
7. join broadcasts large table;
8. remote replicas lag/unhealthy;
9. cluster overloaded by merges/replication;
10. query lacks filtering on sort/partition keys.

Example:

```sql
SELECT *
FROM events
WHERE event_id = '...';
```

If sharded by `tenant_id,user_id`, and query only has `event_id`, it may hit all shards.

If point lookup by event_id is common, consider:

- including routable key in API;
- secondary lookup table;
- projection;
- dedicated table ordered/sharded by event_id;
- search index elsewhere.

---

## 27. Query Design for Distributed Tables

### 27.1 Always Include Tenant/Time Scope

Bad:

```sql
SELECT count()
FROM events;
```

Good:

```sql
SELECT count()
FROM events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 30 DAY;
```

### 27.2 Reduce Before Returning

Good:

```sql
SELECT
    day,
    event_name,
    count()
FROM events
WHERE ...
GROUP BY day, event_name;
```

Bad for API:

```sql
SELECT *
FROM events
WHERE ...
```

unless time/result is tightly bounded.

### 27.3 Avoid Unbounded High-Cardinality Grouping

Bad:

```sql
SELECT user_id, count()
FROM events
GROUP BY user_id;
```

for interactive dashboard over long range.

Better:

- top-N with pre-aggregation;
- sampled/approximate;
- async export;
- precomputed user activity table.

### 27.4 Pre-Aggregate on Shards

Materialized view target local tables can pre-aggregate per shard.

Distributed table over aggregate local tables returns much smaller data.

---

## 28. Java Service Patterns

### 28.1 Read Path

Java service should usually read from Distributed table:

```text
analytics.events
analytics.daily_rollups
analytics.case_current_state
```

But query builder must know:

- whether table is distributed;
- expected fan-out;
- allowed filters;
- cardinality risk;
- tenant/time guardrails.

### 28.2 Write Path Option A: Insert to Distributed Table

Simpler:

```java
INSERT INTO events VALUES ...
```

Pros:

- app not shard-aware;
- cluster handles routing.

Cons:

- less control over per-shard batching;
- need monitor distributed insert queue;
- retry semantics must be understood.

### 28.3 Write Path Option B: App-Side Shard Routing

Ingestion service computes:

```java
shard = hash(tenantId, userId) % shardCount;
```

Pros:

- efficient batching per shard;
- explicit retry;
- lower coordinator overhead.

Cons:

- topology coupling;
- rebalancing complexity;
- failover logic.

### 28.4 Recommended Progression

Start:

```text
insert to Distributed table with good batch size
```

Scale:

```text
dedicated ingestion service
batch by partition/shard
monitor queue
```

Advanced:

```text
app-side routing or managed ingestion
```

### 28.5 Connection Management

Do not send all traffic to one node unless intended.

Use:

- multiple hosts;
- load balancer aware of health;
- retries with idempotency;
- query timeout;
- per-query settings;
- compression;
- observability with query_id.

### 28.6 Query IDs

Set query_id from Java for traceability:

```text
analytics-api-request-id
```

Useful for tracking distributed query fragments.

---

## 29. Example: Regulatory Case Analytics Cluster

### 29.1 Workload

- multi-tenant case lifecycle events;
- case-level drilldown;
- tenant-level dashboards;
- official monthly reports;
- current backlog;
- audit trail;
- high availability required.

### 29.2 Topology

Initial production:

```text
3 shards × 2 replicas = 6 nodes
```

### 29.3 Sharding Key

For case events:

```sql
cityHash64(tenant_id, case_id)
```

Rationale:

- colocate events for same case;
- distribute large tenants by case;
- support case-level drilldown;
- tenant reports fan out but parallelize.

### 29.4 Local Table

```sql
CREATE TABLE case_events_local ON CLUSTER my_cluster
(
    tenant_id UInt64,
    case_id UUID,
    event_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    jurisdiction LowCardinality(String),
    severity_at_event LowCardinality(String),
    actor_user_id UInt64,
    ingest_time DateTime64(3)
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/case_events_local',
    '{replica}'
)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, jurisdiction, case_id);
```

### 29.5 Distributed Table

```sql
CREATE TABLE case_events ON CLUSTER my_cluster
AS case_events_local
ENGINE = Distributed(
    my_cluster,
    analytics,
    case_events_local,
    cityHash64(tenant_id, case_id)
);
```

### 29.6 Dashboard Query

```sql
SELECT
    toStartOfMonth(event_time) AS month,
    jurisdiction,
    severity_at_event,
    countDistinct(case_id) AS cases
FROM case_events
WHERE tenant_id = 10
  AND event_time >= '2026-01-01'
  AND event_time < '2026-07-01'
  AND event_type = 'CASE_OPENED'
GROUP BY
    month,
    jurisdiction,
    severity_at_event;
```

This fans out across shards but each shard filters/aggregates locally. Coordinator merges a moderate result.

### 29.7 Case Drilldown

```sql
SELECT *
FROM case_events
WHERE tenant_id = 10
  AND case_id = '...'
ORDER BY event_time;
```

Potential issue: unless shard pruning can infer from sharding key, query may still fan out. Application-side routing or local table query to correct shard can optimize advanced case drilldown.

### 29.8 Current State

Use `case_current_state_local` with same sharding key:

```sql
cityHash64(tenant_id, case_id)
```

This keeps case event and current state colocated for local joins if needed.

---

## 30. Example: Observability Logs Cluster

### 30.1 Workload

- logs high volume;
- queries by service/env/time;
- top routes by latency;
- error rate dashboards;
- retention 30-90 days;
- high ingestion throughput.

### 30.2 Sharding Key

Option:

```sql
cityHash64(service, trace_id)
```

or:

```sql
cityHash64(service, timestamp)
```

But beware time skew.

Often:

```sql
cityHash64(service, trace_id)
```

or tenant/service plus random-ish id provides balance.

### 30.3 Sorting Key

Local table:

```sql
ORDER BY (service, environment, timestamp, level)
```

Sharding key and sorting key differ.

### 30.4 Query

```sql
SELECT
    toStartOfMinute(timestamp) AS minute,
    countIf(level = 'ERROR') AS errors,
    count() AS total,
    errors / total AS error_rate
FROM logs
WHERE service = 'payment-api'
  AND environment = 'prod'
  AND timestamp >= now() - INTERVAL 1 HOUR
GROUP BY minute
ORDER BY minute;
```

If service data is distributed across shards, query fans out but parallelizes. This is okay if partial result is tiny.

---

## 31. Example: Product Analytics Cluster

### 31.1 Workload

- multi-tenant event analytics;
- DAU/WAU;
- funnel;
- session drilldown;
- user journey;
- dashboard by country/plan/device.

### 31.2 Sharding Key

```sql
cityHash64(tenant_id, user_id)
```

Rationale:

- user events colocated;
- distributes tenants by users;
- user journey queries can be local-ish;
- tenant dashboards fan out but parallelize.

### 31.3 Sorting Key

```sql
ORDER BY (tenant_id, event_name, event_time, user_id)
```

Rationale:

- dashboards by event/time;
- tenant filtering;
- event-specific analytics.

### 31.4 DAU Rollup

Raw table distributed by user.  
Rollup local table aggregates per shard.  
Distributed rollup merges aggregate states.

This avoids scanning raw for every dashboard.

---

## 32. Operational Anti-Patterns

### 32.1 Scaling Before Fixing Schema

Cluster won't save:

- `ORDER BY tuple()`;
- all columns `String`;
- all query `SELECT *`;
- no time filter;
- too many parts;
- high-cardinality group by explosion.

### 32.2 Sharding by Time

Creates hot shard and poor distribution.

### 32.3 Sharding by Tenant Without Skew Analysis

One enterprise tenant can dominate.

### 32.4 App Inserts Into One Local Table

All data lands on one shard.

### 32.5 All Queries Hit One Coordinator

Coordinator node becomes bottleneck.

### 32.6 Ignoring Distributed Insert Queue

Rows may be delayed or stuck.

### 32.7 Distributed Table Over Distributed Table

Can create unnecessary nested distributed execution.

### 32.8 Large Distributed Join Without Colocation

Network and memory explosion.

### 32.9 No Cluster-Wide Schema Migration Discipline

Schema drift causes query/insert failures.

### 32.10 No Per-Shard Observability

You cannot fix what you cannot see.

---

## 33. Production Checklist

### Cluster Topology

- [ ] How many shards?
- [ ] How many replicas per shard?
- [ ] Is replication required?
- [ ] Is Keeper/ZooKeeper available and monitored?
- [ ] Is storage sized with replica factor and merge headroom?
- [ ] Is network bandwidth sufficient?
- [ ] Is coordinator load balanced?

### Table Design

- [ ] Are local tables `Replicated*MergeTree` if HA required?
- [ ] Is Distributed table defined over local table?
- [ ] Is sharding key chosen deliberately?
- [ ] Is sorting key optimized independently?
- [ ] Is partition key aligned with retention?
- [ ] Is schema created with `ON CLUSTER`?
- [ ] Are local/distributed schemas consistent?

### Sharding Key

- [ ] Does it balance data?
- [ ] Does it avoid hot shard?
- [ ] Does it support common drilldowns?
- [ ] Does it support important joins/locality?
- [ ] Does it handle large tenants?
- [ ] Has distribution been simulated?
- [ ] What is rebalancing plan?

### Ingestion

- [ ] Does app insert to Distributed table or route shards explicitly?
- [ ] Are batches large enough after shard split?
- [ ] Are retries idempotent?
- [ ] Is distributed queue monitored?
- [ ] Are source offsets/batch IDs stored?
- [ ] Are inserts load-balanced safely?

### Querying

- [ ] Are tenant/time filters mandatory?
- [ ] Are high-cardinality dimensions guarded?
- [ ] Are raw scans avoided for dashboards?
- [ ] Are rollups used for frequent queries?
- [ ] Are distributed joins controlled?
- [ ] Are result sizes limited?
- [ ] Are query IDs propagated?

### Observability

- [ ] Is `system.parts` monitored across cluster?
- [ ] Is `system.replicas` monitored?
- [ ] Is `system.replication_queue` monitored?
- [ ] Is `system.distribution_queue` monitored?
- [ ] Is `system.query_log` collected from all nodes?
- [ ] Are shard-level row/byte distributions tracked?
- [ ] Are slowest shard and coordinator bottlenecks visible?

---

## 34. Exercises

### Exercise 1: Tenant Sharding

You have 1,000 tenants. One tenant has 45% of all data.

Question:

```text
Should you shard by tenant_id?
```

Expected reasoning:

- pure tenant_id sharding likely creates hot shard;
- consider hash(tenant_id, entity_id);
- isolate huge tenant;
- hybrid tenant strategy.

### Exercise 2: User Journey Analytics

Requirement:

```text
Fetch all events for a user journey quickly.
Tenant dashboards also common.
```

Candidate sharding:

```sql
cityHash64(tenant_id, user_id)
```

Question:

- What improves?
- What still fans out?

Expected:

- user journey colocated by user;
- tenant-wide dashboard fans out but parallelizes;
- sorting key still needs tenant/event/time optimization.

### Exercise 3: Case Lifecycle Analytics

Requirement:

```text
Case drilldown and current state join by case_id.
```

Candidate:

```sql
cityHash64(tenant_id, case_id)
```

Question:

- Why good?
- What report becomes fan-out?

Expected:

- colocates case events/current state;
- tenant-wide monthly report fans out;
- rollups can reduce cost.

### Exercise 4: Time Sharding

Candidate:

```sql
toYYYYMM(event_time)
```

Question:

- Why usually bad?

Expected:

- current month hot shard;
- historical queries skew;
- poor write distribution;
- time belongs better as partition key.

### Exercise 5: Distributed Query Slow

Query:

```sql
SELECT user_id, count()
FROM events
WHERE event_time >= today() - 180
GROUP BY user_id;
```

Problem:

```text
Coordinator OOM.
```

Question:

- Why?
- What solutions?

Expected:

- high-cardinality groups returned from shards;
- coordinator merges huge partial result;
- use pre-aggregation, restrict scope, async export, approximate/top-N, rollup, or better query shape.

---

## 35. Summary

Distributed ClickHouse is powerful, but it requires clear physical reasoning.

Core ideas:

1. Shard divides data; replica copies data.
2. Local table stores data; Distributed table routes queries/inserts.
3. Cluster helps when work can be split and partial results are compact.
4. Cluster hurts when fan-out/fan-in/network/coordinator cost dominates.
5. Sharding key controls distribution and locality, not local scan order.
6. Sorting key still controls local data skipping/compression.
7. Insert routing must be explicit and idempotent.
8. Distributed joins require colocation, small right side, dictionary, or precomputation.
9. Multi-tenant sharding must handle skew.
10. Observability must be cluster-wide and per-shard.

Practical sentence:

> Distributed ClickHouse is not “one bigger database”; it is many fast local column stores coordinated through deliberate routing, replication, and merging.

---

## 36. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi ClickHouse sesuai versi yang kamu pakai:

1. ClickHouse Docs — Distributed table engine.
2. ClickHouse Docs — Shards and replicas.
3. ClickHouse Docs — Replication and sharding.
4. ClickHouse Docs — ReplicatedMergeTree.
5. ClickHouse Docs — ClickHouse Keeper.
6. ClickHouse Docs — system.clusters.
7. ClickHouse Docs — system.parts.
8. ClickHouse Docs — system.replicas.
9. ClickHouse Docs — system.replication_queue.
10. ClickHouse Docs — system.distribution_queue.
11. ClickHouse Docs — Distributed query execution.
12. ClickHouse Docs — Query optimization.
13. ClickHouse Docs — JOINs in distributed queries.
14. ClickHouse Docs — Cluster deployment.

---

## 37. Status Seri

Part ini adalah:

```text
Part 020 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 021 — Distributed ClickHouse II: Consistency, Failover, Keeper, and Operational Realities
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Updates, Deletes, Deduplication, and Mutable Analytics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-021.md">Part 021 — Distributed ClickHouse II: Consistency, Failover, Keeper, and Operational Realities ➡️</a>
</div>

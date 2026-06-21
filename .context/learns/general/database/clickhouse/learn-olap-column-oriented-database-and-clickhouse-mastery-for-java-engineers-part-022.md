# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-022.md

# Part 022 — Cloud-Native ClickHouse: Object Storage, Separation of Compute/Storage, and SharedMergeTree

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **022 / 034**  
> Fokus: memahami ClickHouse dalam arsitektur cloud-native: object storage, disk local vs remote, separation of compute/storage, cache, SharedMergeTree, managed cloud trade-offs, cost/performance, dan implikasi desain sistem.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas distributed ClickHouse secara klasik:

- shard;
- replica;
- local table;
- `Distributed` table;
- `ReplicatedMergeTree`;
- ClickHouse Keeper/ZooKeeper;
- replica lag;
- failover;
- distributed DDL;
- recovery;
- consistency model.

Sekarang kita masuk ke arsitektur yang lebih modern: **cloud-native ClickHouse**.

Di self-managed/on-prem model klasik, satu ClickHouse server biasanya menggabungkan:

```text
compute + local storage + cache + table parts + query execution
```

Dalam arsitektur cloud-native, sebagian tanggung jawab storage dapat digeser ke object storage:

```text
compute nodes
+ shared object storage
+ metadata/control plane
+ cache layer
+ autoscaling/workload isolation
```

ClickHouse Cloud memakai `SharedMergeTree` sebagai engine cloud-native yang menyediakan pemisahan compute/storage lebih dalam dibanding `ReplicatedMergeTree`. Dokumentasi resmi ClickHouse menyebut `SharedMergeTree` membawa deeper separation of compute and storage, dan arsitektur Cloud mendukung compute-compute separation: beberapa compute node group dengan service URL berbeda dapat memakai shared object storage yang sama. Referensi: ClickHouse Docs — SharedMergeTree dan Cloud architecture.

Part ini penting karena banyak keputusan produksi modern bukan lagi hanya:

```text
berapa shard dan replica?
```

tetapi juga:

```text
apakah data harus di local NVMe, object storage, atau hybrid?
apakah workload perlu compute group terpisah?
apakah managed cloud mengurangi operational risk?
apakah object storage latency bisa diterima?
bagaimana cache memengaruhi query?
bagaimana cost berubah?
```

---

## 1. Tujuan Part Ini

Setelah part ini, kamu diharapkan mampu:

1. memahami perbedaan arsitektur local-disk ClickHouse dan object-storage-backed ClickHouse;
2. menjelaskan separation of compute and storage;
3. memahami mengapa object storage menarik untuk OLAP;
4. memahami trade-off object storage: latency, throughput, cost, cache, metadata, small objects;
5. memahami konsep `SharedMergeTree` di ClickHouse Cloud;
6. membedakan `ReplicatedMergeTree` self-managed vs `SharedMergeTree` cloud-native secara mental model;
7. memahami storage policies dan S3/object storage disk di open-source/self-managed ClickHouse;
8. mendesain hot/warm/cold data strategy;
9. memahami cache layer dan workload isolation;
10. membuat cost model: compute, storage, network, object requests, cache miss, backfill;
11. menentukan kapan managed ClickHouse/ClickHouse Cloud masuk akal;
12. memahami implikasi untuk Java ingestion/API, reporting, backfill, disaster recovery, dan governance.

---

## 2. Mental Model Utama: Local Disk Coupling vs Storage/Compute Separation

### 2.1 Classic Local-Disk ClickHouse

Classic self-managed topology:

```text
Node 1:
  CPU + memory + local SSD/NVMe + ClickHouse parts

Node 2:
  CPU + memory + local SSD/NVMe + ClickHouse parts

Node 3:
  CPU + memory + local SSD/NVMe + ClickHouse parts
```

Each node owns local data parts.

If you want more storage:

```text
add bigger disks
or add shards
```

If you want more compute:

```text
add nodes/shards
or scale up nodes
```

But compute and storage are coupled.

### 2.2 Cloud-Native Direction

Cloud-native architecture tries to decouple:

```text
compute:
  query execution
  aggregation
  sorting
  joins
  ingestion processing
  cache

storage:
  durable object storage
  virtually elastic capacity
  lower cost per TB
  shared access

metadata/control plane:
  table metadata
  part metadata
  coordination
```

### 2.3 Why This Matters

In local-disk architecture:

- data locality is strong;
- query latency can be excellent;
- storage tied to node capacity;
- scaling storage requires scaling nodes;
- rebalancing can be hard;
- replica copies multiply storage cost;
- node loss requires replica/recovery.

In separated architecture:

- storage can grow independently;
- compute can scale up/down;
- multiple compute groups can share data;
- object storage durability helps;
- cold data cheaper;
- cache becomes crucial;
- metadata/control plane becomes more important;
- remote read latency must be managed.

---

## 3. Why Object Storage Is Attractive for OLAP

Object storage such as S3-compatible systems offers:

1. elastic capacity;
2. high durability;
3. lower storage cost;
4. decoupled lifecycle;
5. cross-compute accessibility;
6. data lake interoperability;
7. backup/archive friendliness;
8. independent scaling from compute;
9. useful for cold/warm data;
10. simpler disaster-recovery story in some architectures.

For OLAP, data volume often grows faster than compute need.

Example:

```text
Raw audit events: 7 years retention
Hot dashboard: last 30 days
Official reports: monthly aggregates
Cold detail queries: rare
```

Storing all 7 years on expensive local NVMe may be wasteful.

Object storage enables design:

```text
hot data: local/cache
warm/cold data: object storage
compute: scale based on query workload
```

---

## 4. Why Object Storage Is Hard for OLAP

Object storage is not local disk.

Important differences:

| Dimension | Local NVMe/SSD | Object Storage |
|---|---|---|
| Latency | Low | Higher |
| Throughput | High local | High aggregate but network-bound |
| Access model | files/blocks | objects/HTTP-like operations |
| Small reads | cheap-ish | relatively expensive |
| Metadata/listing | filesystem-like | object/list operations |
| Cost model | disk capacity | storage + requests + egress |
| Failure mode | node/disk | network/object service |
| Cache need | helpful | critical |
| Data locality | strong | remote |
| Scaling storage | node/disk bound | elastic |

Columnar OLAP reads many compressed column chunks. If layout creates too many tiny remote reads, object storage latency can dominate.

Therefore cloud-native OLAP requires:

- careful part layout;
- caching;
- prefetching;
- metadata efficiency;
- avoiding small parts/files;
- reducing random object requests;
- batching;
- query pruning;
- workload-aware compute.

---

## 5. Self-Managed ClickHouse with Object Storage

ClickHouse supports using external disks/object storage in self-managed deployments via storage configuration and policies.

Conceptual config:

```text
local disk
s3 disk
storage policy:
  hot volume = local
  cold volume = s3
```

A table can use a storage policy so data parts may live on local or object storage depending lifecycle/TTL.

### 5.1 Storage Policy Concept

Example mental model:

```text
recent parts → local NVMe
older parts → S3
```

DDL concept:

```sql
CREATE TABLE events
(
    event_time DateTime64(3),
    tenant_id UInt64,
    event_name LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_name)
TTL event_time + INTERVAL 90 DAY TO VOLUME 'cold'
SETTINGS storage_policy = 'hot_cold_policy';
```

Exact config is environment-specific, but mental model is:

```text
policy decides where parts are stored
TTL can move parts across volumes
```

### 5.2 Use Cases

Self-managed object storage is useful for:

- cold historical data;
- long retention logs;
- archive-like analytics;
- cost reduction;
- backup/source staging;
- hybrid hot/cold storage;
- data lake integration.

### 5.3 Risks

- remote read latency;
- object request cost;
- cache miss penalty;
- operational complexity;
- object storage credentials;
- small files/parts;
- restore/recovery complexity;
- performance surprises;
- network saturation.

### 5.4 Local Disk Still Matters

Even in object storage setup, local disk may still be needed for:

- hot parts;
- cache;
- temporary data;
- merges;
- spills;
- query intermediate files;
- local metadata;
- write buffers.

Do not size compute nodes as if they need no disk.

---

## 6. S3 Table Function/Engine vs S3 as Disk

Distinguish these two.

### 6.1 S3 Table Function / External Data Access

Example:

```sql
SELECT *
FROM s3(
    'https://bucket/path/*.parquet',
    'Parquet'
);
```

Use case:

- load external files;
- ad-hoc query;
- backfill;
- export/import;
- data lake access.

It does not make the table a native MergeTree table unless you insert into one.

Pattern:

```sql
INSERT INTO events
SELECT *
FROM s3('https://bucket/events/2026/06/*.parquet', 'Parquet');
```

### 6.2 S3/Object Storage as Disk

Here, MergeTree parts themselves are stored on object storage via disk/storage policy.

Use case:

- native table storage;
- hot/cold tiering;
- larger retention;
- storage cost reduction.

### 6.3 Practical Difference

| Aspect | S3 Table Function | S3 as Disk |
|---|---|---|
| Purpose | read/write external files | store ClickHouse parts |
| Table semantics | external data access | native MergeTree storage |
| Best for | backfill, lake access | tiered/cold storage |
| Query optimization | limited by file layout | ClickHouse table metadata/indexes |
| Serving dashboard | usually not ideal | possible with cache/policy |
| Mutation/merge | not native table lifecycle | part lifecycle applies |

---

## 7. ClickHouse Cloud and SharedMergeTree

### 7.1 What Is SharedMergeTree?

`SharedMergeTree` is a ClickHouse Cloud table engine family designed for cloud-native architecture. Official docs describe it as providing deeper separation of compute and storage compared with `ReplicatedMergeTree`.

Mental model:

```text
data stored in shared object storage
compute nodes access shared data
replication model changes compared to classic local replicated parts
metadata/control plane coordinates access
compute can scale more independently
```

### 7.2 Why It Exists

Classic `ReplicatedMergeTree` assumes replicas each maintain their own copy of data parts.

This means:

```text
2 replicas = roughly 2 copies of data
3 replicas = roughly 3 copies of data
```

In cloud-native architecture, object storage already provides durable shared storage. Multiple compute nodes can access shared physical data instead of each owning full independent local copy.

### 7.3 Simplified Comparison

| Aspect | ReplicatedMergeTree | SharedMergeTree |
|---|---|---|
| Typical environment | self-managed/classic cluster | ClickHouse Cloud |
| Storage | local disk per replica | shared object storage |
| Replication style | replicas copy parts | compute accesses shared data |
| Scaling compute | tied more closely to nodes/storage | more independent |
| Storage duplication | per replica copies | shared physical storage model |
| Operational burden | user manages more | cloud-managed |
| Cache importance | important | very important |
| Failure handling | replicas + Keeper | cloud control plane/shared storage |
| User config complexity | higher | lower |

### 7.4 What Does Not Change

Even with `SharedMergeTree`, core ClickHouse design remains important:

- schema;
- data types;
- sorting key;
- partitioning;
- batching;
- avoiding small parts;
- query pruning;
- aggregation design;
- materialized views/rollups;
- high-cardinality control;
- retention strategy;
- cost awareness.

Cloud-native engine does not fix bad data modeling.

### 7.5 Cloud Compute Groups

ClickHouse Cloud architecture supports compute-compute separation: multiple compute node groups can share the same object storage while exposing their own service URLs.

Mental model:

```text
Compute Group A:
  dashboard queries

Compute Group B:
  heavy backfills/exports

Compute Group C:
  ingestion/reporting

Shared object storage:
  table data
```

This can isolate workloads without duplicating full datasets.

---

## 8. Separation of Compute and Storage

### 8.1 Why Separate?

In analytics systems, storage and compute demand often scale differently.

Example:

```text
Data volume grows 5 TB/month.
Dashboard query workload stable.
```

Local disk cluster:

```text
need more nodes mostly for storage
even if compute underused
```

Separated architecture:

```text
storage grows in object storage
compute scales based on workload
```

### 8.2 Benefits

- independent compute scaling;
- independent storage scaling;
- lower cold storage cost;
- workload isolation;
- easier burst compute;
- less replica storage duplication;
- potentially simpler disaster recovery;
- managed control plane.

### 8.3 Costs

- remote read latency;
- cache dependency;
- object request cost;
- metadata/control plane complexity;
- network bottlenecks;
- cold query penalty;
- operational opacity in managed service;
- less manual control in some areas.

### 8.4 Workload Fit

Good fit:

- large historical datasets;
- variable/bursty compute;
- many workload classes;
- managed operations desired;
- high retention;
- cloud-native ecosystem.

Potentially less ideal:

- ultra-low-latency queries on cold uncached data;
- strict predictable local-disk performance needs;
- heavy mutation workloads over cold object storage;
- environments requiring full self-managed control;
- highly cost-sensitive workloads with unpredictable object request patterns.

---

## 9. Cache Layer Mental Model

Object storage architecture depends heavily on cache.

### 9.1 Why Cache Matters

Remote object storage read:

```text
compute node → network → object storage → data
```

Local cache read:

```text
compute node → local disk/memory cache → data
```

The difference can be huge.

### 9.2 Cache Types

Depending architecture/version/config:

- file cache;
- mark/index cache;
- uncompressed cache;
- filesystem cache;
- query result cache;
- userspace page cache;
- object storage cache;
- local SSD cache.

Conceptually, cache can hold:

- column data chunks;
- marks;
- indexes;
- compressed parts;
- decompressed blocks;
- query results.

### 9.3 Hot vs Cold Query

Hot query:

```text
data already cached
low latency
```

Cold query:

```text
data fetched from object storage
higher latency
object request/network cost
```

### 9.4 Cache Warming

Common strategies:

- scheduled warm-up queries;
- dashboards query recent data frequently;
- rollups for hot dashboards;
- keep hot partitions local/cache-heavy;
- avoid scanning cold raw data interactively;
- precompute official reports.

### 9.5 Cache Anti-Pattern

Benchmarking only warm cache can create unrealistic expectations.

Always test:

1. cold cache;
2. warm cache;
3. mixed workload;
4. concurrent dashboard;
5. backfill plus dashboard;
6. object storage throttling/failure scenario if self-managed.

---

## 10. Hot, Warm, and Cold Data Strategy

### 10.1 Data Temperature

Classify data:

```text
Hot:
  queried frequently
  low-latency requirement
  recent dashboard

Warm:
  queried occasionally
  moderate latency acceptable
  recent historical analysis

Cold:
  rarely queried
  retention/archive/compliance
  high latency acceptable
```

### 10.2 Example Policy

For logs:

```text
raw logs:
  hot: 7 days
  warm: 30 days
  cold: delete after 90 days

rollups:
  hot: 90 days
  warm/cold: 2 years

official reports:
  retain 7 years
```

### 10.3 Table-Level Strategy

Do not put all retention needs into one table.

Use:

```text
logs_raw
logs_parsed
logs_1m_rollup
logs_daily_rollup
official_incident_reports
```

Each has its own storage/TTL.

### 10.4 Query Routing

Java analytics API should route:

- dashboard → rollups/hot tables;
- drilldown recent → raw hot table;
- historical export → async cold query;
- official report → snapshot table;
- compliance archive → controlled offline query.

---

## 11. Cost Model

Cloud-native OLAP cost is multi-dimensional.

### 11.1 Cost Components

1. Compute.
2. Object storage capacity.
3. Object storage requests.
4. Network transfer.
5. Cache disk.
6. Replication/storage duplication if any.
7. Backup.
8. Data egress.
9. Long-running queries.
10. Backfill/rebuild jobs.
11. Materialized view write amplification.
12. Idle compute if not scaled down.

### 11.2 Local Disk Cost Model

```text
cost = nodes sized for peak compute and storage
```

Often paying for storage-attached compute even when compute idle.

### 11.3 Separated Cost Model

```text
cost = durable storage + compute when used + cache + object requests/network
```

Potentially cheaper for variable compute and large cold data.

### 11.4 Hidden Costs

- scanning cold raw data repeatedly;
- many small files/parts causing many object requests;
- backfills reading/writing large object data;
- queries returning huge results across network;
- duplicated aggregate tables;
- materialized views on every insert;
- excessive compute group usage;
- cache miss storms.

### 11.5 Cost-Aware Design

Use:

- rollups;
- projections where appropriate;
- good sorting key;
- column pruning;
- TTL;
- storage tiering;
- async exports;
- query guardrails;
- result limits;
- precomputed reports;
- workload isolation.

---

## 12. Small Parts Are Worse with Object Storage

Small parts are already bad in local-disk ClickHouse because they increase:

- metadata overhead;
- merge pressure;
- query overhead;
- file count;
- background work.

With object storage, small parts can be worse because they also increase:

- object count;
- request overhead;
- remote metadata operations;
- small remote reads;
- cache fragmentation.

### 12.1 Causes

- row-by-row inserts;
- too small batches;
- too many partitions;
- distributed insert split into tiny per-shard batches;
- materialized views producing many small target parts;
- high-cardinality partition key;
- frequent backfills per tiny window.

### 12.2 Prevention

- batch inserts;
- async inserts;
- group by partition/shard;
- reasonable partition key;
- avoid excessive materialized view targets;
- monitor part count;
- compact/rebuild when needed;
- use ingestion service.

### 12.3 Java Ingestion

A Java ingestion service should be even more careful in object-storage-backed ClickHouse:

```text
small inserts → small parts → many remote objects → bad cache/object behavior
```

---

## 13. Merges in Object Storage Architecture

### 13.1 Merge Cost

Merge reads old parts and writes new part.

With object storage:

```text
read old parts from object storage/cache
write new part to object storage
update metadata
delete/obsolete old parts eventually
```

Merges consume:

- compute CPU;
- memory;
- network;
- object requests;
- storage bandwidth;
- cache space.

### 13.2 Merge Scheduling

Background merges still matter. Object storage does not remove merge debt.

Causes of merge debt:

- high insert rate;
- small parts;
- mutation/update workload;
- TTL moves/deletes;
- many materialized view targets;
- backfill.

### 13.3 Cloud-Managed Help

Managed ClickHouse can hide/automate some operational tuning, but workload can still overwhelm if data model is pathological.

---

## 14. Mutations and Updates in Cloud-Native Context

Part 019 covered mutable analytics. Cloud-native storage changes the cost profile.

### 14.1 Heavy Mutations

Large mutations over object storage can be costly:

- read old parts;
- write new parts;
- object requests;
- cache churn;
- long-running background work.

### 14.2 Lightweight Updates/Deletes

ClickHouse has been improving update/delete mechanisms, including lightweight deletes and newer lightweight update approaches in recent versions/cloud. But design principle remains:

```text
do not model high-frequency OLTP updates as massive analytical table rewrites
```

### 14.3 Best Practice

Use:

- append correction;
- versioned rows;
- `ReplacingMergeTree`;
- tombstones;
- partition rebuild;
- rollup rebuild;
- targeted delete;
- avoid frequent wide updates.

Cloud-native engine improves operational capabilities, not the fundamental cost of mutable columnar analytics.

---

## 15. Disaster Recovery and Durability

### 15.1 Object Storage Durability

Object storage generally provides high durability. This can simplify durable storage design.

But durability is not the same as recoverability.

You still need:

- metadata recovery;
- schema recovery;
- table definitions;
- user/settings recovery;
- snapshot/version records;
- backup policies;
- deletion protection;
- access control;
- restore tests.

### 15.2 Local-Disk Replicated Cluster

DR relies on:

- replicas;
- backups;
- object storage backup maybe;
- reingestion;
- Keeper metadata;
- manual restore.

### 15.3 Shared Storage Cloud

DR may be cloud-managed, but you still need:

- business-level backup/export;
- accidental delete protection;
- retention policies;
- report snapshots;
- source replay;
- compliance controls.

### 15.4 Accidental Delete

Object storage durability does not protect against logical deletion if system deletes metadata/data correctly.

Use:

- backups;
- snapshots;
- versioned reports;
- restricted permissions;
- staged deletion;
- audit logging.

---

## 16. Compute-Compute Separation and Workload Isolation

ClickHouse Cloud architecture supports multiple compute node groups sharing the same object storage.

### 16.1 Why Useful?

Workload classes:

```text
interactive dashboards
ad-hoc analytics
backfills
exports
ML feature extraction
official report generation
ingestion transformations
```

They have different resource patterns.

### 16.2 Without Isolation

Backfill query can slow dashboard.

```text
heavy export scans cold data
→ cache churn
→ CPU/network saturation
→ dashboard latency spike
```

### 16.3 With Compute Groups

Example:

```text
Compute Group A:
  dashboard API
  small low-latency queries

Compute Group B:
  offline reports and exports

Compute Group C:
  backfill/rebuild jobs
```

All use same shared data but separate compute capacity.

### 16.4 Remaining Shared Risks

Even with separate compute, they may still share:

- object storage bandwidth;
- metadata/control plane;
- global table metadata;
- storage request costs;
- cache if shared at some layer;
- table mutations/merges.

Isolation is improved, not absolute.

---

## 17. Managed ClickHouse vs Self-Managed ClickHouse

### 17.1 Managed/Cloud Benefits

- less cluster operations;
- automated scaling features;
- managed backups/failover depending provider;
- cloud-native storage engine;
- faster setup;
- integrated monitoring;
- managed upgrades;
- workload isolation features;
- reduced Keeper/ZooKeeper burden;
- security integrations.

### 17.2 Managed/Cloud Trade-Offs

- less low-level control;
- provider-specific behavior;
- cost visibility needed;
- cloud region/network dependency;
- feature availability/version constraints;
- data governance review;
- egress costs;
- operational opacity for some internals.

### 17.3 Self-Managed Benefits

- full control;
- custom hardware/local NVMe;
- predictable local-disk performance;
- on-prem/regulatory constraints;
- custom topology;
- deeper operational access;
- potential cost optimization at scale.

### 17.4 Self-Managed Trade-Offs

- operations burden;
- Keeper management;
- replication/recovery management;
- upgrade complexity;
- backup/restore discipline;
- capacity planning;
- security hardening;
- 24/7 expertise needed.

### 17.5 Decision Factors

Choose based on:

- team expertise;
- data governance;
- latency requirement;
- cost model;
- workload variability;
- operational maturity;
- cloud strategy;
- data volume;
- high availability needs;
- compliance constraints.

---

## 18. Lakehouse and Open Formats

ClickHouse can interact with object storage and open formats such as Parquet. Modern analytics architectures often include:

```text
OLTP systems
→ streaming/CDC
→ object storage data lake
→ ClickHouse serving layer
→ BI/API/reporting
```

### 18.1 Data Lake as Source of Truth

Object storage may store raw immutable events in open formats.

ClickHouse stores optimized serving tables.

Pattern:

```text
raw events in S3/Parquet
→ ClickHouse MergeTree refined tables
→ rollups/materialized views
```

Benefits:

- replay;
- interoperability;
- separation of raw and serving;
- backfill;
- audit archive.

### 18.2 Querying External Parquet Directly

Good for:

- exploration;
- one-time load;
- validation;
- backfill;
- cold rarely-used data.

Not always good for:

- low-latency dashboards;
- high-concurrency APIs;
- complex repeated queries.

### 18.3 Iceberg/Delta/Hudi Awareness

ClickHouse has been adding integrations with modern lakehouse table formats. For this series, main point:

```text
External table/lake format is not automatically equal to ClickHouse-native performance.
```

Use native tables/rollups for critical serving paths.

---

## 19. Architecture Patterns

### 19.1 Pattern A: Classic Self-Managed Hot Local Cluster

```text
apps/ingestion
→ ClickHouse cluster with local NVMe
→ ReplicatedMergeTree
→ Distributed table
```

Best for:

- predictable performance;
- full control;
- latency-sensitive workloads;
- team with ops expertise.

### 19.2 Pattern B: Self-Managed Hot/Cold Tiering

```text
recent parts on local disk
old parts on S3 disk
TTL moves data
```

Best for:

- long retention;
- moderate cold-query latency acceptable;
- self-managed environment;
- cost reduction.

### 19.3 Pattern C: Data Lake + ClickHouse Serving

```text
raw immutable data in S3/Parquet
→ batch/stream load into ClickHouse
→ serving tables/rollups
```

Best for:

- replayability;
- auditability;
- multiple consumers;
- controlled serving performance.

### 19.4 Pattern D: ClickHouse Cloud Shared Storage

```text
ClickHouse Cloud
→ SharedMergeTree
→ shared object storage
→ compute groups
```

Best for:

- managed operations;
- elastic cloud-native analytics;
- workload isolation;
- large storage;
- teams wanting less infra ownership.

### 19.5 Pattern E: Hybrid Regulatory Analytics

```text
OLTP authoritative system
→ immutable event archive in object storage
→ ClickHouse raw/refined/rollup tables
→ official report snapshots
→ long-term archive
```

Best for:

- auditability;
- reproducibility;
- compliance reporting;
- replay/backfill.

---

## 20. Regulatory / Case Lifecycle Cloud-Native Example

### 20.1 Requirements

- 7-year audit retention.
- Recent dashboard under 2 seconds.
- Monthly official reports reproducible.
- Ad-hoc historical query allowed but not necessarily instant.
- Sensitive PII minimized.
- Backfills/corrections possible.
- Workload isolation between dashboard and report generation.

### 20.2 Architecture

```text
Case service / workflow systems
→ event stream / CDC
→ raw immutable archive in object storage
→ ClickHouse raw case_events table
→ current state table
→ daily/monthly rollups
→ official report snapshots
```

### 20.3 Storage Temperature

```text
case_events raw:
  hot recent 90 days
  cold/archive older data

case_current_state:
  hot

daily/monthly rollups:
  hot/warm long retention

official report snapshots:
  long retention, small, highly important
```

### 20.4 Compute Isolation

```text
dashboard compute:
  reads current state + rollups

report compute:
  reads validated windows and writes snapshots

backfill compute:
  replays object storage archive
```

### 20.5 Correctness

Official report generation should verify:

- ingestion watermark;
- replication/merge health if applicable;
- no active mutation on source;
- raw vs rollup reconciliation;
- snapshot stored with version/checksum.

### 20.6 Why Not Just Query Raw 7-Year Data?

Because:

- expensive;
- slow;
- cache-unfriendly;
- official report needs versioning;
- dashboard should use serving tables;
- cold object storage query latency may vary.

---

## 21. Java Application Implications

### 21.1 Ingestion

Java ingestion service should:

- batch aggressively;
- avoid small inserts;
- include stable event IDs;
- include batch IDs;
- write to correct target endpoint;
- handle async/eventual visibility;
- track source offsets;
- expose ingestion watermark;
- avoid row-by-row updates.

### 21.2 Query API

Java analytics API should:

- route dashboards to hot/rollup tables;
- route exports to async jobs;
- avoid cold raw scans in synchronous endpoints;
- enforce time ranges;
- expose freshness;
- set query IDs;
- set timeouts;
- apply workload-specific settings;
- understand compute group endpoint if using cloud.

### 21.3 Backfill Service

Backfill jobs should:

- use object storage manifest;
- process bounded partitions;
- write to shadow tables or drop/reload partitions;
- validate counts/checksums;
- avoid colliding with dashboard compute;
- run on separate compute group if available.

### 21.4 Cost-Aware API Design

Do not expose endpoint like:

```http
GET /events?from=2019-01-01&groupBy=user_id,session_id,trace_id
```

without guardrails.

Cloud object storage makes it easy to keep lots of data, but not free to scan it arbitrarily.

---

## 22. Performance Testing Methodology

### 22.1 Test Both Hot and Cold

Benchmark:

1. cold cache;
2. warm cache;
3. after cache eviction;
4. concurrent workload;
5. backfill while dashboard running;
6. mutation/rebuild while queries run.

### 22.2 Measure

Track:

- query duration;
- read rows;
- read bytes;
- result rows;
- memory;
- object storage bytes read if visible;
- cache hit/miss;
- network;
- CPU;
- remote read latency;
- object request count if available;
- queue/backlog;
- cost.

### 22.3 Dataset Realism

Use:

- realistic partition sizes;
- realistic cardinality;
- realistic time distribution;
- realistic tenant skew;
- realistic query concurrency;
- realistic cold data access.

### 22.4 Avoid Misleading Benchmarks

Bad benchmark:

```text
query same 1-day range repeatedly until fully cached
then claim p95 latency
```

Better:

```text
mix hot dashboards, cold historical queries, exports, and ingestion
```

---

## 23. Operational Observability

Important metrics/areas:

- query latency by workload;
- cache hit ratio;
- remote read bytes;
- local cache disk usage;
- object storage request errors;
- object storage latency;
- part count;
- merge backlog;
- mutation backlog;
- ingestion lag;
- compute utilization;
- network bandwidth;
- cost per workload;
- slow queries;
- failed inserts;
- storage growth;
- TTL movement.

Self-managed object storage also needs:

- credentials/permissions;
- bucket lifecycle;
- object versioning if used;
- network route;
- request throttling;
- endpoint availability.

---

## 24. Security and Governance

Cloud-native storage increases governance scope.

### 24.1 Object Storage Security

Need:

- bucket policies;
- encryption at rest;
- TLS in transit;
- IAM roles/service accounts;
- least privilege;
- audit logs;
- lifecycle policies;
- deletion protection;
- cross-region policies.

### 24.2 Data Exposure

If ClickHouse data parts are in object storage:

- object storage access becomes sensitive;
- raw archive may contain PII;
- external tools may access same bucket;
- governance must cover both DB and bucket.

### 24.3 Multi-Environment Separation

Do not mix:

```text
dev/test/prod
```

in same bucket/prefix without strong controls.

### 24.4 Regulatory Concern

For official systems, document:

- where data resides;
- retention;
- backup;
- deletion path;
- encryption;
- access control;
- audit logging;
- data lineage;
- report snapshots.

---

## 25. Failure Modes

### 25.1 Object Storage Slow/Unavailable

Symptoms:

- cold queries slow/fail;
- cache misses expensive;
- inserts/merges to object storage fail;
- background operations backlog.

Mitigation:

- cache;
- retry/backoff;
- workload isolation;
- region-local storage;
- alerts;
- fallback modes;
- avoid critical dashboard dependence on cold data.

### 25.2 Cache Miss Storm

Many users query cold historical data.

Symptoms:

- network spike;
- object requests spike;
- latency spike;
- cache churn;
- dashboards degrade.

Mitigation:

- async exports;
- query guardrails;
- cache warming;
- separate compute groups;
- rollups.

### 25.3 Small Object/Part Explosion

Symptoms:

- high metadata overhead;
- slow queries;
- many object requests;
- merge backlog.

Mitigation:

- batching;
- reduce partition count;
- compact/rebuild;
- monitor parts.

### 25.4 Cost Spike

Causes:

- accidental full historical scan;
- BI tool unbounded query;
- export loops;
- backfill repeated;
- high-cardinality group by;
- cache miss storm;
- object request explosion.

Mitigation:

- quotas;
- query limits;
- workload-specific users;
- cost monitoring;
- semantic API guardrails.

### 25.5 Accidental Data Deletion

Object durability does not protect against authorized deletion.

Mitigation:

- backups;
- versioning/snapshots;
- restricted permissions;
- soft delete process;
- report snapshots;
- restore tests.

### 25.6 Managed Service Region Issue

Cloud dependency can affect availability.

Mitigation:

- understand provider SLA;
- backup/export strategy;
- cross-region requirements;
- business continuity plan.

---

## 26. Decision Framework: Cloud-Native or Classic?

Ask these questions.

### 26.1 Data Volume

- Is storage growing faster than compute?
- Is cold retention large?
- Is local disk expensive?

### 26.2 Workload Variability

- Are queries bursty?
- Do you need separate compute for dashboards/backfills?
- Are exports periodic?

### 26.3 Latency

- Are most queries hot/recent?
- Are cold queries allowed to be slower?
- Is strict p99 latency required?

### 26.4 Operations

- Does team want to manage Keeper/shards/replicas?
- Is managed cloud acceptable?
- Do you need full control?

### 26.5 Governance

- Can data be stored in cloud object storage?
- Are there residency/compliance constraints?
- Are IAM/encryption controls sufficient?

### 26.6 Cost

- What is expected scan volume?
- How often will cold data be queried?
- Are object requests/egress understood?
- Are rollups designed?

### 26.7 Mutation Profile

- Are updates rare and append-modeled?
- Or is workload mutation-heavy?
- Can corrections be handled by rebuild/versioning?

### 26.8 Integration

- Does raw data already live in object storage?
- Do you need lakehouse interoperability?
- Do you need managed ingestion?

---

## 27. Common Anti-Patterns

### 27.1 Believing Object Storage Makes Poor Modeling Cheap

Bad schema still causes bad queries.

### 27.2 Treating S3 External Query as Serving Layer

Repeated dashboard queries directly over arbitrary Parquet can be slow/costly.

### 27.3 No Cache Awareness

Cold-cache production latency surprises users.

### 27.4 Small Inserts in Cloud-Native Storage

Creates small parts/objects and high overhead.

### 27.5 No Workload Isolation

Backfills degrade dashboards.

### 27.6 No Cost Guardrails

BI/ad-hoc users can scan years of data.

### 27.7 No Freshness/Temperature Semantics

Users do not know whether query hits hot rollup or cold archive.

### 27.8 Storing PII Everywhere

Deletion/governance becomes hard across object storage, ClickHouse tables, backups, exports.

### 27.9 Assuming Managed Means No Architecture Work

Managed service reduces ops, not data modeling responsibility.

### 27.10 Benchmarking Only Warm Cache

Misleading performance expectations.

---

## 28. Production Checklist

### Architecture

- [ ] Is data hot/warm/cold classification defined?
- [ ] Is compute/storage coupling understood?
- [ ] Is object storage used as external source, disk, or shared storage?
- [ ] Are serving tables separate from raw archive?
- [ ] Are workload classes separated?
- [ ] Are rollups used for frequent dashboards?

### Storage

- [ ] Are partition and TTL aligned with lifecycle?
- [ ] Are small parts monitored?
- [ ] Is object storage request pattern understood?
- [ ] Is local cache sized?
- [ ] Is cold query behavior tested?
- [ ] Is storage growth forecasted?

### Performance

- [ ] Are cold-cache and warm-cache benchmarks done?
- [ ] Are query guardrails enforced?
- [ ] Are high-cardinality queries controlled?
- [ ] Are backfills isolated?
- [ ] Are materialized views/rollups validated?
- [ ] Are cache miss storms considered?

### Cost

- [ ] Is compute cost tracked per workload?
- [ ] Is storage cost tracked?
- [ ] Are object request/network costs tracked?
- [ ] Are expensive query classes limited?
- [ ] Are exports async?
- [ ] Are accidental full scans prevented?

### Operations

- [ ] Are merges/mutations monitored?
- [ ] Are object storage errors monitored?
- [ ] Are cache metrics monitored?
- [ ] Is backup/restore documented?
- [ ] Is disaster recovery tested?
- [ ] Are managed service limits understood?

### Security/Governance

- [ ] Are bucket/IAM permissions least privilege?
- [ ] Is encryption configured?
- [ ] Are audit logs enabled?
- [ ] Is PII minimized?
- [ ] Are retention/deletion policies defined?
- [ ] Are official reports snapshotted/versioned?

### Java/API

- [ ] Does API route hot dashboard queries to serving tables?
- [ ] Are cold exports async?
- [ ] Are query IDs set?
- [ ] Are compute endpoints/groups selected intentionally?
- [ ] Are ingestion batches large?
- [ ] Are retries idempotent?
- [ ] Is freshness exposed?

---

## 29. Exercises

### Exercise 1: Hot Dashboard, Cold Archive

Requirement:

```text
Dashboard queries last 7 days every minute.
Users occasionally export 3 years of raw data.
Retention required for 7 years.
```

Question:

- Should all raw data be on hot local disk?
- What architecture would you choose?

Expected reasoning:

- hot dashboard should use recent raw/rollup hot path;
- cold archive can live in object storage;
- export should be async;
- rollups/snapshots for official reports;
- not all raw data needs hot local disk.

### Exercise 2: Cost Spike

Scenario:

```text
BI user runs group by user_id over 5 years.
Cloud bill spikes.
```

Question:

- What went wrong?

Expected:

- unbounded cold scan;
- high-cardinality aggregation;
- no query guardrails;
- object storage/cache cost ignored;
- should use async export, limits, rollups, or approval workflow.

### Exercise 3: Small Inserts

Scenario:

```text
Java service inserts 100 rows per request into ClickHouse Cloud.
Query latency degrades over time.
```

Question:

- Why?

Expected:

- small parts;
- object/storage overhead;
- merge pressure;
- cache fragmentation;
- batching/async inserts needed.

### Exercise 4: Official Report

Requirement:

```text
Monthly enforcement report must be reproducible.
Cloud storage keeps raw events.
```

Question:

- Is raw data enough?

Expected:

- raw data enables replay, but official report should be snapshotted/versioned with source watermark/checksum;
- corrections should create amendments.

### Exercise 5: Workload Isolation

Scenario:

```text
Backfill job slows dashboards.
```

Question:

- What cloud-native feature/pattern helps?

Expected:

- separate compute group/service for backfill;
- dashboard reads rollups/hot serving tables;
- schedule/throttle backfill;
- monitor shared storage/cache pressure.

---

## 30. Summary

Cloud-native ClickHouse changes the operational and economic model, but not the need for good OLAP design.

Core points:

1. Local-disk ClickHouse couples compute and storage.
2. Object storage enables more elastic and cheaper long-term storage.
3. Separation of compute/storage helps when data volume and compute demand scale differently.
4. `SharedMergeTree` in ClickHouse Cloud provides deeper compute/storage separation than classic `ReplicatedMergeTree`.
5. Object storage introduces latency, request cost, network dependency, and cache dependence.
6. Small parts become even more harmful.
7. Cache behavior must be tested explicitly.
8. Hot/warm/cold data strategy is mandatory for large systems.
9. Managed cloud reduces operational burden but does not replace data modeling.
10. Java APIs must route workloads intentionally and enforce cost/performance guardrails.

Practical sentence:

> Cloud-native ClickHouse lets you decouple capacity, but it does not decouple you from physics: bytes still move, caches still miss, and bad query shapes still cost money.

---

## 31. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi sesuai versi dan deployment yang kamu pakai:

1. ClickHouse Docs — SharedMergeTree table engine.
2. ClickHouse Docs — Cloud architecture.
3. ClickHouse Docs — Separation of storage and compute.
4. ClickHouse Docs — External disks for storing data.
5. ClickHouse Docs — Integrating S3 with ClickHouse.
6. ClickHouse Docs — S3 table function.
7. ClickHouse Docs — Storage policies.
8. ClickHouse Docs — TTL.
9. ClickHouse Docs — Query optimization.
10. ClickHouse Docs — MergeTree table engine.
11. ClickHouse Docs — ClickHouse Cloud performance and scaling.
12. ClickHouse Blog — SharedMergeTree and lightweight updates.

---

## 32. Status Seri

Part ini adalah:

```text
Part 022 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 023 — Performance Engineering I: Reading EXPLAIN, Query Logs, and System Tables
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Distributed ClickHouse II: Consistency, Failover, Keeper, and Operational Realities</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-023.md">Part 023 — Performance Engineering I: Reading EXPLAIN, Query Logs, and System Tables ➡️</a>
</div>

# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-005.md

# Part 005 — Tablets, VNodes, Token Ranges, dan Data Distribution Modern ScyllaDB

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `005`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami data distribution modern ScyllaDB — hubungan partition, token, token range, vnode, tablet, replica, node, shard, elasticity, rebalancing, dan konsekuensi desain.

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membangun dua lapisan mental model:

```text
Part 003:
cluster-level model
partition key -> token -> token range -> replica set -> coordinator

Part 004:
node-level model
node -> shard/core -> shard-aware routing -> per-shard execution
```

Part ini menyatukan keduanya.

Pertanyaan utama:

> Bagaimana ScyllaDB modern membagi, menempatkan, memindahkan, dan menyeimbangkan data di cluster?

Jawaban historisnya:

```text
ring + token ranges + vnodes
```

Jawaban modern ScyllaDB:

```text
tablets
```

Tablets tidak menghapus pentingnya partition key, token, replica, consistency level, atau shard. Tetapi tablets mengubah cara ScyllaDB mengelola distribusi data agar lebih elastis, lebih dinamis, dan lebih efisien ketika cluster berubah.

---

## 1. Vocabulary Map

Sebelum masuk detail, kita perlu memisahkan istilah yang sering tercampur.

| Term | Level | Working Definition |
|---|---|---|
| Partition key | CQL/data model | Bagian primary key yang menentukan partition |
| Partition | Logical data unit | Semua rows dengan partition key yang sama |
| Token | Hash-space | Hasil hash dari partition key |
| Token range | Distribution space | Rentang token |
| VNode | Legacy distribution unit | Virtual token range ownership unit |
| Tablet | Modern ScyllaDB distribution unit | Unit distribusi/replication per table |
| Replica | Fault tolerance | Copy tablet/range/partition data pada node |
| Node | Cluster | Satu instance ScyllaDB |
| Shard | Node internal | Per-core execution/storage unit di dalam node |
| Coordinator | Request path | Node/shard yang mengoordinasi request |
| RF | Replication | Jumlah replica target |
| CL | Runtime consistency | Jumlah/scope response yang dibutuhkan |

Kalimat ringkas:

```text
Partition key di-hash menjadi token.
Token jatuh ke range.
Range/tablet menentukan replica placement.
Replica berada pada node.
Di dalam node, data dilayani oleh shard.
```

---

## 2. Apa Problem yang Diselesaikan Data Distribution?

Distributed database harus membagi data dan traffic.

Target ideal:

```text
data evenly distributed
traffic evenly distributed
replica placement fault-tolerant
scaling fast
rebalancing efficient
hot spots minimized
operational movement bounded
```

Tapi kenyataan:

- table size berbeda-beda,
- tenant traffic skewed,
- beberapa partition besar,
- beberapa table kecil,
- node ditambah/dihapus,
- disk usage berubah,
- workload berubah,
- repair/streaming butuh bandwidth,
- cluster harus tetap melayani traffic saat topology berubah.

Data distribution adalah control plane untuk semua ini.

---

## 3. Legacy Ring/VNode Model Recap

Di model Cassandra-style klasik:

```text
token space dibagi menjadi banyak token ranges
node memiliki banyak vnode/token ranges
replica placement mengikuti ring dan replication strategy
```

VNode membantu:

- distribusi lebih merata daripada satu token per node,
- scale-out lebih mudah,
- decommission/rebuild lebih smooth,
- tidak perlu manual token assignment rumit.

Tetapi vnode punya keterbatasan.

### 3.1 VNode Limitation

VNode cenderung statis dan global.

Masalah:

```text
all tables follow same token ownership pattern
```

Padahal:

```text
Table A = 100 TB
Table B = 10 GB
Table C = 5 MB
```

Mereka tidak selalu butuh distribution granularity yang sama.

Scale operation juga bisa menjadi besar karena ownership movement dapat memengaruhi banyak data sekaligus.

Jika node baru ditambah, data movement perlu menyeimbangkan token ranges dan replica ownership. Ini bisa mahal, lama, dan noisy.

---

## 4. Apa Itu Tablet?

Tablet adalah unit distribusi data modern ScyllaDB.

Secara praktis:

```text
A table is split into tablets.
Each tablet covers a portion of that table's token space.
Each tablet has replicas on nodes according to replication factor.
```

Dokumentasi ScyllaDB menyatakan bahwa ScyllaDB mendistribusikan data dengan membagi table menjadi tablets; setiap tablet memiliki replica pada node berbeda sesuai RF, dan setiap partition dipetakan secara deterministik ke satu tablet.

### 4.1 Tablet Is Per Table

Ini penting.

Bukan:

```text
one global token distribution for all tables
```

Tetapi:

```text
each table can have its own tablets
```

Implikasi:

- table besar bisa punya banyak tablets,
- table kecil bisa punya sedikit tablets,
- distribusi bisa lebih sesuai ukuran table,
- balancing bisa lebih granular.

### 4.2 Tablet Covers Token Range

Tablet tetap berhubungan dengan token.

Sederhana:

```text
Table case_events
  Tablet 1: token range A
  Tablet 2: token range B
  Tablet 3: token range C
  ...
```

Partition mapping:

```text
partition key -> token -> tablet
```

Jadi token mental model tetap hidup.

---

## 5. Tablet vs Partition

Jangan keliru.

Partition:

```text
logical group of rows with same partition key
```

Tablet:

```text
physical/distribution unit containing many partitions in a token range for a table
```

Satu tablet biasanya berisi banyak partition.

```text
Tablet T1
├── partition case_id=CASE-001
├── partition case_id=CASE-018
├── partition case_id=CASE-991
└── ...
```

Satu partition dipetakan ke satu tablet pada satu waktu.

```text
one partition -> one tablet
```

Tablet bukan row group business-level. Tablet adalah unit distribusi internal.

---

## 6. Tablet vs Shard

Tablet dan shard juga berbeda.

Shard:

```text
per-core execution/storage unit inside a node
```

Tablet:

```text
cluster/table distribution unit with replicas placed on nodes/shards
```

Hubungan konseptual:

```text
tablet replica resides on a node and is served by shard(s)/specific shard ownership path
```

ScyllaDB’s tablet architecture distributes tablets across nodes and shards automatically, and tablets can migrate across replicas as needed.

Operationally, this means:

```text
Tablets are about data placement and movement.
Shards are about per-core execution inside a node.
```

---

## 7. Tablet Replica

Jika RF=3, setiap tablet punya 3 replica.

Contoh:

```text
Table: case_events_by_case
Tablet: T-42
RF: 3

Replicas:
- Node A
- Node C
- Node F
```

Jika multi-DC:

```text
RF per DC menentukan replica placement per DC
```

Contoh:

```text
dc_jakarta: 3
dc_singapore: 3
```

Maka tablet akan memiliki replica sesuai strategy/topology di tiap DC.

### 7.1 Tablet Replica Is Not Request Consistency

RF tetap berbeda dari CL.

```text
Tablet replica count = how many copies target
Consistency level = how many responses needed for operation
```

---

## 8. Deterministic Partition to Tablet Mapping

Saat query datang:

```sql
SELECT * FROM case_current_by_id WHERE case_id = ?;
```

Flow:

```text
case_id -> token -> tablet -> tablet replicas -> node/shard routing
```

Ini harus deterministic agar semua node/driver/coordinator bisa tahu di mana data seharusnya berada berdasarkan metadata.

Sama seperti ring/token model, driver/coordinator tidak melakukan broadcast untuk single partition query. Ia menggunakan metadata distribusi.

---

## 9. Kenapa Tablets Lebih Elastis?

Dalam vnode model, scaling sering terasa sebagai operasi besar berbasis token ownership.

Dalam tablet model, ScyllaDB dapat mengelola unit yang lebih fleksibel dan per-table.

Manfaat konseptual:

- movement lebih granular,
- balancing lebih adaptif,
- scale-out lebih cepat,
- table besar dan kecil tidak diperlakukan sama,
- topology changes lebih smooth,
- data distribution bisa disesuaikan dengan ukuran table,
- parallel movement lebih mudah dikendalikan.

ScyllaDB 6.0 memperkenalkan tablets sebagai algoritma data distribution baru untuk menggantikan pendekatan legacy vNodes yang diwarisi dari Cassandra; ScyllaDB menjelaskan bahwa tablets membuat scaling lebih dinamis dan elastis.

---

## 10. Tablet Movement

Tablet movement berarti replica tablet dipindahkan dari satu node/shard placement ke placement lain.

Skenario:

```text
new node added
some tablet replicas migrate to new node
load/disk ownership becomes more balanced
```

Konseptual:

```text
Before:
Tablet T42 replicas: Node A, Node B, Node C

After:
Tablet T42 replicas: Node A, Node C, Node D
```

Data harus di-stream ke node baru dan metadata placement harus diperbarui.

### 10.1 Movement Is Data + Metadata

Tablet movement bukan hanya copy file.

Ia melibatkan:

- metadata ownership,
- streaming data,
- consistency of topology update,
- interaction with reads/writes,
- cleanup old placement,
- maintaining RF,
- avoiding data loss.

Modern ScyllaDB tablets work builds on strongly consistent topology/metadata mechanisms, with ScyllaDB material noting Raft-based topology/tablet work for elasticity.

---

## 11. Scale-Out with Tablets

Scale-out:

```text
1. Add node(s).
2. Cluster recognizes new capacity.
3. Tablet balancer/scheduler chooses tablet replicas to move.
4. Data streams to new node(s).
5. Ownership metadata updates.
6. Load gradually shifts.
```

Important:

```text
Capacity increases as data and traffic move.
It is not instantaneous at the moment process starts.
```

However tablets aim to make this process faster and more granular than legacy vnode scaling.

### 11.1 Scale-Out Does Not Fix Logical Hot Partition

If single partition is hot:

```text
partition key = tenant_id
tenant_id = BIG_TENANT
```

Then:

```text
BIG_TENANT -> one token -> one tablet at a time -> limited replica/shard path
```

Tablets can balance tablets, but cannot split one logical partition into multiple partition keys for your application semantics.

To fix that:

```text
change data model: bucketing/sharding at partition key level
```

---

## 12. Scale-In / Decommission with Tablets

Scale-in:

```text
1. Decide node removal.
2. Move tablet replicas away from node.
3. Preserve RF.
4. Stream data to remaining nodes.
5. Update metadata.
6. Remove node safely.
```

Operational risks:

- insufficient capacity on remaining nodes,
- network saturation,
- disk pressure,
- compaction pressure,
- repair/streaming interference,
- p99 impact during movement.

A safe scale-in requires:

```text
capacity headroom + operational window + monitoring
```

---

## 13. Rebalancing

Rebalancing tries to improve distribution.

Distribution dimensions:

```text
data size
tablet count
node capacity
shard placement
possibly workload/heat signals over time
```

ScyllaDB materials describe tablets as enabling autonomous/flexible data balancing and dynamic migration across replicas.

### 13.1 Balancing Data vs Balancing Traffic

Important distinction:

```text
data balance != traffic balance
```

A tablet may be small but extremely hot.

Example:

```text
Tablet T1 size = 2 GB, ops = 100k/sec
Tablet T2 size = 80 GB, ops = 1k/sec
```

Balancing by size alone would not solve heat.

Modern data distribution systems aim to account for more signals over time, but application-level hot partition design still matters.

---

## 14. Tablet Count and Initial Tablets

ScyllaDB CQL DDL docs include guidance for calculating initial tablets: divide expected total table storage by replication_factor * 5GB, then round up to a power of two.

Working interpretation:

```text
initial_tablets ≈ expected_table_size / (RF * 5GB)
rounded to power of two
```

Example:

```text
Expected table logical/storage size: 30 TB
RF: 3

30 TB / (3 * 5 GB)
= 30,000 GB / 15 GB
= 2,000
round up to power of two -> 2,048
```

This is not a universal law for every workload, but it provides a planning heuristic.

### 14.1 Why Initial Tablet Count Matters

Too few tablets:

- coarse distribution,
- limited balancing granularity,
- movement less flexible,
- hotspots harder to isolate.

Too many tablets:

- more metadata,
- more management overhead,
- more tiny units,
- possibly unnecessary for small tables.

Use expected table size and workload profile.

---

## 15. Partition Design Still Comes First

Tablets improve physical distribution, but partition key remains application’s main load-shaping tool.

Bad:

```sql
PRIMARY KEY (tenant_id, event_time)
```

For a huge tenant, one partition can still be huge/hot.

Better:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), event_time, event_id)
```

Now partition key cardinality increases:

```text
tenant + day + bucket
```

This creates many partitions and tokens, enabling distribution across tablets/nodes/shards.

Tablet architecture cannot compensate for a data model that creates too few hot partition keys.

---

## 16. Token Range vs Tablet Range

In simplified terms:

```text
token range = region in hash/token space
tablet = per-table distribution unit covering range(s)/portion of token space with replicas
```

In older mental model:

```text
token range ownership is central
```

In tablet mental model:

```text
table-specific tablets own table-specific slices of token space
```

For application engineers, continue thinking:

```text
partition key -> token -> distribution unit -> replicas
```

Whether underlying unit is vnode/token range or tablet, your CQL design still determines token distribution.

---

## 17. Why Per-Table Distribution Matters

Imagine three tables:

```text
case_events_by_case        80 TB
case_current_by_id          2 TB
idempotency_keys_by_cmd   200 GB
feature_flags              10 MB
```

If all tables share same distribution granularity, the small table gets unnecessary distribution complexity and the large table may not get enough fine-grained balancing.

Per-table tablets allow distribution to fit table size and lifecycle.

Operational implications:

- backup/restore planning may consider table sizes,
- repair cost differs per table,
- compaction load differs per table,
- hot table can be analyzed independently,
- scaling pressure may come from one table only.

---

## 18. Metadata: The Hidden Control Plane

Tablet placement requires metadata:

```text
which tablets exist
which token range each tablet covers
where each replica lives
which node/shard owns it
which movement is in progress
which topology version is active
```

This metadata must be consistent enough for safe reads/writes/movement.

Modern ScyllaDB topology/tablet work emphasizes stronger consistency in topology updates, reducing risks associated with eventually consistent topology changes.

As application engineer, you usually do not manipulate tablet metadata directly, but you must know it exists because:

- topology changes affect latency,
- driver metadata must refresh,
- operations need monitoring,
- failed movement can affect availability,
- cluster state is more than just data files.

---

## 19. Strongly Consistent Topology Updates

Classic eventually consistent topology can create tricky edge cases:

```text
Node A thinks ownership changed.
Node B still thinks old ownership.
Client metadata is stale.
Request routing becomes inefficient or risky.
```

ScyllaDB’s newer tablets/topology architecture uses stronger metadata mechanisms to make topology updates safer and more coordinated.

Conceptual takeaway:

```text
Data movement requires agreement about who owns what.
```

This is a control-plane consistency problem, separate from user data consistency level.

---

## 20. How Reads/Writes Behave During Movement

During tablet movement, the database must preserve correctness and availability.

Conceptual requirements:

```text
writes must not be lost
reads must find correct replica set
RF must be maintained or safely transitioned
metadata must indicate active placement
old/new replicas must converge
```

You do not need to design this algorithm in application code. But you should understand operational symptoms:

- p99 may rise during movement,
- streaming bandwidth increases,
- compaction can increase,
- driver metadata refresh matters,
- overloaded cluster may move slowly,
- scale operation competes with foreground traffic.

---

## 21. The Tablet Scheduler Mental Model

A scheduler decides movement/rebalancing work.

It must avoid:

```text
moving too much at once
overloading network
overloading disk
hurting foreground latency
violating RF/topology
creating imbalance elsewhere
```

Think of tablet scheduling as controlled load transfer.

Poor mental model:

```text
Add node; data immediately even.
```

Better:

```text
Add node; scheduler gradually migrates tablet replicas within resource limits.
```

---

## 22. Elasticity vs Predictability

Elasticity means cluster can adapt faster.

But predictability still requires:

- capacity planning,
- load testing,
- safe rollout,
- observability,
- rate limits,
- maintenance windows for major changes,
- backpressure.

Dynamic balancing is not a license to ignore data model.

Analogy:

```text
Autoscaling helps stateless services, but bad hot-key cache design still melts one shard.
```

Similarly:

```text
Tablets help ScyllaDB scale elastically, but bad partition key can still melt a tablet/shard.
```

---

## 23. Large Partition in Tablet World

A large partition is still problematic.

Example:

```text
partition = tenant_id BIG_TENANT
size = 500 GB
```

Even if tablet can move, that one partition remains indivisible at application partition level.

Problems:

- read range scans expensive,
- compaction pressure,
- repair/movement cost,
- tombstone scanning,
- cache inefficiency,
- hot shard,
- long pagination,
- difficult retention.

Fix:

```text
split logical data into multiple partitions using bucket dimension
```

Tablet architecture improves distribution of many partitions; it does not make one pathological partition healthy.

---

## 24. Hot Tablet vs Hot Partition

Hot partition:

```text
one partition key receives too much traffic
```

Hot tablet:

```text
one tablet receives too much traffic, possibly due to many hot partitions or one extremely hot partition
```

Hot shard:

```text
one shard/core receives too much work, possibly because it hosts hot tablet/partition
```

Relationship:

```text
hot partition -> hot tablet -> hot shard/node symptoms
```

But not always:

```text
many moderately hot partitions in same tablet can create hot tablet
```

Troubleshooting should identify level:

```text
Is one key hot?
Is one tablet hot?
Is one shard hot?
Is one node hot?
Is entire cluster hot?
```

---

## 25. Application-Level Bucketing and Tablets

Bucketing remains key.

Example event table:

```sql
CREATE TABLE tenant_events_by_bucket (
    tenant_id text,
    bucket_day date,
    bucket_id int,
    event_time timestamp,
    event_id uuid,
    payload text,
    PRIMARY KEY ((tenant_id, bucket_day, bucket_id), event_time, event_id)
);
```

Bucket dimension increases partition count:

```text
tenant_id + bucket_day + bucket_id
```

More partitions means more tokens, which can map across many tablets/nodes/shards.

### 25.1 Bucket Count Decision

Bucket count depends on:

- write rate,
- read pattern,
- tenant skew,
- desired partition size,
- desired per-partition QPS,
- merge cost,
- retention,
- time bucket size,
- maximum interactive read budget.

Example:

```text
tenant = BIG_BANK
writes = 80k/sec
target per partition = 2k/sec
needed active buckets ≈ 40
```

But if UI needs latest events:

```text
read latest from 40 buckets
merge by event_time
limit 100
```

This is a read fanout trade-off.

---

## 26. Tablet-Aware Capacity Thinking

Traditional capacity:

```text
total data / node capacity
```

Better:

```text
per table data size
per table tablet count
replica factor
per node storage
per shard pressure
hot table workload
topology change cost
```

Capacity questions:

```text
1. Which table dominates storage?
2. Which table dominates QPS?
3. Which table dominates compaction?
4. Which table has TTL churn?
5. Which table has largest partitions?
6. Which table has hottest tenants?
7. Which table will grow fastest?
8. How many tablets are needed initially?
9. How much data moves when adding N nodes?
10. Can foreground p99 survive movement?
```

---

## 27. Tablet-Aware Observability

You need dashboards/diagnostics that can answer:

```text
which table is hot?
which token/tablet range is hot?
which node owns hot replica?
which shard is hot?
is tablet movement active?
is rebalancing complete?
is streaming saturating network?
is compaction backlog caused by movement?
```

Node-level dashboards alone are insufficient.

At minimum, track:

- per-node CPU/disk/network,
- per-shard CPU/latency,
- per-table read/write latency,
- per-table storage,
- compaction per table,
- large partition warnings,
- tombstone warnings,
- streaming activity,
- repair activity,
- topology/tablet movement state.

---

## 28. Tablets and Repair

Repair still matters.

Tablet distribution changes how data is organized and moved, but replica divergence remains a distributed database reality.

Repair concerns:

- replicas of same tablet must converge,
- movement may interact with repair scheduling,
- repair cost depends on data size and ranges/tablets,
- stale replicas can still exist,
- deletes/tombstones still require repair discipline.

Do not conclude:

```text
tablets eliminate repair
```

Correct:

```text
tablets improve distribution/elasticity; repair remains part of consistency maintenance.
```

---

## 29. Tablets and Backup/Restore

Backup/restore thinking remains table/data oriented, but tablets influence:

- data placement,
- parallelism,
- movement,
- recovery planning,
- per-table storage distribution.

Questions:

```text
Can we restore the table/keyspace to required RPO/RTO?
How does table size affect restore time?
Are snapshots consistent enough for use case?
Can derived tables be rebuilt instead of restored?
What tables are authoritative?
```

Tablet architecture does not remove the need for source-of-truth classification.

---

## 30. Schema and Tablet Configuration

Some tablet-related configuration can be associated with schema/keyspace/table creation.

For planning, avoid creating large production tables with no thought to:

- expected size,
- RF,
- initial tablets,
- growth,
- table count,
- compaction,
- TTL,
- migration path.

Schema design is not only columns and primary key. It also includes physical distribution assumptions.

---

## 31. Small Tables

Small tables behave differently.

Example:

```text
feature_flags = 10 MB
```

Problems if over-distributed:

- unnecessary metadata,
- unnecessary operational overhead,
- cache behavior maybe enough,
- complexity not justified.

For small lookup/config tables, ask:

```text
Should this even be in ScyllaDB?
Does it need wide-column distributed semantics?
Is read path bounded?
Is update frequency low?
Would app config/cache be better?
```

ScyllaDB can store small tables, but architecture should match purpose.

---

## 32. Huge Tables

Huge tables require deliberate tablet planning.

Example:

```text
case_events_by_case = 100 TB, RF=3
```

Questions:

```text
How many tablets initially?
How fast will it grow?
What is retention?
What compaction strategy?
What partition size?
What bucket strategy?
What backup/restore plan?
What repair strategy?
What scale-out plan?
```

For huge write-heavy tables, wrong initial physical assumptions can become expensive to correct later.

---

## 33. Table Count Explosion

Query-first modeling often creates many tables.

But too many tables can increase:

- schema complexity,
- operational metadata,
- repair/backup planning,
- monitoring surface,
- compaction tasks,
- application consistency work,
- migration cost.

Table-per-query is a good rule, not permission to create unlimited tables thoughtlessly.

Use derived tables when query value justifies operational cost.

---

## 34. Tablets and Multi-DC

In multi-DC, tablet replicas must respect replication strategy/topology.

Key ideas:

```text
RF per DC
local reads/writes
tablet replicas placed across nodes/failure domains
cross-DC replication
topology changes per DC
```

Application implications:

- use LOCAL_QUORUM for local strong-ish behavior,
- avoid global quorum unless latency/correctness demands it,
- understand failover semantics,
- plan data residency,
- avoid active-active writes to same entity unless conflict design exists.

Tablet elasticity does not remove multi-region correctness trade-offs.

---

## 35. Tablets and Driver Metadata

Drivers rely on cluster metadata for routing.

With tablets and topology changes, metadata freshness matters.

Driver needs to know enough to route efficiently:

- nodes,
- tokens/ranges/tablets depending driver capability,
- local DC,
- schema,
- topology changes.

Operational symptoms of stale/wrong metadata:

- inefficient coordinator selection,
- cross-node forwarding,
- increased latency,
- uneven load,
- failed requests during topology change.

Keep driver versions compatible with ScyllaDB version and feature set.

---

## 36. Tablet Movement and Client p99

During movement, client p99 can rise due to:

- streaming data,
- disk IO,
- compaction,
- network bandwidth,
- metadata refresh,
- cache effects,
- scheduling competition.

Mitigation:

- perform movement with headroom,
- monitor foreground latency,
- avoid scaling during peak if possible,
- rate-limit heavy clients,
- ensure compaction not already behind,
- check repair/backup not overlapping dangerously,
- use appropriate ScyllaDB operational tooling.

---

## 37. Case Study: Scale-Out Event Store

Scenario:

```text
case_events_by_case
current size: 30 TB
RF: 3
growth: 2 TB/month
workload: heavy writes, bounded latest-event reads
need: add nodes without long maintenance
```

### 37.1 Bad Design

```sql
PRIMARY KEY (case_id, event_time, event_id)
```

If some cases have millions of events and hot updates, partitions can become large/hot.

### 37.2 Better Design

```sql
PRIMARY KEY ((case_id, bucket_month), event_time, event_id)
```

or for very hot cases:

```sql
PRIMARY KEY ((case_id, bucket_month, bucket_id), event_time, event_id)
```

### 37.3 Tablet Planning

Estimate:

```text
table size = 30 TB
RF = 3
initial tablets heuristic:
30 TB / (3 * 5 GB) ≈ 2000 -> 2048
```

Then validate with:

- table count,
- workload heat,
- operational recommendation,
- version-specific docs,
- load test.

### 37.4 Scale-Out Behavior

Adding nodes:

```text
tablet replicas move to new nodes
data distribution improves
foreground latency may be affected during movement
eventual capacity increases
```

But if one case is hot:

```text
data model bucketing still required
```

---

## 38. Case Study: Multi-Tenant Enforcement Platform

Scenario:

```text
tenant A = small
tenant B = medium
tenant C = huge
tenant D = seasonal spike
```

Naive partition:

```sql
PRIMARY KEY (tenant_id, created_at, case_id)
```

Problem:

```text
huge tenant creates hot/large partition
seasonal spike melts one tablet/shard path
```

Better:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), created_at, case_id)
```

Tablet architecture helps distribute many partitions across table-specific tablets. But tenant skew still must be modeled.

Operationally:

```text
observe by tenant
rate limit by tenant
bucket by tenant heat
design derived tables with rebuild paths
```

---

## 39. Data Distribution Design Checklist

For each table:

```text
[ ] What is partition key?
[ ] What is expected partition count?
[ ] What is max partition size?
[ ] What is hottest partition QPS?
[ ] Does table require bucketing?
[ ] What is expected table size?
[ ] What is RF?
[ ] What initial tablet count is appropriate?
[ ] Is table small enough to avoid overengineering?
[ ] Is table huge enough to need explicit tablet planning?
[ ] What happens during scale-out?
[ ] What happens during scale-in?
[ ] What derived tables depend on it?
[ ] Can it be rebuilt?
[ ] How is it monitored?
```

For cluster:

```text
[ ] Are nodes balanced by data?
[ ] Are nodes balanced by traffic?
[ ] Are shards balanced?
[ ] Are tablet movements visible?
[ ] Is streaming controlled?
[ ] Is compaction healthy?
[ ] Are drivers compatible with topology?
[ ] Is local DC configured?
[ ] Is RF/topology correct?
```

---

## 40. Common Misconceptions

### Misconception 1: “Tablets replace partition key design.”

No. Tablets improve physical distribution; partition key still determines logical locality and traffic shape.

### Misconception 2: “Tablets eliminate hot partitions.”

No. One hot partition remains a hot logical key. Fix with data model/bucketing.

### Misconception 3: “Tablet movement is free.”

No. It consumes network, disk, CPU, and can affect p99.

### Misconception 4: “Balanced storage means balanced workload.”

No. A small tablet can be very hot; a large tablet can be cold.

### Misconception 5: “RF means every read/write touches every replica.”

No. RF is target replica count; CL determines runtime response requirement.

### Misconception 6: “Adding nodes instantly increases capacity.”

No. Capacity improves as tablet replicas/data/traffic are moved and balanced.

### Misconception 7: “Small tables need same distribution thinking as huge tables.”

No. Distribution overhead should match table size and purpose.

---

## 41. Mental Model Compression

Remember this pipeline:

```text
CQL table
  -> partition key
  -> token
  -> tablet for that table
  -> tablet replica placement
  -> node
  -> shard/core
  -> request execution
```

And this warning:

```text
Tablets improve elasticity of physical placement.
They do not repair logical data model mistakes.
```

---

## 42. Summary

Modern ScyllaDB data distribution is centered around tablets.

Key lessons:

1. Partition key maps to token.
2. Token maps to a distribution unit.
3. In modern ScyllaDB, tables are split into tablets.
4. Each tablet has replicas placed according to RF/topology.
5. Tablets are per-table, not one global distribution for all tables.
6. Tablets enable more granular and dynamic balancing than legacy vnodes.
7. Tablet movement helps elasticity but consumes resources.
8. Tablet architecture does not fix hot partitions.
9. Hot partition, hot tablet, and hot shard are different diagnostic levels.
10. Bucketing remains an application-level load distribution tool.
11. Initial tablet count matters for large tables.
12. Metadata/topology consistency is part of the control plane.
13. Driver metadata and version compatibility matter.
14. Balanced storage does not guarantee balanced traffic.
15. Production scale-out/scale-in requires headroom and observability.

---

## 43. Review Questions

1. Apa perbedaan partition dan tablet?
2. Apa perbedaan tablet dan shard?
3. Kenapa tablets disebut per-table distribution unit?
4. Bagaimana partition key dipetakan ke tablet?
5. Apa hubungan token dengan tablet?
6. Apa perbedaan RF dan CL dalam konteks tablet replica?
7. Kenapa vnode model punya keterbatasan?
8. Kenapa tablets lebih elastis?
9. Apa yang terjadi saat tablet movement?
10. Kenapa adding node tidak otomatis memperbaiki hot partition?
11. Apa beda hot partition, hot tablet, dan hot shard?
12. Kenapa balanced storage tidak berarti balanced traffic?
13. Bagaimana menghitung initial tablets secara heuristik?
14. Apa risiko terlalu sedikit tablets?
15. Apa risiko terlalu banyak tablets?
16. Kenapa bucketing tetap penting?
17. Apa trade-off bucketing terhadap read path?
18. Apa dampak tablet movement ke p99?
19. Kenapa driver metadata penting saat topology berubah?
20. Bagaimana kamu mendesain table 30 TB dengan RF=3?

---

## 44. Practical Exercise

Gunakan use case:

```text
A regulatory platform stores immutable case events.
Expected size: 30 TB in 18 months.
RF: 3.
Some cases are normal, some large investigations have millions of events.
Queries:
- latest 100 events by case
- events by case within month
- append event
```

Jawab:

```text
1. Apa partition key awal?
2. Apakah perlu time bucket?
3. Apakah perlu hash bucket?
4. Apa clustering key?
5. Apa risiko large investigation case?
6. Bagaimana query latest 100 jika bucketed by month?
7. Bagaimana query latest 100 jika bucketed by month + bucket_id?
8. Berapa initial tablets secara heuristic?
9. Apa yang harus dimonitor setelah scale-out?
10. Bagaimana membedakan hot partition vs hot tablet vs hot shard?
11. Apakah table ini source-of-truth atau derived?
12. Apa backup/repair consequence?
13. Apa consistency level kandidat untuk append event?
14. Apa retry/idempotency strategy?
15. Apa load test yang wajib dilakukan?
```

---

## 45. Preview Part 006

Part berikutnya masuk ke storage engine internals:

```text
commitlog
memtable
SSTable
flush
cache
Bloom filter
index/summary
read path
write path
read amplification
write amplification
space amplification
```

Part 003–005 menjelaskan distribusi data.

Part 006 menjelaskan apa yang terjadi setelah request mencapai replica/shard dan harus disimpan/dibaca dari storage engine.

---

# End of Part 005


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — ScyllaDB Architecture: Shard-per-Core, Seastar, Reactor, dan Shared-Nothing Node</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-006.md">Part 006 — Storage Engine Internals: Commitlog, Memtable, SSTable, Cache, dan Flush ➡️</a>
</div>

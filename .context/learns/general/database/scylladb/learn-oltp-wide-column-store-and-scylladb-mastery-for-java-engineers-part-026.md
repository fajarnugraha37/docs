# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-026.md

# Part 026 — Operations I: Cluster Sizing, Capacity Planning, Hardware/Cloud Choices, Disk/IO, CPU/Memory, Shard-per-Core, Rack/AZ Placement, dan Node Lifecycle

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `026`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: operasi dasar cluster ScyllaDB: sizing, capacity planning, workload modeling, hardware/cloud instance selection, disk/IO, CPU/memory, shard-per-core implications, network, rack/AZ topology, node lifecycle, scale-out/scale-in, and operational baselines.

---

## 0. Posisi Part Ini dalam Seri

Part 000–025 membangun fondasi:

```text
data model
partition key
query-first design
consistency
LWT
tombstones
compaction
indexes/MV
Java client
query performance
backfill
schema evolution
multi-tenant
multi-region
```

Mulai part ini kita masuk ke operasi cluster.

Untuk Java software engineer, tujuannya bukan menggantikan SRE/DBA, tetapi agar kamu:

- tahu konsekuensi desain aplikasi terhadap kapasitas cluster,
- bisa berdiskusi dengan tim platform menggunakan bahasa yang benar,
- bisa membaca gejala cluster,
- tidak membuat workload yang mustahil dioperasikan,
- bisa membuat capacity estimate awal,
- memahami kenapa “tinggal tambah node” tidak selalu benar.

ScyllaDB adalah high-performance distributed database. Tetapi performa tinggi tidak menghapus physics:

```text
CPU cycles
disk IOPS
disk throughput
network bandwidth
memory/cache
replication factor
compaction debt
repair traffic
hot partitions
data skew
```

---

## 1. Operations Starts at Data Modeling

Banyak masalah operasi berasal dari desain aplikasi:

```text
hot partition
large partition
unbounded query
TTL mixed badly
delete-heavy queue pattern
large payload
too many derived tables
fanout too high
retry storm
backfill without throttle
```

Ops tidak bisa sepenuhnya memperbaiki schema buruk dengan instance lebih besar.

Operational excellence dimulai dari:

```text
bounded partition
bounded query
reasonable payload
predictable write amplification
known retention
known tenant skew
controlled client behavior
```

---

## 2. What Are We Sizing?

Saat sizing cluster, kita bukan hanya menghitung data size.

Kita sizing untuk:

```text
storage capacity
write throughput
read throughput
p99 latency
compaction capacity
repair capacity
backfill/export capacity
replication factor
failure tolerance
growth
disk headroom
tenant skew
multi-region replication
```

Sizing hanya berdasarkan:

```text
raw data = 10 TB
node disk = 2 TB
need 5 nodes
```

itu salah.

Need account for:

```text
RF
space amplification
compaction headroom
snapshots/backups
tombstones
growth
operational safety margin
```

---

## 3. Capacity Formula: Storage

Rough formula:

```text
required_raw_logical_data
* replication_factor
* space_amplification
* safety_headroom
= physical_storage_needed
```

Example:

```text
logical live data: 10 TB
RF: 3
space amplification: 1.5
safety headroom: 1.3

physical = 10 * 3 * 1.5 * 1.3
         = 58.5 TB
```

If usable disk per node is 4 TB:

```text
nodes = ceil(58.5 / 4)
      = 15 nodes
```

This is approximate, but better than ignoring RF/headroom.

---

## 4. Logical Data Size Is Not Payload Size Only

Logical data includes:

- primary key columns,
- clustering columns,
- regular columns,
- metadata,
- tombstones,
- indexes/MVs,
- derived tables,
- compression overhead/savings,
- SSTable structures,
- collection cells,
- duplicated denormalized payload.

If you duplicate a 20 KB title/body into five tables, it multiplies storage and write cost.

Application-level denormalization must be included in capacity planning.

---

## 5. Write Amplification Capacity

A logical write may write:

```text
source table
current state table
event table
derived view table
idempotency table
notification table
secondary index/MV
outbox
```

If one command becomes 8 CQL writes and RF=3:

```text
one command -> 24 replica mutations
```

plus compaction later.

Capacity planning should count:

```text
user commands/sec
* CQL writes per command
* average row bytes
* RF
* compaction amplification
```

---

## 6. Read Capacity

Read capacity depends on:

```text
QPS
CL
fanout
rows per query
bytes per row
tombstones scanned
SSTables touched
cache hit rate
```

Example:

```text
endpoint QPS = 1000
each endpoint does 8 bucket reads
each bucket CL LOCAL_ONE
```

DB read requests/sec:

```text
8000 partition reads/sec
```

If CL LOCAL_QUORUM:

```text
replica read work roughly doubles or more depending path
```

If each result validates source rows:

```text
add N point reads
```

Application endpoint QPS is not equal to database QPS.

---

## 7. p99 Capacity

Sizing for average throughput is insufficient.

Need answer:

```text
Can cluster maintain p99 under:
- peak traffic?
- compaction?
- repair?
- one node down?
- backfill paused/running?
- hot tenant?
- rolling restart?
```

A cluster that handles average load at 70% utilization may fail p99 during compaction/repair.

Operational headroom matters.

---

## 8. CPU Sizing

ScyllaDB uses shard-per-core architecture.

More cores mean more shards.

CPU handles:

- request processing,
- CQL parsing/prepared execution,
- serialization/deserialization,
- memtable operations,
- cache,
- compaction,
- repair,
- streaming,
- encryption/compression,
- networking.

CPU bottleneck signs:

- high reactor utilization,
- high latency without disk saturation,
- compaction cannot keep up,
- one shard hot,
- p99 spikes on hot key,
- high cross-shard forwarding.

Application causes:

- small hot reads at high QPS,
- LWT contention,
- heavy fanout,
- large payload serialization,
- too many retries,
- indexes/MVs.

---

## 9. Shard-per-Core Implications

Each shard owns subset of data.

Good:

```text
many partitions evenly distributed -> shards balanced
```

Bad:

```text
one hot partition -> one shard overloaded
```

Adding cores/nodes helps only if workload distributes.

Hot partition remains limited by shard owning it.

This is why:

```text
partition key design > hardware
```

for hot-key workloads.

---

## 10. Memory Sizing

Memory used for:

- memtables,
- cache,
- row/cache metadata,
- bloom filters/index structures,
- compaction buffers,
- OS/kernel,
- ScyllaDB overhead,
- networking buffers.

More memory helps:

- cache hit rate,
- fewer disk reads,
- memtable buffering,
- metadata.

But memory cannot fix:

- unbounded scans,
- tombstone-heavy partitions,
- huge payloads,
- hot partition writes,
- wrong query shape.

---

## 11. Disk Sizing

Disk is critical for ScyllaDB.

Consider:

```text
capacity
IOPS
throughput
latency
endurance
failure characteristics
cloud volume limits
burst behavior
local NVMe vs network block storage
```

ScyllaDB benefits from fast storage.

Bad disk causes:

- read p99 spikes,
- compaction backlog,
- flush stalls,
- repair slow,
- streaming slow,
- timeout under load.

---

## 12. Local NVMe vs Network Block Storage

### Local NVMe

Pros:

- high IOPS/throughput,
- low latency,
- good for high-performance ScyllaDB.

Cons:

- ephemeral in some clouds,
- node replacement workflow needed,
- capacity tied to instance type.

### Network Block Storage

Pros:

- persistent,
- flexible sizing,
- easier node replacement sometimes.

Cons:

- latency/IO variability,
- throughput caps,
- noisy neighbor at storage layer,
- cost.

Choice depends on cloud/platform and operational model.

---

## 13. Disk Headroom

Never run disks near full.

Need headroom for:

- compaction output,
- streaming,
- repair,
- snapshots,
- temporary files,
- tombstone/space amplification,
- skew.

If disk too full:

- compaction may fail,
- writes may be blocked,
- node unstable,
- recovery harder.

Capacity plan should define:

```text
target utilization
warning threshold
critical threshold
scale-out threshold
```

Example policy:

```text
target <= 60-70%
warn at 75%
critical at 85%
```

Actual thresholds depend on compaction strategy and ops guidance.

---

## 14. Compaction Headroom

Part 016 explained compaction strategies.

Operationally:

```text
compaction needs disk + IO + CPU
```

Write-heavy workload creates compaction debt.

If compaction cannot keep up:

- SSTable count grows,
- read amplification grows,
- disk usage grows,
- tombstone cleanup delayed,
- p99 worsens.

Sizing must include compaction capacity, not only foreground writes.

---

## 15. Network Sizing

Network used for:

- client traffic,
- replication between nodes,
- repair,
- streaming,
- multi-DC replication,
- backup/upload,
- monitoring,
- gossip/control traffic.

Network bottlenecks cause:

- write latency,
- read latency,
- repair slow,
- streaming slow,
- node add/remove slow.

Large payload and high RF multiply network.

---

## 16. Replication Factor Cost

RF=3 means each write stored on 3 replicas per DC.

If multi-DC RF=3+3:

```text
6 replicas total
```

Storage and replication traffic scale accordingly.

For derived/rebuildable tables, maybe separate keyspace/RF? Be careful. Lower RF reduces availability/durability.

Use authority matrix.

---

## 17. Rack/AZ Awareness

Racks should map to failure domains, often availability zones.

Goal:

```text
replicas distributed across racks/AZs
```

If all replicas in same AZ, AZ outage can lose quorum.

Topology design:

```text
dc = cloud region
rack = availability zone
```

Ensure snitch/topology config matches reality.

Wrong rack mapping can silently reduce fault tolerance.

---

## 18. Node Count and RF

With RF=3, minimum production node count per DC should allow replica distribution and failure tolerance.

Tiny clusters have limited fault tolerance and operational flexibility.

Example:

```text
3 nodes RF=3
```

Every node has every token range replica? Losing one node leaves only 2 replicas. Maintenance risky.

More nodes improve distribution and maintenance headroom, but add operational complexity.

---

## 19. Failure Tolerance

Design for:

```text
one node down
one rack/AZ issue
rolling restart
node replacement
repair running
compaction backlog
```

Ask:

```text
Can we meet p99 with one node down?
Can we write LOCAL_QUORUM during one AZ outage?
Can we repair before gc_grace?
```

Capacity should include failure mode, not only all-nodes-healthy mode.

---

## 20. Scale-Out

Adding nodes increases:

- storage capacity,
- CPU,
- memory,
- disk IO,
- network aggregate.

But scale-out triggers:

- data streaming,
- rebalancing/tablet movement,
- network/IO load,
- temporary imbalance,
- operational risk.

Scale out before emergency.

Do not wait until disk 90%.

---

## 21. Scale-In

Removing nodes reduces capacity.

Requires:

- streaming data away,
- ensuring RF/fault tolerance,
- checking disk headroom on remaining nodes,
- avoiding high traffic windows.

Scale-in is riskier than people think.

Do not scale-in based on short-term low utilization if growth/backfill coming.

---

## 22. Node Replacement

Node replacement workflow depends on deployment model.

High-level:

```text
detect failed node
decide replace vs recover
provision new node
join with same topology intent
stream data
verify health
repair/cleanup as needed
```

Application engineer should know:

- node replacement consumes cluster resources,
- latency may rise,
- repair/streaming competes with workload,
- retry/backpressure matters.

---

## 23. Bootstrap and Streaming

New node bootstrap streams data from existing replicas.

Streaming uses:

- network,
- disk reads/writes,
- CPU,
- compaction interactions.

During bootstrap:

- throttle may be needed,
- foreground p99 can be impacted,
- disk headroom must be sufficient.

Operational windows matter.

---

## 24. Decommission

Removing node streams its data to others.

Risk:

- remaining nodes need enough disk,
- network load,
- longer operation under large data,
- failure during decommission complicates.

Plan decommission carefully.

---

## 25. Tablets and Rebalancing

Modern ScyllaDB uses tablets in many configurations to improve elasticity and per-table distribution.

Operational implication:

- data movement can be more granular,
- scaling/rebalancing can improve,
- each table can distribute independently.

But application still must avoid hot partitions.

Tablets help distribution of ranges, not one partition that is too hot/large.

---

## 26. Hot Partition Cannot Be Solved by Scale-Out Alone

If one partition receives 50k writes/sec:

```text
all writes for that partition go to owning replicas/shards
```

Adding nodes may not split that partition.

Fix:

- change key/bucketing,
- shard at application level,
- write aggregation,
- per-key limit,
- queue/stream,
- cache/coalesce.

---

## 27. Large Partition Cannot Be Solved by More Disk Alone

If one partition has 100M rows:

- reads can be slow,
- repair/compaction heavy,
- memory/index overhead,
- tombstones bad.

Fix schema:

```text
time bucket
version bucket
hash bucket
archive
```

---

## 28. Baseline Metrics

Every cluster needs baseline.

Track:

```text
read p50/p95/p99
write p50/p95/p99
timeout rate
unavailable rate
CPU/reactor utilization
disk usage
disk IO latency
network throughput
SSTable count
compaction backlog
cache hit rate
tombstone warnings
large partition warnings
repair status
node up/down
shard imbalance
```

Baseline lets you detect regression.

---

## 29. Table-Level Metrics

Cluster average hides table issues.

Track per table:

```text
read/write latency
read/write QPS
tombstone scans
SSTable count
compaction pending
disk usage
partition size warnings
cache behavior
```

A single bad table can dominate cluster.

---

## 30. Tenant-Level Metrics

From part 024:

```text
top tenants by QPS
top tenants by bytes
top tenants by p99
top tenants by timeout
top tenants by storage
```

Needed for noisy neighbor debugging.

---

## 31. Application Metrics Correlation

Correlate DB metrics with app metrics:

```text
operation name
table
execution profile
CL
tenant tier
fanout count
rows returned
page count
retry count
timeout count
payload bytes
```

Without app metrics, server metrics may show load but not cause.

---

## 32. Capacity Planning Inputs

Collect:

```text
current logical data size
growth per day
read QPS by operation
write QPS by operation
row size distribution
payload size distribution
RF
retention
TTL/delete rate
compaction strategy
tenant skew
fanout per endpoint
backfill/export workload
multi-DC replication
SLO p99
failure tolerance
```

---

## 33. Capacity Planning Example

Workload:

```text
cases current: 2 TB logical
events: 8 TB logical
notifications: 1 TB logical
derived views: 3 TB logical
total logical: 14 TB
RF=3
space amp=1.5
headroom=1.3
```

Physical:

```text
14 * 3 * 1.5 * 1.3 = 81.9 TB
```

If usable per node 5 TB:

```text
ceil(81.9 / 5) = 17 nodes
```

Then validate CPU/IO/QPS capacity separately.

Storage sizing alone does not guarantee throughput.

---

## 34. Throughput Planning Example

Commands:

```text
case_transition = 500/sec peak
```

Each command writes:

```text
1 LWT current update
1 event insert
1 old derived delete
1 new derived insert
1 idempotency update
```

CQL writes:

```text
5 writes/sec per command = 2500 CQL writes/sec
```

RF=3:

```text
7500 replica writes/sec
```

Plus:

- LWT overhead,
- compaction,
- indexes/MVs if any,
- multi-DC replication.

Plan based on write amplification.

---

## 35. Read Planning Example

Endpoint:

```text
assignee queue QPS 1000
bucket fanout 8
source validation average 20 rows
```

DB reads:

```text
8 derived partition reads per request = 8000/sec
20 source point reads per request = 20000/sec
total = 28000 read ops/sec
```

If stale ratio rises, source validation grows.

App-level query design dominates read capacity.

---

## 36. Growth Planning

Capacity plan should include:

```text
daily data growth
seasonal traffic
new tenants
mega tenant onboarding
new derived tables
retention increase
payload growth
schema migrations/backfills
```

Ask product:

```text
Will customers upload larger files?
Will retention increase?
Will reporting be added?
Will new filters require new tables?
```

---

## 37. Retention and TTL Planning

Retention controls storage.

TTL-heavy data needs compaction strategy planning.

If retention changes from 30d to 365d:

```text
storage increases ~12x for that table
```

plus compaction/tombstone effects.

Do not change retention as product flag without capacity review.

---

## 38. Payload Growth

A field that grows from 1 KB to 20 KB can dominate.

Payload growth affects:

- disk,
- network,
- cache,
- Java heap,
- compaction,
- repair,
- backup.

Set max payload sizes at API/repository layer.

---

## 39. Backfill Capacity

Backfill is extra workload.

Reserve capacity:

```text
foreground traffic + backfill traffic + compaction
```

If cluster already near limit, backfill must be slow or cluster scaled first.

Backfill plan should include expected rows/sec and duration.

---

## 40. Operational Baseline Before Launch

Before production launch:

```text
load test realistic workload
chaos test node failure
measure p99 at peak
measure with compaction active
measure backfill impact
verify repair plan
verify backup/restore
verify alerts
verify dashboards
verify runbooks
```

Do not launch based on single-node local benchmark.

---

## 41. Cloud Instance Selection

Consider:

```text
CPU cores
memory per core
local NVMe availability
network bandwidth
EBS/block storage limits if used
NUMA characteristics
cost
availability zones
replacement automation
```

ScyllaDB likes balanced CPU/memory/IO.

Avoid instance with great CPU but weak disk, or huge disk but weak network.

---

## 42. Disk Endurance

Write-heavy LSM systems rewrite data via compaction.

Disk endurance matters, especially with local SSD/NVMe.

Estimate:

```text
logical writes
* RF
* write amplification
* compaction rewrite
```

Cloud-managed disks hide endurance but have throughput/IO limits.

---

## 43. NUMA and CPU Pinning

ScyllaDB is performance-sensitive.

Operational deployments often care about:

- CPU pinning,
- IRQ affinity,
- NUMA locality,
- huge pages,
- kernel tuning,
- IO scheduler.

Java engineer does not need to tune all, but should understand why ScyllaDB AMI/operator images exist.

Use recommended deployment artifacts when possible.

---

## 44. Kubernetes Considerations

ScyllaDB on Kubernetes requires:

- local persistent volumes or suitable storage,
- anti-affinity across nodes/AZs,
- stable network identity,
- resource requests/limits,
- operator lifecycle,
- disruption budgets,
- node replacement automation.

Do not treat ScyllaDB like stateless Deployment.

It is stateful and topology-aware.

---

## 45. Anti-Affinity

Ensure replicas/failure domains not co-located badly.

Kubernetes scheduling should avoid:

```text
multiple Scylla nodes same physical host/AZ if that violates topology
```

Rack/AZ mapping and pod placement must align.

---

## 46. Maintenance Windows

Operations that can affect latency:

- rolling restart,
- upgrade,
- node replacement,
- repair,
- compaction tuning,
- backup,
- backfill,
- schema migration,
- scaling.

Schedule with awareness of traffic peaks and tenant SLAs.

---

## 47. Readiness and Health

Node health is more than process running.

Need monitor:

- gossip state,
- CQL availability,
- disk space,
- compaction backlog,
- latency,
- repair status,
- streaming status.

Application readiness should not flap on brief cluster blips, but must fail if no usable DB path.

---

## 48. SLO and Error Budget

Define:

```text
read p99
write p99
availability
timeout rate
data freshness for derived views
backfill max impact
repair completion window
```

Without SLO, capacity decisions are subjective.

---

## 49. Cost vs Performance

ScyllaDB can be fast, but cost trade-offs:

- more nodes = more cost, more headroom,
- larger instance = simpler but bigger blast radius,
- local NVMe = performance but replacement workflow,
- multi-DC = availability/residency but cost x2/x3,
- higher RF = durability but storage/write cost.

Use workload and SLO to justify.

---

## 50. Operational Ownership Boundaries

Java/application team owns:

- query shape,
- partition key usage,
- fanout,
- retry/backpressure,
- payload size,
- tenant quotas,
- backfill behavior,
- schema migrations.

DB/SRE team owns:

- cluster deployment,
- repair,
- backup,
- upgrades,
- node lifecycle,
- monitoring,
- hardware tuning.

In reality, success requires shared ownership.

---

## 51. Runbooks

Minimum runbooks:

```text
node down
disk usage high
read p99 high
write timeout spike
compaction backlog high
hot partition detected
large partition warning
backfill pause/resume
tenant noisy neighbor
schema migration rollback
scale out
restore test
```

Runbooks should link app operations to DB operations.

---

## 52. Common Anti-Patterns

### 52.1 Sizing Only by Raw Data

Ignores RF, compaction, headroom.

### 52.2 No Disk Headroom

Compaction/recovery failure.

### 52.3 Uniform Tenant Assumption

Mega tenant breaks cluster.

### 52.4 Add Nodes to Fix Hot Partition

Does not work if one key hot.

### 52.5 No Backfill Capacity Plan

Migration causes outage.

### 52.6 Huge Payload in Rows

Disk/network/repair pain.

### 52.7 No Per-Table Metrics

Cluster average hides problem table.

### 52.8 Production on Tiny RF=3 3-node Cluster Without Headroom

Maintenance/failure risky.

### 52.9 Treat Kubernetes DB Like Stateless App

Data loss/performance risk.

### 52.10 No Runbooks

Incident debugging ad hoc.

---

## 53. Operations Checklist

```text
[ ] Logical data size measured.
[ ] RF and space amplification included.
[ ] Disk headroom policy defined.
[ ] Read/write QPS by operation estimated.
[ ] Fanout and derived validation included.
[ ] Tenant skew included.
[ ] Backfill/export load included.
[ ] CPU/memory/disk/network balanced.
[ ] Rack/AZ topology correct.
[ ] Local DC config correct.
[ ] Baseline metrics captured.
[ ] Per-table metrics available.
[ ] Per-tenant/noisy-neighbor metrics available.
[ ] Repair plan defined.
[ ] Backup/restore tested.
[ ] Scale-out threshold defined.
[ ] Runbooks written.
[ ] Load/chaos test completed.
```

---

## 54. Mental Model Compression

Remember:

```text
Storage capacity = logical data * RF * amplification * headroom.
Throughput capacity = app operations * fanout/write amplification * CL.
Latency capacity = p99 under compaction/failure/skew, not average healthy case.
```

And:

```text
ScyllaDB scales well when the workload is distributed well.
Bad keys do not scale.
```

---

## 55. Summary

Operations start before cluster deployment; they start at workload design.

Key lessons:

1. Sizing must include RF, amplification, and headroom.
2. Logical payload size is only part of storage.
3. Write amplification from derived tables matters.
4. Read fanout multiplies DB QPS.
5. p99 under failure/compaction is the real target.
6. CPU, memory, disk, and network must be balanced.
7. Shard-per-core means hot partitions overload specific shards.
8. Disk headroom is mandatory for compaction/recovery.
9. Rack/AZ mapping must reflect real failure domains.
10. Scale-out triggers streaming and should happen before emergency.
11. Adding nodes does not fix one hot partition.
12. Large partitions require schema change.
13. Baselines and per-table metrics are essential.
14. Tenant skew must be part of capacity planning.
15. Backfills are production workloads requiring capacity.
16. Kubernetes deployment needs stateful/topology-aware design.
17. Runbooks are part of production readiness.
18. Application and DB operations are shared responsibility.

---

## 56. Review Questions

1. Mengapa sizing tidak boleh hanya berdasarkan raw data?
2. Apa formula kasar physical storage needed?
3. Apa itu write amplification dari sisi aplikasi?
4. Bagaimana fanout endpoint memengaruhi read capacity?
5. Mengapa p99 harus diuji saat compaction/failure?
6. Apa implikasi shard-per-core untuk hot partition?
7. Kenapa hot partition tidak selesai dengan tambah node?
8. Kenapa disk headroom penting?
9. Apa beda local NVMe dan network block storage?
10. Bagaimana RF memengaruhi storage/write traffic?
11. Mengapa rack/AZ mapping penting?
12. Apa yang terjadi saat scale-out?
13. Apa risiko scale-in?
14. Mengapa large partition butuh schema fix?
15. Apa baseline metrics wajib?
16. Mengapa per-table metrics penting?
17. Bagaimana tenant skew masuk capacity planning?
18. Apa yang harus diuji sebelum launch?
19. Apa pertimbangan Kubernetes untuk ScyllaDB?
20. Apa runbook minimal yang harus ada?

---

## 57. Practical Exercise

Buat capacity plan awal untuk regulatory case platform:

```text
- 20 TB logical live data dalam 12 bulan
- RF=3 single region
- 2 derived tables besar
- 1000 read QPS current case
- 500 read QPS assignee queue dengan fanout 8
- 300 write QPS case transition
- tiap transition 5 CQL writes
- retention notifications 90 hari
- 1 mega tenant 30% traffic
- weekly backfill 50M rows
```

Tulis:

```text
1. storage estimate with amplification/headroom
2. write replica mutation estimate
3. read DB operation estimate
4. hot tenant risk
5. disk headroom policy
6. candidate node count assumptions
7. CPU/disk/network concerns
8. backfill throttle plan
9. metrics needed
10. scale-out trigger
11. runbook needed
```

---

## 58. Preview Part 027

Part berikutnya membahas:

```text
Operations II:
repair,
anti-entropy,
node replacement,
rolling upgrades,
maintenance,
tablets operations,
rebalancing,
and operational failure modes.
```

Part 026 membahas sizing dan baseline operasi.

Part 027 akan membahas lifecycle operasi cluster sehari-hari.

---

# End of Part 026


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Multi-Region and Multi-DC Design: NetworkTopologyStrategy, LOCAL_QUORUM, Home Region, Active-Active, Failover, dan DR Trade-offs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-027.md">Part 027 — Operations II: Repair, Anti-Entropy, Node Replacement, Rolling Upgrades, Maintenance, Tablets Operations, Rebalancing, dan Operational Failure Modes ➡️</a>
</div>

# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-003.md

# Part 003 — Dynamo Lineage: Ring, Token, Replication, Coordinator, Gossip

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `003`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami arsitektur cluster bergaya Dynamo/Cassandra yang menjadi fondasi konsep ring, token, partitioner, replication, coordinator, gossip, hinted handoff, read repair, dan anti-entropy.

---

## 0. Posisi Part Ini dalam Seri

Di part 002 kita membahas constraint distributed OLTP:

- latency p99,
- throughput per partition,
- partial failure,
- consistency level,
- write timeout ambiguity,
- retry safety,
- source of truth vs derived table.

Sekarang kita naik satu level lebih konkret:

> Bagaimana cluster wide-column store tahu data tertentu berada di node mana?

Untuk menjawab itu, kita harus memahami lineage arsitektur Dynamo/Cassandra.

ScyllaDB kompatibel secara konsep dan API dengan Cassandra/CQL, tetapi implementasinya berbeda secara internal. Part ini membahas model cluster level yang dipakai keluarga Cassandra/Dynamo-style systems:

```text
partition key -> hash/token -> token range -> replica placement -> coordinator -> replica response -> consistency decision
```

Kita belum fokus ke shard-per-core ScyllaDB. Itu akan menjadi part 004.

Di part ini, bayangkan dulu node sebagai unit besar:

```text
Node A
Node B
Node C
Node D
```

Di part berikutnya, node akan kita pecah lagi menjadi shard/core internal.

---

## 1. Kenapa Perlu Arsitektur Dynamo-Style?

Distributed OLTP database seperti ScyllaDB harus menjawab beberapa kebutuhan sekaligus:

1. Data harus tersebar ke banyak node.
2. Data harus punya beberapa replica agar tahan failure.
3. Client boleh menghubungi node mana pun.
4. Cluster harus tetap bisa menerima read/write saat sebagian node gagal.
5. Node bisa ditambah/diganti tanpa full cluster downtime.
6. Aplikasi bisa memilih trade-off consistency/latency/availability.
7. Data yang tertinggal di replica harus bisa dikonvergensikan lagi.

Model Dynamo/Cassandra memberi jawaban umum:

```text
- consistent hashing untuk distribusi data,
- replication factor untuk durability/availability,
- coordinator node untuk request orchestration,
- tunable consistency untuk read/write,
- gossip untuk membership/failure detection,
- hinted handoff/read repair/repair untuk convergence.
```

Apache Cassandra documentation menjelaskan bahwa Cassandra mempartisi data menggunakan consistent hashing dan ketika mutation terjadi, coordinator menghitung hash partition key untuk menentukan token range lalu mereplikasi mutation ke replica sesuai replication strategy. ScyllaDB menggunakan model kompatibel Cassandra/CQL, sambil mengimplementasikan engine-nya sendiri. 

---

## 2. Big Picture Request Path

Untuk satu write:

```text
Java Service
   |
   v
Scylla/Cassandra-compatible Driver
   |
   v
Coordinator Node
   |
   +----> Replica 1
   +----> Replica 2
   +----> Replica 3
   |
   v
Response when consistency level satisfied
```

Untuk satu read:

```text
Java Service
   |
   v
Driver
   |
   v
Coordinator Node
   |
   +----> Replica 1
   +----> Replica 2
   +----> Replica 3
   |
   v
Reconcile versions / return result
```

Coordinator tidak harus menjadi pemilik data. Coordinator adalah node yang menerima request dari client/driver dan mengoordinasikan operasi ke replica yang tepat.

Di driver modern, routing bisa token-aware sehingga request dikirim langsung ke node yang kemungkinan menjadi replica/coordinator terbaik. Tetapi secara konseptual, tetap ada coordinator.

---

## 3. Partition Key: Input Pertama dari Semua Keputusan Fisik

Dalam ScyllaDB/Cassandra-style database, partition key adalah komponen primary key yang menentukan distribusi data.

Contoh:

```sql
CREATE TABLE case_events_by_case (
    case_id text,
    event_time timestamp,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY (case_id, event_time, event_id)
);
```

Di sini:

```text
partition key = case_id
clustering columns = event_time, event_id
```

Partition key dipakai untuk menentukan:

```text
case_id -> hash -> token -> token range -> replica set
```

Clustering columns tidak menentukan node mana yang menyimpan data. Clustering columns menentukan ordering data di dalam partition.

Jadi:

```text
Partition key answers: where is the data?
Clustering key answers: how is data ordered inside the partition?
```

Ini perbedaan yang wajib tertanam.

---

## 4. Token: Hash Result yang Menentukan Posisi Data

Partition key tidak langsung menjadi node.

Partition key di-hash oleh partitioner.

Sederhana:

```text
token = hash(partition_key)
```

Contoh konseptual:

```text
hash("CASE-123") = -721389123812381
hash("CASE-456") =  102938102938120
hash("CASE-789") =  889912382193812
```

Token berada dalam token space.

Dalam Murmur3-style partitioner, token space bisa dibayangkan sebagai rentang integer besar.

```text
MIN_TOKEN --------------------------------------------- MAX_TOKEN
```

Cluster membagi token space itu menjadi range.

```text
Range 1: MIN_TOKEN .. -400
Range 2: -399 .. 100
Range 3: 101 .. 700
Range 4: 701 .. MAX_TOKEN
```

Setiap range dimiliki oleh node/replica tertentu.

---

## 5. Ring: Visualisasi Token Space

Token space sering divisualisasikan sebagai ring.

```text
                 [Node A]
              /            \
       Range D              Range A
            /                \
       [Node D]            [Node B]
            \                /
       Range C              Range B
              \            /
                 [Node C]
```

Ring bukan berarti data bergerak melingkar secara literal untuk setiap request. Ring adalah model untuk memetakan token range ke node.

ScyllaDB documentation juga menggambarkan cluster sebagai collection of nodes yang divisualisasikan sebagai ring, dan ring architecture digunakan untuk menjelaskan bagaimana data didistribusikan antar anggota cluster.

### 5.1 Why Ring Matters

Ring membantu menjawab:

```text
Token ini jatuh di range mana?
Node mana yang bertanggung jawab?
Replica berikutnya siapa?
Apa yang terjadi jika node ditambah?
Apa yang terjadi jika node gagal?
```

Tapi ingat: pada versi modern ScyllaDB, data distribution juga memiliki konsep tablets. Tablet akan dibahas di part 005. Untuk part ini, ring/token tetap penting sebagai mental model Cassandra-compatible.

---

## 6. Consistent Hashing

Problem tradisional:

Jika kita punya N node dan memakai:

```text
node = hash(key) % N
```

maka ketika N berubah, hampir semua key bisa berpindah node.

Contoh:

```text
hash(key) % 4
```

lalu scale-out menjadi:

```text
hash(key) % 5
```

Mapping key berubah besar-besaran.

Consistent hashing mengurangi perpindahan data ketika node ditambah/dihapus dengan memetakan node dan key ke token space yang sama.

Sederhana:

```text
key hash falls at token T
owner is node responsible for range containing T
```

Ketika node baru masuk, idealnya hanya sebagian token range yang berpindah.

---

## 7. Replication Factor

Replication factor menentukan berapa copy data yang disimpan.

```text
RF = 3
```

Berarti setiap partition direplikasi ke 3 replica.

Contoh:

```text
Partition token T belongs to:
Replica 1: Node B
Replica 2: Node C
Replica 3: Node D
```

RF bukan consistency level. RF adalah jumlah replica yang seharusnya menyimpan data. Consistency level adalah jumlah replica yang harus merespons suatu operasi sebelum dianggap sukses.

```text
RF = physical redundancy target
CL = runtime acknowledgement requirement
```

### 7.1 RF and Failure Tolerance

Dengan RF=3:

- secara storage, ada 3 copy,
- CL ONE bisa membaca/menulis dengan 1 response,
- CL QUORUM butuh 2 response,
- CL ALL butuh 3 response.

RF=3 + CL QUORUM biasanya bisa tolerate satu replica unavailable untuk operasi tersebut.

Tapi ini bukan janji absolut karena latency, overload, disk problem, dan network partition juga berpengaruh.

---

## 8. Replication Strategy

Replication strategy menentukan bagaimana replica ditempatkan.

Konsep umum:

```text
SimpleStrategy
NetworkTopologyStrategy
```

### 8.1 SimpleStrategy

SimpleStrategy cocok untuk cluster sederhana/non-production/single-DC testing.

Sederhana:

```text
ambil node pertama sesuai token range,
lalu node berikutnya di ring sebagai replica.
```

Masalah:

- tidak sadar data center,
- tidak sadar rack/failure domain dengan baik,
- tidak cocok untuk multi-DC production.

### 8.2 NetworkTopologyStrategy

NetworkTopologyStrategy adalah pilihan production umum.

Ia memungkinkan RF per data center.

Contoh konseptual:

```sql
CREATE KEYSPACE app_ks
WITH replication = {
  'class': 'NetworkTopologyStrategy',
  'dc_jakarta': 3,
  'dc_singapore': 3
};
```

Makna:

```text
Setiap partition punya 3 replica di dc_jakarta
dan 3 replica di dc_singapore.
```

Local operations bisa memakai:

```text
LOCAL_QUORUM
```

untuk quorum di DC lokal, tanpa harus menunggu replica lintas region.

---

## 9. Snitch: Topology Awareness

Snitch memberi database informasi topology:

```text
node ini berada di DC mana?
rack mana?
failure domain mana?
```

Replica placement membutuhkan topology awareness agar replica tidak semua ditempatkan di failure domain yang sama.

Contoh buruk:

```text
Replica 1: Rack A
Replica 2: Rack A
Replica 3: Rack A
```

Jika Rack A bermasalah, semua replica terdampak.

Lebih baik:

```text
Replica 1: Rack A
Replica 2: Rack B
Replica 3: Rack C
```

Untuk production, topology naming harus dirawat serius. Salah konfigurasi DC/rack bisa menyebabkan replication placement buruk dan failure tolerance palsu.

---

## 10. Coordinator Node

Coordinator adalah node yang menerima request dari client.

Satu request CQL:

```sql
SELECT * FROM case_current_by_id WHERE case_id = ?;
```

Driver mengirim ke salah satu node. Node itu menjadi coordinator untuk request tersebut.

Coordinator melakukan:

1. parse/validate request,
2. menentukan partition key/token,
3. menentukan replica set,
4. mengirim read/write request ke replica,
5. menunggu response sesuai consistency level,
6. melakukan reconciliation bila perlu,
7. mengirim hasil ke client.

Coordinator adalah orchestration role, bukan permanent leader.

Dalam ScyllaDB/Cassandra-style systems:

```text
any node can be coordinator
```

Tapi driver yang token-aware dapat memilih coordinator yang lebih dekat dengan data untuk mengurangi hop.

---

## 11. Write Path at Cluster Level

Misal:

```text
RF = 3
Write CL = QUORUM
```

Write request:

```sql
INSERT INTO case_events_by_case (...)
VALUES (...);
```

Langkah konseptual:

```text
1. Client sends write to coordinator.
2. Coordinator hashes partition key to token.
3. Coordinator finds replica set for token.
4. Coordinator sends mutation to replicas.
5. Each replica writes locally.
6. Coordinator waits until 2 of 3 replicas ack.
7. Coordinator returns success to client.
8. Late replica may still receive/apply mutation.
```

Diagram:

```text
Client
  |
  v
Coordinator
  |--------- Replica A -> ack
  |--------- Replica B -> ack
  |--------- Replica C -> slow
  |
  v
Success after A+B for QUORUM
```

Important:

```text
Success at CL QUORUM does not mean all replicas have responded.
It means enough replicas responded.
```

---

## 12. Read Path at Cluster Level

Misal:

```text
RF = 3
Read CL = QUORUM
```

Read request:

```sql
SELECT * FROM case_current_by_id
WHERE case_id = ?;
```

Langkah konseptual:

```text
1. Client sends read to coordinator.
2. Coordinator hashes partition key to token.
3. Coordinator identifies replica set.
4. Coordinator queries enough replicas.
5. Replicas return data/digest.
6. Coordinator reconciles versions if needed.
7. Coordinator returns result.
```

Read at QUORUM may fetch data from multiple replicas.

If replicas differ:

```text
Replica A: status = UNDER_REVIEW, version = 5
Replica B: status = APPROVED, version = 6
Replica C: status = UNDER_REVIEW, version = 5
```

Coordinator must resolve according to database timestamp/version semantics.

This reconciliation is one reason read path is not simply “fetch row from disk”.

---

## 13. Tunable Consistency Revisited

Now consistency level becomes easier to visualize.

RF=3:

```text
Replica set = A, B, C
```

Write CL ONE:

```text
Need ack from any 1 replica.
```

Write CL QUORUM:

```text
Need ack from any 2 replicas.
```

Write CL ALL:

```text
Need ack from all 3 replicas.
```

Read CL ONE:

```text
Need data from any 1 replica.
```

Read CL QUORUM:

```text
Need response from 2 replicas.
```

Quorum overlap:

```text
Write QUORUM touches at least 2 of A/B/C.
Read QUORUM touches at least 2 of A/B/C.
Two sets of 2 in a set of 3 must overlap.
```

But:

- not serializable,
- not global transaction,
- not cross-partition atomicity,
- not uniqueness guarantee beyond primary key/CAS semantics.

---

## 14. Multi-Master Writes

Cassandra-style systems allow multiple replicas to accept mutations. There is no single primary leader for all writes in the normal path.

This is often described as multi-master or leaderless replication.

Benefits:

- high availability,
- no single write leader bottleneck,
- any coordinator can accept request,
- local DC write patterns possible.

Costs:

- conflict resolution needed,
- replica divergence can occur,
- repair mechanisms are necessary,
- timestamp/clock discipline matters,
- concurrent writes to same cell need clear semantics.

### 14.1 Last-Write-Wins Hazard

In Cassandra-compatible semantics, writes often resolve by timestamp at cell level.

If two writers update same column concurrently:

```text
Writer 1: status = APPROVED, timestamp = 100
Writer 2: status = UNDER_REVIEW, timestamp = 101
```

Result can become:

```text
status = UNDER_REVIEW
```

Even if business transition says this is invalid.

Therefore business invariants must not rely blindly on last-write-wins.

For state transitions, consider:

- LWT,
- expected version,
- command serialization,
- append-only event log with deterministic projection,
- single-writer per aggregate.

---

## 15. Gossip: How Nodes Learn Cluster State

Gossip is a peer-to-peer protocol for cluster membership and state dissemination.

Nodes periodically exchange information like:

```text
I am alive.
I know node X is alive/dead/suspect.
I have schema version Y.
I belong to DC/Rack Z.
My host ID is H.
```

Gossip is not the read/write data path itself. It is the cluster metadata propagation mechanism.

Used for:

- node discovery,
- failure detection,
- membership status,
- topology information,
- schema/state dissemination.

### 15.1 Gossip Is Eventually Consistent Too

Different nodes can temporarily have different views of cluster state.

Example:

```text
Node A thinks Node C is down.
Node B still thinks Node C is up.
```

This can affect routing, availability perception, and operational behavior.

In production incidents, it matters to ask:

```text
Do all nodes agree on cluster membership?
Do all nodes agree on schema?
Do all nodes agree on topology/DC/rack?
```

---

## 16. Failure Detection

Distributed systems cannot perfectly distinguish:

```text
node is dead
```

from:

```text
node is slow
network is congested
packet dropped
GC pause in client
disk stalled
```

Failure detector uses suspicion based on missed heartbeats/gossip signals.

This introduces false positives and false negatives.

False positive:

```text
Node is alive but suspected down.
```

False negative:

```text
Node is unhealthy but not yet marked down.
```

Engineering implication:

- never assume membership state changes are instant,
- avoid flapping nodes,
- investigate network and overload before replacing hardware,
- design CL/RF to tolerate temporary uncertainty.

---

## 17. Hinted Handoff

Hinted handoff helps reduce inconsistency when a replica is temporarily unavailable.

Scenario:

```text
RF = 3
Replica set = A, B, C
C is down
Write CL = QUORUM
```

Coordinator writes to A and B. Since C is down, coordinator stores a hint:

```text
When C returns, send it this missed mutation.
```

Later:

```text
C comes back
Coordinator/node replays hint to C
C catches up for those missed writes
```

Diagram:

```text
Write to A -> success
Write to B -> success
Write to C -> unavailable
Store hint for C
Later replay hint to C
```

Important limitation:

> Hinted handoff reduces inconsistency window but does not replace repair.

ScyllaDB documentation explicitly notes that enabling hinted handoff does not eliminate the need for repair; users must still run repair to ensure data consistency across cluster nodes.

### 17.1 Why Hinted Handoff Is Not Enough

Hints can fail or expire.

Examples:

- coordinator storing hint crashes,
- hint storage fills,
- target node down too long,
- mutation missed due to other failure path,
- topology changes complicate ownership,
- delete/tombstone behavior requires careful convergence.

So hinted handoff is a helpful fast catch-up mechanism, not a full consistency guarantee.

---

## 18. Read Repair

Read repair is a mechanism where inconsistencies found during reads can be repaired.

Scenario:

```text
Replica A has version 5
Replica B has version 6
Replica C has version 5
```

A quorum read sees discrepancy and coordinator can return latest resolved value and repair stale replica(s).

Conceptually:

```text
Read detects mismatch -> send update to stale replica
```

Read repair helps convergence for data that is actively read.

Limitation:

```text
Data that is rarely read may remain inconsistent until repair.
```

So read repair is not enough for full anti-entropy.

---

## 19. Anti-Entropy Repair

Repair is the process of comparing replica data and synchronizing differences.

It is required because:

- writes can miss replicas,
- hints may not cover all gaps,
- reads may not touch all stale data,
- nodes can be down for long periods,
- network partitions can create divergence.

Repair is the systematic convergence mechanism.

At high level:

```text
compare token ranges between replicas
detect differences
stream missing/outdated data
converge replicas
```

Repair has operational cost:

- CPU,
- disk IO,
- network bandwidth,
- compaction interaction,
- latency impact if overloaded.

Therefore repair is not just “maintenance”. It is part of the correctness model.

---

## 20. Merkle Trees: Conceptual Repair Optimization

Many Dynamo-style systems use Merkle-tree-like structures conceptually for anti-entropy: compare hashes of ranges to identify differences without transferring all data.

High-level idea:

```text
hash range
if hash equal -> assume same
if hash different -> split/compare smaller ranges
transfer differences
```

You do not need to implement this as application engineer, but you need the mental model:

```text
Repair compares ranges, not business entities.
Bad partitioning and huge ranges can make repair expensive.
```

---

## 21. Token Ranges and Operational Thinking

Operators often think in token ranges, not just tables.

Questions:

```text
Which node owns this token range?
Which ranges are being repaired?
Which ranges moved during bootstrap?
Which node has too much ownership?
Which tablet/token range is hot?
```

Application engineers often think:

```text
case_id = CASE-123
```

Database thinks:

```text
hash(CASE-123) -> token -> token range -> replica set
```

Bridging these views is crucial for troubleshooting.

---

## 22. Virtual Nodes / VNodes

Classic token assignment gave each node one or few token ranges. VNodes allow each node to own many smaller token ranges.

Benefits:

- better distribution,
- easier scaling,
- less manual token calculation,
- smoother rebalancing.

Cost:

- more metadata,
- more complex repair/streaming paths,
- operational reasoning can be less simple.

ScyllaDB also evolves beyond classic vnode thinking with tablets, covered later. But vnodes are important when reading Cassandra literature and older ScyllaDB material.

---

## 23. Tablets Preview

Modern ScyllaDB documentation describes tablets as a way to divide tables into smaller independently managed units, each with replicas placed across nodes according to RF.

Do not confuse:

```text
partition
token range
tablet
node
shard
replica
```

Working preview:

| Concept | Meaning |
|---|---|
| Partition | Logical group of rows by partition key |
| Token | Hash value of partition key |
| Token range | Slice of token space |
| Tablet | Modern ScyllaDB data distribution unit for table ranges |
| Node | ScyllaDB instance |
| Shard | Per-core execution/storage unit inside node |
| Replica | Copy of data range/partition on a node |

Part 005 will focus specifically on tablets and modern ScyllaDB distribution.

---

## 24. What Happens When Adding a Node?

Scale-out is not magic.

Conceptual steps:

```text
1. New node joins cluster.
2. Cluster membership/topology changes.
3. Token/tablet ownership changes.
4. Existing nodes stream data to new node.
5. Load gradually redistributes.
6. Repair/cleanup may be needed depending operation.
```

During this process:

- network usage increases,
- disk IO increases,
- compaction may increase,
- latency can be affected,
- topology metadata changes,
- clients need updated routing metadata.

Adding nodes increases capacity after data and traffic redistribute. It does not instantly fix a hot partition.

If one partition key is hot, adding nodes does not split that partition automatically at the logical data model level. You need bucketing/remodeling.

---

## 25. What Happens When a Node Fails?

Suppose RF=3 and Node C fails.

For partitions where C is one replica:

```text
Remaining replicas A and B can serve if CL allows.
```

With CL QUORUM:

```text
A+B can satisfy quorum.
```

With CL ALL:

```text
request fails.
```

While C is down:

- writes may be accepted by A/B,
- hints may be stored for C,
- reads may avoid C,
- consistency risk increases,
- repair may be needed after recovery.

If node is permanently gone:

```text
replace node / rebuild data from remaining replicas
```

Operational decision depends on:

- data volume,
- duration down,
- hinted handoff window,
- RF,
- consistency level,
- repair status,
- whether disk is recoverable,
- whether node identity should be preserved.

---

## 26. Rack and DC Failure

Single node failure is the easy case.

Rack failure:

```text
Many nodes in same rack unavailable.
```

DC failure:

```text
Entire region unavailable.
```

Production replication must ensure replica placement across failure domains.

If all replicas of a partition are in same rack, RF=3 gives false confidence.

Topology-aware placement matters because high availability is not only copy count; it is copy placement.

```text
Replication Factor without failure-domain diversity is incomplete resilience.
```

---

## 27. Driver Metadata and Token Awareness

The Java driver maintains metadata about:

- cluster nodes,
- keyspaces/tables,
- token ranges,
- replica placement,
- topology,
- schema.

With token-aware routing, driver can compute partition key token and choose an appropriate node.

Without token awareness:

```text
driver sends request to random node
random node forwards internally to replicas
```

With token awareness:

```text
driver sends request to likely replica/coordinator for that partition
```

Benefits:

- lower latency,
- less coordinator forwarding,
- better load distribution,
- fewer unnecessary hops.

In ScyllaDB, shard-aware drivers improve this further by routing to the specific shard/core responsible for the token, discussed in part 004 and Java parts.

---

## 28. Request Routing Example

Table:

```sql
CREATE TABLE case_current_by_id (
    case_id text PRIMARY KEY,
    status text,
    version bigint,
    updated_at timestamp
);
```

Request:

```java
select * from case_current_by_id where case_id = "CASE-123";
```

Flow:

```text
1. Driver knows prepared statement metadata.
2. Driver extracts partition key: CASE-123.
3. Driver hashes CASE-123 -> token T.
4. Driver checks token map -> replicas A/B/C.
5. Driver chooses coordinator, ideally one replica.
6. Coordinator sends read to replicas according to CL.
7. Result returned.
```

If app query does not include full partition key:

```sql
SELECT * FROM case_current_by_id WHERE status = 'OPEN';
```

The driver cannot route to a single partition. The database also cannot efficiently locate rows without a matching model/index.

This is why query-first modeling matters.

---

## 29. Coordinator Overload

A node can become overloaded as coordinator even if it is not the only replica for hot data.

Causes:

- driver not token-aware,
- bad load balancing policy,
- too many clients pinned to one contact point,
- topology metadata stale,
- load balancer in front of DB,
- application DNS behavior,
- uneven connection pool,
- large fanout queries.

For ScyllaDB/Cassandra-style databases, avoid treating the cluster as a generic TCP pool behind a naive load balancer unless explicitly supported and understood.

Driver should understand cluster topology.

---

## 30. Fanout Query Hazard

Good query:

```text
one partition key -> known replica set -> bounded read
```

Bad query:

```text
scan many partitions -> many token ranges -> many nodes -> coordinator merges huge result
```

Fanout can occur intentionally:

- query all buckets for a tenant/day,
- query multiple assignee buckets,
- query many partitions in parallel.

This may be acceptable if bounded.

Dangerous fanout:

- unbounded tenant scan,
- query by non-key attribute,
- ALLOW FILTERING,
- large IN clause,
- application loops over thousands of partition keys,
- pagination over unstable large set.

Fanout multiplies:

```text
request count
network hops
coordinator work
tail latency
retry load
```

---

## 31. Hinted Handoff vs Read Repair vs Repair

These are often confused.

| Mechanism | Trigger | Purpose | Limitation |
|---|---|---|---|
| Hinted handoff | Write misses unavailable replica | Replay missed mutations later | Not complete; hints can expire/fail |
| Read repair | Read detects replica mismatch | Repair actively read data | Only repairs data that is read |
| Repair | Scheduled/explicit anti-entropy | Systematically synchronize replicas | Operationally expensive |

Mental model:

```text
hinted handoff = quick catch-up for temporary outage
read repair = opportunistic convergence on read
repair = systematic convergence across ranges
```

Production needs repair discipline. Hints and read repair are not enough.

---

## 32. Node State Terms

You will encounter terms like:

```text
UN
UJ
UL
DN
DJ
DL
```

Common nodetool-style mental model:

| State | Meaning |
|---|---|
| UN | Up/Normal |
| DN | Down/Normal |
| UJ | Up/Joining |
| UL | Up/Leaving |
| UM | Up/Moving |
| ? | Unknown/transition depending tooling |

Do not memorize only codes. Understand operational meaning:

```text
Is node serving?
Is node joining/leaving?
Is ownership changing?
Is streaming happening?
Is cluster in steady state?
```

---

## 33. Schema Agreement

In a distributed cluster, schema changes must propagate.

If one node knows schema version A and another knows schema version B, request behavior can be inconsistent.

Schema agreement means nodes converge on the same schema metadata.

Operational implications:

- avoid rapid repeated schema changes,
- deploy schema migrations carefully,
- monitor schema agreement,
- treat schema migration as distributed operation,
- do not mix app deployments that assume incompatible schema.

Application-level schema compatibility will be covered in part 023.

---

## 34. Write Conflict Example

Two services write same row/column.

```text
Service A:
status = APPROVED at timestamp 100

Service B:
status = REJECTED at timestamp 101
```

Database-level result may be:

```text
status = REJECTED
```

But business may require:

```text
APPROVED and REJECTED are mutually exclusive terminal decisions.
Only reviewer authority can transition.
Transition requires previous status UNDER_REVIEW.
```

The cluster architecture gives high availability, not business correctness.

Correct design needs:

- explicit command model,
- expected previous state,
- LWT or serialized command handling,
- immutable audit events,
- reconciliation,
- authority checks outside DB,
- monotonic domain transitions.

---

## 35. Delete Conflict and Zombie Risk Preview

Deletes in Cassandra-compatible systems are represented with tombstones for some time. This prevents deleted data from reappearing when stale replicas are repaired incorrectly.

Conceptual scenario:

```text
Replica A sees delete.
Replica B was down and still has old value.
Tombstone expires before repair.
Replica B comes back with old value.
Old value can be treated as live again.
```

This is the “zombie data” risk.

We will go deep in part 015. For now, understand:

```text
Replication + delete + repair timing = correctness concern.
```

Delete is not a simple physical remove in distributed wide-column databases.

---

## 36. Operational Metadata Is Part of the System

A ScyllaDB/Cassandra-style cluster is not just:

```text
data files + query engine
```

It also depends on metadata:

- token map,
- schema versions,
- host IDs,
- topology/rack/DC,
- repair history,
- hints,
- snapshots,
- compaction state,
- driver metadata,
- node state,
- system tables.

Production incidents often happen because metadata and data path assumptions diverge.

Example:

```text
App thinks all nodes are available.
Driver metadata is stale.
Cluster topology changed.
Requests route inefficiently.
One coordinator becomes overloaded.
p99 rises.
Retries amplify.
```

---

## 37. Application-Level Implications for Java Engineers

### 37.1 Use Prepared Statements

Prepared statements allow driver to understand statement structure and partition key binding better.

Bad:

```java
session.execute("SELECT * FROM case_current_by_id WHERE case_id = '" + id + "'");
```

Better:

```java
PreparedStatement ps = session.prepare(
    "SELECT * FROM case_current_by_id WHERE case_id = ?"
);
BoundStatement bs = ps.bind(id);
session.execute(bs);
```

### 37.2 Avoid Hiding Partition Key

Repository method should expose partition-oriented access.

Bad:

```java
List<Case> findCases(CaseFilter filter);
```

This invites arbitrary filters.

Better:

```java
CaseCurrent findByCaseId(CaseId caseId);
List<CaseEvent> findLatestEvents(CaseId caseId, int limit);
List<OpenCase> findOpenCasesByAssigneeBucket(AssigneeId assigneeId, LocalDate bucketDay, int limit);
```

### 37.3 Encode Consistency Intent

Bad:

```java
caseRepository.save(case);
```

Better:

```java
caseEventStore.appendAuthoritativeEvent(event, Consistency.LOCAL_QUORUM);
caseReadModel.updateDerivedAssigneeView(update, Consistency.LOCAL_ONE);
```

Even if actual driver API differs, repository contract should clarify authority and consistency.

### 37.4 Treat Timeout as Unknown

Bad:

```java
try {
    repo.write(command);
} catch (TimeoutException e) {
    return FAILED;
}
```

Better:

```text
Timeout means outcome unknown.
Use idempotency key.
Retry only if safe.
Expose pending/unknown command state if business requires.
Reconcile later.
```

---

## 38. Troubleshooting Mental Model

When a query is slow:

1. Is it a single partition query?
2. Does it include full partition key?
3. Which token does the key map to?
4. Which replicas own it?
5. Which coordinator served it?
6. Is coordinator also replica?
7. Is one replica slow?
8. Is one node overloaded?
9. Is one shard hot?
10. Is partition large?
11. Are tombstones involved?
12. Are retries amplifying?
13. Is driver routing correctly?
14. Is topology metadata fresh?
15. Is repair/streaming/compaction running?

This is the path from “database slow” to a concrete hypothesis.

---

## 39. Design Review Checklist

For each table:

```text
[ ] Full partition key is known for primary queries.
[ ] Partition cardinality is high enough.
[ ] Hot key risk has been estimated.
[ ] Replica placement and RF are known.
[ ] Read and write CL are chosen.
[ ] Timeout outcome is defined.
[ ] Retry safety is defined.
[ ] Derived table authority is defined.
[ ] Repair/rebuild path exists.
[ ] Multi-DC behavior is explicit.
[ ] Driver routing can be token-aware.
[ ] Query does not rely on cluster-wide scan.
```

For each service:

```text
[ ] No generic arbitrary filter repository over ScyllaDB tables.
[ ] No unbounded fanout.
[ ] No unsafe retry for non-idempotent writes.
[ ] No hidden cross-partition transaction assumption.
[ ] No assumption that CL QUORUM equals SQL transaction.
[ ] No assumption that hints replace repair.
[ ] No assumption that adding nodes fixes hot partition.
```

---

## 40. Common Misconceptions

### Misconception 1: “Coordinator is the leader.”

No. Coordinator is per-request orchestration role. There is no permanent leader for normal writes in the Dynamo/Cassandra-style path.

### Misconception 2: “RF=3 means every successful write reached 3 nodes.”

No. RF=3 means target replication count is 3. Write CL determines how many acks are needed before success.

### Misconception 3: “Read repair means we do not need repair.”

No. Read repair only helps data that is read and detected inconsistent. Full/incremental repair remains necessary.

### Misconception 4: “Hinted handoff guarantees missed writes are replayed.”

No. Hints reduce inconsistency but can fail/expire and do not replace repair.

### Misconception 5: “Adding nodes improves every workload.”

No. Adding nodes improves distributed workloads. Hot partitions remain hot unless data model changes.

### Misconception 6: “Any node can serve any query equally.”

Any node can coordinate, but token-aware/shard-aware routing matters for latency and load.

---

## 41. Mental Model Compression

If you need to remember part ini dalam satu diagram:

```text
CQL statement
   |
   v
partition key
   |
   v
hash / token
   |
   v
token range
   |
   v
replica set
   |
   v
coordinator sends request to replicas
   |
   v
consistency level decides enough responses
   |
   v
repair mechanisms converge missed differences over time
```

And the core warning:

```text
The database can distribute data only according to the partition key you gave it.
```

---

## 42. Summary

Dynamo/Cassandra-style architecture is the cluster-level foundation behind ScyllaDB-compatible behavior.

Key takeaways:

1. Partition key hashes to token.
2. Token maps to token range.
3. Token range maps to replica set.
4. RF controls target number of replicas.
5. CL controls required responses per operation.
6. Coordinator orchestrates request but is not a permanent leader.
7. Gossip spreads membership and topology state.
8. Failure detection is suspicion-based, not perfect truth.
9. Hinted handoff helps missed writes but does not replace repair.
10. Read repair helps actively read inconsistent data.
11. Repair is systematic anti-entropy.
12. Driver token awareness matters.
13. Hot partition cannot be solved merely by adding nodes.
14. Topology/rack/DC placement is part of correctness and availability.
15. Application-level invariants still need explicit design.

---

## 43. Review Questions

1. Apa perbedaan partition key dan clustering key dalam routing data?
2. Apa itu token?
3. Kenapa consistent hashing lebih baik daripada `hash(key) % node_count`?
4. Apa perbedaan RF dan CL?
5. Apa peran coordinator?
6. Apakah coordinator adalah leader?
7. Apa yang dilakukan gossip?
8. Kenapa failure detection tidak bisa sempurna?
9. Apa fungsi hinted handoff?
10. Kenapa hinted handoff tidak menggantikan repair?
11. Apa fungsi read repair?
12. Kenapa read repair tidak cukup untuk data yang jarang dibaca?
13. Apa fungsi anti-entropy repair?
14. Mengapa NetworkTopologyStrategy penting untuk production?
15. Apa risiko salah konfigurasi rack/DC?
16. Apa manfaat token-aware driver?
17. Kenapa adding node tidak memperbaiki hot partition?
18. Apa risiko active-active concurrent writes ke cell yang sama?
19. Kenapa delete/tombstone terkait repair?
20. Bagaimana kamu menjelaskan request path dari Java driver ke replica?

---

## 44. Practical Exercise

Ambil table berikut:

```sql
CREATE TABLE case_events_by_case (
    case_id text,
    event_time timestamp,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY (case_id, event_time, event_id)
);
```

Jawab:

```text
1. Apa partition key?
2. Apa clustering key?
3. Apa yang di-hash menjadi token?
4. Jika RF=3, berapa replica target?
5. Jika write CL=LOCAL_QUORUM, berapa ack dibutuhkan di local DC?
6. Jika satu replica down, apakah write masih bisa sukses?
7. Apa yang terjadi pada replica down?
8. Apakah hinted handoff cukup?
9. Jika read CL=ONE, apa risiko stale read?
10. Jika partition case_id sangat hot, apakah tambah node cukup?
11. Bagaimana bucketing bisa membantu?
12. Apa trade-off bucketing terhadap read latest events?
```

Tulis jawaban sebelum lanjut ke part 004.

---

## 45. Preview Part 004

Part berikutnya akan masuk ke ScyllaDB-specific architecture:

```text
shard-per-core
Seastar
reactor model
shared-nothing node internals
CPU pinning
memory ownership
per-shard scheduling
cross-shard cost
shard-aware driver
```

Part 003 melihat cluster sebagai kumpulan node.

Part 004 akan membuka isi satu node dan menjelaskan kenapa ScyllaDB bisa punya performa sangat tinggi dibanding implementasi JVM-based Cassandra, serta apa konsekuensinya bagi Java application engineer.

---

# End of Part 003

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Distributed OLTP Constraints: Latency, Throughput, Availability, Consistency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-004.md">Part 004 — ScyllaDB Architecture: Shard-per-Core, Seastar, Reactor, dan Shared-Nothing Node ➡️</a>
</div>

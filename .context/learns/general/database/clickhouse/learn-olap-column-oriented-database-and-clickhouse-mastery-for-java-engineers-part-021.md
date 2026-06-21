# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-021.md

# Part 021 — Distributed ClickHouse II: Consistency, Failover, Keeper, and Operational Realities

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **021 / 034**  
> Fokus: memahami realitas operasional distributed ClickHouse: consistency, replication, failover, ClickHouse Keeper/ZooKeeper, replica lag, quorum, distributed DDL, recovery, dan failure modeling.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita membahas distributed ClickHouse dari sisi structural:

- shard;
- replica;
- local table;
- distributed table;
- sharding key;
- query routing;
- insert routing;
- fan-out/fan-in;
- distributed aggregation;
- distributed joins;
- skew;
- multi-tenancy;
- Java service access pattern.

Part ini melanjutkan dengan sisi yang lebih operasional dan sering menjadi sumber incident:

- apakah data sudah visible di semua replica?
- apa yang terjadi jika satu replica down?
- apa bedanya insert success, replication success, dan query consistency?
- bagaimana replication queue bekerja?
- apa peran ClickHouse Keeper?
- apa risiko distributed DDL?
- apa yang harus dicek ketika query hasilnya beda antar node?
- bagaimana recovery setelah node mati?
- bagaimana membuat runbook failover?

Distributed ClickHouse tidak hanya soal “punya banyak node”.  
Ia adalah sistem yang harus dikelola dengan pemahaman jelas tentang **replication semantics, failure domains, coordination, and operational lag**.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu diharapkan mampu:

1. menjelaskan peran ClickHouse Keeper/ZooKeeper dalam replicated tables;
2. memahami replication queue dan part replication;
3. membedakan insert acknowledged, replicated, visible, dan query-consistent;
4. memahami replica lag dan dampaknya ke dashboard/API;
5. memahami insert quorum secara konseptual;
6. menjelaskan failover behavior pada replicated local tables dan distributed queries;
7. memahami distributed DDL dan risiko schema drift;
8. membuat runbook ketika replica lagging, part missing, mutation stuck, atau node down;
9. mendesain consistency expectation untuk Java analytics API;
10. memahami trade-off availability vs consistency vs latency pada ClickHouse;
11. membangun mental model recovery dan operational validation;
12. mengenali kapan masalah distributed sebenarnya berasal dari ingestion/modeling/query design.

---

## 2. Mental Model Utama: Replication Itu Asynchronous Coordination of Parts

Pada `MergeTree`, data ditulis sebagai **parts**.

Pada `ReplicatedMergeTree`, part yang dibuat di satu replica perlu direplikasi ke replica lain dalam shard yang sama.

Konsep high-level:

```text
Client inserts block into one replica
→ replica creates data part
→ metadata/coordination records part existence
→ other replicas see they need that part
→ other replicas fetch part
→ replication queue eventually catches up
```

Jadi replication adalah proses:

```text
part creation
+ metadata coordination
+ fetch/copy
+ queue processing
+ background merge alignment
```

Bukan satu operasi monolitik sederhana.

Ketika insert sukses, pertanyaan lanjutan:

1. Sukses di replica mana?
2. Apakah part sudah dicopy ke replica lain?
3. Apakah query membaca replica yang sudah punya part?
4. Apakah Distributed table memilih replica yang lagging?
5. Apakah insert quorum dipakai?
6. Apakah query setting menuntut fresh replica?
7. Apakah background merge/mutation mempengaruhi visibility?

---

## 3. Peran ClickHouse Keeper / ZooKeeper

### 3.1 Apa Itu Keeper?

ClickHouse Keeper adalah coordination service yang compatible dengan ZooKeeper protocol dan digunakan oleh ClickHouse untuk koordinasi replicated tables.

Secara konsep, Keeper/ZooKeeper menyimpan metadata koordinasi seperti:

- daftar replicas;
- log operasi replicated table;
- metadata part;
- leader/election coordination tertentu;
- distributed DDL tasks;
- replication state.

Keeper bukan tempat data columnar utama disimpan. Data utama tetap berada di ClickHouse storage.

### 3.2 Kenapa Dibutuhkan?

Replicated tables perlu coordination:

```text
Replica A menulis part X
Replica B harus tahu part X perlu difetch
Replica C harus tahu mutation Y perlu diterapkan
DDL on cluster perlu dikoordinasikan
```

Tanpa coordination service, replicas tidak punya source of coordination yang konsisten.

### 3.3 Keeper Failure Impact

Jika Keeper unavailable:

- replicated table operations bisa terganggu;
- insert ke replicated table dapat gagal atau tertahan;
- replicas tidak bisa update coordination state;
- DDL on cluster bisa terganggu;
- existing local data mungkin masih bisa dibaca dalam beberapa kondisi;
- recovery tergantung durasi outage dan configuration.

Jangan treat Keeper sebagai aksesoris. Ia bagian dari control plane.

### 3.4 Keeper Is Control Plane, Not Data Plane

Data plane:

```text
ClickHouse parts on disk
```

Control plane:

```text
Keeper metadata coordination
```

Jika Keeper down, data existing belum tentu hilang, tetapi cluster coordination terganggu.

### 3.5 Operational Requirements

Keeper harus:

- highly available;
- monitored;
- backed up/snapshotted sesuai kebutuhan;
- punya disk reliable;
- punya low latency antar ClickHouse nodes;
- tidak overloaded;
- tidak ditempatkan sembarangan di node yang sering restart.

---

## 4. ReplicatedMergeTree Write Flow

### 4.1 Simplified Flow

Insert into replicated table:

```text
1. Client sends insert to replica A.
2. Replica A writes block as part locally.
3. Replica A records part metadata in Keeper.
4. Other replicas observe log entry.
5. Other replicas enqueue fetch task.
6. Other replicas fetch part from replica A or another replica.
7. Replication queue processes until caught up.
```

### 4.2 Merge Flow

Merges also coordinated.

```text
Replica decides/records merge
→ merge operation appears in replication log
→ replicas perform/fetch resulting merged part
```

In practice, exact details depend on version/settings, but mental model remains:

```text
replicated tables coordinate part-level operations through Keeper
```

### 4.3 Mutations

Mutations on replicated tables are also coordinated and eventually applied by replicas.

This means mutation lag can differ by replica.

A query reading a lagging replica may see different mutation state unless settings avoid stale replica.

---

## 5. Visibility and Consistency Vocabulary

You need precise vocabulary.

### 5.1 Insert Acknowledged

Client received success from the replica/coordinator it inserted into.

Does not necessarily mean all replicas have the part.

### 5.2 Replicated

Other replicas in the shard have fetched/applied the part.

### 5.3 Visible

A query reading a particular replica can see the data.

### 5.4 Globally Visible

All replicas that might serve reads have the data.

### 5.5 Query-Consistent

A query's result matches the freshness/consistency expectation of the application.

This may require:

- reading from non-lagging replicas;
- quorum insert;
- sequential consistency settings;
- avoiding stale replicas;
- waiting for replication;
- application-level consistency boundary.

### 5.6 Eventual Consistency

Replicated data becomes consistent eventually if the system is healthy.

Many ClickHouse replication scenarios are eventually consistent from the perspective of replicas.

---

## 6. Replica Lag

### 6.1 What Is Replica Lag?

Replica lag means a replica is behind in applying/fetching parts, merges, or mutations.

Causes:

- network issue;
- disk slow;
- CPU overloaded;
- too many parts;
- mutation backlog;
- Keeper issues;
- replica restart;
- insufficient background threads;
- fetch failures;
- disk full.

### 6.2 Why It Matters

If Distributed query chooses a lagging replica, result can be stale or inconsistent.

Example:

```text
Replica A has latest events
Replica B lags by 10 minutes
Distributed query reads B
Dashboard misses latest data
```

### 6.3 Detecting Replica Lag

Use `system.replicas`.

Example:

```sql
SELECT
    database,
    table,
    is_leader,
    is_readonly,
    is_session_expired,
    future_parts,
    parts_to_check,
    queue_size,
    inserts_in_queue,
    merges_in_queue,
    part_mutations_in_queue,
    absolute_delay,
    total_replicas,
    active_replicas
FROM system.replicas
WHERE database = 'analytics';
```

Important signals:

- `queue_size`;
- `absolute_delay`;
- `future_parts`;
- `inserts_in_queue`;
- `merges_in_queue`;
- `part_mutations_in_queue`;
- `is_readonly`;
- `is_session_expired`;
- `active_replicas`.

### 6.4 Replication Queue

Use `system.replication_queue`.

```sql
SELECT
    database,
    table,
    replica_name,
    type,
    create_time,
    required_quorum,
    source_replica,
    new_part_name,
    parts_to_merge,
    num_tries,
    last_exception
FROM system.replication_queue
WHERE database = 'analytics'
ORDER BY create_time
LIMIT 100;
```

Look for:

- old tasks;
- repeated failures;
- fetch errors;
- merge/mutation backlog;
- quorum tasks;
- part not found.

### 6.5 Lag SLO

Define acceptable lag.

Examples:

| Workload | Lag tolerance |
|---|---|
| Real-time fraud dashboard | seconds |
| Product analytics dashboard | 1-5 minutes |
| Daily report | hours |
| Regulatory official report | controlled snapshot/version |
| Ad-hoc exploration | flexible |

Without explicit lag SLO, nobody knows whether cluster is healthy.

---

## 7. Insert Quorum

### 7.1 Concept

Insert quorum means insert is considered successful only after data is written to a specified number of replicas.

Conceptual:

```text
replication factor = 2
insert_quorum = 2
insert success only after both replicas have the part
```

### 7.2 Benefit

- stronger write durability/visibility guarantee;
- reduces chance of acknowledged insert lost if one replica dies before replication;
- useful for high-value data.

### 7.3 Cost

- higher insert latency;
- lower availability if replicas unavailable;
- more sensitivity to lag/network issues;
- can reduce ingestion throughput;
- operational complexity.

### 7.4 When To Use

Consider for:

- critical audit events;
- financial/regulatory events;
- data where acknowledged write must survive replica failure;
- systems with strict freshness requirements.

### 7.5 When Not To Use

Avoid blindly for:

- ultra-high-volume logs where eventual replication acceptable;
- ingestion where latency/availability matter more;
- systems with unstable replicas;
- backfill bulk loads unless required.

### 7.6 Application-Level Framing

Java API should understand:

```text
acknowledged write without quorum != visible on every replica
```

If a write is immediately followed by a read, read-after-write consistency may need special handling.

---

## 8. Read Consistency and Replica Selection

### 8.1 Distributed Query Replica Selection

A Distributed query typically selects one replica per shard based on load balancing/settings/health.

If a selected replica is lagging, result may be stale.

### 8.2 Avoiding Stale Replicas

ClickHouse has settings to prefer/avoid replicas based on delay. Exact settings and defaults can vary by version/config.

Conceptually, you want:

```text
do not read from replicas with delay > threshold
```

Trade-off:

- stricter freshness reduces stale reads;
- may reduce availability if all replicas lag;
- may increase load on fresh replicas.

### 8.3 Sequential Consistency

Some settings can enforce stronger sequential consistency for replicated reads/writes, at the cost of latency/availability.

Use only when requirement is real and measured.

### 8.4 Dashboard Consistency

For dashboards, often better:

- expose data freshness timestamp;
- use ingestion watermark;
- tolerate small lag;
- avoid read-after-write assumptions;
- query aggregate tables with defined refresh window.

### 8.5 API Semantics

For Java service, define:

```text
This endpoint returns data fresh within 2 minutes.
```

or:

```text
This official report is based on snapshot version 2026-06-v3.
```

Do not imply strict real-time consistency unless engineered.

---

## 9. Failover

### 9.1 Replica Failure

If one replica in a shard fails:

```text
Shard 1: replica A down, replica B alive
```

Distributed queries can use replica B.

Insert behavior depends on where writes go and settings.

### 9.2 Shard Failure

If all replicas for a shard fail:

```text
Shard 1 unavailable
```

Cluster cannot serve complete data for that shard.

Queries may fail or return incomplete results depending settings. For correctness, failing is often better than silently incomplete results.

### 9.3 Keeper Failure

If Keeper cluster unavailable:

- reads of existing local data may still work in limited ways;
- replicated writes/coordination fail;
- DDL tasks fail;
- replication stalls;
- failover coordination impaired.

### 9.4 Coordinator Failure

If node receiving query dies, query fails. Client should retry safely.

For idempotent SELECT, retry is fine.

For INSERT, retry requires idempotency.

### 9.5 Network Partition

Scenarios:

1. replica cannot talk to Keeper;
2. replica cannot talk to other replicas;
3. client can reach one replica but not others;
4. shards split into isolated groups.

Behavior depends on settings, but operationally:

- avoid writes if consistency uncertain;
- monitor readonly/session expired;
- prefer failure over split-brain-like confusion;
- recover by reconciling replicas.

---

## 10. ClickHouse Keeper Operational Model

### 10.1 Ensemble

Keeper should run as an odd-numbered quorum-based service, commonly 3 or 5 nodes depending scale.

Do not run single Keeper for serious production unless downtime/data coordination risk is acceptable.

### 10.2 Latency

Replication coordination is sensitive to Keeper latency.

High Keeper latency can cause:

- slower inserts;
- delayed replication;
- DDL delays;
- session expirations;
- replicas becoming readonly.

### 10.3 Disk

Keeper uses disk for logs/snapshots. Slow or full disk can affect cluster coordination.

### 10.4 Monitoring

Monitor:

- Keeper availability;
- leader/follower state;
- request latency;
- outstanding requests;
- disk usage;
- snapshot/log sizes;
- session expirations;
- connection count.

### 10.5 Backup

Keeper metadata backup strategy should exist, but remember data parts live in ClickHouse storage. Recovery procedures must account for both metadata and data directories.

---

## 11. Replication Queue Failure Modes

### 11.1 Part Fetch Failed

Symptoms:

```text
system.replication_queue.last_exception mentions missing part/fetch failure
```

Causes:

- source replica down;
- network issue;
- part removed before fetch;
- disk issue;
- corrupted part;
- misconfiguration.

### 11.2 Mutation Stuck

Symptoms:

```text
part_mutations_in_queue high
system.mutations parts_to_do not decreasing
```

Causes:

- mutation too large;
- disk/CPU bottleneck;
- bad predicate;
- many parts;
- replica lag;
- failed mutation expression.

### 11.3 Too Many Parts

Symptoms:

- replication queue grows;
- merges cannot keep up;
- inserts slow/fail;
- query overhead grows.

Causes:

- small inserts;
- over-partitioning;
- too many shards receiving tiny batches;
- high-cardinality partition key.

### 11.4 Readonly Replica

Symptoms:

```text
system.replicas.is_readonly = 1
```

Causes:

- Keeper session issue;
- metadata mismatch;
- config problem;
- disk issue.

### 11.5 Lost/Detached Parts

Parts may become detached due to corruption, manual operations, or recovery.

Investigate carefully before deleting anything.

---

## 12. Distributed DDL

### 12.1 ON CLUSTER

DDL can be executed on all nodes:

```sql
ALTER TABLE events_local ON CLUSTER my_cluster
ADD COLUMN source LowCardinality(String) DEFAULT 'unknown';
```

This creates distributed DDL tasks.

### 12.2 Why It Matters

Without `ON CLUSTER`, schema drift can happen:

```text
node A has column source
node B does not
Distributed query fails
Insert fails on some shards
```

### 12.3 Failure Modes

- one node down during DDL;
- DDL task stuck;
- incompatible ALTER;
- materialized view dependency;
- replicated table metadata conflict;
- app deploy writes new column before all nodes ready.

### 12.4 Safe Migration Pattern

For additive columns:

```text
1. ALTER ADD COLUMN with DEFAULT on cluster.
2. Verify system.columns across cluster.
3. Deploy producers writing new field.
4. Deploy query using new field.
5. Backfill if necessary.
```

For breaking changes:

```text
1. Create new table.
2. Dual-write or backfill.
3. Validate.
4. Switch readers.
5. Retire old table.
```

### 12.5 Verify DDL Completion

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

Check distributed DDL queue/system tables depending version.

---

## 13. Schema Drift and Compatibility

### 13.1 Sources of Drift

- manual DDL on one node;
- failed `ON CLUSTER`;
- different ClickHouse versions;
- app deploy before DDL;
- materialized view target mismatch;
- old replica restored from backup;
- cloud/self-managed mixed automation.

### 13.2 Symptoms

- inserts fail randomly;
- distributed query fails on one shard;
- type mismatch;
- unknown column;
- materialized view stops;
- query works on local node, fails on Distributed table.

### 13.3 Prevention

- all DDL automated;
- no manual node-only schema changes;
- migration verification;
- schema registry for ingestion;
- backward-compatible column additions;
- observability on insert errors;
- integration tests against cluster.

---

## 14. Recovery Mental Model

### 14.1 Node Restart

If node restarts:

```text
local parts remain on disk
replica reconnects to Keeper
replication queue catches up
```

Watch:

- `system.replicas`;
- replication queue;
- active parts;
- readonly status;
- disk usage.

### 14.2 Replica Rebuild

If replica data lost but other replicas healthy:

```text
bring replica up empty
replica fetches parts from healthy replicas
```

This can take time and network/disk bandwidth.

Plan for:

- throttling;
- avoiding overload;
- verifying part counts;
- monitoring queue.

### 14.3 Shard Loss

If all replicas of a shard lost:

- data for that shard lost unless backup exists;
- restore from backup/object storage;
- reingest from source if available;
- distributed query cannot produce complete results.

Replication protects against replica loss, not total shard loss.

### 14.4 Keeper Metadata Loss

Recovery can be complex. You need documented backup/restore and understanding of replicated table metadata.

Do not improvise in production without procedure.

### 14.5 Restore Validation

After recovery, validate:

- row counts by partition;
- checksums if available;
- min/max event time;
- ingestion batch metadata;
- query sample comparison;
- replica queue empty;
- no readonly replicas;
- distributed query consistency.

---

## 15. Backup and Restore in Distributed Context

Full backup strategy is covered later in Part 032, but distributed operation needs early awareness.

Backup must consider:

- local table data on each shard;
- replicas are copies, not independent logical shards;
- metadata/schema;
- Keeper metadata where relevant;
- materialized view targets;
- dictionaries;
- users/settings;
- object storage if used;
- external sources for replay.

Restore must consider:

- restoring each shard's logical data;
- avoiding duplicate restore to multiple replicas incorrectly;
- re-establishing replication;
- validating distributed table results;
- reconstructing aggregate tables if easier.

---

## 16. Consistency Models for Analytics Products

### 16.1 Real-Time Operational Dashboard

Expectation:

```text
fresh within seconds/minutes
minor lag acceptable if displayed
```

Design:

- ingestion watermark;
- replica delay threshold;
- query fresh replicas;
- monitor lag;
- expose last updated.

### 16.2 Official Regulatory Report

Expectation:

```text
stable, reproducible, versioned
```

Design:

- snapshot table;
- report version;
- generated_at;
- source range;
- correction/amendment mechanism;
- avoid live mutable query as official record.

### 16.3 User-Facing Export

Expectation:

```text
complete for selected time range
```

Design:

- async job;
- query consistency check;
- maybe wait for replication;
- write export artifact;
- include generated timestamp.

### 16.4 Write-Then-Read API

If app writes event and immediately reads analytics:

- ClickHouse may not be correct system for strict synchronous read-after-write analytics;
- use source OLTP state for immediate confirmation;
- analytics catches up asynchronously;
- or engineer quorum/sequential consistency with latency cost.

---

## 17. Read-After-Write in Java Systems

### 17.1 The Trap

Java service:

```text
POST /case/close
→ writes event to ClickHouse
→ immediately queries ClickHouse dashboard count
→ expects updated count
```

This is fragile.

### 17.2 Better Design

Transactional system:

```text
case-service database = source of command truth
ClickHouse = analytical projection
```

API response should not depend on ClickHouse immediately reflecting write unless explicitly designed.

### 17.3 Options

1. Return command result from OLTP state.
2. Show analytics dashboard with freshness indicator.
3. Use event-driven projection and accept lag.
4. For critical writes, use insert quorum and fresh-replica reads.
5. Use polling/watermark.
6. Avoid mixing command handling and analytics read consistency.

### 17.4 User Experience

Display:

```text
Data last updated at 2026-06-21 10:31:42 UTC
```

or:

```text
Reports may lag by up to 2 minutes.
```

This is often better than pretending analytics is transactional.

---

## 18. Distributed Mutations

### 18.1 Mutation Across Cluster

When mutating replicated local table on cluster:

```sql
ALTER TABLE events_local ON CLUSTER my_cluster
DELETE WHERE ...
```

Each shard/replica must process the mutation.

### 18.2 Risks

- one replica stuck;
- mutation order;
- large parts affected;
- queue backlog;
- derived rollups not repaired;
- inconsistent query results while mutation in progress.

### 18.3 Safer Alternatives

- drop/reload partition;
- insert correction/tombstone;
- rebuild derived table;
- run mutation during maintenance;
- mutation by partition;
- process one table/window at a time.

### 18.4 Monitoring

Use:

```sql
SELECT
    hostName() AS host,
    database,
    table,
    mutation_id,
    command,
    is_done,
    parts_to_do,
    latest_fail_reason
FROM clusterAllReplicas('my_cluster', system, mutations)
WHERE database = 'analytics'
ORDER BY host, create_time DESC;
```

---

## 19. Distributed Inserts and Exactly-Once Illusion

### 19.1 Failure Scenario

App inserts batch into Distributed table. Connection fails.

Unknown:

- coordinator received batch?
- batch split to shards?
- some shards received rows?
- data queued locally?
- response lost after success?
- replicas fetched?

Without idempotency, retry can duplicate.

### 19.2 Required Metadata

Include:

- event_id;
- batch_id;
- source offset;
- source partition;
- source sequence;
- schema version;
- producer id.

### 19.3 Practical Correctness

Exactly-once is not a single feature. It is architecture:

```text
deterministic event identity
+ idempotent batch identity
+ replayable source
+ dedup logic
+ reconciliation
+ repair plan
```

### 19.4 Distributed Insert Queue

If using Distributed table for inserts, monitor queue. A “successful” local queue write may not mean remote shards all have data yet depending settings.

---

## 20. Network Partitions and Split-Brain Thinking

### 20.1 Failure Domains

Distributed ClickHouse failure domains:

- client ↔ coordinator;
- coordinator ↔ shard replica;
- replica ↔ Keeper;
- replica ↔ replica;
- shard ↔ shard;
- data center ↔ data center.

### 20.2 Bad Assumption

```text
If one node is reachable, cluster is healthy.
```

False.

A node may be reachable but:

- readonly;
- lagging;
- disconnected from Keeper;
- missing parts;
- unable to replicate;
- has stale schema;
- cannot reach other shards.

### 20.3 Safety Principle

Prefer:

```text
fail query if completeness uncertain
```

over:

```text
return incomplete analytics silently
```

For official/compliance reports, incomplete data is worse than temporary failure.

### 20.4 Degraded Mode

For dashboards, degraded mode may be acceptable if clearly labeled:

```text
Data delayed due to ingestion lag.
```

or:

```text
Showing partial results is not allowed for this endpoint.
```

Define per endpoint.

---

## 21. Monitoring and Alerting

### 21.1 Core Alerts

Alert on:

- replica readonly;
- Keeper unavailable/session expired;
- replication queue size high;
- absolute_delay high;
- distribution queue backlog;
- mutation stuck;
- too many parts;
- disk space low;
- merge backlog;
- insert failures;
- query error rate;
- long-running distributed queries;
- coordinator memory high;
- shard data skew;
- schema drift.

### 21.2 Example Queries

Replica health:

```sql
SELECT
    hostName() AS host,
    database,
    table,
    is_readonly,
    is_session_expired,
    absolute_delay,
    queue_size,
    active_replicas,
    total_replicas
FROM clusterAllReplicas('my_cluster', system, replicas)
WHERE database = 'analytics';
```

Replication queue old tasks:

```sql
SELECT
    hostName() AS host,
    database,
    table,
    type,
    create_time,
    now() - create_time AS age,
    num_tries,
    last_exception
FROM clusterAllReplicas('my_cluster', system, replication_queue)
WHERE database = 'analytics'
ORDER BY age DESC
LIMIT 50;
```

Distribution queue:

```sql
SELECT
    hostName() AS host,
    database,
    table,
    count() AS pending_files,
    min(create_time) AS oldest
FROM clusterAllReplicas('my_cluster', system, distribution_queue)
GROUP BY
    host,
    database,
    table
ORDER BY pending_files DESC;
```

Data skew:

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
ORDER BY rows DESC;
```

### 21.3 Freshness Metrics

Maintain ingestion/freshness table:

```sql
CREATE TABLE ingestion_watermarks
(
    pipeline LowCardinality(String),
    tenant_id UInt64,
    max_event_time DateTime64(3),
    max_ingest_time DateTime64(3),
    updated_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (pipeline, tenant_id);
```

Dashboard can show:

```text
fresh through event_time = ...
last ingest = ...
```

---

## 22. Troubleshooting Runbooks

### 22.1 Runbook: Dashboard Missing Latest Data

Questions:

1. Is ingestion still writing?
2. Is data in local table on any replica?
3. Is Distributed table reading a lagging replica?
4. Is replication queue delayed?
5. Is distributed insert queue backed up?
6. Is materialized view target updated?
7. Is query filtering wrong time column?
8. Is data in raw table but not rollup?

Checks:

```sql
SELECT max(event_time), max(ingest_time)
FROM events;
```

Across local replicas:

```sql
SELECT
    hostName() AS host,
    max(event_time),
    max(ingest_time),
    count()
FROM clusterAllReplicas('my_cluster', analytics, events_local)
GROUP BY host;
```

Check replicas:

```sql
SELECT
    hostName(),
    absolute_delay,
    queue_size
FROM clusterAllReplicas('my_cluster', system, replicas)
WHERE database = 'analytics'
  AND table = 'events_local';
```

### 22.2 Runbook: Replica Lagging

1. Check `system.replicas`.
2. Check `system.replication_queue`.
3. Check disk space.
4. Check network.
5. Check Keeper session.
6. Check part count.
7. Check merges/mutations.
8. Check errors.
9. Avoid restarting blindly if it worsens fetch backlog.
10. Consider throttling ingestion/backfill.

### 22.3 Runbook: Mutation Stuck

1. Inspect `system.mutations`.
2. Inspect failed reason.
3. Estimate affected parts.
4. Check disk/CPU.
5. Check replication queue.
6. Decide if mutation should be killed.
7. Consider partition rebuild instead.
8. Repair derived tables after.

### 22.4 Runbook: Distributed DDL Stuck

1. Check which node has not applied DDL.
2. Check node availability.
3. Check DDL queue/system table.
4. Verify schema across nodes.
5. Do not deploy app depending on incomplete DDL.
6. Re-run/repair DDL carefully.

### 22.5 Runbook: Query Different Result Depending Node

Possible causes:

- replica lag;
- schema drift;
- distributed table config differs;
- local data distribution issue;
- query reads local table accidentally;
- mutation not complete on all replicas;
- stale dictionaries;
- different settings/users.

Checks:

```sql
SELECT hostName(), count()
FROM clusterAllReplicas('my_cluster', analytics, events_local)
GROUP BY hostName();
```

Check configs and `system.clusters`.

---

## 23. Consistency Design for Regulatory Systems

For enforcement/case management analytics, do not rely solely on live distributed query for official truth.

### 23.1 Separate Operational and Official Views

Operational dashboard:

```text
near real-time
may lag
shows freshness
```

Official report:

```text
snapshot
versioned
validated
reproducible
amendable
```

### 23.2 Snapshot Pattern

```sql
CREATE TABLE official_case_report_snapshots
(
    tenant_id UInt64,
    report_period String,
    report_version UInt32,
    generated_at DateTime64(3),
    source_watermark DateTime64(3),
    jurisdiction LowCardinality(String),
    severity LowCardinality(String),
    opened_cases UInt64,
    closed_cases UInt64,
    checksum String
)
ENGINE = MergeTree
ORDER BY (tenant_id, report_period, report_version, jurisdiction, severity);
```

### 23.3 Validation Before Publishing

Before producing official report:

- replication queue healthy;
- ingestion watermark passed cutoff;
- no running mutations on source tables;
- rollup rebuild completed;
- counts reconcile raw vs aggregate;
- report snapshot stored;
- checksum/metadata recorded.

### 23.4 Amendment

If late correction arrives:

```text
do not silently overwrite report v1
create report v2 with amendment reason
```

---

## 24. Java Service Operational Contracts

### 24.1 Query Contract

Every analytics endpoint should define:

- data source table;
- freshness expectation;
- consistency expectation;
- allowed lag;
- partial result policy;
- max time range;
- timeout;
- fallback behavior.

Example:

```text
GET /analytics/cases/backlog
Freshness: <= 2 minutes
Consistency: may be eventually consistent
Partial result: not allowed
Source: case_current_state distributed table
```

### 24.2 Insert Contract

For ingestion:

- idempotent event id;
- deterministic batch id;
- retry policy;
- quorum requirement if any;
- source offset commit rule;
- DLQ behavior;
- reconciliation process.

### 24.3 Query ID Propagation

Set query id:

```text
service-name/request-id/user-id/action
```

This helps find query fragments in `system.query_log`.

### 24.4 Handling ClickHouse Errors

Classify:

- retryable SELECT;
- retryable INSERT with idempotency;
- non-retryable schema error;
- resource limit exceeded;
- timeout;
- distributed incomplete result;
- replica unavailable.

Do not blindly retry all writes.

---

## 25. Availability vs Consistency vs Latency

ClickHouse analytics often chooses high availability and high performance with eventual consistency.

But some use cases need stronger guarantees.

### 25.1 Dashboard

Priority:

```text
availability + low latency
```

Consistency:

```text
freshness indicator acceptable
```

### 25.2 Audit Event Ingestion

Priority:

```text
durability + correctness
```

Latency:

```text
can be slightly higher
```

Use stronger insert settings/quorum if needed.

### 25.3 Official Report

Priority:

```text
reproducibility + validation
```

Latency:

```text
batch/offline acceptable
```

Use snapshot/version.

### 25.4 Ad-Hoc Analytics

Priority:

```text
exploration
```

Consistency:

```text
documented as latest available
```

Use resource limits.

---

## 26. Cluster Upgrade and Rolling Maintenance

### 26.1 Rolling Restart

With replicas, you can restart one replica at a time.

Before restart:

- check other replica active;
- check replication queue low;
- ensure disk healthy;
- drain traffic if possible.

After restart:

- check replica reconnected;
- check queue catching up;
- check readonly/session status.

### 26.2 Version Compatibility

Distributed cluster should avoid long-lived mixed incompatible versions.

Upgrade plan:

1. read release notes;
2. test staging;
3. upgrade Keeper if needed;
4. upgrade replicas one at a time;
5. monitor replication;
6. verify query results;
7. run compatibility tests.

### 26.3 DDL During Upgrade

Avoid major schema changes while cluster is partially upgraded unless compatibility is known.

---

## 27. Security and Access Control in Distributed Context

Security is covered later in Part 031, but distributed operation needs awareness.

### 27.1 Consistent Users/Settings

User profiles, quotas, and settings should be consistent across nodes.

Otherwise:

- query works via one coordinator but fails via another;
- limits differ;
- access differs;
- debugging becomes painful.

### 27.2 Distributed Queries Use Remote Credentials

Ensure remote server authentication and cluster config are correct.

### 27.3 Row-Level Access

For multi-tenant analytics, row policies must apply consistently across cluster.

Java API should enforce tenant filter even if database has row policy.

Defense in depth.

---

## 28. Common Anti-Patterns

### 28.1 Assuming Replication Means Immediate Consistency

Replication can lag.

### 28.2 Ignoring Keeper

Keeper is not optional background detail. It is a critical control plane.

### 28.3 Returning Partial Results Silently

For many business reports, partial data is worse than error.

### 28.4 No Freshness Indicator

Users think data is real-time when it may lag.

### 28.5 No Idempotency on Distributed Insert Retry

Leads to duplicate data.

### 28.6 Running Massive Mutations During Peak Load

Mutation + replication + query workload can destabilize cluster.

### 28.7 Manual DDL on One Node

Schema drift.

### 28.8 One Coordinator Node for All API Traffic

Coordinator bottleneck.

### 28.9 No Per-Replica Monitoring

You only see average health, not broken replica.

### 28.10 Treating Official Reports as Live Queries

Official reports need snapshot/version/validation.

---

## 29. Production Checklist

### Keeper

- [ ] Keeper ensemble is HA.
- [ ] Keeper latency monitored.
- [ ] Keeper disk monitored.
- [ ] Session expirations alerted.
- [ ] Backup/recovery documented.
- [ ] Keeper nodes not overloaded by unrelated workloads.

### Replication

- [ ] `system.replicas` monitored.
- [ ] `system.replication_queue` monitored.
- [ ] Replica lag SLO defined.
- [ ] Read settings avoid unacceptable stale replicas.
- [ ] Insert quorum decision documented.
- [ ] Replica rebuild process tested.

### Distributed Queries

- [ ] Partial result policy defined.
- [ ] Coordinator load balanced.
- [ ] Query IDs propagated.
- [ ] Slowest shard visible.
- [ ] High-cardinality fan-in guarded.
- [ ] Distributed joins reviewed.

### Inserts

- [ ] Retry idempotency exists.
- [ ] Batch IDs stable.
- [ ] Event IDs stable.
- [ ] Distributed insert queue monitored.
- [ ] Source offset/sequence stored.
- [ ] Write acknowledgment semantics documented.

### DDL

- [ ] DDL uses `ON CLUSTER`.
- [ ] Schema verified across nodes.
- [ ] App deploy waits for migration completion.
- [ ] Backward-compatible migration pattern used.
- [ ] Rollback/recovery defined.

### Mutations

- [ ] Mutation scope estimated before run.
- [ ] Mutation queue monitored.
- [ ] Derived tables repair plan exists.
- [ ] Large corrections prefer rebuild/drop partition.
- [ ] Peak-hour mutation avoided.

### Product/API

- [ ] Freshness shown where needed.
- [ ] Official reports snapshot/versioned.
- [ ] Read-after-write expectations documented.
- [ ] Tenant/time filters enforced.
- [ ] Error vs degraded mode defined.

---

## 30. Exercises

### Exercise 1: Insert Success but Dashboard Missing Data

Scenario:

```text
Java ingestion got success.
Dashboard query does not show latest rows.
```

List possible causes.

Expected:

- query reads lagging replica;
- distributed insert queued but not delivered;
- materialized view target lagging/failing;
- wrong time filter/event_time vs ingest_time;
- insert to local table on one shard only;
- replication queue delayed;
- dashboard querying rollup not raw;
- caching layer stale.

### Exercise 2: Replica Lag

Scenario:

```text
system.replicas absolute_delay = 900 seconds
queue_size high
```

What do you check?

Expected:

- replication_queue last_exception;
- disk space;
- network;
- Keeper session;
- too many parts;
- merges/mutations;
- fetch source availability;
- recent backfill/insert spike.

### Exercise 3: Official Report

Requirement:

```text
Monthly regulatory report must be reproducible after submission.
```

Should report be a live query against Distributed table?

Expected:

- no, not as sole official artifact;
- generate validated snapshot with report version/source watermark/checksum;
- retain amendment mechanism.

### Exercise 4: Read-After-Write

Requirement:

```text
After closing a case, UI must immediately show case as closed.
```

Should UI query ClickHouse?

Expected:

- command confirmation/current transactional system should show immediate state;
- ClickHouse analytics can lag;
- if ClickHouse required, engineer quorum/fresh read at cost.

### Exercise 5: DDL Drift

Scenario:

```text
Query through node A works, node B fails unknown column.
```

Likely cause?

Expected:

- schema drift;
- incomplete `ON CLUSTER` DDL;
- node missed migration;
- verify `system.columns` across cluster.

---

## 31. Summary

Distributed ClickHouse requires operational thinking beyond data modeling.

Core ideas:

1. Replication is asynchronous part coordination.
2. Keeper/ZooKeeper is critical control plane.
3. Insert acknowledged does not always mean globally visible.
4. Replica lag can affect dashboard correctness.
5. Distributed queries must define partial-result and freshness policy.
6. Insert quorum improves guarantees but costs latency/availability.
7. Distributed DDL must be managed carefully.
8. Mutations in cluster need planning and monitoring.
9. Java services need explicit contracts for freshness, idempotency, and retry.
10. Official reports should be snapshot/version based, not only live query based.

Practical sentence:

> In distributed ClickHouse, correctness is not just query syntax; it is the alignment of replication state, freshness expectation, routing, and operational health.

---

## 32. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi ClickHouse sesuai versi yang kamu pakai:

1. ClickHouse Docs — Replication.
2. ClickHouse Docs — ReplicatedMergeTree.
3. ClickHouse Docs — ClickHouse Keeper.
4. ClickHouse Docs — Distributed table engine.
5. ClickHouse Docs — Distributed DDL.
6. ClickHouse Docs — system.replicas.
7. ClickHouse Docs — system.replication_queue.
8. ClickHouse Docs — system.distribution_queue.
9. ClickHouse Docs — system.mutations.
10. ClickHouse Docs — Insert quorum.
11. ClickHouse Docs — Settings for distributed queries.
12. ClickHouse Docs — Backups and recovery.
13. ClickHouse Docs — Monitoring.

---

## 33. Status Seri

Part ini adalah:

```text
Part 021 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 022 — Cloud-Native ClickHouse: Object Storage, Separation of Compute/Storage, and SharedMergeTree
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Distributed ClickHouse I: Shards, Replicas, Distributed Tables, and Query Routing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-022.md">Part 022 — Cloud-Native ClickHouse: Object Storage, Separation of Compute/Storage, and SharedMergeTree ➡️</a>
</div>

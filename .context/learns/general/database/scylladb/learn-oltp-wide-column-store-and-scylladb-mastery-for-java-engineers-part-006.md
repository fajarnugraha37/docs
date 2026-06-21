# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-006.md

# Part 006 — Storage Engine Internals: Commitlog, Memtable, SSTable, Cache, dan Flush

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `006`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami storage engine internals ScyllaDB/Cassandra-style LSM database — write path, read path, commitlog, memtable, SSTable, cache, Bloom filter, flush, compaction preview, dan amplification.

---

## 0. Posisi Part Ini dalam Seri

Sampai part 005, kita sudah membahas distribusi data:

```text
partition key -> token -> tablet/range -> replica node -> shard/core
```

Part ini menjawab pertanyaan berikutnya:

> Setelah request sampai ke replica/shard yang benar, apa yang terjadi di dalam storage engine?

Untuk write:

```text
client write -> coordinator -> replica shard -> durable write path
```

Untuk read:

```text
client read -> coordinator -> replica shard -> memory/cache/SSTable merge path
```

Di part ini kita fokus pada mekanisme penyimpanan lokal yang membuat wide-column store cocok untuk high-throughput OLTP, terutama write-heavy workload.

Mental model besarnya:

```text
ScyllaDB is a distributed database.
Inside each replica/shard, it behaves like an LSM-tree style storage engine.
```

---

## 1. Kenapa Storage Engine Penting untuk Application Engineer?

Sebagai Java engineer, kita tidak akan mengubah commitlog atau menulis SSTable parser dalam pekerjaan sehari-hari.

Tapi storage internals menentukan:

- kenapa writes biasanya cepat,
- kenapa reads bisa tiba-tiba mahal,
- kenapa delete menghasilkan tombstone,
- kenapa TTL bisa membahayakan query,
- kenapa compaction penting,
- kenapa large partition buruk,
- kenapa page size harus dibatasi,
- kenapa `ALLOW FILTERING` berbahaya,
- kenapa backup/snapshot berbasis file/SSTable,
- kenapa p99 bisa naik saat compaction/repair/streaming,
- kenapa row size dan partition size memengaruhi latency.

Tanpa storage mental model, kita hanya melihat ScyllaDB sebagai black box.

Dengan storage mental model, kita bisa menebak:

```text
Query ini mahal karena menyentuh banyak SSTable.
Query ini lambat karena tombstone scan.
Write ini aman untuk retry karena primary key idempotent.
TTL ini akan membuat compaction pressure.
Large partition ini akan membuat read path dan repair mahal.
```

---

## 2. LSM-Tree Style Mental Model

ScyllaDB/Cassandra-style storage engine menggunakan pendekatan yang mirip Log-Structured Merge Tree.

Prinsip sederhana:

```text
Writes are optimized by appending and writing sequentially.
Reads may need to merge data from multiple immutable files.
Compaction later reorganizes files.
```

Bukan seperti database B-tree tradisional yang sering update page in-place.

### 2.1 In-Place Update vs LSM

Simplifikasi:

```text
B-tree-ish:
update row -> find page -> modify page -> write page

LSM-ish:
append mutation -> memory table -> immutable file -> later compact
```

LSM cocok untuk:

- high write throughput,
- sequential IO,
- append-heavy workloads,
- distributed replicated writes,
- immutable file management.

Trade-off:

- read amplification,
- compaction work,
- space amplification,
- tombstone management,
- merge complexity.

---

## 3. Write Path Overview

Saat write diterima replica/shard:

```text
1. Validate mutation.
2. Append mutation to commitlog for durability.
3. Apply mutation to memtable in memory.
4. Acknowledge when durability/replica rules satisfied.
5. Later flush memtable to SSTable.
6. Later compact SSTables.
```

Diagram:

```text
Write request
   |
   v
Commitlog append  ---- durability
   |
   v
Memtable update   ---- in-memory latest data
   |
   v
Ack to coordinator
   |
   v
Flush later
   |
   v
SSTable immutable files
   |
   v
Compaction later
```

Important:

```text
Write does not usually rewrite old SSTable immediately.
```

If you update same row many times, old versions/tombstones may exist until compaction resolves them.

---

## 4. Commitlog

Commitlog is append-only durability log.

Purpose:

```text
If node crashes before memtable is flushed to SSTable, replay commitlog to recover mutations.
```

Write flow:

```text
mutation -> commitlog append -> memtable
```

Commitlog protects in-memory memtable data.

### 4.1 Commitlog Is Not Query Storage

Commitlog is not optimized for reads by query.

It is for crash recovery.

Normal reads go to:

- memtable,
- cache,
- SSTables.

### 4.2 Commitlog and Ack

A replica should not acknowledge durable write before the mutation reaches required durable path according to engine semantics.

At cluster level, coordinator waits for enough replica acknowledgements based on CL.

So there are two layers:

```text
local durability at replica
+
distributed acknowledgement at coordinator
```

### 4.3 Commitlog Pressure

Commitlog can become pressure point due to:

- high write throughput,
- disk latency,
- sync policy,
- large mutations,
- slow disk,
- shared disk with SSTable IO,
- fs/kernel issues.

Symptoms:

- write latency rises,
- p99 write spikes,
- commitlog backlog/queueing,
- node overload.

For Java app:

```text
Do not assume write latency is always constant.
Large payloads and write bursts can saturate commitlog/disk.
```

---

## 5. Memtable

Memtable is in-memory structure holding recent mutations.

Purpose:

- serve latest writes,
- buffer writes before flushing to disk,
- keep write path fast.

Conceptually:

```text
partition key -> clustering rows -> cells/mutations
```

When memtable reaches threshold, it is flushed to SSTable.

### 5.1 Memtable Is Mutable, SSTable Is Immutable

Memtable:

```text
mutable
in memory
fast to write/read
lost on crash unless commitlog replayed
```

SSTable:

```text
immutable
on disk
created by flush/compaction
read via indexes/filters
```

### 5.2 Memtable Pressure

Too much write volume can create memtable pressure.

Contributors:

- high write rate,
- large rows,
- wide partitions,
- many tables,
- slow flush,
- disk bottleneck,
- compaction backlog.

When flush cannot keep up, write latency can rise and node can apply backpressure.

---

## 6. Flush

Flush converts memtable to SSTable.

```text
memtable -> immutable SSTable files on disk
```

Flush is necessary because memory is finite.

Flush creates new SSTables.

If writes continue, many SSTables can accumulate.

Later compaction merges SSTables.

### 6.1 Flush Is Not Compaction

Flush:

```text
memory -> disk file
```

Compaction:

```text
multiple disk files -> fewer/newer disk files
```

Flush makes data durable as normal queryable storage. Compaction optimizes storage/read path later.

### 6.2 Flush Impact

Flush consumes:

- disk bandwidth,
- CPU,
- memory buffers,
- scheduler attention.

Flush usually should be normal background work, but under heavy write pressure it can influence foreground latency.

---

## 7. SSTable

SSTable means Sorted String Table.

In ScyllaDB/Cassandra-style systems, SSTables are immutable on-disk files storing sorted data.

Key properties:

```text
immutable
sorted by partition/clustering order
created by flush or compaction
read by storage engine
can be compacted
can be snapshotted
```

### 7.1 Why Immutable Files?

Immutable files simplify:

- sequential writes,
- crash safety,
- snapshots,
- compaction,
- concurrent reads,
- avoiding in-place update complexity.

Trade-off:

```text
updates/deletes create new versions/tombstones, old data remains until compaction.
```

### 7.2 SSTable Components

Depending on format/version, an SSTable has associated structures such as:

- data file,
- partition index,
- summary,
- Bloom filter,
- compression metadata,
- statistics,
- digest/checksum metadata.

You do not need to memorize every file extension yet. Understand the purpose:

```text
avoid scanning entire file for each read
```

---

## 8. Sorted by Partition and Clustering

Within SSTable, data is organized by partition key/token and clustering order.

Given table:

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

Inside a partition:

```text
case_id = CASE-123
  event_time asc/desc depending table order
    event_id
      cells
```

This makes queries efficient when they match:

```text
partition key equality
+
bounded clustering range/order
```

Example efficient:

```sql
SELECT *
FROM case_events_by_case
WHERE case_id = ?
LIMIT 100;
```

or:

```sql
SELECT *
FROM case_events_by_case
WHERE case_id = ?
  AND event_time >= ?
  AND event_time < ?;
```

Less efficient/impossible without extra model:

```sql
SELECT *
FROM case_events_by_case
WHERE event_type = 'APPROVED';
```

Because event_type is not part of partition/clustering path.

---

## 9. Read Path Overview

Read path is more complex than write path.

For a partition read:

```text
1. Check memtable(s) for latest data.
2. Check cache if applicable.
3. Use Bloom filters to skip SSTables that likely do not contain partition.
4. Use index/summary to locate data in candidate SSTables.
5. Read data blocks.
6. Merge versions from memtable and SSTables.
7. Apply tombstones/deletions.
8. Return result/page.
```

Diagram:

```text
Read request
   |
   v
Memtable
   |
   v
Cache?
   |
   v
Bloom filters
   |
   v
SSTable index/summary
   |
   v
Read candidate SSTables
   |
   v
Merge/reconcile
   |
   v
Return rows
```

### 9.1 Why Reads Can Be Expensive

A read may touch multiple SSTables because updates over time are spread across immutable files.

If a row/partition exists in many SSTables:

```text
read must merge candidates
```

Compaction reduces this over time.

---

## 10. Bloom Filter

Bloom filter is probabilistic structure used to answer:

```text
Could this SSTable contain this partition key?
```

It can say:

```text
definitely not
```

or:

```text
maybe yes
```

It cannot say “definitely yes” without checking.

Benefit:

```text
skip SSTables that definitely do not contain partition
```

False positives mean storage engine may check some SSTables unnecessarily.

### 10.1 Bloom Filter Tuning Mental Model

Lower false positive chance:

- more memory used,
- fewer unnecessary SSTable reads.

Higher false positive chance:

- less memory,
- more read amplification.

As application engineer, most important is not tuning Bloom filters directly, but understanding:

```text
If many SSTables exist and Bloom filters produce candidates, read path gets more expensive.
```

---

## 11. Partition Index and Summary

After Bloom filter says “maybe”, storage engine needs to locate partition data inside SSTable.

It uses index-like structures.

Conceptually:

```text
partition key -> approximate/actual position in SSTable data file
```

Index summary helps reduce memory footprint by sampling.

Again, the goal:

```text
avoid scanning entire SSTable
```

But if query shape is bad, or partition is huge, or many SSTables qualify, index structures cannot magically make it cheap.

---

## 12. Cache

ScyllaDB has caching mechanisms to accelerate reads.

Conceptual categories:

- row/cache-like data,
- key/index metadata,
- OS/page/cache interactions depending architecture,
- internal cache management.

Do not reduce caching to:

```text
cache hit = fast, cache miss = slow
```

Cache effectiveness depends on:

- working set size,
- memory,
- access locality,
- partition size,
- row size,
- result size,
- compaction,
- workload skew.

### 12.1 Cache-Friendly Workload

Good:

```text
frequently read small partitions
bounded latest N reads
working set fits memory
high locality
```

Bad:

```text
large scans
random huge working set
large partitions
one-off export queries
wide rows with huge payload
```

### 12.2 Cache Can Hide Problems Temporarily

During warm cache, query looks fast.

After restart or workload shift:

```text
cache miss -> SSTable reads -> p99 spike
```

Benchmark should include cold/warm cache awareness.

---

## 13. Merge and Reconciliation

Because data can exist in:

- memtable,
- multiple SSTables,
- multiple replicas,

read result may require merging.

Within one replica:

```text
memtable version + SSTable versions + tombstones -> final row view
```

Across replicas:

```text
replica A result + replica B result -> reconciled result according to timestamp/version semantics
```

This is why a read is not simply “fetch row by primary key”.

### 13.1 Cell-Level Updates

Cassandra-compatible storage often has cell-level mutation semantics.

Updating one column may create new cell version without rewriting whole row.

This is powerful, but creates complexity:

- partial updates,
- tombstones per cell/row/range,
- timestamp conflict resolution,
- merge work.

---

## 14. Tombstones Preview

A delete does not immediately remove old data from all SSTables.

Instead, database writes a tombstone:

```text
this row/cell/range is deleted as of timestamp T
```

During reads, tombstone suppresses older data.

During compaction, old data and tombstone can eventually be purged when safe.

Tombstones are necessary because replicas can be stale. Without tombstones, deleted data could reappear from old replica/SSTable.

### 14.1 Tombstone Cost

Tombstones can hurt reads because storage engine must scan and apply them.

A query that scans many tombstones before finding live rows can be slow or fail.

Sources of tombstones:

- DELETE,
- TTL expiry,
- overwriting collection elements,
- range deletes,
- repeated updates/deletes.

Deep tombstone treatment is part 015.

For now:

```text
Deletes are writes.
TTL expiry creates future delete work.
Tombstones are part of read path cost.
```

---

## 15. TTL and Expiry

TTL means data expires after time.

Example:

```sql
INSERT INTO login_attempts_by_user (...)
VALUES (...)
USING TTL 86400;
```

After TTL expires, data is logically deleted.

That expiration creates tombstone semantics.

TTL is useful for:

- sessions,
- temporary idempotency keys,
- telemetry retention,
- ephemeral notifications,
- short-lived locks/reservations.

TTL is dangerous when:

- huge volume expires at once,
- query scans expired data,
- table mixes long-lived and short-lived data badly,
- compaction strategy mismatched,
- gc grace/repair assumptions ignored.

Time-bucketed design often works better for TTL-heavy workloads.

---

## 16. Read Amplification

Read amplification means one logical read causes multiple physical reads/work units.

Causes:

- many SSTables,
- Bloom filter false positives,
- large partitions,
- tombstones,
- wide clustering range,
- many pages,
- cache miss,
- high consistency level,
- replica reconciliation,
- secondary index/materialized view path,
- compression block reads larger than needed.

Example:

```text
Application asks: latest 50 events for case.
Storage reads: memtable + 12 SSTables + tombstones + compressed blocks.
```

### 16.1 How to Reduce Read Amplification

- model query by partition key,
- keep partitions bounded,
- use clustering order for latest reads,
- avoid tombstone-heavy scans,
- choose compaction strategy matching workload,
- avoid oversized page size,
- avoid broad range scans,
- use denormalized read table,
- separate hot/cold data,
- bucket by time/entity.

---

## 17. Write Amplification

Write amplification means one logical write causes more physical write work over time.

Causes:

- commitlog write,
- memtable write,
- SSTable flush,
- compaction rewriting data,
- replica writes,
- secondary indexes/materialized views,
- hints,
- repair/streaming later,
- compression/checksums.

Example:

```text
Logical write 1 KB
Eventually:
commitlog + SSTable + compaction rewrites + RF=3 replicas
```

Write amplification is normal in LSM systems. It must be planned.

### 17.1 How to Control Write Amplification

- avoid unnecessary indexes/views,
- avoid excessive update churn,
- choose compaction strategy correctly,
- avoid large collections that rewrite/tombstone heavily,
- design TTL tables carefully,
- use appropriate RF/CL,
- avoid writing duplicate derived tables unless needed.

---

## 18. Space Amplification

Space amplification means physical disk usage exceeds logical live data size.

Causes:

- multiple SSTable versions,
- old overwritten values,
- tombstones waiting for compaction,
- compaction temporary space,
- snapshots,
- backups,
- hints,
- repair/streaming,
- compression ratio variation.

Example:

```text
logical live data = 10 TB
disk used = 18 TB
```

This may be normal depending workload and compaction.

Capacity planning must include space amplification and temporary headroom.

---

## 19. Compaction Preview

Compaction merges SSTables.

Goals:

- reduce number of SSTables,
- discard overwritten data,
- purge tombstones when safe,
- improve read performance,
- control space amplification.

Simplified:

```text
SSTable A + SSTable B + SSTable C -> SSTable D
```

Compaction costs:

- CPU,
- disk IO,
- write amplification,
- temporary space,
- scheduling pressure.

Compaction is not optional maintenance. It is part of the storage engine lifecycle.

Deep compaction strategies are part 016.

---

## 20. Why Write-Heavy Workloads Fit

LSM-style design is good for writes because it avoids random in-place updates.

High-level:

```text
append commitlog
update memory
flush sequential files
compact later
```

This is why ScyllaDB can be excellent for:

- event append,
- telemetry,
- time-series-ish workloads,
- idempotency tables,
- notification/inbox writes,
- state snapshots with controlled updates,
- high-volume denormalized writes.

But if read path is poorly designed, write performance alone is not enough.

---

## 21. Large Partition Problem

Large partition means too much data under one partition key.

Problems:

- read scans too much data,
- memtable/SSTable metadata pressure,
- compaction pressure,
- repair/movement cost,
- cache inefficiency,
- single shard hot path,
- tombstone accumulation,
- pagination cost.

Example bad:

```sql
PRIMARY KEY (tenant_id, event_time)
```

If one tenant writes massive event volume, that partition grows without bound.

Better:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), event_time, event_id)
```

### 21.1 Large Partition Is Both Data Model and Storage Problem

At data model level:

```text
too much logical data under one key
```

At storage level:

```text
too much physical work to read/compact/repair/serve one partition
```

---

## 22. Wide Row vs Wide Partition

In Cassandra/Scylla language, “wide row” historically often refers to a partition with many clustering rows.

Modern phrasing:

```text
wide partition = partition with many rows/cells
```

Not all wide partitions are bad. Time-series design often intentionally stores multiple rows per partition.

Problem arises when:

- partition grows unbounded,
- query usually reads only tiny subset but scans a lot,
- tombstones dominate,
- hot writes hit same partition,
- repair/compaction become expensive.

Bounded wide partition can be good:

```text
device_id + day
user_id + month
case_id + lifecycle_bucket
```

Unbounded wide partition is dangerous:

```text
tenant_id forever
global_status OPEN forever
```

---

## 23. Row Size and Payload Size

Large rows/payloads hurt:

- memory,
- network,
- commitlog,
- SSTable block reads,
- cache,
- Java heap,
- serialization,
- p99 latency.

ScyllaDB is not object storage.

Avoid storing huge blobs directly unless use case is carefully validated.

Better:

```text
store metadata in ScyllaDB
store large binary in object storage
reference by URI/key
```

For regulatory/case platforms:

- document metadata in ScyllaDB,
- document body/evidence file in object storage,
- immutable hash/checksum for audit,
- lifecycle state in ScyllaDB.

---

## 24. Collections and Storage Cost Preview

CQL collections:

```text
list
set
map
```

can be useful but dangerous.

Large collections can create:

- many cells,
- tombstones,
- read amplification,
- update complexity,
- memory pressure.

Bad:

```sql
user_id text PRIMARY KEY,
all_notifications list<frozen<notification>>
```

Better:

```sql
notifications_by_user_bucket (
    user_id,
    bucket_day,
    notification_time,
    notification_id,
    ...
)
```

Collections are not replacement for child tables when collection can grow unbounded.

---

## 25. Static Columns and Storage

Static columns store data shared by all rows in a partition.

Example:

```sql
CREATE TABLE case_events_by_case (
    case_id text,
    event_time timestamp,
    event_id uuid,
    case_type text static,
    event_type text,
    payload text,
    PRIMARY KEY (case_id, event_time, event_id)
);
```

`case_type` is stored once per partition logically.

Useful for partition-level metadata.

Danger:

- if partition is huge, static data still tied to large partition lifecycle,
- updating static column affects partition metadata,
- not a substitute for normalized reference table if access patterns differ.

---

## 26. Compression

SSTables are often compressed.

Benefits:

- reduce disk usage,
- reduce disk IO,
- improve cache/disk efficiency if CPU available.

Costs:

- CPU for compression/decompression,
- read may decompress block larger than needed,
- large rows can waste decompression work,
- compression block size affects read efficiency.

Compression interacts with:

- row size,
- clustering locality,
- read pattern,
- CPU headroom,
- storage cost.

Application implication:

```text
Narrow queries and compact payloads help storage engine.
```

---

## 27. Page Size and Result Set Control

CQL driver paging prevents fetching huge result sets at once.

But page size still matters.

Large page:

- more server work per request,
- more memory,
- bigger network response,
- Java heap pressure,
- longer p99,
- more cancellation waste if client disconnects.

Small page:

- more round trips,
- more overhead,
- potentially worse throughput if too small.

Choose page size based on endpoint and payload.

Interactive APIs often need small bounded limits:

```text
LIMIT 50
LIMIT 100
```

not unbounded scans.

---

## 28. Read Before Write?

Some application patterns perform read-before-write:

```text
read current state
validate
write new state
```

In ScyllaDB, this may be incorrect under concurrency unless guarded.

Storage engine can store writes efficiently, but correctness requires:

- LWT,
- expected version,
- command serialization,
- idempotency,
- append-only event model.

Naive read-before-write:

```text
read status = DRAFT
write status = SUBMITTED
```

Concurrent command:

```text
read status = DRAFT
write status = CANCELLED
```

Race.

Storage internals do not solve application invariant race.

---

## 29. Update Is Write, Delete Is Write

In LSM storage:

```text
UPDATE writes new mutation.
DELETE writes tombstone.
TTL expiry becomes logical delete.
```

This means:

- repeated updates create versions,
- deletes create tombstones,
- compaction later reconciles,
- write-heavy update churn can create read cost.

Application design implication:

```text
Do not model frequently mutating large object as one giant row/document.
```

Better:

- split immutable events from current snapshot,
- keep current snapshot small,
- avoid large collections,
- avoid high-churn cells mixed with cold cells,
- model update frequency explicitly.

---

## 30. Current Snapshot vs Event Log Storage Behavior

A common pattern:

```text
case_events_by_case      append-only event log
case_current_by_id       current snapshot
```

Storage behavior differs.

### 30.1 Event Log

```text
mostly inserts
immutable rows
time-ordered clustering
retention maybe long
reads latest/range
```

Good fit for LSM if bounded partition/bucket.

### 30.2 Current Snapshot

```text
same row updated repeatedly
small row
read by id
latest state
```

Also okay if row small and update rate reasonable.

But high-frequency update to same row can create version churn and hot partition/cell.

### 30.3 Derived Index Table

```text
open_cases_by_assignee
```

May involve insert new view row + delete old view row when status/assignee changes.

This creates tombstones and consistency work.

Derived tables must be designed with lifecycle and cleanup in mind.

---

## 31. Storage Cost of Denormalization

Wide-column modeling often duplicates data.

Example:

```text
case_current_by_id
cases_by_assignee
cases_by_status
cases_by_due_date
```

Each logical state change may write multiple tables.

Storage cost:

- more commitlog/memtable/SSTable writes,
- more compaction,
- more repair,
- more backup data,
- more consistency/reconciliation logic.

Denormalization is correct when it serves a real access pattern and has maintenance plan.

Anti-pattern:

```text
create derived table for every possible filter just in case
```

---

## 32. Secondary Index/Materialized View Storage Preview

Indexes/views create additional storage structures.

They improve access patterns for certain queries but add:

- write amplification,
- read path complexity,
- consistency considerations,
- compaction/repair surface,
- failure modes.

We cover them later in part 017.

For now:

```text
Index is not free. It is extra storage engine work.
```

---

## 33. SSTable Count and Read Latency

Too many SSTables can increase read amplification.

Scenario:

```text
memtable flushes frequently
compaction cannot keep up
many SSTables overlap same partitions
read has to check many files
```

Symptoms:

- read p99 rises,
- disk IO rises,
- Bloom filter/index work rises,
- compaction backlog,
- cache less effective.

Causes:

- write rate too high for compaction,
- wrong compaction strategy,
- insufficient disk/CPU,
- large partitions,
- TTL/tombstone churn,
- too many small tables.

---

## 34. Compaction Debt

Compaction debt means storage engine owes work.

It manifests as:

```text
too many SSTables
too much obsolete data
too many tombstones
high space amplification
read amplification
disk usage growth
```

If compaction cannot catch up, performance degrades over time.

Adding more write load while compaction is behind can create downward spiral.

Operationally:

```text
Compaction is not optional background noise.
It is repayment of LSM write efficiency.
```

---

## 35. Repair/Streaming Interaction

Repair and streaming read/write SSTable data.

They can compete with:

- normal reads,
- normal writes,
- compaction,
- flush,
- backup,
- tablet movement.

During repair/streaming:

- disk IO rises,
- network rises,
- CPU rises,
- cache may churn,
- compaction may follow.

Application p99 can be affected.

Plan heavy operations with headroom.

---

## 36. Snapshots and Immutable SSTables

Immutable SSTables make snapshots practical.

Snapshot can reference existing SSTable files without rewriting all data immediately.

But snapshots consume disk because they keep old SSTable files alive.

If compaction would normally delete old files, snapshot prevents physical removal until snapshot is deleted.

Operational implication:

```text
Snapshots are not free.
Monitor disk.
Expire/delete old snapshots.
```

Backup strategy must account for SSTable lifecycle.

---

## 37. Crash Recovery

If node crashes:

```text
memtable contents lost from RAM
commitlog remains
on restart, commitlog replay rebuilds memtable state
then flush/normal operations continue
```

This is why commitlog exists.

Potential recovery cost depends on:

- amount of unreplayed commitlog,
- write volume before crash,
- disk speed,
- table count,
- mutation size.

Application perspective:

```text
A node restart can temporarily affect latency/availability.
RF/CL determine whether service continues.
```

---

## 38. Failed Write Ambiguity at Storage Layer

At cluster level, write timeout is ambiguous.

At storage layer, mutation may have reached:

- no replica,
- one replica commitlog,
- two replica commitlogs,
- memtable but response delayed,
- some replicas but not others.

This reinforces:

```text
retry only if idempotent
```

Storage engine durability at one replica does not mean cluster-level client success was observed.

---

## 39. Designing for Idempotent Storage Writes

Good pattern:

```sql
CREATE TABLE command_dedup_by_id (
    command_id uuid PRIMARY KEY,
    created_at timestamp,
    command_type text,
    entity_id text
);
```

With LWT if strict first-writer wins:

```sql
INSERT INTO command_dedup_by_id (...)
VALUES (...)
IF NOT EXISTS;
```

Event append:

```sql
CREATE TABLE case_events_by_case (
    case_id text,
    event_version bigint,
    event_id uuid,
    event_time timestamp,
    event_type text,
    payload text,
    PRIMARY KEY (case_id, event_version)
);
```

If `event_version` or `event_id` is deterministic per command, retry writes same logical row.

Avoid:

```text
server-generated new UUID on every retry
counter increment on timeout
append with now() timestamp only
```

---

## 40. Storage-Aware Table Design Examples

### 40.1 Good Latest Events Table

```sql
CREATE TABLE events_by_entity_day (
    entity_id text,
    bucket_day date,
    event_time timestamp,
    event_id uuid,
    event_type text,
    payload text,
    PRIMARY KEY ((entity_id, bucket_day), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC);
```

Good because:

- partition bounded by entity/day,
- latest reads use clustering order,
- append writes natural,
- retention can align with time bucket,
- query path bounded.

### 40.2 Bad Global Status Table

```sql
CREATE TABLE cases_by_status (
    status text,
    updated_at timestamp,
    case_id text,
    payload text,
    PRIMARY KEY (status, updated_at, case_id)
);
```

If status `OPEN` has millions of rows and high churn:

- hot/large partition,
- deletes/tombstones when status changes,
- read scans,
- compaction pressure.

Better:

```sql
CREATE TABLE cases_by_status_bucket (
    status text,
    bucket_day date,
    bucket_id int,
    updated_at timestamp,
    case_id text,
    payload text,
    PRIMARY KEY ((status, bucket_day, bucket_id), updated_at, case_id)
);
```

Still needs cleanup/reconciliation plan.

---

## 41. Anti-Patterns from Storage Perspective

### 41.1 Unbounded Partition

```text
PRIMARY KEY (tenant_id, timestamp)
```

for high-volume tenant forever.

### 41.2 Large Collection

```text
one row contains list of all items
```

### 41.3 High-Churn Wide Row

```text
same partition updated/deleted constantly
```

### 41.4 TTL Everything Randomly

```text
many rows with random TTL in same table and broad scans
```

### 41.5 Huge Page Size

```text
fetch 50k rows/page for interactive endpoint
```

### 41.6 Blind Denormalization

```text
write ten derived tables without ownership/rebuild plan
```

### 41.7 Delete-Heavy Queue

Using ScyllaDB as queue with frequent delete from head can create tombstone-heavy partitions.

Kafka/RabbitMQ are better for queue semantics; ScyllaDB can store state, inbox, outbox records, but queue design must avoid tombstone storms.

---

## 42. Storage-Aware Observability

Metrics/questions to watch:

```text
[ ] read latency per table
[ ] write latency per table
[ ] SSTable count
[ ] compaction backlog
[ ] disk usage
[ ] tombstone warnings
[ ] large partition warnings
[ ] cache hit ratio
[ ] memtable size
[ ] flush activity
[ ] commitlog pressure
[ ] read/write timeout rate
[ ] per-shard CPU
[ ] repair/streaming activity
[ ] snapshot disk usage
```

Ask:

```text
Is slow read due to data model, SSTable count, tombstones, cache miss, disk, or replica consistency?
```

---

## 43. Java Application Implications

### 43.1 Bound Result Size

Repository method should require limit:

```java
List<CaseEvent> findLatestEvents(CaseId caseId, int limit);
```

Avoid:

```java
List<CaseEvent> findAllEvents(CaseId caseId);
```

unless it is explicit export/offline path.

### 43.2 Avoid Loading Huge Partitions into Heap

Bad:

```java
List<Row> rows = session.execute(stmt).all();
```

For large results, this loads all rows.

Better:

- page explicitly,
- stream carefully,
- enforce max rows,
- separate online API and batch export,
- use backpressure.

### 43.3 Use Payload Discipline

Avoid giant JSON blobs if fields are queried independently.

But also avoid over-modeling if payload is opaque and bounded.

Ask:

```text
Is payload read frequently?
Is payload large?
Do we query inside payload?
Does it change independently?
Can it live in object storage?
```

### 43.4 Design Retry with Storage Semantics

If timeout occurs after commitlog append on some replicas, retry may duplicate effect unless idempotent.

Repository contract should state:

```text
idempotent write
non-idempotent write
conditional write
counter write
derived-table write
```

---

## 44. Storage-Level Capacity Planning

Inputs:

```text
logical data size
RF
compression ratio
space amplification
compaction temporary space
snapshots
backup staging
tombstone retention
growth rate
write amplification
repair/streaming headroom
```

Rough disk thinking:

```text
required disk > logical_data * RF / compression_ratio * amplification_factor + snapshots + headroom
```

Do not run close to full disk.

Full disks are severe in LSM systems because compaction needs space.

### 44.1 Example

Logical live data:

```text
10 TB
RF = 3
compression ratio = 0.5
space amplification = 1.5
```

Physical rough:

```text
10 TB * 3 * 0.5 * 1.5 = 22.5 TB
```

Then add:

- snapshots,
- temporary compaction headroom,
- growth headroom,
- repair/streaming overhead,
- operational safety margin.

---

## 45. Debugging Slow Read Example

Symptom:

```text
GET /cases/{id}/events p99 jumps from 30 ms to 2s
Only old cases affected.
```

Hypotheses:

1. Old cases have huge partitions.
2. Query scans many tombstones.
3. Many SSTables due to compaction backlog.
4. Cache miss for cold data.
5. Page size too large.
6. Clustering range unbounded.
7. Repair/compaction running.
8. Driver retries amplify.

Investigation:

```text
[ ] Check table schema.
[ ] Check partition size for affected case_id.
[ ] Check query limit/range.
[ ] Check tombstone warnings.
[ ] Check SSTable count.
[ ] Check compaction backlog.
[ ] Check per-shard metrics.
[ ] Check client page size.
[ ] Check payload size.
```

Likely fix:

- bucket events by month/day,
- query only latest buckets,
- reduce page size,
- compact/tune strategy,
- archive cold data,
- rebuild table.

---

## 46. Debugging Slow Write Example

Symptom:

```text
append event p99 rises under load
read latency mostly okay
```

Hypotheses:

1. Commitlog/disk pressure.
2. Memtable flush cannot keep up.
3. Compaction competing with writes.
4. Large payloads.
5. Hot partition/shard.
6. RF/CL requiring slow replicas.
7. Derived table writes multiply work.
8. Secondary index/materialized view write amplification.
9. Client retry storm.

Investigation:

```text
[ ] write latency per table
[ ] commitlog metrics
[ ] flush metrics
[ ] disk IO
[ ] compaction backlog
[ ] per-shard CPU
[ ] payload size
[ ] table count per command
[ ] timeout/retry rate
[ ] replica/node health
```

Likely fix depends on layer:

- throttle,
- reduce payload,
- improve bucketing,
- tune compaction,
- add capacity,
- remove unnecessary derived writes,
- fix retries.

---

## 47. Design Review Checklist

For each table:

```text
[ ] Is partition size bounded?
[ ] Is clustering order aligned with query?
[ ] Are reads bounded by LIMIT/range?
[ ] Is TTL usage deliberate?
[ ] Are deletes/tombstones understood?
[ ] Is compaction strategy suitable?
[ ] Are collections bounded?
[ ] Are payloads reasonably sized?
[ ] Are derived table writes justified?
[ ] Is source-of-truth clear?
[ ] Is backup/snapshot impact understood?
[ ] Is page size controlled?
[ ] Is retry idempotency defined?
[ ] Are large partitions monitored?
[ ] Are tombstones monitored?
```

For each endpoint:

```text
[ ] How many partitions read?
[ ] How many rows returned?
[ ] How many bytes returned?
[ ] How many DB calls?
[ ] What is page size?
[ ] What is p99 budget?
[ ] Is this online API or export/batch?
[ ] What happens on timeout?
```

---

## 48. Common Misconceptions

### Misconception 1: “Update modifies data in place.”

In LSM storage, update writes a new mutation. Old data may remain until compaction.

### Misconception 2: “Delete removes data immediately.”

Delete writes tombstone. Physical purge happens later when safe.

### Misconception 3: “TTL is free cleanup.”

TTL creates expiration/tombstone/compaction work.

### Misconception 4: “Writes are always cheap.”

Writes are optimized, but large payloads, indexes, derived tables, compaction, RF, and disk pressure matter.

### Misconception 5: “Reads by primary key are always cheap.”

Reads are cheap when partition is bounded and SSTable/tombstone count reasonable. Large partitions and tombstones can make primary-key reads expensive.

### Misconception 6: “Compression always improves performance.”

Compression reduces IO but costs CPU and can amplify block read cost depending query/payload.

### Misconception 7: “Compaction is optional background maintenance.”

Compaction is core to LSM health.

---

## 49. Mental Model Compression

Remember:

```text
Write path:
commitlog -> memtable -> ack -> flush -> SSTable -> compaction

Read path:
memtable/cache -> Bloom filter -> SSTable index -> data blocks -> merge -> tombstone apply -> result
```

And:

```text
LSM makes writes cheap now by creating work to be paid later through reads and compaction.
```

Storage health is the balance among:

```text
write amplification
read amplification
space amplification
```

---

## 50. Summary

ScyllaDB’s storage engine follows LSM-style principles adapted to its shard-per-core architecture.

Key lessons:

1. Writes append to commitlog and update memtable.
2. Memtables flush to immutable SSTables.
3. Reads may merge data from memtable and multiple SSTables.
4. Bloom filters help skip irrelevant SSTables.
5. Index/summary structures locate data inside SSTables.
6. Deletes and TTLs create tombstones.
7. Compaction merges SSTables and eventually purges obsolete data.
8. Read amplification, write amplification, and space amplification are central trade-offs.
9. Large partitions are both data model and storage problems.
10. Page size and result size matter for server and Java heap.
11. Denormalization increases storage/write/repair cost.
12. Snapshots rely on immutable SSTables but consume disk.
13. Retry safety must account for ambiguous writes.
14. Java repositories should expose bounded, partition-oriented access.
15. Storage engine efficiency depends on query-first data modeling.

---

## 51. Review Questions

1. Apa fungsi commitlog?
2. Apa fungsi memtable?
3. Apa perbedaan flush dan compaction?
4. Kenapa SSTable immutable?
5. Kenapa update tidak sama dengan in-place update?
6. Kenapa delete menghasilkan tombstone?
7. Bagaimana TTL berhubungan dengan tombstone?
8. Apa itu read amplification?
9. Apa itu write amplification?
10. Apa itu space amplification?
11. Kenapa large partition berbahaya?
12. Kenapa Bloom filter tidak bisa menjamin “definitely yes”?
13. Kenapa read bisa menyentuh banyak SSTable?
14. Bagaimana clustering order membantu latest-N query?
15. Kenapa large collection berbahaya?
16. Apa dampak page size terlalu besar?
17. Bagaimana snapshots memengaruhi disk usage?
18. Mengapa compaction debt berbahaya?
19. Apa storage cost dari denormalization?
20. Bagaimana Java service harus menghindari loading huge result set?

---

## 52. Practical Exercise

Use case:

```text
A case-management service stores:
- immutable case events
- current case state
- open cases by assignee
```

Design storage-aware model:

```text
1. Table for case events.
2. Partition key and clustering key.
3. Time bucket or not?
4. Expected max partition size.
5. Read latest 100 query.
6. Table for current state.
7. Expected update frequency.
8. Table for open cases by assignee.
9. How to avoid huge OPEN partition?
10. What deletes/tombstones happen when case closes?
11. What compaction/TTL concerns exist?
12. What result limits exist in Java repository?
13. What writes are idempotent?
14. What table is source-of-truth?
15. What table can be rebuilt?
16. What metrics detect storage health issues?
```

---

## 53. Preview Part 007

Part berikutnya mulai masuk ke CQL:

```text
keyspace
replication strategy
table DDL
primary key syntax
partition key
clustering key
static columns
types
collections
UDT
INSERT/UPDATE/DELETE
TTL
timestamp
schema agreement
```

Part 006 memberi storage mental model.

Part 007 akan menunjukkan bagaimana model storage/distribusi ini muncul di syntax CQL sehari-hari.

---

# End of Part 006

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Tablets, VNodes, Token Ranges, dan Data Distribution Modern ScyllaDB</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-007.md">Part 007 — CQL Deep Dive I: Keyspace, Table, Types, DDL, DML ➡️</a>
</div>
